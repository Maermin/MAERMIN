// P5-2.9: the Worker's `hicp` route - Eurostat's HICP (prc_hicp_minr, all
// items, index 2015 = 100) for one euro-area region, as [[YYYY-MM, value]].
// Run: node test/worker-hicp.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

(async function run() {
  const worker = (await import('../cf-worker/worker.js')).default;
  const upstream = [];
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => (store.has(r.url) ? new Response(store.get(r.url)) : undefined), put: async (r, resp) => { store.set(r.url, await resp.text()); } } };
  // JSON-stat 2.0 as Eurostat answers: values keyed by position, one missing month
  globalThis.fetch = async (url) => {
    const u = String(url && url.url ? url.url : url);
    upstream.push(u);
    if (/ec\.europa\.eu\/eurostat\/api\/dissemination\/statistics\/1\.0\/data\/prc_hicp_minr/.test(u)) {
      return new Response(JSON.stringify({ version: '2.0', class: 'dataset', updated: '2026-10-02T11:00:00+0200', id: ['freq', 'unit', 'coicop18', 'geo', 'time'], size: [1, 1, 1, 1, 4],
        value: { 0: 125.1, 1: 125.6, 3: 126.4 },
        dimension: { time: { category: { index: { '2026-06': 0, '2026-07': 1, '2026-08': 2, '2026-09': 3 } } } } }), { status: 200 });
    }
    return new Response('', { status: 500 });
  };
  const call = async (q) => {
    const r = await worker.fetch(new Request('https://maermin-test.workers.dev/?' + q, { headers: { Origin: 'https://maermin.github.io' } }), {}, { waitUntil(p) { return p; } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  console.log('worker hicp:');
  const r = await call('action=hicp&geo=DE');
  ok('200 with the months in order, a missing month left out', r.status === 200 && JSON.stringify(r.body.months) === JSON.stringify([['2026-06', 125.1], ['2026-07', 125.6], ['2026-09', 126.4]]), r.body);
  ok('region, base and the update date', r.body.geo === 'DE' && r.body.base === '2015=100' && r.body.updated === '2026-10-02');
  ok('Eurostat asked for all items, index 2015 = 100, this region only', /prc_hicp_minr\?/.test(upstream[0]) && /geo=DE/.test(upstream[0]) && /unit=I15/.test(upstream[0]) && /coicop18=TOTAL/.test(upstream[0]), upstream[0]);
  await new Promise((res) => setTimeout(res, 10));
  await call('action=hicp&geo=DE');
  ok('a second request comes from the cache', upstream.length === 1, upstream.length);
  const bad = await call('action=hicp&geo=US');
  ok('a region outside the euro area is refused', bad.status === 400 && upstream.length === 1);
  const inj = await call('action=hicp&geo=DE%26unit%3DRCH_A');
  ok('no parameter injection through geo', inj.status === 400);
  globalThis.fetch = async () => new Response('', { status: 503 });
  store.clear();
  const down = await call('action=hicp&geo=AT');
  ok('Eurostat down: an upstream error, not a crash', down.status >= 500 && down.status < 600 && down.body && down.body.error, down);
  const W = await import('../cf-worker/worker.js');
  ok('listed among the Worker actions', W.WORKER_ACTIONS.indexOf('hicp') !== -1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
