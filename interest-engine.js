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
        date: r.toDate, periodStart: r.fromDate, periodEnd: r.toDate, year: r.toDate.slice(0, 4),
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
        periodStart: p.periodStart, periodEnd: p.periodEnd, auto: true, notes: 'Interest accrual'
      });
    });
    var ledger = appendLedger(opts.ledger, res.postings);
    return {
      accounts: res.accounts, transactions: created.length ? txs.concat(created) : txs,
      created: created, postings: res.postings, ledger: ledger, total: res.total
    };
  }

  // ---- post-sync dedupe -----------------------------------------------------
  // Two devices that each ran the catch-up before syncing book the same days
  // under their own ids and periodEnds; the sync union keeps both. The
  // accounts key itself is last-write-wins, so the merged account (balance +
  // lastAccrualDate) is exactly ONE device's accrual chain. Keep that chain -
  // traced back from lastAccrualDate via periodStart - and drop every other
  // accrual of the account whose [periodStart, periodEnd] overlaps a kept one.
  // Then balance, lastAccrualDate and booked interest agree, and the next
  // catch-up books only what is still missing. Legacy rows (no periodStart)
  // are dropped only when they repeat the exact same period. Deterministic, so
  // both devices remove the same rows. Returns { transactions, accounts,
  // ledger, removed, removedTxs }; `transactions` is the input array when
  // nothing changed.
  function isAccrual(tx) { return !!(tx && tx.source === 'interest-accrual' && tx.accountId); }
  function byId(a, b) { return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0); }
  function overlaps(a, b) {
    return !!(a.periodStart && b.periodStart) && ymd(a.periodStart) < ymd(b.periodEnd) && ymd(b.periodStart) < ymd(a.periodEnd);
  }
  function dedupeAccruals(transactions, accounts, ledger) {
    var txs = Array.isArray(transactions) ? transactions : [];
    accounts = Array.isArray(accounts) ? accounts : [];
    var groups = {};
    txs.forEach(function (tx) {
      if (!isAccrual(tx)) return;
      var k = str(tx.accountId);
      (groups[k] || (groups[k] = [])).push(tx);
    });
    var removeIds = {}, removedTxs = [], keptByAcc = {};
    Object.keys(groups).forEach(function (accId) {
      var list = groups[accId].slice().sort(byId);
      // 1) exact repeats of one period: smallest id wins
      var seenPeriod = {}, uniq = [];
      list.forEach(function (tx) {
        var k = ymd(tx.periodStart) + '|' + ymd(tx.periodEnd);
        if (seenPeriod[k]) { removeIds[tx.id] = true; removedTxs.push(tx); return; }
        seenPeriod[k] = true; uniq.push(tx);
      });
      // 2) the chain the merged account reflects
      var acc = accounts.filter(function (a) { return a && str(a.id) === accId; })[0];
      var kept = [], keptSet = {};
      var cur = acc ? ymd(acc.lastAccrualDate) : '';
      while (cur) {
        var link = uniq.filter(function (tx) { return ymd(tx.periodEnd) === cur && tx.periodStart && !keptSet[tx.id]; })[0];
        if (!link) break;
        kept.push(link); keptSet[link.id] = true;
        cur = ymd(link.periodStart);
      }
      // 3) everything else: latest period first, keep unless it overlaps
      uniq.filter(function (tx) { return !keptSet[tx.id]; })
        .sort(function (a, b) { return ymd(a.periodEnd) > ymd(b.periodEnd) ? -1 : (ymd(a.periodEnd) < ymd(b.periodEnd) ? 1 : byId(a, b)); })
        .forEach(function (tx) {
          if (kept.some(function (k) { return overlaps(tx, k); })) { removeIds[tx.id] = true; removedTxs.push(tx); return; }
          kept.push(tx); keptSet[tx.id] = true;
        });
      keptByAcc[accId] = kept;
    });
    var removed = removedTxs.length;
    if (!removed) return { transactions: txs, accounts: accounts, ledger: ledger, removed: 0, removedTxs: [] };

    // Re-derive lastAccrualDate: an account that never saw a kept accrual
    // ending after its anchor (no chain to trace) takes that interest on board.
    var outAccounts = accounts.map(function (acc) {
      var kept = acc && keptByAcc[str(acc.id)];
      if (!kept || !kept.length) return acc;
      var last = ymd(acc.lastAccrualDate);
      var unseen = kept.filter(function (tx) { return tx.periodStart && ymd(tx.periodStart) >= last && ymd(tx.periodEnd) > last; });
      if (!unseen.length) return acc;
      var add = unseen.reduce(function (s, tx) { return s + num(tx.amount != null ? tx.amount : tx.price); }, 0);
      var end = unseen.reduce(function (m, tx) { return ymd(tx.periodEnd) > m ? ymd(tx.periodEnd) : m; }, last);
      return Object.assign({}, acc, { value: num(acc.value) + add, lastAccrualDate: end });
    });

    // The per-year ledger follows the kept accruals.
    var l = normalizeLedger(ledger);
    var keptKeys = {}, keptPostings = [];
    Object.keys(keptByAcc).forEach(function (accId) {
      keptByAcc[accId].forEach(function (tx) {
        keptKeys[accId + '|' + ymd(tx.periodEnd)] = true;
        keptPostings.push({ accountId: accId, date: ymd(tx.periodEnd), amount: num(tx.amount != null ? tx.amount : tx.price) });
      });
    });
    var dropKeys = {};
    removedTxs.forEach(function (tx) { var k = str(tx.accountId) + '|' + ymd(tx.periodEnd); if (!keptKeys[k]) dropKeys[k] = true; });
    l.entries = l.entries.filter(function (en) { return !dropKeys[en.accountId + '|' + en.date]; });
    l = appendLedger(l, keptPostings);

    return {
      transactions: txs.filter(function (tx) { return !(tx && removeIds[tx.id]); }),
      accounts: outAccounts, ledger: l, removed: removed, removedTxs: removedTxs
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
    runCatchUp: runCatchUp, dedupeAccruals: dedupeAccruals, loadLedger: loadLedger, saveLedger: saveLedger
  };

  if (typeof window !== 'undefined') window.MaerminInterest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
