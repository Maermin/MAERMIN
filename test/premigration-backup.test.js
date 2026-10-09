// Node harness for the copy taken before a schema migration (P4-0).
// Run: node test/premigration-backup.test.js
'use strict';
if (!globalThis.crypto) globalThis.crypto = require('node:crypto').webcrypto;
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''))); }

globalThis.localStorage = {
  _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
};
const M = require('../migrations.js');
const B = require('../backup-engine.js');
const PM = require('../premigration-backup.js');

// A vault that really encrypts (AES-GCM, base64), like MaerminVault.encryptJSON.
async function makeVault() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  let unlocked = true;
  return {
    isUnlocked: () => unlocked, lock() { unlocked = false; },
    async encryptJSON(obj) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
      return JSON.stringify({ iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(ct).toString('base64') });
    },
    async decryptJSON(env) {
      const e = JSON.parse(env);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(e.iv, 'base64') }, key, Buffer.from(e.ct, 'base64'));
      return JSON.parse(new TextDecoder().decode(pt));
    }
  };
}
function makeIdb(opts) {
  opts = opts || {};
  const m = new Map();
  return {
    m, writes: 0,
    isSupported: () => opts.supported !== false,
    get: (k) => Promise.resolve(m.has(k) ? m.get(k) : null),
    set(k, v) {
      if (opts.hang) return new Promise(() => {});
      if (opts.fail) return Promise.reject(new Error('QuotaExceededError'));
      this.writes++; m.set(k, v); return Promise.resolve();
    },
    del: (k) => { m.delete(k); return Promise.resolve(); }
  };
}
function reset(version, store) {
  localStorage._d = {};
  if (version != null) localStorage.setItem(M.VERSION_KEY, String(version));
  Object.keys(store || {}).forEach((k) => localStorage.setItem(k, store[k]));
}
// A legacy book from schema v3: v4 repairs the year-less price timestamps.
const LEGACY = {
  transactions: JSON.stringify([{ id: 't1', category: 'stocks', type: 'buy', symbol: 'ZZQX', quantity: 7, price: 123.45, currency: 'EUR', date: '2024-03-01' }]),
  priceHistory: JSON.stringify({ zzqx: [{ timestamp: '12/30, 08:14 PM', price: 120 }] }),
  theme: '"dark"'
};

