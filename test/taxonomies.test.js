// P5-2.10: hierarchical taxonomies on top of tags and categories - templates,
// suggestions from the app's data, allocation per node, targets for the
// rebalancing planner, JSON import / export.
// Run: node test/taxonomies.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const near = (a, b, e) => a != null && b != null && Math.abs(a - b) <= (e || 1e-9);

const T = require('../taxonomies.js');
const RB = require('../rebalancing-planner.js');

console.log('templates:');
ok('four templates', T.TEMPLATES.map((t) => t.id).join() === 'asset-classes,gics,msci-regions,kommer', T.TEMPLATES.map((t) => t.id));
const ac = T.fromTemplate('asset-classes');
ok('asset classes: seven top-level nodes', ac.nodes.length === 7 && ac.nodes.map((n) => n.id).indexOf('equity') !== -1 && ac.template === 'asset-classes', ac.nodes.map((n) => n.id));
const gics = T.fromTemplate('gics');
ok('GICS: the 11 sectors', gics.nodes.length === 11);
const reg = T.fromTemplate('msci-regions');
ok('MSCI regions: developed (with North America, Europe & Middle East, Pacific) and emerging markets', reg.nodes.length === 2 && reg.nodes[0].children.length === 3, reg.nodes.map((n) => [n.id, n.children.length]));
const k = T.fromTemplate('kommer');
ok('Kommer world portfolio: developed 70 %, emerging 30 % as targets', k.nodes.length === 2 && k.nodes[0].target === 70 && k.nodes[1].target === 30);
ok('an unknown template is null', T.fromTemplate('nope') === null);

console.log('\nediting:');
{
  let st = T.normalize(null);
  ok('empty state', st.version === 1 && st.list.length === 0);
  st = T.add(st, T.fromTemplate('kommer'));
  const id = st.list[0].id;
  let tx = T.get(st, id);
  tx = T.addNode(tx, 'developed', 'Small caps');
  const small = tx.nodes[0].children.find((n) => n.name === 'Small caps');
  ok('a child node under "developed"', !!small && /^n/.test(small.id), tx.nodes[0].children);
  tx = T.assign(tx, 'iusn.de', small.id);
  ok('assignments are per symbol (upper case)', tx.assign['IUSN.DE'] === small.id);
  tx = T.renameNode(tx, small.id, 'Small caps (world)');
  ok('rename a node', T.findNode(tx, small.id).name === 'Small caps (world)');
  tx = T.setTarget(tx, 'emerging', 25);
  ok('targets are clamped percentages', T.findNode(tx, 'emerging').target === 25 && T.findNode(T.setTarget(tx, 'emerging', 140), 'emerging').target === 100);
  tx = T.removeNode(tx, 'developed');
  ok('removing a node removes its subtree and those assignments', !T.findNode(tx, small.id) && !tx.assign['IUSN.DE'] && tx.nodes.length === 1);
  st = T.put(st, tx);
  ok('put stores the edited taxonomy', T.get(st, id).nodes.length === 1);
  st = T.rename(st, id, 'My split');
  ok('rename a taxonomy', T.get(st, id).name === 'My split');
  st = T.remove(st, id);
  ok('remove a taxonomy', st.list.length === 0);
  ok('normalize drops broken nodes and assignments to unknown nodes', T.normalize({ list: [{ id: 'x', name: 'X', nodes: [{ id: 'a', name: 'A' }, { name: '' }, null], assign: { aaa: 'a', bbb: 'zzz' } }] }).list[0].nodes.length === 1
    && JSON.stringify(T.normalize({ list: [{ id: 'x', name: 'X', nodes: [{ id: 'a', name: 'A' }], assign: { aaa: 'a', bbb: 'zzz' } }] }).list[0].assign) === '{"AAA":"a"}');
}

