// Node harness for P5-3.8 exchange-more.js: Bitvavo, Bybit, KuCoin and Bitget
// registered into exchange-sync.js; each pulled through the REAL Worker relay
// (brokerproxy) from a synthetic exchange that checks every signature; the
// adapters with the fee rules; the relay policy.
// Run: node test/exchange-more.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const approx = (a, b) => Math.abs(a - b) < 1e-9;

const XS = require('../exchange-sync.js');
const XM = require('../exchange-more.js');
const sim = require('./exchange-sim.js');

(async function run() {
  const W = await import('../cf-worker/worker.js');
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = (url, init) => sim.upstream(String(url && url.url ? url.url : url), init || {});
  let ip = 0;
  const relay = async (spec) => {
    const r = await W.default.fetch(new Request('https://w.example.workers.dev/?action=brokerproxy', { method: 'POST', headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '10.4.0.' + (++ip) }, body: JSON.stringify(spec) }), {}, { waitUntil() {} });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    if (!j.ok) throw new Error('Exchange returned ' + j.status);
    return j.data;
  };
  const now = Date.parse('2025-03-10T12:00:00Z');

  console.log('registration:');
  ok('four exchanges registered with their hosts', ['bitvavo', 'bybit', 'kucoin', 'bitget'].every((x) => XS.EXCHANGES[x] && /^api\./.test(XS.EXCHANGES[x].host)) && XS.EXCHANGES.kucoin.label === 'KuCoin');
  ok('KuCoin and Bitget need a passphrase, Bitvavo and Bybit do not', XS.needsPassphrase('kucoin') && XS.needsPassphrase('bitget') && !XS.needsPassphrase('bitvavo') && !XS.needsPassphrase('bybit') && !XS.needsPassphrase('binance'));
  ok('the first four still work as before', XS.EXCHANGES.binance && XS.mapTrades('kraken', { result: { trades: {} } }).length === 0);

  console.log('\nrelay policy:');
  const allowed = (u) => W.brokerRelayAllowed(new URL(u), 'GET').ok;
  ok('read endpoints allowed', allowed('https://api.bitvavo.com/v2/trades?market=BTC-EUR') && allowed('https://api.bybit.com/v5/execution/list?category=spot') && allowed('https://api.kucoin.com/api/v1/fills') && allowed('https://api.bitget.com/api/v2/spot/trade/fills?symbol=X'));
  ok('trading and withdrawal endpoints refused', !allowed('https://api.bitvavo.com/v2/order') && !W.brokerRelayAllowed(new URL('https://api.bybit.com/v5/order/create'), 'POST').ok && !allowed('https://api.kucoin.com/api/v1/withdrawals') && !W.brokerRelayAllowed(new URL('https://api.bitget.com/api/v2/spot/trade/place-order'), 'POST').ok);

  console.log('\nBitvavo:');
  const bv = await XM.bitvavo.pull(sim.KEYS, relay, { existing: [{ category: 'crypto', symbol: 'ETH' }], now });
  const bvRows = XS.mapTrades('bitvavo', bv);
  ok('balance -> EUR markets of held and known coins (BTC held, ETH known; ETH-EUR unknown there -> skipped)', bvRows.length === 1 && sim.state.calls.some((c) => /market=ETH-EUR/.test(c)), sim.state.calls.filter((c) => /bitvavo/.test(c)));
  const b0 = bvRows[0];
  ok('buy 0.5 BTC at 60,000 EUR, fee 15 EUR', b0.type === 'buy' && b0.symbol === 'BTC' && b0.quantity === 0.5 && b0.price === 60000 && b0.fees === 15 && b0.currency === 'EUR' && b0.externalId === 'BTC-EUR:bv1' && b0.exchange === 'bitvavo', b0);

  console.log('\nBybit:');
  const by = await XM.bybit.pull(sim.KEYS, relay, { now });
  const byRows = XS.mapTrades('bybit', by);
  ok('26 weekly windows, the trade found in its window', sim.state.calls.filter((c) => /execution\/list/.test(c)).length === 26 && byRows.length === 1, byRows);
  ok('fee in ETH on a buy: valued at the price and off the quantity', approx(byRows[0].quantity, 0.999) && approx(byRows[0].fees, 2) && byRows[0].currency === 'USD' && byRows[0].date === '2025-03-05', byRows[0]);
  sim.state.bybitReadOnly = 0;
  let rw = null;
  try { await XM.bybit.pull(sim.KEYS, relay, { now }); } catch (e) { rw = e; }
  ok('a Bybit key that may trade is refused before any history call', rw && /not read-only/.test(rw.message), rw && rw.message);
  sim.state.bybitReadOnly = 1;

  console.log('\nKuCoin:');
  const ku = await XM.kucoin.pull(sim.KEYS, relay, { now });
  const kuRows = XS.mapTrades('kucoin', ku);
  ok('sell 2 SOL at 150 USDT, fee 0.30 in the quote', kuRows.length === 1 && kuRows[0].type === 'sell' && kuRows[0].quantity === 2 && kuRows[0].price === 150 && approx(kuRows[0].fees, 0.3) && kuRows[0].externalId === 'ku1:o1', kuRows);

  console.log('\nBitget:');
  const bg = await XM.bitget.pull(sim.KEYS, relay, { now });
  const bgRows = XS.mapTrades('bitget', bg);
  ok('assets -> pairs (ADA held; USDT is a quote, not a coin)', bgRows.length === 1 && !sim.state.calls.some((c) => /symbol=USDTUSDT/.test(c)), bgRows);
  ok('fee in a third asset (BGB): kept on the row with a note, not in the cost', bgRows[0].fees === 0 && bgRows[0].feeAsset === 'BGB' && bgRows[0].feeQuantity === 0.2 && /BGB/.test(bgRows[0].notes), bgRows[0]);

  console.log('\nall:');
  ok('every request was signed correctly', sim.state.badSig === 0, sim.state.badSig);
  const merged = XS.mergeSync([], bvRows.concat(byRows, kuRows, bgRows), { portfolioId: 'p1' });
  ok('merged with ids; a second sync adds nothing', merged.added.length === 4 && XS.mergeSync(merged.transactions, bvRows.concat(byRows, kuRows, bgRows), {}).added.length === 0);
  ok('row(): an unknown fee asset without amount is no fee; a sell fee in the coin is valued, quantity kept', XM.row('x', '1', 'BTC', 'EUR', 'sell', 1, 100, 0.01, 'BTC', 0).fees === 1 && XM.row('x', '1', 'BTC', 'EUR', 'sell', 1, 100, 0.01, 'BTC', 0).quantity === 1);
  ok('coinsOf: held and known, quotes and odd symbols left out', JSON.stringify(XM.coinsOf([{ coin: 'btc', amount: 1 }, { coin: 'EUR', amount: 5 }, { coin: 'X Y', amount: 1 }, { coin: 'ADA', amount: 0 }], [{ category: 'crypto', symbol: 'sol' }])) === '["BTC","SOL"]');

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
