// ============================================================================
// MAERMIN — Chart drawings  (window.MaerminChartDrawings)
// ----------------------------------------------------------------------------
// CH-4 (Phase 7 "Atlas Charts"). The drawing tools of the Charts view and
// where drawings are kept. Pure and Node-tested (test/chart-drawings.test.js).
//
//   TOOLS / toolOf(overlay)   trend line, ray, horizontal and vertical line,
//                             parallel channel, Fibonacci (the chart library's
//                             own overlays) and rectangle, text note, measure
//                             (registered by charts.js as mrmRect / mrmText /
//                             mrmMeasure); `points` = clicks to finish
//   KEY 'maermin_chart_drawings'
//     { version: 1, bySymbol: { 'SAP.DE': [{ id, overlay, points: [{ t, v }], text }] } }
//     t = epoch ms, v = price: a drawing stays where it is on any timeframe.
//     Encrypted at rest (storage.js SENSITIVE_KEYS) and so in the sync
//     snapshot; in full backups (backup-engine.js KEYS). No migration.
//   normalize(raw)            malformed entries dropped, never a crash: unknown
//                             tool, too few points, bad time or price; extra
//                             points cut; notes ≤ 200 characters; ≤ 200
//                             drawings per symbol, ≤ 100 symbols
//   load(storage) / save(storage, state) / forSymbol / setSymbol
//   fromOverlay(o) / toCreate(d)   library overlay ↔ stored drawing
//   measure(p1, p2)           { diff, pct, bars } for the measure tool
//   alertRule(sym, price, last, { toListing })  a normal Alerts & Rules price
//                             rule (rules-engine.js symbol_price): ≥ when the line
//                             is above the last price, ≤ below; the threshold in
//                             the listing currency (the unit price rules and the
//                             Worker's push checks use)
// ============================================================================
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
  function req(f) { try { return f(); } catch (e) { return null; } }

  var TOOLS = [
    { id: 'trend', overlay: 'segment', points: 2 },
    { id: 'ray', overlay: 'rayLine', points: 2 },
    { id: 'hline', overlay: 'horizontalStraightLine', points: 1 },
    { id: 'vline', overlay: 'verticalStraightLine', points: 1 },
    { id: 'channel', overlay: 'parallelStraightLine', points: 3 },
    { id: 'fib', overlay: 'fibonacciLine', points: 2 },
    { id: 'rect', overlay: 'mrmRect', points: 2 },
    { id: 'text', overlay: 'mrmText', points: 1 },
    { id: 'measure', overlay: 'mrmMeasure', points: 2 }
  ];
  var BY_OVERLAY = {};
  TOOLS.forEach(function (t) { BY_OVERLAY[t.overlay] = t; });
  function toolOf(overlay) { return BY_OVERLAY[overlay] || null; }

  var KEY = 'maermin_chart_drawings';
  var GROUP = 'mrm-draw';
  var MAX_PER_SYMBOL = 200, MAX_SYMBOLS = 100, MAX_TEXT = 200;
  function isMarket(sym) {
    var T = W.MaerminTickers || req(function () { return require('./ticker-validation.js'); });
    return T && T.isMarketSymbol ? T.isMarketSymbol(sym) : /^[A-Z0-9^][A-Z0-9.=^-]{0,19}$/.test(sym);
  }
  function uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function num(x) { var n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : null; }

  function normalizeDrawing(d) {
    if (!d || typeof d !== 'object') return null;
    var tool = toolOf(d.overlay);
    if (!tool || !Array.isArray(d.points) || d.points.length < tool.points) return null;
    var pts = [];
    for (var i = 0; i < tool.points; i++) {
      var p = d.points[i], t = p ? num(p.t) : null, v = p ? num(p.v) : null;
      if (t == null || v == null) return null;
      pts.push({ t: t, v: v });
    }
    var out = { id: typeof d.id === 'string' && d.id ? d.id.slice(0, 40) : uid(), overlay: tool.overlay, points: pts };
    if (tool.id === 'text') out.text = String(d.text == null ? '' : d.text).slice(0, MAX_TEXT);
    return out;
  }
  function normalize(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    var by = o && typeof o === 'object' && o.bySymbol && typeof o.bySymbol === 'object' && !Array.isArray(o.bySymbol) ? o.bySymbol : {};
    var out = {}, n = 0;
    Object.keys(by).forEach(function (k) {
      var sym = String(k).trim().toUpperCase();
      if (n >= MAX_SYMBOLS || !sym || !isMarket(sym) || !Array.isArray(by[k])) return;
      var list = by[k].map(normalizeDrawing).filter(Boolean).slice(0, MAX_PER_SYMBOL);
      if (!list.length) return;
      out[sym] = (out[sym] || []).concat(list).slice(0, MAX_PER_SYMBOL);
      n++;
    });
    return { version: 1, bySymbol: out };
  }
  function load(storage) {
    try { return normalize(storage ? storage.getItem(KEY) : null); }
    catch (e) { return normalize(null); }
  }
  function save(storage, state) {
    try { storage.setItem(KEY, JSON.stringify(normalize(state))); return true; }
    catch (e) { return false; }
  }
  function forSymbol(state, sym) {
    var s = normalize(state), k = String(sym || '').toUpperCase();
    return s.bySymbol[k] ? s.bySymbol[k].slice() : [];
  }
  function setSymbol(state, sym, list) {
    var s = normalize(state), k = String(sym || '').toUpperCase(), by = Object.assign({}, s.bySymbol);
    var clean = (list || []).map(normalizeDrawing).filter(Boolean).slice(0, MAX_PER_SYMBOL);
    if (clean.length) by[k] = clean; else delete by[k];
    return normalize({ bySymbol: by });
  }

  function fromOverlay(o) {
    if (!o) return null;
    return normalizeDrawing({ id: o.id, overlay: o.name, text: o.extendData && o.extendData.text,
      points: (o.points || []).map(function (p) { return { t: p && p.timestamp, v: p && p.value }; }) });
  }
  function toCreate(d) {
    return { id: d.id, name: d.overlay, groupId: GROUP, points: d.points.map(function (p) { return { timestamp: p.t, value: p.v }; }),
      extendData: d.text != null ? { text: d.text } : null };
  }

  function measure(a, b) {
    var v1 = num(a && a.value), v2 = num(b && b.value);
    if (v1 == null || v2 == null) return null;
    var i1 = num(a.dataIndex), i2 = num(b.dataIndex);
    return { diff: v2 - v1, pct: v1 ? v2 / v1 - 1 : null, bars: i1 != null && i2 != null ? Math.round(i2 - i1) : null };
  }

  function round(v) { var f = Math.abs(v) >= 1 ? 100 : 10000; return Math.round(v * f) / f; }
  function alertRule(sym, price, last, opts) {
    opts = opts || {};
    var s = String(sym || '').trim().toUpperCase(), p = num(price);
    if (!s || p == null) return null;
    var listing = typeof opts.toListing === 'function' ? num(opts.toListing(p)) : p;
    if (listing == null) return null;
    var l = num(last);
    var op = l == null || listing >= l ? 'gte' : 'lte';
    return { metric: 'symbol_price', op: op, threshold: round(listing), target: s };
  }

  var api = {
    TOOLS: TOOLS, toolOf: toolOf, KEY: KEY, GROUP: GROUP,
    normalize: normalize, load: load, save: save, forSymbol: forSymbol, setSymbol: setSymbol,
    fromOverlay: fromOverlay, toCreate: toCreate, measure: measure, alertRule: alertRule
  };
  if (typeof window !== 'undefined') window.MaerminChartDrawings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
