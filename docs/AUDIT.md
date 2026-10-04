# MAERMIN audit log

Findings from focused audits. Security findings that are not yet released live in
`docs/AUDIT.security.local.md` (git-ignored) and move here once fixed and released.

Severity: **Critical** (wrong money figures, data loss, exploitable hole) ·
**Important** (feature broken or misleading, real friction) · **Optimization** (polish).
Status: `open` · `approved` · `fixed` · `wontfix`.

---

## Run 2026-10-04 — focus `bugs`, area `tax`

Source: GitHub `Maermin/MAERMIN` `main` @ `65789b4`. Gates on Node 24.19: `npm run check` green
(192 files), `npm test` green (85 suites) — none of the findings below is covered by an existing
test. Every finding below was
reproduced by loading the real modules (`fx-history`, `ledger`, `tax-settings`,
`tax-calculation-engine`, `tax-report-builder`, `tax-advisor`, `exchange-sync`) in Chromium
(V8, time zone Europe/Berlin), unless marked "traced".

### BUG-001 — Church-tax selector in the German fund-tax panel has no effect
- **Severity:** Critical · **Status:** fixed (fff1500, a0079b1, 61a0e3f) · **Found:** 2026-10-04
- **Location:** `german-tax-view.js:163`, `german-tax-view.js:263`, `german-tax-view.js:290-297`; `tax-calculation-engine.js:196-201`, `tax-calculation-engine.js:214`; `tax-report-builder.js:305-306`
- **What happens:** Church tax is stored twice: in `maermin_kirchensteuer`, written by the selector in the panel header, and in `maermin_tax_settings.kirchensteuer`, written by "Tax settings (overrides)". The report always receives a settings object (`TS.load()` returns defaults when nothing is stored). The engine then computes the tax, and the withholding-credit factor `k`, from `settings.kirchensteuer` only. The panel's `kirchensteuerRate` is passed through but never read, and the renderer's KPI build doesn't pass it at all.
- **Reproduce:** Dividends of 3,000 EUR, tax settings at defaults, `build(..., { kirchensteuerRate: 0.09 })`. Total tax is **527.50**, the same as without church tax, and `kirchensteuer = 0`. Expected **559.90** (Kirchensteuer 44.01). In the app: pick "9%" in the panel header and neither Est. Tax nor the panel total changes.
- **Why it matters:** Users who set church tax where the panel offers it get an understated tax figure, on screen and in the PDF/Excel. Values saved by older builds in `maermin_kirchensteuer` are silently ignored.
- **Proposed fix:** Keep one store, `MaerminTaxSettings`. Bind the panel selector to `TS.load().kirchensteuer` / `TS.save({ kirchensteuer })`, and in `MaerminTaxSettings.load()` adopt a legacy `maermin_kirchensteuer` value once when the settings carry none. Test: the report honours the rate set through the panel's path, and a legacy key is adopted.

### BUG-002 — All capital losses share one pot: share losses offset dividends, interest and fund gains
- **Severity:** Critical · **Status:** fixed (82504f8) · **Found:** 2026-10-04
- **Location:** `tax-calculation-engine.js:188-191`; `tax-report-builder.js:315-330`
- **What happens:** `computeGermanTaxDetailed` nets every disposal, dividend, interest and Vorabpauschale in one sum. Under §20 (6) S.4 EStG, losses from selling shares (Aktien) may only offset gains from selling shares. A share loss above share gains stays in the Aktienverlusttopf and must not reduce dividends, interest or fund gains.
- **Reproduce:** Share loss −2,000 (BAYN, category `stocks`, no fund type) plus 3,000 dividends in 2025. App: taxable income **0**, tax **0.00**. Statutory: taxable income 2,000, tax **527.50**.
- **Why it matters:** The Est. Tax KPI, the panel and the exports understate tax whenever share losses exceed share gains. The same Tax view shows the advisor saying "share losses only share gains" while the KPI nets them. `PLAN.md:24` says the September review's tax-pot findings are fixed; that is only true for the advisor (`tax-advisor.js:179-229`), not for the engine. The PDF footnote "simplified loss netting" does not tell the user that the figure can be too low.
- **Proposed fix:** Split the capital block into (a) shares: category `stocks`, not classified as a fund (same `isFund` rule as `renderer.js:4192-4196`), and (b) everything else. Net (a) on its own. A positive result joins (b); a negative result is reported as "share loss not offsettable this year" and does not reduce (b). Losses in (b) may still offset share gains. Expose `shareLossCarried` in `germanDetail` and in the PDF/Excel rows. Loss carry-forward across years (Verlustvortrag) stays out of scope. Tests: the case above; share loss against share gain; fund loss against share gain.

