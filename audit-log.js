// ============================================================================
// MAERMIN — Audit & Error Log  (window.MaerminAuditLog)
// ----------------------------------------------------------------------------
// Lightweight, client-side security/observability trail. Records security- and
// data-relevant events (vault unlock, password change, backup/restore, data
// export/import, bulk delete) plus uncaught errors and promise rejections, so a
// user can see "what happened to my vault" and developers get crash telemetry —
// all WITHOUT a server (this app is 100% local).
//
// Design:
//   - Ring buffer capped at MAX entries in a single plaintext localStorage key
//     (`maermin_audit_log`). Entries are deliberately NON-sensitive: event type,
//     timestamp, short label — never portfolio values or secrets. Plaintext is
//     intentional so the log survives lock/unlock and never shadows the
//     encrypted data blob.
//   - record(type, detail, level) appends; getEntries()/clear() for the viewer.
//   - install() wires window.onerror + unhandledrejection once.
// Pure-ish + unit-tested (test/audit-log.test.js).
// ============================================================================
(function () {
  'use strict';

  var KEY = 'maermin_audit_log';
  var MAX = 500;

  // Known event types (string constants keep call sites consistent + greppable).
  var EVENTS = {
    VAULT_UNLOCK: 'vault.unlock',
    VAULT_SETUP: 'vault.setup',
    VAULT_LOCK: 'vault.lock',
    VAULT_PASSKEY_UNLOCK: 'vault.unlock.passkey',
    PASSWORD_CHANGE: 'vault.password.change',
    BACKUP_EXPORT: 'vault.backup.export',
    BACKUP_RESTORE: 'vault.backup.restore',
    DATA_EXPORT: 'data.export',
    DATA_IMPORT: 'data.import',
    DATA_WIPE: 'data.wipe',
    SETTINGS_CHANGE: 'settings.change',
    ERROR: 'error',
    REJECTION: 'error.promise'
  };

  function read() {
    try { var a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); return true; }
    catch (e) { return false; }
  }

  // Append one entry. `detail` should be a short, non-sensitive label.
  function record(type, detail, level) {
    var entry = { t: Date.now(), type: type || 'event', detail: String(detail == null ? '' : detail).slice(0, 200), level: level || 'info' };
    var list = read();
    list.push(entry);
    write(list);
    return entry;
  }

  function getEntries(opts) {
    opts = opts || {};
    var list = read().slice().reverse(); // newest first
    if (opts.level) list = list.filter(function (e) { return e.level === opts.level; });
    if (opts.type) list = list.filter(function (e) { return e.type === opts.type; });
    if (opts.limit) list = list.slice(0, opts.limit);
    return list;
  }

  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  // Wire global error capture exactly once. Guarded for headless/Node.
  var _installed = false;
  function install() {
    if (_installed || typeof window === 'undefined' || !window.addEventListener) return;
    _installed = true;
    window.addEventListener('error', function (ev) {
      var msg = ev && ev.message ? ev.message : 'unknown error';
      var where = ev && ev.filename ? (' @ ' + String(ev.filename).split('/').pop() + ':' + ev.lineno) : '';
      record(EVENTS.ERROR, msg + where, 'error');
    });
    window.addEventListener('unhandledrejection', function (ev) {
      var reason = ev && ev.reason ? (ev.reason.message || ev.reason) : 'unhandled rejection';
      record(EVENTS.REJECTION, String(reason), 'error');
    });
  }

  var api = {
    KEY: KEY, MAX: MAX, EVENTS: EVENTS,
    record: record, getEntries: getEntries, clear: clear, install: install
  };
  if (typeof window !== 'undefined') { window.MaerminAuditLog = api; install(); }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
