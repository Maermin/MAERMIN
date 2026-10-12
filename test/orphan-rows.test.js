// Node harness for P5-1.2: rows that another device adds to a portfolio that
// was deleted here arrive by sync after migration v5 has run. They are moved
// to the Main Portfolio whenever they appear (rehomeOrphans), not only once.
// Run: node test/orphan-rows.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

globalThis.window = {};
globalThis.localStorage = {
  _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
};
const M = require('../migrations.js');

const portfolios = [{ id: 'default', name: 'Main' }, { id: 'pf_keep', name: 'Keep' }];
const rows = [
  { id: '1', symbol: 'AAPL', portfolioId: 'default' },
  { id: '2', symbol: 'BTC', portfolioId: 'pf_gone' },
  { id: '3', symbol: 'ETH' },
  { id: '4', symbol: 'SOL', portfolioId: 'pf_keep' },
  { id: '5', symbol: 'KO', portfolioId: 'pf_gone', source: 'dividend-auto' }
];

(function run() {
  console.log('orphan rows:');
  ok('rehomeOrphans is exported', typeof M.rehomeOrphans === 'function');

  const r = M.rehomeOrphans(rows, portfolios);
  const by = (id) => r.items.find((x) => x.id === id);
  ok('rows of a deleted portfolio move to Main', r.moved === 2 && by('2').portfolioId === 'default' && by('5').portfolioId === 'default');
  ok('moved rows remember the old portfolio (a trash restore moves them back)', by('2').movedFrom === 'pf_gone');
  ok('a moved auto-dividend loses its auto marker (like a portfolio delete)', by('5').source === 'dividend-auto-moved');
  ok('rows of known portfolios are untouched', by('1') === rows[0] && by('4') === rows[3]);
  ok('a row without portfolioId is untouched (it already shows in Main)', by('3') === rows[2]);
  ok('the input list is not changed', rows[1].portfolioId === 'pf_gone');

  const again = M.rehomeOrphans(r.items, portfolios);
  ok('running it again moves nothing and returns the same list', again.moved === 0 && again.items === r.items);

  ok('no saved portfolio list -> nothing moves', M.rehomeOrphans(rows, null).moved === 0 && M.rehomeOrphans(rows, []).moved === 0);
  ok('junk input -> empty result, no throw', M.rehomeOrphans(null, portfolios).moved === 0);

  // Migration v5 uses the same rule.
  localStorage.setItem('maermin_portfolios', JSON.stringify(portfolios));
  localStorage.setItem('transactions', JSON.stringify(rows));
  localStorage.setItem('maermin_savings_plans', JSON.stringify([{ id: 'p1', portfolioId: 'pf_gone' }, { id: 'p2', portfolioId: 'pf_keep' }]));
  M.setVersion(4);
  M.run();
  const txs = JSON.parse(localStorage.getItem('transactions'));
  const plans = JSON.parse(localStorage.getItem('maermin_savings_plans'));
  ok('v5 still re-homes transactions', txs.filter((x) => x.portfolioId === 'pf_gone').length === 0 && txs.find((x) => x.id === '2').movedFrom === 'pf_gone');
  ok('v5 still re-homes savings plans', plans[0].portfolioId === 'default' && plans[1].portfolioId === 'pf_keep');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
