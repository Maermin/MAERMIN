# MAERMIN — Implementation Plan

**Status:** scope confirmed 2026-10-03. Work proceeds one PR per package; the owner merges.
**Basis:** [`REPORT.md`](REPORT.md) (audit of `main` @ `d33d34d`).

## Confirmed scope

Decisions: MAERMIN is a single-user app for now; the Cloudflare Worker stays the data source; GitHub Pages keeps serving the repo root.

| Order | Package | Decision |
|---|---|---|
| 1 | WP-1 Prices after unlock | Fetch once on unlock; persist the last price map. Missing fresh price → last known price marked "stale" with date, else cost marked "no price" — in every view |
| 2 | WP-2 Portfolio Manager | Use the shared ledger |
| 3 | WP-3 Transaction labels | Dividend / interest / option labels |
| 4 | WP-4 Mobile | Fix the dead "Portfolio" tab only; no "More" sheet |
| 5 | WP-5 Empty states | Correlation, Risk, DCA demo figures |
| 6 | FMP removal (from WP-7) | Delete the fallback and its key field |
| 7 | WP-6 ISIN on import | Resolve via the Worker search; propose the listing matching the trade currency; editable per row |
| 8 | WP-12 TWR from day one | From historical closes served by the Worker |
| 9 | WP-11 More currencies | CHF, GBP etc.; historical rates through the Worker, no new third-party host |
| 10 | WP-16 Importers | Trade Republic, Scalable Capital, Consorsbank — one at a time from the owner's export files |

**Dropped:** WP-0, WP-8, WP-9, WP-10, WP-13, WP-14, WP-15 and the rest of WP-7 (native dialogs, setup copy, crypto ticker display, logo requests).
**No work needed:** the September review's sync-merge and tax-pot findings are fixed in the current code.
**Crypto exchanges:** no new code up front; the existing read-only API sync (Binance, Kraken, Coinbase, Bitpanda) is tried with real keys and fixed where it fails.
**Needed from the owner:** one export file each from Trade Republic, Scalable Capital and Consorsbank before package 10.

The package descriptions below are the original proposal; where they differ from the table above, the table wins.

**Effort:** S ≤ ½ day · M 1–3 days · L > 3 days.
**House rules kept:** pure logic in dual-export IIFE modules with Node tests; no new tabs unless stated; new persisted keys go into `backup-engine.js` `KEYS` and `storage.js` `SENSITIVE_KEYS`; no API key ever in client code or in the repo.

Every package ends with the same gate: `npm run check && npm test && npm run build:web && npm run test:e2e`.

---

## Part A — Repairs

### WP-1 · Correct numbers right after unlock (M)
- **Goal:** no view shows −100 % or 0.00 € because prices have not loaded yet.
- **Files:** `renderer.js` (auto-refresh effect ~1525, overview/attribution fallbacks), `market-store.js`, `storage.js`, `backup-engine.js`, `metrics.js`, `features4.js`, `features5.js`, `attribution.js`.
- **Approach:** (1) trigger one `fetchPrices()` when the app mounts after unlock; (2) persist the last price map with its timestamp in a new sensitive key and hydrate it on start; (3) one helper in `MaerminMetrics` returning `{ price, known }`, used by every view so a missing price renders "—" and is excluded from P&L instead of counting as zero.
- **Dependencies:** none.
- **Acceptance:** with seeded holdings and no click, the Overview shows last-known values within the first render and fresh values after the automatic fetch; with the network blocked, positions show "price unavailable" and totals exclude them consistently in Overview, Portfolios, Cash flow and Attribution.
- **Test:** new e2e scenario (seed → reload → unlock → assert no "-100.00%"); unit test for the price helper.

