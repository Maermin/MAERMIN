// ============================================================================
// MAERMIN — FIRE Extras  (window.MaerminFireExtras)
// ----------------------------------------------------------------------------
// Deepens the existing FIRE metrics (MaerminMetrics.computeFireMetrics) with the
// numbers the FIRE community actually plans around but that aren't derivable
// from the simple linear estimate:
//   • Coast-FIRE — the amount needed TODAY so compound growth alone (no further
//     contributions) reaches the FIRE number by a target age.
//   • Compounding years-to-FIRE — accounts for growth on contributions, so it's
//     realistic (the existing linear estimate ignores returns).
//   • FIRE variants — Lean / Standard / Fat targets at one glance.
//   • Barista-FIRE — partial passive coverage with some part-time income.
//
// All pure, dependency-free, Node-tested. metrics.js is left untouched.
// ============================================================================
(function () {
  'use strict';

  function n(x) { var v = Number(x); return isFinite(v) ? v : 0; }

  // Coast-FIRE: with current savings P growing at a real annual rate r for y
  // years (no new contributions), future value FV = P*(1+r)^y. The COAST NUMBER
  // is the P that exactly reaches the FIRE target: coast = target / (1+r)^y.
  // If current net worth >= coastNumber, you can "coast" — stop contributing and
  // still hit FIRE on time.
  function coastFire(opts) {
    opts = opts || {};
    var fireNumber = n(opts.fireNumber);
    var currentNetWorth = n(opts.currentNetWorth);
    var realReturn = n(opts.realReturn);          // percent, e.g. 5 for 5%
    var years = Math.max(0, n(opts.yearsToRetirement));
    var r = realReturn / 100;
    var growth = Math.pow(1 + r, years);
    var coastNumber = growth > 0 ? fireNumber / growth : fireNumber;
    var projectedAtRetirement = currentNetWorth * growth;
    return {
      configured: fireNumber > 0 && years > 0,
      coastNumber: coastNumber,
      currentNetWorth: currentNetWorth,
      coastReached: currentNetWorth >= coastNumber && fireNumber > 0,
      coastProgress: coastNumber > 0 ? Math.max(0, (currentNetWorth / coastNumber) * 100) : 0,
      projectedAtRetirement: projectedAtRetirement,
      // surplus/shortfall vs the FIRE target if you coast from here
      projectedSurplus: projectedAtRetirement - fireNumber
    };
  }

  // Compounding years-to-FIRE: solve for the year a monthly-contributed,
  // annually-compounding balance first reaches `target`. Returns null if it
  // never gets there within `maxYears`. Far more realistic than ignoring growth.
  function yearsToFireCompound(opts) {
    opts = opts || {};
    var current = n(opts.current);
    var monthly = n(opts.monthly);
    var target = n(opts.target);
    var annualReturn = n(opts.annualReturn) / 100;
    var maxYears = opts.maxYears != null ? n(opts.maxYears) : 100;
    if (target <= 0) return null;
    if (current >= target) return 0;
    var monthlyRate = annualReturn / 12;
    var balance = current;
    for (var m = 1; m <= maxYears * 12; m++) {
      balance = balance * (1 + monthlyRate) + monthly;
      if (balance >= target) return Math.round((m / 12) * 100) / 100;
    }
    return null; // unreachable within the horizon (e.g. no contributions, no growth)
  }

  // FIRE variants from annual expenses + withdrawal rate. Lean = 0.7x, Fat = 1.5x
  // of standard expenses (the community's rough conventions; multipliers tunable).
  function fireVariants(opts) {
    opts = opts || {};
    var annualExpenses = n(opts.annualExpenses);
    var wr = n(opts.withdrawalRate) > 0 ? n(opts.withdrawalRate) : 4;
    var lean = n(opts.leanMultiple) || 0.7;
    var fat = n(opts.fatMultiple) || 1.5;
    var mult = 100 / wr;
    return {
      lean: annualExpenses * lean * mult,
      standard: annualExpenses * mult,
      fat: annualExpenses * fat * mult
    };
  }

  // Barista-FIRE: the number needed when part-time income covers part of your
  // expenses, so your portfolio only has to fund the REMAINDER via the SWR.
  function baristaFire(opts) {
    opts = opts || {};
    var annualExpenses = n(opts.annualExpenses);
    var partTimeIncome = n(opts.partTimeIncome);
    var wr = n(opts.withdrawalRate) > 0 ? n(opts.withdrawalRate) : 4;
    var covered = Math.max(0, annualExpenses - partTimeIncome);
    return {
      baristaNumber: covered * (100 / wr),
      portfolioFundedExpenses: covered
    };
  }

  var api = {
    coastFire: coastFire,
    yearsToFireCompound: yearsToFireCompound,
    fireVariants: fireVariants,
    baristaFire: baristaFire
  };
  if (typeof window !== 'undefined') window.MaerminFireExtras = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
