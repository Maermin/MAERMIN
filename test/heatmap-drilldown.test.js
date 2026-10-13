// Node harness for the heatmap drill-down and filters (P5-2.4).
// Run: node test/heatmap-drilldown.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, eps) => a != null && Math.abs(a - b) < (eps || 1e-9);

const D = require('../heatmap-drilldown.js');
const H = require('../returns-heatmap.js');
const VP = require('../value-path.js');
const tx = (type, symbol, date, quantity, price, extra) => Object.assign({ type, category: 'stocks', symbol, date, quantity, price, currency: 'EUR' }, extra || {});

console.log('periods:');
{
  const m = D.periodOf('m', 2025, 1);
  ok('February 2025 = 1st to 28th', m.from === '2025-02-01' && m.to === '2025-02-28', m);
  ok('February 2024 ends on the 29th (leap year)', D.periodOf('m', 2024, 1).to === '2024-02-29');
  const q = D.periodOf('q', 2025, 2);
  ok('Q3 = 1 July to 30 September', q.from === '2025-07-01' && q.to === '2025-09-30', q);
  const y = D.periodOf('y', 2025);
  ok('a year = 1 January to 31 December', y.from === '2025-01-01' && y.to === '2025-12-31', y);
  ok('an unknown kind gives null', D.periodOf('w', 2025, 0) === null);
}

console.log('detail of a period:');
{
  // Daily points: end of Jan 1,000; Feb: deposit 500 on the 10th, ends at 1,650.
  const points = [
    { d: '2025-01-02', v: 1000, flow: 1000, r: 0 },
    { d: '2025-01-31', v: 1000, flow: 0, r: 0 },
    { d: '2025-02-10', v: 1540, flow: 500, r: 0.04 },
    { d: '2025-02-28', v: 1650, flow: 0, r: 110 / 1540 },
    { d: '2025-03-03', v: 1600, flow: 0, r: -50 / 1650 }
  ];
  const txs = [
    tx('buy', 'AAA', '2025-01-02', 10, 100), tx('buy', 'AAA', '2025-02-10', 5, 100),
    tx('dividend', 'AAA', '2025-02-20', 0, 0, { total: 12 }), tx('sell', 'AAA', '2025-03-03', 1, 160),
    tx('fee', 'AAA', '2025-02-21', 0, 0)
  ];
  const det = D.detail(points, txs, D.periodOf('m', 2025, 1));
  ok('start value = last value before the month (31 Jan: 1,000)', near(det.startValue, 1000), det);
  ok('end value = last value in the month (28 Feb: 1,650)', near(det.endValue, 1650));
  ok('money in/out = the flows inside the month (500)', near(det.netFlow, 500));
  ok('gain = end − start − money in (150)', near(det.gain, 150));
  ok('return compounds the month\'s steps (1.04 × 1650/1540 − 1)', near(det.ret, 1.04 * (1650 / 1540) - 1), det.ret);
  // The return equals the heatmap cell exactly.
  const grid = H.fromSteps(points.map((p) => ({ d: p.d, r: p.r })));
  const feb = grid.years[0].months[1];
  ok('the detail\'s return equals the heatmap cell', near(det.ret, feb), [det.ret, feb]);
  ok('activities: 3 in February (1 buy, 1 payout, 1 other)', det.activities === 3 && det.byType.buy === 1 && det.byType.income === 1 && det.byType.other === 1 && det.byType.sell === 0, det.byType);
  ok('first / last day with a value in the period', det.first === '2025-02-10' && det.last === '2025-02-28');
  ok('a full period is not partial', det.startsInside === false);

  const jan = D.detail(points, txs, D.periodOf('m', 2025, 0));
  ok('the first month starts at 0: nothing was held before', near(jan.startValue, 0) && jan.startsInside === true, jan);
  ok('… and the first buy is money in (1,000), gain 0', near(jan.netFlow, 1000) && near(jan.gain, 0));

  const q1 = D.detail(points, txs, D.periodOf('q', 2025, 0));
  ok('Q1 return = the compounded quarter cell', near(q1.ret, grid.years[0].quarters[0]), [q1.ret, grid.years[0].quarters[0]]);
  ok('Q1 activities: all 5', q1.activities === 5 && q1.byType.sell === 1);

  const empty = D.detail(points, txs, D.periodOf('m', 2025, 5));
  ok('a month without values: values and return null, 0 activities', empty.endValue === null && empty.ret === null && empty.activities === 0, empty);

  const noValues = D.detail([{ d: '2025-02-10', r: 0.05 }], txs, D.periodOf('m', 2025, 1));
  ok('steps without values (refresh fallback): return only', near(noValues.ret, 0.05) && noValues.startValue === null && noValues.endValue === null, noValues);
  ok('a transaction dated with a time counts in its day', D.detail([], [tx('buy', 'AAA', '2025-02-28T23:10:00', 1, 1)], D.periodOf('m', 2025, 1)).activities === 1);
}

