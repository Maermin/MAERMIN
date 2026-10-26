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
//   • currency:   USD (and USD stablecoins) convert at the rate OF THEIR DATE
//                 (`fxAt`), falling back to the static `exchangeRate`; other
//                 fiat at the current cross rate; unknown ones are reported
//   • splits:     the corporate-actions overlay is applied first (if loaded)
//   • oversells:  the unmatched remainder is reported, never silently dropped
//   • holding:    long-term = held MORE than one year (§ 23 EStG; anniversary
//                 sale is still short-term, 29 Feb → 28 Feb)
//
//   closedPositions(build)  fully sold positions with cost, proceeds, realised P&L
//   build(transactions, { exchangeRate, fxAt, applyCorporateActions = true,
//                         method = 'fifo'|'lifo'|'hifo'|'average',
//                         perWallet: ['crypto'],     (P5-4.6; defaults: FIFO, pooled)
//                         depots: [portfolioId],     (M-15: own FIFO pool per marked depot, not crypto)
//                         perPortfolio: true })      (lots never move between portfolios: a sale
//                                                     takes the lots of its own portfolio; each
//                                                     group carries its `portfolioId`)
//     → { groups: { key: Group }, list: Group[], issues: Issue[] }
//   Group = { key, category, symbol, symbolName, symbolLogoUrl,
//             openLots:  [{ qty, unitCostEUR, date, txId }], oldest first
//             disposals: [{ qty, acquisitionDate, disposalDate, unitCostEUR,
//                           unitProceedsEUR, costBasis, proceeds, gain,
//                           holdingPeriodDays, longTerm, acquisitionTxId, disposalTxId }],
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
    if (isNaN(t.getTime())) return '';
    return typeof d === 'number' ? t.toISOString().slice(0, 10) : (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO(t); // a local time: its local date
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

  function fx() {
    if (typeof window !== 'undefined' && window.MaerminFxHistory) return window.MaerminFxHistory;
    try { return require('./fx-history.js'); } catch (e) { return null; }
  }

  // Amount in the transaction currency → EUR (MaerminFxHistory.txAmountToEUR: a
  // rate stored on the tx (tx.fx.EUR, equity events) wins; else txToEUR): EUR,
  // USD and USD stablecoins at the rate of the tx date; other fiat at the
  // current cross rate ('approx'); no rate at all → 'unknown' (amount kept,
  // reported via `currencyIssues`). Before, every non-USD currency was EUR.
  function toEUR(amount, tx, rate, fxAt, ctx) {
    var F = fx();
    var res = F && F.txAmountToEUR ? F.txAmountToEUR(amount, tx, rate, fxAt, ctx && ctx.usdRates)
      : { value: (tx.currency === 'USD' && rate > 0) ? num(amount) * rate : num(amount), status: 'exact' };
    if (res.status !== 'exact' && ctx && num(amount) !== 0) {
      var k = String(tx.currency) + '|' + res.status;
      if (!ctx.seen[k]) { ctx.seen[k] = true; ctx.currencyIssues.push({ currency: String(tx.currency), status: res.status, symbol: tx.symbol || tx.name || '', date: ymd(tx.date), txId: tx.id != null ? tx.id : null }); }
    }
    return res.value;
  }

  function keyOf(tx) {
    return (tx.category || 'crypto') + '|' + String(tx.symbol || tx.name || '').toUpperCase();
  }

  function corporateActions() {
    if (typeof window !== 'undefined' && window.MaerminCorporateActions) return window.MaerminCorporateActions;
    return null;
  }

  // Which open lot a sale takes next (P5-4.6). 'fifo' (the default and the
  // tax report's method): the oldest; 'lifo': the newest; 'hifo': the one with
  // the highest unit cost. 'average' takes the lots in FIFO order (for the
  // holding period) but at the moving average cost of everything open.
  function nextLot(open, method) {
    if (method === 'lifo') return open.length - 1;
    if (method === 'hifo') {
      var best = 0;
      for (var i = 1; i < open.length; i++) if (open[i].unitCostEUR > open[best].unitCostEUR + 1e-12) best = i;
      return best;
    }
    return 0;
  }

  // FIFO (or opts.method) over ONE group's transactions (any order). Returns
  // the Group body.
  function runGroup(txs, rate, fxAt, ctx, method) {
    var sorted = (txs || []).slice().sort(function (a, b) {
      return (ts(a.date) - ts(b.date)) || ((a.type === 'buy' ? 0 : 1) - (b.type === 'buy' ? 0 : 1));
    });
    var open = [];      // { qty, unitCostEUR, date }
    var disposals = [];
    var oversold = 0;
    sorted.forEach(function (tx) {
      var qty = num(tx.quantity);
      if (!(qty > 0)) {
        // A buy/sell without a positive quantity cannot be booked; report it
        // instead of dropping it silently (a sell entered as -0.5 vanished).
        if ((tx.type === 'buy' || tx.type === 'sell') && ctx && ctx.quantityIssues) {
          ctx.quantityIssues.push({ kind: 'quantity', severity: 'warning', type: tx.type, symbol: tx.symbol || tx.name || '', txId: tx.id != null ? tx.id : null,
            category: tx.category || 'crypto', date: ymd(tx.date), qty: isFinite(parseFloat(tx.quantity)) ? parseFloat(tx.quantity) : String(tx.quantity) });
        }
        return;
      }
      if (tx.type === 'buy') {
        var fee = toEUR(tx.fees, tx, rate, fxAt, ctx);
        open.push({ qty: qty, unitCostEUR: toEUR(tx.price, tx, rate, fxAt, ctx) + (fee > 0 ? fee / qty : 0), date: tx.date, txId: tx.id != null ? tx.id : null });
        return;
      }
      if (tx.type !== 'sell') return;
      var unitProceeds = toEUR(tx.price, tx, rate, fxAt, ctx);
      var sellFee = Math.max(0, toEUR(tx.fees, tx, rate, fxAt, ctx));
      var remaining = qty, matches = [];
      var avg = null;
      if (method === 'average' && open.length) {
        var oq = 0, oc = 0;
        open.forEach(function (l) { oq += l.qty; oc += l.qty * l.unitCostEUR; });
        avg = oq > 0 ? oc / oq : 0;
      }
      while (remaining > 1e-9 && open.length) {
        var at = nextLot(open, method);
        var lot = open[at];
        var used = Math.min(remaining, lot.qty);
        matches.push({ used: used, lot: avg != null ? { date: lot.date, unitCostEUR: avg, txId: lot.txId } : lot });
        lot.qty -= used;
        remaining -= used;
        if (lot.qty <= 1e-9) open.splice(at, 1);
      }
      // Moving average: what is left keeps the average it was sold at.
      if (avg != null) open.forEach(function (l) { l.unitCostEUR = avg; });
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
          longTerm: heldOverOneYear(m.lot.date, tx.date),
          // P5-4.8: which buy the units came from and which sale took them
          acquisitionTxId: m.lot.txId != null ? m.lot.txId : null, disposalTxId: tx.id != null ? tx.id : null
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
    // P5-4.6: categories kept per wallet (portfolio) instead of pooled - the
    // BMF's wallet-based view for crypto (6.3.2025). Each such group carries
    // its `wallet` (the portfolioId, '' for none).
    var perWallet = Array.isArray(opts.perWallet) ? opts.perWallet : [];
    // FINDINGS M-15: portfolios marked as a separate depot keep their own
    // FIFO pool for everything but crypto (§ 20 Abs. 4 S. 7 EStG: FIFO per
    // depot); the other portfolios share the common pool. Each such group
    // carries its `depot` (the portfolioId, 'default' for none).
    var depots = {};
    (Array.isArray(opts.depots) ? opts.depots : []).forEach(function (id) { depots[String(id)] = true; });
    var byKey = {}, meta = {};
    txs.forEach(function (tx) {
      if (!tx || (tx.type !== 'buy' && tx.type !== 'sell')) return;
      if (opts.categories && opts.categories.indexOf(tx.category || 'crypto') === -1) return;
      var cat = tx.category || 'crypto';
      var wallet = perWallet.indexOf(cat) !== -1 ? String(tx.portfolioId || '') : null;
      var pid = String(tx.portfolioId || 'default');
      var depot = (wallet == null && cat !== 'crypto' && depots[pid]) ? pid : null;
      var own = opts.perPortfolio ? pid : null;
      var k = keyOf(tx) + (wallet != null ? '|w:' + wallet : '') + (depot != null ? '|d:' + depot : '') + (own != null ? '|p:' + own : '');
      (byKey[k] || (byKey[k] = [])).push(tx);
      var m = meta[k] || (meta[k] = { category: cat, symbol: tx.symbol || tx.name || '', symbolName: '', symbolLogoUrl: '' });
      if (wallet != null) m.wallet = wallet;
      if (depot != null) m.depot = depot;
      if (own != null) m.portfolioId = own;
      if (!m.symbolName && tx.symbolName) m.symbolName = tx.symbolName;
      if (!m.symbolLogoUrl && tx.symbolLogoUrl) m.symbolLogoUrl = tx.symbolLogoUrl;
    });
    var groups = {}, list = [];
    var ctx = { usdRates: opts.usdRates, currencyIssues: [], quantityIssues: [], seen: {} };
    Object.keys(byKey).forEach(function (k) {
      var g = Object.assign({ key: k }, meta[k], runGroup(byKey[k], rate, fxAt, ctx, opts.method));
      groups[k] = g;
      list.push(g);
    });
    return { groups: groups, list: list, issues: issues(list, ctx.currencyIssues, ctx.quantityIssues) };
  }

  // The ids of the portfolios marked as a separate depot (`separateDepot` on a
  // maermin_portfolios entry) - the `depots` option of build().
  function depotsOf(portfolios) {
    return (Array.isArray(portfolios) ? portfolios : []).filter(function (p) { return p && p.id != null && p.separateDepot === true; })
      .map(function (p) { return String(p.id); });
  }

  // Data-quality findings of a build: buy/sell rows without a positive
  // quantity, sells without enough open units, and transaction currencies that
  // could only be converted approximately or not at all.
  // [{ kind: 'quantity'|'oversold'|'currency', severity, symbol, category?,
  //    qty?, type?, date?, currency?, status?, txId? (quantity, currency: the
  //    first transaction concerned) }]
  function issues(list, currencyIssues, quantityIssues) {
    var out = (quantityIssues || []).slice();
    (list || []).forEach(function (g) {
      if (g.oversold > 1e-9) out.push({ kind: 'oversold', severity: 'warning', symbol: g.symbol, category: g.category, qty: g.oversold });
    });
    (currencyIssues || []).forEach(function (c) {
      out.push({ kind: 'currency', severity: c.status === 'unknown' ? 'warning' : 'info', symbol: c.symbol, currency: c.currency, status: c.status, date: c.date, txId: c.txId });
    });
    return out;
  }

  // Single group convenience (callers that already grouped by symbol). Same
  // default as build(): recorded splits are applied unless
  // applyCorporateActions === false (it used to apply them only for `true`).
  function group(txs, opts) {
    opts = opts || {};
    var CA = opts.applyCorporateActions === false ? null : corporateActions();
    var list = (CA && CA.adjust) ? CA.adjust(txs || []) : (txs || []);
    return runGroup(list, num(opts.exchangeRate), typeof opts.fxAt === 'function' ? opts.fxAt : null,
      { usdRates: opts.usdRates, currencyIssues: [], seen: {} });
  }

  // Fully sold positions of a build (P4-2: "Closed" in the positions table).
  // A group is closed when nothing is left open and at least one sale was
  // matched against bought lots. Figures are the sums over its disposals:
  //   cost      disposed cost basis (buy price + buy fees, EUR at each date)
  //   proceeds  sale proceeds net of sell fees (EUR at each date)
  //   gain      realised P&L = proceeds − cost
  //   ret       realised return = gain / cost (null without cost)
  //   opened / closed   first buy date of a sold lot / last sale date
  // Options are left out (they are not positions). Newest close first.
  function closedPositions(built, opts) {
    opts = opts || {};
    var eps = opts.eps > 0 ? opts.eps : 1e-9;
    var out = [];
    // A perPortfolio build: the groups of one holding count as one position
    // (closed only when no portfolio holds it any more; key without '|p:').
    var merged = {}, list = [];
    ((built && built.list) || []).forEach(function (g) {
      if (!g || g.portfolioId == null) { list.push(g); return; }
      var k = g.key.split('|p:')[0], m = merged[k];
      if (!m) { m = merged[k] = Object.assign({}, g, { key: k, disposals: [], openQty: 0, oversold: 0 }); delete m.portfolioId; list.push(m); }
      m.disposals = m.disposals.concat(g.disposals || []);
      m.openQty += g.openQty || 0;
      m.oversold += g.oversold || 0;
    });
    list.forEach(function (g) {
      if (!g || g.category === 'options' || g.openQty > eps || !(g.disposals && g.disposals.length)) return;
      var cost = 0, proceeds = 0, qty = 0, opened = '', closed = '';
      g.disposals.forEach(function (d) {
        cost += d.costBasis; proceeds += d.proceeds; qty += d.qty;
        if (!opened || d.acquisitionDate < opened) opened = d.acquisitionDate;
        if (!closed || d.disposalDate > closed) closed = d.disposalDate;
      });
      out.push({ key: g.key, category: g.category, symbol: g.symbol, symbolName: g.symbolName || '', qty: qty,
        cost: cost, proceeds: proceeds, gain: proceeds - cost, ret: cost > 0 ? (proceeds - cost) / cost : null,
        opened: opened, closed: closed, oversold: g.oversold || 0 });
    });
    return out.sort(function (a, b) { return a.closed < b.closed ? 1 : a.closed > b.closed ? -1 : 0; });
  }

  // ---- P5-1.3: cash-flow bookings ------------------------------------------
  // Rows { type, category: 'cashflow', amount (> 0), currency, date,
  // portfolioId, notes?, symbol? (display only) }; a transfer between
  // portfolios is a pair sharing `transferId`, each with `counterPortfolioId`.
  // They never create positions or lots. sign = effect on the portfolio's
  // cash. flow = counts as an investment flow for XIRR and total return:
  // fees, taxes, refunds and interest charges do; deposits, withdrawals and
  // transfers only move cash and wait for the clearing account (P5-1.4).
  // Fees and taxes recorded on a trade stay on the trade (no double count).
  var CASH_TYPES = {
    deposit:         { sign: 1,  flow: false },
    withdrawal:      { sign: -1, flow: false },
    transfer_in:     { sign: 1,  flow: false },
    transfer_out:    { sign: -1, flow: false },
    fee:             { sign: -1, flow: true },
    fee_refund:      { sign: 1,  flow: true },
    tax:             { sign: -1, flow: true },
    tax_refund:      { sign: 1,  flow: true },
    interest_charge: { sign: -1, flow: true }
  };
  function isCash(tx) { return !!(tx && Object.prototype.hasOwnProperty.call(CASH_TYPES, tx.type)); }
  function isTransfer(tx) { return !!tx && (tx.type === 'transfer_in' || tx.type === 'transfer_out'); }

  // Missing or wrong fields of a cash row, in form order.
  function validateCash(tx) {
    var out = [];
    if (!isCash(tx)) return ['type'];
    var a = parseFloat(tx.amount);
    if (!(isFinite(a) && a > 0)) out.push('amount');
    if (!ymd(tx.date)) out.push('date');
    if (isTransfer(tx)) {
      if (!tx.transferId) out.push('transferId');
      if (!tx.counterPortfolioId || String(tx.counterPortfolioId) === String(tx.portfolioId || 'default')) out.push('counterPortfolioId');
    }
    return out;
  }

  // The two rows of a transfer. o = { amount, currency, date, fromPortfolioId,
  // toPortfolioId, notes? }; newId() makes ids. null when both sides match.
  function transferPair(o, newId) {
    o = o || {};
    var from = String(o.fromPortfolioId || 'default'), to = String(o.toPortfolioId || 'default');
    if (from === to) return null;
    var id = typeof newId === 'function' ? newId : function () { return 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
    var tid = 'tr_' + id();
    var base = { category: 'cashflow', amount: num(o.amount), currency: o.currency || 'EUR', date: o.date, transferId: tid };
    if (o.notes) base.notes = o.notes;
    return [
      Object.assign({ id: id(), type: 'transfer_out', portfolioId: from, counterPortfolioId: to }, base),
      Object.assign({ id: id(), type: 'transfer_in', portfolioId: to, counterPortfolioId: from }, base)
    ];
  }
  // The other half of a transfer row in `transactions`, or null.
  function pairOf(transactions, tx) {
    if (!isTransfer(tx) || !tx.transferId) return null;
    var list = transactions || [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o && o !== tx && o.transferId === tx.transferId && isTransfer(o) && o.id !== tx.id) return o;
    }
    return null;
  }

  // cashFlows(transactions, { exchangeRate, fxAt, usdRates, portfolioId })
  //   → { rows: [{ id, type, date, portfolioId, amountEUR, signedEUR, flow,
  //                transferId, counterPortfolioId, symbol }],
  //       byType: { type: EUR }, byYear: { 'YYYY': { type: EUR } },
  //       issues: [{ kind: 'cash-amount', txId, type, date } | currency issues] }
  function cashFlows(transactions, opts) {
    opts = opts || {};
    var rate = num(opts.exchangeRate);
    var fxAt = typeof opts.fxAt === 'function' ? opts.fxAt : null;
    var ctx = { usdRates: opts.usdRates, currencyIssues: [], seen: {} };
    var rows = [], byType = {}, byYear = {}, bad = [];
    (transactions || []).forEach(function (tx) {
      if (!isCash(tx)) return;
      if (opts.portfolioId && String(tx.portfolioId || 'default') !== String(opts.portfolioId)) return;
      var a = parseFloat(tx.amount);
      if (!(isFinite(a) && a > 0)) { bad.push({ kind: 'cash-amount', severity: 'warning', txId: tx.id != null ? tx.id : null, type: tx.type, date: ymd(tx.date) }); return; }
      var def = CASH_TYPES[tx.type];
      var eur = toEUR(a, tx, rate, fxAt, ctx);
      var y = ymd(tx.date).slice(0, 4);
      rows.push({ id: tx.id, type: tx.type, date: ymd(tx.date), portfolioId: tx.portfolioId || 'default', amountEUR: eur, signedEUR: def.sign * eur,
        flow: def.flow, transferId: tx.transferId || null, counterPortfolioId: tx.counterPortfolioId || null, symbol: tx.symbol || '' });
      byType[tx.type] = (byType[tx.type] || 0) + eur;
      if (y) { var yy = byYear[y] || (byYear[y] = {}); yy[tx.type] = (yy[tx.type] || 0) + eur; }
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return { rows: rows, byType: byType, byYear: byYear, issues: bad.concat(issues([], ctx.currencyIssues, [])) };
  }

  // ---- P5-1.4: clearing account (Verrechnungskonto) per portfolio -----------
  // clearingBalance(transactions, portfolioId, { opening, openingDate,
  //   exchangeRate, fxAt, usdRates })
  //   → { balanceEUR, series: [{ d, balance }] (end of day, oldest first),
  //       external: [{ d, amount }] (+ into the account: opening, deposit,
  //                  transfer in; − withdrawal, transfer out),
  //       events: [{ d, amount, kind: 'external'|'trade'|'income'|'cost', type, txId,
  //                  key?, cost? (fees + withholding inside the amount) }],
  //       firstNegative: { d, balance } | null, minBalance }
  // The account is in EUR; other currencies convert at the rate of their date
  // (the same rule as the ledger). Buy −(gross + fees), sell +(gross − fees),
  // dividend / interest +(gross − withholding − fees), cash bookings by their
  // sign. Interest of a Net-Worth account (source 'interest-accrual' or
  // category 'cash') and options are not part of it.
  function payoutGross(tx) {
    var g = num(tx.quantity) * num(tx.price);
    return g || num(tx.amount);
  }
  function clearingBalance(transactions, portfolioId, opts) {
    opts = opts || {};
    var rate = num(opts.exchangeRate);
    var fxAt = typeof opts.fxAt === 'function' ? opts.fxAt : null;
    var ctx = { usdRates: opts.usdRates, currencyIssues: [], seen: {} };
    var pid = String(portfolioId || 'default');
    var events = [];
    (transactions || []).forEach(function (tx) {
      if (!tx || String(tx.portfolioId || 'default') !== pid || !ymd(tx.date)) return;
      if (tx.category === 'options' || tx.category === 'cash' || tx.source === 'interest-accrual') return;
      var d = ymd(tx.date), eur = function (a) { return toEUR(a, tx, rate, fxAt, ctx); };
      if (isCash(tx)) {
        var a = parseFloat(tx.amount);
        if (!(isFinite(a) && a > 0)) return;
        var def = CASH_TYPES[tx.type];
        events.push({ d: d, amount: def.sign * eur(a), kind: def.flow ? (def.sign > 0 ? 'income' : 'cost') : 'external', type: tx.type, txId: tx.id });
        return;
      }
      var q = num(tx.quantity), fees = Math.max(0, num(tx.fees));
      // key: the holding a trade or payout belongs to (value-path.js keeps the
      // cash of holdings without price history out of the return)
      var key = keyOf(tx);
      // cost: the fees and withholding tax inside the amount (P5-2.5 gross returns)
      // P5-3.9: accrued interest of a bond trade is paid on a buy, received on a sale
      var acc = tx.category === 'bonds' ? Math.max(0, num(tx.accruedInterest)) : 0;
      if (tx.type === 'buy' && q > 0) events.push({ d: d, amount: -eur(q * num(tx.price) + fees + acc), kind: 'trade', type: 'buy', txId: tx.id, key: key, cost: eur(fees) });
      else if (tx.type === 'sell' && q > 0) events.push({ d: d, amount: eur(q * num(tx.price) - fees + acc), kind: 'trade', type: 'sell', txId: tx.id, key: key, cost: eur(fees) });
      else if (tx.type === 'dividend' || tx.type === 'interest') {
        var wht = Math.max(0, num(tx.withholdingTax));
        var net = payoutGross(tx) - wht - fees;
        if (net) events.push({ d: d, amount: eur(net), kind: 'income', type: tx.type, txId: tx.id, key: key, cost: eur(wht + fees) });
      }
    });
    var opening = num(opts.opening);
    if (opening) {
      var first = events.reduce(function (m, e) { return !m || e.d < m ? e.d : m; }, '');
      events.push({ d: ymd(opts.openingDate) || first || ymd(new Date()), amount: opening, kind: 'external', type: 'opening', txId: null });
    }
    events.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    var byDay = {}, days = [];
    events.forEach(function (e) { if (!(e.d in byDay)) { byDay[e.d] = 0; days.push(e.d); } byDay[e.d] += e.amount; });
    var bal = 0, series = [], firstNegative = null, minBalance = 0;
    days.forEach(function (d) {
      bal += byDay[d];
      if (Math.abs(bal) < 1e-9) bal = 0;
      series.push({ d: d, balance: bal });
      if (bal < -0.005 && !firstNegative) firstNegative = { d: d, balance: bal };
      if (bal < minBalance) minBalance = bal;
    });
    var external = {};
    events.forEach(function (e) { if (e.kind === 'external') external[e.d] = (external[e.d] || 0) + e.amount; });
    return {
      balanceEUR: bal, series: series, events: events, firstNegative: firstNegative, minBalance: minBalance,
      external: Object.keys(external).sort().map(function (d) { return { d: d, amount: external[d] }; }),
      issues: issues([], ctx.currencyIssues, [])
    };
  }
  // Deposits that keep a clearing account at or above zero: one per day the
  // end-of-day balance would drop below zero, rounded up to the cent.
  function missingDeposits(clearing) {
    var out = [], added = 0;
    ((clearing && clearing.series) || []).forEach(function (p) {
      var b = p.balance + added;
      if (b < -0.005) {
        var amt = Math.ceil(-b * 100 - 1e-6) / 100;
        out.push({ d: p.d, amount: amt });
        added += amt;
      }
    });
    return out;
  }

  // P5-1.5: several clearing accounts as one (the "All portfolios" view): all
  // events, external flows summed per day (a transfer between two of them
  // cancels out), balances added.
  function mergeClearings(list) {
    var events = [], ext = {}, bal = 0;
    (list || []).forEach(function (c) {
      if (!c) return;
      bal += c.balanceEUR || 0;
      events = events.concat(c.events || []);
      (c.external || []).forEach(function (e) { ext[e.d] = (ext[e.d] || 0) + e.amount; });
    });
    events.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    return {
      balanceEUR: bal, events: events,
      external: Object.keys(ext).sort().filter(function (d) { return Math.abs(ext[d]) > 1e-9; }).map(function (d) { return { d: d, amount: ext[d] }; })
    };
  }

  // The clearing accounts of a view over `portfolioIds` (one portfolio, or all
  // of them for "All portfolios"). clearings: the ones that exist, for XIRR
  // (MaerminReturnFigures). merged: the one account the value path (TWR)
  // uses - only when EVERY portfolio of the view keeps one; otherwise the cash
  // of some would count and the money behind the others' purchases would not.
  function viewClearing(clearingByPf, portfolioIds) {
    var all = clearingByPf || {}, ids = (portfolioIds || []).map(String), clearings = {};
    ids.forEach(function (id) { if (all[id]) clearings[id] = all[id]; });
    var n = Object.keys(clearings).length;
    var merged = (!ids.length || n !== ids.length) ? null
      : ids.length === 1 ? all[ids[0]] : mergeClearings(ids.map(function (id) { return all[id]; }));
    return { clearings: n ? clearings : null, merged: merged };
  }

  var api = {
    viewClearing: viewClearing,
    mergeClearings: mergeClearings,
    clearingBalance: clearingBalance,
    missingDeposits: missingDeposits,
    CASH_TYPES: CASH_TYPES,
    isCash: isCash,
    isTransfer: isTransfer,
    validateCash: validateCash,
    transferPair: transferPair,
    pairOf: pairOf,
    cashFlows: cashFlows,
    build: build,
    depotsOf: depotsOf,
    closedPositions: closedPositions,
    group: group,
    keyOf: keyOf,
    oneYearAnniversary: oneYearAnniversary,
    heldOverOneYear: heldOverOneYear
  };
  if (typeof window !== 'undefined') window.MaerminLedger = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
