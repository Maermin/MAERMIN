// ============================================================================
// MAERMIN — Year in review  (window.MaerminYearReview)
// ----------------------------------------------------------------------------
// Audit 2026-10-24, feature 8. A card in Performance that sums up one calendar
// year from the app's own figures:
//   value      combined total at the end of the previous year and at the end
//              of this one (or today), from the value snapshots; left out when
//              a snapshot is missing (no estimate)
//   flows      invested, realised gains, dividends (net), fees and taxes of the
//              year: the difference of MaerminReturnFigures at the year's end
//              and at the previous year's end, so the year matches the
//              Returns page exactly
//   counts     buys, sales and dividend / interest payments dated in the year
// "Copy summary" copies a percent-and-counts-only text: no amount, no symbol,
// no portfolio name ever goes into it (test/year-review.test.js checks this).
//
//   years(transactions, today) -> [YYYY, …] newest first
//   review({ year, transactions, today, figures(txs, asOf) , snapshots, snapshotState })
//   shareText(review) -> string     Panel(props)
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function ymd(d) { return String(d == null ? '' : d).slice(0, 10); }
  var FIELDS = ['invested', 'realized', 'dividendsNet', 'fees', 'taxes'];

  function years(transactions, today) {
    var set = {};
    (transactions || []).forEach(function (t) { var y = parseInt(ymd(t && t.date).slice(0, 4), 10); if (y > 1900) set[y] = true; });
    var thisYear = parseInt(String(today || '').slice(0, 4), 10);
    return Object.keys(set).map(Number).filter(function (y) { return !thisYear || y <= thisYear; }).sort(function (a, b) { return b - a; });
  }

  function review(i) {
    i = i || {};
    var year = parseInt(i.year, 10);
    if (!(year > 1900) || typeof i.figures !== 'function') return null;
    var today = ymd(i.today);
    var end = String(year) + '-12-31', start = String(year - 1) + '-12-31';
    var partial = today && today < end;
    var asOf = partial ? today : end;
    var txs = i.transactions || [];
    var upTo = function (d) { return txs.filter(function (t) { var x = ymd(t && t.date); return x && x <= d; }); };
    var a = i.figures(upTo(start), start) || {}, b = i.figures(upTo(asOf), asOf) || {};
    var flows = {};
    FIELDS.forEach(function (k) {
      var vb = b[k], va = a[k];
      flows[k] = vb == null ? null : (Number(vb) || 0) - (Number(va) || 0);
    });
    var counts = { buys: 0, sells: 0, income: 0 };
    txs.forEach(function (t) {
      var d = ymd(t && t.date);
      if (d.slice(0, 4) !== String(year) || d > asOf) return;
      if (t.type === 'buy') counts.buys++;
      else if (t.type === 'sell') counts.sells++;
      else if (t.type === 'dividend' || t.type === 'interest') counts.income++;
    });
    var value = null;
    var S = i.snapshots;
    if (S && typeof S.valueAsOf === 'function' && i.snapshotState) {
      var s0 = S.valueAsOf(i.snapshotState, start, S.ALL), s1 = S.valueAsOf(i.snapshotState, asOf, S.ALL);
      // the start point must be from that year-end's month, not years older
      if (s0 && s1 && s0.d >= String(year - 1) + '-12-01' && s1.d > start) {
        value = { start: s0.v, end: s1.v, startDate: s0.d, endDate: s1.d, pct: s0.v ? (s1.v - s0.v) / s0.v * 100 : null };
      }
    }
    return { year: year, partial: !!partial, asOf: asOf, value: value, flows: flows, counts: counts };
  }

  // Percentages and counts only. Never amounts, symbols or names.
  function shareText(r) {
    if (!r) return '';
    var I = typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js');
    var parts = [__('yrShareHead', 'My MAERMIN year {y}', { y: r.year }) + (r.partial ? ' ' + __('yrSoFar', '(so far)') : '')];
    if (r.value && r.value.pct != null) parts.push(__('yrShareValue', 'portfolio value {pct} (incl. money added)', { pct: I.pct(r.value.pct, 1, true) }));
    parts.push(__('yrShareCounts', '{b} {b:buy|buys}, {s} {s:sale|sales}, {n} {n:dividend or interest payment|dividend and interest payments}', { b: r.counts.buys, s: r.counts.sells, n: r.counts.income }));
    return parts.join(' · ');
  }

  function Panel(props) {
    var React = window.React, h = React.createElement;
    var UIC = window.MaerminComponents || {};
    var today = props.today || window.MaerminUtils.todayISO();
    var list = years(props.transactions, today);
    var st = React.useState(list[0] || null), year = st[0], setYear = st[1];
    var cs = React.useState(''), copied = cs[0], setCopied = cs[1];
    if (!list.length) return null;
    var y = list.indexOf(year) > -1 ? year : list[0];
    var r = review({ year: y, transactions: props.transactions, today: today, figures: props.figures, snapshots: props.snapshots, snapshotState: props.snapshotState });
    if (!r) return null;
    var money = function (v) { return v == null ? '—' : props.formatPrice(v) + ' ' + props.getCurrencySymbol(); };
    var tile = function (key, label, value, tone) { return h(UIC.Stat, { key: key, className: 'ui-tile', 'data-stat': key, label: label, value: value, tone: tone || null }); };
    var tone = function (v) { return v > 0 ? 'gain' : v < 0 ? 'loss' : null; };
    var copy = function () {
      var text = shareText(r);
      var done = function () { setCopied(text); };
      try { navigator.clipboard.writeText(text).then(done, done); } catch (e) { done(); }
    };
    var picker = list.length > 1 && UIC.Segmented
      ? h(UIC.Segmented, { size: 'sm', label: __('yrPick', 'Year'), value: y, onChange: setYear, options: list.slice(0, 6).map(function (x) { return { value: x, label: String(x) }; }) })
      : null;
    return h(UIC.Card, { 'data-testid': 'year-review', className: 'ui-year-review',
      title: __('yrTitle', 'Year in review {y}', { y: y }) + (r.partial ? ' ' + __('yrSoFar', '(so far)') : ''),
      subtitle: __('yrSub', 'From your transactions and the value history on this device'), action: picker },
      h('div', { className: 'ui-tiles' },
        r.value ? tile('value', __('yrValue', 'Portfolio value'), h(UIC.Mask || 'span', { masked: !!props.privacyMode }, money(r.value.end) + (r.value.pct != null ? ' (' + window.MaerminI18n.pct(r.value.pct, 1, true) + ')' : '')), tone(r.value.pct)) : null,
        tile('invested', __('yrInvested', 'Invested'), money(r.flows.invested)),
        tile('realized', __('yrRealized', 'Realised gains'), money(r.flows.realized), tone(r.flows.realized)),
        tile('dividends', __('yrDividends', 'Dividends (net)'), money(r.flows.dividendsNet)),
        tile('fees', __('yrFees', 'Fees'), money(r.flows.fees)),
        tile('taxes', __('yrTaxes', 'Taxes'), money(r.flows.taxes))),
      h('p', { className: 'ui-note' }, __('yrCounts', '{b} {b:buy|buys}, {s} {s:sale|sales}, {n} {n:dividend or interest payment|dividend and interest payments}', { b: r.counts.buys, s: r.counts.sells, n: r.counts.income })
        + (r.value ? '' : ' · ' + __('yrNoValue', 'No value history for the start or end of this year on this device.'))),
      h('div', { className: 'ui-actions' },
        UIC.Button ? h(UIC.Button, { size: 'sm', 'data-testid': 'year-review-copy', onClick: copy }, __('yrCopy', 'Copy summary (percent only)')) : null,
        copied ? h('span', { className: 'ui-muted', role: 'status', 'data-testid': 'year-review-copied' }, __('yrCopied', 'Copied: {text}', { text: copied })) : null));
  }

  var api = { years: years, review: review, shareText: shareText, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminYearReview = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
