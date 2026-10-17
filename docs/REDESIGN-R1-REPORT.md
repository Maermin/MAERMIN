# Redesign R1 · Foundation — milestone report

Phase 6, milestone R1 (PLAN.md). Screenshots are from the public demo (`?demo`, demo data only), in
`docs/screenshots/redesign-r1.1/`, `redesign-r1.2/` and `redesign-r1.3/`.

## Pull requests

| Package | PR | State |
|---|---|---|
| R0 Audit, directions, plan | https://github.com/Maermin/MAERMIN/pull/197 | merged |
| R1.1 Tokens and token bridge | https://github.com/Maermin/MAERMIN/pull/198 | merged |
| R1.2 Components A + gallery | https://github.com/Maermin/MAERMIN/pull/199 | merged into the R1.1 branch after #198 had landed, so it reaches main with #200 |
| R1.3 Components B (+ R1.2) | https://github.com/Maermin/MAERMIN/pull/200 | in review, base main |
| (outside the redesign) Returns "Current value" with All portfolios | https://github.com/Maermin/MAERMIN/pull/196 | merged |

## What a user sees

- **A new global look in every view (R1.1).** The Atlas Map palette in all five themes, a flat background instead of
  the aurora gradients, flat primary buttons, one focus ring. Layout, sizes and copy are unchanged.
- **Readable High contrast and Colour-blind themes.** The text-contrast scan of 18 views per theme now finds 0
  failures in every theme (Phase 0 audit: 229 in High contrast, 245 in Colour-blind, 5 in Nebula). High contrast uses
  a yellow accent with black text.
- **Empty states and toasts** in the new card look (R1.3).
- **Nothing else moves yet.** The shared components (R1.2, R1.3) are only on the hidden review page `?gallery`; the
  views adopt them from R2 on.

| Screenshot | Shows |
|---|---|
| `redesign-r1.1/before-dark-overview.jpg` → `after-dark-overview.jpg` | Overview, desktop dark (EN), before / after |
| `redesign-r1.1/before-white-overview.jpg` → `after-white-overview.jpg` | Overview, desktop light, before (EN) / after (DE) |
| `redesign-r1.1/after-phone-dark.jpg`, `after-phone-white.jpg` | Overview, phone 390 px, dark and light (DE) |
| `redesign-r1.1/after-purple-overview.jpg`, `after-contrast-overview.jpg`, `after-cb-overview.jpg` | Nebula, High contrast, Colour-blind |
| `redesign-r1.2/gallery-*.jpg`, `redesign-r1.3/gallery-*.jpg` | Component gallery in all themes, desktop and 360 / 390 px |

## Engineering state

- Colour comes only from the tokens in `styles.css`; the theme objects are `var()` references; `MaerminTokens`
  resolves values for colour maths. A guard in `npm run check` stops new hex / `rgb()` literals: 907 left in 81 files,
  to go to 0 in view code by R5.
- `window.MaerminComponents`: Button, IconButton, Card, Stat, Badge, Chip, ToneChip, PageTabs, Segmented, Input,
  Select, Mask, Table (with phone rows), Modal / Sheet, Skeleton, ChartFrame, EmptyState, `toneOf`, `useNarrow`.
  33 Node checks, e2e in all five themes and at 360 px.
- Gate on every branch: `npm run check`, 215 suites, build, `CI=1` e2e (650 checks on R1.3).

## Open issues

- #200 targets main and carries R1.2 and R1.3; R2 branches stack on it until it merges.
- The final mockups in `docs/redesign/final/` use the first light money tones; `docs/DESIGN-SYSTEM.md` is the
  contract and has the slightly darker values R1.1 needed for badges on tints.
- `MaerminUI.btnProps` / `pillProps` (`.mx-btn`, `.mx-pill`) are not restyled yet; they move with the views (R3/R4).
- The component gallery is English-only and outside the i18n guard (developer page).

## Next: R2 Shell & navigation

R2 changes what every screen's frame looks like, and three of its changes are behaviour changes from PLAN Phase 6
that you approved on 2026-10-17 ("start"): **B-1** (area labels Home / Activity / Income / Tax / Insight; Settings at the foot of
the rail and in "More" on phones), **B-2** (phone dock Overview · Activity · Add · Income · More), **B-3** (at most one
row of page tabs; inner tab rows become a segmented control or a select).

### R2.1 App shell — `redesign/r2.1-shell`

- **Views / files:** the shell of every view: `renderer.js` (header, sidebar → rail, main, area nav), `features2.js`
  `MobileBottomNav` → dock, `nav-model.js` (labels B-1, area icons, a `more` list for the phone), `icons.js` (rail
  icons), `styles.css` (`.ui-rail`, `.ui-pagehead`, `.ui-dock`, `.ui-topbar`); old `.maermin-sidebar` / `.mx-header`
  rules removed in R5.4.
- **Components:** PageTabs, Segmented, IconButton, Button, Mask (R1); new `Rail`, `PageHeader`, `Dock`, `TopBar` in
  `MaerminComponents`.
- **What changes:** desktop: an 84 px labelled rail (five areas + Settings) instead of the 28-entry sidebar; a page
  header per view with title, portfolio scope, search, privacy toggle and the view's one primary action; the area's
  views as page tabs under the title. Phone: a top bar (logo, scope, search, privacy) and a floating dock with a
  central Add. View ids, aliases, `g`+key shortcuts, deep links and the command palette stay as they are.
- **Keeps working:** the e2e helpers `openView` / `isOpen` move from `nav.maermin-sidebar [data-view]` to the rail +
  page tabs (`data-view` / `data-tab` kept on the new buttons).
- **Translation keys:** `navAreaHome`, `navAreaActivity`, `navAreaIncome`, `navAreaInsight`, `navMore`, `navAdd`,
  `scopeAllPortfolios`, plus short labels; en and de.
- **Behaviour changes:** B-1, B-2 (approved). Nothing stored changes (`maermin_ui_mode`, `maermin_active_view`
  keep their values).

### R2.2 Page tabs, palette, back — `redesign/r2.2-tabs-palette`

- Every grouped view and every inner tab row on PageTabs / Segmented: Risk & Correlation (4 inner tabs →
  Segmented), Strategy (9 → a select on phones, Segmented on desktop), Import / Export (4 → page tabs of the
  Activity area or Segmented), Dividends (3 → Segmented), Tax (3 → Segmented under the summary that R3.6 adds).
- Command palette and shortcuts dialog on Modal / tokens; a back arrow in the page header inside a detail or sheet
  on phones.
- **Behaviour change:** B-3 (approved). Keys: `uiBack` and section labels where missing.

### R2.3 First run and modes — `redesign/r2.3-first-run`

- `auth.js` lock / setup screens, recovery-code reveal, `onboarding.js` first-run wizard, the demo banner (one
  "Exit demo" instead of two), the Simple / Advanced switch (moves into the rail foot and Settings), all on R1
  components and tokens; lock-screen CSS (`#maermin-auth`) moves onto tokens (it is outside React).
- No behaviour change beyond the single Exit demo button (same action). Keys only if wording changes (checked with
  `design:ux-copy`, en + de).

All three: no data, storage key or calculation changes; e2e selectors updated in the same PR; before/after screenshots
desktop + phone, dark + light, DE + EN; contrast scan in all five themes.
