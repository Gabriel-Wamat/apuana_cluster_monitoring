#!/usr/bin/env python3
"""Bootstrap dependencies once and start the local Apuana Monitor."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import venv
import webbrowser
from pathlib import Path
from typing import Callable, Optional, Union


ROOT = Path(__file__).resolve().parent
DASHBOARD_DIR = ROOT / "apuana" / "dashboard"
DESKTOP_LAUNCHER = ROOT / "apuana" / "bin" / "desktop_launch.py"
ICON_PNG = ROOT / "apuana" / "dashboard" / "static" / "assets" / "apuana.png"
APP_ICON_PNG = ROOT / "apuana" / "dashboard" / "static" / "assets" / "apuana-app-icon.png"
REQUIREMENTS = ROOT / "requirements.txt"
VENV_DIR = ROOT / ".venv"
MARKER = VENV_DIR / ".apuana-monitor-deps.json"
LAUNCHER_NAME = "Apuana Monitor"


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def requirements_hash() -> str:
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()


def run(cmd: list[str], **kwargs) -> None:
    subprocess.check_call(cmd, **kwargs)


def desktop_dir() -> Path:
    if os.name == "nt":
        return Path(os.environ.get("USERPROFILE", str(Path.home()))) / "Desktop"

    config = Path.home() / ".config" / "user-dirs.dirs"
    if config.exists():
        for line in config.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("XDG_DESKTOP_DIR="):
                raw = line.split("=", 1)[1].strip().strip('"')
                return Path(raw.replace("$HOME", str(Path.home()))).expanduser()

    return Path.home() / "Desktop"


def shell_quote(value: Union[Path, str]) -> str:
    return "'" + str(value).replace("'", "'\"'\"'") + "'"


def write_text_executable(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    if os.name != "nt":
        path.chmod(path.stat().st_mode | 0o755)


def python_launcher_script() -> str:
    root = shell_quote(ROOT)
    launcher_py = shell_quote(DESKTOP_LAUNCHER)
    return f"""#!/usr/bin/env bash
set -euo pipefail
cd {root}
export APUANA_MONITOR_SKIP_DESKTOP_LAUNCHER=1
if [[ -x ".venv/bin/python" ]]; then
  PY=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PY="$(command -v python)"
else
  if command -v osascript >/dev/null 2>&1; then
    osascript -e 'display alert "Python 3 not found" message "Install Python 3 and open Apuana Monitor again."'
  fi
  exit 1
fi
nohup "$PY" {launcher_py} >/dev/null 2>&1 &
exit 0
"""


def c_string(value: Union[Path, str]) -> str:
    return json.dumps(str(value))


def macos_native_launcher_source() -> str:
    root = c_string(ROOT)
    launcher_py = c_string(DESKTOP_LAUNCHER)
    return f"""
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static int is_exec(const char *path) {{
  return access(path, X_OK) == 0;
}}

static void append_log(const char *message) {{
  const char *home = getenv("HOME");
  if (!home || !home[0]) {{
    return;
  }}

  char dir[4096];
  char path[4096];
  snprintf(dir, sizeof(dir), "%s/Library/Logs/Apuana Monitor", home);
  mkdir(dir, 0755);
  snprintf(path, sizeof(path), "%s/launcher.log", dir);

  FILE *file = fopen(path, "a");
  if (!file) {{
    return;
  }}

  time_t now = time(NULL);
  struct tm local_time;
  localtime_r(&now, &local_time);
  char stamp[32];
  strftime(stamp, sizeof(stamp), "%Y-%m-%d %H:%M:%S", &local_time);
  fprintf(file, "[%s] %s\\n", stamp, message);
  fclose(file);
}}

