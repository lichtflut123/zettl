# Zettl – Stand und offene Punkte

Stand: 29. Juli 2026. Alles Folgende ist getestet, sofern nicht anders vermerkt.

## Was es gibt

| Datei | Zweck |
|---|---|
| `index.html` | Die ganze App, eine Datei, 195 KB |
| `preise.json` | 52.253 Artikel mit Preisen, 4,0 MB |
| `test/agenten.mjs` | 178 Testagenten, die die App im Browser durchklicken |
| `server/` | Optionaler Preis-Server samt Importern |
| `patches/hofer-fetcher-fix.patch` | Reparatur für heisse-preise (Hofer) |
| `patches/dm-fetcher-fix.patch` | Reparatur für heisse-preise (dm) |
| `docs/befund-abrufer.md` | Untersuchung, welche Ketten warum stillstehen |

## Was fertig ist

**Einkaufen**: Liste zu zweit, nach Marktreihenfolge gruppiert, Warengruppen mit Symbolen,
Artikel vollständig bearbeitbar, Preisgedächtnis je Laden, Kostenkarte, Kilopreis,
Sparplan mit Ladenaufteilung und Wegkosten, wiederkehrende Einkäufe, Produktsuche in
52.253 Artikeln, Bio- und Regional-Kennzeichnung, Klimabilanz.

**Haushalt**: Aufgaben mit Räumen, Geschossen, Wiederholung, Überspringen, 26 Raumtypen
mit rund 200 Vorschlägen, Produktvorschläge je Aufgabe, Grundriss-Editor mit Skizze.

**Technik**: Ende-zu-Ende verschlüsselt, Sync über eigene Supabase, Einladungs-Link,
läuft offline, funktioniert bei gesperrtem Speicher und im Funkloch.

## Nächster Schritt (Stand 30.07.2026)

**Das Auslieferungstor ist durch.** Alle vier Punkte erledigt, dazu die Befunde eines
Audits mit Gegenprobe: Sperren/Zurücksetzen während des Syncs (inkl. der Klartext-Lücke,
wenn S.key UND S.vault zusammen wegfallen – jetzt hält `e2eJemals` dagegen), Zeitlimit
für hängende Anfragen, sichtbare Speicherfehler, fremder Tresor hält den Sync an,
Grabsteine für `plan` und `shops` (gelöschte Skizze und gelöschtes Zuhause bleiben
gelöscht; `shops.file` fehlte im Merge und wurde von jedem Sync gelöscht), `vergessenAt`
kommt nicht mehr zurück (`wiederAt` hält dagegen), keine Raumnamen mehr im Klartext
(`zettl.zu` schlüsselt über die Raum-ID).

Gepusht als Erstpush nach Historien-Bereinigung (die echte Supabase-Adresse stand noch
in sechs Altcommits); hochgeladen wird der Ordner `D:\zettl-netlify-upload` bei Netlify –
das braucht die Netlify-Anmeldung des Nutzers.

**Arbeitsweise, nachgeschärft am 30.07.:** `npm run schnell` (1,3 s, gegen die echten
Artikel) nach jeder Einzeländerung, die **Bereichs-Agenten** (`npm run wagerl`) vor jedem
Commit, die **volle Suite** (`npm test`, 8–10 min) am Etappenende und vor jedem Push.
Für jeden Bereich vorher ein Test, der ohne die Reparatur rot ist – wo jsdom das nicht
hergibt (Layout, Ziehen), dazuschreiben statt einen Test erfinden. Gebaut wird solo;
Subagenten nur an Etappen-Enden (Audit) oder auf Ansage. Das gemeinsame Test-Geschirr
liegt in `test/harness.mjs`.

**Nächstes Bauvorhaben: „Drei Wagerl"** – ein Zettel aus Oberbegriffen mit Mengen wird
in drei fertige Einkaufsvarianten aufgelöst (günstig – regional – bio). Konzept samt
14 Entscheidungen aus dem Grill-Durchgang: `docs/drei-wagerl.md`. Etappe 1 (Gerüst)
ist begonnen; Entscheidung 11 (Vorlage als zweite Liste, Zettel bleibt der heutige)
gilt probeweise und wird nach Etappe 1 erneut gegrillt.

