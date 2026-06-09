import json
import shlex
import socketserver
import cgi
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from .config import AUTH_HEADER, SSH_HOST, STATIC_ROOT, STATIC_TYPES, TRANSFER_HOST
from .code_browser import (
    _code_create_payload,
    _code_delete_payload,
    _code_file_payload,
    _code_file_save_payload,
    _code_folder_payload,
    _code_list_payload,
    _code_projects_payload,
    _code_tree_payload,
)
from .fs import _fs_payload
from .local_picker import _choose_local_folder
from .logs import _log_files_payload
from .remote_files import _delete_remote_path, _explorer_payload, _read_remote_file, _write_remote_file
from .runtime import (
    _auto_login_session,
    _clear_session,
    _connect_ssh,
    _delete_saved_password,
    _save_password,
    _normalize_login,
    _run,
    _session_public,
    _session_token,
    _set_session,
)
from .slurm import _cache, _job_gpu_payload, _job_info_payload, _lock, _normalize_job_id
from .terminal import (
    _terminal_close_active,
    _terminal_event_payload,
    _terminal_input_payload,
    _terminal_read_payload,
    _terminal_resize_payload,
    _terminal_start_payload,
    _terminal_stop_payload,
)
from .templates import _index_html_bytes
from .transfers import (
    _execute_rsync_download,
    _execute_rsync_upload,
    _execute_transfer,
    _start_rsync_upload_task,
    _transfer_task_payload,
    _upload_streams,
)

def _login_failure_payload(exc: Exception) -> tuple[int, dict]:
    detail = str(exc).strip()
    lower = detail.lower()
    auth_markers = (
        "authentication failed",
        "auth failed",
        "permission denied",
        "bad authentication type",
        "invalid password",
    )
    network_markers = (
        "timed out",
        "timeout",
        "no route to host",
        "network is unreachable",
        "name or service not known",
        "temporary failure in name resolution",
        "connection refused",
        "connection reset",
        "connection aborted",
        "could not establish connection",
        "unable to connect",
        "nodename nor servname provided",
        "socket is closed",
    )

    if any(marker in lower for marker in auth_markers):
        return 401, {
            "ok": False,
            "code": "ssh_auth_failed",
            "error": "Falha no login SSH: verifique login e senha.",
            "detail": detail,
        }

    if any(marker in lower for marker in network_markers):
        return 503, {
            "ok": False,
            "code": "vpn_unreachable",
            "error": "Não foi possível alcançar o Apuana. Verifique se a VPN do CIn está ligada e tente novamente.",
            "detail": detail,
        }

    return 401, {
        "ok": False,
        "code": "ssh_login_failed",
        "error": f"Falha no login SSH: {detail}",
        "detail": detail,
    }

