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

  // Per-date FX (fxAt): each leg priced on its OWN date's rate, not one static.
  const fxByDate = (d) => (String(d).slice(0, 4) === '2024' ? 0.80 : 0.95);
  const r2b = TR.build(usd, { year: 2025, exchangeRate: 0.9, baseCurrency: 'EUR', fxAt: fxByDate });
  const d2b = (r2b.realizedGains[0] || r2b.realizedLosses[0]);
  ok('fxAt prices the buy on its date (100*0.80)', d2b && near(d2b.costBasis, 80));
  ok('fxAt prices the sell on its date (100*0.95)', d2b && near(d2b.proceeds, 95));
  ok('per-date FX yields an FX-driven gain (95-80)', d2b && near(d2b.gain, 15));
  ok('currencyConversions carry the date-specific rate', r2b.currencyConversions[0] && near(r2b.currencyConversions[0].rate, 0.95));

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

  console.log('excel workbook (multi-sheet SpreadsheetML):');
  const rx = TR.build([
    { category: 'stocks', symbol: 'AAPL', type: 'buy',  quantity: 10, price: 100, currency: 'EUR', date: '2024-01-01' },
    { category: 'stocks', symbol: 'AAPL', type: 'sell', quantity: 10, price: 150, currency: 'EUR', date: '2025-03-01' },
    { type: 'dividend', symbol: 'AAPL', quantity: 10, price: 0.5, currency: 'EUR', date: '2025-04-01' }
  ], { year: 2025, baseCurrency: 'EUR', exchangeRate: 0.9 });
  const xml = TR.buildExcelWorkbook(rx);
  ok('workbook is SpreadsheetML with the Excel proc instruction', /mso-application progid="Excel.Sheet"/.test(xml) && /urn:schemas-microsoft-com:office:spreadsheet/.test(xml));
  ok('has separate Summary, Realized Gains and Dividends worksheets',
    xml.indexOf('ss:Name="Summary"') > -1 && xml.indexOf('ss:Name="Realized Gains"') > -1 && xml.indexOf('ss:Name="Dividends"') > -1);
  ok('money cells are real Number cells, not strings', /<Cell ss:StyleID="cur"><Data ss:Type="Number">1500<\/Data>/.test(xml));
  ok('a styled header row exists', xml.indexOf('ss:StyleID="hdr"') > -1 && xml.indexOf('#7E22CE') > -1);
  ok('XML special chars are escaped', TR.buildExcelWorkbook(TR.build([], { year: 2025, owner: { name: 'A & B <Co>' } })).indexOf('A &amp; B &lt;Co&gt;') > -1);
  const rg = TR.build([
    { category: 'stocks', symbol: 'WORLD', type: 'buy', quantity: 100, price: 100, currency: 'EUR', date: '2023-01-10' },
    { category: 'stocks', symbol: 'WORLD', type: 'sell', quantity: 50, price: 140, currency: 'EUR', date: '2025-06-01' }
  ], { year: 2025, jurisdiction: 'de', exchangeRate: 0.9, germanTax: require('../tax-calculation-engine.js').GermanTax, dividendEvents: [], fundTypes: { WORLD: 'aktienfonds' } });
  ok('German Tax worksheet present when the detail is computed', TR.buildExcelWorkbook(rg).indexOf('ss:Name="German Tax"') > -1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
