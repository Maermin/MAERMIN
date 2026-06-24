// ============================================================================
// MAERMIN — Market Data Store  (window.MaerminMarket)
// ----------------------------------------------------------------------------
// The renderer's fetch/market state — prices, priceHistory, the USD→EUR rate's
// fetch status (workerStatus), loading + lastRefresh — moved off App useState
// onto MaerminStore. This is the hot data path (prices feed dozens of useMemos),
// so the migration is strictly behaviour-preserving: the renderer reads each
// slice via useStore and keeps the setX names as shims that delegate here.
//
// IMPORTANT — the shims read the CURRENT value from this store (get()) for
// functional updates, NOT a render closure, so `setPrices(prev => ...)` called
// from async fetchPrices always merges onto the latest state (matching React's
// useState updater guarantee — no stale-closure bug).
//
// Pure helpers (mergePrices) are Node-tested; the store core is MaerminStore.
// ============================================================================
(function () {
  'use strict';

  var Store = (typeof window !== 'undefined' && window.MaerminStore)
    ? window.MaerminStore
    : (function () { try { return require('./store.js'); } catch (e) { return null; } })();

  var store = Store ? Store.createStore({
    prices: {}, priceHistory: {}, workerStatus: null, loading: false, lastRefresh: null
  }) : null;

  function getState() { return store ? store.getState() : {}; }
  function get(key) { return store ? store.getState()[key] : undefined; }
  function set(key, value) { if (store) { var p = {}; p[key] = value; store.setState(p); } }
  function subscribe(fn) { return store ? store.subscribe(fn) : function () {}; }

  // Pure: merge an incoming price map over the existing one, returning a NEW
  // object (so reference-equality consumers — useMemo deps — re-run on change).
  function mergePrices(prev, incoming) { return Object.assign({}, prev || {}, incoming || {}); }

  var api = {
    store: store,
    getState: getState, get: get, set: set, subscribe: subscribe,
    mergePrices: mergePrices
  };
  if (typeof window !== 'undefined') window.MaerminMarket = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
