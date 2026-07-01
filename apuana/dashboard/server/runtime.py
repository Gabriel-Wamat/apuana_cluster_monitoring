import secrets
import shlex
import subprocess
import threading
import os

from .config import SSH_HOST, TRANSFER_HOST

try:
    import paramiko
except Exception:  # pragma: no cover - optional dependency check at runtime
    paramiko = None

try:
    import keyring
    from keyring.errors import KeyringError, PasswordDeleteError
except Exception:  # pragma: no cover - optional desktop integration
    keyring = None
    KeyringError = Exception
    PasswordDeleteError = Exception

KEYRING_SERVICE = "Apuana Monitor"
_session_lock = threading.Lock()
_session: dict = {
    "token": "",
    "login": "",
    "host": SSH_HOST,
    "home": "",
    "password": "",
    "client": None,
    "auth_mode": "",
    "ssh_target": "",
}
_ssh_exec_lock = threading.Lock()

def _normalize_login(value: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return ""
    return raw.split("@", 1)[0]


def _credential_account(login: str, host: str) -> str:
    return f"{_normalize_login(login)}@{(host or SSH_HOST).strip() or SSH_HOST}"


def _get_saved_password(login: str, host: str) -> tuple[str, str]:
    if keyring is None:
        return "", "keyring is not installed"
    login = _normalize_login(login)
    if not login:
        return "", "login is required for keyring lookup"
    try:
        password = keyring.get_password(KEYRING_SERVICE, _credential_account(login, host)) or ""
        return password, ""
    except KeyringError as exc:
        return "", str(exc)
    except Exception as exc:
        return "", str(exc)


def _save_password(login: str, host: str, password: str) -> tuple[bool, str]:
    if keyring is None:
        return False, "keyring is not installed"
    login = _normalize_login(login)
    if not login or not password:
        return False, "login and password are required"
    try:
        keyring.set_password(KEYRING_SERVICE, _credential_account(login, host), password)
        return True, ""
    except KeyringError as exc:
        return False, str(exc)
    except Exception as exc:
        return False, str(exc)


def _delete_saved_password(login: str, host: str) -> tuple[bool, str]:
    if keyring is None:
        return False, "keyring is not installed"
    login = _normalize_login(login)
    if not login:
        return False, "login is required"
    try:
        keyring.delete_password(KEYRING_SERVICE, _credential_account(login, host))
        return True, ""
    except PasswordDeleteError:
        return True, ""
    except KeyringError as exc:
        return False, str(exc)
    except Exception as exc:
        return False, str(exc)


def _session_public() -> dict:
    with _session_lock:
        return {
            "token": _session.get("token", ""),
            "login": _session.get("login", ""),
            "host": _session.get("host", SSH_HOST),
            "home": _session.get("home", ""),
            "auth_mode": _session.get("auth_mode", ""),
            "ssh_target": _session.get("ssh_target", ""),
        }


def _session_token() -> str:
    with _session_lock:
        return str(_session.get("token", ""))


def _session_client() -> dict:
    with _session_lock:
        return {
            "token": _session.get("token", ""),
            "login": _session.get("login", ""),
            "host": _session.get("host", SSH_HOST),
            "home": _session.get("home", ""),
            "password": _session.get("password", ""),
            "client": _session.get("client"),
            "auth_mode": _session.get("auth_mode", ""),
            "ssh_target": _session.get("ssh_target", ""),
        }


def _set_session(
    login: str,
    password: str,
    host: str,
    client,
    home: str,
    auth_mode: str = "paramiko",
    ssh_target: str = "",
) -> str:
    token = secrets.token_urlsafe(24)
    with _session_lock:
        _session.update(
            {
                "token": token,
                "login": login,
                "host": host,
                "home": home,
                "password": password,
                "client": client,
                "auth_mode": auth_mode,
                "ssh_target": ssh_target,
            }
        )
    return token


def _clear_session() -> None:
    with _session_lock:
        client = _session.get("client")
        _session.update({
            "token": "",
            "login": "",
            "home": "",
            "password": "",
            "client": None,
            "auth_mode": "",
            "ssh_target": "",
        })
    try:
        if client is not None:
            client.close()
    except Exception:
        pass


def _connect_ssh(host: str, login: str, password: str = ""):
    if paramiko is None:
        raise RuntimeError("paramiko não está instalado no ambiente Python atual.")
    has_password = bool(password)
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.WarningPolicy())
    client.connect(
        hostname=host,
        username=login or None,
        password=password or None,
        look_for_keys=not has_password,
        allow_agent=not has_password,
        timeout=10,
        auth_timeout=10,
        banner_timeout=10,
    )
    return client


