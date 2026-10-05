// CS2 skin prices & images (MaerminSkinPrices) and the Worker's `skinprices`
// pass-through route (cache, KV, stale copy, no parsing). Upstream answers
// are synthetic; the bundled image table (data/skin-images.json) is real.
// Run: node test/skin-prices.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

const fs = require('fs');
const path = require('path');
const SKP = require('../skin-prices.js');

// The shape of CSGO Trader's steam.json (USD averages).
const FILE = {
  'AK-47 | Fuel Injector (Field-Tested)': { last_24h: 212.78, last_7d: 224.47, last_30d: 225.8, last_90d: 237.4 },
  'AK-47 | Redline (Field-Tested)': { last_24h: 30.1, last_7d: 31, last_30d: 32, last_90d: 33 },
  'Fever Case': { last_24h: null, last_7d: 0.89, last_30d: 0.9, last_90d: 0.93 },
  '★ Nomad Knife': { last_24h: 0, last_7d: 0, last_30d: 0, last_90d: 191.95 },
  'Sticker | Nothing': { last_24h: null, last_7d: null, last_30d: null, last_90d: null }
};

(async function run() {
  console.log('index and prices:');
  const ix = SKP.buildIndex(FILE);
  ok('items without any price are left out', ix.list.length === 4 && !ix.byName['Sticker | Nothing']);
  ok('24 h average first', SKP.priceFor(ix, 'AK-47 | Fuel Injector (Field-Tested)') === 212.78);
  ok('else the 7-day average', SKP.priceFor(ix, 'Fever Case') === 0.89);
  ok('else 30 / 90 days', SKP.priceFor(ix, '★ Nomad Knife') === 191.95);
  ok('an upper-cased stored name is found', SKP.priceFor(ix, 'AK-47 | FUEL INJECTOR (FIELD-TESTED)') === 212.78 && SKP.priceFor(ix, 'FEVER CASE') === 0.89);
  ok('spacing is forgiven', SKP.priceFor(ix, 'AK-47|Redline  (field-tested)') === 30.1);
  ok('unknown item -> 0', SKP.priceFor(ix, 'AWP | Dragon Lore (Factory New)') === 0 && SKP.priceFor(null, 'x') === 0);

  console.log('trend for the chart:');
  const NOW = Date.parse('2026-10-05T12:00:00Z');
  const h = SKP.history(ix, 'AK-47 | Fuel Injector (Field-Tested)', NOW);
  ok('90 / 30 / 7-day and 24 h averages, then today', h.length === 5 && h.map((p) => p.price).join() === '237.4,225.8,224.47,212.78,212.78', h);
  ok('dated 90, 30, 7, 1 days back, oldest first', h[0].date === '2026-07-07' && h[1].date === '2026-09-05' && h[2].date === '2026-09-28' && h[3].date === '2026-10-04' && h[4].date === '2026-10-05');
  ok('missing averages are skipped', SKP.history(ix, 'Fever Case', NOW).length === 4);
  ok('unknown item -> no trend', SKP.history(ix, 'Nope', NOW).length === 0);

  console.log('picker search:');
  const s = SKP.search(ix, 'ak redline');
  ok('every word must match', s.length === 1 && s[0].name === 'AK-47 | Redline (Field-Tested)' && s[0].price === 30.1);
  ok('closer (shorter) names first', SKP.search(ix, 'ak-47').map((x) => x.name)[0] === 'AK-47 | Redline (Field-Tested)');
  ok('empty query -> nothing', SKP.search(ix, '  ').length === 0);

  console.log('loading through the Worker:');
  const json = (o, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => o });
  let calls = [];
  SKP.reset();
  const f1 = async (u) => { calls.push(u); return json(FILE); };
  const a = await SKP.load('my-worker.example.workers.dev/', { fetch: f1, now: 1000 });
  ok('fetches ?action=skinprices (https added)', calls[0] === 'https://my-worker.example.workers.dev?action=skinprices' && a && a.list.length === 4, calls);
  await SKP.load('https://my-worker.example.workers.dev', { fetch: f1, now: 1000 + 30 * 60000 });
  ok('kept for an hour: no second request', calls.length === 1);
  await SKP.load('https://my-worker.example.workers.dev', { fetch: f1, now: 1000 + 61 * 60000 });
  ok('after an hour: fetched again', calls.length === 2);
  SKP.reset(); calls = [];
  await Promise.all([SKP.load('https://w.example.workers.dev', { fetch: f1 }), SKP.load('https://w.example.workers.dev', { fetch: f1 })]);
  ok('two loads at once share one request', calls.length === 1);
  SKP.reset();
  ok('an older Worker without the route -> null', (await SKP.load('https://w.example.workers.dev', { fetch: async () => json({ error: 'Unknown action' }, 400) })) === null);
  ok('an error object -> null', (await SKP.load('https://w.example.workers.dev', { fetch: async () => json({ error: 'Skin prices unavailable' }) })) === null);
  ok('no Worker URL -> null without a request', (await SKP.load('', { fetch: async () => { throw new Error('called'); } })) === null);
  SKP.reset();
  await SKP.load('https://w.example.workers.dev', { fetch: f1, now: 1 });
  const kept = await SKP.load('https://w.example.workers.dev', { fetch: async () => { throw new Error('offline'); }, now: 1 + 2 * 3600000 });
  ok('a failed refresh keeps the last list', kept && kept.list.length === 4);

  console.log('images:');
  ok('image key drops wear and StatTrak™/Souvenir, keeps ★', SKP.imageKey('StatTrak™ AK-47 | Frontside Misty (Minimal Wear)') === 'AK-47 | Frontside Misty'
    && SKP.imageKey('★ StatTrak™ Gut Knife | Doppler (Factory New)') === '★ Gut Knife | Doppler' && SKP.imageKey('Souvenir AWP | Dragon Lore (Field-Tested)') === 'AWP | Dragon Lore'
    && SKP.imageKey('Fever Case') === 'Fever Case');
  const table = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'skin-images.json'), 'utf8'));
  const mine = ['AK-47 | Fuel Injector (Field-Tested)', 'FAMAS | Commemoration (Minimal Wear)', 'Desert Eagle | Blaze (Factory New)', 'Galil AR | Chatterbox (Battle-Scarred)',
    'USP-S | Kill Confirmed (Minimal Wear)', 'M4A1-S | Nitro (Well-Worn)', 'M4A1-S | Golden Coil (Field-Tested)', 'StatTrak™ Desert Eagle | Naga (Minimal Wear)',
    'StatTrak™ Galil AR | Crimson Tsunami (Factory New)', '★ StatTrak™ Gut Knife | Doppler (Factory New)', '★ Nomad Knife', '★ Skeleton Knife | Marble Fade (Factory New)',
    '★ Hand Wraps | Constrictor (Field-Tested)', 'StatTrak™ AK-47 | Frontside Misty (Minimal Wear)', 'Fever Case'];
  const missing = mine.filter((n) => !SKP.imageFor(table, n));
  ok('the bundled table has a picture for every item of the portfolio', missing.length === 0, missing);
  ok('picture URL: Steam CDN, 330x192', /^https:\/\/community\.akamai\.steamstatic\.com\/economy\/image\/[^/]+\/330x192$/.test(SKP.imageFor(table, 'Fever Case')));
  ok('no picture -> null', SKP.imageFor(table, 'Sticker | Something Unknown') === null && SKP.imageFor(null, 'Fever Case') === null);
  let n = 0;
  const imgs = await SKP.loadImages({ fetch: async (u) => { n++; return json(u === 'data/skin-images.json' ? { 'Fever Case': 'abc' } : null); } });
  await SKP.loadImages({ fetch: async () => { n++; return json({}); } });
  ok('the table is loaded once, from data/skin-images.json', imgs && imgs['Fever Case'] === 'abc' && n === 1);

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
  globalThis.fetch = async (u) => { upstream.push(String(u)); return upstreamOk ? new Response(JSON.stringify(FILE), { status: 200 }) : new Response('down', { status: 503 }); };
  const call = (env) => W.default.fetch(new Request('https://w.example/?action=skinprices', { headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '198.51.100.7' } }), env || {}, ctx);
  const r1 = await call(); const b1 = await r1.json(); await Promise.all(pending);
  ok('first call: the CSGO Trader Steam price file', upstream.length === 1 && upstream[0] === 'https://prices.csgotrader.app/latest/steam.json', upstream);
  ok('passed through unchanged, with CORS', r1.status === 200 && b1['Fever Case'].last_7d === 0.89 && r1.headers.get('Access-Control-Allow-Origin') === 'https://maermin.github.io');
  const r2 = await call(); await r2.text();
  ok('within an hour: served from the stored copy', upstream.length === 1 && r2.status === 200);
  store.get('https://cache.maermin/skinprices/steam-usd').headers['x-fetched-at'] = String(Date.now() - 2 * 3600000);
  upstreamOk = false;
  const r3 = await call(); const b3 = await r3.json();
  ok('source down: last good copy, marked stale', upstream.length === 2 && r3.status === 200 && b3['Fever Case'] && r3.headers.get('X-Stale') === '1');
  store.clear();
  const r4 = await call(); const b4 = await r4.json();
  ok('no copy and source down: 502 with an error', r4.status === 502 && /Skin prices unavailable/.test(b4.error));

  const kv = new Map();
  const SYNC = {
    getWithMetadata: async (key) => { const e = kv.get(key); return e ? { value: new Response(e.value).body, metadata: e.metadata } : { value: null, metadata: null }; },
    put: async (key, value, opts) => { kv.set(key, { value: await new Response(value).text(), metadata: opts && opts.metadata, ttl: opts && opts.expirationTtl }); },
    get: async () => null
  };
  upstream = []; upstreamOk = true; pending.length = 0;
  const k1 = await call({ SYNC }); await k1.text(); await Promise.all(pending);
  const saved = kv.get('skinprices:steam-usd');
  ok('KV: stored under its own key with fetchedAt, 3 days', !!saved && JSON.parse(saved.value)['Fever Case'] && saved.metadata.fetchedAt > 0 && saved.ttl === 3 * 86400);
  const k2 = await call({ SYNC }); await k2.text();
  ok('KV: the next call within an hour comes from KV', upstream.length === 1);
  globalThis.fetch = realFetch;

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
