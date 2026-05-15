#!/usr/bin/env bash
# Compatibility shim. The implementation lives in apuana/lib/lib_env.sh.
APUANA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${APUANA_DIR}/lib/lib_env.sh"
