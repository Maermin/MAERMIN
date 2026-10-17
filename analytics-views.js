// ============================================================================
// MAERMIN — Analytics view panels  (window.MaerminAnalyticsViews)
// ----------------------------------------------------------------------------
// Surfaces the already-built-but-unwired MaerminAnalytics engine in the existing
// views (no new tabs):
//   • BenchmarkPanel   → Returns view: Alpha, Beta, Tracking Error, Information
//                        Ratio, R² vs MSCI World / FTSE All-World / S&P 500 /
//                        Nasdaq 100. Pulls the benchmark proxy via the same
//                        worker yf endpoint the app already uses.
//   • RollingRiskPanel → Risk view: rolling annualised volatility + rolling
//                        return sparklines (the trajectory, complementing the
//                        existing single-number volatility — not a duplicate).
//
// Math is reused from MaerminAnalytics; series construction from
// MaerminAnalyticsData. Both are unit-tested; these panels are thin glue.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function sparkline(React, values, color, h) {
    if (!values || values.length < 2) return null;
    var w = 240, ht = h || 40, min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = (max - min) || 1;
    var pts = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * w;
      var y = ht - ((v - min) / span) * ht;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return React.createElement('svg', { viewBox: '0 0 ' + w + ' ' + ht, preserveAspectRatio: 'none', className: 'ui-spark__svg', 'aria-hidden': 'true', style: { height: ht + 'px' } },
      React.createElement('polyline', { points: pts, fill: 'none', style: { stroke: color }, strokeWidth: '2', strokeLinejoin: 'round', strokeLinecap: 'round' }));
  }

  // R4.2: a muted line; an error colour (danger / loss) reads as an error.
  function note(React, dim, txt) {
    var err = /danger|loss/.test(String(dim || ''));
    return React.createElement('p', { className: ['ui-muted', err ? 'is-error' : ''].join(' ').trim() }, txt);
  }

  // ---- Benchmark overlay (Returns view) -----------------------------------
  function BenchmarkPanel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var D = window.MaerminAnalyticsData, A = window.MaerminAnalytics;
    if (!D || !A) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var dim = 'var(--text-dim)', bad = 'var(--loss)';
    var workerBase = (props.workerUrl || '').trim().replace(/\/$/, '');
    // Daily TWR index of the book ([{ d, v }], from the value path) when there is
    // one; else the value series derived from the refresh history.
    var dated = (Array.isArray(props.valueSeries) && props.valueSeries.length >= 3) ? props.valueSeries : null;
    var series = dated ? dated.map(function (p) { return p.v; }) : D.buildValueSeries(props.portfolio, props.priceHistory);

    var sSel = React.useState('msci_world'); var sel = sSel[0], setSel = sSel[1];
    var sBench = React.useState(null); var bench = sBench[0], setBench = sBench[1];
    var sLoad = React.useState(false); var loading = sLoad[0], setLoading = sLoad[1];
    var sErr = React.useState(null); var err = sErr[0], setErr = sErr[1];

    var presets = A.BENCHMARKS || [];
    var preset = presets.filter(function (b) { return b.key === sel; })[0] || presets[0];

    React.useEffect(function () {
      if (!workerBase || !preset) { setBench(null); return; }
      var cancelled = false; setLoading(true); setErr(null);
      // Enough benchmark history to cover the book's own (up to three years).
      var range = (dated && dated.length > 260) ? (dated.length > 520 ? '5y' : '2y') : '1y';
      var url = workerBase + '?action=yf&symbol=' + encodeURIComponent(preset.proxy) + '&interval=1d&range=' + range;
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
      fetch(url, { signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (cancelled) return;
          if (!j || j.error || !Array.isArray(j.prices)) { setErr((j && j.error) || __('avNoBenchData', 'No benchmark data')); setBench(null); }
          else { setBench({ series: D.pricesOf(j.prices), dated: j.prices, label: preset.label }); }
          setLoading(false);
        })
        .catch(function (ex) { if (cancelled) return; setErr((ex && ex.name === 'AbortError') ? __('fxaTimedOut', 'Timed out') : __('fxaFetchFailed', 'Fetch failed')); setBench(null); setLoading(false); })
        .then(function () { if (timer) clearTimeout(timer); });
      return function () { cancelled = true; if (timer) clearTimeout(timer); };
    }, [sel, workerBase, dated ? (dated.length > 260 ? (dated.length > 520 ? 3 : 2) : 1) : 0]);

    var stats = null, diffPp = null;
    if (bench && series.length >= 3 && bench.series.length >= 3) {
      // Dated on both sides: pair the returns by calendar day (a book with crypto
      // has weekend points the benchmark lacks). Otherwise trailing windows.
      var byDate = dated ? D.alignByDate([dated, bench.dated]) : [];
      var al = byDate.length === 2 ? { a: D.toReturns(byDate[0]), b: D.toReturns(byDate[1]) } : D.alignedReturns(series, bench.series);
      stats = A.benchmarkStats(al.a, al.b, { periodsPerYear: 252 });
      // P5-1.6: cumulative difference over the same compared returns.
      if (window.MaerminVerdicts) diffPp = window.MaerminVerdicts.cumulativeDiffPp(al.a, al.b);
    }
    var verdict = window.MaerminVerdicts && stats && stats.available ? window.MaerminVerdicts.benchmark(diffPp, bench ? bench.label : '') : null;

    // R4.1: shared Card, Segmented and Stat tiles
    var UIC = window.MaerminComponents;
    var pct = function (x) { return window.MaerminI18n.pct(x * 100, 1); };
    var tile = function (label, value, tone) {
      return e(UIC.Stat, { key: label, className: 'ui-tile', label: label, value: value, tone: tone || null });
    };

    var body;
    if (!workerBase) body = window.MaerminUtils.workerNote(__('avNeedWorkerBench', 'Add a Worker URL in API Settings to compare against a benchmark.'));
    else if (series.length < 3) body = note(React, dim, __('avNeedHistoryBench', 'Refresh prices a few times to unlock benchmark analytics — they need a short portfolio price history.'));
    else if (loading) body = note(React, dim, __('avLoadingBench', 'Loading {name}…', { name: preset ? preset.label : __('perfBenchmark', 'Benchmark') }));
    else if (err) body = note(React, bad, __('avBenchFailed', 'Could not load benchmark: {msg}', { msg: err }));
    else if (!stats || !stats.available) body = note(React, dim, __('avNotEnoughBench', 'Not enough overlapping history to compute benchmark stats yet.'));
    else body = e('div', null,
      verdict && e('p', { 'data-testid': 'verdict-benchmark', 'data-level': verdict.level, className: 'ui-verdict' }, verdict.text),
      e('div', { className: 'ui-tiles' },
        tile(__('avAlphaAnn', 'Alpha (ann.)'), (stats.alpha > 0 ? '+' : '') + pct(stats.alpha), UIC.toneOf(stats.alpha)),
        tile('Beta', window.MaerminI18n.num(stats.beta, 2)),
        tile(__('avTrackingError', 'Tracking error'), pct(stats.trackingError)),
        tile(__('avInfoRatio', 'Information ratio'), (stats.informationRatio > 0 ? '+' : '') + window.MaerminI18n.num(stats.informationRatio, 2), UIC.toneOf(stats.informationRatio)),
        tile('R²', pct(stats.rSquared)),
        tile(__('avCorrelation', 'Correlation'), window.MaerminI18n.num(stats.correlation, 2))
      ),
      e('p', { className: 'ui-note' },
        (dated ? __('avEstDaily', 'Estimated from {n} daily returns since {date} vs {bench} ({proxy}).', { n: stats.periods, date: window.MaerminI18n.date(dated[0].d), bench: bench ? bench.label : '', proxy: preset ? preset.proxy : '' }) : __('avEstPoints', 'Estimated from {n} overlapping price points vs {bench} ({proxy}).', { n: stats.periods, bench: bench ? bench.label : '', proxy: preset ? preset.proxy : '' })) + ' ' + __('avCapmNote', 'Alpha/beta are CAPM estimates from available history, not guarantees.') + (verdict ? ' ' + window.MaerminVerdicts.disclaimer() : ''))
    );

    return e(UIC.Card, { 'data-testid': 'benchmark-panel', headingLevel: 'h3',
      title: e(React.Fragment, null, __('avBenchTitle', 'Benchmark comparison'), ' ', window.MaerminDemoFixtures && window.MaerminDemoFixtures.badge(React, theme, workerBase)),
      action: e(UIC.Segmented, { label: __('perfBenchmark', 'Benchmark'), value: sel, size: 'sm', onChange: setSel,
        options: presets.map(function (b) { return { value: b.key, label: b.label, attrs: { 'data-bench': b.key } }; }) }) },
      body
    );
  }

  // ---- Rolling risk (Risk view) -------------------------------------------
  function RollingRiskPanel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var D = window.MaerminAnalyticsData, A = window.MaerminAnalytics;
    if (!D || !A) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var dim = 'var(--text-dim)';
    var UIC = window.MaerminComponents;

    // Daily TWR index from the value path when available (deposits do not show
    // up as returns); else the value series from the refresh history.
    var dated = (Array.isArray(props.valueSeries) && props.valueSeries.length >= 5) ? props.valueSeries : null;
    var series = dated ? dated.map(function (p) { return p.v; }) : D.buildValueSeries(props.portfolio, props.priceHistory);
    var returns = D.toReturns(series);

    var inner;
    if (returns.length < 4) {
      inner = note(React, dim, __('avNeedHistoryRoll', 'Refresh prices a few times to unlock rolling volatility & return trends — they need a short price history.'));
    } else {
      // Daily data: a one-month (21 trading day) window once there is enough of it.
      var win = Math.max(2, Math.min(dated ? 21 : 10, Math.floor(returns.length / 2)));
      var rvol = A.rollingVolatility(returns, win, 252);
      var rret = A.rollingReturns(returns, win);
      var curVol = rvol.length ? rvol[rvol.length - 1] : 0;
      var curRet = rret.length ? rret[rret.length - 1] : 0;
      // R4.2: two charts on the shared chart look; the latest figure as a Stat
      inner = e('div', null,
        e('div', { className: 'ui-grid-2' },
          e('div', { className: 'ui-spark', 'data-series': '1' },
            e(UIC.Stat, { label: __('avRollVol', '{n}-pt rolling volatility (annualised)', { n: win }), value: window.MaerminI18n.pct(curVol * 100, 1) }),
            sparkline(React, rvol, 'var(--chart-1)')),
          e('div', { className: 'ui-spark' },
            e(UIC.Stat, { label: __('avRollRet', '{n}-pt rolling return', { n: win }), value: window.MaerminI18n.pct(curRet * 100, 1, true), tone: UIC.toneOf(curRet) }),
            sparkline(React, rret, curRet >= 0 ? 'var(--gain)' : 'var(--loss)'))),
        e('p', { 'data-testid': 'rolling-source', className: 'ui-note' }, dated
          ? __('avRollDaily', 'Computed from {n} daily time-weighted returns since {date} (deposits and withdrawals excluded).', { n: returns.length, date: window.MaerminI18n.date(dated[0].d) })
          : __('avRollPath', 'Computed from your portfolio value path over the available price history.'))
      );
    }

    return e(UIC.Card, { title: __('avRollTitle', 'Rolling volatility & returns'), headingLevel: 'h3', 'data-testid': 'rolling-risk', className: 'ui-chart' }, inner);
  }

  // ---- Fama-French factor exposure (Risk view) ----------------------------
  // The engine's factorExposure() is generic over factor-return arrays; the
  // proxies that *make* those arrays are a view/data concern, so they live here
  // (the same place that owns fetching). We approximate the classic 3 factors
  // with liquid, Yahoo-quotable ETFs and reuse the exact yf endpoint the rest of
  // the app uses — no new data pipeline:
  //   MKT = VTI (total US market, excess over rf≈0)
  //   SMB = IWM − IWB  (Russell 2000 small − Russell 1000 big)
  //   HML = IWD − IWF  (Russell 1000 Value − Growth)
  var FACTOR_PROXIES = ['VTI', 'IWM', 'IWB', 'IWD', 'IWF'];
  var FACTOR_MIN_PERIODS = 8; // 3 factors + intercept need headroom to be meaningful

  function FactorExposurePanel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var D = window.MaerminAnalyticsData, A = window.MaerminAnalytics;
    if (!D || !A || !D.alignReturns) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var dim = 'var(--text-dim)', bad = 'var(--loss)';
    var UIC = window.MaerminComponents;
    var workerBase = (props.workerUrl || '').trim().replace(/\/$/, '');
    var dated = (Array.isArray(props.valueSeries) && props.valueSeries.length > FACTOR_MIN_PERIODS) ? props.valueSeries : null;
    var series = dated ? dated.map(function (p) { return p.v; }) : D.buildValueSeries(props.portfolio, props.priceHistory);

    var sData = React.useState(null); var data = sData[0], setData = sData[1];
    var sLoad = React.useState(false); var loading = sLoad[0], setLoading = sLoad[1];
    var sErr = React.useState(null); var err = sErr[0], setErr = sErr[1];

    var canFetch = !!workerBase && series.length > FACTOR_MIN_PERIODS;
    React.useEffect(function () {
      if (!canFetch) { setData(null); return; }
      var cancelled = false; setLoading(true); setErr(null);
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      Promise.all(FACTOR_PROXIES.map(function (sym) {
        var url = workerBase + '?action=yf&symbol=' + encodeURIComponent(sym) + '&interval=1d&range=1y';
        return fetch(url, { signal: ctrl ? ctrl.signal : undefined })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j || j.error || !Array.isArray(j.prices)) throw new Error((j && j.error) || __('avNoDataFor', 'No data for {sym}', { sym: sym }));
            return j.prices;
          });
      })).then(function (raw) {
        if (cancelled) return;
        var arr = raw.map(D.pricesOf);
        setData({ vti: arr[0], iwm: arr[1], iwb: arr[2], iwd: arr[3], iwf: arr[4], dated: raw });
        setLoading(false);
      }).catch(function (ex) {
        if (cancelled) return;
        setErr((ex && ex.name === 'AbortError') ? __('fxaTimedOut', 'Timed out') : (ex && ex.message) || __('fxaFetchFailed', 'Fetch failed'));
        setData(null); setLoading(false);
      }).then(function () { if (timer) clearTimeout(timer); });
      return function () { cancelled = true; if (timer) clearTimeout(timer); };
    }, [workerBase, series.length]);

    var result = null, periods = 0;
    if (data) {
      // Dated book series: pair by calendar day, then turn into returns.
      var byDate = dated ? D.alignByDate([dated].concat(data.dated)) : [];
      var aligned = byDate.length === 6 ? byDate.map(D.toReturns) : D.alignReturns([series, data.vti, data.iwm, data.iwb, data.iwd, data.iwf]);
      if (aligned.length === 6 && aligned[0].length >= FACTOR_MIN_PERIODS) {
        periods = aligned[0].length;
        var mkt = aligned[1];                       // rf≈0 → returns ≈ excess returns
        var smb = D.subtract(aligned[2], aligned[3]);
        var hml = D.subtract(aligned[4], aligned[5]);
        result = A.factorExposure(aligned[0], [mkt, smb, hml], ['MKT', 'SMB', 'HML']);
      }
    }

    var pct = function (x) { return window.MaerminI18n.pct(x * 100, 1); };
    var tile = function (label, value, tone) {
      return e(UIC.Stat, { key: label, className: 'ui-tile', label: label, value: value, tone: tone || null });
    };

    var body;
    if (!workerBase) body = window.MaerminUtils.workerNote(__('avNeedWorkerFactor', 'Add a Worker URL in API Settings to estimate factor exposure.'));
    else if (series.length <= FACTOR_MIN_PERIODS) body = note(React, dim, __('avNeedHistoryFactor', 'Refresh prices a few more times to unlock factor analysis — a Fama-French regression needs a longer portfolio price history.'));
    else if (loading) body = note(React, dim, __('avLoadingFactors', 'Loading factor proxies (VTI · IWM/IWB · IWD/IWF)…'));
    else if (err) body = note(React, bad, __('avFactorFailed', 'Could not load factor proxies: {msg}', { msg: err }));
    else if (!result || !result.available || periods < FACTOR_MIN_PERIODS) body = note(React, dim, __('avNotEnoughFactor', 'Not enough overlapping history to estimate factor exposure yet.'));
    else {
      var b = result.betas || {};
      var alphaAnn = result.alpha > -1 ? (Math.pow(1 + result.alpha, 252) - 1) : 0;
      var tilt = function (beta, hi, lo) { return beta > 0.05 ? hi : (beta < -0.05 ? lo : __('avNeutral', 'neutral')); };
      body = e('div', null,
        e('div', { className: 'ui-tiles' },
          tile(__('avMkt', 'Market (MKT) β'), window.MaerminI18n.num(b.MKT != null ? b.MKT : 0, 2)),
          tile(__('avSmb', 'Size (SMB) β'), window.MaerminI18n.num(b.SMB != null ? b.SMB : 0, 2)),
          tile(__('avHml', 'Value (HML) β'), window.MaerminI18n.num(b.HML != null ? b.HML : 0, 2)),
          tile(__('avAlphaAnn', 'Alpha (ann.)'), (alphaAnn > 0 ? '+' : '') + pct(alphaAnn), UIC.toneOf(alphaAnn))
        ),
        e('p', { className: 'ui-note' },
          __('avReadsAs', 'Reads as a {size} / {style} tilt, market beta {beta}.', { size: tilt(b.SMB || 0, __('avSmallCap', 'small-cap'), __('avLargeCap', 'large-cap')), style: tilt(b.HML || 0, __('avValue', 'value'), __('avGrowth', 'growth')), beta: window.MaerminI18n.num(b.MKT != null ? b.MKT : 0, 2) }) + ' '),
        e('p', { className: 'ui-note' },
          __('avFactorNote', 'Estimated from {n} overlapping daily returns regressed on ETF proxies (VTI; IWM−IWB; IWD−IWF). A statistical estimate from limited history, not a precise factor loading.', { n: periods }))
      );
    }

    return e(UIC.Card, { title: __('avFactorTitle', 'Factor exposure (Fama-French)'), headingLevel: 'h3', 'data-testid': 'factor-exposure' }, body);
  }

  var api = { BenchmarkPanel: BenchmarkPanel, RollingRiskPanel: RollingRiskPanel, FactorExposurePanel: FactorExposurePanel };
  if (typeof window !== 'undefined') window.MaerminAnalyticsViews = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
