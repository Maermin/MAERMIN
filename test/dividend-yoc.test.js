// Node harness for Yield-on-Cost + DRIP (WI-6). Pure, no browser.
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

  // ---- yocSeries trend over multiple buys ----
  const series = Y.yocSeries({ buys: lots, annualDpsEUR: 5 });
  ok('series has one point per buy', series.length === 2);
  // after buy1: 10 sh, cost 1000, yoc = 50/1000 = 5%
  ok('series point 1 YoC', near(series[0].yocPct, 5));
  // after buy2 at higher price: avg cost rises, YoC falls to 4.545%
  ok('series point 2 YoC', near(series[1].yocPct, 100 / 2200 * 100));
  ok('YoC falls as average cost rises', series[1].yocPct < series[0].yocPct);

  // ---- dripSimulate ----
  // buy 10 @ 100 (t0); two dividends of 2 EUR/share; price flat at 100; final 100
  const sim = Y.dripSimulate({
    buys: [{ date: '2024-01-01', shares: 10, priceEUR: 100 }],
    dividends: [{ date: '2024-04-01', dpsEUR: 2 }, { date: '2024-07-01', dpsEUR: 2 }],
    priceAt: () => 100
  });
  // baseline: 10 shares, value 1000, cash = 10*2 + 10*2 = 40
  ok('baseline shares unchanged', sim.baseline.shares === 10);
  ok('baseline value', sim.baseline.value === 1000);
  ok('baseline cash collected', near(sim.baseline.cashCollected, 40));
  // drip: t1 cash 20 -> +0.2 sh -> 10.2 ; t2 cash 20.4 -> +0.204 -> 10.404
  ok('drip compounds shares', near(sim.drip.shares, 10.404));
  ok('drip value higher than baseline', sim.drip.value > sim.baseline.value);
  ok('drip end value', near(sim.drip.value, 1040.4));
  ok('extra shares from reinvest', near(sim.extraShares, 0.404));
  ok('extra value vs baseline', near(sim.extraValue, 40.4));
  ok('flagged as a simulation', sim.simulation === true);

  // an unpriced dividend day falls back to cash (no reinvest)
  const noPrice = Y.dripSimulate({
    buys: [{ date: '2024-01-01', shares: 10, priceEUR: 100 }],
    dividends: [{ date: '2024-04-01', dpsEUR: 2 }],
    priceAt: (d) => d === '2024-04-01' ? 0 : 100, finalPrice: 100
  });
  ok('unpriced dividend does not reinvest', near(noPrice.drip.shares, 10));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
