import base64
import posixpath
import shlex
import stat
import time
from pathlib import PurePosixPath
from threading import Lock
from typing import Optional

from .remote_files import _delete_remote_path, _ensure_client, _remote_home, _safe_remote_path, _size_human
from .runtime import _run, _run_with_stdin, _session_public

CODE_MAX_BYTES = 768 * 1024
MAX_RESULTS = 180
MAX_SEARCH_DEPTH = 5
MAX_TREE_DEPTH = 8
MAX_TREE_ENTRIES = 1400
MIN_SEARCH_CHARS = 2
CACHE_TTL_SECONDS = 10

CODE_EXTENSIONS = {
    ".bash",
    ".c",
    ".cc",
    ".conf",
    ".cpp",
    ".css",
    ".cu",
    ".h",
    ".hpp",
    ".html",
    ".ipynb",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".lua",
    ".m",
    ".md",
    ".py",
    ".r",
    ".rb",
    ".rs",
    ".sh",
    ".sql",
    ".tex",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}

CODE_FILENAMES = {
    ".gitignore",
    "dockerfile",
    "makefile",
    "requirements.txt",
    "environment.yml",
    "readme",
    "readme.md",
}

SKIP_DIRS = {
    ".cache",
    ".claude",
    ".codex",
    ".conda",
    ".config",
    ".copilot",
    ".cursor",
    ".cursor-server",
    ".dotnet",
    ".git",
    ".ipynb_checkpoints",
    ".local",
    ".mypy_cache",
    ".nvm",
    ".pytest_cache",
    ".ruff_cache",
    ".ssh",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "env",
    "envs",
    "node_modules",
    "venv",
}

SKIP_DIR_SUFFIXES = ("_env",)

SENSITIVE_FILENAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".netrc",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
}

SENSITIVE_SUFFIXES = (".key", ".pem", ".p12", ".pfx")

_cache_lock = Lock()
_payload_cache: dict[tuple[str, ...], tuple[float, dict]] = {}


def _cache_get(key: tuple[str, ...]) -> Optional[dict]:
    with _cache_lock:
        cached = _payload_cache.get(key)
        if not cached:
            return None
        created, payload = cached
        if time.time() - created > CACHE_TTL_SECONDS:
            _payload_cache.pop(key, None)
            return None
        return payload


def _cache_set(key: tuple[str, ...], payload: dict) -> dict:
    with _cache_lock:
        _payload_cache[key] = (time.time(), payload)
        if len(_payload_cache) > 96:
            oldest = sorted(_payload_cache.items(), key=lambda item: item[1][0])[:24]
            for old_key, _ in oldest:
                _payload_cache.pop(old_key, None)
    return payload


def _cache_clear_code_file_context() -> None:
    with _cache_lock:
        for key in list(_payload_cache.keys()):
            if key and key[0] in {"folders", "list", "tree"}:
                _payload_cache.pop(key, None)


def _is_code_file(name: str) -> bool:
    lower = name.lower()
    suffix = PurePosixPath(lower).suffix
    return suffix in CODE_EXTENSIONS or lower in CODE_FILENAMES


def _skip_dir(name: str) -> bool:
    lower = name.lower()
    return lower in SKIP_DIRS or any(lower.endswith(suffix) for suffix in SKIP_DIR_SUFFIXES)


def _skip_file(name: str) -> bool:
    lower = name.lower()
    return lower in SENSITIVE_FILENAMES or any(lower.endswith(suffix) for suffix in SENSITIVE_SUFFIXES)


def _find_code_file_clause() -> str:
    extension_patterns = [f"-iname {shlex.quote('*' + ext)}" for ext in sorted(CODE_EXTENSIONS)]
    filename_patterns = [f"-iname {shlex.quote(name)}" for name in sorted(CODE_FILENAMES)]
    return " -o ".join(extension_patterns + filename_patterns)


