// Node harness for the Corporate-Action engine. Pure math, no browser.
// Run: node test/corporate-actions.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function near(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const CA = require('../corporate-actions.js');
const M = require('../metrics.js');

(function run() {
  console.log('corporate-actions:');

  // ---- normalize: drops malformed, sorts by date, dedups (symbol,date) ----
  const norm = CA.normalize({ actions: [
    { kind: 'split', category: 'stocks', symbol: 'NVDA', date: '2024-06-10', num: 10, den: 1 },
    { symbol: 'BAD', date: 'not-a-date', num: 2, den: 1 },        // bad date -> dropped
    { symbol: 'ZERO', date: '2024-01-01', num: 0, den: 1 },        // num<=0 -> dropped
    { symbol: '', date: '2024-01-01', num: 2, den: 1 },            // empty symbol -> dropped
    { category: 'stocks', symbol: 'AAPL', date: '2020-08-31', num: 4, den: 1 },
    { category: 'stocks', symbol: 'NVDA', date: '2024-06-10', num: 4, den: 1 } // dup (NVDA,date) -> overwrites first
  ]});
  ok('normalize drops malformed actions', norm.actions.length === 2);
  ok('normalize sorts by date', norm.actions[0].symbol === 'AAPL' && norm.actions[0].date === '2020-08-31');
  ok('normalize dedups (symbol,date), last wins', (function () {
    const nv = norm.actions.find(a => a.symbol === 'NVDA');
    return nv && nv.num === 4;
  })());
  ok('normalize defaults source to manual', norm.actions[0].source === 'manual');

  // ---- adjust: forward 10:1 scales a pre-split buy, cash amount unchanged ----
  const split = { version: 1, actions: [
    { kind: 'split', category: 'stocks', symbol: 'NVDA', date: '2024-06-10', num: 10, den: 1, source: 'manual', note: '' }
  ]};
  const preBuy = { type: 'buy', category: 'stocks', symbol: 'NVDA', date: '2024-01-02', quantity: 5, price: 500 };
  const adj = CA.adjust([preBuy], split);
  ok('adjust scales pre-split qty x10', near(adj[0].quantity, 50));
  ok('adjust scales pre-split price /10', near(adj[0].price, 50));
  ok('adjust keeps cash amount (qty*price) constant',
    near(adj[0].quantity * adj[0].price, preBuy.quantity * preBuy.price));

  // ---- adjust: post-split transaction is left untouched ----
  const postBuy = { type: 'buy', category: 'stocks', symbol: 'NVDA', date: '2024-09-01', quantity: 3, price: 120 };
  const adj2 = CA.adjust([postBuy], split);
  ok('adjust leaves post-split tx untouched', adj2[0].quantity === 3 && adj2[0].price === 120);

  // ---- reverse split (1:10) scales the other way ----
  const rev = { version: 1, actions: [
    { kind: 'split', category: 'stocks', symbol: 'XYZ', date: '2023-03-01', num: 1, den: 10, source: 'manual', note: '' }
  ]};
  const revBuy = { type: 'buy', category: 'stocks', symbol: 'XYZ', date: '2022-01-01', quantity: 100, price: 2 };
  const adjRev = CA.adjust([revBuy], rev);
  ok('reverse split scales qty down', near(adjRev[0].quantity, 10));
  ok('reverse split scales price up', near(adjRev[0].price, 20));
  ok('reverse split keeps cash amount constant', near(adjRev[0].quantity * adjRev[0].price, 200));

  // ---- two compounding splits on one symbol apply in date order ----
  const two = { version: 1, actions: [
    { category: 'stocks', symbol: 'CMP', date: '2021-01-01', num: 2, den: 1 },
    { category: 'stocks', symbol: 'CMP', date: '2023-01-01', num: 3, den: 1 }
  ]};
  // a buy before BOTH splits gets the net 2*3 = 6x factor
  const beforeBoth = CA.adjust([{ type: 'buy', category: 'stocks', symbol: 'CMP', date: '2020-06-01', quantity: 4, price: 600 }], two);
  ok('two splits compound to net 6x qty', near(beforeBoth[0].quantity, 24));
  ok('two splits compound to net /6 price', near(beforeBoth[0].price, 100));
  // a buy BETWEEN the two splits only gets the second (3x)
  const between = CA.adjust([{ type: 'buy', category: 'stocks', symbol: 'CMP', date: '2022-06-01', quantity: 4, price: 600 }], two);
  ok('a between-splits buy gets only the later factor', near(between[0].quantity, 12) && near(between[0].price, 200));

  // ---- identity when no actions: the SAME array reference is returned ----
  const empty = { version: 1, actions: [] };
  const arr = [preBuy, postBuy];
  ok('adjust with no actions is identity (same reference)', CA.adjust(arr, empty) === arr);

  // ---- immutability: input array + its objects are not mutated ----
  const input = [{ type: 'buy', category: 'stocks', symbol: 'NVDA', date: '2024-01-02', quantity: 5, price: 500 }];
  const out = CA.adjust(input, split);
  ok('adjust does not mutate input array', input[0].quantity === 5 && input[0].price === 500 && out !== input);

  // ---- a non buy/sell tx (e.g. dividend) passes through untouched ----
  const div = { type: 'dividend', category: 'stocks', symbol: 'NVDA', date: '2024-01-01', amount: 10 };
  ok('adjust passes non buy/sell tx through unchanged', CA.adjust([div], split)[0] === div);

  // ---- cost basis / FIFO realised P&L unchanged across a split ----
  // Buy 10 @ 100 (cost 1000), 10:1 split, then sell 50 @ 12 (proceeds 600).
  // Without the split the same economic trade is buy 10@100, sell 5@120.
  // FIFO open-lot cost basis after the buy must be identical either way.
  const raw = [
    { type: 'buy', category: 'stocks', symbol: 'SPL', date: '2024-01-01', quantity: 10, price: 100 }
  ];
  const adjustedRaw = CA.adjust(raw, { version: 1, actions: [
    { category: 'stocks', symbol: 'SPL', date: '2024-06-01', num: 10, den: 1 }
  ]});
  const lotsPlain = M.matchFifoLots(raw, 1);
  const lotsSplit = M.matchFifoLots(adjustedRaw, 1);
  ok('FIFO total cost basis is split-invariant', near(lotsPlain.totalCostEUR, lotsSplit.totalCostEUR));
  ok('FIFO share count scales with the split', near(lotsSplit.amount, 100) && near(lotsPlain.amount, 10));
  ok('FIFO per-share cost scales /10 across split',
    near(lotsSplit.totalCostEUR / lotsSplit.amount, (lotsPlain.totalCostEUR / lotsPlain.amount) / 10));

  // ---- ratioFromYahoo maps a sample Yahoo split event ----
  const r1 = CA.ratioFromYahoo({ date: '2024-06-10', numerator: 10, denominator: 1 });
  ok('ratioFromYahoo maps numerator/denominator', r1 && r1.num === 10 && r1.den === 1);
  const r2 = CA.ratioFromYahoo({ splitRatio: '1:10' });
  ok('ratioFromYahoo parses a splitRatio string', r2 && r2.num === 1 && r2.den === 10);
  ok('ratioFromYahoo rejects junk', CA.ratioFromYahoo({ numerator: 0, denominator: 1 }) === null);

  // ---- detectForSymbol degrades gracefully against an old worker ----
  (async function () {
    const oldWorker = () => Promise.resolve({ symbol: 'NVDA', prices: [] }); // no splits field
    const none = await CA.detectForSymbol('NVDA', 'stocks', null, oldWorker);
    ok('detectForSymbol returns [] for a pre-split worker', Array.isArray(none) && none.length === 0);

    const newWorker = () => Promise.resolve({ symbol: 'NVDA', prices: [], splits: [
      { date: '2024-06-10', numerator: 10, denominator: 1 }
    ]});
    const found = await CA.detectForSymbol('NVDA', 'stocks', null, newWorker);
    ok('detectForSymbol surfaces a detected split', found.length === 1 && found[0].num === 10 && found[0].source === 'auto');

    const failWorker = () => Promise.reject(new Error('offline'));
    const offline = await CA.detectForSymbol('NVDA', 'stocks', null, failWorker);
    ok('detectForSymbol swallows a network error -> []', Array.isArray(offline) && offline.length === 0);

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  })();
})();