### BUG-003 — CS2 skins and physical commodities are taxed as capital income instead of § 23 private sales
- **Severity:** Critical · **Status:** fixed (0c6baea) · **Found:** 2026-10-04
- **Location:** `tax-report-builder.js:315` (`d.category !== 'crypto'`), `tax-report-builder.js:339-348`
- **What happens:** Only `crypto` goes to the § 23 block, with the 1-year exemption and the Freigrenze. Skins and commodities (physical gold, etc.) go to the § 20 block and get Teilfreistellung, the Sparerpauschbetrag and 25 % Abgeltung. The September review already listed this (`docs/REVIEW-2026-09.md:95`, Med) and it is unchanged.
- **Reproduce:** Skin bought 2022-01-10 for 2,000 and sold 2025-06-01 for 5,000. App tax **527.50**. Statutory: held more than 1 year under § 23 (1) Nr. 2 EStG, so **0**. A short-term skin gain of 800 is likewise tax-free under the Freigrenze, but the app taxes it or uses up the Sparerpauschbetrag with it.
- **Why it matters:** Overstated tax for skin and gold holders. Their gains also never count toward the shared § 23 Freigrenze with crypto.
- **Proposed fix:** Route `skins` and `commodities` through the § 23 block with crypto: per-lot 1-year rule, one Freigrenze across all § 23 gains. Allow a per-symbol override to § 20 for securitised commodities (commodity ETFs/ETCs), stored next to `maermin_fund_types`. The labels in `germanDetailRows` change from "Crypto …" to "Private sales (§ 23) …". Tests: the skin case, a combined crypto + skin Freigrenze, and the § 20 override.

### BUG-004 — Exchange-synced trades get the UTC calendar day: wrong tax year and wrong § 23 anniversary
- **Severity:** Important · **Status:** fixed (9587729) · **Found:** 2026-10-04
- **Location:** `exchange-sync.js:39` (`ymd` = first 10 characters), `exchange-sync.js:97`, `exchange-sync.js:110` (`new Date(ms).toISOString()`); Coinbase `created_at` goes through the same `ymd`
- **What happens:** Trade timestamps are cut to the UTC date. For a German user, any trade between 00:00 and 01:00 (02:00 in summer) local time is booked on the previous day.
- **Reproduce:** Binance sell at 2026-01-01 00:30 Berlin is stored as **2025-12-31**, so it is taxed in 2025. Buy at 2025-03-10 00:30 Berlin is stored as 2025-03-09, and a sale on 2026-03-10 (the anniversary, still taxable) is reported as **long-term / tax-free**.
- **Why it matters:** These are wrong money figures, but only for trades in a one-to-two-hour window: a gain can land in the wrong year, or be shown as tax-free when it isn't.
- **Proposed fix:** Derive the date in the user's local time zone, not UTC, for example `new Date(ms)` with local `getFullYear/getMonth/getDate` padded, or `Intl.DateTimeFormat('en-CA', { timeZone })`. Do this in a small helper used by all three adapters. Already-synced trades keep their stored date; dedupe uses `externalId`, so a re-sync does not duplicate them. Mention in the release notes that a re-import fixes the old dates. Test: an epoch at 23:30Z on 31 Dec maps to 1 Jan with `TZ=Europe/Berlin`.

### BUG-005 — Tax advisor ignores the Freistellungsauftrag setting for Sparerpauschbetrag headroom
- **Severity:** Important · **Status:** fixed (e31d77f) · **Found:** 2026-10-04
- **Location:** `renderer.js:4214-4221` (no `sparerpauschbetrag` in `taxData`); `tax-advisor.js:272`
- **What happens:** "Used" comes from the engine, which applies `freistellungsauftrag` from the tax settings. The limit falls back to `sparerLimitFor(taxOwner)`: 1,000, or 2,000 only when a `married` flag is set, which no UI sets. So the two numbers come from different allowances.
- **Reproduce:** Freistellungsauftrag 500 (allowance split across banks), dividends 600. Engine: 500 used, 100 taxable. Advisor: "500 / 1000 EUR, 500 EUR remains tax-free" and recommends realising about 500 EUR more "tax-free". With 2,000 set for a married couple, the advisor reports the allowance as exhausted at 1,000.
- **Why it matters:** The advice is directly wrong: it suggests realising gains that will be taxed, or reports headroom as gone when it isn't.
- **Proposed fix:** Pass `sparerpauschbetrag: g ? g.sparerpauschbetrag : undefined` in the advisor's `taxData` in `renderer.js`. Test: `gather` + `analyze` with an allowance of 500 shows 0 remaining after 600 of income.

