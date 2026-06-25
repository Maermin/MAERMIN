<div align="center">

# MAERMIN

**Professional Multi-Asset Portfolio Tracker**

Crypto · Stocks · ETFs · CS2 Skins · Commodities

[![Live Demo](https://img.shields.io/badge/Live%20Demo-maermin.github.io-8b5cf6?style=for-the-badge&logo=github&logoColor=white)](https://maermin.github.io/MAERMIN/)
[![Version](https://img.shields.io/badge/Version-10.0.0-3b82f6?style=for-the-badge)](#changelog)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)
[![No Account](https://img.shields.io/badge/No%20Account-Required-f59e0b?style=for-the-badge)](#)
[![No Server](https://img.shields.io/badge/No%20Server-100%25%20Local-22c55e?style=for-the-badge)](#)

<br>

> **All your assets in one place. Runs entirely in your browser. Zero signup. Zero tracking.**

</div>

---

## What is MAERMIN?

MAERMIN is a **fully client-side** investment tracker that runs in your browser with no installation. All data is stored in your browser's `localStorage` — it never leaves your device. Access is protected by an **encrypted vault**: an access password derives an AES-256-GCM key (PBKDF2-600k, or Argon2id when available) via `crypto-vault.js`; the password is never stored, and sensitive data can be encrypted at rest. Optional passkey unlock (WebAuthn) and an idle auto-lock are built in.

Built with React (via CDN) and vanilla JavaScript. No build step required for development, no framework to install. Works offline after the first load (PWA). A local audit log records security events and uncaught errors on-device.

```
No account  ·  No server  ·  No ads  ·  No remote telemetry  ·  MIT License
```

> Privacy note: there is **no remote telemetry**. The on-device "Security log" (Settings → Security log) stays in your browser and is never transmitted.

---

## Features

### Portfolio
| Feature | Description |
|---------|-------------|
| **Overview** | Stats cards showing all portfolios combined — total value, invested, return, positions |
| **Portfolio History Chart** | Real historical data from Yahoo Finance · CoinGecko · Steam — 1H · 1D · 1W · 1M · 1Y · 3Y · 5Y · Max |
| **Symbol Picker** | Visual search for stocks (Yahoo Finance logos + exact YF symbol) and crypto (CoinGecko IDs) |
| **CS2 Skin Picker** | Search Steam Market with images, rarity colours, live prices — auto-fills transaction |
| **Positions Table** | Sortable by value, P&L, return, CAGR — click any row for full position detail modal |
| **Multi-Portfolio** | Multiple portfolios with colour coding — Overview always shows combined totals |
| **Net Worth** | Add cash accounts, real estate, loans — see true net wealth beyond investments · **real assets & property** with valuation history, acquisition cost+fees, optional financing link and recurring/one-off cashflows (net value + net rental yield + total return) · **interest-bearing cash & time deposits** (Festgeld): rate, daily/monthly/annual compounding, maturity — interest accrues day-accurate (act/365) and is booked as capital income for the tax report |
| **Options** | Track long/short calls and puts (underlying, strike, expiry, premium, contract size) — signed book with net premium, moneyness, intrinsic value and estimated P&L on the Overview; kept separate from the share positions |
| **Dividends** | Calendar view, 12-month forecast, auto-fetch from Yahoo Finance · quality & safety scoring per payer (payout ratio, growth streak, dividend growth, coverage, cut-risk flag) with an aggregated portfolio dividend-health value · **yield-on-cost** per payer over the FIFO cost basis plus a **DRIP simulation** (reinvest distributions at the day's price vs cash — a simulation, never books real transactions) |
| **Trade Journal** | Investment thesis and notes per position |

### Analysis
| Feature | Description |
|---------|-------------|
| **Returns & XIRR** | Money-weighted (XIRR) and time-weighted return from real cash flows · benchmark overlay (Alpha, Beta, Tracking Error, Information Ratio, R² vs MSCI World / FTSE All-World / S&P 500 / Nasdaq 100) · FX attribution splitting each return into asset (local) and exchange-rate parts, aggregated by currency |
| **Rebalancing** | Set target allocation via sliders — see exactly what to buy/sell |
| **Savings Plans** | DCA adherence tracking (calendar-exact schedules), missed executions, plan performance · due executions are booked automatically as real, marked buy transactions on app open (idempotent, sync-safe) · optional end date with active/completed status · add/edit in a modal |
| **Cash Flow** | Invested vs portfolio value chart — visualises your entire investment journey |
| **Fee Analyzer** | Total fees, fee rate %, breakdown by year and asset class, top 10 most expensive trades · ongoing costs (TER) per fund with annual EUR cost, weighted average TER, multi-year cost-drag projection, and manual TER override |
| **Risk & Correlation** | Correlation matrix, Monte Carlo (10,000+ iterations), stress tests (2008 / COVID / Dot-com), VaR, CVaR, Sharpe, Sortino · rolling volatility/return trends · Fama-French factor exposure (market / size / value loadings) |
| **Planning Simulator** | Future Value · FIRE projection · withdrawal survival · Monte-Carlo success probability — in the Monte-Carlo view · allocation backtester: what would X EUR in a freely defined allocation have become over real history, with optional periodic rebalancing, vs benchmark presets and your actual portfolio |
| **Strategy** | DCA vs lump sum, sector allocation, currency exposure, **company-size buckets** (Large/Mid/Small, EUR-normalised market cap), liquidity score, goal planning |
| **Performance Map** | Allocation treemap heatmap — area = position weight, colour = performance (remaps across themes); period selector with total-return fallback; respects Privacy Mode (in the Performance view) |
| **Health Score** | 0–100 structural score (diversification · concentration · asset-class spread · breadth) with a letter grade and concrete, actionable recommendations · AI advisor findings folded in |
| **ETF X-Ray** | Look-through of ETF/fund positions: effective per-security exposure across funds + direct holdings, sector/country/currency look-through, fund-overlap detection, hidden concentration risks — in the Health and Risk views (live via Worker, built-in snapshot fallback) |
| **Corporate Actions** | Stock splits and reverse splits applied to historical lots so quantities, prices, position value, P&L, CAGR, the value chart and FIFO cost basis stay correct across a split · add manually (ratio New:Old) per holding or auto-detect via the Worker · managed in the position detail modal, with a global list in Settings · carried in the full-vault backup |
| **Tax & FIFO** | German tax law: 1-year crypto exemption with Freigrenze, Vorabpauschale per accumulating fund (BMF base rates, month pro-rating, sale credit), Teilfreistellung by fund type, Sparerpauschbetrag, Soli and optional church tax in the statutory order · US tax law (short/long-term gains) · editable tax settings (rate, Soli, church tax, allowance, crypto exemption, Teilfreistellung) · multi-sheet Excel + PDF export · **tax advisor** (estimate): crypto §23 EStG tax-free countdown per lot, 1.000 EUR Freigrenze buffer, Sparerpauschbetrag headroom, loss-harvesting with the stock vs other pots kept separate, ranked Critical/Important/Optimization |

### Tools
| Feature | Description |
|---------|-------------|
| **Portfolio Intelligence** | Automatic detection of structural problems across ten dimensions — hidden concentration, single-company & sector overexposure, country & currency risk, correlation clusters (fund overlap), style drift, dividend & yield traps, liquidity risk — each with a concrete recommendation, ranked **Critical / Important / Optimization**. Reuses the ETF look-through, metrics and dividend engines; computed fully on-device (`g i`) |
| **Discovery** | Read-only screener for ETFs/stocks/crypto · top movers (gainers/losers/most active) · dividend screener — live via your Worker, prices shown in EUR. Gated & optional; degrades gracefully if the Worker predates the endpoint |
| **Watchlist** | Track symbols without buying — optional target price and sparkline |
| **Price Alerts** | Notify when price crosses threshold — progress bar shows proximity |
| **Risk Monitor** | Rule-based structural alerts with configurable thresholds — position concentration (incl. effective look-through limit), allocation drift, drawdown, volatility — evaluated on every price refresh, with optional local notifications and cooldown |
| **Broker Import** | CoinTracking · DEGIRO · Trade Republic · Scalable Capital · Interactive Brokers · Trading 212 · Revolut · flatex · Consorsbank · Coinbase · Binance · Kraken · Bitpanda · PDF settlement statements (Trade Republic, Scalable, ING, DKB, Comdirect) parsed fully on-device with editable preview - the PDF never leaves your browser · **reusable mapping presets** — save a column mapping for an unknown broker and re-import next time without remapping · **read-only exchange sync** (Binance · Kraken · Coinbase · Bitpanda) over the client-signed relay — read-only API keys stored only in the encrypted vault, idempotent (no duplicate trades), manual trigger |
| **Command Palette** | `Ctrl+K` — navigate anywhere by keyboard |
| **Privacy Mode** | Mask every amount app-wide for screenshots / public viewing — toggle in the top bar, in Settings, or with `p` |
| **Share & Compare** | Opt-in redacted snapshot sharing (percentage weights and scores only - never amounts, quantities or symbols; enforced client- and server-side) with 90-day links, plus anonymous benchmarking against the aggregate of all shared snapshots · the same link backs a read-only **MCP endpoint** ("Ask Claude about your portfolio") that exposes only the redacted allocation/scores |
| **Keyboard Shortcuts** | `g`+key to jump views (`g o`, `g t`, …), single keys for actions (`n` new · `r` refresh · `b` backup · `i` import · `p` privacy) · `?` shows the full list |

---

## Quick Start

### 1 — Open the app
```
https://maermin.github.io/MAERMIN/
```
On first run you **set your own access password** (no shipped default) and are handed a
one-time **recovery code** — download or print it. It's an alternative way to unlock the
vault if you forget your password, stored only as a wrapped key (never in readable form,
never transmitted). The first run also opens a **guided setup wizard** (below); you can
re-open it anytime from **API Settings → Guided setup**, or pick **Demo mode** to explore
a sample portfolio before any setup.

### 2 — Deploy your Cloudflare Worker
The Worker is **required** for stock prices, historical chart data, CS2 prices, and symbol search. It's free and takes ~2 minutes. The in-app **guided setup wizard** walks you through this with a one-click *Copy worker.js* and a live **connection test** that pings each data source and shows green/red per endpoint.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create Worker**
2. Paste the contents of [`cf-worker/worker.js`](cf-worker/worker.js)
3. **Save and Deploy** — copy the Worker URL
4. Paste URL in MAERMIN → **API Settings** → Cloudflare Worker (or let the wizard test + save it)

### 3 — (Optional) Alpha Vantage
Add a free [Alpha Vantage key](https://www.alphavantage.co/support/#api-key) in API Settings as a fallback for stocks when Yahoo Finance returns no data. Free tier: 25 requests/day.

---

## Data Sources

| Source | Used For | Key Required |
|--------|----------|:------------:|
| **Yahoo Finance** | Stocks, ETFs, commodities, all global exchanges, historical data | ✗ (via Worker) |
| **CoinGecko** | Crypto prices + history | ✗ (direct) |
| **Steam Market** | CS2 skin prices + search | ✗ (via Worker) |
| **Alpha Vantage** | Stocks/commodities fallback | ✓ (free, optional) |
| **ExchangeRate-API** | USD → EUR conversion | ✗ |
| **Cloudflare Worker** | CORS proxy for all Worker endpoints | ✗ (free tier) |

---

## Cloudflare Worker Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /?action=yf&symbol=AAPL&interval=1d&range=1y` | Yahoo Finance historical data |
| `GET /?action=yfsearch&q=Apple&type=stock` | Symbol search (stocks or crypto) |
| `GET /?action=screener&scrId=day_gainers` (or `&symbols=KO,PG`) | Discovery: predefined screener / movers, or batch quote |
| `GET /?action=fundholdings&symbol=VWCE.DE` | ETF/fund look-through: top holdings, sector weights, expense ratio (TER) |
| `GET /?action=fundamentals&symbol=KO` | Dividend-safety fundamentals: payout ratio, EPS, dividend rate/yield |
| `GET /?action=profile&symbol=AAPL` | Equity sector / industry / country (Strategy tab Sector & Country allocation; Yahoo `assetProfile`, no FMP key needed) |
| `GET /?action=earnings&symbol=AAPL` | Next earnings date + consensus EPS/revenue estimates (Earnings Calendar in the Dividends view; Yahoo `calendarEvents`, no key) |
| `GET /?action=steamhistory&name=AK-47 \| Redline (FT)` | CS2 price history (USD) |
| `GET /?action=search&q=ak47+redline` | Steam Market skin search with images |
| `POST /` | Steam skin price lookup (array of names → USD price map) |
| `POST /?action=sync` | E2E-encrypted cloud sync (KV-backed, zero-knowledge) |
| `POST /?action=share` | Redacted share snapshots (percent weights/scores only, allowlist-validated server-side) + anonymous benchmark aggregate |
| `POST /?action=brokerproxy` | Relay client-signed requests to whitelisted exchanges |

All endpoints are rate-limited (per-IP) and use hard fetch timeouts. Full request/response contracts: [docs/WORKER.md](docs/WORKER.md).

---

## File Structure

```
MAERMIN/
├── index.html                  Entry point — loads all scripts in order, sets CSP
├── styles.css                  App styles
├── audit-log.js                Security/error audit trail (window.MaerminAuditLog)
├── crypto-vault.js             AES-256-GCM vault, KDF, passkeys (window.MaerminVault)
├── storage.js                  Encrypted-at-rest storage shim + backups (window.MaerminStorage)
├── migrations.js               localStorage schema migrations (window.MaerminMigrations)
├── auth.js                     Vault unlock/setup gate (window.MaerminAuth)
├── utils.js                    Shared formatters, upsertTransaction, FX (window.MaerminUtils)
├── metrics.js                  Shared metrics: positions, net worth, FIRE (window.MaerminMetrics)
├── portfolio-intelligence.js   Ten-check structural problem detection, ranked (window.MaerminIntelligence)
├── ticker-validation.js        Symbol normalisation (window.MaerminTickers)
├── equity-metadata.js          Sector/country metadata (window.MaerminEquityMeta)
├── dividend-data-service.js    Dividend data + forecast (window.DividendDataService)
├── tax-report-builder.js       Filing-grade tax report + PDF/Excel (window.MaerminTaxReport)
├── allocation.js · projection.js · recurring.js   Allocation / forecast / liabilities engines
├── renderer.js                 Main React app — state, routing, transactions (~3,800 lines)
├── features.js … features7.js  Feature views (charts, analysis, dividends, net worth, …)
├── build.mjs                   Web build — bundles + minifies (reads index.html order)
├── test/                       Node test harnesses (npm test)
├── docs/                       ARCHITECTURE.md · WORKER.md
└── cf-worker/worker.js         Cloudflare Worker — market-data proxy, sync, broker relay
```

> Full module/view map and data flow: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

### Development

The app runs directly from `index.html` (no build needed for dev). Common scripts:

```bash
npm install        # once, pulls esbuild (web build) + electron (desktop)
npm test           # run all Node test harnesses (test/*.test.js)
npm run check      # syntax-check every JS file (fast pre-commit gate)
npm run build:web  # -> dist/index.html + dist/maermin.min.js + dist/styles.css
```

Contributing guidelines and conventions: **[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## Privacy & Security

- All data stored in `localStorage` — never transmitted anywhere
- **Encrypted vault**: AES-256-GCM with PBKDF2-600k (or Argon2id); password never stored; optional encryption at rest, passkey unlock, idle auto-lock
- **Recovery code**: a one-time code generated at setup is an alternative way to unlock the vault if you forget your password — implemented as a second key-wrapping (like a passkey), never stored in readable form and never transmitted, so the zero-knowledge model is preserved. Changing your password invalidates it; generate a fresh one afterwards.
- **Encrypted backups**: export a portable, password-protected backup (Settings → Backup vault) — a portable recovery path you can store off-device
- **On-device audit log**: security events + uncaught errors (Settings → Security log), never transmitted
- No analytics, no remote telemetry, no third-party tracking
- API calls go to: CoinGecko, ExchangeRate-API, your own Cloudflare Worker
- Your Worker only relays to Yahoo Finance / Steam / (optionally) whitelisted exchanges — no data is stored except the opt-in zero-knowledge sync blob
- Set or change the access password in-app (Settings → Change Password) — no code edits needed

---

## Changelog

See [RELEASE.md](RELEASE.md) for full release notes.

| Version | Date | Highlights |
|---------|------|------------|
| **v10.0** | June 2026 | New dark-fintech UI · Portfolio Value Snapshots · Smart Tags · Custom Dashboard Layout · Portfolio Intelligence |
| v9.0 | March 2026 | Real historical chart · Symbol Picker · P&L calculation fix · Yahoo Finance primary |
| v8.3 | Feb 2026 | CS2 skin picker · Historical chart v1 · Multi-portfolio |
| v8.2 | Feb 2026 | Net worth · Fee analyzer · Performance periods |
| v8.1 | Jan 2026 | XIRR · Rebalancing · Dividend forecast · FIFO |
| v8.0 | Jan 2026 | Full rewrite — web app, no Electron required |

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

[Live Demo](https://maermin.github.io/MAERMIN/) · [Report a Bug](https://github.com/maermin/MAERMIN/issues)

</div>
