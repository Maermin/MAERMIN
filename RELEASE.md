# Release Notes

## [Unreleased] — v10.x

> UI fold-in of the v10 engines + accessibility themes + a code-review hardening pass. No data migration; backup format unchanged.

### Review pass — fixes, optimisations & features

**Fixes**
- Removed two duplicate object keys the compiler flagged (a dead `cardBorder` in a stale theme map, a repeated `NESN.SW` entry). The build is now warning-clean.
- Deleted the unused, out-of-sync second theme map in `renderer-components.js` (one source of theme truth).

**Optimisations**
- Snapshot recording is now throttled: it skips the localStorage write when today's (rounded) value is unchanged, instead of writing on every price poll.
- Consolidated the position price-lookup into one shared `MaerminTags.pricedPositions` helper (was re-implemented inline in three places).
- Accessibility: tag chips are real `<button>`s now (keyboard-focusable, `aria-label`).

**New — snapshot analytics (Performance view)**
- **Benchmark comparison**: portfolio vs an index (MSCI World / S&P 500 / …) per period (1M/3M/6M/1Y) with relative out/underperformance in pp. Reuses the existing Worker proxy; shows a note when no Worker URL is set.
- **Drawdown / underwater chart**: max drawdown, current drawdown, recovery status and an underwater area, all derived from the snapshot series.
- **Goal projection**: each goal in `investmentGoals` gets a progress bar + ETA date, projected from your **realised snapshot CAGR** plus the goal's monthly contribution.

**New — corporate actions (stock & reverse splits)**
- **Splits now adjust holdings** — a recorded N:M split scales every buy/sell lot before its effective date (`quantity → quantity × N/M`, `price → price × M/N`), keeping the cash amount and cost basis constant, so position value, P&L, CAGR, the value chart and FIFO all stay correct across a split. Engine: `corporate-actions.js` (`MaerminCorporateActions`), pure math unit-tested in `test/corporate-actions.test.js`.
- **Centralised overlay, zero per-view wiring** — applied once at the top of `MaerminMetrics.buildPositions` and the tax FIFO (`tax-report-builder.js`). `adjust()` is the identity until a user records a split, so there is no behaviour change for existing data.
- **Manual entry + best-effort auto-detect** — add a split per holding (ratio New:Old) in the position detail modal, or "Scan for splits" via the Worker (`?action=yf` now surfaces a `splits` array; degrades gracefully against an older Worker — falls back to manual). A global list lives in Settings.
- New store `maermin_corporate_actions`, carried in the full-vault backup. Out of scope for v1 (data model leaves room): spin-offs, mergers, symbol/ISIN changes.

**New**
- **Automation Rules → live notifications**: a triggered rule now fires a toast + desktop notification (via the existing PWA plumbing), deduped per rule and re-armed when it relaxes — not just shown in the Rules view.
- **Tag performance over time**: a per-tag value series is recorded, and each tag now shows its ~30-day change in the Tags view.
- **Custom categories in by-class analytics**: rebalancing-drift, currency-exposure and tax-loss harvest now include custom categories (not just the four base classes).
- **German UI (`de` locale) + language switcher**: English base with German overrides (missing keys fall back to English); selectable in Settings, persisted (`maermin_language`, in backup). Coverage is the high-traffic strings; more Germanises as hardcoded literals migrate to `t.*`.
- Rebalancing view links across to the Tags view for tag-based targets.

