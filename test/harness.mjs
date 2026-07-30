import { JSDOM } from "jsdom";
import { webcrypto } from "node:crypto";
import fs from "fs";

const HTML = fs.readFileSync("./index.html", "utf8");
const results = [];
// Ein Absturz in einem Fenster darf nicht den ganzen Lauf killen
process.on("uncaughtException", (e) => console.log("   (Ausnahme aufgefangen: " + e.message + ")"));
const GEO = { deny: false };
const OPEN = [];
function closeAll(){
  const alt = OPEN.splice(0, OPEN.length);
  setTimeout(() => alt.forEach(w => { try{ w.close(); }catch(e){} }), 250);  // laufende Vorgänge auslaufen lassen
}
const ok = (n) => { results.push(["PASS", n]); closeAll(); };
const bad = (n, e) => { results.push(["FAIL", n, String(e && e.message || e)]); closeAll(); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cleanupWin = (w) => { try { w.close(); } catch (e) {} };
async function until(pred, label = "Bedingung", ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(60); }
  throw new Error("Timeout: " + label);
}

// Fake-Datenbank, getrennt pro Projekt-Host (wie echte Supabase-Projekte)
const DBS = new Map();
function dbFor(u){ const h=String(u).replace(/^https?:\/\//,"").split("/")[0];
  if(!DBS.has(h)) DBS.set(h,new Map()); return DBS.get(h); }
const REMOTE = { clear(){ DBS.clear(); }, has(k){ for(const d of DBS.values()) if(d.has(k)) return true; return false; },
  get(k){ for(const d of DBS.values()) if(d.has(k)) return d.get(k); return undefined; },
  // Schreibweg in die Fake-Datenbank. Ohne ihn liess sich ein FREMDER Stand gar
  // nicht herstellen – die App schreibt immer nur ihren eigenen –, und damit war
  // alles untestbar, was auf Fremdes reagiert: der Tresor-Schutz und die
  // Vereinigung mit einem Stand, den dieses Handy nie geschrieben hat.
  put(host, id, data){ dbFor(host).set(id, data); },
  keys(){ const s=new Set(); for(const d of DBS.values()) for(const k of d.keys()) s.add(k); return s; } };
let PREISDATEI = { fail: false, inhalt: { stand: "2026-07-29", artikel: [
  ["S-BUDGET Butter", 1.51, "Spar", "250 g", 1, 0, 0, "kuehl"],
  ["S-BUDGET Butter", 1.69, "Billa", "250 g", 0, 0, 0, "kuehl"],
  ["Ja! Natürlich Butter", 2.02, "Billa", "250 g", 0, 1, 1, "kuehl"],
  ["Butter-Apfeltasche", 1.49, "Billa", "1 stk", 0, 0, 0, "backwaren"],
  ["Clever Vollmilch", 1.32, "Billa", "1 l", 1, 0, 0, "kuehl"],
  ["Clever Toilettenpapier", 3.73, "Billa", "10 stk", 0, 0, 0, "drogerie"],
  ["Melanzani", 1.69, "Hofer", "1 stk", 0, 0, 0, "obst"],
  ["Balea Shampoo", 0.95, "dm", "300 ml", 0, 0, 0, "drogerie"],
  ["Clever Nudeln", 0.99, "Billa", "500 g", 0, 0, 0],
  ["Clever Nudeln", 0.79, "Hofer", "500 g", 0, 0, 0],
  ["Bergkäse", 8.99, "Billa", "400 g", 0, 0, 1],
  ["Bergkäse", 6.99, "Hofer", "400 g", 0, 0, 1],
  ["Bergkäse Vorteilspackung", 12.99, "Spar", "1 kg", 0, 0, 1, "kuehl"],
  ["Bio Bergkäse", 9.49, "Billa", "400 g", 0, 1, 1, "kuehl"],
  ["Alpenbutter", 2.29, "Hofer", "250 g", 0, 0, 1, "kuehl"],
  ["Butterschmalz", 4.99, "Billa", "500 g", 0, 0, 0, "kuehl"]
] } };
const altesDatum = (() => { const d = new Date(); d.setDate(d.getDate() - 400); return d.toISOString().slice(0,10); })();
let SRV = { fail: false, produkte: [
  { id: "p1", name: "Speisesalz jodiert", brand: "Bad Ischler", unit: "500 g", image: null, offer: false,
    best: { store: "Hofer", price: 0.59 },
    prices: [{ store: "Hofer", price: 0.59 }, { store: "Spar", price: 0.75 }, { store: "Billa", price: 0.79 }] },
  { id: "p2", name: "Meersalz grob", brand: "Clever", unit: "1 kg", image: "https://bild.test/salz.jpg", offer: true,
    best: { store: "Billa", price: 0.99 }, prices: [{ store: "Billa", price: 0.99 }] },
  { id: "p3", name: "Altes Salz", brand: "MPREIS", unit: "500 g", image: null, offer: false,
    best: { store: "MPREIS", price: 0.39, at: altesDatum }, prices: [{ store: "MPREIS", price: 0.39, at: altesDatum }] }
]};
let NOMINATIM = { fail: false, hits: [
  { display_name: "Leonding, Bezirk Linz-Land, Oberösterreich, Österreich", lat: "48.2000", lon: "14.2850" },
  { display_name: "Leondinger Straße, Linz, Österreich", lat: "48.2600", lon: "14.2700" }
]};
let OVERPASS = { fail: false, elements: [
  { type:"node", lat:48.2010, lon:14.2860, tags:{ name:"Hofer Leonding", shop:"supermarket", brand:"Hofer" } },
  { type:"node", lat:48.2040, lon:14.2900, tags:{ name:"Billa Plus", shop:"supermarket" } },
  { type:"way",  center:{lat:48.2100, lon:14.3000}, tags:{ name:"dm drogerie markt", shop:"chemist" } },
  { type:"node", lat:48.2005, lon:14.2855, tags:{ shop:"supermarket" } }   // ohne Namen -> wird ignoriert
]};
function fakeFetch(url, opts = {}) {
  const u = String(url);
  if (u.indexOf("preise.json") >= 0) {
    if (PREISDATEI.fail) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => PREISDATEI.inhalt });
  }
  if (u.indexOf("preise.test") >= 0) {
    if (SRV.fail) return Promise.resolve({ ok: false, status: 502, json: async () => ({}) });
    if (u.indexOf("/api/health") >= 0)
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, produkte: SRV.produkte.length }) });
    if (u.indexOf("/api/search") >= 0) {
      const q = decodeURIComponent((u.match(/[?&]q=([^&]*)/) || [])[1] || "").toLowerCase();
      const alle = SRV.produkte.filter(p => p.name.toLowerCase().includes(q));
      const m = u.match(/[?&]limit=(\d+)/);
      const treffer = alle.slice(0, m ? parseInt(m[1], 10) : 20);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ treffer, gesamt: alle.length }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  }
  if (u.indexOf("nominatim") >= 0) {
    if (NOMINATIM.fail) return Promise.resolve({ ok: false, status: 429, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => NOMINATIM.hits });
  }
  if (u.indexOf("nominatim") >= 0) {
    if (NOMINATIM.fail) return Promise.resolve({ ok: false, status: 429, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => NOMINATIM.hits });
  }
  if (u.indexOf("overpass") >= 0) {
    if (OVERPASS.fail) return Promise.resolve({ ok: false, status: OVERPASS.status || 504, json: async () => ({}) });
    if ((OVERPASS.failHosts || []).some(h => u.indexOf(h) >= 0))
      return Promise.resolve({ ok: false, status: 504, json: async () => ({}) });
    OVERPASS.usedHost = u;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ elements: OVERPASS.elements }) });
  }
  // Wie echtes Supabase: nur genau /rest/v1/zettl existiert
  if (!/^https:\/\/[^/]+\/rest\/v1\/zettl(\?|$)/.test(u)) {
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }
  const db = dbFor(u);
  if (opts.method === "POST") {
    const body = JSON.parse(opts.body);
    db.set(body.id, body.data);
    return Promise.resolve({ ok: true, status: 201, json: async () => ({}) });
  }
  const m = u.match(/id=eq\.([^&]+)/);
  const id = m ? decodeURIComponent(m[1]) : null;
  const row = db.has(id) ? [{ data: db.get(id) }] : [];
  return Promise.resolve({ ok: true, status: 200, json: async () => row });
}

