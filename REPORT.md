# MAERMIN — Project Audit Report

**Date:** 2026-10-03 · **Commit:** `d33d34d` (`main`) · **Scope:** analysis only, no code changed.
**Legend:** **[E]** evidenced (executed here or read in the code, with file/line) · **[A]** assumed (not verifiable in this environment).

## 1. Summary

1. MAERMIN is a client-side multi-asset tracker (crypto, stocks/ETFs, CS2 skins, commodities) with an encrypted vault and German tax depth; ~54k lines, 95 scripts, one optional Cloudflare Worker. (The brief's project/competitor placeholders were empty, so this description and the competitor set are derived from the repo.)
2. All gates are green **[E]**: syntax check 185 files, 80 unit suites, build (1,017 KB / 301 KB gzip), 24/24 headless e2e checks.
3. The critical bugs from `docs/REVIEW-2026-09.md` that I re-ran (B1, B2, B3, B6, Basiszins 2026, vault key coverage) are fixed **[E]**.
4. Six defects remain in the core experience **[E]**: no price load after unlock (positions show −100 %), wrong Portfolio Manager totals, dividends labelled "SELL", a dead mobile "Portfolio" tab, perpetual "Loading…" in Correlation, and ISINs imported as symbols with no price.
5. Without a Worker the app prices crypto only; stocks, ETFs, skins, commodities, search, Discovery and News are unavailable **[E]**. That setup step is the largest gap against every competitor.
6. The Worker holds **no secrets and no cron** **[E]**. It does three things: CORS proxy for Yahoo/Steam, server state (sync, share, MCP), and a signed-request relay for exchanges.
7. Most of the proxy role can move to GitHub Actions–generated static data on Pages. Sync and share have serverless alternatives. Exchange sync, the MCP endpoint, the anonymous benchmark and intraday quotes still need a Worker.
8. Live upstreams (Yahoo, Steam, CoinGecko) are not reachable from this sandbox; data flows were run against the real Worker code with synthetic upstream responses. CORS behaviour of replacement APIs is **[A]** until probed in a real browser (WP-0).
9. The plan is in [`PLAN.md`](PLAN.md): 8 repair packages, then 9 feature packages. Nothing is implemented until you approve.
10. Phase 6 (usability review) runs after implementation; a baseline of current usability problems is in §6.

## 2. How this was checked

| Check | Result |
|---|---|
| `npm run check` | 185 JS files pass **[E]** |
| `npm test` | 80 suites pass, 0 failures **[E]** |
| `npm run build:web` | 95 local scripts → `dist/maermin.min.js` 1,017 KB (301 KB gzip) **[E]** |
| `npm run test:e2e` | 24 passed, 0 failed (dev entry + `dist/`); PDF export step skipped, cdnjs unreachable **[E]** |
| Own browser walkthrough | Headless Chromium against `dist/`, desktop 1366×800 and mobile 390×844. Real `cf-worker/worker.js` executed in-process; Yahoo/Steam/CoinGecko/FX answered by fixtures. Flows: first run, wizard, add transaction, refresh, all 27 views, analytics tabs, tax report, backup, CSV import, share, palette/shortcuts, demo, lock/unlock, no-Worker run **[E]** |
| Live site | `https://maermin.github.io/MAERMIN/cf-worker/worker.js` is served, so Pages publishes the **repo root** (95 unbundled scripts), not `dist/` **[E]** |

**Not executable here:** real Yahoo/Steam/CoinGecko responses, PDF export, PDF statement import, exchange sync (needs real API keys), two-device cloud sync, passkeys, notifications. These are marked "code review only" below.

## 3. Feature inventory and status

Status: **works** · **partial** · **broken** · **review** (checked by code review and unit tests only).

### Security and start-up
| Feature | Files | Status | Evidence |
|---|---|---|---|
| Vault setup, unlock, lock, wrong password | `crypto-vault.js`, `auth.js`, `storage.js` | works | Walkthrough: 8-char rule enforced, "Incorrect password" shown; `test/vault.test.js` |
| Recovery code (shown once, download/print) | `auth.js`, `crypto-vault.js` | works | Walkthrough; Continue is blocked until the checkbox is ticked. Unlock *with* the code: review |
| Passkey unlock, idle auto-lock | `crypto-vault.js` | review | Unit tests only |
| Schema migrations, plaintext adoption | `migrations.js`, `storage.js` | works | e2e: schema 3→4, year-less timestamps repaired |
| Audit log | `audit-log.js` | review | `test/audit-log.test.js` |
| Argon2id KDF | — | not found | No provider bundled (README says so); always PBKDF2-600k |

### Onboarding and data sources
| Feature | Files | Status | Evidence |
|---|---|---|---|
| Setup wizard, connection test | `onboarding.js` | works | Bad URL → red, mock Worker → four green probes |
| "Copy worker.js" | `onboarding.js:105` | partial | 404 in `dist/` (file not copied by `build.mjs`); works from repo root, which is what Pages serves today |
| Demo mode | `demo-data.js` | works | Banner, sample portfolio, exit |
| Price refresh (crypto direct, rest via Worker) | `renderer.js:1095-1520` | partial | Works on click. **No fetch after unlock** (only focus/online/5-min triggers, `renderer.js:1525-1555`) and prices start empty each session (`market-store.js:25`) |
| Alpha Vantage fallback | `renderer.js:1272-1380` | review | Not executed |
| FMP fallback (sectors, dividends) | `equity-metadata.js:22`, `dividend-data-service.js:123` | broken | `financialmodelingprep.com` is missing from CSP `connect-src` (`index.html:7`), so the browser blocks it |

### Portfolio
| Feature | Files | Status | Evidence |
|---|---|---|---|
| Add transaction, symbol picker | `renderer.js`, `features3.js` | works | Crypto and stock added; empty submit → toast "Please fill in all required fields!" |
| Overview (chart, cards, allocation, positions) | `renderer.js` | partial | Correct after refresh. Before it: top performers and attribution show −100 % / 0.00 €. Crypto ticker shown as "BITC" (first four letters of the CoinGecko id) |
| Transactions list | `renderer.js:3724-3727` | partial | Every non-buy is labelled "SELL", including dividends |
| Portfolio Manager | `features4.js:97-110` | broken | Own mini-ledger: any non-buy subtracts quantity, no FX, invested never reduced on sells. Run: 31,049.09 € vs Overview 34,238.69 € (difference = the KO position after one dividend) |
| Net worth, real assets, time deposits | `features5.js`, `real-assets.js`, `interest-engine.js` | review | View renders; add flows not executed |
| Options | `options-engine.js` | review | Unit tests only |
| Dividends (calendar, forecast, quality, YoC/DRIP, auto-book) | `dividend-*.js`, `features2.js` | works | Rendered with Worker data; falls back to built-in DB without Worker |
| Journal | `features2.js` | review | Renders; note entry not executed |

### Analysis
| Feature | Files | Status | Evidence |
|---|---|---|---|
| XIRR | `returns-engine.js`, `features2.js` | works | +32.24 % in run; USD cash flows converted (`buildCashflows`) |
| TWR | `returns-engine.js` | partial | Shows "—" until several days of manual refreshes exist |
| Benchmark overlay, FX attribution | `analytics-views.js`, `fx-attribution.js` | review | Panels render; values not validated |
| Performance cards and map | `performance-cards.js`, `performance-map.js` | works | Map correct; cards need days of snapshots |
| Rebalancing | `features2.js`, `rebalancing-planner.js` | works | Plan table rendered |
| Savings plans + auto-execution | `savings-plan-executor.js` | review | Empty state rendered; executor unit-tested |
| Cash flow | `features5.js` | works | Correct after refresh; −100 % before |
| Fee analyzer + TER | `cost-analysis.js` | works | Live TER and snapshot fallback both seen |
| Correlation matrix | `renderer-components.js:264-312` | partial | "Loading…" forever when fewer than two assets have history |
| Monte Carlo, simulator, backtester | `monte-carlo-engine.js`, `simulator-view.js`, `backtester.js` | review | Rendered; runs not triggered. Engine now uses class-based μ/σ (25 % / 80 % for crypto) |
| Stress test | `stress-test-engine.js` | works | Scenarios rendered |
| Risk level | `risk-analytics*.js` | partial | Without history shows Volatility 0.0 %, VaR 0.00, Sharpe 0.00 as if measured |
| Strategy (DCA etc.) | `investment-views.js`, `dca-analyzer-engine.js` | partial | Shows hard-coded "DCA Wins 12.50 %" figures labelled "Demo" |
| Health score, ETF X-Ray | `portfolio-health.js`, `etf-lookthrough.js` | works | Live and fallback |
| Corporate actions | `corporate-actions.js` | review | Unit tests only |
| Tax & FIFO, German fund tax, tax advisor | `tax-*.js`, `german-tax-view.js`, `ledger.js` | works | e2e KPIs; report and Excel export in walkthrough. PDF export: review (CI covers it) |

### Tools
| Feature | Files | Status | Evidence |
|---|---|---|---|
| Portfolio Intelligence | `portfolio-intelligence.js` | works | 5 ranked findings |
| Discovery | `discovery.js` | works | Via Worker; clear gate message without |
| Watchlist | `features.js` | review | Renders; free-text symbol input, no picker |
| Alerts & rules, risk monitor | `rules-engine.js`, `risk-monitor.js` | works | Breaches evaluated after refresh; notifications not executed |
| Broker CSV import | `features2.js`, `import-mapping.js`, `import-export-engine.js` | partial | TR file parsed and committed correctly (Verkauf → sell, 1.234,56 → 1234.56). Symbol stays the **ISIN**, so no price. A "No transactions detected" toast appears next to "✓ 3 valid" |
| Broker PDF import | `pdf-import.js` | review | Fixture tests only |
| Exchange sync | `exchange-sync.js` | review | Unit tests only |
| Command palette, shortcuts | `renderer.js`, `ui-store.js` | works | Ctrl+K, `g t`, `?` |
| Share & compare, benchmark | `share-snapshot.js` | works | Publish, link and aggregate against Worker + KV mock |
| MCP endpoint | `cf-worker/worker.js:137` | review | `test/mcp-endpoint.test.js` |
| Cloud sync | `sync-engine.js` | review | Four unit suites |
| Backup / CSV export | `backup-engine.js` | works | Plain JSON after native confirm; encrypted backup/restore: review |
| News | `features7.js` | works | Via Worker; gate message without |
| Tags, categories, customize, attribution | `tags.js`, `custom-categories.js`, `dashboard-layout.js`, `attribution.js` | works | Tag created; others rendered |
| Themes, language (EN/DE), currency, privacy mode | `renderer.js`, `translations-complete.js` | review | Present in settings; not exercised |
| PWA / offline | `service-worker.js`, `pwa.js` | partial | SW registers and precaches the shell. Offline reload was inconclusive in the harness (React from CDN not cached) |
| Mobile bottom nav | `features2.js:1292-1298` | broken | "Portfolio" sends `portfolio`; the router has no such case and falls back to Overview (`renderer.js:2785`). 22 of 27 views are reachable only through the search palette |

### Worker and hosting
| Feature | Files | Status | Evidence |
|---|---|---|---|
| Worker routes | `cf-worker/worker.js` | works (mock upstream) | All market routes exercised through the client; hardening tests pass. Real Yahoo crumb / Steam throttling: not executable |
| Secrets in Worker | — | not found | No `env.*KEY` use; `PRICEMPIRE_KEY` appears only in a `wrangler.toml` comment |
| Pages deploy workflow | `.github/workflows/` | not found | Only CI; Pages serves the repo root |
| Desktop/Electron app | — | not found | Only referenced in docs (`null` origin) |

## 4. Competitor comparison

Competitors come from `ROADMAP.md` (Parqet, getquin, Snowball, Delta) plus the open-source/local-first peers Ghostfolio, Portfolio Performance and Wealthfolio. "n/s" = not stated in the sources read.

| Capability | MAERMIN | Parqet | getquin | Snowball | Delta | Ghostfolio | Portfolio Perf. | Wealthfolio |
|---|---|---|---|---|---|---|---|---|
| Works with zero setup | No (Worker deploy for anything but crypto) | Yes | Yes | Yes | Yes | Hosted: yes; self-host needs Postgres + Redis | Yes (desktop) | Yes (desktop/mobile) |
| Data stays on device | Yes, encrypted vault | No (cloud) | No (cloud) | No | No | Self-host only | Yes (XML file) | Yes |
| Price | Free, MIT | Free; Plus €11.99/mo; Investor €29.99/mo | n/s | Free; $79.99–$249.99/yr | PRO price n/s | AGPL; Premium price n/s | Free, EPL | Free; paid Connect |
| Broker auto-sync | Crypto exchanges only, via Worker | 5 brokers | "Thousands of providers" | "Link brokerage" (Starter+) | 10,000+ | n/s | No | Paid Connect |
| File import | ~10 CSV formats, 5 PDF | 50+ brokers PDF/CSV | PDF + manual | Broker reports | n/s | Import/export | PDF from 90+ banks/brokers | CSV |
| Stocks, ETFs, crypto | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Other assets | CS2 skins, commodities, real estate, options, custom | P2P, tokenised assets, cash | n/s | Custom holdings | Forex, indices, commodities | n/s | n/s | n/s |
| Currencies | EUR/USD transactions; quotes converted via USD table | 40+ | n/s | n/s | n/s | n/s | Multi-currency, ECB rates | n/s |
| TWR out of the box | No (needs days of refreshes) | Yes | Yes | n/s | n/s | ROAI | TTWROR + IRR | Yes |
| Benchmarks | Yes | Plus | Yes | Limited free | n/s | n/s | n/s | n/s |
| Dividend calendar/forecast | Yes, with quality score | Personalised: Plus | Yes | Yes, rating on Starter+ | n/s | n/s | Via transactions | Yes |
| ETF X-Ray | Yes | Plus | Yes | n/s | n/s | n/s | n/s | n/s |
| Tax reporting | Deep (DE FIFO, Vorabpauschale, Teilfreistellung) | Tax dashboard: Plus | n/s | n/s | n/s | n/s | Taxes recorded | n/s |
| Rebalancing | Yes | n/s | n/s | Yes | n/s | n/s | Yes | Yes |
| Monte Carlo / FIRE / backtest | Yes | n/s | Premium | 30+ yr backtests (Investor) | n/s | n/s | n/s | Yes |
| Native mobile app | PWA | iOS/Android | iOS/Android | n/s | iOS/Android | PWA | iOS/Android | iOS/Android |
| Device sync | E2E via own Worker | Cloud | Cloud | Cloud | n/s | Server | File-based | Paid encrypted sync |
| Alerts when app is closed | No | n/s | n/s | Push + email | Push | n/s | n/s | n/s |
| AI assistant | MCP endpoint only | n/s | Yes | n/s | "Why is it moving" | n/s | n/s | Yes |
| Community/sharing | Redacted link + benchmark | Public portfolios | Social feed | n/s | n/s | n/s | n/s | n/s |

**Reading:** MAERMIN already matches or beats the paid tiers on analysis depth, German tax and privacy. It loses on getting data in (setup, import breadth, ISIN handling) and on first-run correctness of numbers.

### Missing features, prioritised

| # | Gap | User value | Effort | Client-only? | Package |
|---|---|---|---|---|---|
| 1 | Prices, search and history without deploying a Worker | Very high | L | Yes (static data + BYO key) | WP-9, WP-10 |
| 2 | ISIN → ticker on import | High | M | Yes (static symbol index) | WP-6 |
| 3 | TWR and chart history from day one | High | M | Yes | WP-12 |
| 4 | More transaction currencies (CHF, GBP …) and historical FX | Medium | M | Yes (ECB rates) | WP-11 |
| 5 | Share link and sync without a Worker | Medium | S + M | Yes | WP-13, WP-14 |
| 6 | Fully usable mobile navigation | Medium | S | Yes | WP-4 |
| 7 | Wider importer coverage (Parqet 50+, PP 90+) | Medium | L, ongoing | Yes | WP-16 |
| 8 | Self-hosted libraries and fonts (true offline, no third-party requests) | Medium | S | Yes | WP-15 |
| 9 | Broker auto-sync via Open Banking | High | — | **No** (licensed aggregator + secrets) | not planned |
| 10 | Push/email alerts while the app is closed | Medium | — | **No** (needs a server) | not planned |
| 11 | AI assistant with a user-supplied key | Low–medium | L | Yes | later |

## 5. GitHub Pages without a Worker

**What the Worker does today [E]:** (a) CORS proxy for Yahoo Finance and Steam, (b) server state in KV/Durable Object for sync, share and MCP, (c) relay for client-signed exchange requests. No secrets, no cron.

| Feature | Today | Pure Pages option | Worker still needed? |
|---|---|---|---|
| Crypto prices, history, search | Direct CoinGecko **[E]** | Unchanged | No |
| USD→EUR live rate | Direct `open.er-api.com` **[E]** | Unchanged | No |
| Historical FX | Worker (`EURUSD=X`) | ECB rates from Frankfurter (no key, history) | No, if CORS confirmed **[A]** |
| Stock/ETF/commodity **EOD** prices and history | Worker → Yahoo | GitHub Actions writes per-symbol JSON for a curated universe to Pages; client fetches same-origin | No, for the universe |
| Symbols outside the universe | Worker → Yahoo | User's own Alpha Vantage / Twelve Data / Finnhub key from the vault (Alpha Vantage is already called directly **[E]**) | No, with a user key |
| **Intraday** quotes (1H/1D chart) | Worker → Yahoo | None without a proxy or a user key | **Yes** — CORS proxy |
| Symbol search, ISIN lookup | Worker → Yahoo | Static search index built by Actions, searched in the browser | No |
| ETF holdings, TER, sector/country, fundamentals, earnings dates | Worker → Yahoo `quoteSummary` | Weekly Actions job → static JSON (a snapshot fallback already exists **[E]**) | No, for the universe |
| Discovery / top movers | Worker → Yahoo screener | Daily Actions job → static JSON (end-of-day movers) | No (EOD only) |
| News | Worker → Yahoo RSS | Link out per symbol; no in-app feed | **Yes** for an in-app feed — RSS has no CORS |
| CS2 prices and search | Worker → Steam | Actions job pulls Skinport `/v1/items` (no auth, whole catalogue per call) → static JSON | No |
| CS2 price history | Worker → Steam listing page | Accumulate daily snapshots from the job; no back-history | **Yes** for history before the job started |
| Split detection | Worker → Yahoo events | Include splits in the static price files | No |
| Savings plans, dividend booking, interest accrual | On app open **[E]** | Unchanged | No |
| Tax, analytics, Monte Carlo, PDF parsing | Browser, Web Worker **[E]** | Unchanged | No |
| Vault, backup | Browser **[E]** | Unchanged | No |
| Share link | Worker KV | Encode the redacted snapshot in the URL fragment | No |
| Anonymous benchmark | Worker KV aggregate | Static reference allocations instead | **Yes** for a real aggregate — server-side state |
| MCP endpoint | Worker | "Copy redacted snapshot" for pasting into an assistant | **Yes** — needs an HTTP endpoint |
| Cloud sync | Worker KV/DO | User's own private Gist via GitHub API (their token, stored in the vault), or encrypted file in a synced folder | No (state lives in the user's storage) |
| Exchange sync | Worker relay | CSV import | **Yes** — exchange APIs send no CORS headers (`docs/WORKER.md`) **[A]** |
| Price alerts while the app is closed | Not available | Not possible | Would need cron + push |