def _language_for(name: str) -> str:
    lower = name.lower()
    suffix = PurePosixPath(lower).suffix
    if suffix == ".py":
        return "python"
    if suffix in {".js", ".jsx"}:
        return "javascript"
    if suffix in {".ts", ".tsx"}:
        return "typescript"
    if suffix in {".sh", ".bash"}:
        return "shell"
    if suffix in {".yaml", ".yml"}:
        return "yaml"
    if suffix == ".json":
        return "json"
    if suffix == ".md":
        return "markdown"
    if suffix == ".tex":
        return "latex"
    if suffix == ".html":
        return "html"
    if suffix == ".css":
        return "css"
    if suffix in {".c", ".cc", ".cpp", ".h", ".hpp", ".cu"}:
        return "cpp"
    if lower == "makefile":
        return "makefile"
    if lower == "dockerfile":
        return "dockerfile"
    return "text"


def _entry_payload(path: str, attr) -> dict:
    is_dir = stat.S_ISDIR(attr.st_mode)
    is_file = stat.S_ISREG(attr.st_mode)
    name = PurePosixPath(path).name or path
    return {
        "name": name,
        "path": path,
        "kind": "directory" if is_dir else "file" if is_file else "other",
        "is_dir": is_dir,
        "is_file": is_file,
        "language": "" if is_dir else _language_for(name),
        "size": int(attr.st_size or 0),
        "size_human": "" if is_dir else _size_human(int(attr.st_size or 0)),
        "mtime_epoch": int(attr.st_mtime or 0),
        "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(attr.st_mtime or 0)),
    }


def _entry_payload_from_find(path: str, type_code: str, size: str, mtime: str) -> dict:
    is_dir = type_code == "d"
    is_file = type_code == "f"
    name = PurePosixPath(path).name or path
    try:
        size_int = int(float(size or 0))
    except ValueError:
        size_int = 0
    try:
        mtime_epoch = int(float(mtime or 0))
    except ValueError:
        mtime_epoch = 0
    return {
        "name": name,
        "path": path,
        "kind": "directory" if is_dir else "file" if is_file else "other",
        "is_dir": is_dir,
        "is_file": is_file,
        "language": "" if is_dir else _language_for(name),
        "size": size_int,
        "size_human": "" if is_dir else _size_human(size_int),
        "mtime_epoch": mtime_epoch,
        "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(mtime_epoch)),
    }


def _tree_entry_from_find(root: str, path: str, type_code: str, size: str, mtime: str) -> dict:
    payload = _entry_payload_from_find(path, type_code, size, mtime)
    rel = posixpath.relpath(path, root)
    payload["path"] = "" if rel == "." else rel
    payload["abs_path"] = path
    payload["kind"] = "dir" if payload["is_dir"] else "file" if payload["is_file"] else "other"
    return payload


def _safe_project_path(raw_path: str) -> tuple[str, str]:
    path, error = _safe_remote_path(raw_path)
    if error:
        return "", error
    return path, ""


def _safe_code_child_name(raw_name: str) -> tuple[str, str]:
    name = (raw_name or "").strip()
    if not name:
        return "", "Name is required."
    if name in {".", ".."} or "/" in name or "\\" in name or "\0" in name:
        return "", "Use only a file or folder name, not a path."
    return name, ""


def _code_projects_payload() -> dict:
    try:
        session = _session_public()
        if not session.get("token"):
            return {"ok": False, "error": "SSH login required.", "projects": []}
        home = _remote_home(session)
        cache_key = ("projects", session.get("login", ""), home)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        return _cache_set(cache_key, {"ok": True, "home": home, "projects": [{"name": "Home", "path": home}]})
    except Exception as exc:
        return {"ok": False, "error": f"Could not list code projects: {exc}", "projects": []}