console.log('filters:');
{
  const txs = [
    tx('buy', 'AAPL', '2025-01-02', 1, 100), tx('buy', 'aapl', '2025-02-02', 1, 100),
    tx('buy', 'BTC', '2025-01-03', 1, 100, { category: 'crypto' }),
    tx('buy', 'VWCE', '2025-01-04', 1, 100),
    tx('buy', 'GOLD', '2025-01-05', 1, 100, { category: 'cat_mine' })
  ];
  const tags = { version: 1, tags: { Core: { color: '#000', symbols: ['VWCE', 'BTC'] } } };
  ok('no filter keeps everything', D.filterTransactions(txs, null, tags).length === 5);
  ok('"all" keeps everything', D.filterTransactions(txs, { kind: 'all' }, tags).length === 5);
  const cl = D.filterTransactions(txs, { kind: 'class', value: 'stocks' }, tags);
  ok('asset class stocks: AAPL ×2 and VWCE', cl.length === 3 && cl.every((t) => t.category === 'stocks'));
  ok('a custom category filters like a class', D.filterTransactions(txs, { kind: 'class', value: 'cat_mine' }, tags).length === 1);
  const tg = D.filterTransactions(txs, { kind: 'tag', value: 'core' }, tags);
  ok('tag (case-insensitive name): VWCE and BTC', tg.length === 2 && tg.map((t) => t.symbol).sort().join() === 'BTC,VWCE', tg);
  const hd = D.filterTransactions(txs, { kind: 'holding', value: 'stocks|AAPL' }, tags);
  ok('holding stocks|AAPL matches both spellings of the symbol', hd.length === 2, hd);
  ok('holding in another class does not match', D.filterTransactions(txs, { kind: 'holding', value: 'crypto|AAPL' }, tags).length === 0);
  ok('an unknown tag keeps nothing', D.filterTransactions(txs, { kind: 'tag', value: 'nope' }, tags).length === 0);

  const o = D.options(txs, tags);
  ok('options: classes in first-seen order', o.classes.join() === 'stocks,crypto,cat_mine', o.classes);
  ok('options: tags with at least one held symbol', o.tags.length === 1 && o.tags[0] === 'Core', o.tags);
  ok('options: one holding per class and symbol, sorted', o.holdings.map((h) => h.key).join() === 'stocks|AAPL,crypto|BTC,cat_mine|GOLD,stocks|VWCE', o.holdings);
  ok('options: a tag without a held symbol is left out', D.options(txs, { version: 1, tags: { Empty: { color: '#000', symbols: ['XYZ'] } } }).tags.length === 0);
  ok('options without tags state', D.options(txs, null).tags.length === 0);
  ok('filter label key', D.filterKey({ kind: 'tag', value: 'Core' }) === 'tag:Core' && D.filterKey(null) === 'all');
}

console.log('filtered path end to end:');
{
  // Two holdings: AAA +10 % in Feb, BBB −10 %. Filter to AAA: its Feb return is +10 %.
  const txs = [tx('buy', 'AAA', '2025-01-31', 10, 100), tx('buy', 'BBB', '2025-01-31', 10, 100)];
  const series = {
    'stocks|AAA': { closes: [['2025-01-31', 100], ['2025-02-28', 110]], splits: [] },
    'stocks|BBB': { closes: [['2025-01-31', 100], ['2025-02-28', 90]], splits: [] }
  };
  const all = VP.build(txs, series, { today: '2025-02-28' });
  const one = VP.build(D.filterTransactions(txs, { kind: 'holding', value: 'stocks|AAA' }), series, { today: '2025-02-28' });
  const feb = D.periodOf('m', 2025, 1);
  ok('whole book: February 0 %', near(D.detail(all.points, txs, feb).ret, 0), D.detail(all.points, txs, feb));
  const d1 = D.detail(one.points, D.filterTransactions(txs, { kind: 'holding', value: 'stocks|AAA' }), feb);
  ok('AAA only: February +10 %, 1,000 → 1,100', near(d1.ret, 0.10) && near(d1.startValue, 1000) && near(d1.endValue, 1100), d1);
  ok('AAA only: no activity in February', d1.activities === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