**API keys:** the project has none of its own. User-supplied keys stay in the encrypted vault. If an Actions job ever needs a paid data key, it lives in GitHub Actions secrets; only the generated public data reaches Pages.

**Constraints of the static-data route:** data is end-of-day; the universe is finite; scheduled workflows are best-effort; the published data is public, and Yahoo's terms do not allow redistribution, so the data source is an open question (§7). Requesting per-symbol files reveals held symbols to GitHub's CDN, comparable to what a Worker sees today.

## 6. Usability baseline (before implementation)

Phase 6 proper follows implementation. Problems observed now, by severity:

| Sev | Problem | Evidence | Suggested fix |
|---|---|---|---|
| High | After unlock, holdings show −100 % / 0.00 € until a manual refresh | Seeded run, Overview/Portfolios/Cash flow/Attribution | Fetch on unlock, persist last prices, show "price unavailable" instead of 0 |
| High | Mobile: "Portfolio" tab does nothing; most views only via search | `features2.js:1294` | Fix id, add a "More" sheet listing all views |
| High | First run offers no stock prices without a Cloudflare account | Wizard | Static data by default (WP-9/10) |
| Medium | Correlation shows "Loading…" forever; Risk shows zeros as results | Analytics tabs | Explicit empty states with the reason and next step |
| Medium | Native `confirm()`/`alert()` for backup warning and PDF failure | `renderer.js:1661`, `tax-report-builder.js:426` | In-app dialog and toast |
| Medium | Setup says "There is no recovery", then issues a recovery code | Setup screen | Reword |
| Medium | Form fields have no programmatic labels; wizard has no `role="dialog"` | 2/2 inputs unlabeled on Overview; modal markup | `<label for>` / `aria-label`, dialog role and focus trap |
| Medium | Import shows "No transactions detected" beside "✓ 3 valid" | CSV import run | Remove the stale toast |
| Low | Focus ring is a box-shadow only (`outline: none`) | Tab-order probe | Keep, but check visibility in the light and contrast themes |
| Low | Active range chip: white on purple, 3.27:1 at 12 px | Contrast probe (rest of Overview passes 4.5:1) | Darker accent or bold 14 px |
| Low | Analytics tab buttons 37 px high on mobile | Touch-target probe | 44 px minimum |
| Low | Position logos load from `s.yimg.com`, revealing held tickers to a third party | `features3.js:932` | Drop or proxy logos; README lists only three outbound hosts |
| Info | Load time is fine locally (DOMContentLoaded ≈ 125 ms from `dist/`); live Pages serves 95 separate scripts | Timing probe, live site | Deploy `dist/` (WP-8) |

