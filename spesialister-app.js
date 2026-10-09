/* Katte-hagen — kattene er Claude Code-øktene i tmux: lederne og spesialistene deres.
   Leser window.SPESIALIST_DATA (spesialister.js, skrevet av spesialister.mjs) og henter
   den på nytt hvert 10. sekund ved å bytte ut <script>-taggen. Det virker fra file://
   uten server, fordi nettleseren alltid lar en side laste skript fra sin egen mappe.
   Tegnet vektor på canvas: myke former, og jevn bevegelse med requestAnimationFrame. */
(() => {
  "use strict";

  const W = 1280, H = 800;
  const POLL_MS = Math.max(1000, Number(new URLSearchParams(location.search).get("poll")) || 10000); // ?poll=2000 for testing
  const GAMMEL_MS = 40000;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PARAM = new URLSearchParams(location.search);
  const TID_OVERSTYRT = PARAM.has("tid") ? Number(PARAM.get("tid")) : null; // ?tid=21 for å se kvelden
  const DEMO = PARAM.get("demo") === "1"; // ?demo=1: oppdiktede katter fra demo/, uten tmux

  const $ = (id) => document.getElementById(id);
  // ?lesbar=1 (bare måling): tegn på CPU fra start. Leser målingen pikslene ofte, bytter Chrome
  // ellers fra GPU til CPU midt i, og kantutjevningen endres overalt (runde 9).
  const wrap = $("wrap"), cv = $("c"), ctx = cv.getContext("2d", new URLSearchParams(location.search).has("lesbar") ? { willReadFrequently: true } : undefined);
  const B = window.HageBevegelse; // bevegelsen: spesialister-bevegelse.js (testet i node)
  const T = window.HageTegning;   // hva som tegnes per bilde: spesialister-tegning.js (testet i node)
  // Effekter rolig modus slår av. Ved måling kan de slås av én og én: ?av=svai,kronblader,…
  const AV = new Set((PARAM.get("av") || "").split(",").filter(Boolean));
  const ROLIG_AV = new Set(["svai", "kronblader", "skyer", "regn", "lys", "pynt", "kattAnim"]);
  let rolig = false;
  const effekt = (navn) => !REDUCED && !AV.has(navn) && !(rolig && ROLIG_AV.has(navn));

  // ---------- palett ----------
  const P = {
    rosa: "#FFAFD7", bla: "#87D7FF", lavendel: "#D7AFFF", mint: "#AFD7AF", fersken: "#FFD7AF",
    papir: "#FFF8F1", blekk: "#4A3B52", gress: "#C9E6BF", gress2: "#BEDFB3", hekk: "#8FBF8C",
    hekk2: "#7FB17D", stein: "#F1E4D6", stein2: "#DCC9B6", tre: "#B98F7A", gull: "#E9B44C",
  };
  const PASTELL = [P.rosa, P.bla, P.lavendel, P.mint, P.fersken];
  const BLOMSTFARGER = ["#FFAFD7", "#FF9EC8", "#D7AFFF", "#C59BF5", "#87D7FF", "#FFD7AF", "#FFF1A8", "#FFFFFF"];

  const STATUS = {
    jobber: { ikon: "🧶", ord: "jobber", lang: "Jobber — løper og leker" },
    ferdig: { ikon: "💤", ord: "sover", lang: "Ferdig — sover" },
    venter: { ikon: "❓", ord: "venter", lang: "Venter på svar — et spørsmål er åpent" },
    tom:    { ikon: "🧺", ord: "tomt", lang: "Tomt skall — ingen Claude i panen" },
  };
  // Vaktkatten mellom to vakter er «ferdig», men går likevel runden — si det som det er.
  const VAKT_PAUSE = { ikon: "🏮", ord: "går runden", lang: "Mellom vaktene — går runden med lykta" };
  // «Hva gjør den nå» (fra siste verktøylinje i panen): erstatter garnnøstet når det er kjent.
  const AKTIVITET = { les: { ikon: "📖", ord: "leser" }, skriv: { ikon: "✍️", ord: "skriver" }, kjor: { ikon: "⚡", ord: "kjører" } };
  const statusFor = (k) => {
    if (k.erVakt && k.p.status === "ferdig") return VAKT_PAUSE;
    const a = k.p.status === "jobber" && k.p.aktivitet && AKTIVITET[k.p.aktivitet.type];
    if (a) return { ikon: a.ikon, ord: "jobber · " + a.ord, lang: `Jobber — ${a.ord} (${k.p.aktivitet.tekst})` };
    return STATUS[k.p.status] || STATUS.ferdig;
  };
  // Halsbånd per konto (accounts i hage.config.json): «crown» er gull med krone, «bell» blå med bjelle.
  const HALSBAND_TYPE = { crown: { farge: "#E9B44C", charm: "krone" }, bell: { farge: "#4FA9DE", charm: "bjelle" }, ukjent: { farge: "#B9A9C4", charm: "bjelle" } };
  let KONTOER = {}; // etikett → «crown» | «bell», fra oppsettet
  const halsbandFor = (konto) => HALSBAND_TYPE[KONTOER[konto]] || HALSBAND_TYPE.ukjent;
  const harKrone = (konto) => KONTOER[konto] === "crown";
  const kontoTekst = (konto) => !konto ? "ukjent" : (harKrone(konto) ? "👑 " : KONTOER[konto] ? "🔔 " : "") + konto;

  // ---------- tilfeldighet med frø (samme navn = samme katt hver gang) ----------
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeOutBack = (k) => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

  // ---------- pels og personlighet ----------
  const PELSER = [
    { navn: "rødpels",   pels: "#F4B27F", mork: "#DB8B57", monstre: ["tabby", "tabby", "solid", "tuxedo"] },
    { navn: "krem",      pels: "#F7E4C6", mork: "#E2C59A", monstre: ["solid", "tabby"] },
    { navn: "blågrå",    pels: "#AEB8CC", mork: "#8793AB", monstre: ["solid", "tabby", "tuxedo"] },
    { navn: "svart",     pels: "#544B5E", mork: "#3D3546", monstre: ["solid", "tuxedo", "tuxedo"] },
    { navn: "hvit",      pels: "#FDF9F4", mork: "#E6DCD1", monstre: ["solid", "flekker"] },
    { navn: "brun",      pels: "#BE957A", mork: "#996F56", monstre: ["tabby", "flekker"] },
    { navn: "lilla",     pels: "#D3C4E0", mork: "#AE9CC1", monstre: ["solid", "tabby"] },
    { navn: "skilpadde", pels: "#FDF9F4", mork: "#E6DCD1", monstre: ["calico"], flekk1: "#F2A86B", flekk2: "#5A4D5F" },
    { navn: "siameser",  pels: "#F5E8D6", mork: "#7D6153", monstre: ["siamesisk"] },
    { navn: "røyk",      pels: "#7F7A8C", mork: "#5F5A6C", monstre: ["solid", "tuxedo"] },
  ];
  const OYNE = ["#8CCB79", "#E8B24A", "#7CC6F2", "#DA8A52", "#A9D98A"];

  function utseende(navn) {
    const r = rng(hash(navn));
    const p = PELSER[Math.floor(r() * PELSER.length)];
    const monster = p.monstre[Math.floor(r() * p.monstre.length)];
    const ting = r();
    return {
      pels: p.pels, mork: p.mork, pelsNavn: p.navn, monster,
      flekk1: p.flekk1 || "#F2A86B", flekk2: p.flekk2 || "#5A4D5F",
      oye: OYNE[Math.floor(r() * OYNE.length)],
      runding: 0.92 + r() * 0.2,         // litt lubben eller slank
      ore: 0.85 + r() * 0.35,            // ørestørrelse
      hale: 0.8 + r() * 0.45,            // halelengde
      pynt: ting < 0.28 ? "blomst" : ting < 0.48 ? "sloyfe" : null,
      pyntFarge: PASTELL[Math.floor(r() * PASTELL.length)],
      fase: r() * Math.PI * 2,
      leke: r() < 0.55 ? "garn" : "sommerfugl",
      garnFarge: PASTELL[Math.floor(r() * PASTELL.length)],
    };
  }

  // ---------- steder i hagen ----------
  // Fire faste plasser. Hvilken leder som bor hvor, står i hage.config.json (leaders[].spot).
  const PLASS = {
    house:    { x: 640, y: 410, pute: "#D7AFFF", kant: "#B48DDC", vinkler: [180, 0, 148, 32, 115, 65], vinkler2: [165, 15, 132, 48, 90], r1: 135, r2: 215, hjem: "i hagehuset" },
    birdbath: { x: 250, y: 215, pute: "#AFD7AF", kant: "#83B983", vinkler: [0, 45, 90, 135, 165], vinkler2: [20, 65, 110], r1: 120, r2: 185, hjem: "ved fuglebadet" },
    sundial:  { x: 1030, y: 215, pute: "#FFD7AF", kant: "#E5B183", vinkler: [180, 135, 90, 45, 15], vinkler2: [160, 115, 70], r1: 120, r2: 185, hjem: "ved soluret" },
    party:    { x: 1030, y: 600, pute: "#FFAFD7", kant: "#EC8CBC", vinkler: [180, 145, 210, 120, 160], vinkler2: [195, 170, 135], r1: 150, r2: 230, hjem: "i festhjørnet" },
  };
  // Ledernavn → plass. Fylles fra DATA.config; før første titt er hagen tom for ledere.
  let LEDER = {}, LEDERNAVN = [], LEDERKORT = {}, FESTLEDER = null, sistConfig = "";
  function brukConfig(c) {
    const sig = JSON.stringify(c || null);
    if (sig === sistConfig) return;
    sistConfig = sig;
    const ledere = (c && Array.isArray(c.leaders)) ? c.leaders.filter((l) => l && PLASS[l.spot]) : [];
    LEDER = {}; LEDERKORT = {}; FESTLEDER = null;
    for (const l of ledere) {
      if (LEDER[l.name]) continue;
      LEDER[l.name] = PLASS[l.spot]; LEDERKORT[l.name] = l.short || l.name;
      if (l.spot === "party") FESTLEDER = l.name;
    }
    LEDERNAVN = Object.keys(LEDER);
    KONTOER = {};
    for (const k of (c && c.accounts) || []) if (k && k.label) KONTOER[k.label] = k.collar === "crown" ? "crown" : "bell";
  }
  const FELLES = { x: 250, y: 610, plasser: [[262, 630], [356, 648], [312, 548], [178, 692], [410, 566], [440, 696], [190, 560]] };
  const PORT = { x: 640, y: 772 };
  const FUGLEBAD = { x: 108, y: 150 };
  const SOLUR = { x: 1176, y: 140 };
  const KAKE = { x: 1170, y: 690 };
  const HUS = { x: 640, y: 330 }; // midt på bunnkanten (døra)
  const TRAER = [[436, 118], [846, 118], [1196, 430], [80, 440]];
  const VAKTRUNDE = { x0: 74, y0: 98, x1: 1206, y1: 738 };

  function slotFor(leder, i) {
    const L = LEDER[leder];
    let vinkel, r;
    if (i < L.vinkler.length) { vinkel = L.vinkler[i]; r = L.r1; }
    else if (i < L.vinkler.length + L.vinkler2.length) { vinkel = L.vinkler2[i - L.vinkler.length]; r = L.r2; }
    else { vinkel = (i * 47) % 360; r = L.r2 + 50; }
    const a = vinkel * Math.PI / 180;
    return { x: clamp(L.x + Math.cos(a) * r, 84, 1196), y: clamp(L.y + Math.sin(a) * r, 130, 730) };
  }
  function fellesSlot(i) {
    const p = FELLES.plasser[i % FELLES.plasser.length];
    const ekstra = Math.floor(i / FELLES.plasser.length) * 26;
    return { x: p[0] + ekstra, y: p[1] - ekstra };
  }

  // ---------- størrelse (skarp på retina) ----------
  let skala = 1, dpr = 1, wrapW = W, wrapH = H, cvRekt = null;
  const bg = document.createElement("canvas");
  const bctx = bg.getContext("2d");
  function tilpass() {
    const r = wrap.getBoundingClientRect();
    cvRekt = null; // musa måler canvas på nytt neste gang
    if (!r.width) return;
    const nyDpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(r.width * nyDpr), bh = Math.round(r.height * nyDpr);
    if (bw === cv.width && bh === cv.height && nyDpr === dpr) return; // bare flyttet: ingenting å tegne om
    dpr = nyDpr;
    cv.width = bw; cv.height = bh;
    // Canvas vises i nøyaktig sin egen størrelse: 1 canvas-piksel = 1 skjermpiksel. Med
    // width: 100% ble den skalert litt (avrunding), og hele hagen ble samplet om hvert bilde.
    cv.style.width = bw / dpr + "px"; cv.style.height = bh / dpr + "px";
    wrapW = bw / dpr; wrapH = bh / dpr;
    skala = wrapW / W;
    wrap.style.setProperty("--s", skala.toFixed(3)); // lappene skaleres med hagen (aldri under 10 px, se CSS)
    lappMaal = new WeakMap();
    bg.width = cv.width; bg.height = cv.height;
    tegnBakgrunn();
    heltNy = true;
  }

  // ---------- tegnehjelpere ----------
  function ell(g, x, y, rx, ry, farge, rot) {
    g.beginPath(); g.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), rot || 0, 0, Math.PI * 2);
    if (farge) { g.fillStyle = farge; g.fill(); }
  }
  function rrect(g, x, y, w, h, r, farge) {
    g.beginPath(); g.roundRect(x, y, w, h, r); if (farge) { g.fillStyle = farge; g.fill(); }
  }
  function linje(g, pts, farge, bredde) {
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.strokeStyle = farge; g.lineWidth = bredde; g.lineCap = "round"; g.lineJoin = "round"; g.stroke();
  }

  // ---------- bakgrunn (tegnes én gang per størrelse) ----------
  function tegnBakgrunn() {
    const g = bctx;
    const k = dpr * skala;
    g.setTransform(k, 0, 0, k, 0, 0);
    const r = rng(7);
    // hekk utenfor gjerdet
    g.fillStyle = P.hekk; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) {
      const side = i % 4, t = r();
      const x = side < 2 ? t * W : (side === 2 ? r() * 30 : W - r() * 30);
      const y = side < 2 ? (side === 0 ? r() * 30 : H - r() * 26) : t * H;
      ell(g, x, y, 16 + r() * 14, 13 + r() * 10, r() < .5 ? P.hekk2 : "#9ACA96");
    }
    // plenen
    const plen = g.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 760);
    plen.addColorStop(0, "#D3EDC9"); plen.addColorStop(1, P.gress2);
    rrect(g, 34, 40, W - 68, H - 74, 26, null); g.fillStyle = plen; g.fill();
    // klippestriper
    g.save(); rrect(g, 34, 40, W - 68, H - 74, 26, null); g.clip();
    g.globalAlpha = .05; g.fillStyle = "#ffffff";
    for (let x = -H; x < W; x += 90) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 45, 0); g.lineTo(x + 45 + H, H); g.lineTo(x + H, H); g.fill(); }
    g.restore(); g.globalAlpha = 1;
    // gresstuster og kløver
    for (let i = 0; i < 260; i++) {
      const x = 50 + r() * (W - 100), y = 60 + r() * (H - 110);
      g.strokeStyle = r() < .5 ? "#A6D29C" : "#B3D9A8"; g.lineWidth = 1.6; g.lineCap = "round";
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 6); g.moveTo(x + 1, y); g.lineTo(x + 3, y - 7); g.stroke();
    }
    for (let i = 0; i < 70; i++) {
      const x = 50 + r() * (W - 100), y = 60 + r() * (H - 110);
      ell(g, x, y, 1.8, 1.8, r() < .7 ? "#FFFFFF" : "#FFD3E8");
    }
    // stier: fra porten opp til huset, og fra huset ut til hvert hjørne
    const stier = [
      [PORT.x, PORT.y - 6, 640, 600, PLASS.house.x, 452],
      [560, 420, 420, 300, PLASS.birdbath.x + 40, PLASS.birdbath.y + 40],
      [720, 420, 860, 300, PLASS.sundial.x - 40, PLASS.sundial.y + 40],
      [720, 450, 860, 560, PLASS.party.x - 50, PLASS.party.y],
      [560, 450, 420, 600, FELLES.x + 60, FELLES.y + 10],
    ];
    for (const s of stier) {
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        const x = u * u * s[0] + 2 * u * t * s[2] + t * t * s[4];
        const y = u * u * s[1] + 2 * u * t * s[3] + t * t * s[5];
        const jx = (r() - .5) * 6, jy = (r() - .5) * 4;
        ell(g, x + jx, y + jy + 2, 15, 8, "rgba(120,140,110,.18)");
        ell(g, x + jx, y + jy, 15, 8.5, P.stein);
        ell(g, x + jx - 3, y + jy - 2, 7, 3, "#FBF3EA");
      }
    }
    // konfetti på bakken i festhjørnet
    const gy = PLASS.party;
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2, d = 30 + r() * 150;
      const x = gy.x + Math.cos(a) * d * 1.1, y = gy.y + Math.sin(a) * d * .6 + 20;
      if (x > 1215 || y > 745) continue;
      g.save(); g.translate(x, y); g.rotate(r() * 3);
      g.fillStyle = PASTELL[Math.floor(r() * 5)]; g.fillRect(-2.5, -1.2, 5, 2.4); g.restore();
    }
    tegnGjerde(g);
    tegnPortbue(g);
    tegnHus(g);
    tegnFuglebad(g);
    tegnSolurFot(g);
    tegnBenk(g);
    tegnKake(g);
    for (const plass of Object.values(PLASS)) tegnPute(g, plass);
  }

  function tegnGjerde(g) {
    const hvit = "#FFFDF9", kant = "#E4D6C9";
    const stakitt = (x, y, h) => {
      g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x - 4, y - h + 5); g.lineTo(x, y - h); g.lineTo(x + 4, y - h + 5); g.lineTo(x + 4, y); g.closePath();
      g.fillStyle = hvit; g.fill(); g.strokeStyle = kant; g.lineWidth = 1; g.stroke();
    };
    // topp
    rrect(g, 40, 30, W - 80, 4, 2, kant);
    for (let x = 46; x < W - 40; x += 15) stakitt(x, 44, 26);
    rrect(g, 40, 24, W - 80, 4, 2, hvit);
    // sider (sett ovenfra: smale stolper)
    for (let y = 56; y < H - 40; y += 15) {
      rrect(g, 36, y, 6, 11, 2, hvit); rrect(g, W - 42, y, 6, 11, 2, hvit);
    }
    rrect(g, 38, 50, 2, H - 92, 1, kant); rrect(g, W - 40, 50, 2, H - 92, 1, kant);
    // bunn, med åpning til porten
    for (let x = 46; x < W - 40; x += 15) {
      if (x > PORT.x - 40 && x < PORT.x + 40) continue;
      stakitt(x, H - 18, 26);
    }
    rrect(g, 40, H - 34, PORT.x - 80, 4, 2, kant);
    rrect(g, PORT.x + 40, H - 34, W - PORT.x - 80, 4, 2, kant);
  }

  function tegnPortbue(g) {
    // rosebue over porten
    const x = PORT.x, y = H - 18;
    rrect(g, x - 46, y - 60, 7, 60, 3, "#FFFDF9");
    rrect(g, x + 39, y - 60, 7, 60, 3, "#FFFDF9");
    g.beginPath(); g.arc(x, y - 58, 42, Math.PI, 0); g.strokeStyle = "#FFFDF9"; g.lineWidth = 7; g.stroke();
    g.beginPath(); g.arc(x, y - 58, 42, Math.PI, 0); g.strokeStyle = "#E4D6C9"; g.lineWidth = 1; g.stroke();
    const r = rng(11);
    for (let i = 0; i < 16; i++) {
      const a = Math.PI + (i / 15) * Math.PI;
      const rx = x + Math.cos(a) * 42 + (r() - .5) * 6, ry = y - 58 + Math.sin(a) * 42 + (r() - .5) * 6;
      ell(g, rx, ry, 5, 4, "#9CCB92");
      if (i % 2 === 0) { ell(g, rx + 2, ry - 1, 3.6, 3.6, P.rosa); ell(g, rx + 2, ry - 1, 1.4, 1.4, "#F27DB5"); }
    }
  }

  function tegnHus(g) {
    const x = HUS.x, y = HUS.y;
    // skygge
    ell(g, x, y + 4, 104, 16, "rgba(90,110,80,.16)");
    // vegger
    rrect(g, x - 84, y - 92, 168, 92, 6, "#FFF4E8");
    g.strokeStyle = "#EADBCB"; g.lineWidth = 1;
    for (let yy = y - 82; yy < y; yy += 12) { g.beginPath(); g.moveTo(x - 82, yy); g.lineTo(x + 82, yy); g.stroke(); }
    // pipe
    rrect(g, x + 42, y - 168, 22, 50, 4, "#F6C9A9");
    rrect(g, x + 38, y - 172, 30, 8, 3, "#EBB590");
    // tak med skjell
    g.beginPath(); g.moveTo(x - 104, y - 84); g.quadraticCurveTo(x, y - 200, x + 104, y - 84); g.closePath();
    g.fillStyle = P.lavendel; g.fill();
    g.save(); g.clip();
    for (let rad = 0; rad < 8; rad++) {
      const yy = y - 92 - rad * 14;
      for (let xx = x - 110 + (rad % 2) * 10; xx < x + 110; xx += 20) {
        g.beginPath(); g.arc(xx, yy, 10, 0, Math.PI); g.strokeStyle = "#BF9BE6"; g.lineWidth = 1.6; g.stroke();
      }
    }
    g.restore();
    g.beginPath(); g.moveTo(x - 106, y - 82); g.quadraticCurveTo(x, y - 202, x + 106, y - 82);
    g.strokeStyle = "#B48DDC"; g.lineWidth = 4; g.lineCap = "round"; g.stroke();
    // dør
    g.beginPath(); g.moveTo(x - 19, y); g.lineTo(x - 19, y - 40); g.arc(x, y - 40, 19, Math.PI, 0); g.lineTo(x + 19, y); g.closePath();
    g.fillStyle = P.rosa; g.fill(); g.strokeStyle = "#EC8CBC"; g.lineWidth = 2; g.stroke();
    ell(g, x + 11, y - 24, 2.4, 2.4, P.gull);
    // dørmatte
    rrect(g, x - 24, y + 2, 48, 8, 4, P.fersken);
    // vinduer (glasset tegnes på nytt i lyset om kvelden)
    for (const wx of [x - 50, x + 50]) {
      rrect(g, wx - 17, y - 72, 34, 30, 8, "#FFFFFF");
      rrect(g, wx - 14, y - 69, 28, 24, 6, "#CDEBFA");
      g.fillStyle = "#FFFFFF"; g.fillRect(wx - 1, y - 69, 2, 24); g.fillRect(wx - 14, y - 58, 28, 2);
      // blomsterkasse
      rrect(g, wx - 20, y - 42, 40, 9, 3, "#C9A08A");
      for (let i = 0; i < 5; i++) ell(g, wx - 15 + i * 7.5, y - 45, 3.6, 3.6, i % 2 ? P.rosa : P.fersken);
    }
  }

  function tegnFuglebad(g) {
    const { x, y } = FUGLEBAD;
    ell(g, x, y + 30, 26, 7, "rgba(90,110,80,.18)");
    rrect(g, x - 7, y, 14, 30, 4, "#EDE3EF");
    rrect(g, x - 15, y + 24, 30, 8, 4, "#E2D5E6");
    ell(g, x, y, 34, 12, "#EDE3EF");
    ell(g, x, y - 1, 28, 9, "#A9DDF5");
  }
  function tegnSolurFot(g) {
    const { x, y } = SOLUR;
    ell(g, x, y + 36, 24, 6, "rgba(90,110,80,.18)");
    rrect(g, x - 9, y, 18, 36, 4, "#F3E6D9");
    rrect(g, x - 16, y + 30, 32, 8, 4, "#E8D8C8");
    ell(g, x, y, 30, 12, "#FBF3EA");
    g.strokeStyle = "#DCC9B6"; g.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      g.beginPath(); g.moveTo(x + Math.cos(a) * 22, y + Math.sin(a) * 8.5); g.lineTo(x + Math.cos(a) * 27, y + Math.sin(a) * 10.5); g.stroke();
    }
  }
  function tegnBenk(g) {
    const x = 150, y = 596;
    ell(g, x, y + 10, 50, 8, "rgba(90,110,80,.18)");
    rrect(g, x - 44, y - 28, 88, 10, 4, "#F6C9A9");
    rrect(g, x - 46, y - 12, 92, 12, 4, "#FBD9BE");
    rrect(g, x - 40, y, 6, 12, 2, "#D9A88A"); rrect(g, x + 34, y, 6, 12, 2, "#D9A88A");
  }
  function tegnKake(g) {
    const { x, y } = KAKE;
    ell(g, x, y + 4, 30, 7, "rgba(90,110,80,.18)");
    rrect(g, x - 22, y - 10, 44, 14, 6, "#C9A08A"); // stubbe
    rrect(g, x - 16, y - 34, 32, 22, 6, "#FFF4E8");
    rrect(g, x - 16, y - 34, 32, 7, 4, P.rosa);
    for (let i = 0; i < 4; i++) ell(g, x - 11 + i * 7.3, y - 27, 2.4, 3, P.rosa);
    ell(g, x - 7, y - 20, 1.6, 1.6, "#F27DB5"); ell(g, x + 6, y - 18, 1.6, 1.6, P.bla); ell(g, x, y - 22, 1.6, 1.6, P.lavendel);
    rrect(g, x - 1.5, y - 46, 3, 12, 1.5, P.bla);
  }
  function tegnPute(g, L) {
    const x = L.x, y = L.y;
    ell(g, x, y + 8, 50, 10, "rgba(90,110,80,.18)");
    rrect(g, x - 46, y - 16, 92, 26, 13, L.kant);
    rrect(g, x - 44, y - 19, 88, 24, 12, L.pute);
    ell(g, x - 18, y - 12, 18, 3, "rgba(255,255,255,.45)");
    for (const [dx, dy] of [[-22, -7], [0, -7], [22, -7]]) ell(g, x + dx, y + dy, 2, 1.6, L.kant);
    for (const sx of [-46, 46]) { ell(g, x + sx, y - 14, 3.4, 3.4, P.gull); ell(g, x + sx, y + 6, 3.4, 3.4, P.gull); }
  }

  // ---------- dag og kveld etter klokka ----------
  const LYS = [ // time, [r,g,b,alfa], mørke 0..1
    [0, [26, 28, 72, .52], 1], [5, [26, 28, 72, .52], 1], [6.5, [255, 176, 168, .16], .35],
    [8, [255, 255, 255, 0], 0], [16.5, [255, 255, 255, 0], 0], [18, [255, 168, 140, .16], .2],
    [19.5, [150, 108, 172, .28], .6], [21, [38, 38, 92, .46], 1], [24, [26, 28, 72, .52], 1],
  ];
  function lysNaa() {
    const d = new Date();
    const tim = TID_OVERSTYRT !== null ? TID_OVERSTYRT : d.getHours() + d.getMinutes() / 60;
    for (let i = 0; i < LYS.length - 1; i++) {
      const [t0, c0, m0] = LYS[i], [t1, c1, m1] = LYS[i + 1];
      if (tim >= t0 && tim <= t1) {
        const k = (tim - t0) / (t1 - t0 || 1);
        return { farge: c0.map((v, j) => lerp(v, c1[j], k)), morke: lerp(m0, m1, k), tim };
      }
    }
    return { farge: [0, 0, 0, 0], morke: 0, tim };
  }
  function tidsord(tim) {
    if (tim < 5 || tim >= 22) return "natt";
    if (tim < 9) return "morgen";
    if (tim < 17) return "dag";
    return "kveld";
  }

  // ---------- katter ----------
  function tegnHode(g, a, o) {
    // a = utseende; o = { lukket, tilt, hatt, halsband, charm, ore }
    g.save();
    g.rotate(o.tilt || 0);
    const pels = a.pels;
    const prikk = a.monster === "siamesisk" ? a.mork : pels;
    // ører
    const os = a.ore * (o.ore || 1);
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(s * 12.5, -2); g.lineTo(s * 10.5, -2 - 17 * os); g.lineTo(s * 2, -10); g.closePath();
      g.fillStyle = prikk; g.fill();
      g.beginPath(); g.moveTo(s * 10.5, -4); g.lineTo(s * 9.6, -2 - 12.5 * os); g.lineTo(s * 4.5, -9); g.closePath();
      g.fillStyle = "#F7B9CF"; g.fill();
    }
    // hode
    ell(g, 0, 0, 14 * a.runding, 12.5, pels);
    g.save(); ell(g, 0, 0, 14 * a.runding, 12.5, null); g.clip();
    if (a.monster === "tabby") {
      linje(g, [-4, -12, -3, -6], a.mork, 2); linje(g, [0, -12.5, 0, -7], a.mork, 2); linje(g, [4, -12, 3, -6], a.mork, 2);
      linje(g, [-14, 1, -9, 2], a.mork, 1.6); linje(g, [14, 1, 9, 2], a.mork, 1.6);
    } else if (a.monster === "tuxedo") {
      ell(g, 0, 7, 8.5, 6.5, "#FFFDF9");
    } else if (a.monster === "calico") {
      ell(g, -8, -5, 8, 7, a.flekk1); ell(g, 9, -6, 6, 6, a.flekk2);
    } else if (a.monster === "siamesisk") {
      const gr = g.createRadialGradient(0, 4, 1, 0, 4, 11);
      gr.addColorStop(0, a.mork); gr.addColorStop(1, "rgba(125,97,83,0)");
      g.fillStyle = gr; g.fillRect(-15, -13, 30, 26);
    } else if (a.monster === "flekker") {
      ell(g, -7, -6, 3, 2.6, a.mork); ell(g, 8, -3, 2.4, 2, a.mork);
    }
    g.restore();
    // øyne
    const lys = a.pelsNavn === "svart" || a.pelsNavn === "røyk" || a.monster === "siamesisk";
    if (o.lukket) {
      for (const s of [-1, 1]) {
        g.beginPath(); g.arc(s * 5.5, 0.5, 2.8, 0.15 * Math.PI, 0.85 * Math.PI);
        g.strokeStyle = lys ? "#FFF3F8" : "#4A3B52"; g.lineWidth = 1.6; g.lineCap = "round"; g.stroke();
      }
    } else {
      for (const s of [-1, 1]) {
        ell(g, s * 5.5, 0.5, 3.2, 3.6, a.oye);
        ell(g, s * 5.5, 0.9, 1.6, 2.8, "#2E2433");
        ell(g, s * 5.5 + 1, -0.8, 1.05, 1.05, "#FFFFFF");
      }
    }
    // kinn, nese, munn, værhår
    ell(g, -9, 5, 2.8, 1.7, "rgba(255,140,180,.45)"); ell(g, 9, 5, 2.8, 1.7, "rgba(255,140,180,.45)");
    g.beginPath(); g.moveTo(-1.8, 4); g.lineTo(1.8, 4); g.lineTo(0, 6); g.closePath(); g.fillStyle = "#F48FB6"; g.fill();
    g.beginPath(); g.arc(-1.4, 6.2, 1.4, 0, Math.PI); g.arc(1.4, 6.2, 1.4, 0, Math.PI);
    g.strokeStyle = lys ? "#FFF3F8" : "#6E5C78"; g.lineWidth = .9; g.stroke();
    g.strokeStyle = lys ? "rgba(255,255,255,.6)" : "rgba(74,59,82,.35)"; g.lineWidth = .7;
    g.beginPath(); g.moveTo(-6, 5); g.lineTo(-17, 3); g.moveTo(-6, 6.5); g.lineTo(-17, 7.5); g.moveTo(6, 5); g.lineTo(17, 3); g.moveTo(6, 6.5); g.lineTo(17, 7.5); g.stroke();
    // pynt
    if (a.pynt === "blomst") {
      for (let i = 0; i < 5; i++) { const v = i / 5 * Math.PI * 2; ell(g, 10 + Math.cos(v) * 2.6, -10 + Math.sin(v) * 2.6, 2.2, 2.2, a.pyntFarge); }
      ell(g, 10, -10, 1.5, 1.5, "#FFF1A8");
    } else if (a.pynt === "sloyfe") {
      g.fillStyle = a.pyntFarge;
      g.beginPath(); g.moveTo(-9, -10); g.lineTo(-15, -14); g.lineTo(-15, -6); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-9, -10); g.lineTo(-3, -14); g.lineTo(-3, -6); g.closePath(); g.fill();
      ell(g, -9, -10, 2, 2, a.pyntFarge);
    }
    if (o.hatt === "fest") {
      g.save(); g.translate(3, -12); g.rotate(.2);
      g.beginPath(); g.moveTo(-7, 0); g.lineTo(0, -20); g.lineTo(7, 0); g.closePath(); g.fillStyle = P.rosa; g.fill();
      g.save(); g.clip(); for (let i = -2; i < 4; i++) linje(g, [-10, -i * 6, 10, -i * 6 - 6], P.bla, 2.2); g.restore();
      ell(g, 0, -21, 3, 3, P.gull); ell(g, 0, 0, 7.5, 1.8, "#EC8CBC");
      g.restore();
    } else if (o.hatt === "vakt") {
      ell(g, 0, -9, 12, 3.5, "#6E7FB8");
      rrect(g, -8, -18, 16, 10, 5, "#8193CC");
      ell(g, 0, -14, 2.2, 2.2, P.gull);
    }
    g.restore();
  }

  function halsband(g, x, y, bredde, o) {
    if (!o.halsband) return;
    rrect(g, x - bredde / 2, y - 2, bredde, 4, 2, o.halsband.farge);
    if (o.halsband.charm === "krone") {
      g.beginPath(); g.moveTo(x - 3.5, y + 2); g.lineTo(x - 3.5, y + 7); g.lineTo(x + 3.5, y + 7); g.lineTo(x + 3.5, y + 2);
      g.lineTo(x + 1.8, y + 4.5); g.lineTo(x, y + 2); g.lineTo(x - 1.8, y + 4.5); g.closePath();
      g.fillStyle = "#F6CB5C"; g.fill(); g.strokeStyle = "#C9912F"; g.lineWidth = .7; g.stroke();
    } else {
      ell(g, x, y + 4.5, 2.6, 2.6, "#F6CB5C"); ell(g, x, y + 5.3, .8, .8, "#9C6E25");
    }
  }

  function kroppMonster(g, a, cx, cy, rx, ry, rot) {
    ell(g, cx, cy, rx, ry, a.pels, rot);
    g.save(); ell(g, cx, cy, rx, ry, null, rot); g.clip();
    if (a.monster === "tabby") {
      for (let i = -1; i <= 1; i++) {
        const x = cx + i * rx * .45;
        g.beginPath(); g.moveTo(x - 2, cy - ry); g.quadraticCurveTo(x + 4, cy, x - 1, cy + ry * .4);
        g.strokeStyle = a.mork; g.lineWidth = rx * .16; g.globalAlpha = .7; g.stroke(); g.globalAlpha = 1;
      }
    } else if (a.monster === "tuxedo") {
      ell(g, cx + rx * .35, cy + ry * .35, rx * .5, ry * .7, "#FFFDF9");
    } else if (a.monster === "calico") {
      ell(g, cx - rx * .45, cy - ry * .35, rx * .6, ry * .55, a.flekk1);
      ell(g, cx + rx * .45, cy + ry * .15, rx * .38, ry * .45, a.flekk2);
    } else if (a.monster === "siamesisk") {
      const gr = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
      gr.addColorStop(0, "rgba(125,97,83,.45)"); gr.addColorStop(.5, "rgba(125,97,83,0)"); gr.addColorStop(1, "rgba(125,97,83,.25)");
      g.fillStyle = gr; g.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    } else if (a.monster === "flekker") {
      ell(g, cx - rx * .4, cy - ry * .2, rx * .18, ry * .16, a.mork); ell(g, cx + rx * .3, cy - ry * .4, rx * .14, ry * .12, a.mork);
      ell(g, cx + rx * .1, cy + ry * .3, rx * .16, ry * .14, a.mork);
    }
    g.restore();
  }
  const potefarge = (a) => (a.monster === "tuxedo" ? "#FFFDF9" : a.monster === "siamesisk" ? a.mork : a.pels);
  const halefarge = (a) => (a.monster === "siamesisk" ? a.mork : a.monster === "calico" ? a.flekk1 : a.pels);

  // Én kropp for sitt, stå, gå og løp. Origo = mellom føttene, vendt mot høyre.
  // m.reis 0 = sitter, 1 = står · m.gang 0 = skritt, 1 = løp · m.fase = beinas takt (følger
  // strekningen) · m.sving 0 = står stille, 1 = full beinsving. Alle delene glir mellom
  // stillingene, så katten reiser seg og setter seg. Før byttet den tegning på ett bilde,
  // ~120 ganger i minuttet (målt 06.10, runde 8).
  let sistPose = "";
  function poseKatt(g, a, t, o, m) {
    const b = m.reis, S = lerp(B.SKRITT, B.LOP, m.gang) * m.sving, ph = m.fase;
    const hopp = REDUCED ? 0 : Math.abs(Math.sin(ph)) * lerp(1.2, 3, m.gang) * m.sving * b;
    sistPose = b < .5 ? "sitt" : m.gang > .5 ? "lop" : "gaa";
    ell(g, 0, 0, lerp(19, 21, b), 4.5, "rgba(70,90,70,.2)");
    // bein: foldet inn under kroppen når den sitter, strekker seg ut når den reiser seg
    if (b > .02) {
      for (const [bx, off] of [[11, 0], [16, Math.PI], [-11, Math.PI * .5], [-16, Math.PI * 1.5]]) {
        const fx = lerp(bx * .35, bx + Math.sin(ph + off) * S, b);
        linje(g, [lerp(bx * .35, bx, b), lerp(-7, -14 - hopp, b), fx, -2], a.mork, 4.6);
        ell(g, fx, -2, 3, 2.2, potefarge(a));
      }
    }
    // halen: ved siden av når den sitter, bak når den står
    const sv = REDUCED ? 0 : Math.sin(t * (o.ivrig ? 3.2 : 1.4) + a.fase);
    const hv = REDUCED ? 0 : Math.sin(ph * .5) * 4 * m.sving;
    g.beginPath(); g.moveTo(lerp(10, -18, b), lerp(-5, -20 - hopp, b));
    g.quadraticCurveTo(lerp(28 * a.hale, -32 * a.hale, b), lerp(-2, -24 - hopp, b),
      lerp(24 * a.hale + sv * 5, -29 * a.hale + hv, b), lerp(-22 * a.hale, -40 * a.hale - hopp, b));
    g.strokeStyle = halefarge(a); g.lineWidth = 6; g.lineCap = "round"; g.stroke();
    kroppMonster(g, a, 0, lerp(-17, -19 - hopp, b), lerp(15, 21, b) * a.runding, lerp(17, 11, b));
    if (b < .98) { const p = 1 - b; ell(g, -5, -2, 4.8 * p, 3.3 * p, potefarge(a)); ell(g, 5, -2, 4.8 * p, 3.3 * p, potefarge(a)); }
    if (o.halsband) { g.save(); g.translate(lerp(0, 14, b), lerp(-31, -24 - hopp, b)); g.rotate(lerp(0, -1.2, b)); halsband(g, 0, 0, lerp(18, 16, b), o); g.restore(); }
    const hs = lerp(1, .92, b);
    g.save(); g.translate(lerp(0, 21, b), lerp(-42, -32 - hopp, b)); g.scale(hs, hs);
    tegnHode(g, a, Object.assign({}, o, { tilt: lerp(o.tilt || 0, Math.sin(ph) * .05 * m.sving, b) }));
    g.restore();
  }
  // Sovende, krøllet sammen.
  function poseSov(g, a, t, o) {
    sistPose = "sov";
    ell(g, 0, 0, 26, 5, "rgba(70,90,70,.2)");
    const pust = REDUCED ? 0 : Math.sin(t * 1.3 + a.fase) * .8;
    kroppMonster(g, a, 0, -11, 23 * a.runding, 12.5 + pust);
    g.beginPath(); g.moveTo(-20, -6); g.quadraticCurveTo(-10, 5, 14, 0);
    g.strokeStyle = halefarge(a); g.lineWidth = 6.5; g.lineCap = "round"; g.stroke();
    g.save(); g.translate(14, -12); g.scale(.9, .9); tegnHode(g, a, Object.assign({}, o, { lukket: true, tilt: .25 })); g.restore();
  }
  // Strekk: rumpa i været, forbeina langt fram — rett før den legger seg.
  function poseStrekk(g, a, t, o) {
    sistPose = "strekk";
    ell(g, 0, 0, 24, 4.5, "rgba(70,90,70,.2)");
    linje(g, [-12, -18, -14, -2], a.mork, 4.6); linje(g, [-6, -16, -7, -2], a.mork, 4.6);
    linje(g, [10, -8, 26, -2], a.mork, 4.6); linje(g, [8, -6, 22, -1], a.mork, 4.6);
    ell(g, 26, -2, 3.2, 2.2, potefarge(a)); ell(g, 22, -1, 3.2, 2.2, potefarge(a));
    g.beginPath(); g.moveTo(-16, -24);
    g.quadraticCurveTo(-24, -40 * a.hale, -16 + (REDUCED ? 0 : Math.sin(t * 3) * 2), -50 * a.hale);
    g.strokeStyle = halefarge(a); g.lineWidth = 6; g.lineCap = "round"; g.stroke();
    kroppMonster(g, a, -2, -16, 20 * a.runding, 10, .38);
    g.save(); g.translate(20, -11); g.rotate(.25); g.scale(.9, .9);
    tegnHode(g, a, Object.assign({}, o, { lukket: true }));
    g.restore();
  }

  function tegnKurv(g, x, y) {
    ell(g, x, y + 2, 26, 5, "rgba(70,90,70,.2)");
    rrect(g, x - 24, y - 20, 48, 20, 9, "#D8AE8C");
    g.strokeStyle = "#C2946F"; g.lineWidth = 1.4;
    for (let i = -18; i <= 18; i += 6) { g.beginPath(); g.moveTo(x + i, y - 18); g.lineTo(x + i, y - 2); g.stroke(); }
    for (let j = -14; j <= -4; j += 5) { g.beginPath(); g.moveTo(x - 22, y + j); g.lineTo(x + 22, y + j); g.stroke(); }
    ell(g, x, y - 20, 25, 6, "#E8C3A3");
    ell(g, x, y - 20, 20, 3.6, "#C9A28A");
    ell(g, x - 3, y - 21, 13, 2.4, "#F3D7E6");
  }

  // ---------- leker ----------
  function tegnGarn(g, x, y, farge, rot) {
    ell(g, x, y + 5, 7, 2, "rgba(70,90,70,.18)");
    ell(g, x, y, 6.5, 6.5, farge);
    g.save(); g.translate(x, y); g.rotate(rot);
    g.strokeStyle = "rgba(255,255,255,.65)"; g.lineWidth = 1;
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.ellipse(0, i * 2.2, 5.6, 2, .5, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  }
  function tegnSommerfugl(g, x, y, t, farge, fase) {
    const flap = REDUCED ? .7 : .25 + Math.abs(Math.sin(t * 13 + fase)) * .75;
    for (const s of [-1, 1]) {
      g.save(); g.translate(x, y); g.scale(s * flap, 1);
      ell(g, 4, -2.5, 4.6, 3.6, farge, -.4); ell(g, 3.4, 2.6, 3.2, 2.4, farge, .4);
      g.restore();
    }
    linje(g, [x, y - 3, x, y + 3.5], "#6E5C78", 1.4);
  }

  // ---------- hagens liv: blomster, sommerfugler, ildfluer, kronblader ----------
  const startTid = performance.now() / 1000;
  const blomster = [];
  {
    const r = rng(23);
    const leggTil = (x, y, forsinkelse) => blomster.push({
      x, y, type: Math.floor(r() * 3), farge: BLOMSTFARGER[Math.floor(r() * BLOMSTFARGER.length)],
      h: 10 + r() * 9, fase: r() * 6, forsinkelse, g: REDUCED ? 1 : 0,
    });
    for (let x = 70; x < W - 70; x += 22 + r() * 10) {
      if (Math.abs(x - PORT.x) < 70) continue;
      leggTil(x, H - 44 + r() * 6, .3 + Math.abs(x - PORT.x) / 900);
    }
    for (let i = 0; i < 9; i++) { leggTil(HUS.x - 92 + i * 4 - r() * 6, HUS.y + 6 + r() * 6, .1 + i * .05); leggTil(HUS.x + 60 + i * 4 + r() * 6, HUS.y + 6 + r() * 6, .1 + i * .05); }
    for (let i = 0; i < 7; i++) leggTil(FUGLEBAD.x - 40 + r() * 80, FUGLEBAD.y + 40 + r() * 20, .5 + r() * .5);
    for (let i = 0; i < 7; i++) leggTil(SOLUR.x - 40 + r() * 70, SOLUR.y + 48 + r() * 20, .5 + r() * .5);
  }
  // Blomster som gror når en katt blir ferdig (huskes resten av dagen i nettleseren)
  const BL_KEY = "spesialist-hagen-blomster";
  const iDag = new Date().toISOString().slice(0, 10);
  let fortjent = [];
  try {
    const lagret = JSON.parse(localStorage.getItem(BL_KEY) || "null");
    if (lagret && lagret.dato === iDag) fortjent = lagret.liste;
  } catch (e) { /* privat vindu eller blokkert lagring: hagen virker likevel */ }
  for (const f of fortjent) blomster.push(Object.assign({ g: REDUCED ? 1 : 0, forsinkelse: .8, fase: f.x % 6, h: 14 }, f));
  function plantFortjent(katt) {
    const r = rng(hash(katt.kort + Date.now()));
    const a = r() * Math.PI * 2;
    const f = { x: katt.slot.x + Math.cos(a) * 28, y: katt.slot.y + 10 + Math.abs(Math.sin(a)) * 12, type: Math.floor(r() * 3), farge: BLOMSTFARGER[Math.floor(r() * 6)], navn: katt.kort };
    fortjent.push(f);
    if (fortjent.length > 40) fortjent.shift();
    try { localStorage.setItem(BL_KEY, JSON.stringify({ dato: iDag, liste: fortjent })); } catch (e) { /* ikke kritisk */ }
    blomster.push(Object.assign({ g: 0, forsinkelse: -1, fase: r() * 6, h: 15, fodt: performance.now() / 1000 }, f));
  }

  function tegnBlomst(g, b, t) {
    const sway = effekt("svai") ? Math.sin(t * 1.4 + b.fase) * 1.6 : 0;
    const k = b.g < 1 ? easeOutBack(b.g) : 1;
    if (k <= 0) return;
    const h = b.h * k;
    const tx = b.x + sway * k, ty = b.y - h;
    g.beginPath(); g.moveTo(b.x, b.y); g.quadraticCurveTo(b.x, b.y - h * .5, tx, ty);
    g.strokeStyle = "#86BE7E"; g.lineWidth = 1.8; g.stroke();
    ell(g, b.x + 3, b.y - h * .35, 3.4 * k, 1.6 * k, "#9CCB92", -.5);
    const r = 4.2 * k;
    if (b.type === 0) { // tusenfryd
      for (let i = 0; i < 6; i++) { const v = i / 6 * Math.PI * 2; ell(g, tx + Math.cos(v) * r, ty + Math.sin(v) * r, r * .7, r * .7, b.farge); }
      ell(g, tx, ty, r * .6, r * .6, "#FFE08A");
    } else if (b.type === 1) { // tulipan
      g.beginPath(); g.moveTo(tx - r, ty - r * .2); g.lineTo(tx - r, ty - r * 1.5); g.lineTo(tx - r * .35, ty - r * .9);
      g.lineTo(tx, ty - r * 1.7); g.lineTo(tx + r * .35, ty - r * .9); g.lineTo(tx + r, ty - r * 1.5); g.lineTo(tx + r, ty - r * .2);
      g.quadraticCurveTo(tx, ty + r * .9, tx - r, ty - r * .2); g.fillStyle = b.farge; g.fill();
    } else { // dusk
      ell(g, tx - r * .5, ty, r * .75, r * .75, b.farge); ell(g, tx + r * .5, ty, r * .75, r * .75, b.farge); ell(g, tx, ty - r * .6, r * .75, r * .75, b.farge);
      ell(g, tx, ty - r * .15, r * .35, r * .35, "rgba(255,255,255,.7)");
    }
  }

  const sommerfugler = [];
  for (let i = 0; i < (REDUCED ? 2 : 6); i++) {
    sommerfugler.push({ x: 200 + i * 160, y: 200 + (i % 3) * 140, a: i, farge: PASTELL[i % 5], fase: i * 1.7, sitter: 0, mal: null });
  }
  const ildfluer = [];
  for (let i = 0; i < 26; i++) ildfluer.push({ x: 60 + Math.random() * (W - 120), y: 70 + Math.random() * (H - 140), fase: Math.random() * 20 });
  const kronblader = [];
  let delNr = 0; // faste id-er for kronblader og konfetti, så rolig modus kan følge dem fra bilde til bilde

  // ---------- data inn ----------
  let DATA = null, lastFeil = false, forsteLast = true;
  const katter = new Map(); // pane-id → katt
  const paVeiUt = [];       // katter som går ut gjennom porten

  function hentData() {
    const s = document.createElement("script");
    s.src = (DEMO ? "demo/demo-data.js" : "spesialister.js") + "?t=" + Date.now();
    // En mislykket lasting skal ALDRI tømme hagen: da gikk alle kattene ut porten og inn
    // igjen ved neste titt. Vi beholder de siste gode dataene og sier hvor gamle de er.
    s.onload = () => { s.remove(); const d = window.SPESIALIST_DATA; lastFeil = !d; if (d) DATA = d; brukData(); };
    s.onerror = () => { s.remove(); lastFeil = true; if (DATA) { oppdaterHud(); tegnKompakt(); } else brukData(); };
    document.head.appendChild(s);
  }

  // Hysterese på status: en ny status må stå i 2 titter på rad før katten bytter
  // animasjon. Unntak: «venter» slår inn med en gang (du skal se det), men forlates
  // tidligst etter 10 s. Uten dette byttet katter sover → jobber → sover på 10–20 s.
  function stabil(k, rå) {
    const naa = Date.now();
    const s = k && k.stab;
    if (!s) { if (k) k.stab = { status: rå.status, siden: naa, kandidat: null, antall: 0 }; return rå; }
    if (rå.status === s.status) s.kandidat = null;
    else if (rå.status === "venter") Object.assign(s, { status: "venter", siden: naa, kandidat: null });
    else {
      if (s.kandidat === rå.status) s.antall++; else { s.kandidat = rå.status; s.antall = 1; }
      const minstTid = s.status === "venter" ? 10000 : 0;
      if (s.antall >= 2 && naa - s.siden >= minstTid) Object.assign(s, { status: rå.status, siden: naa, kandidat: null });
    }
    return s.status === rå.status ? rå : Object.assign({}, rå, { status: s.status, råStatus: rå.status });
  }

  // Åpne faner laster bare nye data, aldri ny kode. Endres front-end-filene på disk
  // (datakilden melder en ny «kode»-hash), laster fanen seg selv på nytt.
  let minKode = null;
  function sjekkVersjon() {
    if (!DATA || !DATA.kode) return;
    if (minKode === null) minKode = DATA.kode;
    else if (DATA.kode !== minKode) { location.reload(); return; }
    const tekst = `kode ${minKode} · kilde ${DATA.kilde || "?"}`;
    for (const id of ["versjon", "kVersjon"]) { const el = $(id); if (el) el.textContent = tekst; }
  }

  const plassBok = new Map(); // gruppe → Map(pane-id → plassnummer)
  function plassNr(gruppe, liste) {
    let bok = plassBok.get(gruppe);
    if (!bok) plassBok.set(gruppe, (bok = new Map()));
    const ider = new Set(liste.map((p) => p.id));
    for (const id of [...bok.keys()]) if (!ider.has(id)) bok.delete(id);
    const brukt = new Set(bok.values());
    for (const p of [...liste].sort((a, b) => a.kort.localeCompare(b.kort, "nb"))) {
      if (bok.has(p.id)) continue;
      let nr = 0; while (brukt.has(nr)) nr++;
      bok.set(p.id, nr); brukt.add(nr);
    }
    return bok;
  }

  function brukData() {
    sjekkVersjon();
    brukConfig(DATA && DATA.config);
    const panes = (DATA && DATA.panes) || [];
    const sett = new Set();
    // En pane må mangle i 2 lesinger på rad før katten går. En enkelt glipp i tmux-lesingen
    // sendte før katten ut porten og inn igjen, og stokket om plassene til naboene.
    const iData = new Set(panes.map((p) => p.id));
    for (const k of katter.values()) k.borte = iData.has(k.id) ? 0 : (k.borte || 0) + 1;
    const beholdt = [...katter.values()].filter((k) => k.borte === 1).map((k) => k.p);
    const alle = panes.concat(beholdt);
    const grupper = {}; for (const l of LEDERNAVN) grupper[l] = [];
    const ukjente = [];
    for (const p of alle) {
      if (p.rolle === "spesialist") (p.leder && grupper[p.leder] ? grupper[p.leder] : ukjente).push(p);
    }
    // Faste plassnummer: en katt beholder plassen sin så lenge den er i hagen. Før ble
    // plassene fordelt på sortert indeks, så én ny eller borte katt flyttet naboene 230–260 px.
    const plasser = new Map();
    for (const l of LEDERNAVN) for (const [id, nr] of plassNr(l, grupper[l])) plasser.set(id, slotFor(l, nr));
    for (const [id, nr] of plassNr("felles", ukjente)) plasser.set(id, fellesSlot(nr));

    for (const rå of panes) {
      if (sett.has(rå.id)) continue; // samme pane to ganger (lenket vindu) blir én katt
      sett.add(rå.id);
      let k = katter.get(rå.id);
      let p = stabil(k, rå);
      if (!k) { // på vei ut, men tilbake: snu i porten i stedet for å bli to katter
        const i = paVeiUt.findIndex((u) => u.id === p.id);
        if (i >= 0) { k = paVeiUt.splice(i, 1)[0]; k.ut = false; k.alfa = 1; katter.set(p.id, k); }
      }
      const erLeder = p.rolle === "leder" && LEDER[p.kort];
      const slot = erLeder ? { x: LEDER[p.kort].x, y: LEDER[p.kort].y - 6 } :
        p.rolle === "vakt" ? { x: PORT.x + 70, y: VAKTRUNDE.y1 } : plasser.get(p.id) || fellesSlot(0);
      if (!k) {
        const a = utseende(p.kort);
        k = { id: p.id, kort: p.kort, a, slot, x: slot.x, y: slot.y, vx: 0, vy: 0, flip: 1, vend: 1, leke: null, vaktS: (hash(p.kort) % 1000), alfa: 1 };
        // Ny etter første titt: kommer inn gjennom porten og går til lederen sin.
        if (!forsteLast && !erLeder) {
          if (REDUCED) k.alfa = 0;
          else { k.x = PORT.x; k.y = PORT.y + 4; k.inn = true; }
        }
        k.stab = { status: p.status, siden: Date.now(), kandidat: null, antall: 0 };
        katter.set(p.id, k);
      } else if (k.p && k.p.status !== "ferdig" && p.status === "ferdig" && p.rolle !== "vakt") {
        // Går til solflekken, strekker seg og legger seg — men bare etter minst 15 s arbeid,
        // så en kort blafring ikke gir konfetti [forsvar i dybden; rotårsaken er rettet i .mjs].
        if (k.jobbetFra && Date.now() - k.jobbetFra > 15000) k.skalLegge = true;
      }
      if (p.status === "jobber" && (!k.p || k.p.status !== "jobber")) k.jobbetFra = Date.now();
      // Våkner: strekk deg i 0,9 s før leken. Før byttet katten fra krøllet til løpende på
      // ett bilde (målt 06.10, runde 7).
      if (k.p && k.p.status === "ferdig" && (p.status === "jobber" || p.status === "venter") && !REDUCED && !k.erVakt) {
        k.vakner = performance.now() / 1000 + .9;
      }
      // «Hva gjør den nå» holdes i 30 s når verktøylinja ikke er synlig på skjermen,
      // så ikonet ikke blinker 🧶 ↔ ⚡ hver gang den scroller forbi.
      if (p.status === "jobber") {
        if (p.aktivitet) k.sisteAkt = { a: p.aktivitet, t: Date.now() };
        else if (k.sisteAkt && Date.now() - k.sisteAkt.t < 30000) p = Object.assign({}, p, { aktivitet: k.sisteAkt.a });
      } else k.sisteAkt = null;
      k.p = p; k.slot = slot; k.kort = p.kort;
      k.erLeder = !!erLeder; k.erVakt = p.rolle === "vakt";
      if (p.status === "jobber" && !k.erLeder && !k.erVakt && !k.leke) {
        k.leke = { type: k.a.leke, x: slot.x + 30, y: slot.y, vx: 0, vy: 0, rot: 0 };
      }
      if (p.status !== "jobber") { k.leke = null; k.lekT = null; } // neste lek starter på nytt
    }
    for (const [id, k] of katter) if (!sett.has(id) && k.borte >= 2) {
      katter.delete(id);
      // En lukket pane går ut porten. Er det tmux som svikter, forsvinner de bare stille.
      if (!REDUCED && !(DATA && DATA.feil) && k.p.status !== "tom") { k.ut = true; k.leke = null; paVeiUt.push(k); }
    }
    forsteLast = false;
    byggLapper();
    oppdaterHud();
    behandleHendelser();
    tegnKompakt();
  }

  // ---------- A: hvem venter på deg ----------
  const venterListe = () => [...katter.values()].filter((k) => k.p.status === "venter").sort((a, b) => a.kort.localeCompare(b.kort, "nb"));

  function tegnVenter() {
    const el = $("venter");
    el.textContent = "";
    const v = venterListe();
    el.classList.toggle("har", v.length > 0);
    el.hidden = !DATA || !!DATA.feil || lastFeil;
    if (!v.length) { el.textContent = "✓ Ingen venter på deg"; return; }
    const t = document.createElement("span");
    t.textContent = `❓ ${v.length} venter på deg:`;
    el.title = v.map((k) => k.kort).join(", "); // banneret brytes aldri, så hele lista står her
    el.appendChild(t);
    // Hele navn, så mange som får plass på én linje, og «+N» for resten (se under).
    for (const k of v) {
      const b = document.createElement("button");
      const min = Math.floor((Date.now() - venterFra(k).fra) / 60000);
      b.type = "button"; b.textContent = k.kort + (min >= 1 ? ` · ${min} min` : "");
      b.setAttribute("aria-label", `${k.kort} har ventet på deg${min >= 1 ? " i " + min + " min" : ""}. Hopp til panen`);
      b.onclick = () => hopp(k);
      el.appendChild(b);
    }
    // Får ikke alt plass: fjern navn bakfra og vis «+N». Navnene kuttes aldri midt i,
    // og banneret brytes aldri — da ville hele hagen flyttet seg.
    const knapper = [...el.querySelectorAll("button")];
    const mer = document.createElement("span");
    mer.className = "flere";
    let skjult = 0;
    while (el.scrollWidth > el.clientWidth + 1 && knapper.length) {
      knapper.pop().remove(); skjult++;
      mer.textContent = `+${skjult}`;
      if (!mer.isConnected) el.appendChild(mer);
    }
    if (skjult) mer.title = v.slice(v.length - skjult).map((k) => k.kort).join(", ");
  }

  // Fanetittel og favicon: «(2) Spesialist-hagen» og en prikk for nytt mens du var borte.
  const favicon = document.createElement("canvas");
  favicon.width = favicon.height = 64;
  let sistFavicon = "";
  function oppdaterTittel() {
    const n = venterListe().length;
    document.title = (n ? `(${n}) ` : "") + (ulest ? "● " : "") + "Spesialist-hagen";
    if (sistFavicon === n + "|" + ulest) return; // PNG-en lages bare når den endres, ikke hvert 10. sekund
    sistFavicon = n + "|" + ulest;
    const g = favicon.getContext("2d");
    g.clearRect(0, 0, 64, 64);
    const farge = n ? "#F6C445" : "#AFD7AF";
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(32 + s * 26, 30); g.lineTo(32 + s * 22, 4); g.lineTo(32 + s * 6, 16); g.closePath();
      g.fillStyle = farge; g.fill();
    }
    ell(g, 32, 38, 28, 24, farge);
    g.fillStyle = "#4A3B52"; g.textAlign = "center"; g.textBaseline = "middle";
    if (n) { g.font = "800 32px ui-rounded, system-ui, sans-serif"; g.fillText(n > 9 ? "9+" : String(n), 32, 40); }
    else { ell(g, 22, 36, 3, 4, "#4A3B52"); ell(g, 42, 36, 3, 4, "#4A3B52"); }
    if (ulest) { ell(g, 54, 10, 10, 10, "#F27DB5"); g.lineWidth = 3; g.strokeStyle = "#FFFFFF"; g.stroke(); }
    $("favicon").href = favicon.toDataURL("image/png");
  }

  // ---------- C og D: hendelser, «mens du var borte», varsel-prikk og mjau ----------
  const lagret = {
    les(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    skriv(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privat vindu: virker uten */ } },
  };
  const BORTE_KEY = "spesialist-hagen-borte-fra";
  let borteFra = Number(lagret.les(BORTE_KEY)) || null; // sist du gikk fra siden
  let tilstede = !document.hidden && document.hasFocus();
  let ulest = 0;
  let sisteSett = null; // ts for nyeste hendelse vi har reagert på

  function gaaFra() {
    if (!tilstede) return;
    tilstede = false; borteFra = Date.now(); lagret.skriv(BORTE_KEY, String(borteFra));
  }
  function kommeTilbake() {
    if (tilstede) return;
    tilstede = true; ulest = 0; oppdaterTittel();
  }
  addEventListener("blur", gaaFra);
  addEventListener("focus", kommeTilbake);
  addEventListener("pagehide", () => lagret.skriv(BORTE_KEY, String(Date.now())));
  document.addEventListener("visibilitychange", () => (document.hidden ? gaaFra() : document.hasFocus() && kommeTilbake()));
  document.documentElement.addEventListener("pointerenter", kommeTilbake); // et blikk med musa teller

  const HIKON = { inn: "🚪", ut: "👋", ferdig: "💤", jobber: "🧶", venter: "❓", tom: "🧺" };
  function behandleHendelser() {
    const liste = (DATA && DATA.hendelser) || [];
    const nyeste = liste.length ? liste[liste.length - 1].ts : "";
    if (sisteSett === null) sisteSett = nyeste; // første titt: gammelt mjauer ikke
    for (const h of liste) if (h.ts > sisteSett && (h.type === "ferdig" || h.type === "venter")) {
      if (!tilstede) ulest++;
      // Smart pling: bare når du ikke ser på den panen akkurat nå.
      const pane = ((DATA && DATA.panes) || []).find((x) => x.id === h.id);
      if (L.skalSpilles(lydPa, pane && pane.synlig)) spillEnGang(h.type, `${h.ts}|${h.id || h.kort}|${h.type}`);
    }
    if (nyeste > sisteSett) sisteSett = nyeste;
    paminnVentende();
    sisteHendelser = liste;
    tegnLogg($("loggListe"), $("loggTittel"), liste, 20);
    tegnLogg($("kLoggListe"), $("kLoggTittel"), liste, 3);
    oppdaterTittel();
  }

  function tid(iso) {
    const d = new Date(iso), i = new Date();
    const hm = d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
    return d.toDateString() === i.toDateString() ? hm : d.getDate() + "." + (d.getMonth() + 1);
  }
  function tegnLogg(ol, h2, liste, maks) {
    ol.textContent = "";
    const ny = (h) => borteFra && Date.parse(h.ts) > borteFra;
    const antallNy = liste.filter(ny).length;
    h2.textContent = antallNy ? `Mens du var borte · ${antallNy} ${antallNy === 1 ? "hendelse" : "hendelser"}` : "Hendelser";
    h2.classList.toggle("borte", antallNy > 0);
    if (!liste.length) {
      const li = document.createElement("li"); li.className = "tom-logg";
      li.textContent = "Ingenting har skjedd ennå. Her ser du hvem som kom, la seg og begynte å vente.";
      ol.appendChild(li); return;
    }
    for (const h of liste.slice(-maks).reverse()) {
      const li = document.createElement("li");
      if (ny(h)) li.className = "ny";
      const t = document.createElement("time"); t.dateTime = h.ts; t.textContent = tid(h.ts);
      const ikon = h.type === "vaer" ? ({ regn: "🌧️", skyer: "⛅", sol: "☀️" }[h.vaer] || "⛅") : HIKON[h.type];
      const i = document.createElement("span"); i.textContent = ikon || "🐾"; i.setAttribute("aria-hidden", "true");
      const tx = document.createElement("span"); tx.textContent = h.kort + " " + h.tekst;
      li.append(t, i, tx);
      ol.appendChild(li);
    }
    // Hele hagen: så mange som får plass i boksen, i hele linjer (aldri en halv nederst).
    if (ol.id === "loggListe" && !kompakt) while (ol.children.length > 1 && loggEl.scrollHeight > loggEl.clientHeight + 1) ol.lastElementChild.remove();
  }

  // Lyd: valgfri og AV som standard. Mjauene lages med Web Audio i spesialister-lyd.js, uten lydfiler.
  // Hvorfor hagen var stum (09.10): Chrome lar en AudioContext bare spille etter et klikk i
  // fanen. Konteksten ble laget i en timer og aldri resume()-et, og etter hver automatiske
  // omlasting (ny kode) var den låst igjen. Nå låses den opp ved første klikk eller tast i
  // hagen, og hvis nettleseren fortsatt holder igjen lyden, står det ved bryteren.
  const L = window.HageLyd;
  const LYD_KEY = "spesialist-hagen-lyd";
  let lydPa = L.lydPaFra(lagret.les(LYD_KEY));
  let lydCtx = null;
  function lydKontekst() {
    if (lydCtx) return lydCtx;
    try { lydCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    lydCtx.onstatechange = visLydLas;
    return lydCtx;
  }
  const lydKlar = () => Boolean(lydCtx && lydCtx.state === "running");
  // Kalles i selve klikket/tasten: det er bare der Chrome lar oss starte lyden.
  function lasOppLyd() {
    if (!lydPa) return; // «Hør mjau» låser opp selv, i sitt eget klikk
    const ac = lydKontekst();
    if (ac && ac.state !== "running") ac.resume().then(visLydLas, visLydLas);
    else visLydLas();
  }
  addEventListener("pointerdown", lasOppLyd, true);
  addEventListener("keydown", lasOppLyd, true);
  function visLydLas() {
    const last = lydPa && !lydKlar();
    for (const el of document.querySelectorAll(".lydlas")) el.hidden = !last;
  }
  // tvungen = «Hør mjau»: spiller også når bryteren er av, fordi du ba om akkurat den lyden.
  // Svarer med et løfte om den faktisk spilte.
  function spill(type, { paminnelse = false, tvungen = false, variant = null } = {}) {
    if (!lydPa && !tvungen) return Promise.resolve(false);
    const ac = lydKontekst();
    if (!ac) return Promise.resolve(false);
    const navn = variant || L.lydFor(type, paminnelse);
    const kjor = () => { try { L.spill(ac, navn); return true; } catch (e) { return false; } };
    if (ac.state === "running") return Promise.resolve(kjor());
    return ac.resume().then(() => ac.state === "running" && kjor(), () => false)
      .then((ok) => { visLydLas(); return ok; });
  }
  // Hagen er ofte åpen i flere faner. Bare én fane får spille per hendelse: den som først
  // skriver nøkkelen i localStorage (delt mellom fanene), etter en liten tilfeldig pause.
  const LYD_SPILT = "spesialist-hagen-lyd-spilt";
  const lydLogg = []; // for målekroken (?debug=1)
  function spillEnGang(type, nokkel, paminnelse = false) {
    if (!lydPa) return;
    // En fane med låst lyd tar ikke hendelsen, ellers ble den stum for alle fanene.
    if (!lydKlar()) { visLydLas(); return; }
    setTimeout(() => {
      let spilt = [];
      try { spilt = JSON.parse(lagret.les(LYD_SPILT) || "[]"); } catch (e) { spilt = []; }
      if (spilt.includes(nokkel)) return;
      lagret.skriv(LYD_SPILT, JSON.stringify(spilt.concat(nokkel).slice(-60)));
      lydLogg.push({ type, nokkel, paminnelse, t: Date.now() });
      spill(type, { paminnelse });
    }, Math.random() * 250);
  }

  // Påminnelse når noen har ventet på deg i over 5 min (og så hvert 15. min) — bare når
  // du ikke ser på panen. Banneret viser ventetiden uansett, også med lyden av.
  const PAMINN_FORST = L.PAMINN_FORST;
  // Når begynte katten å vente? Venter-hendelsen fra datakilden er lik i alle faner.
  function venterFra(k) {
    const h = [...((DATA && DATA.hendelser) || [])].reverse().find((x) => x.id === k.id && x.type === "venter");
    return { fra: h ? Date.parse(h.ts) : (k.stab ? k.stab.siden : Date.now()), ts: h ? h.ts : null };
  }
  function paminnVentende() {
    const naa = Date.now();
    for (const k of katter.values()) {
      if (k.p.status !== "venter" || !k.stab) { k.paminnet = -1; continue; }
      // Forankret i venter-hendelsen fra datakilden: den er lik i alle faner, så nøkkelen
      // blir lik og bare én fane spiller. Fanens egen tid ville gitt én pling per fane.
      const { fra, ts } = venterFra(k);
      const ventet = naa - fra;
      if (ventet < PAMINN_FORST) continue;
      const nr = L.paminnelseNr(ventet); // 0 ved 5 min, 1 ved 20 min …
      if (k.paminnet === nr) continue;
      k.paminnet = nr;
      if (!k.p.synlig) {
        spillEnGang("venter", `paminn|${k.id}|${ts || fra}|${nr}`, true);
        beskjed(`❓ ${k.kort} har ventet på deg i ${Math.round(ventet / 60000)} min`);
      }
    }
  }

  function oppdaterLydknapper() {
    for (const b of document.querySelectorAll(".lydknapp")) {
      b.setAttribute("aria-pressed", String(lydPa));
      b.textContent = lydPa ? "🔊 Lyd på" : "🔇 Lyd av";
      b.title = lydPa ? "Mjau når noen blir ferdig, «mjau?» når noen venter — bare for paner du ikke ser på, og «mrrau?» etter 5 min venting" : "Slå på lyd for ferdig og venter (bare for paner du ikke ser på)";
    }
    visLydLas();
  }
  for (const b of document.querySelectorAll(".lydknapp")) b.addEventListener("click", () => {
    lydPa = !lydPa; lagret.skriv(LYD_KEY, lydPa ? "på" : "av"); oppdaterLydknapper();
    if (lydPa) spill("ferdig"); // en prøvelyd, så du hører hva du slo på
  });
  // «Hør mjau»: spiller alltid, og går rundt variantene (ferdig → venter → påminnelse).
  let proveNr = -1;
  for (const b of document.querySelectorAll(".mjauknapp")) b.addEventListener("click", () => {
    proveNr = L.nesteProve(proveNr);
    const navn = L.REKKEFOLGE[proveNr], v = L.VARIANTER[navn];
    spill(null, { tvungen: true, variant: navn }).then((ok) => beskjed(ok
      ? `🐱 «${v.tekst}» ${v.naar}`
      : lydCtx ? "Klikk én gang i hagen for å slå på lyd" : "Nettleseren har ikke lyd her"));
  });
  if (lydPa) lydKontekst(); // får Chrome lov til å spille uten klikk, er lyden klar med en gang
  oppdaterLydknapper();
  $("miniknapp").addEventListener("click", () => {
    window.open("spesialister.html?kompakt=1", "kattehage-mini", "popup,width=420,height=340");
  });

  // ---------- B: kompakt — en liten liste for hjørnet ----------
  let kompakt = false;
  function erKompakt() {
    const p = PARAM.get("kompakt");
    if (p === "1") return true;
    if (p === "0") return false;
    return innerWidth < 640 || innerHeight < 420;
  }
  function settModus() {
    const var_ = kompakt;
    kompakt = erKompakt();
    document.body.classList.toggle("er-kompakt", kompakt);
    $("kompakt").hidden = !kompakt;
    velgOppsett();
    if (var_ && !kompakt) { tilpass(); startLoop(); }
    tegnKompakt();
  }

  // ---------- oppsett etter vindusformen (CSS: body[data-oppsett]) ----------
  // Velger det som gir størst hage: «side» (hendelsene i en kolonne til høyre) når vinduet er
  // bredt og lavt, ellers «under». Målt 06.10: på en ekstern 1080p-skjerm fylte hagen
  // 61 % av vinduet, med 183 px tomt gress på hver side.
  const toppEl = $("topp"), loggEl = $("logg");
  let oppsett = "", sisteHendelser = [];
  function velgOppsett() {
    if (kompakt) return;
    const vw = innerWidth, vh = innerHeight, th = toppEl.offsetHeight;
    document.documentElement.style.setProperty("--topp-h", th + "px");
    const panel = clamp(vw * .17, 230, 340);
    const side = Math.min(vw - panel - 22, (vh - th - 12) * 1.6); // hagens bredde med kolonne til høyre
    const under = Math.min(vw - 24, (vh - th - 112) * 1.6);       // hagens bredde med hendelsene under
    // Blir hagen omtrent like stor, vinner kolonnen: den fyller margene som ellers står tomme
    // (på en ekstern 1080p-skjerm: 133 px gress på hver side). Litt hysterese, så et vindu på grensen ikke vipper.
    const nytt = vw >= 1000 && side >= under * (oppsett === "side" ? .95 : .98) ? "side" : "under";
    if (nytt !== oppsett) { oppsett = nytt; document.body.dataset.oppsett = nytt; }
  }
  new ResizeObserver(velgOppsett).observe(toppEl);
  // Ny størrelse på hendelsesboksen: fyll den på nytt (tegnLogg tar så mange som får plass).
  new ResizeObserver(() => { if (!kompakt) tegnLogg($("loggListe"), $("loggTittel"), sisteHendelser, 20); }).observe(loggEl);
  function miniHode(k) {
    const c = document.createElement("canvas");
    c.width = c.height = 52; c.setAttribute("aria-hidden", "true");
    const g = c.getContext("2d");
    g.setTransform(1.55, 0, 0, 1.55, 26, 30);
    tegnHode(g, k.a, { lukket: k.p.status === "ferdig", hatt: k.erLeder && k.p.kort === FESTLEDER ? "fest" : k.erVakt ? "vakt" : null });
    return c;
  }
  function tegnKompakt() {
    if (!kompakt) return;
    const alle = [...katter.values()];
    const av = (s) => alle.filter((k) => k.p.status === s).sort((a, b) => (b.erLeder - a.erLeder) || a.kort.localeCompare(b.kort, "nb"));
    const venter = av("venter"), jobber = av("jobber"), sover = av("ferdig"), tomme = av("tom");
    const topp = $("kVenter");
    topp.parentElement.classList.toggle("har", venter.length > 0);
    if (lastFeil && !DATA) topp.textContent = "Ingen data ennå — dobbeltklikk kattehage-live.command";
    else if (DATA && DATA.feil) topp.textContent = "Hagen får ikke svar fra tmux";
    else if (DATA && !alle.length) topp.textContent = "Hagen er stille 🌙";
    else topp.textContent = venter.length ? `❓ ${venter.length} venter på deg` : "✓ Ingen venter på deg";
    const v = vaerNaa();
    $("kMeta").textContent = `🧶 ${jobber.length} · 💤 ${sover.length}`;
    $("kKvote").textContent = v.deler ? `${v.ikon} 5h-kvote: ${v.deler}${v.nullstilles}` : "";
    $("kKvote").title = v.forklaring;
    const ul = $("kListe");
    ul.textContent = "";
    for (const k of venter.concat(jobber)) {
      // En ekte knapp i et vanlig listepunkt: lista beholder sin semantikk, og Enter/mellomrom virker av seg selv.
      const li = document.createElement("li"), knapp = document.createElement("button");
      knapp.type = "button"; knapp.className = "k-rad " + k.p.status;
      const navn = document.createElement("span"); navn.className = "k-navn"; navn.textContent = k.kort;
      const hvem = document.createElement("small");
      hvem.textContent = k.erLeder ? "leder" : k.erVakt ? "vakt" : (LEDERKORT[k.p.leder] || "felles");
      navn.appendChild(hvem);
      const st = document.createElement("span"); st.className = "k-status";
      const ik = document.createElement("span"); ik.className = "k-ikon"; ik.textContent = statusFor(k).ikon;
      st.append(ik, " " + (k.p.status === "venter" ? "venter på deg" : statusFor(k).ord));
      knapp.append(miniHode(k), navn, st);
      knapp.setAttribute("aria-label", `${k.kort}: ${statusFor(k).lang}. Hopp til panen`);
      knapp.addEventListener("click", () => hopp(k));
      li.appendChild(knapp);
      ul.appendChild(li);
    }
    const sov = $("kSover");
    sov.textContent = "";
    const del = (ikon, ord, liste) => {
      if (!liste.length) return;
      if (sov.childNodes.length) sov.append(" · ");
      const b = document.createElement("b"); b.textContent = `${ikon} ${liste.length} ${ord}: `;
      sov.append(b, liste.map((k) => (kanRyddes(k) ? "🧹" : "") + k.kort).join(", "));
    };
    del("💤", "sover", sover);
    del("🧺", "tomme", tomme);
    sjekkAlder();
  }
  addEventListener("resize", () => { cvRekt = null; if (erKompakt() !== kompakt) settModus(); else velgOppsett(); });

  // ---------- navnelapper (ekte knapper — Tab, hover og skjermleser) ----------
  const lapper = $("lapper");
  const lappFor = new Map();
  let fokusKatt = null, festet = false;

  const faste = new Map(); // lapper som ikke er katter: «X er ikke ute», felles hjørne
  // Lappene lages én gang per pane og oppdateres på stedet. Å bygge dem på nytt hvert
  // 10. sekund mistet fokus og hover, og fikk dem til å blafre.
  function byggLapper() {
    const tilstedeLedere = new Set();
    for (const [k, b] of lappFor) if (!katter.has(k.id) || katter.get(k.id) !== k) { b.remove(); lappFor.delete(k); }
    const sortert = [...katter.values()].sort((a, b) => (b.erLeder - a.erLeder) || a.kort.localeCompare(b.kort, "nb"));
    for (const k of sortert) {
      const p = k.p, st = statusFor(k);
      if (k.erLeder) tilstedeLedere.add(p.kort);
      let b = lappFor.get(k);
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.innerHTML = '<span class="ikon" aria-hidden="true"></span><span class="navn"></span><span class="krone" aria-hidden="true"></span>';
        b.addEventListener("mouseenter", () => { if (!festet) visKort(k, false); });
        b.addEventListener("mouseleave", () => { if (!festet) skjulKort(); });
        b.addEventListener("focus", () => { if (!festet) visKort(k, false); });
        b.addEventListener("blur", () => { if (!festet) skjulKort(); });
        b.addEventListener("click", () => hopp(k)); // klikk hopper til panen; E fester kortet
        settLapp(b, k.x * skala, (k.y - 66) * skala);
        lapper.appendChild(b);
        lappFor.set(k, b);
      }
      const klasse = "lapp katt-lapp " + p.status + (k.erLeder ? " leder" : "");
      if (b.className !== klasse) b.className = klasse;
      b.style.borderColor = k.erLeder && p.status !== "venter" ? LEDER[p.kort].kant : "";
      b.querySelector(".ikon").textContent = st.ikon;
      b.querySelector(".navn").textContent = p.kort;
      b.querySelector(".krone").textContent = harKrone(p.konto) ? "👑" : "";
      b.setAttribute("aria-label", `${p.kort}: ${st.lang}${p.konto ? ", " + p.konto : ""}. Trykk for å hoppe til panen, E for detaljer`);
      lappMaal.delete(b);
    }
    for (const l of LEDERNAVN) {
      const nøkkel = "borte:" + l;
      if (tilstedeLedere.has(l)) { if (faste.has(nøkkel)) { faste.get(nøkkel).remove(); faste.delete(nøkkel); } continue; }
      if (faste.has(nøkkel)) continue;
      const el = document.createElement("span");
      el.className = "lapp borte leder";
      el.textContent = l + " er ikke ute";
      plasserLapp(el, LEDER[l].x, LEDER[l].y - 30);
      lapper.appendChild(el); faste.set(nøkkel, el);
    }
    if (!faste.has("skilt")) {
      const skilt = document.createElement("span");
      skilt.className = "lapp skilt"; skilt.textContent = "🪧 Felles hjørne";
      plasserLapp(skilt, 150, 572);
      lapper.appendChild(skilt); faste.set("skilt", skilt);
    }
    if (fokusKatt && !katter.has(fokusKatt.id)) { festet = false; skjulKort(); }
    else if (fokusKatt) visKort(fokusKatt, festet);
  }
  function plasserLapp(el, x, y) {
    el.dataset.x = x; el.dataset.y = y;
    el.style.left = (x / W * 100) + "%";
    el.style.top = (y / H * 100) + "%";
  }
  // Lappene til kattene flyttes med transform, med de samme desimalene som katten tegnes med.
  // Før ble left/top skrevet hvert bilde: layout per bilde, og lappen ble avrundet ulikt fra
  // katten, så de danset mot hverandre (runde 8). Står lappen stille, rundes den til hele
  // skjermpiksler, så teksten er skarp.
  function settLapp(el, x, y, stille) {
    if (stille) { x = Math.round(x * dpr) / dpr; y = Math.round(y * dpr) / dpr; }
    if (el._tx === x && el._ty === y) return;
    el._tx = x; el._ty = y;
    el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) translate(-50%, -100%)`;
  }

  // Lappene skal aldri ligge oppå hverandre. Hver lapp plasseres over katten sin; kolliderer
  // den med en som alt er plassert, flyttes den opp. Ventende og ledere plasseres først,
  // så de står der de skal. Størrelsen måles én gang per innhold og skala.
  let lappMaal = new WeakMap();
  function maalLapp(el) {
    let m = lappMaal.get(el);
    if (!m) { m = { w: el.offsetWidth, h: el.offsetHeight }; lappMaal.set(el, m); }
    return m;
  }
  function plasserAlleLapper(onsket, dt) {
    const bredde = W * skala, hindre = [];
    for (const el of faste.values()) {
      const m = maalLapp(el), x = el.dataset.x * skala, y = el.dataset.y * skala;
      hindre.push({ l: x - m.w / 2, r: x + m.w / 2, t: y - m.h, b: y });
    }
    const liste = onsket.map((o) => Object.assign(o, { m: maalLapp(o.el) }));
    // Fast rekkefølge (prioritet, så pane-id). Sortert etter høyde byttet rekkefølgen hver
    // gang to katter passerte hverandre, og lappene hoppet 50–80 px (målt 06.10).
    liste.sort((a, b) => a.prio - b.prio || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const o of liste) {
      const x = clamp(o.x * skala, o.m.w / 2 + 4, bredde - o.m.w / 2 - 4);
      const hoyde = H * skala, steg = o.m.h + 3, start = clamp(o.y * skala, o.m.h + 4, hoyde - 4);
      const ledig = (y) => !hindre.some((h) => x - o.m.w / 2 < h.r + 2 && h.l < x + o.m.w / 2 + 2 && y - o.m.h < h.b + 2 && h.t < y + 2);
      // Prøv der den hører hjemme, så plassen den hadde sist, så skiftevis ett hakk opp og
      // ett ned (aldri ut av hagen). Å beholde forrige plass hindrer at lappene bytter.
      let y = start;
      const sist = o.el._forskyvning ? start + o.el._forskyvning : null;
      const sistGyldig = sist !== null && sist >= o.m.h + 4 && sist <= hoyde - 4 && ledig(sist);
      // Minste tid per plass: hjem igjen først når hjemmeplassen har vært ledig i 1,5 s.
      // Ellers pendlet lappen til en katt i bevegelse mellom hjem og omvei. Da lappene begynte
      // å følge kattene som leker (09.10), ga 0,6 s 14–22 radbytter på 20 s med åtte katter
      // som lekte; 1,5 s ga 10–11 (målt headless).
      const naaMs = performance.now();
      if (ledig(start)) { if (o.el._hjemLedigFra === undefined) o.el._hjemLedigFra = naaMs; }
      else o.el._hjemLedigFra = undefined;
      const hjemLengeNok = o.el._hjemLedigFra !== undefined && naaMs - o.el._hjemLedigFra > 1500;
      if (sistGyldig && !(ledig(start) && hjemLengeNok)) y = sist;
      for (let i = 1; !ledig(y) && i <= 12; i++) {
        const opp = start - i * steg, ned = start + i * steg;
        if (opp >= o.m.h + 4 && ledig(opp)) { y = opp; break; }
        if (ned <= hoyde - 4 && ledig(ned)) { y = ned; break; }
      }
      hindre.push({ l: x - o.m.w / 2, r: x + o.m.w / 2, t: y - o.m.h, b: y });
      o.el._forskyvning = y - start;
      // Ankeret (katten eller lekeplassen) følges eksakt; en ny plass i køen eller et nytt
      // anker glir på ~0,1 s, likt på 60, 120 og 144 Hz. Før glei y med 45 % per bilde (dobbelt
      // så fort på 120 Hz) mens x hoppet, så lappen vaklet når katten gikk på skrå.
      const s = o.el._lapp || (o.el._lapp = {});
      const ny = s.skala !== skala; s.skala = skala;
      const bx = o.bx * skala, by = o.by * skala;
      const vis = B.lappSteg(s, o.anker, bx, by, x - bx, y - by, dt, ny || REDUCED);
      settLapp(o.el, vis.x, vis.y, o.anker === "slot" || (s.forX === vis.x && s.forY === vis.y));
      s.forX = vis.x; s.forY = vis.y;
    }
  }

  // ---------- infokort ----------
  const kort = $("kort");
  function visKort(k, fest) {
    fokusKatt = k; festet = fest;
    const p = k.p, st = statusFor(k);
    $("kortNavn").textContent = p.kort + (harKrone(p.konto) ? " 👑" : "");
    $("kortRolle").textContent = k.erLeder ? "Leder · bor " + LEDER[p.kort].hjem :
      k.erVakt ? "Vaktkatten · går runden langs gjerdet" :
      p.leder ? "Spesialist hos " + p.leder : "Spesialist · felles hjørne";
    const min = minSidenFerdig(k);
    $("kortStatus").textContent = st.ikon + " " + st.lang + (min !== null ? ` · ferdig for ${min} min siden` : "") + (kanRyddes(k) ? " 🧹" : "");
    $("kortModell").textContent = p.modell || "ukjent — fant ikke footeren";
    $("kortKonto").textContent = kontoTekst(p.konto);
    $("kortPane").textContent = p.id + " · " + p.okt + " / " + p.vindu;
    $("kortOm").textContent = (p.navn || "").split(" · ").slice(1).join(" · ");
    // Festet kort (E) viser de siste linjene i panen — bare lest, aldri skrevet til.
    const linjer = (p.siste || []).filter(Boolean);
    $("kortLinjer").hidden = !(fest && linjer.length);
    $("kortLinjeTekst").textContent = linjer.join("\n");
    tegnPortrett(k);
    kort.hidden = false;
    kort.classList.toggle("festet", fest);
    kortMaal = { w: kort.offsetWidth, h: kort.offsetHeight }; // én måling per visning, ikke per bilde
    plasserKort();
  }
  function skjulKort() { kort.hidden = true; fokusKatt = null; festet = false; }
  // Kortet følger katten hvert bilde, men leser aldri layout her (før: to tvungne layouter
  // per bilde mens musa sto over en katt).
  let kortMaal = { w: 260, h: 180 };
  function plasserKort() {
    if (!fokusKatt || kort.hidden) return;
    const kx = fokusKatt.x * skala, ky = fokusKatt.y * skala;
    const bw = kortMaal.w, bh = kortMaal.h;
    let left = kx + 40 * skala;
    if (left + bw > wrapW - 10) left = kx - bw - 40 * skala;
    const top = clamp(ky - bh / 2 - 30 * skala, 8, wrapH - bh - 8);
    left = clamp(left, 10, wrapW - bw - 10);
    kort.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }
  function tegnPortrett(k) {
    const pc = $("kortPortrett"), g = pc.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, pc.width, pc.height);
    g.setTransform(2.6, 0, 0, 2.6, pc.width / 2, pc.height / 2 + 8);
    halsband(g, 0, 11, 18, { halsband: halsbandFor(k.p.konto) });
    tegnHode(g, k.a, { hatt: k.erLeder && k.p.kort === FESTLEDER ? "fest" : k.erVakt ? "vakt" : null, lukket: k.p.status === "ferdig" });
  }

  addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "escape") { if (fokusKatt) { festet = false; skjulKort(); } return; }
    if (key === "e") {
      const el = document.activeElement;
      for (const [k, b] of lappFor) if (b === el) { if (festet && fokusKatt === k) { festet = false; visKort(k, false); } else visKort(k, true); return; }
    }
  });

  // hover og klikk rett på katten
  function kattVed(clientX, clientY) {
    const r = cvRekt || (cvRekt = cv.getBoundingClientRect());
    const wx = (clientX - r.left) / r.width * W, wy = (clientY - r.top) / r.height * H;
    let best = null, bd = Infinity;
    for (const k of katter.values()) {
      const rad = k.erLeder ? 46 : 28;
      const d = Math.hypot(k.x - wx, k.y - (k.erLeder ? 40 : 22) - wy);
      if (d < rad && d < bd) { bd = d; best = k; }
    }
    return best;
  }
  cv.addEventListener("mousemove", (e) => {
    const k = kattVed(e.clientX, e.clientY);
    const peker = k ? "pointer" : "default";
    if (cv.style.cursor !== peker) cv.style.cursor = peker;
    if (festet) return;
    if (k) { if (fokusKatt !== k) visKort(k, false); } else if (fokusKatt) skjulKort();
  });
  cv.addEventListener("mouseleave", () => { if (!festet) skjulKort(); });
  cv.addEventListener("click", (e) => {
    const k = kattVed(e.clientX, e.clientY);
    if (k) hopp(k); else { festet = false; skjulKort(); }
  });

  // ---------- hopp til panen (via hopp-tjeneren i datakilden, bare 127.0.0.1) ----------
  let beskjedTimer = 0;
  function beskjed(tekst) {
    const el = $("beskjed");
    el.textContent = tekst; el.hidden = false;
    clearTimeout(beskjedTimer);
    beskjedTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }
  async function hopp(k) {
    const h = DATA && DATA.hopp;
    if (DEMO) { visKort(k, true); beskjed("Dette er demo-hagen. Med ekte data hopper du rett til panen."); return; }
    if (!h) { visKort(k, true); beskjed("Hopp til panen virker bare når datakilden går med --live."); return; }
    beskjed(`↗ Henter fram ${k.kort} …`); // svar med en gang, før hopp-tjeneren har svart
    try {
      const r = await fetch(`http://127.0.0.1:${h.port}/hopp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Kattehage-Token": h.token },
        body: JSON.stringify({ pane: k.id }),
      });
      const svar = await r.json();
      beskjed(svar.ok ? `↗ Henter fram ${k.kort}` : `Fikk ikke hoppet til ${k.kort}: ${svar.melding}`);
    } catch (e) {
      beskjed("Fant ikke hopp-tjeneren — kjører datakilden?");
    }
  }

  // ---------- vær etter 5-timerskvoten ----------
  function vaerNaa() {
    const kv = (DATA && DATA.kvote) || {};
    const tall = Object.values(kv).filter((v) => typeof v === "number");
    const nullst = (DATA && DATA.kvoteNullstilles) || {};
    // Høyeste først, med kontonavn: «Work 99 % · Personal 13 %». Den som gir været står først.
    const sortert = Object.entries(kv).filter(([, v]) => typeof v === "number").sort((a, b) => b[1] - a[1]);
    const deler = sortert.map(([k, v]) => `${k} ${v} %`).join(" · ");
    const kilde = sortert.length ? sortert[0][0] : null;
    const om = kilde && nullst[kilde] != null ? nullst[kilde] : null;
    const nullstilles = om == null ? "" : om < 60 ? ` · nullstilles om ${om} min` : ` · nullstilles om ${Math.floor(om / 60)} t ${om % 60} min`;
    if (!tall.length) return { navn: "sol", ikon: lysNaa().morke > .5 ? "✨" : "☀️", forklaring: DATA && DATA.config && DATA.config.quota === false ? "Været er av (quota.enabled i hage.config.json)" : "Fant ingen 5h-kvote i statuslinjene" };
    const m = Math.max(...tall);
    const navn = m > 80 ? "regn" : m >= 50 ? "skyer" : "sol";
    const ikon = navn === "regn" ? "🌧️" : navn === "skyer" ? "⛅" : (lysNaa().morke > .5 ? "✨" : "☀️");
    return { navn, ikon, maks: m, deler, kilde, nullstilles,
      forklaring: `Været følger den høyeste 5-timerskvoten (${deler}): sol under 50 %, skyer 50–80 %, regn over 80 %` };
  }

  // ---------- HUD og meldinger ----------
  function klokke(iso) { return new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }

  function oppdaterHud() {
    const panes = [...katter.values()].map((k) => k.p); // stabil status, samme som kattene viser
    const tell = (s) => panes.filter((p) => p.status === s).length;
    $("nJobber").textContent = tell("jobber"); $("nFerdig").textContent = tell("ferdig");
    $("nVenter").textContent = tell("venter"); $("nTom").textContent = tell("tom");
    const lys = lysNaa(), v = vaerNaa();
    $("undertittel").textContent = (DATA ? "oppdatert " + klokke(DATA.generertKl) : "ingen data ennå") + " · " + tidsord(lys.tim) +
      (v.deler ? ` · ${v.ikon} ${v.deler}` : "");
    $("undertittel").title = v.forklaring;
    cv.setAttribute("aria-label", `Spesialist-hagen: ${panes.length} katter. ${tell("venter")} venter på deg, ${tell("jobber")} jobber, ${tell("ferdig")} sover, ${tell("tom")} tomme skall.`);
    tegnVenter();

    const m = $("melding");
    m.classList.remove("feil");
    if (lastFeil && !DATA) {
      m.hidden = false; m.classList.add("feil");
      $("meldingTittel").textContent = "Hagen har ingen data ennå";
      $("meldingTekst").textContent = "Start datakilden: kjør «node spesialister.mjs --live» i katte-hagen-mappa (eller dobbeltklikk kattehage-live.command), så våkner hagen innen 10 sekunder.";
    } else if (DATA && DATA.feil) {
      m.hidden = false; m.classList.add("feil");
      $("meldingTittel").textContent = "Hagen får ikke svar fra tmux";
      $("meldingTekst").textContent = DATA.feil + " Sjekk at tmux kjører. Hagen prøver igjen hvert 10. sekund.";
    } else if (DATA && !panes.length) {
      m.hidden = false;
      $("meldingTittel").textContent = "Hagen er stille — ingen spesialister ute nå 🌙";
      $("meldingTekst").textContent = "Kattene kommer ut så snart en Claude-økt starter i tmux.";
    } else m.hidden = true;
    sjekkAlder();
  }
  function alderTekst() {
    if (!DATA) return "";
    const alder = Date.now() - Date.parse(DATA.generertKl);
    if (alder <= GAMMEL_MS && !lastFeil) return "";
    const min = Math.round(alder / 60000);
    const naar = min < 1 ? "under ett minutt siden" : min === 1 ? "ett minutt siden" : min < 90 ? `${min} min siden` : `kl. ${klokke(DATA.generertKl).slice(0, 5)}`;
    return `Sist oppdatert for ${naar}. Datakilden kjører ikke — start kattehage-live.command.`;
  }
  // Kjøres hvert sekund: skriv bare når teksten faktisk endres (ellers ny tekstnode og ny layout hvert sekund).
  function sjekkAlder() {
    const t = alderTekst();
    for (const el of [$("gammel"), $("kGammel")]) {
      if (!el) continue;
      if (el.textContent !== t) el.textContent = t;
      if (el.hidden !== !t) el.hidden = !t;
    }
  }

  // ---------- bevegelse (logikken bor i spesialister-bevegelse.js og testes i node) ----------
  // Vaktrunden har runde hjørner: vakta svinger i stedet for å knekke 90° på ett bilde.
  const RUNDE = B.lagVaktRunde(VAKTRUNDE, 44);
  const VAKT_FART = 40;
  const FART = { // px/s, px/s², px/s². Ingen bevegelse starter eller stopper brått lenger.
    inn: { maks: 60, aks: 140, brems: 160 },  // inn porten i rolig skritt
    ut: { maks: 60, aks: 140, brems: 160 },
    legg: { maks: 75, aks: 150, brems: 170 }, // hjem til solflekken for å legge seg
    hjem: { maks: 65, aks: 140, brems: 160 },
  };

  // Etter hvert steg: kroppen (sitt/stå og beina) og retningen, ut fra den faktiske farten.
  function etterSteg(k, t, dt, valg, seX) {
    B.kropp(k, dt, valg);
    B.vend(k, B.retningFor(k, seX), t, dt);
    k.lop = k.reis > .5;
  }

  const konfetti = [];
  function konfettiFra(x, y) {
    if (!effekt("konfetti")) return;
    for (let i = 0; i < (rolig ? 8 : 16); i++) {
      const v = -Math.PI / 2 + (Math.random() - .5) * 2.2, fart = 90 + Math.random() * 90;
      konfetti.push({ id: ++delNr, x, y, vx: Math.cos(v) * fart, vy: Math.sin(v) * fart, r: Math.random() * 6, vr: (Math.random() - .5) * 12, farge: PASTELL[i % 5], liv: 1.6 });
    }
  }

  function oppdaterKatt(k, t, dt) {
    const p = k.p;
    if (k.erVakt && !(p.status === "jobber" || p.status === "ferdig")) { k.paRunden = false; k.vaktFart = 0; }
    if (k.alfa < 1) k.alfa = Math.min(1, k.alfa + dt * 1.2);
    if (k.vakner) { if (t < k.vakner) return; k.vakner = 0; k.reis = 1; } // har strukket seg, og står
    if (k.inn) { // inn porten, hjem til lederen
      if (B.gaaTil(k, k.slot.x, k.slot.y, FART.inn, dt)) k.inn = false;
      etterSteg(k, t, dt, { skritt: true, staa: k.inn });
      return;
    }
    if (k.skalLegge) {
      if (REDUCED) { k.skalLegge = false; plantFortjent(k); }
      else if (k.erLeder || B.gaaTil(k, k.slot.x, k.slot.y, FART.legg, dt)) { k.skalLegge = false; k.strekkTil = t + 1.5; }
      else { etterSteg(k, t, dt, { staa: true }); return; }
    }
    if (k.strekkTil) {
      if (t < k.strekkTil) return;
      k.strekkTil = null; k.reis = 0; k.lop = false;
      konfettiFra(k.x, k.y - (k.erLeder ? 50 : 26));
      plantFortjent(k);
    }
    if (k.erLeder) { k.x = k.slot.x; k.y = k.slot.y; k.reis = 0; k.lop = false; return; }
    if (k.erVakt && (p.status === "jobber" || p.status === "ferdig")) {
      if (REDUCED) { k.x = PORT.x + 70; k.y = VAKTRUNDE.y1; k.flip = k.vend = -1; k.reis = 0; return; }
      // Tilbake på runden: fortsett fra punktet nærmest der vakta står (før: hopp på 679 px,
      // runde 7), og bygg opp farten i stedet for 0 → 40 px/s på ett bilde (runde 8).
      if (!k.paRunden) { k.vaktS = RUNDE.naermest(k.x, k.y); k.paRunden = true; }
      k.vaktFart = B.naermer(k.vaktFart || 0, VAKT_FART, dt * 80);
      k.vaktS += dt * k.vaktFart;
      const v = RUNDE.pos(k.vaktS);
      if (dt > 0) { k.vx = (v.x - k.x) / dt; k.vy = (v.y - k.y) / dt; }
      k.x = v.x; k.y = v.y;
      etterSteg(k, t, dt, { skritt: true, staa: true });
      return;
    }
    if (p.status === "jobber" && k.leke && !REDUCED) {
      B.lek(k, t, dt, Math.random); // garn: står og leker · sommerfugl: sitter og ser, lusker etter
      k.lop = k.reis > .5;
      return;
    }
    if (REDUCED) { k.x = k.slot.x; k.y = k.slot.y; k.reis = 0; k.lop = false; return; }
    // gå hjem til plassen og sett deg
    B.gaaTil(k, k.slot.x, k.slot.y, FART.hjem, dt);
    etterSteg(k, t, dt, {});
  }

  // ---------- tegning per bilde ----------

  const vaer = { sky: 0, regn: 0 };

  function tegnKattFigur(k, t) {
    const p = k.p, s = k.erLeder ? 1.75 : 1;
    if ((p.status === "ferdig" || k.skalLegge) && !k.erLeder && !k.erVakt && !k.ut) solflekk(k.slot.x, k.slot.y, s);
    if (p.status === "venter" && !k.ut) {
      // gullring på bakken: den som venter på deg skal synes først
      const puls = REDUCED ? 1 : .55 + Math.abs(Math.sin(t * 2.6)) * .45;
      ctx.save(); ctx.globalAlpha = puls; ctx.strokeStyle = "#E9B44C"; ctx.lineWidth = 3.5;
      ell(ctx, k.x, k.y, 30 * s, 10 * s, null); ctx.stroke();
      ell(ctx, k.x, k.y, 30 * s, 10 * s, "rgba(255,225,140,.25)");
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = k.alfa === undefined ? 1 : k.alfa;
    sistPose = "kurv";
    tegnKattKropp(k, t);
    k.pose = sistPose; // brukes av målekroken (?debug=1)
    ctx.restore();
    if (vaer.regn > .35 && p.status !== "tom") paraply(k, s, t);
    if (kanRyddes(k) && !k.lop) tegnKost(k.x + 30 * s, k.y + 2, s); // diskré: en liten kost ved siden av
  }

  // 🧹 Har sovet i over 30 min («done H:MM» i panen).
  const RYDDE_MIN = 30;
  function minSidenFerdig(k) {
    if (k.p.status !== "ferdig" || !k.p.ferdigKl) return null;
    return Math.max(0, Math.round((Date.now() - Date.parse(k.p.ferdigKl)) / 60000));
  }
  const kanRyddes = (k) => !k.erVakt && (minSidenFerdig(k) || 0) > RYDDE_MIN;
  function tegnKost(x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.rotate(.35);
    linje(ctx, [0, -30, 0, -8], "#B98F7A", 2.4);
    ctx.beginPath(); ctx.moveTo(-4, -9); ctx.lineTo(4, -9); ctx.lineTo(6, 0); ctx.lineTo(-6, 0); ctx.closePath();
    ctx.fillStyle = "#F3D58A"; ctx.fill(); ctx.strokeStyle = "#D9B25A"; ctx.lineWidth = 1; ctx.stroke();
    for (const bx of [-3, 0, 3]) linje(ctx, [bx, -7, bx * 1.3, -1], "#D9B25A", .8);
    ctx.restore();
  }

  function solflekk(x, y, s) {
    const m = morkeNaa;
    const dag = (1 - m) * (1 - vaer.sky * .85);
    const gr = ctx.createRadialGradient(x, y - 4, 2, x, y - 4, 40 * s);
    if (dag > .15) { gr.addColorStop(0, `rgba(255,236,160,${.6 * dag})`); gr.addColorStop(1, "rgba(255,236,160,0)"); }
    else { gr.addColorStop(0, `rgba(210,220,255,${.35 * m})`); gr.addColorStop(1, "rgba(210,220,255,0)"); }
    ctx.save(); ctx.fillStyle = gr; ctx.translate(x, y - 4); ctx.scale(1, .42);
    ctx.beginPath(); ctx.arc(0, 0, 40 * s, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  function paraply(k, s, t) {
    const sover = k.p.status === "ferdig" && !k.lop && !k.erVakt && !k.strekkTil;
    const r = (sover ? 22 : 18) * s, stang = (sover ? 40 : 30) * s;
    const x = k.x + (sover ? 2 : -4) * s * k.flip, topp = k.y - (sover ? 40 : 64) * s;
    const vipp = (REDUCED ? 0 : Math.sin(t * 1.3 + k.a.fase) * .05) + (sover ? .22 * k.flip : 0);
    ctx.save();
    ctx.globalAlpha = (k.alfa === undefined ? 1 : k.alfa) * .8 * clamp((vaer.regn - .35) / .3, 0, 1);
    ctx.translate(x, topp); ctx.rotate(vipp);
    linje(ctx, [0, -r * .5, 0, stang], "#6E5C78", 1.6 * s);
    ctx.beginPath(); ctx.arc(-3 * s, stang, 3 * s, 0, Math.PI); ctx.strokeStyle = "#6E5C78"; ctx.lineWidth = 1.6 * s; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.quadraticCurveTo(0, -r * 1.15, r, 0);
    for (let i = 0; i < 4; i++) { const x0 = r - i * r / 2; ctx.quadraticCurveTo(x0 - r / 4, -r * .2, x0 - r / 2, 0); }
    ctx.closePath(); ctx.fillStyle = k.a.pyntFarge; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r * .57); ctx.lineTo(-r * .5, 0); ctx.moveTo(0, -r * .57); ctx.lineTo(r * .5, 0); ctx.stroke();
    ell(ctx, 0, -r * .6, 2 * s, 2 * s, "#6E5C78");
    ctx.restore();
  }

  function tegnKattKropp(k, t) {
    const p = k.p, a = k.a;
    const s = k.erLeder ? 1.75 : 1;
    const o = {
      halsband: halsbandFor(p.konto),
      hatt: k.erLeder && p.kort === FESTLEDER ? "fest" : k.erVakt ? "vakt" : null,
      ivrig: p.status === "jobber",
    };
    if (p.status === "tom") { tegnKurv(ctx, k.x, k.y); return; }
    const vs = B.vendSkala(k.vend === undefined ? k.flip : k.vend); // vender seg på 0,16 s, ikke på ett bilde
    const m = { reis: k.reis === undefined ? 0 : k.reis, gang: k.gang || 0, fase: k.gangFase || 0, sving: k.sving || 0 };
    ctx.save(); ctx.translate(k.x, k.y); ctx.scale(s * vs, s);
    if (k.ut || k.inn) { poseKatt(ctx, a, t, o, m); ctx.restore(); return; }
    if (k.strekkTil || (k.vakner && t < k.vakner)) { poseStrekk(ctx, a, t, o); ctx.restore(); return; }
    if (k.erVakt && (p.status === "jobber" || p.status === "ferdig")) {
      poseKatt(ctx, a, t, o, m);
      // lykt i munnen (går) eller foran potene (sitter)
      const lx = lerp(20, 34, m.reis), ly = lerp(-18, -22, m.reis);
      linje(ctx, [lx - 6, ly - 10, lx, ly - 10, lx, ly - 4], "#6E5C78", 1.6);
      rrect(ctx, lx - 5, ly - 4, 10, 13, 3, "#8193CC");
      rrect(ctx, lx - 3.5, ly - 2, 7, 9, 2, "#FFE3A3");
      ctx.restore();
    } else if (p.status === "ferdig") {
      const sover = m.reis <= .02; // går hjem eller setter seg først, så krøller den seg sammen
      if (sover) poseSov(ctx, a, t, o); else poseKatt(ctx, a, t, o, m);
      ctx.restore();
    } else if (p.status === "venter") {
      poseKatt(ctx, a, t, Object.assign(o, { tilt: REDUCED ? .18 : .18 + Math.sin(t * 1.2 + a.fase) * .06 }), m);
      ctx.restore();
    } else { // jobber
      poseKatt(ctx, a, t, o, m);
      ctx.restore();
    }
  }

  function tegnLeke(k, t) {
    const l = k.leke;
    if (!l) return;
    if (REDUCED) { tegnGarn(ctx, k.slot.x + 26, k.slot.y, k.a.garnFarge, 0); return; }
    if (l.type === "garn") {
      // tråden som ruller etter
      ctx.beginPath(); ctx.moveTo(l.x, l.y);
      ctx.quadraticCurveTo(l.x - l.vx * .15, l.y + 8, l.x - l.vx * .3 - 10, l.y + 4);
      ctx.strokeStyle = k.a.garnFarge; ctx.lineWidth = 1.2; ctx.stroke();
      tegnGarn(ctx, l.x, l.y, k.a.garnFarge, l.rot);
    }
  }

  function zzz(x, y, t, fase, s) {
    ctx.save();
    ctx.font = `800 ${Math.round(11 * s)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (let i = 0; i < 3; i++) {
      const k = REDUCED ? i / 3 : ((t * .45 + fase + i / 3) % 1);
      const yy = y - k * 26 * s, xx = x + Math.sin(k * 6 + i) * 4 + i * 5 * s;
      ctx.globalAlpha = REDUCED ? .9 : Math.sin(k * Math.PI);
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,.9)";
      ctx.font = `800 ${Math.round((9 + k * 6) * s)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      ctx.strokeText("z", xx, yy); ctx.fillStyle = "#7A63A0"; ctx.fillText("z", xx, yy);
    }
    ctx.restore();
  }
  function sporsmal(x, y, t, s) {
    const hopp = REDUCED ? 0 : Math.sin(t * 3) * 2;
    const blink = REDUCED ? 1 : (Math.floor(t * 2.4) % 2 ? 1 : .55); // blinker — den trenger svar
    ctx.save(); ctx.globalAlpha = blink; ctx.translate(x, y + hopp); ctx.scale(s * 1.15, s * 1.15);
    ell(ctx, 0, 0, 11, 11, "#FFFFFF");
    ctx.beginPath(); ctx.moveTo(-4, 9); ctx.lineTo(-8, 15); ctx.lineTo(1, 10); ctx.fillStyle = "#FFFFFF"; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#E9B44C"; ell(ctx, 0, 0, 11, 11, null); ctx.stroke();
    ctx.font = '800 15px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#4A3B52"; ctx.fillText("?", 0, 1);
    ctx.restore();
  }
  function gnister(x, y, t, fase) {
    if (REDUCED) return;
    for (let i = 0; i < 3; i++) {
      const k = (t * .6 + fase + i / 3) % 1;
      const a = i * 2.1 + fase;
      const xx = x + Math.cos(a) * (26 + k * 10), yy = y + Math.sin(a) * 12 - k * 14;
      ctx.save(); ctx.globalAlpha = Math.sin(k * Math.PI); ctx.translate(xx, yy); ctx.rotate(k * 2);
      const r = 4;
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r * .3, -r * .3); ctx.lineTo(r, 0); ctx.lineTo(r * .3, r * .3);
      ctx.lineTo(0, r); ctx.lineTo(-r * .3, r * .3); ctx.lineTo(-r, 0); ctx.lineTo(-r * .3, -r * .3); ctx.closePath();
      ctx.fillStyle = "#FFE08A"; ctx.fill(); ctx.restore();
    }
  }
  let morkeNaa = 0;
  function lyktGlod(x, y, t) {
    const fl = effekt("lys") ? .92 + Math.sin(t * 9) * .04 + Math.sin(t * 13.7) * .04 : 1;
    const r = 70 * fl;
    const gr = ctx.createRadialGradient(x, y, 2, x, y, r);
    gr.addColorStop(0, `rgba(255,226,150,${.25 + morkeNaa * .45})`);
    gr.addColorStop(1, "rgba(255,226,150,0)");
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = gr;
    ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
    ell(ctx, x, y, 3.2, 4.2, "#FFF6D8");
  }

  // Pynten som lever: fuglebad, solur, flaggrekke, ballonger og røyk. Hver del har sin plass (bbox)
  // og sitt kjennetegn (sig), så rolig modus bare tegner den på nytt når noe annet går forbi.
  function pyntDeler(t, nr) {
    const ut = [], gy = PLASS.party, svai = effekt("svai");
    if (effekt("pynt")) ut.push({ id: "fuglebad", bbox: [FUGLEBAD.x - 28, FUGLEBAD.y - 10, FUGLEBAD.x + 28, FUGLEBAD.y + 8], sig: "f" + nr, d: () => {
      for (let i = 0; i < 2; i++) { // ringer i fuglebadet
        const k = (t * .35 + i * .5) % 1;
        ctx.globalAlpha = (1 - k) * .7; ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 1.2;
        ell(ctx, FUGLEBAD.x - 6 + i * 10, FUGLEBAD.y - 1, 4 + k * 14, (4 + k * 14) * .33, null); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } });
    // solurets skygge følger klokka
    const d = new Date(), tim = TID_OVERSTYRT !== null ? TID_OVERSTYRT : d.getHours() + d.getMinutes() / 60;
    const v = ((tim - 6) / 12) * Math.PI + Math.PI;
    ut.push({ id: "solur", bbox: [SOLUR.x - 30, SOLUR.y - 16, SOLUR.x + 30, SOLUR.y + 14], sig: String(Math.round(v * 100)), d: () => {
      linje(ctx, [SOLUR.x, SOLUR.y, SOLUR.x + Math.cos(v) * 24, SOLUR.y + Math.sin(v) * 9], "rgba(110,92,120,.55)", 2.4);
      ctx.beginPath(); ctx.moveTo(SOLUR.x - 1, SOLUR.y); ctx.lineTo(SOLUR.x + 7, SOLUR.y - 12); ctx.lineTo(SOLUR.x + 7, SOLUR.y);
      ctx.closePath(); ctx.fillStyle = "#C9B3A0"; ctx.fill();
    } });
    // flaggrekka i festhjørnet
    const ax = gy.x - 140, bx = 1200, ay = gy.y - 110;
    ut.push({ id: "flagg", bbox: [ax - 6, ay - 6, bx + 6, ay + 120], sig: svai ? "f" + nr : "0", d: () => {
      rrect(ctx, ax - 3, ay - 4, 6, 120, 3, "#FFFDF9"); rrect(ctx, bx - 3, ay - 4, 6, 120, 3, "#FFFDF9");
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) { const k = i / 20; const x = lerp(ax, bx, k), y = ay + Math.sin(k * Math.PI) * 26; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = "#B9A9C4"; ctx.lineWidth = 1.2; ctx.stroke();
      for (let i = 1; i < 12; i++) {
        const k = i / 12; const x = lerp(ax, bx, k), y = ay + Math.sin(k * Math.PI) * 26;
        const fl = svai ? Math.sin(t * 2.4 + i) * 2.2 : 0;
        ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.lineTo(x + fl, y + 15); ctx.closePath();
        ctx.fillStyle = PASTELL[i % 5]; ctx.fill();
      }
    } });
    ut.push({ id: "ballonger", bbox: [gy.x + 40, gy.y - 106, gy.x + 130, gy.y + 8], sig: svai ? "b" + nr : "0", d: () => {
      const ballonger = [[gy.x + 70, gy.y - 70, P.bla], [gy.x + 92, gy.y - 84, P.lavendel], [gy.x + 112, gy.y - 66, P.fersken]];
      ballonger.forEach(([x, y, f], i) => {
        const by = y + (svai ? Math.sin(t * 1.3 + i * 1.7) * 4 : 0), bxx = x + (svai ? Math.sin(t * .9 + i) * 2 : 0);
        ctx.beginPath(); ctx.moveTo(gy.x + 88, gy.y + 4); ctx.quadraticCurveTo(bxx - 4, by + 40, bxx, by + 16);
        ctx.strokeStyle = "rgba(110,92,120,.5)"; ctx.lineWidth = 1; ctx.stroke();
        ell(ctx, bxx, by, 12, 15, f); ell(ctx, bxx - 4, by - 6, 3, 4.5, "rgba(255,255,255,.6)", -.4);
        ctx.beginPath(); ctx.moveTo(bxx - 2.5, by + 16.5); ctx.lineTo(bxx + 2.5, by + 16.5); ctx.lineTo(bxx, by + 13.5); ctx.fillStyle = f; ctx.fill();
      });
    } });
    if (effekt("pynt")) ut.push({ id: "royk", bbox: [HUS.x + 25, HUS.y - 270, HUS.x + 81, HUS.y - 163], sig: "r" + nr, d: () => {
      for (let i = 0; i < 4; i++) { // røyk fra pipa
        const k = (t * .18 + i / 4) % 1;
        ctx.globalAlpha = (1 - k) * .55;
        ell(ctx, HUS.x + 53 + Math.sin(k * 5 + i) * 8, HUS.y - 176 - k * 70, 6 + k * 12, 5 + k * 10, "#FFFFFF");
      }
      ctx.globalAlpha = 1;
    } });
    return ut;
  }


  function tegnTre(x, y, t) {
    const sv = effekt("svai") ? Math.sin(t * .8 + x) * 1.5 : 0;
    ell(ctx, x, y + 2, 40, 9, "rgba(90,110,80,.2)");
    rrect(ctx, x - 7, y - 50, 14, 52, 6, "#C69A86");
    linje(ctx, [x, y - 34, x + 16, y - 52], "#C69A86", 6);
    const kl = [[0, -84, 34], [-26, -70, 24], [26, -70, 26], [-12, -100, 22], [16, -98, 22]];
    for (const [dx, dy, r] of kl) ell(ctx, x + dx + sv, y + dy, r, r * .9, "#FFC3E1");
    for (const [dx, dy, r] of kl) ell(ctx, x + dx + sv - r * .25, y + dy - r * .3, r * .55, r * .45, "#FFD9EC");
    const r = rng(x | 0);
    for (let i = 0; i < 9; i++) ell(ctx, x - 30 + r() * 60 + sv, y - 110 + r() * 50, 1.8, 1.8, "#F58FBF");
  }

  function oppdaterSommerfugl(b, t, dt) {
    if (b.sitter > 0) { b.sitter -= dt; return; }
    if (!b.mal || Math.random() < dt * .08) {
      if (Math.random() < .35 && blomster.length) { const f = blomster[Math.floor(Math.random() * blomster.length)]; b.mal = { x: f.x, y: f.y - f.h - 4, blomst: true }; }
      else b.mal = { x: 90 + Math.random() * (W - 180), y: 90 + Math.random() * (H - 180), blomst: false };
    }
    const dx = b.mal.x - b.x, dy = b.mal.y - b.y, d = Math.hypot(dx, dy);
    if (d < 3) { if (b.mal.blomst) b.sitter = 2 + Math.random() * 3; b.mal = null; return; }
    // Korteste vei rundt (før kunne den ta en hel ekstra sløyfe), og samme bevegelse på 60,
    // 120 og 144 Hz: vippingen var et fast tillegg per bilde, dobbelt så stor på 120 Hz.
    const dv = Math.atan2(Math.sin(Math.atan2(dy, dx) - b.a), Math.cos(Math.atan2(dy, dx) - b.a));
    b.a += dv * (1 - Math.exp(-dt * 2.2)) + Math.sin(t * 3 + b.fase) * dt * 1.8;
    b.x += Math.cos(b.a) * 46 * dt; b.y += Math.sin(b.a) * 46 * dt + Math.sin(t * 6 + b.fase) * 18 * dt;
  }

  // Kveldslyset: et slør over hele hagen, lys i vinduene og på kaka, og ildfluer. Sløret er likt
  // fra bilde til bilde (det endres med minuttene), så i rolig modus tegnes det bare der noe annet
  // er tegnet på nytt.
  function kveldsDeler(lys, t, nr) {
    const ut = [], [r, g, b, a] = lys.farge, m = lys.morke, flimrer = effekt("lys");
    if (a > .005) ut.push({ id: "slor", bbox: [0, 0, W, H], sig: "", d: () => { ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${a})`; ctx.fillRect(0, 0, W, H); } });
    if (m < .05) return ut;
    const lyst = (f) => () => { ctx.save(); ctx.globalCompositeOperation = "lighter"; f(); ctx.restore(); };
    ut.push({ id: "vinduer", bbox: [HUS.x - 112, HUS.y - 119, HUS.x + 112, HUS.y + 5], sig: "", d: lyst(() => {
      for (const wx of [HUS.x - 50, HUS.x + 50]) {
        const gr = ctx.createRadialGradient(wx, HUS.y - 57, 4, wx, HUS.y - 57, 60);
        gr.addColorStop(0, `rgba(255,214,140,${.5 * m})`); gr.addColorStop(1, "rgba(255,214,140,0)");
        ctx.fillStyle = gr; ctx.fillRect(wx - 60, HUS.y - 117, 120, 120);
        rrect(ctx, wx - 14, HUS.y - 69, 28, 24, 6, `rgba(255,200,120,${.55 * m})`);
      }
    }) });
    const fl = flimrer ? .8 + Math.sin(t * 11) * .2 : 1; // stearinlyset på kaka
    ut.push({ id: "kake", bbox: [KAKE.x - 32, KAKE.y - 82, KAKE.x + 32, KAKE.y - 18], sig: flimrer ? "k" + nr : "", d: () => {
      lyst(() => {
        const gk = ctx.createRadialGradient(KAKE.x, KAKE.y - 50, 1, KAKE.x, KAKE.y - 50, 30 * fl);
        gk.addColorStop(0, `rgba(255,210,130,${.6 * m})`); gk.addColorStop(1, "rgba(255,210,130,0)");
        ctx.fillStyle = gk; ctx.fillRect(KAKE.x - 30, KAKE.y - 80, 60, 60);
      })();
      ell(ctx, KAKE.x, KAKE.y - 50, 2.4 * fl, 4 * fl, "#FFD27A");
    } });
    const antall = !effekt("ildfluer") ? 0 : rolig ? 6 : ildfluer.length;
    for (let i = 0; i < antall; i++) {
      const f = ildfluer[i];
      const blink = REDUCED ? .6 : Math.max(0, Math.sin(t * 1.6 + f.fase));
      const x = f.x + (REDUCED ? 0 : Math.sin(t * .4 + f.fase) * 30), y = f.y + (REDUCED ? 0 : Math.cos(t * .3 + f.fase * 1.3) * 18);
      ut.push({ id: "if" + i, bbox: [x - 10, y - 10, x + 10, y + 10], sig: REDUCED ? "" : "i" + nr, d: lyst(() => {
        const gr = ctx.createRadialGradient(x, y, 0, x, y, 9);
        gr.addColorStop(0, `rgba(230,255,170,${.85 * blink * m})`); gr.addColorStop(1, "rgba(230,255,170,0)");
        ctx.fillStyle = gr; ctx.fillRect(x - 9, y - 9, 18, 18);
      }) });
    }
    return ut;
  }


  // ---------- scenen: alt som tegnes, med plass (bbox) og kjennetegn (sig) ----------
  // lag 0 pynt under alt · 1 dybdesortert (blomster, katter, leker, trær) · 2 kronblader og konfetti ·
  // 3 skyskygger · 4 sommerfugler · 5 kveldslys · 6 regn · 7 over lyset (zzz, ?, lykt, gnister).
  // bbox er i hagens koordinater og skal romme alt delen tegner, ellers blir det spor igjen.
  const r1 = (v) => Math.round(v * 10) / 10, r3 = (v) => Math.round(v * 1000) / 1000;
  const antallSommerfugler = () => (!effekt("sommerfugler") ? 0 : rolig ? 2 : sommerfugler.length);

  // Tiden kattens små bevegelser (hale, pust, zzz) går etter. I rolig modus står de stille når
  // katten står stille, og fortsetter der de slapp når den går igjen, så halen aldri hopper.
  // Den som venter på deg, beveger seg alltid: den skal synes.
  function katteTid(k, t, dt) {
    const tilstand = [r1(k.x), r1(k.y), r3(k.reis || 0), r3(k.vend === undefined ? k.flip : k.vend), r1(k.gangFase || 0), r3(k.sving || 0),
      r3(k.gang || 0), k.p.status, r3(k.alfa === undefined ? 1 : k.alfa), k.strekkTil ? 1 : 0, k.vakner && t < k.vakner ? 1 : 0,
      k.inn ? 1 : 0, k.ut ? 1 : 0, kanRyddes(k) ? 1 : 0, k.flip, k.erLeder ? 1 : 0].join();
    const beveger = tilstand !== k._tilstand;
    k._tilstand = tilstand;
    if (effekt("kattAnim") || k.p.status === "venter") { k.tAnim = t; return t; }
    k.tAnim = (k.tAnim === undefined ? t : k.tAnim) + (beveger ? dt : 0);
    return k.tAnim;
  }

  function kattOverlegg(k, ta, t) {
    const p = k.p, s = k.erLeder ? 1.75 : 1, ut = [];
    if (p.status === "tom" || k.ut || k.inn || k.strekkTil || (k.vakner && t < k.vakner)) return ut;
    const reis = k.reis === undefined ? 0 : k.reis;
    if (k.erVakt && (p.status === "jobber" || p.status === "ferdig")) {
      const vs = B.vendSkala(k.vend === undefined ? k.flip : k.vend);
      const wx = k.x + lerp(20, 34, reis) * vs, wy = k.y + lerp(-18, -22, reis) + 2.5;
      ut.push({ id: "lykt" + k.id, bbox: [wx - 74, wy - 74, wx + 74, wy + 74], sig: [r1(wx), r1(wy), effekt("lys") ? r3(ta) : ""].join(), d: () => lyktGlod(wx, wy, ta) });
    } else if (p.status === "ferdig") {
      if (reis <= .02) {
        const x = k.x + (k.erLeder ? 36 : 22) * k.flip, y = k.y - (k.erLeder ? 50 : 30);
        ut.push({ id: "zzz" + k.id, bbox: [x - 12, y - 50 * s, x + 32 * s, y + 8], sig: [r1(x), r1(y), r3(ta)].join(), d: () => zzz(x, y, ta, k.a.fase, s) });
      }
    } else if (p.status === "venter") {
      if (reis < .5) {
        const x = k.x + 30 * s * k.flip, y = k.y - 52 * s;
        ut.push({ id: "?" + k.id, bbox: [x - 17 * s, y - 18 * s, x + 17 * s, y + 21 * s], sig: [r1(x), r1(y), r3(ta)].join(), d: () => sporsmal(x, y, ta, s) });
      }
    } else if (p.status === "jobber" && k.erLeder) {
      ut.push({ id: "gnist" + k.id, bbox: [k.x - 44, k.y - 122, k.x + 44, k.y - 68], sig: String(r3(ta)), d: () => gnister(k.x, k.y - 88, ta, k.a.fase) });
    }
    return ut;
  }

  function byggScene(t, dt, lys, nr) {
    const sc = [];
    const legg = (id, lag, y, bbox, sig, d) => sc.push({ id, lag, y, bbox, sig, d });
    for (const d of pyntDeler(t, nr)) legg(d.id, 0, 0, d.bbox, d.sig, d.d);
    const svai = effekt("svai");
    blomster.forEach((b, i) => legg("b" + i, 1, b.y, [b.x - 10, b.y - b.h * 1.15 - 10, b.x + 10, b.y + 4], svai ? "s" + nr : String(r3(b.g)), () => tegnBlomst(ctx, b, t)));
    TRAER.forEach(([x, y], i) => legg("t" + i, 1, y, [x - 62, y - 126, x + 62, y + 12], svai ? "s" + nr : "", () => tegnTre(x, y, t)));
    for (const k of [...katter.values(), ...paVeiUt]) {
      const s = k.erLeder ? 1.75 : 1, ta = katteTid(k, t, dt), id = k.id + (k.ut ? "ut" : "");
      let bbox = [k.x - 52 * s, k.y - 95 * s, k.x + 52 * s, k.y + 24 * s];
      if ((k.p.status === "ferdig" || k.skalLegge) && !k.erLeder && !k.erVakt && !k.ut) // solflekken ligger på plassen, ikke ved katten
        bbox = T.union(bbox, [k.slot.x - 42 * s, k.slot.y - 24 * s, k.slot.x + 42 * s, k.slot.y + 14 * s]);
      legg("k" + id, 1, k.y, bbox, k._tilstand + "|" + r3(ta), () => tegnKattFigur(k, ta));
      for (const o of kattOverlegg(k, ta, t)) legg(o.id, 7, 0, o.bbox, o.sig, o.d);
      const l = k.leke;
      if (!l) continue;
      if (REDUCED) legg("l" + id, 1, k.slot.y, [k.slot.x + 16, k.slot.y - 9, k.slot.x + 36, k.slot.y + 12], "", () => tegnLeke(k, t));
      else if (l.type === "garn") {
        const hale = l.x - l.vx * .3 - 10;
        legg("l" + id, 1, l.y, [Math.min(l.x, hale) - 9, l.y - 9, Math.max(l.x, hale) + 9, l.y + 12], [r1(l.x), r1(l.y), r1(l.vx), r1(l.rot)].join(), () => tegnLeke(k, t));
      } else legg("l" + id, 7, 0, [l.x - 11, l.y - 52, l.x + 11, l.y - 20], "f" + nr, () => tegnSommerfugl(ctx, l.x, l.y - 34 - Math.sin(t * 2.3) * 6, t, k.a.garnFarge, k.a.fase));
    }
    for (const p of kronblader) legg("kb" + p.id, 2, 0, [p.x - 4, p.y - 4, p.x + 4, p.y + 4], "" + nr, () => {
      ctx.save(); ctx.globalAlpha = Math.min(1, p.liv); ell(ctx, p.x, p.y, 2.6, 1.6, "#FFB3D6", Math.sin(t * 3 + p.fase)); ctx.restore();
    });
    for (const c of konfetti) legg("kf" + c.id, 2, 0, [c.x - 5, c.y - 5, c.x + 5, c.y + 5], "" + nr, () => {
      ctx.save(); ctx.globalAlpha = Math.min(1, c.liv); ctx.translate(c.x, c.y); ctx.rotate(c.r);
      ctx.fillStyle = c.farge; ctx.fillRect(-3, -1.5, 6, 3); ctx.restore();
    });
    if (effekt("skyer") && vaer.sky >= .02) legg("skyer", 3, 0, [0, 0, W, H], "" + nr, () => tegnSkyskygger(t));
    const sfAlfa = (1 - lys.morke * .9) * (1 - vaer.regn);
    for (let i = 0; i < antallSommerfugler(); i++) {
      const b = sommerfugler[i];
      legg("sf" + i, 4, 0, [b.x - 11, b.y - 11, b.x + 11, b.y + 11], "" + nr, () => {
        ctx.save(); ctx.globalAlpha = sfAlfa; tegnSommerfugl(ctx, b.x, b.y, b.sitter > 0 ? t * .2 : t, b.farge, b.fase); ctx.restore();
      });
    }
    for (const d of kveldsDeler(lys, t, nr)) legg(d.id, 5, 0, d.bbox, d.sig, d.d);
    if (effekt("regn") && vaer.regn >= .02) legg("regn", 6, 0, [0, 0, W, H], "" + nr, () => tegnRegn(t));
    return sc;
  }

  // ---------- tegning: hele hagen, eller bare skitne rektangler ----------
  const forrigeScene = new Map(); // id → { sig, bbox } fra forrige tegnede bilde
  let heltNy = true, sisteMiljo = "", bildeNr = 0, sistT = 0, sistHelt = 0;
  const jsTid = { fra: 0, js: 0, n: 0 }; // tegnede bilder per sekund og JS-tid per bilde (målekroken)
  const maaling = { rekt: 0, andel: 1, helt: true, deler: 0 }; // målekroken (?debug=1): hvor mye som ble tegnet sist

  function tegnScene(scene, k) {
    const ordnet = scene.map((e, i) => Object.assign(e, { i })).sort((a, b) => a.lag - b.lag || (a.lag === 1 ? a.y - b.y : 0) || a.i - b.i);
    let rekt = null;
    if (rolig && !heltNy) {
      rekt = T.slaaSammen(T.skitne(forrigeScene, scene), 6);
      if (rekt.reduce((s, r) => s + T.areal(r), 0) > W * H * .5) rekt = null; // over halve hagen endret: tegn alt
    }
    if (!rekt) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(bg, 0, 0);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      for (const e of ordnet) e.d();
      Object.assign(maaling, { rekt: 1, andel: 1, helt: true, deler: ordnet.length });
    } else {
      let areal = 0, deler = 0;
      for (const r of rekt) {
        // Klipp på hele skjermpiksler (+2), så kantene verken får glipper eller dobbel kantutjevning.
        const x0 = Math.max(0, Math.floor(r[0] * k) - 2), y0 = Math.max(0, Math.floor(r[1] * k) - 2);
        const x1 = Math.min(cv.width, Math.ceil(r[2] * k) + 2), y1 = Math.min(cv.height, Math.ceil(r[3] * k) + 2);
        if (x1 <= x0 || y1 <= y0) continue;
        areal += (x1 - x0) * (y1 - y0);
        const verden = [x0 / k, y0 / k, x1 / k, y1 / k];
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
        ctx.drawImage(bg, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        for (const e of ordnet) if (T.overlapper(e.bbox, verden)) { e.d(); deler++; }
        ctx.restore();
      }
      Object.assign(maaling, { rekt: rekt.length, andel: areal / (cv.width * cv.height), helt: false, deler, rektListe: PARAM.has("debug") ? rekt : null });
    }
    heltNy = false;
    forrigeScene.clear();
    for (const e of scene) forrigeScene.set(e.id, { sig: e.sig, bbox: e.bbox });
  }

  // ---------- rolig modus, bildetak og etterslep ----------
  // Automatisk på når skjermen ikke er Retina, eller når bildene henger etter. Knappen overstyrer
  // (husket i nettleseren); ?rolig=1 / ?rolig=0 overstyrer uten å huske (brukes ved måling).
  const ROLIG_KEY = "spesialist-hagen-rolig";
  const roligParam = PARAM.get("rolig");
  let roligValg = roligParam === "1" ? "på" : roligParam === "0" ? "av" : (() => { const v = lagret.les(ROLIG_KEY); return v === "på" || v === "av" ? v : null; })();
  let henger = false, roligGrunn = "", hengerTeller = 0, besteTakt = null, sistSkjerm = "";
  let rafSist = 0, rafNr = 0, hvert = 1, sistSjekk = 0;
  const rafIntervaller = [];
  const ROLIG_OM = "færre effekter og 30 bilder i sekundet, så hagen går jevnt og maskinen får hvile";
  function oppdaterRolig() {
    const r = T.roligNaa(roligValg, window.devicePixelRatio || 1, henger);
    if (r.rolig !== rolig) heltNy = true;
    rolig = r.rolig; roligGrunn = r.grunn;
    hvert = T.bildeHvert(besteTakt, rolig ? 30 : 60);
    const b = $("roligknapp");
    if (!b) return;
    b.setAttribute("aria-pressed", String(rolig));
    b.textContent = rolig ? "🍃 Rolig på" : "✨ Rolig av";
    b.title = rolig
      ? (roligGrunn === "henger" ? `Rolig modus er på fordi bildene hang etter: ${ROLIG_OM}. Klikk for alle effektene.`
        : roligGrunn === "ikke-retina" ? `Rolig modus er på fordi skjermen ikke er Retina: ${ROLIG_OM}. Klikk for alle effektene.`
        : `Rolig modus er på (valgt av deg): ${ROLIG_OM}. Klikk for alle effektene.`)
      : `Alle effektene er på${roligGrunn === "valgt" ? " (valgt av deg)" : ""}. Klikk for rolig modus: færre effekter og 30 bilder i sekundet.`;
  }
  $("roligknapp").addEventListener("click", () => {
    roligValg = T.nyttValg(roligValg, window.devicePixelRatio || 1, henger);
    lagret.skriv(ROLIG_KEY, roligValg || "auto");
    oppdaterRolig();
  });
  // Hvert 2. sekund: skjermens takt (for bildetaket) og om bildene henger etter. Takten huskes per
  // skjerm, så en jevn 30 Hz-takt under last også oppdages, og et bytte fra 144 til 60 Hz ikke gjør det.
  function sjekkTakt() {
    const skjerm = screen.width + "x" + screen.height + "@" + window.devicePixelRatio;
    if (skjerm !== sistSkjerm) { sistSkjerm = skjerm; besteTakt = null; hengerTeller = 0; }
    const takt = T.takt(rafIntervaller);
    if (takt && (!besteTakt || takt < besteTakt)) besteTakt = takt;
    hvert = T.bildeHvert(besteTakt, rolig ? 30 : 60);
    hengerTeller = T.hengerEtter(rafIntervaller, besteTakt) ? hengerTeller + 1 : 0;
    if (hengerTeller >= 2 && !henger) {
      henger = true;
      const var_ = rolig;
      oppdaterRolig();
      if (rolig && !var_) beskjed("🍃 Bildene hang etter. Hagen bytter til rolig modus.");
    }
  }

  // ---------- hovedløkke ----------
  let sist = performance.now();
  let sistAlder = 0;
  let loopAktiv = false;
  function startLoop() {
    if (loopAktiv || kompakt) return;
    loopAktiv = true; sist = performance.now();
    requestAnimationFrame(bilde);
  }

  // Skyskygger og regn. Dempet med vilje: været er stemning, ikke status.
  const draper = [];
  for (let i = 0; i < 130; i++) draper.push({ x: Math.random(), y: Math.random(), l: 10 + Math.random() * 8 });
  function oppdaterVaer(dt) {
    const navn = vaerNaa().navn;
    const mal = { sky: navn === "sol" ? 0 : 1, regn: navn === "regn" ? 1 : 0 };
    const k = REDUCED ? 1 : Math.min(1, dt * .4);
    vaer.sky += (mal.sky - vaer.sky) * k; vaer.regn += (mal.regn - vaer.regn) * k;
  }
  function tegnSkyskygger(t) {
    if (vaer.sky < .02) return;
    ctx.fillStyle = `rgba(105,118,150,${.05 * vaer.sky + .04 * vaer.regn})`;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      const x = ((i * 420 + (REDUCED ? 0 : t * 12)) % (W + 700)) - 350, y = 140 + i * 160;
      ctx.globalAlpha = .05 * vaer.sky;
      ell(ctx, x, y, 220, 70, "#4E5A78"); ell(ctx, x + 120, y + 20, 160, 55, "#4E5A78");
    }
    ctx.globalAlpha = 1;
  }
  function tegnRegn(t) {
    if (vaer.regn < .02) return;
    ctx.save();
    ctx.strokeStyle = `rgba(235,242,255,${.55 * vaer.regn})`; ctx.lineWidth = 1.3; ctx.lineCap = "round";
    ctx.beginPath();
    for (const d of draper) {
      const y = ((d.y * (H + 40) + (REDUCED ? 0 : t * 520)) % (H + 40)) - 20;
      const x = (d.x * W + y * .22) % W;
      ctx.moveTo(x, y); ctx.lineTo(x - 3, y + d.l);
    }
    ctx.stroke();
    if (!REDUCED) { // små plask
      const r = rng(Math.floor(t * 5));
      ctx.strokeStyle = `rgba(235,242,255,${.45 * vaer.regn})`;
      for (let i = 0; i < 6; i++) { ell(ctx, 60 + r() * (W - 120), 80 + r() * (H - 140), 3 + r() * 4, 1.4 + r(), null); ctx.stroke(); }
    }
    ctx.restore();
  }

  function bilde(naa) {
    if (kompakt) { loopAktiv = false; return; } // kompakt tegner ingenting: lett å ha oppe hele dagen
    if (rafSist) { rafIntervaller.push(naa - rafSist); if (rafIntervaller.length > 120) rafIntervaller.shift(); }
    rafSist = naa;
    if (naa - sistSjekk > 2000) { sistSjekk = naa; sjekkTakt(); }
    // Bildetak med jevn rytme: hvert n-te bilde (60 fps vanlig, 30 fps i rolig modus).
    if (++rafNr % hvert !== 0) { requestAnimationFrame(bilde); return; }
    const dt = Math.min(.05, (naa - sist) / 1000);
    sist = naa;
    const t = naa / 1000;
    const jsStart = performance.now();
    const k = dpr * skala;
    const lys = lysNaa();
    morkeNaa = lys.morke;

    for (const katt of katter.values()) oppdaterKatt(katt, t, dt);
    for (let i = paVeiUt.length - 1; i >= 0; i--) { // ut gjennom porten, og borte
      const katt = paVeiUt[i];
      B.gaaTil(katt, PORT.x, PORT.y + 10, FART.ut, dt);
      etterSteg(katt, t, dt, { skritt: true, staa: true });
      if (Math.hypot(PORT.x - katt.x, PORT.y - katt.y) < 40) katt.alfa -= dt * 1.4;
      if (katt.alfa <= 0) paVeiUt.splice(i, 1);
    }
    for (let i = konfetti.length - 1; i >= 0; i--) {
      const c = konfetti[i];
      c.vy += 260 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt; c.liv -= dt;
      if (c.liv <= 0) konfetti.splice(i, 1);
    }
    oppdaterVaer(dt);
    for (const b of blomster) {
      if (b.g >= 1) continue;
      const start = b.fodt !== undefined ? b.fodt : startTid + b.forsinkelse;
      b.g = clamp((t - start) / .9, 0, 1);
    }
    for (let i = 0; i < antallSommerfugler(); i++) oppdaterSommerfugl(sommerfugler[i], t, dt);
    if (effekt("kronblader") && lys.morke < .5 && Math.random() < dt * 1.2) {
      const tr = TRAER[Math.floor(Math.random() * TRAER.length)];
      kronblader.push({ id: ++delNr, x: tr[0] - 30 + Math.random() * 60, y: tr[1] - 100, vy: 14 + Math.random() * 10, fase: Math.random() * 6, liv: 5 });
    }
    for (let i = kronblader.length - 1; i >= 0; i--) {
      const p = kronblader[i]; p.y += p.vy * dt; p.x += Math.sin(t * 2 + p.fase) * 18 * dt; p.liv -= dt;
      if (p.liv <= 0) kronblader.splice(i, 1);
    }

    // Bygg scenen og tegn den: hele hagen, eller i rolig modus bare det som har endret seg.
    const miljo = [lys.farge.map((v) => Math.round(v * 100)).join(), Math.round(lys.morke * 1000), Math.round(vaer.sky * 100), Math.round(vaer.regn * 100), rolig, k].join("|");
    if (miljo !== sisteMiljo) { sisteMiljo = miljo; heltNy = true; } // nytt lys eller vær: alt endres
    // Hvert 10. sekund tegnes alt likevel, så enkeltpiksler med litt ulik kantutjevning langs
    // kantene på rektanglene (målt: maks 18 px, 15/255 etter 20 s) aldri hoper seg opp.
    if (rolig && t - sistHelt > 10) { sistHelt = t; heltNy = true; }
    bildeNr++;
    sistT = t;
    tegnScene(byggScene(t, dt, lys, bildeNr), k);

    // navnelappene følger kattene, uten å ligge oppå hverandre
    const onsket = [];
    for (const [katt, el] of lappFor) {
      // Fast høyde per katt, uansett pose. Før gled lappen 26 px opp når katten våknet
      // (sover 40, sitter 66 — målt 06.10, runde 7).
      let hoyde = katt.p.status === "tom" ? 30 : katt.erLeder ? 116 : 66;
      if (vaer.regn > .35 && katt.p.status !== "tom") hoyde = Math.max(hoyde, 80 * (katt.erLeder ? 1.75 : 1)); // over paraplyen
      // vaktkatten går langs gjerdet: lappen henger under den, så den aldri skygger for lederne
      const prio = katt.p.status === "venter" ? 0 : katt.erLeder ? 1 : 2;
      // Lappen følger alltid katten, også når den leker (09.10: snakkeboblene hang ikke
      // helt med på kattene). Før sto lappen fast over lekeplassen mens katten løp
      // opptil 98 px unna (målt headless). Hoppingen mellom rader som fikk oss til å feste
      // den i runde 8, holdes nå nede av at lappen beholder plassen sin til hjemmeplassen
      // har vært ledig i 1,5 s.
      const anker = katt;
      const a = { el, id: katt.id, prio, anker: anker === katt ? "katt" : "slot", bx: anker.x, by: anker.y };
      if (katt.erVakt && katt.p.status !== "tom" && !REDUCED) onsket.push(Object.assign(a, { x: katt.x, y: katt.y + 34 }));
      else onsket.push(Object.assign(a, { x: anker.x, y: anker.y - hoyde - (anker === katt ? 0 : 8) }));
    }
    plasserAlleLapper(onsket, dt);
    plasserKort();
    if (t - sistAlder > 1) { sistAlder = t; sjekkAlder(); }
    jsTid.js += performance.now() - jsStart; jsTid.n++;
    if (naa - jsTid.fra > 2000) { maaling.tegnetPerSek = Math.round(jsTid.n / (naa - jsTid.fra) * 1000); maaling.jsMsPerBilde = Math.round(jsTid.js / jsTid.n * 100) / 100; Object.assign(jsTid, { fra: naa, js: 0, n: 0 }); }
    requestAnimationFrame(bilde);
  }

  // ---------- oppstart ----------
  const ro = new ResizeObserver(tilpass);
  ro.observe(wrap); ro.observe($("hage")); // hagen kan flytte seg uten å endre størrelse (nytt oppsett)
  // Flyttes vinduet til en skjerm med annen pikseltetthet, endres ikke størrelsen —
  // bare devicePixelRatio. Lytt på den også, så tegningen holder seg skarp.
  (function lyttPaDpr() {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener("change", () => { tilpass(); oppdaterRolig(); lyttPaDpr(); }, { once: true });
  })();
  tilpass();
  // Målekrok for feilsøking: ?debug=1 gir lesetilgang til kattene og lappene.
  if (PARAM.has("debug")) window.__hage = { katter, lappFor, paVeiUt, lydLogg, vaer, data: () => DATA, oppsett: () => oppsett, skala: () => skala,
    maaling: () => Object.assign({}, maaling), rolig: () => ({ rolig, roligGrunn, roligValg, henger, hvert, besteTakt }),
    tegnHelt: () => { heltNy = true; tegnScene(byggScene(sistT, 0, lysNaa(), bildeNr), dpr * skala); } };
  oppdaterRolig();
  settModus();
  hentData();
  setInterval(hentData, POLL_MS);
  startLoop();
})();
