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

  // SEC-004: KDF name and parameters come from stored or imported meta, so
  // they are checked before use: only registered KDFs (own entries, never an
  // inherited name), PBKDF2 with 600k-10M iterations and SHA-256/512, Argon2id
  // within sane bounds. Every vault ever created used PBKDF2 600k / SHA-256.
  var PBKDF2_MIN = 600000, PBKDF2_MAX = 10000000;
  function kdfImpl(name) { return (typeof name === 'string' && Object.prototype.hasOwnProperty.call(KDFS, name)) ? KDFS[name] : null; }
  function isInt(x, lo, hi) { return typeof x === 'number' && Math.floor(x) === x && x >= lo && x <= hi; }
  function validKdfParams(name, p) {
    if (!p || typeof p !== 'object') return false;
    // A KDF registered in code (registerKdf) may define its own parameter rule.
    var impl = kdfImpl(name);
    if (impl && name !== 'pbkdf2' && typeof impl.validParams === 'function') return !!impl.validParams(p);
    if (name === 'pbkdf2') return isInt(p.iterations, PBKDF2_MIN, PBKDF2_MAX) && (p.hash === undefined || p.hash === 'SHA-256' || p.hash === 'SHA-512');
    if (name === 'argon2id') return isInt(p.time, 1, 20) && isInt(p.mem, 16384, 4194304) && isInt(p.parallelism, 1, 16);
    return false;
  }
  function checkedKdf(name, params) { var k = kdfImpl(name); return (k && validKdfParams(name, params)) ? k : null; }
  function isB64(s, minLen) { return typeof s === 'string' && s.length >= (minLen || 1) && s.length <= 100000 && /^[A-Za-z0-9+/=.]+$/.test(s); }
  // Structure check of a vault meta record (stored, or from an imported backup).
  function validateMeta(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, error: 'not-an-object' };
    if (m.v !== 1 && m.v !== 2) return { ok: false, error: 'unknown-version' };
    if (!checkedKdf(m.kdf, m.params)) return { ok: false, error: 'unsupported-kdf' };
    if (!isB64(m.salt, 16) || !isB64(m.wrapCheck, 20)) return { ok: false, error: 'bad-salt-or-check' };
    if (m.v === 2 && !isB64(m.pwWrap, 20)) return { ok: false, error: 'bad-password-wrap' };
    // The recovery and passkey wraps are checked fully when they are used; a
    // damaged one must never stop the password from opening the vault.
    var opt = [m.recovery, m.recoveryPending, m.passkey];
    for (var i = 0; i < opt.length; i++) {
      if (opt[i] != null && (typeof opt[i] !== 'object' || typeof opt[i].wrappedKey !== 'string')) return { ok: false, error: 'bad-credential-wrap' };
    }
    return { ok: true };
  }
  // Run a KDF as a promise (an implementation that throws synchronously must
  // not escape the promise chain - the unlock screen would never stop loading).
  function derive(kdf, password, salt, params) {
    return new Promise(function (resolve) { resolve(kdf.derive(password, salt, params)); });
  }

  function registerKdf(name, impl) {
    // impl: { defaultParams: ()=>obj, derive: (password,salt,params)=>Promise<Uint8Array(32)>,
    //         validParams?: (params)=>boolean }
    if (!name || !impl || typeof impl.derive !== 'function' || name === '__proto__' || name === 'constructor') return;
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
  // Envelope string: "<v>." + b64(iv) + "." + b64(ciphertext).
  //   v1: no associated data (every record before PR 6; still read).
  //   v2: the record's context (e.g. "rec:transactions") is authenticated as
  //       AES-GCM associated data, so a record moved under another name - or
  //       an old copy put back in its place under another name - fails to
  //       decrypt instead of being accepted (SEC-007).
  // opts.strict refuses v1 (for stores already migrated to v2).
  function aadOf(context) { return utf8('maermin:' + String(context)); }
  function encryptWith(key, plaintextStr, context) {
    var iv = getRandom(new Uint8Array(12));
    var alg = { name: 'AES-GCM', iv: iv };
    if (context != null) alg.additionalData = aadOf(context);
    return subtle.encrypt(alg, key, utf8(plaintextStr))
      .then(function (ct) {
        return (context != null ? '2.' : '1.') + b64encode(iv) + '.' + b64encode(new Uint8Array(ct));
      });
  }
  function decryptWith(key, envelope, context, opts) {
    var parts = String(envelope).split('.');
    if (parts.length !== 3 || (parts[0] !== '1' && parts[0] !== '2')) {
      return Promise.reject(new Error('bad-envelope'));
    }
    var alg = { name: 'AES-GCM', iv: b64decode(parts[1]) };
    if (parts[0] === '2') {
      if (context == null) return Promise.reject(new Error('bad-envelope'));
      alg.additionalData = aadOf(context);
    } else if (opts && opts.strict) {
      return Promise.reject(new Error('legacy-envelope'));
    }
    return subtle.decrypt(alg, key, b64decode(parts[2]))
      .then(function (buf) { return fromUtf8(new Uint8Array(buf)); });
  }
  function envelopeVersion(envelope) { var v = String(envelope || '').split('.')[0]; return v === '1' || v === '2' ? Number(v) : 0; }

  // ---- public crypto (use the unlocked in-memory key) ----------------------
  // context (optional): what the record is, bound as associated data (SEC-007).
  function encrypt(plaintextStr, context) {
    if (!_key) return Promise.reject(new Error('locked'));
    return encryptWith(_key, plaintextStr, context);
  }
  function decrypt(envelope, context, opts) {
    if (!_key) return Promise.reject(new Error('locked'));
    return decryptWith(_key, envelope, context, opts);
  }
  function encryptJSON(obj, context) { return encrypt(JSON.stringify(obj), context); }
  function decryptJSON(envelope, context, opts) { return decrypt(envelope, context, opts).then(function (s) { return JSON.parse(s); }); }

  // Separate key for sync integrity (HMAC) / Drive blobs, derived from the raw
  // key so we never reuse the AES key directly for MAC. Available while unlocked.
  function hkdf(raw, infoLabel, saltLabel) {
    return subtle.importKey('raw', raw, { name: 'HKDF' }, false, ['deriveBits'])
      .then(function (hk) {
        return subtle.deriveBits({
          name: 'HKDF', hash: 'SHA-256',
          salt: utf8(saltLabel || 'maermin-vault'), info: utf8(infoLabel)
        }, hk, 256);
      });
  }
  function deriveSubKey(infoLabel, usages) {
    if (!_rawKey) return Promise.reject(new Error('locked'));
    return hkdf(_rawKey, infoLabel);
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
    var params = opts.params || (kdfImpl(kdfName) ? kdfImpl(kdfName).defaultParams() : null);
    var kdf = checkedKdf(kdfName, params);
    if (!kdf) return Promise.reject(new Error('bad-kdf-params'));
    var salt = getRandom(new Uint8Array(16));

    return derive(kdf, password, salt, params)
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
    if (!validateMeta(meta).ok) return Promise.reject(new Error('bad-vault-meta'));
    var kdf = checkedKdf(meta.kdf, meta.params);
    var salt = b64decode(meta.salt);

    return derive(kdf, password, salt, meta.params)
      // v1: the password-derived key IS the data key. v2 (after a password
      // change): it only unwraps the data key stored in meta.pwWrap.
      .then(function (derived) {
        if (!meta.pwWrap) return derived;
        return importAesKey(derived).then(function (kek) { return decryptWith(kek, meta.pwWrap); })
          .then(function (rawB64) { return b64decode(rawB64); });
      })
      .then(function (rawKey) { return importAesKey(rawKey).then(function (k) { return { rawKey: rawKey, key: k }; }); })
      .then(function (pair) {
        return decryptWith(pair.key, meta.wrapCheck)
          .then(function (plain) {
            if (plain !== WRAP_CHECK_PLAINTEXT) throw new Error('bad-password');
            _key = pair.key; _rawKey = pair.rawKey; _kdfName = meta.kdf;
            startAutoLock(meta.autoLockMs);
            return true;
          });
      })
      .catch(function () { throw new Error('bad-password'); });
  }

  // Set a new password for the UNLOCKED vault (also right after a recovery-
  // code or passkey unlock). The data key stays the same; only its password
  // wrapping changes (meta v2: pwWrap = data key encrypted with the new
  // password's key). So stored data, exchange credentials, the passkey and
  // recovery wraps, the auto-lock setting and the sync account (derived from
  // the data key) all keep working - nothing is re-encrypted.
  function setPassword(newPassword, opts) {
    opts = opts || {};
    if (!isSupported()) return Promise.reject(new Error('crypto-unsupported'));
    if (!_rawKey || !_key) return Promise.reject(new Error('locked'));
    if (!newPassword) return Promise.reject(new Error('empty-password'));
    var meta = readMeta();
    if (!meta) return Promise.reject(new Error('no-vault'));
    var kdfName = opts.kdf || DEFAULT_KDF;
    var params = opts.params || (kdfImpl(kdfName) ? kdfImpl(kdfName).defaultParams() : null);
    var kdf = checkedKdf(kdfName, params);
    if (!kdf) return Promise.reject(new Error('bad-kdf-params'));
    var salt = getRandom(new Uint8Array(16));
    var rawKey = _rawKey, dataKey = _key;
    return derive(kdf, newPassword, salt, params)
      .then(function (derived) { return importAesKey(derived); })
      .then(function (kek) { return encryptWith(kek, b64encode(rawKey)); })
      .then(function (pwWrap) {
        return encryptWith(dataKey, WRAP_CHECK_PLAINTEXT).then(function (wrapCheck) {
          var next = Object.assign({}, meta, {
            v: 2, kdf: kdfName, params: params, salt: b64encode(salt),
            pwWrap: pwWrap, wrapCheck: wrapCheck, updatedAt: Date.now()
          });
          writeMeta(next);
          _kdfName = kdfName;
          return true;
        });
      });
  }

  // Change the password: verify the current one, then re-wrap the data key.
  // A wrong current password rejects with 'bad-password' and changes nothing.
  function changePassword(oldPassword, newPassword, opts) {
    return unlock(oldPassword).then(function () {
      return setPassword(newPassword, opts);
    });
  }

  // Check a password against the stored meta without touching the session.
  function verifyPassword(password) {
    var meta = readMeta();
    if (!meta || !validateMeta(meta).ok) return Promise.resolve(false);
    var kdf = checkedKdf(meta.kdf, meta.params);
    return derive(kdf, password, b64decode(meta.salt), meta.params)
      .then(function (derived) {
        if (!meta.pwWrap) return derived;
        return importAesKey(derived).then(function (kek) { return decryptWith(kek, meta.pwWrap); }).then(b64decode);
      })
      .then(importAesKey)
      .then(function (k) { return decryptWith(k, meta.wrapCheck); })
      .then(function (plain) { return plain === WRAP_CHECK_PLAINTEXT; }, function () { return false; });
  }

  // SEC-017: a NEW random data key, so credentials that ever wrapped the old
  // one (an old password, recovery code or passkey, also in old copies of the
  // meta) no longer open what is written from now on. prepareRotation() builds
  // everything without changing the vault: the caller (storage.js) re-encrypts
  // the data with handle.encrypt*, then handle.commit() writes the new meta in
  // ONE localStorage write - the commit point - and switches the session to
  // the new key. The new meta has the password wrap only: the recovery code and
  // the passkey wrapped the old key and are dropped (the UI offers new ones).
  function prepareRotation(password, opts) {
    opts = opts || {};
    if (!isSupported()) return Promise.reject(new Error('crypto-unsupported'));
    if (!_rawKey || !_key) return Promise.reject(new Error('locked'));
    var meta = readMeta();
    if (!meta) return Promise.reject(new Error('no-vault'));
    return verifyPassword(password).then(function (good) {
      if (!good) throw new Error('bad-password');
      var kdfName = opts.kdf || DEFAULT_KDF;
      var params = kdfImpl(kdfName).defaultParams();
      var kdf = checkedKdf(kdfName, params);
      var salt = getRandom(new Uint8Array(16));
      var newRaw = getRandom(new Uint8Array(32));
      return Promise.all([importAesKey(newRaw), derive(kdf, password, salt, params).then(importAesKey)]).then(function (keys) {
        var newKey = keys[0], kek = keys[1];
        return Promise.all([encryptWith(kek, b64encode(newRaw)), encryptWith(newKey, WRAP_CHECK_PLAINTEXT)]).then(function (w) {
          var next = {
            v: 2, kdf: kdfName, params: params, salt: b64encode(salt), pwWrap: w[0], wrapCheck: w[1],
            autoLockMs: meta.autoLockMs, createdAt: meta.createdAt, updatedAt: Date.now(), rotatedAt: Date.now()
          };
          var committed = false;
          return {
            encrypt: function (pt, context) { return encryptWith(newKey, pt, context); },
            encryptJSON: function (obj, context) { return encryptWith(newKey, JSON.stringify(obj), context); },
            decryptJSON: function (env, context) { return decryptWith(newKey, env, context).then(JSON.parse); },
            deriveSubKey: function (label) { return hkdf(newRaw, label); },
            commit: function () {
              if (committed) return false;
              if (!_key) throw new Error('locked');
              writeMeta(next);
              if (_rawKey && _rawKey.fill) _rawKey.fill(0);
              _key = newKey; _rawKey = newRaw; _kdfName = kdfName; committed = true;
              return true;
            }
          };
        });
      });
    });
  }

  // SEC-017: remove the passkey (its wrap of the data key) from this vault.
  function removePasskey() {
    var m = readMeta();
    if (!m || !m.passkey) return false;
    delete m.passkey; m.updatedAt = Date.now(); writeMeta(m);
    return true;
  }

  function lock() {
    stopAutoLock();
    // Listeners run BEFORE the key is wiped so storage.js's final flush can
    // start its (synchronous) encrypt calls with the key still available.
    _lockSettled = fireLock();
    // SEC-028: overwrite the key bytes instead of only dropping the reference.
    if (_rawKey && _rawKey.fill) _rawKey.fill(0);
    _key = null; _rawKey = null; _kdfName = null;
  }
  // Resolves when the work started by the last lock (the final encrypted save)
  // has finished - the app reloads after it for a clean memory (SEC-028).
  var _lockSettled = Promise.resolve();
  function lockSettled() { return _lockSettled; }

  // ---- idle auto-lock ------------------------------------------------------
  var _lockTimer = null;
  var _autoLockMs = 15 * 60 * 1000;
  var _lockListeners = [];
  var _activityBound = false;

  function onLock(cb) { if (typeof cb === 'function') _lockListeners.push(cb); }
  function fireLock() {
    var pending = [];
    _lockListeners.forEach(function (cb) { try { var r = cb(); if (r && typeof r.then === 'function') pending.push(r.then(null, function () {})); } catch (e) {} });
    return Promise.all(pending);
  }

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
        // SEC-027: a passkey opens the whole vault, so it must verify the user
        // (PIN / biometrics), not only their presence.
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        extensions: { prf: { eval: { first: prfSalt } } }
      }
    }).then(function (cred) {
      var ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
      var prf = ext && ext.prf && ext.prf.results && ext.prf.results.first;
      if (!prf) return { supported: false }; // authenticator has no PRF
      if (!userVerified(cred.response && cred.response.getAuthenticatorData ? cred.response.getAuthenticatorData() : null)) {
        return { supported: true, enrolled: false, reason: 'no-user-verification' };
      }
      // Wrap the raw vault key with a key derived (HKDF) from the PRF output.
      return passkeyWrapKey(new Uint8Array(prf), 2).then(function (wrapKey) {
        return encryptWith(wrapKey, b64encode(_rawKey)).then(function (wrapped) {
          meta.passkey = {
            v: 2, uv: 'required',
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
    // An enrolment from before PR 6 keeps its mode: its PRF output depends on
    // it, so requiring verification now would make it stop unlocking.
    var v2 = pk.v === 2;
    return navigator.credentials.get({
      publicKey: {
        challenge: getRandom(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: b64decode(pk.credId) }],
        userVerification: v2 ? 'required' : 'preferred',
        extensions: { prf: { eval: { first: b64decode(pk.prfSalt) } } }
      }
    }).then(function (assertion) {
      var ext = assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {};
      var prf = ext && ext.prf && ext.prf.results && ext.prf.results.first;
      if (!prf) throw new Error('passkey-no-prf');
      if (v2 && !userVerified(assertion.response && assertion.response.authenticatorData)) throw new Error('passkey-no-uv');
      return passkeyWrapKey(new Uint8Array(prf), v2 ? 2 : 1).then(function (wrapKey) {
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

  // UV flag of WebAuthn authenticator data (byte 32, bit 2). Unknown (no
  // data) counts as verified: the browser enforced userVerification already.
  function userVerified(authData) {
    if (!authData) return true;
    var b = new Uint8Array(authData);
    return b.length > 32 ? !!(b[32] & 0x04) : true;
  }
  // v2: HKDF of the PRF output (domain separation); v1: the output as is.
  function passkeyWrapKey(prf, v) {
    if (v !== 2) return importAesKey(prf);
    return hkdf(prf, 'passkey-wrap-v2', 'maermin-passkey').then(function (bits) { return importAesKey(new Uint8Array(bits)); });
  }

  // ---- recovery kit (alternative unlock) -----------------------------------
  // A printable recovery code is a SECOND wrapping of the vault key — the same
  // mechanism as a passkey, but the wrap key is derived (PBKDF2) from a single
  // high-entropy code the user stores offline. The code is shown exactly ONCE
  // and is NEVER persisted or transmitted; only the wrapped key + its salt live
  // in meta. This gives a real recovery path for a forgotten password without
  // weakening the zero-knowledge model (server/meta never see plaintext key).
  //
  // Like passkeys, the recovery wrap is bound to the raw data key. A password
  // change only re-wraps that key (setPassword), so the code keeps working.
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
    var kdf = checkedKdf(kdfName, params);
    if (!kdf) return Promise.reject(new Error('bad-kdf-params'));
    return derive(kdf, code, salt, params).then(function (raw) { return importAesKey(raw); });
  }

  // Generate + store a recovery kit for the unlocked vault. Resolves with the
  // one-time code (formatted for display) — the caller must surface it then drop
  // it; it is not recoverable afterwards.
  // opts.pending: store it as meta.recoveryPending - it neither unlocks nor
  // counts as a recovery code, and an existing code keeps working, until
  // confirmRecovery() is called once the user confirmed they saved it. A
  // reload in between therefore never leaves a code nobody has seen.
  function enrollRecovery(opts) {
    opts = opts || {};
    if (!isSupported()) return Promise.reject(new Error('crypto-unsupported'));
    if (!_rawKey) return Promise.reject(new Error('locked'));
    var meta = readMeta();
    if (!meta) return Promise.reject(new Error('no-vault'));
    var code = base32encode(getRandom(new Uint8Array(15)));
    var salt = getRandom(new Uint8Array(16));
    var params = KDFS.pbkdf2.defaultParams(); // always-available + portable (Node tests)
    return deriveRecoveryWrapKey(code, salt, 'pbkdf2', params).then(function (wrapKey) {
      return encryptWith(wrapKey, b64encode(_rawKey)).then(function (wrapped) {
        var rec = {
          kdf: 'pbkdf2', params: params, salt: b64encode(salt),
          wrappedKey: wrapped, createdAt: Date.now()
        };
        if (opts.pending) meta.recoveryPending = rec;
        else { meta.recovery = rec; delete meta.recoveryPending; }
        meta.updatedAt = Date.now();
        writeMeta(meta);
        return { code: formatRecoveryCode(code), createdAt: rec.createdAt, pending: !!opts.pending };
      });
    });
  }

  // Activate the pending recovery code (replacing the old one). Returns true
  // when there was one to activate.
  function confirmRecovery() {
    var m = readMeta();
    if (!m || !m.recoveryPending) return false;
    m.recovery = m.recoveryPending;
    delete m.recoveryPending;
    m.updatedAt = Date.now();
    writeMeta(m);
    return true;
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
    delete m.recovery; delete m.recoveryPending; m.updatedAt = Date.now(); writeMeta(m);
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
    setPassword: setPassword,
    verifyPassword: verifyPassword,
    prepareRotation: prepareRotation,
    lock: lock,
    lockSettled: lockSettled,
    // crypto
    encrypt: encrypt,
    decrypt: decrypt,
    encryptJSON: encryptJSON,
    decryptJSON: decryptJSON,
    deriveSubKey: deriveSubKey,
    envelopeVersion: envelopeVersion,
    validateMeta: validateMeta,
    // auto-lock
    configureAutoLock: configureAutoLock,
    touch: touch,
    onLock: onLock,
    // passkeys
    passkeySupported: passkeySupported,
    enrollPasskey: enrollPasskey,
    unlockWithPasskey: unlockWithPasskey,
    removePasskey: removePasskey,
    // recovery kit (alternative unlock via printable code)
    enrollRecovery: enrollRecovery,
    confirmRecovery: confirmRecovery,
    unlockWithRecovery: unlockWithRecovery,
    hasRecovery: hasRecovery,
    removeRecovery: removeRecovery,
    // constants (for storage.js / tests)
    META_KEY: META_KEY
  };

  if (typeof window !== 'undefined') window.MaerminVault = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
