// Worker hardening: CORS allowlist, yf parameter validation, share publish
// throttle, storage-agnostic sync op + the SyncRoom Durable Object.
// Run: node test/worker-hardening.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

function req(url, init) { return new Request(url, init); }

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const worker = W.default;
  console.log('worker hardening:');

  // ---- CORS ----
  W.configureOrigins({});
  const o = (origin) => W.allowOrigin(req('https://w.example/', { headers: origin ? { Origin: origin } : {} }));
  ok('official app origin allowed', o('https://maermin.github.io') === 'https://maermin.github.io');
  ok('arbitrary github.io page rejected', o('https://evil.github.io') === '');
  ok('arbitrary pages.dev / workers.dev rejected', o('https://x.pages.dev') === '' && o('https://x.workers.dev') === '');
  ok('localhost allowed', o('http://localhost:5173') === 'http://localhost:5173');
  ok('no Origin (curl) -> *', o(null) === '*');
  ok('desktop null origin allowed by default', o('null') === 'null');
  W.configureOrigins({ ALLOWED_ORIGINS: 'https://my.example.com/', ALLOW_NULL_ORIGIN: 'false' });
  ok('custom origin from ALLOWED_ORIGINS', o('https://my.example.com') === 'https://my.example.com');
  ok('null origin can be disabled', o('null') === '');
  W.configureOrigins({});

  const ctx = { waitUntil() {} };
  const env = {};
  // ---- yf parameter validation (no network: rejected before any fetch) ----
  let r = await worker.fetch(req('https://w.example/?action=yf&symbol=AAPL&interval=1d&range=' + encodeURIComponent('1y&period1=0')), env, ctx);
  ok('injected range rejected with 400', r.status === 400);
  r = await worker.fetch(req('https://w.example/?action=yf&symbol=AAPL&interval=' + encodeURIComponent('1d#') + '&range=1y'), env, ctx);
  ok('fragment in interval rejected with 400', r.status === 400);

  // ---- sync op over a fake store ----
  let rec = null;
  const store = { get: async () => rec, put: async (x) => { rec = x; } };
  let out = await W.handleSyncOp(store, { op: 'put', account: 'abcdef12', baseRev: 0, blob: 'b1' });
  ok('first put creates rev 1', out.status === 200 && out.body.rev === 1);
  out = await W.handleSyncOp(store, { op: 'put', account: 'abcdef12', baseRev: 0, blob: 'b2' });
  ok('stale baseRev -> 409 conflict', out.status === 409 && out.body.conflict === true);
  out = await W.handleSyncOp(store, { op: 'put', account: 'abcdef12', baseRev: 1, blob: 'x'.repeat(4_000_001) });
  ok('oversized blob -> 413', out.status === 413);

  // ---- SyncRoom serialises concurrent puts ----
  const mem = new Map();
  let chain = Promise.resolve();
  const state = {
    storage: { get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, v); } },
    blockConcurrencyWhile(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }
  };
  const room = new W.SyncRoom(state, {});
  const put = (blob) => room.fetch(new Request('https://sync.internal/', { method: 'POST', body: JSON.stringify({ op: 'put', account: 'abcdef12', baseRev: 0, blob }) }));
  const [a, b] = await Promise.all([put('A'), put('B')]);
  ok('two concurrent writers: exactly one wins, the other gets 409', [a.status, b.status].sort().join(',') === '200,409');
  ok('stored record is the winner at rev 1', mem.get('rec').rev === 1);
  // adopts an existing KV record on first use
  const kv = { get: async () => ({ rev: 7, blob: 'old' }) };
  const room2 = new W.SyncRoom({ storage: { get: async () => undefined, put: async () => {} }, blockConcurrencyWhile: (fn) => fn() }, { SYNC: kv });
  const g = await (await room2.fetch(new Request('https://sync.internal/', { method: 'POST', body: JSON.stringify({ op: 'get', account: 'abcdef12' }) }))).json();
  ok('SyncRoom adopts the existing KV record', g.rev === 7 && g.blob === 'old');

  // ---- share publish throttle ----
  const kvStore = new Map();
  const envShare = { SYNC: { get: async (k) => (kvStore.has(k) ? JSON.parse(kvStore.get(k)) : null), put: async (k, v) => { kvStore.set(k, v); } } };
  const snap = { v: 1, assetClasses: { stocks: 60, crypto: 40 } };
  let last = null;
  for (let i = 0; i < 11; i++) {
    last = await worker.fetch(req('https://w.example/?action=share', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' }, body: JSON.stringify({ op: 'publish', snapshot: snap }) }), envShare, ctx);
  }
  ok('11th publish within an hour is throttled (429)', last.status === 429);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
