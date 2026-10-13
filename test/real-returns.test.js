// P5-2.9: real (inflation-adjusted) returns from the HICP (Eurostat, through
// the Worker). Every expected figure is computed by hand next to it.
// Run: node test/real-returns.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, e) => a != null && b != null && Math.abs(a - b) <= (e || 1e-9);

const RR = require('../real-returns.js');
const R = require('../returns-engine.js');

// 100 in Jan 2024, +0.2 % a month (exactly) up to Sep 2026
const months = [];
for (let i = 0; i < 33; i++) { const y = 2024 + Math.floor(i / 12), m = i % 12 + 1; months.push([y + '-' + String(m).padStart(2, '0'), 100 * Math.pow(1.002, i)]); }
const S = { geo: 'DE', base: '2015=100', months };

console.log('parse:');
{
  const p = RR.parse({ geo: 'DE', base: '2015=100', updated: '2026-10-02', months: [['2024-02', 101], ['2024-01', 100], ['bad', 1], ['2024-03', 'x']] });
  ok('months sorted, bad rows dropped', p && p.months.map((m) => m[0]).join() === '2024-01,2024-02' && p.geo === 'DE', p);
  ok('nothing usable: null', RR.parse({ months: [] }) === null && RR.parse(null) === null);
}

console.log('\nindex at a date:');
ok('the month of the date', near(RR.indexAt(S, '2024-03-31').v, 100 * 1.002 * 1.002) && RR.indexAt(S, '2024-03-31').carried === false);
ok('after the last published month: the last value, marked carried', near(RR.indexAt(S, '2026-10-13').v, months[32][1]) && RR.indexAt(S, '2026-10-13').carried === true && RR.indexAt(S, '2026-10-13').month === '2026-09');
ok('before the first month: null', RR.indexAt(S, '2023-12-31') === null);

console.log('\ninflation:');
{
  const inf = RR.inflation(S, '2024-01-15', '2025-01-20');
  ok('Jan 2024 -> Jan 2025: 12 steps of 0.2 %', near(inf.total, Math.pow(1.002, 12) - 1) && inf.from === '2024-01' && inf.to === '2025-01', inf);
  ok('per year over 371 days', near(inf.annualized, Math.pow(Math.pow(1.002, 12), 365.25 / 371) - 1), inf.annualized);
  ok('outside the series: null', RR.inflation(S, '2020-01-01', '2024-06-01') === null);
}

console.log('\nreal TWR:');
{
  const r = RR.realTwr(0.10, '2024-01-15', '2025-01-20', S);
  ok('(1 + 10 %) / (1 + inflation) - 1', near(r.real, 1.10 / Math.pow(1.002, 12) - 1), r);
  ok('real per year from the real growth over 371 days', near(r.realAnnualized, Math.pow(1.10 / Math.pow(1.002, 12), 365.25 / 371) - 1));
  ok('under a year: no yearly figure', RR.realTwr(0.05, '2024-01-15', '2024-06-15', S).realAnnualized === null);
  ok('a carried index month is reported', RR.realTwr(0.05, '2024-01-15', '2026-10-13', S).carried === true);
}

console.log('\nreal XIRR:');
{
  // -1000 on 2024-01-01, +1100 on 2025-01-01: each flow in money of the end month
  const flows = [{ date: '2024-01-01', amount: -1000 }, { date: '2025-01-01', amount: 1100 }];
  const real = RR.realXirr(flows, S, R.xirr);
  const want = R.xirr([{ date: '2024-01-01', amount: -1000 * Math.pow(1.002, 12) }, { date: '2025-01-01', amount: 1100 }]);
  ok('flows lifted to the money of the last flow, then XIRR', near(real, want, 1e-12) && real < R.xirr(flows), [real, want]);
  ok('a flow before the series: null (no guess)', RR.realXirr([{ date: '2020-01-01', amount: -1 }, { date: '2025-01-01', amount: 2 }], S, R.xirr) === null);
}

console.log('\nregions:');
ok('the euro area and its members are allowed', RR.GEOS.indexOf('EA') !== -1 && RR.GEOS.indexOf('DE') !== -1 && RR.GEOS.indexOf('XX') === -1);
ok('default region from the language: de -> DE, else EA', RR.defaultGeo('de') === 'DE' && RR.defaultGeo('en') === 'EA');

(async () => {
  console.log('\nloading through the Worker:');
  const mem = {};
  const storage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const calls = [];
  const answer = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const fetchOk = async (u) => { calls.push(u); return answer(200, { geo: 'AT', base: '2015=100', months: [['2026-08', 130], ['2026-09', 131]] }); };
  const a = await RR.load('https://w.example/', 'AT', { fetch: fetchOk, now: 1e12, storage });
  ok('fetched from the Worker route, kept on the device', a.state === 'ready' && a.series.months.length === 2 && calls[0] === 'https://w.example?action=hicp&geo=AT' && JSON.parse(mem[RR.CACHE_KEY]).AT.at === 1e12, [a.state, calls]);
  const b = await RR.load('https://w.example/', 'AT', { fetch: fetchOk, now: 1e12 + 1000, storage });
  ok('a second load within 7 days needs no request', b.state === 'ready' && calls.length === 1);
  const old = await RR.load('https://old.example', 'FR', { fetch: async () => answer(400, { error: 'Unknown action' }), now: 1e12, storage });
  ok('an older Worker without the route: "outdated"', old.state === 'outdated' && old.series === null);
  const smem = {};
  const s2 = { getItem: (k) => (k in smem ? smem[k] : null), setItem: (k, v) => { smem[k] = v; } };
  await RR.load('https://demo.example', 'DE', { fetch: async () => answer(200, { geo: 'DE', sample: true, months: [['2026-09', 120]] }), now: 1e12, storage: s2 });
  ok('sample data of the demo is not kept', !(RR.CACHE_KEY in smem));
  ok('an unknown region is not requested', (await RR.load('https://w.example', 'US', { fetch: fetchOk, storage })).state === 'error' && calls.length === 1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
