// Node harness for P5-1.4: the optional clearing account (Verrechnungskonto)
// per portfolio. Its balance follows from trades, payouts and the cash
// bookings of P5-1.3; deposits, withdrawals, transfers and the opening
// balance are the external flows of the portfolio.
// Run: node test/clearing-account.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-6);

globalThis.window = {};
const L = require('../ledger.js');

const tx = (o) => Object.assign({ currency: 'EUR', portfolioId: 'p1' }, o);
const cash = (type, amount, date, extra) => tx(Object.assign({ id: type + date, type, category: 'cashflow', amount, date }, extra || {}));

(function run() {
  console.log('clearing balance:');
  ok('clearingBalance exists', typeof L.clearingBalance === 'function');
  const rows = [
    cash('deposit', 10000, '2025-01-02'),
    tx({ id: 'b1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 500, fees: 5, date: '2025-01-03' }),       // -5005
    tx({ id: 'd1', type: 'dividend', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 2, withholdingTax: 3, date: '2025-02-01' }), // +17
    tx({ id: 'i1', type: 'interest', category: 'stocks', symbol: 'CASH', quantity: 1, price: 4, date: '2025-03-01' }),               // +4
    tx({ id: 'ia', type: 'interest', category: 'cash', symbol: 'Festgeld', quantity: 1, price: 50, date: '2025-03-01', source: 'interest-accrual' }), // net-worth account: not here
    cash('fee', 6, '2025-03-31'), cash('tax', 20, '2025-04-01'), cash('tax_refund', 8, '2025-04-02'), cash('interest_charge', 1, '2025-04-03'),
    cash('fee_refund', 2, '2025-04-04'),
    tx({ id: 's1', type: 'sell', category: 'stocks', symbol: 'AAPL', quantity: 4, price: 600, fees: 4, date: '2025-05-02' }),        // +2396
    cash('withdrawal', 1000, '2025-06-01'),
    cash('transfer_out', 500, '2025-06-02', { transferId: 't1', counterPortfolioId: 'p2' }),
    cash('transfer_in', 500, '2025-06-02', { portfolioId: 'p2', transferId: 't1', counterPortfolioId: 'p1' }),
    tx({ id: 'o1', type: 'buy', category: 'options', symbol: 'AAPL C', quantity: 1, price: 5, date: '2025-06-03' }),               // options: left out
    tx({ id: 'x1', type: 'buy', category: 'stocks', symbol: 'MSFT', quantity: 1, price: 100, date: '2025-06-03', portfolioId: 'p2' }) // other portfolio
  ];
  const c = L.clearingBalance(rows, 'p1');
  const expected = 10000 - 5005 + 17 + 4 - 6 - 20 + 8 - 1 + 2 + 2396 - 1000 - 500;
  ok('balance follows every booking type of the portfolio', near(c.balanceEUR, expected), c.balanceEUR + ' vs ' + expected);
  ok('external flows: deposit +, withdrawal -, transfer out -', c.external.length === 3 && c.external[0].amount === 10000 && c.external[1].amount === -1000 && c.external[2].amount === -500, JSON.stringify(c.external));
  ok('series has one end-of-day balance per date, oldest first', c.series[0].d === '2025-01-02' && c.series[0].balance === 10000 && near(c.series[c.series.length - 1].balance, expected));
  ok('no negative balance here', c.firstNegative === null);
  const p2 = L.clearingBalance(rows, 'p2');
  ok('the other portfolio: transfer in + buy', near(p2.balanceEUR, 500 - 100) && p2.external.length === 1 && p2.external[0].amount === 500);

  console.log('opening balance, currency, negative:');
  const op = L.clearingBalance([tx({ id: 'b', type: 'buy', category: 'stocks', symbol: 'X', quantity: 1, price: 300, date: '2025-02-01' })], 'p1', { opening: 1000, openingDate: '2025-01-01' });
  ok('the opening balance is the first external flow', op.external[0].d === '2025-01-01' && op.external[0].amount === 1000 && near(op.balanceEUR, 700));
  const noDate = L.clearingBalance([tx({ id: 'b', type: 'buy', category: 'stocks', symbol: 'X', quantity: 1, price: 300, date: '2025-02-01' })], 'p1', { opening: 1000 });
  ok('without a date it sits on the first booking day', noDate.external[0].d === '2025-02-01');
  const usd = L.clearingBalance([cash('deposit', 1000, '2025-01-02'), tx({ id: 'u', type: 'buy', category: 'stocks', symbol: 'X', quantity: 1, price: 100, currency: 'USD', date: '2025-06-02' })], 'p1',
    { exchangeRate: 0.5, fxAt: (d) => (d === '2025-06-02' ? 0.9 : null) });
  ok('a USD buy is paid at the rate of its date', near(usd.balanceEUR, 1000 - 90));
  const negRows = [cash('deposit', 100, '2025-01-02'), tx({ id: 'b', type: 'buy', category: 'stocks', symbol: 'X', quantity: 1, price: 250, date: '2025-01-05' }),
    tx({ id: 'b2', type: 'buy', category: 'stocks', symbol: 'X', quantity: 1, price: 50, date: '2025-02-05' })];
  const neg = L.clearingBalance(negRows, 'p1');
  ok('firstNegative names the first day below zero', neg.firstNegative && neg.firstNegative.d === '2025-01-05' && near(neg.firstNegative.balance, -150) && near(neg.minBalance, -200));
  const sameDay = L.clearingBalance([tx({ id: 'b', type: 'buy', category: 'stocks', symbol: 'X', quantity: 1, price: 250, date: '2025-01-05' }), cash('deposit', 300, '2025-01-05')], 'p1');
  ok('a deposit on the day of the buy covers it (end of day)', sameDay.firstNegative === null && near(sameDay.balanceEUR, 50));

  console.log('missing deposits:');
  const prop = L.missingDeposits(neg);
  ok('proposes deposits that keep the balance at zero', prop.length === 2 && prop[0].d === '2025-01-05' && near(prop[0].amount, 150) && prop[1].d === '2025-02-05' && near(prop[1].amount, 50), JSON.stringify(prop));
  const fixed = L.clearingBalance(negRows.concat(prop.map((p, i) => cash('deposit', p.amount, p.d, { id: 'fix' + i }))), 'p1');
  ok('with them booked the balance never drops below zero', fixed.firstNegative === null && near(fixed.minBalance, 0));
  ok('nothing to propose for a funded account', L.missingDeposits(c).length === 0);
  ok('amounts are rounded up to the cent', L.missingDeposits(L.clearingBalance([tx({ id: 'b', type: 'buy', category: 'stocks', symbol: 'X', quantity: 3, price: 0.3333, date: '2025-01-05' })], 'p1'))[0].amount === 1);

  console.log('TWR with the cash account (value-path):');
  const VP = require('../value-path.js');
  const series = { 'stocks|AAPL': { closes: [['2025-01-02', 100], ['2025-01-03', 110], ['2025-01-06', 121]] } };
  const book = [
    cash('deposit', 2000, '2025-01-02'),
    tx({ id: 'b', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, date: '2025-01-02' }),
    cash('fee', 10, '2025-01-06')];
  const classic = VP.build(book, series, { today: '2025-01-06' });
  ok('without the account: TWR = price path only (+21 %), the stand-alone fee is not seen', near(classic.twr, 0.21));
  const clr = L.clearingBalance(book, 'p1');
  const withCash = VP.build(book, series, { today: '2025-01-06', clearing: clr });
  // day 1: 2000 in, 1000 cash + 1000 AAPL → 0 %; day 2: 2100 / 2000 → +5 %; day 3: (1210 + 990) / 2100 → +4.7619 %
  ok('with the account: idle cash counts, the fee lowers the return (+10 %)', near(withCash.twr, 0.10, 1e-9), String(withCash.twr));
  ok('the points carry securities + cash', near(withCash.points[withCash.points.length - 1].v, 2200));
  ok('the path says the cash account is included', withCash.cash === true && classic.cash !== true);
  const book2 = book.concat([cash('deposit', 500, '2025-01-04'), tx({ id: 'b2', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 5, price: 100, date: '2025-01-04' })]);
  const s2 = { 'stocks|AAPL': { closes: [['2025-01-02', 100], ['2025-01-03', 110], ['2025-01-04', 110], ['2025-01-06', 121]] } };
  const base2 = VP.build(book, s2, { today: '2025-01-06', clearing: L.clearingBalance(book, 'p1') });
  const more2 = VP.build(book2, s2, { today: '2025-01-06', clearing: L.clearingBalance(book2, 'p1') });
  // the extra 500 buys 5 shares at 100 while the close is 110: +50 on day 3 is a real gain, so the two differ;
  const book3 = book.concat([cash('deposit', 550, '2025-01-04'), tx({ id: 'b3', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 5, price: 110, date: '2025-01-04' })]);
  const more3 = VP.build(book3, s2, { today: '2025-01-06', clearing: L.clearingBalance(book3, 'p1') });
  ok('a deposit spent at the close the same day leaves the earlier days untouched', near(more3.points[1].r, base2.points[1].r) && more2.twr > more3.twr);
  const unpriced = book.concat([cash('deposit', 300, '2025-01-03'), tx({ id: 'u', type: 'buy', category: 'stocks', symbol: 'NOPRICE', quantity: 3, price: 100, date: '2025-01-03' })]);
  const up = VP.build(unpriced, series, { today: '2025-01-06', clearing: L.clearingBalance(unpriced, 'p1') });
  ok('a buy of a holding without price history is neutral (not a loss of its cash)', near(up.twr, 0.10, 1e-9), String(up.twr));

  console.log('XIRR with the cash account (returns-engine):');
  const R = require('../returns-engine.js');
  const yr = [cash('deposit', 2000, '2025-01-01'), tx({ id: 'y', type: 'buy', category: 'stocks', symbol: 'X', quantity: 10, price: 100, date: '2025-01-01' })];
  const flows = R.clearingCashflows(L.clearingBalance(yr, 'p1'), 1100, '2026-01-01');
  ok('flows: the deposit out of pocket, the end value = securities + cash', flows.length === 2 && flows[0].amount === -2000 && flows[1].amount === 2100 && flows[1].date === '2026-01-01', JSON.stringify(flows));
  ok('XIRR counts the idle cash (5 % instead of 10 %)', near(R.xirr(flows), 0.05, 1e-4), String(R.xirr(flows)));
  const wd = R.clearingCashflows(L.clearingBalance(yr.concat([cash('withdrawal', 500, '2025-07-01')]), 'p1'), 1100, '2026-01-01');
  ok('a withdrawal is money back to the investor', wd.some((f) => f.date === '2025-07-01' && f.amount === 500));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
