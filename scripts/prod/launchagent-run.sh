#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

# Ensure Node.js is on PATH (LaunchAgent has minimal PATH)
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

# Load env file
ENV_FILE="${WOOLY_FLUFFY_ENV_PATH:-$HOME/Library/Application Support/wooly-fluffy/server.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

# Run preflight
node server/dist/prod/preflight-cli.js

# Start server (exec replaces shell process)
exec node server/dist/main.js
