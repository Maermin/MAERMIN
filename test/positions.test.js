// Node harness for the shared position-aggregation helper (MaerminMetrics
// .buildPositions / .computeStats) — the single source the renderer's four
// former aggregation passes now delegate to. Run: node test/positions.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

globalThis.window = {};
// metrics.js leans on PortfolioHealth for some funcs but not for buildPositions/
// computeStats, so a bare load is enough.
const M = require('../metrics.js');

(function run() {
  console.log('buildPositions — aggregation + cost basis:');
  const txs = [
    { category: 'stocks', symbol: 'AAPL', type: 'buy', quantity: 10, price: 100, currency: 'EUR', date: '2024-01-01', symbolName: 'Apple' },
    { category: 'stocks', symbol: 'AAPL', type: 'buy', quantity: 10, price: 120, currency: 'EUR', date: '2024-02-01' },
    { category: 'stocks', symbol: 'AAPL', type: 'sell', quantity: 5, price: 130, currency: 'EUR', date: '2024-03-01' },
    { category: 'crypto', symbol: 'BTC', type: 'buy', quantity: 1, price: 1000, currency: 'USD', date: '2024-01-01' },
  ];
  const p = M.buildPositions(txs, { exchangeRate: 0.9 });

  const aapl = p.stocks.find(x => x.symbol === 'AAPL');
  ok('AAPL aggregated across buys', aapl && near(aapl.amount, 15));
  // avg cost = (10*100 + 10*120) = 2200 over 20 → 110/share; sell removes 5/20 of basis
  // remaining basis 2200*(1-0.25)=1650 over 15 → 110/share (avg cost unchanged by sell)
  ok('avg cost basis preserved after sell', aapl && near(aapl.purchasePrice, 110));
  ok('human name carried from picker tx', aapl && aapl.name === 'Apple');

  const btc = p.crypto.find(x => x.symbol === 'BTC');
  ok('USD tx converted to EUR cost basis (1000*0.9=900)', btc && near(btc.purchasePrice, 900));

  console.log('buildPositions — fully-sold position drops out:');
  const sold = M.buildPositions([
    { category: 'crypto', symbol: 'ETH', type: 'buy', quantity: 2, price: 10, currency: 'EUR' },
    { category: 'crypto', symbol: 'ETH', type: 'sell', quantity: 2, price: 12, currency: 'EUR' },
  ], { exchangeRate: 0.9 });
  ok('sold-out ETH not listed', !sold.crypto.find(x => x.symbol === 'ETH'));

  console.log('computeStats — totals + P/L:');
  const stats = M.computeStats(p, { AAPL: 130, BTC: 1100 });
  // AAPL 15*130=1950 ; BTC 1*1100=1100 → value 3050
  ok('total value uses live prices', near(stats.totalValue, 3050));
  // invested: AAPL 15*110=1650 + BTC 1*900=900 = 2550
  ok('total invested = EUR cost basis', near(stats.totalInvested, 2550));
  ok('profit = value - invested', near(stats.totalProfit, 500));
  ok('position count', stats.totalPositions === 2);

  console.log('computeStats — missing price falls back to cost (no zeroing):');
  const s2 = M.computeStats(p, {}); // no prices
  ok('value falls back to cost basis when price missing', near(s2.totalValue, s2.totalInvested));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