int main(void) {{
  const char *root = {root};
  const char *launcher = {launcher_py};
  char python[4096];
  char detail[8192];

  append_log("native launcher started");

  if (chdir(root) != 0) {{
    snprintf(detail, sizeof(detail), "could not enter project root: %s", strerror(errno));
    append_log(detail);
    return 126;
  }}

  setenv("APUANA_MONITOR_SKIP_DESKTOP_LAUNCHER", "1", 1);
  snprintf(python, sizeof(python), "%s/.venv/bin/python", root);

  if (is_exec(python)) {{
    append_log("starting with project virtualenv python");
    char *const argv[] = {{ python, (char *)launcher, NULL }};
    execv(python, argv);
    snprintf(detail, sizeof(detail), "virtualenv python exec failed: %s", strerror(errno));
    append_log(detail);
  }}

  append_log("project virtualenv python missing, trying python3 from PATH");
  char *const fallback_argv[] = {{ "python3", (char *)launcher, NULL }};
  execvp("python3", fallback_argv);

  snprintf(detail, sizeof(detail), "python3 exec failed: %s", strerror(errno));
  append_log(detail);
  return 127;
}}
""".strip() + "\n"


def write_macos_native_executable(executable: Path) -> bool:
    compiler = shutil.which("clang") or shutil.which("cc")
    if not compiler:
        return False

    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "apuana-monitor-launcher.c"
        source.write_text(macos_native_launcher_source(), encoding="utf-8")
        try:
            run([compiler, "-Os", str(source), "-o", str(executable)])
        except Exception:
            return False

    executable.chmod(0o755)
    return True


def sign_macos_app(app_dir: Path) -> None:
    if not shutil.which("codesign"):
        return
    try:
        run(["codesign", "--force", "--sign", "-", str(app_dir)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def write_macos_icns(icon_source: Path, icns: Path) -> bool:
    if not icon_source.exists() or not shutil.which("sips") or not shutil.which("iconutil"):
        return False

    try:
        with tempfile.TemporaryDirectory() as tmp:
            iconset = Path(tmp) / "ApuanaMonitor.iconset"
            iconset.mkdir()
            for size in (16, 32, 128, 256, 512):
                run(["sips", "-z", str(size), str(size), str(icon_source), "--out", str(iconset / f"icon_{size}x{size}.png")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                run(["sips", "-z", str(size * 2), str(size * 2), str(icon_source), "--out", str(iconset / f"icon_{size}x{size}@2x.png")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False


def create_macos_icon(app_dir: Path) -> str:
    resources = app_dir / "Contents" / "Resources"
    resources.mkdir(parents=True, exist_ok=True)
    icon_source = APP_ICON_PNG if APP_ICON_PNG.exists() else ICON_PNG
    if not icon_source.exists():
        return ""

    icns = resources / "ApuanaMonitor.icns"
    if write_macos_icns(icon_source, icns):
        return "ApuanaMonitor.icns"

    shutil.copy2(icon_source, resources / "ApuanaMonitor.png")
    return "ApuanaMonitor.png"


def pyinstaller_available(python: Path) -> bool:
    try:
        subprocess.check_call(
            [str(python), "-m", "PyInstaller", "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception:
        return False


def write_macos_pyinstaller_app(app_dir: Path) -> bool:
    python = venv_python()
    if not python.exists() or not pyinstaller_available(python):
        return False

    icon_source = APP_ICON_PNG if APP_ICON_PNG.exists() else ICON_PNG

    with tempfile.TemporaryDirectory(prefix="apuana-monitor-build-") as tmp:
        tmp_dir = Path(tmp)
        icon_args: list[str] = []
        icon = tmp_dir / "ApuanaMonitor.icns"
        if write_macos_icns(icon_source, icon):
            icon_args = ["--icon", str(icon)]

        data_args = [
            "--add-data",
            f"{DASHBOARD_DIR / 'static'}:apuana/dashboard/static",
        ]

        dist = tmp_dir / "dist"
        work = tmp_dir / "build"
        spec = tmp_dir / "spec"
        command = [
            str(python),
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--windowed",
            "--name",
            LAUNCHER_NAME,
            "--osx-bundle-identifier",
            "local.apuana.monitor",
            "--distpath",
            str(dist),
            "--workpath",
            str(work),
            "--specpath",
            str(spec),
            "--paths",
            str(DASHBOARD_DIR),
            "--collect-submodules",
            "webview",
            "--hidden-import",
            "server.__main__",
            "--hidden-import",
            "server.http",
            "--hidden-import",
            "server.slurm",
            *data_args,
            *icon_args,
            str(DESKTOP_LAUNCHER),
        ]
        try:
            run(command)
        except Exception:
            return False

        built_app = dist / f"{LAUNCHER_NAME}.app"
        if not built_app.exists():
            return False

        if app_dir.exists():
            shutil.rmtree(app_dir)
        shutil.copytree(built_app, app_dir)
        sign_macos_app(app_dir)
        os.utime(app_dir, None)
        return True


def macos_launcher_is_current(app_dir: Path) -> bool:
    contents = app_dir / "Contents"
    executable = contents / "MacOS" / LAUNCHER_NAME
    info = contents / "Info.plist"
    pkg = contents / "PkgInfo"
    icon = contents / "Resources" / "ApuanaMonitor.icns"
    required = (executable, info, pkg, icon)
    if not all(path.exists() for path in required):
        return False
    try:
        info_text = info.read_text(encoding="utf-8", errors="ignore")
        if "LSUIElement" in info_text:
            return False
        if shutil.which("clang") or shutil.which("cc"):
            if executable.read_bytes().startswith(b"#!"):
                return False
    except Exception:
        return False

    icon_source = APP_ICON_PNG if APP_ICON_PNG.exists() else ICON_PNG
    sources = [ROOT / "run.py", DESKTOP_LAUNCHER]
    if icon_source.exists():
        sources.append(icon_source)

    oldest_output = min(path.stat().st_mtime for path in required)
    return max(path.stat().st_mtime for path in sources) <= oldest_output


def ensure_macos_launcher(target_dir: Path) -> Path:
    app_dir = target_dir / f"{LAUNCHER_NAME}.app"
    if app_dir.exists() and macos_launcher_is_current(app_dir):
        return app_dir

    if write_macos_pyinstaller_app(app_dir):
        return app_dir

    if app_dir.exists():
        shutil.rmtree(app_dir)

    contents = app_dir / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"
    macos.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)

    executable = macos / LAUNCHER_NAME
    if not write_macos_native_executable(executable):
        write_text_executable(executable, python_launcher_script())
    icon_file = create_macos_icon(app_dir)
    icon_name = Path(icon_file).stem if icon_file else ""
    icon_keys = (
        f"<key>CFBundleIconFile</key><string>{icon_file}</string>\n"
        f"  <key>CFBundleIconName</key><string>{icon_name}</string>"
        if icon_file
        else ""
    )
    (contents / "Info.plist").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>{LAUNCHER_NAME}</string>
  <key>CFBundleDisplayName</key><string>{LAUNCHER_NAME}</string>
  <key>CFBundleExecutable</key><string>{LAUNCHER_NAME}</string>
  <key>CFBundleIdentifier</key><string>local.apuana.monitor</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  {icon_keys}
</dict>
</plist>
""", encoding="utf-8")
    (contents / "PkgInfo").write_text("APPL????", encoding="ascii")
    sign_macos_app(app_dir)
    os.utime(app_dir, None)
    return app_dir


