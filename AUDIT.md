# MAERMIN full audit — 2026-10-24 (after v12.2.0)

**Base:** `main` @ `994350c` (v12.2.0 "Atlas Charts", after the cleanup PRs #243–#248).
**Scope:** bugs, security, junk code, look and feel, new features. This PR changes no code.
**Status:** report only. The owner picks which findings and features get fixed; nothing is built before that.

Earlier runs are in [docs/AUDIT.md](docs/AUDIT.md). Items decided there (fixed, `wontfix`, or "keep by decision") are
not repeated. **Security details are not in this file.** The repository is public, so PLAN.md → Decisions keeps them
in the git-ignored `docs/AUDIT.security.local.md`. This file gives counts, severity and a neutral fix title only.

Severity, as in FINDINGS.md: **Critical** = wrong money or tax figures in a realistic case, or data loss ·
**High** = a core feature is broken or misleading · **Medium** = real friction, or wrong in an edge case · **Low** = polish.
Evidence: **verified** = I re-ran the repro or traced the exact code path myself · **suspected** = plausible from the
code, not reproduced.

## Baseline (before any change)

| Gate | Result |
|---|---|
| `npm run check` | ✓ 803 JS files, i18n 3,999 keys en/de, no new colour literals |
| `npm test` | ✓ 221 suites |
| `npm run build:web` | ✓ 158 local + 2 CDN scripts, `maermin.min.js` 2,157 KB |
| `CI=1 npm run test:e2e` | ✓ 736 passed, 0 failed (PDF check included) |
| `npm audit` (root) | 0 vulnerabilities. `cf-worker/` and `mcp/` have no lockfile, so they cannot be audited (`mcp` has no deps; `cf-worker` only the dev tool `wrangler`) |
| Console in the running app | no errors in 29 desktop + 19 phone views (live demo) |

## Summary

| Category | Count | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| A · Bugs | 16 | 2 | 3 | 4 | 7 |
| B · Security | 2 | 0 | 0 | 0 | 2 |
| C · Junk code and stale docs | 8 removable / needs-owner items + 8 doc contradictions | – | – | – | all Low |
| D · Look and feel | 3 | 0 | 0 | 0 | 3 |
| E · Feature proposals | 10 (top 5 ranked) | | | | |

The two Critical bugs are both about dividends that never happened or were already counted: the tax report counts the
projected schedule (BUG-1), and the opt-in auto-booking books the same payout twice when the ex-date anchor moves
(BUG-2). No secret was found in the tree or in the history of any branch beyond the one already known and handled.

## Status (2026-10-25)

Owner decisions: BUG-4 option (a), BUG-5 "refuse to book without history", BUG-7 FIRE editor in the Monte Carlo
view, the bugs split into a money PR and a runtime PR, and "auto approve recommendations" from PR 2 on.

| PR | Contents | State |
|---|---|---|
| #250 | SEC-033, SEC-034 ("harden CSV exports and Worker parameter checks"; Worker version not bumped) | merged |
| #251 | BUG-1, 2, 3, 4 (a), 5, 6, 7, 12; new Data check code `DQ-DIV-DUPLICATE`; optional plan field `bookFrom` | merged |
| #252 | BUG-8, 9, 10, 11, 13, 14, 15, 16 | merged |
| #253 | JUNK-1, 3, 4, 6, `priceForBackfill` (unused after #251), DOC-1 … 8 | merged |
| #254 | UI-1, UI-3. **UI-2 needed no change:** every checkbox sits inside a label of at least 24 px; this audit's walk had measured only the 18 px box | merged |
| #255 | Feature 1: one writing tab at a time (Web Lock; other tabs show a notice and do not write) | merged |
| #257 | Follow-up to #255: "Use here" keeps the lock instead of reloading (fixed the red E1 e2e on `main`) | merged |
| #256 | Feature 2: persistent storage request and a storage health card; a failed save shows a warning | merged |

Still open and waiting for the owner: JUNK-2, 5, 7, 8 (kept), and the feature proposals 3 … 10 in E. The "Not in this PR"
lists of #250 … #254 name the neighbouring issues found while fixing, for example the fixed 0.92 USD rate fallback
in the savings-plan executor and about 50 more "today from the UTC date" fallbacks in engines.

---

## A · Bugs

### BUG-1 — Tax report counts projected "Auto-fetch" dividends as received income · **Critical** · verified
- **Where:** `tax-report-builder.js:323-329` reads every `maermin_divevents` entry of the tax year; the projected entries
  are written by `renderer.js:3153-3172` (`id: auto-<sym>-<date>`, dates up to 12 months ahead).
- **What's wrong:** `build()` adds each event in the year to `dividendIncome` and to withholding. It skips an event
  only if a booked dividend has the same symbol **and exact day**. Projected dates almost never match the real booked day,
  so a paid dividend is counted twice, and payments still in the future are counted as received.
- **Evidence:** repro (`scratchpad/a2/taxdiv.js`): one booked dividend 2.50 on 2026-08-14 plus two auto events
  (2026-08-13 and 2026-11-27, still future) → `dividendIncome` without events 2.5, with events **7.5**.
- **Blast radius:** Tax view, tax PDF/Excel, Anlage KAP, Freistellungsauftrag check, allowance harvesting: every caller
  of `MaerminTaxReport.build`. It affects only users who pressed "Auto-fetch dividends". No stored data changes; the
  fix changes figures shown and exported.
- **Proposed fix:** never count `auto-` events, and count hand-entered events only if dated on or before today. Red →
  green test in `test/` against `build()`.

### BUG-2 — Dividend auto-booking books the same payout twice when the ex-date anchor moves · **Critical** (opt-in) · verified
- **Where:** `dividend-data-service.js:171-205` (`buildPaymentSchedule`), `dividend-executor.js:29, 75-108`
  (`pending`, `BOOKED_WINDOW_DAYS = 3`); called from `renderer.js:632-633` with `back: 12`.
- **What's wrong:** past pay dates are reconstructed backwards from one anchor ex-date in fixed steps of 12/ppy months
  (+14 days). When the anchor changes (the next ex-date is announced, real ex-dates are not exactly 3 months apart, the
  24 h cache falls back to the built-in database anchored on the 15th), every past payout moves by more than 3 days, so
  the exact marker and the ±3-day window both miss and the quarter is booked again.
- **Evidence:** repro (`scratchpad/a1/div.js`, TZ Europe/Berlin, KO, 100 shares): run 1 books 2025-12-29, 2026-03-29,
  06-29, 09-29; run 2 with the next ex-date books 2026-03-12, 06-11, 09-11, 12-12 → **8 rows, March/June/September
  booked twice**.
- **Blast radius:** users with `maermin_div_autobook` on. Real `dividend` transactions are created, so they feed income,
  tax, withholding credit, XIRR and yield on cost, and they sync. **One-way door for user data already affected:**
  the fix stops new duplicates; existing duplicates need a Data-check finding the user confirms (no silent deletion).
- **Proposed fix:** treat a payout as booked when any dividend row of the same symbol and portfolio lies within about
  half a period (±45 days quarterly, ±12 monthly); prefer booking only dates from the Worker's real dividend history.
  Add a Data-check code for likely duplicate auto-dividends.

### BUG-3 — Resuming a paused savings plan, or switching it to weekly, back-books every missed date · **High** · verified
- **Where:** `savings-plan-executor.js:152-167` (`pendingExecutions` → `occurrences` from `plan.startDate`);
  pause only toggles `active` (`features4.js:439`), editing keeps `startDate` (`features4.js:339`).
- **What's wrong:** no record of a pause or of the date an edit took effect, so everything since `startDate` that has no
  marker is due.
- **Evidence:** repro (`scratchpad/a1/sp.js`): resume after an April–September pause → 7 buys 2026-04-05 … 10-05, all at
  an estimated price; monthly plan with 10 executions edited to weekly → **40 back-dated buys (4,000 EUR) at once**.
- **Blast radius:** positions, cost basis, invested capital; toast only, no undo. Plans are stored data:
  adding `pausedRanges` / `effectiveFrom` is additive (old plans without the field behave as today), but needs a test
  for old-format plans.
- **Proposed fix:** store `pausedRanges: [{from,to}]` and `effectiveFrom` (set on frequency/start change); book only
  occurrences after `effectiveFrom` and outside paused ranges.

### BUG-4 — A plan with a past start date doubles buys that were imported or typed in · **High** · verified · needs owner decision
- **Where:** `savings-plan-executor.js:89-101, 152-167`; the form accepts any start date (`features4.js:290, 330`).
- **What's wrong:** only rows with `source:'savings-plan'` count as done. That is deliberate and tested
  (`test/savings-executor.test.js:48`, "manual buys do not satisfy a due date"). But a user who imports their broker's
  plan history and then adds the plan with its real start date gets every past month booked a second time.
- **Evidence:** repro (`scratchpad/a1/sp2.js`): 10 imported buys → 10 more booked, +1,000 EUR.
- **Decision needed:** (a) ask "book N past executions?" when a plan is created or edited with a past start date,
  default "from today" — keeps the existing test; or (b) let a same-symbol buy within ±5 days satisfy a due date — changes
  the existing test, which I will not touch without your OK. I recommend (a).

### BUG-5 — Savings plans book back-dated buys at today's price when no history exists · **High** (against your rule) · verified · needs owner decision
- **Where:** `savings-plan-executor.js:260-267` (`priceForBackfill`), used by `renderer.js:548-550`.
- **What's wrong:** your brief says the executor must refuse to book without real price history. Since the earlier
  audit's BUG-019 fix it books at the live price and flags the row `estimatedPrice: true`; `repriceEstimated` corrects it
  only when a real close within 7 days appears. Without a Worker that close never appears, so the quantity stays wrong.
- **Evidence:** `priceForBackfill({}, {VWCE:120}, 'VWCE', '2026-01-05')` → `{"price":120,"estimated":true}`.
- **Decision needed:** this was a recorded design choice (docs/AUDIT.md BUG-019 table: "else estimated"). Changing it
  means `resolvePrice` uses `priceAtDate` only and unpriced occurrences stay pending (the "pending" toast already exists).
  Existing estimated rows stay as they are. I recommend following your rule.

### BUG-6 — A failed FX fetch stores the default 0.91 as that day's real USD→EUR rate · **Medium** · verified
- **Where:** `renderer.js:240` (state starts at `0.91`), `renderer.js:1745` (`usdToEur = exchangeRate || 0.91`),
  `renderer.js:1783` (`FXH.merge({ [today]: usdToEur })` runs whether or not the fetch succeeded).
- **What's wrong:** with open.er-api.com blocked or offline on the first refresh of a session, 0.91 is written to
  `maermin_fx_history` as a real point; `covers()` then reports that day and the next 7 as `exact`.
- **Evidence:** repro (`scratchpad/a1/fx.js`), real rate 0.86 stored the day before → USD trades on 2026-10-21 and
  2026-10-24 convert at 0.91 with status `exact` (10,000 USD → 9,100 EUR, about 6 % off, not flagged).
- **Blast radius:** users without a Worker (with a Worker the backfill overwrites the day). Existing bad points stay;
  the fix prevents new ones.
- **Proposed fix:** merge only inside the success branch; test with a stubbed failing fetch.

### BUG-7 — FIRE settings can no longer be edited; two views read the default · **Medium** · verified
- **Where:** the only editor was removed with `DashboardKpiStrip` in `40c40a5` (R5.4). `metrics.js:97`
  `saveFireSettings` has no caller now; `renderer-components.js:351` (Monte Carlo FIRE target) and `renderer.js:3376`
  (Intelligence emergency-fund check) still read `maermin_fire_settings`.
- **What's wrong:** a new user can never set annual expenses or withdrawal rate; existing users keep the last value
  with no way to change it.
- **Blast radius:** the Monte Carlo FIRE line and one Intelligence finding. Key, backup and sync entries stay as they are.
- **Proposed fix:** a small "FIRE assumptions" editor in the Monte Carlo view (no new tab), wired to `saveFireSettings`.
  Needs your OK on placement.

### BUG-8 — Price refresh can stay stuck on "Refreshing…" until reload · **Medium** · suspected
- **Where:** `renderer.js:1748` (open.er-api.com) and `skin-prices.js:115` (`?action=skinprices`): no timeout, while all
  other fetches use `AbortSignal.timeout`. `priceRefreshRef` allows one run at a time.
- **What's wrong:** a request that never answers leaves the flag set; later refreshes (button, `r`, focus, 5-minute poll)
  return silently. Needs a hung connection to reproduce.
- **Proposed fix:** `AbortSignal.timeout(8000)` on both; clear the flag and `setLoading(false)` in `finally`.

### BUG-9 — Overview value chart can show another portfolio's or period's data · **Medium** (display only) · verified by trace
- **Where:** `features6.js:350-570` (`PortfolioHistoryChart.buildChart`): async rebuild on `positions`, `period`,
  `prices`, `currentPeriod`, no sequence or cancel check before `setChartData`.
- **What's wrong:** switching portfolio or period while a slower build runs lets the older result land last.
- **Proposed fix:** a sequence counter in a ref, checked before every state update.

### BUG-10 — Symbol search in "Add transaction" can show results for the previous category · **Low** · verified by trace
- **Where:** `features3.js:503-583`. The effect clears its timer but not a request in flight.
- **What's wrong:** a late CoinGecko answer reopens the list in the stock form; picking it saves a CoinGecko id
  (e.g. `apple`) as a stock symbol.
- **Proposed fix:** per-effect `cancelled` flag before `setResults`/`setOpen`/`setError`.

### BUG-11 — Auto-fetched dividend schedule is lost when the user leaves the Dividends view · **Low** · verified by trace
- **Where:** `renderer.js:3072-3180`. The fetch (up to 20 × 8 s) finishes after unmount; `setDivEvents` is ignored and
  nothing is saved, while the toast still says "N payments scheduled".
- **Proposed fix:** do the update and save at app level. Note: if BUG-1 is fixed by excluding `auto-` events from tax,
  this stays a display problem only.

### BUG-12 — Projected dividend dates are one day early in summer · **Low** · verified
- **Where:** `renderer.js:3138-3156` and `dividend-data-service.js:197-200`: UTC-midnight `Date`, local `setMonth`,
  then `toISOString()`.
- **Evidence:** repro (`scratchpad/a2/divdst.js`), Europe/Berlin, ex-date 2026-02-13 → `… 2027-05-26 2027-08-26`;
  under UTC `… 05-27 … 08-27`.
- **Proposed fix:** UTC date maths (`getUTC*`/`setUTC*`). Fix together with BUG-2 (same schedule code).

### BUG-13 — The app reloads itself on the first visit and on every service-worker update · **Low** · verified by trace
- **Where:** `pwa.js:47-51` reloads on every `controllerchange`; `service-worker.js` calls `skipWaiting()` +
  `clients.claim()`, which fires `controllerchange` on the first visit too. `service-worker.js:26` precaches only the
  shell, not `maermin.min.js`.
- **What's wrong:** a reload one or two seconds after the first load, usually while the vault screen is open, so typed
  input is lost; on update, every open tab reloads. Today this reload is also what puts the bundle into the cache, so an
  offline start depends on it.
- **Proposed fix:** reload only if a controller existed at startup; add `maermin.min.js`, `boot.js`, `compute.worker.js`
  to `PRECACHE`. Untested on iOS Safari.

### BUG-14 — On slow connections one load can mix new HTML/CSS with the old bundle · **Low** · suspected
- **Where:** `service-worker.js:78-93, 114-129`: network-first with a 3 s cut-over for same-origin files; `VERSION` is
  hand-edited; the header comment still says "stale-while-revalidate".
- **Proposed fix:** stamp a build hash from `build.mjs` into `VERSION` and the bundle URL.

### BUG-15 — Nine places still take "today" from the UTC date · **Low** · verified by trace
- **Where:** `renderer.js:1608` (Vorabpauschale December reminder), `renderer.js:1641` (push plan), `renderer.js:4507`,
  `event-feed.js:275`, `statements.js:363`, `reconcile.js:182`, `investment-views.js:751`, `charts.js:749`,
  `features3.js:222`: `new Date().toISOString().slice(0,10)`.
- **What's wrong:** between 00:00 and 01:00/02:00 local time they use yesterday.
- **Proposed fix:** `MaerminUtils.todayISO()`.

### BUG-16 — A backup restore during a price refresh can lose the restored price history · **Low** · suspected
- **Where:** `renderer.js:2069-2079`: `setPriceHistory(newHistory)` built from the copy taken at refresh start, and
  `push` mutates arrays of the current state; a restore merging at `renderer.js:2759` meanwhile is overwritten.
- **Proposed fix:** updater form `setPriceHistory(prev => …)` and copy arrays before appending.

**Checked and fine (A):** savings-plan idempotency on re-run (exact + month key, month-end and leap-day plans, local
due dates, sync duplicates resolved to the smallest id); interest engine (act/365, same-day re-run books nothing,
chain dedupe after sync); `recurring.js`; backup `KEYS` (every user-data key is in it; the rest are caches,
infrastructure or device-local); restore re-runs migrations v1–v6 safely; ledger (oversold and zero/negative quantities
reported, not booked; one-year rule on Feb 29); `metrics.js` (no division by zero); `fx-history.js` direction and gaps;
sync transaction union (tombstones, edit stamps); hook order (token-level scan: no hook after a real early return);
no nested components with hooks; no temporal-dead-zone use; abort/stale guards in charts, research, discovery,
analytics, performance cards, benchmark replay, event feed; CoinGecko queue and cooldown; compute-client fallback;
every effect removes its listeners; the service worker never caches price/API hosts or the user's Worker.
Not covered in depth this run: `returns-engine.js` and `tax-calculation-engine.js` (audited 2026-10-04, skimmed only).

---

## B · Security

Full details, attack paths and repros: `docs/AUDIT.security.local.md` → "Run 2026-10-24" (git-ignored).

| ID | Severity | Evidence | Neutral fix title | Blast radius |
|---|---|---|---|---|
| SEC-033 | Low | verified | harden CSV exports | two export functions; the user's own exported files |
| SEC-034 | Low | verified | harden Worker parameter checks | one Worker route; needs a Worker redeploy |

**No secret to rotate.** I scanned the working tree and the full history of all branches (931 commits) for API keys,
tokens, private keys, bearer tokens, `.dev.vars` and `*.workers.dev` URLs. The only real hit is the item already
recorded and handled in an earlier run; no other Worker URL is committed. `npm audit` is clean.

**Checked and fine (B):** no `dangerouslySetInnerHTML`, `eval`, `new Function`, `insertAdjacentHTML` or `srcdoc`; the
remaining `innerHTML` uses build fixed markup; KLineChart draws on canvas; CSP in `index.html` and `build.mjs` match and
the KLineChart SRI hash matches the npm package; the new chart keys are encrypted at rest, backed up and synced; sync,
share and push send ciphertext or allowlisted snapshots only; charts and research send only the market symbol and
timeframe; vault and passkey code unchanged since the last audit (key bytes zeroed on lock, user verification required).
SEC-009 stays open by your earlier decision.

---

## C · Junk code and stale docs

All 162 top-level `.js` files are loaded or used, and every dependency is used. Proof method: compared the 159
`<script>` tags in `index.html` with the files; loaded each module in a Node sandbox, collected its `window.*` members,
and searched each name with word boundaries in every tracked `.js/.mjs/.html/.ts` file (tests, e2e, `mcp/`,
`cf-worker/`, `scripts/`, `build.mjs`; not `docs/` or `dist/`). I re-ran the `git grep -lw` checks below myself.

| ID | Path · symbol | Why it's unused (proof) | Safe to delete |
|---|---|---|---|
| JUNK-1 | `dividend-data-service.js:411-460, 530-754`: `analyzePortfolioDividends`, `calculateHistoricalDividends`, `createDividendCalendar`, `createStockBreakdown`, `createAnalysisInsights` (~278 lines) + i18n keys `ddsGrow`, `ddsShrink`, `ddsHighYield`, `ddsLowYield`, `ddsMonthly` | `git grep -lw analyzePortfolioDividends -- ':!docs' ':!*.md'` → only its own file and a comment in `metrics.js:142`; the other four are called only from inside it | **yes** |
| JUNK-2 | `dividend-data-service.js:461` `forecastDividends` | called only by JUNK-1 and `test/dividends.test.js:27,37` | needs owner (delete with its test, or keep as a tested seam) |
| JUNK-3 | `metrics.js:109` `computeFireMetrics` | `git grep -lw computeFireMetrics` → only `metrics.js` | **yes** (`saveFireSettings` is **kept**: BUG-7 needs it) |
| JUNK-4 | `utils.js:225` `MaerminUtils.onColor` | `git grep -lw onColor` → only `utils.js` (definition + export) | **yes** |
| JUNK-5 | `styles.css:1171-1172` `.mx-btn-danger`, `.mx-btn-ghost` | built only by `ui-store.js:279` `'mx-btn-' + v`, whose sole caller `EmptyState` never passes these variants (medium confidence) | needs owner |
| JUNK-6 | `scripts/i18n-lib.mjs:17` entry `'loader-status.js'` in `NOT_UI` | the file was removed earlier (DEAD-009) | **yes** |
| JUNK-7 | `docs/screenshots/**`: 586 of 686 images, ~14.9 MB | no tracked file names them | **no**: very likely linked from merged PR descriptions via raw URLs; deleting breaks those pages |
| JUNK-8 | `docs/ATLAS-AGENT-PROMPT.md`, `docs/CHARTS-AGENT-PROMPT.md` | working prompts, same kind as `docs/PROMPT-OPUS.md` removed under DEAD-018 | needs owner |

**Kept on purpose (look unused, are not):** `exchange-more.js` (registers itself, behind user API keys); ~350 exports
used only by tests and ~180 constants of key-, setting- or Worker-gated features; `maermin_fire_settings` and
`loadFireSettings`; every storage key, migration and old-format backup reader.

**Not in the repository (local only, no PR needed):** an empty folder `x/` at the root (git does not track empty
folders); `.claude/worktrees/fervent-greider-e3a478` is an orphaned worktree folder; `.claude/pr-*.md` are ignored
via `.git/info/exclude`.

**Docs that contradict the code:**

| ID | Where | Contradiction |
|---|---|---|
| DOC-1 | `ROADMAP.md:139` | names `allocation.js` / `computeAllocation`; neither exists |
| DOC-2 | `README.md:243` | `renderer.js` "~5,400 lines"; it has ~6,400 |
| DOC-3 | `README.md:251` | calls `docs/ARCHITECTURE.md` the full module map; 49 of 159 loaded modules are missing from it |
| DOC-4 | `docs/ARCHITECTURE.md:447` | CI "runs build:web + test"; the workflow also runs `check` and `test:e2e` |
| DOC-5 | `docs/ARCHITECTURE.md:433`, `README.md:260`, `CONTRIBUTING.md:11` | `npm run check` described as a syntax check only; it also runs the i18n and colour guards |
| DOC-6 | `docs/ARCHITECTURE.md:359-360, 436` | "Discover & Tools" area and "sidebar hub"; the nav has six areas in a rail and dock |
| DOC-7 | `README.md:256` | "npm install — pulls esbuild"; it also installs playwright-core, react, react-dom, klinecharts |
| DOC-8 | `FINDINGS.md:15`, `docs/AUDIT.md` 2026-10-24 table (D-1) | say "this PR"; it was merged as #248 |

---

## D · Look and feel

**Method:** a scripted walk of every area and page tab on the live demo (`/?demo`, which is the current `main`).
Each view was checked for page errors, horizontal overflow, text contrast (WCAG AA; colours resolved with
`color(srgb …)` handled), control size under 24 × 24 px and English words in German mode. Plus spot screenshots and a
keyboard focus check.

| Run | Views | Errors | Overflow | Contrast < AA | Untranslated |
|---|---|---|---|---|---|
| Desktop 1366 × 900, dark, EN, simple | 29 | 0 | 0 | 0 | – |
| Desktop 1366 × 900, light, EN | 29 | 0 | 0 | 0 (after correcting my checker for `color(srgb …)`) | – |
| Desktop 1366 × 900, light, DE, advanced | 29 | 0 | 0 | 0 | 0 (only company names such as "The Coca-Cola Co.") |
| Phone 390 × 844, dark, EN | 19 | 0 | 0 | 0 | – |
| Phone 390 × 844, light, DE | 19 | 0 | 0 | 0 | 0 |

Keyboard: focus ring visible (2 px solid accent, `:focus-visible`); command palette opens, runs and closes cleanly.

| ID | Severity | Where | Finding | Proposed fix |
|---|---|---|---|---|
| UI-1 | Low | Overview → holdings map (`performance-map.js`) | small tiles are buttons below 24 px high (e.g. "AK-47 \| Redline" 285 × 8 px), WCAG 2.5.8; they also take keyboard focus | tiles under 24 px: not focusable/clickable on their own; reachable through the positions list (already there) |
| UI-2 | Low | Portfolios, Events, Dividends, Returns, Alerts & Rules | 18 × 18 px checkboxes; passes 2.5.8 only where the label is part of the target (suspected, not checked per box) | wrap each box in its `<label>` with ≥ 24 px height |
| UI-3 | Low | Home → Portfolios (desktop) | portfolio name "Savings plan broker" ends in "…" in its card | let the name wrap to two lines, as done for key figures in #244 |

**Not covered (D):** Nebula, Contrast and colour-blind themes this run (all five were checked in R5); the phone walk
covers the dock areas only (Tax, Insight, Settings under "More" were checked on desktop); chart readability was judged
by eye on Overview and Charts only; a screen reader and real iOS Safari were not used. Screenshots from this run are in
the session scratchpad, not committed (the repo already holds ~15 MB of screenshots, see JUNK-7).

---

## E · Feature proposals

None of these is in PLAN.md, ROADMAP.md (including Deferred and out of scope), either part of
docs/COMPETITOR-REVIEW-2026-10.md or the README, and a code search found no existing version (e.g.
`BroadcastChannel|navigator.locks|storage.persist|navigator.storage` → no match). All stay inside existing views.

### Top 5, ranked

| # | Feature | User value | Size | Files | Risk |
|---|---|---|---|---|---|
| 1 | **One writing tab at a time** | Two open tabs (installed PWA + browser tab) each keep the decrypted data in memory and write it back; the last write can silently drop the other tab's edits (data-loss path, **suspected**, not reproduced). One tab writes (`navigator.locks`), the others become read-only with a "Use here" button (`BroadcastChannel`). | S–M | `storage.js`, `renderer.js`, `pwa.js`, `translations-complete.js` | vault lock/unlock across tabs; no new key |
| 2 | **Persistent storage + storage health** | Asks the browser not to evict the data (`navigator.storage.persist()`), shows usage, warns on iOS Safari when not installed, and surfaces failed writes that today are swallowed (`/* quota */`). Main remaining data-loss risk for public users. | S | `pwa.js`, `storage.js`, `backup-reminder.js`, `trust.js`, `renderer.js` | low; at most a device-local flag, not in backup |
| 3 | **Import history with "undo this import"** | Every import run gets an `importId`; Settings lists runs (source, date, rows) and moves a whole run to the Trash. New users start with imports; a wrong mapping today means deleting rows one by one. | M | `import-mapping.js`, `pdf-import.js`, `tracker-import.js`, `exchange-sync.js`, `bank-sync.js`, `features2.js`, `trash.js`, `renderer.js` | new field on transactions must survive sync merge and dedupe; new key `maermin_import_log` → `KEYS` + `SENSITIVE_KEYS` |
| 4 | **"First steps" checklist on the Overview** | Built from the user's own data: portfolio, first transactions, price source, first backup, tax profile, recovery code stored. Today onboarding ends after the Worker wizard. | S–M | `onboarding.js`, `renderer.js`, `dashboard-layout.js`, `translations-complete.js` | low; dismissal in the existing `maermin_dashboard_layout` |
| 5 | **"Since your last visit" card** | Value change, dividends/interest booked, rules that fired, new data-check findings, next 7 days — from existing engines (`portfolio-snapshots`, `event-feed`, `rules-engine`, `data-check`). | S–M | new pure module, `renderer.js`, `dashboard-layout.js` | `maermin_last_visit` must stay device-local (out of `KEYS`, or it causes sync churn) |

### Further candidates

6. **Glossary popovers** (XIRR, TWR, Sharpe, Vorabpauschale, Teilfreistellung …), en/de · M · new `glossary.js`, `renderer-components.js`, `verdicts.js` · no key; wording must stay "no advice".
7. **"What's new" after an update** (from RELEASE.md at build time; says when a migration ran) · S · `build.mjs`, `renderer.js`, `pwa.js` · device-local key.
8. **Year in review** card in Performance, optional percent-only share version · M · `performance-cards.js`, `value-attribution.js`, `share-snapshot.js` · the share version needs a leak test like `ai-prompt`'s.
9. **Reporting currency (USD/CHF)** across the app; tax stays in each system's currency · L · `fx.js`, `investment-views.js`, `metrics.js`, many views · high risk (every money figure); needs your decision before planning.
10. **Attach the source document to a transaction** (encrypted in IndexedDB) · L · `idb-store.js`, `storage.js`, `pdf-import.js`, `features3.js`, `backup-engine.js` · backup size, new sensitive store.

---

## Proposed PR sequence

Each PR branches from `main`, starts with a short plan for your go, runs the full gate plus a browser walkthrough at
1366 × 900 and 390 × 844, and lists what it touches but was not tested on (iOS Safari, screen reader, German UI,
passkeys, two-device sync). You merge.

| # | Branch | Contents | Door | Needs from you first |
|---|---|---|---|---|
| 1 | `audit/1-hardening` | SEC-033, SEC-034 (neutral title "harden CSV exports and Worker parameter checks") | two-way; the Worker part needs a redeploy | – |
| 2 | `audit/2-money-bugs` | BUG-1, 2, 3, 5, 6, 12 (+ BUG-4, 7 if decided): dividends, savings plans, FX | **one-way for stored data**: new plan fields (`pausedRanges`, `effectiveFrom`) are additive; existing duplicate rows are only flagged in Data check, never deleted silently | decisions on BUG-4 (a/b), BUG-5 (refuse vs estimate), BUG-7 (editor placement) |
| 3 | `audit/3-runtime-bugs` | BUG-8, 9, 10, 11, 13, 14, 15, 16 | two-way; BUG-13/14 change service-worker behaviour for every installed copy | OK to split the bugs into two PRs (money vs runtime): your brief says one PR per category, and 16 fixes in one PR are hard to review |
| 4 | `audit/4-junk` | JUNK-1, 3, 4, 6 (+ 2, 5, 8 if approved), DOC-1…8 | two-way (`git rm`, full walkthrough of every tab) | which "needs owner" items go |
| 5 | `audit/5-look-and-feel` | UI-1, UI-2, UI-3 | two-way | – |
| 6+ | `feat/<name>` | approved features, one PR each, in the ranked order | depends; 1 and 3 touch stored data | which features |

**Not done in this audit:** no real iOS Safari, no screen reader, no passkey or two-device sync test; only the
demo portfolio was walked in the browser (no real user data); `returns-engine.js` and `tax-calculation-engine.js`
were only skimmed.
