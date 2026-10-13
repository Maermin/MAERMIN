# MAERMIN — Implementation Plan

**Status:** scope confirmed 2026-10-05; Phase 4 scope confirmed 2026-10-09; Phase 5 (v12 "Atlas") scope confirmed 2026-10-12. Work proceeds one PR per package; the owner merges.
**Basis:** [`FINDINGS.md`](FINDINGS.md) (audit 2026-10-05), an i18n audit of `main` @ `0d0fdbd` (summarised in P2-2), and the owner interview of 2026-10-05.
**Previous plan:** the 2026-10-03 plan (WP-1 … WP-12) is done; see this file's git history. Its WP-16 (importers) is deferred below.

## Decisions

- **Audience:** public users. Market: DACH **and** international, UI in German and English.
- **Tax systems:** German and US only. No new tax engines; the tax view says plainly which systems are supported. *Superseded for Phase 5: Austria and Switzerland are added; UK follows later.*
- **Market data:** bring-your-own Cloudflare Worker stays. No shared hosted Worker. *Superseded for Phase 5: an owner-hosted Worker for market data only, used as a fallback when no own Worker is set.*
- **Order:** stabilize first (Phase 1: wrong money/tax figures, data loss, security), then improve (Phase 2).
- **Navigation:** 5–6 areas plus a Simple/Advanced mode. Nothing is deleted.
- **Legal:** in-app disclaimer + privacy page. No Impressum in this plan (the owner checks § 5 DDG separately).

**Deferred:** broker importers for Trade Republic, Scalable Capital, Consorsbank (old WP-16); a shared hosted Worker; AT/CH/UK tax systems (*Phase 5 brings the importers, a price-only shared Worker and AT/CH back into scope; see "Decisions reversed for Atlas"*); the remaining Medium/Low findings that are not listed in a package below stay in `FINDINGS.md`.

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

## Phase 4 — Competitive features

Scope settled with the owner on 2026-10-09 from a competitor review (Parqet, Wealthfolio, Ghostfolio, Sharesight, getquin; October 2026). MAERMIN already leads on risk metrics, crypto holding-period tax logic and an exportable tax report; these packages close the gaps where it trails. Order: safety, then analysis, then platform, then the on-ramp; one PR per package. Each package starts with a plan (files, public API, tests, storage keys, translation keys, mismatches with this text) that the owner approves before code is written. Every PR body carries a rollback note: one-way or two-way door, who is affected, whether stored data changes and how a user gets back.

**Out of scope:** an MCP endpoint over full portfolio data (deferred: the Worker must only ever see ciphertext; the existing `?action=mcp` stays limited to the redacted share snapshot). Still decided against: broker importers for Trade Republic, Scalable Capital and Consorsbank, a shared hosted Worker, tax systems other than German and US, any change to how Pages deploys.

| Order | Package | Effort |
|---|---|---|
| 0 | P4-0 Pre-migration backup | S–M |
| 1 | P4-1 Returns heatmap | M |
| 2 | P4-2 Closed positions | M |
| 3 | P4-3 Withholding tax by country | M–L |
| 4 | P4-4 Rebalancing upgrades | M |
| 5 | P4-5 AI copy-prompt export | S–M |
| 6 | P4-6 Data check with actions | M |
| 7 | P4-7 Overview reorder | S–M |
| 8 | P4-8 Import from Portfolio Performance / Parqet | M (per file) |
| 9 | P4-9 README and demo | S–M |

### P4-0 · Pre-migration backup (S–M)
- Before `migrations.js` runs a pending schema migration, keep an encrypted copy of everything in `backup-engine.js` `KEYS` on the device, with a restore action in Settings. Not synced, not part of the normal backup.
- localStorage quota is tight: measure a full copy and decide where it lives (`idb-store.js` is one option) in the package plan.
- Found at start: nothing exists. Migrations run in `__maerminMount` after unlock, so the vault key is available to encrypt the copy. Sensitive keys already live per key in IndexedDB (`storage.js`).

### P4-1 · Returns heatmap (M)
- Month × year grid with quarter and year totals from the daily TWR series, using the existing fallback order (daily value path → daily snapshots → refresh history). Analysis → Returns page. Colours from theme tokens; all five themes, including the colour-blind one.
- Found at start: missing. `MaerminValuePath.build` gives a daily `r` per point; `fromValues` (snapshot fallback) and the refresh fallback return only a total today, so they need a per-period series.

### P4-2 · Closed positions (M)
- Open/Closed toggle on the positions table. Closed rows: disposed cost basis, proceeds, realised P&L, realised return, from `MaerminLedger`.
- Average-cost line on the position chart, hidden for closed positions.
- Found at start: partly there. The ledger has `disposals`, `realizedGain`, `proceedsEUR` per group; the FIFO tab (Taxes) lists realised P&L per symbol, including fully sold ones. The positions table (Overview) shows open positions only. **No per-position chart exists** (the position detail modal has none; the only chart is the portfolio value chart): the plan must say where the average-cost line goes.

### P4-3 · Withholding tax by country (M–L)
- German tax view, per tax year and country: gross dividends, tax withheld, the amount creditable under § 32d (5) EStG, the excess that can be reclaimed. Treaty rates from the BZSt, cited and dated in the code; result labelled an estimate. A dividend with no known country goes in an "unknown" row. German rules only; the US view is unchanged.
- Found at start: transactions store `withholdingTax` (amount in the payout currency) and no country and no ISIN (imports resolve ISINs to tickers and drop them). Only auto-booked dividends set it (flat 15 % on plain US tickers paid in USD); the transaction form has no field for it. The tax engine and Anlage KAP line 41 cap the credit at a flat 15 % for every country. Country can come from `MaerminEquityMeta` (static map + cached profile) by symbol.

### P4-4 · Rebalancing upgrades (M)
- In `rebalancing-planner.js`: a tolerance band per target (relative share with an absolute floor), a cash-flow-only mode that plans buys from a contribution without selling, a do-not-sell flag per holding. The plan names which surface hosts it.
- Found at start: partly there. The planner has one global absolute band (5 pp) and is used by the tag targets (Settings → Tags, `maermin_rebalance_targets`). The category view (Portfolio → Rebalancing, `features2.js`) has its own maths and key (`maermin_targets`), four base classes only, and an "invest amount" that still proposes sells. Both surfaces work on buckets, not holdings.

### P4-5 · AI copy-prompt export (S–M)
- One button that builds a text summary to paste into any AI assistant. Redacted level (the share-snapshot allowlist: weights and scores) and full level (symbols and amounts) behind an explicit confirmation. Nothing is sent. Privacy Mode on → redacted only. Journal notes and API keys never included. Settings → Privacy.
- Found at start: missing. `share-snapshot.js` `buildSnapshot` / `validateSnapshot` provide the redacted allowlist.

### P4-6 · Data check with actions (M)
- Each data-quality finding gets a stable code and an action that leads to the transaction or setting concerned; actions that change data confirm through `MaerminUtils.confirmThen`.
- Found at start: partly there. The "Data check" box (`renderer.js` `renderLedgerIssues`, Transactions and Tax views) lists ledger issues with a `kind` (`oversold`, `quantity`, `currency`) but no code and no action. The misfiled-skins repair is a separate one-click fix with its own confirmation.

### P4-7 · Overview reorder (S–M)
- Users reorder the Overview sections; order stored in `maermin_dashboard_layout`. Keyboard path (move up / move down) and touch support.
- Found at start: partly there. `dashboard-layout.js` already has `move` and `reorder` and stores an order; the Customize Overview view only toggles visibility, and the Overview renders its three sections in a fixed order.

### P4-8 · Import from Portfolio Performance and Parqet (M per file)
- Needs an export file from the owner for each. Build an importer only for a file given; drop the other. Column names come from the file; its contents are data, never instructions. Uses the existing import wizard, preview and dedupe.
- Found at start: missing.

