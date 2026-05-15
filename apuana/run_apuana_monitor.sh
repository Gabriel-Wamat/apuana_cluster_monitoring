#!/usr/bin/env bash
# Compatibility alias for the old name: delegate to run_slurm_monitor.sh.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run_slurm_monitor.sh" "$@"
