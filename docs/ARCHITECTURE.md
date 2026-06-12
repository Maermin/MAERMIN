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
| `crypto-vault.js` | `MaerminVault` | AES-256-GCM; PBKDF2-600k or Argon2id KDF; wrap-check (no password stored); HKDF sub-keys; idle auto-lock; WebAuthn-PRF passkeys; **printable recovery-code kit** — a second wrapping of the vault key (`enrollRecovery`/`unlockWithRecovery`), the code is shown once and never stored/transmitted |
| `storage.js` | `MaerminStorage` | Transparent encryption-at-rest shim over `localStorage` for a fixed set of sensitive keys; reversible plaintext backup; portable **encrypted** backup export/import |
| `auth.js` | `MaerminAuth` | Setup / unlock / lock UI; mount gate; change-password; one-time recovery-code reveal at setup + recovery-code unlock path |
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
| `portfolio-analytics.js` | `MaerminAnalytics` | Pure quant fed return series: benchmarks (α/β/Tracking Error/Information Ratio/R²), simulator (future value/FIRE/withdrawal/Monte-Carlo success), risk (max drawdown/rolling vol/Fama-French OLS) |
| `analytics-data.js` | `MaerminAnalyticsData` | Bridge: builds a portfolio value path + aligned period returns from built positions + per-symbol `priceHistory` (incl. N-series `alignReturns`/`subtract` for factor construction), the inputs `MaerminAnalytics` expects |
| `etf-lookthrough.js` | `MaerminLookThrough` | ETF/fund X-Ray: pure `analyze()` over position rows + per-fund holdings → effective per-security exposure, sector/country/currency look-through, fund-overlap pairs, hidden concentrations. Holdings come from the Worker `fundholdings` route via the shared, session-cached `loadFundData` loader (injectable fetch), merged with a static snapshot of common ETFs (graceful degradation) |
| `cost-analysis.js` | `MaerminCostAnalysis` | Ongoing costs (TER): pure `buildFundRows`/`computeOngoingCosts`/`projectCostDrag` → annual EUR cost per fund, total drag p.a., weighted average TER, multi-year cumulative cost-drag projection. TER from the same `loadFundData` plumbing (override > worker > snapshot); manual overrides in `localStorage` (symbols + ratios only, not sensitive) |

---

## UI

`renderer.js` holds the `InvestmentTracker` component: all state, the nav, the
view router (`renderView()` switch), and a `ViewErrorBoundary` so a single view
crash shows a recoverable fallback instead of a blank app. Feature views live in
`features.js … features7.js` and `investment-views.js`, rendered by passing
already-computed numbers down as props (no view computes cross-cutting metrics
itself — it reuses `MaerminMetrics`).

**First-run onboarding** (`onboarding.js` → `MaerminOnboarding`) is a view-layer
module with a React `Wizard` plus dual-exported pure logic: `endpoints()` builds a
cheap probe per data source, `classify()` maps each probe outcome to green/amber/red,
and `probe()`/`probeAll()` run them with an injectable `fetch` (so the connection test
is unit-tested under Node). The wizard offers a guided Worker deploy (one-click *Copy
worker.js*), the live connection test, and a Demo-mode entry; `renderer.js` opens it on
first run and from API Settings, and surfaces a recovery-code nudge for vaults created
before recovery codes existed.

**Analytics fold-in** (no new tabs): the `MaerminAnalytics` engine is surfaced through
thin view modules — `simulator-view.js` (`MaerminSimulatorView`, Future Value/FIRE/
Withdrawal/Monte-Carlo) folds into the **Monte-Carlo** analytics tab, and
`analytics-views.js` (`MaerminAnalyticsViews`) adds a **benchmark overlay** (α/β/TE/IR/R²,
fetching a proxy via the worker `yf` endpoint) to the **Returns** view plus a **rolling
volatility/return** panel and a **Fama-French factor-exposure** panel (MKT/SMB/HML loadings
+ annualised alpha, regressing the portfolio on ETF-proxy factor returns — VTI; IWM−IWB;
IWD−IWF — over the same `yf` endpoint) to the **Risk** view. The proxy/diff alignment is
pure and unit-tested (`MaerminAnalyticsData.alignReturns`/`subtract`); the engine's
`factorExposure` OLS stays the single source of truth. The AI advisor's findings
(`advisor.js` → `MaerminAdvisor.Panel`) fold into the **Health** view.

**ETF look-through (X-Ray)** (`etf-lookthrough.js` → `MaerminLookThrough`) folds into
two existing views (no new tab): the **Health** view gets effective per-security
exposure (direct + through funds) plus sector/country/currency look-through, and the
**Risk** view gets fund-overlap pairs + hidden concentration findings (`Panel` with
`mode: 'overview' | 'risk'`). The whole computation (`analyze`) and the data plumbing
(`parseHoldingsResponse`, `mergeFundData`, `fallbackHoldings`, `positionRows`) are
pure and Node-tested; the Panel is a thin fetch shell over the Worker's
`action=fundholdings` route, gated exactly like Discovery — an older Worker (400/404)
triggers an upgrade note while a built-in approximate snapshot of common index ETFs
keeps the feature useful. The Health panel hands its result up so
`MaerminAdvisor.analyzeFromMetrics` can rank hidden fund concentrations alongside its
other findings (`bundle.lookThrough`). Nothing is persisted (no new `SENSITIVE_KEYS`).

**Ongoing costs (TER)** (`cost-analysis.js` → `MaerminCostAnalysis.OngoingCostsPanel`)
folds into the **Fee Analyzer** view below the transaction-fee breakdown (no new tab):
annual EUR cost per fund position, total ongoing drag p.a., weighted average TER, and a
multi-year projection of the cumulative cost drag, plus an inline manual TER override
per fund. It reuses the X-Ray's `loadFundData` loader (same gating/degradation), so
there is exactly one fund-data pipeline; only the override map (symbol → expense ratio,
no amounts) is persisted in `localStorage` and is not sensitive. All consume
`MaerminAnalyticsData` for series construction, so no view recomputes quant. A
**Security & Sync** settings modal (in `renderer.js`) exposes `MaerminAuth.getStatus()`
(encryption-at-rest, KDF, auto-lock, passkey, recovery code) and `MaerminSync`
(zero-knowledge cloud sync) status + actions.

**Asset Discovery** (`discovery.js` → `MaerminDiscovery`) is the one sanctioned *new*
surface (Roadmap P5) — a read-only screener for ETFs/stocks/crypto, top movers, and a
dividend screener, reached from the **Tools** nav. The Worker is the single data source:
a new `action=screener` endpoint proxies + normalises Yahoo Finance in two modes —
`scrId=` (predefined screener / movers) and `symbols=` (batch quote, used for the curated
dividend universe). Everything testable without a browser — `parseResponse`, EUR
conversion at ingestion (`toEURRow`, reusing `MaerminUtils.toEUR`), `applyFilters`,
`sortRows`, `dividendScreen`, `buildUrl` — is pure and Node-tested; the React `View` is a
thin shell over them. It is fully gated: with no Worker URL, or against a Worker that
predates the endpoint (400/404), it shows a clear upgrade note instead of breaking. No
data is persisted and nothing sensitive is sent, so it adds no `SENSITIVE_KEYS`.

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
