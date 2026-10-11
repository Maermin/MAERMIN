// Regression test, docs/AUDIT.md run 2026-10-09: savings-plan executor
//  (a) a recorded price of ANY age before the due date is taken as the exact
//      fill (estimatedPrice false), so a back-dated execution can be booked at
//      a price from years earlier and is never re-priced;
//  (b) dedupeExecutions removes EVERY copy when the duplicates share one id
//      (e.g. the same row arriving twice through restore + sync).
// Run: node test/audit-savings-plan-price.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const SP = require('../savings-plan-executor.js');

console.log('savings-plan price at due date:');
const hist = { BTC: [{ timestamp: '2023-01-01T10:00:00Z', price: 15000 }] };
const r = SP.priceForBackfill(hist, { BTC: 60000 }, 'BTC', '2025-06-01');
ok('a 2023 price is not an exact fill for a 2025-06-01 execution', !(r && r.price === 15000 && r.estimated === false));
const near = SP.priceForBackfill({ BTC: [{ timestamp: '2025-05-30T10:00:00Z', price: 58000 }] }, { BTC: 60000 }, 'BTC', '2025-06-01');
ok('a price two days before is still an exact fill', near && near.price === 58000 && near.estimated === false);

console.log('dedupeExecutions with identical ids:');
const row = { id: 'sp-1', type: 'buy', symbol: 'BTC', quantity: 0.01, price: 10000, source: 'savings-plan', planId: 'p1', dueDate: '2025-01-01' };
const d = SP.dedupeExecutions([row, Object.assign({}, row)]);
ok('one copy survives', d.transactions.length === 1);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
