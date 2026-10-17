// "All portfolios": a virtual, read-only portfolio over every portfolio's live
// transactions (MaerminMetrics.ALL_PORTFOLIOS). Its holdings, cost basis,
// realised P&L, dividends, fees, cash and net worth must be the sum of the
// portfolios; a transfer between two of them must net to zero; XIRR is
// computed from the merged flows, never averaged.
// Run: node test/all-portfolios.test.js
'use strict';
const M = require('../metrics.js');
const L = require('../ledger.js');
const RF = require('../return-figures.js');
const R = require('../returns-engine.js');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + JSON.stringify(detail) : '')); }
}
const approx = (a, b, eps) => Math.abs(a - b) < (eps || 0.005);
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);

// Sample data: A (main depot, clearing account), B (broker, clearing
// account), C (empty). SAP is held in A and B; B sells part of its own SAP.
// 500 € move from A to B. USD trades convert at the rate of their date.
const fxAt = (d) => (d < '2022-01-01' ? 0.9 : 0.95);
const RATE = 0.92;
const opts = { exchangeRate: RATE, fxAt };
const s = (o) => Object.assign({ category: 'stocks', symbol: 'SAP', currency: 'EUR', fees: 0 }, o);
const txs = [
  { id: 'a0', type: 'deposit', category: 'cashflow', amount: 5000, currency: 'EUR', date: '2020-01-02', portfolioId: 'default' },
  s({ id: 'a1', type: 'buy', quantity: 10, price: 100, fees: 5, date: '2020-03-02', portfolioId: 'default' }),
  { id: 'a2', type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 0.1, price: 10000, currency: 'USD', fees: 0, date: '2021-01-04', portfolioId: 'default' },
  s({ id: 'a3', type: 'dividend', quantity: 10, price: 2, withholdingTax: 3, date: '2023-05-15', portfolioId: 'default' }),
  { id: 'a4', type: 'fee', category: 'cashflow', amount: 12, currency: 'EUR', date: '2023-12-31', portfolioId: 'default' },
  ...L.transferPair({ amount: 500, currency: 'EUR', date: '2024-02-01', fromPortfolioId: 'default', toPortfolioId: 'pf_b' }, (() => { let i = 0; return () => 'x' + (++i); })()),
  s({ id: 'b1', type: 'buy', quantity: 10, price: 200, fees: 0, date: '2024-03-01', portfolioId: 'pf_b' }),
  { id: 'b0', type: 'deposit', category: 'cashflow', amount: 1600, currency: 'EUR', date: '2024-02-20', portfolioId: 'pf_b' },
  s({ id: 'b2', type: 'sell', quantity: 5, price: 190, fees: 2, date: '2025-05-02', portfolioId: 'pf_b' }),
  { id: 'b3', type: 'tax', category: 'cashflow', amount: 4, currency: 'EUR', date: '2025-05-02', portfolioId: 'pf_b' },
  { id: 'b4', type: 'buy', category: 'crypto', symbol: 'btc', quantity: 0.05, price: 60000, currency: 'USD', fees: 1, date: '2025-06-01', portfolioId: 'pf_b' }
];
const portfolios = [{ id: 'default', name: 'Main' }, { id: 'pf_b', name: 'Broker' }, { id: 'pf_c', name: 'Empty' }];
const prices = { SAP: 210, BTC: 90000 };
const ALL = M.ALL_PORTFOLIOS;
const TODAY = '2026-10-17';

const per = portfolios.map((p) => {
  const t = M.portfolioTransactions(txs, p.id);
  return { id: p.id, txs: t, pf: M.buildPositions(t, opts) };
});
const allTxs = M.portfolioTransactions(txs, ALL);
const allPf = M.buildPositions(allTxs, opts);
const pos = (pf, cls, sym) => (pf[cls] || []).find((x) => String(x.symbol).toUpperCase() === sym);
const cost = (p) => (p ? p.amount * p.purchasePrice : 0);

console.log('virtual portfolio:');
ok('ALL_PORTFOLIOS is "all" (the id the snapshots and the Overview already use)', ALL === 'all' && M.isAllPortfolios('all') && !M.isAllPortfolios('default'));
ok('it reads the live rows: no copies, every row exactly once', allTxs === txs && allTxs.length === sum(per, (p) => p.txs.length));
ok('rows without a portfolio belong to "default"', M.portfolioTransactions([{ id: 'z', type: 'buy' }], 'default').length === 1);
const edited = txs.concat([s({ id: 'n1', type: 'buy', quantity: 1, price: 100, date: '2026-01-02', portfolioId: 'pf_b' })]);
ok('a row added to any portfolio shows up at once', approx(pos(M.buildPositions(M.portfolioTransactions(edited, ALL), opts), 'stocks', 'SAP').amount, 16));
ok('a row deleted from any portfolio is gone at once', !pos(M.buildPositions(txs.filter((t) => t.symbol !== 'SAP'), opts), 'stocks', 'SAP'));

