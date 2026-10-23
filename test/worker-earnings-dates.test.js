// P5-5.5: the Worker's earnings route also returns the ex-dividend and pay
// dates from the same Yahoo calendarEvents module (no extra upstream call), for
// the event feed. Market data only.
// Run: node test/worker-earnings-dates.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail).slice(0, 400) : ''))); }

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const worker = W.default;
  const upstream = [];
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  const R = (v) => ({ raw: v, fmt: String(v) });
  const ts = (iso) => Date.parse(iso + 'T00:00:00Z') / 1000;
  globalThis.fetch = async (url) => {
    const u = String(url && url.url ? url.url : url);
    upstream.push(u);
    if (/quoteSummary\/AAPL/.test(u)) {
      return new Response(JSON.stringify({ quoteSummary: { result: [{
        price: { shortName: 'Apple Inc.', currency: 'USD' },
        calendarEvents: { earnings: { earningsDate: [R(ts('2026-10-29'))], earningsAverage: R(1.75) }, exDividendDate: R(ts('2026-11-09')), dividendDate: R(ts('2026-11-13')) }
      }] } }), { status: 200 });
    }
    if (/quoteSummary\/BRK-B/.test(u)) {
      return new Response(JSON.stringify({ quoteSummary: { result: [{ price: { shortName: 'Berkshire', currency: 'USD' }, calendarEvents: { earnings: { earningsDate: [R(ts('2026-11-01')), R(ts('2026-11-05'))] } } }] } }), { status: 200 });
    }
    return new Response('', { status: 500 });
  };
  const call = async (q) => {
    const r = await worker.fetch(new Request('https://maermin-test.workers.dev/?' + q, { headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '203.0.113.41' } }), {}, { waitUntil() {} });
    return { status: r.status, body: await r.json() };
  };
  console.log('worker earnings dates:');
  const a = await call('action=earnings&symbol=AAPL');
  ok('earnings date and EPS as before', a.status === 200 && a.body.earningsDate === '2026-10-29' && a.body.epsEstimate === 1.75 && a.body.isEstimate === false, a.body);
  ok('ex-dividend and pay date from calendarEvents', a.body.exDividendDate === '2026-11-09' && a.body.dividendDate === '2026-11-13', a.body);
  ok('one upstream call with the calendarEvents module', upstream.length === 1 && /modules=calendarEvents/.test(decodeURIComponent(upstream[0])), upstream);
  const b = await call('action=earnings&symbol=BRK-B');
  ok('no dividend dates: null; a date range is an estimate', b.body.exDividendDate === null && b.body.dividendDate === null && b.body.isEstimate === true && b.body.earningsDateEnd === '2026-11-05', b.body);
  // at least the release that added the dividend dates (2026.10.14); later bumps keep it green
  const atLeast = (v, min) => { const x = v.split('.').map(Number), y = min.split('.').map(Number); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return true; };
  ok('the version moved on', atLeast(W.WORKER_VERSION, '2026.10.14'), W.WORKER_VERSION);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
