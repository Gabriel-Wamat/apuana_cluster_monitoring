import os
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

from .config import TRANSFER_HOST
from .runtime import _connect_ssh, _session, _session_client, _session_lock, _session_public

def _user_path(raw: str) -> Path:
    raw = (raw or "~").strip() or "~"
    expanded = os.path.expandvars(os.path.expanduser(raw))
    p = Path(expanded)
    if not p.is_absolute():
        p = Path.home() / p
    return p.resolve(strict=False)


def _within_home(path: Path, home: Path) -> bool:
    try:
        path.relative_to(home)
        return True
    except ValueError:
        return False


def _normalize_remote_path(raw_path: str, remote_home: str, include_contents: bool) -> tuple[str, str]:
    value = (raw_path or "").strip()
    if not value:
        return "", "Remote path is required."
    wants_directory = value.endswith("/")

    home = PurePosixPath(remote_home or "/")
    if value == "~":
        path = home
    elif value.startswith("~/"):
        path = home / value[2:]
    elif value.startswith("/"):
        path = PurePosixPath(value)
    else:
        path = home / value

    try:
        path.relative_to(home)
    except ValueError:
        return "", "Access denied: only paths inside your home directory are allowed."

    normalized = path.as_posix()
    if (include_contents or wants_directory) and not normalized.endswith("/"):
        normalized += "/"
    return normalized, ""


def _normalize_local_path(raw_path: str, include_contents: bool) -> tuple[str, str]:
    value = (raw_path or "").strip()
    if not value:
        return "", "Local path is required."
    expanded = os.path.expandvars(os.path.expanduser(value))
    local_path = Path(expanded)
    if not local_path.is_absolute():
        local_path = Path.home() / local_path
    normalized = str(local_path.resolve(strict=False))
    if include_contents and not normalized.endswith("/"):
        normalized += "/"
    return normalized, ""


def _ensure_session_ssh_client():
    session = _session_client()
    if not session.get("token"):
        raise RuntimeError("SSH login required before executing transfers.")
    client = session.get("client")
    transport = client.get_transport() if client else None
    if client is None or transport is None or not transport.is_active():
        client = _connect_ssh(session["host"], session["login"], session["password"])
        with _session_lock:
            _session["client"] = client
    return client, session


def _sftp_is_dir(sftp, remote_path: str) -> bool:
    try:
        mode = sftp.stat(remote_path).st_mode
        return stat.S_ISDIR(mode)
    except Exception:
        return False


def _sftp_mkdirs(sftp, remote_dir: str, home_root: str) -> None:
    target = PurePosixPath(remote_dir).as_posix()
    home = PurePosixPath(home_root).as_posix()
    if not target.startswith(home):
        raise RuntimeError("Access denied: remote destination must stay inside your home.")

    current = PurePosixPath(home)
    sftp.stat(current.as_posix())
    for part in PurePosixPath(target).parts[len(PurePosixPath(home).parts):]:
        current = current / part
        try:
            sftp.stat(current.as_posix())
        except IOError:
            sftp.mkdir(current.as_posix())


def _download_remote_tree(sftp, remote_path: str, local_path: Path) -> tuple[int, int]:
    files = 0
    dirs = 0
    local_path.mkdir(parents=True, exist_ok=True)
    dirs += 1
    for entry in sftp.listdir_attr(remote_path):
        child_remote = f"{remote_path.rstrip('/')}/{entry.filename}"
        child_local = local_path / entry.filename
        if stat.S_ISDIR(entry.st_mode):
            c_files, c_dirs = _download_remote_tree(sftp, child_remote, child_local)
            files += c_files
            dirs += c_dirs
        else:
            child_local.parent.mkdir(parents=True, exist_ok=True)
            sftp.get(child_remote, str(child_local))
            files += 1
    return files, dirs


def _upload_local_tree(sftp, local_path: Path, remote_path: str, home_root: str) -> tuple[int, int]:
    files = 0
    dirs = 0
    _sftp_mkdirs(sftp, remote_path, home_root)
    dirs += 1
    for child in local_path.iterdir():
        child_remote = f"{remote_path.rstrip('/')}/{child.name}"
        if child.is_dir():
            c_files, c_dirs = _upload_local_tree(sftp, child, child_remote, home_root)
            files += c_files
            dirs += c_dirs
        else:
            sftp.put(str(child), child_remote)
            files += 1
    return files, dirs


