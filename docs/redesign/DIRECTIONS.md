# Redesign — three design directions (Phase 1)

**Picked: C · Atlas Map** (owner, 2026-10-17). Final screens with AA-checked tokens: [`final/`](final/); the contract: [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md). The other two directions stay here for reference. Nothing in the app changes
until the plan PR after the pick is merged.

**How to look at them.** Open [`index.html`](index.html) in a browser (no server needed). Every mockup has a yellow
PROTOTYPE bar at the bottom: ← / → (or the arrow keys) switch the direction on the same screen; the selects switch
screen and theme; "Hide amounts" shows privacy mode, "Simple" shows Simple mode. Four screens each: Overview,
Transactions, Returns, phone Overview (in German, to prove the longer labels fit).

**Data.** All figures are the public demo (`?demo`, `main` @ `efc1609`, "All portfolios"), taken from the running app
on 2026-10-17 ([`demo-data.js`](demo-data.js), figures in [`kit.js`](kit.js)). Two exceptions, labelled where they
appear: USD amounts are converted at the demo's live rate 0.920 instead of each booking's own rate, and the 12-month
sparklines in B's positions table are illustrative shapes. XIRR/TWR are the Overview's figures (the Returns view
currently shows different ones; see `docs/REDESIGN-AUDIT.md`).

**Fonts.** All three use the self-hosted Geist and Geist Mono already in `fonts/` (OFL). No new font is needed for
any of them; a different OFL face can be added later without changing the direction.

**Skills.** `frontend-design` is not installed in this environment, so type, colour and layout choices below follow
the audit and the competitor review instead. Mockups were built as throwaway prototypes (`supermatt:prototype`).

---

## A · Quiet Ledger — calm and spacious

