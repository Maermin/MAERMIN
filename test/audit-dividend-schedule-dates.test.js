// Regression test, AUDIT.md run 2026-10-24 BUG-12: the dividend payment
// schedule mixed a UTC-midnight anchor with local-time month steps and printed
// the result in UTC, so in summer (CEST) every date came out one day early.
// The schedule must give the same dates in every time zone.
// Run: node test/audit-dividend-schedule-dates.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

globalThis.window = {};
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
require('../dividend-data-service.js');
const Svc = globalThis.window.DividendDataService;

const cache = { KO: { symbol: 'KO', annualDividend: 2.04, frequency: 'quarterly', exDate: '2026-02-13', currency: 'USD', cachedAt: new Date().toISOString() } };
function datesIn(tz) {
  process.env.TZ = tz;
  localStorage.setItem('maermin_dividend_cache', JSON.stringify(cache));
  return Svc.buildPaymentSchedule({ stocks: [{ symbol: 'KO', amount: 100 }] }, { now: '2026-10-24T10:00:00Z', months: 12, back: 12 }).map((r) => r.date);
}

console.log('payment schedule dates do not depend on the time zone:');
const utc = datesIn('UTC');
const berlin = datesIn('Europe/Berlin');
const ny = datesIn('America/New_York');
ok('UTC: pay dates fall on the 27th (ex-date + 14 days)', utc.length > 0 && utc.every((d) => d.slice(8) === '27'), utc);
ok('Europe/Berlin gives the same dates as UTC', JSON.stringify(berlin) === JSON.stringify(utc), berlin);
ok('America/New_York gives the same dates as UTC', JSON.stringify(ny) === JSON.stringify(utc), ny);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
