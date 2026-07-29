#!/usr/bin/env node
// =====================================================================
// Zettl – Import aus offenen Daten
//
// Zwei Quellen, beide frei und offen lizenziert (ODbL):
//   1. Open Prices (prices.openfoodfacts.org) – echte Preise mit Geschäft und Datum
//   2. Open Food Facts (openfoodfacts.org)    – Produktnamen, Marken, Größen, Bilder
//
// Kein Abgreifen von Händlerseiten. Was hier hereinkommt, darf hereinkommen.
//
// Aufruf:
//   node import-opendata.js <server-url> <import-token> [optionen]
//
// Optionen:
//   --land=Österreich     Land für die Preissuche (Standard: Österreich)
//   --katalog=800         Wie viele Produkte aus dem Katalog (Standard 800, 0 = keine)
//   --tage=540            Preise nur aus den letzten N Tagen (Standard 540)
//   --trocken             Nichts senden, nur zeigen was käme
// =====================================================================
"use strict";

const [zielRoh, token, ...rest] = process.argv.slice(2);
if (!zielRoh || !token) {
  console.log("Aufruf: node import-opendata.js <server-url> <import-token> [--land=Österreich] [--katalog=800] [--tage=540] [--trocken]");
  process.exit(1);
}
const ziel = zielRoh.replace(/\/$/, "");
const opt = {};
rest.forEach((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); if (m) opt[m[1]] = m[2] === undefined ? true : m[2]; });
const LAND = opt.land || "Österreich";
const KATALOG = opt.katalog === undefined ? 800 : parseInt(opt.katalog, 10);
const TAGE = parseInt(opt.tage || "540", 10);
const TROCKEN = !!opt.trocken;

const UA = "Zettl-Haushalt/1.0 (privater Haushalt; https://github.com/)";
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function hole(url, versuch = 0) {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (res.status === 429 || res.status >= 500) {
    if (versuch >= 3) throw new Error("HTTP " + res.status + " nach mehreren Versuchen");
    await schlaf(2000 * (versuch + 1));            // höflich warten statt hämmern
    return hole(url, versuch + 1);
  }
  if (!res.ok) throw new Error("HTTP " + res.status + " bei " + url);
  return res.json();
}

const nurZahl = (v) => (typeof v === "number" && isFinite(v) ? v : null);
function ladenName(l) {
  if (!l) return null;
  const marke = l.osm_brand || l.osm_name;
  if (!marke) return null;
  const ort = l.osm_address_city;
  return ort ? marke + " " + ort : marke;
}
function menge(p) {
  if (p.quantity) return String(p.quantity);
  if (p.product_quantity && p.product_quantity_unit) return p.product_quantity + " " + p.product_quantity_unit;
  return null;
}

// ------------------------------------------------------- 1. Preise
async function holePreise() {
  console.log("Suche Geschäfte in " + LAND + " …");
  const orte = [];
  for (let seite = 1; seite <= 20; seite++) {
    const d = await hole("https://prices.openfoodfacts.org/api/v1/locations"
      + "?osm_address_country__like=" + encodeURIComponent(LAND) + "&size=100&page=" + seite);
    (d.items || []).forEach((o) => { if ((o.price_count || 0) > 0) orte.push(o); });
    if (!d.items || !d.items.length || seite >= (d.pages || 1)) break;
    await schlaf(400);
  }
  console.log("  " + orte.length + " Geschäfte mit Preisen gefunden");

  const grenze = new Date(Date.now() - TAGE * 86400000).toISOString().slice(0, 10);
  const produkte = new Map();
  let preise = 0, zuAlt = 0;

  for (let i = 0; i < orte.length; i++) {
    const ort = orte[i];
    const laden = ladenName(ort);
    if (!laden) continue;
    for (let seite = 1; seite <= 10; seite++) {
      let d;
      try {
        d = await hole("https://prices.openfoodfacts.org/api/v1/prices?location_id=" + ort.id
          + "&size=100&page=" + seite + "&order_by=-date");
      } catch (e) { console.log("  " + laden + ": " + e.message); break; }
      for (const it of d.items || []) {
        const p = it.product;
        const preis = nurZahl(it.price);
        if (!p || !p.product_name || preis == null) continue;
        if (it.date && it.date < grenze) { zuAlt++; continue; }
        const key = p.code || (p.brands + "|" + p.product_name);
        if (!produkte.has(key)) produkte.set(key, {
          id: "off-" + key,
          name: p.product_name,
          brand: (p.brands || "").split(",")[0].trim() || null,
          unit: menge(p),
          image: p.image_url || null,
          offer: false,
          prices: []
        });
        const e = produkte.get(key);
        if (it.price_is_discounted) e.offer = true;
        // Pro Geschäft nur den neuesten Preis behalten
        const alt = e.prices.find((x) => x.store === laden);
        if (!alt) e.prices.push({ store: laden, price: preis, at: it.date || null });
        else if ((it.date || "") > (alt.at || "")) { alt.price = preis; alt.at = it.date || null; }
        preise++;
      }
      if (!d.items || d.items.length < 100) break;
      await schlaf(300);
    }
    if ((i + 1) % 10 === 0) console.log("  " + (i + 1) + "/" + orte.length + " Geschäfte, " + produkte.size + " Produkte");
    await schlaf(200);
  }
  console.log("  " + preise + " Preise übernommen, " + zuAlt + " als zu alt übersprungen");
  return [...produkte.values()];
}

