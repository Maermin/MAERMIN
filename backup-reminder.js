// ============================================================================
// MAERMIN — Backup Reminder  (window.MaerminBackupReminder)
// ----------------------------------------------------------------------------
// All data lives in the browser only (localStorage / IndexedDB). A cleared
// browser, a wiped profile or a dead disk means total loss unless the user has
// exported an encrypted backup. This tiny engine tracks the last backup and
// decides — purely — when to nudge the user to make a fresh one.
//
// It stores NOTHING sensitive: only a timestamp, the transaction count at the
// last backup, and a snooze marker. Pure `evaluate(...)` is the single source of
// truth and is Node-tested; the renderer just persists state and shows a toast.
// ============================================================================
(function () {
  'use strict';

  var KEY = 'maermin_backup_reminder';
  var DAY_MS = 24 * 60 * 60 * 1000;
  var DEFAULT_INTERVAL_DAYS = 30;     // remind at most ~monthly when idle
  var NEW_TX_THRESHOLD = 10;          // …or sooner after this many new entries

  function safeParse(s, fallback) {
    try { var v = JSON.parse(s); return (v && typeof v === 'object') ? v : fallback; }
    catch (e) { return fallback; }
  }

  // Normalise a stored blob into a known shape so callers never see undefined.
  function normalize(raw) {
    var s = raw || {};
    return {
      lastBackup: typeof s.lastBackup === 'number' ? s.lastBackup : 0,
      txAtLastBackup: typeof s.txAtLastBackup === 'number' ? s.txAtLastBackup : 0,
      snoozedUntil: typeof s.snoozedUntil === 'number' ? s.snoozedUntil : 0
    };
  }

  // PURE decision. Returns { remind:boolean, reason:string }.
  //   opts.now           — epoch ms (defaults to Date.now())
  //   opts.txCount       — current number of transactions
  //   opts.intervalDays  — staleness window (default 30)
  function evaluate(state, opts) {
    opts = opts || {};
    var st = normalize(state);
    var now = typeof opts.now === 'number' ? opts.now : Date.now();
    var txCount = typeof opts.txCount === 'number' ? opts.txCount : 0;
    var intervalDays = typeof opts.intervalDays === 'number' ? opts.intervalDays : DEFAULT_INTERVAL_DAYS;

    // Nothing worth backing up yet → never nag an empty app.
    if (txCount <= 0) return { remind: false, reason: 'empty' };
    // User asked for quiet until a point in the future.
    if (now < st.snoozedUntil) return { remind: false, reason: 'snoozed' };
    // Never backed up but there IS data → remind.
    if (!st.lastBackup) return { remind: true, reason: 'never' };
    // Backup has gone stale.
    if (now - st.lastBackup >= intervalDays * DAY_MS) return { remind: true, reason: 'stale' };
    // A meaningful amount of new activity since the last backup.
    if (txCount - st.txAtLastBackup >= NEW_TX_THRESHOLD) return { remind: true, reason: 'newdata' };
    return { remind: false, reason: 'fresh' };
  }

  // PURE state transitions (caller persists the returned object).
  function markBackedUp(state, opts) {
    opts = opts || {};
    var st = normalize(state);
    st.lastBackup = typeof opts.now === 'number' ? opts.now : Date.now();
    st.txAtLastBackup = typeof opts.txCount === 'number' ? opts.txCount : st.txAtLastBackup;
    st.snoozedUntil = 0; // a fresh backup clears any snooze
    return st;
  }

  function snooze(state, opts) {
    opts = opts || {};
    var st = normalize(state);
    var now = typeof opts.now === 'number' ? opts.now : Date.now();
    var days = typeof opts.days === 'number' ? opts.days : 7;
    st.snoozedUntil = now + days * DAY_MS;
    return st;
  }

  // ---- thin localStorage bridge (browser only) -----------------------------
  function load() {
    try { return normalize(safeParse(localStorage.getItem(KEY), {})); }
    catch (e) { return normalize({}); }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(normalize(state))); } catch (e) {}
    return state;
  }
  function recordBackup(txCount) { return save(markBackedUp(load(), { txCount: txCount })); }
  function recordSnooze(days) { return save(snooze(load(), { days: days })); }
  function isDue(txCount, intervalDays) { return evaluate(load(), { txCount: txCount, intervalDays: intervalDays }).remind; }

  var api = {
    KEY: KEY,
    DEFAULT_INTERVAL_DAYS: DEFAULT_INTERVAL_DAYS,
    NEW_TX_THRESHOLD: NEW_TX_THRESHOLD,
    normalize: normalize,
    evaluate: evaluate,
    markBackedUp: markBackedUp,
    snooze: snooze,
    // browser helpers
    load: load,
    save: save,
    recordBackup: recordBackup,
    recordSnooze: recordSnooze,
    isDue: isDue
  };
  if (typeof window !== 'undefined') window.MaerminBackupReminder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
