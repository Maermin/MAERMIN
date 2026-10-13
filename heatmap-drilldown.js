// ============================================================================
// MAERMIN — Heatmap drill-down and filters  (window.MaerminHeatmapDrill)
// ----------------------------------------------------------------------------
// P5-2.4. A click on a month, quarter or year of the returns heatmap shows what
// happened in it; filters narrow the heatmap to one asset class (or custom
// category), tag or holding. The figures come from the same chain of period
// returns as the cell, so the detail's return always equals the cell.
//
//   periodOf(kind, year, idx)  kind 'm' (idx 0-11) | 'q' (idx 0-3) | 'y'
//                              → { from, to } ISO days, both inclusive | null
//   detail(points, transactions, { from, to })
//     points: [{ d, v?, flow?, r }]  the value path's points (value-path.js) or
//             the heatmap steps alone (refresh fallback: no values)
//     → { from, to, first, last, startValue, endValue, netFlow, gain, ret,
//         startsInside, activities, byType: { buy, sell, income, other } }
//     startValue = the value of the last point BEFORE the period (0 when the
//     path starts inside it, startsInside true); endValue = the last value in
//     it; netFlow = money in (+) / out (−) inside it; gain = end − start − flow;
//     ret = the compounded steps inside it (null without any). Values are null
//     where the points carry none.
//   filterTransactions(txs, filter, tagsState)
//     filter: null | { kind: 'all' } | { kind: 'class', value: category }
//           | { kind: 'tag', value: name } | { kind: 'holding', value: 'cat|SYM' }
//   options(txs, tagsState) → { classes, tags, holdings: [{ key, category, symbol }] }
//   filterKey(filter)       → 'all' | 'class:stocks' | 'tag:Core' | …
//
// Pure + dual-exported; tested in test/heatmap-drilldown.test.js.
// ============================================================================
(function () {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function lastDay(year, month) { return new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); }
  function day(d) { var s = String(d || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; }
  function num(x) { var n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : null; }
  function sym(s) { return String(s == null ? '' : s).trim().toUpperCase(); }
  function cat(tx) { return (tx && tx.category) || 'crypto'; }

  function periodOf(kind, year, idx) {
    var y = parseInt(year, 10);
    if (!isFinite(y)) return null;
    var m0, m1;
    if (kind === 'm') { m0 = m1 = idx; }
    else if (kind === 'q') { m0 = idx * 3; m1 = idx * 3 + 2; }
    else if (kind === 'y') { m0 = 0; m1 = 11; }
    else return null;
    if (!(m0 >= 0 && m1 <= 11)) return null;
    return { from: y + '-' + pad(m0 + 1) + '-01', to: y + '-' + pad(m1 + 1) + '-' + pad(lastDay(y, m1)) };
  }

  var INCOME = { dividend: true, interest: true, staking: true, reward: true };
  function detail(points, transactions, range) {
    var from = range && range.from, to = range && range.to;
    var out = { from: from, to: to, first: null, last: null, startValue: null, endValue: null, netFlow: null, gain: null, ret: null,
      startsInside: false, activities: 0, byType: { buy: 0, sell: 0, income: 0, other: 0 } };
    var hasValues = false, before = null, growth = null, flow = 0;
    (points || []).forEach(function (p) {
      var d = day(p && p.d);
      if (!d) return;
      var v = num(p.v);
      if (v !== null) hasValues = true;
      if (d < from) { if (v !== null) before = v; return; }
      if (d > to) return;
      if (!out.first) out.first = d;
      out.last = d;
      if (v !== null) out.endValue = v;
      flow += num(p.flow) || 0;
      var r = num(p.r);
      if (r !== null && 1 + r > 0) growth = (growth === null ? 1 : growth) * (1 + r);
    });
    out.ret = growth === null ? null : growth - 1;
    if (hasValues && out.endValue !== null) {
      out.startsInside = before === null;
      out.startValue = before === null ? 0 : before;
      out.netFlow = flow;
      out.gain = out.endValue - out.startValue - flow;
    }
    (transactions || []).forEach(function (tx) {
      var d = day(tx && tx.date);
      if (!d || d < from || d > to) return;
      out.activities++;
      var t = String(tx.type || '').toLowerCase();
      if (t === 'buy') out.byType.buy++;
      else if (t === 'sell') out.byType.sell++;
      else if (INCOME[t]) out.byType.income++;
      else out.byType.other++;
    });
    return out;
  }

  function tagSymbols(tagsState, name) {
    var tags = (tagsState && tagsState.tags) || {}, want = String(name || '').trim().toLowerCase(), hit = null;
    Object.keys(tags).forEach(function (n) { if (n.trim().toLowerCase() === want) hit = tags[n]; });
    var set = {};
    ((hit && hit.symbols) || []).forEach(function (s) { set[sym(s)] = true; });
    return set;
  }

  function filterTransactions(txs, filter, tagsState) {
    var list = txs || [];
    if (!filter || !filter.kind || filter.kind === 'all') return list;
    if (filter.kind === 'class') return list.filter(function (tx) { return cat(tx) === filter.value; });
    if (filter.kind === 'tag') {
      var set = tagSymbols(tagsState, filter.value);
      return list.filter(function (tx) { return !!set[sym(tx.symbol)]; });
    }
    if (filter.kind === 'holding') {
      var v = String(filter.value || ''), i = v.indexOf('|');
      var c = v.slice(0, i), s = sym(v.slice(i + 1));
      return list.filter(function (tx) { return cat(tx) === c && sym(tx.symbol) === s; });
    }
    return list;
  }

  function options(txs, tagsState) {
    var classes = [], seenC = {}, holdings = [], seenH = {}, held = {};
    (txs || []).forEach(function (tx) {
      var c = cat(tx), s = sym(tx.symbol);
      if (!seenC[c]) { seenC[c] = true; classes.push(c); }
      if (!s) return;
      held[s] = true;
      var k = c + '|' + s;
      if (!seenH[k]) { seenH[k] = true; holdings.push({ key: k, category: c, symbol: s }); }
    });
    holdings.sort(function (a, b) { return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : (a.category < b.category ? -1 : 1); });
    var tags = Object.keys((tagsState && tagsState.tags) || {}).filter(function (n) {
      return (tagsState.tags[n].symbols || []).some(function (s) { return held[sym(s)]; });
    }).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    return { classes: classes, tags: tags, holdings: holdings };
  }

  function filterKey(filter) {
    return (!filter || !filter.kind || filter.kind === 'all') ? 'all' : filter.kind + ':' + filter.value;
  }

  var api = { periodOf: periodOf, detail: detail, filterTransactions: filterTransactions, options: options, filterKey: filterKey };
  if (typeof window !== 'undefined') window.MaerminHeatmapDrill = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
