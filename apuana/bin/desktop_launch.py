#!/usr/bin/env python3
"""Fast desktop entrypoint for Apuana Monitor."""

from __future__ import annotations

import hashlib
import html
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from pathlib import Path


FROZEN = bool(getattr(sys, "frozen", False))
BUNDLE_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
ROOT = BUNDLE_ROOT if FROZEN else Path(__file__).resolve().parents[2]
DASHBOARD_DIR = ROOT / "apuana" / "dashboard"
APP_ICON_PNG = ROOT / "apuana" / "dashboard" / "static" / "assets" / "apuana-app-icon.png"
REQUIREMENTS = ROOT / "requirements.txt"
VENV_DIR = ROOT / ".venv"
MARKER = VENV_DIR / ".apuana-monitor-deps.json"
if str(DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(DASHBOARD_DIR))


def log_file() -> Path:
    system = platform.system().lower()
    if system == "darwin":
        base = Path.home() / "Library" / "Logs" / "Apuana Monitor"
    elif os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Apuana Monitor" / "logs"
    else:
        base = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "apuana-monitor"
    base.mkdir(parents=True, exist_ok=True)
    return base / "desktop-launch.log"


def log(message: str) -> None:
    try:
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with log_file().open("a", encoding="utf-8") as file:
            file.write(f"[{stamp}] {message}\n")
    except Exception:
        pass


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def requirements_hash() -> str:
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()


def deps_are_ready() -> bool:
    if FROZEN:
        return True
    python = venv_python()
    if not python.exists():
        return False
    try:
        marker = json.loads(MARKER.read_text(encoding="utf-8"))
    except Exception:
        return False
    return marker.get("requirements_sha256") == requirements_hash()


