#!/usr/bin/env bash
# after-strip-thinking.sh — removes <thinking>...</thinking> blocks from CLI output
#
# Claude extended thinking emits large <thinking> blocks in the output.
# These are useful for the model but inflate the `previousOutput` passed to the
# next turn. Stripping them reduces context size without losing actionable content.
#
# Configure agentCommand via the API or MCP:
#   FIFONY_WRAP_COMMAND="claude -p $FIFONY_TURN_PROMPT_FILE" FIFONY_WRAP_AFTER_HOOK=./hooks/after-strip-thinking.sh fifony-wrap
#
# Combine with after-log.sh via a wrapper script if you need both.

set -euo pipefail

OUTPUT_FILE="${FIFONY_WRAP_OUTPUT_FILE:-}"
if [[ -z "$OUTPUT_FILE" || ! -f "$OUTPUT_FILE" ]]; then
  exit 0
fi

ORIGINAL_SIZE=$(wc -c < "$OUTPUT_FILE")

# Remove <thinking>...</thinking> blocks (including multiline)
perl -0777 -i -pe 's/<thinking>.*?<\/thinking>\n?//gs' "$OUTPUT_FILE" 2>/dev/null \
  || python3 -c "
import re, sys
content = open('$OUTPUT_FILE').read()
content = re.sub(r'<thinking>.*?</thinking>\n?', '', content, flags=re.DOTALL)
open('$OUTPUT_FILE', 'w').write(content)
"

FINAL_SIZE=$(wc -c < "$OUTPUT_FILE")
SAVED=$((ORIGINAL_SIZE - FINAL_SIZE))

if [[ $SAVED -gt 0 ]]; then
  printf '\n[fifony-wrap] stripped %d chars of <thinking> blocks\n' "$SAVED" >> "$OUTPUT_FILE"
fi
