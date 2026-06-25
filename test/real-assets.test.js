// Node harness for Real Assets (WI-1). Pure, no browser.
// Run: node test/real-assets.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

const RA = require('../real-assets.js');

(function run() {
  console.log('real-assets:');

  // ---- normalize drops junk, sorts valuations, defaults safely ----
  let st = RA.normalize({ assets: [
    { name: 'Flat', kind: 'real_estate', currency: 'eur',
      valuations: [{ date: '2024-01-01', value: 300000 }, { date: '2026-01-01', value: 360000 }, { date: '2025-01-01', value: 330000 }],
      acquisitionCost: 300000, acquisitionFees: 30000 },
    { kind: 'real_estate' },                 // no name -> dropped
    { name: 'Junk', valuations: 'nope', cashflows: 5, currency: 'GBP', kind: 'spaceship' } // coerced
  ]});
  ok('normalize keeps only named assets', st.assets.length === 2);
  ok('unknown kind -> other', st.assets[1].kind === 'other');
  ok('unknown currency -> EUR', st.assets[1].currency === 'EUR');
  ok('valuations sorted ascending', st.assets[0].valuations[0].date === '2024-01-01' && st.assets[0].valuations[2].date === '2026-01-01');
  ok('broken arrays default to []', Array.isArray(st.assets[1].valuations) && st.assets[1].valuations.length === 0);
  ok('each asset gets an id', st.assets.every(a => !!a.id));

  // ---- currentValue = latest valuation ----
  const flat = st.assets[0];
  ok('currentValue is latest valuation', RA.currentValue(flat) === 360000);

  // ---- netValue with linked financing ----
  const accounts = [{ id: 'loan1', name: 'Mortgage', type: 'loan', value: 200000, currency: 'EUR' }];
  const financed = RA.normalize({ assets: [Object.assign({}, flat, { financingAccountId: 'loan1' })] }).assets[0];
  ok('netValue subtracts linked loan', RA.netValue(financed, accounts) === 160000);
  ok('netValue without financing = current value', RA.netValue(flat, accounts) === 360000);
  ok('missing financing account = no debt', RA.netValue(RA.normalize({ assets: [Object.assign({}, flat, { financingAccountId: 'ghost' })] }).assets[0], accounts) === 360000);

  // ---- netYield: rent 1200/mo, running cost 250/mo, value 360000 ----
  const rented = RA.normalize({ assets: [Object.assign({}, flat, { cashflows: [
    { date: '2025-01-01', type: 'rental_income', amount: 1200, recurring: true, intervalMonths: 1 },
    { date: '2025-01-01', type: 'running_cost', amount: 250, recurring: true, intervalMonths: 1 }
  ] })] }).assets[0];
  // annual = (1200-250)*12 = 11400; / 360000 = 0.031666...
  ok('netYield annualises recurring cashflows', near(RA.netYield(rented), (1200 - 250) * 12 / 360000));
  ok('annualIncome', near(RA.annualIncome(rented), 14400));
  ok('annualCost', near(RA.annualCost(rented), 3000));

  // quarterly recurring annualises by interval
  const q = RA.normalize({ assets: [Object.assign({}, flat, { cashflows: [
    { date: '2025-01-01', type: 'rental_income', amount: 3000, recurring: true, intervalMonths: 3 }
  ] })] }).assets[0];
  ok('quarterly recurring -> *4 per year', near(RA.annualIncome(q), 12000));

  // ---- totalReturn: cost 330000, current 360000 + cumulative cashflows ----
  const oneoff = RA.normalize({ assets: [Object.assign({}, flat, { cashflows: [
    { date: '2025-06-01', type: 'renovation', amount: 20000, recurring: false }
  ] })] }).assets[0];
  // end = 360000 + (-20000) = 340000; cost = 330000; abs = 10000
  const tr = RA.totalReturn(oneoff);
  ok('totalReturn endValue includes cumulative cashflow', tr.endValue === 340000);
  ok('totalReturn absolute vs total cost', tr.absolute === 10000);
  ok('totalReturn percent', near(tr.percent, 10000 / 330000 * 100));

  // ---- valueSeries ----
  const vs = RA.valueSeries(flat);
  ok('valueSeries ascending with EUR values', vs.length === 3 && vs[0].value === 300000 && vs[2].value === 360000);

  // ---- EUR conversion on a USD asset ----
  const usd = RA.normalize({ assets: [{ name: 'Watch', kind: 'watch', currency: 'USD',
    valuations: [{ date: '2026-01-01', value: 10000 }], acquisitionCost: 8000 }] }).assets[0];
  ok('USD currentValue converts at rate', near(RA.currentValue(usd, 0.9), 9000));
  const usdRent = RA.normalize({ assets: [Object.assign({}, usd, { cashflows: [
    { date: '2026-01-01', type: 'rental_income', amount: 100, recurring: true, intervalMonths: 1 }
  ] })] }).assets[0];
  ok('USD income converts at rate', near(RA.annualIncome(usdRent, 0.9), 100 * 12 * 0.9));

  // ---- aggregate ----
  const agg = RA.aggregate(RA.normalize({ assets: [financed, rented] }), accounts);
  ok('aggregate counts assets', agg.count === 2);
  ok('aggregate grossValue', agg.grossValue === 720000);
  ok('aggregate financingDebt', agg.financingDebt === 200000);
  ok('aggregate netValue = gross - debt', agg.netValue === 520000);

  // ---- CRUD ----
  let s2 = RA.addAsset({ version: 1, assets: [] }, { name: 'Car', kind: 'vehicle', valuations: [{ date: '2026-01-01', value: 25000 }] });
  ok('addAsset adds', s2.assets.length === 1);
  const cid = s2.assets[0].id;
  s2 = RA.updateAsset(s2, cid, { name: 'Car X' });
  ok('updateAsset patches', s2.assets[0].name === 'Car X');
  s2 = RA.removeAsset(s2, cid);
  ok('removeAsset deletes', s2.assets.length === 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
