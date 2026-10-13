// ============================================================================
// MAERMIN — Shared price Worker  (window.MaerminSharedWorker)
// ----------------------------------------------------------------------------
// P5-3.1. Which Worker the app asks for MARKET DATA (prices, closes, FX,
// symbol search, fundamentals, fund holdings, earnings, news, CS2 skin prices,
// consumer prices):
//   1. the user's own Worker (API Settings) - always first;
//   2. else the shared price Worker the project runs (SHARED_URL, deployed with
//      PRICE_ONLY=1: it serves market data only and refuses every route that
//      sees user data), unless the user switched it off (prefs sharedPrices);
//   3. else none.
// USER DATA (sync, share links, MCP, broker relay, Steam inventory) only ever
// goes to the own Worker (dataBase). The shared Worker sees the symbols and
// region codes the app asks about - never amounts, quantities or the vault.
// SHARED_URL stays empty until the owner deploys the shared Worker; until
// then nothing changes. Pure, Node-tested in test/shared-worker.test.js.
// ============================================================================
(function () {
  'use strict';

  var SHARED_URL = '';
  function clean(u) { return String(u == null ? '' : u).trim().replace(/\/+$/, ''); }
  function sharedOf(opts) {
    var s = clean(opts && opts.shared !== undefined ? opts.shared : SHARED_URL);
    return /^https:\/\/[^\s/?#]+$/.test(s) ? s : '';
  }
  function marketBase(own, opts) {
    opts = opts || {};
    var o = clean(own);
    if (o.length > 5) return o;
    return opts.enabled === false ? '' : sharedOf(opts);
  }
  function dataBase(own) { var o = clean(own); return o.length > 5 ? o : ''; }
  function isShared(base, opts) { var s = sharedOf(opts || {}); return !!s && clean(base) === s; }
  function enabledFrom(pref) { return pref !== 'off'; }

  var api = { SHARED_URL: SHARED_URL, marketBase: marketBase, dataBase: dataBase, isShared: isShared, enabledFrom: enabledFrom };
  if (typeof window !== 'undefined') window.MaerminSharedWorker = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
