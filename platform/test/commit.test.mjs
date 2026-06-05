// Changeset finalizer tests — real git (in this env), fully offline. Proves the
// "goal → committed, reviewable changeset" arc and the no-op-when-clean behavior.
// Run: node platform/test/commit.test.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createToolBus, commitWorkspace, runWorkflow } from '../src/index.mjs';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

(async function run() {
  const root = mkdtempSync(join(tmpdir(), 'maermin-commit-'));
  try {
    console.log('commitWorkspace on a fresh dir:');
    const bus = createToolBus({ root: join(root, 'a') });
    await bus.fs.write('src/app.js', 'export const x = 1;\n');
    await bus.fs.write('README.md', '# demo\n');
    const cs = await commitWorkspace(bus, { message: 'feat: initial', branch: 'feature/seed' });
    ok('inits + commits a fresh workspace', cs.committed === true);
    ok('returns a short sha', typeof cs.sha === 'string' && cs.sha.length > 0);
    ok('lands on the requested branch', cs.branch === 'feature/seed');
    ok('reports the committed files', cs.files.includes('src/app.js') && cs.files.includes('README.md'));

    console.log('no-op when nothing changed:');
    const cs2 = await commitWorkspace(bus, { message: 'feat: nothing' });
    ok('clean tree ⇒ committed:false (no empty commit)', cs2.committed === false);

    console.log('second change commits again:');
    await bus.fs.write('src/app.js', 'export const x = 2;\n');
    const cs3 = await commitWorkspace(bus, { message: 'fix: bump' });
    ok('a real change produces a new commit', cs3.committed === true && cs3.sha !== cs.sha);

    console.log('full run → goal becomes a committed changeset:');
    const ws = createToolBus({ root: join(root, 'run') });
    const { run: r, changeset } = await runWorkflow('Build a billing service', { workspace: ws, commit: true, branch: 'feature/billing' });
    ok('run completed', r.status === 'completed');
    ok('changeset committed the run', changeset && changeset.committed === true);
    ok('on the feature branch', changeset.branch === 'feature/billing');
    ok('committed the agent-written source', changeset.files.some((f) => f.startsWith('src/') && f.endsWith('.js')));
    ok('committed the stage artifacts too', changeset.files.some((f) => f.startsWith('runs/')));

    console.log('opt-out is the default:');
    const ws2 = createToolBus({ root: join(root, 'run2') });
    const res = await runWorkflow('No commit please', { workspace: ws2 });
    ok('no commit flag ⇒ no changeset', res.changeset === undefined);
    ok('and the workspace is not a git repo', (await ws2.fs.exists('.git')) === false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
