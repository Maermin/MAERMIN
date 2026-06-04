// Node harness for the tax report builder — currency-correct FIFO, section
// assembly, gain/loss split. Run: node test/tax-report.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

globalThis.window = {};
globalThis.localStorage = { _d: {}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };
const TR = require('../tax-report-builder.js');

(function run() {
  console.log('FIFO realized gains (currency-correct):');
  const txs = [
    { category: 'stocks', symbol: 'AAPL', type: 'buy',  quantity: 10, price: 100, currency: 'EUR', date: '2024-01-10' },
    { category: 'stocks', symbol: 'AAPL', type: 'buy',  quantity: 10, price: 200, currency: 'EUR', date: '2024-06-10' },
    { category: 'stocks', symbol: 'AAPL', type: 'sell', quantity: 15, price: 250, currency: 'EUR', date: '2025-02-10' },
  ];
  const r = TR.build(txs, { year: 2025, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 0.9, portfolio: {}, prices: {} });

  // Per-lot: the 15-share sell splits into the 10-share (2024-01-10, long-term)
  // and 5-share (2024-06-10, short-term) lots.
  const all = r.realizedGains.concat(r.realizedLosses);
  ok('sell splits into 2 per-lot disposals', all.length === 2);
  const lotA = all.find(d => d.acquisitionDate === '2024-01-10');
  const lotB = all.find(d => d.acquisitionDate === '2024-06-10');
  ok('lot A: 10 sh, cost 1000, proceeds 2500, gain 1500', lotA && near(lotA.costBasis, 1000) && near(lotA.proceeds, 2500) && near(lotA.gain, 1500));
  ok('lot B: 5 sh, cost 1000, proceeds 1250, gain 250', lotB && near(lotB.costBasis, 1000) && near(lotB.proceeds, 1250) && near(lotB.gain, 250));
  ok('total cost basis across lots = 2000', near(lotA.costBasis + lotB.costBasis, 2000));
  ok('disposal date = sell date', lotA && lotA.disposalDate === '2025-02-10');
  ok('lot A long-term (held >365d)', lotA && lotA.longTerm === true);
  ok('lot B short-term (held <365d)', lotB && lotB.longTerm === false);

  console.log('currency conversion to base (USD→EUR):');
  const usd = [
    { category: 'stocks', symbol: 'MSFT', type: 'buy',  quantity: 1, price: 100, currency: 'USD', date: '2024-01-01' },
    { category: 'stocks', symbol: 'MSFT', type: 'sell', quantity: 1, price: 100, currency: 'USD', date: '2025-01-01' },
  ];
  const r2 = TR.build(usd, { year: 2025, exchangeRate: 0.9, baseCurrency: 'EUR' });
  const d2 = (r2.realizedGains[0] || r2.realizedLosses[0]);
  ok('USD cost basis converted to EUR (100*0.9)', d2 && near(d2.costBasis, 90));
  ok('USD proceeds converted to EUR (100*0.9)', d2 && near(d2.proceeds, 90));
  ok('currency conversion section lists the USD txs', r2.currencyConversions.length === 1);

  console.log('losses, dividends, sections:');
  const mix = [
    { category: 'crypto', symbol: 'BTC', type: 'buy',  quantity: 1, price: 1000, currency: 'EUR', date: '2024-01-01' },
    { category: 'crypto', symbol: 'BTC', type: 'sell', quantity: 1, price: 600,  currency: 'EUR', date: '2025-03-01' },
    { type: 'dividend', symbol: 'AAPL', quantity: 10, price: 0.5, currency: 'EUR', date: '2025-04-01' },
  ];
  const r3 = TR.build(mix, { year: 2025, baseCurrency: 'EUR', exchangeRate: 0.9 });
  ok('loss captured in realizedLosses', r3.realizedLosses.length === 1 && near(r3.realizedLosses[0].gain, -400));
  ok('dividend income aggregated (10*0.5=5)', near(r3.summary.dividendIncome, 5));
  ok('transaction summary counts the year', r3.transactionSummary.sell === 1 && r3.transactionSummary.dividend === 1);
  ok('report has all expected sections', ['summary','realizedGains','realizedLosses','dividends','interest','currencyConversions','transactionSummary','openPositions','corporateActions'].every(k => k in r3));
  ok('meta records FIFO + year + base', r3.meta.method === 'FIFO' && r3.meta.year === 2025 && r3.meta.baseCurrency === 'EUR');

  console.log('open positions from portfolio:');
  const r4 = TR.build([], { year: 2025, portfolio: { stocks: [{ symbol: 'AAPL', amount: 5, purchasePrice: 100 }] }, prices: { AAPL: 150 } });
  ok('open position unrealized = (150-100)*5', r4.openPositions.length === 1 && near(r4.openPositions[0].unrealized, 250));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
