// Node harness for the FIRE-extras engine. Pure math, no browser.
// Run: node test/fire-extras.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

const F = require('../fire-extras.js');

(function run() {
  console.log('fire-extras:');

  // ---- coastFire ----
  // target 1,000,000; 5% real for 20 years → growth 1.05^20 ≈ 2.6533
  const growth = Math.pow(1.05, 20);
  const c = F.coastFire({ fireNumber: 1_000_000, currentNetWorth: 400_000, realReturn: 5, yearsToRetirement: 20 });
  ok('coastNumber = target / (1+r)^y', near(c.coastNumber, 1_000_000 / growth, 1e-3));
  ok('coastReached when current >= coastNumber', c.coastReached === (400_000 >= 1_000_000 / growth));
  ok('projectedAtRetirement = current * growth', near(c.projectedAtRetirement, 400_000 * growth, 1e-3));
  const cHit = F.coastFire({ fireNumber: 1_000_000, currentNetWorth: 500_000, realReturn: 5, yearsToRetirement: 20 });
  ok('coast reached with a big enough balance', cHit.coastReached === true && cHit.projectedSurplus > 0);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
