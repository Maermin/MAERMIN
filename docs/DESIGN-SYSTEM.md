# MAERMIN design system — "Atlas Map"

Status: **plan**, picked by the owner on 2026-10-17 (direction C of [`docs/redesign/DIRECTIONS.md`](redesign/DIRECTIONS.md)).
Reference screens: [`docs/redesign/final/`](redesign/final/) (static, demo data). Problems it answers:
[`docs/REDESIGN-AUDIT.md`](REDESIGN-AUDIT.md). Work order: `PLAN.md` → Phase 6.

This file is the contract for every redesign package. A value that is not here is not used in view code; a new value
is added here first, in the same PR.

---

## 1. Principles

1. **Answer first.** Every screen starts with the answer to the question the user came with (how much, is it growing,
   what pays me, what do I owe). Detail follows, one click away.
2. **Every figure reconciles.** Where a screen shows a total, it shows what it is made of, to the cent, or says what is
   left out.
3. **Colour carries meaning, never alone.** Gain, loss, income, cost and warning have fixed colours, and each comes with
   a sign, word or icon. Zero and costs are neutral.
4. **One way to do a thing.** One button set, one table, one tab component, one chart frame. Views compose shared
   components; they do not style themselves.
5. **Every theme is first-class.** Dark, Light, Nebula, High contrast and Colour-blind are token sets of the same system;
   a component that works in one works in all.
6. **Phone is first-class.** Layouts are designed at 360 px as well as 1440 px; nothing scrolls sideways except data
   grids that say so.

---

## 2. Tokens

Tokens are CSS custom properties on `<html>` in `styles.css`. `<html>` carries `data-theme` (`dark`, `white`, `purple`,
`contrast`, `cb`; ids unchanged) and `data-mode` (`dark` / `light`). Names keep today's tokens where they exist
(`--bg`, `--surface`, `--text`, `--accent`, …) so existing CSS keeps working; new names are marked **new**.

### 2.1 Colour

Money tones (gain, loss, income, warning) also hold 4.5 : 1 on their own tint (20 % over `--surface`, 15 % over `--surface-2`: badges, tone chips) in every theme. All text pairs below are checked against `--bg`, `--surface` and `--surface-2` (≥ 4.5 : 1, the values in the table are
the lowest of the three); `--control` is checked for 3 : 1 (WCAG 1.4.11).

| Token | Role | Dark | Light (`white`) | Nebula (`purple`) | High contrast | Colour-blind (`cb`) |
|---|---|---|---|---|---|---|
| `--bg` | page | `#0c0b12` | `#f5f5f8` | `#100b1b` | `#000000` | `#0c0d11` |
| `--surface` | cards | `#14131c` | `#ffffff` | `#181226` | `#000000` | `#14161c` |
| `--surface-2` | raised, table headers, hover | `#1b1a26` | `#f0f0f5` | `#201831` | `#111111` | `#1b1e26` |
| `--border` | dividers (decorative) | `#252433` | `#e6e5ee` | `#2b2240` | `#9a9a9a` | `#252934` |
| `--border-strong` | card edges, separators | `#33314a` | `#d6d4e2` | `#3a2e56` | `#ffffff` | `#333847` |
| `--control` **new** | input, select, button outlines (≥ 3 : 1) | `#68676f` | `#8b8a90` | `#6c6678` | `#ffffff` | `#67696e` |
| `--text` | primary text | `#f0eff6` | `#12111c` | `#f4efff` | `#ffffff` | `#eef0f5` |
| `--text-dim` | secondary text (≥ 5.9 : 1) | `#9c9ab0` | `#5b596e` | `#ac9fc8` | `#e8e8e8` | `#9ea4b2` |
| `--text-faint` **new** | tertiary text, hints (≥ 4.5 : 1) | `#838296` | `#6d6b7e` | `#8a7fa4` | `#d0d0d0` | `#808592` |
| `--accent` | links, selection marks, focus | `#a497ff` | `#4f3fd6` | `#c99bff` | `#ffe14d` | `#56b4e9` |
| `--accent-fill` | filled buttons, selected pills | `#5b4ae8` | `#5442e0` | `#8547e3` | `#ffe14d` | `#1b6fa8` |
| `--on-accent` | text on `--accent-fill` | `#ffffff` (5.85) | `#ffffff` (6.50) | `#ffffff` (5.24) | `#000000` (16.1) | `#ffffff` (5.40) |
| `--accent-soft` | selected row / nav background | accent 13 % | `#ecebfd` | accent 14 % | `#262000` | accent 14 % |
| `--gain` **new** (alias `--success`) | price/return up | `#45d49a` | `#0a6e44` | `#45d49a` | `#4dff9e` | `#56b4e9` |
| `--loss` **new** (alias `--danger`) | price/return down; destructive | `#ff7b8a` | `#b32538` | `#ff86a4` | `#ff8f8f` | `#e69f00` |
| `--income` **new** (alias `--info`) | dividends, interest received | `#7cb7ff` | `#1e5bbc` | `#8ec0ff` | `#9fc7ff` | `#ce7daa` |
| `--warning` | needs attention (not "bad") | `#f2bd5c` | `#865400` | `#f2bd5c` | `#ffe14d` | `#f0e442` |
| `--neutral` **new** | zero, costs, fees, taxes | = `--text-dim` | = `--text-dim` | = `--text-dim` | = `--text-dim` | = `--text-dim` |
| `--comp-invested` **new** | composition: money still invested | `#3b3a58` | `#cfcce4` | `#3e3160` | `#555555` | `#3a3f4f` |
| `--comp-gain` **new** | composition: unrealised gain | `--gain` 32 % on surface | `#2fae79` 32 % | `--gain` 32 % | `--gain` | `--gain` 32 % |
| `--comp-cash` **new** | composition: cash | `--income` 45 % | `#5b95e6` 45 % | `--income` 45 % | `--income` | `--income` 45 % |
| `--focus` **new** | focus ring | `--accent` | `--accent` | `--accent` | `#ffe14d` | `#f0e442` |

