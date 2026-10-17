# Redesign R2 · Shell & navigation — milestone report

Phase 6, milestone R2 (PLAN.md). Screenshots are from the public demo (`?demo`, demo data only), in
`docs/screenshots/redesign-r2.1/`, `redesign-r2.2/` and `redesign-r2.3/`.

## Pull requests

| Package | PR | State |
|---|---|---|
| R2.1 App shell (B-1, B-2) | https://github.com/Maermin/MAERMIN/pull/203 | merged (#202 had been merged into the R1.3 branch only) |
| R2.2 Page tabs, section switches, palette (B-3) | https://github.com/Maermin/MAERMIN/pull/204 | in review, base main |
| R2.3 Lock screen, demo banner | https://github.com/Maermin/MAERMIN/pull/205 | in review, base main, contains #204 |

From now on every PR targets `main`. A PR that builds on an open one says so, and its diff shrinks once the earlier
one merges. That avoids the stale-base merges that happened with #199 and #202.

## What a user sees

- **A new frame on every screen (R2.1).**
  - Desktop: an 84 px rail with Home · Activity · Income · Tax · Insight and Settings at the foot.
  - Above each view, a page header:
    - the view title;
    - a portfolio scope (the same setting as the Overview chips);
    - Search ⌘K, privacy, the settings menu and Add Transaction;
    - the area's views as tabs under the title.
- **Phone (R2.1).** A top bar and a floating dock: Home · Activity · [+] · Income · More. "More" opens a sheet with
  Tax, Insight and Settings. [+] opens the transaction dialog.
- **One row of tabs (R2.2).** The second and third rows of pills are gone:
  - Returns / Performance / Attribution and Health / Intelligence / Risk are a segmented control.
  - Import / Export, Dividends, Tax, Risk & Correlation and Strategy use a segmented control on desktop.
  - On phones they use a single select when there are more than three sections.
- **Command palette and shortcuts (R2.2).** Both are on the tokens. The palette is a proper combobox for screen
  readers.
- **Lock screen (R2.3).** Flat, on the tokens, and in the theme you chose (it was always dark).
- **Demo mode (R2.3).** One slim banner on every view with one "Exit demo".
- **Unchanged.** View ids, `g`+key shortcuts, deep links, the palette commands, Simple / Advanced and everything
  stored. No calculation changed.

| Screenshot | Shows |
|---|---|
| `redesign-r2.1/after-dark-overview.jpg`, `after-white-de-overview.jpg` | Rail + page header, desktop EN / DE |
| `redesign-r2.1/after-phone-dark-overview.jpg`, `after-phone-white-de-returns.jpg` | Phone top bar + dock |
| `redesign-r2.1/after-contrast-returns.jpg` | High contrast |
| `redesign-r2.2/after-dark-returns.jpg`, `after-dark-tax.jpg`, `after-phone-white-de-investment-analysis.jpg` | One tab row, segmented control, phone select |
| `redesign-r2.3/lock-*.jpg`, `demo-banner-*.jpg` | Lock screen in five themes, the demo banner |

## Checks

- **Gate on each branch:** `npm run check` · 215 suites · build · `CI=1` e2e, **650 passed, 0 failed** on R2.1,
  R2.2 and R2.3.
- **New e2e checks:**
  - the rail labels, and all six areas in view at 1440 × 900;
  - the phone dock slots, More → Insight, and [+] opening the dialog;
  - exactly one tablist per screen;
  - the Strategy sections walked through the phone select.
- **Contrast:**
  - 18 views × 5 themes after R2.1: 0 failures, and every Tab stop shows the focus ring;
  - the R2.2 views and the R2.3 lock screen: 0 failures;
  - no sideways scroll at 360 / 390 px.

## Deviations and open items

- **No back arrow in the header (R2.2).** There is no in-page detail route before R3's list–detail pattern; dialogs
  and sheets have Close.
- **Onboarding wizard layout (R2.3)** stays until R3. Its colours have been tokens since R1.1.
- **Simple / Advanced switch** stays in the settings menu and the header's "Show all tools" hint. It does not fit the
  84 px rail legibly in German.
- **Duplicate actions until R3.** The views still have their own headers and buttons, so some actions show twice
  (e.g. "+ Add" in the Overview).
- **Old CSS.** `.mx-header`, `.maermin-sidebar`, `.mx-bottom-nav` and `MobileBottomNav` are no longer rendered;
  R5.4 removes them.

## Next: R3 Core views — needs your approval

R3 contains four behaviour changes from PLAN Phase 6. Each needs your explicit yes:

| | Change | Package |
|---|---|---|
| **B-4** | The Overview gets "What it's made of" (invested + unrealised gain + cash = net worth), "Next up" (the next five events) and the holdings map; all three are Customize Overview sections that can be hidden. | R3.1 |
| **B-5** | Transactions on desktop: a detail panel beside a month-grouped list with type chips, instead of icon buttons in every row; on phones the detail opens as a sheet. | R3.3 |
| **B-6** | Import / Export opens on **Import** (Broker import) instead of Export & Backup; the Overview's "Import" goes there too. | R3.4 |
| **B-7** | Tax & FIFO opens on an answer summary (tax due, allowance used / left, loss pots, next deadline) above the existing tabs. | R3.6 |

### Package plans

All six packages:
- one PR each, base `main`;
- each view's own header, buttons and pill rows move onto the shared components (this also removes the duplicates
  above);
- tables become `Table` with phone rows;
- charts sit in `ChartFrame` with "Show as table";
- e2e selectors are updated in the same PR;
- before/after screenshots desktop + phone, dark + light, DE + EN;
- a contrast scan in five themes;
- no calculation or storage change.

| Package | Branch | Views | Behaviour change |
|---|---|---|---|
| R3.1 Overview | `redesign/r3.1-overview` | hero + composition, answer tiles, Next up, holdings map, positions Table, position detail dialog on Modal + ChartFrame, Customize Overview sections | B-4 |
| R3.2 Portfolios and Net Worth | `redesign/r3.2-portfolios` | portfolio cards, clearing-account form, net worth composition, accounts, real assets, projection | none |
| R3.3 Transactions | `redesign/r3.3-transactions` | month-grouped list, type chips, detail panel / sheet, add / edit dialog on Inputs, data check and reconciliation | B-5 |
| R3.4 Import / Export | `redesign/r3.4-import` | Import first, wizard steps, every import and sync panel | B-6 |
| R3.5 Dividends | `redesign/r3.5-dividends` | year total as the answer, calendar / forecast / history tables with phone rows, names next to symbols | none |
| R3.6 Tax & FIFO | `redesign/r3.6-tax` | answer summary, then the tabs and every panel on Card / Table / Input | B-7 |

**Recommendation:** approve B-4 to B-7 as planned. They are the main reasons for the redesign (answers first,
common task first), and none of them hides a feature: B-4's sections can be switched off in Customize Overview, and
B-5 to B-7 keep every existing tab and action.
