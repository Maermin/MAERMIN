// ============================================================================
// MAERMIN — CS2 skin prices & images  (window.MaerminSkinPrices)
// ----------------------------------------------------------------------------
// Prices: CSGO Trader's daily Steam Market price file, through the Worker
// (`?action=skinprices`) - one request prices every CS2 item. Steam and
// Skinport block or throttle Cloudflare Workers, so neither is asked directly.
//   { "<market_hash_name>": { last_24h, last_7d, last_30d, last_90d }, ... } USD
// Price of an item: the 24 h average, else 7 d, 30 d, 90 d. The four averages
// also give the chart a coarse history (history()).
//
// Images: data/skin-images.json, a compact name -> Steam CDN image map built
// from ByMykel's CSGO-API by scripts/build-skin-images.mjs (weapons, knives,
// gloves, cases, agents, music kits, patches, graffiti, charms, collectibles).
// Loaded only when the skin picker needs it.
//
// The price file (~34k items) is parsed here, not in the Worker (CPU budget),
// and kept in memory for an hour. Pure + Node-testable (test/skin-prices.test.js).
// ============================================================================
(function () {
  'use strict';

  var FRESH_MS = 60 * 60 * 1000;
  var IMAGE_BASE = 'https://community.akamai.steamstatic.com/economy/image/';
  var IMAGES_URL = 'data/skin-images.json';
  var PERIODS = [['last_90d', 90], ['last_30d', 30], ['last_7d', 7], ['last_24h', 1]];

  var memo = null;      // { base, at, index }
  var pending = null;   // in-flight price load (deduped)
  var images = null;    // Promise<map|null>

  function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

  // Price file -> { list: [{ name, price, avg }], byName, byLower }.
  function buildIndex(file) {
    var list = [], byName = {}, byLower = {};
    var src = (file && typeof file === 'object' && !Array.isArray(file)) ? file : {};
    Object.keys(src).forEach(function (name) {
      var r = src[name] || {};
      var price = num(r.last_24h) || num(r.last_7d) || num(r.last_30d) || num(r.last_90d);
      if (!price) return;
      var e = { name: name, price: price, avg: { d1: num(r.last_24h), d7: num(r.last_7d), d30: num(r.last_30d), d90: num(r.last_90d) } };
      list.push(e);
      byName[name] = e;
      byLower[name.toLowerCase()] = e;
    });
    return { list: list, byName: byName, byLower: byLower };
  }

  function tickers() {
    if (typeof window !== 'undefined' && window.MaerminTickers) return window.MaerminTickers;
    try { return typeof require === 'function' ? require('./ticker-validation.js') : null; } catch (e) { return null; }
  }

  // Entry for a stored name: exact, else ignoring case, spacing and an
  // upper-cased import (normalizeSkinName).
  function entryFor(index, name) {
    if (!index || !name) return null;
    var s = String(name).trim();
    var e = index.byName[s] || index.byLower[s.toLowerCase()];
    if (!e) {
      var T = tickers();
      if (T && T.normalizeSkinName) { var n = T.normalizeSkinName(s); e = index.byName[n] || index.byLower[n.toLowerCase()]; }
    }
    return e || null;
  }
  /** USD price for a stored name (0 when the item is not in the file). */
  function priceFor(index, name) { var e = entryFor(index, name); return e ? e.price : 0; }

  // Coarse history from the four averages: [{ ts, date, price }] (USD),
  // oldest first, ending today at the current price. [] when unknown.
  function history(index, name, nowMs) {
    var e = entryFor(index, name);
    if (!e) return [];
    var now = nowMs || Date.now();
    var out = [];
    PERIODS.forEach(function (p) {
      var v = e.avg[{ last_90d: 'd90', last_30d: 'd30', last_7d: 'd7', last_24h: 'd1' }[p[0]]];
      if (!v) return;
      var ts = Math.floor((now - p[1] * 86400000) / 1000);
      out.push({ ts: ts, date: new Date(ts * 1000).toISOString().slice(0, 10), price: v });
    });
    var tsNow = Math.floor(now / 1000);
    out.push({ ts: tsNow, date: new Date(now).toISOString().slice(0, 10), price: e.price });
    return out;
  }

  // Name search for the skin picker: every query word must occur; shorter
  // (closer) names first. -> [{ name, price, image: null }]
  function search(index, query, limit) {
    if (!index) return [];
    var words = String(query || '').toLowerCase().split(/[\s|]+/).filter(Boolean);
    if (!words.length) return [];
    var out = [];
    for (var i = 0; i < index.list.length; i++) {
      var e = index.list[i], lower = e.name.toLowerCase(), all = true;
      for (var w = 0; w < words.length; w++) { if (lower.indexOf(words[w]) === -1) { all = false; break; } }
      if (all) out.push(e);
    }
    out.sort(function (a, b) { return a.name.length - b.name.length || (a.name < b.name ? -1 : 1); });
    return out.slice(0, limit || 24).map(function (e) { return { name: e.name, price: e.price, image: null }; });
  }

  // Load (or reuse) the price file through the Worker. Resolves to the index,
  // or null (no Worker, an older Worker without the route, a failure) - the
  // caller keeps the last-known prices.
  function load(workerBase, opts) {
    opts = opts || {};
    var base = String(workerBase || '').trim().replace(/\/$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    var now = opts.now || Date.now();
    if (!base || base.length < 12 || !fetchFn) return Promise.resolve(null);
    if (!opts.force && memo && memo.base === base && now - memo.at < FRESH_MS) return Promise.resolve(memo.index);
    if (pending && pending.base === base) return pending.promise;
    var p = Promise.resolve(fetchFn(base + '?action=skinprices'))
      .then(function (r) { if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 0)); return r.json(); })
      .then(function (file) {
        if (!file || typeof file !== 'object' || Array.isArray(file) || file.error) throw new Error((file && file.error) || 'not a price file');
        var index = buildIndex(file);
        if (!index.list.length) throw new Error('empty price file');
        memo = { base: base, at: now, index: index };
        return index;
      })
      .catch(function () { return (memo && memo.base === base) ? memo.index : null; })
      .then(function (v) { pending = null; return v; });
    pending = { base: base, promise: p };
    return p;
  }

  // ---- images ----------------------------------------------------------------
  // Image key: the item without wear and without the StatTrak™/Souvenir prefix
  // (all variants of a skin share one picture); "★" stays.
  function imageKey(name) {
    return String(name || '').replace(/\s*\((Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)\s*$/i, '')
      .replace(/(^|★ )(StatTrak™|Souvenir) /, '$1').trim();
  }
  /** Image URL for a name from a loaded image map, or null. */
  function imageFor(map, name) {
    if (!map || !name) return null;
    var hash = map[name] || map[imageKey(name)];
    return hash ? IMAGE_BASE + hash + '/330x192' : null;
  }
  /** Load data/skin-images.json once (lazy). -> Promise<map|null> */
  function loadImages(opts) {
    opts = opts || {};
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) return Promise.resolve(null);
    if (!images || opts.force) {
      images = Promise.resolve(fetchFn(opts.url || IMAGES_URL))
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (m) { if (!m) images = null; return m; });
    }
    return images;
  }

  function reset() { memo = null; pending = null; images = null; }

  var api = { FRESH_MS: FRESH_MS, buildIndex: buildIndex, priceFor: priceFor, history: history, search: search,
    load: load, imageKey: imageKey, imageFor: imageFor, loadImages: loadImages, reset: reset };
  if (typeof window !== 'undefined') window.MaerminSkinPrices = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
