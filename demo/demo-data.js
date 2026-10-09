/* Demo-data for spesialister.html?demo=1 — oppdiktede katter, ingen ekte økter.
   Siden laster denne fila på nytt hvert 10. sekund, så tidspunktene regnes fra «nå», og noen
   katter bytter status i en fast syklus: hagen lever, også uten tmux. */
(function () {
  "use strict";
  const naa = Date.now();
  const iso = (msSiden) => new Date(naa - msSiden).toISOString();
  const MIN = 60000;
  const steg = Math.floor(naa / 20000) % 6; // byttes hvert 20. sekund

  const config = {
    leaders: [
      { name: "LEAD-A", short: "A", spot: "house" },
      { name: "LEAD-B", short: "B", spot: "birdbath" },
      { name: "LEAD-C", short: "C", spot: "sundial" },
      { name: "LEAD-D", short: "D", spot: "party" },
    ],
    watchCat: "WATCH",
    accounts: [{ label: "Work", collar: "bell" }, { label: "Personal", collar: "crown" }],
    quota: true,
  };

  const MENY = ["❯ 1. Yes", "Enter to select · Esc to cancel"];
  let nr = 0;
  const pane = (navn, leder, status, mer = {}) => {
    const id = "%" + (100 + nr++);
    const kort = navn.split(" · ")[0].replace(/\(.*?\)/g, "").trim();
    return Object.assign({
      id, okt: leder ? leder.toLowerCase() : "misc", vindu: kort.toLowerCase(), navn, kort, leder,
      status, synlig: false, venterFordi: status === "venter" ? MENY : [], aktivitet: null, ferdigKl: null,
      modell: "Opus · high", konto: "Work", kvote5h: null, nullstillesMin: null, rolle: "spesialist",
      siste: ["Demo: ingen ekte økt her.", "Alle navn og linjer er oppdiktet."],
    }, mer);
  };
  const jobber = (type, tekst) => ({ status: "jobber", aktivitet: { type, tekst } });
  const syklus = (i) => {
    // én katt blir ferdig og sovner, en annen begynner å vente — så tilbake
    const s = (steg + i) % 6;
    return s < 2 ? jobber("skriv", "Edited 2 files") : s < 4 ? { status: "ferdig", ferdigKl: iso((s - 1) * MIN) } : { status: "venter" };
  };

  const panes = [
    pane("LEAD-A · planning", "LEAD-A", "venter", { rolle: "leder", konto: "Personal", kvote5h: 62, nullstillesMin: 95 }),
    pane("LEAD-B · web app", "LEAD-B", "jobber", { rolle: "leder", aktivitet: { type: "les", tekst: "Read 3 files" }, kvote5h: 41, nullstillesMin: 130 }),
    pane("LEAD-C · api", "LEAD-C", "ferdig", { rolle: "leder", ferdigKl: iso(4 * MIN) }),
    pane("LEAD-D · side projects", "LEAD-D", "jobber", { rolle: "leder", konto: "Personal", aktivitet: { type: "kjor", tekst: "Ran 2 shell commands" } }),

    pane("SCOUT · research (LEAD-A)", "LEAD-A", "venter"),
    pane("SCRIBE · release notes (LEAD-A)", "LEAD-A", "jobber", jobber("skriv", "Wrote 1 file")),
    pane("PIXEL · icons (LEAD-A)", "LEAD-A", "ferdig", { ferdigKl: iso(48 * MIN) }), // 🧹
    pane("TESTER · e2e (LEAD-B)", "LEAD-B", "jobber", jobber("kjor", "Running 1 shell command…")),
    pane("FIXER · bug hunt (LEAD-B)", "LEAD-B", "x", syklus(0)),
    pane("BUILDER · ui (LEAD-B)", "LEAD-B", "venter"),
    pane("CRITIC · review (LEAD-C)", "LEAD-C", "jobber", jobber("les", "Searched for 4 patterns")),
    pane("PLANNER · schema (LEAD-C)", "LEAD-C", "x", syklus(3)),
    pane("NAPPER · docs (LEAD-C)", "LEAD-C", "ferdig", { ferdigKl: iso(12 * MIN) }),
    pane("MOCHI · garden art (LEAD-D)", "LEAD-D", "jobber", Object.assign(jobber("skriv", "Edited 1 file"), { konto: "Personal" })),
    pane("WHISKERS · tune-up (LEAD-D)", "LEAD-D", "venter", { konto: "Personal" }),
    pane("WATCH · night shift", null, "jobber", { rolle: "vakt" }),
    pane("SPROUT · scratch", null, "ferdig", { ferdigKl: iso(7 * MIN), konto: null, modell: null }),
    pane("zsh", null, "tom", { navn: "", kort: "shell", vindu: "shell", konto: null, modell: null, siste: [] }),
  ];

  const h = (min, kort, type, tekst) => ({ ts: iso(min * MIN), id: (panes.find((p) => p.kort === kort) || {}).id, kort, type, tekst });
  const hendelser = [
    h(22, "PIXEL", "ferdig", "ble ferdig og la seg til å sove"),
    h(14, "SCOUT", "venter", "venter på svar fra deg"),
    h(9, "TESTER", "jobber", "våknet og begynte å jobbe"),
    h(6, "BUILDER", "venter", "venter på svar fra deg"),
    h(4, "LEAD-C", "ferdig", "ble ferdig og la seg til å sove"),
    h(2, "WHISKERS", "venter", "venter på svar fra deg"),
    h(1, "LEAD-A", "venter", "venter på svar fra deg"),
  ];

  window.SPESIALIST_DATA = {
    generertKl: new Date(naa).toISOString(), feil: null,
    ledere: config.leaders.map((l) => l.name), config, configFeil: [],
    kvote: { Personal: 62, Work: 41 }, kvoteNullstilles: { Personal: 95, Work: 130 },
    hopp: null, kode: "demo", kilde: "demo", hendelser, panes,
  };
})();
