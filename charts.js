// ============================================================================
// MAERMIN — Charts view  (window.MaerminCharts)
// ----------------------------------------------------------------------------
// CH-3a (Phase 7 "Atlas Charts"). A chart workspace per symbol: candles, OHLC
// bars, Heikin Ashi, line and area with volume; intraday to monthly
// timeframes; linear, log and percent scales; the listing currency or EUR.
//
// Data: the user's own Worker (`?action=yf`, candles since Worker 2026.10.15;
// an older Worker sends closes only and the view offers line / area with a
// note). Only symbol, interval and range leave the device. The maths lives in
// chart-engine.js; the drawing library is KLineChart (Apache-2.0), loaded the
// first time the view opens, pinned with SRI (LIB below, CSP script-src).
// Nothing else in the app depends on it.
//
// Pure helpers (Node-tested in test/charts.test.js): TIMEFRAMES / timeframe,
// TYPES / type / availableTypes / usableType, SCALES, normalizePrefs /
// loadPrefs / savePrefs (key maermin_chart_prefs: encrypted at rest because
// it names a symbol; in backups), requestUrl, toKLine, rangeChange,
// precision, quickPicks, chartStyles (library colours from the design tokens).
// Not investment advice.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  var W = typeof window !== 'undefined' ? window : {};
  function req(f) { try { return f(); } catch (e) { return null; } }

  // The one chart library (docs: PLAN.md Phase 7, D3 vetting). Same path in the
  // CSP script-src of index.html and build.mjs.
  var LIB = [
    { src: 'https://unpkg.com/klinecharts@10.1.0/dist/umd/klinecharts.min.js',
      integrity: 'sha384-PdxmZHfTETfZiWcY/lOW/FdSPI3RTThvwFZDXUCvqNbLhWIL6z0bmLCSd7BorO6s' }
  ];

  // ---- timeframes: button → Worker interval / range (inside the CH-1 limits) -----
  var TIMEFRAMES = [
    { id: '1m', interval: '1m', range: '5d', intraday: true, period: { type: 'minute', span: 1 } },
    { id: '5m', interval: '5m', range: '1mo', intraday: true, period: { type: 'minute', span: 5 } },
    { id: '15m', interval: '15m', range: '1mo', intraday: true, period: { type: 'minute', span: 15 } },
    { id: '1h', interval: '60m', range: '6mo', intraday: true, period: { type: 'hour', span: 1 } },
    { id: '4h', interval: '60m', range: '2y', intraday: true, resample: 4, period: { type: 'hour', span: 4 } },
    // not range=max: Yahoo answers 1d over max with monthly bars
    { id: '1D', interval: '1d', range: '10y', intraday: false, period: { type: 'day', span: 1 } },
    { id: '1W', interval: '1wk', range: 'max', intraday: false, period: { type: 'week', span: 1 } },
    { id: '1M', interval: '1mo', range: 'max', intraday: false, period: { type: 'month', span: 1 } }
  ];
  function timeframe(id) {
    for (var i = 0; i < TIMEFRAMES.length; i++) if (TIMEFRAMES[i].id === id) return TIMEFRAMES[i];
    return TIMEFRAMES[5];
  }

  // ---- chart types and scales ---------------------------------------------------------
  var TYPES = [
    { id: 'candles', candle: 'candle_solid', needsOhlc: true },
    { id: 'ohlc', candle: 'ohlc', needsOhlc: true },
    { id: 'heikin', candle: 'candle_solid', needsOhlc: true },
    { id: 'line', candle: 'area', needsOhlc: false },
    { id: 'area', candle: 'area', needsOhlc: false }
  ];
  function type(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return null;
  }
  function availableTypes(ohlc) { return TYPES.filter(function (t) { return ohlc || !t.needsOhlc; }); }
  function usableType(id, ohlc) {
    var t = type(id) || TYPES[0];
    return ohlc || !t.needsOhlc ? t.id : 'line';
  }
  var SCALES = [{ id: 'linear', axis: 'normal' }, { id: 'log', axis: 'logarithm' }, { id: 'percent', axis: 'percentage' }];
  function scale(id) {
    for (var i = 0; i < SCALES.length; i++) if (SCALES[i].id === id) return SCALES[i];
    return SCALES[0];
  }

  // ---- per-viewer settings --------------------------------------------------------------
  var PREFS_KEY = 'maermin_chart_prefs';
  function isMarket(sym) {
    var T = W.MaerminTickers || req(function () { return require('./ticker-validation.js'); });
    return T && T.isMarketSymbol ? T.isMarketSymbol(sym) : /^[A-Z0-9^][A-Z0-9.=^-]{0,19}$/.test(sym);
  }
  function indicatorsLib() { return W.MaerminChartIndicators || req(function () { return require('./chart-indicators.js'); }); }
  var MAX_COMPARE = 3;
  function normalizePrefs(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') o = {};
    var sym = typeof o.symbol === 'string' ? o.symbol.trim().toUpperCase() : '';
    var CI = indicatorsLib();
    // CH-3b: the indicator list; settings from CH-3a only had a volume flag
    var indicators = (Array.isArray(o.indicators) || typeof o.indicators === 'string') && CI ? CI.normalizeList(o.indicators)
      : (o.volume === false ? [] : [{ id: 'vol', params: [] }]);
    var compare = [];
    (Array.isArray(o.compare) ? o.compare : []).forEach(function (x) {
      var c = typeof x === 'string' ? x.trim().toUpperCase() : '';
      if (c && isMarket(c) && c !== sym && compare.indexOf(c) === -1 && compare.length < MAX_COMPARE) compare.push(c);
    });
    return {
      symbol: sym && isMarket(sym) ? sym : '',
      type: type(o.type) ? o.type : 'candles',
      timeframe: TIMEFRAMES.some(function (t) { return t.id === o.timeframe; }) ? o.timeframe : '1D',
      scale: SCALES.some(function (s) { return s.id === o.scale; }) ? o.scale : 'linear',
      eur: o.eur === true,
      indicators: indicators,
      compare: compare
    };
  }
  function loadPrefs(storage) {
    try { return normalizePrefs(storage ? storage.getItem(PREFS_KEY) : null); }
    catch (e) { return normalizePrefs(null); }
  }
  function savePrefs(storage, prefs) {
    try { storage.setItem(PREFS_KEY, JSON.stringify(normalizePrefs(prefs))); return true; }
    catch (e) { return false; }
  }

  // ---- data -------------------------------------------------------------------------------
  // `bars=1` marks a chart request: the real Worker ignores it; the demo answers
  // candles only for it, so the other demo views keep their data.
  function requestUrl(base, symbol, tf) {
    return String(base || '').replace(/\/+$/, '') + '/?action=yf&symbol=' + encodeURIComponent(symbol) +
      '&interval=' + tf.interval + '&range=' + tf.range + '&bars=1';
  }
  function toKLine(bars) {
    return (bars || []).map(function (b) {
      return { timestamp: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v == null ? 0 : b.v };
    });
  }
  function rangeChange(bars) {
    var list = bars || [];
    if (!list.length) return { first: null, last: null, pct: null };
    var first = list[0].c, last = list[list.length - 1].c;
    return { first: first, last: last, pct: first ? last / first - 1 : null };
  }
  function precision(price) {
    var p = Math.abs(price || 0);
    return p >= 1 ? 2 : p >= 0.01 ? 4 : 6;
  }
  // Stocks and bonds the user holds plus the watchlist (as Research offers them).
  function quickPicks(transactions, watchlist) {
    var s = {};
    (transactions || []).forEach(function (t) {
      if (t && t.symbol && (t.category === 'stocks' || t.category === 'bonds')) s[String(t.symbol).toUpperCase()] = true;
    });
    (watchlist || []).forEach(function (w) { if (w && w.symbol) s[String(w.symbol).toUpperCase()] = true; });
    return Object.keys(s).filter(isMarket).sort();
  }

  // ---- the library's colours, from the design tokens ---------------------------------------
  // resolve: MaerminTokens.resolve; alpha: MaerminTokens.alpha (a hex in → #rrggbbaa);
  // opts.family: the app's font (the library's own default is a serif fallback);
  // opts.still: reduced motion (no pulsing dot on the last price);
  // opts.narrow: phone width (the price tooltip only while the crosshair is on)
  function chartStyles(resolve, typeId, alpha, opts) {
    opts = opts || {};
    var family = opts.family, still = !!opts.still;
    var f = family ? { family: family } : {};
    var txt = function (o) { return Object.assign({}, o, f); };
    var tok = function (name) { return resolve('var(--' + name + ')'); };
    var gain = tok('gain'), loss = tok('loss'), text = tok('text'), dim = tok('text-dim'), border = tok('border'), accent = tok('accent'), surface = tok('surface');
    var t = type(typeId) || TYPES[0];
    var lineOnly = t.id === 'line';
    return {
      grid: { horizontal: { color: border }, vertical: { color: border } },
      candle: {
        type: t.candle,
        bar: { upColor: gain, downColor: loss, noChangeColor: dim, upBorderColor: gain, downBorderColor: loss, noChangeBorderColor: dim,
          upWickColor: gain, downWickColor: loss, noChangeWickColor: dim },
        area: { lineSize: 2, lineColor: accent, backgroundColor: lineOnly ? 'transparent' : alpha(accent, 0.18),
          point: { color: accent, rippleColor: alpha(accent, 0.3), animation: !still } },
        priceMark: { high: txt({ color: dim }), low: txt({ color: dim }), last: { upColor: gain, downColor: loss, noChangeColor: dim, text: txt({ color: surface }) } },
        // the symbol and timeframe are in the view's own header
        tooltip: { showRule: opts.narrow ? 'follow_cross' : 'always', title: txt({ show: false, color: text }), legend: txt({ color: dim }) }
      },
      // volume bars (and later indicator bars) in gain / loss like the candles
      indicator: { ohlc: { upColor: gain, downColor: loss, noChangeColor: dim }, tooltip: { title: txt({ color: text }), legend: txt({ color: dim }) } },
      xAxis: { axisLine: { color: border }, tickLine: { color: border }, tickText: txt({ color: dim }) },
      yAxis: { axisLine: { color: border }, tickLine: { color: border }, tickText: txt({ color: dim }) },
      separator: { color: border },
      crosshair: {
        horizontal: { line: { color: dim }, text: txt({ color: surface, backgroundColor: dim, borderColor: dim }) },
        vertical: { line: { color: dim }, text: txt({ color: surface, backgroundColor: dim, borderColor: dim }) }
      }
    };
  }

  // ---- our indicators in the library (CH-3b) ---------------------------------------------------
  // Registered once under MRM_* names; values from chart-indicators.js (chart-engine.js).
  // Colours resolve at draw time, so they follow the theme.
  function figureStyles(tone) {
    return function (p) {
      var T = W.MaerminTokens;
      if (!T) return null;
      var row = p && p.data ? p.data.current : null;
      if (tone === 'level') return { color: T.resolve('var(--text-faint)'), style: 'dashed', dashedValue: [4, 4], size: 1 };
      if (tone === 'updown') return { color: T.alpha(T.resolve(row && row.up ? 'var(--gain)' : 'var(--loss)'), 0.55), style: 'fill' };
      if (tone === 'sign') return { color: T.alpha(T.resolve(row && row.hist >= 0 ? 'var(--gain)' : 'var(--loss)'), 0.6), style: 'fill' };
      return { color: T.resolve('var(--' + tone + ')') };
    };
  }
  function libFigures(id, params) {
    return indicatorsLib().figures(id, params).map(function (f) {
      var fig = { key: f.key, title: f.title, type: f.type, styles: figureStyles(f.tone) };
      if (f.tone === 'sign') fig.baseValue = 0;
      return fig;
    });
  }
  var COMPARE = 'MRM_CMP';
  var registered = false;
  function registerIndicators(K) {
    var CI = indicatorsLib();
    if (registered || !K || !K.registerIndicator || !CI) return;
    registered = true;
    CI.CATALOGUE.forEach(function (d) {
      var p0 = CI.normalizeParams(d.id);
      var big = d.id === 'vol' || d.id === 'obv';
      K.registerIndicator({ name: CI.libName(d.id), shortName: CI.shortOf(d.id), calcParams: p0, precision: big ? 0 : 2, shouldFormatBigNumber: big,
        series: d.kind === 'overlay' ? 'price' : d.volume ? 'volume' : 'normal',
        minValue: d.range ? d.range[0] : null, maxValue: d.range ? d.range[1] : null,
        figures: libFigures(d.id, p0), regenerateFigures: (function (id) { return function (cp) { return libFigures(id, cp); }; })(d.id),
        calc: CI.libCalc(d.id) });
    });
    // compare lines: each update brings its own figures (named by symbol) and a
    // calc over the precomputed values (a new calc makes the library recalculate)
    K.registerIndicator({ name: COMPARE, shortName: '', calcParams: [], series: 'price', precision: 2, figures: [], calc: function () { return []; } });
  }

  // ---- the view ------------------------------------------------------------------------------
  // props: { theme, transactions, symbol, onSymbol, workerUrl, exchangeRate, fxAt, symbols, demo }
  function View(props) {
    var React = W.React;
    if (!React) return null;
    var e = React.createElement, useState = React.useState, useEffect = React.useEffect, useRef = React.useRef, useMemo = React.useMemo;
    var UIC = W.MaerminComponents, UI = W.MaerminUI, I = W.MaerminI18n, CE = W.MaerminChartEngine, DFX = W.MaerminDemoFixtures;
    var base = String(props.workerUrl || '').replace(/\/+$/, '');
    var store = req(function () { return W.localStorage; });

    var s0 = useState(function () { return loadPrefs(store); }); var prefs = s0[0], setPrefs = s0[1];
    var sym = String(props.symbol || prefs.symbol || '').toUpperCase();
    var s1 = useState(sym); var draft = s1[0], setDraft = s1[1];
    var s2 = useState(W.klinecharts ? 'ready' : 'loading'); var lib = s2[0], setLib = s2[1];
    var s3 = useState({ state: 'idle' }); var data = s3[0], setData = s3[1];
    var s4 = useState([]); var found = s4[0], setFound = s4[1];
    var s5 = useState(''); var bad = s5[0], setBad = s5[1];
    var s6 = useState(0); var tries = s6[0], setTries = s6[1];
    var s7 = useState({}); var cmp = s7[0], setCmp = s7[1];
    var s8 = useState(0); var visFrom = s8[0], setVisFrom = s8[1];
    var s9 = useState(null); var dlg = s9[0], setDlg = s9[1];
    var s10 = useState(''); var cmpDraft = s10[0], setCmpDraft = s10[1];
    var plotRef = useRef(null), chartRef = useRef(null);
    var CI = W.MaerminChartIndicators;
    var tf = timeframe(prefs.timeframe);
    var themeKey = (typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-theme')) || 'dark';
    var lang = I && I.lang ? I.lang() : 'en';
    var narrow = UIC && UIC.useNarrow ? UIC.useNarrow() : false;

    // merged into the latest settings, so two changes in one tick both stay
    var update = function (patch) {
      setPrefs(function (prev) { var next = normalizePrefs(Object.assign({}, prev, patch)); savePrefs(store, next); return next; });
    };
    useEffect(function () { setDraft(sym); if (sym && sym !== prefs.symbol) update({ symbol: sym }); }, [sym]);

    // the library, once (Retry tries again)
    useEffect(function () {
      if (W.klinecharts) { setLib('ready'); return; }
      var U = W.MaerminUtils;
      if (!U || !U.loadScripts) { setLib('error'); return; }
      var dead = false;
      setLib('loading');
      U.loadScripts(LIB).then(function () { if (!dead) setLib(W.klinecharts ? 'ready' : 'error'); }, function () { if (!dead) setLib('error'); });
      return function () { dead = true; };
    }, [tries]);

    // the bars
    useEffect(function () {
      if (!sym || !base) { setData({ state: 'idle' }); return; }
      var dead = false;
      setData({ state: 'loading' });
      fetch(requestUrl(base, sym, tf)).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }, function () { return { status: r.status, j: null }; }); })
        .then(function (r) {
          if (dead) return;
          if (r.status !== 200 || !r.j || r.j.error) { setData({ state: r.status === 404 ? 'none' : 'error' }); return; }
          var p = CE.parseBars(r.j);
          if (!p.bars.length) { setData({ state: 'none' }); return; }
          var bars = tf.resample ? CE.resample(p.bars, tf.resample, { tz: p.exchangeTz, intervalSec: 3600 }) : p.bars;
          setData({ state: 'ok', p: p, bars: bars, sample: !!r.j.sample });
        })
        .catch(function () { if (!dead) setData({ state: 'error' }); });
      return function () { dead = true; };
    }, [sym, base, tf.id, tries]);

    // symbol search through the Worker (stocks, ETFs, funds)
    useEffect(function () {
      var q = draft.trim();
      if (!base || q.length < 2 || q.toUpperCase() === sym) { setFound([]); return; }
      var dead = false;
      var timer = setTimeout(function () {
        fetch(base + '/?action=yfsearch&q=' + encodeURIComponent(q) + '&type=stock').then(function (r) { return r.ok ? r.json() : []; })
          .then(function (list) {
            if (dead) return;
            setFound((Array.isArray(list) ? list : []).filter(function (x) { return x && x.symbol && (x.type === 'EQUITY' || x.type === 'ETF' || x.type === 'MUTUALFUND'); })
              .slice(0, 8).map(function (x) { return { symbol: String(x.symbol).toUpperCase(), name: x.name || x.shortname || '' }; }));
          }).catch(function () { if (!dead) setFound([]); });
      }, 300);
      return function () { dead = true; clearTimeout(timer); };
    }, [draft, base]);

    var cur = data.state === 'ok' ? String(data.p.currency || '').toUpperCase() : '';
    var eurOn = prefs.eur && cur && cur !== 'EUR';
    var ohlc = data.state === 'ok' ? data.p.ohlc : true;
    var typeId = usableType(prefs.type, ohlc);
    var plain = useMemo(function () {
      if (data.state !== 'ok') return [];
      if (!eurOn) return data.bars;
      var F = W.MaerminFxHistory;
      return CE.toEUR(data.bars, cur, function (amount, c, iso) { return F && F.txToEUR ? F.txToEUR(amount, c, iso, props.exchangeRate, props.fxAt) : null; });
    }, [data, eurOn, props.exchangeRate]);
    var shown = useMemo(function () { return typeId === 'heikin' ? CE.heikinAshi(plain) : plain; }, [plain, typeId]);
    var shownCur = eurOn ? 'EUR' : cur;

    // the chart: created once the library is there, disposed with the view
    useEffect(function () {
      if (lib !== 'ready' || !plotRef.current || chartRef.current) return;
      var K = W.klinecharts;
      registerIndicators(K);
      chartRef.current = K.init(plotRef.current);
      var el = plotRef.current, ro = null;
      if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(function () { if (chartRef.current) chartRef.current.resize(); }); ro.observe(el); }
      return function () { if (ro) ro.disconnect(); req(function () { K.dispose(el); }); chartRef.current = null; };
    }, [lib, sym && base ? 1 : 0]);

    // labels in the app's language
    useEffect(function () {
      var K = W.klinecharts, chart = chartRef.current;
      if (!K || !chart) return;
      K.registerLocale('maermin', {
        // the tooltip puts the value right after the label
        time: __('kcTipTime', 'Time') + ': ', open: __('kcTipOpen', 'Open') + ': ', high: __('kcTipHigh', 'High') + ': ', low: __('kcTipLow', 'Low') + ': ',
        close: __('kcTipClose', 'Close') + ': ', volume: __('kcTipVolume', 'Volume') + ': ', change: __('kcTipChange', 'Change') + ': ', turnover: __('kcTipTurnover', 'Turnover') + ': ',
        second: __('kcUnitSecond', 's'), minute: __('kcUnitMinute', 'min'), hour: __('kcUnitHour', 'h'), day: __('kcUnitDay', 'D'),
        week: __('kcUnitWeek', 'W'), month: __('kcUnitMonth', 'M'), year: __('kcUnitYear', 'Y')
      });
      chart.setLocale('maermin');
    }, [lib, lang, sym && base ? 1 : 0]);

    // colours and type (follow the theme)
    useEffect(function () {
      var chart = chartRef.current, T = W.MaerminTokens;
      if (!chart || !T) return;
      var family = req(function () { return getComputedStyle(document.body).fontFamily; });
      var still = !!req(function () { return W.matchMedia('(prefers-reduced-motion: reduce)').matches; }) || !!req(function () { return document.documentElement.classList.contains('mx-still'); });
      chart.setStyles(chartStyles(T.resolve, typeId, T.alpha, { family: family, still: still, narrow: narrow }));
    }, [lib, typeId, themeKey, narrow, sym && base ? 1 : 0]);

    // scale
    useEffect(function () {
      var chart = chartRef.current;
      if (!chart) return;
      chart.overrideYAxis({ paneId: 'candle_pane', name: scale(prefs.scale).axis });
    }, [lib, prefs.scale, sym && base ? 1 : 0]);

    // indicators: the chart shows exactly the list in the settings (CH-3b)
    var wanted = (prefs.indicators || []).filter(function (x) { return CI && CI.available(x.id, { intraday: tf.intraday }); });
    var tz = data.state === 'ok' ? data.p.exchangeTz : null;
    // each extra pane adds its own height, so the price pane keeps its size
    var paneHeight = function (id) { return id === 'vol' ? (narrow ? 64 : 80) : (narrow ? 90 : 110); };
    var plotHeight = (narrow ? 300 : 440) + wanted.filter(function (w) { return CI && CI.def(w.id).kind === 'pane'; })
      .reduce(function (a, w) { return a + paneHeight(w.id); }, 0);
    useEffect(function () {
      var chart = chartRef.current;
      if (!chart || !CI) return;
      var ext = { tz: tz || 'UTC' };
      chart.getIndicators().forEach(function (ind) {
        if (/^MRM_/.test(ind.name) && ind.name !== COMPARE && !wanted.some(function (w) { return CI.libName(w.id) === ind.name; })) chart.removeIndicator({ name: ind.name });
      });
      wanted.forEach(function (w) {
        var d = CI.def(w.id), name = CI.libName(w.id);
        var spec = { name: name, calcParams: w.params, extendData: ext, shortName: w.id === 'vol' ? __('kcVolume', 'Volume') : CI.shortOf(w.id) };
        if (chart.getIndicators({ name: name }).length) chart.overrideIndicator(spec);
        // v10: the pane goes in the spec (paneId); overlays stack on the price pane
        else if (d.kind === 'overlay') chart.createIndicator(Object.assign({ paneId: 'candle_pane' }, spec), true);
        else {
          chart.createIndicator(Object.assign({ paneId: 'kc_' + w.id }, spec), false);
          chart.setPaneOptions({ id: 'kc_' + w.id, height: paneHeight(w.id) });
        }
      });
    }, [lib, JSON.stringify(wanted), tz, lang, sym && base ? 1 : 0]);

    // compare: the other symbols' bars for the same timeframe
    var cmpKey = (prefs.compare || []).join();
    // the dialog opened from an active chip shows that indicator and focuses its first field
    useEffect(function () {
      if (!dlg || dlg === 'all') return;
      var t = setTimeout(function () {
        var row = document.querySelector('[data-testid="ch-ind-' + dlg + '"]');
        if (!row) return;
        row.scrollIntoView({ block: 'nearest' });
        var f = row.querySelector('input') || row.querySelector('button');
        if (f) f.focus();
      }, 60);
      return function () { clearTimeout(t); };
    }, [dlg]);
    useEffect(function () {
      if (!base || !cmpKey) { setCmp({}); return; }
      var dead = false;
      Promise.all(prefs.compare.map(function (c) {
        return fetch(requestUrl(base, c, tf)).then(function (r) { return r.json().then(function (j) { return { c: c, ok: r.status === 200 && j && !j.error, j: j }; }); })
          .catch(function () { return { c: c, ok: false }; });
      })).then(function (res) {
        if (dead) return;
        var out = {};
        res.forEach(function (x) {
          var p = x.ok ? CE.parseBars(x.j) : null;
          var b = p && p.bars.length ? (tf.resample ? CE.resample(p.bars, tf.resample, { tz: p.exchangeTz, intervalSec: 3600 }) : p.bars) : null;
          out[x.c] = b ? { state: 'ok', bars: b } : { state: 'none' };
        });
        setCmp(out);
      });
      return function () { dead = true; };
    }, [cmpKey, base, tf.id, tries]);
    // the first visible bar: compare lines start there, as on the percent scale
    useEffect(function () {
      var chart = chartRef.current;
      if (!chart || !cmpKey) return;
      var cb = function (r) { var f = r && r.from != null ? r.from : null; if (f != null) setVisFrom(Math.max(0, Math.floor(f))); };
      chart.subscribeAction('onVisibleRangeChange', cb);
      return function () { req(function () { chart.unsubscribeAction('onVisibleRangeChange', cb); }); };
    }, [lib, cmpKey, sym && base ? 1 : 0]);
    var fmtPctTip = function (v) { return (v > 0 ? '+' : '') + I.num(v * 100, 2) + ' %'; };
    var cmpCalc = useMemo(function () {
      var syms = (prefs.compare || []).filter(function (c) { return cmp[c] && cmp[c].state === 'ok'; });
      if (!CI || !syms.length || !plain.length) return null;
      var aligned = syms.map(function (c) { return CI.alignCompare(plain, cmp[c].bars, tf.intraday); });
      var start = CI.commonStart(plain, aligned);
      if (start < 0) return null;
      var L = CI.compareLines(plain, aligned, Math.min(Math.max(start, visFrom), plain.length - 1));
      return { syms: syms, values: L.values, pct: L.pct, base: L.base };
    }, [plain, cmp, cmpKey, visFrom, tf.intraday]);
    useEffect(function () {
      var chart = chartRef.current;
      if (!chart) return;
      var has = chart.getIndicators({ name: COMPARE }).length > 0;
      if (!cmpCalc) { if (has) chart.removeIndicator({ name: COMPARE }); return; }
      var values = cmpCalc.values;
      var spec = { name: COMPARE, calcParams: [], shortName: __('kcCompare', 'Compare'),
        figures: cmpCalc.syms.map(function (c, i) { return { key: 'c' + i, title: c + ': ', type: 'line', styles: figureStyles('chart-' + (i + 2)) }; }),
        calc: function (dataList) { return dataList.map(function (x, i) { var r = {}; values.forEach(function (arr, j) { r['c' + j] = arr[i] == null ? null : arr[i]; }); return r; }); },
        // the tooltip shows each symbol's % change from the base bar (the line itself is in the main symbol's units)
        createTooltipDataSource: function (q) {
          var i = q && q.crosshair ? q.crosshair.dataIndex : null, T = W.MaerminTokens;
          return { name: __('kcCompare', 'Compare'), calcParamsText: '', features: [],
            legends: cmpCalc.syms.map(function (c, j) {
              var v = i != null && values[j] ? values[j][i] : null, color = T ? T.resolve('var(--chart-' + (j + 2) + ')') : '';
              return { title: { text: c + ': ', color: color }, value: { text: v == null || !cmpCalc.base ? '–' : fmtPctTip(v / cmpCalc.base - 1), color: color } };
            }) };
        } };
      if (has) chart.overrideIndicator(spec); else chart.createIndicator(Object.assign({ paneId: 'candle_pane' }, spec), true);
    }, [lib, cmpCalc, shown, lang, sym && base ? 1 : 0]);

    // the data
    useEffect(function () {
      var chart = chartRef.current;
      if (!chart || !shown.length) return;
      var list = toKLine(shown);
      if (data.p && data.p.exchangeTz) req(function () { chart.setTimezone(data.p.exchangeTz); });
      chart.setDataLoader({ getBars: function (q) { q.callback(q.type === 'init' ? list : [], false); } });
      chart.setSymbol({ ticker: sym, pricePrecision: precision(list[list.length - 1].close), volumePrecision: 0 });
      chart.setPeriod(tf.period);
      chart.resetData(); // the loader above answers with the new bars
    }, [lib, shown, sym && base ? 1 : 0]);

    // ---- render ----
    var open = function (s) {
      var v = String(s == null ? draft : s).trim().toUpperCase();
      if (!v) return;
      if (!isMarket(v)) { setBad(v); return; }
      setBad('');
      if (props.onSymbol) props.onSymbol(v); else update({ symbol: v });
    };
    var picks = props.symbols || [];
    var hasVol = (prefs.indicators || []).some(function (x) { return x.id === 'vol'; });
    var setIndicators = function (list) { update({ indicators: CI ? CI.normalizeList(list) : list }); };
    var addCompare = function () {
      var c = cmpDraft.trim().toUpperCase();
      if (!c) return;
      if (!isMarket(c) || c === sym) { setBad(c); return; }
      setBad(''); setCmpDraft('');
      // TradingView-style: comparing switches to the percent scale (switch back any time)
      if ((prefs.compare || []).indexOf(c) === -1) update({ compare: (prefs.compare || []).concat([c]), scale: 'percent' });
    };
    var removeCompare = function (c) { update({ compare: (prefs.compare || []).filter(function (x) { return x !== c; }) }); };
    var PARAM_LABEL = {
      sma: [__('kcParLine1', 'Line 1'), __('kcParLine2', 'Line 2'), __('kcParLine3', 'Line 3')],
      ema: [__('kcParLine1', 'Line 1'), __('kcParLine2', 'Line 2'), __('kcParLine3', 'Line 3')],
      bb: [__('kcParPeriod', 'Period'), __('kcParWidth', 'Width (σ)')],
      ichimoku: [__('kcParConversion', 'Conversion'), __('kcParBase', 'Base'), __('kcParSpanB', 'Span B')],
      donchian: [__('kcParPeriod', 'Period')], rsi: [__('kcParPeriod', 'Period')], atr: [__('kcParPeriod', 'Period')],
      macd: [__('kcParFast', 'Fast'), __('kcParSlow', 'Slow'), __('kcParSignal', 'Signal')],
      stoch: [__('kcParK', '%K'), __('kcParKSmooth', '%K smoothing'), __('kcParD', '%D')]
    };
    var IND_NAME = {
      sma: __('kcIndSma', 'Moving average (SMA)'), ema: __('kcIndEma', 'Exponential moving average (EMA)'), bb: __('kcIndBb', 'Bollinger Bands'),
      vwap: __('kcIndVwap', 'VWAP (intraday)'), ichimoku: __('kcIndIchimoku', 'Ichimoku'), donchian: __('kcIndDonchian', 'Donchian channel'),
      rsi: __('kcIndRsi', 'RSI'), macd: __('kcIndMacd', 'MACD'), stoch: __('kcIndStoch', 'Stochastic'), atr: __('kcIndAtr', 'ATR (average true range)'),
      obv: __('kcIndObv', 'OBV (on-balance volume)'), vol: __('kcVolume', 'Volume')
    };
    var activeOf = function (id) { return (prefs.indicators || []).filter(function (x) { return x.id === id; })[0] || null; };
    var toggleInd = function (id) {
      var on = activeOf(id);
      setIndicators(on ? prefs.indicators.filter(function (x) { return x.id !== id; }) : prefs.indicators.concat([{ id: id, params: CI.normalizeParams(id) }]));
    };
    var setParam = function (id, i, raw) {
      var on = activeOf(id);
      if (!on) return;
      var p = on.params.slice(); p[i] = raw;
      setIndicators(prefs.indicators.map(function (x) { return x.id === id ? { id: id, params: CI.normalizeParams(id, p) } : x; }));
    };
    var paneFull = !!CI && (prefs.indicators || []).filter(function (x) { return CI.isOscillator(x.id); }).length >= CI.MAX_PANES;
    var dialog = CI ? e(UIC.Modal, { open: !!dlg, onClose: function () { setDlg(null); }, title: __('kcIndicators', 'Indicators'), 'data-testid': 'ch-ind-dialog',
        footer: e(UIC.Button, { variant: 'primary', onClick: function () { setDlg(null); } }, __('kcDone', 'Done')) },
      paneFull ? e('p', { className: 'ui-muted', 'data-testid': 'ch-pane-limit' }, __('kcPaneLimit', 'At most {n} indicator panes: remove one to add another.', { n: CI.MAX_PANES })) : null,
      e('div', { className: 'ui-ch-ind-list' }, CI.CATALOGUE.map(function (d) {
        var on = activeOf(d.id), avail = CI.available(d.id, { intraday: tf.intraday });
        var blocked = !on && (!avail || !CI.canAdd(prefs.indicators || [], d.id));
        return e('div', { key: d.id, className: 'ui-ch-ind', 'data-testid': 'ch-ind-' + d.id, 'data-focus': dlg === d.id ? 'true' : undefined },
          e(UIC.Chip, { pressed: !!on, disabled: blocked, onClick: function () { toggleInd(d.id); } }, IND_NAME[d.id] || CI.shortOf(d.id)),
          !avail ? e('span', { className: 'ui-muted' }, __('kcIntradayOnly', 'intraday timeframes only')) : null,
          on && d.params.length ? e('div', { className: 'ui-ch-ind__params' }, d.params.map(function (p, i) {
            return e('label', { key: i, className: 'ui-ch-ind__param' },
              e('span', null, (PARAM_LABEL[d.id] || [])[i] || ''),
              e('input', { type: 'number', className: 'ui-input', 'data-testid': 'ch-par-' + d.id + '-' + i, defaultValue: on.params[i], key: d.id + i + '-' + on.params[i],
                min: p.optional ? 0 : p.min, max: p.max, step: p.step,
                onBlur: function (ev) { setParam(d.id, i, ev.target.value); }, onKeyDown: function (ev) { if (ev.key === 'Enter') setParam(d.id, i, ev.target.value); } }));
          })) : null);
      }))) : null;
    // the active indicators and compared symbols, each with a remove button
    var active = (prefs.indicators || []).length || (prefs.compare || []).length ? e('div', { className: ['ui-chips', 'ui-ch-active'].join(' '), role: 'group', 'aria-label': __('kcActive', 'On the chart') },
      (prefs.indicators || []).map(function (x) {
        var lbl = x.id === 'vol' ? __('kcVolume', 'Volume') : CI ? CI.label(x.id, x.params) : x.id;
        return e('span', { key: x.id, className: 'ui-ch-tag' },
          e(UIC.Chip, { 'data-testid': 'ch-active-' + x.id, onClick: function () { setDlg(x.id); } }, lbl),
          e(UIC.IconButton, { size: 'sm', 'data-testid': 'ch-rm-' + x.id, label: __('kcRemoveInd', 'Remove {name}', { name: lbl }), onClick: function () { toggleInd(x.id); },
            icon: e('span', { 'aria-hidden': 'true' }, '×') }));
      }),
      (prefs.compare || []).map(function (c, i) {
        var none = cmp[c] && cmp[c].state === 'none';
        return e('span', { key: 'c' + c, className: 'ui-ch-tag' },
          e('span', { className: 'ui-chart__swatch', 'data-series': String(i + 2), 'aria-hidden': 'true' }),
          e('span', { 'data-testid': 'ch-cmp-' + c, className: none ? 'ui-muted' : '' }, none ? __('kcCompareNone', '{sym}: no data', { sym: c }) : c),
          e(UIC.IconButton, { size: 'sm', 'data-testid': 'ch-cmp-rm-' + c, label: __('kcRemoveCompare', 'Stop comparing {sym}', { sym: c }), onClick: function () { removeCompare(c); },
            icon: e('span', { 'aria-hidden': 'true' }, '×') }));
      })) : null;
    var ch = rangeChange(shown);
    var fmtPrice = function (v) { return v == null ? '–' : I.num(v, precision(v)) + (shownCur ? ' ' + shownCur : ''); };
    var pctTxt = ch.pct == null ? '' : (ch.pct > 0 ? '+' : '') + I.num(ch.pct * 100, 2) + ' %';
    var since = shown.length ? I.date(new Date(shown[0].t * 1000).toISOString().slice(0, 10)) : '';
    var TF_LABEL = { '1m': __('kcTf1m', '1m'), '5m': __('kcTf5m', '5m'), '15m': __('kcTf15m', '15m'), '1h': __('kcTf1h', '1h'), '4h': __('kcTf4h', '4h'),
      '1D': __('kcTf1D', '1D'), '1W': __('kcTf1W', '1W'), '1M': __('kcTf1M', '1M') };
    var tfLabel = function (id) { return TF_LABEL[id] || id; };
    var typeLabel = { candles: __('kcTypeCandles', 'Candles'), ohlc: __('kcTypeOhlc', 'Bars'), heikin: __('kcTypeHeikin', 'Heikin Ashi'), line: __('kcTypeLine', 'Line'), area: __('kcTypeArea', 'Area') };
    var fmtPct = function (v) { return v == null ? '–' : (v > 0 ? '+' : '') + I.num(v * 100, 2) + ' %'; };
    // CH-3b: the last value of each indicator (its first figure) and the compared symbols
    var indText = wanted.filter(function (w) { return w.id !== 'vol'; }).map(function (w) {
      var rows = CI.calc(w.id, plain, w.params, { tz: tz || 'UTC' }), last = rows[rows.length - 1] || {};
      var key = (CI.figures(w.id, w.params)[0] || {}).key, v = key ? last[key] : null;
      return CI.label(w.id, w.params) + ': ' + (v == null ? '–' : I.num(v, 2));
    });
    var cmpText = cmpCalc ? cmpCalc.syms.map(function (c, i) { return c + ' ' + fmtPct(cmpCalc.pct[i]); }) : [];
    var summary = data.state === 'ok' && shown.length
      ? [__('kcSummary', '{sym}, {tf}, {type}: last {price}, {pct} since {since}', { sym: sym, tf: tfLabel(tf.id), type: typeLabel[typeId], price: fmtPrice(ch.last), pct: pctTxt, since: since })]
        .concat(indText.length ? [__('kcSummaryInd', 'Indicators: {list}', { list: indText.join('; ') })] : [])
        .concat(cmpText.length ? [__('kcSummaryCmp', 'Compared: {list}', { list: cmpText.join('; ') })] : []).join('. ')
      : '';
    var badge = DFX && DFX.badge ? DFX.badge(React, props.theme, base) : null;
    var plotBusy = lib !== 'ready' || data.state === 'loading';
    var dataMsg = data.state === 'none' ? __('kcNoData', 'No price data for {sym}. Check the symbol (e.g. SAP.DE, AAPL, ^GDAXI).', { sym: sym })
      : data.state === 'error' ? __('kcLoadError', 'The prices could not be loaded. Check your Worker and the connection.') : '';

    var toolbar = e('div', { className: 'ui-ch-toolbar', role: 'toolbar', 'aria-label': __('kcToolbar', 'Chart settings') },
      e(UIC.Segmented, { 'data-testid': 'ch-type', size: 'sm', label: __('kcType', 'Chart type'), value: typeId,
        options: TYPES.map(function (t) { return { value: t.id, label: typeLabel[t.id], disabled: !ohlc && t.needsOhlc }; }),
        onChange: function (v) { update({ type: v }); } }),
      e(UIC.Segmented, { 'data-testid': 'ch-tf', size: 'sm', label: __('kcTimeframe', 'Timeframe'), value: tf.id,
        options: TIMEFRAMES.map(function (t) { return { value: t.id, label: tfLabel(t.id) }; }),
        onChange: function (v) { update({ timeframe: v }); } }),
      e(UIC.Segmented, { 'data-testid': 'ch-scale', size: 'sm', label: __('kcScale', 'Scale'), value: prefs.scale,
        options: [['linear', __('kcScaleLinear', 'Linear')], ['log', __('kcScaleLog', 'Log')], ['percent', __('kcScalePercent', '%')]].map(function (s) { return { value: s[0], label: s[1] }; }),
        onChange: function (v) { update({ scale: v }); } }),
      e('div', { className: 'ui-chips' },
        cur && cur !== 'EUR' ? e(UIC.Chip, { 'data-testid': 'ch-eur', pressed: !!prefs.eur, onClick: function () { update({ eur: !prefs.eur }); } }, __('kcInEur', 'In EUR')) : null,
        e(UIC.Chip, { 'data-testid': 'ch-volume', pressed: hasVol, onClick: function () { setIndicators(hasVol ? prefs.indicators.filter(function (x) { return x.id !== 'vol'; }) : prefs.indicators.concat([{ id: 'vol', params: [] }])); } }, __('kcVolume', 'Volume')),
        e(UIC.Button, { size: 'sm', 'data-testid': 'ch-ind-open', 'aria-haspopup': 'dialog', onClick: function () { setDlg('all'); } }, __('kcIndicators', 'Indicators'))),
      e('div', { className: 'ui-ch-cmp' },
        e('input', { 'data-testid': 'ch-cmp-input', list: 'ch-symbols', value: cmpDraft, className: ['ui-input', 'ui-ch-cmp__input'].join(' '), autoComplete: 'off',
          placeholder: __('kcComparePh', 'Compare with…'), 'aria-label': __('kcCompareWith', 'Compare with a symbol'), disabled: (prefs.compare || []).length >= MAX_COMPARE,
          onChange: function (ev) { setCmpDraft(ev.target.value); }, onKeyDown: function (ev) { if (ev.key === 'Enter') addCompare(); } }),
        e(UIC.Button, { size: 'sm', 'data-testid': 'ch-cmp-add', disabled: (prefs.compare || []).length >= MAX_COMPARE, onClick: function () { addCompare(); } }, __('kcCompareAdd', 'Compare'))));

    var title = data.state === 'ok' && shown.length
      ? e('span', { className: 'ui-ch-price' },
          e('b', { 'data-testid': 'ch-last', className: 'num' }, fmtPrice(ch.last)),
          pctTxt ? e('span', { 'data-testid': 'ch-change', className: ['num', 'tone-' + UIC.toneOf(ch.pct)].join(' ') }, pctTxt) : null,
          since ? e('span', { className: 'ui-muted' }, __('kcSince', 'since {date}', { date: since })) : null)
      : e('span', null, sym);

    return e('div', { 'data-testid': 'charts-view', className: 'ui-view' },
      e('div', { className: 'ui-view__bar' },
        e('h2', { className: 'ui-section-title' }, sym || __('kcTitle', 'Charts'), badge ? ' ' : null, badge),
        e('div', { className: 'ui-rs-pick' },
          e('input', { 'data-testid': 'ch-symbol', list: 'ch-symbols', value: draft, placeholder: __('kcSymbolPh', 'Symbol or name, e.g. SAP.DE'), 'aria-label': __('kcSymbol', 'Symbol'),
            className: ['ui-input', 'ui-rs-pick__input'].join(' '), autoComplete: 'off',
            onChange: function (ev) { setDraft(ev.target.value); }, onKeyDown: function (ev) { if (ev.key === 'Enter') open(); } }),
          e('datalist', { id: 'ch-symbols' }, found.map(function (f) { return e('option', { key: 'f' + f.symbol, value: f.symbol }, f.name); })
            .concat(picks.filter(function (s) { return !found.some(function (f) { return f.symbol === s; }); }).map(function (s) { return e('option', { key: s, value: s }); }))),
          e(UIC.Button, { variant: 'primary', 'data-testid': 'ch-go', onClick: function () { open(); } }, __('kcOpen', 'Open')))),
      bad ? e('p', { className: ['ui-callout', 'ui-callout--warn'].join(' '), role: 'alert' }, __('kcBadSymbol', '"{sym}" is not a market symbol.', { sym: bad })) : null,
      picks.length ? e('div', { className: ['ui-chips', 'ui-ch-picks'].join(' '), role: 'group', 'aria-label': __('kcYourSymbols', 'Your symbols') },
        picks.slice(0, 16).map(function (s) { return e(UIC.Chip, { key: s, 'data-testid': 'ch-pick', pressed: s === sym, onClick: function () { open(s); } }, s); })) : null,
      !base ? e(UIC.EmptyState, { title: __('kcTitle', 'Charts'), text: __('kcNeedWorker', 'Charts load prices through your own Worker (API Settings) or the shared price service.'), action: UI && UI.workerAction ? UI.workerAction() : null }) : null,
      base && !sym ? e(UIC.EmptyState, { title: __('kcTitle', 'Charts'), text: __('kcPick', 'Pick a symbol: one you hold, one on your watchlist, or search for any other.') }) : null,
      sym && base ? toolbar : null,
      sym && base ? active : null,
      dialog,
      sym && base ? e(UIC.ChartFrame, { 'data-testid': 'ch-chart-card', title: title, summary: summary || undefined, source: __('trustNoAdvice', 'No tax or investment advice — estimates only.'),
          legend: cmpCalc ? [{ series: '1', label: sym }].concat(cmpCalc.syms.map(function (c, i) { return { series: String(i + 2), label: c, value: fmtPct(cmpCalc.pct[i]) }; })) : null },
        lib === 'error' ? e(UIC.EmptyState, { kind: 'error', compact: true, testid: 'ch-lib-error', title: __('kcLibErrorTitle', 'The chart could not start'),
          text: __('kcLibError', 'The chart library did not load (offline, blocked or the CDN is down). The rest of the app works as usual.'),
          action: { label: __('kcRetry', 'Retry'), onClick: function () { setTries(tries + 1); } } }) : null,
        dataMsg ? e(UIC.EmptyState, { kind: data.state === 'error' ? 'error' : 'empty', compact: true, testid: 'ch-data-msg', text: dataMsg,
          action: data.state === 'error' ? { label: __('kcRetry', 'Retry'), onClick: function () { setTries(tries + 1); } } : null }) : null,
        lib !== 'error' && plotBusy ? e(UIC.Skeleton, { shape: 'chart', 'data-testid': 'ch-loading' }) : null,
        lib === 'ready' ? e('div', { ref: plotRef, 'data-testid': 'ch-plot', style: { height: plotHeight + 'px' }, className: ['ui-ch-plot', plotBusy || dataMsg ? 'is-idle' : ''].join(' ').trim() }) : null) : null,
      data.state === 'ok' && !ohlc ? e('p', { 'data-testid': 'ch-old-worker', className: ['ui-callout', 'ui-callout--warn'].join(' ') },
        __('kcOldWorker', 'Your Worker is older than 2026.10.15: redeploy it for candles. Line and area work already.')) : null,
      e('p', { className: 'sr-only', 'aria-live': 'polite', 'data-testid': 'ch-live' }, summary));
  }

  var api = {
    LIB: LIB, TIMEFRAMES: TIMEFRAMES, timeframe: timeframe, TYPES: TYPES, type: type, availableTypes: availableTypes, usableType: usableType,
    SCALES: SCALES, PREFS_KEY: PREFS_KEY, normalizePrefs: normalizePrefs, loadPrefs: loadPrefs, savePrefs: savePrefs,
    requestUrl: requestUrl, toKLine: toKLine, rangeChange: rangeChange, precision: precision, quickPicks: quickPicks, chartStyles: chartStyles,
    View: View
  };
  if (typeof window !== 'undefined') window.MaerminCharts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
