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
---

## Run 2026-10-04 (3) — focus `usability`, whole app

Branch `audit/bugs-2026-10-04` @ `f169eef`. Dev `index.html` served locally, built-in browser (Chromium, 1024×768), Demo mode, test vault. Walked: lock (idle auto-lock) and unlock (wrong and right password), add transaction, quick Import dialog, Broker Import wizard, create and switch portfolio, open the settings menu, delete a transaction, and keyboard-only navigation of the sidebar and menus. Every finding below was seen in the running app; DOM facts were read with the page inspector. The baseline is `REPORT.md` §6; its items are only repeated where their status changed.

Working well: the sidebar is keyboard-operable with `aria-current`; shortcuts do not fire while typing; "Session locked due to inactivity" plus a clear wrong-password message; delete asks inline; an empty portfolio shows a helpful welcome state; "+ Add Transaction" preselects the active portfolio; dialogs are named with a focus trap (fixed since `REPORT.md`).

### UX-001 — Quick "Import Data" dialog offers CSV, rejects every CSV, and throws the pasted text away
- **Severity:** Important · **Status:** fixed (fe52939) · **Found:** 2026-10-04
- **Location:** `renderer.js:2046-2051` (CSV parsed to `{ headers, rows }`, which no branch handles), `renderer.js:2128-2132` (error path clears the text and closes the dialog), `renderer.js:4839` and `4862-4864` (instructions and a CSV example)
- **What happens:** The dialog says "Paste your transaction data in JSON or CSV format" and shows a CSV example. Any CSV, including that example, ends with the toast "Unknown format"; the dialog closes and the pasted data is gone.
- **Reproduce:** Overview → ↑ Import → paste `Date,Type,Symbol,Quantity,Price` / `2025-03-05,buy,SAP.DE,2,180` → Import.
- **Why it matters:** This is a dead end on the most visible import entry point, and it costs the user their input.
- **Proposed fix:** Map the parsed CSV rows like the JSON array (same column names), or hand CSV to the Broker Import wizard (`MaerminImportMapping.preview`) with its error report. On any error keep the dialog open with the text, and say what was wrong.

### UX-002 — A full backup pasted into "Import Data" overwrites the vault without asking
- **Severity:** Important · **Status:** fixed (14b0e96) · **Found:** 2026-10-04 (traced in code; not run, to protect the test vault)
- **Location:** `renderer.js:2053-2063`; `backup-engine.js:131-144` (`restore` writes every whitelisted key in the file)
- **What happens:** If the pasted JSON is a full backup, the app restores it immediately: transactions, settings and the other stores in the file replace the current ones. Then it reloads. Only a "Backup restored" toast is shown, and there is no undo.
- **Why it matters:** Pasting an old backup by mistake silently loses everything entered since. The encrypted restore in the settings menu does ask (`renderer.js:5499`).
- **Proposed fix:** An in-app confirmation before restoring, naming the backup's date and transaction count next to the current count. Offer "download a backup of the current data first".

### UX-003 — Add Transaction (and portfolio name) fields have no programmatic labels
- **Severity:** Important · **Status:** fixed (b7b7da0) · **Found:** 2026-10-04
- **Location:** Add Transaction dialog in `renderer.js` (around `4380-4800`, e.g. the "Price per Unit" label at `4599`); portfolio name input `features4.js:163`
- **What happens:** Visible `<label>` elements ("Portfolio", "Quantity", "Price per Unit", "Date", "Fees (optional)", "Notes (optional)") exist but have no `for`/`id`. Screen readers announce the three number fields only as "0.00", and the portfolio and date fields have no name at all. 7 of 8 fields are unnamed. (`REPORT.md` listed unlabeled Overview inputs; the dialog role has been fixed since, the labels have not.)
- **Proposed fix:** Give each input an `id` and its label `htmlFor`; add an `aria-label` to the symbol search and the portfolio name input.

### UX-004 — Toggle buttons expose no selected state (Buy/Sell, asset class, currency, portfolio chips)
- **Severity:** Important · **Status:** fixed (1bcaf65) · **Found:** 2026-10-04
- **Location:** Add Transaction dialog (`renderer.js` around `4397`), portfolio chips on the Overview
- **What happens:** Only the colour shows the choice. No `aria-pressed`/`aria-checked`, so a screen-reader user cannot tell whether they are entering a buy or a sell, or which portfolio is filtered.
- **Proposed fix:** `aria-pressed` on each toggle (or `role="radiogroup"` + `role="radio"` + `aria-checked` per group).

### UX-005 — "Please fill in all required fields!" without saying which
- **Severity:** Important · **Status:** fixed (0372072) · **Found:** 2026-10-04
- **Location:** `renderer.js:1928`
- **What happens:** Submitting an incomplete transaction only shows that toast; no field is marked, nothing gets focus.
- **Proposed fix:** Name the missing fields in the message, set `aria-invalid` + an inline hint on each, and move focus to the first one.

### UX-006 — Escape discards a half-filled transaction without asking
- **Severity:** Optimization · **Status:** fixed (7a9b83a) · **Found:** 2026-10-04
- **Location:** Add Transaction dialog close handling in `renderer.js`
- **What happens:** With quantity and a note typed, a single Escape (even with the cursor in a text field) closes the dialog. Reopening shows an empty form.
- **Proposed fix:** When the form is dirty, ask before discarding (or keep the draft until saved or explicitly cancelled).

### UX-007 — Settings menu: `role="menu"` without menu behaviour, and Escape loses focus
- **Severity:** Optimization · **Status:** fixed (54aab62) · **Found:** 2026-10-04
- **Location:** `renderer.js:5393`
- **What happens:** The 18 entries are plain buttons (no `menuitem`); arrow keys do nothing. Escape closes the menu but focus falls to `<body>` instead of the Settings button.
- **Proposed fix:** Drop `role="menu"` (a labelled group of buttons is enough), or implement the menu pattern; return focus to the trigger on close.

### UX-008 — Wrong-password message is not announced
- **Severity:** Optimization · **Status:** fixed (0167c36) · **Found:** 2026-10-04
- **Location:** `auth.js:203`, `223`, `258` (`#auth-error`), `auth.js:135`
- **What happens:** The error box has no `role="alert"`/`aria-live`, and the field gets no `aria-invalid`/`aria-describedby`. The field is cleared and keeps focus, so a screen-reader user hears nothing.
- **Proposed fix:** `role="alert"` on `#auth-error`, `aria-describedby="auth-error"` + `aria-invalid` on the field while an error shows.

### UX-009 — Row actions are all called "Edit" / "Delete"
- **Severity:** Optimization · **Status:** fixed (3ce657d) · **Found:** 2026-10-04
- **Location:** transaction rows in the Transactions view (`renderer.js`, row action buttons)
- **What happens:** 9 rows → 9 identical "Delete" buttons in a screen reader's button list.
- **Proposed fix:** `aria-label` such as "Delete AAPL dividend, 2024-05-16".

### UX-010 — Broker Import reports a different broker than the one chosen
- **Severity:** Optimization · **Status:** fixed (f4c8c74) · **Found:** 2026-10-04
- **Location:** `features2.js:652` (`IM.preview` is called without the selected broker)
- **What happens:** After choosing Scalable Capital the preview says "Detected: Interactive Brokers". The mapping was still right, but the label makes users doubt the import.
- **Proposed fix:** Pass the chosen broker to `preview` (it already accepts a mapping) and show "Scalable Capital (columns detected)".

### UX-011 — Demo mode drops your test entries on reload or auto-lock without saying so
- **Severity:** Optimization · **Status:** fixed (ba3f81c) · **Found:** 2026-10-04
- **What happens:** Transactions added or imported in Demo mode vanish after a reload or an idle lock. The banner says "your real data is untouched", but not that demo changes are temporary.
- **Proposed fix:** Add "Changes in demo mode are not saved" to the banner.

