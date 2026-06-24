// Node harness for the returns engine (XIRR + TWR). Pure math, no browser.
// Includes the REGRESSION cases that the old inline calcXIRR got wrong.
// Run: node test/returns-engine.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return a != null && Math.abs(a - b) <= (eps || 1e-4); }

const R = require('../returns-engine.js');

(function run() {
  console.log('xirr — known values:');
  // -1000 today, +1100 in one year → 10% p.a.
  ok('simple 10% p.a.', near(R.xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2025-01-01', amount: 1100 }]), 0.10, 1e-3));
  // double in exactly one year → 100%
  // 2024 is a leap year → 366d / 365.25 = 1.002y, so the exact root is ~0.9972, not 1.0.
  ok('doubling in ~1y → ~100%', near(R.xirr([{ date: '2024-01-01', amount: -100 }, { date: '2025-01-01', amount: 200 }]), 1.0, 5e-3));
  // multi-flow: two investments, one final value
  const r = R.xirr([
    { date: '2023-01-01', amount: -1000 },
    { date: '2023-07-01', amount: -500 },
    { date: '2024-01-01', amount: 1650 }
  ]);
  ok('multi-cashflow returns a sane positive rate', r != null && r > 0 && r < 1);
  // a loss → negative rate
  ok('loss → negative rate', R.xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2025-01-01', amount: 900 }]) < 0);

  console.log('xirr — regression (old calcXIRR bugs):');
  // BUG-1: all-outflow (no inflow) has no root → must be null, not −0.9999
  ok('all-negative cashflows → null (was −0.9999)', R.xirr([{ date: '2024-01-01', amount: -100 }, { date: '2025-01-01', amount: -100 }]) === null);
  // all-inflow likewise undefined
  ok('all-positive cashflows → null', R.xirr([{ date: '2024-01-01', amount: 100 }, { date: '2025-01-01', amount: 100 }]) === null);
  // degenerate guards
  ok('fewer than 2 cashflows → null', R.xirr([{ date: '2024-01-01', amount: -100 }]) === null);
  ok('non-array → null', R.xirr(null) === null);
  ok('bad date → null', R.xirr([{ date: 'nope', amount: -100 }, { date: '2025-01-01', amount: 110 }]) === null);
  ok('NaN amount → null', R.xirr([{ date: '2024-01-01', amount: NaN }, { date: '2025-01-01', amount: 110 }]) === null);

  // order-independence: shuffled cashflows give the same root
  const ordered = R.xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2025-01-01', amount: 1100 }]);
  const shuffled = R.xirr([{ date: '2025-01-01', amount: 1100 }, { date: '2024-01-01', amount: -1000 }]);
  ok('order-independent', near(ordered, shuffled, 1e-9));

  console.log('twr:');
  const ph = { aapl: [{ timestamp: 1, price: 100 }, { timestamp: 2, price: 110 }] };
  const pf = { stocks: [{ symbol: 'AAPL', amount: 10 }] };
  ok('TWR = last/first − 1', near(R.twr(ph, pf), 0.10, 1e-9));
  ok('TWR with <2 points → null', R.twr({ aapl: [{ timestamp: 1, price: 100 }] }, pf) === null);
  ok('TWR with no positions → null', R.twr(ph, {}) === null);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
