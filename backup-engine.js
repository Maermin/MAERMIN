/**
 * MAERMIN - Backup Engine
 * ------------------------------------------------------------------
 * Single source of truth for the full-vault JSON backup: which
 * localStorage keys count as user data, how a backup file is built
 * (snapshot) and how it is restored. Kept as a standalone, pure module
 * so the round-trip can be unit-tested headlessly (test/backup.test.js)
 * without React or a browser.
 *
 * The backup stores each key's RAW localStorage string, so a restore
 * reproduces exactly what was entered — including positions that have no
 * price / fees / optional fields set. Nothing is parsed or coerced, so
 * a price-less item round-trips losslessly.
 *
 * Exposes window.MaerminBackup. 'apiKeys' is intentionally NOT included:
 * the backup file is plain, unencrypted JSON and must not carry secrets.
 */
(function () {
  'use strict';

  var FORMAT = 'maermin-full';
  var VERSION = '10.0.0';

  // Every localStorage key that holds user-entered data. UI-only flags
  // (onboarding, last view, debug, recovery nudge) are NOT data and are
  // excluded, as is 'apiKeys' (secret → never written to a plain-text file).
  var KEYS = [
    'transactions',
    'priceHistory',
    'maermin_portfolios',
    'maermin_active_portfolio',
    'maermin_watchlist',
    'maermin_alerts',
    'maermin_divevents',
    'maermin_targets',
    'maermin_notes',
    'maermin_journal',
    'maermin_savings_plans',
    'maermin_networth_accounts',
    'investmentGoals',
    'maermin_fire_settings',
    'maermin_tax_owner',
    'taxJurisdiction',
    // v10 feature stores (see portfolio-snapshots.js / tags.js / dashboard-layout.js)
    'maermin_snapshots',
    'maermin_tags',
    'maermin_dashboard_layout',
    'theme',
    'currency',
    'privacyMode'
  ];

  function defaultStore() {
    return (typeof localStorage !== 'undefined') ? localStorage : null;
  }

  // Build a backup object from a Storage-like source. `opts.overlay` lets the
  // caller inject already-current values (e.g. live React state that can be a
  // tick ahead of localStorage), keyed by storage key → raw JSON string.
  function snapshot(opts) {
    opts = opts || {};
    var src = opts.storage || defaultStore();
    var overlay = opts.overlay || {};
    var store = {};
    KEYS.forEach(function (key) {
      // An explicit overlay value always wins (even '' / 'null' strings).
      if (Object.prototype.hasOwnProperty.call(overlay, key)) {
        if (typeof overlay[key] === 'string') store[key] = overlay[key];
        return;
      }
      if (!src) return;
      try {
        var raw = src.getItem(key);
        if (raw !== null && raw !== undefined) store[key] = raw;
      } catch (e) { /* skip an unreadable key, keep backing up the rest */ }
    });
    return {
      format: FORMAT,
      version: VERSION,
      timestamp: new Date().toISOString(),
      store: store
    };
  }

  function isFullBackup(obj) {
    return !!(obj && typeof obj === 'object' && obj.store && typeof obj.store === 'object');
  }

  // Restore a backup object into a Storage-like target. Only whitelisted keys
  // are written and values must be strings, so a tampered/foreign file cannot
  // inject arbitrary keys. Keys absent from the backup are left untouched (so a
  // restore never wipes e.g. the user's apiKeys). Returns the count restored;
  // throws on a malformed backup so the caller can surface an error.
  function restore(backup, opts) {
    if (!isFullBackup(backup)) throw new Error('bad-backup: missing store');
    opts = opts || {};
    var dst = opts.storage || defaultStore();
    if (!dst) throw new Error('bad-backup: no storage target');
    var restored = 0;
    Object.keys(backup.store).forEach(function (key) {
      if (KEYS.indexOf(key) === -1) return; // ignore unknown / legacy keys
      var val = backup.store[key];
      if (typeof val !== 'string') return;
      try { dst.setItem(key, val); restored++; } catch (e) { /* keep going */ }
    });
    return restored;
  }

  var api = {
    FORMAT: FORMAT,
    VERSION: VERSION,
    KEYS: KEYS,
    snapshot: snapshot,
    isFullBackup: isFullBackup,
    restore: restore
  };

  if (typeof window !== 'undefined') window.MaerminBackup = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
