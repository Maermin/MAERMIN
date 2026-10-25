// Node harness for dividend scheduling correctness — payout frequency and the payment
// schedule. Run: node test/dividends.test.js
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

  Svc.fetchDividendFromWorker('FB', 'https://w.example').then((rec) => {
    ok('renames FB → META in the query URL', /symbol=META(&|$)/.test(lastUrl));
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
