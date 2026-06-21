// Node harness for the security slice. No browser tooling in this env, so we
// stub the minimal DOM globals the modules guard for and exercise the real
// crypto + the real at-rest migration logic. Run: node test/vault.test.js
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
// no globalThis.document → auto-lock event binding is skipped (headless)

// Web Crypto is a global from Node 20+ but not on Node 18 (CI matrix). Polyfill
// from node:crypto when missing so crypto-vault.js sees `crypto.subtle`.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  try { globalThis.crypto = require('node:crypto').webcrypto; }
  catch (e) { Object.defineProperty(globalThis, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); }
}

const Vault = require('../crypto-vault.js');
const Storage = require('../storage.js'); // reads window.MaerminVault set above

(async function run() {
  console.log('crypto-vault:');
  ok('isSupported (Node WebCrypto)', Vault.isSupported());
  ok('no vault yet', !Vault.hasVault());

  await Vault.create('correct horse battery');
  ok('vault created + meta written', Vault.hasVault());
  ok('unlocked after create', Vault.isUnlocked());
  ok('meta records a KDF', !!Vault.getMeta().kdf);
  ok('meta does NOT leak wrapCheck', !('wrapCheck' in Vault.getMeta()));

  const env = await Vault.encrypt('top-secret-balance:1234.56');
  ok('envelope is versioned 1.iv.ct', /^1\.[^.]+\.[^.]+$/.test(env));
  ok('roundtrip decrypt', (await Vault.decrypt(env)) === 'top-secret-balance:1234.56');

  // tamper: flip last char of ciphertext → GCM auth must fail
  const tampered = env.slice(0, -2) + (env.slice(-2, -1) === 'A' ? 'B' : 'A') + env.slice(-1);
  await throws('tampered ciphertext rejected', Vault.decrypt(tampered));

  Vault.lock();
  ok('locked wipes key', !Vault.isUnlocked());
  await throws('encrypt while locked rejected', Vault.encrypt('x'), 'locked');

  await throws('wrong password rejected', Vault.unlock('nope nope nope'), 'bad-password');
  await Vault.unlock('correct horse battery');
  ok('correct password unlocks', Vault.isUnlocked());

  // ---- storage at-rest migration ----
  console.log('storage (at-rest):');
  localStorage.setItem('transactions', JSON.stringify([{ s: 'BTC', q: 1 }]));
  localStorage.setItem('maermin_portfolios', JSON.stringify([{ id: 'p1' }]));
  localStorage.setItem('theme', 'dark'); // non-sensitive → must stay plaintext

  await Storage.enableAtRest();
  ok('blob created', !!localStorage.getItem(Storage.BLOB_KEY));
  ok('plaintext backup created', !!localStorage.getItem(Storage.BACKUP_KEY));
  ok('non-sensitive key untouched', localStorage.getItem('theme') === 'dark');
  ok('sensitive read via shim returns plaintext',
    localStorage.getItem('transactions') === JSON.stringify([{ s: 'BTC', q: 1 }]));
  ok('blob ciphertext does not contain plaintext',
    !String(localStorage.getItem(Storage.BLOB_KEY)).includes('maermin_portfolios') &&
    !String(localStorage.getItem(Storage.BLOB_KEY)).includes('BTC'));

  // write through the shim, flush, then simulate reload (lock → unlock → resume)
  localStorage.setItem('transactions', JSON.stringify([{ s: 'ETH', q: 2 }]));
  await Storage.flush();
  Vault.lock();
  ok('locked → sensitive read is null (only ciphertext at rest)',
    localStorage.getItem('transactions') === null);

  await Vault.unlock('correct horse battery');
  await Storage.resume();
  ok('after unlock+resume, updated value hydrated',
    localStorage.getItem('transactions') === JSON.stringify([{ s: 'ETH', q: 2 }]));

  await Storage.disableAtRest();
  ok('disable restores plaintext key', localStorage.getItem('transactions') === JSON.stringify([{ s: 'ETH', q: 2 }]));
  ok('disable removes blob', localStorage.getItem(Storage.BLOB_KEY) === null);

  // ---- change password re-keys the vault ----
  console.log('change-password:');
  await Vault.changePassword('correct horse battery', 'new-stronger-pass-9');
  ok('still unlocked after re-key', Vault.isUnlocked());
  Vault.lock();
  await throws('old password no longer works', Vault.unlock('correct horse battery'), 'bad-password');
  await Vault.unlock('new-stronger-pass-9');
  ok('new password works', Vault.isUnlocked());

  // ---- portable encrypted backup (disaster recovery) ----
  console.log('encrypted backup / restore:');
  // vault is unlocked under 'new-stronger-pass-9'; put data + encrypt at rest.
  localStorage.setItem('transactions', JSON.stringify([{ s: 'BACKUP', q: 7 }]));
  await Storage.enableAtRest();
  const backup = await Storage.exportEncryptedBackup();
  ok('backup is the expected format', backup && backup.format === 'maermin-vault-backup' && typeof backup.blob === 'string' && !!backup.meta);
  ok('backup blob is ciphertext (no plaintext leak)', backup.blob.indexOf('BACKUP') === -1);

  // Simulate a full browser-store wipe + a fresh device with no vault.
  Vault.lock();
  localStorage._d.clear();
  ok('after wipe there is no vault', !Vault.getMeta());

  // Restore the backup, then unlock with the original password.
  await Storage.importEncryptedBackup(backup);
  ok('restore recreates the vault meta', !!Vault.getMeta());
  await Vault.unlock('new-stronger-pass-9');
  await Storage.resume();
  ok('restored data decrypts after unlock',
    localStorage.getItem('transactions') === JSON.stringify([{ s: 'BACKUP', q: 7 }]));
  await throws('a bad backup object is rejected', Storage.importEncryptedBackup({ nope: true }), 'bad-backup');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
