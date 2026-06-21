// Node harness for the Portfolio Value Snapshots engine. Pure math, no browser.
// Run: node test/portfolio-snapshots.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const S = require('../portfolio-snapshots.js');

(function run() {
  console.log('portfolio-snapshots:');

  // ---- normalize drops junk, keeps good points, sorts ----
  const messy = S.normalize({ points: [
    { d: '2026-03-02', v: 200, pid: 'all' },
    { d: 'bad-date', v: 5 },
    { d: '2026-03-01', v: 100 },           // pid defaults to 'all'
    { d: '2026-03-03', v: 'NaN' },         // non-finite -> dropped
    { d: '2026-03-03', v: 300, pid: 'p1' }
  ]});
  ok('normalize keeps only valid points', messy.points.length === 3);
  ok('normalize sorts by date', messy.points[0].d === '2026-03-01' && messy.points[1].d === '2026-03-02');
  ok('normalize defaults pid to all', messy.points[0].pid === 'all');

  // ---- addPoint: one point per day, overwrite same day ----
  let st = { version: 1, points: [] };
  st = S.addPoint(st, { value: 1000, date: '2026-06-01' });
  st = S.addPoint(st, { value: 1100, date: '2026-06-02' });
  st = S.addPoint(st, { value: 1150, date: '2026-06-02' }); // same day overwrites
  ok('addPoint dedups same day', S.seriesFor(st, 'all').length === 2);
  ok('addPoint same-day keeps latest value', S.latest(st, 'all').v === 1150);

  // ---- bad values are ignored (no poisoning) ----
  const before = S.seriesFor(st, 'all').length;
  st = S.addPoint(st, { value: -5, date: '2026-06-03' });
  st = S.addPoint(st, { value: 'abc', date: '2026-06-03' });
  ok('addPoint ignores negative / non-numeric', S.seriesFor(st, 'all').length === before);

  // ---- per-portfolio isolation ----
  st = S.addPoint(st, { value: 500, date: '2026-06-01', portfolioId: 'p1' });
  ok('seriesFor isolates portfolios', S.seriesFor(st, 'p1').length === 1 && S.seriesFor(st, 'all').length === 2);

  // ---- valueAsOf = last known value (carry forward) ----
  ok('valueAsOf carries last known value', S.valueAsOf(st, '2026-06-05', 'all').v === 1150);
  ok('valueAsOf before first point is null', S.valueAsOf(st, '2026-05-01', 'all') === null);

  // ---- changeBetween abs + pct ----
  const ch = S.changeBetween(st, '2026-06-01', '2026-06-02', 'all');
  ok('changeBetween abs', ch && ch.abs === 150);
  ok('changeBetween pct', ch && Math.abs(ch.pct - 15) < 1e-9);

  // ---- prune caps per portfolio ----
  let big = { version: 1, points: [] };
  for (let i = 0; i < 10; i++) {
    big = S.addPoint(big, { value: i, date: '2026-01-' + ('0' + (i + 1)).slice(-2) }, { cap: 5 });
  }
  ok('prune caps series length', S.seriesFor(big, 'all').length === 5);
  ok('prune keeps the most recent', S.latest(big, 'all').v === 9);

  // ---- immutability: addPoint returns new state ----
  const orig = { version: 1, points: [{ d: '2026-06-01', v: 1, pid: 'all' }] };
  const next = S.addPoint(orig, { value: 2, date: '2026-06-02' });
  ok('addPoint does not mutate input', orig.points.length === 1 && next.points.length === 2);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
