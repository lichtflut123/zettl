#!/usr/bin/env node
// Spielt eine CSV in den Preis-Server ein.
//   node import-csv.js preise.csv https://dein-server.example dein-import-token
// Erwartete Spalten (Kopfzeile nötig, Reihenfolge egal):
//   name, brand, unit, store, price, image, offer
"use strict";
const fs = require("fs");

const [datei, ziel, token] = process.argv.slice(2);
if (!datei || !ziel || !token) {
  console.log("Aufruf: node import-csv.js <datei.csv> <server-url> <import-token>");
  process.exit(1);
}

function parseCsv(text) {
  const zeilen = text.split(/\r?\n/).filter((z) => z.trim());
  const trenner = (zeilen[0].match(/;/g) || []).length > (zeilen[0].match(/,/g) || []).length ? ";" : ",";
  const teile = (z) => {
    const out = []; let cur = "", inQ = false;
    for (let i = 0; i < z.length; i++) {
      const c = z[i];
      if (c === '"') { if (inQ && z[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (c === trenner && !inQ) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur); return out.map((s) => s.trim());
  };
  const kopf = teile(zeilen[0]).map((s) => s.toLowerCase());
  return zeilen.slice(1).map((z) => {
    const w = teile(z), o = {};
    kopf.forEach((k, i) => (o[k] = w[i]));
    return o;
  });
}

const rows = parseCsv(fs.readFileSync(datei, "utf8"));
// Zeilen mit gleichem Produkt zu einem Eintrag mit mehreren Preisen bündeln
const map = new Map();
for (const r of rows) {
  if (!r.name) continue;
  const key = (r.brand || "") + "|" + r.name + "|" + (r.unit || "");
  if (!map.has(key)) map.set(key, { name: r.name, brand: r.brand || null, unit: r.unit || null,
    image: r.image || null, offer: String(r.offer || "").toLowerCase() === "true", prices: [] });
  const eintrag = map.get(key);
  // Aktion gilt fürs Produkt, sobald sie in einer Zeile steht
  if (String(r.offer || "").toLowerCase() === "true") eintrag.offer = true;
  if (r.image && !eintrag.image) eintrag.image = r.image;
  const preis = parseFloat(String(r.price || "").replace(",", "."));
  if (r.store && !isNaN(preis)) eintrag.prices.push({ store: r.store, price: preis });
}
const produkte = [...map.values()];
console.log(produkte.length + " Produkte vorbereitet, sende an " + ziel);

fetch(ziel.replace(/\/$/, "") + "/api/import", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
  body: JSON.stringify(produkte)
}).then((r) => r.json()).then((a) => console.log("Antwort:", a))
  .catch((e) => { console.error("Fehlgeschlagen:", e.message); process.exit(1); });
