# Prompt for Claude Opus 5.5 — MAERMIN: analyze, then implement PLAN.md

Copy everything below the line into a new Claude Code session (model: Opus 5.5) opened in a
local clone of the repository.

---

You are working on **MAERMIN** (https://github.com/Maermin/MAERMIN), a fully client-side,
multi-asset portfolio tracker (stocks/ETFs, crypto, CS2 skins, commodities) that runs in the
browser. It uses React via CDN and vanilla-JS IIFE modules, stores data in an encrypted local
vault, and fetches market data through a Cloudflare Worker that each user deploys
(`cf-worker/worker.js`). It is published on GitHub Pages and is meant for **public users** in
DACH and internationally, in German and English.

## Your job

1. **Analyze the project first.** Do not change any code until you finish this step.
   - Clone or update the repo (`git clone https://github.com/Maermin/MAERMIN` or `git pull` on `main`), then run `npm ci`.
   - Read `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/WORKER.md`, `FINDINGS.md` and **`PLAN.md`**.
   - If `docs/AUDIT.security.local.md` exists in your checkout, read it too. It is git-ignored on purpose.
   - Map the architecture:
     - the load order in `index.html` and how `build.mjs` bundles it
     - how `renderer.js` (about 5,800 lines) routes views
     - where state lives: `store.js`, `ui-store.js`, `prefs-store.js`, `storage.js`, `crypto-vault.js`
     - the ledger and metrics engines (`ledger.js`, `metrics.js`)
     - the sync, backup and migrations modules
     - the translation system: `translations-complete.js`, with `t` passed as a prop
   - Run the gate once and record the baseline: `npm run check && npm test && npm run build:web && npm run test:e2e`.
   - Check every finding that PLAN.md lists against the current code. Line numbers will have drifted. Note any finding that is already fixed or no longer reproduces.
   - Give the owner a short analysis:
     - architecture in a few bullets
     - the baseline gate result
     - which findings are still open
     - any risk in the plan you disagree with, with evidence
   - Then start with package P1-1, unless the owner tells you otherwise.

2. **Implement `PLAN.md` package by package, in the order it gives** (Phase 1, then Phase 2, then Phase 3). `PLAN.md` is the source of truth for scope and decisions. Do not re-decide what it settles. If the code contradicts a premise of the plan, stop and ask the owner.

## Rules for every package

- **Process:**
  - one branch and one PR per package (`fix/p1-1-duplicate-bookings`, `feat/p2-2-i18n`, …)
  - never commit to `main`
  - the owner merges
- **The gate must pass before you open a PR:** `npm run check && npm test && npm run build:web && npm run test:e2e`.
- **Money and tax fixes are test-first.** Write a Node test that reproduces the finding with the real modules, using the reproductions in FINDINGS.md. Watch it fail, then fix it. Never weaken an existing test to make it pass.
- **Verify in the running app as well as in tests.** Serve the app locally and click through the changed flow in a browser, in DE and EN. For UI work, also check mobile width and all five themes.
- **House rules:**
  - pure logic goes in dual-export IIFE modules with Node tests, matching the existing style
  - new persisted keys go into `backup-engine.js` `KEYS`, and into `storage.js` `SENSITIVE_KEYS` when they hold sensitive data
  - data that sync merges must stay idempotent across two devices
  - no API key in client code or the repo
  - no new third-party host without asking
- **Translations (from P2-2 on, but write new text this way from the start):**
  - every new user-visible string gets a key in both `en` and `de` in `translations-complete.js`
  - numbers, currency and dates are formatted via `Intl` for the active language, never hardcoded `en-US`
- **Security:** the repo is public. Fixes for items from `docs/AUDIT.security.local.md` get neutral commit and PR wording ("harden <module>"). Never describe the vulnerability, and never commit that file.
- **Data safety:** a fix must never lose or duplicate a user's existing data. When a fix changes stored data (for example re-homing orphaned transactions or deduping), add a migration in `migrations.js` with a test, and keep the backup format compatible.
- **Every PR description has:**
  - what changed and why, with the finding IDs
  - how you verified it (test names plus what you saw in the browser)
  - what could break on merge

## Stop and ask the owner when

- a package needs a decision that PLAN.md does not settle and that changes what users see
- a fix would change stored data in a way that cannot be undone
- the Worker needs a new route or a new upstream host (P2-3 and P2-7 are already approved)
- you find a new Critical or High bug. Report it with a reproduction and don't silently fold it into an unrelated PR.

Report after each package with a few lines: what you did, the gate result, the PR link, and the next package.
