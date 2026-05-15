#!/usr/bin/env bash
# Validation for the Apuana monitoring project.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

PY="${SLURM_MONITOR_PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || fail "Python not found: $PY"

export PYTHONDONTWRITEBYTECODE=1

log "Repository shape"
test -f README.md || fail "README.md missing"
test -f apuana/app.py || fail "apuana/app.py compatibility wrapper missing"
test -f apuana/run_slurm_monitor.sh || fail "apuana/run_slurm_monitor.sh compatibility wrapper missing"
test -f apuana/painel_slurm.sh || fail "apuana/painel_slurm.sh compatibility wrapper missing"
test -f apuana/streamlit_dashboard/app.py || fail "apuana/streamlit_dashboard/app.py missing"
test -f apuana/streamlit_dashboard/slurm_core.py || fail "apuana/streamlit_dashboard/slurm_core.py missing"
test -f apuana/streamlit_dashboard/requirements.txt || fail "Streamlit requirements missing"
test -f apuana/bin/run_slurm_monitor.sh || fail "apuana/bin/run_slurm_monitor.sh missing"
test -f apuana/bin/painel_slurm.sh || fail "apuana/bin/painel_slurm.sh missing"
test -f apuana/lib/lib_env.sh || fail "apuana/lib/lib_env.sh missing"
test -f apuana/http_dashboard/server.py || fail "apuana/http_dashboard/server.py missing"
test -f apuana/http_dashboard/run.sh || fail "apuana/http_dashboard/run.sh missing"
test -f apuana/http_dashboard/static/index.html || fail "HTTP index.html missing"
test -f apuana/http_dashboard/static/styles/app.css || fail "HTTP app.css missing"
test -f apuana/http_dashboard/static/scripts/app.js || fail "HTTP app.js missing"

log "Python"
"$PY" --version
"$PY" -m py_compile \
  apuana/app.py \
  apuana/dashboard_apuana.py \
  apuana/streamlit_dashboard/app.py \
  apuana/streamlit_dashboard/slurm_core.py \
  apuana/streamlit_dashboard/dashboard_apuana.py \
  apuana/http_dashboard/server.py

log "Shell syntax"
bash -n apuana/*.sh apuana/bin/*.sh apuana/lib/*.sh apuana/http_dashboard/run.sh scripts/validate_monitoring.sh

log "Entrypoint compatibility"
bash apuana/run_slurm_monitor.sh --help >/dev/null
bash apuana/bin/run_slurm_monitor.sh --help >/dev/null

log "Import checks"
if "$PY" - <<'PY' >/dev/null 2>&1
import matplotlib
import pandas
import seaborn
import streamlit
PY
then
  "$PY" apuana/streamlit_dashboard/slurm_core.py
  "$PY" - <<'PY'
import logging
from pathlib import Path
import sys

sys.path.insert(0, str(Path("apuana/streamlit_dashboard").resolve()))
logging.disable(logging.WARNING)
import app
logging.disable(logging.NOTSET)
import slurm_core as sc

assert callable(app.main)
assert sc.normalize_job_id("12345") == "12345"
assert sc.normalize_job_id("12345.batch") == "12345.batch"
assert sc.normalize_job_id("abc") is None
print("import checks OK")
PY
else
  printf 'WARN: Streamlit dashboard dependencies not installed; skipping runtime import checks.\n'
  printf '      Use apuana/bin/run_slurm_monitor.sh to create the venv and install them.\n'
fi

log "HTTP frontend structure"
grep -q 'id="view-transfer"' apuana/http_dashboard/static/index.html || fail "Transfer view missing"
grep -q 'id="q-global"' apuana/http_dashboard/static/index.html || fail "Global queue section missing"
grep -q '/static/styles/app.css' apuana/http_dashboard/static/index.html || fail "CSS asset link missing"
grep -q '/static/scripts/app.js' apuana/http_dashboard/static/index.html || fail "JS asset link missing"
grep -q '/api/fs' apuana/http_dashboard/static/scripts/app.js || fail "File browser API usage missing"
grep -q 'rsync -avzP' apuana/http_dashboard/static/scripts/app.js || fail "rsync command generation missing"

if command -v node >/dev/null 2>&1; then
  node -c apuana/http_dashboard/static/scripts/app.js
else
  printf 'WARN: node not found; skipping JavaScript parse check.\n'
fi

log "Live SLURM commands"
command -v squeue >/dev/null 2>&1 || fail "squeue not found; run this on an Apuana login node"
command -v sinfo >/dev/null 2>&1 || fail "sinfo not found; run this on an Apuana login node"
squeue -h -o "%i|%u|%P|%j|%T" | sed -n '1,5p'
sinfo -s | sed -n '1,12p'

if command -v sacct >/dev/null 2>&1; then
  if ! sacct_err="$(sacct -u "${USER:-$(whoami)}" -n 1 2>&1 >/dev/null)"; then
    printf 'WARN: sacct unavailable; dashboard should degrade gracefully.\n'
    printf '%s\n' "$sacct_err" | sed -n '1,3p'
  fi
else
  printf 'WARN: sacct not found; dashboard should degrade gracefully.\n'
fi

log "HTTP smoke"
port="${SLURM_MONITOR_TEST_PORT:-18610}"
log_file="/tmp/apuana-monitor-validate-${port}.log"
rm -f "$log_file" /tmp/apuana-monitor-api.json /tmp/apuana-monitor-fs.json \
  /tmp/apuana-monitor-css.txt /tmp/apuana-monitor-js.txt

SLURM_MONITOR_PORT="$port" "$PY" apuana/http_dashboard/server.py >"$log_file" 2>&1 &
pid=$!
cleanup() {
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
trap cleanup EXIT

ok=0
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${port}/api" >/tmp/apuana-monitor-api.json 2>/dev/null; then
    ok=1
    break
  fi
  sleep 1
done

if [[ "$ok" -ne 1 ]]; then
  tail -n 120 "$log_file" >&2 || true
  fail "HTTP dashboard /api did not respond"
fi

curl -fsS "http://127.0.0.1:${port}/api/fs?path=${HOME}&query=" >/tmp/apuana-monitor-fs.json
curl -fsS "http://127.0.0.1:${port}/static/styles/app.css" >/tmp/apuana-monitor-css.txt
curl -fsS "http://127.0.0.1:${port}/static/scripts/app.js" >/tmp/apuana-monitor-js.txt
"$PY" - <<'PY'
import json

api = json.load(open("/tmp/apuana-monitor-api.json", encoding="utf-8"))
fs = json.load(open("/tmp/apuana-monitor-fs.json", encoding="utf-8"))
assert api["queue"]["ok"] in (True, False)
assert "transfer" in api and api["transfer"]["user"]
assert fs["ok"] is True and isinstance(fs["items"], list)
print("HTTP checks OK")
PY

printf '\nVALIDATION OK\n'
