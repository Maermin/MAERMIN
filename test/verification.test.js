// Final verification pass (2026-10-01): hand-computed reference values for the
// core financial and German tax calculations. Every expected number below is
// worked out in the comment next to it, independent of the implementation.
// Run: node test/verification.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

const L = require('../ledger.js');
const M = require('../metrics.js');
const R = require('../returns-engine.js');
const CA = require('../corporate-actions.js');
const YOC = require('../dividend-yoc.js');
const FXH = require('../fx-history.js');
const TE = require('../tax-calculation-engine.js');
const GT = TE.GermanTax;
const TR = require('../tax-report-builder.js');
const TA = require('../tax-advisor.js');
const GTV = require('../german-tax-view.js');
const MIG = require('../migrations.js');

// ---------------------------------------------------------------------------
console.log('positions / average cost (FIFO, fees in cost basis):');
{
  // buy 10 @ 100 + 10 fee -> 101/unit; buy 10 @ 130; sell 5 -> open: 5 @ 101 + 10 @ 130
  // cost 505 + 1300 = 1805 for 15 units -> avg 120.3333
  const txs = [
    { type: 'buy', category: 'stocks', symbol: 'X', quantity: 10, price: 100, fees: 10, currency: 'EUR', date: '2025-01-02' },
    { type: 'buy', category: 'stocks', symbol: 'X', quantity: 10, price: 130, currency: 'EUR', date: '2025-02-03' },
    { type: 'sell', category: 'stocks', symbol: 'X', quantity: 5, price: 150, fees: 5, currency: 'EUR', date: '2025-03-03' }
  ];
  const pos = M.buildPositions(txs, { exchangeRate: 1 }).stocks[0];
  ok('open quantity 15', near(pos.amount, 15));
  ok('average cost 1805 / 15 incl. buy fee', near(pos.purchasePrice, 1805 / 15, 1e-9));
  const g = L.build(txs, { exchangeRate: 1, applyCorporateActions: false }).groups['stocks|X'];
  // disposal: proceeds 5*150 - 5 = 745, cost 5*101 = 505, gain 240
  ok('FIFO disposal: proceeds 745, cost 505, gain 240', near(g.disposals[0].proceeds, 745) && near(g.disposals[0].costBasis, 505) && near(g.realizedGain, 240));
}

// ---------------------------------------------------------------------------
console.log('FX conversion:');
{
  // USD buy 10 @ 100 + 5 fee at 0.90 EUR/USD -> (1000 + 5) * 0.9 / 10 = 90.45 EUR/unit
  const g = L.build([{ type: 'buy', category: 'stocks', symbol: 'U', quantity: 10, price: 100, fees: 5, currency: 'USD', date: '2025-01-02' }],
    { exchangeRate: 0.5, fxAt: () => 0.9, applyCorporateActions: false }).groups['stocks|U'];
  ok('USD leg priced at the rate of its date (not the static rate)', near(g.openLots[0].unitCostEUR, 90.45));
  // GBp 1234 pence = 12.34 GBP; 1 USD = 0.8 GBP, 1 USD = 0.92 EUR -> 12.34 / 0.8 * 0.92 = 14.191
  ok('GBp pence -> EUR via USD cross rate', near(FXH.quoteToEUR(1234, 'GBp', 0.92, { GBP: 0.8, EUR: 0.92 }), 14.191, 1e-9));
  // CHF 100, 1 USD = 0.88 CHF -> 100 / 0.88 * 0.92 = 104.5454...
  ok('CHF -> EUR via USD cross rate', near(FXH.quoteToEUR(100, 'CHF', 0.92, { CHF: 0.88, EUR: 0.92 }), 100 / 0.88 * 0.92, 1e-9));
  ok('unknown currency without a rate -> null (never mis-scaled)', FXH.quoteToEUR(100, 'JPY', 0.92, {}) === null);
}

