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

  // ---- overlays -------------------------------------------------------------
  console.log('ui-store overlays:');
  ok('nothing open initially', !UI.isOverlayOpen('commandPalette') && !UI.anyOverlayOpen());
  UI.openOverlay('commandPalette');
  ok('open sets the overlay', UI.isOverlayOpen('commandPalette') && UI.anyOverlayOpen());
  ok('other overlays stay closed', !UI.isOverlayOpen('shortcuts'));
  UI.toggleOverlay('commandPalette');
  ok('toggle closes an open overlay', !UI.isOverlayOpen('commandPalette'));
  UI.toggleOverlay('shortcuts');
  ok('toggle opens a closed overlay', UI.isOverlayOpen('shortcuts'));
  UI.openOverlay('commandPalette');
  let n = 0;
  const uo = UI.overlays.subscribe(() => { n++; });
  UI.closeOverlay('commandPalette');
  ok('close notifies + clears one overlay', n === 1 && !UI.isOverlayOpen('commandPalette') && UI.isOverlayOpen('shortcuts'));
  UI.closeAllOverlays();
  ok('closeAll clears everything', !UI.anyOverlayOpen() && !UI.isOverlayOpen('shortcuts'));
  // setting the same value is a no-op (store does not notify)
  n = 0;
  UI.closeOverlay('shortcuts'); // already false
  ok('no notification when overlay state is unchanged', n === 0);
  uo();

  // ---- modal dialogs: Tab trap -----------------------------------------------
  console.log('ui-store dialog focus trap:');
  ok('Tab on the last element wraps to the first', UI.trapTarget(4, 3, false) === 0);
  ok('Shift+Tab on the first element wraps to the last', UI.trapTarget(4, 0, true) === 3);
  ok('Tab in the middle is left to the browser', UI.trapTarget(4, 1, false) === null && UI.trapTarget(4, 2, true) === null);
  ok('Tab on the first / Shift+Tab on the last is left to the browser', UI.trapTarget(4, 0, false) === null && UI.trapTarget(4, 3, true) === null);
  ok('focus outside the dialog: Tab enters at the first element', UI.trapTarget(4, -1, false) === 0);
  ok('focus outside the dialog: Shift+Tab enters at the last element', UI.trapTarget(4, -1, true) === 3);
  ok('an index past the list counts as outside', UI.trapTarget(4, 9, false) === 0);
  ok('one focusable element: Tab and Shift+Tab stay on it', UI.trapTarget(1, 0, false) === 0 && UI.trapTarget(1, 0, true) === 0);
  ok('no focusable element: focus stays on the panel (-1)', UI.trapTarget(0, -1, false) === -1 && UI.trapTarget(0, -1, true) === -1);

  // ---- modal dialogs: stack ---------------------------------------------------
  console.log('ui-store dialog stack:');
  const d1 = {}, d2 = {};
  ok('no dialog open: nothing is on top', UI.overlayDepth() === 0 && !UI.isTopOverlay(d1));
  UI.pushOverlay(d1);
  ok('a single dialog is the top one', UI.isTopOverlay(d1) && UI.overlayDepth() === 1);
  UI.pushOverlay(d2);
  ok('a dialog opened over another takes the keys', UI.isTopOverlay(d2) && !UI.isTopOverlay(d1) && UI.overlayDepth() === 2);
  ok('the dialog underneath is not the top one while another is open', UI.topOverlay() === d2);
  UI.popOverlay(d2);
  ok('closing the top dialog hands the keys back', UI.isTopOverlay(d1) && UI.overlayDepth() === 1);
  ok('focus can go back to the dialog underneath', UI.topOverlay() === d1);
  UI.pushOverlay(d2);
  UI.popOverlay(d1);
  ok('closing the lower dialog first leaves the upper one on top', UI.isTopOverlay(d2) && UI.overlayDepth() === 1);
  UI.popOverlay(d1);
  ok('closing a dialog twice changes nothing', UI.isTopOverlay(d2) && UI.overlayDepth() === 1);
  UI.popOverlay(d2);
  ok('all closed: stack is empty', UI.overlayDepth() === 0 && !UI.isTopOverlay(d2) && UI.topOverlay() === null);

  // ---- modal dialogs: panel attributes ----------------------------------------
  console.log('ui-store dialog attributes:');
  const withTitle = UI.dialogProps('dlg-title');
  ok('panel is a modal dialog named by its title', withTitle.role === 'dialog' && withTitle['aria-modal'] === 'true' && withTitle['aria-labelledby'] === 'dlg-title' && !('aria-label' in withTitle));
  const noTitle = UI.dialogProps(null, 'Search');
  ok('a dialog without a visible title gets aria-label', noTitle.role === 'dialog' && noTitle['aria-label'] === 'Search' && !('aria-labelledby' in noTitle));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