### WP-2 · Portfolio Manager uses the shared ledger (S)
- **Goal:** per-portfolio value and P&L equal the Overview for the same portfolio.
- **Files:** `features4.js:92-112`, `metrics.js`.
- **Approach:** delete the local holdings loop; call `MaerminMetrics.buildPositions` + `computeStats` per `portfolioId` (FX, fees, splits, dividends handled once).
- **Dependencies:** WP-1 (price helper).
- **Acceptance:** a portfolio containing a USD buy, a partial sell and a dividend shows the same value as the Overview filtered to that portfolio.
- **Test:** unit test with that fixture; e2e assertion comparing both figures.

### WP-3 · Transaction types labelled correctly (S)
- **Goal:** dividends, interest and option trades are not shown as "SELL".
- **Files:** `renderer.js:3720-3730` and `4195-4210`, `features3.js:320`, `features5.js:595`, `translations-complete.js`.
- **Approach:** one `MaerminUtils.txTypeLabel(type)` with colour mapping; replace the `type === 'buy' ? … : …` ternaries.
- **Acceptance:** a dividend row reads "Dividend" in the list, position modal and net-worth history, in EN and DE.
- **Test:** unit test for the mapper; e2e text check.

### WP-4 · Mobile navigation (S)
- **Goal:** every view is reachable on a phone without the search palette.
- **Files:** `features2.js:1292-1310`, `styles.css` (`.mx-bottom-nav`), `renderer.js`.
- **Approach:** fix the `portfolio` → `portfolios` id; replace the "Watch" slot with "More", opening a sheet that lists the same hubs as the sidebar; 44 px minimum targets.
- **Acceptance:** at 390×844 each of the 27 views opens in at most two taps; the active tab is marked.
- **Test:** e2e mobile loop over all views.

### WP-5 · Honest empty states in analytics (S–M)
- **Goal:** no perpetual "Loading…" and no zeros presented as measurements.
- **Files:** `renderer-components.js:259-315`, `risk-analytics-view-v2.js`, `investment-views.js` (DCA demo figures), `features2.js` (TWR note).
- **Approach:** distinguish *loading*, *not enough data* and *result*; state what is missing and how to get it. Remove the hard-coded DCA demo numbers.
- **Dependencies:** WP-12 removes most "not enough data" cases later.
- **Acceptance:** a new portfolio shows an explanatory empty state in Correlation, Risk and DCA; no numeric KPI is rendered without input data.
- **Test:** view smoke tests with empty history.

### WP-6 · ISIN handling on import (M)
- **Goal:** imported rows carry a priceable ticker.
- **Files:** `import-mapping.js`, `import-export-engine.js`, `features2.js` (wizard preview, stale toast at 708), `ticker-validation.js`.
- **Approach:** detect ISINs in the symbol column; resolve through the static symbol index (WP-9) or, when a Worker is configured, `yfsearch`; show the proposed ticker in the preview, editable; keep the ISIN on the transaction. Remove the contradictory "No transactions detected" toast.
- **Dependencies:** WP-9 for the Worker-less path (Worker path can ship first).
- **Acceptance:** the Trade Republic sample (ISIN `US0378331005`) imports as `AAPL` and is priced after refresh; unresolved ISINs are flagged, not silently imported.
- **Test:** unit tests for detection/resolution with an injected resolver; e2e import.

### WP-7 · Small correctness and copy fixes (S)
- **Goal:** remove the remaining broken or misleading bits.
- **Files:** `index.html:7` + `build.mjs` (CSP), `equity-metadata.js`, `dividend-data-service.js`, `onboarding.js`, `auth.js:202`, `renderer.js:1661`, `tax-report-builder.js:424-427`, `features3.js:932`.
- **Approach:** FMP: add the host to `connect-src` or remove the integration (your decision, REPORT §7.6); ship `cf-worker/worker.js` into `dist/` for "Copy worker.js"; reword "There is no recovery"; replace native `confirm`/`alert` with the in-app dialog and toasts; show the real ticker for crypto instead of "BITC"; drop the `s.yimg.com` logo requests or document them.
- **Acceptance:** each item verifiable in the UI; no native dialogs in the backup and PDF flows.
- **Test:** e2e for copy button in `dist/`; grep gate for `alert(`/`confirm(`.

