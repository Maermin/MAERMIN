// Regression tests for the hardening/review fixes (security layer, sync,
// savings/dividend auto-booking, tax FIFO, CSV import/export, exchange sync).
// Run: node test/review-fixes.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
async function throws(name, p, msgIncludes) {
  try { await p; failed++; console.error('  ✗ ' + name + ' (did not throw)'); }
  catch (e) {
    const good = !msgIncludes || (e && String(e.message).includes(msgIncludes));
    if (good) { passed++; console.log('  ✓ ' + name); }
    else { failed++; console.error('  ✗ ' + name + ' (wrong error: ' + (e && e.message) + ')'); }
  }
}
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

// ---- minimal browser stubs (same pattern as vault.test.js) ----
class StorageMock {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  get length() { return this._d.size; }
  key(i) { return Array.from(this._d.keys())[i] || null; }
}
globalThis.Storage = StorageMock;
const localStorage = new StorageMock();
globalThis.localStorage = localStorage;
globalThis.window = { localStorage, addEventListener() {} };
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

// Capture the REAL storage methods before storage.js installs its shim.
const rawGet = StorageMock.prototype.getItem, rawSet = StorageMock.prototype.setItem;
const Vault = require('../crypto-vault.js');
const Storage = require('../storage.js');
const Sync = require('../sync-engine.js');
const nativeGet = (k) => rawGet.call(localStorage, k);
const FAST = { params: { iterations: 1000, hash: 'SHA-256' } };

