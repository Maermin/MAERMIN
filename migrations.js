// ============================================================================
// MAERMIN — Storage Schema Migrations  (window.MaerminMigrations)
// ----------------------------------------------------------------------------
// localStorage is the database. Without a versioned migration step, structural
// changes silently break old saved data. This runs an ordered, idempotent set
// of migrations once per load (AFTER the vault is unlocked, so encrypted data is
// readable through the storage shim) and records the schema version in
// localStorage['maermin_schema_version'].
//
// Rules: each migration is SAFE (never deletes user data), wrapped in try/catch,
// and only bumps the version when it succeeds — so a failure simply retries next
// load instead of corrupting state. Pure-ish + unit-tested (test/migrations.test.js).
// ============================================================================
(function () {
  'use strict';

  var VERSION_KEY = 'maermin_schema_version';

  function readJSON(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function writeJSON(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  // ---- migrations (ordered; `v` must be strictly increasing) ----------------
  var MIGRATIONS = [
    {
      v: 1,
      name: 'transactions: ensure id + category',
      up: function () {
        var txs = readJSON('transactions', []);
        if (!Array.isArray(txs) || txs.length === 0) return;
        var changed = false;
        var seen = {};
        txs.forEach(function (tx, i) {
          if (!tx || typeof tx !== 'object') return;
          if (tx.id === undefined || tx.id === null || tx.id === '' || seen[tx.id]) {
            tx.id = (Date.now() + i).toString() + '-' + i; changed = true;
          }
          seen[tx.id] = true;
          if (!tx.category) { tx.category = 'crypto'; changed = true; }
        });
        if (changed) writeJSON('transactions', txs);
      }
    },
    {
      v: 2,
      name: 'priceHistory: cap each symbol to 100 points',
      up: function () {
        var hist = readJSON('priceHistory', null);
        if (!hist || typeof hist !== 'object') return;
        var changed = false;
        Object.keys(hist).forEach(function (sym) {
          var arr = hist[sym];
          if (Array.isArray(arr) && arr.length > 100) { hist[sym] = arr.slice(-100); changed = true; }
        });
        if (changed) writeJSON('priceHistory', hist);
      }
    },
    {
      v: 3,
      name: 'savings plans: normalise endDate/active for the auto-execution model',
      up: function () {
        var plans = readJSON('maermin_savings_plans', null);
        if (!Array.isArray(plans) || plans.length === 0) return;
        var changed = false;
        plans.forEach(function (p) {
          if (!p || typeof p !== 'object') return;
          if (p.endDate === undefined) { p.endDate = null; changed = true; }
          if (p.active === undefined) { p.active = true; changed = true; }
          if (typeof p.amount === 'string') { var n = parseFloat(p.amount); if (isFinite(n)) { p.amount = n; changed = true; } }
        });
        if (changed) writeJSON('maermin_savings_plans', plans);
      }
    }
    ,
    {
      v: 4,
      name: 'priceHistory: repair year-less live timestamps to ISO-8601',
      up: function () {
        var hist = readJSON('priceHistory', null);
        if (!hist || typeof hist !== 'object') return;
        var res = repairPriceTimestamps(hist, new Date());
        if (res.changed) writeJSON('priceHistory', res.history);
      }
    }
  ];

  // Older builds stamped live price points with
  // toLocaleString('en-US', {day, month, hour, minute}) -> "09/30, 08:14 PM":
  // no year, 12-hour clock. Points are appended chronologically, so the year
  // can be recovered by walking each series backwards from `now` and stepping
  // back one year whenever the month/day/time jumps forward. Points that match
  // neither ISO nor that pattern are dropped (they could never be dated).
  var LEGACY_TS = /^(\d{1,2})\/(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*([AP]M)$/i;
  function repairPriceTimestamps(history, now) {
    now = now || new Date();
    var out = {}, changed = false;
    Object.keys(history || {}).forEach(function (sym) {
      var arr = Array.isArray(history[sym]) ? history[sym] : [];
      var year = now.getFullYear();
      var nextKey = null; // month/day/time key of the following (newer) point
      var fixed = [];
      for (var i = arr.length - 1; i >= 0; i--) {
        var pt = arr[i];
        if (!pt || typeof pt !== 'object') { changed = true; continue; }
        var ts = pt.timestamp;
        if (typeof ts === 'number' || /^\d{4}-\d{2}-\d{2}/.test(String(ts))) { fixed.push(pt); continue; }
        var m = LEGACY_TS.exec(String(ts || '').trim());
        if (!m) { changed = true; continue; }
        var mo = parseInt(m[1], 10), d = parseInt(m[2], 10), h = parseInt(m[3], 10) % 12, mi = parseInt(m[4], 10);
        if (/pm/i.test(m[5])) h += 12;
        var key = ((mo * 100 + d) * 100 + h) * 100 + mi;
        if (nextKey == null) {
          var nowKey = (((now.getMonth() + 1) * 100 + now.getDate()) * 100 + now.getHours()) * 100 + now.getMinutes();
          if (key > nowKey) year -= 1;
        } else if (key > nextKey) {
          year -= 1;
        }
        nextKey = key;
        var iso = new Date(year, mo - 1, d, h, mi).toISOString();
        fixed.push(Object.assign({}, pt, { timestamp: iso }));
        changed = true;
      }
      out[sym] = fixed.reverse();
    });
    return { history: out, changed: changed };
  }

  var LATEST = MIGRATIONS.reduce(function (m, x) { return Math.max(m, x.v); }, 0);

  function getVersion() {
    var raw = null;
    try { raw = localStorage.getItem(VERSION_KEY); } catch (e) {}
    var n = parseInt(raw, 10);
    return isNaN(n) ? 0 : n;
  }
  function setVersion(n) { try { localStorage.setItem(VERSION_KEY, String(n)); } catch (e) {} }

  // Apply every pending migration in order. Stops (without bumping) on the first
  // failure so the next load retries from the same point. Returns the new version.
  function run() {
    var current = getVersion();
    for (var i = 0; i < MIGRATIONS.length; i++) {
      var mig = MIGRATIONS[i];
      if (mig.v <= current) continue;
      try {
        mig.up();
        current = mig.v;
        setVersion(current);
      } catch (e) {
        if (typeof console !== 'undefined') console.error('[migrations] failed at v' + mig.v + ' (' + mig.name + '):', e);
        break; // retry next load
      }
    }
    return current;
  }

  var api = {
    VERSION_KEY: VERSION_KEY,
    LATEST: LATEST,
    MIGRATIONS: MIGRATIONS,
    repairPriceTimestamps: repairPriceTimestamps,
    getVersion: getVersion,
    setVersion: setVersion,
    run: run
  };
  if (typeof window !== 'undefined') window.MaerminMigrations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