def _code_folder_payload(raw_path: str) -> dict:
    path, error = _safe_project_path(raw_path or "~")
    if error:
        return {"ok": False, "error": error, "items": []}
    try:
        session = _session_public()
        if not session.get("token"):
            return {"ok": False, "error": "SSH login required.", "items": []}
        home = _remote_home(session)
        cache_key = ("folders", session.get("login", ""), path)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached
        script = f"""
set -e
path={shlex.quote(path)}
if [ ! -d "$path" ]; then exit 4; fi
find "$path" -mindepth 1 -maxdepth 1 \\
  \\( -type d -printf '%y\\t%p\\t%s\\t%T@\\n' \\) -o \\
  \\( -type f -printf '%y\\t%p\\t%s\\t%T@\\n' \\) \\
  2>/dev/null | head -n {MAX_RESULTS * 2}
"""
        rc, out, err = _run(["bash", "-lc", script], timeout=8)
        if rc != 0:
            return {"ok": False, "error": err or "Could not list folders.", "items": []}
        items = []
        for raw_line in out.splitlines():
            parts = raw_line.split("\t", 3)
            if len(parts) != 4:
                continue
            type_code, child_path, size, mtime = parts
            name = PurePosixPath(child_path).name
            is_dir = type_code == "d"
            if not is_dir and (_skip_file(name) or not _is_code_file(name)):
                continue
            payload = _entry_payload_from_find(child_path, type_code, size, mtime)
            payload["abs_path"] = child_path
            payload["kind"] = "dir" if is_dir else "file"
            items.append(payload)
        items.sort(key=lambda item: (not item["is_dir"], item["name"].lower()))
        return _cache_set(cache_key, {
            "ok": True,
            "home": home,
            "path": path,
            "parent": posixpath.dirname(path) if path != home else home,
            "items": items,
        })
    except Exception as exc:
        return {"ok": False, "error": f"Could not list code folders: {exc}", "items": []}


def _code_tree_payload(raw_root: str) -> dict:
    root, error = _safe_project_path(raw_root or "~")
    if error:
        return {"ok": False, "error": error, "entries": []}
    cache_key = ("tree", root)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    prune_names = " -o ".join(f"-name {shlex.quote(name)}" for name in sorted(SKIP_DIRS))
    prune_suffixes = " -o ".join(f"-name {shlex.quote('*' + suffix)}" for suffix in SKIP_DIR_SUFFIXES)
    prune_clause = " -o ".join(part for part in (prune_names, prune_suffixes) if part)
    code_file_clause = _find_code_file_clause()
    script = f"""
set -e
root={shlex.quote(root)}
if [ ! -d "$root" ]; then exit 4; fi
{{
  find "$root" \\
    -mindepth 1 \\
    -maxdepth 1 \\
    \\( -type d -printf '%y\\t%p\\t%s\\t%T@\\n' \\) -o \\
    \\( -type f \\( {code_file_clause} \\) -printf '%y\\t%p\\t%s\\t%T@\\n' \\)
  find "$root" \\
    -mindepth 2 \\
    -maxdepth {MAX_TREE_DEPTH} \\
    \\( -type d \\( {prune_clause} \\) -prune \\) -o \\
    \\( -type d -printf '%y\\t%p\\t%s\\t%T@\\n' \\) -o \\
    \\( -type f \\( {code_file_clause} \\) -printf '%y\\t%p\\t%s\\t%T@\\n' \\)
}} 2>/dev/null | head -n {MAX_TREE_ENTRIES * 4}
"""
    try:
        session = _session_public()
        if not session.get("token"):
            return {"ok": False, "error": "SSH login required.", "entries": []}
        home = _remote_home(session)
        rc, out, err = _run(["bash", "-lc", script], timeout=12)
        if rc != 0:
            return {"ok": False, "error": err or "Could not list code tree.", "entries": []}
        entries = []
        seen = set()
        for raw_line in out.splitlines():
            parts = raw_line.split("\t", 3)
            if len(parts) != 4:
                continue
            type_code, path, size, mtime = parts
            if path in seen or type_code not in {"d", "f"}:
                continue
            seen.add(path)
            name = PurePosixPath(path).name
            if type_code == "d":
                if _skip_dir(name):
                    continue
            elif _skip_file(name) or not _is_code_file(name):
                continue
            entries.append(_tree_entry_from_find(root, path, type_code, size, mtime))
            if len(entries) >= MAX_TREE_ENTRIES:
                break
        entries.sort(key=lambda item: (item["path"].count("/"), item["path"].lower()))
        return _cache_set(cache_key, {
            "ok": True,
            "home": home,
            "root": root,
            "entries": entries,
            "truncated": len(entries) >= MAX_TREE_ENTRIES,
        })
    except Exception as exc:
        return {"ok": False, "error": f"Could not list code tree: {exc}", "entries": []}


