// Node harness for storage.js's IndexedDB per-key backend (v12). IndexedDB is
// browser-only, so we inject a Map-backed mock MaerminIDB (isSupported:true) and
// verify: at-rest writes ONE encrypted record per sensitive key + an encrypted
// manifest (NO monolithic blob, no plaintext key names), a single-key edit
// rewrites only that record, lock→unlock→resume rehydrates from the records,
// a legacy single-blob vault transparently migrates to per-key on unlock, and
// disable clears everything. The localStorage fallback (no IDB) is covered by
// vault.test.js. Run: node test/storage-idb.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
const PW = 'idb-test-password';
const MANIFEST = 'maermin_vault_manifest';

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

function MockIDB() {
  const m = new Map(), log = { set: [], del: [] };
  return {
    _map: m, _log: log, isSupported: () => true,
    get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, String(v)); log.set.push(k); return Promise.resolve(); },
    del: (k) => { m.delete(k); log.del.push(k); return Promise.resolve(); },
  };
}
const idb = MockIDB();
globalThis.window = { localStorage, addEventListener() {}, MaerminIDB: idb };
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

const Vault = require('../crypto-vault.js');
const Storage = require('../storage.js');
const BLOB = Storage.BLOB_KEY;
const recKeys = () => [...idb._map.keys()].filter((k) => k.startsWith('r:'));

(async function run() {
  console.log('storage-idb (per-key):');
  await Vault.create(PW);

  localStorage.setItem('transactions', JSON.stringify([{ s: 'BTC', q: 1 }]));
  localStorage.setItem('maermin_portfolios', JSON.stringify([{ id: 'p1' }]));
  await Storage.enableAtRest();

  ok('no monolithic blob in IDB', idb._map.get(BLOB) == null);
  ok('no blob in localStorage', localStorage.getItem(BLOB) === null);
  ok('encrypted manifest present in IDB', !!idb._map.get(MANIFEST));
  ok('one record per sensitive key', recKeys().length === 2);
  ok('records + manifest are ciphertext (no plaintext leak)',
    recKeys().every((k) => !String(idb._map.get(k)).includes('BTC')) &&
    !String(idb._map.get(MANIFEST)).includes('transactions') &&
    !String(idb._map.get(MANIFEST)).includes('maermin_portfolios'));
  ok('sensitive read via shim returns plaintext',
    localStorage.getItem('transactions') === JSON.stringify([{ s: 'BTC', q: 1 }]));

  // a single-key edit rewrites only that key's record (write amplification fix)
  idb._log.set.length = 0;
  localStorage.setItem('transactions', JSON.stringify([{ s: 'ETH', q: 2 }]));
  await Storage.flush();
  ok('only one record rewritten on a single-key change',
    idb._log.set.filter((k) => k.startsWith('r:')).length === 1);

  // lock → unlock → resume rehydrates from the per-key records
  Vault.lock();
  ok('locked → sensitive read is null', localStorage.getItem('transactions') === null);
  await Vault.unlock(PW);
  await Storage.resume();
  ok('rehydrated updated value from records', localStorage.getItem('transactions') === JSON.stringify([{ s: 'ETH', q: 2 }]));
  ok('other key survived', localStorage.getItem('maermin_portfolios') === JSON.stringify([{ id: 'p1' }]));

  // adding a NEW sensitive key creates a new record
  const before = recKeys().length;
  localStorage.setItem('maermin_watchlist', JSON.stringify(['AAPL']));
  await Storage.flush();
  ok('new sensitive key adds a record', recKeys().length === before + 1);

  // ---- legacy single-blob vault migrates to per-key on unlock ----------------
  console.log('storage-idb — migration (blob → per-key):');
  const backup = await Storage.exportEncryptedBackup(); // one encrypted blob of the snapshot
  // craft a Phase-1 state: blob present, no manifest / records
  [...idb._map.keys()].filter((k) => k.startsWith('r:') || k === MANIFEST).forEach((k) => idb._map.delete(k));
  idb._map.set(BLOB, backup.blob);
  Vault.lock();
  await Vault.unlock(PW);
  await Storage.resume();   // hydrate: no manifest → reads blob, schedules migration
  await Storage.flush();    // force the per-key write + old-blob delete
  ok('migration created an encrypted manifest', !!idb._map.get(MANIFEST));
  ok('migration wrote per-key records', recKeys().length >= 2);
  ok('migration deleted the old blob', idb._map.get(BLOB) == null);
  ok('migrated data still decrypts', localStorage.getItem('transactions') === JSON.stringify([{ s: 'ETH', q: 2 }]));

  // ---- disable clears per-key records + manifest -----------------------------
  await Storage.disableAtRest();
  ok('manifest removed on disable', idb._map.get(MANIFEST) == null);
  ok('records removed on disable', recKeys().length === 0);
  ok('plaintext restored on disable', localStorage.getItem('transactions') === JSON.stringify([{ s: 'ETH', q: 2 }]));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
