#!/usr/bin/env python3
"""Bootstrap dependencies once and start the local Apuana Monitor."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import venv
import webbrowser
from pathlib import Path
from typing import Optional, Union


ROOT = Path(__file__).resolve().parent
DASHBOARD_DIR = ROOT / "apuana" / "dashboard"
ICON_PNG = ROOT / "apuana" / "dashboard" / "static" / "assets" / "apuana.png"
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
    run_py = shell_quote(ROOT / "run.py")
    return f"""#!/usr/bin/env bash
set -euo pipefail
cd {root}
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
exec "$PY" {run_py}
"""


def create_macos_icon(app_dir: Path) -> str:
    resources = app_dir / "Contents" / "Resources"
    resources.mkdir(parents=True, exist_ok=True)
    if not ICON_PNG.exists():
        return ""

    icns = resources / "ApuanaMonitor.icns"
    if shutil.which("sips") and shutil.which("iconutil"):
        try:
            with tempfile.TemporaryDirectory() as tmp:
                iconset = Path(tmp) / "ApuanaMonitor.iconset"
                iconset.mkdir()
                for size in (16, 32, 64, 128, 256, 512):
                    run(["sips", "-z", str(size), str(size), str(ICON_PNG), "--out", str(iconset / f"icon_{size}x{size}.png")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    run(["sips", "-z", str(size * 2), str(size * 2), str(ICON_PNG), "--out", str(iconset / f"icon_{size}x{size}@2x.png")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                run(["iconutil", "-c", "icns", str(iconset), "-o", str(icns)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return "ApuanaMonitor"
        except Exception:
            pass

    shutil.copy2(ICON_PNG, resources / "ApuanaMonitor.png")
    return ""


def ensure_macos_launcher(target_dir: Path) -> Path:
    app_dir = target_dir / f"{LAUNCHER_NAME}.app"
    contents = app_dir / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"
    macos.mkdir(parents=True, exist_ok=True)
    resources.mkdir(parents=True, exist_ok=True)

    executable = macos / LAUNCHER_NAME
    write_text_executable(executable, python_launcher_script())
    icon_name = create_macos_icon(app_dir)
    icon_key = f"<key>CFBundleIconFile</key><string>{icon_name}</string>" if icon_name else ""
    (contents / "Info.plist").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>{LAUNCHER_NAME}</string>
  <key>CFBundleDisplayName</key><string>{LAUNCHER_NAME}</string>
  <key>CFBundleExecutable</key><string>{LAUNCHER_NAME}</string>
  <key>CFBundleIdentifier</key><string>local.apuana.monitor</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  {icon_key}
  <key>LSUIElement</key><true/>
</dict>
</plist>
""", encoding="utf-8")
    return app_dir


def ensure_linux_launcher(target_dir: Path) -> Path:
    launcher = target_dir / f"{LAUNCHER_NAME}.desktop"
    target_dir.mkdir(parents=True, exist_ok=True)
    icon = ICON_PNG if ICON_PNG.exists() else ""
    root = shell_quote(ROOT)
    python = shell_quote(sys.executable)
    run_py = shell_quote(ROOT / "run.py")
    launcher.write_text(f"""[Desktop Entry]
Type=Application
Name={LAUNCHER_NAME}
Comment=Open the local Apuana Monitor dashboard
Exec=/bin/sh -c "cd {root} && exec {python} {run_py}"
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
python = root & "\\.venv\\Scripts\\pythonw.exe"
If Not fso.FileExists(python) Then
  python = "pythonw"
End If
shell.CurrentDirectory = root
command = Chr(34) & python & Chr(34) & " " & Chr(34) & root & "\\run.py" & Chr(34)
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


def ensure_venv() -> Path:
    python = venv_python()
    if not python.exists():
        print("[apuana] creating local virtual environment in .venv")
        venv.EnvBuilder(with_pip=True).create(VENV_DIR)
    return python


def deps_are_ready(python: Path, expected_hash: str) -> bool:
    try:
        marker = json.loads(MARKER.read_text(encoding="utf-8"))
    except Exception:
        return False
    if marker.get("requirements_sha256") != expected_hash:
        return False
    check = subprocess.run(
        [str(python), "-c", "import paramiko, keyring"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return check.returncode == 0


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local Apuana Monitor dashboard.")
    parser.add_argument("--port", default=os.environ.get("SLURM_MONITOR_PORT", "8501"), help="local HTTP port")
    parser.add_argument("--host", default=os.environ.get("SLURM_MONITOR_SSH_HOST", ""), help="Apuana SSH host")
    parser.add_argument("--transfer-host", default=os.environ.get("SLURM_MONITOR_TRANSFER_HOST", ""), help="host used in transfer commands")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    launcher = ensure_desktop_launcher()
    if launcher:
        print(f"[apuana] desktop launcher ready: {launcher}")
    python = ensure_venv()
    ensure_deps(python)

    env = os.environ.copy()
    env["SLURM_MONITOR_PORT"] = str(args.port)
    if args.host:
        env["SLURM_MONITOR_SSH_HOST"] = args.host
    if args.transfer_host:
        env["SLURM_MONITOR_TRANSFER_HOST"] = args.transfer_host

    url = f"http://127.0.0.1:{args.port}/"
    if local_port_is_open(str(args.port)):
        print(f"[apuana] dashboard already running at {url}")
        if not args.no_browser:
            webbrowser.open(url)
        return 0

    print(f"[apuana] starting dashboard at {url}")
    if not args.no_browser:
        webbrowser.open(url)

    return subprocess.call([str(python), "-m", "server"], cwd=str(DASHBOARD_DIR), env=env)


if __name__ == "__main__":
    raise SystemExit(main())