Removed with the redesign: the radial "aurora" `background` gradients (the page background is flat `--bg`),
`--accent-grad` / `--accent-fill-grad` (filled buttons are flat `--accent-fill`), `--glass` except for the sticky header.
Legacy aliases (`--gold`, `--text-muted`, `--success`, `--danger`, `--info`) stay until R5 removes their last use.

**Categorical chart palette** (`--chart-1` … `--chart-6`, **new**): series that are not gain/loss (asset classes,
portfolios, sectors). Dark: `#a497ff #7cb7ff #45d49a #f2bd5c #ff9fd0 #8fd3e0`; Light: `#5442e0 #1e5bbc #0a6e44 #865400
#b0307a #11707f`; Colour-blind: Okabe–Ito `#56b4e9 #e69f00 #009e73 #f0e442 #ce7daa #0072b2` (pink lightened from `#cc79a7` for contrast); High contrast:
`#ffffff #ffe14d #4dff9e #9fc7ff #ff8fff #ff8f8f` with a pattern or label on every series. Validated in R1 with the
`dataviz` skill's palette check (≥ 3 : 1 against the surface, distinguishable for deuteranopia).

**Diverging scale** (heatmap, holdings map): `color-mix(in srgb, var(--gain|--loss) N%, var(--surface))`, N from
12 % (near zero) to 52 %; text on every cell is `--text` and stays ≥ 4.5 : 1 (checked per theme in R4). The sign is
always printed.

### 2.2 Typography

Fonts: **Geist** (UI) and **Geist Mono** (symbols, ISINs, codes), self-hosted in `fonts/`, OFL. No other font.
Figures use `font-variant-numeric: tabular-nums` everywhere a number is shown (class `.num`).

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `--type-hero` | 48 / 1.05 (phone 38) | 600, tracking −0.035em | the one answer per screen (net worth, tax due) |
| `--type-display` | 32 / 1.15 | 600, −0.02em | answer tiles, KPI values |
| `--type-title` | 24 / 1.25 | 600, −0.015em | page title (h1) |
| `--type-heading` | 18 / 1.3 | 600 | card heading (h2) |
| `--type-body-lg` | 15 / 1.45 | 400 / 500 | body, table cells on desktop |
| `--type-body` | 13 / 1.45 | 400 / 500 | secondary text, dense tables, labels |
| `--type-caption` | 12 / 1.4 | 500 | captions, axis labels, hints — the smallest size |

