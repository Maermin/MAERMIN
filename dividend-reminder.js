// ============================================================================
// MAERMIN — Dividend Reminder  (window.MaerminDividendReminder)
// ----------------------------------------------------------------------------
// Surfaces UPCOMING dividend payouts so the user gets a heads-up (toast + PWA
// notification) before a pay date lands — the kind of reminder Stock Events /
// Snowball are loved for, but fully on-device and derived from the ONE existing
// DividendDataService.buildPaymentSchedule (no new data source).
//
// Pure core decides WHAT to remind about and dedupes; the renderer just feeds it
// the schedule and fires the notification. Stores only a small set of already-
// notified "symbol@date" keys (no amounts) so it never nags twice. Node-tested.
// ============================================================================
(function () {
  'use strict';

  var KEY = 'maermin_div_notified';
  var DAY_MS = 24 * 60 * 60 * 1000;
  var DEFAULT_WITHIN_DAYS = 7;

  function dayStart(ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function rowKey(r) { return String(r.symbol || '') + '@' + String(r.date || ''); }

  // PURE: rows from buildPaymentSchedule that are still in the future and fall
  // within `withinDays`. `now` defaults to Date.now(). Sorted by date.
  function upcoming(schedule, opts) {
    opts = opts || {};
    var now = typeof opts.now === 'number' ? opts.now : Date.now();
    var withinDays = typeof opts.withinDays === 'number' ? opts.withinDays : DEFAULT_WITHIN_DAYS;
    var from = dayStart(now);
    var to = from + withinDays * DAY_MS;
    var rows = Array.isArray(schedule) ? schedule : [];
    return rows.filter(function (r) {
      if (!r || r.past || !r.date) return false;
      var t = new Date(r.date + 'T00:00:00').getTime();
      if (isNaN(t)) return false;
      return t >= from && t <= to;
    }).sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  }

  // PURE: of the upcoming rows, the ones not already in `notified` (a map of
  // key→true). These are what the caller should actually notify on.
  function pending(schedule, notified, opts) {
    notified = notified || {};
    return upcoming(schedule, opts).filter(function (r) { return !notified[rowKey(r)]; });
  }

  // PURE: merge a set of just-notified rows into the notified map.
  function markNotified(notified, rows) {
    var next = Object.assign({}, notified || {});
    (rows || []).forEach(function (r) { next[rowKey(r)] = true; });
    return next;
  }

  // PURE: drop notified keys whose date is older than `keepDays` so the map can't
  // grow without bound (yesterday's payout never needs re-suppressing).
  function prune(notified, opts) {
    opts = opts || {};
    var now = typeof opts.now === 'number' ? opts.now : Date.now();
    var keepDays = typeof opts.keepDays === 'number' ? opts.keepDays : 90;
    var floor = dayStart(now) - keepDays * DAY_MS;
    var out = {};
    Object.keys(notified || {}).forEach(function (k) {
      var iso = k.split('@')[1] || '';
      var t = new Date(iso + 'T00:00:00').getTime();
      if (isNaN(t) || t >= floor) out[k] = true;
    });
    return out;
  }

  // PURE: a short human notification body for a batch of pending rows.
  function summarize(rows, opts) {
    opts = opts || {};
    var fmt = typeof opts.formatPrice === 'function' ? opts.formatPrice : function (n) { return String(n); };
    rows = rows || [];
    if (!rows.length) return '';
    if (rows.length === 1) {
      var r = rows[0];
      return r.symbol + ' pays ' + fmt(r.amount) + ' on ' + r.date;
    }
    var total = rows.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
    return rows.length + ' dividends due soon (~' + fmt(total) + ')';
  }

  // ---- thin localStorage bridge (browser only) -----------------------------
  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '{}'); return (v && typeof v === 'object') ? v : {}; }
    catch (e) { return {}; }
  }
  function save(notified) {
    try { localStorage.setItem(KEY, JSON.stringify(notified || {})); } catch (e) {}
    return notified;
  }

  var api = {
    KEY: KEY,
    DEFAULT_WITHIN_DAYS: DEFAULT_WITHIN_DAYS,
    rowKey: rowKey,
    upcoming: upcoming,
    pending: pending,
    markNotified: markNotified,
    prune: prune,
    summarize: summarize,
    load: load,
    save: save
  };
  if (typeof window !== 'undefined') window.MaerminDividendReminder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
