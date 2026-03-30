# Release Notes — MAERMIN v9.0

**Date:** March 2026
**Type:** Major Feature Release
**Compatibility:** All existing localStorage data is preserved automatically

---

## Highlights

v9.0 fixes fundamental calculation bugs, introduces a professional-grade historical chart, and adds a visual Symbol Picker so the correct Yahoo Finance / CoinGecko symbol is always used.

---

## What's New

### Real Historical Portfolio Chart
- Time-accurate: `amountAt(ts)` replays transaction history — second buy shows as real value jump
- All periods: 1H · 1D · 1W · 1M · 1Y · 3Y · 5Y · Max
- Sources: Yahoo Finance (stocks/ETFs/commodities), CoinGecko (crypto), Steam Market (CS2)
- Chart last point anchored to live price — stats cards and chart always show same value

### Symbol Picker
- Stocks/ETFs: Yahoo Finance search via Worker — shows logo, exchange, exact YF symbol
- Crypto: CoinGecko search — coin logo, market rank, correct CoinGecko ID
- Exact API symbol (e.g. `SIX2.DE`, `bitcoin`) saved to transaction — no more mapping errors
- Tokenized stocks (TSLAX) and stablecoins filtered from crypto search

### P&L Calculation Fix (Critical)
**Before:** Selling 50 NVO at a loss while holding 150 would inflate the average buy price from €80 to €160 → showing -50% when the position was actually flat.
**After:** Sells reduce cost basis proportionally. Correct P&L for all positions.

### Overview: All Portfolios Combined
- Stats cards now show all portfolios summed (`allPortfoliosStats`)
- Portfolio breakdown bar shows per-portfolio value when multiple portfolios exist
- Chart and stats cards always match (anchored last point)

---

## Bug Fixes

| Bug | Fix |
|-----|-----|
| NVO showing -71% P&L | Sell transactions now reduce cost basis proportionally |
| Chart didn't show second buy as jump | `amountAt(ts)` replays transaction history per timestamp |
| Stats cards showed different value than chart | Chart last point replaced with live price |
| `(amount \|\| 1)` — zero-amount positions added phantom value | Changed to `(amount \|\| 0)` |
| PerformancePeriods wrong period calculation | Fixed: timestamps compared as Unix seconds, not ISO strings |
| PortfolioOverviewPanel rendered twice | Removed duplicate instance |
| onError crash in Symbol Picker | Fixed null parentNode check |
| Steam history always 400 | Falls back to priceoverview (no auth needed) |
| Parqet logos 404 | Replaced with Yahoo Finance brand CDN |

---

## UX Improvements

- Overview header: compact action buttons, "All N portfolios combined" label
- Sidebar nav: hover state, cleaner active indicator
- Chart header: shows period performance prominently, not duplicate current value
- Dead code removed: ~160 lines of fallback/duplicate code deleted
- Alpha Vantage demoted to fallback — button renamed "Auto-fetch dividends"

---

## Cloudflare Worker Updates

New endpoints (requires Worker redeployment):
- `?action=yfsearch&q=Apple&type=stock` — Yahoo Finance symbol search
- `?action=steamhistory` — Steam price history with `priceoverview` fallback

---

## Upgrading

1. **Update the Worker** — paste `cf-worker/worker.js` into your Cloudflare Worker and redeploy
2. **No data migration needed** — all existing transactions work as-is
3. **Optional:** Re-enter stock symbols using the Symbol Picker for exact YF symbol storage