### BUG-006 — A per-position taxable override is counted once per FIFO lot (latent)
- **Severity:** Important · **Status:** fixed (fa7cd98) · **Found:** 2026-10-04
- **Location:** `tax-report-builder.js:315-320`
- **What happens:** The override is keyed `SYMBOL|year` and documented as *the* taxable amount for that position and year. But it replaces the gain of **every** disposal row. FIFO emits one row per lot matched and per sale, so the override is multiplied.
- **Reproduce:** Three buy lots, one sale of all 30 units, override `SAP|2025 = 500`. `gainsTaxable` = **1,500**.
- **Why it matters:** Latent today. Nothing in the UI calls `MaerminTaxSettings.saveOverride` (only tests do), but the key is synced, backed up and read on every build. The existing test (`test/tax-settings.test.js:95-105`) uses a single lot, so it doesn't catch this.
- **Proposed fix:** Apply the override once per symbol: the first disposal row of that symbol in the year carries it and the others are dropped from the capital block. Add a multi-lot test.

### BUG-007 — Vorabpauschale prefill picks distributions by the device's local year
- **Severity:** Optimization · **Status:** fixed (4273fa8) · **Found:** 2026-10-04 (traced; reproduced by the regression test with TZ=America/New_York)
- **Location:** `german-tax-view.js:105` (`new Date(tx.date).getFullYear()`)
- **What happens:** For users west of UTC, a distribution dated `YYYY-01-01` is parsed as UTC midnight and counted in the previous year's worksheet. The report builder was fixed for this (RELEASE: "Dates are read from the stored YYYY-MM-DD"), but this spot was missed. No effect in Germany.
- **Proposed fix:** Read the year from the stored string (`parseInt(String(tx.date).slice(0, 4), 10)`), as `tax-report-builder.js:170` does.

### Fix notes (branch `audit/bugs-2026-10-04`)
- Regression tests: `test/tax-audit.test.js` (44 checks), each block shown failing before its fix.
- BUG-001 deviates from the proposal: the single store is the **encrypted** `maermin_kirchensteuer`, not `maermin_tax_settings` (which is plaintext by design). A rate found in `maermin_tax_settings` is moved over once and removed.
- BUG-003: commodities default to sec. 23; the per-symbol switch to sec. 20 lives in the German tax panel and is stored as `SYMBOL|class` in the existing sensitive `maermin_tax_overrides` (no new key, no `storage.js` change).
- BUG-005: the advisor input moved from `renderer.js` into `MaerminTaxAdvisor.taxDataFromReport` so it is testable; an allowance of 0 is now respected.
- Verified: `npm run check`, `npm test` (86 suites), `npm run test:e2e` (128 checks, Edge as Chromium) and a manual pass of the Tax view in Demo mode (new commodity select, church tax shared by both panels and kept across lock/unlock).

### Out of scope (noted, not investigated)
- (Investigated in the next run: see BUG-010.) `import-export-engine.js:371-398` (`parseDate`, legacy CSV import reached from `renderer.js:2047`/`2247`) tries native parsing first. V8 reads `01.02.2025` as **2 Jan** (should be 1 Feb). `31.12.2025` becomes local midnight → `2025-12-30T23:00Z`, so in Germany every DD.MM.YYYY date moves back one day, and a 1 January trade moves into the previous tax year. V8 behaviour confirmed; the call path from the UI was not traced.
- Per-position taxable overrides have no editor, although comments say they are "edited from the German tax worksheet" (`german-tax-view.js:335-337`, `tax-settings.js:16-18`). That is a features gap.
- Loss carry-forward (Verlustvortrag) across tax years is not modelled.

---

## Run 2026-10-04 (2) — focus `bugs`, area money maths outside tax (returns, positions, splits, FX, import)

