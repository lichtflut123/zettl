# Zettl – Haushalts- und Einkaufs-App für zwei Personen

## Aufbau
- `index.html` – die ganze App in einer Datei, kein Build, kein Framework
- `preise.json` – rund 52.000 Artikel mit Preisen, liegt neben der App und wird von ihr direkt gelesen
- `test/agenten.mjs` – 171 Testagenten, die die App in jsdom durchklicken
- `server/` – optionaler Preis-Server und die Importer (eigene package.json, ohne Abhängigkeiten)
- `patches/` – Reparaturen für die heisse-preise-Abrufer (Hofer, dm)
- `docs/` – Übergabe, Befund zu den Abrufern, Umzugsanleitung
- `files/` – Originalarchiv aus dem Chat, nicht versioniert, nur als Sicherung

## Regeln
- Nach jeder Änderung an index.html: `npm test` laufen lassen (dauert mehrere Minuten).
- Vor jeder größeren Änderung committen, damit man zurück kann.
- Keine externen Bibliotheken in index.html. Alles steht in dieser einen Datei.
- Deutsche Beschriftungen, österreichische Begriffe (Erdäpfel, Topfen, Wagerl).
- Alle Nutzerdaten sind Ende-zu-Ende verschlüsselt. Nichts im Klartext speichern.
- Ehrlich bleiben: keine erfundenen Ersparnisse, keine Scheingenauigkeit bei CO₂.
- Preisabrufe: **täglich** gegen den veröffentlichten heisse-preise-Datensatz (Billa, Spar) –
  dessen Betreiber erlaubt ausdrücklich einen Abruf pro Tag. **Keine** automatischen
  Eigenabrufe bei roksh/Hofer und dm: dm sperrt den benutzten Endpunkt per `robots.txt`
  (`Disallow: /`), und bei Hofer wären es 100 % eines fremd beschafften Katalogs.
  Die vorhandenen Hofer- und dm-Zeilen bleiben beim täglichen Lauf **stehen** – sonst
  schrumpft die Preisdatei von 52.253 auf 34.372 Artikel. (Festlegung vom 29.07.2026.)
- `index.html` zählt für graphify als Dokument, nicht als Code: `graphify update .` und der
  Commit-Hook fassen sie **nicht** an. Nach Änderungen an der App braucht der Graph einen
  vollen `/graphify . --update`-Lauf mit semantischer Runde.

## Tests
`npm test` startet `node test/agenten.mjs`. Der Test liest `./index.html`, muss also
aus dem Projektstamm laufen. Am Ende steht `n/n bestanden`; der Prozess endet mit
Code 1, sobald ein Agent fehlschlägt.

## Offene Punkte
Siehe `docs/uebergabe.md`

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
