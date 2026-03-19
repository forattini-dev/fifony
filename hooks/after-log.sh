#!/usr/bin/env bash
# after-log.sh — appends each turn's output to an audit log for later inspection
#
# Configure agentCommand via the API or MCP:
#   FIFONY_WRAP_COMMAND="claude -p $FIFONY_TURN_PROMPT_FILE" FIFONY_WRAP_AFTER_HOOK=./hooks/after-log.sh fifony-wrap
#
# Log location: $FIFONY_WRAP_LOG_DIR (default: .fifony/wrap-logs/)

set -euo pipefail

OUTPUT_FILE="${FIFONY_WRAP_OUTPUT_FILE:-}"
if [[ -z "$OUTPUT_FILE" || ! -f "$OUTPUT_FILE" ]]; then
  exit 0
fi

LOG_DIR="${FIFONY_WRAP_LOG_DIR:-.fifony/wrap-logs}"
mkdir -p "$LOG_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ISSUE="${FIFONY_ISSUE_IDENTIFIER:-unknown}"
TURN="${FIFONY_TURN_INDEX:-0}"
ROLE="${FIFONY_AGENT_ROLE:-executor}"

LOG_FILE="${LOG_DIR}/${ISSUE}-${ROLE}-turn${TURN}-${TIMESTAMP}.log"

{
  echo "=== fifony-wrap audit ==="
  echo "issue:     ${ISSUE}"
  echo "role:      ${ROLE}"
  echo "turn:      ${TURN} / ${FIFONY_MAX_TURNS:-?}"
  echo "provider:  ${FIFONY_AGENT_PROVIDER:-unknown}"
  echo "timestamp: ${TIMESTAMP}"
  echo ""
  echo "--- prompt ---"
  cat "${FIFONY_TURN_PROMPT_FILE:-/dev/null}" 2>/dev/null || echo "(prompt file not found)"
  echo ""
  echo "--- output ---"
  cat "$OUTPUT_FILE"
} > "$LOG_FILE"
