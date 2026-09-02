import codecs
import os
import shlex
import subprocess
import threading
import time
import uuid

from .runtime import _connect_ssh, _session, _session_client, _session_lock

_terminal_lock = threading.RLock()
_terminals: dict[str, "_TerminalSession"] = {}
_MAX_INPUT_BYTES = 8192
_MAX_READ_BYTES = 131072
_MAX_TERMINAL_HISTORY = 180000
_OUTPUT_CHUNK_CHARS = 16384
_MAX_TERMINAL_SESSIONS = 4


class _ParamikoTerminal:
    def __init__(self, channel) -> None:
        self.channel = channel
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")

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
        return self._decoder.decode(b"".join(chunks), final=False)

    def send(self, data: str) -> None:
        sendall = getattr(self.channel, "sendall", None)
        if callable(sendall):
            sendall(data)
        else:
            self.channel.send(data)

    def resize(self, cols: int, rows: int) -> None:
        self.channel.resize_pty(width=cols, height=rows)

    def close(self) -> None:
        try:
            self.channel.close()
        except Exception:
            pass


class _OpenSshPtyTerminal:
    """Interactive PTY for sessions authenticated through local OpenSSH config."""

    def __init__(self, target: str, cols: int, rows: int) -> None:
        if os.name == "nt":
            raise RuntimeError("Interactive OpenSSH terminal is unavailable on this platform.")
        import fcntl
        import pty

        master, slave = pty.openpty()
        self.master_fd = master
        self.proc = None
        self._decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        try:
            self._resize_pty(cols, rows)
            self.proc = subprocess.Popen(
                [
                    "ssh", "-tt", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                    "-o", "ServerAliveInterval=30", target,
                ],
                stdin=slave,
                stdout=slave,
                stderr=slave,
                close_fds=True,
            )
            flags = fcntl.fcntl(master, fcntl.F_GETFL)
            fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        except Exception:
            os.close(master)
            raise
        finally:
            os.close(slave)

    def _resize_pty(self, cols: int, rows: int) -> None:
        import fcntl
        import struct
        import termios

        fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    def is_alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def read(self, limit: int = _MAX_READ_BYTES) -> str:
        import select

        chunks: list[bytes] = []
        total = 0
        while total < limit:
            ready, _, _ = select.select([self.master_fd], [], [], 0)
            if not ready:
                break
            try:
                chunk = os.read(self.master_fd, min(4096, limit - total))
            except (BlockingIOError, OSError):
                break
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        return self._decoder.decode(b"".join(chunks), final=False) if chunks else ""

    def send(self, data: str) -> None:
        os.write(self.master_fd, data.encode("utf-8", errors="ignore"))

    def resize(self, cols: int, rows: int) -> None:
        self._resize_pty(cols, rows)

    def close(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            self.proc.terminate()
        try:
            os.close(self.master_fd)
        except OSError:
            pass


class _TerminalSession:
    def __init__(self, session_id: str, auth_token: str, login: str, host: str, backend, backend_name: str) -> None:
        self.id = session_id
        self.auth_token = auth_token
        self.login = login
        self.host = host
        self.backend = backend
        self.backend_name = backend_name
        self.created_at = time.time()
        self.updated_at = self.created_at
        self._condition = threading.Condition()
        self._chunks: list[tuple[int, str]] = []
        self._history_chars = 0
        self._seq = 0
        self._read_seq = 0
        self._closed = False
        self._reader = threading.Thread(target=self._reader_loop, daemon=True)
        self._reader.start()

    def is_alive(self) -> bool:
        return self.backend is not None and self.backend.is_alive() and not self._closed

    @property
    def sequence(self) -> int:
        with self._condition:
            return self._seq

    def _append_output(self, text: str) -> None:
        if not text:
            return
        with self._condition:
            for start in range(0, len(text), _OUTPUT_CHUNK_CHARS):
                chunk = text[start : start + _OUTPUT_CHUNK_CHARS]
                self._seq += 1
                self._chunks.append((self._seq, chunk))
                self._history_chars += len(chunk)
            while self._chunks and self._history_chars > _MAX_TERMINAL_HISTORY:
                _, old = self._chunks.pop(0)
                self._history_chars -= len(old)
            self.updated_at = time.time()
            self._condition.notify_all()

    def _reader_loop(self) -> None:
        while self.backend is not None and self.backend.is_alive():
            try:
                output = self.backend.read()
            except Exception as exc:
                self._append_output(f"\r\n[Apuana Monitor] terminal read failed: {exc}\r\n")
                break
            if output:
                self._append_output(output)
                continue
            time.sleep(0.025)

        with self._condition:
            self._closed = True
            self._condition.notify_all()

    def _collect_since_locked(self, since_seq: int, limit: int = _MAX_READ_BYTES) -> tuple[int, str]:
        chunks: list[str] = []
        total = 0
        current = since_seq
        for seq, text in self._chunks:
            if seq <= since_seq:
                continue
            if chunks and total + len(text) > limit:
                break
            chunks.append(text)
            total += len(text)
            current = seq
        return current, "".join(chunks)

    def read_with_sequence(self) -> tuple[int, str]:
        with self._condition:
            seq, output = self._collect_since_locked(self._read_seq)
            self._read_seq = seq
            return seq, output

    def read(self) -> str:
        return self.read_with_sequence()[1]

    def wait_output(self, since_seq: int, timeout: float = 25.0) -> tuple[int, str, bool]:
        deadline = time.time() + max(0.2, timeout)
        with self._condition:
            while self._seq <= since_seq and not self._closed:
                remaining = deadline - time.time()
                if remaining <= 0:
                    break
                self._condition.wait(min(remaining, 1.0))
            seq, output = self._collect_since_locked(since_seq)
            return seq, output, not self._closed

    def send(self, data: str) -> None:
        self.backend.send(data)

    def resize(self, cols: int, rows: int) -> None:
        self.backend.resize(cols, rows)

    def close(self) -> None:
        with self._condition:
            self._closed = True
            self._condition.notify_all()
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


def _close_terminal_locked(terminal_id: str) -> None:
    terminal = _terminals.pop(terminal_id, None)
    if terminal is not None:
        terminal.close()


def _close_locked() -> None:
    for terminal_id in list(_terminals):
        _close_terminal_locked(terminal_id)


def _prune_terminals_locked(session: dict) -> None:
    for terminal_id, terminal in list(_terminals.items()):
        if not terminal.is_alive() or not _terminal_matches_current_auth(terminal, session):
            _close_terminal_locked(terminal_id)


def _terminal_close_active() -> None:
    with _terminal_lock:
        _close_locked()


def _safe_cwd(home: str, raw_cwd: str) -> str:
    home = (home or "").rstrip("/")
    cwd = (raw_cwd or "").strip().rstrip("/")
    if home and cwd and (cwd == home or cwd.startswith(home + "/")):
        return cwd
    return ""


def _open_terminal_backend(session: dict, cols: int, rows: int):
    if session.get("auth_mode") == "openssh" and not session.get("client"):
        target = session.get("ssh_target") or f"{session.get('login')}@{session.get('host')}"
        return _OpenSshPtyTerminal(target, cols, rows), "openssh-pty"

    # Password and agent-based Paramiko logins reuse their authenticated
    # transport instead of starting another authentication flow.
    client = _ensure_active_client(session)
    channel = client.invoke_shell(term="xterm-256color", width=cols, height=rows)
    channel.settimeout(0.0)
    return _ParamikoTerminal(channel), "paramiko"


def _terminal_start_payload(payload: dict) -> dict:
    session = _session_client()
    if not session.get("token"):
        return _payload_error("SSH login required.")

    cols = _int_between(payload.get("cols"), 120, 40, 240)
    rows = _int_between(payload.get("rows"), 28, 10, 80)
    cwd = _safe_cwd(session.get("home", ""), payload.get("cwd") or "")

    requested_id = str(payload.get("id") or "")

    with _terminal_lock:
        _prune_terminals_locked(session)
        if requested_id:
            terminal = _terminals.get(requested_id)
            if terminal is None or not terminal.is_alive():
                return _payload_error("Terminal session is not active.")
            try:
                terminal.resize(cols, rows)
            except Exception:
                pass
            terminal.updated_at = time.time()
            seq, output = terminal.read_with_sequence()
            return {
                "ok": True,
                "id": terminal.id,
                "host": terminal.host,
                "login": terminal.login,
                "backend": terminal.backend_name,
                "seq": seq,
                "output": output,
            }

        if len(_terminals) >= _MAX_TERMINAL_SESSIONS:
            return _payload_error(f"Terminal limit reached. Close one tab before opening another ({_MAX_TERMINAL_SESSIONS} max).")

        try:
            backend, backend_name = _open_terminal_backend(session, cols, rows)
            terminal = _TerminalSession(
                session_id=uuid.uuid4().hex,
                auth_token=session["token"],
                login=session["login"],
                host=session["host"],
                backend=backend,
                backend_name=backend_name,
            )
            _terminals[terminal.id] = terminal
            seq, output = terminal.read_with_sequence()
            if cwd:
                terminal.send(f"cd {shlex.quote(cwd)}\n")
                time.sleep(0.06)
                seq, cwd_output = terminal.read_with_sequence()
                output += cwd_output
            return {
                "ok": True,
                "id": terminal.id,
                "host": terminal.host,
                "login": terminal.login,
                "backend": terminal.backend_name,
                "seq": seq,
                "output": output,
            }
        except Exception as exc:
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
        terminal = _terminals.get(terminal_id)
        if terminal is None or not terminal.is_alive():
            if terminal_id:
                _close_terminal_locked(terminal_id)
            return _payload_error("Terminal session is not active.")
        try:
            terminal.send(data)
            terminal.updated_at = time.time()
            return {"ok": True}
        except Exception as exc:
            _close_terminal_locked(terminal_id)
            return _payload_error(str(exc) or "Could not write to terminal.")


def _terminal_read_payload(terminal_id: str) -> dict:
    with _terminal_lock:
        terminal = _terminals.get(terminal_id)
        if terminal is None:
            return _payload_error("Terminal session is not active.")
        if not terminal.is_alive():
            _close_terminal_locked(terminal_id)
            return _payload_error("Terminal session ended.")
        terminal.updated_at = time.time()
        return {"ok": True, "alive": True, "output": terminal.read()}


def _terminal_event_payload(terminal_id: str, since_seq: int, timeout: float = 25.0) -> dict:
    with _terminal_lock:
        terminal = _terminals.get(terminal_id)
        if terminal is None:
            return _payload_error("Terminal session is not active.")

    if not terminal.is_alive():
        with _terminal_lock:
            _close_terminal_locked(terminal_id)
        return _payload_error("Terminal session ended.")

    seq, output, alive = terminal.wait_output(since_seq, timeout=timeout)
    terminal.updated_at = time.time()
    return {
        "ok": True,
        "id": terminal.id,
        "seq": seq,
        "output": output,
        "alive": alive,
        "backend": terminal.backend_name,
        "host": terminal.host,
        "login": terminal.login,
    }


def _terminal_prepare_async(cwd: str = "", cols: int = 120, rows: int = 28) -> None:
    def run() -> None:
        _terminal_start_payload({"cwd": cwd, "cols": cols, "rows": rows})

    threading.Thread(target=run, daemon=True).start()


def _terminal_resize_payload(payload: dict) -> dict:
    terminal_id = str(payload.get("id") or "")
    cols = _int_between(payload.get("cols"), 120, 40, 240)
    rows = _int_between(payload.get("rows"), 28, 10, 80)
    with _terminal_lock:
        terminal = _terminals.get(terminal_id)
        if terminal is None or not terminal.is_alive():
            if terminal_id:
                _close_terminal_locked(terminal_id)
            return _payload_error("Terminal session is not active.")
        try:
            terminal.resize(cols, rows)
            terminal.updated_at = time.time()
            return {"ok": True}
        except Exception as exc:
            return _payload_error(str(exc) or "Could not resize terminal.")


def _terminal_stop_payload(terminal_id: str = "") -> dict:
    with _terminal_lock:
        if terminal_id:
            _close_terminal_locked(terminal_id)
        else:
            _close_locked()
        return {"ok": True}
