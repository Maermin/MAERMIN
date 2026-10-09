// AUDIT (do not merge): restoring an OLD full backup on a device whose schema
// is already current keeps maermin_schema_version, so the migrations never run
// on the restored data (transactions without ids, year-less price timestamps,
// rows of deleted portfolios stay as they were).
// Run: node test/audit-restore-migrations.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const mem = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};
const B = require('../backup-engine.js');
const MG = require('../migrations.js');

console.log('restore + migrations:');
// Current device: fully migrated.
localStorage.setItem('transactions', '[]');
MG.run();
ok('device is on the latest schema', MG.getVersion() === MG.LATEST);

// A backup written by an old build: transactions without id / category.
const oldBackup = { format: 'maermin-full', version: '8.2.0', timestamp: '2024-01-01T00:00:00Z',
  store: { transactions: JSON.stringify([
    { type: 'buy', symbol: 'BTC', quantity: 1, price: 100, date: '2023-01-01' },
    { type: 'buy', symbol: 'BTC', quantity: 1, price: 100, date: '2023-01-01' }]) } };
B.restore(oldBackup);
MG.run(); // what the reload after a restore does
const txs = JSON.parse(localStorage.getItem('transactions'));
ok('restored rows got ids (migration 1 ran)', txs.every((t) => t.id != null && t.id !== ''));
ok('restored rows got a category (migration 1 ran)', txs.every((t) => !!t.category));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
