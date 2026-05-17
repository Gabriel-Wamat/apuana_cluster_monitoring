#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ -x ".venv/bin/python" ]]; then
  PY=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; raise SystemExit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
  PY="$(command -v python3)"
elif command -v python >/dev/null 2>&1 && python -c 'import sys; raise SystemExit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
  PY="$(command -v python)"
else
  echo "Python 3.9+ was not found."
  echo "Install Python 3.9 or newer, then run this script again."
  exit 1
fi

exec "$PY" "$ROOT/run.py" "$@"
