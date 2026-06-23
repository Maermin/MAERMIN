// Node harness for the compute client's routing + always-resolving fallback.
// The Web Worker itself is browser-only; here we verify computeSync (the single
// routing source the worker also uses) and that run() resolves via the
// synchronous fallback when no Worker exists (as in Node). Run:
//   node test/compute-client.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

// Mock engines (same shape as MonteCarloEngine / CorrelationEngine).
const mcEngine = { runSimulation: (p, c) => ({ tag: 'mc', iterations: c.iterations, pv: p.tag }) };
const ceEngine = {
  calculateCorrelationMatrix: (h) => ({ size: Object.keys(h).length }),
  calculateDiversificationScore: (m) => m.size * 10,
  findExtremePairs: (m) => [{ pair: 'A-B', size: m.size }],
};
// Ambient globals so run()'s default engine resolver finds them in Node.
global.window = { MonteCarloEngine: mcEngine, CorrelationEngine: ceEngine };

const C = require('../compute-client.js');

(async function run() {
  console.log('compute-client:');

  // ---- computeSync routing (injected engines) -------------------------------
  const mc = C.computeSync('montecarlo', { portfolio: { tag: 'p' }, config: { iterations: 7 } }, { MonteCarloEngine: mcEngine });
  ok('montecarlo routes to MonteCarloEngine.runSimulation', mc.tag === 'mc' && mc.iterations === 7 && mc.pv === 'p');

  const cr = C.computeSync('correlation', { history: { A: [1, 2], B: [2, 3] } }, { CorrelationEngine: ceEngine });
  ok('correlation returns {matrix,score,extremes}', cr.matrix.size === 2 && cr.score === 20 && cr.extremes[0].pair === 'A-B');

  let threw = false; try { C.computeSync('nope', {}, {}); } catch (e) { threw = /unknown compute fn/.test(e.message); }
  ok('unknown fn throws', threw);

  let threw2 = false; try { C.computeSync('montecarlo', {}, {}); } catch (e) { threw2 = /unavailable/.test(e.message); }
  ok('missing engine throws', threw2);

  // ---- run() falls back to sync in Node (no Worker) -------------------------
  ok('available() is false without a Worker', C.available() === false);
  const out = await C.run('montecarlo', { portfolio: { tag: 'q' }, config: { iterations: 3 } });
  ok('run() resolves via sync fallback with the right result', out && out.iterations === 3 && out.pv === 'q');
  const outc = await C.correlation({ A: [1, 2, 3], B: [3, 2, 1] });
  ok('correlation() helper resolves via fallback', outc && outc.matrix.size === 2);
  const bad = await C.run('nope', {});
  ok('run() never rejects (unknown fn → null)', bad === null);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
