#!/bin/zsh
# Dobbeltklikk for å åpne Katte-hagen. Leser tmux jevnlig til du lukker vinduet.
# Alt skjer lokalt: hopp-tjeneren lytter bare på 127.0.0.1, og ingenting forlater Macen.
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then NODE=node
else NODE="$(ls -1d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V -r | head -n 1)"
fi
if [ -z "$NODE" ]; then echo "Fant ikke node. Installer Node 20 eller nyere (f.eks. brew install node)."; exit 1; fi
# Går datakilden alt (bakgrunnstjenesten eller et annet vindu), bare åpne siden:
# to datakilder samtidig dobler hendelsene i loggen.
if pgrep -f "spesialister.mjs --live" >/dev/null; then
  open spesialister.html
  echo "🐾 Datakilden går alt. Hagen er åpnet — du kan lukke dette vinduet."
  exit 0
fi
"$NODE" spesialister.mjs          # første titt, så siden har data med en gang
open spesialister.html
echo "🐾 Hagen er åpen. La dette vinduet stå — lukk det når du vil at hagen skal sove."
exec "$NODE" spesialister.mjs --live
