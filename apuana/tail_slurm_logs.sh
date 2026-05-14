#!/usr/bin/env bash
# tail -f de stdout/stderr do job (painel tmux). Paths: SLURM_MONITOR_LOG_* ou legado APUANA_MONITOR_*.
set -u
out="${SLURM_MONITOR_LOG_OUT:-${APUANA_MONITOR_LOG_OUT:-${HOME}/slurm-dashboard.out}}"
err="${SLURM_MONITOR_LOG_ERR:-${APUANA_MONITOR_LOG_ERR:-}}"
if [[ -z "$err" ]]; then
  if [[ "$out" == *.out ]]; then err="${out%.out}.err"; else err="${out}.err"; fi
fi
echo "Monitor de logs — out=$out err=$err"
for f in "$out" "$err"; do
  [[ -f "$f" ]] || echo "(aguardando) ainda nao existe: $f"
done
args=()
[[ -f "$out" ]] && args+=("$out")
[[ -f "$err" ]] && args+=("$err")
if ((${#args[@]} == 0)); then
  echo "Nenhum ficheiro ainda; tail -F quando aparecerem..."
  exec tail -n 25 -F "$out" "$err" 2>/dev/null || sleep 60
fi
exec tail -n 40 -f "${args[@]}"
