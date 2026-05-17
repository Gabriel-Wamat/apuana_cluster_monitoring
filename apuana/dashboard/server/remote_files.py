import posixpath
import shlex
import stat
import time
from pathlib import PurePosixPath
from typing import Optional

from .runtime import _connect_ssh, _run, _session, _session_client, _session_lock, _session_public

EDIT_MAX_BYTES = 1024 * 1024


def _size_human(n: int) -> str:
    units = ("B", "KiB", "MiB", "GiB", "TiB")
    value = float(max(n, 0))
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{n} B"


def _ensure_client():
    session = _session_client()
    if not session.get("token"):
        raise RuntimeError("SSH login required.")
    client = session.get("client")
    transport = client.get_transport() if client else None
    if client is None or transport is None or not transport.is_active():
        client = _connect_ssh(session["host"], session["login"], session["password"])
        with _session_lock:
            _session["client"] = client
    return client, session


def _remote_home(session: Optional[dict] = None) -> str:
    source = session or _session_public()
    login = source.get("login") or ""
    return (source.get("home") or f"/home/CIN/{login}").rstrip("/") or "/"


def _safe_remote_path(raw_path: str, *, allow_home: bool = True) -> tuple[str, str]:
    session = _session_public()
    if not session.get("token"):
        return "", "SSH login required."
    home = _remote_home(session)
    value = (raw_path or "").strip()
    if not value or value == "~":
        path = home
    elif value.startswith("~/"):
        path = posixpath.join(home, value[2:])
    elif value.startswith("/"):
        path = value
    else:
        path = posixpath.join(home, value)

    normalized = posixpath.normpath(path)
    home_norm = posixpath.normpath(home)
    if normalized != home_norm and not normalized.startswith(home_norm + "/"):
        return "", "Access denied: only paths inside your home directory are allowed."
    if not allow_home and normalized == home_norm:
        return "", "Refusing to modify your home directory itself."
    return normalized, ""


def _entry_payload(sftp, path: str, attr) -> dict:
    is_dir = stat.S_ISDIR(attr.st_mode)
    is_file = stat.S_ISREG(attr.st_mode)
    kind = "directory" if is_dir else "file" if is_file else "other"
    return {
        "name": PurePosixPath(path).name or path,
        "path": path,
        "kind": kind,
        "is_dir": is_dir,
        "is_file": is_file,
        "size": int(attr.st_size or 0),
        "size_human": "" if is_dir else _size_human(int(attr.st_size or 0)),
        "mtime_epoch": int(attr.st_mtime or 0),
        "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(attr.st_mtime or 0)),
        "child_count": None,
    }


def _entry_payload_from_find(path: str, type_char: str, size: str, mtime: str) -> dict:
    is_dir = type_char == "d"
    is_file = type_char == "f"
    kind = "directory" if is_dir else "file" if is_file else "other"
    try:
        size_value = int(float(size or 0))
    except ValueError:
        size_value = 0
    try:
        mtime_value = int(float(mtime or 0))
    except ValueError:
        mtime_value = 0
    return {
        "name": PurePosixPath(path).name or path,
        "path": path,
        "kind": kind,
        "is_dir": is_dir,
        "is_file": is_file,
        "size": size_value,
        "size_human": "" if is_dir else _size_human(size_value),
        "mtime_epoch": mtime_value,
        "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime_value or 0)),
        "child_count": None,
    }


def _hidden_last_sort_key(name: str, is_dir: bool) -> tuple[int, str]:
    hidden = str(name or "").startswith(".")
    if hidden:
        group = 2 if is_dir else 3
    else:
        group = 0 if is_dir else 1
    return group, str(name or "").lower()


def _item_sort_key(item: dict) -> tuple[int, str]:
    return _hidden_last_sort_key(str(item.get("name") or ""), bool(item.get("is_dir")))


def _sftp_attr_sort_key(attr) -> tuple[int, str]:
    return _hidden_last_sort_key(attr.filename, stat.S_ISDIR(attr.st_mode))


def _period_cutoff(period: str) -> Optional[int]:
    now = int(time.time())
    if period == "today":
        local = time.localtime(now)
        start = time.mktime((local.tm_year, local.tm_mon, local.tm_mday, 0, 0, 0, local.tm_wday, local.tm_yday, local.tm_isdst))
        return int(start)
    if period == "7d":
        return now - 7 * 24 * 60 * 60
    if period == "30d":
        return now - 30 * 24 * 60 * 60
    return None


def _find_entries(raw_output: str) -> list[dict]:
    parts = raw_output.split("\0")
    if parts and parts[-1] == "":
        parts.pop()
    entries = []
    for index in range(0, len(parts), 4):
        chunk = parts[index:index + 4]
        if len(chunk) != 4:
            continue
        type_char, size, mtime, path = chunk
        entries.append(_entry_payload_from_find(path, type_char, size, mtime))
    return entries


