#!/usr/bin/env bash
# Baseline validation for the Apuana/Slurm monitoring project.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

PY="${SLURM_MONITOR_PYTHON:-}"
if [[ -z "$PY" ]]; then
  if [[ -x "$ROOT/apuana/.venv-monitor/bin/python" ]]; then
    PY="$ROOT/apuana/.venv-monitor/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    PY="$(command -v python3)"
  else
    fail "python3 not found and apuana/.venv-monitor/bin/python is missing"
  fi
fi

[[ -x "$PY" ]] || fail "Python interpreter is not executable: $PY"

export PYTHONDONTWRITEBYTECODE=1

log "Python"
"$PY" --version

log "Shell syntax"
bash -n apuana/*.sh

log "Python syntax"
"$PY" - <<'PY'
from pathlib import Path

for rel in ("apuana/app.py", "apuana/slurm_core.py", "apuana/dashboard_apuana.py"):
    path = Path(rel)
    compile(path.read_text(encoding="utf-8"), str(path), "exec")
    print(f"syntax OK: {rel}")
PY

log "Core self-tests"
"$PY" apuana/slurm_core.py

log "Import checks"
"$PY" - <<'PY'
import logging
from pathlib import Path
import sys

sys.path.insert(0, str(Path("apuana").resolve()))
logging.disable(logging.WARNING)
import app
logging.disable(logging.NOTSET)
import slurm_core as sc

assert callable(app.main)
assert sc.normalize_job_id("12345") == "12345"
assert sc.normalize_job_id("12345.batch") == "12345.batch"
assert sc.normalize_job_id("12345.0") == "12345.0"
assert sc.normalize_job_id("abc") is None
print("import checks OK")
PY

if command -v squeue >/dev/null 2>&1; then
  log "Live Slurm: squeue"
  squeue -u "${USER:-$(whoami)}" -o "%.18i %.12P %.22j %.8u %.2t %.12M %.6D %R"
else
  fail "squeue not found; run this validator on an Apuana login node"
fi

if command -v sinfo >/dev/null 2>&1; then
  log "Live Slurm: sinfo"
  sinfo -s
else
  fail "sinfo not found; run this validator on an Apuana login node"
fi

if command -v sacct >/dev/null 2>&1; then
  log "Live Slurm: sacct smoke"
  if ! sacct_err="$(sacct -u "${USER:-$(whoami)}" -n 1 2>&1 >/dev/null)"; then
    printf 'WARN: sacct unavailable; dashboard should degrade gracefully.\n'
    printf '%s\n' "$sacct_err" | sed -n '1,3p'
  fi
else
  printf 'WARN: sacct not found; dashboard should degrade gracefully.\n'
fi

printf '\nVALIDATION OK\n'
