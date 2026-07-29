#!/usr/bin/env node
// =====================================================================
// Zettl Preis-Server
// Kleiner Dienst, der Produkte und Preise vorhält und die App bedient.
// Bewusst ohne Abhängigkeiten: node server.js genügt, kein npm install.
//
// Endpunkte
//   GET  /api/health                      -> Status und Anzahl Produkte
//   GET  /api/search?q=salz&limit=20      -> Treffer, günstigster Preis zuerst
//   GET  /api/product/:id                 -> ein Produkt mit allen Preisen
//   GET  /api/offers?limit=50             -> aktuell als Aktion markierte Produkte
//   POST /api/import   (Bearer IMPORT_TOKEN) -> Produkte einspielen/aktualisieren
//
// Umgebung
//   PORT          Standard 8080
//   DATA_FILE     Standard ./data.json
//   IMPORT_TOKEN  Pflicht für /api/import
//   READ_TOKEN    optional; wenn gesetzt, brauchen auch Lesezugriffe den Token
// =====================================================================
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = parseInt(process.env.PORT || "8080", 10);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const IMPORT_TOKEN = process.env.IMPORT_TOKEN || "";
const READ_TOKEN = process.env.READ_TOKEN || "";

// ---------------------------------------------------------------- Speicher
let db = { products: [], updatedAt: null };
function load() {
  try {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(db.products)) db.products = [];
  } catch (e) {
    db = { products: [], updatedAt: null };
  }
}
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFile(tmp, JSON.stringify(db), (err) => {
      if (err) return console.error("Speichern fehlgeschlagen:", err.message);
      fs.rename(tmp, DATA_FILE, (e2) => e2 && console.error("Umbenennen:", e2.message));
    });
  }, 300);
}

// ---------------------------------------------------------------- Suche
// Alle Akzente entfernen, damit "kotanyi" auch "Kotányi" findet
const norm = (s) => String(s || "").toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Suchindex: die aufbereiteten Namen einmal berechnen statt bei jeder Suche.
// Bei über hunderttausend Produkten ist das der Unterschied zwischen 2 s und 30 ms.
// Alles, was älter ist, gilt als nicht mehr verlässlich
const ALT_GRENZE = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
let lastTotal = 0;              // wie viele Treffer es insgesamt gab
const index = new Map();
function buildIndex() {
  index.clear();
  for (const p of db.products) {
    const name = norm(p.name);
    const hay = (name + " " + norm(p.brand || "")).trim();
    index.set(p.id, { name, hay, worte: hay.split(" ") });
  }
}

// Bewertet die Passung. Ein ganzes Wort zählt weit mehr als ein Wortteil –
// sonst gewinnt "SalzburgMilch" die Suche nach "Salz".
function score(product, gruppen) {
  const ix = index.get(product.id);
  if (!ix) return 0;
  const name = ix.name, hay = ix.hay, worte = ix.worte;
  let s = 0, treffer = 0;
  for (const gruppe of gruppen) {
    let best = 0, bestLen = 0;
    for (const w of gruppe) {
      if (hay.indexOf(w) < 0) continue;
      let p;
      if (name === w) p = 60;                       // Produkt heißt genau so
      else if (worte.indexOf(w) >= 0) p = 40;       // eigenes Wort im Namen
      else if (worte.some((t) => t.startsWith(w))) p = 18;
      else p = 4;                                   // irgendwo mittendrin
      // Im Deutschen steht das eigentliche Produkt meist hinten: "Clever Butter"
      // ist Butter, "Butter-Apfeltasche" ist eine Apfeltasche.
      if (worte[worte.length - 1] === w) p += 20;
      else if (worte[0] === w && worte.length > 1) p += 2;
      if (p > best) { best = p; bestLen = w.length; }
    }
    if (!best) return 0;                            // jedes Suchwort muss vorkommen
    s += best; treffer += bestLen;
  }
  // Je größer der Anteil des Namens, den die Suche abdeckt, desto besser –
  // sonst gewinnt "Salz-Knusperspitz" die Suche nach "Salz".
  s += Math.round(35 * Math.min(1, treffer / Math.max(name.length, 1)));
  if ((product.prices || []).length) s += 12;       // mit bekanntem Preis nützlicher
  // Alte Preise sind weniger wert als frische
  const b = cheapest(product);
  if (b && b.at && b.at < ALT_GRENZE) s -= 10;
  return s;
}

