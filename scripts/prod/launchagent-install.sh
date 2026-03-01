#!/usr/bin/env bash
set -euo pipefail

LABEL="com.woolyfluffy.server"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/wooly-fluffy"
TEMPLATE="$REPO_ROOT/templates/launchd/${LABEL}.plist.tmpl"

# Check if already installed
if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  echo "[INFO] ${LABEL} is already loaded. Uninstall first: scripts/prod/launchagent-uninstall.sh" >&2
  exit 1
fi

# Create log directory
mkdir -p "$LOG_DIR"

# Generate plist from template
sed \
  -e "s|__REPO_ROOT__|${REPO_ROOT}|g" \
  -e "s|__LOG_DIR__|${LOG_DIR}|g" \
  "$TEMPLATE" > "$PLIST_DEST"

echo "[INFO] Installed plist to: $PLIST_DEST"

# Bootstrap the agent
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
echo "[INFO] Bootstrapped ${LABEL}"

# Kickstart
launchctl kickstart "gui/$(id -u)/${LABEL}"
echo "[INFO] Kickstarted ${LABEL}"

echo "[OK] LaunchAgent installed and started."
echo "     Check status: launchctl print gui/$(id -u)/${LABEL}"
echo "     Logs: $LOG_DIR/"
