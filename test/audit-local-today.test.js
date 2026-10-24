// Regression test, AUDIT.md run 2026-10-24 BUG-15: nine view call sites took
// "today" from the UTC date (new Date().toISOString().slice(0, 10)), so between
// midnight and 01:00/02:00 local time in Europe they used yesterday. Views
// must use MaerminUtils.todayISO() (the local calendar date). Engines that take
// opts.today keep their own fallback; this guards the view call sites only.
// Run: node test/audit-local-today.test.js
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }

const UTC_TODAY = 'new Date().toISOString().slice(0, 10)';
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
// [file, a fragment of the call site that must not take the UTC date]
const SITES = [
  ['renderer.js', 'const today = ' + UTC_TODAY + ';\n      if (today.slice(5, 7) !== \'12\')'],
  ['renderer.js', 'const today = ' + UTC_TODAY + ';\n    const input = { today,'],
  ['renderer.js', 'const today = ' + UTC_TODAY + ';\n      const Q = window.MaerminDataQuality'],
  ['event-feed.js', 'build({ today: ' + UTC_TODAY],
  ['statements.js', 'var today = ' + UTC_TODAY + ';\n    var txs = props.transactions'],
  ['reconcile.js', 'var today = ' + UTC_TODAY + ';\n    var cash = cashRows'],
  ['investment-views.js', 'var asOf = ' + UTC_TODAY],
  ['charts.js', 'var today = ' + UTC_TODAY],
  ['features3.js', 'reviews: [{ date: ' + UTC_TODAY]
];

console.log('view call sites use the local date:');
SITES.forEach(([file, frag]) => {
  const text = src(file).replace(/\r\n/g, '\n');
  ok(file + ': ' + frag.split('\n')[0].slice(0, 50) + ' …', text.indexOf(frag) === -1);
});
ok('MaerminUtils.todayISO is the local calendar date', (() => {
  const U = require('../utils.js');
  const d = new Date(2026, 9, 25, 0, 30); // 00:30 local
  return U.todayISO(d) === '2026-10-25';
})());

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
