#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${SCRIPT_DIR}/run-symphony-local.sh"

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  cat <<'USAGE'
Uso:
  ./scripts/start-symphony-shell.sh [--port <n>] [--help]

Observação:
  Este wrapper inicia o Symphony local em TypeScript puro.
  Não usa Linear e não usa Elixir.
USAGE
  exit 0
fi

if [[ "${SYMPHONY_TRACKER_KIND:-memory}" != "memory" ]]; then
  echo "SYMPHONY_TRACKER_KIND deve ser memory." >&2
  exit 1
fi

exec "$RUNNER" "$@"
