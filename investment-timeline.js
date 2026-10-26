// ============================================================================
// MAERMIN — Investment calendar and saving streaks  (window.MaerminInvestTimeline)
// ----------------------------------------------------------------------------
// P5-2.7. Built on MaerminHoldingReturns.capitalFlow (P5-2.6): the same money
// (buys incl. fees, sales after fees, EUR at each date) and the same months.
// Pure + dual-exported; tested in test/investment-timeline.test.js.
//
//   calendar(txs, { toEUR, today })
//     → { years: [{ y, total (bought), sells, net, cells: [12 × { ym, buys,
//         sells, net, inRange }] }] (newest first), max (biggest month bought) }
//   streaks(txs, { toEUR, today })
//     → { current, currentFrom, currentTo, open, longest, longestFrom,
//         longestTo, buyMonths, totalMonths, yearBuyMonths, yearMonths }
//     A streak = months in a row with at least one buy. This month counts
//     once it has a buy; until then the streak runs to last month (open).
//     On a tie the most recent streak is the longest.
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function req(load) { try { return load(); } catch (e) { return null; } }
  function HR() { return W.MaerminHoldingReturns || req(function () { return require('./holding-returns.js'); }); }
  function todayISO(o) { return String((o && o.today) || new Date().toISOString()).slice(0, 10); }

  function flow(txs, opts) {
    var H = HR();
    return H ? H.capitalFlow(txs, opts) : { months: [], years: [], total: {} };
  }

  function calendar(txs, opts) {
    var cf = flow(txs, opts || {});
    var out = { years: [], max: 0 };
    if (!cf.months.length) return out;
    var by = {};
    cf.months.forEach(function (m) { by[m.ym] = m; if (m.buys > out.max) out.max = m.buys; });
    var first = parseInt(cf.months[0].ym.slice(0, 4), 10), last = parseInt(cf.months[cf.months.length - 1].ym.slice(0, 4), 10);
    for (var y = last; y >= first; y--) {
      var row = { y: y, total: 0, sells: 0, net: 0, cells: [] };
      for (var i = 1; i <= 12; i++) {
        var ym = y + '-' + String(i).padStart(2, '0'), m = by[ym];
        row.cells.push({ ym: ym, buys: m ? m.buys : 0, sells: m ? m.sells : 0, net: m ? m.net : 0, inRange: !!m });
        if (m) { row.total += m.buys; row.sells += m.sells; row.net += m.net; }
      }
      out.years.push(row);
    }
    return out;
  }

  function streaks(txs, opts) {
    opts = opts || {};
    var cf = flow(txs, opts);
    var out = { current: 0, currentFrom: null, currentTo: null, open: false, longest: 0, longestFrom: null, longestTo: null,
      buyMonths: 0, totalMonths: cf.months.length, yearBuyMonths: 0, yearMonths: 0 };
    if (!cf.months.length) return out;
    var thisYm = todayISO(opts).slice(0, 7), thisY = thisYm.slice(0, 4);
    var run = 0, runFrom = null;
    cf.months.forEach(function (m) {
      var bought = m.buys > 0;
      if (bought) out.buyMonths++;
      if (m.ym.slice(0, 4) === thisY) { out.yearMonths++; if (bought) out.yearBuyMonths++; }
      if (bought) {
        if (!run) runFrom = m.ym;
        run++;
        if (run >= out.longest) { out.longest = run; out.longestFrom = runFrom; out.longestTo = m.ym; }
      } else if (m.ym !== thisYm) { run = 0; runFrom = null; }
    });
    // the current streak ends this month (with a buy) or last month (this one still open)
    var last = cf.months[cf.months.length - 1];
    var endsHere = last.ym === thisYm && last.buys > 0;
    var lastIdx = cf.months.length - 1 - (endsHere || last.ym !== thisYm ? 0 : 1);
    var n = 0, i = lastIdx;
    while (i >= 0 && cf.months[i].buys > 0) { n++; i--; }
    out.current = n;
    if (n) { out.currentFrom = cf.months[i + 1].ym; out.currentTo = cf.months[lastIdx].ym; }
    out.open = !!n && !endsHere && last.ym === thisYm;
    return out;
  }

  var api = { calendar: calendar, streaks: streaks };
  api.Panel = Panel;
  if (typeof window !== 'undefined') window.MaerminInvestTimeline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view: Cash Flow, "Investment calendar" with the saving streaks
  // --------------------------------------------------------------------------
  function __(k, f, v) { return (W.MaerminI18n ? W.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function Panel(props) {
    var React = W.React, e = React.createElement;
    var I = W.MaerminI18n, U = W.MaerminUtils, FX = W.MaerminFxHistory;
    var txs = props.transactions || [];
    var fmt = props.formatPrice || function (x) { return I.num(x, 2); };
    var cur = props.getCurrencySymbol ? props.getCurrencySymbol() : '€';
    var today = U && U.todayISO ? U.todayISO() : (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO();
    var toEUR = function (amount, tx) {
      if (FX && FX.txToEUR) return FX.txToEUR(amount, tx.currency || 'EUR', tx.date, props.exchangeRate, props.fxAt).value;
      return U ? U.toEUR(amount, tx.currency || 'EUR', props.exchangeRate) : amount;
    };
    var cal = React.useMemo(function () { return calendar(txs, { toEUR: toEUR, today: today }); }, [txs, props.exchangeRate, props.fxAt]);
    var st = React.useMemo(function () { return streaks(txs, { toEUR: toEUR, today: today }); }, [txs, props.exchangeRate, props.fxAt]);
    var selState = React.useState(null), sel = selState[0], setSel = selState[1];
    if (!cal.years.length) return null;

    // R4.5: Stat tiles, the month grid on the chart palette (stronger = more
    // bought), the shared Card.
    var UIC = W.MaerminComponents;
    var money = function (v) { return fmt(v) + ' ' + cur; };
    var ymLabel = function (ym, long) { return I.date(new Date(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5, 7), 10) - 1, 1), { month: long ? 'long' : 'short', year: 'numeric' }); };
    var range = function (a, b) { return a === b ? ymLabel(a) : ymLabel(a) + ' – ' + ymLabel(b); };

    var stat = function (key, label, value, sub, tone) {
      return e(UIC.Stat, { key: key, 'data-stat': key, className: 'ui-tile', label: label, value: value, sub: sub || null, tone: tone || null });
    };
    var months = function (n) { return __('itMonths', '{n} {n:month|months}', { n: n }); };
    var stats = e('div', { className: 'ui-tiles' },
      stat('current', __('itCurrent', 'Current streak'), months(st.current),
        st.current ? range(st.currentFrom, st.currentTo) + (st.open ? ' · ' + __('itOpen', 'this month still open') : '') : __('itNoStreak', 'no buy last month'),
        st.current ? 'gain' : null),
      stat('longest', __('itLongest', 'Longest streak'), months(st.longest), st.longest ? range(st.longestFrom, st.longestTo) : ''),
      stat('ratio', __('itBuyMonths', 'Months with a buy'), st.buyMonths + ' / ' + st.totalMonths,
        st.totalMonths ? I.pct(st.buyMonths / st.totalMonths * 100, 0) : ''),
      stat('year', __('itThisYear', 'This year'), st.yearBuyMonths + ' / ' + st.yearMonths, __('itThisYearSub', 'months with a buy so far')));

    var cell = function (c) {
      var on = sel === c.ym;
      var share = cal.max > 0 ? c.buys / cal.max : 0;
      var bg = c.buys > 0 ? 'color-mix(in srgb, var(--chart-1) ' + Math.round(25 + 75 * share) + '%, var(--surface))' : undefined;
      var label = c.inRange ? ymLabel(c.ym, true) + ': ' + (c.buys > 0 ? __('itBoughtAria', 'bought {amount}', { amount: money(c.buys) }) : __('itNoBuy', 'no buy')) : '';
      return e('td', { key: c.ym },
        c.inRange ? e('button', { type: 'button', 'data-ym': c.ym, 'data-buys': c.buys, 'aria-pressed': on, 'aria-label': label, title: label, onClick: function () { setSel(on ? null : c.ym); },
          className: ['ui-it__cell', c.buys > 0 ? 'has-buy' : '', on ? 'is-on' : ''].join(' ').trim(), style: bg ? { background: bg } : undefined }) : e('div', { className: 'ui-it__blank' }));
    };
    var monthHead = [];
    for (var i = 0; i < 12; i++) monthHead.push(e('th', { key: i, scope: 'col' }, I.date(new Date(2024, i, 1), { month: 'narrow' })));
    var grid = e('div', { className: 'ui-it__scroll' },
      e('table', { className: 'ui-it' },
        e('thead', null, e('tr', null, e('th', { scope: 'col', className: 'ui-it__yearhead' }, __('itYearTotal', 'Bought')), monthHead)),
        e('tbody', null, cal.years.map(function (y) {
          return e('tr', { key: y.y, 'data-y': y.y },
            e('th', { scope: 'row', 'data-total': y.total, className: 'ui-it__year' },
              e('b', null, String(y.y)),
              e('span', { className: 'num' }, I.num(y.total, 0) + ' ' + cur)),
            y.cells.map(cell));
        }))));
    var selCell = null;
    cal.years.forEach(function (y) { y.cells.forEach(function (c) { if (c.ym === sel) selCell = c; }); });
    var detail = e('p', { 'data-testid': 'it-detail', className: 'ui-note' },
      selCell ? e('span', null, e('strong', null, ymLabel(selCell.ym, true) + ': '),
        __('itDetail', 'bought {buys}, sold {sells}, net {net}', { buys: money(selCell.buys), sells: money(selCell.sells), net: money(selCell.net) }))
        : __('itHint', 'Select a month for its amounts. Darker = more bought.'));

    return e(UIC.Card, { 'data-testid': 'invest-timeline', title: __('itTitle', 'Investment calendar'), headingLevel: 'h3',
      subtitle: __('itSub', 'Money bought per month (incl. fees) and your saving streaks: months in a row with at least one buy, savings-plan runs included.') },
      stats, grid, detail);
  }
})();
