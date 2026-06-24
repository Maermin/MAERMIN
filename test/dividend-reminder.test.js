// Node harness for the dividend-reminder engine. Pure logic, no browser.
// Run: node test/dividend-reminder.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const R = require('../dividend-reminder.js');

// Anchor "now" to a fixed date so ISO date math is deterministic.
const NOW = new Date('2026-03-10T12:00:00Z').getTime();
function iso(daysFromNow) {
  const d = new Date(NOW + daysFromNow * 86400000);
  return d.toISOString().split('T')[0];
}

const schedule = [
  { symbol: 'KO', date: iso(-30), amount: 10, past: true },   // already received
  { symbol: 'KO', date: iso(3),   amount: 11, past: false },  // due in 3d
  { symbol: 'PG', date: iso(6),   amount: 5,  past: false },  // due in 6d
  { symbol: 'JNJ', date: iso(20), amount: 8,  past: false },  // outside 7d window
];

(function run() {
  console.log('dividend-reminder:');

  const up = R.upcoming(schedule, { now: NOW, withinDays: 7 });
  ok('upcoming returns the two within 7 days', up.length === 2);
  ok('upcoming excludes past payouts', up.every(r => !r.past));
  ok('upcoming excludes beyond-window payouts', up.every(r => r.symbol !== 'JNJ'));
  ok('upcoming is date-sorted', up[0].symbol === 'KO' && up[1].symbol === 'PG');

  const pend = R.pending(schedule, {}, { now: NOW, withinDays: 7 });
  ok('pending equals upcoming when nothing notified yet', pend.length === 2);

  const notified = R.markNotified({}, [pend[0]]);
  const pend2 = R.pending(schedule, notified, { now: NOW, withinDays: 7 });
  ok('notified rows drop out of pending', pend2.length === 1 && pend2[0].symbol === 'PG');

  // prune drops keys older than keepDays
  const stale = { ['OLD@' + iso(-200)]: true, ['NEW@' + iso(-1)]: true };
  const pruned = R.prune(stale, { now: NOW, keepDays: 90 });
  ok('prune drops a 200-day-old key', !pruned['OLD@' + iso(-200)]);
  ok('prune keeps a recent key', pruned['NEW@' + iso(-1)] === true);

  ok('summarize single row mentions symbol and date',
    R.summarize([up[0]]).includes('KO') && R.summarize([up[0]]).includes(up[0].date));
  ok('summarize multi row gives a count', R.summarize(up).includes('2 dividends'));

  ok('empty schedule → no upcoming', R.upcoming([], { now: NOW }).length === 0);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
