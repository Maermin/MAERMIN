// Skinport price list: index, lookup, picker search and loading
// (MaerminSkinport), plus the Worker's `skinport` pass-through route
// (cache, stale copy, no parsing). Upstream answers are synthetic.
// Run: node test/skinport.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

const SP = require('../skinport.js');

const ROWS = [
  { market_hash_name: 'AK-47 | Fuel Injector (Field-Tested)', currency: 'USD', suggested_price: 169.94, min_price: 134.22, median_price: 146.29, quantity: 9 },
  { market_hash_name: 'AK-47 | Redline (Field-Tested)', currency: 'USD', suggested_price: 32.74, min_price: 24.51, median_price: 28.26, quantity: 73 },
  { market_hash_name: 'Fever Case', currency: 'USD', suggested_price: null, min_price: 0.55, median_price: 0.7, quantity: 949 },
  { market_hash_name: '★ Nomad Knife', currency: 'USD', suggested_price: null, median_price: null, min_price: 112.63, quantity: 16 },
  { market_hash_name: 'Sticker | Nothing', currency: 'USD', suggested_price: null, median_price: null, min_price: null, quantity: 0 },
  null
];

(async function run() {
  console.log('index and prices:');
  const ix = SP.buildIndex(ROWS);
  ok('items without any price are left out', ix.list.length === 4 && !ix.byName['Sticker | Nothing']);
  ok('suggested price first', SP.priceFor(ix, 'AK-47 | Fuel Injector (Field-Tested)') === 169.94);
  ok('else the median', SP.priceFor(ix, 'Fever Case') === 0.7);
  ok('else the lowest listing', SP.priceFor(ix, '★ Nomad Knife') === 112.63);
  ok('lookup ignores case (an upper-cased stored name)', SP.priceFor(ix, 'AK-47 | FUEL INJECTOR (FIELD-TESTED)') === 169.94 && SP.priceFor(ix, 'FEVER CASE') === 0.7);
  ok('lookup fixes spacing', SP.priceFor(ix, 'AK-47|Redline  (field-tested)') === 32.74);
  ok('unknown item -> 0', SP.priceFor(ix, 'AWP | Dragon Lore (Factory New)') === 0 && SP.priceFor(null, 'x') === 0);

  console.log('picker search:');
  const s = SP.search(ix, 'ak redline');
  ok('every word must match', s.length === 1 && s[0].name === 'AK-47 | Redline (Field-Tested)' && s[0].price === 32.74 && s[0].image === null);
  const s2 = SP.search(ix, 'ak-47');
  ok('most-listed first', s2.length === 2 && s2[0].name === 'AK-47 | Redline (Field-Tested)');
  ok('empty query -> nothing', SP.search(ix, '  ').length === 0);

  console.log('loading through the Worker:');
  const json = (o, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => o });
  let calls = [];
  SP.reset();
  const f1 = async (u) => { calls.push(u); return json(ROWS); };
  const a = await SP.load('my-worker.example.workers.dev/', { fetch: f1, now: 1000 });
  ok('fetches ?action=skinport (https added, trailing slash removed)', calls[0] === 'https://my-worker.example.workers.dev?action=skinport' && a && a.list.length === 4, calls);
  const b = await SP.load('https://my-worker.example.workers.dev', { fetch: f1, now: 1000 + 5 * 60000 });
  ok('kept 10 minutes: no second request', calls.length === 1 && b === a);
  await SP.load('https://my-worker.example.workers.dev', { fetch: f1, now: 1000 + 11 * 60000 });
  ok('after 10 minutes: fetched again', calls.length === 2);
  SP.reset(); calls = [];
  const [p1, p2] = [SP.load('https://w.example.workers.dev', { fetch: f1 }), SP.load('https://w.example.workers.dev', { fetch: f1 })];
  await Promise.all([p1, p2]);
  ok('two loads at once share one request', calls.length === 1);
  SP.reset();
  ok('older Worker without the route (404) -> null, caller uses Steam', (await SP.load('https://w.example.workers.dev', { fetch: async () => json({ error: 'not found' }, 404) })) === null);
  ok('an error object instead of a list -> null', (await SP.load('https://w.example.workers.dev', { fetch: async () => json({ error: 'Skinport unavailable' }) })) === null);
  ok('no Worker URL -> null without a request', (await SP.load('', { fetch: async () => { throw new Error('called'); } })) === null);
  SP.reset();
  await SP.load('https://w.example.workers.dev', { fetch: f1, now: 1 });
  const kept = await SP.load('https://w.example.workers.dev', { fetch: async () => { throw new Error('offline'); }, now: 1 + 20 * 60000 });
  ok('a failed refresh keeps the last list', kept && kept.list.length === 4);

  console.log('Worker route:');
  const W = await import('../cf-worker/worker.js');
  const store = new Map();
  globalThis.caches = { default: {
    match: async (req) => { const e = store.get(req.url); return e ? new Response(e.body, { headers: e.headers }) : undefined; },
    put: async (req, resp) => { store.set(req.url, { body: await resp.text(), headers: Object.fromEntries(resp.headers) }); }
  } };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const realFetch = globalThis.fetch;
  let upstream = [], upstreamOk = true;
  globalThis.fetch = async (u, init) => {
    upstream.push({ u: String(u), enc: init && init.headers && init.headers['Accept-Encoding'] });
    return upstreamOk ? new Response(JSON.stringify(ROWS), { status: 200 }) : new Response('busy', { status: 429 });
  };
  const call = () => W.default.fetch(new Request('https://w.example/?action=skinport', { headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '198.51.100.7' } }), {}, ctx);
  const r1 = await call(); const body1 = await r1.json(); await Promise.all(pending);
  ok('first call: Skinport /v1/items in USD, Brotli requested', upstream.length === 1 && /api\.skinport\.com\/v1\/items\?app_id=730&currency=USD/.test(upstream[0].u) && upstream[0].enc === 'br', upstream);
  ok('the list is passed through unchanged, with CORS', r1.status === 200 && Array.isArray(body1) && body1.length === ROWS.length && r1.headers.get('Access-Control-Allow-Origin') === 'https://maermin.github.io');
  const r2 = await call(); await r2.text();
  ok('within 10 minutes: served from the edge copy', upstream.length === 1 && r2.status === 200);
  // Age the copy, make Skinport refuse: the stale copy is served and marked.
  const k = 'https://cache.maermin/skinport/items-usd';
  store.get(k).headers['x-fetched-at'] = String(Date.now() - 30 * 60000);
  upstreamOk = false;
  const r3 = await call(); const body3 = await r3.json();
  ok('Skinport refuses: last good copy, marked stale', upstream.length === 2 && r3.status === 200 && body3.length === ROWS.length && r3.headers.get('X-Skinport-Stale') === '1');
  store.clear();
  const r4 = await call(); const body4 = await r4.json();
  ok('no copy and Skinport refuses: 502 with an error', r4.status === 502 && /Skinport unavailable/.test(body4.error));

  // With a KV namespace bound as SYNC the list is kept there (the edge cache
  // keeps nothing on workers.dev); streamed in and out, with fetchedAt metadata.
  const kv = new Map();
  const SYNC = {
    getWithMetadata: async (key) => { const e = kv.get(key); return e ? { value: new Response(e.value).body, metadata: e.metadata } : { value: null, metadata: null }; },
    put: async (key, value, opts) => { kv.set(key, { value: await new Response(value).text(), metadata: opts && opts.metadata, ttl: opts && opts.expirationTtl }); },
    get: async () => null
  };
  upstream = []; upstreamOk = true; pending.length = 0;
  const kvCall = () => W.default.fetch(new Request('https://w.example/?action=skinport', { headers: { 'CF-Connecting-IP': '198.51.100.8' } }), { SYNC }, ctx);
  const k1 = await kvCall(); await k1.text(); await Promise.all(pending);
  const saved = kv.get('skinport:items-usd');
  ok('KV: the list is stored under its own key with fetchedAt, 24 h', !!saved && JSON.parse(saved.value).length === ROWS.length && saved.metadata.fetchedAt > 0 && saved.ttl === 86400);
  const k2 = await kvCall(); const kb2 = await k2.json();
  ok('KV: the next call within 10 minutes is served from KV', upstream.length === 1 && kb2.length === ROWS.length);
  saved.metadata.fetchedAt = Date.now() - 30 * 60000; upstreamOk = false;
  const k3 = await kvCall(); await k3.text();
  ok('KV: Skinport refuses -> stale copy from KV', k3.status === 200 && k3.headers.get('X-Skinport-Stale') === '1');
  globalThis.fetch = realFetch;

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
