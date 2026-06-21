// Node harness for the allocation-backtester pure layer: weight
// normalisation, series alignment, the unit-holding simulation with periodic
// rebalancing, and the metrics summary (reused from MaerminAnalytics). The
// React Panel is browser-only and covered by smoke-views.
// Run: node test/backtester.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const B = require('../backtester.js');
const A = require('../portfolio-analytics.js');

(function run() {
  console.log('backtester:');

  // ---- normalizeWeights -------------------------------------------------------
  const w = B.normalizeWeights([{ symbol: 'urth', weight: '70' }, { symbol: 'VT', weight: 30 }]);
  ok('weights normalise to fractions summing 1', approx(w[0].weight + w[1].weight, 1) && approx(w[0].weight, 0.7));
  ok('symbols uppercase', w[0].symbol === 'URTH');
  ok('junk and non-positive rows drop', B.normalizeWeights([{ symbol: 'A', weight: 1 }, { symbol: '', weight: 5 }, { symbol: 'B', weight: -2 }]).length === 1);
  ok('empty input -> null', B.normalizeWeights([]) === null && B.normalizeWeights([{ symbol: 'A', weight: 0 }]) === null);

  // ---- alignSeries ---------------------------------------------------------------
  const al = B.alignSeries([[1, 2, 3, 4], [10, 20, 30]]);
  ok('alignSeries keeps the most recent overlap', al[0].length === 3 && al[0][0] === 2 && al[1][0] === 10);
  ok('alignSeries null on short or missing series', B.alignSeries([[1], [2, 3]]) === null && B.alignSeries([[1, 2], null]) === null);

  // ---- backtest: single asset sanity ------------------------------------------------
  const single = B.backtest([{ symbol: 'X', weight: 1 }], [[100, 110, 121]], { initial: 10000 });
  ok('single asset path follows the price', approx(single.path[0], 10000) && approx(single.path[2], 12100));
  ok('no rebalances without a grid', single.rebalances === 0);

  // ---- backtest: buy-and-hold vs rebalancing -----------------------------------------
  // Two assets, 50/50. A doubles then halves; B flat. Build series long enough
  // to hit the monthly grid (21 periods): A: 100 -> 200 at p21 -> 100 at p42; B: flat 100.
  const aSeries = [], bSeries = [];
  for (let p = 0; p <= 42; p++) {
    const aVal = p <= 21 ? 100 + (100 * p / 21) : 200 - (100 * (p - 21) / 21);
    aSeries.push(aVal); bSeries.push(100);
  }
  const weights5050 = [{ symbol: 'A', weight: 0.5 }, { symbol: 'B', weight: 0.5 }];
  const hold = B.backtest(weights5050, [aSeries, bSeries], { initial: 10000, rebalance: 'none' });
  // Buy & hold ends where it started: A round-trips to 100, B flat.
  ok('buy-and-hold round trip ends flat', approx(hold.path[hold.path.length - 1], 10000, 1e-6));
  const rb = B.backtest(weights5050, [aSeries, bSeries], { initial: 10000, rebalance: 'monthly' });
  // Grid points inside the window: p=21 (the peak). p=42 is the last point,
  // where rebalancing would be a no-op, so it does not fire.
  ok('rebalancing fired on the monthly grid', rb.rebalances === 1);
  // Classic volatility harvesting: selling A at the top beats holding through
  // the round trip.
  ok('rebalanced portfolio beats buy-and-hold on a round trip', rb.path[rb.path.length - 1] > hold.path[hold.path.length - 1] + 1);
  // At the peak (p21) the rebalance sells A high: afterwards only half the
  // portfolio rides A down, so the end value is 10000 * 1.5 * (0.5*0.5 + 0.5).
  ok('rebalance math is exact on the synthetic path', approx(rb.path[rb.path.length - 1], 15000 * 0.75, 1e-6));

  // ---- backtest guards -----------------------------------------------------------------
  ok('weight/series count mismatch -> null', B.backtest(weights5050, [aSeries], {}) === null);
  ok('non-positive price anywhere -> null', B.backtest([{ symbol: 'X', weight: 1 }], [[100, 0, 110]], {}) === null);

  // ---- summarize (metrics reused from MaerminAnalytics) ---------------------------------
  // 252 trading days, +21% -> CAGR = 21% over exactly one year.
  const yearPath = [];
  for (let p = 0; p <= 252; p++) yearPath.push(10000 * Math.pow(1.21, p / 252));
  const m = B.summarize(yearPath, { periodsPerYear: 252 });
  ok('CAGR over one trading year', approx(m.cagr, 0.21, 1e-9));
  ok('total return matches the path', approx(m.totalReturn, 0.21, 1e-9));
  ok('smooth growth has (near) zero drawdown', m.maxDrawdown < 1e-9);
  ok('summarize agrees with MaerminAnalytics.maxDrawdown (magnitude)', approx(m.maxDrawdown, Math.abs(A.maxDrawdown(yearPath).maxDrawdown)));
  const ddPath = [100, 120, 90, 110];
  ok('drawdown read off the path', approx(B.summarize(ddPath, {}).maxDrawdown, (120 - 90) / 120));
  ok('summarize null on short paths', B.summarize([100], {}) === null);

  // ---- run (one-call pipeline) -------------------------------------------------------------
  const res = B.run([{ symbol: 'a', weight: 50 }, { symbol: 'B', weight: 50 }], { A: aSeries, B: bSeries }, { rebalance: 'monthly', initial: 10000 });
  ok('run wires weights, series and metrics together', res.ok === true && approx(res.metrics.endValue, 11250, 1e-6) && res.rebalances === 1);
  const missing = B.run([{ symbol: 'A', weight: 1 }, { symbol: 'ZZZ', weight: 1 }], { A: aSeries }, {});
  ok('run names the symbols without history', missing.ok === false && /ZZZ/.test(missing.error));
  ok('run rejects an empty allocation', B.run([], {}, {}).ok === false);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
