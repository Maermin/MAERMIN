// "What's new" after an update (audit 2026-10-24, feature 7).
// Run: node test/whats-new.test.js
'use strict';
const fs = require('fs');
const path = require('path');
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
const WN = require('../whats-new.js');

console.log('parseLatest:');
const md = [
  '# Release Notes', '',
  '## [v13.0.0] "Next" — 1 November 2026', '',
  '> **Feature release** · No data migration · see [docs](x.md)', '',
  '### Highlights', '',
  '- **Undo an import** (Import / Export): `importId` on rows.',
  '  - a nested point is not a highlight',
  '- **First steps** on the Overview.', '',
  '### Upgrading', '', '- not a highlight', '',
  '## [v12.2.0] "Atlas Charts" — 24 October 2026', '', '### Highlights', '', '- old'
].join('\n');
const n = WN.parseLatest(md);
ok('version, title and date of the newest section', n && n.version === '13.0.0' && n.title === 'Next' && n.date === '1 November 2026', JSON.stringify(n));
ok('the summary line, markdown stripped', n.summary === 'Feature release · No data migration · see docs', n.summary);
ok('only top-level highlights, plain text', JSON.stringify(n.highlights) === JSON.stringify(['Undo an import (Import / Export): importId on rows.', 'First steps on the Overview.']), JSON.stringify(n.highlights));
ok('key names keep their underscores', WN.plain('two keys (`maermin_chart_prefs`, **new**)') === 'two keys (maermin_chart_prefs, new)', WN.plain('two keys (`maermin_chart_prefs`, **new**)'));
ok('no release section: null', WN.parseLatest('# nothing') === null);
const real = WN.parseLatest(fs.readFileSync(path.join(__dirname, '..', 'RELEASE.md'), 'utf8'));
ok('the real RELEASE.md parses, and its newest version is the app\'s version', real && real.version === require('../backup-engine.js').VERSION && real.highlights.length > 0, JSON.stringify(real && { v: real.version, n: real.highlights.length }));

console.log('check:');
const mem = {};
const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
ok('a new install records the version silently', WN.check(store, '12.2.0') === 'first' && mem[WN.KEY] === '12.2.0');
ok('the same version again: seen', WN.check(store, '12.2.0') === 'seen');
ok('a new version: show (not recorded until Got it)', WN.check(store, '13.0.0') === 'show' && mem[WN.KEY] === '12.2.0');
WN.markSeen(store, '13.0.0');
ok('Got it records it', WN.check(store, '13.0.0') === 'seen');
ok('the key is device-local (not in the backup keys)', !require('../backup-engine.js').KEYS.includes(WN.KEY));

console.log('card:');
const m = renderToStaticMarkup(React.createElement(WN.Card, { notes: n }));
ok('title, summary, highlights and the full-notes link', /What&#x27;s new in 13\.0\.0 · Next/.test(m) && /No data migration/.test(m) && /First steps on the Overview/.test(m) && m.includes(WN.NOTES_URL) && /rel="noopener noreferrer"/.test(m), m);
ok('no inline styles', !/style="/.test(m));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
