// Node harness for P1-3 (FINDINGS.md H-3, H-4, M-6, M-7): a password change
// keeps the data key (and with it passkey, recovery code, auto-lock and the
// sync account); a recovery-code unlock can set a new password; a new
// recovery code only replaces the old one once the user confirmed it.
// Run: node test/vault-password.test.js
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

class StorageMock {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
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
const hex = (buf) => Buffer.from(new Uint8Array(buf)).toString('hex');
const rawMeta = () => JSON.parse(localStorage.getItem(Vault.META_KEY));
const syncAccount = async () => hex(await Vault.deriveSubKey('sync-account')).slice(0, 32);

(async function run() {
  console.log('vault-password:');
  const OLD = 'correct horse battery', NEW = 'brand-new passphrase 7';

  // ---- H-4: change password keeps everything bound to the data key ----------
  await Vault.create(OLD);
  const secret = await Vault.encrypt('net-worth: 123,456.78 EUR');
  const kit = await Vault.enrollRecovery();
  Vault.configureAutoLock(60 * 1000);
  // A passkey wrap as enrollPasskey writes it (WebAuthn itself is browser-only).
  const m0 = rawMeta(); m0.passkey = { credId: 'Y3JlZA==', prfSalt: 'c2FsdA==', wrappedKey: '1.aXY=.Y3Q=' }; localStorage.setItem(Vault.META_KEY, JSON.stringify(m0));
  const acct0 = await syncAccount();

  await Vault.changePassword(OLD, NEW);
  ok('H-4: the passkey survives the password change', JSON.stringify(rawMeta().passkey) === JSON.stringify(m0.passkey));
  ok('H-4: the recovery code survives the password change', Vault.hasRecovery());
  ok('H-4: the auto-lock setting survives (1 min, not 15)', Vault.getMeta().autoLockMs === 60 * 1000);
  ok('H-4: the sync account id stays the same', (await syncAccount()) === acct0);
  ok('H-4: data encrypted before the change still decrypts', (await Vault.decrypt(secret)) === 'net-worth: 123,456.78 EUR');

  Vault.lock();
  await throws('H-4: the old password no longer unlocks', Vault.unlock(OLD), 'bad-password');
  await Vault.unlock(NEW);
  ok('H-4: the new password unlocks', Vault.isUnlocked());
  ok('H-4: same data key after unlock with the new password', (await Vault.decrypt(secret)) === 'net-worth: 123,456.78 EUR' && (await syncAccount()) === acct0);
  Vault.lock();
  await Vault.unlockWithRecovery(kit.code);
  ok('H-4: the old recovery code still unlocks after the change', Vault.isUnlocked() && (await Vault.decrypt(secret)) === 'net-worth: 123,456.78 EUR');
  ok('meta does not leak the password wrap', !('pwWrap' in Vault.getMeta()));

  // A wrong current password changes nothing.
  const before = localStorage.getItem(Vault.META_KEY);
  await throws('wrong current password -> bad-password', Vault.changePassword('nope nope nope', 'x-another-one'), 'bad-password');
  ok('... and the meta is unchanged', localStorage.getItem(Vault.META_KEY) === before);
  ok('... and the vault stays unlocked', Vault.isUnlocked());

  // ---- H-3: after a recovery unlock, set a new password ---------------------
  Vault.lock();
  await Vault.unlockWithRecovery(kit.code);
  await Vault.setPassword('after-recovery pass 3');
  Vault.lock();
  await throws('H-3: the forgotten password is gone', Vault.unlock(NEW), 'bad-password');
  await Vault.unlock('after-recovery pass 3');
  ok('H-3: the password set after recovery unlocks the same data', (await Vault.decrypt(secret)) === 'net-worth: 123,456.78 EUR');
  Vault.lock();
  await throws('setPassword needs an unlocked vault', Vault.setPassword('whatever-123'), 'locked');
  await Vault.unlock('after-recovery pass 3');
  await throws('setPassword rejects an empty password', Vault.setPassword(''), 'empty-password');

  // ---- legacy (v1) vaults keep working --------------------------------------
  localStorage._d.clear();
  await Vault.create(OLD);
  const legacySecret = await Vault.encrypt('legacy');
  ok('a new vault is still a v1 meta (no format change until a password change)', rawMeta().v === 1 && !rawMeta().pwWrap);
  Vault.lock();
  await Vault.unlock(OLD);
  ok('v1 unlock unchanged', (await Vault.decrypt(legacySecret)) === 'legacy');
  await Vault.changePassword(OLD, NEW);
  ok('the first password change upgrades the meta to v2', rawMeta().v === 2 && !!rawMeta().pwWrap);

  // ---- M-6 / M-7: a new recovery code is pending until confirmed ------------
  console.log('recovery confirmation:');
  localStorage._d.clear();
  await Vault.create(OLD);
  const pend = await Vault.enrollRecovery({ pending: true });
  ok('M-7: a code that was never confirmed does not count as a recovery code', !Vault.hasRecovery() && Vault.getMeta().hasRecovery === false);
  Vault.lock();
  await throws('M-7: an unconfirmed code cannot unlock', Vault.unlockWithRecovery(pend.code), 'no-recovery');
  await Vault.unlock(OLD);
  // A reload in between: enroll again, confirm this time.
  const first = await Vault.enrollRecovery({ pending: true });
  ok('confirmRecovery activates the pending code', Vault.confirmRecovery() === true && Vault.hasRecovery());
  Vault.lock();
  await Vault.unlockWithRecovery(first.code);
  ok('the confirmed code unlocks', Vault.isUnlocked());

  const rotated = await Vault.enrollRecovery({ pending: true });
  Vault.lock();
  await Vault.unlockWithRecovery(first.code);
  ok('M-6: until the new code is confirmed, the old code still works', Vault.isUnlocked());
  await throws('M-6: ... and the new one does not yet', (async () => { Vault.lock(); await Vault.unlockWithRecovery(rotated.code); })(), 'bad-recovery-code');
  await Vault.unlock(OLD);
  const rotated2 = await Vault.enrollRecovery({ pending: true });
  Vault.confirmRecovery();
  Vault.lock();
  await throws('M-6: after confirming, the old code stops working', Vault.unlockWithRecovery(first.code), 'bad-recovery-code');
  await Vault.unlockWithRecovery(rotated2.code);
  ok('M-6: the confirmed new code works', Vault.isUnlocked());
  ok('confirmRecovery without a pending code is a no-op', Vault.confirmRecovery() === false && Vault.hasRecovery());

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
