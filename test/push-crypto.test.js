// Node harness for P5-5.1: Web Push message encryption (RFC 8291, aes128gcm
// content coding of RFC 8188) done in the browser, so the user's Worker only
// ever relays ciphertext. Checked against the example of RFC 8291 section 5
// and an independent decryptor built on node:crypto.
// Run: node test/push-crypto.test.js
'use strict';
const nodeCrypto = require('node:crypto');
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = nodeCrypto.webcrypto;

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
const PC = require('../push-crypto.js');
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url');

// Independent decryptor (node:crypto only): the user agent's side of RFC 8291.
function decrypt(body, uaEcdh, authSecret) {
  body = Buffer.from(body);
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ecdh = uaEcdh.computeSecret(asPublic);
  const uaPublic = uaEcdh.getPublicKey();
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(nodeCrypto.hkdfSync('sha256', ecdh, authSecret, keyInfo, 32));
  const cek = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = pt.length - 1; while (end >= 0 && pt[end] === 0) end--;
  return { rs, delimiter: pt[end], text: pt.subarray(0, end).toString('utf8') };
}

(async function main() {
  console.log('push-crypto:');

  // ---- RFC 8291 section 5 example -------------------------------------------
  const rfc = {
    plaintext: 'When I grow up, I want to be a watermelon',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    result: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
  };
  const body = await PC.encrypt(rfc.plaintext, { p256dh: rfc.uaPublic, auth: rfc.auth },
    { salt: unb64u(rfc.salt), serverKey: { publicRaw: unb64u(rfc.asPublic), privateD: unb64u(rfc.asPrivate) } });
  ok('RFC 8291 example: byte for byte', b64u(body) === rfc.result, b64u(body));
  const rfcUa = nodeCrypto.createECDH('prime256v1'); rfcUa.setPrivateKey(unb64u(rfc.uaPrivate));
  ok('the independent decryptor reads the RFC example', decrypt(unb64u(rfc.result), rfcUa, unb64u(rfc.auth)).text === rfc.plaintext);

  // ---- random keys, independent decryptor ---------------------------------------
  const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const sub = { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) };
  const msg = JSON.stringify({ title: 'Dividend due', body: 'A dividend is due tomorrow.', tag: 'div' });
  const enc = await PC.encrypt(msg, sub);
  const dec = decrypt(enc, ua, auth);
  ok('a fresh message decrypts with node:crypto (last-record delimiter 0x02, rs 4096)', dec.text === msg && dec.delimiter === 2 && dec.rs === 4096, dec);
  const enc2 = await PC.encrypt(msg, sub);
  ok('every message gets its own salt and server key', b64u(enc2.subarray(0, 16)) !== b64u(enc.subarray(0, 16)) && b64u(enc2.subarray(21, 86)) !== b64u(enc.subarray(21, 86)));
  ok('Unicode text survives (ä, €, ✓)', decrypt(await PC.encrypt('Vorabpauschale: 12,30 € ✓ ä', sub), ua, auth).text === 'Vorabpauschale: 12,30 € ✓ ä');

  // ---- input checks ----------------------------------------------------------------
  let threw = false;
  try { await PC.encrypt('x'.repeat(PC.MAX_PLAINTEXT + 1), sub); } catch (e) { threw = true; }
  ok('a message over the size limit is refused', threw);
  threw = false;
  try { await PC.encrypt('x', { p256dh: 'AAAA', auth: b64u(auth) }); } catch (e) { threw = true; }
  ok('a malformed subscription key is refused', threw);
  ok('base64url round trip', b64u(PC.fromB64u(PC.toB64u(new Uint8Array([0, 250, 251, 252, 255])))) === b64u(Buffer.from([0, 250, 251, 252, 255])));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
