// Node harness for P5-4.3, the Vorabpauschale forecast: the expected
// Vorabpauschale per fund for the coming January, the tax and the cash needed
// on the clearing account, per portfolio, and the December reminder.
// Run: node test/vap-forecast.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const GT = require('../tax-calculation-engine.js').GermanTax;
const VF = require('../vap-forecast.js');

const RATE = 1.055 * 0.25; // Abgeltungsteuer + Soli, no church tax
const hist = (pairs) => pairs.map(([d, p]) => ({ timestamp: d + 'T12:00:00Z', price: p }));

(function run() {
  console.log('vap-forecast:');

  // 100 WORLD held since 2024, 100 at the start of 2026, 104 now (1 June):
  // Basisertrag 10,000 x 3.20 % x 0.7 = 224, the gain so far 400 caps nothing.
  const txs = [{ type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 100, price: 80, currency: 'EUR', date: '2024-03-01', portfolioId: 'p1' }];
  const base = {
    asOf: '2026-06-01', germanTax: GT,
    priceHistory: { WORLD: hist([['2025-12-31', 100], ['2026-05-30', 103]]) },
    prices: { WORLD: 104 },
    fundTypes: { WORLD: 'aktienfonds' }, vapRecords: {}, basiszinsOverrides: {},
    freistellungsauftrag: 1000, kirchensteuer: 0, exchangeRate: 1,
    isFund: (s) => s === 'WORLD'
  };
  let f = VF.forecast(txs, base);
  let r = f.rows[0];
  ok('value year 2026, Basiszins 3.20 %', f.year === 2026 && approx(f.basiszins, 0.032), f);
  ok('value 1 Jan 10,000, value now 10,400 (live price)', approx(r.valueStart, 10000) && approx(r.valueEnd, 10400), r);
  ok('Vorabpauschale = 10,000 x 3.20 % x 0.7 = 224', approx(r.vorabpauschale, 224), r.vorabpauschale);
  ok('equity fund: 30 % Teilfreistellung, 156.80 taxable', approx(r.tfRate, 0.3) && approx(r.taxable, 156.8), r);
  ok('tax per fund without the allowance', approx(r.tax, 156.8 * RATE), r.tax);
  ok('deemed received on 2 January 2027 (a Saturday counts as a working day)', f.deemedOn === '2027-01-02', f.deemedOn);
  ok('2027 allowance 1,000 covers it: no cash needed', approx(f.totals.allowance, 1000) && approx(f.totals.cashNeeded, 0) && approx(f.totals.taxWithoutAllowance, 156.8 * RATE), f.totals);

  f = VF.forecast(txs, Object.assign({}, base, { freistellungsauftrag: 100 }));
  ok('Freistellungsauftrag 100: tax on 56.80', approx(f.totals.cashNeeded, 56.8 * RATE), f.totals);
  f = VF.forecast(txs, Object.assign({}, base, { freistellungsauftrag: 0, kirchensteuer: 0.09 }));
  ok('church tax 9 %: the statutory formula', approx(f.totals.cashNeeded, GT.abgeltungsteuer(156.8, 0.09).total), f.totals);

  // A small gain caps the Vorabpauschale: 10,000 -> 10,100 gives 100.
  f = VF.forecast(txs, Object.assign({}, base, { prices: { WORLD: 101 } }));
  ok('capped by the gain so far (100)', approx(f.rows[0].vorabpauschale, 100), f.rows[0]);
  f = VF.forecast(txs, Object.assign({}, base, { prices: { WORLD: 95 } }));
  ok('a loss so far: no Vorabpauschale', approx(f.rows[0].vorabpauschale, 0) && approx(f.totals.taxWithoutAllowance, 0), f.rows[0]);

  // Distributions reduce it: 50 paid in 2026.
  const dist = txs.concat([{ type: 'dividend', category: 'stocks', symbol: 'WORLD', quantity: 1, price: 50, currency: 'EUR', date: '2026-04-15', portfolioId: 'p1' }]);
  f = VF.forecast(dist, base);
  ok('distributions this year are subtracted (224 - 50 = 174)', approx(f.rows[0].vorabpauschale, 174), f.rows[0]);

  // Bought in March of the value year: the 1 January price times the units
  // held (the worksheet's simplification) with the month factor 10/12. Without
  // a 1 January price the fund is listed and left out of the total.
  const fresh = [{ type: 'buy', category: 'stocks', symbol: 'NEWF', quantity: 10, price: 50, currency: 'EUR', date: '2026-03-10' }];
  f = VF.forecast(fresh, Object.assign({}, base, { priceHistory: {}, prices: { NEWF: 55 }, fundTypes: { NEWF: 'aktienfonds' }, isFund: () => true }));
  ok('no price on 1 January: listed as missing and left out', f.rows.length === 1 && f.rows[0].missing === 'start' && approx(f.totals.vorabpauschale, 0) && f.missing === 1, f);
  f = VF.forecast(fresh, Object.assign({}, base, { priceHistory: { NEWF: hist([['2025-12-31', 50]]) }, prices: { NEWF: 55 }, fundTypes: { NEWF: 'aktienfonds' }, isFund: () => true }));
  ok('bought in March: month factor 10/12 (500 x 3.2 % x 0.7 x 10/12)', approx(f.rows[0].monthsFactor, 10 / 12) && approx(f.rows[0].vorabpauschale, 500 * 0.032 * 0.7 * 10 / 12), f.rows[0]);

  // A saved amount wins.
  f = VF.forecast(txs, Object.assign({}, base, { vapRecords: { WORLD: { 2026: 300 } } }));
  ok('a saved Vorabpauschale for the year is used and marked saved', approx(f.rows[0].vorabpauschale, 300) && f.rows[0].source === 'saved', f.rows[0]);

  // Not a fund, or sold out: no row.
  const stockOnly = [{ type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 5, price: 100, currency: 'EUR', date: '2024-01-01' }];
  f = VF.forecast(stockOnly, Object.assign({}, base, { priceHistory: { AAPL: hist([['2025-12-31', 150]]) }, prices: { AAPL: 160 } }));
  ok('shares are not funds: no rows', f.rows.length === 0 && approx(f.totals.cashNeeded, 0), f.rows);
  const soldOut = txs.concat([{ type: 'sell', category: 'stocks', symbol: 'WORLD', quantity: 100, price: 102, currency: 'EUR', date: '2026-04-01' }]);
  f = VF.forecast(soldOut, base);
  ok('sold out during the year: no row', f.rows.length === 0, f.rows);

  // Unclassified fund: no Teilfreistellung, flagged.
  f = VF.forecast(txs, Object.assign({}, base, { fundTypes: {} }));
  ok('unclassified fund: fully taxable and flagged', approx(f.rows[0].tfRate, 0) && approx(f.rows[0].taxable, 224) && f.rows[0].unclassified === true, f.rows[0]);

  // USD fund: values converted with the exchange rate.
  const usd = [{ type: 'buy', category: 'stocks', symbol: 'USF', quantity: 100, price: 80, currency: 'USD', date: '2024-03-01' }];
  f = VF.forecast(usd, Object.assign({}, base, { priceHistory: { USF: hist([['2025-12-31', 100]]) }, prices: { USF: 104 }, fundTypes: { USF: 'aktienfonds' }, exchangeRate: 0.9, isFund: () => true }));
  ok('USD fund: values in EUR (x 0.9)', approx(f.rows[0].valueStart, 9000) && approx(f.rows[0].vorabpauschale, 9000 * 0.032 * 0.7), f.rows[0]);

  // In January the forecast is for the previous year (the debit happening now).
  f = VF.forecast(txs, Object.assign({}, base, { asOf: '2027-01-01', priceHistory: { WORLD: hist([['2025-12-31', 100], ['2026-12-31', 110]]) }, prices: { WORLD: 112 } }));
  ok('in January: the previous year with the 31 December price', f.year === 2026 && approx(f.rows[0].valueEnd, 11000) && approx(f.rows[0].vorabpauschale, 224), f.rows[0]);

  // Per portfolio: two clearing accounts.
  const two = [
    { type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 60, price: 80, currency: 'EUR', date: '2024-03-01', portfolioId: 'p1' },
    { type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 40, price: 80, currency: 'EUR', date: '2024-03-01', portfolioId: 'p2' }
  ];
  f = VF.forecast(two, base);
  const p1 = f.byPortfolio.find((p) => p.portfolioId === 'p1'), p2 = f.byPortfolio.find((p) => p.portfolioId === 'p2');
  ok('per portfolio: 60/40 split of the tax', f.byPortfolio.length === 2 && approx(p1.taxable, 156.8 * 0.6) && approx(p2.tax, 156.8 * 0.4 * RATE), f.byPortfolio);
  ok('one portfolio: no breakdown', VF.forecast(txs, base).byPortfolio.length === 0);

  // Basiszins 0 or below: nothing.
  f = VF.forecast(txs, Object.assign({}, base, { basiszinsOverrides: { 2026: -0.001 } }));
  ok('non-positive Basiszins: no Vorabpauschale', approx(f.totals.vorabpauschale, 0));

  // deemedOn: 2 January on a Sunday moves to Monday 3 January.
  ok('firstWorkingDay(2028) = 2028-01-03 (2 Jan is a Sunday)', VF.firstWorkingDay(2028) === '2028-01-03', VF.firstWorkingDay(2028));
  ok('firstWorkingDay(2026) = 2026-01-02 (Friday)', VF.firstWorkingDay(2026) === '2026-01-02');
  ok('valueYear: June -> same year, January -> previous', VF.valueYear('2026-06-01') === 2026 && VF.valueYear('2027-01-20') === 2026 && VF.valueYear('2026-12-31') === 2026);

  // December reminder, once a year.
  f = VF.forecast(txs, Object.assign({}, base, { asOf: '2026-12-05', freistellungsauftrag: 0 }));
  ok('reminder due in December when tax is expected', VF.reminderDue(f, {}, '2026-12-05') === true);
  ok('not before December', VF.reminderDue(f, {}, '2026-11-30') === false);
  ok('not twice in the same year', VF.reminderDue(f, VF.markReminded({}, 2026), '2026-12-20') === false);
  const none = VF.forecast(stockOnly, Object.assign({}, base, { asOf: '2026-12-05' }));
  ok('nothing expected: no reminder', VF.reminderDue(none, {}, '2026-12-05') === false);
  VF.saveReminded(VF.markReminded(VF.loadReminded(), 2026));
  ok('reminded years persist (maermin_vap_reminded)', VF.loadReminded()['2026'] === true && /2026/.test(_store.maermin_vap_reminded));
  const msg = VF.reminderText(f, { formatMoney: (v) => v.toFixed(2) + ' EUR' });
  ok('reminder text names the date and the amount', /2027/.test(msg) && msg.indexOf((156.8 * RATE).toFixed(2)) >= 0, msg);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
