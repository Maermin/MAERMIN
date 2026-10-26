# PLAN-EQUITY — Employee equity (RSU, PSU, ESPP, employer match)

Status: **approved 2026-10-26** (decisions in § 7). Implementation runs package by package.
Scope: one feature set, delivered as 8 PRs (packages 1–8), each with tests, demo data
and German strings. UI page name: **„Mitarbeiteraktien"**.

---

## 0. What exists today (survey of `main` @ 16d1efe)

| Area | Today | Consequence for this plan |
|------|-------|---------------------------|
| Data model | Transactions are the single source of truth; `ledger.js` is the one FIFO engine; canonical internal currency is **EUR** | Each vest/purchase becomes a normal `buy` transaction (= lot). No second lot engine |
| FX | `fx-history.js`: USD→EUR daily history; other fiat via Worker `?action=yf&symbol=EUR<CUR>=X`, **hard-coded list of 25 currencies** (`FIAT`), gap tolerance 7 days, statuses `exact`/`approx`/`unknown`; minor units GBX/GBp, ZAc, ILA already handled in `majorOf` | Replace the `FIAT` list with an ISO-4217 check (`Intl.supportedValuesOf('currency')`) plus the existing "miss" bookkeeping. Add a per-transaction FX override (none exists today) |
| Base currency | `reporting-currency.js`: **only EUR / USD / CHF**, hard-coded symbols | Generalise to any ISO code (rates already in the open.er-api table `usdRates`, symbol and decimals via `Intl.NumberFormat`) |
| Formatting | `MaerminI18n.money(v, cur, dec)` uses `dec = 2` unless told otherwise | Add `moneyAuto` that takes the decimals from `Intl.NumberFormat(…).resolvedOptions()` (JPY 0, KWD 3) |
| Migrations | `migrations.js` v1–v6; `premigration-backup.js` writes an encrypted copy **before** any pending migration (`guardedRun`) | Every equity schema change goes through a numbered migration, so the auto-backup always runs first |
| Encryption | `storage.js` `SENSITIVE_KEYS` (AES-GCM at rest), `backup-engine.js` `KEYS`, `sync-engine.js` (zero-knowledge, ciphertext only) | New keys are sensitive, in the backup; salary never reaches the Worker in plaintext |
| Monte Carlo | `monte-carlo-engine.js` uses `Math.random` (not seedable) | Equity forecast gets its own seeded PRNG (mulberry32); the existing engine is untouched |
| Calendar | `event-feed.js` `toICS` (RFC 5545) | Reused for the vest/purchase `.ics` export |
| Import | `import-mapping.js` (column mapping, preview, dedupe, number/date parsing) | Reused for the equity CSV import (Package 8) |
| Tax | `tax-report-builder.js`, `german-tax-view.js`, `anlage-kap.js`, `at-tax.js`, `ch-tax.js`, `statements.js` (PDF), `data-check.js` (stable `DQ-*` codes) | Equity tax report = new panel in the Tax view, using these |
| Concentration | `risk-monitor.js` (position concentration rule), Overview | Employer-stock rule added there and on Overview |
| Demo | `demo-data.js` (transactions, offline prices), `demo-fixtures.js` (EUR/USD history, Worker answers) | Equity demo data + offline FMV/FX fixtures live there |

Design rules kept: pure dual-export modules with Node tests, thin `React.createElement` UI,
no new engines where one exists, i18n guard (every key in `en` **and** `de`), colour guard,
unused-code guard.

---

## 1. Architecture

### New modules (all pure + Node-tested unless marked UI)

