// Oppsettet for hagen: hage.config.json (gitignored), med hage.config.example.json som
// standard for alt som mangler. Rene funksjoner, så testene kan sjekke dem uten filer.
import { readFileSync } from "node:fs";

export const PLASSER = ["house", "birdbath", "sundial", "party"];
export const HALSBAND = ["bell", "crown"];

export const STANDARD = {
  leaders: [
    { name: "LEAD-A", short: "A", spot: "house", session: "main" },
    { name: "LEAD-B", short: "B", spot: "birdbath", session: "web" },
    { name: "LEAD-C", short: "C", spot: "sundial", session: "api" },
    { name: "LEAD-D", short: "D", spot: "party", session: "fun" },
  ],
  watchCat: "WATCH",
  nameOption: "@name",
  accounts: [
    { label: "Work", match: "\\bWORK\\b", collar: "bell" },
    { label: "Personal", match: "\\bPERSONAL\\b", collar: "crown" },
  ],
  quota: { enabled: false, pattern: "5h\\s+[●○]+\\s+(\\d{1,3})%(?:\\s*·\\s*(\\d+)h\\s*(\\d+)m)?" },
  intervalSeconds: 10,
  hopPort: 8853,
  terminal: "Ghostty",
  browser: "Google Chrome",
};

const tekst = (v, maks = 40) => typeof v === "string" && v.trim() && v.length <= maks ? v.trim() : null;
function regex(kilde, feil, hva) {
  try { return new RegExp(kilde); } catch { feil.push(`${hva}: ugyldig regulært uttrykk`); return null; }
}

// Svarer { config, feil }. Ugyldige felt erstattes med standarden og nevnes i feil,
// så en skrivefeil i oppsettet aldri tar ned datakilden.
export function lagConfig(raa = {}) {
  const feil = [];
  const c = { ...STANDARD, quota: { ...STANDARD.quota } };
  if (!raa || typeof raa !== "object") return { config: c, feil: ["oppsettet er ikke et JSON-objekt"] };

  if (raa.leaders !== undefined) {
    const brukt = new Set(), ledere = [];
    for (const l of Array.isArray(raa.leaders) ? raa.leaders : []) {
      const name = tekst(l && l.name), spot = l && l.spot;
      if (!name || !PLASSER.includes(spot) || brukt.has(spot)) { feil.push(`leaders: hoppet over ${JSON.stringify(l)}`); continue; }
      brukt.add(spot);
      ledere.push({ name, short: tekst(l.short, 12) || name, spot, session: tekst(l.session) });
    }
    if (ledere.length) c.leaders = ledere.slice(0, PLASSER.length);
    else feil.push("leaders: ingen gyldige ledere, bruker eksemplet");
  }
  if (raa.watchCat !== undefined) c.watchCat = tekst(raa.watchCat) || null;
  if (raa.nameOption !== undefined) {
    if (/^@[\w-]{1,32}$/.test(raa.nameOption)) c.nameOption = raa.nameOption;
    else feil.push("nameOption må se ut som @name");
  }
  if (raa.accounts !== undefined) {
    c.accounts = (Array.isArray(raa.accounts) ? raa.accounts : []).filter((k) => {
      const ok = k && tekst(k.label, 20) && typeof k.match === "string" && regex(k.match, feil, `accounts «${k.label}»`);
      if (!ok) feil.push(`accounts: hoppet over ${JSON.stringify(k)}`);
      return ok;
    }).map((k) => ({ label: k.label.trim(), match: k.match, collar: HALSBAND.includes(k.collar) ? k.collar : "bell" }));
  }
  if (raa.quota !== undefined) {
    c.quota.enabled = Boolean(raa.quota && raa.quota.enabled);
    if (raa.quota && typeof raa.quota.pattern === "string" && regex(raa.quota.pattern, feil, "quota.pattern")) c.quota.pattern = raa.quota.pattern;
  }
  const tall = (v, min, maks) => Number.isInteger(v) && v >= min && v <= maks;
  if (raa.intervalSeconds !== undefined) {
    if (tall(raa.intervalSeconds, 2, 300)) c.intervalSeconds = raa.intervalSeconds; else feil.push("intervalSeconds må være 2–300");
  }
  if (raa.hopPort !== undefined) {
    if (tall(raa.hopPort, 1024, 65535)) c.hopPort = raa.hopPort; else feil.push("hopPort må være 1024–65535");
  }
  if (raa.terminal !== undefined) c.terminal = tekst(raa.terminal) || STANDARD.terminal;
  if (raa.browser !== undefined) c.browser = tekst(raa.browser) || STANDARD.browser;
  return { config: c, feil };
}

export function lesConfig(sti) {
  let raa;
  try { raa = JSON.parse(readFileSync(sti, "utf8")); }
  catch (e) {
    if (e.code === "ENOENT") return { config: lagConfig().config, feil: [], fil: false };
    return { config: lagConfig().config, feil: ["kunne ikke lese hage.config.json: " + e.message], fil: true };
  }
  return { ...lagConfig(raa), fil: true };
}

// Den delen av oppsettet siden trenger. Regex-ene og terminalen blir i datakilden.
export function forSiden(c) {
  return {
    leaders: c.leaders.map(({ name, short, spot }) => ({ name, short, spot })),
    watchCat: c.watchCat,
    accounts: c.accounts.map(({ label, collar }) => ({ label, collar })),
    quota: c.quota.enabled,
  };
}
