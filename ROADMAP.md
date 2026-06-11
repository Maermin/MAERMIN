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
| **10 Professional UX** (dashboard redesign, widget system, custom layouts, themes, keyboard nav) | Large UX effort touching the whole renderer; best done once the above features exist so the dashboard surfaces them. Mobile-first foundation already started in `styles.css`. | A widget registry + layout persistence layer; incremental, no backend. |

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
npm run build:web            # production bundle + PWA assets → dist/
```
