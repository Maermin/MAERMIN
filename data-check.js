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
//
// The codes are part of the UI contract: never renumber or reuse one.
//
//   classify(issue, { hasWorker, hasHistory(cur) }) → { code, action }
//   misfiled(found)                                → { code, action } | null
//   actionLabel(action)                            → button text
// action = { type: 'show-transactions'|'edit-transaction'|'refresh'|
//            'open-api-settings'|'move-skins', symbol?, txId?, changesData }
//
// Pure + dual-exported; tested in test/data-check.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var CODES = {
    oversold: 'DQ-OVERSOLD', quantity: 'DQ-QUANTITY', fxUnknown: 'DQ-FX-UNKNOWN', fxUsdNearest: 'DQ-FX-USD-NEAREST',
    fxNoDayRate: 'DQ-FX-NO-DAY-RATE', fxTodayOnly: 'DQ-FX-TODAY-ONLY', skinMisfiled: 'DQ-SKIN-MISFILED'
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

  function actionLabel(action) {
    switch (action && action.type) {
      case 'show-transactions': return __('dcShowTx', 'Show transactions');
      case 'edit-transaction': return __('dcEditTx', 'Edit transaction');
      case 'refresh': return __('dcRefresh', 'Load rates now');
      case 'open-api-settings': return __('dcApiSettings', 'Add a Worker');
      case 'move-skins': return __('skinMoveBtn', 'Move to CS2 Skins');
      default: return '';
    }
  }

  var api = { CODES: CODES, classify: classify, misfiled: misfiled, actionLabel: actionLabel };
  if (typeof window !== 'undefined') window.MaerminDataCheck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