| File | Global | Job |
|------|--------|-----|
| `equity-model.js` | `MaerminEquity` | Schema, `normalize`, ids, store load/save, lot linking, pipeline totals |
| `equity-fx.js` | `MaerminEquityFx` | Four currency roles, rate lookup with fallback + manual override, `{rate, date, source}` records |
| `equity-vesting.js` | `MaerminEquityVesting` | RSU/PSU schedules, rounding, withholding, vest-event generation |
| `equity-espp.js` | `MaerminEquityEspp` | Income timeline → contributions, caps, purchases, carry-over, match grants |
| `equity-forecast.js` | `MaerminEquityForecast` | Scenarios (flat / CAGR / seeded MC), FX bands, combined 12-month view, leave simulator |
| `equity-tax.js` | `MaerminEquityTax` | DE yearly report (Anlage N vs KAP split), AT/CH hooks, CSV/PDF rows, basis warnings |
| `equity-import.js` | `MaerminEquityImport` | Mapping-based CSV import + dedupe (Package 8) |
| `equity-view.js` (UI) | `MaerminEquityView` | „Mitarbeiteraktien" page, cards, forms, charts |

Load order: after `fx-history.js`, `ledger.js`, `close-history.js`; view module before `renderer.js`.

### Storage keys (all in `SENSITIVE_KEYS`, in `backup-engine.js` `KEYS`)

