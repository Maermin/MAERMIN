// Node harness for the Rebalancing Planner. Pure, no browser.
// Run: node test/rebalancing-planner.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b) { return Math.abs(a - b) < 1e-6; }

const R = require('../rebalancing-planner.js');

(function run() {
  console.log('rebalancing-planner:');

  // ---- normalize: basis fallback, clamp, drop 0% / empty ----
  let st = R.normalize({ basis: 'nonsense', targets: { crypto: 40, stocks: 150, skins: 0, '  ': 10, bonds: -5 } });
  ok('normalize falls back to category basis', st.basis === 'category');
  ok('normalize clamps >100 to 100', st.targets.stocks === 100);
  ok('normalize drops 0% and empty-key and negative', !('skins' in st.targets) && !('  ' in st.targets) && !('bonds' in st.targets));

  // ---- setTarget / removeTarget ----
  st = R.setTarget({ version: 1, basis: 'category', targets: {} }, 'crypto', 60);
  st = R.setTarget(st, 'stocks', 40);
  ok('setTarget stores weights', st.targets.crypto === 60 && st.targets.stocks === 40);
  ok('totalTargetPct sums', R.totalTargetPct(st) === 100);
  st = R.setTarget(st, 'crypto', 0); // 0 removes
  ok('setTarget 0 removes the bucket', !('crypto' in st.targets));

  // ---- plan: drift + buy/sell deltas ----
  // Targets 60/40, actual 70/30 of a 1000 book.
  const targets = R.setTarget(R.setTarget({ version: 1, basis: 'category', targets: {} }, 'crypto', 60), 'stocks', 40);
  const actual = [{ key: 'crypto', value: 700 }, { key: 'stocks', value: 300 }];
  const p = R.plan(targets, actual, { band: 0 });
  ok('plan totals the book', p.total === 1000);
  const crypto = p.rows.find(r => r.key === 'crypto');
  const stocks = p.rows.find(r => r.key === 'stocks');
  ok('crypto overweight drift +10pp', near(crypto.driftPp, 10));
  ok('crypto needs a sell of 100', near(crypto.deltaValue, -100) && crypto.action === 'sell');
  ok('stocks underweight needs a buy of 100', near(stocks.deltaValue, 100) && stocks.action === 'buy');
  ok('summary turnover', near(p.summary.toBuy, 100) && near(p.summary.toSell, 100) && near(p.summary.turnover, 200));
  ok('summary maxDrift', near(p.summary.maxDriftPp, 10));
  ok('not balanced with band 0', p.summary.balanced === false);

  // ---- tolerance band suppresses small drifts ----
  const p2 = R.plan(targets, actual, { band: 15 });
  ok('within band -> all hold', p2.rows.every(r => r.action === 'hold') && p2.summary.balanced === true);
  ok('balanced -> zero turnover', p2.summary.turnover === 0);

  // ---- rows sorted by absolute drift desc ----
  const tri = R.setTarget(R.setTarget(R.setTarget({ version: 1, basis: 'category', targets: {} },
    'a', 33), 'b', 33), 'c', 34);
  const triPlan = R.plan(tri, [{ key: 'a', value: 800 }, { key: 'b', value: 100 }, { key: 'c', value: 100 }], { band: 0 });
  ok('rows sorted by |drift| desc', Math.abs(triPlan.rows[0].driftPp) >= Math.abs(triPlan.rows[1].driftPp));

  // ---- a held bucket with no target shows as untargeted overweight ----
  const noTgt = R.plan(R.setTarget({ version: 1, basis: 'category', targets: {} }, 'crypto', 100),
    [{ key: 'crypto', value: 900 }, { key: 'cash', value: 100 }], { band: 0 });
  const cash = noTgt.rows.find(r => r.key === 'cash');
  ok('untargeted holding surfaces', cash && cash.untargeted === true && cash.action === 'sell');

  // ---- normalizeWeights scales to 100 ----
  const lop = R.normalizeWeights(R.setTarget(R.setTarget({ version: 1, basis: 'category', targets: {} },
    'x', 30), 'y', 10)); // sums to 40 -> 75 / 25
  ok('normalizeWeights scales to ~100', Math.abs(R.totalTargetPct(lop) - 100) < 0.5);
  ok('normalizeWeights keeps ratios', near(lop.targets.x / lop.targets.y, 3));

  // ---- groupBy collapses positions by field ----
  const rows = R.groupBy([
    { category: 'crypto', valueEUR: 100 }, { category: 'crypto', valueEUR: 50 },
    { category: 'stocks', valueEUR: 200 }, { category: '', valueEUR: 5 }
  ], 'category');
  const g = {}; rows.forEach(r => g[r.key] = r.value);
  ok('groupBy sums per key, drops empties', g.crypto === 150 && g.stocks === 200 && !('' in g));

  // ---- empty actual is safe ----
  const empty = R.plan(targets, [], { band: 0 });
  ok('empty actual -> total 0, no crash', empty.total === 0 && empty.rows.length === 2);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