### WP-8 · Deploy the built bundle to Pages (S)
- **Goal:** Pages serves `dist/` (one bundle) instead of 95 scripts from the repo root.
- **Files:** new `.github/workflows/pages.yml`, `build.mjs`, `README.md`.
- **Approach:** workflow builds on push to `main` and deploys with `actions/deploy-pages`; later packages add generated data to the same artifact.
- **Dependencies:** you switch Pages source to "GitHub Actions" (REPORT §7.4).
- **Acceptance:** live site loads `maermin.min.js`; service worker updates cleanly from the old layout.
- **Test:** workflow run; manual check of the live URL on desktop and phone.

---

## Part B — New features (Worker-less first)

### WP-0 · CORS and source probe (S) — prerequisite for Part B
- **Goal:** replace assumptions in REPORT §5 with facts.
- **Files:** `scripts/probe.html` (not shipped).
- **Approach:** a page run in a real browser from the Pages origin that fetches each candidate (Frankfurter, Skinport, Alpha Vantage, Twelve Data, Finnhub, GitHub API, Binance/Kraken/Coinbase/Bitpanda) and records status and CORS result.
- **Acceptance:** a table of results committed to `docs/`; Part B packages adjusted if a source fails.
- **Test:** the probe itself.

### WP-9 · Static market-data pipeline (L)
- **Goal:** prices, history, search and fund data for a curated universe with no Worker and no key.
- **Files:** new `scripts/data/*.mjs`, `.github/workflows/data.yml`, published under `data/` in the Pages artifact.
- **Approach:** scheduled Actions jobs generate: `symbols.json` (ticker, name, ISIN, exchange, currency) as search index; `prices/<symbol>.json` (daily closes + splits); `funds/<symbol>.json` (holdings, sectors, TER); `fundamentals/<symbol>.json`; `movers.json`; `cs2/prices.json` + item index from Skinport. Data is published in the deploy artifact, not committed to `main`. Any paid source key lives in Actions secrets.
- **Dependencies:** WP-0, WP-8, decision on data source and universe (REPORT §7.1–7.2).
- **Acceptance:** files regenerate on schedule; a failed source leaves the previous files in place; total artifact stays under the Pages size limit.
- **Test:** Node tests for each generator against recorded fixtures; schema check in CI.

### WP-10 · Data-provider layer in the client (M)
- **Goal:** one module decides where a quote comes from: static data → user key → Worker.
- **Files:** new `data-providers.js` (+ test), `renderer.js` (fetchPrices, history, search), `features3.js` (pickers), `discovery.js`, `etf-lookthrough.js`, `dividend-data-service.js`, `equity-metadata.js`, `onboarding.js`, CSP.
- **Approach:** pure provider interface with injectable `fetch`; existing Worker calls become one provider; the wizard's first option becomes "works out of the box", Worker and API keys become optional upgrades. Each price carries its source and date; EOD prices are labelled as such.
- **Dependencies:** WP-9, WP-1.
- **Acceptance:** fresh vault, no Worker: adding `VWCE.DE` and `AAPL` yields prices, 5-year chart, X-Ray and dividends; a symbol outside the universe explains the options.
- **Test:** unit tests per provider and for fallback order; e2e "no Worker" scenario.

### WP-11 · ECB FX history and more transaction currencies (M)
- **Goal:** CHF, GBP and other currencies in transactions; FX history without the Worker.
- **Files:** `fx-history.js`, `utils.js`, `ledger.js`, `metrics.js`, `renderer.js` (currency select), `import-mapping.js`.
- **Approach:** per-currency daily series from Frankfurter cached in IndexedDB; `fxAt(date, currency)` generalised from USD-only; transaction modal and importers accept ISO currencies.
- **Dependencies:** WP-0.
- **Acceptance:** a CHF buy is costed at the ECB rate of its date; tax report and XIRR reflect it.
- **Test:** ledger and tax tests with CHF/GBP fixtures.

