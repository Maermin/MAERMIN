// ============================================================================
// MAERMIN — Encrypted Storage  (window.MaerminStorage)
// ----------------------------------------------------------------------------
// Epic 4 "encrypted local database" + the local half of Epic 1 (sync blob).
//
// The app reads/writes localStorage directly in hundreds of places across
// renderer.js + features*.js. To encrypt data AT REST without touching every
// call site, this module transparently re-routes a fixed set of SENSITIVE keys:
//
//   - At rest: only ONE ciphertext blob  localStorage["maermin_vault_data"]
//     (AES-256-GCM via MaerminVault). The individual plaintext keys are removed.
//   - While unlocked: their plaintext lives in an in-memory Map. A thin shim on
//     Storage.prototype.getItem/setItem/removeItem serves those keys from memory
//     (synchronously, as the app expects) and re-encrypts the blob on a debounce.
//   - On lock: the in-memory plaintext is wiped (the shim then returns null until
//     re-hydrated), so a locked/closed app exposes only ciphertext.
//
// SAFETY (this migrates real financial data, so it is defensive + reversible):
//   - Default is OFF. Nothing changes until enableAtRest() is called.
//   - Before the first migration it writes a full PLAINTEXT backup to
//     localStorage["maermin_preenc_backup"] so the move is reversible.
//   - If the vault is locked or a decrypt fails, it FALLS BACK to native
//     storage and never deletes plaintext — fail-safe, never lose data.
//   - disableAtRest() restores individual plaintext keys and removes the blob.
//
// Requires crypto-vault.js loaded first. UI-free.
// ============================================================================
(function () {
  'use strict';

  var Vault = (typeof window !== 'undefined') && window.MaerminVault;

  var BLOB_KEY    = 'maermin_vault_data';
  var BACKUP_KEY  = 'maermin_preenc_backup';
  var ATREST_FLAG = 'maermin_vault_atrest';   // plaintext '1' marker so we know to hydrate on next load

  // Keys whose VALUES are user financial data and must be encrypted at rest.
  // (Derived from the real localStorage usage across the codebase.) UI prefs
  // like theme/currency/privacyMode are intentionally NOT here — non-sensitive
  // and sometimes read before unlock.
  var SENSITIVE_KEYS = [
    'transactions',
    'priceHistory',
    'apiKeys',
    'investmentGoals',
    'maermin_active_portfolio',
    'maermin_portfolios',
    'maermin_networth_accounts',
    'maermin_journal',
    'maermin_notes',
    'maermin_savings_plans',
    'maermin_targets',
    'maermin_watchlist',
    'maermin_alerts',
    'maermin_divevents',
    'maermin_fire_settings',
    // German fund taxation: the fund-type map reveals held symbols, the
    // Vorabpauschale records hold EUR amounts per year, the church-tax rate
    // reveals a religious affiliation.
    'maermin_fund_types',
    'maermin_vap_records',
    'maermin_kirchensteuer',
    // Per-position manual taxable overrides reveal held symbols + amounts.
    // (The global tax settings maermin_tax_settings are rates/flags only and
    // intentionally NOT sensitive.)
    'maermin_tax_overrides'
  ];
  var sensitiveSet = {};
  SENSITIVE_KEYS.forEach(function (k) { sensitiveSet[k] = true; });

  // Infra keys that must always stay native plaintext (never rerouted).
  var INFRA_KEYS = {};
  [BLOB_KEY, BACKUP_KEY, ATREST_FLAG, 'maermin_auth_session',
   (Vault && Vault.META_KEY) || 'maermin_vault_meta'].forEach(function (k) { INFRA_KEYS[k] = true; });

  function isSensitive(key) { return !!sensitiveSet[key] && !INFRA_KEYS[key]; }
  function registerSensitiveKey(key) { if (key && !INFRA_KEYS[key]) sensitiveSet[key] = true; }

  // ---- in-memory plaintext store -------------------------------------------
  var mem = null;             // null = not hydrated; object = unlocked plaintext map
  var installed = false;
  var nativeGet, nativeSet, nativeRemove;

  // v12 per-key (IndexedDB only): dirty-key tracking so persist re-encrypts and
  // writes ONLY the keys that changed instead of the whole blob, and a name→
  // random-recordId map (the "manifest") so at rest there is one small encrypted
  // record per sensitive key. Key NAMES never appear in plaintext (the manifest
  // itself is AES-GCM encrypted and record ids are random) — preserving the
  // zero-knowledge property that even key names like maermin_kirchensteuer leak
  // nothing at rest. All of this is inert without IndexedDB (Node → blob path).
  var dirty = {};             // { sensitiveKey: true } since the last persist
  var _manifest = null;       // { name: recordId } | null = not loaded
  var _migrateBlobPending = false; // true → an old monolithic blob to delete after first per-key write

  function isEnabled() {
    try { return localStorage.getItem(ATREST_FLAG) === '1'; } catch (e) { return false; }
  }

  // ---- shim ----------------------------------------------------------------
  function installShim() {
    if (installed || typeof Storage === 'undefined') return;
    nativeGet    = Storage.prototype.getItem;
    nativeSet    = Storage.prototype.setItem;
    nativeRemove = Storage.prototype.removeItem;
    var ls = window.localStorage;

    Storage.prototype.getItem = function (key) {
      if (this === ls && mem && isSensitive(key)) {
        return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null;
      }
      return nativeGet.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (this === ls && mem && isSensitive(key)) {
        mem[key] = String(value);
        dirty[key] = true;
        schedulePersist();
        return;
      }
      return nativeSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === ls && mem && isSensitive(key)) {
        delete mem[key];
        dirty[key] = true;
        schedulePersist();
        return;
      }
      return nativeRemove.call(this, key);
    };
    installed = true;
  }

  function uninstallShim() {
    if (!installed) return;
    Storage.prototype.getItem = nativeGet;
    Storage.prototype.setItem = nativeSet;
    Storage.prototype.removeItem = nativeRemove;
    installed = false;
  }

  // ---- persist (debounced, async) ------------------------------------------
  var persistTimer = null;
  var persisting = false;
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(function () { persist(); }, 300);
  }
  function persist() {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    if (!mem || !Vault || !Vault.isUnlocked()) return Promise.resolve(false);
    if (persisting) { schedulePersist(); return Promise.resolve(false); }
    persisting = true;
    var IDB = idbBackend();
    var p = IDB
      ? persistPerKey(IDB)                                   // v12: per-key records
      : Vault.encryptJSON(mem).then(function (env) { return blobSet(env); }); // blob (LS)
    return p
      .then(function () { persisting = false; return true; })
      .catch(function () { persisting = false; return false; });
  }
  function flush() { return persist(); }

  // ---- hydrate (unlock → memory) -------------------------------------------
  // Reads the ciphertext blob and decrypts into `mem`, then installs the shim.
  // Fail-safe: any error leaves storage in native mode untouched.
  function hydrate() {
    if (!Vault || !Vault.isUnlocked()) return Promise.resolve(false);
    var IDB = idbBackend();
    if (IDB) {
      // v12: prefer per-key records; fall back to a Phase-1 blob and migrate it.
      return hydratePerKey(IDB).then(function (perKey) {
        if (perKey) { mem = perKey; dirty = {}; installShim(); return true; }
        return blobGet().catch(function () { return null; }).then(function (env) {
          if (!env) { mem = {}; _manifest = {}; dirty = {}; installShim(); return true; }
          return Vault.decryptJSON(env).then(function (obj) {
            mem = obj && typeof obj === 'object' ? obj : {};
            _manifest = {}; dirty = {};
            Object.keys(mem).forEach(function (k) { dirty[k] = true; });
            _migrateBlobPending = true;   // first per-key write drops the old blob
            installShim();
            schedulePersist();
            return true;
          }, function () { mem = null; return false; });
        });
      }).catch(function () { mem = null; return false; });
    }
    // No IndexedDB → the localStorage blob path (Phase 1, byte-identical).
    return blobGet().catch(function () { return null; }).then(function (env) {
      if (!env) { mem = {}; installShim(); return true; } // empty vault
      return Vault.decryptJSON(env)
        .then(function (obj) { mem = obj && typeof obj === 'object' ? obj : {}; installShim(); return true; })
        .catch(function () { mem = null; return false; }); // fail-safe: stay native
    });
  }

  function nativeRead(key) {
    return (nativeGet || Storage.prototype.getItem).call(window.localStorage, key);
  }

  // ---- blob backend (IndexedDB for large vaults, localStorage fallback) ------
  // The encrypted data blob is the ONE record that grows with the user's data;
  // localStorage's ~5 MB cap is the real scaling ceiling for 10k+ transactions.
  // When IndexedDB (MaerminIDB) is available the blob lives there (no practical
  // size limit) and an existing localStorage blob is migrated on first read.
  // Node / no-IDB → the localStorage path, byte-identical to before, so the
  // at-rest tests are unaffected. All blob I/O goes through blobGet/Set/Del.
  function idbBackend() {
    var IDB = (typeof window !== 'undefined') && window.MaerminIDB;
    return (IDB && typeof IDB.isSupported === 'function' && IDB.isSupported()) ? IDB : null;
  }
  function lsBlobRead() { return (nativeGet || Storage.prototype.getItem).call(window.localStorage, BLOB_KEY); }
  function lsBlobWrite(env) { (nativeSet || Storage.prototype.setItem).call(window.localStorage, BLOB_KEY, env); }
  function lsBlobRemove() { (nativeRemove || Storage.prototype.removeItem).call(window.localStorage, BLOB_KEY); }

  function blobGet() {
    var IDB = idbBackend();
    if (!IDB) return Promise.resolve(lsBlobRead());
    return IDB.get(BLOB_KEY).then(function (v) {
      if (v != null) return v;
      // Transparent migration: an existing localStorage blob moves into IDB once.
      var ls = lsBlobRead();
      if (ls != null) return IDB.set(BLOB_KEY, ls).then(function () { try { lsBlobRemove(); } catch (e) {} return ls; });
      return null;
    }).catch(function () { return lsBlobRead(); }); // IDB read failed → fall back to LS
  }
  function blobSet(env) {
    var IDB = idbBackend();
    if (!IDB) { lsBlobWrite(env); return Promise.resolve(true); }
    return IDB.set(BLOB_KEY, env).then(function () {
      try { lsBlobRemove(); } catch (e) {} // keep a single source of truth
      return true;
    }).catch(function () { try { lsBlobWrite(env); } catch (e) {} return true; }); // IDB write failed → LS
  }
  function blobDel() {
    var IDB = idbBackend();
    try { lsBlobRemove(); } catch (e) {}
    if (!IDB) return Promise.resolve(true);
    return IDB.del(BLOB_KEY).then(function () { return true; }, function () { return true; });
  }

  // ---- per-key encrypted records (IndexedDB only) --------------------------
  // One small AES-GCM record per sensitive key instead of one growing blob, so a
  // single edit re-encrypts/writes only that key. The name→id map (manifest) is
  // itself encrypted and record ids are random, so NO key name is exposed at
  // rest. Inert without IndexedDB (Node uses the blob path above).
  var MANIFEST_KEY = 'maermin_vault_manifest'; // IDB key of the encrypted name→id map
  function recId() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var a = crypto.getRandomValues(new Uint8Array(8)), s = '';
      for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
      return s;
    }
    return 'r' + Math.random().toString(16).slice(2, 18);
  }
  function recKey(id) { return 'r:' + id; }
  function writeManifest(IDB) {
    return Vault.encryptJSON({ v: 1, map: _manifest || {} }).then(function (env) { return IDB.set(MANIFEST_KEY, env); });
  }
  // Persist only the dirty keys as individual encrypted records + the manifest.
  function persistPerKey(IDB) {
    if (!_manifest) _manifest = {};
    var names = Object.keys(dirty);
    dirty = {}; // capture this batch; writes during the await re-dirty + re-persist
    var ops = names.map(function (name) {
      if (Object.prototype.hasOwnProperty.call(mem, name)) {
        if (!_manifest[name]) _manifest[name] = recId();
        return Vault.encrypt(mem[name]).then(function (env) { return IDB.set(recKey(_manifest[name]), env); });
      }
      var id = _manifest[name];           // removed key → drop its record + entry
      delete _manifest[name];
      return id ? IDB.del(recKey(id)) : Promise.resolve();
    });
    return Promise.all(ops)
      .then(function () { return writeManifest(IDB); })
      .then(function () { if (_migrateBlobPending) { _migrateBlobPending = false; return blobDel(); } });
  }
  // Read mem from the per-key records; resolves null when there is no manifest
  // yet (caller then tries the Phase-1 blob).
  function hydratePerKey(IDB) {
    return IDB.get(MANIFEST_KEY).then(function (menv) {
      if (!menv) return null;
      return Vault.decryptJSON(menv).then(function (obj) {
        var map = (obj && obj.map) || {};
        return Promise.all(Object.keys(map).map(function (name) {
          return IDB.get(recKey(map[name])).then(function (env) {
            if (!env) return null;
            return Vault.decrypt(env).then(function (plain) { return { name: name, value: plain }; }, function () { return null; });
          });
        })).then(function (rows) {
          var out = {};
          rows.forEach(function (r) { if (r) out[r.name] = r.value; });
          _manifest = map;
          return out;
        });
      }, function () { return null; }); // manifest decrypt failed → fall back to blob
    });
  }
  // Remove every per-key record + the manifest (disable / restore).
  function perKeyClear(IDB) {
    if (!_manifest) return Promise.resolve();
    var ops = Object.keys(_manifest).map(function (n) { return IDB.del(recKey(_manifest[n])); });
    ops.push(IDB.del(MANIFEST_KEY));
    _manifest = {};
    return Promise.all(ops).then(function () {});
  }

  // ---- enable / migrate ----------------------------------------------------
  // First-time turn-on: snapshot plaintext → backup, load into memory, write the
  // encrypted blob, then remove the individual plaintext keys. Reversible.
  function enableAtRest() {
    if (!Vault || !Vault.isUnlocked()) return Promise.reject(new Error('locked'));
    var ls = window.localStorage;
    var snapshot = {};
    SENSITIVE_KEYS.forEach(function (k) {
      var v = (nativeGet || Storage.prototype.getItem).call(ls, k);
      if (v !== null && v !== undefined) snapshot[k] = v;
    });
    // 1) plaintext backup (reversibility) — only if not already backed up.
    try {
      if (!(nativeGet || Storage.prototype.getItem).call(ls, BACKUP_KEY)) {
        (nativeSet || Storage.prototype.setItem).call(ls, BACKUP_KEY,
          JSON.stringify({ at: Date.now(), data: snapshot }));
      }
    } catch (e) { /* backup best-effort; continue */ }

    mem = {};
    Object.keys(snapshot).forEach(function (k) { mem[k] = snapshot[k]; });

    // 2) write encrypted data (per-key records when IndexedDB is available, else
    //    one blob), then 3) remove plaintext originals, 4) install shim.
    var IDB = idbBackend();
    var writeP;
    if (IDB) {
      _manifest = {}; dirty = {};
      Object.keys(mem).forEach(function (k) { dirty[k] = true; });
      writeP = persistPerKey(IDB).then(function () { return blobDel(); }); // no stale blob
    } else {
      writeP = Vault.encryptJSON(mem).then(function (env) { return blobSet(env); });
    }
    return writeP.then(function () {
      SENSITIVE_KEYS.forEach(function (k) {
        (nativeRemove || Storage.prototype.removeItem).call(ls, k);
      });
      (nativeSet || Storage.prototype.setItem).call(ls, ATREST_FLAG, '1');
      installShim();
      return true;
    });
  }

  // Turn off: write current plaintext back as individual keys, drop the blob.
  function disableAtRest() {
    var ls = window.localStorage;
    if (mem) {
      uninstallShim();
      Object.keys(mem).forEach(function (k) {
        if (isSensitive(k)) Storage.prototype.setItem.call(ls, k, mem[k]);
      });
    }
    Storage.prototype.removeItem.call(ls, ATREST_FLAG);
    mem = null;
    var IDB = idbBackend();
    var clearP = IDB ? perKeyClear(IDB) : Promise.resolve();
    return Promise.all([clearP, blobDel()]).then(function () { dirty = {}; return true; });
  }

  // Called by auth.js right after a successful unlock. If at-rest was previously
  // enabled, hydrate + install the shim so the app reads decrypted data.
  function resume() {
    if (!isEnabled()) return Promise.resolve(false);
    return hydrate();
  }

  // Wipe in-memory plaintext (called from the vault's onLock).
  function onLock() {
    // Best-effort final flush so the latest session writes are encrypted.
    var p = persist();
    mem = null;
    return p;
  }

  // Re-encrypt under a new key after changePassword (mem already holds plaintext).
  // The blob path re-encrypts everything anyway; the per-key path must mark ALL
  // keys dirty so every record is rewritten under the new key (not just the ones
  // edited this session) — otherwise old-key records would fail to decrypt next
  // unlock.
  function rekey() {
    if (idbBackend() && mem) { Object.keys(mem).forEach(function (k) { dirty[k] = true; }); }
    return persist();
  }

  // Export the current decrypted snapshot (for sync-engine.js to wrap+upload).
  function snapshotPlaintext() {
    if (mem) {
      var copy = {};
      Object.keys(mem).forEach(function (k) { copy[k] = mem[k]; });
      return copy;
    }
    // at-rest off: read native plaintext
    var out = {};
    SENSITIVE_KEYS.forEach(function (k) {
      var v = Storage.prototype.getItem.call(window.localStorage, k);
      if (v !== null && v !== undefined) out[k] = v;
    });
    return out;
  }

  // Restore the backup (manual recovery path).
  function restoreBackup() {
    var ls = window.localStorage;
    var raw = Storage.prototype.getItem.call(ls, BACKUP_KEY);
    if (!raw) return false;
    try {
      var b = JSON.parse(raw);
      uninstallShim(); mem = null;
      Object.keys(b.data || {}).forEach(function (k) {
        Storage.prototype.setItem.call(ls, k, b.data[k]);
      });
      var IDB = idbBackend();
      if (IDB) perKeyClear(IDB);   // drop per-key records + manifest (best-effort)
      blobDel();                   // and the blob from whichever backend holds it
      Storage.prototype.removeItem.call(ls, ATREST_FLAG);
      dirty = {};
      return true;
    } catch (e) { return false; }
  }

  // ---- portable encrypted backup (disaster recovery) -----------------------
  // The vault has no password recovery by design; if the browser store is wiped
  // and there is no backup, data is lost. These produce/restore a SELF-CONTAINED
  // encrypted backup file = { vault meta, AES-256-GCM data blob }. It stays
  // zero-knowledge: the file is useless without the password, and can be
  // restored on any device. Pair with the plaintext data export in
  // import-export-engine.js for a non-encrypted escape hatch.
  function metaKeyName() { return (Vault && Vault.META_KEY) || 'maermin_vault_meta'; }

  function exportEncryptedBackup() {
    var ls = window.localStorage;
    var metaRaw = (nativeGet || Storage.prototype.getItem).call(ls, metaKeyName());
    if (!metaRaw) return Promise.reject(new Error('no-vault'));
    return blobGet().then(function (existingBlob) {
      var blobP;
      if (existingBlob) blobP = Promise.resolve(existingBlob);
      else if (Vault && Vault.isUnlocked()) blobP = Vault.encryptJSON(snapshotPlaintext());
      else return Promise.reject(new Error('locked'));
      return blobP.then(function (blob) {
        var meta;
        try { meta = JSON.parse(metaRaw); } catch (e) { meta = null; }
        return { format: 'maermin-vault-backup', v: 1, exportedAt: Date.now(), meta: meta, blob: blob };
      });
    });
  }

  function importEncryptedBackup(obj) {
    if (!obj || obj.format !== 'maermin-vault-backup' || !obj.meta || typeof obj.blob !== 'string') {
      return Promise.reject(new Error('bad-backup'));
    }
    var ls = window.localStorage;
    uninstallShim(); mem = null;
    (nativeSet || Storage.prototype.setItem).call(ls, metaKeyName(), JSON.stringify(obj.meta));
    (nativeSet || Storage.prototype.setItem).call(ls, ATREST_FLAG, '1');
    // Drop any stale per-key manifest so the next unlock hydrates from THIS
    // imported blob (which then re-migrates to fresh per-key records). Orphaned
    // old record blobs are harmless (random ids, encrypted, unreferenced).
    var IDB = idbBackend();
    _manifest = null; dirty = {};
    var pre = IDB ? IDB.del(MANIFEST_KEY).then(function () {}, function () {}) : Promise.resolve();
    return pre.then(function () { return blobSet(obj.blob); }).then(function () { return true; });
  }

  // Best-effort flush when the tab is hidden/closed.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', function () { flush(); });
  }

  // Wire the vault's auto-lock to wipe memory.
  if (Vault && typeof Vault.onLock === 'function') Vault.onLock(onLock);

  var api = {
    SENSITIVE_KEYS: SENSITIVE_KEYS,
    isSensitive: isSensitive,
    registerSensitiveKey: registerSensitiveKey,
    isEnabled: isEnabled,
    enableAtRest: enableAtRest,
    disableAtRest: disableAtRest,
    resume: resume,
    hydrate: hydrate,
    persist: persist,
    flush: flush,
    rekey: rekey,
    onLock: onLock,
    snapshotPlaintext: snapshotPlaintext,
    restoreBackup: restoreBackup,
    exportEncryptedBackup: exportEncryptedBackup,
    importEncryptedBackup: importEncryptedBackup,
    BLOB_KEY: BLOB_KEY,
    BACKUP_KEY: BACKUP_KEY,
    ATREST_FLAG: ATREST_FLAG,
    // test seam: allow tests to inject native fns without a real Storage proto
    _setNative: function (g, s, r) { nativeGet = g; nativeSet = s; nativeRemove = r; }
  };

  if (typeof window !== 'undefined') window.MaerminStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
