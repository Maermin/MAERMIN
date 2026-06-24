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

  // PURE: the next report among the rows (closest upcoming), or null.
  function nextReport(calendar) {
    return (Array.isArray(calendar) && calendar.length) ? calendar[0] : null;
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
      var uniq = Array.from(new Set(symbols.map(function (s) { return String(s).toUpperCase(); }))).slice(0, 40);
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
        else setState({ loading: false, rows: [], unsupported: false, error: 'Could not load earnings' });
      });
      return function () { alive = false; };
    }, [workerUrl, symbols.join(',')]);

    var card = function (children) {
      return h('div', { style: { background: th.card || '#10151f', border: '1px solid ' + (th.cardBorder || 'rgba(255,255,255,0.07)'), borderRadius: '14px', padding: '1.25rem', marginTop: '1rem' } }, children);
    };
    var title = h('div', { style: { fontWeight: 800, color: th.text || '#e9edf4', marginBottom: '0.75rem' } }, 'Earnings Calendar');

    if (!workerUrl || workerUrl.length < 5) {
      return card([title, h('div', { key: 'm', style: { fontSize: '0.8rem', color: th.textSecondary || '#8b94a7' } }, 'Add a Worker URL in API Settings to see upcoming earnings dates for your holdings.')]);
    }
    if (state.unsupported) {
      return card([title, h('div', { key: 'm', style: { fontSize: '0.8rem', color: th.textSecondary || '#8b94a7' } }, 'Your Worker does not support earnings yet. Re-deploy the latest cf-worker/worker.js (action=earnings).')]);
    }
    if (state.loading) return card([title, h('div', { key: 'm', style: { fontSize: '0.8rem', color: th.textSecondary || '#8b94a7' } }, 'Loading…')]);
    if (state.error) return card([title, h('div', { key: 'm', style: { fontSize: '0.8rem', color: th.danger || '#f87171' } }, state.error)]);
    if (!state.rows.length) return card([title, h('div', { key: 'm', style: { fontSize: '0.8rem', color: th.textSecondary || '#8b94a7' } }, 'No upcoming earnings found for your holdings.')]);

    return card([
      title,
      h('div', { key: 'list', role: 'list' }, state.rows.slice(0, 20).map(function (r) {
        return h('div', { key: r.symbol, role: 'listitem', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.45rem 0', borderBottom: '1px solid ' + (th.cardBorder || 'rgba(255,255,255,0.05)') } },
          h('div', null,
            h('div', { style: { fontWeight: 700, color: th.text || '#e9edf4' } }, r.symbol),
            h('div', { style: { fontSize: '0.72rem', color: th.textSecondary || '#8b94a7' } }, r.epsEstimate != null ? ('Est. EPS ' + r.epsEstimate.toFixed(2)) : (r.name || ''))
          ),
          h('div', { style: { textAlign: 'right' } },
            h('div', { style: { fontWeight: 700, color: th.text || '#e9edf4' } }, r.earningsDate + (r.isEstimate ? ' (est.)' : '')),
            h('div', { style: { fontSize: '0.72rem', color: th.accent || '#f5a524' } }, 'in ' + r.daysUntil + ' day' + (r.daysUntil === 1 ? '' : 's'))
          )
        );
      }))
    ]);
  }

  var api = { parseResponse: parseResponse, buildCalendar: buildCalendar, nextReport: nextReport, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminEarnings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
