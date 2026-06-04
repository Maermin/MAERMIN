// Node harness for dividend scheduling correctness — the monthly-payer fix and
// even payment spreading. Run: node test/dividends.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

// dividend-data-service.js attaches to window and logs one load line.
globalThis.window = {};
globalThis.localStorage = { _d: {}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };
require('../dividend-data-service.js');
const Svc = globalThis.window.DividendDataService;

(function run() {
  console.log('buildPaymentMonths — exact count per frequency:');
  ok('annual → 1 month', Svc.buildPaymentMonths(undefined, 1).length === 1);
  ok('semi-annual → 2 months', Svc.buildPaymentMonths(undefined, 2).length === 2);
  ok('quarterly → 4 months', Svc.buildPaymentMonths(undefined, 4).length === 4);
  ok('monthly → 12 months (the bug fix)', Svc.buildPaymentMonths(undefined, 12).length === 12);
  ok('quarterly spread = [3,6,9,12]', JSON.stringify(Svc.buildPaymentMonths(undefined, 4)) === JSON.stringify([3,6,9,12]));
  ok('keeps stored months when sufficient', JSON.stringify(Svc.buildPaymentMonths([2,5,8,11], 4)) === JSON.stringify([2,5,8,11]));

  console.log('forecastDividends — monthly payer not under-counted:');
  // Monthly payer with NO exMonths (as an API result would arrive).
  const portfolio = { stocks: [{ symbol: 'XMON', amount: 100 }] };
  const divData = { XMON: { annualDividend: 12, frequency: 'monthly', growthRate: 0 } };
  const fc = Svc.forecastDividends(portfolio, divData, 1);
  const y = new Date().getFullYear();
  // 100 shares * $12/yr = $1200/yr expected, regardless of month bucketing.
  ok('annual projected = shares × annualDividend', near(fc[y].totalProjected, 1200));
  const monthsWithPay = Object.keys(fc[y].byMonth).filter(m => fc[y].byMonth[m].total > 0).length;
  ok('monthly payer hits 12 months (not 4)', monthsWithPay === 12);
  const sumMonths = Object.keys(fc[y].byMonth).reduce((s, m) => s + fc[y].byMonth[m].total, 0);
  ok('month buckets sum to the annual total', near(sumMonths, 1200));

  console.log('forecastDividends — quarterly payer = 4 months:');
  const q = Svc.forecastDividends({ stocks: [{ symbol: 'AAPL', amount: 10 }] }, { AAPL: { annualDividend: 0.96, frequency: 'quarterly', exMonths: [2,5,8,11] } }, 1);
  const qMonths = Object.keys(q[y].byMonth).filter(m => q[y].byMonth[m].total > 0).length;
  ok('quarterly payer hits 4 months', qMonths === 4);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
