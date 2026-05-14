#!/usr/bin/env bash
# Roda sob `watch`: resume fila, job e tentativa de nvidia-smi no allocation.
set -u
u="${USER:-$(whoami)}"
jid="$(squeue -u "$u" -h -t R,CG -o "%i" 2>/dev/null | head -n1)"
if [[ -z "$jid" ]]; then
  jid="$(squeue -u "$u" -h -t PD -o "%i" 2>/dev/null | head -n1)"
fi
clear
date
echo "Usuario=$u job_destacado=${jid:-<nenhum>}"
echo "----------------------------------------------------------------"
if [[ -n "$jid" ]]; then
  echo "scontrol show job $jid (inicio):"
  scontrol show job "$jid" 2>/dev/null | head -n 35 || true
  echo "----------------------------------------------------------------"
  echo "nvidia-smi via srun --immediate=1 --jobid=$jid (pode falhar no login):"
  srun --immediate=1 --jobid="$jid" nvidia-smi 2>&1 || echo "(falhou — normal se politica do cluster nao permitir)"
else
  sinfo -s 2>/dev/null || sinfo || true
fi
