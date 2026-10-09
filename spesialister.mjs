// Katte-hagen: leser tmux LOKALT og skriver spesialister.js.
// Henter høyst de siste 32 linjene av det synlige skjermbildet per pane, vurderer de ~15
// linjene over inntastingsfeltet, og sender aldri taster.
// Kun Node-innebygde moduler — ingen npm-pakker. spesialister.js er gitignored.
//
//   node spesialister.mjs          skriv én gang
//   node spesialister.mjs --live   skriv hvert 10. sekund til du trykker ctrl+c

import { execFileSync } from "node:child_process";
import { writeFileSync, renameSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startHoppTjener } from "./lib/hopp.mjs";
import { lesConfig, forSiden, STANDARD } from "./lib/config.mjs";

// Oppsettet: ledere, kontoer, kvote og intervall (se README og hage.config.example.json).
const OPPSETT = lesConfig(fileURLToPath(new URL("./hage.config.json", import.meta.url)));
const CONFIG = OPPSETT.config;
const LEDERE = CONFIG.leaders.map((l) => l.name);
const OKT_TIL_LEDER = Object.fromEntries(CONFIG.leaders.filter((l) => l.session).map((l) => [l.session, l.name]));
const KONTOER = CONFIG.accounts.map((k) => ({ label: k.label, re: new RegExp(k.match) }));
const KVOTE_RE = CONFIG.quota.enabled ? new RegExp(CONFIG.quota.pattern) : null;
const SKALL = new Set(["zsh", "-zsh", "bash", "-bash", "sh", "fish", "login"]);
const INNHOLD = 15;   // innholdslinjer over inntastingsfeltet
const SKJERM = 32;    // rå linjer fra bunnen av skjermen: innhold + felt + footer
const INTERVALL_MS = CONFIG.intervalSeconds * 1000;
const UT = fileURLToPath(new URL("./spesialister.js", import.meta.url));
// Hendelsesloggen lever her, i scriptet, så den fanger det som skjer også når siden er lukket.
// Fila (gitignored) husker forrige øyeblikksbilde, så loggen overlever omstart.
const HENDELSER = fileURLToPath(new URL("./hendelser.json", import.meta.url));
const MAKS_HENDELSER = 80;

function tmux(args) {
  // -u: UTF-8 uansett locale, så «Ø» aldri blir «_» (forsvar i dybden; start.sh setter LANG)
  return execFileSync("tmux", ["-u", ...args], { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "pipe"] });
}

// «SCOUT · research (LEAD-A, Work)» → «SCOUT», «@Pixel» → «Pixel»
function kortNavn(navn, vindu) {
  const forste = (navn || "").split(" · ")[0].replace(/\(.*?\)/g, "").trim().replace(/^@/, "");
  return forste || vindu;
}

function finnLeder(navn, okt, vindu) {
  for (const l of LEDERE) if ((navn || "").includes("(" + l)) return l;
  if (Object.hasOwn(OKT_TIL_LEDER, okt)) return OKT_TIL_LEDER[okt];
  return null; // ukjent: havner i fellesskapet nede til venstre
}

// Bare de siste linjene av det synlige skjermbildet — aldri historikken.
function sisteLinjer(paneId, hoyde) {
  const start = Math.max(0, hoyde - SKJERM);
  const tekst = tmux(["capture-pane", "-p", "-t", paneId, "-S", String(start)]);
  return tekst.split("\n").filter((l) => l.trim() !== "");
}

// Inntastingsfeltet: en «❯»-linje rett under en ren rammelinje, og alt ned til neste
// rammelinje. Svarer [start, slutt) eller null. Usendt tekst der — «/exit», «1. gjør det» —
// er brukerens utkast og teller aldri.
export function finnInntasting(linjer) {
  for (let i = linjer.length - 1; i > 0; i--) {
    if (/^❯(\s|$)/.test(linjer[i]) && /^─{6,}/.test(linjer[i - 1])) {
      let slutt = i + 1;
      while (slutt < linjer.length && !/^─{6,}/.test(linjer[slutt])) slutt++;
      return [i, slutt];
    }
  }
  return null;
}
export function utenInntasting(linjer) {
  const boks = finnInntasting(linjer);
  return boks ? linjer.slice(0, boks[0]).concat(linjer.slice(boks[1])) : linjer;
}
// Innholdet vi faktisk vurderer: de ~15 linjene rett over inntastingsfeltet (eller de
// nederste, når en meny har tatt feltets plass). Rammen og footeren kommer i tillegg.
export function innholdOver(linjer) {
  const boks = finnInntasting(linjer);
  return (boks ? linjer.slice(0, boks[0] - 1) : linjer).slice(-INNHOLD);
}

