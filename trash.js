// ============================================================================
// MAERMIN — Trash + Undo  (window.MaerminTrash)
// ----------------------------------------------------------------------------
// P2-4. A delete no longer destroys a record: it goes to the trash for 30 days,
// the delete toast offers "Undo", and Settings → Trash restores or purges.
//
// Storage key 'maermin_trash' (encrypted, synced, in the full backup):
//
//   [{ id, kind, label, deletedAt, payload }]
//
// kind names the record type. Records that live in a plain storage key are
// restored here (KINDS: key + optional path to the array inside it); records
// held in React state (transactions, portfolios) are restored by a handler the
// app registers (register(kind, fn)). A restore never adds a second copy: a
// record whose id is already present is not added again.
//
// Views that keep a restorable store in local state listen with onRestore(key)
// and reload it, so a restore from the Trash view (or Undo) is not overwritten
// by stale state.
//
// Pure helpers (add, remove, prune, restoreInto) are Node-tested in
// test/trash.test.js; the storage wrapper and TrashView touch the browser only.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var KEY = 'maermin_trash';
  var TTL_MS = 30 * 86400000;
  var MAX = 500; // a bulk delete must not grow the synced blob without bound

  // Restorable record types kept in a storage key. path: where the array is
  // inside the stored object (none = the value is the array itself).
  var KINDS = {
    savingsPlan: { key: 'maermin_savings_plans' },
    account:     { key: 'maermin_networth_accounts' },
    goal:        { key: 'investmentGoals' },
    rule:        { key: 'maermin_rules', path: 'rules' },
    realAsset:   { key: 'maermin_real_assets', path: 'assets' }
  };

  // ---- pure ------------------------------------------------------------------
  function normalize(list) {
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = null; } }
    return Array.isArray(list) ? list.filter(function (e) { return e && typeof e === 'object' && e.id && e.kind; }) : [];
  }
  var _seq = 0;
  function newId(now) { return 'tr_' + (now || Date.now()).toString(36) + '_' + (++_seq).toString(36) + Math.random().toString(36).slice(2, 6); }

  // Newest first; the oldest entries drop out beyond MAX.
  function add(list, entry) {
    return [entry].concat(normalize(list)).slice(0, MAX);
  }
  function remove(list, id) {
    return normalize(list).filter(function (e) { return e.id !== id; });
  }
  function find(list, id) {
    var l = normalize(list);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  // Entries older than 30 days are gone for good.
  function prune(list, now) {
    var cutoff = (now || Date.now()) - TTL_MS;
    return normalize(list).filter(function (e) { return e.deletedAt >= cutoff; });
  }
  function daysLeft(entry, now) {
    return Math.max(0, Math.ceil((entry.deletedAt + TTL_MS - (now || Date.now())) / 86400000));
  }

  // Put records back into an array: those whose id is already there are
  // skipped (no duplicates). Returns { items, added }.
  function restoreInto(items, records) {
    var out = Array.isArray(items) ? items.slice() : [];
    var have = {};
    out.forEach(function (r) { if (r && r.id != null) have[String(r.id)] = true; });
    var added = 0;
    (records || []).forEach(function (r) {
      if (!r) return;
      if (r.id != null && have[String(r.id)]) return;
      out.push(r);
      if (r.id != null) have[String(r.id)] = true;
      added++;
    });
    return { items: out, added: added };
  }

  // ---- storage ---------------------------------------------------------------
  function ls() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  var Store = (typeof window !== 'undefined' && window.MaerminStore) ? window.MaerminStore : null;
  var store = Store ? Store.createStore({ rev: 0 }) : null;
  function bump() { if (store) store.setState(function (s) { return { rev: s.rev + 1 }; }); }

  function list(now) {
    var s = ls();
    if (!s) return [];
    var raw = normalize(s.getItem(KEY));
    var kept = prune(raw, now);
    if (kept.length !== raw.length) write(kept);
    return kept;
  }
  function write(l) {
    var s = ls();
    if (!s) return;
    try { s.setItem(KEY, JSON.stringify(l)); } catch (e) { /* quota: the delete itself still happens */ }
    bump();
  }

  // Move a record to the trash. Returns the entry id (for Undo).
  function put(kind, label, payload, now) {
    now = now || Date.now();
    var entry = { id: newId(now), kind: kind, label: String(label == null ? '' : label).slice(0, 200), deletedAt: now, payload: payload };
    write(add(list(now), entry));
    return entry.id;
  }

  var handlers = {};
  function register(kind, fn) { handlers[kind] = fn; return function () { if (handlers[kind] === fn) delete handlers[kind]; }; }

  // Restore listeners per storage key (views with a local copy of the store).
  var listeners = {};
  function onRestore(key, fn) {
    (listeners[key] = listeners[key] || []).push(fn);
    return function () { listeners[key] = (listeners[key] || []).filter(function (f) { return f !== fn; }); };
  }
  function notify(key) { (listeners[key] || []).slice().forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function restoreStored(kind, payload) {
    var spec = KINDS[kind], s = ls();
    if (!spec || !s) return false;
    var raw = null;
    try { raw = JSON.parse(s.getItem(spec.key) || 'null'); } catch (e) { raw = null; }
    var holder = spec.path ? ((raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}) : null;
    var arr = spec.path ? (Array.isArray(holder[spec.path]) ? holder[spec.path] : []) : (Array.isArray(raw) ? raw : []);
    var res = restoreInto(arr, [payload]);
    if (spec.path) { holder = Object.assign({}, holder); holder[spec.path] = res.items; }
    s.setItem(spec.key, JSON.stringify(spec.path ? holder : res.items));
    notify(spec.key);
    return true;
  }

  // Restore an entry: the registered handler, else the storage kinds. The
  // entry leaves the trash only when the record is back.
  function restore(id) {
    var entry = find(list(), id);
    if (!entry) return false;
    var ok = false;
    try { ok = handlers[entry.kind] ? handlers[entry.kind](entry.payload, entry) !== false : restoreStored(entry.kind, entry.payload); }
    catch (e) { ok = false; }
    if (ok) write(remove(list(), id));
    return ok;
  }
  function purge(id) { write(remove(list(), id)); }
  function purgeAll() { write([]); }

  // Delete toast with an "Undo" button that restores this entry.
  function toastUndo(message, entryId) {
    var UI = (typeof window !== 'undefined') && window.MaerminUI;
    if (!UI || !UI.add) return;
    UI.add(message, 'success', 8000, { label: __('undo', 'Undo'), run: function () {
      if (restore(entryId)) UI.add(__('trashRestored', 'Restored'), 'success');
    } });
  }

  // Shorthand for the storage kinds: trash the record, show the Undo toast.
  function trashed(kind, label, payload, message) {
    var id = put(kind, label, payload);
    toastUndo(message || __('trashMoved', '"{name}" moved to the trash', { name: label }), id);
    return id;
  }

  // React: reload a local copy of `key` after a restore.
  function useReload(key, reload) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return;
    React.useEffect(function () { return onRestore(key, reload); }, [key]);
  }

  // ---- Settings → Trash ------------------------------------------------------
  function kindLabel(kind) {
    return ({
      transaction: __('trashKindTx', 'Transaction'), portfolio: __('trashKindPortfolio', 'Portfolio'),
      savingsPlan: __('trashKindPlan', 'Savings plan'), account: __('trashKindAccount', 'Net-worth account'),
      goal: __('trashKindGoal', 'Goal'), rule: __('trashKindRule', 'Rule'), realAsset: __('trashKindAsset', 'Real asset')
    })[kind] || kind;
  }

  function TrashView(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React || !Store || !store) return null;
    var e = React.createElement;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    Store.useStore(store, function (s) { return s.rev; });
    var items = list();
    var I = window.MaerminI18n;
    function btn(label, onClick, danger, aria) {
      return e('button', { type: 'button', onClick: onClick, 'aria-label': aria, style: { padding: '0.35rem 0.75rem', borderRadius: '7px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
        background: 'transparent', color: danger ? (th.danger || '#ef4444') : (th.accent || '#8b7cff'), border: '1px solid ' + (danger ? (th.danger || '#ef4444') + '66' : border) } }, label);
    }
    function confirmPurge(title, run) {
      window.MaerminUtils.confirmThen({ title: title, message: __('trashPurgeMsg', 'This cannot be undone.'), confirmLabel: __('trashPurge', 'Delete forever'), cancelLabel: __('cancel', 'Cancel') }, run);
    }
    return e('div', { 'data-testid': 'trash-view', style: { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' } },
        e('h2', { style: { color: text, fontSize: '1.2rem', fontWeight: 800, margin: 0 } }, __('trashTitle', 'Trash')),
        items.length ? btn(__('trashEmpty', 'Empty trash'), function () { confirmPurge(__('trashEmptyTitle', 'Delete all {n} {n:item|items} forever?', { n: items.length }), purgeAll); }, true) : null),
      e('p', { style: { color: dim, fontSize: '0.82rem', margin: '0 0 1rem', lineHeight: 1.5 } },
        __('trashIntro', 'Deleted transactions, portfolios, savings plans, accounts, goals, rules and real assets stay here for 30 days. Restore puts them back where they were.')),
      items.length === 0
        ? e('div', { style: { color: dim, fontSize: '0.85rem', padding: '1.5rem 0', textAlign: 'center' } }, __('trashNone', 'The trash is empty.'))
        : e('ul', { style: { listStyle: 'none', margin: 0, padding: 0 } }, items.map(function (it) {
            return e('li', { key: it.id, 'data-trash-kind': it.kind, style: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0', borderTop: '1px solid ' + border, flexWrap: 'wrap' } },
              e('div', { style: { flex: '1 1 14rem', minWidth: 0 } },
                e('div', { style: { color: text, fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis' } }, it.label || kindLabel(it.kind)),
                e('div', { style: { color: dim, fontSize: '0.74rem' } },
                  kindLabel(it.kind) + ' · ' + __('trashDeletedOn', 'deleted {date}', { date: I ? I.date(it.deletedAt, 'dateTime') : new Date(it.deletedAt).toISOString() }) + ' · ' +
                  __('trashDaysLeft', '{n} {n:day|days} left', { n: daysLeft(it) }))),
              btn(__('trashRestore', 'Restore'), function () {
                if (restore(it.id)) { if (props.addToast) props.addToast(__('trashRestored', 'Restored'), 'success'); }
                else if (props.addToast) props.addToast(__('trashRestoreFailed', 'Could not restore this item.'), 'error');
              }, false, __('trashRestoreAria', 'Restore {name}', { name: it.label || kindLabel(it.kind) })),
              btn(__('trashPurge', 'Delete forever'), function () { confirmPurge(__('trashPurgeTitle', 'Delete "{name}" forever?', { name: it.label || kindLabel(it.kind) }), function () { purge(it.id); }); }, true,
                __('trashPurgeAria', 'Delete {name} forever', { name: it.label || kindLabel(it.kind) })));
          })));
  }

  var api = {
    KEY: KEY, TTL_MS: TTL_MS, MAX: MAX, KINDS: KINDS, store: store,
    normalize: normalize, add: add, remove: remove, find: find, prune: prune, daysLeft: daysLeft, restoreInto: restoreInto,
    list: list, put: put, register: register, onRestore: onRestore, notify: notify, restore: restore, purge: purge, purgeAll: purgeAll,
    toastUndo: toastUndo, trashed: trashed, useReload: useReload, kindLabel: kindLabel, TrashView: TrashView
  };
  if (typeof window !== 'undefined') window.MaerminTrash = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
