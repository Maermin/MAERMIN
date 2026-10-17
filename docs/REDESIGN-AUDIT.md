# MAERMIN redesign — Phase 0 audit

Audit of `main` @ `efc1609` (v12.0.0 "Atlas", after the 2026-10-16 cleanup run #181–#195), 2026-10-17.
Input for the visual and UX redesign (Phase 6, see the redesign brief). No code was changed.

## Method

- **App:** production build (`npm run build:web`), public demo (`dist/index.html?demo`, in-memory storage, the
  demo book: 2 portfolios, 31 open positions, 224 transactions in the list, 332 in the database). Offline: React from
  `node_modules`, every other external request aborted, as in `test/e2e/app.e2e.mjs`.
- **Coverage:** all 32 views in `nav-model.js`, each opened directly. Five passes: desktop 1440 × 900 dark EN, desktop
  1440 light (`white`) DE, phone 390 × 844 dark DE, phone 390 light EN, phone 360 dark DE (overflow check), all in
  Advanced mode; Simple mode on desktop and phone for Overview, Returns and Tax; all five themes on 15 views.
  Screenshots: [`docs/screenshots/redesign-before/`](screenshots/redesign-before/) (demo data only).
- **Measured in the page** (scripted, per view): horizontal overflow, distinct font sizes and corner radii in `main`,
  buttons and tables, interactive targets under 44 px, text contrast against the composited background (WCAG 1.4.3;
  gradients and images are not resolved, so filled gradient buttons need a manual check), and the first 20 Tab stops for
  a visible focus indicator.
- **Read in the code:** `styles.css`, the theme objects in `renderer.js`, `ui-store.js` (shared Overlay, Confirm, Toast,
  EmptyState, `btnProps`, `pillProps`), `nav-model.js`, and counts across all UI files.
- **Skills:** `design:design-critique` (framework below: first impression, usability, hierarchy, consistency,
  accessibility) and `design:accessibility-review` (WCAG 2.1 AA, one pass per theme).

What works today and must survive the redesign: zero page errors in every view and config; no horizontal page scroll
at 360 px in any view; complete German UI; correct German number formats (`24.100,75 €`); a visible focus indicator
on every one of the 300 Tab stops sampled per theme; the Dark theme passes AA text contrast on all 15 views sampled;
the information is rich and correct-looking, with plain-language sub-labels on most KPIs.

---

## Executive summary

MAERMIN looks like a consistent dark fintech app at first glance, and it is deeper than any competitor in tax and
risk. What keeps it from looking like a product a stranger trusts with their wealth:

1. **No hierarchy on the core screens.** Overview opens with a demo banner, six header buttons and a portfolio chip
   row before the number the user came for; then 12 KPI cards of equal weight. On a phone the total value starts at
   y ≈ 680 px of 844 px.
2. **No design system in the code.** About 3,000 inline `style` objects; 12 corner radii (`3px` … `22px`, `50%`,
   `999px`), 183 distinct padding values, 12 gap values, 10–14 font sizes per view; 275 hand-built buttons and 50
   hand-built tables, only 5 using the shared `pillProps` and 3 `btnProps`; 809 hex literals in UI files (including the
   theme objects and chart palettes).
3. **Tables are not built for money.** Transactions is one flat list of 224 rows (15,000 px tall on desktop, 51,000 px
   on a phone), ISO dates in both languages, two icon buttons per row, no filters by type, no month grouping. Wide tables
   (FIFO, fees, correlation) are clipped inside their cards on phones.
4. **Navigation is wide and deep.** 28 sidebar entries in Advanced mode need scrolling at 900 px (sidebar 1,504 px tall);
   on phones a view can stack three rows of tabs (area chips → group tabs → inner tabs, e.g. Risk & Correlation).
5. **Colour meaning leaks.** Zero is painted as a gain or a loss (`+0.00 €` green in FIFO, `0,00 €` green/red in Budget,
   `0.00 €` red in Savings plans); fees are red like losses; the value-over-time line in Cash Flow is green like a gain;
   the treemap is grey with one saturated tile; the correlation matrix is one flat orange.
6. **Accessibility gaps in three themes.** In Contrast, Color-blind and Nebula the selected-pill style (white on the
   bright accent) is 3.3–3.7 : 1 and the per-row edit button 3.9–4.2 : 1. Phone touch targets: chips and tabs 32–37 px,
   row actions 27–33 px, calendar cells 14 × 28 px.

Also found (not a design issue, reported to the owner separately): with "All portfolios", **Analysis → Returns shows
"Current value" 162,362.68 €, the Main depot alone**; the Savings plan broker's 14,393.98 € is missing, so Returns
shows XIRR 20.29 % / TWR 90.89 % while the Overview shows 19.63 % / 87.22 % for the same book. Engines are out of scope
for the redesign; this needs its own fix.

---

## The five most common tasks

Clicks from a cold start (Overview open), desktop / phone. "Scroll" = the target is below the first screen.

| Task | Desktop | Phone | What gets in the way |
|---|---|---|---|
| See net worth | 1 (sidebar → Net Worth) | 2 (Portfolio dock → chip, scroll chips) | Overview's big number is the *portfolio* value (176,756.66 €); net worth (178,556.70 €) is a sub-label of the cash card ("Total incl. cash"). Two "totals" with no explanation of the difference. |
| Add a transaction | 1 ("+ Add" in the Overview header) | 1 + scroll | "+ Add" is one of six header buttons of similar weight; on Transactions it is called "+ Add Transaction". No global add on the phone dock. |
| Import a statement | 2 (Import / Export → "Broker Import" tab) | 3 + scroll | Import / Export opens on "Export & Backup"; the import the user came for is the third tab. The Overview's "↑ Import" goes to the same default tab. |
| Check dividends | 1 | 1 | Calendar first; the yearly total is a 12 px sub-line ("Year 2026: 1,404.15 €"); the upcoming list repeats symbols without names; amounts in USD next to EUR totals. |
| See tax | 1 (sidebar, under the fold before P5-1.1; now visible) | 1 | Opens on "FIFO Cost Basis", a 31-row table of mostly `+0.00 €`. The question "what do I owe / what is left of my allowance" sits on the second tab (Tax Report). |

---

## Per view

Goal = what the user is trying to do there. Issues are ordered by impact. "All" = applies in every theme and
language unless stated.

### Portfolio

| View | Goal | What gets in the way |
|---|---|---|
| **Overview** (`overview`) | How much do I have, did it go up, what should I look at? | Demo banner + six header buttons ("Demo", FX chip, "Exit demo", "+ Add", "↑ Import", "Refresh prices") + portfolio chips above the hero; "Exit demo" appears twice. Hero number is good (large, split decimals) but the change pill ("+5,740.17 € +3.67 % in 1M") is small. 5 + 7 KPI cards of equal weight in two grids with different column counts (5 then 4 + 3, leaving a gap). Positions table (31 rows) has two decimal styles for quantity (`0.29` / `143.4469`), letter tiles in category colours that repeat the symbol. Phone: 10,142 px tall, hero below the first screen, one KPI per row. |
| **Portfolios** (`portfolios`) | Manage depots, see each one's value. | Cards of unequal height; the clearing-account opening-balance form is inline in the card (date input shows `mm/dd/yyyy` in the EN demo); "All portfolios" card uses a dashed border unlike every other card; colour dots for the new portfolio are 24 px with no label. |
| **Net Worth** (`net-worth`) | Total wealth incl. accounts and debts. | Four KPIs, three of them `0.00 €` in the demo; "Investment portfolio 100 %" badge; composition bar is a single solid bar (no other assets); projection chart with three lines in green / violet / red, so "conservative" reads as a loss. |
| **Budget** (`budget`, Adv.) | Spending vs income this month. | Empty in the demo; zero KPIs painted green and red; rules form shows before any booking exists. |
| **Watchlist** (`watchlist`) | Track symbols I don't hold. | Empty state is a lone spinner-like circle and one line; the add form has four fields in one row, the type select between symbol and target. |
| **Events** (`events`) | What happens next for my holdings. | Seven filter pills all styled as selected (no visible off state); a Worker warning in amber text above the list; month cards fine; amounts "About 21.85 $" with the symbol after the number in EN. |
| **Rebalancing** (`rebalancing`, Adv.) | Bring allocation back to target. | Good empty state with two actions, but the page is 80 % empty; "Rebalance by tag instead — Tags view" chip looks like a filter. |

### Transactions

| View | Goal | What gets in the way |
|---|---|---|
| **Transactions** (`transactions`) | Find, check, add or fix a booking. | One flat list of 224 rows, no pagination, grouping or type filter (only search + sort); ISO dates (`2026-08-17`) in EN and DE; symbol without name; currency in its own grey column; two icon buttons per row (448 buttons, edit button below AA in Contrast / Color-blind); type badges in a fixed palette. Phone: one 160 px card per booking (51,251 px page), row actions 27–33 px. |
| **Savings Plans** (`savings-plans`) | Set up and check recurring buys. | Empty state + a projection card that belongs to Net Worth; `0,00 €` in red for debt service. |
| **Import / Export** (`data`) | Bring data in, back it up. | Title "Data Management"; opens on Export & Backup; four tabs (Export & Backup, Manual Import, Broker Import, Steam inventory) styled as a segmented control unlike the area tabs; the primary "JSON Backup — full restore" button holds two text styles. |
| **Cash Flow** (`cashflow`, Adv.) | Money in vs value over time. | Chart axis labels unformatted (`166,906.93`, ISO dates); value line in success-green; investment calendar cells 14 × 28 px on phones; KPI "0 months" current streak dominates. |
| **Journal** (`journal`, Adv.) | Notes per position. | 30 identical empty cards ("+ Add note…") — 1,590 px of empty boxes; no way to see only positions with notes. |

### Dividends and Taxes

| View | Goal | What gets in the way |
|---|---|---|
| **Dividends** (`dividends`) | Income this year, what's coming. | Header row holds tabs + two actions + an "Auto-book" checkbox; yearly total as a 12 px sub-line; calendar cells mostly empty, the payments are 10 px chips; upcoming list repeats "PG 10/29/2026 +24.44 $" without names, in USD only. Phone: 7,242 px. |
| **Tax & FIFO** (`tax`) | What do I owe / what's left of my allowance; documents. | Opens on FIFO cost basis, not on the answer; table of 31 rows with `+0.00 €` in green for every unrealised position; disclaimer as an amber box above the title. Phone: table clipped inside its card (columns cut at the right). |

### Analysis

| View | Goal | What gets in the way |
|---|---|---|
| **Returns & XIRR** (`returns`) | How good is my return, and why. | Nine KPIs in two grids; heatmap legible (good) but cells are 24 px buttons; "Net / Gross" toggle top right far from the figures it changes; 4 tables; 4,561 px. Large KPIs wrap on phones (`98.701,72` / `€` on two lines). Number mismatch with Overview (see summary). |
| **Performance** (`performance`) | Which holdings moved. | Treemap grey with one saturated tile (scale is not readable); period cards wrap 7 + 1 (MAX alone on a row). |
| **Attribution** (`attribution`, Adv.) | Contribution per holding. | Long list without bars; "pp" figures in the same green as money gains. |
| **Health Score** (`health`) | Is my portfolio well built? | Strong ring + bars (good); five KPI boxes then several stacked cards with three different card paddings; 2,925 px. |
| **Portfolio Intelligence** (`intelligence`, Adv.) | Ranked findings. | Demo shows an empty state ("open the Health view once …"): the view depends on another view having been opened. |
| **Risk & Correlation** (`analytics`, Adv.) | Diversification, stress, Monte Carlo. | Three tab rows on phones; correlation matrix 29 × 29 in flat orange with grey for low values — overflows its card on desktop and phone; "Diversification score" clipped on phones. |
| **Research** (`research`, Adv.) | Look up one stock. | Empty page with an amber notice and an input; no suggestions (holdings, watchlist) as one-click chips. |
| **Strategy** (`investment-analysis`, Adv.) | DCA, sectors, countries, taxonomies, goals. | Nine tabs in one strip (wraps to four rows on phones); DCA card colours (green / blue / amber) carry no meaning. |
| **Fee Analyzer** (`fees`, Adv.) | What do I pay. | All fees in danger-red; bars in red / blue / orange / brown with no legend logic; table clipped on phones. |
| **Discovery** (`discovery`, Adv.) | Screen for ideas. | Two nested tab rows; prices wrap (`194,11` / `€`) on phones. |
| **News Feed** (`news`, Adv.) | News for my holdings. | Symbol filter is a row of 10 pills; each item a full-width card with small text — low density, no source or time hierarchy. |

### Settings

| View | Goal | What gets in the way |
|---|---|---|
| **Customize Overview** (`customize`) | Choose and order Overview sections. | Lives under Settings, far from the Overview it changes; up/down arrows 24 px. |
| **Categories**, **Tags** (Adv.) | Own classifications. | Fine but sparse; explanatory text in 12 px grey under the form. |
| **Alerts & Rules** (Adv.) | Alerts on concentration/drawdown. | Rule builder of four unlabeled-looking selects; the risk monitor table below uses a different table style. |
| **Share & Compare** (Adv.) | Share a redacted snapshot. | Bars in accent only; "show raw payload" as a tiny button. |
| **Trash** | Restore deletions. | Title inside a card (every other view has a page title outside); different heading size. |
| **Privacy** | What leaves my device. | Long text page in a card with its own max-width (different layout from every other view). |

Account menu, API Settings, Security & sync, Design (theme), dialogs (Add transaction, position detail, command
palette, shortcuts) are reached from the header and are covered in R2/R4/R5 of the plan; their primitives are in the
inventory below.

---

## Cross-cutting problems

| Area | Today | Effect |
|---|---|---|
| **Spacing** | 183 distinct padding values, gaps 0.25–1 rem in 12 steps, card padding 12–24 px | Every card looks slightly different; density changes from view to view. |
| **Type sizes** | Token scale exists (`--text-*`, cleanup O-3) but views use 10–14 sizes each (10, 11, 11.84, 12, 12.16, 12.48, 12.8, 13, 13.12, 13.6, 14, 15, 16, 18, 20, 22, 22.5, 24, 25.6, 28, 30, 35.2, 46.4 px); labels in 10–11 px uppercase | Weak hierarchy; small labels are hard to read, worse in German. |
| **Cards** | 12 radii; padded and unpadded cards; dashed "All portfolios" card; Trash / Privacy put the title inside the card | No recognisable card. |
| **Buttons** | 275 hand-built buttons; variants: filled gradient, accent-soft, outline, ghost, text link, icon glyph (✎ × ↻ ★ ◈ ↓ ↑ → ←, 76 glyph buttons); filled buttons all look primary ("+ Add Account", "+ Add Asset" next to each other) | No clear primary action per screen. |
| **Tables** | 50 hand-built tables; header 10–11 px uppercase; numbers right-aligned but not always tabular; phone = clipped table or tall cards | Money tables are hard to scan and break on phones. |
| **Tabs** | Area chips (phone), group tabs (pill), inner tabs (segmented, pill, underline-less text), filter pills — four looks for "pick one" | Users cannot tell navigation from filters; three tab rows stack on phones. |
| **Charts** | Hand-written SVG, no shared frame: axes formatted differently (`524.1K`, `166,906.93`, ISO dates), colours from ad-hoc palettes (green value lines, orange matrix, grey treemap), no shared tooltip | Charts look like they come from different apps. |
| **Icons** | `icons.js` covers the nav (one stroke set); in views mostly Unicode glyphs | Uneven weight and alignment; glyphs read differently per OS font. |
| **Colour meaning** | Gain = success, loss = danger, but also: fees = danger, zero = gain/loss, value lines = success, income = info only in some places, warning amber for notices *and* for "Difference" KPIs | Colour stops carrying meaning; sign is shown (good), but the colour contradicts it on zeros. |
| **Navigation depth** | 6 areas, 28 entries in Advanced; Analysis has 11 views in 7 entries; phone shows area chips + group tabs + inner tabs | Long sidebar, deep phone stacks. |
| **Page headers** | Title + description + actions placed differently per view (actions right on Transactions, left on Budget, below on phones; Dividends tabs above the title) | No predictable place for the primary action. |
| **Empty / Worker states** | Shared `EmptyState` exists (cleanup O-4) but 9 call sites; many views still have their own (Watchlist circle, Journal empty cards, amber text notices) | Inconsistent first impression in demo and new vaults. |
| **Dates** | Transactions list shows ISO dates in both languages; other lists localise | Looks unfinished in German. |
| **Background** | Radial "aurora" gradients on every view | Attractive in the hero, but competes with data; the full-page screenshots show gradient bands. |

---

## Accessibility (WCAG 2.1 AA) per theme

Automated text-contrast scan of 15 views per theme (5,936 text nodes each), plus 20 Tab stops per view. The scan does
not resolve gradients: white text on the gradient fill reports ~1.1 : 1 and was checked by hand (the solid `accentFill`
under it passes with white text: 5.26 : 1 dark and light, 4.94 : 1 Nebula, 5.06 : 1 Contrast, 5.09 : 1 Color-blind).

| Theme | Text below AA | Focus visible | Main failures |
|---|---|---|---|
| Dark | 0 | 300 / 300 | — |
| Light (`white`) | 0 real (8 gradient false positives) | 300 / 300 | Count-up flash on refresh (known, USABILITY follow-up). |
| Nebula (`purple`) | 5 | 300 / 300 | Selected pill = white on `#b26bff`, 3.26 : 1 ("YTD", "Max", "MSCI World", "+ Add Asset"). |
| Contrast | 229 (224 = one per transaction row) | 300 / 300 | Row edit button "✎" 4.16 : 1; selected pill 3.72 : 1. A high-contrast theme should be AAA-leaning. |
| Color-blind (`cb`) | 245 | 300 / 300 | Row edit 3.87 : 1; selected pill 3.74 : 1; "v12" badge 4.10 : 1; "DCA Strategy" tab 4.23 : 1. |

Other WCAG findings (all themes):

| # | Issue | Criterion | Severity | Recommendation |
|---|---|---|---|---|
| A-1 | Phone touch targets under 44 px: chips/tabs 32–37 px, row edit/delete 27–33 px, heatmap and calendar cells 14–24 px, Customize arrows 24 px | 2.5.5 (AAA) / brief: ≥ 44 px | Major | One control height (44 px touch, 36 px pointer); row actions into an overflow menu or swipe. |
| A-2 | Selected pills in three themes below 4.5 : 1 | 1.4.3 | Major | Selected state uses `accentFill` + `onAccent`, never `accent` as a fill. |
| A-3 | Zero values coloured as gain/loss; fees as loss | 1.4.1 (meaning by colour) | Minor | Neutral colour for 0, fees and costs; colour only with a sign. |
| A-4 | Correlation matrix, treemap: colour is the only encoding of value at a glance, and the scales are flat | 1.4.1 / 1.4.11 | Minor | Diverging scale with ≥ 3 : 1 steps, values printed, legend. |
| A-5 | Three stacked tab rows without `role="tablist"` (0 uses); tabs announced as toggle buttons (`aria-pressed`, 45 uses) | 4.1.2 | Minor | Tabs component with `tablist` / `tab` / `aria-selected` and arrow keys. |
| A-6 | Unicode glyph buttons (✎ ×) rely on `aria-label`; some icon-only header buttons have no visible label | 1.1.1 / 2.5.3 | Minor | IconButton component that requires a label and shows a tooltip. |
| A-7 | Chart data not available as text except where a table exists | 1.1.1 | Minor | ChartFrame with a "show as table" toggle. |

Not checked automatically and left for R5: screen-reader pass (NVDA), 200 % zoom on every view, reduced-motion
across all transitions.

---

## Inventory of UI primitives (today)

Counts across all browser JS files (excluding `translations-complete.js`); "files" = number of files using it.

| Primitive | Count | Files | Where / notes |
|---|---|---|---|
| Inline `style: {…}` objects | 3,004 | 75 | Largest: `renderer.js` 548, `features2.js` 233, `features4.js` 173, `investment-views.js` 118, `renderer-components.js` 115, `features3.js` 113, `features5.js` 110 |
| Hex colour literals | 809 | 70 | `renderer.js` 130 (incl. 5 theme objects), `investment-views.js` 40, `features2.js` 31, `research.js` 28, `features5.js` 26, `budget.js` 22, `custom-categories.js` 22 |
| `rgba(` literals | 225 | — | `renderer.js` 81, overlays and tints |
| Buttons (`'button'`) | 275 | 60 | Shared props: `MaerminUI.btnProps` 3 uses, `pillProps` 5 uses (`ui-store.js:273`, `:283`); the rest hand-styled |
| Glyph buttons (✎ × ↻ ★ ◈ ↓ ↑ → ←) | 76 | 20+ | Row actions, steppers, header actions |
| Inputs / selects / textareas | 175 / 65 / 9 | 47 / 26 / 5 | No shared Input; heights 30–44 px |
| Tables | 50 | 38 | All hand-built; no shared Table or phone layout |
| Cards | ~ every view | — | No component; radii `8px` 229×, `6px` 96×, `14px` 73×, `10px` 57×, `16px` 51×, `4px` 34×, `12px` 29×, `3px` 23×, `7px` 19×, `50%`, `999px`, `5px` |
| KPI / stat cards | `statCard` 15 (renderer, features7) + local copies in ~20 views | — | Label sizes 10–12 px, values `--text-kpi` or fixed |
| Tabs / segmented / pills | 45 `aria-pressed` groups, 0 `role="tab"` | 25+ | Four visual variants (see cross-cutting) |
| Modal / Overlay | 13 `MaerminUI.Overlay` uses + 10 `position: fixed` | 5 | Shared Overlay with focus trap (`ui-store.js:119`); Add transaction, position detail, password, onboarding |
| Confirm | `MaerminUtils.confirmThen` + `ConfirmHost` | — | Shared (`ui-store.js:208`) |
| Toast | `addToast` 115 calls | 7 | Shared container (`ui-store.js:234`) |
| Empty state | `EmptyState` 9 uses | 5 | Shared (`ui-store.js:296`), adopted by cleanup O-4; many local ones remain |
| Skeleton / loading | none shared | — | Spinners and "Loading…" text per view |
| Charts | 16 inline SVG roots, no chart library | 14 | Value chart (`renderer.js`), donut, treemap (`performance-map.js`), heatmap (`returns-heatmap.js`), projection (`projection.js`), correlation (`renderer-components.js`), Monte Carlo, research (`research.js`), position chart (`position-chart.js`), cash flow, sparklines |
| Icons | `icons.js` (nav set) + Unicode glyphs | 2 + 20 | Nav icons only |
| Tokens | `styles.css` `:root` + 4 theme blocks: accent, surface, border, text, success/danger/warning/info, 4 radii, a type scale, control heights, two fonts | — | Views read `currentTheme.*` from the JS theme objects instead of CSS variables; the two lists are kept in step by hand |
| Fonts | Geist + Geist Mono (OFL, self-hosted, `fonts/`) | — | Tabular figures via `font-variant-numeric` in some KPIs only |

---

## Priorities for the redesign

1. **Foundation first (R1).** One token set that both CSS and JS read (CSS variables; the JS theme objects become a
   bridge), and components for Button, IconButton, Card, KPI, Table (with a phone layout), Tabs, Input, Badge, Modal,
   Toast, EmptyState, Skeleton, ChartFrame. Most findings above are "the same thing built 50 times".
2. **Overview, Transactions, Tax, Dividends, Import (R3).** The five tasks: answer first (net worth / allowance left /
   income this year), then detail. Transactions grouped by month with type filters and a phone list.
3. **Navigation (R2).** Shorter Advanced sidebar (collapsible areas or a second level), never more than two tab rows,
   one tabs component, one page-header pattern with one primary action.
4. **Colour meaning and charts (R3/R4).** Neutral zeros, fees and costs; gain/loss only with sign; one chart frame and
   palette per theme (incl. a diverging scale for heatmap and correlation).
5. **Accessibility (all packages, R5 audit).** Fix the selected-pill and row-action contrast in Nebula, Contrast and
   Color-blind; 44 px targets on touch.
