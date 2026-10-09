// Tester for bevegelsen (spesialister-bevegelse.js). Kjør: node --test test/
// Runde 8 (06.10), målt bilde for bilde i synlig Chrome: kattene som lekte, byttet tegning
// mellom sitt og løp ~120 ganger i minuttet, og farten hoppet 55 px/s på ett bilde. Testene
// kjører samme lek på 60, 120 og 144 Hz og med ujevne bilder, som på tre ulike skjermer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kodeVersjon } from "../spesialister.mjs";

const B = createRequire(import.meta.url)("../spesialister-bevegelse.js");

function frø(seed) { // samme tilfeldighet hver gang
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const RATER = {
  "60 Hz": () => () => 1 / 60,
  "120 Hz": () => () => 1 / 120,
  "144 Hz": () => () => 1 / 144,
  "ujevn (ProMotion)": () => { const r = frø(99); return () => (6.94 + r() * 9.73) / 1000; },
};
const nyKatt = (type) => {
  const slot = { x: 400, y: 300 };
  return { x: slot.x, y: slot.y, vx: 0, vy: 0, flip: 1, slot, a: { fase: 1.3 }, leke: { type, x: slot.x + 30, y: slot.y, vx: 0, vy: 0, rot: 0 } };
};
function kjørLek(type, sek, dtFn, seed = 7) {
  const k = nyKatt(type), rnd = frø(seed), spor = [];
  let t = 0;
  while (t < sek) {
    const dt = dtFn(); t += dt;
    const forX = k.x, forY = k.y;
    B.lek(k, t, dt, rnd);
    spor.push({ t, dt, x: k.x, y: k.y, fart: Math.hypot(k.x - forX, k.y - forY) / dt, reis: k.reis, vend: k.vend, flip: k.flip, fase: k.gangFase });
  }
  return spor;
}

for (const type of ["garn", "sommerfugl"]) {
  for (const [navn, lagDt] of Object.entries(RATER)) {
    test(`${type} · ${navn}: posen glir — aldri fra sitt til stå på ett bilde`, () => {
      const spor = kjørLek(type, 60, lagDt());
      for (let i = 1; i < spor.length; i++) {
        const maks = spor[i].dt / B.REIS_OPP + 1e-9;
        assert.ok(Math.abs(spor[i].reis - spor[i - 1].reis) <= maks, `reis hoppet ${spor[i - 1].reis} → ${spor[i].reis} ved ${spor[i].t.toFixed(2)} s`);
      }
    });
    test(`${type} · ${navn}: farten hopper aldri (før: 55 px/s på ett bilde)`, () => {
      const spor = kjørLek(type, 60, lagDt());
      let verst = 0;
      for (let i = 2; i < spor.length; i++) verst = Math.max(verst, Math.abs(spor[i].fart - spor[i - 1].fart));
      assert.ok(verst < 15, `største fartsendring på ett bilde: ${verst.toFixed(1)} px/s`);
    });
    test(`${type} · ${navn}: setter seg og reiser seg sjelden (før: 54–126 ganger i minuttet)`, () => {
      const spor = kjørLek(type, 60, lagDt());
      let overganger = 0;
      for (let i = 1; i < spor.length; i++) if ((spor[i].reis < .5) !== (spor[i - 1].reis < .5)) overganger++;
      assert.ok(overganger <= 40, `${overganger} overganger på 60 s`);
    });
    test(`${type} · ${navn}: snur seg maks hver 0,5 s, og vendingen glir`, () => {
      const spor = kjørLek(type, 60, lagDt());
      let sistSnu = -Infinity;
      for (let i = 1; i < spor.length; i++) {
        if (spor[i].flip !== spor[i - 1].flip) { assert.ok(spor[i].t - sistSnu >= B.MIN_SNU - 1e-9, `snudde igjen etter ${(spor[i].t - sistSnu).toFixed(2)} s`); sistSnu = spor[i].t; }
        assert.ok(Math.abs(spor[i].vend - spor[i - 1].vend) <= spor[i].dt / B.VEND_TID * 2 + 1e-9, "vendingen hoppet");
      }
    });
  }
}

test("lekene beveger seg like mye på 60 og 144 Hz", () => {
  for (const type of ["garn", "sommerfugl"]) {
    const andel = (dtFn) => { const s = kjørLek(type, 120, dtFn); return s.filter((x) => x.fart > .5).length / s.length; };
    const a = andel(RATER["60 Hz"]()), b = andel(RATER["144 Hz"]());
    assert.ok(Math.abs(a - b) < .08, `${type}: i bevegelse ${(a * 100).toFixed(0)} % på 60 Hz mot ${(b * 100).toFixed(0)} % på 144 Hz`);
  }
});

test("styr: når fram uten å skyte over, og aldri over makfarten", () => {
  for (const dt of [1 / 60, 1 / 144]) {
    const k = { x: 0, y: 0 }, c = { maks: 60, aks: 140, brems: 160 };
    let forbi = 0, maksFart = 0;
    for (let t = 0; t < 4; t += dt) { B.gaaTil(k, 100, 0, c, dt); forbi = Math.max(forbi, k.x - 100); maksFart = Math.max(maksFart, B.fartAv(k)); }
    assert.ok(Math.abs(k.x - 100) < 1e-9 && k.vx === 0, `stoppet på ${k.x}`);
    assert.ok(forbi <= 1e-9, `skjøt ${forbi} px forbi`);
    assert.ok(maksFart <= 60 + 1e-9, `fart ${maksFart}`);
  }
});

test("styr: samme vei på 60 og 144 Hz (under 1,5 px fra hverandre)", () => {
  const pos = (dt) => { const k = { x: 0, y: 0 }; for (let t = 0; t < 1.2 - 1e-9; t += dt) B.styr(k, 120, 40, { maks: 90, aks: 300, brems: 360 }, dt); return k; };
  const a = pos(1 / 60), b = pos(1 / 144);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1.5, `${a.x.toFixed(2)},${a.y.toFixed(2)} mot ${b.x.toFixed(2)},${b.y.toFixed(2)}`);
});

