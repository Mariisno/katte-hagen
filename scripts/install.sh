#!/bin/bash
# Installs the data source as a launchd background service (macOS).
# Fills in launchd/kattehage.plist.template and loads it. Run again to update.
#
#   scripts/install.sh                  label com.example.kattehage
#   KATTEHAGE_LABEL=com.you.kattehage scripts/install.sh
#   scripts/install.sh --dry-run        print the plist, change nothing
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="${KATTEHAGE_LABEL:-com.example.kattehage}"
LOG="${KATTEHAGE_LOGG:-$HOME/Library/Logs/kattehage.log}"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [[ ! "$LABEL" =~ ^[A-Za-z0-9._-]+$ ]]; then echo "Invalid label: ${LABEL}" >&2; exit 1; fi
if [[ "$(uname)" != "Darwin" ]]; then
  echo "launchd is macOS only. On Linux, run: node spesialister.mjs --live (e.g. from a systemd user unit)." >&2
  exit 1
fi
[ -f "$REPO/hage.config.json" ] || echo "Note: no hage.config.json yet — using built-in defaults. See README." >&2

# Escape for sed and XML (paths with & or < are rare, but handle them).
esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/[\/|]/\\&/g'; }
render() {
  sed -e "s|__LABEL__|$(esc "$LABEL")|g" -e "s|__REPO__|$(esc "$REPO")|g" -e "s|__LOG__|$(esc "$LOG")|g" \
    "$REPO/launchd/kattehage.plist.template"
}

if [[ "${1:-}" == "--dry-run" ]]; then render; exit 0; fi

# Two data sources at once would double every event in the log.
if pgrep -f "spesialister.mjs --live" >/dev/null && ! launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  echo "A data source is already running (kattehage-live.command?). Close it first." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"
render > "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "🐾 Installed ${LABEL}. Log: ${LOG}"
echo "   Open the garden: open \"$REPO/spesialister.html\""
