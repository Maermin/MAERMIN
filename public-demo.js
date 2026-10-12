// ============================================================================
// MAERMIN — Public demo link  (window.MaerminPublicDemo)
// ----------------------------------------------------------------------------
// P5-1.9. `index.html?demo` (e.g. https://maermin.github.io/MAERMIN/?demo)
// opens straight into demo mode: no vault, no password, no setup.
//
// Loaded FIRST, before anything touches storage. With `?demo` in the URL it
// swaps window.localStorage and window.sessionStorage for in-memory stores and
// hides IndexedDB, so this tab never reads or writes the visitor's real
// storage - an existing vault, its data and settings stay exactly as they are,
// and everything done in the demo is gone on reload. auth.js then lets the
// app mount without a vault; "Exit demo" goes to the normal app URL.
//
// Pure helpers are Node-tested (test/public-demo.test.js).
// ============================================================================
(function () {
  'use strict';

  // `?demo`, `?demo=1`, `?demo=true` (any other value of `demo` = off).
  function isDemoQuery(search) {
    var q = String(search || '').replace(/^\?/, '');
    if (!q) return false;
    return q.split('&').some(function (kv) {
      var p = kv.split('=');
      if (decodeURIComponent(p[0]) !== 'demo') return false;
      var v = p.length > 1 ? decodeURIComponent(p.slice(1).join('=')).toLowerCase() : '';
      return v === '' || v === '1' || v === 'true';
    });
  }

  // A Storage-like object kept in memory (getItem/setItem/removeItem/clear/key/length).
  function memStorage(seed) {
    var m = Object.create(null);
    var api = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[String(k)] = String(v); },
      removeItem: function (k) { delete m[String(k)]; },
      clear: function () { Object.keys(m).forEach(function (k) { delete m[k]; }); },
      key: function (i) { var ks = Object.keys(m); return i >= 0 && i < ks.length ? ks[i] : null; }
    };
    Object.defineProperty(api, 'length', { get: function () { return Object.keys(m).length; } });
    Object.keys(seed || {}).forEach(function (k) { api.setItem(k, seed[k]); });
    return api;
  }

  // What the demo tab starts with: demo on, onboarding done.
  var SEED = { maermin_demo: '1', maermin_onboarded: '1' };

  // The normal app URL (the same page without the demo parameter).
  function exitUrl(loc) {
    var q = String(loc.search || '').replace(/^\?/, '').split('&').filter(function (kv) { return kv && decodeURIComponent(kv.split('=')[0]) !== 'demo'; });
    return loc.pathname + (q.length ? '?' + q.join('&') : '') + (loc.hash || '');
  }

  // Switch this tab to in-memory storage. Returns true when it took effect.
  function activate(win) {
    try {
      var local = memStorage(SEED), session = memStorage();
      Object.defineProperty(win, 'localStorage', { configurable: true, enumerable: true, get: function () { return local; } });
      Object.defineProperty(win, 'sessionStorage', { configurable: true, enumerable: true, get: function () { return session; } });
      Object.defineProperty(win, 'indexedDB', { configurable: true, enumerable: true, get: function () { return undefined; } });
      return win.localStorage === local && win.localStorage.getItem('maermin_demo') === '1';
    } catch (e) { return false; }
  }

  var api = { active: false, isDemoQuery: isDemoQuery, memStorage: memStorage, exitUrl: exitUrl, activate: activate, SEED: SEED };
  if (typeof window !== 'undefined') {
    // Fail closed: if the swap does not take, stay a normal page (vault gate).
    if (window.location && isDemoQuery(window.location.search)) api.active = activate(window);
    window.MaerminPublicDemo = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
