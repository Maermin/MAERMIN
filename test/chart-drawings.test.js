// CH-4: chart-drawings.js - the drawing tools of the Charts view, their
// storage (maermin_chart_drawings: per symbol, timeframe-independent, in
// backups, encrypted at rest and so synced), bad data dropped without a
// crash, and "create alert at this price" as a normal Alerts & Rules rule.
// Run: node test/chart-drawings.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
const D = require('../chart-drawings.js');
const B = require('../backup-engine.js');
const ST = require('../storage.js');
const R = require('../rules-engine.js');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const memStore = () => { const m = {}; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };

console.log('tools:');
ok('nine tools in order', D.TOOLS.map((t) => t.id).join() === 'trend,ray,hline,vline,channel,fib,rect,text,measure');
ok('library overlays: built-ins and our own', D.TOOLS.map((t) => t.overlay).join() === 'segment,rayLine,horizontalStraightLine,verticalStraightLine,parallelStraightLine,fibonacciLine,mrmRect,mrmText,mrmMeasure');
ok('points per tool', D.TOOLS.map((t) => t.points).join() === '2,2,1,1,3,2,2,1,2');
ok('tool by overlay name', D.toolOf('fibonacciLine').id === 'fib' && D.toolOf('nope') === null);

console.log('\nstorage (maermin_chart_drawings):');
ok('the key, in backups, encrypted at rest (so it syncs)', D.KEY === 'maermin_chart_drawings' && B.KEYS.indexOf(D.KEY) !== -1 && ST.isSensitive(D.KEY));
const line = { id: 'd1', overlay: 'horizontalStraightLine', points: [{ t: 1772450000000, v: 101.5 }] };
const note = { id: 'd2', overlay: 'mrmText', points: [{ t: 1772450000000, v: 99 }], text: 'buy zone' };
const good = { version: 1, bySymbol: { 'sap.de': [line, note], AAPL: [] } };
const n = D.normalize(good);
ok('valid drawings kept, symbol upper case, empty lists dropped', same(n, { version: 1, bySymbol: { 'SAP.DE': [line, note] } }), n);
const bad = D.normalize({ bySymbol: {
  AAPL: [
    { id: 'a', overlay: 'segment', points: [{ t: 1, v: 1 }] },                      // too few points
    { id: 'b', overlay: 'evil', points: [{ t: 1, v: 1 }, { t: 2, v: 2 }] },          // unknown tool
    { id: 'c', overlay: 'segment', points: [{ t: 'x', v: 1 }, { t: 2, v: 2 }] },     // bad time
    { id: 'd', overlay: 'segment', points: [{ t: 1, v: Infinity }, { t: 2, v: 2 }] },// bad price
    null, 'x', 5,
    { id: 'e', overlay: 'segment', points: [{ t: 1, v: 1 }, { t: 2, v: 2 }, { t: 3, v: 3 }] }, // extra point: cut to 2
    { overlay: 'mrmText', points: [{ t: 1, v: 1 }], text: 'x'.repeat(500) },      // no id: gets one; long text cut
  ],
  'AK-47 | Redline': [line],                                                     // not a market symbol
} });
ok('malformed drawings dropped, extra points cut, ids made, notes capped at 200 characters', bad.bySymbol.AAPL.length === 2 && bad.bySymbol.AAPL[0].points.length === 2 &&
  typeof bad.bySymbol.AAPL[1].id === 'string' && bad.bySymbol.AAPL[1].text.length === 200 && !bad.bySymbol['AK-47 | Redline'], bad);
