// Node harness for P5-2.1: value-change attribution ("profit by source",
// MaerminValueAttribution). Every figure is hand-computed on a small made-up
// book; the parts must add up to end value − start value to the cent.
// Run: node test/value-attribution.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const near = (a, b, e) => a !== null && b !== null && a !== undefined && Math.abs(a - b) < (e || 1e-6);

globalThis.window = {};
const L = require('../ledger.js');
window.MaerminLedger = L;
const VA = require('../value-attribution.js');

// EUR per USD: 0.9 until the end of June 2025, 0.8 afterwards
const fxAt = (d) => (d < '2025-07-01' ? 0.9 : 0.8);
const tx = (o) => Object.assign({ currency: 'EUR', portfolioId: 'p1' }, o);
const cash = (type, amount, date, extra) => tx(Object.assign({ id: type + date, type, category: 'cashflow', amount, date }, extra || {}));
// Daily closes in EUR (as the renderer converts them); UUU quotes in USD.
const series = {
  'stocks|AAA': { cur: 'EUR', closes: [['2025-01-02', 100], ['2025-03-31', 110], ['2025-06-02', 120], ['2025-06-30', 125], ['2025-12-31', 130]] },
  'stocks|UUU': { cur: 'USD', closes: [['2025-01-02', 45], ['2025-06-30', 45], ['2025-12-31', 48]] } // 50 USD, 50 USD, 60 USD
};
const book = [
  tx({ id: 'b1', type: 'buy', category: 'stocks', symbol: 'AAA', quantity: 10, price: 100, fees: 1, date: '2025-01-02' }),
  tx({ id: 'b2', type: 'buy', category: 'stocks', symbol: 'UUU', quantity: 10, price: 50, fees: 0, currency: 'USD', date: '2025-01-02' }),
  tx({ id: 's1', type: 'sell', category: 'stocks', symbol: 'AAA', quantity: 4, price: 121, fees: 1, date: '2025-06-02' }),
  tx({ id: 'd1', type: 'dividend', category: 'stocks', symbol: 'AAA', quantity: 6, price: 1, withholdingTax: 0.5, date: '2025-08-01' }),
  cash('fee', 5, '2025-09-01'), cash('tax', 12, '2025-10-01'), cash('tax_refund', 2, '2025-11-01')
];
const TODAY = '2025-12-31';
const sumParts = (p) => p.moneyIn - p.moneyOut + p.income + p.realized + p.unrealized + p.fx - p.fees - p.taxes + p.residual;

