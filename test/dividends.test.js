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

  console.log('inferFrequency — from annual rate / last payment:');
  ok('0.96 / 0.24 → quarterly', Svc.inferFrequency(0.96, 0.24) === 'quarterly');
  ok('12 / 1 → monthly', Svc.inferFrequency(12, 1) === 'monthly');
  ok('4 / 2 → semi-annual', Svc.inferFrequency(4, 2) === 'semi-annual');
  ok('3.4 / 3.4 → annual', Svc.inferFrequency(3.4, 3.4) === 'annual');
  ok('no hint + .DE suffix → annual', Svc.inferFrequency(0, 0, 'SAP.DE') === 'annual');
  ok('no hint + US ticker → quarterly', Svc.inferFrequency(0, 0, 'AAPL') === 'quarterly');

  console.log('buildPaymentSchedule — one entry per individual payout:');
  // AAPL is in the built-in DB (0.96/yr, quarterly) — no fetch needed. back:0 →
  // forward-only window.
  const sched = Svc.buildPaymentSchedule({ stocks: [{ symbol: 'AAPL', amount: 10 }] }, { now: '2026-01-01', months: 12, back: 0 });
  ok('quarterly holding → 4 individual payments over 12 months', sched.length === 4);
  ok('each payment = annual/ppy × shares (0.96/4 × 10 = 2.40)', sched.every(p => p.amount === 2.4));
  ok('every row carries the symbol', sched.every(p => p.symbol === 'AAPL'));
  ok('rows are date-sorted ascending', sched.every((p, i) => i === 0 || sched[i - 1].date <= p.date));
  ok('forward-only window → no past rows', sched.every(p => p.past === false));
  ok('non-payer / empty holding → no rows', Svc.buildPaymentSchedule({ stocks: [{ symbol: 'ZUNKNOWN', amount: 5 }] }, { now: '2026-01-01' }).length === 0);
  ok('multiple holdings aggregate', Svc.buildPaymentSchedule({ stocks: [{ symbol: 'AAPL', amount: 10 }, { symbol: 'O', amount: 12 }] }, { now: '2026-01-01', months: 12, back: 0 }).length > 4); // O is monthly → +12

  console.log('buildPaymentSchedule — trailing window includes already-received payouts:');
  // Mid-year: a trailing window must surface the payments earlier in the year so
  // the annual total reconciles. AAPL quarterly over a full ±12-month window.
  const withPast = Svc.buildPaymentSchedule({ stocks: [{ symbol: 'AAPL', amount: 10 }] }, { now: '2026-06-15', months: 12, back: 12 });
  ok('window covers ~2 years of quarterly payouts (≈8)', withPast.length >= 7 && withPast.length <= 9);
  ok('some payouts are flagged past (already received)', withPast.some(p => p.past === true));
  ok('some payouts are still upcoming', withPast.some(p => p.past === false));
  ok('past payouts are dated before now', withPast.filter(p => p.past).every(p => new Date(p.date) < new Date('2026-06-15')));
  ok('upcoming payouts are dated on/after now', withPast.filter(p => !p.past).every(p => new Date(p.date) >= new Date('2026-06-15')));

  // ── Worker (Yahoo fundamentals) dividend resolution — stubbed fetch ──────────
  console.log('fetchDividendFromWorker — builds a record from fundamentals:');
  globalThis.window.MaerminTickers = require('../ticker-validation.js'); // enables the rename path
  let lastUrl = '';
  globalThis.fetch = (url) => {
    lastUrl = url;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({
      symbol: 'FI', name: 'Fiserv', currency: 'USD',
      dividendRate: 2.04, lastDividendValue: 0.51,
      exDividendDate: '2026-09-15', dividendDate: '2026-09-30'
    }) });
  };

  Svc.fetchDividendFromWorker('FISV', 'https://w.example').then((rec) => {
    ok('renames FISV → FI in the query URL', /symbol=FI(&|$)/.test(lastUrl));
    ok('record carries the annual rate', rec && rec.annualDividend === 2.04);
    ok('infers quarterly (2.04 / 0.51 ≈ 4)', rec.frequency === 'quarterly');
    ok('anchors ex-month from the ex-date (Sep → 9)', Array.isArray(rec.exMonths) && rec.exMonths[0] === 9);
    ok('keeps the reporting currency', rec.currency === 'USD');
    ok('marked fromWorker', rec.fromWorker === true);

    return Svc.prefetchPortfolio({ stocks: [{ symbol: 'TESTX' }] }, { workerUrl: 'https://w.example' });
  }).then((n) => {
    ok('prefetch via Worker resolves the holding (count = 1)', n === 1);
    ok('warmed cache lets getDividendData resolve synchronously', (() => {
      const d = Svc.getDividendData('TESTX', 100); return !!d && d.annualDividend === 2.04;
    })());
    return Svc.prefetchPortfolio({ stocks: [{ symbol: 'NOPE' }] });
  }).then((n0) => {
    ok('no Worker URL + no FMP key → resolves 0', n0 === 0);
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
})();