(async function run() {
  console.log('pending():');
  reset(3, LEGACY);
  ok('lists the migrations above the saved version', M.pending().map((m) => m.v).join(',') === M.MIGRATIONS.filter((m) => m.v > 3).map((m) => m.v).join(','));
  reset(M.LATEST, LEGACY);
  ok('is empty at the latest version', M.pending().length === 0);

  console.log('copy, then migrate:');
  {
    reset(3, LEGACY);
    const vault = await makeVault(), idb = makeIdb();
    const firstPending = M.pending()[0];
    const up = firstPending.up;
    let copyBeforeFirstUp = null;
    firstPending.up = function () { copyBeforeFirstUp = idb.m.has(PM.RECORD); return up.apply(this, arguments); };
    const s = await PM.guardedRun({ vault, idb, migrations: M, backup: B, storage: localStorage, now: Date.UTC(2026, 9, 9, 12) });
    firstPending.up = up;
    ok('the copy is written before the first migration runs', copyBeforeFirstUp === true);
    ok('the migrations ran afterwards', M.getVersion() === M.LATEST && /^\d{4}-/.test(JSON.parse(localStorage.getItem('priceHistory')).zzqx[0].timestamp));
    ok('status: taken, with from/to versions', s.state === 'taken' && s.fromVersion === 3 && s.toVersion === M.LATEST && PM.status() === s);
    const raw = idb.m.get(PM.RECORD);
    ok('the stored record holds no plaintext (symbol, price, key names)', typeof raw === 'string' && !/ZZQX|123\.45|transactions|priceHistory/.test(raw));
    const inf = await PM.info({ vault, idb, backup: B });
    ok('info(): date, versions and transaction count', inf && inf.createdAt === '2026-10-09T12:00:00.000Z' && inf.fromVersion === 3 && inf.toVersion === M.LATEST && inf.transactionCount === 1, JSON.stringify(inf));

    console.log('restore:');
    localStorage.setItem('transactions', JSON.stringify([]));       // the user changed data after the update
    localStorage.setItem('maermin_watchlist', '["NEW"]');           // a key the copy does not hold stays
    const n = await PM.restore({ vault, idb, backup: B, migrations: M, storage: localStorage });
    ok('puts back every key of the copy', n === 3 && localStorage.getItem('transactions') === LEGACY.transactions && localStorage.getItem('priceHistory') === LEGACY.priceHistory, 'n=' + n);
    ok('sets the schema version back to the copy\'s', M.getVersion() === 3);
    ok('leaves keys the copy did not hold (same rule as a file restore)', localStorage.getItem('maermin_watchlist') === '["NEW"]');

    console.log('one copy only:');
    const s2 = await PM.guardedRun({ vault, idb, migrations: M, backup: B, storage: localStorage, now: Date.UTC(2026, 9, 10) });
    ok('the next migration replaces the copy', s2.state === 'taken' && idb.m.size === 1 && (await PM.info({ vault, idb, backup: B })).createdAt === '2026-10-10T00:00:00.000Z');

    console.log('discard:');
    await PM.discard({ idb });
    ok('deletes the copy', !idb.m.has(PM.RECORD) && (await PM.info({ vault, idb, backup: B })) === null);
  }

  console.log('nothing to do:');
  {
    reset(M.LATEST, LEGACY);
    const vault = await makeVault(), idb = makeIdb();
    const s = await PM.guardedRun({ vault, idb, migrations: M, backup: B, storage: localStorage });
    ok('no pending migration → no copy', s.state === 'current' && idb.writes === 0);
    reset(0, { theme: '"dark"', maermin_language: '"de"', transactions: '[]' });
    const s2 = await PM.guardedRun({ vault, idb, migrations: M, backup: B, storage: localStorage });
    ok('a new vault (preferences only) gets no copy and still migrates', s2.state === 'empty' && idb.writes === 0 && M.getVersion() === M.LATEST);
  }

  console.log('no copy → no migration on this load:');
  for (const [label, mk] of [
    ['IndexedDB write fails (quota)', async () => ({ vault: await makeVault(), idb: makeIdb({ fail: true }) })],
    ['no IndexedDB', async () => ({ vault: await makeVault(), idb: makeIdb({ supported: false }) })],
    ['vault locked', async () => { const v = await makeVault(); v.lock(); return { vault: v, idb: makeIdb() }; }],
    ['IndexedDB never answers (timeout)', async () => ({ vault: await makeVault(), idb: makeIdb({ hang: true }), timeoutMs: 50 })]
  ]) {
    reset(3, LEGACY);
    const d = await mk();
    const s = await PM.guardedRun(Object.assign({ migrations: M, backup: B, storage: localStorage }, d));
    ok(label + ': blocked, data and version unchanged', s.state === 'blocked' && !!s.reason && M.getVersion() === 3 && localStorage.getItem('priceHistory') === LEGACY.priceHistory, JSON.stringify(s));
  }
  {
    const vault = await makeVault();
    const s = await PM.guardedRun({ vault, idb: makeIdb(), migrations: M, backup: B, storage: localStorage });
    ok('the next load with a working store copies and migrates', s.state === 'taken' && M.getVersion() === M.LATEST);
    ok('blockedText names the reason', /QuotaExceeded/.test(PM.blockedText({ reason: 'QuotaExceededError' })));
  }

  console.log('another vault key:');
  {
    reset(3, LEGACY);
    const v1 = await makeVault(), idb = makeIdb();
    await PM.guardedRun({ vault: v1, idb, migrations: M, backup: B, storage: localStorage });
    const v2 = await makeVault();
    const inf = await PM.info({ vault: v2, idb, backup: B });
    ok('a copy from another vault reads as unreadable', inf && inf.unreadable === true);
    let rejected = false;
    await PM.restore({ vault: v2, idb, backup: B, migrations: M, storage: localStorage }).catch(() => { rejected = true; });
    ok('…and is never restored', rejected && M.getVersion() === M.LATEST);
  }

  console.log('scope:');
  ok('the copy is not a key of the full backup', B.KEYS.indexOf(PM.RECORD) === -1);
  ok('hasUserData ignores preferences and empty stores', !PM.hasUserData({ store: { theme: '"dark"', transactions: '[]', maermin_notes: '{}' } }) && PM.hasUserData({ store: { maermin_notes: '{"a":1}' } }));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
