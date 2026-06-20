// ============================================================================
// MAERMIN v10.0 — Portfolio Value Snapshots  (window.MaerminSnapshots)
// ----------------------------------------------------------------------------
// New in v10. An append-only, on-device time series of the portfolio's TOTAL
// value. Every time the app computes the live total it records one point per
// day (per portfolio), so the value history is:
//
//   • durable  — survives price-API outages, offline days and reinstalls,
//   • portable — carried in the full-vault backup (key 'maermin_snapshots'),
//   • truthful — it is what the user actually saw, not a re-derived estimate.
//
// This complements features6.js (which re-derives a curve from Yahoo history):
// snapshots are the ground-truth fallback when no external history is reachable.
//
// Pure math (normalize / addPoint / changeBetween / seriesFor) is split from the
// localStorage helpers so the engine is unit-tested headlessly
// (test/portfolio-snapshots.test.js). Storage shape:
//
//   { version: 1, points: [ { d: 'YYYY-MM-DD', v: <number>, pid: <string> } ] }
//
// One point per (day, portfolio); a same-day re-record overwrites that day so
// the series can never balloon. 'pid' is the portfolio id, or 'all' for the
// combined total.
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'maermin_snapshots';
  var SCHEMA = 1;
  var DEFAULT_CAP = 1825;      // ~5 years of daily points per portfolio
  var ALL = 'all';

  function todayISO() {
    var d = new Date();
    return d.getUTCFullYear() + '-' +
      ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getUTCDate()).slice(-2);
  }

  function isISODate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  // Coerce any stored / foreign value into a clean {version, points[]} object.
  // Bad points are dropped silently so one corrupt entry can't break the series.
  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var pts = Array.isArray(obj.points) ? obj.points : [];
    var clean = [];
    pts.forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      if (!isISODate(p.d)) return;
      var v = typeof p.v === 'number' ? p.v : parseFloat(p.v);
      if (!isFinite(v)) return;
      clean.push({ d: p.d, v: v, pid: p.pid ? String(p.pid) : ALL });
    });
    clean.sort(sortPoints);
    return { version: SCHEMA, points: clean };
  }

  function sortPoints(a, b) {
    if (a.d !== b.d) return a.d < b.d ? -1 : 1;
    return a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0;
  }

  function prune(points, cap) {
    cap = cap || DEFAULT_CAP;
    // Cap per portfolio so a busy combined series can't evict a quiet one.
    var byPid = {};
    points.forEach(function (p) { (byPid[p.pid] = byPid[p.pid] || []).push(p); });
    var out = [];
    Object.keys(byPid).forEach(function (pid) {
      var arr = byPid[pid];
      if (arr.length > cap) arr = arr.slice(arr.length - cap);
      out = out.concat(arr);
    });
    out.sort(sortPoints);
    return out;
  }

  // Append (or overwrite same-day) a value point. Returns a NEW state; never
  // mutates the input. A non-finite or negative value is ignored (returns state
  // unchanged) so a transient pricing glitch never poisons the history.
  function addPoint(state, entry, opts) {
    state = normalize(state);
    opts = opts || {};
    entry = entry || {};
    var v = typeof entry.value === 'number' ? entry.value : parseFloat(entry.value);
    if (!isFinite(v) || v < 0) return state;
    var d = isISODate(entry.date) ? entry.date : todayISO();
    var pid = entry.portfolioId ? String(entry.portfolioId) : ALL;
    var points = state.points.filter(function (p) { return !(p.d === d && p.pid === pid); });
    points.push({ d: d, v: v, pid: pid });
    points.sort(sortPoints);
    return { version: SCHEMA, points: prune(points, opts.cap) };
  }

  function seriesFor(state, portfolioId) {
    state = normalize(state);
    var pid = portfolioId ? String(portfolioId) : ALL;
    return state.points.filter(function (p) { return p.pid === pid; });
  }

  function latest(state, portfolioId) {
    var s = seriesFor(state, portfolioId);
    return s.length ? s[s.length - 1] : null;
  }

  // Value point at-or-before an ISO date (last known value, like a stock close).
  function valueAsOf(state, iso, portfolioId) {
    var s = seriesFor(state, portfolioId);
    var found = null;
    for (var i = 0; i < s.length; i++) { if (s[i].d <= iso) found = s[i]; else break; }
    return found;
  }

  // Absolute + percent change between two dates (inclusive, last-known-value).
  function changeBetween(state, fromISO, toISO, portfolioId) {
    var start = valueAsOf(state, fromISO, portfolioId);
    var end = toISO ? valueAsOf(state, toISO, portfolioId) : latest(state, portfolioId);
    if (!start || !end) return null;
    var abs = end.v - start.v;
    var pct = start.v !== 0 ? (abs / start.v) * 100 : null;
    return { start: start, end: end, abs: abs, pct: pct };
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }

  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, points: [] };
    try { return normalize(s.getItem(STORAGE_KEY)); }
    catch (e) { return { version: SCHEMA, points: [] }; }
  }

  function save(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; }
    catch (e) { return false; }
  }

  // Convenience: record today's total for a portfolio and persist. Returns the
  // saved state. Used by the renderer right after it computes the live total.
  function record(value, portfolioId, opts) {
    var next = addPoint(load(), { value: value, portfolioId: portfolioId }, opts);
    save(next);
    return next;
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA: SCHEMA,
    ALL: ALL,
    todayISO: todayISO,
    normalize: normalize,
    prune: prune,
    addPoint: addPoint,
    seriesFor: seriesFor,
    latest: latest,
    valueAsOf: valueAsOf,
    changeBetween: changeBetween,
    load: load,
    save: save,
    record: record
  };

  if (typeof window !== 'undefined') window.MaerminSnapshots = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
