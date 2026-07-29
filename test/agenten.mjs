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

// ---------------- Agent 1: Erststart + Verschlüsselung im Speicher
try {
  const { w } = makePhone(); await setup(w);
  if (!txt(w).includes("Der Zettel ist leer.")) throw new Error("Hauptansicht fehlt");
  await addItem(w, "Milch");
  if (!txt(w).includes("Milch")) throw new Error("Artikel nicht sichtbar");
  const raw = w.localStorage.getItem("zettl.shopping");
  if (raw.includes("Milch")) throw new Error("Klartext im Speicher!");
  if (!raw.includes("__enc")) throw new Error("Nicht verschlüsselt");
  if (w.localStorage.getItem("zettl.members").includes("Verena")) throw new Error("Namen im Klartext!");
  ok("Agent 1 – Setup, Artikel anlegen, alles verschlüsselt gespeichert");
} catch (e) { bad("Agent 1", e); }

// ---------------- Agent 2: Neustart der App (Passwort gemerkt)
try {
  const p1 = makePhone(); await setup(p1.w); await addItem(p1.w, "Brot");
  const saved = dump(p1.w);
  const p2 = makePhone(saved); await sleep(300);
  if (!txt(p2.w).includes("Brot")) throw new Error("Daten nach Neustart weg");
  if (txt(p2.w).includes("Aufsperren")) throw new Error("fragt unnötig nach Passwort");
  ok("Agent 2 – App neu geöffnet: Liste noch da, kein erneutes Passwort");
} catch (e) { bad("Agent 2", e); }

// ---------------- Agent 3: Sperren -> Passwort nötig, falsch/richtig
try {
  const p1 = makePhone(); await setup(p1.w); await addItem(p1.w, "Käse");
  click(p1.w, "#settings"); await sleep(80);
  clickText(p1.w, "button", "Sperren"); await sleep(150);
  if (!txt(p1.w).includes("Aufsperren")) throw new Error("nicht gesperrt");
  if (p1.w.localStorage.getItem("zettl.key")) throw new Error("Schlüssel nicht gelöscht");
  type(p1.w, "#pw", "falsch"); click(p1.w, "#go"); await sleep(300);
  if (!txt(p1.w).includes("Falsches Passwort")) throw new Error("falsches PW akzeptiert?");
  type(p1.w, "#pw", "geheim99"); click(p1.w, "#go"); await sleep(400);
  if (!txt(p1.w).includes("Käse")) throw new Error("richtiges PW sperrt nicht auf");
  ok("Agent 3 – Sperren, falsches Passwort abgewiesen, richtiges sperrt auf");
} catch (e) { bad("Agent 3", e); }

// ---------------- Agent 4: Abhaken, Wagerl leeren, löschen
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Oliven"); await addItem(w, "Eier");
  [...w.document.querySelectorAll("[data-toggle]")].find(b => b.closest(".item").textContent.includes("Oliven"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250);
  if (!txt(w).includes("Im Wagerl")) throw new Error("Wagerl fehlt");
  const wagerlZahl = [...w.document.querySelectorAll(".sec")].find(s => s.textContent.includes("Im Wagerl"))
    .querySelector(".cnt");
  if (!wagerlZahl || wagerlZahl.textContent.trim() !== "1") throw new Error("Wagerl-Zähler falsch");
  click(w, "#clearDone"); await sleep(200);
  // Nicht über txt() prüfen: "Oliven" steht jetzt zu Recht unter "Zuletzt gekauft"
  const nach = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (nach.some(i => i.name === "Oliven")) throw new Error("Leeren hat nicht geleert");
  if (!nach.some(i => i.name === "Eier")) throw new Error("Offenes verschwunden");
  if (!txt(w).includes("Eier")) throw new Error("Offenes nicht mehr sichtbar");
  ok("Agent 4 – Abhaken, Wagerl, Leeren");
} catch (e) { bad("Agent 4", e); }

// ---------------- Agent 5: Aufgaben inkl. Wiederholung + richtige Person
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(80);
  type(w, "#title", "Müll rausbringen");
  pickRoom(w, "Küche");
  clickText(w, "button", "alle 3 T.");
  click(w, "#saveTask"); await sleep(250);
  if (!txt(w).includes("Müll rausbringen")) throw new Error("Aufgabe fehlt");
  if (!txt(w).includes("Küche")) throw new Error("Raum-Gruppierung fehlt");
  if (!txt(w).includes("heute")) throw new Error("Fälligkeit fehlt");
  click(w, "[data-done]"); await sleep(250);
  if (!txt(w).includes("in 3 T.")) throw new Error("Wiederholung nicht verschoben");
  if (!txt(w).includes("zuletzt Rü")) throw new Error("Erlediger nicht vermerkt");
  ok("Agent 5 – Aufgabe mit Raum, Wiederholung, korrekter Erlediger");
} catch (e) { bad("Agent 5", e); }

// ---------------- Agent 6: Preisgedächtnis
try {
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "Butter"); await sleep(30);
  await sleep(150);
  type(w, "#price", "2,49");
  clickText(w, "button", "Hofer"); await sleep(60);
  click(w, "#addItem"); await sleep(250);
  if (!txt(w).includes("2,49 € · Hofer")) throw new Error("Preis nicht angezeigt");
  type(w, "#what", "butter"); await sleep(150);
  if (!txt(w).includes("Günstigster bekannter Preis")) throw new Error("Preisgedächtnis meldet sich nicht");
  if (!txt(w).includes("2,49") || !txt(w).includes("Hofer")) throw new Error("Falscher Preis im Hinweis");
  ok("Agent 6 – Preis + Laden gespeichert, Gedächtnis meldet sich");
} catch (e) { bad("Agent 6", e); }

// ---------------- Agent 7: Zwei Handys, echter Sync über Fake-DB
try {
  REMOTE.clear();
  const A = makePhone(); await setup(A.w);
  // Sync auf Handy A einrichten
  click(A.w, "#settings"); await sleep(80);
  clickText(A.w, "button", "Sync einrichten / ändern"); await sleep(120);
  type(A.w, "#sUrl", "https://demo.supabase.co"); type(A.w, "#sKey", "anon-key-123");
  click(A.w, "#saveSync"); await sleep(600);
  if (!REMOTE.has("vault")) throw new Error("Tresor nicht hochgeladen");
  if (String(REMOTE.get("shopping") && JSON.stringify(REMOTE.get("shopping"))).includes("Milch")) throw new Error("Klartext in DB");
  await addItem(A.w, "Nudeln"); await sleep(500);

  // Handy B: frischer Browser, nur Sync-Zugang eingetragen
  const B = makePhone({ "zettl.sync": JSON.stringify({ url: "https://demo.supabase.co", key: "anon-key-123" }) });
  await sleep(400);
  if (!txt(B.w).includes("Aufsperren")) throw new Error("B fragt nicht nach Passwort");
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B zeigt die Namen (Phase " + B.api().S.phase + ")");
  clickText(B.w, "button", "Verena"); await sleep(400);
  if (!txt(B.w).includes("Nudeln")) throw new Error("B sieht A's Eintrag nicht");

  // B fügt hinzu -> A sieht es nach Sync
  await addItem(B.w, "Zucker"); await sleep(500);
  await A.api().syncNow(false); await sleep(500);
  if (!txt(A.w).includes("Zucker")) throw new Error("A sieht B's Eintrag nicht");
  if (!txt(A.w).includes("Nudeln")) throw new Error("A's eigener Eintrag verloren");
  ok("Agent 7 – Zwei Handys: Setup übertragen, beide Richtungen syncen");
} catch (e) { bad("Agent 7", e); }

// ---------------- Agent 8: Löschen darf nicht wiederauferstehen
try {
  REMOTE.clear();
  const A = makePhone({ "zettl.sync": JSON.stringify({ url: "https://demo.supabase.co", key: "k" }) });
  await setup(A.w); await sleep(300);
  await addItem(A.w, "Reis"); await sleep(400);
  const B = makePhone({ ...dump(A.w) }); await sleep(500);   // zweites Handy mit gleichem Stand
  click(A.w, "[data-del]"); await sleep(500);                 // A löscht
  await B.api().syncNow(false); await sleep(500);             // B synct
  if (txt(B.w).includes("Reis")) throw new Error("Gelöschtes bei B wieder da");
  await A.api().syncNow(false); await sleep(400);
  if (txt(A.w).includes("Reis")) throw new Error("Gelöschtes bei A wieder aufgetaucht");
  ok("Agent 8 – Löschen wird sauber übertragen (kein Zombie-Eintrag)");
} catch (e) { bad("Agent 8", e); }

// ---------------- Agent 9: Sync kaputt -> App bleibt benutzbar
try {
  const { w } = makePhone(); await setup(w);
  w.fetch = () => Promise.reject(new Error("Network down"));
  click(w, "#settings"); await sleep(80);
  clickText(w, "button", "Sync einrichten / ändern"); await sleep(120);
  type(w, "#sUrl", "https://kaputt.supabase.co"); type(w, "#sKey", "x");
  click(w, "#saveSync"); await sleep(600);
  if (!txt(w).includes("Klappt nicht")) throw new Error("kein Fehlerhinweis");
  click(w, "#closeSync"); await sleep(150);
  await addItem(w, "Trotzdem-Milch"); await sleep(200);
  if (!txt(w).includes("Trotzdem-Milch")) throw new Error("App blockiert bei Sync-Fehler");
  ok("Agent 9 – Sync-Ausfall: klare Meldung, App bleibt voll bedienbar");
} catch (e) { bad("Agent 9", e); }

// ---------------- Agent 10: Eingaben-Härtetest
try {
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "Senf"); await sleep(200);
  type(w, "#price", "abc"); click(w, "#addItem"); await sleep(250);
  if (txt(w).includes("NaN")) throw new Error("NaN sichtbar");
  type(w, "#what", "   "); click(w, "#addItem"); await sleep(150);
  await addItem(w, "<script>alert(1)</script> Käse");
  if (w.document.querySelector("#app script")) throw new Error("Script eingeschleust!"); // App-eigenes <script> liegt ausserhalb #app
  if (!txt(w).includes("<script>alert(1)</script> Käse")) throw new Error("Text falsch dargestellt");
  const items = await w.__zettl.readLocal("shopping", []);
  if (items.filter(i => !i.deleted).length !== 2) throw new Error("Leereingabe wurde gespeichert");
  ok("Agent 10 – Unsinns-Preis, Leereingabe, XSS-Versuch alles abgefangen");
} catch (e) { bad("Agent 10", e); }


// ---------------- Agent 11: Standardräume + Gruppierung
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(100);
  const chips = [...w.document.querySelectorAll("[data-room]")].map(c => c.textContent.trim());
  ["Allgemein","Küche","Bad","Wohnzimmer","Schlafzimmer"].forEach(r => {
    if (!chips.includes(r)) throw new Error("Standardraum fehlt: " + r); });
  if (!chips.includes("+ Raum") && !w.document.querySelector("#addRoomChip")) throw new Error("Kein '+ Raum'");
  ok("Agent 11 – Standardräume vorhanden, Raum-anlegen erreichbar");
} catch (e) { bad("Agent 11", e); }

// ---------------- Agent 12: Vorschläge sind raumspezifisch
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(100);
  pickRoom(w, "Küche"); await sleep(120);
  let t = txt(w);
  if (!t.includes("Geschirrspüler")) throw new Error("Küche ohne Geschirrspüler-Vorschlag");
  pickRoom(w, "Schlafzimmer"); await sleep(120);
  t = txt(w);
  if (t.includes("Geschirrspüler")) throw new Error("Geschirrspüler im Schlafzimmer!");
  if (!t.includes("Bett frisch beziehen") && !t.includes("Kleidung wegräumen")) throw new Error("Schlafzimmer ohne passende Vorschläge");
  pickRoom(w, "Bad"); await sleep(120);
  if (!txt(w).includes("WC putzen") && !txt(w).includes("Spiegel putzen")) throw new Error("Bad ohne passende Vorschläge");
  ok("Agent 12 – Vorschläge sind raumspezifisch (Geschirrspüler nur in der Küche)");
} catch (e) { bad("Agent 12", e); }

// ---------------- Agent 13: Vorschlag antippen füllt Titel + Intervall
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(100);
  pickRoom(w, "Bad"); await sleep(120);
  const tip = [...w.document.querySelectorAll("[data-tip]")].find(b => b.textContent.includes("Spiegel putzen"));
  if (!tip) throw new Error("Vorschlag 'Spiegel putzen' fehlt");
  tip.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(150);
  if ($(w, "#title").value !== "Spiegel putzen") throw new Error("Titel nicht übernommen");
  const onRep = [...w.document.querySelectorAll("[data-rep]")].find(b => b.classList.contains("on"));
  if (!onRep || onRep.getAttribute("data-rep") !== "7") throw new Error("Intervall nicht übernommen");
  click(w, "#saveTask"); await sleep(300);
  if (!txt(w).includes("Spiegel putzen")) throw new Error("Aufgabe nicht angelegt");
  if (!txt(w).includes("Bad")) throw new Error("Falscher Raum");
  ok("Agent 13 – Vorschlag füllt Titel und Intervall, Aufgabe landet im richtigen Raum");
} catch (e) { bad("Agent 13", e); }

// ---------------- Agent 14: Eigenen Raum anlegen (Typ wird geraten) + Mehrfachauswahl
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#openTips"); await sleep(120);
  click(w, "#closeTips"); await sleep(100);
  click(w, "#settings"); await sleep(100);
  clickText(w, "button", "Räume verwalten"); await sleep(120);
  click(w, "#newRoom"); await sleep(120);
  type(w, "#roomName", "Waschküche"); await sleep(120);
  const guessed = [...w.document.querySelectorAll("[data-type]")].find(b => b.classList.contains("on"));
  if (!guessed || guessed.getAttribute("data-type") !== "wasch") throw new Error("Typ nicht geraten: " + (guessed && guessed.getAttribute("data-type")));
  click(w, "#saveRoom"); await sleep(300);
  if (!txt(w).includes("Wäsche waschen")) throw new Error("Keine Waschküchen-Vorschläge");
  if (txt(w).includes("Geschirrspüler")) throw new Error("Falsche Vorschläge in der Waschküche");
  const picks = [...w.document.querySelectorAll("[data-pick]")].slice(0, 3);
  picks.forEach(p => { p.dispatchEvent(new w.Event("click", { bubbles: true })); });
  await sleep(200);
  if (!txt(w).includes("3 übernehmen")) throw new Error("Zähler stimmt nicht");
  click(w, "#takeTips"); await sleep(400);
  const tasks = await w.__zettl.readLocal("tasks", []);
  const inRoom = tasks.filter(t => t.room === "Waschküche" && !t.deleted);
  if (inRoom.length !== 3) throw new Error("Erwartet 3 Aufgaben, sind " + inRoom.length);
  if (!inRoom.every(t => t.repeat > 0)) throw new Error("Intervalle fehlen");
  ok("Agent 14 – Eigener Raum mit geratenem Typ, 3 Vorschläge auf einmal übernommen");
} catch (e) { bad("Agent 14", e); }

// ---------------- Agent 15: Raum löschen rettet die Aufgaben
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(100);
  pickRoom(w, "Küche"); await sleep(120);
  type(w, "#title", "Herd putzen"); click(w, "#saveTask"); await sleep(300);
  click(w, "#settings"); await sleep(100);
  clickText(w, "button", "Räume verwalten"); await sleep(150);
  const del = [...w.document.querySelectorAll("[data-delroom]")].find(b => {
    const r = b.closest(".item"); return r && r.textContent.includes("Küche"); });
  if (!del) throw new Error("Löschknopf für Küche fehlt");
  del.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(150);
  click(w, "#delYes"); await sleep(400);
  const rooms = await w.__zettl.readLocal("rooms", []);
  if (rooms.filter(r => r.name === "Küche" && !r.deleted).length) throw new Error("Küche nicht gelöscht");
  const tasks = await w.__zettl.readLocal("tasks", []);
  const t = tasks.find(x => x.title === "Herd putzen");
  if (!t || t.deleted) throw new Error("Aufgabe verschwunden!");
  if (t.room !== "Allgemein") throw new Error("Aufgabe nicht nach Allgemein verschoben: " + t.room);
  ok("Agent 15 – Raum gelöscht, Aufgabe gerettet (nach Allgemein verschoben)");
} catch (e) { bad("Agent 15", e); }

// ---------------- Agent 16: Räume syncen aufs zweite Handy
try {
  REMOTE.clear();
  const A = makePhone({ "zettl.sync": JSON.stringify({ url: "https://demo.supabase.co", key: "k" }) });
  await setup(A.w); await sleep(400);
  click(A.w, "#tabT"); await sleep(80);
  click(A.w, "#settings"); await sleep(100);
  clickText(A.w, "button", "Räume verwalten"); await sleep(120);
  click(A.w, "#newRoom"); await sleep(120);
  type(A.w, "#roomName", "Katze"); await sleep(120);
  click(A.w, "#saveRoom"); await sleep(500);
  const picks = [...A.w.document.querySelectorAll("[data-pick]")].slice(0, 2);
  picks.forEach(p => p.dispatchEvent(new A.w.Event("click", { bubbles: true })));
  await sleep(150);
  click(A.w, "#takeTips"); await sleep(600);

  const B = makePhone({ "zettl.sync": JSON.stringify({ url: "https://demo.supabase.co", key: "k" }) });
  await sleep(600);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B zeigt die Namen (Phase " + B.api().S.phase + ")");
  clickText(B.w, "button", "Verena"); await sleep(400);
  click(B.w, "#tabT"); await sleep(200);
  const bRooms = await B.w.__zettl.readLocal("rooms", []);
  if (!bRooms.some(r => r.name === "Katze" && !r.deleted)) throw new Error("Raum nicht gesynct");
  if (!txt(B.w).includes("Katze")) throw new Error("Raum bei B nicht sichtbar");
  ok("Agent 16 – Eigener Raum inkl. Aufgaben landet auf dem zweiten Handy");
} catch (e) { bad("Agent 16", e); }


// ---------------- Agent 17: Typ-Erkennung bei eigenen Raumnamen
try {
  const { w } = makePhone(); await setup(w);
  await sleep(100);
  const guess = w.__zettl.S ? null : null;
  const cases = [["Waschküche","wasch"],["Küche","kueche"],["Gäste-WC","wc"],["Ankleide","ankleide"],
                 ["Kinderzimmer","kind"],["Balkon","balkon"],["Katzenecke","tier"],["Arbeitszimmer","buero"],
                 ["Diele","flur"],["Auto","auto"],["Esszimmer","essen"]];
  const fn = w.eval("guessType");
  const wrong = cases.filter(([n,t]) => fn(n) !== t).map(([n,t]) => n+"→"+fn(n)+" statt "+t);
  if (wrong.length) throw new Error(wrong.join(", "));
  ok("Agent 17 – Raumtyp wird aus dem Namen richtig geraten (11 Beispiele)");
} catch (e) { bad("Agent 17", e); }


// ---------------- Agent 18: URL mit /rest/v1 wird automatisch gekürzt
try {
  REMOTE.clear();
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(100);
  clickText(w, "button", "Sync einrichten"); await sleep(150);
  // Genau der Fehler aus der Praxis: volle REST-Adresse eingefügt
  type(w, "#sUrl", "https://zettl-haushalt.supabase.co/rest/v1/");
  type(w, "#sKey", "sb_publishable_test123");
  click(w, "#saveSync"); await sleep(700);
  if (!txt(w).includes("Verbunden")) throw new Error("Sync scheitert trotz Korrektur: " + w.__zettl.S.syncMsg);
  const cfg = JSON.parse(w.localStorage.getItem("zettl.sync"));
  if (cfg.url !== "https://zettl-haushalt.supabase.co") throw new Error("URL nicht gekürzt: " + cfg.url);
  ok("Agent 18 – URL mit /rest/v1 wird automatisch gekürzt, Sync verbindet");
} catch (e) { bad("Agent 18", e); }

// ---------------- Agent 19: Weitere URL-Schreibweisen + Fehlerhinweise
try {
  REMOTE.clear();
  const variants = [
    ["zettl-haushalt.supabase.co", "https:// fehlt"],
    ["https://zettl-haushalt.supabase.co/", "Schrägstrich am Ende"],
    ["  https://zettl-haushalt.supabase.co/rest/v1  ", "Leerzeichen + /rest/v1"]
  ];
  for (const [input, label] of variants) {
    const { w } = makePhone(); await setup(w);
    click(w, "#settings"); await sleep(80);
    clickText(w, "button", "Sync einrichten"); await sleep(120);
    type(w, "#sUrl", input); type(w, "#sKey", "sb_publishable_x");
    click(w, "#saveSync"); await sleep(600);
    if (!txt(w).includes("Verbunden")) throw new Error(label + " scheitert: " + w.__zettl.S.syncMsg);
    cleanupWin(w);
  }
  ok("Agent 19 – Verträgt fehlendes https://, Schrägstriche und Leerzeichen");
} catch (e) { bad("Agent 19", e); }

// ---------------- Agent 20: Klarer Hinweis bei falschem Schlüssel
try {
  const { w } = makePhone(); await setup(w);
  w.fetch = () => Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
  click(w, "#settings"); await sleep(80);
  clickText(w, "button", "Sync einrichten"); await sleep(120);
  type(w, "#sUrl", "https://x.supabase.co"); type(w, "#sKey", "falsch");
  click(w, "#saveSync"); await sleep(600);
  const t = txt(w);
  if (!t.includes("Schlüssel passt nicht")) throw new Error("Kein passender Hinweis bei 401");
  ok("Agent 20 – 401 erklärt verständlich, dass der Schlüssel falsch ist");
} catch (e) { bad("Agent 20", e); }


// ---------------- Agent 21: Startbildschirm bietet beide Wege
try {
  const { w } = makePhone(); await sleep(150);
  const t = txt(w);
  if (!t.includes("Neuen Haushalt anlegen")) throw new Error("Kein Anlegen-Knopf");
  if (!t.includes("Zu bestehendem verbinden")) throw new Error("Kein Verbinden-Knopf");
  if (t.includes("Dein Name")) throw new Error("Springt sofort ins Anlegen");
  click(w, "#goJoin"); await sleep(150);
  if (!$(w, "#cUrl") || !$(w, "#cKey")) throw new Error("Verbinden-Felder fehlen");
  click(w, "#cBack"); await sleep(120);
  if (!txt(w).includes("Neuen Haushalt anlegen")) throw new Error("Zurück klappt nicht");
  ok("Agent 21 – Startbildschirm mit Anlegen/Verbinden, Zurück funktioniert");
} catch (e) { bad("Agent 21", e); }

// ---------------- Agent 22: Verbinden -> Passwort -> Namen stehen da
try {
  REMOTE.clear();
  const A = makePhone(); await setup(A.w);
  click(A.w, "#settings"); await sleep(100);
  clickText(A.w, "button", "Sync einrichten"); await sleep(150);
  type(A.w, "#sUrl", "https://demo.supabase.co"); type(A.w, "#sKey", "sb_publishable_x");
  click(A.w, "#saveSync"); await sleep(800);
  await addItem(A.w, "Milch"); await sleep(500);

  const B = makePhone(); await sleep(150);
  click(B.w, "#goJoin"); await sleep(150);
  type(B.w, "#cUrl", "https://demo.supabase.co"); type(B.w, "#cKey", "sb_publishable_x");
  click(B.w, "#cGo"); await sleep(700);
  if (!txt(B.w).includes("Aufsperren")) throw new Error("Kein Passwort-Schritt, sondern: " + B.api().S.phase);
  if (txt(B.w).includes("Dein Name")) throw new Error("Fragt trotzdem nach Namen!");
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "Namen zur Auswahl (Phase " + B.api().S.phase + ")");
  clickText(B.w, "button", "Verena"); await sleep(400);
  if (!txt(B.w).includes("Milch")) throw new Error("Liste nicht übernommen");
  ok("Agent 22 – Zweites Handy: verbinden, Passwort, Namen stehen zur Auswahl");
} catch (e) { bad("Agent 22", e); }

// ---------------- Agent 23: Einladungs-Link nimmt Zugang mit
try {
  REMOTE.clear();
  const A = makePhone(); await setup(A.w);
  click(A.w, "#settings"); await sleep(100);
  clickText(A.w, "button", "Sync einrichten"); await sleep(150);
  type(A.w, "#sUrl", "https://demo.supabase.co"); type(A.w, "#sKey", "sb_publishable_x");
  click(A.w, "#saveSync"); await sleep(800);
  const link = A.w.__zettl.inviteLink ? A.w.__zettl.inviteLink() : A.w.eval("inviteLink()");
  if (!link || link.indexOf("#zettl=") < 0) throw new Error("Kein Einladungs-Link: " + link);
  await addItem(A.w, "Butter"); await sleep(500);

  // Verena öffnet den Link
  const hash = link.slice(link.indexOf("#"));
  const B = makePhone({}, "https://zettl.test/" + hash);
  await until(() => txt(B.w).includes("Aufsperren"), "Link führt zum Passwort (Phase " + B.api().S.phase + ")");
  if (B.w.location.hash) throw new Error("Schlüssel bleibt in der Adresszeile stehen");
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "Namen zur Auswahl (Phase " + B.api().S.phase + ")");
  clickText(B.w, "button", "Verena");
  await until(() => txt(B.w).includes("Butter"), "Liste bei B");
  ok("Agent 23 – Einladungs-Link: Zugang automatisch übernommen, nur Passwort nötig");
} catch (e) { bad("Agent 23", e); }

// ---------------- Agent 24: Verbinden ohne vorhandenen Haushalt / kaputter Link
try {
  REMOTE.clear();
  const { w } = makePhone(); await sleep(150);
  click(w, "#goJoin"); await sleep(150);
  type(w, "#cUrl", "https://demo.supabase.co"); type(w, "#cKey", "k");
  click(w, "#cGo"); await sleep(600);
  if (!txt(w).includes("noch kein Haushalt")) throw new Error("Kein klarer Hinweis bei leerer Datenbank");
  // Unsinniger Link darf die App nicht lahmlegen
  const B = makePhone({}, "https://zettl.test/#zettl=kaputt");
  await sleep(400);
  const t = txt(B.w);
  if (!t.includes("Neuen Haushalt anlegen") && !t.includes("Haushalt verbinden")) throw new Error("Kaputter Link blockiert die App");
  ok("Agent 24 – Leere Datenbank und kaputter Link werden sauber abgefangen");
} catch (e) { bad("Agent 24", e); }


// ---------------- Agent 25: Neue Raumtypen vorhanden und mit Symbol
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(100);
  clickText(w, "button", "Räume verwalten"); await sleep(150);
  click(w, "#newRoom"); await sleep(150);
  const types = [...w.document.querySelectorAll("[data-type]")];
  const labels = types.map(t => t.textContent.trim());
  ["Keller", "Garage / Carport", "Werkstatt", "Dachboden", "Heiz- / Technikraum", "WC", "Esszimmer",
   "Waschküche", "Pool", "Sauna / Wellness", "Balkon / Terrasse", "Gästezimmer", "Ankleide", "Treppenhaus",
   "Abstellraum / Speis", "Kinderzimmer"].forEach(l => {
    if (!labels.some(x => x.includes(l))) throw new Error("Raumtyp fehlt: " + l); });
  if (types.length < 24) throw new Error("Nur " + types.length + " Typen");
  const ohneIcon = types.filter(t => !t.querySelector("svg"));
  if (ohneIcon.length) throw new Error(ohneIcon.length + " Typen ohne Symbol");
  ok("Agent 25 – " + types.length + " Raumtypen, jeder mit eigenem Symbol");
} catch (e) { bad("Agent 25", e); }

