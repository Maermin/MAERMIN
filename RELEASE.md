# MAERMIN v8.0 — Release Notes

## What's New in v8.0

### New Features

**Benchmark Comparison** (inspired by Parqet & Delta)
Portfolio return is now compared side-by-side against Bitcoin and Ethereum using collected price history — no extra API calls. Displayed as a bar chart on the Overview. Updates automatically after every price refresh.

**Position Detail Modal** (inspired by Parqet & Sharesight)
Click any row in the Positions table to open a full breakdown for that position: all individual transactions, average cost basis, total fees paid, unrealized P&L, total return %, and CAGR. Data comes entirely from your existing transactions — nothing fetched from the network.

**CAGR per Position** (inspired by Sharesight & Ghostfolio)
A new "CAGR/yr" column in the positions table shows the annualized return for each holding, calculated from purchase date to today. Shows `—` for positions held less than a month.

**Daily P&L Card**
The Overview now shows today's portfolio change in EUR and % — calculated from the difference between the last two price snapshots.

---

### CS2 Pricing — Complete Rework

Pricempire's `/v4/paid/` API requires a paid subscription (the free Trader plan only covers website tools, not the API). The entire CS2 pricing stack has been rebuilt around **Skinport** instead.

**What changed:**
- Source switched from Pricempire → Skinport
- No API key required — Skinport's public API is free
- The Cloudflare Worker (`cf-worker/worker.js`) has been completely rewritten
- Worker now fetches Skinport server-side, bypassing CORS
- Response is cached 10 minutes at Cloudflare edge — fast and bandwidth-efficient
- In API Settings: field renamed from "Pricempire key" to "CS2 Worker URL"

**Migration:** Update your existing Worker by replacing its code with the new `cf-worker/worker.js` and clicking Save and Deploy. No secrets or API keys needed. The Worker URL stays the same.

---

### Import Wizard — Major Upgrade

**CoinTracking import** — full parser built directly in `features2.js`:
- Supports both date formats: `DD.MM.YYYY HH:MM` and `YYYY-MM-DD HH:MM:SS`
- Auto-detects German and English CSV headers
- Maps all transaction types: Trade → Buy+Sell, Deposit, Withdrawal, Income, Mining, Gift/Tip, Spend, Donation
- Automatically filters out stablecoins (USDT, USDC, EUR etc.)
- Computes price from Buy/Sell ratio on Trade rows
- Auto-categorizes `crypto` vs `stocks`

**Export from CoinTracking:** Reports → All Transactions → Export → **"CSV (Full Export)"**

**getquin** — honest info screen instead of a broken parser. getquin has no CSV export by design. The wizard now explains this clearly and offers three alternatives: import from original broker CSV, add manually, or use screenshot as reference.

**Broker logos** — all broker icons now render as proper SVG logos (inline, no external API dependency) instead of emoji. Brokers are grouped by category: Portfolio Trackers / Brokers / Crypto / Other.

---

### Design & Polish

**All emojis removed** from the UI and replaced with clean Unicode symbols or text:

| Was | Jetzt |
|-----|-------|
| ☀️ 🌙 💜 (theme switcher) | `Light` `Dark` `Purple` |
| 🇩🇪 🇬🇧 (language toggle) | `DE` `EN` |
| 🔐 🔑 🔒 (settings) | Plain text |
| 💾 📤 (backup/export) | `↓` `↑` |
| ✏️ 🗑️ (edit/delete) | `✎` `×` |
| 📊 📈 💰 📓 ⚖️ (view headers) | Text only |
| 📂 🎉 (upload/success) | `↑` `✓` |
| 👁 🔔 🎯 (empty states) | `○` `◎` |

**Sidebar navigation** — grouped into three labeled sections (Portfolio / Analysis / Tools) with accent left-border active indicator. Clean letter/symbol icons instead of emoji.

---

### Version Bump

All files updated from v7.x to v8.0:
- `renderer.js`, `features.js`, `features2.js`, `features3.js`
- `index.html` (title, meta tags, version badge, comments)
- `package.json`
- `auth.js`

---

## Bug Fixes

- `timestamp is not defined` error in `fetchPrices` — variable now declared at function top
- `allorigins.win` proxy 408/500 errors — replaced with direct Skinport via Worker
- `api.skinport.com` CORS block — fixed via Worker
- `steamcommunity.com` CORS block on GitHub Pages — Steam fallback removed
- Settings dropdown: old `pricempire` API key field migrated to `cs2Worker`

---

## How to Update

1. Download the ZIP and replace all changed files in your repo
2. **Update the Cloudflare Worker** — open your Worker in the Cloudflare Dashboard, replace the code with the new `cf-worker/worker.js`, and click Save and Deploy
3. In MAERMIN API Settings: your existing Worker URL stays the same — just make sure the field now shows "CS2 Worker URL" (not "Pricempire key")
4. Push to GitHub — GitHub Actions deploys automatically
5. Hard reload in browser: `Ctrl+Shift+R`

---

## GitHub Release

**Tag:** `v8.0`  
**Title:** `MAERMIN v8.0 — Portfolio Tracker`  
**Assets:** attach `MAERMIN-complete.zip`