- **Performance view** *(new)* — snapshot-powered 1D/1W/1M/3M/6M/YTD/1Y/Max return cards + best/worst day, derived entirely from the on-device value history (no API). Analytics hub · `g f`.
- **Tags view** *(new)* — create/assign/remove Smart Tags, see per-tag value & weight, and set **tag-basis target weights** with live buy/sell drift (powered by `MaerminRebalance`). Discover & Tools hub · `g s`.
- **Alerts & Rules view** *(new)* — local "warn me when…" rules on concentration (symbol/category/tag weight), drawdown (drop from peak) and total value, evaluated instantly against the live portfolio with a triggered/OK indicator. Persisted (`maermin_rules`, in backup). Tools hub · `g u`.
- **Watchlist notes & distance-to-target** — each watch item gains an optional thesis note and a signed `±% to go / above` readout next to its target price. Backward-compatible (carried in the existing watchlist backup key).
- **Custom Asset Categories** *(new)* — define your own categories (Real Estate, P2P, Collectibles…) with a colour; they appear in the Add-Transaction picker and are **priced & counted in your totals** (the shared `metrics.js` aggregation is now category-aware instead of dropping unknown categories). Managed in the **Categories** view (Tools · `g c`), persisted (`maermin_custom_categories`, in backup). Custom categories now also show in the **allocation donut + legend**.
- **Customize Overview** *(new)* — a **Customize Overview** view (Tools · `g y`) lets you show/hide the three main Overview sections (Value chart · Stat cards · Allocation/Performers/Positions); persisted in your backup. Powered by `MaerminDashboard`.
- **Accessibility themes** *(new)* — **High Contrast** (pure-black, heavy borders) and **Colour-Blind Safe** (Okabe–Ito: gains = blue, losses = orange, never red/green). Selectable in the theme switcher and command palette; gain/loss colours remap app-wide because they flow from the theme tokens.
- Both new views are isolated `View` components inside their engine modules, wired into `renderer.js` via the standard 4 touchpoints (palette item, dispatch, `renderView`, sidebar) — a view error degrades to a notice instead of crashing the app.
- The existing category `RebalancingView` is unchanged (no duplicate); the Dashboard-Layout Overview consumption is deferred (tightly-coupled Overview).

---

## [v10.0.0] — June 2026

> **Major release** · New UI · Fully backward compatible · Backup format unchanged (round-trips v9 backups)

### Highlights

- **New dark-fintech UI** — redesigned typography (Hanken Grotesk · Space Grotesk · JetBrains Mono), a soft radial-wash background, and refreshed chrome across the app.
- **Portfolio Value Snapshots** *(new)* — an on-device, append-only history of your total value. It is recorded daily from the value you actually saw, so the curve survives price-API outages and offline days. Pure engine `window.MaerminSnapshots` (`portfolio-snapshots.js`).
- **Smart Tags / Labels** *(new)* — user-defined, cross-cutting labels on symbols ("high-conviction", "dividend", "speculative", …) that are orthogonal to asset class, with per-tag value & weight rollups. Engine `window.MaerminTags` (`tags.js`).
- **Custom Dashboard Layout** *(new)* — reorder and hide Overview cards; the layout reconciles safely against whatever widgets a build ships. Engine `window.MaerminDashboard` (`dashboard-layout.js`).
- **Portfolio Intelligence** — structural-problem detection (delivered in the v10 line) surfaced under Discover & Tools.

### Backup & Data

- The full-vault backup now also carries the three new feature stores: `maermin_snapshots`, `maermin_tags`, `maermin_dashboard_layout`. As always, secrets (`apiKeys`) are never written to the plain-text backup, and a restore only writes whitelisted keys.
- Backup `version` stamped `10.0.0`; older backups still restore (keys absent from a backup are left untouched).
- New on-device data only — no schema migration required.

### Engineering

- Three new pure dual-export IIFE modules with headless Node tests (`test/portfolio-snapshots.test.js`, `test/tags.test.js`, `test/dashboard-layout.test.js`) — same "integrate, don't accrete" pattern as the rest of the codebase.
- Snapshot recording is a single best-effort top-level effect in `renderer.js` (never throws into a render); it reuses the Overview's value aggregation.
- Service-worker cache bumped to `maermin-v4` so existing installs pull the new UI and modules.
- All version strings moved to **v10.0** (package.json, index.html, build, features modules, Electron main, README).

---

## [v9.0.0] — March 2026

> **Major release** · Fully backward compatible · Update your Cloudflare Worker

### Highlights

- **Real historical portfolio chart** — time-accurate value curve, buys/sells show as actual jumps
- **Symbol Picker** — visual stock and crypto search with logos, eliminates all YF symbol errors
- **P&L calculation fixed** — fundamental bug where sells inflated average buy price (NVO -71% → correct)
- **Overview shows all portfolios** — combined stats across all portfolios, not just the active one
- **Yahoo Finance as primary** — replaces Alpha Vantage everywhere, AV demoted to fallback

---

### Data & Calculations

#### Bug Fixes

