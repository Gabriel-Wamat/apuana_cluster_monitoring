#!/usr/bin/env bash
# Compatibilidade: delega para painel_slurm.sh (mesma funcionalidade, nomes genericos).
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/painel_slurm.sh" "$@"
