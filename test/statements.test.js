// Node harness for P5-4.8: statement of assets, cost roll-forward (audit),
// DATEV-style booking rows and the source-of-funds trace for crypto sales.
// Run: node test/statements.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

const ST = require('../statements.js');
const L = require('../ledger.js');

const T = (o) => Object.assign({ category: 'stocks', currency: 'EUR', portfolioId: 'A' }, o);
const C = (o) => Object.assign({ category: 'crypto', currency: 'EUR', portfolioId: 'X' }, o);

(function main() {
  console.log('statements:');

  // ---- ledger: lot identity --------------------------------------------------
  const lg = L.build([T({ id: 'b1', type: 'buy', symbol: 'AAA', quantity: 5, price: 10, date: '2024-01-01' }), T({ id: 's1', type: 'sell', symbol: 'AAA', quantity: 2, price: 12, date: '2024-02-01' })], { exchangeRate: 1 }).list[0];
  ok('ledger: lots and disposals carry the buy and sale ids', lg.openLots[0].txId === 'b1' && lg.disposals[0].acquisitionTxId === 'b1' && lg.disposals[0].disposalTxId === 's1', lg.disposals[0]);

  // ---- statement of assets ----------------------------------------------------
  const txs = [
    T({ id: 't1', type: 'buy', symbol: 'SAP.DE', quantity: 10, price: 150, fees: 5, date: '2024-01-10' }),
    T({ id: 't2', type: 'buy', symbol: 'AAPL', quantity: 5, price: 100, currency: 'USD', date: '2024-02-10' }),
    T({ id: 't3', type: 'sell', symbol: 'SAP.DE', quantity: 4, price: 200, fees: 2, date: '2025-03-10' }),
    T({ id: 'd1', type: 'deposit', category: 'cashflow', amount: 3000, date: '2024-01-01' }),
    C({ id: 'c1', type: 'buy', symbol: 'BTC', quantity: 0.5, price: 40000, date: '2024-03-01' }),
    T({ id: 'o1', type: 'buy', category: 'options', symbol: 'AAPL C 200', quantity: 1, price: 5, date: '2024-03-01' })
  ];
  const pfs = [{ id: 'A', name: 'Depot A' }, { id: 'X', name: 'Exchange X' }];
  let st = ST.assetStatement(txs, { asOf: '2026-10-14', prices: { 'SAP.DE': 230, AAPL: 200, BTC: 95000 }, exchangeRate: 0.9, portfolios: pfs });
  const a = st.portfolios.find((p) => p.id === 'A'), x = st.portfolios.find((p) => p.id === 'X');
  const sap = a.holdings.find((h) => h.symbol === 'SAP.DE'), aapl = a.holdings.find((h) => h.symbol === 'AAPL');
  ok('per portfolio, named; options left out', a.name === 'Depot A' && x.name === 'Exchange X' && a.holdings.length === 2, a.holdings.map((h) => h.symbol));
  ok('SAP.DE: 6 left, value 6 x 230 = 1,380, cost 6 x 150.50 = 903', approx(sap.quantity, 6) && approx(sap.value, 1380) && approx(sap.cost, 903), sap);
  ok('AAPL in USD converted: 5 x 200 x 0.9 = 900', approx(aapl.value, 900) && approx(aapl.price, 180));
  ok('crypto prices are EUR: 0.5 BTC = 47,500', approx(x.holdings[0].value, 47500));
  // Cash: 3,000 deposit - (1,505 + 450 buy) + (800 - 2) sale = 1,843 (EUR at 0.9 for AAPL).
  ok('clearing balance where cash is tracked (deposit, trades): 1,843', approx(a.cash, 3000 - 1505 - 450 + 798), a.cash);
  ok('no cash tracked: cash null', x.cash === null);
  ok('totals: per portfolio and overall', approx(a.total, 1380 + 900 + a.cash) && approx(st.total, a.total + x.total));
  st = ST.assetStatement(txs, { asOf: '2026-10-14', prices: { 'SAP.DE': 230 }, exchangeRate: 0.9, portfolios: pfs });
  ok('no price: value null, listed as missing, left out of the total', st.missingPrices.indexOf('AAPL') >= 0 && st.portfolios.find((p) => p.id === 'A').holdings.find((h) => h.symbol === 'AAPL').value === null, st.missingPrices);
  st = ST.assetStatement(txs, { asOf: '2024-12-31', prices: { 'SAP.DE': 230, AAPL: 200, BTC: 95000 }, exchangeRate: 0.9, portfolios: pfs });
  ok('as of an earlier date: the 2025 sale is not yet counted (10 SAP.DE)', approx(st.portfolios.find((p) => p.id === 'A').holdings.find((h) => h.symbol === 'SAP.DE').quantity, 10));

  // ---- roll-forward -------------------------------------------------------------
  const rf = ST.rollForward(txs, { year: 2025, exchangeRate: 0.9 });
  const r = rf.rows.find((x) => x.symbol === 'SAP.DE');
  ok('roll-forward 2025, SAP.DE: opening 10 / 1,505, sold 4 at cost 602, closing 6 / 903', approx(r.openingQty, 10) && approx(r.openingCost, 1505) && approx(r.soldQty, 4) && approx(r.soldCost, 602) && approx(r.closingQty, 6) && approx(r.closingCost, 903), r);
  ok('proceeds net of fees 798, realised 196', approx(r.proceeds, 798) && approx(r.realized, 196));
  ok('every row adds up (opening + bought - sold cost = closing)', rf.rows.every((x) => x.ok) && rf.ok);
  const rf24 = ST.rollForward(txs, { year: 2024, exchangeRate: 0.9 });
  const r24 = rf24.rows.find((x) => x.symbol === 'SAP.DE');
  ok('roll-forward 2024: bought 10 at cost 1,505 (fees included)', approx(r24.openingQty, 0) && approx(r24.boughtQty, 10) && approx(r24.boughtCost, 1505) && approx(r24.closingCost, 1505), r24);
  const bad = ST.rollForward([T({ type: 'sell', symbol: 'ZZZ', quantity: 3, price: 10, date: '2025-05-01' })], { year: 2025, exchangeRate: 1 });
  ok('a sale of units never bought is flagged (oversold)', bad.ok === false && bad.rows[0].ok === false && approx(bad.rows[0].oversold, 3), bad.rows[0]);
  ok('roll-forward CSV with a header and one row per holding', ST.rollForwardCSV(rf).split('\n').length === rf.rows.length + 1 && /;/.test(ST.rollForwardCSV(rf)));

  // ---- DATEV-style rows -----------------------------------------------------------
  const acc = { bank: '1200', securities: '1510', crypto: '1520', dividends: '2650', interest: '2655', fees: '4970', taxes: '2150', transfer: '1360' };
  const dtx = txs.concat([
    T({ id: 'v1', type: 'dividend', symbol: 'SAP.DE', quantity: 6, price: 2.2, date: '2025-05-20' }),
    T({ id: 'f1', type: 'fee', category: 'cashflow', amount: 9.9, date: '2025-06-30' }),
    T({ id: 'w1', type: 'withdrawal', category: 'cashflow', amount: 500, date: '2025-07-01' })
  ]);
  const rows = ST.datevRows(dtx, { year: 2025, accounts: acc, exchangeRate: 0.9 });
  const sell = rows.find((x) => x.beleg === 't3'), div = rows.find((x) => x.beleg === 'v1'), fee = rows.find((x) => x.beleg === 'f1'), wd = rows.find((x) => x.beleg === 'w1');
  ok('only the year\'s bookings', rows.length === 4, rows.map((x) => x.beleg));
  ok('sale: bank debited with the net proceeds 798 against securities', sell.amount === 798 && sell.sh === 'S' && sell.konto === '1200' && sell.gegenkonto === '1510' && sell.date === '1003', sell);
  ok('dividend: bank against dividends, 13.20', approx(div.amount, 13.2) && div.konto === '1200' && div.gegenkonto === '2650');
  ok('fee: fees debited against bank', fee.konto === '4970' && fee.gegenkonto === '1200' && fee.sh === 'S' && approx(fee.amount, 9.9));
  ok('withdrawal: transfer account against bank', wd.konto === '1360' && wd.gegenkonto === '1200' && approx(wd.amount, 500));
  const buys = ST.datevRows(txs, { year: 2024, accounts: acc, exchangeRate: 0.9 });
  ok('buys: securities or crypto debited against bank, cost incl. fees', buys.find((x) => x.beleg === 't1').konto === '1510' && approx(buys.find((x) => x.beleg === 't1').amount, 1505) && buys.find((x) => x.beleg === 'c1').konto === '1520', buys);
  const csv = ST.datevCSV(rows);
  ok('CSV: Buchungsstapel column order, decimal comma, semicolons', /^Umsatz \(ohne Soll\/Haben-Kz\);Soll\/Haben-Kennzeichen;WKZ Umsatz;Konto;Gegenkonto \(ohne BU-Schlüssel\);Belegdatum;Belegfeld 1;Buchungstext/.test(csv) && csv.indexOf('798,00;S;EUR;1200;1510;1003;t3;') > 0, csv.split('\n').slice(0, 3));
  ok('an unset account stays empty and is reported', ST.datevRows(dtx, { year: 2025, accounts: {}, exchangeRate: 0.9 }).missingAccounts.length > 0);

  // ---- source of funds ----------------------------------------------------------------
  // EUR -> BTC on exchange X, BTC -> ETH (a swap booked as a BTC sale and an ETH
  // buy quoted in BTC on the same day), then ETH sold for EUR.
  const sof = [
    C({ id: 'k1', type: 'buy', symbol: 'BTC', quantity: 1, price: 20000, date: '2023-01-05' }),
    C({ id: 'k2', type: 'sell', symbol: 'BTC', quantity: 0.5, price: 30000, date: '2024-02-01' }),
    C({ id: 'k3', type: 'buy', symbol: 'ETH', quantity: 10, price: 0.05, currency: 'BTC', date: '2024-02-01' }),
    C({ id: 'k4', type: 'sell', symbol: 'ETH', quantity: 4, price: 3000, date: '2025-06-01' }),
    C({ id: 'k5', type: 'buy', symbol: 'ETH', quantity: 2, price: 2500, date: '2024-05-01', portfolioId: 'Y' })
  ];
  const sales = ST.cryptoSales(sof);
  ok('crypto sales listed (BTC 2024, ETH 2025)', sales.length === 2 && sales.some((s) => s.txId === 'k4'), sales);
  const tr = ST.sourceOfFunds(sof, 'k4', { exchangeRate: 1, portfolios: [{ id: 'X', name: 'Exchange X' }] });
  ok('the ETH sale: 4 ETH from the 2024-02-01 lot (FIFO)', tr.sale.symbol === 'ETH' && tr.lots.length === 1 && tr.lots[0].acquisitionDate === '2024-02-01' && approx(tr.lots[0].quantity, 4), tr.lots);
  const f = tr.lots[0].funding;
  ok('funded by a swap from BTC, traced to the BTC sale of the same day', f.kind === 'swap' && f.from === 'BTC' && f.trace && f.trace.sale.txId === 'k2', f);
  ok('which goes back to EUR on Exchange X (2023-01-05)', f.trace.lots[0].acquisitionDate === '2023-01-05' && f.trace.lots[0].funding.kind === 'fiat' && f.trace.lots[0].funding.currency === 'EUR' && f.trace.lots[0].funding.portfolioName === 'Exchange X', f.trace.lots[0]);
  const noSale = ST.sourceOfFunds(sof.filter((t) => t.id !== 'k2'), 'k4', { exchangeRate: 1 });
  ok('a swap without a recorded sale of the paying coin is named, not invented', noSale.lots[0].funding.kind === 'swap' && noSale.lots[0].funding.trace === null, noSale.lots[0].funding);
  ok('an unknown sale id: null', ST.sourceOfFunds(sof, 'nope', {}) === null);
  ok('text summary for the PDF', /ETH/.test(ST.sourceOfFundsLines(tr).join('\n')) && /BTC/.test(ST.sourceOfFundsLines(tr).join('\n')) && /EUR/.test(ST.sourceOfFundsLines(tr).join('\n')));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
