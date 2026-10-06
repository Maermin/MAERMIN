# MAERMIN — Usability review (Phase 3)

Review of 2026-10-06 against `main` @ `ce509cf` (after Phase 2). Every flow from PLAN.md
was walked on **desktop (1366 × 900)** and **phone (390 × 844, touch)**, in **English and
German**, in **all five themes** (Dark, Light, Nebula, Contrast, Color-blind): 20 runs.

Flows: first run (create vault, recovery code, setup wizard) · add transaction · import
(manual, broker wizard, Steam inventory) · price refresh · tax view and tax report export ·
backup / restore · Security & sync · settings · trash · privacy.

Method: a scripted browser walk (seeded book, fixture Worker) that checks every screen for
page errors, horizontal overflow, text contrast (WCAG AA: 4.5 : 1, 3 : 1 for large text),
pointer target size (WCAG 2.2: 24 × 24 px) and English words in German mode, plus
screenshots of each screen reviewed by hand. Clean across all 20 runs: no page errors, no
horizontal overflow, no untranslated German UI text.

Severity: **High** blocks or loses work · **Medium** gets in the way of a flow or fails
WCAG AA · **Low** polish.

| # | Sev | Where | Finding | Fix |
|---|---|---|---|---|
| H-1 | High | Data, Tax, Dividends views | Four views were components defined inside the app component, so React remounted them on every app render (at least once a minute through the Worker status check). Their state was lost: a backup pasted into Manual Import, the selected tab, a half-typed Freistellungsauftrag or Steam preview. | Each view gets one stable component that runs the latest code (`StableViews`, renderer.js). A deep link to Broker Import still switches the tab. |
| H-2 | High | Tax → German fund taxation, Tax settings | The Basiszins, Abgeltungsteuer rate, Freistellungsauftrag and Teilfreistellung fields were re-formatted or reset to their default on every keystroke ("3," or an empty field snapped back), so a new value could not be typed. The Basiszins showed "3.200" (read as 3,200 in German). | Fields commit on blur / Enter, show the number in the UI language ("3,2"), and have labels. |
| H-3 | High | Setup wizard, light theme | The first-run wizard ("Set up your data sources") was dark text on a dark card (1.1 : 1): it read a theme field (`cardBg`) the app's themes do not have and fell back to a dark colour. The same field left four newer panels without their card background. | The wizard uses the theme's dialog colour; the panels use `theme.card`. |
| M-1 | Medium | All dark themes | White text on the bright accent fill was 3.3 : 1 (primary buttons, selected tabs and toggles, chart range, auto-lock, "+ Add"); white on the green Buy toggle / "Add Buy" button 1.8 : 1. | A darker fill per theme (`accentFill`, CSS `--accent-fill`, AA with white text) for every filled button; `MaerminUtils.onColor()` picks dark text on bright green, amber and red fills. The bright accent stays for text, borders and focus. |
| M-2 | Medium | Light theme | Green, red and amber text was 2.7–3.9 : 1 on white and on its own tinted chips ("3 missing", gains, "Export Excel"); accent text on its tinted chips ("All Portfolios", "Refresh prices") 3.6 : 1; the overview's allocation / top-performer figures used fixed dark-theme colours (green 1.9 : 1, grey 3 : 1). | Darker light-theme tones (accent #5244e0, green #066b45, red #c42b33, amber #a14a06) and theme tokens in the overview: ≥ 4.5 : 1. The Contrast theme's avatar / gradient got the darker blue too. |
| M-3 | Medium | Add transaction | No close button (only Escape or the backdrop), and the save button sat below the fold on a 900 px window and on phones. | Close button in the header; Cancel / Save stay visible at the bottom while the form scrolls. |
| M-4 | Medium | Backup / restore | Data → Export & Backup offered a backup but no way back: restoring meant opening the JSON file and pasting it into Manual Import. | "Restore from file…" next to the backup (same confirmation as before), "Choose file…" in Manual Import, and a note that the JSON backup is not encrypted (encrypted backup: account menu). |
| M-5 | Medium | Data, Tax, Dividends, Analytics tabs | After switching tabs, the first tab kept the accent gradient, so two tabs looked selected: the button styling marked a button once and never re-checked it. | The tabs carry `aria-pressed` (also tells screen readers which tab is active), which the styling already honours; it now also recognises the new fill colour. |
| M-6 | Medium | Phone | Toasts sat above the dock and covered the fields of an open dialog (e.g. the price fields of Add transaction). | On phones toasts appear under the top bar. |
| M-7 | Medium | Phone and desktop | Pointer targets below 24 × 24 px: dialog close "×" (11 × 22), "Manage portfolios →" (17 px high). | Buttons and selects are at least 24 × 24 px, on touch screens 32 px. |
| L-1 | Low | Tax advisor | Amounts not formatted for the language ("1000 EUR left", "1000 / 1000 EUR"); the Freigrenze label said 1.000 EUR also for years before 2024 (600 EUR). | Formatted amounts; the label shows the limit of the year. |
| L-2 | Low | Overview | "★ Try demo" stayed in the header after the user had their own transactions (four rows of buttons on a phone). | Shown only while the vault is empty (and to leave demo mode). |
| L-3 | Low | Settings → Design | German "Farbenblind-sicher" ran out of its theme tile; English "CB-safe" is jargon. | "Farbenblind" / "Color-blind". |
| L-4 | Low | API Settings (German) | Cloudflare button names in the update steps were unmarked English inside German text. | Quoted as UI names („Edit code“, „Deploy“). |
| L-5 | Low | Manual Import, church-tax select | Text area and select without an accessible name. | Labels added. |

Not changed (follow-ups):

- The overview's count-up / flash animation briefly tints the figures right after a refresh
  (3.8 : 1 on the light theme while it runs); it settles within a second and is off with
  "Animations & effects".
- Transaction type badges (Buy / Sell / Dividend) use a fixed palette that is not theme-aware:
  "Dividend" is 4.35 : 1 on dark themes, the light theme is lower. Making the palette follow the
  theme tokens is a small follow-up.
- On the light theme the letter tiles next to position names (e.g. "AAPL" in the category
  colour) are 1.7–2.9 : 1; they repeat the name shown beside them.
- "v10" badge and the `cf-worker/worker.js` code chip are 3.4–4.1 : 1 (decorative / repeated).
- Inline text links inside sentences ("Deploy to Cloudflare ↗") are under 24 px high; WCAG 2.5.8
  exempts inline targets.
- A chart without price history shows "Chart loads automatically — select a period above"; with
  a Worker it fills itself after the first refresh.

Re-check: the same walk after the fixes (all five themes, desktop and phone) reports no page
errors, no overflow, no filled button or status colour under 4.5 : 1 and no non-inline target
under 24 px; what is left is listed above. The e2e suite covers the regressions
(`test/e2e/app.e2e.mjs`, scenario 9).
