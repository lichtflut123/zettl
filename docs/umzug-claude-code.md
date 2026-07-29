# Zettl in Claude Code weiterbauen

Anleitung für den Umzug vom Chat an den Rechner. Rechne mit 20 bis 30 Minuten,
davon die Hälfte Warten auf Downloads.

---

## Schritt 1: Dateien herunterladen

Lade aus diesem Chat alles herunter und leg es in einen Ordner, z. B. `Downloads/zettl`:

| Datei | wohin später |
|---|---|
| `zettl.html` | wird zu `index.html` |
| `preise.json` | Wurzel |
| `test-agenten.mjs` | `test/agenten.mjs` |
| `uebergabe.md` | `docs/uebergabe.md` |
| `befund-abrufer.md` | `docs/befund-abrufer.md` |
| `hofer-fetcher-fix.patch` | `patches/` |
| `dm-fetcher-fix.patch` | `patches/` |
| die acht Dateien aus `zettl-server/` | `server/` |

---

## Schritt 2: Claude Code installieren

Voraussetzung: ein Pro-, Max-, Team- oder Enterprise-Konto. Mit dem Gratiskonto
funktioniert Claude Code nicht.

**Windows** – PowerShell öffnen (Startmenü, "PowerShell" tippen):

```powershell
irm https://claude.ai/install.ps1 | iex
```

**macOS oder Linux** – Terminal öffnen:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Danach prüfen:

```bash
claude --version
```

Kommt eine Versionsnummer, hat es geklappt. Kommt `command not found`, hilft
`claude doctor` beziehungsweise ein Neustart des Terminals.

