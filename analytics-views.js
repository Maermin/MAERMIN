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

  function sparkline(React, values, color, h) {
    if (!values || values.length < 2) return null;
    var w = 240, ht = h || 40, min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var span = (max - min) || 1;
    var pts = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * w;
      var y = ht - ((v - min) / span) * ht;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return React.createElement('svg', { viewBox: '0 0 ' + w + ' ' + ht, preserveAspectRatio: 'none', style: { width: '100%', height: ht + 'px', display: 'block' } },
      React.createElement('polyline', { points: pts, fill: 'none', stroke: color, strokeWidth: '2', strokeLinejoin: 'round', strokeLinecap: 'round' }));
  }

  function note(React, dim, txt) {
    return React.createElement('div', { style: { color: dim, fontSize: '0.78rem', lineHeight: '1.5' } }, txt);
  }

  // ---- Benchmark overlay (Returns view) -----------------------------------
  function BenchmarkPanel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var D = window.MaerminAnalyticsData, A = window.MaerminAnalytics;
    if (!D || !A) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2', accent = theme.accent || '#f5a524';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)', inputBg = theme.inputBg || '#0f172a';
    var ok = theme.success || '#22c55e', bad = theme.danger || '#ef4444';
    var card = theme.card || theme.cardBg || 'transparent';
    var workerBase = (props.workerUrl || '').trim().replace(/\/$/, '');
    var series = D.buildValueSeries(props.portfolio, props.priceHistory);

    var sSel = React.useState('msci_world'); var sel = sSel[0], setSel = sSel[1];
    var sBench = React.useState(null); var bench = sBench[0], setBench = sBench[1];
    var sLoad = React.useState(false); var loading = sLoad[0], setLoading = sLoad[1];
    var sErr = React.useState(null); var err = sErr[0], setErr = sErr[1];

    var presets = A.BENCHMARKS || [];
    var preset = presets.filter(function (b) { return b.key === sel; })[0] || presets[0];

    React.useEffect(function () {
      if (!workerBase || !preset) { setBench(null); return; }
      var cancelled = false; setLoading(true); setErr(null);
      var url = workerBase + '?action=yf&symbol=' + encodeURIComponent(preset.proxy) + '&interval=1d&range=1y';
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
      fetch(url, { signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (cancelled) return;
          if (!j || j.error || !Array.isArray(j.prices)) { setErr((j && j.error) || 'No benchmark data'); setBench(null); }
          else { setBench({ series: D.pricesOf(j.prices), label: preset.label }); }
          setLoading(false);
        })
        .catch(function (ex) { if (cancelled) return; setErr((ex && ex.name === 'AbortError') ? 'Timed out' : 'Fetch failed'); setBench(null); setLoading(false); })
        .then(function () { if (timer) clearTimeout(timer); });
      return function () { cancelled = true; if (timer) clearTimeout(timer); };
    }, [sel, workerBase]);

    var stats = null;
    if (bench && series.length >= 3 && bench.series.length >= 3) {
      var al = D.alignedReturns(series, bench.series);
      stats = A.benchmarkStats(al.a, al.b, { periodsPerYear: 252 });
    }

    var pct = function (x) { return (x * 100).toFixed(1) + '%'; };
    var tile = function (label, value, color) {
      return e('div', { key: label, style: { background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.7rem 0.9rem', minWidth: '110px' } },
        e('div', { style: { color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label),
        e('div', { style: { color: color || text, fontSize: '1.1rem', fontWeight: '700', marginTop: '0.15rem' } }, value));
    };

    var body;
    if (!workerBase) body = note(React, dim, 'Add a Worker URL in API Settings to compare against a benchmark.');
    else if (series.length < 3) body = note(React, dim, 'Refresh prices a few times to unlock benchmark analytics — they need a short portfolio price history.');
    else if (loading) body = note(React, dim, 'Loading ' + (preset ? preset.label : 'benchmark') + '…');
    else if (err) body = note(React, bad, 'Could not load benchmark: ' + err);
    else if (!stats || !stats.available) body = note(React, dim, 'Not enough overlapping history to compute benchmark stats yet.');
    else body = e('div', null,
      e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
        tile('Alpha (ann.)', pct(stats.alpha), stats.alpha >= 0 ? ok : bad),
        tile('Beta', stats.beta.toFixed(2), text),
        tile('Tracking error', pct(stats.trackingError), text),
        tile('Information ratio', stats.informationRatio.toFixed(2), stats.informationRatio >= 0 ? ok : bad),
        tile('R²', pct(stats.rSquared), text),
        tile('Correlation', stats.correlation.toFixed(2), text)
      ),
      e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.7rem', lineHeight: '1.5' } },
        'Estimated from ' + stats.periods + ' overlapping price points vs ' + (bench ? bench.label : '') + ' (' + (preset ? preset.proxy : '') + '). Alpha/beta are CAPM estimates from available history, not guarantees.')
    );

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginTop: '1.25rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.9rem' } },
        e('h3', { style: { color: text, fontSize: '1rem', fontWeight: '700', margin: 0 } }, 'Benchmark comparison'),
        e('div', { style: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap' } }, presets.map(function (b) {
          return e('button', { key: b.key, onClick: function () { setSel(b.key); }, style: { padding: '0.35rem 0.7rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.76rem', fontWeight: sel === b.key ? '700' : '500', background: sel === b.key ? accent : inputBg, color: sel === b.key ? '#13110a' : dim } }, b.label);
        }))
      ),
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
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2', accent = theme.accent || '#f5a524';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)', card = theme.card || theme.cardBg || 'transparent';
    var ok = theme.success || '#22c55e';

    var series = D.buildValueSeries(props.portfolio, props.priceHistory);
    var returns = D.toReturns(series);

    var inner;
    if (returns.length < 4) {
      inner = note(React, dim, 'Refresh prices a few times to unlock rolling volatility & return trends — they need a short price history.');
    } else {
      var win = Math.max(2, Math.min(10, Math.floor(returns.length / 2)));
      var rvol = A.rollingVolatility(returns, win, 252);
      var rret = A.rollingReturns(returns, win);
      var curVol = rvol.length ? rvol[rvol.length - 1] : 0;
      var curRet = rret.length ? rret[rret.length - 1] : 0;
      inner = e('div', null,
        e('div', { style: { display: 'flex', gap: '1.5rem', flexWrap: 'wrap' } },
          e('div', { style: { flex: 1, minWidth: '240px' } },
            e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.3rem' } }, win + '-pt rolling volatility (annualised)'),
            sparkline(React, rvol, accent),
            e('div', { style: { color: text, fontSize: '1rem', fontWeight: '700', marginTop: '0.3rem' } }, (curVol * 100).toFixed(1) + '%')
          ),
          e('div', { style: { flex: 1, minWidth: '240px' } },
            e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.3rem' } }, win + '-pt rolling return'),
            sparkline(React, rret, curRet >= 0 ? ok : (theme.danger || '#ef4444')),
            e('div', { style: { color: curRet >= 0 ? ok : (theme.danger || '#ef4444'), fontSize: '1rem', fontWeight: '700', marginTop: '0.3rem' } }, (curRet * 100).toFixed(1) + '%')
          )
        ),
        e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.7rem' } }, 'Computed from your portfolio value path over the available price history.')
      );
    }

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginTop: '1rem' } },
      e('h3', { style: { color: text, fontSize: '1rem', fontWeight: '700', margin: '0 0 0.9rem' } }, 'Rolling volatility & returns'),
      inner
    );
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
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)', inputBg = theme.inputBg || '#0f172a';
    var ok = theme.success || '#22c55e', bad = theme.danger || '#ef4444';
    var card = theme.card || theme.cardBg || 'transparent';
    var workerBase = (props.workerUrl || '').trim().replace(/\/$/, '');
    var series = D.buildValueSeries(props.portfolio, props.priceHistory);

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
            if (!j || j.error || !Array.isArray(j.prices)) throw new Error((j && j.error) || ('No data for ' + sym));
            return D.pricesOf(j.prices);
          });
      })).then(function (arr) {
        if (cancelled) return;
        setData({ vti: arr[0], iwm: arr[1], iwb: arr[2], iwd: arr[3], iwf: arr[4] });
        setLoading(false);
      }).catch(function (ex) {
        if (cancelled) return;
        setErr((ex && ex.name === 'AbortError') ? 'Timed out' : (ex && ex.message) || 'Fetch failed');
        setData(null); setLoading(false);
      }).then(function () { if (timer) clearTimeout(timer); });
      return function () { cancelled = true; if (timer) clearTimeout(timer); };
    }, [workerBase, series.length]);

    var result = null, periods = 0;
    if (data) {
      var aligned = D.alignReturns([series, data.vti, data.iwm, data.iwb, data.iwd, data.iwf]);
      if (aligned.length === 6 && aligned[0].length >= FACTOR_MIN_PERIODS) {
        periods = aligned[0].length;
        var mkt = aligned[1];                       // rf≈0 → returns ≈ excess returns
        var smb = D.subtract(aligned[2], aligned[3]);
        var hml = D.subtract(aligned[4], aligned[5]);
        result = A.factorExposure(aligned[0], [mkt, smb, hml], ['MKT', 'SMB', 'HML']);
      }
    }

    var pct = function (x) { return (x * 100).toFixed(1) + '%'; };
    var tile = function (label, value, color) {
      return e('div', { key: label, style: { background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.7rem 0.9rem', minWidth: '110px' } },
        e('div', { style: { color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label),
        e('div', { style: { color: color || text, fontSize: '1.1rem', fontWeight: '700', marginTop: '0.15rem' } }, value));
    };

    var body;
    if (!workerBase) body = note(React, dim, 'Add a Worker URL in API Settings to estimate factor exposure.');
    else if (series.length <= FACTOR_MIN_PERIODS) body = note(React, dim, 'Refresh prices a few more times to unlock factor analysis — a Fama-French regression needs a longer portfolio price history.');
    else if (loading) body = note(React, dim, 'Loading factor proxies (VTI · IWM/IWB · IWD/IWF)…');
    else if (err) body = note(React, bad, 'Could not load factor proxies: ' + err);
    else if (!result || !result.available || periods < FACTOR_MIN_PERIODS) body = note(React, dim, 'Not enough overlapping history to estimate factor exposure yet.');
    else {
      var b = result.betas || {};
      var alphaAnn = result.alpha > -1 ? (Math.pow(1 + result.alpha, 252) - 1) : 0;
      var tilt = function (beta, hi, lo) { return beta > 0.05 ? hi : (beta < -0.05 ? lo : 'neutral'); };
      body = e('div', null,
        e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
          tile('Market (MKT) β', (b.MKT != null ? b.MKT : 0).toFixed(2), text),
          tile('Size (SMB) β', (b.SMB != null ? b.SMB : 0).toFixed(2), text),
          tile('Value (HML) β', (b.HML != null ? b.HML : 0).toFixed(2), text),
          tile('Alpha (ann.)', pct(alphaAnn), alphaAnn >= 0 ? ok : bad)
        ),
        e('div', { style: { color: dim, fontSize: '0.74rem', marginTop: '0.7rem', lineHeight: '1.55' } },
          'Reads as a ' + tilt(b.SMB || 0, 'small-cap', 'large-cap') + ' / ' + tilt(b.HML || 0, 'value', 'growth') + ' tilt, market beta ' + (b.MKT != null ? b.MKT : 0).toFixed(2) + '. '),
        e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.3rem', lineHeight: '1.5' } },
          'Estimated from ' + periods + ' overlapping daily returns regressed on ETF proxies (VTI; IWM−IWB; IWD−IWF). A statistical estimate from limited history, not a precise factor loading.')
      );
    }

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginTop: '1rem' } },
      e('h3', { style: { color: text, fontSize: '1rem', fontWeight: '700', margin: '0 0 0.9rem' } }, 'Factor exposure (Fama-French)'),
      body
    );
  }

  var api = { BenchmarkPanel: BenchmarkPanel, RollingRiskPanel: RollingRiskPanel, FactorExposurePanel: FactorExposurePanel };
  if (typeof window !== 'undefined') window.MaerminAnalyticsViews = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