def local_port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.12)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def wait_for_local_port(port: int, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if local_port_is_open(port):
            return True
        time.sleep(0.025)
    return local_port_is_open(port)


def dashboard_responds(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=0.6) as response:
            body = response.read(4096).decode("utf-8", errors="ignore")
        return "Apuana Monitor" in body
    except Exception:
        return False


def dashboard_has_snapshot(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api", timeout=0.8) as response:
            payload = json.loads(response.read(4096).decode("utf-8", errors="ignore") or "{}")
        return bool(payload.get("ts"))
    except Exception:
        return False


def select_port(preferred: int) -> int:
    if not local_port_is_open(preferred):
        return preferred
    if dashboard_responds(preferred) and dashboard_has_snapshot(preferred):
        return preferred

    for candidate in [8520, *range(8502, 8520), *range(8521, 8600)]:
        if not local_port_is_open(candidate):
            log(f"preferred port {preferred} is occupied by another service; using {candidate}")
            return candidate
        if dashboard_responds(candidate) and dashboard_has_snapshot(candidate):
            log(f"preferred port {preferred} is occupied; reusing Apuana on {candidate}")
            return candidate

    raise RuntimeError("no available local port for Apuana Monitor")


def loading_page_html(status: str = "Preparando o servidor local.") -> str:
    logo = APP_ICON_PNG.resolve().as_uri() if APP_ICON_PNG.exists() else ""
    image = f'<img src="{logo}" alt="">' if logo else ""
    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Apuana Monitor</title>
<style>
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#080d0a;color:#eef4ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
main{{width:min(420px,calc(100vw - 32px));padding:36px 30px;border:1px solid rgba(148,163,184,.22);border-radius:20px;background:#101416;text-align:center;box-shadow:0 24px 90px rgba(0,0,0,.45)}}
img{{width:86px;height:86px;object-fit:contain;margin-bottom:18px}}
h1{{margin:0;font-size:24px;line-height:1.2}}
p{{margin:10px 0 22px;color:#9aa7b3;line-height:1.45}}
.spinner{{width:34px;height:34px;margin:0 auto;border-radius:999px;border:3px solid rgba(20,199,123,.18);border-top-color:#14c77b;animation:spin .8s linear infinite}}
@keyframes spin{{to{{transform:rotate(360deg)}}}}
</style>
</head>
<body>
<main>{image}<h1>Carregando Apuana Monitor</h1><p>{status}</p><div class="spinner"></div></main>
</body>
</html>
"""


def error_page_html(message: str) -> str:
    safe_message = html.escape(message, quote=True)
    return loading_page_html(safe_message).replace('<div class="spinner"></div>', "")


def start_server(port: int) -> subprocess.Popen:
    if FROZEN:
        raise RuntimeError("frozen app uses start_bundled_server")

    env = os.environ.copy()
    env["SLURM_MONITOR_PORT"] = str(port)
    try:
        output = log_file().open("a", encoding="utf-8")
    except Exception:
        output = subprocess.DEVNULL
    kwargs = {
        "cwd": str(DASHBOARD_DIR),
        "env": env,
        "stdin": subprocess.DEVNULL,
        "stdout": output,
        "stderr": output,
    }
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen([str(venv_python()), "-m", "server"], **kwargs)


class BundledServerProcess:
    def __init__(self, thread: threading.Thread) -> None:
        self.thread = thread
        self.returncode: int | None = None

    def poll(self) -> int | None:
        return None if self.thread.is_alive() else self.returncode or 0


def start_bundled_server(port: int) -> BundledServerProcess:
    os.environ["SLURM_MONITOR_PORT"] = str(port)
    os.environ["APUANA_MONITOR_DASHBOARD_ROOT"] = str(DASHBOARD_DIR)

    def run_server() -> None:
        try:
            from server.__main__ import main as server_main

            server_main()
        except Exception:
            log(traceback.format_exc())
            raise

    thread = threading.Thread(target=run_server, daemon=True)
    thread.start()
    return BundledServerProcess(thread)


def bootstrap_command() -> list[str]:
    run_py = ROOT / "run.py"
    if not getattr(sys, "frozen", False):
        return [sys.executable, str(run_py), "--prepare-only"]
    for name in ("python3", "python"):
        executable = shutil.which(name)
        if executable:
            return [executable, str(run_py), "--prepare-only"]
    return [str(venv_python()), str(run_py), "--prepare-only"]


def delegate_to_bootstrap() -> int:
    log("dependencies are not ready; delegating to bootstrap")
    return subprocess.call(bootstrap_command())


def relaunch_with_venv_python() -> None:
    if FROZEN:
        return

    python = venv_python()
    if not python.exists():
        return

    try:
        current = Path(sys.executable).resolve()
        target = python.resolve()
    except Exception:
        current = Path(sys.executable)
        target = python

    if current == target:
        return

    log(f"relaunching desktop app with virtualenv python: {target}")
    os.execv(str(python), [str(python), str(Path(__file__).resolve())])


def open_app_window(url: str, port: int, wait_for_ready: bool = True) -> bool:
    try:
        import webview
    except Exception as exc:
        log(f"pywebview import failed: {exc}")
        return False

    try:
        if platform.system().lower() == "darwin":
            try:
                import AppKit

                image = AppKit.NSImage.alloc().initWithContentsOfFile_(str(APP_ICON_PNG))
                if image:
                    AppKit.NSApplication.sharedApplication().setApplicationIconImage_(image)
            except Exception as exc:
                log(f"macOS app icon setup skipped: {exc}")

        window_kwargs = {
            "title": "Apuana Monitor",
            "width": 1280,
            "height": 860,
            "min_size": (960, 640),
            "confirm_close": False,
            "background_color": "#080d0a",
        }
        if wait_for_ready and not local_port_is_open(port):
            window = webview.create_window(
                html=loading_page_html(),
                **window_kwargs,
            )
        else:
            window = webview.create_window(
                url=url,
                **window_kwargs,
            )
        if APP_ICON_PNG.exists():
            try:
                window.icon = str(APP_ICON_PNG)
            except Exception:
                pass

        def load_when_ready() -> None:
            if wait_for_ready and not wait_for_local_port(port, 10.0):
                window.load_html(error_page_html("Nao foi possivel iniciar o servidor local. Consulte o log do Apuana Monitor."))
                return
            window.load_url(url)

        webview_kwargs = {"debug": False}
        if platform.system().lower() == "darwin":
            os.environ.pop("PYWEBVIEW_GUI", None)

        if wait_for_ready and not local_port_is_open(port):
            webview.start(load_when_ready, **webview_kwargs)
        else:
            webview.start(**webview_kwargs)
        return True
    except Exception as exc:
        log(f"pywebview window failed: {exc}")
        return False


def open_browser_dashboard(url: str) -> None:
    system = platform.system().lower()
    commands: list[list[str]] = []

    if system == "darwin":
        commands = [["open", url]]
    elif os.name == "nt":
        try:
            os.startfile(url)  # type: ignore[attr-defined]
            return
        except Exception:
            commands = [["cmd", "/c", "start", "", url]]
    else:
        commands = [
            ["xdg-open", url],
            ["gio", "open", url],
            ["kde-open", url],
            ["sensible-browser", url],
            ["x-www-browser", url],
        ]

    for command in commands:
        if command[0] != "cmd" and not shutil.which(command[0]):
            continue
        try:
            subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except Exception as exc:
            log(f"browser opener failed {' '.join(command)}: {exc}")

    webbrowser.open(url)


def open_dashboard(url: str, port: int, wait_for_ready: bool = True) -> bool:
    if open_app_window(url, port, wait_for_ready):
        return True
    if os.environ.get("APUANA_MONITOR_DISABLE_BROWSER_FALLBACK") == "1":
        log("native app window failed and browser fallback is disabled")
        return False
    log("native app window could not be opened; falling back to browser")
    open_browser_dashboard(url)
    return True


def main() -> int:
    requested_port = int(os.environ.get("SLURM_MONITOR_PORT", "8501"))
    port = select_port(requested_port)
    url = f"http://127.0.0.1:{port}/"
    log(f"desktop launcher started for {url}")

    if not deps_are_ready():
        code = delegate_to_bootstrap()
        if code != 0 or not deps_are_ready():
            log(f"bootstrap failed with code {code}")
            return code
    relaunch_with_venv_python()

    if local_port_is_open(port):
        log("server already running; opening dashboard")
        return 0 if open_dashboard(url, port, wait_for_ready=False) else 1

    log("starting local server")
    process = start_bundled_server(port) if FROZEN else start_server(port)
    log("opening dashboard app window")
    opened = open_dashboard(url, port, wait_for_ready=True)
    code = 0 if process.poll() is None else process.returncode or 0
    if not opened and code == 0:
        code = 1
    log(f"desktop launcher finished with code {code}")
    return code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        log(traceback.format_exc())
        raise
