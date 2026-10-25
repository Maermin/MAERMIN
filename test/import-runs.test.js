// Import runs and "Undo this import" (audit 2026-10-24, feature 3).
// Run: node test/import-runs.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const IR = require('../import-runs.js');

console.log('stamp:');
const input = [{ id: 'a', symbol: 'AAPL' }, { id: 'b', symbol: 'MSFT' }];
const s = IR.stamp(input, 'broker', 1700000000000);
ok('every row carries the run id', s.transactions.length === 2 && s.transactions.every((t) => t.importId === s.run.id));
ok('the input is not changed', !('importId' in input[0]));
ok('the run records source, time and count', s.run.source === 'broker' && s.run.at === 1700000000000 && s.run.count === 2 && /^imp_/.test(s.run.id));
ok('two runs get different ids', IR.stamp(input, 'broker', 1700000000000).run.id !== s.run.id);

console.log('log:');
let log = IR.add([], s.run);
ok('add puts the run first', log.length === 1 && log[0].id === s.run.id);
ok('an empty run is not logged', IR.add(log, IR.stamp([], 'x').run).length === 1);
const s2 = IR.stamp([{ id: 'c' }], 'paste', 1700000001000);
log = IR.add(log, s2.run);
ok('newest first', log[0].id === s2.run.id);
let big = [];
for (let i = 0; i < IR.MAX + 5; i++) big = IR.add(big, IR.stamp([{ id: 'x' + i }], 'file', i + 1).run);
ok('capped at MAX', big.length === IR.MAX);
ok('garbage in the log is ignored', IR.add([null, 3, { id: '' }, 'x'], s.run).length === 1);

console.log('rows and list:');
const txs = s.transactions.concat(s2.transactions, [{ id: 'm', symbol: 'manual' }]);
ok('rowsOf finds the rows of one run', IR.rowsOf(txs, s.run.id).map((t) => t.id).join() === 'a,b');
ok('rowsOf without an id finds nothing', IR.rowsOf(txs, '').length === 0 && IR.rowsOf(txs, undefined).length === 0);
const rows = IR.list(log, txs.filter((t) => t.id !== 'b'));
ok('list counts the rows still there', rows.find((r) => r.id === s.run.id).left === 1 && rows.find((r) => r.id === s2.run.id).left === 1);
ok('a run whose rows are gone shows 0 left', IR.list(log, []).every((r) => r.left === 0));

console.log('storage:');
IR.save(log);
ok('save/load round trip', IR.load().map((r) => r.id).join() === log.map((r) => r.id).join());
mem.set(IR.KEY, '{broken');
ok('a broken stored value loads as empty', IR.load().length === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
