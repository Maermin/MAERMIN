// Node harness for P1-6 (FINDINGS.md M-1, M-3, L-1, L-2): returns and tax
// figures count the right money in the right year at the right rate.
// Run: node test/return-tax.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 0.005 : eps);

let _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const R = require('../returns-engine.js');
const I = require('../interest-engine.js');
const GT = require('../tax-calculation-engine.js').GermanTax;
const TS = require('../tax-settings.js');
const TR = require('../tax-report-builder.js');
const M = require('../metrics.js');

(function run() {
  // ---- M-1: XIRR ignores Net-Worth cash interest --------------------------
  console.log('M-1 XIRR:');
  const stock = [{ id: 'b', type: 'buy', category: 'stocks', symbol: 'SAP.DE', quantity: 100, price: 100, currency: 'EUR', date: '2025-01-01' }];
  const accrual = { id: 'i', type: 'interest', category: 'cash', symbol: 'Festgeld', quantity: 1, price: 1500, amount: 1500, currency: 'EUR', date: '2025-07-01', source: 'interest-accrual', accountId: 'fg' };
  const flowsWith = R.buildCashflows(stock.concat([accrual]), { rate: 1, currentValueEUR: 10000, today: '2026-01-01' });
  const xirr = R.xirr(flowsWith);
  ok('M-1: a flat 10,000 EUR position plus a cash-account accrual has 0 % XIRR (was 15 %)', xirr != null && near(xirr, 0, 1e-6));
  ok('M-1: the accrual is not a portfolio cash flow', flowsWith.length === 2);
  const brokerInterest = { id: 'j', type: 'interest', category: 'stocks', symbol: 'Broker cash', quantity: 1, price: 50, currency: 'EUR', date: '2025-07-01' };
  ok('M-1: interest paid inside the portfolio (not a Net-Worth account) still counts', R.buildCashflows(stock.concat([brokerInterest]), { rate: 1, currentValueEUR: 10000, today: '2026-01-01' }).length === 3);

  // ---- M-3: interest in its accrual year ----------------------------------
  console.log('M-3 interest year:');
  const cash = { id: 'tg', name: 'Tagesgeld', type: 'cash', interestRate: 3, compounding: 'daily', value: 10000, currency: 'EUR', startDate: '2025-12-01' };
  const run1 = I.runCatchUp({ accounts: [cash], transactions: [], asOf: '2026-01-15' });
  ok('M-3: an accrual across 31 Dec is split into two postings', run1.created.length === 2);
  const dec = run1.created.find((t) => t.date === '2025-12-31'), jan = run1.created.find((t) => t.date === '2026-01-15');
  ok('M-3: December\'s interest is dated 2025-12-31 (taxed in 2025)', dec && dec.periodStart === '2025-12-01' && dec.periodEnd === '2025-12-31');
  ok('M-3: January\'s interest starts where December ended', jan && jan.periodStart === '2025-12-31');
  const whole = I.accrue(cash, '2026-01-15').interest;
  ok('M-3: the split books the same total (compounding continues)', near(dec.amount + jan.amount, whole, 1e-6) && near(run1.accounts[0].value, 10000 + whole, 1e-6));
  ok('M-3: the yearly ledger gets the right year', near(I.yearlyInterest(run1.ledger, 2025), dec.amount, 1e-9) && near(I.yearlyInterest(run1.ledger, 2026), jan.amount, 1e-9));
  ok('M-3: a split chain is not seen as duplicates by the post-sync dedupe', I.dedupeAccruals(run1.transactions, run1.accounts).removed === 0);

  // A Festgeld pays its interest at maturity (Zuflussprinzip): nothing before.
  const fg = { id: 'fg', name: 'Festgeld', type: 'time_deposit', interestRate: 2, compounding: 'annual', value: 20000, currency: 'EUR', startDate: '2025-03-01', maturityDate: '2026-03-01' };
  const before = I.runCatchUp({ accounts: [fg], transactions: [], asOf: '2025-12-31' });
  ok('M-3: no Festgeld interest booked before maturity (was: every year the app was opened)', before.created.length === 0 && before.accounts[0].value === 20000);
  const at = I.runCatchUp({ accounts: before.accounts, transactions: before.transactions, asOf: '2026-03-10' });
  ok('M-3: at maturity the whole interest is booked once, dated the maturity day', at.created.length === 1 && at.created[0].date === '2026-03-01' && near(at.created[0].amount, 400));
  ok('M-3: ... in the maturity year', near(I.yearlyInterest(at.ledger, 2026), 400) && I.yearlyInterest(at.ledger, 2025) === 0);
  const again = I.runCatchUp({ accounts: at.accounts, transactions: at.transactions, asOf: '2026-06-01' });
  ok('M-3: nothing more after maturity', again.created.length === 0);
  // A Festgeld that credits interest every year is split like a cash account.
  const fgYearly = Object.assign({}, fg, { interestPayout: 'annual' });
  const y = I.runCatchUp({ accounts: [fgYearly], transactions: [], asOf: '2026-03-10' });
  ok('M-3: a yearly-crediting Festgeld books per year', y.created.length === 2 && y.created[0].date === '2025-12-31' && y.created[1].date === '2026-03-01');

  // ---- L-1: § 23 Freigrenze on cent-rounded amounts ------------------------
  console.log('L-1 Freigrenze:');
  _store = {};
  const lot = (sym, buy, sell, day) => [
    { id: sym + 'b', type: 'buy', category: 'crypto', symbol: sym, quantity: 1, price: buy, currency: 'EUR', date: '2025-02-01' },
    { id: sym + 's', type: 'sell', category: 'crypto', symbol: sym, quantity: 1, price: sell, currency: 'EUR', date: '2025-06-0' + day }
  ];
  // Three gains of 489.13 + 255.44 + 255.43 = 1,000.00 EUR in cents, whose
  // float sum (in disposal order) is 999.9999999999999.
  const txs = lot('AAA', 1.4, 490.53, 1).concat(lot('BBB', 0.2, 255.64, 2)).concat(lot('CCC', 0.3, 255.73, 3));
  const sumFloat = (490.53 - 1.4) + (255.64 - 0.2) + (255.73 - 0.3);
  ok('L-1 repro: the float sum is below 1,000', sumFloat < 1000);
  const de = TR.build(txs, { year: 2025, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT,
    taxSettingsModule: TS, fundTypes: {}, vapRecords: {}, dividendEvents: [], taxOverrides: {} }).summary.germanDetail;
  ok('L-1: a gain of exactly 1,000.00 EUR is taxable (Freigrenze is "less than 1,000")', de.crypto.taxable === 1000 && near(de.crypto.estimatedTax, 250));

  // ---- L-2: loss-harvest rate per jurisdiction and asset -------------------
  console.log('L-2 loss harvesting:');
  const asOf = '2026-10-05';
  const tl = [
    { id: '1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, currency: 'EUR', date: '2024-01-02' },   // long-term
    { id: '2', type: 'buy', category: 'stocks', symbol: 'MSFT', quantity: 10, price: 100, currency: 'EUR', date: '2026-08-01' },   // short-term
    { id: '3', type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 3000, currency: 'EUR', date: '2024-01-02' },    // > 1 y
    { id: '4', type: 'buy', category: 'crypto', symbol: 'SOL', quantity: 10, price: 100, currency: 'EUR', date: '2026-08-01' },    // < 1 y
    { id: '5', type: 'buy', category: 'skins', symbol: 'AK', quantity: 1, price: 500, currency: 'EUR', date: '2024-01-02' }        // > 1 y
  ];
  const portfolio = M.buildPositions(tl, { exchangeRate: 1 });
  const prices = { AAPL: 80, aapl: 80, MSFT: 80, msft: 80, ETH: 2000, eth: 2000, SOL: 90, sol: 90, AK: 400, ak: 400 };
  const row = (res, s) => res.rows.find((r) => r.symbol === s);
  const legacy = M.computeTaxLossHarvest(portfolio, prices, tl);
  ok('L-2 repro: without a jurisdiction every loss is valued at 26.375 %, also tax-free crypto', near(row(legacy, 'ETH').taxSavings, 1000 * 0.26375));
  const us = M.computeTaxLossHarvest(portfolio, prices, tl, { jurisdiction: 'us', asOf, exchangeRate: 1 });
  ok('L-2 US: a long-term loss saves 15 %', near(row(us, 'AAPL').taxSavings, 200 * 0.15));
  ok('L-2 US: a short-term loss saves 24 %', near(row(us, 'MSFT').taxSavings, 200 * 0.24));
  ok('L-2 US: crypto is not tax-free in the US (long-term rate)', near(row(us, 'ETH').taxSavings, 1000 * 0.15));
  const deRes = M.computeTaxLossHarvest(portfolio, prices, tl, { jurisdiction: 'de', asOf, exchangeRate: 1, settings: TS.sanitize({}) });
  ok('L-2 DE: securities at Abgeltungsteuer + Soli (26.375 %)', near(row(deRes, 'AAPL').taxSavings, 200 * 0.26375));
  ok('L-2 DE: crypto held over a year is tax-free -> selling saves nothing', row(deRes, 'ETH').taxSavings === 0 && row(deRes, 'ETH').taxFree === true);
  ok('L-2 DE: a skin held over a year is tax-free too', row(deRes, 'AK').taxSavings === 0);
  ok('L-2 DE: crypto within a year at the private-sale estimate (25 %)', near(row(deRes, 'SOL').taxSavings, 100 * 0.25));
  const kist = M.computeTaxLossHarvest(portfolio, prices, tl, { jurisdiction: 'de', asOf, exchangeRate: 1, settings: TS.sanitize({ kirchensteuer: 0.09 }) });
  ok('L-2 DE: the configured church tax raises the securities rate', row(kist, 'AAPL').taxSavings > row(deRes, 'AAPL').taxSavings);
  const noEx = M.computeTaxLossHarvest(portfolio, prices, tl, { jurisdiction: 'de', asOf, exchangeRate: 1, settings: TS.sanitize({ cryptoExemption: false }) });
  ok('L-2 DE: with the crypto exemption off, long-held crypto counts again', row(noEx, 'ETH').taxSavings > 0 && row(noEx, 'AK').taxSavings === 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
