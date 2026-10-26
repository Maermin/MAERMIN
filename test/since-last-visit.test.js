// "Since your last visit" (audit 2026-10-24, feature 5).
// Run: node test/since-last-visit.test.js
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
const SV = require('../since-last-visit.js');
const SN = require('../portfolio-snapshots.js');

console.log('begin (the visit day):');
const mem = {};
const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
ok('a first visit has no previous day', SV.begin(store, '2026-03-02') === null && mem[SV.KEY] === '2026-03-02');
ok('the next day returns the previous day and records today', SV.begin(store, '2026-03-05') === '2026-03-02' && mem[SV.KEY] === '2026-03-05');
ok('a stored value that is not a date is ignored', (mem[SV.KEY] = 'x', SV.begin(store, '2026-03-06')) === null);
ok('a throwing storage gives no previous day', SV.begin({ getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } }, '2026-03-06') === null);
ok('the key is device-local (not in the backup keys)', !require('../backup-engine.js').KEYS.includes(SV.KEY));

console.log('summarize:');
const snaps = { version: 1, points: [{ d: '2026-03-01', v: 1000, pid: 'all' }, { d: '2026-03-02', v: 1100, pid: 'all' }, { d: '2026-03-05', v: 1210, pid: 'all' }] };
const txs = [
  { type: 'dividend', date: '2026-03-03' }, { type: 'interest', date: '2026-03-05' },
  { type: 'dividend', date: '2026-03-02' },               // on the last-visit day: already seen
  { type: 'buy', source: 'savings-plan', date: '2026-03-04' },
  { type: 'buy', date: '2026-03-04' },                    // a manual buy is not a plan execution
  { type: 'dividend', date: '2026-03-09' }                 // future-dated
];
const s = SV.summarize({ since: '2026-03-02', today: '2026-03-05', snapshots: SN, snapshotState: snaps, transactions: txs });
ok('value change from the last-visit day to the latest point', s && Math.abs(s.value.abs - 110) < 1e-9 && Math.abs(s.value.pct - 10) < 1e-9, JSON.stringify(s));
ok('income counts payments after the last visit up to today', s.income === 2);
ok('savings-plan executions counted, manual buys not', s.plans === 1);
ok('days since the last visit', s.days === 3);
ok('same day: nothing', SV.summarize({ since: '2026-03-05', today: '2026-03-05', transactions: txs }) === null);
ok('no snapshot after the last visit: no value part', SV.summarize({ since: '2026-03-05', today: '2026-03-06', snapshots: SN, snapshotState: snaps, transactions: [] }) === null);
ok('nothing to say: null', SV.summarize({ since: '2026-03-02', today: '2026-03-05', transactions: [] }) === null);
ok('bad dates: null', SV.summarize({ since: 'x', today: '2026-03-05' }) === null);

console.log('card:');
const m = renderToStaticMarkup(React.createElement(SV.Card, { summary: s, formatValue: (v) => v.toFixed(2) + ' €' }));
ok('title, value, income and plans', /Since your last visit/.test(m) && /\+110\.00 €/.test(m) && /2 dividend and interest payments booked/.test(m) && /1 savings-plan execution booked/.test(m), m);
ok('the value says money added is included', /includes money added or taken out/.test(m));
const masked = renderToStaticMarkup(React.createElement(SV.Card, { summary: s, masked: true, formatValue: (v) => v.toFixed(2) + ' €' }));
ok('privacy mode hides the amount', !/110\.00/.test(masked));
ok('no inline styles', !/style="/.test(m));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
