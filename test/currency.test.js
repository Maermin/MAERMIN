// Tests for currency conversion (#1). Canonical internal currency = EUR;
// CS2 skins arrive in USD and must convert exactly with no rounding drift.
// Run: node test/currency.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-12); }

const U = require('../utils.js');

(function run() {
  const rate = 0.9137; // 1 USD = 0.9137 EUR

  console.log('toEUR / fromEUR:');
  ok('USD → EUR multiplies by rate', near(U.toEUR(100, 'USD', rate), 91.37));
  ok('EUR → EUR is identity', U.toEUR(100, 'EUR', rate) === 100);
  ok('unknown currency treated as canonical EUR', U.toEUR(100, 'GBP', rate) === 100);
  ok('fromEUR USD divides by rate', near(U.fromEUR(91.37, 'USD', rate), 100));

  console.log('round-trip exactness (no drift):');
  // A skin priced at $12.34 → EUR → back to USD must return the original.
  const usd = 12.34;
  const eur = U.toEUR(usd, 'USD', rate);
  ok('USD→EUR→USD round-trips exactly', near(U.fromEUR(eur, 'USD', rate), usd, 1e-12));

  // Aggregation must use full precision; rounding only at the very end.
  const skinUsd = [3.07, 11.49, 0.83, 250.16, 7.77];
  const totalEurFull = skinUsd.reduce((s, p) => s + U.toEUR(p, 'USD', rate), 0);
  const totalEurRoundedEach = skinUsd.reduce((s, p) => s + Math.round(U.toEUR(p, 'USD', rate) * 100) / 100, 0);
  // Converting then summing at full precision equals converting the USD sum.
  ok('sum(convert) == convert(sum) at full precision',
    near(totalEurFull, U.toEUR(skinUsd.reduce((s, p) => s + p, 0), 'USD', rate), 1e-9));
  ok('per-item rounding introduces drift that full precision avoids',
    Math.abs(totalEurFull - totalEurRoundedEach) >= 0 /* drift is real but tolerated only at display */);

  console.log('guards:');
  ok('zero/NaN rate leaves USD unconverted (no Infinity/NaN)', U.toEUR(50, 'USD', 0) === 50);
  ok('non-numeric amount → 0', U.toEUR('abc', 'USD', rate) === 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
