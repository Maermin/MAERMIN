# Agent brief — MAERMIN v12.2 "Atlas Charts"

You are adding a **Charts** workspace to MAERMIN in the public repository `Maermin/MAERMIN` (baseline: `main` @ `e4bb1af`, v12.1.0 "Atlas Map"). The goal is to give MAERMIN users the core of what TradingView offers for charting, built only on open-source software and the user's own Cloudflare Worker, plus one thing TradingView cannot do: the user's own trades and cost basis drawn on the chart.

Work through the packages below in order. Each package is one PR. You plan first, the owner approves, then you build. This brief is the scope. Where it conflicts with `CONTRIBUTING.md`, `PLAN.md` "House rules" or the code, stop and report the mismatch instead of picking a side.

---

## 1. Why this exists (read this before planning)

The owner compared MAERMIN with TradingView (Premium). MAERMIN already covers most of TradingView's non-chart features, so **do not rebuild any of these**. Reuse and link them:

| TradingView feature | Already in MAERMIN | Module |
|---|---|---|
| Fundamentals, analyst targets, profile | Research page | `research.js` (Worker `action=research`) |
| Watchlists | Watchlist view | `renderer.js` (view `watchlist`) |
| Screener | Discovery | `discovery.js` (Worker `action=screener`) |
| News | News Feed | Worker `action=news` |
| Earnings / dividend / central-bank calendar | Events | `event-feed.js`, `earnings-calendar.js` |
| Price alerts, push | Alerts & Rules, Worker push | `rules-engine.js`, `web-push.js`, `cf-worker/push.js` |
| Backtesting | Backtester | `backtester.js` |
| SMA / EMA / Bollinger / MACD | Research chart (line only) | `research.js` (`sma`, `ema`, `macd`, `bollinger`) |

The **gap** this brief closes:

- candlestick, OHLC bars, Heikin Ashi, area and line charts with volume;
- intraday and higher timeframes;
- a full indicator library;
- drawing tools saved per symbol;
- compare several symbols, percent and log scale;
- a technical rating summary;
- the user's buys, sells, dividends and average-cost line on the chart;
- "create alert at this price" straight from the chart.

Explicitly **out of scope**: Pine Script or any user scripting language, community ideas/social features, paper trading or order placement, real-time tick streaming / WebSockets, a market-wide heatmap, an economic calendar beyond what Events already has, multi-chart grid layouts (may come later), and any TradingView data, widget, scraping or login.

---

## 2. Read first

1. This brief, completely.
2. `CONTRIBUTING.md`: IIFE + dual export, no runtime dependencies except pinned and SRI-hashed CDN libraries, `React.createElement` (no JSX/TS), tests, Worker rebuild rule.
3. `PLAN.md`: "Decisions", "House rules", "Security", the Phase 5 package format, and the Progress table.
4. `docs/ARCHITECTURE.md`, `docs/WORKER.md`, `docs/DESIGN-SYSTEM.md` (Atlas Map tokens, components, motion).
5. Code you will touch or mirror: `research.js` (indicator maths, chart, Worker fetch pattern), `position-chart.js`, `close-history.js`, `ledger.js`, `metrics.js`, `nav-model.js`, `renderer.js` (view switch around the `research` and `discovery` cases, the position-detail `onResearch` hook), `rules-engine.js`, `backup-engine.js` (`KEYS`), `storage.js` (`SENSITIVE_KEYS`), `i18n.js` + `translations-complete.js`, `index.html` (script order, **Content-Security-Policy meta tag**), `build.mjs`, `cf-worker/worker.js` (`action === 'yf'`, `YF_INTERVALS`, `YF_RANGES`), `test/e2e/app.e2e.mjs` (how CDN scripts are mapped to local fixtures).
6. `git log --oneline -30`.

---

## 3. Owner decisions (defaults — confirm all four in the CH-0 plan)

The owner has not answered these yet. Use the default, but list each one at the top of your CH-0 plan and wait for an explicit yes or a change.

