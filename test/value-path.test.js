// Node harness for the daily value path (TWR from day one). Every expected
// figure is computed by hand in the comment next to it.
// Run: node test/value-path.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
function near(a, b, eps) { return a != null && Math.abs(a - b) <= (eps || 1e-9); }

const VP = require('../value-path.js');
const buy = (symbol, date, quantity, price, extra) => Object.assign({ type: 'buy', category: 'stocks', symbol, date, quantity, price, currency: 'EUR' }, extra || {});
const sell = (symbol, date, quantity, price, extra) => Object.assign({ type: 'sell', category: 'stocks', symbol, date, quantity, price, currency: 'EUR' }, extra || {});
const S = (closes, splits) => ({ closes, splits: splits || [] });
const T = '2025-01-10';

(function run() {
  console.log('value path — time-weighted return:');
  {
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100)], { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 110]]) }, { today: T });
    ok('one buy, +10 % close → TWR 10 %', near(p.twr, 0.10), p.twr);
    ok('value points 1,000 → 1,100', p.points.length === 2 && near(p.points[0].v, 1000) && near(p.points[1].v, 1100), p.points);
    ok('start / end / days', p.start === '2025-01-02' && p.end === '2025-01-03' && p.days === 1);
    ok('under a year: no annualised figure', p.annualized === null);
  }
  {
    // A second deposit must not count as performance: 100→110 (+10 %), buy 10
    // more at 110, 110→121 (+10 %). TWR = 1.1 × 1.1 − 1 = 21 %; the value itself
    // goes 1,000 → 2,200 → 2,420 (+142 %).
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), buy('AAA', '2025-01-03', 10, 110)],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 110], ['2025-01-06', 121]]) }, { today: T });
    ok('a deposit is not performance: TWR 21 %, not +142 %', near(p.twr, 0.21), p.twr);
    ok('value 1,000 → 2,200 → 2,420, flow 1,100 on day 2', near(p.points[1].v, 2200) && near(p.points[2].v, 2420) && near(p.points[1].flow, 1100));
  }
  {
    // Fees lower the return: 1,010 paid for 1,000 of value → 1000/1010 − 1.
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100, { fees: 10 })], { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 100]]) }, { today: T });
    ok('buy fee is a loss: −0.990 %', near(p.twr, 1000 / 1010 - 1), p.twr);
  }
  {
    // Bought below the close of the day: 10 @ 95, close 100 → +5.263 % on day one.
    const p = VP.build([buy('AAA', '2025-01-02', 10, 95)], { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 100]]) }, { today: T });
    ok('trade price vs close counts on the trade day', near(p.twr, 100 / 95 - 1), p.twr);
    // 10 held (flat at 1 €), then 1,000 bought at 95 with a close of 100: the
    // 5,000 gain is measured on 95,010, not on the 10 € held before.
    const q = VP.build([buy('AAA', '2025-01-02', 10, 1), buy('BBB', '2025-01-03', 1000, 95)],
      { 'stocks|AAA': S([['2025-01-02', 1], ['2025-01-03', 1]]), 'stocks|BBB': S([['2025-01-03', 100]]) }, { today: T });
    ok('a large buy next to a small balance does not explode', near(q.twr, 5000 / 95010), q.twr);
  }
  {
    // Partial sale at the close: day 2 (600 left + 600 paid out)/1,000 = +20 %,
    // day 3 660/600 = +10 % → 32 %.
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), sell('AAA', '2025-01-03', 5, 120)],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 120], ['2025-01-06', 132]]) }, { today: T });
    ok('partial sale: TWR 32 %', near(p.twr, 0.32), p.twr);
    // sell fee 6 → day 2 (600 + 594)/1000
    const q = VP.build([buy('AAA', '2025-01-02', 10, 100), sell('AAA', '2025-01-03', 5, 120, { fees: 6 })],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 120], ['2025-01-06', 132]]) }, { today: T });
    ok('sell fee lowers it: 1.194 × 1.1 − 1', near(q.twr, 1.194 * 1.1 - 1), q.twr);
  }
  {
    // Sold out (+20 %), nothing held for a week, re-entry, +10 % → 32 %.
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), sell('AAA', '2025-01-03', 10, 120), buy('AAA', '2025-01-08', 4, 150)],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 120], ['2025-01-06', 500], ['2025-01-08', 150], ['2025-01-09', 165]]) }, { today: T });
    ok('full sale and re-entry: gap does not count, TWR 32 %', near(p.twr, 0.32), p.twr);
  }
  {
    // Dividend 20 on 1,000 with a flat price → +2 %.
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), { type: 'dividend', category: 'stocks', symbol: 'AAA', date: '2025-01-03', quantity: 1, price: 25, withholdingTax: 5, currency: 'EUR' }],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 100]]) }, { today: T });
    ok('net dividend is return: +2 %', near(p.twr, 0.02), p.twr);
  }
  {
    // 2:1 split on 01-06. Closes are split-adjusted (50, 55, 60); the 10 shares
    // bought at 100 are 20 shares at 50 → 60/50 − 1 = 20 %.
    const closes = [['2025-01-02', 50], ['2025-01-03', 55], ['2025-01-06', 60]];
    const q = VP.build([buy('AAA', '2025-01-02', 10, 100)], { 'stocks|AAA': S(closes) }, { today: T, splits: { 'stocks|AAA': [{ date: '2025-01-06', num: 2, den: 1 }] } });
    ok('recorded split: TWR 20 %, first value 1,000', near(q.twr, 0.20) && near(q.points[0].v, 1000), q.twr);
    // A split only the data source reports is NOT applied: a trade entered in
    // post-split units (20 @ 50) must stay 20 units (was: 40 units, +100 %).
    const p = VP.build([buy('AAA', '2025-01-02', 20, 50)], { 'stocks|AAA': S(closes, [{ date: '2025-01-06', num: 2, den: 1 }]) }, { today: T });
    ok('unrecorded split reported by the source is not applied', near(p.twr, 0.20) && near(p.points[0].v, 1000), p.twr);
  }
  {
    // USD trade converted at the rate of its date (0.90): 10 × 100 $ = 900 €.
    // Closes arrive in EUR: 90 → 99.
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100, { currency: 'USD' })], { 'stocks|AAA': S([['2025-01-02', 90], ['2025-01-03', 99]]) },
      { today: T, exchangeRate: 0.5, fxAt: () => 0.9 });
    ok('USD trade at the FX rate of its date', near(p.twr, 0.10) && near(p.points[0].flow, 900), p.points[0]);
  }
  {
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), sell('AAA', '2025-01-03', 25, 110)],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 110]]) }, { today: T });
    ok('oversell pays out only what was held: +10 %', near(p.twr, 0.10), p.twr);
  }

  {
    // Transfer in (price 0) of 1 unit worth 500 next to a 1,000 book: no gain.
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), buy('BBB', '2025-01-03', 1, 0)],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 100]]), 'stocks|BBB': S([['2025-01-03', 500]]) }, { today: T });
    ok('a trade without a price is a transfer, not a gain', near(p.twr, 0) && near(p.points[1].v, 1500), p.twr);
    const q = VP.build([buy('AAA', '2025-01-02', 10, 100), sell('AAA', '2025-01-03', 10, 0), buy('AAA', '2025-01-06', 1, 100)],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 110], ['2025-01-06', 100], ['2025-01-07', 110]]) }, { today: T });
    ok('transfer out at price 0 is not a total loss', near(q.twr, 1.1 * 1.1 - 1), q.twr);
  }

  console.log('value path — coverage:');
  {
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), buy('ZZZ', '2025-01-02', 1, 5000), Object.assign(buy('Karambit', '2025-01-02', 1, 300), { category: 'skins' })],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 110]]) }, { today: T });
    ok('holdings without a series are left out and listed', near(p.twr, 0.10) && p.missing.map((m) => m.symbol).sort().join() === 'Karambit,ZZZ' && p.covered.length === 1, p.missing);
    ok('no series at all → no path', VP.build([buy('AAA', '2025-01-02', 10, 100)], {}, { today: T }).twr === null);
    ok('no transactions → no path', VP.build([], { 'stocks|AAA': S([['2025-01-02', 100]]) }, { today: T }).twr === null);
  }
  {
    // Closes start two days after the buy: valued at the trade price until then
    // (no fake return), the total is still last close / trade price.
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), buy('BBB', '2025-01-02', 10, 50)],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 100], ['2025-01-06', 100]]), 'stocks|BBB': S([['2025-01-06', 60]]) }, { today: T });
    ok('late series: carried at trade price, then real', near(p.points[1].v, 1500) && p.points[1].carried === true && near(p.points[2].v, 1600) && near(p.twr, 1600 / 1500 - 1), p.points);
    ok('carried holding reported with its last carried day', p.carried.length === 1 && p.carried[0].symbol === 'BBB' && p.carried[0].until === '2025-01-03', p.carried);
  }
  {
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100)], { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 110]]) }, { today: T, live: { 'stocks|AAA': 120 } });
    ok('today is valued at the live quote', p.end === T && near(p.points[p.points.length - 1].v, 1200) && near(p.twr, 0.20), p);
  }
  {
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), buy('AAA', '2026-01-02', 1, 1)], { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 110]]) }, { today: T });
    ok('trades after "today" are ignored', near(p.twr, 0.10) && p.points.length === 2);
  }
  {
    // Three years, price × 1.331 → 10 % p.a. (1,096 days / 365.25).
    const p = VP.build([buy('AAA', '2022-01-03', 1, 100)], { 'stocks|AAA': S([['2022-01-03', 100], ['2025-01-03', 133.1]]) }, { today: T });
    ok('annualised after a year: ~10 % p.a.', near(p.annualized, Math.pow(1.331, 365.25 / 1096) - 1) && near(p.annualized, 0.10, 2e-3), p.annualized);
  }

  console.log('fromValues (snapshot fallback):');
  {
    // 1,000 → 1,100 (+10 %); then +10 % on the 1,100 and a deposit of 1,100
    // on the snapshot day: (2,310 − 1,100) / 1,100 = +10 %.
    const r = VP.fromValues([{ d: '2025-01-02', v: 1000 }, { d: '2025-01-03', v: 1100 }, { d: '2025-01-06', v: 2310 }], [{ d: '2025-01-02', amount: 1000 }, { d: '2025-01-06', amount: 1100 }]);
    ok('chain-links snapshots around a deposit: 21 %', near(r.twr, 0.21) && r.periods === 2 && r.start === '2025-01-02', r);
    const w = VP.fromValues([{ d: '2025-01-02', v: 1000 }, { d: '2025-01-03', v: 600 }], [{ d: '2025-01-03', amount: -600 }]);
    ok('withdrawal between two snapshots: +20 %', near(w.twr, 0.20), w);
    ok('fewer than two points → null', VP.fromValues([{ d: '2025-01-02', v: 1 }], []) === null && VP.fromValues(null, null) === null);
    // 10 held, 100,000 added and up 5 % the same day: 5,000 on 100,010, not on 10.
    ok('a deposit larger than the old balance is measured on itself', near(VP.fromValues([{ d: '2025-01-02', v: 10 }, { d: '2025-01-03', v: 105010 }], [{ d: '2025-01-03', amount: 100000 }]).twr, 5000 / 100010));
    // Trades imported later with an earlier date: the old snapshots never saw
    // them, the factor would be ≤ 0 → no figure.
    ok('snapshots that contradict the transactions → null', VP.fromValues([{ d: '2025-01-02', v: 1000 }, { d: '2025-01-03', v: 1000 }], [{ d: '2025-01-03', amount: 900 }, { d: '2025-01-03', amount: 200 }]) === null);
    ok('unsorted input is sorted', near(VP.fromValues([{ d: '2025-01-03', v: 110 }, { d: '2025-01-02', v: 100 }], []).twr, 0.10));
  }
  {
    const fl = VP.flowsOf([buy('AAA', '2025-01-02', 10, 100, { fees: 5 }), sell('AAA', '2025-01-03', 5, 120, { fees: 2 }), { type: 'dividend', symbol: 'AAA', date: '2025-01-04', quantity: 1, price: 9 },
      Object.assign(buy('OPT', '2025-01-02', 1, 50), { category: 'options' })], {});
    ok('flowsOf: buys with fees +, sells net −, no dividends / options', fl.length === 2 && near(fl[0].amount, 1005) && near(fl[1].amount, -598), fl);
  }

  console.log('index + aligned closes (analytics input):');
  {
    const p = VP.build([buy('AAA', '2025-01-02', 10, 100), buy('AAA', '2025-01-03', 10, 110)],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 110], ['2025-01-06', 121]]) }, { today: T });
    const ix = VP.index(p);
    ok('index is flow-neutral: 100 → 110 → 121', ix.length === 3 && near(ix[0].v, 100) && near(ix[1].v, 110) && near(ix[2].v, 121) && ix[2].d === '2025-01-06', ix);
    ok('max keeps the latest points', VP.index(p, { max: 2 }).length === 2 && VP.index(p, { max: 2 })[0].d === '2025-01-03');
    ok('empty path → empty index', VP.index(null).length === 0 && VP.index({ points: [] }).length === 0);
    const c = VP.build([buy('AAA', '2025-01-02', 10, 100), buy('BBB', '2025-01-02', 10, 50)],
      { 'stocks|AAA': S([['2025-01-02', 100], ['2025-01-03', 100], ['2025-01-06', 100], ['2025-01-07', 110]]), 'stocks|BBB': S([['2025-01-06', 60], ['2025-01-07', 60]]) }, { today: T });
    const cx = VP.index(c);
    ok('index starts after the last carried day', cx.length === 2 && cx[0].d === '2025-01-06' && near(cx[1].v, 100 * 1700 / 1600), cx);
  }
  {
    const al = VP.alignedCloses({
      'stocks|AAA': S([['2025-01-02', 1], ['2025-01-03', 2], ['2025-01-06', 3]]),
      'crypto|BTC': S([['2025-01-03', 10], ['2025-01-04', 11], ['2025-01-05', 12], ['2025-01-06', 13]]),
      'stocks|ONE': S([['2025-01-03', 10]])
    }, ['stocks|AAA', 'crypto|BTC', 'stocks|ONE', 'stocks|NONE'], { labels: { 'stocks|AAA': 'aaa' } });
    ok('only days every holding has a close (no filled weekends)', Object.keys(al).sort().join() === 'aaa,crypto|BTC' && al.aaa.map((x) => x.timestamp).join() === '2025-01-03,2025-01-06'
      && al.aaa.map((x) => x.price).join() === '2,3' && al['crypto|BTC'].map((x) => x.price).join() === '10,13', al);
    ok('max trims to the latest dates', VP.alignedCloses({ 'stocks|AAA': S([['2025-01-02', 1], ['2025-01-03', 2], ['2025-01-06', 3]]) }, ['stocks|AAA'], { max: 2 })['stocks|AAA'].length === 2);
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
