// Glossary popovers (audit 2026-10-24, feature 6).
// Run: node test/glossary.test.js
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
const I18N = require('../i18n.js');
globalThis.window.MaerminI18n = I18N;
const G = require('../glossary.js');

console.log('terms:');
const ids = Object.keys(G.TERMS);
ok('the seven terms', ids.join() === 'xirr,twr,maxDrawdown,vorabpauschale,teilfreistellung,sparerpauschbetrag,freistellungsauftrag', ids.join());
ok('every term has a title and a text in English', ids.every((id) => { const e = G.entry(id); return e.title && e.text.length > 40; }));
const T = require('../translations-complete.js');
const keysOf = (lang) => Object.keys((T.translations || T)[lang] || {});
const de = new Set(keysOf('de')), en = new Set(keysOf('en'));
const used = ['glWhatIs', 'glXirrT', 'glXirr', 'glTwrT', 'glTwr', 'glMddT', 'glMdd', 'glVapT', 'glVap', 'glTfT', 'glTf', 'glSpbT', 'glSpb', 'glFsaT', 'glFsa'];
ok('every text key exists in en and de', used.every((k) => en.has(k) && de.has(k)), used.filter((k) => !en.has(k) || !de.has(k)).join());
ok('no advice: no "you should", "buy", "sell now", "recommend"', ids.every((id) => !/you should|recommend|sell now|\bbuy\b/i.test(G.entry(id).text)));
ok('an unknown term is null', G.entry('nope') === null);

console.log('markup:');
const m = renderToStaticMarkup(React.createElement(G.Term, { id: 'xirr' }, 'XIRR (annualized)'));
ok('the label text is unchanged (the "?" is CSS)', />XIRR \(annualized\)<button/.test(m) && /<button[^>]*><\/button>/.test(m), m);
ok('the button names the term and starts closed', /aria-label="What is XIRR \(money-weighted return\)\?"/.test(m) && /aria-expanded="false"/.test(m), m);
ok('no popover while closed', !/glossary-pop/.test(m));
ok('an unknown id renders just the label', renderToStaticMarkup(React.createElement(G.Term, { id: 'nope' }, 'Label')) === 'Label');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
