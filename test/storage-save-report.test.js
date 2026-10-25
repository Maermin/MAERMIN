// storage.js reports every encrypted save to MaerminStorageHealth (feature 2,
// audit 2026-10-24): a failed write (quota, blocked storage) used to be
// swallowed by persist(); now it reaches the app, which warns the user.
// Same mocks as test/storage-idb.test.js, with an IndexedDB that can fail.
// Run: node test/storage-save-report.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

class StorageMock {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
}
globalThis.Storage = StorageMock;
const localStorage = new StorageMock();
globalThis.localStorage = localStorage;

let fail = false;
const m = new Map();
const idb = {
  isSupported: () => true,
  get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null),
  set: (k, v) => { if (fail) { const e = new Error('full'); e.name = 'QuotaExceededError'; return Promise.reject(e); } m.set(k, String(v)); return Promise.resolve(); },
  del: (k) => { m.delete(k); return Promise.resolve(); }
};
const reports = [];
globalThis.window = { localStorage, addEventListener() {}, MaerminIDB: idb,
  MaerminStorageHealth: { reportSave: (okFlag, err) => reports.push(okFlag ? 'ok' : 'fail:' + (err && err.name)) } };
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

const Vault = require('../crypto-vault.js');
const Storage = require('../storage.js');

(async () => {
  console.log('save reports:');
  await Vault.create('save-report-test-pw');
  localStorage.setItem('transactions', JSON.stringify([{ s: 'BTC', q: 1 }]));
  await Storage.enableAtRest();
  reports.length = 0;
  localStorage.setItem('transactions', JSON.stringify([{ s: 'BTC', q: 2 }]));
  await Storage.flush();
  ok('a successful save is reported as ok', reports[reports.length - 1] === 'ok', reports);
  fail = true;
  localStorage.setItem('transactions', JSON.stringify([{ s: 'BTC', q: 3 }]));
  const res = await Storage.flush();
  ok('a failed save is reported with its error name', res === false && reports[reports.length - 1] === 'fail:QuotaExceededError', reports);
  fail = false;
  const before = m.size, keysBefore = [...m.values()].join('|');
  const retried = await Storage.flush();
  ok('the next save retries the failed change (written although nothing new was set)', retried === true && [...m.values()].join('|') !== keysBefore && reports[reports.length - 1] === 'ok', { before, after: m.size, reports });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
