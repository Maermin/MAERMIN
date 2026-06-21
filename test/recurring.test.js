// Tests for recurring liabilities (#2): interval math, schedule expansion,
// paid-to-date, monthly equivalent. Run: node test/recurring.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

globalThis.window = {};
const R = require('../recurring.js');

(function run() {
  console.log('interval date math:');
  ok('weekly +7d', R.nextDate(R._parseDate('2026-01-01'), 'weekly') && R._toISODate(R.nextDate(R._parseDate('2026-01-01'), 'weekly')) === '2026-01-08');
  ok('biweekly +14d', R._toISODate(R.nextDate(R._parseDate('2026-01-01'), 'biweekly')) === '2026-01-15');
  ok('monthly +1m', R._toISODate(R.nextDate(R._parseDate('2026-01-15'), 'monthly')) === '2026-02-15');
  ok('quarterly +3m', R._toISODate(R.nextDate(R._parseDate('2026-01-15'), 'quarterly')) === '2026-04-15');
  ok('annual +12m', R._toISODate(R.nextDate(R._parseDate('2026-01-15'), 'annual')) === '2027-01-15');
  ok('month-end clamps (Jan 31 +1m → Feb 28)', R._toISODate(R.nextDate(R._parseDate('2026-01-31'), 'monthly')) === '2026-02-28');

  console.log('schedule expansion:');
  const mortgage = { id: 'm1', name: 'Mortgage', recurring: true, amount: 1200, interval: 'monthly', startDate: '2026-01-01', endDate: '2026-12-31' };
  const occ = R.expandOccurrences(mortgage);
  ok('12 monthly payments in one year', occ.length === 12);
  ok('first occurrence is start date', occ[0].date === '2026-01-01' && occ[0].amount === 1200);
  ok('respects endDate (no Jan 2027)', !occ.some(o => o.date >= '2027-01-01'));

  const window2 = R.expandOccurrences(mortgage, '2026-04-01', '2026-06-30');
  ok('windowed range returns only in-range payments', window2.length === 3 && window2[0].date === '2026-04-01');

  console.log('paid-to-date & monthly equivalent:');
  ok('paid-to-date sums past occurrences', R.paidToDate(mortgage, '2026-03-15') === 3600); // Jan,Feb,Mar
  ok('monthly equivalent of monthly = amount', near(R.monthlyEquivalent(mortgage), 1200));
  ok('monthly equivalent of weekly = amount*52/12', near(R.monthlyEquivalent({ amount: 100, interval: 'weekly', startDate: '2026-01-01', recurring: true }), 100 * 52 / 12));
  ok('monthly equivalent of annual = amount/12', near(R.monthlyEquivalent({ amount: 1200, interval: 'annual', startDate: '2026-01-01', recurring: true }), 100));

  console.log('multi-liability schedule + summary:');
  const car = { id: 'c1', name: 'Car loan', recurring: true, amount: 300, interval: 'monthly', startDate: '2026-01-10', endDate: '2026-06-10' };
  const sched = R.scheduleBetween([mortgage, car], '2026-01-01', '2026-02-28');
  ok('merged schedule sorted by date', sched.length === 4 && sched[0].date <= sched[1].date && sched[1].date <= sched[2].date);
  const s = R.summary([mortgage, car], '2026-03-01');
  ok('summary monthly equivalent = 1200 + 300', near(s.monthlyEquivalent, 1500));
  ok('summary counts both liabilities', s.count === 2);
  ok('summary remaining scheduled is positive', s.remainingScheduled > 0);
  ok('non-recurring account ignored', R.scheduleBetween([{ type: 'loan', value: 5000 }], '2026-01-01', '2026-12-31').length === 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