// ---------------------------------------------------------------------------
console.log('transaction currencies (ledger + import check):');
{
  const rates = { CHF: 0.88, GBP: 0.8, EUR: 0.92 };
  // CHF buy 10 @ 100 with 1 USD = 0.88 CHF and 1 USD = 0.92 EUR (static rate)
  // -> 1000 / 0.88 * 0.92 = 1045.4545 EUR
  const r = L.build([
    { type: 'buy', category: 'stocks', symbol: 'NESN', quantity: 10, price: 100, currency: 'CHF', date: '2025-01-02' },
    { type: 'buy', category: 'crypto', symbol: 'SOL', quantity: 1, price: 100, currency: 'USDT', date: '2025-01-02' },
    { type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 0.05, currency: 'BTC', date: '2025-01-02' },
    { type: 'sell', category: 'crypto', symbol: 'ADA', quantity: 5, price: 1, currency: 'EUR', date: '2025-01-03' }
  ], { exchangeRate: 0.92, fxAt: () => 0.9, usdRates: rates, applyCorporateActions: false });
  ok('CHF converted with the cross rate (was booked as EUR)', near(r.groups['stocks|NESN'].openCostEUR, 1000 / 0.88 * 0.92, 1e-9));
  ok('USDT priced like USD at the date\'s rate', near(r.groups['crypto|SOL'].openCostEUR, 90));
  const kinds = r.issues.map(i => i.kind + ':' + (i.currency || i.symbol) + ':' + (i.status || i.qty)).sort();
  ok('issues: CHF approx, BTC unknown, ADA oversold by 5', JSON.stringify(kinds) === JSON.stringify(['currency:BTC:unknown', 'currency:CHF:approx', 'oversold:ADA:5']), JSON.stringify(kinds));
  const rep = FXH.currencyReport([{ currency: 'EUR' }, { currency: 'USD' }, { currency: 'CHF' }, { currency: 'CHF' }, { currency: 'BNB' }], 0.92, rates);
  ok('import check lists CHF x2 (approx) and BNB x1 (unknown)', rep.length === 2 && rep.find(x => x.currency === 'CHF').count === 2 && rep.find(x => x.currency === 'BNB').status === 'unknown');
}

// ---------------------------------------------------------------------------
console.log('stock splits:');
{
  // 10 @ 100 before a 4:1 split on 2025-06-01 -> 40 @ 25 (cash amount 1000 unchanged)
  const st = { version: 1, actions: [{ id: 's1', kind: 'split', category: 'stocks', symbol: 'NVDA', date: '2025-06-01', num: 4, den: 1 }] };
  const adj = CA.adjust([
    { type: 'buy', category: 'stocks', symbol: 'NVDA', quantity: 10, price: 100, currency: 'EUR', date: '2025-01-02' },
    { type: 'buy', category: 'stocks', symbol: 'NVDA', quantity: 4, price: 30, currency: 'EUR', date: '2025-06-01' }
  ], st);
  ok('pre-split lot scaled to 40 @ 25', near(adj[0].quantity, 40) && near(adj[0].price, 25));
  ok('lot on the split date is untouched', near(adj[1].quantity, 4) && near(adj[1].price, 30));
  const g = L.build(adj, { exchangeRate: 1, applyCorporateActions: false }).groups['stocks|NVDA'];
  ok('cost basis preserved across the split (1000 + 120)', near(g.openCostEUR, 1120) && near(g.openQty, 44));
}

