// Node harness for P5-4.10: Switzerland (owner-approved sources 2026-10-14).
// No tax amount (cantonal, progressive): the Wertschriftenverzeichnis per
// year-end in CHF, gross income in column A (with Verrechnungssteuer) and B,
// the 35 % VST claim, the DA-1 list of foreign withholding, accumulating
// funds' income, tax-free capital gains and the KS 36 commercial-trading check.
// Run: node test/ch-tax.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
function approx(a, b, e) { return Math.abs(a - b) < (e || 1e-6); }

const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const CH = require('../ch-tax.js');
const REPORT = require('../tax-report-builder.js');
const S = (o) => Object.assign({ category: 'stocks', currency: 'CHF', portfolioId: 'A' }, o);
const hist = (pairs) => pairs.map(([d, p]) => ({ timestamp: d + 'T16:00:00Z', price: p }));

const txs = [
  S({ type: 'buy', symbol: 'NESN.SW', quantity: 10, price: 90, date: '2024-02-01' }),
  S({ type: 'sell', symbol: 'NESN.SW', quantity: 2, price: 100, date: '2025-03-03' }),
  S({ type: 'dividend', symbol: 'NESN.SW', quantity: 8, price: 3, withholdingTax: 8.4, date: '2025-04-20' }),
  S({ type: 'buy', symbol: 'AAPL', quantity: 5, price: 150, currency: 'USD', date: '2024-03-01' }),
  S({ type: 'dividend', symbol: 'AAPL', quantity: 5, price: 1, withholdingTax: 1.5, currency: 'USD', date: '2025-05-15' }),
  { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 0.1, price: 40000, currency: 'EUR', date: '2024-05-01', portfolioId: 'W' }
];
const base = { year: 2025, exchangeRate: 0.9, chfPerEur: 0.94, today: '2026-02-01',
  priceHistory: { 'NESN.SW': hist([['2025-12-30', 95]]), AAPL: hist([['2025-12-30', 250]]), btc: hist([['2025-12-31', 90000]]) },
  countryOf: (s) => (s === 'AAPL' ? 'US' : s === 'NESN.SW' ? 'CH' : null) };