console.log('\nsuggestions from the app\'s data:');
{
  const holdings = [
    { symbol: 'AAPL', category: 'stocks', sector: 'Technology', country: 'USA' },
    { symbol: 'SAP.DE', category: 'stocks', sector: 'Technology', country: 'Germany' },
    { symbol: 'TSM', category: 'stocks', sector: 'Technology', country: 'Taiwan' },
    { symbol: 'JNJ', category: 'stocks', sector: 'Healthcare', country: 'USA' },
    { symbol: 'VWCE.DE', category: 'stocks', name: 'Vanguard FTSE All-World', fundType: 'aktienfonds', sector: 'ETF' },
    { symbol: 'EIMI.L', category: 'stocks', name: 'iShares Core MSCI Emerging Markets IMI', fundType: 'aktienfonds', sector: 'ETF' },
    { symbol: 'AGGH', category: 'stocks', name: 'iShares Core Global Aggregate Bond', sector: 'ETF' },
    { symbol: 'IPRP', category: 'stocks', name: 'iShares European Property Yield', fundType: 'immobilienfonds', sector: 'ETF' },
    { symbol: 'BTC', category: 'crypto' },
    { symbol: 'XAU', category: 'commodities' },
    { symbol: 'AK-47 | Redline', category: 'skins' }
  ];
  const a = T.suggest(T.fromTemplate('asset-classes'), holdings);
  ok('asset classes: shares and equity funds = equity, bond fund = bonds, property fund = real estate',
    a.AAPL === 'equity' && a['VWCE.DE'] === 'equity' && a.AGGH === 'bonds' && a.IPRP === 'real-estate', a);
  ok('... crypto = crypto, commodities = commodities, skins = other', a.BTC === 'crypto' && a.XAU === 'commodities' && a['AK-47 | REDLINE'] === 'other');
  const g = T.suggest(T.fromTemplate('gics'), holdings);
  ok('GICS from the sector; funds and coins are not guessed', g.AAPL === 'information-technology' && g.JNJ === 'health-care' && !g['VWCE.DE'] && !g.BTC, g);
  const r = T.suggest(T.fromTemplate('msci-regions'), holdings);
  ok('MSCI regions from the country (a leaf below developed / emerging)', r.AAPL === 'north-america' && r['SAP.DE'] === 'europe' && r.TSM === 'emerging' && !r.BTC, r);
  const km = T.suggest(T.fromTemplate('kommer'), holdings);
  ok('Kommer: emerging-markets funds and EM shares = emerging, world funds and DM shares = developed', km['EIMI.L'] === 'emerging' && km['VWCE.DE'] === 'developed' && km.TSM === 'emerging' && km.AAPL === 'developed' && !km.AGGH, km);
  const kept = T.suggest(T.assign(T.fromTemplate('kommer'), 'AAPL', 'emerging'), holdings);
  ok('existing assignments are never overwritten', !('AAPL' in kept));
}

console.log('\nallocation:');
{
  let tx = T.fromTemplate('msci-regions');
  tx = T.assign(T.assign(T.assign(tx, 'AAPL', 'north-america'), 'SAP.DE', 'europe'), 'TSM', 'emerging');
  const al = T.allocation(tx, [{ symbol: 'AAPL', value: 600 }, { symbol: 'SAP.DE', value: 200 }, { symbol: 'TSM', value: 100 }, { symbol: 'BTC', value: 100 }]);
  const dev = al.rows.find((x) => x.id === 'developed');
  ok('a parent adds up its children (developed = 800 of 1,000)', near(dev.value, 800) && near(dev.pct, 80) && dev.depth === 0, dev);
  const na = al.rows.find((x) => x.id === 'north-america');
  ok('leaves with depth and share', near(na.value, 600) && na.depth === 1 && near(na.pct, 60));
  ok('rows in tree order', al.rows.map((x) => x.id).join() === 'developed,north-america,europe,pacific,emerging', al.rows.map((x) => x.id));
  ok('unassigned holdings are listed apart', near(al.unassigned.value, 100) && al.unassigned.symbols.join() === 'BTC' && near(al.total, 1000));
  const top = T.planInput(T.setTarget(T.setTarget(tx, 'developed', 70), 'emerging', 30), [{ symbol: 'AAPL', value: 600 }, { symbol: 'SAP.DE', value: 200 }, { symbol: 'TSM', value: 100 }]);
  ok('rebalancing input: top-level nodes and their targets', JSON.stringify(top.actual.map((x) => [x.key, x.value])) === '[["developed",800],["emerging",100]]' && top.state.targets.developed === 70, top);
  const p = RB.plan(top.state, top.actual, { mode: 'full' });
  const em = p.rows.find((x) => x.key === 'emerging');
  ok('the planner buys emerging up to 30 % of 900 (+170)', em && em.action === 'buy' && near(em.deltaValue, 170, 1e-6), em);
}

console.log('\nJSON import / export:');
{
  const tx = T.assign(T.fromTemplate('kommer'), 'VWCE.DE', 'developed');
  const json = T.exportJson(tx);
  const o = JSON.parse(json);
  ok('export: a versioned file with nodes, targets and assignments', o.format === 'maermin-taxonomy' && o.version === 1 && o.taxonomy.nodes.length === 2 && o.taxonomy.assign['VWCE.DE'] === 'developed');
  const back = T.importJson(json);
  ok('import: the same tree, a new id', back.ok && back.taxonomy.nodes[0].target === 70 && back.taxonomy.assign['VWCE.DE'] === 'developed' && back.taxonomy.id !== tx.id);
  ok('import refuses other files', !T.importJson('{"a":1}').ok && !T.importJson('not json').ok && !T.importJson(JSON.stringify({ format: 'maermin-taxonomy', version: 9, taxonomy: {} })).ok);
  ok('import caps the size (500 nodes)', !T.importJson(JSON.stringify({ format: 'maermin-taxonomy', version: 1, taxonomy: { name: 'X', nodes: Array.from({ length: 501 }, (_, i) => ({ id: 'n' + i, name: 'N' + i })) } })).ok);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