// ------------------------------------------------------- 2. Produktkatalog
// Damit die Suche auch Treffer hat, für die noch niemand einen Preis erfasst hat.
async function holeKatalog(anzahl, landTag) {
  if (!anzahl) return [];
  console.log("Lade Produktkatalog (" + anzahl + " Produkte) …");
  const out = [];
  const proSeite = 100;
  for (let seite = 1; out.length < anzahl; seite++) {
    let d;
    try {
      d = await hole("https://search.openfoodfacts.org/search?q="
        + encodeURIComponent('countries_tags:"' + landTag + '"')
        + "&page=" + seite + "&page_size=" + proSeite
        + "&fields=code,product_name,brands,quantity,image_url");
    } catch (e) { console.log("  Katalog: " + e.message); break; }
    const treffer = d.hits || [];
    if (!treffer.length) break;
    for (const p of treffer) {
      if (!p.product_name) continue;
      const marken = Array.isArray(p.brands) ? p.brands : String(p.brands || "").split(",");
      out.push({
        id: "off-" + (p.code || p.product_name),
        name: String(p.product_name).trim(),
        brand: (marken[0] || "").trim() || null,
        unit: p.quantity || null,
        image: p.image_url || null,
        offer: false,
        prices: []                                  // Preise kommen aus Open Prices oder von euch
      });
      if (out.length >= anzahl) break;
    }
    console.log("  " + out.length + " Produkte");
    await schlaf(500);
  }
  return out;
}

// ------------------------------------------------------- Senden
async function senden(liste) {
  if (TROCKEN) {
    console.log("Trockenlauf – es wird nichts gesendet.");
    liste.slice(0, 10).forEach((p) => console.log("   " + p.name + " | " + (p.brand || "-") + " | " + (p.unit || "-")
      + " | " + (p.prices.length ? p.prices.map((x) => x.store + " " + x.price).join(", ") : "kein Preis")));
    return;
  }
  const stueck = 300;
  for (let i = 0; i < liste.length; i += stueck) {
    const teil = liste.slice(i, i + stueck);
    const res = await fetch(ziel + "/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(teil)
    });
    const a = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Import fehlgeschlagen: HTTP " + res.status + " " + JSON.stringify(a));
    console.log("  gesendet " + Math.min(i + stueck, liste.length) + "/" + liste.length + " → " + JSON.stringify(a));
  }
}

// ------------------------------------------------------- Ablauf
(async () => {
  const landTag = "en:" + LAND.toLowerCase()
    .replace("österreich", "austria").replace("deutschland", "germany").replace("schweiz", "switzerland");
  const mitPreis = await holePreise();
  const katalog = await holeKatalog(KATALOG, landTag);

  // Katalogeinträge nur ergänzen, wo noch kein Preis-Produkt existiert
  const vorhanden = new Set(mitPreis.map((p) => p.id));
  const zusammen = mitPreis.concat(katalog.filter((p) => !vorhanden.has(p.id)));

  console.log("Ergebnis: " + mitPreis.length + " Produkte mit Preis, "
    + (zusammen.length - mitPreis.length) + " weitere aus dem Katalog");
  await senden(zusammen);
  console.log("Fertig. Datenquelle: Open Food Facts / Open Prices, ODbL.");
})().catch((e) => { console.error("Abgebrochen:", e.message); process.exit(1); });
