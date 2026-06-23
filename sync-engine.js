// ============================================================================
// MAERMIN — End-to-End Encrypted Cloud Sync  (window.MaerminSync)
// ----------------------------------------------------------------------------
// Epic 1. Multi-device sync where the server (or Google Drive / OneDrive) only
// ever sees CIPHERTEXT. It docks onto the security foundation:
//   - MaerminVault.encryptJSON / deriveSubKey  → AES-256-GCM blob + account id
//   - MaerminStorage.snapshotPlaintext         → the data to sync
//   - MaerminPWA.requestBackgroundSync         → retry trigger
//
// Identity model (zero-knowledge): the account id is HKDF(vaultKey,'sync-account')
// hashed — derived from the PASSWORD, never sent. Same password on another
// device ⇒ same account ⇒ same decryption key. No login/email/server account.
//
// Concurrency: optimistic, revision-based. push() sends baseRev; the backend
// rejects with 409 if its rev moved on (another device wrote). On conflict we
// PULL, MERGE (transactions are unioned so entries are never lost; other keys
// use last-write-wins by blob timestamp) and re-push. A conflict report is
// surfaced for the UI.
//
// Transports are pluggable; network is injected (fetchImpl / token providers)
// so the core is fully unit-testable in Node. UI stays in the views.
// ============================================================================
(function () {
  'use strict';

  var Vault   = (typeof window !== 'undefined') && window.MaerminVault;
  var Storage = (typeof window !== 'undefined') && window.MaerminStorage;

  var STATE_KEY  = 'maermin_sync_state';   // { rev, lastHash, lastSyncAt }
  var DEVICE_KEY = 'maermin_device_id';
  var CONFIG_KEY = 'maermin_sync_config';  // { provider, endpoint } (non-secret)

  // ---- small utils ---------------------------------------------------------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'd-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function deviceId() {
    var id = lsGet(DEVICE_KEY);
    if (!id) { id = uuid(); lsSet(DEVICE_KEY, id); }
    return id;
  }

  // Stable, fast content hash (FNV-1a) for change detection (not security).
  function contentHash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function loadState() {
    try { return JSON.parse(lsGet(STATE_KEY) || '{"rev":0,"lastHash":null,"lastSyncAt":0}'); }
    catch (e) { return { rev: 0, lastHash: null, lastSyncAt: 0 }; }
  }
  function saveState(s) { lsSet(STATE_KEY, JSON.stringify(s)); }

  // ---- account id (zero-knowledge) ----------------------------------------
  function bytesToHex(buf) {
    var b = new Uint8Array(buf), out = '';
    for (var i = 0; i < b.length; i++) out += ('0' + b[i].toString(16)).slice(-2);
    return out;
  }
  function accountId() {
    if (!Vault || !Vault.isUnlocked()) return Promise.reject(new Error('locked'));
    return Vault.deriveSubKey('sync-account').then(function (bits) {
      // bits is an ArrayBuffer(32). The account id is its hex — opaque to server.
      return bytesToHex(bits).slice(0, 32);
    });
  }

  // ---- write authorization (HMAC proof of vault possession) ----------------
  // The sync blob is zero-knowledge ciphertext, but the WorkerTransport's writes
  // are authenticated so a third party who learns the opaque account id cannot
  // overwrite/wipe a vault. authKey = HKDF(vaultKey,'sync-auth') — independent of
  // the data key, deterministic across a user's devices. Everything here is
  // best-effort: if the vault/WebCrypto is unavailable it resolves to null and
  // the client simply sends no auth (legacy/open behaviour), so it never breaks
  // sync or the in-memory test transport.
  function hexToBytes(hex) {
    var s = String(hex || ''); var out = new Uint8Array(s.length >> 1);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  function authKeyHex() {
    if (!Vault || !Vault.isUnlocked() || typeof Vault.deriveSubKey !== 'function') return Promise.resolve(null);
    return Vault.deriveSubKey('sync-auth').then(function (bits) { return bytesToHex(bits); }, function () { return null; });
  }
  function syncMac(keyHex, account, baseRev, blob) {
    if (!keyHex || typeof crypto === 'undefined' || !crypto.subtle) return Promise.resolve(null);
    return crypto.subtle.importKey('raw', hexToBytes(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (k) { return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(account + '.' + baseRev + '.' + blob)); })
      .then(function (sig) { return bytesToHex(sig); }, function () { return null; });
  }
  // Build the { mac, key? } auth object. `key` (for TOFU registration) is only
  // included when `register` is set (account creation), so the raw key is sent
  // at most once.
  function buildAuth(account, baseRev, blob, register) {
    return authKeyHex().then(function (ak) {
      if (!ak) return null;
      return syncMac(ak, account, baseRev, blob).then(function (mac) {
        var auth = {};
        if (mac) auth.mac = mac;
        if (register) auth.key = ak;
        return (auth.mac || auth.key) ? auth : null;
      });
    }, function () { return null; });
  }

  // ---- snapshot / blob -----------------------------------------------------
  // The plaintext snapshot we sync = the sensitive data keys. We wrap it with a
  // payload envelope carrying updatedAt + deviceId so merges can reason about it.
  function buildSnapshot() {
    var data = Storage && Storage.snapshotPlaintext ? Storage.snapshotPlaintext() : {};
    return { v: 1, updatedAt: Date.now(), device: deviceId(), data: data };
  }
  function snapshotHash(snapshot) {
    return contentHash(JSON.stringify(snapshot.data || {}));
  }
  function encryptSnapshot(snapshot) {
    if (!Vault || !Vault.isUnlocked()) return Promise.reject(new Error('locked'));
    return Vault.encryptJSON(snapshot);
  }
  function decryptBlob(blob) {
    return Vault.decryptJSON(blob);
  }

  // ---- merge / conflict resolution ----------------------------------------
  // Returns { merged: snapshot, conflicts: [...] }. Transactions are unioned by
  // identity so no entry is ever dropped; other keys take the newer side.
  function txIdentity(tx) {
    if (tx && tx.id != null) return 'id:' + tx.id;
    // Fall back to a content fingerprint of the defining fields.
    return 'f:' + contentHash(JSON.stringify([
      tx && tx.symbol, tx && tx.category, tx && tx.type,
      tx && tx.quantity, tx && tx.price, tx && tx.date, tx && tx.portfolioId
    ]));
  }
  function parseArray(jsonStr) {
    try { var a = JSON.parse(jsonStr); return Array.isArray(a) ? a : null; } catch (e) { return null; }
  }
  function unionTransactions(localStr, remoteStr) {
    var local = parseArray(localStr) || [];
    var remote = parseArray(remoteStr) || [];
    var seen = {}, out = [];
    local.concat(remote).forEach(function (tx) {
      var key = txIdentity(tx);
      if (!seen[key]) { seen[key] = true; out.push(tx); }
    });
    return { str: JSON.stringify(out), added: out.length - local.length };
  }

  function mergeSnapshots(localSnap, remoteSnap) {
    var conflicts = [];
    var localData = (localSnap && localSnap.data) || {};
    var remoteData = (remoteSnap && remoteSnap.data) || {};
    var remoteNewer = (remoteSnap.updatedAt || 0) >= (localSnap.updatedAt || 0);
    var mergedData = {};

    var keys = {};
    Object.keys(localData).forEach(function (k) { keys[k] = true; });
    Object.keys(remoteData).forEach(function (k) { keys[k] = true; });

    Object.keys(keys).forEach(function (k) {
      var lv = localData[k], rv = remoteData[k];
      if (lv === undefined) { mergedData[k] = rv; return; }
      if (rv === undefined) { mergedData[k] = lv; return; }
      if (lv === rv) { mergedData[k] = lv; return; }

      if (k === 'transactions') {
        var u = unionTransactions(lv, rv);
        mergedData[k] = u.str;
        conflicts.push({ key: k, resolution: 'union', addedFromRemote: u.added });
      } else {
        // last-write-wins by blob timestamp
        mergedData[k] = remoteNewer ? rv : lv;
        conflicts.push({ key: k, resolution: remoteNewer ? 'remote' : 'local' });
      }
    });

    return {
      merged: { v: 1, updatedAt: Date.now(), device: deviceId(), data: mergedData },
      conflicts: conflicts
    };
  }

  // Apply a snapshot's data back into storage (and live localStorage so the app
  // picks it up). Writes go through the (possibly encrypting) storage shim.
  function applySnapshot(snapshot) {
    var data = (snapshot && snapshot.data) || {};
    Object.keys(data).forEach(function (k) {
      try { localStorage.setItem(k, data[k]); } catch (e) {}
    });
    if (Storage && Storage.flush) Storage.flush();
  }

  // ---- transports ----------------------------------------------------------
  // Each transport: { get(account) -> Promise<{rev, blob}|null>,
  //                   put(account, baseRev, blob) -> Promise<{ok:true,rev}|{conflict:true,serverRev,blob}> }
  function WorkerTransport(opts) {
    opts = opts || {};
    var endpoint = opts.endpoint;
    var fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    function call(body) {
      return fetchImpl(endpoint + (endpoint.indexOf('?') > -1 ? '&' : '?') + 'action=sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      }).then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); });
    }
    return {
      get: function (account) {
        return call({ op: 'get', account: account }).then(function (r) {
          if (r.json && r.json.blob) return { rev: r.json.rev, blob: r.json.blob };
          return null;
        });
      },
      put: function (account, baseRev, blob, auth) {
        var body = { op: 'put', account: account, baseRev: baseRev, blob: blob };
        if (auth) body.auth = auth;
        return call(body).then(function (r) {
          if (r.status === 409) return { conflict: true, serverRev: r.json.serverRev, blob: r.json.blob };
          if (r.status === 403) return { unauthorized: true };
          return { ok: true, rev: r.json.rev };
        });
      }
    };
  }

  // Google Drive appDataFolder — one file per account. tokenProvider() supplies a
  // short-lived OAuth access token (the app handles the OAuth dance separately).
  function DriveTransport(opts) {
    opts = opts || {};
    var tokenProvider = opts.tokenProvider;
    var fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    var FILES = 'https://www.googleapis.com/drive/v3/files';
    var UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
    function fileName(account) { return 'maermin-sync-' + account + '.json'; }
    function auth() { return Promise.resolve(tokenProvider()).then(function (t) { return { Authorization: 'Bearer ' + t }; }); }
    function findFile(account, headers) {
      var q = encodeURIComponent("name='" + fileName(account) + "' and trashed=false");
      return fetchImpl(FILES + '?spaces=appDataFolder&fields=files(id)&q=' + q, { headers: headers })
        .then(function (r) { return r.json(); })
        .then(function (j) { return (j.files && j.files[0] && j.files[0].id) || null; });
    }
    return {
      get: function (account) {
        return auth().then(function (h) {
          return findFile(account, h).then(function (id) {
            if (!id) return null;
            return fetchImpl(FILES + '/' + id + '?alt=media', { headers: h })
              .then(function (r) { return r.json(); })
              .then(function (rec) { return rec && rec.blob ? { rev: rec.rev, blob: rec.blob } : null; });
          });
        });
      },
      put: function (account, baseRev, blob) {
        return auth().then(function (h) {
          return findFile(account, h).then(function (id) {
            var rec = { rev: baseRev + 1, blob: blob, updatedAt: Date.now() };
            var body = JSON.stringify(rec);
            if (id) {
              return fetchImpl(UPLOAD + '/' + id + '?uploadType=media', {
                method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: body
              }).then(function () { return { ok: true, rev: rec.rev }; });
            }
            // create with appDataFolder parent via multipart
            var boundary = 'maermin' + Date.now();
            var meta = JSON.stringify({ name: fileName(account), parents: ['appDataFolder'] });
            var multipart = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
              meta + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + body + '\r\n--' + boundary + '--';
            return fetchImpl(UPLOAD + '?uploadType=multipart', {
              method: 'POST',
              headers: Object.assign({ 'Content-Type': 'multipart/related; boundary=' + boundary }, h),
              body: multipart
            }).then(function () { return { ok: true, rev: rec.rev }; });
          });
        });
      }
    };
  }

  // OneDrive / Microsoft Graph app folder — single file per account.
  function OneDriveTransport(opts) {
    opts = opts || {};
    var tokenProvider = opts.tokenProvider;
    var fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    var ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/';
    function path(account) { return ROOT + 'maermin-sync-' + account + '.json'; }
    function auth() { return Promise.resolve(tokenProvider()).then(function (t) { return { Authorization: 'Bearer ' + t }; }); }
    return {
      get: function (account) {
        return auth().then(function (h) {
          return fetchImpl(path(account) + ':/content', { headers: h }).then(function (r) {
            if (r.status === 404) return null;
            return r.json().then(function (rec) { return rec && rec.blob ? { rev: rec.rev, blob: rec.blob } : null; });
          });
        });
      },
      put: function (account, baseRev, blob) {
        return auth().then(function (h) {
          var rec = { rev: baseRev + 1, blob: blob, updatedAt: Date.now() };
          return fetchImpl(path(account) + ':/content', {
            method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: JSON.stringify(rec)
          }).then(function () { return { ok: true, rev: rec.rev }; });
        });
      }
    };
  }

  // ---- orchestration -------------------------------------------------------
  var _transport = null;
  var _syncing = false;
  var _listeners = [];
  function onChange(cb) { if (typeof cb === 'function') _listeners.push(cb); }
  function emit(ev) { _listeners.forEach(function (cb) { try { cb(ev); } catch (e) {} }); }

  function configure(cfg) {
    cfg = cfg || {};
    if (cfg.provider === 'worker') _transport = WorkerTransport(cfg);
    else if (cfg.provider === 'drive') _transport = DriveTransport(cfg);
    else if (cfg.provider === 'onedrive') _transport = OneDriveTransport(cfg);
    else if (cfg.transport) _transport = cfg.transport; // injected (tests / custom)
    if (cfg.provider) lsSet(CONFIG_KEY, JSON.stringify({ provider: cfg.provider, endpoint: cfg.endpoint || null }));
    return _transport;
  }
  function isConfigured() { return !!_transport; }
  function getConfig() { try { return JSON.parse(lsGet(CONFIG_KEY) || 'null'); } catch (e) { return null; } }

  // Full sync: pull remote → merge with local → push merged. Rev-safe.
  function sync() {
    if (!_transport) return Promise.reject(new Error('not-configured'));
    if (!Vault || !Vault.isUnlocked()) return Promise.reject(new Error('locked'));
    if (_syncing) return Promise.resolve({ skipped: true });
    _syncing = true;
    emit({ type: 'start' });

    var state = loadState();
    var localSnap = buildSnapshot();

    return accountId().then(function (account) {
      return _transport.get(account).then(function (remote) {
        var pipeline;
        if (!remote) {
          // First push — nothing remote yet. Register the write-auth key (TOFU)
          // so this account is protected from creation onward.
          pipeline = pushSnapshot(account, state.rev, localSnap, [], true);
        } else {
          return decryptBlob(remote.blob).then(function (remoteSnap) {
            var localHash = snapshotHash(localSnap);
            var remoteHash = snapshotHash(remoteSnap);
            if (localHash === remoteHash) {
              // identical content — just align rev locally, no write.
              state.rev = remote.rev; state.lastHash = localHash; state.lastSyncAt = Date.now();
              saveState(state);
              return { ok: true, unchanged: true, rev: remote.rev };
            }
            var m = mergeSnapshots(localSnap, remoteSnap);
            applySnapshot(m.merged);
            return pushSnapshot(account, remote.rev, m.merged, m.conflicts);
          });
        }
        return pipeline;
      });
    }).then(function (result) {
      _syncing = false; emit({ type: 'done', result: result });
      return result;
    }).catch(function (e) {
      _syncing = false; emit({ type: 'error', error: e });
      throw e;
    });
  }

  function pushSnapshot(account, baseRev, snapshot, conflicts, register) {
    return encryptSnapshot(snapshot).then(function (blob) {
      return buildAuth(account, baseRev, blob, !!register).then(function (auth) {
        return _transport.put(account, baseRev, blob, auth).then(function (r) {
          if (r && r.conflict) {
            // Another device wrote between our get and put — merge again and retry once.
            return decryptBlob(r.blob).then(function (serverSnap) {
              var m = mergeSnapshots(snapshot, serverSnap);
              applySnapshot(m.merged);
              return encryptSnapshot(m.merged).then(function (blob2) {
                // Retry against the server's rev — the account already exists, so
                // prove possession with a MAC (no key registration this time).
                return buildAuth(account, r.serverRev, blob2, false).then(function (auth2) {
                  return _transport.put(account, r.serverRev, blob2, auth2).then(function (r2) {
                    if (r2 && r2.unauthorized) throw new Error('sync-unauthorized');
                    var st = loadState();
                    st.rev = r2.rev; st.lastHash = snapshotHash(m.merged); st.lastSyncAt = Date.now();
                    saveState(st);
                    return { ok: true, rev: r2.rev, conflicts: conflicts.concat(m.conflicts), retried: true };
                  });
                });
              });
            });
          }
          if (r && r.unauthorized) throw new Error('sync-unauthorized');
          var state = loadState();
          state.rev = r.rev; state.lastHash = snapshotHash(snapshot); state.lastSyncAt = Date.now();
          saveState(state);
          return { ok: true, rev: r.rev, conflicts: conflicts };
        });
      });
    });
  }

  function hasLocalChanges() {
    var state = loadState();
    return snapshotHash(buildSnapshot()) !== state.lastHash;
  }

  // ---- auto-sync wiring ----------------------------------------------------
  var _autoBound = false;
  function enableAutoSync() {
    if (_autoBound || typeof window === 'undefined') return;
    _autoBound = true;
    var debounced = null;
    function schedule() {
      if (!isConfigured() || !Vault || !Vault.isUnlocked()) return;
      if (debounced) clearTimeout(debounced);
      debounced = setTimeout(function () { sync().catch(function () {}); }, 4000);
    }
    window.addEventListener('online', schedule);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && hasLocalChanges()) {
          if (window.MaerminPWA && window.MaerminPWA.requestBackgroundSync) {
            window.MaerminPWA.requestBackgroundSync('maermin-sync');
          }
          sync().catch(function () {});
        }
      });
    }
    if (window.MaerminPWA && window.MaerminPWA.on) {
      window.MaerminPWA.on('sync', function (tag) { if (tag === 'maermin-sync') sync().catch(function () {}); });
    }
    return schedule;
  }

  var api = {
    // config
    configure: configure, isConfigured: isConfigured, getConfig: getConfig,
    // transports (exported for custom wiring / tests)
    WorkerTransport: WorkerTransport, DriveTransport: DriveTransport, OneDriveTransport: OneDriveTransport,
    // ops
    sync: sync, hasLocalChanges: hasLocalChanges, getState: loadState, deviceId: deviceId,
    accountId: accountId, enableAutoSync: enableAutoSync, onChange: onChange,
    // pure core (tested)
    buildSnapshot: buildSnapshot, snapshotHash: snapshotHash, mergeSnapshots: mergeSnapshots,
    unionTransactions: unionTransactions, contentHash: contentHash,
    STATE_KEY: STATE_KEY
  };

  if (typeof window !== 'undefined') window.MaerminSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
