// Node harness for P5-5.4: the research page's maths and data - SMA, EMA,
// MACD and Bollinger bands on a close series, the user's own position in the
// symbol (from the FIFO ledger), its journal entries and the analysts' upside.
// Run: node test/research.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
const approx = (a, b, e) => a != null && Math.abs(a - b) < (e || 1e-9);
const RS = require('../research.js');

(function main() {
  console.log('research:');
  const v = Array.from({ length: 30 }, (_, i) => i + 1);

  // ---- indicators -----------------------------------------------------------------
  const s5 = RS.sma(v, 5);
  ok('SMA 5: empty for the first 4 days, then the mean (1..5 = 3; 26..30 = 28)', s5[3] === null && approx(s5[4], 3) && approx(s5[29], 28) && s5.length === 30);
  const e3 = RS.ema([1, 2, 3, 4, 5], 3);
  ok('EMA 3: seeded with the SMA of the first 3 (2), then k = 0.5: 3, 4', e3[1] === null && approx(e3[2], 2) && approx(e3[3], 3) && approx(e3[4], 4), e3);
  const eFlat = RS.ema(Array(40).fill(7), 20);
  ok('EMA of a flat series is the series', approx(eFlat[39], 7) && eFlat[18] === null);
  const m = RS.macd(v, 3, 6, 2);
  // On a straight line both EMAs lag by (n-1)/2: MACD = (6-1)/2 - (3-1)/2 = 1.5; the signal settles at 1.5; histogram 0.
  ok('MACD (3, 6, 2) on a straight line: 1.5, signal 1.5, histogram 0', approx(m.macd[29], 1.5) && approx(m.signal[29], 1.5) && approx(m.hist[29], 0) && m.macd[4] === null, { macd: m.macd[29], sig: m.signal[29] });
  const md = RS.macd(v);
  const v40 = Array.from({ length: 40 }, (_, i) => i + 1), md40 = RS.macd(v40);
  ok('MACD default (12, 26, 9): starts at the 26th close, the signal 8 closes later', md40.macd[24] === null && md40.macd[25] !== null && md40.signal[32] === null && md40.signal[33] !== null, { m: md40.macd.slice(24, 27), s: md40.signal.slice(31, 35) });
  void md;
  const bb = RS.bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  ok('Bollinger (8, 2): mean 5, population SD 2 → bands 1 and 9', approx(bb.mid[7], 5) && approx(bb.upper[7], 9) && approx(bb.lower[7], 1) && bb.mid[6] === null, bb);
  ok('gaps (null closes) are skipped, not treated as 0', approx(RS.sma([1, null, 3, 5], 2)[3], 4) && RS.sma([1, null, 3, 5], 2)[1] === null);

  // ---- own position ------------------------------------------------------------------
  const T = (o) => Object.assign({ category: 'stocks', currency: 'EUR', portfolioId: 'default' }, o);
  const txs = [
    T({ id: 'a', type: 'buy', symbol: 'SAP.DE', quantity: 10, price: 100, date: '2024-01-10' }),
    T({ id: 'b', type: 'buy', symbol: 'SAP.DE', quantity: 10, price: 140, date: '2025-01-10' }),
    T({ id: 'c', type: 'sell', symbol: 'SAP.DE', quantity: 5, price: 180, date: '2025-06-01' }),
    T({ id: 'd', type: 'dividend', symbol: 'SAP.DE', quantity: 15, price: 2.2, date: '2025-05-20' }),
    T({ id: 'e', type: 'buy', symbol: 'AAPL', quantity: 1, price: 150, currency: 'USD', date: '2025-02-01' })
  ];
  const p = RS.ownPosition(txs, 'sap.de', { priceEUR: 200 });
  ok('own position: 15 shares (FIFO: the 5 sold came from the first lot), cost 5 x 100 + 10 x 140 = 1,900', approx(p.quantity, 15) && approx(p.costEUR, 1900), p);
  ok('value 3,000, unrealised +1,100 (+57.9 %), realised 5 x 80 = 400', approx(p.valueEUR, 3000) && approx(p.gainEUR, 1100) && approx(p.gainPct, 1100 / 1900) && approx(p.realizedEUR, 400), p);
  ok('dividends received 33 EUR, first buy, trades newest first', approx(p.dividendsEUR, 33) && p.since === '2024-01-10' && p.trades[0].date === '2025-06-01' && p.trades.length === 3, p.trades);
  ok('a symbol not held: null', RS.ownPosition(txs, 'MSFT', {}) === null);

  // ---- journal and analysts -------------------------------------------------------------
  const journal = { 'stocks-sap.de': { thesis: 'Cloud shift', target: '250', notes: '', reviews: [{ date: '2025-06-01', text: 'Trimmed' }] }, 'stocks-aapl': { thesis: 'x' } };
  const j = RS.journalFor(journal, 'SAP.DE');
  ok('journal entries of the symbol', j.length === 1 && j[0].thesis === 'Cloud shift' && j[0].reviews.length === 1);
  const a = RS.analystView({ count: 41, targetMean: 270, targetLow: 200, targetHigh: 320, recommendationMean: 2.0, trend: [{ period: '0m', strongBuy: 12, buy: 20, hold: 8, sell: 1, strongSell: 0 }] }, 250);
  ok('analysts: upside to the mean target 8 %, range position of the price, rating shares', approx(a.upside, 0.08) && approx(a.pricePos, 50 / 120) && a.total === 41 && approx(a.shares.buy, 20 / 41), a);
  ok('no analysts: null', RS.analystView({ count: null, targetMean: null, trend: [] }, 250) === null);
  const eps = RS.epsSurprises([{ quarter: '3Q2025', actual: 1.65, estimate: 1.6 }, { quarter: '4Q2025', actual: 2.3, estimate: 2.35 }]);
  ok('EPS surprises: beat +3.1 %, miss -2.1 %', eps[0].beat === true && approx(eps[0].surprise, 0.05 / 1.6) && eps[1].beat === false, eps);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
