# Zettl – Stand und offene Punkte

Stand: 29. Juli 2026. Alles Folgende ist getestet, sofern nicht anders vermerkt.

## Was es gibt

| Datei | Zweck |
|---|---|
| `index.html` | Die ganze App, eine Datei, 195 KB |
| `preise.json` | 52.253 Artikel mit Preisen, 4,0 MB |
| `test/agenten.mjs` | 156 Testagenten, die die App im Browser durchklicken |
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

## Offen – wichtig

1. **Preisdatei aktualisiert sich nicht selbst.** Aktuell erzeugt Claude sie auf Zuruf
   und ihr ladet sie hoch. Sauber wäre: GitHub Action oder Cron, die täglich
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
npm test                   # node test/agenten.mjs, meldet 156/156, dauert Minuten
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

### Nächster Auftrag: tägliche Preisdatei

Geplant ist eine GitHub Action, die täglich um 4 Uhr `server/build-preisdatei.js`
ausführt und die erzeugte `preise.json` ins Repository committet; Hofer und dm über die
Patches in `patches/` frisch abgerufen.

**Vorher zu klären:** `build-preisdatei.js` schreibt pro Artikel nur fünf Felder
(`name, preis, laden, einheit, aktion`). Die App liest acht – zusätzlich `bio`,
`regional` und die Warengruppe (siehe `index.html`, Funktion `ladePreisdatei`). Das
Skript ist damit älter als die Preisdatei, die gerade neben der App liegt. Würde die
Action so laufen, gingen Bio- und Regional-Kennzeichnung und die Warengruppen verloren.
Wo diese drei Felder herkommen, steht in keinem Skript im Ordner – das ist zuerst zu
rekonstruieren.