def _search_code_items(project: str, query_l: str) -> tuple[list[dict], bool]:
    prune_names = " -o ".join(f"-name {shlex.quote(name)}" for name in sorted(SKIP_DIRS))
    prune_suffixes = " -o ".join(f"-name {shlex.quote('*' + suffix)}" for suffix in SKIP_DIR_SUFFIXES)
    prune_clause = " -o ".join(part for part in (prune_names, prune_suffixes) if part)
    script = f"""
set -e
root={shlex.quote(project)}
needle={shlex.quote(query_l)}
find "$root" \\
  -maxdepth {MAX_SEARCH_DEPTH} \\
  \\( -type d \\( {prune_clause} \\) -prune \\) -o \\
  \\( \\( -type d -o -type f \\) -iname "*$needle*" -printf '%y\\t%p\\t%s\\t%T@\\n' \\) \\
  2>/dev/null | head -n {MAX_RESULTS * 4}
"""
    rc, out, _ = _run(["bash", "-lc", script], timeout=8)
    if rc != 0:
        return [], False
    items = []
    seen = set()
    for raw_line in out.splitlines():
        parts = raw_line.split("\t", 3)
        if len(parts) != 4:
            continue
        type_code, path, size, mtime = parts
        if path in seen:
            continue
        seen.add(path)
        name = PurePosixPath(path).name
        if type_code == "f" and (_skip_file(name) or not _is_code_file(name)):
            continue
        if type_code not in {"d", "f"}:
            continue
        items.append(_entry_payload_from_find(path, type_code, size, mtime))
        if len(items) >= MAX_RESULTS:
            break
    items.sort(key=lambda item: (not item["is_dir"], item["path"].lower()))
    return items, len(items) >= MAX_RESULTS


def _code_list_payload(raw_project: str, raw_path: str, query: str) -> dict:
    project, error = _safe_project_path(raw_project or raw_path or "~")
    if error:
        return {"ok": False, "error": error, "items": []}
    path, error = _safe_project_path(raw_path or project)
    if error:
        return {"ok": False, "error": error, "items": []}
    if path != project and not path.startswith(project.rstrip("/") + "/"):
        path = project

    query_l = (query or "").strip().lower()
    try:
        session = _session_public()
        if not session.get("token"):
            return {"ok": False, "error": "SSH login required.", "items": []}
        home = _remote_home(session)
        if query_l and len(query_l) < MIN_SEARCH_CHARS:
            return {
                "ok": True,
                "home": home,
                "project": project,
                "path": path,
                "parent": posixpath.dirname(path) if path != project else project,
                "query": query,
                "items": [],
                "truncated": False,
                "hint": f"Type at least {MIN_SEARCH_CHARS} characters to search.",
            }

        cache_key = ("list", session.get("login", ""), project, path, query_l)
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        items = []
        if query_l:
            items, truncated = _search_code_items(project, query_l)
            return _cache_set(cache_key, {
                "ok": True,
                "home": home,
                "project": project,
                "path": path,
                "parent": posixpath.dirname(path) if path != project else project,
                "query": query,
                "items": items,
                "truncated": truncated,
            })
        script = f"""
set -e
path={shlex.quote(path)}
if [ ! -d "$path" ]; then exit 4; fi
find "$path" -mindepth 1 -maxdepth 1 \\
  \\( -type d -printf '%y\\t%p\\t%s\\t%T@\\n' \\) -o \\
  \\( -type f -printf '%y\\t%p\\t%s\\t%T@\\n' \\) \\
  2>/dev/null | head -n {MAX_RESULTS * 2}
"""
        rc, out, err = _run(["bash", "-lc", script], timeout=8)
        if rc != 0:
            return {"ok": False, "error": err or "Could not list code files.", "items": []}
        for raw_line in out.splitlines():
            parts = raw_line.split("\t", 3)
            if len(parts) != 4:
                continue
            type_code, child_path, size, mtime = parts
            name = PurePosixPath(child_path).name
            if type_code == "d":
                if _skip_dir(name):
                    continue
            elif type_code == "f":
                if _skip_file(name) or not _is_code_file(name):
                    continue
            else:
                continue
            items.append(_entry_payload_from_find(child_path, type_code, size, mtime))
            if len(items) >= MAX_RESULTS:
                break
        items.sort(key=lambda item: (not item["is_dir"], item["path"].lower()))
        return _cache_set(cache_key, {
            "ok": True,
            "home": home,
            "project": project,
            "path": path,
            "parent": posixpath.dirname(path) if path != project else project,
            "query": query,
            "items": items,
            "truncated": len(items) >= MAX_RESULTS,
        })
    except Exception as exc:
        return {"ok": False, "error": f"Could not list code files: {exc}", "items": []}