**Der volle Prüfbericht** mit 85 Funden aus 19 Agenten liegt unter
`…\tasks\wkb9fcmda.output` (Sitzungsordner). Rund 55 echte Defekte, nach Schwere
geordnet; abgearbeitet sind bisher die Suche, der Plan-Tab und der Sync-Cluster.
Offen unter anderem: Sparplan-Zahlen mischen Packungspreise mit mengenbereinigten
Ersparnissen, Barrierefreiheit, die **ungemessene Leistungsfrage** – lineare Suche über
52.000 Einträge bei jedem Tastendruck, volles Neuzeichnen bei jedem Toast – und der
**Uhrenversatz**: ein Handy mit falsch gehender Uhr verliert beim Merge seine Änderungen;
die Serverzeit aus dem Date-Header wäre der Maßstab, ist aber ein Eingriff ins
Merge-Verhalten und braucht eine eigene Entscheidung. Ebenso offen: `boot()` verschluckt
„Datenbank nicht erreichbar" ohne Einladungslink und bietet den Anlege-Bildschirm an –
wer dort tippt, spaltet den Haushalt.

## Offen – wichtig

1. **Preisdatei aktualisiert sich nicht selbst.** Aktuell erzeugt Claude sie auf Zuruf
   und ihr ladet sie hoch. Sauber wäre: GitHub Action oder Cron, die wöchentlich
   `build-preisdatei.js` ausführt und die Datei neben die App legt.
2. **Datenvolumen prüfen.** Die App lädt `preise.json` (3,5 MB) beim ersten Tippen jeder
   Sitzung. Im WLAN egal, unterwegs womöglich nicht. Zu klären: Zwischenspeicherung über
   Service Worker oder IndexedDB, damit nur bei neuem Stand geladen wird.
3. **Hofer liefert nur 2.070 Artikel** – roksh.at listet für Hofer offenbar nur einen
   Teil des Sortiments. Spar (22.309) und Billa (12.063) sind vollständig.
4. **Sync und Preisdatei zusammen** sind einzeln getestet, aber noch nie eine Woche im
   echten Alltag zu zweit gelaufen.

## Offen – nice to have

5. **Erinnerungen** bei fälligen Aufgaben. Braucht Service Worker und auf iOS eine über
   den Home-Bildschirm installierte App. Ohne das nur, solange die App offen ist.
6. **Produktbilder** gibt es nur bei Treffern aus Open Food Facts; der heisse-preise-
   Datensatz enthält keine. Zusammenführen ginge über die Barcodes.
7. **Aktionen** werden bisher nur erkannt, wenn der Preis gefallen ist. Flugblätter
   separat auslesen wäre genauer.
8. **Mengenangaben fehlen** bei manchen Artikeln, dann ist kein Kilopreis möglich.
9. **MPREIS und BIPA** sind bewusst nicht repariert – dort wäre es Neuentwicklung gegen
   undokumentierte Schnittstellen, siehe `befund-abrufer.md`.
10. **Skizze automatisch in Räume umwandeln** (heute: Skizze als Hintergrund, Räume von
    Hand darüberschieben).
11. **Mehr als zwei Personen**, Gäste, Datenexport als Sicherung.

## Bekannte Grenzen

- Die Klimabilanz ist eine Größenordnung, kein Messwert.
- Bei handgetippten Artikeln nimmt der Sparplan das ähnlichste Produkt – das kann daneben
  liegen, deshalb der Hinweis im Dialog.
- Die volle Testsuite braucht mehrere Minuten und läuft im Chat nicht mehr in einem Stück.

## Weiterarbeiten in Claude Code

Der Umzug ist erledigt: Das Projekt liegt als Git-Repository in `D:\zettl_app`, in der
oben beschriebenen Struktur. Die Testsuite läuft in einem Stück durch.

```bash
npm test                   # node test/agenten.mjs, meldet 178/178, dauert Minuten
```

