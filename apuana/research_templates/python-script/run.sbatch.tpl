#!/bin/bash
#SBATCH --job-name={{job_name}}
#SBATCH --mem={{mem}}
#SBATCH --ntasks=1
#SBATCH --cpus-per-task={{cpus}}
#SBATCH -p {{partition}}
#SBATCH --qos={{qos}}
{{gres_line}}
{{node_line}}
#SBATCH --time={{time}}
#SBATCH -o {{stdout_path}}
#SBATCH -e {{stderr_path}}

set -Eeuo pipefail

export RESEARCH_RUN_ID={{run_id}}
export RESEARCH_RUN_DIR={{run_dir}}
export RESEARCH_WORK_DIR={{work_dir}}
export RESEARCH_OUTPUT_DIR={{output_dir}}
export RESEARCH_COMMAND_B64="{{command_b64}}"
export RESEARCH_ENV_ACTIVATION_B64="{{env_activation_b64}}"
{{params_exports}}

mkdir -p "$RESEARCH_RUN_DIR/logs" "$RESEARCH_OUTPUT_DIR"
printf '%s\n' {{manifest_json}} > "$RESEARCH_RUN_DIR/run_context.json"

write_status() {
  local state="$1"
  local exit_code="${2:-0}"
  python3 - "$RESEARCH_RUN_DIR/status.json" "$state" "$exit_code" <<'PY'
import json
import pathlib
import sys
import time

path = pathlib.Path(sys.argv[1])
payload = {
    "status": sys.argv[2],
    "exit_code": int(sys.argv[3]),
    "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
PY
}

on_error() {
  local code=$?
  write_status failed "$code"
  exit "$code"
}
trap on_error ERR

write_status running 0

{
  echo "==========================================="
  echo "Apuana Research job: $RESEARCH_RUN_ID"
  echo "SLURM job: ${SLURM_JOB_ID:-unknown}"
  echo "Node: $(hostname)"
  echo "User: ${USER:-unknown}"
  echo "Started: $(date -Is)"
  echo "Work dir: $RESEARCH_WORK_DIR"
  echo "Output dir: $RESEARCH_OUTPUT_DIR"
  echo "==========================================="
} | tee "$RESEARCH_RUN_DIR/logs/context.log"

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi | tee "$RESEARCH_RUN_DIR/logs/nvidia_smi_before.log" || true
fi

cd "$RESEARCH_WORK_DIR"

RESEARCH_ENV_ACTIVATION="$(printf '%s' "$RESEARCH_ENV_ACTIVATION_B64" | base64 -d)"
if [ -n "$RESEARCH_ENV_ACTIVATION" ]; then
  eval "$RESEARCH_ENV_ACTIVATION"
fi

RESEARCH_COMMAND="$(printf '%s' "$RESEARCH_COMMAND_B64" | base64 -d)"
echo "$RESEARCH_COMMAND" > "$RESEARCH_RUN_DIR/command.sh"
bash -lc "$RESEARCH_COMMAND" 2>&1 | tee "$RESEARCH_RUN_DIR/logs/command.log"

if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi | tee "$RESEARCH_RUN_DIR/logs/nvidia_smi_after.log" || true
fi

write_status completed 0
echo "Completed: $(date -Is)"
