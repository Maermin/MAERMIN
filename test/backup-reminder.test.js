// Node harness for the backup-reminder engine. Pure decision logic, no browser.
// Run: node test/backup-reminder.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const R = require('../backup-reminder.js');
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

(function run() {
  console.log('backup-reminder:');

  // ---- empty app is never nagged ----
  ok('no reminder when there is no data',
    R.evaluate({}, { now: NOW, txCount: 0 }).remind === false);

  // ---- never backed up but has data ----
  const neverBackedUp = R.evaluate({}, { now: NOW, txCount: 3 });
  ok('reminds when data exists and never backed up', neverBackedUp.remind === true);
  ok('reason = never', neverBackedUp.reason === 'never');

  // ---- fresh backup suppresses the reminder ----
  let st = R.markBackedUp({}, { now: NOW, txCount: 3 });
  ok('fresh backup → not due', R.evaluate(st, { now: NOW + DAY, txCount: 3 }).remind === false);
  ok('markBackedUp clears snooze', st.snoozedUntil === 0);

  // ---- staleness window ----
  ok('not stale at 29 days', R.evaluate(st, { now: NOW + 29 * DAY, txCount: 3 }).remind === false);
  ok('stale at 30 days', R.evaluate(st, { now: NOW + 30 * DAY, txCount: 3 }).reason === 'stale');
  ok('custom interval honoured (7d)',
    R.evaluate(st, { now: NOW + 8 * DAY, txCount: 3, intervalDays: 7 }).remind === true);

  // ---- new-data trigger (>= threshold new tx) ----
  ok('reminds after many new transactions',
    R.evaluate(st, { now: NOW + DAY, txCount: 3 + R.NEW_TX_THRESHOLD }).reason === 'newdata');
  ok('no reminder for a few new transactions',
    R.evaluate(st, { now: NOW + DAY, txCount: 4 }).remind === false);

  // ---- snooze ----
  let sn = R.snooze(st, { now: NOW + 30 * DAY, days: 7 });
  ok('snooze suppresses an otherwise-due reminder',
    R.evaluate(sn, { now: NOW + 31 * DAY, txCount: 3 }).reason === 'snoozed');
  ok('snooze expires',
    R.evaluate(sn, { now: NOW + 40 * DAY, txCount: 3 }).remind === true);

  // ---- normalize is defensive ----
  const n = R.normalize(null);
  ok('normalize(null) gives a safe zeroed shape',
    n.lastBackup === 0 && n.txAtLastBackup === 0 && n.snoozedUntil === 0);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
