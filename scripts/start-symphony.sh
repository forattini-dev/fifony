#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_SCRIPT_TS="$SCRIPT_DIR/run-symphony-local.ts"
RUN_SCRIPT_SH="$SCRIPT_DIR/run-symphony-local.sh"

usage() {
  cat <<'USAGE'
Uso:
  ./scripts/start-symphony.sh [--port <n>] [--help]

Este fork usa um executor local em TypeScript (Codex-only):
  - Sem Linear
  - Sem Elixir
  - Apenas modo memory

Variáveis:
  SYMPHONY_TRACKER_KIND           memory (padrão)
  SYMPHONY_MEMORY_ISSUES_FILE      Arquivo JSON com issues locais
  SYMPHONY_MEMORY_ISSUES_JSON      JSON inline com issues locais

Exemplos:
  ./scripts/start-symphony.sh
  ./scripts/start-symphony.sh --port 4040
USAGE
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${SYMPHONY_TRACKER_KIND:-memory}" != "memory" ]]; then
  echo "SYMPHONY_TRACKER_KIND não pode ser diferente de memory." >&2
  exit 1
fi

if [[ ! -x "$RUN_SCRIPT_SH" ]]; then
  echo "Run script não encontrado: $RUN_SCRIPT_SH" >&2
  exit 1
fi

cd "$SCRIPT_DIR/.."

if command -v pnpm >/dev/null 2>&1 && pnpm exec tsx --version >/dev/null 2>&1; then
  exec pnpm exec tsx "$RUN_SCRIPT_TS" "$@"
fi

if command -v tsx >/dev/null 2>&1; then
  exec tsx "$RUN_SCRIPT_TS" "$@"
fi

exec "$RUN_SCRIPT_SH" "$@"
