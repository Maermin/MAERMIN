# MAERMIN audit findings — 2026-10-05 (branch `cleanup/audit`)

Bugs and usability problems found in the audit. They are reported only and not fixed.
Line numbers refer to this branch. Each finding was checked against the code, and the
money findings also with a Node reproduction on the real modules.

**Security findings are not listed here.** The repository is public, so open security
issues stay in the git-ignored `docs/AUDIT.security.local.md` until they are fixed and
released. This run added 16 there: 0 Critical, 0 High, 2 Medium, 14 Low.

Already reported and fixed items (docs/AUDIT.md BUG-001..011, UX-001..015, FEAT-001..003,
LOOK-001..005) are not repeated.

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 8 |
| Medium | 16 |
| Low | 8 |

Severity: **Critical** = wrong money or tax figures in a realistic case, or data loss ·
**High** = a core feature is broken or misleading · **Medium** = real friction, or wrong
in an edge case · **Low** = polish.

---

## Critical

### C-1 Clicking "Sync now" twice on an exchange connection imports every trade twice
- **Where:**
  - `exchange-sync.js:475`: the button has no busy or disabled state.
  - `exchange-sync.js:457-459`: `syncConn` dedupes only against `props.existing`, a snapshot taken when the sync started.
  - `renderer.js:2359`: `onImport` merges without a check: `setTransactions(prev => [...prev, ...txs])`.
- **Trigger:** Settings → Broker → "Sync now", then click again before it finishes. Binance asks one pair at a time, so this takes seconds.
- **Effect:** both runs append the same trades. Quantities, cost basis and the tax report double.
- **Evidence:** traced. Neither the Panel nor the merge has an in-flight flag or dedupes on `externalId`.
- **Fix:**
  - Add an in-flight flag per connection and disable the button while it runs.
  - Dedupe on `exchange|externalId` against `prev` inside the `setTransactions` updater.

### C-2 Dividend auto-booking adds a second row for dividends the user already entered or imported
- **Where:** `dividend-executor.js:36-42` (`bookedSet` only counts rows with `source:'dividend-auto'`), `:72-82`.
- **Trigger:** enter (or CSV-import) an AAPL dividend for its pay date, with auto-booking on, then open the app.
- **Effect:** a second dividend row appears. The tax report adds both (`tax-report-builder.js:180-188`; its own dedupe covers only `maermin_divevents`).
- **Evidence:** Node repro with a buy, a manual dividend on 2026-08-14 and a matching schedule. After `runCatchUp`: 2 dividend rows for that day.
- **Fix:** treat any `type:'dividend'` row with the same symbol and portfolio within ±3 days of the pay date as already booked.

### C-3 After a cloud sync between two devices, interest accruals, auto-dividends and exchange imports are duplicated
- **Where:**
  - Catch-up writers: `interest-engine.js:153-180`, `dividend-executor.js:131-145`, `exchange-sync.js:189-200`.
  - `sync-engine.js:247-277`: merges transactions by id (a union).
  - Only savings plans have a post-merge dedupe (`savings-plan-executor.js` `dedupeExecutions`).
- **Trigger:** use the app on two devices with sync on. Each device runs its catch-up at start (`renderer.js:466-489`) before any pull, and books the same period under its own random ids.
- **Effect:** interest is the worst case, because its marker contains the day the app was opened, so even the markers differ.
- **Evidence:** Node repro: 50,000 € at 3 %, accrued on device A to 03-01 and on device B to 03-03, then merged. Booked interest is **494.35 €** instead of **251.30 €**. The same repro gives two rows for one auto-dividend.
- **Fix:** add a post-merge dedupe like `dedupeExecutions`:
  - Keep the smallest id per auto-dividend marker and per `exchange|externalId`.
  - For interest, drop accruals whose date range overlaps one already kept, then re-derive `lastAccrualDate`.

### C-4 Deleting a portfolio leaves its transactions orphaned, although the dialog says they move
- **Where:**
  - `features4.js:139`: `confirm('… Transactions will move to Main Portfolio.')`.
  - `features4.js:69-73`: `removePortfolio` only filters the portfolio list.
  - `renderer.js:363`: views filter on `(tx.portfolioId || 'default') === activePortfolioId`.