// «venter» betyr KUN en åpen meny eller et åpent spørsmål. Regelen er strukturell:
// står inntastingsfeltet der, er økta ved prompten — da er ingenting en meny, uansett
// hva teksten over sier (sendte «❯ 1. …»-meldinger, siterte menyhint). En falsk
// «venter» er den verste feilen hagen kan gjøre; reglene har egne tester i test/.
// Avveiningen [vurdering]: en meny som viser seg SAMMEN med feltet, leses som ikke-venter.
// «Hva gjør den nå»: fra siste verktøylinje over inntastingsfeltet. Bare Claude Codes egne
// sammendrag («Read 1 file», «Ran 2 shell commands», «Running 1 shell command…») og
// verktøykall («⏺ Update(…)») teller — aldri prosa, og aldri transkriptene.
const VERB = {
  les: /^(read|reading|searched|searching|listed|listing|fetched|fetching|found|grepped)$/i,
  skriv: /^(wrote|writing|edited|editing|updated|updating|created|creating|write|edit|update)$/i,
  kjor: /^(ran|running|called|calling|bash|skill|agent|task)$/i,
};
const KALL = { Read: "les", Grep: "les", Glob: "les", WebFetch: "les", WebSearch: "les", Search: "les",
  Write: "skriv", Edit: "skriv", Update: "skriv", NotebookEdit: "skriv", Bash: "kjor", Skill: "kjor", Agent: "kjor", Task: "kjor" };
