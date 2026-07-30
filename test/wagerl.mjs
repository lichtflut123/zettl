// Bereichs-Suite "Drei Wagerl": Vorlage, Mengenparser, Auflösung, Befüllen.
// Läuft allein in Sekunden (npm run wagerl) – vor jedem Commit in diesem Bereich.
// Die volle Suite (npm test) nimmt diese Datei am Ende mit.
// Konzept und Entscheidungen: docs/drei-wagerl.md
//
// UNGETESTET, weil die Attrappen-Preisdatei keinen unterscheidungskräftigen Fall
// hergibt: die Verlauf-zuerst-Regel (Entscheidung 3, wagerlKandidaten). Alle
// Käse-Kandidaten der Attrappe sind ohnehin dieselbe Warengruppe und Einheit,
// der Verlauf ändert dort nie das Ergebnis. Ein echter Test braucht einen
// Begriff, dessen Suchtreffer Gruppen mischen – dazuschreiben, sobald die
// Attrappe einen solchen Fall bekommt, statt einen scheinbaren Test zu erfinden.
import { REMOTE, PREISDATEI, makePhone, dump, $, txt, click, type, byText, clickText, setup, addItem,
         sleep, until, ok, bad, fazit } from "./harness.mjs";

// ---------------- Wagerl 1: Vorlage anlegen – verschlüsselt gespeichert
// Entscheidung 11 (probeweise): die Vorlage ist eine zweite, mitsyncte Liste.
// Wie alles andere darf sie nie im Klartext im Speicher liegen.
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#openWagerl"); await sleep(150);
  type(w, "#vorlageWas", "3 l Milch"); await sleep(30);
  click(w, "#vorlageAdd"); await sleep(250);
  type(w, "#vorlageWas", "Seife"); await sleep(30);
  click(w, "#vorlageAdd"); await sleep(250);
  if (!txt(w).includes("Milch")) throw new Error("Position nicht sichtbar");
  const roh = w.localStorage.getItem("zettl.vorlage");
  if (!roh) throw new Error("Vorlage nicht gespeichert");
  if (roh.includes("Milch")) throw new Error("Klartext im Speicher!");
  if (!roh.includes("__enc")) throw new Error("Nicht verschlüsselt");
  ok("Wagerl 1 – Vorlage über die UI angelegt, verschlüsselt gespeichert");
} catch (e) { bad("Wagerl 1", e); }

// ---------------- Wagerl 2: Vorlage synct, Gelöschtes bleibt gelöscht
try {
  REMOTE.clear();
  const cfg = JSON.stringify({ url: "https://vorlage.supabase.co", key: "k" });
  const A = makePhone({ "zettl.sync": cfg }); await setup(A.w); await sleep(300);
  click(A.w, "#openWagerl"); await sleep(150);
  type(A.w, "#vorlageWas", "3 l Milch"); click(A.w, "#vorlageAdd"); await sleep(300);
  type(A.w, "#vorlageWas", "Seife"); click(A.w, "#vorlageAdd"); await sleep(600);
  const drüben = REMOTE.get("vorlage");
  if (!drüben) throw new Error("Vorlage nicht hochgeladen");
  if (!drüben.__enc) throw new Error("Vorlage liegt unverschlüsselt in der Datenbank");

  const B = makePhone({ "zettl.sync": cfg }); await sleep(600);
  type(B.w, "#pw", "geheim99"); click(B.w, "#go");
  await until(() => byText(B.w, "button", "Verena"), "B zeigt die Namen");
  clickText(B.w, "button", "Verena"); await sleep(500);
  const beiB = (await B.w.__zettl.readLocal("vorlage", [])).filter(v => !v.deleted);
  if (beiB.length !== 2) throw new Error("Vorlage nicht angekommen: " + beiB.length + " Positionen");

  // B löscht die Seife – nach dem Abgleich muss sie auch bei A weg sein und bleiben
  click(B.w, "#openWagerl"); await sleep(150);
  const del = [...B.w.document.querySelectorAll("[data-vorlage-del]")]
    .find(b => b.closest(".item, .vrow, li, div").textContent.includes("Seife"));
  if (!del) throw new Error("Kein Lösch-Knopf an der Seife");
  del.dispatchEvent(new B.w.Event("click", { bubbles: true })); await sleep(700);
  await A.w.__zettl.syncNow(true); await sleep(400);
  const beiA = (await A.w.__zettl.readLocal("vorlage", [])).filter(v => !v.deleted);
  if (beiA.some(v => /seife/i.test(v.name))) throw new Error("Gelöschte Position kam bei A zurück");
  if (!beiA.some(v => /milch/i.test(v.name))) throw new Error("Milch ist mit verschwunden");
  ok("Wagerl 2 – Vorlage synct verschlüsselt, Gelöschtes bleibt auf beiden Handys weg");
} catch (e) { bad("Wagerl 2", e); }

