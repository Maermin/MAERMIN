// AUDIT (do not merge): the 1D…Max performance cards are raw value changes of
// the snapshot series, so every deposit (a savings-plan buy, a new position)
// is shown as performance and compared with the benchmark. The module has no
// way to take the external flows into account.
// Proposed API used here: computePeriod(series, id, asOf, { flows: [{ d, amount }] })
// (amount in EUR, + = money put in), same flow format as value-path.flowsOf.
// Run: node test/audit-performance-cards-deposits.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const P = require('../performance-cards.js');

console.log('performance cards vs deposits:');
// 10,000 EUR on 1 Sep, flat prices, 1,000 EUR savings-plan buy on 15 Sep.
const series = [{ d: '2026-09-01', v: 10000 }, { d: '2026-09-15', v: 11000 }, { d: '2026-10-01', v: 11000 }];
const flows = [{ d: '2026-09-15', amount: 1000 }];
const r = P.computePeriod(series, '1M', '2026-10-01', { flows: flows });
ok('1M performance is 0 % (prices did not move), not +10 %', r && r.pct != null && Math.abs(r.pct) < 1e-9);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
