// Savings plans in USD (or on a USD-quoted symbol) must not be booked at an
// invented exchange rate. Before: with no rate known the executor used a fixed
// 0.92 EUR per USD and the app a hard-coded 0.91 start value, so a missed
// month could be booked with a made-up quantity (audit 2026-10-24, "Not in
// this PR" of #251). Now a due date without a real rate stays pending, like a
// due date without a real price.
// Run: node test/savings-plan-usd-rate.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

const SP = require('../savings-plan-executor.js');

console.log('no rate, no booking:');
const plan = { id: 'p', symbol: 'AAPL', category: 'stocks', amount: 100, amountCurrency: 'USD', frequency: 'monthly', startDate: '2026-01-15', active: true };
const none = SP.runCatchUp([plan], [], () => 10, '2026-02-20', (i) => 'x' + i, () => null);
ok('nothing is booked without a rate', none.created.length === 0);
ok('both due dates stay pending', none.pending.length === 2);
ok('the reason names the missing rate', none.pending.every((p) => p.reason === 'no-exchange-rate'));
ok('amountToEUR gives null for USD without a rate', SP.amountToEUR(plan, null, '2026-01-15') === null);
ok('amountToEUR still converts EUR plans without a rate', SP.amountToEUR(Object.assign({}, plan, { amountCurrency: 'EUR' }), null, '2026-01-15') === 100);
const eurOut = SP.runCatchUp([Object.assign({}, plan, { amountCurrency: 'EUR' })], [], () => 10, '2026-02-20', (i) => 'x' + i, () => null);
ok('EUR plans are booked as before', eurOut.created.length === 2 && eurOut.pending.length === 0);
const est = [{ id: 'e', type: 'buy', source: 'savings-plan', planId: 'p', dueDate: '2026-01-15', symbol: 'AAPL', estimatedPrice: true, planAmount: 100, planAmountCurrency: 'USD', quantity: 9.5, price: 10 }];
ok('an estimate in USD is not repriced without a rate', SP.repriceEstimated(est, () => 8, () => null).repriced === 0);

console.log('bookingRate (which rate counts as real):');
const hist = function (d) { return d >= '2026-01-01' ? 0.85 : 0.80; };
hist.covers = function (d) { return d >= '2026-01-01' && d <= '2026-02-10'; };
const live = SP.bookingRate(hist, 0.9, true, '2026-02-20');
ok('a date the history covers uses the history', live('2026-01-15') === 0.85);
ok('today uses the fetched live rate', live('2026-02-20') === 0.9);
ok('a past date the history does not cover has no rate', live('2026-02-15') === null);
const notFetched = SP.bookingRate(hist, 0.91, false, '2026-02-20');
ok('today without a fetched rate has none (the start value is not a rate)', notFetched('2026-02-20') === null);
ok('history still counts without a fetched live rate', notFetched('2026-01-15') === 0.85);
const noHist = SP.bookingRate(null, 0.9, true, '2026-02-20');
ok('no history: only today has a rate', noHist('2026-02-20') === 0.9 && noHist('2026-01-15') === null);
const plainFn = SP.bookingRate(function () { return 0.85; }, 0.9, true, '2026-02-20');
ok('a resolver without covers() is not trusted for past dates', plainFn('2026-01-15') === null);

console.log('a plain number or a full resolver still works (callers that know their rate):');
ok('number', near(SP.amountToEUR(plan, 0.9, '2026-01-15'), 90));
ok('resolver', near(SP.amountToEUR(plan, hist, '2026-01-15'), 85));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
