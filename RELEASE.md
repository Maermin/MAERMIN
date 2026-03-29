# Release Notes — MAERMIN v7.2

**Datum:** März 2026  
**Typ:** Feature Release + Bereinigung  
**Kompatibilität:** Bestehende `localStorage`-Daten werden vollständig übernommen

---

## Highlights

MAERMIN ist jetzt eine vollständige **Web-App auf GitHub Pages** — keine Installation, kein Electron, kein Node.js erforderlich. Einfach URL aufrufen, Passwort eingeben, loslegen.

Diese Version konsolidiert alle Features aus v7.0 und v7.1, entfernt irreführende Inhalte (hardcodierte Fake-Daten) und strukturiert die Navigation grundlegend neu.

---

## Neu in v7.2

### Navigation komplett überarbeitet

Die bisherige flache Liste mit 13 gleichwertigen Punkten wurde durch eine **3-Gruppen-Struktur** ersetzt, die sich an modernen Finance-Tools wie Parqet und Linear orientiert:

- **Portfolio** — Übersicht, Transaktionen, Dividenden, Journal
- **Analyse** — Rendite, Rebalancing, Portfolio-Analyse, Strategie, Steuern
- **Tools** — Watchlist, Preisalarme, Broker-Import

Aktive Elemente werden mit einem Akzent-Balken links markiert statt mit einem Vollfarb-Block — ruhiger, klarer lesbar.

### Analytics als Tab-View

Die Portfolio-Analyse (Korrelation, Monte Carlo, Stress-Test, Risiko) öffnet sich nicht mehr auf einer separaten Menü-Seite. Stattdessen wechseln Tabs direkt innerhalb einer View — eine Klick weniger für jeden Analyseschritt.

### Bereinigungen

Folgende Inhalte wurden **vollständig entfernt**:

| Entfernt | Grund |
|----------|-------|
| `EconomicIndicatorView` | Zeigte hardcodierte Daten von 2023 (CPI 3.4%, VIX 16.5) — irreführend |
| `OptionsTrackerView` | Black-Scholes-Rechner ohne Bezug zu echten Portfolio-Positionen |
| `DividendTrackerView` (alt) | Duplikat des neuen Dividenden-Kalenders |
| `TaxPlanningView` in Analyse | Duplikat der Haupt-Steuer-View |
| `renderPortfolioView` | Vollständig redundant — die Übersicht zeigt alles besser |
| Workspace-System | Rein kosmetisches Label ohne echte Funktion |
| 19 redundante Command-Palette-Einträge | Von 40 auf 22 sinnvolle Einträge reduziert |
| 4 separate Analytics-Einzelrouten | Jetzt als Tabs in einer View |

---

## Neu in v7.1

### XIRR / Time-Weighted Return

Die neue Rendite-Ansicht berechnet auf Basis echter Transaktions-Cashflows:

- **XIRR** (Money-Weighted Return, annualisiert) — berücksichtigt Zeitpunkt und Größe jeder Ein-/Auszahlung
- **TWR** (Time-Weighted Return) — Portfolioentwicklung unabhängig von Cashflows, berechnet aus gespeicherter Preis-History
- Gesamtrendite in EUR, Haltedauer, Gebührenübersicht

### Rebalancing-Tool

- Ziel-Allokation pro Kategorie per Slider einstellbar (Crypto / Aktien / CS2)
- Zeigt für jede Kategorie exakt welchen Betrag kaufen oder verkaufen
- Optionale Simulation: "Was wenn ich X EUR zusätzlich investiere?"
- Ziel-Allokation wird persistent im Browser gespeichert

### Broker-Import-Wizard

Ein geführter 4-Schritte-Prozess für CSV-Importe:

1. Broker auswählen (DEGIRO, Trade Republic, Interactive Brokers, Coinbase, Binance, Kraken, Generisch)
2. CSV per Drag & Drop oder Dateiauswahl laden
3. Vorschau der erkannten Transaktionen (bis zu 20 angezeigt)
4. Import bestätigen

Nutzt die vorhandene `import-export-engine.js` mit automatischer Broker-Erkennung.

### Trade-Journal

Pro Position lassen sich Notizen speichern:

- Investitionsthese, Zielkurs, Risiken, Strategie
- Zuletzt bearbeitet Datum wird angezeigt
- Persistent im `localStorage` unter `maermin_notes`

### Dividenden-Kalender

- Kalenderansicht mit eingetragenen Dividendenzahlungen
- Monats- und Jahressummen
- Liste der nächsten anstehenden Zahlungen
- Persistent im `localStorage` unter `maermin_divevents`

### Mobile-Navigation

