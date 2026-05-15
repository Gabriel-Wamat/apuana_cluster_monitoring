#!/usr/bin/env bash
# Streamlit dashboard plus optional tmux panel for SLURM clusters.
#
# Usage:
#   ./run_slurm_monitor.sh              # Streamlit (default)
#   ./run_slurm_monitor.sh --painel     # tmux panel only
#   ./run_slurm_monitor.sh --tudo       # Streamlit in background + tmux panel
#
# Variables: SLURM_MONITOR_STREAMLIT_PORT, SLURM_MONITOR_VENV.
# Legacy APUANA_MONITOR_* variables are still accepted.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib_env.sh"

REQ="${SCRIPT_DIR}/requirements-monitor.txt"
DASH="${SCRIPT_DIR}/app.py"
PAINEL="${SCRIPT_DIR}/painel_slurm.sh"

MODE="web"
for a in "$@"; do
  case "$a" in
    --painel) MODE="painel" ;;
    --web) MODE="web" ;;
    --tudo|--all) MODE="tudo" ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [options]

  (no flags)      Install venv dependencies if needed and open Streamlit.
  --web           Same as the default mode, in the foreground.
  --painel        tmux panel only; does not use Python.
  --tudo          Streamlit in the background plus tmux panel.

Variables: SLURM_MONITOR_STREAMLIT_PORT, SLURM_MONITOR_VENV
           compatible legacy names: APUANA_MONITOR_STREAMLIT_PORT, APUANA_MONITOR_VENV
EOF
      exit 0
      ;;
  esac
done

log() { echo "[slurm-monitor] $*"; }

ensure_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    log "ERROR: tmux not found. Install tmux or use --web mode only."
    exit 1
  fi
}

ensure_python_venv() {
  if ! command -v python3 >/dev/null 2>&1; then
    log "ERROR: python3 not found in PATH."
    exit 1
  fi
  if [[ ! -d "$MONITOR_VENV" ]]; then
    log "Creating virtual environment: $MONITOR_VENV"
    python3 -m venv "$MONITOR_VENV"
  fi
  local py="${MONITOR_VENV}/bin/python"
  if [[ ! -x "$py" ]]; then
    log "ERROR: invalid venv, missing bin/python."
    exit 1
  fi
  if ! "$py" -c "import streamlit, pandas, numpy, matplotlib, seaborn" 2>/dev/null; then
    log "Installing dashboard dependencies..."
    "$py" -m pip install --upgrade pip setuptools wheel -q
    "$py" -m pip install -r "$REQ"
  else
    log "Python dependencies OK."
  fi
  if ! "$py" -c "import streamlit, pandas, numpy, matplotlib, seaborn" 2>/dev/null; then
    log "ERROR: failed to import dependencies after pip install."
    exit 1
  fi
}

start_streamlit_bg() {
  local port="$1"
  local logf="${SCRIPT_DIR}/streamlit-slurm-monitor.log"
  local pidf="${SCRIPT_DIR}/streamlit-slurm-monitor.pid"
  local py="${MONITOR_VENV}/bin/python"

  if [[ -f "$pidf" ]]; then
    local old
    old="$(cat "$pidf" 2>/dev/null || true)"
    if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
      log "Streamlit already appears to be running (PID $old). Log: $logf"
      return 0
    fi
  fi

  log "Starting Streamlit on port $port (127.0.0.1)..."
  (
    cd "$SCRIPT_DIR" || exit 1
    nohup "$py" -m streamlit run "$DASH" \
      --server.port "$port" \
      --server.address 127.0.0.1 \
      --browser.gatherUsageStats false \
      >>"$logf" 2>&1 &
    echo $! >"$pidf"
  )
  sleep 2
  if kill -0 "$(cat "$pidf")" 2>/dev/null; then
    log "Streamlit PID $(cat "$pidf"). SSH tunnel example:"
    log "  ssh -N -L ${port}:localhost:${port} ${USER}@\$(hostname -f)"
    log "  http://localhost:${port}"
  else
    log "ERROR: Streamlit did not start. See $logf"
    tail -n 40 "$logf" 2>/dev/null || true
    exit 1
  fi
}

run_streamlit_fg() {
  local port="$1"
  log "Starting Streamlit in the foreground (Ctrl+C stops it)..."
  cd "$SCRIPT_DIR"
  exec "${MONITOR_VENV}/bin/python" -m streamlit run "$DASH" \
    --server.port "$port" \
    --server.address 127.0.0.1 \
    --browser.gatherUsageStats false
}

run_painel() {
  ensure_tmux
  log "Opening tmux panel..."
  exec bash "$PAINEL"
}

case "$MODE" in
  painel)
    run_painel
    ;;
  web)
    ensure_python_venv
    run_streamlit_fg "$MONITOR_PORT"
    ;;
  tudo)
    ensure_python_venv
    start_streamlit_bg "$MONITOR_PORT"
    run_painel
    ;;
  *)
    log "Unknown mode"
    exit 1
    ;;
esac
