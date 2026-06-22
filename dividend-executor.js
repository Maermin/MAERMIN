// ============================================================================
// MAERMIN v10.x — Dividend auto-booking  (window.MaerminDividendExecutor)
// ----------------------------------------------------------------------------
// Opt-in: when enabled, every dividend whose PAY date has passed is booked as a
// `type:'dividend'` transaction in the Transactions tab — in the PAYOUT currency
// (USD dividends stay USD, EUR stay EUR), so the ledger reflects what actually
// landed. Same idempotent executor pattern as savings-plan-executor.js: each
// auto booking carries a (symbol|payDate|portfolio) marker so re-running never
// double-books.
//
// The payout is encoded as quantity × price (shares × dividend-per-share) — the
// shape the existing DividendForecastView already sums — so realised-dividend
// views and the auto-booking stay consistent.
//
// Source of truth for "which dividend, when, how much" is
// DividendDataService.buildPaymentSchedule(portfolio) (cache → API → built-in
// DB). Amounts use CURRENT shares, so they are an ESTIMATE for past payouts —
// the feature is opt-in and labelled as such. Pure core (no DOM); unit-tested in
// test/dividend-executor.test.js.
// ============================================================================
(function () {
  'use strict';

  var SETTING_KEY = 'maermin_div_autobook'; // '1' = on

  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function up(s) { return String(s == null ? '' : s).toUpperCase(); }
  function markerOf(symbol, date, portfolioId) { return up(symbol) + '|' + String(date) + '|' + (portfolioId || 'default'); }

  // An auto-booked dividend (never touches a user's manual dividend rows).
  function isAuto(tx) {
    return !!(tx && tx.type === 'dividend' && tx.source === 'dividend-auto' && tx.symbol && tx.divDate);
  }

  function bookedSet(transactions) {
    var set = {};
    (transactions || []).forEach(function (tx) {
      if (isAuto(tx)) set[markerOf(tx.symbol, tx.divDate, tx.portfolioId)] = true;
    });
    return set;
  }

  // Schedule rows are DividendDataService.buildPaymentSchedule output:
  //   { symbol, date, perShare, shares, amount, currency, past }
  // Pending = a PAST payout with a positive amount that isn't booked yet.
  function pending(schedule, transactions, portfolioId) {
    portfolioId = portfolioId || 'default';
    var done = bookedSet(transactions);
    return (schedule || []).filter(function (r) {
      return r && r.past === true && num(r.amount) > 0 && r.symbol && r.date
        && !done[markerOf(r.symbol, r.date, portfolioId)];
    });
  }

  // Build the dividend transaction for one past payout. Amount = shares ×
  // perShare, encoded as quantity × price; currency is the payout currency.
  function buildTransaction(row, portfolioId) {
    var shares = num(row.shares), perShare = num(row.perShare);
    var amount = num(row.amount) || (shares * perShare);
    if (!(amount > 0)) return null;
    // Keep quantity × price === amount even when only `amount` is known.
    var qty = shares > 0 ? shares : 1;
    var price = shares > 0 ? perShare : amount;
    var cur = (row.currency === 'EUR') ? 'EUR' : (row.currency || 'USD');
    return {
      type: 'dividend',
      category: 'stocks',
      symbol: row.symbol,
      symbolName: row.symbolName || '',
      quantity: qty,
      price: price,
      fees: 0,
      currency: cur,
      date: row.date,
      notes: 'Dividend (auto, estimated): ' + (shares > 0 ? (shares + ' × ' + perShare + ' ' + cur) : (amount + ' ' + cur)),
      portfolioId: portfolioId || 'default',
      source: 'dividend-auto',
      divDate: row.date,
      auto: true
    };
  }

  // Book every pending past payout. Returns the new transactions array + the
  // created rows. idSeed makes ids deterministic for tests.
  function runCatchUp(schedule, transactions, portfolioId, idSeed) {
    var out = (transactions || []).slice();
    var created = [];
    var seed = idSeed || Date.now();
    pending(schedule, transactions, portfolioId).forEach(function (row, i) {
      var tx = buildTransaction(row, portfolioId);
      if (!tx) return;
      tx.id = String(seed) + '-div-' + i + '-' + up(row.symbol);
      out.push(tx);
      created.push(tx);
    });
    return { transactions: out, created: created };
  }

  // ---- settings (browser) ---------------------------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function isEnabled() { var s = store(); try { return !!s && s.getItem(SETTING_KEY) === '1'; } catch (e) { return false; } }
  function setEnabled(on) { var s = store(); if (!s) return false; try { s.setItem(SETTING_KEY, on ? '1' : '0'); return true; } catch (e) { return false; } }

  var api = {
    SETTING_KEY: SETTING_KEY,
    isAuto: isAuto,
    bookedSet: bookedSet,
    pending: pending,
    buildTransaction: buildTransaction,
    runCatchUp: runCatchUp,
    isEnabled: isEnabled,
    setEnabled: setEnabled
  };
  if (typeof window !== 'undefined') window.MaerminDividendExecutor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
