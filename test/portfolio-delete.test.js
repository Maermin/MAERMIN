// Node harness for P1-2 (FINDINGS.md C-4): deleting a portfolio moves its
// transactions and savings plans to the Main Portfolio, and a one-time
// migration re-homes rows left orphaned by older builds.
// Run: node test/portfolio-delete.test.js
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
const D = require('../dividend-executor.js');
const Metrics = require('../metrics.js');

const txs = [
  { id: '1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 5, price: 100, currency: 'EUR', date: '2026-01-02', portfolioId: 'default' },
  { id: '2', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 3, price: 100, currency: 'EUR', date: '2026-01-02', portfolioId: 'pf_tr' },
  { id: '3', type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 100, currency: 'EUR', date: '2026-01-02', portfolioId: 'pf_tr' },
  { id: '4', type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 100, currency: 'EUR', date: '2026-01-02' },
  { id: '5', type: 'buy', category: 'crypto', symbol: 'SOL', quantity: 1, price: 100, currency: 'EUR', date: '2026-01-02', portfolioId: 'pf_keep' }
];
// Both portfolios auto-booked the same AAPL payout for their own shares.
const autoDefault = { id: 'd1', type: 'dividend', category: 'stocks', symbol: 'AAPL', quantity: 5, price: 0.26, currency: 'USD', date: '2026-08-14', portfolioId: 'default', source: 'dividend-auto', divDate: '2026-08-14', auto: true };
const autoTr = Object.assign({}, autoDefault, { id: 'd2', quantity: 3, portfolioId: 'pf_tr' });

(function run() {
  console.log('portfolio-delete:');

  // ---- C-4 repro: before the fix, nothing rewrote portfolioId ----------------
  const visibleIn = (list, pid) => list.filter(t => (t.portfolioId || 'default') === pid);

  const r = M.movePortfolioRows(txs.concat([autoDefault, autoTr]), ['pf_tr'], 'default');
  ok('C-4: the deleted portfolio\'s transactions move to default', visibleIn(r.items, 'pf_tr').length === 0 && r.moved === 3);
  ok('C-4: they are visible (and editable) in the Main Portfolio', visibleIn(r.items, 'default').length === 6);
  ok('C-4: other portfolios are untouched', r.items.find(t => t.id === '5').portfolioId === 'pf_keep');
  ok('C-4: rows without a portfolio are untouched', r.items.find(t => t.id === '4').portfolioId === undefined);
  ok('C-4: a moved row remembers where it came from', r.items.find(t => t.id === '2').movedFrom === 'pf_tr');
  ok('C-4: nothing is lost', r.items.length === txs.length + 2);

  // A moved auto-dividend must not collapse into default's own auto-dividend.
  const dd = D.dedupeBooked(r.items);
  ok('C-4: both portfolios\' dividends survive the post-sync dedupe', dd.removed === 0 &&
    dd.transactions.filter(t => t.type === 'dividend').reduce((s, t) => s + t.quantity * t.price, 0) === 8 * 0.26);
  ok('C-4: the moved dividend still counts as booked (no re-booking)',
    D.pending([{ symbol: 'AAPL', date: '2026-08-14', perShare: 0.26, shares: 8, amount: 2.08, currency: 'USD', past: true }], r.items, 'default').length === 0);

  // Portfolio totals add up again after the delete.
  const prices = { AAPL: 100, BTC: 100, ETH: 100, SOL: 100 };
  const portfolios = [{ id: 'default', name: 'Main' }, { id: 'pf_keep', name: 'Keep' }];
  const totals = Metrics.computePortfolioTotals(portfolios, r.items, prices, { exchangeRate: 1 });
  const sumCards = totals.reduce((s, t) => s + t.value, 0);
  const allTotal = Metrics.computeStats(Metrics.buildPositions(r.items, { exchangeRate: 1 }), prices).totalValue;
  ok('C-4: the portfolio cards add up to the "All portfolios" total', allTotal > 0 && Math.abs(sumCards - allTotal) < 1e-6);
  const before = Metrics.computePortfolioTotals(portfolios, txs, prices, { exchangeRate: 1 }).reduce((s, t) => s + t.value, 0);
  ok('C-4 repro: without the move the cards miss the orphaned value', before < allTotal);

  // Savings plans of the deleted portfolio follow it, so future executions land in default.
  const plans = [{ id: 'p1', symbol: 'VWCE.DE', portfolioId: 'pf_tr' }, { id: 'p2', symbol: 'BTC', portfolioId: 'pf_keep' }];
  const rp = M.movePortfolioRows(plans, ['pf_tr'], 'default');
  ok('C-4: savings plans of the deleted portfolio move to default', rp.items[0].portfolioId === 'default' && rp.items[1].portfolioId === 'pf_keep');

  ok('nothing to move -> same array back', M.movePortfolioRows(txs, ['nope'], 'default').items === txs);

  // ---- migration: re-home rows orphaned by older builds ----------------------
  console.log('migration v5:');
  localStorage._d = {};
  localStorage.setItem('maermin_schema_version', '4');
  localStorage.setItem('maermin_portfolios', JSON.stringify([{ id: 'default', name: 'Main' }, { id: 'pf_keep', name: 'Keep' }]));
  localStorage.setItem('transactions', JSON.stringify(txs.concat([autoDefault, autoTr])));
  localStorage.setItem('maermin_savings_plans', JSON.stringify(plans));
  M.run();
  const after = JSON.parse(localStorage.getItem('transactions'));
  ok('v5: orphaned transactions are re-homed to default', visibleIn(after, 'pf_tr').length === 0 && after.filter(t => t.movedFrom === 'pf_tr').length === 3);
  ok('v5: transactions of existing portfolios stay', after.find(t => t.id === '5').portfolioId === 'pf_keep');
  ok('v5: orphaned savings plans are re-homed', JSON.parse(localStorage.getItem('maermin_savings_plans'))[0].portfolioId === 'default');
  ok('v5: no transaction is lost', after.length === txs.length + 2);
  ok('v5: version advances', M.getVersion() === M.LATEST && M.LATEST >= 5);

  // Without a saved portfolio list the migration cannot tell orphans apart: no-op.
  localStorage._d = {};
  localStorage.setItem('maermin_schema_version', '4');
  localStorage.setItem('transactions', JSON.stringify(txs));
  M.run();
  ok('v5: no saved portfolio list -> transactions untouched', localStorage.getItem('transactions') === JSON.stringify(txs));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