console.log('holdings and cost basis = sum of the portfolios:');
const sapAll = pos(allPf, 'stocks', 'SAP');
ok('the same asset in two portfolios is one position', allPf.stocks.filter((x) => x.symbol === 'SAP').length === 1);
ok('quantity: 10 (A) + 5 (B) = 15', approx(sapAll.amount, sum(per, (p) => (pos(p.pf, 'stocks', 'SAP') || { amount: 0 }).amount)) && approx(sapAll.amount, 15));
ok('cost basis: A 1,005 (incl. 5 fee) + B 1,000 = 2,005', approx(cost(sapAll), 2005) && approx(cost(sapAll), sum(per, (p) => cost(pos(p.pf, 'stocks', 'SAP')))), cost(sapAll));
ok('B\'s sale takes B\'s own lot, not A\'s older one (pooled FIFO gave 2,505)', !approx(cost(sapAll), 2505));
ok('average cost = cost basis / quantity', approx(sapAll.purchasePrice, 2005 / 15));
ok('first purchase date is the oldest open lot of any portfolio', sapAll.purchaseDate === '2020-03-02', sapAll.purchaseDate);
const btcAll = pos(allPf, 'crypto', 'BTC');
ok('symbol case does not split a holding (BTC / btc)', !!btcAll && allPf.crypto.length === 1 && approx(btcAll.amount, 0.15));
ok('USD cost at the rate of each purchase date: 0.1×10,000×0.9 + (0.05×60,000+1)×0.95', approx(cost(btcAll), 900 + 3001 * 0.95), cost(btcAll));
const statsAll = M.computeStats(allPf, prices);
const totals = M.computePortfolioTotals(portfolios, txs, prices, opts);
ok('total value = sum of the portfolio cards', approx(statsAll.totalValue, sum(totals, (t) => t.value)), [statsAll.totalValue, totals]);
ok('invested = sum of the portfolio cards', approx(statsAll.totalInvested, sum(totals, (t) => t.invested)));
ok('unrealised P&L = sum of the portfolio cards', approx(statsAll.totalProfit, sum(totals, (t) => t.pnl)));
ok('the empty portfolio adds nothing', totals.find((t) => t.id === 'pf_c').value === 0);

console.log('realised P&L, dividends, fees, taxes:');
const figs = (t, extra) => RF.compute(t, Object.assign({ securitiesValueEUR: M.computeStats(M.buildPositions(t, opts), prices).totalValue, exchangeRate: RATE, fxAt, today: TODAY }, extra || {}));
const fAll = figs(allTxs);
const fPer = per.map((p) => figs(p.txs));
const sumOf = (k) => sum(fPer, (f) => f[k] || 0);
ok('realised: B sold 5 at 190 (−2 fee) from its 200 lot = −52; the sum of the portfolios', approx(fAll.realized, -52) && approx(fAll.realized, sumOf('realized')), [fAll.realized, sumOf('realized')]);
ok('dividends gross / net = sum', approx(fAll.dividendsGross, sumOf('dividendsGross')) && approx(fAll.dividendsNet, sumOf('dividendsNet')) && approx(fAll.dividendsGross, 20));
ok('fees (trade + stand-alone) = sum', approx(fAll.fees, sumOf('fees')), [fAll.fees, sumOf('fees')]);
ok('taxes (withholding + tax bookings) = sum', approx(fAll.taxes, sumOf('taxes')) && approx(fAll.taxes, 7));
ok('invested and proceeds = sum', approx(fAll.invested, sumOf('invested')) && approx(fAll.proceeds, sumOf('proceeds')));
ok('total return = sum', approx(fAll.netReturn, sumOf('netReturn')));
const pooled = L.build(allTxs, { exchangeRate: RATE, fxAt }).list.reduce((x, g) => x + g.realizedGain, 0);
ok('the tax report\'s pooled FIFO is unchanged (the sale takes A\'s 2020 lot: 948 − 502.50 = +445.50)', approx(pooled, 445.5), pooled);
const byPf = L.build(allTxs, { exchangeRate: RATE, fxAt, perPortfolio: true });
ok('ledger perPortfolio: one group per portfolio, each carrying its portfolioId', byPf.list.filter((g) => g.symbol === 'SAP').map((g) => g.portfolioId).sort().join() === 'default,pf_b');

