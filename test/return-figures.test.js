// Node harness for P5-1.5: the return figures shared by the Overview and
// Analysis → Returns (MaerminReturnFigures.compute). Hand-computed on a small
// made-up book. Run: node test/return-figures.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const near = (a, b, e) => a !== null && b !== null && Math.abs(a - b) < (e || 1e-6);

globalThis.window = {};
const L = require('../ledger.js');
const R = require('../returns-engine.js');
window.MaerminLedger = L; window.MaerminReturns = R;
const F = require('../return-figures.js');

const fxAt = () => 0.9; // USD → EUR on every date
const tx = (o) => Object.assign({ currency: 'EUR', portfolioId: 'p1' }, o);
const cash = (type, amount, date, extra) => tx(Object.assign({ id: type + date, type, category: 'cashflow', amount, date }, extra || {}));
const book = [
  tx({ id: 'b', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, fees: 1, date: '2025-01-02' }),
  tx({ id: 's', type: 'sell', category: 'stocks', symbol: 'AAPL', quantity: 4, price: 150, fees: 1, date: '2025-06-02' }),
  tx({ id: 'd', type: 'dividend', category: 'stocks', symbol: 'AAPL', quantity: 6, price: 0.5, withholdingTax: 0.45, currency: 'USD', date: '2025-08-01' }),
  cash('fee', 5, '2025-09-01'), cash('tax', 12, '2025-10-01'), cash('tax_refund', 2, '2025-11-01')
];
const TODAY = '2026-01-02';

(function run() {
  console.log('figures (plain portfolio):');
  const f = F.compute(book, { securitiesValueEUR: 960, exchangeRate: 0.5, fxAt, today: TODAY });
  ok('realized gain from the FIFO ledger: 599 − 4 × 100.10 = 198.60', near(f.realized, 198.6), String(f.realized));
  ok('dividends: gross 3 USD = 2.70 EUR, net of 0.45 USD withholding = 2.295 EUR', near(f.dividendsGross, 2.7) && near(f.dividendsNet, 2.295));
  ok('taxes = withholding 0.405 + tax booking 12 − refund 2 = 10.405', near(f.taxes, 10.405), String(f.taxes));
  ok('fees = trade fees 2 + stand-alone fee 5 = 7', near(f.fees, 7), String(f.fees));
  ok('invested (purchases incl. fees) 1,001; proceeds (sales + dividends) 601.295', near(f.invested, 1001) && near(f.proceeds, 601.295));
  ok('net return = 960 + 601.295 − 1,001 − 15 (fee, tax, refund) = 545.295', near(f.netReturn, 545.295) && near(f.netReturnPct, 545.295 / 1001), String(f.netReturn));
  const flows = R.buildCashflows(book, { rate: 0.5, fxAt, currentValueEUR: 960, today: TODAY });
  ok('XIRR = the engine on the same flows as Analysis → Returns', near(f.xirr, R.xirr(flows), 1e-9), f.xirr + ' vs ' + R.xirr(flows));
  ok('without a value path there is no TWR (shown as —)', f.twr === null && f.twrAnnualized === null);
  const vp = { twr: 0.12, annualized: 0.1, start: '2025-01-02', cash: false };
  const fv = F.compute(book, { securitiesValueEUR: 960, exchangeRate: 0.5, fxAt, today: TODAY, valuePath: vp });
  ok('TWR comes from the value path', fv.twr === 0.12 && fv.twrAnnualized === 0.1 && fv.twrSince === '2025-01-02' && fv.twrCash === false);

  console.log('with a clearing account:');
  const withDep = book.concat([cash('deposit', 2000, '2025-01-01')]);
  const clr = L.clearingBalance(withDep, 'p1', { exchangeRate: 0.5, fxAt });
  ok('cash = 2,000 − 1,001 + 599 + 2.295 − 5 − 12 + 2 = 1,585.295', near(clr.balanceEUR, 1585.295));
  const fc = F.compute(withDep, { securitiesValueEUR: 960, exchangeRate: 0.5, fxAt, today: TODAY, clearings: { p1: clr } });
  const want = R.xirr([{ date: '2025-01-01', amount: -2000 }, { date: TODAY, amount: 960 + 1585.295 }]);
  ok('XIRR from the deposit and securities + cash', near(fc.xirr, want, 1e-9), fc.xirr + ' vs ' + want);
  ok('net return is the same with or without the account (cash came from deposits)', near(fc.netReturn, 545.295));
  ok('the cash is reported', near(fc.cash, 1585.295));

  console.log('All portfolios, one with and one without an account:');
  const p2 = [cash('deposit', 500, '2025-03-01', { portfolioId: 'p2' }),
    tx({ id: 'm', type: 'buy', category: 'stocks', symbol: 'MSFT', quantity: 2, price: 200, date: '2025-03-02', portfolioId: 'p2' })];
  const all = book.concat(p2);
  const clr2 = L.clearingBalance(all, 'p2');
  const fm = F.compute(all, { securitiesValueEUR: 960 + 420, exchangeRate: 0.5, fxAt, today: TODAY, clearings: { p2: clr2 } });
  const mixed = R.buildCashflows(book, { rate: 0.5, fxAt }).concat([{ date: '2025-03-01', amount: -500 }, { date: TODAY, amount: 960 + 420 + 100 }]);
  ok('XIRR: trades of the plain portfolio + deposits of the other, end = all securities + cash', near(fm.xirr, R.xirr(mixed), 1e-9), fm.xirr + ' vs ' + R.xirr(mixed));
  ok('cash of the account portfolio only', near(fm.cash, 100));

  console.log('merging accounts and empty books:');
  const tr = [cash('deposit', 1000, '2025-01-01', { portfolioId: 'a' }), cash('transfer_out', 300, '2025-02-01', { portfolioId: 'a', transferId: 't', counterPortfolioId: 'b' }),
    cash('transfer_in', 300, '2025-02-01', { portfolioId: 'b', transferId: 't', counterPortfolioId: 'a' })];
  const merged = L.mergeClearings([L.clearingBalance(tr, 'a'), L.clearingBalance(tr, 'b')]);
  ok('mergeClearings: a transfer between two accounts cancels out', merged.external.length === 1 && merged.external[0].amount === 1000 && near(merged.balanceEUR, 1000));
  ok('mergeClearings keeps every event for the value path', merged.events.length === 3);
  const none = F.compute([], { securitiesValueEUR: 0, today: TODAY });
  ok('no transactions → every figure null (cards show —)', ['xirr', 'twr', 'realized', 'dividendsNet', 'taxes', 'fees', 'netReturn'].every((k) => none[k] === null));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
