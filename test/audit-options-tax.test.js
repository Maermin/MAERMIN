// AUDIT (do not merge): option trades (category 'options', price = premium PER
// SHARE, quantity = contracts) go through the plain FIFO ledger in the tax
// report: the contract size (100) is ignored, so a 300 EUR option gain is
// reported as 3 EUR; a short option (sell to open, buy to close) is an
// "oversell" and its premium never reaches the report.
// Run: node test/audit-options-tax.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const TR = require('../tax-report-builder.js');
const TE = require('../tax-calculation-engine.js');
const TS = require('../tax-settings.js');
const OE = require('../options-engine.js');

const opt = { category: 'options', underlying: 'AAPL', optionType: 'call', strike: 200, expiry: '2025-12-19', contractSize: 100, currency: 'EUR' };
const sym = 'AAPL 2025-12-19 C 200';
const longCall = [
  Object.assign({ id: 'o1', type: 'buy', symbol: sym, quantity: 1, price: 5, date: '2025-03-01' }, opt),
  Object.assign({ id: 'o2', type: 'sell', symbol: sym, quantity: 1, price: 8, date: '2025-04-01' }, opt)
];
const opts = { year: 2025, jurisdiction: 'de', exchangeRate: 1, germanTax: TE.GermanTax, taxSettings: TS.sanitize({}), taxSettingsModule: TS,
  fundTypes: {}, vapRecords: {}, taxOverrides: {}, dividendEvents: [] };

console.log('options in the tax report:');
const engine = OE.buildOptionPositions(longCall, { exchangeRate: 1 })[0];
ok('options engine: realised premium 300 (sanity)', engine && Math.abs(engine.netPremiumEUR - 300) < 1e-9);
const rep = TR.build(longCall, opts);
ok('tax report: long call realised gain 300 (1 contract x 100 x 3)', Math.abs(rep.summary.netRealized - 300) < 1e-6);

const shortPut = [
  Object.assign({ id: 's1', type: 'sell', symbol: 'AAPL 2025-12-19 P 150', quantity: 2, price: 4, date: '2025-02-01' }, opt, { optionType: 'put', strike: 150 }),
  Object.assign({ id: 's2', type: 'buy', symbol: 'AAPL 2025-12-19 P 150', quantity: 2, price: 1, date: '2025-05-01' }, opt, { optionType: 'put', strike: 150 })
];
const rep2 = TR.build(shortPut, opts);
ok('tax report: short put closed for a 600 gain (2 x 100 x 3)', Math.abs(rep2.summary.netRealized - 600) < 1e-6);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