- **Critical: P&L inflated after sells** — selling a position reduced `amount` but left `totalCostEUR` unchanged, making the average buy price 2× too high after a 50% sell. Sells now reduce cost basis proportionally (`fraction = qty / currentAmount`).
  - *Example: NVO showing -71% instead of the correct ~+2%*
- **`(amount || 1)` phantom value** — zero-amount positions were multiplied by 1 instead of 0, adding ghost value to the portfolio total. Fixed to `(amount || 0)`.
- **PerformancePeriods wrong periods** — `jan1` and `cutoff` were ISO strings being compared to Unix timestamps (numbers). JavaScript string-vs-number comparison silently failed. Fixed to compare all values as Unix seconds.

---

### Historical Portfolio Chart

#### New Features

- **Time-accurate amounts via `amountAt(ts)`** — for each timestamp in the chart, the function replays all buy/sell transactions up to that point to compute how many units were actually held. Previously the chart used the current total for all historical points, making second buys invisible.
- **Transaction timestamps as chart points** — buy and sell dates are explicitly added to the timeline, plus a point 60 seconds later. This ensures the step-change is rendered as a sharp jump rather than being interpolated between distant data points.
- **CS2 price history via Steam** — `?action=steamhistory` endpoint in the Worker. Falls back to current price from `priceoverview` when Steam rejects unauthenticated history requests (400).
- **Chart anchored to live price** — the last data point is replaced with `allPortfoliosStats.totalValue` (the same number shown in the stats cards). Stats and chart can no longer show different values.

#### Improvements

- Period selector: all 8 periods (1H · 1D · 1W · 1M · 1Y · 3Y · 5Y · Max) use correct Unix timestamp cutoffs
- Alpha Vantage demoted to fallback — only queried if Yahoo Finance returns no data for a symbol
- Chart header now shows **period performance** prominently (`+2.3%  +450 EUR in the last 1M`) instead of duplicating the current value already shown in the stats cards

---

### Symbol Picker

#### New Features

- **Stock/ETF search** — `?action=yfsearch&q=...&type=stock` via Worker → Yahoo Finance search API. Results include company logo, exchange (NASDAQ / XETRA / London...), and the exact Yahoo Finance symbol (e.g. `SIX2.DE`).
- **Crypto search** — direct CoinGecko `/search` API. Results include coin logo from CoinGecko CDN, market cap rank, and the CoinGecko ID used for all price fetching.
- **Exact symbol saved to transaction** — `symbol`, `symbolName`, and `symbolLogoUrl` are all persisted. Price refreshes use `symbol` directly without any manual mapping table.
- **Letter avatar fallback** — a coloured initial-based avatar is always rendered as a base layer under the logo image. When the logo fails to load, the avatar shows instead of a broken image icon.

#### Bug Fixes

- **`onError` null crash** — the `onError` handler for logo images was calling `e.target.parentNode.innerHTML = ...`. When React unmounted the component during loading, `parentNode` was null, causing an uncaught `TypeError`. Fixed to `if (e.target) e.target.style.display = 'none'`.
- **Parqet logos 404** — `assets.parqet.com` (a competitor) was used as the stock logo CDN. It returned 404 for most non-US symbols. Replaced with Yahoo Finance brand CDN (`s.yimg.com/lb/brands/150x150/`).
- **Crypto in stock search** — `CRYPTOCURRENCY` type results were appearing in the stock search. Fixed at both the Worker level (`type=stock` filter) and the client level (`.filter(r => r.type !== 'CRYPTOCURRENCY')`).
- **Tokenized stocks in crypto search** — `TSLAX` (Tesla xStock), `TSLAON` (Tesla Ondo Tokenized Stock), and stablecoins were appearing in CoinGecko crypto results. Filtered by name pattern and known stablecoin symbols.

---

### Overview & Portfolio

#### New Features

- **`allPortfoliosStats`** — a new `useMemo` that computes total value, invested, and P&L across *all* transactions regardless of portfolio ID. The Overview stats cards use this instead of the active-portfolio-only `portfolioStats`.
- **Portfolio breakdown bar** — when multiple portfolios exist, the Overview shows a row of clickable portfolio tabs with individual value per portfolio and a "Manage →" link to the Portfolios view.

#### Bug Fixes

