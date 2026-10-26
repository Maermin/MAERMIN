// Reporting currency EUR / USD / CHF (audit 2026-10-24, feature 9).
// Run: node test/reporting-currency.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }
const near = (a, b) => Math.abs(a - b) < 1e-9;
const RC = require('../reporting-currency.js');

console.log('rates:');
ok('EUR is 1', RC.perEUR('EUR', {}) === 1);
ok('USD per EUR from the EUR-per-USD rate', near(RC.perEUR('USD', { usdToEur: 0.8 }), 1.25));
ok('CHF per EUR from the per-USD table', near(RC.perEUR('CHF', { usdRates: { EUR: 0.9, CHF: 0.81 } }), 0.9));
ok('no USD rate: null (no default)', RC.perEUR('USD', {}) === null && RC.perEUR('USD', { usdToEur: 0 }) === null);
ok('no CHF in the table: null', RC.perEUR('CHF', { usdRates: { EUR: 0.9 } }) === null);
ok('another currency: null', RC.perEUR('GBP', { usdRates: { EUR: 0.9, GBP: 0.8 } }) === null);

console.log('effective:');
ok('CHF with a rate', JSON.stringify(RC.effective('CHF', { usdRates: { EUR: 0.9, CHF: 0.81 } })) === JSON.stringify({ cur: 'CHF', rate: 0.9, fallback: false, wanted: 'CHF' }));
const fb = RC.effective('USD', {});
ok('USD without a rate falls back to EUR and says so', fb.cur === 'EUR' && fb.rate === 1 && fb.fallback === true && fb.wanted === 'USD');
ok('EUR never falls back', RC.effective('EUR', {}).fallback === false);
ok('an unknown choice is EUR', RC.effective('XYZ', {}).cur === 'EUR' && RC.effective('XYZ', {}).fallback === false);

console.log('symbols:');
ok('€, $, CHF', RC.symbol('EUR') === '€' && RC.symbol('USD') === '$' && RC.symbol('CHF') === 'CHF');
ok('the three currencies', RC.CURRENCIES.join() === 'EUR,USD,CHF');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
