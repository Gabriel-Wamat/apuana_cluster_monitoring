#!/usr/bin/env bash
# Dashboard Streamlit + opcional painel tmux para clusters Slurm (generico).
#
# Uso:
#   ./run_slurm_monitor.sh              # Streamlit (padrao)
#   ./run_slurm_monitor.sh --painel     # so painel tmux
#   ./run_slurm_monitor.sh --tudo       # Streamlit em background + painel
#
# Variaveis: SLURM_MONITOR_STREAMLIT_PORT, SLURM_MONITOR_VENV (fallback: APUANA_MONITOR_*)

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
Uso: $(basename "$0") [opcoes]

  (sem flags)     Instala deps no venv se precisar e abre o dashboard Streamlit.
  --web           Igual ao padrao (primeiro plano).
  --painel        So o painel tmux (nao usa Python).
  --tudo          Streamlit em segundo plano + painel tmux.

Variaveis: SLURM_MONITOR_STREAMLIT_PORT, SLURM_MONITOR_VENV
           (compativel: APUANA_MONITOR_STREAMLIT_PORT, APUANA_MONITOR_VENV)
EOF
      exit 0
      ;;
  esac
done

log() { echo "[slurm-monitor] $*"; }

ensure_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    log "ERRO: tmux nao encontrado. Instale tmux ou use apenas modo --web."
    exit 1
  fi
}

ensure_python_venv() {
  if ! command -v python3 >/dev/null 2>&1; then
    log "ERRO: python3 nao encontrado no PATH."
    exit 1
  fi
  if [[ ! -d "$MONITOR_VENV" ]]; then
    log "Criando ambiente virtual: $MONITOR_VENV"
    python3 -m venv "$MONITOR_VENV"
  fi
  local py="${MONITOR_VENV}/bin/python"
  if [[ ! -x "$py" ]]; then
    log "ERRO: venv invalido (sem bin/python)."
    exit 1
  fi
  if ! "$py" -c "import streamlit, pandas, numpy, matplotlib, seaborn" 2>/dev/null; then
    log "Instalando dependencias do dashboard..."
    "$py" -m pip install --upgrade pip setuptools wheel -q
    "$py" -m pip install -r "$REQ"
  else
    log "Dependencias Python OK."
  fi
  if ! "$py" -c "import streamlit, pandas, numpy, matplotlib, seaborn" 2>/dev/null; then
    log "ERRO: falha ao importar dependencias apos pip install."
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
      log "Streamlit ja parece ativo (PID $old). Log: $logf"
      return 0
    fi
  fi

  log "Iniciando Streamlit na porta $port (127.0.0.1)..."
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
    log "Streamlit PID $(cat "$pidf"). Tunel SSH exemplo:"
    log "  ssh -N -L ${port}:localhost:${port} ${USER}@\$(hostname -f)"
    log "  http://localhost:${port}"
  else
    log "ERRO: Streamlit nao subiu. Veja $logf"
    tail -n 40 "$logf" 2>/dev/null || true
    exit 1
  fi
}

run_streamlit_fg() {
  local port="$1"
  log "Iniciando Streamlit em primeiro plano (Ctrl+C encerra)..."
  cd "$SCRIPT_DIR"
  exec "${MONITOR_VENV}/bin/python" -m streamlit run "$DASH" \
    --server.port "$port" \
    --server.address 127.0.0.1 \
    --browser.gatherUsageStats false
}

run_painel() {
  ensure_tmux
  log "Abrindo painel tmux..."
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
    log "Modo desconhecido"
    exit 1
    ;;
esac