test("styr mot der den står bremser mykt (regresjon: stoppet fra 59 px/s på ett bilde)", () => {
  const k = { x: 0, y: 0, vx: 59, vy: 0 }, c = { maks: 95, aks: 300, brems: 360 };
  B.styr(k, k.x, k.y, c, 1 / 60);
  assert.ok(B.fartAv(k) >= 59 - 360 / 60 - 1e-9, `farten falt til ${B.fartAv(k).toFixed(1)} på ett bilde`);
});

test("beina går i takt med bakken: fasen følger strekningen, ikke klokka", () => {
  const k = { x: 0, y: 0, vx: 0, vy: 0 };
  for (let i = 0; i < 120; i++) B.kropp(k, 1 / 60, {});
  assert.equal(k.gangFase, 0, "fasen gikk mens katten sto stille");
  for (const dt of [1 / 60, 1 / 144]) {
    const g = { x: 0, y: 0, vx: 20, vy: 0, gangFase: 0 };
    let strekning = 0;
    for (let t = 0; t < 2 - 1e-9; t += dt) { B.kropp(g, dt, { skritt: true }); strekning += 20 * dt; }
    assert.ok(Math.abs(g.gangFase - strekning / B.SKRITT) < 1e-6, `fase ${g.gangFase} mot ${strekning / B.SKRITT}`);
  }
});

test("vaktrunden: svinger mykt i hjørnene og hopper aldri", () => {
  const r = B.lagVaktRunde({ x0: 74, y0: 98, x1: 1206, y1: 738 }, 44);
  let forrige = r.pos(0), forrigeVinkel = null, verstSving = 0;
  for (let s = 2; s <= r.omkrets + 2; s += 2) {
    const p = r.pos(s), steg = Math.hypot(p.x - forrige.x, p.y - forrige.y);
    assert.ok(steg <= 2 + 1e-6, `hoppet ${steg} px ved s=${s}`);
    const v = Math.atan2(p.y - forrige.y, p.x - forrige.x);
    if (forrigeVinkel !== null) verstSving = Math.max(verstSving, Math.abs(Math.atan2(Math.sin(v - forrigeVinkel), Math.cos(v - forrigeVinkel))));
    forrige = p; forrigeVinkel = v;
  }
  assert.ok(verstSving < .1, `skarpeste sving ${verstSving.toFixed(2)} rad per 2 px (før: 90° på ett bilde)`);
  for (const s of [10, 600, 1200, 2400, 3300]) { const p = r.pos(s), q = r.pos(r.naermest(p.x, p.y)); assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < .5); }
});

test("navnelappen følger katten eksakt, og bare sprang glir", () => {
  const s = {};
  B.lappSteg(s, "katt", 100, 100, 0, -66, 1 / 60);
  for (let i = 1; i <= 30; i++) { // katten går 1 px per bilde: lappen følger uten etterslep
    const v = B.lappSteg(s, "katt", 100 + i, 100, 0, -66, 1 / 60);
    assert.equal(v.x, 100 + i); assert.equal(v.y, 34);
  }
  const v1 = B.lappSteg(s, "katt", 130, 100, 0, -90, 1 / 60); // ny plass i køen: 24 px opp
  assert.ok(v1.y < 34 && v1.y > 10, `hoppet rett til ${v1.y}`);
  let v = v1; for (let i = 0; i < 30; i++) v = B.lappSteg(s, "katt", 130, 100, 0, -90, 1 / 60);
  assert.ok(Math.abs(v.y - 10) < .1, `fram etter 0,5 s: ${v.y}`);
  const før = s.vis; const v2 = B.lappSteg(s, "slot", 300, 100, 0, -74, 1 / 60); // nytt anker: starter der den står
  assert.ok(Math.hypot(v2.x - før.x, v2.y - før.y) < 30, "lappen hoppet til det nye ankeret");
  // likt på 60 og 144 Hz (0,25 s = 15 bilder på 60 Hz og 36 på 144 Hz)
  const etter = (dt) => { const t = {}; B.lappSteg(t, "katt", 0, 0, 0, 0, dt); let x; for (let i = 0; i < Math.round(.25 / dt); i++) x = B.lappSteg(t, "katt", 0, 0, 0, -40, dt); return x.y; };
  assert.ok(Math.abs(etter(1 / 60) - etter(1 / 144)) < .01);
});

test("kode-hashen tar med bevegelsesfila, så åpne faner laster ny bevegelse", () => {
  const mappe = mkdtempSync(join(tmpdir(), "hage-")) + "/";
  try {
    for (const f of ["spesialister.html", "spesialister-app.js", "spesialister-bevegelse.js", "spesialister.css"]) writeFileSync(mappe + f, f);
    const a = kodeVersjon(mappe);
    writeFileSync(mappe + "spesialister-bevegelse.js", "endret");
    assert.notEqual(kodeVersjon(mappe), a);
  } finally { rmSync(mappe, { recursive: true, force: true }); }
});
