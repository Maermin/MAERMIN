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
    seriesFromSnapshots: seriesFromSnapshots,
    cards: cards,
    View: View,
    _toISO: toISO
  };

  if (typeof window !== 'undefined') window.MaerminPerformance = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
