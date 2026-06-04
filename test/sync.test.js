// Node harness for the cloud-sync engine. Exercises the real crypto blob +
// merge/conflict logic against an in-memory mock transport (the same contract
// the Cloudflare worker / Drive / OneDrive transports implement).
// Run: node test/sync.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

// ---- DOM stubs ----
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

// Web Crypto is a global from Node 20+ but not on Node 18 (CI matrix). Polyfill
// from node:crypto when missing so crypto-vault.js sees `crypto.subtle`.
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  try { globalThis.crypto = require('node:crypto').webcrypto; }
  catch (e) { Object.defineProperty(globalThis, 'crypto', { value: require('node:crypto').webcrypto, configurable: true }); }
}

const Vault = require('../crypto-vault.js');
const Storage = require('../storage.js');
const Sync = require('../sync-engine.js');

// ---- in-memory transport implementing the get/put contract (rev concurrency) ----
function MemTransport() {
  let store = null; // { rev, blob }
  return {
    _peek: () => store,
    _seed: (rec) => { store = rec; },
    get: (account) => Promise.resolve(store ? { rev: store.rev, blob: store.blob } : null),
    put: (account, baseRev, blob) => {
      const serverRev = store ? store.rev : 0;
      if (serverRev !== baseRev) return Promise.resolve({ conflict: true, serverRev, blob: store.blob });
      store = { rev: baseRev + 1, blob };
      return Promise.resolve({ ok: true, rev: store.rev });
    }
  };
}

(async function run() {
  await Vault.create('sync-test-password');

  console.log('sync — pure merge logic:');
  // transaction union never drops entries
  const u = Sync.unionTransactions(
    JSON.stringify([{ id: 1, symbol: 'BTC' }, { id: 2, symbol: 'ETH' }]),
    JSON.stringify([{ id: 2, symbol: 'ETH' }, { id: 3, symbol: 'SOL' }])
  );
  const merged = JSON.parse(u.str);
  ok('union dedupes by id and keeps all unique', merged.length === 3 && u.added === 1);

  // mergeSnapshots: transactions unioned, other keys last-write-wins
  const local = { v: 1, updatedAt: 100, device: 'A', data: {
    transactions: JSON.stringify([{ id: 1, symbol: 'BTC' }]),
    maermin_targets: JSON.stringify({ crypto: 50 })
  }};
  const remote = { v: 1, updatedAt: 200, device: 'B', data: {
    transactions: JSON.stringify([{ id: 2, symbol: 'ETH' }]),
    maermin_targets: JSON.stringify({ crypto: 30 })
  }};
  const m = Sync.mergeSnapshots(local, remote);
  ok('merge unions transactions across devices',
    JSON.parse(m.merged.data.transactions).length === 2);
  ok('merge LWW takes newer remote for scalar key',
    m.merged.data.maermin_targets === JSON.stringify({ crypto: 30 }));
  ok('merge reports conflicts', m.conflicts.length === 2 &&
    m.conflicts.some(c => c.key === 'transactions' && c.resolution === 'union'));

  console.log('sync — end-to-end with mock transport:');
  // Device A: set data, configure transport, first sync → creates remote rev 1
  localStorage.setItem('transactions', JSON.stringify([{ id: 1, symbol: 'BTC', quantity: 1 }]));
  const transport = MemTransport();
  Sync.configure({ transport });
  await Storage.enableAtRest(); // sync reads via snapshotPlaintext (works at-rest or not)
  let r = await Sync.sync();
  ok('first sync pushes (rev 1)', r.ok && r.rev === 1 && transport._peek().rev === 1);

  // server is opaque ciphertext (no plaintext leak)
  ok('stored blob is ciphertext (no symbol leak)', !String(transport._peek().blob).includes('BTC'));

  // no local change → second sync is a no-op alignment
  r = await Sync.sync();
  ok('idempotent sync when unchanged', r.unchanged === true || r.rev === 1);

  // Simulate ANOTHER device writing remotely (rev bumps under us), then local
  // edits and syncs → must detect conflict, merge (union), and re-push at rev 3.
  const otherSnap = { v: 1, updatedAt: Date.now() + 1000, device: 'B', data: {
    transactions: JSON.stringify([{ id: 2, symbol: 'ETH', quantity: 5 }])
  }};
  const otherBlob = await Vault.encryptJSON(otherSnap);
  transport._seed({ rev: 2, blob: otherBlob });

  localStorage.setItem('transactions', JSON.stringify([{ id: 1, symbol: 'BTC', quantity: 1 }, { id: 9, symbol: 'ADA', quantity: 3 }]));
  r = await Sync.sync();
  const finalTx = JSON.parse(localStorage.getItem('transactions'));
  const syms = finalTx.map(t => t.symbol).sort();
  ok('conflict resolved, all three devices\' txs merged locally',
    syms.length === 3 && syms.join(',') === 'ADA,BTC,ETH');
  ok('re-pushed above server rev', r.ok && r.rev >= 3 && transport._peek().rev >= 3);

  // a second device pulling fresh gets the merged set
  const pulled = await Vault.decryptJSON(transport._peek().blob);
  ok('remote blob now holds the merged transactions',
    JSON.parse(pulled.data.transactions).length === 3);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
