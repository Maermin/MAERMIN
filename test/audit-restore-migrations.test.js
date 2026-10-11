// Regression test, docs/AUDIT.md run 2026-10-09: restoring an OLD full backup on a device whose schema
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

// A backup made by the current code survives restore + migrations unchanged.
const current = JSON.stringify([{ id: 't1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 2, price: 150, currency: 'USD', date: '2024-05-02', portfolioId: 'default' }]);
localStorage.setItem('transactions', current);
const snap = B.snapshot();
localStorage.setItem('transactions', '[]');
B.restore(snap);
ok('restore resets the schema so pending migrations run on the next load', MG.getVersion() === 0);
MG.run();
ok('a current backup comes back byte-identical after the migrations', localStorage.getItem('transactions') === current && MG.getVersion() === MG.LATEST);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
