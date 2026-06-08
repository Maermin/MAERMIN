# MAERMIN Platform — M1 Kernel

The runnable seed of the **autonomous AI software-engineering platform** (a
separate product from the MAERMIN portfolio tracker). Full design:
[`../docs/PLATFORM-ARCHITECTURE.md`](../docs/PLATFORM-ARCHITECTURE.md).

This M1 kernel implements, with **zero external dependencies** and a passing test
suite, the three load-bearing pieces of the system:

- **Provider adapter** (`src/providers`) — swappable model layer
  (`MockProvider` for offline/tests, `ClaudeProvider`, `OpenAIProvider`; Gemini/
  local slot in via the same interface).
- **Multi-agent workflow engine** (`src/workflow`, `src/agents`) — a
  *configurable* pipeline (Idea → Architecture → Plan → Implement → Test →
  Security → Docs → Deploy) of specialised agents, with **blocking quality
  gates** (test/security can halt the run).
- **Project memory** (`src/memory`) — persistent, searchable knowledge with a
  vector-ready retrieval interface (lexical today, pgvector later).
- **Sandboxed tool bus** (`src/tools/bus.mjs`) — the execution substrate that lets
  agents actually touch a repo: capability-scoped `fs` / `shell` / `git` / `http`,
  all rooted in a sandbox dir, with path-traversal blocking, an SSRF allow-list, and
  an append-only audit log (the §13 guards).
- **Tool-calling loop** (`src/tools/protocol.mjs`) — a provider-agnostic text
  protocol (fenced `​`​`​`tool` JSON blocks): the agent emits tool calls, the bus runs
  them, results are fed back for the next turn (bounded). Give a run a `workspace`
  (a `ToolBus`) and agents **write real source files** — e.g. the developer agent
  scaffolds code on disk — while every step lands in the audit log. Same channel for
  Mock and real models, so the loop is fully testable offline.
- **Changeset finalizer** (`src/tools/commit.mjs`) — `commitWorkspace()`, or
  `runWorkflow(goal, { commit: true, branch })`, turns a completed run's files into a
  single **committed, reviewable git changeset** (init → branch → add → commit, no
  empty commits). The local half of "open a PR"; the network push lands with the
  runner.
- **Verify-grounded auto-fix loop** (`src/workflow/engine.mjs`) — a failed gate is
  no longer a dead end. Give a stage a `verify` (a shell command or fn) and its
  pass/fail is decided by **real execution**, not the model's self-report. When a
  gate or verify fails, the engine hands the actual failure back to the developer
  agent, which repairs the workspace; the stage re-runs and re-verifies, up to
  `maxRepairs` times (default 2, `0` to opt out). Only an exhausted budget blocks
  the run. This is the autonomy core — *iterate toward green* instead of stop.
- **Release-readiness report** (`src/workflow/report.mjs`) — every run carries
  `result.report`: a readiness score (0–100) and level — `ship` (clean first pass),
  `caution` (completed but needed auto-fixes), or `blocked` — plus per-stage gate /
  verify / repair status, files written and tool-op counts. `formatReport()` renders
  it for the CLI; it is a pure projection, ready for the API/dashboard.

## Run

```bash
cd platform
npm test                 # 5 suites, 98 assertions, all green
npm run demo "Build a billing service with Stripe"   # prints the readiness report
```

```js
import { runWorkflow, createProvider, createToolBus } from './src/index.mjs';

// Offline (deterministic):
const { run } = await runWorkflow('Add OAuth login');

// Real model:
await runWorkflow('Add OAuth login', {
  provider: createProvider('claude', { apiKey: process.env.ANTHROPIC_API_KEY })
});

// With a sandboxed workspace — stage artifacts land as real files on disk,
// and agents can run fs/git/shell/http through the audited, guarded bus:
const workspace = createToolBus({ root: './.runs/oauth', allowHosts: ['api.github.com'] });
const { report } = await runWorkflow('Add OAuth login', { workspace });
// → stage artifacts at ./.runs/oauth/runs/<ts>/NN-stage.md, AND real source the
//   developer agent wrote (e.g. ./.runs/oauth/src/…); workspace.audit holds every op.

// Verify-grounded auto-fix: decide a stage by a REAL command; on failure the
// engine repairs the workspace and retries before it ever blocks.
import { formatReport } from './src/index.mjs';
const config = {
  name: 'verified', maxRepairs: 2,
  stages: [
    { name: 'implementation', agent: 'developer', verify: 'node --check src/app.mjs' },
    { name: 'testing', agent: 'test', gate: true, verify: 'npm test' }
  ]
};
const res = await runWorkflow('Add OAuth login', { workspace, config });
console.log(formatReport(res.report));   // RELEASE READINESS — SHIP/CAUTION/BLOCKED …
```

## What's intentionally NOT here yet

The cloud/runtime tier (NestJS API, Postgres/Prisma, Redis/BullMQ runner,
Next.js workspace, container isolation for the tool bus, deployment adapters) is
**designed** in the architecture doc but not stood up in this sandbox — it needs
real services to run and verify. This kernel is the exact code those services will
call (it maps 1:1 to `packages/{providers,workflow,agents,memory,tools}` in the
target monorepo).

The tool bus enforces its guards (sandbox root, SSRF allow-list, audit) in-process;
the production runner additionally wraps each run in an ephemeral, network-restricted
**container**. Next concrete step: real **GitHub PR output** (branch → push → open
PR) — needs a remote + token, so it lands with the runner, not in this offline seed.
