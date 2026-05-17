import json
import os
import shlex
import time
from pathlib import Path

from .runtime import _run, _session_public

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


def _hidden_last_sort_key(name: str, is_dir: bool) -> tuple[int, str]:
    hidden = str(name or "").startswith(".")
    if hidden:
        group = 2 if is_dir else 3
    else:
        group = 0 if is_dir else 1
    return group, str(name or "").lower()


def _dir_entry_sort_key(entry) -> tuple[int, str]:
    try:
        is_dir = entry.is_dir(follow_symlinks=False)
    except OSError:
        is_dir = False
    return _hidden_last_sort_key(entry.name, is_dir)


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
            entries = sorted(list(os.scandir(current)), key=_dir_entry_sort_key)
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


def _remote_fs_payload(raw_path: str, query: str) -> dict:
    script = r"""
import json
import os
import pathlib
import subprocess
import time

raw = os.environ.get("PATH_IN", "~")
query = os.environ.get("QUERY_IN", "").strip().lower()

def size_human(n):
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    value = float(max(n, 0))
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{n} B"

def hidden_last_sort_key(entry):
    try:
        is_dir = entry.is_dir(follow_symlinks=False)
    except OSError:
        is_dir = False
    hidden = entry.name.startswith(".")
    if hidden:
        group = 2 if is_dir else 3
    else:
        group = 0 if is_dir else 1
    return (group, entry.name.lower())

expanded = os.path.expandvars(os.path.expanduser(raw))
p = pathlib.Path(expanded)
if not p.is_absolute():
    p = pathlib.Path.home() / p
p = p.resolve(strict=False)
home = pathlib.Path.home().resolve(strict=False)

def inside_home(candidate):
    try:
        candidate.relative_to(home)
        return True
    except ValueError:
        return False

try:
    p.relative_to(home)
except ValueError:
    print(json.dumps({
        "ok": False,
        "error": "Access denied: only paths inside your home directory are allowed.",
        "path": str(p),
        "parent": str(home),
        "home": str(home),
        "items": [],
    }))
    raise SystemExit

if not p.exists():
    print(json.dumps({"ok": False, "error": "Path does not exist.", "path": str(p), "items": []}))
    raise SystemExit

if p.is_file():
    st = p.lstat()
    print(json.dumps({
        "ok": True,
        "error": "",
        "path": str(p),
        "parent": str(p.parent if p.parent != p and inside_home(p.parent) else home),
        "home": str(home),
        "query": query,
        "is_dir": False,
        "items": [{
            "name": p.name,
            "path": str(p),
            "kind": "file",
            "is_dir": False,
            "is_file": True,
            "is_symlink": p.is_symlink(),
            "size": st.st_size,
            "size_human": size_human(st.st_size),
            "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
            "error": "",
        }],
        "truncated": False,
    }))
    raise SystemExit

def entry_payload(entry):
    try:
        st = entry.stat(follow_symlinks=False)
        is_dir = entry.is_dir(follow_symlinks=False)
        is_file = entry.is_file(follow_symlinks=False)
        kind = "directory" if is_dir else "file" if is_file else "other"
        return {
            "name": entry.name,
            "path": entry.path,
            "kind": kind,
            "is_dir": is_dir,
            "is_file": is_file,
            "is_symlink": entry.is_symlink(),
            "size": st.st_size,
            "size_human": "" if is_dir else size_human(st.st_size),
            "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
            "error": "",
        }
    except OSError as exc:
        return {
            "name": entry.name,
            "path": entry.path,
            "kind": "unavailable",
            "is_dir": False,
            "is_file": False,
            "is_symlink": False,
            "size": 0,
            "size_human": "",
            "mtime": "",
            "error": str(exc),
        }

def payload_from_find(type_code, size, mtime, raw_path):
    path = pathlib.Path(raw_path)
    is_dir = type_code == "d"
    is_file = type_code == "f"
    try:
        size_n = int(size)
    except ValueError:
        size_n = 0
    try:
        mtime_n = float(mtime)
    except ValueError:
        mtime_n = 0
    return {
        "name": path.name,
        "path": str(path),
        "kind": "directory" if is_dir else "file" if is_file else "other",
        "is_dir": is_dir,
        "is_file": is_file,
        "is_symlink": type_code == "l",
        "size": size_n,
        "size_human": "" if is_dir else size_human(size_n),
        "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime_n)) if mtime_n else "",
        "error": "",
    }

def find_sort_key(item):
    name = item.get("name", "")
    is_dir = bool(item.get("is_dir"))
    hidden = name.startswith(".")
    if hidden:
        group = 2 if is_dir else 3
    else:
        group = 0 if is_dir else 1
    return group, name.lower()

items = []
truncated = False
max_results = 180
max_depth = 5 if query else 1
skip_deep_dirs = {
    ".cache",
    ".conda",
    ".git",
    ".local",
    ".npm",
    ".nv",
    ".nvm",
    ".vscode-server",
    "__pycache__",
    "node_modules",
}
if query:
    find_args = ["find", str(p), "-mindepth", "1", "-maxdepth", str(max_depth)]
    prune_parts = []
    for name in sorted(skip_deep_dirs):
        prune_parts.extend(["-name", name, "-o"])
    if prune_parts:
        prune_parts.pop()
        find_args.extend(["(", *prune_parts, ")", "-prune", "-o"])
    find_args.extend(["-iname", f"*{query}*", "-printf", "%y\t%s\t%T@\t%p\0"])
    try:
        proc = subprocess.run(find_args, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8)
        if proc.returncode not in (0, 1):
            raise RuntimeError(proc.stderr.decode("utf-8", "replace").strip())
        records = proc.stdout.decode("utf-8", "surrogateescape").split("\0")
        for record in records:
            if not record:
                continue
            parts = record.split("\t", 3)
            if len(parts) != 4:
                continue
            items.append(payload_from_find(parts[0], parts[1], parts[2], parts[3]))
            if len(items) >= max_results:
                truncated = True
                break
        items = sorted(items, key=find_sort_key)
        print(json.dumps({
            "ok": True,
            "error": "",
            "path": str(p),
            "parent": str(p.parent if p.parent != p and inside_home(p.parent) else home),
            "home": str(home),
            "query": query,
            "is_dir": True,
            "items": items,
            "truncated": truncated,
        }))
        raise SystemExit
    except Exception:
        items = []
        truncated = False

queue = [(p, 0)]
while queue:
    current, depth = queue.pop(0)
    try:
        entries = sorted(os.scandir(current), key=hidden_last_sort_key)
    except OSError:
        continue

    for entry in entries:
        name_l = entry.name.lower()
        try:
            is_dir = entry.is_dir(follow_symlinks=False)
            is_link = entry.is_symlink()
        except OSError:
            is_dir = False
            is_link = False

        if not query or query in name_l:
            items.append(entry_payload(entry))
            if len(items) >= max_results:
                truncated = True
                queue = []
                break

        if (
            query
            and is_dir
            and not is_link
            and depth + 1 < max_depth
            and entry.name not in skip_deep_dirs
        ):
            queue.append((pathlib.Path(entry.path), depth + 1))

print(json.dumps({
    "ok": True,
    "error": "",
    "path": str(p),
    "parent": str(p.parent if p.parent != p and inside_home(p.parent) else home),
    "home": str(home),
    "query": query,
    "is_dir": True,
    "items": items,
    "truncated": truncated,
}))
"""
    command = [
        "bash",
        "-lc",
        f"PATH_IN={shlex.quote(raw_path or '~')} QUERY_IN={shlex.quote(query or '')} python3 - <<'PY'\n{script}\nPY",
    ]
    rc, out, err = _run(command, timeout=12)
    if rc != 0:
        return {"ok": False, "error": err or out or "Path lookup failed.", "items": []}
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {"ok": False, "error": "Invalid JSON response from remote lookup.", "items": []}


def _fs_payload(raw_path: str, query: str) -> dict:
    if _session_public().get("token"):
        return _remote_fs_payload(raw_path, query)

    return {
        "ok": False,
        "error": "SSH session required for the Apuana path browser.",
        "path": "",
        "parent": "",
        "home": "",
        "query": query,
        "is_dir": False,
        "items": [],
        "truncated": False,
    }
