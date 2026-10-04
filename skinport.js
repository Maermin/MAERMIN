// ============================================================================
// MAERMIN — Skinport price list  (window.MaerminSkinport)
// ----------------------------------------------------------------------------
// CS2 skin prices come from Skinport's public item list: ONE request (through
// the Worker, `?action=skinport`) prices every CS2 item, so the app no longer
// asks Steam once per skin (Steam 429-throttles Cloudflare's IPs). Steam is
// only asked for items Skinport does not list, and still supplies the images
// in the skin picker.
//
// The list (~21k items, ~9 MB) is parsed here, not in the Worker (CPU budget),
// and kept in memory for 10 minutes. Prices are USD, like the Steam ones, so
// the existing USD -> EUR conversion applies unchanged.
//
// Price per item: Skinport's suggested price, else the median, else the
// lowest current listing.
//
// Pure + Node-testable (test/skinport.test.js); `load` takes an injectable fetch.
// ============================================================================
(function () {
  'use strict';

  var FRESH_MS = 10 * 60 * 1000;
  var memo = null;      // { base, at, list }
  var pending = null;   // in-flight load (deduped)

  function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

  // Skinport rows -> { list: [{ name, price, quantity }], byName, byLower }.
  function buildIndex(rows) {
    var list = [], byName = {}, byLower = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !r.market_hash_name) return;
      var price = num(r.suggested_price) || num(r.median_price) || num(r.min_price);
      if (!price) return;
      var e = { name: r.market_hash_name, price: price, quantity: num(r.quantity) };
      list.push(e);
      byName[e.name] = e;
      byLower[e.name.toLowerCase()] = e;
    });
    return { list: list, byName: byName, byLower: byLower };
  }

  // USD price for a stored name: exact, else ignoring case and spacing.
  function priceFor(index, name) {
    if (!index || !name) return 0;
    var s = String(name).trim();
    var e = index.byName[s] || index.byLower[s.toLowerCase()];
    if (!e) {
      var T = (typeof window !== 'undefined' && window.MaerminTickers) ||
        (typeof require === 'function' ? safeRequire('./ticker-validation.js') : null);
      if (T && T.normalizeSkinName) { var n = T.normalizeSkinName(s); e = index.byName[n] || index.byLower[n.toLowerCase()]; }
    }
    return e ? e.price : 0;
  }
  function safeRequire(p) { try { return require(p); } catch (e) { return null; } }

  // Name search for the skin picker when Steam's search is throttled: every
  // query word must occur; most-listed items first. → [{ name, price }]
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
    out.sort(function (a, b) { return b.quantity - a.quantity; });
    return out.slice(0, limit || 24).map(function (e) { return { name: e.name, price: e.price, image: null }; });
  }

  // Fetch (or reuse) the list through the Worker. Resolves to the index, or
  // null when there is no Worker / the Worker has no `skinport` route (an
  // older deployment) / the request fails - the caller then uses Steam.
  function load(workerBase, opts) {
    opts = opts || {};
    var base = String(workerBase || '').trim().replace(/\/$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    var now = opts.now || Date.now();
    if (!base || base.length < 12 || !fetchFn) return Promise.resolve(null);
    if (!opts.force && memo && memo.base === base && now - memo.at < FRESH_MS) return Promise.resolve(memo.index);
    if (pending && pending.base === base) return pending.promise;
    var p = Promise.resolve(fetchFn(base + '?action=skinport', opts.signal ? { signal: opts.signal } : undefined))
      .then(function (r) { if (!r || !r.ok) throw new Error('HTTP ' + (r ? r.status : 0)); return r.json(); })
      .then(function (rows) {
        if (!Array.isArray(rows)) throw new Error((rows && rows.error) || 'not a list');
        var index = buildIndex(rows);
        if (!index.list.length) throw new Error('empty list');
        memo = { base: base, at: now, index: index };
        return index;
      })
      .catch(function () { return (memo && memo.base === base) ? memo.index : null; })
      .then(function (v) { pending = null; return v; });
    pending = { base: base, promise: p };
    return p;
  }

  function reset() { memo = null; pending = null; }

  var api = { FRESH_MS: FRESH_MS, buildIndex: buildIndex, priceFor: priceFor, search: search, load: load, reset: reset };
  if (typeof window !== 'undefined') window.MaerminSkinport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
