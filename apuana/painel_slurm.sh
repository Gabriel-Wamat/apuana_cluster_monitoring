#!/usr/bin/env bash
# Painel tmux 2x2: squeue | logs | GPU/sinfo | sacct (generico Slurm).
# Uso: ./painel_slurm.sh | ./painel_slurm.sh --attach-only
#
# Variaveis (prefixo SLURM_MONITOR_ preferido; ver README em monitoring/):
#   SESSION / LOG_OUT / LOG_ERR / SQUEUE_SEC / GPU_SEC / SACCT_SEC / SACCT_LINES

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib_env.sh"

TAIL_SH="${SCRIPT_DIR}/tail_slurm_logs.sh"
GPU_SH="${SCRIPT_DIR}/watch_gpu_context.sh"

if [[ ! -x "$TAIL_SH" ]]; then chmod +x "$TAIL_SH" 2>/dev/null || true; fi
if [[ ! -x "$GPU_SH" ]]; then chmod +x "$GPU_SH" 2>/dev/null || true; fi

ATTACH_ONLY=0
[[ "${1:-}" == "--attach-only" ]] && ATTACH_ONLY=1

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux nao encontrado no PATH." >&2
  exit 1
fi

if [[ -z "${MONITOR_LOG_ERR}" ]]; then
  if [[ "${MONITOR_LOG_OUT}" == *.out ]]; then
    MONITOR_LOG_ERR="${MONITOR_LOG_OUT%.out}.err"
  else
    MONITOR_LOG_ERR="${MONITOR_LOG_OUT}.err"
  fi
fi

SQUEUE_CMD="watch -n ${MONITOR_SQUEUE_SEC} \"echo '=== squeue -u ${USER} ==='; date; squeue -u ${USER} -o '%.18i %.12P %.22j %.8u %.2t %.12M %.12l %.6D %R'; echo; echo '=== contagem por estado ==='; squeue -u ${USER} -h -o %t 2>/dev/null | sort | uniq -c || true\""

LOG_CMD="env SLURM_MONITOR_LOG_OUT='${MONITOR_LOG_OUT}' SLURM_MONITOR_LOG_ERR='${MONITOR_LOG_ERR}' bash '${TAIL_SH}'"

GPU_CMD="watch -n ${MONITOR_GPU_SEC} bash '${GPU_SH}'"

SACCT_CMD="watch -n ${MONITOR_SACCT_SEC} \"echo '=== sacct (ultimos) ==='; date; sacct -u ${USER} --format=JobID,JobName%20,Partition,State,ExitCode,Elapsed,MaxRSS,AllocTRES%40 -n ${MONITOR_SACCT_LINES} -X 2>/dev/null || sacct -u ${USER} -n ${MONITOR_SACCT_LINES}\""

if [[ "$ATTACH_ONLY" -eq 1 ]]; then
  exec tmux attach -t "$MONITOR_SESSION"
fi

if tmux has-session -t "$MONITOR_SESSION" 2>/dev/null; then
  echo "Sessao '${MONITOR_SESSION}' ja existe; anexando (Ctrl+B D desanexa)."
  exec tmux attach -t "$MONITOR_SESSION"
fi

tmux new-session -d -s "$MONITOR_SESSION" -n monitor
tmux split-window -h -t "$MONITOR_SESSION:monitor"
tmux split-window -v -t "$MONITOR_SESSION:monitor.0"
tmux split-window -v -t "$MONITOR_SESSION:monitor.2"

tmux send-keys -t "$MONITOR_SESSION:monitor.0" "$SQUEUE_CMD" C-m
tmux send-keys -t "$MONITOR_SESSION:monitor.1" "$LOG_CMD" C-m
tmux send-keys -t "$MONITOR_SESSION:monitor.2" "$GPU_CMD" C-m
tmux send-keys -t "$MONITOR_SESSION:monitor.3" "$SACCT_CMD" C-m

echo "Painel: tmux attach -t ${MONITOR_SESSION}"
echo "  Ctrl+B D = desanexar | tmux kill-session -t ${MONITOR_SESSION} = remover"
exec tmux attach -t "$MONITOR_SESSION"
