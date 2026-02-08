#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found."
  echo "Next: Install Node.js (which includes npm), then retry."
  exit 1
fi

if [[ ! -d "$REPO_DIR/node_modules" ]]; then
  echo "ERROR: node_modules not found."
  echo "Next: Run: npm install"
  exit 1
fi

SERVER_HOST="${SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${SERVER_PORT:-3000}"
WEB_HOST="${WEB_HOST:-127.0.0.1}"
WEB_PORT="${WEB_PORT:-5173}"

APP_SUPPORT_DIR="$HOME/Library/Application Support/wooly-fluffy"
ENV_FILE="$APP_SUPPORT_DIR/server.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "WARN: Env file not found:"
  echo "  $ENV_FILE"
  echo "Staff login requires STAFF_PASSCODE; create the file with e.g.:"
  echo "  STAFF_PASSCODE=your-passcode"
  echo
fi

echo "Starting server..."
(HOST="$SERVER_HOST" PORT="$SERVER_PORT" npm run -w server start) &
server_pid=$!

echo "Starting web..."
(npm run -w web dev -- --host "$WEB_HOST" --port "$WEB_PORT") &
web_pid=$!

cleanup() {
  echo
  echo "Shutting down..."
  kill "$server_pid" "$web_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  wait "$web_pid" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

echo
echo "URLs:"
echo "  Kiosk:  http://$WEB_HOST:$WEB_PORT/"
echo "  Staff:  http://$WEB_HOST:$WEB_PORT/staff"
echo "  Health: http://$SERVER_HOST:$SERVER_PORT/health"
echo
echo "Press Ctrl+C to stop."

wait

