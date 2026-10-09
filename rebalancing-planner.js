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

  // ---- tolerance band per target (P4-4) --------------------------------------
  // A band is { rel, abs }: rel = share of the target (0.25 = ±25 % of it),
  // abs = floor in percentage points. The band of a target t is
  //   max(rel × t, abs)   e.g. t 40 %, rel 25 %, abs 2 pp → ±10 pp;
  //                            t  4 %, rel 25 %, abs 2 pp → ±2 pp (the floor)
  function cleanBand(b, fallback) {
    fallback = fallback || { rel: 0, abs: DEFAULT_BAND };
    if (!b || typeof b !== 'object') return { rel: fallback.rel, abs: fallback.abs };
    var rel = parseFloat(b.rel), abs = parseFloat(b.abs);
    return {
      rel: isFinite(rel) && rel >= 0 ? Math.min(rel, 1) : fallback.rel,
      abs: isFinite(abs) && abs >= 0 ? Math.min(abs, 100) : fallback.abs
    };
  }
  function bandPp(targetPct, band) {
    var b = cleanBand(band);
    return Math.max(b.rel * (targetPct || 0), b.abs);
  }

  // The core. `actual` is the current allocation as rows [{ key, value }] (any
  // numeric value/currency — the planner works in ratios). Returns per-bucket
  // drift + the buy(+)/sell(-) delta to reach target, plus a summary.
  //   opts.band          tolerance in percentage points for every target
  //                      (default 5; the legacy option)
  //   opts.defaultBand   { rel, abs } band for targets without their own (P4-4)
  //   opts.bands         { key: { rel, abs } } band per target (P4-4)
  //   opts.mode          'full' (default): buy and sell back to target;
  //                      'cashflow': only buy, from opts.contribution, nothing sold
  //   opts.contribution  new money to invest (≥ 0, same unit as the values)
  //   actual[i].sellable value of the bucket that may be sold (holdings marked
  //                      "never sell" left out); default: all of it
  // Rows: { key, targetPct, actualPct, targetValue, actualValue, deltaValue,
  //         driftPp, bandPp, action: 'buy'|'sell'|'hold', untargeted,
  //         blockedSell }   blockedSell = sale needed but not allowed
  // Summary: { toBuy, toSell, turnover, maxDriftPp, balanced, contribution,
  //            cashLeft, blocked }
  function plan(state, actual, opts) {
    state = normalize(state);
    opts = opts || {};
    var legacy = isFinite(parseFloat(opts.band)) ? parseFloat(opts.band) : null;
    var defBand = legacy !== null ? { rel: 0, abs: legacy } : cleanBand(opts.defaultBand);
    var bands = (opts.bands && typeof opts.bands === 'object') ? opts.bands : {};
    var mode = opts.mode === 'cashflow' ? 'cashflow' : 'full';
    var contribution = parseFloat(opts.contribution);
    contribution = isFinite(contribution) && contribution > 0 ? contribution : 0;

    var actualMap = {}, sellMap = {};
    var total = 0;
    (Array.isArray(actual) ? actual : []).forEach(function (r) {
      var key = normKey(r && r.key);
      var v = r && (typeof r.value === 'number' ? r.value : parseFloat(r.value));
      if (!key || !isFinite(v) || v < 0) return;
      var sv = r && r.sellable != null ? parseFloat(r.sellable) : v;
      actualMap[key] = (actualMap[key] || 0) + v;
      sellMap[key] = (sellMap[key] || 0) + (isFinite(sv) ? Math.max(0, Math.min(sv, v)) : v);
      total += v;
    });
    var after = total + contribution;

    // Union of every bucket that has a target OR currently holds value.
    var keys = {};
    Object.keys(state.targets).forEach(function (k) { keys[k] = 1; });
    Object.keys(actualMap).forEach(function (k) { keys[k] = 1; });

    var rows = Object.keys(keys).map(function (key) {
      var targetPct = state.targets[key] || 0;
      var actualValue = actualMap[key] || 0;
      var actualPct = total > 0 ? (actualValue / total) * 100 : 0;
      var targetValue = after * (targetPct / 100);
      var band = legacy !== null ? legacy : bandPp(targetPct, cleanBand(bands[key], defBand));
      return {
        key: key,
        targetPct: targetPct, actualPct: actualPct,
        targetValue: targetValue, actualValue: actualValue,
        need: targetValue - actualValue,
        sellable: sellMap[key] || 0,
        deltaValue: 0, driftPp: actualPct - targetPct, bandPp: band,
        action: 'hold', untargeted: targetPct === 0, blockedSell: 0
      };
    });

    var cashLeft = 0;
    if (mode === 'cashflow') {
      // Only buy: the contribution goes to the buckets below target, in
      // proportion to how far below they are; what is left after every gap
      // is closed is spread by target weight. Nothing is sold.
      var gaps = 0, sumT = 0;
      rows.forEach(function (r) { if (r.need > 0) gaps += r.need; sumT += r.targetPct; });
      rows.forEach(function (r) {
        var buy = 0;
        if (contribution > 0) {
          if (gaps >= contribution) buy = r.need > 0 ? contribution * r.need / gaps : 0;
          else buy = (r.need > 0 ? r.need : 0) + (sumT > 0 ? (contribution - gaps) * r.targetPct / sumT : 0);
        }
        r.deltaValue = buy;
        r.action = buy > 1e-9 ? 'buy' : 'hold';
      });
      if (sumT <= 0 && gaps <= 0) cashLeft = contribution;
    } else {
      // Buckets outside their band go back to target: sells first (at most
      // what may be sold), then buys from the sales plus the contribution,
      // scaled down when that money does not cover them.
      var cash = contribution, wants = 0;
      rows.forEach(function (r) {
        if (Math.abs(r.driftPp) <= r.bandPp && !(total <= 0 && r.need > 0)) return;
        if (r.need < 0) {
          var sell = Math.min(-r.need, r.sellable);
          r.blockedSell = -r.need - sell;
          if (sell > 1e-9) { r.deltaValue = -sell; r.action = 'sell'; cash += sell; }
        } else if (r.need > 0) {
          wants += r.need;
        }
      });
      var scale = wants > cash ? (wants > 0 ? cash / wants : 0) : 1;
      rows.forEach(function (r) {
        if (Math.abs(r.driftPp) <= r.bandPp && !(total <= 0 && r.need > 0)) return;
        if (r.need > 0) {
          var buy = r.need * scale;
          if (buy > 1e-9) { r.deltaValue = buy; r.action = 'buy'; }
        }
      });
      cashLeft = Math.max(0, cash - wants * scale);
    }
    rows.forEach(function (r) { delete r.need; delete r.sellable; });
    rows.sort(function (a, b) { return Math.abs(b.driftPp) - Math.abs(a.driftPp); });

    var toBuy = 0, toSell = 0, maxDriftPp = 0, balanced = true, blocked = 0;
    rows.forEach(function (r) {
      if (r.action === 'buy') toBuy += r.deltaValue;
      else if (r.action === 'sell') toSell += -r.deltaValue;
      blocked += r.blockedSell;
      if (Math.abs(r.driftPp) > r.bandPp) balanced = false;
      if (Math.abs(r.driftPp) > maxDriftPp) maxDriftPp = Math.abs(r.driftPp);
    });

    return {
      basis: state.basis,
      mode: mode,
      total: total,
      band: legacy !== null ? legacy : defBand.abs,
      sumTargetPct: totalTargetPct(state),
      rows: rows,
      summary: {
        toBuy: toBuy, toSell: toSell,
        turnover: toBuy + toSell,
        maxDriftPp: maxDriftPp,
        balanced: balanced,
        contribution: contribution,
        cashLeft: cashLeft,
        blocked: blocked
      }
    };
  }

  // ---- settings of the Rebalancing view (P4-4) ----------------------------
  // Key 'maermin_rebalance_prefs' (encrypted: it names holdings; in the
  // backup). { version, mode, defaultBand: { rel, abs }, bands: { key: { rel,
  // abs } }, noSell: ['SYMBOL', …] }. Defaults keep the old behaviour: buy and
  // sell, ±5 pp for every target, nothing protected.
  var PREFS_KEY = 'maermin_rebalance_prefs';
  function normalizePrefs(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') o = {};
    var bands = {};
    if (o.bands && typeof o.bands === 'object') Object.keys(o.bands).forEach(function (k) {
      var key = normKey(k); if (key && o.bands[k] && typeof o.bands[k] === 'object') bands[key] = cleanBand(o.bands[k]);
    });
    var seen = {}, noSell = [];
    (Array.isArray(o.noSell) ? o.noSell : []).forEach(function (sym) {
      var k = String(sym == null ? '' : sym).trim().toUpperCase();
      if (k && !seen[k]) { seen[k] = 1; noSell.push(k); }
    });
    return { version: 1, mode: o.mode === 'cashflow' ? 'cashflow' : 'full', defaultBand: cleanBand(o.defaultBand), bands: bands, noSell: noSell.sort() };
  }
  function loadPrefs() {
    var s = store();
    if (!s) return normalizePrefs(null);
    try { return normalizePrefs(s.getItem(PREFS_KEY)); } catch (e) { return normalizePrefs(null); }
  }
  function savePrefs(p) {
    var s = store();
    if (!s) return false;
    try { s.setItem(PREFS_KEY, JSON.stringify(normalizePrefs(p))); return true; } catch (e) { return false; }
  }
  function isNoSell(prefs, symbol) {
    return normalizePrefs(prefs).noSell.indexOf(String(symbol || '').trim().toUpperCase()) !== -1;
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
    bandPp: bandPp,
    cleanBand: cleanBand,
    groupBy: groupBy,
    load: load,
    save: save,
    PREFS_KEY: PREFS_KEY,
    normalizePrefs: normalizePrefs,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    isNoSell: isNoSell
  };

  if (typeof window !== 'undefined') window.MaerminRebalance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