// ---------------- Wagerl 3: Mengenparser – "3 l Milch", "6 Bananen", "3 St. Seife"
// Entscheidung 2: die Menge steht direkt in der Position.
try {
  const { w } = makePhone(); await setup(w); await sleep(100);
  const fn = w.eval("vorlageMenge");
  const faelle = [
    ["3 l Milch",        { wert: 3,    einheit: "l",   rest: "Milch" }],
    ["3l Milch",         { wert: 3,    einheit: "l",   rest: "Milch" }],
    ["500 g Topfen",     { wert: 500,  einheit: "g",   rest: "Topfen" }],
    ["1,5 kg Erdäpfel",  { wert: 1.5,  einheit: "kg",  rest: "Erdäpfel" }],
    ["6 Bananen",        { wert: 6,    einheit: "stk", rest: "Bananen" }],
    ["3 St. Seife",      { wert: 3,    einheit: "stk", rest: "Seife" }],
    ["2 Stk Semmeln",    { wert: 2,    einheit: "stk", rest: "Semmeln" }],
    ["Milch",            { wert: null, einheit: null,  rest: "Milch" }],
    ["Emmentaler 45%",   { wert: null, einheit: null,  rest: "Emmentaler 45%" }]
  ];
  const falsch = [];
  for (const [txt_, soll] of faelle) {
    const ist = fn(txt_);
    if (!ist || ist.wert !== soll.wert || ist.einheit !== soll.einheit || ist.rest !== soll.rest)
      falsch.push(txt_ + " → " + JSON.stringify(ist));
  }
  if (falsch.length) throw new Error(falsch.join("; "));
  ok("Wagerl 3 – Mengenparser trifft " + faelle.length + " Schreibweisen");
} catch (e) { bad("Wagerl 3", e); }

// ---------------- Wagerl 4: Drei Varianten mit ehrlichen Lücken
// Entscheidungen 3, 8, 9: Kandidaten mit Schutzregeln, Regional-Lücke offen
// ausgewiesen, Ladenaufteilung sichtbar. "Seife" hat im Datensatz keinen
// Treffer und muss das in allen drei Karten ehrlich sagen.
try {
  PREISDATEI.inhalt.artikel.push(["Bio Vollmilch", 1.59, "Spar", "1 l", 0, 1, 0, "kuehl"]);
  const { w } = makePhone(); await setup(w);
  click(w, "#openWagerl"); await sleep(150);
  for (const p of ["3 l Milch", "500 g Butter", "Seife"]) {
    type(w, "#vorlageWas", p); click(w, "#vorlageAdd"); await sleep(250);
  }
  click(w, "#wagerlRechnen");
  await until(() => $(w, '[data-wagerl="guenstig"]'), "Wagerl-Karten");
  const karte = (k) => $(w, '[data-wagerl="' + k + '"]').textContent;
  const g = karte("guenstig"), r = karte("regional"), b = karte("bio");
  // Günstigste: Clever Vollmilch (1,32/l) und S-BUDGET Butter (Spar, 6,04/kg)
  if (!g.includes("Clever Vollmilch")) throw new Error("Günstig: Milch falsch besetzt");
  if (!g.includes("S-BUDGET Butter")) throw new Error("Günstig: Butter falsch besetzt");
  // Bio: Bio Vollmilch und Ja! Natürlich Butter
  if (!b.includes("Bio Vollmilch")) throw new Error("Bio: Milch falsch besetzt");
  if (!b.includes("Ja! Natürlich Butter")) throw new Error("Bio: Butter falsch besetzt");
  // Regional: Butter → Ja! Natürlich (2,02, regional) statt Alpenbutter (2,29);
  // für Milch gibt es nichts Regionales – ehrliche Lücke samt Zähler
  if (!r.includes("Ja! Natürlich Butter")) throw new Error("Regional: Butter falsch besetzt");
  if (!r.includes("nichts Regionales")) throw new Error("Regional-Lücke wird verschwiegen");
  if (!/für\s+1\s+von/.test(r)) throw new Error("Regional-Zähler fehlt");
  // Seife: kein Treffer – in jeder Karte offen gesagt
  for (const t of [g, r, b]) if (!t.includes("nichts im Datensatz")) throw new Error("Seifen-Lücke wird verschwiegen");
  // Ladenaufteilung: die günstigste Variante kauft bei Billa UND Spar
  if (!(g.includes("Billa") && g.includes("Spar"))) throw new Error("Ladenaufteilung fehlt");
  ok("Wagerl 4 – Drei Varianten, ehrliche Lücken, Ladenaufteilung");
} catch (e) { bad("Wagerl 4", e); }

