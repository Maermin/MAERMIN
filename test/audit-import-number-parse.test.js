// Regression test, docs/AUDIT.md run 2026-10-09: CSV number parsing misreads German decimals with three
// fraction digits and German thousands with two or more groups.
// Run: node test/audit-import-number-parse.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);

const IM = require('../import-mapping.js');

console.log('import-mapping parseNumber:');
// A leading "0," can never start a thousands group: "0,125" is 0.125.
ok('"0,125" (DE decimal, 3 places) → 0.125', near(IM.parseNumber('0,125'), 0.125));
ok('"-0,125" → -0.125', near(IM.parseNumber('-0,125'), -0.125));
// Two or more dot groups without a comma are thousands separators.
ok('"1.234.567" → 1234567', near(IM.parseNumber('1.234.567'), 1234567));
ok('"1.234.567" with locale de → 1234567', near(IM.parseNumber('1.234.567', 'de'), 1234567));

// End to end through the wizard pipeline (no locale is passed by features2.js).
const csv = 'Datum;Typ;ISIN;Anzahl;Kurs;Währung\n15.01.2025;Kauf;IE00B4L5Y983;0,125;80,00;EUR';
const prev = IM.preview(csv, { existing: [] });
const tx = prev.transactions[0];
ok('wizard preview books quantity 0.125 (not 125)', tx && near(tx.quantity, 0.125));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
