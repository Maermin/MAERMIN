// Node harness for the analytics data bridge: held quantities, value-series
// construction from per-symbol price history, and return alignment. Also checks
// the output feeds MaerminAnalytics cleanly. Run: node test/analytics-data.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const D = require('../analytics-data.js');
const A = require('../portfolio-analytics.js');

(function run() {
  console.log('analytics-data:');

  // pricesOf normalises both shapes + drops junk.
  ok('pricesOf reads {price} objects', JSON.stringify(D.pricesOf([{ price: 1 }, { price: 2 }])) === '[1,2]');
  ok('pricesOf reads raw numbers', JSON.stringify(D.pricesOf([1, 2, 3])) === '[1,2,3]');
  ok('pricesOf drops non-finite', JSON.stringify(D.pricesOf([1, null, NaN, { price: 4 }])) === '[1,4]');

  // heldQuantities sums `amount` per symbol across classes.
  const portfolio = {
    crypto: [{ symbol: 'BTC', amount: 2 }],
    stocks: [{ symbol: 'AAPL', amount: 10 }, { symbol: 'AAPL', amount: 5 }],
    skins: [], commodities: []
  };
  const q = D.heldQuantities(portfolio);
  ok('heldQuantities sums per symbol', q.BTC === 2 && q.AAPL === 15);

  // buildValueSeries: weighted sum, index-aligned to the shorter history.
  const priceHistory = {
    BTC: [{ price: 100 }, { price: 110 }, { price: 120 }],
    AAPL: [{ price: 10 }, { price: 9 }, { price: 11 }]
  };
  const series = D.buildValueSeries(portfolio, priceHistory);
  // point i: 2*BTC + 15*AAPL
  ok('value series length matches history', series.length === 3);
  ok('value series point 0 weighted correctly', approx(series[0], 2 * 100 + 15 * 10));   // 350
  ok('value series point 2 weighted correctly', approx(series[2], 2 * 120 + 15 * 11));    // 405

  // Unequal lengths → trim to the shortest, aligned at the trailing end.
  const ph2 = { BTC: [{ price: 1 }, { price: 2 }, { price: 3 }, { price: 4 }], AAPL: [{ price: 10 }, { price: 20 }] };
  const s2 = D.buildValueSeries({ crypto: [{ symbol: 'BTC', amount: 1 }], stocks: [{ symbol: 'AAPL', amount: 1 }], skins: [], commodities: [] }, ph2);
  ok('series trims to shortest history', s2.length === 2);
  ok('series uses trailing window of longer history', approx(s2[0], 3 + 10) && approx(s2[1], 4 + 20));

  // No usable history → empty.
  ok('empty when no history', D.buildValueSeries(portfolio, {}).length === 0);
  ok('empty when single point', D.buildValueSeries({ crypto: [{ symbol: 'BTC', amount: 1 }] }, { BTC: [{ price: 1 }] }).length === 0);

  // toReturns + alignedReturns.
  ok('toReturns computes simple returns', approx(D.toReturns([100, 110, 121])[0], 0.1) && approx(D.toReturns([100, 110, 121])[1], 0.1));
  const al = D.alignedReturns([1, 2, 4, 8], [10, 20]);
  ok('alignedReturns trims to common length', al.a.length === 1 && al.b.length === 1);
  ok('alignedReturns uses trailing window', approx(al.a[0], 1.0) && approx(al.b[0], 1.0));

  // End-to-end: series feeds MaerminAnalytics without NaNs.
  const dd = A.maxDrawdown(series);
  ok('maxDrawdown consumes the series', dd && typeof dd.maxDrawdown === 'number' && isFinite(dd.maxDrawdown));
  const rv = A.rollingVolatility(D.toReturns(series), 2, 252);
  ok('rollingVolatility consumes returns', Array.isArray(rv) && rv.every((x) => isFinite(x)));
  const bench = D.alignedReturns(series, [300, 305, 310]);
  const bs = A.benchmarkStats(bench.a, bench.b, { periodsPerYear: 252 });
  ok('benchmarkStats consumes aligned returns', bs && bs.available && isFinite(bs.beta));

  // alignReturns: N series → equal-length, trailing-trimmed return arrays.
  const ar = D.alignReturns([[1, 2, 4], [10, 20, 40, 80]]);
  ok('alignReturns returns one array per series', ar.length === 2);
  ok('alignReturns trims to shortest (equal length)', ar[0].length === 2 && ar[1].length === 2);
  ok('alignReturns trailing-aligns the longer series', approx(ar[0][0], 1) && approx(ar[1][0], 1) && approx(ar[1][1], 1));
  ok('alignReturns rejects a too-short member', D.alignReturns([[1, 2], [5]]).length === 0);
  ok('alignReturns empty on empty input', D.alignReturns([]).length === 0);

  // subtract: element-wise over common length (builds SMB/HML factor returns).
  const sub = D.subtract([0.10, 0.20, 0.30], [0.05, 0.05, 0.10]);
  ok('subtract is element-wise', approx(sub[0], 0.05) && approx(sub[1], 0.15) && approx(sub[2], 0.20));
  ok('subtract clips to shorter operand', D.subtract([1, 2, 3], [1, 1]).length === 2);

  // End-to-end factor exposure: an asset built as an exact linear combination of
  // the three factors must have its loadings recovered by the OLS regression.
  const mkt = [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, 0.0, 0.012, -0.008, 0.006];
  const smb = [0.002, 0.001, -0.003, 0.004, 0.0, -0.002, 0.003, -0.001, 0.002, -0.0015];
  const hml = [-0.001, 0.002, 0.001, -0.002, 0.003, 0.0, -0.001, 0.002, -0.003, 0.001];
  const asset = mkt.map((m, i) => 1.5 * m + 0.5 * smb[i] - 0.5 * hml[i]); // alpha 0
  const fe = A.factorExposure(asset, [mkt, smb, hml], ['MKT', 'SMB', 'HML']);
  ok('factorExposure is available', fe && fe.available === true);
  ok('factorExposure recovers MKT loading', approx(fe.betas.MKT, 1.5, 1e-6));
  ok('factorExposure recovers SMB loading', approx(fe.betas.SMB, 0.5, 1e-6));
  ok('factorExposure recovers HML loading', approx(fe.betas.HML, -0.5, 1e-6));
  ok('factorExposure recovers ~zero alpha', approx(fe.alpha, 0, 1e-6));

  // Integration: the factor panel's pipeline (align price proxies → diff → regress)
  // yields a usable result with the three named loadings finite. Proxies must have
  // *varying* returns — constant-return paths are collinear with the intercept and
  // factorExposure (correctly) reports unavailable, so we wiggle each path.
  const wig = (base, seed) => {
    const out = [base];
    for (let i = 1; i < 16; i++) {
      const r = 0.012 * Math.sin(seed + i * 0.7) + 0.004 * Math.cos(seed * 1.3 + i);
      out.push(out[i - 1] * (1 + r));
    }
    return out;
  };
  const aligned = D.alignReturns([wig(1000, 0.2), wig(100, 1), wig(50, 2), wig(80, 3), wig(60, 4), wig(70, 5)]);
  ok('factor pipeline aligns 6 series equally', aligned.length === 6 && aligned.every((a) => a.length === aligned[0].length));
  const feLive = aligned.length === 6
    ? A.factorExposure(aligned[0], [aligned[1], D.subtract(aligned[2], aligned[3]), D.subtract(aligned[4], aligned[5])], ['MKT', 'SMB', 'HML'])
    : { available: false };
  ok('factor pipeline produces finite named loadings', feLive.available && isFinite(feLive.betas.MKT) && isFinite(feLive.betas.SMB) && isFinite(feLive.betas.HML));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
