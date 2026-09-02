#!/usr/bin/env bash
# Start the Apuana Monitor HTTP dashboard.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SLURM_MONITOR_PORT:-8501}"
PYTHON_BIN="${SLURM_MONITOR_PYTHON:-python3}"

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ./run.sh

Environment:
  SLURM_MONITOR_PORT           HTTP port, default: 8501
  SLURM_MONITOR_PYTHON         Python executable, default: python3
  SLURM_MONITOR_TRANSFER_HOST  Host used in generated rsync commands.
  SLURM_MONITOR_SSH_HOST       SSH host used by the local server.

Run this command on your own machine, then open:
  http://127.0.0.1:8501

The browser login screen opens the SSH session to Apuana.
EOF
    exit 0
    ;;
esac

cd "$SCRIPT_DIR"
export SLURM_MONITOR_PORT="$PORT"
if ! "$PYTHON_BIN" -c "import paramiko" >/dev/null 2>&1; then
  echo "[apuana] missing dependency: paramiko"
  echo "[apuana] install with: $PYTHON_BIN -m pip install paramiko"
  exit 1
fi
exec "$PYTHON_BIN" -m server
