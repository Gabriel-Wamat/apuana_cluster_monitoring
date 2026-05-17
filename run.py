#!/usr/bin/env python3
"""Bootstrap dependencies once and start the local Apuana Monitor."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import venv
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DASHBOARD_DIR = ROOT / "apuana" / "dashboard"
REQUIREMENTS = ROOT / "requirements.txt"
VENV_DIR = ROOT / ".venv"
MARKER = VENV_DIR / ".apuana-monitor-deps.json"


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def requirements_hash() -> str:
    return hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()


def run(cmd: list[str], **kwargs) -> None:
    subprocess.check_call(cmd, **kwargs)


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
        [str(python), "-c", "import paramiko"],
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local Apuana Monitor dashboard.")
    parser.add_argument("--port", default=os.environ.get("SLURM_MONITOR_PORT", "8501"), help="local HTTP port")
    parser.add_argument("--host", default=os.environ.get("SLURM_MONITOR_SSH_HOST", ""), help="Apuana SSH host")
    parser.add_argument("--transfer-host", default=os.environ.get("SLURM_MONITOR_TRANSFER_HOST", ""), help="host used in transfer commands")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    python = ensure_venv()
    ensure_deps(python)

    env = os.environ.copy()
    env["SLURM_MONITOR_PORT"] = str(args.port)
    if args.host:
        env["SLURM_MONITOR_SSH_HOST"] = args.host
    if args.transfer_host:
        env["SLURM_MONITOR_TRANSFER_HOST"] = args.transfer_host

    url = f"http://127.0.0.1:{args.port}/"
    print(f"[apuana] starting dashboard at {url}")
    if not args.no_browser:
        webbrowser.open(url)

    return subprocess.call([str(python), "-m", "server"], cwd=str(DASHBOARD_DIR), env=env)


if __name__ == "__main__":
    raise SystemExit(main())
