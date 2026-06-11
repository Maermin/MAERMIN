// Node harness for the recovery kit (alternative vault unlock via a printable
// code). Proves the code recovers the SAME data key without storing/transmitting
// it, and that a password change invalidates the kit. Run: node test/vault-recovery.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
async function throws(name, p, msgIncludes) {
  try { await p; failed++; console.error('  ✗ ' + name + ' (did not throw)'); }
  catch (e) {
    const good = !msgIncludes || (e && String(e.message).includes(msgIncludes));
    if (good) { passed++; console.log('  ✓ ' + name); }
    else { failed++; console.error('  ✗ ' + name + ' (wrong error: ' + (e && e.message) + ')'); }
  }
}

// ---- minimal DOM stubs (modules guard on typeof window/document) ----
class StorageMock {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  get size() { return this._d.size; }
}
globalThis.Storage = StorageMock;
const localStorage = new StorageMock();
globalThis.localStorage = localStorage;
globalThis.window = { localStorage, addEventListener() {} };

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  try { globalThis.crypto = require('node:crypto').webcrypto; }
  catch (e) { Object.defineProperty(globalThis, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); }
}

const Vault = require('../crypto-vault.js');

(async function run() {
  console.log('vault recovery kit:');

  await Vault.create('correct horse battery staple');
  ok('no recovery kit on a fresh vault', !Vault.hasRecovery());
  ok('getMeta().hasRecovery is false initially', Vault.getMeta().hasRecovery === false);
  await throws('unlockWithRecovery before enroll → no-recovery', Vault.unlockWithRecovery('XXXX-XXXX'), 'no-recovery');

  // Encrypt a secret under the current key so we can prove the code recovers IT.
  const secret = 'net-worth:€123456.78';
  const env = await Vault.encrypt(secret);

  const kit = await Vault.enrollRecovery();
  ok('enroll returns a code', !!kit && typeof kit.code === 'string');
  ok('code is 6 groups of 4 base32 chars (no 0/1/I/O)', /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){5}$/.test(kit.code));
  ok('hasRecovery true after enroll', Vault.hasRecovery());
  ok('getMeta().hasRecovery reflects enroll', Vault.getMeta().hasRecovery === true);
  ok('plaintext code is NOT stored in meta', JSON.stringify(localStorage.getItem(Vault.META_KEY)).indexOf(kit.code.replace(/-/g, '')) === -1);

  // Lock → recover with the code → must decrypt the pre-lock secret (same key).
  Vault.lock();
  ok('locked', !Vault.isUnlocked());
  await Vault.unlockWithRecovery(kit.code);
  ok('recovery code unlocks the vault', Vault.isUnlocked());
  ok('recovered key decrypts pre-lock data', (await Vault.decrypt(env)) === secret);

  // Input is normalised: lowercase, spaces, missing dashes all accepted.
  Vault.lock();
  const messy = '  ' + kit.code.toLowerCase().replace(/-/g, ' ') + '  ';
  await Vault.unlockWithRecovery(messy);
  ok('normalises messy input (case/spaces/dashes)', Vault.isUnlocked());

  // Wrong code is rejected without leaking which part is wrong.
  Vault.lock();
  await throws('wrong recovery code rejected', Vault.unlockWithRecovery('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'), 'bad-recovery-code');
  await throws('empty code rejected', Vault.unlockWithRecovery('   '), 'bad-recovery-code');
  ok('vault stays locked after failed recovery', !Vault.isUnlocked());

  // removeRecovery clears the kit.
  await Vault.unlockWithRecovery(kit.code);
  ok('removeRecovery returns true when present', Vault.removeRecovery() === true);
  ok('hasRecovery false after remove', !Vault.hasRecovery());
  ok('removeRecovery returns false when absent', Vault.removeRecovery() === false);

  // A password change re-keys the vault → the old kit must NOT survive (same
  // convention as passkeys; UI re-prompts for a fresh kit).
  await Vault.unlock('correct horse battery staple');
  const kit2 = await Vault.enrollRecovery();
  ok('re-enrolled before password change', Vault.hasRecovery());
  await Vault.changePassword('correct horse battery staple', 'a brand new passphrase');
  ok('recovery kit dropped after password change', !Vault.hasRecovery());
  Vault.lock();
  await throws('stale recovery code no longer works', Vault.unlockWithRecovery(kit2.code), 'no-recovery');
  await Vault.unlock('a brand new passphrase');
  ok('new password still unlocks', Vault.isUnlocked());

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