function makePhone(storage = {}, url = "https://zettl.test/") {
  // WICHTIG: crypto/fetch/localStorage muessen VOR dem Skriptstart stehen
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously", url, pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, "crypto", { value: webcrypto, configurable: true });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;   // jsdom liefert beides nicht mit
      w.fetch = fakeFetch;
      w.navigator.geolocation = {
        getCurrentPosition: (ok, err) => GEO.deny
          ? setTimeout(() => err({ code: 1 }), 5)
          : setTimeout(() => ok({ coords: { latitude: 48.2000, longitude: 14.2850 } }), 5)
      };
      w.confirm = () => true;
      for (const k in storage) w.localStorage.setItem(k, storage[k]);
    }
  });
  const w = dom.window;
  OPEN.push(w);
  return { dom, w, doc: w.document, api: () => w.__zettl };
}
function dump(w) { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; }
const $ = (w, sel) => w.document.querySelector(sel);
const txt = (w) => { const a = w.document.querySelector("#app"); return a ? a.textContent : ""; }; // ohne <script>-Inhalt
function click(w, sel) { const el = $(w, sel); if (!el) throw new Error("Element fehlt: " + sel); el.dispatchEvent(new w.Event("click", { bubbles: true })); }
function type(w, sel, val) {
  const el = $(w, sel); if (!el) throw new Error("Feld fehlt: " + sel);
  el.value = val; el.dispatchEvent(new w.Event("input", { bubbles: true }));
}
function byText(w, tag, text) {
  return [...w.document.querySelectorAll(tag)].find(e => e.textContent.trim().includes(text));
}
// Raum im Dialog eindeutig wählen – Textsuche würde jetzt den Einklapp-Kopf treffen
// Artikel in der Einkaufsliste eindeutig öffnen
function openItem(w, name) {
  const b = [...w.document.querySelectorAll("[data-item]")].find(e => e.textContent.includes(name));
  if (!b) throw new Error("Kein Artikel " + name);
  b.dispatchEvent(new w.Event("click", { bubbles: true }));
}
function pickRoom(w, name) {
  const chip = w.document.querySelector('[data-room="' + name + '"]') ||
               w.document.querySelector('[data-troom="' + name + '"]');
  if (chip) return chip.dispatchEvent(new w.Event("click", { bubbles: true }));
  const b = [...w.document.querySelectorAll("button")].find(e => e.textContent.trim().includes(name));
  if (!b) throw new Error("Kein Raum-Chip für " + name);
  return b.dispatchEvent(new w.Event("click", { bubbles: true }));
}
function clickText(w, tag, text) {
  const el = byText(w, tag, text); if (!el) throw new Error("Kein " + tag + " mit '" + text + "'");
  el.dispatchEvent(new w.Event("click", { bubbles: true }));
}
async function setup(w, pw = "geheim99", a = "Rü", b = "Verena") {
  await until(() => $(w, "#goNew") || $(w, "#nameA"), "Startbildschirm");
  if ($(w, "#goNew")) { click(w, "#goNew"); await until(() => $(w, "#nameA"), "Anlegen-Formular"); }
  type(w, "#nameA", a); type(w, "#nameB", b); type(w, "#pw", pw);
  click(w, "#go");
  await until(() => byText(w, "button", a), "Namensauswahl");    // Verschlüsselung braucht Zeit
  clickText(w, "button", a);
  await until(() => $(w, "#what"), "Hauptansicht");
}
async function addItem(w, name) {
  type(w, "#what", name); await sleep(30);
  click(w, "#addItem"); await sleep(180);
}


