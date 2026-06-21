// Node harness for the savings-plan auto-execution pure layer: calendar-exact
// scheduling (reused from MaerminRecurring), idempotency via on-transaction
// markers, sync-merge dedupe, quantity math, the no-price pending path, and
// plan status with optional end dates.
// Run: node test/savings-executor.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const E = require('../savings-plan-executor.js');

const PLAN = { id: 'p1', symbol: 'BTC', category: 'crypto', amount: 100, frequency: 'monthly', startDate: '2026-01-15', active: true };

(function run() {
  console.log('savings-executor:');

  // ---- calendar-exact schedule (via MaerminRecurring) -------------------------
  // Jan 15, Feb 15, Mar 15, Apr 15, May 15 - Jun 15 is after the as-of date.
  const occ = E.occurrences(PLAN, '2026-06-12');
  ok('monthly plan since Jan 15 has 5 occurrences by Jun 12', occ.length === 5);
  ok('occurrences land on the calendar day, not a 30.44-day grid',
    occ[0].date === '2026-01-15' && occ[1].date === '2026-02-15' && occ[4].date === '2026-05-15');
  // Month-end clamping comes from recurring.js: Jan 31 -> Feb 28.
  const clamp = E.occurrences({ ...PLAN, startDate: '2026-01-31' }, '2026-03-05');
  ok('month-end start clamps to Feb 28 (recurring.js semantics)', clamp[1].date === '2026-02-28');
  ok('expectedExecutions matches the schedule', E.expectedExecutions(PLAN, '2026-06-12') === 5);

  // ---- end date (task 6) ---------------------------------------------------------
  const ended = E.occurrences({ ...PLAN, endDate: '2026-03-31' }, '2026-06-12');
  ok('endDate stops the schedule', ended.length === 3 && ended[2].date === '2026-03-15');
  ok('status: active without endDate', E.planStatus(PLAN, '2026-06-12') === 'active');
  ok('status: completed past endDate', E.planStatus({ ...PLAN, endDate: '2026-05-31' }, '2026-06-12') === 'completed');
  ok('status: future endDate stays active', E.planStatus({ ...PLAN, endDate: '2027-01-01' }, '2026-06-12') === 'active');
  ok('status: paused wins', E.planStatus({ ...PLAN, active: false }, '2026-06-12') === 'paused');

  // ---- pendingExecutions + idempotency -------------------------------------------
  const booked = [
    { id: 't1', type: 'buy', symbol: 'BTC', source: 'savings-plan', planId: 'p1', dueDate: '2026-01-15' },
    { id: 't2', type: 'buy', symbol: 'BTC', source: 'savings-plan', planId: 'p1', dueDate: '2026-02-15' },
    { id: 'manual', type: 'buy', symbol: 'BTC', date: '2026-03-20' } // manual buys never count as executions
  ];
  const pending = E.pendingExecutions([PLAN], booked, '2026-06-12');
  ok('already-booked due dates are skipped', pending.length === 3 && pending[0].dueDate === '2026-03-15');
  ok('manual buys do not satisfy a due date', pending.some((p) => p.dueDate === '2026-03-15'));
  ok('paused plans never execute', E.pendingExecutions([{ ...PLAN, active: false }], [], '2026-06-12').length === 0);
  ok('plans without amount or symbol never execute',
    E.pendingExecutions([{ ...PLAN, amount: 0 }], [], '2026-06-12').length === 0 &&
    E.pendingExecutions([{ ...PLAN, symbol: '' }], [], '2026-06-12').length === 0);

  // ---- buildTransaction ------------------------------------------------------------
  const tx = E.buildTransaction(PLAN, '2026-03-15', 50000);
  ok('quantity = amount / price at due date', approx(tx.quantity, 100 / 50000));
  ok('transaction is a real EUR buy on the due date', tx.type === 'buy' && tx.currency === 'EUR' && tx.date === '2026-03-15' && tx.price === 50000);
  ok('execution markers travel on the transaction', tx.source === 'savings-plan' && tx.planId === 'p1' && tx.dueDate === '2026-03-15' && tx.auto === true);
  ok('no price -> no transaction (never a guessed quantity)', E.buildTransaction(PLAN, '2026-03-15', null) === null && E.buildTransaction(PLAN, '2026-03-15', 0) === null);

  // ---- priceAtDate -------------------------------------------------------------------
  const history = { BTC: [
    { timestamp: '2026-03-10T10:00:00Z', price: 48000 },
    { timestamp: '2026-03-14T10:00:00Z', price: 49500 },
    { timestamp: '2026-03-16T10:00:00Z', price: 51000 }
  ] };
  ok('nearest close at or before the due date wins', E.priceAtDate(history, {}, 'BTC', '2026-03-15') === 49500);
  ok('no coverage and not today -> null (stays pending)', E.priceAtDate({}, { BTC: 50000 }, 'BTC', '2026-03-15') === null);
  const today = new Date().toISOString().split('T')[0];
  ok('live price only for executions due today', E.priceAtDate({}, { BTC: 50000 }, 'BTC', today) === 50000);

  // ---- runCatchUp: booking + idempotency over two runs --------------------------------
  const resolve = (plan, dueDate) => E.priceAtDate(history, {}, plan.symbol, dueDate);
  const run1 = E.runCatchUp([{ ...PLAN, startDate: '2026-03-01' }], [], resolve, '2026-04-01');
  // Due: Mar 1 (no history yet -> pending), Apr 1 (after last close -> 51000).
  ok('resolvable due dates are booked', run1.created.length === 1 && run1.created[0].dueDate === '2026-04-01' && approx(run1.created[0].quantity, 100 / 51000));
  ok('unresolvable due dates stay pending with a reason', run1.pending.length === 1 && run1.pending[0].dueDate === '2026-03-01' && /price/.test(run1.pending[0].reason));
  const run2 = E.runCatchUp([{ ...PLAN, startDate: '2026-03-01' }], run1.transactions, resolve, '2026-04-01');
  ok('a second catch-up books nothing (idempotent)', run2.created.length === 0);
  ok('created transactions carry unique ids', run1.created.every((t) => t.id));

  // ---- sync-merge dedupe ----------------------------------------------------------------
  const merged = [
    { id: 'b-device2', type: 'buy', source: 'savings-plan', planId: 'p1', dueDate: '2026-02-15' },
    { id: 'a-device1', type: 'buy', source: 'savings-plan', planId: 'p1', dueDate: '2026-02-15' },
    { id: 'keep', type: 'buy', source: 'savings-plan', planId: 'p1', dueDate: '2026-03-15' },
    { id: 'manual', type: 'buy', symbol: 'BTC' }
  ];
  const dd = E.dedupeExecutions(merged);
  ok('post-merge duplicates collapse to one per (plan, dueDate)', dd.removed === 1 && dd.transactions.length === 3);
  ok('the deterministic survivor is the smallest id', dd.transactions.some((t) => t.id === 'a-device1') && !dd.transactions.some((t) => t.id === 'b-device2'));
  ok('manual transactions are never touched', dd.transactions.some((t) => t.id === 'manual'));
  ok('catch-up performs the dedupe pass too', E.runCatchUp([PLAN], merged, () => null, '2026-03-16').removedDuplicates === 1);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
