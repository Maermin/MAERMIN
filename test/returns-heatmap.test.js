// Node harness for the monthly returns heatmap (P4-1).
// Run: node test/returns-heatmap.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-12);

const H = require('../returns-heatmap.js');
const VP = require('../value-path.js');
const RE = require('../returns-engine.js');

console.log('compounding by hand:');
{
  // Jan +10 %, Feb two steps of -10 % and +10 %, Apr +5 %; nothing in March.
  const g = H.fromSteps([
    { d: '2025-01-01', r: 0 }, { d: '2025-01-31', r: 0.10 },
    { d: '2025-02-10', r: -0.10 }, { d: '2025-02-28', r: 0.10 },
    { d: '2025-04-30', r: 0.05 }
  ]);
  const Y = g.years[0];
  ok('a month compounds its steps (Feb: 0.9 × 1.1 − 1 = −1 %)', near(Y.months[1], 0.9 * 1.1 - 1));
  ok('a month without a step is null (March)', Y.months[2] === null);
  ok('Q1 compounds its months (1.1 × 0.99 − 1)', near(Y.quarters[0], 1.1 * 0.99 - 1));
  ok('a quarter with one month equals that month (Q2 = Apr)', near(Y.quarters[1], 0.05));
  ok('a quarter without data is null (Q3)', Y.quarters[2] === null && Y.quarters[3] === null);
  ok('the year compounds its quarters, not adds them', near(Y.total, 1.1 * 0.99 * 1.05 - 1) && !near(Y.total, 0.10 - 0.01 + 0.05));
  ok('started on the 1st: January is not partial', !Y.partial[0]);
  ok('ended on Apr 30 (last day): April is not partial', !Y.partial[3]);
}
{
  const g = H.fromSteps([{ d: '2024-11-15', r: 0.02 }, { d: '2024-12-31', r: 0.01 }, { d: '2025-03-10', r: -0.03 }]);
  ok('years are newest first', g.years.map(y => y.year).join(',') === '2025,2024');
  ok('first month partial when the history starts after the 1st', g.years[1].partial[10] === true);
  ok('last month partial when the history ends before its last day', g.years[0].partial[2] === true);
  ok('first/last dates reported', g.first === '2024-11-15' && g.last === '2025-03-10');
  ok('no steps → null', H.fromSteps([]) === null && H.fromSteps(null) === null);
  ok('bad steps are ignored (no date, NaN, total loss)', H.fromSteps([{ d: '', r: 0.1 }, { d: '2025-01-02', r: NaN }, { d: '2025-01-03', r: -1 }]) === null);
}

