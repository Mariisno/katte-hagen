// Tester for hva som tegnes per bilde (spesialister-tegning.js). Kjør: node --test test/
// Runde 9 (07.10): hagen brukte ~29 % CPU i Chrome på DELL-skjermen. Rolig modus tegner bare
// det som er endret, med ~30 bilder i sekundet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const T = createRequire(import.meta.url)("../spesialister-tegning.js");

test("skitne: en ting som flytter seg gir både gammelt og nytt sted, uendret gir ingenting", () => {
  const forrige = new Map([["katt", { sig: "a", bbox: [0, 0, 10, 10] }], ["tre", { sig: "", bbox: [50, 50, 60, 60] }], ["borte", { sig: "x", bbox: [90, 90, 95, 95] }]]);
  const ut = T.skitne(forrige, [{ id: "katt", sig: "b", bbox: [5, 0, 15, 10] }, { id: "tre", sig: "", bbox: [50, 50, 60, 60] }, { id: "ny", sig: "", bbox: [30, 30, 32, 32] }]);
  assert.deepEqual(ut, [[0, 0, 10, 10], [5, 0, 15, 10], [30, 30, 32, 32], [90, 90, 95, 95]]);
});

test("slaaSammen: overlappende og nære rektangler blir ett, og ingen overlapper etterpå", () => {
  const r = T.slaaSammen([[0, 0, 10, 10], [8, 8, 20, 20], [23, 0, 30, 5], [100, 100, 110, 110]], 4);
  assert.deepEqual(r, [[0, 0, 30, 20], [100, 100, 110, 110]]);
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) assert.ok(!T.overlapper(r[i], r[j]));
  assert.deepEqual(T.slaaSammen([[5, 5, 5, 9]]), [], "tomme rektangler forsvinner");
});

test("rolig modus: automatisk på uten Retina og når bildene henger, ellers av; eget valg vinner", () => {
  assert.deepEqual(T.roligNaa(null, 1, false), { rolig: true, grunn: "ikke-retina" });
  assert.deepEqual(T.roligNaa(null, 2, false), { rolig: false, grunn: "retina" });
  assert.deepEqual(T.roligNaa(null, 2, true), { rolig: true, grunn: "henger" });
  assert.equal(T.roligNaa("av", 1, true).rolig, false);
  assert.equal(T.roligNaa("på", 2, false).rolig, true);
});

test("knappen bytter det du ser, og går tilbake til automatisk når det blir likt", () => {
  assert.equal(T.nyttValg(null, 1, false), "av");   // DELL: auto på → klikk → av
  assert.equal(T.nyttValg("av", 1, false), null);   // klikk igjen → på = auto
  assert.equal(T.nyttValg(null, 2, false), "på");   // Retina: auto av → klikk → på
  assert.equal(T.nyttValg("på", 2, false), null);
});

const jevn = (ms, n = 120) => Array.from({ length: n }, () => ms);
test("henger etter: oppdager 25 % sene bilder og en halvert takt, men ikke jevn 60, 120 eller 144 Hz", () => {
  for (const ms of [1000 / 60, 1000 / 120, 1000 / 144]) assert.equal(T.hengerEtter(jevn(ms)), false);
  const ujevn = jevn(1000 / 60).map((x, i) => (i % 4 === 0 ? x * 2 : x)); // hvert 4. bilde tar dobbelt så lang tid
  assert.equal(T.hengerEtter(ujevn), true);
  assert.equal(T.hengerEtter(jevn(1000 / 30), 1000 / 60), true, "jevn 30 Hz på en 60 Hz-skjerm henger");
  assert.equal(T.hengerEtter([...jevn(1000 / 60, 119), 5000]), false, "en bakgrunnsfane som våkner teller ikke");
  assert.equal(T.hengerEtter(jevn(1000 / 60, 10)), false, "for få målinger");
});

test("bildetak: jevn rytme — 30 fps er hvert 2., 4. og 5. bilde på 60, 120 og 144 Hz", () => {
  assert.equal(T.bildeHvert(1000 / 60, 30), 2);
  assert.equal(T.bildeHvert(1000 / 120, 30), 4);
  assert.equal(T.bildeHvert(1000 / 144, 30), 5);
  assert.equal(T.bildeHvert(1000 / 60, 60), 1);
  assert.equal(T.bildeHvert(1000 / 144, 60), 2);
  assert.equal(T.bildeHvert(null, 30), 1, "før takten er målt: tegn hvert bilde");
  assert.equal(T.takt(jevn(1000 / 60)), 1000 / 60);
});