| # | Decision | Default |
|---|---|---|
| D1 | **New tab exception.** The repo rule is "integrate, don't accrete / no new tabs"; Discovery is the one sanctioned exception. Charts would be the second. | Yes, sanctioned. Record it in `ROADMAP.md` and `PLAN.md` Decisions with today's date. |
| D2 | **Placement** | Insight area → entry **Charts**, `advanced: true`, placed directly after Research in `nav-model.js`. View id `charts`, deep link and `g`+key shortcut like the other views. |
| D3 | **Chart library** | **KLineChart** `klinecharts@10.1.0` (Apache-2.0, built-in candles, volume, indicators and drawing overlays). Fallback if it fails vetting or CSP: TradingView **Lightweight Charts** `lightweight-charts@5.2.1` (Apache-2.0; no built-in indicators or drawings, so CH-3/CH-4 grow; keep its attribution). |
| D4 | **Drawings sync** | Local plus included in encrypted backup and the existing sync engine payload like other user data. No new transport. |

---

## 4. Fixed constraints

- **Privacy.** Only the symbol, interval and range leave the device (to the user's own Worker), exactly like Research today. Quantities, trades, costs and drawings never leave the device unencrypted. No telemetry. No third-party script except the one pinned chart library.
- **Data source.** The user's own Worker, `action=yf` (Yahoo chart API). No TradingView data, widgets, APIs or scraping. No new upstream host.
- **Dependency.** One CDN library, exact version, SRI `sha384`, `crossorigin="anonymous"`, loaded from `unpkg.com` or `cdnjs.cloudflare.com` like React/jsPDF. Load it **lazily** when the Charts view first opens, not on app start. Before adding it, vet it: npm publisher, repository, license, download count, recent releases, no install scripts, and that the UMD/IIFE build exposes a global. Write the findings into the CH-0 plan.
- **CSP.** `index.html` sets `script-src` to an allowlist of exact paths and `style-src 'self'`. Add only the library's exact versioned path to `script-src`. Verify in a real browser that the library renders without any CSP violation in the console (it must not inject `<style>` elements or inline `style` attributes that CSP blocks). If it needs `'unsafe-inline'` styles, **stop and report**; do not loosen the CSP.
- **One source of truth.** Positions, average cost, trades and dividends come from `ledger.js` / `MaerminMetrics`. Indicator maths shared with Research must live in one module (move, don't copy; keep Research's output identical, proven by tests).
- **EUR canonical** internally; the chart displays the listing currency by default with a EUR toggle. Convert with the existing FX history (`fx-history.js`), never with a single spot rate for history.
- **No secrets** in the repo or client code. No API keys are needed for this release.
- **UI.** `React.createElement`, Atlas Map tokens from `theme-tokens.js` (light and dark), library colours themed from the same tokens, filled buttons use `accentFill` / `onColor`. Every string through `__()` with keys in `en` and `de`. Works at 1366×900 desktop and 390×844 touch, keyboard reachable, visible focus, the chart has a text alternative (current price, change, selected range) for screen readers.
- **Demo mode** must show a meaningful chart without a Worker: add made-up OHLCV fixtures for the demo holdings (never real account data).
- **Disclaimer.** Charts and the technical rating carry the existing "no investment advice — estimates only" wording.
- **Older Worker.** If the deployed Worker does not return OHLCV yet, the Charts view still works with closes only (line/area), and shows the same "update your Worker" note Discovery uses.

---

## 5. How each package runs

1. **Pick** the first package in section 6 whose row in the Progress table is not `merged`.
2. **Plan, then wait.** Post the plan to the owner: files touched, public API, storage keys (and whether they go into `backup-engine.js` `KEYS` and `storage.js` `SENSITIVE_KEYS`), migrations, translation keys, tests, Worker route changes and Worker version bump, CSP changes, and every mismatch between this brief and the code. Write no code until the owner approves.
3. **Branch** `charts/ch-<n>-<short-name>` from the latest `main`.
4. **Test-first** for anything pure: parsing, maths, ledger mapping, storage. Write the failing Node test, then the code. Tests use the existing `ok(name, cond)` harness style.
5. **Gate** before every push: `npm run check && npm test && npm run build:web && npm run test:e2e`. After any `cf-worker/*.js` change also run `npm run build:worker` and commit the regenerated `cf-worker/worker.single.js`. For e2e, add the chart library to the CDN→local-fixture map in `test/e2e/app.e2e.mjs` the same way jsPDF is handled.
6. **Walk through** the changed flow in a real browser at 1366×900 and 390×844 (touch), in light and dark, EN and DE, demo mode. Check the console for errors and CSP violations.
7. **PR** into `main`, one per package. Body: summary diagram or diff sketch; what changed and why; how it was tested (separate *tested* from *assumed*); screenshots from demo mode; merge danger (one-way or two-way door, blast radius, whether stored data changes and how a user gets back). Also state which of these the change touches, since nobody has tested them for this feature: real iOS Safari, a screen reader, the German UI, passkeys, two-device sync.
8. **Scope discipline.** Implement exactly the package. List neighbouring refactors or bugs you noticed at the end of the PR body instead of fixing them. If a fix needs to leave scope, stop and ask.
9. **Progress table:** in the same PR, add or update the row (`in review`, branch, PR, notes a future agent needs).
10. **Merge:** the owner merges. Never push to `main`.

---

## 6. Packages

### CH-0 · Scope into the repo (docs only, S)

- Add **Phase 7 — Charts** to `PLAN.md`: this brief's sections 1, 3 (with the owner's answers), 4 and the package table, plus Progress rows CH-0 … CH-6.
- Record decision D1 in `ROADMAP.md` (sanctioned surfaces) and `PLAN.md` Decisions.
- Copy this brief to `docs/CHARTS-AGENT-PROMPT.md`.
- Include the dependency vetting result for D3.
- **Done when:** the docs PR is merged; no code changed.

