// Employee equity: forecasts (PLAN-EQUITY Package 4) - seeded Monte Carlo
// (deterministic), CAGR / flat prices, income projection, the ESPP forecast
// with caps, what-if inputs and the FX band. Estimates only: nothing stored.
// Run: node test/equity-forecast.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);
const FC = require('../equity-forecast.js');
const E = require('../equity-model.js');
const DAY = 86400000;
const dn = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
const iso = (n) => new Date(n * DAY).toISOString().slice(0, 10);

console.log('PRNG and Monte Carlo:');
const a = FC.mulberry32(7), b = FC.mulberry32(7), c = FC.mulberry32(8);
const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
ok('same seed, same sequence; another seed, another one', JSON.stringify(seqA) === JSON.stringify(seqB) && c() !== seqA[0] && seqA.every((x) => x >= 0 && x < 1));
// three years of a wobbly daily series
const today = '2026-10-26', t0 = dn(today);
const series = { cur: 'USD', d: [], p: [] };
let px = 100, rng = FC.mulberry32(1);
for (let n = t0 - 3 * 365; n <= t0; n++) { const wd = new Date(n * DAY).getUTCDay(); if (wd === 0 || wd === 6) continue; px *= Math.exp((rng() - 0.5) * 0.04 + 0.0003); series.d.push(n); series.p.push(Math.round(px * 100) / 100); }
const dates = [iso(t0 + 182), iso(t0 + 365), iso(t0 + 730)];
const m1 = FC.monteCarlo(series, dates, { today, seed: 42, paths: 400 });
const m2 = FC.monteCarlo(series, dates, { today, seed: 42, paths: 400 });
const m3 = FC.monteCarlo(series, dates, { today, seed: 43, paths: 400 });
ok('deterministic with a fixed seed (same P10/P50/P90 to the last digit)', JSON.stringify(m1) === JSON.stringify(m2));
ok('another seed gives other paths', JSON.stringify(m1.p50) !== JSON.stringify(m3.p50));
ok('P10 < P50 < P90 at every date, and the band widens with time', m1.p10.every((x, i) => x < m1.p50[i] && m1.p50[i] < m1.p90[i]) && (m1.p90[2] - m1.p10[2]) > (m1.p90[0] - m1.p10[0]));
const short = { cur: 'USD', d: series.d.slice(-200), p: series.p.slice(-200) };
ok('less than 2 years of history: no Monte Carlo (CAGR scenarios only)', FC.monteCarlo(short, dates, { today, seed: 1 }) === null);

console.log('price scenarios:');
ok('flat stays at today\'s price', FC.priceAt(100, today, iso(t0 + 730), { type: 'flat' }) === 100);
ok('CAGR +10 % for one year', near(FC.priceAt(100, today, iso(t0 + 365), { type: 'cagr', rate: 10 }), 110, 0.01));
ok('CAGR -20 % for two years', near(FC.priceAt(100, today, iso(t0 + 730), { type: 'cagr', rate: -20 }), 64, 0.05));

console.log('income projection:');
const inc = E.normalizeIncome({ entries: [
  { id: 'b', from: '2025-01-01', kind: 'base', period: 'year', amount: 60000, currency: 'EUR' },
  { id: 'bo', from: '2026-03-31', kind: 'bonus', period: 'once', amount: 6000, currency: 'EUR' }
] }).entries;
const pr = FC.projectIncome(inc, today, '2028-12-31', { raisePct: 3 });
const base27 = pr.find((e) => e.id === 'b-f2027'), bonus27 = pr.find((e) => e.id === 'bo-r1');
ok('the base salary continues with a yearly raise from 1 January', !!base27 && near(base27.amount, 61800) && base27.from === '2027-01-01');
ok('last year\'s bonus month repeats (with the raise)', !!bonus27 && bonus27.from === '2027-03-31' && near(bonus27.amount, 6180));
ok('no repeat when switched off', !FC.projectIncome(inc, today, '2028-12-31', { repeatOneOffs: false }).some((e) => e.id === 'bo-r1'));

console.log('ESPP forecast:');
const PLAN = { id: 'p', ticker: 'ACME', shareCurrency: 'USD', portfolioId: 'pf', taxCountry: 'DE', salaryCurrency: 'EUR' };
const grant = { id: 'g', planId: 'p', type: 'ESPP', grantDate: '2026-01-01', contribution: { anchor: '2026-01-01', periodMonths: 6, discountPct: 15, lookback: true,
  pctHistory: [{ from: '2026-01-01', pct: 10 }], eligible: 'base_bonus', caps: { periodAmount: 3500, excess: 'carry' }, leftover: 'carry' } };
const st = E.normalize({ plans: [PLAN], grants: [grant] });
const fxCtx = { series: (cur) => (cur === 'USD' ? [{ d: '2023-01-02', r: 0.9 }, { d: today, r: 0.9 }] : []), maxGapDays: 4000 };
const opts = { today, income: inc, closes: () => series, fxCtx, base: 'EUR', horizon: '1y', seed: 42, paths: 300 };
const f = FC.espp(st, st.grants[0], opts);
const flat = f.scenarios.find((s) => s.name === 'flat');
ok('the open offering and the next one up to one year: two purchases', flat.rows.length === 2 && flat.rows[0].date === '2026-12-31' && flat.rows[1].date === '2027-06-30', flat.rows.map((r) => r.date));
ok('flat price: 15 % below the lower of start and end price', near(flat.rows[1].price, Math.min(flat.rows[1].fmvStart, flat.rows[1].fmvEnd) * 0.85));
ok('scenarios: flat, CAGR -20 / +10 / +20, P10 / P50 / P90', f.scenarios.map((s) => s.name).join() === 'flat,cagr-20,cagr10,cagr20,p10,p50,p90');
const v = (n) => f.scenarios.find((s) => s.name === n).value;
ok('the value of all ESPP shares grows with the price path', v('cagr-20') < v('flat') && v('flat') < v('cagr20') && v('p10') < v('p50') && v('p50') < v('p90'));
ok('the same seed gives the same forecast', JSON.stringify(FC.espp(st, st.grants[0], opts).scenarios) === JSON.stringify(f.scenarios));
ok('cap overflow shows in the forecast (bonus repeated)', flat.warnings > 0);
const more = FC.espp(st, st.grants[0], Object.assign({}, opts, { pct: 15 }));
ok('what-if: a higher % buys more shares from the next offering', more.scenarios[0].units >= flat.units && more.scenarios[0].rows[0].units === flat.rows[0].units);
const cheaper = FC.espp(st, st.grants[0], Object.assign({}, opts, { priceShiftPct: -30 }));
ok('what-if: a 30 % lower price buys more shares', cheaper.scenarios[0].units > flat.units);
const band = FC.espp(st, st.grants[0], Object.assign({}, opts, { fxBandPct: 10 }));
ok('the FX band is its own pair of runs', !!band.fx && band.fx.low.name === 'fxLow' && band.fx.high.name === 'fxHigh' && band.fx.low.value !== band.fx.high.value);
ok('nothing is written to the store', JSON.stringify(st) === JSON.stringify(E.normalize({ plans: [PLAN], grants: [grant] })));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