class Handler(BaseHTTPRequestHandler):
    def _read_json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _json(self, code: int, payload: dict) -> None:
        self._send(code, "application/json; charset=utf-8", json.dumps(payload).encode())

    def _has_session(self) -> bool:
        token = (self.headers.get(AUTH_HEADER) or "").strip()
        active = _session_token()
        if token and token == active:
            return True
        host = (self.headers.get("Host") or "").split(":", 1)[0]
        referer = self.headers.get("Referer") or ""
        local_request = self.client_address[0] in {"127.0.0.1", "::1"} or host in {"127.0.0.1", "localhost"}
        same_app = not referer or "127.0.0.1" in referer or "localhost" in referer
        return bool(active and local_request and same_app)

    def _require_auth(self) -> bool:
        if self._has_session():
            return True
        self._json(401, {"ok": False, "error": "SSH login required."})
        return False

    def _is_local_request(self) -> bool:
        host = (self.headers.get("Host") or "").split(":", 1)[0]
        return self.client_address[0] in {"127.0.0.1", "::1"} or host in {"127.0.0.1", "localhost"}

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)

        if parsed.path == "/api/auth/auto":
            if not self._is_local_request():
                self._json(403, {"ok": False, "error": "Automatic SSH login is only available from localhost."})
                return
            payload = self._read_json_body()
            session = _session_public()
            if session.get("token"):
                self._json(
                    200,
                    {
                        "ok": True,
                        "token": session.get("token", ""),
                        "login": session.get("login", ""),
                        "username": session.get("login", ""),
                        "host": session.get("host", SSH_HOST),
                        "home": session.get("home", ""),
                        "transfer_host": TRANSFER_HOST,
                        "auth": "active dashboard session",
                    },
                )
                return
            login = _normalize_login(payload.get("login") or payload.get("email") or "")
            host = (payload.get("host") or SSH_HOST).strip() or SSH_HOST
            result = _auto_login_session(login, host)
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/auth/login":
            payload = self._read_json_body()
            login = _normalize_login(payload.get("login") or payload.get("email") or "")
            password = payload.get("password") or ""
            remember = bool(payload.get("remember"))
            host = (payload.get("host") or SSH_HOST).strip() or SSH_HOST

            if not login:
                self._json(400, {"ok": False, "error": "Login SSH inválido."})
                return
            if not password:
                self._json(400, {"ok": False, "error": "Senha SSH obrigatória."})
                return

            try:
                client = _connect_ssh(host, login, password)
                stdin, stdout, stderr = client.exec_command("echo $HOME", timeout=6)
                _ = stdin, stderr
                home = stdout.read().decode("utf-8", errors="replace").strip() or f"/home/CIN/{login}"
            except Exception as exc:
                code, payload = _login_failure_payload(exc)
                self._json(code, payload)
                return

            _terminal_close_active()
            token = _set_session(login=login, password=password, host=host, client=client, home=home)
            credential_saved = False
            credential_error = ""
            if remember:
                credential_saved, credential_error = _save_password(login, host, password)
            else:
                _delete_saved_password(login, host)
            self._json(
                200,
                {
                    "ok": True,
                    "token": token,
                    "login": login,
                    "username": login,
                    "host": host,
                    "home": home,
                    "transfer_host": TRANSFER_HOST,
                    "credential_saved": credential_saved,
                    "credential_error": credential_error,
                },
            )
            return

        if parsed.path == "/api/auth/logout":
            _terminal_close_active()
            _clear_session()
            self._json(200, {"ok": True})
            return

        if parsed.path == "/api/transfer/execute":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _execute_transfer(
                mode=(payload.get("mode") or "").strip().lower(),
                local_path=payload.get("localPath") or "",
                remote_path=payload.get("remotePath") or "",
                include_contents=bool(payload.get("includeContents")),
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/transfer/rsync-download":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _execute_rsync_download(
                local_path=payload.get("localPath") or "",
                remote_path=payload.get("remotePath") or "",
                include_contents=bool(payload.get("includeContents")),
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/transfer/rsync-upload":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _execute_rsync_upload(
                local_path=payload.get("localPath") or "",
                remote_path=payload.get("remotePath") or "",
                include_contents=bool(payload.get("includeContents")),
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/transfer/rsync-upload/start":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _start_rsync_upload_task(
                local_path=payload.get("localPath") or "",
                remote_path=payload.get("remotePath") or "",
                include_contents=bool(payload.get("includeContents")),
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/transfer/upload-selected":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                    "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
                },
            )
            remote_path = form.getfirst("remotePath", "")
            raw_files = form["files"] if "files" in form else []
            if not isinstance(raw_files, list):
                raw_files = [raw_files]
            files = [(item.filename or "upload.bin", item.file) for item in raw_files if getattr(item, "filename", "")]
            result = _upload_streams(files, remote_path)
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/local/folder-picker":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            result = _choose_local_folder()
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/code/file":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _code_file_save_payload(payload.get("path") or "", payload.get("content") or "")
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/code/create":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _code_create_payload(
                payload.get("parent") or "",
                payload.get("name") or "",
                payload.get("kind") or "file",
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/code/delete":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _code_delete_payload(payload.get("path") or "")
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/remote/file":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _write_remote_file(payload.get("path") or "", payload.get("content") or "")
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/remote/delete":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _delete_remote_path(payload.get("path") or "")
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/terminal/start":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            result = _terminal_start_payload(self._read_json_body())
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/terminal/input":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            result = _terminal_input_payload(self._read_json_body())
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/terminal/resize":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            result = _terminal_resize_payload(self._read_json_body())
            self._json(200 if result.get("ok") else 400, result)
            return

        if parsed.path == "/api/terminal/stop":
            if not self._has_session():
                self._json(401, {"ok": False, "error": "SSH login required."})
                return
            payload = self._read_json_body()
            result = _terminal_stop_payload(payload.get("id") or "")
            self._json(200 if result.get("ok") else 400, result)
            return

        self.send_response(404)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path in ("/", "/index.html"):
            self._send(200, "text/html; charset=utf-8", _index_html_bytes())
        elif parsed.path.startswith("/static/"):
            self._send_static(parsed.path.removeprefix("/static/"))
        elif parsed.path == "/api/auth/status":
            session = _session_public()
            if not self._has_session():
                self._json(401, {"ok": False, "error": "No active session."})
            else:
                self._json(
                    200,
                    {
                        "ok": True,
                        "login": session.get("login", ""),
                        "username": session.get("login", ""),
                        "host": session.get("host", SSH_HOST),
                        "home": session.get("home", ""),
                        "transfer_host": TRANSFER_HOST,
                    },
                )
        elif parsed.path == "/api":
            if not self._require_auth():
                return
            session = _session_public()
            with _lock:
                payload = dict(_cache)
            if session.get("login"):
                payload["user"] = session.get("login", "")
                payload["node"] = session.get("host", SSH_HOST)
                payload["transfer"] = {
                    "user": session.get("login", ""),
                    "host": TRANSFER_HOST,
                    "home": session.get("home", ""),
                }
            body = json.dumps(payload).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/fs":
            if not self._require_auth():
                return
            path = qs.get("path", ["~"])[0]
            query = qs.get("query", [""])[0]
            body = json.dumps(_fs_payload(path, query)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/job-gpu":
            if not self._require_auth():
                return
            jid = qs.get("id", [""])[0].strip()
            body = json.dumps(_job_gpu_payload(jid)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/job-info":
            if not self._require_auth():
                return
            jid = qs.get("id", [""])[0].strip()
            body = json.dumps(_job_info_payload(jid)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/job":
            if not self._require_auth():
                return
            jid = qs.get("id", [""])[0].strip()
            if not _normalize_job_id(jid):
                self._send(400, "text/plain", b"Invalid job ID")
                return
            rc, out, err = _run(["scontrol", "show", "job", jid])
            self._send(200, "text/plain", (out or err or "no output").encode())
        elif parsed.path == "/api/log-files":
            if not self._require_auth():
                return
            query = qs.get("query", [""])[0].strip()
            folder = qs.get("folder", [""])[0].strip()
            mode = qs.get("mode", ["folders"])[0].strip()
            body = json.dumps(_log_files_payload(query, folder, mode)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/logs":
            if not self._require_auth():
                return
            home = _session_public().get("home") or ""
            result = {}
            for key in ("out", "err"):
                p = qs.get(key, [""])[0].strip()
                if not p or not p.startswith(home):
                    result[key] = ""
                    continue
                script = f"path={shlex.quote(p)}; home={shlex.quote(home)}; case \"$path\" in \"$home\"/*) tail -n 200 \"$path\" ;; *) exit 2 ;; esac"
                rc, out, _ = _run(["bash", "-lc", script], timeout=6)
                result[key] = out if rc == 0 else ""
            self._send(200, "application/json", json.dumps(result).encode())
        elif parsed.path == "/api/remote/explorer":
            if not self._require_auth():
                return
            path = qs.get("path", ["~"])[0]
            period = qs.get("period", ["all"])[0].strip() or "all"
            body = json.dumps(_explorer_payload(path, period)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/transfer/task":
            if not self._require_auth():
                return
            task_id = qs.get("id", [""])[0].strip()
            payload = _transfer_task_payload(task_id)
            self._json(200 if payload.get("ok") else 404, payload)
        elif parsed.path == "/api/remote/file":
            if not self._require_auth():
                return
            path = qs.get("path", [""])[0]
            body = json.dumps(_read_remote_file(path)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/code/projects":
            if not self._require_auth():
                return
            body = json.dumps(_code_projects_payload()).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/code/list":
            if not self._require_auth():
                return
            project = qs.get("project", [""])[0]
            path = qs.get("path", [""])[0]
            query = qs.get("query", [""])[0]
            body = json.dumps(_code_list_payload(project, path, query)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/code/tree":
            if not self._require_auth():
                return
            root = qs.get("root", [""])[0]
            body = json.dumps(_code_tree_payload(root)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/code/folders":
            if not self._require_auth():
                return
            path = qs.get("path", [""])[0]
            body = json.dumps(_code_folder_payload(path)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/code/file":
            if not self._require_auth():
                return
            path = qs.get("path", [""])[0]
            body = json.dumps(_code_file_payload(path)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/terminal/read":
            if not self._require_auth():
                return
            terminal_id = qs.get("id", [""])[0]
            body = json.dumps(_terminal_read_payload(terminal_id)).encode()
            self._send(200, "application/json", body)
        elif parsed.path == "/api/terminal/events":
            if not self._require_auth():
                return
            terminal_id = qs.get("id", [""])[0]
            try:
                since = int(qs.get("since", ["0"])[0] or "0")
            except ValueError:
                since = 0
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            while True:
                payload = _terminal_event_payload(terminal_id, since, timeout=25.0)
                if payload.get("ok"):
                    since = int(payload.get("seq") or since)
                event = "terminal" if payload.get("ok") else "error"
                body = json.dumps(payload).encode("utf-8")
                try:
                    self.wfile.write(b"event: " + event.encode("ascii") + b"\n")
                    self.wfile.write(b"data: " + body + b"\n\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    break
                if not payload.get("ok") or payload.get("alive") is False:
                    break
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
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


class _Server(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