def _explorer_payload_shell(path: str, period: str, home: str) -> dict:
    cutoff = _period_cutoff(period)
    script = f"""
set -euo pipefail
target={shlex.quote(path)}
if [ ! -e "$target" ] && [ ! -L "$target" ]; then
  echo "Remote path not found." >&2
  exit 66
fi
if [ -d "$target" ] && [ ! -L "$target" ]; then
  find "$target" -mindepth 1 -maxdepth 1 -printf '%y\\0%s\\0%T@\\0%p\\0'
else
  find "$target" -maxdepth 0 -printf '%y\\0%s\\0%T@\\0%p\\0'
fi
"""
    rc, out, err = _run(["bash", "-lc", script], timeout=12)
    if rc != 0:
        return {"ok": False, "error": err or out or "Could not list remote directory.", "items": []}
    items = _find_entries(out)
    is_single_file = len(items) == 1 and items[0].get("path") == path and not items[0].get("is_dir")
    if not is_single_file and cutoff is not None:
        items = [item for item in items if int(item.get("mtime_epoch") or 0) >= cutoff]
    items.sort(key=_item_sort_key)
    return {
        "ok": True,
        "error": "",
        "path": posixpath.dirname(path) if is_single_file else path,
        "parent": posixpath.dirname(path) if path.rstrip("/") != home else home,
        "home": home,
        "period": period,
        "items": items,
    }


def _explorer_payload(raw_path: str, period: str) -> dict:
    path, error = _safe_remote_path(raw_path)
    if error:
        return {"ok": False, "error": error, "items": []}
    cutoff = _period_cutoff(period)
    sftp = None
    try:
        client, session = _ensure_client()
        sftp = client.open_sftp()
        attr = sftp.stat(path)
        if not stat.S_ISDIR(attr.st_mode):
            parent = posixpath.dirname(path)
            return {
                "ok": True,
                "path": parent,
                "home": _remote_home(session),
                "period": period,
                "items": [_entry_payload(sftp, path, attr)],
            }
        items = []
        for entry in sorted(sftp.listdir_attr(path), key=_sftp_attr_sort_key):
            child = posixpath.join(path, entry.filename)
            if cutoff is not None and int(entry.st_mtime or 0) < cutoff:
                continue
            items.append(_entry_payload(sftp, child, entry))
        return {
            "ok": True,
            "error": "",
            "path": path,
            "parent": posixpath.dirname(path) if path.rstrip("/") != _remote_home(session) else _remote_home(session),
            "home": _remote_home(session),
            "period": period,
            "items": items,
        }
    except Exception as exc:
        shell_payload = _explorer_payload_shell(path, period, _remote_home())
        if shell_payload.get("ok"):
            return shell_payload
        return {"ok": False, "error": f"Could not list remote directory: {shell_payload.get('error') or exc}", "items": []}
    finally:
        if sftp is not None:
            try:
                sftp.close()
            except Exception:
                pass


def _read_remote_file(raw_path: str) -> dict:
    path, error = _safe_remote_path(raw_path)
    if error:
        return {"ok": False, "error": error}
    sftp = None
    try:
        client, _ = _ensure_client()
        sftp = client.open_sftp()
        attr = sftp.stat(path)
        if stat.S_ISDIR(attr.st_mode):
            return {"ok": False, "error": "Cannot edit a directory."}
        if int(attr.st_size or 0) > EDIT_MAX_BYTES:
            return {"ok": False, "error": f"File is too large to edit in the browser ({_size_human(attr.st_size)})."}
        with sftp.file(path, "rb") as remote_file:
            raw = remote_file.read()
        return {
            "ok": True,
            "path": path,
            "name": PurePosixPath(path).name,
            "content": raw.decode("utf-8", errors="replace"),
            "size": len(raw),
        }
    except Exception as exc:
        return {"ok": False, "error": f"Could not read remote file: {exc}"}
    finally:
        if sftp is not None:
            try:
                sftp.close()
            except Exception:
                pass


def _write_remote_file(raw_path: str, content: str) -> dict:
    path, error = _safe_remote_path(raw_path, allow_home=False)
    if error:
        return {"ok": False, "error": error}
    sftp = None
    try:
        client, _ = _ensure_client()
        sftp = client.open_sftp()
        try:
            attr = sftp.stat(path)
            if stat.S_ISDIR(attr.st_mode):
                return {"ok": False, "error": "Cannot save text over a directory."}
        except OSError:
            pass
        data = str(content or "").encode("utf-8")
        if len(data) > EDIT_MAX_BYTES:
            return {"ok": False, "error": f"Content is too large to save from the browser ({_size_human(len(data))})."}
        with sftp.file(path, "wb") as remote_file:
            remote_file.write(data)
        return {"ok": True, "path": path, "bytes": len(data)}
    except Exception as exc:
        return {"ok": False, "error": f"Could not save remote file: {exc}"}
    finally:
        if sftp is not None:
            try:
                sftp.close()
            except Exception:
                pass


def _delete_remote_path(raw_path: str) -> dict:
    path, error = _safe_remote_path(raw_path, allow_home=False)
    if error:
        return {"ok": False, "error": error}
    home = _remote_home()
    script = f"""
set -euo pipefail
target={shlex.quote(path)}
home={shlex.quote(home)}
case "$target" in
  "$home"|"$home/"|"")
    echo "Refusing to modify your home directory itself." >&2
    exit 64
    ;;
  "$home"/*)
    ;;
  *)
    echo "Access denied: only paths inside your home directory are allowed." >&2
    exit 65
    ;;
esac

if [ ! -e "$target" ] && [ ! -L "$target" ]; then
  printf 'missing\\n'
  exit 0
fi

if [ -d "$target" ] && [ ! -L "$target" ]; then
  kind=directory
else
  kind=file
fi

rm -rf -- "$target"
printf '%s\\n' "$kind"
"""
    rc, out, err = _run(["bash", "-lc", script], timeout=90)
    if rc != 0:
        return {"ok": False, "error": err or out or "Could not delete remote path."}
    return {"ok": True, "path": path, "kind": (out or "unknown").splitlines()[-1]}
