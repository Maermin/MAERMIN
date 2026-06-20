// ============================================================================
// MAERMIN v10.0 — Smart Tags / Labels  (window.MaerminTags)
// ----------------------------------------------------------------------------
// New in v10. User-defined, cross-cutting labels on symbols — orthogonal to the
// built-in asset categories (crypto / stocks / skins …). A position can carry
// any number of tags ("high-conviction", "dividend", "speculative", "ESG", …),
// letting the user slice the portfolio by their OWN thesis instead of only by
// asset class.
//
// Tags are stored once and reference symbols, so re-buying or splitting a lot
// never loses the label. Carried in the full-vault backup (key 'maermin_tags').
//
// Pure data layer (no UI). Storage shape:
//
//   { version: 1, tags: { '<name>': { color: '<#hex>', symbols: ['BTC', …] } } }
//
// Names are case-insensitively unique and trimmed. `aggregate()` is pure and
// takes the caller's already-priced positions, so this module never needs the
// metrics engine. Unit-tested in test/tags.test.js.
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'maermin_tags';
  var SCHEMA = 1;
  // A small default palette so new tags get a stable, distinct colour.
  var PALETTE = ['#f5a524', '#22c55e', '#3b82f6', '#a855f7', '#ef4444',
                 '#14b8a6', '#ec4899', '#eab308', '#6366f1', '#f97316'];

  function normName(name) { return String(name == null ? '' : name).trim(); }
  function keyOf(name) { return normName(name).toLowerCase(); }
  function normSym(sym) { return String(sym == null ? '' : sym).trim().toUpperCase(); }

  function isHexColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c); }

  // Coerce stored / foreign data into a clean {version, tags{}} object. Drops
  // empty names, dedups symbols, and rejects non-string colours.
  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var src = (obj.tags && typeof obj.tags === 'object') ? obj.tags : {};
    var tags = {};
    Object.keys(src).forEach(function (name) {
      var clean = normName(name);
      if (!clean) return;
      var entry = src[name] || {};
      var symbols = Array.isArray(entry.symbols) ? entry.symbols : [];
      var seen = {}, list = [];
      symbols.forEach(function (s) {
        var sym = normSym(s);
        if (sym && !seen[sym]) { seen[sym] = 1; list.push(sym); }
      });
      tags[clean] = {
        color: isHexColor(entry.color) ? entry.color : pickColor(clean),
        symbols: list
      };
    });
    return { version: SCHEMA, tags: tags };
  }

  // Deterministic colour from the name so an un-coloured tag is stable.
  function pickColor(name) {
    var h = 0, k = keyOf(name);
    for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // Find the stored name matching `name` case-insensitively (or null).
  function findName(state, name) {
    var target = keyOf(name);
    var hit = null;
    Object.keys(state.tags).forEach(function (n) { if (keyOf(n) === target) hit = n; });
    return hit;
  }

  function listTags(state) {
    state = normalize(state);
    return Object.keys(state.tags).sort(function (a, b) {
      return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
    }).map(function (name) {
      return { name: name, color: state.tags[name].color, symbols: state.tags[name].symbols.slice() };
    });
  }

  function tagsForSymbol(state, symbol) {
    state = normalize(state);
    var sym = normSym(symbol);
    return Object.keys(state.tags).filter(function (n) {
      return state.tags[n].symbols.indexOf(sym) !== -1;
    }).sort();
  }

  function addTag(state, name, opts) {
    state = normalize(state);
    opts = opts || {};
    var clean = normName(name);
    if (!clean) return state;
    var existing = findName(state, clean);
    var color = isHexColor(opts.color) ? opts.color : (existing ? state.tags[existing].color : pickColor(clean));
    if (existing) { state.tags[existing].color = color; return state; }
    state.tags[clean] = { color: color, symbols: [] };
    return state;
  }

  function removeTag(state, name) {
    state = normalize(state);
    var hit = findName(state, name);
    if (hit) delete state.tags[hit];
    return state;
  }

  function renameTag(state, oldName, newName) {
    state = normalize(state);
    var hit = findName(state, oldName);
    var clean = normName(newName);
    if (!hit || !clean) return state;
    if (keyOf(oldName) !== keyOf(clean) && findName(state, clean)) return state; // collision
    var entry = state.tags[hit];
    delete state.tags[hit];
    state.tags[clean] = entry;
    return state;
  }

  function assign(state, name, symbol) {
    state = normalize(state);
    var clean = normName(name), sym = normSym(symbol);
    if (!clean || !sym) return state;
    var hit = findName(state, clean) || clean;
    if (!state.tags[hit]) state.tags[hit] = { color: pickColor(clean), symbols: [] };
    if (state.tags[hit].symbols.indexOf(sym) === -1) state.tags[hit].symbols.push(sym);
    return state;
  }

  function unassign(state, name, symbol) {
    state = normalize(state);
    var hit = findName(state, name), sym = normSym(symbol);
    if (!hit) return state;
    state.tags[hit].symbols = state.tags[hit].symbols.filter(function (s) { return s !== sym; });
    return state;
  }

  // Per-tag value/weight rollup. `positions` is the caller's priced list:
  //   [{ symbol, valueEUR }]  — anything with a numeric value works.
  // Returns rows sorted by value desc; `weightPct` is share of the TOTAL of all
  // supplied positions (not just tagged ones), so untagged value is visible.
  function aggregate(state, positions) {
    state = normalize(state);
    positions = Array.isArray(positions) ? positions : [];
    var total = 0;
    var bySym = {};
    positions.forEach(function (p) {
      var sym = normSym(p && p.symbol);
      var v = p && (typeof p.valueEUR === 'number' ? p.valueEUR : parseFloat(p.valueEUR));
      if (!sym || !isFinite(v)) return;
      bySym[sym] = (bySym[sym] || 0) + v;
      total += v;
    });
    var rows = Object.keys(state.tags).map(function (name) {
      var t = state.tags[name];
      var value = 0, count = 0;
      t.symbols.forEach(function (sym) { if (bySym[sym] != null) { value += bySym[sym]; count++; } });
      return {
        name: name, color: t.color, symbols: t.symbols.slice(),
        value: value, matched: count,
        weightPct: total > 0 ? (value / total) * 100 : 0
      };
    });
    rows.sort(function (a, b) { return b.value - a.value; });
    return { total: total, rows: rows };
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }

  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, tags: {} };
    try { return normalize(s.getItem(STORAGE_KEY)); }
    catch (e) { return { version: SCHEMA, tags: {} }; }
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
    PALETTE: PALETTE,
    pickColor: pickColor,
    normalize: normalize,
    listTags: listTags,
    tagsForSymbol: tagsForSymbol,
    addTag: addTag,
    removeTag: removeTag,
    renameTag: renameTag,
    assign: assign,
    unassign: unassign,
    aggregate: aggregate,
    load: load,
    save: save
  };

  if (typeof window !== 'undefined') window.MaerminTags = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
