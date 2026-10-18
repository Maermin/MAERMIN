# Redesign R4 · Analysis views — milestone report

Phase 6, milestone R4 (PLAN.md). Screenshots are from the public demo (`?demo`, demo data only; a sample bond,
option and property were added in memory for R4.6), in `docs/screenshots/redesign-r4.1/` … `redesign-r4.6c/`.

## Pull requests

| Package | PR | State |
|---|---|---|
| R4.1 Returns | https://github.com/Maermin/MAERMIN/pull/212 | merged |
| R4.2 Health & risk | https://github.com/Maermin/MAERMIN/pull/213 | merged |
| R4.3 Research, Strategy, Fees | https://github.com/Maermin/MAERMIN/pull/214 | merged |
| R4.4 Market views | https://github.com/Maermin/MAERMIN/pull/215 | merged |
| R4.5 Planning and cash | https://github.com/Maermin/MAERMIN/pull/216 | merged |
| R4.6 part 1 · dialogs and panels | https://github.com/Maermin/MAERMIN/pull/217 | merged |
| R4.6 part 2 · dividend panels and tax tabs | https://github.com/Maermin/MAERMIN/pull/218 | in review |
| R4.6 part 3 · broker wizard and sync panels | https://github.com/Maermin/MAERMIN/pull/219 | in review (builds on #218) |

Every PR targets `main`. R4.6 was split into three PRs because of its size (about 1,600 inline styles across
30 files); the plan listed it as one package.

## What a user sees

- **Returns, Performance, Attribution (R4.1).** Return tiles on Stat; the monthly heatmap on the theme's gain / loss
  scale with a word legend and its drill-down; profit by source and the attribution as waterfalls; the holdings map
  (area = weight, colour = move, always ▲ / ▼); benchmark, FX and per-holding returns on the shared table look.
- **Health and risk (R4.2).** Score ring and sub-score meters; advisor and intelligence on one findings list
  (mark + severity in words); the correlation matrix on a diverging scale with the figure in every cell; Monte Carlo,
  stress test and risk level on the shared tiles, tables and badges.
- **Research, Strategy, Fees (R4.3).** The price chart on ChartFrame with range and indicator controls; every Strategy
  section on Card, Stat tiles and the chart palette; the fee analyzer as answer tiles and meters.
- **Market views (R4.4).** Discovery on the sortable Table with phone rows; news and events as one Card each, events
  grouped by month; the watchlist with a named one-click remove.
- **Planning and cash (R4.5).** Rebalancing, Budget (signed tiles, Sankey on the chart palette), Cash flow on
  ChartFrame, Journal, Savings plans (plans first, the form on the shared Modal), the wealth projection, the simulator
  and the backtester.
- **Dialogs and panels (R4.6 part 1).** The position dialog (figures, history, journal, splits and other corporate
  actions), bonds, options, real assets and their templates, Share & Compare, Privacy with the AI summary.
- **Dividends and tax (R4.6 part 2).** The dividend calendar, forecast, history, quality, yield on cost and earnings;
  the Tax Report toolbar and data checks, all 17 report panels, FIFO, Realized vs Unrealized and harvesting.
- **Import and sync (R4.6 part 3).** The broker import wizard (steps, source tiles, mapping, ISIN → ticker, preview),
  exchange sync, crypto wallets, bank sync, aggregators, the Steam import and the reconciliation box.
- **Everywhere.** Every chart touched has a word legend and, where it has data points, "Show as table". Every gain or
  loss colour comes with a sign, ▲ / ▼, ✓ / ! or words. Panels share one Card, one table look, one set of fields and
  buttons, so all five themes apply to them without hand-picked colours.
- **Unchanged:** every calculation, stored key, import path, shortcut and deep link.

## Checks

- **Gate on each branch:** `npm run check` · 215 suites · build · `CI=1` e2e **658 passed, 0 failed** on every R4 PR.
- **Contrast:** each package's views in all five themes (white, dark, purple, high contrast, colour-blind safe):
  **0 failures**. No sideways scroll at 360 px in German.
- **Colour literals:** 358 hex / rgb() literals left in 36 files (847 at the start of Phase 6; 515 → 358 in R4.5–R4.6
  alone). Most of the rest are stored data (taxonomy and portfolio colours, broker logos) or the files R5 covers.
- **Bugs found on the way:**
  - The trust disclaimer tint never showed since R1.1 (R4.2).
  - Two unit tests could fail at random: they searched a JSON string for a substring a random id could contain (R4.4,
    fixed in #216).
  - A `Segmented` with a value outside its options checked the first option (R4.5).

## Deviations and open items

- **Tables that keep their own markup.** Where e2e checks read cell attributes, or a row opens an editor under it
  (bonds, dividend quality, FIFO, tax certificate), the table keeps its own rows on the shared `.ui-table` look and
  scrolls sideways on phones instead of becoming phone rows.
- **Stored colours stay hex:** taxonomy node colours and portfolio colours are user data.
- **Left for R5:** the transaction dialog's own fields (the bond fields inside it use the shared inputs already), the
  Settings views and modals (Customize, Categories, Tags, Rules, Trash, API Settings, Security & sync, the audit log,
  onboarding), the symbol and CS2 skin pickers. 809 inline `style:` props remain in all; many are computed sizes
  (bar widths, chart heights), which stay.
- **R4.6 in three PRs** instead of one, for reviewable diffs.

## Next: R5 Polish & release — plans for your approval

No behaviour change in R5. One PR each, base `main`, the same gate, before / after screenshots desktop + phone,
dark + light, DE + EN, and a contrast scan in all five themes.

| Package | Branch | Scope |
|---|---|---|
| R5.1 Settings | `redesign/r5.1-settings` | Customize, Categories, Tags, Rules, Trash, Privacy (done in R4.6), the account menu, API Settings, Security & sync, Design (theme picker), password and recovery dialogs, the audit log, onboarding; the transaction dialog's fields and the symbol / skin pickers |
| R5.2 States and motion | `redesign/r5.2-states` | every view: empty / loading / error states on the shared components, skeletons, a motion pass (`prefers-reduced-motion`, `npm run bench:motion` within today's budget) |
| R5.3 Accessibility and phone pass | `redesign/r5.3-a11y` | all views × five themes: an accessibility review, an NVDA pass, 200 % zoom, a 360 px pass, fixes |
| R5.4 Cleanup and release | `redesign/r5.4-release` | remove unused CSS and the remaining ad-hoc inline styles (computed sizes stay), README screenshots and the demo, a RELEASE.md redesign entry |

**Recommendation:** merge #218 and the part 3 PR, then approve the R5 plans as listed. They change look and layout
only. Each PR lists its views and shows before / after.
