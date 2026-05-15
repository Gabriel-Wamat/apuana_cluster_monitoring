#!/usr/bin/env bash
# One verbose snapshot of SLURM and disk state, suitable for issues or logs.
# Usage: ./snapshot_apuana.sh [JOBID]

set -u

echo "======== snapshot_apuana $(date -Is) host=$(hostname) user=${USER:-?} ========"
echo

echo "=== df -h (HOME) ==="
df -h "${HOME}" 2>/dev/null || df -h .
echo

echo "=== squeue (user) ==="
squeue -u "${USER}" -o "%.18i %.12P %.25j %.8u %.2t %.12M %.12l %.10D %R" 2>/dev/null || echo "(squeue failed - are you on a SLURM cluster?)"
echo

if [[ "${1:-}" != "" ]]; then
  jid="$1"
  echo "=== scontrol show job $jid ==="
  scontrol show job "$jid" 2>/dev/null || echo "(job not found or already expired)"
  echo
  echo "=== sacct -j $jid ==="
  sacct -j "$jid" --format=JobID,JobName,Partition,State,ExitCode,Elapsed,MaxRSS,AllocTRES%50,NodeList%30 2>/dev/null || true
  echo
fi

echo "=== sacct (latest 20 records) ==="
sacct -u "${USER}" --format=JobID,JobName%18,Partition,State,Elapsed,MaxRSS -n 20 2>/dev/null || sacct -u "${USER}" -n 20 2>/dev/null || true
echo

echo "=== sinfo -s ==="
sinfo -s 2>/dev/null || sinfo 2>/dev/null || true
echo

echo "=== nvidia-smi (login node - GPU may be unavailable) ==="
nvidia-smi 2>/dev/null || echo "(no GPU or nvidia-smi unavailable on this node)"
echo "======== end snapshot ========"