def _execute_transfer(mode: str, local_path: str, remote_path: str, include_contents: bool) -> dict:
    session = _session_public()
    login = session.get("login") or ""
    remote_home = session.get("home") or f"/home/CIN/{login}"
    if not login:
        return {"ok": False, "error": "SSH login required before executing transfers."}

    normalized_remote, remote_err = _normalize_remote_path(remote_path, remote_home, include_contents)
    if remote_err:
        return {"ok": False, "error": remote_err}
    normalized_local, local_err = _normalize_local_path(local_path, include_contents and mode == "upload")
    if local_err:
        return {"ok": False, "error": local_err}
    if mode not in {"upload", "download"}:
        return {"ok": False, "error": "Invalid transfer mode."}

    local_target = Path(os.path.expandvars(os.path.expanduser(normalized_local.rstrip("/")))).resolve(strict=False)

    try:
        client, active_session = _ensure_session_ssh_client()
        sftp = client.open_sftp()
    except Exception as exc:
        return {"ok": False, "error": f"Failed to open SFTP session: {exc}"}

    operation = f"sftp:{mode}"
    try:
        if mode == "download":
            if not _sftp_is_dir(sftp, normalized_remote):
                destination = local_target
                if destination.exists() and destination.is_dir():
                    destination = destination / PurePosixPath(normalized_remote).name
                destination.parent.mkdir(parents=True, exist_ok=True)
                sftp.get(normalized_remote.rstrip("/"), str(destination))
                summary = f"Downloaded file to {destination}"
                files = 1
                dirs = 0
            else:
                remote_dir = normalized_remote.rstrip("/")
                if include_contents:
                    base_local = local_target
                    base_local.mkdir(parents=True, exist_ok=True)
                    files = 0
                    dirs = 0
                    for entry in sftp.listdir_attr(remote_dir):
                        child_remote = f"{remote_dir}/{entry.filename}"
                        child_local = base_local / entry.filename
                        if stat.S_ISDIR(entry.st_mode):
                            c_files, c_dirs = _download_remote_tree(sftp, child_remote, child_local)
                            files += c_files
                            dirs += c_dirs
                        else:
                            child_local.parent.mkdir(parents=True, exist_ok=True)
                            sftp.get(child_remote, str(child_local))
                            files += 1
                    summary = f"Downloaded directory contents to {base_local}"
                else:
                    base_local = local_target / PurePosixPath(remote_dir).name
                    files, dirs = _download_remote_tree(sftp, remote_dir, base_local)
                    summary = f"Downloaded directory to {base_local}"
        else:
            source = local_target
            if not source.exists():
                return {"ok": False, "error": f"Local path not found: {source}"}

            if source.is_file():
                if normalized_remote.endswith("/") or _sftp_is_dir(sftp, normalized_remote.rstrip("/")):
                    remote_file = f"{normalized_remote.rstrip('/')}/{source.name}"
                else:
                    remote_file = normalized_remote.rstrip("/")
                remote_parent = str(PurePosixPath(remote_file).parent)
                _sftp_mkdirs(sftp, remote_parent, active_session.get("home") or remote_home)
                sftp.put(str(source), remote_file)
                summary = f"Uploaded file to {remote_file}"
                files = 1
                dirs = 0
            else:
                if include_contents:
                    remote_base = normalized_remote.rstrip("/")
                    _sftp_mkdirs(sftp, remote_base, active_session.get("home") or remote_home)
                    files = 0
                    dirs = 0
                    for child in source.iterdir():
                        child_remote = f"{remote_base}/{child.name}"
                        if child.is_dir():
                            c_files, c_dirs = _upload_local_tree(
                                sftp, child, child_remote, active_session.get("home") or remote_home
                            )
                            files += c_files
                            dirs += c_dirs
                        else:
                            sftp.put(str(child), child_remote)
                            files += 1
                    summary = f"Uploaded directory contents to {remote_base}"
                else:
                    remote_base = f"{normalized_remote.rstrip('/')}/{source.name}" if normalized_remote.endswith("/") else normalized_remote.rstrip("/")
                    files, dirs = _upload_local_tree(
                        sftp, source, remote_base, active_session.get("home") or remote_home
                    )
                    summary = f"Uploaded directory to {remote_base}"

        return {
            "ok": True,
            "code": 0,
            "command": f"{operation} local={local_target} remote={normalized_remote}",
            "stdout": f"{summary}\nFiles: {files}, Dirs: {dirs}",
            "stderr": "",
            "error": "",
        }
    except Exception as exc:
        return {
            "ok": False,
            "code": 1,
            "command": f"{operation} local={local_target} remote={normalized_remote}",
            "stdout": "",
            "stderr": str(exc),
            "error": f"Transfer failed: {exc}",
        }
    finally:
        try:
            sftp.close()
        except Exception:
            pass


def _remote_spec(login: str, host: str, remote_path: str) -> str:
    return f"{login}@{host}:{remote_path}"