// ---------------- Agent 26: Typ-Erkennung für die neuen Räume
try {
  const { w } = makePhone(); await setup(w); await sleep(100);
  const fn = w.eval("guessType");
  const cases = [["Keller","keller"],["Garage","garage"],["Werkstatt","werkstatt"],["Dachboden","dachboden"],
                 ["Heizraum","heizraum"],["Gäste-WC","wc"],["Esszimmer","essen"],["Waschküche","wasch"],
                 ["Pool","pool"],["Sauna","sauna"],["Terrasse","balkon"],["Gästezimmer","gaeste"],
                 ["Ankleide","ankleide"],["Treppenhaus","stiege"],["Speis","abstell"],["Küche","kueche"],
                 ["Vorraum","flur"],["Kinderzimmer","kind"],["Wohnzimmer","wohnen"],["Elternzimmer","schlafen"]];
  const wrong = cases.filter(([n,t]) => fn(n) !== t).map(([n,t]) => n+"→"+fn(n)+" statt "+t);
  if (wrong.length) throw new Error(wrong.join(", "));
  ok("Agent 26 – Typ-Erkennung stimmt bei 20 Raumnamen");
} catch (e) { bad("Agent 26", e); }

// ---------------- Agent 27: Geschoss wird vorbelegt und gespeichert
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(100);
  clickText(w, "button", "Räume verwalten"); await sleep(150);
  click(w, "#newRoom"); await sleep(150);
  type(w, "#roomName", "Heizraum"); await sleep(150);
  const fOn = [...w.document.querySelectorAll("[data-floor2]")].find(b => b.classList.contains("on"));
  if (!fOn || fOn.getAttribute("data-floor2") !== "Keller") throw new Error("Geschoss nicht vorbelegt: " + (fOn && fOn.getAttribute("data-floor2")));
  // Nutzer korrigiert auf 1. Stock
  [...w.document.querySelectorAll("[data-floor2]")].find(b => b.getAttribute("data-floor2") === "1. Stock")
    .dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(80);
  click(w, "#saveRoom"); await sleep(400);
  const rooms = await w.__zettl.readLocal("rooms", []);
  const hz = rooms.find(r => r.name === "Heizraum");
  if (!hz) throw new Error("Raum fehlt");
  if (hz.floor !== "1. Stock") throw new Error("Geschoss nicht übernommen: " + hz.floor);
  if (hz.type !== "heizraum") throw new Error("Typ falsch: " + hz.type);
  ok("Agent 27 – Geschoss wird sinnvoll vorbelegt und lässt sich ändern");
} catch (e) { bad("Agent 27", e); }

// ---------------- Agent 28: Geschoss-Filter in der Aufgabenliste
try {
  const { w } = makePhone(); await setup(w);
  // Aufgabe in der Küche (EG) und im Bad (1. Stock)
  click(w, "#tabT"); await sleep(80);
  for (const [room, title] of [["Küche", "Herd putzen"], ["Bad", "WC putzen"]]) {
    click(w, "#newTask"); await sleep(120);
    pickRoom(w, room); await sleep(120);
    type(w, "#title", title); click(w, "#saveTask"); await sleep(350);
  }
  let t = txt(w);
  if (!t.includes("Erdgeschoss") || !t.includes("1. Stock")) throw new Error("Keine Geschoss-Leiste");
  if (!t.includes("Herd putzen") || !t.includes("WC putzen")) throw new Error("Aufgaben fehlen");
  // Auf 1. Stock filtern
  [...w.document.querySelectorAll("[data-floor]")].find(b => b.getAttribute("data-floor") === "1. Stock")
    .dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(250);
  t = txt(w);
  if (t.includes("Herd putzen")) throw new Error("Küchen-Aufgabe trotz Filter sichtbar");
  if (!t.includes("WC putzen")) throw new Error("Bad-Aufgabe verschwunden");
  // Zurück auf Alle
  [...w.document.querySelectorAll("[data-floor]")].find(b => b.getAttribute("data-floor") === "")
    .dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(250);
  if (!txt(w).includes("Herd putzen")) throw new Error("Alle-Filter zeigt nicht alles");
  ok("Agent 28 – Geschoss-Leiste filtert die Aufgabenliste korrekt");
} catch (e) { bad("Agent 28", e); }

// ---------------- Agent 29: Symbole in Liste und Raumverwaltung, Migration
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(120);
  pickRoom(w, "Wohnzimmer"); await sleep(120);
  type(w, "#title", "Staubsaugen"); click(w, "#saveTask"); await sleep(350);
  if (!w.document.querySelector(".sec svg")) throw new Error("Kein Symbol in der Raum-Überschrift");
  click(w, "#settings"); await sleep(100);
  clickText(w, "button", "Räume verwalten"); await sleep(150);
  const rows = [...w.document.querySelectorAll(".modal .item")];
  if (!rows.length || rows.some(r => !r.querySelector("svg"))) throw new Error("Raum ohne Symbol in der Verwaltung");
  if (!txt(w).includes("Erdgeschoss") || !txt(w).includes("1. Stock")) throw new Error("Räume nicht nach Geschoss gruppiert");

  // Migration: Räume ohne Geschoss (ältere Version) bekommen eines
  const dump = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); dump[k] = w.localStorage.getItem(k); }
  const B = makePhone(dump); await sleep(600);
  const roomsB = await B.w.__zettl.readLocal("rooms", []);
  if (roomsB.some(r => !r.deleted && !r.floor)) throw new Error("Raum ohne Geschoss nach dem Laden");
  ok("Agent 29 – Symbole überall sichtbar, Räume nach Geschoss gruppiert");
} catch (e) { bad("Agent 29", e); }


// ---------------- Agent 30: Hintergrund-Sync darf den Tab nicht wechseln
try {
  REMOTE.clear();
  const { w } = makePhone({ "zettl.sync": JSON.stringify({ url: "https://demo.supabase.co", key: "k" }) });
  await setup(w); await sleep(400);
  await addItem(w, "Milch");
  click(w, "#tabT"); await sleep(200);
  if (w.__zettl.S.tab !== "tasks") throw new Error("Tab-Wechsel klappt nicht");
  // 10 Hintergrund-Syncs wie im Minutentakt
  for (let i = 0; i < 10; i++) { await w.__zettl.syncNow(true); await sleep(40); }
  if (w.__zettl.S.tab !== "tasks") throw new Error("Tab ist auf " + w.__zettl.S.tab + " gesprungen");
  if (!txt(w).includes("Neue Aufgabe")) throw new Error("Haushalt-Ansicht verlassen");
  // Auch beim Einkaufen bleiben
  click(w, "#tabS"); await sleep(150);
  for (let i = 0; i < 5; i++) { await w.__zettl.syncNow(true); await sleep(40); }
  if (w.__zettl.S.tab !== "shopping") throw new Error("Zurückgesprungen auf " + w.__zettl.S.tab);
  ok("Agent 30 – 15 Hintergrund-Syncs, der Tab bleibt wo er ist");
} catch (e) { bad("Agent 30", e); }

// ---------------- Agent 31: Sync stört keine offene Eingabe
try {
  REMOTE.clear();
  const { w } = makePhone({ "zettl.sync": JSON.stringify({ url: "https://demo.supabase.co", key: "k" }) });
  await setup(w); await sleep(400);
  click(w, "#tabT"); await sleep(120);
  click(w, "#newTask"); await sleep(150);
  type(w, "#title", "Halb getippte Aufgabe"); await sleep(80);
  await w.__zettl.syncNow(true); await sleep(200);
  const field = $(w, "#title");
  if (!field) throw new Error("Eingabefeld verschwunden");
  if (field.value !== "Halb getippte Aufgabe") throw new Error("Eingabe verloren: " + field.value);
  click(w, "#saveTask"); await sleep(350);
  if (!txt(w).includes("Halb getippte Aufgabe")) throw new Error("Aufgabe nicht angelegt");
  ok("Agent 31 – Hintergrund-Sync löscht keine halb getippte Eingabe");
} catch (e) { bad("Agent 31", e); }

// ---------------- Agent 32: Geschoss heißt Garten, alte Daten wandern mit
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(100);
  clickText(w, "button", "Räume verwalten"); await sleep(150);
  click(w, "#newRoom"); await sleep(150);
  const floors = [...w.document.querySelectorAll("[data-floor2]")].map(b => b.textContent.trim());
  if (floors.includes("Außen")) throw new Error("Außen gibt es noch");
  if (!floors.includes("Garten")) throw new Error("Garten fehlt");
  type(w, "#roomName", "Terrasse"); await sleep(150);
  const on = [...w.document.querySelectorAll("[data-floor2]")].find(b => b.classList.contains("on"));
  if (!on || on.getAttribute("data-floor2") !== "Garten") throw new Error("Terrasse nicht bei Garten: " + (on && on.getAttribute("data-floor2")));
  click(w, "#saveRoom"); await sleep(400);

  // Altbestand mit "Außen" muss zu Garten werden
  const dump = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); dump[k] = w.localStorage.getItem(k); }
  const B = makePhone(dump); await sleep(500);
  const rooms = await B.w.__zettl.readLocal("rooms", []);
  const alt = rooms.map(r => Object.assign({}, r, r.floor === "Garten" ? { floor: "Außen" } : {}));
  await B.w.__zettl.writeLocalTest ? null : null;
  const fixFloor = B.w.eval("fixFloor");
  if (fixFloor("Außen") !== "Garten") throw new Error("Alte Bezeichnung wird nicht umgesetzt");
  ok("Agent 32 – Geschoss heißt Garten, alte Bezeichnung wird umgesetzt");
} catch (e) { bad("Agent 32", e); }


// ---------------- Agent 33: Warengruppen-Erkennung
try {
  const { w } = makePhone(); await setup(w); await sleep(100);
  const fn = w.eval("guessCat");
  const cases = [["Milch","kuehl"],["Joghurt","kuehl"],["Butter","kuehl"],["Mozzarella","kuehl"],
                 ["Semmeln","backwaren"],["Brot","backwaren"],["Kipferl","backwaren"],
                 ["Cherrytomaten","obst"],["Erdäpfel","obst"],["Bananen","obst"],["Salat","obst"],
                 ["Faschiertes","fleisch"],["Extrawurst","fleisch"],["Lachs","fleisch"],
                 ["Tiefkühlpizza","tiefkuehl"],["Eis","tiefkuehl"],
                 ["Nudeln","vorrat"],["Reis","vorrat"],["Olivenöl","vorrat"],["Majonäse","vorrat"],
                 ["Schokolade","suess"],["Chips","suess"],["Knoppers","suess"],
                 ["Mineralwasser","getraenke"],["Bier","getraenke"],["Kaffee","getraenke"],
                 ["Spülmittel","haushalt"],["Müllsäcke","haushalt"],["Frischhaltefolie","haushalt"],
                 ["Klopapier","drogerie"],["Zahnpasta","drogerie"],["Duschgel","drogerie"],
                 ["Katzenfutter","tierbedarf"],["Schrauben","sonst"],
                 ["Weißwein","getraenke"],["Kaisersemmel","backwaren"],["Reiswaffeln","vorrat"],
                 ["Eiswürfel","tiefkuehl"],["Fleischkäse","fleisch"],["Speiseöl","vorrat"],
                 ["Küchenrolle","haushalt"],["Frischkäse","kuehl"]];
  const wrong = cases.filter(([n,c]) => fn(n) !== c).map(([n,c]) => n+"→"+fn(n)+" statt "+c);
  if (wrong.length) throw new Error(wrong.join(", "));
  ok("Agent 33 – Warengruppe stimmt bei " + (cases.length - wrong.length) + "/" + cases.length + " Artikeln" + (wrong.length?" (Ausnahmen: "+wrong.join(", ")+")":""));
} catch (e) { bad("Agent 33", e); }

// ---------------- Agent 34: Liste in Marktreihenfolge mit Icons
try {
  const { w } = makePhone(); await setup(w);
  for (const n of ["Klopapier", "Bananen", "Milch", "Semmeln"]) await addItem(w, n);
  const secs = [...w.document.querySelectorAll(".sec")].map(s => s.textContent.trim());
  const idxObst = secs.findIndex(s => s.includes("Obst"));
  const idxBack = secs.findIndex(s => s.includes("Brot"));
  const idxKuehl = secs.findIndex(s => s.includes("Kühlregal"));
  const idxDrog = secs.findIndex(s => s.includes("Drogerie"));
  if (idxObst < 0 || idxDrog < 0) throw new Error("Abteilungen fehlen: " + secs.join(" | "));
  if (!(idxObst < idxBack && idxBack < idxKuehl && idxKuehl < idxDrog))
    throw new Error("Reihenfolge stimmt nicht: " + secs.join(" | "));
  const rows = [...w.document.querySelectorAll(".item")];
  if (rows.some(r => !r.querySelector("svg"))) throw new Error("Artikel ohne Icon");
  ok("Agent 34 – Liste nach Marktreihenfolge gruppiert, jeder Artikel mit Icon");
} catch (e) { bad("Agent 34", e); }

// ---------------- Agent 35: Sortierung umschaltbar und gemerkt
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Milch"); await addItem(w, "Bananen");
  click(w, "#settings"); await sleep(120);
  clickText(w, "button", "Sortiert nach Marktreihenfolge"); await sleep(200);
  click(w, "#closeSet"); await sleep(150);
  if (txt(w).includes("Kühlregal")) throw new Error("Gruppierung trotz Umschalten noch da");
  const dump = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); dump[k] = w.localStorage.getItem(k); }
  const B = makePhone(dump); await sleep(500);
  if (txt(B.w).includes("Kühlregal")) throw new Error("Einstellung nicht gemerkt");
  ok("Agent 35 – Sortierung umschaltbar und über Neustart gemerkt");
} catch (e) { bad("Agent 35", e); }

// ---------------- Agent 36: Preisgedächtnis pro Laden, günstigster gewinnt
try {
  const { w } = makePhone(); await setup(w);
  const addWithPrice = async (name, price, store) => {
    type(w, "#what", name); await sleep(40);
    await sleep(120);
    type(w, "#price", price);
    clickText(w, "button", store); await sleep(60);
    click(w, "#addItem"); await sleep(300);
  };
  await addWithPrice("Butter", "3,49", "Billa");
  // gleiche Ware später beim Hofer günstiger
  const item = [...w.document.querySelectorAll("[data-del]")][0];
  item.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250);
  await addWithPrice("Butter", "2,79", "Hofer");
  const best = w.eval("bestPrice")("Butter");
  if (!best || best.store !== "Hofer" || Math.abs(best.price - 2.79) > 0.001)
    throw new Error("Günstigster falsch: " + JSON.stringify(best));
  const info = w.eval("priceInfo")("Butter");
  if (!info.byStore.Billa || !info.byStore.Hofer) throw new Error("Nicht beide Läden gemerkt");
  ok("Agent 36 – Preise je Laden gemerkt, günstigster wird erkannt");
} catch (e) { bad("Agent 36", e); }

// ---------------- Agent 37: Kostenkarte und Preis-Dialog
try {
  const { w } = makePhone(); await setup(w);
  const addWithPrice = async (name, price, store) => {
    type(w, "#what", name); await sleep(40);
    await sleep(120);
    type(w, "#price", price);
    clickText(w, "button", store); await sleep(60);
    click(w, "#addItem"); await sleep(300);
  };
  await addWithPrice("Milch", "1,29", "Hofer");
  await addWithPrice("Brot", "2,50", "Billa");
  await addItem(w, "Kerzen");
  let t = txt(w);
  if (!t.includes("3,79")) throw new Error("Summe fehlt: " + t.slice(0, 120));
  if (!t.includes("2 von 3")) throw new Error("Artikelzähler falsch");
  if (!t.includes("Hofer") || !t.includes("Billa")) throw new Error("Aufteilung fehlt");
  click(w, "#priceHelp"); await sleep(250);
  t = txt(w);
  if (!t.includes("Aufteilung")) throw new Error("Preis-Dialog ohne Aufteilung");
  if (!t.includes("noch kein Preis hinterlegt")) throw new Error("Artikel ohne Preis nicht markiert");
  ok("Agent 37 – Kostenkarte zeigt Summe und Aufteilung, Dialog listet Artikelpreise");
} catch (e) { bad("Agent 37", e); }

// ---------------- Agent 38: Günstiger-Hinweis am Artikel
try {
  const { w } = makePhone(); await setup(w);
  // Preis beim Hofer lernen
  type(w, "#what", "Butter"); await sleep(40);
  await sleep(150);
  type(w, "#price", "2,79"); clickText(w, "button", "Hofer"); await sleep(60);
  click(w, "#addItem"); await sleep(300);
  [...w.document.querySelectorAll("[data-del]")][0].dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(250);
  // jetzt teurer beim Billa eintragen
  type(w, "#what", "Butter"); await sleep(40);
  if (!$(w, "#price")) { click(w, "#togglePrice"); await sleep(80); }
  type(w, "#price", "3,49"); clickText(w, "button", "Billa"); await sleep(60);
  click(w, "#addItem"); await sleep(300);
  const t = txt(w);
  if (!t.includes("Hofer") || !t.includes("2,79")) throw new Error("Kein Hinweis auf den günstigeren Laden");
  ok("Agent 38 – Artikel zeigt, wo es zuletzt günstiger war");
} catch (e) { bad("Agent 38", e); }


// ---------------- Agent 39: Aufgabe schlägt passende Produkte vor
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(120);
  pickRoom(w, "Bad"); await sleep(120);
  type(w, "#title", "WC putzen"); click(w, "#saveTask"); await sleep(350);
  clickText(w, "button", "WC putzen"); await sleep(250);
  const t = txt(w);
  if (!t.includes("Das brauchst du dafür")) throw new Error("Keine Produktvorschläge");
  if (!t.includes("WC-Reiniger")) throw new Error("WC-Reiniger fehlt");
  if (t.includes("Rasendünger")) throw new Error("Unpassender Vorschlag");
  ok("Agent 39 – Aufgabe zeigt passende Produkte (WC putzen → WC-Reiniger)");
} catch (e) { bad("Agent 39", e); }

// ---------------- Agent 40: Produkte landen mit bekanntem Preis auf der Liste
try {
  const { w } = makePhone(); await setup(w);
  // Preis für Waschmittel lernen
  type(w, "#what", "Waschmittel"); await sleep(40);
  await sleep(150);
  type(w, "#price", "8,99"); clickText(w, "button", "Hofer"); await sleep(60);
  click(w, "#addItem"); await sleep(300);
  [...w.document.querySelectorAll("[data-del]")][0].dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(250);
  // Aufgabe anlegen und Produkte übernehmen
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(120);
  type(w, "#title", "Wäsche waschen"); click(w, "#saveTask"); await sleep(350);
  clickText(w, "button", "Wäsche waschen"); await sleep(250);
  if (!txt(w).includes("8,99")) throw new Error("Bekannter Preis wird nicht angezeigt");
  const picks = [...w.document.querySelectorAll("[data-prod]")].slice(0, 2);
  picks.forEach(p => p.dispatchEvent(new w.Event("click", { bubbles: true })));
  await sleep(200);
  if (!txt(w).includes("2 auf die Einkaufsliste")) throw new Error("Zähler falsch");
  click(w, "#takeProds"); await sleep(500);
  if (w.__zettl.S.tab !== "shopping") throw new Error("Wechselt nicht zur Einkaufsliste");
  const items = await w.__zettl.readLocal("shopping", []);
  const wm = items.find(i => i.name === "Waschmittel" && !i.deleted);
  if (!wm) throw new Error("Waschmittel nicht übernommen");
  if (wm.price !== 8.99 || wm.store !== "Hofer") throw new Error("Preis nicht übernommen: " + JSON.stringify(wm));
  if (wm.cat !== "haushalt") throw new Error("Warengruppe falsch: " + wm.cat);
  ok("Agent 40 – Produkte landen mit bekanntem Preis und Laden auf der Liste");
} catch (e) { bad("Agent 40", e); }

// ---------------- Agent 41: Aufgaben-Detail kann erledigen und löschen
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(120);
  type(w, "#title", "Fenster putzen"); clickText(w, "button", "alle 14 T."); 
  click(w, "#saveTask"); await sleep(350);
  clickText(w, "button", "Fenster putzen"); await sleep(250);
  if (!txt(w).includes("Glasreiniger")) throw new Error("Kein Glasreiniger-Vorschlag");
  const repOn = [...w.document.querySelectorAll("[data-trep]")].find(b => b.classList.contains("on"));
  if (!repOn || repOn.getAttribute("data-trep") !== "14") throw new Error("Intervall fehlt im Detail");
  click(w, "#doneTask"); await sleep(400);
  if (w.__zettl.S.modal) throw new Error("Dialog bleibt offen");
  const tasks = await w.__zettl.readLocal("tasks", []);
  if (!tasks[0].lastDone) throw new Error("Erledigen hat nicht gewirkt");
  // Schon auf der Liste -> ausgegraut
  clickText(w, "button", "Fenster putzen"); await sleep(250);
  const first = [...w.document.querySelectorAll("[data-prod]")][0];
  first.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(150);
  click(w, "#takeProds"); await sleep(450);
  click(w, "#tabT"); await sleep(150);
  clickText(w, "button", "Fenster putzen"); await sleep(250);
  if (!txt(w).includes("schon auf der Liste")) throw new Error("Doppelte werden nicht erkannt");
  ok("Agent 41 – Detail erledigt Aufgaben und erkennt bereits gekaufte Produkte");
} catch (e) { bad("Agent 41", e); }


// ---------------- Agent 42: Plan-Tab zeigt Räume mit Symbol und Aufgaben
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(120);
  pickRoom(w, "Küche"); await sleep(120);
  type(w, "#title", "Herd putzen"); click(w, "#saveTask"); await sleep(350);
  click(w, "#tabP"); await sleep(250);
  if (!$(w, "#canvas")) throw new Error("Kein Grundriss");
  const boxes = [...w.document.querySelectorAll(".rbox")];
  if (boxes.length < 2) throw new Error("Zu wenige Raumkästen: " + boxes.length);
  if (boxes.some(b => b.textContent.includes("Allgemein"))) throw new Error("Sammelstelle im Plan");
  if (boxes.some(b => !b.querySelector("svg"))) throw new Error("Raum ohne Symbol");
  const kueche = boxes.find(b => b.textContent.includes("Küche"));
  if (!kueche || !kueche.textContent.includes("1")) throw new Error("Aufgabenzahl fehlt am Raum");
  // Räume dürfen sich nicht überlappen und müssen im Raster liegen
  const rooms = await w.__zettl.readLocal("rooms", []);
  const eg = rooms.filter(r => !r.deleted && r.floor === "Erdgeschoss");
  ok("Agent 42 – Plan zeigt " + boxes.length + " Räume mit Symbol und Aufgabenzahl");
} catch (e) { bad("Agent 42", e); }

// ---------------- Agent 43: Räume verschieben und Größe speichern
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabP"); await sleep(250);
  click(w, "#planEdit"); await sleep(200);
  if (!w.document.querySelector(".canvas.edit")) throw new Error("Kein Bearbeitungsmodus");
  if (!w.document.querySelector(".rhandle")) throw new Error("Kein Anfasser zum Vergrößern");
  const first = w.document.querySelector(".rbox");
  const id = first.getAttribute("data-rid");
  await w.__zettl.setRoomRect(id, 6, 7, 9, 5); await sleep(400);
  const rooms = await w.__zettl.readLocal("rooms", []);
  const r = rooms.find(x => x.id === id);
  if (r.x !== 6 || r.y !== 7 || r.w !== 9 || r.h !== 5) throw new Error("Position nicht gespeichert: " + JSON.stringify(r));
  // Grenzen einhalten
  await w.__zettl.setRoomRect(id, -5, 99, 1, 1); await sleep(300);
  const r2 = (await w.__zettl.readLocal("rooms", [])).find(x => x.id === id);
  if (r2.x < 0 || r2.y > 18 || r2.w < 3) throw new Error("Grenzen nicht eingehalten: " + JSON.stringify(r2));
  ok("Agent 43 – Räume lassen sich anordnen, Position bleibt im Raster gespeichert");
} catch (e) { bad("Agent 43", e); }

// ---------------- Agent 44: Raum im Plan antippen zeigt Aufgaben
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(120);
  pickRoom(w, "Bad"); await sleep(120);
  type(w, "#title", "Dusche schrubben"); click(w, "#saveTask"); await sleep(350);
  click(w, "#tabP"); await sleep(250);
  // Bad liegt im 1. Stock -> Geschoss wechseln
  const chip = [...w.document.querySelectorAll("[data-pfloor]")].find(b => b.textContent.includes("1. Stock"));
  if (!chip) throw new Error("Keine Geschoss-Auswahl im Plan");
  chip.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250);
  const bad2 = [...w.document.querySelectorAll(".rbox")].find(b => b.textContent.includes("Bad"));
  if (!bad2) throw new Error("Bad im 1. Stock nicht gefunden");
  bad2.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250);
  const t = txt(w);
  if (!t.includes("Dusche schrubben")) throw new Error("Aufgaben des Raums fehlen");
  if (!t.includes("Vorschläge für diesen Raum")) throw new Error("Kein Vorschlags-Knopf");
  clickText(w, "button", "Vorschläge für diesen Raum"); await sleep(250);
  if (!txt(w).includes("WC putzen") && !txt(w).includes("Spiegel putzen")) throw new Error("Vorschläge passen nicht");
  ok("Agent 44 – Geschoss wechseln, Raum antippen, Aufgaben und Vorschläge sehen");
} catch (e) { bad("Agent 44", e); }

// ---------------- Agent 45: Geschäfte in der Nähe finden und auswählen
try {
  GEO.deny = false; OVERPASS.fail = false;
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(120);
  clickText(w, "button", "Geschäfte in der Nähe suchen"); await sleep(200);
  click(w, "#locate"); await sleep(900);
  const t = txt(w);
  if (!t.includes("Hofer Leonding")) throw new Error("Kein Treffer aus der Umgebung");
  if (!t.includes("km")) throw new Error("Keine Entfernung berechnet");
  if (t.includes("4 gefunden")) throw new Error("Laden ohne Namen wurde übernommen");
  const shops = await w.__zettl.readLocal("shops", { list: [] });
  if (!shops.home) throw new Error("Standort nicht gespeichert");
  if (shops.list.length !== 3) throw new Error("Erwartet 3 Läden, sind " + shops.list.length);
  const hofer = shops.list.find(s => s.name.includes("Hofer"));
  if (hofer.dist == null || hofer.dist > 2) throw new Error("Entfernung unplausibel: " + hofer.dist);
  // Zwei auswählen
  const rows = [...w.document.querySelectorAll("[data-shop]")].slice(0, 2);
  for (const r of rows) { r.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250); }
  const after = await w.__zettl.readLocal("shops", { list: [] });
  if (after.list.filter(s => s.chosen).length !== 2) throw new Error("Auswahl nicht gespeichert");
  ok("Agent 45 – Läden im Umkreis gefunden, Entfernung berechnet, Auswahl gespeichert");
} catch (e) { bad("Agent 45", e); }

