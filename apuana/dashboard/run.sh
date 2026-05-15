#!/usr/bin/env bash
# Start the Apuana Monitor HTTP dashboard.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SLURM_MONITOR_PORT:-${SLURM_MONITOR_STREAMLIT_PORT:-8501}}"
PYTHON_BIN="${SLURM_MONITOR_PYTHON:-python3}"

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
Usage: ./run.sh

Environment:
  SLURM_MONITOR_PORT           HTTP port, default: 8501
  SLURM_MONITOR_PYTHON         Python executable, default: python3
  SLURM_MONITOR_TRANSFER_HOST  Host used in generated rsync commands,
                               default: slurm-client1.cin.ufpe.br

Open through an SSH tunnel from your local machine:
  ssh -N -L 8501:localhost:8501 <USER>@slurm-client2.cin.ufpe.br
  http://localhost:8501
EOF
    exit 0
    ;;
esac

cd "$SCRIPT_DIR"
export SLURM_MONITOR_PORT="$PORT"
exec "$PYTHON_BIN" server.py
