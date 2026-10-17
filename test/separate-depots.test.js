// FINDINGS M-15: FIFO per depot (§ 20 Abs. 4 S. 7 EStG). A portfolio marked
// "separate depot" keeps its own share/fund FIFO pool in the German tax
// report; every other portfolio stays in the common pool as before (opt-in,
// default off: nothing changes for anyone who does nothing).
// Run: node test/separate-depots.test.js
'use strict';
const L = require('../ledger.js');
const GT = require('../tax-calculation-engine.js').GermanTax;
const REPORT = require('../tax-report-builder.js');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + JSON.stringify(detail) : '')); }
}
const approx = (a, b) => Math.abs(a - b) < 0.005;
const s = (o) => Object.assign({ category: 'stocks', symbol: 'SAP', currency: 'EUR', fees: 0 }, o);
// The FINDINGS example: 10 SAP in depot A (2020, 100 €), 10 in depot B (2024,
// 200 €), sell 10 in depot B in 2025 at 190 €. Per depot: −10 a share
// (−100 €); pooled the sale took A's 2020 lot: +90 a share (+900 €).
const txs = [
  s({ id: 'a1', type: 'buy', quantity: 10, price: 100, date: '2020-03-02', portfolioId: 'A' }),
  s({ id: 'b1', type: 'buy', quantity: 10, price: 200, date: '2024-03-01', portfolioId: 'B' }),
  s({ id: 'b2', type: 'sell', quantity: 10, price: 190, date: '2025-05-02', portfolioId: 'B' })
];

console.log('ledger:');
const pooled = L.build(txs, { exchangeRate: 1 });
ok('pooled by default: one SAP group, the sale takes the 2020 lot (+900)', pooled.list.length === 1 && approx(pooled.list[0].realizedGain, 900), pooled.list.map((g) => g.realizedGain));
const sep = L.build(txs, { exchangeRate: 1, depots: ['B'] });
const gB = sep.list.find((g) => g.depot === 'B'), gRest = sep.list.find((g) => g.depot == null);
ok('B separate: B has its own group and the sale takes B\'s lot (−100)', !!gB && approx(gB.realizedGain, -100) && gB.disposals[0].acquisitionDate === '2024-03-01', gB);
ok('A stays in the common pool with its open lot', !!gRest && approx(gRest.openQty, 10) && gRest.disposals.length === 0, gRest);
const both = L.build(txs, { exchangeRate: 1, depots: ['A', 'B'] });
ok('A and B separate: same result for the sale', approx(both.list.find((g) => g.depot === 'B').realizedGain, -100) && both.list.length === 2);
const rowsWithout = L.build(txs.map((t) => Object.assign({}, t, { portfolioId: undefined })), { exchangeRate: 1, depots: ['default'] });
ok('rows without a portfolio belong to "default"', rowsWithout.list.length === 1 && rowsWithout.list[0].depot === 'default');
const btc = [
  { id: 'c1', category: 'crypto', symbol: 'BTC', type: 'buy', quantity: 1, price: 10000, date: '2020-01-01', portfolioId: 'A', currency: 'EUR' },
  { id: 'c2', category: 'crypto', symbol: 'BTC', type: 'sell', quantity: 1, price: 20000, date: '2025-01-01', portfolioId: 'B', currency: 'EUR' }
];
ok('crypto is not split by depots (its own per-wallet setting decides)', L.build(btc, { exchangeRate: 1, depots: ['A', 'B'] }).list.length === 1);
ok('perWallet crypto and depots for shares work together', L.build(txs.concat(btc), { exchangeRate: 1, depots: ['B'], perWallet: ['crypto'] }).list.length === 4);
ok('depotsOf(portfolios) lists the marked ids', JSON.stringify(L.depotsOf([{ id: 'default' }, { id: 'A', separateDepot: false }, { id: 'B', separateDepot: true }, null])) === '["B"]');

console.log('tax report:');
const opts = (extra) => Object.assign({ jurisdiction: 'de', year: 2025, baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT, dividendEvents: [],
  taxSettings: { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true },
  sparerpauschbetrag: 1000, taxOverrides: {}, vapRecords: {}, fundTypes: {}, lossCarryState: { version: 1, opening: {} }, isFund: () => false,
  portfolios: [] }, extra || {});
let r = REPORT.build(txs, opts());
ok('default (no portfolio marked): unchanged, +900 realised', approx(r.summary.netRealized, 900), r.summary.netRealized);
r = REPORT.build(txs, opts({ portfolios: [{ id: 'A' }, { id: 'B', separateDepot: true }] }));
ok('B marked as separate depot: −100 realised (a share loss)', approx(r.summary.netRealized, -100), r.summary.netRealized);
ok('the report names the separate depots', Array.isArray(r.meta.separateDepots) && r.meta.separateDepots.join() === 'B', r.meta);
r = REPORT.build(txs, opts({ separateDepots: ['B'] }));
ok('separateDepots option works the same', approx(r.summary.netRealized, -100));
r = REPORT.build(txs, opts({ jurisdiction: 'us', portfolios: [{ id: 'B', separateDepot: true }] }));
ok('outside Germany the depot rule does not apply (pooled)', approx(r.summary.netRealized, 900), r.summary.netRealized);
const label = REPORT.depotLabel(['B'], [{ id: 'B', name: 'Broker B' }]);
ok('a label for the report names the depot by its portfolio name', /Broker B/.test(label), label);

