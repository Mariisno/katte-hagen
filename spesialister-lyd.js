/* Spesialist-hagen — mjau. Lyden lages i nettleseren med Web Audio: ingen lydfiler, ingen
   lisens, ingenting lastes ned. Logikken (hvilken mjau, når, hvor høyt) er ren og testes i
   node (test/lyd.test.mjs) med en falsk AudioContext. Selve lyden testes ikke.

   Ønsket 09.10: ekte mjau, og en knapp for å høre den.

   Slik lages en mjau: en myk tone (få overtoner, litt vibrato) går gjennom to formantfiltre,
   altså de to resonansene som gjør en lyd til en vokal. Tonen sveiper opp og ned, og
   formantene glir fra lukket «m» via åpen «ja» til «u», som gir «m-j-a-u». Et lavpass på
   3 kHz tar bort det skingrende. Volumet er moderat og går mykt inn og ut, uten klikk. */
(function (ut) {
  "use strict";

  // Kurver i relativ tid (0 = start, 1 = slutt) som [tid, verdi]. lagPlan skalerer til sekunder.
  const VARIANTER = {
    // Kort «mjau» når en katt blir ferdig: opp, så ned og lukket.
    ferdig: {
      tekst: "Mjau", naar: "når en katt blir ferdig", varighet: .48,
      tone: [[0, 520], [.3, 690], [.7, 600], [1, 470]],
      f1: [[0, 320], [.25, 780], [.6, 850], [1, 420]],
      f2: [[0, 1100], [.2, 1900], [.55, 1500], [1, 850]],
      styrke: [[0, 0], [.12, .8], [.3, 1], [.75, .7], [1, 0]],
    },
    // Spørrende «mjau?» når en katt venter på deg: tonen stiger på slutten, munnen blir åpen.
    venter: {
      tekst: "Mjau?", naar: "når en katt venter på deg", varighet: .56,
      tone: [[0, 470], [.3, 560], [.55, 540], [1, 860]],
      f1: [[0, 320], [.25, 760], [.7, 820], [1, 700]],
      f2: [[0, 1100], [.25, 1800], [.6, 1600], [1, 2000]],
      styrke: [[0, 0], [.12, .75], [.4, 1], [.85, .85], [1, 0]],
    },
    // «Mrrau?» som påminnelse etter 5 min: en liten trille først, så et spørsmål.
    paminn: {
      tekst: "Mrrau?", naar: "når en katt har ventet i 5 min", varighet: .6,
      tone: [[0, 430], [.3, 450], [.6, 560], [1, 800]],
      f1: [[0, 300], [.3, 380], [.55, 780], [1, 650]],
      f2: [[0, 900], [.3, 1000], [.55, 1700], [1, 1900]],
      styrke: [[0, 0], [.08, .7], [.3, .8], [.6, 1], [.9, .8], [1, 0]],
      trille: { hz: 26, dybde: .45, til: .32 },
    },
  };
  const REKKEFOLGE = ["ferdig", "venter", "paminn"];

  // Moderat (målt 09.10 i hodeløs, dempet Chromium med OfflineAudioContext): toppen ligger
  // rundt −16 dBFS. Det gamle plinget lå på −26 til −29 dBFS, så lavt at det knapt hørtes,
  // og det kan ha vært en del av hvorfor hagen virket stum. TAK er en sperre (≈ −10 dBFS).
  const VOLUM = .17, TAK = .35;
  const LAVPASS = 3000; // over dette blir en mjau skingrende

  const PAMINN_FORST = 5 * 60000, PAMINN_SIDEN = 15 * 60000;

  // ---------- når og hvilken ----------
  const lydPaFra = (lagretVerdi) => lagretVerdi === "på"; // AV som standard: alt annet enn «på» er av
  const lydFor = (type, paminnelse) => (paminnelse ? "paminn" : type === "venter" ? "venter" : "ferdig");
  // Ingen lyd for en pane du alt ser på, og ingen lyd når bryteren er av.
  const skalSpilles = (lydPa, synlig) => Boolean(lydPa) && !synlig;
  // Hvilken påminnelse en ventetid gir: −1 før 5 min, så 0 ved 5 min, 1 ved 20 min, 2 ved 35 …
  const paminnelseNr = (ventetMs) => (ventetMs < PAMINN_FORST ? -1 : Math.floor((ventetMs - PAMINN_FORST) / PAMINN_SIDEN));
  // «Hør mjau» går rundt alle variantene, én per trykk.
  const nesteProve = (i) => (i + 1) % REKKEFOLGE.length;

  // ---------- planen: kurvene i sekunder ----------
  function lagPlan(navn, volum = VOLUM) {
    const v = VARIANTER[navn] || VARIANTER.ferdig;
    const sek = (kurve) => kurve.map(([t, verdi]) => [t * v.varighet, verdi]);
    const vol = Math.min(volum, TAK);
    return {
      navn: VARIANTER[navn] ? navn : "ferdig", varighet: v.varighet,
      tone: sek(v.tone), f1: sek(v.f1), f2: sek(v.f2),
      styrke: sek(v.styrke).map(([t, s]) => [t, s * vol]),
      trille: v.trille ? { hz: v.trille.hz, dybde: v.trille.dybde, til: v.trille.til * v.varighet } : null,
    };
  }

  // ---------- lyden ----------
  function kurve(param, punkter, t0) {
    param.setValueAtTime(punkter[0][1], t0);
    for (const [t, verdi] of punkter.slice(1)) param.linearRampToValueAtTime(verdi, t0 + t);
  }
  // Myk tone: overtonene faller raskere enn i en sagtann, så den blir rund, ikke summende.
  function mykBolge(ac) {
    const n = 14, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) im[k] = 1 / Math.pow(k, 1.4);
    return ac.createPeriodicWave(re, im);
  }
  // Spiller en variant på en AudioContext (eller OfflineAudioContext). Svarer når den er ferdig.
  function spill(ac, navn, volum = VOLUM) {
    const p = lagPlan(navn, volum), t0 = ac.currentTime + .02, slutt = t0 + p.varighet;
    const kilde = ac.createOscillator();
    kilde.setPeriodicWave(mykBolge(ac));
    kurve(kilde.frequency, p.tone, t0);
    // Litt vibrato (5,5 Hz, ±15 cent), så tonen lever.
    const vib = ac.createOscillator(), vibStyrke = ac.createGain();
    vib.frequency.value = 5.5; vibStyrke.gain.value = 15;
    vib.connect(vibStyrke); vibStyrke.connect(kilde.detune);

    const formant = (punkter, q, styrke) => {
      const f = ac.createBiquadFilter(), g = ac.createGain();
      f.type = "bandpass"; f.Q.value = q; kurve(f.frequency, punkter, t0); g.gain.value = styrke;
      kilde.connect(f); f.connect(g); return g;
    };
    const sum = ac.createGain(); sum.gain.value = 1;
    formant(p.f1, 4, 1).connect(sum);
    formant(p.f2, 6, .6).connect(sum);
    const glatt = ac.createBiquadFilter();
    glatt.type = "lowpass"; glatt.frequency.value = LAVPASS; glatt.Q.value = .7;
    const env = ac.createGain();
    kurve(env.gain, p.styrke, t0);
    sum.connect(glatt); glatt.connect(env);

    const kilder = [kilde, vib];
    if (p.trille) { // «rr»: styrken skjelver raskt i starten og roer seg
      const trille = ac.createGain(), lfo = ac.createOscillator(), dybde = ac.createGain();
      trille.gain.value = 1 - p.trille.dybde;
      lfo.frequency.value = p.trille.hz;
      dybde.gain.setValueAtTime(p.trille.dybde, t0);
      dybde.gain.linearRampToValueAtTime(0, t0 + p.trille.til);
      trille.gain.setValueAtTime(1 - p.trille.dybde, t0);
      trille.gain.linearRampToValueAtTime(1, t0 + p.trille.til);
      lfo.connect(dybde); dybde.connect(trille.gain);
      env.connect(trille); trille.connect(ac.destination);
      kilder.push(lfo);
    } else {
      env.connect(ac.destination);
    }
    for (const k of kilder) { k.start(t0); k.stop(slutt + .05); }
    return { plan: p, start: t0, slutt };
  }

  Object.assign(ut, { VARIANTER, REKKEFOLGE, VOLUM, TAK, LAVPASS, PAMINN_FORST, PAMINN_SIDEN,
    lydPaFra, lydFor, skalSpilles, paminnelseNr, nesteProve, lagPlan, spill });
})(typeof module === "object" && module.exports ? module.exports : (globalThis.HageLyd = {}));
