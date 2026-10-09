// AUDIT (do not merge): an interest catch-up over more than one 31 December
// only splits at the FIRST year end; every later full year lands in one
// posting dated (and taxed) in the last year. Also the night of 31 Dec is
// booked into the next year.
// Run: node test/audit-interest-multiyear.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const I = require('../interest-engine.js');

console.log('interest multi-year catch-up:');
// Cash account at 3 % since mid-2023, app first run with it on 1 Mar 2025.
const res = I.accrueAll([{ id: 'a', type: 'cash', value: 10000, interestRate: 3, startDate: '2023-06-01' }], '2025-03-01');
const years = res.postings.map((p) => p.year);
ok('one posting per calendar year: 2023, 2024, 2025', JSON.stringify(years) === JSON.stringify(['2023', '2024', '2025']));
const y2025 = res.postings.filter((p) => p.year === '2025').reduce((s, p) => s + p.amount, 0);
// 1 Jan - 1 Mar 2025 is 59 days on ~10.5k: well under 100 EUR. Today it is ~363 EUR.
ok('2025 interest covers Jan-Feb only (< 100 EUR)', y2025 > 0 && y2025 < 100);
const total = res.postings.reduce((s, p) => s + p.amount, 0);
ok('split is exact (sum = whole window)', Math.abs(total - I.accrue({ id: 'a', type: 'cash', value: 10000, interestRate: 3, startDate: '2023-06-01' }, '2025-03-01').interest) < 1e-6);

// A full calendar year: all 365 days belong to that year.
const full = I.accrueAll([{ id: 'b', type: 'cash', value: 10000, interestRate: 3, compounding: 'annual', startDate: '2025-01-01' }], '2026-01-01');
const in2025 = full.postings.filter((p) => p.year === '2025').reduce((s, p) => s + p.amount, 0);
ok('account opened 1 Jan 2025, 3 % annual: 2025 gets the full 300.00', Math.abs(in2025 - 300) < 0.005);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
