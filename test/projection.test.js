// Tests for the whole-portfolio projection (#6). Run: node test/projection.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

globalThis.window = {};
const P = require('../projection.js');

(function run() {
  console.log('contribution / liability normalisation:');
  ok('monthly plan → itself', near(P.toMonthly(100, 'monthly'), 100));
  ok('weekly plan → *52/12', near(P.toMonthly(100, 'weekly'), 100 * 52 / 12));
  ok('quarterly plan → *4/12', near(P.toMonthly(300, 'quarterly'), 100));
  ok('sums active plans only', near(P.monthlyContributionFromPlans([
    { amount: 100, frequency: 'monthly', active: true },
    { amount: 100, frequency: 'monthly', active: false },
    { amount: 300, frequency: 'quarterly' }
  ]), 200));

  console.log('deterministic simulate:');
  // 0% return, 100/mo contribution, no dividends/liabilities, 1 year → 1200 + start
  const s = P.simulate({ startValue: 1000, years: 1, annualReturn: 0, monthlyContribution: 100 });
  ok('0% return → start + contributions', near(s.endValue, 1000 + 1200, 1e-9));
  ok('tracks total contributions', near(s.totalContributions, 1200));
  ok('yearly points include year 0 and year 1', s.points[0].year === 0 && s.points[s.points.length - 1].year === 1);

  // liabilities reduce the balance
  const s2 = P.simulate({ startValue: 10000, years: 1, annualReturn: 0, monthlyLiability: 200 });
  ok('liabilities subtract over the year (−2400)', near(s2.endValue, 10000 - 2400, 1e-9));
  ok('tracks total liability payments', near(s2.totalLiabilityPayments, 2400));

  // dividends reinvested grow the balance
  const sDiv = P.simulate({ startValue: 10000, years: 1, annualReturn: 0, dividendYield: 0.12, reinvestDividends: true });
  ok('reinvested dividends grow balance above start', sDiv.endValue > 10000 && sDiv.totalDividends > 0);
  const sNoDiv = P.simulate({ startValue: 10000, years: 1, annualReturn: 0, dividendYield: 0.12, reinvestDividends: false });
  ok('non-reinvested dividends do not grow balance', near(sNoDiv.endValue, 10000, 1e-6) && sNoDiv.totalDividends > 0);

  console.log('scenarios + horizon:');
  const proj = P.projectPortfolio({
    startValue: 50000,
    years: 10,
    savingsPlans: [{ amount: 500, frequency: 'monthly', active: true }],
    dividendYield: 0.02,
    liabilities: [{ recurring: true, amount: 800, interval: 'monthly', startDate: '2026-01-01' }]
  });
  ok('all three scenarios returned', proj.scenarios.conservative && proj.scenarios.realistic && proj.scenarios.optimistic);
  ok('optimistic ends above realistic above conservative',
    proj.scenarios.optimistic.endValue > proj.scenarios.realistic.endValue &&
    proj.scenarios.realistic.endValue > proj.scenarios.conservative.endValue);
  ok('10y horizon → 11 yearly points (0..10)', proj.scenarios.realistic.points.length === 11);
  ok('savings plan folded into monthly contribution (500)', near(proj.inputs.monthlyContribution, 500));
  ok('liability folded into monthly debt service (800)', near(proj.inputs.monthlyLiability, 800));

  // custom horizon (non-whole years) still yields a final point
  const custom = P.projectPortfolio({ startValue: 1000, years: 1.5, monthlyContribution: 0 });
  ok('custom 1.5y horizon has a final point at 1.5', custom.scenarios.realistic.points.some(p => Math.abs(p.year - 1.5) < 1e-9));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
