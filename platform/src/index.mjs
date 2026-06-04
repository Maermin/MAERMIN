// MAERMIN Platform kernel — public entry. Wires provider + memory + engine into
// a single runWorkflow() call. This is the seed that the NestJS `runs` service
// and BullMQ runner will call in the full system.
import { createProvider } from './providers/provider.mjs';
import { MemoryStore } from './memory/store.mjs';
import { WorkflowEngine, DEFAULT_WORKFLOW } from './workflow/engine.mjs';

export { createProvider, MemoryStore, WorkflowEngine, DEFAULT_WORKFLOW };
export { Agent, ROLES } from './agents/roles.mjs';

// One-call convenience: run a goal through the default (or custom) pipeline.
export async function runWorkflow(goal, opts = {}) {
  const provider = opts.provider || createProvider(opts.providerKind || 'mock', opts.providerOpts || {});
  const memory = opts.memory || new MemoryStore({ file: opts.memoryFile, embed: provider.embed ? provider.embed.bind(provider) : null });
  const engine = new WorkflowEngine({ provider, memory, hooks: opts.hooks });
  return engine.run(goal, opts.config || DEFAULT_WORKFLOW);
}

// CLI: `node src/index.mjs "build a billing service"`
if (import.meta.url === `file://${process.argv[1]}`) {
  const goal = process.argv.slice(2).join(' ') || 'Build an MVP web app';
  runWorkflow(goal, { hooks: { onStageEnd: ({ stage }) => console.log(`  ✓ ${stage.name} [${stage.agent}] → ${stage.status}`) } })
    .then(({ run }) => { console.log(`\nWorkflow "${run.workflow}" → ${run.status} (${run.stages.length} stages)`); })
    .catch((e) => { console.error('workflow failed:', e); process.exit(1); });
}
