// AUDIT (do not merge): MaerminUtils.toEUR (and the options engine's mirror of
// it) converts only USD; every other currency is returned unchanged, i.e.
// counted as EUR. Option premiums in GBP/CHF/GBp and the "dividends received"
// figure of Performance Attribution (features7.js) are off by the FX rate,
// although fx-history.js can convert them (quoteToEUR / txToEUR).
// Run: node test/audit-utils-toeur-currencies.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

const FX = require('../fx-history.js');
const U = require('../utils.js');
const OE = require('../options-engine.js');

// 1 USD = 0.92 EUR = 0.79 GBP = 0.88 CHF  →  1 GBP = 0.92/0.79 EUR
FX.setUsdRates({ EUR: 0.92, GBP: 0.79, CHF: 0.88 });
const gbpEur = 0.92 / 0.79;

console.log('toEUR for non-USD currencies:');
ok('fx-history converts 100 GBP (sanity)', near(FX.quoteToEUR(100, 'GBP', 0.92), 100 * gbpEur));
ok('utils.toEUR(100, GBP) = 116.46 EUR, not 100', near(U.toEUR(100, 'GBP', 0.92), 100 * gbpEur));
ok('utils.toEUR(500, GBp) = 5 GBP in EUR', near(U.toEUR(500, 'GBp', 0.92), 5 * gbpEur));
ok('utils.toEUR(100, CHF) = 104.55 EUR', near(U.toEUR(100, 'CHF', 0.92), 100 * 0.92 / 0.88));

const pos = OE.buildOptionPositions([{ type: 'buy', category: 'options', symbol: 'VOD C', underlying: 'VOD', optionType: 'call', strike: 1, expiry: '2026-12-18',
  contractSize: 100, quantity: 1, price: 2, currency: 'GBP', date: '2026-01-05' }], { exchangeRate: 0.92 })[0];
ok('options engine: a 2 GBP premium x 100 is 232.91 EUR paid, not 200', pos && near(pos.premiumPaidEUR, 200 * gbpEur));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
