#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

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

if node server/dist/prod/preflight-cli.js; then
  :
else
  PREFLIGHT_EXIT=$?
  echo "[PREFLIGHT FAILED] Exit code: $PREFLIGHT_EXIT" >&2
  exit $PREFLIGHT_EXIT
fi

exec node server/dist/main.js
