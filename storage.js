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
        schedulePersist();
        return;
      }
      return nativeSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function (key) {
      if (this === ls && mem && isSensitive(key)) {
        delete mem[key];
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
    return Vault.encryptJSON(mem)
      .then(function (env) {
        nativeSet.call(window.localStorage, BLOB_KEY, env);
        persisting = false;
        return true;
      })
      .catch(function () { persisting = false; return false; });
  }
  function flush() { return persist(); }

  // ---- hydrate (unlock → memory) -------------------------------------------
  // Reads the ciphertext blob and decrypts into `mem`, then installs the shim.
  // Fail-safe: any error leaves storage in native mode untouched.
  function hydrate() {
    if (!Vault || !Vault.isUnlocked()) return Promise.resolve(false);
    var env;
    try { env = nativeRead(BLOB_KEY); } catch (e) { env = null; }
    if (!env) { mem = {}; installShim(); return Promise.resolve(true); } // empty vault
    return Vault.decryptJSON(env)
      .then(function (obj) {
        mem = obj && typeof obj === 'object' ? obj : {};
        installShim();
        return true;
      })
      .catch(function () { mem = null; return false; }); // fail-safe: stay native
  }

  function nativeRead(key) {
    return (nativeGet || Storage.prototype.getItem).call(window.localStorage, key);
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

    // 2) write encrypted blob, then 3) remove plaintext originals, 4) install shim.
    return Vault.encryptJSON(mem).then(function (env) {
      (nativeSet || Storage.prototype.setItem).call(ls, BLOB_KEY, env);
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
    Storage.prototype.removeItem.call(ls, BLOB_KEY);
    Storage.prototype.removeItem.call(ls, ATREST_FLAG);
    mem = null;
    return Promise.resolve(true);
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

  // Re-encrypt the blob under a new key after changePassword (mem already holds
  // plaintext; just persist with the now-current vault key).
  function rekey() { return persist(); }

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
      Storage.prototype.removeItem.call(ls, BLOB_KEY);
      Storage.prototype.removeItem.call(ls, ATREST_FLAG);
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
    var existingBlob = (nativeGet || Storage.prototype.getItem).call(ls, BLOB_KEY);
    var blobP;
    if (existingBlob) blobP = Promise.resolve(existingBlob);
    else if (Vault && Vault.isUnlocked()) blobP = Vault.encryptJSON(snapshotPlaintext());
    else return Promise.reject(new Error('locked'));
    return blobP.then(function (blob) {
      var meta;
      try { meta = JSON.parse(metaRaw); } catch (e) { meta = null; }
      return { format: 'maermin-vault-backup', v: 1, exportedAt: Date.now(), meta: meta, blob: blob };
    });
  }

  function importEncryptedBackup(obj) {
    if (!obj || obj.format !== 'maermin-vault-backup' || !obj.meta || typeof obj.blob !== 'string') {
      return Promise.reject(new Error('bad-backup'));
    }
    var ls = window.localStorage;
    uninstallShim(); mem = null;
    (nativeSet || Storage.prototype.setItem).call(ls, metaKeyName(), JSON.stringify(obj.meta));
    (nativeSet || Storage.prototype.setItem).call(ls, BLOB_KEY, obj.blob);
    (nativeSet || Storage.prototype.setItem).call(ls, ATREST_FLAG, '1');
    return Promise.resolve(true); // caller reloads → unlock screen → password decrypts
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
