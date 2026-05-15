#!/usr/bin/env bash
# Compatibility alias: delegate to painel_slurm.sh.
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/painel_slurm.sh" "$@"