console.log('planning views (O-1):');
// The planning views read the same depots as the report (German rules only).
const SIM = require('../sell-simulator.js');
const H = require('../harvest-plan.js');
const CM = require('../cost-methods.js');
const marked = [{ id: 'A' }, { id: 'B', separateDepot: true }];
const buys = txs.slice(0, 2);
const sale = { category: 'stocks', symbol: 'SAP', quantity: 10, price: 190, currency: 'EUR', date: '2025-05-02', portfolioId: 'B' };
let sim = SIM.simulate(buys, sale, opts(), { build: REPORT.build });
ok('sell simulator, nothing marked: the sale takes the 2020 lot (+900)', approx(sim.gain, 900), sim.gain);
sim = SIM.simulate(buys, sale, opts({ portfolios: marked }), { build: REPORT.build });
ok('sell simulator, B marked: the sale in B takes B\'s lot (−100)', approx(sim.gain, -100) && sim.lots.length === 1 && sim.lots[0].acquisitionDate === '2024-03-01', sim.lots || sim);
ok('sell simulator, B marked: no extra tax (a share loss, as in the report)', approx(sim.taxDelta, 0), sim.taxDelta);
sim = SIM.simulate(buys, Object.assign({}, sale, { portfolioId: 'A' }), opts({ portfolios: marked }), { build: REPORT.build });
ok('sell simulator, B marked: a sale in A takes A\'s own lot (+900)', approx(sim.gain, 900), sim.gain);
sim = SIM.simulate(buys, Object.assign({}, sale, { quantity: 15 }), opts({ portfolios: marked }), { build: REPORT.build });
ok('sell simulator, B marked: B holds only its own 10', sim.error === 'oversold' && approx(sim.held, 10), sim);
const hl = SIM.holdings(buys, null, { depots: ['B'] });
ok('sell simulator holdings: B listed on its own, A in the common pool', hl.length === 2 && hl.some((x) => x.portfolioId === 'B' && approx(x.quantity, 10)) && hl.some((x) => x.portfolioId == null && approx(x.quantity, 10)), hl);
ok('sell simulator holdings: pooled without depots', SIM.holdings(buys).length === 1);

const hv = (extra) => H.plan(txs, { date: '2025-12-10', prices: { SAP: 190 }, fee: { fixed: 0, pct: 0 } }, opts(extra), { build: REPORT.build });
let p = hv();
ok('harvest plan, nothing marked: the sale used the 2020 lot (+900), the open lot is at a loss, nothing to harvest', p.status === 'nothing' && approx(p.allowanceLeft, 100), p);
p = hv({ portfolios: marked });
ok('harvest plan, B marked: the sale was a loss (−100), the whole allowance is left', approx(p.allowanceLeft, 1000), p.allowanceLeft);
ok('harvest plan, B marked: A\'s 2020 lot is open at a gain (+900) and is harvested', p.status === 'ok' && p.legs.length === 1 && p.legs[0].portfolioId === 'A' && p.legs[0].lots[0].acquisitionDate === '2020-03-02' && approx(p.legs[0].gain, 900), p.legs);
ok('harvest plan, B marked: checked through the report, the −100 is netted first, no tax', approx(p.allowanceUsed, 800) && approx(p.taxDelta, 0), [p.allowanceUsed, p.taxDelta]);
p = hv({ jurisdiction: 'us', portfolios: marked });
ok('harvest plan: German rules whatever jurisdiction the opts carry (B still separate)', approx(p.allowanceLeft, 1000), p.allowanceLeft);

let cm = CM.compare(txs, { year: 2025, prices: { SAP: 190 }, exchangeRate: 1 });
ok('cost methods, nothing marked: FIFO realised +900 in 2025', approx(cm.rows[0].byMethod.fifo.realized, 900), cm.rows[0].byMethod.fifo);
cm = CM.compare(txs, { year: 2025, prices: { SAP: 190 }, exchangeRate: 1, depots: ['B'] });
ok('cost methods, B separate: FIFO realised −100, open +900, one SAP row', cm.rows.length === 1 && approx(cm.rows[0].byMethod.fifo.realized, -100) && approx(cm.rows[0].byMethod.fifo.unrealized, 900), cm.rows);
ok('cost methods, B separate: the depots are reported', JSON.stringify(cm.depots) === '["B"]', cm.depots);

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
