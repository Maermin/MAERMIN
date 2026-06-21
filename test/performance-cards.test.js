// Node harness for the Snapshot-Powered Performance engine. Pure, no browser.
// Run: node test/performance-cards.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b) { return Math.abs(a - b) < 1e-9; }

const P = require('../performance-cards.js');

(function run() {
  console.log('performance-cards:');

  // A year of sparse value points (ascending). asOf fixed for determinism.
  const series = [
    { d: '2025-06-21', v: 8000 },   // 1Y ago
    { d: '2025-12-31', v: 9000 },   // last year-end (YTD baseline is 2026-01-01)
    { d: '2026-01-01', v: 9100 },
    { d: '2026-03-21', v: 9500 },   // 3M ago
    { d: '2026-05-21', v: 9800 },   // 1M ago
    { d: '2026-06-14', v: 9900 },   // 1W ago
    { d: '2026-06-20', v: 9950 },   // 1D ago
    { d: '2026-06-21', v: 10000 }   // today (asOf)
  ];
  const asOf = '2026-06-21';

  // ---- 1D ----
  const d1 = P.computePeriod(series, '1D', asOf);
  ok('1D measures from prior day', d1.from === '2026-06-20' && d1.endValue === 10000);
  ok('1D abs', near(d1.abs, 50));
  ok('1D pct', near(d1.pct, (50 / 9950) * 100));
  ok('1D direction up', d1.up && !d1.down);

  // ---- 1M (carry-forward: 2026-05-21 exists) ----
  const m1 = P.computePeriod(series, '1M', asOf);
  ok('1M from one month back', m1.from === '2026-05-21' && near(m1.abs, 200));

  // ---- YTD uses Jan 1 baseline (carry-forward to 2026-01-01) ----
  const ytd = P.computePeriod(series, 'YTD', asOf);
  ok('YTD baseline is Jan 1', ytd.from === '2026-01-01' && near(ytd.abs, 900));

  // ---- 1Y exact hit ----
  const y1 = P.computePeriod(series, '1Y', asOf);
  ok('1Y from a year ago', y1.from === '2025-06-21' && near(y1.abs, 2000));
  ok('1Y not partial (enough history)', y1.partial === false);

  // ---- MAX = inception ----
  const mx = P.computePeriod(series, 'MAX', asOf);
  ok('MAX from first point', mx.from === '2025-06-21' && near(mx.pct, 25));

  // ---- partial flag when history is too short ----
  const young = [{ d: '2026-06-10', v: 100 }, { d: '2026-06-21', v: 110 }];
  const yMonth = P.computePeriod(young, '1M', asOf);   // 1M start predates first point
  ok('partial flagged when look-back predates inception', yMonth.partial === true && yMonth.from === '2026-06-10');
  ok('partial still yields a number', near(yMonth.abs, 10));

  // ---- carry-forward: weekend/gap start picks last known value ----
  const gap = [{ d: '2026-05-01', v: 500 }, { d: '2026-06-21', v: 600 }];
  const gMonth = P.computePeriod(gap, '1M', asOf);     // 2026-05-21 has no point -> use 2026-05-01
  ok('carry-forward picks last value before start', gMonth.from === '2026-05-01' && !gMonth.partial);

  // ---- computeAll returns all periods in order ----
  const all = P.computeAll(series, asOf);
  ok('computeAll returns every period', all.length === P.PERIODS.length);
  ok('computeAll preserves order', all[0].id === '1D' && all[all.length - 1].id === 'MAX');

  // ---- empty series ----
  ok('empty series -> null period', P.computePeriod([], '1D', asOf) === null);
  ok('empty series -> [] all', P.computeAll([], asOf).length === 0);

  // ---- daily extremes ----
  const ex = P.dailyExtremes(series);
  ok('dailyExtremes finds best+worst', ex && ex.best && ex.worst);
  ok('best day is positive here', ex.best.pct > 0);

  // ---- cleanSeries drops junk + sorts ----
  const cleaned = P.cleanSeries([
    { d: '2026-02-02', v: 2 }, { d: 'bad', v: 1 }, { d: '2026-01-01', v: 'NaN' }, { d: '2026-01-05', v: 5 }
  ]);
  ok('cleanSeries keeps valid, sorts', cleaned.length === 2 && cleaned[0].d === '2026-01-05');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