### CH-1 · Worker: OHLCV in the price route (M)

Today the `yf` route keeps only `close`. Make it return candles without breaking any client.

- In `prices[]`, add `o`, `h`, `l`, `v` next to the existing `ts`, `date`, `price` (keep `price` = close; existing clients read only that). Keep a bar when `close` is valid; set missing `o/h/l/v` to `null`.
- For intraday intervals, `date` alone is not unique: keep `ts` as the key; do not change `date`'s meaning.
- Bump the cache key prefix (`yf2` → `yf3`) so old cached payloads without OHLCV are not served. Keep the TTL rules.
- Validate the interval/range pair against Yahoo's limits server-side and return a clear 400 for combinations Yahoo rejects (verify current limits; as far as known: `1m` ≈ 7 days, other intraday ≈ 60 days, `1h` ≈ 730 days).
- Bump the Worker version string and add a capability flag (e.g. `ohlcv: true`) to `action=version` so the app can detect support.
- Tests: Worker unit tests with a recorded-shape fixture (made-up numbers) for daily and intraday; `worker-single` test stays green.
- **Done when:** old clients behave identically (prove with an existing-consumer test), new fields present, `worker.single.js` regenerated, `docs/WORKER.md` and RELEASE.md "Unreleased" say the user must redeploy the Worker for candles.

### CH-2 · `chart-engine.js` — pure logic (M–L)

New module `window.MaerminChartEngine`, IIFE + dual export, no DOM, fully Node-tested.

- `parseBars(payload)` → `[{ t, o, h, l, c, v }]` sorted, de-duplicated by `t`, nulls handled; closes-only payload → bars with `o=h=l=c`, flagged `ohlc: false`.
- `toCurrency(bars, fxSeries, target)` → bars converted per day with the FX history.
- `heikinAshi(bars)`, `resample(bars, factor)` (for e.g. 4h from 1h), `percentSeries(bars, base)` for compare mode.
- **Indicator library** (move `sma`, `ema`, `macd`, `bollinger` here from `research.js`; Research then imports them, output unchanged): add RSI, Stochastic, ATR, VWAP (intraday only), OBV, Ichimoku, Donchian. Each returns arrays aligned to bars, `null` where undefined, and skips missing values the way Research does today.
- **Technical rating** `rate(bars)` → `{ score: -1..1, label: 'strong sell'|'sell'|'neutral'|'buy'|'strong buy', votes: [...] }` from a documented, deterministic vote set (moving averages vs. price, oscillators in ranges). Document the method in the file header. It is MAERMIN's own method, not a copy of TradingView's.
- **Ledger overlay** `tradeMarks(ledgerRows, symbol)` → buys, sells, dividends as `{ t, kind, qty, price }`, and `avgCostLine(...)` → stepped average-cost series. Read from `ledger.js` / `MaerminMetrics` only.
- Tests: known-value tests for every indicator (hand-computed or from a published reference series), Heikin Ashi, resample edge cases (gaps, partial last bucket), rating thresholds, trade marks for buy → partial sell → full sell → rebuy, split-adjusted prices, and a regression test that Research's chart numbers are identical before and after the move.
- **Done when:** module in `index.html` in the right order, Research uses it, all tests green.

