#!/usr/bin/env python3
"""Apuana Monitor HTTP server with no third-party Python dependencies."""

import json
import os
import socket
import socketserver
import subprocess
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = int(
    os.environ.get(
        "SLURM_MONITOR_PORT",
        os.environ.get(
            "SLURM_MONITOR_STREAMLIT_PORT",
            os.environ.get("APUANA_MONITOR_STREAMLIT_PORT", 8501),
        ),
    )
)
USER = os.environ.get("USER", "")
TRANSFER_HOST = os.environ.get(
    "SLURM_MONITOR_TRANSFER_HOST",
    os.environ.get("APUANA_MONITOR_TRANSFER_HOST", "slurm-client1.cin.ufpe.br"),
)
HTML = Path(__file__).parent / "static" / "index.html"
STATIC_ROOT = Path(__file__).parent / "static"
STATIC_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}

_cache: dict = {}
_prev: dict = {}          # previous snapshot for deltas
_lock = threading.Lock()


def _run(cmd: list[str], timeout: int = 8) -> tuple[int, str, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except Exception as e:
        return 1, "", str(e)


def _int(v: str) -> int:
    try:
        return int(v)
    except Exception:
        return 0


def _user_path(raw: str) -> Path:
    raw = (raw or "~").strip() or "~"
    expanded = os.path.expandvars(os.path.expanduser(raw))
    p = Path(expanded)
    if not p.is_absolute():
        p = Path.home() / p
    return p.resolve(strict=False)


def _size_human(n: int) -> str:
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    value = float(max(n, 0))
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{n} B"


def _entry_payload(path: Path) -> dict:
    try:
        st = path.lstat()
        is_dir = path.is_dir()
        is_file = path.is_file()
        kind = "directory" if is_dir else "file" if is_file else "other"
        return {
            "name": path.name or str(path),
            "path": str(path),
            "kind": kind,
            "is_dir": is_dir,
            "is_file": is_file,
            "is_symlink": path.is_symlink(),
            "size": st.st_size,
            "size_human": "" if is_dir else _size_human(st.st_size),
            "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
            "error": "",
        }
    except OSError as e:
        return {
            "name": path.name or str(path),
            "path": str(path),
            "kind": "unavailable",
            "is_dir": False,
            "is_file": False,
            "is_symlink": False,
            "size": 0,
            "size_human": "",
            "mtime": "",
            "error": str(e),
        }


def _scan_entries(base: Path, query: str, max_results: int = 120) -> tuple[list[dict], bool]:
    query_l = query.lower().strip()
    results: list[dict] = []
    truncated = False

    if not base.exists():
        return results, False
    if base.is_file():
        return [_entry_payload(base)], False
    if not base.is_dir():
        return [_entry_payload(base)], False

    # Empty query lists the current directory only. A query searches a bounded
    # tree so the dashboard does not accidentally walk a whole shared filesystem.
    queue: list[tuple[Path, int]] = [(base, 0)]
    max_depth = 4 if query_l else 1
    while queue:
        current, depth = queue.pop(0)
        try:
            entries = sorted(
                list(os.scandir(current)),
                key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()),
            )
        except OSError:
            continue

        for entry in entries:
            p = Path(entry.path)
            name_l = entry.name.lower()
            try:
                is_dir = entry.is_dir(follow_symlinks=False)
                is_link = entry.is_symlink()
            except OSError:
                is_dir = False
                is_link = False

            if not query_l or query_l in name_l:
                results.append(_entry_payload(p))
                if len(results) >= max_results:
                    return results, True

            if query_l and is_dir and not is_link and depth + 1 < max_depth:
                queue.append((p, depth + 1))

    return results, truncated


def _fs_payload(raw_path: str, query: str) -> dict:
    try:
        path = _user_path(raw_path)
    except OSError as e:
        return {"ok": False, "error": str(e), "items": []}

    if not path.exists():
        return {
            "ok": False,
            "error": "Path does not exist.",
            "path": str(path),
            "parent": str(path.parent),
            "home": str(Path.home()),
            "items": [],
        }

    items, truncated = _scan_entries(path, query)
    return {
        "ok": True,
        "error": "",
        "path": str(path),
        "parent": str(path.parent),
        "home": str(Path.home()),
        "query": query,
        "is_dir": path.is_dir(),
        "items": items,
        "truncated": truncated,
    }


