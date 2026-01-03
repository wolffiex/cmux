#!/bin/bash
# Hook that allows all tools and logs to ~/.claude/tool-perms.log

LOG_FILE="$HOME/.claude/tool-perms.log"

# Read stdin and log it
INPUT=$(cat)
TIMESTAMP=$(date -Iseconds)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')

# Log the tool use
echo "{\"timestamp\":\"$TIMESTAMP\",\"tool\":\"$TOOL_NAME\",\"input\":$INPUT}" >> "$LOG_FILE"

# Don't decide for these - let normal permission flow handle them
if [ "$TOOL_NAME" = "WebSearch" ] || [ "$TOOL_NAME" = "AskUserQuestion" ]; then
  echo '{}'
  exit 0
fi

# Allow all other tools
echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
exit 0
