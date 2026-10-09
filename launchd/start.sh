#!/bin/bash
# Starter Katte-hagens datakilde for launchd (se scripts/install.sh).
# Finner node selv, så plisten aldri peker på en fast versjon, og holder loggen kort.
# Skrevet for macOS sin bash 3.2. Ingen nettverk, ingenting forlater Macen.

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOGG="${KATTEHAGE_LOGG:-$HOME/Library/Logs/kattehage.log}"
MAKS_LINJER=500
MAKS_BYTE=1048576

stempel() { date '+%d.%m.%Y, %H:%M:%S'; }

# 1. Kort ned loggen ved oppstart: over 500 linjer eller over 1 MB → behold de siste 500.
#    «cat >» skriver over samme fil (samme inode), så launchd sin åpne fil peker fortsatt riktig.
mkdir -p "$(dirname "$LOGG")"
touch "$LOGG"
linjer=$(wc -l < "$LOGG" | tr -d ' ')
byte=$(wc -c < "$LOGG" | tr -d ' ')
if [ "${linjer}" -gt "$MAKS_LINJER" ] || [ "${byte}" -gt "$MAKS_BYTE" ]; then
  tmp="${LOGG}.tmp"
  tail -n "$MAKS_LINJER" "$LOGG" > "$tmp" && cat "$tmp" > "$LOGG" && rm -f "$tmp"
  echo "$(stempel) ✂️  loggen kortet ned til de siste ${MAKS_LINJER} linjene (var ${linjer} linjer, ${byte} byte)" >> "$LOGG"
fi
exec >> "$LOGG" 2>&1

# 2. Finn node: Homebrew, /usr/local, så nyeste nvm-versjon. KATTEHAGE_NODE_KANDIDATER
#    overstyrer lista (brukes i testen av «fant ikke node»).
kandidater="${KATTEHAGE_NODE_KANDIDATER-/opt/homebrew/bin/node /usr/local/bin/node $(ls -1d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V -r | tr '\n' ' ')}"
NODE=""
for k in $kandidater; do
  if [ -x "$k" ]; then NODE="$k"; break; fi
done
if [ -z "$NODE" ]; then
  echo "$(stempel) ❌ fant ikke node. Lette i: ${kandidater:-(ingen kandidater)}"
  echo "$(stempel)    Installer node (brew install node) eller sett riktig sti i launchd/start.sh."
  sleep 60 # launchd starter oss på nytt; ikke fyll loggen hvert 10. sekund
  exit 1
fi

# tmux ligger i Homebrew; launchd gir nesten tom PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"
# Uten UTF-8-locale bytter tmux ut æ, ø, å og «·» med «_» — da brekker navnene
# («GØY» blir «G_Y»). launchd setter ingen LANG, så vi gjør det her.
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export KATTEHAGE_LOGG="$LOGG"
echo "$(stempel) 🐾 starter datakilden med ${NODE} ($("$NODE" --version))"
cd "$REPO" || { echo "$(stempel) ❌ fant ikke ${REPO}"; sleep 60; exit 1; }
exec "$NODE" "$REPO/spesialister.mjs" --live
