// Node harness for Yield-on-Cost (WI-6). Pure, no browser.
// Run: node test/dividend-yoc.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

const Y = require('../dividend-yoc.js');

(function run() {
  console.log('dividend-yoc:');

  // ---- netShares / costBasisFIFO ----
  const lots = [
    { type: 'buy', date: '2024-01-01', shares: 10, priceEUR: 100 },
    { type: 'buy', date: '2024-06-01', shares: 10, priceEUR: 120 }
  ];
  ok('netShares sums buys', Y.netShares(lots) === 20);
  ok('costBasisFIFO sums lots', Y.costBasisFIFO(lots) === 2200);

  // a sell removes the oldest lot first (FIFO)
  const withSell = lots.concat([{ type: 'sell', date: '2024-09-01', shares: 10 }]);
  ok('netShares after sell', Y.netShares(withSell) === 10);
  ok('FIFO sell removes the cheapest oldest lot', Y.costBasisFIFO(withSell) === 1200);

  // ---- yieldOnCost ----
  const yoc = Y.yieldOnCost({ lots: lots, annualDpsEUR: 5 });
  // annual div = 5 * 20 = 100; cost basis 2200; yoc = 100/2200 = 4.545%
  ok('yieldOnCost shares', yoc.shares === 20);
  ok('yieldOnCost cost basis', yoc.costBasisEUR === 2200);
  ok('yieldOnCost annual dividend', yoc.annualDividendEUR === 100);
  ok('yieldOnCost percent', near(yoc.yocPct, 100 / 2200 * 100));
  ok('zero cost basis -> 0 yoc', Y.yieldOnCost({ lots: [], annualDpsEUR: 5 }).yocPct === 0);

  // matches a manual calc: 100 shares at avg 50 EUR, DPS 2 -> YoC 4%
  const manual = Y.yieldOnCost({ lots: [{ type: 'buy', date: '2023-01-01', shares: 100, priceEUR: 50 }], annualDpsEUR: 2 });
  ok('manual YoC check (4%)', near(manual.yocPct, 4));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
