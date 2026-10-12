// Node harness for the Snapshot-Powered Performance engine. Pure, no browser.
// Run: node test/performance-cards.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b) { return Math.abs(a - b) < 1e-9; }

const P = require('../performance-cards.js');

(function run() {
  console.log('performance-cards:');

  // A year of sparse value points (ascending). asOf fixed for determinism.
  const series = [
    { d: '2025-06-21', v: 8000 },   // 1Y ago
    { d: '2025-12-31', v: 9000 },   // last year-end (YTD baseline is 2026-01-01)
    { d: '2026-01-01', v: 9100 },
    { d: '2026-03-21', v: 9500 },   // 3M ago
    { d: '2026-05-21', v: 9800 },   // 1M ago
    { d: '2026-06-14', v: 9900 },   // 1W ago
    { d: '2026-06-20', v: 9950 },   // 1D ago
    { d: '2026-06-21', v: 10000 }   // today (asOf)
  ];
  const asOf = '2026-06-21';

  // ---- 1D ----
  const d1 = P.computePeriod(series, '1D', asOf);
  ok('1D measures from prior day', d1.from === '2026-06-20' && d1.endValue === 10000);
  ok('1D abs', near(d1.abs, 50));
  ok('1D pct', near(d1.pct, (50 / 9950) * 100));
  ok('1D direction up', d1.up && !d1.down);

  // ---- 1M (carry-forward: 2026-05-21 exists) ----
  const m1 = P.computePeriod(series, '1M', asOf);
  ok('1M from one month back', m1.from === '2026-05-21' && near(m1.abs, 200));

  // ---- YTD uses Jan 1 baseline (carry-forward to 2026-01-01) ----
  const ytd = P.computePeriod(series, 'YTD', asOf);
  ok('YTD baseline is Jan 1', ytd.from === '2026-01-01' && near(ytd.abs, 900));

  // ---- 1Y exact hit ----
  const y1 = P.computePeriod(series, '1Y', asOf);
  ok('1Y from a year ago', y1.from === '2025-06-21' && near(y1.abs, 2000));
  ok('1Y not partial (enough history)', y1.partial === false);

  // ---- MAX = inception ----
  const mx = P.computePeriod(series, 'MAX', asOf);
  ok('MAX from first point', mx.from === '2025-06-21' && near(mx.pct, 25));

  // ---- partial flag when history is too short ----
  const young = [{ d: '2026-06-10', v: 100 }, { d: '2026-06-21', v: 110 }];
  const yMonth = P.computePeriod(young, '1M', asOf);   // 1M start predates first point
  ok('partial flagged when look-back predates inception', yMonth.partial === true && yMonth.from === '2026-06-10');
  ok('partial still yields a number', near(yMonth.abs, 10));

  // ---- carry-forward: weekend/gap start picks last known value ----
  const gap = [{ d: '2026-05-01', v: 500 }, { d: '2026-06-21', v: 600 }];
  const gMonth = P.computePeriod(gap, '1M', asOf);     // 2026-05-21 has no point -> use 2026-05-01
  ok('carry-forward picks last value before start', gMonth.from === '2026-05-01' && !gMonth.partial);

  // ---- computeAll returns all periods in order ----
  const all = P.computeAll(series, asOf);
  ok('computeAll returns every period', all.length === P.PERIODS.length);
  ok('computeAll preserves order', all[0].id === '1D' && all[all.length - 1].id === 'MAX');

  // ---- empty series ----
  ok('empty series -> null period', P.computePeriod([], '1D', asOf) === null);
  ok('empty series -> [] all', P.computeAll([], asOf).length === 0);

  // ---- daily extremes ----
  const ex = P.dailyExtremes(series);
  ok('dailyExtremes finds best+worst', ex && ex.best && ex.worst);
  ok('best day is positive here', ex.best.pct > 0);

  // ---- cleanSeries drops junk + sorts ----
  const cleaned = P.cleanSeries([
    { d: '2026-02-02', v: 2 }, { d: 'bad', v: 1 }, { d: '2026-01-01', v: 'NaN' }, { d: '2026-01-05', v: 5 }
  ]);
  ok('cleanSeries keeps valid, sorts', cleaned.length === 2 && cleaned[0].d === '2026-01-05');

  // ---- #2 drawdown ----
  const ddSer = [
    { d: '2026-01-01', v: 100 }, { d: '2026-01-02', v: 120 }, { d: '2026-01-03', v: 90 },
    { d: '2026-01-04', v: 110 }, { d: '2026-01-05', v: 130 }
  ];
  const dd = P.drawdownSeries(ddSer);
  ok('drawdownSeries length', dd.length === 5);
  ok('drawdown at trough is -25%', near(dd[2].dd, -25));
  ok('drawdown 0 at a new peak', near(dd[4].dd, 0));
  const dstat = P.drawdownStats(ddSer);
  ok('max drawdown is -25%', near(dstat.maxDd, -25));
  ok('trough date is the dip', dstat.troughDate === '2026-01-03');
  ok('recovered after the dip', dstat.recovered === true && dstat.recoveryDate === '2026-01-05');
  ok('current drawdown is 0 (at peak)', near(dstat.currentDd, 0));
  ok('too-short series -> null stats', P.drawdownStats([{ d: '2026-01-01', v: 1 }]) === null);

  // ---- #3 CAGR + goal ETA ----
  const cagr = P.cagrFromSeries([{ d: '2025-01-01', v: 100 }, { d: '2026-01-01', v: 110 }]);
  ok('CAGR ~10% over a year', Math.abs(cagr - 10) < 0.2);
  ok('CAGR null for too-short', P.cagrFromSeries([{ d: '2026-01-01', v: 100 }]) === null);
  ok('goal already reached', P.goalEta({ current: 2000, target: 1000 }).alreadyReached === true);
  ok('goal via contributions (no return)', P.goalEta({ current: 1000, target: 2000, monthly: 100, annualReturnPct: 0 }).months === 10);
  ok('goal via return only (~doubling at 1%/mo)', P.goalEta({ current: 1000, target: 2000, monthly: 0, annualReturnPct: 12 }).months === 70);
  ok('goal unreachable -> reachable false', P.goalEta({ current: 100, target: 1000, monthly: 0, annualReturnPct: 0 }).reachable === false);
  ok('goal ETA has a future date', /^\d{4}-\d{2}-\d{2}$/.test(P.goalEta({ current: 1000, target: 1100, monthly: 50, annualReturnPct: 5 }).etaISO));

  // ---- #1 benchmark compare ----
  const bench = [{ date: '2026-01-01', price: 200 }, { date: '2026-01-31', price: 210 }];
  ok('priceAsOf carries forward', P.priceAsOf(bench, '2026-01-15').price === 200);
  ok('priceAsOf before first is null', P.priceAsOf(bench, '2025-12-31') === null);
  const cmp = P.compareBenchmark([{ d: '2026-01-01', v: 1000 }, { d: '2026-01-31', v: 1100 }], bench, '1M', '2026-01-31');
  ok('compare: portfolio +10%', near(cmp.port, 10));
  ok('compare: benchmark +5%', near(cmp.bench, 5));
  ok('compare: relative +5pp', near(cmp.rel, 5));
  ok('compare null without benchmark data', P.compareBenchmark([{ d: '2026-01-01', v: 1000 }], [], '1M') === null);

  // P5-1.8: a buy or a sale is not a gain or a loss. Best/worst day, the
  // drawdown, the growth rate of the goal ETA and the benchmark row take the
  // same flows as the period cards (value path rule: flows at the end of the day).
  console.log('flows (buys and sales are not performance):');
  const fs_ = [{ d: '2026-01-01', v: 1000 }, { d: '2026-01-02', v: 2020 }, { d: '2026-01-03', v: 1990 }, { d: '2026-01-04', v: 1500 }, { d: '2026-01-05', v: 1545 }];
  const fl = [{ d: '2026-01-02', amount: 1000 }, { d: '2026-01-04', amount: -500 }];
  const fx = P.dailyExtremes(fs_, fl);
  ok('best day: +3 % (45 of 1,500) on day 5; the buy day counts +2 %, not +102 %', fx && fx.best.date === '2026-01-05' && near(fx.best.pct, 3) && near(fx.best.abs, 45));
  ok('worst day: −1.49 % (−30 of 2,020), the sale day is +0.5 %, not −25 %', fx && fx.worst.date === '2026-01-03' && near(fx.worst.pct, -30 / 2020 * 100));
  const fxRaw = P.dailyExtremes(fs_);
  ok('without flows the old raw moves stay (snapshots of a book without transactions)', near(fxRaw.best.pct, 102));
  const fdd = P.drawdownStats(fs_, fl);
  ok('drawdown: the sale is not a fall; max −1.49 % on day 3', fdd && near(fdd.maxDd, -30 / 2020 * 100) && fdd.troughDate === '2026-01-03');
  const fdds = P.drawdownSeries(fs_, fl);
  ok('underwater series has one point per day and recovers after the sale day', fdds.length === 5 && fdds[4].dd === 0);
  const fcg = P.cagrFromSeries([{ d: '2025-01-01', v: 1000 }, { d: '2026-01-01', v: 2100 }], [{ d: '2026-01-01', amount: 1000 }]);
  ok('growth rate for the goal ETA without the deposit: +10 % a year, not +110 %', fcg !== null && Math.abs(fcg - 10) < 0.05);
  const fbmk = [{ date: '2026-01-01', price: 100 }, { date: '2026-01-05', price: 101 }];
  const frow = P.compareBenchmark(fs_, fbmk, 'MAX', '2026-01-05', { flows: fl });
  const fcard = P.computePeriod(fs_, 'MAX', '2026-01-05', { flows: fl });
  ok('benchmark row uses the same flow-neutral return as the period card', frow && fcard && near(frow.port, fcard.pct) && near(frow.rel, fcard.pct - 1));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