### CH-3 · Charts view (L)

New view `charts`, wired per D2.

- **Lazy-load** the chart library on first open with SRI; show a skeleton while loading and a clear error with retry if it fails (offline, CSP, CDN down). The rest of the app must never depend on it.
- **Header:** symbol search (reuse the Worker `yfsearch` route and `ticker-validation.js`), quick picks from holdings and watchlist, last price, change, currency, EUR toggle.
- **Chart types:** candles, OHLC bars, Heikin Ashi, line, area. Volume pane on by default.
- **Timeframes:** 1m, 5m, 15m, 1h, 4h (resampled), 1D, 1W, 1M, each mapped to a valid Worker interval/range; disable combinations the Worker would reject.
- **Indicators:** add/remove from a list, with parameters; overlays on the price pane, oscillators in their own panes. Use the library's built-ins where they match `chart-engine.js` results; register custom indicators from `chart-engine.js` for the rest, so numbers are the same everywhere.
- **Compare:** up to 3 extra symbols as percent lines from a common start.
- **Scales:** linear, log, percent.
- **My trades:** toggle that draws buy/sell/dividend markers and the average-cost line for the selected symbol (the MAERMIN edge). Tooltip shows date, quantity, price in EUR.
- **Technical rating** card next to the chart with its votes and the disclaimer.
- **Entry points:** "Open in Charts" from Research, Watchlist rows and the position dialog (next to the existing `onResearch` action).
- Remember per viewer: last symbol, chart type, timeframe, indicators (light preference, `prefs-store.js`).
- Older Worker → line/area only with the update note (see section 4).
- e2e: open Charts in demo mode, switch type and timeframe, add RSI, toggle My trades, check no console errors.
- **Done when:** the gate and the browser walkthrough pass, screenshots in the PR.

### CH-4 · Drawings and alert from chart (M)

- Drawing tools: trend line, ray, horizontal line, vertical line, parallel channel, Fibonacci retracement, rectangle, text note, measure. Use the library's overlays; select, move, delete, undo of the last action.
- Persist per symbol and timeframe-independent under one new key (e.g. `maermin_chart_drawings`): add it to `backup-engine.js` `KEYS` and `storage.js` `SENSITIVE_KEYS`, include it in sync per D4, add a migration only if the schema needs one (it should not). Validate on load; drop malformed entries without crashing.
- **Alert from a horizontal line:** "Create alert at this price" creates a normal price rule in `rules-engine.js` (and so works with the existing Worker push opt-in). No second alert system.
- Tests: storage round-trip, backup/restore round-trip including the new key, malformed-data handling, rule creation payload.
- **Done when:** drawings survive reload, backup/restore and (per D4) a second device; alert appears in Alerts & Rules.

### CH-5 · Polish, accessibility, demo (S–M)

- Keyboard: timeframe and type switching, focusable toolbar, Escape closes menus.
- Screen reader text summary of the chart; reduced-motion respected.
- Touch: pinch-zoom and pan on 390×844, toolbar fits without horizontal scroll.
- Demo fixtures for every demo holding, so every feature shows something in demo mode.
- German UI review of every new string.
- **Done when:** walkthrough checklist in the PR is complete.

### CH-6 · Release v12.2.0 "Atlas Charts" (S)

- `package.json` 12.2.0, RELEASE.md section (Worker redeploy needed for candles; schema and backup format unchanged except the added key), README feature list, `docs/ARCHITECTURE.md` entry for `chart-engine.js` and the Charts view.
- **Done when:** owner runs the release workflow.

---

## 7. Stops

Stop and wait for the owner:

- after every plan (before code);
- after CH-1 merges, because the owner must redeploy their Worker before CH-3 can be tested against real data;
- whenever the library breaks CSP, needs inline styles, or fails vetting;
- whenever a test you did not write fails and looks wrong (report it; do not change it).

---

## 8. After a context reset

Read the Phase 7 Progress table in `PLAN.md` and `git log`, then continue with the first package that is not merged. If a PR is open for it, read its comments first.

## 9. Done means

CH-0 … CH-6 merged, the gate green on `main`, the owner's Worker redeployed, RELEASE.md and `package.json` at v12.2.0, and the Charts view working in demo mode and with real data on desktop and phone, EN and DE.