// ---------------- Wagerl 5: Wagerl nehmen befüllt den Zettel – und ergänzt nur
// Entscheidungen 10/11 (probeweise): der konkrete Zettel ist der heutige;
// Vorhandenes bleibt stehen, der Ursprung (Oberbegriff) wird vermerkt.
try {
  const { w } = makePhone(); await setup(w);
  await addItem(w, "Klopapier");
  click(w, "#openWagerl"); await sleep(150);
  type(w, "#vorlageWas", "3 l Milch"); click(w, "#vorlageAdd"); await sleep(250);
  click(w, "#wagerlRechnen");
  await until(() => $(w, '[data-wagerl-nehmen="guenstig"]'), "Nehmen-Knopf");
  click(w, '[data-wagerl-nehmen="guenstig"]'); await sleep(500);
  const items = (await w.__zettl.readLocal("shopping", [])).filter(i => !i.deleted);
  if (!items.some(i => i.name === "Klopapier")) throw new Error("Bestehender Artikel wurde verdrängt");
  const milch = items.find(i => i.name === "Clever Vollmilch");
  if (!milch) throw new Error("Gewähltes Produkt nicht auf dem Zettel");
  if (milch.anzahl !== 3) throw new Error("Anzahl fehlt: " + JSON.stringify(milch.anzahl));
  if (milch.price !== 1.32) throw new Error("Packungspreis falsch: " + milch.price);
  if (!milch.ursprung || !/milch/i.test(milch.ursprung)) throw new Error("Ursprung nicht vermerkt");
  if (!txt(w).includes("Clever Vollmilch")) throw new Error("Zettel zeigt das Produkt nicht");
  ok("Wagerl 5 – Wagerl übernommen: ergänzt den Zettel, Anzahl, Preis und Ursprung stimmen");
} catch (e) { bad("Wagerl 5", e); }

// ---------------- Wagerl 6: Knappste Packungsdeckung (Entscheidung 6, Grundwahl)
// "1 kg Käse": die 1-kg-Vorteilspackung (exakt) schlägt 3×400 g (1200 g) –
// auch wenn andere 400-g-Packungen je kg billiger wären. "300 g Käse": knappste
// Deckung ist EINE 400-g-Packung, darunter die billigste (Hofer, 6,99).
// Der Überschuss-HINWEIS ist Etappe 2; hier zählt nur die Grundwahl.
try {
  const { w } = makePhone(); await setup(w);
  click(w, "#openWagerl"); await sleep(150);
  type(w, "#vorlageWas", "1 kg Käse"); click(w, "#vorlageAdd"); await sleep(250);
  click(w, "#wagerlRechnen");
  await until(() => $(w, '[data-wagerl="guenstig"]'), "Wagerl-Karten");
  let g = $(w, '[data-wagerl="guenstig"]').textContent;
  if (!g.includes("Vorteilspackung")) throw new Error("1 kg: nimmt nicht die exakte Packung: " + g.slice(0, 200));
  // Position tauschen: 300 g
  const del = $(w, "[data-vorlage-del]");
  del.dispatchEvent(new w.Event("click", { bubbles: true })); await sleep(300);
  type(w, "#vorlageWas", "300 g Käse"); click(w, "#vorlageAdd"); await sleep(250);
  click(w, "#wagerlRechnen");
  await until(() => $(w, '[data-wagerl="guenstig"]') && !$(w, '[data-wagerl="guenstig"]').textContent.includes("Vorteilspackung"), "neue Rechnung");
  g = $(w, '[data-wagerl="guenstig"]').textContent;
  if (!g.includes("Bergkäse")) throw new Error("300 g: kein Bergkäse gewählt");
  if (!g.includes("Hofer")) throw new Error("300 g: nicht die billigste 400-g-Packung (Hofer)");
  // Entscheidung 9: kauft eine Karte bei Hofer, gehört die ehrliche Fußnote dazu –
  // der Datensatz kennt dort nur einen Bruchteil des Sortiments.
  if (!g.includes("teilweise erfasst")) throw new Error("Hofer-Fußnote fehlt");
  ok("Wagerl 6 – Knappste Deckung: 1 kg exakt, 300 g mit einer 400-g-Packung, Hofer-Fußnote");
} catch (e) { bad("Wagerl 6", e); }

fazit();
