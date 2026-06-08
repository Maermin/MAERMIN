// Auto-fix loop + release-readiness report — the autonomy core.
// Proves the engine (a) grounds a stage in a REAL command, (b) repairs the
// workspace and recovers when that command fails, (c) gives up after a bounded
// budget, and (d) reports readiness. Fully offline. Run: node test/autofix.test.mjs
import os from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWorkflow, WorkflowEngine, createProvider, createToolBus, buildReport, formatReport } from '../src/index.mjs';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

// A provider that writes BROKEN code on its first developer turn and valid code
// on every turn after — so a `node --check` verify fails first, then passes once
// the auto-fix loop hands the failure back. Deterministic, no network.
class FlakyDevProvider {
  constructor() { this.name = 'flaky'; this.writes = 0; }
  async complete({ system = '', prompt = '' }) {
    const role = (system.match(/ROLE:\s*([\w-]+)/) || [])[1] || 'agent';
    const canTools = /AVAILABLE TOOLS/.test(prompt);
    const afterResults = /TOOL RESULTS/.test(prompt);
    if (role === 'developer' && canTools && !afterResults) {
      this.writes++;
      const content = this.writes === 1 ? 'export const x = ;\n' : 'export const x = 1;\n';
      return ['STATUS: ok', '```tool', JSON.stringify({ tool: 'fs.write', path: 'src/app.mjs', content }), '```'].join('\n');
    }
    return `STATUS: ok\n# ${role} output`;
  }
}

(async function main() {
  // ---- (1) verify-grounded auto-fix recovers a real failure ----------------
  console.log('verify-grounded auto-fix (recovers a real node --check failure):');
  const root = mkdtempSync(join(os.tmpdir(), 'maermin-autofix-'));
  const workspace = createToolBus({ root });
  const config = {
    name: 'verify-demo', maxRepairs: 2,
    stages: [{ name: 'implementation', agent: 'developer', verify: 'node --check src/app.mjs' }]
  };
  const r1 = await runWorkflow('build x', { provider: new FlakyDevProvider(), workspace, config });
  const impl = r1.run.stages.find((s) => s.name === 'implementation');
  ok('run completes after repair', r1.run.status === 'completed');
  ok('stage was verified against a real command', impl.verified === true);
  ok('stage needed exactly one repair', impl.repairs === 1);
  ok('stage is marked recovered', impl.recovered === true);
  ok('run-level repair counter incremented', r1.run.repairs === 1);
  ok('the broken file was actually fixed on disk', readFileSync(join(root, 'src/app.mjs'), 'utf8').includes('export const x = 1;'));
  ok('report: completed-with-fixes ⇒ caution at 100', r1.report.level === 'caution' && r1.report.readiness === 100);
  ok('report lists the written source file', r1.report.files.includes('src/app.mjs'));
  ok('formatReport renders without throwing', typeof formatReport(r1.report) === 'string' && formatReport(r1.report).includes('RELEASE READINESS'));

  // ---- (2) bounded give-up: failure past the budget blocks -----------------
  console.log('bounded give-up (gate that never passes blocks after N repairs):');
  const r2 = await new WorkflowEngine({ provider: createProvider('mock', { fail: { test: true } }) }).run('ship it');
  ok('blocks when repairs are exhausted', r2.run.status === 'blocked');
  ok('blocked at the failing gate', r2.run.blockedAt === 'testing');
  ok('attempted the full repair budget (2)', r2.run.repairs === 2);
  ok('records why it blocked', r2.run.blockedReason === 'gate');
  ok('downstream stages did not run', !r2.run.stages.find((s) => s.name === 'deployment'));

  // ---- (3) opt-out: maxRepairs:0 restores fail-fast behaviour ---------------
  console.log('opt-out (maxRepairs:0 ⇒ no auto-fix):');
  const r3 = await runWorkflow('ship it', { providerKind: 'mock', providerOpts: { fail: { test: true } }, maxRepairs: 0 });
  ok('blocks immediately with zero repairs', r3.run.status === 'blocked' && r3.run.repairs === 0);

  // ---- (4) clean run ⇒ ship at 100 -----------------------------------------
  console.log('clean run (no failures ⇒ ship):');
  const r4 = await runWorkflow('Build a billing service');
  ok('report attached to every run', !!r4.report);
  ok('clean completion ⇒ ship at 100', r4.report.level === 'ship' && r4.report.readiness === 100 && r4.report.repairs === 0);
  ok('all gates passed', r4.report.gates.passed === r4.report.gates.total && r4.report.gates.total > 0);

  // ---- (5) buildReport on a blocked run is honest --------------------------
  console.log('readiness scoring:');
  const rep = buildReport(r2);
  ok('blocked run ⇒ blocked level under 100', rep.level === 'blocked' && rep.readiness < 100);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