(async function run() {
  // ───────────────────────── at-rest encryption ─────────────────────────
  console.log('at-rest encryption:');
  localStorage.setItem('transactions', JSON.stringify([{ id: 't1', symbol: 'BTC', quantity: 1 }]));
  localStorage.setItem('apiKeys', JSON.stringify({ alphaVantage: 'SECRET' }));
  await Vault.create('pw-one-two-three', FAST);
  await Storage.enableAtRest();
  ok('no plaintext pre-encryption backup remains', nativeGet(Storage.BACKUP_KEY) === null);
  ok('sensitive originals removed from native storage', nativeGet('transactions') === null && nativeGet('apiKeys') === null);

  // legacy installs: a leftover backup is removed on the next successful unlock
  rawSet.call(localStorage, Storage.BACKUP_KEY, JSON.stringify({ data: { apiKeys: 'SECRET' } }));

  console.log('lock / flush:');
  let keyAtListener = null;
  Vault.onLock(() => { keyAtListener = Vault.isUnlocked(); });
  localStorage.setItem('transactions', JSON.stringify([{ id: 't1' }, { id: 't2' }])); // pending (debounced) write
  Vault.lock();
  ok('lock listeners run while the key is still available', keyAtListener === true);
  ok('key wiped after lock', !Vault.isUnlocked());
  await new Promise((r) => setTimeout(r, 50));

  localStorage.setItem('priceHistory', JSON.stringify({ BTC: [{ price: 1 }] }));
  localStorage.setItem('transactions', '[]');
  ok('sensitive write while locked never lands in plaintext', nativeGet('priceHistory') === null && nativeGet('transactions') === null);
  localStorage.setItem('theme', 'light');
  ok('non-sensitive writes still work while locked', nativeGet('theme') === 'light');

  await Vault.unlock('pw-one-two-three');
  const resumed = await Storage.resume();
  ok('resume succeeds', resumed === true);
  ok('write pending at lock time was flushed (not lost)', localStorage.getItem('transactions') === JSON.stringify([{ id: 't1' }, { id: 't2' }]));
  ok('write attempted while locked was dropped', localStorage.getItem('priceHistory') === null);
  ok('legacy plaintext backup removed on unlock', nativeGet(Storage.BACKUP_KEY) === null);

  // ───────────────────────── sync ─────────────────────────
  console.log('sync:');
  // In-memory transport shared by "both devices".
  let server = null;
  const transport = {
    get: async () => (server ? { rev: server.rev, blob: server.blob } : null),
    put: async (acct, baseRev, blob) => {
      const rev = server ? server.rev : 0;
      if (rev !== baseRev) return { conflict: true, serverRev: rev, blob: server.blob };
      server = { rev: rev + 1, blob };
      return { ok: true, rev: rev + 1 };
    }
  };
  Sync.configure({ transport });
  localStorage.setItem('transactions', JSON.stringify([{ id: 'a', qty: 1 }, { id: 'b', qty: 2 }]));
  localStorage.setItem('maermin_portfolios', JSON.stringify(['old']));
  const first = await Sync.sync();
  ok('first sync pushes', first.ok && server && server.rev === 1);

  // Another device edits `a`, deletes `b`, renames the portfolio and pushes.
  const remoteSnap = { v: 1, updatedAt: Date.now() - 60000, device: 'other', data: Object.assign({}, Storage.snapshotPlaintext(), {
    transactions: JSON.stringify([{ id: 'a', qty: 5 }]),
    maermin_portfolios: JSON.stringify(['new'])
  }) };
  server = { rev: 2, blob: await Vault.encryptJSON(remoteSnap) };
  const second = await Sync.sync();
  ok('idle device fast-forwards to the remote state', second.pulled === true && second.appliedLocal === true);
  ok('remote edit is applied (not reverted)', localStorage.getItem('transactions') === JSON.stringify([{ id: 'a', qty: 5 }]));
  ok('remote deletion is applied (not resurrected)', !localStorage.getItem('transactions').includes('"b"'));
  ok('non-transaction key takes the remote value', localStorage.getItem('maermin_portfolios') === JSON.stringify(['new']));

  // Concurrent edits: tombstones + edit stamps decide instead of a blind union.
  const t0 = 1000;
  const localMeta = JSON.stringify({ deleted: { x: t0 + 5 }, edited: { y: t0 + 1 } });
  const remoteMeta = JSON.stringify({ deleted: {}, edited: { y: t0 + 9 } });
  const u = Sync.unionTransactions(
    JSON.stringify([{ id: 'y', v: 'local' }, { id: 'n1' }]),
    JSON.stringify([{ id: 'x' }, { id: 'y', v: 'remote' }, { id: 'n2' }]),
    localMeta, remoteMeta);
  const merged = JSON.parse(u.str);
  ok('deleted on one side stays deleted', !merged.some((t) => t.id === 'x'));
  ok('newer edit wins over older edit', merged.find((t) => t.id === 'y').v === 'remote');
  ok('additions from both sides kept', merged.some((t) => t.id === 'n1') && merged.some((t) => t.id === 'n2'));
  const tr = Sync.trackTxChanges({ a: JSON.stringify({ id: 'a', q: 1 }), b: JSON.stringify({ id: 'b' }) }, [{ id: 'a', q: 2 }], null, 5000);
  ok('trackTxChanges stamps edits and deletions', tr.changed && tr.meta.edited.a === 5000 && tr.meta.deleted.b === 5000);
  ok('first tracking pass only seeds (no stamps)', Sync.trackTxChanges(null, [{ id: 'a' }], null).changed === false);

  const failing = Sync.WorkerTransport({ endpoint: 'https://w.example', fetchImpl: async () => ({ status: 413, json: async () => ({ error: 'invalid blob' }) }) });
  await throws('HTTP error on put is an error, not "synced"', failing.put('abcdef12', 0, 'x'), 'sync-http-413');
  const failingGet = Sync.WorkerTransport({ endpoint: 'https://w.example', fetchImpl: async () => ({ status: 429, json: async () => ({ error: 'rate limited' }) }) });
  await throws('HTTP error on get is an error, not "no remote"', failingGet.get('abcdef12'), 'sync-http-429');

  // ───────────────────────── savings plans ─────────────────────────
  console.log('savings plans:');
  const EX = require('../savings-plan-executor.js');
  global.window.MaerminRecurring = require('../recurring.js');
  const plan = { id: 'p1', symbol: 'BTC', amount: 100, frequency: 'monthly', startDate: '2026-07-01', category: 'crypto' };
  const booked = EX.runCatchUp([plan], [], () => 50000, '2026-09-15');
  ok('books three monthly executions', booked.created.length === 3);
  ok('generated ids are unique', new Set(booked.created.map((t) => t.id)).size === 3);
  const aug = booked.created.find((t) => t.dueDate === '2026-08-01');
  const sk = EX.markSkipped([plan], [aug]);
  ok('deleting an execution records a skipped date', sk.changed && sk.plans[0].skippedDates.includes('2026-08-01'));
  const again = EX.runCatchUp(sk.plans, booked.transactions.filter((t) => t !== aug), () => 50000, '2026-09-15');
  ok('skipped date is not booked again', again.created.length === 0);
  ok('todayISO is the LOCAL date', EX.todayISO(new Date(2026, 0, 1, 0, 30)) === '2026-01-01');

  // ───────────────────────── tax FIFO ─────────────────────────
  console.log('tax FIFO:');
  const TR = require('../tax-report-builder.js');
  ok('anniversary sale is NOT long-term (> 1 year required)', TR.heldOverOneYear('2025-03-15', '2026-03-15') === false);
  ok('day after anniversary is long-term', TR.heldOverOneYear('2025-03-15', '2026-03-16') === true);
  ok('365 days across a leap day is still within one year', TR.heldOverOneYear('2024-01-10', '2025-01-09') === false);
  ok('29 Feb purchase: period ends 28 Feb', TR.oneYearAnniversary('2024-02-29') === '2025-02-28');
  const d1 = TR.fifo([
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 100, fees: 10, currency: 'EUR', date: '2026-02-01' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 200, fees: 0, currency: 'EUR', date: '2026-03-01' }
  ], 2026, 1);
  ok('buy fees are part of the cost basis', d1.length === 1 && near(d1[0].costBasis, 110) && near(d1[0].gain, 90));
  const d2 = TR.fifo([
    { type: 'sell', category: 'stocks', symbol: 'X', quantity: 2, price: 12, currency: 'EUR', date: '2026-05-05' },
    { type: 'buy', category: 'stocks', symbol: 'X', quantity: 2, price: 10, currency: 'EUR', date: '2026-05-05' }
  ], 2026, 1);
  ok('same-day round trip is realised (sell listed first)', d2.length === 1 && near(d2[0].gain, 4));

  const TCE = require('../tax-calculation-engine.js');
  const calc = TCE.calculateRealizedGainsAdvanced || (TCE.TaxCalculationEngine && TCE.TaxCalculationEngine.calculateRealizedGainsAdvanced);
  if (typeof calc === 'function') {
    const g = calc([
      { type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 100, date: '2024-01-01' },
      { type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 300, date: '2025-06-01' },
      { type: 'sell', category: 'crypto', symbol: 'ETH', quantity: 1, price: 150, date: '2024-06-01' }, // consumes the 2024 lot
      { type: 'sell', category: 'crypto', symbol: 'ETH', quantity: 1, price: 400, date: '2026-01-10' }
    ], 2026);
    // The 2026 sale must match the 2025 lot (the 2024 lot was sold in 2024): 400 - 300.
    ok('prior-year sells consume their lots before the tax year', near(g.cryptoShortTermGains, 100) && near(g.cryptoLongTermGains, 0));
    const g2 = calc([
      { type: 'buy', category: 'crypto', symbol: 'SOL', quantity: 1, price: 100, date: '2024-01-01' },
      { type: 'buy', category: 'crypto', symbol: 'SOL', quantity: 1, price: 300, date: '2025-06-01' },
      { type: 'sell', category: 'crypto', symbol: 'SOL', quantity: 2, price: 400, date: '2026-01-10' }
    ], 2026);
    ok('each lot classified on its own holding period', near(g2.cryptoLongTermGains, 300) && near(g2.cryptoShortTermGains, 100));
  } else {
    ok('calculateRealizedGainsAdvanced exported', false);
  }

  // ───────────────────────── CSV ─────────────────────────
  console.log('CSV import/export:');
  const IE = require('../import-export-engine.js');
  const parsed = IE.parseCSV('﻿Date,Symbol,Note\r\n2026-01-01,BTC,"line1\nline2"\n\n2026-01-02,ETH,"say ""hi"""\n');
  ok('BOM stripped from first header', parsed.headers[0] === 'Date');
  ok('quoted newline stays in one record', parsed.rows.length === 2 && parsed.rows[0].Note === 'line1\nline2');
  ok('escaped quotes parsed', parsed.rows[1].Note === 'say "hi"');
  const csv = IE.exportToCSV([{ date: '2026-01-01', type: 'buy', symbol: '=HYPERLINK("x")', quantity: -1, price: 2 }]);
  ok('formula-like text is neutralised', csv.includes('"\'=HYPERLINK(""x"")"'));
  ok('negative numbers are not prefixed', csv.includes('"-1"'));

  // ───────────────────────── misc ─────────────────────────
  console.log('misc:');
  const U = require('../utils.js');
  ok('safeUrl keeps https', U.safeUrl('https://finance.yahoo.com/x') === 'https://finance.yahoo.com/x');
  ok('safeUrl rejects javascript:', U.safeUrl('javascript:alert(1)') === '#');
  ok('safeUrl rejects data:', U.safeUrl('data:text/html,<b>') === '#');

  const XS = require('../exchange-sync.js');
  const pairs = XS.binanceCandidatePairs([{ asset: 'BTC', free: '0.1', locked: '0' }, { asset: 'USDT', free: '5', locked: '0' }, { asset: 'DOGE', free: '0', locked: '0' }],
    [{ category: 'crypto', symbol: 'ETH' }]);
  ok('Binance pairs come from balances + held crypto', pairs.includes('BTCUSDT') && pairs.includes('ETHEUR') && !pairs.some((p) => p.startsWith('DOGE')) && !pairs.some((p) => p.startsWith('USDT')));
  const fills = [
    { symbol: 'BTC', type: 'buy', quantity: 0.1, price: 100, date: '2026-01-01', source: 'exchange-sync', exchange: 'binance', externalId: 'BTCEUR:1' },
    { symbol: 'BTC', type: 'buy', quantity: 0.1, price: 100, date: '2026-01-01', source: 'exchange-sync', exchange: 'binance', externalId: 'BTCEUR:2' }
  ];
  ok('two identical fills on one day both import', XS.mergeSync([], fills).added.length === 2);
  ok('a manual row absorbs exactly one matching fill', XS.mergeSync([{ symbol: 'BTC', type: 'buy', quantity: 0.1, price: 100, date: '2026-01-01' }], fills).added.length === 1);

  const DDS = require('../dividend-data-service.js');
  const svc = DDS.calculatePayDate ? DDS : (DDS.DividendDataService || DDS);
  if (typeof svc.calculatePayDate === 'function') ok('pay date = ex-date + 14 days (UTC)', svc.calculatePayDate('2026-03-20') === '2026-04-03');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