**Idea.** For the long-term investor who opens MAERMIN once a week and wants three answers, not thirty numbers. It
feels like a well-made bank statement on good paper: lots of air, one accent, answers in plain sentences ("How is my
money growing? +19.63 % a year"). Simple mode is the natural home; Advanced adds a quiet row of extra figures.

| | |
|---|---|
| Layout | Top bar with five areas as text tabs (no sidebar); content in one centred column (max 1160 px). Overview = hero → chart → three answer cards → allocation bar → largest holdings. Transactions = a month-grouped list, one booking per row. |
| Type | Geist 300 for the hero (64 px), 400/500 elsewhere; scale 12 / 14 / 16 / 20 / 28 / 64; body 16 px; tabular figures everywhere. |
| Colour | Warm paper `#f7f5f0` / graphite `#121311`; one sage-teal accent (`#1f6f5c` light, `#8cc7b2` dark). Gain green, loss vermilion, income blue, warning amber; zero and costs neutral. |
| Spacing / radius / elevation | 4-based scale up to 64; radius 14 (cards) and full pills (controls); borders, no shadows. |
| Charts | One thin line (1.75 px) with a 10 % fill, no grid, axis labels only at the ends; heatmap in soft tints with the sign printed. |
| Icons / motion | Stroke icons only in the top bar and list rows; motion = 150 ms fades, nothing moves on its own. |
| Number-heavy tables | Avoided on Overview (list rows with two lines); full tables only in Returns and drill-downs. Phone: the same two-line rows. |
| Privacy mode | Every amount masked as `••••••`; percentages stay (they reveal no wealth). |
| Simple vs Advanced | Simple hides the extra-figures row and the advanced areas; the top bar never grows beyond five areas + settings. |
| Five themes | Each theme is a token set (see `quiet-ledger/style.css`); High contrast = pure black, 2 px white borders, yellow accent; Colour-blind = Okabe–Ito blue/orange for gain/loss. |
| Risk | Least dense: a power user needs more clicks for the same numbers; the advanced views (risk, tax tools) need a "deeper" page style that the calm shell does not show yet. |

## B · Trading Desk — dense, for power users

**Idea.** For the user who tracks 30+ positions, two depots and wants every number on one screen, keyboard first.
It feels like a professional terminal made friendly: a compact sidebar with `g`+key hints, a KPI strip, panels,
32 px table rows, monospaced figures. Closest to Portfolio Performance's depth with Parqet's polish.

| | |
|---|---|
| Layout | Compact sidebar (216 px) grouped in four areas with counts and shortcuts; 44 px top bar with breadcrumb, command search, Hide (H), Import, New (N). Overview = KPI strip → value chart + allocation + best/worst → full positions table. Transactions = faceted filters with counts, month subtotal rows, multi-select with bulk actions. |
| Type | Geist 13 px body, Geist Mono for every figure; scale 11 / 12 / 13 / 14 / 16 / 22 / 30; uppercase 11 px labels with tracking. |
| Colour | Graphite `#0a0c0f` / cool grey `#eef0f3`; electric-blue accent (`#4da3ff` / `#0b5cc4`). Gain green, loss red, income violet, tax amber; tinted pills behind percentages. |
| Spacing / radius / elevation | 4-based, tight (8–16 inside panels); radius 6 / 4; flat panels with 1 px borders. |
| Charts | Grid lines dashed, crosshair with a value card, period tabs in mono; heatmap as a full month × quarter × year grid; waterfall bars for "where the return came from". |
| Icons / motion | 16 px stroke icons in the sidebar; motion only on hover/focus (row actions appear on hover, always on focus). |
| Number-heavy tables | First-class: sticky headers, month subtotal rows, column chooser, CSV. Phone: priority columns (symbol, value, return pill, weight) in two-line rows. |
| Privacy mode | Amounts masked, column widths kept so the layout does not jump. |
| Simple vs Advanced | Simple hides the advanced sidebar entries, the TWR / Health KPIs, benchmark and drawdown toggles and the sparkline column. |
| Five themes | Token sets in `trading-desk/style.css`; High contrast keeps the density but raises borders to white; Colour-blind uses blue/orange pills. |
| Risk | Can feel intimidating to new users and on first run; needs a good empty state and onboarding so the density is earned. |

## C · Atlas Map — answer-first (recommended)

**Idea.** "The whole map of your wealth" (the v12 name) made visible. For both audiences: the first screen answers
*how much, what is it made of, is it growing, what pays me, what's next*, and every answer opens its detail. The look
keeps MAERMIN's violet identity, without the aurora background, on calm surfaces.

| | |
|---|---|
| Layout | Labelled icon rail (84 px, five areas + settings; same five as the phone dock); page header with the area's views as underline tabs and one primary action. Overview = hero (net worth, chart, periods) beside "what it's made of" (invested + unrealised gain + cash = net worth, reconciled to the cent) → answer tiles (return, income, health) + "Next up" (events) → holdings map (treemap, area = value, colour = return) → positions. Transactions = master–detail: month-grouped list and a detail panel that shows what a booking did (e.g. the NVDA sale: realised gain FIFO, tax booked, shares left). Returns = XIRR vs TWR vs inflation as bars, waterfall of the net return, best holdings, heatmap. |
| Type | Geist 600 for the hero (48 px) and headings, 400/500 body 15 px; scale 12 / 13 / 15 / 18 / 24 / 32 / 48; tabular figures; mono only for symbols. |
| Colour | Ink `#0c0b12` / mist `#f5f5f8`; violet accent kept (`#a497ff` / `#4f3fd6`, filled `#5b4ae8`); gain green, loss rose, income blue, warning amber; a fixed three-colour "composition" set (invested / gain / cash). |
| Spacing / radius / elevation | 4-based up to 48; radius 12 / 8 / 6; one soft shadow level for cards, none in High contrast. |
| Charts | One chart frame for all: title + subtitle, legend in words, sign always printed, diverging green/rose scale with a printed legend (heatmap, treemap); waterfall for attribution. |
| Icons / motion | 22 px labelled rail icons, 16–18 px elsewhere; motion: 200 ms ease-out for panel and detail transitions, reduced-motion = none. |
| Number-heavy tables | Positions table kept but secondary; transactions as a scannable list with the full record in the detail panel. Phone: cards in a two-column grid for answers, two-line rows for lists, a floating dock with a central "+" (add transaction from anywhere). |
| Privacy mode | Amounts masked; the composition bar keeps its proportions but hides the amounts (proportions reveal no wealth). |
| Simple vs Advanced | Simple hides advanced tabs in the page header and the advanced answer details (TWR, inflation, fees); the rail never changes. |
| Five themes | Token sets in `atlas-map/style.css`; High contrast drops shadows and uses 2 px white borders; Colour-blind maps gain/loss to blue/orange and the composition set to grey/blue/pink. |
| Why recommended | Fixes the audit's top problems directly: hierarchy (the answer first), navigation depth (five areas, one tab row, never three), colour meaning (composition and diverging scales with printed signs), and it shows what makes MAERMIN different (reconciled figures, tax effect of a booking) instead of hiding it behind tabs. |
| Risk | The treemap and the "what it did" panel need data the app has (ledger, events), but the detail panel is new UI on top of existing numbers; listed as a behaviour change in the plan if picked. |
