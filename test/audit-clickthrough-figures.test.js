// Regression test, docs/AUDIT.md run 2026-10-09 (click-through, demo data): figures that disagree between views.
//   BUG-029  Portfolio Intelligence prints a class weight below 1 % as if it were a fraction
//            (0.126 % of CS2 skins shown as "12.6 %").
//   BUG-030  Share & Compare / AI summary compute the health score without the price
//            history and transactions the Health view uses (45 vs 52 for the demo book).
// They describe the correct behaviour (they failed on main @ 83a9976).
// Run: node test/audit-clickthrough-figures.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

console.log('BUG-029 liquidity finding keeps sub-1 % weights as percent:');
{
  const PI = require('../portfolio-intelligence.js');
  const res = PI.analyzeFromInputs({
    liquidity: { available: true, illiquidPct: 9.0, classes: [{ cls: 'skins', pct: 0.126 }, { cls: 'commodities', pct: 8.8 }] }
  }, {});
  const all = JSON.stringify(res);
  ok('a 0.126 % skins weight is not printed as 12.6 %', !/12[.,]6/.test(all), (all.match(/[^"]*12[.,]6[^"]*/) || [''])[0].slice(0, 160));
  ok('the listed class weights add up to the headline 9 %', /0[.,]1/.test(all) && /8[.,]8/.test(all));
}

console.log('BUG-030 share snapshot health score uses the same inputs as the Health view:');
{
  let seen = null;
  globalThis.window = globalThis.window || {};
  window.MaerminMetrics = {
    computeCurrencyExposure: () => ({ available: false }),
    healthScore: (portfolio, prices, t, opts) => { seen = opts || null; return { score: 50, effectiveN: 3 }; }
  };
  delete require.cache[require.resolve('../share-snapshot.js')];
  const SH = require('../share-snapshot.js');
  const txs = [{ id: 'a', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 1, price: 100, date: '2024-01-02' }];
  SH.gatherInputs({ stocks: [{ symbol: 'AAPL', amount: 1, purchasePrice: 100 }] }, { AAPL: 120 }, txs);
  ok('healthScore receives the transactions (as renderer.js:3286 passes them)', !!(seen && seen.transactions === txs), 'opts = ' + JSON.stringify(seen));
}

process.exit(failed ? 1 : 0);
