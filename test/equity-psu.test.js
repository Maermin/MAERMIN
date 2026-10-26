// Employee equity: PSU (PLAN-EQUITY Package 3) - multiplier scenarios before
// settlement, pending state after the performance period, settlement with the
// actual multiplier (at once or with time-based vesting afterwards), lots.
// Run: node test/equity-psu.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-9);
const V = require('../equity-vesting.js');
const E = require('../equity-model.js');
const L = require('../ledger.js');
const DAY = 86400000;
const dn = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);

const PLAN = { id: 'p', ticker: 'MSFT', shareCurrency: 'USD', portfolioId: 'pf', taxCountry: 'DE', salaryCurrency: 'EUR' };
const psu = (extra) => Object.assign({ id: 'g', planId: 'p', type: 'PSU', grantDate: '2024-03-01', units: 120, withholding: 'payroll',
  psu: { perfStart: '2024-01-01', perfEnd: '2026-12-31', settleDate: '2027-03-01', min: 0, target: 100, max: 200 } }, extra || {});
const closes = () => ({ cur: 'USD', d: [dn('2027-03-01'), dn('2027-09-01'), dn('2028-03-01')], p: [500, 520, 540] });
const fxCtx = { series: (c) => (c === 'USD' ? [{ d: '2027-03-01', r: 0.9 }, { d: '2027-09-01', r: 0.91 }, { d: '2028-03-01', r: 0.92 }] : []) };
const run = (g, today) => E.normalize(V.regenerate(E.normalize({ plans: [PLAN], grants: [g] }), { today, closes, fxCtx }).state);

console.log('scenarios before settlement:');
const sc = V.psuScenarios(psu(), 450);
ok('low / target / high = 0 / 120 / 240 units', sc.map((s) => s.key + ':' + s.units).join() === 'low:0,target:120,high:240');
ok('valued at today\'s price', sc[1].value === 120 * 450 && sc[2].value === 240 * 450);
ok('a custom range (50 / 100 / 150 %)', V.psuScenarios(psu({ psu: { perfEnd: '2026-12-31', min: 50, target: 100, max: 150 } }), null).map((s) => s.units).join() === '60,120,180');
ok('max never below target, min never above', (() => { const p = V.psuInfo(psu({ psu: { perfEnd: '2026-12-31', min: 150, target: 100, max: 80 } })); return p.min === 100 && p.max === 100; })());

console.log('pending:');
const before = run(psu(), '2026-10-26');
ok('one projected tranche of the target units at the settlement date', before.tranches.length === 1 && before.tranches[0].units === 120 && before.tranches[0].date === '2027-03-01' && before.tranches[0].projected);
const waiting = run(psu(), '2027-06-01');
ok('after the date but not settled: still unvested, no event (no guessed multiplier)', waiting.tranches[0].status === 'unvested' && waiting.events.length === 0);

console.log('settlement:');
const settled = run(psu({ psu: Object.assign({}, psu().psu, { actual: 120 }) }), '2027-06-01');
ok('actual multiplier 120 %: 144 units vest at the settlement date', settled.tranches.length === 1 && settled.tranches[0].units === 144 && settled.tranches[0].status === 'vested');
ok('a vest event with the FMV and rate of that day', settled.events.length === 1 && settled.events[0].fmv === 500 && near(settled.events[0].fx.EUR.rate, 0.9) && settled.events[0].grossUnits === 144);
const lots = E.syncLots(settled, []).transactions;
ok('the lot: 144 units, basis FMV × rate', lots.length === 1 && lots[0].quantity === 144 && near(L.build(lots, {}).list[0].openCostEUR, 144 * 500 * 0.9));
ok('0 %: nothing vests', run(psu({ psu: Object.assign({}, psu().psu, { actual: 0 }) }), '2027-06-01').tranches[0].units === 0);
ok('fractional result rounded down by default', V.psuSettledUnits(psu({ units: 125, psu: Object.assign({}, psu().psu, { actual: 133 }) })) === 166);
ok('or kept fractional', near(V.psuSettledUnits(psu({ units: 125, rounding: 'none', psu: Object.assign({}, psu().psu, { actual: 133 }) })), 166.25));

console.log('time-based vesting after the period:');
const post = psu({ psu: Object.assign({}, psu().psu, { actual: 150, post: { years: 1, cliffMonths: 0, freqMonths: 6 } }) });
const pv = run(post, '2027-10-01');
ok('180 settled units in two halves after the settlement date', pv.tranches.map((t) => t.date + ':' + t.units + ':' + t.status).join() === '2027-09-01:90:vested,2028-03-01:90:unvested');
ok('only the vested half becomes a lot', pv.events.length === 1 && pv.events[0].fmv === 520);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
