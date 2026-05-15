#!/usr/bin/env bash
# Compatibility alias: delegate to tail_slurm_logs.sh.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tail_slurm_logs.sh" "$@"