function typeForLedd(ledd) {
  const ord = ledd.trim().split(/\s+/)[0] || "";
  for (const [type, re] of Object.entries(VERB)) if (re.test(ord)) return type;
  return null;
}
export function lesAktivitet(rader) {
  const innhold = innholdOver(rader);
  for (let i = innhold.length - 1; i >= 0; i--) {
    const l = innhold[i].replace(/^\s*(⎿\s*)?/, "");
    const kall = l.match(/^⏺\s+([A-Z][A-Za-z]+)(\(|\s*$)/);
    if (kall && KALL[kall[1]]) return { type: KALL[kall[1]], tekst: kall[1] };
    // Sammendrag: verb fulgt av et tall («Ran 2 …», «Searched for 1 …», «called X 2 times»)
    if (!/^[A-Za-z]+\s+(for\s+)?(\d+|[\w:.-]+\s+\d+\s+times?)\b/.test(l)) continue;
    const ledd = l.replace(/[…]+$/, "").split(/,\s*/);
    const iGang = ledd.find((x) => /^\w+ing\b/i.test(x.trim()) && typeForLedd(x));
    const valgt = iGang || [...ledd].reverse().find((x) => typeForLedd(x));
    if (valgt) return { type: typeForLedd(valgt), tekst: l.replace(/[…]+$/, "").slice(0, 80) };
  }
  return null;
}

// 🧹 Når ble økta ferdig? «done H:MM AM/PM» i siste spinner-linje
// over inntastingsfeltet. Ligger tidspunktet fram i tid, var det i går.
export const RYDDE_MIN = 30;
export function lesFerdigKl(rader, naa = new Date()) {
  const linje = innholdOver(rader).filter((l) => /^\s*[·✢✳✶✻✽*]\s+\S/.test(l)).pop() || "";
  const m = linje.match(/\bdone\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let t = Number(m[1]) % 12;
  if (!m[3]) t = Number(m[1]);                       // 24-timers, hvis Claude Code viser det
  else if (m[3].toUpperCase() === "PM") t += 12;
  const d = new Date(naa); d.setHours(t, Number(m[2]), 0, 0);
  if (d > naa) d.setDate(d.getDate() - 1);
  return d;
}

// Linjene som gjør at en pane regnes som «venter» — tom liste når den ikke venter.
// Lagres i dataene, så hver «venter» kan etterprøves i ettertid.
export function venterFordi(rader) {
  if (finnInntasting(rader)) return [];
  const innhold = innholdOver(rader);
  const hint = innhold.filter((l) => /^\s*(Enter to select|Esc to cancel|Enter to confirm|↑\/↓ to navigate)/.test(l));
  const forst = innhold.filter((l) => /^\s*[│|]?\s*❯\s*1\.\s/.test(l));
  const andre = innhold.some((l) => /^\s*[│|]?\s*2\.\s/.test(l));
  return hint.concat(forst.length && andre ? forst : []).map((l) => l.trim().slice(0, 120));
}

export function lesStatus(rader) {
  const boks = finnInntasting(rader);
  const innhold = innholdOver(rader);
  const tekst = innhold.join("\n");
  if (venterFordi(rader).length) return "venter";
  const linjer = innhold;
  if (/esc to interrupt/i.test(tekst)) return "jobber";
  const spinn = linjer.filter((l) => /^\s*[·✢✳✶✻✽*]\s+\S/.test(l)).pop();
  if (spinn && /…/.test(spinn) && !/\bdone\b/.test(spinn)) return "jobber";
  return "ferdig";
}

// Valgfritt (quota.enabled): 5-timerskvoten fra en egen statuslinje, f.eks. «5h ●●●●○○○○○○ 43%».
// Gruppe 1 er prosenten; gruppe 2 og 3 (timer, minutter til nullstilling) er valgfrie.
export function lesKvote(linjer, re = new RegExp(STANDARD.quota.pattern)) {
  if (!re) return null;
  const m = linjer.join("\n").match(re);
  if (!m || m[1] === undefined) return null;
  return { pst: Number(m[1]), nullstillesMin: m[2] !== undefined && m[3] !== undefined ? Number(m[2]) * 60 + Number(m[3]) : null };
}

// Vær etter kvoten: sol under 50 %, skyer 50–80 %, regn over 80 %.
export function vaerFor(pst) { return pst > 80 ? "regn" : pst >= 50 ? "skyer" : "sol"; }

// De siste meningsfulle linjene, til infokortet. Rammer, footer og prompt-linja
// (der brukeren kanskje skriver et utkast) tas bort.
const KROM = /ctx ●|⏵⏵|auto mode|How is Claude|1: Bad|\/clear to save|To enable|Update installed|Restart to update|^\s*❯/;
export function sisteMeningsfulle(rader) {
  const linjer = utenInntasting(rader);
  // Inntastingsfeltet står mellom de to siste rammelinjene. Alt fra den nest siste og
  // ned er brukerens utkast + footer — det skal aldri ut på kortet.
  const rammer = linjer.map((l, i) => (/─{6,}/.test(l) ? i : -1)).filter((i) => i >= 0);
  const kutt = rammer.length >= 2 ? rammer[rammer.length - 2] : rammer.length === 1 ? rammer[0] : linjer.length;
  return linjer.slice(0, kutt)
    .filter((l) => !KROM.test(l) && !/^[\s─━│┃╭╮╰╯├┤┼┌┐└┘═]+$/.test(l) && !/─{6,}/.test(l))
    .slice(-4)
    .map((l) => (l.trim().length > 140 ? l.trim().slice(0, 139) + "…" : l.trim()));
}

// Modell og konto fra statuslinja. Kontoen er den første i «accounts» som treffer
// footeren; uten treff er den ukjent (null).
export function lesFot(linjer, kontoer = KONTOER) {
  const fot = linjer.filter((l) => /\b(Fable|Opus|Sonnet|Haiku)\b/.test(l)).pop();
  const bunn = linjer.slice(-6).join("\n");
  const konto = (kontoer.find((k) => k.re.test(fot || bunn)) || {}).label || null;
  if (!fot) return { modell: null, konto };
  const m = fot.match(/\b(Fable|Opus|Sonnet|Haiku)\s*([\d.]+)?\s*·\s*(low|medium|high|xhigh|max)\b/);
  const modell = m ? `${m[1]}${m[2] ? " " + m[2] : ""} · ${m[3]}` : fot.match(/\b(Fable|Opus|Sonnet|Haiku)[\w .]*/)[0].trim();
  return { modell, konto };
}

// Grupperte økter (session-a + session-b) og lenkede vinduer gjør at list-panes -a viser
// samme pane flere ganger. pane_id er sannheten: første forekomst vinner.
export function unikeRader(tekst) {
  const sett = new Set(), ut = [];
  for (const rad of tekst.split("\n").filter(Boolean)) {
    const [okt, vindu, id, cmd, hoyde, aktiv, ...resten] = rad.split("|");
    if (sett.has(id)) continue;
    sett.add(id);
    // Synlig [vurdering]: aktiv pane i aktivt vindu i en økt som har en klient (session_attached ≥ 1).
    const synlig = /^11[1-9]/.test(aktiv || "");
    ut.push({ okt, vindu, id, cmd, hoyde, synlig, navn: resten.join("|").trim() });
  }
  return ut;
}

// Hvilken pane ser brukeren på akkurat nå? Før gjaldt alle aktive paner i en økt med en
// klient som «sett». Med ett terminalvindu per leder, og focus-events av i tmux, meldte alle
// klientene «focused», og da ble alle lederne stille. Nå er bare én pane sett: den aktive
// panen i klienten brukeren sist skrev i, og bare når en terminal er appen foran. Står hagen
// (nettleseren) foran, ser brukeren ingen paner, og alle kan mjaue.
// klienter: linjer «activity|pane_id» fra list-clients. front: navnet på appen foran, eller null.
export function settPane(klienter, front) {
  const terminal = CONFIG.terminal.toLowerCase();
  if (!front || !(/ghostty|terminal|iterm|wezterm|kitty|alacritty/i.test(front) || front.toLowerCase() === terminal)) return null;
  let best = null, bestTid = -1;
  for (const rad of String(klienter || "").split("\n").filter(Boolean)) {
    const [tid, pane] = rad.split("|");
    if (Number(tid) > bestTid && pane) { bestTid = Number(tid); best = pane; }
  }
  return best;
}
function frontApp() {
  try {
    const asn = execFileSync("lsappinfo", ["front"], { encoding: "utf8", timeout: 1000 }).trim();
    const ut = execFileSync("lsappinfo", ["info", "-only", "name", asn], { encoding: "utf8", timeout: 1000 });
    const m = ut.match(/"LSDisplayName"="([^"]*)"/);
    return m ? m[1] : undefined;
  } catch { return undefined; } // ukjent: da gjelder den gamle regelen
}

function lesHagen() {
  let rader;
  try {
    rader = tmux(["list-panes", "-a", "-F",
      "#{session_name}|#{window_name}|#{pane_id}|#{pane_current_command}|#{pane_height}|#{pane_active}#{window_active}#{session_attached}|#{" + CONFIG.nameOption + "}"]);
  } catch (e) {
    const msg = String((e.stderr || e.message || "")).trim();
    // Ingen tmux-server = ingen ute. Det er en stille hage, ikke en feil.
    if (/no server running|error connecting|No such file or directory.*tmux-/i.test(msg)) return { panes: [], feil: null };
    if (e.code === "ENOENT") return { panes: [], feil: "Fant ikke tmux på denne maskinen." };
    if (e.code === "ETIMEDOUT" || e.signal === "SIGTERM") return { panes: [], feil: "tmux svarte ikke innen 4 sekunder." };
    return { panes: [], feil: "tmux svarte med en feil: " + msg.split("\n")[0] };
  }

  // Kan vi ikke lese klientene eller appen foran, faller vi tilbake på den gamle regelen.
  let sett;
  const front = frontApp();
  if (front !== undefined) {
    try { sett = settPane(tmux(["list-clients", "-F", "#{client_activity}|#{pane_id}"]), front); } catch { sett = undefined; }
  }

  const panes = [];
  for (const rad of unikeRader(rader)) {
    const { okt, vindu, id, cmd, hoyde, navn } = rad;
    const synlig = sett === undefined ? rad.synlig : rad.synlig && id === sett;
    const erSkall = SKALL.has(cmd);
    const erClaude = /^\d+\.\d+\.\d+$/.test(cmd) || /claude/i.test(cmd);
    if (!erSkall && !erClaude && !navn) continue; // vim, htop o.l. uten navn er ikke katter

    let venterLinjer = [], aktivitet = null, ferdigKl = null;
    let status = "tom", modell = null, konto = null, kvote5h = null, nullstillesMin = null, siste = [];
    if (!erSkall) {
      try {
        const linjer = sisteLinjer(id, Number(hoyde) || 40);
        status = lesStatus(linjer);
        if (status === "venter") venterLinjer = venterFordi(linjer);
        if (status === "jobber") aktivitet = lesAktivitet(linjer);
        if (status === "ferdig") { const fk = lesFerdigKl(linjer); if (fk) ferdigKl = fk.toISOString(); }
        ({ modell, konto } = lesFot(linjer));
        const kv = lesKvote(linjer, KVOTE_RE);
        if (kv) ({ pst: kvote5h, nullstillesMin } = kv);
        siste = sisteMeningsfulle(linjer);
      } catch {
        continue; // panen forsvant mellom list og capture
      }
    }
    panes.push({ id, okt, vindu, navn, kort: kortNavn(navn, vindu), leder: finnLeder(navn, okt, vindu), status, synlig, venterFordi: venterLinjer, aktivitet, ferdigKl, modell, konto, kvote5h, nullstillesMin, siste });
  }

  // Roller: første pane med et ledernavn er lederen, watchCat er vaktkatten, resten spesialister.
  const ledereSett = new Set();
  for (const p of panes) {
    if (LEDERE.includes(p.kort) && !ledereSett.has(p.kort)) { p.rolle = "leder"; p.leder = p.kort; ledereSett.add(p.kort); }
    else if (CONFIG.watchCat && p.kort.toUpperCase() === CONFIG.watchCat.toUpperCase()) p.rolle = "vakt";
    else p.rolle = "spesialist";
  }
  return { panes, feil: null };
}

const TEKST = {
  ferdig: "ble ferdig og la seg til å sove",
  jobber: "våknet og begynte å jobbe",
  venter: "venter på svar fra deg",
  tom: "ble et tomt skall",
};
function lesLogg() {
  try {
    const l = JSON.parse(readFileSync(HENDELSER, "utf8"));
    return { bilde: l.bilde || null, vaer: l.vaer || null, liste: Array.isArray(l.liste) ? l.liste.slice(-MAKS_HENDELSER) : [] };
  } catch { return { bilde: null, vaer: null, liste: [] }; }
}
const logg = lesLogg();

function noterHendelser(panes) {
  const ts = new Date().toISOString();
  const nye = [];
  const naa = Object.fromEntries(panes.map((p) => [p.id, { kort: p.kort, status: p.status, rolle: p.rolle }]));
  if (logg.bilde) {
    for (const p of panes) {
      const f = logg.bilde[p.id];
      if (!f) nye.push({ ts, id: p.id, kort: p.kort, type: "inn", tekst: "kom inn i hagen" });
      else if (f.status !== p.status) {
        const tekst = p.rolle === "vakt" && p.status === "ferdig" ? "er ferdig med runden" : TEKST[p.status];
        nye.push({ ts, id: p.id, kort: p.kort, type: p.status, tekst });
      }
    }
    for (const [id, f] of Object.entries(logg.bilde)) if (!naa[id]) nye.push({ ts, id, kort: f.kort, type: "ut", tekst: "gikk ut av hagen" });
  }
  logg.bilde = naa;
  logg.liste = logg.liste.concat(nye).slice(-MAKS_HENDELSER);
  try { writeFileSync(HENDELSER, JSON.stringify(logg)); } catch { /* loggen er pynt, ikke kritisk */ }
}

// Sier i loggen når været skifter, og hvilken konto som gir det.
function noterVaer(kvote) {
  const par = Object.entries(kvote);
  if (!par.length) return;
  const [konto, pst] = par.sort((a, b) => b[1] - a[1])[0];
  const naa = vaerFor(pst);
  if (logg.vaer === naa) return;
  const forrige = logg.vaer;
  logg.vaer = naa;
  if (!forrige && naa === "sol") { try { writeFileSync(HENDELSER, JSON.stringify(logg)); } catch {} return; }
  const tekst = naa === "regn" ? `er på ${pst} % — det regner i hagen`
    : naa === "skyer" ? `er på ${pst} % — skyer over hagen`
    : `er nede på ${pst} % — sola er tilbake`;
  logg.liste = logg.liste.concat([{ ts: new Date().toISOString(), kort: konto + "-kvoten", type: "vaer", vaer: naa, tekst }]).slice(-MAKS_HENDELSER);
  try { writeFileSync(HENDELSER, JSON.stringify(logg)); } catch { /* pynt */ }
}

function skriv() {
  const { panes, feil } = lesHagen();
  if (!feil) noterHendelser(panes); // en tmux-feil er ikke at alle gikk ut
  // Været følger 5h-kvoten. Høyeste avlesning per konto vinner [vurdering]: en fot kan
  // henge litt etter, og det er bedre å varsle regn for tidlig enn for sent.
  const kvote = {}, kvoteNullstilles = {};
  for (const p of panes) if (p.konto && p.kvote5h !== null && p.kvote5h >= (kvote[p.konto] ?? -1)) {
    kvote[p.konto] = p.kvote5h;
    kvoteNullstilles[p.konto] = p.nullstillesMin;
  }
  if (!feil) noterVaer(kvote);
  const data = { generertKl: new Date().toISOString(), feil, ledere: LEDERE, config: forSiden(CONFIG), configFeil: OPPSETT.feil, kvote, kvoteNullstilles, hopp: hoppInfo, kode: kodeVersjon(), kilde: KILDE, hendelser: logg.liste.slice(-40), panes };
  const tmp = UT + ".tmp";
  writeFileSync(tmp, "window.SPESIALIST_DATA = " + JSON.stringify(data, null, 2) + ";\n");
  renameSync(tmp, UT); // atomisk: siden leser aldri en halvskrevet fil
  const tell = (s) => panes.filter((p) => p.status === s).length;
  const linje = feil ? `⚠️  ${feil}`
    : `🐾 ${panes.length} katter · ${tell("jobber")} jobber · ${tell("ferdig")} ferdige · ${tell("venter")} venter · ${tell("tom")} tomme`;
  // Bare én loggrad når noe endrer seg — loggen skal ikke vokse med 8 000 linjer i døgnet.
  if (linje !== sistLogget) {
    const ventende = panes.filter((p) => p.status === "venter").map((p) => `${p.kort} («${(p.venterFordi || [])[0] || "?"}»)`);
    console.log(`${new Date().toLocaleString("nb-NO")} ${linje}${ventende.length ? " · venter: " + ventende.join(", ") : ""}`);
    sistLogget = linje;
    holdLoggenKort();
  }
}
let sistLogget = "";
let hoppInfo = null; // { port, token } når hopp-tjeneren går (bare i --live)

// Versjoner, så du ser hva som kjører, og så åpne faner kan laste ny kode:
// «kode» = hash av front-end-filene på disk nå · «kilde» = commit datakilden startet fra.
const FRONTEND = ["spesialister.html", "spesialister-app.js", "spesialister-bevegelse.js", "spesialister-tegning.js", "spesialister-lyd.js", "spesialister.css"];
export function kodeVersjon(mappe = fileURLToPath(new URL(".", import.meta.url))) {
  const h = createHash("sha1");
  for (const f of FRONTEND) { try { h.update(readFileSync(mappe + f)); } catch { h.update("mangler:" + f); } }
  return h.digest("hex").slice(0, 7);
}
const KILDE = (() => {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: fileURLToPath(new URL(".", import.meta.url)), encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "ukjent"; }
})();

