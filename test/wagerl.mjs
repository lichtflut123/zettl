// Bereichs-Suite "Drei Wagerl": Vorlage, Mengenparser, Auflösung, Befüllen.
// Läuft allein in Sekunden (npm run wagerl) – vor jedem Commit in diesem Bereich.
// Die volle Suite (npm test) nimmt diese Datei am Ende mit.
// Konzept und Entscheidungen: docs/drei-wagerl.md
import { REMOTE, makePhone, dump, $, txt, click, type, byText, clickText, setup, addItem,
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

fazit();
