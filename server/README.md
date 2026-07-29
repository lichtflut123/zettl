# Zettl Preis-Server

Kleiner Dienst, der Produkte und Preise vorhält. Die Zettl-App fragt ihn beim Tippen
ab und zeigt passende Produkte mit Preisen je Geschäft, günstigster zuerst.

Bewusst ohne Abhängigkeiten gebaut: Node 18 oder neuer genügt, kein `npm install`,
keine Datenbank. Die Daten liegen in einer einzigen `data.json`.

## Sofort ausprobieren

```bash
cd zettl-server
IMPORT_TOKEN=meintoken node server.js
# in einem zweiten Fenster:
node import-csv.js beispiel.csv http://localhost:8080 meintoken
curl "http://localhost:8080/api/search?q=salz"
```

## Ins Netz stellen

Die App läuft über https, deshalb muss der Server das auch. Drei Wege:

1. **Fly.io / Render / Railway** – kostenloses oder sehr günstiges Kontingent, https ist
   dabei. Repository hochladen, Startbefehl `node server.js`, Umgebungsvariablen setzen.
2. **Kleiner Server (VPS)** ab etwa 4 €/Monat, davor Caddy oder nginx als https-Vorbau.
3. **Zu Hause** auf einem Raspberry Pi, nach außen über Cloudflare Tunnel.

Wichtig: Ein Volume oder ein fester Pfad für `DATA_FILE`, sonst ist nach jedem Neustart
alles weg.

### Umgebungsvariablen

| Variable | Bedeutung |
|---|---|
| `PORT` | Port, Standard 8080 |
| `DATA_FILE` | Pfad zur Datendatei, Standard `./data.json` |
| `IMPORT_TOKEN` | Pflicht fürs Einspielen von Daten |
| `READ_TOKEN` | optional; wenn gesetzt, brauchen auch Abfragen diesen Token |

Setzt `READ_TOKEN`, wenn der Server öffentlich erreichbar ist – sonst kann jeder eure
Preisdatenbank auslesen. Den Token tragt ihr in der App unter ⚙ → Preis-Server ein.

## Endpunkte

| Aufruf | Zweck |
|---|---|
| `GET /api/health` | Status und Anzahl Produkte |
| `GET /api/search?q=salz&limit=20` | Treffer, günstigster Preis zuerst |
| `GET /api/product/<id>` | ein Produkt mit allen Preisen |
| `GET /api/offers?limit=50` | alles, was als Aktion markiert ist |
| `POST /api/import` | Produkte einspielen (Bearer `IMPORT_TOKEN`) |

## Daten einspielen

Format der CSV (Kopfzeile nötig, Reihenfolge egal, Semikolon oder Komma):

```
name;brand;unit;store;price;image;offer
Speisesalz jodiert;Bad Ischler;500 g;Hofer;0,59;;false
Speisesalz jodiert;Bad Ischler;500 g;Billa;0,79;;false
```

Mehrere Zeilen mit gleichem Namen, gleicher Marke und gleicher Größe werden zu einem
Produkt mit mehreren Preisen zusammengefasst.

Direkt per JSON geht es auch:

```bash
curl -X POST https://dein-server/api/import \
  -H "Authorization: Bearer $IMPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"name":"Butter","brand":"Alpenmilch","unit":"250 g",
        "prices":[{"store":"Hofer","price":2.79},{"store":"Billa","price":3.19}]}]'
```

## Woher die Preise kommen: offene Daten

Wir greifen **keine Händlerseiten** ab. Stattdessen nutzen wir fertige, offene Datensätze.
Zwei Importer liegen bei, sie ergänzen sich:

### 1. heisse-preise (Hauptquelle für Preise)