Rules: no text below 12 px; no uppercase labels with tracking (they read worse in German); headings use sentence case;
the decimals of the hero figure are set at 0.5 em in `--text-dim` (`178,556`**`.70 €`**).

### 2.3 Spacing, size, radius, elevation

| Group | Tokens |
|---|---|
| Space | `--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-7` 32 · `--space-8` 48 |
| Control height | `--control-sm` 32 (pointer only) · `--control-md` 40 · `--control-lg` 44 (every control on touch: `@media (pointer: coarse)`) |
| Row height | `--row-dense` 40 · `--row` 56 (lists with two lines) |
| Radius | `--radius-xs` 6 (chips, tiles) · `--radius-sm` 8 (inputs, small buttons) · `--radius` 12 (cards, buttons) · `--radius-lg` 22 (phone dock, sheets) · `--radius-pill` 999 |
| Elevation | `--shadow-0` none · `--shadow-1` card (dark `0 12px 32px -18px rgba(0,0,0,.8)`, light `0 1px 2px rgba(18,17,28,.05), 0 10px 28px -18px rgba(18,17,28,.22)`) · `--shadow-2` popover / sheet · High contrast: no shadows, 2 px `--border-strong` borders instead |
| Layout | rail 84 px · content padding 32 (desktop) / 16 (phone) · content max-width 1400 px · card gap 20 px |

### 2.4 Motion, z-index, breakpoints

| Group | Tokens |
|---|---|
| Duration | `--dur-1` 120 ms (hover, press) · `--dur-2` 200 ms (panels, tabs, detail) · `--dur-3` 320 ms (sheet, dialog) |
| Easing | `--ease` `cubic-bezier(0.16, 1, 0.3, 1)` (enter) · `--ease-out` `cubic-bezier(0.4, 0, 1, 1)` (leave) |
| Reduced motion | `prefers-reduced-motion: reduce` and the app's "Animations & effects: off" set every duration to 0 and turn off count-up and value flashes; `npm run bench:motion` stays within today's budget |
| z-index | `--z-sticky` 10 (page header) · `--z-nav` 20 (rail, dock) · `--z-popover` 40 · `--z-sheet` 50 · `--z-dialog` 60 · `--z-toast` 70 · `--z-palette` 80 |
| Breakpoints | `phone` < 768 · `tablet` 768–1199 · `desktop` ≥ 1200 · `wide` ≥ 1600; layout checks at 360, 390, 768, 1024, 1440 |

---

## 3. Token bridge (JS ↔ CSS)

Today views read colours from the JS theme objects in `renderer.js` (`currentTheme.text`, 418 × `textSecondary`,
380 × `text`, 221 × `cardBorder`, …) and the same values are copied by hand into `styles.css`. R1 makes CSS the only
source:

- **`theme-tokens.js` (new module, `window.MaerminTokens`)**: the list of token names, and `resolve(name)` →
  the computed value (`getComputedStyle(document.documentElement)`), cached per theme switch, for the few places that
  need a real colour: `MaerminUtils.onColor` (6 call sites), PDF export, `share-snapshot.js` images, canvas-free SVG
  downloads. Dual export for Node tests (Node gets the dark values from a table).
- **The five theme objects become views on the CSS variables**: `text: 'var(--text)'`, `textSecondary:
  'var(--text-dim)'`, `card: 'var(--surface)'`, `cardBorder: 'var(--border-strong)'`, `inputBg: 'var(--surface-2)'`,
  `inputBorder: 'var(--control)'`, `success: 'var(--gain)'`, `danger: 'var(--loss)'`, `accentFill:
  'var(--accent-fill)'`, … Existing inline styles keep working unchanged; theme switching becomes one `data-theme`
  attribute. No call site concatenates a hex alpha suffix onto a theme value (checked: 0 matches), so `var()` strings
  are safe.
- **Inline lengths stay literal** where `motion.js` / `fx.js` measure them (they read inline paddings and radii);
  `MaerminUI.tokens` keeps the px mirror for those.
- **Check**: `scripts/check.mjs` gets a rule that fails on new hex / `rgb(a)` literals in view files (allow-list:
  `styles.css`, `theme-tokens.js`, chart palette constants, `demo-fixtures.js`) and reports the remaining count, the
  same way it reports hard-coded UI strings today.

