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

  // ---- yearsToFireCompound ----
  ok('already at target → 0 years', F.yearsToFireCompound({ current: 1_000_000, monthly: 0, target: 1_000_000, annualReturn: 5 }) === 0);
  const yrs = F.yearsToFireCompound({ current: 100_000, monthly: 1000, target: 500_000, annualReturn: 7 });
  ok('compound years is a positive finite number', typeof yrs === 'number' && yrs > 0 && yrs < 100);
  // compounding reaches the target SOONER than the linear (no-growth) estimate
  const linearYears = (500_000 - 100_000) / (1000 * 12); // ≈ 33.3
  ok('compounding beats the linear estimate', yrs < linearYears);
  ok('unreachable (no growth, no savings) → null', F.yearsToFireCompound({ current: 1000, monthly: 0, target: 1e6, annualReturn: 0 }) === null);

  // ---- fireVariants ----
  const v = F.fireVariants({ annualExpenses: 40_000, withdrawalRate: 4 });
  ok('standard = expenses * 25', near(v.standard, 1_000_000));
  ok('lean < standard < fat', v.lean < v.standard && v.standard < v.fat);
  ok('fat = 1.5x standard', near(v.fat, 1_500_000));

  // ---- baristaFire ----
  const b = F.baristaFire({ annualExpenses: 40_000, partTimeIncome: 16_000, withdrawalRate: 4 });
  ok('barista funds only the uncovered expenses', near(b.portfolioFundedExpenses, 24_000));
  ok('baristaNumber = uncovered * 25', near(b.baristaNumber, 600_000));
  ok('part-time income above expenses → zero number', F.baristaFire({ annualExpenses: 10_000, partTimeIncome: 20_000, withdrawalRate: 4 }).baristaNumber === 0);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
