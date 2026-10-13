// Gross / net returns (P5-2.5): net (the default) counts taxes and fees as a
// loss; gross counts them as money taken out, so they do not change the
// return. Withholding tax, tax bookings, trade fees and fee bookings, each net
// of refunds. Every expected figure is computed by hand next to it.
// Run: node test/gross-net.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, e) => a != null && b != null && Math.abs(a - b) <= (e || 1e-9);

globalThis.window = {};
const L = require('../ledger.js');
const R = require('../returns-engine.js');
window.MaerminLedger = L; window.MaerminReturns = R;
const VP = require('../value-path.js');
const F = require('../return-figures.js');

const tx = (o) => Object.assign({ category: 'stocks', currency: 'EUR', portfolioId: 'p1' }, o);
const buy = (date, quantity, price, extra) => tx(Object.assign({ id: 'b' + date, type: 'buy', symbol: 'AAA', date, quantity, price }, extra || {}));
const sell = (date, quantity, price, extra) => tx(Object.assign({ id: 's' + date, type: 'sell', symbol: 'AAA', date, quantity, price }, extra || {}));
const div = (date, quantity, price, extra) => tx(Object.assign({ id: 'd' + date, type: 'dividend', symbol: 'AAA', date, quantity, price }, extra || {}));
const cash = (type, amount, date) => tx({ id: type + date, type, category: 'cashflow', amount, date });
const S = (closes) => ({ 'stocks|AAA': { closes, splits: [] } });
const T = '2025-02-01';

console.log('value path without a cash account:');
{
  const txs = [buy('2025-01-02', 10, 100, { fees: 10 })];
  const s = S([['2025-01-02', 100], ['2025-01-03', 100]]);
  ok('net: the buy fee is a loss (1000/1010 - 1)', near(VP.build(txs, s, { today: T }).twr, 1000 / 1010 - 1));
  ok('gross: the buy fee is money taken out, TWR 0', near(VP.build(txs, s, { today: T, gross: true }).twr, 0));
}
{
  // 10 @ 100, flat; dividend 10 x 1 with 1.50 withholding: net +0.85 %, gross +1 %
  const txs = [buy('2025-01-02', 10, 100), div('2025-01-03', 10, 1, { withholdingTax: 1.5 })];
  const s = S([['2025-01-02', 100], ['2025-01-03', 100]]);
  ok('net: the dividend after withholding (+0.85 %)', near(VP.build(txs, s, { today: T }).twr, 0.0085));
  ok('gross: the dividend before withholding (+1 %)', near(VP.build(txs, s, { today: T, gross: true }).twr, 0.01));
}
{
  // 10 @ 100, close 110, sold at 110 with a fee of 5: net 1.1 x (1 - 5/1100) - 1, gross 10 %
  const txs = [buy('2025-01-02', 10, 100), sell('2025-01-03', 10, 110, { fees: 5 })];
  const s = S([['2025-01-02', 100], ['2025-01-03', 110]]);
  ok('net: the sell fee is a loss', near(VP.build(txs, s, { today: T }).twr, 1.1 * (1 - 5 / 1100) - 1));
  ok('gross: the sell fee is not', near(VP.build(txs, s, { today: T, gross: true }).twr, 0.1));
}

console.log('\nvalue path with a cash account:');
function withClearing(txs, closes, gross) {
  const clr = L.clearingBalance(txs, 'p1', {});
  return VP.build(txs, S(closes), { today: T, clearing: clr, gross });
}
{
  const txs = [cash('deposit', 1010, '2025-01-02'), buy('2025-01-02', 10, 100, { fees: 10 })];
  const closes = [['2025-01-02', 100], ['2025-01-03', 100]];
  ok('the cash account event of a trade carries its fee as cost', L.clearingBalance(txs, 'p1', {}).events.find((e) => e.type === 'buy').cost === 10);
  ok('net: 1010 deposited, 1000 left after the fee (-0.990 %)', near(withClearing(txs, closes).twr, 1000 / 1010 - 1));
  ok('gross: the fee leaves the account as a withdrawal, TWR 0', near(withClearing(txs, closes, true).twr, 0));
  const pts = withClearing(txs, closes, true).points;
  ok('gross keeps the account value (1000 at the end)', near(pts[pts.length - 1].v, 1000), pts);
}
{
  const txs = [cash('deposit', 1000, '2025-01-02'), buy('2025-01-02', 10, 100), div('2025-01-03', 10, 1, { withholdingTax: 1.5 })];
  const closes = [['2025-01-02', 100], ['2025-01-03', 100]];
  ok('a dividend\'s withholding is its cost', L.clearingBalance(txs, 'p1', {}).events.find((e) => e.type === 'dividend').cost === 1.5);
  ok('net: +0.85 % with a cash account', near(withClearing(txs, closes).twr, 0.0085));
  ok('gross: +1 % with a cash account', near(withClearing(txs, closes, true).twr, 0.01));
}
{
  const txs = [cash('deposit', 1000, '2025-01-02'), buy('2025-01-02', 10, 100), cash('tax', 12, '2025-01-03'), cash('fee', 3, '2025-01-03'), cash('tax_refund', 2, '2025-01-03')];
  const closes = [['2025-01-02', 100], ['2025-01-03', 100]];
  ok('net: tax 12 + fee 3 - refund 2 are a loss of 13', near(withClearing(txs, closes).twr, 987 / 1000 - 1));
  ok('gross: tax and fee bookings (and refunds) are money in / out', near(withClearing(txs, closes, true).twr, 0));
}
{
  const txs = [cash('deposit', 1000, '2025-01-02'), buy('2025-01-02', 10, 100), cash('interest_charge', 4, '2025-01-03')];
  const closes = [['2025-01-02', 100], ['2025-01-03', 100]];
  ok('gross: interest charged is neither tax nor fee, still a loss', near(withClearing(txs, closes, true).twr, 996 / 1000 - 1));
}

console.log('\nreturn figures:');
{
  const book = [
    buy('2025-01-02', 10, 100, { fees: 1 }),
    sell('2025-06-02', 4, 150, { fees: 1 }),
    div('2025-08-01', 6, 0.5, { withholdingTax: 0.45 }),
    cash('fee', 5, '2025-09-01'), cash('tax', 12, '2025-10-01'), cash('tax_refund', 2, '2025-11-01')
  ];
  const opts = { securitiesValueEUR: 6 * 160, today: '2025-12-31' };
  const n = F.compute(book, opts), g = F.compute(book, Object.assign({ gross: true }, opts));
  ok('taxes and fees are the same in both', near(n.taxes, g.taxes) && near(n.fees, g.fees) && near(n.taxes, 0.45 + 12 - 2) && near(n.fees, 7));
  ok('gross net return = net return + taxes + fees', near(g.netReturn, n.netReturn + n.taxes + n.fees, 1e-6), [n.netReturn, g.netReturn]);
  ok('gross XIRR is above net XIRR', g.xirr > n.xirr, [n.xirr, g.xirr]);
  ok('the figures say which basis they are', n.basis === 'net' && g.basis === 'gross');
  const c = { p1: L.clearingBalance([cash('deposit', 1000, '2025-01-01')].concat(book), 'p1', {}) };
  const nc = F.compute([cash('deposit', 1000, '2025-01-01')].concat(book), Object.assign({ clearings: c }, opts));
  const gc = F.compute([cash('deposit', 1000, '2025-01-01')].concat(book), Object.assign({ clearings: c, gross: true }, opts));
  ok('with a cash account gross XIRR is above net too', gc.xirr > nc.xirr, [nc.xirr, gc.xirr]);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
