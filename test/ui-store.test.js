// Node harness for the ephemeral UI store (MaerminUI) — the toast slice migrated
// onto MaerminStore. The <ToastContainer> React component is browser-only; here
// we cover the pure reducers + the add/dismiss/clear store ops (ttl 0 = no timer).
// Run: node test/ui-store.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const UI = require('../ui-store.js');

(function run() {
  console.log('ui-store:');

  // ---- pure reducers --------------------------------------------------------
  ok('reduceAdd appends', UI.reduceAdd([{ id: 1 }], { id: 2 }).length === 2);
  ok('reduceAdd caps + drops oldest', (() => {
    let items = [];
    for (let i = 0; i < 9; i++) items = UI.reduceAdd(items, { id: i });
    return items.length === UI.MAX && items[0].id === 9 - UI.MAX && items[items.length - 1].id === 8;
  })());
  ok('reduceDismiss removes by id', UI.reduceDismiss([{ id: 'a' }, { id: 'b' }], 'a').length === 1 &&
    UI.reduceDismiss([{ id: 'a' }, { id: 'b' }], 'a')[0].id === 'b');

  // ---- store ops (ttl 0 → no auto-dismiss timer) ----------------------------
  ok('starts empty', UI.items().length === 0);
  const id1 = UI.add('hello', 'success', 0);
  ok('add returns an id + stores the toast', typeof id1 === 'string' && UI.items().length === 1 && UI.items()[0].message === 'hello' && UI.items()[0].type === 'success');
  const id2 = UI.add('warn', 'warning', 0);
  ok('second add appended', UI.items().length === 2 && UI.items()[1].id === id2);
  ok('default type is info + null message → empty string', (() => { UI.add(null, undefined, 0); const last = UI.items()[UI.items().length - 1]; return last.type === 'info' && last.message === ''; })());

  UI.dismiss(id1);
  ok('dismiss removes the right toast', !UI.items().some((t) => t.id === id1) && UI.items().some((t) => t.id === id2));

  let notified = 0;
  const unsub = UI.toasts.subscribe(() => { notified++; });
  UI.add('x', 'info', 0);
  ok('store subscribers are notified on add', notified === 1);
  unsub();

  UI.clear();
  ok('clear empties the store', UI.items().length === 0);

  // ids are unique even within the same millisecond
  const a = UI.add('a', 'info', 0), b = UI.add('b', 'info', 0);
  ok('ids are unique', a !== b);
  UI.clear();

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
