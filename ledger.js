// ============================================================================
// MAERMIN — Lot Ledger  (window.MaerminLedger)
// ----------------------------------------------------------------------------
// THE one FIFO implementation. Every view that needs open lots, cost basis or
// realised gains reads it from here, so the positions list, the FIFO tab, the
// Realized/Unrealized view, the tax advisor and the tax report can no longer
// disagree (before this module there were seven copies with different rules
// for fees, FX, splits and same-day trades).
//
// Rules (German law / the tax report's semantics):
//   • grouping:   category + symbol (case-insensitive)
//   • order:      by date; same-day ties book buys before sells
//   • fees:       buy fees are acquisition costs (Anschaffungsnebenkosten),
//                 spread per unit; sell fees reduce proceeds, pro-rated over
//                 the lots a sale consumes
//   • currency:   USD legs convert at the rate OF THEIR DATE (`fxAt`), falling
//                 back to the static `exchangeRate`; other currencies = EUR
//   • splits:     the corporate-actions overlay is applied first (if loaded)
//   • oversells:  the unmatched remainder is reported, never silently dropped
//   • holding:    long-term = held MORE than one year (§ 23 EStG; anniversary
//                 sale is still short-term, 29 Feb → 28 Feb)
//
//   build(transactions, { exchangeRate, fxAt, applyCorporateActions = true })
//     → { groups: { key: Group }, list: Group[] }
//   Group = { key, category, symbol, symbolName, symbolLogoUrl,
//             openLots:  [{ qty, unitCostEUR, date }],      oldest first
//             disposals: [{ qty, acquisitionDate, disposalDate, unitCostEUR,
//                           unitProceedsEUR, costBasis, proceeds, gain,
//                           holdingPeriodDays, longTerm }],
//             openQty, openCostEUR, realizedGain, proceedsEUR, oversold }
//
// Pure + dual-exported; tested in test/ledger.test.js.
// ============================================================================
(function () {
  'use strict';

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) {
    if (!d) return '';
    var s = String(d);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var t = new Date(d);
    return isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
  }
  function ts(d) { var t = new Date(d).getTime(); return isNaN(t) ? 0 : t; }

  function oneYearAnniversary(iso) {
    var s = ymd(iso);
    var y = parseInt(s.slice(0, 4), 10), m = parseInt(s.slice(5, 7), 10), d = parseInt(s.slice(8, 10), 10);
    if (!(y > 0 && m > 0 && d > 0)) return '';
    var last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    return (y + 1) + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
  }
  function heldOverOneYear(acquired, disposed) {
    var ann = oneYearAnniversary(acquired);
    return !!ann && ymd(disposed) > ann;
  }

  // Amount in the transaction currency → EUR at the transaction's date.
  function toEUR(amount, tx, rate, fxAt) {
    var a = num(amount);
    if (tx.currency === 'USD') {
      var r = (fxAt && tx.date) ? (fxAt(tx.date) || rate) : rate;
      if (r > 0) return a * r;
    }
    return a;
  }

  function keyOf(tx) {
    return (tx.category || 'crypto') + '|' + String(tx.symbol || tx.name || '').toUpperCase();
  }

  function corporateActions() {
    if (typeof window !== 'undefined' && window.MaerminCorporateActions) return window.MaerminCorporateActions;
    return null;
  }

  // FIFO over ONE group's transactions (any order). Returns the Group body.
  function runGroup(txs, rate, fxAt) {
    var sorted = (txs || []).slice().sort(function (a, b) {
      return (ts(a.date) - ts(b.date)) || ((a.type === 'buy' ? 0 : 1) - (b.type === 'buy' ? 0 : 1));
    });
    var open = [];      // { qty, unitCostEUR, date }
    var disposals = [];
    var oversold = 0;
    sorted.forEach(function (tx) {
      var qty = num(tx.quantity);
      if (!(qty > 0)) return;
      if (tx.type === 'buy') {
        var fee = toEUR(tx.fees, tx, rate, fxAt);
        open.push({ qty: qty, unitCostEUR: toEUR(tx.price, tx, rate, fxAt) + (fee > 0 ? fee / qty : 0), date: tx.date });
        return;
      }
      if (tx.type !== 'sell') return;
      var unitProceeds = toEUR(tx.price, tx, rate, fxAt);
      var sellFee = Math.max(0, toEUR(tx.fees, tx, rate, fxAt));
      var remaining = qty, matches = [];
      while (remaining > 1e-9 && open.length) {
        var lot = open[0];
        var used = Math.min(remaining, lot.qty);
        matches.push({ used: used, lot: lot });
        lot.qty -= used;
        remaining -= used;
        if (lot.qty <= 1e-9) open.shift();
      }
      if (remaining > 1e-9) oversold += remaining;
      var matched = matches.reduce(function (s, m) { return s + m.used; }, 0);
      matches.forEach(function (m) {
        var proceeds = m.used * unitProceeds - (matched > 0 ? sellFee * (m.used / matched) : 0);
        var cost = m.used * m.lot.unitCostEUR;
        disposals.push({
          qty: m.used,
          acquisitionDate: ymd(m.lot.date), disposalDate: ymd(tx.date),
          unitCostEUR: m.lot.unitCostEUR, unitProceedsEUR: unitProceeds,
          costBasis: cost, proceeds: proceeds, gain: proceeds - cost,
          holdingPeriodDays: Math.floor((ts(tx.date) - ts(m.lot.date)) / 86400000),
          longTerm: heldOverOneYear(m.lot.date, tx.date)
        });
      });
    });
    var openQty = 0, openCost = 0;
    open.forEach(function (l) { openQty += l.qty; openCost += l.qty * l.unitCostEUR; });
    return {
      openLots: open,
      disposals: disposals,
      openQty: openQty,
      openCostEUR: openCost,
      realizedGain: disposals.reduce(function (s, d) { return s + d.gain; }, 0),
      proceedsEUR: disposals.reduce(function (s, d) { return s + d.proceeds; }, 0),
      oversold: oversold
    };
  }

  function build(transactions, opts) {
    opts = opts || {};
    var rate = num(opts.exchangeRate);
    var fxAt = typeof opts.fxAt === 'function' ? opts.fxAt : null;
    var txs = transactions || [];
    var CA = opts.applyCorporateActions === false ? null : corporateActions();
    if (CA && CA.adjust) txs = CA.adjust(txs);
    var byKey = {}, meta = {};
    txs.forEach(function (tx) {
      if (!tx || (tx.type !== 'buy' && tx.type !== 'sell')) return;
      if (opts.categories && opts.categories.indexOf(tx.category || 'crypto') === -1) return;
      var k = keyOf(tx);
      (byKey[k] || (byKey[k] = [])).push(tx);
      var m = meta[k] || (meta[k] = { category: tx.category || 'crypto', symbol: tx.symbol || tx.name || '', symbolName: '', symbolLogoUrl: '' });
      if (!m.symbolName && tx.symbolName) m.symbolName = tx.symbolName;
      if (!m.symbolLogoUrl && tx.symbolLogoUrl) m.symbolLogoUrl = tx.symbolLogoUrl;
    });
    var groups = {}, list = [];
    Object.keys(byKey).forEach(function (k) {
      var g = Object.assign({ key: k }, meta[k], runGroup(byKey[k], rate, fxAt));
      groups[k] = g;
      list.push(g);
    });
    return { groups: groups, list: list };
  }

  // Single group convenience (callers that already grouped by symbol).
  function group(txs, opts) {
    opts = opts || {};
    var CA = opts.applyCorporateActions === false ? null : corporateActions();
    var list = (CA && CA.adjust && opts.applyCorporateActions === true) ? CA.adjust(txs || []) : (txs || []);
    return runGroup(list, num(opts.exchangeRate), typeof opts.fxAt === 'function' ? opts.fxAt : null);
  }

  var api = {
    build: build,
    group: group,
    keyOf: keyOf,
    oneYearAnniversary: oneYearAnniversary,
    heldOverOneYear: heldOverOneYear
  };
  if (typeof window !== 'undefined') window.MaerminLedger = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