def ensure_linux_launcher(target_dir: Path) -> Path:
    launcher = target_dir / f"{LAUNCHER_NAME}.desktop"
    target_dir.mkdir(parents=True, exist_ok=True)
    icon = ICON_PNG if ICON_PNG.exists() else ""
    root = shell_quote(ROOT)
    python = shell_quote(sys.executable)
    launcher_py = shell_quote(DESKTOP_LAUNCHER)
    launcher.write_text(f"""[Desktop Entry]
Type=Application
Name={LAUNCHER_NAME}
Comment=Open the local Apuana Monitor dashboard
Exec=/bin/sh -c "cd {root} && nohup {python} {launcher_py} >/dev/null 2>&1 &"
Icon={icon}
Terminal=false
Categories=Utility;
StartupNotify=false
""", encoding="utf-8")
    launcher.chmod(launcher.stat().st_mode | 0o755)
    return launcher


def ensure_windows_launcher(target_dir: Path) -> Path:
    launcher = target_dir / f"{LAUNCHER_NAME}.vbs"
    target_dir.mkdir(parents=True, exist_ok=True)
    root = str(ROOT).replace('"', '""')
    launcher.write_text(f"""Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = "{root}"
launcher = root & "\\apuana\\bin\\desktop_launch.py"
python = root & "\\.venv\\Scripts\\pythonw.exe"
If Not fso.FileExists(python) Then
  python = "pythonw"
End If
shell.CurrentDirectory = root
command = Chr(34) & python & Chr(34) & " " & Chr(34) & launcher & Chr(34)
shell.Run command, 0, False
""", encoding="utf-8")
    return launcher


