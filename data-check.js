// ============================================================================
// MAERMIN — Data check codes and actions  (window.MaerminDataCheck)
// ----------------------------------------------------------------------------
// P4-6. Every finding of the Data check (Transactions and Tax views) gets a
// stable code - so a user, a support answer or a later release can name it -
// and one action that leads to what has to change:
//
//   DQ-OVERSOLD        more sold than bought        → show the symbol's transactions
//   DQ-QUANTITY        quantity not a positive number → edit that transaction
//   DQ-FX-UNKNOWN      currency without any rate    → edit that transaction
//   DQ-FX-USD-NEAREST  USD rate of a nearby day used → refresh rates / API settings
//   DQ-FX-NO-DAY-RATE  no rate for the trade date    → refresh rates / API settings
//   DQ-FX-TODAY-ONLY   no rate history at all        → refresh rates / API settings
//   DQ-SKIN-MISFILED   CS2 items filed as stocks/crypto → move them (changes data:
//                                                       confirmed first)
//   DQ-CRYPTO-PAIR     a crypto row holds an exchange pair ("BTCUSDT", "XXBTZEUR")
//                      as its symbol - imported before the 2026-10 fix (AUDIT
//                      BUG-013); it gets no price → show those transactions
//   DQ-CASH-NEGATIVE   a portfolio's clearing account goes below zero (P5-1.4)
//                      → book the missing deposits (changes data: confirmed first)
//   P5-3.7 (reconcile.js finds them):
//   DQ-PRICE-STALE     a held position's price is older than 3 days or missing
//                      → load prices now / add a Worker
//   DQ-TRANSFER-BROKEN a transfer whose other half is missing or different
//                      → edit that transaction
//   DQ-SYNC-STALE      a bank, depot, aggregator, exchange or wallet not synced
//                      for 30 days → open the import
//   DQ-SYNC-FAILED     the last sync of a source failed → open the import
//   DQ-RECON-DIFF      a reported balance or quantity differs from MAERMIN's
//                      → show the comparison (Reconciliation, Transactions view)
//   DQ-DIV-DUPLICATE   one dividend payout auto-booked twice (before the
//                      2026-10-24 fix) → show the symbol's transactions
//
// The codes are part of the UI contract: never renumber or reuse one.
//
//   classify(issue, { hasWorker, hasHistory(cur) }) → { code, action }
//   misfiled(found)                                → { code, action } | null
//   actionLabel(action)                            → button text
// action = { type: 'show-transactions'|'edit-transaction'|'refresh'|
//            'open-api-settings'|'move-skins'|'book-deposits'|'open-import'|
//            'open-reconcile', symbol?, txId?,
//            portfolioId?, changesData }
//
// Pure + dual-exported; tested in test/data-check.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var CODES = {
    oversold: 'DQ-OVERSOLD', quantity: 'DQ-QUANTITY', fxUnknown: 'DQ-FX-UNKNOWN', fxUsdNearest: 'DQ-FX-USD-NEAREST',
    fxNoDayRate: 'DQ-FX-NO-DAY-RATE', fxTodayOnly: 'DQ-FX-TODAY-ONLY', skinMisfiled: 'DQ-SKIN-MISFILED',
    cryptoPair: 'DQ-CRYPTO-PAIR', cashNegative: 'DQ-CASH-NEGATIVE',
    priceStale: 'DQ-PRICE-STALE', transferBroken: 'DQ-TRANSFER-BROKEN', syncStale: 'DQ-SYNC-STALE', syncFailed: 'DQ-SYNC-FAILED', reconDiff: 'DQ-RECON-DIFF',
    divDuplicate: 'DQ-DIV-DUPLICATE'
  };
  var USD_LIKE = /^(USD|USDT|USDC|BUSD|FDUSD|TUSD|USDP|DAI)$/i;

  function rates(opts) { return { type: opts && opts.hasWorker ? 'refresh' : 'open-api-settings', changesData: false }; }
  function edit(issue) {
    return issue.txId != null && issue.txId !== ''
      ? { type: 'edit-transaction', txId: issue.txId, changesData: false }
      : { type: 'show-transactions', symbol: issue.symbol || '', changesData: false };
  }

  function classify(issue, opts) {
    opts = opts || {};
    issue = issue || {};
    if (issue.kind === 'price-stale') return { code: CODES.priceStale, action: rates(opts) };
    if (issue.kind === 'transfer-broken') return { code: CODES.transferBroken, action: edit(issue) };
    if (issue.kind === 'sync-stale') return { code: CODES.syncStale, action: { type: 'open-import', changesData: false } };
    if (issue.kind === 'sync-failed') return { code: CODES.syncFailed, action: { type: 'open-import', changesData: false } };
    if (issue.kind === 'recon-diff') return { code: CODES.reconDiff, action: { type: 'open-reconcile', changesData: false } };
    if (issue.kind === 'cash-negative') return { code: CODES.cashNegative, action: { type: 'book-deposits', portfolioId: issue.portfolioId || 'default', changesData: true } };
    if (issue.kind === 'oversold') return { code: CODES.oversold, action: { type: 'show-transactions', symbol: issue.symbol || '', changesData: false } };
    if (issue.kind === 'quantity') return { code: CODES.quantity, action: edit(issue) };
    if (issue.status === 'unknown') return { code: CODES.fxUnknown, action: edit(issue) };
    if (USD_LIKE.test(String(issue.currency))) return { code: CODES.fxUsdNearest, action: rates(opts) };
    var has = typeof opts.hasHistory === 'function' && opts.hasHistory(issue.currency);
    return { code: has ? CODES.fxNoDayRate : CODES.fxTodayOnly, action: rates(opts) };
  }

  function misfiled(found) {
    if (!found || !found.length) return null;
    return { code: CODES.skinMisfiled, action: { type: 'move-skins', changesData: true } };
  }

  // Crypto rows whose symbol is an exchange pair: a base of 2-10 letters plus a
  // stablecoin/fiat quote (BTCUSDT, ETHEUR, SOL-USDC) or Kraken's legacy form.
  var PAIR_RE = /^[A-Z0-9]{2,10}[-\/_]?(USDT|USDC|BUSD|FDUSD|TUSD|EUR|USD)$/;
  var KRAKEN_RE = /^X[A-Z]{3}Z(EUR|USD|GBP|CAD|JPY|CHF)$/;
  function cryptoPairs(transactions) {
    var seen = {}, out = [];
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.category !== 'crypto') return;
      var s = String(tx.symbol || '').trim().toUpperCase();
      if (!s || seen[s] || !(PAIR_RE.test(s) || KRAKEN_RE.test(s))) return;
      seen[s] = true;
      out.push({ symbol: tx.symbol, code: CODES.cryptoPair, action: { type: 'show-transactions', symbol: tx.symbol, changesData: false } });
    });
    return out;
  }

  // DQ-DIV-DUPLICATE (audit 2026-10-24 BUG-2): before the fix, dividend
  // auto-booking could book one payout twice under two dates when the anchor
  // ex-date moved. Two auto-booked rows of one symbol and portfolio less than
  // 25 days apart are flagged (real payouts are at least ~28 days apart, so a
  // monthly payer is never flagged). The user checks and deletes; nothing is
  // removed here.
  var DIV_DUP_DAYS = 25;
  function dividendDuplicates(transactions) {
    var groups = {};
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.type !== 'dividend' || tx.source !== 'dividend-auto' || !tx.symbol) return;
      var t = Date.parse(String(tx.date || '').slice(0, 10) + 'T00:00:00Z');
      if (!isFinite(t)) return;
      var k = String(tx.symbol).toUpperCase() + '|' + (tx.portfolioId || 'default');
      (groups[k] || (groups[k] = [])).push({ tx: tx, t: t });
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var list = groups[k].sort(function (a, b) { return a.t - b.t; });
      var ids = [];
      for (var i = 1; i < list.length; i++) {
        if ((list[i].t - list[i - 1].t) / 86400000 < DIV_DUP_DAYS) {
          [list[i - 1].tx.id, list[i].tx.id].forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
        }
      }
      if (!ids.length) return;
      var first = list[0].tx;
      out.push({ symbol: first.symbol, portfolioId: first.portfolioId || 'default', txIds: ids, code: CODES.divDuplicate,
        action: { type: 'show-transactions', symbol: first.symbol, changesData: false } });
    });
    return out;
  }

  function actionLabel(action) {
    switch (action && action.type) {
      case 'show-transactions': return __('dcShowTx', 'Show transactions');
      case 'edit-transaction': return __('dcEditTx', 'Edit transaction');
      case 'refresh': return __('dcRefresh', 'Load rates now');
      case 'open-api-settings': return __('dcApiSettings', 'Add a Worker');
      case 'move-skins': return __('skinMoveBtn', 'Move to CS2 Skins');
      case 'book-deposits': return __('dcBookDeposits', 'Book the missing deposits');
      case 'open-import': return __('dcOpenImport', 'Open the import');
      case 'open-reconcile': return __('dcOpenReconcile', 'Show the comparison');
      default: return '';
    }
  }

  var api = { CODES: CODES, classify: classify, misfiled: misfiled, cryptoPairs: cryptoPairs, dividendDuplicates: dividendDuplicates, actionLabel: actionLabel };
  if (typeof window !== 'undefined') window.MaerminDataCheck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