Unter 768px Bildschirmbreite:

- Desktop-Sidebar wird automatisch ausgeblendet
- Bottom-Navigation mit 5 wichtigsten Views erscheint am unteren Bildschirmrand
- Kein `@media`-CSS in bestehenden Dateien nötig — wird dynamisch injiziert

---

## Neu in v7.0

### GitHub Pages Deploy

- Vollständige Konvertierung von Electron-Desktop-App zur Web-App
- GitHub Actions Workflow für automatischen Deploy bei Push
- `.nojekyll` verhindert Jekyll-Verarbeitung der JS-Dateien

### Shared-Secret Login

- SHA-256-basiertes Passwort-System, kein Server nötig
- Session läuft nach 8 Stunden ab
- Passwort-Ändern direkt in der App möglich (neuen Hash generieren und in `auth.js` eintragen)
- Standard-Passwort: `maermin2024`

### Donut-Chart & Allocation

- Interaktiver Donut-Chart mit Hover-Highlight
- Tabs: Gesamtansicht, Crypto, Aktien, CS2
- Legende mit Prozentanteilen

### Sparklines

- Mini-Trendlinien (letzte 20 Preise) auf jeder Position
- Grün = aufwärts, Rot = abwärts

### Gainers / Losers

- Top 3 Gewinner und Verlierer direkt auf der Übersicht
- Mit Sparkline und Prozentangabe

### Performance-Chart

- SVG-Chart der Portfolio-Gesamtwert-Entwicklung über Zeit
- Nutzt gespeicherte `priceHistory`-Daten
- Gesamtrendite und Prozentänderung im Header

### Sortierbare Positions-Tabelle

- Klickbare Spaltenköpfe (Wert, P&L, Symbol, Preis, Trend)
- Kategorie-Filter (Alle, Crypto, Aktien, CS2)
- P&L-Balken und Portfolio-Anteil-Balken pro Zeile

### Watchlist

- Symbole beobachten ohne Kauf
- Optional: Target-Price einstellen (wird grün markiert wenn erreicht)
- Sparkline aus gespeicherter Preis-History
- Persistent im `localStorage` unter `maermin_watchlist`

### Preisalarme

- Alarm wenn Preis über oder unter einen Schwellenwert fällt
- Fortschrittsbalken zeigt wie nah die aktuelle Position am Ziel ist
- Toast-Benachrichtigung wenn Alarm auslöst
- Alarm kann zurückgesetzt werden
- Persistent im `localStorage` unter `maermin_alerts`

---

## Bug-Fixes (akkumuliert)

- `body overflow: hidden` entfernt — Scrolling im Browser funktioniert korrekt
- `Portfolio maxHeight: 400px` hardcodiert — entfernt
- Total im Transaction-Modal wurde unformatiert angezeigt — `.toFixed(2)` ergänzt
- SHA-256-Hash für Standard-Passwort war falsch berechnet — korrigiert
- Settings-Dropdown schloss nicht bei Klick außerhalb — `useRef` + `mousedown`-Listener ergänzt
- `window.confirm()` für Transaktions-Löschen — durch Inline-Bestätigung ersetzt
- `images`-, `alerts`-, `showBackupModal`-States existierten aber wurden nie genutzt — entfernt
- `analytics:correlation`, `analytics:montecarlo`, etc. als separate URL-Routen — in Tab-View konsolidiert

---

## Breaking Changes

Keine. Bestehende `localStorage`-Daten (Transaktionen, Einstellungen, Watchlist, Alerts) werden vollständig übernommen.

Das Backup-Format aus v6.x wird beim Import automatisch in das neue Transaktions-Format konvertiert.

---

## Bekannte Einschränkungen

- **XIRR / TWR** benötigen Preis-History-Daten. Diese entstehen erst nach mehrmaligem "Preise aktualisieren" über mehrere Tage.
- **Alpha Vantage** (Aktien) ist auf 25 Requests/Tag im kostenlosen Tier limitiert. Bei mehr als 5 Aktien-Positionen werden pro Refresh nur 5 Symbole abgefragt.
- **Skinport** (CS2) gibt nur Preise für genau übereinstimmende Item-Namen zurück. Der vollständige Market-Hash-Name muss beim Eintragen verwendet werden.

---

## Upgrade von v6.x

1. Alle Dateien aus dem neuen Release in den Projektordner kopieren
2. `git add . && git commit -m "Upgrade to v7.2" && git push`
3. GitHub Pages → Settings → Pages → Source: **GitHub Actions** aktivieren (einmalig)

Lokale Daten bleiben vollständig erhalten — kein Daten-Export nötig.
