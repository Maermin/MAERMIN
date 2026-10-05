// Node harness for P1-5 (FINDINGS.md H-1, H-2, M-2, M-5, M-16): imported
// symbols, fees and FX rates land on the right asset, amount and day.
// Run: node test/import-fx.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);

globalThis.window = {};
globalThis.localStorage = {
  _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
};
const X = require('../exchange-sync.js');
const FX = require('../fx-history.js');
const A = require('../fx-attribution.js');
const SP = require('../savings-plan-executor.js');
const M = require('../migrations.js');

(function run() {
  // ---- H-1: Kraken legacy pair names --------------------------------------
  console.log('H-1 Kraken symbols:');
  const kr = X.mapTrades('kraken', { result: { trades: {
    T1: { pair: 'XXBTZEUR', type: 'buy', price: '30000', vol: '0.1', fee: '1', time: 1767225600 },
    T2: { pair: 'XETHZUSD', type: 'buy', price: '2000', vol: '1', fee: '1', time: 1767225600 },
    T3: { pair: 'XXDGZEUR', type: 'buy', price: '0.1', vol: '100', fee: '0', time: 1767225600 },
    T4: { pair: 'XXRPZEUR', type: 'buy', price: '0.5', vol: '10', fee: '0', time: 1767225600 },
    T5: { pair: 'XTZEUR', type: 'buy', price: '1', vol: '5', fee: '0', time: 1767225600 },
    T6: { pair: 'SOLEUR', type: 'buy', price: '100', vol: '1', fee: '0', time: 1767225600 }
  } } });
  const sym = (id) => (kr.find((t) => t.externalId === id) || {}).symbol;
  ok('H-1: XXBTZEUR -> BTC (was XXBTZ)', sym('T1') === 'BTC');
  ok('H-1: XETHZUSD -> ETH, quoted in USD', sym('T2') === 'ETH' && kr.find((t) => t.externalId === 'T2').currency === 'USD');
  ok('H-1: XXDGZEUR -> DOGE', sym('T3') === 'DOGE');
  ok('H-1: XXRPZEUR -> XRP', sym('T4') === 'XRP');
  ok('H-1: Tezos XTZEUR stays XTZ (no blind X/Z stripping)', sym('T5') === 'XTZ');
  ok('H-1: modern pair names are unchanged', sym('T6') === 'SOL');

  // ---- H-2: USD->EUR history day offset in British Summer Time --------------
  console.log('H-2 USD history dates:');
  // Yahoo stamps EURUSD=X daily bars at 00:00 Europe/London = 23:00 UTC the day
  // before in summer; the Worker's `date` is that UTC day.
  const bar = (day, price) => {
    const ts = Date.UTC(2025, 6, day, 0, 0) / 1000 - 3600;
    return { ts, date: new Date(ts * 1000).toISOString().slice(0, 10), price };
  };
  const yahoo = { exchangeTz: 'Europe/London', prices: [bar(7, 1.1), bar(8, 1.2), bar(9, 1.3)] };
  const series = FX.ingestYahooSeries(yahoo);
  ok('H-2: bars are filed under their London trading day', Object.keys(series).sort().join() === '2025-07-07,2025-07-08,2025-07-09');
  ok('H-2: Tue 2025-07-08 converts at 0.8333 (was 0.7692)', near(FX.rateAt(series, '2025-07-08'), 1 / 1.2));
  ok('H-2: a response without ts/exchangeTz still uses the date', Object.keys(FX.ingestYahooSeries({ prices: [{ date: '2025-01-10', price: 1.05 }] })).join() === '2025-01-10');
  // Repair of the stored cache: keys inside the re-fetched range are replaced,
  // so the wrongly dated Sunday key disappears instead of surviving a merge.
  const stale = { '2025-07-06': 1 / 1.1, '2025-07-07': 1 / 1.2, '2025-07-08': 1 / 1.3, '2025-07-09': 0.77, '2024-01-02': 0.9 };
  const fixedSeries = FX.ingestYahooSeries({ exchangeTz: 'Europe/London', prices: [bar(4, 1.05), bar(7, 1.1), bar(8, 1.2), bar(9, 1.3)] });
  const repaired = FX.replaceRange(stale, fixedSeries);
  ok('H-2: replaceRange drops the wrongly dated Sunday key', repaired['2025-07-06'] === undefined);
  ok('H-2: replaceRange takes the corrected bars', near(repaired['2025-07-08'], 1 / 1.2) && near(repaired['2025-07-09'], 1 / 1.3));
  ok('H-2: keys outside the fetched range are kept', repaired['2024-01-02'] === 0.9);
  // Migration: forget the backfill marker, so the next refresh fetches range=max.
  localStorage._d = { maermin_schema_version: '5', maermin_fx_backfill: '2026-09-01T00:00:00Z', maermin_fx_history: JSON.stringify(stale) };
  M.run();
  ok('H-2: migration clears the backfill marker (full re-fetch next refresh)', localStorage.getItem('maermin_fx_backfill') === null);
  ok('H-2: migration keeps the cached rates until the re-fetch replaces them', localStorage.getItem('maermin_fx_history') === JSON.stringify(stale));
  ok('H-2: migration recorded', M.getVersion() === M.LATEST && M.LATEST >= 6);

  // ---- M-2: Binance commission in the bought coin -------------------------
  console.log('M-2 Binance fees:');
  const bn = X.mapTrades('binance', [
    { symbol: 'BTCEUR', id: 1, price: '50000', qty: '0.1', commission: '0.0001', commissionAsset: 'BTC', time: Date.UTC(2026, 0, 2), isBuyer: true },
    { symbol: 'ETHEUR', id: 2, price: '3000', qty: '1', commission: '0.001', commissionAsset: 'ETH', time: Date.UTC(2026, 0, 3), isBuyer: false },
    { symbol: 'BTCEUR', id: 3, price: '50000', qty: '0.1', commission: '0.002', commissionAsset: 'BNB', time: Date.UTC(2026, 0, 4), isBuyer: true },
    { symbol: 'BTCEUR', id: 4, price: '50000', qty: '0.1', commission: '5', commissionAsset: 'EUR', time: Date.UTC(2026, 0, 5), isBuyer: true }
  ]);
  const byId = (id) => bn.find((t) => t.externalId === 'BTCEUR:' + id || t.externalId === 'ETHEUR:' + id);
  ok('M-2: a buy with the fee in BTC books 0.0999 BTC (was 0.1)', near(byId(1).quantity, 0.0999, 1e-12));
  ok('M-2: ... and keeps the full cost: fee = 0.0001 x 50000 = 5 EUR', near(byId(1).fees, 5) && near(byId(1).quantity * byId(1).price + byId(1).fees, 5000));
  ok('M-2: a sell with the fee in the base coin adds commission x price to the fees', near(byId(2).fees, 3) && byId(2).quantity === 1);
  ok('M-2: a fee in a third asset (BNB) is not silently dropped: kept on the row', byId(3).fees === 0 && byId(3).feeAsset === 'BNB' && near(byId(3).feeQuantity, 0.002) && /BNB/.test(byId(3).notes || ''));
  ok('M-2: a fee in the quote currency is unchanged', byId(4).fees === 5 && byId(4).quantity === 0.1);

  // ---- M-5: FX attribution aligned by date --------------------------------
  console.log('M-5 FX attribution by date:');
  // 100 refreshes over two days: the EUR price goes 100 -> 101.
  const hist = [];
  for (let i = 0; i < 100; i++) hist.push({ timestamp: (i < 50 ? '2026-03-01' : '2026-03-02') + 'T' + String(8 + (i % 10)).padStart(2, '0') + ':' + String(i).padStart(2, '0').slice(-2) + ':00Z', price: i < 50 ? 100 : 101 });
  // 100 trading days of EUR-per-USD rising 0.80 -> 0.90, almost flat on the last two days.
  const fxDated = [];
  for (let i = 0; i < 100; i++) {
    const d = new Date(Date.UTC(2026, 2, 2) - (99 - i) * 86400000).toISOString().slice(0, 10);
    fxDated.push({ date: d, value: i < 98 ? 0.80 + 0.1 * i / 98 : 0.90 });
  }
  const eurPts = A.datedSeries(hist);
  ok('M-5: refresh points collapse to one point per day', eurPts.length === 2 && eurPts[0].date === '2026-03-01' && near(eurPts[1].value, 101));
  const d = A.decompose(eurPts, fxDated, 'USD');
  ok('M-5: the FX leg covers the same two days (not 100 trading days)', d.periods === 2 && near(d.fxReturn, 0, 1e-9));
  ok('M-5: so the 1 % gain is local, not FX', near(d.eurReturn, 0.01, 1e-9) && near(d.localReturn, 0.01, 1e-9));
  const old = A.decompose(hist.map((h) => h.price), fxDated.map((f) => f.value), 'USD');
  ok('M-5 repro: the count-aligned path reports a large FX return for the same data', old.fxReturn > 0.1);
  ok('M-5: a weekend point uses the FX rate of the Friday before', near(A.fxOnOrBefore(fxDated, '2026-03-07'), 0.90) && A.fxOnOrBefore(fxDated, '2025-01-01') === null);
  ok('M-5: EUR positions have no FX leg in the dated path either', A.decompose(eurPts, fxDated, 'EUR').fxReturn === 0);
  const res = A.attribute([{ symbol: 'AAPL', cls: 'stocks', currency: 'USD', valueEUR: 1000, series: eurPts }], fxDated);
  ok('M-5: attribute accepts dated series', res.available && near(res.totals.fxReturn, 0, 1e-9));

  // ---- M-16: back-dated USD savings plans at the rate of the due date -------
  console.log('M-16 savings plans:');
  const plan = { id: 'p', symbol: 'AAPL', category: 'stocks', amount: 100, amountCurrency: 'USD', frequency: 'monthly', startDate: '2026-01-15', active: true };
  const fxAt = (date) => (date < '2026-03-01' ? 0.80 : 0.95);
  const out = SP.runCatchUp([plan], [], () => ({ price: 10, estimated: false }), '2026-03-20', (i) => 'x' + i, fxAt);
  const amt = (date) => { const tx = out.created.find((t) => t.dueDate === date); return tx.quantity * tx.price; };
  ok('M-16: January is booked at January\'s rate (80 EUR, not 95)', near(amt('2026-01-15'), 80) && near(amt('2026-02-15'), 80));
  ok('M-16: March at March\'s rate', near(amt('2026-03-15'), 95));
  ok('M-16: a plain number still works (live rate)', near(SP.amountToEUR(plan, 0.9, '2026-01-15'), 90));
  const est = [{ id: 'e', type: 'buy', source: 'savings-plan', planId: 'p', dueDate: '2026-01-15', symbol: 'AAPL', estimatedPrice: true, planAmount: 100, planAmountCurrency: 'USD', quantity: 9.5, price: 10 }];
  const rp = SP.repriceEstimated(est, () => 8, fxAt);
  ok('M-16: re-pricing an estimate uses the rate of its due date', rp.repriced === 1 && near(rp.transactions[0].quantity * rp.transactions[0].price, 80));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
