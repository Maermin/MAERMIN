# MAERMIN — Architecture

MAERMIN is a **fully client-side** multi-asset portfolio tracker. It ships two
ways from the same source:

- **Web** (GitHub Pages / any static host) — `index.html` loads plain global
  scripts; `build.mjs` concatenates + minifies them into `dist/`.
- **Desktop** (Electron) — `main.js` + `preload.js` wrap the same UI.

There is **no backend and no database**. State lives in the browser's
`localStorage`; an optional Cloudflare Worker only proxies market data and an
opt-in, zero-knowledge encrypted sync blob.

---

## Module pattern

Every module is a self-contained IIFE that attaches a single global:

```js
(function () {
  'use strict';
  /* ... */
  var api = { /* ... */ };
  if (typeof window !== 'undefined') window.MaerminX = api;     // browser
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node tests
})();
```

This dual export is what lets the pure logic be unit-tested under Node
(`test/*.test.js`) without a browser or bundler. UI is built with **React 18 via
CDN using `React.createElement` (no JSX, no TypeScript)**.

Scripts load in a fixed order in `index.html`; `build.mjs` reads that order, so
**adding a module = adding one `<script>` tag** (and it's automatically bundled).

---

## Load order (security first)

```
audit-log.js → crypto-vault.js → storage.js → migrations.js → auth.js
            → utils / engines → dividend / metadata → views (features*) → renderer.js
```

`auth.js` gates the React mount: `renderer.js` awaits `MaerminAuth.whenUnlocked()`
before rendering, so the app always reads decrypted data. Schema migrations run
at mount (post-unlock) via `MaerminMigrations.run()`.

---

## Security layer

| Module | Global | Responsibility |
|--------|--------|----------------|
| `crypto-vault.js` | `MaerminVault` | AES-256-GCM; PBKDF2-600k or Argon2id KDF; wrap-check (no password stored); HKDF sub-keys; idle auto-lock; WebAuthn-PRF passkeys |
| `storage.js` | `MaerminStorage` | Transparent encryption-at-rest shim over `localStorage` for a fixed set of sensitive keys; reversible plaintext backup; portable **encrypted** backup export/import |
| `auth.js` | `MaerminAuth` | Setup / unlock / lock UI; mount gate; change-password |
| `audit-log.js` | `MaerminAuditLog` | On-device event + error trail (non-sensitive, ring-buffered) |
| `migrations.js` | `MaerminMigrations` | Versioned, idempotent localStorage migrations |

---

## Domain / data model

Transactions are the source of truth:

```
transaction = { id, type(buy|sell|dividend|interest|…), category(crypto|stocks|skins|commodities),
                symbol, symbolName?, quantity, price, fees?, currency(EUR|USD), date, portfolioId, notes? }
```

Everything else is **derived** from transactions (single source of truth in
`metrics.js`):

- `MaerminMetrics.buildPositions(transactions, {exchangeRate})` → grouped
  `{crypto,stocks,skins,commodities}` with EUR cost basis (USD converted, sells
  reduce basis proportionally).
- `MaerminMetrics.computeStats(portfolio, prices)` → value / invested / P&L.
- Net worth, FIRE, concentration, drift, currency exposure, tax-loss harvest.

The canonical internal currency is **EUR**; USD inputs (CS2 skins, some stocks)
are converted via the live `USD→EUR` rate (`MaerminUtils.toEUR`). Display
conversion happens only at format time (`formatPrice`).

### Engines

| Module | Global | Purpose |
|--------|--------|---------|
| `ticker-validation.js` | `MaerminTickers` | Normalise symbols (e.g. `BRK.B`→`BRK-B`, keep `SAP.DE`) |
| `equity-metadata.js` | `MaerminEquityMeta` | Sector/country per ticker (FMP API + cache + static map) |
| `dividend-data-service.js` | `DividendDataService` | Dividend data, FIFO forecast, calendar |
| `tax-report-builder.js` | `MaerminTaxReport` | Per-lot FIFO tax report + PDF/Excel |
| `allocation.js` | `MaerminAllocation` | Asset-class allocation + drill-down |
| `projection.js` | `MaerminProjection` | Multi-scenario wealth projection |
| `recurring.js` | `MaerminRecurring` | Recurring liabilities (loans/mortgages) |

---

## UI

`renderer.js` holds the `InvestmentTracker` component: all state, the nav, the
view router (`renderView()` switch), and a `ViewErrorBoundary` so a single view
crash shows a recoverable fallback instead of a blank app. Feature views live in
`features.js … features7.js` and `investment-views.js`, rendered by passing
already-computed numbers down as props (no view computes cross-cutting metrics
itself — it reuses `MaerminMetrics`).

---

## Build & test

- `npm run build:web` — `build.mjs` reads `index.html`, concatenates local
  scripts in order, minifies with esbuild, emits `dist/` (+ PWA assets). CDN
  scripts keep their SRI hashes.
- `npm test` — `test/run-all.mjs` runs every `test/*.test.js` in a child process
  and fails on any non-zero exit. Tests exercise the **real** modules via the
  Node export, with minimal DOM/crypto stubs.
- `npm run check` — `node --check` on every JS file (fast syntax gate).

CI (`.github/workflows/node.js.yml`) runs `build:web` + `test` on Node 18/20/22.

---

## Design rules (V7)

1. **Integrate, don't accrete** — extend existing views/cards/charts; avoid new
   tabs/engines. One metrics service, one allocation engine, etc.
2. **Pure logic is testable** — keep calculations in dual-export modules with
   unit tests; keep `React.createElement` UI thin.
3. **Security by default** — sensitive data encrypted at rest; password never
   stored; no remote telemetry.