def _execute_rsync_download(local_path: str, remote_path: str, include_contents: bool) -> dict:
    session = _session_client()
    login = session.get("login") or ""
    host = TRANSFER_HOST or session.get("host") or ""
    remote_home = session.get("home") or f"/home/CIN/{login}"
    password = session.get("password") or ""
    if not login or not host:
        return {"ok": False, "error": "SSH login required before executing download."}

    normalized_remote, remote_err = _normalize_remote_path(remote_path, remote_home, include_contents)
    if remote_err:
        return {"ok": False, "error": remote_err}
    normalized_local, local_err = _normalize_local_path(local_path, False)
    if local_err:
        return {"ok": False, "error": local_err}

    rsync = shutil.which("rsync")
    if not rsync:
        return {"ok": False, "error": "rsync was not found on this local machine."}

    auth_method = "SSH key from local machine"
    askpass_path = ""
    ssh_command = [
        "ssh",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "NumberOfPasswordPrompts=1",
    ]
    command = [
        rsync,
        "-avzP",
        "-e",
        " ".join(ssh_command),
        _remote_spec(login, host, normalized_remote),
        normalized_local,
    ]
    display = "rsync -avzP " + " ".join([_remote_spec(login, host, normalized_remote), normalized_local])

    env = os.environ.copy()
    sshpass = shutil.which("sshpass")
    if sshpass and password:
        env["SSHPASS"] = password
        command = [sshpass, "-e"] + command
        auth_method = "active dashboard SSH password via sshpass"
    elif password:
        askpass = tempfile.NamedTemporaryFile("w", delete=False, prefix="apuana-askpass-", suffix=".sh")
        askpass.write("#!/bin/sh\nprintf '%s\\n' \"$APUANA_RSYNC_PASSWORD\"\n")
        askpass.close()
        askpass_path = askpass.name
        os.chmod(askpass_path, 0o700)
        env["APUANA_RSYNC_PASSWORD"] = password
        env["SSH_ASKPASS"] = askpass_path
        env["SSH_ASKPASS_REQUIRE"] = "force"
        env.setdefault("DISPLAY", "apuana-dashboard:0")
        auth_method = "active dashboard SSH password via SSH_ASKPASS"
    else:
        command[3] = command[3] + " -o BatchMode=yes"

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=60 * 60,
            check=False,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "command": display, "error": "rsync timed out.", "stdout": "", "stderr": ""}
    except Exception as exc:
        return {"ok": False, "command": display, "error": f"Failed to start rsync: {exc}", "stdout": "", "stderr": str(exc)}
    finally:
        if askpass_path:
            try:
                os.unlink(askpass_path)
            except OSError:
                pass

    if result.returncode != 0:
        stderr = result.stderr.strip()
        hint = f" Auth attempted with {auth_method}."
        if "Permission denied" in stderr or "password" in stderr.lower() or "askpass" in stderr.lower():
            hint += " The dashboard uses the login and password captured on the SSH screen; if this Mac blocks non-interactive password prompts, install sshpass or configure an SSH key for this user."
        return {
            "ok": False,
            "code": result.returncode,
            "command": display,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "error": (stderr or "rsync failed.") + hint,
            "auth": auth_method,
        }

    return {
        "ok": True,
        "code": 0,
        "command": display,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "error": "",
        "auth": auth_method,
    }


def _safe_upload_name(raw: str) -> PurePosixPath:
    cleaned = str(raw or "").replace("\\", "/").strip("/")
    parts = [part for part in PurePosixPath(cleaned or "upload.bin").parts if part not in ("", ".", "..")]
    return PurePosixPath(*parts) if parts else PurePosixPath("upload.bin")


def _upload_streams(files: list[tuple[str, object]], remote_path: str) -> dict:
    session = _session_public()
    login = session.get("login") or ""
    remote_home = session.get("home") or f"/home/CIN/{login}"
    if not login:
        return {"ok": False, "error": "SSH login required before executing upload."}
    if not files:
        return {"ok": False, "error": "Choose at least one local file before uploading."}

    normalized_remote, remote_err = _normalize_remote_path(remote_path, remote_home, True)
    if remote_err:
        return {"ok": False, "error": remote_err}
    remote_base = normalized_remote.rstrip("/")

    try:
        client, active_session = _ensure_session_ssh_client()
        sftp = client.open_sftp()
        _sftp_mkdirs(sftp, remote_base, active_session.get("home") or remote_home)
    except Exception as exc:
        return {"ok": False, "error": f"Failed to open SFTP session: {exc}"}

    uploaded = 0
    bytes_total = 0
    try:
        for filename, stream in files:
            rel = _safe_upload_name(filename)
            remote_file = PurePosixPath(remote_base) / rel
            _sftp_mkdirs(sftp, str(remote_file.parent), active_session.get("home") or remote_home)
            with sftp.file(remote_file.as_posix(), "wb") as out:
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    bytes_total += len(chunk)
            uploaded += 1
        return {
            "ok": True,
            "command": f"sftp upload -> {remote_base}",
            "stdout": f"Uploaded {uploaded} file(s), {bytes_total} bytes.",
            "stderr": "",
            "error": "",
            "files": uploaded,
            "bytes": bytes_total,
        }
    except Exception as exc:
        return {"ok": False, "command": f"sftp upload -> {remote_base}", "stdout": "", "stderr": str(exc), "error": f"Upload failed: {exc}"}
    finally:
        try:
            sftp.close()
        except Exception:
            pass
