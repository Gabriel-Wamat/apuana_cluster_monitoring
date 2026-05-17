import os
import shlex
import subprocess
import threading
import time
import uuid

from .runtime import _connect_ssh, _session, _session_client, _session_lock

_terminal_lock = threading.RLock()
_terminal = None
_MAX_INPUT_BYTES = 8192
_MAX_READ_BYTES = 131072


class _ParamikoTerminal:
    def __init__(self, channel) -> None:
        self.channel = channel

    def is_alive(self) -> bool:
        try:
            return self.channel is not None and not self.channel.closed
        except Exception:
            return False

    def read(self, limit: int = _MAX_READ_BYTES) -> str:
        chunks: list[bytes] = []
        total = 0
        while total < limit:
            try:
                ready = self.channel.recv_ready()
            except Exception:
                break
            if not ready:
                break
            try:
                chunk = self.channel.recv(min(4096, limit - total))
            except Exception:
                break
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)

        if hasattr(self.channel, "recv_stderr_ready"):
            while total < limit:
                try:
                    ready = self.channel.recv_stderr_ready()
                except Exception:
                    break
                if not ready:
                    break
                try:
                    chunk = self.channel.recv_stderr(min(4096, limit - total))
                except Exception:
                    break
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)

        if not chunks:
            return ""
        return b"".join(chunks).decode("utf-8", errors="replace")

    def send(self, data: str) -> None:
        self.channel.send(data)

    def resize(self, cols: int, rows: int) -> None:
        self.channel.resize_pty(width=cols, height=rows)

    def close(self) -> None:
        try:
            self.channel.close()
        except Exception:
            pass