function cheapest(product) {
  let best = null;
  for (const p of product.prices || []) {
    if (p.price == null) continue;
    if (!best || p.price < best.price) best = p;
  }
  return best;
}
// Wie man es sagt -> wie es auf der Packung steht
const SYNONYME = {
  klopapier: ["toilettenpapier", "klopapier"], wcpapier: ["toilettenpapier"],
  erdaepfel: ["erdaepfel", "kartoffel"], kartoffel: ["kartoffel", "erdaepfel"],
  paradeiser: ["paradeiser", "tomate"], tomate: ["tomate", "paradeiser"],
  obers: ["obers", "sahne", "rahm"], sahne: ["sahne", "obers", "rahm"],
  schlagobers: ["schlagobers", "schlagrahm", "sahne"],
  semmel: ["semmel", "broetchen", "weckerl"], broetchen: ["broetchen", "semmel"],
  faschiertes: ["faschiertes", "hackfleisch"], hackfleisch: ["hackfleisch", "faschiertes"],
  topfen: ["topfen", "quark"], quark: ["quark", "topfen"],
  marille: ["marille", "aprikose"], aprikose: ["aprikose", "marille"],
  zwetschke: ["zwetschke", "pflaume"], karfiol: ["karfiol", "blumenkohl"],
  melanzani: ["melanzani", "aubergine"], fisolen: ["fisolen", "bohnen"],
  kren: ["kren", "meerrettich"], germ: ["germ", "hefe"],
  spuelmittel: ["spuelmittel", "geschirrspuel"], putzmittel: ["putzmittel", "reiniger"]
};

function search(q, limit) {
  const roh = norm(q).split(" ").filter(Boolean);
  if (!roh.length) return [];
  // Jedes Suchwort darf mehrere Schreibweisen haben
  const words = roh.map((w) => (SYNONYME[w] ? SYNONYME[w].map(norm) : [w]));
  const hits = [];
  for (const p of db.products) {
    const s = score(p, words);
    if (!s) continue;
    const best = cheapest(p);
    hits.push({ product: p, s, best });
  }
  // Erst nach Relevanz, dann nach Preis
  hits.sort((a, b) => (b.s - a.s) || ((a.best ? a.best.price : 1e9) - (b.best ? b.best.price : 1e9)));
  lastTotal = hits.length;
  return hits.slice(0, limit).map((h) => ({
    id: h.product.id,
    name: h.product.name,
    brand: h.product.brand || null,
    unit: h.product.unit || null,
    image: h.product.image || null,
    offer: !!h.product.offer,
    best: h.best,
    prices: (h.product.prices || []).slice().sort((a, b) => a.price - b.price)
  }));
}

// ---------------------------------------------------------------- Import
// Alle Produkte eines Ladens entfernen (vor einem Neuimport dieses Ladens)
function dropStore(store) {
  let weg = 0;
  db.products = db.products.filter((p) => {
    const rest = (p.prices || []).filter((x) => x.store !== store);
    if (rest.length !== (p.prices || []).length) weg++;
    p.prices = rest;
    return rest.length > 0 || p.image;      // Produkte ohne Preis und ohne Bild fliegen raus
  });
  buildIndex();
  saveSoon();
  return weg;
}

function mergeProducts(list) {
  const byId = new Map(db.products.map((p) => [p.id, p]));
  let neu = 0, aktualisiert = 0;
  for (const raw of list) {
    if (!raw || !raw.name) continue;
    const id = String(raw.id || (norm(raw.brand || "") + "-" + norm(raw.name)).replace(/\s+/g, "-")).slice(0, 120);
    const prices = (raw.prices || []).filter((p) => p && p.store && p.price != null)
      .map((p) => ({ store: String(p.store), price: Number(p.price), at: p.at || new Date().toISOString().slice(0, 10) }));
    const vorhanden = byId.get(id);
    if (vorhanden) {
      vorhanden.name = raw.name;
      vorhanden.brand = raw.brand || vorhanden.brand || null;
      vorhanden.unit = raw.unit || vorhanden.unit || null;
      vorhanden.image = raw.image || vorhanden.image || null;
      vorhanden.offer = !!raw.offer;
      // Preise je Laden ersetzen, andere behalten
      const rest = (vorhanden.prices || []).filter((p) => !prices.some((n) => n.store === p.store));
      vorhanden.prices = rest.concat(prices);
      aktualisiert++;
    } else {
      const p = { id, name: raw.name, brand: raw.brand || null, unit: raw.unit || null,
        image: raw.image || null, offer: !!raw.offer, prices };
      db.products.push(p); byId.set(id, p); neu++;
    }
  }
  db.updatedAt = new Date().toISOString();
  buildIndex();
  saveSoon();
  return { neu, aktualisiert, gesamt: db.products.length };
}

