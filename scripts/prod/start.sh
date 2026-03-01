#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$REPO_ROOT"

# shellcheck source=_load-env.sh
. "$SCRIPT_DIR/_load-env.sh"

ENV_FILE="${WOOLY_FLUFFY_ENV_PATH:-$HOME/Library/Application Support/wooly-fluffy/server.env}"
load_env_file "$ENV_FILE"

node server/dist/prod/preflight-cli.js || {
  echo "[PREFLIGHT FAILED] Exit code: $?" >&2
  exit 1
}

exec node server/dist/main.js
