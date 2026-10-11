// App-side regression tests for the 2026-10 audit, security part
// (docs/AUDIT.md SEC-022, SEC-023, SEC-025, H-3). SEC-019 is in sync.test.js.
// Run: node test/security-app.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }

console.log('app security (2026-10 audit):');

// SEC-022: statement parsing stays fast on long runs of digits and separators
const P = require('../pdf-import.js');
let worst = 0;
['1.', '1,', '1', '1 '].forEach((pat) => { const t = pat.repeat(60000); const a = Date.now(); P.parseText(t); worst = Math.max(worst, Date.now() - a); });
ok('SEC-022: a 100 KB run of digits parses in well under a second', worst < 1000, worst + ' ms');
const real = P.parseText('Wertpapierabrechnung Kauf\nApple Inc. US0378331005\n2 Stk. 180,25 EUR\nSchlusstag 05.03.2024\nOrderentgelt 1,00 EUR');
ok('SEC-022: a normal statement still parses', real.candidates.length === 1 && real.candidates[0].quantity === 2, JSON.stringify(real.errors));

// SEC-023: names of built-in object members
const S = require('../steam-import.js');
const rows = S.newRows([{ assetid: 1, name: '__proto__' }, { assetid: 2, name: 'constructor' }, { assetid: 3, name: 'constructor' }], {});
ok('SEC-023: Steam items named like object members import without a crash', rows.length === 2 && rows.find((r) => r.name === 'constructor').qty === 2);
ok('SEC-023: Object.prototype untouched', ({}).qty === undefined && typeof ({}).constructor === 'function');
const IM = require('../import-mapping.js');
ok('SEC-023: such names are never a symbol', ['__proto__', 'constructor', 'Prototype'].every((s) => IM.normalizeSymbol(s, 'stocks') === '') && IM.normalizeSymbol('AAPL', 'stocks') === 'AAPL');

// H-3: the audit log keeps an error's type, not its message
const AL = require('../audit-log.js');
ok('H-3: an error is logged by its type', AL.errorLabel(new SyntaxError('Unexpected token in JSON at "secret"')) === 'SyntaxError');
ok('H-3: odd values fall back to "Error"', AL.errorLabel('a string with data') === 'Error' && AL.errorLabel({ name: 'x y <b>' }) === 'Error');

// SEC-025: which exchanges relay the key itself
const EX = require('../exchange-sync.js');
ok('SEC-025: Bitpanda needs no secret (the key is the credential)', EX.needsSecret('bitpanda') === false);
ok('SEC-025: Binance signs with a secret that stays in the browser', EX.needsSecret('binance') === true);

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
