// ============================================================================
// MAERMIN — FIRE Extras  (window.MaerminFireExtras)
// ----------------------------------------------------------------------------
// Deepens the existing FIRE metrics (MaerminMetrics.computeFireMetrics) with the
// Coast-FIRE: the amount needed TODAY so compound growth alone (no further
// contributions) reaches the FIRE number by a target age (Overview FIRE card).
//
// Pure, dependency-free, Node-tested. metrics.js is left untouched.
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

  var api = {
    coastFire: coastFire
  };
  if (typeof window !== 'undefined') window.MaerminFireExtras = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
