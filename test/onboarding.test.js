// Node harness for the onboarding wizard's pure logic: worker-URL helpers,
// endpoint descriptors, probe-outcome classification, and the probe runner with
// an injected fetch. The React Wizard is browser-only and not exercised here.
// Run: node test/onboarding.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const O = require('../onboarding.js');

// Fake fetch: maps url substrings → { status, body } ; or throws for 'BOOM'.
function fakeFetch(routes) {
  return function (url) {
    for (const key in routes) {
      if (url.indexOf(key) > -1) {
        const r = routes[key];
        if (r.throw) return Promise.reject(Object.assign(new Error(r.throw), { name: r.name || 'Error' }));
        return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status,
          text: function () { return Promise.resolve(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)); } });
      }
    }
    return Promise.reject(new Error('no route for ' + url));
  };
}

(async function run() {
  console.log('onboarding:');

  // normalize / validate
  ok('normalize strips trailing slashes + trims', O.normalizeWorkerUrl('  https://x.workers.dev///  ') === 'https://x.workers.dev');
  ok('valid https url', O.isValidWorkerUrl('https://x.workers.dev'));
  ok('valid http url', O.isValidWorkerUrl('http://localhost:8787'));
  ok('empty url invalid', !O.isValidWorkerUrl(''));
  ok('bare word invalid', !O.isValidWorkerUrl('not a url'));

  // endpoints
  const eps = O.endpoints('https://x.workers.dev/');
  ok('builds 3 endpoint probes', eps.length === 3);
  ok('ids are the 3 data sources', eps.map(e => e.id).join(',') === 'yf,yfsearch,skinprices');
  ok('skin price probe targets the price list', eps[2].url === 'https://x.workers.dev?action=skinprices');
  ok('yf probe targets AAPL', eps[0].url === 'https://x.workers.dev?action=yf&symbol=AAPL&interval=1d&range=5d');

  // classify — happy paths
  ok('yf ok when prices present', O.classify('yf', { status: 200, payload: { prices: [1, 2] } }).state === 'ok');
  ok('skinprices ok when the price file has items', O.classify('skinprices', { status: 200, payload: { 'Fever Case': { last_24h: 0.89 } } }).state === 'ok');
  ok('skinprices warn when the price file is empty', O.classify('skinprices', { status: 200, payload: {} }).state === 'warn');
  ok('yfsearch ok when array non-empty', O.classify('yfsearch', { status: 200, payload: [{ s: 'AAPL' }] }).state === 'ok');

  // classify — warn (reachable, no data)
  ok('yf warn when prices empty', O.classify('yf', { status: 200, payload: { prices: [] } }).state === 'warn');

  // classify — fail paths
  ok('fail on non-2xx', O.classify('yf', { status: 500, payload: { error: 'x' } }).state === 'fail');
  ok('fail on 200 worker-error body', O.classify('yf', { status: 200, payload: { error: 'No data from Yahoo Finance' } }).state === 'fail');
  ok('fail surfaces the worker error text', O.classify('yf', { status: 200, payload: { error: 'boom' } }).message.indexOf('boom') > -1);
  ok('fail on network error', O.classify('yf', { networkError: 'Failed to fetch' }).state === 'fail');
  ok('fail on missing status', O.classify('yf', { payload: {} }).state === 'fail');

  // probe — with injected fetch
  const epYf = O.endpoints('https://w.dev')[0];
  const good = await O.probe(epYf, { fetch: fakeFetch({ 'action=yf': { status: 200, body: { prices: [1] } } }) });
  ok('probe ok result', good.state === 'ok' && good.id === 'yf' && typeof good.ms === 'number');
  const http500 = await O.probe(epYf, { fetch: fakeFetch({ 'action=yf': { status: 500, body: { error: 'nope' } } }) });
  ok('probe maps 500 → fail', http500.state === 'fail');
  const netErr = await O.probe(epYf, { fetch: fakeFetch({ 'action=yf': { throw: 'Failed to fetch' } }) });
  ok('probe maps network throw → fail', netErr.state === 'fail');

  // probeAll
  const all = await O.probeAll('https://w.dev', { fetch: fakeFetch({
    'action=yf&': { status: 200, body: { prices: [1] } },
    'action=yfsearch': { status: 200, body: [{ s: 'A' }] },
    'action=skinprices': { status: 200, body: { 'Fever Case': { last_24h: 0.89 } } }
  }) });
  ok('probeAll runs all 3', all.length === 3 && all.every(r => r.state === 'ok'));

  // fetchWorkerSource — first-path / fallback / all-fail
  const src1 = await O.fetchWorkerSource({ paths: ['a', 'b'], fetch: fakeFetch({ 'a': { status: 200, body: 'WORKER_CODE' } }) });
  ok('fetchWorkerSource returns first-path text', src1 === 'WORKER_CODE');
  const src2 = await O.fetchWorkerSource({ paths: ['a', 'b'], fetch: fakeFetch({ 'a': { status: 404, body: '' }, 'b': { status: 200, body: 'FALLBACK' } }) });
  ok('fetchWorkerSource falls back to second path', src2 === 'FALLBACK');
  let rejected = false;
  await O.fetchWorkerSource({ paths: ['a'], fetch: fakeFetch({ 'a': { status: 404, body: '' } }) }).catch(() => { rejected = true; });
  ok('fetchWorkerSource rejects when all paths fail', rejected);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
