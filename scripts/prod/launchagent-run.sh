#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

# Ensure Node.js is on PATH (LaunchAgent has minimal PATH)
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# Load env file (KEY=VALUE only; no shell execution)
ENV_FILE="${WOOLY_FLUFFY_ENV_PATH:-$HOME/Library/Application Support/wooly-fluffy/server.env}"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"         # strip inline comments
    line="${line#"${line%%[![:space:]]*}"}"  # trim leading whitespace
    line="${line%"${line##*[![:space:]]}"}"  # trim trailing whitespace
    [ -z "$line" ] && continue
    case "$line" in
      *=*) export "$line" ;;
      *) echo "[WARN] ignoring non-KEY=VALUE line in $ENV_FILE" >&2 ;;
    esac
  done < "$ENV_FILE"
fi

# Run preflight
node server/dist/prod/preflight-cli.js

# Start server (exec replaces shell process)
exec node server/dist/main.js
