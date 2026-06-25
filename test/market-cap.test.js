// Node harness for Market-Cap size buckets (WI-5). Pure, no browser.
// Run: node test/market-cap.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }

const MC = require('../market-cap.js');

(function run() {
  console.log('market-cap:');

  // ---- bucket boundaries (EUR) ----
  ok('>= 10bn is large', MC.bucketFor(10e9) === 'large' && MC.bucketFor(50e9) === 'large');
  ok('just under 10bn is mid', MC.bucketFor(10e9 - 1) === 'mid');
  ok('exactly 2bn is mid', MC.bucketFor(2e9) === 'mid');
  ok('just under 2bn is small', MC.bucketFor(2e9 - 1) === 'small');
  ok('positive small is small', MC.bucketFor(500e6) === 'small');
  ok('null cap is unknown', MC.bucketFor(null) === 'unknown');
  ok('NaN cap is unknown', MC.bucketFor(NaN) === 'unknown');
  ok('zero/negative is unknown', MC.bucketFor(0) === 'unknown' && MC.bucketFor(-5) === 'unknown');

  // ---- EUR normalisation of a USD cap ----
  ok('USD cap normalises at rate', near(MC.capToEUR(100e9, 'USD', 0.9), 90e9));
  ok('EUR cap stays as-is', near(MC.capToEUR(5e9, 'EUR', 0.9), 5e9));
  ok('a USD 11bn cap at 0.9 -> 9.9bn EUR -> mid', MC.bucketFor(MC.capToEUR(11e9, 'USD', 0.9)) === 'mid');
  ok('a USD 12bn cap at 0.9 -> 10.8bn EUR -> large', MC.bucketFor(MC.capToEUR(12e9, 'USD', 0.9)) === 'large');
  ok('missing cap normalises to null', MC.capToEUR(null, 'USD', 0.9) === null);

  // ---- aggregate: weights sum to 100 incl unknown ----
  const rows = [
    { symbol: 'AAPL', valueEUR: 4000, capEUR: 3000e9 },  // large
    { symbol: 'MID',  valueEUR: 3000, capEUR: 5e9 },     // mid
    { symbol: 'SML',  valueEUR: 2000, capEUR: 1e9 },     // small
    { symbol: 'NEW',  valueEUR: 1000, capEUR: null },    // unknown
    { symbol: 'ZERO', valueEUR: 0,    capEUR: 10e9 }     // dropped (no value)
  ];
  const agg = MC.aggregate(rows, {});
  const by = {}; agg.buckets.forEach(b => by[b.key] = b);
  ok('total value sums priced rows', agg.total === 10000);
  ok('large bucket value', by.large.value === 4000 && near(by.large.weight, 40));
  ok('mid bucket value', by.mid.value === 3000 && near(by.mid.weight, 30));
  ok('small bucket value', by.small.value === 2000 && near(by.small.weight, 20));
  ok('unknown bucket value', by.unknown.value === 1000 && near(by.unknown.weight, 10));
  const weightSum = agg.buckets.reduce((s, b) => s + b.weight, 0);
  ok('weights sum to 100 incl unknown', near(weightSum, 100, 1e-9));
  ok('buckets in fixed order', agg.buckets.map(b => b.key).join(',') === 'large,mid,small,unknown');

  // ---- empty input degrades cleanly ----
  const empty = MC.aggregate([], {});
  ok('empty -> total 0', empty.total === 0);
  ok('empty -> all weights 0', empty.buckets.every(b => b.weight === 0));

  // ---- prefetchCaps with injected fetch warms the cache ----
  // minimal localStorage stub
  const mem = {};
  global.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
  };
  const fakeFetch = (url) => {
    const sym = decodeURIComponent((url.match(/symbol=([^&]+)/) || [])[1] || '');
    const caps = { AAPL: { marketCap: 3000e9, currency: 'USD' }, TINY: { marketCap: 100e6, currency: 'USD' } };
    const body = caps[sym] || { marketCap: null, currency: 'USD' };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.assign({ symbol: sym }, body)) });
  };
  return MC.prefetchCaps(['AAPL', 'TINY'], { workerUrl: 'https://w', fetch: fakeFetch }).then((cache) => {
    ok('prefetch caches a large cap', cache.AAPL && cache.AAPL.cap === 3000e9);
    ok('cachedCap reads back the cap', MC.cachedCap('AAPL').cap === 3000e9);
    ok('prefetch caches a small cap', cache.TINY && cache.TINY.cap === 100e6);

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
})();