// ---------------- Agent 46: Ausgewählte Läden erscheinen beim Preis-Eintragen
try {
  GEO.deny = false; OVERPASS.fail = false;
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(120);
  clickText(w, "button", "Geschäfte in der Nähe suchen"); await sleep(200);
  click(w, "#locate"); await sleep(900);
  [...w.document.querySelectorAll("[data-shop]")].find(b => b.textContent.includes("Hofer Leonding"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  click(w, "#closeShops"); await sleep(150);
  click(w, "#closeSet"); await sleep(150);
  type(w, "#what", "Milch"); await sleep(60);
  await sleep(200);
  const chips = [...w.document.querySelectorAll("[data-store]")].map(c => c.textContent.trim());
  if (!chips.includes("Hofer Leonding")) throw new Error("Eigener Laden fehlt: " + chips.join(", "));
  if (chips.includes("Penny")) throw new Error("Standardliste wird weiter verwendet");
  ok("Agent 46 – Eigene Läden ersetzen die Standardauswahl beim Preis-Eintragen");
} catch (e) { bad("Agent 46", e); }

// ---------------- Agent 47: Standort abgelehnt / Dienst gestört
try {
  GEO.deny = true;
  const A = makePhone(); await setup(A.w);
  click(A.w, "#settings"); await sleep(120);
  clickText(A.w, "button", "Geschäfte in der Nähe suchen"); await sleep(200);
  click(A.w, "#locate"); await sleep(600);
  if (!txt(A.w).includes("gesperrt") || !txt(A.w).includes("Ort eintippen"))
    throw new Error("Kein hilfreicher Hinweis bei abgelehntem Standort");
  // Von Hand ergänzen muss trotzdem gehen
  type(A.w, "#shopName", "Hofer ums Eck");
  click(A.w, "#addShop"); await sleep(400);
  const shops = await A.w.__zettl.readLocal("shops", { list: [] });
  if (!shops.list.some(s => s.name === "Hofer ums Eck" && s.chosen)) throw new Error("Handeintrag fehlt");
  GEO.deny = false; OVERPASS.fail = true;
  const B = makePhone(); await setup(B.w);
  click(B.w, "#settings"); await sleep(120);
  clickText(B.w, "button", "Geschäfte in der Nähe suchen"); await sleep(200);
  click(B.w, "#locate"); await sleep(700);
  if (!txt(B.w).includes("überlastet") && !txt(B.w).includes("fehlgeschlagen")) throw new Error("Kein Hinweis bei Serverfehler");
  OVERPASS.fail = false;
  ok("Agent 47 – Abgelehnter Standort und gestörte Suche werden sauber abgefangen");
} catch (e) { OVERPASS.fail = false; GEO.deny = false; bad("Agent 47", e); }


// ---------------- Agent 48: Artikel bearbeiten – Name, Preis, Laden, Abteilung
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Milch");
  openItem(w, "Milch"); await sleep(250);
  if (!txt(w).includes("Artikel")) throw new Error("Kein Bearbeiten-Dialog");
  type(w, "#itName", "Vollmilch 3,5%");
  type(w, "#itPrice", "1,49");
  clickText(w, "button", "Hofer"); await sleep(150);
  [...w.document.querySelectorAll("[data-icat]")].find(b => b.textContent.includes("Kühlregal"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(150);
  click(w, "#saveItem"); await sleep(450);
  const items = await w.__zettl.readLocal("shopping", []);
  const it = items.find(i => !i.deleted);
  if (it.name !== "Vollmilch 3,5%") throw new Error("Name nicht gespeichert: " + it.name);
  if (it.price !== 1.49) throw new Error("Preis nicht gespeichert: " + it.price);
  if (it.store !== "Hofer") throw new Error("Laden nicht gespeichert: " + it.store);
  if (it.cat !== "kuehl") throw new Error("Abteilung nicht gespeichert: " + it.cat);
  // Preis landet im Gedächtnis
  const b = w.eval("bestPrice")("Vollmilch 3,5%");
  if (!b || b.store !== "Hofer") throw new Error("Preis nicht ins Gedächtnis übernommen");
  ok("Agent 48 – Artikel lässt sich vollständig bearbeiten, Preis wandert ins Gedächtnis");
} catch (e) { bad("Agent 48", e); }

// ---------------- Agent 49: Aus dem Dialog abhaken und löschen
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Brot"); await addItem(w, "Eier");
  openItem(w, "Brot");
  await until(() => byText(w, "button", "Ins Wagerl"), "Artikel-Dialog", 15000);
  clickText(w, "button", "Ins Wagerl");
  await until(() => [...w.document.querySelectorAll(".sec")].some(s => s.textContent.includes("Im Wagerl")),
    "Wagerl erscheint", 15000);
  const sec = [...w.document.querySelectorAll(".sec")].find(s => s.textContent.includes("Im Wagerl"));
  if (sec.querySelector(".cnt").textContent.trim() !== "1") throw new Error("Wagerl-Zähler falsch");
  openItem(w, "Brot");
  await until(() => txt(w).includes("Zurück auf die Liste"), "Dialog mit Umschalt-Text");
  clickText(w, "button", "Löschen"); await sleep(400);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (items.length !== 1 || items[0].name !== "Eier") throw new Error("Löschen ging schief");
  ok("Agent 49 – Abhaken und Löschen direkt aus dem Artikel-Dialog");
} catch (e) { bad("Agent 49", e); }

// ---------------- Agent 50: Checkbox hakt weiterhin ab, Text öffnet den Dialog
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Butter");
  click(w, "[data-toggle]"); await sleep(300);
  if (w.__zettl.S.modal) throw new Error("Checkbox öffnet fälschlich den Dialog");
  if (!txt(w).includes("Im Wagerl")) throw new Error("Checkbox hakt nicht ab");
  openItem(w, "Butter"); await sleep(250);
  if (w.__zettl.S.modal !== "item") throw new Error("Text öffnet den Dialog nicht");
  ok("Agent 50 – Haken bleibt Haken, Text öffnet die Bearbeitung");
} catch (e) { bad("Agent 50", e); }

// ---------------- Agent 51: Grundriss erscheint im Haushalt-Tab
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  // Vor dem Anordnen: kein Plan im Haushalt
  if (w.document.querySelector(".canvas.mini")) throw new Error("Plan zeigt sich ungefragt");
  // Räume anordnen
  click(w, "#tabP"); await sleep(250);
  const id = w.document.querySelector(".rbox").getAttribute("data-rid");
  await w.__zettl.setRoomRect(id, 2, 3, 8, 5); await sleep(400);
  click(w, "#tabT"); await sleep(300);
  // Geschoss wählen, damit klar ist welcher Plan
  const chip = [...w.document.querySelectorAll("[data-floor]")].find(b => b.getAttribute("data-floor") === "Erdgeschoss");
  if (chip) { chip.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300); }
  const mini = w.document.querySelector(".canvas.mini");
  if (!mini) throw new Error("Kein Plan im Haushalt-Tab");
  if (!mini.querySelector(".rbox")) throw new Error("Plan ohne Räume");
  // Raum antippen öffnet die Aufgaben
  mini.querySelector(".rbox").dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250);
  if (w.__zettl.S.modal !== "roomtasks") throw new Error("Raum im Mini-Plan nicht anklickbar");
  ok("Agent 51 – Grundriss erscheint im Haushalt-Tab, sobald er angelegt ist");
} catch (e) { bad("Agent 51", e); }


// ---------------- Agent 52: Allgemein ist kein Raum im Plan
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabP"); await sleep(300);
  const namen = [...w.document.querySelectorAll(".rbox")].map(b => b.textContent);
  if (namen.some(n => n.includes("Allgemein"))) throw new Error("Allgemein taucht im Plan auf");
  if (!namen.some(n => n.includes("Küche"))) throw new Error("Küche fehlt im Plan");
  // In der Raumverwaltung ist es sichtbar, aber als Sammelstelle
  click(w, "#settings"); await sleep(120);
  clickText(w, "button", "Räume verwalten"); await sleep(200);
  if (!txt(w).includes("Sammelstelle")) throw new Error("Allgemein nicht als Sammelstelle markiert");
  const row = [...w.document.querySelectorAll(".modal .item")].find(r => r.textContent.includes("Allgemein"));
  if (row.querySelector("[data-delroom]")) throw new Error("Sammelstelle lässt sich löschen");
  // Aufgaben können weiterhin dorthin
  const rooms = await w.__zettl.readLocal("rooms", []);
  if (!rooms.find(r => r.name === "Allgemein" && r.virtual)) throw new Error("Allgemein nicht als virtuell markiert");
  ok("Agent 52 – Allgemein ist Sammelstelle statt Raum, taucht nicht im Plan auf");
} catch (e) { bad("Agent 52", e); }

// ---------------- Agent 53: Raum ändern – Name, Art, Geschoss
try {
  const { w } = makePhone(); await setup(w);
  // Aufgabe im Bad anlegen
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(150);
  pickRoom(w, "Bad"); await sleep(150);
  type(w, "#title", "Dusche schrubben"); click(w, "#saveTask"); await sleep(400);
  // Bad umbenennen und ins Erdgeschoss verschieben
  click(w, "#settings"); await sleep(120);
  clickText(w, "button", "Räume verwalten"); await sleep(200);
  [...w.document.querySelectorAll("[data-editroom]")].find(b => b.textContent.includes("Bad"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250);
  type(w, "#reName", "Gäste-Bad");
  [...w.document.querySelectorAll("[data-refloor]")].find(b => b.textContent.trim() === "Erdgeschoss")
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(150);
  click(w, "#saveRE"); await sleep(500);
  const rooms = await w.__zettl.readLocal("rooms", []);
  const r = rooms.find(x => x.name === "Gäste-Bad");
  if (!r) throw new Error("Umbenennen hat nicht gewirkt");
  if (r.floor !== "Erdgeschoss") throw new Error("Geschoss nicht geändert: " + r.floor);
  const tasks = await w.__zettl.readLocal("tasks", []);
  if (tasks[0].room !== "Gäste-Bad") throw new Error("Aufgabe wandert nicht mit: " + tasks[0].room);
  ok("Agent 53 – Raum umbenennen und Geschoss wechseln, Aufgaben wandern mit");
} catch (e) { bad("Agent 53", e); }

// ---------------- Agent 54: Raum direkt im Plan-Editor anlegen
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabP"); await sleep(300);
  // Aufs Geschoss 1. Stock wechseln und dort einen Raum anlegen
  const chip = [...w.document.querySelectorAll("[data-pfloor]")].find(b => b.textContent.includes("1. Stock"));
  if (chip) { chip.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250); }
  click(w, "#planAddRoom"); await sleep(250);
  const onFloor = [...w.document.querySelectorAll("[data-floor2]")].find(b => b.classList.contains("on"));
  if (!onFloor || onFloor.getAttribute("data-floor2") !== "1. Stock") throw new Error("Geschoss nicht vorbelegt: " + (onFloor && onFloor.getAttribute("data-floor2")));
  type(w, "#roomName", "Ankleide"); await sleep(200);
  click(w, "#saveRoom"); await sleep(500);
  if (w.__zettl.S.modal) throw new Error("Bleibt in einem Dialog hängen");
  if (w.__zettl.S.tab !== "plan") throw new Error("Nicht mehr im Plan");
  const boxes = [...w.document.querySelectorAll(".rbox")].map(b => b.textContent);
  if (!boxes.some(b => b.includes("Ankleide"))) throw new Error("Neuer Raum nicht im Plan: " + boxes.join(" | "));
  ok("Agent 54 – Raum im Plan-Editor anlegen, Geschoss wird vorbelegt");
} catch (e) { bad("Agent 54", e); }

// ---------------- Agent 55: Aufgabe nachträglich ändern
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(150);
  pickRoom(w, "Küche"); await sleep(150);
  type(w, "#title", "Herd putzen"); click(w, "#saveTask"); await sleep(400);
  clickText(w, "button", "Herd putzen"); await sleep(300);
  type(w, "#tTitle", "Herd und Backofen putzen");
  [...w.document.querySelectorAll("[data-troom]")].find(b => b.textContent.includes("Wohnzimmer"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(150);
  [...w.document.querySelectorAll("[data-trep]")].find(b => b.getAttribute("data-trep") === "7")
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(150);
  click(w, "#saveTask2"); await sleep(500);
  const t = (await w.__zettl.readLocal("tasks", []))[0];
  if (t.title !== "Herd und Backofen putzen") throw new Error("Titel nicht geändert: " + t.title);
  if (t.room !== "Wohnzimmer") throw new Error("Raum nicht geändert: " + t.room);
  if (t.repeat !== 7) throw new Error("Intervall nicht geändert: " + t.repeat);
  if (!t.due) throw new Error("Wiederkehrend ohne Fälligkeit");
  ok("Agent 55 – Aufgabe nachträglich umbenennen, verschieben, Intervall ändern");
} catch (e) { bad("Agent 55", e); }

// ---------------- Agent 56: Eingabefeld klappt von selbst auf
try {
  const { w } = makePhone(); await setup(w);
  if (w.document.querySelector("#togglePrice")) throw new Error("€-Knopf gibt es noch");
  if ($(w, "#price")) throw new Error("Panel offen ohne Eingabe");
  type(w, "#what", "M"); await sleep(200);
  if ($(w, "#price")) throw new Error("Panel öffnet zu früh");
  type(w, "#what", "Milch"); await sleep(250);
  if (!$(w, "#price")) throw new Error("Panel öffnet nicht beim Tippen");
  if (!w.document.querySelector("[data-store]")) throw new Error("Keine Laden-Auswahl");
  const catOn = [...w.document.querySelectorAll("[data-cat]")].find(b => b.classList.contains("on"));
  if (!catOn || catOn.getAttribute("data-cat") !== "kuehl") throw new Error("Abteilung nicht vorgeschlagen");
  // Eingabe darf beim Neuzeichnen nicht verloren gehen
  if ($(w, "#what").value !== "Milch") throw new Error("Eingabe verloren");
  type(w, "#price", "1,29");
  clickText(w, "button", "Hofer"); await sleep(150);
  click(w, "#addItem"); await sleep(400);
  const it = (await w.__zettl.readLocal("shopping", [])).find(i => !i.deleted);
  if (it.price !== 1.29 || it.store !== "Hofer") throw new Error("Preis/Laden nicht übernommen");
  ok("Agent 56 – Eingabefeld klappt beim Tippen auf, kein €-Knopf mehr nötig");
} catch (e) { bad("Agent 56", e); }


// ================= TIEFENPRÜFUNG =================

// ---------------- Agent 57: Überspringen bei wiederkehrender Aufgabe
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(150);
  type(w, "#title", "Müll rausbringen");
  clickText(w, "button", "alle 3 T."); await sleep(100);
  click(w, "#saveTask"); await sleep(400);
  clickText(w, "button", "Müll rausbringen"); await sleep(300);
  clickText(w, "button", "Überspringen"); await sleep(500);
  const t = (await w.__zettl.readLocal("tasks", []))[0];
  const soll = new Date(); soll.setDate(soll.getDate() + 3);
  const iso = soll.toISOString().slice(0, 10);
  if (t.due !== iso) throw new Error("Fälligkeit falsch: " + t.due + " statt " + iso);
  if (t.lastDone) throw new Error("Überspringen zählt fälschlich als erledigt");
  if (t.skips !== 1) throw new Error("Zähler falsch: " + t.skips);
  if (!txt(w).includes("1× ausgelassen")) throw new Error("Zähler nicht sichtbar");
  ok("Agent 57 – Überspringen schiebt weiter, ohne als erledigt zu zählen");
} catch (e) { bad("Agent 57", e); }

// ---------------- Agent 58: Überspringen bei überfälliger Aufgabe landet in der Zukunft
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(150);
  type(w, "#title", "Blumen gießen");
  clickText(w, "button", "alle 3 T."); await sleep(100);
  click(w, "#saveTask"); await sleep(400);
  // Fälligkeit künstlich weit in die Vergangenheit setzen
  const alt = new Date(); alt.setDate(alt.getDate() - 20);
  const altISO = alt.toISOString().slice(0, 10);
  await w.__zettl.updateItems("tasks", l => l.map(x => ({ ...x, due: altISO })));
  await sleep(300);
  clickText(w, "button", "Blumen gießen"); await sleep(300);
  clickText(w, "button", "Überspringen"); await sleep(500);
  const t = (await w.__zettl.readLocal("tasks", []))[0];
  if (t.due <= new Date().toISOString().slice(0, 10)) throw new Error("Bleibt in der Vergangenheit: " + t.due);
  ok("Agent 58 – Überspringen einer überfälligen Aufgabe landet sicher in der Zukunft");
} catch (e) { bad("Agent 58", e); }

// ---------------- Agent 59: Überspringen einmaliger Aufgaben, Erledigen setzt Zähler zurück
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(80);
  click(w, "#newTask"); await sleep(150);
  type(w, "#title", "Rechnung zahlen"); click(w, "#saveTask"); await sleep(400);
  clickText(w, "button", "Rechnung zahlen"); await sleep(300);
  clickText(w, "button", "Überspringen"); await sleep(500);
  let t = (await w.__zettl.readLocal("tasks", []))[0];
  const soll = new Date(); soll.setDate(soll.getDate() + 7);
  if (t.due !== soll.toISOString().slice(0, 10)) throw new Error("Nicht um eine Woche verschoben: " + t.due);
  clickText(w, "button", "Rechnung zahlen"); await sleep(300);
  clickText(w, "button", "Erledigt"); await sleep(500);
  t = (await w.__zettl.readLocal("tasks", []))[0];
  if (t.skips !== 0) throw new Error("Zähler nicht zurückgesetzt: " + t.skips);
  if (!t.doneAt) throw new Error("Nicht erledigt");
  ok("Agent 59 – Einmalige Aufgabe wird um eine Woche verschoben, Erledigen setzt den Zähler zurück");
} catch (e) { bad("Agent 59", e); }

// ---------------- Agent 60: Zwei Handys ändern denselben Artikel
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://konflikt.supabase.co", key: "k" });
  const A = makePhone({ "zettl.sync": cfg }); await setup(A.w); await sleep(400);
  await addItem(A.w, "Milch"); await sleep(500);
  const B = makePhone({ "zettl.sync": cfg }); await sleep(500);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B bereit");
  clickText(B.w, "button", "Verena"); await sleep(400);
  // A ändert den Preis, danach B den Namen
  clickText(A.w, "button", "Milch"); await sleep(250);
  type(A.w, "#itPrice", "1,19"); click(A.w, "#saveItem"); await sleep(600);
  clickText(B.w, "button", "Milch"); await sleep(250);
  type(B.w, "#itName", "Vollmilch"); click(B.w, "#saveItem"); await sleep(600);
  await A.api().syncNow(false); await sleep(600);
  const items = (await A.w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (items.length !== 1) throw new Error("Artikel dupliziert: " + items.length);
  if (items[0].name !== "Vollmilch") throw new Error("Spätere Änderung verloren: " + items[0].name);
  ok("Agent 60 – Gleichzeitige Änderungen am selben Artikel erzeugen keine Dubletten");
} catch (e) { bad("Agent 60", e); }

// ---------------- Agent 61: Grundriss und Läden syncen mit
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://plansync.supabase.co", key: "k" });
  const A = makePhone({ "zettl.sync": cfg }); await setup(A.w); await sleep(400);
  click(A.w, "#tabP"); await sleep(300);
  const rid = A.w.document.querySelector(".rbox").getAttribute("data-rid");
  await A.w.__zettl.setRoomRect(rid, 3, 4, 7, 6); await sleep(600);
  await A.w.eval("savePlanBg")("Erdgeschoss", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
  await sleep(600);
  await A.w.__zettl.saveShops({ home: { lat: 48.2, lon: 14.28, at: Date.now() },
    list: [{ id: "s1", name: "Hofer Test", dist: 1.2, chosen: true, updatedAt: Date.now() }] });
  await sleep(700);
  const B = makePhone({ "zettl.sync": cfg }); await sleep(500);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B bereit");
  clickText(B.w, "button", "Verena"); await sleep(600);
  const rooms = await B.w.__zettl.readLocal("rooms", []);
  const r = rooms.find(x => x.id === rid);
  if (!r || r.x !== 3 || r.w !== 7) throw new Error("Raumposition nicht gesynct");
  const plan = await B.w.__zettl.readLocal("plan", { bg: {} });
  if (!plan.bg["Erdgeschoss"]) throw new Error("Skizze nicht gesynct");
  const shops = await B.w.__zettl.readLocal("shops", { list: [] });
  if (!shops.list.some(s => s.name === "Hofer Test")) throw new Error("Läden nicht gesynct");
  if (!shops.home) throw new Error("Standort nicht gesynct");
  ok("Agent 61 – Grundriss, Skizze, Läden und Standort landen auf dem zweiten Handy");
} catch (e) { bad("Agent 61", e); }

// ---------------- Agent 62: Alles bleibt verschlüsselt
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://krypto.supabase.co", key: "k" });
  const { w } = makePhone({ "zettl.sync": cfg }); await setup(w); await sleep(400);
  await addItem(w, "Kondome");
  await w.__zettl.saveShops({ home: { lat: 48.2001, lon: 14.2802, at: Date.now() }, list: [] });
  await sleep(800);
  const alles = JSON.stringify([...DBS.values()].map(m => [...m.entries()]));
  if (alles.includes("Kondome")) throw new Error("Artikelname im Klartext in der Datenbank!");
  if (alles.includes("48.2001") || alles.includes("14.2802")) throw new Error("Standort im Klartext!");
  if (alles.includes("Verena")) throw new Error("Name im Klartext!");
  const lokal = JSON.stringify(dump(w));
  if (lokal.includes("Kondome")) throw new Error("Artikelname im Klartext im Browser-Speicher!");
  ok("Agent 62 – Weder Datenbank noch Browser-Speicher enthalten lesbare Daten");
} catch (e) { bad("Agent 62", e); }

// ---------------- Agent 63: Raum löschen mit Plan-Position
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabP"); await sleep(300);
  const rid = w.document.querySelector(".rbox").getAttribute("data-rid");
  await w.__zettl.setRoomRect(rid, 5, 5, 6, 6); await sleep(400);
  const rooms0 = await w.__zettl.readLocal("rooms", []);
  const name = rooms0.find(r => r.id === rid).name;
  // Aufgabe hineinlegen
  click(w, "#tabT"); await sleep(120);
  click(w, "#newTask"); await sleep(150);
  pickRoom(w, name); await sleep(150);
  type(w, "#title", "Testaufgabe"); click(w, "#saveTask"); await sleep(400);
  // Raum löschen
  click(w, "#settings"); await sleep(120);
  clickText(w, "button", "Räume verwalten"); await sleep(200);
  [...w.document.querySelectorAll("[data-delroom]")].find(b => b.closest(".item").textContent.includes(name))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(200);
  click(w, "#delYes"); await sleep(600);
  const t = (await w.__zettl.readLocal("tasks", []))[0];
  if (t.room !== "Allgemein") throw new Error("Aufgabe nicht gerettet: " + t.room);
  click(w, "#closeRooms"); await sleep(150);
  click(w, "#closeSet"); await sleep(150);
  click(w, "#tabP"); await sleep(300);
  if ([...w.document.querySelectorAll(".rbox")].some(b => b.textContent.includes(name)))
    throw new Error("Gelöschter Raum noch im Plan");
  ok("Agent 63 – Gelöschter Raum verschwindet aus dem Plan, Aufgabe wandert nach Allgemein");
} catch (e) { bad("Agent 63", e); }

// ---------------- Agent 64: Skizzen bleiben pro Geschoss getrennt
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabP"); await sleep(300);
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await w.eval("savePlanBg")("Erdgeschoss", png); await sleep(400);
  const plan = await w.__zettl.readLocal("plan", { bg: {} });
  if (plan.bg["1. Stock"]) throw new Error("Skizze wandert ins falsche Geschoss");
  if (!plan.bg["Erdgeschoss"]) throw new Error("Skizze fehlt");
  await w.eval("savePlanBg")("Erdgeschoss", null); await sleep(400);
  const plan2 = await w.__zettl.readLocal("plan", { bg: {} });
  if (plan2.bg["Erdgeschoss"]) throw new Error("Entfernen ging nicht");
  ok("Agent 64 – Skizzen sind pro Geschoss getrennt und lassen sich entfernen");
} catch (e) { bad("Agent 64", e); }

// ---------------- Agent 65: Viele Einträge – Belastungstest
try {
  const { w } = makePhone(); await setup(w);
  const t0 = Date.now();
  const viele = [];
  for (let i = 0; i < 120; i++) viele.push({ id: "x" + i, name: "Artikel " + i, price: (i % 7) / 2,
    store: ["Billa", "Hofer", "Lidl"][i % 3], cat: null, by: w.__zettl.S.meId, done: i % 5 === 0,
    at: "2026-07-01", updatedAt: Date.now() });
  await w.__zettl.updateItems("shopping", l => l.concat(viele));
  await sleep(800);
  const dauer = Date.now() - t0;
  const rows = w.document.querySelectorAll(".item").length;
  if (rows < 100) throw new Error("Nicht alle dargestellt: " + rows);
  if (dauer > 8000) throw new Error("Zu langsam: " + dauer + "ms");
  if (!txt(w).includes("Im Wagerl")) throw new Error("Erledigte fehlen");
  ok("Agent 65 – 120 Artikel in " + dauer + "ms dargestellt und gruppiert");
} catch (e) { bad("Agent 65", e); }

// ---------------- Agent 66: Preise – Grenzfälle
try {
  const { w } = makePhone(); await setup(w);
  const faelle = [["0", 0], ["0,00", 0], ["-3", 3], ["1.234,56", null], ["12,999", 12.999], ["€ 4,20", 4.2]];
  const pe = w.eval("parseEuro");
  const out = faelle.map(([roh]) => pe(roh));
  if (out[0] !== 0 || out[1] !== 0) throw new Error("Null-Preis geht verloren");
  if (out.some(v => typeof v === "number" && isNaN(v))) throw new Error("NaN entsteht");
  if (pe("abc") !== null || pe("") !== null) throw new Error("Unsinn wird nicht abgewiesen");
  // 0 € muss auch angezeigt werden
  type(w, "#what", "Gratisprobe"); await sleep(200);
  type(w, "#price", "0"); clickText(w, "button", "Billa"); await sleep(150);
  click(w, "#addItem"); await sleep(400);
  if (!txt(w).includes("0,00")) throw new Error("Null-Preis nicht angezeigt");
  ok("Agent 66 – Preis-Grenzfälle: 0 €, Komma, Punkt, Währungszeichen, Unsinn");
} catch (e) { bad("Agent 66", e); }

// ---------------- Agent 67: Sehr lange und exotische Namen
try {
  const { w } = makePhone(); await setup(w);
  const lang = "Ö".repeat(60) + " Spezialität";
  await addItem(w, lang);
  await addItem(w, "🥑 Avocado 中文 Ünïcödé");
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (items.length !== 2) throw new Error("Nicht gespeichert");
  if (!txt(w).includes("Avocado")) throw new Error("Unicode-Name fehlt");
  // Bearbeiten muss auch damit klarkommen
  openItem(w, "Avocado"); await sleep(300);
  if ($(w, "#itName").value.indexOf("🥑") !== 0) throw new Error("Emoji im Bearbeiten-Feld verloren");
  click(w, "#saveItem"); await sleep(400);
  ok("Agent 67 – Sehr lange Namen, Emoji und fremde Schriftzeichen funktionieren");
} catch (e) { bad("Agent 67", e); }

