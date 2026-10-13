// Node harness for the further corporate actions (P5-3.10): symbol change,
// ISIN change, merger (share exchange, optional cash) and spin-off, applied
// in date order together with splits, to lots and the tax FIFO.
// Run: node test/corporate-events.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -- ' + JSON.stringify(info) : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

let _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const CA = require('../corporate-actions.js');
const L = require('../ledger.js');
const M = require('../metrics.js');
const GT = require('../tax-calculation-engine.js').GermanTax;
const TS = require('../tax-settings.js');
const TR = require('../tax-report-builder.js');

const tx = (id, type, symbol, date, qty, price, extra) => Object.assign({ id, type, category: 'stocks', symbol, quantity: qty, price, fees: 0, currency: 'EUR', date, portfolioId: 'p1' }, extra || {});
const NONE = { version: 1, actions: [] };
const sumQty = (rows, sym) => rows.filter((r) => r.symbol === sym).reduce((s, r) => s + (r.type === 'buy' ? 1 : r.type === 'sell' ? -1 : 0) * r.quantity, 0);
const cost = (rows, sym) => rows.filter((r) => r.symbol === sym && r.type === 'buy').reduce((s, r) => s + r.quantity * r.price + (r.fees || 0), 0);

(function run() {
  console.log('corporate-events:');

  // ---- normalize -------------------------------------------------------------
  const ev = CA.normalizeEvents({ events: [
    { kind: 'symbol_change', symbol: 'FB', newSymbol: 'META', date: '2022-06-09' },
    { kind: 'merger', symbol: 'OLD', newSymbol: 'NEW', date: '2025-01-10', num: 3, den: 2, cashPerShare: '1,50' },
    { kind: 'spinoff', symbol: 'SIE.DE', newSymbol: 'ENR.DE', date: '2020-09-28', num: 1, den: 2, costSharePct: '9,3' },
    { kind: 'split', symbol: 'X', date: '2025-01-01', num: 2, den: 1 },
    { kind: 'merger', symbol: 'A', newSymbol: 'A', date: '2025-01-01', num: 1, den: 1 },
    { kind: 'spinoff', symbol: 'B', newSymbol: 'C', date: '2025-01-01', num: 1, den: 1, costSharePct: 120 },
    { kind: 'isin_change', symbol: 'DE000A1', date: 'bad', newSymbol: 'DE000A2' }
  ] });
  ok('normalize keeps the kinds in date order and drops splits, self-renames, cost shares outside 0-100 % and bad dates',
    ev.events.map((e) => e.kind).join() === 'spinoff,symbol_change,merger', ev.events.map((e) => e.kind + ' ' + e.symbol));
  ok('normalize parses a German decimal cash amount', ev.events.find((e) => e.kind === 'merger').cashPerShare === 1.5);
  ok('normalize stores a cost share given in % as a fraction', near(ev.events.find((e) => e.kind === 'spinoff').costShare, 0.093));

  const base = [tx('b1', 'buy', 'FB', '2021-03-01', 10, 250), tx('d1', 'dividend', 'FB', '2021-12-01', 10, 0.5), tx('b2', 'buy', 'META', '2023-01-05', 5, 130)];

  // ---- identity ---------------------------------------------------------------
  ok('no splits and no events: the same array comes back', CA.adjust(base, NONE, { events: [] }) === base);

  // ---- symbol / ISIN change -------------------------------------------------------
  const ren = CA.adjust(base, NONE, { events: [{ kind: 'symbol_change', category: 'stocks', symbol: 'FB', newSymbol: 'META', newName: 'Meta Platforms', date: '2022-06-09' }] });
  ok('a symbol change moves every earlier row to the new symbol', ren.every((r) => r.symbol === 'META') && ren[0].symbolName === 'Meta Platforms' && ren[0].caOrigSymbol === 'FB');
  ok('quantity, price and date stay', ren[0].quantity === 10 && ren[0].price === 250 && ren[0].date === '2021-03-01');
  ok('the input is not mutated', base[0].symbol === 'FB');
  const pos = M.buildPositions(ren, { exchangeRate: 1 });
  ok('one position of 15 META with the full cost', pos.stocks.length === 1 && pos.stocks[0].amount === 15 && near(pos.stocks[0].purchasePrice * 15, 2500 + 650));
  const isin = CA.adjust([tx('i1', 'buy', 'DE000A1', '2024-01-01', 1, 100), tx('i2', 'buy', 'DE000A1', '2025-02-01', 1, 120)], NONE,
    { events: [{ kind: 'isin_change', symbol: 'DE000A1', newSymbol: 'DE000A2', date: '2025-01-15' }] });
  ok('an ISIN change only moves rows before its date', isin[0].symbol === 'DE000A2' && isin[1].symbol === 'DE000A1');

  // ---- merger ---------------------------------------------------------------------
  // 100 OLD at 20 (cost 2000) -> 3:2 -> 150 NEW, cost 2000; 1.50 cash per old share
  const mrows = [tx('m1', 'buy', 'OLD', '2023-05-02', 60, 20, { fees: 6 }), tx('m2', 'buy', 'OLD', '2024-02-02', 40, 20), tx('m3', 'sell', 'OLD', '2024-06-01', 0, 0)].filter((r) => r.quantity > 0);
  const MERGER = { kind: 'merger', category: 'stocks', symbol: 'OLD', newSymbol: 'NEW', newName: 'NewCo', date: '2025-01-10', num: 3, den: 2, cashPerShare: 1.5 };
  const mer = CA.adjust(mrows, NONE, { events: [MERGER] });
  ok('merger: old shares x ratio become new shares', near(sumQty(mer, 'NEW'), 150) && sumQty(mer, 'OLD') === 0);
  ok('merger: the cost and the acquisition dates carry over (sec. 20 (4a) S.1)', near(cost(mer, 'NEW'), 2006) && mer.find((r) => r.id === 'm1').date === '2023-05-02');
  const cash = mer.filter((r) => r.source === 'corporate-action');
  ok('merger: the cash component is capital income on the date for the old shares held', cash.length === 1 && cash[0].type === 'dividend' && cash[0].symbol === 'NEW'
    && near(cash[0].quantity * cash[0].price, 150) && cash[0].date === '2025-01-10' && cash[0].portfolioId === 'p1', cash);
  const sold = CA.adjust(mrows.concat([tx('m4', 'sell', 'NEW', '2025-03-01', 150, 15)]), NONE, { events: [MERGER] });
  const rep = TR.build(sold, { year: 2025, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT, taxSettingsModule: TS,
    fundTypes: {}, vapRecords: {}, dividendEvents: [], taxOverrides: {}, sparerpauschbetrag: 0 });
  ok('merger: selling the new shares realises against the old cost (2250 - 2006)', near(rep.summary.realizedGains, 244, 1e-6), rep.summary);
  ok('merger: the sale lots keep the old acquisition dates', rep.realizedGains.some((d) => d.acquisitionDate === '2023-05-02'));
  ok('merger: the cash is in the dividend income', near(rep.summary.dividendIncome, 150), rep.summary.dividendIncome);
  const two = CA.adjust(mrows.concat([tx('q1', 'buy', 'OLD', '2024-01-01', 10, 20, { portfolioId: 'p2' })]), NONE, { events: [MERGER] });
  ok('merger: the cash is booked per portfolio', two.filter((r) => r.source === 'corporate-action').map((r) => r.portfolioId + ':' + r.quantity * r.price).sort().join() === 'p1:150,p2:15');
  ok('merger: re-running adjust books the cash only once (marker by event id)',
    CA.adjust(mer, NONE, { events: [MERGER] }).filter((r) => r.source === 'corporate-action').length === 1);

  // ---- spin-off -------------------------------------------------------------------
  // Parent: buy 30 @100 (fees 3), buy 20 @110, sell 10 before the spin-off (FIFO from lot 1).
  // 1 child per 2 parent shares, 10 % of the cost moves to the child.
  const srows = [tx('p1', 'buy', 'SIE.DE', '2019-01-10', 30, 100, { fees: 3 }), tx('p2', 'buy', 'SIE.DE', '2019-06-10', 20, 110), tx('p3', 'sell', 'SIE.DE', '2020-01-15', 10, 105)];
  const SPIN = { kind: 'spinoff', category: 'stocks', symbol: 'SIE.DE', newSymbol: 'ENR.DE', newName: 'Siemens Energy', date: '2020-09-28', num: 1, den: 2, costShare: 0.1 };
  const sp = CA.adjust(srows, NONE, { events: [SPIN] });
  ok('spin-off: child shares = open parent shares x ratio', near(sumQty(sp, 'ENR.DE'), 20) && near(sumQty(sp, 'SIE.DE'), 40));
  const childLots = sp.filter((r) => r.symbol === 'ENR.DE');
  ok('spin-off: one child lot per open parent lot, with the parent lot\'s date', childLots.map((r) => r.date + ' ' + r.quantity).join() === '2019-01-10 10,2019-06-10 10', childLots.map((r) => r.date + ' ' + r.quantity));
  // open cost before: lot1 20 of 30 -> 2000 + 2 fees; lot2 2200. 10 % moves.
  ok('spin-off: the child takes the cost share of the open lots', near(cost(sp, 'ENR.DE'), 0.1 * (2002 + 2200)), cost(sp, 'ENR.DE'));
  const before = L.build(srows, { exchangeRate: 1, applyCorporateActions: false });
  const after = L.build(sp, { exchangeRate: 1, applyCorporateActions: false });
  const realised = (Lb) => Lb.list.reduce((s, g) => s + g.disposals.reduce((a, d) => a + d.gain, 0), 0);
  ok('spin-off: the sale before the spin-off keeps its gain', near(realised(before), realised(after)), [realised(before), realised(after)]);
  const openCost = (Lb, sym) => Lb.list.filter((g) => g.symbol === sym).reduce((s, g) => s + g.openCostEUR, 0);
  ok('spin-off: parent + child open cost = the parent open cost before', near(openCost(after, 'SIE.DE') + openCost(after, 'ENR.DE'), openCost(before, 'SIE.DE')),
    [openCost(after, 'SIE.DE'), openCost(after, 'ENR.DE'), openCost(before, 'SIE.DE')]);
  ok('spin-off: a partly sold buy row is split in two', sp.filter((r) => r.symbol === 'SIE.DE' && r.type === 'buy').length === 3);
  ok('spin-off: adjusting an adjusted list again adds nothing', CA.adjust(sp, NONE, { events: [SPIN] }).length === sp.length);

  // ---- order with splits --------------------------------------------------------------
  // FB -> META rename in 2022, then a 2:1 split of META in 2024: the renamed lot splits too.
  const order = CA.adjust([tx('o1', 'buy', 'FB', '2021-03-01', 10, 250)],
    { version: 1, actions: [{ kind: 'split', category: 'stocks', symbol: 'META', date: '2024-01-02', num: 2, den: 1 }] },
    { events: [{ kind: 'symbol_change', category: 'stocks', symbol: 'FB', newSymbol: 'META', date: '2022-06-09' }] });
  ok('events and splits apply in date order (rename, then split on the new symbol)', order[0].symbol === 'META' && order[0].quantity === 20 && order[0].price === 125, order[0]);
  const splitsOnly = CA.adjust([tx('s1', 'buy', 'X', '2024-01-01', 10, 50)], { version: 1, actions: [{ kind: 'split', category: 'stocks', symbol: 'X', date: '2024-06-01', num: 2, den: 1 }] }, { events: [] });
  ok('splits alone behave as before', splitsOnly[0].quantity === 20 && splitsOnly[0].price === 25);

  // ---- storage -------------------------------------------------------------------------
  CA.recordEvent({ kind: 'symbol_change', category: 'stocks', symbol: 'FB', newSymbol: 'META', date: '2022-06-09' });
  ok('recordEvent persists under maermin_corporate_events', CA.loadEvents().events.length === 1 && !!_store.maermin_corporate_events && CA.EVENTS_KEY === 'maermin_corporate_events');
  ok('the split store is untouched', !_store.maermin_corporate_actions);
  ok('adjust reads the stored events by default', CA.adjust([tx('z', 'buy', 'FB', '2021-01-01', 1, 1)], NONE)[0].symbol === 'META');
  CA.removeEvent(CA.loadEvents().events[0].id);
  ok('removeEvent', CA.loadEvents().events.length === 0);
  ok('eventsFor lists by old or new symbol', CA.eventsFor('stocks', 'NEW', { events: [MERGER] }).length === 1 && CA.eventsFor('stocks', 'OLD', { events: [MERGER] }).length === 1);
  const S = require('../storage.js');
  const BK = require('../backup-engine.js');
  ok('encrypted at rest and in the backup', S.SENSITIVE_KEYS.indexOf('maermin_corporate_events') !== -1 && BK.KEYS.indexOf('maermin_corporate_events') !== -1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
