// ============================================================================
// MAERMIN — Yield on cost  (window.MaerminDividendYoc)
// ----------------------------------------------------------------------------
// Competitive-gap WI-6. A derived, pure consumer of the existing transaction
// lots + the one DividendDataService (per-share annual dividend); it persists
// nothing.
//
//   yieldOnCost(input)   annualised dividend / FIFO cost basis (EUR).
//
// All amounts are EUR (the caller converts via MaerminUtils). Pure layer
// Node-tested in test/dividend-yoc.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d == null ? '' : d).slice(0, 10); }
  function byDate(a, b) { return ymd(a.date) < ymd(b.date) ? -1 : (ymd(a.date) > ymd(b.date) ? 1 : 0); }

  // Net shares held = buys minus sells.
  function netShares(lots) {
    return (Array.isArray(lots) ? lots : []).reduce(function (s, l) {
      var q = num(l.shares);
      return s + (l.type === 'sell' ? -q : q);
    }, 0);
  }

  // FIFO cost basis (EUR) of the still-open shares: sells consume the oldest
  // buys first, removing their proportional cost.
  function costBasisFIFO(lots) {
    var sorted = (Array.isArray(lots) ? lots : []).slice().sort(byDate);
    var open = [];
    sorted.forEach(function (l) {
      var q = num(l.shares);
      if (l.type === 'sell') {
        var remaining = q;
        while (remaining > 1e-12 && open.length) {
          var lot = open[0];
          var take = Math.min(lot.shares, remaining);
          lot.shares -= take; remaining -= take;
          if (lot.shares <= 1e-12) open.shift();
        }
      } else {
        open.push({ shares: q, priceEUR: num(l.priceEUR) });
      }
    });
    return open.reduce(function (s, lot) { return s + lot.shares * lot.priceEUR; }, 0);
  }

  // Yield on cost = annual dividend (annualDpsEUR * net shares) / FIFO cost basis.
  function yieldOnCost(input) {
    input = input || {};
    var lots = input.lots || [];
    var shares = netShares(lots);
    var costBasisEUR = costBasisFIFO(lots);
    var annualDpsEUR = num(input.annualDpsEUR);
    var annualDividendEUR = annualDpsEUR * shares;
    return {
      shares: shares,
      costBasisEUR: costBasisEUR,
      annualDividendEUR: annualDividendEUR,
      yocPct: costBasisEUR > 0 ? (annualDividendEUR / costBasisEUR) * 100 : 0
    };
  }

  var api = {
    netShares: netShares, costBasisFIFO: costBasisFIFO,
    yieldOnCost: yieldOnCost
  };

  api.Panel = makePanel(api);

  if (typeof window !== 'undefined') window.MaerminDividendYoc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view — a per-payer YoC table, folded into Dividends.
  // --------------------------------------------------------------------------
  function makePanel(API) {
    return function Panel(props) {
      var React = (typeof window !== 'undefined') ? window.React : null;
      if (!React) return null;
      var e = React.createElement;
      try {
        var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
        // R4.6: Card and the shared Table (phone rows)
        var UIC = window.MaerminComponents;
        var rate = props.exchangeRate || props.usdToEur || 1;
        var fmt = props.formatPrice || function (n) { return window.MaerminI18n.num(n, 2); };
        var sym = props.getCurrencySymbol ? props.getCurrencySymbol() : '';

        var portfolio = props.portfolio || {};
        var prices = props.prices || {};
        var transactions = props.transactions || [];
        var DS = (typeof window !== 'undefined') ? window.DividendDataService : null;
        var divData = (DS && DS.getPortfolioDividendData) ? DS.getPortfolioDividendData(portfolio, prices) : {};

        // Open lots (EUR) per stock from the ONE ledger (ledger.js): fees in
        // the cost basis, per-date FX, splits applied — the same cost basis as
        // the positions list and the tax report.
        var L = (typeof window !== 'undefined' && window.MaerminLedger)
          ? window.MaerminLedger.build(transactions, { exchangeRate: rate, fxAt: props.fxAt, categories: ['stocks'] })
          : { list: [] };
        var lotsBySym = {};
        L.list.forEach(function (g) {
          var s = String(g.symbol || '').toUpperCase();
          if (!s) return;
          lotsBySym[s] = (lotsBySym[s] || []).concat(g.openLots.map(function (l) {
            return { type: 'buy', date: ymd(l.date), shares: l.qty, priceEUR: l.unitCostEUR };
          }));
        });

        var rows = Object.keys(lotsBySym).map(function (s) {
          var d = divData[s];
          var annualDps = d ? num(d.annualDividend) : 0;
          // DPS is in the payer's currency: only USD payers are converted
          // (EUR payers such as ALV.DE were multiplied by the USD rate).
          var annualDpsEUR = (d && d.currency === 'EUR') ? annualDps : annualDps * rate;
          var yoc = API.yieldOnCost({ lots: lotsBySym[s], annualDpsEUR: annualDpsEUR });
          return { symbol: s, yoc: yoc, annualDpsEUR: annualDpsEUR };
        }).filter(function (r) { return r.yoc.shares > 0 && r.annualDpsEUR > 0; })
          .sort(function (a, b) { return b.yoc.yocPct - a.yoc.yocPct; });

        function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }

        if (!rows.length) {
          return e(UIC.Card, { className: 'ui-yoc', headingLevel: 'h3', title: t.yocTitle || 'Yield on cost' },
            e('p', { className: 'ui-muted' }, t.yocEmpty || 'No dividend-paying stock positions to analyse yet.'));
        }

        return e(UIC.Card, { className: 'ui-yoc', headingLevel: 'h3', title: t.yocTitle || 'Yield on cost', subtitle: t.yocSubtitle || 'Annual dividend over your FIFO cost basis.' },
          e(UIC.Table, { rows: rows, rowKey: function (r) { return r.symbol; }, caption: t.yocTitle || 'Yield on cost', columns: [
            { key: 'sym', label: t.yocSymbol || 'Symbol', phone: 'title', render: function (r) { return e('b', null, r.symbol); } },
            { key: 'cost', label: t.yocCost || 'Cost basis', align: 'right', phone: 'meta', render: function (r) { return fmt(r.yoc.costBasisEUR) + ' ' + sym; } },
            { key: 'income', label: t.yocIncome || 'Annual income', align: 'right', phone: 'meta', render: function (r) { return fmt(r.yoc.annualDividendEUR) + ' ' + sym; } },
            { key: 'yoc', label: t.yocYoc || 'YoC', align: 'right', phone: 'value', render: function (r) { return e('b', { className: 'tone-income' }, window.MaerminI18n.pct(r.yoc.yocPct, 2)); } }
          ] }));
      } catch (err) {
        return e('p', { className: ['ui-muted', 'is-error'].join(' ') }, __('yocError', 'Yield-on-cost error: {msg}', { msg: err && err.message }));
      }
    };
  }
})();
