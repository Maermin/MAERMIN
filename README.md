<div align="center">

<h1>MAERMIN</h1>
<p><strong>Professional Multi-Asset Portfolio Tracker</strong><br>
Crypto · Stocks · CS2 Items — runs entirely in the browser, no installation required.</p>

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-8b5cf6?style=for-the-badge&logo=github)](https://maermin.github.io/MAERMIN/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/Version-7.2-3b82f6?style=for-the-badge)](#changelog)

</div>

---

## What is MAERMIN?

MAERMIN is a **fully client-side** investment tracker. There is no server, no database, no account required. All your data lives in your browser's `localStorage`. Access is protected by a shared-secret login that requires no user database — just a SHA-256 hash stored in a single file.

Built with React (via CDN), plain JavaScript, and no build step. Works offline after the first load.

---

## Features

### Portfolio
| Feature | Description |
|---------|-------------|
| **Overview Dashboard** | Interactive donut chart, top gainers/losers panel, sparklines on every position |
| **Positions Table** | Sortable by value, P&L, symbol, price — with mini P&L bars and portfolio share |
| **Performance Chart** | SVG chart of portfolio total value over time |
| **Transactions** | Full history with search, sort (date, size, symbol), and inline delete confirmation |
| **Dividend Calendar** | Monthly/yearly income totals, upcoming payments list |
| **Trade Journal** | Investment thesis and notes per position, persistent in localStorage |

### Analysis
| Feature | Description |
|---------|-------------|
| **XIRR / TWR** | Money-weighted and time-weighted return from real cash flows |
| **Rebalancing Tool** | Set target allocation via sliders, see exactly what to buy/sell — with additional investment simulation |
| **Portfolio Analysis** | Correlation matrix, Monte Carlo simulation (10,000+ iterations), stress tests against historical crises (2008, COVID, Dot-com), risk metrics (VaR, CVaR, Sharpe, Sortino) |
| **Strategy Analysis** | DCA vs. lump sum, sector allocation, currency exposure, liquidity score, goal planning |

### Tax
- German tax law (including 1-year crypto exemption)
- US tax law (short-term / long-term capital gains)
- PDF export for your tax return

### Tools
| Feature | Description |
|---------|-------------|
| **Watchlist** | Track symbols without buying — with optional target price and sparkline |
| **Price Alerts** | Triggered when price crosses a threshold; progress bar shows how close you are |
| **Broker Import Wizard** | Step-by-step CSV import for DEGIRO, Trade Republic, Interactive Brokers, Coinbase, Binance, Kraken |
| **Command Palette** | `Ctrl+K` to navigate anywhere by keyboard |

### Prices
| Source | What | API Key? |
|--------|------|----------|
| [CoinGecko](https://coingecko.com) | Crypto prices | No — free |
| [Skinport](https://skinport.com) | CS2 item prices | No — free |
| [ExchangeRate-API](https://open.er-api.com) | USD / EUR rate | No — free |
| [Alpha Vantage](https://alphavantage.co) | Stock prices | Yes — [get free key](https://www.alphavantage.co/support/#api-key) |

---

## Getting Started

### Option 1 — Use the Live Demo

Visit [maermin.github.io/MAERMIN](https://maermin.github.io/MAERMIN/) and log in with the default password: `maermin2024`

> Change the password after your first login — see [Authentication](#authentication).

### Option 2 — Self-Host on GitHub Pages

```bash
# 1. Fork or clone the repo
git clone https://github.com/Maermin/MAERMIN.git
cd MAERMIN

# 2. Push to your repo
git add .
git commit -m "Initial deploy"
git push
```

Then on GitHub: **Settings → Pages → Source: GitHub Actions**

The included workflow (`.github/workflows/deploy.yml`) deploys automatically on every push to `main`. Your app will be live at `https://[your-username].github.io/MAERMIN/`

### Option 3 — Run Locally

No build step needed:

```bash
# Python
python -m http.server 8080

# Node.js
npx serve .
```

Then open `http://localhost:8080`

---

## Authentication

MAERMIN uses a **shared-secret system** — no server, no user database.

The password is stored as a SHA-256 hash in `auth.js`. Sessions expire after 8 hours or when you close the tab.

**Default password:** `maermin2024`

### Change the password

**In the app:** Log in → ⚙️ Settings → *Change Password* → copy the displayed hash into `auth.js` and push.

**Via browser console:**
```js
MaerminAuth.generateHash('YourNewPassword').then(h => console.log(h))
```

**Via terminal:**
```bash
node -e "
const crypto = require('crypto');
console.log(crypto.createHash('sha256').update('YourNewPassword').digest('hex'));
"
```

Then replace the value in `auth.js`:
```js
const MAERMIN_SECRET_HASH = 'paste-your-new-hash-here';
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open Command Palette |
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
| `b` | Create backup |
| `?` | Show all shortcuts |
| `Esc` | Close modal / dropdown |

---

## Data & Privacy

- All data is stored **locally in your browser** (`localStorage`)
- **Nothing is sent to any server** except the price API requests (CoinGecko, Alpha Vantage, Skinport, ExchangeRate-API)
- Backups download as a local JSON file — never uploaded anywhere
- The login session hash is stored in `sessionStorage` (cleared on tab close)
- All calculations run 100% client-side

---

## File Structure

```
MAERMIN/
├── index.html                    # Entry point — loads all modules
├── auth.js                       # Shared-secret login (SHA-256)
├── renderer.js                   # Main React application
├── renderer-components.js        # Correlation, Monte Carlo, Stress-Test UI
├── features.js                   # Pie chart, sparklines, gainers/losers,
│                                 #   performance chart, positions table,
│                                 #   watchlist, price alerts
├── features2.js                  # XIRR/TWR, rebalancing, broker import wizard,
│                                 #   trade journal, dividend calendar, mobile nav
├── investment-views.js           # DCA, sectors, currency, liquidity, goals
│
├── # Calculation Engines
├── calculator-extended.js        # Financial calculations
├── tax-calculation-engine.js     # Tax engine (DE + US)
├── tax-pdf-export.js             # PDF tax report export
├── risk-analytics.js             # VaR, volatility, Sharpe Ratio
├── monte-carlo-engine.js         # Monte Carlo simulation
├── correlation-engine.js         # Asset correlation
├── stress-test-engine.js         # Historical stress tests
├── import-export-engine.js       # Broker import & CSV/JSON export
├── dca-analyzer-engine.js        # DCA analysis
├── dividend-tracker-engine.js    # Dividend tracking
├── benchmark-engine.js           # Benchmark comparison
├── goal-investing-engine.js      # Goal planning
├── portfolio-optimizer-engine.js # Portfolio optimization
├── sector-allocation-engine.js   # Sector allocation
├── currency-exposure-engine.js   # Currency exposure
├── liquidity-analysis-engine.js  # Liquidity analysis
│
├── translations-complete.js      # DE / EN translations
├── validation-comprehensive.js   # Input validation
├── cs2-advanced.js               # CS2 item analytics
├── cs2-analytics-view-v2.js      # CS2 analytics UI
│
├── .github/workflows/deploy.yml  # GitHub Pages auto-deploy
├── .nojekyll                     # Prevents Jekyll from processing JS files
└── package.json                  # Project metadata
```

---

## Changelog

| Version | Highlights |
|---------|-----------|
| **v7.2** | Removed hardcoded fake data (economic indicators, options view), grouped sidebar navigation (Portfolio / Analysis / Tools), analytics as inline tab view, English as default language, dead code cleanup |
| **v7.1** | XIRR/TWR returns, rebalancing tool, broker import wizard, trade journal, dividend calendar, mobile bottom navigation |
| **v7.0** | Web app launch, donut allocation chart, sparklines, gainers/losers panel, performance chart, sortable positions table, watchlist, price alerts, shared-secret login |
| **v6.x** | Electron desktop app: Monte Carlo, correlation matrix, stress tests, command palette |
| **v5.x** | Tax engine, CS2 analytics, risk analytics |

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
<sub>Built with React · No build step · No backend · No tracking</sub>
</div>
