// ============================================================================
// MAERMIN — Allocation backtester  (window.MaerminBacktester)
// ----------------------------------------------------------------------------
// Feature: "what would 10,000 EUR in THIS allocation have become since X" -
// backtest a freely defined target allocation against real price history,
// with optional periodic rebalancing, and compare it against the existing
// benchmark presets and the actual portfolio. The DCA analyzer covers savings
// plans; this is the general allocation what-if that lifts MAERMIN above pure
// trackers.
//
// NO new quant engine: CAGR, drawdown, volatility and return conversion come
// from MaerminAnalytics (single source of truth); price history arrives over
// the EXISTING Worker yf route (the same endpoint the benchmark and factor
// panels use); series alignment follows the same common-tail convention as
// MaerminAnalyticsData. This module owns only the portfolio SIMULATION:
// holding units, rebalancing them on a period grid, and reading the metrics
// off the resulting path.
//
// Pure layer (normalizeWeights, alignSeries, backtest, summarize) is
// dual-exported and Node-tested (test/backtester.test.js); the Panel folds
// into the existing Monte-Carlo analytics tab below the planning simulator -
// no new tab. Nothing is persisted.
// ============================================================================
(function () {
  'use strict';

  function analytics() {
    if (typeof window !== 'undefined' && window.MaerminAnalytics) return window.MaerminAnalytics;
    if (typeof require === 'function') { try { return require('./portfolio-analytics.js'); } catch (e) { /* fall through */ } }
    return null;
  }

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  // Rebalancing grids in trading periods (daily series, 252 per year).
  var REBALANCE_EVERY = { none: 0, monthly: 21, quarterly: 63, yearly: 252 };

  // Normalise arbitrary weight inputs to fractions summing to 1; non-positive
  // or junk weights drop their asset. → [{symbol, weight}] | null when empty.
  function normalizeWeights(rows) {
    var clean = (rows || []).map(function (r) {
      return { symbol: String((r && r.symbol) || '').toUpperCase(), weight: num(r && r.weight) };
    }).filter(function (r) { return r.symbol && r.weight != null && r.weight > 0; });
    var total = clean.reduce(function (s, r) { return s + r.weight; }, 0);
    if (!clean.length || total <= 0) return null;
    return clean.map(function (r) { return { symbol: r.symbol, weight: r.weight / total }; });
  }

  // Tail-align N price series to their common length (most recent overlap, the
  // MaerminAnalyticsData convention). → array of equal-length arrays | null.
  function alignSeries(seriesList) {
    var list = (seriesList || []).filter(Array.isArray);
    if (!list.length || list.length !== (seriesList || []).length) return null;
    var n = Math.min.apply(null, list.map(function (s) { return s.length; }));
    if (n < 2) return null;
    return list.map(function (s) { return s.slice(s.length - n); });
  }

  // Core simulation. weights: normalised fractions; seriesList: aligned price
  // series in the SAME order; opts.rebalance: 'none'|'monthly'|'quarterly'|
  // 'yearly'; opts.initial: starting capital (default 10000).
  // Buys units at the first price, then either holds them (none) or resets to
  // the target weights on the period grid. → { path:[values], rebalances }.
  function backtest(weights, seriesList, opts) {
    opts = opts || {};
    var initial = num(opts.initial) || 10000;
    var every = REBALANCE_EVERY[opts.rebalance || 'none'] || 0;
    if (!weights || !seriesList || weights.length !== seriesList.length) return null;
    var aligned = alignSeries(seriesList);
    if (!aligned) return null;
    var n = aligned[0].length;
    // Validate prices once: a non-positive price anywhere poisons the units math.
    for (var a = 0; a < aligned.length; a++) {
      for (var i = 0; i < n; i++) { if (!(num(aligned[a][i]) > 0)) return null; }
    }
    var units = weights.map(function (w, idx) { return (initial * w.weight) / aligned[idx][0]; });
    var path = [];
    var rebalances = 0;
    for (var p = 0; p < n; p++) {
      var value = 0;
      for (var s = 0; s < aligned.length; s++) value += units[s] * aligned[s][p];
      path.push(value);
      if (every > 0 && p > 0 && p < n - 1 && p % every === 0) {
        for (var s2 = 0; s2 < aligned.length; s2++) units[s2] = (value * weights[s2].weight) / aligned[s2][p];
        rebalances++;
      }
    }
    return { path: path, rebalances: rebalances, periods: n };
  }

  // Metrics off a value path — all reused from MaerminAnalytics.
  function summarize(path, opts) {
    var A = analytics();
    opts = opts || {};
    var ppy = opts.periodsPerYear || 252;
    if (!A || !path || path.length < 2) return null;
    var years = (path.length - 1) / ppy;
    var returns = A.toReturns(path);
    return {
      startValue: path[0],
      endValue: path[path.length - 1],
      totalReturn: path[path.length - 1] / path[0] - 1,
      cagr: A.cagr(path[0], path[path.length - 1], years),
      // MaerminAnalytics reports the drawdown signed (negative); the UI and
      // comparisons want the magnitude.
      maxDrawdown: Math.abs(A.maxDrawdown(path).maxDrawdown),
      volatility: A.annualizedVol ? A.annualizedVol(returns, ppy) : A.stdSample(returns) * Math.sqrt(ppy),
      years: years,
      periods: path.length
    };
  }

  // One-call pipeline for a strategy: weights in, path + metrics out.
  function run(rows, seriesBySymbol, opts) {
    var weights = normalizeWeights(rows);
    if (!weights) return { ok: false, error: 'no valid allocation' };
    var seriesList = weights.map(function (w) { return (seriesBySymbol || {})[w.symbol]; });
    if (seriesList.some(function (s) { return !Array.isArray(s) || s.length < 2; })) {
      return { ok: false, error: 'missing history for ' + weights.filter(function (w, i) { return !Array.isArray(seriesList[i]) || seriesList[i].length < 2; }).map(function (w) { return w.symbol; }).join(', ') };
    }
    var bt = backtest(weights, seriesList, opts);
    if (!bt) return { ok: false, error: 'series could not be aligned' };
    var metrics = summarize(bt.path, opts);
    return { ok: true, weights: weights, path: bt.path, rebalances: bt.rebalances, metrics: metrics };
  }

  // ---- React Panel (browser only; folds into the Monte-Carlo tab) -----------
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var accent = theme.accent || '#f5a524', good = theme.success || '#22c55e', bad = theme.danger || '#ef4444';
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');
    var fmt = props.formatPrice || function (v) { return Number(v || 0).toFixed(2); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '€';
    var A = (typeof window !== 'undefined') && window.MaerminAnalytics;
    var D = (typeof window !== 'undefined') && window.MaerminAnalyticsData;

    var sRows = React.useState([{ symbol: 'URTH', weight: '70' }, { symbol: '^NDX', weight: '30' }]);
    var rows = sRows[0], setRows = sRows[1];
    var sRange = React.useState('5y'); var range = sRange[0], setRange = sRange[1];
    var sRebal = React.useState('yearly'); var rebal = sRebal[0], setRebal = sRebal[1];
    var sInitial = React.useState('10000'); var initial = sInitial[0], setInitial = sInitial[1];
    var sBench = React.useState('msci_world'); var bench = sBench[0], setBench = sBench[1];
    var sBusy = React.useState(false); var busy = sBusy[0], setBusy = sBusy[1];
    var sOut = React.useState(null); var out = sOut[0], setOut = sOut[1];

    function setRow(i, field, value) {
      setRows(function (prev) {
        var next = prev.map(function (r) { return { symbol: r.symbol, weight: r.weight }; });
        next[i][field] = field === 'symbol' ? value.toUpperCase() : value;
        return next;
      });
    }
    function addRow() { setRows(function (prev) { return prev.concat([{ symbol: '', weight: '' }]); }); }
    function removeRow(i) { setRows(function (prev) { return prev.filter(function (_, idx) { return idx !== i; }); }); }

    function fetchSeries(symbol) {
      var url = workerBase + '?action=yf&symbol=' + encodeURIComponent(symbol) + '&interval=1d&range=' + encodeURIComponent(range);
      return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || j.error || !Array.isArray(j.prices)) throw new Error((j && j.error) || ('no data for ' + symbol));
        return (D && D.pricesOf) ? D.pricesOf(j.prices) : j.prices.map(function (p) { return p.price; });
      });
    }

    function runBacktest() {
      var weights = normalizeWeights(rows);
      if (!weights) { setOut({ error: 'Enter at least one symbol with a positive weight.' }); return; }
      if (!workerBase) { setOut({ error: 'Add a Worker URL in API Settings to load price history.' }); return; }
      setBusy(true); setOut(null);
      var preset = ((A && A.BENCHMARKS) || []).filter(function (b) { return b.key === bench; })[0];
      var symbols = weights.map(function (w) { return w.symbol; });
      var all = symbols.concat(preset ? [preset.proxy] : []);
      Promise.all(all.map(fetchSeries)).then(function (series) {
        var bySymbol = {};
        symbols.forEach(function (s, i) { bySymbol[s] = series[i]; });
        var opts = { rebalance: rebal, initial: parseFloat(initial) || 10000, periodsPerYear: 252 };
        var strategy = run(rows, bySymbol, opts);
        if (!strategy.ok) { setOut({ error: strategy.error }); setBusy(false); return; }
        var result = { strategy: strategy, benchmark: null, actual: null, preset: preset };
        if (preset) {
          var benchRun = run([{ symbol: preset.proxy, weight: 1 }], (function () { var m = {}; m[preset.proxy.toUpperCase()] = series[series.length - 1]; return m; })(), opts);
          if (benchRun.ok) result.benchmark = benchRun;
        }
        // The actual portfolio path, rescaled to the same starting capital, so
        // the three lines are directly comparable.
        if (D && props.portfolio && props.priceHistory) {
          var actualPath = D.buildValueSeries(props.portfolio, props.priceHistory);
          if (actualPath && actualPath.length >= 2 && actualPath[0] > 0) {
            var scale = (parseFloat(initial) || 10000) / actualPath[0];
            var scaled = actualPath.map(function (v) { return v * scale; });
            result.actual = { path: scaled, metrics: summarize(scaled, { periodsPerYear: 252 }) };
          }
        }
        setOut(result); setBusy(false);
      }).catch(function (ex) {
        setOut({ error: (ex && ex.message) || 'Fetch failed' }); setBusy(false);
      });
    }

    function sparkline(values, color) {
      if (!values || values.length < 2) return null;
      var w = 240, h = 40;
      var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
      var span = (max - min) || 1;
      var pts = values.map(function (v, i) {
        return ((i / (values.length - 1)) * w).toFixed(1) + ',' + (h - ((v - min) / span) * h).toFixed(1);
      }).join(' ');
      return e('svg', { viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'none', style: { width: '100%', height: h + 'px', display: 'block' } },
        e('polyline', { points: pts, fill: 'none', stroke: color, strokeWidth: '2', strokeLinejoin: 'round', strokeLinecap: 'round' }));
    }

    var pct = function (x) { return x == null ? '-' : ((x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'); };
    function metricRow(label, m, color, path) {
      if (!m) return null;
      return e('div', { key: label, style: { borderTop: '1px solid ' + border, padding: '0.6rem 0' } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.3rem' } },
          e('span', { style: { color: color, fontWeight: 700, fontSize: '0.84rem' } }, label),
          e('span', { style: { color: text, fontSize: '0.8rem' } },
            sym + fmt(m.endValue) + '  ', e('span', { style: { color: dim } }, 'CAGR '), e('span', { style: { color: m.cagr >= 0 ? good : bad, fontWeight: 600 } }, pct(m.cagr)),
            e('span', { style: { color: dim } }, '  max DD '), e('span', { style: { color: bad, fontWeight: 600 } }, '-' + (m.maxDrawdown * 100).toFixed(1) + '%'),
            e('span', { style: { color: dim } }, '  vol '), e('span', { style: { color: text, fontWeight: 600 } }, (m.volatility * 100).toFixed(1) + '%'))),
        path ? sparkline(path, color) : null);
    }

    var inputStyle = { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.35rem 0.5rem', color: text, fontSize: '0.78rem' };
    var presets = (A && A.BENCHMARKS) || [];

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1rem 1.5rem 1.5rem' } },
      e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem' } }, t.backtesterTitle || 'Allocation backtester (what-if)'),
      e('div', { style: { color: dim, fontSize: '0.78rem', marginBottom: '0.8rem' } }, 'What would this allocation have become over real history? Symbols are Yahoo tickers (URTH, VWCE.DE, ^GSPC, BTC-USD, ...). Weights normalise automatically.'),
      rows.map(function (r, i) {
        return e('div', { key: i, style: { display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', alignItems: 'center' } },
          e('input', { type: 'text', value: r.symbol, placeholder: 'Symbol', onChange: function (ev) { setRow(i, 'symbol', ev.target.value); }, style: Object.assign({ width: '130px' }, inputStyle) }),
          e('input', { type: 'text', value: r.weight, placeholder: 'Weight %', onChange: function (ev) { setRow(i, 'weight', ev.target.value); }, style: Object.assign({ width: '80px', textAlign: 'right' }, inputStyle) }),
          rows.length > 1 ? e('button', { onClick: function () { removeRow(i); }, style: { background: 'none', border: 'none', color: dim, cursor: 'pointer', fontSize: '0.9rem' } }, 'x') : null);
      }),
      e('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', margin: '0.6rem 0 0.9rem' } },
        e('button', { onClick: addRow, style: { padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid ' + border, background: inputBg, color: dim, cursor: 'pointer', fontSize: '0.74rem' } }, '+ asset'),
        e('select', { value: range, onChange: function (ev) { setRange(ev.target.value); }, style: inputStyle },
          ['1y', '2y', '5y', '10y', 'max'].map(function (r2) { return e('option', { key: r2, value: r2 }, r2); })),
        e('select', { value: rebal, onChange: function (ev) { setRebal(ev.target.value); }, style: inputStyle },
          [['none', 'no rebalancing'], ['monthly', 'rebalance monthly'], ['quarterly', 'rebalance quarterly'], ['yearly', 'rebalance yearly']].map(function (o) { return e('option', { key: o[0], value: o[0] }, o[1]); })),
        e('input', { type: 'text', value: initial, onChange: function (ev) { setInitial(ev.target.value); }, title: 'Starting capital', style: Object.assign({ width: '90px', textAlign: 'right' }, inputStyle) }),
        e('select', { value: bench, onChange: function (ev) { setBench(ev.target.value); }, style: inputStyle },
          presets.map(function (b) { return e('option', { key: b.key, value: b.key }, 'vs ' + b.label); })),
        e('button', { onClick: runBacktest, disabled: busy, style: { padding: '0.4rem 1rem', borderRadius: '8px', border: 'none', cursor: busy ? 'default' : 'pointer', fontWeight: 700, fontSize: '0.8rem', background: accent, color: '#13110a', opacity: busy ? 0.6 : 1 } }, busy ? 'Running...' : 'Run backtest')),
      out && out.error ? e('div', { style: { color: bad, fontSize: '0.8rem' } }, out.error) : null,
      out && out.strategy ? e('div', null,
        metricRow('Your allocation' + (out.strategy.rebalances ? ' (' + out.strategy.rebalances + ' rebalances)' : ''), out.strategy.metrics, accent, out.strategy.path),
        out.benchmark ? metricRow(out.preset.label + ' (' + out.preset.proxy + ')', out.benchmark.metrics, dim, out.benchmark.path) : null,
        out.actual ? metricRow('Your actual portfolio (rescaled)', out.actual.metrics, good, out.actual.path) : null,
        e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.7rem', lineHeight: 1.5 } },
          'Backtest over the common history of all symbols (' + out.strategy.metrics.periods + ' trading days, ' + out.strategy.metrics.years.toFixed(1) + ' years), prices as delivered by Yahoo Finance. Past performance is not indicative of future results.')) : null);
  }

  var api = {
    REBALANCE_EVERY: REBALANCE_EVERY,
    normalizeWeights: normalizeWeights,
    alignSeries: alignSeries,
    backtest: backtest,
    summarize: summarize,
    run: run,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminBacktester = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
