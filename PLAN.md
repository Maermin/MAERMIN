# MAERMIN — Implementation Plan

**Status:** scope confirmed 2026-10-05. Work proceeds one PR per package; the owner merges.
**Basis:** [`FINDINGS.md`](FINDINGS.md) (audit 2026-10-05), an i18n audit of `main` @ `0d0fdbd` (summarised in P2-2), and the owner interview of 2026-10-05.
**Previous plan:** the 2026-10-03 plan (WP-1 … WP-12) is done; see this file's git history. Its WP-16 (importers) is deferred below.

## Decisions

- **Audience:** public users. Market: DACH **and** international, UI in German and English.
- **Tax systems:** German and US only. No new tax engines; the tax view says plainly which systems are supported.
- **Market data:** bring-your-own Cloudflare Worker stays. No shared hosted Worker.
- **Order:** stabilize first (Phase 1: wrong money/tax figures, data loss, security), then improve (Phase 2).
- **Navigation:** 5–6 areas plus a Simple/Advanced mode. Nothing is deleted.
- **Legal:** in-app disclaimer + privacy page. No Impressum in this plan (the owner checks § 5 DDG separately).

**Deferred:** broker importers for Trade Republic, Scalable Capital, Consorsbank (old WP-16); a shared hosted Worker; AT/CH/UK tax systems; the remaining Medium/Low findings that are not listed in a package below stay in `FINDINGS.md`.

**Effort:** S ≤ ½ day · M 1–3 days · L > 3 days.

**House rules:** pure logic in dual-export IIFE modules with Node tests; new persisted keys go into `backup-engine.js` `KEYS` and, when sensitive, `storage.js` `SENSITIVE_KEYS`; no API key ever in client code or in the repo; every money/tax fix gets a Node test that reproduces the finding first (red → green).
New UI text goes through translation keys in both `en` and `de` (enforced from P2-2 on).

**Security:** the repo is public. Security findings live only in the git-ignored `docs/AUDIT.security.local.md`. Their fixes, commits and PR texts must not describe the vulnerability; use a neutral title such as "harden <module>".

Every package ends with the same gate: `npm run check && npm test && npm run build:web && npm run test:e2e`.

---

## Phase 1 — Stabilize

| Order | Package | Findings | Effort |
|---|---|---|---|
| 1 | P1-1 Duplicate bookings | C-1, C-2, C-3 | M |
| 2 | P1-2 Portfolio delete | C-4 | S |
| 3 | P1-3 Vault & recovery | H-3, H-4 | M |
| 4 | P1-4 Sync & refresh honesty | H-6, H-7, H-5 | M |
| 5 | P1-5 Import & FX correctness | H-1, H-2, M-2, M-5, M-16 | M |
| 6 | P1-6 Return & tax correctness | M-1, M-3, L-1, L-2 | M |
| 7 | P1-7 Light theme Strategy | H-8 | S |
| 8 | P1-8 Security hardening | the 2 Medium items in `docs/AUDIT.security.local.md` | S–M |

### P1-1 · Duplicate bookings (M)
- **C-1:** in-flight flag per exchange connection, button disabled while syncing; dedupe on `exchange|externalId` against `prev` inside the `setTransactions` updater.
- **C-2:** a `type:'dividend'` row with the same symbol and portfolio within ±3 days of the pay date counts as booked, whatever its `source`.
- **C-3:** a post-merge dedupe next to `dedupeExecutions`: smallest id per auto-dividend marker and per `exchange|externalId`; for interest drop accruals whose date range overlaps one already kept, then re-derive `lastAccrualDate`.
- **Done when:** the Node repros from FINDINGS.md give one row each and 251.30 € interest.

### P1-2 · Portfolio delete (S)
- `removePortfolio` moves the transactions to `default`, or the dialog offers to delete them instead; `MaerminUI.confirm` replaces the last native `confirm()`.
- One-time migration: re-home transactions whose `portfolioId` no longer exists.

### P1-3 · Vault & recovery (M)
- H-3: a recovery-code unlock leads to setting a new password.
- H-4: a password change re-wraps and keeps the passkey, recovery code, auto-lock setting and sync account.
- Includes M-6, M-7, M-8 (recovery-code rotation, reload during setup, double submit), as they touch the same flows.

### P1-4 · Sync & refresh honesty (M)
- H-6: pull on app start before catch-up writers run; errors show in the sync badge.
- H-7: "Prices updated (N)" only on success; refreshes cannot overlap.
- H-5: deleting the last savings goal persists.

### P1-5 · Import & FX correctness (M)
- H-1 Kraken symbols, H-2 USD→EUR history day offset, M-2 Binance fee in the bought coin, M-5 FX attribution matched by date, M-16 back-dated USD savings plans at the rate of the execution date.

