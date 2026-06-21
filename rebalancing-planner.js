// ============================================================================
// MAERMIN v10.x — Rebalancing Planner  (window.MaerminRebalance)
// ----------------------------------------------------------------------------
// Roadmap feature #1. The user sets TARGET weights — by asset category
// (crypto / stocks / skins …) or by Smart Tag ("high-conviction", "income", …) —
// and the planner reports the current drift and the concrete buy/sell amount per
// bucket needed to get back to target, within a tolerance band.
//
// Persisted (key 'maermin_rebalance_targets', carried in the full-vault backup).
// Storage shape:
//
//   { version: 1, basis: 'category' | 'tag', targets: { '<key>': <weightPct> } }
//
// The PLANNER itself is pure and basis-agnostic: the caller passes the actual
// allocation as rows [{ key, value }] (grouped by category, or built from
// MaerminTags.aggregate for the tag basis), so this module needs neither the
// metrics engine nor the tags module. Unit-tested in test/rebalancing-planner.test.js.
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'maermin_rebalance_targets';
  var SCHEMA = 1;
  var DEFAULT_BAND = 5;        // tolerance in percentage POINTS before an action is suggested
  var BASES = { category: 1, tag: 1 };

  function normKey(k) { return String(k == null ? '' : k).trim(); }
  function clampPct(n) {
    var v = parseFloat(n);
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 100) return 100;
    return v;
  }

  // Coerce stored / foreign data into a clean {version, basis, targets} object.
  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var basis = BASES[obj.basis] ? obj.basis : 'category';
    var src = (obj.targets && typeof obj.targets === 'object') ? obj.targets : {};
    var targets = {};
    Object.keys(src).forEach(function (k) {
      var key = normKey(k);
      if (!key) return;
      var pct = clampPct(src[k]);
      if (pct > 0) targets[key] = pct;   // a 0% target is the same as no target
    });
    return { version: SCHEMA, basis: basis, targets: targets };
  }

  function setBasis(state, basis) {
    state = normalize(state);
    state.basis = BASES[basis] ? basis : state.basis;
    return state;
  }

  function setTarget(state, key, pct) {
    state = normalize(state);
    var k = normKey(key);
    if (!k) return state;
    var v = clampPct(pct);
    if (v > 0) state.targets[k] = v; else delete state.targets[k];
    return state;
  }

  function removeTarget(state, key) {
    state = normalize(state);
    delete state.targets[normKey(key)];
    return state;
  }

  function clearTargets(state) {
    state = normalize(state);
    state.targets = {};
    return state;
  }

  function totalTargetPct(state) {
    state = normalize(state);
    return Object.keys(state.targets).reduce(function (s, k) { return s + state.targets[k]; }, 0);
  }

  // Scale the current targets so they sum to 100% (proportionally). Handy "fix
  // it for me" action when the user's numbers don't add up. No-op if empty/zero.
  function normalizeWeights(state) {
    state = normalize(state);
    var sum = totalTargetPct(state);
    if (sum <= 0) return state;
    var scaled = {};
    Object.keys(state.targets).forEach(function (k) {
      scaled[k] = Math.round((state.targets[k] / sum) * 1000) / 10; // 0.1% precision
    });
    state.targets = scaled;
    return state;
  }

  // The core. `actual` is the current allocation as rows [{ key, value }] (any
  // numeric value/currency — the planner works in ratios). Returns per-bucket
  // drift + the buy(+)/sell(-) delta to reach target, plus a summary.
  //   opts.band  — tolerance in percentage points (default 5)
  function plan(state, actual, opts) {
    state = normalize(state);
    opts = opts || {};
    var band = isFinite(parseFloat(opts.band)) ? parseFloat(opts.band) : DEFAULT_BAND;

    var actualMap = {};
    var total = 0;
    (Array.isArray(actual) ? actual : []).forEach(function (r) {
      var key = normKey(r && r.key);
      var v = r && (typeof r.value === 'number' ? r.value : parseFloat(r.value));
      if (!key || !isFinite(v) || v < 0) return;
      actualMap[key] = (actualMap[key] || 0) + v;
      total += v;
    });

    // Union of every bucket that has a target OR currently holds value.
    var keys = {};
    Object.keys(state.targets).forEach(function (k) { keys[k] = 1; });
    Object.keys(actualMap).forEach(function (k) { keys[k] = 1; });

    var rows = Object.keys(keys).map(function (key) {
      var targetPct = state.targets[key] || 0;
      var actualValue = actualMap[key] || 0;
      var actualPct = total > 0 ? (actualValue / total) * 100 : 0;
      var targetValue = total * (targetPct / 100);
      var deltaValue = targetValue - actualValue;       // + buy, - sell
      var driftPp = actualPct - targetPct;              // + overweight, - underweight
      var action = Math.abs(driftPp) <= band ? 'hold' : (deltaValue > 0 ? 'buy' : 'sell');
      return {
        key: key,
        targetPct: targetPct, actualPct: actualPct,
        targetValue: targetValue, actualValue: actualValue,
        deltaValue: deltaValue, driftPp: driftPp,
        action: action, untargeted: targetPct === 0
      };
    });
    rows.sort(function (a, b) { return Math.abs(b.driftPp) - Math.abs(a.driftPp); });

    var toBuy = 0, toSell = 0, maxDriftPp = 0, balanced = true;
    rows.forEach(function (r) {
      if (r.action === 'buy') toBuy += r.deltaValue;
      else if (r.action === 'sell') toSell += -r.deltaValue;
      if (r.action !== 'hold') balanced = false;
      if (Math.abs(r.driftPp) > maxDriftPp) maxDriftPp = Math.abs(r.driftPp);
    });

    return {
      basis: state.basis,
      total: total,
      band: band,
      sumTargetPct: totalTargetPct(state),
      rows: rows,
      summary: {
        toBuy: toBuy, toSell: toSell,
        turnover: toBuy + toSell,
        maxDriftPp: maxDriftPp,
        balanced: balanced
      }
    };
  }

  // Helper: collapse priced positions [{ <field>, valueEUR }] into the
  // [{ key, value }] rows the planner expects (category basis). For tag basis,
  // pass MaerminTags.aggregate(...).rows mapped to { key: name, value }.
  function groupBy(positions, field) {
    field = field || 'category';
    var map = {};
    (Array.isArray(positions) ? positions : []).forEach(function (p) {
      var key = normKey(p && p[field]);
      var v = p && (typeof p.valueEUR === 'number' ? p.valueEUR : parseFloat(p.valueEUR));
      if (!key || !isFinite(v)) return;
      map[key] = (map[key] || 0) + v;
    });
    return Object.keys(map).map(function (k) { return { key: k, value: map[k] }; });
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }

  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, basis: 'category', targets: {} };
    try { return normalize(s.getItem(STORAGE_KEY)); }
    catch (e) { return { version: SCHEMA, basis: 'category', targets: {} }; }
  }

  function save(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; }
    catch (e) { return false; }
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA: SCHEMA,
    DEFAULT_BAND: DEFAULT_BAND,
    normalize: normalize,
    setBasis: setBasis,
    setTarget: setTarget,
    removeTarget: removeTarget,
    clearTargets: clearTargets,
    totalTargetPct: totalTargetPct,
    normalizeWeights: normalizeWeights,
    plan: plan,
    groupBy: groupBy,
    load: load,
    save: save
  };

  if (typeof window !== 'undefined') window.MaerminRebalance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
