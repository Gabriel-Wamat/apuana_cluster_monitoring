#!/usr/bin/env python3
"""Compatibility entrypoint for the legacy Apuana dashboard name."""

from pathlib import Path
import runpy
import sys


target_dir = Path(__file__).resolve().parent / "streamlit_dashboard"
sys.path.insert(0, str(target_dir))
runpy.run_path(
    str(target_dir / "dashboard_apuana.py"),
    run_name="__main__",
)