console.log('product of all months = TWR of each source:');
function product(grid) {
  let g = 1;
  grid.years.forEach(Y => Y.months.forEach(m => { if (m !== null) g *= 1 + m; }));
  return g - 1;
}
function yearsProduct(grid) { return grid.years.reduce((g, Y) => g * (1 + Y.total), 1) - 1; }
{
  // 1. daily value path: two holdings, a deposit mid-way, a dividend, a fee, ~14 months
  const closes = { A: [], B: [] };
  const start = Date.UTC(2024, 0, 2);
  for (let i = 0; i < 430; i++) {
    const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
    closes.A.push([d, 100 * (1 + 0.0007 * i) * (1 + 0.03 * Math.sin(i / 9))]);
    closes.B.push([d, 50 * (1 - 0.0002 * i) * (1 + 0.05 * Math.cos(i / 13))]);
  }
  const series = { 'stocks|A': { closes: closes.A }, 'stocks|B': { closes: closes.B } };
  const txs = [
    { id: 1, type: 'buy', category: 'stocks', symbol: 'A', quantity: 10, price: closes.A[0][1], fees: 2, currency: 'EUR', date: closes.A[0][0] },
    { id: 2, type: 'buy', category: 'stocks', symbol: 'B', quantity: 40, price: closes.B[100][1] * 1.01, fees: 1, currency: 'EUR', date: closes.B[100][0] },
    { id: 3, type: 'dividend', category: 'stocks', symbol: 'A', quantity: 1, price: 12, currency: 'EUR', date: closes.A[200][0] },
    { id: 4, type: 'sell', category: 'stocks', symbol: 'A', quantity: 4, price: closes.A[300][1], fees: 1, currency: 'EUR', date: closes.A[300][0] }
  ];
  const path = VP.build(txs, series, { today: closes.A[429][0] });
  const grid = H.fromSteps(path.points.map(p => ({ d: p.d, r: p.r })));
  ok('daily path: product of months = path.twr', path.twr !== null && near(product(grid), path.twr, 1e-9), product(grid) + ' vs ' + path.twr);
  ok('daily path: product of year totals = path.twr', near(yearsProduct(grid), path.twr, 1e-9));
  ok('daily path: 2024 has all 12 months, 2025 has Jan–Mar', grid.years[1].months.every(m => m !== null) && grid.years[0].months.slice(0, 3).every(m => m !== null) && grid.years[0].months[3] === null);

  // 2. snapshot fallback
  const pts = [{ d: '2024-01-10', v: 1000 }, { d: '2024-02-05', v: 1100 }, { d: '2024-02-20', v: 1650 }, { d: '2024-04-02', v: 1600 }];
  const flows = [{ d: '2024-02-20', amount: 500 }];
  const fv = VP.fromValues(pts, flows);
  const g2 = H.fromSteps(fv.steps);
  ok('snapshots: fromValues returns one step per period', fv.steps.length === fv.periods);
  ok('snapshots: product of months = fromValues twr', near(product(g2), fv.twr, 1e-12), product(g2) + ' vs ' + fv.twr);
  ok('snapshots: a period over March counts in April (ends there), March empty', g2.years[0].months[2] === null && g2.years[0].months[3] !== null);

  // 3. refresh fallback
  const ph = { a: [{ timestamp: '2024-05-01T10:00:00Z', price: 10 }, { timestamp: '2024-05-20T10:00:00Z', price: 11 }, { timestamp: '2024-07-03T10:00:00Z', price: 10.5 }] };
  const port = { stocks: [{ symbol: 'A', amount: 5 }] };
  const tx3 = [{ type: 'buy', symbol: 'A', quantity: 5, date: '2024-04-30' }];
  const ts = RE.twrSteps(ph, port, tx3);
  ok('refresh: twr() still returns the same number', near(RE.twr(ph, port, tx3), ts.twr));
  ok('refresh: product of months = twr', near(product(H.fromSteps(ts.steps)), ts.twr, 1e-12));
  ok('refresh: no data → null, as before', RE.twrSteps({}, port, tx3) === null && RE.twr({}, port, tx3) === null);
}

console.log('colour:');
const THEMES = {
  dark: { card: '#0f1018', up: '#3ddc97', down: '#ff6b81' },
  white: { card: '#ffffff', up: '#066b45', down: '#c42b33' },
  purple: { card: '#140e24', up: '#3ddc97', down: '#ff6b81' },
  contrast: { card: '#0a0a0a', up: '#00e676', down: '#ff5252' },
  cb: { card: '#0f1118', up: '#56B4E9', down: '#E69F00' }
};
{
  let worst = 99, where = '';
  Object.keys(THEMES).forEach(name => {
    const T = THEMES[name];
    [-0.5, -0.1, -0.05, -0.02, -0.005, 0, 0.005, 0.02, 0.05, 0.1, 0.5].forEach(r => [0.1, 0.2, 0.3].forEach(maxAbs => {
      const bg = H.cellColor(r, { up: T.up, down: T.down, base: T.card, maxAbs });
      const c = H.contrast(bg, H.textOn(bg));
      if (c < worst) { worst = c; where = name + ' r=' + r + ' max=' + maxAbs + ' bg=' + bg; }
    }));
  });
  ok('cell text reaches 4.5 : 1 on every fill in all five themes', worst >= 4.5, worst.toFixed(2) + ' at ' + where);
  ok('zero is the card colour', H.cellColor(0, { up: '#00ff00', down: '#ff0000', base: '#102030' }) === '#102030');
  ok('a gain tints toward up, a loss toward down', H.cellColor(0.05, { up: '#00ff00', down: '#ff0000', base: '#000000' }).slice(3, 5) !== '00' && H.cellColor(-0.05, { up: '#00ff00', down: '#ff0000', base: '#000000' }).slice(1, 3) !== '00');
  ok('beyond maxAbs the fill is the full colour', H.cellColor(0.5, { up: '#00ff00', down: '#ff0000', base: '#000000', maxAbs: 0.1 }) === '#00ff00');
  ok('a larger return is a stronger tint', H.cellColor(0.08, { up: '#00ff00', base: '#000000' }) > H.cellColor(0.02, { up: '#00ff00', base: '#000000' }));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