---

## 4. Components

All components live in `renderer-components.js` (React via `createElement`, no JSX) and render **class names** from
`styles.css` (`.mx-*`), not inline styles, so they satisfy `style-src 'self'`. Each takes `className` and passes
`data-testid`. A hidden dev view (`?gallery`, not in `nav-model.js`, not in the production command palette) shows every
component in every state, in all five themes. Existing `MaerminUI.btnProps`, `pillProps`, `EmptyState`, `Overlay`,
`ConfirmHost` and `ToastContainer` are absorbed (same behaviour, same test ids).

States every interactive component defines: **default, hover, focus-visible, active/pressed, disabled, loading**; data
components also **empty** and **error**. Focus-visible is always a 2 px `--focus` outline with 2 px offset (High
contrast: 3 px).

### Button
| | |
|---|---|
| Variants | `primary` (fill `--accent-fill`, text `--on-accent`; at most one per view region), `secondary` (surface, 1 px `--control`), `quiet` (no border, `--text-dim`), `danger` (outline `--loss`; filled only inside a confirm dialog) |
| Sizes | `sm` 32 (pointer only), `md` 40, `lg` 44; touch devices always ≥ 44 |
| Content | label in sentence case, optional leading icon (16 px), optional shortcut hint (`kbd`) |
| States | hover: surface-2 / fill +6 % lightness; pressed: scale 0.98; disabled: 45 % opacity, `aria-disabled`, no hover; loading: spinner replaces icon, label stays, `aria-busy` |
| A11y | native `<button type="button">`; never a `div` |

### IconButton
Square `md`/`lg`; **requires** `label` (→ `aria-label` and a tooltip after 600 ms). `aria-pressed` when it toggles
(privacy mode). Replaces every glyph button (✎ × ↻ ★ ◈ …).

### Card
`.mx-card`: `--surface`, 1 px `--border-strong`, `--radius`, `--shadow-1`. Slots: `title`, `subtitle`, `action` (one
link, "Allocation →"), body. Variants: `plain` (no padding, for tables), `answer` (label + display value + sub +
optional split row), `hero` (two panes). Empty / loading / error states come from EmptyState / Skeleton inside the body.

### Stat / KPI
Label (`--type-body`, `--text-dim`) · value (`--type-display`, `.num`, tone class) · sub line · optional split of two or
three mini figures. Tone from the money colour rules (§ 5), never set by hand. Click target = whole card when it opens
a detail (`role="link"` + keyboard). Values wrap in `Mask` for privacy mode.

### Table (+ phone list)
`<table>` with sticky header (`--surface-2`), `--row-dense` rows, numbers right-aligned with `.num`, one optional
selection column, sortable headers (`aria-sort`). Column spec carries `priority` (1 = always, 2 = tablet+, 3 =
desktop) and `phone` (`title` / `value` / `meta` / `tone`) so the same data renders as **two-line rows on phones**
(title + meta left, value + tone right, `--row` height). Group rows (month headers with subtotals) are part of the
spec. Row actions sit in a trailing overflow menu (IconButton "More"), shown always on touch and on hover/focus on
desktop. Empty state and skeleton rows built in. No table scrolls sideways on phones except the explicit data grids
(correlation matrix, heatmap), which show a scroll hint.

### Tabs
Two kinds only: **page tabs** (underline, the views of an area, in the page header; `role="tablist"` / `tab` /
`aria-selected`, arrow keys, `Home`/`End`) and **segmented control** (pill group for periods, Net/Gross, Months/Quarters;
`role="radiogroup"`). Filters are **chips**, never tabs. Never more than one row of page tabs on any screen; a second
level becomes a segmented control or a select.

### Input / Select
40 px (44 touch), `--surface-2` fill, 1 px `--control`, `--radius-sm`. Always a visible `<label>` (or `aria-label`
when the context labels it, e.g. search). Error: `--loss` border + message below, linked with `aria-describedby`.
Number fields commit on blur / Enter and show the number in the UI language (`3,2` in German), as today.