### P1-6 · Return & tax correctness (M)
- M-1 XIRR excludes Net-Worth cash interest, M-3 interest taxed in its accrual year, L-1 § 23 Freigrenze on rounded amounts, L-2 loss-harvest rate per jurisdiction and asset.

### P1-7 · Light theme Strategy (S)
- H-8, checked in all five themes.

### P1-8 · Security hardening (S–M)
- See the local file. Neutral commit and PR wording.

---

## Phase 2 — Improve

| Order | Package | Effort |
|---|---|---|
| 1 | P2-1 Navigation + Simple/Advanced mode | L |
| 2 | P2-2 Full DE/EN translation + locale formats + CI guard | L |
| 3 | P2-3 Worker deploy button + version check | M |
| 4 | P2-4 Undo + trash | M |
| 5 | P2-5 Trust pages | S |
| 6 | P2-6 German tax: Anlage KAP + Freistellungsauftrag per broker | M–L |
| 7 | P2-7 Steam inventory import | M |

### P2-1 · Navigation + Simple/Advanced mode (L)
- Group the ~30 views into: **Portfolio · Transactions · Dividends · Analysis · Taxes · Settings**. Merge overlapping views as tabs of one area (e.g. Health + Intelligence + Risk Monitor; Returns + Performance + Attribution). Existing view ids, `g`+key shortcuts and the command palette keep working.
- **Simple/Advanced:** new vaults start in Simple (niche tools hidden); vaults that already have transactions start in Advanced. One toggle in Settings, persisted (backup key).
- Mobile nav follows the same areas.
- Folds in the UX/a11y findings: M-9 (confirmation for destructive actions; undo lands in P2-4), M-10, M-11, M-12, M-13, M-14, L-3, L-4, L-5, L-6, L-7.

### P2-2 · Full DE/EN translation (L)
Baseline from the i18n audit: `en` 499 keys, `de` 295 (210 missing); 69 keys used in code exist in neither dictionary; ~2,000 hardcoded English UI strings, only 33 of ~100 files use translation keys at all; all formatting is `en-US`/`en-GB` (no `de-DE`); `<html lang="en">` is fixed.
- Every UI string (labels, placeholders, `aria-label`, toasts, confirms, PDF/Excel export headings) goes through a key in `en` and `de`.
- One formatter module: numbers, currency, percentages and dates follow the language via `Intl` (`de-DE` → `1.234,56 €`, `en-US` → `€1,234.56`). Replace `toLocaleString('en-US')`, bare `toLocaleString()` and display `toFixed`.
- `<html lang>` follows the language.
- **CI guard** in `scripts/check.mjs`: fail on en/de key mismatch and on `t.key` uses missing from the dictionaries. Remove dead keys.
- Order: Simple-mode areas first, then Advanced views.
- **Done when:** the guard passes, and a browser click-through of every area in DE and EN shows no English in DE mode (apart from accepted terms such as "ETF", "Watchlist") and German number formats.

### P2-3 · Worker deploy button + version check (M)
- "Deploy to Cloudflare" button in README and the onboarding wizard (repo-based deploy) replaces copy-paste as the primary path; copy-paste stays as fallback.
- Worker reports its version (`?action=version`); the app compares with the release it expects and shows "Your Worker is outdated → update" instead of failing silently per feature.

### P2-4 · Undo + trash (M)
- Deleted transactions, portfolios, savings plans (and similar user records) go to a trash for 30 days; an "Undo" toast after each delete; a Trash view in Settings to restore or purge.
- Trash is a persisted key (backup, sync-safe — a restored item must not resurrect duplicates).

### P2-5 · Trust pages (S)
- Disclaimer "No tax or investment advice — estimates only" on the tax, tax-advisor, advisor and intelligence views.
- Privacy page: what stays local, what goes to the user's Worker, CoinGecko and other sources, what sharing/sync sends.
- Tax view states that only German and US rules are supported.

### P2-6 · German tax: Anlage KAP + Freistellungsauftrag (M–L)
- The tax report maps its figures onto the lines of Anlage KAP / KAP-INV for the selected year (in-app table + export).
- Freistellungsauftrag per broker: the user enters the amount per broker; warning when the sum exceeds 1,000 € (single) / 2,000 € (joint); shows remaining headroom per broker.

### P2-7 · Steam inventory import (M)
- User enters a public Steam profile; the Worker fetches the CS2 inventory (new Worker route, rate-limited like the others).
- Editable preview (like the PDF import): purchase price pre-filled with today's price, editable per row, plus date.
- Re-import shows only items not imported before (by asset id); it never books sales.

---

## Phase 3 — Usability review

After Phase 2: walk first run, add transaction, import, refresh, tax export, backup/restore, sync and Steam import on desktop and mobile, in DE and EN and all five themes; deliver a severity-sorted list with fixes.

---

## Progress

