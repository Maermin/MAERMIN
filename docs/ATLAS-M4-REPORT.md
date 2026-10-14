# Atlas M4 · Tax — milestone report

State of `main` after P5-4.11, 2026-10-14.
- **Screenshots:** made-up data only (seeded vaults and the demo). Desktop 1440 × 900 in English and German, phone 390 × 844 in English, in `docs/screenshots/atlas-p5-4.*/`, one folder per package.
- **Merging:** the agent merged each PR after both CI jobs passed, as the owner allowed on 2026-10-13. On 2026-10-14 the owner dropped the stop after each milestone too: this report is filed and M5 starts right away.

## Merged

| Package | PR |
|---|---|
| P5-4.1 Loss carry-forward | https://github.com/Maermin/MAERMIN/pull/160 |
| P5-4.2 Sell simulator | https://github.com/Maermin/MAERMIN/pull/161 |
| P5-4.3 Vorabpauschale forecast | https://github.com/Maermin/MAERMIN/pull/162 |
| P5-4.4 Allowance harvesting plan | https://github.com/Maermin/MAERMIN/pull/163 |
| P5-4.5 Crypto tax-free calendar | https://github.com/Maermin/MAERMIN/pull/164 |
| P5-4.6 Cost-basis methods and per-wallet basis | https://github.com/Maermin/MAERMIN/pull/165 |
| P5-4.7 Jahressteuerbescheinigung reconciliation | https://github.com/Maermin/MAERMIN/pull/166 |
| P5-4.8 Statements and audit exports | https://github.com/Maermin/MAERMIN/pull/167 |
| P5-4.9 Austria | https://github.com/Maermin/MAERMIN/pull/168 |
| P5-4.10 Switzerland | https://github.com/Maermin/MAERMIN/pull/169 |
| P5-4.11 US contribution limits | https://github.com/Maermin/MAERMIN/pull/170 |

## What a user sees

All in the **Tax** view. The panels follow the chosen tax system.

- **Germany**
  - **Loss carry-forward:** share, other and § 23 losses carried from year to year, with optional opening balances from the last assessment. The tax report shows what was brought forward and what is carried on.
  - **Sell simulator:** "if I sell X today" shows the lots consumed, the gain, the taxable and tax-free parts, the extra tax, the allowance and carry-forward used, the Freigrenze effect and, for crypto, the best date.
  - **Vorabpauschale forecast:** per fund for the coming January, with the cash needed per clearing account. A December reminder.
  - **Allowance harvesting plan:** which lots to sell and buy back to use the rest of the Sparerpauschbetrag, after Teilfreistellung and fees.
  - **Crypto tax-free calendar:** per coin, the quantity tax-free today and in 1, 3, 6, 9 and 12 months.
  - **Cost-basis comparison:** FIFO, LIFO, HIFO and average cost side by side; FIFO stays the tax method. Per-wallet crypto FIFO is a tax setting, off by default.
  - **Jahressteuerbescheinigung:** read the bank's certificate (PDF or by hand) and compare it line by line with MAERMIN.
- **Every tax system:** statement of assets as a PDF (optionally AES-256 password-protected), cost roll-forward, DATEV-style bookings and a source-of-funds trace for crypto sales.
- **Austria:** 27.5 % KESt with the moving average, crypto Alt-/Neuvermögen and swaps, Meldefonds / Nichtmeldefonds, loss offset within the year, 25 % on bank interest.
- **Switzerland:** Wertschriftenverzeichnis in CHF, income columns A/B, the 35 % Verrechnungssteuer claim, the DA-1 list, accumulating funds, the KS 36 check. No tax amount: it is cantonal.
- **USA:** IRA, Roth IRA and 401(k) limits per year with the room left, catch-up amounts, the Roth MAGI phase-out and the deadlines.

| Package | Screenshots |
|---|---|
| P5-4.1 … P5-4.11 | `atlas-p5-4.<n>/{desktop-en,desktop-de,phone-en}-panel.jpg` |

## Sources

- **Germany:** EStG, InvStG and BMF letters, as cited in each module.
- **Austria:** the owner approved the sources on 2026-10-14, and they were checked against the consolidated RIS / jusline texts:
  - § 27, § 27a, § 27b and § 124b Z 384 EStG 1988;
  - § 186 InvFG 2011;
  - EStR 2000;
  - KryptowährungsVO.
