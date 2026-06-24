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

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
