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

  // regression: an EDIT (same id, different content) must sync — the newer blob
  // wins. Previously local always won, so edits made on another device were lost.
  const edR = Sync.unionTransactions(
    JSON.stringify([{ id: 1, symbol: 'BTC', quantity: 1 }]),
    JSON.stringify([{ id: 1, symbol: 'BTC', quantity: 5 }]),
    true  // remoteNewer
  );
  ok('edit collision: remote-newer wins', JSON.parse(edR.str)[0].quantity === 5 && JSON.parse(edR.str).length === 1);
  const edL = Sync.unionTransactions(
    JSON.stringify([{ id: 1, symbol: 'BTC', quantity: 1 }]),
    JSON.stringify([{ id: 1, symbol: 'BTC', quantity: 5 }]),
    false // localNewer
  );
  ok('edit collision: local-newer wins', JSON.parse(edL.str)[0].quantity === 1);

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

  console.log('sync — write authorization (HMAC) end-to-end:');
  // An "enforcing" transport that gates writes with the REAL worker logic, so
  // the client's derived authKey/MAC is verified exactly as the Cloudflare
  // worker would. Proves the client+server interplay, not just the units.
  const W = await import('../cf-worker/worker.js');
  function EnforcingTransport() {
    let store = null;
    return {
      _peek: () => store,
      get: (account) => Promise.resolve(store ? { rev: store.rev, blob: store.blob } : null),
      put: async (account, baseRev, blob, auth) => {
        const authz = await W.authorizeSyncPut(store, account, baseRev, blob, auth);
        if (!authz.ok) return { unauthorized: true };
        const serverRev = store ? store.rev : 0;
        if (serverRev !== baseRev) return { conflict: true, serverRev, blob: store.blob };
        store = { rev: baseRev + 1, blob, updatedAt: Date.now() };
        if (authz.authKey) store.authKey = authz.authKey;
        return { ok: true, rev: store.rev };
      }
    };
  }
  const et = EnforcingTransport();
  Sync.configure({ transport: et });
  localStorage.removeItem(Sync.STATE_KEY); // fresh "first push" → creates + registers
  const er = await Sync.sync();
  ok('authorized first sync registers a key and writes', er.ok && et._peek().rev === 1 && /^[a-f0-9]{64}$/.test(et._peek().authKey || ''));

  const acct = await Sync.accountId();
  const foreignNoAuth = await et.put(acct, et._peek().rev, 'forged-blob', null);
  ok('unauthenticated foreign write is rejected (403)', foreignNoAuth.unauthorized === true);
  const wrongMac = await W.syncMac('00'.repeat(32), acct + '.' + et._peek().rev + '.forged');
  const foreignWrongKey = await et.put(acct, et._peek().rev, 'forged', { mac: wrongMac });
  ok('foreign write with a wrong key/MAC is rejected', foreignWrongKey.unauthorized === true);

  // the legitimate client can still sync again (valid MAC over the new rev)
  localStorage.setItem('transactions', JSON.stringify([{ id: 1, symbol: 'BTC', quantity: 1 }, { id: 7, symbol: 'DOT', quantity: 2 }]));
  const er2 = await Sync.sync();
  ok('legitimate client keeps writing after registration', er2.ok && et._peek().rev >= 2);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
