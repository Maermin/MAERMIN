// Node harness for the quant engine (Epics 5/6/7). Pure math with known cases.
// Run: node test/analytics.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

globalThis.window = {};
const A = require('../portfolio-analytics.js');

(function run() {
  console.log('Epic 5 — benchmarks:');
  // Portfolio = 1.5× benchmark each period → beta 1.5, correlation 1, alpha 0.
  const b = [0.01, -0.02, 0.015, 0.005, -0.01, 0.02];
  const p = b.map(x => 1.5 * x);
  const bs = A.benchmarkStats(p, b, { periodsPerYear: 12 });
  ok('beta ≈ 1.5 for 1.5× levered series', near(bs.beta, 1.5, 1e-6));
  ok('correlation ≈ 1', near(bs.correlation, 1, 1e-6));
  ok('R² ≈ 1', near(bs.rSquared, 1, 1e-6));
  ok('alpha ≈ 0 when pure beta exposure', near(bs.alphaPeriod, 0, 1e-9));
  // Add constant outperformance → positive alpha, IR high
  const p2 = b.map(x => x + 0.005);
  const bs2 = A.benchmarkStats(p2, b, { periodsPerYear: 12 });
  ok('constant +0.5%/period → positive annualised alpha', bs2.alpha > 0.05);
  ok('zero tracking error variance → very high IR', bs2.informationRatio > 100 || bs2.trackingError < 1e-9);
  ok('benchmark presets include MSCI World, S&P 500, Nasdaq 100',
    A.BENCHMARKS.some(x => x.label === 'MSCI World') &&
    A.BENCHMARKS.some(x => x.label === 'S&P 500') &&
    A.BENCHMARKS.some(x => x.label === 'Nasdaq 100'));

  console.log('Epic 7 — risk:');
  const series = [100, 120, 90, 110, 80, 130]; // peak 120 → trough 80 = -33.3%
  const dd = A.maxDrawdown(series);
  ok('max drawdown ≈ -33.3% (120→80)', near(dd.maxDrawdown, (80 - 120) / 120, 1e-9));
  ok('drawdown peak/trough indices correct', dd.peakIndex === 1 && dd.troughIndex === 4);

  const rets = A.toReturns(series);
  const rr = A.rollingReturns(rets, 2);
  ok('rolling returns length = n-window+1', rr.length === rets.length - 1);
  const rv = A.rollingVolatility(rets, 3, 12);
  ok('rolling volatility produced', rv.length === rets.length - 2 && rv.every(x => x >= 0));

  const cm = A.correlationMatrix({ A: [1, 2, 3, 4], B: [2, 4, 6, 8], C: [4, 3, 2, 1] });
  ok('correlation matrix diagonal = 1', cm.matrix[0][0] === 1 && cm.matrix[1][1] === 1);
  ok('perfectly correlated A,B ≈ 1', near(cm.matrix[0][1], 1, 1e-3));
  ok('perfectly anti-correlated A,C ≈ -1', near(cm.matrix[0][2], -1, 1e-3));

  // Factor regression: y = 0.3 + 2*MKT - 1*SMB exactly → recover alpha+betas
  const MKT = [0.02, -0.01, 0.03, 0.00, 0.015, -0.02];
  const SMB = [0.01, 0.00, -0.02, 0.01, -0.01, 0.005];
  const y = MKT.map((m, i) => 0.3 + 2 * m - 1 * SMB[i]);
  const fe = A.factorExposure(y, [MKT, SMB], ['MKT', 'SMB']);
  ok('factor alpha ≈ 0.3', near(fe.alpha, 0.3, 1e-6));
  ok('factor beta MKT ≈ 2', near(fe.betas.MKT, 2, 1e-6));
  ok('factor beta SMB ≈ -1', near(fe.betas.SMB, -1, 1e-6));

  console.log('Epic 6 — simulator:');
  // FV of lump sum, no contributions: 1000 @ 10% for 1y monthly-compounded
  const fv = A.futureValue(1000, 0, 0.10, 1);
  ok('future value compounds monthly (~1104.7)', near(fv, 1000 * Math.pow(1 + 0.1 / 12, 12), 1e-6));
  // contributions only, 0% return → just sum
  ok('0% return FV = sum of contributions', near(A.futureValue(0, 100, 0, 2), 2400, 1e-9));

  const fire = A.fireProjection({ currentValue: 100000, monthlyContribution: 2000, annualReturn: 0.05, annualExpenses: 40000, withdrawalRate: 4 });
  ok('FIRE number = expenses / wr (1,000,000)', fire.fireNumber === 1000000);
  ok('FIRE reachable with positive years', fire.yearsToFire > 0 && fire.yearsToFire < 100);

  const wd = A.withdrawalSimulation({ startValue: 100000, annualWithdrawal: 50000, annualReturn: 0, inflation: 0, years: 5 });
  ok('withdrawal depletes ~year 2 at 50k/yr from 100k @0%', wd.depletedYear === 2 && !wd.survives);

  const ret = A.retirementPlan({ currentAge: 35, retireAge: 65, currentValue: 50000, monthlyContribution: 1000, realReturn: 0.05, annualSpending: 40000, lifeExpectancy: 90, withdrawalRate: 4 });
  ok('retirement plan computes value at retirement', ret.valueAtRetirement > 50000);
  ok('retirement plan reports FIRE number 1,000,000', ret.fireNumber === 1000000);

  // Monte Carlo is deterministic with a seed
  const mc1 = A.monteCarlo({ startValue: 100000, monthlyContribution: 1000, annualReturn: 0.07, volatility: 0.15, years: 20, paths: 500, seed: 42 });
  const mc2 = A.monteCarlo({ startValue: 100000, monthlyContribution: 1000, annualReturn: 0.07, volatility: 0.15, years: 20, paths: 500, seed: 42 });
  ok('Monte Carlo deterministic for fixed seed', mc1.median === mc2.median);
  ok('Monte Carlo percentiles ordered p10≤median≤p90', mc1.p10 <= mc1.median && mc1.median <= mc1.p90);
  ok('Monte Carlo success rate in [0,1]', mc1.successRate >= 0 && mc1.successRate <= 1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
