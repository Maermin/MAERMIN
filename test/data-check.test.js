// Node harness for the Data check codes and actions (P4-6).
// Run: node test/data-check.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''))); }

const DC = require('../data-check.js');
const L = require('../ledger.js');

console.log('codes are stable:');
ok('the code list is exactly the documented one', JSON.stringify(DC.CODES) === JSON.stringify({
  oversold: 'DQ-OVERSOLD', quantity: 'DQ-QUANTITY', fxUnknown: 'DQ-FX-UNKNOWN', fxUsdNearest: 'DQ-FX-USD-NEAREST',
  fxNoDayRate: 'DQ-FX-NO-DAY-RATE', fxTodayOnly: 'DQ-FX-TODAY-ONLY', skinMisfiled: 'DQ-SKIN-MISFILED' }));
ok('codes are unique', new Set(Object.values(DC.CODES)).size === Object.keys(DC.CODES).length);

console.log('ledger findings carry the transaction:');
const txs = [
  { id: 'q1', type: 'buy', category: 'stocks', symbol: 'AAA', quantity: -2, price: 10, currency: 'EUR', date: '2024-01-01' },
  { id: 'o1', type: 'sell', category: 'crypto', symbol: 'ADA', quantity: 5, price: 1, currency: 'EUR', date: '2024-02-01' },
  { id: 'f1', type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 0.05, currency: 'BTC', date: '2024-02-01' }
];
const issues = L.build(txs, { exchangeRate: 0.9 }).issues;
const q = issues.find(i => i.kind === 'quantity'), o = issues.find(i => i.kind === 'oversold'), f = issues.find(i => i.kind === 'currency');
ok('quantity finding names its transaction', q && q.txId === 'q1');
ok('currency finding names its (first) transaction', f && f.txId === 'f1' && f.status === 'unknown', JSON.stringify(f));

console.log('classify:');
{
  const cq = DC.classify(q, {}), co = DC.classify(o, {}), cf = DC.classify(f, {});
  ok('quantity → DQ-QUANTITY, edit that transaction', cq.code === 'DQ-QUANTITY' && cq.action.type === 'edit-transaction' && cq.action.txId === 'q1');
  ok('oversold → DQ-OVERSOLD, show the symbol\'s transactions', co.code === 'DQ-OVERSOLD' && co.action.type === 'show-transactions' && co.action.symbol === 'ADA');
  ok('no rate at all → DQ-FX-UNKNOWN, edit the transaction', cf.code === 'DQ-FX-UNKNOWN' && cf.action.type === 'edit-transaction' && cf.action.txId === 'f1');
  ok('a finding without a transaction id falls back to showing the symbol', DC.classify({ kind: 'quantity', symbol: 'X' }, {}).action.type === 'show-transactions');
  const usd = DC.classify({ kind: 'currency', status: 'approx', currency: 'USDT', symbol: 'BTC' }, { hasWorker: true });
  ok('USD-like nearest rate → DQ-FX-USD-NEAREST, refresh with a Worker', usd.code === 'DQ-FX-USD-NEAREST' && usd.action.type === 'refresh');
  const noW = DC.classify({ kind: 'currency', status: 'approx', currency: 'CHF' }, { hasWorker: false, hasHistory: () => true });
  ok('history but not that day → DQ-FX-NO-DAY-RATE; without a Worker → API settings', noW.code === 'DQ-FX-NO-DAY-RATE' && noW.action.type === 'open-api-settings');
  ok('no history → DQ-FX-TODAY-ONLY', DC.classify({ kind: 'currency', status: 'approx', currency: 'JPY' }, { hasHistory: () => false }).code === 'DQ-FX-TODAY-ONLY');
  ok('only the skin move changes data', [cq, co, cf, usd, noW].every(c => c.action.changesData === false) && DC.misfiled([{ symbol: 'AK-47' }]).action.changesData === true);
  ok('misfiled skins → DQ-SKIN-MISFILED; none → null', DC.misfiled([{ symbol: 'x' }]).code === 'DQ-SKIN-MISFILED' && DC.misfiled([]) === null);
  ok('every action has a label', ['show-transactions', 'edit-transaction', 'refresh', 'open-api-settings', 'move-skins'].every(t => DC.actionLabel({ type: t }).length > 3));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
