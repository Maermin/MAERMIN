// Node harness for the dividend auto-booking executor. Pure, no browser.
// Run: node test/dividend-executor.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b) { return Math.abs(a - b) < 1e-9; }

const D = require('../dividend-executor.js');

// A buildPaymentSchedule-shaped set of rows.
const schedule = [
  { symbol: 'KO',   date: '2026-03-15', perShare: 0.485, shares: 100, amount: 48.5, currency: 'USD', past: true },
  { symbol: 'SAP.DE', date: '2026-05-10', perShare: 2.20, shares: 10, amount: 22.0, currency: 'EUR', past: true },
  { symbol: 'KO',   date: '2026-09-15', perShare: 0.485, shares: 100, amount: 48.5, currency: 'USD', past: false }, // upcoming → not booked
  { symbol: 'XX',   date: '2026-01-01', perShare: 0,     shares: 0,   amount: 0,    currency: 'USD', past: true }    // zero → skip
];

(function run() {
  console.log('dividend-executor:');

  // ---- pending: only past, positive, unbooked ----
  const p = D.pending(schedule, [], 'default');
  ok('pending finds the two past payouts', p.length === 2);
  ok('pending excludes the upcoming payout', !p.some(r => r.date === '2026-09-15'));
  ok('pending excludes the zero-amount row', !p.some(r => r.symbol === 'XX'));

  // ---- buildTransaction: amount via quantity × price, payout currency ----
  const tx = D.buildTransaction(schedule[0], 'default');
  ok('tx type is dividend', tx.type === 'dividend');
  ok('quantity × price === amount', near(tx.quantity * tx.price, 48.5));
  ok('currency is the payout currency (USD)', tx.currency === 'USD');
  ok('EUR payout stays EUR', D.buildTransaction(schedule[1], 'default').currency === 'EUR');
  ok('carries the idempotency marker', tx.source === 'dividend-auto' && tx.divDate === '2026-03-15');
  ok('booked under stocks category', tx.category === 'stocks');
  ok('amount-only row still balances qty×price', (function () { const t = D.buildTransaction({ symbol: 'ABC', date: '2026-02-02', amount: 12.5, currency: 'USD', past: true }); return near(t.quantity * t.price, 12.5); })());

  // ---- runCatchUp books pending, is idempotent ----
  // Holdings the payouts are paid on (runCatchUp books at the shares held on
  // each payout date, not the current position).
  const holdings = [
    { id: 'b1', type: 'buy', symbol: 'KO', quantity: 100, price: 60, date: '2025-12-01', portfolioId: 'default' },
    { id: 'b2', type: 'buy', symbol: 'SAP.DE', quantity: 10, price: 200, date: '2025-12-01', portfolioId: 'default' },
    { id: 'b3', type: 'buy', symbol: 'KO', quantity: 100, price: 60, date: '2025-12-01', portfolioId: 'p2' },
    { id: 'b4', type: 'buy', symbol: 'SAP.DE', quantity: 10, price: 200, date: '2025-12-01', portfolioId: 'p2' }
  ];
  const r1 = D.runCatchUp(schedule, holdings, 'default', 1000);
  ok('runCatchUp books the two past payouts', r1.created.length === 2);
  ok('runCatchUp appends to transactions', r1.transactions.length === holdings.length + 2);
  const r2 = D.runCatchUp(schedule, r1.transactions, 'default', 2000);
  ok('runCatchUp is idempotent (no double-book)', r2.created.length === 0 && r2.transactions.length === holdings.length + 2);

  // ---- per-portfolio isolation ----
  const r3 = D.runCatchUp(schedule, r1.transactions, 'p2', 3000);
  ok('a different portfolio books its own', r3.created.length === 2);

  // ---- historic share count ----
  const late = [
    { id: 'c1', type: 'buy', symbol: 'KO', quantity: 20, price: 60, date: '2026-01-10' },
    { id: 'c2', type: 'buy', symbol: 'KO', quantity: 80, price: 60, date: '2026-04-01' } // after the March payout
  ];
  const r4 = D.runCatchUp(schedule, late, 'default', 4000);
  const ko = r4.created.find(t => t.symbol === 'KO');
  ok('dividend uses shares held on the payout date (20, not 100)', ko && near(ko.quantity, 20) && near(ko.quantity * ko.price, 20 * 0.485));
  ok('no dividend for a position not held yet', !r4.created.some(t => t.symbol === 'SAP.DE'));
  ok('sharesAt nets sells', D.sharesAt([{ type: 'buy', symbol: 'KO', quantity: 5, date: '2026-01-01' }, { type: 'sell', symbol: 'KO', quantity: 2, date: '2026-01-02' }], 'ko', '2026-02-01', 'default') === 3);

  // ---- deleted auto-dividends stay deleted ----
  const r5 = D.runCatchUp(schedule, holdings, 'default', 5000, ['KO|2026-03-15|default']);
  ok('skipped marker is not re-booked', r5.created.length === 1 && r5.created[0].symbol === 'SAP.DE');

  // ---- isAuto only matches auto dividends ----
  ok('isAuto true for an auto row', D.isAuto(r1.created[0]) === true);
  ok('isAuto false for a manual dividend', D.isAuto({ type: 'dividend', symbol: 'KO', date: '2026-03-15' }) === false);
  ok('isAuto false for a buy', D.isAuto({ type: 'buy', symbol: 'KO' }) === false);

  // ---- a manual dividend on the pay date counts as booked (FINDINGS C-2) ----
  // It used to book a second row next to it, which the tax report then summed.
  const withManual = [{ type: 'dividend', symbol: 'KO', date: '2026-03-15', quantity: 100, price: 0.485 }];
  const pm = D.pending(schedule, withManual, 'default');
  ok('manual dividend suppresses the auto-booking of the same payout', pm.length === 1 && pm[0].symbol === 'SAP.DE');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
