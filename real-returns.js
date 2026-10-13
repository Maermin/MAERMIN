// ============================================================================
// MAERMIN — Real (inflation-adjusted) returns  (window.MaerminRealReturns)
// ----------------------------------------------------------------------------
// P5-2.9. Consumer prices: the HICP of Eurostat (dataset prc_hicp_minr, all
// items, index 2015 = 100, monthly), fetched through the user's Worker
// (`?action=hicp&geo=DE`) - only the region code leaves the device. The series
// is public data, cached on the device (`maermin_hicp_cache`, refreshed after
// 7 days, not synced, not backed up); the region is the pref `hicpGeo`.
// Pure + dual-exported; tested in test/real-returns.test.js.
//
//   parse(json)                     → { geo, base, updated, months: [[YYYY-MM, v]] } | null
//   indexAt(series, iso)            → { v, month, carried } | null   (the month of
//                                     the date; after the last month: the last
//                                     value, carried = true; before the first: null)
//   inflation(series, fromISO, toISO) → { total, annualized, from, to, carried } | null
//   realTwr(nominal, fromISO, toISO, series)
//                                   → { real, realAnnualized, inflation, carried } | null
//                                     real = (1 + nominal) / (1 + inflation) − 1
//   realXirr(flows, series, xirr)   each flow lifted to the money of the last
//                                   flow's month (× I_last / I_date), then XIRR
//   GEOS, defaultGeo(language)
//   load(workerUrl, geo, { fetch, now, storage })  → Promise<{ state, series }>
//     state 'ready' | 'outdated' (the Worker has no hicp route yet) | 'error'
//   useHicp(workerUrl, geo)         React hook → { state: 'none'|'loading'|…, series }
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  var DAY = 86400000;
  // the euro area and its members (Eurostat codes)
  var GEOS = ['EA', 'DE', 'AT', 'BE', 'CY', 'EE', 'ES', 'FI', 'FR', 'EL', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];
  function ymd(d) { return String(d == null ? '' : d).slice(0, 10); }
  function days(a, b) { return Math.round((Date.parse(ymd(b) + 'T00:00:00Z') - Date.parse(ymd(a) + 'T00:00:00Z')) / DAY); }
  function perYear(growth, d) { return d >= 365 && growth > 0 ? Math.pow(growth, 365.25 / d) - 1 : null; }

  function parse(json) {
    if (!json || !Array.isArray(json.months)) return null;
    var months = json.months.filter(function (m) {
      return Array.isArray(m) && /^\d{4}-\d{2}$/.test(String(m[0])) && typeof m[1] === 'number' && isFinite(m[1]) && m[1] > 0;
    }).map(function (m) { return [String(m[0]), m[1]]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    if (!months.length) return null;
    return { geo: String(json.geo || ''), base: String(json.base || ''), updated: json.updated ? String(json.updated) : null, months: months };
  }

  function indexAt(series, iso) {
    var list = series && series.months;
    if (!list || !list.length) return null;
    var ym = ymd(iso).slice(0, 7);
    if (ym < list[0][0]) return null;
    var lo = 0, hi = list.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (list[mid][0] <= ym) lo = mid; else hi = mid - 1; }
    return { v: list[lo][1], month: list[lo][0], carried: list[lo][0] !== ym };
  }

  function inflation(series, fromISO, toISO) {
    var a = indexAt(series, fromISO), b = indexAt(series, toISO);
    if (!a || !b || a.carried) return null;
    var g = b.v / a.v, d = days(fromISO, toISO);
    return { total: g - 1, annualized: perYear(g, d), from: a.month, to: b.month, carried: b.carried, days: d };
  }

  function realTwr(nominal, fromISO, toISO, series) {
    if (nominal === null || nominal === undefined || !isFinite(nominal)) return null;
    var inf = inflation(series, fromISO, toISO);
    if (!inf) return null;
    var g = (1 + nominal) / (1 + inf.total);
    return { real: g - 1, realAnnualized: perYear(g, inf.days), inflation: inf, carried: inf.carried };
  }

  function realXirr(flows, series, xirr) {
    if (!Array.isArray(flows) || flows.length < 2 || typeof xirr !== 'function') return null;
    var last = flows.reduce(function (m, f) { return ymd(f.date) > m ? ymd(f.date) : m; }, '');
    var end = indexAt(series, last);
    if (!end) return null;
    var out = [];
    for (var i = 0; i < flows.length; i++) {
      var at = indexAt(series, flows[i].date);
      if (!at) return null;
      out.push({ date: ymd(flows[i].date), amount: flows[i].amount * end.v / at.v });
    }
    return xirr(out);
  }

  function defaultGeo(language) { return String(language || '').slice(0, 2) === 'de' ? 'DE' : 'EA'; }

  // ---- loading (browser): the Worker route, cached on the device ------------
  var CACHE_KEY = 'maermin_hicp_cache', TTL = 7 * DAY;
  var _mem = {};
  function readCache(storage) {
    try { return JSON.parse((storage && storage.getItem(CACHE_KEY)) || '{}') || {}; } catch (e) { return {}; }
  }
  function load(workerUrl, geo, opts) {
    opts = opts || {};
    var doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    var now = opts.now || Date.now();
    var storage = opts.storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : opts.storage;
    var base = String(workerUrl || '').trim().replace(/\/+$/, '');
    if (GEOS.indexOf(geo) === -1) return Promise.resolve({ state: 'error', series: null });
    var memKey = base + '|' + geo;
    if (_mem[memKey] && now - _mem[memKey].at < TTL) return Promise.resolve({ state: 'ready', series: _mem[memKey].series });
    var cache = readCache(storage), hit = cache[geo] && parse(cache[geo].data);
    if (hit && now - (cache[geo].at || 0) < TTL) { _mem[memKey] = { at: cache[geo].at, series: hit }; return Promise.resolve({ state: 'ready', series: hit }); }
    if (!base || !doFetch) return Promise.resolve({ state: hit ? 'ready' : 'error', series: hit || null });
    return doFetch(base + '?action=hicp&geo=' + encodeURIComponent(geo)).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (r.status === 400 && j && /unknown action/i.test(String(j.error || ''))) return { state: 'outdated', series: hit || null };
        var p = r.ok ? parse(j) : null;
        if (!p) return { state: hit ? 'ready' : 'error', series: hit || null };
        _mem[memKey] = { at: now, series: p };
        // public data; the demo's sample series is not kept
        if (storage && !(j && j.sample)) {
          try { var c = readCache(storage); c[geo] = { at: now, data: j }; storage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
        }
        return { state: 'ready', series: p };
      });
    }, function () { return { state: hit ? 'ready' : 'error', series: hit || null }; });
  }
  function useHicp(workerUrl, geo) {
    var React = W.React;
    var st = React.useState({ state: 'none', series: null }), v = st[0], set = st[1];
    React.useEffect(function () {
      if (!String(workerUrl || '').trim()) { set({ state: 'none', series: null }); return undefined; }
      var alive = true;
      set(function (prev) { return { state: 'loading', series: prev.series && prev.series.geo === geo ? prev.series : null }; });
      load(workerUrl, geo).then(function (r) { if (alive) set(r); });
      return function () { alive = false; };
    }, [workerUrl, geo]);
    return v;
  }

  var api = { parse: parse, indexAt: indexAt, inflation: inflation, realTwr: realTwr, realXirr: realXirr, GEOS: GEOS, defaultGeo: defaultGeo,
    load: load, useHicp: useHicp, CACHE_KEY: CACHE_KEY };
  if (typeof window !== 'undefined') window.MaerminRealReturns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