(function run() {
  console.log('whole history, portfolio without a clearing account:');
  const a = VA.compute(book, series, { start: '2025-01-01', today: TODAY, fxAt, exchangeRate: 0.8 });
  ok('start value 0, end value 6 × 130 + 10 × 48 = 1,260', near(a.startValue, 0) && near(a.endValue, 1260), a.startValue + ' → ' + a.endValue);
  ok('money in: buys 1,001 + 450, fee booking 5, tax booking 12 = 1,468', near(a.parts.moneyIn, 1468), String(a.parts.moneyIn));
  ok('money out: sale 483, dividend net 5.50, tax refund 2 = 490.50', near(a.parts.moneyOut, 490.5), String(a.parts.moneyOut));
  ok('income: dividend gross 6', near(a.parts.income, 6) && near(a.detail.dividends, 6) && near(a.detail.interest, 0));
  ok('realized gain before fees: 4 × (121 − 100) = 84', near(a.parts.realized, 84), String(a.parts.realized));
  ok('currency effect: 10 × 50 USD × (0.80 − 0.90) = −50', near(a.parts.fx, -50), String(a.parts.fx));
  ok('change in unrealized gains (FX taken out): 180 + 30 + 50 = 260', near(a.parts.unrealized, 260), String(a.parts.unrealized));
  ok('fees: trade fees 2 + fee booking 5 = 7', near(a.parts.fees, 7) && near(a.detail.tradeFees, 2), String(a.parts.fees));
  ok('taxes: withholding 0.50 + tax 12 − refund 2 = 10.50', near(a.parts.taxes, 10.5) && near(a.detail.withholding, 0.5), String(a.parts.taxes));
  ok('nothing unexplained', near(a.parts.residual, 0), String(a.parts.residual));
  ok('the parts add up to end − start exactly', near(sumParts(a.parts), a.endValue - a.startValue));
  ok('profit = change − net money in = 1,260 − 977.50 = 282.50', near(a.profit, 282.5), String(a.profit));
  ok('no clearing account, nothing missing', a.cash === false && a.missing.length === 0);

  console.log('second half-year only:');
  const h = VA.compute(book, series, { start: '2025-06-30', end: '2025-12-31', today: TODAY, fxAt, exchangeRate: 0.8 });
  ok('start value at the close of 30 June: 6 × 125 + 10 × 45 = 1,200', near(h.startValue, 1200), String(h.startValue));
  ok('money in 17 (fee + tax bookings), out 7.50 (dividend net + refund)', near(h.parts.moneyIn, 17) && near(h.parts.moneyOut, 7.5));
  ok('no sale in the period: realized 0', near(h.parts.realized, 0));
  ok('currency effect −50, unrealized +110 (30 AAA + 30 UUU + 50 FX)', near(h.parts.fx, -50) && near(h.parts.unrealized, 110), h.parts.fx + ' / ' + h.parts.unrealized);
  ok('fees 5, taxes 10.50, parts add up, residual 0', near(h.parts.fees, 5) && near(h.parts.taxes, 10.5) && near(sumParts(h.parts), 60) && near(h.parts.residual, 0));
  const e0 = VA.compute(book, series, { start: '2025-12-31', today: TODAY, fxAt });
  ok('an empty period changes nothing', near(e0.endValue - e0.startValue, 0) && near(e0.profit, 0));

  console.log('portfolio with a clearing account:');
  const cb = [cash('deposit', 2000, '2025-01-01', { portfolioId: 'c' })].concat(book.filter(t => t.symbol !== 'UUU' && t.type !== 'tax' && t.type !== 'tax_refund').map(t => Object.assign({}, t, { portfolioId: 'c' })),
    [cash('withdrawal', 300, '2025-12-01', { portfolioId: 'c' })]);
  const clr = L.clearingBalance(cb, 'c', { fxAt });
  const c = VA.compute(cb, series, { start: '2024-12-31', today: TODAY, fxAt, clearings: { c: clr } });
  ok('end value = 6 × 130 securities + 1,182.50 cash', near(c.endValue, 780 + 1182.5) && c.cash === true, String(c.endValue));
  ok('money in = the deposit 2,000; money out = the withdrawal 300 (trades stay inside)', near(c.parts.moneyIn, 2000) && near(c.parts.moneyOut, 300), c.parts.moneyIn + ' / ' + c.parts.moneyOut);
  ok('income 6, realized 84, unrealized 180, no FX', near(c.parts.income, 6) && near(c.parts.realized, 84) && near(c.parts.unrealized, 180) && near(c.parts.fx, 0));
  ok('fees 7, taxes 0.50 (withholding)', near(c.parts.fees, 7) && near(c.parts.taxes, 0.5));
  ok('parts add up, residual 0', near(sumParts(c.parts), c.endValue - c.startValue) && near(c.parts.residual, 0), String(c.parts.residual));
  const VP = require('../value-path.js');
  const path = VP.build(cb, series, { today: TODAY, fxAt, clearing: clr });
  const pathNo = VP.build(book, series, { today: TODAY, fxAt, exchangeRate: 0.8 });
  ok('end values match the value path (with and without a clearing account)', near(path.points[path.points.length - 1].v, c.endValue) && near(pathNo.points[pathNo.points.length - 1].v, a.endValue),
    path.points[path.points.length - 1].v + ' / ' + pathNo.points[pathNo.points.length - 1].v);
  const cz = cb.concat([tx({ id: 'z', type: 'buy', category: 'stocks', symbol: 'ZZZ', quantity: 1, price: 50, fees: 0, portfolioId: 'c', date: '2025-03-01' })]);
  const z = VA.compute(cz, series, { start: '2024-12-31', today: TODAY, fxAt, clearings: { c: L.clearingBalance(cz, 'c', { fxAt }) } });
  ok('a holding without price history: its purchase leaves the measured book as money out', near(z.parts.moneyOut, 350) && near(z.parts.residual, 0), z.parts.moneyOut + ' / ' + z.parts.residual);
  ok('... and is listed as not priced', z.missing.length === 1 && z.missing[0].symbol === 'ZZZ');

  console.log('today, splits, edge cases:');
  const live = VA.compute(book, series, { start: '2025-12-31', today: '2026-01-05', fxAt, live: { 'stocks|AAA': 140 } });
  ok("today's quote replaces the last close: +6 × 10 = 60", near(live.parts.unrealized, 60) && near(live.endValue, 840 + 480), String(live.parts.unrealized));
  const sp = [tx({ id: 'x', type: 'buy', category: 'stocks', symbol: 'SPL', quantity: 10, price: 100, fees: 0, date: '2025-01-02' })];
  const sps = { 'stocks|SPL': { cur: 'EUR', closes: [['2025-01-02', 50], ['2025-12-31', 60]] } };
  const s = VA.compute(sp, sps, { start: '2025-01-01', today: TODAY, splits: { 'stocks|SPL': [{ date: '2025-03-01', num: 2, den: 1 }] } });
  ok('a recorded 2:1 split doubles the units: 20 × 60 = 1,200, gain 200', near(s.endValue, 1200) && near(s.parts.unrealized, 200) && near(s.parts.residual, 0), s.endValue + ' / ' + s.parts.unrealized);
  ok('no transactions → null', VA.compute([], series, { today: TODAY }) === null);
  const opt = VA.compute([tx({ type: 'buy', category: 'options', symbol: 'O', quantity: 1, price: 5, date: '2025-01-02' })], series, { today: TODAY });
  ok('options are left out (valued by the options engine)', opt === null);

  console.log('periods and summary:');
  ok('1M before 31 Dec = 30 Nov', VA.periodStart('1M', '2025-12-31') === '2025-11-30');
  ok('1M before 31 Mar = 28 Feb (month end kept)', VA.periodStart('1M', '2025-03-31') === '2025-02-28');
  ok('3M = 30 Sep, YTD = 31 Dec of the year before, 1Y = a year back', VA.periodStart('3M', '2025-12-31') === '2025-09-30' && VA.periodStart('YTD', '2025-12-31') === '2024-12-31' && VA.periodStart('1Y', '2025-12-31') === '2024-12-31');
  ok('Max = the day before the first booking', VA.periodStart('MAX', '2025-12-31', book) === '2025-01-01');
  ok('biggest source of the profit: the unrealized gains', VA.biggest(a.parts).key === 'unrealized' && near(VA.biggest(a.parts).amount, 260));
  ok('a period without profit parts has no biggest source', VA.biggest(e0.parts) === null);
  ok('the parts in display order', VA.PARTS.join(',') === 'moneyIn,moneyOut,income,realized,unrealized,fx,fees,taxes,residual');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
