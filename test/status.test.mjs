// Tester for statuslesingen. Kjør: node --test test/
// Viktigst: en falsk «venter» er den verste feilen hagen kan gjøre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lesStatus, lesKvote, unikeRader, sisteMeningsfulle, vaerFor } from "../spesialister.mjs";

const RAMME = "─".repeat(86);
const FOT = [
  "  dev  Opus 5.5 · medium  PERSONAL",
  "  ctx ●○○○○○○○○○ 10%   5h ●○○○○○○○○○ 8% · 3h 16m   7d ●●○○○○○○○○ 16% · tor 06:00",
  "  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents",
];
const skjerm = (innhold, input = "❯ ") => [...innhold, RAMME, ...[].concat(input), RAMME, ...FOT];

// Formet etter en ekte pane: ferdig, med «/exit» usendt i feltet.
const UTKAST = skjerm([
  "  Jeg kan ikke kjøre /exit selv, så panen må lukkes utenfra.",
  "  Dette er sporene nå: ingen åpne fra dette oppdraget.",
  "✻ Brewed for 37s · done 12:08 PM",
], "❯ /exit");

test("usendt «/exit» i inputfeltet gir ferdig, aldri venter", () => {
  assert.equal(lesStatus(UTKAST), "ferdig");
});

test("usendt nummerert liste i inputfeltet gir ikke venter", () => {
  const s = skjerm(["✻ Baked for 2s · done 9:14 AM"], ["❯ 1. gjør dette", "  2. og så dette"]);
  assert.equal(lesStatus(s), "ferdig");
});

test("et spørsmål i svarteksten er ikke en åpen meny", () => {
  const s = skjerm([
    "  Do you want to continue with option 2? Would you like to see more?",
    "  1. første spor",
    "  2. andre spor",
    "✻ Churned for 47s · done 11:57 AM",
  ]);
  assert.equal(lesStatus(s), "ferdig");
});

test("tilbakemeldings-skjemaet («1: Bad 2: Fine») gir ikke venter", () => {
  const s = skjerm([
    "✻ Churned for 6m 33s · done 11:37 AM",
    "● How is Claude doing this session? (optional)",
    "  1: Bad    2: Fine   3: Good   0: Dismiss",
  ]);
  assert.equal(lesStatus(s), "ferdig");
});

// [vurdering] Menyene under er bygd etter Claude Codes oppsett, ikke avlest live.
test("åpen tillatelsesmeny gir venter", () => {
  const s = [
    " Bash command",
    "   rm -rf build",
    " Do you want to proceed?",
    " ❯ 1. Yes",
    "   2. Yes, and don't ask again for rm commands in this project",
    "   3. No, and tell Claude what to do differently (esc)",
    ...FOT,
  ];
  assert.equal(lesStatus(s), "venter");
});

test("åpent spørsmål (AskUserQuestion) gir venter", () => {
  const s = [
    " Hvilken variant vil du ha?",
    " ❯ 1. Kompakt",
    "   2. Hele hagen",
    " Enter to select · ↑/↓ to navigate · Esc to cancel",
  ];
  assert.equal(lesStatus(s), "venter");
});

test("spinner med esc to interrupt gir jobber, også med tekst i feltet", () => {
  const s = skjerm(["✶ Brewing… (12s · ↓ 1.2k tokens · esc to interrupt)"], "❯ neste ting");
  assert.equal(lesStatus(s), "jobber");
});

test("kortet viser aldri utkastet i inputfeltet", () => {
  const linjer = sisteMeningsfulle(UTKAST);
  assert.ok(!linjer.some((l) => l.includes("/exit") && l.startsWith("❯")));
  assert.ok(linjer.at(-1).includes("done 12:08"));
});

test("5h-kvoten leses med tid til nullstilling", () => {
  assert.deepEqual(lesKvote(["  ctx ●●●●●○○○○○ 54%   5h ●●●●●●●●●● 99% · 0h 25m"]), { pst: 99, nullstillesMin: 25 });
  assert.deepEqual(lesKvote(["  ctx ●○○ 7%   7d ●○○○○○○○○○ 6% · tor 06:00"]), null);
  assert.equal(vaerFor(99), "regn");
  assert.equal(vaerFor(50), "skyer");
  assert.equal(vaerFor(13), "sol");
});

