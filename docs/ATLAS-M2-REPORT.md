# Atlas M2 · Insight — milestone report

State of `main` after P5-2.10, 2026-10-13. All screenshots are from the demo (`?demo`, demo data only), desktop 1440 × 900 and phone 390 × 844, English and German, in `docs/screenshots/atlas-p5-2.*/` (one folder per package). The owner allowed self-merging on green CI on 2026-10-13; from P5-2.5 on, the agent merged each PR after both CI jobs passed.

## Merged

| Package | PR |
|---|---|
| P5-2.1 Value-change attribution (profit by source) | https://github.com/Maermin/MAERMIN/pull/136 |
| P5-2.2 Same money in an index (benchmark replay) | https://github.com/Maermin/MAERMIN/pull/138 |
| P5-2.3 Full ETF look-through from imported holdings files | https://github.com/Maermin/MAERMIN/pull/139 |
| P5-2.4 Heatmap drill-down and filters | https://github.com/Maermin/MAERMIN/pull/140 |
| P5-2.5 Dividends depth and gross / net returns | https://github.com/Maermin/MAERMIN/pull/141 |
| P5-2.6 Per-holding IRR, best and worst sales, capital flow | https://github.com/Maermin/MAERMIN/pull/142 |
| P5-2.7 Investment calendar and saving streaks | https://github.com/Maermin/MAERMIN/pull/143 |
| P5-2.8 Emergency fund and buying power checks, providers and brokers | https://github.com/Maermin/MAERMIN/pull/144 |
| P5-2.9 Real (inflation-adjusted) returns | https://github.com/Maermin/MAERMIN/pull/145 |
| P5-2.10 Taxonomies | https://github.com/Maermin/MAERMIN/pull/146 |

## What a user sees

- **Analysis → Returns**
  - Profit by source.
  - The same money in an index or a held fund.
  - A heatmap whose cells open their period, with filters by class, tag or holding.
  - A gross / net switch for taxes and fees.
  - Real (after inflation) XIRR and TWR, plus an inflation card with a region choice.
  - IRR per holding, asset class and tag.
  - The best and worst sales.
  - Capital flow per month and year.
- **Dividends**
  - Forecast: 24 months by default; each month lists its payments.
  - New History tab: dividends by security and year, growth per payer (CAGR 3 and 5 years), and a 5/10-year backtest of today's holdings.
- **Health / Strategy**
  - Full ETF look-through from imported issuer holdings files.
  - Providers & brokers.
  - Taxonomies: templates for asset classes, GICS sectors, MSCI regions and the Kommer portfolio, "Fill from data", targets with buy / sell, and JSON import / export.
- **Cash Flow:** an investment calendar and saving streaks.
- **Intelligence:** new emergency-fund and buying-power checks.
- **Position dialog:** each holding's own monthly returns.

| Package | Screenshots |
|---|---|
| P5-2.4 | `atlas-p5-2.4/*-{drilldown,filter,position}.jpg` |
| P5-2.5 | `atlas-p5-2.5/*-{matrix,backtest,forecast,gross}.jpg` |
| P5-2.6 | `atlas-p5-2.6/*-{irr,classes,trades,capital}.jpg` |
| P5-2.7 | `atlas-p5-2.7/*-calendar.jpg` |
| P5-2.8 | `atlas-p5-2.8/*-providers.jpg` |
| P5-2.9 | `atlas-p5-2.9/*-real.jpg` |
| P5-2.10 | `atlas-p5-2.10/*-{kommer,regions,assign}.jpg` |

## Differences from PLAN.md (decided as recommended)

- **P5-2.4:** asset class and custom category share one filter group, because they are one field (`tx.category`).
- **P5-2.5:**
  - "Forecast 24 months": the forecast already covered 1–10 years, so 24 months became the default, with month details.
  - "Backtested": today's shares against past market dividends and prices.
- **P5-2.6:** "Best/worst closed trades" ranks every sale. Whole closed positions stay in P4-2.
- **P5-2.7:** the timeline became the calendar, because per-month and per-year amounts are the P5-2.6 table.
- **P5-2.8:** "By broker" is per portfolio; the app has no separate broker field.
- **P5-2.9:** Eurostat's `prc_hicp_midx` is discontinued (last month 2025-12), so the route uses its successor `prc_hicp_minr`.
- **P5-2.10:** taxonomy targets plan through the existing rebalancing planner next to the tree. The Rebalancing view keeps its asset-class targets.

## Storage added in M2 (all in backups, no migrations)

| Key | Package | Sensitive |
|---|---|---|
| `maermin_fund_holdings` | P5-2.3 | yes (held funds) |
| `maermin_gross_net` | P5-2.5 | no (a preference) |
| `maermin_hicp_geo` | P5-2.9 | no (a preference) |
| `maermin_taxonomies` | P5-2.10 | yes (held symbols) |
| `maermin_hicp_cache` | P5-2.9 | no; public data, device-only, **not** in backups |

## Open notes

- Carried from M1, still open:
  - The demo's NVDA tax booking is a rough figure.
  - Discovery's footnote says "sourced live via your Worker" under the "Sample data" chip.
- On a phone, the wide tables (taxonomy tree, per-holding IRR, dividend matrix) scroll sideways inside their card. The key column is placed second, so it shows without scrolling.

## Owner tasks

1. **Redeploy the Worker.** It went from 2026.10.4 to 2026.10.6:
   - 2026.10.5 sends dividend events on the `yf` route, used by the dividend backtest.
   - 2026.10.6 adds `?action=hicp`, used for real returns.
   - Until the redeploy, the app shows "redeploy your Worker" hints in those two places; everything else works.
2. **Test the fund look-through (P5-2.3) with a real holdings file** from your provider (iShares / Vanguard / Xtrackers). This is still open from P5-2.3.
3. **Before M3:**
   - P5-3.1 needs the shared price Worker running under your Cloudflare account, and its URL.
   - P5-3.4 (FinTS) needs a FinTS product ID registered with the Deutsche Kreditwirtschaft.
   - Neither blocks the first M3 package from being built, because the code can ship with the shared URL empty, but both block those features from working for users.

## Next: plan for P5-3.1 Shared price Worker (fallback)

- **Worker:** an env var `PRICE_ONLY=1` turns the same code into a market-data-only deployment.
  - Allowed: `yf`, `yfsearch`, `cg`, `fundamentals`, `fundholdings`, `earnings`, `profile`, `screener`, `hicp`, `news`, `skinprices`, `version`.
  - Refused with `403 price-only`: `sync`, `share`, `mcp`, `brokerproxy`, `steaminv` and the future FinTS / aggregator routes.
  - A per-IP rate limit (KV-free, at the edge).
  - A kill switch `PRICE_ONLY_OFF=1` that answers `503`.
  - No request logging beyond the cache. `version` reports `priceOnly: true`.
- **App:**
  - The shared URL is used only when no own Worker is set; an own Worker always wins.
  - New constant `SHARED_PRICE_WORKER`, empty until the owner deploys and gives the URL.
  - Settings → Privacy and the README state who runs it and what it sees: symbols, not amounts.
  - User-data features (sync, share, MCP, broker relay) stay off without an own Worker, as today.
- **Storage:** none, apart from an optional pref to switch the shared Worker off (`maermin_shared_prices`, default on, in backups).
- **Tests:** a Worker test for every refused route in price-only mode, the kill switch and the rate limit; an app test for "own Worker wins"; e2e with the shared URL set to the mocked Worker.
