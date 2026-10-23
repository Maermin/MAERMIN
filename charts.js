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
  function normalizePrefs(raw) {
    var o = raw;
    if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch (e) { o = null; } }
    if (!o || typeof o !== 'object') o = {};
    var sym = typeof o.symbol === 'string' ? o.symbol.trim().toUpperCase() : '';
    return {
      symbol: sym && isMarket(sym) ? sym : '',
      type: type(o.type) ? o.type : 'candles',
      timeframe: TIMEFRAMES.some(function (t) { return t.id === o.timeframe; }) ? o.timeframe : '1D',
      scale: SCALES.some(function (s) { return s.id === o.scale; }) ? o.scale : 'linear',
      eur: o.eur === true,
      volume: o.volume !== false
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
    var plotRef = useRef(null), chartRef = useRef(null);
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
    var shown = useMemo(function () {
      if (data.state !== 'ok') return [];
      var bars = data.bars;
      if (eurOn) {
        var F = W.MaerminFxHistory;
        bars = CE.toEUR(bars, cur, function (amount, c, iso) { return F && F.txToEUR ? F.txToEUR(amount, c, iso, props.exchangeRate, props.fxAt) : null; });
      }
      return typeId === 'heikin' ? CE.heikinAshi(bars) : bars;
    }, [data, eurOn, typeId, props.exchangeRate]);
    var shownCur = eurOn ? 'EUR' : cur;

    // the chart: created once the library is there, disposed with the view
    useEffect(function () {
      if (lib !== 'ready' || !plotRef.current || chartRef.current) return;
      var K = W.klinecharts;
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

    // volume pane
    useEffect(function () {
      var chart = chartRef.current;
      if (!chart) return;
      var has = chart.getIndicators({ name: 'VOL' }).length > 0;
      if (prefs.volume && !has) chart.createIndicator({ name: 'VOL', calcParams: [] }, false, { id: 'ch_volume_pane', height: 90 });
      if (!prefs.volume && has) chart.removeIndicator({ name: 'VOL' });
    }, [lib, prefs.volume, sym && base ? 1 : 0]);

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
    var ch = rangeChange(shown);
    var fmtPrice = function (v) { return v == null ? '–' : I.num(v, precision(v)) + (shownCur ? ' ' + shownCur : ''); };
    var pctTxt = ch.pct == null ? '' : (ch.pct > 0 ? '+' : '') + I.num(ch.pct * 100, 2) + ' %';
    var since = shown.length ? I.date(new Date(shown[0].t * 1000).toISOString().slice(0, 10)) : '';
    var TF_LABEL = { '1m': __('kcTf1m', '1m'), '5m': __('kcTf5m', '5m'), '15m': __('kcTf15m', '15m'), '1h': __('kcTf1h', '1h'), '4h': __('kcTf4h', '4h'),
      '1D': __('kcTf1D', '1D'), '1W': __('kcTf1W', '1W'), '1M': __('kcTf1M', '1M') };
    var tfLabel = function (id) { return TF_LABEL[id] || id; };
    var typeLabel = { candles: __('kcTypeCandles', 'Candles'), ohlc: __('kcTypeOhlc', 'Bars'), heikin: __('kcTypeHeikin', 'Heikin Ashi'), line: __('kcTypeLine', 'Line'), area: __('kcTypeArea', 'Area') };
    var summary = data.state === 'ok' && shown.length
      ? __('kcSummary', '{sym}, {tf}, {type}: last {price}, {pct} since {since}', { sym: sym, tf: tfLabel(tf.id), type: typeLabel[typeId], price: fmtPrice(ch.last), pct: pctTxt, since: since })
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
        e(UIC.Chip, { 'data-testid': 'ch-volume', pressed: !!prefs.volume, onClick: function () { update({ volume: !prefs.volume }); } }, __('kcVolume', 'Volume'))));

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
      sym && base ? e(UIC.ChartFrame, { 'data-testid': 'ch-chart-card', title: title, summary: summary || undefined, source: __('trustNoAdvice', 'No tax or investment advice — estimates only.') },
        lib === 'error' ? e(UIC.EmptyState, { kind: 'error', compact: true, testid: 'ch-lib-error', title: __('kcLibErrorTitle', 'The chart could not start'),
          text: __('kcLibError', 'The chart library did not load (offline, blocked or the CDN is down). The rest of the app works as usual.'),
          action: { label: __('kcRetry', 'Retry'), onClick: function () { setTries(tries + 1); } } }) : null,
        dataMsg ? e(UIC.EmptyState, { kind: data.state === 'error' ? 'error' : 'empty', compact: true, testid: 'ch-data-msg', text: dataMsg,
          action: data.state === 'error' ? { label: __('kcRetry', 'Retry'), onClick: function () { setTries(tries + 1); } } : null }) : null,
        lib !== 'error' && plotBusy ? e(UIC.Skeleton, { shape: 'chart', 'data-testid': 'ch-loading' }) : null,
        lib === 'ready' ? e('div', { ref: plotRef, 'data-testid': 'ch-plot', className: ['ui-ch-plot', plotBusy || dataMsg ? 'is-idle' : ''].join(' ').trim() }) : null) : null,
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
