// Worker regression tests for the 2026-10 audit, security part (docs/AUDIT.md,
// SEC-008 … SEC-016, SEC-018, SEC-024, SEC-026, H-1, H-2). The real worker.js
// runs in Node with a stubbed fetch, edge cache and KV; nothing goes online.
// Run: node test/worker-security.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

const ctx = { waitUntil() {} };
function req(url, init) { return new Request(url, init); }
function post(action, body, headers) {
  return req('https://w.example/?action=' + action, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: Object.assign({ Origin: 'https://maermin.github.io' }, headers || {}) });
}
function kvEnv() {
  const m = new Map();
  return { SYNC: { get: async (k, o) => { const v = m.get(k); return v == null ? null : (o && o.type === 'json' ? JSON.parse(v) : v); }, put: async (k, v) => { m.set(k, v); } }, _m: m };
}

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const worker = W.default;
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url) || undefined, put: async (r, resp) => { store.set(r.url, resp); } } };
  const realFetch = globalThis.fetch;
  let upstream = [];
  let reply = () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init) => { upstream.push({ url: String(input && input.url || input), init: init || {} }); return reply(String(input && input.url || input), init || {}); };
  try {
    console.log('worker security (2026-10 audit):');

    // SEC-008: a body that is not an object, and the top-level handler
    let env = kvEnv();
    let r = await worker.fetch(post('share', 'null'), env, ctx);
    ok('SEC-008: share with a non-object body -> 400', r.status === 400);
    r = await worker.fetch(post('share', { op: 'aggregate' }), { SYNC: { get: async () => { throw new Error('kv down'); } } }, ctx);
    const b8 = await r.json();
    ok('SEC-008: an uncaught failure -> 500 with CORS and no internal text', r.status === 500 && r.headers.get('Access-Control-Allow-Origin') === 'https://maermin.github.io' && b8.error === 'internal error');

    // SEC-011: declared size checked before reading
    r = await worker.fetch(req('https://w.example/?action=share', { method: 'POST', body: '{}', headers: { 'Content-Length': '999999' } }), env, ctx);
    ok('SEC-011: an oversized declared body -> 413 before parsing', r.status === 413);
    r = await worker.fetch(post('brokerproxy', 'x'.repeat(70000)), env, ctx);
    ok('SEC-011: an oversized actual body -> 413', r.status === 413);

    // SEC-013: headers
    r = await worker.fetch(req('https://w.example/?action=version'), {}, ctx);
    ok('SEC-013: nosniff on every answer', r.headers.get('X-Content-Type-Options') === 'nosniff');
    reply = () => new Response('<rss></rss>', { status: 200 });
    r = await worker.fetch(req('https://w.example/?action=news&symbol=AAPL'), {}, ctx);
    ok('SEC-013: news is served as RSS, not JSON', /rss\+xml/.test(r.headers.get('Content-Type') || ''));

    // SEC-012: upstream errors
    reply = () => new Response('nope', { status: 500 });
    r = await worker.fetch(req('https://w.example/?action=yf&symbol=MSFT&interval=1d&range=1y'), {}, ctx);
    let j = await r.json();
    ok('SEC-012: an upstream 500 -> 502 with upstreamStatus, generic text', r.status === 502 && j.upstreamStatus === 500 && j.error === 'Yahoo Finance unavailable');
    reply = () => new Response('', { status: 429 });
    r = await worker.fetch(req('https://w.example/?action=yf&symbol=NVDA&interval=1d&range=1y'), {}, ctx);
    ok('SEC-012: an upstream 429 stays 429 (the app retries later)', r.status === 429);
    reply = () => new Response('', { status: 404 });
    r = await worker.fetch(req('https://w.example/?action=yf&symbol=ZZZZ&interval=1d&range=1y'), {}, ctx);
    ok('SEC-012: an upstream 404 stays 404 (no listing)', r.status === 404);
    reply = () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443'); };
    r = await worker.fetch(req('https://w.example/?action=yf&symbol=AMD&interval=1d&range=1y'), {}, ctx);
    j = await r.json();
    ok('SEC-012: a network error does not echo its text', r.status === 502 && !/ECONNREFUSED|10\.0\.0\.1/.test(JSON.stringify(j)));

    // SEC-024: bounded parameters
    reply = () => new Response('{"quotes":[]}', { status: 200 });
    upstream = [];
    r = await worker.fetch(req('https://w.example/?action=yfsearch&q=' + 'a'.repeat(65)), {}, ctx);
    ok('SEC-024: a search query over 64 characters -> 400, nothing sent', r.status === 400 && upstream.length === 0);
    r = await worker.fetch(req('https://w.example/?action=yfsearch&q=apple&type=other'), {}, ctx);
    ok('SEC-024: an unknown search type -> 400', r.status === 400);
    r = await worker.fetch(req('https://w.example/?action=screener&scrId=anything_at_all'), {}, ctx);
    ok('SEC-024: an unknown screener id -> 400', r.status === 400);
    r = await worker.fetch(req('https://w.example/?action=screener&symbols=' + Array.from({ length: 61 }, (_, i) => 'S' + i).join(',')), {}, ctx);
    ok('SEC-024: more than 60 screener symbols -> 400', r.status === 400);
    const D = require('../discovery.js');
    ok('SEC-024: the app\'s dividend universe fits the cap', D.DIVIDEND_UNIVERSE.length <= 60 && D.DIVIDEND_UNIVERSE.every(W.isMarketSymbol));
    r = await worker.fetch(req('https://w.example/?action=news&symbol=' + encodeURIComponent('AK-47 | Redline (Field-Tested)')), {}, ctx);
    ok('SEC-024: news takes market symbols only', r.status === 400);
    const pages = [{ assets: [{ classid: '1', instanceid: '0', assetid: '9', amount: '2000000' }], descriptions: [{ classid: '1', instanceid: '0', market_hash_name: 'Case', marketable: 1 }] }];
    ok('SEC-024: a Steam stack is capped', W.parseSteamInventory(pages).length === 1000);

    // SEC-010 + H-1: broker relay
    const U = (s) => new URL(s);
    ok('SEC-010: an exact read endpoint passes', W.brokerRelayAllowed(U('https://api.binance.com/api/v3/account'), 'GET').ok);
    ok('SEC-010: a sub-path is refused', !W.brokerRelayAllowed(U('https://api.binance.com/api/v3/account/extra'), 'GET').ok);
    ok('SEC-010: an encoded path is refused', !W.brokerRelayAllowed(U('https://api.binance.com/api/v3/account%2Fx'), 'GET').ok);
    ok('SEC-010: a port is refused', !W.brokerRelayAllowed(U('https://api.binance.com:8443/api/v3/account'), 'GET').ok);
    ok('SEC-010: user info is refused', !W.brokerRelayAllowed(U('https://u:p@api.binance.com/api/v3/account'), 'GET').ok);
    const h = W.relayHeaders('api.binance.com', { 'X-MBX-APIKEY': 'k', Cookie: 'c=1', 'X-Forwarded-For': '1.2.3.4', Authorization: 'x' });
    ok('SEC-010: only the exchange\'s auth headers are relayed', h['X-MBX-APIKEY'] === 'k' && !h.Cookie && !h['X-Forwarded-For'] && !h.Authorization);
    upstream = [];
    reply = () => new Response('', { status: 302, headers: { Location: 'https://elsewhere.example/' } });
    r = await worker.fetch(post('brokerproxy', { method: 'GET', url: 'https://api.binance.com/api/v3/account?x=1#frag', headers: {} }), {}, ctx);
    j = await r.json();
    ok('H-1: the relay does not follow redirects', upstream.length === 1 && upstream[0].init.redirect === 'manual' && j.ok === false);
    ok('SEC-010: the relayed URL is rebuilt (no fragment)', upstream[0].url === 'https://api.binance.com/api/v3/account?x=1');

    // SEC-014: skin price file plausibility
    const resp = (type, len) => new Response('', { headers: Object.assign({}, type ? { 'Content-Type': type } : {}, len != null ? { 'Content-Length': String(len) } : {}) });
    ok('SEC-014: an HTML answer is not kept', !W.plausiblePriceFile(resp('text/html', 5000000)));
    ok('SEC-014: a short answer is not kept', !W.plausiblePriceFile(resp('application/json', 20)));
    ok('SEC-014: a JSON file of normal size is kept', W.plausiblePriceFile(resp('application/json', 4000000)));

    // SEC-015: the rate-limit bucket ignores X-Forwarded-For
    let limited = 0;
    for (let i = 0; i < 125; i++) {
      const rr = await worker.fetch(req('https://w.example/?action=yf&symbol=AAPL&interval=1d&range=1y', { headers: { 'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-For': '10.0.0.' + i } }), {}, ctx);
      if (rr.status === 429) limited++;
    }
    ok('SEC-015: rotating X-Forwarded-For does not escape the limit', limited > 0);

    // SEC-016: share labels and sums
    const snap = (extra) => Object.assign({ v: 1, assetClasses: { stocks: 100 } }, extra);
    W.resetShareLimits();
    env = kvEnv();
    r = await worker.fetch(post('share', { op: 'publish', snapshot: snap({ sectors: [{ name: 'Technology', pct: 60 }, { name: 'Consumer Discretionary', pct: 40 }], currencies: [{ name: 'USD', pct: 100 }] }) }), env, ctx);
    ok('SEC-016: real sector and currency labels publish', r.status === 200);
    r = await worker.fetch(post('share', { op: 'publish', snapshot: snap({ sectors: [{ name: 'Tech 12,345 EUR', pct: 10 }] }) }), env, ctx);
    ok('SEC-016: a label with figures is refused', r.status === 400);
    r = await worker.fetch(post('share', { op: 'publish', snapshot: snap({ currencies: [{ name: 'dollars', pct: 10 }] }) }), env, ctx);
    ok('SEC-016: a currency must be an ISO code', r.status === 400);
    r = await worker.fetch(post('share', { op: 'publish', snapshot: snap({ sectors: [{ name: 'Energy', pct: 100 }, { name: 'Utilities', pct: 100 }] }) }), env, ctx);
    ok('SEC-016: rows adding up to more than 100 % are refused', r.status === 400);

    // SEC-026: get re-validates
    env = kvEnv();
    env._m.set('share:' + 'ab'.repeat(8), JSON.stringify({ snapshot: { v: 1, assetClasses: { stocks: 100 }, extra: 'x' }, at: 1 }));
    env._m.set('share:' + 'cd'.repeat(8), JSON.stringify({ snapshot: { v: 0, anything: true }, at: 1 }));
    r = await worker.fetch(post('share', { op: 'get', id: 'ab'.repeat(8) }), env, ctx);
    j = await r.json();
    ok('SEC-026: a stored record is served through the allowlist (extra field dropped)', r.status === 200 && !('extra' in j.snapshot));
    r = await worker.fetch(post('share', { op: 'get', id: 'cd'.repeat(8) }), env, ctx);
    ok('SEC-026: a record outside the schema is not served', r.status === 404);

    // SEC-018: new sync accounts need a key and are limited per client
    W.resetSyncLimits();
    env = kvEnv();
    const K = 'a'.repeat(64);
    const put = (acct, ip, auth) => worker.fetch(post('sync', { op: 'put', account: acct, baseRev: 0, blob: 'b', auth }, { 'CF-Connecting-IP': ip }), env, ctx);
    r = await put('abcdef01', '198.51.100.7', undefined);
    ok('SEC-018: a new account without a key -> 426', r.status === 426);
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await put('abcdef1' + i, '198.51.100.7', { key: K })).status);
    ok('SEC-018: at most 5 new accounts per client and day', codes.slice(0, 5).every((c) => c === 200) && codes[5] === 429, codes.join(','));
    r = await put('abcdef20', '198.51.100.8', { key: K });
    ok('SEC-018: another client can still create one', r.status === 200);
    const g = await worker.fetch(post('sync', { op: 'get', account: 'abcdef20' }), env, ctx);
    ok('H-2: get reports that the account is protected', (await g.json()).protected === true);
  } finally { globalThis.fetch = realFetch; }

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