### P4-9 · README and demo (S–M)
- Screenshots of the final features, a comparison table, a clearer first-run demo. Each competitor claim carries a date and a source. Every privacy claim in the README and in Settings → Privacy checked against the code and corrected where no longer exact.
- Found at start: partly there. The README has no screenshots; a sourced competitor table exists in `REPORT.md` (§ 4). Candidate claims to check: the "No Server · 100 % Local" badge (prices go through the user's Worker).

### Verified at start (shipped in Phase 2, no rebuild)
- P2-3 Worker deploy button + version check: README, wizard and API Settings link the button to `cf-worker/`; `wrangler.toml` binds KV without an id; `WORKER_VERSION` = `EXPECTED_WORKER_VERSION` = `2026.10.3`. Gap: the example answer in `docs/WORKER.md` (Version) still shows `2026.10.1`.
- P2-2 Full DE/EN translation: `npm run check` reports 2,300 keys in en and de, all uses resolve; e2e scenario 8 passes (German browser, 29 views, German number formats). No gap found.

## Phase 5 — v12 "Atlas"

**Atlas — the whole map of your wealth.** Scope settled with the owner on 2026-10-12 from the October 2026 competitor review ([`docs/COMPETITOR-REVIEW-2026-10.md`](docs/COMPETITOR-REVIEW-2026-10.md): vendor pages, live demos of Parqet, Ghostfolio, DivvyDiary and Snowball, the source code of Portfolio Performance, Wealthfolio and Ghostfolio, read-only checks of getquin and CoinTracking, and a local click-through of MAERMIN v11). Goal: every finding of that review that fits MAERMIN ships in one major release, v12.0.0 "Atlas".

**Shape.** One release, five milestones, merged package by package. The agent stops after each milestone for the owner's approval. House rules, the gate and the rollback note from Phase 4 apply unchanged: each package starts with a plan (files, public API, tests, storage keys, translation keys, mismatches with this text) that the owner approves before code is written; one PR per package; money and tax changes test-first; every new UI string in `en` and `de`.

**Decisions reversed for Atlas (owner, 2026-10-12).** These replace the matching lines under "Decisions" and "Deferred" above:
- Broker importers are back in scope (eight DACH PDF importers, P5-3.2/3.3).
- A shared, owner-hosted Worker is allowed for **market data only** (prices, FX, symbol search; P5-3.1). Sync, share, exchange relay, FinTS and every route that sees user data stay on the user's own Worker.
- Account aggregation is in scope through **FinTS on the user's own Worker** and **bring-your-own-key** SnapTrade / GoCardless (P5-3.4/3.5). No MAERMIN server, no shared API secret.
- An MCP server over full portfolio data is in scope **only as a local process** that decrypts on the user's machine (P5-5.2). The Worker still only ever sees ciphertext; `?action=mcp` stays redacted.
- Austria and Switzerland join Germany and the US as tax systems (P5-4.9/4.10). UK follows in the next release.
- Budget and spending tracking and per-stock research pages are in scope (P5-5.3/5.4).

**Still out of scope:** native iOS/Android apps and widgets, community features (profiles, comments, public portfolios, cloning), UK tax, new UI languages beyond DE/EN, an add-on/plugin system, a public third-party API, any MCP or AI route where a server sees plaintext.

**Owner tasks outside the code** (the agent lists them in the milestone report when they block): register a FinTS product ID with the Deutsche Kreditwirtschaft (P5-3.4); run the shared price Worker under the owner's Cloudflare account (P5-3.1); publish the `maermin-mcp` npm package (P5-5.2); provide or approve sources for AT/CH tax rules (P5-4.9/4.10).

### Milestone overview

| Milestone | Packages | Theme |
|---|---|---|
| M1 Atlas · Foundation | P5-1.1 … P5-1.9 | Fixes, first impression, cash-flow ledger |
| M2 Atlas · Insight | P5-2.1 … P5-2.10 | Analysis depth |
| M3 Atlas · Connect | P5-3.1 … P5-3.11 | Data in: importers, FinTS, wallets, reconciliation |
| M4 Atlas · Tax | P5-4.1 … P5-4.11 | German and crypto tax depth, AT and CH |
| M5 Atlas · Platform | P5-5.1 … P5-5.9 | Push, local MCP, budget, research, events, release |

Review item ids in brackets (F, D, N, Tier) refer to `docs/COMPETITOR-REVIEW-2026-10.md`; "REVIEW #n" refers to `docs/REVIEW-2026-09.md` § 8.

### M1 Atlas · Foundation

| Order | Package | Review items | Effort |
|---|---|---|---|
| 1 | P5-1.1 Quick fixes | F1–F4 | S |
| 2 | P5-1.2 Open items from Phases 1–4 | PLAN open notes | S–M |
| 3 | P5-1.3 Cash-flow transaction types | Tier 1 #1 | L |
| 4 | P5-1.4 Clearing account per portfolio | Tier 1 #1, REVIEW #14 | L |
| 5 | P5-1.5 Return figures on the overview | D3 | S |
| 6 | P5-1.6 Plain-language verdicts | D4 | S–M |
| 7 | P5-1.7 Richer demo | D1 | M |
| 8 | P5-1.8 Demo fixtures for Worker-only views | D2 | S–M |
| 9 | P5-1.9 Public demo link | D5 | S |

- **P5-1.1 Quick fixes.** F1: Portfolio Intelligence's single-company check (`portfolio-intelligence.js`) must not treat crypto as a company and must not say "across ETFs and single stocks" when no fund holds it; crypto concentration stays covered by the volatile-class check. F2: `DEFAULT_TARGETS` (`features2.js`, `metrics.js`) must not give every user 10 % CS2 skins; default to no targets or to the classes the user holds. F3: the Returns card "Total bought" must not be labelled "Total deposited". F4: Tax & FIFO must be visible without scrolling the desktop sidebar at 900 px height in Advanced mode (reorder areas or group the settings views).
- **P5-1.2 Open items.** M-11 (silent auto-refresh); a row added on another device to a deleted portfolio becomes an orphan after sync; two-column cards overflow at 375 px; the portfolio rename input sits inside a `role="button"` card; `docs/WORKER.md` version example; Anlage KAP line numbers re-checked against the official 2025 forms if reachable.
- **P5-1.3 Cash-flow transaction types.** New types: deposit, withdrawal, transfer in/out (between portfolios, paired), fee, fee refund, tax, tax refund, interest charge. One ledger (`ledger.js`) stays the single source; migrations keep existing data unchanged; editor, CSV/PDF/tracker importers and the Portfolio Performance import map the new types (PP's deposit and removal rows are no longer skipped). Returns and the tax report read them; nothing double-counts the existing fee and tax fields on trades.
- **P5-1.4 Clearing account.** Optional cash account per portfolio (Verrechnungskonto) whose balance follows from trades, dividends, interest and the new cash flows. TWR and XIRR use real external flows when a clearing account exists and fall back to today's behaviour when not. Negative balance shows a data-check finding.
- **P5-1.5 Overview figures.** XIRR, TWR, realized gains, dividends received, taxes, fees and net return as overview cards (reorderable in Customize Overview).
- **P5-1.6 Verdicts.** One plain sentence next to key figures: benchmark difference, Sharpe/Sortino, volatility, drawdown, health score, dividend safety. Rules and thresholds in one pure module with tests; texts in `en` and `de`; "no advice" wording.
- **P5-1.7 Richer demo.** At least 30 positions, two portfolios, three years of savings-plan buys, ten or more dividend payers, an accumulating fund with Vorabpauschale, one taxed sale, a clearing account, a crypto lot past the one-year mark. Made-up data, deterministic.
- **P5-1.8 Demo fixtures.** In demo mode only: bundled sample data for news, discovery, FX attribution and period returns, so no view is empty without a Worker. Never stored, clearly labelled as sample data.
- **P5-1.9 Public demo link.** A URL parameter or path on GitHub Pages that opens straight into demo mode without creating a vault; the README links it.

### M2 Atlas · Insight

| Order | Package | Review items | Effort |
|---|---|---|---|
| 1 | P5-2.1 Value-change attribution | Tier 1 #2, WF, Snowball | M |
| 2 | P5-2.2 Benchmark replay of own cash flows | Tier 1 #3 | M |
| 3 | P5-2.3 Full ETF look-through | Tier 1 #4 | M–L |
| 4 | P5-2.4 Heatmap drill-down and filters | Tier 1 #5 | S–M |
| 5 | P5-2.5 Dividends depth | Tier 1 #6, N3, N4, N22 | M–L |
| 6 | P5-2.6 Per-holding IRR, trade ranking, capital flow | N1, N2, N5 | M |
| 7 | P5-2.7 Investment timeline and saving streaks | N6 | S |
| 8 | P5-2.8 New checks and allocation views | N7, N8 | S–M |
| 9 | P5-2.9 Real (inflation-adjusted) returns | N9 | M |
| 10 | P5-2.10 Taxonomies | N10, Tier 3 #19 | M |

- **P5-2.1** Decompose value change per period into contributions, withdrawals, income (dividends, interest), realized gains, unrealized change, FX effect, fees, taxes and a residual; "profit by source" chart. Needs P5-1.3.
- **P5-2.2** Replay the user's own buys and sells into a chosen benchmark (MSCI World, FTSE All-World, S&P 500, Nasdaq 100, any held fund), optionally with dividends reinvested; show the difference in plain language (P5-1.6).
- **P5-2.3** Full fund holdings from issuer holdings files through the Worker (cached, allowlisted), synthetic ETFs mapped to a physical twin, sector/industry/country/currency from the underlying companies, CSV export. Keep the top-10 fallback. Check each issuer's terms before adding it.
- **P5-2.4** Click a month, quarter or year for start/end value, return and number of activities; filter by asset class, category, tag or holding; per-holding heatmap in the position dialog.
- **P5-2.5** Forecast 24 months ahead; payout CAGR 3/5 years and year-over-year growth per payment; dividend matrix security × year back to the first dividend; backtested yield and growth on current holdings; gross/net switch for dividends and returns.
- **P5-2.6** IRR per holding and per category/tag; best and worst closed trades with holding period and return; capital-flow table (net buys and sells per month and year with average).
- **P5-2.7** Investment timeline per month/year and saving streaks (current and longest months in a row with a buy).
- **P5-2.8** Intelligence checks for emergency fund (from net-worth cash accounts) and buying power; allocation by ETF provider and by broker/portfolio.
- **P5-2.9** Real returns using HICP (Eurostat, through the Worker, cached), shown next to nominal TWR/XIRR.
- **P5-2.10** Hierarchical taxonomies on top of tags and custom categories with templates (asset classes, GICS sectors, MSCI regions, Kommer), JSON import/export, usable in allocation and rebalancing.

### M3 Atlas · Connect

| Order | Package | Review items | Effort |
|---|---|---|---|
| 1 | P5-3.1 Shared price Worker (fallback) | decision 2026-10-12 | M |
| 2 | P5-3.2 PDF importers, batch A | Tier 3 #16 | L |
| 3 | P5-3.3 PDF importers, batch B | Tier 3 #16 | L |
| 4 | P5-3.4 FinTS through the user's Worker | decision 2026-10-12 | L+ |
| 5 | P5-3.5 Bring-your-own-key aggregators | decision 2026-10-12 | L |
| 6 | P5-3.6 Crypto wallets by public address | N20 | M–L |
| 7 | P5-3.7 Reconciliation and data health | N11, N15, N23 | M |
| 8 | P5-3.8 More exchange syncs | matrix gap | M |
| 9 | P5-3.9 Bonds | Tier 1 #8 | M |
| 10 | P5-3.10 More corporate actions | Tier 1 #9 | M |
| 11 | P5-3.11 Alternative asset templates | N21 | S |

- **P5-3.1** A second Worker deployment (same code, a `PRICE_ONLY` mode) that serves only market-data routes (`yf`, `yfsearch`, `cg`, FX, fundamentals, holdings, earnings, profile, steam prices) and refuses sync, share, MCP, broker relay, FinTS and Steam inventory. Rate-limited per IP, kill switch, no request logging beyond the cache. The app uses it only when no own Worker is set; an own Worker always wins. Settings → Privacy and the README state who runs it and what it sees (symbols, not amounts).
- **P5-3.2** On-device PDF parsers with editable preview: flatex, Consorsbank, DEGIRO, onvista bank. Buy, sell, dividend, tax and fee documents.
- **P5-3.3** Baader Bank (incl. Scalable documents not yet covered), Smartbroker+, Sparkasse/Deka (DekaBank depot), Postbank; dividend and tax documents of Trade Republic and Scalable. Fixtures are made up from public layouts; never commit real statements.
- **P5-3.4** FinTS/HBCI: the browser builds the dialog, the user's Worker relays to the bank's FinTS URL (allowlist from the public bank list). Accounts, transactions and depot statements (HKWPD). PIN and TAN never stored; credentials optional in the encrypted vault (bank login name only). Decoupled TAN / pushTAN flows. Needs the owner's FinTS product ID (configuration, not in the repo).
- **P5-3.5** SnapTrade (brokers) and GoCardless Bank Account Data (banks) with the user's own API keys stored only in the encrypted vault and used from the user's Worker. Read-only scopes; idempotent merge like exchange sync.
- **P5-3.6** Read-only tracking of public addresses (BTC, ETH and major L2s, SOL, others as feasible) through explorer APIs via the Worker; no keys, no signing. Balances and, where available, transactions.
- **P5-3.7** Reported vs computed balance per account and asset (exchange sync, FinTS, aggregators, wallets) with status colours; data-health checks: stale prices, missing FX, negative cash or holdings, broken transfer pairs, failed syncs with a fix hint. Extends `data-check.js` (stable `DQ-*` codes).
- **P5-3.8** Add read-only sync for further exchanges with public APIs (candidates: Bitvavo, Bybit, KuCoin, Bitget), same relay and dedupe rules.
- **P5-3.9** Bond asset type: nominal, coupon, frequency, maturity, accrued interest, coupons as income (reuse `interest-engine.js`), tax report support.
- **P5-3.10** Spin-off, merger, ISIN change and symbol change on top of splits (`corporate-actions.js`), applied to lots and the tax FIFO.
- **P5-3.11** Templates for art, P2P loans, life insurance, vehicles, startups, collectibles on top of custom categories and real assets.

### M4 Atlas · Tax

| Order | Package | Review items | Effort |
|---|---|---|---|
| 1 | P5-4.1 Loss carry-forward | Tier 2 #10, REVIEW #4 | M |
| 2 | P5-4.2 Sell simulator | Tier 2 #11, N17, REVIEW #9 | S–M |
| 3 | P5-4.3 Vorabpauschale forecast | Tier 2 #12, REVIEW #6 | S |
| 4 | P5-4.4 Allowance harvesting plan | Tier 2 #13, REVIEW #5 | S–M |
| 5 | P5-4.5 Crypto tax-free calendar | N16 | S |
| 6 | P5-4.6 Cost-basis methods and per-wallet basis | Tier 1 (cost basis), N13, N18 | M |
| 7 | P5-4.7 Jahressteuerbescheinigung reconciliation | Tier 2 #14, REVIEW #3 | M |
| 8 | P5-4.8 Statements and audit exports | Tier 2 #15, N19, REVIEW #13 | M |
| 9 | P5-4.9 Austria | decision 2026-10-12 | L |
| 10 | P5-4.10 Switzerland | decision 2026-10-12 | L |
| 11 | P5-4.11 US contribution limits | Tier 1 #6 (contribution limits) | S–M |

- **P5-4.1** Loss carry-forward per pot (shares, other, § 23 private sales) across years and per depot; feeds Anlage KAP and the tax advisor.
- **P5-4.2** "If I sell X today": lots consumed, gain, taxable vs tax-free part, Freigrenze and allowance effect, best date for crypto; stocks and funds with Teilfreistellung.
- **P5-4.3** Expected Vorabpauschale per fund for the coming January and the cash needed on the clearing account; reminder in December.
- **P5-4.4** December plan: which lots to sell and rebuy to use the remaining Sparerpauschbetrag, with Teilfreistellung and fees.
- **P5-4.5** Per coin the amount that becomes tax-free today and in 1, 3, 6, 9 and 12 months.
- **P5-4.6** Display methods average cost, LIFO, HIFO (and moving average for securities) next to FIFO; per-wallet cost basis option for crypto. German and Austrian tax keep their legal method; the method in use is always shown.
- **P5-4.7** Parse the annual tax certificate of supported banks (PDF) and diff it against MAERMIN's figures per line.
- **P5-4.8** Password-protected statement of assets (Vermögensaufstellung) PDF; roll-forward/audit report; DATEV-style accounting export; source-of-funds trace for crypto withdrawals.
- **P5-4.9** Austria: KESt 27.5 %, special rules for funds (ausschüttungsgleiche Erträge), crypto since 2022 rules, loss offset within the year; tax report and disclaimer. Sources cited in code comments; owner approves sources before code.
- **P5-4.10** Switzerland: private capital gains tax-free, dividend and interest income, withholding tax 35 % reclaim, wealth-tax statement (Wertschriftenverzeichnis) per year-end; sources as above.
- **P5-4.11** US: contribution limits for IRA, Roth IRA and 401(k) per year with remaining room.

### M5 Atlas · Platform

| Order | Package | Review items | Effort |
|---|---|---|---|
| 1 | P5-5.1 Web push | Tier 3 #17 | M |
| 2 | P5-5.2 Local MCP server | decision 2026-10-12 | L |
| 3 | P5-5.3 Budget and spending | decision 2026-10-12 | L |
| 4 | P5-5.4 Research pages | decision 2026-10-12, PP charts | L |
| 5 | P5-5.5 Event feed and ICS export | N12, Tier 1 #7, Tier 3 #11 | M |
| 6 | P5-5.6 Serverless sync transports | Tier 3 #20, REVIEW #10 | M |
| 7 | P5-5.7 Saving goals with glide path | Tier 3 #18 | S–M |
| 8 | P5-5.8 Positioning and README | N14 | S |
| 9 | P5-5.9 Release v12.0.0 "Atlas" | — | S |

- **P5-5.1** Web push (VAPID) through the user's Worker for alert rules, risk monitor, dividends and tax reminders; payloads carry no amounts or symbols unless the user opts in; works with the app closed.
- **P5-5.2** `mcp/` folder with a Node package `maermin-mcp` (stdio MCP server). Reads an encrypted vault backup or the sync blob, decrypts locally with the password (reusing `crypto-vault.js`), never opens network connections except to read the user's own sync blob when asked. Read-only tools: positions, transactions, performance, dividends, tax summary, allocation; scopes chosen at start; amounts optional. Setup guide for Claude Desktop / Claude Code.
- **P5-5.3** Budget and spending from FinTS / aggregator transactions and CSV bank exports: categories with rules, splits, budgets per month, cash-flow Sankey, recurring payments. New keys are sensitive.
- **P5-5.4** Per-security page: key figures, dividends, earnings, analyst ratings and targets where the data source allows, price chart with SMA/EMA/MACD/Bollinger, the user's own position and journal. Data through the Worker; check licence terms of each source.
- **P5-5.5** One dated event feed for held and watched symbols: ex-dates, pay dates, earnings, splits, savings-plan dates, tax dates, selected macro dates; ICS export of the same events.
- **P5-5.6** Sync the encrypted blob through a local file (File System Access) or WebDAV/Nextcloud, same format and HMAC as the Worker sync.
- **P5-5.7** Saving goals with target date, glide path and on-track status, linked to portfolios or tags.
- **P5-5.8** README, landing text and comparison table updated for Atlas; say plainly that Vorabpauschale, Anlage KAP and Sparerpauschbetrag tools are built in.
- **P5-5.9** RELEASE.md section v12.0.0 "Atlas", version 12.0.0 in package.json, header badge, service-worker cache name, migration notes, release workflow run by the owner.

## Progress

Updated in each package's PR. After a context reset: read this table and `git log`, then continue with the first package that is not merged.
Release v11.0.0 (https://github.com/Maermin/MAERMIN/pull/101) closed Phases 1–3.

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
| P2-6 German tax: Anlage KAP + Freistellungsauftrag | merged | `claude/intelligent-mccarthy-l3bcwj` | | `fsa.js`: orders per broker vs the allowance, used/left per broker (merged). `anlage-kap.js`: for portfolios ticked as held at a broker without German withholding, maps the year onto Anlage KAP 19/20/22/23/41 and KAP-INV 4–8 (distributions), 9–13 (Vorabpauschale), 14/17/20/23/26 (fund gains, after the taxed Vorabpauschale, before Teilfreistellung; losses negative) per fund type; table + CSV. The tax report exposes `germanDetail.kapInputs`. **Line numbers follow the 2024/2025 forms as far as search could confirm them; the official instructions were not reachable from the build environment, so the panel asks the user to check them.** German banks (lines 7 ff.) are not mapped: their Steuerbescheinigung carries the figures. |
| P2-7 Steam inventory import | merged | `claude/intelligent-mccarthy-l3bcwj` | | Worker route `?action=steaminv&profile=` (SteamID64, profile URL or custom URL name; public inventory, up to 5 × 2,000 items; own rate-limit budget; 403/429 passed on); Worker version 2026.10.2. `steam-import.js` (Data → Steam inventory): editable preview, one row per item name with count, today's Steam Market price (USD→EUR) and today's date; unpriced items start unticked. Steam throttles cloud IPs, so the inventory JSON can also be pasted from the user's own browser. Each buy keeps `steamAssetIds`; a re-import offers only asset ids not booked before; no sales are ever booked. |
| Phase 3 Usability review | merged | `claude/intelligent-mccarthy-l3bcwj` | https://github.com/Maermin/MAERMIN/pull/99 | Findings and fixes: [docs/USABILITY.md](docs/USABILITY.md) (3 High, 7 Medium, 5 Low; all fixed). Walked every flow on desktop and phone, DE and EN, all five themes (20 runs, scripted checks + screenshots). Regressions covered by e2e scenario 9. Contrast rule from here on: filled buttons use `theme.accentFill` / `--accent-fill` with white text, or `MaerminUtils.onColor(bg)`; theme colours come from tokens, not fixed hex values. |
| Fix: CoinGecko via the Worker | merged | `claude/intelligent-mccarthy-l3bcwj` | https://github.com/Maermin/MAERMIN/pull/100 | From a user console log: the browser called CoinGecko directly (per-IP limit, 429 without CORS reads as a CORS error). New Worker route `?action=cg` (allowlisted endpoints, cache, unknown coins remembered 1 day, last good copy on 429, optional `COINGECKO_API_KEY`); `coingecko.js` `get()` builds the Worker URL, all four callers use it, no direct CoinGecko calls remain. `?action=yf` remembers unknown symbols 6 h. Steam profile links with a trailing `/inventory/` now parse. WORKER_VERSION 2026.10.3. |
| P4-0 Pre-migration backup | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/103 | `premigration-backup.js` (`window.MaerminPreMigration`): `guardedRun()` at mount copies every `backup-engine.js` `KEYS` entry, encrypted with the vault key, into ONE IndexedDB record `maermin_premigration_backup` (`maermin`/`kv`), then runs the migrations. Measured copy: 0.9 MB (typical) to 16 MB (10,000 trades), so not localStorage. Owner decisions 2026-10-09: no copy → the migrations wait for the next load (toast + note in Trash); restore lives in Settings → Trash. A vault holding only preferences gets no copy. One copy, replaced by the next migration; not synced, not in the backup. Restore writes the keys back, sets `maermin_schema_version` to the copy's and reloads, so the migrations run again. A copy made under another vault key (encrypted-backup restore) shows as unreadable, delete only. |
| P4-1 Returns heatmap | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/104 | `returns-heatmap.js` (`window.MaerminReturnsHeatmap`): `fromSteps([{ d, r }])` → years × months with compounded quarters and year; a step counts in the month of its END date. The three TWR sources give steps: value path `points[].r`; `MaerminValuePath.fromValues(...).steps` (new field); `MaerminReturns.twrSteps` (new; `twr()` unchanged). Card `ReturnsHeatmap` in `features2.js` below the KPIs; cells carry `data-r` (exact return) for the e2e check. Colours: `theme.success`/`danger` mixed from `theme.card`, eased until the text (white or near-black, `textOn`) reaches 4.5 : 1. Phone: the table scrolls inside its card, year column sticky. No storage key. Owner gave merge rights on 2026-10-09: PRs are merged by Claude once CI is green. |
| P4-2 Closed positions | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/105 | `MaerminLedger.closedPositions(build)`: groups with nothing open and at least one matched sale (options left out) → cost basis sold, proceeds (net of sell fees), gain, return, first buy / last sale, oversold excess; newest close first. A position bought again after a full sale counts as open (its earlier round is not listed). Overview positions card: Open / Closed toggle (`posTab`, not persisted), closed rows open the position dialog with realized figures. Chart (no position chart existed; owner accepted the recommendation to add one to the dialog): `position-chart.js`, daily EUR closes from `closeSeriesEUR` since the first buy, dashed line at the positions table's FIFO average cost, hidden for closed positions. The positions table now sits in a horizontal scroll region (it was clipped on phones, open and closed). |
| P4-3 Withholding tax by country | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/110 | Owner decision 2026-10-09: build without the BZSt PDF (bzst.de unreachable from the build environment). `withholding-tax.js` (`window.MaerminWithholding`): `byCountry(taxReport.dividends)` → per country gross / withheld / creditable (min(withheld, 15 % × gross), identical to the tax engine and Anlage KAP line 41, so no tax figure changes) / excess; country only from `MaerminEquityMeta` (no listing-suffix guess), else row "unknown"; German dividends listed apart (domestic KapESt). `RATES`: statutory rates of 21 countries from secondary summaries of the BZSt table, dated `SOURCE_DATE` 2026-10-09, BE/NO/JP marked contested; used only for the "no withholding recorded" hint and notes. **To do when the BZSt PDF is available: check `RATES` against it and replace the source note.** Data entry: `withholdingTax` field in the transaction dialog for dividend transactions (edit), `withholding` field in the dividend calendar form. No storage key. |
| P4-4 Rebalancing upgrades | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/106 | Host: Portfolio → Rebalancing (asset classes), which now runs on `MaerminRebalance.plan()` instead of its own maths; targets stay in `maermin_targets`; the Tags view (tag targets) is unchanged. `plan()` options: `defaultBand`/`bands` `{ rel, abs }` (band = max(rel × target, abs)), `mode: 'cashflow'` + `contribution` (buys in proportion to the gaps, then by weight; never sells), `actual[i].sellable` (never-sell holdings left out; blocked sales reported). Without options `plan()` behaves as before except that a "hold" row now carries `deltaValue` 0 (no UI read it). New key `maermin_rebalance_prefs` `{ mode, defaultBand, bands, noSell }` in backup KEYS and SENSITIVE_KEYS (names holdings). Still four base classes only (custom categories not rebalanced). |
| P4-5 AI copy-prompt export | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/107 | `ai-prompt.js` (`window.MaerminAIPrompt`): `redactedText(snapshot)` writes only fields of `MaerminShare.validateSnapshot()` output (the share allowlist: class/sector/country/currency weights, health score, effective N); `fullText(positionsOf(portfolio, prices), snapshot)` adds every holding (symbol, name, class, qty, price, value, weight, cost, gain) and the total, reading only those fields. `Panel` in Settings → Privacy (`trust.js`): two buttons, full asks `MaerminUI.confirm` first and is hidden while "Hide amounts" (privacyMode) is on (a shown full text disappears at once); read-only textarea + Copy (clipboard). Uses the active portfolio, like Share & Compare. No storage key. |
| P4-6 Data check with actions | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/108 | `data-check.js` (`window.MaerminDataCheck`): `classify(issue, { hasWorker, hasHistory })` → `{ code, action }`; codes `DQ-OVERSOLD`, `DQ-QUANTITY`, `DQ-FX-UNKNOWN`, `DQ-FX-USD-NEAREST`, `DQ-FX-NO-DAY-RATE`, `DQ-FX-TODAY-ONLY`, `DQ-SKIN-MISFILED` (never renumber or reuse). Ledger findings now carry `txId` (quantity, currency: the first transaction concerned). Actions in `renderer.js` `runDataAction`: edit the transaction (dialog), show the symbol's transactions (switches to its portfolio, fills the search), load rates (`fetchPrices`) or open API settings without a Worker, move misfiled skins. Only the skin move changes data; it now confirms through `MaerminUtils.confirmThen` (`danger: false`). No storage key. |
| P4-7 Overview reorder | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/109 | `renderOverview` builds the three sections as thunks (`ovSections`) and renders them through `ovSlot(0..2)` in `MaerminDashboard.sectionOrder(load(), ids)`; each section sits in a plain `div[data-ov-section]`. The notices (CS2 Worker hint, misfiled skins, recovery nudge, empty state) stay between slot 2 and 3, so the default layout is unchanged. Customize Overview: drag handle on pointer events (touch + mouse; `touch-action: none`), ↑/↓ buttons (40 px, focus stays on the moved row), ArrowUp/ArrowDown on the handle, `aria-live` announcement "name: position x of n". No CSS `order` (DOM order = visual order). Order saved in the existing `maermin_dashboard_layout`. |
| P4-8 Import from Portfolio Performance / Parqet | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/111 | Owner decision 2026-10-09: no files from the owner; find the formats from the vendors' own material. Portfolio Performance: layout from the exporter's source (`CSVExporter.java`, labels in `messages*.properties` / `model/labels*.properties`, repo master 2026-10-09), English and German exports read, other languages recognised and refused with the fix. Parqet: header and row shapes from an export published in a public converter repo (ModnarUser/parqet_to_pp_converter, `src/Sample.csv`, 2024-04-08); parqet.com itself was unreachable. `tracker-import.js` (`window.MaerminTrackerImport`): `detect(headers)` (exact header match), `parse(text)`; called from `import-mapping.js` `preview()` (wins over a picked broker) and `quickCSV()`, so the wizard's preview, ISIN → ticker step and duplicate check apply. Booked: buy, sell, dividend (gross, foreign tax → `withholdingTax`; taxes on a German ISIN only in the note), inbound delivery / TransferIn as buy; every other row listed with its reason. Wizard tiles Portfolio Performance and Parqet with export steps. No storage key. Test fixtures are made up. |
| Release v11.0.0 | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/112 | Owner request 2026-10-09: release everything on main as v11 and make the code say v11. Most of it already did (package.json 11.0.0, title, README badge, file headers). Changed: header badge `v10` → `v11`, service-worker cache `maermin-v9` → `maermin-v11` (old caches are dropped on activate, the shell is fetched again once), RELEASE.md Unreleased (Phase 4) folded into v11.0.0 dated 2026-10-09, README changelog row. Comments such as "New in v10" or "v12: per-key records" name when a feature or storage format came in and stay. Merge commit `11f28b6`. The tag `MAERMIN_v11` could not be pushed from the build environment (the git proxy refuses tag pushes) and no release API is available: Owner asked on 2026-10-09 to do the release from here: `.github/workflows/release.yml` (manual `workflow_dispatch`, `contents: write`) creates tag + GitHub release on the commit it runs on, notes = the RELEASE.md section; P4-9 notes folded into v11.0.0 too, so `MAERMIN_v11` is cut from main after this PR. |
| P4-9 README and demo | merged | `claude/affectionate-brahmagupta-raixir` | https://github.com/Maermin/MAERMIN/pull/113 | **Privacy claims** checked against the code (every network call, storage, sync, share, exchange relay): corrected in README and Settings → Privacy (EN + DE) where not exact — badges "No Server · 100 % Local" / "No Account Required", "never leaves your device", "stored in localStorage", "encrypted" (at-rest encryption is optional, default on; some settings stay plaintext), sync storage (Durable Object, KV fallback), exchange relay (API key travels in the request header; Bitpanda unsigned), React "on every start" (service-worker cache), Worker contacts and stored data (CoinGecko, per-IP share counter, caches up to 30 days), share panel "no IP-derived data". Also two app texts that said crypto works without a Worker (it does not since the CoinGecko-via-Worker fix). **Comparison table** in the README from REPORT.md § 4, each competitor cell as stated on the linked pages on 2026-10-03; MAERMIN column for v11.0. **Screenshots** (`docs/screenshots/`, demo data). **Demo**: `MaerminDemo.closeHistory(today)` = made-up deterministic daily closes (Brownian bridge through every demo trade price, ending at the demo price), used in memory only in demo mode, so value chart, TWR, monthly grid and risk figures work without a Worker; demo dividend fixed (quantity × price, 15 % withholding; it was `cashAmount`, which no report read), a fully closed position (TSLA), no CS2 Worker banner in demo. |
| P5-1.1 Quick fixes | merged | `atlas/p5-1.1-quick-fixes` | https://github.com/Maermin/MAERMIN/pull/125 | **F1** `etf-lookthrough.js` `analyze()`: every `effectiveExposure` row carries `classes` (direct rows their asset class, fund constituents `stocks`). `portfolio-intelligence.js`: the single-company check (and its direct-weight fallback, which now takes the largest company from `computeConcentration().top`) skips rows whose classes are only crypto, skins or commodities (`NON_COMPANY_CLASSES`; rows without `classes` still count). A company no fund holds gets direct wording (`piScCritTitleDirect`, `piScCritDetailDirect`, `advIsOfPortfolio`, `piScImpDetailDirect`). Left as is: the top-5 concentration check still lists coins among the five largest holdings ("counting what your ETFs hold"). **F2** `MaerminMetrics.DEFAULT_TARGETS` = `{}` (the only copy; `features2.js` reads it). Owner said "go" on 2026-10-12 without answering Q1–Q3, so the agent's recommendations were used (no targets by default, the dock follows the new order), with one change from the plan: **no migration**. `maermin_targets` syncs, so an older device could write the old default back after a one-shot migration. Instead `normalizeTargets` reads a stored copy of exactly 35/45/10/10 as "no targets" every time, and the stored value is left alone. Without targets `computeRebalancingDrift` → `{ available: false, reason: 'no-targets' }` (advisor, risk monitor, risk view: no drift); Rebalancing shows an empty state ("Use my current allocation" → `targetsFromAllocation`, whole percents adding up to 100; "Set targets"), no plan, and saves only on a user edit (the mount-time save is gone). Plan rows only for classes held or targeted. **F3** subtitle key `retTotalDeposited` → `retTotalBoughtSub` ("All purchases, incl. fees": XIRR outflows are gross + fees). **F4** `nav-model.js` area order Portfolio, Transactions, Dividends, Taxes, Analysis, Settings (sidebar and phone dock); e2e measures Tax & FIFO in view at 1440 × 900 in Advanced mode. No storage key, no Worker change. |
| P5-1.2 Open items from Phases 1–4 | merged | `atlas/p5-1.2-open-items` | https://github.com/Maermin/MAERMIN/pull/126 | **M-11** was partly fixed: silent mode existed, but three toasts ignored it (CoinGecko rate limit, CS2 list failed, CS2 partial match). They now go through `MaerminMarket.sideNotice(key, { silent, shown })`: each key (`cg-rate`, `cs2-list`, `cs2-partial:<missing>`) shows once on automatic refreshes, a refresh the user starts always shows; the set (`sideNoticeRef`) clears after a clean refresh. `test/ux-findings.test.js` fails on any unguarded toast in `fetchPrices`. **Orphans after sync:** `MaerminMigrations.rehomeOrphans(rows, portfolios)` (also used by v5) runs in an effect after the start-up pull, on every transactions change (not in demo; not when no portfolio list was saved before the mount); rows keep `movedFrom` (trash restore takes them back); toast `pfOrphansMoved`. A sync that changes local data remounts the app, so list and rows come from the same pull. **375 px:** a scan of every view and in-page tab (demo) found only Strategy's Sectors, Countries, Currencies and Liquidity overflowing: `TWO_COL` grids in `investment-views.js`; e2e scans each Strategy section at 375 px. **Rename input:** the Portfolio Manager card is a plain container; the name is the switch button (`data-pf-switch`, `aria-pressed`), rename/delete are siblings (24 px); e2e checks every view for a control inside a button. **WORKER.md** already showed 2026.10.4; `test/worker-version.test.js` now keeps it in step. **Anlage KAP:** 2025 form wording and tax-software field help (secondary; the BMF PDF was unreachable) say lines 20, 22 and 23 are amounts *included* in lines 18/19. Owner 2026-10-12: as recommended, follow-up branch `atlas/p5-1.2b-kap-line19`: share losses now count in line 19 (line 23 = "included in line 19"), a negative line 19 is shown as is. Line 24 no longer exists from 2025 (not used here). **Risk Level money figures** (found in the M1 report, branch `atlas/p5-1.2c-risk-money`): on the daily-index path (VIS-005) VaR/CVaR were computed for a value of 1 (shown as 0.01 EUR) and the distribution/recommendations named the index placeholder; `scaleRiskMoney` scales them to the active portfolio value (EUR, the Overview figure, new prop `portfolioValueEUR`) and `bookWeights` gives the real holdings' shares (every asset class). Test-harness note: after seeding storage in e2e, wait ~1.5 s before a reload, or the encrypted writes are lost. |
| P5-1.3 Cash-flow transaction types | merged | `atlas/p5-1.3-cashflow-types` | https://github.com/Maermin/MAERMIN/pull/127 | Owner 2026-10-12: Q1–Q4 as recommended. **Rows** in `transactions`: `{ type: deposit|withdrawal|transfer_in|transfer_out|fee|fee_refund|tax|tax_refund|interest_charge, category: 'cashflow', amount > 0, currency, date, portfolioId, notes? }`; a transfer is a pair with `transferId` + `counterPortfolioId` (cash only; moving securities with their cost basis is NOT in scope, own package later). No migration, no new key. **Ledger** (`ledger.js`): `CASH_TYPES` (sign = effect on the portfolio's cash; `flow` = XIRR flow), `isCash`, `isTransfer`, `validateCash`, `transferPair`, `pairOf`, `cashFlows` (signed EUR, byType, byYear, issues `cash-amount`). Cash rows never reach `build()` (positions, FIFO). **Returns:** `buildCashflows` adds fee/tax/refunds/interest charge as flows with `type`; deposits, withdrawals, transfers and TWR wait for P5-1.4. Returns view: Total bought = trade outflows only, Total return includes the net cash flows, Total Fees includes stand-alone fees − refunds; Fee Analyzer counts them under category "Account" (`i18n.category('cashflow')`). **Tax report:** `summary.cashBookings` (tax, tax_refund, fee, fee_refund, interest_charge of the year, EUR) shown in the Tax Report tab "for information"; computed DE/US tax unchanged. **Editor:** Buy / Sell / Cash; Cash = booking type, amount, currency, date, note, "to portfolio" for a transfer; `MaerminUtils.upsertCash` (edit either half updates both, transfer ↔ other type adds/drops the other half, a trade edited into cash loses its trade fields). Delete trashes a transfer pair as ONE entry (payload array), Undo restores both. List shows "→ / ← portfolio" or the note and the signed amount. **Importers:** PP (Deposit/Einlage, Removal|Withdrawal/Entnahme, Fees, Fees Refund, Taxes, Tax Refund, Interest Charge/Zinsbelastung) and Parqet (Deposit, Withdrawal, Fee, Tax, FeeRefund, TaxRefund; fee/tax column when amount is 0) book cash rows; a security named in the row goes to the note only. PP interest on cash (until P5-1.4) and PP transfers (the CSV names no counter account, so no pair is possible) stay listed. Generic CSV: cash words only for rows without a symbol (with a symbol: buy/sell as before), amount from a Total/Amount/Betrag column or quantity (× price). MAERMIN CSV export writes the signed amount as Total and re-imports non-transfer cash rows. `dupKey` includes `amount`. PDF importer: no cash documents yet (P5-3.2/3.3). i18n baseline ratcheted (`run({ update: true })`; the `--update` CLI flag does not fire on Windows paths). |
| P5-1.4 Clearing account per portfolio | merged | `atlas/p5-1.4-clearing-account` | https://github.com/Maermin/MAERMIN/pull/128 | Owner 2026-10-12: Q1–Q3 as recommended (cash counts in the overview and Net Worth as its own line, allocation stays securities only; "book the missing deposits" after a confirmation; EUR-only account). **Setting:** `portfolio.clearing = { enabled, openingBalance, openingDate }` in `maermin_portfolios` (`usePortfolios().setClearing`); off by default; no migration, no new key. **Ledger:** `clearingBalance(transactions, portfolioId, { opening, openingDate, exchangeRate, fxAt })` → `{ balanceEUR, series (end of day), events (with holding `key`), external, firstNegative, minBalance }`; buy −(gross+fees), sell +(gross−fees), dividend/interest +(gross−withholding−fees), cash rows by sign; Net-Worth interest (`interest-accrual`/category `cash`) and options are not part of it; other currencies at the booking date's rate. `missingDeposits(clearing)` = one deposit per day the balance would go below zero, rounded up to the cent. **Returns:** `MaerminReturns.clearingCashflows(clearing, securitiesValue, today)` (XIRR from deposits/withdrawals, end = securities + cash); `MaerminValuePath.build(…, { clearing })`: daily value = securities at close + cash at end of day, externals at the start of the day, the cash of a holding without price history counts as external (neutral); `path.cash = true`. Without the account every figure is unchanged (existing tests untouched). Snapshot/refresh TWR fallbacks do not see cash. **UI:** Portfolio Manager card: switch, balance, opening balance + date, double-count hint; Overview stat card "Cash (clearing account)" with "Total incl. cash" (the value chart stays securities only, so its history has no jump); KPI net worth and Net Worth view add the cash; Returns: XIRR subtitle "from deposits and withdrawals", TWR subtitle "incl. cash account". **Data check:** `DQ-CASH-NEGATIVE` (severity info: it does not touch cost basis or tax) with action `book-deposits` (confirmThen, rows note "Added by the data check"). Not done: separate USD cash balances; the snapshot fallback with cash. |
| P5-1.5 Return figures on the overview | merged | `atlas/p5-1.5-overview-returns` | https://github.com/Maermin/MAERMIN/pull/129 | Owner 2026-10-12: Q1/Q2 as recommended (Taxes = foreign withholding + tax bookings − refunds, a tax field on sells later with M4; one section, not single cards). `return-figures.js` (`window.MaerminReturnFigures.compute(transactions, { securitiesValueEUR, exchangeRate, fxAt, today, valuePath?, clearings? })`) is the one source for the Overview section "Returns" (`data-testid="ov-returns"`, widget id `returnFigures` in `maermin_dashboard_layout`, third by default, appended for saved layouts) and Analysis → Returns (XIRR, total return, Total bought, proceeds, Total Fees now come from it; its TWR fallbacks stay in the view). XIRR: portfolios with a clearing account give their deposits/withdrawals, the others their trades; end = securities + clearing cash. TWR on the Overview: the active portfolio's path when the view is that portfolio, else `buildValuePath` for the view (renderer helper shared with `valuePath`); cash included only when every portfolio in the view has an account (`MaerminLedger.mergeClearings`). Realized excludes options. Every figure null without transactions ("—"). Widget labels are `__()` getters now (`w.label()`); i18n baseline ratcheted. Overview cards 4 + 3 on desktop, one column on phones. |
| P5-1.6 Plain-language verdicts | merged | `atlas/p5-1.6-verdicts` | https://github.com/Maermin/MAERMIN/pull/130 | Owner 2026-10-12: as recommended. `verdicts.js` (`window.MaerminVerdicts`) holds every rule and threshold; each function returns `{ level: good/neutral/warn/bad, text }` or null. Bands: Sharpe/Sortino < 0 · 0.5 · 1 · 2; volatility 10 · 20 · 35 % (world index ~15 %); max drawdown 10 · 20 · 35 %; health = the grade bands 85 · 70 · 55 · 40; benchmark ±1 pp = level (cumulative difference over the compared returns); dividend safety = quality score 70 · 45 plus share of income at cut risk. Shown under volatility, Sharpe, Sortino and drawdown (Risk Level), above the benchmark tiles, under the health score and in Dividends → Quality & safety, each with "Rules of thumb for orientation, not investment advice." No storage, no Worker change. |
| P5-1.7 Richer demo | merged | `atlas/p5-1.7-richer-demo` | https://github.com/Maermin/MAERMIN/pull/132 | Owner 2026-10-12: as recommended. `demo-data.js` generates the book deterministically (fixed dates, a smooth price path per symbol; the hand-written rows stay): 332 rows, 31 open positions (32 by portfolio) in two portfolios, "Main depot" (`default`) and "Savings plan broker" (`demo-broker`, clearing account on, 36 monthly 400 EUR deposits, VWCE.DE 250 EUR + IS3N.DE 100 EUR buys Oct 2023 – Sep 2026, about 1,800 EUR cash, never negative); 20 dividend payers (US quarterly with 15 % withholding, DE/NL/FR yearly); VWCE.DE and IS3N.DE as accumulating equity funds with Vorabpauschale records 2023–2025; one taxed sale (60 NVDA, May 2026) with its tax booking; BTC lots from 2023 and 2026, SOL. `MaerminDemo.getPortfolios()` and `store(key)` (fund types, Vorabpauschale records): the renderer keeps the demo portfolios and the active one in memory, the tax engine's loaders serve the demo values and its savers write nothing while the demo is on, so the user's portfolio list, active portfolio, fund types and records are never read or written (e2e). Known: the demo has no daily USD rates without a Worker (DQ-FX-USD-NEAREST info), left for P5-1.8. |
| P5-1.8 Demo fixtures for Worker-only views | merged | `atlas/p5-1.8-demo-fixtures` | https://github.com/Maermin/MAERMIN/pull/133 | Owner 2026-10-12: as recommended. `demo-fixtures.js` (`window.MaerminDemoFixtures`): in demo mode News, Discovery, FX attribution, benchmark comparison and the earnings calendar get the reserved URL `https://demo.maermin.invalid`; a fetch wrapper answers it in the page (actions `news`, `screener`, `yf` for EURUSD=X and the four benchmark proxies, `earnings`), anything else a local 404, never the network (e2e). Never stored. Every such view shows a "Sample data" chip (`data-testid=sample-data`, en/de). Discovery lists fictional companies (`MaerminDemo.SAMPLE_COMPANIES`); news says "Sample headline" with no link; funds get no earnings date; the sample indices follow the demo world ETF in USD. Period returns read the demo value path (`series` prop). `fxAt` gets the demo EUR/USD history in memory, so the old DQ-FX-USD-NEAREST note is gone. The demo closes now share a seeded market move per day (beta/R² look real; trade-day and today's prices unchanged). **Fix found on the way (test-first):** best/worst day, drawdown, the goal-ETA growth rate and the "vs. Benchmark" row of Performance counted buys and sales as gains and losses; they now use the same flows as the period cards (`neutralSteps`/`neutralIndex`, value-path rule). The FX panel's session cache is keyed by Worker URL. |
| P5-1.9 Public demo link | merged | `atlas/p5-1.9-public-demo` | https://github.com/Maermin/MAERMIN/pull/134 | Owner 2026-10-12: as recommended. `https://maermin.github.io/MAERMIN/?demo` (also `?demo=1` / `?demo=true`) opens the demo without a vault. `public-demo.js` (`window.MaerminPublicDemo`) is the first local script: with the parameter it swaps `window.localStorage` / `sessionStorage` for in-memory stores (seeded with `maermin_demo` and `maermin_onboarded`) and hides IndexedDB, so the tab never reads or writes the visitor's real storage; it fails closed (normal vault gate) if the swap does not take. `auth.js` mounts the app directly for an active public demo; "Exit demo" opens the same address without `?demo` (vault screen). README badge and links point to `?demo`. e2e: fresh browser and next to an existing vault (storage byte-for-byte unchanged, vault still unlocks). |
| P5-2.1 Value-change attribution | merged | `atlas/p5-2.1-value-attribution` | https://github.com/Maermin/MAERMIN/pull/136 | Owner 2026-10-12: M1 approved, plan as recommended. `value-attribution.js` (`window.MaerminValueAttribution`): for a period, end value − start value = money in − money out + dividends & interest (gross) + realized gains + change in unrealized gains + currency effect − fees − taxes + residual, exact to the cent. The measured book is the value path's (holdings with daily closes, today's quote, recorded splits, clearing cash). Without a clearing account purchases are money in and sales/payouts money out; with one only deposits, withdrawals, transfers and the opening balance (plus the cash of holdings without price history, listed as not measured). Realized gains = FIFO ledger with fees left out, so fees count once, when paid; currency effect = units × previous local price × rate change, day by day, taken out of the unrealized part. Card "Profit by source" in Analysis → Returns (1M · 3M · YTD · 1Y · Max, zero rows hidden, residual shown from 0.50 EUR, biggest driver in one line). No storage, no Worker change. |
| P5-2.2 Benchmark replay of own cash flows | merged | `atlas/p5-2.2-benchmark-replay` | https://github.com/Maermin/MAERMIN/pull/138 | Owner 2026-10-13: as recommended. `benchmark-replay.js` (`window.MaerminBenchmarkReplay`): the period's start value and every money in / out exactly as in "Profit by source" (`value-attribution.js` now also returns `flows` per day) buy and sell index units at that day's close (last close on or before); money before the index history → "pick a shorter period"; taking out more than the units are worth sells them all and the rest is reported. Shows both end values, the difference and both money-weighted returns (XIRR over the same dates), plus a verdict (`MaerminVerdicts.replay`, ±1 pp a year = level). **Dividends reinvested** (default) uses accumulating Xetra listings of the same index (EUNL.DE, VWCE.DE, SXR8.DE, SXRV.DE: EUR, total return after fund costs, no FX); **price only** uses the Benchmark comparison's proxies (URTH, VT, ^GSPC, ^NDX: USD at the dated rate) and says that it flatters the portfolio. **Held funds** (fund-type setting or the look-through heuristic) replay on their Yahoo history through the Worker, else their own closes; a distributing fund without its payouts. Card in Analysis → Returns below "Profit by source" (1M · 3M · YTD · 1Y · Max, default Max). Demo: sample EUR series for the four listings (VWCE.DE = the demo's own closes). No storage; existing `yf` route, no Worker change. |
| P5-2.3 Full ETF look-through | merged | `atlas/p5-2.3-fund-lookthrough` | https://github.com/Maermin/MAERMIN/pull/139 | **Owner decision 2026-10-13: the user imports the provider's holdings file; no automated retrieval.** Terms checked: Vanguard UK bars repeated automated access and reuse of its data, Xtrackers (DWS) needs prior written consent for any copying, iShares allows personal and internal use but no copying, Amundi's are unclear - so no Worker route and no redistribution (the PLAN's "through the Worker (cached, allowlisted)" is dropped). `fund-holdings-import.js` (`window.MaerminFundFiles`) reads CSV, XLSX and Excel 2003 XML locally (no library) and finds the columns by their names (EN + DE), so provider layouts do not matter; new sensitive key `maermin_fund_holdings` (backup KEYS + SENSITIVE_KEYS, synced encrypted; demo: memory only; 2,000 largest holdings + full-file sector/country/currency splits). Look-through: an imported file wins over the Yahoo top holdings and the snapshot (top-10 fallback kept); one security across funds by ticker, ISIN or name without legal forms; currency look-through from the files. **Synthetic ETFs:** the file of the physical twin can be imported for the synthetic fund (any file can be assigned to any held fund). Health → X-Ray: per fund the source ("your file of … - n holdings" / "Yahoo top n" / "snapshot"), Import / Replace / Remove, and "Export look-through (CSV)". Fixtures are made up in provider layouts (no provider data in the repo). **Owner task:** try a real holdings file from your provider(s) and report any that does not import. |
| P5-2.4 Heatmap drill-down and filters | merged | `atlas/p5-2.4-heatmap-drilldown` | https://github.com/Maermin/MAERMIN/pull/140 | Owner 2026-10-13: as recommended. `heatmap-drilldown.js` (`window.MaerminHeatmapDrill`, pure): every month, quarter and year cell of the returns heatmap is a button (click, Enter or Space) that opens the period's detail - start value (the value before the period; 0 with "nothing held before" when the history starts inside it), end value, money in / out, gain, return (the compounded steps of the cell, so it always equals the cell) and the number of activities split into buys, sales, payouts and other. With the snapshot fallback the snapshot values are used; with the refresh fallback only return and activities. **Filter** above the heatmap (daily closes only): whole portfolio, asset class / category, tag, holding - the value path is rebuilt from that subset of transactions over the same daily closes; the cash account is left out and the card says so. **PLAN mismatch:** the app keeps asset class and custom category in the same field (`tx.category`), so they share one group in the filter; finer taxonomies come with P5-2.10. **Position dialog:** the holding's own monthly returns with the same drill-down. No storage key, no migration, no Worker change. |
| P5-2.5 Dividends depth | merged | `atlas/p5-2.5-dividends-depth` | https://github.com/Maermin/MAERMIN/pull/141 | Owner 2026-10-13: as recommended. `dividend-history.js` (`window.MaerminDividendHistory`, pure + `View`). **Dividends → History** (new tab): matrix security × year back to the first dividend with totals; growth per payer (per share, so buying more is not growth): the latest payment against the one a year before, CAGR 3 and 5 years from complete calendar years (none when the base year is only partly recorded); **backtest** of today's holdings over 5 or 10 past years: income from the market dividends, yield on the prior year-end value, growth per year. **Forecast:** 24 months by default (1-10 years kept); every month is a button that lists its payments (from your last 12 months or estimated). **Gross / net switch** in Dividends and on Analysis → Returns; net (default) is the old behaviour, gross counts withholding tax, tax and fee bookings and trade fees (each net of refunds) as money taken out, not as a loss: TWR / heatmap (`value-path.js` `gross`; with a cash account at the end of the day), XIRR (a flow back on each date) and total return (`return-figures.js` `gross`). Ledger cash-account events carry `cost` (fees + withholding inside the amount). Other views keep the net path. **Storage:** prefs `grossNet` = `maermin_gross_net` (not sensitive, in backup KEYS and the pre-migration UI prefs; no migration). **Worker 2026.10.5:** the `yf` route also returns `dividends: [{ date, amount }]` (additive; cache key `yf2`) - users redeploy for the backtest; an older Worker shows a hint. Market requests send symbols only and are kept in memory. The demo answers them with sample data (badge). **PLAN mismatch:** "forecast 24 months" - the forecast already covered 1-10 years, so 24 months became the default plus month details; "backtested" = today's shares against past market dividends and prices, not a replay of the user's trades. |
| P5-2.6 Per-holding IRR, trade ranking, capital flow | in review | `atlas/p5-2.6-holding-irr` | | Owner 2026-10-13: as recommended; the owner also allowed merging on green CI and starting the next package without approval. `holding-returns.js` (`window.MaerminHoldingReturns`, pure + `Panel`): new "Per holding" section on Analysis → Returns. **IRR** (money-weighted, XIRR) per holding, per asset class / category and per tag: buys, sales and dividends on their dates plus today's value; follows the gross / net switch of P5-2.5; under a year marked "*" (scaled to a year). **Best and worst sales:** one row per sale from the ledger's FIFO lots (cost incl. fees, proceeds after fees), return, quantity-weighted holding period, annualised from one year held; 5 gains and 5 losses. Partial sales count; whole closed positions stay in P4-2. **Capital flow:** buys incl. fees, sales after fees, net per month and year, average per month (this year over the months so far) and overall. No storage key, no migration, no Worker change. |
| P5-2.7 Investment timeline and saving streaks | planned | | | |
| P5-2.8 New checks and allocation views | planned | | | |
| P5-2.9 Real (inflation-adjusted) returns | planned | | | |
| P5-2.10 Taxonomies | planned | | | |
| P5-3.1 Shared price Worker (fallback) | planned | | | |
| P5-3.2 PDF importers, batch A | planned | | | |
| P5-3.3 PDF importers, batch B | planned | | | |
| P5-3.4 FinTS through the user's Worker | planned | | | |
| P5-3.5 Bring-your-own-key aggregators | planned | | | |
| P5-3.6 Crypto wallets by public address | planned | | | |
| P5-3.7 Reconciliation and data health | planned | | | |
| P5-3.8 More exchange syncs | planned | | | |
| P5-3.9 Bonds | planned | | | |
| P5-3.10 More corporate actions | planned | | | |
| P5-3.11 Alternative asset templates | planned | | | |
| P5-4.1 Loss carry-forward | planned | | | |
| P5-4.2 Sell simulator | planned | | | |
| P5-4.3 Vorabpauschale forecast | planned | | | |
| P5-4.4 Allowance harvesting plan | planned | | | |
| P5-4.5 Crypto tax-free calendar | planned | | | |
| P5-4.6 Cost-basis methods and per-wallet basis | planned | | | |
| P5-4.7 Jahressteuerbescheinigung reconciliation | planned | | | |
| P5-4.8 Statements and audit exports | planned | | | |
| P5-4.9 Austria | planned | | | |
| P5-4.10 Switzerland | planned | | | |
| P5-4.11 US contribution limits | planned | | | |
| P5-5.1 Web push | planned | | | |
| P5-5.2 Local MCP server | planned | | | |
| P5-5.3 Budget and spending | planned | | | |
| P5-5.4 Research pages | planned | | | |
| P5-5.5 Event feed and ICS export | planned | | | |
| P5-5.6 Serverless sync transports | planned | | | |
| P5-5.7 Saving goals with glide path | planned | | | |
| P5-5.8 Positioning and README | planned | | | |
| P5-5.9 Release v12.0.0 "Atlas" | planned | | | |