// ---------------------------------------------------------------- HTTP
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(body);
}
function bearer(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}
function readBody(req, cb) {
  let data = "", zuViel = false;
  req.on("data", (c) => {
    data += c;
    if (data.length > 20 * 1024 * 1024) { zuViel = true; req.destroy(); }
  });
  req.on("end", () => cb(zuViel ? null : data));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  let u;
  try { u = new URL(req.url, "http://x"); } catch (e) { return send(res, 400, { error: "Ungültige Adresse" }); }
  const pfad = u.pathname.replace(/\/+$/, "") || "/";

  if (pfad === "/api/health") {
    return send(res, 200, { ok: true, produkte: db.products.length, aktualisiert: db.updatedAt });
  }

  if (READ_TOKEN && pfad.startsWith("/api/") && pfad !== "/api/import" && bearer(req) !== READ_TOKEN) {
    return send(res, 401, { error: "Token fehlt oder falsch" });
  }

  if (pfad === "/api/search") {
    const q = u.searchParams.get("q") || "";
    const limit = Math.min(50, parseInt(u.searchParams.get("limit") || "20", 10) || 20);
    if (q.trim().length < 2) return send(res, 200, { treffer: [], gesamt: 0 });
    const treffer = search(q, limit);
    return send(res, 200, { treffer, gesamt: lastTotal });
  }

  if (pfad.startsWith("/api/product/")) {
    const id = decodeURIComponent(pfad.slice("/api/product/".length));
    const p = db.products.find((x) => x.id === id);
    return p ? send(res, 200, p) : send(res, 404, { error: "Unbekannt" });
  }

  if (pfad === "/api/offers") {
    const limit = Math.min(200, parseInt(u.searchParams.get("limit") || "50", 10) || 50);
    const list = db.products.filter((p) => p.offer).slice(0, limit)
      .map((p) => ({ id: p.id, name: p.name, brand: p.brand, unit: p.unit, image: p.image,
        best: cheapest(p), prices: p.prices }));
    return send(res, 200, { treffer: list });
  }

  if (pfad === "/api/drop-store" && req.method === "POST") {
    if (bearer(req) !== IMPORT_TOKEN || !IMPORT_TOKEN) return send(res, 401, { error: "Token falsch" });
    const store = u.searchParams.get("store");
    if (!store) return send(res, 400, { error: "Parameter store fehlt" });
    return send(res, 200, { entfernt: dropStore(store), gesamt: db.products.length });
  }

  if (pfad === "/api/import" && req.method === "POST") {
    if (!IMPORT_TOKEN) return send(res, 503, { error: "IMPORT_TOKEN ist nicht gesetzt" });
    if (bearer(req) !== IMPORT_TOKEN) return send(res, 401, { error: "Token falsch" });
    return readBody(req, (body) => {
      if (body === null) return send(res, 413, { error: "Zu groß" });
      let list;
      try { list = JSON.parse(body); } catch (e) { return send(res, 400, { error: "Kein gültiges JSON" }); }
      if (!Array.isArray(list)) list = list && Array.isArray(list.produkte) ? list.produkte : null;
      if (!list) return send(res, 400, { error: "Erwartet wird eine Liste von Produkten" });
      return send(res, 200, mergeProducts(list));
    });
  }

  return send(res, 404, { error: "Unbekannter Endpunkt" });
});

load();
buildIndex();
server.listen(PORT, () => {
  console.log("Zettl Preis-Server läuft auf Port " + PORT + " – " + db.products.length + " Produkte geladen");
  if (!IMPORT_TOKEN) console.log("Hinweis: IMPORT_TOKEN nicht gesetzt, Import ist gesperrt.");
});

module.exports = { server, mergeProducts, search, load };
