// Node harness for demo mode (window.MaerminDemo): dataset integrity + flag
// toggling with an injected storage. Run: node test/demo-data.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function memStore() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; }

const D = require('../demo-data.js');

(function run() {
  const ALLOWED = ['crypto', 'stocks', 'skins', 'commodities'];

  console.log('demo dataset integrity:');
  const txs = D.getTransactions();
  ok('has demo transactions', txs.length >= 5);
  ok('every tx has the canonical shape', txs.every((t) => t.symbol && t.category && t.type && t.currency && t.date));
  ok('categories are all valid', txs.every((t) => ALLOWED.indexOf(t.category) !== -1));
  ok('numeric fields are numbers', txs.every((t) => typeof t.quantity === 'number' && typeof t.price === 'number' && typeof t.fees === 'number'));
  ok('non-dividend rows have positive qty & price', txs.filter((t) => t.type !== 'dividend').every((t) => t.quantity > 0 && t.price > 0));
  ok('covers every asset class', ALLOWED.every((c) => txs.some((t) => t.category === c)));
  ok('getTransactions returns a copy (mutation-safe)', (txs[0].symbol = 'MUT') && D.getTransactions()[0].symbol !== 'MUT');

  console.log('offline demo prices:');
  const prices = D.getPrices();
  const tradable = D.getTransactions().filter((t) => t.type !== 'dividend');
  ok('a price exists for every held symbol', tradable.every((t) => typeof prices[t.symbol] === 'number' && prices[t.symbol] > 0));
  ok('getPrices returns a copy', (prices.BTC = 1) && D.getPrices().BTC !== 1);

  console.log('flag toggling (injected storage):');
  const s = memStore();
  ok('inactive by default', D.isActive(s) === false);
  D.enable(s);
  ok('active after enable', D.isActive(s) === true);
  D.disable(s);
  ok('inactive after disable', D.isActive(s) === false);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