## 7. Open questions for you

1. **Target user:** is the German retail investor the primary audience? It decides the static-data universe (Xetra ETFs first) and importer priorities.
2. **Data source for the Actions pipeline:** Yahoo data may not be redistributed. Do you accept that risk, prefer a licensed/free source with fewer symbols, or want user-supplied keys only?
3. **Worker's future:** keep it as an optional "pro" add-on (intraday, exchange sync, MCP, benchmark), or remove those features entirely?
4. **Pages deployment:** may I switch Pages to deploy `dist/` through a workflow? This needs "Source: GitHub Actions" in the repo settings.
5. **Sync target:** private GitHub Gist, file-based, or both?
6. **FMP fallback:** allow the host in the CSP or remove the integration?
7. **Scope of the earlier review:** its sync last-write-wins and tax-pot findings were not re-verified here. Should they join the repair list?

## 8. Sources

- [Parqet pricing](https://parqet.com/pricing) · [Parqet review (etf.capital)](https://etf.capital/parqet-app/)
- [getquin](https://www.getquin.com/) · [getquin review (etf.capital)](https://etf.capital/getquin-app/)
- [Snowball Analytics pricing](https://snowball-analytics.com/public/pricing)
- [Delta by eToro](https://etoro.com/investing/delta)
- [Ghostfolio README](https://github.com/ghostfolio/ghostfolio)
- [Portfolio Performance](https://www.portfolio-performance.info/en/) · [PDF import manual](https://help.portfolio-performance.info/en/reference/file/import/pdf-import/)
- [Wealthfolio](https://wealthfolio.app/)
- [Frankfurter API](https://frankfurter.dev/) · [Skinport items API](https://docs.skinport.com/items)
