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
  // FIFO: the sell of 5 consumes the OLDEST lot (10@100) first, leaving
  // 5@100 + 10@120 = 1700 over 15 → 113.33/share (lot-based, matches the FIFO
  // tax report — no longer the old average-cost 110).
  ok('FIFO cost basis after sell (oldest lots first)', aapl && near(aapl.purchasePrice, 1700 / 15));
  ok('human name carried from picker tx', aapl && aapl.name === 'Apple');

  const btc = p.crypto.find(x => x.symbol === 'BTC');
  ok('USD tx converted to EUR cost basis (1000*0.9=900)', btc && near(btc.purchasePrice, 900));

  // FIFO lot engine directly: a richer interleaved case the tax report agrees with.
  const lots = M.matchFifoLots([
    { type: 'buy',  quantity: 10, price: 100, currency: 'EUR', date: '2024-01-01' },
    { type: 'buy',  quantity: 10, price: 120, currency: 'EUR', date: '2024-02-01' },
    { type: 'sell', quantity: 12, price: 130, currency: 'EUR', date: '2024-03-01' },
  ], 0.9);
  // 12 sold consumes 10@100 + 2@120 → remaining 8@120 = 960 over 8 → 120/share.
  ok('matchFifoLots leaves the newest lots', near(lots.amount, 8) && near(lots.totalCostEUR, 960));
  ok('matchFifoLots remaining cost/share', near(lots.totalCostEUR / lots.amount, 120));
  ok('matchFifoLots firstDate is oldest remaining lot', lots.firstDate === '2024-02-01');
  // Out-of-order input must not change FIFO (sorted by date internally).
  const unordered = M.matchFifoLots([
    { type: 'sell', quantity: 5, price: 130, currency: 'EUR', date: '2024-03-01' },
    { type: 'buy',  quantity: 10, price: 120, currency: 'EUR', date: '2024-02-01' },
    { type: 'buy',  quantity: 10, price: 100, currency: 'EUR', date: '2024-01-01' },
  ], 0.9);
  ok('matchFifoLots is order-independent (date-sorted)', near(unordered.totalCostEUR / unordered.amount, 1700 / 15));
  // Same-date SELL listed BEFORE its BUY (common in broker CSVs) must still
  // consume the lot — the sell tie-breaks AFTER the buy on an equal date.
  const sameDay = M.matchFifoLots([
    { type: 'sell', quantity: 5,  price: 130, currency: 'EUR', date: '2024-03-01' },
    { type: 'buy',  quantity: 10, price: 100, currency: 'EUR', date: '2024-03-01' },
  ], 0.9);
  ok('same-date sell-before-buy consumes the lot (10 buy − 5 sell = 5)', near(sameDay.amount, 5));
  ok('same-date remaining cost basis is the buy price', near(sameDay.totalCostEUR, 500));

  console.log('buildPositions — per-date FX (fxAt resolver):');
  const fxAt = (d) => (d <= '2024-01-31' ? 0.80 : 0.90); // USD→EUR by date
  const usdTx = [
    { category: 'crypto', symbol: 'SOL', type: 'buy', quantity: 1, price: 100, currency: 'USD', date: '2024-01-15' }, // 100*0.80=80
    { category: 'crypto', symbol: 'SOL', type: 'buy', quantity: 1, price: 100, currency: 'USD', date: '2024-03-15' }, // 100*0.90=90
  ];
  const sol = M.buildPositions(usdTx, { exchangeRate: 0.99, fxAt }).crypto.find(x => x.symbol === 'SOL');
  ok('fxAt prices each USD lot on its own date', sol && near(sol.purchasePrice, (80 + 90) / 2));
  const solStatic = M.buildPositions(usdTx, { exchangeRate: 0.99 }).crypto.find(x => x.symbol === 'SOL');
  ok('without fxAt → static rate for every lot (backward compatible)', near(solStatic.purchasePrice, 99));
  // a resolver returning 0 for an unknown date must fall back to the static rate
  const sol0 = M.buildPositions(usdTx, { exchangeRate: 0.99, fxAt: () => 0 }).crypto.find(x => x.symbol === 'SOL');
  ok('fxAt → 0 falls back to static rate', near(sol0.purchasePrice, 99));

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
  // invested: AAPL FIFO remaining basis 1700 + BTC 1*900=900 = 2600
  ok('total invested = FIFO EUR cost basis', near(stats.totalInvested, 2600));
  ok('profit = value - invested', near(stats.totalProfit, 450));
  ok('position count', stats.totalPositions === 2);

  console.log('computeStats — missing price falls back to cost (no zeroing):');
  const s2 = M.computeStats(p, {}); // no prices
  ok('value falls back to cost basis when price missing', near(s2.totalValue, s2.totalInvested));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