Updated in each package's PR. After a context reset: read this table and `git log`, then continue with the first package that is not merged.

Gate note: `npm run test:e2e` needs a Chromium. On a machine without the Playwright download, set `CHROME_PATH` to an installed Chrome (e.g. `C:\Program Files\Google\Chrome\Application\chrome.exe`).

| Package | Status | Branch | PR | Notes |
|---|---|---|---|---|
| P1-1 Duplicate bookings | merged | `fix/p1-1-duplicate-bookings` | https://github.com/Maermin/MAERMIN/pull/81 | Post-sync dedupe runs at app open in `renderer.js` (one effect for dividends, exchange trades, interest). Interest accruals now carry `periodStart`; legacy accruals without it are deduped only on an identical period. |
| P1-2 Portfolio delete | merged | `fix/p1-2-portfolio-delete` | https://github.com/Maermin/MAERMIN/pull/82 | Delete moves rows to `default` (with `movedFrom`); migration v5 re-homes old orphans, only when `maermin_portfolios` is saved. Moved auto-dividends become `source:'dividend-auto-moved'`. A row added on another device to a portfolio deleted here still becomes an orphan after sync (only v5 re-homes, once). |
| P1-3 Vault & recovery | merged | `fix/p1-3-vault-recovery` | https://github.com/Maermin/MAERMIN/pull/83 | Vault meta v2 (`pwWrap`): a password change re-wraps the data key, so passkey, recovery code, auto-lock and sync account stay. v1 vaults upgrade on their first password change. New recovery codes are pending until confirmed (`enrollRecovery({pending})` + `confirmRecovery`). auth.js reads translations via `tr()`. |
| P1-4 Sync & refresh honesty | merged | `fix/p1-4-sync-refresh` | https://github.com/Maermin/MAERMIN/pull/84 | `MaerminSync.syncOnStart` pulls after every unlock (8 s timeout); catch-ups wait for it via `startupSynced`. `lastError` lives in `maermin_sync_state` (device-local), `statusOf` drives the badge. Only transaction changes call `scheduleSync`; other keys still sync on tab-hide/online. Refresh: `MaerminMarket.refreshSummary` counts positions fetched in the run. M-11 (silent auto-refresh) is still open: auto-refresh now warns on partial results every 5 min. |
| P1-5 Import & FX correctness | merged | `fix/p1-5-import-fx` | https://github.com/Maermin/MAERMIN/pull/86 | H-2 repair: migration v6 drops `maermin_fx_backfill` so the next refresh fetches range=max; `MaerminFxHistory.applySeries` replaces the cache inside the fetched range. M-2: BNB/third-asset fees are kept as `feeAsset`/`feeQuantity` + note, not valued (no price for them). Already booked USD savings executions keep their old EUR amount (only estimated ones are re-priced). |
| P1-6 Return & tax correctness | merged | `fix/p1-6-return-tax` | https://github.com/Maermin/MAERMIN/pull/87 | Also contains the sync fix for a server that lost its record (new High bug found during P1-5, owner asked to fold it in). M-3: `interestPayout` ('maturity' default / 'annual') on time deposits; existing Festgeld accounts default to maturity. L-2: `computeTaxLossHarvest(…, { jurisdiction, asOf, settings })` values per open lot; without opts the old flat rate stays. |
| P1-7 Light theme Strategy | merged | `fix/p1-7-light-strategy` | (see PR) | `InvestmentViews.ThemeContext`: the dashboard provides the app theme, views call `useT()`. Found while checking: on a 375 px phone the Liquidity (and other two-column) cards overflow to the right - a layout issue for P2-1 / Phase 3. Strategy texts are still English (P2-2). |
| P1-8 Security hardening | merged | `fix/p1-8-harden-storage-worker` | https://github.com/Maermin/MAERMIN/pull/89 | Both Medium items of the local audit. Worker: no new binding - the existing optional `SYNC_DO` gets a second instance `share`; `SHARE_DAILY_MAX` var (default 300). Users must redeploy the Worker for the share part. |
| P2-1 Navigation + Simple/Advanced | merged | `claude/intelligent-mccarthy-l3bcwj` | | `nav-model.js` is the single source for the sidebar, the phone dock (one button per area) and the in-page strip (tabs of merged pages; on phones also the area's views as chips). Mode key `maermin_ui_mode` (backup key, device-local, not synced): saved as Advanced once transactions exist, as Simple only after the start-up pull. UX findings M-9…M-14, L-3…L-7 fixed (`test/ux-findings.test.js`); `MaerminUtils.confirmThen` is the shared delete confirmation; automatic price refreshes report a problem once (`MaerminMarket.refreshNotice`). Open for Phase 3: the rename input sits inside a `role="button"` card (nested interactive). Undo for deletes lands in P2-4. |
| P2-2 Full DE/EN translation | merged | `claude/intelligent-mccarthy-l3bcwj` | | `i18n.js` (`window.MaerminI18n`) is the single lookup and formatter module: `t()` with slots and plurals (`{n:one|other}`, a form may hold slots), `num`/`money`/`pct`/`compact`/`date` via Intl in de-DE or en-US, month/weekday/category/sector/country names; `<html lang>` follows the language, which defaults to the browser language. Files use a local `__('key', 'English')` helper. `scripts/i18n-check.mjs` (run by `npm run check`) fails on en/de mismatch, empty or missing keys, a `__()` fallback that differs from `en`, dead keys, and on more hard-coded UI strings or raw `toLocale*` calls than `scripts/i18n-baseline.json` allows (`--list` shows them, `--update` ratchets down). The remaining baseline entries are data (exchange and CS2 item names, parser column names, migration labels, CSV headers). E2E scenario 8 opens every view with a de-DE browser and checks for English UI words and German number formats. CSV export headers stay English on purpose (re-import). |
| P2-3 Worker deploy button + version check | merged | `claude/intelligent-mccarthy-l3bcwj` | | README, the setup wizard and API Settings link the Deploy to Cloudflare button (`cf-worker/` subfolder); `wrangler.toml` binds `SYNC` without an id so Cloudflare provisions the KV namespace (wrangler ≥ 4.45, `cf-worker/package.json`). Copy-paste stays as the folded fallback. The Worker answers `?action=version` with `WORKER_VERSION` (no upstream call, not rate limited); `EXPECTED_WORKER_VERSION` in `onboarding.js` must match (`test/worker-version.test.js`). The app checks once per URL and when API Settings opens or closes; an older Worker (or one without the route) shows "Worker outdated → update" on the overview, a note in API Settings and a warning row in the wizard's connection test. |
| P2-4 Undo + trash | merged | `claude/intelligent-mccarthy-l3bcwj` | | `trash.js` (`window.MaerminTrash`, key `maermin_trash`: encrypted, synced, in the backup) keeps deleted transactions, portfolios, savings plans, net-worth accounts, goals, rules and real assets for 30 days (max 500 entries). Each delete toast has an Undo button (`MaerminUI.add(…, action)`); Settings → Trash restores or purges. Records in a storage key are restored by `trash.js` (`KINDS`), records in React state by a registered handler (transactions, portfolios: rows moved to Main on delete carry `movedFrom` and move back). Views with a local copy reload via `useReload(key)`. A restore skips ids already present (no duplicates); `trackTxChanges` stamps an edit on a re-added transaction so another device's tombstone cannot drop it again. Not in the trash: tags, custom categories, exchange connections, tax-settings reset, security log (they keep their confirmation). |
| P2-5 Trust pages | merged | `claude/intelligent-mccarthy-l3bcwj` | | `trust.js` (`window.MaerminTrust`): one `Disclaimer` ("No tax or investment advice — estimates only") on the Tax view (covers the tax advisor in its report tab; the tax variant adds "Only German and US tax rules are supported"), above the advisor findings in Health, and on Portfolio Intelligence. Settings → Privacy lists what stays on the device, what the Worker receives, direct requests (CoinGecko, exchange rates, CDNs, logo/picture hosts) and the opt-in flows (sync, sharing, exchange relay); it mirrors README → Privacy & Security. The tax-rules select got an aria-label. |
| P2-6 German tax: Anlage KAP + Freistellungsauftrag | part 1 (Freistellungsauftrag) merged; Anlage KAP open | `claude/intelligent-mccarthy-l3bcwj` | | `fsa.js` (`window.MaerminFSA`, key `maermin_fsa`: encrypted, synced, in the backup): orders per broker with linked portfolios. The Tax view (German rules) warns when the orders exceed the allowance from the tax settings and shows per broker this year's capital income (German detail `nettedIncome` of the linked portfolios, own FIFO per broker), used and left. **Open:** the Anlage KAP / KAP-INV line mapping. The form instructions could not be read from the build environment (network policy), and the line numbers must be checked against the form of the year before they ship. |
| P2-7 Steam inventory import | implemented, not yet in a PR | `claude/intelligent-mccarthy-l3bcwj` | | Worker route `?action=steaminv&profile=` (SteamID64, profile URL or custom URL name; public inventory, up to 5 × 2,000 items; own rate-limit budget; 403/429 passed on); Worker version 2026.10.2. `steam-import.js` (Data → Steam inventory): editable preview, one row per item name with count, today's Steam Market price (USD→EUR) and today's date; unpriced items start unticked. Steam throttles cloud IPs, so the inventory JSON can also be pasted from the user's own browser. Each buy keeps `steamAssetIds`; a re-import offers only asset ids not booked before; no sales are ever booked. |
| Phase 3 | not started | | | |
