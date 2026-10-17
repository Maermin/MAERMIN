# Redesign R3 · Core views — milestone report

Phase 6, milestone R3 (PLAN.md). Screenshots are from the public demo (`?demo`, demo data only), in
`docs/screenshots/redesign-r3.1/` … `redesign-r3.6/`.

## Pull requests

| Package | PR | State |
|---|---|---|
| R3.1 Overview (B-4) | https://github.com/Maermin/MAERMIN/pull/206 | merged |
| R3.2 Portfolios and Net Worth | https://github.com/Maermin/MAERMIN/pull/207 | merged |
| R3.3 Transactions (B-5) | https://github.com/Maermin/MAERMIN/pull/208 | merged |
| R3.4 Import / Export (B-6) | https://github.com/Maermin/MAERMIN/pull/209 | merged |
| R3.5 Dividends | https://github.com/Maermin/MAERMIN/pull/210 | merged |
| R3.6 Tax & FIFO (B-7) | https://github.com/Maermin/MAERMIN/pull/211 | in review |

Every PR targets `main`. One that builds on an open PR says so, and its diff shrinks once the earlier one merges.

## What a user sees

- **Overview (B-4).**
  - The hero sits beside **"What it is made of"**: still invested + unrealised gain + cash = total.
  - Answer tiles, then **Next up**: the next five dated events, from local data only.
  - The **holdings map**: area = value, colour = return, always with ▲ / ▼.
  - The positions table has phone rows. The position dialog is a bottom sheet on phones.
  - Customize Overview has the three new sections; they can be hidden and reordered.
  - The view's own title, chips and "+ Add" are gone; the page header has them.
- **Portfolios and Net Worth.**
  - Portfolio cards with the portfolio's own colour.
  - The clearing account and depot switch are tidy checkboxes.
  - The Net Worth KPIs and composition use the shared look.
- **Transactions (B-5).**
  - Type chips with counts and a list grouped by month.
  - One **detail panel** beside the list, or a sheet on smaller screens. It shows the record, the **FIFO effect of a sale**, the tax bookings of that day, and Edit · **Duplicate** · Move to trash.
  - Rows no longer have their own edit and delete buttons.
- **Import / Export (B-6).**
  - Opens on **Broker import**.
  - The Overview's Import leads there; the paste dialog stays on `i` and the palette.
- **Dividends.** Expected income for 12 months and what arrived this year and last year come first. Names show next to symbols.
- **Tax & FIFO (B-7).**
  - **"Tax {year} at a glance"**: estimated tax, allowance used and left, loss pots carried forward, the next deadline.
  - It is built from the same report as the Report tab, its PDF and its Excel export.
- **Unchanged:** every calculation, stored key, import path, shortcut and deep link.

## Checks

- **Gate on each branch:** `npm run check` · 215 suites · build · `CI=1` e2e: **650 → 654 passed, 0 failed** (new B-6 checks on desktop and phone).
- **Contrast:** every R3 view in all five themes, **0 failures**. No sideways scroll at 390 px.
- **Bugs found on the way:**
  - `Table` dropped a row's own click handler.
  - Seven more accent-filled controls had white text on the High-contrast yellow.
  - The shared Chip count was dimmed to 3.55:1 in the light theme.
  - Two dead translation keys.
- **Lesson for the gate:** e2e also runs against the source files, so the tree stays untouched while a gate runs. One run had to be repeated because of this.

## Deviations and open items

- **Panels inside R3 views keep their inner layout.** Their colours have been tokens since R1.1; their tables and charts move with R4 (ChartFrame, Table):
  - broker wizard and the sync panels;
  - dividend calendar, forecast, history and quality;
  - real assets and projection;
  - the tax tabs and their panels.
- **Saved Customize layouts:** for people who saved a layout before, the three B-4 sections are appended at the end, visible. They can move them.
- **Duplicate** dates the copy today (the common case for a repeat buy); the date stays editable in the dialog.
- **Same-day tax bookings:** the record has no link to its tax bookings, so the detail panel shows the tax bookings of the same day and portfolio as a lead. It does not claim a link.

## Next: R4 Analysis views — plans for your approval

No behaviour change in R4 (B-1 … B-8 are all done). All six packages:
- one PR each, base `main`;
- every chart on `ChartFrame` with a word legend and "Show as table";
- every table on `Table` with phone rows;
- each view's header, pill rows and buttons on the shared components;
- diverging scales for heatmap, correlation and treemap; a waterfall for attribution; the categorical palette for allocation (`DESIGN-SYSTEM.md` § 6);
- e2e selectors updated in the same PR;
- before/after screenshots desktop + phone, dark + light, DE + EN;
- a contrast scan in all five themes;
- no calculation or storage change.

| Package | Branch | Views |
|---|---|---|
| R4.1 Returns | `redesign/r4.1-returns` | Returns & XIRR, Performance, Attribution: return tiles on Stat, the monthly heatmap with a diverging scale and its drill-down, value attribution as a waterfall, benchmark replay, per-holding returns, real returns, performance map, period cards, FX attribution |
| R4.2 Health & risk | `redesign/r4.2-health` | Health score, Portfolio intelligence, Risk & Correlation (correlation matrix with a diverging scale, Monte Carlo, stress test, risk), ETF look-through, risk monitor |
| R4.3 Research, Strategy, Fees | `redesign/r4.3-research` | Research, Strategy (DCA, sectors, countries, currencies, size, providers & brokers, taxonomies, liquidity, goals, backtester), Fee analyzer |
| R4.4 Market views | `redesign/r4.4-market` | Discovery, News, Events (the list grouped by month), Watchlist |
| R4.5 Planning and cash | `redesign/r4.5-planning` | Rebalancing, Budget, Cash flow (+ investment calendar), Journal, Savings plans, simulators and projection |
| R4.6 Remaining panels and dialogs | `redesign/r4.6-panels` | Corporate actions, bonds, options, real-asset templates, share snapshot, AI prompt, verdicts, trust and disclaimer blocks; the panels R3 left inside its views (broker wizard and sync panels, dividend panels, tax tabs) |

**Recommendation:** approve the R4 plans as listed. They change look and layout only. Each PR lists its views and shows before / after.