ok('junk input: an empty state, no crash', same(D.normalize('{oops'), { version: 1, bySymbol: {} }) && same(D.normalize(42), { version: 1, bySymbol: {} }) && same(D.normalize({ bySymbol: [] }), { version: 1, bySymbol: {} }));
const many = Array.from({ length: 250 }, (_, i) => ({ id: 'm' + i, overlay: 'horizontalStraightLine', points: [{ t: i, v: i }] }));
ok('at most 200 drawings per symbol', D.normalize({ bySymbol: { AAPL: many } }).bySymbol.AAPL.length === 200);
const s = memStore();
ok('save → load round trip', D.save(s, good) === true && same(D.load(s), n));
ok('storage that throws: an empty state on load, false on save', same(D.load({ getItem() { throw new Error('x'); } }), { version: 1, bySymbol: {} }) && D.save({ setItem() { throw new Error('x'); } }, good) === false);
ok('forSymbol / setSymbol (an empty list removes the symbol)', D.forSymbol(n, 'sap.de').length === 2 && D.forSymbol(n, 'MSFT').length === 0 &&
  D.forSymbol(D.setSymbol(n, 'MSFT', [line]), 'MSFT').length === 1 && !('SAP.DE' in D.setSymbol(n, 'SAP.DE', []).bySymbol) && D.forSymbol(n, 'SAP.DE').length === 2);

console.log('\nbackup and restore:');
const src = memStore();
D.save(src, good);
const backup = B.snapshot({ storage: src });
const dst = memStore();
B.restore(backup, { storage: dst });
ok('a full backup carries the drawings and restores them', typeof backup.store[D.KEY] === 'string' && same(D.load(dst), n));

console.log('\nlibrary overlays:');
const ov = { id: 'd9', name: 'segment', points: [{ timestamp: 1000, value: 1.5, dataIndex: 3 }, { timestamp: 2000, value: 2.5 }], extendData: null };
const fromOv = D.fromOverlay(ov);
ok('an overlay → a drawing (time and price only)', same(fromOv, { id: 'd9', overlay: 'segment', points: [{ t: 1000, v: 1.5 }, { t: 2000, v: 2.5 }] }), fromOv);
const create = D.toCreate(note);
ok('a drawing → the library spec (our group, the note in extendData)', create.id === 'd2' && create.name === 'mrmText' && create.groupId === D.GROUP && same(create.points, [{ timestamp: 1772450000000, value: 99 }]) && create.extendData.text === 'buy zone');
ok('an unfinished overlay is not a drawing', D.fromOverlay({ id: 'x', name: 'segment', points: [{ timestamp: 1, value: 1 }] }) === null);

console.log('\nmeasure:');
const m = D.measure({ value: 100, dataIndex: 10 }, { value: 110, dataIndex: 25 });
ok('measure: change, %, bars', m.diff === 10 && Math.abs(m.pct - 0.1) < 1e-12 && m.bars === 15, m);

console.log('\nalert from a horizontal line:');
const above = D.alertRule('AAPL', 260, 247.83);
ok('a line above the last price: price ≥ line', above.metric === 'symbol_price' && above.op === 'gte' && above.threshold === 260 && above.target === 'AAPL', above);
ok('a line below: price ≤ line', D.alertRule('AAPL', 230, 247.83).op === 'lte');
// the chart shows EUR; the rule is in the listing currency (USD): 230 EUR / 0.92 EUR per USD = 250 USD
const eur = D.alertRule('AAPL', 230, 247.83, { toListing: (v) => v / 0.92 });
ok('a line drawn in EUR becomes the listing-currency threshold', Math.abs(eur.threshold - 250) < 1e-9 && eur.op === 'gte', eur);
ok('the threshold keeps the price precision (4 below 1)', D.alertRule('X', 0.123456, 0.2).threshold === 0.1235 && D.alertRule('X', 123.456, 100).threshold === 123.46);
const added = R.addRule(R.normalize(null), D.alertRule('AAPL', 260, 247.83));
ok('Alerts & Rules accepts the payload as a price rule, enabled', added.rules.length === 1 && added.rules[0].metric === 'symbol_price' && added.rules[0].enabled === true && added.rules[0].threshold === 260, added);
ok('no price: no rule', D.alertRule('AAPL', NaN, 1) === null && D.alertRule('', 1, 1) === null);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
