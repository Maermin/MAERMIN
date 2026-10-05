// Worker share route: publish limits, benchmark accounting and storage cost,
// with and without the SyncRoom Durable Object (SYNC_DO).
// Run: node test/worker-share.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

function kvEnv() {
  const kv = new Map(); let writes = 0;
  return {
    kv, writes: () => writes,
    SYNC: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => { writes++; kv.set(k, v); } }
  };
}
// A SYNC_DO namespace whose instances share state per name, like Cloudflare's.
function doNamespace(W, env) {
  const rooms = new Map();
  return {
    idFromName: (name) => name,
    get: (name) => {
      if (!rooms.has(name)) {
        const mem = new Map(); let chain = Promise.resolve();
        const state = {
          storage: { get: async (k) => mem.get(k), put: async (k, v) => { mem.set(k, v); } },
          blockConcurrencyWhile(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }
        };
        const room = new W.SyncRoom(state, env);
        // A real stub turns fetch(url, init) into a Request for the object.
        rooms.set(name, { fetch: (u, init) => room.fetch(typeof u === 'string' ? new Request(u, init) : u) });
      }
      return rooms.get(name);
    }
  };
}

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const worker = W.default;
  const ctx = { waitUntil() {} };
  const publish = (env, ip, snapshot) => worker.fetch(new Request('https://w.example/?action=share', {
    method: 'POST', headers: { 'CF-Connecting-IP': ip }, body: JSON.stringify({ op: 'publish', snapshot })
  }), env, ctx);
  const aggregate = async (env) => (await worker.fetch(new Request('https://w.example/?action=share', { method: 'POST', body: JSON.stringify({ op: 'aggregate' }) }), env, ctx)).json();
  const skins = { v: 1, assetClasses: { skins: 100 } };
  const mixed = { v: 1, assetClasses: { stocks: 60, crypto: 40 } };

  console.log('worker share (KV only):');
  W.resetShareLimits();
  let env = kvEnv();
  let last;
  for (let i = 0; i < 11; i++) last = await publish(env, '203.0.113.9', skins);
  ok('11th publish from one client within an hour is throttled', last.status === 429);
  // Many other clients must not reset the limits of active ones.
  for (let i = 0; i < 5100; i++) W.notePublishForTest('198.51.' + (i >> 8) + '.' + (i & 255));
  last = await publish(env, '203.0.113.9', skins);
  ok('the limit survives a flood of other clients (no reset of all counters)', last.status === 429);
  // IPv6: one /64 is one client.
  W.resetShareLimits();
  for (let i = 0; i < 11; i++) last = await publish(env, '2001:db8:1:2:' + i.toString(16) + '::1', skins);
  ok('rotating addresses inside one IPv6 /64 count as one client', last.status === 429);
  // One client counts once per day in the benchmark, however often it publishes.
  W.resetShareLimits(); env = kvEnv();
  for (let i = 0; i < 5; i++) await publish(env, '192.0.2.1', skins);
  await publish(env, '192.0.2.2', mixed);
  let agg = await aggregate(env);
  ok('a client\'s repeated publishes count once in the benchmark', agg.count === 2 && agg.avgAssetClasses.skins === 50 && agg.avgAssetClasses.stocks === 30);
  const shared = await publish(env, '192.0.2.1', skins);
  ok('... but its share link still works', shared.status === 200 && !!(await shared.json()).id);

  console.log('worker share (with SYNC_DO):');
  W.resetShareLimits();
  env = kvEnv(); env.SYNC_DO = doNamespace(W, env);
  const r1 = await publish(env, '192.0.2.10', mixed);
  ok('publish works through the Durable Object', r1.status === 200);
  ok('one KV write per publish (the snapshot); the benchmark lives in the Durable Object', env.writes() === 1 && !env.kv.has('share:aggregate'));
  for (let i = 0; i < 4; i++) await publish(env, '192.0.2.10', skins);
  await publish(env, '192.0.2.11', skins);
  agg = await aggregate(env);
  ok('benchmark counted once per client per day, atomically', agg.count === 2 && agg.avgAssetClasses.skins === 50);
  // Concurrent publishes from different clients are all counted (no lost update).
  await Promise.all([20, 21, 22, 23].map((n) => publish(env, '192.0.2.' + n, mixed)));
  agg = await aggregate(env);
  ok('concurrent publishes are all counted', agg.count === 6);
  // The per-client hour limit holds across isolates (state in the Durable Object).
  W.resetShareLimits(); // a fresh isolate forgets its in-memory counters
  for (let i = 0; i < 11; i++) last = await publish(env, '192.0.2.30', mixed);
  ok('the per-client limit holds across isolates', last.status === 429);
  // A global daily budget protects the namespace's write quota.
  W.resetShareLimits();
  const env2 = kvEnv(); env2.SYNC_DO = doNamespace(W, env2); env2.SHARE_DAILY_MAX = '5';
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await publish(env2, '198.51.100.' + i, mixed)).status);
  ok('a global daily publish budget caps storage writes', codes.slice(0, 5).every((c) => c === 200) && codes[5] === 429 && env2.writes() === 5);
  // The sync route on the same Durable Object class is unaffected.
  const s = await worker.fetch(new Request('https://w.example/?action=sync', { method: 'POST', body: JSON.stringify({ op: 'put', account: 'abcdef12', baseRev: 0, blob: 'b' }) }), env, ctx);
  ok('sync through SYNC_DO still works', s.status === 200 && (await s.json()).rev === 1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
