// ============================================================================
// MAERMIN — Chart indicators  (window.MaerminChartIndicators)
// ----------------------------------------------------------------------------
// CH-3b (Phase 7 "Atlas Charts"). The indicator list of the Charts view and
// the maths of compare mode. Pure and Node-tested (test/chart-indicators.test.js).
//
// Every value comes from chart-engine.js (one implementation for the chart,
// Research and the technical rating). The view registers each entry with the
// chart library under its own name (MRM_SMA …), never one of the library's
// built-ins (their SMA is a weighted one, KDJ is not Stochastic).
//
//   CATALOGUE / def(id)          id, kind ('overlay' on the price pane | 'pane'),
//                                params [{ def, min, max, step, optional }],
//                                intraday (VWAP), range (0 … 100), levels
//   normalizeParams(id, raw)     whole periods in range (Bollinger width: one
//                                decimal); an SMA / EMA line may be 0 (off)
//   normalizeList(raw)           [{ id, params }]: known, each once, at most
//                                MAX_PANES oscillator panes (volume extra)
//   canAdd(list, id), available(id, { intraday })
//   calc(id, bars, params, opts) one row per bar ({ key: value }) - the shape
//                                the library draws; libCalc(id) wraps it for
//                                library data (KLineData) and calcParams
//   figures(id, params)          [{ key, title, type: line | bar, tone }]
//                                tone: chart-1 … chart-6 | level | updown | sign
//   label(id, params)            'RSI 14', 'SMA 20 · 50 · 200', 'MACD 12, 26, 9'
//
// Compare mode (up to 3 symbols): alignCompare(main, other, intraday) matches
// daily bars by date (exchanges close at different hours) and intraday bars by
// time, carrying the last close over a missing bar; commonStart(main, aligned)
// is the first bar where every series has a value; compareLines(main, aligned,
// baseIdx) rebases each series on the main symbol's close at the base bar, so
// on the percent scale every line reads as its own % change from there.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  var W = typeof window !== 'undefined' ? window : {};
  function req(f) { try { return f(); } catch (e) { return null; } }
  function engine() { return W.MaerminChartEngine || req(function () { return require('./chart-engine.js'); }); }

  var P = function (def, min, max, step, optional) { return { def: def, min: min, max: max, step: step || 1, optional: !!optional }; };
  var CATALOGUE = [
    { id: 'sma', short: 'SMA', kind: 'overlay', params: [P(20, 2, 400, 1, true), P(50, 2, 400, 1, true), P(200, 2, 400, 1, true)] },
    { id: 'ema', short: 'EMA', kind: 'overlay', params: [P(20, 2, 400, 1, true), P(50, 2, 400, 1, true), P(0, 2, 400, 1, true)] },
    { id: 'bb', short: 'BB', kind: 'overlay', params: [P(20, 2, 400), P(2, 0.5, 5, 0.1)] },
    { id: 'vwap', short: 'VWAP', kind: 'overlay', params: [], intraday: true },
    { id: 'ichimoku', short: null, kind: 'overlay', params: [P(9, 2, 100), P(26, 2, 200), P(52, 2, 400)] },
    { id: 'donchian', short: null, kind: 'overlay', params: [P(20, 2, 400)] },
    { id: 'rsi', short: 'RSI', kind: 'pane', params: [P(14, 2, 400)], range: [0, 100], levels: [30, 70] },
    { id: 'macd', short: 'MACD', kind: 'pane', params: [P(12, 2, 200), P(26, 2, 400), P(9, 2, 200)] },
    { id: 'stoch', short: null, kind: 'pane', params: [P(14, 2, 400), P(3, 1, 50), P(3, 1, 50)], range: [0, 100], levels: [20, 80] },
    { id: 'atr', short: 'ATR', kind: 'pane', params: [P(14, 2, 400)] },
    { id: 'obv', short: 'OBV', kind: 'pane', params: [] },
    { id: 'vol', short: 'VOL', kind: 'pane', params: [], volume: true }
  ];
  var BY_ID = {};
  CATALOGUE.forEach(function (d) { BY_ID[d.id] = d; });
  var MAX_PANES = 3;
  function def(id) { return BY_ID[id] || null; }
  // the short name for tooltips and chips (words through the dictionary)
  function shortOf(id) {
    if (id === 'ichimoku') return __('kcShortIchimoku', 'Ichimoku');
    if (id === 'donchian') return __('kcShortDonchian', 'Donchian');
    if (id === 'stoch') return __('kcShortStoch', 'Stoch');
    var d = def(id);
    return d ? d.short : '';
  }
  function libName(id) { return 'MRM_' + String(id).toUpperCase(); }
  function isOscillator(id) { var d = def(id); return !!d && d.kind === 'pane' && !d.volume; }

  function normalizeParams(id, raw) {
    var d = def(id);
    if (!d) return [];
    var arr = Array.isArray(raw) ? raw : [];
    var out = d.params.map(function (p, i) {
      var v = parseFloat(arr[i]);
      if (!isFinite(v)) return p.def;
      if (p.optional && v === 0) return 0;
      v = p.step < 1 ? Math.round(v * 10) / 10 : Math.round(v);
      return Math.min(p.max, Math.max(p.min, v));
    });
    if (d.params.length && d.params.every(function (p) { return p.optional; }) && out.every(function (v) { return v === 0; })) {
      return d.params.map(function (p) { return p.def; });
    }
    return out;
  }
  function normalizeList(raw) {
    var arr = raw;
    if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch (e) { arr = null; } }
    if (!Array.isArray(arr)) return [];
    var seen = {}, panes = 0, out = [];
    arr.forEach(function (x) {
      if (!x || typeof x !== 'object' || !def(x.id) || seen[x.id]) return;
      if (isOscillator(x.id)) { if (panes >= MAX_PANES) return; panes++; }
      seen[x.id] = true;
      out.push({ id: x.id, params: normalizeParams(x.id, x.params) });
    });
    return out;
  }
  function canAdd(list, id) {
    if (!def(id) || (list || []).some(function (x) { return x && x.id === id; })) return false;
    if (!isOscillator(id)) return true;
    return (list || []).filter(function (x) { return x && isOscillator(x.id); }).length < MAX_PANES;
  }
  function available(id, opts) { var d = def(id); return !!d && (!d.intraday || !!(opts && opts.intraday)); }

  // ---- values -------------------------------------------------------------------
  function rows(n, cols) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var r = {};
      Object.keys(cols).forEach(function (k) { var v = cols[k][i]; r[k] = v == null ? null : v; });
      out.push(r);
    }
    return out;
  }
  function constant(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }
  function calc(id, bars, params, opts) {
    var CE = engine(), list = bars || [], n = list.length, p = normalizeParams(id, params);
    var cl = list.map(function (b) { return b.c; });
    switch (id) {
      case 'sma': case 'ema':
        var f = id === 'sma' ? CE.sma : CE.ema, none = constant(n, null);
        return rows(n, { l1: p[0] ? f(cl, p[0]) : none, l2: p[1] ? f(cl, p[1]) : none, l3: p[2] ? f(cl, p[2]) : none });
      case 'bb': var bb = CE.bollinger(cl, p[0], p[1]); return rows(n, { upper: bb.upper, mid: bb.mid, lower: bb.lower });
      case 'vwap': return rows(n, { vwap: CE.vwap(list, opts) });
      case 'ichimoku':
        var ic = CE.ichimoku(list, p[0], p[1], p[2], p[1]);
        return rows(n, { tenkan: ic.tenkan, kijun: ic.kijun, spanA: ic.spanA, spanB: ic.spanB, chikou: ic.chikou });
      case 'donchian': var dc = CE.donchian(list, p[0]); return rows(n, { upper: dc.upper, mid: dc.mid, lower: dc.lower });
      case 'rsi': return rows(n, { rsi: CE.rsi(cl, p[0]), lo: constant(n, 30), hi: constant(n, 70) });
      case 'macd': var m = CE.macd(cl, p[0], p[1], p[2]); return rows(n, { macd: m.macd, signal: m.signal, hist: m.hist });
      case 'stoch': var s = CE.stochastic(list, p[0], p[1], p[2]); return rows(n, { k: s.k, d: s.d, lo: constant(n, 20), hi: constant(n, 80) });
      case 'atr': return rows(n, { atr: CE.atr(list, p[0]) });
      case 'obv': return rows(n, { obv: CE.obv(list) });
      case 'vol': return list.map(function (b) { return { volume: b.v == null ? null : b.v, up: b.c >= b.o }; });
      default: return rows(n, {});
    }
  }
  function fromKLine(dataList) {
    return (dataList || []).map(function (d) { return { t: d.timestamp / 1000, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volume == null ? null : d.volume }; });
  }
  // the library calls calc(dataList, indicator); extendData carries { tz }
  function libCalc(id) {
    return function (dataList, indicator) {
      return calc(id, fromKLine(dataList), indicator && indicator.calcParams, indicator && indicator.extendData);
    };
  }

  // ---- drawing ------------------------------------------------------------------
  function F(key, title, type, tone) { return { key: key, title: title ? title + ': ' : '', type: type || 'line', tone: tone }; }
  function figures(id, params) {
    var p = normalizeParams(id, params);
    switch (id) {
      case 'sma': case 'ema':
        var tag = id === 'sma' ? 'SMA' : 'EMA';
        return ['l1', 'l2', 'l3'].map(function (k, i) { return p[i] ? F(k, tag + p[i], 'line', 'chart-' + (i + 1)) : null; }).filter(Boolean);
      case 'bb': return [F('upper', __('kcFigUpper', 'Upper'), 'line', 'chart-2'), F('mid', __('kcFigMid', 'Mid'), 'line', 'chart-1'), F('lower', __('kcFigLower', 'Lower'), 'line', 'chart-2')];
      case 'vwap': return [F('vwap', 'VWAP', 'line', 'chart-4')];
      case 'ichimoku': return [F('tenkan', __('kcFigTenkan', 'Tenkan'), 'line', 'chart-2'), F('kijun', __('kcFigKijun', 'Kijun'), 'line', 'chart-5'), F('spanA', __('kcFigSpanA', 'Span A'), 'line', 'chart-3'),
        F('spanB', __('kcFigSpanB', 'Span B'), 'line', 'chart-4'), F('chikou', __('kcFigChikou', 'Chikou'), 'line', 'chart-6')];
      case 'donchian': return [F('upper', __('kcFigUpper', 'Upper'), 'line', 'chart-6'), F('mid', __('kcFigMid', 'Mid'), 'line', 'chart-1'), F('lower', __('kcFigLower', 'Lower'), 'line', 'chart-6')];
      case 'rsi': return [F('rsi', 'RSI', 'line', 'chart-1'), F('lo', '', 'line', 'level'), F('hi', '', 'line', 'level')];
      case 'macd': return [F('macd', 'MACD', 'line', 'chart-1'), F('signal', __('kcParSignal', 'Signal'), 'line', 'chart-4'), F('hist', __('kcFigHist', 'Histogram'), 'bar', 'sign')];
      case 'stoch': return [F('k', '%K', 'line', 'chart-1'), F('d', '%D', 'line', 'chart-4'), F('lo', '', 'line', 'level'), F('hi', '', 'line', 'level')];
      case 'atr': return [F('atr', 'ATR', 'line', 'chart-1')];
      case 'obv': return [F('obv', 'OBV', 'line', 'chart-1')];
      case 'vol': return [F('volume', '', 'bar', 'updown')];
      default: return [];
    }
  }
  function label(id, params) {
    var d = def(id);
    if (!d) return '';
    var p = normalizeParams(id, params);
    var sh = shortOf(id);
    if (!p.length) return sh;
    if (id === 'sma' || id === 'ema') return sh + ' ' + p.filter(function (v) { return v; }).join(' · ');
    return sh + ' ' + p.join(', ');
  }

  // ---- compare mode -------------------------------------------------------------
  function dayOf(t) { return new Date(t * 1000).toISOString().slice(0, 10); }
  function alignCompare(main, other, intraday) {
    var at = {};
    (other || []).forEach(function (b) { if (b && isFinite(b.c)) at[intraday ? b.t : dayOf(b.t)] = b.c; });
    var keys = Object.keys(at), firstKey = null;
    if (keys.length) firstKey = intraday ? Math.min.apply(null, keys.map(Number)) : keys.sort()[0];
    var last = null;
    return (main || []).map(function (b) {
      var k = intraday ? b.t : dayOf(b.t);
      if (Object.prototype.hasOwnProperty.call(at, k)) last = at[k];
      else if (firstKey == null || (intraday ? k < firstKey : k < firstKey)) return null;
      return last;
    });
  }
  function commonStart(main, alignedList) {
    for (var i = 0; i < (main || []).length; i++) {
      if (!isFinite(main[i].c)) continue;
      if ((alignedList || []).every(function (a) { return a[i] != null && a[i] > 0; })) return i;
    }
    return -1;
  }
  function compareLines(main, alignedList, baseIdx) {
    var base = main && main[baseIdx] ? main[baseIdx].c : null;
    var values = (alignedList || []).map(function (a) {
      var b0 = a[baseIdx];
      return a.map(function (v, i) { return i < baseIdx || v == null || !b0 || base == null ? null : base * v / b0; });
    });
    var pct = (alignedList || []).map(function (a) {
      var b0 = a[baseIdx], end = a[a.length - 1];
      return b0 && end != null ? end / b0 - 1 : null;
    });
    return { base: base, values: values, pct: pct };
  }

  var api = {
    CATALOGUE: CATALOGUE, MAX_PANES: MAX_PANES, def: def, shortOf: shortOf, libName: libName, isOscillator: isOscillator,
    normalizeParams: normalizeParams, normalizeList: normalizeList, canAdd: canAdd, available: available,
    calc: calc, libCalc: libCalc, fromKLine: fromKLine, figures: figures, label: label,
    alignCompare: alignCompare, commonStart: commonStart, compareLines: compareLines
  };
  if (typeof window !== 'undefined') window.MaerminChartIndicators = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
