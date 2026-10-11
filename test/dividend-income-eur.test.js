// AUDIT BUG-038: expected dividends (Overview "Dividends (12m)", the quality
// panel) added a US payer's USD dividend as EUR. Also BUG-036: the session
// memo of symbols Yahoo has no listing for.
// Run: node test/dividend-income-eur.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);

globalThis.window = globalThis;
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
window.MaerminUtils = require('../utils.js');
window.DividendDataService = {
  getPortfolioDividendData: () => ({
    AAPL: { annualDividend: 0.96, currency: 'USD' },
    ALV: { annualDividend: 15.4, currency: 'EUR' }
  })
};
const M = require('../metrics.js');

console.log('expected annual dividends in EUR:');
const pf = { stocks: [{ symbol: 'AAPL', amount: 12 }, { symbol: 'ALV', amount: 2 }] };
const r = M.computeExpectedAnnualDividends(pf, { AAPL: 200, ALV: 300 }, { exchangeRate: 0.92 });
ok('12 AAPL x 0.96 USD x 0.92 + 2 ALV x 15.40 EUR = 41.40 EUR', near(r.totalAnnual, 12 * 0.96 * 0.92 + 2 * 15.4), String(r.totalAnnual));
ok('two payers', r.payers === 2);

console.log('no-listing memo (BUG-036):');
const CH = require('../close-history.js');
ok('unknown symbol is not marked at first', !CH.noListing.has('APPLE'));
CH.noListing.mark('apple');
ok('a marked symbol is skipped (case-insensitive)', CH.noListing.has('APPLE'));
CH.noListing.clear('APPLE');
ok('clear removes the mark', !CH.noListing.has('APPLE'));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