def _parse_ssh_g(alias: str) -> dict:
    try:
        result = subprocess.run(
            ["ssh", "-G", alias],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except Exception:
        return {}
    if result.returncode != 0:
        return {}
    parsed = {}
    for line in result.stdout.splitlines():
        if not line.strip() or " " not in line:
            continue
        key, value = line.split(None, 1)
        parsed[key.lower()] = value.strip()
    return parsed


def _auto_ssh_candidates(preferred_login: str = "", preferred_host: str = "") -> list[tuple[str, str, str, str]]:
    candidates: list[tuple[str, str, str, str]] = []
    seen = set()

    def add(host: str, login: str, label: str, target: str = "") -> None:
        host = (host or "").strip()
        login = _normalize_login(login or "")
        if not host or not login:
            return
        key = (host, login, target or f"{login}@{host}")
        if key in seen:
            return
        seen.add(key)
        candidates.append((host, login, label, target or f"{login}@{host}"))

    env_login = (
        os.environ.get("SLURM_MONITOR_SSH_USER")
        or os.environ.get("APUANA_MONITOR_SSH_USER")
        or os.environ.get("APUANA_USER")
        or ""
    )
    login_hint = preferred_login or env_login
    host_hint = (preferred_host or SSH_HOST).strip() or SSH_HOST
    add(host_hint, login_hint, "configured host")

    raw_aliases = os.environ.get("SLURM_MONITOR_SSH_ALIAS") or os.environ.get("APUANA_MONITOR_SSH_ALIAS") or ""
    aliases = [item.strip() for item in raw_aliases.split(",") if item.strip()]
    aliases.extend(["apuana", "apuana1", SSH_HOST, TRANSFER_HOST])

    for alias in aliases:
        config = _parse_ssh_g(alias)
        login = preferred_login or config.get("user") or env_login
        host = config.get("hostname") or alias
        add(host, login, alias, alias)

    return candidates


def _run_openssh(target: str, cmd: list[str], timeout: int) -> tuple[int, str, str]:
    if not target:
        return 1, "", "OpenSSH target is not configured."
    ssh = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ServerAliveInterval=30",
        target,
        shlex.join(cmd),
    ]
    try:
        result = subprocess.run(ssh, capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except Exception as exc:
        return 1, "", str(exc)


def _run_with_stdin(cmd: list[str], data: bytes, timeout: int = 12) -> tuple[int, str, str]:
    session = _session_client()
    if session.get("token"):
        if session.get("auth_mode") == "openssh" and not session.get("password") and session.get("client") is None:
            target = session.get("ssh_target") or f"{session.get('login')}@{session.get('host')}"
            ssh = [
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ServerAliveInterval=30",
                target,
                shlex.join(cmd),
            ]
            try:
                result = subprocess.run(ssh, input=data, capture_output=True, timeout=timeout, check=False)
                return (
                    result.returncode,
                    result.stdout.decode("utf-8", errors="replace").strip(),
                    result.stderr.decode("utf-8", errors="replace").strip(),
                )
            except Exception as exc:
                return 1, "", str(exc)

        with _ssh_exec_lock:
            try:
                client = session.get("client")
                transport = client.get_transport() if client else None
                if client is None or transport is None or not transport.is_active():
                    client = _connect_ssh(session["host"], session["login"], session.get("password") or "")
                    with _session_lock:
                        _session["client"] = client
                stdin, stdout, stderr = client.exec_command(shlex.join(cmd), timeout=timeout)
                stdin.write(data)
                stdin.channel.shutdown_write()
                out = stdout.read().decode("utf-8", errors="replace").strip()
                err = stderr.read().decode("utf-8", errors="replace").strip()
                rc = stdout.channel.recv_exit_status()
                return rc, out, err
            except Exception as exc:
                return 1, "", str(exc)

    try:
        result = subprocess.run(cmd, input=data, capture_output=True, timeout=timeout, check=False)
        return (
            result.returncode,
            result.stdout.decode("utf-8", errors="replace").strip(),
            result.stderr.decode("utf-8", errors="replace").strip(),
        )
    except Exception as exc:
        return 1, "", str(exc)


def _run_bytes(cmd: list[str], data: bytes = b"", timeout: int = 120) -> tuple[int, bytes, bytes]:
    session = _session_client()
    if session.get("token"):
        if session.get("auth_mode") == "openssh" and not session.get("password") and session.get("client") is None:
            target = session.get("ssh_target") or f"{session.get('login')}@{session.get('host')}"
            ssh = [
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ServerAliveInterval=30",
                target,
                shlex.join(cmd),
            ]
            try:
                result = subprocess.run(ssh, input=data, capture_output=True, timeout=timeout, check=False)
                return result.returncode, result.stdout, result.stderr
            except Exception as exc:
                return 1, b"", str(exc).encode("utf-8", errors="replace")

        with _ssh_exec_lock:
            try:
                client = session.get("client")
                transport = client.get_transport() if client else None
                if client is None or transport is None or not transport.is_active():
                    client = _connect_ssh(session["host"], session["login"], session.get("password") or "")
                    with _session_lock:
                        _session["client"] = client
                stdin, stdout, stderr = client.exec_command(shlex.join(cmd), timeout=timeout)
                if data:
                    stdin.write(data)
                stdin.channel.shutdown_write()
                out = stdout.read()
                err = stderr.read()
                rc = stdout.channel.recv_exit_status()
                return rc, out, err
            except Exception as exc:
                return 1, b"", str(exc).encode("utf-8", errors="replace")

    try:
        result = subprocess.run(cmd, input=data, capture_output=True, timeout=timeout, check=False)
        return result.returncode, result.stdout, result.stderr
    except Exception as exc:
        return 1, b"", str(exc).encode("utf-8", errors="replace")


def _auto_login_session(preferred_login: str = "", preferred_host: str = "") -> dict:
    last_error = ""
    tried_keyring = False
    for host, login, label, target in _auto_ssh_candidates(preferred_login, preferred_host):
        client = None
        try:
            client = _connect_ssh(host, login, "")
            stdin, stdout, stderr = client.exec_command("echo $HOME", timeout=6)
            _ = stdin, stderr
            home = stdout.read().decode("utf-8", errors="replace").strip() or f"/home/CIN/{login}"
            token = _set_session(
                login=login,
                password="",
                host=host,
                client=client,
                home=home,
                auth_mode="paramiko-agent",
                ssh_target=target,
            )
            return {
                "ok": True,
                "token": token,
                "login": login,
                "username": login,
                "host": host,
                "home": home,
                "transfer_host": TRANSFER_HOST,
                "auth": f"local SSH config ({label})",
            }
        except Exception as exc:
            last_error = str(exc)
            try:
                if client is not None:
                    client.close()
            except Exception:
                pass
        rc, out, err = _run_openssh(target, ["bash", "-lc", "printf '%s' \"$HOME\""], timeout=8)
        if rc == 0 and out.strip():
            home = out.strip()
            token = _set_session(
                login=login,
                password="",
                host=host,
                client=None,
                home=home,
                auth_mode="openssh",
                ssh_target=target,
            )
            return {
                "ok": True,
                "token": token,
                "login": login,
                "username": login,
                "host": host,
                "home": home,
                "transfer_host": TRANSFER_HOST,
                "auth": f"OpenSSH ({label})",
            }
        if err:
            last_error = err

        if login:
            tried_keyring = True
            password, keyring_error = _get_saved_password(login, host)
            if password:
                try:
                    client = _connect_ssh(host, login, password)
                    stdin, stdout, stderr = client.exec_command("echo $HOME", timeout=6)
                    _ = stdin, stderr
                    home = stdout.read().decode("utf-8", errors="replace").strip() or f"/home/CIN/{login}"
                    token = _set_session(
                        login=login,
                        password=password,
                        host=host,
                        client=client,
                        home=home,
                        auth_mode="keyring",
                        ssh_target=target,
                    )
                    return {
                        "ok": True,
                        "token": token,
                        "login": login,
                        "username": login,
                        "host": host,
                        "home": home,
                        "transfer_host": TRANSFER_HOST,
                        "auth": f"system keyring ({label})",
                        "credential_source": "keyring",
                    }
                except Exception as exc:
                    last_error = str(exc)
                    try:
                        if client is not None:
                            client.close()
                    except Exception:
                        pass
            elif keyring_error and "required for keyring" not in keyring_error:
                last_error = keyring_error
    return {
        "ok": False,
        "code": "ssh_auto_unavailable",
        "error": (
            "Não consegui autenticar automaticamente no Apuana. Verifique a VPN, configure seu SSH local "
            "ou entre uma vez marcando 'Lembrar neste computador'."
            if tried_keyring else
            "Não consegui autenticar automaticamente no Apuana. Informe seu login e senha SSH."
        ),
        "detail": last_error,
    }


def _run(cmd: list[str], timeout: int = 8) -> tuple[int, str, str]:
    session = _session_client()
    if session.get("token"):
        if session.get("auth_mode") == "openssh" and not session.get("password") and session.get("client") is None:
            return _run_openssh(session.get("ssh_target") or f"{session.get('login')}@{session.get('host')}", cmd, timeout)
        # Reconectar fora do exec_lock para não bloquear outros threads durante handshake
        client = session.get("client")
        transport = client.get_transport() if client else None
        if client is None or transport is None or not transport.is_active():
            try:
                client = _connect_ssh(session["host"], session["login"], session.get("password") or "")
                with _session_lock:
                    _session["client"] = client
            except Exception as e:
                return 1, "", str(e)
        with _ssh_exec_lock:
            try:
                stdin, stdout, stderr = client.exec_command(shlex.join(cmd), timeout=timeout)
                _ = stdin
                out = stdout.read().decode("utf-8", errors="replace").strip()
                err = stderr.read().decode("utf-8", errors="replace").strip()
                rc = stdout.channel.recv_exit_status()
                return rc, out, err
            except Exception as e:
                return 1, "", str(e)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except Exception as e:
        return 1, "", str(e)
