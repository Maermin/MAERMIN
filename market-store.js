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

  // Pure: the most recent positive price per history key. priceHistory is
  // persisted ({ key: [{timestamp, price}, ...] }), so this is what the app
  // knew at the end of the last session - the "last known" price shown (and
  // badged stale by the data-quality layer) until a fresh quote arrives.
  function lastKnownPrices(priceHistory) {
    var out = {};
    Object.keys(priceHistory || {}).forEach(function (key) {
      var series = priceHistory[key];
      if (!Array.isArray(series)) return;
      for (var i = series.length - 1; i >= 0; i--) {
        var pt = series[i];
        var px = (pt && typeof pt === 'object') ? pt.price : pt;
        if (typeof px === 'number' && isFinite(px) && px > 0) { out[key] = px; break; }
      }
    });
    return out;
  }

  function lookup(prices, sym) {
    var v = prices[sym];
    if (!(v > 0)) v = prices[sym.toLowerCase()];
    if (!(v > 0)) v = prices[sym.toUpperCase()];
    return v > 0 ? v : 0;
  }

  // Pure: the price map every VIEW reads. Order per held position: a quote
  // fetched this session, else the last known price, else its EUR cost basis.
  // The cost fallback keeps a never-priced position at "0% / worth what was
  // paid" instead of "-100% / worth nothing"; such symbols are returned in
  // `costKeys` so the UI can label them "no price". Never feed this map back
  // into price history, alerts or bookings - those take the fetched map.
  function effectivePrices(fetched, priceHistory, portfolio) {
    var prices = Object.assign({}, lastKnownPrices(priceHistory), fetched || {});
    var costKeys = {};
    Object.keys(portfolio || {}).forEach(function (cls) {
      var list = Array.isArray(portfolio[cls]) ? portfolio[cls] : [];
      list.forEach(function (pos) {
        var sym = String((pos && (pos.symbol || pos.name)) || '');
        if (!sym || lookup(prices, sym) > 0) return;
        var cost = parseFloat(pos.purchasePrice);
        if (!(cost > 0)) return;
        prices[sym] = cost; prices[sym.toLowerCase()] = cost; prices[sym.toUpperCase()] = cost;
        costKeys[sym.toLowerCase()] = true;
      });
    });
    return { prices: prices, costKeys: costKeys };
  }

  // Registry of the symbols currently valued at cost (set by the renderer on
  // every recompute) so any view can ask without prop plumbing.
  var _costKeys = {};
  function setCostKeys(keys) { _costKeys = keys || {}; }
  function isCostFallback(sym) { return !!(sym && _costKeys[String(sym).toLowerCase()]); }

  // Pure: what one price refresh achieved, per held POSITION (the price map
  // stores every symbol under several keys, so counting keys overstated it
  // and a refresh that fetched nothing still read "Prices updated (84)").
  // `freshKeys` = keys written from a source in THIS run, `carriedKeys` =
  // keys filled from a last-known price. Returns { total, fetched, carried,
  // missing: [symbol], outcome: 'empty'|'all'|'partial'|'none' }.
  function refreshSummary(portfolio, freshKeys, carriedKeys) {
    function keySet(list) {
      var s = {};
      (list && typeof list.forEach === 'function' ? list : []).forEach(function (k) { s[String(k).toLowerCase()] = true; });
      return s;
    }
    var fresh = keySet(freshKeys), carried = keySet(carriedKeys);
    var total = 0, fetched = 0, carriedN = 0, missing = [];
    Object.keys(portfolio || {}).forEach(function (cls) {
      var list = Array.isArray(portfolio[cls]) ? portfolio[cls] : [];
      list.forEach(function (pos) {
        var sym = String((pos && (pos.symbol || pos.name)) || '').trim();
        if (!sym) return;
        total++;
        var k = sym.toLowerCase();
        if (fresh[k]) fetched++;
        else if (carried[k]) carriedN++;
        else missing.push(sym);
      });
    });
    var outcome = total === 0 ? 'empty' : fetched === total ? 'all' : fetched === 0 ? 'none' : 'partial';
    return { total: total, fetched: fetched, carried: carriedN, missing: missing, outcome: outcome };
  }

  // Automatic refreshes (timer, focus, online) run quietly (FINDINGS M-11): no
  // success toast, and a problem is reported once - again only when it
  // changes. A refresh the user started always reports. `key` names the
  // outcome ('ok', 'none:3', 'partial:1', 'cs2-worker', 'error'); lastKey is
  // the key of the last automatic notice. Returns { key, show }.
  function refreshNotice(key, opts) {
    opts = opts || {};
    if (!opts.silent) return { key: key, show: true };
    if (key === 'ok') return { key: key, show: false };
    return { key: key, show: key !== opts.lastKey };
  }
  function summaryKey(sum) {
    if (!sum || sum.outcome === 'all' || sum.outcome === 'empty') return 'ok';
    return sum.outcome + ':' + (sum.total - sum.fetched);
  }

  var api = {
    store: store,
    getState: getState, get: get, set: set, subscribe: subscribe,
    mergePrices: mergePrices, refreshSummary: refreshSummary, refreshNotice: refreshNotice, summaryKey: summaryKey,
    lastKnownPrices: lastKnownPrices, effectivePrices: effectivePrices,
    setCostKeys: setCostKeys, isCostFallback: isCostFallback
  };
  if (typeof window !== 'undefined') window.MaerminMarket = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
