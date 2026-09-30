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
  var SKIP_KEY = 'maermin_div_skipped';      // [marker] the user deleted -> never re-book

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

  // Shares of `symbol` held in `portfolioId` at the end of `date` (buys minus
  // sells up to and including that day). The schedule's `shares` is the
  // CURRENT position, which overstates past payouts for anything bought later
  // (and invents dividends for shares that were not held yet).
  function sharesAt(transactions, symbol, date, portfolioId) {
    var sym = up(symbol), pid = portfolioId || 'default', q = 0;
    (transactions || []).forEach(function (tx) {
      if (!tx || up(tx.symbol) !== sym || (tx.portfolioId || 'default') !== pid) return;
      if (!tx.date || String(tx.date) > String(date)) return;
      if (tx.type === 'buy') q += num(tx.quantity);
      else if (tx.type === 'sell') q -= num(tx.quantity);
    });
    return q > 1e-9 ? q : 0;
  }

  // Schedule rows are DividendDataService.buildPaymentSchedule output:
  //   { symbol, date, perShare, shares, amount, currency, past }
  // Pending = a PAST payout with a positive amount that isn't booked yet and
  // wasn't deleted by the user (skipped markers).
  function pending(schedule, transactions, portfolioId, skipped) {
    portfolioId = portfolioId || 'default';
    var done = bookedSet(transactions);
    var skip = {};
    (Array.isArray(skipped) ? skipped : []).forEach(function (m) { skip[m] = true; });
    return (schedule || []).filter(function (r) {
      if (!(r && r.past === true && num(r.amount) > 0 && r.symbol && r.date)) return false;
      var m = markerOf(r.symbol, r.date, portfolioId);
      return !done[m] && !skip[m];
    });
  }

  // Re-scale a schedule row to the shares actually held on its date.
  function atHistoricShares(row, transactions, portfolioId) {
    if (!transactions) return row;
    var held = sharesAt(transactions, row.symbol, row.date, portfolioId);
    var cur = num(row.shares);
    var per = num(row.perShare) || (cur > 0 ? num(row.amount) / cur : 0);
    if (!(held > 0) || !(per > 0)) return null;
    return Object.assign({}, row, { shares: held, perShare: per, amount: held * per });
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
  function runCatchUp(schedule, transactions, portfolioId, idSeed, skipped) {
    var out = (transactions || []).slice();
    var created = [];
    var seed = idSeed || (Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    pending(schedule, transactions, portfolioId, skipped).forEach(function (row0, i) {
      var row = atHistoricShares(row0, transactions, portfolioId);
      if (!row) return; // not held on that date
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
  function loadSkipped() { var s = store(); try { var a = JSON.parse((s && s.getItem(SKIP_KEY)) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  // Remember deleted auto-dividends so the catch-up doesn't book them again.
  function markSkipped(deletedTxs) {
    var s = store(); if (!s) return false;
    var cur = loadSkipped(), added = false;
    (deletedTxs || []).forEach(function (tx) {
      if (!isAuto(tx)) return;
      var m = markerOf(tx.symbol, tx.divDate, tx.portfolioId);
      if (cur.indexOf(m) === -1) { cur.push(m); added = true; }
    });
    if (added) { try { s.setItem(SKIP_KEY, JSON.stringify(cur.slice(-2000))); } catch (e) { return false; } }
    return added;
  }
  function setEnabled(on) { var s = store(); if (!s) return false; try { s.setItem(SETTING_KEY, on ? '1' : '0'); return true; } catch (e) { return false; } }

  var api = {
    SETTING_KEY: SETTING_KEY,
    SKIP_KEY: SKIP_KEY,
    sharesAt: sharesAt,
    loadSkipped: loadSkipped,
    markSkipped: markSkipped,
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
