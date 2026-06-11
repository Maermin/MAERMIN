// ============================================================================
// MAERMIN — Analytics data bridge  (window.MaerminAnalyticsData)
// ----------------------------------------------------------------------------
// Pure glue between the existing data layer (built positions + per-symbol
// priceHistory) and the MaerminAnalytics engine. It builds a portfolio value
// path and aligns two series into period returns — the inputs benchmarkStats /
// maxDrawdown / rollingVolatility expect. No quant lives here (that stays in
// portfolio-analytics.js) and no fetching (the views own that); this is the
// shared, unit-tested adapter so risk + benchmark fold-ins don't each reinvent it.
// ============================================================================
(function () {
  'use strict';

  var CLASSES = ['crypto', 'stocks', 'skins', 'commodities'];

  // priceHistory entries are either numbers or { price, ... } (both shapes exist
  // in the app); normalise to a clean number[] dropping non-finite points.
  function pricesOf(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i];
      var p = (x && typeof x === 'object') ? x.price : x;
      if (typeof p === 'number' && isFinite(p)) out.push(p);
    }
    return out;
  }

  // Current held quantity per symbol (built positions weight by `amount`).
  function heldQuantities(portfolio) {
    var q = {};
    CLASSES.forEach(function (cls) {
      ((portfolio && portfolio[cls]) || []).forEach(function (p) {
        var s = p && p.symbol;
        if (!s) return;
        q[s] = (q[s] || 0) + (parseFloat(p.amount) || 0);
      });
    });
    return q;
  }

  function toReturns(series) {
    var r = [];
    for (var i = 1; i < series.length; i++) {
      var prev = series[i - 1];
      if (prev) r.push(series[i] / prev - 1);
    }
    return r;
  }

  // Portfolio value path = Σ symbol qty × price, over per-symbol price history.
  // Arrays are treated as index-aligned trailing windows (the same convention the
  // Risk/Returns views already use), trimmed to the shortest so points line up.
  function buildValueSeries(portfolio, priceHistory) {
    var qty = heldQuantities(portfolio);
    var seriesBySym = {}, used = [], minLen = Infinity;
    Object.keys(qty).forEach(function (s) {
      if (qty[s] <= 0 || !priceHistory || !priceHistory[s]) return;
      var ps = pricesOf(priceHistory[s]);
      if (ps.length >= 2) { seriesBySym[s] = ps; used.push(s); minLen = Math.min(minLen, ps.length); }
    });
    if (!used.length || !isFinite(minLen) || minLen < 2) return [];
    var series = [];
    for (var i = 0; i < minLen; i++) {
      var v = 0;
      for (var k = 0; k < used.length; k++) {
        var arr = seriesBySym[used[k]];
        v += qty[used[k]] * arr[arr.length - minLen + i];
      }
      series.push(v);
    }
    return series;
  }

  // Align two value series to a common trailing length and return their period
  // returns — the same-length arrays benchmarkStats() expects.
  function alignedReturns(seriesA, seriesB) {
    var a = seriesA || [], b = seriesB || [];
    var n = Math.min(a.length, b.length);
    if (n < 2) return { a: [], b: [] };
    return { a: toReturns(a.slice(a.length - n)), b: toReturns(b.slice(b.length - n)) };
  }

  // Generalises alignedReturns to N series: trims every price series to the
  // shortest trailing length, then converts each to period returns so all come
  // out index-aligned and equal length — the shape factorExposure() needs to
  // regress a portfolio against several factor-proxy series. Returns [] unless
  // every input is a usable (length >= 2) series, so one missing proxy cleanly
  // degrades to "not enough data" instead of a silently misaligned regression.
  function alignReturns(seriesList) {
    var list = seriesList || [];
    if (!list.length) return [];
    var n = Infinity;
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!Array.isArray(s) || s.length < 2) return [];
      if (s.length < n) n = s.length;
    }
    if (!isFinite(n) || n < 2) return [];
    return list.map(function (s) { return toReturns(s.slice(s.length - n)); });
  }

  // Element-wise difference over the common length — builds long/short factor
  // returns (SMB = small − big, HML = value − growth) from two aligned return
  // series. Inputs are expected pre-aligned (see alignReturns).
  function subtract(a, b) {
    var x = a || [], y = b || [];
    var n = Math.min(x.length, y.length);
    var out = [];
    for (var i = 0; i < n; i++) out.push(x[i] - y[i]);
    return out;
  }

  var api = {
    CLASSES: CLASSES,
    pricesOf: pricesOf,
    heldQuantities: heldQuantities,
    toReturns: toReturns,
    buildValueSeries: buildValueSeries,
    alignedReturns: alignedReturns,
    alignReturns: alignReturns,
    subtract: subtract
  };
  if (typeof window !== 'undefined') window.MaerminAnalyticsData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
