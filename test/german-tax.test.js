// Node harness for the German fund-taxation depth (Feature F): Vorabpauschale,
// Teilfreistellung, the statutory computation order (Teilfreistellung ->
// Verrechnung -> Sparerpauschbetrag -> Abgeltungsteuer/Soli/Kirchensteuer),
// the sale credit for prior Vorabpauschalen, the settings stores, the legacy
// engine's transaction-shape/mutation fixes, and the MaerminTaxReport
// integration (summary.germanDetail).
// Run: node test/german-tax.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

// Minimal localStorage so the settings stores are exercised for real.
const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const ENGINE = require('../tax-calculation-engine.js');
const GT = ENGINE.GermanTax;
const REPORT = require('../tax-report-builder.js');

(function run() {
  console.log('german-tax:');

  // ---- Teilfreistellung -------------------------------------------------------
  ok('equity fund rate is 30%', GT.teilfreistellungRate('aktienfonds') === 0.30);
  ok('mixed 15%, real estate 60%, foreign RE 80%', GT.teilfreistellungRate('mischfonds') === 0.15 && GT.teilfreistellungRate('immobilienfonds') === 0.60 && GT.teilfreistellungRate('auslandsimmobilienfonds') === 0.80);
  ok('unknown type means no exemption', GT.teilfreistellungRate('hedgefonds') === 0);
  const tfGain = GT.applyTeilfreistellung(1000, 'aktienfonds');
  ok('30% of an equity-fund gain is exempt', approx(tfGain.taxable, 700) && approx(tfGain.exempt, 300));
  const tfLoss = GT.applyTeilfreistellung(-1000, 'aktienfonds');
  ok('losses are exempted symmetrically (only 70% deductible)', approx(tfLoss.taxable, -700) && approx(tfLoss.exempt, -300));

  // ---- Basiszins ---------------------------------------------------------------
  ok('table year resolves (2023 = 2.55%)', approx(GT.basiszinsFor(2023), 0.0255));
  ok('2022 is negative (no Vorabpauschale)', GT.basiszinsFor(2022) < 0);
  ok('override beats the table', approx(GT.basiszinsFor(2023, { 2023: 0.03 }), 0.03));
  ok('unknown future year falls back to latest known', approx(GT.basiszinsFor(2099), GT.BASISZINS[2026]));
  ok('2026 Basiszins is the BMF value 3.20%', approx(GT.basiszinsFor(2026), 0.032));

  // ---- month factor ---------------------------------------------------------------
  ok('held all year -> factor 1', GT.monthsFactorForPurchase('2020-05-01', 2024) === 1);
  ok('bought after the year -> factor 0', GT.monthsFactorForPurchase('2025-02-01', 2024) === 0);
  ok('bought in January -> 12/12', approx(GT.monthsFactorForPurchase('2024-01-15', 2024), 1));
  ok('bought in March -> 10/12', approx(GT.monthsFactorForPurchase('2024-03-20', 2024), 10 / 12));
  ok('bought in December -> 1/12', approx(GT.monthsFactorForPurchase('2024-12-01', 2024), 1 / 12));
  ok('garbage date -> factor 1 (no silent zeroing)', GT.monthsFactorForPurchase('whenever', 2024) === 1);

  // ---- Vorabpauschale ----------------------------------------------------------------
  // 10000 at 2.55%: Basisertrag = 10000 x 0.0255 x 0.7 = 178.50
  const vapFull = GT.computeVorabpauschale({ valueStart: 10000, valueEnd: 11000, distributions: 0, basiszins: 0.0255 });
  ok('Basisertrag = start x Basiszins x 0.7', approx(vapFull.basisertrag, 178.5));
  ok('full Vorabpauschale when growth exceeds Basisertrag', approx(vapFull.vorabpauschale, 178.5));
  const vapCapped = GT.computeVorabpauschale({ valueStart: 10000, valueEnd: 10100, distributions: 0, basiszins: 0.0255 });
  ok('capped by the actual value increase', approx(vapCapped.vorabpauschale, 100));
  const vapDist = GT.computeVorabpauschale({ valueStart: 10000, valueEnd: 11000, distributions: 50, basiszins: 0.0255 });
  ok('distributions reduce the Vorabpauschale', approx(vapDist.vorabpauschale, 128.5));
  const vapDistAll = GT.computeVorabpauschale({ valueStart: 10000, valueEnd: 11000, distributions: 500, basiszins: 0.0255 });
  ok('floored at zero when distributions exceed it', vapDistAll.vorabpauschale === 0);
  ok('loss year -> zero', GT.computeVorabpauschale({ valueStart: 10000, valueEnd: 9000, basiszins: 0.0255 }).vorabpauschale === 0);
  ok('negative Basiszins (2022) -> zero across the board', GT.computeVorabpauschale({ valueStart: 10000, valueEnd: 11000, basiszins: -0.0005 }).vorabpauschale === 0);
  const vapPro = GT.computeVorabpauschale({ valueStart: 10000, valueEnd: 11000, basiszins: 0.0255, monthsFactor: 10 / 12 });
  ok('month factor pro-rates the Basisertrag', approx(vapPro.basisertrag, 178.5 * 10 / 12));

  // ---- sale credit (per unit, tax-report-builder.vapCreditForLot) --------------------------
  const records = { WORLD: { 2023: 50, 2024: 30, 2025: 99 } };
  const held = [{ type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 100, price: 50, currency: 'EUR', date: '2022-03-01' }];
  const lot = (q) => ({ symbol: 'WORLD', quantity: q, acquisitionDate: '2022-03-01', disposalDate: '2025-06-01' });
  ok('credit sums only years before the sale', approx(REPORT.vapCreditForLot(held, records, lot(100)), 80));
  ok('credit pro-rates by units sold', approx(REPORT.vapCreditForLot(held, records, lot(50)), 40));
  ok('no records -> zero credit', REPORT.vapCreditForLot(held, {}, lot(100)) === 0);

  // ---- Abgeltungsteuer + Kirchensteuer formula ----------------------------------------------
  const plain = GT.abgeltungsteuer(1000, 0);
  ok('25% flat without church tax', approx(plain.tax, 250) && approx(plain.soli, 13.75) && plain.kirchensteuer === 0);
  // Statutory sec. 32d formula: tax = income / (4 + k). 4080 at 8% -> 1000.
  const kist = GT.abgeltungsteuer(4080, 0.08);
  ok('church tax reduces the base via income/(4+k)', approx(kist.tax, 1000));
  ok('church tax = k x tax, soli on the reduced tax', approx(kist.kirchensteuer, 80) && approx(kist.soli, 55));
  ok('total adds the three parts', approx(kist.total, 1135));

  // ---- full ordered computation -----------------------------------------------------------------
  const detail = GT.computeGermanTaxDetailed({
    disposals: [
      { symbol: 'WORLD', gain: 2000, vapCredit: 100 }, // equity fund, credit first
      { symbol: 'AAPL', gain: 500 },                   // plain stock, no TF
      { symbol: 'WORLD', gain: -1000 }                 // fund loss, symmetric TF
    ],
    dividends: [{ symbol: 'WORLD', gross: 100 }],
    vorabpauschalen: [{ symbol: 'WORLD', amount: 178.5 }],
    interestIncome: 50,
    fundTypes: { WORLD: 'aktienfonds' },
    sparerpauschbetrag: 1000
  });
  // WORLD gain: (2000-100) x 0.7 = 1330; AAPL 500; loss -700; div 70; VAP 124.95; interest 50
  ok('VAP credit reduces the gain before Teilfreistellung', approx(detail.gainsTaxable, 1330 + 500));
  ok('fund losses deduct at 70%', approx(detail.lossesTaxable, -700));
  ok('distributions and Vorabpauschale get Teilfreistellung', approx(detail.dividendsTaxable, 70) && approx(detail.vorabpauschaleTaxable, 124.95));
  ok('exempt total tracks every TF slice', approx(detail.teilfreistellungExempt, 570 - 300 + 30 + 53.55));
  ok('netting happens after Teilfreistellung', approx(detail.nettedIncome, 1330 + 500 - 700 + 70 + 124.95 + 50));
  ok('Sparerpauschbetrag applies last before the rate', approx(detail.taxableIncome, detail.nettedIncome - 1000) && approx(detail.sparerpauschbetragUsed, 1000));
  ok('tax = 25% + Soli on the final base', approx(detail.totalTax, detail.taxableIncome * 0.25 * 1.055));
  // Ordering proof: applying the allowance BEFORE Teilfreistellung would give a
  // different (wrong) result.
  const wrongOrder = (2000 - 100 + 500 - 1000 + 100 + 178.5 + 50 - 1000) * 0.7;
  ok('order matters: TF before allowance differs from allowance-first', !approx(detail.taxableIncome, wrongOrder));
  const empty = GT.computeGermanTaxDetailed({});
  ok('empty input -> zero tax, allowance unused', empty.totalTax === 0 && empty.sparerpauschbetragUsed === 0);

  // ---- settings stores ---------------------------------------------------------------------------
  GT.saveFundType('vwce.de', 'aktienfonds');
  ok('fund type stored under uppercase symbol', GT.loadFundTypes()['VWCE.DE'] === 'aktienfonds');
  GT.saveFundType('VWCE.DE', 'none');
  ok('setting none clears the entry', !('VWCE.DE' in GT.loadFundTypes()));
  GT.saveBasiszinsOverride(2026, 0.024);
  ok('basiszins override persists', approx(GT.loadBasiszinsOverrides()[2026], 0.024));
  GT.saveBasiszinsOverride(2026, 5);
  ok('implausible basiszins is rejected (cleared)', !('2026' in GT.loadBasiszinsOverrides()));
  GT.saveVapRecord('WORLD', 2024, 30.5);
  ok('VAP record persists per symbol and year', approx(GT.loadVapRecords().WORLD['2024'], 30.5));
  GT.saveVapRecord('WORLD', 2024, 0);
  ok('zero clears the VAP record', !GT.loadVapRecords().WORLD);

  // ---- app-shaped transactions through the report (was: legacy engine) ---------------------
  const appTxs = [
    { type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, date: '2024-02-01' },
    { type: 'sell', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 300, date: '2025-03-01' },
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 10000, date: '2023-01-05' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 15000, date: '2025-02-01' }
  ];
  const qtyBefore = appTxs[0].quantity;
  const appRep = REPORT.build(appTxs, { year: 2025, jurisdiction: 'de', exchangeRate: 1, germanTax: GT, dividendEvents: [],
    taxSettings: { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true }, taxOverrides: {}, vapRecords: {}, fundTypes: {} });
  const ag = appRep.summary.germanDetail;
  ok('app-shaped transactions compute real gains', approx(ag.gainsTaxable, 2000));
  ok('crypto > 1y stays exempt', approx(ag.crypto.exemptLongTermGains, 5000) && ag.crypto.netShortTermGains === 0);
  ok('allowance and rate (2000 - 1000 at 25% + Soli)', approx(ag.totalTax, 1000 * 0.25 * 1.055));
  ok('FIFO does not mutate the caller transactions', appTxs[0].quantity === qtyBefore);
  ok('legacy engine is gone (GermanTax only)', Object.keys(ENGINE).join() === 'GermanTax');

  // ---- report integration (summary.germanDetail) ----------------------------------------------------
  const reportTxs = [
    { type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 100, price: 100, currency: 'EUR', date: '2023-01-10' },
    { type: 'sell', category: 'stocks', symbol: 'WORLD', quantity: 50, price: 140, currency: 'EUR', date: '2025-06-01' },
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 10000, currency: 'EUR', date: '2025-01-02' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 11500, currency: 'EUR', date: '2025-06-30' }
  ];
  const report = REPORT.build(reportTxs, {
    year: 2025, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 0.9,
    germanTax: GT,
    fundTypes: { WORLD: 'aktienfonds' },
    vapRecords: { WORLD: { 2023: 50, 2024: 30 } },
    vorabpauschalen: [{ symbol: 'WORLD', amount: 100 }],
    dividendEvents: []
  });
  const g = report.summary.germanDetail;
  ok('report carries the German detail for jurisdiction de', !!g);
  // WORLD: 50 of the 100 units held at the end of 2023 and 2024 are sold, so
  // only half of the recorded 50 + 30 is credited (sec. 19 (1) InvStG, per
  // unit): gain 2000, credit 40, TF 30% -> 1372; VAP 100 -> 70; netted 1442;
  // SPB -> 442; tax 110.50 + soli.
  ok('disposal gain is credited per unit and teilfreigestellt', approx(g.gainsTaxable, (2000 - 40) * 0.7));
  ok('credited Vorabpauschalen are pro-rated to the units sold', approx(g.vapCreditTotal, 40));
  ok('capital tax follows the full order', approx(g.abgeltungsteuer + g.soli, 442 * 0.25 * 1.055));
  // Crypto: net short gain 1500 over the 1000 Freigrenze (2024+) -> all taxable.
  ok('crypto Freigrenze: above it the whole gain is taxable', approx(g.crypto.taxable, 1500) && approx(g.crypto.estimatedTax, 375));
  ok('summary liability uses the detailed total', approx(report.summary.estimatedTaxLiability, g.totalTax));
  // Under the Freigrenze the crypto gain is fully tax-free.
  const small = REPORT.build([
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 10000, currency: 'EUR', date: '2025-01-02' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 10900, currency: 'EUR', date: '2025-06-30' }
  ], { year: 2025, jurisdiction: 'de', exchangeRate: 0.9, germanTax: GT, dividendEvents: [] });
  ok('crypto at or under the Freigrenze is tax-free', small.summary.germanDetail.crypto.taxable === 0 && small.summary.germanDetail.totalTax === 0);
  const usReport = REPORT.build(reportTxs, { year: 2025, jurisdiction: 'us', exchangeRate: 0.9, germanTax: GT, dividendEvents: [] });
  ok('no German detail for other jurisdictions', usReport.summary.germanDetail === null);

  // ---- view prefill helpers (german-tax-view.js, pure layer) ---------------------------------------
  const V = require('../german-tax-view.js');
  const hist = [
    { timestamp: '2024-12-28T10:00:00Z', price: 100 },
    { timestamp: '2025-03-01T10:00:00Z', price: 105 },
    { timestamp: '2025-12-20T10:00:00Z', price: 112 },
    { timestamp: 'garbage', price: 999 },
    { timestamp: '2025-06-01T10:00:00Z', price: 'n/a' }
  ];
  ok('priceAt picks the latest price at or before the date', V.priceAt(hist, '2025-01-01T23:59:59Z') === 100);
  ok('priceAt at year end picks the December print', V.priceAt(hist, '2025-12-31T23:59:59Z') === 112);
  ok('priceAt skips junk rows', V.priceAt(hist, '2025-07-01') === 105);
  ok('priceAt null when uncovered', V.priceAt(hist, '2020-01-01') === null && V.priceAt([], '2025-01-01') === null);

  const viewTxs = [
    { type: 'buy', symbol: 'WORLD', quantity: 100, price: 90, currency: 'EUR', date: '2024-06-01' },
    { type: 'sell', symbol: 'WORLD', quantity: 20, price: 104, currency: 'EUR', date: '2025-04-01' },
    { type: 'dividend', symbol: 'WORLD', quantity: 80, price: 0.5, currency: 'EUR', date: '2025-05-15' },
    { type: 'dividend', symbol: 'WORLD', quantity: 80, price: 0.5, currency: 'EUR', date: '2024-05-15' },
    { type: 'buy', symbol: 'OTHER', quantity: 5, price: 10, currency: 'EUR', date: '2025-01-02' }
  ];
  ok('qtyAt nets buys and sells up to the date', V.qtyAt(viewTxs, 'WORLD', '2025-12-31T23:59:59Z') === 80);
  ok('qtyAt before the sell sees the full lot', V.qtyAt(viewTxs, 'world', '2025-01-01T23:59:59Z') === 100);

  const pre = V.prefillRow(viewTxs, { WORLD: hist }, 'WORLD', 2025, 0.9);
  ok('prefill values = boundary price x shares at year end', approx(pre.valueStart, 100 * 80) && approx(pre.valueEnd, 112 * 80));
  ok('prefill sums only the tax-year distributions', approx(pre.distributions, 40));
  ok('prefill month factor 1 for positions opened earlier', pre.monthsFactor === 1);
  const preNoHist = V.prefillRow(viewTxs, {}, 'WORLD', 2025, 0.9);
  ok('prefill degrades to nulls without history (manual input)', preNoHist.valueStart === null && preNoHist.valueEnd === null);
  const preMidYear = V.prefillRow([
    { type: 'buy', symbol: 'NEWFUND', quantity: 10, price: 50, currency: 'EUR', date: '2025-03-10' }
  ], {}, 'NEWFUND', 2025, 0.9);
  ok('prefill month factor pro-rates an intra-year purchase', approx(preMidYear.monthsFactor, 10 / 12));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
