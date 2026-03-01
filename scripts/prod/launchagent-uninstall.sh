#!/usr/bin/env bash
set -euo pipefail

LABEL="com.woolyfluffy.server"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"

# Bootout if loaded
if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/${LABEL}"
  echo "[INFO] Booted out ${LABEL}"
else
  echo "[INFO] ${LABEL} is not loaded, skipping bootout"
fi

# Remove plist
if [ -f "$PLIST_DEST" ]; then
  rm "$PLIST_DEST"
  echo "[INFO] Removed $PLIST_DEST"
else
  echo "[INFO] No plist found at $PLIST_DEST"
fi

echo "[OK] LaunchAgent uninstalled."
