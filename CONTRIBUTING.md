# Contributing to MAERMIN

Thanks for helping improve MAERMIN. This is a zero-dependency-at-runtime,
client-side app — the conventions below keep it that way.

## Setup

```bash
npm install
npm test           # all Node test harnesses
npm run check      # syntax-check every JS file
npm run build:web  # production bundle in dist/
```

No dev server is needed — open `index.html` directly, or serve the folder.

## Conventions

- **Module pattern:** each file is an IIFE that attaches one global
  (`window.MaerminX`) **and** exports for Node (`module.exports`). The dual
  export is what makes logic unit-testable — keep it.
- **No JSX / no TypeScript:** UI uses `React.createElement` (React via CDN).
- **No new runtime dependencies.** Browser-loaded code must stay dependency-free
  (CDN libs are pinned + SRI-hashed). `devDependencies` (esbuild/electron) are fine.
- **One source of truth:** reuse `MaerminMetrics` for cross-cutting numbers
  (positions, net worth, dividends). Don't write a second allocation/tax/risk engine.
- **Integrate, don't accrete:** prefer extending an existing view/card over
  adding a new tab.
- **EUR is canonical** internally; convert USD on ingestion, round only at display.
- **Security:** never store the password or secrets; keep sensitive keys in
  `storage.js`'s `SENSITIVE_KEYS`; don't add remote telemetry.

## Adding a module

1. Create `your-module.js` using the IIFE + dual-export pattern.
2. Add a `<script src="your-module.js">` tag in `index.html` in the right order
   (the web build picks it up automatically from there).
3. If it persists new data, add the key to `storage.js` `SENSITIVE_KEYS` (if
   sensitive) and consider a `migrations.js` entry.

## Tests

- Put a harness in `test/your-module.test.js`. Use plain `ok(name, cond)` +
  `process.exit(failed ? 1 : 0)` (see existing tests for the style).
- Crypto-dependent tests must polyfill Web Crypto for Node 18:
  `if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;`
- `npm test` must stay green on Node 18/20/22 (CI matrix).

## Commits & PRs

- Small, logically-separated commits. End commit messages with the
  `Co-Authored-By` trailer if pair-authored.
- PRs target `main`; CI (`build:web` + `test`) must pass.
- Describe **root cause** for bug fixes and **why** for changes, not just what.

## Before you push

```bash
npm run check && npm test && npm run build:web
```
