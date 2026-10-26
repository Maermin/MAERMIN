// Employee equity: RSU vesting (PLAN-EQUITY Package 2) - cliff, presets,
// uneven custom tranches, rounding, withholding, auto vest events from the
// close and FX history, projected future tranches, dividend equivalents.
// Run: node test/equity-vesting.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);
const V = require('../equity-vesting.js');
const E = require('../equity-model.js');
const L = require('../ledger.js');
const sum = (a) => a.reduce((x, y) => x + y, 0);
const DAY = 86400000;
const dn = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);

console.log('schedules:');
const q = V.steps({ preset: '4y_cliff_quarterly' }, '2023-03-01');
ok('4y / 1y cliff quarterly: 25 % at the cliff, then 12 × 6.25 %', q.length === 13 && q[0].date === '2024-03-01' && q[0].pct === 25 && q[1].date === '2024-06-01' && near(q[12].pct, 6.25) && q[12].date === '2027-03-01' && near(V.pctSum(q), 100));
const m = V.steps({ preset: '4y_cliff_monthly' }, '2023-01-31');
ok('monthly: 37 tranches, month ends clamped (31 Jan -> 29 Feb)', m.length === 37 && m[1].date === '2024-02-29' && m[2].date === '2024-03-31' && near(V.pctSum(m), 100));
const y3 = V.steps({ preset: '3y_yearly' }, '2024-05-15');
ok('3y yearly: three thirds', y3.length === 3 && y3.every((s) => near(s.pct, 100 / 3)) && y3[2].date === '2027-05-15');
const quarters = V.steps({ preset: '25_25_25_25' }, '2024-01-10');
ok('25/25/25/25', quarters.map((s) => s.pct).join() === '25,25,25,25' && quarters[3].date === '2028-01-10');
const noCliff = V.steps({ years: 2, cliffMonths: 0, freqMonths: 6 }, '2025-01-01');
ok('no cliff: first tranche after one period', noCliff.length === 4 && noCliff[0].date === '2025-07-01' && noCliff.every((s) => s.pct === 25));
const odd = V.steps({ years: 1, cliffMonths: 5, freqMonths: 4 }, '2025-01-01');
ok('a period that does not divide: the rest at the end, still 100 %', near(V.pctSum(odd), 100) && odd[odd.length - 1].date === '2026-01-01', odd);
const custom = V.steps({ custom: [{ date: '2026-06-01', pct: 10 }, { date: '2025-06-01', pct: 20 }, { date: '2027-06-01', pct: 70 }] }, '2025-01-01');
ok('custom uneven tranches, sorted by date', custom.map((s) => s.pct).join() === '20,10,70' && custom[0].date === '2025-06-01');
ok('vesting start other than the grant date', V.steps({ preset: '3y_yearly', start: '2024-07-01' }, '2024-05-15')[0].date === '2025-07-01');

console.log('rounding:');
const pm = m.map((s) => s.pct);
const fl = V.allocate(1000, pm, 'floor_trueup');
ok('floor per tranche, true-up on the last one', fl[0] === 250 && fl[1] === 20 && fl[36] === 50 && sum(fl) === 1000, fl.slice(-2));
const cu = V.allocate(1000, pm, 'floor_cumulative');
ok('cumulative floor spreads the remainder', cu[0] === 250 && cu.every((u) => Number.isInteger(u)) && Math.max(...cu.slice(1)) - Math.min(...cu.slice(1)) <= 1 && sum(cu) === 1000);
const rd = V.allocate(7, [1, 1, 1], 'round');
ok('round: 2 + 2 + 3', rd.join() === '2,2,3');
const fr = V.allocate(10, [1, 1, 1], 'none');
ok('fractional units sum exactly', near(sum(fr), 10) && near(fr[0], 10 / 3));
ok('prime total, uneven %', sum(V.allocate(97, [20, 10, 70], 'floor_trueup')) === 97 && V.allocate(97, [20, 10, 70], 'floor_trueup').join() === '19,9,69');

console.log('withholding:');
const stc = { withholding: 'sell_to_cover', withholdingRate: 0.45 };
ok('sell-to-cover: ceil(gross × rate)', V.withheld(25, stc) === 12 && V.withheld(100, stc) === 45);
ok('the actual number from the statement wins', V.withheld(25, stc, 11) === 11 && V.withheld(25, stc, 40) === 25);
ok('payroll withholding and none: no shares withheld', V.withheld(25, { withholding: 'payroll', withholdingRate: 0.45 }) === 0 && V.withheld(25, { withholding: 'none' }) === 0);

console.log('FMV from the close history:');
// Thu 2026-02-26, Fri 2026-02-27, Mon 2026-03-02
const series = { cur: 'USD', d: [dn('2026-02-26'), dn('2026-02-27'), dn('2026-03-02')], p: [400, 410, 420] };
ok('close of the vest day', V.fmvOn(series, '2026-03-02', 'close').fmv === 420 && V.fmvOn(series, '2026-03-02', 'close').sameDay);
const sun = V.fmvOn(series, '2026-03-01', 'close');
ok('a Sunday vest: Friday\'s close, with its date', sun.fmv === 410 && sun.date === '2026-02-27' && !sun.sameDay);
ok('previous close', V.fmvOn(series, '2026-03-02', 'prevClose').fmv === 410);
ok('GBX closes become GBP', V.fmvOn({ cur: 'GBp', d: [dn('2026-03-02')], p: [11234] }, '2026-03-02', 'close').fmv === 112.34);
ok('no close within a week: null', V.fmvOn(series, '2026-04-01', 'close') === null);

