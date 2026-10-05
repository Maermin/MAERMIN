// Node harness for P1-8 (storage): the market-data caches are stored like
// the other symbol-bearing keys - encrypted at rest, adopted from older
// plaintext on unlock, and kept device-local (never in the sync snapshot).
// Run: node test/harden-storage.test.js
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
const fs = require('fs');
// storage.js installs its shim on Storage.prototype: keep the native accessors
// to look at what is really stored.
const nativeGet = StorageMock.prototype.getItem, nativeSet = StorageMock.prototype.setItem;
const Vault = require('../crypto-vault.js');
const Storage = require('../storage.js');
const Sync = require('../sync-engine.js');

// The caches and the modules that write them.
const CACHES = {
  maermin_price_meta: 'data-quality.js',
  maermin_equity_meta_cache: 'equity-metadata.js',
  maermin_dividend_cache: 'dividend-data-service.js',
  maermin_marketcap_cache: 'market-cap.js',
  maermin_symbol_suffix: 'renderer.js',
  maermin_div_notified: 'dividend-reminder.js'
};
const raw = (k) => nativeGet.call(localStorage, k);

(async function run() {
  console.log('harden-storage:');
  Object.keys(CACHES).forEach((k) => {
    ok(k + ' is the key ' + CACHES[k] + ' writes', fs.readFileSync(require.resolve('../' + CACHES[k]), 'utf8').includes(k));
  });

  // A device from an older build: the caches sit in plaintext before the vault.
  const SYMBOL = 'NVDA';
  Object.keys(CACHES).forEach((k) => localStorage.setItem(k, JSON.stringify({ [SYMBOL]: { at: 1 } })));
  await Vault.create('harden-storage pw');
  await Storage.enableAtRest();

  Object.keys(CACHES).forEach((k) => {
    ok(k + ' is encrypted at rest', Storage.isSensitive(k));
    ok(k + ' no longer readable in raw storage', raw(k) === null);
    ok(k + ' still readable through the shim after unlock', String(localStorage.getItem(k)).includes(SYMBOL));
  });
  const blob = String(raw(Storage.BLOB_KEY) || '');
  ok('the held symbol is not in the stored data in plaintext', !blob.includes(SYMBOL));

  // Device caches stay on the device.
  const snap = Sync.buildSnapshot().data;
  ok('none of the caches is part of the sync snapshot', Object.keys(CACHES).every((k) => snap[k] === undefined));

  // Locked: nothing to read.
  await Storage.flush();
  Vault.lock();
  ok('locked: the caches read as empty', Object.keys(CACHES).every((k) => localStorage.getItem(k) === null));

  // Older plaintext left behind next to an encrypted vault is adopted on unlock.
  nativeSet.call(localStorage, 'maermin_price_meta', JSON.stringify({ AMD: { at: 2 } }));
  await Vault.unlock('harden-storage pw');
  await Storage.resume();
  await new Promise((r) => setTimeout(r, 50));
  ok('plaintext left behind is moved into the vault on unlock', raw('maermin_price_meta') === null);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
