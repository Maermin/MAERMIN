// Node harness for the sync write-authorization (HMAC) exported from
// cf-worker/worker.js (ESM, dynamic import). Verifies: TOFU key registration at
// account creation, HMAC verification for protected accounts, rejection of bad/
// missing MACs, no-hijack of legacy open accounts, the constant-time compare,
// and a client→server round-trip (syncMac authorizes authorizeSyncPut).
// Run: node test/sync-auth.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

// WebCrypto is global from Node 20+; polyfill from node:crypto when missing.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = require('node:crypto').webcrypto;
}

const ACCOUNT = 'a1b2c3d4e5f60718';
const BLOB = '1.aXY.Y3Q';          // a stand-in ciphertext envelope
const KEY = 'ab'.repeat(32);        // 64 hex chars (32 bytes)

(async function run() {
  const W = await import('../cf-worker/worker.js');
  console.log('sync-auth (worker HMAC):');

  // ---- timing-safe hex compare ----------------------------------------------
  ok('timingSafeEqualHex equal → true', W.timingSafeEqualHex('deadbeef', 'deadbeef') === true);
  ok('timingSafeEqualHex different → false', W.timingSafeEqualHex('deadbeef', 'deadbee0') === false);
  ok('timingSafeEqualHex length mismatch → false', W.timingSafeEqualHex('dead', 'deadbeef') === false);
  ok('timingSafeEqualHex empty → false', W.timingSafeEqualHex('', '') === false);

  // ---- TOFU registration at account creation (current === null) -------------
  const create = await W.authorizeSyncPut(null, ACCOUNT, 0, BLOB, { key: KEY });
  ok('creation with a valid key registers it', create.ok === true && create.authKey === KEY);
  const createNoKey = await W.authorizeSyncPut(null, ACCOUNT, 0, BLOB, {});
  ok('creation without a key stays open (authKey null)', createNoKey.ok === true && createNoKey.authKey == null);
  const createBadKey = await W.authorizeSyncPut(null, ACCOUNT, 0, BLOB, { key: 'xyz' });
  ok('creation with a malformed key does not register', createBadKey.ok === true && createBadKey.authKey == null);

  // ---- protected account: HMAC required -------------------------------------
  const current = { rev: 5, blob: 'old', authKey: KEY };
  const goodMac = await W.syncMac(KEY, ACCOUNT + '.' + 5 + '.' + BLOB);
  const okAuth = await W.authorizeSyncPut(current, ACCOUNT, 5, BLOB, { mac: goodMac });
  ok('valid MAC authorizes + carries the existing key', okAuth.ok === true && okAuth.authKey === KEY);

  const badAuth = await W.authorizeSyncPut(current, ACCOUNT, 5, BLOB, { mac: 'deadbeef' });
  ok('wrong MAC → 403 unauthorized', badAuth.ok === false && badAuth.status === 403 && badAuth.error === 'unauthorized');

  const missingAuth = await W.authorizeSyncPut(current, ACCOUNT, 5, BLOB, {});
  ok('missing MAC on a protected account → 403', missingAuth.ok === false && missingAuth.status === 403);

  // MAC is bound to the blob: tampering the blob with the same MAC fails.
  const tampered = await W.authorizeSyncPut(current, ACCOUNT, 5, BLOB + 'X', { mac: goodMac });
  ok('MAC is bound to the blob (tamper → 403)', tampered.ok === false && tampered.status === 403);

  // MAC is bound to baseRev: replay at a different rev fails.
  const wrongRev = await W.authorizeSyncPut(current, ACCOUNT, 6, BLOB, { mac: goodMac });
  ok('MAC is bound to baseRev (replay at other rev → 403)', wrongRev.ok === false && wrongRev.status === 403);

  // ---- legacy open account is NOT hijackable --------------------------------
  const legacy = { rev: 2, blob: 'old' }; // no authKey
  const noHijack = await W.authorizeSyncPut(legacy, ACCOUNT, 2, BLOB, { key: KEY, mac: goodMac });
  ok('legacy open record cannot be upgraded/hijacked', noHijack.ok === true && noHijack.authKey == null);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
