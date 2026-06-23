// Node harness for the historical FX cache pure layer: Yahoo series ingestion
// (EURUSD=X → USD→EUR inversion), nearest-on-or-before lookup with edge
// behaviour, and the binary-search resolver. Run: node test/fx-history.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

const FX = require('../fx-history.js');

(function run() {
  console.log('fx-history:');

  // ---- ingestYahooSeries: EURUSD=X (USD per 1 EUR) → USD→EUR (1/price) -------
  const series = FX.ingestYahooSeries({ prices: [
    { date: '2024-01-02', price: 1.10 },   // 1 EUR = 1.10 USD → 1 USD = 0.9090.. EUR
    { date: '2024-06-01', price: 1.25 },   // → 0.8 EUR
    { date: '2024-09-01', price: 0 },      // dropped (non-positive)
    { date: 'bogus',      price: 1.2 },    // dropped (bad date)
  ] });
  ok('ingest inverts EURUSD=X to USD→EUR', near(series['2024-01-02'], 1 / 1.10) && near(series['2024-06-01'], 0.8));
  ok('ingest drops non-positive + bad-date rows', series['2024-09-01'] === undefined && Object.keys(series).length === 2);
  ok('ingest tolerates a non-array', Object.keys(FX.ingestYahooSeries({})).length === 0);

  // ---- rateAt: nearest on-or-before -----------------------------------------
  const hist = { '2024-01-02': 0.9091, '2024-06-01': 0.80, '2024-09-15': 0.92 };
  ok('exact date hit', near(FX.rateAt(hist, '2024-06-01', 1), 0.80));
  ok('between dates → previous trading day', near(FX.rateAt(hist, '2024-07-20', 1), 0.80));
  ok('after all data → latest known', near(FX.rateAt(hist, '2025-01-01', 1), 0.92));
  ok('before all data → earliest known (closer than today)', near(FX.rateAt(hist, '2023-01-01', 1), 0.9091));
  ok('accepts a full ISO timestamp', near(FX.rateAt(hist, '2024-06-10T12:00:00.000Z', 1), 0.80));
  ok('empty history → fallback', FX.rateAt({}, '2024-06-01', 0.91) === 0.91);
  ok('null history → fallback', FX.rateAt(null, '2024-06-01', 0.77) === 0.77);

  // ---- fxResolver: same answers, O(log n), bound fallback --------------------
  const r = FX.fxResolver(0.91, hist);
  ok('resolver matches rateAt (between)', near(r('2024-07-20'), 0.80));
  ok('resolver matches rateAt (after)', near(r('2025-03-03'), 0.92));
  ok('resolver matches rateAt (before)', near(r('2020-01-01'), 0.9091));
  const rEmpty = FX.fxResolver(0.88, {});
  ok('empty-cache resolver returns the live fallback for any date', rEmpty('2024-06-01') === 0.88 && rEmpty('1999-01-01') === 0.88);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
