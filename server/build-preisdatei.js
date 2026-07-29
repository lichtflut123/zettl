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
//   --kat-quelle=/pfad/index.html  App, aus der die Wortlisten gelesen werden
//
// Ohne --dump lädt das Skript den veröffentlichten Datensatz selbst herunter.
//
// Je Artikel werden acht Felder geschrieben, genau die, die die App liest:
//   [ Name, Preis, Laden, Größe, Aktion, Bio, Regional, Warengruppe ]
// Bio und Warengruppe stammen aus dem Datensatz, Regional wird am Namen erkannt.
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
// Die Wortlisten für die Warengruppen kommen aus der App selbst, siehe ladeWortlisten().
const KAT_QUELLE = opt["kat-quelle"] || path.join(__dirname, "..", "index.html");
const LIVE = (opt.live ? String(opt.live).split(",") : ["hofer", "dm"]).map((s) => s.trim());
const SPIEGEL = "https://github.com/falknerdominik/heisse-preise-data/releases/latest/download/latest-canonical.tar.gz";
const UA = "Zettl-Haushalt/1.0 (privater Haushalt)";
const HEUTE = new Date().toISOString().slice(0, 10);

const KETTEN = { billa: "Billa", spar: "Spar", hofer: "Hofer", dm: "dm", mpreis: "MPREIS",
  unimarkt: "Unimarkt", bipa: "BIPA", mueller: "Müller", lidl: "Lidl", penny: "Penny" };

// ---------------------------------------------------------------- Warengruppe
// heisse-preise vergibt je Artikel einen Kategoriecode; das erste Zeichen ist die
// Hauptgruppe. Das ist die verlässliche Quelle – die Wortliste unten ist nur für
// Artikel ohne Code (Hauptgruppe "A" = unbekannt) und für frisch abgerufene Ketten.
const HP_GRUPPE = {
  "0": "obst",      // Obst & Gemüse
  "1": "backwaren", // Brot & Gebäck
  "2": "getraenke", // Getränke
  "3": "kuehl",     // Kühlwaren – enthält auch Fleisch & Wurst, siehe unten
  "4": "tiefkuehl", // Tiefkühl
  "5": "vorrat",    // Grundnahrungsmittel
  "6": "suess",     // Süßes & Salziges
  "7": "drogerie",  // Pflege
  "8": "haushalt",  // Haushalt
  "9": "tierbedarf" // Haustier
};

// Zettl trennt Fleisch & Wurst vom Kühlregal, heisse-preise nicht. Nur bei
// Hauptgruppe "3" wird deshalb am Namen nachgeschaut.
function feinerAlsKuehl(name, worte) {
  const f = (worte.fleisch || []).some((w) => name.indexOf(w) >= 0);
  return f ? "fleisch" : "kuehl";
}

// Die Wortlisten stehen in der App (index.html, const CAT_WORDS). Sie werden von
// dort gelesen statt hier abgeschrieben – sonst laufen beide Listen auseinander
// und die Preisdatei ordnet anders ein als die App bei handgetippten Artikeln.
function ladeWortlisten(pfad) {
  const html = fs.readFileSync(pfad, "utf8");
  const start = html.indexOf("const CAT_WORDS = [");
  if (start < 0) throw new Error("CAT_WORDS nicht in " + pfad + " gefunden");
  const von = html.indexOf("[", start);
  let tiefe = 0, bis = -1;
  for (let i = von; i < html.length; i++) {
    if (html[i] === "[") tiefe++;
    else if (html[i] === "]") { tiefe--; if (tiefe === 0) { bis = i + 1; break; } }
  }
  if (bis < 0) throw new Error("CAT_WORDS in " + pfad + " ist nicht geschlossen");
  const paare = JSON.parse(html.slice(von, bis));
  const out = {};
  paare.forEach(([gruppe, worte]) => { out[gruppe] = worte; });
  return out;
}

function rateGruppe(name, worte) {
  // Längster Treffer gewinnt – sonst landet "Reis" wegen "eis" im Tiefkühl.
  let beste = null, laenge = 0;
  for (const gruppe of Object.keys(worte))
    for (const w of worte[gruppe])
      if (name.indexOf(w) >= 0 && w.length > laenge) { laenge = w.length; beste = gruppe; }
  return beste;
}

// ---------------------------------------------------------------- Bio, regional
// "bio" liefert der Datensatz selbst (Spar: biolevel, Billa ebenso), aber lückenhaft –
// die BILLA-Bio-Eigenmarke ist dort oft nicht gekennzeichnet. Deshalb zusätzlich der
// Name: "Bio" muss als eigenes Wort dastehen, sonst würden "Bio4You Bonbons" und
// "Link in my Bio, 2 g" fälschlich zu Bio-Produkten.
const BIO_WORT = /(^|[\s\-–(])bio([\s\-–)]|$)/;
function istBio(it, name) {
  return (it && it.bio === true) || BIO_WORT.test(name);
}

