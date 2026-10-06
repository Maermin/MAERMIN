// Trash + Undo (P2-4): pure list helpers, storage restore without duplicates,
// registered handlers, reload listeners, and the sync rule that a restored
// transaction outlives the other device's tombstone.
// Run: node test/trash.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

// In-memory localStorage before the module loads.
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); }
};
const T = require('../trash.js');
const Sync = require('../sync-engine.js');
const DAY = 86400000;

console.log('trash (pure):');
{
  const e1 = { id: 'a', kind: 'goal', label: 'A', deletedAt: 1000, payload: {} };
  const e2 = { id: 'b', kind: 'goal', label: 'B', deletedAt: 2000, payload: {} };
  const l = T.add(T.add([], e1), e2);
  ok('add puts the newest first', l[0].id === 'b' && l[1].id === 'a');
  ok('remove drops one entry', T.remove(l, 'a').map((e) => e.id).join() === 'b');
  ok('normalize drops junk and parses JSON', T.normalize('[{"id":"x","kind":"k"},null,{"id":"y"}]').length === 1 && T.normalize('nope').length === 0);
  const now = 40 * DAY;
  ok('prune drops entries older than 30 days', T.prune([{ id: 'o', kind: 'k', deletedAt: now - 31 * DAY }, { id: 'n', kind: 'k', deletedAt: now - 29 * DAY }], now).map((e) => e.id).join() === 'n');
  ok('daysLeft counts down to 0', T.daysLeft({ deletedAt: now - 29.5 * DAY }, now) === 1 && T.daysLeft({ deletedAt: now - 40 * DAY }, now) === 0);
  const r = T.restoreInto([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]);
  ok('restoreInto never adds a second copy of an id', r.items.map((x) => x.id).join() === '1,2,3' && r.added === 1);
  let many = [];
  for (let i = 0; i < T.MAX + 5; i++) many = T.add(many, { id: 'i' + i, kind: 'k', deletedAt: i });
  ok('the trash is capped at MAX entries (oldest drop out)', many.length === T.MAX && many[0].id === 'i' + (T.MAX + 4));
}

console.log('trash (storage):');
{
  mem.clear();
  mem.set('maermin_savings_plans', JSON.stringify([{ id: 'p2', symbol: 'VWCE' }]));
  const id = T.put('savingsPlan', 'ETF plan', { id: 'p1', symbol: 'IWDA' });
  ok('put stores the entry with kind, label and time', T.list()[0].id === id && T.list()[0].kind === 'savingsPlan' && T.list()[0].deletedAt > 0);
  let reloaded = 0;
  const off = T.onRestore('maermin_savings_plans', () => { reloaded++; });
  ok('restore puts a stored record back', T.restore(id) === true && JSON.parse(mem.get('maermin_savings_plans')).map((p) => p.id).join() === 'p2,p1');
  ok('… tells the view that holds the key to reload', reloaded === 1);
  ok('… and the entry leaves the trash', T.list().length === 0);
  off();
  const id2 = T.put('savingsPlan', 'again', { id: 'p1', symbol: 'IWDA' });
  T.restore(id2);
  ok('restoring a record that is already there adds no duplicate', JSON.parse(mem.get('maermin_savings_plans')).filter((p) => p.id === 'p1').length === 1);

  mem.set('maermin_rules', JSON.stringify({ version: 1, rules: [{ id: 'r1' }] }));
  T.restore(T.put('rule', 'Rule 2', { id: 'r2' }));
  const rules = JSON.parse(mem.get('maermin_rules'));
  ok('records inside an object (rules) go back to their array, other fields kept', rules.version === 1 && rules.rules.map((r) => r.id).join() === 'r1,r2');

  let got = null;
  const offTx = T.register('transaction', (tx) => { got = tx; return true; });
  const tid = T.put('transaction', 'Buy 1 AAPL', { id: 't1' });
  ok('a registered handler restores records held in app state', T.restore(tid) && got && got.id === 't1' && T.list().length === 0);
  offTx();
  const tid2 = T.put('transaction', 'x', { id: 't2' });
  ok('without a handler the entry stays in the trash', T.restore(tid2) === false && T.list().length === 1);
  T.purge(tid2);
  ok('purge deletes one entry for good', T.list().length === 0);
  T.put('goal', 'g1', { id: 'g1' }); T.put('goal', 'g2', { id: 'g2' });
  T.purgeAll();
  ok('purgeAll empties the trash', T.list().length === 0);
  mem.set('maermin_trash', JSON.stringify([{ id: 'old', kind: 'goal', deletedAt: Date.now() - 31 * DAY }, { id: 'new', kind: 'goal', deletedAt: Date.now() }]));
  ok('list() drops expired entries from storage', T.list().map((e) => e.id).join() === 'new' && JSON.parse(mem.get('maermin_trash')).length === 1);
}

console.log('sync: a restored transaction survives the other device\'s tombstone:');
{
  const tx = { id: 'x1', type: 'buy', symbol: 'AAPL', quantity: 1 };
  // Device A deletes x1 at t=1000; both devices sync, so both carry the tombstone.
  const del = Sync.trackTxChanges({ x1: JSON.stringify(tx) }, [], null, 1000);
  ok('delete stamps a tombstone', del.meta.deleted.x1 === 1000);
  // Device A restores x1 at t=2000.
  const back = Sync.trackTxChanges({}, [tx], JSON.stringify(del.meta), 2000);
  ok('restore drops the local tombstone and stamps an edit after it', back.meta.deleted.x1 === undefined && back.meta.edited.x1 === 2000 && back.changed);
  // Device B still has the tombstone and no x1: the merge keeps the restored one.
  const u = Sync.unionTransactions(JSON.stringify([tx]), JSON.stringify([]), JSON.stringify(back.meta), JSON.stringify(del.meta));
  ok('merge with the old tombstone keeps the restored transaction', JSON.parse(u.str).some((t) => t.id === 'x1'));
  const u2 = Sync.unionTransactions(JSON.stringify([]), JSON.stringify([tx]), JSON.stringify(del.meta), JSON.stringify(back.meta));
  ok('… on the other device too', JSON.parse(u2.str).some((t) => t.id === 'x1'));
}

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
