# Agent brief — MAERMIN v12 "Atlas"

You are implementing MAERMIN v12.0.0 "Atlas" (*the whole map of your wealth*) in the public repository `Maermin/MAERMIN`. The scope, order and decisions are fixed in [`PLAN.md`](../PLAN.md) → **Phase 5**. This brief tells you how to work through it. Where this brief and PLAN.md disagree, PLAN.md wins; report the mismatch.

## Read first

1. `PLAN.md`: "Decisions", "House rules", "Security", Phase 4 (for the package format you continue) and all of Phase 5.
2. `CONTRIBUTING.md`: module pattern (IIFE + dual export), no runtime dependencies, tests, commits.
3. `docs/COMPETITOR-REVIEW-2026-10.md`: why each package exists. Review ids (F1–F4, D1–D5, N1–N23, Tier 1–3) point here.
4. `docs/ARCHITECTURE.md`, `docs/WORKER.md`, `ROADMAP.md`, `FINDINGS.md`, `docs/REVIEW-2026-09.md` § 8.
5. The Progress table at the end of `PLAN.md` and `git log --oneline -30`.

## How each package runs

1. **Pick** the first Phase 5 package in the Progress table that is not `merged`, in milestone order (M1 → M5) and the order inside each milestone table.
2. **Plan, then wait.** Post a plan to the owner before writing code: files touched, public API, storage keys (and whether they go into `backup-engine.js` `KEYS` and `storage.js` `SENSITIVE_KEYS`), migrations, translation keys, tests, Worker routes and version bump, and every mismatch between the code and PLAN.md's text. Write no code until the owner approves.
3. **Branch** `atlas/p5-<milestone>.<n>-<short-name>` from the latest `main`.
4. **Build test-first** for anything that changes money, tax or stored data: a failing Node test first, then the fix. Every new UI string goes through `__()` with keys in `en` and `de`. Theme colours from tokens; filled buttons use `accentFill` / `onColor`.
5. **Gate** before every push: `npm run check && npm test && npm run build:web && npm run test:e2e`. Add or extend an e2e scenario when the package changes what a user sees.
6. **PR** into `main`, one per package. The body states what changed and why, how it was tested, screenshots for visible changes (demo data only), and a rollback note: one-way or two-way door, who is affected, whether stored data changes and how a user gets back.
7. **Progress table:** in the same PR set the row to `in review`, fill branch and PR, and add the notes a future agent needs (decisions taken, gaps left).
8. **Merge:** the owner merges. Never push to `main` directly. If the owner explicitly hands you merge rights again, merge only after CI is green, then set the row to `merged`.

## Milestone stops

After the last package of each milestone (M1 Foundation, M2 Insight, M3 Connect, M4 Tax, M5 Platform), stop and send a milestone report:

- packages merged, with PR links;
- what a user now sees (screenshots from demo mode, desktop and phone, DE and EN);
- open issues and anything moved to a later package;
- owner tasks that block the next milestone;
- the plan for the first package of the next milestone.

Continue only after the owner approves the milestone.

## Fixed constraints

- **Privacy model.** No MAERMIN server sees user data. The user's own Worker only ever stores ciphertext for sync. The shared Worker (P5-3.1) serves market data only and must refuse every route that carries user data. MCP over full data runs only as a local process (P5-5.2); `?action=mcp` on the Worker stays redacted.
- **No secrets in the repo or in client code.** API keys (SnapTrade, GoCardless, exchange keys, FinTS product ID) are configuration: the user's keys live in the encrypted vault; the owner's FinTS product ID and shared-Worker settings live in Worker variables.
- **Security findings** go only into the git-ignored `docs/AUDIT.security.local.md`; commits and PRs use neutral wording such as "harden <module>".
- **No new runtime dependencies** in browser code. CDN libraries stay pinned with SRI. The `mcp/` package may have its own minimal Node dependencies (vet each one: name, publisher, download count, repository).
- **One source of truth:** extend `ledger.js`, `MaerminMetrics`, the tax engines and `data-check.js`; do not build parallel engines. Integrate into existing views before adding new ones; new views go into `nav-model.js` (Simple/Advanced).
- **Data from third parties** (issuer holdings files, explorer APIs, research data, HICP, tax sources): check and note each source's terms in the plan; cache through the Worker; cite tax sources in code comments and get the owner's approval for AT/CH rule sources before writing the engines.
- **Disclaimers:** tax, simulator, verdict and research features carry the existing "no tax or investment advice — estimates only" wording.
- **Demo:** every new feature must show something meaningful in demo mode (P5-1.7/1.8 provide the data). Never commit real statements, account data or personal data; fixtures are made up.

## Owner tasks you may need

FinTS product registration with the Deutsche Kreditwirtschaft (P5-3.4); running the price-only Worker under the owner's Cloudflare account (P5-3.1); publishing `maermin-mcp` to npm (P5-5.2); approving AT/CH tax sources (P5-4.9/4.10); running the release workflow (P5-5.9). When one blocks you, finish what can be done behind a flag, say so in the PR, and list it in the milestone report.

## After a context reset

Read the Progress table and `git log`, then continue with the first Phase 5 package that is not merged. If a PR is open for it, read its comments before doing anything else.

## Done means

All 50 Phase 5 packages merged, the gate green on `main`, RELEASE.md has a v12.0.0 "Atlas" section, `package.json` says 12.0.0, the README describes Atlas, and the owner has run the release workflow.