def _code_file_payload(raw_path: str) -> dict:
    path, error = _safe_project_path(raw_path)
    if error:
        return {"ok": False, "error": error}
    name = PurePosixPath(path).name
    if _skip_file(name):
        return {"ok": False, "error": "This file is protected and cannot be opened in the code viewer."}
    if not _is_code_file(name):
        return {"ok": False, "error": "This file type is not configured for the code viewer."}

    script = f"""
set -e
path={shlex.quote(path)}
if [ -d "$path" ]; then echo "Select a code file, not a folder." >&2; exit 3; fi
if [ ! -f "$path" ]; then echo "File no longer exists on Apuana." >&2; exit 4; fi
size=$(wc -c < "$path" | tr -d ' ')
if [ "${{size:-0}}" -gt {CODE_MAX_BYTES} ]; then echo "File is too large for the code viewer." >&2; exit 5; fi
lines=$(wc -l < "$path" | tr -d ' ')
printf '%s\\t%s\\n' "$size" "$lines"
base64 -w 0 "$path" 2>/dev/null || base64 "$path" | tr -d '\\n'
"""
    rc, out, err = _run(["bash", "-lc", script], timeout=10)
    if rc == 0 and out:
        header, _, encoded = out.partition("\n")
        try:
            size_raw, lines_raw = header.split("\t", 1)
            raw = base64.b64decode(encoded.encode("ascii"), validate=False)
            content = raw.decode("utf-8", errors="replace")
            return {
                "ok": True,
                "name": name,
                "path": path,
                "language": _language_for(name),
                "size": int(size_raw or len(raw)),
                "size_human": _size_human(int(size_raw or len(raw))),
                "lines": int(lines_raw or (content.count("\n") + 1 if content else 0)),
                "content": content,
            }
        except Exception:
            pass

    sftp = None
    try:
        client, _ = _ensure_client()
        sftp = client.open_sftp()
        attr = sftp.stat(path)
        if stat.S_ISDIR(attr.st_mode):
            return {"ok": False, "error": "Select a code file, not a folder."}
        if int(attr.st_size or 0) > CODE_MAX_BYTES:
            return {"ok": False, "error": f"File is too large for the code viewer ({_size_human(attr.st_size)})."}
        with sftp.file(path, "rb") as remote_file:
            raw = remote_file.read()
        content = raw.decode("utf-8", errors="replace")
        return {
            "ok": True,
            "name": name,
            "path": path,
            "language": _language_for(name),
            "size": len(raw),
            "size_human": _size_human(len(raw)),
            "lines": content.count("\n") + 1 if content else 0,
            "content": content,
        }
    except Exception as exc:
        return {"ok": False, "error": f"Could not read code file: {err or exc}"}
    finally:
        if sftp is not None:
            try:
                sftp.close()
            except Exception:
                pass


