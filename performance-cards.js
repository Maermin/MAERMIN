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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

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
  // The user's local calendar day (the snapshots are dated by it too).
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

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
  function valuePathApi() {
    if (typeof window !== 'undefined' && window.MaerminValuePath) return window.MaerminValuePath;
    try { return typeof require === 'function' ? require('./value-path.js') : null; } catch (e) { return null; }
  }

  // opts.flows: [{ d, amount }] money put in (+) / taken out (-) in EUR, as
  // MaerminValuePath.flowsOf builds them. With flows the card shows the
  // time-weighted return (chain-linked like the TWR card) and the gain without
  // the deposits - a savings-plan buy is not performance (AUDIT BUG-024).
  function computePeriod(series, periodId, asOfISO, opts) {
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
    var flows = opts && Array.isArray(opts.flows) ? opts.flows : null;
    if (flows && end.d > start.d) {
      var inWindow = flows.filter(function (f) { return f && f.d > start.d && f.d <= end.d; });
      if (inWindow.length) {
        var VP = valuePathApi();
        var pts = s.filter(function (p) { return p.d >= start.d && p.d <= end.d; });
        var tw = VP && VP.fromValues ? VP.fromValues(pts, inWindow) : null;
        var net = inWindow.reduce(function (sum, f) { return sum + (Number(f.amount) || 0); }, 0);
        abs = end.v - start.v - net;
        pct = tw ? tw.twr * 100 : null; // snapshots and transactions disagree: no figure
      }
    }
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
  function computeAll(series, asOfISO, opts) {
    var s = cleanSeries(series);
    if (!s.length) return [];
    return PERIODS.map(function (p) { return computePeriod(s, p.id, asOfISO, opts); })
                  .filter(Boolean);
  }

  // Day-over-day moves without the money put in or taken out (P5-1.8): a buy
  // or a sale is not a gain or a loss. flows = [{ d, amount }] as for the
  // period cards; the value path's rule applies (flows at the end of the day,
  // MaerminValuePath.fromValues). Without flows - or when the snapshots and the
  // transactions do not describe the same book - the raw moves are used.
  // -> [{ d, r, abs }] (r as a fraction, abs in EUR), or [] for < 2 points.
  function neutralSteps(series, flows) {
    var s = cleanSeries(series), out = [];
    if (s.length < 2) return out;
    var fl = Array.isArray(flows) ? flows.filter(function (f) { return f && /^\d{4}-\d{2}-\d{2}$/.test(f.d) && isFinite(f.amount); }) : [];
    var VP = fl.length ? valuePathApi() : null;
    var tw = VP && VP.fromValues ? VP.fromValues(s, fl) : null;
    var flowIn = function (from, to) { return fl.reduce(function (sum, f) { return f.d > from && f.d <= to ? sum + Number(f.amount) : sum; }, 0); };
    if (tw && tw.steps) {
      var at = {};
      for (var k = 1; k < s.length; k++) at[s[k].d] = s[k].v - s[k - 1].v - flowIn(s[k - 1].d, s[k].d);
      return tw.steps.map(function (st) { return { d: st.d, r: st.r, abs: at[st.d] }; });
    }
    for (var i = 1; i < s.length; i++) {
      if (s[i - 1].v === 0) continue;
      out.push({ d: s[i].d, r: s[i].v / s[i - 1].v - 1, abs: s[i].v - s[i - 1].v });
    }
    return out;
  }
  // The series as a flow-neutral index on the scale of its first value.
  function neutralIndex(series, flows) {
    var s = cleanSeries(series);
    if (!s.length) return [];
    var v = s[0].v, out = [{ d: s[0].d, v: v }];
    neutralSteps(s, flows).forEach(function (st) { v = v * (1 + st.r); out.push({ d: st.d, v: v }); });
    return out;
  }

  // Quick "best/worst single day" over the series — a cheap insight the value
  // history makes free. Returns { best, worst } day-over-day moves or null.
  function dailyExtremes(series, flows) {
    var best = null, worst = null;
    neutralSteps(series, flows).forEach(function (st) {
      var move = { date: st.d, abs: st.abs, pct: st.r * 100 };
      if (!best || move.pct > best.pct) best = move;
      if (!worst || move.pct < worst.pct) worst = move;
    });
    return (best || worst) ? { best: best, worst: worst } : null;
  }

  // ---- #2 Drawdown / underwater (snapshot-derived) -------------------------
  // Per-point drawdown from the running peak: [{ d, dd }] with dd <= 0 (percent).
  function drawdownSeries(series, flows) {
    var s = neutralIndex(series, flows);
    var peak = -Infinity, out = [];
    for (var i = 0; i < s.length; i++) {
      if (s[i].v > peak) peak = s[i].v;
      out.push({ d: s[i].d, dd: peak > 0 ? (s[i].v / peak - 1) * 100 : 0 });
    }
    return out;
  }
  // Worst peak-to-trough drawdown + recovery info + the current drawdown.
  function drawdownStats(series, flows) {
    var s = neutralIndex(series, flows);
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
  function cagrFromSeries(series, flows) {
    var s = neutralIndex(series, flows);
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
    return { months: m, reachable: true, etaISO: (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO(d), projectedValue: v };
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
  function compareBenchmark(series, benchPoints, periodId, asOf, opts) {
    var s = cleanSeries(series);
    if (!s.length || !Array.isArray(benchPoints) || !benchPoints.length) return null;
    var pr = computePeriod(s, periodId, asOf, opts);
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
      var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
      var fmt = props.formatPrice || function (n) { return window.MaerminI18n.num(n, 2); };
      var sym = props.getCurrencySymbol ? props.getCurrencySymbol() : '€';

      var series = props.series || seriesFromSnapshots(props.portfolioId);
      var VPa = valuePathApi();
      var flows = (VPa && VPa.flowsOf && Array.isArray(props.transactions))
        ? VPa.flowsOf(props.transactions, { exchangeRate: props.exchangeRate, fxAt: props.fxAt }) : null;
      var rows = computeAll(series, props.asOf, { flows: flows });
      var ext = dailyExtremes(series, flows);

      function pctStr(p) { return (p == null) ? '—' : window.MaerminI18n.pct(p, 2, true); }
      // Period chips: 1M 3M 6M YTD 1Y Max in the UI language.
      function periodLabel(l) { return l === 'Max' ? __('chMax', 'Max') : l === 'YTD' ? __('perfYtd', 'YTD') : l.replace(/Y$/, __('chUnitY', 'Y')).replace(/M$/, __('chUnitM', 'M')); }

      // R4.1: period cards as Stat tiles, the shared Card, Segmented, Table and
      // ChartFrame; every move carries its sign.
      var UIC = window.MaerminComponents, I = window.MaerminI18n;
      var signedMoney = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v)) + ' ' + sym; };
      var cardEls = rows.map(function (r) {
        return e(UIC.Card, { key: r.id, variant: 'answer', className: 'ui-perf-tile', 'data-period': r.id },
          e(UIC.Stat, {
            label: e(React.Fragment, null, periodLabel(r.label), r.partial ? e('span', { className: 'ui-perf-tile__partial', title: t.perfPartial || 'Since inception (history shorter than this period)' }, ' ≈') : null),
            value: pctStr(r.pct), tone: UIC.toneOf(r.abs), sub: signedMoney(r.abs)
          }));
      });

      var hasData = rows.length > 0;

      // ---- #2 drawdown / underwater card ----
      var ddStat = drawdownStats(series, flows);
      var ddSer = drawdownSeries(series, flows);
      var ddCard = (hasData && ddStat) ? (function () {
        var minDd = Math.min.apply(null, ddSer.map(function (p) { return p.dd; }).concat([0]));
        var n = ddSer.length;
        var pts = ddSer.map(function (p, i) {
          var x = (n > 1 ? i / (n - 1) : 0) * 300;
          var y = (minDd < 0 ? p.dd / minDd : 0) * 70;
          return x.toFixed(1) + ',' + y.toFixed(1);
        });
        var areaPath = 'M0,0 L' + pts.join(' L') + ' L300,0 Z';
        return e(UIC.ChartFrame, { 'data-testid': 'perf-drawdown', title: t.perfDrawdownTitle || 'Drawdown (underwater)',
          summary: (t.perfMaxDrawdown || 'Max drawdown') + ' ' + I.pct(ddStat.maxDd, 1),
          legend: [{ series: 'loss', label: __('perfDdLegend', 'below the last high') }] },
          e('svg', { viewBox: '0 0 300 80', preserveAspectRatio: 'none', className: 'ui-perf-dd', 'aria-hidden': 'true' },
            e('line', { x1: 0, y1: 0, x2: 300, y2: 0, className: 'ui-perf-dd__base' }),
            e('path', { d: areaPath, className: 'ui-perf-dd__area' })),
          e('div', { className: 'ui-tiles' },
            e(UIC.Stat, { className: 'ui-tile', label: (window.MaerminGlossary ? e(window.MaerminGlossary.Term, { id: 'maxDrawdown' }, (t.perfMaxDrawdown || 'Max drawdown')) : (t.perfMaxDrawdown || 'Max drawdown')), value: I.pct(ddStat.maxDd, 1), tone: ddStat.maxDd < 0 ? 'loss' : null }),
            e(UIC.Stat, { className: 'ui-tile', label: t.perfCurrentDd || 'Current', value: I.pct(ddStat.currentDd, 1), tone: ddStat.currentDd < -0.05 ? 'loss' : null }),
            e(UIC.Stat, { className: 'ui-tile', label: t.perfRecovery || 'Status', value: ddStat.recovered ? '▲ ' + (t.perfRecovered || 'Recovered') : '▼ ' + (t.perfUnderwater || 'Underwater'), tone: ddStat.recovered ? 'gain' : 'loss' })));
      })() : null;

      // ---- #3 goal projection (snapshot CAGR + contributions) ----
      var goals = [];
      try { goals = JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem('investmentGoals')) || '[]') || []; } catch (e2) { goals = []; }
      var currentValue = series.length ? series[series.length - 1].v : 0;
      var assumedReturn = cagrFromSeries(series, flows);
      var goalSection = (hasData && goals.length) ? e(UIC.Card, { title: t.perfGoalsTitle || 'Goal projection', headingLevel: 'h3', 'data-testid': 'perf-goals',
          subtitle: (t.perfGoalAssume || 'Assumes your historical return') + (assumedReturn != null ? ' (' + __('perfPerYr', '{pct}/yr', { pct: I.pct(assumedReturn, 1) }) + ')' : '') + (t.perfGoalPlusContrib || ' plus your monthly contribution.') },
        e('div', { className: 'ui-perf-goals' },
          goals.slice(0, 4).map(function (g, gi) {
            var target = parseFloat(g.targetAmount) || 0;
            var eta = goalEta({ current: currentValue, target: target, monthly: parseFloat(g.monthlyContribution) || 0, annualReturnPct: assumedReturn });
            var prog = target > 0 ? Math.min(100, (currentValue / target) * 100) : 0;
            return e('div', { key: g.id || gi, className: 'ui-tile' },
              e('b', { className: 'ui-perf-goal__name' }, g.name || (t.perfGoal || 'Goal')),
              e('div', { className: ['ui-perf-goal__meta', 'num'].join(' ') }, fmt(currentValue) + ' / ' + fmt(target) + ' ' + sym),
              e('div', { className: 'ui-perf-goal__track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(prog) },
                e('span', { style: { width: prog.toFixed(0) + '%' } })), // CSS width
              e('div', { className: ['ui-perf-goal__eta', eta.alreadyReached ? 'tone-gain' : ''].join(' ').trim() },
                eta.alreadyReached ? (t.perfGoalReached || '✓ Reached')
                  : eta.reachable ? ((t.perfGoalEta || 'On track — ') + I.date(eta.etaISO, 'medium'))
                  : (t.perfGoalUnreachable || 'Not reachable at the current pace')));
          }))) : null;

      // ---- #1 benchmark comparison ----
      var benchRows = (benchData && benchData.length) ? PERIODS.filter(function (p) { return ['1M', '3M', '6M', '1Y'].indexOf(p.id) !== -1; }).map(function (p) { return compareBenchmark(series, benchData, p.id, props.asOf, { flows: flows }); }).filter(Boolean) : [];
      var benchLabel = benchPreset ? benchPreset.label : __('perfBenchmark', 'Benchmark');
      var benchSection = (hasData && benches.length) ? e(UIC.Card, { title: t.perfBenchTitle || 'vs. Benchmark', headingLevel: 'h3', 'data-testid': 'perf-bench',
          action: e(UIC.Segmented, { label: __('perfBenchmark', 'Benchmark'), value: benchKey, size: 'sm', onChange: setBenchKey,
            options: benches.map(function (b) { return { value: b.key, label: b.label }; }) }) },
        !workerBase ? window.MaerminUtils.emptyState({ kind: 'worker', text: t.perfBenchNoWorker || 'Add a Worker URL in API Settings to compare against an index.', action: window.MaerminUI && window.MaerminUI.workerAction ? window.MaerminUI.workerAction() : undefined })
          : benchLoading ? window.MaerminUtils.loadingNote((t.loading || 'Loading') + ' …')
          : benchRows.length ? e(UIC.Table, {
              caption: t.perfBenchTitle || 'vs. Benchmark', rows: benchRows, rowKey: function (r) { return r.id; },
              columns: [
                { key: 'label', label: __('vaPeriod', 'Period'), phone: 'title', render: function (r) { return periodLabel(r.label); } },
                { key: 'port', label: t.perfBenchYou || 'You', align: 'right', phone: 'value', render: function (r) { return e(UIC.ToneChip, { value: r.port || 0, text: pctStr(r.port) }); } },
                { key: 'bench', label: benchLabel, align: 'right', phone: 'meta', render: function (r) { return r.bench == null ? '—' : pctStr(r.bench); } },
                { key: 'rel', label: __('perfBenchDiff', 'Difference'), align: 'right', phone: 'sub', render: function (r) { return r.rel == null ? '—' : e(UIC.ToneChip, { value: r.rel, text: __('ppValue', '{v} pp', { v: (r.rel >= 0 ? '+' : '') + I.num(r.rel, 1) }) }); } }
              ]
            })
          : e('p', { className: 'ui-muted' }, t.perfBenchNoData || 'No benchmark data available yet.')) : null;

      var dayTile = function (key, label, d) {
        return e(UIC.Card, { variant: 'answer', className: 'ui-ov-tile', 'data-testid': 'perf-' + key },
          e(UIC.Stat, { label: label, value: d ? pctStr(d.pct) : '—', tone: d ? UIC.toneOf(d.pct) : null, sub: d ? I.date(d.date) : '' }));
      };

      return e('div', { className: 'ui-view', 'data-testid': 'performance-view' },
        e('div', { className: 'ui-view__bar' },
          e('p', { className: 'ui-view__lead' },
            t.perfSubtitle || 'Real period returns derived entirely from your on-device value history — no external API. A new daily point is recorded automatically while you use the app.'),
          props.demo && window.MaerminDemoFixtures ? window.MaerminDemoFixtures.badge(React, theme, workerBase) : null),
        props.map || null,
        hasData
          ? e('div', { className: 'ui-perf-tiles', 'data-testid': 'perf-periods' }, cardEls)
          : e(UIC.Card, { className: 'ui-card--pad', 'data-testid': 'perf-empty' }, e('p', { className: 'ui-muted' },
              // VIS-009: the demo records no snapshots - say so instead of "check back tomorrow"
              props.demo ? __('perfEmptyDemo', 'Period returns come from the daily snapshots recorded while you use the app with your own data; the demo records none.')
                : (t.perfEmpty || 'No value history yet. Snapshots are recorded once per day as you use the app — check back tomorrow to see your first period returns.'))),
        (hasData && ext) ? e('div', { className: 'ui-ov-tiles' },
          dayTile('best', t.perfBestDay || 'Best day', ext.best), dayTile('worst', t.perfWorstDay || 'Worst day', ext.worst)) : null,
        benchSection,
        ddCard,
        goalSection,
        hasData ? e('p', { className: 'ui-note' },
          (t.perfFootnote || 'Periods marked ≈ are measured from your first snapshot because the full look-back is not yet covered.')) : null);
    } catch (err) {
      return window.MaerminUtils.errorNote(__('perfViewError', 'Performance view error: {msg}', { msg: err && err.message })); // R5.4
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
    View: View
  };

  if (typeof window !== 'undefined') window.MaerminPerformance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
