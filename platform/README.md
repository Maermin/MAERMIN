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

## Run

```bash
cd platform
npm test                 # 15 assertions, all green
npm run demo "Build a billing service with Stripe"
```

```js
import { runWorkflow, createProvider } from './src/index.mjs';

// Offline (deterministic):
const { run } = await runWorkflow('Add OAuth login');

// Real model:
await runWorkflow('Add OAuth login', {
  provider: createProvider('claude', { apiKey: process.env.ANTHROPIC_API_KEY })
});
```

## What's intentionally NOT here yet

The cloud/runtime tier (NestJS API, Postgres/Prisma, Redis/BullMQ runner,
Next.js workspace, sandboxed tool bus, deployment adapters) is **designed** in the
architecture doc but not stood up in this sandbox — it needs real services to run
and verify. This kernel is the exact code those services will call (it maps 1:1 to
`packages/{providers,workflow,agents,memory}` in the target monorepo).