console.log('cash, transfers and net worth:');
const clr = {};
['default', 'pf_b'].forEach((id) => { clr[id] = L.clearingBalance(txs, id, opts); });
const vcAll = L.viewClearing(clr, portfolios.map((p) => p.id));
ok('with one portfolio lacking a clearing account, XIRR still gets the existing ones', !!vcAll.clearings && Object.keys(vcAll.clearings).length === 2);
ok('… but the value path gets no half-merged cash account', vcAll.merged === null);
const vc = L.viewClearing(clr, ['default', 'pf_b']);
ok('cash balance = sum of the clearing accounts', approx(vc.merged.balanceEUR, clr.default.balanceEUR + clr.pf_b.balanceEUR));
ok('the transfer is an outflow of A and an inflow of B …', clr.default.external.some((e) => e.d === '2024-02-01' && approx(e.amount, -500)) && clr.pf_b.external.some((e) => e.d === '2024-02-01' && approx(e.amount, 500)));
ok('… and no external flow at all for both together', !vc.merged.external.some((e) => e.d === '2024-02-01'));
ok('real deposits stay external flows', approx(sum(vc.merged.external, (e) => e.amount), 6600));
ok('a single portfolio\'s view is its own account', L.viewClearing(clr, ['pf_b']).merged === clr.pf_b);
ok('no portfolio with an account: nothing to merge', L.viewClearing(clr, ['pf_c']).clearings === null && L.viewClearing(clr, ['pf_c']).merged === null);
const cf = L.cashFlows(allTxs, opts);
ok('transfers are not deposits, withdrawals or flows', cf.rows.filter((r) => L.isTransfer(r)).every((r) => r.flow === false) && approx(cf.byType.transfer_in, cf.byType.transfer_out));
const cashSum = clr.default.balanceEUR + clr.pf_b.balanceEUR;
const nwAll = statsAll.totalValue + vc.merged.balanceEUR;
ok('net worth (securities + cash) = sum of the portfolios, counted once', approx(nwAll, sum(totals, (t) => t.value) + cashSum));

console.log('performance from the merged flows:');
const fAllCash = figs(allTxs, { clearings: vc.clearings });
const fA = figs(per[0].txs, { clearings: { default: clr.default } });
const fB = figs(per[1].txs, { clearings: { pf_b: clr.pf_b } });
const flowsAll = fAllCash.xirrFlows.filter((f) => f.date !== TODAY);
const flowsSum = fA.xirrFlows.concat(fB.xirrFlows).filter((f) => f.date !== TODAY);
ok('the merged XIRR flows are the union of the portfolios\' flows', approx(sum(flowsAll, (f) => f.amount), sum(flowsSum, (f) => f.amount)));
const onTransfer = flowsAll.filter((f) => f.date === '2024-02-01');
ok('the transfer nets to zero in the merged XIRR flows', approx(sum(onTransfer, (f) => f.amount), 0), onTransfer);
const endAll = fAllCash.xirrFlows.filter((f) => f.date === TODAY).reduce((x, f) => x + f.amount, 0);
ok('end value = all securities + all cash', approx(endAll, statsAll.totalValue + cashSum));
const avg = (fA.xirr + fB.xirr) / 2;
ok('XIRR comes from the merged flows (equals xirr(union), not the average)', fAllCash.xirr !== null && approx(fAllCash.xirr, R.xirr(fAllCash.xirrFlows), 1e-9) && !approx(fAllCash.xirr, avg, 1e-4), { all: fAllCash.xirr, a: fA.xirr, b: fB.xirr });

console.log('edge cases:');
const one = [s({ id: 'o1', type: 'buy', quantity: 3, price: 50, date: '2024-01-02', portfolioId: 'default' })];
ok('a single portfolio: "All portfolios" equals it', JSON.stringify(M.buildPositions(M.portfolioTransactions(one, ALL), opts)) === JSON.stringify(M.buildPositions(M.portfolioTransactions(one, 'default'), opts)));
ok('no transactions: empty positions and null figures', M.buildPositions(M.portfolioTransactions([], ALL), opts).stocks.length === 0 && RF.compute([], {}).realized === null);
const over = [s({ id: 'v1', type: 'buy', quantity: 10, price: 100, date: '2020-01-02', portfolioId: 'default' }), s({ id: 'v2', type: 'sell', quantity: 4, price: 120, date: '2021-01-02', portfolioId: 'pf_b' })];
ok('a sale in a portfolio without the units does not eat another portfolio\'s lot', approx(pos(M.buildPositions(over, opts), 'stocks', 'SAP').amount, 10));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
