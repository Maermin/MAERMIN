// Node harness: a device that synced before must be able to sync again when
// the server has no record any more (a new Worker / KV namespace, a wiped
// record). Before the fix every sync failed with 'bad-envelope' for good.
// The transport follows cf-worker/worker.js: a put with a baseRev the server
// does not have answers 409 { serverRev, blob: null } when nothing is stored.
// Run: node test/sync-server-reset.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
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
const Storage = require('../storage.js');
const Sync = require('../sync-engine.js');

let store = null, registered = 0, wipeBeforePut = false;
const transport = {
  get: () => Promise.resolve(store ? { rev: store.rev, blob: store.blob } : null),
  put: (account, baseRev, blob, auth) => {
    if (wipeBeforePut) { store = null; wipeBeforePut = false; } // record vanishes between get and put
    if (auth && auth.key) registered++;
    const serverRev = store ? store.rev : 0;
    if (serverRev !== baseRev) return Promise.resolve({ conflict: true, serverRev, blob: store ? store.blob : null });
    store = { rev: baseRev + 1, blob };
    return Promise.resolve({ ok: true, rev: store.rev });
  }
};

(async function run() {
  console.log('sync after a server reset:');
  await Vault.create('server-reset password');
  await Storage.enableAtRest();
  localStorage.setItem('transactions', JSON.stringify([{ id: 1, symbol: 'BTC' }]));
  Sync.configure({ transport });
  await Sync.sync();
  localStorage.setItem('transactions', JSON.stringify([{ id: 1, symbol: 'BTC' }, { id: 2, symbol: 'ETH' }]));
  await Sync.sync();
  ok('setup: two syncs, server at rev 2', store && store.rev === 2 && Sync.getState().rev === 2);

  // The user deploys a new Worker: its storage is empty.
  store = null; registered = 0;
  let res = null, err = null;
  try { res = await Sync.sync(); } catch (e) { err = e; }
  ok('the next sync succeeds (was: bad-envelope forever)', !err && res && res.ok === true);
  ok('the local data is uploaded again', store && store.rev === 1 && JSON.parse((await Vault.decryptJSON(store.blob)).data.transactions).length === 2);
  ok('the device registers its write key with the new server', registered === 1);
  ok('the local revision follows the server', Sync.getState().rev === 1 && !Sync.getState().lastError);
  ok('local data is untouched', JSON.parse(localStorage.getItem('transactions')).length === 2);
  res = await Sync.sync();
  ok('later syncs work normally', res.ok === true && (res.unchanged === true || res.rev === 1));

  // The record disappears between the get and the put (conflict without a blob).
  localStorage.setItem('transactions', JSON.stringify([{ id: 1, symbol: 'BTC' }, { id: 2, symbol: 'ETH' }, { id: 3, symbol: 'SOL' }]));
  wipeBeforePut = true; err = null;
  try { res = await Sync.sync(); } catch (e) { err = e; }
  ok('a conflict without server data re-uploads instead of failing', !err && res.ok === true && store && store.rev === 1 &&
    JSON.parse((await Vault.decryptJSON(store.blob)).data.transactions).length === 3);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
