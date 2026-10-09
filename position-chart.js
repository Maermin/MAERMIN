// ============================================================================
// MAERMIN — Price chart of one position  (window.MaerminPositionChart)
// ----------------------------------------------------------------------------
// P4-2. The position detail dialog shows the holding's daily closes (EUR, from
// close-history.js) since its first buy, with a dashed average-cost line for an
// open position. A closed position (fully sold) shows the price only: there is
// no cost left to compare against.
//
//   prepare(closes, { from, avgCost, maxPoints })
//     closes: [[iso, eur]…] sorted by date
//     → null (fewer than 2 points) |
//       { pts: [{ d, v }], min, max, avg }   min/max include the average line
//   View({ series, avgCost, closed, firstDate, theme, formatPrice, getCurrencySymbol })
//
// prepare() is pure and Node-tested (test/position-chart.test.js).
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function prepare(closes, opts) {
    opts = opts || {};
    var from = opts.from ? String(opts.from).slice(0, 10) : '';
    var pts = (closes || []).filter(function (c) { return c && c[0] && c[1] > 0 && (!from || String(c[0]).slice(0, 10) >= from); })
      .map(function (c) { return { d: String(c[0]).slice(0, 10), v: +c[1] }; });
    if (pts.length < 2) return null;
    var max = opts.maxPoints > 1 ? opts.maxPoints : 365;
    if (pts.length > max) {
      // Even thinning; the first and the latest close always stay.
      var step = (pts.length - 1) / (max - 1), thin = [];
      for (var i = 0; i < max; i++) thin.push(pts[Math.round(i * step)]);
      pts = thin;
    }
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (p) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; });
    var avg = opts.avgCost > 0 ? +opts.avgCost : null;
    if (avg !== null) { lo = Math.min(lo, avg); hi = Math.max(hi, avg); }
    return { pts: pts, min: lo, max: hi, avg: avg };
  }

  function View(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var th = props.theme || {};
    var data = prepare(props.series && props.series.closes, { from: props.firstDate, avgCost: props.closed ? null : props.avgCost });
    var money = function (v) { return props.formatPrice(v) + ' ' + props.getCurrencySymbol(); };
    var box = { padding: '1rem 1.5rem 0.25rem', borderBottom: '1px solid ' + (th.modalBorder || th.cardBorder) };
    if (!data) {
      return e('div', { style: box },
        e('div', { style: { color: th.textSecondary, fontSize: '0.8rem', paddingBottom: '0.75rem' } }, __('pcNoHistory', 'No daily price history for this position yet.')));
    }
    var W = 480, H = 150, PAD = 6;
    var span = (data.max - data.min) || data.max * 0.02 || 1;
    var lo = data.min - span * 0.08, hi = data.max + span * 0.08;
    var x = function (i) { return PAD + (W - 2 * PAD) * (i / (data.pts.length - 1)); };
    var y = function (v) { return PAD + (H - 2 * PAD) * (1 - (v - lo) / (hi - lo)); };
    var line = data.pts.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(' ');
    var last = data.pts[data.pts.length - 1];
    var I = window.MaerminI18n;
    var label = __('pcAria', 'Daily closing price from {from} to {to}: {first} to {last}', { from: I.date(data.pts[0].d), to: I.date(last.d), first: money(data.pts[0].v), last: money(last.v) })
      + (data.avg !== null ? '. ' + __('pcAvgAria', 'Average cost {avg}', { avg: money(data.avg) }) : '');
    return e('div', { 'data-testid': 'position-chart', style: box },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' } },
        e('span', { style: { color: th.textSecondary, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, __('pcTitle', 'Price since the first buy')),
        data.avg !== null ? e('span', { 'data-testid': 'avg-cost-line', style: { color: th.text, fontSize: '0.76rem' } },
          e('span', { 'aria-hidden': true, style: { display: 'inline-block', width: '16px', borderTop: '2px dashed ' + th.textSecondary, verticalAlign: 'middle', marginRight: '0.35rem' } }),
          __('pcAvg', 'Average cost {avg}', { avg: money(data.avg) })) : null),
      e('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, preserveAspectRatio: 'none', role: 'img', 'aria-label': label, style: { display: 'block' } },
        e('path', { d: line, fill: 'none', stroke: th.accent, strokeWidth: 2, vectorEffect: 'non-scaling-stroke', strokeLinejoin: 'round' }),
        data.avg !== null ? e('line', { x1: PAD, x2: W - PAD, y1: y(data.avg), y2: y(data.avg), stroke: th.textSecondary, strokeWidth: 1.5, strokeDasharray: '6 5', vectorEffect: 'non-scaling-stroke' }) : null),
      e('div', { style: { display: 'flex', justifyContent: 'space-between', color: th.textSecondary, fontSize: '0.7rem', padding: '0.2rem 0 0.6rem' } },
        e('span', null, I.date(data.pts[0].d)), e('span', null, I.date(last.d))));
  }

  var api = { prepare: prepare, View: View };
  if (typeof window !== 'undefined') window.MaerminPositionChart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
