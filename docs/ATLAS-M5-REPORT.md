# Atlas M5 · Platform — milestone report

State of `main` after P5-5.9, 2026-10-15. This closes Phase 5 "Atlas"; the version is now 12.0.0.
- **Screenshots:** made-up data only (seeded vaults, the demo and mocked market data). Desktop 1440 × 900 in English and German, phone 390 × 844 in English, in `docs/screenshots/atlas-p5-5.*/`, one folder per package.
- **Merging:** the agent merged each PR after both CI jobs passed, as the owner allowed. Since 2026-10-14 no package waits for an approval; each was decided as recommended.

## Merged

| Package | PR |
|---|---|
| P5-5.1 Web push | https://github.com/Maermin/MAERMIN/pull/172 |
| P5-5.2 Local MCP server | https://github.com/Maermin/MAERMIN/pull/173 |
| P5-5.3 Budget and spending | https://github.com/Maermin/MAERMIN/pull/174 |
| P5-5.4 Research pages | https://github.com/Maermin/MAERMIN/pull/175 |
| P5-5.5 Event feed and ICS export | https://github.com/Maermin/MAERMIN/pull/176 |
| P5-5.6 Serverless sync transports | https://github.com/Maermin/MAERMIN/pull/177 |
| P5-5.7 Saving goals with glide path | https://github.com/Maermin/MAERMIN/pull/178 |
| P5-5.8 Positioning and README | https://github.com/Maermin/MAERMIN/pull/179 |
| P5-5.9 Release v12.0.0 "Atlas" | this PR |

## What a user sees

- **Push reminders (Security & sync):**
  - dividend pay dates, the Vorabpauschale in December, crypto lots turning tax-free and the IRA deadline reach a closed app;
  - optional price rules are checked by the Worker;
  - the lock screen shows generic text unless details are switched on.
- **AI on your own computer:** `maermin-mcp` answers an assistant's questions about positions, performance, dividends, tax and allocation from the encrypted backup. Amounts are shown only with `--amounts`.
- **Budget (Portfolio → Budget):** bank CSV exports or FinTS / GoCardless rows, categories with rules, splits, monthly budgets, a cash-flow Sankey and recurring payments.
- **Research (Analysis → Research, or from a position):** key figures, analysts and targets, EPS surprises, a profile, a chart with SMA / EMA / MACD / Bollinger, and your own position and journal.
- **Events (Portfolio → Events):** earnings, ex- and pay dates, splits, savings plans, tax dates and ECB/Fed decisions for the next 120 days, exported as an .ics calendar.
- **Serverless sync (Security & sync):** besides your Worker, a file (Syncthing, Dropbox, NAS) or a WebDAV/Nextcloud folder, with the same encryption and signature.
- **Saving goals (Strategy → Goals):** linked to a portfolio or a tag, with a glide path, ahead / on track / behind, the monthly amount needed and a risk glide.
- **README and landing text:** say plainly that the German tax tools are built in; Atlas screenshots and an updated comparison column.
- **Release 12.0.0:** release notes with upgrade notes, the version in the header, the title and the offline cache.

| Package | Screenshots |
|---|---|
| P5-5.1 … P5-5.7 | `atlas-p5-5.<n>/` (desktop en/de, phone en) |

## Privacy model, checked per package

- **No server sees user data in plaintext:**
  - Push messages are encrypted in the browser to the device's own subscription (RFC 8291); the Worker stores ciphertext.
  - File and WebDAV sync store the same encrypted record as the Worker; the client checks its MAC on every read.
  - The event feed and research send only symbols, as the price requests already did.
- **The shared Worker serves market data only:** research is market data and is allowed there. Push, sync, FinTS and wallets are not.
- **MCP over full data runs only locally:**
  - `maermin-mcp` reads a local file. Its one network call, on request, is the user's own sync blob.
  - Credentials and personal data are dropped before any tool sees the data.
- **New sensitive keys** are encrypted at rest and listed below.

## Differences from PLAN.md (decided as recommended)

- **P5-5.1:** weight, total-value and drawdown rules and the risk monitor stay in-app, because they need the whole portfolio. The Worker sees symbol and threshold only for opt-in price rules.
- **P5-5.2:**
  - The password comes only from `MAERMIN_PASSWORD` or `--password-file`, never from argv.
  - The backup has no FX history, so `--usd-eur` converts non-EUR prices.
  - Publishing to npm is the owner's task.
- **P5-5.3:** the budget is a ledger of its own (`maermin_budget`), never mixed with portfolio transactions.
- **P5-5.4:** dividends on the research page are the dividend yield and the dividends you received. The full history stays in Dividends → History. Yahoo data is for personal use, as named on the page.
- **P5-5.5:** macro dates are the published ECB and Fed schedules for 2026–2027 in the code. They need an update for 2028.
- **P5-5.6:**
  - `connect-src` stays a fixed list. A self-built copy adds its WebDAV host with `MAERMIN_CONNECT_SRC`.
  - The published app reaches WebDAV only on `*.workers.dev`, and a blocked host gets its own message.
  - The file transport needs File System Access, which only Chromium-based browsers have.
- **P5-5.7:** the existing goals grew instead of a second goals feature being added.
- **P5-5.9:** the GitHub release itself is created by the owner with the Release workflow.

## Storage added in M5 (no migrations)

| Key | Package | Sensitive | In backup |
|---|---|---|---|
| `maermin_push` | P5-5.1 | yes (subscription, box token) | no (device-local) |
| `maermin_budget` | P5-5.3 | yes (bank bookings, rules, budgets) | yes, and synced |
| `maermin_webdav` | P5-5.6 | yes (WebDAV address and login) | no (device-local) |
| `maermin_sync_file` (IndexedDB) | P5-5.6 | no (a file handle) | no |
| `investmentGoals[].link`, `expectedReturn`, `startDate`, `startValue`, `glide` | P5-5.7 | (existing key) | yes |

## Test state

- 205 unit suites; e2e 594 passed, 0 failed.
- The Worker-backed e2e checks (research, events, sync) run against the real `worker.js` with their own documentation-range client IPs, so the shared per-IP rate limit no longer causes 429s.
- WebDAV is tested against an in-memory server: ETag conflicts, a wrong MAC, another vault's file, and a host blocked by the security policy.

## Owner tasks

1. **Redeploy the Worker** (2026.10.14). This adds push, research, and the earnings and ex-dates; the cron trigger is in `wrangler.toml`.
2. **Publish `maermin-mcp`** to npm (`cd mcp && npm publish`).
3. **Run the Release workflow** (Actions → Release): tag `MAERMIN_v12`, title `MAERMIN v12 "Atlas"`, version `v12.0.0`.
4. **Still open from M3:** the FinTS product ID; deploy the shared price Worker; optional tests with real keys.
5. **Optional:** check the Jahressteuerbescheinigung parser against a real certificate (from M4); the 2027 IRS limits when published.

## Next

Phase 5 is complete. PLAN.md has no Phase 6 yet; the competitor review's remaining gaps (`docs/COMPETITOR-REVIEW-2026-10.md`) are the natural input for it.
