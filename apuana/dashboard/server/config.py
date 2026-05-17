import os
import re
from pathlib import Path

PORT = int(os.environ.get("SLURM_MONITOR_PORT", 8501))
USER = os.environ.get("USER", "")
TRANSFER_HOST = os.environ.get(
    "SLURM_MONITOR_TRANSFER_HOST",
    os.environ.get("APUANA_MONITOR_TRANSFER_HOST", "slurm-client1.cin.ufpe.br"),
)
SSH_HOST = os.environ.get("SLURM_MONITOR_SSH_HOST", "slurm-client2.cin.ufpe.br")
AUTH_HEADER = "X-SSH-Token"
JOB_ID_RE = re.compile(r"^\d+(?:_(?:\d+|\[\d+(?:-\d+)?\]))?(?:\.(?:batch|\d+))?$")
DASHBOARD_ROOT = Path(__file__).resolve().parent.parent
HTML = DASHBOARD_ROOT / "static" / "index.html"
STATIC_ROOT = DASHBOARD_ROOT / "static"
PARTIAL_ROOT = STATIC_ROOT / "partials"
STATIC_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
