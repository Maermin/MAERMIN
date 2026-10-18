// ============================================================================
// MAERMIN — Earnings Calendar  (window.MaerminEarnings)
// ----------------------------------------------------------------------------
// Upcoming earnings dates for the stocks you hold — a feature Stock Events /
// getquin are loved for. Read-only, gated exactly like Discovery: the Worker's
// `action=earnings` route is the single data source; an older Worker (400/404)
// shows an upgrade note instead of breaking.
//
// The parse + calendar-build are PURE and Node-tested; the React `Panel` is a
// thin fetch shell over them. Nothing is persisted.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var DAY_MS = 24 * 60 * 60 * 1000;

  function numOrNull(x) { var n = Number(x); return isFinite(n) ? n : null; }

  // PURE: normalise one Worker earnings response into a known row (or null).
  function parseResponse(json) {
    if (!json || typeof json !== 'object' || json.error || !json.symbol) return null;
    if (!json.earningsDate) return null;
    return {
      symbol: String(json.symbol).toUpperCase(),
      name: json.name || json.symbol,
      currency: json.currency || 'USD',
      earningsDate: json.earningsDate,
      earningsDateEnd: json.earningsDateEnd || null,
      isEstimate: !!json.isEstimate,
      epsEstimate: numOrNull(json.epsEstimate),
      revenueEstimate: numOrNull(json.revenueEstimate)
    };
  }

  // PURE: build the calendar from parsed rows. Keeps only the future ones inside
  // `months`, adds daysUntil, sorts by date.
  function buildCalendar(rows, opts) {
    opts = opts || {};
    var now = typeof opts.now === 'number' ? opts.now : Date.now();
    var months = typeof opts.months === 'number' ? opts.months : 6;
    var today = new Date(now); today.setHours(0, 0, 0, 0);
    var floor = today.getTime();
    var horizon = new Date(today); horizon.setMonth(horizon.getMonth() + months);
    var out = (Array.isArray(rows) ? rows : [])
      .filter(Boolean)
      .map(function (r) {
        var t = new Date(r.earningsDate + 'T00:00:00').getTime();
        return isNaN(t) ? null : Object.assign({}, r, { _t: t, daysUntil: Math.round((t - floor) / DAY_MS) });
      })
      .filter(function (r) { return r && r._t >= floor && r._t <= horizon.getTime(); })
      .sort(function (a, b) { return a._t - b._t; })
      .map(function (r) { delete r._t; return r; });
    return out;
  }

  // ---- React panel (browser only) ------------------------------------------
  function Panel(props) {
    if (typeof React === 'undefined') return null;
    var h = React.createElement;
    var useState = React.useState, useEffect = React.useEffect;
    var th = (props && props.theme) || {};
    var workerUrl = ((props && props.workerUrl) || '').trim().replace(/\/$/, '');
    var symbols = ((props && props.symbols) || []).filter(Boolean);

    var st = useState({ loading: false, rows: [], unsupported: false, error: null });
    var state = st[0], setState = st[1];

    useEffect(function () {
      if (!workerUrl || workerUrl.length < 5 || !symbols.length) return;
      var alive = true;
      setState({ loading: true, rows: [], unsupported: false, error: null });
      var NL = window.MaerminCloseHistory && window.MaerminCloseHistory.noListing;
      var uniq = Array.from(new Set(symbols.map(function (s) { return String(s).toUpperCase(); })))
        .filter(function (s) { return !(NL && NL.has(s)); }).slice(0, 40); // no Yahoo listing (AUDIT BUG-036)
      Promise.all(uniq.map(function (sym) {
        return fetch(workerUrl + '?action=earnings&symbol=' + encodeURIComponent(sym))
          .then(function (r) {
            if (r.status === 400 || r.status === 404) { var e = new Error('unsupported'); e.unsupported = true; throw e; }
            if (!r.ok) return null;
            return r.json();
          })
          .then(function (j) { return parseResponse(j); })
          .catch(function (e) { if (e && e.unsupported) throw e; return null; });
      })).then(function (parsed) {
        if (!alive) return;
        var cal = buildCalendar(parsed.filter(Boolean));
        setState({ loading: false, rows: cal, unsupported: false, error: null });
      }, function (e) {
        if (!alive) return;
        if (e && e.unsupported) setState({ loading: false, rows: [], unsupported: true, error: null });
        else setState({ loading: false, rows: [], unsupported: false, error: __('ecLoadFailed', 'Could not load earnings') });
      });
      return function () { alive = false; };
    }, [workerUrl, symbols.join(',')]);

    // R4.6: Card with the sample badge as its action, the shared rows
    var UIC = window.MaerminComponents;
    var card = function (body) {
      return h(UIC.Card, { className: 'ui-ec', headingLevel: 'h3', title: __('ecTitle', 'Earnings Calendar'),
        action: window.MaerminDemoFixtures ? window.MaerminDemoFixtures.badge(React, th, workerUrl) : null }, body);
    };
    var note = function (msg, err) { return h('p', { className: err ? ['ui-muted', 'is-error'].join(' ') : 'ui-muted' }, msg); };

    if (!workerUrl || workerUrl.length < 5) return card(window.MaerminUtils.workerNote(__('ecNeedWorker', 'Add a Worker URL in API Settings to see upcoming earnings dates for your holdings.')));
    if (state.unsupported) return card(note(__('ecUnsupported', 'Your Worker does not support earnings yet. Re-deploy the latest cf-worker/worker.js (action=earnings).')));
    if (state.loading) return card(note(__('loadingEllipsis', 'Loading…')));
    if (state.error) return card(note(state.error, true));
    if (!state.rows.length) return card(note(__('ecNone', 'No upcoming earnings found for your holdings.')));

    return card(h('ul', { className: 'ui-rows' }, state.rows.slice(0, 20).map(function (r) {
      return h('li', { key: r.symbol, className: 'ui-rows__row' },
        h('div', { className: 'ui-rows__main' },
          h('b', null, r.symbol),
          h('span', null, r.epsEstimate != null ? __('ecEstEps', 'Est. EPS {v}', { v: window.MaerminI18n.num(r.epsEstimate, 2) }) : (r.name || ''))),
        h('div', { className: 'ui-rows__side' },
          h('b', { className: 'num' }, window.MaerminI18n.date(r.earningsDate) + (r.isEstimate ? ' ' + __('ecEst', '(est.)') : '')),
          h('span', null, __('ecInDays', 'in {n} {n:day|days}', { n: r.daysUntil }))));
    })));
  }

  var api = { parseResponse: parseResponse, buildCalendar: buildCalendar, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminEarnings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
