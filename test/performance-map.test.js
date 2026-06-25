// Node harness for the Performance Map treemap (WI-4). Pure, no browser.
// Run: node test/performance-map.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

const PM = require('../performance-map.js');

function overlaps(a, b) {
  return a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 &&
         a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
}

(function run() {
  console.log('performance-map:');

  const W = 600, H = 400;
  const nodes = [
    { key: 'a', value: 500, perf: 12 },
    { key: 'b', value: 300, perf: -8 },
    { key: 'c', value: 150, perf: 2 },
    { key: 'd', value: 50, perf: 0 },
    { key: 'z', value: 0, perf: 5 }   // dropped (non-positive)
  ];
  const rects = PM.layout(nodes, W, H, {});

  ok('non-positive values dropped', rects.length === 4);

  // areas proportional + sum to container
  const totalArea = rects.reduce((s, r) => s + r.w * r.h, 0);
  ok('areas sum to container area', near(totalArea, W * H, 1e-3));
  const totalValue = 1000;
  const aRect = rects.find(r => r.key === 'a');
  ok('area is proportional to value', near(aRect.w * aRect.h, (500 / totalValue) * W * H, 1e-3));
  ok('weight is share of total', near(aRect.weight, 0.5, 1e-9));

  // no overlaps between any pair
  let anyOverlap = false;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      if (overlaps(rects[i], rects[j])) anyOverlap = true;
  ok('no rectangles overlap', !anyOverlap);

  // all rects within the container bounds
  const inBounds = rects.every(r => r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6);
  ok('all rects within container bounds', inBounds);

  // sorted by value desc (largest first)
  ok('largest value placed first', rects[0].key === 'a');

  // ---- colour scale at band edges ----
  const opts = { down: '#ff0000', up: '#00ff00', neutral: '#808080', maxAbs: 10 };
  ok('max positive perf -> up colour', PM.colorFor(10, opts) === '#00ff00');
  ok('max negative perf -> down colour', PM.colorFor(-10, opts) === '#ff0000');
  ok('over-max clamps to up colour', PM.colorFor(50, opts) === '#00ff00');
  ok('zero perf -> neutral colour', PM.colorFor(0, opts) === '#808080');
  // halfway up is between neutral and up
  const half = PM.colorFor(5, opts);
  ok('halfway perf is between neutral and up', half !== '#808080' && half !== '#00ff00');
  const rNeg = rects.find(r => r.key === 'b');
  ok('losing position gets a reddish colour', rNeg.color !== '#00ff00');

  // ---- empty portfolio degrades cleanly ----
  ok('empty nodes -> empty layout', PM.layout([], W, H, {}).length === 0);
  ok('zero size -> empty layout', PM.layout(nodes, 0, 0, {}).length === 0);
  ok('all-zero values -> empty layout', PM.layout([{ key: 'x', value: 0 }], W, H, {}).length === 0);

  // single node fills the whole container
  const single = PM.layout([{ key: 'solo', value: 100, perf: 3 }], W, H, {});
  ok('single node fills container', single.length === 1 && near(single[0].w * single[0].h, W * H, 1e-3));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
