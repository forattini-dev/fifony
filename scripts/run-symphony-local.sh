#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_SCRIPT_TS="$SCRIPT_DIR/run-symphony-local.ts"

usage() {
  cat <<'USAGE'
Uso:
  ./scripts/run-symphony-local.sh [--port <n>] [--help]

Observações:
  - Execução 100% local em TypeScript (sem runtime Elixir)
  - Sem integrações externas (sem Linear por padrão)
  - SYMPHONY_TRACKER_KIND deve ser 'memory'

Variáveis:
  SYMPHONY_TRACKER_KIND         Modo do tracker (apenas memory)
  SYMPHONY_MEMORY_ISSUES_FILE    Arquivo JSON com issues locais
  SYMPHONY_MEMORY_ISSUES_JSON    JSON inline com issues locais

Exemplos:
  ./scripts/run-symphony-local.sh
  ./scripts/run-symphony-local.sh --port 4040
USAGE
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${SYMPHONY_TRACKER_KIND:-memory}" != "memory" ]]; then
  echo "SYMPHONY_TRACKER_KIND só suporta 'memory' neste runtime." >&2
  exit 1
fi

if command -v pnpm >/dev/null 2>&1 && pnpm exec tsx --version >/dev/null 2>&1; then
  exec pnpm exec tsx "$RUN_SCRIPT_TS" "$@"
fi

if command -v tsx >/dev/null 2>&1; then
  exec tsx "$RUN_SCRIPT_TS" "$@"
fi

echo "tsx não encontrado. Instale as dependências com pnpm install." >&2
exit 1
