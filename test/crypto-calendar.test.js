// Node harness for P5-4.5, the crypto tax-free calendar: per coin the amount
// that is tax-free today and in 1, 3, 6, 9 and 12 months (sec. 23 EStG, one
// year), from the FIFO ledger's open lots.
// Run: node test/crypto-calendar.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

const CC = require('../crypto-calendar.js');
const C = (o) => Object.assign({ category: 'crypto', currency: 'EUR' }, o);

(function main() {
  console.log('crypto-calendar:');

  ok('addMonths clamps to the month end (31 Jan + 1 = 28 Feb)', CC.addMonths('2026-01-31', 1) === '2026-02-28', CC.addMonths('2026-01-31', 1));
  ok('addMonths across the year (15 Nov + 3 = 15 Feb)', CC.addMonths('2025-11-15', 3) === '2026-02-15');

  // BTC: 0.2 from 2024-06-01 (free since 2025-06-02), 0.5 from 2025-03-10
  // (free from 2026-03-11), 0.3 from 2025-11-20 (free from 2026-11-21).
  const btc = [
    C({ type: 'buy', symbol: 'BTC', quantity: 0.5, price: 60000, date: '2025-03-10' }),
    C({ type: 'buy', symbol: 'BTC', quantity: 0.3, price: 90000, date: '2025-11-20' }),
    C({ type: 'buy', symbol: 'BTC', quantity: 0.2, price: 50000, date: '2024-06-01' })
  ];
  let r = CC.calendar(btc, { today: '2026-01-15', prices: { BTC: 80000 } });
  const c = r.coins[0];
  ok('horizons: today, 1, 3, 6, 9, 12 months', r.horizons.map((h) => h.months).join() === '0,1,3,6,9,12' && r.horizons[5].date === '2027-01-15', r.horizons);
  ok('held 1.0 BTC', c.symbol === 'BTC' && approx(c.held, 1), c);
  const q = c.buckets.map((b) => Math.round(b.quantity * 10) / 10).join();
  ok('tax-free quantity: 0.2 today and in 1 month, 0.7 from 3 to 9 months, 1.0 in 12 months', q === '0.2,0.2,0.7,0.7,0.7,1', q);
  ok('value at today\'s price (0.7 x 80,000 = 56,000 in 3 months)', approx(c.buckets[2].value, 56000));
  ok('gain of the free lots (0.2 x 30,000 = 6,000 today)', approx(c.buckets[0].gain, 6000) && approx(c.buckets[2].gain, 6000 + 0.5 * 20000), c.buckets[2]);
  ok('next: 0.5 BTC on 2026-03-11', c.next && c.next.date === '2026-03-11' && approx(c.next.quantity, 0.5), c.next);
  ok('lots with their tax-free date', c.lots.length === 3 && c.lots[0].acquisitionDate === '2024-06-01' && c.lots[0].free === true && c.lots[2].freeOn === '2026-11-21', c.lots);

  // A FIFO sale takes the oldest lots first.
  r = CC.calendar(btc.concat([C({ type: 'sell', symbol: 'BTC', quantity: 0.25, price: 85000, date: '2025-12-01' })]), { today: '2026-01-15', prices: { BTC: 80000 } });
  const q2 = r.coins[0].buckets.map((b) => Math.round(b.quantity * 100) / 100).join();
  ok('after a FIFO sale of 0.25: 0 today, 0.45 from 3 months, 0.75 in 12 months', q2 === '0,0,0.45,0.45,0.45,0.75', q2);

  // Two coins: totals per horizon.
  const two = btc.concat([C({ type: 'buy', symbol: 'ETH', quantity: 2, price: 2000, date: '2025-02-01' })]);
  r = CC.calendar(two, { today: '2026-01-15', prices: { BTC: 80000, ETH: 3000 } });
  ok('two coins, sorted by value', r.coins.length === 2 && r.coins[0].symbol === 'BTC' && r.coins[1].symbol === 'ETH');
  ok('ETH is free from 2026-02-02: in the 1-month column', approx(r.coins[1].buckets[0].quantity, 0) && approx(r.coins[1].buckets[1].quantity, 2));
  ok('totals per horizon (1 month: 0.2 BTC + 2 ETH = 22,000)', approx(r.totals[1].value, 0.2 * 80000 + 2 * 3000) && approx(r.totals[0].value, 16000), r.totals);

  // A coin without a price: quantities, no value.
  r = CC.calendar(two, { today: '2026-01-15', prices: { BTC: 80000 } });
  const eth = r.coins.find((x) => x.symbol === 'ETH');
  ok('no price: quantities shown, value null, left out of the totals', eth.price === null && eth.buckets[1].value === null && approx(eth.buckets[1].quantity, 2) && approx(r.totals[1].value, 16000), eth.buckets[1]);
  ok('prices through a function (priceEUR)', approx(CC.calendar(btc, { today: '2026-01-15', priceEUR: (s) => (s === 'BTC' ? 70000 : null) }).coins[0].buckets[0].value, 14000));

  // Exemption off, other categories, sold-out coins.
  r = CC.calendar(btc, { today: '2026-01-15', prices: { BTC: 80000 }, cryptoExemption: false });
  ok('one-year rule off in the settings: nothing tax-free', r.exemption === false && r.coins[0].buckets.every((b) => b.quantity === 0) && r.coins[0].next === null);
  r = CC.calendar([{ type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 1, price: 100, currency: 'EUR', date: '2024-01-01' }], { today: '2026-01-15' });
  ok('shares are not in the calendar', r.coins.length === 0);
  r = CC.calendar([C({ type: 'buy', symbol: 'SOL', quantity: 5, price: 100, date: '2025-01-01' }), C({ type: 'sell', symbol: 'SOL', quantity: 5, price: 150, date: '2025-06-01' })], { today: '2026-01-15' });
  ok('a sold-out coin is not listed', r.coins.length === 0);

  // A lot bought on 29 February.
  r = CC.calendar([C({ type: 'buy', symbol: 'ADA', quantity: 100, price: 1, date: '2024-02-29' })], { today: '2025-02-28', prices: { ADA: 2 } });
  ok('bought on 29 Feb 2024: free from 1 Mar 2025, so in the 1-month column', approx(r.coins[0].buckets[0].quantity, 0) && approx(r.coins[0].buckets[1].quantity, 100) && r.coins[0].next.date === '2025-03-01', r.coins[0].next);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
