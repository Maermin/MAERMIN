// ============================================================================
// MAERMIN — Interest accrual for cash / time deposits  (window.MaerminInterest)
// ----------------------------------------------------------------------------
// Competitive-gap WI-2. Net-Worth cash accounts gain an interest rate, and a new
// `time_deposit` (Festgeld) account type is recognised. A day-accurate, act/365
// accrual grows the balance and is reported to the tax engine as capital income
// (Kapitalertrag) by booking `type:'interest'` transactions.
//
// Idempotency, mirrored on the savings-plan executor: each accrual advances the
// account's `lastAccrualDate`, so a same-day re-run computes 0 days and books
// nothing; each tax posting carries an (accountId, periodEnd) marker so a re-run
// never double-books. Catch-up runs when the app opens, never in the background.
//
// Account fields used: interestRate (% p.a.), compounding (daily|monthly|annual),
// startDate, maturityDate (time deposits only), lastAccrualDate. The optional
// ledger (key 'maermin_interest_ledger', in the full-vault backup) keeps a flat
// per-year record for the tax-advisor headroom math.
//
// Pure layer Node-tested in test/interest-engine.test.js.
// ============================================================================
(function () {
  'use strict';

  var LEDGER_KEY = 'maermin_interest_ledger';
  var SCHEMA = 1;
  var DAY_MS = 86400000;

  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function str(x) { return String(x == null ? '' : x).trim(); }
  function ymd(d) { return str(d).slice(0, 10); }
  function uid() { return 'int' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function parseDate(iso) {
    var s = ymd(iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var d = new Date(s + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : d;
  }
  // Whole calendar days between two ISO dates (b - a), never negative.
  function daysBetween(aISO, bISO) {
    var a = parseDate(aISO), b = parseDate(bISO);
    if (!a || !b) return 0;
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / DAY_MS));
  }

  // An account earns interest when it is a time deposit, or a cash/checking
  // account with a positive rate, and it has a start anchor to accrue from.
  function isInterestBearing(acc) {
    if (!acc) return false;
    var type = str(acc.type);
    var rate = num(acc.interestRate);
    var startable = !!(acc.lastAccrualDate || acc.startDate);
    if (type === 'time_deposit') return rate > 0 && startable;
    if (type === 'cash' || type === 'checking') return rate > 0 && startable;
    return false;
  }

  // Growth factor over `days` for a yearly rate r under act/365 day-count, with
  // the chosen compounding frequency. interest = balance * (factor - 1).
  function growthFactor(rate, days, compounding) {
    if (days <= 0 || rate <= 0) return 1;
    var t = days / 365;
    switch (compounding) {
      case 'daily':   return Math.pow(1 + rate / 365, days);
      case 'monthly': return Math.pow(1 + rate / 12, t * 12);
      case 'annual':  return Math.pow(1 + rate, t);
      default:        return Math.pow(1 + rate / 365, days); // default daily
    }
  }

  // Accrue interest on one account up to `asOf`. Returns the new balance, the
  // interest amount, the day count and the advanced lastAccrualDate. Interest
  // never accrues past a time deposit's maturity date.
  function accrue(account, asOfISO) {
    var balance = num(account && account.value);
    var anchor = ymd((account && account.lastAccrualDate) || (account && account.startDate));
    var none = { days: 0, interest: 0, newBalance: balance, fromDate: anchor, toDate: anchor, lastAccrualDate: anchor };
    if (!isInterestBearing(account) || !anchor) return none;
    var end = ymd(asOfISO);
    if (account.maturityDate && ymd(account.maturityDate) < end) end = ymd(account.maturityDate);
    var days = daysBetween(anchor, end);
    if (days <= 0) return none;
    var rate = num(account.interestRate) / 100;
    var factor = growthFactor(rate, days, str(account.compounding) || 'daily');
    var interest = balance * (factor - 1);
    return {
      days: days, interest: interest, newBalance: balance + interest,
      fromDate: anchor, toDate: end, lastAccrualDate: end
    };
  }

  // Accrue every interest-bearing account. Returns updated accounts (value +
  // lastAccrualDate advanced) and one posting per account that actually earned.
  function accrueAll(accounts, asOfISO) {
    accounts = Array.isArray(accounts) ? accounts : [];
    var postings = [], total = 0;
    var updated = accounts.map(function (acc) {
      if (!isInterestBearing(acc)) return acc;
      var r = accrue(acc, asOfISO);
      if (r.days <= 0 || !(r.interest > 0)) {
        // still advance the anchor so we don't recompute the same zero window
        return Object.assign({}, acc, { lastAccrualDate: r.lastAccrualDate || acc.lastAccrualDate });
      }
      total += r.interest;
      postings.push({
        accountId: str(acc.id), name: str(acc.name) || 'Interest',
        date: r.toDate, periodEnd: r.toDate, year: r.toDate.slice(0, 4),
        amount: r.interest, currency: str(acc.currency) || 'EUR'
      });
      return Object.assign({}, acc, { value: r.newBalance, lastAccrualDate: r.lastAccrualDate });
    });
    return { accounts: updated, postings: postings, total: total };
  }

  // ---- ledger ---------------------------------------------------------------
  function normalizeLedger(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var list = Array.isArray(obj.entries) ? obj.entries : (Array.isArray(obj) ? obj : []);
    var entries = [];
    list.forEach(function (en) {
      if (!en || typeof en !== 'object') return;
      var date = ymd(en.date);
      if (!date) return;
      entries.push({
        id: en.id ? str(en.id) : uid(), accountId: str(en.accountId),
        date: date, year: date.slice(0, 4), amount: num(en.amount)
      });
    });
    return { version: SCHEMA, entries: entries };
  }
  function appendLedger(ledger, postings) {
    var l = normalizeLedger(ledger);
    (postings || []).forEach(function (p) {
      // idempotent on (accountId, periodEnd)
      var dup = l.entries.some(function (en) { return en.accountId === str(p.accountId) && en.date === ymd(p.date); });
      if (dup) return;
      l.entries.push({ id: uid(), accountId: str(p.accountId), date: ymd(p.date), year: ymd(p.date).slice(0, 4), amount: num(p.amount) });
    });
    return l;
  }
  function yearlyInterest(ledger, year) {
    var l = normalizeLedger(ledger);
    var y = String(year);
    return l.entries.reduce(function (s, en) { return en.year === y ? s + en.amount : s; }, 0);
  }

  // ---- catch-up: accrue + book interest transactions ------------------------
  // `transactions` is the live store; returns the merged list plus the updated
  // accounts and ledger. Each booked tx carries source:'interest-accrual' and an
  // (accountId, periodEnd) marker so re-runs never double-book.
  function runCatchUp(opts) {
    opts = opts || {};
    var accounts = Array.isArray(opts.accounts) ? opts.accounts : [];
    var txs = Array.isArray(opts.transactions) ? opts.transactions : [];
    var asOf = ymd(opts.asOf) || (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils.todayISO() : new Date().toISOString().slice(0, 10));
    var portfolioId = opts.portfolioId || null;
    var res = accrueAll(accounts, asOf);
    var created = [];
    res.postings.forEach(function (p) {
      var exists = txs.some(function (tx) {
        return tx && tx.source === 'interest-accrual' && str(tx.accountId) === p.accountId && ymd(tx.periodEnd) === p.date;
      });
      if (exists) return;
      created.push({
        id: (typeof window !== 'undefined' && window.MaerminUtils && window.MaerminUtils.generateId) ? window.MaerminUtils.generateId() : uid(),
        type: 'interest', category: 'cash', symbol: p.name, symbolName: p.name,
        quantity: 1, price: p.amount, amount: p.amount, fees: 0,
        currency: p.currency || 'EUR', date: p.date,
        portfolioId: portfolioId, source: 'interest-accrual', accountId: p.accountId,
        periodEnd: p.periodEnd, auto: true, notes: 'Interest accrual'
      });
    });
    var ledger = appendLedger(opts.ledger, res.postings);
    return {
      accounts: res.accounts, transactions: created.length ? txs.concat(created) : txs,
      created: created, postings: res.postings, ledger: ledger, total: res.total
    };
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function loadLedger() {
    var s = store();
    if (!s) return { version: SCHEMA, entries: [] };
    try { return normalizeLedger(s.getItem(LEDGER_KEY)); } catch (e) { return { version: SCHEMA, entries: [] }; }
  }
  function saveLedger(ledger) {
    var s = store();
    if (!s) return false;
    try { s.setItem(LEDGER_KEY, JSON.stringify(normalizeLedger(ledger))); return true; } catch (e) { return false; }
  }

  var api = {
    LEDGER_KEY: LEDGER_KEY, SCHEMA: SCHEMA,
    daysBetween: daysBetween, isInterestBearing: isInterestBearing, growthFactor: growthFactor,
    accrue: accrue, accrueAll: accrueAll,
    normalizeLedger: normalizeLedger, appendLedger: appendLedger, yearlyInterest: yearlyInterest,
    runCatchUp: runCatchUp, loadLedger: loadLedger, saveLedger: saveLedger
  };

  if (typeof window !== 'undefined') window.MaerminInterest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
