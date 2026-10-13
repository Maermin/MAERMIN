# Atlas M3 · Connect — milestone report

State of `main` after P5-3.11, 2026-10-13.
- **Screenshots:** made-up data only (demo, synthetic banks, exchanges and wallets, seeded vaults). Desktop 1440 × 900 and phone 390 × 844, English and German, in `docs/screenshots/atlas-p5-3.*/`, one folder per package.
- **Merging:** the agent merged each PR after both CI jobs passed, as the owner allowed on 2026-10-13.

## Merged

| Package | PR |
|---|---|
| P5-3.1 Shared price Worker (fallback) | https://github.com/Maermin/MAERMIN/pull/148 |
| P5-3.2 PDF importers, batch A | https://github.com/Maermin/MAERMIN/pull/149 |
| P5-3.3 PDF importers, batch B | https://github.com/Maermin/MAERMIN/pull/150 |
| P5-3.4 FinTS through the user's Worker | https://github.com/Maermin/MAERMIN/pull/151 |
| P5-3.5 Bring-your-own-key aggregators | https://github.com/Maermin/MAERMIN/pull/152 |
| P5-3.6 Crypto wallets by public address | https://github.com/Maermin/MAERMIN/pull/153 |
| P5-3.7 Reconciliation and data health | https://github.com/Maermin/MAERMIN/pull/154 |
| P5-3.8 More exchange syncs | https://github.com/Maermin/MAERMIN/pull/155 |
| P5-3.9 Bonds | https://github.com/Maermin/MAERMIN/pull/156 |
| P5-3.10 More corporate actions | https://github.com/Maermin/MAERMIN/pull/157 |
| P5-3.11 Alternative asset templates | https://github.com/Maermin/MAERMIN/pull/158 |

## What a user sees

- **Data → Broker Import**
  - **PDF import** reads flatex, Consorsbank, DEGIRO (statements and account statements), onvista bank, Baader Bank, Smartbroker+, Sparkasse / DekaBank and Postbank, plus Trade Republic and Scalable dividend and tax documents. It also picks up the taxes withheld, tax and fee documents, and several documents in one PDF.
  - **Bank sync (FinTS)** through the user's own Worker: choose a bank, then PIN, then TAN (entered TAN or pushTAN). It fetches balances, the last 90 days of transactions and the depot statement. PIN and TAN are never stored.
  - **Aggregators with your own API keys:** GoCardless Bank Account Data (bank accounts) and SnapTrade (broker accounts, read-only). The keys are encrypted in the vault and never backed up or synced.
  - **Crypto wallets (read-only)** by public address: Bitcoin; Ethereum, Arbitrum, Optimism, Base and Polygon with their tokens; and the SOL balance on Solana.
  - **Exchange sync** adds Bitvavo, Bybit, KuCoin and Bitget to Binance, Kraken, Coinbase and Bitpanda. Keys must be read-only; KuCoin and Bitget also ask for a passphrase.
- **Transactions**
  - **Reconciliation: reported vs MAERMIN.** It compares bank balances with a portfolio's clearing account, depot statements per ISIN, and crypto wallets per coin, shown green, amber or grey.
  - **Data check** gains stale or missing prices, broken transfers, stale or failed syncs and reconciliation differences. Each finding has a stable code and one action.
- **Bonds:** a built-in category.
  - Nominal value and price in %, coupon, frequency, maturity and day count.
  - Accrued interest proposed in the dialog; coupons and the redemption booked on their dates.
  - A Bonds panel on the Overview with yield to maturity.
  - Accrued interest and coupons in the tax report: other pot, Anlage KAP line 22.
- **Position dialog → Other corporate actions:** symbol change, ISIN change, merger (share exchange with optional cash) and spin-off (cost share as on the bank statement). They are applied together with splits, in date order, to lots and the tax FIFO.
- **Net Worth → Add asset → Template:** art, P2P loans, life insurance, vehicles (with yearly depreciation), startup stakes and collectibles.
- **Settings → Security & sync → Market data:** if no own Worker is set, prices can come from a shared price Worker, which sees symbols, never amounts. It can be switched off. It stays inactive until the owner deploys it.

| Package | Screenshots |
|---|---|
| P5-3.1 | `atlas-p5-3.1/*-market-data.jpg` |
| P5-3.2, P5-3.3 | `atlas-p5-3.2/*-pdf-import.jpg`, `atlas-p5-3.3/*-pdf-import.jpg` |
| P5-3.4 | `atlas-p5-3.4/*-{method,pushtan,result}.jpg` |
| P5-3.5 | `atlas-p5-3.5/*-{banks,result}.jpg` |
| P5-3.6 | `atlas-p5-3.6/*-wallets.jpg` |
| P5-3.7 | `atlas-p5-3.7/*-reconcile.jpg` |
| P5-3.8 | `atlas-p5-3.8/*-exchanges.jpg` |
| P5-3.9 | `atlas-p5-3.9/*-{panel,dialog}.jpg` |
| P5-3.10 | `atlas-p5-3.10/*-{positions,dialog}.jpg` |
| P5-3.11 | `atlas-p5-3.11/*-templates.jpg` |

## Privacy model, as built

- **The shared Worker serves market data only.** In price-only mode every route that touches user data (sync, share, MCP, broker relay, FinTS, wallets, aggregators) answers 403 before anything runs.
- **Bank, broker and exchange traffic goes through the user's own Worker** and only to listed hosts and exact read paths. Requests are signed in the browser, so API secrets never pass the Worker. PIN and TAN are never stored.
- **Everything stored is local and encrypted:** connection metadata, wallet addresses, bond terms and corporate actions are in the sensitive set (encrypted at rest, synced end-to-end encrypted). Credentials sit in the vault and are never put into a backup or a sync.

