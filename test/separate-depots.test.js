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

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