### Badge / Chip
`Badge`: status text (Sample data, Closed, Expected), `--radius-pill`, `--surface-2` + `--text-dim`, 12 px. `Chip`:
filter toggle with count (`aria-pressed`), 40 px (44 touch). `ToneChip`: a figure with tone background (`+111.29 %`),
always with ▲ / ▼.

### Modal / Sheet
`Overlay` keeps focus trap, Escape, restore focus. Desktop: dialog centred, max 560 px, header with title + close
IconButton, sticky footer with actions (primary right). Phone: bottom sheet, full width, `--radius-lg` top corners,
drag handle, footer above the safe area.

### Toast
Bottom-right on desktop, under the top bar on phones (as today, M-6). Kinds: success, error, warning, info (icon +
text, never colour alone); `role="status"` (error: `alert`); 5 s, pause on hover/focus, optional one action (Undo).

### EmptyState
Title + one sentence + optional one action (as cleanup O-4). Kinds: `empty`, `needs-worker` (action: open API
Settings), `error` (action: retry), `loading` (`role="status"`). Never a lone icon or spinner.

### Skeleton
Shapes for KPI, table row, chart; `--surface-2` with a 1.2 s shimmer (off with reduced motion). Shown after 150 ms only.

### ChartFrame
Card body for every chart: title, subtitle (period / basis), the chart, a legend **in words** (no colour-only legend),
"Show as table" toggle that renders the data through Table, and the source line where it applies ("Eurostat HICP",
"Sample data"). See § 6.

### Shell components (R2)
`Rail` (84 px, five areas + Settings, labelled icons, `aria-current`), `PageHeader` (title, portfolio scope, search,
privacy, one primary action, page tabs), `Dock` (phone: five slots with a central Add, labelled, `--radius-lg`),
`CommandPalette` (kept, restyled), `Mask` (privacy wrapper).

---

## 5. Numbers and colour rules

| Rule | Detail |
|---|---|
| Format | Only through `MaerminI18n` (`money`, `num`, `pct`, `date`); de-DE: `178.556,70 €`, `+3,67 %`; en-US: `178,556.70 €`, `+3.67%`. Dates localised everywhere (no ISO dates in lists; ISO only in exports). |
| Figures | `tabular-nums` in all tables and KPIs; symbols / ISINs in Geist Mono. |
| Sign | Changes and returns always carry a sign: `+` / `−` (U+2212) / `±0`. Amounts that are balances (value, cost basis) carry none. |
| Gain / loss | `--gain` / `--loss` text plus ▲ / ▼ or the sign. A figure that is exactly zero is `--neutral` and shows `±0` or `0.00`. |
| Income | Dividends and interest received: `--income`, with `+`. |
| Costs | Fees, taxes, purchases: `--neutral` with `−` where they are outflows. Never `--loss` (a fee is not a loss). |
| Warnings | `--warning` only for something that needs action (missing price, stale data, allowance almost used). |
| Precision | Money 2 decimals; quantities as entered (up to 8 for crypto); percentages 2 decimals in KPIs, 1 in tables and heatmaps; compact (`176.8k` / `176,8 Tsd.`) only on chart axes. |
| Privacy mode | Every money amount wraps in `Mask` → `••••••` with the width kept; percentages, counts and scores stay visible; charts keep their shape and hide axis values and tooltips' amounts. |
| Currency | EUR is the reporting currency; an original currency is shown second, smaller (`8,161.32 €` / `8,871.00 $`). |

---

## 6. Chart rules

Load the `dataviz` skill before touching any chart (R3, R4).

1. Every chart sits in a **ChartFrame** with a title that states the question ("Value, 12 months") and a word legend.
2. **Line / area** for values over time: 2 px line in `--accent`, 10–13 % fill, no grid on small charts, dashed grid on
   large ones, axis labels at the ends and a crosshair with date + value.
3. **Composition**: one horizontal stacked bar with labels inside when they fit, values beside it, and the sum shown.
4. **Gain/loss by period or holding**: diverging scale (§ 2.1) with the signed value printed in each cell; legend with
   the two ends.
5. **Attribution / return bridge**: waterfall, positive steps up in their tone, negative steps down, total bar in
   `--accent`, values above bars.
