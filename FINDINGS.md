# MAERMIN open findings — 2026-10-24 (after the audit of v12.2.0)

**No open findings.** The 9 findings of the 2026-10-24 audit (none Critical or High) are fixed; details in [docs/AUDIT.md](docs/AUDIT.md), section "Run 2026-10-24":

| ID | Sev. | Finding | Fixed in |
|---|---|---|---|
| V-1 | Medium | Key figures cut off with "…" (desktop Overview, phone Net Worth) | #244 |
| U-1 | Medium | Research is empty in demo mode; its Worker notice has no way to API Settings | #245 |
| V-2 | Low | Net-worth projection chart labels unreadable on phones | #244 |
| V-3 | Low | Holdings map labels are 4-letter glyphs, not tickers | #246 |
| V-4 | Low | FIFO table: bold "+0.00 €" rows, sold-out holdings listed and counted | #246 |
| U-2 | Low | Upcoming dividends: about 60 rows in one list | #246 |
| U-3 | Low | Mixed British / American spelling and Title Case | #247 |
| F-1 | Low | Theme named "Nebula" in the menu, "Purple" in docs and keys | #247 |
| D-1 | Low | `fire-extras.js` loaded and tested but never used | this PR |

Earlier lists:

The 2026-10-05 list (36 items) is closed: 34 items were fixed in the P1/P2 packages and
released with v11 and v12. The last two (M-4 DCA analyzer, M-15 FIFO per depot) were
fixed in this run. The run's own findings (bugs B-1…B-5, visual V-1…V-7, usability U-1…U-6,
dead code D-1…D-4) are fixed or checked. See [docs/AUDIT.md](docs/AUDIT.md), section
"Run 2026-10-16".

The follow-ups the run left are closed too:

| ID | Follow-up | Fixed in |
|---|---|---|
| O-1 | Planning views (sell simulator, harvest planner, cost methods) ignored "separate depot" | #189 |
| O-2 | Backgrounds and borders on fixed Tailwind colours | #191 |
| O-3 | 49 inline font sizes outside a type scale | #192 |
| O-4 | Empty and loading states each with their own look | #190 |
| O-5 | "Needs your Worker" notices without a way to API Settings | #190 |

**Security findings are not listed here.** The repository is public, so security issues
stay in the git-ignored `docs/AUDIT.security.local.md` until they are fixed and released.
This run found 4 there, all Low, all fixed in #184. SEC-009 stays open by the owner's decision.

Severity scale for new entries: **Critical** = wrong money or tax figures in a realistic
case, or data loss · **High** = a core feature is broken or misleading · **Medium** = real
friction, or wrong in an edge case · **Low** = polish.
