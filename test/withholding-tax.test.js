// Node harness for foreign withholding tax by country (P4-3).
// Run: node test/withholding-tax.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''))); }
const near = (a, b) => Math.abs(a - b) < 1e-9;

const W = require('../withholding-tax.js');
const K = require('../anlage-kap.js');

// Country lookup as the equity metadata would answer it.
const META = { AAPL: 'USA', NESN: 'Switzerland', OR: 'France', ALV: 'Germany', SHEL: 'UK', NOVO: 'Denmark', ZZZ: null, VWCE: 'Global' };
const fakeMeta = { getMeta: (s) => (META[s] ? { country: META[s], source: 'static' } : { country: 'Other', source: 'unknown' }) };
const countryOf = (s) => W.countryOf(s, fakeMeta);

console.log('country lookup:');
ok('known names map to ISO codes', countryOf('AAPL') === 'US' && countryOf('NESN') === 'CH' && countryOf('SHEL') === 'GB' && countryOf('ALV') === 'DE');
ok('unknown, "Other" and "Global" stay unknown (no guessing from the listing)', countryOf('ZZZ') === null && countryOf('VWCE') === null && countryOf('X.DE') === null);

console.log('by country:');
const divs = [
  { symbol: 'AAPL', gross: 100, withholding: 15 },     // US with W-8BEN
  { symbol: 'AAPL', gross: 100, withholding: 30 },     // US without the form: 15 creditable, 15 to reclaim
  { symbol: 'NESN', gross: 200, withholding: 70 },     // CH 35 %: 30 creditable, 40 to reclaim
  { symbol: 'OR', gross: 100, withholding: 12.8 },     // FR with the form: 12.8 creditable
  { symbol: 'NOVO', gross: 50, withholding: 0 },       // DK, nothing recorded
  { symbol: 'SHEL', gross: 40, withholding: 0 },       // UK has no withholding: not "missing"
  { symbol: 'ALV', gross: 300, withholding: 79.13 },   // German dividend: domestic tax
  { symbol: 'ZZZ', gross: 20, withholding: 5 },        // no country on file
  { symbol: 'AAPL', gross: 0, withholding: 0 }         // ignored
];
const r = W.byCountry(divs, { countryOf });
const row = (c) => r.rows.find(x => x.code === c);
ok('US: gross 200, withheld 45, creditable 30, reclaim 15', near(row('US').gross, 200) && near(row('US').withheld, 45) && near(row('US').creditable, 30) && near(row('US').excess, 15), JSON.stringify(row('US')));
ok('CH: creditable 15 % of 200 = 30, reclaim 40', near(row('CH').creditable, 30) && near(row('CH').excess, 40));
ok('FR: below the cap, all 12.8 creditable', near(row('FR').creditable, 12.8) && near(row('FR').excess, 0));
ok('DK without recorded withholding is flagged (statutory 27 %)', row('DK').missing === 1 && row('DK').withheld === 0);
ok('UK (0 % statutory) is not flagged', row('GB').missing === 0);
ok('German dividends are not foreign tax: left out, counted apart', !row('DE') && r.domestic.count === 1 && near(r.domestic.gross, 300));
ok('no country on file → "unknown" row, last, credited at most 15 %', r.rows[r.rows.length - 1].code === 'unknown' && near(row('unknown').creditable, 3) && near(row('unknown').excess, 2));
ok('largest gross first', r.rows[0].code === 'US' || r.rows[0].code === 'CH');
ok('totals add up (creditable 30 + 30 + 12.8 + 3, reclaim 15 + 40 + 2)', near(r.total.gross, 610) && near(r.total.withheld, 132.8) && near(r.total.creditable, 75.8) && near(r.total.excess, 57), JSON.stringify(r.total));
ok('contested and noted rates are marked', W.RATES.BE.contested && W.RATES.NO.contested && W.RATES.JP.contested && W.RATES.US.note === 'usW8');
ok('rates are dated', /^\d{4}-\d{2}-\d{2}$/.test(W.SOURCE_DATE));

console.log('same rule as the tax figures:');
{
  const foreign = divs.filter(d => countryOf(d.symbol) !== 'DE');
  const kap = K.map({ disposals: [], dividends: foreign, interestIncome: 0, vorabpauschalen: [], fundTypes: {}, fundSymbols: {} });
  const l41 = (kap.find(x => x.form === 'KAP' && x.line === 41) || {}).amount;
  ok('total creditable = Anlage KAP line 41 for the same payouts (min(withheld, 15 % × gross))', near(l41, r.total.creditable), l41 + ' vs ' + r.total.creditable);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
