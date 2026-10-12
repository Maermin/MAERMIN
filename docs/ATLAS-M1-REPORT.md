# Atlas M1 · Foundation — milestone report

Approved by the owner on 2026-10-12. All screenshots are from the public demo (`?demo`, demo data only) at the state of `main` after P5-2.1, in `docs/screenshots/atlas-m1/` (desktop 1440 × 900 and phone 390 × 844, English and German).

## Merged

| Package | PR |
|---|---|
| P5-1.1 Quick fixes | https://github.com/Maermin/MAERMIN/pull/125 |
| P5-1.2 Open items | https://github.com/Maermin/MAERMIN/pull/126 |
| P5-1.2b Anlage KAP line 19 includes share losses | https://github.com/Maermin/MAERMIN/pull/131 |
| P5-1.2c Risk Level money figures and holdings | https://github.com/Maermin/MAERMIN/pull/135 |
| P5-1.3 Cash-flow transaction types | https://github.com/Maermin/MAERMIN/pull/127 |
| P5-1.4 Clearing account per portfolio | https://github.com/Maermin/MAERMIN/pull/128 |
| P5-1.5 Return figures on the Overview | https://github.com/Maermin/MAERMIN/pull/129 |
| P5-1.6 Plain-language verdicts | https://github.com/Maermin/MAERMIN/pull/130 |
| P5-1.7 Richer demo | https://github.com/Maermin/MAERMIN/pull/132 |
| P5-1.8 Demo fixtures for Worker-only views | https://github.com/Maermin/MAERMIN/pull/133 |
| P5-1.9 Public demo link | https://github.com/Maermin/MAERMIN/pull/134 |

## What a user sees

- **Cash and accounts:** deposits, withdrawals, transfers between portfolios, fees, tax bookings and refunds; an optional clearing account per portfolio whose cash shows on the Overview and in Net Worth.
- **Return figures on the Overview:** XIRR, TWR, realized gains, dividends (gross and net), taxes, fees and net return, the same as Analysis → Returns.
- **Plain-language verdicts:** one sentence each next to volatility, Sharpe, Sortino, drawdown, the benchmark difference, the health grade and dividend safety, with the note "rules of thumb, not investment advice".
- **Demo:** 31 positions in two portfolios, three years of savings plans, 20 dividend payers, a taxed sale, Vorabpauschale records, a clearing account and crypto lots. Views that need a Worker run on labelled sample data, with no network or storage.
- **Public demo link:** https://maermin.github.io/MAERMIN/?demo opens without a vault and never touches the visitor's storage.

| Screenshot | Shows |
|---|---|
| `*-1-overview.jpg` | Overview with the demo book |
| `*-2-returns-section.jpg` | Returns section on the Overview (P5-1.5) |
| `*-3-benchmark-verdict.jpg` | Benchmark comparison with its verdict (P5-1.6, sample data P5-1.8) |
| `*-4-risk-verdicts.jpg` | Risk Level verdicts, VaR/CVaR in euros, real holdings (P5-1.6, P5-1.2c) |
| `*-5-news-sample.jpg` | News on labelled sample headlines (P5-1.8) |

## Open notes carried into M2

- The demo's NVDA tax booking is a rough figure and does not match the tax report's estimate exactly.
- Discovery's footnote says "sourced live via your Worker" under the "Sample data" chip.

Both are wording or data polish and will be picked up when those views are touched in M2.

## Owner tasks

None blocked M2. P5-2.3 (fund holdings files) and P5-2.9 (HICP) add Worker routes, so users will need to redeploy their Worker; each fund issuer's terms will be listed in the P5-2.3 plan for the owner's OK before it is used.