def ensure_desktop_launcher() -> Optional[Path]:
    if os.environ.get("APUANA_MONITOR_SKIP_DESKTOP_LAUNCHER") == "1":
        return None

    target_dir = desktop_dir()
    try:
        system = platform.system().lower()
        if system == "darwin":
            return ensure_macos_launcher(target_dir)
        if system == "linux":
            return ensure_linux_launcher(target_dir)
        if system == "windows":
            return ensure_windows_launcher(target_dir)
    except Exception as exc:
        print(f"[apuana] could not create desktop launcher: {exc}")
        return None

    return None


def write_browser_loading_page(url: str) -> Path:
    logo = APP_ICON_PNG.resolve().as_uri() if APP_ICON_PNG.exists() else ""
    target = json.dumps(url)
    logo_html = f'<img src="{html.escape(logo, quote=True)}" alt="">' if logo else ""
    page = Path(tempfile.gettempdir()) / f"apuana-monitor-loading-{os.getpid()}.html"
    page.write_text(f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Apuana Monitor</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #080d0a;
    color: #eef4ff;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }}
  main {{
    width: min(420px, calc(100vw - 32px));
    padding: 36px 30px;
    border: 1px solid rgba(148, 163, 184, .22);
    border-radius: 20px;
    background: #101416;
    box-shadow: 0 24px 90px rgba(0, 0, 0, .45);
    text-align: center;
  }}
  img {{ width: 86px; height: 86px; object-fit: contain; margin-bottom: 18px; }}
  h1 {{ margin: 0; font-size: 24px; line-height: 1.2; }}
  p {{ margin: 10px 0 22px; color: #9aa7b3; line-height: 1.45; }}
  .spinner {{
    width: 34px;
    height: 34px;
    margin: 0 auto;
    border-radius: 999px;
    border: 3px solid rgba(20, 199, 123, .18);
    border-top-color: #14c77b;
    animation: spin .8s linear infinite;
  }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
</style>
</head>
<body>
<main>
  {logo_html}
  <h1>Carregando Apuana Monitor</h1>
  <p>Preparando o servidor local.</p>
  <div class="spinner" aria-hidden="true"></div>
</main>
<script>
const target = {target};
async function check() {{
  try {{
    await fetch(target, {{ mode: "no-cors", cache: "no-store" }});
    window.location.replace(target);
  }} catch (_) {{
    setTimeout(check, 600);
  }}
}}
setTimeout(check, 300);
</script>
</body>
</html>
""", encoding="utf-8")
    return page


def start_browser_loading_notice(url: str) -> Optional[Callable[[], None]]:
    try:
        page = write_browser_loading_page(url)
        open_url(page.resolve().as_uri())
    except Exception:
        return None

    def close_page() -> None:
        try:
            page.unlink(missing_ok=True)
        except Exception:
            pass

    return close_page


def start_loading_notice(enabled: bool, url: str) -> Optional[Callable[[], None]]:
    if not enabled:
        return None

    stop_file = Path(tempfile.gettempdir()) / f"apuana-monitor-loading-{os.getpid()}.stop"
    ready_file = Path(tempfile.gettempdir()) / f"apuana-monitor-loading-{os.getpid()}.ready"
    try:
        stop_file.unlink(missing_ok=True)
        ready_file.unlink(missing_ok=True)
    except Exception:
        pass

    script = r"""
import sys
import time
from pathlib import Path

stop_file = Path(sys.argv[1])
ready_file = Path(sys.argv[2])
icon_file = Path(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else None
started_at = time.monotonic()

try:
    import tkinter as tk
    from tkinter import ttk
except Exception:
    raise SystemExit(0)

root = tk.Tk()
root.title("Apuana Monitor")
root.resizable(False, False)
root.configure(bg="#101416")

try:
    root.attributes("-topmost", True)
    root.after(900, lambda: root.attributes("-topmost", False))
except Exception:
    pass

try:
    root.attributes("-toolwindow", True)
except Exception:
    pass

frame = tk.Frame(root, bg="#101416", padx=28, pady=24)
frame.pack(fill="both", expand=True)

photo = None
if icon_file and icon_file.exists():
    try:
        photo = tk.PhotoImage(file=str(icon_file))
        scale = max(photo.width() // 72, photo.height() // 72, 1)
        if scale > 1:
            photo = photo.subsample(scale, scale)
        tk.Label(frame, image=photo, bg="#101416").pack(pady=(0, 14))
    except Exception:
        photo = None

tk.Label(
    frame,
    text="Carregando Apuana Monitor",
    bg="#101416",
    fg="#eef4ff",
    font=("Helvetica", 15, "bold"),
).pack()
tk.Label(
    frame,
    text="Preparando o servidor local e abrindo o navegador.",
    bg="#101416",
    fg="#9aa7b3",
    font=("Helvetica", 11),
).pack(pady=(8, 16))

bar = ttk.Progressbar(frame, mode="indeterminate", length=260)
bar.pack(fill="x")
bar.start(12)

def center():
    root.update_idletasks()
    width = root.winfo_width()
    height = root.winfo_height()
    x = (root.winfo_screenwidth() - width) // 2
    y = (root.winfo_screenheight() - height) // 2
    root.geometry(f"{width}x{height}+{x}+{y}")

def poll():
    if stop_file.exists() or time.monotonic() - started_at > 600:
        try:
            stop_file.unlink(missing_ok=True)
        except Exception:
            pass
        root.destroy()
        return
    root.after(120, poll)

center()
try:
    ready_file.write_text("ready\n", encoding="ascii")
except Exception:
    pass
root.after(120, poll)
root.mainloop()
"""

    try:
        kwargs = {
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
        }
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        else:
            kwargs["start_new_session"] = True
        process = subprocess.Popen([sys.executable, "-c", script, str(stop_file), str(ready_file), str(APP_ICON_PNG)], **kwargs)
    except Exception:
        return start_browser_loading_notice(url)

    deadline = time.monotonic() + 0.18
    while time.monotonic() < deadline:
        if ready_file.exists():
            break
        if process.poll() is not None:
            return start_browser_loading_notice(url)
        time.sleep(0.04)
    else:
        try:
            stop_file.write_text("done\n", encoding="ascii")
        except Exception:
            pass
        return start_browser_loading_notice(url)

    closed = False

    def close_notice() -> None:
        nonlocal closed
        if closed:
            return
        closed = True
        try:
            stop_file.write_text("done\n", encoding="ascii")
            ready_file.unlink(missing_ok=True)
        except Exception:
            pass

    return close_notice


def ensure_venv() -> Path:
    python = venv_python()
    if not python.exists():
        print("[apuana] creating local virtual environment in .venv")
        venv.EnvBuilder(with_pip=True).create(VENV_DIR)
    return python


def deps_are_ready(python: Path, expected_hash: str) -> bool:
    if not python.exists():
        return False
    try:
        marker = json.loads(MARKER.read_text(encoding="utf-8"))
    except Exception:
        return False
    if marker.get("requirements_sha256") != expected_hash:
        return False
    return True


def ensure_deps(python: Path) -> None:
    expected_hash = requirements_hash()
    if deps_are_ready(python, expected_hash):
        print("[apuana] dependencies already installed")
        return

    print("[apuana] installing dashboard dependencies")
    run([str(python), "-m", "pip", "install", "--upgrade", "pip"])
    run([str(python), "-m", "pip", "install", "-r", str(REQUIREMENTS)])
    MARKER.write_text(
        json.dumps(
            {
                "requirements_sha256": expected_hash,
                "python": subprocess.check_output([str(python), "--version"], text=True).strip(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def local_port_is_open(port: str) -> bool:
    try:
        value = int(port)
    except ValueError:
        return False

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", value)) == 0


def wait_for_local_port(port: str, timeout: float = 6.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if local_port_is_open(port):
            return True
        time.sleep(0.05)
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
        commands = [
            ["xdg-open", url],
            ["gio", "open", url],
            ["kde-open", url],
            ["sensible-browser", url],
            ["x-www-browser", url],
        ]

    for command in commands:
        if command[0] not in {"cmd"} and not shutil.which(command[0]):
            continue
        try:
            subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except Exception:
            continue

    webbrowser.open(url)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local Apuana Monitor dashboard.")
    parser.add_argument("--port", default=os.environ.get("SLURM_MONITOR_PORT", "8501"), help="local HTTP port")
    parser.add_argument("--host", default=os.environ.get("SLURM_MONITOR_SSH_HOST", ""), help="Apuana SSH host")
    parser.add_argument("--transfer-host", default=os.environ.get("SLURM_MONITOR_TRANSFER_HOST", ""), help="host used in transfer commands")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    parser.add_argument("--desktop-launch", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--prepare-only", action="store_true", help=argparse.SUPPRESS)
    return parser.parse_args()


def server_env(args: argparse.Namespace) -> dict[str, str]:
    env = os.environ.copy()
    env["SLURM_MONITOR_PORT"] = str(args.port)
    if args.host:
        env["SLURM_MONITOR_SSH_HOST"] = args.host
    if args.transfer_host:
        env["SLURM_MONITOR_TRANSFER_HOST"] = args.transfer_host
    return env


def start_server_process(python: Path, args: argparse.Namespace, detached: bool = False) -> subprocess.Popen:
    kwargs = {"cwd": str(DASHBOARD_DIR), "env": server_env(args)}
    if detached:
        kwargs.update({"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL})
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        else:
            kwargs["start_new_session"] = True
    return subprocess.Popen([str(python), "-m", "server"], **kwargs)


def desktop_python() -> Path:
    python = venv_python()
    if python.exists() and deps_are_ready(python, requirements_hash()):
        return python
    python = ensure_venv()
    ensure_deps(python)
    return python


def run_desktop_launch(args: argparse.Namespace, url: str) -> int:
    if local_port_is_open(str(args.port)):
        print(f"[apuana] dashboard already running at {url}")
        if not args.no_browser:
            open_url(url)
        return 0

    python = venv_python()
    deps_ready = python.exists() and deps_are_ready(python, requirements_hash())
    close_loading_notice = start_loading_notice(not args.no_browser and not deps_ready, url)

    def finish_loading_notice() -> None:
        if close_loading_notice:
            close_loading_notice()

    try:
        if not deps_ready:
            python = desktop_python()
        print(f"[apuana] starting dashboard at {url}")
        process = start_server_process(python, args, detached=True)
        if wait_for_local_port(str(args.port), timeout=0.35):
            if not args.no_browser:
                open_url(url)
            finish_loading_notice()
            return 0

        if not close_loading_notice:
            close_loading_notice = start_loading_notice(not args.no_browser, url)

        if not args.no_browser and wait_for_local_port(str(args.port)):
            open_url(url)
            finish_loading_notice()
        return 0 if process.poll() is None else process.returncode or 0
    finally:
        finish_loading_notice()


def main() -> int:
    args = parse_args()
    url = f"http://127.0.0.1:{args.port}/"
    if args.prepare_only:
        launcher = ensure_desktop_launcher()
        if launcher:
            print(f"[apuana] desktop launcher ready: {launcher}")
        python = ensure_venv()
        ensure_deps(python)
        return 0

    if args.desktop_launch:
        return run_desktop_launch(args, url)

    if local_port_is_open(str(args.port)):
        print(f"[apuana] dashboard already running at {url}")
        if not args.no_browser:
            open_url(url)
        return 0

    launcher = ensure_desktop_launcher()
    if launcher:
        print(f"[apuana] desktop launcher ready: {launcher}")
    python = ensure_venv()
    ensure_deps(python)

    print(f"[apuana] starting dashboard at {url}")
    process = start_server_process(python, args)
    if not args.no_browser and wait_for_local_port(str(args.port)):
        open_url(url)

    return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
