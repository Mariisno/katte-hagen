#!/bin/bash
# Stops and removes the launchd background service. Leaves the repo and the log alone.
set -euo pipefail
LABEL="${KATTEHAGE_LABEL:-com.example.kattehage}"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
rm -f "$PLIST"
echo "🌙 Removed ${LABEL}."
