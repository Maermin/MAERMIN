// ============================================================================
// MAERMIN — Yield-on-Cost trend + DRIP modelling  (window.MaerminDividendYoc)
// ----------------------------------------------------------------------------
// Competitive-gap WI-6. MAERMIN had dividend quality/forecast but no yield-on-
// cost over time and no reinvestment (DRIP) simulation — Snowball's core domain.
// This is a derived, pure consumer of the existing transaction lots + the one
// DividendDataService (per-share annual dividend); it persists nothing.
//
//   yieldOnCost(input)   annualised dividend / FIFO cost basis (EUR), plus a
//                        per-buy time series so the YoC trend is visible.
//   dripSimulate(input)  hypothetical reinvestment of every distribution at the
//                        price on its date, vs. taking the cash — end value and
//                        share count compared. Clearly a SIMULATION: it never
//                        books real transactions.
//
// All amounts are EUR (the caller converts via MaerminUtils). Pure layer
// Node-tested in test/dividend-yoc.test.js.
// ============================================================================
(function () {
  'use strict';

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

  // YoC trend: one point per BUY (cumulative shares + cost basis), using the
  // current annual DPS. Shows how YoC moves as the average cost evolves.
  function yocSeries(input) {
    input = input || {};
    var annualDpsEUR = num(input.annualDpsEUR);
    var buys = (input.buys || (input.lots || []).filter(function (l) { return l.type !== 'sell'; }))
      .slice().sort(byDate);
    var cumShares = 0, cumCost = 0, out = [];
    buys.forEach(function (b) {
      cumShares += num(b.shares);
      cumCost += num(b.shares) * num(b.priceEUR);
      out.push({
        date: ymd(b.date), shares: cumShares, costBasisEUR: cumCost,
        yocPct: cumCost > 0 ? (annualDpsEUR * cumShares / cumCost) * 100 : 0
      });
    });
    return out;
  }

  // DRIP simulation. Reinvests each distribution at the price on its date and
  // compares to taking the cash. NEVER books real transactions.
  //   input = { buys: [{date, shares, priceEUR}],
  //             dividends: [{date, dpsEUR}],
  //             priceAt(dateISO) -> EUR price (for reinvest + valuation),
  //             finalPrice? }
  function dripSimulate(input) {
    input = input || {};
    var buys = (input.buys || []).slice().sort(byDate);
    var dividends = (input.dividends || []).slice().sort(byDate);
    var priceAt = typeof input.priceAt === 'function' ? input.priceAt : function () { return null; };

    // Build a merged, date-ordered event timeline.
    var events = [];
    buys.forEach(function (b) { events.push({ date: ymd(b.date), kind: 'buy', shares: num(b.shares) }); });
    dividends.forEach(function (d) { events.push({ date: ymd(d.date), kind: 'div', dps: num(d.dpsEUR) }); });
    events.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.kind === 'buy' ? -1 : 1; // a buy on the same day counts before its dividend
    });

    var lastDate = events.length ? events[events.length - 1].date : null;
    var finalPrice = input.finalPrice != null ? num(input.finalPrice) : num(priceAt(lastDate));

    // Baseline: dividends are taken as cash, shares only from buys.
    var baseShares = 0, cashCollected = 0;
    // DRIP: dividends buy more shares at the day's price.
    var dripShares = 0, cashReinvested = 0;
    events.forEach(function (ev) {
      if (ev.kind === 'buy') { baseShares += ev.shares; dripShares += ev.shares; }
      else {
        cashCollected += baseShares * ev.dps;
        var cash = dripShares * ev.dps;
        var px = num(priceAt(ev.date));
        if (px > 0) { dripShares += cash / px; cashReinvested += cash; }
        else { cashCollected += cash; } // unpriced day -> can't reinvest, fall back to cash
      }
    });

    var baseValue = baseShares * finalPrice;
    var dripValue = dripShares * finalPrice;
    return {
      baseline: { shares: baseShares, value: baseValue, cashCollected: cashCollected },
      drip: { shares: dripShares, value: dripValue, cashReinvested: cashReinvested },
      extraShares: dripShares - baseShares,
      extraValue: dripValue - baseValue,
      finalPrice: finalPrice,
      simulation: true
    };
  }

  var api = {
    netShares: netShares, costBasisFIFO: costBasisFIFO,
    yieldOnCost: yieldOnCost, yocSeries: yocSeries, dripSimulate: dripSimulate
  };

  api.Panel = makePanel(api);

  if (typeof window !== 'undefined') window.MaerminDividendYoc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view — a per-payer YoC table + a DRIP summary, folded into Dividends.
  // --------------------------------------------------------------------------
  function makePanel(API) {
    return function Panel(props) {
      var React = (typeof window !== 'undefined') ? window.React : null;
      if (!React) return null;
      var e = React.createElement;
      try {
        var theme = props.theme || {};
        var t = props.t || {};
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f';
        var rate = props.exchangeRate || props.usdToEur || 1;
        var fmt = props.formatPrice || function (n) { return (Math.round(n * 100) / 100).toLocaleString(); };
        var sym = props.getCurrencySymbol ? props.getCurrencySymbol() : '';

        var portfolio = props.portfolio || {};
        var prices = props.prices || {};
        var transactions = props.transactions || [];
        var DS = (typeof window !== 'undefined') ? window.DividendDataService : null;
        var divData = (DS && DS.getPortfolioDividendData) ? DS.getPortfolioDividendData(portfolio, prices) : {};

        // Build per-symbol lots (EUR) from the stock transactions.
        var lotsBySym = {};
        transactions.forEach(function (tx) {
          if (!tx || tx.category !== 'stocks') return;
          if (tx.type !== 'buy' && tx.type !== 'sell') return;
          var s = String(tx.symbol || '').toUpperCase();
          if (!s) return;
          var priceEUR = (tx.currency === 'USD') ? num(tx.price) * rate : num(tx.price);
          (lotsBySym[s] = lotsBySym[s] || []).push({ type: tx.type, date: ymd(tx.date), shares: num(tx.quantity), priceEUR: priceEUR });
        });

        var rows = Object.keys(lotsBySym).map(function (s) {
          var d = divData[s];
          var annualDps = d ? num(d.annualDividend) : 0;
          var annualDpsEUR = annualDps * rate; // DividendDataService DPS is in the security currency (USD)
          var yoc = API.yieldOnCost({ lots: lotsBySym[s], annualDpsEUR: annualDpsEUR });
          return { symbol: s, yoc: yoc, annualDpsEUR: annualDpsEUR };
        }).filter(function (r) { return r.yoc.shares > 0 && r.annualDpsEUR > 0; })
          .sort(function (a, b) { return b.yoc.yocPct - a.yoc.yocPct; });

        function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }

        if (!rows.length) {
          return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', margin: '1rem 0' } },
            e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem' } }, t.yocTitle || 'Yield on cost & DRIP'),
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
            e('span', { style: { color: theme.success || '#22c55e', textAlign: 'right', fontWeight: 700 } }, r.yoc.yocPct.toFixed(2) + '%'));
        });

        return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', margin: '1rem 0' } },
          e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem' } }, t.yocTitle || 'Yield on cost & DRIP'),
          e('div', { style: { color: dim, fontSize: '0.76rem', marginBottom: '0.8rem' } }, t.yocSubtitle || 'Annual dividend over your FIFO cost basis. DRIP figures are a simulation — no real transactions are booked.'),
          header, body);
      } catch (err) {
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, 'Yield-on-cost error: ' + (err && err.message));
      }
    };
  }
})();
