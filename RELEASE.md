# Release Notes

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
