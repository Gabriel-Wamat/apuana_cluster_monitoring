import time
from pathlib import PurePosixPath

from .runtime import _run, _session_public
from .slurm import _human_size
from .transfers import _normalize_remote_path

def _normalize_remote_folder(raw_path: str, remote_home: str) -> tuple[str, str]:
    value = (raw_path or "").strip() or remote_home
    normalized, err = _normalize_remote_path(value, remote_home, False)
    if err:
        return "", err
    return normalized.rstrip("/") or "/", ""


def _remote_parent(path: str, home: str) -> str:
    current = PurePosixPath(path or home)
    root = PurePosixPath(home)
    try:
        current.relative_to(root)
    except ValueError:
        return root.as_posix()
    parent = current.parent
    try:
        parent.relative_to(root)
        return parent.as_posix()
    except ValueError:
        return root.as_posix()


def _log_files_payload(query: str = "", folder: str = "", mode: str = "folders") -> dict:
    session = _session_public()
    home = session.get("home") or ""
    if not session.get("token") or not home:
        return {"ok": False, "error": "SSH session required.", "mode": mode, "home": "", "folder": "", "folders": [], "items": []}

    target_folder, folder_err = _normalize_remote_folder(folder, home)
    if folder_err:
        return {"ok": False, "error": folder_err, "mode": mode, "home": home, "folder": home, "folders": [], "items": []}

    mode = "logs" if mode == "logs" else "folders"
    if mode == "folders":
        target_folder = home

    script = r'''
mode="$1"
folder="$2"
if [ -z "$folder" ] || [ ! -d "$folder" ]; then
  exit 2
fi
if [ "$mode" = "folders" ]; then
  find "$folder" -mindepth 1 -maxdepth 1 -type d -printf 'DIR|%T@|%p\n' 2>/dev/null | sort -t'|' -k2,2nr | head -200
else
  find "$folder" -maxdepth 1 -type f \( -name '*.out' -o -name '*.err' \) -printf 'FILE|%T@|%s|%p\n' 2>/dev/null | sort -t'|' -k2,2nr | head -300
fi
'''
    rc, out, err = _run(["bash", "-lc", script, "apuana-log-files", mode, target_folder], timeout=30)
    if rc != 0:
        return {
            "ok": False,
            "error": err or out or "Could not list log files.",
            "mode": mode,
            "home": home,
            "folder": target_folder,
            "parent": _remote_parent(target_folder, home),
            "folders": [],
            "items": [],
        }

    folders = []
    items = []
    normalized_query = query.lower()
    for line in out.splitlines():
        parts = line.split("|", 3)
        kind_tag = parts[0] if parts else ""
        if kind_tag == "DIR" and len(parts) >= 3:
            _, ts_raw, path = parts[:3]
            if not path.startswith(home + "/") and path != home:
                continue
            try:
                mtime = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(float(ts_raw)))
            except ValueError:
                mtime = ""
            folders.append({
                "kind": "folder",
                "path": path,
                "name": PurePosixPath(path).name,
                "mtime": mtime,
            })
            continue

        if kind_tag != "FILE" or len(parts) < 4:
            continue
        _, ts_raw, size_raw, path = parts[:4]
        if not path.startswith(home + "/") and path != home:
            continue
        if normalized_query and normalized_query not in path.lower():
            continue
        try:
            size = int(size_raw)
        except ValueError:
            size = 0
        try:
            mtime = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(float(ts_raw)))
        except ValueError:
            mtime = ""
        suffix = PurePosixPath(path).suffix.lower()
        if suffix in (".out", ".stdout"):
            kind = "stdout"
        elif suffix in (".err", ".stderr"):
            kind = "stderr"
        else:
            kind = "log"
        items.append({
            "kind": kind,
            "path": path,
            "name": PurePosixPath(path).name,
            "size": size,
            "size_human": _human_size(size),
            "mtime": mtime,
        })

    return {
        "ok": True,
        "error": "",
        "mode": mode,
        "home": home,
        "folder": target_folder,
        "parent": _remote_parent(target_folder, home),
        "query": query,
        "folders": folders,
        "items": items,
    }