Base: branch `audit/bugs-2026-10-04` @ `975b2f4`. Gates green before the run. Reproduced with the
real modules under Node 24 (`import-mapping`, `fx-history`, `ledger`, `corporate-actions`,
`returns-engine`). Checked and found correct: XIRR (sign change, convergence, leap-day span,
empty input), TWR chain-linking, split overlay (split between lots + partial sale after it), FIFO
oversell reporting, sell-fee pro-rating.

### BUG-008 — CSV import turns savings-plan buys into sells (any type text containing "s")
- **Severity:** Critical · **Status:** fixed (66acf84) · **Found:** 2026-10-04
- **Location:** `import-mapping.js:86-88` (word lists with the single letters `'b'` and `'s'`), `import-mapping.js:177-184` (`includes()` matching, unknown type defaults to `buy`), `import-mapping.js:290` (`Math.abs` drops the quantity's sign)
- **What happens:** `normalizeType` checks the sell list before the buy list, and the sell list contains `'s'`, matched with `t.includes(w)`. Any type text containing an "s" therefore becomes a sell. Any text that matches nothing becomes a buy. When no type column is mapped, a negative quantity (the usual way exports mark a sell) is made positive and booked as a buy.
- **Reproduce:** `normalizeType('Savings plan')` → `sell`, `'Sparplan'` → `sell`, `'Purchase'` → `sell`, `'Deposit'` → `sell`, `'Transfer'` → `sell`, `'Fee'` → `buy`, `'Convert'` → `buy`. A row `BTC, quantity -0.5` with no type column → `buy 0.5`.
- **Why it matters:** This is the main import pipeline (the mapping preview in the Broker Import wizard). A Scalable Capital or Trade Republic export with savings-plan rows imports every plan execution as a sale: positions shrink or are oversold, and realised gains and the tax report are wrong. The preview shows the wrong type, but nothing warns about it.
- **Proposed fix:** Match the single letters `b`/`s` only as the whole value. Match words on word boundaries. Add savings-plan words (`savings plan`, `sparplan`, `sparplanausführung`) to the buy list. A non-empty type that matches no list becomes a row error ("unknown type: …") instead of a silent buy. With no type value, a negative quantity means sell. Tests: the strings above, plus a negative quantity without a type column.

### BUG-009 — USD trades dated before the FX history are converted at an unrelated rate and labelled "exact"
- **Severity:** Important · **Status:** fixed (dd5c151, fdb06fb) · **Found:** 2026-10-04
- **Location:** `fx-history.js:105-121` (`fxResolver` returns the **earliest** stored rate for a date before the history), `fx-history.js:376-380` (`txToEUR` reports `exact` for any USD conversion)
- **What happens:** Without a Worker, the history only holds the live rates recorded on the days the app was opened (`renderer.js:1340`). A 2022 trade is converted at the rate of the first recorded day, and the status says `exact`, so the ledger's data check (`ledger.js:73-76`) never flags it. With a Worker the daily series covers about 20 years, so only very old trades or a failed backfill are affected.
- **Reproduce:** History `{2026-09-01: 0.86, 2026-10-04: 0.85}`: a USD buy on 2022-03-01 → value 860 € at 0.86, status `exact`, `issues: []`.
- **Why it matters:** The cost basis, realised gains and the tax report for USD trades depend on this rate. The app promises per-date FX, and the data check exists precisely to say when it can't provide that.
- **Proposed fix:** `fxResolver` returns `null` for a date before the first stored day (more than a few days earlier). `txToEUR` then falls back to the static rate with status `approx` when `fxAt` gave no rate, so the Transactions/Tax data check lists it. Test: the case above reports `approx` and a currency issue; a covered date stays `exact`.

### BUG-010 — Legacy CSV fallback parser misreads dates
- **Severity:** Optimization · **Status:** fixed (697d0d6) · **Found:** 2026-10-04
- **Location:** `import-export-engine.js:371-404` (`parseDate`), reached through `features2.js:518-527` and `features2.js:1117` only when the mapping preview could not be built (`mp` null)
- **What happens:** Native parsing runs first, so V8 reads `01.02.2025` as 2 January. `31.12.2025` falls through to local midnight → `toISOString()` → `2025-12-30T23:00:00Z` in Germany, so dates move back one day and 1 January trades land in the previous year.
- **Why it matters:** Only on the fallback path, but then silently. The main pipeline (`MaerminImportMapping.parseDate`) gets this right.
- **Proposed fix:** Delegate to `MaerminImportMapping.parseDate` when it is loaded (day-first for dotted dates, `YYYY-MM-DD` output), and keep the native parse as the last resort. Test: `31.12.2025` → `2025-12-31`, `01.02.2025` → `2025-02-01`.

### BUG-011 — Sells with a zero or negative quantity disappear without a data-quality warning
- **Severity:** Optimization · **Status:** fixed (4489054) · **Found:** 2026-10-04
- **Location:** `ledger.js:98-99` (`if (!(qty > 0)) return;`); reachable through the JSON quick import (`renderer.js:2072` keeps the sign)
- **What happens:** `{type:'sell', quantity:-0.5}` is skipped. The position stays 0.5 too large and `issues` stays empty.
- **Proposed fix:** Report a `kind: 'quantity'` issue for buy/sell rows with a non-positive or non-numeric quantity, so they show up in the existing data-check banner. Test: the row above produces one issue.

### Fix notes
- Regression tests: `test/money-audit.test.js` (32 checks), each block shown failing before its fix.
- BUG-009 deviates slightly from the proposal: the converted value is unchanged (nearest stored rate, as `test/fx-history.test.js` intends); only the status becomes `approx` via the new `fxResolver(...).covers(date)`. The data-check banner got a USD-specific line.
- BUG-008: unrecognised types are now row errors in the import preview (no silent buy).
- Verified: `npm run check`, `npm test` (87 suites), `npm run test:e2e` (128 checks) and the data-check banner in Demo mode (AAPL USD buy without a Worker).

### Out of scope (noted, not investigated)
- `renderer.js:2046-2051`: CSV pasted into the quick Import dialog is parsed into `{ headers, rows }`, which none of the following branches handles (array / `.transactions` / `.portfolio`). Likely a dead end for CSV in that dialog (usability).
---

## QA pass 2026-10-04 — all fixes in the running app

Branch `audit/bugs-2026-10-04`, dev `index.html` served locally, Demo mode, test vault (e2e fixture password). Test data imported through **Data Management → Manual Import**: BAYN.DE bought 2024-01-10 at 50 and sold 2025-06-01 at 30 (×100), an ALV.DE dividend of 3,000 on 2025-05-10, the demo skin sold 2025-06-01 at 500 (×2), and the demo XAU sold 2025-06-01 at 2,500 (×0.5). Tax year 2025, Germany.

| Check | Expected | Seen |
|---|---|---|
| BUG-002 share loss vs dividends | taxable 2,000, tax 527.50, carried share loss 2,000 | ✓ card + panel 527.50, "Share losses not offset €2,000.00" |
| BUG-003 skin + XAU held > 1 year | no tax on 944 + 338.33 | ✓ realised −717.67, no private-sale tax |
| BUG-003 XAU switched to capital income | taxable 2,338.33 → 616.74 | ✓ |
| BUG-001 church tax 9 % in the panel | 559.90 | ✓ panel; the card was stale → fixed in `61a0e3f`, re-checked: card + panel 699.88 (allowance 500) and 794.59 (with XAU as capital) immediately |
| BUG-005 Freistellungsauftrag 500 | advisor 0 / 500, tax 659.38 | ✓ |
| BUG-008 Broker Import (Scalable), CSV with "Savings plan" / "Sell" / "Transfer" | BUY, SELL, row error | ✓ "Row 3: unknown type \"Transfer\" (map it or edit the file)", Import 2 |
| BUG-009 USD buy 2023 without a Worker | data check, USD line | ✓ |
| BUG-011 JSON import of a sell with quantity −0.5 | data check warning | ✓ "quantity \"-0.5\" is not a positive number" |

Not testable in the UI (covered by unit tests): BUG-004 (needs exchange API keys), BUG-006 (no editor), BUG-007 (time zone west of UTC), BUG-010 (fallback path only). PDF/Excel downloads were not clicked (downloads need the owner's OK); the e2e suite covers the PDF export. Gates after the follow-up: check 194 files, test 87 suites, e2e 128/128.

### Noted during QA (not investigated)
- Broker Import wizard: after choosing Scalable Capital the preview says "Detected: Interactive Brokers" (`MaerminImportMapping.preview` sniffs the headers and ignores the chosen broker). The suggested mapping was still correct.
- Demo mode does not keep imported transactions across a reload (by design, "your real data is untouched"), but nothing tells the user that their test imports will vanish.