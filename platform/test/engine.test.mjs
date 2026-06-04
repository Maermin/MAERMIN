// Kernel tests — exercise the full multi-agent workflow with the deterministic
// MockProvider (no network/keys). Run: node platform/test/engine.test.mjs
import { runWorkflow, WorkflowEngine, MemoryStore, createProvider, DEFAULT_WORKFLOW } from '../src/index.mjs';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

(async function run() {
  console.log('default pipeline:');
  const { run, artifacts } = await runWorkflow('Build a billing service');
  ok('runs all 7 stages', run.stages.length === DEFAULT_WORKFLOW.stages.length);
  ok('completes when no gate fails', run.status === 'completed');
  ok('stages execute in configured order', run.stages.map(s => s.name).join(',') === 'architecture,planning,implementation,testing,security,documentation,deployment');
  ok('every stage produced an artifact', Object.keys(artifacts).length === run.stages.length);
  ok('architect decision captured', run.stages[0].decisions.length > 0);

  console.log('memory persistence + recall:');
  const mem = new MemoryStore();
  const eng = new WorkflowEngine({ provider: createProvider('mock'), memory: mem });
  await eng.run('Add OAuth login');
  ok('history written for each stage', mem.all({ kind: 'history' }).length === DEFAULT_WORKFLOW.stages.length);
  ok('architecture decisions recorded', mem.all({ kind: 'architecture' }).length > 0);
  const hits = await mem.search('oauth login', 5);
  ok('memory is searchable (recall works)', hits.length > 0);

  console.log('blocking gates:');
  const failProvider = createProvider('mock', { fail: { test: true } });
  const r2 = await new WorkflowEngine({ provider: failProvider }).run('Ship feature');
  ok('failed test gate blocks the pipeline', r2.run.status === 'blocked');
  ok('blocked at the test stage', r2.run.blockedAt === 'testing');
  ok('downstream stages did not run', !r2.run.stages.find(s => s.name === 'deployment'));

  const secFail = createProvider('mock', { fail: { security: true } });
  const r3 = await new WorkflowEngine({ provider: secFail }).run('Ship feature');
  ok('failed security gate blocks too', r3.run.status === 'blocked' && r3.run.blockedAt === 'security');
  ok('non-gate stages before it completed', r3.run.stages.find(s => s.name === 'implementation').status === 'ok');

  console.log('configurable workflow:');
  const custom = { name: 'quick', stages: [{ name: 'architecture', agent: 'architect' }, { name: 'documentation', agent: 'docs' }] };
  const r4 = await runWorkflow('Spike', { config: custom });
  ok('custom pipeline runs only its stages', r4.run.stages.length === 2 && r4.run.status === 'completed');

  console.log('provider adapter:');
  ok('factory returns named providers', createProvider('claude', { apiKey: 'x' }).name === 'claude' && createProvider('openai', { apiKey: 'x' }).name === 'openai' && createProvider('mock').name === 'mock');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
