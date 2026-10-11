// Regression test, docs/AUDIT.md run 2026-10-09: a schedule that starts on the 29th-31st drifts to the
// 28th for good after February (each step clamps from the previous, already
// clamped date). Savings plans reuse this schedule, so they book on the wrong
// days and get new (planId, dueDate) markers.
// Run: node test/audit-recurring-month-end.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const R = require('../recurring.js');
const SP = require('../savings-plan-executor.js');

console.log('recurring month-end:');
const dates = R.expandOccurrences({ amount: 100, interval: 'monthly', startDate: '2025-01-31' }, '2025-01-01', '2025-06-30').map((o) => o.date);
ok('Jan 31 monthly → Feb 28, Mar 31, Apr 30, May 31, Jun 30',
  JSON.stringify(dates) === JSON.stringify(['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31', '2025-06-30']));
const leap = R.expandOccurrences({ amount: 100, interval: 'monthly', startDate: '2024-01-30' }, '2024-01-01', '2024-04-30').map((o) => o.date);
ok('Jan 30 2024 monthly → Feb 29 (leap), Mar 30, Apr 30',
  JSON.stringify(leap) === JSON.stringify(['2024-01-30', '2024-02-29', '2024-03-30', '2024-04-30']));
const q = R.expandOccurrences({ amount: 100, interval: 'quarterly', startDate: '2025-11-30' }, null, '2026-08-31').map((o) => o.date);
ok('Nov 30 quarterly → Feb 28, May 30, Aug 30', JSON.stringify(q) === JSON.stringify(['2025-11-30', '2026-02-28', '2026-05-30', '2026-08-30']));

const plan = { id: 'p1', symbol: 'VWCE', amount: 100, frequency: 'monthly', startDate: '2025-01-31' };
const occ = SP.occurrences(plan, '2025-04-30').map((o) => o.date);
ok('savings plan on the 31st books on 31 Mar (not 28 Mar)', occ.indexOf('2025-03-31') > -1 && occ.indexOf('2025-03-28') === -1);

// Migration path: executions booked by the old schedule (28 Mar, 28 Apr) must
// not be booked again under the corrected dates (31 Mar, 30 Apr).
const oldExec = (d) => ({ id: 'x' + d, type: 'buy', source: 'savings-plan', auto: true, planId: 'p1', dueDate: d, symbol: 'VWCE', quantity: 1, price: 100, date: d });
const booked = ['2025-01-31', '2025-02-28', '2025-03-28', '2025-04-28'].map(oldExec);
const pend = SP.pendingExecutions([plan], booked, '2025-04-30').map((p) => p.dueDate);
ok('old-schedule executions count for their month (nothing re-booked)', pend.length === 0);
const skippedOld = SP.pendingExecutions([Object.assign({}, plan, { skippedDates: ['2025-03-28'] })], booked.slice(0, 2), '2025-03-31').map((p) => p.dueDate);
ok('an old skipped date still skips that month', skippedOld.length === 0);
const nextMonth = SP.pendingExecutions([plan], booked, '2025-05-31').map((p) => p.dueDate);
ok('the next month is due on the 31st', JSON.stringify(nextMonth) === JSON.stringify(['2025-05-31']));

// summary(): an occurrence ON the as-of date is counted as paid AND as remaining.
const loan = { id: 'l1', recurring: true, amount: 100, interval: 'monthly', startDate: '2026-01-01', endDate: '2026-12-01' };
const s = R.summary([loan], '2026-06-01');
ok('paid + remaining = the 12 scheduled payments (1200), not 1300', s.paidToDate + s.remainingScheduled === 1200);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