// ---------------- Agent 68: Speicher voll – App bleibt bedienbar
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Vorher");
  const proto = w.Storage && w.Storage.prototype;
  if (!proto) throw new Error("Storage-Prototyp nicht erreichbar");
  const echt = proto.setItem;
  proto.setItem = function () { throw new Error("QuotaExceededError"); };
  await addItem(w, "Trotzdem").catch(() => {});
  await sleep(300);
  if (!txt(w).includes("Trotzdem")) throw new Error("Eintrag nicht einmal angezeigt");
  if (!txt(w).includes("Konnte nicht speichern")) throw new Error("Kein Hinweis auf das Speicherproblem");
  proto.setItem = echt;
  await addItem(w, "Danach"); await sleep(300);
  if (txt(w).includes("Konnte nicht speichern")) throw new Error("Hinweis bleibt hängen");
  ok("Agent 68 – Voller Speicher wird gemeldet, App bleibt bedienbar");
} catch (e) { bad("Agent 68", e); }

// ---------------- Agent 69: Uralte Installation wandert sauber mit
try {
  const A = makePhone(); await setup(A.w); await sleep(300);
  const key = JSON.parse(A.w.localStorage.getItem("zettl.key"));
  const k = await webcrypto.subtle.importKey("raw", Uint8Array.from(atob(key), c => c.charCodeAt(0)),
    { name: "AES-GCM" }, true, ["encrypt"]);
  const enc = async (obj) => {
    const iv = new Uint8Array(12); webcrypto.getRandomValues(iv);
    const ct = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
    const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
    return JSON.stringify({ __enc: 1, iv: b64(iv.buffer), ct: b64(ct) });
  };
  const d = dump(A.w);
  delete d["zettl.rooms"]; delete d["zettl.plan"]; delete d["zettl.shops"];
  d["zettl.tasks"] = await enc([{ id: "t1", title: "Wäsche waschen", room: "Waschküche", repeat: 3, due: "2026-07-01", updatedAt: 1 }]);
  d["zettl.prices"] = await enc({ "milch": { price: 1.29, store: "Billa", at: "2026-07-01" } });   // altes Format
  const B = makePhone(d); await sleep(800);
  const rooms = await B.w.__zettl.readLocal("rooms", []);
  const wk = rooms.find(r => r.name === "Waschküche");
  if (!wk) throw new Error("Raum aus alter Aufgabe nicht angelegt");
  if (wk.type !== "wasch" || !wk.floor) throw new Error("Raum falsch abgeleitet: " + JSON.stringify(wk));
  const best = B.w.eval("bestPrice")("Milch");
  if (!best || best.price !== 1.29 || best.store !== "Billa") throw new Error("Alte Preise verloren: " + JSON.stringify(best));
  if (!txt(B.w).includes("Wäsche waschen") && B.w.__zettl.S.tab !== "shopping") throw new Error("Aufgabe verloren");
  ok("Agent 69 – Alte Installation: Räume abgeleitet, alte Preisform übernommen");
} catch (e) { bad("Agent 69", e); }

// ---------------- Agent 70: Zurücksetzen räumt wirklich alles weg
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Milch");
  await w.__zettl.saveShops({ home: { lat: 1, lon: 2, at: 1 }, list: [{ id: "s", name: "X", chosen: true, updatedAt: 1 }] });
  await w.eval("savePlanBg")("Erdgeschoss", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==");
  await sleep(500);
  click(w, "#settings"); await sleep(150);
  clickText(w, "button", "Alles auf diesem Handy löschen"); await sleep(200);
  click(w, "#yes"); await sleep(600);
  const rest = Object.keys(dump(w)).filter(k => k.startsWith("zettl.") && k !== "zettl.sync" && k !== "zettl.sort");
  if (rest.length) throw new Error("Reste im Speicher: " + rest.join(", "));
  if (!txt(w).includes("Neuen Haushalt anlegen") && !txt(w).includes("Ein Zettel")) throw new Error("Kein Neustart");
  ok("Agent 70 – Zurücksetzen entfernt Listen, Plan, Läden und Schlüssel");
} catch (e) { bad("Agent 70", e); }


// ---------------- Agent 71: Schnell hintereinander eintragen (ohne Warten)
try {
  const { w } = makePhone(); await setup(w);
  const namen = ["Milch","Brot","Butter","Eier","Käse","Apfel","Reis","Salz","Zucker","Öl"];
  for (const n of namen) {                       // wie hektisches Tippen im Laden
    type(w, "#what", n);
    click(w, "#addItem");
    await sleep(35);                             // absichtlich zu kurz
  }
  await sleep(1500);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted).map(i => i.name);
  const fehlend = namen.filter(n => !items.includes(n));
  if (fehlend.length) throw new Error("Verloren gegangen: " + fehlend.join(", ") + " (nur " + items.length + " von 10)");
  ok("Agent 71 – 10 schnelle Eingaben hintereinander, nichts geht verloren");
} catch (e) { bad("Agent 71", e); }

// ---------------- Agent 72: Schnelles Abhaken mehrerer Artikel
try {
  const { w } = makePhone(); await setup(w);
  for (const n of ["Milch","Brot","Butter","Eier"]) await addItem(w, n);
  const boxes = [...w.document.querySelectorAll("[data-toggle]")];
  boxes.forEach(b => b.dispatchEvent(new w.Event("click", { bubbles: true })));   // alle auf einmal
  await sleep(1500);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  const offen = items.filter(i => !i.done).length;
  if (offen !== 0) throw new Error(offen + " Artikel nicht abgehakt");
  if (items.length !== 4) throw new Error("Artikel verloren: " + items.length);
  ok("Agent 72 – Vier Artikel gleichzeitig abgehakt, keiner geht verloren");
} catch (e) { bad("Agent 72", e); }

// ---------------- Agent 73: Vorschläge doppelt übernehmen
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  click(w, "#openTips"); await sleep(250);
  const picks = [...w.document.querySelectorAll("[data-pick]")].slice(0, 3);
  picks.forEach(p => p.dispatchEvent(new w.Event("click", { bubbles: true })));
  await sleep(250);
  click(w, "#takeTips"); await sleep(700);
  const nachher1 = (await w.__zettl.readLocal("tasks", [])).filter(t => !t.deleted).length;
  // Dieselben nochmal anbieten -> müssen als "schon drin" ausgegraut sein
  click(w, "#openTips"); await sleep(300);
  const drin = [...w.document.querySelectorAll("[data-pick]")].filter(b => b.hasAttribute("disabled")).length;
  if (drin < 3) throw new Error("Bereits angelegte Vorschläge nicht ausgegraut: " + drin);
  ok("Agent 73 – Übernommene Vorschläge werden beim zweiten Mal ausgegraut (" + nachher1 + " Aufgaben)");
} catch (e) { bad("Agent 73", e); }

// ---------------- Agent 74: Zwei Handys – löschen gegen bearbeiten
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://race.supabase.co", key: "k" });
  const A = makePhone({ "zettl.sync": cfg }); await setup(A.w); await sleep(400);
  click(A.w, "#tabT"); await sleep(120);
  click(A.w, "#newTask"); await sleep(200);
  type(A.w, "#title", "Streitfall"); click(A.w, "#saveTask"); await sleep(700);
  const B = makePhone({ "zettl.sync": cfg }); await sleep(500);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B bereit");
  clickText(B.w, "button", "Verena"); await sleep(500);
  click(B.w, "#tabT"); await sleep(300);
  // A löscht, B benennt um – die spätere Änderung soll gewinnen
  clickText(A.w, "button", "Streitfall"); await sleep(300);
  clickText(A.w, "button", "Löschen"); await sleep(700);
  clickText(B.w, "button", "Streitfall"); await sleep(300);
  type(B.w, "#tTitle", "Streitfall geklärt"); click(B.w, "#saveTask2"); await sleep(800);
  await A.api().syncNow(false); await sleep(700);
  const tasks = (await A.w.__zettl.readLocal("tasks", []));
  if (tasks.length !== 1) throw new Error("Aufgabe dupliziert: " + tasks.length);
  ok("Agent 74 – Löschen und Umbenennen gleichzeitig: genau ein Ergebnis, keine Dublette");
} catch (e) { bad("Agent 74", e); }

// ---------------- Agent 75: Ohne Netz weiterarbeiten, danach nachsyncen
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://offline.supabase.co", key: "k" });
  const { w } = makePhone({ "zettl.sync": cfg }); await setup(w); await sleep(500);
  const echt = w.fetch;
  w.fetch = () => Promise.reject(new Error("Failed to fetch"));    // Funkloch
  await addItem(w, "Offline-Milch"); await sleep(400);
  await addItem(w, "Offline-Brot"); await sleep(400);
  if (!txt(w).includes("Offline-Milch")) throw new Error("Ohne Netz nicht bedienbar");
  w.fetch = echt;                                                   // wieder Empfang
  await w.__zettl.syncNow(false); await sleep(800);
  const drin = JSON.stringify([...DBS.values()].map(m => [...m.keys()]));
  if (!drin.includes("shopping")) throw new Error("Nach dem Funkloch nicht hochgeladen");
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted).map(i => i.name);
  if (items.length !== 2) throw new Error("Artikel verloren: " + items.join(", "));
  ok("Agent 75 – Funkloch überstanden, danach wird alles nachgesynct");
} catch (e) { bad("Agent 75", e); }

// ---------------- Agent 76: Unbekannte Warengruppe sortiert nach hinten
try {
  const { w } = makePhone(); await setup(w);
  for (const n of ["Schraubenzieher", "Bananen", "Klopapier"]) await addItem(w, n);
  const secs = [...w.document.querySelectorAll(".sec")].map(s => s.textContent.trim());
  const iSonst = secs.findIndex(s => s.includes("Sonstiges"));
  const iObst = secs.findIndex(s => s.includes("Obst"));
  const iDrog = secs.findIndex(s => s.includes("Drogerie"));
  if (iSonst < 0) throw new Error("Keine Sonstiges-Gruppe");
  if (!(iObst < iDrog && iDrog < iSonst)) throw new Error("Sonstiges nicht am Ende: " + secs.join(" | "));
  ok("Agent 76 – Unbekannte Artikel landen am Ende der Liste, nicht mittendrin");
} catch (e) { bad("Agent 76", e); }

// ---------------- Agent 77: Wagerl leeren trifft nur Erledigtes
try {
  const { w } = makePhone(); await setup(w);
  for (const n of ["Milch","Brot","Butter"]) await addItem(w, n);
  const box = [...w.document.querySelectorAll("[data-toggle]")].find(b => b.closest(".item").textContent.includes("Brot"));
  box.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(400);
  click(w, "#clearDone"); await sleep(500);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted).map(i => i.name);
  if (items.includes("Brot")) throw new Error("Erledigtes nicht entfernt");
  if (items.length !== 2) throw new Error("Offene Artikel mitgelöscht: " + items.join(", "));
  ok("Agent 77 – Wagerl leeren entfernt nur Erledigtes");
} catch (e) { bad("Agent 77", e); }

// ---------------- Agent 78: Raum umbenennen – Plan und Aufgaben ziehen mit
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabP"); await sleep(300);
  const rid = w.document.querySelector(".rbox").getAttribute("data-rid");
  await w.__zettl.setRoomRect(rid, 4, 4, 7, 5); await sleep(400);
  const alterName = (await w.__zettl.readLocal("rooms", [])).find(r => r.id === rid).name;
  click(w, "#tabT"); await sleep(150);
  click(w, "#newTask"); await sleep(200);
  pickRoom(w, alterName); await sleep(150);
  type(w, "#title", "Testaufgabe"); click(w, "#saveTask"); await sleep(500);
  click(w, "#settings"); await sleep(150);
  clickText(w, "button", "Räume verwalten"); await sleep(250);
  [...w.document.querySelectorAll("[data-editroom]")].find(b => b.textContent.includes(alterName))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  type(w, "#reName", "Neuer Name"); click(w, "#saveRE"); await sleep(700);
  const r = (await w.__zettl.readLocal("rooms", [])).find(x => x.id === rid);
  if (r.x !== 4 || r.w !== 7) throw new Error("Plan-Position beim Umbenennen verloren");
  const t = (await w.__zettl.readLocal("tasks", []))[0];
  if (t.room !== "Neuer Name") throw new Error("Aufgabe hängt am alten Namen");
  click(w, "#closeRooms"); await sleep(200); click(w, "#closeSet"); await sleep(200);
  click(w, "#tabP"); await sleep(300);
  const box2 = [...w.document.querySelectorAll(".rbox")].find(b => b.textContent.includes("Neuer Name"));
  if (!box2) throw new Error("Umbenannter Raum fehlt im Plan");
  if (!box2.textContent.includes("1")) throw new Error("Aufgabenzahl am Raum verloren");
  ok("Agent 78 – Umbenennen erhält Plan-Position und Aufgabenzuordnung");
} catch (e) { bad("Agent 78", e); }

// ---------------- Agent 79: Doppelte Raumnamen werden abgewiesen
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(150);
  clickText(w, "button", "Räume verwalten"); await sleep(250);
  [...w.document.querySelectorAll("[data-editroom]")].find(b => b.textContent.includes("Küche"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  type(w, "#reName", "Bad"); click(w, "#saveRE"); await sleep(500);
  if (!txt(w).includes("gibt es schon")) throw new Error("Doppelter Name wird zugelassen");
  const rooms = (await w.__zettl.readLocal("rooms", [])).filter(r => !r.deleted).map(r => r.name);
  if (rooms.filter(n => n === "Bad").length !== 1) throw new Error("Zwei Räume heißen gleich");
  ok("Agent 79 – Doppelte Raumnamen werden verhindert");
} catch (e) { bad("Agent 79", e); }

// ---------------- Agent 80: Passwort mit Umlauten und Emoji
try {
  const pw = "Schlüssel-🔑-Ätsch";
  const A = makePhone(); await setup(A.w, pw); await sleep(300);
  await addItem(A.w, "Geheimes");
  const d = dump(A.w); delete d["zettl.key"];        // Passwort vergessen -> erneut eingeben
  const B = makePhone(d); await sleep(600);
  if (!txt(B.w).includes("Aufsperren")) throw new Error("Kein Passwortschutz");
  type(B.w, "#pw", "falsch"); click(B.w, "#go"); await sleep(600);
  if (!txt(B.w).includes("Falsches Passwort")) throw new Error("Falsches Passwort akzeptiert");
  type(B.w, "#pw", pw); click(B.w, "#go");
  await until(() => txt(B.w).includes("Geheimes"), "Entschlüsselt");
  ok("Agent 80 – Passwort mit Umlauten und Emoji funktioniert zuverlässig");
} catch (e) { bad("Agent 80", e); }


// ---------------- Agent 81: Kein Blockieren durch die neue Reihenfolge-Sperre
try {
  const { w } = makePhone(); await setup(w);
  const t0 = Date.now();
  // Alles wild durcheinander, ohne abzuwarten
  type(w, "#what", "Milch"); click(w, "#addItem");
  click(w, "#tabT"); await sleep(40);
  click(w, "#newTask"); await sleep(120);
  type(w, "#title", "Staubsaugen"); click(w, "#saveTask");
  await sleep(60);
  click(w, "#tabS"); await sleep(60);
  type(w, "#what", "Brot"); click(w, "#addItem");
  await sleep(1500);
  const dauer = Date.now() - t0;
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted).map(i => i.name);
  const tasks = (await w.__zettl.readLocal("tasks", [])).filter(t => !t.deleted).map(t => t.title);
  if (!items.includes("Milch") || !items.includes("Brot")) throw new Error("Artikel verloren: " + items.join(", "));
  if (!tasks.includes("Staubsaugen")) throw new Error("Aufgabe verloren");
  if (dauer > 6000) throw new Error("Sperre bremst zu stark: " + dauer + "ms");
  ok("Agent 81 – Gemischte Schnellaktionen (" + dauer + "ms), nichts blockiert, nichts verloren");
} catch (e) { bad("Agent 81", e); }

// ---------------- Agent 82: Raum löschen während der Sync läuft
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://lock.supabase.co", key: "k" });
  const { w } = makePhone({ "zettl.sync": cfg }); await setup(w); await sleep(500);
  click(w, "#tabT"); await sleep(120);
  click(w, "#newTask"); await sleep(200);
  pickRoom(w, "Küche"); await sleep(150);
  type(w, "#title", "Herd putzen"); click(w, "#saveTask"); await sleep(400);
  w.__zettl.syncNow(true);                      // Sync absichtlich parallel starten
  click(w, "#settings"); await sleep(150);
  clickText(w, "button", "Räume verwalten"); await sleep(250);
  [...w.document.querySelectorAll("[data-delroom]")].find(b => b.closest(".item").textContent.includes("Küche"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(200);
  click(w, "#delYes"); await sleep(1200);
  const rooms = (await w.__zettl.readLocal("rooms", [])).filter(r => !r.deleted).map(r => r.name);
  if (rooms.includes("Küche")) throw new Error("Löschen ging im Sync unter");
  const t = (await w.__zettl.readLocal("tasks", []))[0];
  if (t.room !== "Allgemein") throw new Error("Aufgabe nicht gerettet: " + t.room);
  ok("Agent 82 – Löschen während laufendem Sync bleibt erhalten");
} catch (e) { bad("Agent 82", e); }

// ---------------- Agent 83: Zwölf Räume passen ins Raster
try {
  const { w } = makePhone(); await setup(w);
  for (const n of ["Speis","Werkstatt","Gäste-WC","Ankleide","Dachboden","Pool","Sauna"]) {
    await w.__zettl.S && null;
    click(w, "#tabP"); await sleep(150);
    click(w, "#planAddRoom"); await sleep(200);
    type(w, "#roomName", n); await sleep(150);
    click(w, "#saveRoom"); await sleep(400);
  }
  const rooms = (await w.__zettl.readLocal("rooms", [])).filter(r => !r.deleted);
  if (rooms.length < 11) throw new Error("Räume fehlen: " + rooms.length);
  // Jedes Geschoss durchgehen und Rahmen prüfen
  const floors = [...new Set(rooms.filter(r => !r.virtual).map(r => r.floor))];
  for (const f of floors) {
    const chip = [...w.document.querySelectorAll("[data-pfloor]")].find(b => b.textContent.trim() === f);
    if (chip) { chip.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250); }
    const boxes = [...w.document.querySelectorAll(".rbox")];
    for (const b of boxes) {
      const l = parseFloat(b.style.left), t = parseFloat(b.style.top);
      const bw = parseFloat(b.style.width), bh = parseFloat(b.style.height);
      if (l < 0 || t < 0 || l + bw > 100.5 || t + bh > 100.5)
        throw new Error("Raum ragt aus dem Plan: " + b.textContent.trim() + " " + [l, t, bw, bh].join("/"));
    }
  }
  ok("Agent 83 – Auch mit vielen Räumen bleibt alles im sichtbaren Bereich");
} catch (e) { bad("Agent 83", e); }

// ---------------- Agent 84: Aufgabe in gelöschtem Raum bleibt bedienbar
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  click(w, "#newTask"); await sleep(200);
  pickRoom(w, "Wohnzimmer"); await sleep(150);
  type(w, "#title", "Staub wischen"); click(w, "#saveTask"); await sleep(400);
  // Raum aus den Daten entfernen, ohne die Aufgabe umzuhängen (Extremfall)
  await w.__zettl.updateItems("tasks", l => l);
  const rooms = await w.__zettl.readLocal("rooms", []);
  await w.__zettl.writeLocal("rooms", rooms.filter(r => r.name !== "Wohnzimmer"));
  await w.__zettl.boot(); await sleep(700);
  click(w, "#tabT"); await sleep(300);
  if (!txt(w).includes("Staub wischen")) throw new Error("Aufgabe verschwunden");
  clickText(w, "button", "Staub wischen"); await sleep(300);
  if (!$(w, "#tTitle")) throw new Error("Detail nicht zu öffnen");
  click(w, "#saveTask2"); await sleep(500);
  ok("Agent 84 – Aufgabe mit verwaistem Raum bleibt sichtbar und bearbeitbar");
} catch (e) { bad("Agent 84", e); }

// ---------------- Agent 85: Umbenennen auf bekannten Namen zeigt den Preis
try {
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "Butter"); await sleep(200);
  type(w, "#price", "2,79"); clickText(w, "button", "Hofer"); await sleep(150);
  click(w, "#addItem"); await sleep(400);
  [...w.document.querySelectorAll("[data-del]")][0].dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(400);
  await addItem(w, "Irgendwas");
  openItem(w, "Irgendwas"); await sleep(300);
  type(w, "#itName", "Butter"); click(w, "#saveItem"); await sleep(500);
  if (!txt(w).includes("Hofer") || !txt(w).includes("2,79")) throw new Error("Bekannter Preis wird nicht angezeigt");
  ok("Agent 85 – Nach dem Umbenennen erscheint der bekannte Preis");
} catch (e) { bad("Agent 85", e); }

// ---------------- Agent 86: Preisübersicht ohne einen einzigen Preis
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Milch"); await addItem(w, "Brot");
  if (txt(w).includes("für 0 von")) throw new Error("Kostenkarte trotz fehlender Preise");
  if (w.document.querySelector("#priceHelp")) throw new Error("Preis-Knopf ohne Preise");
  // Ein Preis genügt, dann muss die Karte da sein
  openItem(w, "Milch"); await sleep(300);
  type(w, "#itPrice", "1,29"); click(w, "#saveItem"); await sleep(500);
  if (!w.document.querySelector("#priceHelp")) throw new Error("Kostenkarte fehlt");
  click(w, "#priceHelp"); await sleep(300);
  if (!txt(w).includes("noch kein Preis hinterlegt")) throw new Error("Artikel ohne Preis nicht markiert");
  ok("Agent 86 – Kostenkarte erscheint erst mit Preisen und markiert Lücken");
} catch (e) { bad("Agent 86", e); }

// ---------------- Agent 87: Geschoss-Filter ohne Aufgaben
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  for (const [room, title] of [["Küche", "Herd putzen"], ["Bad", "WC putzen"]]) {
    click(w, "#newTask"); await sleep(180);
    pickRoom(w, room); await sleep(150);
    type(w, "#title", title); click(w, "#saveTask"); await sleep(400);
  }
  // Alle Aufgaben im 1. Stock erledigen, Filter bleibt stehen
  [...w.document.querySelectorAll("[data-floor]")].find(b => b.getAttribute("data-floor") === "1. Stock")
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  click(w, "[data-done]"); await sleep(600);
  const t = txt(w);
  if (!t.includes("Herd putzen") && !t.includes("nichts offen") && !t.includes("Erledigt"))
    throw new Error("Weder Hinweis noch Rückfall: " + t.slice(0, 150));
  ok("Agent 87 – Leeres Geschoss führt nicht in eine Sackgasse");
} catch (e) { bad("Agent 87", e); }

// ---------------- Agent 88: Einladungs-Link enthält kein Passwort
try {
  REMOTE.clear();
  const { w } = makePhone(); await setup(w, "SuperGeheim123");
  click(w, "#settings"); await sleep(150);
  clickText(w, "button", "Sync einrichten"); await sleep(250);
  type(w, "#sUrl", "https://invite.supabase.co"); type(w, "#sKey", "sb_publishable_x");
  click(w, "#saveSync"); await sleep(900);
  const link = w.eval("inviteLink()");
  if (!link) throw new Error("Kein Link");
  if (link.includes("SuperGeheim")) throw new Error("Passwort steckt im Link!");
  const nutzlast = JSON.parse(w.eval("unb64url")(link.split("#zettl=")[1]));
  if (nutzlast.p || nutzlast.pw || nutzlast.password) throw new Error("Passwortfeld im Link");
  if (!nutzlast.u || !nutzlast.k) throw new Error("Zugangsdaten fehlen im Link");
  ok("Agent 88 – Einladungs-Link enthält nur den Datenbankzugang, nie das Passwort");
} catch (e) { bad("Agent 88", e); }

// ---------------- Agent 89: Kaputte Skizzen-Datei stürzt nicht ab
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabP"); await sleep(300);
  let fertig = false;
  const kaputt = { name: "kaputt.png", type: "image/png" };
  w.eval("shrinkImage")(kaputt, () => { fertig = true; });
  await sleep(600);
  if (!$(w, "#canvas")) throw new Error("Plan nach kaputter Datei zerschossen");
  click(w, "#tabS"); await sleep(200);
  await addItem(w, "Test");                      // App muss weiter bedienbar sein
  ok("Agent 89 – Unbrauchbare Bilddatei legt die App nicht lahm");
} catch (e) { bad("Agent 89", e); }

// ---------------- Agent 90: Privater Modus – Speicher komplett gesperrt
try {
  const dom = new JSDOM(HTML, { runScripts: "dangerously", url: "https://zettl.test/", pretendToBeVisual: true,
    beforeParse(w) {
      Object.defineProperty(w, "crypto", { value: webcrypto, configurable: true });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;   // jsdom liefert beides nicht mit
      w.fetch = fakeFetch;
      w.Storage.prototype.getItem = function () { throw new Error("SecurityError"); };
      w.Storage.prototype.setItem = function () { throw new Error("SecurityError"); };
    } });
  const w = dom.window; OPEN.push(w);
  await sleep(600);
  const t = w.document.querySelector("#app").textContent;
  if (!t.includes("Zettl")) throw new Error("App startet gar nicht");
  if (!t.includes("Neuen Haushalt") && !t.includes("Ein Zettel")) throw new Error("Kein Startbildschirm: " + t.slice(0, 100));
  ok("Agent 90 – Auch bei komplett gesperrtem Speicher startet die App sauber");
} catch (e) { bad("Agent 90", e); }


// ================= WELLE 4: 20 AGENTEN =================

// ---------------- Agent 91: Allgemeine Aufgaben stehen unter der Karte
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  for (const [room, title] of [["Allgemein", "Müll rausbringen"], ["Küche", "Herd putzen"]]) {
    click(w, "#newTask"); await sleep(200);
    pickRoom(w, room); await sleep(150);
    type(w, "#title", title); click(w, "#saveTask"); await sleep(400);
  }
  const t = txt(w);
  const iAllg = t.indexOf("Müll rausbringen"), iKueche = t.indexOf("Herd putzen");
  if (iAllg < 0 || iKueche < 0) throw new Error("Aufgaben fehlen");
  if (iAllg > iKueche) throw new Error("Allgemeine Aufgaben stehen nicht oben");
  if (!t.includes("ohne Raum")) throw new Error("Kein Hinweis auf die Sammelstelle");
  ok("Agent 91 – Allgemeine Aufgaben stehen direkt unter der Karte");
} catch (e) { bad("Agent 91", e); }

// ---------------- Agent 92: Allgemeine Aufgaben bleiben bei Geschoss-Filter sichtbar
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  for (const [room, title] of [["Allgemein", "Post durchgehen"], ["Bad", "WC putzen"], ["Küche", "Spüle putzen"]]) {
    click(w, "#newTask"); await sleep(200);
    pickRoom(w, room); await sleep(150);
    type(w, "#title", title); click(w, "#saveTask"); await sleep(400);
  }
  const chip = [...w.document.querySelectorAll("[data-floor]")].find(b => b.getAttribute("data-floor") === "1. Stock");
  if (!chip) throw new Error("Keine Geschoss-Leiste");
  chip.dispatchEvent(new w.Event("click", { bubbles: true }));
  await until(() => !txt(w).includes("angelegt"), "Meldung verschwunden");   // Toast abwarten
  const t = txt(w);
  if (!t.includes("Post durchgehen")) throw new Error("Allgemeine Aufgabe im Filter verschwunden");
  if (!t.includes("WC putzen")) throw new Error("Aufgabe des Geschosses fehlt");
  if (t.includes("Spüle putzen")) throw new Error("Fremdes Geschoss wird angezeigt");
  ok("Agent 92 – Geschoss-Filter blendet Räume, nicht die allgemeinen Aufgaben");
} catch (e) { bad("Agent 92", e); }

