#!/usr/bin/env node
// =====================================================================
// Zettl – Import aus dem heisse-preise-Datensatz
//
// heisse-preise.io ist ein offenes Projekt (MIT), das die Preise großer
// österreichischer Ketten sammelt und den fertigen Datensatz veröffentlicht.
// Wir laden nur diesen fertigen Datensatz – wir fragen keine Händlerseite an.
//
// Bezogen wird bevorzugt der GitHub-Spiegel (rund 18 MB gepackt), weil das den
// Server des Projekts schont. Fällt er aus, geht es direkt über heisse-preise.io.
//
// Aufruf:
//   node import-heissepreise.js <server-url> <import-token> [optionen]
//
// Optionen:
//   --datei=/pfad/latest-canonical.json   eigene Datei statt Download
//                               (z. B. aus einem lokalen heisse-preise-Lauf)
//   --laeden=billa,spar,hofer   welche Ketten (Standard: die österreichischen)
//   --max=0                     Obergrenze je Kette, 0 = alle
//   --tage=45                   nur Preise, die höchstens so alt sind
//   --auch-alte                 auch Ketten übernehmen, deren Erfassung stillsteht
//                               (zum Ausprobieren; Alter wird in der App angezeigt)
//   --behalte-alte              vorhandene Preise dieser Ketten nicht vorher löschen
//   --trocken                   nichts senden, nur zeigen
// =====================================================================
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const [zielRoh, token, ...rest] = process.argv.slice(2);
if (!zielRoh || !token) {
  console.log("Aufruf: node import-heissepreise.js <server-url> <import-token> [--laeden=billa,spar,hofer] [--max=0] [--trocken]");
  process.exit(1);
}
const ziel = zielRoh.replace(/\/$/, "");
const opt = {};
rest.forEach((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) opt[m[1]] = m[2] === undefined ? true : m[2]; });

// Schlüssel im Datensatz -> Name, wie ihn die App anzeigt
const KETTEN = {
  billa: "Billa", spar: "Spar", hofer: "Hofer", mpreis: "MPREIS",
  unimarkt: "Unimarkt", dm: "dm", bipa: "BIPA", mueller: "Müller",
  lidl: "Lidl", penny: "Penny"
};
const LAEDEN = (opt.laeden ? String(opt.laeden).split(",") : Object.keys(KETTEN))
  .map((s) => s.trim()).filter((s) => KETTEN[s]);
const MAX = parseInt(opt.max || "0", 10);
const TAGE = parseInt(opt.tage || "45", 10);
const TROCKEN = !!opt.trocken;
const ERSETZEN = !opt["behalte-alte"];
const AUCH_ALTE = !!opt["auch-alte"];

const SPIEGEL = "https://github.com/falknerdominik/heisse-preise-data/releases/latest/download/latest-canonical.tar.gz";
const DIREKT = "https://heisse-preise.io/data/latest-canonical.json";
const UA = "Zettl-Haushalt/1.0 (privater Haushalt)";

