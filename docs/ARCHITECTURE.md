# MAERMIN — Architecture

MAERMIN is a **fully client-side** multi-asset portfolio tracker. It ships two
ways from the same source:

- **Web** (GitHub Pages / any static host) — `index.html` loads plain global
  scripts; `build.mjs` concatenates + minifies them into `dist/`.

There is **no backend and no database**. State lives in the browser's
`localStorage`; an optional Cloudflare Worker only proxies market data and an
opt-in, zero-knowledge encrypted sync blob.

---

## Module pattern

Every module is a self-contained IIFE that attaches a single global:

```js
(function () {
  'use strict';
  /* ... */
  var api = { /* ... */ };
  if (typeof window !== 'undefined') window.MaerminX = api;     // browser
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node tests
})();
```

This dual export is what lets the pure logic be unit-tested under Node
(`test/*.test.js`) without a browser or bundler. UI is built with **React 18 via
CDN using `React.createElement` (no JSX, no TypeScript)**.

Scripts load in a fixed order in `index.html`; `build.mjs` reads that order, so
**adding a module = adding one `<script>` tag** (and it's automatically bundled).

---

## Load order (security first)

```
audit-log.js → crypto-vault.js → storage.js → migrations.js → auth.js
            → utils / engines → dividend / metadata → views (features*) → renderer.js
```

`auth.js` gates the React mount: `renderer.js` awaits `MaerminAuth.whenUnlocked()`
before rendering, so the app always reads decrypted data. Schema migrations run
at mount (post-unlock) via `MaerminPreMigration.guardedRun()`: when a migration is
pending it first stores an encrypted copy of every backup key in IndexedDB, then
calls `MaerminMigrations.run()`. If the copy cannot be written, the migrations
wait for the next load.

---

## Security layer

| Module | Global | Responsibility |
|--------|--------|----------------|
| `crypto-vault.js` | `MaerminVault` | AES-256-GCM; PBKDF2-600k KDF (Argon2id only if a provider is registered via `registerKdf` — none is bundled); KDF name and parameters checked before use (`validateMeta`: registered KDFs only, PBKDF2 600k–10M SHA-256/512); wrap-check (no password stored); envelopes `1.` (no associated data, still read) and `2.` (bound to a context such as `rec:<key>` as AES-GCM associated data); HKDF sub-keys; idle auto-lock (key bytes zeroed, `lockSettled()` resolves after the final save); WebAuthn-PRF passkeys (new ones: user verification required, HKDF of the PRF output; older enrolments keep their mode) and `removePasskey`; **printable recovery-code kit** — a second wrapping of the vault key (`enrollRecovery`/`unlockWithRecovery`), the code is shown once and never stored/transmitted; **key rotation** — `prepareRotation(password)` builds a new random data key and its meta, `commit()` writes the meta (the single commit point) and switches the session |
| `storage.js` | `MaerminStorage` | Transparent encryption-at-rest shim over `localStorage` for a fixed set of sensitive keys; reversible plaintext backup; portable **encrypted** backup export/import (an imported meta is validated). Records are bound to their name (`rec:<key>`, `manifest`, `blob`); a v1 store is rewritten in that format on the first save, a v2 manifest refuses unbound records. `rekey(handle)` re-encrypts the store under a rotated key: staged copy (`maermin_vault_manifest:next` / `maermin_vault_data:next`) → meta commit → promote; the next unlock finishes or drops an interrupted rotation |
| `auth.js` rotation | `MaerminAuth.rotateKey` | Orchestrates SEC-017: exchange credentials and the pre-migration copy are read under the old key, the old sync account gets a "rotated" record, `Storage.rekey` commits the new key, then credentials and copy are written under the new key and sync starts over on the new account |
| `auth.js` | `MaerminAuth` | Setup / unlock / lock UI; mount gate; change-password; one-time recovery-code reveal at setup + recovery-code unlock path |
| `audit-log.js` | `MaerminAuditLog` | On-device event + error trail (non-sensitive, ring-buffered); errors are kept by type (`errorLabel`), never by message |
| `migrations.js` | `MaerminMigrations` | Versioned, idempotent localStorage migrations |
| `sync-engine.js` | `MaerminSync` | Opt-in encrypted sync: snapshot of the encrypted data keys minus device-local ones, three-way merge, write key + MAC per put; a remote snapshot may only set those same keys (`syncableKey`; vault meta, Worker URL and local keys are dropped and reported by `lastDropped`) |
| `premigration-backup.js` | `MaerminPreMigration` | Encrypted copy of the data before a pending migration (one IndexedDB record `maermin_premigration_backup`, vault key, not synced, not in the backup); restore / delete in Settings → Trash |

**Content-Security-Policy** (meta tag in `index.html`, the same list in `build.mjs`, `test/csp.test.js` keeps them
equal): `default-src 'self'`, scripts from this site and the pinned CDN paths, `style-src 'self'` (no inline
`<style>`: the lock screen and install toast styles are in `styles.css`; React and `style.cssText` use CSSOM, which
the policy allows), images from the Steam CDN, Yahoo logos and CoinGecko, `connect-src` this site, the two rate
services and `*.workers.dev`, `form-action`/`frame-src`/`object-src 'none'`.

---

## Domain / data model

Transactions are the source of truth:

```
transaction = { id, type(buy|sell|dividend|interest|…), category(crypto|stocks|skins|commodities),
                symbol, symbolName?, quantity, price, fees?, currency(EUR|USD), date, portfolioId, notes? }

cash row    = { id, type(deposit|withdrawal|transfer_in|transfer_out|fee|fee_refund|tax|tax_refund|interest_charge),
                category: 'cashflow', amount (> 0), currency, date, portfolioId, notes?,
                transferId? + counterPortfolioId? (a transfer is a pair, one row per portfolio) }
```

Cash rows (P5-1.3) never create positions or lots. `MaerminLedger.cashFlows` gives their
signed EUR amounts (sign = effect on the portfolio's cash); fees, taxes, refunds and interest
charges are XIRR flows, deposits, withdrawals and transfers wait for the clearing account (P5-1.4).
The dialog saves them through `MaerminUtils.upsertCash` (a transfer pair is edited and deleted as one).

A portfolio can keep a clearing account (P5-1.4, `portfolio.clearing = { enabled, openingBalance, openingDate }`
in `maermin_portfolios`). `MaerminLedger.clearingBalance` derives its EUR balance from the bookings (buys,
sells, payouts, cash rows); with it on, XIRR uses only deposits and withdrawals (`MaerminReturns.clearingCashflows`),
the daily value path adds the cash to the value (`build(…, { clearing })`), the overview and Net Worth show the
cash, and a balance below zero is the data-check finding `DQ-CASH-NEGATIVE` (action: book the missing deposits).

Everything else is **derived** from transactions (single source of truth in
`metrics.js`):

- `MaerminLedger.build(transactions, {exchangeRate, fxAt})` (`ledger.js`) — the
  ONE FIFO implementation: open lots and disposals per category + symbol, buy
  fees in the cost basis, sell fees pro-rated, USD legs at the FX rate of their
  date, splits applied, same-day buys before sells, oversells reported. The
  positions list, tax report, FIFO tab, Realized vs Unrealized, the tax
  advisor's crypto lots and yield-on-cost all read from it.
- `MaerminMetrics.buildPositions(transactions, {exchangeRate, fxAt})` → grouped
  `{crypto,stocks,skins,commodities}` with the EUR cost basis of the open FIFO
  lots (via the ledger).
- `MaerminMetrics.computeStats(portfolio, prices)` → value / invested / P&L.
- Net worth, FIRE, concentration, drift, currency exposure, tax-loss harvest.

The canonical internal currency is **EUR**; USD transactions are converted at
the historical rate of their date (`MaerminFxHistory.fxResolver`, falling back
to the live `USD→EUR` rate). Live quotes in other currencies (GBp pence, CHF, …)
convert through the USD cross rates (`MaerminFxHistory.quoteToEUR`). Display
conversion happens only at format time (`formatPrice`).

### Engines

| Module | Global | Purpose |
|--------|--------|---------|
| `ticker-validation.js` | `MaerminTickers` | Normalise symbols (e.g. `BRK.B`→`BRK-B`, keep `SAP.DE`) |
| `equity-metadata.js` | `MaerminEquityMeta` | Sector/country per ticker — resolves via the Worker's `action=profile` (Yahoo `assetProfile`) + 30-day cache + an expanded static map. Yahoo's sector/country labels are normalised to the app's GICS-style buckets. Powers the Strategy tab's Sector & Country allocation |
| `dividend-data-service.js` | `DividendDataService` | Dividend data, FIFO forecast, calendar. Resolves per-symbol dividends via the Worker's `action=fundamentals` (Yahoo — `fetchDividendFromWorker`, frequency inferred from `dividendRate / lastDividendValue`), falling back to the ~31-ticker built-in DB. Symbols are normalised through `MaerminTickers.normalizeForDividends`, which also applies renamed-ticker aliases (FISV→FI, FB→META, …). `buildPaymentSchedule(portfolio, {months, back})` expands resolved holdings into one dated entry **per individual payout** across a trailing `back` window (already-received, flagged `past`) plus the next `months` — the Dividend Calendar auto-derives these (read-only; upcoming blue, received grey) and merges them with the user's manual entries, so every payer shows who/when/how-much and the yearly total reconciles received + upcoming |
| `tax-report-builder.js` | `MaerminTaxReport` | Per-lot FIFO tax report + PDF/Excel; for jurisdiction `de` integrates the GermanTax detail (`summary.germanDetail`, injectable via `opts.germanTax` for Node tests) |
| `tax-settings.js` | `MaerminTaxSettings` | User-editable tax parameters (Abgeltung rate, Soli toggle, church tax, Freistellungsauftrag, crypto exemption, Teilfreistellung overrides) + per-position manual taxable overrides (sensitive). Pure `sanitize`/`computeAbgeltung`/`teilfreistellungRate`/`positionOverride`; the engine reads these and falls back to statutory defaults. Tested in `test/tax-settings.test.js` |
| `tax-calculation-engine.js` | `TaxCalculationEngine.GermanTax` | The German computation only (the legacy jurisdiction engine was removed; reports come from `MaerminTaxReport`): pure German fund-taxation depth: Vorabpauschale (BMF Basiszins table + overrides, month pro-rating, sale credit), Teilfreistellung per fund type (symmetric on losses), statutory order Teilfreistellung -> Verrechnung -> Sparerpauschbetrag -> Abgeltungsteuer/Soli/Kirchensteuer (sec. 32d formula), crypto Freigrenze. Dual-exported, tested in `test/german-tax.test.js` |
| `projection.js` | `MaerminProjection` | Multi-scenario wealth projection |
| `recurring.js` | `MaerminRecurring` | Recurring liabilities (loans/mortgages) |
| `portfolio-analytics.js` | `MaerminAnalytics` | Pure quant fed return series: benchmarks (α/β/Tracking Error/Information Ratio/R²), simulator (future value/FIRE/withdrawal), risk (max drawdown/rolling vol/Fama-French OLS). Monte Carlo is `monte-carlo-engine.js` only |
| `close-history.js` | `MaerminCloseHistory` | Daily closes per holding back to its first trade: `need` → `plan` (full range or tail, at most every 6 h) → `sync` with an injectable `fetch` (Worker `yf` for stocks, commodities and crypto as Yahoo USD pairs, CoinGecko only as the crypto fallback; CS2 skins have no daily history) → compact store in the quote currency at `maermin_close_history` (sensitive, in the backup, excluded from sync). Also the one table of Yahoo symbol mappings shared with the live price refresh, and `noListing`: symbols Yahoo has no listing for, remembered for the session so the price refresh, the history chart and the metadata fetches stop re-probing them |
| `value-path.js` | `MaerminValuePath` | Daily value path from transactions × EUR closes: chain-linked true TWR (held-yesterday link × trade/payout link), split-adjusted quantities, coverage report (missing / carried holdings); `fromValues` chain-links recorded snapshots (fallback); `index` = flow-neutral series for the analytics; `alignedCloses` = per-holding closes on one date grid. In `renderer.js` (`dailyAnalytics`): the risk view takes the per-holding grid only when every open holding has closes, else the flow-neutral `index`; the correlation matrix takes the grid of the holdings that have closes (labelled as partial); FX attribution and the DCA comparison take each holding's own closes |
| `return-figures.js` | `MaerminReturnFigures` | The return figures of the Overview's "Returns" section and Analysis → Returns from one place (P5-1.5): XIRR (clearing-aware per portfolio), TWR from the caller's value path, realised FIFO gains, dividends gross/net, taxes (withholding + tax bookings − refunds), fees (trade + fee bookings − refunds), purchases, proceeds, net return |
| `value-attribution.js` | `MaerminValueAttribution` | Profit by source (P5-2.1): splits end value − start value of a period into money in/out, dividends & interest, realized gains (FIFO ledger, before fees), change in unrealized gains, currency effect, fees, taxes and a residual that the data cannot explain; the measured book follows the value path (same closes, live quotes, recorded splits, clearing cash). `Panel` = the card in Analysis → Returns with 1M/3M/YTD/1Y/Max. Pure, no storage |
| `benchmark-replay.js` | `MaerminBenchmarkReplay` | Same money in an index (P5-2.2): the start value and every money in / out of `value-attribution.js` buy and sell index units at that day's close; end value and money-weighted return (XIRR) against the book's own. Presets MSCI World / FTSE All-World / S&P 500 / Nasdaq 100: dividends reinvested = accumulating Xetra listings (EUNL.DE, VWCE.DE, SXR8.DE, SXRV.DE, EUR), price only = the Benchmark comparison's proxies (USD, dated FX); a held fund replays on its Yahoo history (Worker) or its own closes. Closes via the existing `?action=yf` route. `Panel` = the card in Analysis → Returns. Pure, no storage |
| `verdicts.js` | `MaerminVerdicts` | Plain-language verdicts next to key figures (P5-1.6): every rule and threshold for benchmark difference, the same money in an index (P5-2.2), Sharpe/Sortino, volatility, max drawdown, health score and dividend safety; returns `{ level, text }` in the current language plus the no-advice note. Pure, no storage |
| `demo-fixtures.js` | `MaerminDemoFixtures` | Demo only (P5-1.8): sample responses for the Worker-only views behind the reserved URL `https://demo.maermin.invalid`, answered in the page by a fetch wrapper (never the network, never stored); the demo EUR/USD history for `fxAt`; the "Sample data" chip |
| `public-demo.js` | `MaerminPublicDemo` | Public demo link (P5-1.9): with `?demo` in the URL, loaded first, it swaps localStorage/sessionStorage for in-memory stores and hides IndexedDB; auth.js then mounts the app without a vault. Fails closed |
| `returns-heatmap.js` | `MaerminReturnsHeatmap` | Monthly returns grid (Analysis → Returns): `fromSteps` compounds the TWR card's chain of period returns (value path points, `fromValues().steps` or `MaerminReturns.twrSteps`) into months, quarters and years; `cellColor` / `textOn` keep every printed figure at 4.5 : 1 in all themes |
| `heatmap-drilldown.js` | `MaerminHeatmapDrill` | Heatmap drill-down and filters (P5-2.4): `periodOf` (month / quarter / year as ISO days), `detail(points, transactions, range)` = start value (last value before the period, 0 if the path starts inside it), end value, money in / out, gain, the compounded return of the steps inside it (equals the cell) and the activities by type; `filterTransactions` / `options` for asset class or custom category (`tx.category`), tag (`maermin_tags`, case-insensitive) or holding (`category|SYMBOL`). The Returns heatmap (`features2.js` `ReturnsHeatmap`, now exported) makes every cell a button with a detail strip and offers the filter (the path is rebuilt over that subset of transactions from the same daily closes, without the cash account); the position dialog shows the holding's own heatmap. No storage |
| `position-chart.js` | `MaerminPositionChart` | Position detail dialog: daily EUR closes since the first buy (`prepare` thins to ≤ 365 points) with a dashed average-cost line for open positions; closed positions show the price only |
| `ai-prompt.js` | `MaerminAIPrompt` | Settings → Privacy: plain-text portfolio summary to paste into any AI assistant; nothing is sent. Redacted level = text built only from `MaerminShare.validateSnapshot()` output (weights and scores); full level (holdings, quantities, amounts) after a confirmation and never while "Hide amounts" is on; reads only listed position fields (no notes, journal, keys) |
| `data-check.js` | `MaerminDataCheck` | Stable codes (`DQ-OVERSOLD`, `DQ-QUANTITY`, `DQ-FX-UNKNOWN`, `DQ-FX-USD-NEAREST`, `DQ-FX-NO-DAY-RATE`, `DQ-FX-TODAY-ONLY`, `DQ-SKIN-MISFILED`, `DQ-CRYPTO-PAIR`; never renumbered) and one action per Data check finding: show / edit the transaction, load rates or open API settings, move misfiled skins (the only data change, confirmed via `MaerminUtils.confirmThen`) |
| `dividend-forecast.js` | `MaerminDividendForecast` | Dividends → Forecast: per-payer forward rate from the user's own payments of the last twelve months (EUR at each payment date), their frequency and months; payers without such history fall back to the resolved per-share rate of `DividendDataService` |
| `dividend-history.js` | `MaerminDividendHistory` | Dividends depth (P5-2.5): `amountOf` (gross / net of withholding), `matrix` (security × year back to the first dividend, EUR at each payment date), `growth` (per share: each payment against the one about a year earlier, CAGR 3 / 5 years from complete years with a full base year), `months` (the forecast per month, used by Dividends → Forecast: 24 months by default, a month lists its payments), `backtest` (today's shares over each past year's market dividends: income, yield on the prior year-end value, growth). `View` = Dividends → History; the market data comes from the Worker `yf` route (`interval=1mo&range=10y`, `dividends` since Worker 2026.10.5), memory only. The gross / net choice (prefs `grossNet` = `maermin_gross_net`, in backups) also switches Analysis → Returns: `value-path.js` / `return-figures.js` `gross` count withholding, tax and fee bookings and trade fees (net of refunds) as money taken out instead of a loss |
| `holding-returns.js` | `MaerminHoldingReturns` | Per holding (P5-2.6): `flowsOf` (buys, sales, dividends per holding in EUR at their dates; gross / net like P5-2.5), `irr` (XIRR per holding with today's value as the last flow; `short` = under a year), `irrBy` (the same per asset class / category and per tag, grouped like the heatmap filter), `trades` (one row per sale from the ledger's FIFO lots: cost, proceeds, gain, return, quantity-weighted holding period, annualised from one year; best = gains, worst = losses, 5 each), `capitalFlow` (buys incl. fees and sales after fees per month and year, net and average per month). `Panel` = the "Per holding" section of Analysis → Returns. Pure, no storage |
| `investment-timeline.js` | `MaerminInvestTimeline` | Investment calendar and saving streaks (P5-2.7), on `MaerminHoldingReturns.capitalFlow`: `calendar` (year × month of money bought incl. fees, newest year first, biggest month for the shading), `streaks` (current and longest run of months with at least one buy - this month counts once it has a buy, else the run ends last month and is "open" - months with a buy of all months, this year so far). `Panel` = the card under the Cash Flow chart. Pure, no storage |
| `allocation-groups.js` | `MaerminAllocationGroups` | Allocation by ETF provider and by broker (P5-2.8): `providerOf` (provider from the fund name - iShares, Vanguard, Xtrackers, Amundi incl. Lyxor, SPDR, Invesco, … - else a short list of common tickers, else "other providers"), `byProvider` (share of the funds and of the portfolio per provider; a fund = fund type, else the look-through heuristic), `byPortfolio` (each portfolio's securities value plus its cash account, share of the total). `Panel` = Strategy → "Providers & brokers". The two cash checks of `portfolio-intelligence.js` (`emergencyInputs`, `buyingPowerInputs`): emergency fund in months of expenses (cash + current accounts of Net Worth / FIRE annual expenses ÷ 12; < 3 important, < 6 optimization) and buying power (an overdrawn cash account is critical, ≥ 20 % uninvested cash an optimization). Pure, no storage |
| `real-returns.js` | `MaerminRealReturns` | Real returns (P5-2.9): consumer prices = Eurostat HICP (`prc_hicp_minr`, all items, 2015 = 100, monthly) through the Worker route `?action=hicp&geo=` (euro area and its members; only the region code is sent). `indexAt` (the month of a date; after the last published month the last value, marked), `inflation` (total and p.a. between two dates), `realTwr` ((1 + TWR) / (1 + inflation) − 1), `realXirr` (each flow lifted to the money of the last flow's month, then XIRR), `load` / `useHicp` (device cache `maermin_hicp_cache`, 7 days, public data, not synced or backed up; an older Worker → "outdated"). Region = prefs `hicpGeo` (`maermin_hicp_geo`, default from the language: de → DE, else EA). Shown on Analysis → Returns: "real" lines on XIRR and TWR, an inflation card with the region |
| `fints.js` | `MaerminFints` | FinTS 3.0 PIN/TAN client (P5-3.4), pure: syntax (`parse` / `esc` / binary), `buildMessage` (HNHBK / HNVSK / HNVSD / HNSHK … HNSHA / HNHBS), segments (HKIDN, HKVVB, HKSYN, HKTAN 4 / 2 / S, HKSPA, HKSAL, HKKAZ with touchdown, HKWPD, HKEND), responses (return codes, TAN methods from 3920 + HITANS, HIPINS, HIUPD / HISPA accounts, HISAL, HITAN), `mt940`, `mt535`; `synchronize` (system id, TAN methods) and `fetchAll` (accounts, balances, transactions, depot; TAN entry or decoupled app confirmation by polling); `workerTransport` (base64 through `action=fints`). Tested against `test/fints-bank-sim.js` |
| `bank-sync.js` | `MaerminBankSync` | Bank connections (P5-3.4): `maermin_bank_sync` (sensitive: encrypted, synced, in the backup) holds bank, FinTS URL, bank code, the login name only on request, system id, TAN method and the last balances / depot positions - never PIN, TAN or transactions. `toBookings` turns bank transactions into cash bookings (deposit, withdrawal, fee, tax, refunds, interest charge; securities rows left out) with `source: 'fints'` + `externalId`, `newOnly` books nothing twice; `depotDiff` compares the depot statement with MAERMIN per ISIN. `Panel` = Data → Broker Import, below Exchange sync |
| `exchange-more.js` | `MaerminExchangeMore` | More read-only exchange syncs (P5-3.8), registered into `MaerminExchangeSync` through `registerExchange(id, { label, host, passphrase, adapter, pull })`: **Bitvavo** (balance → EUR markets of held / known coins → trades), **Bybit** (key must be read-only via `/v5/user/query-api`; spot executions in 7-day windows over 180 days), **KuCoin** (fills in 7-day windows over 180 days; passphrase), **Bitget** (assets → USDT / USDC / EUR pairs → fills; passphrase). Requests signed in the browser (HMAC-SHA256 hex or base64 per exchange) and relayed by `action=brokerproxy` to exact read endpoints. `row` applies the fee rules (fee in the coin valued at the price and, on a buy, off the quantity; a third-asset fee kept on the row with a note) |
| `reconcile.js` | `MaerminReconcile` | Reconciliation and data health (P5-3.7). `collect` reads the stored states of bank-sync, aggregators, wallets and exchange sync; `cashRows` = a bank / GoCardless balance vs the clearing account of the portfolio the user linked it to, on the balance date (`balanceAt`; EUR accounts), `depotRows` = a FinTS depot statement per ISIN, `cryptoRows` = all wallets per coin; status match / differs / unlinked / currency / nocash. `health` → Data check findings with stable codes (data-check.js): `DQ-PRICE-STALE` (> 3 days or missing, only with a Worker), `DQ-TRANSFER-BROKEN` (other half missing or different), `DQ-SYNC-STALE` (> 30 days), `DQ-SYNC-FAILED` (bank-sync, aggregators and wallets now keep `lastError`), `DQ-RECON-DIFF`. Links in `maermin_reconcile` (sensitive, synced, in the backup). `Panel` = Transactions, below the Data check |
| `crypto-wallets.js` | `MaerminWallets` | Crypto wallets by public address (P5-3.6): Bitcoin, Ethereum, Arbitrum One, Optimism, Base, Polygon PoS, Solana through `action=wallet` (`cf-worker/wallets.js`: mempool.space, Blockscout, Solana RPC; no keys). `addWallet` (address checked per chain, no duplicates), `applySnapshot` (native + ERC-20 balances), `totals` per symbol across wallets, `compare` with MAERMIN's crypto quantities (match / differs / not in MAERMIN). Nothing is booked automatically (a transfer is not a trade). `maermin_wallets` (sensitive: encrypted, synced, in the backup) holds addresses and last balances, no transactions; the demo keeps it in memory. `Panel` = Data → Broker Import, below Exchange sync |
| `aggregators.js` | `MaerminAggregators` | Bring-your-own-key aggregators (P5-3.5), through `action=brokerproxy` (exact read endpoints). **GoCardless Bank Account Data**: `gcToken` → `gcInstitutions` → `gcLink` (requisition, the bank's approval page in a new tab) → `gcStatus` (LN) → `gcFetch` (details, booked balance, booked transactions → `gcRows` → `MaerminBankSync.toBookings`, source `gocardless`, the provider's transaction id). **SnapTrade**: `stSign` (base64 HMAC-SHA256 of the canonical JSON { content, path, query } with the consumer key - the key never leaves the browser), `stRegister`, `stLoginLink` (read-only portal), `stFetch` (accounts, positions, activities); `mapActivities` (BUY / SELL / REI, DIVIDEND, CONTRIBUTION / DEPOSIT / WITHDRAWAL / FEE / TAX; others counted, source `snaptrade`, id `st-<activity>`), `positionsDiff` by symbol. Keys: vault-encrypted per provider (`maermin_agg_cred_<provider>`, like the exchange keys: never in a backup or sync, re-encrypted on key rotation in auth.js); metadata `maermin_aggregators` (sensitive) holds no key, token or transaction. `Panel` = Data → Broker Import, below Bank sync |
| `shared-worker.js` | `MaerminSharedWorker` | Shared price Worker (P5-3.1): `marketBase(own, { enabled })` = the own Worker, else `SHARED_URL` (the owner's Worker deployed with `PRICE_ONLY=1`, https only; empty until deployed) unless the user switched it off; `dataBase(own)` = the own Worker only (sync, share, MCP, broker relay, Steam inventory); `isShared`, `enabledFrom` (prefs `sharedPrices`, `maermin_shared_prices`, default on). The renderer derives `marketWorker` / `marketApiKeys` from it for every market-data call. Switch and source shown in Security & sync → Market data |
| `taxonomies.js` | `MaerminTaxonomies` | Taxonomies (P5-2.10): classification trees on top of asset classes, categories and tags. A taxonomy = nodes (name, colour, target %, children) + one node per held symbol (`assign`). Templates asset classes, GICS sectors, MSCI regions (developed: North America / Europe & Middle East / Pacific; emerging), Kommer world portfolio (70 / 30 targets); `suggest` fills new assignments from asset class, fund type, fund name, sector and country (never overwrites); `allocation` rolls values up the tree with "not assigned" apart; `planInput` feeds the top level with its targets (and never-sell holdings) into `MaerminRebalance.plan`; `exportJson` / `importJson` (`maermin-taxonomy` v1, ≤ 500 nodes). Stored as `maermin_taxonomies` (sensitive: encrypted, synced, in the backup; the demo keeps it in memory). `Panel` = Strategy → Taxonomies |
| `withholding-tax.js` | `MaerminWithholding` | German tax view: foreign withholding tax per country and year from the tax report's dividend list (gross, withheld, creditable = min(withheld, 15 % × gross) like the tax engine and KAP line 41, excess to reclaim abroad); country from `MaerminEquityMeta` only, else "unknown"; German dividends listed apart. Statutory rates from secondary summaries of the BZSt table, dated 2026-10-09, not verified against the original |
| `tracker-import.js` | `MaerminTrackerImport` | Broker Import wizard (via `import-mapping.js` `preview` / `quickCSV`): fixed-format parsers for the Portfolio Performance CSV export (layout from its `CSVExporter.java`; EN/DE headers, locale numbers) and the Parqet activities export; buys, sells, dividends (gross + `withholdingTax`), inbound deliveries; other rows reported with a reason |
| `analytics-data.js` | `MaerminAnalyticsData` | Bridge: builds a portfolio value path + aligned period returns from built positions + per-symbol `priceHistory` (incl. N-series `alignReturns`/`subtract` for factor construction), the inputs `MaerminAnalytics` expects |
| `etf-lookthrough.js` | `MaerminLookThrough` | ETF/fund X-Ray (P5-2.3: an imported holdings file wins over the Worker's Yahoo top holdings and the built-in snapshot; one security across funds by ticker, ISIN or name without legal forms; currencies from the files where given): pure `analyze()` over position rows + per-fund holdings → effective per-security exposure, sector/country/currency look-through, fund-overlap pairs, hidden concentrations. Holdings come from the Worker `fundholdings` route via the shared, session-cached `loadFundData` loader (injectable fetch), merged with a static snapshot of common ETFs (graceful degradation) |
| `fund-holdings-import.js` | `MaerminFundFiles` | Fund holdings files the user downloads from the fund provider and imports (P5-2.3): `readTable` reads CSV (`,` `;` tab, UTF-8 / Windows-1252), XLSX (zip + first worksheet, no library; the browser inflates with `DecompressionStream`) and Excel 2003 XML; `parseTable` finds the header row by its column names (English and German), decides decimal comma and percent vs fraction per file, sums cash / futures / FX forwards apart, normalises sectors and countries to the app's labels and reads provider, fund ISIN and "as of" date from the preamble. Stored per fund root at `maermin_fund_holdings` (sensitive, in the backup, synced encrypted; in the demo memory only): the 2,000 largest holdings plus sector / country / currency splits over the whole file. `exportCsv` = the effective exposure as CSV. Nothing leaves the device |
| `cost-analysis.js` | `MaerminCostAnalysis` | Ongoing costs (TER): pure `buildFundRows`/`computeOngoingCosts`/`projectCostDrag` → annual EUR cost per fund, total drag p.a., weighted average TER, multi-year cumulative cost-drag projection. TER from the same `loadFundData` plumbing (override > worker > snapshot); manual overrides in `localStorage` (symbols + ratios only, not sensitive) |
| `dividend-quality.js` | `MaerminDividendQuality` | Dividend quality & safety: pure `scorePosition` (heuristic 0-100 from payout ratio, growth streak, dividend growth, yield sanity; cut-risk flag; weight redistribution when fundamentals are missing), `scorePortfolio` (income-weighted health + income-at-risk share), `cagrFromSeries`. Fundamentals from the Worker `fundamentals` route; degrades to the DividendDataService history heuristic |
| `risk-monitor.js` | `MaerminRiskMonitor` | Continuous structural risk alerts: pure `evaluate` (five rules - position concentration, effective look-through concentration, allocation drift, drawdown, volatility - against user thresholds, percent-based) + `shouldNotify` (cooldown dedupe; recovery re-arms a rule). Inputs gathered from MaerminMetrics / MaerminAnalyticsData / MaerminAnalytics / MaerminLookThrough - no new quant. Notifies via MaerminPWA; thresholds + notify state in `localStorage` (ids/percents/timestamps, not sensitive) |
| `fx-attribution.js` | `MaerminFxAttribution` | FX attribution: pure multiplicative decomposition (1+r_EUR) = (1+r_local)(1+r_fx) per position over the common tail with the EUR/USD path (existing Worker `yf` route, `EURUSD=X` inverted), value-weighted portfolio aggregation + per-currency contributions. Position currencies mirror `computeCurrencyExposure` exactly |
| `backtester.js` | `MaerminBacktester` | Allocation backtester: pure unit-holding simulation over aligned real price series (optional monthly/quarterly/yearly rebalancing on a trading-day grid); metrics (CAGR, max drawdown magnitude, volatility) reused from `MaerminAnalytics`; history over the existing Worker `yf` route; folds into the Monte-Carlo tab |
| `savings-plan-executor.js` | `MaerminSavingsExecutor` | Savings-plan auto-execution: calendar-exact schedules REUSED from `MaerminRecurring.expandOccurrences` (replaces the 30.44-day approximation), idempotency via on-transaction markers (`source:'savings-plan'`, planId, dueDate - survive reload/backup/sync), post-merge `dedupeExecutions` with a deterministic survivor, quantity = amount / price at the due date (price-history lookup; unresolvable -> pending, never guessed). Catch-up runs on app open/unlock, never in the background |
| `corporate-actions.js` (P5-3.10) | `MaerminCorporateActions` | Besides splits (`maermin_corporate_actions`): symbol change, ISIN change, merger and spin-off in `maermin_corporate_events` (`normalizeEvents`, `recordEvent`, `removeEvent`, `eventsFor`, `describeEvent`, `EventsPanel`). `adjust(transactions, splits?, events?)` applies splits and events in date order: rename moves earlier rows, merger scales quantity by the ratio with cost and dates kept plus a cash dividend row per portfolio, spin-off gives each lot open on the date (FIFO per portfolio) a child lot with the parent lot's date and the cost share. Identity when nothing is recorded |
| `bonds.js` | `MaerminBonds` | Bonds (P5-3.9): built-in category `bonds` (quantity = nominal, price = fraction of nominal, `accruedInterest` on trades). Terms + manual price in `maermin_bonds`; `schedule` / `period` (coupon dates back from maturity, month ends kept), `accrued` (act/act ICMA, 30E/360, act/360, act/365), `couponAmount`, `ytm`, `catchUp` (coupon `interest` rows per portfolio + bond + date and redemption at 100 %, idempotent, posted to the `interest-engine.js` ledger), `accruedRows` (tax: paid negative, received positive, 'other' pot), `priceMap`; transaction-form fields and the Overview Bonds panel |
| `options-engine.js` | `MaerminOptions` | Options/derivatives tracking: pure `buildOptionPositions` (signed-contract book over `category: 'options'` transactions with `underlying`/`optionType`/`strike`/`expiry`/`contractSize`; premiums EUR at ingestion), `positionMetrics` (intrinsic-only valuation, moneyness, days-to-expiry; strike converts at the current rate), `computeStats`, `validateOptionTx`. `buildPositions` ignores the category by design, so the shared positions/stats engine is never bent |

---

## UI

`renderer.js` holds the `InvestmentTracker` component: all state, the nav, the
view router (`renderView()` switch), and a `ViewErrorBoundary` so a single view
crash shows a recoverable fallback instead of a blank app. Feature views live in
`features.js … features7.js` and `investment-views.js`, rendered by passing
already-computed numbers down as props (no view computes cross-cutting metrics
itself — it reuses `MaerminMetrics`).

**First-run onboarding** (`onboarding.js` → `MaerminOnboarding`) is a view-layer
module with a React `Wizard` plus dual-exported pure logic: `endpoints()` builds a
cheap GET probe per data source (Yahoo prices, symbol search, CS2 price list,
CoinGecko through the day-cached `cg` search route), `classify()` maps each probe
outcome to green/amber/red (a rate-limited source is amber: the Worker answered), and
`probe()`/`probeAll()` run them with an injectable `fetch` (so the connection test
is unit-tested under Node). `probeAll()` adds two rows from the `?action=version`
handshake: the Worker version and the storage for sync and share links (`storage`
flag of the handshake; amber with the KV step when unbound, amber "update the Worker"
when an older Worker does not report it - no request that fails by design). The wizard offers a guided Worker deploy (one-click *Copy
worker.js*), the live connection test, and a Demo-mode entry; `renderer.js` opens it on
first run and from API Settings, and surfaces a recovery-code nudge for vaults created
before recovery codes existed.

**Analytics fold-in** (no new tabs): the `MaerminAnalytics` engine is surfaced through
thin view modules — `simulator-view.js` (`MaerminSimulatorView`, Future Value/FIRE/
Withdrawal) folds into the **Monte-Carlo** analytics tab below the one Monte-Carlo
simulation (`monte-carlo-engine.js`), and
`analytics-views.js` (`MaerminAnalyticsViews`) adds a **benchmark overlay** (α/β/TE/IR/R²,
fetching a proxy via the worker `yf` endpoint) to the **Returns** view plus a **rolling
volatility/return** panel and a **Fama-French factor-exposure** panel (MKT/SMB/HML loadings
+ annualised alpha, regressing the portfolio on ETF-proxy factor returns — VTI; IWM−IWB;
IWD−IWF — over the same `yf` endpoint) to the **Risk** view. The proxy/diff alignment is
pure and unit-tested (`MaerminAnalyticsData.alignReturns`/`subtract`); the engine's
`factorExposure` OLS stays the single source of truth. The advisor's findings
(`advisor.js` → `MaerminAdvisor.Panel`) fold into the **Health** view.

**ETF look-through (X-Ray)** (`etf-lookthrough.js` → `MaerminLookThrough`) folds into
two existing views (no new tab): the **Health** view gets effective per-security
exposure (direct + through funds) plus sector/country/currency look-through, and the
**Risk** view gets fund-overlap pairs + hidden concentration findings (`Panel` with
`mode: 'overview' | 'risk'`). The whole computation (`analyze`) and the data plumbing
(`parseHoldingsResponse`, `mergeFundData`, `fallbackHoldings`, `positionRows`) are
pure and Node-tested; the Panel is a thin fetch shell over the Worker's
`action=fundholdings` route, gated exactly like Discovery — an older Worker (400/404)
triggers an upgrade note while a built-in approximate snapshot of common index ETFs
keeps the feature useful. The Health panel hands its result up so
`MaerminAdvisor.analyzeFromMetrics` can rank hidden fund concentrations alongside its
other findings (`bundle.lookThrough`). Nothing is persisted (no new `SENSITIVE_KEYS`).

**Ongoing costs (TER)** (`cost-analysis.js` → `MaerminCostAnalysis.OngoingCostsPanel`)
folds into the **Fee Analyzer** view below the transaction-fee breakdown (no new tab):
annual EUR cost per fund position, total ongoing drag p.a., weighted average TER, and a
multi-year projection of the cumulative cost drag, plus an inline manual TER override
per fund. It reuses the X-Ray's `loadFundData` loader (same gating/degradation), so
there is exactly one fund-data pipeline; only the override map (symbol → expense ratio,
no amounts) is persisted in `localStorage` and is not sensitive.

**Dividend quality & safety** (`dividend-quality.js` → `MaerminDividendQuality.QualityPanel`)
folds into the **Dividends** view below the calendar/forecast tabs (no new tab): a
per-payer table (income, payout, streak, growth, coverage, safety score with a
cut-risk badge), a click-to-open reasoning detail per row, and the aggregated
portfolio dividend-health KPIs. Payers and history metrics come from the ONE existing
`DividendDataService`; fundamentals (payout ratio, EPS) come from the Worker
`fundamentals` route with the usual gating — an older Worker or no Worker URL means
the score is computed from history alone and the panel says so. The score is labelled
a heuristic; nothing is persisted.

**Risk & drift monitor** (`risk-monitor.js` → `MaerminRiskMonitor`) folds into the
**Alerts & Rules** view below the user-defined rules (no new tab): a rule-status table (current value
vs limit, breach state) with inline threshold editing, a notification toggle (wired to
`MaerminPWA.requestNotifications`/`notify`) and a cooldown. The continuous part is one
renderer `useEffect` on `prices`: `checkAndNotify` re-evaluates the rules on every
price refresh regardless of the active view, dedupes via the cooldown state (a
recovered rule re-arms immediately), and raises local PWA notifications only when the
user opted in. Drawdown/volatility breaches additionally surface as advisor findings in
**Health** (`bundle.riskMonitor`); concentration/drift/look-through breaches are not
duplicated there because the advisor already covers those dimensions.

**German fund taxation** (`german-tax-view.js` → `MaerminGermanTaxView.Panel`) folds
into the **Tax** view when the jurisdiction is Germany (no new tab): fund-type
classification per position (Teilfreistellung), a Vorabpauschale worksheet per
accumulating fund and tax year (values prefilled from the local price history at the
year boundaries via the pure `priceAt`/`qtyAt`/`prefillRow` helpers, everything
editable), Basiszins and church-tax settings, and the integrated ordered computation
from `MaerminTaxReport.build` (`summary.germanDetail`, also exported to PDF/Excel).
Saved Vorabpauschalen credit later sales of the same fund. All stored inputs
(`maermin_fund_types`, `maermin_vap_records`, `maermin_kirchensteuer`) are registered
in `SENSITIVE_KEYS` (the type map reveals held symbols, records hold EUR amounts, the
church-tax rate reveals a religious affiliation); the Basiszins overrides are public
BMF rates and stay plain. Labelled a helper computation, not tax advice.

**Broker PDF import** (`pdf-import.js` → `MaerminPdfImport`) adds settlement-PDF
parsing to the existing Broker Import wizard (no new tab, no second import engine):
pdf.js 4.10.38 extracts the text fully client-side (both CDN files version-pinned + SRI,
lazy-loaded on first use). The library loads as a module script; the worker file is
fetched with the same SRI check and runs as a Web Worker from a `blob:` URL, one per
file, terminated afterwards (`worker-src 'self' blob:`, `connect-src` names only the
pinned pdf.js folder). Opened from disk (`file://`) it loads as a module script and
pdf.js runs on the main thread. A pure generic German-settlement
parser with per-broker configs (Trade Republic, Scalable, ING, DKB, Comdirect; P5-3.2
flatex, Consorsbank, DEGIRO, onvista bank; P5-3.3 Baader Bank, Smartbroker+, Sparkasse /
Deka, Postbank, Trade Republic and Scalable dividend and tax documents) turns the text into candidate transactions
(several settlements per PDF; DEGIRO Transaktionsübersicht / Kontoauszug tables row by
row; taxes withheld as dividend `withholdingTax` or a `tax` / `tax_refund` cash row;
tax and fee documents as one cash row), and `candidatesToCSV` feeds them into the
existing `MaerminImportMapping` preview/commit flow — editable mapping, row errors and
duplicate detection come for free. Number/date parsing is reused from that module.
Parsers are best-effort against frozen text fixtures (`test/pdf-import.test.js`);
missing fields are reported per file, never guessed. The PDF never leaves the device.

**Share & Compare** (`share-snapshot.js` -> `MaerminShare`) is the sanctioned new
surface of round 2 (Roadmap Epic 9, done without breaking zero-knowledge): an opt-in
view under Tools that shares a REDACTED snapshot - percentage weights by asset class /
sector / region / currency plus optional scores, never absolute values, quantities or
symbols. Redaction is enforced three times (pure `buildSnapshot` only computes
percentages; `validateSnapshot` rebuilds against a hard allowlist before the wire; the
Worker validates again server-side), and `test/share-snapshot.test.js` contains the
leak proof that distinctive absolute inputs never appear in the serialised snapshot.
The Worker `share` route stores snapshots under random ids with a 90-day TTL in the
sync KV namespace and keeps a count+sum aggregate for the anonymous benchmark.
Old Workers degrade with the upgrade note.

**Options tracking** (`options-engine.js` → `MaerminOptions`) extends the transaction
model additively: `category: 'options'` rows carry `underlying`, `optionType`
(call/put), `strike`, `expiry` and `contractSize` next to the usual fields
(`quantity` = contracts, `price` = premium per share); the transaction modal grows the
matching inputs and derives `tx.symbol` from the contract (`AAPL 2026-12-18 C 150`).
Because `buildPositions` ignores unknown categories by design, the shared
positions/stats/tax engines are untouched — the options book is a separate pure
reader over the same transaction list (signed contracts: long/short/closed, net
premium, intrinsic-only valuation against the existing EUR price map). The `Panel`
folds into the **Overview** below the positions table and renders nothing when no
option transactions exist. The UI states that valuation is intrinsic-only (no time
value/Greeks) and that options are excluded from portfolio value and tax figures. All consume
`MaerminAnalyticsData` for series construction, so no view recomputes quant. A
**Security & Sync** settings modal (in `renderer.js`) exposes `MaerminAuth.getStatus()`
(encryption-at-rest, KDF, auto-lock, passkey, recovery code) and `MaerminSync`
(zero-knowledge cloud sync) status + actions.

**Asset Discovery** (`discovery.js` → `MaerminDiscovery`) is the one sanctioned *new*
surface (Roadmap P5) — a read-only screener for ETFs/stocks/crypto, top movers, and a
dividend screener, reached from the **Tools** nav. The Worker is the single data source:
a new `action=screener` endpoint proxies + normalises Yahoo Finance in two modes —
`scrId=` (predefined screener / movers) and `symbols=` (batch quote, used for the curated
dividend universe). Everything testable without a browser — `parseResponse`, EUR
conversion at ingestion (`toEURRow`, reusing `MaerminUtils.toEUR`), `applyFilters`,
`sortRows`, `dividendScreen`, `buildUrl` — is pure and Node-tested; the React `View` is a
thin shell over them. It is fully gated: with no Worker URL, or against a Worker that
predates the endpoint (400/404), it shows a clear upgrade note instead of breaking. No
data is persisted and nothing sensitive is sent, so it adds no `SENSITIVE_KEYS`.

**Portfolio Intelligence** (`portfolio-intelligence.js` → `MaerminIntelligence`) is the
Feature-1 (v10) surface under **Discover & Tools** (one new view, reached from the
sidebar hub + command palette `g i`). It is an *aggregator*, not a new analytics engine:
the pure `analyzeFromInputs(inputs, opts)` runs ten structural checks — single-company
(effective/look-through), hidden concentration, sector overexposure, country risk,
currency risk, correlation clusters (fund overlap), style drift (sector tilt vs a broad
market reference), dividend trap, yield trap and liquidity risk — and ranks every finding
into the spec's three priorities (**critical → important → optimization**) with a concrete
recommendation per finding. `gatherInputs` feeds it from the existing single sources of
truth only: `MaerminLookThrough.analyze()` (the renderer reuses its already-fetched
`lookThroughResult` from Health) for effective/sector/country/currency exposure and fund
overlap, `MaerminMetrics` for the direct-concentration/currency/liquidity fallback when
fund data has not loaded yet, and the one `DividendDataService` for the dividend/yield-trap
signals. Nothing is persisted (no new `SENSITIVE_KEYS`, no migration — findings are derived
on every render); `toExport()` yields a redaction-safe finding list (advice text +
percentages, never amounts) for the Professional-Reports feature. The pure layer is
Node-tested (`test/portfolio-intelligence.test.js`) and the `View` is registered in
`smoke-views`. Accessibility: the priority chips and finding list use `role="list"`/
`listitem` with `aria-label`s and `aria-hidden` status glyphs.

**v10 feature stores.** Three new pure modules add *persisted* user data and are
therefore wired into the full-vault backup (`backup-engine.js` `KEYS`):

- **Portfolio Value Snapshots** (`portfolio-snapshots.js` → `MaerminSnapshots`, key
  `maermin_snapshots`). An append-only daily series of total value, one point per
  `(day, portfolioId)` (a same-day re-record overwrites that day, capped per portfolio so
  it can't bloat). Pure `addPoint`/`changeBetween`/`valueAsOf`/`prune`; the renderer records
  it from a single best-effort top-level effect that reuses the Overview's value
  aggregation (never throws into a render, never records in demo mode). This is the
  ground-truth value history when no external (Yahoo) history is reachable.
- **Smart Tags** (`tags.js` → `MaerminTags`, key `maermin_tags`). Case-insensitively-unique
  labels referencing UPPERCASEd symbols, orthogonal to asset category. `aggregate(state,
  positions)` is pure and takes the caller's already-priced positions, so it never needs the
  metrics engine. Weights are share of the supplied total so untagged value stays visible.
- **Custom Dashboard Layout** (`dashboard-layout.js` → `MaerminDashboard`, key
  `maermin_dashboard_layout`). An ordered list of `{id, visible}`; `normalize(raw, available)`
  reconciles a saved layout against the widgets a build actually ships — new ids append
  visible, removed ids drop, the rest keep their order/visibility — so a new card never
  corrupts an old saved layout.

All three are dual-export IIFEs with headless Node tests (`test/portfolio-snapshots.test.js`,
`test/tags.test.js`, `test/dashboard-layout.test.js`). They store non-secret data only, so
they add no `SENSITIVE_KEYS` and need no migration.

**v10.x roadmap modules** build *on top of* the v10 stores:

- **Snapshot-Powered Performance** (`performance-cards.js` → `MaerminPerformance`) is a pure
  *consumer* of the snapshot series — no new persistence. `computeAll(series, asOf)` derives
  the 1D/1W/1M/3M/6M/YTD/1Y/Max cards with carry-forward (`valueAsOf`) and a `partial` flag
  when the look-back predates inception, so a young portfolio still shows a real number. The
  core takes a plain `[{d,v}]` array (Node-tested, `test/performance-cards.test.js`);
  `cards(portfolioId)` bridges to `MaerminSnapshots` in the app.
- **Rebalancing Planner** (`rebalancing-planner.js` → `MaerminRebalance`, key
  `maermin_rebalance_targets`, in the backup) persists target weights by category **or** tag
  basis. The pure `plan(state, actual, {band})` is basis-agnostic — the caller passes the
  current allocation as `[{key,value}]` (category values, or
  `MaerminTags.aggregate(...).rows` for the tag basis) — and returns per-bucket drift (in
  percentage points) plus the concrete buy(+)/sell(−) delta to reach target within a tolerance
  band, with a turnover/`balanced` summary. Node-tested in `test/rebalancing-planner.test.js`.
  P4-4: a band per target (`defaultBand` / `bands`: `{ rel, abs }` → max(rel × target, abs)), an
  invest-only mode (`mode: 'cashflow'`, `contribution`; never sells) and a `sellable` value per
  row (holdings marked "never sell" left out; blocked sales are reported). Portfolio →
  Rebalancing runs on it, with its settings in `maermin_rebalance_prefs` (encrypted, in the
  backup); tested in `test/rebalancing-upgrades.test.js`.

---

## Build & test

- `npm run build:web` — `build.mjs` reads `index.html`, concatenates local
  scripts in order, minifies with esbuild, emits `dist/` (+ PWA assets). CDN
  scripts keep their SRI hashes.
- `npm test` — `test/run-all.mjs` runs every `test/*.test.js` in a child process
  and fails on any non-zero exit. Tests exercise the **real** modules via the
  Node export, with minimal DOM/crypto stubs.
- `npm run check` — `node --check` on every JS file (fast syntax gate).
- `npm run test:e2e` — `test/e2e/app.e2e.mjs` runs the real app (dev `index.html`
  and `dist/`) in headless Chromium via `playwright-core`: mount after unlock,
  every sidebar view, Tax Report + PDF export, upgrade migration. Needs a built
  `dist/` and a Chromium (`npx playwright-core install chromium`, or
  `CHROME_PATH`); offline-safe (React from `node_modules`, `JSPDF_DIR` for jsPDF).
- `npm run bench:motion` — `test/e2e/motion.bench.mjs` measures animation
  smoothness of `dist/` (frame intervals, jank %, long tasks, style/layout/
  paint/raster time) for idle, hover, navigation, palette and scroll;
  `--cpu 4` throttles, `--fx-off` gives the motion-off reference, `--css`
  injects CSS for ablation. Rule of thumb for styles.css / fx.js / motion.js:
  animate only `transform` and `opacity`; no animated filters, blend modes,
  `background-position` or custom properties on large or permanent elements.

CI (`.github/workflows/node.js.yml`) runs `build:web` + `test` (incl. the platform suite) on Node 22/24.

---

## Design rules (V7)

1. **Integrate, don't accrete** — extend existing views/cards/charts; avoid new
   tabs/engines. One metrics service, one allocation engine, etc.
2. **Pure logic is testable** — keep calculations in dual-export modules with
   unit tests; keep `React.createElement` UI thin.
3. **Security by default** — sensitive data encrypted at rest; password never
   stored; no remote telemetry.