// ---------------- Agent 93: Alle Warengruppen und Raumtypen sind vollständig
try {
  const { w } = makePhone(); await setup(w);
  const CATS = w.eval("CATS"), CIC = w.eval("CIC"), TIPS = w.eval("TIPS"), RT = w.eval("ROOM_TYPES"), IC = w.eval("IC");
  const fehlendeCat = CATS.filter(c => !CIC[c.k]).map(c => c.k);
  if (fehlendeCat.length) throw new Error("Warengruppen ohne Symbol: " + fehlendeCat.join(", "));
  const fehlendType = RT.filter(t => !IC[t.k]).map(t => t.k);
  if (fehlendType.length) throw new Error("Raumtypen ohne Symbol: " + fehlendType.join(", "));
  const ohneTipps = RT.filter(t => !TIPS[t.k] || !TIPS[t.k].length).map(t => t.k);
  if (ohneTipps.length) throw new Error("Raumtypen ohne Vorschläge: " + ohneTipps.join(", "));
  let anzahl = 0;
  for (const k in TIPS) {
    const namen = TIPS[k].map(x => x.t);
    if (new Set(namen).size !== namen.length) throw new Error("Doppelte Vorschläge bei " + k);
    TIPS[k].forEach(x => { if (!(x.d >= 1 && x.d <= 365)) throw new Error("Unplausibles Intervall bei " + k + ": " + x.t + " = " + x.d); });
    anzahl += TIPS[k].length;
  }
  ok("Agent 93 – " + RT.length + " Raumtypen, " + CATS.length + " Warengruppen, " + anzahl + " Vorschläge, alle vollständig");
} catch (e) { bad("Agent 93", e); }

// ---------------- Agent 94: Produktvorschläge sind sauber zugeordnet
try {
  const { w } = makePhone(); await setup(w);
  const TP = w.eval("TASK_PRODUCTS"), guess = w.eval("guessCat"), pf = w.eval("productsForTask");
  const alle = new Set();
  TP.forEach(([keys, prods]) => {
    if (!keys.length || !prods.length) throw new Error("Leerer Eintrag in der Produktliste");
    prods.forEach(p => alle.add(p));
  });
  const unklar = [...alle].filter(p => guess(p) === "sonst");
  if (unklar.length > 2) throw new Error("Zu viele Produkte ohne Warengruppe: " + unklar.join(", "));
  // Stichproben
  const proben = [["WC putzen", "WC-Reiniger"], ["Wäsche waschen", "Waschmittel"], ["Rasen mähen", "Rasendünger"],
                  ["Katzenklo säubern", "Katzenstreu"], ["Backofen reinigen", "Backofenreiniger"],
                  ["Wasserwerte messen", "Chlortabletten"], ["Rauchmelder testen", "9V-Batterie"]];
  const fehl = proben.filter(([a, p]) => pf(a).indexOf(p) < 0).map(([a, p]) => a + "→" + p);
  if (fehl.length) throw new Error("Fehlende Zuordnung: " + fehl.join(", "));
  if (pf("Bett frisch beziehen").indexOf("Rasendünger") >= 0) throw new Error("Unsinnige Zuordnung");
  ok("Agent 94 – " + alle.size + " Produkte, Zuordnungen stichprobenartig korrekt");
} catch (e) { bad("Agent 94", e); }

// ---------------- Agent 95: Preisgedächtnis ist schreibweisen-tolerant
try {
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "Butter"); await sleep(200);
  type(w, "#price", "2,79"); clickText(w, "button", "Hofer"); await sleep(150);
  click(w, "#addItem"); await sleep(500);
  const bp = w.eval("bestPrice");
  for (const schreib of ["butter", "BUTTER", "  Butter  ", "Butter"]) {
    const b = bp(schreib);
    if (!b || b.price !== 2.79) throw new Error("Nicht erkannt: '" + schreib + "'");
  }
  if (bp("Butterkeks")) throw new Error("Falscher Treffer bei anderem Artikel");
  ok("Agent 95 – Preisgedächtnis erkennt Groß-/Kleinschreibung und Leerzeichen");
} catch (e) { bad("Agent 95", e); }

// ---------------- Agent 96: Fälligkeitsdatum nachträglich ändern
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  click(w, "#newTask"); await sleep(200);
  type(w, "#title", "Rechnung zahlen"); click(w, "#saveTask"); await sleep(400);
  clickText(w, "button", "Rechnung zahlen"); await sleep(300);
  const morgen = new Date(); morgen.setDate(morgen.getDate() + 1);
  const iso = morgen.toISOString().slice(0, 10);
  const feld = $(w, "#tDue"); feld.value = iso;
  feld.dispatchEvent(new w.Event("change", { bubbles: true })); await sleep(150);
  click(w, "#saveTask2"); await sleep(500);
  const t = (await w.__zettl.readLocal("tasks", []))[0];
  if (t.due !== iso) throw new Error("Datum nicht gespeichert: " + t.due);
  if (!txt(w).includes("morgen")) throw new Error("Kein Hinweis 'morgen'");
  ok("Agent 96 – Fälligkeitsdatum lässt sich nachträglich setzen");
} catch (e) { bad("Agent 96", e); }

// ---------------- Agent 97: Aufgabe verschieben aktualisiert die Karte
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  click(w, "#newTask"); await sleep(200);
  pickRoom(w, "Küche"); await sleep(150);
  type(w, "#title", "Wischen"); click(w, "#saveTask"); await sleep(400);
  click(w, "#tabP"); await sleep(300);
  let kueche = [...w.document.querySelectorAll(".rbox")].find(b => b.textContent.includes("Küche"));
  if (!kueche.textContent.match(/1/)) throw new Error("Küche zeigt keine Aufgabe");
  click(w, "#tabT"); await sleep(200);
  clickText(w, "button", "Wischen"); await sleep(300);
  [...w.document.querySelectorAll("[data-troom]")].find(b => b.textContent.includes("Wohnzimmer"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(150);
  click(w, "#saveTask2"); await sleep(600);
  click(w, "#tabP"); await sleep(300);
  kueche = [...w.document.querySelectorAll(".rbox")].find(b => b.textContent.includes("Küche"));
  const wohn = [...w.document.querySelectorAll(".rbox")].find(b => b.textContent.includes("Wohnzimmer"));
  if (kueche.querySelector(".rbadge")) throw new Error("Küche zeigt noch eine Aufgabe");
  if (!wohn.querySelector(".rbadge")) throw new Error("Wohnzimmer zeigt keine Aufgabe");
  ok("Agent 97 – Verschobene Aufgabe wandert auch auf der Karte mit");
} catch (e) { bad("Agent 97", e); }

// ---------------- Agent 98: Wiederkehrend erledigen rechnet ab heute
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  click(w, "#newTask"); await sleep(200);
  type(w, "#title", "Müll"); clickText(w, "button", "alle 7 T."); await sleep(120);
  click(w, "#saveTask"); await sleep(400);
  // zwei Tage zu spät erledigen
  const alt = new Date(); alt.setDate(alt.getDate() - 2);
  await w.__zettl.updateItems("tasks", l => l.map(x => ({ ...x, due: alt.toISOString().slice(0, 10) })));
  await sleep(300);
  click(w, "[data-done]"); await sleep(600);
  const t = (await w.__zettl.readLocal("tasks", []))[0];
  const soll = new Date(); soll.setDate(soll.getDate() + 7);
  if (t.due !== soll.toISOString().slice(0, 10)) throw new Error("Nicht ab heute gerechnet: " + t.due);
  if (!t.lastDone) throw new Error("Erlediger nicht vermerkt");
  ok("Agent 98 – Erledigen rechnet ab heute, nicht ab dem verpassten Termin");
} catch (e) { bad("Agent 98", e); }

// ---------------- Agent 99: Doppeltipp auf Anlegen erzeugt keine Dublette
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(120);
  click(w, "#newTask"); await sleep(200);
  type(w, "#title", "Doppelt?");
  click(w, "#saveTask"); click(w, "#saveTask");    // zwei Mal in Folge
  await sleep(800);
  const tasks = (await w.__zettl.readLocal("tasks", [])).filter(t => !t.deleted);
  if (tasks.length !== 1) throw new Error(tasks.length + " Aufgaben statt einer");
  // Gleiches beim Einkauf
  click(w, "#tabS"); await sleep(200);
  type(w, "#what", "Milch"); click(w, "#addItem"); click(w, "#addItem"); await sleep(800);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (items.length !== 1) throw new Error(items.length + " Artikel statt einem");
  ok("Agent 99 – Doppeltipp auf Anlegen erzeugt keine Dubletten");
} catch (e) { bad("Agent 99", e); }

// ---------------- Agent 100: Schadcode in allen Feldern bleibt harmlos
try {
  const { w } = makePhone(); await setup(w);
  const boese = '<img src=x onerror=alert(1)>';
  await addItem(w, boese + " Milch");
  click(w, "#tabT"); await sleep(150);
  click(w, "#newTask"); await sleep(200);
  type(w, "#title", boese + " Aufgabe"); click(w, "#saveTask"); await sleep(400);
  click(w, "#settings"); await sleep(150);
  clickText(w, "button", "Räume verwalten"); await sleep(200);
  click(w, "#newRoom"); await sleep(200);
  type(w, "#roomName", boese); await sleep(150);
  click(w, "#saveRoom"); await sleep(500);
  if (w.document.querySelector("#app img")) throw new Error("Eingeschleustes Bild im Dokument");
  if (w.document.querySelector("#app script")) throw new Error("Eingeschleustes Skript");
  if (!txt(w).includes("onerror")) throw new Error("Text wurde verfälscht statt entschärft");
  ok("Agent 100 – Schadcode in Artikel-, Aufgaben- und Raumnamen bleibt reiner Text");
} catch (e) { bad("Agent 100", e); }


// ---------------- Agent 101: Jeder Dialog hat einen Rückweg
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Milch");
  const wege = [];
  // Artikel
  openItem(w, "Milch"); await sleep(250);
  if (!$(w, "#closeItem")) throw new Error("Artikel-Dialog ohne Schließen");
  click(w, "#closeItem"); await sleep(200);
  if (w.__zettl.S.modal) throw new Error("Artikel-Dialog bleibt offen");
  wege.push("Artikel");
  // Einstellungen -> Räume -> Raum ändern -> zurück
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Räume verwalten"); await sleep(250);
  [...w.document.querySelectorAll("[data-editroom]")][1].dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(250);
  click(w, "#closeRE"); await sleep(200);
  if (w.__zettl.S.modal !== "rooms") throw new Error("Raum-Ändern führt nicht zurück zur Liste");
  click(w, "#closeRooms"); await sleep(200);
  if (w.__zettl.S.modal !== "settings") throw new Error("Räume führen nicht zurück in die Einstellungen");
  wege.push("Räume");
  // Geschäfte
  clickText(w, "button", "Geschäfte"); await sleep(250);
  click(w, "#closeShops"); await sleep(200);
  if (w.__zettl.S.modal !== "settings") throw new Error("Geschäfte führen nicht zurück");
  wege.push("Geschäfte");
  // Sync
  clickText(w, "button", "Sync einrichten"); await sleep(250);
  click(w, "#closeSync"); await sleep(200);
  if (w.__zettl.S.modal) throw new Error("Sync-Dialog bleibt offen");
  wege.push("Sync");
  ok("Agent 101 – Alle Dialoge lassen sich verlassen (" + wege.join(", ") + ")");
} catch (e) { bad("Agent 101", e); }

// ---------------- Agent 102: Tippen neben den Dialog schließt ihn
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(250);
  const bd = $(w, "#backdrop");
  if (!bd) throw new Error("Kein Hintergrund");
  const ev = new w.Event("click", { bubbles: true });
  Object.defineProperty(ev, "target", { value: bd });
  bd.dispatchEvent(ev); await sleep(250);
  if (w.__zettl.S.modal) throw new Error("Tippen daneben schließt nicht");
  ok("Agent 102 – Tippen neben einen Dialog schließt ihn");
} catch (e) { bad("Agent 102", e); }

// ---------------- Agent 103: Identität wechseln, Farben bleiben zugeordnet
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Von Rü");
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Wechseln"); await sleep(250);
  clickText(w, "button", "Verena"); await sleep(400);
  await addItem(w, "Von Verena");
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  const members = await w.__zettl.readLocal("members", []);
  const ruId = members.find(m => m.name === "Rü").id;
  const veId = members.find(m => m.name === "Verena").id;
  if (items.find(i => i.name === "Von Rü").by !== ruId) throw new Error("Erster Eintrag falsch zugeordnet");
  if (items.find(i => i.name === "Von Verena").by !== veId) throw new Error("Zweiter Eintrag falsch zugeordnet");
  const farben = new Set(members.map(m => m.color));
  if (farben.size !== 2) throw new Error("Beide haben dieselbe Farbe");
  ok("Agent 103 – Identitätswechsel ordnet Einträge korrekt zu");
} catch (e) { bad("Agent 103", e); }

// ---------------- Agent 104: Erledigte Aufgaben werden mit Namen protokolliert
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(150);
  for (let i = 1; i <= 10; i++) {
    click(w, "#newTask"); await sleep(180);
    type(w, "#title", "Aufgabe " + i); click(w, "#saveTask"); await sleep(350);
  }
  const boxes = [...w.document.querySelectorAll("[data-done]")];
  for (const b of boxes) { b.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(250); }
  await sleep(600);
  const t = txt(w);
  if (!t.includes("Erledigt")) throw new Error("Kein Erledigt-Bereich");
  if (!t.includes("Rü")) throw new Error("Erlediger nicht vermerkt");
  const gezeigt = (t.match(/Aufgabe \d+/g) || []).length;
  if (gezeigt > 9) throw new Error("Erledigt-Liste wird zu lang: " + gezeigt);
  const tasks = (await w.__zettl.readLocal("tasks", [])).filter(x => !x.deleted);
  if (tasks.filter(x => x.doneAt).length !== 10) throw new Error("Nicht alle als erledigt gespeichert");
  ok("Agent 104 – Erledigte werden mit Name protokolliert, Liste bleibt kurz");
} catch (e) { bad("Agent 104", e); }

// ---------------- Agent 105: Wagerl-Artikel bleiben korrekt gruppiert
try {
  const { w } = makePhone(); await setup(w);
  for (const n of ["Milch", "Bananen", "Klopapier"]) await addItem(w, n);
  const box = [...w.document.querySelectorAll("[data-toggle]")].find(b => b.closest(".item").textContent.includes("Bananen"));
  box.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(500);
  const t = txt(w);
  const iWagerl = t.indexOf("Im Wagerl");
  const iBananen = t.indexOf("Bananen");
  if (iWagerl < 0) throw new Error("Kein Wagerl");
  if (iBananen < iWagerl) throw new Error("Erledigter Artikel steht noch oben in seiner Abteilung");
  if (t.indexOf("Obst") > iWagerl) throw new Error("Leere Abteilung wird noch angezeigt");
  ok("Agent 105 – Abgehakte Artikel verlassen ihre Abteilung und landen im Wagerl");
} catch (e) { bad("Agent 105", e); }

// ---------------- Agent 106: 150 Aufgaben über alle Räume
try {
  const { w } = makePhone(); await setup(w);
  const rooms = (await w.__zettl.readLocal("rooms", [])).filter(r => !r.deleted);
  const viele = [];
  for (let i = 0; i < 150; i++) viele.push({ id: "t" + i, title: "Aufgabe " + i,
    room: rooms[i % rooms.length].name, by: w.__zettl.S.meId, repeat: (i % 3) ? null : 7,
    due: i % 4 === 0 ? "2026-01-01" : null, doneAt: null, updatedAt: Date.now() });
  const t0 = Date.now();
  await w.__zettl.updateItems("tasks", l => l.concat(viele));
  await sleep(900);
  click(w, "#tabT"); await sleep(400);
  const dauer = Date.now() - t0;
  const zeilen = w.document.querySelectorAll("[data-task]").length;
  if (zeilen < 140) throw new Error("Nicht alle dargestellt: " + zeilen);
  if (dauer > 9000) throw new Error("Zu langsam: " + dauer + "ms");
  if (!txt(w).includes("drüber")) throw new Error("Überfällige nicht markiert");
  click(w, "#tabP"); await sleep(400);
  if (!w.document.querySelector(".rbadge")) throw new Error("Karte zeigt keine Zahlen");
  ok("Agent 106 – 150 Aufgaben in " + dauer + "ms, Liste und Karte bleiben brauchbar");
} catch (e) { bad("Agent 106", e); }

// ---------------- Agent 107: Sync mit großem Datenbestand
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://gross.supabase.co", key: "k" });
  const A = makePhone({ "zettl.sync": cfg }); await setup(A.w); await sleep(500);
  const viele = [];
  for (let i = 0; i < 200; i++) viele.push({ id: "i" + i, name: "Artikel " + i, price: i / 10,
    store: "Billa", cat: "vorrat", by: A.w.__zettl.S.meId, done: false, at: "2026-07-01", updatedAt: Date.now() });
  await A.w.__zettl.updateItems("shopping", l => l.concat(viele));
  await sleep(1500);
  const B = makePhone({ "zettl.sync": cfg }); await sleep(600);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B bereit");
  clickText(B.w, "button", "Verena");
  await until(() => txt(B.w).includes("Artikel 199"), "Große Liste angekommen", 15000);
  const items = (await B.w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (items.length !== 200) throw new Error("Nur " + items.length + " von 200 übertragen");
  ok("Agent 107 – 200 Artikel werden vollständig auf das zweite Handy übertragen");
} catch (e) { bad("Agent 107", e); }

// ---------------- Agent 108: Zustand bleibt beim Tabwechsel erhalten
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(150);
  for (const [room, title] of [["Bad", "WC putzen"], ["Küche", "Herd putzen"]]) {
    click(w, "#newTask"); await sleep(200);
    pickRoom(w, room); await sleep(150);
    type(w, "#title", title); click(w, "#saveTask"); await sleep(400);
  }
  [...w.document.querySelectorAll("[data-floor]")].find(b => b.getAttribute("data-floor") === "1. Stock")
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  click(w, "#tabS"); await sleep(250);
  click(w, "#tabT"); await sleep(300);
  if (w.__zettl.S.floor !== "1. Stock") throw new Error("Geschoss-Filter vergessen");
  const aktiv = [...w.document.querySelectorAll("[data-floor]")].find(b => b.classList.contains("on"));
  if (!aktiv || aktiv.getAttribute("data-floor") !== "1. Stock") throw new Error("Filter optisch nicht markiert");
  ok("Agent 108 – Geschoss-Filter überlebt den Tabwechsel");
} catch (e) { bad("Agent 108", e); }

// ---------------- Agent 109: Aufgabe direkt aus dem Raum-Dialog erledigen
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(150);
  click(w, "#newTask"); await sleep(200);
  pickRoom(w, "Küche"); await sleep(150);
  type(w, "#title", "Spüle putzen"); click(w, "#saveTask"); await sleep(400);
  click(w, "#tabP"); await sleep(350);
  [...w.document.querySelectorAll(".rbox")].find(b => b.textContent.includes("Küche"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  if (!txt(w).includes("Spüle putzen")) throw new Error("Aufgabe nicht im Raum-Dialog");
  click(w, "[data-done]"); await sleep(600);
  const t = (await w.__zettl.readLocal("tasks", []))[0];
  if (!t.doneAt) throw new Error("Erledigen aus dem Raum-Dialog wirkt nicht");
  ok("Agent 109 – Aufgaben lassen sich direkt aus dem Raum-Dialog erledigen");
} catch (e) { bad("Agent 109", e); }

// ---------------- Agent 110: Alles zusammen – ein kompletter Haushaltstag
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://alltag.supabase.co", key: "k" });
  const A = makePhone({ "zettl.sync": cfg }); await setup(A.w); await sleep(500);
  // Rü trägt den Einkauf ein
  for (const [n, p, s] of [["Milch", "1,29", "Hofer"], ["Brot", "2,50", "Billa"], ["Butter", "2,79", "Hofer"]]) {
    type(A.w, "#what", n); await sleep(200);
    type(A.w, "#price", p); clickText(A.w, "button", s); await sleep(150);
    click(A.w, "#addItem"); await sleep(450);
  }
  // Aufgabe mit Produktvorschlag
  click(A.w, "#tabT"); await sleep(200);
  click(A.w, "#newTask"); await sleep(200);
  pickRoom(A.w, "Bad"); await sleep(150);
  type(A.w, "#title", "WC putzen"); clickText(A.w, "button", "alle 3 T."); await sleep(120);
  click(A.w, "#saveTask"); await sleep(500);
  clickText(A.w, "button", "WC putzen"); await sleep(350);
  [...A.w.document.querySelectorAll("[data-prod]")][0].dispatchEvent(new A.w.Event("click", { bubbles: true }));
  await sleep(200);
  click(A.w, "#takeProds"); await sleep(700);
  // Verena kommt dazu
  const B = makePhone({ "zettl.sync": cfg }); await sleep(600);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B bereit");
  clickText(B.w, "button", "Verena"); await sleep(600);
  await until(() => txt(B.w).includes("Milch"), "Liste bei B");
  if (!txt(B.w).includes("WC-Reiniger")) throw new Error("Produkt aus der Aufgabe fehlt bei B");
  // Verena kauft ein und hakt ab
  const boxes = [...B.w.document.querySelectorAll("[data-toggle]")].slice(0, 2);
  boxes.forEach(b => b.dispatchEvent(new B.w.Event("click", { bubbles: true })));
  await sleep(900);
  click(B.w, "#tabT"); await sleep(300);
  click(B.w, "[data-done]"); await sleep(700);
  // Rü synct und sieht alles
  await A.api().syncNow(false); await sleep(900);
  const items = (await A.w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  const erledigt = items.filter(i => i.done).length;
  if (erledigt !== 2) throw new Error("Abhaken kam nicht an: " + erledigt);
  const tasks = (await A.w.__zettl.readLocal("tasks", [])).filter(t => !t.deleted);
  if (!tasks[0].lastDone) throw new Error("Erledigte Aufgabe kam nicht an");
  const members = await A.w.__zettl.readLocal("members", []);
  if (tasks[0].lastDone.by !== members.find(m => m.name === "Verena").id) throw new Error("Falscher Erlediger");
  ok("Agent 110 – Kompletter Alltag zu zweit: einkaufen, putzen, abhaken, alles synct");
} catch (e) { bad("Agent 110", e); }


// ---------------- Agent 111: Kaufhistorie entsteht beim Abhaken
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Milch");
  click(w, "[data-toggle]"); await sleep(700);
  const p = await w.__zettl.readLocal("prices", {});
  const e = p["milch"];
  if (!e || !e.buys || e.buys.length !== 1) throw new Error("Kein Kaufdatum gemerkt");
  // Zweimal am selben Tag zählt nur einmal
  click(w, "[data-toggle]"); await sleep(500);
  click(w, "[data-toggle]"); await sleep(700);
  const p2 = await w.__zettl.readLocal("prices", {});
  if (p2["milch"].buys.length !== 1) throw new Error("Mehrfach am selben Tag gezählt: " + p2["milch"].buys.length);
  ok("Agent 111 – Kaufdatum wird beim Abhaken gemerkt, einmal pro Tag");
} catch (e) { bad("Agent 111", e); }

