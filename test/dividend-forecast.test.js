// Dividend forecast rates (AUDIT BUG-032): one recorded payment used to be
// annualised over a clamped 0.08 years (×12.5) and its USD amount counted as EUR.
// Run: node test/dividend-forecast.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);

const DF = require('../dividend-forecast.js');
const usd = (tx) => (tx.currency === 'USD' ? 0.92 : 1) * tx.quantity * tx.price;

console.log('dividend forecast rates:');
// The demo case: one AAPL payment of 12 x 0.95 USD.
const one = DF.forecastRates([{ type: 'dividend', symbol: 'AAPL', quantity: 12, price: 0.95, currency: 'USD', date: '2026-05-16' }], { toEUR: usd, today: '2026-10-09' });
ok('one payment in the last 12 months is the annual rate, in EUR (10.49, not 142.50)', one.rates.length === 1 && near(one.rates[0].annualRate, 12 * 0.95 * 0.92), JSON.stringify(one.rates[0]));
ok('... paid once a year, in May', one.rates[0].paymentsPerYear === 1 && JSON.stringify(one.rates[0].months) === '[4]');

const stale = DF.forecastRates([{ type: 'dividend', symbol: 'AAPL', quantity: 12, price: 0.95, currency: 'USD', date: '2024-05-16' }], { toEUR: usd, today: '2026-10-09' });
ok('a payer with nothing in the last 12 months is stale (the caller uses the resolved rate)', stale.rates.length === 0 && stale.stale[0] === 'AAPL');

const q = ['2025-11-15', '2026-02-15', '2026-05-15', '2026-08-15', '2025-08-15'].map((d) => ({ type: 'dividend', symbol: 'KO', quantity: 100, price: 0.5, currency: 'EUR', date: d }));
const kq = DF.forecastRates(q, { today: '2026-10-09' }).rates[0];
ok('quarterly payer: four payments in the last 12 months = 200 EUR a year', kq && near(kq.annualRate, 200) && kq.paymentsPerYear === 4, JSON.stringify(kq));
ok('... in Feb, May, Aug, Nov; 50 EUR each', JSON.stringify(kq.months) === '[1,4,7,10]' && near(kq.perPayment, 50));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
