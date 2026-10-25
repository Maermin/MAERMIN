// Audit 2026-10-24 follow-up ("Not in this PR" of #252): engines and panels
// that fall back to "today" when the caller passes no date took the UTC date
// (new Date().toISOString().slice(0, 10)). Between midnight and 01:00/02:00
// local time in Europe that is yesterday. Every fallback now uses
// MaerminUtils.todayISO(), the local calendar date.
// Part 1 guards the source; part 2 runs a few engines at 00:30 in Berlin.
// Run: node test/local-today-fallbacks.test.js
'use strict';
process.env.TZ = 'Europe/Berlin';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }

console.log('no module takes "today" from the UTC date:');
const root = path.join(__dirname, '..');
const UTC_NOW = /new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\('T'\)\[0\]|substring\(0, ?10\)|substr\(0, ?10\))/;
// utils.js names the pattern in a comment; the demo builds fixed sample data.
const SKIP = new Set(['utils.js', 'demo-data.js', 'demo-fixtures.js']);
const hits = [];
fs.readdirSync(root).filter((f) => f.endsWith('.js') && !SKIP.has(f)).forEach((f) => {
  fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/).forEach((line, i) => { if (UTC_NOW.test(line)) hits.push(f + ':' + (i + 1)); });
});
ok('no UTC "today" left in the app modules', hits.length === 0, hits.length + ' left: ' + hits.slice(0, 12).join(', '));

console.log('engines at 00:30 Berlin (23:30 UTC the day before):');
const RealDate = Date;
const NOW = RealDate.UTC(2026, 2, 1, 23, 30); // 2026-03-01T23:30Z = 2026-03-02 00:30 CET
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};
const LOCAL = '2026-03-02';
ok('the clock is set up (local date differs from UTC)', require('../utils.js').todayISO() === LOCAL && new Date().toISOString().slice(0, 10) === '2026-03-01');

const R = require('../returns-engine.js');
const flows = R.buildCashflows([], { currentValueEUR: 100 });
ok('returns-engine: the current value is dated today (local)', flows.length === 1 && flows[0].date === LOCAL, JSON.stringify(flows));
const cf = R.clearingCashflows(null, 100);
ok('returns-engine: clearing flows end today (local)', cf.some((x) => x.date === LOCAL), JSON.stringify(cf));

global.Date = RealDate;
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
