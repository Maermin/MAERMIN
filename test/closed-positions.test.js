// Node harness for closed positions (P4-2): MaerminLedger.closedPositions and
// the position chart data (MaerminPositionChart.prepare).
// Run: node test/closed-positions.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''))); }
const near = (a, b) => Math.abs(a - b) < 1e-9;

const L = require('../ledger.js');
const PC = require('../position-chart.js');

console.log('closedPositions:');
{
  const txs = [
    // closed in two sales, EUR, with fees on both sides
    { type: 'buy', category: 'stocks', symbol: 'AAA', symbolName: 'Alpha AG', quantity: 10, price: 100, fees: 5, currency: 'EUR', date: '2023-01-10' },
    { type: 'sell', category: 'stocks', symbol: 'AAA', quantity: 4, price: 120, fees: 2, currency: 'EUR', date: '2023-06-01' },
    { type: 'sell', category: 'stocks', symbol: 'aaa', quantity: 6, price: 90, fees: 1, currency: 'EUR', date: '2024-02-01' },
    // closed, USD at the rate of each date
    { type: 'buy', category: 'stocks', symbol: 'UUU', quantity: 2, price: 50, fees: 0, currency: 'USD', date: '2023-03-01' },
    { type: 'sell', category: 'stocks', symbol: 'UUU', quantity: 2, price: 60, fees: 0, currency: 'USD', date: '2024-05-01' },
    // still open (partly sold)
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 20000, fees: 0, currency: 'EUR', date: '2022-01-01' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 0.4, price: 30000, fees: 0, currency: 'EUR', date: '2023-01-01' },
    // options are not positions
    { type: 'buy', category: 'options', symbol: 'OPT', quantity: 1, price: 3, currency: 'EUR', date: '2023-01-01' },
    { type: 'sell', category: 'options', symbol: 'OPT', quantity: 1, price: 4, currency: 'EUR', date: '2023-02-01' },
    // never bought: no matched sale, not a closed position
    { type: 'sell', category: 'stocks', symbol: 'ZZZ', quantity: 1, price: 10, currency: 'EUR', date: '2023-02-01' }
  ];
  const fxAt = (d) => (d < '2024-01-01' ? 0.9 : 0.8);
  const rows = L.closedPositions(L.build(txs, { exchangeRate: 0.85, fxAt }));
  const a = rows.find(r => r.symbol.toUpperCase() === 'AAA'), u = rows.find(r => r.symbol === 'UUU');
  ok('only fully sold positions with a matched sale (AAA, UUU)', rows.length === 2 && !!a && !!u, rows.map(r => r.symbol).join(','));
  ok('AAA disposed cost basis = 10 × 100 + 5 buy fees = 1,005', near(a.cost, 1005), a.cost);
  ok('AAA proceeds net of sell fees = (480 − 2) + (540 − 1) = 1,017', near(a.proceeds, 1017), a.proceeds);
  ok('AAA realized P&L = 12, return = 12 / 1,005', near(a.gain, 12) && near(a.ret, 12 / 1005));
  ok('AAA held from the first buy to the last sale', a.opened === '2023-01-10' && a.closed === '2024-02-01' && near(a.qty, 10));
  ok('AAA keeps its name', a.symbolName === 'Alpha AG');
  ok('USD: cost at the buy date rate (100 × 0.9 = 90), proceeds at the sale date rate (120 × 0.8 = 96)', near(u.cost, 90) && near(u.proceeds, 96) && near(u.gain, 6), JSON.stringify(u));
  ok('newest close first', rows[0].symbol === 'UUU' && rows[1].symbol.toUpperCase() === 'AAA');
  const sameAsTax = L.build(txs, { exchangeRate: 0.85, fxAt }).groups['stocks|AAA'];
  ok('realized P&L equals the ledger group (same FIFO as the tax report)', near(a.gain, sameAsTax.realizedGain));
}
{
  const txs = [
    { type: 'buy', category: 'stocks', symbol: 'RRR', quantity: 5, price: 10, currency: 'EUR', date: '2023-01-01' },
    { type: 'sell', category: 'stocks', symbol: 'RRR', quantity: 5, price: 12, currency: 'EUR', date: '2023-02-01' },
    { type: 'buy', category: 'stocks', symbol: 'RRR', quantity: 1, price: 11, currency: 'EUR', date: '2023-03-01' }
  ];
  ok('bought again after a full sale: open again, not closed', L.closedPositions(L.build(txs, {})).length === 0);
  const over = L.closedPositions(L.build([
    { type: 'buy', category: 'stocks', symbol: 'OVR', quantity: 1, price: 10, currency: 'EUR', date: '2023-01-01' },
    { type: 'sell', category: 'stocks', symbol: 'OVR', quantity: 3, price: 10, currency: 'EUR', date: '2023-02-01' }]));
  ok('an oversold position is closed and reports the excess', over.length === 1 && near(over[0].oversold, 2) && near(over[0].qty, 1));
  ok('a sale at zero cost gives no return (null), no division by zero', L.closedPositions(L.build([
    { type: 'buy', category: 'crypto', symbol: 'AIR', quantity: 5, price: 0, currency: 'EUR', date: '2023-01-01' },
    { type: 'sell', category: 'crypto', symbol: 'AIR', quantity: 5, price: 2, currency: 'EUR', date: '2023-02-01' }]))[0].ret === null);
  ok('empty input', L.closedPositions(null).length === 0 && L.closedPositions(L.build([])).length === 0);
}

console.log('position chart data:');
{
  const closes = [];
  for (let i = 0; i < 1000; i++) closes.push([new Date(Date.UTC(2022, 0, 1) + i * 86400000).toISOString().slice(0, 10), 100 + i / 10]);
  const d = PC.prepare(closes, { from: '2023-01-01', avgCost: 50, maxPoints: 200 });
  ok('starts at the first buy date', d.pts[0].d >= '2023-01-01');
  ok('thinned to maxPoints, latest close kept', d.pts.length === 200 && d.pts[199].d === closes[999][0]);
  ok('range includes the average-cost line below the prices', d.min === 50 && d.avg === 50 && d.max === closes[999][1]);
  const c = PC.prepare(closes, { from: '2023-01-01' });
  ok('no average (closed position): range is the prices only', c.avg === null && c.min > 100);
  ok('fewer than two closes → null', PC.prepare([['2024-01-01', 5]], {}) === null && PC.prepare(null, {}) === null);
  ok('zero / missing prices are skipped', PC.prepare([['2024-01-01', 0], ['2024-01-02', 5], ['2024-01-03', 6]], {}).pts.length === 2);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
