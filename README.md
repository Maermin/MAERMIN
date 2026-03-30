<div align="center">

<h1>MAERMIN</h1>
<p><strong>Professional Multi-Asset Portfolio Tracker</strong><br>
Crypto · Stocks · ETFs · CS2 Skins · Commodities — runs entirely in the browser.</p>

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-8b5cf6?style=for-the-badge&logo=github)](https://maermin.github.io/MAERMIN/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/Version-9.0-3b82f6?style=for-the-badge)](#changelog)

</div>

---

## What is MAERMIN?

MAERMIN is a **fully client-side** investment tracker. No server, no database, no account required. All data lives in your browser's `localStorage`. Access is protected by a shared-secret login (SHA-256).

Built with React (via CDN) and plain JavaScript. No build step. Works offline after the first load.

---

## Quick Start

1. Open **https://maermin.github.io/MAERMIN/**
2. Default password: `maermin2024`
3. Deploy the Cloudflare Worker (see below)
4. Paste the Worker URL in ⚙ API Settings

---

## Cloudflare Worker (Required)

One Worker URL unlocks all live data features:

| Feature | Endpoint |
|---------|----------|
| Stock / ETF prices | `?action=yf&symbol=AAPL&interval=1d&range=5d` |
| Historical chart | `?action=yf&symbol=AAPL&interval=1d&range=1y` |
| Symbol search | `?action=yfsearch&q=Apple&type=stock` |
| CS2 skin prices | `POST /` with array of skin names |
| CS2 price history | `?action=steamhistory&name=AK-47 Redline` |

**Deploy:** `dash.cloudflare.com` → Workers & Pages → Create → paste `cf-worker/worker.js` → Save and Deploy.

---

## Features

### Portfolio
| Feature | Description |
|---------|-------------|
| **Overview** | All portfolios combined — total value, return, positions |
| **Portfolio History Chart** | Real historical data: 1H · 1D · 1W · 1M · 1Y · 3Y · 5Y · Max |
| **Symbol Picker** | Visual search for stocks (Yahoo Finance) and crypto (CoinGecko) — exact API symbol saved |
| **CS2 Skin Picker** | Search Steam Market with images, rarity, live prices |
| **Positions Table** | CAGR, sortable, click for full position detail |
| **Multi-Portfolio** | Separate portfolios with switching — Overview always shows combined |
| **Net Worth** | Add cash, real estate, loans — see true net wealth |
| **Dividends** | Calendar, forecast, auto-fetch from Yahoo Finance |

### Analysis
| Feature | Description |
|---------|-------------|
| **Returns & XIRR** | Money-weighted and time-weighted return from real cash flows |
| **Rebalancing** | Target allocation sliders — see what to buy/sell |
| **Fee Analyzer** | Total fees, fee rate, by year/asset class, top 10 most expensive trades |
| **Cash Flow** | Invested vs portfolio value over time |
| **Risk & Correlation** | Correlation matrix, Monte Carlo, stress tests (2008/COVID/Dot-com), VaR, Sharpe |
| **Tax & FIFO** | German + US tax law, PDF export |

---

## Data Sources

| Source | Used For | Key Required |
|--------|----------|--------------|
| **Yahoo Finance** | Stocks, ETFs, commodities, history | No (via Worker) |
| **CoinGecko** | Crypto prices + history | No (direct) |
| **Steam Market** | CS2 skin prices | No (via Worker) |
| **Alpha Vantage** | Stocks fallback | Yes (free, optional) |
| **ExchangeRate-API** | USD → EUR | No |

---

## File Structure

```
MAERMIN/
├── index.html              Entry point
├── auth.js                 SHA-256 login
├── renderer.js             Main React app (~3,200 lines)
├── features.js             Charts, positions table, watchlist, alerts
├── features2.js            XIRR, rebalancing, import wizard, dividends
├── features3.js            Benchmark, position detail, CS2 Picker, Symbol Picker
├── features4.js            Multi-portfolio, savings plans, dividend forecast, FIFO
├── features5.js            Performance periods, net worth, cashflow, fee analyzer
├── features6.js            Real historical portfolio chart
└── cf-worker/
    └── worker.js           Cloudflare Worker proxy
```

---

## Changelog

See [RELEASE.md](RELEASE.md) for full release notes.
