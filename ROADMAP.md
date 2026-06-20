# MAERMIN — Next-Gen Roadmap & Status

Goal: compete with Parqet / Delta / Snowball / getquin while staying **client-side
first** and honoring the V7 rule — *integrate into existing views, reuse the one
shared service (`MaerminMetrics`), never bolt on parallel engines or tabs.*

All new modules follow the existing pattern: a self-contained IIFE that attaches
to `window.*`, loaded in order by `index.html`, bundled as-is by `build.mjs`.
Every shipped module is covered by a Node test in `test/`.

---

## Shipped

| Epic | Module(s) | Status | Tests |
|---|---|---|---|
| **4 Security** | `crypto-vault.js`, `storage.js`, `auth.js` | Argon2id/PBKDF2-600k → AES-256-GCM vault, encrypted-at-rest (reversible), idle auto-lock, passkey-ready, replaces SHA-256 | `test/vault.test.js` (25) |
| **2 PWA** | `manifest.webmanifest`, `service-worker.js`, `pwa.js`, `icon.svg` | Installable, offline app-shell, runtime caching, local notifications, push subscription plumbing, background-sync hook | manifest/build validated |
| **1 Cloud sync** | `sync-engine.js`, `cf-worker/worker.js` (`?action=sync`) | Zero-knowledge E2E (server sees ciphertext only), rev-based optimistic concurrency, transaction-safe merge, Worker/Drive/OneDrive transports | `test/sync.test.js` (10) |
| **3 AI advisor** | `advisor.js` | Deterministic findings from `MaerminMetrics` (concentration/diversification/currency/rebalance/dividend/tax/health) + grounded NL chat via `AICopilot` | `test/advisor.test.js` (15) |
| **5 Benchmarks** | `portfolio-analytics.js` | Alpha, Beta, Tracking Error, Information Ratio, R²; presets MSCI World / FTSE All-World / S&P 500 / Nasdaq 100 + custom | `test/analytics.test.js` (27) |
| **6 Simulator** | `portfolio-analytics.js` | Future value, FIRE projection, retirement plan, withdrawal simulation, seeded Monte-Carlo success probability | ↑ |
| **7 Risk** | `portfolio-analytics.js` | Max drawdown, rolling returns, rolling volatility, correlation matrix (heatmap), Fama-French OLS factor exposure | ↑ |
| **4 TS foundation** | `jsconfig.json`, `types/maermin-globals.d.ts` | Editor type-checking + ambient contracts, zero runtime change | — |
| **v10 UI** | `styles.css`, `renderer.js` | New dark-fintech redesign — Hanken Grotesk / Space Grotesk / JetBrains Mono, radial-wash background, refreshed chrome | visual |
| **v10 Intelligence** | `portfolio-intelligence.js` | 10 structural-problem checks, ranked critical→important→optimization | `test/portfolio-intelligence.test.js` |
| **v10 Snapshots** | `portfolio-snapshots.js` | On-device daily total-value history (per portfolio), survives API outages, in backup | `test/portfolio-snapshots.test.js` |
| **v10 Tags** | `tags.js` | Cross-cutting labels on symbols + per-tag value/weight rollup, in backup | `test/tags.test.js` |
| **v10 Dashboard** | `dashboard-layout.js` | Reorder/hide Overview cards, build-safe layout reconciliation, in backup | `test/dashboard-layout.test.js` |

**Engine layer is done and tested.** The remaining work for the shipped epics is
**UI fold-in** — embedding `MaerminAdvisor.Panel`, the benchmark overlay, the
simulator modes, and the risk cards into the existing Returns / Monte-Carlo /
Risk / Health views (no new tabs), plus a Settings card exposing
`MaerminAuth.getStatus()` / sync config / passkey enrollment.

---

## Deferred — with rationale (these break "client-side + no new tabs")

