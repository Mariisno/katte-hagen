// Tester for oppsettet (hage.config.json) og for at konto og kvote følger det.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lagConfig, forSiden, STANDARD } from "../lib/config.mjs";
import { lesFot, lesKvote } from "../spesialister.mjs";

test("eksempelfila er gyldig og lik standarden", () => {
  const eks = JSON.parse(readFileSync(new URL("../hage.config.example.json", import.meta.url), "utf8"));
  const { config, feil } = lagConfig(eks);
  assert.deepEqual(feil, []);
  assert.deepEqual(config.leaders, STANDARD.leaders);
  assert.deepEqual(config.accounts, STANDARD.accounts);
});

test("tomt oppsett gir standarden, uten feil", () => {
  const { config, feil } = lagConfig({});
  assert.deepEqual(feil, []);
  assert.equal(config.leaders.length, 4);
  assert.equal(config.quota.enabled, false, "været er av som standard");
});

test("ugyldige felt hoppes over og nevnes, de gyldige brukes", () => {
  const { config, feil } = lagConfig({
    leaders: [{ name: "ONE", spot: "house" }, { name: "TWO", spot: "house" }, { name: "", spot: "party" }, { name: "THREE", spot: "moon" }],
    accounts: [{ label: "Job", match: "(" }, { label: "Home", match: "\\bHOME\\b", collar: "crown" }],
    nameOption: "navn; rm -rf",
    intervalSeconds: 0,
    hopPort: 80,
  });
  assert.deepEqual(config.leaders.map((l) => l.name), ["ONE"], "én per plass, kjente plasser, ikke tomme navn");
  assert.equal(config.leaders[0].short, "ONE", "kortnavn faller tilbake på navnet");
  assert.deepEqual(config.accounts.map((a) => a.label), ["Home"]);
  assert.equal(config.nameOption, "@name");
  assert.equal(config.intervalSeconds, 10);
  assert.equal(config.hopPort, 8853);
  assert.ok(feil.length >= 6, feil.join(" | "));
});

test("siden får bare det den trenger — ingen regulære uttrykk eller terminal", () => {
  const s = forSiden(lagConfig({}).config);
  assert.deepEqual(Object.keys(s).sort(), ["accounts", "leaders", "quota", "watchCat"]);
  assert.ok(s.accounts.every((a) => !("match" in a)));
});

test("kontoen leses fra statuslinja etter accounts; uten treff er den ukjent", () => {
  const kontoer = [{ label: "Work", re: /\bWORK\b/ }, { label: "Personal", re: /\bPERSONAL\b/ }];
  assert.deepEqual(lesFot(["  dev  Opus 5.5 · high  PERSONAL"], kontoer), { modell: "Opus 5.5 · high", konto: "Personal" });
  assert.deepEqual(lesFot(["  dev  Sonnet 5.5 · medium"], kontoer), { modell: "Sonnet 5.5 · medium", konto: null });
  assert.deepEqual(lesFot(["ingen fot her"], kontoer), { modell: null, konto: null });
  assert.equal(lesFot(["  Opus 5.5 · high  WORK"], []).konto, null, "ingen kontoer i oppsettet");
});

test("kvoten kan slås av, og et eget mønster kan brukes", () => {
  assert.equal(lesKvote(["  5h ●●●○○○○○○○ 31%"], null), null, "av");
  assert.deepEqual(lesKvote(["  usage 77% of 5h"], /usage (\d+)%/), { pst: 77, nullstillesMin: null });
});
