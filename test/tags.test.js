// Node harness for the Smart Tags engine. Pure data layer, no browser.
// Run: node test/tags.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const T = require('../tags.js');

(function run() {
  console.log('tags:');

  // ---- normalize: dedup symbols, uppercase, default colour ----
  let st = T.normalize({ tags: {
    'High Conviction': { symbols: ['btc', 'BTC', 'eth'] },
    '  ': { symbols: ['X'] },                 // empty name dropped
    'Dividend': { color: '#123456', symbols: ['ko'] }
  }});
  ok('normalize drops empty-name tags', !('  ' in st.tags) && Object.keys(st.tags).length === 2);
  ok('normalize uppercases + dedups symbols', st.tags['High Conviction'].symbols.join(',') === 'BTC,ETH');
  ok('normalize keeps explicit colour', st.tags['Dividend'].color === '#123456');
  ok('normalize assigns a default colour', /^#/.test(st.tags['High Conviction'].color));

  // ---- add / assign / case-insensitive uniqueness ----
  st = T.addTag({ version: 1, tags: {} }, 'Speculative', { color: '#ef4444' });
  st = T.assign(st, 'speculative', 'doge');   // different case -> same tag
  ok('assign is case-insensitive on tag name', T.listTags(st).length === 1);
  ok('assign uppercases symbol', T.tagsForSymbol(st, 'DOGE')[0] === 'Speculative');

  // ---- assign to a brand-new tag auto-creates it ----
  st = T.assign(st, 'ESG', 'nvda');
  ok('assign auto-creates a missing tag', T.listTags(st).length === 2);

  // ---- unassign ----
  st = T.unassign(st, 'ESG', 'NVDA');
  ok('unassign removes the symbol', T.tagsForSymbol(st, 'NVDA').length === 0);

  // ---- rename, with collision guard ----
  let r = T.renameTag(st, 'ESG', 'Green');
  ok('rename moves the tag', !T.listTags(r).some(t => t.name === 'ESG') && T.listTags(r).some(t => t.name === 'Green'));
  let collide = T.addTag(r, 'Speculative');
  collide = T.renameTag(collide, 'Green', 'speculative'); // collides -> no-op
  ok('rename refuses a name collision', T.listTags(collide).some(t => t.name === 'Green'));

  // ---- aggregate: value + weight across priced positions ----
  let agg = T.normalize({ tags: {
    'Crypto Bet': { symbols: ['BTC', 'ETH'] },
    'Income':     { symbols: ['KO'] }
  }});
  const positions = [
    { symbol: 'BTC', valueEUR: 600 },
    { symbol: 'ETH', valueEUR: 200 },
    { symbol: 'KO',  valueEUR: 100 },
    { symbol: 'AAPL', valueEUR: 100 }   // untagged -> counts toward total only
  ];
  const a = T.aggregate(agg, positions);
  ok('aggregate total spans all positions', a.total === 1000);
  ok('aggregate sums tagged value', a.rows[0].name === 'Crypto Bet' && a.rows[0].value === 800);
  ok('aggregate weight is share of total', Math.abs(a.rows[0].weightPct - 80) < 1e-9);
  ok('aggregate counts matched symbols', a.rows[0].matched === 2);

  // ---- pickColor is deterministic ----
  ok('pickColor stable for a name', T.pickColor('Income') === T.pickColor('income'));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
