// Tester for mjauet (spesialister-lyd.js) og regelen for hvem som er «sett» (spesialister.mjs).
// Logikken testes, ikke lyden: en falsk AudioContext skriver ned hva som blir planlagt.
// Kjør: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { settPane } from "../spesialister.mjs";

const L = createRequire(import.meta.url)("../spesialister-lyd.js");

// ---------- en falsk AudioContext ----------
function falskKontekst() {
  const noder = [], startet = [], stoppet = [];
  const param = (verdi = 0) => {
    const p = { value: verdi, hendelser: [] };
    p.setValueAtTime = (v, t) => p.hendelser.push(["set", v, t]);
    p.linearRampToValueAtTime = (v, t) => p.hendelser.push(["lin", v, t]);
    p.exponentialRampToValueAtTime = (v, t) => p.hendelser.push(["exp", v, t]);
    return p;
  };
  const node = (type, felt) => {
    const n = { type, til: [], ...felt, connect(m) { n.til.push(m); return m; } };
    noder.push(n); return n;
  };
  const ac = {
    currentTime: 10, destination: { type: "destination" },
    createOscillator: () => node("osc", { frequency: param(440), detune: param(0), setPeriodicWave() {}, start: (t) => startet.push(t), stop: (t) => stoppet.push(t) }),
    createGain: () => node("gain", { gain: param(1) }),
    createBiquadFilter: () => node("filter", { frequency: param(350), Q: param(1) }),
    createPeriodicWave: () => ({}),
  };
  return { ac, noder, startet, stoppet };
}
const toppAv = (kurve) => Math.max(...kurve.map(([, v]) => v));

// ---------- AV som standard, og hvem som får lyd ----------
test("lyden er AV som standard: bare den lagrede verdien «på» slår den på", () => {
  assert.equal(L.lydPaFra(null), false);
  assert.equal(L.lydPaFra(undefined), false);
  assert.equal(L.lydPaFra("av"), false);
  assert.equal(L.lydPaFra("true"), false);
  assert.equal(L.lydPaFra("på"), true);
});

test("ingen lyd for en pane du ser på, og ingen lyd med bryteren av", () => {
  assert.equal(L.skalSpilles(true, false), true);
  assert.equal(L.skalSpilles(true, true), false, "du ser på panen");
  assert.equal(L.skalSpilles(false, false), false, "bryteren er av");
  assert.equal(L.skalSpilles(true, undefined), true, "ukjent pane regnes som ikke sett");
});

test("ferdig gir «mjau», venter gir «mjau?», påminnelsen gir «mrrau?»", () => {
  assert.equal(L.lydFor("ferdig"), "ferdig");
  assert.equal(L.lydFor("venter"), "venter");
  assert.equal(L.lydFor("venter", true), "paminn");
  assert.equal(L.lydFor("noe annet"), "ferdig");
});

test("påminnelsen kommer etter 5 min, og så hvert 15. min", () => {
  const min = 60000;
  assert.equal(L.paminnelseNr(0), -1);
  assert.equal(L.paminnelseNr(4.99 * min), -1);
  assert.equal(L.paminnelseNr(5 * min), 0);
  assert.equal(L.paminnelseNr(19.9 * min), 0);
  assert.equal(L.paminnelseNr(20 * min), 1);
  assert.equal(L.paminnelseNr(35 * min), 2);
});

test("«Hør mjau» går rundt alle variantene", () => {
  let i = -1; const hort = [];
  for (let n = 0; n < 4; n++) { i = L.nesteProve(i); hort.push(L.REKKEFOLGE[i]); }
  assert.deepEqual(hort, ["ferdig", "venter", "paminn", "ferdig"]);
  for (const navn of L.REKKEFOLGE) assert.ok(L.VARIANTER[navn].tekst && L.VARIANTER[navn].naar, navn);
});

// ---------- formen på mjauene ----------
test("hver variant varer 0,4–0,6 s og starter og slutter i stillhet (ingen klikk)", () => {
  for (const navn of L.REKKEFOLGE) {
    const p = L.lagPlan(navn);
    assert.ok(p.varighet >= .4 && p.varighet <= .6, `${navn}: ${p.varighet} s`);
    assert.equal(p.styrke[0][1], 0, navn);
    assert.equal(p.styrke.at(-1)[1], 0, navn);
    assert.equal(p.styrke.at(-1)[0], p.varighet, navn);
  }
});