- **Switzerland:** the owner approved the sources on 2026-10-14, together with the 6-month holding period (the Thurgau one-year reading is flagged):
  - Art. 16 Abs. 3 and Art. 20 DBG;
  - Art. 7, 13 and 14 StHG;
  - Art. 4 VStG;
  - form DA-1;
  - ESTV Kreisschreiben Nr. 36.
- **USA:** IRS Notice 2024-80 and Notice 2025-67 / IR-2025-111; Publication 590-A for the Roth reduction.

## Differences from PLAN.md (decided as recommended)

- **P5-4.1:**
  - The carry-forward is computed for all portfolios together, as the tax office settles it. A per-portfolio view shows what each depot alone would carry.
  - The § 23 Freigrenze is checked before carried losses are used (BFH IX R 27/04).
  - Not modelled: the § 10d carry-back.
- **P5-4.6:** the comparison methods are shown next to FIFO only; positions and the report keep FIFO. Moving average is the legal method only in the Austrian computation.
- **P5-4.7:** the labels follow the BMF template as published. They aren't checked against a real certificate yet.
- **P5-4.8:** the password is AES-256 (PDF 2.0, revision 6) instead of jsPDF's built-in RC4-40.
- **P5-4.9:**
  - Austria has its own moving-average engine; the ledger's FIFO doesn't fit.
  - Not modelled: derivatives, § 31 private sales, the regular-taxation option, and the KESt the bank already withheld.
- **P5-4.10:**
  - No tax amount.
  - A position without a year-end price is valued at cost and flagged.
  - The DA-1 credit assumes the usual 15 % treaty rate.
- **P5-4.11:**
  - Contributions are the deposits into the portfolios marked as retirement accounts.
  - The 2027 limits aren't published yet, so 2027 uses the 2026 amounts, marked as estimated.
  - Not modelled: § 415(c), the IRA cap at earned income, and the traditional IRA deduction phase-out.

## Storage added in M4 (no migrations)

| Key | Package | Sensitive | In backup |
|---|---|---|---|
| `maermin_loss_carry` | P5-4.1 | yes (opening loss balances) | yes |
| `maermin_vap_reminded` | P5-4.3 | no (years only) | no |
| `maermin_tax_settings.cryptoPerWallet` | P5-4.6 | (existing key) | yes |
| `maermin_tax_certs` | P5-4.7 | yes (the banks' certificate figures) | yes |
| `maermin_datev_accounts` | P5-4.8 | no (account numbers of the chart) | yes |
| `maermin_at_funds` | P5-4.9 | yes (held funds, reported income) | yes |
| `maermin_ch_settings` | P5-4.10 | yes (income, debt answer, fund income) | yes |
| `maermin_us_retirement` | P5-4.11 | yes (account types, birth year, MAGI) | yes |

## Test state

- 193 unit suites; e2e 562 passed, 0 failed.
- The shared price Worker's rate limit had caused 429 errors on the CHF checks in CI. The e2e harness now sends a documentation-range client IP (TEST-NET-3) for its own FX requests.
- The AES-256 PDFs are verified by an independent node:crypto decryptor and by xpdf's pdftotext.

## Owner tasks

None of these block M5.
1. **Still open from M3:** redeploy the Worker (2026.10.10); the FinTS product ID; deploy the shared price Worker; optional tests with real keys.
2. **Optional:** check the Jahressteuerbescheinigung parser against one real certificate (P5-4.7). The certificate stays on your machine.
3. **In November:** when the IRS publishes the 2027 limits, tell me, or I'll pick them up in the next package that touches US tax.

## Next: M5 Atlas · Platform, starting with P5-5.1 Web push

Decided as recommended:
- **Date reminders reach a closed app:** dividend pay dates, the Vorabpauschale in December, crypto lots turning tax-free, and the IRA deadline.
  - The browser encrypts each message to its own push subscription (RFC 8291).
  - The user's Worker stores only the ciphertext, the push endpoint and the send time, and sends on a cron trigger.
  - The VAPID key is created by the Worker itself, so there is nothing to set up.
- **Price rules with the app closed:** opt-in. The user's Worker then sees the symbol and the threshold, never quantities or values. Off by default.
- **In-app only, as today:** weight, total-value and drawdown rules and the risk monitor, because they need the whole portfolio.
- **Lock screen:** generic text by default. Symbols and amounts appear only after an opt-in.
- **Owner task when it lands:** redeploy the Worker, which adds the cron trigger.