| Epic | Why deferred | What it needs first |
|---|---|---|
| **8 Asset Discovery** (ETF/stock/crypto/dividend screeners, top movers) | Screening assets you **don't own** needs a live, queryable universe (fundamentals, ratios, dividends) — not derivable from local holdings. It's also a genuinely new surface. | A market-data provider (e.g. an extended Cloudflare Worker proxying a screener API) + an agreed new "Discovery" area. Owner decision: this is the one sanctioned new surface. |
| **9 Social layer** (public snapshots, shareable links, community watchlists, anonymous benchmarking) | Requires a **hosted, persistent, multi-user backend** (KV + moderation) and explicit privacy redaction. Inherently server-side; contradicts "fully client-side." | Worker `social.publish/get` actions over KV (sketched in the architecture plan), storing only %-weight redacted snapshots — never absolute values. |
| **10 Professional UX** (dashboard redesign, widget system, custom layouts, themes, keyboard nav) | **Partially shipped in v10**: dark-fintech redesign (`styles.css`/`renderer.js`) + layout persistence (`dashboard-layout.js`, key `maermin_dashboard_layout`). Remaining: drag-and-drop widget registry UI, additional themes. | A widget registry on top of `MaerminDashboard`; incremental, no backend. |

---

## Designed — next (proposed for v10.x)

New features to keep closing the gap with Parqet / getquin while staying client-side.
Each is a pure IIFE in the existing pattern; the ones that persist user data get a
reserved `localStorage` key that must be added to `backup-engine.js` `KEYS` **when
shipped** (so they round-trip in the full-vault backup, same as the v10 stores).

| # | Feature | Why it makes us better | Persists → backup key |
|---|---|---|---|
| 1 | **Rebalancing Planner** | Target weights per tag/category + drift detection + concrete buy/sell deltas to get back to target. Reuses `MaerminMetrics` + `MaerminTags`. | `maermin_rebalance_targets` |
| 2 | **Automation Rules** | "If BTC weight > 30% → alert", "on the 1st → remind to DCA". A small, evaluated rules store layered on existing alerts. | `maermin_rules` |
| 3 | **Custom Asset Categories** | Let users define categories beyond crypto/stocks/skins (e.g. real-estate, P2P, collectibles) with their own colour & icon. | `maermin_custom_categories` |
| 4 | **Watchlist Price Targets & Notes** | Per-watchlist-symbol buy/sell target + thesis note + distance-to-target, surfaced on the watchlist. | (extends `maermin_watchlist`) |
| 5 | **Snapshot-Powered Performance Cards** | Use `MaerminSnapshots` to show real 1D/1W/1M/1Y change without any API — pure consumer of the new series. | (none — derived) |
| 6 | **Tag-Based Allocation Targets & Reports** | Feed `MaerminTags.aggregate` into the Professional-Reports export and into the Rebalancing Planner. | (none — derived) |
| 7 | **Multi-Theme Engine** | Light / high-contrast / colour-blind-safe themes on top of the v10 token system. | `maermin_theme_prefs` |

Build order favours the *derived* features first (5, 6) — they ship value on top of
v10 with zero new persistence — then the planner (1) and rules (2).

---

## TypeScript migration plan (zero-rewrite)

The runtime must keep working as plain global-IIFE JS loaded from a CDN with no
bundler. So migration is **incremental and additive**, never a big-bang rewrite:

1. **Foundation (done):** `jsconfig.json` (`allowJs`, `checkJs:false`) + ambient
   `types/maermin-globals.d.ts`. Editors now type-check usage of every
   `window.Maermin*` API. No build or runtime change.
2. **Per-file opt-in:** add `// @ts-check` to the top of a clean module (start
   with `portfolio-analytics.js` — pure, dependency-free) and fix surfaced types
   with JSDoc. Still ships as JS.
3. **Graduate hot modules to `.ts`:** compile selected files with esbuild
   (already a dependency) into the *same concatenated bundle* `build.mjs`
   produces — `bundle:false, format:'iife'` transform, output dropped into the
   load order exactly where the `.js` was. Runtime identical; source typed.
4. **Flip `checkJs:true`** once the legacy files are annotated, making type
   safety the default. Order: new platform modules → `metrics.js` → views.

No step changes how the app loads or breaks backward compatibility.

---

## Verify everything

```bash
node test/vault.test.js      # security vault + at-rest migration  (25)
node test/sync.test.js       # E2E sync + conflict resolution      (10)
node test/advisor.test.js    # advisor findings engine             (15)
node test/analytics.test.js  # benchmarks + simulator + risk       (27)
node test/backup.test.js     # full-vault backup round-trip + v10 keys
node test/portfolio-snapshots.test.js  # v10 value-history engine
node test/tags.test.js                 # v10 smart-tags engine
node test/dashboard-layout.test.js     # v10 dashboard-layout engine
npm test                     # runs every test/*.test.js
npm run build:web            # production bundle + PWA assets → dist/
```
