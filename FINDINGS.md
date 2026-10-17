# MAERMIN open findings — 2026-10-17 (after the 2026-10-16 cleanup run)

The 2026-10-05 list (36 items) is closed: 34 items were fixed in the P1/P2 packages and
released with v11 and v12. The last two (M-4 DCA analyzer, M-15 FIFO per depot) were
fixed in this run. The run's own findings (bugs B-1…B-5, visual V-1…V-7, usability U-1…U-6,
dead code D-1…D-4) are fixed or checked. See [docs/AUDIT.md](docs/AUDIT.md), section
"Run 2026-10-16".

What is still open is listed below. Each item is a follow-up rather than a regression.

**Security findings are not listed here.** The repository is public, so security issues
stay in the git-ignored `docs/AUDIT.security.local.md` until they are fixed and released.
This run found 4 there, all Low, all fixed in #184. SEC-009 stays open by the owner's decision.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 4 |

Severity: **Critical** = wrong money or tax figures in a realistic case, or data loss ·
**High** = a core feature is broken or misleading · **Medium** = real friction, or wrong
in an edge case · **Low** = polish.

---

## Medium

### O-1 Planning views ignore "separate depot" and still pool shares across portfolios
- **Where:** `sell-simulator.js`, `harvest-plan.js` and `cost-methods.js`. They use the shared ledger (`ledger.js`) but call it without the `depots` option. The sell simulator and the cost-method comparison already pass the crypto per-wallet setting; the harvest planner passes neither.
- **Effect:** with a portfolio marked as a separate depot (Portfolios → "Separate depot for German tax", #183), the German tax report sells from that depot's own lots. These planning views still take the oldest lot from any portfolio, so their estimated gain can differ from the report.
- **Fix:** pass `TaxReport.separateDepots()` into the views' `ledger.build` calls, and add a test with the FINDINGS M-15 example (+900 € pooled, −100 € per depot).

## Low

### O-2 Fixed colours remain outside text colours
- **Where:** 256 fixed semantic hexes (`#22c55e`, `#ef4444`, `#f59e0b`, `#3b82f6` …) are still in the JS. 129 of them are `theme.x || '#…'` fallbacks; the rest are backgrounds, borders, chart palettes and SVG strokes.
- **Effect:** none on contrast today. The demo scan over all 29 views finds no text below AA in either theme. But a theme change has to touch these places by hand.
- **Fix:** move backgrounds and borders to the theme tokens (`color-mix` with `var(--success)` …), the way `txTypeInfo` does since #187.

### O-3 Type sizes are still inline
- **Where:** 49 distinct inline font sizes, 1,577 uses. The type tokens (`--text-xs…xl`, `MaerminUI.tokens.text`, #186) are used by the shared components only.
- **Fix:** move views to the type scale when they are next touched. A view-by-view sweep would be a large diff with visual risk.

### O-4 Only the Worker-gated cards use the shared empty state
- **Where:** `MaerminUI.EmptyState` (#187) is used by Crypto wallets, Bank sync and Aggregators. Other views (correlation, DCA, risk, news, rebalancing) still word and style their own empty and loading states.
- **Fix:** switch them one by one and keep their `data-testid`s.

### O-5 "Needs your Worker" has no button to API Settings
- **Where:** the gated empty states say "add its URL in API Settings" but offer no action. The app's own `open-api-settings` action lives inside the data-quality dispatcher (`renderer.js`) and views cannot reach it.
- **Fix:** a small event (for example `maermin:open-api-settings`) that the renderer listens to; `EmptyState` already takes an `action`.
