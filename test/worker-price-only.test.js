// P5-3.1: the shared price Worker - the same code with PRICE_ONLY=1 serves
// market-data routes only, refuses every route that handles user data, has its
// own per-IP limit (PRICE_ONLY_RPM) and a kill switch (PRICE_ONLY_OFF=1).
// Run: node test/worker-price-only.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const worker = W.default;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const day = (d) => Math.floor(Date.parse(d + 'T14:30:00Z') / 1000);
  let upstream = 0;
  globalThis.fetch = async (url) => {
    upstream++;
    const u = String(url && url.url ? url.url : url);
    if (/finance\/chart\//.test(u)) return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: [day('2026-10-12')], indicators: { quote: [{ close: [100] }] } }] } }), { status: 200 });
    return new Response('', { status: 500 });
  };
  let ipN = 0;
  const call = async (env, q, init) => {
    const r = await worker.fetch(new Request('https://prices.example.workers.dev/?' + q, Object.assign({ headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '10.0.0.' + (init && init.ip || ++ipN) } }, init || {})), env, { waitUntil() {} });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const PO = { PRICE_ONLY: '1' };

  console.log('price-only mode:');
  const v = await call(PO, 'action=version');
  ok('version says price-only and lists only market-data routes', v.status === 200 && v.body.priceOnly === true && v.body.actions.indexOf('sync') === -1 && v.body.actions.indexOf('yf') !== -1 && v.body.storage === false, v.body);
  const yf = await call(PO, 'action=yf&symbol=AAPL&interval=1d&range=5d');
  ok('market data is served (yf)', yf.status === 200 && yf.body.prices.length === 1, yf);
  for (const [q, method] of [['action=sync', 'POST'], ['action=share', 'POST'], ['action=brokerproxy', 'POST'], ['action=mcp', 'GET'], ['action=steaminv&profile=76561198000000000', 'GET'], ['action=share&id=abc', 'GET']]) {
    const before = upstream;
    const r = await call(PO, q, { method, body: method === 'POST' ? '{}' : undefined });
    ok('refused: ' + method + ' ' + q.split('&')[0] + ' (403, no upstream call)', r.status === 403 && r.body.error === 'not available on the shared price service' && upstream === before, r);
  }
  ok('the list of price-only routes is exported', Array.isArray(W.PRICE_ONLY_ACTIONS) && W.PRICE_ONLY_ACTIONS.indexOf('hicp') !== -1 && W.PRICE_ONLY_ACTIONS.indexOf('steaminv') === -1);

  console.log('\nkill switch:');
  const off = { PRICE_ONLY: '1', PRICE_ONLY_OFF: '1' };
  const paused = await call(off, 'action=yf&symbol=AAPL&interval=1d&range=5d');
  ok('PRICE_ONLY_OFF=1 pauses every route with 503', paused.status === 503 && /paused/.test(paused.body.error), paused);
  const pv = await call(off, 'action=version');
  ok('... the version route still answers and says paused', pv.status === 200 && pv.body.paused === true);

  console.log('\nper-IP limit:');
  const lim = { PRICE_ONLY: '1', PRICE_ONLY_RPM: '3' };
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await call(lim, 'action=yf&symbol=MSFT&interval=1d&range=5d', { ip: 'limit-test' })).status);
  ok('PRICE_ONLY_RPM=3: the fourth request in a minute is refused (429)', JSON.stringify(codes) === '[200,200,200,429]', codes);
  const other = await call(lim, 'action=yf&symbol=MSFT&interval=1d&range=5d', { ip: 'another-ip' });
  ok('... per IP: another address still gets through', other.status === 200);

  console.log('\nown Worker (no PRICE_ONLY):');
  const own = await call({}, 'action=version');
  ok('an own Worker is not price-only and keeps all routes', own.body.priceOnly === false && own.body.actions.indexOf('sync') !== -1);
  const ownMcp = await call({}, 'action=mcp');
  ok('... and never answers "not available on the shared price service"', !ownMcp.body || ownMcp.body.error !== 'not available on the shared price service', ownMcp);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
