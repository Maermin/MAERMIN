// AUDIT (do not merge): the tax report applies the 1,000 EUR Sparerpauschbetrag
// (the 2023+ value / the Freistellungsauftrag setting) to every year. Until
// 2022 it was 801 EUR (1,602 EUR jointly), so a 2022 report understates tax.
// Run: node test/audit-sparerpauschbetrag-year.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const TR = require('../tax-report-builder.js');
const TE = require('../tax-calculation-engine.js');
const TS = require('../tax-settings.js');

console.log('Sparerpauschbetrag per year:');
// 1,000 EUR of dividends in 2022, default settings (allowance 1,000).
const txs = [{ type: 'dividend', category: 'stocks', symbol: 'ALV', quantity: 100, price: 10, currency: 'EUR', date: '2022-05-10' }];
const opts = { year: 2022, jurisdiction: 'de', exchangeRate: 1, germanTax: TE.GermanTax, taxSettings: TS.sanitize({}), taxSettingsModule: TS,
  fundTypes: {}, vapRecords: {}, taxOverrides: {}, dividendEvents: [] };
const g = TR.build(txs, opts).summary.germanDetail;
ok('2022 allowance is 801', g && g.sparerpauschbetrag === 801);
ok('2022: 199 EUR taxable', g && Math.abs(g.taxableIncome - 199) < 1e-6);
ok('2022: tax 199 x 26.375 % = 52.49', g && Math.abs(g.totalTax - 52.48625) < 0.01);

const g23 = TR.build(txs.map((t) => Object.assign({}, t, { date: '2023-05-10' })), Object.assign({}, opts, { year: 2023 })).summary.germanDetail;
ok('2023 allowance stays 1000 (no tax)', g23 && g23.sparerpauschbetrag === 1000 && g23.totalTax === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
