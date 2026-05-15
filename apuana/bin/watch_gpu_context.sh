#!/usr/bin/env bash
# Runs under `watch`: summarizes queue, job, and nvidia-smi attempts in the allocation.
set -u
u="${USER:-$(whoami)}"
jid="$(squeue -u "$u" -h -t R,CG -o "%i" 2>/dev/null | head -n1)"
if [[ -z "$jid" ]]; then
  jid="$(squeue -u "$u" -h -t PD -o "%i" 2>/dev/null | head -n1)"
fi
clear
date
echo "User=$u highlighted_job=${jid:-<none>}"
echo "----------------------------------------------------------------"
if [[ -n "$jid" ]]; then
  echo "scontrol show job $jid (start):"
  scontrol show job "$jid" 2>/dev/null | head -n 35 || true
  echo "----------------------------------------------------------------"
  echo "nvidia-smi via srun --immediate=1 --jobid=$jid (may fail on login nodes):"
  srun --immediate=1 --jobid="$jid" nvidia-smi 2>&1 || echo "(failed; normal when cluster policy does not allow it)"
else
  sinfo -s 2>/dev/null || sinfo || true
fi
