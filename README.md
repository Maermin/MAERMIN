<div align="center">

# MAERMIN

**Professional Multi-Asset Portfolio Tracker**

Crypto · Stocks · ETFs · CS2 Skins · Commodities

[![Live Demo](https://img.shields.io/badge/Live%20Demo-maermin.github.io-8b5cf6?style=for-the-badge&logo=github&logoColor=white)](https://maermin.github.io/MAERMIN/)
[![Version](https://img.shields.io/badge/Version-9.0.0-3b82f6?style=for-the-badge)](#changelog)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)
[![No Account](https://img.shields.io/badge/No%20Account-Required-f59e0b?style=for-the-badge)](#)
[![No Server](https://img.shields.io/badge/No%20Server-100%25%20Local-22c55e?style=for-the-badge)](#)

<br>

> **All your assets in one place. Runs entirely in your browser. Zero signup. Zero tracking.**

</div>

---

## What is MAERMIN?

MAERMIN is a **fully client-side** investment tracker that runs in your browser with no installation. All data is stored in your browser's `localStorage` — it never leaves your device. Access is protected by a shared-secret login (SHA-256 hash in `auth.js`).

Built with React (via CDN) and vanilla JavaScript. No build step, no bundler, no framework to install. Works offline after the first load.

```
No account  ·  No server  ·  No ads  ·  No telemetry  ·  MIT License
```

---

## ✨ Features

### 📊 Portfolio
| Feature | Description |
|---------|-------------|
| **Overview** | Stats cards showing all portfolios combined — total value, invested, return, positions |
| **Portfolio History Chart** | Real historical data from Yahoo Finance · CoinGecko · Steam — 1H · 1D · 1W · 1M · 1Y · 3Y · 5Y · Max |
| **Symbol Picker** | Visual search for stocks (Yahoo Finance logos + exact YF symbol) and crypto (CoinGecko IDs) |
| **CS2 Skin Picker** | Search Steam Market with images, rarity colours, live prices — auto-fills transaction |
| **Positions Table** | Sortable by value, P&L, return, CAGR — click any row for full position detail modal |
| **Multi-Portfolio** | Multiple portfolios with colour coding — Overview always shows combined totals |
| **Net Worth** | Add cash accounts, real estate, loans — see true net wealth beyond investments |
| **Dividends** | Calendar view, 12-month forecast, auto-fetch from Yahoo Finance |
| **Trade Journal** | Investment thesis and notes per position |

### 📈 Analysis
| Feature | Description |
|---------|-------------|
| **Returns & XIRR** | Money-weighted (XIRR) and time-weighted return from real cash flows |
| **Rebalancing** | Set target allocation via sliders — see exactly what to buy/sell |
| **Savings Plans** | DCA adherence tracking, missed executions, plan performance |
| **Cash Flow** | Invested vs portfolio value chart — visualises your entire investment journey |
| **Fee Analyzer** | Total fees, fee rate %, breakdown by year and asset class, top 10 most expensive trades |
| **Risk & Correlation** | Correlation matrix, Monte Carlo (10,000+ iterations), stress tests (2008 / COVID / Dot-com), VaR, CVaR, Sharpe, Sortino |
| **Strategy** | DCA vs lump sum, sector allocation, currency exposure, liquidity score, goal planning |
| **Health Score** | 0–100 structural score (diversification · concentration · asset-class spread · breadth) with a letter grade and concrete, actionable recommendations |
| **Tax & FIFO** | German tax law (1-year crypto exemption) · US tax law (short/long-term gains) · PDF export |

### 🔧 Tools
| Feature | Description |
|---------|-------------|
| **Watchlist** | Track symbols without buying — optional target price and sparkline |
| **Price Alerts** | Notify when price crosses threshold — progress bar shows proximity |
| **Broker Import** | CoinTracking · DEGIRO · Trade Republic · Interactive Brokers · Coinbase · Binance · Kraken |
| **Command Palette** | `Ctrl+K` — navigate anywhere by keyboard |
| **Privacy Mode** | Mask every amount app-wide for screenshots / public viewing — toggle in the top bar, in Settings, or with `p` |
| **Keyboard Shortcuts** | `g`+key to jump views (`g o`, `g t`, …), single keys for actions (`n` new · `r` refresh · `b` backup · `i` import · `p` privacy) · `?` shows the full list |

---

## 🚀 Quick Start

### 1 — Open the app
```
https://maermin.github.io/MAERMIN/
```
Default password: `maermin2024`

### 2 — Deploy your Cloudflare Worker
The Worker is **required** for stock prices, historical chart data, CS2 prices, and symbol search. It's free and takes ~2 minutes.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create Worker**
2. Paste the contents of [`cf-worker/worker.js`](cf-worker/worker.js)
3. **Save and Deploy** — copy the Worker URL
4. Paste URL in MAERMIN → **⚙ API Settings** → Cloudflare Worker

### 3 — (Optional) Alpha Vantage
Add a free [Alpha Vantage key](https://www.alphavantage.co/support/#api-key) in ⚙ API Settings as a fallback for stocks when Yahoo Finance returns no data. Free tier: 25 requests/day.

---

## 🌐 Data Sources

| Source | Used For | Key Required |
|--------|----------|:------------:|
| **Yahoo Finance** | Stocks, ETFs, commodities, all global exchanges, historical data | ✗ (via Worker) |
| **CoinGecko** | Crypto prices + history | ✗ (direct) |
| **Steam Market** | CS2 skin prices + search | ✗ (via Worker) |
| **Alpha Vantage** | Stocks/commodities fallback | ✓ (free, optional) |
| **ExchangeRate-API** | USD → EUR conversion | ✗ |
| **Cloudflare Worker** | CORS proxy for all Worker endpoints | ✗ (free tier) |

---

## ⚙️ Cloudflare Worker Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /?action=yf&symbol=AAPL&interval=1d&range=1y` | Yahoo Finance historical data |
| `GET /?action=yfsearch&q=Apple&type=stock` | Symbol search (stocks or crypto) |
| `GET /?action=steamhistory&name=AK-47 \| Redline (FT)` | CS2 price history |
| `GET /?action=search&q=ak47+redline` | Steam Market skin search with images |
| `POST /` | Steam skin price lookup (array of names → price map) |

---

## 📁 File Structure

```
MAERMIN/
├── index.html                  Entry point — loads all scripts, sets CSP
├── styles.css                  App styles (extracted from index.html)
├── auth.js                     SHA-256 login — edit to change password
├── utils.js                    Shared formatters (window.MaerminUtils)
├── portfolio-health.js         Portfolio Health Score engine + view (window.PortfolioHealth)
├── renderer.js                 Main React app — state, routing, transactions (~3,200 lines)
├── features.js                 Pie chart, sparklines, gainers/losers, watchlist, alerts
├── features2.js                XIRR/TWR, rebalancing, broker import, dividend calendar
├── features3.js                Benchmark, position detail, CS2 Skin Picker, Symbol Picker
├── features4.js                Multi-portfolio, savings plans, dividend forecast, FIFO
├── features5.js                Performance periods, net worth, cashflow, fee analyzer
├── features6.js                Real historical portfolio chart
├── build.mjs                   Web build — bundles + minifies all scripts into dist/
└── cf-worker/
    └── worker.js               Cloudflare Worker — Yahoo Finance + Steam proxy
```

### Production build (optional)

The app runs directly from `index.html` (no build needed). For a minified
single-bundle deploy:

```bash
npm install        # once, pulls esbuild
npm run build:web  # -> dist/index.html + dist/maermin.min.js + dist/styles.css
```

---

## 🔒 Privacy & Security

- All data stored in `localStorage` — never transmitted anywhere
- No analytics, no telemetry, no third-party tracking
- API calls go to: CoinGecko, ExchangeRate-API, your own Cloudflare Worker
- Your Worker only contacts Yahoo Finance and Steam — no data is stored
- Change the password by editing the SHA-256 hash in `auth.js`

---

## 📋 Changelog

See [RELEASE.md](RELEASE.md) for full release notes.

| Version | Date | Highlights |
|---------|------|------------|
| **v9.0** | March 2026 | Real historical chart · Symbol Picker · P&L calculation fix · Yahoo Finance primary |
| v8.3 | Feb 2026 | CS2 skin picker · Historical chart v1 · Multi-portfolio |
| v8.2 | Feb 2026 | Net worth · Fee analyzer · Performance periods |
| v8.1 | Jan 2026 | XIRR · Rebalancing · Dividend forecast · FIFO |
| v8.0 | Jan 2026 | Full rewrite — web app, no Electron required |

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Made with ☕ · [Live Demo](https://maermin.github.io/MAERMIN/) · [Report a Bug](https://github.com/maermin/MAERMIN/issues)

</div>
