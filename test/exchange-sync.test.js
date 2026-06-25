// Node harness for Exchange read-only sync (WI-7). Pure, no browser.
// Run: node test/exchange-sync.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const X = require('../exchange-sync.js');

(function run() {
  console.log('exchange-sync:');

  // ---- pair parsing ----
  ok('BTCEUR splits', JSON.stringify(X.parsePair('BTCEUR')) === JSON.stringify({ base: 'BTC', quote: 'EUR' }));
  ok('BTC-USD splits', X.parsePair('BTC-USD').quote === 'USD');
  ok('Kraken XBT maps to BTC', X.parsePair('XBT/EUR').base === 'BTC');
  ok('USDT quote -> USD currency', X.quoteCurrency(X.parsePair('ETHUSDT').quote) === 'USD');

  // ---- read-only scope guard ----
  ok('read-only scope accepted', X.validateReadOnly(['read', 'balance']).ok === true);
  ok('trade scope rejected', X.validateReadOnly(['read', 'trade']).ok === false);
  ok('withdraw scope rejected', X.validateReadOnly(['withdrawal']).ok === false);
  ok('permissions object rejected on write', X.validateReadOnly({ read: true, enableWithdrawals: true }).ok === false);
  ok('violations are reported', X.validateReadOnly(['spot_trade']).violations.length === 1);

  // ---- Binance adapter ----
  const binanceRaw = [
    { symbol: 'BTCEUR', id: 111, price: '50000', qty: '0.1', commission: '0.5', commissionAsset: 'EUR', time: Date.UTC(2026, 0, 2), isBuyer: true },
    { symbol: 'ETHUSDT', id: 112, price: '3000', qty: '1', commission: '0.01', commissionAsset: 'ETH', time: Date.UTC(2026, 0, 3), isBuyer: false }
  ];
  const bt = X.mapTrades('binance', binanceRaw);
  ok('binance maps two trades', bt.length === 2);
  ok('binance buy mapped', bt[0].type === 'buy' && bt[0].symbol === 'BTC' && bt[0].quantity === 0.1 && bt[0].price === 50000);
  ok('binance fee in quote currency kept', bt[0].fees === 0.5 && bt[0].currency === 'EUR');
  ok('binance fee in non-quote asset ignored', bt[1].fees === 0);
  ok('binance USDT quote -> USD', bt[1].currency === 'USD' && bt[1].type === 'sell');
  ok('binance carries external markers', bt[0].source === 'exchange-sync' && bt[0].exchange === 'binance' && bt[0].externalId === '111');

  // ---- Kraken adapter ----
  const krakenRaw = { result: { trades: {
    'TXAAA': { pair: 'XBTEUR', type: 'buy', price: '40000', vol: '0.05', fee: '1.2', time: 1767312000 },
    'TXBBB': { pair: 'ETHEUR', type: 'sell', price: '2500', vol: '2', fee: '0.8', time: 1767398400 }
  } } };
  const kt = X.mapTrades('kraken', krakenRaw);
  ok('kraken maps two trades', kt.length === 2);
  ok('kraken XBT -> BTC, buy', kt.find(x => x.externalId === 'TXAAA').symbol === 'BTC');
  ok('kraken sell mapped', kt.find(x => x.externalId === 'TXBBB').type === 'sell');

  // ---- Coinbase adapter ----
  const cbRaw = [{ trade_id: 'c1', product_id: 'BTC-EUR', side: 'buy', size: '0.2', price: '45000', fee: '2', created_at: '2026-02-01T00:00:00Z' }];
  const ct = X.mapTrades('coinbase', cbRaw);
  ok('coinbase maps', ct.length === 1 && ct[0].symbol === 'BTC' && ct[0].fees === 2 && ct[0].exchange === 'coinbase');

  // ---- dedupe on repeat sync ----
  const existing = X.mergeSync([], bt, {}).transactions;
  ok('first merge adds all', existing.length === 2);
  const second = X.mergeSync(existing, bt, {});
  ok('repeat sync adds nothing (idempotent)', second.added.length === 0 && second.skipped === 2);
  ok('repeat sync leaves the list unchanged', second.transactions.length === 2);

  // dedupe within one batch (same externalId twice)
  const dupBatch = X.dedupe(bt.concat([bt[0]]), []);
  ok('intra-batch duplicate dropped', dupBatch.unique.length === 2 && dupBatch.dropped === 1);

  // same-day fallback dedupe (no externalId match but identical trade)
  const manualTx = [{ symbol: 'BTC', type: 'buy', quantity: 0.1, price: 50000, date: '2026-01-02' }];
  const fb = X.dedupe(bt, manualTx);
  ok('same-day fallback drops the matching manual trade', fb.dropped === 1 && fb.unique.length === 1);

  // ---- state never serialises a secret ----
  let st = X.addConnection({ version: 1, connections: [] }, { exchange: 'binance', label: 'My Binance', apiKey: 'SECRETKEY', apiSecret: 'SECRETSECRET' });
  const serialized = JSON.stringify(X.normalize(st));
  ok('state has the connection', X.normalize(st).connections.length === 1);
  ok('no plaintext apiKey in serialized state', serialized.indexOf('SECRETKEY') === -1);
  ok('no plaintext apiSecret in serialized state', serialized.indexOf('SECRETSECRET') === -1);
  ok('unknown exchange rejected', X.normalize({ connections: [{ exchange: 'ftx' }] }).connections.length === 0);

  // removeConnection
  const cid = X.normalize(st).connections[0].id;
  ok('removeConnection deletes', X.removeConnection(st, cid).connections.length === 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
