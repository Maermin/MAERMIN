// Regression test, docs/AUDIT.md run 2026-10-09: value snapshots are dated with the UTC day. Between
// 00:00 and 01:00/02:00 in Germany a snapshot of the new day overwrites the
// PREVIOUS day's point, while the trades of that night are dated with the
// local day (date input, utils.todayISO). The daily series then shows the new
// day's buys one day early (TWR fallback, performance cards, heatmap).
// Run: node test/audit-snapshot-local-day.test.js
'use strict';
process.env.TZ = 'Europe/Berlin';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const RealDate = Date;
const FIXED = RealDate.parse('2026-01-01T23:30:00Z'); // 00:30 on 2 Jan in Berlin
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(FIXED); }
  static now() { return FIXED; }
};
const SN = require('../portfolio-snapshots.js');
const U = require('../utils.js');

console.log('snapshot day (TZ=Europe/Berlin, 00:30 local on 2 Jan):');
ok('local day is 2026-01-02 (sanity)', U.todayISO() === '2026-01-02');
let st = SN.addPoint({ version: 1, points: [{ d: '2026-01-01', v: 1000, pid: 'all' }] }, { value: 1500 });
ok('the 00:30 snapshot is dated 2026-01-02', SN.latest(st).d === '2026-01-02');
ok('the 1 Jan point keeps its value 1000', (SN.valueAsOf(st, '2026-01-01') || {}).v === 1000);

global.Date = RealDate;
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