// ---------------------------------------------------------------------------
console.log('XIRR / TWR:');
{
  // -1000 on 2023-01-01, +1100 on 2024-01-01: 365 days = 365/365.25 years
  // -> r = 1.1^(365.25/365) - 1
  const r = R.xirr([{ date: '2023-01-01', amount: -1000 }, { date: '2024-01-01', amount: 1100 }]);
  ok('XIRR one-year +10%', near(r, Math.pow(1.1, 365.25 / 365) - 1, 1e-6));
  // USD buy 10 @ 100 at 0.90, still worth 900 EUR -> flows -900 / +900 -> 0%
  const flows = R.buildCashflows([{ type: 'buy', category: 'stocks', symbol: 'U', quantity: 10, price: 100, currency: 'USD', date: '2024-01-01' }],
    { rate: 0.5, fxAt: () => 0.9, currentValueEUR: 900, today: '2025-01-01' });
  ok('XIRR flows in EUR at each date\'s FX -> 0%', near(flows[0].amount, -900) && near(R.xirr(flows), 0, 1e-9));
  // dividend 10 gross, 1.5 withholding -> +8.5 inflow; option legs ignored
  const f2 = R.buildCashflows([
    { type: 'dividend', category: 'stocks', symbol: 'U', quantity: 10, price: 1, withholdingTax: 1.5, currency: 'EUR', date: '2024-06-01' },
    { type: 'buy', category: 'options', symbol: 'U C', quantity: 1, price: 5, currency: 'EUR', date: '2024-06-01' }
  ], {});
  ok('dividend net of withholding is an inflow; options excluded', f2.length === 1 && near(f2[0].amount, 8.5));
  // TWR: one asset 100 -> 110 -> 99; a buy on day 2 must not count as return
  // chain: 110/100 * 99/110 - 1 = -0.01 (= the price path)
  const hist = { x: [
    { timestamp: '2025-01-01T12:00:00Z', price: 100 },
    { timestamp: '2025-01-02T12:00:00Z', price: 110 },
    { timestamp: '2025-01-03T12:00:00Z', price: 99 }] };
  const tw = R.twr(hist, { stocks: [{ symbol: 'X', amount: 2 }] }, [
    { type: 'buy', symbol: 'X', quantity: 1, date: '2024-12-31' },
    { type: 'buy', symbol: 'X', quantity: 1, date: '2025-01-02' }]);
  ok('TWR chain-links around a mid-period buy (-1%)', near(tw, -0.01, 1e-12));
  // two assets, 1 unit each: A 100 -> 110, B 100 -> 100 -> 210/200 - 1 = +5%
  const tw2 = R.twr({ a: [{ timestamp: '2025-01-01', price: 100 }, { timestamp: '2025-01-02', price: 110 }],
    b: [{ timestamp: '2025-01-01', price: 100 }, { timestamp: '2025-01-02', price: 100 }] },
  { stocks: [{ symbol: 'A', amount: 1 }, { symbol: 'B', amount: 1 }] });
  ok('TWR two-asset buy-and-hold +5%', near(tw2, 0.05, 1e-12));
}

// ---------------------------------------------------------------------------
console.log('dividends / yield on cost:');
{
  // 10 shares at 50 EUR cost = 500; DPS 2 EUR -> 20 EUR/yr -> YoC 4%
  const y = YOC.yieldOnCost({ lots: [{ type: 'buy', date: '2024-01-02', shares: 10, priceEUR: 50 }], annualDpsEUR: 2 });
  ok('yield on cost 4%', near(y.yocPct, 4) && near(y.annualDividendEUR, 20));
}

// ---------------------------------------------------------------------------
console.log('German capital income tax:');
{
  const S = { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true };
  // stock gain 1500 - SPB 1000 = 500 taxable -> 125 KapESt + 6.875 Soli = 131.875
  const d = GT.computeGermanTaxDetailed({ disposals: [{ symbol: 'X', gain: 1500 }], settings: S });
  ok('Sparerpauschbetrag then 25% + 5.5% Soli', near(d.sparerpauschbetragUsed, 1000) && near(d.abgeltungsteuer, 125) && near(d.totalTax, 131.875));
  // church tax 9%: KapESt = 500 / 4.09 = 122.2494; Soli 5.5% of it; KiSt 9% of it
  const dk = GT.computeGermanTaxDetailed({ disposals: [{ symbol: 'X', gain: 1500 }], settings: Object.assign({}, S, { kirchensteuer: 0.09 }) });
  const kap = 500 / 4.09;
  ok('church tax: KapESt = e / (4 + k), Soli and KiSt on the reduced KapESt',
    near(dk.abgeltungsteuer, kap, 1e-9) && near(dk.soli, kap * 0.055, 1e-9) && near(dk.kirchensteuer, kap * 0.09, 1e-9));
  // Teilfreistellung: equity fund gain 1000 -> 700 taxable; mixed fund 1000 -> 850; loss symmetric
  const tf = GT.computeGermanTaxDetailed({ disposals: [{ symbol: 'EQ', gain: 1000 }, { symbol: 'MX', gain: 1000 }, { symbol: 'LS', gain: -100 }],
    fundTypes: { EQ: 'aktienfonds', MX: 'mischfonds', LS: 'aktienfonds' }, sparerpauschbetrag: 0, settings: S });
  ok('Teilfreistellung 30% / 15%, losses reduced symmetrically', near(tf.gainsTaxable, 1550) && near(tf.lossesTaxable, -70));
  // foreign withholding: 100 gross US dividend, 15 withheld, no allowance left
  // -> 25 - 15 = 10 KapESt, Soli 0.55
  const wt = GT.computeGermanTaxDetailed({ dividends: [{ symbol: 'KO', gross: 100, withholding: 15 }], sparerpauschbetrag: 0, settings: S });
  ok('withholding credit max 15% (25 -> 10 KapESt)', near(wt.abgeltungsteuer, 10) && near(wt.soli, 0.55) && near(wt.withholdingCredit, 15));
  // with church tax 9%: KapESt = (100 - 4*15) / 4.09
  const wk = GT.computeGermanTaxDetailed({ dividends: [{ symbol: 'KO', gross: 100, withholding: 15 }], sparerpauschbetrag: 0, settings: Object.assign({}, S, { kirchensteuer: 0.09 }) });
  ok('withholding credit with church tax: (e - 4q) / (4 + k)', near(wk.abgeltungsteuer, 40 / 4.09, 1e-9) && near(wk.kirchensteuer, 40 / 4.09 * 0.09, 1e-9));
  // withholding above 15% is capped: 30 withheld on 100 -> only 15 creditable
  const wc = GT.computeGermanTaxDetailed({ dividends: [{ symbol: 'NESN', gross: 100, withholding: 35 }], sparerpauschbetrag: 0, settings: S });
  ok('withholding credit capped at 15% of the gross', near(wc.abgeltungsteuer, 10));
  // dividend fully sheltered by the allowance -> nothing to credit, tax 0
  const ws = GT.computeGermanTaxDetailed({ dividends: [{ symbol: 'KO', gross: 100, withholding: 15 }], settings: S });
  ok('no credit when the allowance shelters the dividend', near(ws.totalTax, 0) && near(ws.withholdingCredit, 0));
}

