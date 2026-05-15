#!/usr/bin/env python3
"""Apuana Monitor HTTP server with no third-party Python dependencies."""

import json
import os
import re
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
JOB_ID_RE = re.compile(r"^\d+(?:_(?:\d+|\[\d+(?:-\d+)?\]))?(?:\.(?:batch|\d+))?$")
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


def _slurm_ok(stderr: str) -> bool:
    lower = (stderr or "").lower()
    return "fatal" not in lower and "error:" not in lower


def _memory_to_mb(raw: str) -> int:
    value = (raw or "").strip()
    if not value or value.upper() == "N/A":
        return 0

    match = re.match(r"^(\d+(?:\.\d+)?)([KMGT]?)([cn]?)$", value, re.IGNORECASE)
    if not match:
        return 0

    amount = float(match.group(1))
    unit = match.group(2).upper() or "M"
    scale = {"K": 1 / 1024, "M": 1, "G": 1024, "T": 1024 * 1024}
    return int(amount * scale.get(unit, 1))


def _memory_scope(raw: str) -> str:
    match = re.match(r"^\d+(?:\.\d+)?[KMGT]?([cn]?)$", (raw or "").strip(), re.IGNORECASE)
    return match.group(1).lower() if match else ""


def _memory_total_mb(raw: str, cpus: int, nodes: int) -> int:
    base_mb = _memory_to_mb(raw)
    if _memory_scope(raw) == "c":
        return base_mb * max(cpus, 1)
    return base_mb * max(nodes, 1)


def _memory_human(mb: int) -> str:
    if mb <= 0:
        return "-"
    if mb >= 1024 * 1024:
        return f"{mb / (1024 * 1024):.1f} TiB"
    if mb >= 1024:
        return f"{mb / 1024:.1f} GiB"
    return f"{mb} MiB"


def _gpu_request_count(raw: str) -> int:
    value = raw or ""
    total = 0
    for match in re.finditer(r"(?:gres:)?gpu(?::[^:,=]+)?:(\d+)", value):
        total += _int(match.group(1))
    for match in re.finditer(r"gres/gpu=(\d+)", value):
        total += _int(match.group(1))
    if total == 0:
        for match in re.finditer(r"\bgpu=(\d+)", value):
            total += _int(match.group(1))
    return total


def _tres_value(raw: str, key: str) -> int:
    for item in (raw or "").split(","):
        name, _, value = item.partition("=")
        if name == key:
            return _int(value)
    return 0


def _parse_scontrol_fields(raw: str) -> dict:
    text = " ".join(line.strip() for line in (raw or "").splitlines() if line.strip())
    matches = list(re.finditer(r"(?<!\S)([A-Za-z][A-Za-z0-9_:/]*)=", text))
    fields = {}
    for idx, match in enumerate(matches):
        key = match.group(1)
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        fields[key] = text[match.end():end].strip()
    return fields


def _strip_slurm_identity(value: str) -> str:
    match = re.match(r"^(.+?)\(\d+\)$", value or "")
    return match.group(1) if match else (value or "")


def _job_info_payload(raw_job_id: str) -> dict:
    job_id = _normalize_job_id(raw_job_id)
    if not job_id:
        return {"ok": False, "error": "Invalid job ID.", "job_id": raw_job_id, "fields": {}, "raw": ""}

    rc, out, err = _run(["scontrol", "show", "job", job_id], timeout=8)
    raw = out or err
    if rc != 0 or not out:
        return {
            "ok": False,
            "error": raw or "scontrol returned no job data.",
            "job_id": job_id,
            "fields": {},
            "raw": raw,
        }

    fields = _parse_scontrol_fields(out)
    tres = fields.get("TRES", "")
    resources = {
        "nodes": _int(fields.get("NumNodes", "")),
        "cpus": _int(fields.get("NumCPUs", "")) or _tres_value(tres, "cpu"),
        "tasks": _int(fields.get("NumTasks", "")),
        "cpus_per_task": _int(fields.get("CPUs/Task", "")),
        "memory": fields.get("MinMemoryNode") or fields.get("MinMemoryCPU") or "-",
        "gpus": _gpu_request_count(tres) or _gpu_request_count(fields.get("TresPerNode", "")),
        "tres": tres,
        "tres_per_node": fields.get("TresPerNode", ""),
    }

    summary = {
        "job_id": fields.get("JobId", job_id),
        "name": fields.get("JobName", "-"),
        "state": fields.get("JobState", "-"),
        "reason": fields.get("Reason", "-"),
        "user": _strip_slurm_identity(fields.get("UserId", "")),
        "account": fields.get("Account", "-"),
        "qos": fields.get("QOS", "-"),
        "partition": fields.get("Partition", "-"),
        "runtime": fields.get("RunTime", "-"),
        "time_limit": fields.get("TimeLimit", "-"),
        "submit_time": fields.get("SubmitTime", "-"),
        "start_time": fields.get("StartTime", "-"),
        "end_time": fields.get("EndTime", "-"),
        "scheduler": fields.get("Scheduler", "-"),
        "node_list": fields.get("NodeList", "-"),
        "batch_host": fields.get("BatchHost", "-"),
        "command": fields.get("Command", "-"),
        "work_dir": fields.get("WorkDir", "-"),
        "stdout": fields.get("StdOut", "-"),
        "stderr": fields.get("StdErr", "-"),
        "exit_code": fields.get("ExitCode", "-"),
    }

    return {
        "ok": True,
        "error": "",
        "job_id": job_id,
        "summary": summary,
        "resources": resources,
        "fields": fields,
        "raw": out,
    }


