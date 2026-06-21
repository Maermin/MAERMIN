// Tests for the allocation engine (#5). Run: node test/allocation.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

globalThis.window = {};
const A = require('../allocation.js');

(function run() {
  const portfolio = {
    stocks: [{ symbol: 'AAPL', amount: 10 }, { symbol: 'VWCE', amount: 5 }],
    crypto: [{ symbol: 'BTC', amount: 1 }],
    skins:  [{ symbol: 'AK', amount: 2 }],
    commodities: []
  };
  const prices = { AAPL: 100, VWCE: 100, BTC: 500, AK: 50 };
  // values: stocks = 1000+500=1500, crypto=500, skins=100 → total 2100

  console.log('basic allocation:');
  const r = A.computeAllocation(portfolio, prices);
  ok('total = sum of all positions', near(r.total, 2100));
  const stocks = r.byClass.find(c => c.key === 'stocks');
  ok('stocks value aggregated', near(stocks.value, 1500));
  ok('stocks pct correct', near(stocks.pct, 1500 / 2100 * 100));
  ok('percentages sum to 100', near(r.byClass.reduce((s, c) => s + c.pct, 0), 100, 1e-6));
  ok('absolute values present', r.byClass.every(c => typeof c.value === 'number'));
  ok('sorted by value desc', r.byClass[0].value >= r.byClass[1].value);

  console.log('drill-down:');
  ok('stocks drilldown lists positions sorted', stocks.positions.length === 2 && stocks.positions[0].symbol === 'AAPL');
  ok('position pct is share of TOTAL', near(stocks.positions[0].pct, 1000 / 2100 * 100));

  console.log('ETF split:');
  const split = A.computeAllocation(portfolio, prices, { classifyEtf: p => p.symbol === 'VWCE' });
  ok('VWCE moved into ETFs bucket', !!split.byClass.find(c => c.key === 'etfs' && near(c.value, 500)));
  ok('stocks bucket reduced to AAPL only', near(split.byClass.find(c => c.key === 'stocks').value, 1000));

  console.log('cash / other inclusion:');
  const withCash = A.computeAllocation(portfolio, prices, {
    includeCash: true,
    accounts: [{ type: 'cash', name: 'Savings', value: 900 }, { type: 'loan', name: 'Mortgage', value: 5000 }, { type: 'property', name: 'Flat', value: 0 }]
  });
  ok('cash folded in (2100 + 900 = 3000)', near(withCash.total, 3000));
  ok('liabilities excluded from allocation', !withCash.byClass.find(c => c.label === 'Mortgage'));
  const cash = withCash.byClass.find(c => c.key === 'cash');
  ok('cash class present with correct pct', cash && near(cash.pct, 900 / 3000 * 100));

  console.log('empty portfolio:');
  const empty = A.computeAllocation({}, {});
  ok('empty → available false, total 0', empty.available === false && empty.total === 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
