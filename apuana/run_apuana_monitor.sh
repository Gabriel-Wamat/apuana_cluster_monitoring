#!/usr/bin/env bash
# Compatibilidade MaSS13K / nome antigo: delega para run_slurm_monitor.sh.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run_slurm_monitor.sh" "$@"
