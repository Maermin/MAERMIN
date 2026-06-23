// ============================================================================
// MAERMIN — Historical FX Rates  (window.MaerminFxHistory)
// ----------------------------------------------------------------------------
// The app converts every USD transaction to EUR with ONE live USD→EUR rate.
// That is wrong for cost basis and German tax, which require the rate AT THE
// TRANSACTION DATE (the ECB reference rate of the day). This module keeps a
// small local cache of daily USD→EUR rates and resolves the right rate for any
// date, so buildPositions / the tax report can price each lot on its own day.
//
//   load() / save(map) / merge(map)     persisted at localStorage[KEY]
//   ingestYahooSeries(json)             turn the Worker's EURUSD=X response
//                                        (USD per 1 EUR) into { date: usdEur }
//   rateAt(history, dateISO, fallback)  nearest-on-or-before lookup (pure)
//   fxResolver(fallback, history?)      → (dateISO) => rate, O(log n) per call
//
// Pure + Node-tested. Fetching the series is the renderer's job (best effort via
// the Cloudflare Worker); everything here is offline + deterministic. FX rates
// are public market data, so this cache is NOT a SENSITIVE_KEY.
// ============================================================================
(function () {
  'use strict';

  var KEY = 'maermin_fx_history'; // { 'YYYY-MM-DD': usdToEur }

  function ymd(d) {
    if (!d) return '';
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    try { var t = new Date(d); return isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10); }
    catch (e) { return ''; }
  }
  function num(x) { var n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : null; }

  function load() {
    if (typeof localStorage === 'undefined') return {};
    try { var raw = localStorage.getItem(KEY); var o = raw ? JSON.parse(raw) : {}; return (o && typeof o === 'object') ? o : {}; }
    catch (e) { return {}; }
  }
  function save(map) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(map || {})); } catch (e) { /* quota / unavailable */ }
  }
  // Merge new rates into the stored cache (new values win). Returns the merged map.
  function merge(newMap) {
    var cur = load();
    if (newMap && typeof newMap === 'object') {
      Object.keys(newMap).forEach(function (k) {
        var d = ymd(k), r = num(newMap[k]);
        if (d && r != null && r > 0) cur[d] = r;
      });
    }
    save(cur);
    return cur;
  }

  // The Worker's `?action=yf&symbol=EURUSD=X` response is { prices:[{date, price}] }
  // where price = USD per 1 EUR (e.g. 1.08). USD→EUR = 1 / price. Produces a
  // { 'YYYY-MM-DD': usdToEur } map; rows with a non-positive price are dropped.
  function ingestYahooSeries(json) {
    var out = {};
    var prices = json && json.prices;
    if (!Array.isArray(prices)) return out;
    prices.forEach(function (p) {
      var d = ymd(p && p.date);
      var eurUsd = num(p && p.price);
      if (d && eurUsd != null && eurUsd > 0) out[d] = 1 / eurUsd; // USD→EUR
    });
    return out;
  }

  // Nearest rate on or before `dateISO`. If the date precedes all data, the
  // EARLIEST known rate is used (closer than today's); if it is after all data,
  // the LATEST known rate. Empty history → `fallback`. Pure.
  function rateAt(history, dateISO, fallback) {
    var fb = num(fallback);
    if (!history || typeof history !== 'object') return fb;
    var keys = Object.keys(history);
    if (!keys.length) return fb;
    var target = ymd(dateISO);
    if (!target) return fb != null ? fb : pick(history, keys.sort()[keys.length - 1]);
    keys.sort();
    // binary search for the last key <= target
    var lo = 0, hi = keys.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (keys[mid] <= target) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (ans === -1) return pick(history, keys[0]);          // before all data → earliest
    return pick(history, keys[ans]);
  }
  function pick(history, key) { var r = num(history[key]); return r != null && r > 0 ? r : null; }

  // Bind a fast resolver: pre-sorts the keys ONCE so each lookup is O(log n) —
  // matters for 10k+ transactions. Returns (dateISO) => rate, falling back to
  // `fallback` (the live rate) when the cache is empty or has no usable value.
  function fxResolver(fallback, history) {
    var fb = num(fallback);
    var hist = history || load();
    var keys = Object.keys(hist).filter(function (k) { return pick(hist, k) != null; }).sort();
    if (!keys.length) return function () { return fb; };
    return function (dateISO) {
      var target = ymd(dateISO);
      if (!target) return fb != null ? fb : pick(hist, keys[keys.length - 1]);
      var lo = 0, hi = keys.length - 1, ans = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (keys[mid] <= target) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      var r = pick(hist, ans === -1 ? keys[0] : keys[ans]);
      return r != null ? r : fb;
    };
  }

  function has() { var h = load(); return Object.keys(h).length > 0; }

  var api = {
    KEY: KEY,
    load: load, save: save, merge: merge,
    ingestYahooSeries: ingestYahooSeries,
    rateAt: rateAt,
    fxResolver: fxResolver,
    has: has
  };
  if (typeof window !== 'undefined') window.MaerminFxHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
