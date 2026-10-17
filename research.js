// ============================================================================
// MAERMIN — Research page per security  (window.MaerminResearch)
// ----------------------------------------------------------------------------
// P5-5.4. One page per symbol:
//   - key figures (valuation, financials), analyst ratings and price targets,
//     EPS actual vs estimate and the company profile - from the Worker's
//     `research` route (Yahoo Finance quoteSummary, market data only);
//   - a price chart (6 months, 1 or 5 years) with SMA 50/200, EMA 20,
//     Bollinger bands (20, 2) and MACD (12, 26, 9);
//   - the user's own position (FIFO ledger), dividends received, trades and
//     journal entries - computed here, never sent anywhere.
// Indicators skip missing closes. Not investment advice.
// Node-tested in test/research.test.js; the route in test/worker-research.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  var W = typeof window !== 'undefined' ? window : {};
  function req(f) { try { return f(); } catch (e) { return null; } }

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d || '').slice(0, 10); }

  // ---- indicators (arrays aligned with the input; null where undefined) ------------
  // Simple moving average over the last n valid closes.
  function sma(values, n) {
    var out = [], win = [], sum = 0;
    for (var i = 0; i < values.length; i++) {
      var x = values[i];
      if (!isNum(x)) { out.push(null); continue; }
      win.push(x); sum += x;
      if (win.length > n) sum -= win.shift();
      out.push(win.length === n ? sum / n : null);
    }
    return out;
  }
  // Exponential moving average, seeded with the SMA of the first n valid closes.
  function ema(values, n) {
    var out = [], k = 2 / (n + 1), prev = null, seen = 0, seed = 0;
    for (var i = 0; i < values.length; i++) {
      var x = values[i];
      if (!isNum(x)) { out.push(null); continue; }
      seen++;
      if (prev == null) {
        seed += x;
        if (seen === n) { prev = seed / n; out.push(prev); } else out.push(null);
        continue;
      }
      prev = x * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  }
  function macd(values, fast, slow, signal) {
    fast = fast || 12; slow = slow || 26; signal = signal || 9;
    var f = ema(values, fast), s = ema(values, slow);
    var line = values.map(function (_, i) { return f[i] != null && s[i] != null ? f[i] - s[i] : null; });
    var sig = ema(line, signal);
    return { macd: line, signal: sig, hist: line.map(function (m, i) { return m != null && sig[i] != null ? m - sig[i] : null; }) };
  }
  // Bollinger bands: SMA n ± k population standard deviations.
  function bollinger(values, n, k) {
    n = n || 20; k = k == null ? 2 : k;
    var mid = [], upper = [], lower = [], win = [];
    for (var i = 0; i < values.length; i++) {
      var x = values[i];
      if (!isNum(x)) { mid.push(null); upper.push(null); lower.push(null); continue; }
      win.push(x);
      if (win.length > n) win.shift();
      if (win.length < n) { mid.push(null); upper.push(null); lower.push(null); continue; }
      var m = win.reduce(function (a, b) { return a + b; }, 0) / n;
      var sd = Math.sqrt(win.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / n);
      mid.push(m); upper.push(m + k * sd); lower.push(m - k * sd);
    }
    return { mid: mid, upper: upper, lower: lower };
  }

  // ---- the user's own data ------------------------------------------------------------
  // opts: { priceEUR, exchangeRate, fxAt }
  function ownPosition(transactions, symbol, opts) {
    opts = opts || {};
    var sym = String(symbol || '').toUpperCase();
    var L = W.MaerminLedger || req(function () { return require('./ledger.js'); });
    var F = W.MaerminFxHistory || req(function () { return require('./fx-history.js'); });
    var mine = (transactions || []).filter(function (t) { return t && String(t.symbol || '').toUpperCase() === sym; });
    var trades = mine.filter(function (t) { return t.type === 'buy' || t.type === 'sell'; });
    if (!trades.length || !L) return null;
    var built = L.build(trades, { exchangeRate: opts.exchangeRate, fxAt: opts.fxAt });
    var qty = 0, cost = 0, realized = 0, since = null;
    built.list.forEach(function (g) {
      qty += g.openQty; cost += g.openCostEUR; realized += g.realizedGain;
      g.openLots.forEach(function (l) { var d = ymd(l.date); if (!since || d < since) since = d; });
    });
    var first = trades.map(function (t) { return ymd(t.date); }).sort()[0];
    var dividends = mine.filter(function (t) { return t.type === 'dividend'; }).reduce(function (a, t) {
      var gross = num(t.quantity) * num(t.price) || num(t.amount);
      return a + (F && F.txToEUR ? F.txToEUR(gross, t.currency, ymd(t.date), opts.exchangeRate, opts.fxAt).value : gross);
    }, 0);
    var value = isNum(opts.priceEUR) ? qty * opts.priceEUR : null;
    return { quantity: qty, costEUR: cost, avgCostEUR: qty > 0 ? cost / qty : null, valueEUR: value, gainEUR: value != null ? value - cost : null,
      gainPct: value != null && cost > 0 ? (value - cost) / cost : null, realizedEUR: realized, dividendsEUR: dividends, since: first || since,
      trades: trades.slice().sort(function (a, b) { return ymd(a.date) < ymd(b.date) ? 1 : -1; }).slice(0, 10).map(function (t) {
        return { date: ymd(t.date), type: t.type, quantity: num(t.quantity), price: num(t.price), currency: t.currency || 'EUR' };
      }) };
  }
  // Journal entries (maermin_journal: { 'category-symbol': { thesis, target, notes, reviews } }).
  function journalFor(journal, symbol) {
    var s = '-' + String(symbol || '').toLowerCase();
    return Object.keys(journal || {}).filter(function (k) { return k.slice(-s.length) === s; }).map(function (k) {
      var j = journal[k] || {};
      return { key: k, thesis: j.thesis || '', target: j.target || '', notes: j.notes || '', reviews: Array.isArray(j.reviews) ? j.reviews : [] };
    }).filter(function (j) { return j.thesis || j.target || j.notes || j.reviews.length; });
  }
  // Upside to the mean target, where the price sits in the target range, rating shares.
  function analystView(a, price) {
    if (!a || !(a.count > 0) || !isNum(a.targetMean)) return null;
    var t = (a.trend && a.trend[0]) || null;
    var total = t ? t.strongBuy + t.buy + t.hold + t.sell + t.strongSell : 0;
    var shares = t && total > 0 ? { strongBuy: t.strongBuy / total, buy: t.buy / total, hold: t.hold / total, sell: t.sell / total, strongSell: t.strongSell / total } : null;
    return { count: a.count, total: total, shares: shares, mean: a.recommendationMean, key: a.recommendationKey,
      upside: isNum(price) && price > 0 ? a.targetMean / price - 1 : null,
      pricePos: isNum(price) && isNum(a.targetLow) && isNum(a.targetHigh) && a.targetHigh > a.targetLow ? Math.min(1, Math.max(0, (price - a.targetLow) / (a.targetHigh - a.targetLow))) : null,
      targetMean: a.targetMean, targetLow: a.targetLow, targetHigh: a.targetHigh };
  }
  function epsSurprises(list) {
    return (list || []).filter(function (q) { return isNum(q.actual) && isNum(q.estimate); }).map(function (q) {
      return { quarter: q.quarter, actual: q.actual, estimate: q.estimate, beat: q.actual >= q.estimate, surprise: q.estimate !== 0 ? (q.actual - q.estimate) / Math.abs(q.estimate) : null };
    });
  }

  // ---- chart ---------------------------------------------------------------------------
  function Chart(props) {
    var React = W.React, e = React.createElement;
    var th = props.theme || {}, pts = props.points || [], on = props.on || {};
    if (pts.length < 2) return e('div', { style: { color: th.textSecondary, fontSize: 'var(--text-sm)', padding: '1rem 0' } }, __('rsNoChart', 'No price history for this range.'));
    var closes = pts.map(function (p) { return p.price; });
    var lines = [{ id: 'close', v: closes, c: th.accent || '#8b7cff', w: 1.6 }];
    if (on.sma50) lines.push({ id: 'sma50', v: sma(closes, 50), c: '#f59e0b', w: 1.2 });
    if (on.sma200) lines.push({ id: 'sma200', v: sma(closes, 200), c: '#ef4444', w: 1.2 });
    if (on.ema20) lines.push({ id: 'ema20', v: ema(closes, 20), c: '#22c55e', w: 1.2 });
    var bb = on.bb ? bollinger(closes, 20, 2) : null;
    var narrow = W.matchMedia && W.matchMedia('(max-width: 640px)').matches;
    var Wd = narrow ? 420 : 760, H = narrow ? 240 : 260, padL = 8, padR = 52, padT = 8, padB = 18;
    var all = [];
    lines.forEach(function (l) { l.v.forEach(function (x) { if (isNum(x)) all.push(x); }); });
    if (bb) bb.upper.concat(bb.lower).forEach(function (x) { if (isNum(x)) all.push(x); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (hi === lo) { hi += 1; lo -= 1; }
    var X = function (i) { return padL + i * (Wd - padL - padR) / (pts.length - 1); };
    var Y = function (v) { return padT + (hi - v) * (H - padT - padB) / (hi - lo); };
    var path = function (arr) {
      var d = '', pen = false;
      arr.forEach(function (v, i) { if (!isNum(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; });
      return d;
    };
    var parts = [];
    if (bb) {
      var up = [], dn = [];
      bb.upper.forEach(function (v, i) { if (isNum(v)) { up.push(X(i).toFixed(1) + ',' + Y(v).toFixed(1)); dn.unshift(X(i).toFixed(1) + ',' + Y(bb.lower[i]).toFixed(1)); } });
      if (up.length) parts.push(e('polygon', { key: 'bb', points: up.concat(dn).join(' '), fill: th.accent || '#8b7cff', opacity: 0.1 }));
      parts.push(e('path', { key: 'bbm', d: path(bb.mid), stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 3', fill: 'none' }));
    }
    lines.forEach(function (l) { parts.push(e('path', { key: l.id, d: path(l.v), stroke: l.c, strokeWidth: l.w, fill: 'none' })); });
    [hi, (hi + lo) / 2, lo].forEach(function (v, i) {
      parts.push(e('text', { key: 'y' + i, x: Wd - padR + 6, y: Y(v) + 4, fontSize: 10, fill: th.textSecondary || '#9aa4b2' }, (W.MaerminI18n ? W.MaerminI18n.num(v, v < 10 ? 2 : 0) : v.toFixed(2))));
    });
    parts.push(e('text', { key: 'x0', x: padL, y: H - 4, fontSize: 10, fill: th.textSecondary || '#9aa4b2' }, W.MaerminI18n ? W.MaerminI18n.date(pts[0].date) : pts[0].date));
    parts.push(e('text', { key: 'x1', x: Wd - padR, y: H - 4, fontSize: 10, textAnchor: 'end', fill: th.textSecondary || '#9aa4b2' }, W.MaerminI18n ? W.MaerminI18n.date(pts[pts.length - 1].date) : pts[pts.length - 1].date));
    var main = e('svg', { key: 'main', 'data-testid': 'rs-chart', viewBox: '0 0 ' + Wd + ' ' + H, role: 'img', 'aria-label': __('rsChartLabel', 'Price chart'), style: { width: '100%', height: 'auto', display: 'block' } }, parts);
    if (!on.macd) return main;
    var m = macd(closes), mh = 90, vals = [];
    m.macd.concat(m.signal).concat(m.hist).forEach(function (x) { if (isNum(x)) vals.push(Math.abs(x)); });
    var mx = Math.max.apply(null, vals.concat([1e-9]));
    var MY = function (v) { return mh / 2 - v * (mh / 2 - 6) / mx; };
    var mp = function (arr) { var d = '', pen = false; arr.forEach(function (v, i) { if (!isNum(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + MY(v).toFixed(1); pen = true; }); return d; };
    var bars = m.hist.map(function (v, i) { return isNum(v) ? e('rect', { key: 'h' + i, x: X(i) - 0.8, y: Math.min(MY(v), mh / 2), width: 1.6, height: Math.abs(MY(v) - mh / 2), fill: v >= 0 ? '#22c55e' : '#ef4444', opacity: 0.6 }) : null; });
    var sub = e('svg', { key: 'macd', 'data-testid': 'rs-macd', viewBox: '0 0 ' + Wd + ' ' + mh, role: 'img', 'aria-label': 'MACD', style: { width: '100%', height: 'auto', display: 'block', marginTop: '0.3rem' } },
      bars, e('path', { d: mp(m.macd), stroke: th.accent || '#8b7cff', strokeWidth: 1.2, fill: 'none' }), e('path', { d: mp(m.signal), stroke: '#f59e0b', strokeWidth: 1.2, fill: 'none' }),
      e('text', { x: padL, y: 12, fontSize: 10, fill: th.textSecondary || '#9aa4b2' }, __('rsMacdLabel', 'MACD (12, 26, 9)')));
    return e('div', null, main, sub);
  }

  // ---- view ------------------------------------------------------------------------------
  // props: { theme, transactions, symbol, onSymbol, workerUrl, exchangeRate, fxAt, positions (pricedPositions), symbols, privacy }
  function View(props) {
    var React = W.React;
    if (!React) return null;
    var e = React.createElement, useState = React.useState, useEffect = React.useEffect;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', bad = th.danger || '#ef4444', warn = th.warning || '#f59e0b';
    var I = W.MaerminI18n;
    var sym = String(props.symbol || '').toUpperCase();
    var s0 = useState(sym); var draft = s0[0], setDraft = s0[1];
    var s1 = useState({ state: 'idle' }); var data = s1[0], setData = s1[1];
    var s2 = useState('1y'); var range = s2[0], setRange = s2[1];
    var s3 = useState({ state: 'idle', points: [] }); var series = s3[0], setSeries = s3[1];
    var s4 = useState({ sma50: true, sma200: false, ema20: false, bb: false, macd: false }); var on = s4[0], setOn = s4[1];
    var base = String(props.workerUrl || '').replace(/\/+$/, '');
    useEffect(function () { setDraft(sym); }, [sym]);
    useEffect(function () {
      if (!sym || !base) { setData({ state: 'idle' }); return; }
      var dead = false;
      setData({ state: 'loading' });
      fetch(base + '/?action=research&symbol=' + encodeURIComponent(sym)).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
        .then(function (r) { if (dead) return; setData(r.status === 200 && r.j && !r.j.error ? { state: 'ok', d: r.j } : { state: r.status === 400 && /action/i.test(JSON.stringify(r.j)) ? 'old' : 'none' }); })
        .catch(function () { if (!dead) setData({ state: 'error' }); });
      return function () { dead = true; };
    }, [sym, base]);
    useEffect(function () {
      if (!sym || !base) { setSeries({ state: 'idle', points: [] }); return; }
      var dead = false;
      setSeries({ state: 'loading', points: [] });
      fetch(base + '/?action=yf&symbol=' + encodeURIComponent(sym) + '&interval=1d&range=' + range).then(function (r) { return r.json(); })
        .then(function (j) { if (!dead) setSeries({ state: 'ok', points: (j && Array.isArray(j.prices) ? j.prices : []).filter(function (p) { return isNum(p.price); }) }); })
        .catch(function () { if (!dead) setSeries({ state: 'error', points: [] }); });
      return function () { dead = true; };
    }, [sym, base, range]);

    var card = { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem 1.25rem', marginBottom: '1rem' };
    var input = { boxSizing: 'border-box', padding: '0.45rem 0.6rem', background: th.inputBg, border: '1px solid ' + (th.inputBorder || border), borderRadius: '8px', color: text, fontSize: '0.85rem', fontFamily: 'inherit' };
    var btn = function (active) { return { padding: '0.35rem 0.7rem', borderRadius: '8px', border: '1px solid ' + (active ? (th.accent || '#8b7cff') : border), background: active ? (th.accentFill || th.accent || '#8b7cff') : th.inputBg, color: active ? '#fff' : text, cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600 }; };
    var h3 = function (t) { return e('h3', { style: { color: text, fontSize: 'var(--text-body)', fontWeight: 700, margin: '0 0 0.6rem' } }, t); };
    var d = data.state === 'ok' ? data.d : null;
    var cur = d && d.currency ? d.currency : '';
    var priceTxt = function (v) { return v == null ? '–' : I.num(v, 2) + (cur ? ' ' + cur : ''); };
    var pct = function (v, sign) { return v == null ? '–' : (sign && v > 0 ? '+' : '') + I.num(v * 100, 1) + ' %'; };
    var big = function (v) { if (v == null) return '–'; var a = Math.abs(v); return a >= 1e12 ? I.num(v / 1e12, 2) + ' T' : a >= 1e9 ? I.num(v / 1e9, 2) + ' B' : a >= 1e6 ? I.num(v / 1e6, 1) + ' M' : I.num(v, 0); };
    var cell = function (lbl, val, tid) { return e('div', { key: lbl, 'data-testid': tid, style: { padding: '0.45rem 0', borderTop: '1px solid ' + border } }, e('div', { style: { color: dim, fontSize: 'var(--text-xs)' } }, lbl), e('div', { style: { color: text, fontWeight: 700, fontSize: 'var(--text-base)' } }, val)); };
    var grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', columnGap: '1rem' };

    // own data
    var held = (props.positions || []).filter(function (p) { return String(p.symbol || '').toUpperCase() === sym; })[0];
    var pos0 = sym ? ownPosition(props.transactions, sym, { exchangeRate: props.exchangeRate, fxAt: props.fxAt }) : null;
    var pos = pos0 && held && pos0.quantity > 0 ? ownPosition(props.transactions, sym, { exchangeRate: props.exchangeRate, fxAt: props.fxAt, priceEUR: held.valueEUR / pos0.quantity }) : pos0;
    var journal = (function () { try { return journalFor(JSON.parse(localStorage.getItem('maermin_journal') || '{}'), sym); } catch (err) { return []; } })();
    var money = function (v) { return v == null ? '–' : props.privacy ? '••••' : I.money(v, 'EUR'); };
    var av = d ? analystView(d.analysts, d.price) : null;
    var eps = d ? epsSurprises(d.earnings) : [];
    var lastClose = series.points.length ? series.points[series.points.length - 1].price : null;

    var go = function () { var s = draft.trim().toUpperCase(); if (s && props.onSymbol) props.onSymbol(s); };
    return e('div', { 'data-testid': 'research-view', style: { padding: '1.5rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' } },
        e('h2', { style: { color: text, fontSize: 'var(--text-xl)', fontWeight: 700, margin: 0 } }, d ? d.name + ' · ' + sym : (sym || __('rsTitle', 'Research'))),
        e('div', { style: { display: 'flex', gap: '0.4rem' } },
          e('input', { 'data-testid': 'rs-symbol', list: 'rs-symbols', value: draft, placeholder: __('rsSymbolPh', 'Symbol, e.g. AAPL or SAP.DE'), 'aria-label': __('rsSymbol', 'Symbol'), style: Object.assign({}, input, { width: '220px' }),
            onChange: function (ev) { setDraft(ev.target.value); }, onKeyDown: function (ev) { if (ev.key === 'Enter') go(); } }),
          e('datalist', { id: 'rs-symbols' }, (props.symbols || []).map(function (s) { return e('option', { key: s, value: s }); })),
          e('button', { 'data-testid': 'rs-go', style: btn(true), onClick: go }, __('rsOpen', 'Open')))),
      !base ? e('div', { style: Object.assign({}, card, { color: warn, fontSize: '0.82rem' }) }, __('rsNeedWorker', 'The research page loads market data through your own Worker (API Settings) or the shared price service.')) : null,
      !sym ? e('div', { style: Object.assign({}, card, { color: dim, fontSize: '0.85rem' }) }, __('rsPick', 'Pick a symbol: one you hold, one on your watchlist, or any other.')) : null,
      sym && base ? e('div', { style: card },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' } },
          e('div', { 'data-testid': 'rs-price', style: { color: text, fontSize: 'var(--text-title-lg)', fontWeight: 800 } }, priceTxt(d && d.price != null ? d.price : lastClose)),
          e('div', { style: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap' } },
            ['6mo', '1y', '5y'].map(function (r) { return e('button', { key: r, style: btn(range === r), onClick: function () { setRange(r); } }, r === '6mo' ? __('rs6m', '6 M') : r === '1y' ? __('rs1y', '1 Y') : __('rs5y', '5 Y')); }))),
        series.state === 'loading' ? e('div', { style: { color: dim, fontSize: 'var(--text-sm)' } }, __('rsLoading', 'Loading…')) : e(Chart, { points: series.points, theme: th, on: on }),
        e('div', { style: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.5rem' } },
          [['sma50', __('rsSma50', 'SMA 50')], ['sma200', __('rsSma200', 'SMA 200')], ['ema20', __('rsEma20', 'EMA 20')], ['bb', __('rsBollinger', 'Bollinger (20, 2)')], ['macd', 'MACD']].map(function (x) {
            return e('button', { key: x[0], 'data-testid': 'rs-ind-' + x[0], 'aria-pressed': on[x[0]] ? 'true' : 'false', style: btn(!!on[x[0]]), onClick: function () { var n = Object.assign({}, on); n[x[0]] = !n[x[0]]; setOn(n); } }, x[1]);
          }))) : null,
      data.state === 'loading' ? e('div', { style: { color: dim, fontSize: 'var(--text-sm)', marginBottom: '1rem' } }, __('rsLoading', 'Loading…')) : null,
      data.state === 'old' ? e('div', { style: Object.assign({}, card, { color: warn, fontSize: '0.8rem' }) }, __('rsOldWorker', 'Your Worker is older than 2026.10.12: redeploy it for key figures and analyst data. The chart works already.')) : null,
      data.state === 'none' ? e('div', { style: Object.assign({}, card, { color: dim, fontSize: '0.8rem' }) }, __('rsNoData', 'No key figures for this symbol (funds, crypto and some exchanges have none).')) : null,
      pos ? e('div', { 'data-testid': 'rs-position', style: card }, h3(__('rsYourPosition', 'Your position')),
        e('div', { style: grid },
          cell(__('rsQty', 'Quantity'), props.privacy ? '••••' : I.num(pos.quantity, 4)),
          cell(__('rsAvgCost', 'Average cost'), money(pos.avgCostEUR)),
          cell(__('rsValue', 'Value'), money(pos.valueEUR)),
          cell(__('rsGain', 'Unrealised'), e('span', { style: { color: pos.gainEUR == null ? text : pos.gainEUR >= 0 ? good : bad } }, money(pos.gainEUR) + (pos.gainPct != null ? ' (' + pct(pos.gainPct, true) + ')' : ''))),
          cell(__('rsRealized', 'Realised'), money(pos.realizedEUR)),
          cell(__('rsDividends', 'Dividends received'), money(pos.dividendsEUR)),
          cell(__('rsSince', 'First buy'), pos.since ? I.date(pos.since) : '–')),
        pos.trades.length ? e('div', { style: { marginTop: '0.5rem', fontSize: 'var(--text-xs)', color: dim } }, pos.trades.slice(0, 5).map(function (t, i) {
          return e('div', { key: i }, I.date(t.date) + ' · ' + (t.type === 'buy' ? __('rsBuy', 'Buy') : __('rsSell', 'Sell')) + ' ' + (props.privacy ? '••' : I.num(t.quantity, 4) + ' × ' + I.num(t.price, 2) + ' ' + t.currency));
        })) : null) : null,
      journal.length ? e('div', { 'data-testid': 'rs-journal', style: card }, h3(__('rsJournal', 'Your journal')),
        journal.map(function (j) {
          return e('div', { key: j.key, style: { fontSize: 'var(--text-sm)', color: text, lineHeight: 1.5 } },
            j.thesis ? e('div', null, e('b', null, __('rsThesis', 'Thesis') + ': '), j.thesis) : null,
            j.target ? e('div', null, e('b', null, __('rsTarget', 'Target') + ': '), j.target) : null,
            j.notes ? e('div', null, j.notes) : null,
            j.reviews.slice(0, 3).map(function (r, i) { return e('div', { key: i, style: { color: dim } }, I.date(r.date) + ' · ' + r.text); }));
        })) : null,
      d ? e('div', { 'data-testid': 'rs-figures', style: card }, h3(__('rsKeyFigures', 'Key figures')),
        e('div', { style: grid },
          cell(__('rsMarketCap', 'Market cap'), big(d.valuation.marketCap) + (cur ? ' ' + cur : '')),
          cell(__('rsPe', 'P/E (trailing)'), d.valuation.trailingPE == null ? '–' : I.num(d.valuation.trailingPE, 1)),
          cell(__('rsFwdPe', 'P/E (forward)'), d.valuation.forwardPE == null ? '–' : I.num(d.valuation.forwardPE, 1)),
          cell('PEG', d.valuation.peg == null ? '–' : I.num(d.valuation.peg, 2)),
          cell(__('rsPb', 'Price / book'), d.valuation.priceToBook == null ? '–' : I.num(d.valuation.priceToBook, 1)),
          cell(__('rsPs', 'Price / sales'), d.valuation.priceToSales == null ? '–' : I.num(d.valuation.priceToSales, 1)),
          cell('Beta', d.valuation.beta == null ? '–' : I.num(d.valuation.beta, 2)),
          cell(__('rs52w', '52-week range'), d.valuation.low52 == null ? '–' : I.num(d.valuation.low52, 2) + ' – ' + I.num(d.valuation.high52, 2)),
          cell(__('rsDivYield', 'Dividend yield'), pct(d.valuation.dividendYield)),
          cell(__('rsPayout', 'Payout ratio'), pct(d.valuation.payoutRatio)),
          cell(__('rsRevenue', 'Revenue'), big(d.financials.revenue)),
          cell(__('rsRevGrowth', 'Revenue growth'), pct(d.financials.revenueGrowth, true)),
          cell(__('rsGrossMargin', 'Gross margin'), pct(d.financials.grossMargins)),
          cell(__('rsOpMargin', 'Operating margin'), pct(d.financials.operatingMargins)),
          cell(__('rsNetMargin', 'Net margin'), pct(d.financials.profitMargins)),
          cell('ROE', pct(d.financials.returnOnEquity)),
          cell(__('rsDebtEquity', 'Debt / equity'), d.financials.debtToEquity == null ? '–' : I.num(d.financials.debtToEquity / 100, 2)),
          cell(__('rsFcf', 'Free cash flow'), big(d.financials.freeCashflow)))) : null,
      av ? e('div', { 'data-testid': 'rs-analysts', style: card }, h3(__('rsAnalysts', 'Analysts')),
        e('div', { style: { color: dim, fontSize: 'var(--text-sm)', marginBottom: '0.5rem' } }, __('rsAnalystsLine', '{n} analysts · mean target {t} · {u} from today\'s price', { n: av.count, t: priceTxt(av.targetMean), u: pct(av.upside, true) })),
        av.shares ? e('div', { style: { display: 'flex', height: '14px', borderRadius: '7px', overflow: 'hidden', marginBottom: '0.3rem' } },
          [['strongBuy', '#16a34a'], ['buy', '#22c55e'], ['hold', '#f59e0b'], ['sell', '#f97316'], ['strongSell', '#ef4444']].map(function (x) { return e('div', { key: x[0], title: x[0], style: { width: (av.shares[x[0]] * 100) + '%', background: x[1] } }); })) : null,
        av.shares ? e('div', { style: { display: 'flex', justifyContent: 'space-between', color: dim, fontSize: 'var(--text-xs)', flexWrap: 'wrap', gap: '0.4rem' } },
          e('span', null, __('rsBuyShare', 'Buy {p}', { p: pct(av.shares.strongBuy + av.shares.buy) })), e('span', null, __('rsHoldShare', 'Hold {p}', { p: pct(av.shares.hold) })), e('span', null, __('rsSellShare', 'Sell {p}', { p: pct(av.shares.sell + av.shares.strongSell) }))) : null,
        av.pricePos != null ? e('div', { style: { marginTop: '0.7rem' } },
          e('div', { style: { position: 'relative', height: '6px', background: th.inputBg || 'rgba(255,255,255,0.08)', borderRadius: '3px' } },
            e('div', { title: __('rsToday', 'Today'), style: { position: 'absolute', left: 'calc(' + (av.pricePos * 100) + '% - 5px)', top: '-4px', width: '10px', height: '14px', borderRadius: '3px', background: th.accent || '#8b7cff' } })),
          e('div', { style: { display: 'flex', justifyContent: 'space-between', color: dim, fontSize: 'var(--text-xs)', marginTop: '0.3rem' } },
            e('span', null, __('rsLow', 'Low {v}', { v: priceTxt(av.targetLow) })), e('span', null, __('rsHigh', 'High {v}', { v: priceTxt(av.targetHigh) })))) : null) : null,
      eps.length ? e('div', { 'data-testid': 'rs-eps', style: card }, h3(__('rsEps', 'Earnings per share: actual vs estimate')),
        eps.map(function (q) {
          return e('div', { key: q.quarter, style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', borderTop: '1px solid ' + border, padding: '0.3rem 0', fontSize: 'var(--text-sm)' } },
            e('span', { style: { color: dim, minWidth: '4.5rem' } }, q.quarter),
            e('span', { style: { color: text } }, I.num(q.actual, 2) + ' / ' + I.num(q.estimate, 2)),
            e('span', { style: { color: q.beat ? good : bad, fontWeight: 700 } }, (q.beat ? __('rsBeat', 'beat') : __('rsMiss', 'miss')) + ' ' + pct(q.surprise, true)));
        })) : null,
      d && (d.profile.summary || d.profile.sector) ? e('div', { 'data-testid': 'rs-profile', style: card }, h3(__('rsProfile', 'Company')),
        e('div', { style: { color: dim, fontSize: 'var(--text-xs)', marginBottom: '0.4rem' } }, [d.profile.sector, d.profile.industry, d.profile.country].filter(Boolean).join(' · ')),
        d.profile.summary ? e('p', { style: { color: text, fontSize: 'var(--text-sm)', lineHeight: 1.55, margin: 0 } }, d.profile.summary) : null) : null,
      d ? e('div', { style: { color: dim, fontSize: 'var(--text-2xs)', lineHeight: 1.5 } },
        __('rsSource', 'Market data: {src} through your Worker, cached up to 6 hours, for personal use. Your position and journal are computed on this device. Not investment advice.', { src: d.source || 'Yahoo Finance' })) : null);
  }

  var api = { sma: sma, ema: ema, macd: macd, bollinger: bollinger, ownPosition: ownPosition, journalFor: journalFor, analystView: analystView, epsSurprises: epsSurprises, Chart: Chart, View: View };
  if (typeof window !== 'undefined') window.MaerminResearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