test("panes i grupperte økter (garden + garden-view) telles én gang", () => {
  const rader = [
    "garden|LEAD-D|%55|2.1.291|43|111|LEAD-D · side projects (Personal)",
    "garden-view|LEAD-D|%55|2.1.291|43|111|LEAD-D · side projects (Personal)",
    "engine|kattehage|%54|2.1.291|44|110|KEEPER · the garden (LEAD-D, Personal)",
  ].join("\n");
  const ut = unikeRader(rader);
  assert.equal(ut.length, 2);
  assert.equal(ut[0].okt, "garden"); // første forekomst vinner
  assert.equal(ut[0].synlig, true, "aktiv pane i aktivt vindu i en vist økt");
  assert.equal(ut[1].synlig, false, "økta har ingen klient");
  assert.equal(ut[1].navn, "KEEPER · the garden (LEAD-D, Personal)");
});

// Runde 4: blafring og falske «venter» fra historikken.
test("en sendt brukermelding «❯ 1. …» i historikken gir ikke venter", () => {
  const s = skjerm([
    "❯ 1. ja, kjør det",
    "",
    "⏺ Gjør det nå. To spor:",
    "  2. merge når du har sett",
    "✻ Crunched for 26s · done 12:32 PM",
  ]);
  assert.equal(lesStatus(s), "ferdig");
});

test("menyhint sitert i svarteksten gir ikke venter", () => {
  const s = skjerm([
    "  «Venter» krever nå menyhint (Esc to cancel, Enter to select) utenfor feltet.",
    "✻ Brewed for 37s · done 12:08 PM",
  ]);
  assert.equal(lesStatus(s), "ferdig");
});

test("spinneren over en lang todo-liste gir fortsatt jobber", () => {
  const todo = Array.from({ length: 9 }, (_, i) => `     ☐ steg ${i + 1} i planen`);
  const s = skjerm(["✢ Snuser på problemet… (5m 48s · ↓ 11.3k tokens)", "  ⎿  ☒ les oppdraget", ...todo]);
  assert.equal(lesStatus(s.slice(-32)), "jobber", "med vinduet hagen faktisk leser (32 rå linjer)");
});

test("loggen kortes ned til de siste 500 linjene når den passerer 1 MB", async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { kortNedLogg } = await import("../spesialister.mjs");
  const sti = join(mkdtempSync(join(tmpdir(), "kattehage-")), "logg.log");
  writeFileSync(sti, Array.from({ length: 20000 }, (_, i) => `linje ${i} ${"x".repeat(60)}`).join("\n") + "\n");
  assert.equal(kortNedLogg(sti), true);
  const igjen = readFileSync(sti, "utf8").trim().split("\n");
  assert.equal(igjen.length, 500);
  assert.ok(igjen.at(-1).startsWith("linje 19999"));
  assert.equal(kortNedLogg(sti), false, "liten logg røres ikke");
});

test("hopp: bare gyldige pane-id-er, bare lokale opphav, og alltid et nytt Ghostty-vindu med gruppert økt", async () => {
  const { gyldigPaneId, tillattOpphav, planForHopp } = await import("../lib/hopp.mjs");
  assert.ok(gyldigPaneId("%54"));
  for (const ond of ["54", "%54; rm -rf /", "%", "$(id)", "%5a", "", null, 54]) assert.ok(!gyldigPaneId(ond), String(ond));
  assert.ok(tillattOpphav("null") && tillattOpphav(undefined) && tillattOpphav("http://127.0.0.1:8851"));
  assert.ok(!tillattOpphav("https://evil.example") && !tillattOpphav("http://127.0.0.1.evil.example"));
  const plan = planForHopp("%54", "engine", "/opt/homebrew/bin/tmux");
  assert.deepEqual(plan.slice(0, 5), ["-na", "Ghostty", "--args", "-e", "/opt/homebrew/bin/tmux"], "alltid et nytt vindu");
  assert.ok(plan.includes("destroy-unattached"), "den grupperte økta rydder seg selv");
  assert.ok(!plan.includes("switch-client"), "flytter aldri et vindu du alt har");
  assert.deepEqual(plan.slice(5, 9), ["new-session", "-t", "engine", ";"]);
  assert.equal(planForHopp("%54", "engine", "tmux", "WezTerm")[1], "WezTerm", "terminalen kan velges");
});

