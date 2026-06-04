// Regression test for the transaction edit/create bug (#3).
// The bug: editing a transaction created a NEW record instead of updating it.
// These lock the upsert invariant the modal relies on.
// Run: node test/transactions.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const Utils = require('../utils.js');

(function run() {
  const base = [
    { id: 'a', symbol: 'BTC', quantity: 1, price: 100 },
    { id: 'b', symbol: 'ETH', quantity: 2, price: 50 }
  ];

  console.log('upsertTransaction — add:');
  const add = Utils.upsertTransaction(base, { symbol: 'SOL', quantity: 5, price: 20 }, null, 'c');
  ok('adding appends exactly one record', add.transactions.length === 3);
  ok('added record keeps the new id', add.transactions[2].id === 'c');
  ok('add flagged created (not updated)', add.created === true && add.updated === false);
  ok('original records untouched', add.transactions[0] === base[0]);

  console.log('upsertTransaction — edit (the regression):');
  const edit = Utils.upsertTransaction(base, { symbol: 'BTC', quantity: 3, price: 99 }, 'a', 'ignored');
  ok('editing does NOT change record count', edit.transactions.length === 2);
  ok('edited record updated in place', edit.transactions[0].quantity === 3 && edit.transactions[0].price === 99);
  ok('edited record PRESERVES its id', edit.transactions[0].id === 'a');
  ok('edit never uses the newId / never appends', !edit.transactions.some(t => t.id === 'ignored'));
  ok('edit flagged updated (not created)', edit.updated === true && edit.created === false);
  ok('other records untouched', edit.transactions[1] === base[1]);

  console.log('upsertTransaction — edit a missing id (no stray duplicate):');
  const missing = Utils.upsertTransaction(base, { symbol: 'X' }, 'zzz', 'new');
  ok('editing a non-existent id makes NO change', missing.transactions.length === 2);
  ok('missing edit reports found=false, created=false', missing.found === false && missing.created === false);

  console.log('upsertTransaction — id collision safety:');
  const idForced = Utils.upsertTransaction(base, { id: 'HACK', symbol: 'BTC', quantity: 9 }, 'a', 'c');
  ok('data cannot overwrite the record id on edit', idForced.transactions[0].id === 'a');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
