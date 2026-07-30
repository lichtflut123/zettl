# Drei Wagerl – ein Zettel, drei fertige Einkäufe

Stand: 30. Juli 2026. Ergebnis eines Grill-Durchgangs; die Nummern unten sind die
dort gefällten Entscheidungen. Arbeitstitel des Knopfs: **„Drei Wagerl"** –
Unterzeile „günstig – regional – bio". („Clever einkaufen" ist verbrannt:
Clever ist die Billa-Eigenmarke und steht als Produktname in den Preisdaten.)

## Die Idee

Auf die **Vorlage** (den „Einkaufswagen") kommen Oberbegriffe mit Menge –
„3 l Milch", „3 St. Seife", „6 Bananen". Wer einkaufen geht, drückt **Drei
Wagerl**: Die App löst die ganze Vorlage in drei vollständige Einkaufsvarianten
auf – **die günstigste**, **die regionale**, **die Bio-Variante** – und man
wählt eine. Die gewählte Variante befüllt den Einkaufszettel mit konkreten
Produkten (Name, Menge, Preis, Laden) zum Abhaken im Laden. Die Vorlage bleibt
unverändert: Nächste Woche derselbe Druck, frische Preise, angepasste Wagerl.

## Die Entscheidungen

1. **Einordnung:** Auflöse-Schritt vor dem Einkauf. Der bestehende Zettel und
   der Sparplan bleiben unangetastet.
2. **Mengen:** Stehen direkt in der Position („3 l Milch"). Fehlt die Menge,
   gilt die zuletzt gekaufte aus dem Kaufgedächtnis, sonst eine Standardmenge
   je Warengruppe – sichtbar und antippbar. Fehlt alles, sagt die Korbsumme
   ehrlich „unvollständig – 2 Positionen ohne Menge" statt zu raten.
3. **Kandidaten:** Euer Verlauf zuerst – hat der Haushalt unter dem Begriff
   schon gekauft, bilden diese Produkte und ihresgleichen (gleiche Warengruppe,
   gleiche Einheit) den Kreis. Erst ohne Verlauf greift die Relevanz-Suche, mit
   den bestehenden Schutzregeln (erst Relevanz, dann Preis; nie €/kg gegen €/l).
4. **Dritte Variante:** Bio – plus antippbare CO₂-Tauschhinweise („Margarine
   statt Butter"). Vorschlag, kein Autotausch: „Milch heißt Milch."
5. **Wer wählt:** Die Person, die einkaufen geht, im Moment des Einkaufs. Die
   Wahl ist eine Handlung am Gerät, keine gemeinsame Dauereinstellung – damit
   gibt es keinen Sync-Konflikt zwischen zwei Handys.
6. **Packungen und Überschuss:** Grundwahl ist die knappste Deckung der Menge.
   Ist eine überschießende Kombination spürbar billiger (ab rund 10 % oder
   50 Cent), steht ein Tauschhinweis dran: „4 l statt 3 l, spart 0,47 €". Die
   App kauft nie ungefragt mehr.
7. **Stückware:** Eine kleine Annahmetabelle (Banane ≈ 120 g, Semmel, Ei, …)
   rechnet Stück in Kilo um – die Annahme steht offen in der Zeile („6 Bananen
   ≈ 0,7 kg angenommen"). Ohne Eintrag rechnet die App nicht, sondern sagt es.
8. **Regional-Lücke:** Kennt der Datensatz nichts Regionales (Erkennung trifft
   93 %, als Unter-Erfassung), wird die Position mit dem günstigsten Kandidaten
   besetzt und trägt den Vermerk „nichts Regionales bekannt"; über der Variante
   steht der Zähler („für 3 von 12 Positionen …"). Kaufbar bleiben, nicht lügen.
9. **Läden-Rahmen:** Wie der Sparplan – gewählte Läden, Ladenaufteilung,
   Wegkosten eingerechnet. Die Günstigst-Variante trägt eine Fußnote, wenn
   Hofer dabei ist (Datensatz dort nur teilweise erfasst).
10. **Ergebnis der Wahl:** Ein fertiger Einkaufszettel zum Abhaken. Die Vorlage
    bleibt stehen – sie ist das Wiederverwendbare an der Idee.
11. **(PROBEWEISE)** Der konkrete Zettel IST der heutige Zettel – Abhaken,
    Kostenkarte, Preisgedächtnis, Sync und Testagenten bleiben unberührt. Neu
    ist nur die Vorlage als zweite, mitsyncte Liste. Befüllen **ergänzt** den
    Zettel; was schon konkret draufsteht, bleibt. *Diese Entscheidung ist
    ausdrücklich vorläufig – der zweite Grill-Durchgang nach Etappe 1 prüft
    sie gegen echte Alltagserfahrung.*
12. **Verlauf ↔ Vorlage:** Koexistenz mit Arbeitsteilung. Der Verlauf
    beobachtet und schlägt vor („Milch kaufst du etwa alle 7 Tage – in die
    Vorlage?"); die Vorlage ist die bewusst gepflegte Liste. Ein gepflegter
    Ort, keine zwei Wahrheiten.
13. **CO₂-Tauschliste:** Klein, kuratiert, im Code (wie `CAT_WORDS`): 10–15
    unstrittige Paare. Hinweise sprechen in Größenordnungen („spart grob die
    Hälfte"), nie in Kommastellen. Kein Paar, bei dem die Literatur streitet.
14. **Etappen:**
    - **Etappe 1 – das Gerüst:** Vorlage als mitsyncte Liste (mit Grabsteinen,
      wie alles), Mengenparser, Auflösung (Verlauf zuerst), drei Wagerl im
      Sparplan-Rahmen mit ehrlichen Lücken, Befüllen. Knappe Packungsdeckung,
      keine Hinweise. **Gebaut am 30.07.2026, Wagerl-Agenten 1–6 grün.**
      Offen geblieben in Etappe 1: die Wegkosten-Zeile in den Karten (kommt,
      sobald Zuhause und Läden im Spiel sind) und ein echter Test der
      Verlauf-zuerst-Regel (siehe Vermerk in `test/wagerl.mjs`).
    - **Etappe 2 – die Feinheiten:** Überschuss-Hinweis, Annahmetabelle
      Stückware, Verlauf-schlägt-Vorlage-vor.
    - **Etappe 3 – die Haltungshinweise:** CO₂-Tauschliste.

## Ehrlichkeits-Klausel

Wo ein Kennzeichen fehlt, sagt die Variante das offen, statt still das
Nächstbeste unterzuschieben. Jede Annahme (Menge, Stückgewicht) steht sichtbar
in der Zeile. Die CO₂-Hinweise sind Einordnung, keine Messung. Eine Variante
verspricht nie mehr, als der Datensatz belegt.

## Namensfindung (Jurorenlauf, 30.07.2026)

Drei unabhängige Vorschlagsrunden kamen alle auf **„Drei Wagerl"**. Plätze:
„Zettel auffächern", „Dreierlei", „Einkauf richten", „Drei Varianten".
Verworfen u. a.: „Zettel auflösen" (liest sich wie Löschen), „Fertig gepackt"
(verspricht zu viel), „Eins wird drei" (Zaubertrick-Unterton). Begründung des
Jurors für den Sieger: Die Intelligenz wird nicht behauptet, sondern gezeigt.