test("aktivitet: siste verktøylinje gir lese/skrive/kjøre, prosa og innhold ignoreres", async () => {
  const { lesAktivitet } = await import("../spesialister.mjs");
  const rad = (...l) => skjerm(l);
  assert.equal(lesAktivitet(rad("  Read 1 file", "✢ Snuser… (5s)")).type, "les");
  assert.equal(lesAktivitet(rad("  Ran 2 shell commands", "✢ Snuser… (5s)")).type, "kjor");
  assert.equal(lesAktivitet(rad("  Running 1 shell command…", "✢ Snuser… (5s)")).type, "kjor");
  assert.equal(lesAktivitet(rad("  Searched for 1 pattern, ran 1 shell command", "✢ … (5s)")).type, "kjor", "siste ledd vinner");
  assert.equal(lesAktivitet(rad("  Read 2 files, edited 1 file", "✢ … (5s)")).type, "skriv");
  assert.equal(lesAktivitet(rad("  Wrote 1 file", "✢ … (5s)")).type, "skriv");
  assert.equal(lesAktivitet(rad("  Read 1 file, called plugin:playwright:playwright 2 times", "✢ … (5s)")).type, "kjor");
  assert.equal(lesAktivitet(rad("⏺ Update(spesialister.mjs)", "✢ … (5s)")).type, "skriv");
  assert.equal(lesAktivitet(rad("  Reading the legacy approval calendar template", "✢ … (5s)")), null, "prosa er ikke en verktøylinje");
  assert.equal(lesAktivitet(rad("  Read 1 file", "  Running 1 shell command…")).type, "kjor", "i gang vinner over ferdig");
  const a = lesAktivitet(rad("  Ran 4 shell commands"));
  assert.equal(a.tekst, "Ran 4 shell commands");
});

// Claude Code viser grå forslag i inputfeltet (ESC[2m). capture-pane -p uten -e gjør dem
// til vanlig tekst — de skal aldri påvirke status, aktivitet eller kortets siste linjer.
test("grå forslag i inputfeltet påvirker verken status, aktivitet eller kortet", async () => {
  const { lesAktivitet } = await import("../spesialister.mjs");
  const ferdigInnhold = ["  Dette er sporene nå: ingen.", "✻ Baked for 2s · done 9:14 AM"];
  const forslag = [
    "❯ 1. Yes, kjør testene på nytt",
    "❯ Enter to select · Esc to cancel",
    "❯ esc to interrupt",
    "❯ Read 1 file og oppsummer",
    "❯ ✢ Snuser på problemet… (5s)",
  ];
  for (const f of forslag) {
    const s = skjerm(ferdigInnhold, [f, "  2. No, gjør noe annet"]);
    assert.equal(lesStatus(s), "ferdig", `forslag «${f}»`);
    assert.equal(lesAktivitet(s), null, `aktivitet fra forslag «${f}»`);
    assert.ok(!sisteMeningsfulle(s).some((l) => l.includes(f.slice(2, 12))), `kortet viser ikke «${f}»`);
  }
  // og en som jobber, forblir jobber selv med et forslag som ligner «ferdig»
  const jobber = skjerm(["✢ Snuser på problemet… (12s · ↓ 2k tokens)"], "❯ ✻ Brewed for 3s · done 1:00 PM");
  assert.equal(lesStatus(jobber), "jobber");
});

// 🧹 «done H:MM» fra spinner-linja, mer enn 30 min gammel.
test("ferdig-tidspunkt leses fra «done H:MM AM/PM», også over midnatt", async () => {
  const { lesFerdigKl } = await import("../spesialister.mjs");
  const kl = (s) => new Date(`2026-10-06T${s}`);
  const ferdig = (linje) => skjerm(["  Dette er sporene nå: ingen.", linje]);
  assert.equal(lesFerdigKl(ferdig("✻ Brewed for 37s · done 12:08 PM"), kl("13:00:00")).toTimeString().slice(0, 5), "12:08");
  assert.equal(lesFerdigKl(ferdig("✻ Baked for 2s · done 9:14 AM"), kl("13:00:00")).toTimeString().slice(0, 5), "09:14");
  assert.equal(lesFerdigKl(ferdig("✻ Churned for 6m · done 12:30 AM"), kl("13:00:00")).toTimeString().slice(0, 5), "00:30");
  const igaar = lesFerdigKl(ferdig("✻ Brewed for 4s · done 11:50 PM"), kl("00:20:00"));
  assert.equal(igaar.getDate(), 5, "11:50 PM sett kl. 00:20 var i går");
  assert.equal(lesFerdigKl(ferdig("✻ Crunched for 26s · done 12:32 PM · 1 monitor still running"), kl("13:00:00")).toTimeString().slice(0, 5), "12:32");
  assert.equal(lesFerdigKl(skjerm(["✢ Snuser… (5s)"]), kl("13:00:00")), null, "ingen done-linje");
});
