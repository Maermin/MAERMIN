// ============================================================================
// MAERMIN v10.x — Snapshot-Powered Performance  (window.MaerminPerformance)
// ----------------------------------------------------------------------------
// Roadmap feature #5 (derived — NO new persistence). A pure consumer of the v10
// Portfolio Value Snapshots series (window.MaerminSnapshots / 'maermin_snapshots'):
// it turns the on-device value history into the familiar 1D / 1W / 1M / 3M / 6M /
// YTD / 1Y / Max performance cards — with ZERO external API calls. When the
// requested look-back predates the first snapshot, the period is clamped to
// inception and flagged `partial:true`, so a young portfolio still shows a real
// number instead of a blank.
//
// The core operates on a plain sorted series array [{ d:'YYYY-MM-DD', v:<number> }]
// so it is unit-tested headlessly (test/performance-cards.test.js) with no
// dependency on the snapshots module or a browser. Convenience loaders bridge to
// MaerminSnapshots when running in the app.
// ============================================================================
(function () {
  'use strict';

  // Period definitions in display order. `kind` drives how the start date is
  // derived from the as-of date: day/month offsets, or the special YTD / MAX.
  var PERIODS = [
    { id: '1D',  label: '1D',  kind: 'day',   n: 1 },
    { id: '1W',  label: '1W',  kind: 'day',   n: 7 },
    { id: '1M',  label: '1M',  kind: 'month', n: 1 },
    { id: '3M',  label: '3M',  kind: 'month', n: 3 },
    { id: '6M',  label: '6M',  kind: 'month', n: 6 },
    { id: 'YTD', label: 'YTD', kind: 'ytd' },
    { id: '1Y',  label: '1Y',  kind: 'month', n: 12 },
    { id: 'MAX', label: 'Max', kind: 'max' }
  ];

  function parseISO(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  function toISO(d) {
    return d.getUTCFullYear() + '-' +
      ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getUTCDate()).slice(-2);
  }
  function addDays(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)); }
  function addMonths(d, n) {
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(day, last)));
  }
  function todayISO() { return toISO(new Date()); }

  // Defensive: accept any array, keep only {d,v} with a valid ISO date + finite
  // value, sorted ascending. (MaerminSnapshots already returns clean data, but a
  // raw caller might not.)
  function cleanSeries(series) {
    var out = (Array.isArray(series) ? series : []).filter(function (p) {
      return p && /^\d{4}-\d{2}-\d{2}$/.test(p.d) && isFinite(p.v);
    }).map(function (p) { return { d: p.d, v: +p.v }; });
    out.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    return out;
  }

  // Last value at-or-before an ISO date (carry-forward, like a close price).
  function valueAsOf(series, iso) {
    var found = null;
    for (var i = 0; i < series.length; i++) { if (series[i].d <= iso) found = series[i]; else break; }
    return found;
  }

  // ISO start date for a period relative to `asOf`. MAX returns null (caller uses
  // the first point); YTD returns Jan 1 of the as-of year.
  function periodStartISO(period, asOf) {
    var base = parseISO(asOf);
    if (!base) return null;
    switch (period.kind) {
      case 'day':   return toISO(addDays(base, -period.n));
      case 'month': return toISO(addMonths(base, -period.n));
      case 'ytd':   return base.getUTCFullYear() + '-01-01';
      case 'max':   return null;
      default:      return null;
    }
  }

  // Compute one period's change. Returns null only when the series is empty.
  // `partial` is true when the requested start predates the earliest snapshot
  // (the change is then measured from inception).
  function computePeriod(series, periodId, asOfISO) {
    var s = cleanSeries(series);
    if (!s.length) return null;
    var period = null;
    for (var i = 0; i < PERIODS.length; i++) { if (PERIODS[i].id === periodId) { period = PERIODS[i]; break; } }
    if (!period) return null;

    var asOf = asOfISO || todayISO();
    var end = valueAsOf(s, asOf) || s[s.length - 1];

    var startISO = periodStartISO(period, asOf);
    var start, partial = false;
    if (startISO == null) {            // MAX
      start = s[0];
    } else {
      start = valueAsOf(s, startISO);
      if (!start) { start = s[0]; partial = true; } // not enough history yet
    }

    var abs = end.v - start.v;
    var pct = start.v !== 0 ? (abs / start.v) * 100 : null;
    return {
      id: period.id, label: period.label,
      from: start.d, to: end.d,
      startValue: start.v, endValue: end.v,
      abs: abs, pct: pct,
      partial: partial,
      up: abs > 0, down: abs < 0
    };
  }

  // All periods (display order). Periods with no usable data are omitted only if
  // the whole series is empty (then returns []).
  function computeAll(series, asOfISO) {
    var s = cleanSeries(series);
    if (!s.length) return [];
    return PERIODS.map(function (p) { return computePeriod(s, p.id, asOfISO); })
                  .filter(Boolean);
  }

  // Quick "best/worst single day" over the series — a cheap insight the value
  // history makes free. Returns { best, worst } day-over-day moves or null.
  function dailyExtremes(series) {
    var s = cleanSeries(series);
    if (s.length < 2) return null;
    var best = null, worst = null;
    for (var i = 1; i < s.length; i++) {
      var prev = s[i - 1].v, cur = s[i].v;
      if (prev === 0) continue;
      var pct = ((cur - prev) / prev) * 100;
      var move = { date: s[i].d, abs: cur - prev, pct: pct };
      if (!best || pct > best.pct) best = move;
      if (!worst || pct < worst.pct) worst = move;
    }
    return (best || worst) ? { best: best, worst: worst } : null;
  }

  // ---- #2 Drawdown / underwater (snapshot-derived) -------------------------
  // Per-point drawdown from the running peak: [{ d, dd }] with dd <= 0 (percent).
  function drawdownSeries(series) {
    var s = cleanSeries(series);
    var peak = -Infinity, out = [];
    for (var i = 0; i < s.length; i++) {
      if (s[i].v > peak) peak = s[i].v;
      out.push({ d: s[i].d, dd: peak > 0 ? (s[i].v / peak - 1) * 100 : 0 });
    }
    return out;
  }
  // Worst peak-to-trough drawdown + recovery info + the current drawdown.
  function drawdownStats(series) {
    var s = cleanSeries(series);
    if (s.length < 2) return null;
    var peak = s[0].v, peakDate = s[0].d;
    var maxDd = 0, ddPeakDate = s[0].d, ddPeakVal = s[0].v, troughDate = s[0].d;
    for (var i = 0; i < s.length; i++) {
      if (s[i].v > peak) { peak = s[i].v; peakDate = s[i].d; }
      var dd = peak > 0 ? (s[i].v / peak - 1) * 100 : 0;
      if (dd < maxDd) { maxDd = dd; ddPeakDate = peakDate; ddPeakVal = peak; troughDate = s[i].d; }
    }
    var recovered = false, recoveryDate = null, reached = false;
    for (var j = 0; j < s.length; j++) {
      if (s[j].d === troughDate) reached = true;
      if (reached && s[j].v >= ddPeakVal) { recovered = true; recoveryDate = s[j].d; break; }
    }
    var ds = drawdownSeries(s);
    return {
      maxDd: maxDd, peakDate: ddPeakDate, troughDate: troughDate,
      recovered: recovered, recoveryDate: recoveryDate,
      currentDd: ds.length ? ds[ds.length - 1].dd : 0
    };
  }

  // ---- #3 Goal ETA (snapshot-derived CAGR + contributions) -----------------
  // Annualised return (%) from the first to the last snapshot, or null.
  function cagrFromSeries(series) {
    var s = cleanSeries(series);
    if (s.length < 2 || s[0].v <= 0) return null;
    var days = (Date.parse(s[s.length - 1].d) - Date.parse(s[0].d)) / 86400000;
    if (days < 1) return null;
    return (Math.pow(s[s.length - 1].v / s[0].v, 365.25 / days) - 1) * 100;
  }
  // Months to reach `target` from `current` with a monthly contribution at an
  // assumed annual return. Returns the ETA date or { reachable:false }.
  function goalEta(opts) {
    opts = opts || {};
    var current = parseFloat(opts.current) || 0;
    var target = parseFloat(opts.target) || 0;
    var monthly = parseFloat(opts.monthly) || 0;
    var annual = (opts.annualReturnPct != null && isFinite(parseFloat(opts.annualReturnPct))) ? parseFloat(opts.annualReturnPct) : 0;
    if (target <= current) return { months: 0, reachable: true, alreadyReached: true, projectedValue: current };
    var rM = annual / 100 / 12, v = current, m = 0, cap = 1200; // 100y cap
    while (v < target && m < cap) { v = v * (1 + rM) + monthly; m++; }
    if (m >= cap) return { months: null, reachable: false };
    var d = new Date(); d.setMonth(d.getMonth() + m);
    return { months: m, reachable: true, etaISO: d.toISOString().split('T')[0], projectedValue: v };
  }

  // ---- #1 Benchmark comparison (portfolio vs index, both date-keyed) --------
  // Benchmark price at-or-before an ISO date. `points` = [{date, price}] asc.
  function priceAsOf(points, iso) {
    var found = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p || p.date == null || p.price == null) continue;
      if (p.date <= iso) found = p; else break;
    }
    return found;
  }
  // Portfolio vs benchmark return over one period (same from/to dates). Returns
  // { label, port, bench, rel } in percent (bench/rel null if not coverable).
  function compareBenchmark(series, benchPoints, periodId, asOf) {
    var s = cleanSeries(series);
    if (!s.length || !Array.isArray(benchPoints) || !benchPoints.length) return null;
    var pr = computePeriod(s, periodId, asOf);
    if (!pr) return null;
    var bStart = priceAsOf(benchPoints, pr.from), bEnd = priceAsOf(benchPoints, pr.to);
    if (!bStart || !bEnd || bStart.price <= 0) return { id: pr.id, label: pr.label, port: pr.pct, bench: null, rel: null, partial: pr.partial };
    var bench = (bEnd.price / bStart.price - 1) * 100;
    return { id: pr.id, label: pr.label, port: pr.pct, bench: bench, rel: (pr.pct != null ? pr.pct - bench : null), partial: pr.partial };
  }

  // ---- convenience: pull the series from MaerminSnapshots (browser) ---------
  function seriesFromSnapshots(portfolioId) {
    if (typeof window === 'undefined' || !window.MaerminSnapshots) return [];
    try {
      var pid = portfolioId || window.MaerminSnapshots.ALL;
      return window.MaerminSnapshots.seriesFor(window.MaerminSnapshots.load(), pid)
        .map(function (p) { return { d: p.d, v: p.v }; });
    } catch (e) { return []; }
  }
  function cards(portfolioId, asOfISO) { return computeAll(seriesFromSnapshots(portfolioId), asOfISO); }

  // ---- React view (rendered via React.createElement from renderer.js) -------
  // Pure consumer: reads the snapshot series and renders the period cards + the
  // best/worst day. Read-only — no state, no persistence. Wrapped in try/catch so
  // a data hiccup degrades to a notice instead of crashing the view tree.
  function View(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    // Hooks declared unconditionally (before try). Benchmark series is fetched
    // via the same Worker proxy the Benchmark panel uses; degrades to a note
    // when there's no Worker URL. Hooks are no-ops under the test stub.
    var useState = React.useState, useEffect = React.useEffect;
    var Analytics = (typeof window !== 'undefined') ? window.MaerminAnalytics : null;
    var benches = (Analytics && Analytics.BENCHMARKS) ? Analytics.BENCHMARKS : [];
    var bkS = useState(benches.length ? benches[0].key : ''); var benchKey = bkS[0], setBenchKey = bkS[1];
    var bdS = useState(null); var benchData = bdS[0], setBenchData = bdS[1];
    var blS = useState(false); var benchLoading = blS[0], setBenchLoading = blS[1];
    var workerBase = (props.workerUrl || '').trim().replace(/\/$/, '');
    var benchPreset = benches.filter(function (b) { return b.key === benchKey; })[0] || benches[0];
    useEffect(function () {
      if (!workerBase || !benchPreset) { setBenchData(null); return; }
      var cancelled = false; setBenchLoading(true);
      var url = workerBase + '?action=yf&symbol=' + encodeURIComponent(benchPreset.proxy) + '&interval=1d&range=1y';
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
      fetch(url, { signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (cancelled) return; setBenchData((j && Array.isArray(j.prices)) ? j.prices : null); setBenchLoading(false); })
        .catch(function () { if (cancelled) return; setBenchData(null); setBenchLoading(false); })
        .then(function () { if (timer) clearTimeout(timer); });
      return function () { cancelled = true; if (timer) clearTimeout(timer); };
    }, [benchKey, workerBase]);
    try {
      var theme = props.theme || {};
      var t = props.t || {};
      var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
      var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
      var card = theme.card || '#10151f';
      var up = theme.success || '#22c55e', down = theme.danger || '#ef4444';
      var fmt = props.formatPrice || function (n) { return (Math.round(n * 100) / 100).toLocaleString(); };
      var sym = props.getCurrencySymbol ? props.getCurrencySymbol() : '€';

      var series = props.series || seriesFromSnapshots(props.portfolioId);
      var rows = computeAll(series, props.asOf);
      var ext = dailyExtremes(series);

      function pctStr(p) { return (p == null) ? '—' : (p >= 0 ? '+' : '') + p.toFixed(2) + '%'; }
      function moveColor(v) { return v > 0 ? up : v < 0 ? down : dim; }

      var cardEls = rows.map(function (r) {
        return e('div', {
          key: r.id,
          style: {
            background: card, border: '1px solid ' + border, borderRadius: '14px',
            padding: '0.95rem 1.05rem', minWidth: 0
          }
        },
          e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem' } },
            e('span', { style: { color: dim, fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' } }, r.label),
            r.partial ? e('span', { title: t.perfPartial || 'Since inception (history shorter than this period)', style: { color: dim, fontSize: '0.62rem', border: '1px solid ' + border, borderRadius: '999px', padding: '0.05rem 0.35rem' } }, '≈') : null),
          e('div', { style: { color: moveColor(r.abs), fontSize: '1.15rem', fontWeight: 800, marginTop: '0.35rem', letterSpacing: '-0.01em' } }, pctStr(r.pct)),
          e('div', { style: { color: dim, fontSize: '0.78rem', marginTop: '0.15rem' } },
            (r.abs >= 0 ? '+' : '−') + fmt(Math.abs(r.abs)) + ' ' + sym));
      });

      var hasData = rows.length > 0;

      // ---- #2 drawdown / underwater card ----
      var ddStat = drawdownStats(series);
      var ddSer = drawdownSeries(series);
      var ddCard = (hasData && ddStat) ? (function () {
        var minDd = Math.min.apply(null, ddSer.map(function (p) { return p.dd; }).concat([0]));
        var n = ddSer.length;
        var pts = ddSer.map(function (p, i) {
          var x = (n > 1 ? i / (n - 1) : 0) * 300;
          var y = (minDd < 0 ? p.dd / minDd : 0) * 70;
          return x.toFixed(1) + ',' + y.toFixed(1);
        });
        var areaPath = 'M0,0 L' + pts.join(' L') + ' L300,0 Z';
        function stat(label, val, color) {
          return e('div', { style: { flex: 1, minWidth: '110px' } },
            e('div', { style: { color: dim, fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' } }, label),
            e('div', { style: { color: color || text, fontSize: '1.05rem', fontWeight: 800, marginTop: '0.25rem' } }, val));
        }
        return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem 1.25rem', marginBottom: '1.5rem' } },
          e('div', { style: { color: text, fontSize: '0.92rem', fontWeight: 700, marginBottom: '0.8rem' } }, t.perfDrawdownTitle || 'Drawdown (underwater)'),
          e('svg', { viewBox: '0 0 300 80', preserveAspectRatio: 'none', style: { width: '100%', height: '80px', display: 'block', marginBottom: '0.8rem' } },
            e('line', { x1: 0, y1: 0, x2: 300, y2: 0, stroke: border, strokeWidth: 1 }),
            e('path', { d: areaPath, fill: down, fillOpacity: 0.22, stroke: down, strokeWidth: 1 })),
          e('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' } },
            stat(t.perfMaxDrawdown || 'Max drawdown', ddStat.maxDd.toFixed(1) + '%', down),
            stat(t.perfCurrentDd || 'Current', ddStat.currentDd.toFixed(1) + '%', ddStat.currentDd < -0.05 ? down : up),
            stat(t.perfRecovery || 'Status', ddStat.recovered ? (t.perfRecovered || 'Recovered') : (t.perfUnderwater || 'Underwater'), ddStat.recovered ? up : down)));
      })() : null;

      // ---- #3 goal projection (snapshot CAGR + contributions) ----
      var goals = [];
      try { goals = JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem('investmentGoals')) || '[]') || []; } catch (e2) { goals = []; }
      var currentValue = series.length ? series[series.length - 1].v : 0;
      var assumedReturn = cagrFromSeries(series);
      var goalSection = (hasData && goals.length) ? e('div', { style: { marginBottom: '1.5rem' } },
        e('div', { style: { color: text, fontSize: '0.92rem', fontWeight: 700, marginBottom: '0.8rem' } }, t.perfGoalsTitle || 'Goal projection'),
        e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' } },
          goals.slice(0, 4).map(function (g, gi) {
            var target = parseFloat(g.targetAmount) || 0;
            var eta = goalEta({ current: currentValue, target: target, monthly: parseFloat(g.monthlyContribution) || 0, annualReturnPct: assumedReturn });
            var prog = target > 0 ? Math.min(100, (currentValue / target) * 100) : 0;
            return e('div', { key: g.id || gi, style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem' } },
              e('div', { style: { color: text, fontWeight: 700, fontSize: '0.88rem' } }, g.name || (t.perfGoal || 'Goal')),
              e('div', { style: { color: dim, fontSize: '0.76rem', marginTop: '0.15rem' } }, fmt(currentValue) + ' / ' + fmt(target) + ' ' + sym),
              e('div', { style: { height: '7px', borderRadius: '999px', background: theme.inputBg || '#0c1018', margin: '0.5rem 0', overflow: 'hidden' } },
                e('div', { style: { width: prog.toFixed(0) + '%', height: '100%', background: up } })),
              e('div', { style: { color: eta.alreadyReached ? up : text, fontSize: '0.82rem', fontWeight: 600 } },
                eta.alreadyReached ? (t.perfGoalReached || '✓ Reached')
                  : eta.reachable ? ((t.perfGoalEta || 'On track — ') + eta.etaISO)
                  : (t.perfGoalUnreachable || 'Not reachable at the current pace')));
          })),
        e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.6rem' } },
          (t.perfGoalAssume || 'Assumes your historical return') + (assumedReturn != null ? ' (' + assumedReturn.toFixed(1) + '%/yr)' : '') + (t.perfGoalPlusContrib || ' plus your monthly contribution.'))) : null;

      // ---- #1 benchmark comparison ----
      var benchRows = (benchData && benchData.length) ? PERIODS.filter(function (p) { return ['1M', '3M', '6M', '1Y'].indexOf(p.id) !== -1; }).map(function (p) { return compareBenchmark(series, benchData, p.id, props.asOf); }).filter(Boolean) : [];
      var benchSection = (hasData && benches.length) ? e('div', { style: { marginBottom: '1.5rem' } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.8rem' } },
          e('div', { style: { color: text, fontSize: '0.92rem', fontWeight: 700, marginRight: '0.3rem' } }, t.perfBenchTitle || 'vs. Benchmark'),
          benches.map(function (b) {
            return e('button', { key: b.key, type: 'button', onClick: function () { setBenchKey(b.key); },
              style: { font: 'inherit', cursor: 'pointer', padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.74rem', fontWeight: 700, border: '1px solid ' + (benchKey === b.key ? (theme.accent || '#f5a524') : border), background: benchKey === b.key ? (theme.accent || '#f5a524') : 'transparent', color: benchKey === b.key ? (theme.accentText || '#13110a') : dim } }, b.label);
          })),
        !workerBase ? e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem', color: dim, fontSize: '0.85rem' } }, t.perfBenchNoWorker || 'Add a Worker URL in API Settings to compare against an index.')
          : benchLoading ? e('div', { style: { color: dim, fontSize: '0.85rem' } }, (t.loading || 'Loading') + ' …')
          : benchRows.length ? e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', overflow: 'hidden' } },
              benchRows.map(function (r, ri) {
                return e('div', { key: r.id, style: { display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1rem', borderTop: ri ? '1px solid ' + border : 'none' } },
                  e('span', { style: { color: dim, fontSize: '0.72rem', fontWeight: 800, width: '40px' } }, r.label),
                  e('span', { title: t.perfBenchYou || 'You', style: { color: moveColor(r.port), fontWeight: 700, fontSize: '0.85rem', width: '74px', textAlign: 'right' } }, pctStr(r.port)),
                  e('span', { title: benchPreset ? benchPreset.label : 'Benchmark', style: { color: dim, fontSize: '0.78rem', width: '66px', textAlign: 'right' } }, r.bench == null ? '—' : pctStr(r.bench)),
                  e('span', { style: { flex: 1 } }),
                  r.rel == null ? null : e('span', { style: { color: r.rel >= 0 ? up : down, fontWeight: 800, fontSize: '0.82rem' } }, (r.rel >= 0 ? '+' : '') + r.rel.toFixed(1) + 'pp'));
              }))
          : e('div', { style: { color: dim, fontSize: '0.85rem' } }, t.perfBenchNoData || 'No benchmark data available yet.')) : null;

      return e('div', { style: { padding: '1.5rem' } },
        e('h2', { style: { color: text, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 0.35rem' } },
          t.navPerformance || 'Performance'),
        e('p', { style: { color: dim, fontSize: '0.88rem', margin: '0 0 1.25rem', lineHeight: 1.5, maxWidth: '60ch' } },
          t.perfSubtitle || 'Real period returns derived entirely from your on-device value history — no external API. A new daily point is recorded automatically while you use the app.'),

        hasData
          ? e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' } }, cardEls)
          : e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '2rem', textAlign: 'center', color: dim, fontSize: '0.9rem' } },
              t.perfEmpty || 'No value history yet. Snapshots are recorded once per day as you use the app — check back tomorrow to see your first period returns.'),

        (hasData && ext) ? e('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' } },
          e('div', { style: { flex: 1, minWidth: '200px', background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem' } },
            e('div', { style: { color: dim, fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' } }, t.perfBestDay || 'Best day'),
            e('div', { style: { color: up, fontSize: '1.05rem', fontWeight: 800, marginTop: '0.3rem' } }, ext.best ? pctStr(ext.best.pct) : '—'),
            e('div', { style: { color: dim, fontSize: '0.78rem', marginTop: '0.1rem' } }, ext.best ? ext.best.date : '')),
          e('div', { style: { flex: 1, minWidth: '200px', background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem' } },
            e('div', { style: { color: dim, fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' } }, t.perfWorstDay || 'Worst day'),
            e('div', { style: { color: down, fontSize: '1.05rem', fontWeight: 800, marginTop: '0.3rem' } }, ext.worst ? pctStr(ext.worst.pct) : '—'),
            e('div', { style: { color: dim, fontSize: '0.78rem', marginTop: '0.1rem' } }, ext.worst ? ext.worst.date : ''))) : null,

        (hasData && ext) ? e('div', { style: { height: '1.5rem' } }) : null,
        benchSection,
        ddCard,
        goalSection,

        e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '1rem', lineHeight: 1.5 } },
          (t.perfFootnote || 'Periods marked ≈ are measured from your first snapshot because the full look-back is not yet covered.')));
    } catch (err) {
      return e('div', { style: { padding: '1.5rem', color: (props.theme && props.theme.danger) || '#ef4444' } },
        'Performance view error: ' + (err && err.message));
    }
  }

  var api = {
    PERIODS: PERIODS,
    cleanSeries: cleanSeries,
    valueAsOf: valueAsOf,
    periodStartISO: periodStartISO,
    computePeriod: computePeriod,
    computeAll: computeAll,
    dailyExtremes: dailyExtremes,
    drawdownSeries: drawdownSeries,
    drawdownStats: drawdownStats,
    cagrFromSeries: cagrFromSeries,
    goalEta: goalEta,
    priceAsOf: priceAsOf,
    compareBenchmark: compareBenchmark,
    seriesFromSnapshots: seriesFromSnapshots,
    cards: cards,
    View: View,
    _toISO: toISO
  };

  if (typeof window !== 'undefined') window.MaerminPerformance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