### WP-12 · TWR and value history from day one (M)
- **Goal:** time-weighted return and benchmark comparison without waiting days.
- **Files:** `returns-engine.js`, `analytics-data.js`, `features2.js`, `portfolio-snapshots.js`.
- **Approach:** build the daily value path from transactions × historical closes (WP-10) with external flows chain-linked; snapshots remain the fallback.
- **Dependencies:** WP-10.
- **Acceptance:** importing a three-year history shows TWR, rolling volatility and correlation immediately.
- **Test:** unit tests with synthetic series and flows (known TWR).

### WP-13 · Share links without a server (S)
- **Goal:** sharing works with no Worker.
- **Files:** `share-snapshot.js` (+ test), `renderer.js`.
- **Approach:** encode the already-validated redacted snapshot in the URL fragment; the existing allowlist validation runs on open. Worker publish stays as an option for short links, MCP and the benchmark.
- **Acceptance:** a link opened in a clean browser renders the snapshot; a tampered fragment is rejected.
- **Test:** round-trip and leak-proof unit tests.

### WP-14 · Serverless sync (M)
- **Goal:** device sync without running a Worker.
- **Files:** `sync-engine.js` (transport interface), new `sync-transport-gist.js`, `sync-transport-file.js`, settings modal in `renderer.js`.
- **Approach:** keep the E2E blob and revision logic; add transports for a private Gist (user's fine-grained token, stored in the vault) and an encrypted file in a user-chosen folder.
- **Dependencies:** WP-0 (GitHub API from the browser), decision in REPORT §7.5.
- **Acceptance:** two browsers converge after edits on both; conflicting revisions merge as today.
- **Test:** existing sync suites run against each transport with a fake backend.

### WP-15 · Self-host libraries and fonts (S)
- **Goal:** true offline start and no third-party requests at load.
- **Files:** `index.html`, `build.mjs`, `service-worker.js`, `tax-report-builder.js`, `pdf-import.js`, `styles.css`.
- **Approach:** vendor React, jsPDF, autotable, pdf.js and the Geist fonts into the build; precache them; tighten the CSP.
- **Acceptance:** after one visit the app starts and unlocks in airplane mode; the network log at start shows only same-origin requests.
- **Test:** e2e offline scenario with service workers enabled.

### WP-16 · Importer coverage (L, incremental)
- **Goal:** close the import gap for the most used German brokers.
- **Files:** `import-mapping.js`, `pdf-import.js`, fixtures in `test/`.
- **Approach:** one broker per iteration, driven by anonymised sample files; order to be agreed (suggestion: Trade Republic current CSV, ING, comdirect, Consorsbank, Scalable).
- **Dependencies:** WP-6; sample files from you.
- **Acceptance:** per broker, the sample file imports with no manual mapping.
- **Test:** fixture tests per broker.

**Not planned** (cannot run on Pages without a server): Open-Banking broker sync, push/email alerts while the app is closed, a live anonymous benchmark, an MCP endpoint, intraday quotes without a user key. They remain available through the optional Worker where they exist today.

---

## Part C — Phase 6 usability review

After Part A (and again after Part B): walk first run, add transaction, import, refresh, tax export, backup/restore and sync on desktop and mobile; check clarity, step count, error messages, load time, empty states, keyboard navigation and contrast in all five themes; deliver a severity-sorted list with fixes. Baseline: REPORT §6.

## Suggested sequence

1. WP-1 → WP-2 → WP-3 → WP-4 → WP-5 → WP-7 (one PR each, all independent of your open decisions except FMP).
2. WP-8, then WP-0.
3. WP-9 → WP-10 → WP-6 (static path) → WP-12 → WP-11.
4. WP-13, WP-15, WP-14, WP-16.
