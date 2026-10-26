// Audit 2026-10-24 follow-up: dates taken from a moment (a "now" value, a
// local time) through toISOString() are UTC dates, which are a day early
// between local midnight and 01:00/02:00 in Europe. The tax report even put a
// dividend booked at 00:30 on 1 January into the previous tax year. Market
// timestamps and UTC date arithmetic stay UTC on purpose.
// Run: node test/local-dates-from-timestamps.test.js
'use strict';
process.env.TZ = 'Europe/Berlin';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }

console.log('tax year of a local datetime:');
const R = require('../tax-report-builder.js');
const tx = [{ id: 'd', type: 'dividend', category: 'stocks', symbol: 'SAP', quantity: 10, price: 1, currency: 'EUR', date: '2027-01-01T00:30:00' }];
const y26 = R.build(tx, { year: 2026, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 0.9, today: '2027-06-01' }).summary;
const y27 = R.build(tx, { year: 2027, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 0.9, today: '2027-06-01' }).summary;
ok('a dividend at 00:30 on 1 January 2027 counts in 2027', y27.dividendIncome === 10, JSON.stringify(y27.dividendIncome));
ok('and not in 2026', y26.dividendIncome === 0, JSON.stringify(y26.dividendIncome));

console.log('at 00:30 Berlin:');
const RealDate = Date;
const NOW = RealDate.UTC(2026, 2, 1, 23, 30); // 2026-03-01T23:30Z = 2026-03-02 00:30 CET
global.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
};
const P = require('../performance-cards.js');
const eta = P.goalEta({ current: 100, target: 105, monthly: 10, annualReturnPct: 0 });
ok('goal date: one month from today, local (2 April)', eta.etaISO === '2026-04-02', JSON.stringify(eta));
global.Date = RealDate;

console.log('no "today" from a now value in UTC:');
const root = path.join(__dirname, '..');
const NOW_UTC = /new Date\((now|Date\.now\(\)[^)]*)\)\.toISOString\(\)\.(slice\(0, ?10\)|split\('T'\)\[0\])/;
const hits = [];
fs.readdirSync(root).filter((f) => f.endsWith('.js') && !/^demo-/.test(f)).forEach((f) => {
  fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/).forEach((line, i) => { if (NOW_UTC.test(line)) hits.push(f + ':' + (i + 1)); });
});
ok('none left', hits.length === 0, hits.join(', '));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