### UX-012 — Setup says "There is no recovery" and then issues a recovery code
- **Severity:** Optimization · **Status:** fixed (4a2a06a, 8b9b836) · **Found:** `REPORT.md` §6, confirmed 2026-10-04
- **Location:** `auth.js:202`
- **Fix:** "MAERMIN cannot reset it — the recovery code shown next is the only other way in." The e2e setup helper and the motion bench waited for any text containing "recovery code" and now wait for `#rc-code` instead (`8b9b836`).

### UX-013 — Browser `confirm()` dialogs
- **Severity:** Optimization · **Status:** fixed (4cdcc29) · **Found:** `REPORT.md` §6, confirmed 2026-10-04 (5 call sites, not 2)
- **Location:** `renderer.js` (plaintext-backup warning, encrypted restore, remove split), `features3.js` (remove split), `features2.js` (delete dividend event)
- **Fix:** all five use `MaerminUI.confirm` (new, see UX-002); `window.confirm` only as a fallback when `MaerminUI` is missing.

### Fix notes (usability run)
- New pure helpers with tests in `test/ux-audit.test.js` (36 checks, each block shown failing first): `MaerminImportMapping.quickCSV`, `MaerminBackup.summary`, `MaerminUI.confirm`/`answerConfirm`, `MaerminUtils.missingTxFields`, `MaerminUtils.formChanged`, `preview(..., { broker })`.
- UX-001 also books quick-import rows into the active portfolio (like "+ Add Transaction"); found while verifying.
- UX-008 and UX-012 touch `auth.js`: markup, error display and one sentence of text only; no unlock or vault logic changed.
- UX-012 was checked in code only: showing the setup screen would have meant deleting the test vault.
- Every UI fix was re-checked in the running app (Demo mode, keyboard, screen-reader attributes). Gates at the end: check 195 files, test 88 suites, e2e 128/128.
---

## Run 2026-10-04 (5) — focus `security` (summary), `features`, `look`

Branch `audit/bugs-2026-10-04` @ `d367ca0`. Running app: dev `index.html` served locally, built-in browser, Demo mode, test vault.

**Security:** no new finding with a realistic attack path (vault, injection sinks, CSP, Worker routes, sync auth, share allowlist, service-worker caching and SRI checked). Details and four hardening notes are in the git-ignored `docs/AUDIT.security.local.md`.

### Found during the features pass (usability)

### UX-014 — Manual Import tab restores a pasted full backup without asking
- **Severity:** Important · **Status:** fixed (3af438f) · **Found:** 2026-10-04 (code trace)
- **Location:** `renderer.js:2315-2321` (Data Management → Manual Import, `DataManagementView.handleImport`)
- **What happens:** This is the second import path. It still writes every key of a pasted full backup and reloads at once. UX-002 added the confirmation only to the quick Import dialog.
- **Proposed fix:** Reuse the UX-002 confirmation (`MaerminBackup.summary` + `MaerminUI.confirm`) here.

### UX-015 — Manual Import tab rejects every CSV
- **Severity:** Important · **Status:** fixed (dc55ce2) · **Found:** 2026-10-04 (code trace)
- **Location:** `renderer.js:2324-2327`
- **What happens:** The tab says "Paste JSON or CSV data", but CSV goes through `ImportExportEngine.parseCSV`, which returns `{ headers, rows }` (no `.length`), so it always ends in "Import failed: No transactions found in data". It is the same dead end as UX-001 on a second path.
- **Proposed fix:** Use `MaerminImportMapping.quickCSV` (from UX-001), with the same row-error message and active-portfolio default.

### Features (documented vs real)

Checked and matching: every ROADMAP module exists and is loaded by `index.html`; keyboard shortcuts (`g`+key, `n r b i p`, `?`) as documented; Monte Carlo defaults to 10,000 iterations (adjustable); DRIP simulation, earnings calendar, watchlist sparkline and stress scenarios exist; PLAN.md's "tax-pot findings fixed" is now true (BUG-002).