// ---------------------------------------------------------------------------
console.log('Vorabpauschale:');
{
  // 2025: Basiszins 2.53%, start 10000 -> Basisertrag 10000 * 0.0253 * 0.7 = 177.1
  const v = GT.computeVorabpauschale({ valueStart: 10000, valueEnd: 11000, basiszins: GT.basiszinsFor(2025) });
  ok('Basisertrag 177.10 (2025)', near(v.vorabpauschale, 177.1, 1e-9));
  ok('Basiszins 2026 = 3.20%', near(GT.basiszinsFor(2026), 0.032));
  // bought in March -> 2 full months before -> 10/12
  ok('month factor: March purchase -> 10/12', near(GT.monthsFactorForPurchase('2025-03-15', 2025), 10 / 12));
  ok('month factor: earlier year -> 12/12, later year -> 0', GT.monthsFactorForPurchase('2024-11-01', 2025) === 1 && GT.monthsFactorForPurchase('2026-01-05', 2025) === 0);
  // Cap = Mehrbetrag between first and last price PLUS distributions (sec. 18 (1) S.3 InvStG):
  // start 1000, end 1015, dist 10, Basiszins 3.2% -> B = 22.4; cap = 15 + 10 = 25
  // -> min(22.4, 25) - 10 = 12.4
  const vd = GT.computeVorabpauschale({ valueStart: 1000, valueEnd: 1015, distributions: 10, basiszins: 0.032 });
  ok('cap includes the year\'s distributions (12.40)', near(vd.vorabpauschale, 12.4, 1e-9));
  // loss year incl. distributions: start 1000, end 950, dist 10 -> cap max(0, -50 + 10) = 0 -> 0
  ok('no Vorabpauschale when value fell by more than the distributions',
    GT.computeVorabpauschale({ valueStart: 1000, valueEnd: 950, distributions: 10, basiszins: 0.032 }).vorabpauschale === 0);
  // per-lot month factor: 100 units held since 2020 + 100 bought in July 2025
  // -> (100 * 12/12 + 100 * 6/12) / 200 = 0.75
  const txs = [
    { type: 'buy', category: 'stocks', symbol: 'VWCE', quantity: 100, price: 80, currency: 'EUR', date: '2020-05-04' },
    { type: 'buy', category: 'stocks', symbol: 'VWCE', quantity: 100, price: 120, currency: 'EUR', date: '2025-07-01' }
  ];
  const row = GTV.prefillRow(txs, { VWCE: [{ timestamp: '2024-12-31T17:00:00Z', price: 110 }, { timestamp: '2025-12-30T17:00:00Z', price: 130 }] }, 'VWCE', 2025, 1);
  ok('prefill: per-lot month factor 0.75', near(row.monthsFactor, 0.75));
  // taxed in Y+1: record for value year 2025 (100 EUR, equity fund -> 70 taxable) lands in report 2026
  const recs = { VWCE: { 2025: 100 } };
  const S = { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 0, cryptoExemption: true };
  const opt = (year) => ({ year, jurisdiction: 'de', exchangeRate: 1, germanTax: GT, taxSettings: S, vapRecords: recs, fundTypes: { VWCE: 'aktienfonds' }, dividendEvents: [], taxOverrides: {} });
  ok('VAP of value year 2025 is not taxed in 2025', near(TR.build(txs, opt(2025)).summary.germanDetail.vorabpauschaleTaxable, 0));
  ok('VAP of value year 2025 is taxed in 2026 after Teilfreistellung (70)', near(TR.build(txs, opt(2026)).summary.germanDetail.vorabpauschaleTaxable, 70));
  // credit per unit: 200 units held at end of 2025, sell 50 of the 2020 lot in 2026 -> 100 * 50/200 = 25
  const sell = txs.concat([{ type: 'sell', category: 'stocks', symbol: 'VWCE', quantity: 50, price: 140, currency: 'EUR', date: '2026-03-02' }]);
  const rep = TR.build(sell, opt(2026));
  ok('VAP credit pro-rated per unit sold (25)', near(rep.summary.germanDetail.vapCreditTotal, 25));
  // a lot bought AFTER the record's year end gets no credit
  ok('no credit for a lot acquired after the recorded year',
    near(TR.vapCreditForLot(sell, recs, { symbol: 'VWCE', quantity: 10, acquisitionDate: '2026-01-05', disposalDate: '2026-03-02' }), 0));
}