def _load_payload() -> dict:
    cpu_count = os.cpu_count() or 0
    try:
        parts = Path("/proc/loadavg").read_text(encoding="utf-8").split()
        load1, load5, load15 = (float(parts[0]), float(parts[1]), float(parts[2]))
    except Exception:
        load1 = load5 = load15 = 0.0

    return {
        "cpus": cpu_count,
        "load1": load1,
        "load5": load5,
        "load15": load15,
        "load_pct": round(load1 / cpu_count * 100) if cpu_count else 0,
    }


def _resource_summary(rows: list[dict]) -> dict:
    cpus = sum(r["cpus"] for r in rows)
    mem_mb = sum(r["mem_total_mb"] for r in rows)
    gpus = sum(r["gpus"] for r in rows)
    return {
        "jobs": len(rows),
        "cpus": cpus,
        "mem_mb": mem_mb,
        "mem_human": _memory_human(mem_mb),
        "gpus": gpus,
    }


def _resources_payload() -> dict:
    rc, out, err = _run(
        ["squeue", "-h", "-o", "%i|%u|%P|%j|%T|%C|%m|%b|%D|%M|%R"], timeout=6
    )
    if rc != 0 or not _slurm_ok(err):
        return {
            "ok": False,
            "error": (err or out or "squeue failed").splitlines()[-1],
            "jobs": [],
            "running_jobs": [],
            "pending_jobs": [],
            "running": _resource_summary([]),
            "pending": _resource_summary([]),
            "current_user": _resource_summary([]),
            "by_user": [],
            "login_cpu": _load_payload(),
        }

    jobs = []
    for line in out.splitlines():
        parts = line.split("|", 10)
        if len(parts) < 11:
            continue

        job_id, user, partition, name, state, cpus, mem_raw, tres, nodes, runtime, reason = parts
        cpu_count = _int(cpus)
        node_count = max(_int(nodes), 1)
        mem_mb = _memory_to_mb(mem_raw)
        mem_total_mb = _memory_total_mb(mem_raw, cpu_count, node_count)
        jobs.append(
            {
                "job_id": job_id,
                "user": user,
                "partition": partition,
                "name": name,
                "state": state,
                "cpus": cpu_count,
                "mem_raw": mem_raw,
                "mem_mb": mem_mb,
                "mem_total_mb": mem_total_mb,
                "mem_human": _memory_human(mem_total_mb),
                "gpus": _gpu_request_count(tres),
                "nodes": node_count,
                "time": runtime,
                "reason": reason,
            }
        )

    running = [job for job in jobs if job["state"] == "RUNNING"]
    pending = [job for job in jobs if job["state"] == "PENDING"]
    by_user: dict[str, dict] = {}
    for job in running:
        entry = by_user.setdefault(
            job["user"], {"user": job["user"], "jobs": 0, "cpus": 0, "mem_mb": 0, "gpus": 0}
        )
        entry["jobs"] += 1
        entry["cpus"] += job["cpus"]
        entry["mem_mb"] += job["mem_total_mb"]
        entry["gpus"] += job["gpus"]

    users = sorted(by_user.values(), key=lambda item: (-item["cpus"], item["user"]))
    for item in users:
        item["mem_human"] = _memory_human(item["mem_mb"])

    return {
        "ok": True,
        "error": "",
        "jobs": jobs,
        "running_jobs": running,
        "pending_jobs": pending,
        "running": _resource_summary(running),
        "pending": _resource_summary(pending),
        "current_user": _resource_summary([job for job in running if job["user"] == USER]),
        "by_user": users,
        "login_cpu": _load_payload(),
    }


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


def _normalize_job_id(raw: str) -> str:
    job_id = (raw or "").strip().split()[0] if (raw or "").strip() else ""
    return job_id if JOB_ID_RE.match(job_id) else ""


