#!/usr/bin/env bash
# before-inject.sh — appends custom rules to the prompt before it reaches the CLI agent
#
# Configure agentCommand via the API or MCP:
#   FIFONY_WRAP_COMMAND="claude -p $FIFONY_TURN_PROMPT_FILE" FIFONY_WRAP_BEFORE_HOOK=./hooks/before-inject.sh fifony-wrap
#
# Customize INJECT_RULES below or set FIFONY_INJECT_RULES_FILE to point to an external file.

set -euo pipefail

PROMPT_FILE="${FIFONY_TURN_PROMPT_FILE:-}"
if [[ -z "$PROMPT_FILE" || ! -f "$PROMPT_FILE" ]]; then
  exit 0
fi

RULES_FILE="${FIFONY_INJECT_RULES_FILE:-}"

if [[ -n "$RULES_FILE" && -f "$RULES_FILE" ]]; then
  INJECT_RULES="$(cat "$RULES_FILE")"
else
  # Default rules — edit to match your project conventions
  INJECT_RULES="$(cat <<'RULES'
## Project Constraints

- Always write or update tests for changed code.
- Never commit secrets, tokens, or credentials.
- Prefer editing existing files over creating new ones.
- Follow existing code style — do not reformat unrelated code.
RULES
)"
fi

# Only inject on turn 1 to avoid repeating on every continuation
if [[ "${FIFONY_TURN_INDEX:-1}" == "1" ]]; then
  printf '\n\n---\n%s\n' "$INJECT_RULES" >> "$PROMPT_FILE"
fi
