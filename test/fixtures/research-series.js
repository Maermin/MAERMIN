// A fixed, made-up close series (seeded random walk with a few gaps) for the
// CH-2 regression test: Research's indicator output on it was saved BEFORE the
// maths moved to chart-engine.js (research-indicators.golden.json) and must
// stay identical afterwards.
'use strict';
module.exports = function series() {
  let seed = 20261023, p = 100;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const out = [];
  for (let i = 0; i < 320; i++) {
    p = p * (1 + (rnd() - 0.48) * 0.04);
    out.push(i % 37 === 11 || i === 200 ? null : Math.round(p * 100) / 100);
  }
  return out;
};