// --------------------------------------------------------------- Laden
async function ladeDatensatz() {
  // Eigene Datei? Dann nichts herunterladen.
  if (opt.datei) {
    const p = String(opt.datei);
    if (!fs.existsSync(p)) throw new Error("Datei nicht gefunden: " + p);
    console.log("Lese eigene Datei " + p + " (" + (fs.statSync(p).size / 1048576).toFixed(1) + " MB)");
    return { pfad: p, tmp: null };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "zettl-"));
  const tarPfad = path.join(tmp, "hp.tar.gz");
  try {
    process.stdout.write("Lade Datensatz vom GitHub-Spiegel … ");
    const res = await fetch(SPIEGEL, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    fs.writeFileSync(tarPfad, Buffer.from(await res.arrayBuffer()));
    console.log((fs.statSync(tarPfad).size / 1048576).toFixed(1) + " MB");
    execFileSync("tar", ["-xzf", tarPfad, "-C", tmp]);
    const datei = fs.readdirSync(tmp).find((f) => f.endsWith(".json"));
    if (!datei) throw new Error("Keine JSON-Datei im Archiv");
    return { pfad: path.join(tmp, datei), tmp };
  } catch (e) {
    console.log("\n  Spiegel nicht erreichbar (" + e.message + "), nehme heisse-preise.io direkt …");
    const res = await fetch(DIREKT, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error("HTTP " + res.status + " bei " + DIREKT);
    const pfad = path.join(tmp, "latest-canonical.json");
    fs.writeFileSync(pfad, Buffer.from(await res.arrayBuffer()));
    console.log("  " + (fs.statSync(pfad).size / 1048576).toFixed(0) + " MB geladen");
    return { pfad, tmp };
  }
}

// --------------------------------------------------------------- Umformen
// "2000 g" liest sich schlecht – daraus wird "2 kg"
function menge(q, unit) {
  if (q == null || !unit) return null;
  let z = Number(q), e = String(unit).toLowerCase();
  if (isNaN(z) || z <= 0) return null;
  if (e === "g" && z >= 1000) { z = z / 1000; e = "kg"; }
  else if (e === "ml" && z >= 1000) { z = z / 1000; e = "l"; }
  const zahl = Number.isInteger(z) ? String(z) : String(Math.round(z * 100) / 100).replace(".", ",");
  return zahl + " " + e;
}
// Aktion, wenn der Preis unter dem vorherigen liegt
function istAktion(it) {
  const h = it.priceHistory;
  if (!Array.isArray(h) || h.length < 2) return false;
  const jetzt = h[0] && h[0].price, vorher = h[1] && h[1].price;
  return typeof jetzt === "number" && typeof vorher === "number" && jetzt < vorher * 0.95;
}

function umformen(items) {
  const raus = [];
  const zaehler = {};
  // In diesem Datensatz stehen in priceHistory nur Preis *änderungen*. Ein seit
  // Monaten unveränderter Preis ist also aktuell – deshalb bewerten wir nicht
  // einzelne Einträge, sondern jede Kette als Ganzes: Wie frisch ist ihr jüngster
  // Eintrag? Ketten, deren Erfassung stehengeblieben ist, lassen wir ganz weg.
  const juengste = {}, proKette = {}, ohneFlag = {};
  for (const it of items) {
    if (!KETTEN[it.store]) continue;
    proKette[it.store] = (proKette[it.store] || 0) + 1;
    if (!it.unavailable) ohneFlag[it.store] = (ohneFlag[it.store] || 0) + 1;
    const h = it.priceHistory;
    const d = Array.isArray(h) && h[0] && h[0].date;
    if (d && (!juengste[it.store] || d > juengste[it.store])) juengste[it.store] = d;
  }
  const grenze = new Date(Date.now() - TAGE * 86400000).toISOString().slice(0, 10);
  const veraltet = {}, flagUnbrauchbar = {};
  Object.keys(proKette).forEach((s) => {
    if (!ohneFlag[s]) flagUnbrauchbar[s] = true;         // Flag pauschal gesetzt = wertlos
    if (!juengste[s] || juengste[s] < grenze) veraltet[s] = juengste[s] || "unbekannt";
  });

  for (const it of items) {
    const kette = KETTEN[it.store];
    if (!kette || LAEDEN.indexOf(it.store) < 0) continue;
    if (veraltet[it.store] && !AUCH_ALTE) continue;
    if (it.unavailable && !flagUnbrauchbar[it.store]) continue;
    if (typeof it.price !== "number" || !(it.price > 0)) continue;
    if (!it.name || !String(it.name).trim()) continue;
    zaehler[it.store] = (zaehler[it.store] || 0) + 1;
    if (MAX && zaehler[it.store] > MAX) continue;
    const datum = (Array.isArray(it.priceHistory) && it.priceHistory[0] && it.priceHistory[0].date) || null;
    raus.push({
      id: "hp-" + it.store + "-" + it.id,
      name: String(it.name).replace(/\s+/g, " ").trim(),
      brand: null,
      unit: menge(it.quantity, it.unit) || (it.isWeighted ? "nach Gewicht" : null),
      image: null,                       // dieser Datensatz enthält keine Bilder
      offer: istAktion(it),
      prices: [{ store: kette, price: Math.round(it.price * 100) / 100, at: datum }]
    });
  }
  return { produkte: raus, zaehler, veraltet, juengste };
}

// --------------------------------------------------------------- Senden
async function post(pfad, body) {
  const res = await fetch(ziel + pfad, {
    method: "POST",
    headers: Object.assign({ Authorization: "Bearer " + token },
      body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const a = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("HTTP " + res.status + " " + JSON.stringify(a));
  return a;
}

(async () => {
  const { pfad, tmp } = await ladeDatensatz();
  console.log("Lese Datensatz …");
  const roh = JSON.parse(fs.readFileSync(pfad, "utf8"));
  const items = Array.isArray(roh) ? roh : (roh.items || []);
  console.log("  " + items.length.toLocaleString("de-AT") + " Einträge insgesamt");

  const { produkte, zaehler, veraltet, juengste } = umformen(items);
  console.log("Für euch übernommen:");
  LAEDEN.forEach((s) => { if (zaehler[s]) console.log("  " + KETTEN[s] + ": " + zaehler[s].toLocaleString("de-AT")
    + " (Stand " + (juengste[s] || "?") + ")"); });
  const tot = LAEDEN.filter((s) => veraltet[s]);
  if (tot.length) {
    console.log(AUCH_ALTE
      ? "Mit übernommen, obwohl die Erfassung dort stillsteht (Alter wird in der App angezeigt):"
      : "Übersprungen, weil dort seit über " + TAGE + " Tagen nichts Neues kam:");
    tot.forEach((s) => console.log("  " + KETTEN[s] + " – letzter Stand " + veraltet[s]
      + (AUCH_ALTE && zaehler[s] ? ", " + zaehler[s].toLocaleString("de-AT") + " Produkte" : "")));
  }
  console.log("  zusammen " + produkte.length.toLocaleString("de-AT") + " Produkte, davon "
    + produkte.filter((p) => p.offer).length.toLocaleString("de-AT") + " gerade im Angebot");

  if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

  if (TROCKEN) {
    produkte.slice(0, 12).forEach((p) => console.log("   " + p.name.slice(0, 46) + " | " + (p.unit || "-")
      + " | " + p.prices[0].store + " " + p.prices[0].price.toFixed(2) + (p.offer ? " (Aktion)" : "")));
    return;
  }

  if (ERSETZEN) {
    console.log("Räume alte Preise dieser Ketten weg …");
    for (const s of LAEDEN.filter((x) => zaehler[x])) {
      try { const a = await post("/api/drop-store?store=" + encodeURIComponent(KETTEN[s])); 
            if (a.entfernt) console.log("  " + KETTEN[s] + ": " + a.entfernt + " alte Einträge"); }
      catch (e) { console.log("  " + KETTEN[s] + ": " + e.message); }
    }
  }

  const stueck = 2000;
  for (let i = 0; i < produkte.length; i += stueck) {
    const a = await post("/api/import", produkte.slice(i, i + stueck));
    process.stdout.write("\r  gesendet " + Math.min(i + stueck, produkte.length) + "/" + produkte.length
      + " (Server hat " + a.gesamt + ")   ");
  }
  console.log("\nFertig. Datenquelle: heisse-preise.io, Projekt von Mario Zechner (MIT).");
})().catch((e) => { console.error("Abgebrochen:", e.message); process.exit(1); });
