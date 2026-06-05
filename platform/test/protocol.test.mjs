// Tool-protocol tests — the parser/executor units, plus the end-to-end agentic
// loop (developer agent writes a real source file through the bus, fully offline
// via MockProvider). Run: node platform/test/protocol.test.mjs
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToolCalls, executeToolCalls, renderResults } from '../src/tools/protocol.mjs';
import { Agent } from '../src/agents/roles.mjs';
import { createToolBus, createProvider, runWorkflow } from '../src/index.mjs';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

(async function run() {
  const root = mkdtempSync(join(tmpdir(), 'maermin-proto-'));
  try {
    console.log('parser:');
    ok('parses a single tool block', parseToolCalls('```tool\n{"tool":"fs.write","path":"a","content":"b"}\n```').length === 1);
    ok('parses multiple blocks', parseToolCalls('x\n```tool\n{"tool":"fs.read","path":"a"}\n```\ny\n```tool\n{"tool":"git.status"}\n```').length === 2);
    ok('parses a JSON array block', parseToolCalls('```tool\n[{"tool":"fs.list"},{"tool":"git.diff"}]\n```').length === 2);
    ok('parses JSON-lines in one block', parseToolCalls('```tool\n{"tool":"fs.list"}\n{"tool":"git.status"}\n```').length === 2);
    ok('ignores prose / no blocks', parseToolCalls('just talking, no tools here').length === 0);
    ok('ignores malformed JSON without throwing', parseToolCalls('```tool\nnot json\n```').length === 0);
    ok('drops objects lacking a tool field', parseToolCalls('```tool\n{"path":"a"}\n```').length === 0);

    console.log('executor (through the guarded bus):');
    const bus = createToolBus({ root });
    const res = await executeToolCalls(bus, [
      { tool: 'fs.write', path: 'src/x.js', content: 'export const x = 1;' },
      { tool: 'fs.read', path: 'src/x.js' },
      { tool: 'fs.list', path: 'src' }
    ]);
    ok('all calls reported ok', res.length === 3 && res.every((r) => r.ok));
    ok('fs.write actually hit disk', existsSync(join(root, 'src/x.js')));
    ok('fs.read returned the content', res[1].result === 'export const x = 1;');
    const bad = await executeToolCalls(bus, [{ tool: 'fs.read', path: '../../etc/passwd' }, { tool: 'nope.do', x: 1 }]);
    ok('guard violation surfaces as ok:false (not a throw)', bad[0].ok === false && /escape/i.test(bad[0].error));
    ok('unknown tool surfaces as ok:false', bad[1].ok === false && /unknown tool/i.test(bad[1].error));
    ok('a failing call does not abort the batch', bad.length === 2);
    ok('renderResults summarises ok + ERROR lines', /→ ok/.test(renderResults(res)) && /→ ERROR/.test(renderResults(bad)));

    console.log('agentic loop (developer writes real code, offline):');
    const ws = createToolBus({ root: join(root, 'agent') });
    const dev = new Agent('developer', createProvider('mock'));
    const out = await dev.run({ goal: 'Build a billing service', workspace: ws });
    ok('developer ran at least one tool call', Array.isArray(out.toolLog) && out.toolLog.length >= 1);
    ok('developer wrote a real source file', existsSync(join(root, 'agent', 'src/build-a-billing-service.js')));
    ok('written file is valid-looking code', /export function main/.test(readFileSync(join(root, 'agent', 'src/build-a-billing-service.js'), 'utf8')));
    ok('loop terminated cleanly (status ok)', out.status === 'ok');
    ok('transcript captured both turns', out.artifacts.includes('developer output') && out.artifacts.includes('STATUS: ok'));

    console.log('legacy path untouched (no workspace = single shot, no tools):');
    const dev2 = new Agent('developer', createProvider('mock'));
    const out2 = await dev2.run({ goal: 'Build a billing service' });
    ok('no workspace ⇒ no toolLog', out2.toolLog === undefined);
    ok('no workspace ⇒ no tool block leaks into artifact', !out2.artifacts.includes('```tool'));

    console.log('full run surfaces tool counts:');
    const wsr = createToolBus({ root: join(root, 'fullrun') });
    const { run: r } = await runWorkflow('Build a billing service', { workspace: wsr });
    const devStage = r.stages.find((s) => s.agent === 'developer');
    ok('developer stage reports tools run', devStage.tools >= 1);
    ok('the run produced source under the workspace', existsSync(join(root, 'fullrun', 'src/build-a-billing-service.js')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
