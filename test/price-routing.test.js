// Price routing: CS2 skins filed as stocks (they flooded the Yahoo routes and
// ran the Worker into its rate limit, so Steam prices failed too), crypto
// tickers vs CoinGecko ids, and the Worker's symbol check + Steam budget.
// Run: node test/price-routing.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

const T = require('../ticker-validation.js');
const M = require('../import-mapping.js');
const CH = require('../close-history.js');

// The names from the user's console log, as the import stored them.
const LOGGED = ['AK-47 | FUEL INJECTOR (FIELD-TESTED)', 'FAMAS | COMMEMORATION (MINIMAL WEAR)', '★ NOMAD KNIFE',
  'FEVER CASE', 'STATTRAK™ GALIL AR | CRIMSON TSUNAMI (FACTORY NEW)', '★ HAND WRAPS | CONSTRICTOR (FIELD-TESTED)'];

(async function run() {
  console.log('skin names vs market symbols:');
  ok('every logged skin name is recognised', LOGGED.every(T.looksLikeSkin), LOGGED.filter((s) => !T.looksLikeSkin(s)));
  ok('more items: sticker, capsule, souvenir package', ['Sticker | Natus Vincere (Holo) | Katowice 2014', 'Paris 2023 Legends Sticker Capsule', 'Souvenir Package'].every(T.looksLikeSkin));
  ok('tickers are not skins', !['AAPL', 'SAP.DE', 'BRK-B', 'FISV', '^GDAXI', 'GC=F', 'bitcoin', 'VWCE.DE'].some(T.looksLikeSkin));
  ok('a stock stored by its name is not taken for a skin', !T.looksLikeSkin('Vanguard FTSE All-World') && !T.looksLikeSkin('Apple Inc.'));
  ok('isMarketSymbol: tickers, indices, FX, futures, ISIN', ['AAPL', 'SAP.DE', 'BRK-B', '^GDAXI', 'EURUSD=X', 'GC=F', '0700.HK', 'IE00BK5BQT80'].every(T.isMarketSymbol));
  ok('isMarketSymbol: skin names and empty are not', !LOGGED.some(T.isMarketSymbol) && !T.isMarketSymbol('') && !T.isMarketSymbol('Apple Inc'));

  console.log('Steam spelling of upper-cased names (Steam answers nothing for them):');
  const N = T.normalizeSkinName;
  const expect = {
    'AK-47 | FUEL INJECTOR (FIELD-TESTED)': 'AK-47 | Fuel Injector (Field-Tested)',
    'FAMAS | COMMEMORATION (MINIMAL WEAR)': 'FAMAS | Commemoration (Minimal Wear)',
    '★ NOMAD KNIFE': '★ Nomad Knife',
    'FEVER CASE': 'Fever Case',
    'STATTRAK™ GALIL AR | CRIMSON TSUNAMI (FACTORY NEW)': 'StatTrak™ Galil AR | Crimson Tsunami (Factory New)',
    '★ STATTRAK™ GUT KNIFE | DOPPLER (FACTORY NEW)': '★ StatTrak™ Gut Knife | Doppler (Factory New)',
    'USP-S | KILL CONFIRMED (MINIMAL WEAR)': 'USP-S | Kill Confirmed (Minimal Wear)',
    'M4A1-S | NITRO (WELL-WORN)': 'M4A1-S | Nitro (Well-Worn)',
    'DESERT EAGLE | BLAZE (FACTORY NEW)': 'Desert Eagle | Blaze (Factory New)',
    '★ SKELETON KNIFE | MARBLE FADE (FACTORY NEW)': '★ Skeleton Knife | Marble Fade (Factory New)',
    'GALIL AR | CHATTERBOX (BATTLE-SCARRED)': 'Galil AR | Chatterbox (Battle-Scarred)',
    'STATTRAK™ AK-47 | FRONTSIDE MISTY (MINIMAL WEAR)': 'StatTrak™ AK-47 | Frontside Misty (Minimal Wear)',
    'SAWED-OFF | THE KRAKEN (FIELD-TESTED)': 'Sawed-Off | The Kraken (Field-Tested)',
    'AWP | HYPER BEAST (FIELD-TESTED)': 'AWP | Hyper Beast (Field-Tested)'
  };
  const wrong = Object.keys(expect).filter((k) => N(k) !== expect[k]).map((k) => [k, N(k)]);
  ok('every logged name gets Steam\'s spelling', wrong.length === 0, wrong);
  ok('a name with lower-case letters is left alone', N('AWP | Neo-Noir (Factory New)') === 'AWP | Neo-Noir (Factory New)' && N('Glock-18 | Water Elemental (Minimal Wear)') === 'Glock-18 | Water Elemental (Minimal Wear)');

  console.log('crypto tickers -> CoinGecko ids:');
  ok('BTC / btc / XBT -> bitcoin', T.coinGeckoId('BTC') === 'bitcoin' && T.coinGeckoId('btc') === 'bitcoin' && T.coinGeckoId('XBT') === 'bitcoin');
  ok('an id stays as it is', T.coinGeckoId('bitcoin') === 'bitcoin' && T.coinGeckoId('avalanche-2') === 'avalanche-2');
  ok('ETH, SOL, AVAX mapped', T.coinGeckoId('ETH') === 'ethereum' && T.coinGeckoId('sol') === 'solana' && T.coinGeckoId('AVAX') === 'avalanche-2');
  ok('unknown ticker -> lower case', T.coinGeckoId('ZZZQ') === 'zzzq' && T.coinGeckoId('') === '');

  console.log('repairing skins filed as stocks:');
  const txs = [
    { id: '1', category: 'stocks', symbol: 'AK-47 | FUEL INJECTOR (FIELD-TESTED)', symbolName: 'AK-47 | FUEL INJECTOR (FIELD-TESTED)', quantity: 1, price: 40, currency: 'EUR', date: '2024-01-01' },
    { id: '2', category: 'stocks', symbol: 'AK-47 | FUEL INJECTOR (FIELD-TESTED)', quantity: 1, price: 45, currency: 'EUR', date: '2024-02-01' },
    { id: '3', category: 'stocks', symbol: 'FEVER CASE', quantity: 10, price: 1, date: '2024-02-01' },
    { id: '4', category: 'stocks', symbol: 'AAPL', quantity: 2, price: 150, currency: 'USD', date: '2024-01-01' },
    { id: '5', category: 'skins', symbol: 'AWP | Asiimov (Field-Tested)', quantity: 1, price: 80, date: '2024-01-01' }
  ];
  const found = T.findMisfiledSkins(txs);
  ok('found: one entry per stored symbol, with its count', found.length === 2 && found.find((f) => f.symbol === 'FEVER CASE').count === 1 && found.find((f) => /FUEL/.test(f.symbol)).count === 2, found);
  ok('stocks and real skins are not reported', !found.some((f) => f.symbol === 'AAPL' || /Asiimov/.test(f.symbol)));
  const exact = T.pickSkinName('AK-47 | FUEL INJECTOR (FIELD-TESTED)', [{ name: 'AK-47 | Fuel Injector (Minimal Wear)' }, { name: 'AK-47 | Fuel Injector (Field-Tested)' }]);
  ok('pickSkinName: the exact Steam name, ignoring case', exact === 'AK-47 | Fuel Injector (Field-Tested)');
  ok('pickSkinName: a merely similar item is not taken', T.pickSkinName('AK-47 | FUEL INJECTOR (FIELD-TESTED)', [{ name: 'AK-47 | Fuel Injector (Minimal Wear)' }]) === null);
  const rep = T.repairMisfiledSkins(txs, { 'AK-47 | FUEL INJECTOR (FIELD-TESTED)': exact });
  const r1 = rep.transactions[0], r3 = rep.transactions[2];
  ok('moved 3 transactions to skins', rep.moved === 3 && r1.category === 'skins' && rep.transactions[1].category === 'skins' && r3.category === 'skins');
  ok('the Steam name replaces the upper-cased one (symbol and display name)', r1.symbol === 'AK-47 | Fuel Injector (Field-Tested)' && r1.symbolName === 'AK-47 | Fuel Injector (Field-Tested)');
  ok('quantity, price, currency and date are kept', r1.quantity === 1 && r1.price === 40 && r1.currency === 'EUR' && r1.date === '2024-01-01' && r1.id === '1');
  ok('without a Steam name the spelling is restored by rule', r3.symbol === 'Fever Case', r3.symbol);
  ok('a missing currency becomes USD (Steam quotes USD)', r3.currency === 'USD');
  ok('stocks and real skins untouched; input not changed', rep.transactions[3] === txs[3] && rep.transactions[4] === txs[4] && txs[0].category === 'stocks');

  console.log('import files skins as skins:');
  const imp = M.preview('Date,Type,Symbol,Quantity,Price,Currency\n2024-01-05,buy,AK-47 | Redline (Field-Tested),1,30,EUR\n2024-01-05,buy,AAPL,2,150,USD', { category: 'stocks' });
  const sk = imp.transactions.find((t) => /Redline/.test(t.symbol)), ap = imp.transactions.find((t) => t.symbol === 'AAPL');
  ok('a skin name in a stock file becomes a skin with its spelling', !!sk && sk.category === 'skins' && sk.symbol === 'AK-47 | Redline (Field-Tested)', sk);
  ok('the stock row stays a stock', !!ap && ap.category === 'stocks');

  console.log('close history:');
  const calls = [];
  const json = (o, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => o });
  const NOW = Date.parse('2025-06-10T12:00:00Z');
  const tx = (category, symbol) => ({ type: 'buy', category, symbol, date: '2025-05-20', quantity: 1, price: 1 });
  const res = await CH.sync({
    transactions: [tx('crypto', 'BTC'), tx('stocks', 'FEVER CASE'), tx('stocks', 'AAPL')],
    workerBase: 'https://w.example', now: NOW, cryptoDelayMs: 0,
    cryptoId: T.coinGeckoId, isTicker: T.isMarketSymbol,
    fetch: async (u) => { calls.push(u); return /coingecko/.test(u) ? json({ prices: [[NOW, 90000]] }) : json({ currency: 'USD', prices: [{ date: '2025-06-09', price: 200 }] }); }
  });
  ok('BTC history is asked for as "bitcoin"', calls.some((u) => /coins\/bitcoin\//.test(u)) && !calls.some((u) => /coins\/btc\//.test(u)), calls);
  ok('a skin filed as a stock causes no request', !calls.some((u) => /FEVER/.test(u)), calls);
  ok('... and is reported as failed, the stock is fetched', res.failed.some((f) => /FEVER/.test(f.key)) && res.fetched.indexOf('stocks|AAPL') !== -1, res);

  console.log('Worker:');
  const W = await import('../cf-worker/worker.js');
  ok('Worker isMarketSymbol matches the client rule', LOGGED.every((s) => !W.isMarketSymbol(s)) && ['AAPL', 'SAP.DE', 'EURUSD=X', '^GDAXI'].every(W.isMarketSymbol));
  const req = (method) => ({ method, headers: { get: () => null } });
  ok('Steam requests have their own rate-limit budget', W.rateBucket(req('POST'), '') === 'steam' && W.rateBucket(req('GET'), 'steamhistory') === 'steam' && W.rateBucket(req('GET'), 'search') === 'steam');
  ok('Yahoo, sync and the broker relay share the default budget', W.rateBucket(req('GET'), 'yf') === 'default' && W.rateBucket(req('POST'), 'sync') === 'default' && W.rateBucket(req('POST'), 'brokerproxy') === 'default');
  const env = {};
  const ctx = { waitUntil() {} };
  globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
  const realFetch = globalThis.fetch;
  let upstream = 0;
  globalThis.fetch = async () => { upstream++; return new Response('{}', { status: 404 }); };
  const skinUrl = 'https://w.example/?action=yf&symbol=' + encodeURIComponent('AK-47 | FUEL INJECTOR (FIELD-TESTED)') + '&interval=1d&range=5d';
  const r400 = await W.default.fetch(new Request(skinUrl, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, ctx);
  const body = await r400.json();
  ok('a skin name on the Yahoo route: 400 with a hint, no upstream call', r400.status === 400 && /not a market symbol/.test(body.error) && upstream === 0, { status: r400.status, body, upstream });
  // 130 rejected skin requests do not use up the budget: a stock request still goes through.
  for (let i = 0; i < 130; i++) await W.default.fetch(new Request(skinUrl, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, ctx);
  const after = await W.default.fetch(new Request('https://w.example/?action=yf&symbol=AAPL&interval=1d&range=5d', { headers: { 'CF-Connecting-IP': '203.0.113.9' } }), env, ctx);
  ok('rejected skin requests do not count against the rate limit', after.status !== 429, after.status);
  globalThis.fetch = realFetch;

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