def _code_file_save_payload(raw_path: str, content: str) -> dict:
    path, error = _safe_remote_path(raw_path, allow_home=False)
    if error:
        return {"ok": False, "error": error}
    name = PurePosixPath(path).name
    if _skip_file(name):
        return {"ok": False, "error": "This file is protected and cannot be saved in the code viewer."}
    if not _is_code_file(name):
        return {"ok": False, "error": "This file type is not configured for the code viewer."}

    data = str(content or "").encode("utf-8")
    if len(data) > CODE_MAX_BYTES:
        return {"ok": False, "error": f"Content is too large to save from the code viewer ({_size_human(len(data))})."}

    script = f"""
set -e
path={shlex.quote(path)}
tmp="${{path}}.apuana-save-$$"
cleanup() {{ rm -f "$tmp"; }}
trap cleanup EXIT
if [ -d "$path" ]; then echo "Cannot save text over a directory." >&2; exit 4; fi
parent=$(dirname "$path")
if [ ! -d "$parent" ]; then echo "Parent directory does not exist on Apuana." >&2; exit 5; fi
mode=""
if [ -e "$path" ]; then mode=$(stat -c '%a' "$path" 2>/dev/null || true); fi
cat > "$tmp"
if [ -n "$mode" ]; then chmod "$mode" "$tmp" 2>/dev/null || true; fi
mv "$tmp" "$path"
trap - EXIT
wc -c < "$path" | tr -d ' '
"""
    rc, out, err = _run_with_stdin(["bash", "-lc", script], data, timeout=15)
    if rc == 0:
        _cache_clear_code_file_context()
        payload = _code_file_payload(path)
        if payload.get("ok"):
            payload["saved"] = True
            payload["bytes"] = int(out or len(data))
        return payload

    sftp = None
    tmp_path = ""
    try:
        client, _ = _ensure_client()
        sftp = client.open_sftp()
        attr = sftp.stat(path)
        if stat.S_ISDIR(attr.st_mode):
            return {"ok": False, "error": "Cannot save text over a directory."}

        tmp_path = f"{path}.apuana-save-{int(time.time() * 1000)}"
        with sftp.file(tmp_path, "wb") as remote_file:
            remote_file.write(data)

        mode = stat.S_IMODE(attr.st_mode)
        try:
            sftp.chmod(tmp_path, mode)
        except Exception:
            pass

        try:
            sftp.posix_rename(tmp_path, path)
        except Exception:
            sftp.remove(path)
            sftp.rename(tmp_path, path)
        tmp_path = ""

        _cache_clear_code_file_context()
        payload = _code_file_payload(path)
        if payload.get("ok"):
            payload["saved"] = True
            payload["bytes"] = len(data)
        return payload
    except FileNotFoundError:
        return {"ok": False, "error": "File no longer exists on Apuana."}
    except OSError as exc:
        return {"ok": False, "error": f"Could not save code file: {err or exc}"}
    except Exception as exc:
        return {"ok": False, "error": f"Could not save code file: {err or exc}"}
    finally:
        if sftp is not None:
            if tmp_path:
                try:
                    sftp.remove(tmp_path)
                except Exception:
                    pass
            try:
                sftp.close()
            except Exception:
                pass


def _code_create_payload(raw_parent: str, raw_name: str, raw_kind: str) -> dict:
    parent, error = _safe_project_path(raw_parent or "~")
    if error:
        return {"ok": False, "error": error}
    name, error = _safe_code_child_name(raw_name)
    if error:
        return {"ok": False, "error": error}

    kind = (raw_kind or "").strip().lower()
    is_dir = kind in {"dir", "directory", "folder"}
    if not is_dir and kind not in {"file", ""}:
        return {"ok": False, "error": "Create type must be file or folder."}
    if not is_dir and (_skip_file(name) or not _is_code_file(name)):
        return {"ok": False, "error": "Create a code/text file supported by the code workspace."}

    target = posixpath.normpath(posixpath.join(parent, name))
    safe_target, error = _safe_project_path(target)
    if error:
        return {"ok": False, "error": error}
    if posixpath.dirname(safe_target) != parent:
        return {"ok": False, "error": "Use only a file or folder name, not a path."}

    script = f"""
set -euo pipefail
parent={shlex.quote(parent)}
target={shlex.quote(safe_target)}
if [ ! -d "$parent" ]; then
  echo "Current folder no longer exists on Apuana." >&2
  exit 4
fi
if [ -e "$target" ] || [ -L "$target" ]; then
  echo "A file or folder with this name already exists." >&2
  exit 5
fi
if [ {1 if is_dir else 0} -eq 1 ]; then
  mkdir -- "$target"
else
  : > "$target"
fi
"""
    rc, out, err = _run(["bash", "-lc", script], timeout=10)
    if rc != 0:
        return {"ok": False, "error": err or out or "Could not create item on Apuana."}
    _cache_clear_code_file_context()
    return {
        "ok": True,
        "path": safe_target,
        "parent": parent,
        "name": name,
        "kind": "dir" if is_dir else "file",
    }


def _code_delete_payload(raw_path: str) -> dict:
    result = _delete_remote_path(raw_path)
    if result.get("ok"):
        _cache_clear_code_file_context()
    return result
