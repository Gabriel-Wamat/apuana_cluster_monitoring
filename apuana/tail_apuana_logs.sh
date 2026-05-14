#!/usr/bin/env bash
# Compatibilidade: delega para tail_slurm_logs.sh.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tail_slurm_logs.sh" "$@"
