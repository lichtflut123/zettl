# Zettl – Stand und offene Punkte

Stand: 30. Juli 2026, abends. Alles Folgende ist getestet, sofern nicht anders vermerkt.

## Was es gibt

| Datei | Zweck |
|---|---|
| `index.html` | Die ganze App, eine Datei, 250 KB |
| `preise.json` | 52.253 Artikel mit Preisen, 4,2 MB |
| `test/agenten.mjs` | 178 Testagenten, die die App in jsdom durchklicken |
| `test/harness.mjs` | Gemeinsames Test-Geschirr (Attrappen, makePhone, Helfer) |
| `test/wagerl.mjs` | 10 Bereichs-Agenten „Drei Wagerl" (`npm run wagerl`, Sekunden) |
| `test/schnell.mjs` | Kern-Check gegen die echte Preisdatei (`npm run schnell`, 1,3 s) |
| `server/` | Optionaler Preis-Server samt Importern |
| `patches/` | Reparaturen für die heisse-preise-Abrufer (nur noch Beleg, s. u.) |
| `docs/drei-wagerl.md` | Konzept „Drei Wagerl" mit allen 14 Entscheidungen |
| `docs/befund-abrufer.md` | Untersuchung, welche Ketten warum stillstehen |

## Auslieferung (seit 30.07. abends komplett)

- **Code:** `github.com/lichtflut123/zettl` – privat, ein Zweig `main`, Historie
  bereinigt (die echte Supabase-Adresse ist aus allen Commits entfernt).
- **Ausliefern heißt: committen und pushen.** Netlify deployt jeden Push
  automatisch auf `https://adorable-donut-d54519.netlify.app` (öffentlich;
  der zufällige Name bleibt bewusst als milder Sichtschutz). Ausgeliefert wird
  das ganze Repo, nicht nur die App – Geheimnisse liegen keine darin.
- **Daten:** Supabase (Tabelle `zettl`) speichert nur Verschlüsseltes und ist
  aktiv. Die App-Adresse ist für Supabase egal; beim Umzug auf eine neue
  Adresse verbindet sich jedes Handy einmal neu („Zu bestehendem verbinden"
  bzw. Einladungslink), der Sync holt alles zurück.
- Der frühere Upload-Ordner `D:\zettl-netlify-upload` ist obsolet, die beiden
  toten Repos (`gunthermuhlehner-glitch/zettl`, `lichtflut11/zettl`) können
  gelöscht werden.

## Was fertig ist

**Einkaufen**: Liste zu zweit, nach Marktreihenfolge gruppiert, Warengruppen mit
Symbolen, Artikel vollständig bearbeitbar, Preisgedächtnis je Laden, Kostenkarte,
Kilopreis, Sparplan mit Ladenaufteilung und Wegkosten, wiederkehrende Einkäufe,
Produktsuche in 52.253 Artikeln, Bio- und Regional-Kennzeichnung, Klimabilanz.

