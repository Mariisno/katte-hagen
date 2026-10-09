// Hopp til panen: en liten tjener på 127.0.0.1 som henter fram panen til en katt.
// Sikkerhet: bare 127.0.0.1, sjekk av Host og Origin, et tilfeldig token som bare ligger
// i den lokale datafila, og bare pane-id-er som finnes i tmux akkurat nå. Ingen
// vilkårlige kommandoer, og ingen taster sendes — bare et nytt terminalvindu med tmux.
import { createServer } from "node:http";
import { execFileSync, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

function tmux(args) {
  return execFileSync("tmux", ["-u", ...args], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "pipe"] });
}

export const gyldigPaneId = (id) => typeof id === "string" && /^%\d{1,6}$/.test(id);

// Siden åpnes fra file:// (Origin «null») eller fra localhost under testing.
export function tillattOpphav(origin) {
  if (origin === undefined || origin === "null") return true;
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

// Planen for et hopp: et NYTT terminalvindu (standard Ghostty) med en gruppert tmux-økt.
// Gruppert økt = egne «gjeldende vindu»-valg, så vinduene du alt har, flyttes ikke.
// destroy-unattached rydder bort den grupperte økta når vinduet lukkes.
// Skilt ut som rene argumenter, så den kan testes uten å åpne noe.
export function planForHopp(pane, paneOkt, tmuxSti = "tmux", terminal = "Ghostty") {
  return ["-na", terminal, "--args", "-e", tmuxSti,
    "new-session", "-t", paneOkt, ";",
    "set-option", "destroy-unattached", "on", ";",
    "select-window", "-t", pane, ";",
    "select-pane", "-t", pane];
}

// Terminalen kjører kommandoen uten Homebrew i PATH — finn tmux med full sti.
export function finnTmux() {
  for (const k of ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"]) {
    try { execFileSync(k, ["-V"], { stdio: "ignore", timeout: 2000 }); return k; } catch { /* prøv neste */ }
  }
  return "tmux";
}

export function startHoppTjener({ port = 8853, terminal = "Ghostty", torrkjoring = false } = {}) {
  const token = randomBytes(18).toString("hex");
  const tmuxSti = finnTmux();
  const svar = (res, kode, data, origin) => {
    const hoder = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    if (tillattOpphav(origin)) {
      hoder["Access-Control-Allow-Origin"] = origin || "null";
      hoder["Access-Control-Allow-Headers"] = "Content-Type, X-Kattehage-Token";
      hoder["Access-Control-Allow-Methods"] = "POST, OPTIONS";
      hoder["Vary"] = "Origin";
    }
    res.writeHead(kode, hoder);
    res.end(kode === 204 ? undefined : JSON.stringify(data));
  };
  const tjener = createServer((req, res) => {
    const origin = req.headers.origin;
    // DNS-rebinding: bare forespørsler som faktisk er adressert til 127.0.0.1 eller localhost.
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || "")) return svar(res, 403, { ok: false, melding: "feil vert" });
    if (!tillattOpphav(origin)) return svar(res, 403, { ok: false, melding: "feil opphav" });
    if (req.method === "OPTIONS") return svar(res, 204, {}, origin);
    if (req.method !== "POST" || req.url !== "/hopp") return svar(res, 404, { ok: false, melding: "ukjent" }, origin);
    if (req.headers["x-kattehage-token"] !== token) return svar(res, 403, { ok: false, melding: "mangler token" }, origin);
    let kropp = "";
    req.on("data", (d) => { kropp += d; if (kropp.length > 512) req.destroy(); });
    req.on("end", () => {
      let pane;
      try { pane = JSON.parse(kropp).pane; } catch { return svar(res, 400, { ok: false, melding: "ugyldig" }, origin); }
      if (!gyldigPaneId(pane)) return svar(res, 400, { ok: false, melding: "ugyldig pane-id" }, origin);
      try {
        // Bare pane-id-er fra dagens liste.
        const rader = tmux(["list-panes", "-a", "-F", "#{pane_id}|#{session_name}"]).split("\n").filter(Boolean);
        const treff = rader.map((r) => r.split("|")).find(([id]) => id === pane);
        if (!treff) return svar(res, 404, { ok: false, melding: "panen finnes ikke lenger" }, origin);
        const plan = planForHopp(pane, treff[1], tmuxSti, terminal);
        if (torrkjoring) return svar(res, 200, { ok: true, torrkjoring: true, plan: ["open", ...plan] }, origin);
        execFile("open", plan, { timeout: 5000 }, () => {});
        return svar(res, 200, { ok: true, okt: treff[1] }, origin);
      } catch (e) {
        return svar(res, 500, { ok: false, melding: "tmux svarte ikke" }, origin);
      }
    });
  });
  tjener.on("error", (e) => console.error(`${new Date().toLocaleString("nb-NO")} ⚠️  hopp-tjeneren startet ikke: ${e.code || e.message}`));
  tjener.listen(port, "127.0.0.1");
  return { port, token, tjener };
}