- **Trigger:** Portfolio Manager → × on a portfolio that has trades → OK.
- **Effect:**
  - The trades keep the deleted id. They show in no portfolio, so they can't be edited or deleted from the UI.
  - "All portfolios" totals still count them (`renderer.js:3214`), so the portfolio cards no longer add up.
- **Evidence:** traced. Nothing rewrites `portfolioId`.
- **Fix:**
  - Move the transactions to `default` in `removePortfolio`, or offer to delete them.
  - Use `MaerminUI.confirm`; this is the last native `confirm()`.

---

## High

### H-1 Kraken BTC/ETH trades are imported under the symbols `XXBTZ` / `XETHZ`
- **Where:** `exchange-sync.js:73-83` (`normalizeBase`/`parsePair`): only `XBT` maps to BTC.
- **Trigger:** sync a Kraken account. TradesHistory names legacy pairs `XXBTZEUR`, `XETHZUSD` (Kraken's documented format; not tested against the live API).
- **Effect:**
  - The position gets no price.
  - BTC bought on Kraken and sold elsewhere looks oversold, so the §23 gain drops out and a ghost holding remains.
- **Evidence:** Node repro: `mapTrades('kraken', …pair:'XXBTZEUR'…)` gives symbol `XXBTZ`. The test fixture uses `XBTEUR`, which Kraken does not send.
- **Fix:**
  - Strip the 4-character X/Z prefixes and the `Z` before the quote.
  - Map XXBT/XBT→BTC, XETH→ETH, XXDG/XDG→DOGE.
  - Add an `XXBTZEUR` fixture.

### H-2 The USD→EUR rate history is one day off from late March to October
- **Where:** `fx-history.js:68-78` (`ingestYahooSeries`) uses the Worker's UTC `date`.
- **Why it's wrong:** `EURUSD=X` daily bars are stamped 00:00 London, which is 23:00 UTC the day before during British Summer Time. The cross-rate path fixes exactly this with `barDate` (`:276-289`); the USD series never got that fix.
- **Effect:** Monday to Thursday in summer, every USD trade, dividend and fee is converted at the next trading day's rate. This affects the cost basis and the tax report.
- **Evidence:** Node repro. Bars for 07-07/08/09 are stored under 07-06/07/08, so Tue 2025-07-08 gets 0.7692 instead of 0.8333.
- **Fix:** use `barDate(p, json.exchangeTz)` in `ingestYahooSeries`, then re-fetch once with `range=max` (new values win in `merge`).

### H-3 A recovery-code unlock can never lead to a new password
- **Where:**
  - `crypto-vault.js:250-254`: `changePassword` first calls `unlock(oldPassword)`.
  - `auth.js:364-379`: after a recovery unlock the app opens directly.
  - No other path re-creates the vault.
- **Trigger:** forget the password → "Use recovery code" → unlock → Settings → Change password. It fails without the old password.
- **Effect:** the recovery code becomes the permanent credential, typed (or pasted) at every unlock.
- **Evidence:** traced. A Node repro shows `unlockWithRecovery` succeeding and `changePassword` then failing with `bad-password`.
- **Fix:** add a "set new password" step right after a recovery unlock that re-keys from the unlocked in-memory key (`create(newPw)` + `Storage.rekey()` + re-wrap the exchange credentials).

### H-4 Changing the password silently drops the passkey, the recovery code, the auto-lock setting and the sync account
- **Where:**
  - `crypto-vault.js:206-216`: `create` writes fresh meta: no `passkey`, no `recovery`, `autoLockMs` back to 15 min.
  - `sync-engine.js:69-74, 88-92`: the account id and auth key are derived from the vault key.
  - `renderer.js:198-199`: the success message mentions only the recovery code.
- **Trigger:** Settings → Change Password.
- **Effect:**
  - Passkey unlock is gone.
  - A 1-minute auto-lock becomes 15 minutes.
  - The device syncs to a new, empty account, so other devices stop receiving changes.
  - The "add a recovery code" nudge stays hidden if it was ever dismissed (`renderer.js:3173`).
- **Fix:**
  - Carry `autoLockMs` over.
  - Before the change, warn about passkey, recovery and sync.
  - Afterwards, open the recovery-code dialog and reset the nudge.
  - Move the sync account to the new id.

### H-5 Deleting the last savings goal comes back after a reload
- **Where:** `investment-views.js:865-867`: `if (goals.length > 0) localStorage.setItem('investmentGoals', …)`.
- **Trigger:** Strategy Analysis → Goals → delete the only goal → reload. The goal is back.
- **Fix:** always write, including `[]`.

### H-6 Cloud sync never pulls on app start, and its errors are hidden behind a green badge
- **Where:**
  - `renderer.js:1205-1216`: only `configure` + `enableAutoSync`, never `sync()`.
  - `sync-engine.js:510-524`: every auto-sync error is swallowed (`sync().catch(function () {})`).
  - The Security dialog always shows a green "Enabled · last …" badge.
- **Trigger:** edit on device A, then open device B. B shows old data until "Sync now" is clicked. A broken Worker still looks "Enabled".
- **Fix:**
  - Run one sync after unlock.
  - Store `lastError` and show it in the badge.
  - Call `schedule()` when data changes.

### H-7 "Prices updated (N)" shows on failure, and refreshes can overlap
- **Where:**
  - `renderer.js:1303`: `newPrices` starts as a copy of the previous prices, with every symbol under two keys.
  - `renderer.js:1612`: the toast counts all keys.
  - Stock failures only go to the console.
  - `fetchPrices` has no in-flight guard. Only the header button checks `disabled: loading` (`:3316`); the stale chip, the `r` shortcut, focus and the 5-minute timer don't.
- **Trigger:**
  - Go offline → Refresh → green "Prices updated (84)" for 42 old prices.
  - Press `r` during a refresh → two runs overwrite each other's `priceHistory`, and the first one to finish clears the loading state while the other is still running.
- **Fix:**
  - Count only symbols fetched in this run, and warn on 0 or partial results.
  - Return early while a refresh is running.

### H-8 Strategy Analysis is unreadable in the light theme
- **Where:** `investment-views.js`: hard-coded light-on-dark colours, e.g. AnalysisCard title `color: 'white'` (`:44`), card background `rgba(255,255,255,0.035)`, plus about 30 more in the Goals and Liquidity views. `styles.css` has no override. LOOK-004 fixed only the status colours.
- **Trigger:** light theme → Strategy Analysis. Titles and values are white on white.
- **Fix:** pass `theme` down and use `theme.text` / `theme.textSecondary` / `theme.card`.

---

## Medium

### M-1 XIRR counts Net-Worth cash-account interest as portfolio return
- **Where:** `returns-engine.js:208`: every `type:'interest'` row is an inflow. The interest engine books with `category:'cash'`, but the account balance is not part of `currentValueEUR`.
- **Evidence:** Node repro. A flat 10,000 € stock position gives 0.0 % XIRR. One 1,500 € Festgeld accrual makes it 15.0 %.
- **Fix:** skip `source==='interest-accrual'` / `category==='cash'` rows in `buildCashflows`.

### M-2 Binance buys whose fee is taken in the bought coin overstate the quantity
- **Where:** `exchange-sync.js:105`: a fee counts only when `commissionAsset` is the quote currency.
- **Evidence:** Node repro. A buy of 0.1 BTC with a 0.0001 BTC commission is stored as quantity 0.1, fee 0.
- **Effect:** about 0.1 % too much per buy, so full sells later look oversold. Fees paid in BNB are dropped.
- **Fix:**
  - Base-asset commission on a buy: book `qty − commission`.
  - On a sell: add `commission × price` to the fees.
  - Convert BNB fees at the trade price.

### M-3 Interest is taxed in the year the app happens to be opened
- **Where:** `interest-engine.js:74-110`: one posting dated `toDate`, the open date.
- **Evidence:** traced. An account accruing since 2025-12-01, with the app next opened on 2026-01-15, books December's interest in 2026. Festgeld interest that is paid only at maturity is booked, and taxed, every year (Zuflussprinzip).
- **Fix:** split accruals at 31 December. For `time_deposit`, book at maturity or on the crediting schedule.

### M-4 The DCA analyzer treats price-refresh points as days and picks an arbitrary symbol
- **Where:**
  - `investment-views.js:237-245`: takes `priceHistory[Object.keys()[0]]`, at most 100 refresh points.
  - `dca-analyzer-engine.js:44-46`: steps 30 indices per "month".
- **Evidence:** Node repro. Purchase indices are `0,30,60,90,99,99,…`: 8 of 12 buys at the final price, so the verdict is meaningless.
- **Fix:** use the daily closes (close-history) of a symbol the user picks, and step by calendar month.

### M-5 FX attribution matches refresh points with daily FX bars by count, not by date
- **Where:** `fx-attribution.js:44-49, 141-150`.
- **Effect:** 100 refreshes in two days are measured against about 100 trading days of EURUSD.
- **Fix:** use dated daily closes on both sides and align by date.

### M-6 Rotating the recovery code takes one click and can leave you with no working code
- **Where:**
  - `renderer.js:5356`: `smallBtn('Rotate', createRecoveryKit)` with no confirmation.
  - `crypto-vault.js:431-436`: replaces the old wrap immediately.
  - The dialog has no "I saved it" check, unlike setup.
  - `renderer.js:5300`: `doCopy` reports "copied" even when the clipboard promise rejects.
- **Fix:**
  - Ask for confirmation first.
  - Require the saved checkbox before the dialog can close.
  - Await the clipboard promise.

### M-7 A reload during setup leaves a recovery code the user never saw
- **Where:** `auth.js:320-327` stores the recovery wrap before the code screen is shown. After a reload, `init` shows the unlock screen, and the nudge (`renderer.js:3173`) stays hidden because a code exists.
- **Fix:** keep a "not yet confirmed" flag until Continue, and treat the vault as having no code until then.

### M-8 Setup and password change can be submitted twice with Enter
- **Where:**
  - `auth.js:429`: Enter calls `onSubmit` directly.
  - `auth.js:153-158`: `setLoading` only disables the button.
  - The same applies to the change-password dialog (`renderer.js:210`).
- **Effect:** two overlapping `Vault.create` + `enrollRecovery` runs.
- **Fix:** a busy flag checked in the handlers.

### M-9 Destructive actions with one click, no confirmation and no undo
- **Where:**
  - Savings plan: `features4.js:480`.
  - Net-worth account: `features5.js:317`.
  - Real asset: `real-assets.js:355`.
  - Rule: `rules-engine.js:344`.
  - Tag: `tags.js:341`.
  - Custom category: `custom-categories.js:194`.
  - Exchange connection, which also deletes its stored API keys: `exchange-sync.js:456/476`.
  - Reset German tax settings: `german-tax-view.js:433`.
  - Clear security log: `renderer.js:4330`.
- **Fix:** `MaerminUI.confirm`, or an undo toast.

### M-10 You can't type a space when renaming a portfolio
- **Where:** the rename input sits inside a card using `MaerminUtils.clickable` (`features4.js:111`). Its `onKeyDown` calls `preventDefault()` on `' '` (`utils.js:106-108`), and the input's key events bubble up to it.
- **Trigger:** ✎ → type "Trade Republic". You get "TradeRepublic", and the card's click action runs.
- **Fix:** in `clickable`, only act when `e.target === e.currentTarget`, or stop propagation in the input.

### M-11 Background refreshes raise toasts every few minutes
- **Where:** the auto-refresh (`renderer.js:1647-1650`) runs the full `fetchPrices`, including the success toast (`:1612`) and, with skins but no Worker, `'CS2: add your Worker URL…'` (`:1533`).
- **Fix:** a silent mode for automatic refreshes.

### M-12 The VaR card is labelled EUR in USD mode, and Strategy Analysis ignores currency and Privacy Mode
- **Where:**
  - `risk-analytics-view-v2.js:259,276`: `formatPrice(…) + ' EUR'`, but `formatPrice` converts to the display currency.
  - `investment-views.js:460,541,646` and more: `toFixed(0) + ' EUR'`.
  - `privacyMode` is not passed to the dashboard (`renderer.js:2912`).
- **Trigger:** Hide amounts → Strategy Analysis. Amounts stay readable, and are always shown as EUR.
- **Fix:** `formatPrice` plus `getCurrencySymbol`, and pass the masking down.

### M-13 A goal with an empty target shows "NaN%" and "On Track"
- **Where:** `investment-views.js:901`: `(goal.currentAmount / goal.targetAmount) * 100`. An empty target is stored as 0.
- **Fix:** validate target > 0, and guard the division.

### M-14 News Feed shows "No news found" when the Worker fails
- **Where:** `features7.js:239,254` skip non-OK responses and errors silently. `:328` then says "No news found for your positions".
- **Fix:** count failures, and show a distinct error state.

### M-15 The tax FIFO pools lots across all portfolios (design decision)
- **Where:** `ledger.js:80` keys on category and symbol only. The tax report gets every transaction.
- **Why it matters:** § 20 Abs. 4 S. 7 EStG applies FIFO **per depot**. If portfolios represent separate depots, an SAP sale in depot B uses depot A's 2020 lot. Example: −10 per share is the correct result; the app shows +90.
- **Fix:** if portfolios are depots, add `portfolioId` to the key for the tax build, or add a per-portfolio "separate depot" flag.

### M-16 USD savings plans book back-dated executions at today's rate
- **Where:** `savings-plan-executor.js:164-170, 285-288`, called with the live `exchangeRate` (`renderer.js:445,453`).
- **Effect:** a catch-up for missed months books every month's EUR amount, and so its cost basis, at today's rate.
- **Fix:** pass `fxAt` and convert at `fxAt(dueDate)`.

---

## Low

### L-1 The § 23 Freigrenze is compared on an unrounded float
- **Where:** `tax-report-builder.js:382`.
- **Evidence:** Node repro. An exact gain of 1,000.00 € sums to 999.9999999999999, so taxable 0 and tax 0 (expected: taxable, 250 €).
- **Fix:** round to cents before the `>=` check.

### L-2 The tax-loss-harvest tab uses 26.375 % for every jurisdiction and asset
- **Where:** `metrics.js:271`. It is shown for non-DE jurisdictions only, and it also counts crypto held over a year (tax-free) and skins.
- **Fix:** use the configured rate, and exclude tax-free disposals.

### L-3 Icon-only buttons have no accessible name
- **Where:**
  - Portfolio ✎/×: `features4.js:135-141`.
  - Watchlist ×: `features.js`.
  - Position-detail close: `features3.js:270`.
  - Net-worth ×: `features5.js:317`.
  - Real-asset ×: `real-assets.js:355`.
  - Security-log ✕.
- **Fix:** add `aria-label`.

### L-4 Clickable cards keyboard users can't reach
- **Where:** the Dividends/Health stat cards and the "N stale" chip in `renderer.js` have `onClick` but no role, tabIndex or key handler.
- **Fix:** `MaerminUtils.clickable`.

### L-5 Escape or a backdrop click throws away a half-filled savings-plan form
- **Where:** `features4.js:333`, `onClose: () => setEditPlan(null)`. UX-006 fixed this for Add Transaction only.
- **Fix:** reuse `formChanged` + confirm.

### L-6 Onboarding keeps old test results after the Worker URL is edited
- **Where:** `onboarding.js:186-190`. "Save & Finish" stays visible for an untested URL, and "Test connection" can run twice.
- **Fix:** clear the results on change, and disable the button while testing.

### L-7 Setup-screen Copy fails silently
- **Where:** `auth.js:351-356`: the rejection handler is `function () {}`.
- **Fix:** show "Copy failed — select the code manually".

### L-8 The Worker's `news` route skips the symbol check
- **Where:** `cf-worker/worker.js:609-610`, unlike the routes in `SYMBOL_ROUTES`.
- **Effect:** CS2 item names still go to Yahoo RSS and count against the limit (the bug fixed for the other routes).
- **Fix:** apply `isMarketSymbol` to `news`.
