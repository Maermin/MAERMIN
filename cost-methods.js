// ============================================================================
// MAERMIN — Cost-basis methods comparison  (window.MaerminCostMethods)
// ----------------------------------------------------------------------------
// P5-4.6. Per holding the cost basis, the unrealised gain and the year's
// realised gain under FIFO, LIFO, HIFO (highest cost first) and the moving
// average cost, side by side. Every figure comes from the ONE ledger
// (ledger.js, opts.method), so fees, FX and splits are handled the same way.
//
// Display only: positions and the tax report keep FIFO, the legal method in
// Germany (crypto per wallet when the tax setting says so, BMF 6.3.2025;
// shares and funds per depot for the portfolios marked as one, M-15). The
// panel marks that column "used in your tax report". The total of realised
// plus unrealised gain is the same under every method; the methods only move
// gain between years.
//
// Nothing is stored. The pure part is Node-tested in test/cost-basis.test.js;
// the Panel is browser-only.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var METHODS = ['fifo', 'lifo', 'hifo', 'average'];
  var CATEGORIES = ['stocks', 'crypto', 'commodities'];
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d || '').slice(0, 10); }
  function ledger() {
    if (typeof window !== 'undefined' && window.MaerminLedger) return window.MaerminLedger;
    return require('./ledger.js');
  }

  // Current unit price in EUR. Crypto prices are EUR in the app's price map;
  // other categories are in the currency of their latest trade.
  function priceEUR(prices, sym, category, currency, rate) {
    var p = prices || {};
    var v = parseFloat(p[sym] != null ? p[sym] : p[sym.toLowerCase()]);
    if (!(isFinite(v) && v > 0)) return null;
    if (category === 'crypto') return v;
    var cur = String(currency || 'EUR').toUpperCase();
    if (cur === 'EUR') return v;
    if (cur === 'USD') return rate > 0 ? v * rate : null;
    var FXH = typeof window !== 'undefined' && window.MaerminFxHistory;
    if (FXH && FXH.txToEUR) { var r = FXH.txToEUR(v, cur, new Date().toISOString().slice(0, 10), rate, null); return r && r.status !== 'unknown' ? r.value : null; }
    return null;
  }

  // opts: { year, prices, exchangeRate, fxAt, perWallet, depots, jurisdiction }
  //   depots: ids of the portfolios with their own FIFO pool (ledger.js);
  //   a holding's row still sums all of its pools.
  // -> { legal, methods, perWallet, depots, rows: [{ category, symbol, openQty, price,
  //      byMethod: { m: { openCost, unrealized, realized } } }], totals }
  function compare(transactions, opts) {
    opts = opts || {};
    var year = parseInt(opts.year, 10) || new Date().getFullYear();
    var rate = num(opts.exchangeRate) || 1;
    var txs = (transactions || []).filter(function (tx) { return tx && CATEGORIES.indexOf(tx.category || 'crypto') !== -1; });
    var cur = {};
    txs.forEach(function (tx) { if (tx.type === 'buy' || tx.type === 'sell') cur[(tx.category || 'crypto') + '|' + String(tx.symbol || '').toUpperCase()] = tx.currency || 'EUR'; });
    var depots = Array.isArray(opts.depots) ? opts.depots.map(String) : [];
    var rows = {}, order = [];
    METHODS.forEach(function (m) {
      ledger().build(txs, { exchangeRate: rate, fxAt: opts.fxAt, method: m, perWallet: opts.perWallet ? ['crypto'] : undefined,
        depots: depots.length ? depots : undefined }).list.forEach(function (g) {
        var sym = String(g.symbol || '').toUpperCase();
        var k = g.category + '|' + sym;
        var row = rows[k];
        if (!row) { row = rows[k] = { category: g.category, symbol: sym, openQty: 0, price: null, byMethod: {} }; order.push(k); }
        var b = row.byMethod[m] || (row.byMethod[m] = { openQty: 0, openCost: 0, realized: 0, unrealized: null });
        b.openQty += g.openQty; b.openCost += g.openCostEUR;
        g.disposals.forEach(function (d) { if (parseInt(ymd(d.disposalDate).slice(0, 4), 10) === year) b.realized += d.gain; });
      });
    });
    var out = order.map(function (k) { return rows[k]; }).filter(function (r) {
      return METHODS.some(function (m) { var b = r.byMethod[m]; return b && (b.openQty > 1e-9 || Math.abs(b.realized) > 0.005); });
    });
    out.forEach(function (r) {
      r.openQty = r.byMethod.fifo ? r.byMethod.fifo.openQty : 0;
      r.price = priceEUR(opts.prices, r.symbol, r.category, cur[r.category + '|' + r.symbol], rate);
      METHODS.forEach(function (m) {
        var b = r.byMethod[m] || (r.byMethod[m] = { openQty: 0, openCost: 0, realized: 0, unrealized: null });
        b.unrealized = r.price != null ? b.openQty * r.price - b.openCost : (b.openQty > 1e-9 ? null : 0);
      });
    });
    out.sort(function (a, b) { return a.category < b.category ? -1 : a.category > b.category ? 1 : (a.symbol < b.symbol ? -1 : 1); });
    var totals = {};
    METHODS.forEach(function (m) {
      var t = totals[m] = { openCost: 0, realized: 0, unrealized: 0 };
      out.forEach(function (r) { var b = r.byMethod[m]; t.openCost += b.openCost; t.realized += b.realized; if (b.unrealized != null) t.unrealized += b.unrealized; });
    });
    return { legal: 'fifo', methods: METHODS.slice(), perWallet: !!opts.perWallet, depots: depots, year: year, rows: out, totals: totals };
  }

  function methodName(m) {
    return m === 'lifo' ? 'LIFO' : m === 'hifo' ? __('cmHifo', 'HIFO (highest cost first)') : m === 'average' ? __('cmAverage', 'Average cost (moving)') : 'FIFO';
  }

  // ---- panel (Tax view) -------------------------------------------------------
  // props: { theme, transactions, prices, exchangeRate, fxAt, year, portfolios, formatMoney, rev }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useMemo = React.useMemo;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', bad = th.danger || '#ef4444', accent = th.accent || th.primary || '#8b7cff';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var year = props.year || new Date().getFullYear();
    // The depots the German report keeps apart (M-15), so FIFO here matches it.
    var R = window.MaerminTaxReport;
    var depots = R && R.separateDepots ? R.separateDepots({ jurisdiction: 'de', portfolios: props.portfolios }) : [];
    var depotKey = depots.join('\u0001');
    var res = useMemo(function () {
      var TS = window.MaerminTaxSettings, s = null;
      try { s = TS ? TS.load() : null; } catch (err) { s = null; }
      try {
        return compare(props.transactions || [], { year: year, prices: props.prices || {}, exchangeRate: props.exchangeRate, fxAt: props.fxAt, perWallet: !!(s && s.cryptoPerWallet), depots: depots });
      } catch (err) { return null; }
    }, [props.transactions, props.prices, props.exchangeRate, props.fxAt, props.rev, year, depotKey]);
    if (!res) return null;
    // R4.6: Card and the shared table look; a realised gain carries its sign with its tone
    var UIC = window.MaerminComponents;
    var signed = function (v) { return v == null ? '–' : (v > 0.005 ? '+' : '') + money(v); };
    var toneCls = function (v) { return v == null ? 'is-dim' : v > 0.005 ? 'tone-gain' : v < -0.005 ? 'tone-loss' : ''; };
    function pair(b, tid) {
      return e('td', { 'data-testid': tid },
        e('b', { className: toneCls(b.realized) }, signed(b.realized)),
        e('span', { className: 'ui-tcell__sub' }, __('cmUnrealShort', 'open {v}', { v: b.unrealized == null ? '–' : money(b.unrealized) })));
    }
    return e(UIC.Card, { 'data-testid': 'cost-methods-panel', className: 'ui-taxp', headingLevel: 'h3', title: __('cmTitle', 'Cost-basis methods'),
      subtitle: __('cmIntro', 'Realised gain in {y} and the open (unrealised) gain under each method. Together they are the same under every method; the method only moves gain between years. Your tax report uses FIFO.', { y: year })
        + (res.perWallet ? ' ' + __('cmWallet', 'Crypto: FIFO per wallet (portfolio), as set in the tax settings.') : '')
        + (res.depots.length && R && R.depotLabel ? ' ' + R.depotLabel(res.depots, props.portfolios) + '.' : '') },
      !res.rows.length ? window.MaerminUtils.emptyState({ compact: true, testid: 'cm-empty', text: __('cmEmpty', 'No holdings or sales to compare.') }) :
      e('div', { className: 'ui-table-wrap' },
        e('table', { 'data-testid': 'cm-table', className: ['ui-table', 'ui-table--dense', 'ui-table--tall'].join(' ') },
          e('thead', null, e('tr', null,
            e('th', { scope: 'col', className: 'is-sticky' }, __('cmHolding', 'Holding')),
            res.methods.map(function (m) {
              return e('th', { key: m, scope: 'col', className: ['is-right', m === res.legal ? 'is-current' : ''].join(' ').trim() }, methodName(m),
                m === res.legal ? e('span', { 'data-testid': 'cm-legal', className: 'ui-tcell__sub' }, __('cmUsed', 'used in your tax report')) : null);
            }))),
          e('tbody', null,
            res.rows.map(function (r) {
              return e('tr', { key: r.category + '|' + r.symbol, 'data-testid': 'cm-row-' + r.symbol },
                e('th', { scope: 'row', className: 'is-sticky' }, r.symbol,
                  e('span', { className: 'ui-tcell__sub' }, __('cmCost', 'cost {v}', { v: money(r.byMethod.fifo.openCost) }))),
                res.methods.map(function (m) { return pair(r.byMethod[m], 'cm-' + r.symbol + '-' + m); }));
            }),
            e('tr', { 'data-testid': 'cm-total', className: 'ui-dh-total' },
              e('th', { scope: 'row', className: 'is-sticky' }, __('cmTotal', 'Total')),
              res.methods.map(function (m) { return pair(res.totals[m], 'cm-total-' + m); }))))),
      e('p', { className: 'ui-note' },
        __('cmNote', 'Bold: realised in {y}; below: open gain at today\'s price. The tax report uses FIFO. For crypto the BMF (6.3.2025) also accepts the average method for the value, and the FG Nürnberg (22.1.2025) allowed LIFO in one case; ask your tax adviser before using another method. Not tax advice.', { y: year })));
  }

  var api = { METHODS: METHODS, compare: compare, methodName: methodName, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminCostMethods = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
