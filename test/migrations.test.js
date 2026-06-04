// Node harness for the storage schema migration runner. Run: node test/migrations.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

globalThis.window = {};
globalThis.localStorage = {
  _d: {}, getItem(k){ return Object.prototype.hasOwnProperty.call(this._d,k)?this._d[k]:null; },
  setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; }
};
const M = require('../migrations.js');

(function run() {
  console.log('migration framework:');
  ok('starts at version 0', M.getVersion() === 0);

  // Seed legacy data: a transaction with no id and no category, plus an oversized history.
  const longHist = []; for (let i = 0; i < 150; i++) longHist.push({ timestamp: i, price: i });
  localStorage.setItem('transactions', JSON.stringify([{ symbol: 'BTC', quantity: 1, price: 100 }, { id: '', symbol: 'ETH', quantity: 2, price: 50 }]));
  localStorage.setItem('priceHistory', JSON.stringify({ BTC: longHist }));

  const v = M.run();
  ok('run advances to LATEST', v === M.LATEST && M.getVersion() === M.LATEST);

  const txs = JSON.parse(localStorage.getItem('transactions'));
  ok('v1: every transaction has a non-empty id', txs.every(t => t.id !== undefined && t.id !== null && t.id !== ''));
  ok('v1: ids are unique', new Set(txs.map(t => t.id)).size === txs.length);
  ok('v1: missing category defaulted to crypto', txs.every(t => !!t.category));

  const hist = JSON.parse(localStorage.getItem('priceHistory'));
  ok('v2: oversized history capped to 100', hist.BTC.length === 100);
  ok('v2: kept the most recent points', hist.BTC[hist.BTC.length - 1].price === 149);

  console.log('idempotency:');
  const before = localStorage.getItem('transactions');
  const v2 = M.run();
  ok('second run is a no-op (version unchanged)', v2 === M.LATEST);
  ok('second run does not mutate data', localStorage.getItem('transactions') === before);

  console.log('resilience:');
  // A migration that throws must NOT bump the version past it.
  M.setVersion(0);
  const orig = M.MIGRATIONS[0].up;
  M.MIGRATIONS[0].up = function () { throw new Error('boom'); };
  const v3 = M.run();
  ok('stops at the failing migration (stays 0)', v3 === 0 && M.getVersion() === 0);
  M.MIGRATIONS[0].up = orig;

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
