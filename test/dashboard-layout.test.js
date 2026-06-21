// Node harness for the Custom Dashboard Layout engine. Pure, no browser.
// Run: node test/dashboard-layout.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const D = require('../dashboard-layout.js');

(function run() {
  console.log('dashboard-layout:');

  const AVAIL = ['a', 'b', 'c', 'd'];

  // ---- normalize from empty = all available, visible, in default order ----
  let st = D.normalize(null, AVAIL);
  ok('empty layout yields all widgets', st.widgets.length === 4);
  ok('all default to visible', st.widgets.every(w => w.visible));
  ok('default order preserved', st.widgets.map(w => w.id).join('') === 'abcd');

  // ---- saved order + visibility is honoured ----
  st = D.normalize({ widgets: [
    { id: 'c', visible: true },
    { id: 'a', visible: false }
  ]}, AVAIL);
  ok('saved order comes first', st.widgets[0].id === 'c' && st.widgets[1].id === 'a');
  ok('saved visibility honoured', st.widgets[1].visible === false);
  // 'b' and 'd' were new to the saved layout -> appended, visible
  ok('new widgets appended visible', st.widgets[2].id === 'b' && st.widgets[2].visible &&
                                     st.widgets[3].id === 'd');

  // ---- unknown saved ids are dropped (a removed widget can't linger) ----
  st = D.normalize({ widgets: [{ id: 'zzz', visible: true }, { id: 'b', visible: false }] }, AVAIL);
  ok('unknown saved id dropped', !st.widgets.some(w => w.id === 'zzz'));
  ok('known saved id kept', st.widgets[0].id === 'b' && st.widgets[0].visible === false);

  // ---- toggle / setVisible ----
  let t = D.normalize(null, AVAIL);
  t = D.toggle(t, 'a', AVAIL);
  ok('toggle flips visibility', t.widgets.find(w => w.id === 'a').visible === false);
  t = D.setVisible(t, 'a', true, AVAIL);
  ok('setVisible forces a state', t.widgets.find(w => w.id === 'a').visible === true);

  // ---- visibleWidgets returns only visible ids in order ----
  let v = D.toggle(D.normalize(null, AVAIL), 'b', AVAIL);
  ok('visibleWidgets filters hidden', D.visibleWidgets(v, AVAIL).join('') === 'acd');

  // ---- move up / down + bounds ----
  let m = D.normalize(null, AVAIL);
  m = D.move(m, 'c', 'up', AVAIL);
  ok('move up swaps neighbours', m.widgets.map(w => w.id).join('') === 'acbd');
  m = D.move(m, 'a', 'up', AVAIL); // already first -> no-op
  ok('move up at top is a no-op', m.widgets[0].id === 'a');

  // ---- reorder by explicit id list, keeping visibility ----
  let ro = D.toggle(D.normalize(null, AVAIL), 'd', AVAIL); // hide d
  ro = D.reorder(ro, ['d', 'c'], AVAIL);
  ok('reorder applies explicit order first', ro.widgets[0].id === 'd' && ro.widgets[1].id === 'c');
  ok('reorder preserves visibility', ro.widgets[0].visible === false);
  ok('reorder appends the rest', ro.widgets.length === 4);

  // ---- reset ----
  ok('reset returns defaults', D.reset(AVAIL).widgets.map(w => w.id).join('') === 'abcd');

  // ---- default build list is non-empty and unique ----
  const ids = D.defaultIds();
  ok('DEFAULT_WIDGETS has unique ids', new Set(ids).size === ids.length && ids.length > 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