// "regional" steht in keinem Datensatz. Es wird aus dem Namen erschlossen und ist
// damit bewusst eine Schätzung: erkannt wird, was sich ausdrücklich auf Österreich
// oder ein Bundesland beruft. Was nicht draufsteht, wird nicht behauptet.
const REGIONAL_WORTE = [
  "aus österreich", "österreichisch", "österreichische", "österreichischer",
  "österreichisches", "heimisch", "aus dem burgenland", "aus der steiermark",
  "kärntner", "steirisch", "steirische", "steirischer", "steirisches",
  "tiroler", "vorarlberger", "salzburger", "oberösterreich", "niederösterreich",
  "burgenländ", "wachauer", "mühlviertler", "muehlviertler", "waldviertler",
  "weinviertler", "mostviertler", "pinzgauer", "pongauer", "lungauer",
  "bregenzerwälder", "montafoner", "ennstaler", "almliesl", "alpenländisch",
  "vom bauern aus", "aus dem alpenraum", "ama-gütesiegel", "ama gütesiegel"
];
// Bewusst KEINE Markenliste: Ein Versuch damit (Alma, Eskimo, Rauch, NÖM …) hat die
// Übereinstimmung mit der bisherigen Datei von 93,0 auf 90,9 Prozent verschlechtert –
// er hat "regional" bei Artikeln behauptet, die es selbst nicht behaupten. Lieber
// weniger Kennzeichen als falsche. Wer die Lücke schließen will, braucht eine
// gepflegte Liste österreichischer Erzeuger, keine Heuristik.
function istRegional(name) {
  return REGIONAL_WORTE.some((w) => name.indexOf(w) >= 0);
}

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
  const worte = ladeWortlisten(KAT_QUELLE);
  console.log("Wortlisten aus " + KAT_QUELLE + ": " + Object.keys(worte).length + " Warengruppen");

  const artikel = [];
  const zaehler = {};
  const stat = { bio: 0, regional: 0, ausDaten: 0, geraten: 0, ohne: 0 };
  // Die App liest acht Felder je Artikel (siehe ladePreisdatei in index.html):
  // Name, Preis, Laden, Größe, Aktion, Bio, Regional, Warengruppe.
  const push = (name, preis, laden, einheit, aktion, bio, regional, gruppe) => {
    if (!name || typeof preis !== "number" || !(preis > 0)) return;
    artikel.push([String(name).replace(/\s+/g, " ").trim(), Math.round(preis * 100) / 100,
      laden, einheit || null, aktion ? 1 : 0, bio ? 1 : 0, regional ? 1 : 0, gruppe || null]);
    zaehler[laden] = (zaehler[laden] || 0) + 1;
    if (bio) stat.bio++;
    if (regional) stat.regional++;
    if (!gruppe) stat.ohne++;
  };

  // Warengruppe bestimmen: erst der Code aus dem Datensatz, dann die Wortliste.
  const gruppeFuer = (it, kleinName) => {
    const code = it && typeof it.category === "string" && it.category ? it.category[0] : null;
    const ausCode = code ? HP_GRUPPE[code] : null;
    if (ausCode) {
      stat.ausDaten++;
      return ausCode === "kuehl" ? feinerAlsKuehl(kleinName, worte) : ausCode;
    }
    const geraten = rateGruppe(kleinName, worte);
    if (geraten) stat.geraten++;
    return geraten;
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
    const klein = String(it.name || "").toLowerCase();
    push(it.name, it.price, KETTEN[it.store], menge(it.quantity, it.unit), istAktion(it),
      istBio(it, klein), istRegional(klein), gruppeFuer(it, klein));
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
        k.forEach((p) => {
          const klein = String(p.name || "").toLowerCase();
          push(p.name, p.price, KETTEN[s], menge(p.quantity, p.unit), false,
            istBio(p, klein), istRegional(klein), gruppeFuer(p, klein));
        });
        console.log(k.length.toLocaleString("de-AT") + " Produkte");
      } catch (e) { console.log("fehlgeschlagen: " + e.message); }
    }
  } else if (LIVE.length) {
    console.log("Hinweis: ohne --repo werden " + LIVE.map((s) => KETTEN[s]).join(", ") + " nicht frisch abgerufen.");
  }

  const ketten = Object.keys(zaehler).sort((a, b) => zaehler[b] - zaehler[a]);
  const datei = { stand: HEUTE, quelle: "heisse-preise.io (" + ketten.join(", ") + ")", artikel };
  fs.writeFileSync(AUS, JSON.stringify(datei));
  console.log("\nGeschrieben: " + AUS + " (" + (fs.statSync(AUS).size / 1048576).toFixed(1) + " MB)");
  const z = (n) => n.toLocaleString("de-AT");
  ketten.forEach((k) => console.log("  " + k + ": " + z(zaehler[k])));
  console.log("  Aktionen: " + z(artikel.filter((a) => a[4]).length));
  console.log("  Bio: " + z(stat.bio) + " (aus dem Datensatz, wo vorhanden)");
  console.log("  Regional: " + z(stat.regional) + " – am Namen erkannt, also eine Schätzung");
  console.log("  Warengruppe: " + z(stat.ausDaten) + " aus dem Datensatz, "
    + z(stat.geraten) + " am Namen geraten, " + z(stat.ohne) + " ohne");
  console.log("\nDatei neben die App legen (gleicher Ordner wie index.html) – fertig.");
})().catch((e) => { console.error("Abgebrochen:", e.message); process.exit(1); });