- **Overview showed only active portfolio** — `portfolioStats` was derived from `activeTransactions` (filtered by `activePortfolioId`). Overview now uses `allPortfoliosStats` (all transactions).
- **Sells didn't reduce cost basis** — see P&L section above.

---

### UI & Navigation

#### Improvements

- **Compact action buttons** — Overview header now has `+ Add`, `↑ Import`, `↻ Refresh prices` in a single compact row instead of five large equally-weighted buttons
- **Sidebar hover states** — nav items now show a subtle accent highlight on hover with smooth transition. Previously there was no visual feedback until clicking.
- **Chart header simplified** — shows period performance (`±%`) prominently; current value is not duplicated since it already appears in the stats cards above

#### Removed / Cleaned Up

- **Duplicate `PortfolioOverviewPanel`** — the donut chart + gainers/losers panel was rendered twice in `renderOverview`. Removed the first (incorrectly positioned) instance.
- **Dead `!window.MaerminFeatures` fallback** — a 53-line block that rendered a basic position list "in case features.js didn't load" was removed. `features.js` always loads.
- **Duplicate `case 'taxes'`** — identical to `case 'tax'`, removed.
- **Old Quick Actions row** — five large buttons (`Add Transaction`, `Import Data`, `Refresh`, `Analytics`, `API Settings`) were removed from the Overview body. All actions are accessible from the header or sidebar.

---

### Cloudflare Worker

#### New Endpoints

- **`GET /?action=yfsearch&q=...&type=stock|crypto`** — Yahoo Finance symbol search with strict type filtering. `type=stock` never returns crypto; cache keys are scoped per type.
- **`GET /?action=steamhistory&name=...`** — Steam Market price history. Tries `pricehistory` first (requires auth); falls back to `priceoverview` (public) and returns a flat line at current price. Returns HTTP 200 with `{ prices: [] }` instead of propagating Steam's 400 — eliminates the console spam.

---

### Price Fetching

#### Improvements

- **Yahoo Finance is now the primary source for stocks** — queried first via Worker (`?action=yf`). If the symbol already contains an exchange suffix (`.DE`, `.L`, `.AS` etc.), it is used as-is. The legacy `YF_MAP` only applies to bare symbols entered before the Symbol Picker was available.
- **Dividends auto-fetch** — tries Yahoo Finance chart meta (`dividendRate`, `exDividendDate`) first. Falls back to Alpha Vantage `OVERVIEW` endpoint only if YF has no dividend data.
- **Button renamed** — "↓ Auto-fetch from Alpha Vantage" → "↓ Auto-fetch dividends" (source-agnostic)

---

### Upgrading from v8.x

> All existing `localStorage` data is preserved. No migration script needed.

**Required:**
1. Update your Cloudflare Worker — paste `cf-worker/worker.js` into your existing Worker, click **Save and Deploy**. This adds `yfsearch`, fixes `steamhistory`, and improves caching.

**Recommended:**
2. Re-enter stock positions using the Symbol Picker (⊕ Add Transaction → Stocks → search) to store the exact Yahoo Finance symbol on each transaction. Old bare symbols (`AAPL`, `SIX2`) continue to work through the legacy map but the Picker ensures perfect accuracy going forward.

---

## [v8.3.0] — February 2026

- Real historical portfolio chart v1 (Alpha Vantage primary)
- CS2 Steam Market price history endpoint
- Multi-portfolio support with portfolio switcher

## [v8.2.0] — February 2026

- Net Worth Dashboard (cash, real estate, liabilities)
- Fee Analyzer (total fees, by year, by asset class)
- Performance period selector (1D / 1W / 1M / YTD / 1Y / Max)
- Cashflow Chart (invested vs portfolio value)

## [v8.1.0] — January 2026

- XIRR / TWR from real cash flows
- Rebalancing tool with target allocation sliders
- Savings Plans tracker
- Dividend Forecast (12-month projection)
- FIFO Cost Basis (German tax compliance)

## [v8.0.0] — January 2026

- Full rewrite as web app — no Electron, no Node.js required
- Hosted on GitHub Pages
- Multi-asset support: Crypto, Stocks, CS2 Skins, Commodities
- Cloudflare Worker for CORS proxy (Steam + Alpha Vantage)
- Command Palette (`Ctrl+K`)
- Dark / Light / Purple themes
