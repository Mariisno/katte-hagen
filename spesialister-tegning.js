/* Spesialist-hagen — hvor mye som tegnes per bilde. Ren logikk uten DOM og canvas, testet i
   node (test/tegning.test.mjs).

   Runde 9 (07.10): hagen var «veldig hakkete» på en ekstern skjerm. Målt på
   en ekstern 1080p-skjerm: hagen brukte ~29 % CPU i Chrome, mens et tomt vindu brukte 0,1 %. WindowServer
   lå på 50–56 % også uten hagen. Den største kostnaden var altså å tegne hele hagen på nytt
   60 ganger i sekundet. Rolig modus tegner bare det som har endret seg (skitne rektangler),
   uten svaiing og helskjermseffekter, og med ~30 bilder i sekundet. */
(function (ut) {
  "use strict";

  // ---------- skitne rektangler ----------
  // Et rektangel er [x0, y0, x1, y1] i hagens koordinater (1280 × 800).
  const areal = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const overlapper = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

  // Slå sammen rektangler som overlapper eller ligger nærmere enn margin, til ingen gjør det.
  function slaaSammen(liste, margin) {
    const m = margin === undefined ? 4 : margin;
    const r = liste.filter((x) => areal(x) > 0).map((x) => x.slice());
    let endret = true;
    while (endret) {
      endret = false;
      for (let i = 0; i < r.length && !endret; i++) {
        for (let j = i + 1; j < r.length; j++) {
          if (overlapper([r[i][0] - m, r[i][1] - m, r[i][2] + m, r[i][3] + m], r[j])) {
            r[i] = union(r[i], r[j]); r.splice(j, 1); endret = true; break;
          }
        }
      }
    }
    return r;
  }

  // Hva har endret seg siden forrige bilde? forrige = Map(id → {sig, bbox}), ting = [{id, sig, bbox}].
  // En ting som er flyttet eller endret, gir både det gamle og det nye stedet (ellers blir det
  // liggende et spor etter den). En ting som er borte, gir det gamle stedet.
  function skitne(forrige, ting) {
    const ut = [], sett = new Set();
    for (const t of ting) {
      sett.add(t.id);
      const f = forrige.get(t.id);
      if (!f) ut.push(t.bbox);
      else if (f.sig !== t.sig) { ut.push(f.bbox); ut.push(t.bbox); }
    }
    for (const [id, f] of forrige) if (!sett.has(id)) ut.push(f.bbox);
    return ut;
  }

  // ---------- rolig modus ----------
  // valg: "på" | "av" | null (= automatisk). Automatisk er den på når skjermen ikke er Retina
  // (devicePixelRatio under 2), eller når bildene har begynt å henge etter.
  function roligNaa(valg, dpr, henger) {
    if (valg === "på") return { rolig: true, grunn: "valgt" };
    if (valg === "av") return { rolig: false, grunn: "valgt" };
    if (henger) return { rolig: true, grunn: "henger" };
    if (dpr < 2) return { rolig: true, grunn: "ikke-retina" };
    return { rolig: false, grunn: "retina" };
  }
  // Knappen bytter det du ser. Blir det likt det automatikken ville valgt, går den tilbake til
  // automatisk, så hagen igjen følger skjermen når vinduet flyttes.
  function nyttValg(valg, dpr, henger) {
    const onsket = !roligNaa(valg, dpr, henger).rolig;
    return onsket === roligNaa(null, dpr, henger).rolig ? null : onsket ? "på" : "av";
  }

  // ---------- henger bildene etter? ----------
  // intervaller = ms mellom rAF-kall de siste ~2 s. Skjermens takt anslås som 10.-persentilen
  // (de raske bildene), så det virker likt på 60, 120 og 144 Hz. kjentTakt = den raskeste takten
  // sett på denne skjermen: da oppdages også en jevn, men halvert takt under last.
  // Over 20 % bilder som tar mer enn 1,7 × takten = henger etter.
  function hengerEtter(intervaller, kjentTakt) {
    const iv = intervaller.filter((x) => x > 0 && x < 1000); // bakgrunnsfane: én lang pause teller ikke
    const naa = takt(iv);
    if (!naa) return false;
    const t = kjentTakt ? Math.min(naa, kjentTakt) : naa;
    return iv.filter((x) => x > t * 1.7).length / iv.length > .2;
  }

  // Skjermens takt i ms: 10.-persentilen av rAF-intervallene (null før det finnes nok målinger).
  function takt(intervaller) {
    const iv = intervaller.filter((x) => x > 0 && x < 1000).sort((a, b) => a - b);
    return iv.length < 30 ? null : iv[Math.floor(iv.length * .1)];
  }

  // ---------- bildetak ----------
  // Tegn hvert n-te bilde, så takten blir jevn: 30 fps = hvert 2. bilde på 60 Hz, hvert 4. på
  // 120 Hz og hvert 5. på 144 Hz. En tidsgrense i ms ville gitt ujevn rytme (2, 3, 2, 3 …) på 144 Hz.
  function bildeHvert(taktMs, maksFps) {
    if (!taktMs || !maksFps) return 1;
    return Math.max(1, Math.round(1000 / taktMs / maksFps));
  }

  Object.assign(ut, { areal, overlapper, union, slaaSammen, skitne, roligNaa, nyttValg, hengerEtter, takt, bildeHvert });
})(typeof module === "object" && module.exports ? module.exports : (globalThis.HageTegning = {}));
