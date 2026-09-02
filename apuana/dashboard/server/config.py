import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict


def _find_project_root() -> Path:
    """Encontra a raiz do projeto procurando por apuana.config.json subindo a árvore."""
    candidate = Path(__file__).resolve().parent
    for _ in range(8):
        if (candidate / "apuana.config.json").exists():
            return candidate
        if candidate == candidate.parent:
            break
        candidate = candidate.parent
    # fallback: config.py → server/ → dashboard/ → apuana/ → project root (4 levels)
    return Path(__file__).resolve().parent.parent.parent.parent


def _load_config() -> Dict[str, Any]:
    """Carrega configuração do arquivo apuana.config.json."""
    root = _find_project_root()
    config_file = root / "apuana.config.json"
    
    defaults = {
        "server": {"port": 8501, "host": "127.0.0.1"},
        "cluster": {
            "ssh_host": "",
            "transfer_host": "",
            "default_user": None,
        },
        "paths": {
            "research_templates": "apuana/research_templates",
            "dashboard_root": "apuana/dashboard",
        },
        "features": {
            "auto_login": True,
            "keychain_integration": True,
            "browser_auto_open": True,
        },
    }
    
    if not config_file.exists():
        return defaults
    
    try:
        with config_file.open("r", encoding="utf-8") as f:
            user_config = json.load(f)

        config = defaults.copy()
        for key in ["server", "cluster", "paths", "features"]:
            if key in user_config:
                config[key] = {**defaults.get(key, {}), **user_config[key]}

        return config
    except json.JSONDecodeError as exc:
        print(f"[apuana] AVISO: apuana.config.json inválido ({exc}), usando defaults.", file=sys.stderr)
        return defaults
    except Exception as exc:
        print(f"[apuana] AVISO: erro ao ler apuana.config.json ({exc}), usando defaults.", file=sys.stderr)
        return defaults


_CONFIG = _load_config()
_PROJECT_ROOT = _find_project_root()

# Server config
PORT = int(os.environ.get("SLURM_MONITOR_PORT") or _CONFIG["server"]["port"])
HOST = os.environ.get("SLURM_MONITOR_HOST") or _CONFIG["server"]["host"]

# Cluster config
SSH_HOST = os.environ.get("SLURM_MONITOR_SSH_HOST") or _CONFIG["cluster"]["ssh_host"]
TRANSFER_HOST = os.environ.get("SLURM_MONITOR_TRANSFER_HOST") or _CONFIG["cluster"]["transfer_host"]
DEFAULT_USER = _CONFIG["cluster"].get("default_user")

# Features
AUTO_LOGIN = _CONFIG["features"]["auto_login"]
KEYCHAIN_INTEGRATION = _CONFIG["features"]["keychain_integration"]
BROWSER_AUTO_OPEN = _CONFIG["features"]["browser_auto_open"]

# Paths
DASHBOARD_ROOT = _PROJECT_ROOT / _CONFIG["paths"]["dashboard_root"]
RESEARCH_TEMPLATES_ROOT = _PROJECT_ROOT / _CONFIG["paths"]["research_templates"]

# Constants
AUTH_HEADER = "X-SSH-Token"
JOB_ID_RE = re.compile(r"^\d+(?:_(?:\d+|\[\d+(?:-\d+)?\]))?(?:\.(?:batch|\d+))?$")
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
    ".ttf": "font/ttf",
}
