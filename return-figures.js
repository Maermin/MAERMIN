// ============================================================================
// MAERMIN — Return figures  (window.MaerminReturnFigures)
// ----------------------------------------------------------------------------
// P5-1.5. The figures the Overview's "Returns" section and Analysis → Returns
// both show, from ONE place, so the two can never disagree. Only calls the
// existing engines: MaerminReturns (cash flows, XIRR), MaerminLedger (FIFO,
// cash bookings, clearing accounts). Every amount is EUR.
//
//   compute(transactions, { securitiesValueEUR, exchangeRate, fxAt, today,
//                           valuePath?, clearings?: { portfolioId: clearing },
//                           gross? })
//   → { basis ('net' | 'gross'), xirr, twr, twrAnnualized, twrSince, twrCash,
//       realized        realised FIFO gain of the sales (options left out)
//       dividendsGross  dividends before withholding
//       dividendsNet    dividends after foreign withholding
//       taxes           foreign withholding + tax bookings − tax refunds
//       fees            trade fees + stand-alone fees − fee refunds
//       invested        purchases incl. fees
//       proceeds        sales after fees + dividends / interest received
//       netReturn, netReturnPct   value + proceeds − invested + cash bookings
//       cash            balance of the clearing accounts (null without one),
//       xirrFlows       the flows behind xirr (P5-2.9 real XIRR) }
//   Every figure is null without transactions.
//
// XIRR: a portfolio with a clearing account contributes its deposits and
// withdrawals, a portfolio without one its trades; the end value is all
// securities plus the clearing cash. TWR comes from the value path the caller
// built for the same view (null when there is none).
//
// gross (P5-2.5): taxes and fees count as money taken out instead of as a
// loss - each one is a flow back to the investor on its date in the XIRR, and
// the net return adds them back. The caller builds the value path with the
// same option.
//
// Pure + dual-exported; tested in test/return-figures.test.js.
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function req(load) { try { return load(); } catch (e) { return null; } }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function compute(transactions, opts) {
    opts = opts || {};
    var L = W.MaerminLedger || req(function () { return require('./ledger.js'); });
    var R = W.MaerminReturns || req(function () { return require('./returns-engine.js'); });
    var F = W.MaerminFxHistory || req(function () { return require('./fx-history.js'); });
    var txs = Array.isArray(transactions) ? transactions : [];
    var out = { basis: opts.gross ? 'gross' : 'net', xirr: null, twr: null, twrAnnualized: null, twrSince: null, twrCash: false, realized: null, dividendsGross: null, dividendsNet: null,
      taxes: null, fees: null, invested: null, proceeds: null, netReturn: null, netReturnPct: null, cash: null };
    if (!txs.length || !L || !R) return out;
    var rate = num(opts.exchangeRate), fxAt = typeof opts.fxAt === 'function' ? opts.fxAt : null;
    var today = opts.today || (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO();
    var value = num(opts.securitiesValueEUR);
    var eur = function (amount, tx) {
      if (F && F.txToEUR) return F.txToEUR(num(amount), tx.currency, tx.date, rate, fxAt).value;
      var r = tx.currency === 'USD' ? ((fxAt && fxAt(tx.date)) || rate || 1) : 1;
      return num(amount) * r;
    };

    // Flows exactly as Analysis → Returns has always built them.
    var flows = R.buildCashflows(txs, { rate: rate, fxAt: fxAt, currentValueEUR: value, today: today });
    var trade = flows.filter(function (f) { return !f.type; }), cashF = flows.filter(function (f) { return f.type; });
    var end = value > 0 ? value : 0;
    var invested = -trade.filter(function (f) { return f.amount < 0; }).reduce(function (s, f) { return s + f.amount; }, 0);
    var proceeds = trade.filter(function (f) { return f.amount > 0; }).reduce(function (s, f) { return s + f.amount; }, 0) - end;
    var netCash = cashF.reduce(function (s, f) { return s + f.amount; }, 0);
    var cashFees = -cashF.filter(function (f) { return f.type === 'fee' || f.type === 'fee_refund'; }).reduce(function (s, f) { return s + f.amount; }, 0);
    var tradeFees = txs.reduce(function (s, tx) { return s + eur(tx.fees, tx); }, 0);
    out.invested = invested;
    out.proceeds = proceeds;
    out.fees = tradeFees + cashFees;
    out.netReturn = value + proceeds - invested + netCash;
    out.netReturnPct = invested > 0 ? out.netReturn / invested : null;

    // XIRR (clearing-aware, per portfolio)
    var clearings = opts.clearings || {};
    var ids = Object.keys(clearings).filter(function (id) { return clearings[id]; });
    var xirrFlows;
    if (!ids.length) xirrFlows = flows;
    else {
      var inAccount = {};
      ids.forEach(function (id) { inAccount[id] = true; });
      var plain = txs.filter(function (tx) { return !inAccount[String(tx.portfolioId || 'default')]; });
      xirrFlows = R.buildCashflows(plain, { rate: rate, fxAt: fxAt });
      var cash = 0;
      ids.forEach(function (id) {
        cash += clearings[id].balanceEUR || 0;
        (clearings[id].external || []).forEach(function (e) { xirrFlows.push({ date: e.d, amount: -e.amount }); });
      });
      if (value + cash) xirrFlows.push({ date: today, amount: value + cash });
      out.cash = cash;
    }
    if (opts.gross) {
      var back = {};
      txs.forEach(function (tx) {
        var d = tx && String(tx.date || '').slice(0, 10);
        if (!d || d > today || tx.category === 'options') return;
        var c = eur(Math.max(0, num(tx.fees)), tx);
        if (tx.type === 'dividend' || tx.type === 'interest') c += eur(Math.max(0, num(tx.withholdingTax)), tx);
        if (tx.type === 'tax' || tx.type === 'fee') c += eur(Math.abs(num(tx.amount)), tx);
        if (tx.type === 'tax_refund' || tx.type === 'fee_refund') c -= eur(Math.abs(num(tx.amount)), tx);
        if (c) back[d] = (back[d] || 0) + c;
      });
      Object.keys(back).forEach(function (d) { if (Math.abs(back[d]) > 1e-9) xirrFlows.push({ date: d, amount: back[d] }); });
    }
    out.xirr = R.xirr(xirrFlows);
    out.xirrFlows = xirrFlows; // P5-2.9: the real XIRR deflates the same flows

    // TWR from the caller's value path
    var vp = opts.valuePath;
    if (vp && vp.twr !== null && vp.twr !== undefined) {
      out.twr = vp.twr; out.twrAnnualized = vp.annualized === undefined ? null : vp.annualized;
      out.twrSince = vp.start || null; out.twrCash = !!vp.cash;
    }

    // Realised gains (FIFO; options are valued by the options engine)
    try {
      out.realized = L.build(txs, { exchangeRate: rate, fxAt: fxAt, perPortfolio: true }).list
        .filter(function (g) { return g.category !== 'options'; })
        .reduce(function (s, g) { return s + g.realizedGain; }, 0);
    } catch (e) { out.realized = null; }

    // Dividends and taxes
    var gross = 0, wht = 0;
    txs.forEach(function (tx) {
      if (!tx || tx.type !== 'dividend') return;
      gross += eur((num(tx.quantity) * num(tx.price)) || num(tx.amount), tx);
      wht += eur(Math.max(0, num(tx.withholdingTax)), tx);
    });
    out.dividendsGross = gross;
    out.dividendsNet = gross - wht;
    var cb = L.cashFlows(txs, { exchangeRate: rate, fxAt: fxAt }).byType;
    out.taxes = wht + (cb.tax || 0) - (cb.tax_refund || 0);
    if (opts.gross) {
      out.netReturn += out.taxes + out.fees;
      out.netReturnPct = out.invested > 0 ? out.netReturn / out.invested : null;
    }
    return out;
  }

  var api = { compute: compute };
  if (typeof window !== 'undefined') window.MaerminReturnFigures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