**Drei Wagerl** (neu, 30.07., Konzept mit allen Entscheidungen in
`docs/drei-wagerl.md`): Eine dauerhafte **Vorlage** aus Oberbegriffen mit Menge
(„3 l Milch", „6 Bananen") wird per Knopf in drei fertige Einkaufsvarianten
aufgelöst – **Da Spoarer, Da Regionale, Da Öko**. Knappste Packungsdeckung als
Grundwahl, Mehr-Menge nur als Tausch-Angebot (ab 50 Cent oder 10 %), kuratierte
Stückgewichte mit sichtbarer Annahme („6 Bananen ≈ 0,72 kg angenommen"),
CO₂-Tauschhinweise nur im Öko-Wagerl in Größenordnungssprache, ehrliche Lücken
statt stiller Ersatzwahl, Hofer-Fußnote. „Dieses Wagerl nehmen" **ergänzt** den
heutigen Zettel (probeweise Entscheidung 11 – nach der ersten Alltagswoche
prüfen). Der Verlauf schlägt der Vorlage Begriffe vor, entschieden wird per Tipp.

**Haushalt**: Aufgaben mit Räumen, Geschossen, Wiederholung, Überspringen,
26 Raumtypen mit rund 200 Vorschlägen, Produktvorschläge je Aufgabe,
Grundriss-Editor mit Skizze.

**Technik**: Ende-zu-Ende verschlüsselt, Sync über eigene Supabase,
Einladungs-Link, läuft offline, funktioniert bei gesperrtem Speicher und im
Funkloch. Der Sync-Cluster wurde am 30.07. auditiert und repariert: Sperren und
Zurücksetzen während eines Syncs können keinen Klartext mehr erzeugen
(`e2eJemals`), ein fremder Tresor hält den Sync an (getestet), gelöschte
Verläufe kommen nicht mehr per Merge zurück (`wiederAt`), Netzanfragen haben
ein Zeitlimit, Raumnamen liegen nicht mehr im Klartext im Speicher.

## Arbeitsweise (Festlegung vom 30.07., ersetzt „npm test nach jeder Änderung")

`npm run schnell` (1,3 s) nach jeder Einzeländerung → **Bereichs-Agenten**
(z. B. `npm run wagerl`) vor jedem Commit → **volle Suite** (`npm test`,
8–10 min, 178 + 10 Agenten) am Etappenende und vor jedem Push. Für jeden
Bereich zuerst ein Agent, der ohne die Änderung rot ist; wo die Testumgebung
oder die Datenlage das nicht hergibt, wird es im Test **dazugeschrieben**
statt einen Scheintest zu erfinden (Beispiel: Verlauf-zuerst-Regel, Vermerk am
Kopf von `test/wagerl.mjs`). Subagenten/Workflows nur an Etappen-Enden oder
auf ausdrückliche Ansage.

## Offen – wichtig

1. **Preisdatei aktualisiert sich nicht selbst.** Nächster Auftrag: GitHub
   Action, wöchentlich montags um 4 Uhr, führt `server/build-preisdatei.js`
   aus und committet `preise.json` – der Commit deployt dann von selbst.
   Billa und Spar frisch aus dem veröffentlichten Datensatz; die vorhandenen
   **Hofer- und dm-Zeilen bleiben stehen** (bekräftigt am 30.07., Regel in
   CLAUDE.md; die Patches in `patches/` sind nur noch Beleg).
2. **Datenvolumen prüfen.** Die App lädt `preise.json` (4,2 MB) beim ersten
   Tippen jeder Sitzung. Zwischenspeicherung über Service Worker oder
   IndexedDB wäre der saubere Weg.
3. **Die Alltagswoche zu zweit beginnt erst jetzt.** Sync und Preisdatei
   zusammen sind einzeln getestet, aber nie eine Woche echt gelaufen. Dabei
   mitprüfen: trägt Entscheidung 11 (Wagerl ergänzt den Zettel, Vorlage bleibt)?
4. **Uhrenversatz beim Merge** (offener Befund): ein Handy mit falsch gehender
   Uhr verliert Änderungen und kann nichts löschen. Saubere Lösung wäre die
   Serverzeit aus dem Date-Header – ändert das Merge-Verhalten, braucht eine
   eigene Entscheidung.
5. **boot() verschluckt „Datenbank nicht erreichbar"** (offener Befund): ohne
   Einladungslink erscheint der Anlege-Bildschirm, und wer dort tippt, spaltet
   den Haushalt. Reparatur klar, Formulierung des Hinweises ist offen.
6. **Sparplan mischt Packungspreise mit mengenbereinigten Ersparnissen**
   (offener Befund aus der Prüfrunde vom 29.07.). Die Drei-Wagerl-Rechnung
   macht es richtig (Grundpreis, knappste Deckung) – der alte Sparplan-Dialog
   noch nicht.
7. **Hofer liefert nur 2.070 Artikel** – roksh.at listet offenbar nur einen
   Teil. Die Wagerl-Karten sagen es ehrlich dazu (Fußnote).

Der Prüfbericht vom 29.07. (85 Funde, 19 Agenten) existiert als Datei nicht
mehr; abgearbeitet sind Suche, Plan-Tab und der komplette Sync-Cluster. Die
Punkte 4–6 oben sind seine wesentlichen offenen Reste.

## Offen – nice to have

8. **Erinnerungen** bei fälligen Aufgaben (Service Worker, iOS nur als
   installierte App).
9. **Produktbilder** nur aus Open Food Facts; Zusammenführen ginge über Barcodes.
10. **Aktionen** werden nur als gefallener Preis erkannt; Flugblätter wären genauer.
11. **Mengenangaben fehlen** bei manchen Artikeln – dann kein Kilopreis und
    keine Wagerl-Deckung („die Menge passt zu keiner bekannten Packung").
12. **MPREIS und BIPA** bewusst nicht repariert (`befund-abrufer.md`).
13. **Skizze automatisch in Räume umwandeln.**
14. **Mehr als zwei Personen**, Gäste, Datenexport als Sicherung.
15. **Drei Wagerl weiterdenken:** Wegkosten-Zeile in den Karten (sobald
    Zuhause und Läden gesetzt sind), echter Test der Verlauf-zuerst-Regel,
    `CO2_TAUSCH` und `STK_GRAMM` wachsen nur, wenn ihr etwas vermisst.

## Bekannte Grenzen

- Die Klimabilanz ist eine Größenordnung, kein Messwert – auch die
  CO₂-Tauschhinweise sprechen deshalb nur in Größenordnungen.
- Die Stückgewichte in `STK_GRAMM` sind Durchschnitte; jede Annahme steht
  sichtbar in der Zeile, Bund-Ware wird ehrlich verweigert.
- Bei handgetippten Artikeln nimmt der Sparplan das ähnlichste Produkt – das
  kann daneben liegen, deshalb der Hinweis im Dialog.
- Die volle Testsuite braucht 8–10 Minuten; unter Last (parallele Agenten)
  kann ein einzelner Timeout-Agent flackern – im Zweifel allein wiederholen.

## Weiterarbeiten in Claude Code

```bash
npm run schnell   # Kern-Check, 1,3 s
npm run wagerl    # Bereichs-Suite Drei Wagerl, Sekunden
npm test          # volle Suite: 178 + 10 Agenten, 8-10 min
```

- Tests lesen `./index.html` und müssen aus dem Projektstamm laufen.
- jsdom 26 liefert `TextEncoder`/`TextDecoder` nicht mit; `beforeParse` in
  `test/harness.mjs` reicht beides nach (wie `crypto` und `fetch`).
- Vor jeder größeren Änderung committen. Der Commit-Hook baut den Graphen
  AST-seitig nach; nach App-Änderungen braucht es einen vollen
  `/graphify . --update`-Lauf mit semantischer Runde (Regel in CLAUDE.md).
- Push deployt automatisch – die volle Suite **muss** vorher grün sein.
