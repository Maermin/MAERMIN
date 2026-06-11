// ============================================================================
// MAERMIN — Crypto Vault  (window.MaerminVault)
// ----------------------------------------------------------------------------
// The cryptographic foundation for Epic 4 (Security Upgrade) and Epic 1
// (E2E cloud sync). Pure WebCrypto — no bundler, no CDN, CSP-clean. Follows
// the same self-contained-IIFE-on-window pattern as every other module.
//
// What it provides
//   - Password-derived 256-bit key:
//       * Argon2id  when a WASM provider is registered (registerKdf), else
//       * PBKDF2-SHA-256 @ 600k iterations (OWASP 2023 baseline) — the
//         shipped default; strong, dependency-free, works under the locked CSP.
//   - AES-256-GCM authenticated encryption (tamper-evident).
//   - A "wrap check" so a wrong password is rejected without ever storing the
//     password or its hash (replaces the SHA-256 secret in auth.js).
//   - Idle auto-lock that wipes the key from memory.
//   - Passkey-ready API (enrollPasskey / unlockWithPasskey) using the WebAuthn
//     PRF extension as progressive enhancement — no-ops when unsupported.
//
// It stores NOTHING by itself except a small plaintext meta record
//   localStorage["maermin_vault_meta"]  = { v, kdf, params, salt, wrapCheck, ... }
// The in-memory key never touches storage. Persisting encrypted DATA is the
// job of storage.js (window.MaerminStorage); syncing it is sync-engine.js.
//
// Testable under Node 18+ (globalThis.crypto.subtle); UI-free.
// ============================================================================
(function () {
  'use strict';

  var subtle = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  var getRandom = (typeof crypto !== 'undefined' && crypto.getRandomValues)
    ? function (a) { return crypto.getRandomValues(a); }
    : null;

  var META_KEY = 'maermin_vault_meta';
  var WRAP_CHECK_PLAINTEXT = 'maermin-vault-ok-v1';

  // ---- base64 / bytes helpers (browser + Node) -----------------------------
  function b64encode(bytes) {
    if (typeof btoa === 'function') {
      var bin = '';
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    return Buffer.from(bytes).toString('base64'); // Node fallback
  }
  function b64decode(str) {
    if (typeof atob === 'function') {
      var bin = atob(str);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(str, 'base64')); // Node fallback
  }
  function utf8(str) { return new TextEncoder().encode(str); }
  function fromUtf8(bytes) { return new TextDecoder().decode(bytes); }

  // ---- KDF registry --------------------------------------------------------
  // A KDF fn:  async (password:string, salt:Uint8Array, params) -> Uint8Array(32)
  // PBKDF2 is always available. Argon2id can be registered once a WASM provider
  // (e.g. argon2-browser) is loaded — meta records which KDF made the key so
  // unlock always re-derives with the matching algorithm.
  var KDFS = {};
  var DEFAULT_KDF = 'pbkdf2';

  KDFS.pbkdf2 = {
    defaultParams: function () { return { iterations: 600000, hash: 'SHA-256' }; },
    derive: function (password, salt, params) {
      params = params || KDFS.pbkdf2.defaultParams();
      return subtle.importKey('raw', utf8(password), { name: 'PBKDF2' }, false, ['deriveBits'])
        .then(function (baseKey) {
          return subtle.deriveBits({
            name: 'PBKDF2',
            salt: salt,
            iterations: params.iterations,
            hash: params.hash || 'SHA-256'
          }, baseKey, 256);
        })
        .then(function (bits) { return new Uint8Array(bits); });
    }
  };

  function registerKdf(name, impl) {
    // impl: { defaultParams: ()=>obj, derive: (password,salt,params)=>Promise<Uint8Array(32)> }
    if (!name || !impl || typeof impl.derive !== 'function') return;
    KDFS[name] = impl;
    DEFAULT_KDF = name; // prefer the strongest registered KDF for NEW vaults
  }

  // Convenience: if a global argon2 (argon2-browser API) is present at load,
  // register it as argon2id automatically. Untestable here, so fully guarded.
  function tryAutoRegisterArgon2() {
    var a2 = (typeof window !== 'undefined') && window.argon2;
    if (!a2 || typeof a2.hash !== 'function' || !a2.ArgonType) return;
    registerKdf('argon2id', {
      defaultParams: function () { return { time: 3, mem: 65536, parallelism: 1 }; },
      derive: function (password, salt, params) {
        params = params || this.defaultParams();
        return a2.hash({
          pass: password, salt: salt,
          time: params.time, mem: params.mem, parallelism: params.parallelism,
          hashLen: 32, type: a2.ArgonType.Argon2id
        }).then(function (res) { return new Uint8Array(res.hash); });
      }
    });
  }

  // ---- in-memory key state -------------------------------------------------
  var _key = null;        // CryptoKey (AES-GCM) — never serialized
  var _rawKey = null;     // Uint8Array(32) — kept for HMAC/sync key derivation
  var _kdfName = null;

  function isSupported() { return !!(subtle && getRandom); }
  function isUnlocked() { return !!_key; }

  function importAesKey(rawBytes) {
    return subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  // ---- meta ----------------------------------------------------------------
  function readMeta() {
    if (typeof localStorage === 'undefined') return null;
    try {
      var raw = localStorage.getItem(META_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeMeta(meta) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }
  function hasVault() { return !!readMeta(); }
  function getMeta() {
    var m = readMeta();
    if (!m) return null;
    // Never leak the wrapCheck shape beyond what callers need.
    return { v: m.v, kdf: m.kdf, params: m.params, createdAt: m.createdAt,
             updatedAt: m.updatedAt, autoLockMs: m.autoLockMs, hasPasskey: !!m.passkey,
             hasRecovery: !!m.recovery };
  }

  // ---- low-level AES-GCM ---------------------------------------------------
  // Envelope string: "1." + b64(iv) + "." + b64(ciphertext). Versioned so the
  // format can evolve without ambiguity.
  function encryptWith(key, plaintextStr) {
    var iv = getRandom(new Uint8Array(12));
    return subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, utf8(plaintextStr))
      .then(function (ct) {
        return '1.' + b64encode(iv) + '.' + b64encode(new Uint8Array(ct));
      });
  }
  function decryptWith(key, envelope) {
    var parts = String(envelope).split('.');
    if (parts.length !== 3 || parts[0] !== '1') {
      return Promise.reject(new Error('bad-envelope'));
    }
    var iv = b64decode(parts[1]);
    var ct = b64decode(parts[2]);
    return subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct)
      .then(function (buf) { return fromUtf8(new Uint8Array(buf)); });
  }

  // ---- public crypto (use the unlocked in-memory key) ----------------------
  function encrypt(plaintextStr) {
    if (!_key) return Promise.reject(new Error('locked'));
    return encryptWith(_key, plaintextStr);
  }
  function decrypt(envelope) {
    if (!_key) return Promise.reject(new Error('locked'));
    return decryptWith(_key, envelope);
  }
  function encryptJSON(obj) { return encrypt(JSON.stringify(obj)); }
  function decryptJSON(envelope) { return decrypt(envelope).then(function (s) { return JSON.parse(s); }); }

  // Separate key for sync integrity (HMAC) / Drive blobs, derived from the raw
  // key so we never reuse the AES key directly for MAC. Available while unlocked.
  function deriveSubKey(infoLabel, usages) {
    if (!_rawKey) return Promise.reject(new Error('locked'));
    return subtle.importKey('raw', _rawKey, { name: 'HKDF' }, false, ['deriveBits'])
      .then(function (hk) {
        return subtle.deriveBits({
          name: 'HKDF', hash: 'SHA-256',
          salt: utf8('maermin-vault'), info: utf8(infoLabel)
        }, hk, 256);
      });
  }

  // ---- lifecycle -----------------------------------------------------------
  // Create a brand-new vault for `password`. Generates salt + a wrapCheck token
  // (an AES-GCM ciphertext of a known plaintext). NEW vaults use DEFAULT_KDF
  // (argon2id when registered, else pbkdf2).
  function create(password, opts) {
    opts = opts || {};
    if (!isSupported()) return Promise.reject(new Error('crypto-unsupported'));
    if (!password) return Promise.reject(new Error('empty-password'));
    var kdfName = opts.kdf || DEFAULT_KDF;
    var kdf = KDFS[kdfName] || KDFS.pbkdf2;
    var params = opts.params || kdf.defaultParams();
    var salt = getRandom(new Uint8Array(16));

    return kdf.derive(password, salt, params)
      .then(function (rawKey) { return importAesKey(rawKey).then(function (k) { return { rawKey: rawKey, key: k }; }); })
      .then(function (pair) {
        return encryptWith(pair.key, WRAP_CHECK_PLAINTEXT).then(function (wrapCheck) {
          var meta = {
            v: 1,
            kdf: kdfName,
            params: params,
            salt: b64encode(salt),
            wrapCheck: wrapCheck,
            autoLockMs: typeof opts.autoLockMs === 'number' ? opts.autoLockMs : 15 * 60 * 1000,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          writeMeta(meta);
          _key = pair.key; _rawKey = pair.rawKey; _kdfName = kdfName;
          startAutoLock(meta.autoLockMs);
          return true;
        });
      });
  }

  // Unlock an existing vault: re-derive with the meta's KDF+salt and verify by
  // decrypting the wrapCheck. Wrong password → AES-GCM auth fails → 'bad-password'.
  function unlock(password) {
    if (!isSupported()) return Promise.reject(new Error('crypto-unsupported'));
    var meta = readMeta();
    if (!meta) return Promise.reject(new Error('no-vault'));
    var kdf = KDFS[meta.kdf] || KDFS.pbkdf2;
    var salt = b64decode(meta.salt);

    return kdf.derive(password, salt, meta.params)
      .then(function (rawKey) { return importAesKey(rawKey).then(function (k) { return { rawKey: rawKey, key: k }; }); })
      .then(function (pair) {
        return decryptWith(pair.key, meta.wrapCheck)
          .then(function (plain) {
            if (plain !== WRAP_CHECK_PLAINTEXT) throw new Error('bad-password');
            _key = pair.key; _rawKey = pair.rawKey; _kdfName = meta.kdf;
            startAutoLock(meta.autoLockMs);
            return true;
          })
          .catch(function () { throw new Error('bad-password'); });
      });
  }

  // Re-key the vault to a new password without re-encrypting data: callers that
  // store data re-encrypt their blob with the new key (storage.js handles this
  // via the change-password flow). Returns the OLD raw key so data can be moved.
  function changePassword(oldPassword, newPassword, opts) {
    return unlock(oldPassword).then(function () {
      return create(newPassword, opts).then(function () { return true; });
    });
  }

  function lock() {
    _key = null; _rawKey = null; _kdfName = null;
    stopAutoLock();
    fireLock();
  }

  // ---- idle auto-lock ------------------------------------------------------
  var _lockTimer = null;
  var _autoLockMs = 15 * 60 * 1000;
  var _lockListeners = [];
  var _activityBound = false;

  function onLock(cb) { if (typeof cb === 'function') _lockListeners.push(cb); }
  function fireLock() { _lockListeners.forEach(function (cb) { try { cb(); } catch (e) {} }); }

  function touch() {
    if (!_key || !_autoLockMs) return;
    if (_lockTimer) clearTimeout(_lockTimer);
    _lockTimer = setTimeout(function () { lock(); }, _autoLockMs);
  }
  function startAutoLock(ms) {
    _autoLockMs = typeof ms === 'number' ? ms : _autoLockMs;
    if (typeof document === 'undefined') return; // Node / headless
    if (!_activityBound) {
      ['mousedown', 'keydown', 'touchstart', 'visibilitychange'].forEach(function (ev) {
        document.addEventListener(ev, touch, { passive: true });
      });
      _activityBound = true;
    }
    touch();
  }
  function stopAutoLock() { if (_lockTimer) { clearTimeout(_lockTimer); _lockTimer = null; } }
  function configureAutoLock(ms) {
    _autoLockMs = ms;
    var meta = readMeta();
    if (meta) { meta.autoLockMs = ms; meta.updatedAt = Date.now(); writeMeta(meta); }
    if (_key) touch();
  }

  // ---- passkeys (progressive enhancement) ----------------------------------
  // Uses WebAuthn + the PRF extension to obtain a stable 32-byte secret bound to
  // a platform authenticator (Touch ID / Windows Hello / phone). That secret
  // wraps the vault key so the user can unlock with a passkey instead of (or in
  // addition to) the password. No PRF support → resolves {supported:false} and
  // the password path is unaffected.
  function passkeySupported() {
    return typeof window !== 'undefined' &&
           !!window.PublicKeyCredential &&
           typeof navigator !== 'undefined' && !!navigator.credentials;
  }

  function enrollPasskey(userLabel) {
    if (!passkeySupported()) return Promise.resolve({ supported: false });
    if (!_rawKey) return Promise.reject(new Error('locked'));
    var meta = readMeta();
    if (!meta) return Promise.reject(new Error('no-vault'));
    var challenge = getRandom(new Uint8Array(32));
    var userId = getRandom(new Uint8Array(16));
    var prfSalt = getRandom(new Uint8Array(32));
    return navigator.credentials.create({
      publicKey: {
        challenge: challenge,
        rp: { name: 'MAERMIN' },
        user: { id: userId, name: userLabel || 'maermin', displayName: userLabel || 'MAERMIN' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
        extensions: { prf: { eval: { first: prfSalt } } }
      }
    }).then(function (cred) {
      var ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
      var prf = ext && ext.prf && ext.prf.results && ext.prf.results.first;
      if (!prf) return { supported: false }; // authenticator has no PRF
      // Wrap the raw vault key with a key derived from the PRF output.
      return importAesKey(new Uint8Array(prf)).then(function (wrapKey) {
        return encryptWith(wrapKey, b64encode(_rawKey)).then(function (wrapped) {
          meta.passkey = {
            credId: b64encode(new Uint8Array(cred.rawId)),
            prfSalt: b64encode(prfSalt),
            wrappedKey: wrapped
          };
          meta.updatedAt = Date.now();
          writeMeta(meta);
          return { supported: true, enrolled: true };
        });
      });
    });
  }

  function unlockWithPasskey() {
    if (!passkeySupported()) return Promise.reject(new Error('passkey-unsupported'));
    var meta = readMeta();
    if (!meta || !meta.passkey) return Promise.reject(new Error('no-passkey'));
    var pk = meta.passkey;
    return navigator.credentials.get({
      publicKey: {
        challenge: getRandom(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: b64decode(pk.credId) }],
        userVerification: 'preferred',
        extensions: { prf: { eval: { first: b64decode(pk.prfSalt) } } }
      }
    }).then(function (assertion) {
      var ext = assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {};
      var prf = ext && ext.prf && ext.prf.results && ext.prf.results.first;
      if (!prf) throw new Error('passkey-no-prf');
      return importAesKey(new Uint8Array(prf)).then(function (wrapKey) {
        return decryptWith(wrapKey, pk.wrappedKey).then(function (rawB64) {
          var rawKey = b64decode(rawB64);
          return importAesKey(rawKey).then(function (k) {
            _key = k; _rawKey = rawKey; _kdfName = meta.kdf;
            startAutoLock(meta.autoLockMs);
            return true;
          });
        });
      });
    });
  }

  // ---- recovery kit (alternative unlock) -----------------------------------
  // A printable recovery code is a SECOND wrapping of the vault key — the same
  // mechanism as a passkey, but the wrap key is derived (PBKDF2) from a single
  // high-entropy code the user stores offline. The code is shown exactly ONCE
  // and is NEVER persisted or transmitted; only the wrapped key + its salt live
  // in meta. This gives a real recovery path for a forgotten password without
  // weakening the zero-knowledge model (server/meta never see plaintext key).
  //
  // Like passkeys, the recovery wrap is bound to the CURRENT raw key, so a
  // password change (which re-keys the vault via create()) invalidates it — the
  // UI re-prompts the user to generate a fresh kit afterwards.
  var RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // base32, no 0/1/I/O

  // 15 random bytes (120 bits) → 24 base32 chars, no padding.
  function base32encode(bytes) {
    var bits = 0, value = 0, out = '';
    for (var i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) { bits -= 5; out += RECOVERY_ALPHABET[(value >>> bits) & 31]; }
      value &= (1 << bits) - 1; // drop consumed high bits → no 32-bit overflow
    }
    if (bits > 0) out += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }
  // Group into 4-char blocks for legibility: XXXX-XXXX-…
  function formatRecoveryCode(code) {
    return (code.match(/.{1,4}/g) || [code]).join('-');
  }
  // Canonicalise any user input back to the exact KDF string (case + separators).
  function normalizeRecoveryCode(s) {
    var up = String(s || '').toUpperCase(), out = '';
    for (var i = 0; i < up.length; i++) {
      if (RECOVERY_ALPHABET.indexOf(up[i]) > -1) out += up[i];
    }
    return out;
  }

  function deriveRecoveryWrapKey(code, salt, kdfName, params) {
    var kdf = KDFS[kdfName] || KDFS.pbkdf2;
    return kdf.derive(code, salt, params).then(function (raw) { return importAesKey(raw); });
  }

  // Generate + store a recovery kit for the unlocked vault. Resolves with the
  // one-time code (formatted for display) — the caller must surface it then drop
  // it; it is not recoverable afterwards.
  function enrollRecovery() {
    if (!isSupported()) return Promise.reject(new Error('crypto-unsupported'));
    if (!_rawKey) return Promise.reject(new Error('locked'));
    var meta = readMeta();
    if (!meta) return Promise.reject(new Error('no-vault'));
    var code = base32encode(getRandom(new Uint8Array(15)));
    var salt = getRandom(new Uint8Array(16));
    var params = KDFS.pbkdf2.defaultParams(); // always-available + portable (Node tests)
    return deriveRecoveryWrapKey(code, salt, 'pbkdf2', params).then(function (wrapKey) {
      return encryptWith(wrapKey, b64encode(_rawKey)).then(function (wrapped) {
        meta.recovery = {
          kdf: 'pbkdf2', params: params, salt: b64encode(salt),
          wrappedKey: wrapped, createdAt: Date.now()
        };
        meta.updatedAt = Date.now();
        writeMeta(meta);
        return { code: formatRecoveryCode(code), createdAt: meta.recovery.createdAt };
      });
    });
  }

  function unlockWithRecovery(inputCode) {
    if (!isSupported()) return Promise.reject(new Error('crypto-unsupported'));
    var meta = readMeta();
    if (!meta || !meta.recovery) return Promise.reject(new Error('no-recovery'));
    var rec = meta.recovery;
    var code = normalizeRecoveryCode(inputCode);
    if (!code) return Promise.reject(new Error('bad-recovery-code'));
    return deriveRecoveryWrapKey(code, b64decode(rec.salt), rec.kdf, rec.params).then(function (wrapKey) {
      return decryptWith(wrapKey, rec.wrappedKey)
        .then(function (rawB64) {
          var rawKey = b64decode(rawB64);
          return importAesKey(rawKey).then(function (k) {
            _key = k; _rawKey = rawKey; _kdfName = meta.kdf;
            startAutoLock(meta.autoLockMs);
            return true;
          });
        })
        .catch(function () { throw new Error('bad-recovery-code'); });
    });
  }

  function hasRecovery() { var m = readMeta(); return !!(m && m.recovery); }
  function removeRecovery() {
    var m = readMeta();
    if (!m || !m.recovery) return false;
    delete m.recovery; m.updatedAt = Date.now(); writeMeta(m);
    return true;
  }

  tryAutoRegisterArgon2();

  var api = {
    // capability
    isSupported: isSupported,
    isUnlocked: isUnlocked,
    hasVault: hasVault,
    getMeta: getMeta,
    // kdf
    registerKdf: registerKdf,
    kdfName: function () { return _kdfName; },
    availableKdfs: function () { return Object.keys(KDFS); },
    // lifecycle
    create: create,
    unlock: unlock,
    changePassword: changePassword,
    lock: lock,
    // crypto
    encrypt: encrypt,
    decrypt: decrypt,
    encryptJSON: encryptJSON,
    decryptJSON: decryptJSON,
    deriveSubKey: deriveSubKey,
    // auto-lock
    configureAutoLock: configureAutoLock,
    touch: touch,
    onLock: onLock,
    // passkeys
    passkeySupported: passkeySupported,
    enrollPasskey: enrollPasskey,
    unlockWithPasskey: unlockWithPasskey,
    // recovery kit (alternative unlock via printable code)
    enrollRecovery: enrollRecovery,
    unlockWithRecovery: unlockWithRecovery,
    hasRecovery: hasRecovery,
    removeRecovery: removeRecovery,
    // constants (for storage.js / tests)
    META_KEY: META_KEY
  };

  if (typeof window !== 'undefined') window.MaerminVault = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