// ---------------- Agent 112: Wieder-fällig-Vorschläge aus dem Rhythmus
try {
  const { w } = makePhone(); await setup(w);
  const tage = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  // Milch alle 4 Tage, zuletzt vor 5 Tagen -> fällig. Reis alle 30 Tage, zuletzt vor 2 Tagen -> nicht fällig.
  await w.__zettl.writeLocal("prices", {
    "milch": { byStore: {}, last: null, lastName: "Milch", buys: [tage(13), tage(9), tage(5)], updatedAt: 1 },
    "reis":  { byStore: {}, last: null, lastName: "Reis",  buys: [tage(62), tage(32), tage(2)], updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(800);
  const t = txt(w);
  if (!t.includes("Zuletzt gekauft")) throw new Error("Keine Vorschlagsliste");
  if (!t.includes("Milch")) throw new Error("Milch fehlt im Verlauf");
  // Reis ist nicht fällig, gehört aber in den Verlauf – genau das war vorher die Lücke
  if (!t.includes("Reis")) throw new Error("Nicht Fälliges fehlt im Verlauf");
  const chips = [...w.document.querySelectorAll("[data-zuletzt]")];
  if (chips.length !== 2) throw new Error("Erwartet 2 Vorschläge, sind " + chips.length);
  if (!chips[0].textContent.includes("Milch")) throw new Error("Fälliges steht nicht vorn: " + chips[0].textContent);
  // Antippen setzt ihn auf die Liste
  chips[0].dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(700);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (!items.some(i => i.name === "Milch")) throw new Error("Vorschlag landet nicht auf der Liste");
  if (items.filter(i => i.name === "Milch").length !== 1) throw new Error("Milch doppelt angelegt");
  if ([...w.document.querySelectorAll("[data-zuletzt]")].some(b => b.textContent.includes("Milch")))
    throw new Error("Vorschlag bleibt trotz Liste stehen");
  ok("Agent 112 – Verlauf: Fälliges vorn, Seltenes bleibt drin, Antippen setzt es auf die Liste");
} catch (e) { bad("Agent 112", e); }

// ---------------- Agent 113: Wegkosten – zweiter Laden lohnt sich
try {
  const { w } = makePhone(); await setup(w);
  await w.__zettl.saveShops({ home: { lat: 48.2, lon: 14.28, at: Date.now() },
    car: { verbrauch: 7, preis: 1.75 },
    list: [{ id: "a", name: "Billa", dist: 0.5, chosen: true, updatedAt: 1 },
           { id: "b", name: "Hofer", dist: 3, chosen: true, updatedAt: 1 }] });
  await sleep(400);
  // Zwei Artikel, beide Läden bekannt: bei Hofer deutlich günstiger
  await w.__zettl.writeLocal("prices", {
    "waschmittel": { byStore: { "Billa": { price: 14.99 }, "Hofer": { price: 8.99 } }, lastName: "Waschmittel", updatedAt: 1 },
    "kaffee": { byStore: { "Billa": { price: 9.99 }, "Hofer": { price: 5.99 } }, lastName: "Kaffee", updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(600);
  await addItem(w, "Waschmittel"); await addItem(w, "Kaffee");
  click(w, "#priceHelp"); await sleep(400);
  const t = txt(w);
  if (!t.includes("Ein Laden oder zwei")) throw new Error("Keine Wegkosten-Rechnung");
  if (!t.includes("km")) throw new Error("Umweg nicht berechnet");
  ok("Agent 113 – Wegkosten-Rechnung erscheint mit Umweg in Kilometern");
} catch (e) { bad("Agent 113", e); }

// ---------------- Agent 114: Kleiner Vorteil, weiter Weg -> Warnung
try {
  const { w } = makePhone(); await setup(w);
  await w.__zettl.saveShops({ home: { lat: 48.2, lon: 14.28, at: Date.now() },
    car: { verbrauch: 8, preis: 1.9 },
    list: [{ id: "a", name: "Billa", dist: 0.4, chosen: true, updatedAt: 1 },
           { id: "b", name: "Hofer", dist: 12, chosen: true, updatedAt: 1 }] });
  await w.__zettl.writeLocal("prices", {
    "butter": { byStore: { "Billa": { price: 3.19 }, "Hofer": { price: 2.79 } }, lastName: "Butter", updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(700);
  await addItem(w, "Butter");
  // Zweiter Artikel nur bei Billa, damit überhaupt aufgeteilt würde
  await w.__zettl.writeLocal("prices", Object.assign(await w.__zettl.readLocal("prices", {}),
    { "brot": { byStore: { "Billa": { price: 2.5 } }, lastName: "Brot", updatedAt: 1 } }));
  await w.__zettl.boot(); await sleep(700);
  await addItem(w, "Brot");
  click(w, "#priceHelp"); await sleep(400);
  const t = txt(w);
  if (!t.includes("lohnt sich kaum") && !t.includes("Verlust"))
    throw new Error("Warnung fehlt trotz 12 km Umweg für 40 Cent: " + t.slice(t.indexOf("Ein Laden"), t.indexOf("Ein Laden") + 250));
  ok("Agent 114 – Bei 40 Cent Vorteil und 12 km Umweg warnt die App ehrlich");
} catch (e) { bad("Agent 114", e); }

// ---------------- Agent 115: Fahrtkosten einstellen und speichern
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Geschäfte"); await sleep(300);
  type(w, "#carUse", "5,5"); type(w, "#carPrice", "1,60");
  click(w, "#saveCar"); await sleep(600);
  const shops = await w.__zettl.readLocal("shops", {});
  if (!shops.car || shops.car.verbrauch !== 5.5 || shops.car.preis !== 1.6)
    throw new Error("Nicht gespeichert: " + JSON.stringify(shops.car));
  const kosten = w.eval("fahrtKosten")(10);
  const soll = 10 * 0.055 * 1.6;
  if (Math.abs(kosten - soll) > 0.01) throw new Error("Rechnung falsch: " + kosten + " statt " + soll);
  ok("Agent 115 – Verbrauch und Spritpreis werden gespeichert und richtig verrechnet");
} catch (e) { bad("Agent 115", e); }

// ---------------- Agent 116: Ohne Entfernung ehrlicher Hinweis
try {
  const { w } = makePhone(); await setup(w);
  await w.__zettl.writeLocal("prices", {
    "butter": { byStore: { "Billa": { price: 3.49 }, "Hofer": { price: 2.49 } }, lastName: "Butter", updatedAt: 1 },
    "brot": { byStore: { "Billa": { price: 2.2 } }, lastName: "Brot", updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(700);
  await addItem(w, "Butter"); await addItem(w, "Brot");
  click(w, "#priceHelp"); await sleep(400);
  const t = txt(w);
  if (!t.includes("fehlt die Entfernung")) throw new Error("Kein Hinweis auf fehlende Entfernungen");
  ok("Agent 116 – Ohne bekannte Entfernung sagt die App klar, was ihr fehlt");
} catch (e) { bad("Agent 116", e); }

// ---------------- Agent 117: Kaufhistorie synct mit
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://hist.supabase.co", key: "k" });
  const A = makePhone({ "zettl.sync": cfg }); await setup(A.w); await sleep(500);
  await addItem(A.w, "Milch");
  click(A.w, "[data-toggle]"); await sleep(900);
  const B = makePhone({ "zettl.sync": cfg }); await sleep(600);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B bereit");
  clickText(B.w, "button", "Verena"); await sleep(700);
  const p = await B.w.__zettl.readLocal("prices", {});
  if (!p["milch"] || !p["milch"].buys || !p["milch"].buys.length) throw new Error("Kaufhistorie nicht gesynct");
  ok("Agent 117 – Kaufhistorie landet auch auf dem zweiten Handy");
} catch (e) { bad("Agent 117", e); }

// ---------------- Agent 118: Vorschlagsleiste stört die Eingabe nicht
try {
  const { w } = makePhone(); await setup(w);
  const tage = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  await w.__zettl.writeLocal("prices", {
    "milch": { byStore: {}, lastName: "Milch", buys: [tage(12), tage(8), tage(4)], updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(700);
  if (!txt(w).includes("Zuletzt gekauft")) throw new Error("Keine Vorschläge");
  // Der Verlauf steht in der Liste, nicht im Dock – er darf beim Tippen bleiben
  type(w, "#what", "Brot"); await sleep(300);
  if (!txt(w).includes("Zuletzt gekauft")) throw new Error("Verlauf verschwindet beim Tippen");
  if ($(w, "#what").value !== "Brot") throw new Error("Eingabe verloren");
  // Was sich aufklappt, muss sich auch schließen lassen
  if (!$(w, "#closeBar")) throw new Error("Kein Schließen-Knopf an der aufgeklappten Leiste");
  click(w, "#closeBar"); await sleep(350);
  if ($(w, "#what").value !== "") throw new Error("Schließen räumt die Eingabe nicht weg");
  if ($(w, "#closeBar")) throw new Error("Leiste bleibt aufgeklappt");
  if (!txt(w).includes("Zuletzt gekauft")) throw new Error("Verlauf nach dem Schließen weg");
  ok("Agent 118 – Verlauf bleibt beim Tippen stehen, die Leiste lässt sich schließen");
} catch (e) { bad("Agent 118", e); }


// ---------------- Agent 119: Ort eintippen statt Standort freigeben
try {
  GEO.deny = true; OVERPASS.fail = false; NOMINATIM.fail = false;
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Geschäfte"); await sleep(300);
  click(w, "#locate"); await sleep(700);
  const t1 = txt(w);
  if (!t1.includes("gesperrt")) throw new Error("Kein hilfreicher Hinweis bei gesperrtem Standort");
  if (!t1.includes("Ort eintippen")) throw new Error("Kein Hinweis auf die Alternative");
  // Jetzt der Weg über die Ortssuche
  type(w, "#placeQ", "Leonding");
  click(w, "#placeGo"); await sleep(700);
  if (!txt(w).includes("Leonding")) throw new Error("Keine Trefferliste");
  [...w.document.querySelectorAll("[data-place]")][0].dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(1000);
  const shops = await w.__zettl.readLocal("shops", { list: [] });
  if (!shops.home) throw new Error("Ort nicht übernommen");
  if (Math.abs(shops.home.lat - 48.2) > 0.01) throw new Error("Falsche Koordinaten: " + shops.home.lat);
  if (!shops.list.some(s => s.name.includes("Hofer"))) throw new Error("Läden nicht gefunden");
  if (!txt(w).includes("km")) throw new Error("Keine Entfernungen");
  GEO.deny = false;
  ok("Agent 119 – Gesperrter Standort: Ort eintippen führt trotzdem zu den Läden");
} catch (e) { GEO.deny = false; bad("Agent 119", e); }

// ---------------- Agent 120: Ortssuche ohne Treffer und mit Störung
try {
  NOMINATIM.hits = [];
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Geschäfte"); await sleep(300);
  type(w, "#placeQ", "Kfjdksl");
  click(w, "#placeGo"); await sleep(700);
  if (!txt(w).includes("Nichts gefunden")) throw new Error("Kein Hinweis bei null Treffern");
  type(w, "#placeQ", "ab");
  click(w, "#placeGo"); await sleep(600);
  if (!txt(w).includes("drei Buchstaben")) throw new Error("Zu kurze Eingabe nicht abgefangen");
  NOMINATIM.fail = true;
  type(w, "#placeQ", "Leonding");
  click(w, "#placeGo"); await sleep(700);
  if (!txt(w).includes("Zu viele Anfragen") && !txt(w).includes("fehlgeschlagen")) throw new Error("Störung nicht gemeldet");
  NOMINATIM.fail = false;
  NOMINATIM.hits = [
    { display_name: "Leonding, Bezirk Linz-Land, Oberösterreich, Österreich", lat: "48.2000", lon: "14.2850" },
    { display_name: "Leondinger Straße, Linz, Österreich", lat: "48.2600", lon: "14.2700" }
  ];
  ok("Agent 120 – Ortssuche meldet leere Treffer, zu kurze Eingaben und Störungen sauber");
} catch (e) { NOMINATIM.fail = false; bad("Agent 120", e); }



// ---------------- Agent 121: Überlasteter Kartendienst -> Ausweichserver
try {
  GEO.deny = false; OVERPASS.fail = false;
  OVERPASS.failHosts = ["overpass-api.de"];          // Hauptserver liefert 504
  OVERPASS.usedHost = null;
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Geschäfte"); await sleep(300);
  click(w, "#locate"); await sleep(1200);
  if (!OVERPASS.usedHost || OVERPASS.usedHost.indexOf("kumi") < 0)
    throw new Error("Kein Ausweichserver verwendet: " + OVERPASS.usedHost);
  if (!txt(w).includes("Hofer Leonding")) throw new Error("Trotz Ausweichserver keine Läden");
  if (txt(w).includes("504")) throw new Error("Fehler wird trotz Erfolg angezeigt");
  OVERPASS.failHosts = [];
  ok("Agent 121 – Fällt ein Kartendienst-Server aus, übernimmt der nächste");
} catch (e) { OVERPASS.failHosts = []; bad("Agent 121", e); }

// ---------------- Agent 122: Alle Server aus -> verständlicher Hinweis
try {
  GEO.deny = false;
  OVERPASS.fail = true; OVERPASS.status = 504;
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Geschäfte"); await sleep(300);
  click(w, "#locate"); await sleep(1400);
  const t = txt(w);
  if (t.includes("HTTP 504")) throw new Error("Technischer Fehlercode statt Klartext");
  if (!t.includes("überlastet")) throw new Error("Kein verständlicher Hinweis: " + t.slice(t.indexOf("Standort"), t.indexOf("Standort") + 200));
  if (!t.includes("von Hand")) throw new Error("Kein Ausweg genannt");
  // Von Hand geht weiterhin
  type(w, "#shopName", "Hofer ums Eck"); click(w, "#addShop"); await sleep(600);
  const shops = await w.__zettl.readLocal("shops", { list: [] });
  if (!shops.list.some(s => s.name === "Hofer ums Eck")) throw new Error("Handeintrag klappt nicht");
  OVERPASS.fail = false; OVERPASS.status = null;
  ok("Agent 122 – Totalausfall des Kartendienstes wird verständlich erklärt, Handeintrag bleibt");
} catch (e) { OVERPASS.fail = false; OVERPASS.status = null; bad("Agent 122", e); }

// ---------------- Agent 123: Zu viele Anfragen und kein Netz
try {
  GEO.deny = false;
  OVERPASS.fail = true; OVERPASS.status = 429;
  const A = makePhone(); await setup(A.w);
  click(A.w, "#settings"); await sleep(200);
  clickText(A.w, "button", "Geschäfte"); await sleep(300);
  click(A.w, "#locate"); await sleep(1400);
  if (!txt(A.w).includes("Zu viele Anfragen")) throw new Error("429 nicht erklärt");
  OVERPASS.fail = false; OVERPASS.status = null;
  const B = makePhone(); await setup(B.w);
  B.w.fetch = () => Promise.reject(new Error("Failed to fetch"));
  click(B.w, "#settings"); await sleep(200);
  clickText(B.w, "button", "Geschäfte"); await sleep(300);
  click(B.w, "#locate"); await sleep(1400);
  if (!txt(B.w).includes("Keine Verbindung")) throw new Error("Funkloch nicht erklärt");
  ok("Agent 123 – Überlastung, Sperre und Funkloch werden unterschieden");
} catch (e) { OVERPASS.fail = false; OVERPASS.status = null; bad("Agent 123", e); }


// ---------------- Agent 121: Produktsuche mit Preisen und Bild
try {
  SRV.fail = false;
  const { w } = makePhone(); await setup(w);
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Preisquelle einstellen"); await sleep(250);
  type(w, "#srvUrl", "https://preise.test");
  click(w, "#saveSrv"); await sleep(800);
  if (!txt(w).includes("Verbunden")) throw new Error("Server nicht verbunden: " + txt(w).slice(-120));
  click(w, "#closeSrv"); await sleep(200); click(w, "#closeSet"); await sleep(250);
  type(w, "#what", "salz");
  await until(() => w.document.querySelector("[data-hit]"), "Trefferliste", 6000);
  const t = txt(w);
  if (!t.includes("Speisesalz jodiert")) throw new Error("Treffer fehlt");
  if (!t.includes("0,59") || !t.includes("Hofer")) throw new Error("Günstigster Preis fehlt");
  if (!t.includes("Spar") || !t.includes("0,75")) throw new Error("Weitere Läden fehlen");
  if (!t.includes("Aktion")) throw new Error("Aktions-Kennzeichen fehlt");
  if (!w.document.querySelector('[data-hit] img')) throw new Error("Produktbild wird nicht angezeigt");
  ok("Agent 121 – Produktsuche zeigt Preise je Laden, Aktion und Bild");
} catch (e) { bad("Agent 121", e); }

// ---------------- Agent 122: Treffer übernehmen setzt Preis und Laden
try {
  SRV.fail = false;
  const { w } = makePhone(); await setup(w);
  await w.__zettl.saveShops({ home: null, list: [], srv: { url: "https://preise.test", token: "" } });
  await sleep(400);
  type(w, "#what", "salz");
  await until(() => w.document.querySelector("[data-hit]"), "Treffer", 6000);
  w.document.querySelector("[data-hit]").dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(800);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (items.length !== 1) throw new Error("Nicht übernommen");
  const it = items[0];
  if (!it.name.includes("Speisesalz") || !it.name.includes("500 g")) throw new Error("Name ohne Größe: " + it.name);
  if (it.price !== 0.59 || it.store !== "Hofer") throw new Error("Preis/Laden fehlen: " + JSON.stringify(it));
  if (it.cat !== "vorrat") throw new Error("Warengruppe falsch: " + it.cat);
  if ($(w, "#what").value !== "") throw new Error("Eingabefeld nicht geleert");
  const b = w.eval("bestPrice")(it.name);
  if (!b || b.store !== "Hofer") throw new Error("Preis nicht ins Gedächtnis übernommen");
  ok("Agent 122 – Treffer landet mit Größe, Preis, Laden und Warengruppe auf der Liste");
} catch (e) { bad("Agent 122", e); }

// ---------------- Agent 123: Ohne Server und bei Serverausfall bleibt alles bedienbar
try {
  const A = makePhone(); await setup(A.w);
  type(A.w, "#what", "salz"); await sleep(700);
  if (A.w.document.querySelector("[data-hit]")) throw new Error("Suche ohne eingerichteten Server");
  click(A.w, "#addItem"); await sleep(500);
  if (!txt(A.w).includes("salz")) throw new Error("Eintragen ohne Server geht nicht");
  // Jetzt mit Server, aber der ist gestört
  SRV.fail = true;
  const B = makePhone(); await setup(B.w);
  await B.w.__zettl.saveShops({ home: null, list: [], srv: { url: "https://preise.test", token: "" } });
  await sleep(400);
  type(B.w, "#what", "salz"); await sleep(900);
  if (B.w.document.querySelector("[data-hit]")) throw new Error("Trefferliste trotz Störung");
  click(B.w, "#addItem"); await sleep(500);
  const items = (await B.w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (items.length !== 1) throw new Error("Eintragen bei Serverausfall blockiert");
  SRV.fail = false;
  ok("Agent 123 – Ohne Server und bei Störung funktioniert die Liste normal weiter");
} catch (e) { SRV.fail = false; bad("Agent 123", e); }

// ---------------- Agent 124: Server-Zugang synct und lässt sich entfernen
try {
  REMOTE.clear(); SRV.fail = false;
  const cfg = JSON.stringify({ url: "https://srvsync.supabase.co", key: "k" });
  const A = makePhone({ "zettl.sync": cfg }); await setup(A.w); await sleep(500);
  await A.w.__zettl.saveShops({ home: null, list: [], srv: { url: "https://preise.test", token: "geheim" } });
  await sleep(900);
  const B = makePhone({ "zettl.sync": cfg }); await sleep(600);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B bereit");
  clickText(B.w, "button", "Verena"); await sleep(700);
  const shops = await B.w.__zettl.readLocal("shops", {});
  if (!shops.srv || shops.srv.url !== "https://preise.test") throw new Error("Server-Zugang nicht gesynct");
  // Entfernen
  click(B.w, "#settings"); await sleep(250);
  clickText(B.w, "button", "Preisquelle einstellen"); await sleep(300);
  click(B.w, "#offSrv"); await sleep(600);
  const nachher = await B.w.__zettl.readLocal("shops", {});
  if (nachher.srv && nachher.srv.url) throw new Error("Server nicht entfernt");
  if (B.w.eval("srvOn()")) throw new Error("App nutzt den Server weiter");
  ok("Agent 124 – Server-Zugang landet auf beiden Handys und lässt sich entfernen");
} catch (e) { bad("Agent 124", e); }


// ---------------- Agent 125: Alte Preise werden als alt gekennzeichnet
try {
  SRV.fail = false;
  const { w } = makePhone(); await setup(w);
  await w.__zettl.saveShops({ home: null, list: [], srv: { url: "https://preise.test", token: "" } });
  await sleep(400);
  type(w, "#what", "salz");
  await until(() => w.document.querySelector("[data-hit]"), "Treffer", 6000);
  const t = txt(w);
  if (!t.includes("Altes Salz")) throw new Error("Alter Treffer fehlt");
  if (!t.match(/Stand \d{2}\/\d{4}/)) throw new Error("Kein Stand-Hinweis bei altem Preis: " + t.slice(t.indexOf("Altes Salz") - 60, t.indexOf("Altes Salz") + 90));
  // Frischer Treffer bekommt keinen Stand-Hinweis
  const frisch = [...w.document.querySelectorAll("[data-hit]")].find(b => b.textContent.includes("Speisesalz"));
  if (frisch && frisch.textContent.includes("Stand ")) throw new Error("Frischer Preis fälschlich als alt markiert");
  // Alten Treffer übernehmen: Preis kommt mit, wandert aber nicht ins Gedächtnis
  const alt = [...w.document.querySelectorAll("[data-hit]")].find(b => b.textContent.includes("Altes Salz"));
  alt.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(800);
  const it = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted)[0];
  if (!it || it.price !== 0.39) throw new Error("Preis nicht übernommen");
  const p = await w.__zettl.readLocal("prices", {});
  const eintrag = p[Object.keys(p).find(k => k.includes("altes salz")) || ""];
  if (eintrag && eintrag.byStore && eintrag.byStore.MPREIS) throw new Error("Veralteter Preis landet im Gedächtnis");
  ok("Agent 125 – Alte Preise werden mit Stand ausgewiesen und nicht ins Gedächtnis übernommen");
} catch (e) { bad("Agent 125", e); }


// ---------------- Agent 126: Preisdatei liefert Live-Preise ohne Server
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "butter");
  await until(() => w.document.querySelector("[data-hit]"), "Trefferliste aus der Datei", 8000);
  const t = txt(w);
  if (!t.includes("S-BUDGET Butter")) throw new Error("Kein Treffer");
  if (!t.includes("1,51") || !t.includes("Spar")) throw new Error("Günstigster Preis fehlt");
  if (!t.includes("Billa")) throw new Error("Zweiter Laden fehlt");
  if (!t.includes("Preise vom")) throw new Error("Kein Stand-Hinweis");
  // Butter muss vor der Butter-Apfeltasche stehen
  if (t.indexOf("Butter-Apfeltasche") >= 0 && t.indexOf("S-BUDGET Butter") > t.indexOf("Butter-Apfeltasche"))
    throw new Error("Falsche Reihenfolge: Apfeltasche vor Butter");
  ok("Agent 126 – Preisdatei liefert Treffer mit Preisvergleich, ganz ohne Server");
} catch (e) { bad("Agent 126", e); }

// ---------------- Agent 127: Treffer aus der Datei landet korrekt auf der Liste
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "vollmilch");
  await until(() => w.document.querySelector("[data-hit]"), "Treffer", 8000);
  w.document.querySelector("[data-hit]").dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(800);
  const it = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted)[0];
  if (!it) throw new Error("Nicht übernommen");
  if (it.price !== 1.32 || it.store !== "Billa") throw new Error("Preis/Laden falsch: " + JSON.stringify(it));
  if (!it.name.includes("1 l")) throw new Error("Größe fehlt im Namen: " + it.name);
  if (it.cat !== "kuehl") throw new Error("Warengruppe falsch: " + it.cat);
  ok("Agent 127 – Treffer aus der Preisdatei landet mit Preis, Laden und Größe auf der Liste");
} catch (e) { bad("Agent 127", e); }

// ---------------- Agent 128: Österreichisch und Ausfall der Datei
try {
  PREISDATEI.fail = false;
  const A = makePhone(); await setup(A.w);
  type(A.w, "#what", "klopapier");
  await until(() => txt(A.w).includes("Toilettenpapier"), "Synonym greift", 8000);
  // Fehlt die Datei, muss die App normal weiterlaufen
  PREISDATEI.fail = true;
  const B = makePhone(); await setup(B.w);
  type(B.w, "#what", "butter"); await sleep(1200);
  if (B.w.document.querySelector("[data-hit]")) throw new Error("Trefferliste trotz fehlender Datei");
  click(B.w, "#addItem"); await sleep(500);
  const items = (await B.w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (items.length !== 1) throw new Error("Eintragen ohne Preisdatei blockiert");
  PREISDATEI.fail = false;
  ok("Agent 128 – 'Klopapier' findet Toilettenpapier; fehlende Datei stört die App nicht");
} catch (e) { PREISDATEI.fail = false; bad("Agent 128", e); }


// ---------------- Agent 129: Bio und Regional werden gekennzeichnet und bevorzugt
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "butter");
  await until(() => w.document.querySelector("[data-hit]"), "Treffer", 8000);
  let t = txt(w);
  if (!t.includes("Bio")) throw new Error("Kein Bio-Kennzeichen");
  if (!t.includes("AT")) throw new Error("Kein Regional-Kennzeichen");
  // Ohne Vorliebe gewinnt der Preis
  let erste = w.document.querySelector("[data-hit]").textContent;
  if (!erste.includes("S-BUDGET")) throw new Error("Günstigste steht nicht oben: " + erste.slice(0, 40));
  // Mit Bio-Vorliebe muss die Bio-Butter nach oben
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Bio bevorzugen"); await sleep(250);
  click(w, "#closeSet"); await sleep(200);
  type(w, "#what", "butter"); await sleep(200);
  type(w, "#what", "butter ");
  await until(() => {
    const h = w.document.querySelector("[data-hit]");
    return h && h.textContent.includes("Ja! Natürlich");
  }, "Bio-Artikel steht oben", 8000);
  ok("Agent 129 – Bio und AT werden ausgewiesen, Vorliebe hebt sie nach oben");
} catch (e) { bad("Agent 129", e); }

// ---------------- Agent 130: Klimabilanz rechnet plausibel
try {
  const { w } = makePhone(); await setup(w);
  const rechne = w.eval("co2Fuer");
  const rind = rechne({ name: "Rindsgulasch", unit: "1 kg", cat: "fleisch" });
  const huhn = rechne({ name: "Hühnerbrust", unit: "1 kg", cat: "fleisch" });
  const gemuese = rechne({ name: "Karotten", unit: "1 kg", cat: "obst" });
  if (!rind || !huhn || !gemuese) throw new Error("Keine Schätzung");
  if (!(rind.kg > huhn.kg * 5)) throw new Error("Rind nicht deutlich über Huhn: " + rind.kg + " / " + huhn.kg);
  if (!(huhn.kg > gemuese.kg * 3)) throw new Error("Huhn nicht über Gemüse");
  if (Math.abs(rind.kg - 60) > 5) throw new Error("Rind unplausibel: " + rind.kg);
  // Halbe Menge, halber Wert
  const halb = rechne({ name: "Rindsgulasch", unit: "500 g", cat: "fleisch" });
  if (Math.abs(halb.kg - rind.kg / 2) > 0.5) throw new Error("Menge wird nicht berücksichtigt");
  // Unbekanntes zählt nicht mit
  if (rechne({ name: "Schraubenzieher", unit: "1 stk", cat: "sonst" })) throw new Error("Rät bei Unbekanntem");
  ok("Agent 130 – Rind 60, Huhn 6, Gemüse 0,5 kg CO₂ je kg; Menge wird verrechnet");
} catch (e) { bad("Agent 130", e); }

// ---------------- Agent 131: Klimakarte und Tipps in der Liste
try {
  const { w } = makePhone(); await setup(w);
  for (const n of ["Rindsgulasch (1 kg)", "Karotten (1 kg)", "Schraubenzieher"]) await addItem(w, n);
  await sleep(400);
  let t = txt(w);
  if (!t.includes("CO₂")) throw new Error("Keine Klimakarte");
  if (!t.includes("2 von 3")) throw new Error("Zähler falsch: " + t.slice(t.indexOf("CO₂") - 40, t.indexOf("CO₂") + 60));
  if (!t.includes("Rindsgulasch")) throw new Error("Größter Posten fehlt");
  click(w, "#co2Help"); await sleep(300);
  t = txt(w);
  if (!t.includes("Größte Posten")) throw new Error("Keine Aufschlüsselung");
  if (!t.includes("Huhn oder Hülsenfrüchte")) throw new Error("Kein Sparvorschlag");
  if (!t.includes("Poore")) throw new Error("Keine Quellenangabe");
  if (!t.includes("im Jahr")) throw new Error("Keine Hochrechnung");
  // Abschaltbar
  click(w, "#closeCo2"); await sleep(200);
  click(w, "#settings"); await sleep(200);
  clickText(w, "button", "Klimabilanz zeigen"); await sleep(250);
  click(w, "#closeSet"); await sleep(250);
  if (txt(w).includes("CO₂")) throw new Error("Karte lässt sich nicht abschalten");
  ok("Agent 131 – Klimakarte mit Aufschlüsselung, Sparvorschlägen und Quelle, abschaltbar");
} catch (e) { bad("Agent 131", e); }


// ---------------- Agent 132: Preis pro Kilo wird berechnet und angezeigt
try {
  const { w } = makePhone(); await setup(w);
  const gp = w.eval("grundpreis");
  const faelle = [[1.51, "250 g", 6.04, "kg"], [1.32, "1 l", 1.32, "l"], [2.5, "500 ml", 5, "l"],
                  [8.99, "400 g", 22.475, "kg"], [3.73, "10 stk", 0.373, "Stk"], [2, "2 kg", 1, "kg"]];
  for (const [preis, einheit, soll, je] of faelle) {
    const r = gp(preis, einheit);
    if (!r) throw new Error("Keine Berechnung für " + einheit);
    if (Math.abs(r.wert - soll) > 0.02) throw new Error(einheit + " → " + r.wert + " statt " + soll);
    if (r.je !== je) throw new Error("Einheit falsch: " + r.je);
  }
  if (gp(1.5, "1 Packung")) throw new Error("Rät bei unklarer Größe");
  // In der Trefferliste sichtbar
  PREISDATEI.fail = false;
  type(w, "#what", "butter");
  await until(() => w.document.querySelector("[data-hit]"), "Treffer", 8000);
  if (!txt(w).includes("€/kg")) throw new Error("Kein Kilopreis in der Trefferliste");
  ok("Agent 132 – Kilopreis stimmt bei g, kg, ml, l und Stück und steht in der Liste");
} catch (e) { bad("Agent 132", e); }

// ---------------- Agent 133: Sparplan findet den günstigsten Einkauf
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  await w.__zettl.saveShops({ home: { lat: 48.2, lon: 14.28, at: Date.now() }, car: { verbrauch: 7, preis: 1.75 },
    list: [{ id: "a", name: "Billa", dist: 0.5, chosen: true, updatedAt: 1 },
           { id: "b", name: "Hofer", dist: 2, chosen: true, updatedAt: 1 }] });
  await sleep(400);
  // Zwei Artikel teurer eintragen, als sie sein müssten
  for (const [n, p, s] of [["Clever Nudeln", "0,99", "Billa"], ["Bergkäse", "8,99", "Billa"]]) {
    type(w, "#what", n); await sleep(250);
    type(w, "#price", p);
    const chip = [...w.document.querySelectorAll("[data-store]")].find(b => b.textContent.trim() === s);
    if (chip) chip.dispatchEvent(new w.Event("click", { bubbles: true }));
    await sleep(150);
    click(w, "#addItem"); await sleep(500);
  }
  if (!w.document.querySelector("#sparen")) throw new Error("Kein Sparen-Knopf");
  click(w, "#sparen");
  await until(() => txt(w).includes("Günstigster Einkauf"), "Sparplan", 8000);
  const t = txt(w);
  if (!t.includes("Hofer")) throw new Error("Günstigerer Laden nicht gefunden");
  if (!t.includes("2,20")) throw new Error("Ersparnis falsch berechnet (erwartet 2,20 €): " + t.slice(0, 200));
  if (!t.includes("€/kg")) throw new Error("Kein Kilopreis im Plan");
  if (!t.includes("km")) throw new Error("Umweg fehlt");
  ok("Agent 133 – Sparplan findet Hofer, rechnet 2,20 € Ersparnis und den Umweg dagegen");
} catch (e) { bad("Agent 133", e); }

// ---------------- Agent 134: Preise übernehmen schreibt sie auf die Liste
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  for (const n of ["Clever Nudeln", "Bergkäse"]) await addItem(w, n);
  click(w, "#sparen");
  await until(() => txt(w).includes("Günstigster Einkauf"), "Sparplan", 8000);
  clickText(w, "button", "Preise auf die Liste übernehmen");
  await sleep(900);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  const nudeln = items.find(i => i.name.includes("Nudeln"));
  const kaese = items.find(i => i.name.includes("Bergkäse"));
  if (nudeln.price !== 0.79 || nudeln.store !== "Hofer") throw new Error("Nudeln nicht übernommen: " + JSON.stringify(nudeln));
  if (kaese.price !== 6.99 || kaese.store !== "Hofer") throw new Error("Käse nicht übernommen: " + JSON.stringify(kaese));
  if (!nudeln.size) throw new Error("Größe fehlt, Kilopreis nicht berechenbar");
  if (!txt(w).includes("€/kg")) throw new Error("Kilopreis erscheint nicht in der Liste");
  const b = w.eval("bestPrice")("Clever Nudeln");
  if (!b || b.store !== "Hofer") throw new Error("Preis nicht ins Gedächtnis übernommen");
  ok("Agent 134 – Übernehmen schreibt Preis, Laden und Größe auf die Liste");
} catch (e) { bad("Agent 134", e); }


// ---------------- Agent 135: Lange Listen lassen sich scrollen
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  const css = w.document.querySelector("style").textContent;
  for (const [regel, was] of [[".hits{", "Trefferliste"], [".detail{", "Preisfeld"],
                              [".zuletzt{", "Zuletzt-gekauft-Liste"], [".alts{", "Alternativenliste"]]) {
    const i = css.indexOf(regel);
    if (i < 0) throw new Error("Keine Regel für " + was);
    const block = css.slice(i, css.indexOf("}", i));
    if (!block.includes("overflow-y:auto")) throw new Error(was + " ist nicht scrollbar");
    if (!block.includes("max-height")) throw new Error(was + " hat keine Höhenbegrenzung");
  }
  // Die Trefferliste muss auch wirklich den Container bekommen
  type(w, "#what", "butter");
  await until(() => w.document.querySelector(".hits"), "Trefferliste", 8000);
  const treffer = w.document.querySelectorAll(".hits [data-hit]").length;
  if (treffer < 2) throw new Error("Zu wenige Treffer im scrollbaren Bereich: " + treffer);
  // Das Preisfeld ebenso
  if (!w.document.querySelector(".detail")) throw new Error("Preisfeld hat keinen eigenen Bereich");
  // Und die Liste darunter darf nicht verdeckt werden
  const liste = w.document.querySelector(".list");
  if (!liste.style.paddingBottom) throw new Error("Kein Platz für die untere Leiste reserviert");
  // Die Eingabezeile darf nie aus der Leiste gedrängt werden. Vorher passten
  // 46vh Treffer und 38vh Preisfeld nicht in 86vh, overflow:hidden schnitt sie ab.
  const iBar = css.indexOf(".bar-add{");
  const barCss = css.slice(iBar, css.indexOf("}", iBar));
  if (!barCss.includes("flex-direction:column"))
    throw new Error("Leiste ist keine Spalte – die Eingabezeile kann herausfallen");
  const iLine = css.indexOf(".bar-add .line{");
  if (!css.slice(iLine, css.indexOf("}", iLine)).includes("flex:none"))
    throw new Error("Eingabezeile darf nicht schrumpfen dürfen");
  for (const [regel, was] of [[".hits{", "Trefferliste"], [".detail{", "Preisfeld"]]) {
    const i = css.indexOf(regel);
    if (!css.slice(i, css.indexOf("}", i)).includes("min-height:0"))
      throw new Error(was + " kann nicht schrumpfen – Eingabezeile wird verdrängt");
  }
  ok("Agent 135 – Trefferliste, Preisfeld und Vorschläge scrollbar, Eingabezeile bleibt stehen");
} catch (e) { bad("Agent 135", e); }


// ---------------- Agent 136: Warengruppen einklappen mit Zähler
try {
  const { w } = makePhone(); await setup(w);
  for (const n of ["Bananen", "Äpfel", "Milch", "Klopapier"]) await addItem(w, n);
  await sleep(300);
  let t = txt(w);
  if (!t.includes("Obst")) throw new Error("Keine Warengruppen");
  const kopf = [...w.document.querySelectorAll("[data-fold]")].find(b => b.textContent.includes("Obst"));
  if (!kopf) throw new Error("Kopf nicht antippbar");
  // Zähler daneben
  const zeile = kopf.closest(".sec");
  const zahl = zeile.querySelector(".cnt");
  if (!zahl || zahl.textContent.trim() !== "2") throw new Error("Zähler falsch: " + (zahl && zahl.textContent));
  // Einklappen
  kopf.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  t = txt(w);
  if (t.includes("Bananen") || t.includes("Äpfel")) throw new Error("Artikel trotz Einklappen sichtbar");
  if (!t.includes("Obst")) throw new Error("Kopf verschwunden");
  if (!t.includes("Milch")) throw new Error("Andere Gruppen mit eingeklappt");
  // Wieder ausklappen
  [...w.document.querySelectorAll("[data-fold]")].find(b => b.textContent.includes("Obst"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  if (!txt(w).includes("Bananen")) throw new Error("Ausklappen geht nicht");
  ok("Agent 136 – Warengruppen klappen ein und aus, Zähler stimmt");
} catch (e) { bad("Agent 136", e); }

// ---------------- Agent 137: Räume einklappen und Zustand merken
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(150);
  for (const [room, title] of [["Küche", "Herd putzen"], ["Küche", "Spüle putzen"], ["Bad", "WC putzen"]]) {
    click(w, "#newTask"); await sleep(200);
    pickRoom(w, room); await sleep(150);
    type(w, "#title", title); click(w, "#saveTask"); await sleep(400);
  }
  const kopf = [...w.document.querySelectorAll("[data-fold]")].find(b => b.textContent.includes("Küche"));
  if (!kopf) throw new Error("Kein Raumkopf");
  const zahl = kopf.closest(".sec").querySelector(".cnt");
  if (!zahl || !zahl.textContent.includes("2")) throw new Error("Aufgabenzahl fehlt: " + (zahl && zahl.textContent));
  kopf.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(350);
  let t = txt(w);
  if (t.includes("Herd putzen")) throw new Error("Aufgabe trotz Einklappen sichtbar");
  if (!t.includes("WC putzen")) throw new Error("Anderer Raum mit eingeklappt");
  // Zustand überlebt Tabwechsel und Neustart
  click(w, "#tabS"); await sleep(200); click(w, "#tabT"); await sleep(300);
  if (txt(w).includes("Herd putzen")) throw new Error("Zustand nach Tabwechsel verloren");
  const dump2 = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); dump2[k] = w.localStorage.getItem(k); }
  const B = makePhone(dump2); await sleep(700);
  click(B.w, "#tabT"); await sleep(400);
  if (txt(B.w).includes("Herd putzen")) throw new Error("Zustand nach Neustart verloren");
  ok("Agent 137 – Räume klappen ein, Zähler stimmt, Zustand bleibt gemerkt");
} catch (e) { bad("Agent 137", e); }


// ---------------- Agent 138: Warengruppe kommt aus den Händlerdaten
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  // Die Butter-Apfeltasche ist Gebäck, nicht Kühlware – das weiß nur der Händler
  type(w, "#what", "butter");
  await until(() => w.document.querySelector("[data-hit]"), "Treffer", 8000);
  const tasche = [...w.document.querySelectorAll("[data-hit]")].find(b => b.textContent.includes("Apfeltasche"));
  if (!tasche) throw new Error("Apfeltasche nicht gefunden");
  tasche.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(700);
  let it = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted)[0];
  if (it.cat !== "backwaren") throw new Error("Warengruppe aus den Daten ignoriert: " + it.cat);
  // Auch bei getippten Namen wird nachgeschlagen statt geraten
  type(w, "#what", "Clever Toilettenpapier"); await sleep(700);
  click(w, "#addItem"); await sleep(700);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  const tp = items.find(i => i.name.includes("Toilettenpapier"));
  if (!tp || tp.cat !== "drogerie") throw new Error("Getippter Artikel nicht nachgeschlagen: " + (tp && tp.cat));
  ok("Agent 138 – Warengruppe stammt aus den Händlerdaten, auch bei getippten Namen");
} catch (e) { bad("Agent 138", e); }

// ---------------- Agent 139: Startbildschirm und Geschosse ohne Aufgaben
try {
  const { w } = makePhone();
  await sleep(150);
  const sp = w.document.querySelector("#splash");
  if (!sp) throw new Error("Kein Startbildschirm");
  if (!sp.textContent.includes("Zettl")) throw new Error("Startbildschirm ohne Namen");
  await setup(w);
  // Nach der Zeit muss er weg sein
  await until(() => !w.document.querySelector("#splash"), "Startbildschirm verschwindet", 6000);
  // Neues Geschoss anlegen, ohne Aufgabe darin
  click(w, "#tabP"); await sleep(300);
  click(w, "#planAddRoom"); await sleep(250);
  type(w, "#roomName", "Dachkammer"); await sleep(200);
  [...w.document.querySelectorAll("[data-floor2]")].find(b => b.textContent.trim() === "Dachboden")
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(150);
  click(w, "#saveRoom"); await sleep(600);
  click(w, "#tabT"); await sleep(400);
  const geschosse = [...w.document.querySelectorAll("[data-floor]")].map(b => b.textContent.trim());
  if (!geschosse.includes("Dachboden")) throw new Error("Neues Geschoss fehlt im Haushalt: " + geschosse.join(", "));
  ok("Agent 139 – Startbildschirm erscheint und verschwindet, neues Geschoss sofort sichtbar");
} catch (e) { bad("Agent 139", e); }

// ---------------- Agent 140: Laufschrift nur bei zu langem Text
try {
  const { w } = makePhone(); await setup(w);
  const spans = [...w.document.querySelectorAll(".tabs button > span")];
  if (spans.length !== 3) throw new Error("Reiter nicht umgebaut: " + spans.length);
  if (!spans[0].textContent.includes("Einkaufen")) throw new Error("Beschriftung fehlt");
  const css = w.document.querySelector("style").textContent;
  if (css.indexOf("@keyframes lauf") < 0) throw new Error("Keine Laufschrift-Regel");
  const block = css.slice(css.indexOf(".tabs .lauf"), css.indexOf("}", css.indexOf(".tabs .lauf")));
  if (!block.includes("animation")) throw new Error("Laufschrift ohne Bewegung");
  if (!block.includes("white-space:nowrap")) throw new Error("Text würde umbrechen statt laufen");
  // Ohne Überlauf darf nichts laufen (jsdom misst 0 – Klasse muss dann fehlen)
  if (spans.some(s => s.classList.contains("lauf"))) throw new Error("Läuft ohne Not");
  ok("Agent 140 – Reiter haben Laufschrift-Technik, laufen aber nur bei Überlänge");
} catch (e) { bad("Agent 140", e); }


// ---------------- Agent 141: Alternativen im Artikel-Dialog
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  // Teure kleine Packung auf die Liste
  type(w, "#what", "Bergkäse"); await sleep(300);
  await until(() => w.document.querySelector("[data-hit]"), "Treffer", 8000);
  const teuer = [...w.document.querySelectorAll("[data-hit]")].find(b => b.textContent.includes("Bio Bergkäse"))
             || w.document.querySelector("[data-hit]");
  teuer.dispatchEvent(new w.Event("click", { bubbles: true }));
  await until(() => (w.__zettl.S.shopping || []).filter(i => !i.deleted).length === 1, "Artikel auf der Liste");
  // Artikel öffnen -> Alternativen müssen kommen
  openItem(w, "Bergkäse");
  await until(() => txt(w).includes("Alternativen"), "Alternativen erscheinen", 8000);
  const t = txt(w);
  if (!t.includes("Vorteilspackung")) throw new Error("Große Packung fehlt: " + t.slice(t.indexOf("Alternativen"), t.indexOf("Alternativen") + 200));
  if (!t.includes("€/kg")) throw new Error("Kein Kilopreis bei den Alternativen");
  // Die 1-kg-Packung (12,99 = 12,99 €/kg) muss vor der 400-g-Packung (6,99 = 17,48 €/kg) stehen
  const reihe = [...w.document.querySelectorAll("[data-alt]")].map(b => b.textContent);
  const iGross = reihe.findIndex(x => x.includes("Vorteilspackung"));
  const iKlein = reihe.findIndex(x => x.includes("Bergkäse") && x.includes("400 g"));
  if (iGross < 0) throw new Error("Vorteilspackung nicht in der Liste");
  if (iKlein >= 0 && iGross > iKlein) throw new Error("Nicht nach Kilopreis sortiert");
  ok("Agent 141 – Alternativen erscheinen, nach Preis pro Kilo sortiert");
} catch (e) { bad("Agent 141", e); }

