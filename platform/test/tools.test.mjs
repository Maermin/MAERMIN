// Tool-bus tests — prove the §13 guards actually hold, plus the engine→disk
// integration. No network is hit (SSRF cases assert the request is REJECTED before
// any fetch). Run: node platform/test/tools.test.mjs
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolBus, createToolBus, runWorkflow } from '../src/index.mjs';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
async function throws(fn, match) {
  try { await fn(); return false; }
  catch (e) { return match ? new RegExp(match, 'i').test(e.message) : true; }
}

(async function run() {
  const root = mkdtempSync(join(tmpdir(), 'maermin-bus-'));
  try {
    console.log('fs confinement:');
    const bus = createToolBus({ root, allowHosts: ['api.example.com'] });
    await bus.fs.write('src/app.js', 'console.log(1)');
    ok('write+read round-trips inside root', await bus.fs.read('src/app.js') === 'console.log(1)');
    ok('write creates parent dirs + lands on disk', existsSync(join(root, 'src/app.js')));
    ok('list reflects written files', (await bus.fs.list('src')).some((e) => e.name === 'app.js'));
    ok('exists is true for written / false for absent', await bus.fs.exists('src/app.js') && !(await bus.fs.exists('nope.js')));

    console.log('path-traversal + escape guards:');
    ok('rejects ../ traversal', await throws(() => bus.fs.read('../../etc/passwd'), 'escape'));
    ok('rejects absolute paths', await throws(() => bus.fs.write('/etc/x', 'y'), 'absolute'));
    ok('rejects sneaky nested traversal', await throws(() => bus.fs.write('src/../../out', 'y'), 'escape'));
    ok('confirmed nothing escaped root', !existsSync(join(root, '..', 'out')));

    console.log('capability scoping:');
    const noShell = createToolBus({ root, caps: { shell: false } });
    ok('denied capability throws (no silent no-op)', await throws(() => noShell.shell.exec('echo hi'), 'capability denied'));

    console.log('shell:');
    const r = await bus.shell.exec('printf hello');
    ok('exec captures stdout + exit code', r.stdout === 'hello' && r.code === 0);
    const ra = await bus.shell.exec('node', { args: ['-e', 'process.stdout.write(String(2+2))'] });
    ok('arg-array form bypasses the shell', ra.stdout === '4' && ra.code === 0);
    ok('non-zero exit is reported, not thrown', (await bus.shell.exec('node -e "process.exit(3)"')).code === 3);

    console.log('git (real repo round-trip):');
    const repo = createToolBus({ root: join(root, 'gitrepo') });
    await repo.git.init();
    await repo.shell.exec('git', { args: ['config', 'user.email', 't@t.io'] });
    await repo.shell.exec('git', { args: ['config', 'user.name', 'Test'] });
    await repo.fs.write('README.md', '# hi');
    await repo.git.add();
    await repo.git.commit('initial');
    ok('init→add→commit produces a clean tree', (await repo.git.status()).stdout.trim() === '');
    await repo.git.branch('feature/x');
    ok('branch checkout switches HEAD', (await repo.git.currentBranch()).stdout.trim() === 'feature/x');

    console.log('http SSRF allow-list (no network hit — all rejected pre-fetch):');
    ok('blocks host not on allow-list', await throws(() => bus.http.fetch('https://evil.com/x'), 'allow-list'));
    ok('blocks loopback even if shaped like a url', await throws(() => bus.http.fetch('http://127.0.0.1/'), 'private|loopback|allow-list'));
    ok('blocks link-local metadata IP', await throws(() => bus.http.fetch('http://169.254.169.254/latest/meta-data'), 'private|loopback|allow-list'));
    ok('blocks non-http protocols', await throws(() => bus.http.fetch('file:///etc/passwd'), 'protocol'));
    ok('git.clone is gated by the same allow-list', await throws(() => bus.git.clone('https://evil.com/r.git'), 'allow-list'));

    console.log('audit trail:');
    ok('every op is recorded append-only', bus.audit.length > 0 && bus.audit.every((e) => 'tool' in e && 'op' in e && 'ok' in e && 'at' in e));
    ok('rejected ops are recorded as ok:false', bus.audit.some((e) => e.ok === false));
    const sink = [];
    const watched = createToolBus({ root, onAudit: (e) => sink.push(e) });
    await watched.fs.write('a.txt', '1');
    ok('onAudit sink receives events live', sink.length === 1 && sink[0].op === 'write');

    console.log('engine → disk integration:');
    const ws = createToolBus({ root: join(root, 'wsrun') });
    const { run: wrun } = await runWorkflow('Build a thing', { workspace: ws });
    ok('run still completes with a workspace', wrun.status === 'completed');
    ok('each stage recorded an artifactPath', wrun.stages.every((s) => typeof s.artifactPath === 'string'));
    const first = wrun.stages[0];
    ok('artifact file actually exists on disk', existsSync(join(root, 'wsrun', first.artifactPath)));
    ok('artifact file holds the agent output', readFileSync(join(root, 'wsrun', first.artifactPath), 'utf8').includes('STATUS: ok'));

    console.log('backward compatibility:');
    const { run: plain } = await runWorkflow('No workspace');
    ok('runs without a workspace are unchanged (no artifactPath)', plain.stages.every((s) => s.artifactPath === undefined));

    console.log('constructor guard:');
    ok('ToolBus requires a root', (() => { try { new ToolBus({}); return false; } catch { return true; } })());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
