// Node harness for data-quality/trust helpers (window.MaerminDataQuality):
// freshness, never-silent-zero price state, FX transparency, price-meta
// persistence, and worker health probing. Run: node test/data-quality.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function memStore() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; }

const Q = require('../data-quality.js');

(async function run() {
  const now = 1_700_000_000_000;
  const HOUR = 3600 * 1000;

  console.log('freshness classification:');
  ok('recent → fresh', Q.freshness(now - 10 * 60 * 1000, now).level === 'fresh');
  ok('old → stale', Q.freshness(now - 10 * HOUR, now).stale === true);
  ok('null → missing', Q.freshness(null, now).level === 'missing');
  ok('label reads "3h ago"', Q.freshness(now - 3 * HOUR, now).label === '3h ago');
  ok('custom staleHours respected', Q.freshness(now - 2 * HOUR, now, { staleHours: 1 }).stale === true);

  console.log('source labels:');
  ok('crypto → CoinGecko', Q.sourceFor('crypto') === 'CoinGecko');
  ok('stocks → Yahoo Finance', Q.sourceFor('stocks') === 'Yahoo Finance');
  ok('skins → Steam Market', Q.sourceFor('skins') === 'Steam Market');

  console.log('priceState — never a silent zero:');
  const good = Q.priceState(228, { category: 'stocks', fetchedAt: now - 60000, now });
  ok('valid price is available', good.available === true && good.value === 228);
  ok('valid fresh price has no badge', good.badge === null);
  ok('source carried through', good.source === 'Yahoo Finance');
  const zero = Q.priceState(0, { category: 'crypto', now });
  ok('zero is NOT available (no silent zero)', zero.available === false && zero.value === null);
  ok('unavailable shows a badge', zero.badge === 'not available');
  const failed_ = Q.priceState(null, { category: 'crypto', fetchFailed: true, now });
  ok('fetch failure is labelled', failed_.badge === 'fetch failed');
  const stale = Q.priceState(100, { category: 'stocks', fetchedAt: now - 12 * HOUR, now });
  ok('stale price flagged but still available', stale.available === true && /stale/.test(stale.badge));

  console.log('FX transparency:');
  const fx = Q.fx(0.92, { fetchedAt: now - HOUR, now });
  ok('valid rate exposed with source + label', fx.rate === 0.92 && fx.source === 'Yahoo Finance' && /USD→EUR 0\.9200/.test(fx.label));
  ok('missing rate is explicit', Q.fx(null, { now }).rate === null && /unavailable/.test(Q.fx(null, { now }).label));

  console.log('price-meta persistence:');
  const s = memStore();
  Q.recordFetch(['AAPL', 'MSFT'], 'Yahoo Finance', { storage: s, at: now });
  const meta = Q.readMeta(s);
  ok('records per-symbol fetch time + source', meta.AAPL.at === now && meta.AAPL.source === 'Yahoo Finance' && meta.MSFT.at === now);

  console.log('worker health probe (injected fetch):');
  const okFetch = async () => ({ ok: true, status: 200 });
  const errFetch = async () => ({ ok: false, status: 500 });
  const netFetch = async () => { throw new Error('boom'); };
  ok('no url → not reachable, clear error', (await Q.checkWorkerHealth('', { fetchImpl: okFetch })).error === 'no-worker-url');
  const h1 = await Q.checkWorkerHealth('https://w.example.dev', { fetchImpl: okFetch });
  ok('200 → ok + reachable + latency', h1.ok === true && h1.reachable === true && typeof h1.latencyMs === 'number');
  const h2 = await Q.checkWorkerHealth('https://w.example.dev', { fetchImpl: errFetch });
  ok('500 → reachable but not ok', h2.reachable === true && h2.ok === false && h2.error === 'http-500');
  const h3 = await Q.checkWorkerHealth('https://w.example.dev', { fetchImpl: netFetch });
  ok('network error → not reachable', h3.reachable === false && h3.error === 'network');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
