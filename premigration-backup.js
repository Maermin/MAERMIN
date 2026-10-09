// ============================================================================
// MAERMIN — Copy of the data before a migration  (window.MaerminPreMigration)
// ----------------------------------------------------------------------------
// P4-0. A schema migration (migrations.js) rewrites saved data in place. A
// mistake in one would reach every user's vault, and nobody can repair a vault
// remotely. So before migrations.js runs a pending migration, this module keeps
// an encrypted copy of every key in backup-engine.js KEYS on the device, and
// Settings → Trash offers to put it back.
//
//   guardedRun()  copy, then migrate. If the copy cannot be written, the
//                 migrations are NOT run on this load (the data stays as it
//                 is, the next load tries again) and status() says why.
//   info()        → null | { createdAt, fromVersion, toVersion,
//                            transactionCount, keyCount } | { unreadable: true }
//   restore()     writes the copy back and sets the schema version back to the
//                 copy's, so the migrations run again on the next load
//   discard()     deletes the copy
//
// Where: ONE IndexedDB record (RECORD) in idb-store.js's `maermin`/`kv` store,
// encrypted with the vault key (MaerminVault.encryptJSON). A full copy measured
// 0.9 MB (typical book) to 16 MB (10,000 trades, 150 holdings), mostly the daily
// close history - too much for localStorage's ~5 MB. One copy only: the next
// migration replaces it. Not synced (sync reads storage.js's keys only), not in
// the full backup, not a localStorage key.
//
// Dependencies are injectable ({ backup, vault, idb, migrations, storage }) so
// test/premigration-backup.test.js runs it in Node.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var RECORD = 'maermin_premigration_backup';
  var FORMAT = 'maermin-premigration';
  var TIMEOUT_MS = 20000;
  // Keys a fresh vault may already hold: UI preferences, not user data. A
  // vault with nothing else gets no copy (there is nothing to lose).
  var PREF_KEYS = { theme: 1, currency: 1, privacyMode: 1, maermin_language: 1, maermin_ui_mode: 1 };

  var _status = { state: 'none' }; // 'none' | 'taken' | 'empty' | 'blocked' | 'current'

  var W = (typeof window !== 'undefined') ? window : {};
  function deps(opts) {
    opts = opts || {};
    return {
      backup: opts.backup || W.MaerminBackup || null,
      vault: opts.vault || W.MaerminVault || null,
      idb: opts.idb || W.MaerminIDB || null,
      migrations: opts.migrations || W.MaerminMigrations || null,
      storage: opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null)
    };
  }

  // Does a backup snapshot hold anything beyond UI preferences?
  function hasUserData(snapshot) {
    var store = (snapshot && snapshot.store) || {};
    return Object.keys(store).some(function (k) {
      if (PREF_KEYS[k]) return false;
      var v = store[k];
      return typeof v === 'string' && v !== '' && v !== '[]' && v !== '{}' && v !== 'null';
    });
  }

  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  // Encrypt a copy of every KEYS entry and store it. Resolves
  // { taken: true, createdAt } or { taken: false, reason: 'empty' }; rejects
  // when the copy cannot be written (no IndexedDB, locked vault, quota …).
  function take(opts) {
    opts = opts || {};
    var d = deps(opts);
    return Promise.resolve().then(function () {
      if (!d.backup) throw new Error('no-backup-engine');
      var snapshot = d.backup.snapshot({ storage: d.storage });
      if (!hasUserData(snapshot)) return { taken: false, reason: 'empty' };
      if (!d.idb || (d.idb.isSupported && !d.idb.isSupported())) throw new Error('no-indexeddb');
      if (!d.vault || (d.vault.isUnlocked && !d.vault.isUnlocked())) throw new Error('locked');
      var createdAt = new Date(opts.now || Date.now()).toISOString();
      var payload = { format: FORMAT, createdAt: createdAt, fromVersion: opts.fromVersion, toVersion: opts.toVersion, backup: snapshot };
      return d.vault.encryptJSON(payload)
        .then(function (env) { return d.idb.set(RECORD, env); })
        .then(function () { return { taken: true, createdAt: createdAt }; });
    });
  }

  // The decrypted copy, or null (none) - rejects when it cannot be decrypted.
  function load(opts) {
    var d = deps(opts);
    if (!d.idb || (d.idb.isSupported && !d.idb.isSupported())) return Promise.resolve(null);
    return d.idb.get(RECORD).then(function (env) {
      if (env == null) return null;
      return d.vault.decryptJSON(env).then(function (p) {
        if (!p || p.format !== FORMAT || !d.backup || !d.backup.isFullBackup(p.backup)) throw new Error('bad-copy');
        return p;
      });
    });
  }

  function info(opts) {
    var d = deps(opts);
    return load(opts).then(function (p) {
      if (!p) return null;
      var sum = d.backup.summary(p.backup);
      return { createdAt: p.createdAt, fromVersion: p.fromVersion, toVersion: p.toVersion, transactionCount: sum.transactionCount, keyCount: sum.keyCount };
    }, function () { return { unreadable: true }; });
  }

  // Write the copy back (through the storage shim, so sensitive keys land in the
  // vault) and set the schema version back to where the copy was taken.
  // Resolves the number of keys restored.
  function restore(opts) {
    var d = deps(opts);
    return load(opts).then(function (p) {
      if (!p) throw new Error('no-copy');
      var n = d.backup.restore(p.backup, { storage: d.storage });
      if (d.migrations && typeof p.fromVersion === 'number') d.migrations.setVersion(p.fromVersion);
      return n;
    });
  }

  function discard(opts) {
    var d = deps(opts);
    if (!d.idb || (d.idb.isSupported && !d.idb.isSupported())) return Promise.resolve(true);
    return d.idb.del(RECORD).then(function () { return true; });
  }

  // Copy, then migrate. Never rejects: resolves the status, which status()
  // also returns afterwards (the app reads it to warn when blocked).
  function guardedRun(opts) {
    opts = opts || {};
    var d = deps(opts);
    var M = d.migrations;
    if (!M) { _status = { state: 'none' }; return Promise.resolve(_status); }
    var pending = M.pending();
    if (!pending.length) { _status = { state: 'current' }; return Promise.resolve(_status); }
    var from = M.getVersion(), to = M.LATEST;
    return withTimeout(take(Object.assign({}, opts, { fromVersion: from, toVersion: to })), opts.timeoutMs || TIMEOUT_MS)
      .then(function (r) {
        M.run();
        _status = r.taken ? { state: 'taken', createdAt: r.createdAt, fromVersion: from, toVersion: to } : { state: 'empty' };
        return _status;
      }, function (e) {
        _status = { state: 'blocked', reason: (e && e.message) || 'error', fromVersion: from, toVersion: to };
        if (typeof console !== 'undefined') console.error('[migrations] postponed: no copy of the data could be saved (' + _status.reason + ')');
        return _status;
      });
  }

  function status() { return _status; }

  // One-line warning for a postponed update (toast at start + Trash card).
  function blockedText(s) {
    return __('pmbBlocked', 'An update of your saved data was postponed: no copy of it could be saved on this device first ({reason}). Your data is unchanged; the update runs again at the next start.', { reason: (s && s.reason) || '' });
  }

  // ---- Settings → Trash card -------------------------------------------------
  function PreMigrationCard(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var th = props.theme || {};
    var text = th.text, dim = th.textSecondary, border = th.cardBorder;
    var st = React.useState(undefined), copy = st[0], setCopy = st[1];
    var bs = React.useState(false), busy = bs[0], setBusy = bs[1];
    React.useEffect(function () {
      var live = true;
      info().then(function (r) { if (live) setCopy(r); }, function () { if (live) setCopy(null); });
      return function () { live = false; };
    }, []);
    var s = status();
    if (copy === undefined) return null;
    if (!copy && s.state !== 'blocked') return null;
    var I = window.MaerminI18n;
    var toast = props.addToast || function () {};
    function btn(label, onClick, danger) {
      return e('button', { type: 'button', onClick: onClick, disabled: busy, style: { padding: '0.35rem 0.75rem', borderRadius: '7px', cursor: busy ? 'default' : 'pointer', fontSize: '0.78rem', fontWeight: 600,
        background: 'transparent', color: danger ? th.danger : th.accent, border: '1px solid ' + (danger ? th.danger + '66' : border) } }, label);
    }
    function doDiscard() {
      window.MaerminUtils.confirmThen({ title: __('pmbDiscardTitle', 'Delete the copy from before the update?'), message: __('trashPurgeMsg', 'This cannot be undone.'),
        confirmLabel: __('pmbDiscard', 'Delete copy'), cancelLabel: __('cancel', 'Cancel') }, function () {
        discard().then(function () { setCopy(null); toast(__('pmbDiscarded', 'Copy deleted'), 'success'); },
          function (err) { toast(__('pmbFailed', 'That did not work: {msg}', { msg: (err && err.message) || '' }), 'error'); });
      });
    }
    function doRestore() {
      var when = I.date(copy.createdAt, 'dateTime');
      window.MaerminUtils.confirmThen({
        title: __('pmbRestoreTitle', 'Restore the copy from {date}?', { date: when }),
        message: __('pmbRestoreMsg', 'Your data is replaced by the copy from {date} ({count} transactions). Changes made since then are lost. The app reloads, and the update of the saved data runs again.', { date: when, count: copy.transactionCount == null ? '?' : copy.transactionCount }),
        confirmLabel: __('pmbRestore', 'Restore copy'), cancelLabel: __('cancel', 'Cancel')
      }, function () {
        setBusy(true);
        restore().then(function (n) {
          if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', 'Pre-migration copy restored (' + n + ' data keys)');
          toast(__('backupRestoredReload', 'Backup restored — reloading…'), 'success');
          var S = window.MaerminStorage;
          var flushed = (S && S.flush) ? Promise.resolve(S.flush()).catch(function () {}) : Promise.resolve();
          flushed.then(function () { setTimeout(function () { window.location.reload(); }, 600); });
        }, function (err) {
          setBusy(false);
          toast(__('pmbFailed', 'That did not work: {msg}', { msg: (err && err.message) || '' }), 'error');
        });
      });
    }
    var body;
    if (copy && copy.unreadable) {
      body = [e('p', { key: 'p', style: { color: dim, fontSize: '0.82rem', margin: '0 0 0.75rem', lineHeight: 1.5 } },
        __('pmbUnreadable', 'There is a copy from before an update, but it cannot be read with this vault (for example after an encrypted backup from another vault was restored).')),
        e('div', { key: 'b', style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } }, btn(__('pmbDiscard', 'Delete copy'), doDiscard, true))];
    } else if (copy) {
      body = [e('p', { key: 'p', style: { color: dim, fontSize: '0.82rem', margin: '0 0 0.75rem', lineHeight: 1.5 } },
        __('pmbSub', 'Saved on {date}, before your data was updated to a new format: {count} transactions. It stays on this device, encrypted, and is not synced or part of a backup. The next update replaces it.',
          { date: I.date(copy.createdAt, 'dateTime'), count: copy.transactionCount == null ? '?' : copy.transactionCount })),
        e('div', { key: 'b', style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
          btn(__('pmbRestore', 'Restore copy'), doRestore, false), btn(__('pmbDiscard', 'Delete copy'), doDiscard, true))];
    } else body = [];
    return e('div', { 'data-testid': 'premigration-card', style: { background: th.card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginBottom: '1rem' } },
      e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: '0 0 0.4rem' } }, __('pmbTitle', 'Copy from before the last update')),
      s.state === 'blocked' ? e('p', { role: 'status', style: { color: th.warning, fontSize: '0.82rem', margin: '0 0 0.75rem', lineHeight: 1.5 } }, blockedText(s)) : null,
      body);
  }

  var api = {
    RECORD: RECORD, FORMAT: FORMAT, PREF_KEYS: PREF_KEYS,
    hasUserData: hasUserData, take: take, info: info, restore: restore, discard: discard,
    guardedRun: guardedRun, status: status, blockedText: blockedText, PreMigrationCard: PreMigrationCard
  };
  if (typeof window !== 'undefined') window.MaerminPreMigration = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
