// DCA analyzer (FINDINGS M-4 / cleanup B-3): purchases step by CALENDAR period
// on dated prices, never by array index; a history too short for the schedule
// is an error, not twelve buys piled onto the last price; quarterly exists.
// Run: node test/dca-analyzer.test.js
'use strict';
const E = require('../dca-analyzer-engine.js');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);
// Trading days only (Mon-Fri), price = 100 + day number, from 2025-01-02.
function tradingDays(n, from) {
  const out = []; let t = Date.parse((from || '2025-01-02') + 'T00:00:00Z');
  while (out.length < n) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) out.push({ timestamp: iso(t), price: 100 + out.length }); t += 864e5; }
  return out;
}

console.log('DCA on daily closes:');
const daily = tradingDays(300); // ~14 months of trading days
const r = E.compareDCAvsLumpSum(12000, daily, { dcaPeriods: 12, dcaFrequency: 'monthly' });
ok('monthly comparison on 300 trading days works', r && !r.error, JSON.stringify(r && r.error));
const dates = (r.dca && r.dca.purchases || []).map((p) => p.date);
ok('12 purchases', dates.length === 12, dates.join());
ok('one purchase per calendar month, Jan..Dec 2025', dates.map((d) => String(d).slice(0, 7)).join() === Array.from({ length: 12 }, (_, i) => '2025-' + String(i + 1).padStart(2, '0')).join(), dates.join());
ok('each buy is on the first trading day on or after the monthly date', dates[1] === '2025-02-03' && dates[0] === '2025-01-02', dates.slice(0, 3).join());
const idx = r.dca.purchases.map((p) => p.priceIndex);
ok('no two purchases share a price point (no pile-up at the end)', new Set(idx).size === 12 && idx[11] < daily.length - 1, idx.join());
ok('lump sum buys at the first point, both end at the last price', r.lumpSum.purchasePrice === daily[0].price && Math.abs(r.dca.finalValue - r.dca.shares * daily[daily.length - 1].price) < 1e-6);

console.log('frequencies:');
const w = E.compareDCAvsLumpSum(1200, daily, { dcaPeriods: 12, dcaFrequency: 'weekly' });
ok('weekly: buys 7 calendar days apart (or the next trading day)', !w.error && w.dca.purchases.every((p, i) => i === 0 || (Date.parse(p.date) - Date.parse(w.dca.purchases[i - 1].date)) / 864e5 >= 5), w.error || w.dca.purchases.map((p) => p.date).join());
const longDaily = tradingDays(900, '2023-01-02');
const q = E.compareDCAvsLumpSum(1200, longDaily, { dcaPeriods: 12, dcaFrequency: 'quarterly' });
ok('quarterly: buys three months apart (the UI offers it; it used to run monthly)', !q.error && q.dca.purchases[1].date.slice(0, 7) === '2023-04' && q.dca.purchases[4].date.slice(0, 7) === '2024-01', q.error || q.dca.purchases.map((p) => p.date).join());

console.log('too short:');
const short = tradingDays(150); // ~7 months
const s = E.compareDCAvsLumpSum(12000, short, { dcaPeriods: 12, dcaFrequency: 'monthly' });
ok('7 months of closes cannot hold 12 monthly buys: error, not buys at the last price', !!s.error, JSON.stringify(s).slice(0, 160));
ok('the error says how long the schedule and the history are', s.neededDays > 300 && s.haveDays > 150 && s.haveDays < 230, JSON.stringify({ n: s.neededDays, h: s.haveDays }));
ok('timestamps in ms work too', !E.compareDCAvsLumpSum(12000, daily.map((p) => ({ timestamp: Date.parse(p.timestamp + 'T00:00:00Z'), price: p.price })), {}).error);

console.log('undated prices (legacy):');
const plain = daily.map((p) => p.price);
const u = E.compareDCAvsLumpSum(12000, plain, { dcaPeriods: 12, dcaFrequency: 'monthly' });
ok('a plain number array still runs by index', !u.error && u.dca.purchases.length === 12);

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