| Key | Contents | Sync |
|-----|----------|------|
| `maermin_equity` | `{ v, plans[], grants[], tranches[], events[], settings }` | encrypted sync (encrypted sync, § 7 #3) |
| `maermin_income` | `{ v, entries[] }`: salary and one-off income | encrypted sync **or** device-local (encrypted sync, § 7 #3) |
| (inside `maermin_equity`) `fxOverrides` | manual FX rates `{ 'USD>EUR@2026-03-15': {rate, note} }`, kept in the equity store instead of a third key (Package 1) | encrypted sync |

In demo mode all three live in memory only, like the other demo stores.

### Lot link (no second lot engine)

A vest or purchase writes a normal transaction:

```js
{ id, type: 'buy', category: 'stocks', symbol, quantity: netUnits, price: fmv,
  currency: shareCurrency, date: vestDate, fees: 0, portfolioId,
  source: 'equity', equityEventId, equityKind: 'RSU'|'PSU'|'ESPP'|'MATCH',
  fx: { EUR: { rate, date, source }, [taxCur]: { rate, date, source } } }   // NEW, additive
```

- `ledger.js` / `fx-history.txToEUR` change: if `tx.fx.EUR` is present, it wins over the
  history lookup (status `exact`, or `manual` when overridden). That is the **only** change
  to existing engines in Package 1, and it is additive: transactions without `fx` behave as before.
- The cost basis is therefore FMV × the stored rate. It is never 0, and it never relies on a
  rate that could change later.
- Editing or deleting an equity transaction from the normal list is blocked with a hint
  („Wird unter Mitarbeiteraktien verwaltet"), so event and lot cannot drift apart.

---

## 2. Currencies (applies to every package)

**Four roles, stored per plan or grant:**

1. `shareCurrency`: listing currency of the ticker (from the quote; GBX/GBp, ZAc and ILA are kept as quoted)
2. `salaryCurrency`: payroll currency (per income entry, so a move from CHF to EUR payroll works)
3. `baseCurrency`: the app-wide display currency (`reporting-currency.js`, generalised)
4. `taxCurrency`: derived from the tax country (DE/AT → EUR, CH → CHF), stored on each event as it was **at event time**

**Event FX record.** Every event stores its amounts in original currency plus
`fx: { [cur]: { rate, date, source: 'history'|'fallback'|'manual', fallbackFrom? } }`
for EUR (internal), base and tax currency. A later change of base currency recomputes the
display value from the stored chain; history is never rewritten.

**Lookup.** Rates come from the existing pipeline (`currencyRateAt`, USD history). Cross rates go
through EUR (A→B = EUR-per-A / EUR-per-B). A missing day falls back to the nearest **previous**
trading day, up to the existing 7-day gap. The UI shows a „Ersatzkurs vom TT.MM." badge.
Beyond 7 days the status is `approx`, the badge turns into a warning and a manual rate is suggested.

**Manual override.** Any event rate can be overridden (from the payslip or broker statement), with
an optional note. It is shown as „manuell" and listed in the tax report.

**Minor units.** `majorOf` already maps GBX/GBp→GBP/100, ZAc→ZAR/100 and ILA→ILS/100. Equity
amounts are normalised to the major unit at ingestion. The original quote is kept for display
(„1.234 GBX = 12,34 £").

**Formatting.** A new `MaerminI18n.moneyAuto(v, cur)` takes the decimals from `Intl`, so there is
no symbol table and no currency list anywhere in the code. Validity check:
`Intl.supportedValuesOf('currency')`, which also covers the minor-unit codes above.

**Pipeline generalisation (Package 1):**
- `fx-history.js`: the `FIAT` whitelist becomes "valid ISO-4217 code and not known to be missing
  at the source" (the existing `miss` store, 24 h retry).
- `reporting-currency.js`: any ISO code; `perEUR(cur) = rates[cur] / rates.EUR` from the open.er-api
  table; symbol via `Intl`. The existing EUR/USD/CHF behaviour and tests stay unchanged.

---

## 3. Packages

### Package 1 — Data model + currency foundation (PR `equity/1-model`)

Entities (all ids are strings; dates are ISO days; amounts are numbers in the stated currency):

```
EquityPlan   { id, employer, ticker, shareCurrency, admin: 'morgan_stanley'|'etrade'|'schwab'|'fidelity'|'other',
               adminLabel?, portfolioId, taxCountry, blackouts: [{from,to,label}], matchRules: [...] (P5),
               esppSettings? (P4), createdAt }
Grant        { id, planId, type: 'RSU'|'PSU'|'ESPP'|'MATCH', grantDate, units?, contribution? (ESPP),
               grantPrice?, grantPriceCurrency?, schedule (P2/P3), rounding, withholding,
               parentEventId? (MATCH → its purchase), status }
Tranche      { id, grantId, date, units, status: 'unvested'|'vested'|'forfeited'|'settled', projected: bool }
VestEvent    { id, trancheId, date, fmv, fmvSource: 'close'|'prevClose'|'manual', shareCurrency,
               fx{…}, grossUnits, withheldUnits, netUnits, txId }
PurchaseEvent{ id, grantId, offeringStart, purchaseDate, fmvStart, fmvPurchase, purchasePrice,
               contributed{amount,currency}, fx{…}, units, refund, carry, discountAmount,
               lookbackGain, effectiveDiscountPct, soldImmediately?, txId, sellTxId? }
IncomeEntry  { id, from, to?, kind: 'base'|'bonus'|'13th'|'other', amount, period: 'year'|'month'|'once',
               currency, ftePct?, note? }
```

- **Pipeline.** Unvested tranches are valued at the live price (share currency → base). They are
  **excluded from net worth by default**; the setting `includeUnvestedInNetWorth` switches them in.
  Net Worth gets two new lines: „Nicht gevestete Mitarbeiteraktien" (pipeline) and „ESPP-Guthaben" (cash).
- Ledger change (`tx.fx.EUR`), `moneyAuto`, ISO-wide FX and reporting currency (see § 2).
- Migration **v7** „equity: init stores" creates empty stores and the schema version. It runs through
  `guardedRun`, so the encrypted pre-migration copy is written first.
- Nav: `v('equity', 'navEquity', 'Mitarbeiteraktien')` in Home (Advanced until a plan exists, § 7 #9). Empty state with
  „Plan anlegen".
- Demo: plans and grants only (events follow per package).
- Tests: normalize/round-trip, lot link (basis = FMV × stored rate, never 0), `tx.fx` precedence in
  the ledger, existing ledger tests unchanged, ISO currency check, `moneyAuto` JPY/KWD/EUR,
  GBX→GBP, fallback flag, manual override, non-EUR base (CHF, JPY).

### Package 2 — RSU (PR `equity/2-rsu`)

- **Schedule builder.** Presets: 4y/1y cliff monthly, 4y/1y cliff quarterly, 3y yearly, 25/25/25/25.
  Free cliff and frequency; fully custom tranches with uneven %. The sum check must equal 100 % or the
  total units.
- **Rounding.** `floor` per tranche with a true-up on the last one (default), `round`, or `none`
  (fractional). Tested for 1,000 units / 16 tranches and for prime totals.
- **Withholding.** `sell_to_cover` (withheld units = ceil(gross × rate) or entered actual), `payroll`
  (0 withheld), `none`. **Net units drive the lot.** Sell-to-cover books gross units plus a same-day sale of the withheld units (§ 7 #5).
- **Dividend equivalents** (optional): cash or reinvested units on unvested units, from
  `DividendDataService`. Default Arbeitslohn (§ 7 #12).
- **Auto-generation.** Past tranches become VestEvents from the close history (`close-history.js`) and
  the FX history. FMV source per plan: close of the vest day (default), previous close, or manual.
  Future tranches stay `projected` and never become lots.
- Overrides per event: actual FMV, withheld units, FX rate.
- UI: grant form, schedule preview table + mini timeline, vested/unvested card.
- Demo: RSU 4y / 1y cliff / quarterly in USD, granted 2023-03-01, so past vests exist.

### Package 3 — PSU (PR `equity/3-psu`)

- Target units, performance period, multiplier range (min/target/max, default 0/100/200 %).
- Before settlement: low/target/high scenarios × current price (and the forecast scenarios of P4).
- Settlement: the user enters the actual multiplier, and units = target × multiplier (rounding rule).
  The tranche becomes `vested`, or enters an optional time-based schedule after the performance period
  (reuses the P2 builder).
- Demo: one PSU (3-year period, settled at 120 %) plus one open PSU showing scenarios.

### Package 4 — ESPP (PR `equity/4-espp`)

**Contributions**
- `monthly = pct × eligibleIncome(month)` in salary currency. Eligible compensation:
  `base` | `base_bonus` | `custom` (per income kind on/off).
- Income timeline: annual salary ÷ 12 (or monthly), FTE % (part-time), unpaid periods (parental leave
  = 0), bonus month, 13th salary, all with effective dates.
- Contribution % history: changes only at offering start (default). Option: mid-period decrease or
  withdrawal (withdrawal → refund of the cash, configurable).
- Actual deduction per month from the payslip overrides the calculated one. The UI marks
  „berechnet" vs „bestätigt".
- Caps per period and per year: amount (in a plan-defined currency) and/or max shares. The UI shows
  the remaining headroom and warns when a bonus month would exceed the cap. Excess is carried over or
  refunded (configurable). An optional „FMV-at-offering-start" cap type covers US §423-style plans
  (26 U.S.C. § 423(b)(8): USD 25,000 per calendar year, measured at the offering-start FMV), as a
  plan parameter, not hard-coded.
- FX salary → share currency: at the purchase-date rate (default) or monthly. The FX effect is shown
  separately (monthly vs purchase-date conversion).
- Accumulated contributions = „ESPP-Guthaben" (salary currency), counted as cash in net worth.

**Purchase**
- `price = (1 − discount) × (lookback ? min(FMV_start, FMV_purchase) : FMV_purchase)` in share currency.
- Units = available cash (converted) ÷ price, using the plan rounding (whole shares + cash carry, or
  fractional).
- The lot basis = FMV_purchase (share currency + tax currency at that day's rate). Stored:
  `discountAmount`, `lookbackGain`, `effectiveDiscountPct`.
- „Sofort verkaufen" option: a linked sell transaction on the purchase date. The realised gain or loss
  is shown separately.
- Leftover cash is carried over or refunded (configurable).
- Annualised return on contributed cash (XIRR of monthly contributions vs value at purchase and
  today), in salary and base currency.

**Forecast**
- Future contributions from the income timeline + optional raise % p.a. + known bonus months +
  current %. Horizon: current period, 1y, 3y or 5y. All purchase dates come from the plan settings.
- Price scenarios per purchase date: flat; CAGR presets −20/0/+10/+20 % p.a. plus free input;
  Monte Carlo P10/P50/P90. MC = **block bootstrap** of the stock's own daily log returns from
  `close-history.js`, with seeded mulberry32 (seed shown and editable, default fixed),
  N = 2,000 paths. Simulation runs in share currency, then converts to base. FX scenario (flat or
  ±X % p.a.) is its own band.
- Per purchase × scenario: contribution, price, shares, value at purchase, instant discount gain,
  match shares (P5).
- Cumulative chart: contributions vs value band P10–P90 with markers on purchase dates (existing chart
  components).
- Current offering with lookback: guaranteed max price = (1 − d) × FMV_start, and the minimum gain if
  the price stays above it.
- „Was wäre wenn" sliders: contribution %, raise %, price change, FX change. They show the effect on
  shares and on the cap.
- Forecast rows are labelled „Schätzung" everywhere and are never written to the store.
- Demo: ESPP, 6-month periods (Jan–Jun / Jul–Dec), 15 % discount, lookback, 10 % of gross, EUR
  salary, USD share, raise on 2025-04-01, bonus in March, 25 % match (P5).

### Package 5 — Employer match (PR `equity/5-match`)

- Rules per ESPP plan with effective dates: `pct` (e.g. 25 %), basis `purchase_value` |
  `own_contribution` | `ratio` (X free per Y bought), optional cap per year/period (amount or
  shares), delivery `immediate` | `vesting` (own schedule/holding period, e.g. 2 years),
  forfeiture flags `onLeave`, `onSaleOfUnderlying`.
- Each purchase creates a linked MATCH grant: units = matchValue / FMV_purchase (rounding rule).
  Immediate delivery → lot at FMV_delivery. Vesting delivery → tranches in the pipeline → lot at vest
  (FMV and FX of the vest day).
- Tracked per purchase: own contribution, discount gain, match value, total "free" value, effective
  return on own money.
- UI: the ESPP card splits own vs match shares (vested/unvested). The forecast shows „effektiver
  Rabatt inkl. Match" (e.g. 15 % + 25 % → value per own 100). Sell-form warning: „Der Verkauf dieser
  Aktien lässt X nicht gevestete Match-Aktien verfallen (≈ Y)." Underlying shares are found by FIFO on
  the purchase lots.
- Demo: 25 % match with a 2-year holding period. One match tranche has vested.

### Package 6 — Overview page „Mitarbeiteraktien" (PR `equity/6-overview`)

- Totals in base currency (toggle: share currency): vested, unvested (RSU/PSU/match), ESPP cash,
  value per plan.
- Vest calendar: timeline + list of upcoming RSU/PSU/match vests and ESPP purchases.
- Combined 12-month forecast (vests + purchases + match) with the P4 scenarios and FX band.
- „Austritt zum Datum X": kept vs forfeited units and value per type, plus the ESPP cash refund.
  Leaver rules are configurable per plan (§ 7 #8).
- Concentration risk: employer stock as % of net worth with and without unvested shares. A warning
  threshold (default 10 %, configurable) as a `risk-monitor.js` rule + an Overview chip.
- `.ics` export of upcoming vests and purchases via `event-feed.toICS` (amounts only if the user opts
  in, like today).
- Trading windows / blackout periods per plan, with a hint on the sell form.

### Package 7 — Tax (DE first, AT/CH hooks) (PR `equity/7-tax`)

All figures are in the tax currency at the event-day rate stored on the event.

**DE rules (each one a parameter in `equity-tax.js`, legal basis in code comments):**

| Item | Treatment | Basis |
|------|-----------|-------|
| RSU/PSU vest: FMV × gross units | Arbeitslohn (Anlage N), inflow at delivery (Einbuchung) | § 19 Abs. 1 Nr. 1, § 11 Abs. 1 EStG; § 38 EStG (payroll withholding) |
| ESPP: FMV_purchase − price paid (discount + lookback gain) | Arbeitslohn at purchase | § 19, § 8 Abs. 1 EStG |
| Match shares: FMV at delivery/vest | Arbeitslohn at delivery/vest | § 19, § 8 EStG |
| Gains after vest/purchase | Kapitaleinkünfte (Anlage KAP), basis = FMV in EUR on the inflow day | § 20 Abs. 2 S. 1 Nr. 1, § 20 Abs. 4 S. 1 EStG (foreign-currency transactions converted at the time of acquisition and of sale) |
| Employee-share allowance | Up to **2,000 € per calendar year** tax-free, if the offer is open to at least all employees with ≥ 1 year of uninterrupted service; group companies under § 18 AktG count; value = gemeiner Wert | § 3 Nr. 39 S. 1–4 EStG (text checked on gesetze-im-internet.de, 2026-10-26); BMF letter of 16.11.2021, IV C 5 - S 2347/21/10001 |
| Deferred taxation (startups) | Not modelled; flag only | § 19a EStG |

- Settings: allowance amount (default 2,000, editable per year), „Plan erfüllt § 3 Nr. 39"
  yes/no/unknown (default **unknown** → no allowance applied, hint shown), FMV source.
- Yearly report: the Anlage N component per event (gross value, allowance used, taxable part, payroll
  withholding entered) vs the KAP part (realised gains of equity lots from the ledger). It lists the FX
  rates used, with fallback and manual flags, and all lots with their EUR basis. Export as CSV and PDF
  (existing `statements.js` PDF path, optional AES).
- Warnings (new stable `data-check.js` codes): `DQ-EQUITY-BASIS-ZERO` (lot from import or manual
  entry with basis 0 → double-taxation risk), `DQ-EQUITY-FX-MISSING` (basis in share currency without
  a stored conversion), `DQ-EQUITY-FX-FALLBACK` (info).
- AT/CH: the report structure and tax-currency handling are in place; rules are `TODO` with sources
  to check (AT § 3 Abs. 1 Z 15 lit. b EStG 1988; CH ESTV Kreisschreiben Nr. 37 „Besteuerung von
  Mitarbeiterbeteiligungen"). Nothing is computed until verified.
- Label: „Hilfsrechnung, keine Steuerberatung" (like the other tax panels).

### Package 8 — Import (PR `equity/8-import`)

- Plan-admin importers (Morgan Stanley StockPlan Connect, E*TRADE, Schwab, Fidelity): only once the
  owner attaches real export files (anonymised). No guessed formats.
- Now: a mapping-based CSV import built on `import-mapping.js`. Targets: grants, vests, ESPP
  contributions, purchases, match shares. Columns include currency and optional FX rate. Preview, row
  errors, number and date locales come from the existing engine.
- Dedupe against manual events: key = plan + type + date + units (± rounding tolerance) + FMV. On a
  match the import offers merge, which keeps manual overrides.

---

## 4. Demo data (grows per package)

| Example | Details |
|---------|---------|
| RSU (USD) | Employer „Contoso" (fictional), ticker MSFT, 400 units, granted 2023-03-01, 4y/1y cliff quarterly, sell-to-cover |
| PSU (USD) | Same plan, 120 target units, 2023–2025 period settled at 120 %; plus an open 2025–2027 PSU |
| ESPP (USD share, EUR salary) | 6-month periods, 15 % discount, lookback, 10 % of gross, 25 % match with a 2-year hold; salary 78,000 € → 84,000 € from 2025-04-01, bonus 9,000 € in March, 13th salary in November |
| Non-EUR | ESPP with CHF salary and a **GBX**-quoted share (e.g. a LSE ticker), cap in GBP |

Offline FMV and FX series are added to `demo-fixtures.js` (generated deterministically, no network).
Demo tickers: fictional employer, real tickers (§ 7 #10).

---

## 5. Tests (minimum, spread over the packages)

- Vesting: cliff, uneven tranches, floor + true-up, fractional.
- PSU: scenarios, settlement, post-period vesting.
- ESPP: variable months incl. bonus and cap overflow (carry vs refund), actual vs calculated, lookback
  with a price drop and a rise, FX at the purchase date vs monthly, leftover cash, withdrawal.
- Match: % on value vs own contribution vs ratio, cap, immediate vs vesting, forfeiture on early sale
  and on leaving.
- Currencies: non-EUR base (CHF, JPY), USD share + CHF salary, GBX share, JPY 0 decimals, KWD 3
  decimals, missing FX day → fallback flag, manual override wins, base-currency change recomputes
  without touching stored events.
- MC determinism: same seed → identical P10/P50/P90; a different seed → different paths.
- Lot basis always = FMV at vest/purchase in share and tax currency, never 0.
- Migration v7 idempotent; the pre-migration copy is written before it runs (existing guard test
  extended).
- e2e: the „Mitarbeiteraktien" view renders in demo mode (CI=1, ends on the Tax view as today).

---

## 6. Risks

- **Ledger touch** (`tx.fx`): small, but central. It is covered by the full existing suite + new tests,
  and it is a pure addition.
- **Reporting-currency generalisation** touches every view that formats money. It goes in P1 behind the
  existing tests; views without a rate fall back to EUR, as they do today.
- **Yahoo crosses** for exotic currencies may be missing. The miss store + manual override + `approx`
  flag cover this; nothing is silently wrong.
- **Size**: P4 is the largest PR. If it exceeds ~2,500 lines, split it into 4a (contributions + purchase)
  and 4b (forecast). The owner is told before the split.

---

## 7. Decisions (2026-10-26)

The owner approved all recommendations on 2026-10-26 ("auto-approve your recommendations").
These replace the open questions of the first draft.

| # | Question | Decision | Why |
|---|----------|----------|-----|
| 1 | Plan file in the repo | `PLAN-EQUITY.md` is committed publicly | Owner's choice; an exception to the rule that keeps internal plans git-ignored |
| 2 | Base currency | Any ISO currency **app-wide**: `reporting-currency.js` is generalised in Package 1 | One base currency everywhere; rates for every currency already come from the open.er-api table |
| 3 | Salary sync | `maermin_income` is sensitive, encrypted at rest and synced as ciphertext like portfolio data | Matches the brief; backup restore and second devices keep working; the Worker never sees plaintext |
| 4 | Tax FX source | Existing pipeline rate + manual override per event; no ECB source and no Worker change | The brief names the existing pipeline; payslip rates are entered as overrides |
| 5 | Sell-to-cover | Book **gross** units at FMV + a same-day sale of the withheld units at the real sale price (default: FMV, editable) | That sale is a real taxable disposal; the remaining position is the net units, so net units still drive the holding |
| 6 | FMV at vest | Close of the vest day; previous close or manual per plan/event | The valuation date under § 3 Nr. 39 / BMF is not verified; the override covers the plan admin's FMV |
| 7 | Match forfeiture on sale | Shares of the **specific purchase** the match belongs to | Each match is tied to one purchase |
| 8 | Leaving | Leaver rules per plan; default: unvested RSU/PSU/match forfeited, ESPP cash refunded | Plans differ; the default is the common case |
| 9 | Nav visibility | Advanced only until a plan exists, then also in Simple | An empty page does not crowd Simple mode |
| 10 | Demo tickers | Fictional employer with real tickers and deterministically generated prices | Charts and FX look real, no real company is implied as employer |
| 11 | AT/CH | Data model + report structure only; rules TODO with the sources named | Nothing unverified is computed |
| 12 | Dividend equivalents (DE) | Setting; default Arbeitslohn, flagged as unverified | Most likely treatment; not verified |
| 13 | Monte Carlo | Block bootstrap of the stock's own daily log returns, seeded; ≥ 2 years of history, else CAGR scenarios only | Keeps fat tails; reproducible |
| 14 | Fünftelregelung (§ 34 EStG) | Hint only, no calculation | Not verified; applied only in the assessment since 2025 |
| 15 | Plan-admin importers | Built when the owner sends real (anonymised) export files | No guessed formats |
| 16 | Merging | The owner merges every package PR. Packages are stacked on the previous package's branch when it is not merged yet, and the PR says so | Owner merges by default |
