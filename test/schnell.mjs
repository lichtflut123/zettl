// Schneller Kern-Check: faehrt die App EINMAL hoch und prueft die kritischen
// Funktionen direkt gegen die echte preise.json. Sekunden statt Minuten.
//
//   npm run schnell
//
// Gedacht fuer die Schleife waehrend der Arbeit. Die volle Suite (npm test,
// 171 Agenten, 8-10 Minuten) laeuft weiterhin vor jedem Commit.
//
// Warum es diesen Check gibt: Am 29.07.2026 sind drei Regressionen durch 171
// gruene Agenten spaziert. Gefunden hat sie eine einzige Pruefung - die gegen
// die echten Daten. Die anderen 170 arbeiten mit Attrappen aus 16 Artikeln.
import { JSDOM } from "jsdom";
import { webcrypto } from "node:crypto";
import fs from "fs";

const HTML = fs.readFileSync("./index.html", "utf8");
const PREISE = fs.readFileSync("./preise.json", "utf8");
const fehler = [];
const pruefe = (bedingung, was) => { if (!bedingung) fehler.push(was); };
process.on("uncaughtException", e => console.log("   (Ausnahme: " + e.message + ")"));

const dom = new JSDOM(HTML, {
  runScripts: "dangerously", url: "https://zettl.test/", pretendToBeVisual: true,
  beforeParse(w){
    Object.defineProperty(w, "crypto", { value: webcrypto, configurable: true });
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
    w.fetch = async (u) => String(u).includes("preise.json")
      ? { ok: true, json: async () => JSON.parse(PREISE) }
      : { ok: false, status: 404, json: async () => ({}) };
  }
});
const w = dom.window;
await new Promise(r => setTimeout(r, 700));
await w.eval("ladePreisdatei()");
const anzahl = w.eval("pdIndex.length");
pruefe(anzahl > 40000, "Preisdatei nicht geladen: nur " + anzahl + " Eintraege");
console.log("Preisdatei: " + anzahl.toLocaleString("de-AT") + " Sucheintraege\n");

const ruf = (js) => JSON.parse(w.eval("JSON.stringify(" + js + ")"));
const suche = (q, n) => ruf("pdSuche(" + JSON.stringify(q) + "," + n + ").map(function(t){"
  + "return {name:t.name, cat:t.cat, store:(t.best&&t.best.store)||null};})");

// ---- 1. Suche: was NICHT oben stehen darf. Negativ formuliert, weil die
//      Preisdatei taeglich neu gebaut wird und Artikelnamen sich aendern.
const SUCHE = [
  ["Milch",        ["schokolade","kakao","scheuermilch","sonnenmilch","anfangsmilch","flaschensauger"], "milch"],
  ["Butter",       ["peanut","koerperbutter","nagelbutter","laugenbrez"],            "butter"],
  ["Kaese",        ["katzensnack","dreamies","chips","cabanossi"],                   "kaese"],
  ["Joghurt",      ["milka","ritter sport","hundefutter","lachgummi"],               "joghurt"],
  ["Kaffee",       ["joghurt","jogurt"],                                             "kaffee"],
  ["Eier",         ["rostfrei","hautschere"],                                        "eier"],
  ["Paradeiser",   ["ketchup","pizza","fertig"],                                     "paradeiser"],
  ["Erdaepfel",    ["chips","dippers"],                                              "erdaepfel"],
  ["Klopapier",    [],                                                               "toilettenpapier"],
  ["Waschmittel",  [],                                                               "waschmittel"],
];
for (const [q, verboten, muss] of SUCHE) {
  const top = suche(q, 3);
  pruefe(top.length > 0, q + ": keine Treffer");
  for (const t of top) {
    const n = t.name.toLowerCase();
    const schlecht = verboten.find(x => n.includes(x));
    pruefe(!schlecht, q + ': "' + t.name + '" (' + schlecht + ")");
  }
  const falte = (s) => s.toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss");
  pruefe(top.some(t => falte(t.name).includes(muss) || t.store === "Hofer"),
    q + ": nichts Passendes unter den ersten drei - " + top.map(t => t.name).join(" | "));
}
console.log("Suche: " + SUCHE.length + " Suchwoerter gegen die echten Artikel");

// ---- 2. Warengruppe des Suchworts. Faellt sie auf Teilzeichenketten herein,
//      bestraft die Abwertung ausgerechnet die richtig einsortierten Artikel.
for (const [wort, soll] of [["Milch","kuehl"], ["Paradeiser","obst"], ["Kaffee","getraenke"],
                            ["Preiselbeeren","sonst"], ["Waschmittel","haushalt"], ["Wurst","fleisch"]]) {
  const ist = w.eval("katFuerSuche(" + JSON.stringify(wort) + ")");
  pruefe(ist === soll, "katFuerSuche(" + wort + ") = " + ist + ", erwartet " + soll);
}
console.log("Warengruppen des Suchworts: 6 Woerter");

// ---- 3. Grundpreis: die Zahl, auf der Sparplan und Alternativen beruhen
for (const [preis, einheit, sollWert, sollJe] of [
  [1.32, "1 l", 1.32, "l"], [0.99, "500 ml", 1.98, "l"],
  [2.50, "250 g", 10, "kg"], [4.42, "3 kg", 1.4733333333333334, "kg"],
  [1.69, "1 stk", 1.69, "Stk"]]) {
  const g = ruf("grundpreis(" + preis + "," + JSON.stringify(einheit) + ")");
  pruefe(g && g.je === sollJe && Math.abs(g.wert - sollWert) < 0.001,
    "grundpreis(" + preis + ", " + einheit + ") = " + JSON.stringify(g) + ", erwartet " + sollWert + " je " + sollJe);
}
console.log("Grundpreis: 5 Umrechnungen");

// ---- 4. Sparplan: vergleicht er Vergleichbares? Nur Kandidaten mit derselben
//      Einheit duerfen herangezogen werden - sonst ist Kaese eine billige Milch.
const alt = ruf("alternativen({name:'Clever Vollmilch', price:1.32, size:'1 l'}).map(function(a){"
  + "return {name:a.h.name, unit:a.h.unit, je:a.je};})");
pruefe(alt.length > 0, "Alternativen zu Vollmilch: keine gefunden");
pruefe(alt.every(a => a.je === null || a.je === "l"),
  "Alternativen mischen Einheiten: " + alt.map(a => a.name + " [" + a.je + "]").join(" | "));
console.log("Alternativen: " + alt.length + " zu Vollmilch, Einheiten sauber getrennt");

dom.window.close();
console.log("");
if (fehler.length) {
  console.log("❌  " + fehler.length + " Beanstandungen:");
  fehler.forEach(f => console.log("     " + f));
  process.exit(1);
}
console.log("✅  Kern-Check bestanden");
