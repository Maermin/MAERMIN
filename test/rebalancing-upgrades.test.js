// Node harness for the P4-4 rebalancing upgrades in rebalancing-planner.js:
// tolerance band per target, invest-only (cash-flow) mode, never-sell holdings.
// Run: node test/rebalancing-upgrades.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''))); }
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-9);
const R = require('../rebalancing-planner.js');
const st = (targets) => ({ version: 1, basis: 'category', targets });
const row = (p, k) => p.rows.find(r => r.key === k);

console.log('tolerance band:');
ok('relative share of the target: 25 % of 40 % = ±10 pp', R.bandPp(40, { rel: 0.25, abs: 2 }) === 10);
ok('absolute floor: 25 % of 4 % = 1 pp, floor 2 pp → ±2 pp', R.bandPp(4, { rel: 0.25, abs: 2 }) === 2);
ok('bad input falls back to ±5 pp', R.bandPp(40, null) === 5 && R.bandPp(40, { rel: 'x', abs: -1 }) === 5);
{
  // 46 / 54 against 40 / 60: 6 pp drift each
  const actual = [{ key: 'crypto', value: 460 }, { key: 'stocks', value: 540 }];
  const p1 = R.plan(st({ crypto: 40, stocks: 60 }), actual, { defaultBand: { rel: 0, abs: 5 } });
  ok('6 pp drift outside a ±5 pp band: sell 60, buy 60', row(p1, 'crypto').action === 'sell' && near(row(p1, 'crypto').deltaValue, -60) && near(row(p1, 'stocks').deltaValue, 60));
  const p2 = R.plan(st({ crypto: 40, stocks: 60 }), actual, { defaultBand: { rel: 0, abs: 5 }, bands: { crypto: { rel: 0.25, abs: 2 } }, });
  ok('own band for crypto (±10 pp) holds it; stocks has nothing to fund its buy', row(p2, 'crypto').action === 'hold' && row(p2, 'crypto').bandPp === 10 && row(p2, 'stocks').action === 'hold' && p2.summary.toBuy === 0);
  ok('balanced only when every class is within its own band (stocks is 6 pp off its ±5 pp)', p2.summary.balanced === false && p1.summary.balanced === false
    && R.plan(st({ crypto: 40, stocks: 60 }), actual, { defaultBand: { rel: 0, abs: 7 } }).summary.balanced === true);
  const legacy = R.plan(st({ crypto: 40, stocks: 60 }), actual, { band: 0 });
  ok('legacy opts.band still overrides every band', row(legacy, 'crypto').bandPp === 0 && legacy.band === 0 && row(legacy, 'crypto').action === 'sell');
  const def = R.plan(st({ crypto: 40, stocks: 60 }), actual);
  ok('default without options: ±5 pp, as before', def.band === 5 && row(def, 'crypto').bandPp === 5);
}

console.log('buy and sell with new money:');
{
  const actual = [{ key: 'a', value: 700 }, { key: 'b', value: 300 }];
  const p = R.plan(st({ a: 50, b: 50 }), actual, { defaultBand: { rel: 0, abs: 1 }, contribution: 200 });
  ok('targets apply to value + new money (1,200 → 600 / 600)', near(row(p, 'a').targetValue, 600) && near(row(p, 'b').targetValue, 600));
  ok('sell 100 of a, buy 300 of b; buys = sales + new money', near(row(p, 'a').deltaValue, -100) && near(row(p, 'b').deltaValue, 300) && near(p.summary.toBuy, p.summary.toSell + 200));
  const inBand = R.plan(st({ a: 50, b: 50 }), [{ key: 'a', value: 510 }, { key: 'b', value: 490 }], { defaultBand: { rel: 0, abs: 5 }, contribution: 100 });
  ok('all classes within band: new money is reported as uninvested', inBand.summary.toBuy === 0 && near(inBand.summary.cashLeft, 100));
}

console.log('never-sell holdings:');
{
  const actual = [{ key: 'crypto', value: 800, sellable: 0 }, { key: 'stocks', value: 200 }];
  const p = R.plan(st({ crypto: 50, stocks: 50 }), actual, { defaultBand: { rel: 0, abs: 1 } });
  ok('nothing sellable: no sale, the needed 300 is reported as blocked', row(p, 'crypto').action === 'hold' && near(row(p, 'crypto').blockedSell, 300) && near(p.summary.blocked, 300));
  ok('no money for the buy: nothing bought', row(p, 'stocks').action === 'hold' && p.summary.toBuy === 0);
  const part = R.plan(st({ crypto: 50, stocks: 50 }), [{ key: 'crypto', value: 800, sellable: 120 }, { key: 'stocks', value: 200 }], { defaultBand: { rel: 0, abs: 1 } });
  ok('partly sellable: sell 120, blocked 180, buy only what the sale pays (120)', near(row(part, 'crypto').deltaValue, -120) && near(row(part, 'crypto').blockedSell, 180) && near(row(part, 'stocks').deltaValue, 120));
  const withCash = R.plan(st({ crypto: 50, stocks: 50 }), [{ key: 'crypto', value: 800, sellable: 0 }, { key: 'stocks', value: 200 }], { defaultBand: { rel: 0, abs: 1 }, contribution: 100 });
  ok('new money still funds the buy when nothing may be sold', near(row(withCash, 'stocks').deltaValue, 100) && withCash.summary.toSell === 0);
  ok('sellable above the value is capped at the value', near(row(R.plan(st({ a: 0, b: 100 }), [{ key: 'a', value: 100, sellable: 500 }, { key: 'b', value: 0 }], { band: 0 }), 'a').deltaValue, -100));
}