Zwei Dinge, die beim Umzug angepasst wurden:

- Der Pfad zur App in `test/agenten.mjs` zeigt jetzt auf `./index.html`; der Test muss
  deshalb aus dem Projektstamm laufen.
- jsdom 26 stellt `TextEncoder`/`TextDecoder` im Fenster nicht bereit. Beide werden in
  `beforeParse` nachgereicht, so wie dort schon `crypto` und `fetch`. Ohne das startet
  die App in der Testumgebung überhaupt nicht – im echten Browser ist alles in Ordnung.

Wichtig hier: **Vor jeder Änderung committen, nach jeder Änderung Tests laufen lassen.**
Die Agenten haben in diesem Projekt zehn echte Fehler gefunden, darunter Datenverlust
bei schnellen Eingaben – ohne sie wäre das erst euch im Supermarkt aufgefallen.

### Preisdatei: die acht Felder

`build-preisdatei.js` schrieb früher nur fünf Felder je Artikel. Die App liest acht –
zusätzlich Bio, Regional und die Warengruppe. Das ist nachgezogen:

- **Bio** kommt aus dem Datensatz (`item.bio`, bei Spar aus `biolevel`), ergänzt um den
  Namen, wenn „Bio“ dort als eigenes Wort steht. Die Eigenmarken sind im Datensatz
  lückenhaft gekennzeichnet.
- **Warengruppe** kommt aus dem Kategoriecode des Datensatzes; die zehn Hauptgruppen von
  heisse-preise werden auf die zwölf der App abgebildet. Fleisch & Wurst trennt die App
  vom Kühlregal, der Datensatz nicht – dort entscheidet die Wortliste. Artikel ohne Code
  werden über dieselbe Wortliste eingeordnet.
- Die Wortliste wird zur Laufzeit aus `index.html` gelesen (`const CAT_WORDS`), damit
  App und Preisdatei nicht auseinanderlaufen. Ändert sich dort der Aufbau, bricht der
  Lauf mit einer klaren Meldung ab.
- **Regional** steht in keinem Datensatz. Es wird am Namen erkannt: Bundesländer,
  „aus Österreich“ und dergleichen.

Gemessen an der Preisdatei vom 29. Juli 2026, über die 33.097 gemeinsamen Artikel von
Billa und Spar: Bio stimmt zu 99,9 %, die Warengruppe zu 91,8 %, Regional zu 93,0 %.

**Die eine echte Verschlechterung ist Regional.** Die alte Datei kannte 2.266 regionale
Artikel mehr, weil sie offenbar eine Liste österreichischer Erzeuger benutzte, die
nirgends im Ordner liegt. Ein Versuch, diese Liste zu erraten, hat die Übereinstimmung
auf 90,9 % gedrückt – die Heuristik hat „regional“ bei Artikeln behauptet, die es selbst
nicht behaupten. Deshalb bleibt es beim engen Namensabgleich: lieber weniger Kennzeichen
als falsche. Wer die Lücke schließen will, braucht eine gepflegte Markenliste.

Bei der Warengruppe geht es in die andere Richtung: rund 2.000 der 2.726 Abweichungen
sind Artikel, die vorher **gar keine** Warengruppe hatten und jetzt eine bekommen.

### Nächster Auftrag: wöchentliche Preisdatei

GitHub Action, die wöchentlich – montags um 4 Uhr – `server/build-preisdatei.js` ausführt
und die erzeugte `preise.json` ins Repository committet. Billa und Spar kommen frisch aus
dem veröffentlichten Datensatz; die vorhandenen **Hofer- und dm-Zeilen bleiben stehen**
(bekräftigt am 30.07.2026 – keine Eigenabrufe, siehe Regel in CLAUDE.md; die Patches in
`patches/` bleiben nur als Reparatur-Beleg liegen).

Der Wochenrhythmus ist eine bewusste Festlegung vom 29. Juli 2026 und ersetzt die früher
geplante tägliche Ausführung. Begründung und Folgen stehen in `server/README.md` unter
„Wöchentlich aktualisieren".