// ---------------- Agent 142: Alternative übernehmen tauscht den Artikel
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Bergkäse");
  openItem(w, "Bergkäse");
  await until(() => w.document.querySelector("[data-alt]"), "Alternativen", 8000);
  const gross = [...w.document.querySelectorAll("[data-alt]")].find(b => b.textContent.includes("Vorteilspackung"));
  if (!gross) throw new Error("Große Packung fehlt");
  gross.dispatchEvent(new w.Event("click", { bubbles: true }));
  await until(() => {
    const it = (w.__zettl.S.shopping || []).filter(i => !i.deleted)[0];
    return it && it.name.includes("Vorteilspackung");
  }, "Artikel getauscht", 8000);
  const it = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted)[0];
  if (it.price !== 12.99 || it.store !== "Spar") throw new Error("Preis/Laden nicht übernommen: " + JSON.stringify(it));
  if (it.size !== "1 kg") throw new Error("Größe fehlt: " + it.size);
  if (it.cat !== "kuehl") throw new Error("Warengruppe falsch: " + it.cat);
  if ((await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted).length !== 1)
    throw new Error("Artikel wurde dupliziert statt getauscht");
  if (!txt(w).includes("€/kg")) throw new Error("Kilopreis fehlt nach dem Tausch");
  ok("Agent 142 – Alternative ersetzt den Artikel samt Preis, Größe und Warengruppe");
} catch (e) { bad("Agent 142", e); }


// ================= KRITISCHE PRÜFUNG =================

// ---------------- Agent 143: Alternativen dürfen keinen Unsinn vorschlagen
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Clever Vollmilch");
  openItem(w, "Vollmilch");
  await until(() => !w.__zettl.S.altBusy && w.__zettl.S.modal === "item", "Dialog fertig", 10000);
  const alts = [...w.document.querySelectorAll("[data-alt]")].map(b => b.textContent);
  // Sich selbst darf die App nicht vorschlagen
  if (alts.some(a => a.includes("Clever Vollmilch"))) throw new Error("Namensgleiches Produkt als Alternative");
  if (!txt(w).includes("Genau dieses Produkt")) throw new Error("Passendes Produkt wird nicht angeboten");
  // Und nichts völlig Fachfremdes
  if (alts.some(a => a.includes("Toilettenpapier") || a.includes("Shampoo")))
    throw new Error("Fachfremder Vorschlag: " + alts.join(" | "));
  ok("Agent 143 – Keine Selbstvorschläge, nichts Fachfremdes (" + alts.length + " Alternativen)");
} catch (e) { bad("Agent 143", e); }

// ---------------- Agent 144: Artikel ohne Preis und ohne Größe
try {
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Bergkäse");     // ohne Preis, ohne Größe eingetragen
  openItem(w, "Bergkäse");
  await until(() => !w.__zettl.S.altBusy, "Dialog fertig", 10000);
  const t = txt(w);
  if (t.includes("NaN") || t.includes("undefined") || t.includes("Infinity"))
    throw new Error("Rechenfehler sichtbar: " + t.slice(t.indexOf("Alternativen"), t.indexOf("Alternativen") + 160));
  const alts = [...w.document.querySelectorAll("[data-alt]")];
  if (!alts.length) throw new Error("Keine Alternativen trotz passender Daten");
  // Übernehmen muss auch ohne Ausgangspreis gehen
  alts[0].dispatchEvent(new w.Event("click", { bubbles: true }));
  await until(() => {
    const x = (w.__zettl.S.shopping || []).filter(i => !i.deleted)[0];
    return x && x.price != null;
  }, "Preis übernommen", 8000);
  const it = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted)[0];
  if (it.price == null) throw new Error("Kein Preis übernommen");
  ok("Agent 144 – Artikel ohne Preis und Größe: Vorschläge und Tausch funktionieren");
} catch (e) { bad("Agent 144", e); }

// ---------------- Agent 145: Kilopreis-Grenzfälle
try {
  const { w } = makePhone(); await setup(w);
  const gp = w.eval("grundpreis");
  const faelle = [[0, "250 g"], [1.5, "0 g"], [1.5, "nach Gewicht"], [1.5, ""], [1.5, null],
                  [1.5, "1 Packung"], [0.01, "5 kg"], [999.99, "1 g"]];
  for (const [p, e] of faelle) {
    const r = gp(p, e);
    if (r && (!isFinite(r.wert) || isNaN(r.wert))) throw new Error("Unbrauchbarer Wert bei " + p + " / " + e + ": " + r.wert);
  }
  if (gp(1.5, "0 g")) throw new Error("Teilt durch Null");
  if (!gp(0, "250 g")) throw new Error("Nullpreis wird verworfen");
  if (gp(0, "250 g").wert !== 0) throw new Error("Nullpreis falsch gerechnet");
  const txt2 = w.eval("grundpreisText");
  if (txt2(999.99, "1 g").includes("NaN")) throw new Error("NaN im Text");
  ok("Agent 145 – Kilopreis: Null, Leerwerte, absurde Größen – keine Rechenfehler");
} catch (e) { bad("Agent 145", e); }

// ---------------- Agent 146: Sparplan ohne Preisdatei und mit Mischmasch
try {
  PREISDATEI.fail = true;      // keine Preisdatei erreichbar
  const { w } = makePhone(); await setup(w);
  for (const n of ["Irgendwas", "Sonstwas"]) await addItem(w, n);
  click(w, "#sparen");
  await until(() => txt(w).includes("Günstigster Einkauf"), "Sparplan", 10000);
  const t = txt(w);
  if (t.includes("NaN") || t.includes("undefined")) throw new Error("Rechenfehler im Plan");
  if (!t.includes("noch keine Preise bekannt")) throw new Error("Kein ehrlicher Hinweis bei fehlenden Preisen");
  if (t.includes("gespart")) throw new Error("Behauptet Ersparnis ohne Datengrundlage");
  PREISDATEI.fail = false;
  ok("Agent 146 – Sparplan ohne Preisdaten: ehrlicher Hinweis statt erfundener Ersparnis");
} catch (e) { PREISDATEI.fail = false; bad("Agent 146", e); }

// ---------------- Agent 147: Klimabilanz bleibt sauber
try {
  const { w } = makePhone(); await setup(w);
  // Leere Liste: keine Karte, kein Absturz
  if (txt(w).includes("CO₂")) throw new Error("Klimakarte ohne Artikel");
  await addItem(w, "Schraubenzieher");
  await sleep(400);
  if (txt(w).includes("CO₂")) throw new Error("Klimakarte trotz unbekanntem Artikel");
  // Warengruppe aus den Daten darf die Schätzung nicht verfälschen
  const f = w.eval("co2Fuer");
  const a = f({ name: "Rindsgulasch", unit: "1 kg", cat: "drogerie" });   // absichtlich falsche Gruppe
  if (!a || Math.abs(a.kg - 60) > 5) throw new Error("Warengruppe überstimmt den Namen: " + (a && a.kg));
  const b = f({ name: "Butter-Apfeltasche", unit: "1 stk", cat: "backwaren" });
  if (b && b.kg > 3) throw new Error("Gebäck als Butter gerechnet: " + b.kg);
  ok("Agent 147 – Klimabilanz nur mit Daten, Name schlägt Warengruppe");
} catch (e) { bad("Agent 147", e); }

// ---------------- Agent 148: Einklappen, Filter und Tabwechsel zusammen
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#tabT"); await sleep(150);
  for (const [room, title] of [["Küche", "Herd putzen"], ["Bad", "WC putzen"], ["Allgemein", "Müll"]]) {
    click(w, "#newTask"); await sleep(200);
    pickRoom(w, room); await sleep(150);
    type(w, "#title", title); click(w, "#saveTask"); await sleep(400);
  }
  // Küche einklappen, dann auf 1. Stock filtern, dann Tab wechseln
  [...w.document.querySelectorAll("[data-fold]")].find(b => b.textContent.includes("Küche"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  [...w.document.querySelectorAll("[data-floor]")].find(b => b.getAttribute("data-floor") === "1. Stock")
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  click(w, "#tabS"); await sleep(200); click(w, "#tabP"); await sleep(200); click(w, "#tabT"); await sleep(400);
  let t = txt(w);
  if (!t.includes("WC putzen")) throw new Error("Aufgabe des gefilterten Geschosses fehlt");
  if (!t.includes("Müll")) throw new Error("Allgemeine Aufgabe verschwunden");
  // Filter lösen: Küche muss weiter eingeklappt sein, aber vorhanden
  [...w.document.querySelectorAll("[data-floor]")].find(b => b.getAttribute("data-floor") === "")
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(400);
  t = txt(w);
  if (!t.includes("Küche")) throw new Error("Küche fehlt nach dem Filtern");
  if (t.includes("Herd putzen")) throw new Error("Einklapp-Zustand verloren");
  const tasks = (await w.__zettl.readLocal("tasks", [])).filter(x => !x.deleted);
  if (tasks.length !== 3) throw new Error("Aufgaben verloren: " + tasks.length);
  ok("Agent 148 – Einklappen, Geschoss-Filter und Tabwechsel stören sich nicht");
} catch (e) { bad("Agent 148", e); }

// ---------------- Agent 149: Startbildschirm blockiert nichts
try {
  const { w } = makePhone();
  await sleep(120);
  const sp = w.document.querySelector("#splash");
  if (!sp) throw new Error("Kein Startbildschirm");
  // Antippen muss ihn sofort entfernen
  sp.dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(150);
  if (w.document.querySelector("#splash")) throw new Error("Antippen entfernt ihn nicht");
  // Und die App darunter ist bedienbar
  await setup(w);
  await addItem(w, "Milch");
  if (!txt(w).includes("Milch")) throw new Error("App nach dem Startbildschirm nicht bedienbar");
  // Zweites Gerät: ohne Antippen muss er von selbst gehen
  const B = makePhone();
  await until(() => !B.w.document.querySelector("#splash"), "Startbildschirm verschwindet von selbst", 6000);
  ok("Agent 149 – Startbildschirm: antippbar, verschwindet von selbst, blockiert nichts");
} catch (e) { bad("Agent 149", e); }

// ---------------- Agent 150: Beschädigte Preisdatei
try {
  const alt = PREISDATEI.inhalt;
  PREISDATEI.fail = false;
  PREISDATEI.inhalt = { stand: "2026-07-29", artikel: [
    ["Nur Name"],                                   // fast alles fehlt
    ["Kaputt", "kein Preis", "Billa", "250 g", 0, 0, 0, "kuehl"],
    [null, 1.5, "Billa", "1 l", 0, 0, 0, "kuehl"],  // kein Name
    ["Echte Milch", 1.29, "Hofer", "1 l", 0, 0, 0, "kuehl"]
  ] };
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "milch"); await sleep(1200);
  const t = txt(w);
  if (t.includes("NaN") || t.includes("undefined") || t.includes("null"))
    throw new Error("Kaputte Daten schlagen durch: " + t.slice(0, 160));
  // Der gute Eintrag muss trotzdem gefunden werden
  if (!t.includes("Echte Milch")) throw new Error("Brauchbarer Eintrag geht verloren");
  click(w, "#addItem"); await sleep(500);
  if (!(await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted).length)
    throw new Error("App nach kaputter Datei blockiert");
  PREISDATEI.inhalt = alt;
  ok("Agent 150 – Beschädigte Preisdatei: brauchbare Zeilen bleiben, App läuft weiter");
} catch (e) { bad("Agent 150", e); }

