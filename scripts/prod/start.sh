#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

ENV_FILE="${WOOLY_FLUFFY_ENV_PATH:-$HOME/Library/Application Support/wooly-fluffy/server.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

if node server/dist/prod/preflight-cli.js; then
  :
else
  PREFLIGHT_EXIT=$?
  echo "[PREFLIGHT FAILED] Exit code: $PREFLIGHT_EXIT" >&2
  exit $PREFLIGHT_EXIT
fi

exec node server/dist/main.js
