// "First steps" checklist on the Overview (audit 2026-10-24, feature 4).
// Run: node test/first-steps.test.js
'use strict';
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }

const noop = () => {};
globalThis.React = React;
globalThis.window = globalThis.window || {};
globalThis.window.React = React;
globalThis.document = globalThis.document || { addEventListener: noop, removeEventListener: noop, documentElement: { getAttribute: () => 'dark' } };
globalThis.window.matchMedia = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
globalThis.window.MaerminI18n = require('../i18n.js');
globalThis.window.MaerminUtils = require('../utils.js');
globalThis.window.MaerminUI = require('../ui-store.js');
require('../renderer-components.js');
const FS = require('../first-steps.js');

console.log('steps from the user\'s data:');
const empty = FS.steps({});
ok('four steps in a fixed order', empty.map((s) => s.id).join() === 'transaction,prices,backup,tax');
ok('nothing done in an empty vault', empty.every((s) => !s.done));
const some = FS.steps({ txCount: 3, workerUrl: 'https://w.example.workers.dev', lastBackup: 0, taxSaved: false });
ok('transaction and prices done', some[0].done && some[1].done && !some[2].done && !some[3].done);
ok('a blank Worker URL is not a price source', !FS.steps({ workerUrl: '   ' })[1].done);
ok('summary counts', JSON.stringify(FS.summary(some)) === JSON.stringify({ done: 2, total: 4, complete: false }));
const all = { txCount: 1, workerUrl: 'https://w.example.workers.dev', lastBackup: 1, taxSaved: true };
ok('all done = complete', FS.summary(FS.steps(all)).complete);

console.log('when the card shows:');
ok('not in an empty vault (the Welcome card leads there)', !FS.shouldShow({}));
ok('after the first transaction while something is open', FS.shouldShow({ txCount: 1 }));
ok('not when everything is done', !FS.shouldShow(all));

console.log('read() from storage:');
const store = (d) => ({ getItem: (k) => (k in d ? d[k] : null) });
const r = FS.read(store({ maermin_backup_reminder: JSON.stringify({ lastBackup: 1700000000000 }), maermin_tax_settings: '{}' }), 5, 'https://x.workers.dev');
ok('reads the backup time and the tax settings', r.lastBackup === 1700000000000 && r.taxSaved === true && r.txCount === 5);
ok('no tax settings in the German system = open', FS.read(store({}), 1, '').taxSaved === false);
ok('another tax system has nothing to set up', FS.read(store({ taxJurisdiction: 'us' }), 1, '').taxSaved === true);
ok('broken JSON reads as no backup', FS.read(store({ maermin_backup_reminder: '{' }), 0, '').lastBackup === 0);
ok('a throwing storage reads as nothing done', FS.read({ getItem: () => { throw new Error('x'); } }, 0, '').lastBackup === 0);

console.log('card markup:');
const m = renderToStaticMarkup(React.createElement(FS.Card, { state: { txCount: 2, workerUrl: '', lastBackup: 0, taxSaved: true } }));
ok('title and progress', /First steps/.test(m) && /2 of 4 done/.test(m), m);
ok('done steps are marked for screen readers too', /data-step="tax" data-done="true"/.test(m) && /— done/.test(m));
ok('open steps with an action get a button, done ones none', /data-step-action="prices"/.test(m) && /data-step-action="backup"/.test(m) && !/data-step-action="tax"/.test(m) && !/data-step-action="transaction"/.test(m));
ok('a hide button', /data-testid="first-steps-hide"/.test(m));
ok('no inline styles', !/style="/.test(m));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