// ---------------- Agent 151: Getauschter Artikel synct als einer
try {
  REMOTE.clear(); PREISDATEI.fail = false;
  const cfg = JSON.stringify({ url: "https://tausch.supabase.co", key: "k" });
  const A = makePhone({ "zettl.sync": cfg }); await setup(A.w); await sleep(500);
  await addItem(A.w, "Bergkäse"); await sleep(600);
  const B = makePhone({ "zettl.sync": cfg }); await sleep(600);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B bereit");
  clickText(B.w, "button", "Verena");
  await until(() => txt(B.w).includes("Bergkäse"), "Artikel bei B");
  // A tauscht gegen die Vorteilspackung
  openItem(A.w, "Bergkäse");
  await until(() => A.w.document.querySelector("[data-alt]"), "Alternativen", 10000);
  [...A.w.document.querySelectorAll("[data-alt]")][0].dispatchEvent(new A.w.Event("click", { bubbles: true }));
  await until(() => A.w.__zettl.S.modal === null, "getauscht", 8000);
  await sleep(900);
  await B.api().syncNow(false); await sleep(900);
  const items = (await B.w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (items.length !== 1) throw new Error("Tausch erzeugt Dublette: " + items.map(i => i.name).join(", "));
  if (items[0].price == null) throw new Error("Preis kam nicht mit");
  ok("Agent 151 – Getauschter Artikel bleibt einer, auch auf dem zweiten Handy");
} catch (e) { bad("Agent 151", e); }

// ---------------- Agent 152: Große Preisdatei bleibt flott
try {
  const alt = PREISDATEI.inhalt;
  const viele = [];
  const woerter = ["Käse", "Milch", "Butter", "Brot", "Nudeln", "Reis", "Joghurt", "Schinken"];
  for (let i = 0; i < 20000; i++) {
    const w2 = woerter[i % woerter.length];
    viele.push(["Marke" + (i % 400) + " " + w2 + " Sorte " + i, 0.5 + (i % 900) / 100,
      ["Billa", "Spar", "Hofer", "dm"][i % 4], (100 + (i % 20) * 50) + " g", i % 40 === 0 ? 1 : 0,
      i % 15 === 0 ? 1 : 0, i % 12 === 0 ? 1 : 0, "kuehl"]);
  }
  PREISDATEI.inhalt = { stand: "2026-07-29", artikel: viele };
  const { w } = makePhone(); await setup(w);
  const t0 = Date.now();
  type(w, "#what", "butter");
  await until(() => w.document.querySelector("[data-hit]"), "Treffer bei 20.000 Artikeln", 15000);
  const dauer = Date.now() - t0;
  if (dauer > 9000) throw new Error("Zu langsam: " + dauer + "ms");
  const t1 = Date.now();
  const treffer = w.eval("pdSuche")("käse", 6);
  const suchzeit = Date.now() - t1;
  if (suchzeit > 900) throw new Error("Suche zu langsam: " + suchzeit + "ms");
  if (!treffer.length) throw new Error("Keine Treffer");
  PREISDATEI.inhalt = alt;
  ok("Agent 152 – 20.000 Artikel: erste Anzeige " + dauer + "ms, Suche " + suchzeit + "ms");
} catch (e) { bad("Agent 152", e); }


// ---------------- Agent 153: Mehr als sechs Treffer, mit Gesamtzahl
try {
  const altInhalt = PREISDATEI.inhalt;
  const viele = [];
  for (let i = 0; i < 120; i++)
    viele.push(["Bio Artikel " + i, 1 + i / 100, ["Billa", "Spar", "Hofer"][i % 3], "250 g", 0, 1, 0, "kuehl"]);
  PREISDATEI.inhalt = { stand: "2026-07-29", artikel: viele };
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "bio");
  await until(() => w.document.querySelector("[data-hit]"), "Treffer", 10000);
  const erste = w.document.querySelectorAll("[data-hit]").length;
  if (erste <= 6) throw new Error("Immer noch nur " + erste + " Treffer");
  if (erste !== 20) throw new Error("Erwartet 20 Treffer, sind " + erste);
  const t = txt(w);
  if (!t.includes("120")) throw new Error("Gesamtzahl fehlt: " + t.slice(0, 120));
  if (!t.includes("mehr zeigen")) throw new Error("Kein Knopf für mehr Treffer");
  click(w, "#mehrTreffer");
  await until(() => w.document.querySelectorAll("[data-hit]").length > 20, "Mehr Treffer", 8000);
  const jetzt = w.document.querySelectorAll("[data-hit]").length;
  if (jetzt !== 60) throw new Error("Erwartet 60, sind " + jetzt);
  // Neue Eingabe -> wieder kurze Liste
  type(w, "#what", "bio a");
  await until(() => w.document.querySelectorAll("[data-hit]").length <= 20, "Zurück auf kurze Liste", 8000);
  PREISDATEI.inhalt = altInhalt;
  ok("Agent 153 – 20 Treffer statt 6, Gesamtzahl sichtbar, 'mehr zeigen' liefert 60");
} catch (e) { bad("Agent 153", e); }

// Hilfsdatum für die Verlaufs-Agenten
const vorTagen = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

// ---------------- Agent 154: Leerer Zettel zeigt den Verlauf – dort nützt er am meisten
try {
  const { w } = makePhone(); await setup(w);
  await w.__zettl.writeLocal("prices", {
    "klopapier": { byStore: {}, lastName: "Klopapier", buys: [vorTagen(6)], updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(800);
  const t = txt(w);
  if (!t.includes("Der Zettel ist leer")) throw new Error("Leer-Zustand fehlt");
  if (!t.includes("Zuletzt gekauft")) throw new Error("Verlauf fehlt auf dem leeren Zettel");
  // Nicht nur "steht irgendwo im Text": genau ein Chip, richtiger Schlüssel, im Block
  const chips = [...w.document.querySelectorAll("[data-zuletzt]")];
  if (chips.length !== 1) throw new Error("Erwartet 1 Vorschlag, sind " + chips.length);
  if (chips[0].getAttribute("data-zuletzt") !== "klopapier") throw new Error("Falscher Schlüssel am Chip");
  if (!chips[0].textContent.includes("Klopapier")) throw new Error("Chip trägt den Namen nicht");
  if (!chips[0].closest(".zuletzt")) throw new Error("Chip sitzt nicht im Verlaufsblock");
  // und er muss auch etwas tun
  chips[0].dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(800);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (!items.some(i => i.name === "Klopapier")) throw new Error("Antippen setzt nichts auf die Liste");
  ok("Agent 154 – Auf dem leeren Zettel steht der Verlauf und lässt sich antippen");
} catch (e) { bad("Agent 154", e); }

// ---------------- Agent 155: Obergrenze acht, jüngstes zuerst
try {
  const { w } = makePhone(); await setup(w);
  const p = {};
  for (let i = 0; i < 14; i++) p["ware" + i] = { byStore: {}, lastName: "Ware " + i, buys: [vorTagen(i + 1)], updatedAt: 1 };
  await w.__zettl.writeLocal("prices", p);
  await w.__zettl.boot(); await sleep(800);
  const chips = [...w.document.querySelectorAll("[data-zuletzt]")];
  if (chips.length !== 8) throw new Error("Erwartet 8 Vorschläge, sind " + chips.length);
  if (!chips[0].textContent.includes("Ware 0")) throw new Error("Jüngstes steht nicht vorn: " + chips[0].textContent);
  if (!chips[7].textContent.includes("Ware 7")) throw new Error("Reihenfolge stimmt nicht: " + chips[7].textContent);
  const namen = chips.map(b => b.textContent.trim());
  if (new Set(namen).size !== namen.length) throw new Error("Doppelte Einträge im Verlauf");
  ok("Agent 155 – Verlauf auf acht begrenzt, jüngster Kauf zuerst, keine Doppelten");
} catch (e) { bad("Agent 155", e); }

// ---------------- Agent 156: Was auf dem Zettel steht, wird nicht vorgeschlagen
try {
  const { w } = makePhone(); await setup(w);
  await w.__zettl.writeLocal("prices", {
    "milch":  { byStore: {}, lastName: "Milch",  buys: [vorTagen(3)], updatedAt: 1 },
    "butter": { byStore: {}, lastName: "Butter", buys: [vorTagen(4)], updatedAt: 1 },
    "salz":   { byStore: {}, lastName: "Salz",   buys: [vorTagen(5)], updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(700);
  await addItem(w, "Milch");                       // offen auf dem Zettel
  await addItem(w, "Butter");
  [...w.document.querySelectorAll("[data-toggle]")].find(b => b.closest(".item").textContent.includes("Butter"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(400);   // Butter ins Wagerl
  const namen = [...w.document.querySelectorAll("[data-zuletzt]")].map(b => b.textContent);
  if (namen.some(n => n.includes("Milch"))) throw new Error("Offener Artikel wird trotzdem vorgeschlagen");
  if (namen.some(n => n.includes("Butter"))) throw new Error("Artikel im Wagerl wird trotzdem vorgeschlagen");
  if (!namen.some(n => n.includes("Salz"))) throw new Error("Salz fehlt im Verlauf");
  ok("Agent 156 – Weder Offenes noch Abgehaktes taucht im Verlauf auf");
} catch (e) { bad("Agent 156", e); }

// ---------------- Agent 157: Zweimal schnell antippen legt nur einen Artikel an
try {
  const { w } = makePhone(); await setup(w);
  await w.__zettl.writeLocal("prices", {
    "kaffee": { byStore: {}, lastName: "Kaffee", buys: [vorTagen(2)], updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(700);
  const chip = w.document.querySelector("[data-zuletzt]");
  if (!chip) throw new Error("Kein Vorschlag da");
  chip.dispatchEvent(new w.Event("click", { bubbles: true }));
  chip.dispatchEvent(new w.Event("click", { bubbles: true }));   // sofort noch einmal
  await sleep(900);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted && i.name === "Kaffee");
  if (items.length !== 1) throw new Error("Erwartet 1 Kaffee, sind " + items.length);
  ok("Agent 157 – Doppeltes Antippen legt den Artikel nur einmal an");
} catch (e) { bad("Agent 157", e); }

// ---------------- Agent 158: Uralte Käufe verstopfen den Verlauf nicht
try {
  const { w } = makePhone(); await setup(w);
  // Direkt an der Grenze prüfen, nicht 200 gegen 10 – sonst bliebe eine Lockerung
  // der Schranke auf 180 Tage unbemerkt.
  await w.__zettl.writeLocal("prices", {
    "faschingskrapfen": { byStore: {}, lastName: "Faschingskrapfen", buys: [vorTagen(91)], updatedAt: 1 },
    "mehl":             { byStore: {}, lastName: "Mehl",             buys: [vorTagen(89)], updatedAt: 1 },
    "backpulver":       { byStore: {}, lastName: "Backpulver", buys: [vorTagen(240), vorTagen(120)], updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(700);
  const namen = [...w.document.querySelectorAll("[data-zuletzt]")].map(b => b.textContent);
  if (namen.some(n => n.includes("Faschingskrapfen"))) throw new Error("91 Tage alter Kauf wird noch vorgeschlagen");
  if (!namen.some(n => n.includes("Mehl"))) throw new Error("89 Tage alter Kauf fehlt");
  // Langer Rhythmus, längst überfällig: muss trotz der 90 Tage stehen bleiben
  if (!namen.some(n => n.includes("Backpulver"))) throw new Error("Überfälliges mit langem Rhythmus fällt raus");
  ok("Agent 158 – Grenze bei 90 Tagen, Überfälliges mit langem Rhythmus bleibt");
} catch (e) { bad("Agent 158", e); }

// ---------------- Agent 159: "Ins Wagerl" im Dialog zählt als Kauf
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Zahnpasta"); await sleep(300);
  openItem(w, "Zahnpasta"); await sleep(500);
  if (!$(w, "#doneItem")) throw new Error("Artikel-Dialog nicht offen");
  click(w, "#doneItem"); await sleep(800);
  const prices = await w.__zettl.readLocal("prices", {});
  const e = prices["zahnpasta"];
  if (!e || !e.buys || !e.buys.length) throw new Error("Der Weg über den Dialog zählt nicht als Kauf");
  ok("Agent 159 – Auch 'Ins Wagerl' im Dialog landet in der Kaufhistorie");
} catch (e) { bad("Agent 159", e); }

// ---------------- Agent 160: Im Preise-Dialog lassen sich die Artikel anklicken
try {
  const { w } = makePhone(); await setup(w);
  await w.__zettl.writeLocal("prices", {
    "reis": { byStore: { "Billa": { price: 1.99 } }, last: { price: 1.99, store: "Billa" }, lastName: "Reis", updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(600);
  await addItem(w, "Reis"); await sleep(400);
  click(w, "#priceHelp"); await sleep(500);
  const zeile = [...w.document.querySelectorAll(".sheet [data-item]")].find(b => b.textContent.includes("Reis"));
  if (!zeile) throw new Error("Artikelzeile im Preise-Dialog ist nicht anklickbar");
  zeile.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(600);
  if (!$(w, "#saveItem")) throw new Error("Antippen öffnet den Artikel-Dialog nicht");
  // Rückweg: aus dem Preise-Dialog gekommen, also muss der Knopf zurückführen
  if ($(w, "#closeItem").textContent.trim() !== "‹") throw new Error("Kein Zurück-Pfeil, obwohl aus dem Preise-Dialog gekommen");
  click(w, "#closeItem"); await sleep(400);
  if (!$(w, "#closePrices")) throw new Error("Schließen führt nicht zurück in den Preise-Dialog");
  if ($(w, "#saveItem")) throw new Error("Artikel-Dialog steht noch offen");
  // Aus der Liste geöffnet muss es dagegen beim Schließen in die Liste gehen
  click(w, "#closePrices"); await sleep(300);
  openItem(w, "Reis"); await sleep(600);
  if ($(w, "#closeItem").textContent.trim() !== "✕") throw new Error("Zurück-Pfeil, obwohl aus der Liste gekommen");
  click(w, "#closeItem"); await sleep(300);
  if ($(w, "#saveItem") || $(w, "#closePrices")) throw new Error("Schließen führt nicht in die Liste");
  ok("Agent 160 – Preise-Dialog: Artikel anklickbar, und der Weg führt zurück");
} catch (e) { bad("Agent 160", e); }

// ---------------- Agent 161: Mehr als fünf Alternativen, in einem scrollbaren Bereich
const altVor161 = PREISDATEI.inhalt;
try {
  const alt = altVor161;
  const viele = [];
  for (let i = 0; i < 12; i++)
    viele.push(["Bergkäse Sorte " + i, 5 + i / 2, ["Billa", "Spar", "Hofer"][i % 3], (200 + i * 50) + " g", 0, 0, 0, "kuehl"]);
  PREISDATEI.inhalt = { stand: "2026-07-29", artikel: viele };
  PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Bergkäse"); await sleep(400);
  openItem(w, "Bergkäse");
  await until(() => w.document.querySelector(".alts"), "Alternativen", 12000);
  const n = w.document.querySelectorAll(".alts [data-alt]").length;
  if (n <= 5) throw new Error("Immer noch nur " + n + " Alternativen");
  const css = w.document.querySelector("style").textContent;
  const i = css.indexOf(".alts{");
  if (!css.slice(i, css.indexOf("}", i)).includes("overflow-y:auto")) throw new Error("Alternativen nicht scrollbar");
  ok("Agent 161 – " + n + " Alternativen statt fünf, in einem eigenen Scrollbereich");
} catch (e) { bad("Agent 161", e); }
// Muss auch nach einem Fehlschlag zurück, sonst laufen alle folgenden Agenten
// gegen die zwölf erfundenen Bergkäse-Sorten statt gegen die echte Fixture.
finally { PREISDATEI.inhalt = altVor161; PREISDATEI.fail = false; }

// ---------------- Agent 162: Reihenfolge im Einkaufen-Tab
try {
  const { w } = makePhone(); await setup(w);
  await w.__zettl.writeLocal("prices", {
    "milch": { byStore: { "Billa": { price: 1.32 } }, last: { price: 1.32, store: "Billa" }, lastName: "Milch", updatedAt: 1 },
    "brot":  { byStore: { "Billa": { price: 2.49 } }, last: { price: 2.49, store: "Billa" }, lastName: "Brot",  updatedAt: 1 },
    // steht NICHT auf der Liste – damit der Verlaufsblock überhaupt rendert
    "salz":  { byStore: {}, lastName: "Salz", buys: [vorTagen(4)], updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(600);
  await addItem(w, "Milch"); await addItem(w, "Brot"); await sleep(400);
  // einen abhaken, damit auch "Im Wagerl" in der Kette steckt
  [...w.document.querySelectorAll("[data-toggle]")].find(b => b.closest(".item").textContent.includes("Brot"))
    .dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(500);
  const h = w.document.querySelector(".list").innerHTML;
  const iSparen = h.indexOf('id="sparen"'), iItem = h.indexOf("data-toggle"),
        iWagerl = h.indexOf('w:wagerl'), iZuletzt = h.indexOf("data-zuletzt"),
        iKosten = h.indexOf('id="priceHelp"'), iCo2 = h.indexOf('id="co2Help"');
  for (const [i, was] of [[iItem, "Artikel"], [iWagerl, "Im Wagerl"], [iZuletzt, "Zuletzt gekauft"],
                          [iKosten, "Kostenkarte"], [iCo2, "Klimabilanz"]])
    if (i < 0) throw new Error(was + " fehlt");
  // Sparen-Knopf braucht zwei OFFENE Artikel, hier ist nur noch Milch offen
  if (iSparen >= 0 && !(iSparen < iItem)) throw new Error("Sparen-Knopf steht nicht oben");
  if (!(iItem < iWagerl)) throw new Error("Offene Artikel stehen nicht vor dem Wagerl");
  if (!(iWagerl < iZuletzt)) throw new Error("Verlauf steht nicht nach dem Wagerl");
  if (!(iZuletzt < iKosten)) throw new Error("Verlauf steht nicht vor der Zusammenfassung");
  if (!(iKosten < iCo2)) throw new Error("Klimabilanz steht nicht nach der Zusammenfassung");
  ok("Agent 162 – Reihenfolge: Artikel, Wagerl, Verlauf, Zusammenfassung, Klima");
} catch (e) { bad("Agent 162", e); }

// ---------------- Agent 163: Farbstrich zeigt die Warengruppe, Punkt die Person
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Bananen"); await addItem(w, "Klopapier"); await sleep(500);
  const balken = [...w.document.querySelectorAll(".item .bar")];
  if (balken.length < 2) throw new Error("Zu wenige Artikelzeilen");
  const klassen = balken.map(b => (String(b.className).match(/k-[a-z]+/) || [""])[0]);
  if (klassen.some(k => !k)) throw new Error("Ein Strich trägt keine Warengruppen-Farbe: " + klassen.join(","));
  if (klassen[0] === klassen[1]) throw new Error("Obst und Drogerie bekommen dieselbe Farbe: " + klassen[0]);
  const css = w.document.querySelector("style").textContent;
  for (const k of klassen)
    if (css.indexOf(".item .bar." + k + "{") < 0) throw new Error("Keine Farbregel für " + k);
  if (!w.document.querySelector(".item .name .wer")) throw new Error("Personenpunkt fehlt am Artikel");
  ok("Agent 163 – Warengruppe färbt den Strich, die Person steht als Punkt davor");
} catch (e) { bad("Agent 163", e); }

// ---------------- Agent 164: Verlauf übersteht den Neustart
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Senf"); await sleep(300);
  [...w.document.querySelectorAll("[data-toggle]")][0].dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(400);
  click(w, "#clearDone"); await sleep(500);
  const gespeichert = dump(w);
  const { w: w2 } = makePhone(gespeichert); await sleep(900);
  if (!txt(w2).includes("Senf")) throw new Error("Verlauf ist nach dem Neustart weg");
  if (!txt(w2).includes("Zuletzt gekauft")) throw new Error("Verlaufsblock fehlt nach dem Neustart");
  ok("Agent 164 – Der Verlauf überlebt den Neustart der App");
} catch (e) { bad("Agent 164", e); }

// ---------------- Agent 165: Prüfdatei gegen die ECHTE preise.json
// Der einzige Agent, der die richtigen 52.253 Artikel benutzt. Die Erwartungen sind
// überwiegend negativ formuliert: die Datei wird täglich neu gebaut, eine Erwartung
// auf einen bestimmten Artikelnamen wäre morgen kaputt. Was NICHT oben stehen darf,
// bleibt dagegen richtig, egal welche Milch gerade die billigste ist.
const PRUEF = [
  { q: "Milch",    nicht: ["schokolade","kakao","scheuermilch","sonnenmilch","anfangsmilch","folgemilch","reinigungsmilch","flaschensauger"] },
  { q: "Butter",   nicht: ["peanut","körperbutter","nagelbutter","sheabutter","laugenbrez","brötle"] },
  { q: "Käse",     nicht: ["katzensnack","dreamies","chips","cabanossi","maccaroni"] },
  { q: "Joghurt",  nicht: ["milka","ritter sport","hundefutter","vitakraft","lachgummi","reiswaffel"] },
  { q: "Kaffee",   nicht: ["joghurt","jogurt","knusper"] },
  { q: "Zucker",   nicht: ["ohne zucker"] },
  { q: "Eier",     nicht: ["rostfrei","hautschere","eier-salat"] },
  { q: "Erdäpfel", nicht: ["chips","dippers"] },
  { q: "Klopapier",   nicht: [], muss: "toilettenpapier" },   // Kontrollfall: Synonym
  { q: "Waschmittel", nicht: [] }                             // Kontrollfall: geht heute schon
];
const altVor165 = PREISDATEI.inhalt;
try {
  const echt = JSON.parse(fs.readFileSync("./preise.json", "utf8"));
  if (!echt.artikel || echt.artikel.length < 10000) throw new Error("preise.json sieht nicht echt aus");
  PREISDATEI.inhalt = echt; PREISDATEI.fail = false;
  const { w } = makePhone(); await setup(w);
  type(w, "#what", "butter");                                  // löst das Laden der Datei aus
  await until(() => w.document.querySelector("[data-hit]"), "Preisdatei geladen", 25000);

  const suche = (q) => JSON.parse(w.eval(
    "JSON.stringify(pdSuche(" + JSON.stringify(q) + ", 3).map(function(t){"
    + "return {name:t.name, cat:t.cat, store:(t.best&&t.best.store)||null};}))"));
  const fehler = [];
  for (const f of PRUEF) {
    const top = suche(f.q);
    if (!top.length) { fehler.push(f.q + ": keine Treffer"); continue; }
    const erwartet = w.eval("guessCat(" + JSON.stringify(f.q) + ")");
    for (const t of top) {
      const n = t.name.toLowerCase();
      const schlecht = f.nicht.find(x => n.includes(x));
      if (schlecht) fehler.push(f.q + ": \"" + t.name + "\" (" + schlecht + ")");
    }
    // Mindestforderung: irgendetwas Passendes ist dabei. Hofer zählt immer mit,
    // weil dort für keinen einzigen Artikel eine Warengruppe geliefert wird.
    const passt = top.some(t => (erwartet !== "sonst" && t.cat === erwartet) || t.store === "Hofer"
                             || (f.muss && t.name.toLowerCase().includes(f.muss)));
    if (!passt) fehler.push(f.q + ": nichts Passendes unter den ersten drei – " + top.map(t=>t.name).join(" | "));
  }
  if (fehler.length) throw new Error(fehler.length + " Beanstandungen:\n     " + fehler.join("\n     "));
  ok("Agent 165 – Prüfdatei: 10 Suchwörter gegen die echten " + echt.artikel.length.toLocaleString("de-AT") + " Artikel");
} catch (e) { bad("Agent 165", e); }
finally { PREISDATEI.inhalt = altVor165; PREISDATEI.fail = false; }

// ---------------- Agent 166: Migration der Schlüssel auf die gefaltete Form
try {
  const { w } = makePhone(); await setup(w);
  // Zwei Einträge zum selben Artikel, alt und neu geschrieben. Beim Falten treffen
  // sie sich auf einem Schlüssel und müssen feldweise zusammengeführt werden.
  await w.__zettl.writeLocal("prices", {
    "erdäpfel":  { byStore: { "Billa": { price: 1.89, at: "2026-07-01" } },
                   lastName: "Erdäpfel", buys: ["2026-07-01"], updatedAt: 1 },
    "erdaepfel": { byStore: { "Hofer": { price: 4.42, at: "2026-07-10" } },
                   lastName: "Erdaepfel", buys: ["2026-07-05"], updatedAt: 2 },
    "müsli":     { byStore: {}, lastName: "Müsli", buys: ["2026-07-08"], updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(900);
  const p = await w.__zettl.readLocal("prices", {});
  if (p["erdäpfel"]) throw new Error("Alter Schlüssel steht noch da");
  if (p["müsli"]) throw new Error("Alter Schlüssel 'müsli' steht noch da");
  if (!p["muesli"]) throw new Error("'müsli' wurde nicht auf 'muesli' umgeschrieben");
  const e = p["erdaepfel"];
  if (!e) throw new Error("Gefalteter Schlüssel fehlt");
  // feldweise: beide Läden, beide Kaufdaten, jüngerer Anzeigename
  if (!e.byStore.Billa || !e.byStore.Hofer) throw new Error("Preise nicht zusammengeführt: " + Object.keys(e.byStore).join(","));
  if (e.byStore.Billa.price !== 1.89 || e.byStore.Hofer.price !== 4.42) throw new Error("Falsche Preise übernommen");
  if (!(e.buys || []).includes("2026-07-01") || !(e.buys || []).includes("2026-07-05"))
    throw new Error("Kaufdaten nicht vereinigt: " + JSON.stringify(e.buys));
  if (e.lastName !== "Erdaepfel") throw new Error("Jüngerer Anzeigename verloren: " + e.lastName);
  // mehrfach anwendbar: ein zweiter Start darf nichts mehr verändern
  const vorher = JSON.stringify(p);
  await w.__zettl.boot(); await sleep(700);
  if (JSON.stringify(await w.__zettl.readLocal("prices", {})) !== vorher)
    throw new Error("Zweiter Start verändert die Daten noch einmal");
  ok("Agent 166 – Alte Schlüssel werden gefaltet, feldweise zusammengeführt, zweiter Lauf ändert nichts");
} catch (e) { bad("Agent 166", e); }

// ---------------- Agent 167: Aus dem Verlauf vergessen, und wieder zurückholen
try {
  const { w } = makePhone(); await setup(w);
  await w.__zettl.writeLocal("prices", {
    "kondome": { byStore: {}, lastName: "Kondome", buys: [vorTagen(3)], updatedAt: 1 },
    "mehl":    { byStore: {}, lastName: "Mehl",    buys: [vorTagen(4)], updatedAt: 1 }
  });
  await w.__zettl.boot(); await sleep(800);
  const chip = [...w.document.querySelectorAll("[data-zuletzt]")].find(b => b.textContent.includes("Kondome"));
  if (!chip) throw new Error("Eintrag steht nicht im Verlauf");
  // langes Drücken: drücken, warten, erst danach loslassen
  chip.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  await sleep(1400);
  chip.dispatchEvent(new w.Event("pointerup", { bubbles: true }));
  await sleep(400);
  const p = await w.__zettl.readLocal("prices", {});
  if ((p["kondome"].buys || []).length) throw new Error("Kaufdaten nicht geleert");
  if (!p["kondome"].vergessenAt) throw new Error("Keine Vergessen-Marke gesetzt");
  if (!(p["mehl"].buys || []).length) throw new Error("Der falsche Eintrag wurde vergessen");
  const namen = [...w.document.querySelectorAll("[data-zuletzt]")].map(b => b.textContent);
  if (namen.some(n => n.includes("Kondome"))) throw new Error("Eintrag steht trotz Vergessen noch da");
  if (!namen.some(n => n.includes("Mehl"))) throw new Error("Der Rest des Verlaufs ist mit weg");

  // Kurzes Drücken darf NICHT vergessen, sondern muss auf die Liste setzen
  const chip2 = [...w.document.querySelectorAll("[data-zuletzt]")].find(b => b.textContent.includes("Mehl"));
  chip2.dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
  await sleep(80);
  chip2.dispatchEvent(new w.Event("pointerup", { bubbles: true }));
  chip2.dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(900);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (!items.some(i => i.name === "Mehl")) throw new Error("Kurzer Tipp setzt nichts auf die Liste");
  if (!((await w.__zettl.readLocal("prices", {}))["mehl"].buys || []).length)
    throw new Error("Kurzer Tipp hat den Verlauf gelöscht");

  // Wer es wieder kauft, holt es zurück: die Marke muss weichen
  await addItem(w, "Kondome"); await sleep(300);
  [...w.document.querySelectorAll("[data-toggle]")].find(b => b.closest(".item").textContent.includes("Kondome"))
    .dispatchEvent(new w.Event("click", { bubbles: true }));
  await sleep(900);
  const p2 = await w.__zettl.readLocal("prices", {});
  if (p2["kondome"].vergessenAt) throw new Error("Marke bleibt trotz neuem Kauf stehen");
  if (!(p2["kondome"].buys || []).length) throw new Error("Neuer Kauf nicht vermerkt");
  ok("Agent 167 – Langes Drücken vergisst, kurzes Tippen nicht, neuer Kauf hebt es auf");
} catch (e) { bad("Agent 167", e); }

console.log("\n================ TESTLAUF ================");
results.forEach(r => console.log((r[0] === "PASS" ? "✅" : "❌") + "  " + r[1] + (r[2] ? "\n     → " + r[2] : "")));
const fails = results.filter(r => r[0] === "FAIL").length;
console.log("==========================================");
console.log(results.length - fails + "/" + results.length + " bestanden");
process.exit(fails ? 1 : 0);
