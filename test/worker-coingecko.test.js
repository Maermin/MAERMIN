// Worker ?action=cg: CoinGecko through the Worker (the browser no longer calls
// it). Allowlist, caching, unknown coins remembered, last good copy on a 429,
// optional demo key; and the Yahoo route remembering unknown symbols.
// Run: node test/worker-coingecko.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const store = new Map();
  globalThis.caches = { default: {
    match: async (req) => { const v = store.get(req.url); return v === undefined ? undefined : new Response(v); },
    put: async (req, resp) => { store.set(req.url, await resp.text()); } } };
  const calls = [];
  let mode = 'ok';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    calls.push({ u, key: init && init.headers && init.headers['x-cg-demo-api-key'] });
    if (/coins\/kper\//.test(u)) return new Response('{"error":"coin not found"}', { status: 404 });
    if (/query1\.finance\.yahoo\.com/.test(u)) return new Response('{"chart":{"result":null}}', { status: 200 });
    if (mode === '429') return new Response('', { status: 429 });
    if (/simple\/price/.test(u)) return new Response(JSON.stringify({ bitcoin: { eur: 60000, usd: 66000 } }), { status: 200 });
    if (/market_chart/.test(u)) return new Response(JSON.stringify({ prices: [[1, 2]] }), { status: 200 });
    return new Response('{}', { status: 200 });
  };
  let ip = 0;
  const call = async (q, env) => {
    const r = await W.default.fetch(new Request('https://w.example.dev/?action=cg&' + q, { headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '10.1.0.' + (ip++ % 250) } }), env || {}, { waitUntil: (p) => p });
    return { status: r.status, cors: r.headers.get('Access-Control-Allow-Origin'), stale: r.headers.get('X-Stale'), body: await r.text() };
  };
  const flush = () => new Promise((r) => setTimeout(r, 10));
  try {
    console.log('worker ?action=cg:');
    ok('only allowlisted endpoints / parameters (no open proxy)', (await call('p=exchanges')).status === 400 && (await call('p=coins/x/tickers')).status === 400
      && (await call('p=simple/price&ids=bitcoin&vs_currencies=eur%26x%3D1')).status === 400 && calls.length === 0);
    const a = await call('p=simple/price&ids=bitcoin&vs_currencies=eur,usd&include_24hr_change=true');
    ok('prices pass through with CORS', a.status === 200 && JSON.parse(a.body).bitcoin.eur === 60000 && a.cors === 'https://maermin.github.io' && /api\.coingecko\.com\/api\/v3\/simple\/price\?ids=bitcoin/.test(calls[0].u), JSON.stringify(a));
    await flush();
    const n = calls.length;
    const b = await call('p=simple/price&ids=bitcoin&vs_currencies=eur,usd&include_24hr_change=true');
    ok('a repeat is answered from the cache (no CoinGecko call)', b.status === 200 && calls.length === n);
    const c1 = await call('p=coins/kper/market_chart&vs_currency=eur&days=30');
    await flush();
    const n2 = calls.length;
    const c2 = await call('p=coins/kper/market_chart&vs_currency=eur&days=30');
    ok('an unknown coin is a 404, remembered: not asked again', c1.status === 404 && c2.status === 404 && calls.length === n2 && c2.cors === 'https://maermin.github.io');
    mode = '429';
    const d = await call('p=simple/price&ids=bitcoin&vs_currencies=eur,usd&include_24hr_change=false');
    ok('CoinGecko refuses, nothing stored: 429 with CORS (the app sees a rate limit, not a CORS error)', d.status === 429 && d.cors === 'https://maermin.github.io');
    // drop the fresh copy, keep the stale one
    for (const k of [...store.keys()]) if (/\/cg\/simple/.test(k)) store.delete(k);
    const e = await call('p=simple/price&ids=bitcoin&vs_currencies=eur,usd&include_24hr_change=true');
    ok('CoinGecko refuses: the last good copy is served, marked X-Stale', e.status === 200 && e.stale === '1' && JSON.parse(e.body).bitcoin.eur === 60000, JSON.stringify(e));
    mode = 'ok';
    calls.length = 0;
    await call('p=coins/bitcoin/market_chart&vs_currency=eur&days=7', { COINGECKO_API_KEY: 'demo-123' });
    ok('optional COINGECKO_API_KEY is sent as the demo key header', calls[0] && calls[0].key === 'demo-123');
    ok('own rate-limit budget', W.rateBucket(null, 'cg') === 'cg');

    console.log('worker ?action=yf, unknown symbol:');
    calls.length = 0;
    const y = (sym) => W.default.fetch(new Request('https://w.example.dev/?action=yf&symbol=' + sym + '&interval=1d&range=1mo', { headers: { 'CF-Connecting-IP': '10.2.0.' + (ip++ % 250) } }), {}, { waitUntil: (p) => p });
    const y1 = await y('KPER-USD'); await flush();
    const n3 = calls.length;
    const y2 = await y('KPER-USD');
    ok('a symbol Yahoo does not know is remembered (404, no second upstream call)', y1.status === 404 && y2.status === 404 && calls.length === n3);

    console.log('steam profile links:');
    ok('a profile link with /inventory/ is accepted', W.parseSteamProfile('https://steamcommunity.com/id/maermin/inventory/').vanity === 'maermin'
      && W.parseSteamProfile('https://steamcommunity.com/profiles/76561197960287930/inventory/#730').steamid === '76561197960287930');
  } finally { globalThis.fetch = realFetch; }
  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
