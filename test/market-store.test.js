// Node harness for the market-data store (MaerminMarket) — prices/priceHistory/
// workerStatus/loading/lastRefresh on MaerminStore. The renderer's useStore reads
// are browser-only; here we cover get/set/getState/subscribe, the functional-
// update path the shims rely on (read-current-from-store, no stale closure), and
// mergePrices. Run: node test/market-store.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const M = require('../market-store.js');

(function run() {
  console.log('market-store:');

  // initial state
  const s0 = M.getState();
  ok('initial state shape', JSON.stringify(s0.prices) === '{}' && JSON.stringify(s0.priceHistory) === '{}' &&
    s0.workerStatus === null && s0.loading === false && s0.lastRefresh === null);

  // set / get
  M.set('loading', true);
  ok('set + get scalar', M.get('loading') === true && M.getState().loading === true);
  M.set('workerStatus', { ok: true });
  ok('set object', M.get('workerStatus').ok === true);

  // prices: a plain replace then a functional-style merge done the way the shim
  // does it (read CURRENT from the store, not a stale closure)
  M.set('prices', { BTC: 100 });
  ok('prices replace', M.get('prices').BTC === 100);
  const incoming = { ETH: 50 };
  M.set('prices', M.mergePrices(M.get('prices'), incoming)); // shim functional path
  ok('prices merged onto LATEST store value', M.get('prices').BTC === 100 && M.get('prices').ETH === 50);
  ok('mergePrices returns a NEW object (ref changes)', (() => {
    const prev = M.get('prices');
    const merged = M.mergePrices(prev, { SOL: 9 });
    return merged !== prev && merged.SOL === 9 && merged.BTC === 100;
  })());

  // subscribe fires on change; no-op set does not notify (store shallow-equal)
  let n = 0;
  const unsub = M.store.subscribe(() => { n++; });
  M.set('loading', false);
  ok('subscriber notified on real change', n === 1 && M.get('loading') === false);
  M.set('loading', false); // unchanged
  ok('no notification when value unchanged', n === 1);
  unsub();

  // priceHistory functional merge (mirrors setPriceHistory(prev => ({...prev,...})))
  M.set('priceHistory', { BTC: [1, 2] });
  M.set('priceHistory', M.mergePrices(M.get('priceHistory'), { ETH: [3] }));
  ok('priceHistory merged', M.get('priceHistory').BTC.length === 2 && M.get('priceHistory').ETH.length === 1);

  // ---- last known + effective prices (prices right after unlock) ----
  const hist = {
    bitcoin: [{ timestamp: '2026-10-01T10:00:00.000Z', price: 50000 }, { timestamp: '2026-10-02T10:00:00.000Z', price: 60000 }],
    AAPL: [{ timestamp: '2026-10-02T10:00:00.000Z', price: 120 }, { timestamp: '2026-10-03T10:00:00.000Z', price: 0 }],
    junk: 'nope', legacy: [1, 2, 3]
  };
  const lk = M.lastKnownPrices(hist);
  ok('last known = latest point', lk.bitcoin === 60000);
  ok('last known skips non-positive points', lk.AAPL === 120);
  ok('last known tolerates malformed / legacy series', lk.junk === undefined && lk.legacy === 3);
  ok('last known of nothing is empty', JSON.stringify(M.lastKnownPrices(null)) === '{}');

  const pf = {
    crypto: [{ symbol: 'bitcoin', amount: 1, purchasePrice: 30000 }],
    stocks: [{ symbol: 'AAPL', amount: 10, purchasePrice: 100 }, { symbol: 'VWCE.DE', amount: 5, purchasePrice: 110 },
             { symbol: 'FREE', amount: 1, purchasePrice: 0 }],
    custom_p2p: [{ symbol: 'Loan-1', amount: 1, purchasePrice: 500 }],
    notAList: 7
  };
  const fetched = { bitcoin: 61000 };
  const ev = M.effectivePrices(fetched, hist, pf);
  ok('fetched quote beats last known', ev.prices.bitcoin === 61000);
  ok('last known used when not fetched this session', ev.prices.AAPL === 120 && !ev.costKeys.aapl);
  ok('never priced -> cost basis under every key casing',
    ev.prices['VWCE.DE'] === 110 && ev.prices['vwce.de'] === 110 && ev.costKeys['vwce.de'] === true);
  ok('custom categories fall back too', ev.prices['Loan-1'] === 500 && ev.prices['LOAN-1'] === 500);
  ok('no cost basis -> stays unpriced', ev.prices.FREE === undefined && !ev.costKeys.free);
  ok('fetched map is not mutated', JSON.stringify(fetched) === '{"bitcoin":61000}');
  const ev2 = M.effectivePrices({ aapl: 130 }, null, pf);
  ok('case-insensitive match avoids a cost fallback', ev2.prices.AAPL === undefined && ev2.prices.aapl === 130 && !ev2.costKeys.aapl);
  ok('empty inputs are safe', JSON.stringify(M.effectivePrices(null, null, null)) === '{"prices":{},"costKeys":{}}');

  M.setCostKeys(ev.costKeys);
  ok('isCostFallback is case-insensitive', M.isCostFallback('VWCE.DE') && M.isCostFallback('vwce.de') && !M.isCostFallback('AAPL') && !M.isCostFallback(''));
  M.setCostKeys(null);
  ok('cost registry can be cleared', !M.isCostFallback('VWCE.DE'));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
