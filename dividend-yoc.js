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
        var theme = props.theme || {};
        var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f';
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
          return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', margin: '1rem 0' } },
            e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem' } }, t.yocTitle || 'Yield on cost'),
            e('div', { style: { color: dim, fontSize: '0.84rem' } }, t.yocEmpty || 'No dividend-paying stock positions to analyse yet.'));
        }

        var header = e('div', { style: { display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: '0.5rem', padding: '0 0.4rem 0.4rem', color: dim, fontSize: '0.72rem', textTransform: 'uppercase' } },
          e('span', null, t.yocSymbol || 'Symbol'), e('span', { style: { textAlign: 'right' } }, t.yocCost || 'Cost basis'),
          e('span', { style: { textAlign: 'right' } }, t.yocIncome || 'Annual income'), e('span', { style: { textAlign: 'right' } }, t.yocYoc || 'YoC'));
        var body = rows.map(function (r) {
          return e('div', { key: r.symbol, style: { display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: '0.5rem', padding: '0.5rem 0.4rem', borderTop: '1px solid ' + border, fontSize: '0.84rem' } },
            e('span', { style: { color: text, fontWeight: 600 } }, r.symbol),
            e('span', { style: { color: dim, textAlign: 'right' } }, fmt(r.yoc.costBasisEUR) + ' ' + sym),
            e('span', { style: { color: dim, textAlign: 'right' } }, fmt(r.yoc.annualDividendEUR) + ' ' + sym),
            e('span', { style: { color: theme.success || '#22c55e', textAlign: 'right', fontWeight: 700 } }, window.MaerminI18n.pct(r.yoc.yocPct, 2)));
        });

        return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', margin: '1rem 0' } },
          e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem' } }, t.yocTitle || 'Yield on cost'),
          e('div', { style: { color: dim, fontSize: '0.76rem', marginBottom: '0.8rem' } }, t.yocSubtitle || 'Annual dividend over your FIFO cost basis.'),
          header, body);
      } catch (err) {
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, __('yocError', 'Yield-on-cost error: {msg}', { msg: err && err.message }));
      }
    };
  }
})();
