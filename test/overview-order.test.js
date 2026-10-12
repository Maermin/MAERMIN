// Node harness for the Overview section order (P4-7): MaerminDashboard.sectionOrder
// with move / reorder. Run: node test/overview-order.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''))); }
const D = require('../dashboard-layout.js');
const KNOWN = ['valueChart', 'statCards', 'allocation'];

console.log('sectionOrder:');
ok('no saved layout → default order', D.sectionOrder(null, KNOWN).join() === 'valueChart,statCards,allocation');
let st = D.normalize(null, KNOWN); // the P4-7 cases run on the three sections they were written for
st = D.move(st, 'allocation', 'up');
ok('move up swaps with the section above', D.sectionOrder(st, KNOWN).join() === 'valueChart,allocation,statCards');
st = D.move(st, 'allocation', 'up');
ok('…and again to the top', D.sectionOrder(st, KNOWN).join() === 'allocation,valueChart,statCards');
ok('move up at the top is a no-op', D.sectionOrder(D.move(st, 'allocation', 'up'), KNOWN).join() === 'allocation,valueChart,statCards');
ok('move down at the bottom is a no-op', D.sectionOrder(D.move(st, 'statCards', 'down'), KNOWN).join() === 'allocation,valueChart,statCards');
const dragged = D.reorder(st, ['statCards', 'allocation', 'valueChart']);
ok('a drag (reorder) sets the full order', D.sectionOrder(dragged, KNOWN).join() === 'statCards,allocation,valueChart');
ok('reorder keeps visibility', D.reorder(D.toggle(st, 'valueChart'), ['valueChart', 'allocation', 'statCards']).widgets.find(w => w.id === 'valueChart').visible === false);
ok('unknown saved ids are dropped, new sections go to the end', D.sectionOrder({ version: 1, widgets: [{ id: 'gone' }, { id: 'allocation' }] }, KNOWN).join() === 'allocation,valueChart,statCards');
ok('a stored string survives (as saved in localStorage)', D.sectionOrder(JSON.stringify(dragged), KNOWN).join() === 'statCards,allocation,valueChart');
// P5-1.5: a fourth section, "Returns"
const FOUR = ['valueChart', 'statCards', 'returnFigures', 'allocation'];
ok('P5-1.5: the built-in list has the Returns section after the stat cards', D.DEFAULT_WIDGETS.map(w => w.id).join() === FOUR.join());
ok('P5-1.5: a new user gets chart, stat cards, Returns, allocation', D.sectionOrder(null, FOUR).join() === FOUR.join());
const old = { version: 1, widgets: [{ id: 'allocation', visible: true }, { id: 'valueChart', visible: true }, { id: 'statCards', visible: false }] };
ok('P5-1.5: a layout saved before keeps its order; Returns is appended', D.sectionOrder(old, FOUR).join() === 'allocation,valueChart,statCards,returnFigures');
ok('P5-1.5: ...visible, and the old hidden section stays hidden', (() => { const n = D.normalize(old, FOUR).widgets; return n.find(w => w.id === 'returnFigures').visible === true && n.find(w => w.id === 'statCards').visible === false; })());
ok('P5-1.5: Returns can be moved like the others', D.sectionOrder(D.move(D.normalize(null, FOUR), 'returnFigures', 'up'), FOUR).join() === 'valueChart,returnFigures,statCards,allocation');
ok('the order lives in the existing layout key (in the backup)', D.STORAGE_KEY === 'maermin_dashboard_layout' && require('../backup-engine.js').KEYS.indexOf(D.STORAGE_KEY) !== -1);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
