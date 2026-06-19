// ============================================================================
// MAERMIN — Savings-plan auto-execution  (window.MaerminSavingsExecutor)
// ----------------------------------------------------------------------------
// Until now SavingsPlanView only COUNTED existing buys against a plan
// (adherence); nothing was ever booked. This module makes due plans create
// real buy transactions so they appear in the Overview and every derived
// metric - with three hard guarantees:
//
//   Calendar-exact schedules - occurrence expansion is REUSED from
//   MaerminRecurring (expandOccurrences: month-end clamping, endDate support),
//   replacing the old 30.44-days-per-month approximation everywhere.
//
//   Idempotency - every execution is marked ON the transaction itself
//   (source:'savings-plan', planId, dueDate). The marker travels with the
//   transactions store through reloads, backup/restore and the encrypted
//   sync, so the same due date can never book twice on one device. If two
//   devices execute the same due date before syncing, the post-merge catch-up
//   detects the (planId, dueDate) collision and removes all but the
//   deterministic survivor (dedupeExecutions).
//
//   No invented quantities - quantity = amount / price at the due date,
//   resolved from the existing price history (nearest close at or before the
//   due date) or the current price for today's executions. When no price is
//   resolvable the occurrence stays PENDING and is reported, never booked
//   with a guessed quantity.
//
// Execution runs when the app is opened/unlocked (catch-up for missed
// periods up to today) - never in the background. Auto transactions carry
// auto:true and a note, so they stay distinguishable and deletable.
// Pure layer Node-tested in test/savings-executor.test.js.
// ============================================================================
(function () {
  'use strict';

  var PLANS_KEY = 'maermin_savings_plans'; // already in SENSITIVE_KEYS

  function recurring() {
    if (typeof window !== 'undefined' && window.MaerminRecurring) return window.MaerminRecurring;
    if (typeof require === 'function') { try { return require('./recurring.js'); } catch (e) { /* fall through */ } }
    return null;
  }

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }
  function todayISO() { return new Date().toISOString().split('T')[0]; }

  // ---- schedule (REUSES MaerminRecurring - calendar-exact) -------------------
  // All occurrences of a plan from startDate up to min(asOf, endDate).
  function occurrences(plan, asOfISO) {
    var R = recurring();
    if (!R || !plan || !plan.startDate) return [];
    var asOf = asOfISO || todayISO();
    return R.expandOccurrences({
      id: plan.id,
      name: plan.symbol,
      amount: num(plan.amount) || 0,
      interval: plan.frequency || 'monthly',
      startDate: plan.startDate,
      endDate: plan.endDate || null
    }, plan.startDate, asOf);
  }

  // Calendar-exact expected execution count (replaces the 30.44-day approx).
  function expectedExecutions(plan, asOfISO) {
    return occurrences(plan, asOfISO).length;
  }

  function planStatus(plan, asOfISO) {
    if (plan && plan.active === false) return 'paused';
    if (plan && plan.endDate && plan.endDate < (asOfISO || todayISO())) return 'completed';
    return 'active';
  }

  // ---- idempotency -------------------------------------------------------------
  function isExecution(tx) {
    return !!(tx && tx.source === 'savings-plan' && tx.planId && tx.dueDate);
  }
  function executionSet(transactions) {
    var set = {};
    (transactions || []).forEach(function (tx) {
      if (isExecution(tx)) set[tx.planId + '|' + tx.dueDate] = true;
    });
    return set;
  }

  // After a sync merge, two devices may each have booked the same due date
  // under different transaction ids. Deterministic survivor: the smallest id,
  // so every device deletes the same duplicates. Only auto executions are
  // ever touched - manual transactions are none of this module's business.
  function dedupeExecutions(transactions) {
    var byKey = {};
    (transactions || []).forEach(function (tx) {
      if (!isExecution(tx)) return;
      var key = tx.planId + '|' + tx.dueDate;
      (byKey[key] || (byKey[key] = [])).push(tx);
    });
    var removeIds = {};
    Object.keys(byKey).forEach(function (key) {
      var list = byKey[key];
      if (list.length < 2) return;
      list.sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; });
      list.slice(1).forEach(function (tx) { removeIds[tx.id] = true; });
    });
    var removed = Object.keys(removeIds).length;
    if (!removed) return { transactions: transactions || [], removed: 0 };
    return {
      transactions: (transactions || []).filter(function (tx) { return !removeIds[tx.id]; }),
      removed: removed
    };
  }

  // ---- execution ------------------------------------------------------------------
  // Which due occurrences are not booked yet?
  function pendingExecutions(plans, transactions, asOfISO) {
    var done = executionSet(transactions);
    var out = [];
    (plans || []).forEach(function (plan) {
      if (!plan || plan.active === false) return;
      if (!(num(plan.amount) > 0) || !plan.symbol) return;
      occurrences(plan, asOfISO).forEach(function (occ) {
        if (!done[plan.id + '|' + occ.date]) out.push({ plan: plan, dueDate: occ.date });
      });
    });
    return out;
  }

  // Build the real buy transaction for one due occurrence. price = EUR price
  // per unit at the due date; the caller resolves it (null -> stays pending).
  function buildTransaction(plan, dueDate, priceEUR, estimated) {
    var amount = num(plan.amount) || 0;
    var price = num(priceEUR);
    if (!(amount > 0) || !(price > 0)) return null;
    return {
      type: 'buy',
      category: plan.category || 'crypto',
      symbol: plan.symbol,
      symbolName: plan.symbolName || '',
      quantity: amount / price,
      price: price,
      fees: 0,
      currency: 'EUR',
      date: dueDate,
      notes: estimated ? 'Savings plan auto-execution (estimated price)' : 'Savings plan auto-execution',
      portfolioId: plan.portfolioId || 'default',
      source: 'savings-plan',
      planId: plan.id,
      dueDate: dueDate,
      auto: true,
      estimatedPrice: !!estimated
    };
  }

  // Nearest EUR price at or before the due date from the app's priceHistory
  // series ({timestamp, price} rows); today's executions may fall back to the
  // live price map. Returns null when nothing covers the date.
  function priceAtDate(history, prices, symbol, dueDateISO) {
    var sym = String(symbol || '');
    var series = (history || {})[sym] || (history || {})[sym.toLowerCase()] || (history || {})[sym.toUpperCase()];
    var cutoff = new Date(dueDateISO + 'T23:59:59Z').getTime();
    var best = null, bestTs = -Infinity;
    (Array.isArray(series) ? series : []).forEach(function (h) {
      var ts = new Date(h && h.timestamp).getTime();
      var p = num(h && h.price);
      if (isNaN(ts) || p == null || p <= 0) return;
      if (ts <= cutoff && ts > bestTs) { bestTs = ts; best = p; }
    });
    if (best != null) return best;
    // Live price only for executions due today (booking history at today's
    // price would fabricate a fill the market never gave).
    if (dueDateISO === todayISO()) {
      var live = num((prices || {})[sym]) || num((prices || {})[sym.toLowerCase()]) || num((prices || {})[sym.toUpperCase()]);
      if (live != null && live > 0) return live;
    }
    return null;
  }

  // Like priceAtDate but never leaves a back-dated occurrence unbooked when a
  // current price exists: if no recorded price covers the due date, fall back
  // to the live price and flag the result as an ESTIMATE so the booked buy is
  // transparently marked (note + estimatedPrice) and stays editable. Returns
  // { price, estimated } or null when not even a live price is available.
  function priceForBackfill(history, prices, symbol, dueDateISO) {
    var exact = priceAtDate(history, prices, symbol, dueDateISO);
    if (exact != null) return { price: exact, estimated: false };
    var sym = String(symbol || '');
    var live = num((prices || {})[sym]) || num((prices || {})[sym.toLowerCase()]) || num((prices || {})[sym.toUpperCase()]);
    if (live != null && live > 0) return { price: live, estimated: true };
    return null;
  }

  // One catch-up pass (pure): dedupe sync collisions, book every resolvable
  // due occurrence, report the rest as pending with a reason.
  function runCatchUp(plans, transactions, resolvePrice, asOfISO, newId) {
    var deduped = dedupeExecutions(transactions);
    var txs = deduped.transactions;
    var pending = [];
    var created = [];
    var idGen = newId || function (i) { return Date.now().toString() + '-sp' + i; };
    pendingExecutions(plans, txs, asOfISO).forEach(function (item, i) {
      var resolved = resolvePrice ? resolvePrice(item.plan, item.dueDate) : null;
      var price = resolved, estimated = false;
      if (resolved != null && typeof resolved === 'object') { price = resolved.price; estimated = !!resolved.estimated; }
      var tx = buildTransaction(item.plan, item.dueDate, price, estimated);
      if (tx) {
        tx.id = idGen(i);
        created.push(tx);
        txs = txs.concat([tx]);
      } else {
        pending.push({ planId: item.plan.id, symbol: item.plan.symbol, dueDate: item.dueDate, reason: 'no price for due date' });
      }
    });
    return { transactions: txs, created: created, pending: pending, removedDuplicates: deduped.removed };
  }

  var api = {
    PLANS_KEY: PLANS_KEY,
    occurrences: occurrences,
    expectedExecutions: expectedExecutions,
    planStatus: planStatus,
    isExecution: isExecution,
    pendingExecutions: pendingExecutions,
    dedupeExecutions: dedupeExecutions,
    buildTransaction: buildTransaction,
    priceAtDate: priceAtDate,
    priceForBackfill: priceForBackfill,
    runCatchUp: runCatchUp
  };
  if (typeof window !== 'undefined') window.MaerminSavingsExecutor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