### FEAT-001 — The privacy section understates which third parties the app contacts
- **Severity:** Important · **Status:** fixed (e3fa32d) · **Found:** 2026-10-04
- **Location:** `README.md:195-202` vs `index.html:11-13` (Google Fonts), `index.html:32-33` (React from unpkg), jsPDF/pdf.js from cdnjs on first use, position logos from `s.yimg.com` (`REPORT.md`), skin/coin images from Steam/CoinGecko, optional Alpha Vantage
- **What happens:** README: "API calls go to: CoinGecko, ExchangeRate-API, your own Cloudflare Worker" and "no data is stored except the opt-in zero-knowledge sync blob". In fact every app start loads the Geist fonts from `fonts.googleapis.com`/`fonts.gstatic.com` (the user's IP goes to Google), React comes from unpkg, and published Share snapshots plus their aggregate are stored in the Worker's KV for 90 days.
- **Why it matters:** This is a privacy promise in an app whose selling point is privacy, and German users in particular check for Google Fonts.
- **Proposed fix:** Self-host the two Geist font files (and drop the Google Fonts `link` + CSP entries), then list the remaining hosts (unpkg/cdnjs, image hosts, optional Alpha Vantage) and the opt-in Share storage in the README.

### FEAT-002 — README says the Overview always shows combined totals
- **Severity:** Optimization · **Status:** fixed (8bf1fc3) · **Found:** 2026-10-04
- **Location:** `README.md:47` vs the portfolio chips on the Overview (`renderer.js` "Portfolio selector tabs")
- **What happens:** Choosing a portfolio chip filters the Overview to that portfolio ("Test Depot · 0.00 €"). The README says it always shows combined totals.
- **Proposed fix:** "Overview shows all portfolios combined or one portfolio at a time."

### FEAT-003 — Worker endpoint lists are incomplete
- **Severity:** Optimization · **Status:** fixed (fa24c36) · **Found:** 2026-10-04
- **Location:** `README.md:125-141` (missing `news`, `mcp`), `docs/WORKER.md` (missing `earnings`, `news`); routes in `cf-worker/worker.js` lines 517 and 693
- **Proposed fix:** Add the missing routes with their request/response shape.

### Look

Method: all 27 sidebar views at 375 px (phone) measuring horizontal overflow of `<main>` (its own scroll container) and the elements causing it; all views with Privacy Mode on, scanning visible text for amounts; all views in the light theme computing WCAG contrast of every visible text against its composited background (text on images/gradients skipped).

### LOOK-001 — Overview overflows by 390 px on phones
- **Severity:** Important · **Status:** fixed (a9b7a25) · **Found:** 2026-10-04
- **Location:** `renderer.js:3721` (`gridTemplateColumns: '1fr 1fr'` for the allocation and top-performers cards)
- **What happens:** `1fr` columns cannot shrink below their content, and the allocation card needs about 458 px, so the grid is 725 px wide inside a 327 px column. The Overview scrolls sideways and "Top performers" sits off-screen.
- **Proposed fix:** `repeat(auto-fit, minmax(min(100%, 320px), 1fr))`. Re-check at 375 px and desktop.

### LOOK-002 — Fee Analyzer overflows by 139 px on phones
- **Severity:** Important · **Status:** fixed (407dd73) · **Found:** 2026-10-04
- **Location:** `features5.js:575` (`gridColumn: 'span 2'` on the top-10 card inside an `auto-fit` grid)
- **What happens:** The span forces an implicit second column even where only one fits.
- **Proposed fix:** `gridColumn: '1 / -1'` (full row in any column count).

### LOOK-003 — Privacy Mode leaks dividend amounts (and shows them in $)
- **Severity:** Important · **Status:** fixed (ccafbcb) · **Found:** 2026-10-04
- **Location:** `features2.js:1316` (calendar header "Dec 2026: 2.88 € · Year 2026: 11.52 €") and the calendar day cells ("AAPL +2.88$"); `advisor.js:103-104` (Health: "~$12/yr dividend income", "About $1/mo")
- **What happens:** With "Hide amounts" on, these strings are built with `toFixed`/a local `money()` instead of the masking `formatPrice`, so they stay readable. The advisor also hard-codes `$` although the app currency is EUR (the same income is 11.52 € elsewhere).
- **Proposed fix:** Format through the app's formatter (pass `formatPrice`/privacy state into the calendar and advisor) and use the app currency symbol.

### LOOK-004 — Light theme: hard-coded dark-theme colours fail contrast in 10+ views
- **Severity:** Important · **Status:** fixed (61ffe55) · **Found:** 2026-10-04
- **Location:** `#22c55e` literals (87 uses; most in `investment-views.js`, `features3.js`, `renderer.js`, `features4.js`, `features5.js`), dividend calendar `#7cb0ff`, fee figures `#f59e0b`, the Health grade orange
- **What happens:** In the light theme (`renderer.js:82-103`, which defines `success: '#0f9f68'`, `warning: '#d97706'`) these fixed colours reach only 2.0–2.3:1 for gains on white (Portfolios, Net Worth, Returns, Rebalancing, Savings Plans, Fees, Tax, Attribution), 1.9:1 for calendar entries and 2.2–2.5:1 for orange figures. WCAG AA needs 4.5:1 (3:1 for large text).
- **Proposed fix:** Replace the literals with `theme.success` / `theme.warning` / `theme.accent` (most components already receive `theme`); keep the bright values only in the dark themes.

### LOOK-005 — Overview position quantities nearly invisible in the light theme
- **Severity:** Important · **Status:** fixed (1cef91e) · **Found:** 2026-10-04
- **Location:** `renderer.js:3687` (`color: '#cbd3e1'` on the quantity cell)
- **What happens:** 1.51:1 on white; quantities like "0.25" and "65" are barely readable.
- **Proposed fix:** `color: currentTheme.textSecondary`.
### Fix notes (features + look run)
- FEAT-001: Geist + Geist Mono latin/latin-ext variable WOFF2 from Fontsource 5.3.0 (OFL 1.1, `fonts/OFL.txt`), `@font-face` in `styles.css`; Google links and CSP entries removed from `index.html` and `build.mjs` (which now copies `fonts/` to `dist/`). Checked: only the two latin files load, from `fonts/`; no request to Google; e2e "no unexpected external requests" green. Regression test in `test/ux-audit.test.js`.
- LOOK-001 also needed the allocation card to wrap its legend below the donut (the grid alone left 82 px overflow). Checked: 0 px overflow at 375 px, two equal columns at desktop width.
- LOOK-003: `MaerminAdvisor.analyzeFromMetrics(bundle, t, { formatMoney })`, test in `test/ux-audit.test.js`; calendar masks via a `privacyMode` prop. Checked with Privacy Mode on and off.
- LOOK-004: semantic status colours only (gain/loss, ok/warning, health score) moved to theme tokens in 9 files; categorical/chart palettes unchanged. Light-theme contrast scan after the fix: remaining items below 3:1 are the light theme's own `success`/`warning` tokens on their tinted badges (2.76-2.99:1, e.g. "Buy", "Grade D") and category colours used as text (CS2 Skins, fee category). Both are theme/palette design choices, not literals; left for a theme-palette decision.
- Gates at the end: check 195 files, test 88 suites, e2e 128/128.

---

## Run 2026-10-09 — cleanup and quality audit (Phase 1, no code changes)

Branch `audit/cleanup-2026-10-09` from `main` @ `83a9976` (v11.0.0, after the Phase 3 usability review, #99).
Severity scale for this run: **critical** (wrong money/tax figures in a common case, data loss, exploitable hole) ·
**high** · **medium** · **low**. Every finding has an ID, category, location, what is wrong, evidence, proposed change,
severity and the risk of the change. Screenshots: `docs/screenshots/audit-2026-10/` (demo data; the Worker URL is
masked or not on screen).

### Baseline (before any change)

| Gate | Result |
|---|---|
| `npm install` | ok (npm notes that esbuild's postinstall is not auto-approved; the build works) |
| `npm run check` | ok: 246 JS files; i18n guard: 2448 keys in en and de, 535 hardcoded UI strings and 2 raw `toLocale` calls left (within the baseline) |
| `npm test` | ok: 120 suites, 0 failures |
| `npm run build:web` | ok, with 2 esbuild warnings: duplicate key `rcCopyFailed` in `translations-complete.js` (en and de; DEAD-007) |
| `npm run test:e2e` | 278/278 with `CHROME_PATH` set to the installed Chrome (without it the run stops: Playwright's own Chromium is not installed on this machine) |

### Method

- **Dead code:** declaration, export, CSS-class, icon and translation-key scans over all tracked files, then a manual check of
  global (`window.Maermin*`) and string-based lookups (view ids, nav model, command list, shortcut maps, event-bus names,
  dashboard ids, compute worker, service worker, tests, Worker). Each finding says how it was verified.
- **Click-through:** the local branch served on `localhost`, a fresh vault per run, Demo mode, every sidebar view, every area
  tab and the sub-tabs, the overview chart ranges, menus, dialogs, command palette and keyboard shortcuts. Scripted with
  Playwright on the installed Chrome (full-page screenshots, console, failed requests, horizontal overflow, clipped text,
  NaN/undefined text, active-state count) and reviewed by hand. Runs: desktop 1366×900 in all five themes, phone 390×844
  (dark and light), Privacy Mode on (desktop and phone), German. Without a Worker and with the test Worker.
- **Bugs:** code review of the money paths with a failing Node test per bug where the logic is reachable from Node. The tests
  are on the local branch `audit/failing-tests` (not pushed; `test/audit-*.test.js`, 16 files) and go into the bug-fix PR.
- **Security:** source review plus local experiments only (the real `cf-worker/worker.js` in Node with stubbed upstreams).
  The repository is public: this file states the problem class and the fix in neutral words. Attack paths and proofs are
  in the git-ignored `docs/AUDIT.security.local.md`, as `PLAN.md` asks.

### The test Worker (version 2026.10.3, the same as `cf-worker/worker.js`)

Wizard connection test: Stock & ETF prices, Symbol search, CS2 skin prices and Worker version all **green**.
Seen in use (Demo mode, then five holdings of my own in the local test vault, at a normal pace; about 240 requests in total):

| Endpoint | Result |
|---|---|
| `version`, `yf`, `yfsearch`, `skinprices`, `fundamentals`, `profile`, `fundholdings`, `earnings`, `news`, `screener` (`scrId`) | green |
| `screener` (`symbols=`, Discovery → Dividends) | **red, 401** from Yahoo — BUG-031 (in the repo code, not only the deployed copy) |
| `cg` (CoinGecko) | green once, then **429** twice (CoinGecko limits the Worker's IP); no last good copy existed yet — BUG-035 |
| `sync`, `share` | **red, 501**: the deployed Worker has no KV namespace / Durable Object bound. The app degrades (no crash) but the messages are developer-oriented — UX-017 |
| `steaminv`, `mcp`, `brokerproxy` | not exercised (no Steam profile, no share id, no exchange keys). Exchange sync was reviewed in code and its UI walked up to the key form |

**Created on the test Worker: nothing.** Sync and share were each tried once with Demo data; both answered 501 before
storing anything. Worker-gated features (Discovery, News, earnings, benchmark, factor exposure, ETF X-Ray, sector/country
allocation, company size, TER panel, split scan) all appear with the Worker connected and explain what is missing without it.
Slow or failing Worker responses were not simulated against the live Worker; the e2e suite covers a Worker that is down.

### Counts

| Category | critical | high | medium | low | total |
|---|---|---|---|---|---|
| Dead code and hidden features (DEAD) | 0 | 0 | 1 | 19 | 20 |
| Bugs (BUG) | 0 | 4 | 15 | 9 | 28 |
| Visual and state display (VIS) | 0 | 1 | 6 | 12 | 19 |
| Usability (UX) | 0 | 0 | 7 | 10 | 17 |
| Security, new (SEC-017…028) | 0 | 0 | 2 | 10 | 12 |
| Security, still open from earlier runs (SEC-004…016, H-1…H-4) | 0 | 0 | 0 | 17 | 17 |
| **Total** | **0** | **5** | **31** | **77** | **113** |

Removable code: about 400 lines that are certainly unused, up to about 1,000 more if the owner decides the UNSURE items
(DEAD-012/013/018/019/020) in favour of removal.

### Needs the owner's decision before Phase 2

**Removal candidates where it is unclear whether they are wanted:**
- DEAD-002 PWA "update available" hooks (planned Settings card?)
- DEAD-003 `storage.rekey()` (planned data-key rotation? see SEC-017)
- DEAD-012 DRIP simulation, YoC trend, FIRE variants, retirement plan: wire into the UI or delete
- DEAD-013 test-only API members (tag rename, rule edit, real-asset edit, Intelligence export): wire, keep or delete
- DEAD-016 clickable correlation cells: show the pair or drop the click
- DEAD-018 `REPORT.md`, `docs/PROMPT-OPUS.md`
- DEAD-019 `scripts/i18n-apply.mjs`
- DEAD-020 two Monte Carlo engines, three FIRE computations

**Fixes that touch old vaults, backups or deployed Workers** (each needs a migration or a version gate, described in the
finding): BUG-014 (savings-plan due dates), BUG-023 (restore re-runs migrations), SEC-004 (KDF parameters in old backups),
SEC-007 (bind records to their key name), SEC-017 (key rotation, sync account move), SEC-018 (sync account creation needs
an auth key; older apps), SEC-026 (old share records), SEC-027 (passkey user verification).

### Checklist

| PR | Findings | Status |
|---|---|---|
| 1 Dead code and hidden features | DEAD-002, 004–011, 014–017 (+ approved UNSURE items) | open |
| 2 Bug fixes | BUG-012…039 | open |
| 3 Visual and state display | VIS-001…019 | open |
| 4 Usability | UX-016…032 | open |
| 5 Security, app and Worker | SEC-008…016, 018, 019, 020…026, H-1…H-4 | open |
| 6 crypto-vault.js, auth.js, storage.js | SEC-004…007, 017, 027, 028, DEAD-001, DEAD-003 | open |

---

### 1. Dead code and hidden features

Verification for every item: word-boundary search over all tracked `.js/.mjs/.ts/.html` (dist excluded), plus string and
`window[...]` lookups, the compute worker, service worker, tests and Worker. Nothing below is the only reader of stored
data; all `localStorage` keys, `migrations.js` steps, backup `KEYS`, `SENSITIVE_KEYS`, nav-model `ALIASES` and Worker
endpoints stay.

**Checked and in use** (not removable): `risk-analytics.js` + `risk-analytics-view-v2.js` (engine + view), `analytics-views.js`,
`dev-boot.js` (dev only, excluded by `build.mjs:31`), `compute.worker.js` + harness, `features.js`…`features7.js` (every
exported view is rendered), `motion.js`, `fx.js`, the four stores, `attribution.js` vs `fx-attribution.js` (different jobs),
`data-quality.js` vs `data-check.js` (different jobs), the DCA, correlation, Monte Carlo and stress engines, `idb-store.js`,
`renderer-components.js`, fonts, `data/skin-images.json`, all devDependencies, `types/maermin-globals.d.ts`, the service-worker
cache list, `RELEASE.md` (read by the release workflow), `PLAN.md`, `FINDINGS.md`. No hash/deep-link routing exists.
Gated features confirmed reachable: Worker URL (Discovery, Share, News, earnings, benchmark/factor, X-Ray, TER, dividend
quality), German jurisdiction (tax advisor, fund tax, Anlage KAP, withholding), exchange keys, sync account, passkey,
Advanced mode (14 views), option transactions (Options panel).

#### DEAD-001 — `storage.js` helpers `nativeRead`, `writeManifest` are never called
- **Location:** `storage.js:237-239`, `storage.js:297-299` · **Evidence:** each name occurs once repo-wide (its declaration, inside the IIFE). · **Change:** delete. · **Severity:** low · **Risk:** very low · **PR 6**

#### DEAD-002 — PWA update API and the service worker's `SKIP_WAITING` handler are unreachable (UNSURE)
- **Location:** `pwa.js:26, 43-50, 66-71, 80, 136, 182-185`; `service-worker.js:175-178`; `types/maermin-globals.d.ts`
- **Evidence:** nothing subscribes to `update`/`install`, nothing calls `hasUpdate/applyUpdate/canInstall`; `skipWaiting()` already runs on install.
- **Change:** delete them (keep install toast, notifications, background sync). **Severity:** low · **Risk:** low (service-worker change) · **Unsure:** keep if a "new version" card is planned.

#### DEAD-003 — `storage.rekey()` is never called (UNSURE)
- **Location:** `storage.js:465-475, 579` · **Evidence:** only declaration/export/.d.ts; a password change re-wraps the data key, records stay. · **Change:** delete, or reuse for SEC-017 key rotation. · **Severity:** low · **Risk:** low · **PR 6**

#### DEAD-004 — Exported helpers no code or test calls
- **Location:** `utils.js:29-31` `formatCurrencyEUR`; `exchange-sync.js:283` `isSyncing`, `:364-373` `exportAllCredentials`/`importAllCredentials`; `fx-history.js:276` `resetCurrencyCache`; `rebalancing-planner.js:74-78` `clearTargets`; `prefs-store.js:73-76` `useValue`; `nav-model.js:95` `isAdvanced`; `fx.js:317` `rescan`; unused test seams `storage._setNative`, `equity-metadata._norm`, `tax-report-builder._toBase`, `performance-cards._toISO`
- **Evidence:** export scan (each module required in Node, every export key searched in every other file) + in-file search. · **Change:** delete. · **Severity:** low · **Risk:** very low · ~35 lines

#### DEAD-005 — The `?` shortcuts dialog lists shortcuts that do nothing and omits ones that work
- **Location:** `renderer-components.js:153-180`; keys `workspaces`, `defaultWorkspace`, `taxSeasonWorkspace`, `deepAnalysisWorkspace`, `saveWorkspace`
- **What:** lists Workspaces `w 1/2/3/s`, `a c/m/s/r`, `g p` and `t`; no handler exists (`renderer.js:2420-2449` builds its maps from the command list, which has none of them). Pressing `a r` actually fires `r` (refresh). The working `g i/s/u/c/y/f/d/x` are not listed.
- **Evidence:** keys pressed in the click-through (`docs/screenshots/audit-2026-10/shortcuts-overlay.jpg`); no `workspace` code anywhere.
- **Change:** build the table from the same `commands` list the handler uses; drop the five workspace keys. **Severity:** low · **Risk:** very low

#### DEAD-006 — 29 translation keys are never looked up
- **Location:** `translations-complete.js` (en 12-242 and de twins): `statistics, totalValue, purchasePrice, purchaseDate, bought, configured, totalAssets, insights, balanced, netWorth, expenses, monthlyIncome, monthlyExpenses, sources, expectedReturn, exportData, detectedBroker, importedCount, restoreBackup, shortcut, database, reports, apply, reset, filter, sort, ascending, help, about`
- **Evidence:** they pass `scripts/i18n-check.mjs` only because the same word appears as a variable name. · **Change:** delete (en+de); optionally make the gate look for lookups. **Severity:** low · **Risk:** very low

#### DEAD-007 — `rcCopyFailed` defined twice per language
- **Location:** `translations-complete.js:310/445` (en), `:2666/2717` (de); `auth.js:407` fallback uses the dead wording · **Evidence:** esbuild warning in the baseline. · **Change:** delete 310/2666, align the auth.js fallback. **Severity:** low · **Risk:** none

#### DEAD-008 — Dev console banner advertises six features that do not exist
- **Location:** `dev-boot.js:18-65` · **What:** "Portfolio Optimization, Economic Indicators, Options/Greeks, Tax Withdrawal Planning, Margin Tracker, Sentiment Analysis"; the module check logs only `typeof` of globals that always exist. · **Change:** delete lines 18-65 (keep the splash teardown). **Severity:** low · **Risk:** none (dev only)

#### DEAD-009 — `loader-status.js` and the `updateStatus` stub
- **Location:** `loader-status.js`, `index.html:58` script tag, `build.mjs:42-45`, `dev-boot.js:9`, `#module-status` (`index.html:51`, `styles.css:657-665`)
- **What:** only sets "Ready!" on a splash that is already being removed; in prod a no-op. · **Change:** remove the file, script tag, stub and call; keep `index.html`/`build.mjs` order consistent. **Severity:** low · **Risk:** very low

#### DEAD-010 — Unused CSS
- **Location:** `styles.css:523-526` (`.mx-chev`, `.mx-hub-children`, `@keyframes hubIn`), `:655` (`@keyframes pulse`) · **Evidence:** class-token scan incl. concatenated class names. · **Change:** delete. **Severity:** low · **Risk:** very low

#### DEAD-011 — Icons no caller can request
- **Location:** `icons.js`: `hub-tools`, `command`, `lock`, `more`, `attribution`; aliases `correlation, montecarlo, stress, risk, fire`, self-aliases `settings`, `more` · **Change:** delete. **Severity:** low · **Risk:** very low (unknown names fall back to `sparkle`)

#### DEAD-012 — Hidden features: tested engine code with no entry point (UNSURE)
- **Location:** `dividend-yoc.js:76-140` (`yocSeries`, `dripSimulate`); `fire-extras.js:51-98` (`yearsToFireCompound`, `fireVariants`, `baristaFire`); `portfolio-analytics.js` `retirementPlan`, `correlationMatrix`, `sharpe`
- **What:** no nav entry, command, shortcut, setting or gate leads to them; the Dividends panel is titled "Yield on cost & DRIP" but shows no DRIP figure. · **Change:** owner decision — wire them, or delete with their tests and fix the panel title. **Severity:** low · **Risk:** low · ~120 lines + tests

#### DEAD-013 — API members used only by tests (UNSURE per item)
- **Location:** e.g. `tags.renameTag`, `rules-engine.updateRule`, `real-assets.updateAsset`, `portfolio-intelligence.toExport`, `rebalancing-planner.removeTarget/groupBy/isNoSell`, `recurring.scheduleBetween`, `ui-store` overlay helpers, `utils.fromEUR`, the seven `window.calculate*` aliases in `risk-analytics.js:382-392` (full list in the local notes of this run)
- **Change:** per item: keep as tested API, add the missing UI, or delete. **Severity:** low · **Risk:** low · ~150 lines

#### DEAD-014 — Unused `activeTab` state in `renderer.js:391` · **Change:** delete. **Severity:** low · **Risk:** none

#### DEAD-015 — 14 unused locals and constants
- **Location:** `renderer-components.js:26-28`, `renderer.js:56, 3495` (orphans key `ovPortfolioValue`), `ai-prompt.js:35`, `features2.js:942`, `features3.js:237-243`, `features4.js:820`, `features6.js:636`, `import-export-engine.js:386-395`, `performance-map.js:210`, `portfolio-intelligence.js:750` · **Change:** delete. **Severity:** low · **Risk:** none

#### DEAD-016 — Correlation cells store a clicked pair that is never shown (UNSURE)
- **Location:** `renderer-components.js:240, 404-409` · **Change:** show it or drop the click and pointer cursor. **Severity:** low · **Risk:** none

#### DEAD-017 — "Loaded" console logs in the production bundle
- **Location:** `dca-analyzer-engine.js:128`, `dividend-data-service.js:758`, `features3.js:891`, `features4.js:888`, `features5.js:645`, `features6.js:863`, `features7.js:357`, `investment-views.js:1224`, `risk-analytics.js:395`, per-chart log `features6.js:449` · **Change:** delete or route through the existing debug logger. **Severity:** low · **Risk:** none

#### DEAD-018 — Stale working documents (UNSURE): `REPORT.md`, `docs/PROMPT-OPUS.md` · **Change:** archive or delete. **Severity:** low

#### DEAD-019 — `scripts/i18n-apply.mjs`, a one-off migration tool (UNSURE) · keep while hardcoded strings are still being moved. **Severity:** low

#### DEAD-020 — Two Monte Carlo engines on one tab, three FIRE computations (UNSURE)
- **Location:** `monte-carlo-engine.js` and `portfolio-analytics.js:302`, both in Analysis → Monte Carlo; FIRE in `metrics.js`, `portfolio-analytics.js`, `fire-extras.js`
- **Change:** owner decision: one engine per figure. **Severity:** medium (~300 lines, two different results on one screen) · **Risk:** medium (numbers change)

---

### 2. Bugs

Tests: local branch `audit/failing-tests` (`b253f99`, `e9a9e75`). All 120 existing suites still pass with them; each audit
test fails for the stated reason. Where no Node test is possible, the finding says why and names the e2e check to add.

| ID | Sev | Location | What is wrong | Evidence / test | Proposed change | Risk of change |
|---|---|---|---|---|---|---|
| BUG-012 | high | `import-mapping.js:132-140` (`parseNumber`), `features2.js:607` | German CSV "0,125" is read as 125; "1.234.567" as 1.234 | `audit-import-number-parse` (5 fail): preview books quantity 125 | treat `0,ddd` as decimal, multi-group separators as thousands; infer the file locale and pass it | new imports only |
| BUG-013 | high | `import-mapping.js:292-344`, hints `:77-78` | Binance "Pair" `BTCUSDT` stored as symbol with currency EUR; Kraken `XXBTZEUR` kept | `audit-import-crypto-pairs` (3/4 fail) | split pairs with `exchange-sync.parsePair`, quote → currency, base → CoinGecko id | rows already stored stay wrong; add a data-check hint |
| BUG-014 | medium | `recurring.js:46-61, 76-83` | schedules starting on the 29th–31st drift to the 28th for good (savings plans book on the 28th) | `audit-recurring-month-end` 1-4 | compute occurrence i from the start date | **high**: stored `dueDate` markers would look missing → duplicate buys; needs period-based idempotency or a marker migration (stop point) |
| BUG-015 | low | `recurring.js:122-131` | payment due on the as-of date counted in "paid" and "remaining" | `audit-recurring-month-end` 5 | start "remaining" the day after | none |
| BUG-016 | low | `tax-calculation-engine.js:40` | Basiszins 2021 +0.045 % instead of −0.45 % (verify against the BMF letter) | `audit-basiszins-2021` | correct the table | saved 2021 records stay as entered |
| BUG-017 | medium | `tax-calculation-engine.js:156-157`, `tax-report-builder.js:355-363` | Sparerpauschbetrag 1,000 € applied to years before 2023 (801 €) | `audit-sparerpauschbetrag-year` (3/4) | statutory allowance per year, doubled for joint assessment | none |
| BUG-018 | medium | `interest-engine.js:120-135` | interest catch-up splits only at the first 31 Dec; the night of 31 Dec goes to the next year | `audit-interest-multiyear` (3/4) | loop over every year boundary | only future postings change |
| BUG-019 | medium | `savings-plan-executor.js:217-236` | a price of any age is taken as the exact fill | `audit-savings-plan-price` 1 | accept a point within ~7 days, else estimated | none |
| BUG-020 | low | `savings-plan-executor.js:97-117` (same pattern in dividend-executor, exchange-sync `:255-271`, interest-engine `:295`) | post-sync dedupe deletes every copy when two rows share one id | `audit-savings-plan-price` 3 | remove by index/identity | none |
| BUG-021 | low | `returns-engine.js:41-70` | XIRR returns 10 % p.a. when all flows are on one day | `audit-xirr-degenerate` | null for a zero time span | none |
| BUG-022 | medium | `tax-report-builder.js:79-99`, `ledger.js:154-170` | options in the tax report ignore the contract size and lose short positions | `audit-options-tax` (2/3) | keep options out of the share FIFO; use `options-engine` | none |
| BUG-023 | medium | `backup-engine.js:117-131`, `migrations.js:209` | restoring an old backup skips the schema migrations | `audit-restore-migrations` | reset `maermin_schema_version` to 0 on restore (migrations are idempotent) | migrations re-run; old backups must still load (stop point to confirm) |
| BUG-024 | medium | `performance-cards.js` `computePeriod` | deposits counted as performance (1M +10 % on a flat market after a buy) | `audit-performance-cards-deposits` | chain-link with flows, or call it "value change" | none |
| BUG-025 | medium | `renderer.js:1225-1260` | daily value snapshots use unsorted transactions, clamp sells, ignore splits | traced (inside the React component; no Node entry point) — e2e: a split holding keeps its snapshot value | use `MaerminMetrics.buildPositions` | recorded history stays |
| BUG-026 | low | `portfolio-snapshots.js:33-38`, `performance-cards` `todayISO` | snapshot day is the UTC day | `audit-snapshot-local-day` | local day | none |
| BUG-027 | low | `import-mapping.js:149-155` | CSV keeps the UTC day of exchange timestamps | `audit-import-utc-date` (3/4) | convert Z/offset values to the local day | night rows of old imports may no longer be flagged as duplicates |
| BUG-028 | low | `utils.js:83-87`, `options-engine.js:42-48`, `features7.js:49-52` | `toEUR` treats every non-USD currency (GBP, GBp, CHF…) as EUR | `audit-utils-toeur-currencies` (4/5) | delegate to `MaerminFxHistory` | none |
| BUG-029 | medium | `portfolio-intelligence.js:129-133` (`asPct`), `:590` (skin price lookup) | Intelligence prints a sub-1 % class weight as a fraction: "CS2 Skins 12.6 %" for 0.13 %; skins priced at cost | `audit-clickthrough-figures` (BUG-029, 2 fail); screenshot `intelligence-liquidity.jpg` | pass percent explicitly (no ≤1 guessing); look up skin prices by item name | none |
| BUG-030 | medium | `share-snapshot.js:188` | Share & Compare and the AI summary compute the health score without price history and transactions: 45/100 vs 52/100 in the Health view | `audit-clickthrough-figures` (BUG-030); `share-health-45.jpg`, `overview-health-52.jpg` | pass `{ priceHistory, transactions }` as `renderer.js:3286` does | shared snapshots change score (correct value) |
| BUG-031 | medium | `cf-worker/worker.js:383-396` | batch quote (`screener&symbols=`) calls Yahoo v7 without the cookie+crumb retry → 401; Discovery → Dividends shows "Could not load" | `audit-worker-screener-crumb` (2 fail); live: 401 from the test Worker; `worker-discovery-dividends-401.jpg` | reuse the quoteSummary crumb session (`worker.js:1051-1090`) | **needs Worker redeploy**; older apps unaffected |
| BUG-032 | high | `features4.js:563-576` (`DividendForecastView`) | one recorded dividend is annualised over a clamped 0.08 years (×12.5) and its USD amount is taken as EUR: demo AAPL 11.40 USD → "142.50 €/yr" (Overview and quality panel: 11.52 €) | `dividend-forecast-142.jpg`; not unit-testable (logic inside a component's `useMemo`) — the fix extracts a pure `forecastFromPayments` and tests it | extract and test; convert to EUR at the payment date; with fewer than two payments use the resolved rate or "once" | none |
| BUG-033 | medium | `features5.js:494-529` (`FeeAnalyzer`) | fees and trade values summed in their own currency and shown as EUR (USD trades listed as "1,980.00 €"); total fees 18.50 € vs 18.18 € in Returns | `fees-usd-as-eur.jpg`; not unit-testable (component) — extract `feeStats(transactions, fx)` | convert each row with the trade-date rate (`MaerminFxHistory`) | none |
| BUG-034 | high | `features5.js:372-418` (`CashflowView`) | value line built only from refresh-point `priceHistory`; with daily closes but few refreshes (demo, a fresh import) it shows value 0.00 € and "−23,071.00 (−100.0 %)" | `cashflow-value-zero.jpg`; component — e2e: Cash Flow last value equals the Overview total | use `MaerminValuePath` (as the Overview chart does) | none |
| BUG-035 | medium | `renderer.js:1541`, `coingecko.js:48-73` | a CoinGecko 429 leaves crypto without a price ("no price · at cost") though Yahoo USD pairs are already used for crypto history (`close-history.js`) | observed with the test Worker (2× 429); `worker-overview-live-badges.jpg` ("1 missing") | fall back to the Yahoo `XXX-USD` quote | none |
| BUG-036 | medium | `features6.js:170`, `renderer.js:1565-1610` | a symbol with no listing (e.g. saved as typed, "Apple") makes the chart probe 8 exchange suffixes on every range and re-request profile/fundamentals/earnings: ~70 Worker requests for one holding, against a 120/min per-IP limit | test-Worker log: 65× `yf` 404, 13× `fundamentals` 502, 11× `profile` 502 for two typed symbols | remember a failed symbol client-side (the price path already does, `maermin_symbol_suffix`); probe suffixes once, not per range | none |
| BUG-037 | medium | `features2.js` (Dividend Calendar header and auto-derived schedule) | "Oct 2026: €0.00 · Year 2026: €0.00" for an AAPL holding held since 2024 with resolved dividends, although the calendar is documented to show received payouts | `worker-dividends-income.jpg`; root cause not traced yet | trace `buildPaymentSchedule(... back)` input; e2e check | none |
| BUG-038 | low | `dividend-yoc.js` vs `dividend-quality.js` | two annual incomes for one payer in one view: 10.60 € vs 11.52 € (demo), 4.82 € vs 5.40 € (live) | `dividends-light-yoc-earnings.jpg` | one income source (rate × shares, one FX rate) | none |
| BUG-039 | low | `pwa.js:44` | `TypeError: Cannot read properties of undefined (reading 'waiting')` when service-worker registration fails | console in every run (registration blocked by the test browser) | guard the registration result | none |

---

### 3. Visual and state display

| ID | Sev | Location | What is wrong | Evidence | Proposed change | Risk |
|---|---|---|---|---|---|---|
| VIS-001 | medium | `renderer.js:3602`, `features6.js:680` | Overview chart: the range highlights 1H…Max but the gain figure always says "+20,482.22 € +85.18 % all time" | `chart-1h-all-time.jpg` | show the change over the selected range (keep all-time in the stat card) | low |
| VIS-002 | low | `features6.js` (history chart axis) | 1H/1D on daily data: all axis labels "02:00 AM", the last overlaps; daily closes drawn as intraday | `chart-1h-all-time.jpg` | disable or explain intraday ranges without intraday data; de-duplicate labels | low |
| VIS-003 | high | `renderer.js:~4400-4460` (Transactions table) | Privacy Mode leaves unit prices and totals readable in Transactions (desktop and phone) | `privacy-transactions.jpg`; scan of every view with Privacy Mode on | format through the masking formatter | low |
| VIS-004 | medium | tax advisor panel (`renderer.js` German tax view, `tax-advisor.js` texts) | Privacy Mode shows "€203 left", "€343 of your €1,000 … is used" | `privacy-tax-advisor.jpg` | mask the user-derived amounts (statutory limits may stay) | low |
| VIS-005 | medium | `risk-analytics-view-v2.js:183`, `fx-attribution.js:282`, `analytics-views.js:104/152`, correlation and DCA views | "Refresh prices a few times… (0 of 5 so far)" next to a panel computed from 653–755 daily returns | `risk-level-contradiction.jpg` | feed these panels from the daily close history (value path) like the rolling panel | low |
| VIS-006 | medium | Overview, Returns, Cash Flow, Tax views | the same label means different numbers: "Invested" 24,045.78 € (open cost basis) / 26,450.87 € (all buys) / 23,071.00 € (net); "Total return" +20,482 € (unrealised) / +21,620 € (incl. realised + dividends); "Realized" 3,543 € (proceeds) vs realised P&L 1,129.54 €; "Total P&L" 21,611.76 €; "Dividends (12M)" is a forward estimate | `overview-health-52.jpg`, `returns-invested.jpg`, `realized-unrealized.jpg`, `cashflow-value-zero.jpg` | name each figure for what it is (e.g. "Cost basis (open)", "Unrealised gain", "Sale proceeds", "Expected dividends, next 12 months") and use one definition per name | low (labels only) |
| VIS-007 | low | `features7.js` (Attribution) | "Top detractor: AK-47 +0.11 pp" — a positive contributor labelled detractor | `attribution-detractor.jpg` | hide the card when nothing is negative | none |
| VIS-008 | medium | `portfolio-intelligence.js` (category label), `stress-test-engine.js` scenario keys | raw ids shown as labels and untranslated in German: "SINGLECOMPANY", "INCOMECONCENTRATION", "ASSETCLASS"; "bonds", "gold", "tech_stocks", "stablecoins", "gaming_stocks"; "CS:GO" next to "CS2" | `intelligence-raw-ids-de.jpg`, `stress-raw-labels-de.jpg` | translation keys for every category and asset key | none |
| VIS-009 | low | `performance-cards.js`, `performance-map.js` | Performance view in demo: cards area empty without explanation; treemap colour saturates (26 % and 142 % the same green) | `performance-empty-cards.jpg` | empty-state text; scale colours to the range shown | none |
| VIS-010 | low | Dividends view (Earnings Calendar card) | the card sits outside the content column (wider, shifted left) | `dividends-light-yoc-earnings.jpg` | same container padding as the other cards | none |
| VIS-011 | low | Trash view | card flush against the sidebar and the right edge (no page padding) | `trash-padding.jpg` | standard view padding | none |
| VIS-012 | medium | Transactions table, Overview positions table | on a phone the tables are cut off: quantity, price, total and edit/delete only by horizontal scrolling; dates and "€" wrap | `phone-transactions.jpg`, `phone-overview.jpg` | card layout below ~600 px | low |
| VIS-013 | low | `features2.js` broker tiles | the Binance and Kraken monograms overflow their tiles | `broker-tiles.jpg` | fit the monogram | none |
| VIS-014 | low | dividend calendar header, tax advisor | currency formats mixed in one language: "€0.00", "€1,000 left" vs "0.00 €" elsewhere | `dividend-forecast-142.jpg`, `tax-report-vwce-type.jpg` | one formatter (`MaerminI18n`) | none |
| VIS-015 | low | Transactions table | the Total column has no currency while USD and EUR rows mix; quantity column uses monospace for decimals only | `privacy-transactions.jpg` | show currency per total; one font | none |
| VIS-016 | low | header "Live" badge (`title="App is live"`) and Overview status chip | two "Live" indicators; the header one is green also with no Worker and in demo | `worker-overview-live-badges.jpg` | drop the header badge or make it reflect data status | none |
| VIS-017 | low | Overview value card source chips | demo (sample prices) shows "CoinGecko"; with a Worker "Yahoo Finance" appears twice | `overview-health-52.jpg`, `worker-overview-live-badges.jpg` | "Sample data" in demo; de-duplicate | none |
| VIS-018 | low | Rebalancing plan summary | "… 522.80 € stays uninvested (every class is within its band)" while the plan sells 13.6k € of crypto | `rebalancing-plan-text.jpg` | say why money stays uninvested (classes already in band after the trades) | none |
| VIS-019 | low | Discovery table | long names cut without ellipsis ("American Tower Corporation (REI") | test-Worker run | `text-overflow: ellipsis` + title | none |

---

### 4. Usability

| ID | Sev | Location | What is wrong | Evidence | Proposed change | Risk |
|---|---|---|---|---|---|---|
| UX-016 | medium | `onboarding.js` (`endpoints()`) | the connection test checks 4 routes; sync/share storage, CoinGecko, fundamentals and earnings are not tested, so a Worker without storage shows "all green" and fails later | test Worker: wizard green, sync/share 501 | add a storage probe (read-only `share op:aggregate` or `sync op:get` of a random id) and a CoinGecko probe; mark optional features amber | low |
| UX-017 | medium | sync status (`renderer.js` Security & sync), `share-snapshot.js` | errors say "sync-http-501: sync storage not configured (bind KV namespace SYNC or Durable Object SYNC_DO)" / "see docs/WORKER.md" — no next step for a user | `worker-sync-501.jpg`, `worker-share-501.jpg` | plain text + link: "Your Worker has no storage. Redeploy with the Deploy button, or add a KV namespace named SYNC (steps)" | none |
| UX-018 | low | API Settings dialog | stale copy: "one Worker URL — three features", crypto "always free" (now through the Worker), "paste … from ZIP" | `api-settings-text.jpg` | rewrite from the current endpoint list | none |
| UX-019 | medium | `renderer.js:602` | "Book received dividends" writes estimated dividend rows into the user's transactions with no preview, confirmation or Undo | click-through: "4 dividend(s) booked (estimated)" | preview list with confirm, Undo toast via the trash | low |
| UX-020 | low | `dashboard-layout.js:287` | "Reset to default" resets the Overview layout without confirmation or feedback | click-through | confirmation or Undo toast | none |
| UX-021 | low | Savings Plans view | with no plans the view shows only a wealth projection — no "no savings plans yet, add one" state | `savings-plans-no-empty-state.jpg` | empty state with the Add button | none |
| UX-022 | medium | Add transaction, symbol field (`features3.js` SymbolPicker) | a typed name without a picked suggestion is saved as is ("Apple"); it never gets a price and triggers BUG-036 | test-Worker run | require a pick for stocks/crypto, or confirm "save without a listing" | low |
| UX-023 | medium | Watchlist (4), Alerts & Rules (10), Transactions search/sort, Strategy amount/frequency, Fee TER override, Discovery filter, Categories, Tags, Share, Net Worth custom years | form fields without a programmatic label (WCAG 1.3.1 / 4.1.2) | automated pass over every view | `aria-label` or `<label>` | none |
| UX-024 | medium | Portfolios colour swatches (8), Data-check action button | buttons without an accessible name; swatches 22×22 px | automated pass | name + selected state; 24 px minimum | none |
| UX-025 | low | Rebalancing toggles (18 px), Dividends Auto-book checkbox (13 px) | targets below 24×24 px (WCAG 2.5.8) | automated pass | larger hit area | none |
| UX-026 | low | Overview value chart and donut, Net Worth, Savings, Cash Flow charts | charts without a text alternative | automated pass | `role="img"` + summary label | none |
| UX-027 | low | all views | no `h1` per view (headings start at `h2`) | automated pass | view title as `h1` | none |
| UX-028 | low | `features3.js:90` | split scan runs without a start date and offers splits from before the first purchase (AAPL 2020 for a 2024 buy) | `worker-split-scan.jpg` | pass the first-buy date | none |
| UX-029 | low | Categories view | developer note shown to users ("rebalancing-by-class, currency-by-class") | click-through | plain wording or remove | none |
| UX-030 | low | News Feed | without a Worker "Refresh" does nothing silently; texts say "Settings" where others say "API Settings" | click-through | disable Refresh with the hint; one name | none |
| UX-031 | medium | German fund taxation (`german-tax-view.js`) | known equity ETFs (demo VWCE.DE) default to "Not a fund / other (0 %)", so the 30 % Teilfreistellung is missing until the user classifies them; nothing prompts to | `tax-report-vwce-type.jpg` | prefill from fund data (`fundholdings` type) and flag unclassified funds in the data check | changes tax estimates (correct direction) |
| UX-032 | low | header | the gear and the avatar open the same menu | click-through | one entry point, or split settings/account | none |

---

### 5. Security (neutral summary; details in the local file)

No critical or high issue. No exploitable XSS found (no `dangerouslySetInnerHTML`, `eval`, data-fed `innerHTML`; RSS links
pass `safeUrl`), no prototype pollution, CSV/Excel export is formula-safe, `npm audit` reports 0 vulnerabilities, every CDN
script is version-pinned with SRI, no secret reaches logs, URLs or the plaintext backup.

| ID | Sev | Area | Location | Problem (neutral) | Proposed change | Risk of change / redeploy | PR |
|---|---|---|---|---|---|---|---|
| SEC-004 | low | vault | `crypto-vault.js:230-233, 507`, `storage.js:545` | KDF parameters read from stored or imported metadata are not validated | allowlist KDF names, require ≥ 600k iterations with a cap, re-key after a weaker unlock | old backups with valid params unaffected; must not reject vaults made by older releases (check their params) | 6 |
| SEC-005 | low | vault | `auth.js:344, 387`, `renderer.js:199` | password minimum is 8 characters | strength meter / longer minimum for new passwords | existing passwords keep working | 6 |
| SEC-006 | low | vault | `auth.js:238, 351` | encryption at rest can be switched off at setup without a lasting warning | persistent warning while off | none | 6 |
| SEC-007 | low | vault | `crypto-vault.js:146-162` | encrypted records are not bound to their key name | add associated data per record | **migration of every record**; old backups must still open (stop point) | 6 |
| SEC-008 | low | worker | `worker.js:115-117` | a malformed share request body causes an unhandled error | input check + top-level error handler | redeploy | 5 |
| SEC-009 | low | worker | `worker.js:1303-1317`, `wrangler.toml:30` | origin allowlist is broader than needed | narrow the defaults | redeploy; check the desktop/file origin need | 5 |
| SEC-010 | low | worker | `worker.js:794-831` | broker relay path/URL normalisation and forwarded headers are looser than the allowlist intends | exact path match, rebuild the URL, forward only listed headers | redeploy; exchange sync must still work | 5 |
| SEC-011 | low | worker | `worker.js:80, 115, 787` | request bodies are parsed before their size is checked | reject by Content-Length first | redeploy | 5 |
| SEC-012 | low | worker | `worker.js:354…802`, `:308, 396` | upstream error text and status codes reach clients | generic message, `upstreamStatus` field | redeploy; app reads statuses — keep 404/429 semantics where the app relies on them | 5 |
| SEC-013 | low | worker | `worker.js:1354-1384` | missing `nosniff`; RSS served with a JSON content type | headers + content type per route | redeploy | 5 |
| SEC-014 | low | worker | `worker.js:683-689` | the skin price copy accepts any successful response | validate before storing; single-flight refresh | redeploy | 5 |
| SEC-015 | low | worker | `worker.js:1186` | rate-limit key falls back to a client-supplied header; per-IP list unbounded | use the platform IP only; cap the list | redeploy | 5 |
| SEC-016 | low | worker | `worker.js:971` | share snapshot labels are free text; row sums unchecked | allowlist labels, check sums | redeploy | 5 |
| SEC-017 | medium | vault | `crypto-vault.js:260-294, 349-381, 464-498`, `sync-engine.js:69-93`, `README.md:238` | a credential cannot be fully revoked: the data key never changes; no passkey removal; README claims a password change invalidates the recovery code | "rotate encryption key" (re-encrypt, re-wrap, move sync), passkey removal, README fix | **medium; rewrites the store; other sync devices must re-join** (stop point) | 6 |
| SEC-018 | medium | worker | `worker.js:73-99, 878-917` | sync account creation has no quota and does not require an auth key | per-client and daily creation limits; require an auth key for new accounts behind the version handshake | redeploy; **older apps** cannot create accounts if the key becomes mandatory (stop point) | 5 |
| SEC-019 | low | sync | `sync-engine.js:298-350` | a sync download may write any key, not only synced data keys | allowlist sensitive, non-local-only keys on apply | none | 5 |
| SEC-020 | low | csp | `index.html:7`, `build.mjs:115-124` | the CSP is tight for scripts but broad for images, connections, styles and forms | explicit per-directive policy; move injected `<style>` into `styles.css` | medium functional risk (missing image hosts, custom Worker domains) | 5 |
| SEC-021 | low | deps | `pdf-import.js:44-47`, `tax-report-builder.js:473-477` | pdf.js 3.11.174 and jsPDF 2.5.1 are outdated (known issues mitigated or unreachable today) | upgrade; run pdf.js in a worker | re-run PDF import/export tests | 5 |
| SEC-022 | low | import | `pdf-import.js:185-218` | some PDF parsing patterns are super-linear on crafted text (tab freeze) | cap text and line length; bounded patterns | low | 5 |
| SEC-023 | low | import | `features4.js:563-566`, `steam-import.js:71-75`, `import-mapping.js` | special object property names as symbols or headers crash a view or import (no pollution) | `Map`/`Object.create(null)`, reject reserved names | very low | 5 |
| SEC-024 | low | worker | `worker.js:196-210, 372-383, 649-662, 1172-1176` | some query parameters are unbounded or unvalidated; an upstream count field is not capped | caps and allowlists; `news` in the symbol check | redeploy; keep the app's dividend list under the cap | 5 |
| SEC-025 | low | secrets | `exchange-sync.js:426-457`, `docs/WORKER.md:270` | for one exchange the API key itself travels through the Worker, while the docs say the secret never leaves the browser | correct the UI and docs per exchange; drop the unused field | low | 5 |
| SEC-026 | low | worker | `worker.js:151-156` | share `get` does not re-validate stored records (`mcp` does) | validate on read | redeploy; links to pre-allowlist records stop working (stop point) | 5 |
| SEC-027 | low | vault | `crypto-vault.js:363, 395` | passkey unlock does not require user verification | `required` for new enrolments; HKDF on the PRF output | existing passkeys must keep working (store the mode per enrolment) | 6 |
| SEC-028 | low | vault | `crypto-vault.js:296-302`, `storage.js:458-463` | after the idle lock decrypted data and key bytes stay in memory until garbage collection | zero the key, reload after the final save, clear module caches | low (reload must wait for the flush) | 6 |
| H-1…H-4 | low | worker / audit log / hosting | see local file | hardening notes from 2026-10-04, still open | as described there | — | 5 |

Worker items need a redeploy of the test Worker to take effect: SEC-008…016, SEC-018, SEC-024, SEC-026, BUG-031.
