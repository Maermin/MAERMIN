// Node harness for P5-4.9: Austrian tax on capital income (owner-approved
// sources 2026-10-14): 27.5 % / 25 % (§ 27a Abs 1), moving average cost
// without fees (§ 27a Abs 4 Z 2, 3, 3a), crypto Neuvermögen and swaps
// (§ 27b, § 124b Z 384), loss offset within the year (§ 27 Abs 8), funds
// (§ 186 InvFG 2011) and the 15 % foreign withholding credit.
// Run: node test/at-tax.test.js
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

const AT = require('../at-tax.js');
const REPORT = require('../tax-report-builder.js');
const S = (o) => Object.assign({ category: 'stocks', currency: 'EUR', portfolioId: 'A' }, o);
const C = (o) => Object.assign({ category: 'crypto', currency: 'EUR', portfolioId: 'W' }, o);

(function main() {
  console.log('at-tax:');

  // ---- moving average, fees out ----------------------------------------------
  // 10 at 100 (fee 5), 10 at 200 (fee 5): average 150 (fees not counted);
  // sell 5 at 180 (fee 3): gain 5 x 30 = 150, fee not deductible.
  const ma = [
    S({ id: 'a1', type: 'buy', symbol: 'AAA', quantity: 10, price: 100, fees: 5, date: '2025-01-10' }),
    S({ id: 'a2', type: 'buy', symbol: 'AAA', quantity: 10, price: 200, fees: 5, date: '2025-02-10' }),
    S({ id: 'a3', type: 'sell', symbol: 'AAA', quantity: 5, price: 180, fees: 3, date: '2025-03-10' })
  ];
  let r = AT.compute(ma, { year: 2025, exchangeRate: 1 });
  ok('moving average 150 without fees: gain 150', approx(r.disposals[0].costBasis, 750) && approx(r.disposals[0].gain, 150), r.disposals[0]);
  ok('27.5 % on 150 = 41.25', approx(r.taxableIncome, 150) && approx(r.tax, 41.25), r);
  // A later buy moves the average of what is left.
  r = AT.compute(ma.concat([S({ type: 'buy', symbol: 'AAA', quantity: 15, price: 300, date: '2025-04-10' }), S({ type: 'sell', symbol: 'AAA', quantity: 10, price: 300, date: '2025-05-10' })]), { year: 2025, exchangeRate: 1 });
  ok('average after a new buy: (15 x 150 + 15 x 300) / 30 = 225', approx(r.disposals[1].costBasis / 10, 225), r.disposals[1]);
  // Per depot: the same security in another portfolio keeps its own average.
  r = AT.compute([S({ type: 'buy', symbol: 'BBB', quantity: 1, price: 100, date: '2025-01-01' }), S({ type: 'buy', symbol: 'BBB', quantity: 1, price: 300, date: '2025-01-02', portfolioId: 'B' }),
    S({ type: 'sell', symbol: 'BBB', quantity: 1, price: 200, date: '2025-02-01' })], { year: 2025, exchangeRate: 1 });
  ok('average per depot: depot A sells its own 100 lot, gain 100', approx(r.disposals[0].gain, 100), r.disposals);

  // ---- income pool, losses within the year, bank interest -------------------------
  const pool = [
    S({ type: 'buy', symbol: 'WIN', quantity: 10, price: 100, date: '2024-01-01' }), S({ type: 'sell', symbol: 'WIN', quantity: 10, price: 150, date: '2025-03-01' }),
    S({ type: 'buy', symbol: 'LOSE', quantity: 10, price: 100, date: '2024-01-01' }), S({ type: 'sell', symbol: 'LOSE', quantity: 10, price: 30, date: '2025-04-01' }),
    S({ type: 'dividend', symbol: 'WIN', quantity: 10, price: 10, date: '2025-05-01' }),
    { type: 'interest', category: 'cash', symbol: 'Sparbuch', amount: 200, currency: 'EUR', date: '2025-12-31', portfolioId: 'A' }
  ];
  r = AT.compute(pool, { year: 2025, exchangeRate: 1 });
  ok('gains 500 - losses 700 + dividends 100 = -100: the pool is 0, 100 of losses are lost', approx(r.pool27, 0) && approx(r.lossesLost, 100), r);
  ok('bank interest taxed at 25 % on its own: 50, losses cannot offset it', approx(r.bankInterest, 200) && approx(r.tax, 50), r);
  ok('no carry-forward: the next year starts from zero', approx(AT.compute(pool, { year: 2026, exchangeRate: 1 }).tax, 0));

  // ---- foreign withholding ---------------------------------------------------------
  const div = [S({ type: 'dividend', symbol: 'USX', quantity: 1, price: 1000, withholdingTax: 300, date: '2025-05-01' })];
  r = AT.compute(div, { year: 2025, exchangeRate: 1 });
  ok('foreign withholding credited up to 15 %: 275 - 150 = 125', approx(r.withholdingCredit, 150) && approx(r.tax, 125), r);
  r = AT.compute(div.concat([S({ type: 'buy', symbol: 'L', quantity: 1, price: 1000, date: '2024-01-01' }), S({ type: 'sell', symbol: 'L', quantity: 1, price: 100, date: '2025-02-01' })]), { year: 2025, exchangeRate: 1 });
  ok('losses reduce the pool first; the credit is capped at the tax on the dividends left (100 x 27.5 %)', approx(r.pool27, 100) && approx(r.withholdingCredit, 27.5) && approx(r.tax, 0), r);

  // ---- crypto ---------------------------------------------------------------------------
  const cr = [
    C({ type: 'buy', symbol: 'BTC', quantity: 1, price: 30000, date: '2021-01-15' }),       // Altvermögen
    C({ type: 'buy', symbol: 'BTC', quantity: 1, price: 50000, date: '2022-06-01' }),       // Neuvermögen
    C({ type: 'sell', symbol: 'BTC', quantity: 2, price: 90000, date: '2025-03-01' })
  ];
  r = AT.compute(cr, { year: 2025, exchangeRate: 1 });
  ok('crypto: Altvermögen (bought before 1.3.2021) stays tax-free, Neuvermögen 40,000 taxable', approx(r.cryptoTaxable, 40000) && approx(r.altvermoegenExempt, 60000), r);
  ok('crypto taxed at 27.5 % in the pool', approx(r.tax, 11000), r.tax);
  // Swap BTC -> ETH: not a sale; the BTC cost carries over to ETH.
  const sw = [
    C({ id: 'k1', type: 'buy', symbol: 'BTC', quantity: 1, price: 20000, date: '2023-01-05' }),
    C({ id: 'k2', type: 'sell', symbol: 'BTC', quantity: 0.5, price: 60000, date: '2024-02-01' }),
    C({ id: 'k3', type: 'buy', symbol: 'ETH', quantity: 10, price: 0.05, currency: 'BTC', date: '2024-02-01' }),
    C({ id: 'k4', type: 'sell', symbol: 'ETH', quantity: 10, price: 3500, date: '2025-06-01' })
  ];
  r = AT.compute(sw, { year: 2024, exchangeRate: 1 });
  ok('the swap year: no taxable gain (crypto for crypto is not a realisation)', approx(r.cryptoTaxable, 0) && r.swaps.length === 1, r);
  r = AT.compute(sw, { year: 2025, exchangeRate: 1 });
  ok('the ETH sale: cost = the BTC cost given (0.5 x 20,000 = 10,000), gain 25,000', approx(r.disposals[0].costBasis, 10000) && approx(r.cryptoTaxable, 25000), r.disposals);

  // ---- funds -----------------------------------------------------------------------------
  // Meldefonds: ausschüttungsgleiche Erträge 120 for 2025 (from the OeKB) are
  // taxed in 2025 and raise the cost: selling in 2026 at 1,300 after buying
  // at 1,000 gives 300 - 120 = 180.
  const fund = [S({ type: 'buy', symbol: 'FND', quantity: 10, price: 100, date: '2024-06-01' }), S({ type: 'sell', symbol: 'FND', quantity: 10, price: 130, date: '2026-03-01' })];
  const funds = { FND: { type: 'melde', age: { 2025: 120 } } };
  r = AT.compute(fund, { year: 2025, exchangeRate: 1, funds });
  ok('Meldefonds: 120 of ausschüttungsgleiche Erträge taxed in 2025', approx(r.fundIncome, 120) && approx(r.tax, 33), r);
  r = AT.compute(fund, { year: 2026, exchangeRate: 1, funds });
  ok('and they raise the cost: the 2026 sale gains 180, not 300', approx(r.disposals[0].gain, 180), r.disposals[0]);
  // Nichtmeldefonds: 90 % of the year's price gain, at least 10 % of the last price.
  const nm = { NMF: { type: 'nichtmelde' } };
  const nmTx = [S({ type: 'buy', symbol: 'NMF', quantity: 10, price: 100, date: '2024-06-01' })];
  const hist = (pairs) => pairs.map(([d, p]) => ({ timestamp: d + 'T12:00:00Z', price: p }));
  r = AT.compute(nmTx, { year: 2025, exchangeRate: 1, funds: nm, today: '2026-02-01', priceHistory: { NMF: hist([['2025-01-02', 100], ['2025-12-30', 120]]) } });
  ok('Nichtmeldefonds: 90 % of 20 = 18 per unit, 180 for 10 units', approx(r.fundIncome, 180) && r.funds[0].method === 'flat', r.funds);
  r = AT.compute(nmTx, { year: 2025, exchangeRate: 1, funds: nm, today: '2026-02-01', priceHistory: { NMF: hist([['2025-01-02', 100], ['2025-12-30', 101]]) } });
  ok('at least 10 % of the last price: 10.10 per unit, 101 for 10 units', approx(r.fundIncome, 101), r.funds);
  r = AT.compute(nmTx, { year: 2026, exchangeRate: 1, funds: nm, today: '2026-10-14', priceHistory: { NMF: hist([['2026-01-02', 100], ['2026-10-13', 130]]) } });
  ok('the current year: deemed received on 31 December, not yet counted', approx(r.fundIncome, 0) && r.funds[0].pending === true, r.funds);
  r = AT.compute(nmTx, { year: 2025, exchangeRate: 1, funds: nm, today: '2026-02-01', priceHistory: {} });
  ok('no prices for the year: flagged, not guessed', approx(r.fundIncome, 0) && r.funds[0].missing === true, r.funds);

  // ---- report integration ------------------------------------------------------------
  const rep = REPORT.build(ma, { jurisdiction: 'at', year: 2025, exchangeRate: 1, atFunds: {} });
  ok('report: jurisdiction "at" fills austrianDetail and the estimate', rep.summary.austrianDetail && approx(rep.summary.estimatedTaxLiability, 41.25) && rep.meta.method === 'moving-average', rep.summary.austrianDetail);

  // ---- storage --------------------------------------------------------------------------
  let st = AT.normalizeFunds({ X: { type: 'melde', age: { 2025: '12.5', bad: 3 } }, Y: { type: 'weird' }, Z: null });
  ok('fund settings: known types and numeric years only', st.X.type === 'melde' && st.X.age['2025'] === 12.5 && !st.X.age.bad && st.Y.type === 'melde' && !st.Z, st);
  AT.saveFunds({ X: { type: 'nichtmelde' } });
  ok('saved under maermin_at_funds', AT.loadFunds().X.type === 'nichtmelde' && /nichtmelde/.test(_store.maermin_at_funds));
  const storage = require('fs').readFileSync(require('path').join(__dirname, '..', 'storage.js'), 'utf8');
  const backup = require('fs').readFileSync(require('path').join(__dirname, '..', 'backup-engine.js'), 'utf8');
  ok('maermin_at_funds is encrypted and in the backup', /'maermin_at_funds'/.test(storage) && /'maermin_at_funds'/.test(backup));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