## Differences from PLAN.md (decided as recommended)

- **P5-3.2:** a DEGIRO account statement (Kontoauszug) shows no share count, so a dividend from it is booked as 1 × amount.
- **P5-3.4:**
  - FinTS covers the last 90 days of transactions, plus balances and the depot statement.
  - Bank URLs: the Sparkassen pattern, Atruvia and DKB are checked against public sources. comdirect, ING, Postbank, Consorsbank and Commerzbank are taken from open-source clients and still need confirming on first real use. Further hosts can be added with `FINTS_EXTRA_HOSTS`.
  - Tests run against a synthetic bank, as the owner decided.
- **P5-3.5:** SnapTrade's free tier covers 5 connections. Whether it supports Trade Republic is unconfirmed.
- **P5-3.6:** Solana shows the SOL balance only. SPL tokens and transactions would need a paid indexer.
- **P5-3.8:**
  - Bybit and KuCoin only answer in 7-day windows, so a sync goes back 180 days; older trades come through the CSV import.
  - Exchanges report no balances to reconciliation.
- **P5-3.9:** no live bond price feed, so the price is entered by hand. Floaters, zero-coupon OID and inflation-linked bonds aren't covered.
- **P5-3.10:**
  - New actions are entered by hand; only splits are auto-detected.
  - Cash in lieu of fractional shares is booked as a sale.
  - A foreign spin-off taxed as a dividend is entered as a 0 % cost share plus a dividend booking.
- **P5-3.11:** P2P interest and insurance payouts don't enter the tax report.

## Storage added in M3 (no migrations)

| Key | Package | Sensitive | In backup |
|---|---|---|---|
| `maermin_shared_prices` | P5-3.1 | no (a preference) | yes |
| `maermin_bank_sync` | P5-3.4 | yes (banks, last balances and depot; never PIN or TAN) | yes |
| `maermin_aggregators` | P5-3.5 | yes (connection metadata, last balances) | yes |
| `maermin_agg_cred_*` | P5-3.5 | vault-encrypted API keys | **no**, never synced |
| `maermin_wallets` | P5-3.6 | yes (addresses, last balances) | yes |
| `maermin_reconcile` | P5-3.7 | yes (account-to-portfolio links) | yes |
| `maermin_bonds` | P5-3.9 | yes (held bonds, terms, manual prices) | yes |
| `maermin_corporate_events` | P5-3.10 | yes (held symbols, actions) | yes |

`maermin_real_assets` (P5-3.11) gained an optional `details` field and new kinds.
- An **older app version** shows the new kinds as "Other" and drops `details` when it saves.
- Two other cases are kept apart in separate keys so an older app version can't misread them:
  - A custom category named "Bonds" from before P5-3.9 keeps its rows; they become bond rows.
  - Corporate actions other than splits live in their own key (`maermin_corporate_events`).

## Test state

- 181 unit suites; e2e 512 passed, 0 failed.
- New synthetic counterparts tested through the **real Worker code**: a FinTS bank, GoCardless / SnapTrade, block explorers and four exchanges. The exchange counterparts check every signature.
- Two e2e checks were made independent of timing or layout:
  - The CHF Data check now asserts by code, because the fixture's missing quote can add a DQ-PRICE-STALE finding.
  - The modal Tab walk allows the extra Tab stops a date input takes.

## Owner tasks

1. **Redeploy the Worker (2026.10.10).** It adds FinTS (2026.10.7), aggregators (2026.10.8), wallets (2026.10.9) and the four exchanges (2026.10.10). The deployed Worker is at 2026.10.6. Until then those connections show the "redeploy your Worker" hint; everything else works.
2. **FinTS product ID.** Register MAERMIN with the Deutsche Kreditwirtschaft and set it as the Worker variable `FINTS_PRODUCT_ID`. Banks refuse a dialog without it. On first real use, confirm the bank URLs marked "to confirm".
3. **Shared price Worker.** Deploy the same Worker code with `PRICE_ONLY=1` under your Cloudflare account and send me its URL for `SHARED_URL`. Until then the shared fallback is off.
4. **Optional real-key tests:** GoCardless and SnapTrade with your own keys; one exchange with a read-only key.
5. **Still open from M2:** test the fund look-through (P5-2.3) with a real issuer holdings file.

## Next: plan for P5-4.1 Loss carry-forward (M4 Tax)

- **What:** loss carry-forward per pot across years:
  - shares (§ 20 (6) S. 4);
  - other capital income (§ 20 (6));
  - private sales (§ 23 (3) S. 7–8).
- **Computed from the app's own history:** each year's unused share losses, unused other losses (a negative net) and § 23 losses go into the next year. Share losses only offset share gains; § 23 losses only offset § 23 gains.
- **Per depot:** German banks keep loss pots per bank, so the carry-forward is computed per portfolio. A switch merges them, for users who file a Verlustbescheinigung and settle in the tax return.
- **Opening balances:** an optional starting amount per pot and year, from the last tax assessment, is added to what the app computed.
- **Wiring:**
  - `computeGermanTaxDetailed` takes `carryIn {shares, other, private}` and returns `carryOut`.
  - The tax report shows "Losses brought forward" and "Carried to next year".
  - The tax advisor's pots start from the carried losses.
  - Anlage KAP stays per year: carry-forwards are applied by the tax office, so the report says so instead of changing the lines.
- **Storage:** `maermin_loss_carry`, opening balances per pot, year and portfolio. Sensitive, in the backup, no migration.
- **Tests (first):**
  - a share loss carried and used against a later share gain, but never against dividends;
  - an other loss carried and used against interest;
  - § 23 losses carried only against § 23 gains;
  - the Freigrenze applied after the carry-forward;
  - per-portfolio vs merged;
  - an opening balance;
  - a year with nothing to carry.
