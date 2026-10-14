// Node harness for P5-4.4, the allowance harvesting plan: which lots to sell
// and buy back so the rest of this year's Sparerpauschbetrag is used, checked
// through the real tax report (FIFO, Teilfreistellung, loss pots, carry-forward).
// Run: node test/harvest-plan.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const GT = require('../tax-calculation-engine.js').GermanTax;
const REPORT = require('../tax-report-builder.js');
const H = require('../harvest-plan.js');

const RATE = 0.25 * 1.055;
const opts = (extra) => Object.assign({ jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT, dividendEvents: [],
  taxSettings: { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true },
  sparerpauschbetrag: 1000, taxOverrides: {}, vapRecords: {}, fundTypes: {}, lossCarryState: { version: 1, opening: {} }, isFund: () => false }, extra || {});
const run = (txs, p, extra) => H.plan(txs, Object.assign({ date: '2025-12-10', fee: { fixed: 0, pct: 0 } }, p), opts(extra), { build: REPORT.build });
const T = (o) => Object.assign({ category: 'stocks', currency: 'EUR' }, o);
const leg = (r, s) => r.legs.find((l) => l.symbol === s);

(function main() {
  console.log('harvest-plan:');

  // A: 10 at 100, now 160 (600); B: 10 at 100, now 140 (400). 200 of interest
  // already uses the allowance, 800 is left.
  const base = [
    T({ type: 'buy', symbol: 'AAA', quantity: 10, price: 100, date: '2024-02-01' }),
    T({ type: 'buy', symbol: 'BBB', quantity: 10, price: 100, date: '2024-02-01' }),
    { type: 'interest', category: 'cash', symbol: 'Bank', amount: 200, currency: 'EUR', date: '2025-03-01' }
  ];
  const prices = { AAA: 160, BBB: 140 };
  let r = run(base, { prices });
  ok('allowance left before: 800', approx(r.allowanceLeft, 800), r.allowanceLeft);
  ok('greedy: all of AAA (600), then 5 of BBB (200)', r.legs.length === 2 && approx(leg(r, 'AAA').quantity, 10) && approx(leg(r, 'BBB').quantity, 5), r.legs);
  ok('gains per leg 600 and 200', approx(leg(r, 'AAA').gain, 600) && approx(leg(r, 'BBB').gain, 200));
  ok('checked through the report: 800 of the allowance used, no extra tax', approx(r.allowanceUsed, 800) && approx(r.taxDelta, 0) && r.status === 'ok', r);
  ok('future tax saved = allowance used x 26.375 %', approx(r.taxSaved, 800 * RATE), r.taxSaved);
  ok('lots listed per leg (FIFO, bought 2024-02-01)', leg(r, 'AAA').lots.length === 1 && leg(r, 'AAA').lots[0].acquisitionDate === '2024-02-01');

  // Fees: 1 EUR per order; the sell fee reduces the gain, the buy-back is a cost too.
  r = run(base, { prices, fee: { fixed: 1, pct: 0 } });
  ok('fees: 599 + 199 realised, 4 orders = 4 EUR', approx(leg(r, 'AAA').gain, 599) && approx(leg(r, 'BBB').quantity, 5) && approx(leg(r, 'BBB').gain, 199) && approx(r.fees, 4), r.legs);
  ok('net benefit = tax saved - fees', approx(r.netBenefit, r.taxSaved - 4) && approx(r.allowanceUsed, 798), r);
  r = run(base, { prices, fee: { fixed: 0, pct: 0.01 } });
  ok('percentage fee: 1 % of the sale and of the buy-back', approx(leg(r, 'AAA').fees, 1600 * 0.01 * 2), leg(r, 'AAA'));

  // Equity fund: 30 % Teilfreistellung.
  const fund = [T({ type: 'buy', symbol: 'FUND', quantity: 10, price: 100, date: '2024-02-01' })];
  r = run(fund, { prices: { FUND: 200 } }, { fundTypes: { FUND: 'aktienfonds' }, isFund: (s) => s === 'FUND' });
  ok('equity fund: gain 1000, taxable 700, all 10 sold', approx(leg(r, 'FUND').quantity, 10) && approx(leg(r, 'FUND').taxable, 700) && approx(r.allowanceUsed, 700), r.legs);
  r = run(fund.concat([{ type: 'interest', category: 'cash', symbol: 'Bank', amount: 650, currency: 'EUR', date: '2025-03-01' }]), { prices: { FUND: 200 } }, { fundTypes: { FUND: 'aktienfonds' }, isFund: (s) => s === 'FUND' });
  ok('equity fund with 350 left: 5 units (5 x 100 x 0.7 = 350)', approx(leg(r, 'FUND').quantity, 5) && approx(r.allowanceUsed, 350) && approx(r.taxDelta, 0), r.legs);

  // FIFO: the oldest lot is at a loss, so selling gains nothing.
  const lossFirst = [
    T({ type: 'buy', symbol: 'CCC', quantity: 5, price: 200, date: '2023-01-10' }),
    T({ type: 'buy', symbol: 'CCC', quantity: 5, price: 100, date: '2024-01-10' })
  ];
  r = run(lossFirst, { prices: { CCC: 150 } });
  ok('oldest lot at a loss: no gain to harvest', r.legs.length === 0 && r.status === 'nothing', r);

  // Allowance already used.
  r = run(base.concat([{ type: 'interest', category: 'cash', symbol: 'Bank', amount: 900, currency: 'EUR', date: '2025-04-01' }]), { prices });
  ok('allowance used up: status none', r.status === 'none' && r.legs.length === 0 && approx(r.allowanceLeft, 0), r.status);

  // Crypto is left out (sec. 23, not capital income).
  r = run([{ type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 10000, currency: 'EUR', date: '2025-06-01' }], { prices: { BTC: 12000 } });
  ok('crypto is not a candidate', r.legs.length === 0 && r.status === 'nothing', r.legs);

  // Fractional holding: fractions allowed; whole holdings use whole units.
  r = run([T({ type: 'buy', symbol: 'DDD', quantity: 2.5, price: 100, date: '2024-01-10' }),
    { type: 'interest', category: 'cash', symbol: 'Bank', amount: 500, currency: 'EUR', date: '2025-03-01' }], { prices: { DDD: 500 } });
  ok('fractional holding: 1.25 units for the 500 left', approx(leg(r, 'DDD').quantity, 1.25) && approx(r.allowanceUsed, 500), r.legs);
  r = run([T({ type: 'buy', symbol: 'EEE', quantity: 10, price: 100, date: '2024-01-10' }),
    { type: 'interest', category: 'cash', symbol: 'Bank', amount: 870, currency: 'EUR', date: '2025-03-01' }], { prices: { EEE: 150 } });
  ok('whole units: 130 left at 50 a unit gives 2 units (100)', approx(leg(r, 'EEE').quantity, 2) && approx(r.allowanceUsed, 100), r.legs);

  // Carried share loss: the report nets it first, so the plan sells more:
  // all 1,000 of gains, 300 against the carry, 700 against the allowance.
  r = run(base, { prices }, { lossCarryState: { version: 1, opening: { 2025: { shares: 300 } } } });
  ok('a carried share loss: everything sold, 700 of the allowance and the 300 carry used, no tax',
    approx(leg(r, 'AAA').quantity, 10) && approx(leg(r, 'BBB').quantity, 10) && approx(r.allowanceUsed, 700, 0.01) && approx(r.taxDelta, 0) && approx(r.carryUsed.shares, 300), r);

  // Fees larger than the saving.
  r = run([T({ type: 'buy', symbol: 'FFF', quantity: 1, price: 100, date: '2024-01-10' })], { prices: { FFF: 120 }, fee: { fixed: 10, pct: 0 } });
  ok('fees eat the saving: flagged', r.feesExceed === true && r.netBenefit < 0, r);

  // USD share: converted with the exchange rate.
  r = run([T({ type: 'buy', symbol: 'USX', quantity: 10, price: 100, currency: 'USD', date: '2024-01-10' })], { prices: { USX: 150 } }, { exchangeRate: 0.9 });
  ok('USD share: gain 10 x 50 x 0.9 = 450', approx(leg(r, 'USX').gain, 450, 0.01) && approx(r.allowanceUsed, 450, 0.01), r.legs);

  // Fund types from storage when none are passed (as the report does), and an
  // extension that overshoots is cut back by bisection, not dropped.
  _store.maermin_fund_types = JSON.stringify({ 'VWCE.DE': 'aktienfonds' });
  const mix = [
    T({ type: 'buy', symbol: 'SAP.DE', quantity: 10, price: 150, date: '2023-09-12' }),
    T({ type: 'buy', symbol: 'VWCE.DE', quantity: 25, price: 95, date: '2023-02-06' }),
    T({ type: 'buy', symbol: 'VWCE.DE', quantity: 15, price: 104, date: '2024-01-08' })
  ];
  const noTypes = opts(); delete noTypes.fundTypes; delete noTypes.isFund;
  r = H.plan(mix, { date: '2025-12-10', prices: { 'SAP.DE': 230, 'VWCE.DE': 120 }, fee: { fixed: 1, pct: 0 } }, noTypes, { build: REPORT.build });
  // SAP.DE all (799), then 11 VWCE.DE: 11 x 25 - 1 = 274 x 0.7 = 191.80.
  ok('stored fund type: VWCE.DE at 30 % Teilfreistellung, 11 units (191.80)', leg(r, 'VWCE.DE').tfRate === 0.3 && approx(leg(r, 'VWCE.DE').quantity, 11) && approx(leg(r, 'VWCE.DE').taxable, 191.8), r.legs);
  ok('the allowance is filled to 990.80 with no extra tax', approx(r.allowanceUsed, 990.8, 1e-6) && approx(r.taxDelta, 0), r.allowanceUsed);
  delete _store.maermin_fund_types;

  // No price: skipped.
  r = run(base, { prices: { AAA: 160 } });
  ok('a holding without a price is skipped', r.legs.length === 1 && r.legs[0].symbol === 'AAA' && r.skipped.indexOf('BBB') >= 0, r);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
