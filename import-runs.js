// ============================================================================
// MAERMIN — Import runs and "Undo this import"  (window.MaerminImportRuns)
// ----------------------------------------------------------------------------
// New users start with imports, and a wrong column mapping meant deleting the
// rows one by one (audit 2026-10-24, feature 3). Now every
// import run stamps its transactions with one `importId`, and the log lists
// the runs (source, time, rows). "Undo" moves every row of a run that is still
// there to the Trash in one entry, so the Trash or the toast can bring it back.
//
// Storage key 'maermin_import_log' (encrypted, synced, in the full backup):
//   [{ id, source, at, count }]   newest first, at most MAX entries
// The rows themselves live in `transactions`; a run whose rows are all gone is
// shown with 0 left and drops out of the list after MAX newer runs.
// `importId` is an extra field on a transaction: sync unions transactions by
// id, so it travels unchanged; an older build ignores it.
//
//   stamp(txs, source, now) -> { transactions, run }   (does not change txs)
//   add(log, run) -> log         rowsOf(transactions, id) -> rows
//   list(log, transactions) -> [{ id, source, at, count, left }]
//   load() / save(log)            browser storage, never throws
// Pure parts tested in test/import-runs.test.js.
// ============================================================================
(function () {
  'use strict';

  var KEY = 'maermin_import_log';
  var MAX = 50;
  var _seq = 0;

  function newId(now) { return 'imp_' + (now || Date.now()).toString(36) + '_' + (++_seq).toString(36) + Math.random().toString(36).slice(2, 6); }

  function stamp(txs, source, now) {
    var at = typeof now === 'number' ? now : Date.now();
    var id = newId(at);
    var out = (txs || []).map(function (tx) { return Object.assign({}, tx, { importId: id }); });
    return { transactions: out, run: { id: id, source: String(source || 'import'), at: at, count: out.length } };
  }

  function normalize(log) {
    return (Array.isArray(log) ? log : []).filter(function (r) { return r && typeof r.id === 'string' && r.id; });
  }

  function add(log, run) {
    if (!run || !run.id || !(run.count > 0)) return normalize(log);
    return [run].concat(normalize(log).filter(function (r) { return r.id !== run.id; })).slice(0, MAX);
  }

  function rowsOf(transactions, id) {
    return (transactions || []).filter(function (tx) { return tx && id && tx.importId === id; });
  }

  function list(log, transactions) {
    var left = {};
    (transactions || []).forEach(function (tx) { if (tx && tx.importId) left[tx.importId] = (left[tx.importId] || 0) + 1; });
    return normalize(log).map(function (r) {
      return { id: r.id, source: r.source, at: r.at, count: r.count, left: left[r.id] || 0 };
    });
  }

  function ls() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() {
    try { var s = ls(); return normalize(s ? JSON.parse(s.getItem(KEY) || '[]') : []); } catch (e) { return []; }
  }
  function save(log) {
    try { var s = ls(); if (s) s.setItem(KEY, JSON.stringify(normalize(log))); } catch (e) { /* storage full: the rows still carry their importId */ }
  }

  var api = { KEY: KEY, MAX: MAX, stamp: stamp, add: add, rowsOf: rowsOf, list: list, load: load, save: save };
  if (typeof window !== 'undefined') window.MaerminImportRuns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
