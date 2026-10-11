// Vault hardening, 2026-10 audit (docs/AUDIT.md SEC-004, SEC-007, SEC-017,
// SEC-027, SEC-028): KDF parameters are checked, records are bound to their
// name, the data key can be replaced (crash-safe), a passkey can be removed,
// and a lock lets callers wait for the final encrypted save.
// Run: node test/vault-hardening.test.js
'use strict';
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

class StorageMock {
  constructor(init) { this._d = new Map(Object.entries(init || {})); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
}
function MockIDB(init) {
  const m = new Map(Object.entries(init || {}));
  const api = { _map: m, failSet: null, isSupported: () => true,
    get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null),
    set: (k, v) => { if (api.failSet && api.failSet(k)) return Promise.reject(new Error('simulated crash')); m.set(k, String(v)); return Promise.resolve(); },
    del: (k) => { m.delete(k); return Promise.resolve(); } };
  return api;
}
const ROOT = path.join(__dirname, '..');
function browser(lsInit, idbInit) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(ROOT) && !k.includes('node_modules') && !k.includes(path.sep + 'test' + path.sep)) delete require.cache[k];
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
const settle = () => new Promise((r) => setTimeout(r, 600));
const PW = 'hardening-test-password';
const TX = '[{"id":"t1","symbol":"AAPL","quantity":2}]';
const dumpLs = (b) => Object.fromEntries(b.ls._d);
const dumpIdb = (b) => (b.idb ? Object.fromEntries(b.idb._map) : undefined);