// ---------------------------------------------------------------------------
console.log('§ 23 EStG crypto:');
{
  ok('anniversary sale is still short-term', L.heldOverOneYear('2024-03-01', '2025-03-01') === false);
  ok('day after the anniversary is long-term', L.heldOverOneYear('2024-03-01', '2025-03-02') === true);
  ok('29 Feb: period ends 28 Feb (§ 188 (3) BGB)', L.heldOverOneYear('2024-02-29', '2025-02-28') === false && L.heldOverOneYear('2024-02-29', '2025-03-01') === true);
  const S = { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true };
  const run = (gain, year) => TR.build([
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 10000, currency: 'EUR', date: year + '-01-02' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 10000 + gain, currency: 'EUR', date: year + '-06-30' }
  ], { year, jurisdiction: 'de', exchangeRate: 1, germanTax: GT, taxSettings: S, dividendEvents: [], taxOverrides: {} }).summary.germanDetail.crypto;
  ok('999.99 EUR gain is under the Freigrenze (tax-free)', run(999.99, 2025).taxable === 0);
  ok('exactly 1000 EUR is taxable in full ("weniger als 1 000 Euro")', near(run(1000, 2025).taxable, 1000));
  ok('before 2024 the Freigrenze is 600', run(599.99, 2023).taxable === 0 && near(run(600, 2023).taxable, 600));
  const f = TA.analyze({ today: '2025-07-01', realizedCryptoGainsYTD: 1000 }).findings.find(x => x.kind === 'cryptoFreigrenze');
  ok('advisor flags exactly 1000 EUR as over the Freigrenze', !!f && f.priority === 'critical');
}

// ---------------------------------------------------------------------------
console.log('migration v4 (year-less price timestamps):');
{
  // now = 2026-01-05 10:00 local; legacy points (oldest first) cross New Year
  const now = new Date(2026, 0, 5, 10, 0);
  const res = MIG.repairPriceTimestamps({ btc: [
    { timestamp: '12/30, 08:14 PM', price: 1 },
    { timestamp: '01/02, 09:00 AM', price: 2 },
    { timestamp: '2026-01-04T09:00:00.000Z', price: 3 }
  ] }, now);
  const s = res.history.btc;
  ok('year recovered across New Year (2025-12-30 / 2026-01-02)',
    s.length === 3 && new Date(s[0].timestamp).getFullYear() === 2025 && new Date(s[0].timestamp).getMonth() === 11 &&
    new Date(s[1].timestamp).getFullYear() === 2026 && new Date(s[0].timestamp).getHours() === 20);
  ok('ISO points kept as they are', s[2].timestamp === '2026-01-04T09:00:00.000Z' && res.changed === true);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
