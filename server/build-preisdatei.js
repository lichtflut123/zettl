#!/usr/bin/env node
// =====================================================================
// Erzeugt preise.json für die Zettl-App – die Datei, die neben der App liegt.
// Damit braucht ihr keinen Server: die App lädt sie und sucht darin selbst.
//
// Aufruf:
//   node build-preisdatei.js [optionen]
//
// Optionen:
//   --aus=/pfad/preise.json      Zieldatei (Standard: ./preise.json)
//   --dump=/pfad/canonical.json  fertiger heisse-preise-Datensatz (Billa, Spar …)
//   --repo=/pfad/heissepreise    eigener heisse-preise-Ordner für frische Abrufe
//   --live=hofer,dm              welche Ketten frisch abgerufen werden (mit --repo)
//   --tage=45                    Ketten aus dem Datensatz überspringen, die stillstehen
//
// Ohne --dump lädt das Skript den veröffentlichten Datensatz selbst herunter.
// =====================================================================
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const opt = {};
process.argv.slice(2).forEach((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) opt[m[1]] = m[2] === undefined ? true : m[2];
});
const AUS = opt.aus || path.join(process.cwd(), "preise.json");
const TAGE = parseInt(opt.tage || "45", 10);
const LIVE = (opt.live ? String(opt.live).split(",") : ["hofer", "dm"]).map((s) => s.trim());
const SPIEGEL = "https://github.com/falknerdominik/heisse-preise-data/releases/latest/download/latest-canonical.tar.gz";
const UA = "Zettl-Haushalt/1.0 (privater Haushalt)";
const HEUTE = new Date().toISOString().slice(0, 10);

const KETTEN = { billa: "Billa", spar: "Spar", hofer: "Hofer", dm: "dm", mpreis: "MPREIS",
  unimarkt: "Unimarkt", bipa: "BIPA", mueller: "Müller", lidl: "Lidl", penny: "Penny" };

// "2000 g" liest sich schlecht – daraus wird "2 kg"
function menge(q, unit) {
  if (q == null || !unit) return null;
  let z = Number(q), e = String(unit).toLowerCase();
  if (isNaN(z) || z <= 0) return null;
  if (e === "g" && z >= 1000) { z /= 1000; e = "kg"; }
  else if (e === "ml" && z >= 1000) { z /= 1000; e = "l"; }
  const zahl = Number.isInteger(z) ? String(z) : String(Math.round(z * 100) / 100).replace(".", ",");
  return zahl + " " + e;
}
function istAktion(it) {
  const h = it.priceHistory;
  if (!Array.isArray(h) || h.length < 2) return false;
  return typeof h[0].price === "number" && typeof h[1].price === "number" && h[0].price < h[1].price * 0.95;
}

async function ladeDump() {
  if (opt.dump) return String(opt.dump);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zettl-"));
  const tar = path.join(tmp, "hp.tar.gz");
  process.stdout.write("Lade veröffentlichten Datensatz … ");
  const res = await fetch(SPIEGEL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  fs.writeFileSync(tar, Buffer.from(await res.arrayBuffer()));
  console.log((fs.statSync(tar).size / 1048576).toFixed(1) + " MB");
  execFileSync("tar", ["-xzf", tar, "-C", tmp]);
  return path.join(tmp, fs.readdirSync(tmp).find((f) => f.endsWith(".json")));
}

(async () => {
  const artikel = [];
  const zaehler = {};
  const push = (name, preis, laden, einheit, aktion) => {
    if (!name || typeof preis !== "number" || !(preis > 0)) return;
    artikel.push([String(name).replace(/\s+/g, " ").trim(), Math.round(preis * 100) / 100, laden, einheit || null, aktion ? 1 : 0]);
    zaehler[laden] = (zaehler[laden] || 0) + 1;
  };

  // ---- 1. Ketten aus dem veröffentlichten Datensatz
  const dumpPfad = await ladeDump();
  const roh = JSON.parse(fs.readFileSync(dumpPfad, "utf8"));
  const items = Array.isArray(roh) ? roh : roh.items || [];
  console.log(items.length.toLocaleString("de-AT") + " Einträge gelesen");

  const juengste = {}, flagLos = {}, gesamt = {};
  for (const it of items) {
    if (!KETTEN[it.store]) continue;
    gesamt[it.store] = (gesamt[it.store] || 0) + 1;
    if (!it.unavailable) flagLos[it.store] = true;
    const d = Array.isArray(it.priceHistory) && it.priceHistory[0] && it.priceHistory[0].date;
    if (d && (!juengste[it.store] || d > juengste[it.store])) juengste[it.store] = d;
  }
  const grenze = new Date(Date.now() - TAGE * 86400000).toISOString().slice(0, 10);
  const frisch = Object.keys(gesamt).filter((s) => juengste[s] && juengste[s] >= grenze && LIVE.indexOf(s) < 0);
  console.log("Aus dem Datensatz: " + frisch.map((s) => KETTEN[s]).join(", "));
  const uebersprungen = Object.keys(gesamt).filter((s) => frisch.indexOf(s) < 0 && LIVE.indexOf(s) < 0);
  if (uebersprungen.length) console.log("Übersprungen (Erfassung steht still): "
    + uebersprungen.map((s) => KETTEN[s] + " " + (juengste[s] || "?")).join(", "));

  for (const it of items) {
    if (frisch.indexOf(it.store) < 0) continue;
    if (it.unavailable && flagLos[it.store]) continue;
    push(it.name, it.price, KETTEN[it.store], menge(it.quantity, it.unit), istAktion(it));
  }

  // ---- 2. Ketten frisch abrufen (braucht einen heisse-preise-Ordner)
  if (opt.repo) {
    for (const s of LIVE) {
      const modul = path.join(String(opt.repo), "stores", s + ".js");
      if (!fs.existsSync(modul)) { console.log("  " + s + ": kein Abrufer gefunden"); continue; }
      try {
        process.stdout.write("Rufe " + KETTEN[s] + " frisch ab … ");
        const store = require(modul);
        const roh2 = await store.fetchData();
        const k = roh2.map((i) => store.getCanonical(i, HEUTE)).filter(Boolean);
        k.forEach((p) => push(p.name, p.price, KETTEN[s], menge(p.quantity, p.unit), false));
        console.log(k.length.toLocaleString("de-AT") + " Produkte");
      } catch (e) { console.log("fehlgeschlagen: " + e.message); }
    }
  } else if (LIVE.length) {
    console.log("Hinweis: ohne --repo werden " + LIVE.map((s) => KETTEN[s]).join(", ") + " nicht frisch abgerufen.");
  }

  const datei = { stand: HEUTE, quelle: "heisse-preise.io und eigene Abrufe", artikel };
  fs.writeFileSync(AUS, JSON.stringify(datei));
  console.log("\nGeschrieben: " + AUS + " (" + (fs.statSync(AUS).size / 1048576).toFixed(1) + " MB)");
  Object.keys(zaehler).sort((a, b) => zaehler[b] - zaehler[a])
    .forEach((k) => console.log("  " + k + ": " + zaehler[k].toLocaleString("de-AT")));
  console.log("  Aktionen: " + artikel.filter((a) => a[4]).length.toLocaleString("de-AT"));
  console.log("\nDatei neben die App legen (gleicher Ordner wie index.html) – fertig.");
})().catch((e) => { console.error("Abgebrochen:", e.message); process.exit(1); });
