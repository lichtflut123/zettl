# Zettl – Haushalts- und Einkaufs-App für zwei Personen

## Aufbau
- `index.html` – die ganze App in einer Datei, kein Build, kein Framework
- `preise.json` – rund 52.000 Artikel mit Preisen, liegt neben der App und wird von ihr direkt gelesen
- `test/agenten.mjs` – 167 Testagenten, die die App in jsdom durchklicken
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

## Tests
`npm test` startet `node test/agenten.mjs`. Der Test liest `./index.html`, muss also
aus dem Projektstamm laufen. Am Ende steht `n/n bestanden`; der Prozess endet mit
Code 1, sobald ein Agent fehlschlägt.

## Offene Punkte
Siehe `docs/uebergabe.md`