// Gemeinsames Geschirr für alle Testdateien: die volle Suite (agenten.mjs) und
// die Bereichsdateien (wagerl.mjs) teilen Attrappen, makePhone und die Helfer.
// Arbeitsweise seit 30.07.2026: schnell nach jeder Änderung, Bereichs-Agenten
// vor jedem Commit, die volle Suite am Etappenende und vor jedem Push.
export { JSDOM, webcrypto, HTML, fs, results, GEO, OPEN, closeAll, ok, bad, sleep,
         cleanupWin, until, DBS, dbFor, REMOTE, PREISDATEI, SRV, NOMINATIM,
         OVERPASS, fakeFetch, makePhone, dump, $, txt, click, type, byText,
         openItem, pickRoom, clickText, setup, addItem, altesDatum };

// Ergebnis ausgeben und mit 1 enden, sobald ein Agent fehlgeschlagen ist
export function fazit(){
  console.log("\n================ TESTLAUF ================");
  results.forEach(r => console.log((r[0] === "PASS" ? "✅" : "❌") + "  " + r[1] + (r[2] ? "\n     → " + r[2] : "")));
  const fails = results.filter(r => r[0] === "FAIL").length;
  console.log("==========================================");
  console.log(results.length - fails + "/" + results.length + " bestanden");
  process.exit(fails ? 1 : 0);
}
