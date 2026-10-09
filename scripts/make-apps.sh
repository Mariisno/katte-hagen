#!/bin/bash
# Builds two small macOS apps into ./apps (gitignored) with osacompile:
#   Katte-hagen.app   opens the full garden
#   Mini-garden.app   opens the compact list as a small window (Chromium browsers only)
# The apps contain the absolute path to this folder, so build them on your own Mac.
# Browser: "browser" in hage.config.json, or KATTEHAGE_BROWSER. Default: Google Chrome.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BROWSER="${KATTEHAGE_BROWSER:-$(node -e 'try{process.stdout.write(require(process.argv[1]).browser||"")}catch{}' "$REPO/hage.config.json" 2>/dev/null || true)}"
BROWSER="${BROWSER:-Google Chrome}"
OUT="$REPO/apps"
mkdir -p "$OUT"

# AppleScript string literal: escape backslashes and quotes.
as() { local s="${1//\\/\\\\}"; printf '"%s"' "${s//\"/\\\"}"; }
PAGE="$REPO/spesialister.html"
URL="file://$(printf '%s' "$PAGE" | sed 's/ /%20/g')?kompakt=1"

osacompile -o "$OUT/Katte-hagen.app" <<APPLESCRIPT
set sti to $(as "$PAGE")
try
	do shell script "open -a " & quoted form of $(as "$BROWSER") & " " & quoted form of sti
on error
	do shell script "open " & quoted form of sti
end try
APPLESCRIPT

osacompile -o "$OUT/Mini-garden.app" <<APPLESCRIPT
set adresse to $(as "$URL")
try
	do shell script "open -na " & quoted form of $(as "$BROWSER") & " --args --app=" & quoted form of adresse & " --window-size=420,360"
on error
	do shell script "open " & quoted form of $(as "$PAGE")
end try
APPLESCRIPT

echo "🐾 Built apps/Katte-hagen.app and apps/Mini-garden.app (browser: ${BROWSER}). Drag them to the Dock if you like."
