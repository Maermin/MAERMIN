// Node harness for the alternative asset templates (P5-3.11): art, P2P loans,
// life insurance, vehicles, startups and collectibles on top of real assets.
// Run: node test/real-asset-templates.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -- ' + JSON.stringify(info) : '')); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 0.005 : eps); }

const RA = require('../real-assets.js');

(function run() {
  console.log('real-asset-templates:');
  const ids = RA.TEMPLATES.map((t) => t.id);
  ok('six templates', ids.join() === 'art,p2p_loan,life_insurance,vehicle,startup,collectible', ids);
  ok('each template names its kind and fields', RA.TEMPLATES.every((t) => RA.KINDS[t.kind] && Array.isArray(t.fields) && t.fields.length >= 2));
  ok('new kinds exist and the old ones stay', ['art', 'p2p_loan', 'life_insurance', 'startup', 'vehicle', 'collectible', 'real_estate', 'watch', 'other'].every((k) => !!RA.KINDS[k]));

  // ---- art: appraisal + insurance cost
  const art = RA.fromTemplate('art', { name: 'Painting', appraisal: '12.500', appraisalDate: '2026-05-01', purchasePrice: '9000', purchaseDate: '2021-03-10', insuranceYear: '180' }, '2026-10-13');
  ok('art: value = the appraisal on its date', art.kind === 'art' && art.valuations.length === 2 && art.valuations[1].date === '2026-05-01' && art.valuations[1].value === 12500, art.valuations);
  ok('art: purchase price is the cost and the first valuation', art.acquisitionCost === 9000 && art.valuations[0].date === '2021-03-10' && art.valuations[0].value === 9000);
  ok('art: insurance is a yearly running cost', art.cashflows.length === 1 && art.cashflows[0].type === 'running_cost' && art.cashflows[0].amount === 180 && art.cashflows[0].intervalMonths === 12);
  ok('art: details kept', art.details.appraisalDate === '2026-05-01');

  // ---- P2P loan: principal, rate, term
  const p2p = RA.fromTemplate('p2p_loan', { name: 'Loans', platform: 'Platform X', principal: '5000', ratePct: '7,5', startDate: '2026-01-01', termMonths: '36' }, '2026-10-13');
  ok('p2p: valued at the principal', p2p.kind === 'p2p_loan' && RA.currentValue(p2p, 1) === 5000 && p2p.acquisitionCost === 5000);
  ok('p2p: monthly interest income', p2p.cashflows.length === 1 && p2p.cashflows[0].type === 'interest_income' && near(p2p.cashflows[0].amount, 31.25) && p2p.cashflows[0].intervalMonths === 1, p2p.cashflows);
  ok('p2p: yearly income 375 and a 7.5 % yield', near(RA.annualIncome(p2p, 1), 375) && near(RA.netYield(p2p, 1), 0.075, 1e-9));
  ok('p2p: maturity from the term', p2p.details.maturity === '2029-01-01' && p2p.details.platform === 'Platform X', p2p.details);

  // ---- life insurance: surrender value, premium
  const li = RA.fromTemplate('life_insurance', { name: 'Policy', surrenderValue: '18400', valueDate: '2026-09-30', premiumMonthly: '150', maturity: '2041-12-01', guaranteedPct: '0,9' }, '2026-10-13');
  ok('life insurance: value = surrender value', li.kind === 'life_insurance' && RA.currentValue(li, 1) === 18400);
  ok('life insurance: premium is a monthly cost (contribution)', li.cashflows[0].type === 'premium' && li.cashflows[0].amount === 150);
  ok('life insurance: premiums count as cost, not as a loss of yield on income', RA.annualCost(li, 1) === 1800 && RA.annualIncome(li, 1) === 0);
  ok('life insurance: guaranteed rate kept as a number', li.details.guaranteedPct === 0.9 && li.details.maturity === '2041-12-01');

  // ---- vehicle: depreciation
  const car = RA.fromTemplate('vehicle', { name: 'Car', purchasePrice: '30000', purchaseDate: '2024-10-13', depreciationPct: '15' }, '2026-10-13');
  ok('vehicle: depreciates 15 % a year from the purchase', near(RA.currentValue(car, 1, '2026-10-13'), 30000 * 0.85 * 0.85, 1), RA.currentValue(car, 1, '2026-10-13'));
  ok('vehicle: on the purchase day the value is the price', RA.currentValue(car, 1, '2024-10-13') === 30000);
  const carValued = Object.assign({}, car, { valuations: car.valuations.concat([{ date: '2026-01-01', value: 25000 }]) });
  ok('vehicle: a newer manual valuation is the new base', near(RA.currentValue(carValued, 1, '2026-01-01'), 25000) && RA.currentValue(carValued, 1, '2027-01-01') < 25000);
  ok('without depreciation the latest valuation stays (unchanged behaviour)', RA.currentValue(art, 1, '2030-01-01') === 12500);

  // ---- startup: shares x round price
  const st = RA.fromTemplate('startup', { name: 'Seed Co', shares: '2000', invested: '10000', investDate: '2023-06-01', roundPrice: '8,50', roundDate: '2025-11-20' }, '2026-10-13');
  ok('startup: value = shares x last round price', st.kind === 'startup' && RA.currentValue(st, 1) === 17000 && st.acquisitionCost === 10000);
  ok('startup: first valuation is the investment', st.valuations[0].date === '2023-06-01' && st.valuations[0].value === 10000);
  ok('startup: details', st.details.shares === 2000 && st.details.roundPrice === 8.5);

  // ---- collectible
  const col = RA.fromTemplate('collectible', { name: 'Coins', estimate: '3200', estimateDate: '2026-08-01', purchasePrice: '2500', purchaseDate: '2019-01-01' }, '2026-10-13');
  ok('collectible: value = the estimate', col.kind === 'collectible' && RA.currentValue(col, 1) === 3200 && col.acquisitionCost === 2500);

  // ---- validation and storage
  ok('a template without a name or value is refused', RA.fromTemplate('art', { name: '', appraisal: '1' }, '2026-10-13') === null && RA.fromTemplate('startup', { name: 'X' }, '2026-10-13') === null);
  ok('an unknown template is refused', RA.fromTemplate('yacht', { name: 'Y' }, '2026-10-13') === null);
  const state = RA.addAsset(RA.addAsset({ assets: [] }, p2p), car);
  const round = RA.normalize(JSON.parse(JSON.stringify(state)));
  ok('details and the new cash-flow types survive normalize', round.assets[0].details.platform === 'Platform X' && round.assets[0].cashflows[0].type === 'interest_income' && round.assets[1].details.depreciationPct === 0.15);
  ok('details only keep the template\'s own fields', Object.keys(RA.normalize({ assets: [Object.assign({}, p2p, { details: Object.assign({ evil: 'x' }, p2p.details) })] }).assets[0].details).indexOf('evil') === -1);
  ok('an old asset without details is unchanged', RA.normalize({ assets: [{ name: 'Flat', kind: 'real_estate', valuations: [{ date: '2020-01-01', value: 1 }] }] }).assets[0].details === undefined);
  ok('aggregate counts the templates', near(RA.aggregate(state, [], 1).annualIncome, 375));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
