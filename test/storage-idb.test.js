// Node harness for storage.js's IndexedDB blob backend. IndexedDB itself is
// browser-only, so we inject a Map-backed mock MaerminIDB (isSupported:true) and
// verify: the encrypted blob goes to IDB (NOT localStorage), survives a
// lock→unlock→resume cycle, and an existing localStorage blob is transparently
// migrated into IDB on first read. The localStorage fallback is covered by
// vault.test.js (no IDB present there). Run: node test/storage-idb.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

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

// Map-backed mock IndexedDB exposing the MaerminIDB contract.
function MockIDB() {
  const m = new Map();
  return {
    _map: m,
    isSupported: () => true,
    get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, String(v)); return Promise.resolve(); },
    del: (k) => { m.delete(k); return Promise.resolve(); },
  };
}
const idb = MockIDB();
globalThis.window = { localStorage, addEventListener() {}, MaerminIDB: idb };

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = require('node:crypto').webcrypto;
}

const Vault = require('../crypto-vault.js');
const Storage = require('../storage.js');
const BLOB = Storage.BLOB_KEY;

(async function run() {
  console.log('storage-idb:');
  await Vault.create('idb-test-password');

  localStorage.setItem('transactions', JSON.stringify([{ s: 'BTC', q: 1 }]));
  await Storage.enableAtRest();

  ok('blob is NOT in localStorage (routed to IDB)', localStorage.getItem(BLOB) === null);
  ok('blob IS in IndexedDB', !!idb._map.get(BLOB));
  ok('IDB blob is ciphertext (no plaintext leak)', !String(idb._map.get(BLOB)).includes('BTC'));
  ok('sensitive read via shim still returns plaintext',
    localStorage.getItem('transactions') === JSON.stringify([{ s: 'BTC', q: 1 }]));

  // write through the shim, flush → updated blob persists to IDB
  localStorage.setItem('transactions', JSON.stringify([{ s: 'ETH', q: 2 }]));
  await Storage.flush();
  Vault.lock();
  ok('locked → sensitive read is null', localStorage.getItem('transactions') === null);

  await Vault.unlock('idb-test-password');
  await Storage.resume();
  ok('after unlock+resume the updated value hydrates from IDB',
    localStorage.getItem('transactions') === JSON.stringify([{ s: 'ETH', q: 2 }]));

  // ---- transparent migration: an existing localStorage blob moves to IDB ----
  console.log('storage-idb — migration from localStorage:');
  const blobNow = idb._map.get(BLOB);
  // Simulate a pre-IDB user: blob sits in localStorage, IDB is empty.
  localStorage.setItem(BLOB, blobNow);
  idb._map.delete(BLOB);
  Vault.lock();
  await Vault.unlock('idb-test-password');
  await Storage.resume(); // hydrate → blobGet sees empty IDB, migrates from LS

  ok('migrated value still decrypts', localStorage.getItem('transactions') === JSON.stringify([{ s: 'ETH', q: 2 }]));
  ok('blob migrated into IDB', !!idb._map.get(BLOB));
  ok('localStorage blob cleared after migration', localStorage.getItem(BLOB) === null);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
