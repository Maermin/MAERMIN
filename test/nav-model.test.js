// Node harness for P2-1: the navigation model (six areas, merged tab groups,
// Simple/Advanced mode).
// Run: node test/nav-model.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const fs = require('node:fs');
const path = require('node:path');
const N = require('../nav-model.js');

const ids = (list) => list.map((x) => x.id);

// --- areas ---
ok('six areas in plan order',
  ids(N.AREAS).join() === 'portfolio,transactions,dividends,analysis,taxes,settings');

// Every view the renderer can show belongs to exactly one area.
const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
const start = renderer.indexOf('const renderView = () =>');
const body = renderer.slice(start, renderer.indexOf('\n  };', start));
const rendered = [...body.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);
ok('renderView has cases', rendered.length > 20);
const missing = rendered.filter((id) => !N.isKnown(id));
ok('every rendered view has an area (missing: ' + missing.join(',') + ')', missing.length === 0);
ok('overview (default case) has an area', N.areaOf('overview') === 'portfolio');

const seen = {};
let dup = false;
N.AREAS.forEach((a) => a.entries.forEach((e) => (e.tabs || [e]).forEach((v) => { if (seen[v.id]) dup = true; seen[v.id] = 1; })));
ok('no view is listed twice', !dup);

// Command-palette targets still resolve.
const navTargets = [...renderer.matchAll(/case 'nav:[a-z-]+':\s+setActiveView\('([a-z-]+)'\)/g)].map((m) => m[1]);
ok('palette nav targets found', navTargets.length > 10);
ok('every palette target is known', navTargets.every(N.isKnown));

// --- aliases ---
ok('broker-import lives in Transactions', N.areaOf('broker-import') === 'transactions');
ok('montecarlo counts as Risk & Correlation', N.canonical('montecarlo') === 'analytics' && N.areaOf('stress') === 'analysis');
ok('unknown view has no area', N.areaOf('nope') === null && !N.isKnown('nope'));

// --- mode ---
ok('new vault starts simple', N.initialMode(null, 0) === 'simple');
ok('vault with transactions starts advanced', N.initialMode(null, 3) === 'advanced');
ok('stored mode wins', N.initialMode('simple', 50) === 'simple' && N.initialMode('advanced', 0) === 'advanced');
ok('junk stored mode is ignored', N.initialMode('expert', 0) === 'simple');

// --- visibility ---
const simpleAnalysis = ids(N.visibleEntries('analysis', 'simple', 'overview'));
ok('simple analysis shows only the two groups', simpleAnalysis.join() === 'grp-returns,grp-health');
ok('advanced analysis shows strategy, fees, discovery, news',
  ids(N.visibleEntries('analysis', 'advanced', 'overview')).join() === 'grp-returns,grp-health,investment-analysis,fees,discovery,news');
ok('simple settings shows Customize, Trash and Privacy', ids(N.visibleEntries('settings', 'simple', 'overview')).join() === 'customize,trash,privacy');
ok('an open advanced view stays visible in simple mode',
  ids(N.visibleEntries('settings', 'simple', 'tags')).indexOf('tags') > -1);
ok('every area has a view in simple mode', N.AREAS.every((a) => N.firstView(a.id, 'simple')));

// --- tabs ---
ok('returns group shows three tabs in advanced', ids(N.tabsFor('performance', 'advanced')).join() === 'returns,performance,attribution');
ok('returns group shows two tabs in simple', ids(N.tabsFor('returns', 'simple')).join() === 'returns,performance');
ok('health group in simple: one tab -> no strip', N.tabsFor('health', 'simple').length === 0);
ok('open hidden tab keeps the strip in simple', ids(N.tabsFor('intelligence', 'simple')).join() === 'health,intelligence');
ok('risk sub-view gets the health strip', ids(N.tabsFor('stress', 'advanced')).join() === 'health,intelligence,analytics');
ok('a plain view has no strip', N.tabsFor('tax', 'advanced').length === 0);

const grp = N.getArea('analysis').entries[1];
ok('group is active for its tabs', N.entryActive(grp, 'intelligence') && N.entryActive(grp, 'montecarlo') && !N.entryActive(grp, 'returns'));
ok('group opens its first shown tab', N.entryTarget(grp, 'simple') === 'health');
ok('area opens its first view', N.firstView('analysis', 'simple') === 'returns' && N.firstView('taxes', 'simple') === 'tax');

// --- persistence ---
const Backup = require('../backup-engine.js');
ok('mode key is backed up', Backup.KEYS.indexOf(N.MODE_KEY) > -1);
const Prefs = require('../prefs-store.js');
ok('mode pref reads the mode key', Prefs.SPEC.uiMode.key === N.MODE_KEY);
ok('unset mode loads as empty', Prefs.loadFrom(() => null).uiMode === '');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok('nav-model loads before the renderer', html.indexOf('nav-model.js') > -1 && html.indexOf('nav-model.js') < html.indexOf('renderer.js'));

// --- labels ---
ok('label uses translation', N.label(N.getArea('taxes'), { navAreaTaxes: 'Steuern' }) === 'Steuern');
ok('label falls back to English', N.label(N.getArea('taxes'), {}) === 'Taxes');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
