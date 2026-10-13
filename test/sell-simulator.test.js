// Node harness for P5-4.2, the sell simulator: "if I sell X today" through
// the real tax report (FIFO lots, Teilfreistellung, allowance, sec. 23
// Freigrenze, loss carry-forward) and the best date for a tax-free crypto sale.
// Run: node test/sell-simulator.test.js
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
const REPORT = require('../tax-report-builder.js');
const SIM = require('../sell-simulator.js');

const opts = (extra) => Object.assign({ jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT, dividendEvents: [],
  taxSettings: { abgeltungRate: 0.25, soli: false, kirchensteuer: 0, freistellungsauftrag: 0, cryptoExemption: true },
  sparerpauschbetrag: 0, taxOverrides: {}, vapRecords: {}, fundTypes: {}, lossCarryState: { version: 1, opening: {} }, isFund: () => false }, extra || {});
const run = (txs, plan, extra) => SIM.simulate(txs, plan, opts(extra), { build: REPORT.build });

(function run_() {
  console.log('sell-simulator:');
  const stock = [
    { type: 'buy', category: 'stocks', symbol: 'AAA', quantity: 10, price: 100, currency: 'EUR', date: '2024-01-10' },
    { type: 'buy', category: 'stocks', symbol: 'AAA', quantity: 10, price: 150, currency: 'EUR', date: '2025-01-10' }
  ];
  let r = run(stock, { category: 'stocks', symbol: 'AAA', quantity: 15, price: 200, date: '2025-06-01' }, { sparerpauschbetrag: 1000 });
  ok('FIFO: the oldest lot first (10 from 2024, then 5 from 2025)', r.lots.length === 2 && r.lots[0].acquisitionDate === '2024-01-10' && approx(r.lots[0].quantity, 10) && r.lots[1].acquisitionDate === '2025-01-10' && approx(r.lots[1].quantity, 5), r.lots);
  ok('gains per lot 1000 and 250, total 1250', approx(r.lots[0].gain, 1000) && approx(r.lots[1].gain, 250) && approx(r.gain, 1250) && approx(r.proceeds, 3000));
  ok('capital income: the allowance takes 1000, tax on 250 (25 % + Soli)', r.kind === 'capital' && approx(r.allowanceUsed, 1000) && approx(r.taxDelta, 250 * 0.25 * 1.055), r.taxDelta);
  ok('the extra tax equals the report with the sale minus without', approx(r.taxDelta, r.after.totalTax - r.before.totalTax));

  const fund = [{ type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 10, price: 100, currency: 'EUR', date: '2024-01-10' }];
  r = run(fund, { category: 'stocks', symbol: 'WORLD', quantity: 10, price: 200, date: '2025-06-01' }, { fundTypes: { WORLD: 'aktienfonds' }, isFund: (s) => s === 'WORLD' });
  ok('equity fund: 30 % Teilfreistellung (300 tax-free, 700 taxable)', approx(r.taxFree, 300) && approx(r.taxable, 700) && approx(r.taxDelta, 700 * 0.25 * 1.055), r.taxDelta);

  const withInterest = stock.concat([{ type: 'interest', category: 'cash', symbol: 'Bank', amount: 400, currency: 'EUR', date: '2025-03-01' }]);
  r = run(withInterest, { category: 'stocks', symbol: 'AAA', quantity: 10, price: 200, date: '2025-06-01' }, { sparerpauschbetrag: 1000 });
  ok('allowance: 400 already used, the sale uses the other 600', approx(r.allowanceUsed, 600) && approx(r.allowanceLeftBefore, 600) && approx(r.taxDelta, 400 * 0.25 * 1.055), r.taxDelta);

  const crypto = [
    { type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 1000, currency: 'EUR', date: '2025-01-05' },
    { type: 'sell', category: 'crypto', symbol: 'ETH', quantity: 1, price: 1700, currency: 'EUR', date: '2025-02-05' },
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 10000, currency: 'EUR', date: '2024-01-01' },
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 10000, currency: 'EUR', date: '2025-03-10' }
  ];
  r = run(crypto, { category: 'crypto', symbol: 'BTC', quantity: 1, price: 10400, date: '2025-06-01' });
  ok('the first BTC lot (2024) is already tax-free', r.kind === 'private' && r.lots[0].taxFree === true && approx(r.taxFree, 400) && approx(r.taxDelta, 0), r);
  r = run(crypto, { category: 'crypto', symbol: 'BTC', quantity: 2, price: 10200, date: '2025-06-01' });
  ok('a short-term lot: 200 taxable pushes the year to 900 (still under the Freigrenze)', approx(r.taxable, 200) && !r.freigrenze.crosses && approx(r.taxDelta, 0), r.freigrenze);
  r = run(crypto, { category: 'crypto', symbol: 'BTC', quantity: 2, price: 10400, date: '2025-06-01' });
  ok('crossing the Freigrenze: 700 + 400 = 1100, all of it taxable (275)', r.freigrenze.crosses === true && approx(r.freigrenze.after, 1100) && approx(r.taxDelta, 275), r.freigrenze);
  ok('best date: the day after the 2025 lot turns one year old', r.bestDate === '2026-03-11' && r.lots[1].taxFreeOn === '2026-03-11', r.bestDate);
  r = run(crypto, { category: 'crypto', symbol: 'BTC', quantity: 1, price: 10400, date: '2025-06-01' });
  ok('no best date when the sale is already tax-free', r.bestDate === null);

  r = run(stock, { category: 'stocks', symbol: 'AAA', quantity: 15, price: 200, date: '2025-06-01' }, { lossCarryState: { version: 1, opening: { 2025: { shares: 1000 } } } });
  ok('a carried share loss reduces the extra tax (250 * 25 % + Soli)', approx(r.carryUsed.shares, 1000) && approx(r.taxDelta, 250 * 0.25 * 1.055), r.carryUsed);

  r = run(stock, { category: 'stocks', symbol: 'AAA', quantity: 25, price: 200, date: '2025-06-01' });
  ok('more than held is refused', r.error === 'oversold' && approx(r.held, 20), r);
  r = run(stock, { category: 'stocks', symbol: 'ZZZ', quantity: 1, price: 200, date: '2025-06-01' });
  ok('an unknown holding is refused', r.error === 'notHeld');
  r = run(stock, { category: 'stocks', symbol: 'AAA', quantity: 0, price: 200, date: '2025-06-01' });
  ok('a zero quantity is refused', r.error === 'invalid');

  ok('freeDate: day after the anniversary, 29 Feb -> 1 Mar', SIM.freeDate('2024-02-29') === '2025-03-01' && SIM.freeDate('2025-03-10') === '2026-03-11');
  const h = SIM.holdings(stock.concat(crypto));
  ok('holdings lists open positions with quantity', h.some((x) => x.symbol === 'AAA' && approx(x.quantity, 20)) && h.some((x) => x.symbol === 'BTC' && approx(x.quantity, 2)) && !h.some((x) => x.symbol === 'ETH'), h);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