[heisse-preise.io](https://heisse-preise.io) von Mario Zechner sammelt die Preise
österreichischer Ketten und veröffentlicht den fertigen Datensatz (Projekt unter MIT).
Wir laden nur diese fertige Datei – bevorzugt über den GitHub-Spiegel, weil das mit
18 MB gepackt statt 218 MB roh deutlich schonender ist.

```bash
node import-heissepreise.js https://dein-server $IMPORT_TOKEN
```

| Option | Bedeutung |
|---|---|
| `--laeden=billa,spar` | nur bestimmte Ketten |
| `--tage=45` | Ketten überspringen, deren Erfassung länger stillsteht |
| `--max=5000` | Obergrenze je Kette |
| `--auch-alte` | auch stillstehende Ketten übernehmen (zum Ausprobieren) |
| `--behalte-alte` | vorhandene Preise nicht vorher ersetzen |
| `--trocken` | nichts senden, nur anzeigen |

**Stand aus einem echten Testlauf (Juli 2026):**

| Kette | Produkte | Letzter Stand |
|---|---|---|
| Spar | 22.309 | tagesaktuell |
| Billa | 12.063 | tagesaktuell |
| dm | – | Juli 2025, wird übersprungen |
| Hofer | – | November 2025, wird übersprungen |
| Müller | – | März 2025, wird übersprungen |
| MPREIS, Unimarkt, BIPA | – | 2024 bzw. 2023, werden übersprungen |

Heißt: **Billa und Spar sind aktuell**, zusammen rund 34.000 Produkte, davon etwa 4.500
gerade im Angebot. Bei den übrigen Ketten liefern die Sammler des Projekts derzeit nichts
mehr; der Importer erkennt das am Datum, überspringt sie und sagt es euch beim Lauf.
Für Hofer & Co. bleibt euer eigenes Preisgedächtnis in der App – genau dafür ist es da.

Zum Ausprobieren könnt ihr die stillstehenden Ketten trotzdem hereinholen:

```bash
node import-heissepreise.js https://dein-server $IMPORT_TOKEN --auch-alte
```

Dann sind es rund 142.000 Produkte statt 34.000 – aber Hofer steht auf dem Stand von
November 2025, MPREIS auf 2024, BIPA sogar auf 2023. Damit euch das nicht in die Irre
führt, tut die App zweierlei: Sie schreibt bei jedem Preis, der älter als zwei Monate
ist, den Stand dazu („2,39 MPREIS · Stand 01/2024"), und sie übernimmt solche Preise
nicht in euer Preisgedächtnis. Der Server reiht frische Preise außerdem vor alte, auch
wenn die alten billiger sind.

### 2. Open Food Facts / Open Prices (Bilder und Zusatzprodukte)

Der zweite Importer holt Produktbilder, Packungsgrößen und weltweit erfasste Preise aus
[Open Prices](https://prices.openfoodfacts.org) und Open Food Facts (beide ODbL).
Der heisse-preise-Datensatz enthält keine Bilder – die kommen von hier.

```bash
node import-opendata.js https://dein-server $IMPORT_TOKEN --katalog=800
```

### Wöchentlich aktualisieren

```
30 4 * * 1  cd /pfad/zettl-server && node import-heissepreise.js https://dein-server $IMPORT_TOKEN >> import.log 2>&1
0  5 * * 0  cd /pfad/zettl-server && node import-opendata.js    https://dein-server $IMPORT_TOKEN >> import.log 2>&1
```

Einmal pro Woche. Das ist bewusst sparsamer als nötig: Die Ketten liefern durchaus täglich
neue Stände, wir holen sie trotzdem nur wöchentlich. Der Preis dafür ist, dass eure Preise
bis zu sieben Tage alt sein können. Der Gewinn ist deutlich weniger Last bei Projekten, die
ihre Server aus eigener Tasche stemmen – und eine Position, die im Zweifel leichter zu
vertreten ist.

An `--tage` (Standard 45) ändert das nichts: Der Schalter misst das Alter der Daten *im
Datensatz*, nicht euren Abrufrhythmus.

### Wie gut die Suche trifft

Der Server versteht österreichische Ausdrücke: „Klopapier" findet Toilettenpapier,
„Topfen" findet Topfen, „Erdäpfel" auch Kartoffeln. Und er gewichtet nach der Art, wie
deutsche Produktnamen gebaut sind: Bei „Butter" kommen erst S-BUDGET Butter (1,51 €),
Ja! Natürlich Butter (2,02 €) und BILLA Irische Butter (2,66 €) – nicht die
Butter-Apfeltasche. Eine Suche über 34.000 Produkte dauert unter 10 Millisekunden.

### Was ihr rechtlich beachten solltet

- **heisse-preise**: Der Code steht unter MIT. Die Preisdaten stammen ursprünglich von
  den Händlern; sie hier für den eigenen Haushalt zu nutzen, ist unproblematisch,
  weiterverkaufen solltet ihr sie nicht. Nennt das Projekt als Quelle.
- **Open Food Facts / Open Prices**: Open Database License. Quelle nennen (die App tut
  das in der Trefferliste), Veränderungen wieder offen weitergeben.
- Ladet die Datensätze höchstens einmal pro Woche – beide Projekte stemmen ihre Server
  aus eigener Tasche.

## Selbst erfassen (für den privaten Gebrauch)

Wenn euch Hofer oder dm fehlen, weil die veröffentlichten Daten dort stillstehen, könnt
ihr die Erfassung selbst laufen lassen. Schreibt dafür **keinen eigenen Scraper** – das
heisse-preise-Projekt hat die Abrufer für alle Ketten schon eingebaut und gepflegt:

```bash
git clone https://github.com/badlogic/heissepreise
cd heissepreise && mkdir -p data && npm install
npm run dev          # holt beim ersten Start die Daten aller Ketten
```

Der Lauf sagt euch, welche Ketten noch funktionieren und welche nicht mehr. Danach
liegt in `data/latest-canonical.json` euer eigener Datensatz – den lest ihr direkt ein:

```bash
node import-heissepreise.js https://dein-server $IMPORT_TOKEN \
  --datei=/pfad/heissepreise/data/latest-canonical.json
```

Ein defekter Abrufer lässt sich in dem Projekt reparieren; ein Beitrag dorthin hilft
allen, die die Daten nutzen – auch euch beim nächsten fertigen Datensatz.

### Was ihr dabei wissen solltet

Preise von Händlerseiten abzurufen ist rechtlich nicht eindeutig geregelt. Die Preise
selbst sind bloße Tatsachen und nicht urheberrechtlich geschützt; die Nutzungsbedingungen
der Shops untersagen automatisierte Abrufe aber meist, und Datenbanken genießen in der EU
einen eigenen Schutz gegen die Übernahme wesentlicher Teile. Für den eigenen Haushalt,
ohne Weitergabe, mit einem Abruf pro Woche bewegt ihr euch in einer geduldeten Grauzone –
verlassen könnt ihr euch darauf nicht.

Praktische Regeln, die den Unterschied machen:

- **Einmal pro Woche genügt**, nachts, nie parallel. Ein Cron-Eintrag, kein Dauerlauf.
- **Nur für euch.** Der Server bleibt privat, `READ_TOKEN` setzen, nichts weiterverkaufen
  und nichts veröffentlichen.
- **Ehrlich identifizieren** über einen eigenen User-Agent, nicht als Browser tarnen.
- **Nichts umgehen**: keine Anmeldebeschränkungen, keine Sperren, keine Captchas
  aushebeln. Wo eine Seite Nein sagt, ist Schluss.
- **Aufhören, wenn jemand fragt.** Kommt eine Aufforderung, ist die Sache erledigt.

Wenn euch das zu heikel ist: Der fertige Datensatz von heisse-preise und Open Prices
pflegen Billa und Spar tagesaktuell; weil wir nur wöchentlich abrufen, ist eure Kopie
davon bis zu sieben Tage alt. Den Rest deckt euer eigenes Preisgedächtnis in der App.
Das reicht für die Frage, die euch wirklich interessiert – wo der Wocheneinkauf
günstiger ist.

## Eigenen Importer bauen

Ein Importer ist ein Skript, das irgendwoher Daten holt und sie als Liste an
`/api/import` schickt. Das Format:

```js
[{ id: "optional", name: "Butter", brand: "Alpenmilch", unit: "250 g",
   image: "https://…/butter.jpg", offer: false,
   prices: [{ store: "Hofer", price: 2.79, at: "2026-07-29" }] }]
```

Fehlt `id`, bildet der Server sie aus Marke und Name. Bereits vorhandene Produkte
werden aktualisiert, Preise je Geschäft ersetzt, andere Geschäfte bleiben erhalten.

## Mit der App verbinden

In Zettl: ⚙ → **Preis-Server** → Adresse und optionalen Lese-Token eintragen →
„Verbinden und prüfen". Ab dann erscheinen beim Tippen Produktvorschläge mit Preisen.
Der Zugang wird verschlüsselt zwischen euren Handys synchronisiert.
