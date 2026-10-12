// Node harness for P5-1.3: cash-flow transaction types in the one ledger.
// deposit, withdrawal, transfer in/out (a pair between portfolios), fee, fee
// refund, tax, tax refund, interest charge. They never create positions or
// lots; their signed EUR amount is the effect on the portfolio's cash.
// Run: node test/cashflow-types.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

globalThis.window = {};
const L = require('../ledger.js');
const M = require('../metrics.js');

const cash = (type, amount, extra) => Object.assign({ id: type + amount, type, category: 'cashflow', amount, currency: 'EUR', date: '2026-03-02', portfolioId: 'default' }, extra || {});

(function run() {
  console.log('cash-flow types:');
  const types = ['deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'fee', 'fee_refund', 'tax', 'tax_refund', 'interest_charge'];
  ok('nine cash types', types.every((t) => L.CASH_TYPES[t]) && Object.keys(L.CASH_TYPES).length === 9);
  ok('isCash knows them and nothing else', types.every((t) => L.isCash({ type: t })) && !L.isCash({ type: 'buy' }) && !L.isCash({ type: 'dividend' }) && !L.isCash(null));

  const rows = [cash('deposit', 1000), cash('withdrawal', 200), cash('fee', 5), cash('fee_refund', 2), cash('tax', 30), cash('tax_refund', 10),
    cash('interest_charge', 4), cash('transfer_out', 100, { transferId: 't1', counterPortfolioId: 'pf2' }),
    cash('transfer_in', 100, { portfolioId: 'pf2', transferId: 't1', counterPortfolioId: 'default' })];
  const cf = L.cashFlows(rows);
  const by = (type) => cf.rows.find((r) => r.type === type);
  ok('signs follow the portfolio cash: deposit +, withdrawal -, fee -, refund +', by('deposit').signedEUR === 1000 && by('withdrawal').signedEUR === -200
    && by('fee').signedEUR === -5 && by('fee_refund').signedEUR === 2 && by('tax').signedEUR === -30 && by('tax_refund').signedEUR === 10 && by('interest_charge').signedEUR === -4);
  ok('a transfer is - in one portfolio and + in the other', by('transfer_out').signedEUR === -100 && by('transfer_in').signedEUR === 100);
  ok('fees, taxes, refunds and interest charges are investment flows', ['fee', 'fee_refund', 'tax', 'tax_refund', 'interest_charge'].every((t) => by(t).flow === true));
  ok('deposits, withdrawals and transfers are not (until a clearing account exists)', ['deposit', 'withdrawal', 'transfer_in', 'transfer_out'].every((t) => by(t).flow === false));
  ok('totals per type', cf.byType.fee === 5 && cf.byType.deposit === 1000 && cf.byType.tax_refund === 10);
  ok('totals per year and type', cf.byYear['2026'] && cf.byYear['2026'].tax === 30);
  ok('buys, sells and dividends are not cash rows', L.cashFlows([{ type: 'buy', amount: 5, date: '2026-01-01' }, { type: 'dividend', quantity: 1, price: 2, date: '2026-01-01' }]).rows.length === 0);
  ok('portfolio filter', L.cashFlows(rows, { portfolioId: 'pf2' }).rows.length === 1);

  // USD at the rate of the booking date
  const usd = L.cashFlows([cash('fee', 10, { currency: 'USD', date: '2025-06-02' })], { exchangeRate: 0.5, fxAt: (d) => (d === '2025-06-02' ? 0.9 : null) });
  ok('USD converts at the rate of its date', near(usd.rows[0].amountEUR, 9) && near(usd.rows[0].signedEUR, -9), String(usd.rows[0] && usd.rows[0].amountEUR));

  // Bad rows are reported, never booked
  const bad = L.cashFlows([cash('fee', 0, { id: 'z' }), cash('tax', -3, { id: 'neg' }), cash('deposit', 'x', { id: 'nan' })]);
  ok('zero, negative or missing amounts are not booked', bad.rows.length === 0);
  ok('they are reported with the transaction id', bad.issues.length === 3 && bad.issues.every((i) => i.kind === 'cash-amount') && bad.issues[0].txId === 'z');

  console.log('validation and transfer pairs:');
  ok('validateCash: complete deposit is fine', L.validateCash(cash('deposit', 10)).length === 0);
  ok('validateCash: amount and date are required', L.validateCash({ type: 'fee', amount: 0, currency: 'EUR' }).join() === 'amount,date');
  ok('validateCash: a transfer needs a different target portfolio', L.validateCash(cash('transfer_out', 10, { transferId: 't', counterPortfolioId: 'default' })).indexOf('counterPortfolioId') > -1);
  let n = 0;
  const pair = L.transferPair({ amount: 250, currency: 'EUR', date: '2026-04-01', fromPortfolioId: 'default', toPortfolioId: 'pf2', notes: 'rebalance' }, () => 'id' + (++n));
  ok('transferPair makes an out and an in row', pair.length === 2 && pair[0].type === 'transfer_out' && pair[1].type === 'transfer_in');
  ok('both rows share one transferId and point at each other', pair[0].transferId && pair[0].transferId === pair[1].transferId
    && pair[0].portfolioId === 'default' && pair[0].counterPortfolioId === 'pf2' && pair[1].portfolioId === 'pf2' && pair[1].counterPortfolioId === 'default');
  ok('pair rows are valid cash rows with their own ids', pair.every((r) => L.validateCash(r).length === 0 && r.category === 'cashflow' && r.amount === 250) && pair[0].id !== pair[1].id);
  ok('transferPair refuses the same portfolio on both sides', L.transferPair({ amount: 1, currency: 'EUR', date: '2026-01-01', fromPortfolioId: 'a', toPortfolioId: 'a' }) === null);
  ok('pairOf finds the other half', L.pairOf(pair, pair[0]) === pair[1] && L.pairOf(pair, pair[1]) === pair[0] && L.pairOf(pair, cash('fee', 1)) === null);

  console.log('no positions, no lots:');
  const trades = [{ id: 'b', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 2, price: 100, currency: 'EUR', date: '2026-01-02', portfolioId: 'default' }];
  const withCash = trades.concat(rows);
  ok('ledger groups are unchanged by cash rows', L.build(withCash).list.length === 1 && L.build(withCash).issues.length === 0);
  const p0 = M.buildPositions(trades), p1 = M.buildPositions(withCash);
  ok('positions are unchanged by cash rows', JSON.stringify(p0) === JSON.stringify(p1));

  console.log('XIRR flows (returns-engine):');
  const R = require('../returns-engine.js');
  const buy = { id: 'b1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, fees: 5, currency: 'EUR', date: '2025-01-02', portfolioId: 'default' };
  const base = R.buildCashflows([buy], { rate: 1 });
  ok('a trade fee stays on the trade (one flow of -1005)', base.length === 1 && base[0].amount === -1005);
  const flowsCash = R.buildCashflows([buy, cash('fee', 12, { date: '2025-06-01' }), cash('tax_refund', 7, { date: '2025-07-01' }), cash('interest_charge', 3, { date: '2025-08-01' }),
    cash('deposit', 5000, { date: '2025-01-01' }), cash('withdrawal', 100, { date: '2025-09-01' }),
    cash('transfer_out', 50, { date: '2025-09-02', transferId: 'x', counterPortfolioId: 'pf2' })], { rate: 1 });
  const amt = (d) => (flowsCash.find((f) => f.date === d) || {}).amount;
  ok('a stand-alone fee is an outflow', amt('2025-06-01') === -12);
  ok('cash flows carry their type (the Returns cards keep buys and fees apart)', flowsCash.find((f) => f.date === '2025-06-01').type === 'fee' && !('type' in flowsCash.find((f) => f.date === '2025-01-02')));
  ok('a tax refund is an inflow', amt('2025-07-01') === 7);
  ok('an interest charge is an outflow', amt('2025-08-01') === -3);
  ok('deposits, withdrawals and transfers are not flows yet', flowsCash.length === 4, JSON.stringify(flowsCash));
  ok('the trade flow is unchanged (no double count)', flowsCash.find((f) => f.date === '2025-01-02').amount === -1005);
  const usdFee = R.buildCashflows([cash('fee', 10, { currency: 'USD', date: '2025-06-02' })], { rate: 0.5, fxAt: () => 0.9 });
  ok('a USD fee converts at the rate of its date', usdFee.length === 1 && Math.abs(usdFee[0].amount + 9) < 1e-9, JSON.stringify(usdFee));
  ok('a category filter (asset classes) leaves cash rows out', R.buildCashflows([cash('fee', 1)], { rate: 1, categories: ['stocks'] }).length === 0);

  console.log('tax report:');
  const TR = require('../tax-report-builder.js');
  const sale = [
    { id: 's1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, currency: 'EUR', date: '2024-01-02', portfolioId: 'default' },
    { id: 's2', type: 'sell', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 150, currency: 'EUR', date: '2025-03-02', portfolioId: 'default' }];
  const cashRows = [cash('tax', 120, { date: '2025-03-03' }), cash('tax_refund', 20, { date: '2025-04-01' }), cash('fee', 6, { date: '2025-05-01' }),
    cash('fee_refund', 1, { date: '2025-05-02' }), cash('interest_charge', 3, { date: '2025-06-01' }), cash('tax', 99, { date: '2024-12-31' }), cash('fee', 7, { date: '2025-06-02', currency: 'USD' })];
  const us0 = TR.build(sale, { year: 2025, jurisdiction: 'us', baseCurrency: 'EUR', exchangeRate: 1 });
  const us1 = TR.build(sale.concat(cashRows), { year: 2025, jurisdiction: 'us', baseCurrency: 'EUR', exchangeRate: 1 });
  ok('the computed tax does not change with cash bookings', us0.summary.estimatedTaxLiability === us1.summary.estimatedTaxLiability && us0.summary.totalTaxableIncome === us1.summary.totalTaxableIncome);
  const cb = us1.summary.cashBookings;
  ok('taxes paid, refunds, fees and interest charges of the year are listed', cb && cb.tax === 120 && cb.tax_refund === 20 && cb.fee === 13 && cb.fee_refund === 1 && cb.interest_charge === 3, JSON.stringify(cb));
  ok('bookings of another year stay out', cb.tax === 120);
  ok('a cash row in another currency lists its amount in the conversions', us1.currencyConversions.some((c) => c.date === '2025-06-02' && c.originalAmount === 7));

  console.log('editor (utils.upsertCash):');
  const U = require('../utils.js');
  let k = 0; const nid = () => 'n' + (++k);
  const form = (o) => Object.assign({ type: 'deposit', amount: 500, currency: 'EUR', date: '2026-05-04', notes: '', portfolioId: 'default' }, o);
  const buyRow = { id: 'b', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 1, price: 10, currency: 'EUR', date: '2026-01-01', portfolioId: 'default' };

  let r = U.upsertCash([buyRow], form(), null, nid);
  const dep = r.transactions[1];
  ok('a new deposit is appended as a clean cash row', r.transactions.length === 2 && dep.type === 'deposit' && dep.category === 'cashflow' && dep.amount === 500 && dep.portfolioId === 'default' && !('symbol' in dep) && L.validateCash(dep).length === 0);

  r = U.upsertCash([buyRow], form({ type: 'transfer_out', amount: 300, counterPortfolioId: 'pf2' }), null, nid);
  const [, out1, in1] = r.transactions;
  ok('a new transfer adds both rows', r.transactions.length === 3 && out1.type === 'transfer_out' && in1.type === 'transfer_in' && out1.transferId === in1.transferId && in1.portfolioId === 'pf2');
  ok('a transfer to the same portfolio is refused', U.upsertCash([], form({ type: 'transfer_out', counterPortfolioId: 'default' }), null, nid).error === 'counterPortfolioId');

  const withPair = r.transactions;
  r = U.upsertCash(withPair, form({ type: 'transfer_out', amount: 350, counterPortfolioId: 'pf2' }), in1.id, nid);
  const out2 = r.transactions.find((x) => x.id === out1.id), in2 = r.transactions.find((x) => x.id === in1.id);
  ok('editing either half updates both and keeps ids and transferId', r.transactions.length === 3 && out2.amount === 350 && in2.amount === 350 && out2.transferId === out1.transferId && in2.transferId === out1.transferId);

  r = U.upsertCash(withPair, form({ type: 'transfer_in', amount: 300, portfolioId: 'default', counterPortfolioId: 'pf2' }), out1.id, nid);
  const flipOut = r.transactions.find((x) => x.type === 'transfer_out'), flipIn = r.transactions.find((x) => x.type === 'transfer_in');
  ok('a transfer_in form (money into this portfolio) is stored as out of the other one', flipOut.portfolioId === 'pf2' && flipIn.portfolioId === 'default' && r.transactions.length === 3);

  r = U.upsertCash(withPair, form({ type: 'fee', amount: 9 }), out1.id, nid);
  ok('a transfer edited into a fee drops its other half', r.transactions.length === 2 && r.transactions[1].id === out1.id && r.transactions[1].type === 'fee' && !r.transactions[1].transferId && !r.transactions[1].counterPortfolioId);

  r = U.upsertCash([buyRow, dep], form({ type: 'transfer_out', amount: 40, counterPortfolioId: 'pf2' }), dep.id, nid);
  ok('a deposit edited into a transfer gains its other half', r.transactions.length === 3 && r.transactions.find((x) => x.id === dep.id).type === 'transfer_out' && r.transactions.some((x) => x.type === 'transfer_in' && x.portfolioId === 'pf2'));

  r = U.upsertCash([buyRow], form({ type: 'tax', amount: 12 }), 'b', nid);
  const conv = r.transactions[0];
  ok('a buy edited into a cash type loses its trade fields', conv.id === 'b' && conv.type === 'tax' && !('quantity' in conv) && !('symbol' in conv) && !('price' in conv) && conv.amount === 12);
  ok('editing an unknown id changes nothing', U.upsertCash([buyRow], form(), 'nope', nid).transactions.length === 1);
  ok('an invalid amount is refused', U.upsertCash([], form({ amount: 0 }), null, nid).error === 'amount');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
