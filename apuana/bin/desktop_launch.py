#!/usr/bin/env python3
"""Fast desktop entrypoint for Apuana Monitor."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_DIR = ROOT / "apuana" / "dashboard"
APP_ICON_PNG = ROOT / "apuana" / "dashboard" / "static" / "assets" / "apuana-app-icon.png"
REQUIREMENTS = ROOT / "requirements.txt"
VENV_DIR = ROOT / ".venv"
MARKER = VENV_DIR / ".apuana-monitor-deps.json"


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def requirements_hash() -> str:
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()


def deps_are_ready() -> bool:
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


def open_url(url: str) -> None:
    system = platform.system().lower()
    commands: list[list[str]] = []
    if system == "darwin":
        commands = [["open", url]]
    elif system == "windows":
        try:
            os.startfile(url)  # type: ignore[attr-defined]
            return
        except Exception:
            commands = [["cmd", "/c", "start", "", url]]
    else:
        commands = [["xdg-open", url], ["gio", "open", url], ["kde-open", url], ["sensible-browser", url]]

    for command in commands:
        if command[0] != "cmd" and not shutil.which(command[0]):
            continue
        try:
            subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except Exception:
            continue
    webbrowser.open(url)


def write_loading_page(url: str) -> Path:
    logo = APP_ICON_PNG.resolve().as_uri() if APP_ICON_PNG.exists() else ""
    image = f'<img src="{logo}" alt="">' if logo else ""
    page = Path(tempfile.gettempdir()) / f"apuana-monitor-loading-{os.getpid()}.html"
    page.write_text(
        f"""<!doctype html>
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
<main>{image}<h1>Carregando Apuana Monitor</h1><p>Preparando o servidor local.</p><div class="spinner"></div></main>
<script>
const target = {json.dumps(url)};
async function check(){{
  try{{await fetch(target,{{mode:"no-cors",cache:"no-store"}}); window.location.replace(target);}}
  catch(_){{setTimeout(check,500);}}
}}
setTimeout(check,250);
</script>
</body>
</html>
""",
        encoding="utf-8",
    )
    return page


def start_server(port: int) -> subprocess.Popen:
    env = os.environ.copy()
    env["SLURM_MONITOR_PORT"] = str(port)
    kwargs = {
        "cwd": str(DASHBOARD_DIR),
        "env": env,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen([str(venv_python()), "-m", "server"], **kwargs)


def delegate_to_bootstrap() -> int:
    run_py = ROOT / "run.py"
    return subprocess.call([sys.executable, str(run_py), "--prepare-only"])


def open_app_window(url: str) -> bool:
    try:
        import webview
    except Exception:
        return False

    try:
        if platform.system().lower() == "darwin":
            try:
                import AppKit
                import Foundation

                Foundation.NSProcessInfo.processInfo().setProcessName_("Apuana Monitor")
                image = AppKit.NSImage.alloc().initWithContentsOfFile_(str(APP_ICON_PNG))
                if image:
                    AppKit.NSApplication.sharedApplication().setApplicationIconImage_(image)
            except Exception:
                pass

        window = webview.create_window(
            "Apuana Monitor",
            url,
            width=1280,
            height=860,
            min_size=(960, 640),
            confirm_close=False,
            background_color="#080d0a",
        )
        if APP_ICON_PNG.exists():
            try:
                window.icon = str(APP_ICON_PNG)
            except Exception:
                pass
        webview.start(icon=str(APP_ICON_PNG) if APP_ICON_PNG.exists() else None)
        return True
    except Exception:
        return False


def open_dashboard(url: str) -> None:
    if not open_app_window(url):
        open_url(url)


def main() -> int:
    port = int(os.environ.get("SLURM_MONITOR_PORT", "8501"))
    url = f"http://127.0.0.1:{port}/"
    if local_port_is_open(port):
        open_dashboard(url)
        return 0

    if not deps_are_ready():
        code = delegate_to_bootstrap()
        if code != 0 or not deps_are_ready():
            return code

    process = start_server(port)
    if wait_for_local_port(port, 0.32):
        open_dashboard(url)
        return 0

    page = write_loading_page(url)
    open_url(page.resolve().as_uri())
    wait_for_local_port(port, 6.0)
    if local_port_is_open(port):
        open_dashboard(url)
    return 0 if process.poll() is None else process.returncode or 0


if __name__ == "__main__":
    raise SystemExit(main())
