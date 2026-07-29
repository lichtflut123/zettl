# Befund: Zustand der Abrufer (Stand 29. Juli 2026)

Untersucht wurden die Ketten, deren Daten im veröffentlichten Datensatz stillstehen.
Jeweils ein einzelner Testabruf, keine Dauerlast.

| Kette | Letzter Stand im Datensatz | Befund | Reparierbar |
|---|---|---|---|
| Billa | 28.07.2026 | läuft | – |
| Spar | 28.07.2026 | läuft | – |
| **dm** | 29.07.2025 | Abfrage läuft, **Preisfeld ist umgezogen** | **ja, Patch liegt bei** |
| **Hofer (roksh)** | 07.11.2025 | **zwei Aufrufe brauchen neue Parameter** | **ja, Patch liegt bei** |
| MPREIS | 25.06.2024 | Algolia-Zugang ungültig, Shop umgebaut | offen |
| Unimarkt | 13.02.2024 | nicht untersucht | offen |
| BIPA | 20.09.2023 | nicht untersucht | offen |
| Müller | 03.03.2025 | nicht untersucht | offen |

## dm – behoben

Die Crawl-Schnittstelle antwortet weiterhin mit HTTP 200. Geändert hat sich der Aufbau
der Antwort: Ein Produkt hat nur noch `brandName`, `title`, `dan`, `gtin`, `context`
und `tileData`. Das früher oberste Feld `price` gibt es nicht mehr – deshalb verwirft
`getCanonical` jedes Produkt und die Kette liefert nichts.

Wo die Angaben jetzt stehen:

```
tileData.trackingData.price          -> 0.35            (Zahl, am verlässlichsten)
tileData.price.price.current.value   -> "0,35 €"        (Anzeigetext)
tileData.price.tileInfos[0]          -> "0,1 kg (3,50 € je 1 kg)"
tileData.title.tileHeadline          -> "… Schale, 100 g"
```

Der beiliegende Patch (`dm-fetcher-fix.patch`) liest den Preis aus `trackingData`,
fällt auf den Anzeigetext zurück und holt Menge und Einheit aus `tileInfos`,
notfalls aus der Größenangabe am Ende des Titels. Das alte Format wird weiterhin
gelesen, ältere zwischengespeicherte Antworten funktionieren also unverändert.

Geprüft an drei Originalabfragen des Abrufers:

```
allCategories.id=070000                        304 Produkte -> 304 nutzbar
allCategories.id=010000&price.value.to=2       408 Produkte -> 408 nutzbar
```

Bei zwei von 304 Produkten fehlt die Mengenangabe (Artikel ohne Größe im Titel),
die übrigen sind vollständig.

Anwenden:

```bash
cd heissepreise
git apply /pfad/dm-fetcher-fix.patch
npm run dev
```

## Hofer (roksh.at) – behoben

Der erste Eindruck täuschte: Die Schnittstelle ist nicht verschwunden, ihr fehlten nur
Pflichtparameter. Wer sie ohne aufruft, bekommt 500 mit einer Fehler-ID – das sieht nach
Abschaltung aus, ist aber ein unbehandelter Serverfehler.

Was die Seite heute selbst aufruft (aus ihrem öffentlichen Skript-Bündel):

```
GET /category/GetFullCategoryList?providerCode=hofer&isOwnWebshop=false
GET /productlist/additionalCategoryProductList?progIdList=<ProgID>
        &listResultProductNum=<n>&providerCode=hofer&isOwnWebshop=false
```

Drei Änderungen waren nötig:

1. **Kategorien**: früher `POST` ohne Parameter, heute `GET` mit `providerCode` und
   `isOwnWebshop`. Der Sitzungsaufbau über `POST /session/configure` ist unverändert und
   liefert das JWT weiterhin im Kopf `jwt-auth`.
2. **Produkte**: `POST /productlist/GetProductList` mit `{CategoryProgId, Page}` gibt es
   nicht mehr – diese Route verlangt inzwischen ein vollständiges Sitzungsobjekt.
   `additionalCategoryProductList` liefert dafür eine ganze Kategorie in einem Aufruf.
   Das ersetzt die Seitenblätterung und erzeugt nebenbei weniger Last: statt vier
   Anfragen für 74 Produkte genügt eine.
3. **Feldnamen**: Die Produkte liegen jetzt unter
   `ProductListResults[].ProductQueryResultDto.ProductList`. `unitType`, `unit` und
   `isBio` gibt es nicht mehr; an ihre Stelle treten `displayUnit` und `priceUnitType`,
   Bio erkennt man nur noch am Namen. Ohne Größenangabe im Namen ist die Menge jetzt 1
   Stück statt `NaN`.

Geprüft an drei von 50 Unterkategorien (mehr wäre für einen Test unnötige Last):

```
158 Rohprodukte -> 158 nutzbar, 0 ohne Preis, 0 ohne Mengenangabe
  Melanzani        1.69 €  1 stk
  BIO Gurke        1.69 €  1 stk   BIO
  Mixsalat 125g    1.69 €  125 g
  Karotten 1kg     1.89 €  1000 g
```

Anwenden:

```bash
cd heissepreise
git apply /pfad/hofer-fetcher-fix.patch
```

## MPREIS – offen

Der bisher genutzte Algolia-Index antwortet mit `403 Invalid Application-ID or API key`.
Der Shop selbst ist umgebaut (`/shop` gibt 404), im Seitenquelltext taucht ein neuer
Dienst `api.dsa.mpreis.at` auf. Auch hier gilt: Das ist keine Reparatur, sondern eine
Neuentwicklung gegen eine nicht dokumentierte Schnittstelle.

## Vorschlag

Mit beiden Patches sind vier Ketten wieder aktuell: Billa, Spar, dm und Hofer. Das deckt
den Großteil eines österreichischen Wocheneinkaufs ab.

MPREIS bliebe offen. Dort wäre es keine Reparatur, sondern eine Neuentwicklung gegen
eine nicht dokumentierte Schnittstelle – da würde ich eher beim Anbieter anfragen. Für
alles Weitere gibt es Open Prices, wo Preise mit einem Foto vom Regal beigetragen werden
können: langsamer, aber ohne Grauzone.

## Hinweis zur Vorgehensweise

Alle Angaben stammen aus einzelnen Testabrufen, nicht aus Dauerlast. Die `robots.txt`
von roksh.at enthält keine Einschränkung. Ausgelesen wurde nur, was die Seite selbst
öffentlich ausliefert; es wurde nichts umgangen, keine Anmeldung, keine Sperre, kein
Schutzmechanismus.
