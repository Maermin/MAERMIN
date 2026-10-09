// AUDIT (do not merge): the Basiszins table has +0.045 % for 2021. The BMF
// value (BMF-Schreiben of 6 Jan 2021) is -0.45 %, so no Vorabpauschale is due
// for 2021 - the app computes one.
// Run: node test/audit-basiszins-2021.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const GT = require('../tax-calculation-engine.js').GermanTax;

console.log('Basiszins 2021:');
ok('2021 Basiszins is -0.45 % (BMF)', Math.abs(GT.basiszinsFor(2021) - (-0.0045)) < 1e-9);
const vap = GT.computeVorabpauschale({ valueStart: 100000, valueEnd: 120000, distributions: 0, basiszins: GT.basiszinsFor(2021) });
ok('no Vorabpauschale for 2021 (100k fund, +20k)', vap.vorabpauschale === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
