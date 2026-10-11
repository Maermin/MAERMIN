// Vault compatibility: vaults and an encrypted backup made by the code BEFORE
// the 2026-10 vault changes (PR 6; fixtures in test/fixtures/vault-main-2026-10.json,
// built with that code) open with the current code, keep their data, survive
// a save + reload (which moves them to the current record format), and still
// unlock with the recovery code and after a password change.
// Run: node test/vault-compat.test.js
'use strict';
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;
const FX = require('./fixtures/vault-main-2026-10.json');

class StorageMock {
  constructor(init) { this._d = new Map(Object.entries(init || {})); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
}
function MockIDB(init) {
  const m = new Map(Object.entries(init || {}));
  return { _map: m, isSupported: () => true,
    get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, String(v)); return Promise.resolve(); },
    del: (k) => { m.delete(k); return Promise.resolve(); } };
}
const ROOT = path.join(__dirname, '..');
// A fresh "browser": its own localStorage (+ IndexedDB) and freshly loaded modules.
function browser(lsInit, idbInit) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT) && !k.includes('node_modules') && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k];
  // each browser has its own Storage class: storage.js patches Storage.prototype
  const Cls = class extends StorageMock {};
  const ls = new Cls(lsInit);
  globalThis.Storage = Cls;
  globalThis.localStorage = ls;
  const idb = idbInit !== undefined ? MockIDB(idbInit) : null;
  globalThis.window = { localStorage: ls, addEventListener() {}, ...(idb ? { MaerminIDB: idb } : {}) };
  const Vault = require('../crypto-vault.js');
  globalThis.window.MaerminVault = Vault;
  const Storage = require('../storage.js');
  globalThis.window.MaerminStorage = Storage;
  return { ls, idb, Vault, Storage };
}
// Close a browser: lock, then let its pending encrypted saves finish (they
// write through the global window, which the next test browser replaces).
const settle = () => new Promise((r) => setTimeout(r, 600));
const sameData = (ls) => Object.keys(FX.data).every((k) => ls.getItem(k) === FX.data[k]);
const missing = (ls) => Object.keys(FX.data).filter((k) => ls.getItem(k) !== FX.data[k]).join(',');

(async function run() {
  console.log('vault compatibility with vaults made before PR 6:');

  // 1. localStorage blob vault (v1 meta) + recovery code + exchange credential
  let b = browser(FX.blobVault.localStorage);
  ok('blob vault: wrong password is refused', await b.Vault.unlock('wrong-password').then(() => false, () => true));
  await b.Vault.unlock(FX.password);
  ok('blob vault: unlocks with the password', b.Vault.isUnlocked());
  await b.Storage.resume();
  ok('blob vault: every record is back', sameData(b.ls), missing(b.ls));
  const cred = await b.Vault.decryptJSON(b.ls.getItem('maermin_exchange_cred_c1'), 'exchange-cred:c1');
  ok('blob vault: an exchange credential still decrypts', cred && cred.apiKey === 'fixture-key');
  // save + reload with the current code
  b.ls.setItem('maermin_journal', '[{"id":"j1"}]');
  await b.Storage.flush();
  const saved = Object.fromEntries(b.ls._d);
  b.Vault.lock(); await settle();
  b = browser(saved);
  await b.Vault.unlock(FX.password); await b.Storage.resume();
  ok('blob vault: after a save with the current code it reopens with all data', sameData(b.ls) && b.ls.getItem('maermin_journal') === '[{"id":"j1"}]');
  ok('blob vault: the save moved the data to the bound (v2) format', String(saved.maermin_vault_data).startsWith('2.'));
  b.Vault.lock(); await settle();
  b = browser(FX.blobVault.localStorage);
  await b.Vault.unlockWithRecovery(FX.recoveryCode); await b.Storage.resume();
  ok('blob vault: the recovery code made before still unlocks', b.Vault.isUnlocked() && sameData(b.ls));
  b.Vault.lock(); await settle();

  // 2. IndexedDB per-key vault
  let p = browser(FX.perKeyVault.localStorage, FX.perKeyVault.idb);
  await p.Vault.unlock(FX.password); await p.Storage.resume();
  ok('per-key vault: unlocks and every record is back', sameData(p.ls), missing(p.ls));
  p.ls.setItem('maermin_notes', '{"AAPL":"n"}');
  await p.Storage.flush();
  const pLs = Object.fromEntries(p.ls._d), pIdb = Object.fromEntries(p.idb._map);
  p.Vault.lock(); await settle();
  p = browser(pLs, pIdb);
  await p.Vault.unlock(FX.password); await p.Storage.resume();
  ok('per-key vault: after a save with the current code it reopens with all data', sameData(p.ls) && p.ls.getItem('maermin_notes') === '{"AAPL":"n"}');
  const man2 = await p.Vault.decryptJSON(pIdb.maermin_vault_manifest, 'manifest');
  ok('per-key vault: every record was rewritten in the bound (v2) format', man2.v === 2 && Object.values(man2.map).every((id) => String(pIdb['r:' + id]).startsWith('2.')));
  p.Vault.lock(); await settle();

  // 3. v2 meta (password changed with the old code)
  let c = browser(FX.changedPasswordVault.localStorage);
  ok('changed-password vault: the old password is refused', await c.Vault.unlock(FX.password).then(() => false, () => true));
  await c.Vault.unlock(FX.changedPassword); await c.Storage.resume();
  ok('changed-password vault: the new password opens it with all data', sameData(c.ls), missing(c.ls));
  c.Vault.lock(); await settle();

  // 4. encrypted backup made by the old code, restored into an empty browser
  for (const withIdb of [false, true]) {
    const r = browser({}, withIdb ? {} : undefined);
    await r.Storage.importEncryptedBackup(FX.backup);
    await r.Vault.unlock(FX.password); await r.Storage.resume();
    ok('backup restore (' + (withIdb ? 'IndexedDB' : 'localStorage') + '): all data back', sameData(r.ls), missing(r.ls));
    await r.Storage.flush();
    const rLs = Object.fromEntries(r.ls._d), rIdb = r.idb ? Object.fromEntries(r.idb._map) : undefined;
    r.Vault.lock(); await settle();
    const r2 = browser(rLs, rIdb);
    await r2.Vault.unlock(FX.password); await r2.Storage.resume();
    ok('backup restore (' + (withIdb ? 'IndexedDB' : 'localStorage') + '): reopens after a save', sameData(r2.ls), missing(r2.ls));
    await r2.Vault.unlockWithRecovery(FX.recoveryCode).catch(() => {});
    r2.Vault.lock(); await settle();
  }

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
