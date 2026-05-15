#!/usr/bin/env bash
# tail -f for job stdout/stderr in the tmux panel.
# Paths: SLURM_MONITOR_LOG_* or legacy APUANA_MONITOR_*.
set -u
out="${SLURM_MONITOR_LOG_OUT:-${APUANA_MONITOR_LOG_OUT:-${HOME}/slurm-dashboard.out}}"
err="${SLURM_MONITOR_LOG_ERR:-${APUANA_MONITOR_LOG_ERR:-}}"
if [[ -z "$err" ]]; then
  if [[ "$out" == *.out ]]; then err="${out%.out}.err"; else err="${out}.err"; fi
fi
echo "Log monitor - out=$out err=$err"
for f in "$out" "$err"; do
  [[ -f "$f" ]] || echo "(waiting) does not exist yet: $f"
done
args=()
[[ -f "$out" ]] && args+=("$out")
[[ -f "$err" ]] && args+=("$err")
if ((${#args[@]} == 0)); then
  echo "No files yet; tail -F will follow them when they appear..."
  exec tail -n 25 -F "$out" "$err" 2>/dev/null || sleep 60
fi
exec tail -n 40 -f "${args[@]}"
