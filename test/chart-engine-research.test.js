// CH-2 regression: SMA, EMA, MACD and Bollinger moved from research.js to
// chart-engine.js. Research's output on a fixed series was saved BEFORE the
// move (fixtures/research-indicators.golden.json); Research and the engine
// must both reproduce it exactly (same numbers, same nulls).
// Run: node test/chart-engine-research.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
const golden = require('./fixtures/research-indicators.golden.json');
const v = require('./fixtures/research-series.js')();
const RS = require('../research.js');
const CE = require('../chart-engine.js');

// JSON turns NaN / Infinity into null; the indicators never produce them, so a
// JSON round trip of the live output is an exact comparison.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(lib, label) {
  ok(label + ': SMA 50 and 200 unchanged', same(lib.sma(v, 50), golden.sma50) && same(lib.sma(v, 200), golden.sma200));
  ok(label + ': EMA 20 and 12 unchanged', same(lib.ema(v, 20), golden.ema20) && same(lib.ema(v, 12), golden.ema12));
  ok(label + ': MACD (12, 26, 9) and (3, 6, 2) unchanged', same(lib.macd(v), golden.macd) && same(lib.macd(v, 3, 6, 2), golden.macd3));
  ok(label + ': Bollinger (20, 2) and (10, 1.5) unchanged', same(lib.bollinger(v, 20, 2), golden.bb) && same(lib.bollinger(v, 10, 1.5), golden.bb10));
}

console.log('chart-engine vs. Research (saved before the move):');
ok('the series has gaps, so skipping missing closes is covered', v.filter((x) => x === null).length >= 5);
check(RS, 'Research');
check(CE, 'chart engine');
ok('Research uses the engine (one implementation)', RS.sma === CE.sma && RS.ema === CE.ema && RS.macd === CE.macd && RS.bollinger === CE.bollinger);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
