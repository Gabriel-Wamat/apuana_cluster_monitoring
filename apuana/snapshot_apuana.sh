#!/usr/bin/env bash
# Retorno único e verboso do estado SLURM + disco (ideal para colar em issue ou log).
# Uso: ./snapshot_apuana.sh [JOBID]

set -u

echo "======== snapshot_apuana $(date -Is) host=$(hostname) user=${USER:-?} ========"
echo

echo "=== df -h (HOME) ==="
df -h "${HOME}" 2>/dev/null || df -h .
echo

echo "=== squeue (usuário) ==="
squeue -u "${USER}" -o "%.18i %.12P %.25j %.8u %.2t %.12M %.12l %.10D %R" 2>/dev/null || echo "(squeue falhou — está no cluster SLURM?)"
echo

if [[ "${1:-}" != "" ]]; then
  jid="$1"
  echo "=== scontrol show job $jid ==="
  scontrol show job "$jid" 2>/dev/null || echo "(job não encontrado ou já expirou)"
  echo
  echo "=== sacct -j $jid ==="
  sacct -j "$jid" --format=JobID,JobName,Partition,State,ExitCode,Elapsed,MaxRSS,AllocTRES%50,NodeList%30 2>/dev/null || true
  echo
fi

echo "=== sacct (últimos 20 registros) ==="
sacct -u "${USER}" --format=JobID,JobName%18,Partition,State,Elapsed,MaxRSS -n 20 2>/dev/null || sacct -u "${USER}" -n 20 2>/dev/null || true
echo

echo "=== sinfo -s ==="
sinfo -s 2>/dev/null || sinfo 2>/dev/null || true
echo

echo "=== nvidia-smi (nó de login — pode não haver GPU) ==="
nvidia-smi 2>/dev/null || echo "(sem GPU ou nvidia-smi indisponível neste nó)"
echo "======== fim snapshot ========"