class _OpenSshTerminal:
    def __init__(self, target: str, cols: int, rows: int) -> None:
        self.target = target
        self.proc = None
        self.master_fd = None
        self._buffer = bytearray()
        self._buffer_lock = threading.Lock()
        self._reader = None

        if os.name == "nt":
            self.proc = subprocess.Popen(
                ["ssh", "-o", "BatchMode=yes", target],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=0,
            )
            self._reader = threading.Thread(target=self._read_pipe_loop, daemon=True)
            self._reader.start()
        else:
            import fcntl
            import pty

            master, slave = pty.openpty()
            self.master_fd = master
            self._resize_pty(cols, rows)
            self.proc = subprocess.Popen(
                ["ssh", "-tt", "-o", "BatchMode=yes", target],
                stdin=slave,
                stdout=slave,
                stderr=slave,
                close_fds=True,
            )
            os.close(slave)
            flags = fcntl.fcntl(master, fcntl.F_GETFL)
            fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def _read_pipe_loop(self) -> None:
        if self.proc is None or self.proc.stdout is None:
            return
        while self.proc.poll() is None:
            chunk = self.proc.stdout.read(4096)
            if not chunk:
                break
            with self._buffer_lock:
                self._buffer.extend(chunk)

    def _resize_pty(self, cols: int, rows: int) -> None:
        if self.master_fd is None or os.name == "nt":
            return
        try:
            import fcntl
            import struct
            import termios

            fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        except Exception:
            pass

    def is_alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def read(self, limit: int = _MAX_READ_BYTES) -> str:
        if os.name == "nt":
            with self._buffer_lock:
                raw = bytes(self._buffer[:limit])
                del self._buffer[:limit]
            return raw.decode("utf-8", errors="replace") if raw else ""

        if self.master_fd is None:
            return ""
        import select

        chunks: list[bytes] = []
        total = 0
        while total < limit:
            ready, _, _ = select.select([self.master_fd], [], [], 0)
            if not ready:
                break
            try:
                chunk = os.read(self.master_fd, min(4096, limit - total))
            except BlockingIOError:
                break
            except OSError:
                break
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        return b"".join(chunks).decode("utf-8", errors="replace") if chunks else ""

    def send(self, data: str) -> None:
        raw = data.encode("utf-8", errors="ignore")
        if os.name == "nt":
            if self.proc is None or self.proc.stdin is None:
                raise RuntimeError("Terminal process is not writable.")
            self.proc.stdin.write(raw)
            self.proc.stdin.flush()
            return
        if self.master_fd is None:
            raise RuntimeError("Terminal PTY is not active.")
        os.write(self.master_fd, raw)

    def resize(self, cols: int, rows: int) -> None:
        self._resize_pty(cols, rows)

    def close(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            try:
                self.proc.terminate()
            except Exception:
                pass
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except Exception:
                pass
            self.master_fd = None


class _TerminalSession:
    def __init__(self, session_id: str, auth_token: str, login: str, host: str, backend) -> None:
        self.id = session_id
        self.auth_token = auth_token
        self.login = login
        self.host = host
        self.backend = backend
        self.created_at = time.time()
        self.updated_at = self.created_at

    def is_alive(self) -> bool:
        return self.backend is not None and self.backend.is_alive()

    def read(self) -> str:
        return self.backend.read()

    def send(self, data: str) -> None:
        self.backend.send(data)

    def resize(self, cols: int, rows: int) -> None:
        self.backend.resize(cols, rows)

    def close(self) -> None:
        if self.backend is not None:
            self.backend.close()


def _payload_error(message: str) -> dict:
    return {"ok": False, "error": message}


def _int_between(value, default: int, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(minimum, min(maximum, number))


def _ensure_active_client(session: dict):
    client = session.get("client")
    transport = client.get_transport() if client else None
    if client is not None and transport is not None and transport.is_active():
        return client

    if not session.get("password") and session.get("auth_mode") != "paramiko-agent":
        raise RuntimeError("SSH login required.")

    client = _connect_ssh(session["host"], session["login"], session.get("password") or "")
    with _session_lock:
        if _session.get("token") == session.get("token"):
            _session["client"] = client
    return client


def _terminal_auth_key(session: dict) -> tuple[str, str, str]:
    return (
        str(session.get("token") or ""),
        str(session.get("login") or ""),
        str(session.get("host") or ""),
    )


def _terminal_matches_current_auth(term: _TerminalSession, session: dict) -> bool:
    token, login, host = _terminal_auth_key(session)
    return term.auth_token == token and term.login == login and term.host == host


def _close_locked() -> None:
    global _terminal
    if _terminal is not None:
        _terminal.close()
    _terminal = None


def _terminal_close_active() -> None:
    with _terminal_lock:
        _close_locked()


def _safe_cwd(home: str, raw_cwd: str) -> str:
    home = (home or "").rstrip("/")
    cwd = (raw_cwd or "").strip().rstrip("/")
    if home and cwd and (cwd == home or cwd.startswith(home + "/")):
        return cwd
    return ""


def _terminal_start_payload(payload: dict) -> dict:
    global _terminal
    session = _session_client()
    if not session.get("token"):
        return _payload_error("SSH login required.")

    cols = _int_between(payload.get("cols"), 120, 40, 240)
    rows = _int_between(payload.get("rows"), 28, 10, 80)
    cwd = _safe_cwd(session.get("home", ""), payload.get("cwd") or "")

    with _terminal_lock:
        if _terminal is not None:
            if _terminal.is_alive() and _terminal_matches_current_auth(_terminal, session):
                try:
                    _terminal.resize(cols, rows)
                except Exception:
                    pass
                _terminal.updated_at = time.time()
                return {
                    "ok": True,
                    "id": _terminal.id,
                    "host": _terminal.host,
                    "login": _terminal.login,
                    "output": _terminal.read(),
                }
            _close_locked()

        try:
            if session.get("auth_mode") == "openssh" and not session.get("password") and session.get("client") is None:
                target = session.get("ssh_target") or f"{session.get('login')}@{session.get('host')}"
                backend = _OpenSshTerminal(target, cols, rows)
            else:
                client = _ensure_active_client(session)
                channel = client.invoke_shell(term="xterm-256color", width=cols, height=rows)
                channel.settimeout(0.0)
                backend = _ParamikoTerminal(channel)
            _terminal = _TerminalSession(
                session_id=uuid.uuid4().hex,
                auth_token=session["token"],
                login=session["login"],
                host=session["host"],
                backend=backend,
            )
            output = _terminal.read()
            if cwd:
                _terminal.send(f"cd {shlex.quote(cwd)}\n")
                output += _terminal.read()
            return {
                "ok": True,
                "id": _terminal.id,
                "host": _terminal.host,
                "login": _terminal.login,
                "output": output,
            }
        except Exception as exc:
            _close_locked()
            return _payload_error(str(exc) or "Could not start Apuana terminal.")


def _terminal_input_payload(payload: dict) -> dict:
    terminal_id = str(payload.get("id") or "")
    data = str(payload.get("data") or "")
    if not data:
        return {"ok": True}
    encoded = data.encode("utf-8", errors="ignore")
    if len(encoded) > _MAX_INPUT_BYTES:
        return _payload_error("Terminal input is too large.")

    with _terminal_lock:
        if _terminal is None or _terminal.id != terminal_id or not _terminal.is_alive():
            return _payload_error("Terminal session is not active.")
        try:
            _terminal.send(data)
            _terminal.updated_at = time.time()
            return {"ok": True, "output": _terminal.read()}
        except Exception as exc:
            _close_locked()
            return _payload_error(str(exc) or "Could not write to terminal.")


def _terminal_read_payload(terminal_id: str) -> dict:
    with _terminal_lock:
        if _terminal is None or _terminal.id != terminal_id:
            return _payload_error("Terminal session is not active.")
        if not _terminal.is_alive():
            _close_locked()
            return _payload_error("Terminal session ended.")
        _terminal.updated_at = time.time()
        return {"ok": True, "alive": True, "output": _terminal.read()}


def _terminal_resize_payload(payload: dict) -> dict:
    terminal_id = str(payload.get("id") or "")
    cols = _int_between(payload.get("cols"), 120, 40, 240)
    rows = _int_between(payload.get("rows"), 28, 10, 80)
    with _terminal_lock:
        if _terminal is None or _terminal.id != terminal_id or not _terminal.is_alive():
            return _payload_error("Terminal session is not active.")
        try:
            _terminal.resize(cols, rows)
            _terminal.updated_at = time.time()
            return {"ok": True}
        except Exception as exc:
            return _payload_error(str(exc) or "Could not resize terminal.")


def _terminal_stop_payload(terminal_id: str = "") -> dict:
    with _terminal_lock:
        if terminal_id and (_terminal is None or _terminal.id != terminal_id):
            return {"ok": True}
        _close_locked()
        return {"ok": True}
