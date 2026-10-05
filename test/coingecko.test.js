// CoinGecko request gate (MaerminCoinGecko): one request at a time, spacing,
// priority, cooldown after a refusal (429 or a CORS/network error).
// Fake clock: sleep() advances virtual time instantly.
// Run: node test/coingecko.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

const CG = require('../coingecko.js');

function harness(answer) {
  let t = 0;
  const log = [];
  let inFlight = 0, maxInFlight = 0;
  const gate = CG.create({
    now: () => t,
    sleep: (ms) => { t += ms; return Promise.resolve(); },
    spacingMs: 1500, cooldownMs: 65000,
    fetch: async (url) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      log.push({ url, at: t });
      await Promise.resolve();
      inFlight--;
      return answer(url, log.length);
    }
  });
  return { gate, log, time: () => t, advance: (ms) => { t += ms; }, maxInFlight: () => maxInFlight };
}
const json = (o, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => o });
const settle = (p) => p.then((v) => ({ v }), (e) => ({ e }));

(async function run() {
  console.log('queue:');
  {
    const h = harness(() => json({ ok: 1 }));
    const r = await Promise.all(['a', 'b', 'c'].map((u) => h.gate.getJson(u)));
    ok('every request answered', r.every((x) => x.ok === 1));
    ok('one at a time', h.maxInFlight() === 1);
    ok('1.5 s apart', h.log[1].at - h.log[0].at >= 1500 && h.log[2].at - h.log[1].at >= 1500, h.log);
  }
  {
    const h = harness(() => json({}));
    const order = [];
    const ps = [h.gate.getJson('low1').then(() => order.push('low1')), h.gate.getJson('low2').then(() => order.push('low2')),
      h.gate.getJson('price', { priority: 'high' }).then(() => order.push('price'))];
    await Promise.all(ps);
    ok('a high-priority request (prices) overtakes queued low ones', order.indexOf('price') < order.indexOf('low2'), order);
  }

  console.log('rate limit:');
  {
    const h = harness((url, n) => (n === 1 ? json({}, 429) : json({ ok: 1 })));
    const first = await settle(h.gate.getJson('chart1'));
    ok('429 -> rejected as rate limited', first.e && first.e.rateLimited === true && first.e.status === 429);
    ok('cooling down afterwards', h.gate.coolingDown() === true);
    const low = await settle(h.gate.getJson('chart2'));
    ok('a low request during the pause is rejected at once, without a request', low.e && low.e.rateLimited && h.log.length === 1);
    const t0 = h.time();
    const high = await settle(h.gate.getJson('price', { priority: 'high' }));
    ok('the price request (high) is still tried during the pause, without waiting it out', high.v && high.v.ok === 1 && h.time() - t0 < 60000 && h.log.length === 2, { t: h.time() - t0, n: h.log.length });
    ok('... while chart requests keep being skipped', (await settle(h.gate.getJson('chart3'))).e.rateLimited === true && h.log.length === 2);
  }
  {
    // In the browser a 429 without CORS headers arrives as a TypeError.
    let n = 0, t = 0;
    const gate = CG.create({ now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); }, fetch: async () => { n++; throw new TypeError('Failed to fetch'); } });
    const r = await settle(gate.getJson('x'));
    ok('a CORS/network failure counts as the rate limit', r.e && r.e.rateLimited && gate.coolingDown());
    const queued = await Promise.all([settle(gate.getJson('y')), settle(gate.getJson('z'))]);
    ok('... and the queued low requests are dropped without being sent', queued.every((q) => q.e && q.e.rateLimited) && n === 1, n);
  }
  {
    const h = harness(() => json({ error: 'coin not found' }, 404));
    const r = await settle(h.gate.getJson('unknown-coin'));
    ok('a 404 is passed on as an error, no pause', r.e && r.e.status === 404 && !r.e.rateLimited && !h.gate.coolingDown());
  }
  {
    const h = harness(() => json({}));
    h.gate.getJson('a'); h.gate.getJson('b');
    ok('pending() counts queued requests', h.gate.pending() >= 1);
  }

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