// Under launchd (launchd/start.sh) går stdout til en loggfil. Blir den over 1 MB mens
// prosessen går, kortes den til de siste 500 linjene. Samme fil, så åpne filer peker riktig.
let skrevet = 0;
export function kortNedLogg(sti, maksByte = 1048576, beholdLinjer = 500) {
  if (!sti || statSync(sti).size <= maksByte) return false;
  const linjer = readFileSync(sti, "utf8").split("\n");
  writeFileSync(sti, linjer.slice(-beholdLinjer - 1).join("\n"));
  return true;
}
function holdLoggenKort() {
  if (!process.env.KATTEHAGE_LOGG || ++skrevet % 50) return;
  try { if (kortNedLogg(process.env.KATTEHAGE_LOGG)) console.log(`${new Date().toLocaleString("nb-NO")} ✂️  loggen kortet ned til de siste 500 linjene`); }
  catch { /* loggen er ikke kritisk */ }
}

// Én runde som feiler, skal aldri ta ned datakilden.
function trygt() {
  try { skriv(); } catch (e) { console.error(`${new Date().toLocaleString("nb-NO")} ⚠️  runden feilet: ${e && e.message}`); }
}

// Kjør bare når fila startes direkte — testene importerer funksjonene uten å skrive noe.
const erHoved = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (erHoved && process.argv.includes("--live")) {
  const h = startHoppTjener({ port: Number(process.env.KATTEHAGE_HOPP_PORT) || CONFIG.hopPort, terminal: CONFIG.terminal, torrkjoring: process.env.KATTEHAGE_HOPP_TORR === "1" });
  hoppInfo = { port: h.port, token: h.token };
}
if (erHoved) {
  for (const f of OPPSETT.feil) console.error(`⚠️  hage.config.json: ${f}`);
  if (!OPPSETT.fil) console.log("🐾 Fant ingen hage.config.json — bruker eksempeloppsettet (se README).");
  trygt();
}
if (erHoved && process.argv.includes("--live")) {
  setInterval(trygt, INTERVALL_MS);
  process.on("SIGTERM", () => process.exit(0)); // launchctl bootout
  process.on("SIGINT", () => { console.log("\nHagen går til ro. 🌙"); process.exit(0); });
}