Zwei Empfehlungen für Windows: Installiere zusätzlich
[Git für Windows](https://git-scm.com/downloads/win) – damit kann Claude Code
Shell-Befehle ausführen. Und wenn dir die Kommandozeile fremd ist, gibt es die
Desktop-App unter https://claude.com/download, die dasselbe mit Fenstern macht.

Node.js brauchst du für Claude Code selbst nicht mehr, aber für unsere Testsuite
und den Preis-Server: https://nodejs.org (Version 20 oder neuer).

---

## Schritt 3: Projekt anlegen

```bash
mkdir zettl && cd zettl
git init
mkdir -p test server patches docs
```

Dateien einsortieren (Namen anpassen, je nachdem wo deine Downloads liegen):

```bash
cp ~/Downloads/zettl/zettl.html           index.html
cp ~/Downloads/zettl/preise.json          .
cp ~/Downloads/zettl/test-agenten.mjs     test/agenten.mjs
cp ~/Downloads/zettl/uebergabe.md         docs/
cp ~/Downloads/zettl/befund-abrufer.md    docs/
cp ~/Downloads/zettl/*.patch              patches/
cp -r ~/Downloads/zettl/zettl-server/*    server/
```

In `test/agenten.mjs` steht in Zeile 5 noch der alte Pfad:

```js
const HTML = fs.readFileSync("/mnt/user-data/outputs/zettl.html", "utf8");
```

Daraus wird `"./index.html"` (oder du lässt es Claude Code machen, siehe Schritt 5).

Testsuite lauffähig machen und ausführen:

```bash
npm init -y
npm install jsdom
node test/agenten.mjs
```

Erwartet: **156 Agenten, alle grün.** Der Lauf dauert einige Minuten.

Wenn alles steht, der erste Commit:

```bash
git add -A
git commit -m "Stand aus dem Chat: App, Preisdatei, 156 Testagenten, Server"
```

---

## Schritt 4: Eine Merkdatei für Claude Code

Leg im Projektordner eine Datei `CLAUDE.md` an. Claude Code liest sie bei jedem
Start und weiß dann, worauf es ankommt:

```markdown
# Zettl – Haushalts- und Einkaufs-App für zwei Personen

## Aufbau
- `index.html` – die ganze App in einer Datei, kein Build, kein Framework
- `preise.json` – 52.000 Artikel mit Preisen, wird wöchentlich neu erzeugt
- `test/agenten.mjs` – 156 Testagenten, die die App in jsdom durchklicken
- `server/` – optionaler Preis-Server und die Importer

## Regeln
- Nach jeder Änderung an index.html: `node test/agenten.mjs` laufen lassen.
- Vor jeder größeren Änderung committen, damit man zurück kann.
- Keine externen Bibliotheken in index.html. Alles steht in dieser einen Datei.
- Deutsche Beschriftungen, österreichische Begriffe (Erdäpfel, Topfen, Wagerl).
- Alle Nutzerdaten sind Ende-zu-Ende verschlüsselt. Nichts im Klartext speichern.
- Ehrlich bleiben: keine erfundenen Ersparnisse, keine Scheingenauigkeit bei CO₂.

## Offene Punkte
Siehe docs/uebergabe.md
```

---

## Schritt 5: Erste Sitzung

Im Projektordner:

```bash
claude
```

Beim ersten Start meldest du dich über den Browser an. Danach ein guter
Einstiegsauftrag – bewusst klein, damit du siehst, wie es läuft:

> Lies CLAUDE.md und docs/uebergabe.md. Korrigiere dann in test/agenten.mjs den
> Pfad zur App auf ./index.html und lass die Testsuite laufen. Sag mir, wie viele
> Agenten durchlaufen.

Wenn das sitzt, der eigentlich wichtige Auftrag:

> Richte eine GitHub Action ein, die wöchentlich montags um 4 Uhr früh
> server/build-preisdatei.js ausführt und die erzeugte preise.json ins Repository
> committet. Die Ketten Hofer und dm sollen über die Patches in patches/ frisch
> abgerufen werden. Erkläre mir vorher, was du vorhast.

---

## Schritt 6: Veröffentlichen

Zwei Wege, beide funktionieren mit dem Ordner, den du gerade hast:

**Weiter wie bisher:** `index.html` und `preise.json` bei Netlify ins Fenster
ziehen. Simpel, aber Handarbeit.

**Besser:** Repository zu GitHub, Netlify damit verbinden. Dann veröffentlicht
sich jede Änderung von selbst, und die wöchentliche Preisdatei landet automatisch auf
eurer Seite. Claude Code richtet dir das ein, wenn du es darum bittest.

---

## Was sich im Umgang ändert

Im Chat habe ich dir fertige Dateien gegeben. In Claude Code arbeitet Claude
direkt in deinem Ordner: liest Dateien, ändert sie, führt Befehle aus. Das ist
schneller, verlangt aber deine Aufsicht.

Drei Gewohnheiten, die den Unterschied machen:

1. **Nach jeder Änderung die Tests.** Die Agenten haben in diesem Projekt zehn
   echte Fehler gefunden, darunter Datenverlust beim schnellen Abhaken. Ohne sie
   wäre das erst euch im Supermarkt aufgefallen.
2. **Kleine Aufträge.** "Bau mir Erinnerungen ein" wird besser, wenn du es in
   "erst der Service Worker, dann die Benachrichtigung, dann die Einstellung"
   zerlegst.
3. **Diffs anschauen.** `git diff` vor dem Commit. Nicht jede Änderung, die
   plausibel aussieht, ist gemeint.

Nützliche Befehle in der Sitzung: `/help` zeigt alles, `/clear` startet den
Kontext neu, wenn er zugemüllt ist, und mit `Escape` unterbrichst du Claude
mitten in einer Aktion.

---

## Wenn etwas klemmt

| Problem | Abhilfe |
|---|---|
| `claude: command not found` | Terminal neu öffnen, sonst `claude doctor` |
| Tests brechen mit Modulfehler ab | `npm install jsdom` im Projektordner vergessen |
| Testlauf dauert ewig | Normal, mehrere Minuten für 156 Agenten |
| Agenten schlagen fehl nach Änderung | Genau hinsehen: Meist ist es ein echter Fehler, nicht der Test |
| Preisdatei zu groß fürs Repository | Erst ab 100 MB ein Thema, wir sind bei 4 MB |

Offizielle Anleitung, falls sich etwas ändert:
https://code.claude.com/docs/en/setup
