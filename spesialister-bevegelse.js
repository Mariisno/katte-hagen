/* Spesialist-hagen — hvordan kattene beveger seg. Ren logikk uten DOM og canvas, så den
   kan testes i node (test/bevegelse.test.mjs) og brukes likt i nettleseren.

   Runde 8 (06.10), målt bilde for bilde i synlig Chrome mot ekte data: kattene som lekte,
   byttet mellom sitt og løp ~120 ganger i minuttet, og farten hoppet fra 0 til 55 px/s på
   ett bilde. Tegningen byttet fra sittende til løpende katt i samme øyeblikk. Det var
   glitchen som viste seg «når de beveger seg». Bilderaten var jevn (60, 120 og 144 Hz).
   Her er bevegelsen bygd som fart med akselerasjon og myk oppbremsing, minste tid per
   tilstand, bein som går i takt med strekningen, og overganger som glir. */
(function (ut) {
  "use strict";

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  // Eksponentiell utjevning som er lik på 60, 120 og 144 Hz: tau er tiden til 63 % av veien.
  const mot = (verdi, mal, dt, tau) => mal + (verdi - mal) * Math.exp(-dt / tau);
  // Gå mot en verdi med en fast største endring per sekund (lineær, aldri forbi).
  const naermer = (verdi, mal, maksSteg) => verdi + clamp(mal - verdi, -maksSteg, maksSteg);

  // ---------- fart: gå mot et punkt med akselerasjon og myk oppbremsing ----------
  // c = { maks px/s, aks px/s², brems px/s², stopp px, ventTil 0..1 }. Svarer avstanden igjen.
  // Ønsket fart er √(2·brems·s): den farten katten rekker å bremse ned fra før den er framme.
  // Farten endres aldri mer enn aks·dt (brems·dt) per bilde, så den kan ikke hoppe.
  function styr(k, mx, my, c, dt) {
    if (k.vx === undefined) { k.vx = 0; k.vy = 0; }
    const dx = mx - k.x, dy = my - k.y, d = Math.hypot(dx, dy);
    const rest = Math.max(0, d - (c.stopp || 0));
    // Planlegger med 80 % av bremsen, så den faktiske bremsen har slakk og katten aldri skyter over.
    const onsket = Math.min(c.maks, Math.sqrt(2 * c.brems * .8 * rest)) * (c.ventTil === undefined ? 1 : c.ventTil);
    const ox = d > 1e-9 ? dx / d * onsket : 0, oy = d > 1e-9 ? dy / d * onsket : 0;
    const ex = ox - k.vx, ey = oy - k.vy, e = Math.hypot(ex, ey);
    const grense = (onsket < Math.hypot(k.vx, k.vy) ? c.brems : c.aks) * dt;
    const f = e > grense ? grense / e : 1;
    k.vx += ex * f; k.vy += ey * f;
    let sx = k.vx * dt, sy = k.vy * dt;
    // Den siste lille biten tas eksakt, så katten ikke dirrer rundt målet. Bare når farten alt er
    // lav: en sperre som nullet farten uansett, stoppet katten fra 59 px/s på ett bilde (runde 8).
    if (Math.hypot(sx, sy) >= d && Math.hypot(k.vx, k.vy) <= Math.max(6, c.brems * dt)) { sx = dx; sy = dy; k.vx = 0; k.vy = 0; }
    k.x += sx; k.y += sy;
    return Math.hypot(mx - k.x, my - k.y);
  }
  // Gå til et punkt og stå der. Svarer true når katten er framme og har stoppet.
  function gaaTil(k, mx, my, c, dt) {
    const d = styr(k, mx, my, Object.assign({}, c, { stopp: 0 }), dt);
    if (d < .8 && Math.hypot(k.vx, k.vy) < 2) { k.x = mx; k.y = my; k.vx = 0; k.vy = 0; return true; }
    return false;
  }
  const fartAv = (k) => Math.hypot(k.vx || 0, k.vy || 0);

  // ---------- kroppen: sitt ↔ stå, skritt ↔ løp, og bein i takt med bakken ----------
  const REIS_OPP = .18, REIS_NED = .28; // sekunder for å reise seg og sette seg
  const SKRITT = 5.5, LOP = 7;          // beinsving i px. Fasen går strekning / sving, så foten står stille mot bakken
  function kropp(k, dt, valg) {
    const v = valg || {};
    const fart = fartAv(k);
    const opp = !!v.staa || fart > 3;
    if (k.reis === undefined) k.reis = opp ? 1 : 0;
    k.reis = v.straks ? (opp ? 1 : 0) : naermer(k.reis, opp ? 1 : 0, dt / (opp ? REIS_OPP : REIS_NED));
    k.gang = mot(k.gang === undefined ? 0 : k.gang, v.skritt ? 0 : clamp((fart - 35) / 45, 0, 1), dt, .25);
    k.sving = mot(k.sving === undefined ? 0 : k.sving, clamp(fart / 14, 0, 1), dt, .08); // bein rett ned når den står stille
    k.gangFase = (k.gangFase || 0) + fart * dt / lerp(SKRITT, LOP, k.gang);
  }
  // Hvor langt opp katten er kommet, som andel av full fart: den går ikke før den står.
  const klar = (k) => clamp(((k.reis === undefined ? 1 : k.reis) - .35) / .65, 0, 1);

  // ---------- snu: bare når retningen er tydelig, maks hver 0,5 s, og vendingen tar 0,16 s ----------
  const VEND_TID = .16, MIN_SNU = .5;
  function vend(k, retning, t, dt) {
    if (k.flip === undefined) k.flip = 1;
    if (retning && retning !== k.flip && t - (k.snuddT === undefined ? -Infinity : k.snuddT) >= MIN_SNU) { k.flip = retning; k.snuddT = t; }
    k.vend = naermer(k.vend === undefined ? k.flip : k.vend, k.flip, dt / VEND_TID);
  }
  // Skala i x for tegningen: smal katt midt i vendingen, aldri null (da ville den blinket bort).
  const vendSkala = (v) => (v >= 0 ? 1 : -1) * (.3 + .7 * Math.min(1, Math.abs(v)));
  // Retning ut fra farten (går) eller fra et punkt den ser på (sitter).
  function retningFor(k, seX) {
    if (Math.abs(k.vx || 0) > 14) return k.vx > 0 ? 1 : -1;
    if (fartAv(k) < 6 && seX !== undefined && Math.abs(seX - k.x) > 12) return seX > k.x ? 1 : -1;
    return 0;
  }

  // ---------- lek ----------
  // Garn: katten står og leker, slår til nøstet og jager det, og setter seg for å hvile etter noen slag.
  // Sommerfugl: katten sitter og ser på, og lusker bort til et nytt sted når den har flydd langt nok.
  const LEK = {
    garn: { start: 20, foran: 16, maks: 95, aks: 300, brems: 360, stopp: 1.5, slagFra: 3, slagTil: 6, hvilFra: 2.2, hvilTil: 4, minSlag: .35 },
    sommerfugl: { start: 28, minSitt: 2.5, minGaa: .6, maks: 50, aks: 150, brems: 190, stopp: 1.5, sikt: 45 },
  };

  function lekeSteg(l, slot, t, dt, fase) {
    if (l.type === "garn") {
      l.x += l.vx * dt; l.y += l.vy * dt;
      const fr = Math.pow(.25, dt); l.vx *= fr; l.vy *= fr;
      l.rot += (Math.abs(l.vx) + Math.abs(l.vy)) * dt * .05;
      const dx = l.x - slot.x, dy = (l.y - slot.y) * 1.6, d = Math.hypot(dx, dy);
      if (d > 40) { l.vx -= dx * 3 * dt; l.vy -= dy * 3 * dt; } // lekeområdet holdes mindre enn avstanden til naboen
    } else {
      l.x = slot.x + Math.sin(t * .7 + fase) * 30;
      l.y = slot.y + Math.sin(t * 1.1 + fase * 2) * 14;
    }
  }

  // Ett steg lek. rnd = tilfeldighet (Math.random i nettleseren, fast frø i testene).
  function lek(k, t, dt, rnd) {
    const l = k.leke, c = LEK[l.type];
    lekeSteg(l, k.slot, t, dt, k.a ? k.a.fase : 0);
    if (!k.lekT) { k.lekT = l.type === "garn" ? "jag" : "sitt"; k.lekFra = t; k.slag = 0; k.slagFor = c.slagFra; }
    const tid = t - k.lekFra;
    if (l.type === "garn") {
      const ux = l.x - k.x, uy = l.y - k.y, ud = Math.hypot(ux, uy) || 1;
      if (k.lekT === "jag") {
        // Stå foran nøstet, ikke oppå det. Er den alt så nær, blir den stående (aldri rygge).
        const naer = ud < c.foran + 4;
        const mx = naer ? k.x : l.x - ux / ud * c.foran, my = naer ? k.y : l.y - uy / ud * c.foran;
        styr(k, mx, my, Object.assign({}, c, { ventTil: klar(k) }), dt);
        // Nøstet ligger stille foran potene: slå til det, eller sett deg og hvil etter noen slag.
        const stille = Math.hypot(l.vx, l.vy) < 30 && Math.hypot(l.x - k.x, l.y - k.y) < 22 && fartAv(k) < 25;
        if (stille && t - (k.slagT === undefined ? -Infinity : k.slagT) > c.minSlag) {
          if (k.slag >= k.slagFor) { k.lekT = "hvil"; k.lekFra = t; k.hvil = lerp(c.hvilFra, c.hvilTil, rnd()); }
          else {
            const v = (k.flip > 0 ? 0 : Math.PI) + (rnd() - .5) * 1.6, kraft = 110 + rnd() * 90;
            l.vx = Math.cos(v) * kraft; l.vy = Math.sin(v) * kraft * .6;
            k.slag++; k.slagT = t;
          }
        }
        kropp(k, dt, { staa: k.lekT === "jag" });
        vend(k, retningFor(k, l.x), t, dt);
      } else {
        styr(k, k.x, k.y, c, dt); // bremser ned om den fortsatt har fart
        kropp(k, dt, { staa: false });
        vend(k, retningFor(k, l.x), t, dt);
        if (tid >= k.hvil) { k.lekT = "jag"; k.lekFra = t; k.slag = 0; k.slagFor = Math.round(lerp(c.slagFra, c.slagTil, rnd())); }
      }
      return;
    }
    // sommerfugl
    if (k.lekT === "sitt") {
      styr(k, k.x, k.y, c, dt);
      if (Math.hypot(l.x - k.x, l.y - k.y) > c.start && tid >= c.minSitt) {
        k.lekT = "gaa"; k.lekFra = t; k.mal = { x: l.x, y: l.y }; k.siktT = t;
      }
      kropp(k, dt, { staa: false });
      vend(k, retningFor(k, l.x), t, dt);
    } else {
      // sikt på nytt bare når sommerfuglen er langt fra målet, og maks hvert 0,8 s
      if (Math.hypot(l.x - k.mal.x, l.y - k.mal.y) > c.sikt && t - k.siktT > .8) { k.mal = { x: l.x, y: l.y }; k.siktT = t; }
      const d = styr(k, k.mal.x, k.mal.y, Object.assign({}, c, { ventTil: klar(k) }), dt);
      if (d < c.stopp + 2 && fartAv(k) < 4 && tid >= c.minGaa) { k.lekT = "sitt"; k.lekFra = t; }
      kropp(k, dt, { staa: k.lekT === "gaa" });
      vend(k, retningFor(k, l.x), t, dt);
    }
  }

  // ---------- vaktrunden: rektangel med runde hjørner, så vakta svinger i stedet for å knekke ----------
  function lagVaktRunde(r, R) {
    const bw = r.x1 - r.x0 - 2 * R, bh = r.y1 - r.y0 - 2 * R, bue = Math.PI * R / 2;
    const deler = [
      { l: bw, p: (s) => ({ x: r.x0 + R + s, y: r.y0 }) },
      { l: bue, p: (s) => ({ x: r.x1 - R + Math.cos(-Math.PI / 2 + s / R) * R, y: r.y0 + R + Math.sin(-Math.PI / 2 + s / R) * R }) },
      { l: bh, p: (s) => ({ x: r.x1, y: r.y0 + R + s }) },
      { l: bue, p: (s) => ({ x: r.x1 - R + Math.cos(s / R) * R, y: r.y1 - R + Math.sin(s / R) * R }) },
      { l: bw, p: (s) => ({ x: r.x1 - R - s, y: r.y1 }) },
      { l: bue, p: (s) => ({ x: r.x0 + R + Math.cos(Math.PI / 2 + s / R) * R, y: r.y1 - R + Math.sin(Math.PI / 2 + s / R) * R }) },
      { l: bh, p: (s) => ({ x: r.x0, y: r.y1 - R - s }) },
      { l: bue, p: (s) => ({ x: r.x0 + R + Math.cos(Math.PI + s / R) * R, y: r.y0 + R + Math.sin(Math.PI + s / R) * R }) },
    ];
    const omkrets = deler.reduce((s, d) => s + d.l, 0);
    function pos(s) {
      s = ((s % omkrets) + omkrets) % omkrets;
      for (const d of deler) { if (s <= d.l) return d.p(s); s -= d.l; }
      return deler[0].p(0);
    }
    // Punktet på runden nærmest (x, y), som strekning s. Grovt søk, så finere rundt det beste.
    function naermest(x, y) {
      let best = 0, bd = Infinity;
      for (let s = 0; s < omkrets; s += 4) { const p = pos(s), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = s; } }
      for (let s = best - 4; s <= best + 4; s += .25) { const p = pos(s), d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = s; } }
      return ((best % omkrets) + omkrets) % omkrets;
    }
    return { pos, naermest, omkrets };
  }

  // ---------- navnelappen: følger ankeret eksakt, bare sprang glir ----------
  // Ankeret (katten, eller lekeplassen) følges uten forsinkelse, så lapp og katt aldri danser
  // mot hverandre. Forskyvningen (en ledig plass over en annen lapp, nytt anker) glir med tau.
  const LAPP_TAU = .09;
  function lappSteg(s, anker, bx, by, offX, offY, dt, umiddelbart) {
    if (s.vis && s.anker !== anker) { s.ox = s.vis.x - bx; s.oy = s.vis.y - by; } // nytt anker: start der lappen står
    if (s.ox === undefined || umiddelbart) { s.ox = offX; s.oy = offY; }
    else {
      s.ox = mot(s.ox, offX, dt, LAPP_TAU); s.oy = mot(s.oy, offY, dt, LAPP_TAU);
      if (Math.abs(s.ox - offX) < .05) s.ox = offX;
      if (Math.abs(s.oy - offY) < .05) s.oy = offY;
    }
    s.anker = anker;
    s.vis = { x: bx + s.ox, y: by + s.oy };
    return s.vis;
  }

  Object.assign(ut, { clamp, lerp, mot, naermer, styr, gaaTil, fartAv, kropp, klar, vend, vendSkala, retningFor,
    LEK, lekeSteg, lek, lagVaktRunde, lappSteg, REIS_OPP, REIS_NED, SKRITT, LOP, VEND_TID, MIN_SNU, LAPP_TAU });
})(typeof module === "object" && module.exports ? module.exports : (globalThis.HageBevegelse = {}));
