// Node harness for the daily close history (what to fetch, ingestion, merge,
// the fetch run). The Worker part runs the REAL cf-worker/worker.js in-process;
// only the upstream (Yahoo) answers are synthetic fixtures.
// Run: node test/close-history.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

const CH = require('../close-history.js');
const VP = require('../value-path.js');
const NOW = Date.parse('2025-06-10T12:00:00Z');
const TODAY = '2025-06-10';
const tx = (category, symbol, date, type) => ({ type: type || 'buy', category, symbol, date, quantity: 1, price: 1 });
const json = (o, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => o });

(async function run() {
  console.log('symbols and ranges:');
  ok('key = category|SYMBOL', CH.keyOf('stocks', ' aapl ') === 'stocks|AAPL' && CH.keyOf('', 'btc') === 'crypto|BTC');
  ok('suffixed ticker stays', CH.yfSymbol('stocks', 'vwce.de') === 'VWCE.DE');
  ok('resolved suffix from the price refresh wins', CH.yfSymbol('stocks', 'EUNL', { EUNL: 'EUNL.DE' }) === 'EUNL.DE');
  ok('known bare ticker → listing', CH.yfSymbol('stocks', 'SAP') === 'SAP.DE' && CH.yfSymbol('stocks', 'AAPL') === 'AAPL');
  ok('commodity → future', CH.yfSymbol('commodities', 'gold') === 'GC=F' && CH.yfSymbol('commodities', 'GLD') === 'GLD');
  ok('range reaches the first trade', ['2025-06-01', '2025-04-01', '2025-01-01', '2024-07-01', '2023-07-01', '2021-01-01', '2016-01-01', '2010-01-01']
    .map((d) => CH.rangeFor(d, TODAY)).join() === '1mo,3mo,6mo,1y,2y,5y,10y,max');

  console.log('what is needed:');
  const need = CH.need([tx('stocks', 'AAPL', '2024-03-01'), tx('stocks', 'aapl', '2023-01-05'), tx('stocks', 'AAPL', '2025-01-01', 'sell'),
    tx('crypto', 'bitcoin', '2024-01-01'), tx('skins', 'AK-47 | Redline (Field-Tested)', '2024-02-01'), tx('commodities', 'GOLD', '2024-02-01'),
    tx('options', 'AAPL250620C', '2024-02-01'), tx('bonds', 'X', '2024-02-01'), { type: 'dividend', category: 'stocks', symbol: 'KO', date: '2024-01-01' }, null]);
  ok('one entry per traded holding with a source, earliest date', Object.keys(need).sort().join() === 'commodities|GOLD,crypto|BITCOIN,stocks|AAPL' && need['stocks|AAPL'].first === '2023-01-05', Object.keys(need));
  ok('CS2 skins, options, custom classes and dividend-only symbols are not fetched', !Object.keys(need).some((k) => k.indexOf('skins|') === 0) && !need['options|AAPL250620C'] && !need['bonds|X'] && !need['stocks|KO']);

  console.log('ingestion:');
  const y = CH.ingestYahoo({ currency: 'USD', prices: [{ date: '2025-06-05', price: 200.123456789 }, { date: '2025-06-06', price: 0 }, { date: '2025-06-09', price: 204 }], splits: [{ date: '2025-06-09', numerator: 4, denominator: 1 }, { date: null, numerator: 1, denominator: 0 }] }, { sym: 'AAPL', at: NOW });
  ok('Yahoo: currency, closes, range', y.cur === 'USD' && y.src === 'yf' && y.from === '2025-06-05' && y.to === '2025-06-09' && y.d.length === 2 && y.sym === 'AAPL', y);
  ok('Yahoo: 7 significant digits, invalid rows dropped', y.p[0] === 200.1235 && CH.closesOf(y)[1][0] === '2025-06-09');
  ok('Yahoo: splits normalised', y.splits.length === 1 && y.splits[0].num === 4 && y.splits[0].den === 1);
  ok('Yahoo: error / empty → null', CH.ingestYahoo({ error: 'x' }) === null && CH.ingestYahoo({ prices: [] }) === null && CH.ingestYahoo(null) === null);
  const midnight = (d) => Date.parse(d + 'T00:00:00Z');
  const cg = CH.ingestCoinGecko({ prices: [[midnight('2025-06-08'), 90000], [midnight('2025-06-09'), 91000], [midnight('2025-06-10'), 92000], [NOW, 93000]] });
  ok('CoinGecko: a 00:00 point is the close of the day before; "now" is today', JSON.stringify(CH.closesOf(cg)) === JSON.stringify([['2025-06-07', 90000], ['2025-06-08', 91000], ['2025-06-09', 92000], ['2025-06-10', 93000]]) && cg.cur === 'EUR', CH.closesOf(cg));

  console.log('store:');
  const m = CH.mergeSeries(y, CH.ingestYahoo({ currency: 'USD', prices: [{ date: '2025-06-09', price: 205 }, { date: '2025-06-10', price: 206 }] }, { at: NOW + 1 }));
  ok('merge: new values win, range extends, splits kept', m.d.length === 3 && m.p.join() === '200.1235,205,206' && m.to === '2025-06-10' && m.from === '2025-06-05' && m.splits.length === 1, m);
  ok('merge: a different currency replaces the series', CH.mergeSeries(y, CH.ingestYahoo({ currency: 'EUR', prices: [{ date: '2025-06-10', price: 1 }] })).d.length === 1);
  const round = CH.normalize(JSON.stringify({ v: 1, series: { 'stocks|AAPL': Object.assign({}, m, { req: '2023-01-01' }), bad: { d: [1], p: ['x'] }, junk: 5 } }));
  ok('normalize: round-trips, drops broken entries', Object.keys(round.series).join() === 'stocks|AAPL' && round.series['stocks|AAPL'].req === '2023-01-01' && round.series['stocks|AAPL'].p.length === 3);
  ok('normalize: garbage → empty store', Object.keys(CH.normalize('{nope').series).length === 0 && Object.keys(CH.normalize(null).series).length === 0);

  console.log('plan:');
  const n1 = CH.need([tx('stocks', 'AAPL', '2024-03-01')]);
  let jobs = CH.plan(n1, CH.normalize(null), NOW);
  ok('nothing stored → full fetch from a week before the first trade', jobs.length === 1 && jobs[0].mode === 'full' && jobs[0].from === '2024-02-23', jobs);
  const stored = { v: 1, series: { 'stocks|AAPL': Object.assign({}, m, { req: '2024-02-23', at: NOW - 3600e3 }) } };
  ok('fresh and far enough back → nothing to do', CH.plan(n1, stored, NOW).length === 0);
  stored.series['stocks|AAPL'].at = NOW - 7 * 3600e3;
  jobs = CH.plan(n1, stored, NOW);
  ok('older than 6 h → only the tail', jobs.length === 1 && jobs[0].mode === 'tail' && jobs[0].from === '2025-06-10', jobs);
  jobs = CH.plan(CH.need([tx('stocks', 'AAPL', '2022-01-10')]), stored, NOW);
  ok('an earlier trade appears → full fetch again', jobs.length === 1 && jobs[0].mode === 'full' && jobs[0].from === '2022-01-03', jobs);
  // the source had less history than asked for: `req` stops the refetch loop
  stored.series['stocks|AAPL'].req = '2022-01-03'; stored.series['stocks|AAPL'].at = NOW;
  ok('a series shorter than requested is not fetched forever', CH.plan(CH.need([tx('stocks', 'AAPL', '2022-01-10')]), stored, NOW).length === 0);

  console.log('sync (fake fetch):');
  {
    const calls = [];
    const fetchFn = async (url) => {
      calls.push(url);
      if (/action=cg&p=coins/.test(url)) return /days=365&/.test(url) ? json({ prices: [[midnight('2025-06-10'), 92000]] }) : json({ error: 'exceeds' }, 401);
      if (/symbol=FAIL/.test(url)) return json({ error: 'Yahoo Finance returned 404' }, 404);
      return json({ currency: 'EUR', prices: [{ date: '2025-06-09', price: 100 }, { date: '2025-06-10', price: 101 }], splits: [] });
    };
    const r = await CH.sync({ transactions: [tx('stocks', 'EUNL', '2025-05-20'), tx('stocks', 'FAIL', '2025-05-20'), tx('crypto', 'bitcoin', '2022-01-01'), tx('skins', 'AK', '2025-05-20')],
      workerBase: 'https://w.example/', fetch: fetchFn, now: NOW, suffixCache: { EUNL: 'EUNL.DE' }, cryptoDelayMs: 0 });
    ok('stock via the Worker with the resolved listing and the smallest range', calls.some((u) => u === 'https://w.example?action=yf&symbol=EUNL.DE&interval=1d&range=3mo'), calls);
    ok('fetched / failed are reported, never thrown', r.fetched.sort().join() === 'crypto|BITCOIN,stocks|EUNL' && r.failed.map((f) => f.key).sort().join() === 'stocks|FAIL' && r.changed === true, r.failed);
    ok('CoinGecko beyond a year: asks for 365 days right away (no refused request)', calls.filter((u) => /action=cg&p=coins/.test(u)).length === 1 && !!r.store.series['crypto|BITCOIN']);
    ok('requested start is remembered', r.store.series['stocks|EUNL'].req === '2025-05-13' && r.store.series['crypto|BITCOIN'].req === '2021-12-25');
    const again = await CH.sync({ transactions: [tx('stocks', 'EUNL', '2025-05-20'), tx('crypto', 'bitcoin', '2022-01-01')], store: r.store, workerBase: 'https://w.example', fetch: async (u) => { calls.push('second:' + u); return json({}); }, now: NOW + 1000, cryptoDelayMs: 0 });
    ok('second run right after: no request at all', !calls.some((u) => /^second:/.test(u)) && again.changed === false);
  }
  {
    const calls = [];
    const r = await CH.sync({ transactions: [tx('stocks', 'AAPL', '2025-05-20'), tx('crypto', 'bitcoin', '2025-05-20'), tx('crypto', 'ethereum', '2025-05-20')], workerBase: '',
      fetch: async (u) => { calls.push(u); return json({}, 429); }, now: NOW, cryptoDelayMs: 0 });
    ok('no Worker: stocks are skipped, not requested', r.skipped.indexOf('stocks|AAPL') !== -1 && !calls.some((u) => /action=yf/.test(u)));
    ok('no Worker: coins are skipped too (CoinGecko only through the Worker), nothing requested', calls.length === 0 && r.skipped.indexOf('crypto|ETHEREUM') !== -1 && r.skipped.indexOf('crypto|BITCOIN') !== -1 && r.failed.length === 0 && r.changed === false, { calls, r });
  }
  {
    const calls = [];
    const r = await CH.sync({ transactions: [tx('crypto', 'bitcoin', '2025-05-20'), tx('crypto', 'ethereum', '2025-05-20')], workerBase: 'https://w.example',
      yahooCrypto: () => '', fetch: async (u) => { calls.push(u); return json({ error: 'CoinGecko rate limit' }, 429); }, now: NOW, cryptoDelayMs: 0 });
    ok('CoinGecko 429 (via the Worker): stops after the first refusal; both stay "try later", not "no history"', calls.length === 1 && /\?action=cg&p=coins\//.test(calls[0]) && r.skipped.indexOf('crypto|ETHEREUM') !== -1 && r.skipped.indexOf('crypto|BITCOIN') !== -1 && r.failed.length === 0, { calls, r });
  }
  {
    // 30 holdings: one run asks the Worker for at most 20, the rest waits.
    const many = []; for (let i = 0; i < 30; i++) many.push(tx('stocks', 'S' + String(i).padStart(2, '0') + '.DE', '2025-05-20'));
    const calls = [];
    const r = await CH.sync({ transactions: many, workerBase: 'https://w.example', now: NOW, chunkDelayMs: 0,
      fetch: async (u) => { calls.push(u); return json({ currency: 'EUR', prices: [{ date: '2025-06-09', price: 1 }] }); } });
    ok('batch limit: 20 requests per run, 10 holdings left for the next', calls.length === 20 && r.fetched.length === 20 && r.skipped.length === 10 && r.failed.length === 0);
    const r2 = await CH.sync({ transactions: many, store: r.store, workerBase: 'https://w.example', now: NOW + 1000, chunkDelayMs: 0,
      fetch: async (u) => { calls.push(u); return json({ currency: 'EUR', prices: [{ date: '2025-06-09', price: 1 }] }); } });
    ok('next run fetches exactly the remaining ones', calls.length === 30 && r2.fetched.length === 10 && r2.skipped.length === 0 && Object.keys(r2.store.series).length === 30);
    let n = 0;
    const r3 = await CH.sync({ transactions: many, workerBase: 'https://w.example', now: NOW, chunkDelayMs: 0,
      fetch: async () => { n++; return n > 4 ? json({ error: 'rate limited — slow down' }, 429) : json({ currency: 'EUR', prices: [{ date: '2025-06-09', price: 1 }] }); } });
    ok('Worker 429: the run stops after that chunk, nothing is marked "no history"', n === 8 && r3.fetched.length === 4 && r3.failed.length === 0 && r3.skipped.length === 26, { n, f: r3.fetched.length, s: r3.skipped.length, failed: r3.failed });
  }
  {
    // Tail update that reports a new split → the whole range is fetched again.
    const old = CH.ingestYahoo({ currency: 'USD', prices: [{ date: '2025-05-20', price: 400 }, { date: '2025-06-06', price: 800 }] }, { at: NOW - 10 * 3600e3 });
    old.req = '2025-05-13';
    const calls = [];
    const r = await CH.sync({ transactions: [tx('stocks', 'AAPL', '2025-05-20')], store: { v: 1, series: { 'stocks|AAPL': old } }, workerBase: 'https://w.example', now: NOW,
      fetch: async (u) => { calls.push(u); return json({ currency: 'USD', prices: [{ date: '2025-05-20', price: 100 }, { date: '2025-06-06', price: 200 }, { date: '2025-06-09', price: 202 }], splits: [{ date: '2025-06-09', numerator: 4, denominator: 1 }] }); } });
    ok('new split in the tail → full re-fetch, old unadjusted closes replaced', calls.length === 2 && r.store.series['stocks|AAPL'].p.join() === '100,200,202' && r.store.series['stocks|AAPL'].req === '2025-05-13', { calls, p: r.store.series['stocks|AAPL'].p });
  }

  {
    // 22 holdings Yahoo does not know + 5 stocks: the unknown ones must not take
    // every batch slot again and again (they did, and the stocks were never loaded).
    const txs = []; for (let i = 0; i < 22; i++) txs.push(tx('stocks', 'GONE' + i, '2025-05-20'));
    for (let i = 0; i < 5; i++) txs.push(tx('stocks', 'ST' + i + '.DE', '2025-05-20'));
    let calls = 0;
    const f = async (u) => { calls++; return /symbol=GONE/.test(u) ? json({ error: 'Yahoo Finance returned 404' }, 404) : json({ currency: 'EUR', prices: [{ date: '2025-06-09', price: 1 }] }); };
    let r = await CH.sync({ transactions: txs, workerBase: 'https://w.example', now: NOW, chunkDelayMs: 0, fetch: f });
    r = await CH.sync({ transactions: txs, store: r.store, workerBase: 'https://w.example', now: NOW + 1000, chunkDelayMs: 0, fetch: f });
    ok('holdings without history are remembered: second run loads the stocks', calls === 27 && Object.keys(r.store.series).length === 5 && Object.keys(r.store.miss).length === 22 && r.skipped.length === 0, { calls, series: Object.keys(r.store.series).length });
    const before = calls;
    r = await CH.sync({ transactions: txs, store: CH.normalize(JSON.stringify(r.store)), workerBase: 'https://w.example', now: NOW + 3600e3, chunkDelayMs: 0, fetch: f });
    ok('…and are not asked again the same day (also after a reload)', calls === before);
    r = await CH.sync({ transactions: txs, store: r.store, workerBase: 'https://w.example', now: NOW + 25 * 3600e3, chunkDelayMs: 0, maxWorker: 100, fetch: f });
    ok('…but again after a day', calls === before + 22 + 5);
    const t = await CH.sync({ transactions: [tx('stocks', 'TMO', '2025-05-20')], workerBase: 'https://w.example', now: NOW, fetch: async () => { throw new Error('timeout'); } });
    ok('a timeout is not remembered as "no history"', Object.keys(t.store.miss).length === 0 && t.failed.length === 1);
  }

  console.log('crypto through Yahoo:');
  {
    const T = require('../ticker-validation.js');
    ok('Yahoo pair from ticker or CoinGecko id', T.yahooCryptoSymbol('BTC') === 'BTC-USD' && T.yahooCryptoSymbol('bitcoin') === 'BTC-USD' && T.yahooCryptoSymbol('near') === 'NEAR-USD'
      && T.yahooCryptoSymbol('binance-usd') === 'BUSD-USD' && T.yahooCryptoSymbol('UNI') === 'UNI7083-USD' && T.yahooCryptoSymbol('unknown-coin') === '' && T.yahooCryptoSymbol('') === '');
    const yfDays = (p) => json({ currency: 'USD', prices: [{ date: '2025-06-09', price: p }, { date: '2025-06-10', price: p }] });
    const calls = [];
    const fetchFn = async (u) => {
      calls.push(u);
      if (/action=cg&p=coins/.test(u)) return json({ prices: [[midnight('2025-06-10'), 5]] });
      if (/BTC-USD/.test(u)) return yfDays(100000);
      if (/NEAR-USD/.test(u)) return yfDays(4.8);
      if (/ODD-USD/.test(u)) return yfDays(900);               // Yahoo's "ODD" is another coin
      return json({ error: 'Yahoo Finance returned 404' }, 404);
    };
    const live = { BTC: 92000, near: 4.2, ODD: 0.3 };
    const r = await CH.sync({ transactions: [tx('crypto', 'BTC', '2022-01-01'), tx('crypto', 'near', '2025-05-20'), tx('crypto', 'ODD', '2025-05-20'), tx('crypto', 'GONEX', '2025-05-20')],
      workerBase: 'https://w.example', fetch: fetchFn, now: NOW, chunkDelayMs: 0, cryptoDelayMs: 0, yahooCrypto: T.yahooCryptoSymbol, cryptoId: T.coinGeckoId, priceOf: (s) => live[s] || 0 });
    ok('coins come from the Worker as USD pairs over the full range', calls.includes('https://w.example?action=yf&symbol=BTC-USD&interval=1d&range=5y') && r.store.series['crypto|BTC'].src === 'yf' && r.store.series['crypto|BTC'].cur === 'USD', calls);
    ok('a coin Yahoo has needs no CoinGecko call', !calls.some((u) => /coins\/(bitcoin|near)\//.test(u)) && r.store.series['crypto|NEAR'].p.join() === '4.8,4.8');
    ok('price far off the live one, or unknown to Yahoo → CoinGecko', calls.some((u) => /coins\/odd\//.test(u)) && calls.some((u) => /coins\/gonex\//.test(u)) && r.store.series['crypto|ODD'].src === 'cg' && r.store.series['crypto|GONEX'].src === 'cg');
    const old = CH.ingestCoinGecko({ prices: [[midnight('2025-01-01'), 80000], [midnight('2025-06-01'), 90000]] }, { at: NOW - 7 * 3600e3 });
    old.req = '2021-12-25';
    const calls2 = [];
    const r2 = await CH.sync({ transactions: [tx('crypto', 'BTC', '2022-01-01')], store: { v: 1, series: { 'crypto|BTC': old } }, workerBase: 'https://w.example', now: NOW, chunkDelayMs: 0,
      yahooCrypto: T.yahooCryptoSymbol, fetch: async (u) => { calls2.push(u); return yfDays(100000); } });
    ok('stored CoinGecko closes are replaced by the full Yahoo range, not merged with a tail', calls2.length === 2 && /range=5y/.test(calls2[1]) && r2.store.series['crypto|BTC'].src === 'yf', calls2);
    const r3 = await CH.sync({ transactions: [tx('crypto', 'ODD', '2025-05-20')], workerBase: 'https://w.example', now: NOW, chunkDelayMs: 0, yahooCrypto: T.yahooCryptoSymbol, priceOf: () => 0.3,
      cgGet: async () => { const e = new Error('busy'); e.status = 429; throw e; }, fetch: fetchFn });
    ok('CoinGecko busy on the fallback: "try later", not "no history"', r3.skipped.includes('crypto|ODD') && r3.failed.length === 0 && !r3.store.miss['crypto|ODD'], r3);
  }

  console.log('real Worker code, synthetic Yahoo upstream:');
  {
    const W = await import('../cf-worker/worker.js');
    const worker = W.default;
    const upstream = [];
    const cacheMap = new Map();
    globalThis.caches = { default: { match: async (req) => { const b = cacheMap.get(req.url); return b === undefined ? undefined : new Response(b); }, put: async (req, resp) => { cacheMap.set(req.url, await resp.text()); } } };
    const day = (d) => Math.floor(Date.parse(d + 'T14:30:00Z') / 1000);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url && url.url ? url.url : url);
      upstream.push(u);
      if (/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/VWCE\.DE/.test(u)) {
        return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'EUR', exchangeTimezoneName: 'Europe/Berlin' },
          timestamp: [day('2025-05-19'), day('2025-05-20'), day('2025-05-21'), day('2025-06-09')],
          indicators: { quote: [{ close: [100, 101, null, 111.1] }] } }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (/finance\/chart\/NVDA/.test(u)) {
        return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'USD' }, timestamp: [day('2025-05-20'), day('2025-06-09')],
          indicators: { quote: [{ close: [100, 120] }] }, events: { splits: { x: { date: day('2025-06-02'), numerator: 10, denominator: 1 } } } }] } }), { status: 200 });
      }
      if (/finance\/chart\/GONE/.test(u)) return new Response('{}', { status: 404 });
      return new Response('', { status: 500 });
    };
    const pending = [];
    const viaWorker = (url) => worker.fetch(new Request(url, { headers: { Origin: 'https://maermin.github.io' } }), {}, { waitUntil(p) { pending.push(p); } });
    try {
      const txs = [
        { type: 'buy', category: 'stocks', symbol: 'VWCE.DE', date: '2025-05-20', quantity: 10, price: 101, currency: 'EUR' },
        { type: 'buy', category: 'stocks', symbol: 'NVDA', date: '2025-05-20', quantity: 1, price: 1000, currency: 'USD' },
        { type: 'buy', category: 'stocks', symbol: 'GONE', date: '2025-05-20', quantity: 1, price: 50, currency: 'EUR' }
      ];
      const r = await CH.sync({ transactions: txs, workerBase: 'https://maermin-test.workers.dev', fetch: viaWorker, now: NOW });
      await Promise.all(pending);
      ok('Worker requested Yahoo once per symbol with range=3mo', upstream.filter((u) => /range=3mo/.test(u) && /interval=1d/.test(u)).length === 3, upstream);
      const v = r.store.series['stocks|VWCE.DE'];
      ok('closes through the Worker: currency, null close dropped', !!v && v.cur === 'EUR' && JSON.stringify(CH.closesOf(v)) === JSON.stringify([['2025-05-19', 100], ['2025-05-20', 101], ['2025-06-09', 111.1]]), v && CH.closesOf(v));
      ok('split events through the Worker', JSON.stringify(r.store.series['stocks|NVDA'].splits) === JSON.stringify([{ date: '2025-06-02', num: 10, den: 1 }]), r.store.series['stocks|NVDA']);
      ok('Yahoo 404 → reported as failed, others unaffected', r.failed.length === 1 && r.failed[0].key === 'stocks|GONE' && r.fetched.length === 2, r.failed);

      // End to end: closes → EUR → value path. NVDA: 1 share at 1,000 $ before a
      // 10:1 split = 10 shares at 100 $, USD→EUR 0.9 → 900 € → 1,080 € (+20 %).
      // VWCE: 1,010 € → 1,111 € (+10 %). Total 1,910 → 2,191 = +14.712 %.
      const series = {};
      ['stocks|VWCE.DE', 'stocks|NVDA'].forEach((k) => { const e = r.store.series[k]; series[k] = { closes: CH.closesOf(e).map((c) => [c[0], e.cur === 'USD' ? c[1] * 0.9 : c[1]]) }; });
      // the split is applied as a recorded corporate action (as the app does)
      const path = VP.build(txs, series, { today: TODAY, exchangeRate: 0.9, fxAt: () => 0.9, splits: { 'stocks|NVDA': r.store.series['stocks|NVDA'].splits } });
      ok('value path from Worker closes: TWR +14.712 %, GONE listed as missing', Math.abs(path.twr - (2191 / 1910 - 1)) < 1e-9 && path.missing.length === 1 && path.missing[0].symbol === 'GONE', { twr: path.twr, missing: path.missing });
      const before = upstream.length;
      await CH.sync({ transactions: txs.slice(0, 1), workerBase: 'https://maermin-test.workers.dev', fetch: viaWorker, now: NOW });
      ok('Worker edge cache answers the repeat (no second Yahoo call)', upstream.length === before);
    } finally { globalThis.fetch = realFetch; delete globalThis.caches; }
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
