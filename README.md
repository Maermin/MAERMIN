<div align="center">

<h1>MAERMIN</h1>
<p><strong>Professional Multi-Asset Portfolio Tracker</strong><br>
Crypto · Stocks · CS2 Items — runs entirely in the browser, no installation required.</p>

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-8b5cf6?style=for-the-badge&logo=github)](https://maermin.github.io/MAERMIN/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/Version-8.0-3b82f6?style=for-the-badge)](#changelog)

</div>

---

## What is MAERMIN?

MAERMIN is a **fully client-side** investment tracker. No server, no database, no account required. All data lives in your browser's `localStorage`. Access is protected by a shared-secret login — just a SHA-256 hash in a single file.

Built with React (via CDN) and plain JavaScript. No build step. Works offline after the first load.

---

## Features

### Portfolio
| Feature | Description |
|---------|-------------|
| **Overview Dashboard** | Interactive donut chart, top gainers/losers panel, sparklines on every position |
| **Positions Table** | Sortable by value, P&L, return, CAGR — click any row for full position detail |
| **Position Detail Modal** | All transactions, avg cost, total fees, CAGR, unrealized P&L per position |
| **Performance Chart** | SVG chart of total portfolio value over time |
| **Daily P&L** | Today's gain/loss based on last two price snapshots |
| **Benchmark Comparison** | Your portfolio return vs Bitcoin and Ethereum side-by-side |
| **Transactions** | Full history with search, sort, inline delete |
| **Dividend Calendar** | Monthly/yearly income totals, upcoming payments |
| **Trade Journal** | Investment thesis and notes per position |

### Analysis
| Feature | Description |
|---------|-------------|
| **XIRR / TWR** | Money-weighted and time-weighted return from real cash flows |
| **CAGR per Position** | Annualized return for each holding in the positions table |
| **Rebalancing Tool** | Set target allocation via sliders, see exactly what to buy/sell |
| **Portfolio Analysis** | Correlation matrix, Monte Carlo (10,000+ iterations), stress tests (2008/COVID/Dot-com), VaR, CVaR, Sharpe, Sortino |
| **Strategy Analysis** | DCA vs. lump sum, sector allocation, currency exposure, liquidity score, goal planning |

### Tax
- German tax law (1-year crypto exemption)
- US tax law (short-term / long-term capital gains)
- PDF export

### Tools
| Feature | Description |
|---------|-------------|
| **Watchlist** | Track symbols without buying — optional target price and sparkline |
| **Price Alerts** | Triggered when price crosses threshold, progress bar shows proximity |
| **Broker Import Wizard** | CSV import for CoinTracking, DEGIRO, Trade Republic, Interactive Brokers, Coinbase, Binance, Kraken |
| **Command Palette** | `Ctrl+K` — navigate anywhere by keyboard |

### Prices
| Source | What | Key? |
|--------|------|------|
| [CoinGecko](https://coingecko.com) | Crypto | No |
| [Skinport](https://skinport.com) via Cloudflare Worker | CS2 skins | No — see [CS2 setup](#cs2-skin-prices) |
| [ExchangeRate-API](https://open.er-api.com) | USD/EUR | No |
| [Alpha Vantage](https://alphavantage.co) | Stocks | Yes — [get free key](https://www.alphavantage.co/support/#api-key) |

---

## Getting Started

### Option 1 — Live Demo

Visit [maermin.github.io/MAERMIN](https://maermin.github.io/MAERMIN/) — default password: `maermin2024`

### Option 2 — Self-Host on GitHub Pages

```bash
git clone https://github.com/Maermin/MAERMIN.git
git push
```

GitHub: **Settings → Pages → Source: GitHub Actions**

Your app: `https://[your-username].github.io/MAERMIN/`

### Option 3 — Run Locally

```bash
python -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080`

---

## Authentication

**Default password:** `maermin2024`

**Change password — in the app:** Settings → Change Password → copy the displayed hash into `auth.js` at `MAERMIN_SECRET_HASH` and push.

**Change password — terminal:**
```bash
node -e "const c=require('crypto');console.log(c.createHash('sha256').update('NewPassword').digest('hex'))"
```

---

## CS2 Skin Prices

Skinport's API blocks browser requests (CORS). A Cloudflare Worker proxies the request server-side. **No API key needed** — just deploy the Worker.

**Setup (~5 minutes, one time):**

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create Worker
2. Name it `maermin-skinport-proxy`
3. Paste the contents of `cf-worker/worker.js` from this repo
4. Click **Save and Deploy**
5. In MAERMIN: **⚙ API Settings** → paste the Worker URL

The Worker caches Skinport's response for 10 minutes at Cloudflare's edge — fast and free within the 100k requests/day limit.

**Skin names** must match the Steam Market exactly, e.g. `AK-47 | Redline (Field-Tested)`.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Command Palette |
| `g o` | Overview |
| `g t` | Transactions |
| `g d` | Dividend Calendar |
| `g j` | Trade Journal |
| `g r` | Returns & XIRR |
| `g b` | Rebalancing |
| `g a` | Portfolio Analysis |
| `g x` | Tax Report |
| `g w` | Watchlist |
| `g l` | Price Alerts |
| `g m` | Broker Import |
| `n` | Add transaction |
| `r` | Refresh prices |
| `b` | Backup |
| `?` | Show shortcuts |
| `Esc` | Close modal |

---

## Data & Privacy

- All data stored **locally** in `localStorage` — nothing sent to any server
- Price API requests go to CoinGecko, Alpha Vantage, Skinport (via Worker), ExchangeRate-API
- Backups download as a local JSON file
- Session hash in `sessionStorage` — cleared on tab close

---

## File Structure

```
MAERMIN/
├── index.html                    # Entry point
├── auth.js                       # Shared-secret login (SHA-256)
├── renderer.js                   # Main React application
├── features.js                   # Pie chart, sparklines, gainers/losers,
│                                 #   performance chart, positions table,
│                                 #   watchlist, price alerts
├── features2.js                  # XIRR/TWR, rebalancing, broker import wizard,
│                                 #   trade journal, dividend calendar, mobile nav
├── features3.js                  # Benchmark comparison, position detail modal,
│                                 #   CAGR per position, daily P&L
├── investment-views.js           # DCA, sectors, currency, liquidity, goals
├── renderer-components.js        # Correlation, Monte Carlo, stress test UI
│
├── # Calculation Engines
├── tax-calculation-engine.js     # Tax engine (DE + US)
├── tax-pdf-export.js             # PDF tax export
├── risk-analytics.js             # VaR, Sharpe, Sortino
├── monte-carlo-engine.js         # Monte Carlo simulation
├── correlation-engine.js         # Asset correlation
├── stress-test-engine.js         # Historical stress tests
├── import-export-engine.js       # Broker CSV import & JSON export
├── dca-analyzer-engine.js        # DCA vs lump sum analysis
├── dividend-tracker-engine.js    # Dividend tracking
├── goal-investing-engine.js      # Goal planning
├── sector-allocation-engine.js   # Sector allocation
├── currency-exposure-engine.js   # FX exposure
├── liquidity-analysis-engine.js  # Liquidity scoring
│
├── cf-worker/
│   └── worker.js                 # Cloudflare Worker — Skinport CORS proxy
│
├── translations-complete.js      # DE / EN translations
├── .github/workflows/deploy.yml  # GitHub Pages auto-deploy
└── package.json
```

---

## Changelog

| Version | Highlights |
|---------|-----------|
| **v8.0** | Benchmark comparison (portfolio vs BTC/ETH), position detail modal with full transaction history, CAGR per position, daily P&L card, CS2 prices via Skinport (free, no key), all emojis replaced with clean symbols, CoinTracking import, getquin export info, broker logos, grouped import wizard |
| **v7.2** | Removed hardcoded fake data, grouped sidebar (Portfolio / Analysis / Tools), analytics as inline tabs, English default, dead code cleanup |
| **v7.1** | XIRR/TWR, rebalancing tool, broker import wizard, trade journal, dividend calendar, mobile navigation |
| **v7.0** | Web app launch, donut chart, sparklines, gainers/losers, performance chart, sortable positions table, watchlist, price alerts, shared-secret login |
| **v6.x** | Electron desktop: Monte Carlo, correlation matrix, stress tests, command palette |
| **v5.x** | Tax engine, CS2 analytics, risk analytics |

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
<sub>Built with React · No build step · No backend · No tracking</sub>
</div>
