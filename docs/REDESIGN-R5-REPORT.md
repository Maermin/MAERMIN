# Redesign R5 · Polish & release — milestone report and Phase 6 final report

Phase 6, milestone R5 (PLAN.md), and the close of Phase 6. Screenshots are from the public demo (`?demo`, demo data
only), in `docs/screenshots/redesign-r5.1/` … `redesign-r5.4b/`; the README pictures are in
`docs/screenshots/atlas-map/`.

## Pull requests (R5)

| Package | PR | State |
|---|---|---|
| R5.1 part 1 · Settings views | https://github.com/Maermin/MAERMIN/pull/220 | merged |
| R5.1 part 2 · Settings dialogs | https://github.com/Maermin/MAERMIN/pull/221 | merged |
| R5.1 part 3 · Transaction dialog and pickers | https://github.com/Maermin/MAERMIN/pull/222 | merged |
| R5.2 States and motion | https://github.com/Maermin/MAERMIN/pull/223 | merged |
| R5.3 Accessibility and phone pass | https://github.com/Maermin/MAERMIN/pull/224 | merged |
| R5.4 part 1 · renderer.js | https://github.com/Maermin/MAERMIN/pull/225 | merged |
| R5.4 part 2 · Remaining view files | https://github.com/Maermin/MAERMIN/pull/226 | merged |
| R5.4 part 3 · Cleanup and release | PR_R54C | in review |

R5.1 and R5.4 were split into three PRs each so that each diff stays reviewable. The plan listed each as one package.

## What a user sees (R5)

- **Settings (R5.1).**
  - Customize, Categories, Tags, Rules, Trash and the backup page use the shared cards, fields and tables.
  - API Settings, Security & sync, the recovery code, password, security log, confirm, sync and push panels and the onboarding wizard use the shared dialog.
  - The transaction dialog uses chips for type, category and currency. The symbol and CS2 skin pickers share one list look.
- **States and motion (R5.2).**
  - Every card that loads shows a spinner with a status.
  - A failed card says what failed and offers Retry. An empty card says what to do next.
  - On phones, dialogs open as bottom sheets.
  - Motion follows `prefers-reduced-motion` and the motion switch. `npm run bench:motion` stayed within noise.
- **Accessibility and phone (R5.3).**
  - Headings follow the page outline: one h1 per page, a card title is h2 and a section inside it is h3.
  - Date fields show the focus ring.
  - On phones, clickable rows, heatmap cells and the calendar grid are at least 44 px.
- **Cleanup (R5.4).**
  - Ad-hoc inline styles moved onto classes in every view file.
  - The unused dashboard KPI strip was removed.
  - The old header, sidebar, bottom nav and sidebar glider were removed (CSS and code).
  - The README has new pictures.
  - RELEASE.md has the redesign entry.
- **Unchanged:** every calculation, stored key, import path, shortcut and deep link.

## Phase 6 in figures

| Measure | Phase 0 audit | Now |
|---|---|---|
| Inline `style:` props in the browser JS | 3,004 | 79. The ones left are computed: bar and meter widths, data and category colours, chart geometry, tree indent, logo sizes, plus non-CSS options |
| Hex colour literals (colour check) | 809 hex + 225 `rgba(` | 197 hex / `rgb()` in 28 files. Most of these are stored colours (taxonomy, portfolio, broker logos) and theme previews |
| `styles.css` | — | 437 lines of dead rules removed in R5.4 part 3; 32 unused classes and 5 unused keyframes |
| Shared components | none (Overlay, Confirm, Toast, EmptyState only) | Button, IconButton, Card, Heading, Stat, Badge, Chip, ToneChip, Segmented, Input, Select, Modal / Sheet, EmptyState (loading / empty / error), Skeleton, Table with phone rows, ChartFrame, Rail, PageHeader, Dock |
| Text below WCAG AA (15 views sampled per theme) | Dark 0, Light 0, Purple 5, Contrast 229, Colour-blind 245 | 0 in all five themes on every view checked |
| e2e | 658 | 658 passed, 0 failed on every Phase 6 PR |

**Milestones:** R0 (audit, three directions, plan), then:
- R1: tokens and components, #198–#200.
- R2: shell and navigation, #203–#205.
- R3: core views, #206–#211.
- R4: analysis views, panels and dialogs, #212–#219.
- R5: polish and release, #220–#226 and this one.

Reports: `docs/REDESIGN-R1-REPORT.md` … `docs/REDESIGN-R5-REPORT.md`.

## Checks (R5)

- **Gate on each branch:** `npm run check`, 215 suites, build, then `CI=1` e2e: **658 passed, 0 failed** on every R5 PR.
- **Contrast:** each package's views in all five themes (white, dark, purple, high contrast, colour-blind safe): **0 failures**.
- **R5.3 sweep:** all 32 views clean on names, heading order and duplicate ids, with no sideways scroll at 360 px (German) or at 200 % zoom.
- **R5.4 part 3:**
  - A scan of `styles.css` against every source file found 32 classes that nothing uses. Their rules were removed.
  - 17 classes whose names are built at run time stay, for example `tone-` + tone and `ui-btn--` + size.

## Deviations and open items

- **NVDA pass not done.** No screen reader was available to the agent. The structure is there for it: roles, names, live regions, heading order. One point to listen for: whether toasts are announced once.
- **The 79 computed inline styles stay.** They hold values that change with the data. A class can't hold them.
- **Stored colours stay hex:** taxonomy node colours and portfolio colours are user data.
- **`MaerminUI.btnProps` / `pillProps`** (`.mx-btn`, `.mx-pill`) still serve the empty-state action buttons and the value chart period pills. They are on tokens and look like the shared buttons.
- **Research and Budget** are empty in the public demo without a Worker or a bank import, so the README shows Returns, Tax, Dividends and Events instead.

## Recommendation

Merge this PR. Phase 6 is then complete. A version number for the release (for example v12.1) is your call. The entry sits under "Unreleased" in RELEASE.md.
