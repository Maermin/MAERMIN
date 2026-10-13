// P5-2.5: the Worker's `yf` route passes Yahoo's dividend events on as
// `dividends: [{ date, amount }]` (oldest first) next to prices and splits, for
// the backtest in Dividends → History. Additive: older clients ignore it.
// Run: node test/worker-dividends.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

(async function run() {
  const worker = (await import('../cf-worker/worker.js')).default;
  const day = (d) => Math.floor(Date.parse(d + 'T14:30:00Z') / 1000);
  const upstream = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (url) => {
    const u = String(url && url.url ? url.url : url);
    upstream.push(u);
    if (/finance\/chart\/KO/.test(u)) {
      return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: [day('2024-12-01'), day('2025-01-01')],
        indicators: { quote: [{ close: [62, 63] }] },
        events: { dividends: { b: { date: day('2025-03-14'), amount: 0.51 }, a: { date: day('2024-11-29'), amount: 0.485 }, bad: { date: day('2025-01-01'), amount: 0 } } } }] } }), { status: 200 });
    }
    if (/finance\/chart\/NODIV/.test(u)) {
      return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'EUR' }, timestamp: [day('2025-01-01')], indicators: { quote: [{ close: [10] }] } }] } }), { status: 200 });
    }
    return new Response('', { status: 500 });
  };
  const call = async (q) => {
    const r = await worker.fetch(new Request('https://maermin-test.workers.dev/?' + q, { headers: { Origin: 'https://maermin.github.io' } }), {}, { waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };
  console.log('worker yf dividends:');
  const ko = await call('action=yf&symbol=KO&interval=1mo&range=10y');
  ok('monthly 10-year range is allowed', ko.status === 200 && /interval=1mo&range=10y/.test(upstream[0]), [ko.status, upstream[0]]);
  ok('dividend events as [{ date, amount }], oldest first, zero amounts dropped',
    JSON.stringify(ko.body.dividends) === JSON.stringify([{ date: '2024-11-29', amount: 0.485 }, { date: '2025-03-14', amount: 0.51 }]), ko.body.dividends);
  ok('prices, splits and currency unchanged', ko.body.currency === 'USD' && ko.body.prices.length === 2 && Array.isArray(ko.body.splits));
  const nd = await call('action=yf&symbol=NODIV&interval=1d&range=1y');
  ok('no dividend events: an empty list (so the app can tell an updated Worker)', Array.isArray(nd.body.dividends) && nd.body.dividends.length === 0, nd.body);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
