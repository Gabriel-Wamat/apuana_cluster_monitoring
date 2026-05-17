import os
import platform
import subprocess
from pathlib import Path


def _picker_result(path: Path) -> dict:
    resolved = path.resolve(strict=False)
    return {
        "ok": resolved.is_dir(),
        "path": str(resolved),
        "error": "" if resolved.is_dir() else f"Selected path is not a directory: {resolved}",
    }


def _choose_with_tkinter() -> dict:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:
        return {"ok": False, "path": "", "error": f"Native folder picker is not available: {exc}"}

    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="Choose the local destination folder")
        root.destroy()
    except Exception as exc:
        return {"ok": False, "path": "", "error": f"Could not open local folder picker: {exc}"}

    if not selected:
        return {"ok": False, "path": "", "canceled": True, "error": "Folder selection canceled."}
    return _picker_result(Path(selected))


def _choose_local_folder() -> dict:
    mocked = os.environ.get("APUANA_LOCAL_PICKER_RESPONSE", "").strip()
    if mocked:
        return _picker_result(Path(os.path.expanduser(os.path.expandvars(mocked))))

    if platform.system() == "Darwin":
        script = 'POSIX path of (choose folder with prompt "Choose the local destination folder")'
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "path": "", "error": "Folder selection timed out."}
        except Exception:
            result = None

        if result is not None and result.returncode == 0:
            return _picker_result(Path(result.stdout.strip()))
        if result is not None:
            stderr = (result.stderr or "").strip()
            canceled = "User canceled" in stderr or "(-128)" in stderr
            if canceled:
                return {"ok": False, "path": "", "canceled": True, "error": "Folder selection canceled."}

    return _choose_with_tkinter()
