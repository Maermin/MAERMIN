// Regression test, docs/AUDIT.md run 2026-10-09: XIRR returns the Newton start value 10 % p.a. when all
// flows sit on one day and net to zero (every rate is a "root"). A buy dated
// today valued at its purchase price (no quote yet, or price unchanged) shows
// +10 % p.a.
// Run: node test/audit-xirr-degenerate.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const R = require('../returns-engine.js');

console.log('xirr degenerate:');
const flows = R.buildCashflows([{ type: 'buy', category: 'stocks', symbol: 'X', quantity: 10, price: 100, currency: 'EUR', date: '2026-10-09' }],
  { currentValueEUR: 1000, today: '2026-10-09' });
const x = R.xirr(flows);
ok('buy today at 1000, worth 1000 today → no annualised rate (null) or 0, not 10 %', x === null || Math.abs(x) < 1e-9);
const x2 = R.xirr([{ date: '2025-03-01', amount: -500 }, { date: '2025-03-01', amount: 500 }]);
ok('buy and sell at the same price the same day → null or 0', x2 === null || Math.abs(x2) < 1e-9);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
