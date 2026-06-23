// ============================================================================
// MAERMIN — IndexedDB key/value store  (window.MaerminIDB)
// ----------------------------------------------------------------------------
// A tiny Promise-based single-store IndexedDB wrapper. Its first job is to hold
// the ONE thing that grows without bound — the encrypted vault data blob — so a
// large portfolio (10k+ transactions) is no longer capped by localStorage's
// ~5 MB ceiling. storage.js routes the blob here when available and falls back
// to localStorage otherwise (Node / private-mode / disabled IDB), so behaviour
// is unchanged when IndexedDB is missing.
//
// One database `maermin`, one object store `kv`. Values are opaque strings
// (already-encrypted blobs). No app data is interpreted here.
// ============================================================================
(function () {
  'use strict';

  var DB = 'maermin', STORE = 'kv', VERSION = 1;
  var _db = null;

  function idb() { return (typeof indexedDB !== 'undefined') ? indexedDB : null; }
  function isSupported() { return !!idb(); }

  function openDb() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req;
      try { req = idb().open(DB, VERSION); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error || new Error('idb-open-failed')); };
    });
  }

  // Run one transaction. `fn(store)` may return a request (for reads); its
  // result is resolved once the transaction completes.
  function run(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var out;
        var r = fn(store);
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error || new Error('idb-tx-failed')); };
        t.onabort = function () { reject(t.error || new Error('idb-tx-abort')); };
      });
    });
  }

  function get(key) { return run('readonly', function (s) { return s.get(key); }).then(function (v) { return v == null ? null : v; }); }
  function set(key, value) { return run('readwrite', function (s) { s.put(value, key); return null; }); }
  function del(key) { return run('readwrite', function (s) { s.delete(key); return null; }); }

  var api = { isSupported: isSupported, get: get, set: set, del: del, DB: DB, STORE: STORE };
  if (typeof window !== 'undefined') window.MaerminIDB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
