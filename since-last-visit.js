// ============================================================================
// MAERMIN — "Since your last visit"  (window.MaerminSinceVisit)
// ----------------------------------------------------------------------------
// Audit 2026-10-24, feature 5. On the first open of a new day the Overview
// shows what changed since the last day the app was open, from data the app
// already has:
//   value     the combined total from the value snapshots (portfolio-
//             snapshots.js) on the last-visit day vs the latest point. It is
//             the value, so money added or taken out is part of the change.
//   income    dividends and interest dated after the last visit, up to today
//   plans     savings-plan executions dated after the last visit
// Nothing is estimated: a part without data is left out, and the card is not
// shown when nothing is left.
//
// The last-visit day lives in 'maermin_last_visit' (YYYY-MM-DD, local date).
// It is device-local on purpose: not in the backup KEYS and not a sensitive
// key, so sync never carries it (two devices would keep overwriting it). It
// holds a date only, no amounts.
//
//   begin(storage, today) -> previous visit day or null; records today
//   summarize({ since, today, snapshots, transactions }) -> summary or null
//   Card({ summary, masked, formatValue, onClose })
// Pure parts tested in test/since-last-visit.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var KEY = 'maermin_last_visit';
  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  function begin(storage, today) {
    var prev = null;
    try { var v = storage && storage.getItem(KEY); prev = ISO.test(v || '') ? v : null; } catch (e) { prev = null; }
    try { if (storage && ISO.test(today || '')) storage.setItem(KEY, today); } catch (e) { /* storage full or read-only tab */ }
    return prev;
  }

  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

  function summarize(input) {
    var i = input || {};
    var since = i.since, today = i.today;
    if (!ISO.test(since || '') || !ISO.test(today || '') || since >= today) return null;
    var out = { since: since, days: days(since, today), value: null, income: 0, plans: 0 };
    var S = i.snapshots;
    if (S && typeof S.changeBetween === 'function' && i.snapshotState) {
      var ch = S.changeBetween(i.snapshotState, since, null, S.ALL);
      if (ch && ch.end && ch.end.d > since) out.value = { abs: ch.abs, pct: ch.pct };
    }
    (i.transactions || []).forEach(function (tx) {
      var d = String((tx && tx.date) || '').slice(0, 10);
      if (!(d > since && d <= today)) return;
      if (tx.type === 'dividend' || tx.type === 'interest') out.income++;
      else if (tx.source === 'savings-plan' && tx.type === 'buy') out.plans++;
    });
    return (out.value || out.income || out.plans) ? out : null;
  }

  function Card(props) {
    var React = window.React, h = React.createElement;
    var UIC = window.MaerminComponents || {};
    var s = props.summary;
    if (!s) return null;
    var rows = [];
    if (s.value) {
      var sign = s.value.abs > 0 ? 'gain' : s.value.abs < 0 ? 'loss' : 'neutral';
      var amount = (s.value.abs > 0 ? '+' : '') + (props.formatValue ? props.formatValue(s.value.abs) : String(s.value.abs));
      var pct = s.value.pct != null ? ' (' + (s.value.pct > 0 ? '+' : '') + window.MaerminI18n.num(s.value.pct, 2) + ' %)' : '';
      rows.push(h('li', { key: 'v', 'data-part': 'value' },
        h('span', null, __('slvValue', 'Portfolio value')),
        h('span', { className: 'num tone-' + sign }, UIC.Mask ? h(UIC.Mask, { masked: !!props.masked }, amount + pct) : amount + pct),
        h('span', { className: 'ui-muted' }, __('slvValueHint', 'includes money added or taken out'))));
    }
    if (s.income) rows.push(h('li', { key: 'i', 'data-part': 'income' }, __('slvIncome', '{n} {n:dividend or interest payment|dividend and interest payments} booked', { n: s.income })));
    if (s.plans) rows.push(h('li', { key: 'p', 'data-part': 'plans' }, __('slvPlans', '{n} savings-plan {n:execution|executions} booked', { n: s.plans })));
    var close = UIC.Button ? h(UIC.Button, { variant: 'quiet', size: 'sm', 'data-testid': 'since-visit-close', onClick: props.onClose }, __('dismiss', 'Dismiss')) : null;
    return h(UIC.Card, { className: 'ui-since-visit', 'data-testid': 'since-visit',
      title: __('slvTitle', 'Since your last visit'),
      subtitle: __('slvSince', '{date} · {n} {n:day|days} ago', { date: window.MaerminI18n.date(s.since, 'medium'), n: s.days }), action: close },
      h('ul', { className: 'ui-since-visit__list' }, rows));
  }

  var api = { KEY: KEY, begin: begin, summarize: summarize, Card: Card };
  if (typeof window !== 'undefined') window.MaerminSinceVisit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
