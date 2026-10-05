// Node harness for P1-4 (FINDINGS.md H-6, H-7): the app pulls on start and
// shows sync errors instead of a green badge; a price refresh reports what it
// actually fetched. Real sync-engine + vault + storage, in-memory transport.
// Run: node test/sync-refresh-honesty.test.js
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
const Market = require('../market-store.js');

function MemTransport() {
  let store = null, gets = 0, mode = 'ok';
  return {
    _peek: () => store, _seed: (rec) => { store = rec; }, _gets: () => gets, _mode: (m) => { mode = m; },
    get: () => {
      gets++;
      if (mode === 'fail') return Promise.reject(new Error('sync-http-502: worker down'));
      if (mode === 'hang') return new Promise(() => {});
      return Promise.resolve(store ? { rev: store.rev, blob: store.blob } : null);
    },
    put: (account, baseRev, blob) => {
      const serverRev = store ? store.rev : 0;
      if (serverRev !== baseRev) return Promise.resolve({ conflict: true, serverRev, blob: store.blob });
      store = { rev: baseRev + 1, blob };
      return Promise.resolve({ ok: true, rev: store.rev });
    }
  };
}
const txs = () => JSON.parse(localStorage.getItem('transactions') || '[]');

(async function run() {
  console.log('sync on start (H-6):');
  await Vault.create('p1-4 test password');
  await Storage.enableAtRest();

  const none = await Sync.syncOnStart({ timeoutMs: 200 });
  ok('no sync configured -> nothing runs, nothing rejects', none && none.ran === false);

  // This device synced earlier (rev 1) ...
  localStorage.setItem('transactions', JSON.stringify([{ id: 'a', symbol: 'BTC', quantity: 1 }]));
  const transport = MemTransport();
  Sync.configure({ transport });
  await Sync.sync();
  // ... then another device added a trade (rev 2) while this one was closed.
  const remote = { v: 1, updatedAt: Date.now() + 1000, device: 'B', data: Object.assign({}, Sync.buildSnapshot().data, {
    transactions: JSON.stringify([{ id: 'a', symbol: 'BTC', quantity: 1 }, { id: 'b', symbol: 'ETH', quantity: 2 }])
  }) };
  transport._seed({ rev: 2, blob: await Vault.encryptJSON(remote) });

  let applied = false;
  Sync.onChange((ev) => { if (ev.type === 'done' && ev.result && ev.result.appliedLocal) applied = true; });
  const before = transport._gets();
  const r = await Sync.syncOnStart({ timeoutMs: 2000 });
  ok('H-6: opening the app pulls from the server', transport._gets() === before + 1 && r.ran === true && r.ok === true);
  ok('H-6: the other device\'s trade is here without clicking "Sync now"', txs().map(t => t.id).join() === 'a,b');
  ok('H-6: the pull is announced as applied (the app re-reads its data)', applied === true);
  ok('H-6: status is ok after a good sync', Sync.statusOf(Sync.getState()).state === 'ok');

  // A broken Worker: the error is recorded, not swallowed.
  transport._mode('fail');
  const bad = await Sync.syncOnStart({ timeoutMs: 2000 });
  ok('H-6: a failing sync resolves (never blocks the app) and reports the error', bad.ran === true && bad.ok === false && /worker down/.test(bad.error));
  const st = Sync.getState();
  ok('H-6: the error is stored in the sync state', !!st.lastError && /worker down/.test(st.lastError.message) && st.lastError.at > 0);
  const status = Sync.statusOf(st);
  ok('H-6: the badge status is "error", not "enabled"', status.state === 'error' && /worker down/.test(status.message));

  // Data changes schedule a sync (debounced), which also records its errors.
  const g0 = transport._gets();
  Sync.scheduleSync(10);
  Sync.scheduleSync(10); // debounced into one run
  await new Promise((res) => setTimeout(res, 120));
  ok('H-6: a data change schedules one sync', transport._gets() === g0 + 1);

  transport._mode('ok');
  await Sync.sync();
  ok('H-6: the next good sync clears the error', !Sync.getState().lastError && Sync.statusOf(Sync.getState()).state === 'ok');

  // A Worker that never answers must not hold the app back.
  transport._mode('hang');
  const t0 = Date.now();
  const slow = await Sync.syncOnStart({ timeoutMs: 80 });
  ok('H-6: a hanging Worker times out instead of blocking the start', slow.timedOut === true && Date.now() - t0 < 1000);

  console.log('price refresh summary (H-7):');
  const portfolio = {
    crypto: [{ symbol: 'BTC' }, { symbol: 'ETH' }],
    stocks: [{ symbol: 'AAPL' }, { symbol: 'SAP.DE' }],
    skins: [{ symbol: 'AK-47 | Redline (Field-Tested)' }],
    commodities: []
  };
  // Offline: nothing fetched, crypto and skins carried from last-known prices.
  const offline = Market.refreshSummary(portfolio, [], ['BTC', 'btc', 'ETH', 'eth', 'AK-47 | Redline (Field-Tested)']);
  ok('H-7: offline -> 0 of 5 positions fetched (not "84")', offline.total === 5 && offline.fetched === 0);
  ok('H-7: carried and missing are reported', offline.carried === 3 && offline.missing.join() === 'AAPL,SAP.DE');
  ok('H-7: offline is not a success', offline.outcome === 'none');
  // Partial: crypto fetched, stocks failed.
  const partial = Market.refreshSummary(portfolio, ['bitcoin', 'BTC', 'btc', 'ETH', 'eth', 'AK-47 | Redline (Field-Tested)', 'ak-47 | redline (field-tested)'], []);
  ok('H-7: partial refresh counts positions, not map keys', partial.fetched === 3 && partial.total === 5 && partial.outcome === 'partial');
  ok('H-7: stock keys are matched case-insensitively', Market.refreshSummary({ stocks: [{ symbol: 'sap.de' }] }, ['SAP.DE'], []).fetched === 1);
  const full = Market.refreshSummary(portfolio, ['btc', 'eth', 'aapl', 'sap.de', 'ak-47 | redline (field-tested)'], []);
  ok('H-7: everything fetched -> success with the position count', full.outcome === 'all' && full.fetched === 5);
  ok('H-7: an empty portfolio is not an error', Market.refreshSummary({}, [], []).outcome === 'empty');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
