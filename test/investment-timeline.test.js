// P5-2.7: investment calendar (year × month of money bought) and saving
// streaks (months in a row with at least one buy).
// Run: node test/investment-timeline.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, e) => a != null && b != null && Math.abs(a - b) <= (e || 1e-9);

const T = require('../investment-timeline.js');
const tx = (o) => Object.assign({ category: 'stocks', currency: 'EUR', symbol: 'AAA' }, o);
const buy = (date, amount, extra) => tx(Object.assign({ type: 'buy', date, quantity: 1, price: amount }, extra || {}));
const sell = (date, amount) => tx({ type: 'sell', date, quantity: 1, price: amount });

console.log('calendar:');
{
  const txs = [buy('2024-11-03', 100), buy('2024-11-20', 50, { fees: 1 }), buy('2025-01-05', 200), sell('2025-02-01', 80), buy('2025-03-10', 40, { currency: 'USD' })];
  const c = T.calendar(txs, { today: '2025-04-15', toEUR: (a, t) => (t.currency === 'USD' ? 0.9 : 1) * a });
  ok('one row per year from the first trade, newest first', c.years.map((y) => y.y).join() === '2025,2024', c.years.map((y) => y.y));
  const y24 = c.years[1], y25 = c.years[0];
  ok('twelve cells a year; months outside the history are marked', y24.cells.length === 12 && !y24.cells[9].inRange && y24.cells[10].inRange && !y25.cells[4].inRange && y25.cells[3].inRange);
  ok('November 2024: bought 151 incl. fees', near(y24.cells[10].buys, 151) && near(y24.total, 151));
  ok('2025: bought 200 + 36 (USD), sold 80', near(y25.total, 236) && near(y25.sells, 80) && near(y25.cells[2].buys, 36));
  ok('the biggest month sets the scale', near(c.max, 200));
  ok('no trades: no years', T.calendar([], { today: '2025-01-01' }).years.length === 0);
}

console.log('\nstreaks:');
{
  // buys Jan-Apr 2024, gap May, Jun-Jul 2024, then Sep 2024 - Mar 2025 (7 months), today in April 2025 without a buy yet
  const months = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-06', '2024-07', '2024-09', '2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03'];
  const txs = months.map((m) => buy(m + '-15', 100));
  const s = T.streaks(txs, { today: '2025-04-10' });
  ok('current streak: Sep 2024 - Mar 2025 = 7 months, this month still open', s.current === 7 && s.currentFrom === '2024-09' && s.currentTo === '2025-03' && s.open === true, s);
  ok('longest streak = the current one (7 > 4)', s.longest === 7 && s.longestFrom === '2024-09' && s.longestTo === '2025-03');
  ok('months with a buy: 13 of 16', s.buyMonths === 13 && s.totalMonths === 16, [s.buyMonths, s.totalMonths]);
  ok('this year: 3 of 4 months so far', s.yearBuyMonths === 3 && s.yearMonths === 4);
  const after = T.streaks(txs.concat([buy('2025-04-02', 10)]), { today: '2025-04-10' });
  ok('a buy this month extends the streak and closes "open"', after.current === 8 && after.currentTo === '2025-04' && after.open === false);
  const broken = T.streaks(txs, { today: '2025-05-20' });
  ok('a whole month without a buy (April) ends the current streak', broken.current === 0 && broken.longest === 7, broken);
  const sold = T.streaks([buy('2025-01-10', 100), sell('2025-02-10', 100), buy('2025-03-10', 100)], { today: '2025-03-20' });
  ok('a month with only a sale breaks the streak', sold.current === 1 && sold.longest === 1);
  const none = T.streaks([], { today: '2025-03-20' });
  ok('no buys: all zero', none.current === 0 && none.longest === 0 && none.buyMonths === 0);
  const opt = T.streaks([buy('2025-03-10', 1, { category: 'options' }), tx({ type: 'deposit', category: 'cashflow', amount: 5, date: '2025-03-01' })], { today: '2025-03-20' });
  ok('options and cash bookings are not buys', opt.buyMonths === 0);
  const tie = T.streaks(['2024-01', '2024-02', '2024-04', '2024-05'].map((m) => buy(m + '-01', 1)), { today: '2024-08-01' });
  ok('on a tie the longest streak is the most recent one', tie.longest === 2 && tie.longestFrom === '2024-04');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