def _collect() -> None:
    global _prev
    node = socket.gethostname()
    while True:
        d: dict = {"ts": time.strftime("%H:%M:%S"), "node": node, "user": USER}

        # squeue: -o and format string as separate arguments
        rc, out, err = _run(["squeue", "-o", "%i|%u|%P|%j|%T|%M|%D|%R", "--noheader"])
        _slurm_ok = lambda e: "fatal" not in e.lower() and "error:" not in e.lower()
        squeue_ok = rc == 0 and _slurm_ok(err)
        rows = [ln.split("|") for ln in out.splitlines() if ln] if squeue_ok else []
        d["queue"] = (
            {"ok": True,
             "headers": ["JOBID", "USER", "PARTITION", "NAME", "STATE", "TIME", "NODES", "REASON"],
             "rows": rows}
            if squeue_ok else {"ok": False, "error": (err or out).splitlines()[-1] if (err or out) else "squeue failed", "headers": [], "rows": []}
        )

        # compute KPI counters
        run = sum(1 for r in rows if len(r) > 4 and r[4] == "RUNNING")
        pnd = sum(1 for r in rows if len(r) > 4 and r[4] == "PENDING")

        # deltas vs previous collection
        with _lock:
            prev_run = _prev.get("run", run)
            prev_pnd = _prev.get("pnd", pnd)
        d["run"]       = run
        d["pnd"]       = pnd
        d["delta_run"] = run - prev_run
        d["delta_pnd"] = pnd - prev_pnd

        # active users (unique users currently in the queue)
        d["active_users"] = sorted({r[1] for r in rows if len(r) > 1})

        rc, out, err = _run(["sinfo", "-o", "%P|%a|%l|%D|%t", "--noheader"])
        sinfo_ok = rc == 0 and _slurm_ok(err)
        d["sinfo"] = (
            {"ok": True,
             "headers": ["PARTITION", "AVAIL", "TIMELIMIT", "NODES", "STATE"],
             "rows": [ln.split("|") for ln in out.splitlines() if ln]}
            if sinfo_ok else {"ok": False, "error": (err or out).splitlines()[-1] if (err or out) else "sinfo failed"}
        )
        d["transfer"] = {"user": USER, "host": TRANSFER_HOST, "home": str(Path.home())}

        rc, _, err = _run(
            ["sacct", "-n", "-X", "--format=JobID", "--starttime=now-1hour"], timeout=5
        )
        d["acct_ok"] = rc == 0 and _slurm_ok(err)

        rc, out, _ = _run([
            "nvidia-smi",
            "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu",
            "--format=csv,noheader,nounits",
        ])
        gpus = []
        if rc == 0:
            for ln in out.splitlines():
                p = [x.strip() for x in ln.split(",")]
                if len(p) >= 6:
                    gpus.append({
                        "index": p[0], "name": p[1],
                        "util": _int(p[2]),
                        "mem_used": _int(p[3]), "mem_total": max(_int(p[4]), 1),
                        "temp": _int(p[5]),
                    })
        d["gpus"] = gpus

        # disk usage (exclude tmpfs / run paths)
        rc, out, _ = _run(["df", "-h", "--output=size,used,avail,pcent,target"])
        disks = []
        if rc == 0:
            for ln in out.splitlines()[1:]:
                p = ln.split()
                if len(p) < 5:
                    continue
                mount = p[-1]
                if any(mount == x or mount.startswith(x + "/") for x in ("/run", "/dev", "/sys", "/proc")):
                    continue
                try:
                    disks.append({"size": p[0], "used": p[1], "avail": p[2],
                                  "pct": int(p[3].rstrip("%")), "mount": mount})
                except (ValueError, IndexError):
                    pass
        d["disks"] = disks

        # memory (free -m: MB for arithmetic, human-readable in output)
        rc, out, _ = _run(["free", "-m"])
        d["mem"] = {}
        if rc == 0:
            for ln in out.splitlines():
                if ln.startswith("Mem:"):
                    p = ln.split()
                    if len(p) >= 7:
                        total, avail = int(p[1]), int(p[6])
                        used = total - avail
                        d["mem"] = {
                            "total": f"{total // 1024}Gi",
                            "used":  f"{used  // 1024}Gi",
                            "pct":   round(used / total * 100) if total else 0,
                        }

        # uptime / load average
        rc, out, _ = _run(["uptime"])
        d["uptime"] = out.strip() if rc == 0 else ""

        # logged-in users (who)
        rc, out, _ = _run(["who"])
        logins = []
        if rc == 0:
            for ln in out.splitlines():
                p = ln.split(None, 4)
                if len(p) >= 4:
                    logins.append({
                        "user":  p[0],
                        "tty":   p[1],
                        "since": f"{p[2]} {p[3]}",
                        "from":  p[4].strip("() ") if len(p) > 4 else "",
                    })
        d["logins"] = logins

        with _lock:
            _prev = {"run": run, "pnd": pnd}
            _cache.clear()
            _cache.update(d)
        time.sleep(5)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path in ("/", "/index.html"):
            self._send(200, "text/html; charset=utf-8", HTML.read_bytes())
        elif parsed.path.startswith("/static/"):
            self._send_static(parsed.path.removeprefix("/static/"))
        elif parsed.path == "/api":
            with _lock:
                body = json.dumps(_cache).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/fs":
            path = qs.get("path", ["~"])[0]
            query = qs.get("query", [""])[0]
            body = json.dumps(_fs_payload(path, query)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/job":
            jid = qs.get("id", [""])[0].strip()
            # allow digits, dots, underscores only
            if not jid or not all(c in "0123456789._" for c in jid):
                self._send(400, "text/plain", b"Invalid job ID")
                return
            rc, out, err = _run(["scontrol", "show", "job", jid])
            self._send(200, "text/plain", (out or err or "no output").encode())
        elif parsed.path == "/api/logs":
            home = str(Path.home())
            result = {}
            for key in ("out", "err"):
                p = qs.get(key, [""])[0].strip()
                if not p or not Path(p).resolve().as_posix().startswith(home):
                    result[key] = ""
                    continue
                rc, out, _ = _run(["tail", "-n", "200", p], timeout=4)
                result[key] = out if rc == 0 else ""
            self._send(200, "application/json", json.dumps(result).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def _send_static(self, raw_path: str) -> None:
        try:
            target = (STATIC_ROOT / raw_path).resolve(strict=True)
            target.relative_to(STATIC_ROOT.resolve())
        except (OSError, ValueError):
            self.send_response(404)
            self.end_headers()
            return

        if not target.is_file():
            self.send_response(404)
            self.end_headers()
            return

        content_type = STATIC_TYPES.get(target.suffix.lower(), "application/octet-stream")
        self._send(200, content_type, target.read_bytes())

    def _send(self, code: int, ct: str, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ct)
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


class _Server(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    node = socket.gethostname()
    threading.Thread(target=_collect, daemon=True).start()
    print(f"[apuana] http://127.0.0.1:{PORT}")
    print(f"[apuana] ssh -N -L {PORT}:localhost:{PORT} {USER}@{node}")
    _Server(("127.0.0.1", PORT), Handler).serve_forever()