console.log('auto vest events:');
const state = E.normalize({
  plans: [{ id: 'p', ticker: 'MSFT', shareCurrency: 'USD', portfolioId: 'pf', taxCountry: 'DE', salaryCurrency: 'CHF' }],
  grants: [{ id: 'g', planId: 'p', type: 'RSU', grantDate: '2025-03-01', units: 100, withholding: 'sell_to_cover', withholdingRate: 0.45,
    schedule: { years: 2, cliffMonths: 12, freqMonths: 6 } }]
});
const closes = () => ({ cur: 'USD', d: [dn('2026-02-27'), dn('2026-09-01')], p: [400, 470] });
const fxCtx = { series: (c) => ({ USD: [{ d: '2026-02-27', r: 0.87 }, { d: '2026-09-01', r: 0.86 }], CHF: [{ d: '2026-02-27', r: 1.07 }, { d: '2026-09-01', r: 1.06 }] }[c] || []) };
const r = V.regenerate(state, { today: '2026-10-26', closes, fxCtx, targets: ['EUR'] });
const ns = E.normalize(r.state);
ok('three tranches: 50 at the cliff, 25, 25', ns.tranches.map((t) => t.units).join() === '50,25,25');
ok('past tranches vested, the future one projected', ns.tranches.map((t) => t.status + (t.projected ? '*' : '')).join() === 'vested,vested,unvested*');
ok('two auto events with FMV and the rates of the day (weekend: Friday, marked)', r.added === 2 && ns.events[0].fmv === 400 && ns.events[0].fmvDate === '2026-02-27'
  && ns.events[0].fx.EUR.source === 'fallback' && near(ns.events[0].fx.EUR.rate, 0.87) && !!ns.events[0].fx.CHF, ns.events[0]);
ok('withheld by the rate, net units drive the lot', ns.events[0].withheldUnits === 23 && ns.events[0].netUnits === 27);
const tx = E.syncLots(ns, []).transactions;
const g = L.build(tx, { perPortfolio: true }).list[0];
ok('lots: basis = FMV × the event rate, in EUR', near(g.openQty, 27 + 25 - 12) && near(g.openLots[0].unitCostEUR, 400 * 0.87), g.openLots[0]);
const again = V.regenerate(ns, { today: '2026-10-26', closes, fxCtx, targets: ['EUR'] });
ok('idempotent: nothing new the second time', again.added === 0 && E.normalize(again.state).events.length === 2);
const manual = E.normalize(Object.assign({}, ns, { events: ns.events.map((e, i) => (i === 0 ? Object.assign({}, e, { source: 'manual', withheldUnits: 20, fx: { EUR: { rate: 0.9, source: 'manual' } } }) : e)) }));
const keep = E.normalize(V.regenerate(manual, { today: '2026-10-26', closes, fxCtx }).state);
ok('a manually corrected event is kept as it is', keep.events[0].withheldUnits === 20 && keep.events[0].fx.EUR.rate === 0.9);
const noPx = V.regenerate(state, { today: '2026-10-26', closes: () => null, fxCtx });
ok('no price history: no event, reported as missing (never a guessed FMV)', noPx.added === 0 && noPx.missing.length === 2 && noPx.missing[0].reason === 'price');
const noFx = V.regenerate(state, { today: '2026-10-26', closes, fxCtx: { series: () => [], usdRates: {} } });
ok('no FX rate: no event, reported', noFx.added === 0 && noFx.missing[0].reason === 'fx');
const forf = E.normalize(Object.assign({}, state, { tranches: [{ id: 'g-t3', grantId: 'g', date: '2027-03-01', units: 25, status: 'forfeited' }] }));
ok('a forfeited tranche stays forfeited', E.normalize(V.regenerate(forf, { today: '2026-10-26', closes, fxCtx }).state).tranches[2].status === 'forfeited');

console.log('dividend equivalents:');
const de = V.dividendEquivalents(ns.tranches, [{ exDate: '2026-05-20', amount: 0.83 }, { exDate: '2026-11-19', amount: 0.91 }], '2026-10-26');
ok('on the units unvested at each ex-date; future ex-dates not yet', de.length === 1 && de[0].units === 50 && near(de[0].amount, 41.5), de);
ok('nothing before the grant date', V.dividendEquivalents(ns.tranches, [{ exDate: '2025-02-20', amount: 0.83 }, { exDate: '2025-05-20', amount: 0.83 }], '2026-10-26', '2025-03-01').length === 1);
const divs = V.dividendsFromTransactions([
  { type: 'dividend', symbol: 'msft', price: 0.83, quantity: 17, currency: 'USD', date: '2026-05-20' },
  { type: 'dividend', symbol: 'MSFT', price: 0.83, quantity: 10, currency: 'USD', date: '2026-05-20', portfolioId: 'other' },
  { type: 'dividend', symbol: 'AAPL', price: 0.26, quantity: 5, currency: 'USD', date: '2026-05-15' },
  { type: 'buy', symbol: 'MSFT', price: 400, quantity: 1, currency: 'USD', date: '2026-05-01' }
], 'MSFT');
ok('per-share dividends of the ticker from the booked dividends, one per date', divs.length === 1 && divs[0].amount === 0.83 && divs[0].exDate === '2026-05-20' && divs[0].currency === 'USD', divs);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
