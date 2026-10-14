// ============================================================================
// MAERMIN — Web Push message encryption  (window.MaerminPushCrypto)
// ----------------------------------------------------------------------------
// P5-5.1. The browser encrypts each push message to its own push subscription
// (RFC 8291 "Message Encryption for Web Push", aes128gcm content coding of
// RFC 8188), so the user's Worker and the browser vendor's push service only
// ever carry ciphertext. One record, record size 4096, no padding.
//
//   encrypt(text, { p256dh, auth }, opts?) → Promise<Uint8Array> (the request body)
//     opts.salt (16 bytes) and opts.serverKey { publicRaw, privateD } exist for
//     the RFC 8291 test vector only; normally both are fresh per message.
//
// WebCrypto only (browser and Node 18+). Tested in test/push-crypto.test.js.
// ============================================================================
(function () {
  'use strict';

  var RS = 4096;
  var MAX_PLAINTEXT = 3000; // well below one record (RS - 17) and the push services' 4 KB
  var enc = new TextEncoder();

  function subtle() {
    var c = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto : (typeof require === 'function' ? require('node:crypto').webcrypto : null);
    if (!c || !c.subtle) throw new Error('WebCrypto unavailable');
    return c;
  }
  function toB64u(bytes) {
    var s = '', b = new Uint8Array(bytes);
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64u(str) {
    var s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concat() {
    var len = 0, i;
    for (i = 0; i < arguments.length; i++) len += arguments[i].length;
    var out = new Uint8Array(len), off = 0;
    for (i = 0; i < arguments.length; i++) { out.set(arguments[i], off); off += arguments[i].length; }
    return out;
  }
  function hkdf(c, ikm, salt, info, bytes) {
    return c.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']).then(function (k) {
      return c.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, k, bytes * 8);
    }).then(function (bits) { return new Uint8Array(bits); });
  }
  function serverKeyPair(c, fixed) {
    if (!fixed) {
      return c.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']).then(function (kp) {
        return c.subtle.exportKey('raw', kp.publicKey).then(function (raw) { return { privateKey: kp.privateKey, publicRaw: new Uint8Array(raw) }; });
      });
    }
    var pub = new Uint8Array(fixed.publicRaw);
    var jwk = { kty: 'EC', crv: 'P-256', d: toB64u(fixed.privateD), x: toB64u(pub.slice(1, 33)), y: toB64u(pub.slice(33, 65)), ext: true };
    return c.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
      .then(function (k) { return { privateKey: k, publicRaw: pub }; });
  }

  function encrypt(text, subscription, opts) {
    opts = opts || {};
    var c;
    try { c = subtle(); } catch (e) { return Promise.reject(e); }
    var plain = typeof text === 'string' ? enc.encode(text) : new Uint8Array(text);
    if (plain.length > MAX_PLAINTEXT) return Promise.reject(new Error('push message too long'));
    var uaPublic, authSecret;
    try { uaPublic = fromB64u(subscription && subscription.p256dh); authSecret = fromB64u(subscription && subscription.auth); } catch (e) { return Promise.reject(new Error('bad subscription')); }
    if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length < 16) return Promise.reject(new Error('bad subscription'));
    var salt = opts.salt ? new Uint8Array(opts.salt) : c.getRandomValues(new Uint8Array(16));
    var as, uaKey;
    return Promise.all([serverKeyPair(c, opts.serverKey), c.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])])
      .then(function (r) {
        as = r[0]; uaKey = r[1];
        return c.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256);
      })
      .then(function (secret) {
        var keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, as.publicRaw);
        return hkdf(c, new Uint8Array(secret), authSecret, keyInfo, 32);
      })
      .then(function (ikm) {
        return Promise.all([
          hkdf(c, ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16),
          hkdf(c, ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12)
        ]);
      })
      .then(function (r) {
        return c.subtle.importKey('raw', r[0], 'AES-GCM', false, ['encrypt']).then(function (cek) {
          return c.subtle.encrypt({ name: 'AES-GCM', iv: r[1] }, cek, concat(plain, new Uint8Array([2])));
        });
      })
      .then(function (ct) {
        var header = new Uint8Array(21);
        header.set(salt, 0);
        header[16] = (RS >>> 24) & 255; header[17] = (RS >>> 16) & 255; header[18] = (RS >>> 8) & 255; header[19] = RS & 255;
        header[20] = as.publicRaw.length;
        return concat(header, as.publicRaw, new Uint8Array(ct));
      });
  }

  var api = { RS: RS, MAX_PLAINTEXT: MAX_PLAINTEXT, encrypt: encrypt, toB64u: toB64u, fromB64u: fromB64u };
  if (typeof window !== 'undefined') window.MaerminPushCrypto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
