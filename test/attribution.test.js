// Node harness for the performance-attribution engine. Pure, no browser.
// Run: node test/attribution.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

const A = require('../attribution.js');

(function run() {
  console.log('attribution:');

  const positions = [
    { symbol: 'AAPL', value: 1100, invested: 1000 }, // +100
    { symbol: 'MSFT', value: 2200, invested: 2000 }, // +200
    { symbol: 'TSLA', value: 400,  invested: 500  }, // -100
  ];
  const r = A.compute(positions);

  ok('totals are summed', near(r.totalValue, 3700) && near(r.totalInvested, 3500));
  ok('total gain = value - invested', near(r.totalGain, 200));
  ok('total return % = gain/invested', near(r.totalReturnPct, (200 / 3500) * 100));

  // contributions (gain / totalInvested) sum to the total return %
  const sumContrib = r.rows.reduce((s, x) => s + x.contributionPP, 0);
  ok('contributions sum to the total return', near(sumContrib, r.totalReturnPct, 1e-9));

  // sorted by contribution desc → MSFT (+200) first, TSLA (−100) last
  ok('rows sorted by contribution desc', r.rows[0].symbol === 'MSFT' && r.rows[2].symbol === 'TSLA');

  const aapl = r.rows.find(x => x.symbol === 'AAPL');
  ok('own return % is per-position', near(aapl.returnPct, 10));
  ok('weight % is share of total value', near(aapl.weightPct, (1100 / 3700) * 100));
  ok('contribution pp = gain/totalInvested', near(aapl.contributionPP, (100 / 3500) * 100));

  ok('contributors are the winners', r.contributors.length === 2);
  ok('detractors are the losers', r.detractors.length === 1 && r.detractors[0].symbol === 'TSLA');

  // defensive: empty + zero-invested
  ok('empty positions → empty rows', A.compute([]).rows.length === 0);
  const z = A.compute([{ symbol: 'X', value: 50, invested: 0 }]);
  ok('zero-invested position does not divide by zero', z.rows[0].returnPct === 0 && z.rows.length === 1);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
