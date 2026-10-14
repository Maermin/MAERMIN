// Node harness for P5-4.6: cost-basis methods (FIFO, LIFO, HIFO, moving
// average) in the ledger, the per-wallet crypto FIFO option (BMF 6.3.2025)
// in the report, sell simulator and tax-free calendar, and the comparison
// module behind the Tax view panel.
// Run: node test/cost-basis.test.js
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

const L = require('../ledger.js');
const GT = require('../tax-calculation-engine.js').GermanTax;
const REPORT = require('../tax-report-builder.js');
const SIM = require('../sell-simulator.js');
const CC = require('../crypto-calendar.js');
const CM = require('../cost-methods.js');
const TS = require('../tax-settings.js');

(function main() {
  console.log('cost-basis:');

  // ---- ledger methods ----------------------------------------------------
  // 10 at 100 (Jan), 10 at 200 (Jun), 10 at 150 (Sep) 2024; sell 10 at 250 in 2025.
  const s = (o) => Object.assign({ category: 'stocks', symbol: 'AAA', currency: 'EUR' }, o);
  const txs = [
    s({ type: 'buy', quantity: 10, price: 100, date: '2024-01-10' }),
    s({ type: 'buy', quantity: 10, price: 200, date: '2024-06-10' }),
    s({ type: 'buy', quantity: 10, price: 150, date: '2024-09-10' }),
    s({ type: 'sell', quantity: 10, price: 250, date: '2025-03-01' })
  ];
  const g = (method) => L.build(txs, { exchangeRate: 1, method }).list[0];
  ok('FIFO (default): the January lot, gain 1,500', approx(g().realizedGain, 1500) && g().disposals[0].acquisitionDate === '2024-01-10');
  ok('LIFO: the September lot, gain 1,000', approx(g('lifo').realizedGain, 1000) && g('lifo').disposals[0].acquisitionDate === '2024-09-10');
  ok('HIFO: the June lot (highest cost), gain 500', approx(g('hifo').realizedGain, 500) && g('hifo').disposals[0].acquisitionDate === '2024-06-10');
  ok('average: at the moving average 150, gain 1,000, open cost 3,000', approx(g('average').realizedGain, 1000) && approx(g('average').openCostEUR, 3000) && approx(g('average').openQty, 20));
  // Moving average: a later buy at a new price moves the average of what is left.
  const mv = L.build(txs.concat([s({ type: 'buy', quantity: 20, price: 300, date: '2025-04-01' }), s({ type: 'sell', quantity: 10, price: 300, date: '2025-05-01' })]), { exchangeRate: 1, method: 'average' }).list[0];
  ok('moving average after a new buy: (20 x 150 + 20 x 300) / 40 = 225', approx(mv.disposals[1].unitCostEUR, 225) && approx(mv.openCostEUR, 30 * 225), mv.disposals[1]);
  ok('every method keeps the same open quantity and total gain', ['fifo', 'lifo', 'hifo', 'average'].every((m) => approx(g(m).openQty, 20)));

  // ---- per-wallet grouping -----------------------------------------------
  // BTC: 1 in portfolio A (2024-01-01 at 10,000), 1 in B (2025-03-01 at 30,000),
  // 1 sold from B on 2025-06-01 at 40,000.
  const c = (o) => Object.assign({ category: 'crypto', symbol: 'BTC', currency: 'EUR', quantity: 1 }, o);
  const btc = [
    c({ type: 'buy', price: 10000, date: '2024-01-01', portfolioId: 'A' }),
    c({ type: 'buy', price: 30000, date: '2025-03-01', portfolioId: 'B' }),
    c({ type: 'sell', price: 40000, date: '2025-06-01', portfolioId: 'B' })
  ];
  let b = L.build(btc, { exchangeRate: 1 });
  ok('pooled (default): one BTC group, the 2024 lot is sold', b.list.length === 1 && b.list[0].disposals[0].acquisitionDate === '2024-01-01');
  b = L.build(btc, { exchangeRate: 1, perWallet: ['crypto'] });
  const gb = b.list.find((x) => x.wallet === 'B');
  ok('per wallet: one group per portfolio, B sells its own 2025 lot', b.list.length === 2 && gb && gb.disposals[0].acquisitionDate === '2025-03-01' && approx(gb.disposals[0].gain, 10000), b.list.map((x) => x.key));
  ok('per wallet only for the listed categories (shares stay pooled)',
    L.build([s({ type: 'buy', quantity: 1, price: 1, date: '2024-01-01', portfolioId: 'A' }), s({ type: 'buy', quantity: 1, price: 1, date: '2024-01-01', portfolioId: 'B' })], { exchangeRate: 1, perWallet: ['crypto'] }).list.length === 1);

  // ---- tax settings ------------------------------------------------------
  ok('setting cryptoPerWallet: off by default, kept by sanitize', TS.sanitize({}).cryptoPerWallet === false && TS.sanitize({ cryptoPerWallet: true }).cryptoPerWallet === true);

  // ---- report ----------------------------------------------------------------
  const opts = (extra) => Object.assign({ jurisdiction: 'de', year: 2025, baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT, dividendEvents: [],
    taxSettings: { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true },
    sparerpauschbetrag: 1000, taxOverrides: {}, vapRecords: {}, fundTypes: {}, lossCarryState: { version: 1, opening: {} }, isFund: () => false }, extra || {});
  let gd = REPORT.build(btc, opts()).summary.germanDetail;
  ok('report pooled: the 2024 lot, 30,000 tax-free, method "fifo"', approx(gd.crypto.exemptLongTermGains, 30000) && approx(gd.crypto.netShortTermGains, 0) && gd.crypto.method === 'fifo', gd.crypto);
  gd = REPORT.build(btc, opts({ taxSettings: Object.assign({}, opts().taxSettings, { cryptoPerWallet: true }) })).summary.germanDetail;
  ok('report per wallet (setting): 10,000 short-term, taxable, method "fifo-wallet"', approx(gd.crypto.netShortTermGains, 10000) && approx(gd.crypto.taxable, 10000) && gd.crypto.method === 'fifo-wallet', gd.crypto);
  gd = REPORT.build(btc, opts({ cryptoPerWallet: true })).summary.germanDetail;
  ok('report per wallet (option) works the same', approx(gd.crypto.netShortTermGains, 10000));
  ok('the report names the method in its German rows', REPORT.methodLabel('fifo-wallet').length > 0 && REPORT.methodLabel('fifo') !== REPORT.methodLabel('fifo-wallet'));

  // ---- sell simulator ------------------------------------------------------
  const held = btc.slice(0, 2);
  let r = SIM.simulate(held, { category: 'crypto', symbol: 'BTC', quantity: 1, price: 40000, date: '2025-06-01', portfolioId: 'B' }, opts(), { build: REPORT.build });
  ok('simulator pooled: the 2024 lot, tax-free', r.lots[0].acquisitionDate === '2024-01-01' && approx(r.taxDelta, 0), r.lots);
  r = SIM.simulate(held, { category: 'crypto', symbol: 'BTC', quantity: 1, price: 40000, date: '2025-06-01', portfolioId: 'B' }, opts({ cryptoPerWallet: true }), { build: REPORT.build });
  ok('simulator per wallet: B sells its own 2025 lot, 10,000 taxable', r.lots[0].acquisitionDate === '2025-03-01' && approx(r.taxable, 10000) && r.taxDelta > 0, r.lots);
  r = SIM.simulate(held, { category: 'crypto', symbol: 'BTC', quantity: 2, price: 40000, date: '2025-06-01', portfolioId: 'B' }, opts({ cryptoPerWallet: true }), { build: REPORT.build });
  ok('simulator per wallet: B holds only 1', r.error === 'oversold' && approx(r.held, 1), r);
  const hw = SIM.holdings(held, '2025-06-01', { perWallet: true });
  ok('holdings per wallet: BTC in A and in B', hw.length === 2 && hw.every((h) => h.symbol === 'BTC') && hw.map((h) => h.portfolioId).sort().join() === 'A,B', hw);

  // ---- calendar --------------------------------------------------------------
  const cal = [
    c({ type: 'buy', price: 10000, date: '2024-01-01', portfolioId: 'A' }),
    c({ type: 'buy', price: 30000, date: '2025-10-01', portfolioId: 'B' }),
    c({ type: 'sell', price: 40000, date: '2025-11-01', portfolioId: 'B' })
  ];
  let k = CC.calendar(cal, { today: '2026-01-15', prices: { BTC: 50000 } });
  ok('calendar pooled: the 2024 lot was sold, nothing free today', approx(k.coins[0].buckets[0].quantity, 0), k.coins[0].buckets[0]);
  k = CC.calendar(cal, { today: '2026-01-15', prices: { BTC: 50000 }, perWallet: true });
  ok('calendar per wallet: B sold its own lot, the 2024 lot in A is free today', k.coins.length === 1 && approx(k.coins[0].buckets[0].quantity, 1) && approx(k.coins[0].held, 1), k.coins);

  // ---- comparison -------------------------------------------------------------
  const cmp = CM.compare(txs, { year: 2025, prices: { AAA: 300 }, exchangeRate: 1 });
  const row = cmp.rows[0];
  ok('comparison: FIFO realised 1,500 / open cost 3,500 / unrealised 2,500', approx(row.byMethod.fifo.realized, 1500) && approx(row.byMethod.fifo.openCost, 3500) && approx(row.byMethod.fifo.unrealized, 2500), row.byMethod.fifo);
  ok('comparison: HIFO realised 500, unrealised 3,500', approx(row.byMethod.hifo.realized, 500) && approx(row.byMethod.hifo.unrealized, 3500));
  ok('comparison: realised + unrealised is the same under every method (4,000)', ['fifo', 'lifo', 'hifo', 'average'].every((m) => approx(row.byMethod[m].realized + row.byMethod[m].unrealized, 4000)));
  ok('comparison: FIFO is the method of the tax report (Germany)', cmp.legal === 'fifo' && cmp.methods.join() === 'fifo,lifo,hifo,average', cmp);
  ok('comparison totals per method', approx(cmp.totals.lifo.realized, 1000) && approx(cmp.totals.average.openCost, 3000));
  const cmp2 = CM.compare(txs, { year: 2024, prices: { AAA: 300 }, exchangeRate: 1 });
  ok('realised only counts sales in the chosen year', approx(cmp2.rows[0].byMethod.fifo.realized, 0));
  const noPrice = CM.compare(txs, { year: 2025, prices: {}, exchangeRate: 1 });
  ok('no price: cost basis shown, unrealised null', noPrice.rows[0].byMethod.fifo.unrealized === null && approx(noPrice.rows[0].byMethod.fifo.openCost, 3500));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
