// MAERMIN Platform kernel — public entry. Wires provider + memory + engine into
// a single runWorkflow() call. This is the seed that the NestJS `runs` service
// and BullMQ runner will call in the full system.
import { createProvider } from './providers/provider.mjs';
import { MemoryStore } from './memory/store.mjs';
import { WorkflowEngine, DEFAULT_WORKFLOW } from './workflow/engine.mjs';
import { createToolBus } from './tools/bus.mjs';
import { commitWorkspace } from './tools/commit.mjs';
import { buildReport, formatReport } from './workflow/report.mjs';

export { createProvider, MemoryStore, WorkflowEngine, DEFAULT_WORKFLOW };
export { Agent, ROLES } from './agents/roles.mjs';
export { ToolBus, createToolBus } from './tools/bus.mjs';
export { commitWorkspace } from './tools/commit.mjs';
export { buildReport, formatReport } from './workflow/report.mjs';

// One-call convenience: run a goal through the default (or custom) pipeline.
// Pass opts.workspace (a ToolBus) — or opts.workspaceRoot — to give the run a
// sandboxed execution substrate: stage artifacts are then written to real files
// through the audited bus instead of living only in memory.
export async function runWorkflow(goal, opts = {}) {
  const provider = opts.provider || createProvider(opts.providerKind || 'mock', opts.providerOpts || {});
  const memory = opts.memory || new MemoryStore({ file: opts.memoryFile, embed: provider.embed ? provider.embed.bind(provider) : null });
  const workspace = opts.workspace || (opts.workspaceRoot ? createToolBus({ root: opts.workspaceRoot }) : null);
  const engine = new WorkflowEngine({ provider, memory, workspace, hooks: opts.hooks, maxRepairs: opts.maxRepairs });
  const result = await engine.run(goal, opts.config || DEFAULT_WORKFLOW);

  // Every run carries a release-readiness report (pure projection of the run).
  result.report = buildReport(result, { workspace });

  // opts.commit (true | a commit message) finalizes a successful run into a single
  // reviewable git changeset in the workspace.
  if (opts.commit && workspace && result.run.status === 'completed') {
    const message = typeof opts.commit === 'string' ? opts.commit : `feat: ${goal}`;
    result.changeset = await commitWorkspace(workspace, { message, branch: opts.branch });
  }
  return result;
}

// CLI: `node src/index.mjs "build a billing service"`
if (import.meta.url === `file://${process.argv[1]}`) {
  const goal = process.argv.slice(2).join(' ') || 'Build an MVP web app';
  runWorkflow(goal, {
    hooks: {
      onStageEnd: ({ stage }) => console.log(`  ${stage.status === 'ok' ? '✓' : '✗'} ${stage.name} [${stage.agent}] → ${stage.status}${stage.repairs ? ` (after ${stage.repairs} auto-fix)` : ''}`),
      onRepair: ({ stage, attempt }) => console.log(`  ↻ auto-fix ${stage.name} (attempt ${attempt})`)
    }
  })
    .then(({ report }) => { console.log('\n' + formatReport(report)); })
    .catch((e) => { console.error('workflow failed:', e); process.exit(1); });
}