6. **Categories**: `--chart-1…6` in a fixed order per dimension; more than six → top five + "Other".
7. **No colour-only encoding**: labels, signs or patterns carry the meaning; High contrast adds patterns to series.
8. **Text alternative**: `role="img"` with an `aria-label` summary, plus "Show as table".
9. **Phone**: charts take full width, height 160–200 px, legends below, no hover-only information.

---

## 7. Accessibility rules

- WCAG 2.1 AA in **every** theme; High contrast aims at AAA for text (7 : 1) and uses 2 px borders.
- Text contrast ≥ 4.5 : 1 (≥ 3 : 1 at 24 px / 18.66 px bold); UI component and graphic contrast ≥ 3 : 1.
- Touch targets ≥ 44 × 44 px on `pointer: coarse`; ≥ 24 × 24 px with pointer (WCAG 2.5.8), 32 px preferred.
- Keyboard: every action reachable; logical order (rail → header → content); visible focus everywhere; Escape closes
  overlays and returns focus; `g`+key shortcuts and the command palette stay.
- Semantics: landmarks (`nav`, `header`, `main`), one `h1` per view, tabs / radio groups as in § 4, tables with
  `<th scope>`, live regions for toasts and loading.
- Motion: reduced-motion honoured (§ 2.4); no flashing.
- Zoom: layouts hold at 200 % zoom (1440 px → 720 px CSS).
- Every PR checks contrast in all five themes (scripted scan, `docs/redesign` method), focus order, screen-reader
  labels; R5 runs `design:accessibility-review` per theme and an NVDA pass.

---

## 8. Writing rules (EN and DE)

Check new copy with the `design:ux-copy` skill. Every string goes through `__()` with `en` and `de`.

| Rule | EN | DE |
|---|---|---|
| Sentence case for labels and headings | "Net worth", "Add transaction" | „Nettovermögen“, „Transaktion hinzufügen“ |
| Verbs on buttons, the object when needed | "Import statement" | „Abrechnung importieren“ |
| Questions as card titles where they help | "What does it pay me?" | „Was bringt es mir?“ |
| Say what happened and what to do | "Prices are 3 days old. Refresh prices" | „Kurse sind 3 Tage alt. Kurse aktualisieren“ |
| No jargon without a plain line under it | "XIRR — counts when you paid in" | „XIRR – berücksichtigt, wann du eingezahlt hast“ |
| Address | "you" | „du“ (as the app does today) |
| Length | Leave 40 % room: German labels run 30–40 % longer; no fixed widths on labels; test every layout in DE | |
| Numbers in text | through `MaerminI18n`, never string-built | |
| Advice disclaimer | keep the existing "No tax or investment advice — estimates only" wording on tax, simulator, verdict and research | |

---

## 9. Layout patterns

- **Desktop shell**: rail (84) · page header (title, scope, search, privacy, primary action, page tabs) · content
  (max 1400, padding 32, card gap 20).
- **Phone shell**: top bar (logo, scope, search, privacy) · content (padding 16) · floating dock (Overview, Activity,
  Add, Income, More) above the safe area. No sidebar, no stacked tab rows.
- **Overview pattern**: hero (answer + chart + periods) beside its composition → answer tiles → "Next up" → map →
  list.
- **List–detail pattern**: list grouped by period on the left, detail panel on the right (desktop); on phones the
  detail opens as a sheet.
- **Simple vs Advanced**: Simple hides advanced page tabs and advanced figures in answer tiles; the rail and dock never
  change between modes.

---

## 10. Old → new token map

| Today (JS theme / CSS) | New |
|---|---|
| `background` (aurora gradients) | `--bg` (flat) |
| `card`, `cardBg` | `--surface` |
| `surface2`, `inputBg` | `--surface-2` |
| `cardBorder`, `modalBorder` | `--border-strong` |
| `inputBorder` | `--control` |
| `text` / `textSecondary` | `--text` / `--text-dim`; new `--text-faint` |
| `accent`, `accentText`, `accentFill`, `accentSoft`, `accentGradient` | `--accent`, `--on-accent`, `--accent-fill`, `--accent-soft`; gradient removed |
| `success` / `danger` / `warning` / `info` | `--gain` / `--loss` / `--warning` / `--income`; plus `--neutral` |
| `shadow`, `glass` | `--shadow-1`; `--glass` only for the sticky header |
| `modalBg` | `--surface` |
