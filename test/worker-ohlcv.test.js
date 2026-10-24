// CH-1: the Worker's `yf` route returns candles. Each `prices[]` entry gains
// `o`, `h`, `l`, `v` next to `ts`, `date`, `price` (price stays the close, so
// older clients read the same numbers); intraday bars stay apart by `ts`; the
// cache key moves to `yf3`; an interval / range pair Yahoo would refuse gets a
// clear 400 before any upstream call; `action=version` reports `ohlcv: true`.
// All numbers below are made up.
// Run: node test/worker-ohlcv.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const worker = W.default;
  const at = (iso) => Math.floor(Date.parse(iso) / 1000);
  const upstream = [];
  const cacheKeys = [];
  globalThis.caches = { default: { match: async (req) => { cacheKeys.push(String(req.url || req)); return undefined; }, put: async () => {} } };

  // Yahoo's chart shape: timestamp[] + indicators.quote[0].{open,high,low,close,volume}
  const daily = { meta: { currency: 'EUR', exchangeTimezoneName: 'Europe/Berlin' },
    timestamp: [at('2026-03-02T08:00:00Z'), at('2026-03-03T08:00:00Z'), at('2026-03-04T08:00:00Z'), at('2026-03-05T08:00:00Z')],
    indicators: { quote: [{
      open:   [10.0, 10.6, null, 11.0],
      high:   [10.8, 11.2, 11.5, 11.4],
      low:    [9.9,  10.4, 10.9, null],
      close:  [10.5, 11.0, null, 11.2],
      volume: [1200, 1500, 900,  'x'],
    }] } };
  const intraday = { meta: { currency: 'USD' },
    timestamp: [at('2026-03-02T14:30:00Z'), at('2026-03-02T14:35:00Z'), at('2026-03-02T14:40:00Z')],
    indicators: { quote: [{ open: [50, 50.4, 50.1], high: [50.6, 50.5, 50.3], low: [49.8, 50.0, 49.9], close: [50.4, 50.1, 50.2], volume: [300, 0, 250] }] } };
  const closesOnly = { meta: { currency: 'USD' }, timestamp: [at('2026-03-02T14:30:00Z')], indicators: { quote: [{ close: [7] }] } };

  globalThis.fetch = async (url) => {
    const u = String(url && url.url ? url.url : url);
    upstream.push(u);
    const body = /chart\/DAILY/.test(u) ? daily : /chart\/INTRA/.test(u) ? intraday : /chart\/CLOSE/.test(u) ? closesOnly : null;
    if (!body) return new Response('', { status: 500 });
    return new Response(JSON.stringify({ chart: { result: [body] } }), { status: 200 });
  };
  const call = async (q, env) => {
    const r = await worker.fetch(new Request('https://maermin-test.workers.dev/?' + q, { headers: { Origin: 'https://maermin.github.io' } }), env || {}, { waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };

  console.log('worker yf OHLCV:');
  const d = await call('action=yf&symbol=DAILY&interval=1d&range=1mo');
  ok('daily: 200', d.status === 200, d.status);
  ok('daily: a bar without a close is dropped (3 of 4 kept)', d.body.prices.length === 3, d.body.prices);
  ok('daily: open / high / low / volume next to the close', JSON.stringify(d.body.prices[0]) === JSON.stringify({ ts: daily.timestamp[0], date: '2026-03-02', price: 10.5, o: 10.0, h: 10.8, l: 9.9, v: 1200 }), d.body.prices[0]);
  ok('daily: missing or non-numeric fields are null, the bar stays', d.body.prices[2].l === null && d.body.prices[2].v === null && d.body.prices[2].price === 11.2, d.body.prices[2]);
  ok('daily: currency and the other fields unchanged', d.body.currency === 'EUR' && Array.isArray(d.body.splits) && Array.isArray(d.body.dividends));
  ok('cache key moved to yf3', cacheKeys.some((k) => /\/yf3\/DAILY\/1d\/1mo$/.test(k)) && !cacheKeys.some((k) => /\/yf2\//.test(k)), cacheKeys);

  const i = await call('action=yf&symbol=INTRA&interval=5m&range=1d');
  ok('intraday: three bars on one date stay apart by ts', i.status === 200 && i.body.prices.length === 3 && new Set(i.body.prices.map((p) => p.ts)).size === 3 && i.body.prices.every((p) => p.date === '2026-03-02'), i.body.prices);
  ok('intraday: a volume of 0 is kept as 0, not null', i.body.prices[1].v === 0, i.body.prices[1]);

  const c = await call('action=yf&symbol=CLOSE&interval=1d&range=1y');
  ok('closes only: o / h / l / v null, price kept', c.status === 200 && c.body.prices.length === 1 && c.body.prices[0].price === 7 && c.body.prices[0].o === null && c.body.prices[0].h === null && c.body.prices[0].l === null && c.body.prices[0].v === null, c.body.prices);

  // An existing consumer reads only { date, price } - same numbers as before.
  const oldReader = (body) => (body.prices || []).map((p) => [p.date, p.price]);
  ok('old clients: date / price pairs are exactly the old ones', JSON.stringify(oldReader(d.body)) === JSON.stringify([['2026-03-02', 10.5], ['2026-03-03', 11.0], ['2026-03-05', 11.2]]), oldReader(d.body));

  console.log('\ninterval / range limits (Yahoo, checked 2026-10-23):');
  ok('YF_ALLOWED_RANGES is exported', W.YF_ALLOWED_RANGES && typeof W.YF_ALLOWED_RANGES === 'object');
  const allowed = [['1m', '1d'], ['1m', '5d'], ['2m', '1mo'], ['5m', '1d'], ['5m', '1mo'], ['15m', '1mo'], ['30m', '5d'], ['90m', '1mo'],
    ['60m', '5d'], ['60m', '2y'], ['60m', 'ytd'], ['1h', '1y'], ['1h', '2y'], ['1d', 'max'], ['1d', '10y'], ['1wk', 'max'], ['1mo', '10y'], ['3mo', 'max'], ['5d', '1y']];
  const refused = [['1m', '1mo'], ['1m', 'ytd'], ['2m', '3mo'], ['5m', '3mo'], ['5m', 'ytd'], ['15m', '6mo'], ['30m', '1y'], ['90m', '3mo'], ['60m', '5y'], ['1h', '10y'], ['1h', 'max']];
  for (const [iv, rg] of allowed) {
    const before = upstream.length;
    const r = await call('action=yf&symbol=DAILY&interval=' + iv + '&range=' + rg);
    ok('allowed ' + iv + ' / ' + rg + ' reaches Yahoo', r.status === 200 && upstream.length === before + 1, r.status);
  }
  for (const [iv, rg] of refused) {
    const before = upstream.length;
    const r = await call('action=yf&symbol=DAILY&interval=' + iv + '&range=' + rg);
    ok('refused ' + iv + ' / ' + rg + ': 400 with the allowed ranges, no upstream call',
      r.status === 400 && r.body.error === 'interval/range not supported' && r.body.interval === iv && r.body.range === rg && Array.isArray(r.body.allowed) && r.body.allowed.length > 0 && upstream.length === before, [r.status, r.body]);
  }
  const bad = await call('action=yf&symbol=DAILY&interval=4h&range=1y');
  ok('an unknown interval is still refused with 400', bad.status === 400, bad);
  for (const iv of ['constructor', '__proto__', 'toString']) {
    const odd = await call('action=yf&symbol=DAILY&interval=' + iv + '&range=1y');
    ok('interval "' + iv + '" is refused with 400', odd.status === 400, odd);
  }

  // Every pair the app requests today (grep of the client code, 2026-10-23) stays allowed.
  const appPairs = [['1d', '5d'], ['1d', '1mo'], ['1d', '3mo'], ['1d', '6mo'], ['1d', '1y'], ['1d', '2y'], ['1d', '5y'], ['1d', '10y'], ['1d', 'max'], ['1d', 'ytd'],
    ['1mo', '10y'], ['1m', '1d'], ['5m', '1d'], ['60m', '5d'], ['1wk', '5y'], ['1mo', 'max']];
  ok('every pair the app requests today is allowed', appPairs.every(([iv, rg]) => (W.YF_ALLOWED_RANGES[iv] || []).indexOf(rg) !== -1), appPairs.filter(([iv, rg]) => (W.YF_ALLOWED_RANGES[iv] || []).indexOf(rg) === -1));

  console.log('\nversion capability:');
  const v = await call('action=version');
  ok('own Worker: version reports ohlcv: true', v.status === 200 && v.body.ohlcv === true, v.body);
  const vp = await call('action=version', { PRICE_ONLY: '1' });
  ok('shared price Worker: version reports ohlcv: true', vp.status === 200 && vp.body.ohlcv === true && vp.body.priceOnly === true, vp.body);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
