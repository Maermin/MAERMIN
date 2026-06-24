// ============================================================================
// MAERMIN — Returns Engine  (window.MaerminReturns)
// ----------------------------------------------------------------------------
// Pure, Node-testable money-weighted (XIRR) and time-weighted (TWR) return
// math, extracted out of features2.js so it can finally be unit-tested (that
// file opens with `const {…} = React`, so it never loaded under Node and the
// XIRR calculation had ZERO test coverage).
//
// Hardened vs the previous inline calcXIRR:
//   • requires a sign change (≥1 inflow AND ≥1 outflow) — otherwise no root
//     exists and the old code returned a bogus clamped −99.99% instead of null.
//   • verifies CONVERGENCE — the old loop returned whatever `rate` happened to
//     be after 100 iterations even if Newton never reached a root.
//   • bisection fallback when Newton diverges, so a real root is still found.
// ============================================================================
(function () {
  'use strict';

  var MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

  // cashflows: [{ date:'YYYY-MM-DD'|Date, amount:number }]
  //   amount < 0 = outflow (investment), amount > 0 = inflow (return/value).
  // → annualized rate (e.g. 0.1 = 10% p.a.) or null when undefined/ no root.
  function xirr(cashflows) {
    if (!Array.isArray(cashflows) || cashflows.length < 2) return null;

    var times = [], amounts = [], hasPos = false, hasNeg = false;
    for (var i = 0; i < cashflows.length; i++) {
      var c = cashflows[i] || {};
      var amt = Number(c.amount);
      var t = (c.date instanceof Date) ? c.date.getTime() : new Date(c.date).getTime();
      if (!isFinite(amt) || isNaN(t)) return null;     // bad input → no answer
      amounts.push(amt);
      times.push(t);
      if (amt > 0) hasPos = true;
      if (amt < 0) hasNeg = true;
    }
    // A money-weighted return is only defined when money goes both out AND in.
    if (!hasPos || !hasNeg) return null;

    // Anchor to the earliest date (root is invariant to the anchor, but this
    // keeps the exponents well-behaved even for unsorted cashflows).
    var t0 = Math.min.apply(null, times);
    var years = times.map(function (t) { return (t - t0) / MS_PER_YEAR; });

    function npv(rate) {
      var s = 0;
      for (var j = 0; j < amounts.length; j++) s += amounts[j] / Math.pow(1 + rate, years[j]);
      return s;
    }
    function dnpv(rate) {
      var s = 0;
      for (var j = 0; j < amounts.length; j++) s += -years[j] * amounts[j] / Math.pow(1 + rate, years[j] + 1);
      return s;
    }

    var TOL = 1e-7;
    // --- Newton-Raphson ---
    var rate = 0.1, converged = false;
    for (var k = 0; k < 100; k++) {
      var f = npv(rate);
      if (Math.abs(f) < TOL) { converged = true; break; }
      var df = dnpv(rate);
      if (!isFinite(df) || Math.abs(df) < 1e-12) break;   // flat → bail to bisection
      var step = f / df;
      rate -= step;
      if (rate <= -1) rate = -0.9999;                     // (1+rate) must stay > 0
      if (Math.abs(step) < 1e-10) { converged = Math.abs(npv(rate)) < 1e-6; break; }
    }
    if (converged && isFinite(rate)) return rate;

    // --- bisection fallback: scan for a sign change, then halve ---
    var lo = -0.9999, hi = 100;
    var fLo = npv(lo);
    // expand search until the bracket straddles a root (or give up)
    var found = false, prev = lo, prevF = fLo, step2 = 0.5, x = lo + step2;
    while (x <= hi) {
      var fx = npv(x);
      if (isFinite(fx) && (prevF === 0 || (prevF < 0) !== (fx < 0))) { lo = prev; hi = x; found = true; break; }
      prev = x; prevF = fx; x += step2;
    }
    if (!found) return null;
    var a = lo, b = hi;
    for (var m = 0; m < 200; m++) {
      var mid = (a + b) / 2;
      var fm = npv(mid);
      if (Math.abs(fm) < 1e-7) return mid;
      if ((npv(a) < 0) !== (fm < 0)) b = mid; else a = mid;
    }
    var root = (a + b) / 2;
    return (isFinite(root) && Math.abs(npv(root)) < 1e-4) ? root : null;
  }

  // Time-weighted return from a per-symbol price-history map. Returns the total
  // (not annualized) fractional return over the available window, or null.
  function twr(priceHistory, portfolio) {
    priceHistory = priceHistory || {};
    portfolio = portfolio || {};
    var symbols = [];
    ['crypto', 'stocks', 'skins', 'commodities'].forEach(function (cat) {
      (portfolio[cat] || []).forEach(function (pos) {
        symbols.push({ sym: (pos.symbol || pos.name || '').toLowerCase(), amount: Number(pos.amount) || 1 });
      });
    });
    if (!symbols.length) return null;

    var tsMap = {};
    symbols.forEach(function (s) {
      (priceHistory[s.sym] || []).forEach(function (pt) {
        if (!tsMap[pt.timestamp]) tsMap[pt.timestamp] = {};
        tsMap[pt.timestamp][s.sym] = pt.price;
      });
    });
    var ts = Object.keys(tsMap).sort();
    if (ts.length < 2) return null;
    var vals = ts.map(function (t) {
      return symbols.reduce(function (sum, s) { return sum + s.amount * (tsMap[t][s.sym] || 0); }, 0);
    }).filter(function (v) { return v > 0; });
    if (vals.length < 2) return null;
    return (vals[vals.length - 1] / vals[0]) - 1;
  }

  var api = { xirr: xirr, twr: twr };
  if (typeof window !== 'undefined') window.MaerminReturns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
