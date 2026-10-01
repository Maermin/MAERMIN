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

  // Price-point timestamp -> epoch ms (ISO-8601 or epoch only; the legacy
  // year-less "09/30, 08:14 PM" format is undatable and ignored).
  function tsOf(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v == null ? '' : v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s).getTime() : NaN;
  }

  // Time-weighted return (total, not annualised) from a per-symbol price
  // history. Sub-period returns are chain-linked:
  //   r_t = sum(q_{t-1} * p_t) / sum(q_{t-1} * p_{t-1}) - 1
  // so a buy/sell at t changes the holdings for the NEXT period only and never
  // counts as performance. Holdings come from `transactions` (buys - sells up
  // to each timestamp) when supplied, else the current quantities (then this is
  // the buy-and-hold return of today's book). Prices are forward-filled per
  // symbol and the series only starts once every held symbol has a price, so
  // assets that trade at different times (crypto 24/7 vs exchange hours) are
  // never valued at 0. Timestamps are sorted chronologically, not as strings.
  function twr(priceHistory, portfolio, transactions) {
    priceHistory = priceHistory || {};
    portfolio = portfolio || {};
    var syms = {};
    Object.keys(portfolio).forEach(function (cat) {
      if (!Array.isArray(portfolio[cat])) return;
      portfolio[cat].forEach(function (pos) {
        var k = String(pos.symbol || pos.name || '').toLowerCase();
        if (k) syms[k] = Number(pos.amount) || 0;
      });
    });
    var keys = Object.keys(syms);
    if (!keys.length) return null;

    // Holdings resolver.
    var txs = Array.isArray(transactions) ? transactions.filter(function (tx) {
      return tx && (tx.type === 'buy' || tx.type === 'sell') && syms.hasOwnProperty(String(tx.symbol || '').toLowerCase());
    }).map(function (tx) {
      return { k: String(tx.symbol).toLowerCase(), t: tsOf(String(tx.date).length === 10 ? tx.date + 'T23:59:59Z' : tx.date),
        q: (tx.type === 'buy' ? 1 : -1) * (Number(tx.quantity) || 0) };
    }).filter(function (x) { return isFinite(x.t); }).sort(function (a, b) { return a.t - b.t; }) : null;
    // Holdings are accumulated with a forward pointer (events and trades are
    // both in time order), so each trade is applied once instead of re-summing
    // every trade for every price point (that was O(points x trades)).
    var cum = {}, ptr = 0;
    function holdingsAt(t) {
      if (!txs) return syms;
      while (ptr < txs.length && txs[ptr].t <= t) { cum[txs[ptr].k] = (cum[txs[ptr].k] || 0) + txs[ptr].q; ptr++; }
      var h = {};
      Object.keys(cum).forEach(function (k) { h[k] = cum[k]; });
      return h;
    }

    var events = [];
    keys.forEach(function (k) {
      (priceHistory[k] || []).forEach(function (pt) {
        var t = tsOf(pt && pt.timestamp), p = Number(pt && pt.price);
        if (isFinite(t) && p > 0) events.push({ t: t, k: k, p: p });
      });
    });
    events.sort(function (a, b) { return a.t - b.t; });
    if (events.length < 2) return null;

    var last = {}, prevPrices = null, prevHeld = null, growth = 1, periods = 0;
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      last[ev.k] = ev.p;
      if (i + 1 < events.length && events[i + 1].t === ev.t) continue; // group equal timestamps
      var held = holdingsAt(ev.t);
      var complete = Object.keys(held).every(function (k) { return !(held[k] > 1e-12) || last[k] > 0; });
      if (!complete) continue;
      var snapshot = {}; Object.keys(last).forEach(function (k) { snapshot[k] = last[k]; });
      if (prevPrices) {
        var h = prevHeld;
        var v0 = 0, v1 = 0;
        Object.keys(h).forEach(function (k) {
          if (!(h[k] > 1e-12) || !(prevPrices[k] > 0)) return;
          v0 += h[k] * prevPrices[k];
          v1 += h[k] * snapshot[k];
        });
        if (v0 > 0) { growth *= v1 / v0; periods++; }
      }
      prevPrices = snapshot; prevHeld = held;
    }
    return periods > 0 ? growth - 1 : null;
  }

  // Money-weighted cash flows for XIRR, in EUR. Every leg converts at the FX
  // rate of its own date (`fxAt(dateISO)`, falling back to `rate`) - the view
  // used to mix raw USD amounts with a EUR terminal value. Only buys, sells and
  // cash income (dividend/interest) are flows; option legs (premium x contract
  // size, kept off the portfolio value) and unknown types are ignored.
  //   opts = { rate, fxAt, currentValueEUR, today, categories? }
  function buildCashflows(transactions, opts) {
    opts = opts || {};
    var rate = Number(opts.rate) || 0;
    var fxAt = typeof opts.fxAt === 'function' ? opts.fxAt : null;
    var cats = opts.categories || null; // optional allow-list of categories
    function eur(amount, tx) {
      if (tx.currency !== 'USD') return amount;
      var r = (fxAt && fxAt(tx.date)) || rate;
      return r > 0 ? amount * r : amount;
    }
    var flows = [];
    (transactions || []).forEach(function (tx) {
      if (!tx || !tx.date) return;
      if (tx.category === 'options') return;
      if (cats && cats.indexOf(tx.category || 'crypto') === -1) return;
      var gross = (Number(tx.quantity) || 0) * (Number(tx.price) || 0);
      var fees = Number(tx.fees) || 0;
      var amt;
      if (tx.type === 'buy') amt = -(gross + fees);
      else if (tx.type === 'sell') amt = gross - fees;
      else if (tx.type === 'dividend' || tx.type === 'interest') amt = (gross || Number(tx.amount) || 0) - (Number(tx.withholdingTax) || 0);
      else return;
      if (amt) flows.push({ date: tx.date, amount: eur(amt, tx) });
    });
    if (opts.currentValueEUR > 0) flows.push({ date: opts.today || new Date().toISOString().slice(0, 10), amount: opts.currentValueEUR });
    return flows;
  }

  var api = { xirr: xirr, twr: twr, buildCashflows: buildCashflows };
  if (typeof window !== 'undefined') window.MaerminReturns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