console.log('invest only (cash-flow mode):');
{
  const actual = [{ key: 'a', value: 600 }, { key: 'b', value: 300 }, { key: 'c', value: 100 }];
  const T = st({ a: 40, b: 40, c: 20 });
  const small = R.plan(T, actual, { mode: 'cashflow', contribution: 100 });
  // after 1,100: targets 440 / 440 / 220 → gaps b 140, c 120 (a is above target)
  ok('nothing is sold', small.rows.every(r => r.deltaValue >= 0) && small.summary.toSell === 0);
  ok('money goes to the gaps in proportion (b 140 : c 120)', near(row(small, 'b').deltaValue, 100 * 140 / 260) && near(row(small, 'c').deltaValue, 100 * 120 / 260) && row(small, 'a').action === 'hold');
  ok('all of the contribution is planned', near(small.summary.toBuy, 100) && small.summary.cashLeft === 0);
  const big = R.plan(T, actual, { mode: 'cashflow', contribution: 1000 });
  // after 2,000: targets 800 / 800 / 400 → gaps 200 / 500 / 300 = 1,000 exactly
  ok('a contribution that closes every gap lands exactly on target', near(row(big, 'a').deltaValue, 200) && near(row(big, 'b').deltaValue, 500) && near(row(big, 'c').deltaValue, 300));
  const huge = R.plan(T, actual, { mode: 'cashflow', contribution: 2000 });
  ok('more than the gaps: the rest is spread by target weight', near(huge.summary.toBuy, 2000) && near(600 + row(huge, 'a').deltaValue, 0.4 * 3000) && near(100 + row(huge, 'c').deltaValue, 0.2 * 3000));
  const none = R.plan(T, actual, { mode: 'cashflow', contribution: 0 });
  ok('no contribution: no action', none.rows.every(r => r.action === 'hold') && none.mode === 'cashflow');
  ok('never-sell does not matter without sales', near(R.plan(T, actual.map(r => ({ ...r, sellable: 0 })), { mode: 'cashflow', contribution: 100 }).summary.toBuy, 100));
}

console.log('money is never created:');
{
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const rnd = (n) => Math.floor(((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1 * 1000);
    const actual = ['a', 'b', 'c', 'd'].map((k, j) => ({ key: k, value: rnd(j), sellable: rnd(j + 7) % 2 ? rnd(j) : rnd(j + 3) / 3 }));
    const t = st({ a: 10 + rnd(1) % 30, b: 20, c: 30, d: 0 }); t.targets.d = Math.max(0, 100 - t.targets.a - 50);
    const C = rnd(11) % 3 ? rnd(12) : 0;
    const p = R.plan(t, actual, { defaultBand: { rel: (rnd(5) % 40) / 100, abs: rnd(6) % 6 }, contribution: C, mode: rnd(9) % 2 ? 'full' : 'cashflow' });
    const over = p.summary.toBuy - (C + p.summary.toSell);
    if (over > worst) worst = over;
    p.rows.forEach(r => { const a = actual.find(x => x.key === r.key); if (a && -r.deltaValue > Math.min(a.sellable, a.value) + 1e-6) worst = Math.max(worst, 1e9); });
  }
  ok('300 random books: buys ≤ new money + sales, sales ≤ sellable', worst < 1e-6, worst);
}

console.log('settings (maermin_rebalance_prefs):');
{
  const p = R.normalizePrefs({ mode: 'x', defaultBand: { rel: 3, abs: -2 }, bands: { crypto: { rel: 0.2, abs: 1 }, '': {} }, noSell: ['btc', 'BTC', ' aapl ', '', null] });
  ok('defaults: buy and sell, ±5 pp', R.normalizePrefs(null).mode === 'full' && R.normalizePrefs(null).defaultBand.abs === 5 && R.normalizePrefs(null).defaultBand.rel === 0);
  ok('unknown mode → full; band clamped (rel ≤ 100 %), bad abs → 5', p.mode === 'full' && p.defaultBand.rel === 1 && p.defaultBand.abs === 5);
  ok('never-sell list upper-cased, deduped, sorted', p.noSell.join() === 'AAPL,BTC');
  ok('bands keep valid keys only', Object.keys(p.bands).join() === 'crypto' && p.bands.crypto.rel === 0.2);
  ok('isNoSell is case-insensitive', R.isNoSell(p, 'aapl') && !R.isNoSell(p, 'ETH'));
  ok('cash-flow mode survives a round trip', R.normalizePrefs(JSON.stringify({ mode: 'cashflow' })).mode === 'cashflow');
  const B = require('../backup-engine.js');
  ok('the key is in the full backup', B.KEYS.indexOf(R.PREFS_KEY) !== -1);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