def _parse_nvidia_smi_csv(out: str) -> list[dict]:
    gpus = []
    for line in out.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 6:
            continue
        gpus.append(
            {
                "index": parts[0],
                "name": parts[1],
                "util": _int(parts[2]),
                "mem_used": _int(parts[3]),
                "mem_total": max(_int(parts[4]), 1),
                "temp": _int(parts[5]),
            }
        )
    return gpus


def _job_gpu_access(base_job_id: str) -> tuple[bool, str]:
    rc, out, err = _run(
        ["squeue", "-h", "-j", base_job_id, "-o", "%i|%u|%T|%b"], timeout=5
    )
    if rc != 0 or not _slurm_ok(err):
        return False, err or out or "Could not inspect job access."

    candidates = []
    for line in out.splitlines():
        parts = line.split("|", 3)
        if len(parts) == 4:
            candidates.append(
                {
                    "job_id": parts[0],
                    "user": parts[1],
                    "state": parts[2],
                    "gpus": _gpu_request_count(parts[3]),
                }
            )

    if not candidates:
        return False, "Job is not active in the current queue."

    own_running_gpu_jobs = [
        job for job in candidates
        if job["user"] == USER and job["state"] == "RUNNING" and job["gpus"] > 0
    ]
    if own_running_gpu_jobs:
        return True, ""

    if any(job["user"] != USER for job in candidates):
        return False, "GPU telemetry is only available for your own jobs."
    if any(job["state"] != "RUNNING" for job in candidates):
        return False, "GPU telemetry is only available for RUNNING jobs."
    return False, "This job does not request a GPU."


def _job_gpu_payload(raw_job_id: str) -> dict:
    job_id = _normalize_job_id(raw_job_id)
    if not job_id:
        return {"ok": False, "error": "Invalid job ID.", "job_id": raw_job_id, "gpus": []}

    base_job_id = job_id.split(".", 1)[0]
    allowed, access_error = _job_gpu_access(base_job_id)
    if not allowed:
        return {
            "ok": False,
            "error": access_error,
            "job_id": job_id,
            "base_job_id": base_job_id,
            "gpus": [],
            "stdout": "",
            "stderr": "",
            "code": 0,
        }

    cmd = [
        "srun",
        "--immediate=1",
        f"--jobid={base_job_id}",
        "nvidia-smi",
        "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu",
        "--format=csv,noheader,nounits",
    ]
    rc, out, err = _run(cmd, timeout=10)
    gpus = _parse_nvidia_smi_csv(out) if rc == 0 else []
    return {
        "ok": rc == 0 and bool(gpus),
        "error": "" if rc == 0 and gpus else (err or out or "No GPU telemetry returned."),
        "job_id": job_id,
        "base_job_id": base_job_id,
        "command": " ".join(cmd),
        "gpus": gpus,
        "stdout": out,
        "stderr": err,
        "code": rc,
    }


def _collect() -> None:
    global _prev
    node = socket.gethostname()
    while True:
        d: dict = {"ts": time.strftime("%H:%M:%S"), "node": node, "user": USER}

        # squeue: -o and format string as separate arguments
        rc, out, err = _run(["squeue", "-o", "%i|%u|%P|%j|%T|%M|%D|%R", "--noheader"])
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
        d["resources"] = _resources_payload()

        rc, out, err = _run(["sinfo", "-o", "%P|%a|%l|%D|%t", "--noheader"])
        sinfo_ok = rc == 0 and _slurm_ok(err)
        d["sinfo"] = (
            {"ok": True,
             "headers": ["PARTITION", "AVAIL", "TIMELIMIT", "NODES", "STATE"],
             "rows": [ln.split("|") for ln in out.splitlines() if ln]}
            if sinfo_ok else {"ok": False, "error": (err or out).splitlines()[-1] if (err or out) else "sinfo failed"}
        )
        d["transfer"] = {"user": USER, "host": TRANSFER_HOST, "home": str(Path.home())}

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
                        total, free, avail = int(p[1]), int(p[3]), int(p[6])
                        used = total - avail
                        d["mem"] = {
                            "total": f"{total // 1024}Gi",
                            "used": f"{used // 1024}Gi",
                            "available": f"{avail // 1024}Gi",
                            "free": f"{free // 1024}Gi",
                            "total_mb": total,
                            "used_mb": used,
                            "available_mb": avail,
                            "pct": round(used / total * 100) if total else 0,
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
        elif parsed.path == "/api/job-gpu":
            jid = qs.get("id", [""])[0].strip()
            body = json.dumps(_job_gpu_payload(jid)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/job-info":
            jid = qs.get("id", [""])[0].strip()
            body = json.dumps(_job_info_payload(jid)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/job":
            jid = qs.get("id", [""])[0].strip()
            if not _normalize_job_id(jid):
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