test("«mjau» går opp og så ned; «mjau?» og «mrrau?» slutter høyere enn de startet", () => {
  const f = L.lagPlan("ferdig").tone;
  assert.ok(toppAv(f) > f[0][1] && f.at(-1)[1] < toppAv(f));
  for (const navn of ["venter", "paminn"]) {
    const t = L.lagPlan(navn).tone;
    assert.ok(t.at(-1)[1] > t[0][1] * 1.5, `${navn} stiger som et spørsmål`);
    assert.equal(t.at(-1)[1], toppAv(t), `${navn} slutter på toppen`);
  }
});

test("ikke skingrende: tonen holder seg under 900 Hz og formantene under lavpasset", () => {
  for (const navn of L.REKKEFOLGE) {
    const p = L.lagPlan(navn);
    assert.ok(toppAv(p.tone) <= 900, `${navn} tone ${toppAv(p.tone)}`);
    assert.ok(toppAv(p.f2) < L.LAVPASS, `${navn} f2 ${toppAv(p.f2)}`);
  }
  assert.ok(L.LAVPASS <= 3500);
});

test("volumet er moderat, og taket holder selv om noen ber om fullt volum", () => {
  for (const navn of L.REKKEFOLGE) assert.ok(toppAv(L.lagPlan(navn).styrke) <= L.VOLUM + 1e-9);
  assert.ok(toppAv(L.lagPlan("ferdig", 5).styrke) <= L.TAK + 1e-9);
  assert.ok(L.VOLUM <= L.TAK && L.TAK < 1);
});

test("ukjent variant faller tilbake til «mjau»", () => {
  assert.equal(L.lagPlan("finnes-ikke").navn, "ferdig");
});

// ---------- grafen som blir planlagt ----------
test("spill planlegger lyden og stopper alle kildene rett etter slutten", () => {
  for (const navn of L.REKKEFOLGE) {
    const { ac, noder, startet, stoppet } = falskKontekst();
    const r = L.spill(ac, navn);
    assert.ok(r.start >= ac.currentTime, "starter ikke i fortiden");
    assert.ok(Math.abs(r.slutt - r.start - L.VARIANTER[navn].varighet) < 1e-9);
    assert.equal(startet.length, stoppet.length, "alt som starter, stopper");
    for (const t of stoppet) assert.ok(t > r.slutt && t <= r.slutt + .1, `${navn} stopper ved ${t}`);
    // Lyden når fram til høyttaleren
    assert.ok(noder.some((n) => n.til.includes(ac.destination)), navn);
    // Ingen gain på lydveien planlegges høyere enn taket (vibrato- og trille-styrken styrer
    // en parameter, ikke lyden, så de telles ikke)
    const paLydveien = noder.filter((x) => x.type === "gain" && x.til.every((m) => m.type));
    // Faste ledd forsterker aldri (≤ 1); styrkekurven (det som er volumet) holder seg under taket.
    for (const n of paLydveien) {
      assert.ok(n.gain.value <= 1, `${navn} fast gain ${n.gain.value}`);
      for (const [, v] of n.gain.hendelser) assert.ok(v <= 1, `${navn} gain ${v}`);
    }
    const env = paLydveien.find((n) => n.gain.hendelser.length > 2);
    assert.ok(env && Math.max(...env.gain.hendelser.map((h) => h[1])) <= L.TAK, `${navn} volum`);
    // Lavpasset er med (det tar det skingrende)
    assert.ok(noder.some((n) => n.type === "lowpass" && n.frequency.value === L.LAVPASS), navn);
  }
});

test("bare påminnelsen har trillen («rr»)", () => {
  assert.ok(L.lagPlan("paminn").trille);
  assert.equal(L.lagPlan("ferdig").trille, null);
  assert.equal(L.lagPlan("venter").trille, null);
  const { ac, startet } = falskKontekst(); L.spill(ac, "paminn");
  assert.equal(startet.length, 3, "tone, vibrato og trille");
});

// ---------- hvem er «sett» (årsaken til at lederne var stille) ----------
// Formet etter `tmux list-clients`: sju Ghostty-klienter, alle «focused» fordi focus-events
// er av. Før ble alle lederne regnet som sett, og de var stille.
const KLIENTER = [
  "1791544160|%0", "1791547984|%31", "1791545771|%39", "1791547630|%90",
  "1791548020|%40", "1791547643|%31", "1791548028|%0",
].join("\n");

test("bare panen i klienten du sist skrev i, er sett — når Ghostty er foran", () => {
  assert.equal(settPane(KLIENTER, "Ghostty"), "%0");
});

test("står hagen (Chrome) eller noe annet foran, er ingen pane sett", () => {
  assert.equal(settPane(KLIENTER, "Google Chrome"), null);
  assert.equal(settPane(KLIENTER, "Preview"), null);
  assert.equal(settPane(KLIENTER, null), null);
});

test("ingen klienter gir ingen sett pane", () => {
  assert.equal(settPane("", "Ghostty"), null);
});