(function main() {
  console.log('ch-tax:');
  let r = CH.compute(txs, base);
  const nesn = r.positions.find((p) => p.symbol === 'NESN.SW'), aapl = r.positions.find((p) => p.symbol === 'AAPL'), btc = r.positions.find((p) => p.symbol === 'BTC');

  // ---- Wertschriftenverzeichnis ----------------------------------------------
  ok('year-end holdings: 8 NESN.SW, 5 AAPL, 0.1 BTC', approx(nesn.quantity, 8) && approx(aapl.quantity, 5) && approx(btc.quantity, 0.1), r.positions.map((p) => [p.symbol, p.quantity]));
  ok('CHF security at its December close: 8 x 95 = 760 CHF', approx(nesn.valueCHF, 760), nesn);
  ok('USD security: 5 x 250 USD x 0.9 (EUR) x 0.94 = 1,057.50 CHF', approx(aapl.valueCHF, 1057.5), aapl);
  ok('crypto at the 31 December price: 0.1 x 90,000 EUR x 0.94 = 8,460 CHF', approx(btc.valueCHF, 8460), btc);
  ok('total value for the wealth tax', approx(r.totals.valueCHF, 760 + 1057.5 + 8460), r.totals);

  // ---- income A / B, VST -------------------------------------------------------
  ok('Swiss dividend with VST deducted: column A, gross 24 CHF', approx(nesn.incomeA, 24) && approx(nesn.incomeB, 0), nesn);
  ok('foreign dividend: column B, 5 USD x 0.9 x 0.94 = 4.23 CHF', approx(aapl.incomeB, 4.23) && approx(aapl.incomeA, 0), aapl);
  ok('Verrechnungssteuer claim = 35 % of column A (8.40)', approx(r.totals.incomeA, 24) && approx(r.totals.vstClaim, 8.4), r.totals);

  // ---- DA-1 -----------------------------------------------------------------------
  const us = r.foreign.find((f) => f.country === 'US');
  ok('DA-1: US gross 4.23, withheld 1.269, creditable at most 15 % (0.6345), excess 0.6345', us && approx(us.gross, 4.23) && approx(us.withheld, 1.269) && approx(us.creditable, 0.6345) && approx(us.excess, 0.6345), us);
  ok('Swiss income is not in the DA-1 list', !r.foreign.some((f) => f.country === 'CH'));

  // ---- capital gains: tax-free, shown for information ------------------------------
  ok('capital gains are tax-free (2 x (100 - 90) = 20 CHF, for information)', approx(r.gains.realized, 20) && r.gains.taxFree === true, r.gains);

  // ---- accumulating funds ------------------------------------------------------------
  const fundTx = txs.concat([S({ type: 'buy', symbol: 'CHSPI.SW', quantity: 10, price: 100, date: '2024-01-10' }), S({ type: 'buy', symbol: 'VWRA.L', quantity: 10, price: 100, currency: 'USD', date: '2024-01-10' })]);
  r = CH.compute(fundTx, Object.assign({}, base, { funds: { 'CHSPI.SW': { age: { 2025: 30 } }, 'VWRA.L': { age: { 2025: 12 } } } }));
  ok('accumulating fund income: Swiss fund in A (30), foreign in B (12)', approx(r.positions.find((p) => p.symbol === 'CHSPI.SW').incomeA, 30) && approx(r.positions.find((p) => p.symbol === 'VWRA.L').incomeB, 12) && approx(r.totals.fundIncome, 42), r.totals);

  // ---- missing data --------------------------------------------------------------------
  r = CH.compute(txs, Object.assign({}, base, { priceHistory: {} }));
  ok('no December price: flagged, valued at cost (not guessed)', r.positions.find((p) => p.symbol === 'NESN.SW').missingPrice === true && approx(r.positions.find((p) => p.symbol === 'NESN.SW').valueCHF, 720), r.positions.find((p) => p.symbol === 'NESN.SW'));
  r = CH.compute(txs, Object.assign({}, base, { chfPerEur: null }));
  ok('no CHF rate for a non-CHF amount: flagged', r.missingRate === true);
  r = CH.compute(txs, Object.assign({}, base, { year: 2026, today: '2026-10-14', priceHistory: { 'NESN.SW': hist([['2026-10-13', 99]]) } }));
  ok('the current year: provisional (today\'s price)', r.provisional === true && approx(r.positions.find((p) => p.symbol === 'NESN.SW').valueCHF, 792));

  // ---- KS 36 ---------------------------------------------------------------------------------
  r = CH.compute(txs, Object.assign({}, base, { settings: { otherIncome: 100000, debtFinanced: false } }));
  const ks = r.ks36;
  ok('KS 36: holding period of the sales (13 months) met', ks.criteria.find((c) => c.key === 'holding').status === 'met', ks);
  ok('KS 36: volume within 5x the holdings met', ks.criteria.find((c) => c.key === 'volume').status === 'met', ks.criteria);
  ok('KS 36: gains under 50 % of income met; no debt; no derivatives: private asset management', ks.criteria.every((c) => c.status === 'met') && ks.status === 'private', ks);
  const quick = txs.concat([S({ type: 'buy', symbol: 'UBSG.SW', quantity: 100, price: 20, date: '2025-06-01' }), S({ type: 'sell', symbol: 'UBSG.SW', quantity: 100, price: 25, date: '2025-07-15' }),
    { type: 'buy', category: 'options', symbol: 'AAPL C 300', quantity: 1, price: 5, currency: 'USD', date: '2025-08-01', portfolioId: 'A' }]);
  r = CH.compute(quick, Object.assign({}, base, { settings: { otherIncome: 100000, debtFinanced: false } }));
  ok('KS 36: a sale held 6 weeks fails the holding period; options need a check', r.ks36.criteria.find((c) => c.key === 'holding').status === 'not-met' && r.ks36.criteria.find((c) => c.key === 'derivatives').status === 'check' && r.ks36.status === 'check', r.ks36);
  r = CH.compute(txs, base);
  ok('KS 36 without the user\'s other income or debt answer: unknown, not assumed', r.ks36.criteria.find((c) => c.key === 'gains').status === 'unknown' && r.ks36.status === 'unknown', r.ks36);

  // ---- report ----------------------------------------------------------------------------------
  const rep = REPORT.build(txs, Object.assign({ jurisdiction: 'ch' }, base, { chFunds: {}, chSettings: {} }));
  ok('report: jurisdiction "ch" fills swissDetail; no tax amount is estimated', !!rep.summary.swissDetail && rep.summary.estimatedTaxLiability === 0 && approx(rep.summary.swissDetail.totals.vstClaim, 8.4), rep.summary.swissDetail && rep.summary.swissDetail.totals);
  ok('report KPIs for Switzerland: wealth, VST claim, tax-free gains', REPORT.kpis(rep).labels && approx(REPORT.kpis(rep).taxLiability, 0));

  // ---- storage ----------------------------------------------------------------------------------
  CH.saveSettings({ otherIncome: '85000', debtFinanced: true, funds: { X: { age: { 2025: '7.5', bad: 1 } } } });
  const st = CH.loadSettings();
  ok('settings: numbers, a boolean, fund income per year', st.otherIncome === 85000 && st.debtFinanced === true && st.funds.X.age['2025'] === 7.5 && !st.funds.X.age.bad, st);
  const storage = require('fs').readFileSync(require('path').join(__dirname, '..', 'storage.js'), 'utf8');
  const backup = require('fs').readFileSync(require('path').join(__dirname, '..', 'backup-engine.js'), 'utf8');
  ok('maermin_ch_settings is encrypted and in the backup', /'maermin_ch_settings'/.test(storage) && /'maermin_ch_settings'/.test(backup));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
