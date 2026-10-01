// The one FIFO implementation (ledger.js) and its consumers: positions,
// tax report, tax advisor and the yield-on-cost basis must all agree.
// Run: node test/ledger.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

const L = require('../ledger.js');
const M = require('../metrics.js');
const TR = require('../tax-report-builder.js');
const TA = require('../tax-advisor.js');

console.log('ledger:');
const txs = [
  { type: 'buy',  category: 'stocks', symbol: 'aapl', quantity: 10, price: 100, fees: 10, currency: 'USD', date: '2024-01-10' },
  { type: 'buy',  category: 'stocks', symbol: 'AAPL', quantity: 10, price: 200, fees: 0,  currency: 'USD', date: '2025-01-10' },
  { type: 'sell', category: 'stocks', symbol: 'AAPL', quantity: 15, price: 300, fees: 15, currency: 'USD', date: '2025-06-01' },
  { type: 'buy',  category: 'crypto', symbol: 'BTC',  quantity: 1,  price: 1000, currency: 'EUR', date: '2025-02-01' },
  { type: 'sell', category: 'crypto', symbol: 'BTC',  quantity: 2,  price: 1500, currency: 'EUR', date: '2025-03-01' }, // oversell by 1
  { type: 'dividend', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 1, currency: 'USD', date: '2025-05-01' }
];
const fxAt = (d) => (String(d) < '2025-01-01' ? 0.8 : 0.9); // per-date USD->EUR
const R = L.build(txs, { exchangeRate: 0.85, fxAt });
const aapl = R.groups['stocks|AAPL'];
ok('groups case-insensitively by category + symbol', !!aapl && R.list.length === 2);
// lot 1: (100 + 10/10) * 0.8 = 80.8/unit; lot 2: 200 * 0.9 = 180/unit
ok('buy fee + per-date FX in the unit cost', near(aapl.disposals[0].unitCostEUR, 80.8));
ok('sell consumes the oldest lot first', near(aapl.disposals[0].qty, 10) && near(aapl.disposals[1].qty, 5));
// proceeds: 15 * 300 * 0.9 = 4050, fee 15 * 0.9 = 13.5 pro-rated 10/15 and 5/15
ok('sell fee pro-rated over the matched lots', near(aapl.disposals[0].proceeds, 2700 - 9) && near(aapl.disposals[1].proceeds, 1350 - 4.5));
ok('long-term only when held > 1 year', aapl.disposals[0].longTerm === true && aapl.disposals[1].longTerm === false);
ok('open lot left: 5 units at 180', near(aapl.openQty, 5) && near(aapl.openCostEUR, 900));
ok('dividends are not trades', aapl.disposals.length === 2);
const btc = R.groups['crypto|BTC'];
ok('oversell remainder is reported, not dropped silently', near(btc.oversold, 1) && near(btc.disposals[0].qty, 1));
const sameDay = L.build([
  { type: 'sell', category: 'crypto', symbol: 'ETH', quantity: 1, price: 2, date: '2025-01-01' },
  { type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 1, date: '2025-01-01' }
]).groups['crypto|ETH'];
ok('same-day round trip: buy booked before sell', near(sameDay.realizedGain, 1) && near(sameDay.openQty, 0));

console.log('consumers agree:');
const pos = M.buildPositions(txs, { exchangeRate: 0.85, fxAt });
ok('positions list = ledger open lots', near(pos.stocks[0].amount, aapl.openQty) && near(pos.stocks[0].purchasePrice * pos.stocks[0].amount, aapl.openCostEUR));
const disp = TR.fifo(txs, 2025, 0.85, fxAt).filter(d => d.symbol === 'AAPL');
ok('tax report disposals = ledger disposals', disp.length === 2 && near(disp[0].gain + disp[1].gain, aapl.realizedGain));
const lots = TA.buildCryptoLots([
  { type: 'buy', category: 'crypto', symbol: 'SOL', quantity: 2, price: 100, fees: 4, currency: 'EUR', date: '2025-01-01' },
  { type: 'sell', category: 'crypto', symbol: 'SOL', quantity: 1, price: 150, currency: 'EUR', date: '2025-02-01' }
], () => null);
ok('tax advisor crypto lots include the buy fee (same basis as the report)', lots.length === 1 && near(lots[0].costBasisEUR, 102));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