(async function run() {
  console.log('vault hardening (2026-10 audit):');

  // ---- SEC-004 ---------------------------------------------------------------
  let b = browser({});
  ok('SEC-004: create refuses weak KDF parameters', await b.Vault.create(PW, { params: { iterations: 1, hash: 'SHA-1' } }).then(() => false, (e) => e.message === 'bad-kdf-params'));
  ok('SEC-004: create refuses an unknown KDF name', await b.Vault.create(PW, { kdf: 'constructor' }).then(() => false, (e) => e.message === 'bad-kdf-params'));
  await b.Vault.create(PW);
  const meta = JSON.parse(b.ls.getItem(b.Vault.META_KEY));
  ok('SEC-004: a normal meta is valid', b.Vault.validateMeta(meta).ok);
  for (const [label, patch] of [['an inherited KDF name', { kdf: 'constructor' }], ['1 iteration', { params: { iterations: 1 } }], ['SHA-1', { params: { iterations: 600000, hash: 'SHA-1' } }], ['20M iterations', { params: { iterations: 20000000 } }]]) {
    const bad = Object.assign({}, meta, patch);
    b.ls.setItem(b.Vault.META_KEY, JSON.stringify(bad));
    b.Vault.lock();
    const res = await b.Vault.unlock(PW).then(() => 'unlocked', (e) => e.message);
    ok('SEC-004: unlock rejects a meta with ' + label + ' (no hang)', res === 'bad-vault-meta', res);
  }
  b.ls.setItem(b.Vault.META_KEY, JSON.stringify(meta));
  await b.Vault.unlock(PW);
  ok('SEC-004: an imported backup with a bad meta is refused', await b.Storage.importEncryptedBackup({ format: 'maermin-vault-backup', v: 1, meta: Object.assign({}, meta, { params: { iterations: 1 } }), blob: '1.aaaa.bbbb' }).then(() => false, (e) => e.message === 'bad-backup'));
  ok('SEC-004: the current meta is untouched by the refused import', b.ls.getItem(b.Vault.META_KEY) === JSON.stringify(meta));
  b.Vault.lock(); await settle();

  // ---- SEC-007 ---------------------------------------------------------------
  b = browser({});
  await b.Vault.create(PW);
  const e1 = await b.Vault.encrypt('secret', 'rec:transactions');
  ok('SEC-007: a bound record is a v2 envelope', e1.startsWith('2.'));
  ok('SEC-007: it opens under its own name', await b.Vault.decrypt(e1, 'rec:transactions') === 'secret');
  ok('SEC-007: it does not open under another name', await b.Vault.decrypt(e1, 'rec:apiKeys').then(() => false, () => true));
  ok('SEC-007: it does not open without a name', await b.Vault.decrypt(e1).then(() => false, () => true));
  const legacy = await b.Vault.encrypt('old');
  ok('SEC-007: an old v1 record still opens', await b.Vault.decrypt(legacy, 'rec:x') === 'old');
  ok('SEC-007: strict mode refuses a v1 record', await b.Vault.decrypt(legacy, 'rec:x', { strict: true }).then(() => false, () => true));
  b.Vault.lock(); await settle();

  // per-key store: records swapped between names do not decrypt
  b = browser({}, {});
  await b.Vault.create(PW);
  b.ls.setItem('transactions', TX); b.ls.setItem('apiKeys', '{"cs2Worker":"https://w.example"}');
  await b.Storage.enableAtRest(); await b.Storage.flush();
  const manEnv = b.idb._map.get('maermin_vault_manifest');
  const man = await b.Vault.decryptJSON(manEnv, 'manifest');
  ok('SEC-007: the manifest is v2 and every record is a v2 envelope', man.v === 2 && Object.values(man.map).every((id) => b.idb._map.get('r:' + id).startsWith('2.')));
  const swapLs = dumpLs(b), swapIdb = dumpIdb(b);
  const tId = man.map.transactions, aId = man.map.apiKeys;
  [swapIdb['r:' + tId], swapIdb['r:' + aId]] = [swapIdb['r:' + aId], swapIdb['r:' + tId]];
  b.Vault.lock(); await settle();
  b = browser(swapLs, swapIdb);
  await b.Vault.unlock(PW); await b.Storage.resume();
  ok('SEC-007: two records swapped at rest do not decrypt as each other', b.ls.getItem('transactions') === null && b.ls.getItem('apiKeys') === null);
  b.Vault.lock(); await settle();

  // ---- SEC-017: rotation ------------------------------------------------------
  for (const withIdb of [false, true]) {
    const tag = withIdb ? 'IndexedDB' : 'localStorage';
    b = browser({}, withIdb ? {} : undefined);
    await b.Vault.create(PW);
    b.ls.setItem('transactions', TX);
    await b.Storage.enableAtRest(); await b.Storage.flush();
    const kit = await b.Vault.enrollRecovery();
    const m0 = JSON.parse(b.ls.getItem(b.Vault.META_KEY));
    m0.passkey = { credId: 'Y3JlZA==', prfSalt: 'c2FsdHNhbHRzYWx0c2FsdA==', wrappedKey: '1.aXY=.Y3Q=' };
    b.ls.setItem(b.Vault.META_KEY, JSON.stringify(m0));
    const oldMeta = b.ls.getItem(b.Vault.META_KEY);
    const acct0 = Buffer.from(await b.Vault.deriveSubKey('sync-account')).toString('hex');
    ok('SEC-017 (' + tag + '): a wrong password replaces nothing', await b.Vault.prepareRotation('wrong').then(() => false, (e) => e.message === 'bad-password') && b.ls.getItem(b.Vault.META_KEY) === oldMeta);
    await b.Storage.rekey(await b.Vault.prepareRotation(PW));
    b.ls.setItem('maermin_notes', '{"after":"rotation"}');
    await b.Storage.flush();
    const acct1 = Buffer.from(await b.Vault.deriveSubKey('sync-account')).toString('hex');
    const after = JSON.parse(b.ls.getItem(b.Vault.META_KEY));
    ok('SEC-017 (' + tag + '): data intact after the rotation', b.ls.getItem('transactions') === TX);
    ok('SEC-017 (' + tag + '): recovery code and passkey wraps are dropped', !after.recovery && !after.passkey && after.v === 2);
    ok('SEC-017 (' + tag + '): the sync account changes with the key', acct0 !== acct1);
    const lsNow = dumpLs(b), idbNow = dumpIdb(b);
    b.Vault.lock(); await settle();
    // the same password opens the rotated vault
    b = browser(lsNow, idbNow);
    await b.Vault.unlock(PW); await b.Storage.resume();
    ok('SEC-017 (' + tag + '): reopens with the password, all data there', b.ls.getItem('transactions') === TX && b.ls.getItem('maermin_notes') === '{"after":"rotation"}');
    b.Vault.lock(); await settle();
    // an OLD copy of the meta + the old credentials do not open new data
    const stolen = Object.assign({}, lsNow, { [b.Vault.META_KEY]: oldMeta });
    b = browser(stolen, idbNow);
    await b.Vault.unlockWithRecovery(kit.code).catch(() => {});
    const opened = b.Vault.isUnlocked() ? await b.Storage.resume() : false;
    ok('SEC-017 (' + tag + '): the old meta + old recovery code open no data written after', !opened || b.ls.getItem('maermin_notes') === null);
    b.Vault.lock(); await settle();
  }

  // crash BEFORE the commit point: the old vault stays, the staged copy is dropped
  b = browser({}, {});
  await b.Vault.create(PW); b.ls.setItem('transactions', TX);
  await b.Storage.enableAtRest(); await b.Storage.flush();
  const h0 = await b.Vault.prepareRotation(PW);
  const crashing = Object.assign({}, h0, { commit: () => { throw new Error('simulated crash'); } });
  ok('SEC-017: a crash before the commit rejects', await b.Storage.rekey(crashing).then(() => false, () => true));
  let ls1 = dumpLs(b), idb1 = dumpIdb(b);
  ok('SEC-017: a staged manifest exists after that crash', !!idb1['maermin_vault_manifest:next']);
  b.Vault.lock(); await settle();
  b = browser(ls1, idb1);
  await b.Vault.unlock(PW); await b.Storage.resume();
  ok('SEC-017: next unlock opens the OLD vault with its data and drops the staged copy', b.ls.getItem('transactions') === TX && !b.idb._map.has('maermin_vault_manifest:next'));
  b.Vault.lock(); await settle();

  // crash AFTER the commit point: the next unlock finishes the rotation
  b = browser({}, {});
  await b.Vault.create(PW); b.ls.setItem('transactions', TX);
  await b.Storage.enableAtRest(); await b.Storage.flush();
  b.idb.failSet = (k) => k === 'maermin_vault_manifest';
  ok('SEC-017: a crash after the commit rejects', await b.Vault.prepareRotation(PW).then((h) => b.Storage.rekey(h)).then(() => false, () => true));
  b.idb.failSet = null;
  ls1 = dumpLs(b); idb1 = dumpIdb(b);
  b.Vault.lock(); await settle();
  b = browser(ls1, idb1);
  await b.Vault.unlock(PW); const okResume = await b.Storage.resume();
  ok('SEC-017: next unlock finishes the rotation - new key, all data', okResume === true && b.ls.getItem('transactions') === TX && !b.idb._map.has('maermin_vault_manifest:next'));
  b.Vault.lock(); await settle();

  // ---- SEC-017 / SEC-027: passkey removal ------------------------------------
  b = browser({});
  await b.Vault.create(PW);
  const m1 = JSON.parse(b.ls.getItem(b.Vault.META_KEY)); m1.passkey = { credId: 'Y3JlZA==', prfSalt: 'c2FsdA==', wrappedKey: '1.aXY=.Y3Q=' };
  b.ls.setItem(b.Vault.META_KEY, JSON.stringify(m1));
  ok('SEC-017: a passkey can be removed', b.Vault.removePasskey() === true && !b.Vault.getMeta().hasPasskey);
  ok('SEC-017: removing again is a no-op', b.Vault.removePasskey() === false);

  // ---- SEC-028: lock waits for the final save --------------------------------
  b.ls.setItem('transactions', TX);
  await b.Storage.enableAtRest();
  b.ls.setItem('transactions', TX.replace('AAPL', 'MSFT'));
  b.Vault.lock();
  await b.Vault.lockSettled();
  const lsL = dumpLs(b);
  await settle();
  b = browser(lsL);
  await b.Vault.unlock(PW); await b.Storage.resume();
  ok('SEC-028: the edit made right before the lock was saved before lockSettled() resolved', (b.ls.getItem('transactions') || '').includes('MSFT'));
  b.Vault.lock(); await settle();

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
