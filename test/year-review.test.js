// Year in review (audit 2026-10-24, feature 8).
// Run: node test/year-review.test.js
'use strict';
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }
const near = (a, b) => Math.abs(a - b) < 1e-6;

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
const YR = require('../year-review.js');
const RF = require('../return-figures.js');
const SN = require('../portfolio-snapshots.js');

const T = (o) => Object.assign({ category: 'stocks', currency: 'EUR', portfolioId: 'default', fees: 0 }, o);
const txs = [
  T({ id: 'a', type: 'buy', symbol: 'SECRETCO', quantity: 10, price: 100, date: '2025-03-01', fees: 1 }),
  T({ id: 'b', type: 'buy', symbol: 'SECRETCO', quantity: 10, price: 120, date: '2026-02-01', fees: 1 }),
  T({ id: 'c', type: 'sell', symbol: 'SECRETCO', quantity: 5, price: 150, date: '2026-05-01', fees: 1 }),
  T({ id: 'd', type: 'dividend', symbol: 'SECRETCO', quantity: 15, price: 2, date: '2026-06-01' }),
  T({ id: 'e', type: 'buy', symbol: 'SECRETCO', quantity: 1, price: 100, date: '2026-12-20' })
];
const figures = (list, asOf) => RF.compute(list, { securitiesValueEUR: 0, exchangeRate: 0.9, today: asOf });

console.log('years:');
ok('years with transactions, newest first, not after today', YR.years(txs, '2026-10-26').join() === '2026,2025');

console.log('review 2026 (so far, 26 Oct):');
const snaps = { version: 1, points: [{ d: '2025-12-31', v: 1100, pid: 'all' }, { d: '2026-10-25', v: 2310, pid: 'all' }] };
const r = YR.review({ year: 2026, transactions: txs, today: '2026-10-26', figures, snapshots: SN, snapshotState: snaps });
ok('partial year up to today', r.partial === true && r.asOf === '2026-10-26');
ok('invested in the year = the February buy incl. fees (the December buy is after today)', near(r.flows.invested, 1201), JSON.stringify(r.flows));
ok('realised gain of the May sale (FIFO from the 2025 lot)', near(r.flows.realized, 5 * 150 - 1 - 5 * 100.1), JSON.stringify(r.flows));
ok('dividends of the year', near(r.flows.dividendsNet, 30), JSON.stringify(r.flows));
ok('counts: buys, sales, payments in the year up to today', JSON.stringify(r.counts) === JSON.stringify({ buys: 1, sells: 1, income: 1 }));
ok('value from the year-end and the latest snapshot', r.value && r.value.start === 1100 && r.value.end === 2310 && near(r.value.pct, 110), JSON.stringify(r.value));
const noSnap = YR.review({ year: 2026, transactions: txs, today: '2026-10-26', figures, snapshots: SN, snapshotState: { version: 1, points: [{ d: '2024-06-30', v: 500, pid: 'all' }, { d: '2026-10-25', v: 2310, pid: 'all' }] } });
ok('no snapshot near the previous year-end: no value (no estimate)', noSnap.value === null);
const full = YR.review({ year: 2025, transactions: txs, today: '2026-10-26', figures });
ok('a past year is complete', full.partial === false && full.asOf === '2025-12-31' && near(full.flows.invested, 1001));

console.log('share text (percent and counts only):');
const text = YR.shareText(r);
ok('says the year, the value change in percent and the counts', /2026/.test(text) && /\+110\.0\s?%/.test(text) && /1 buy, 1 sale, 1 dividend or interest payment/.test(text), text);
const amounts = ['1100', '1,100', '2310', '2,310', '1201', '1,201', '30.00', '248', 'SECRETCO', 'default'];
ok('no amount, symbol or portfolio in it', amounts.every((a) => !text.includes(a)), text);

console.log('panel:');
const m = renderToStaticMarkup(React.createElement(YR.Panel, { transactions: txs, today: '2026-10-26', figures, snapshots: SN, snapshotState: snaps, formatPrice: (v) => v.toFixed(2), getCurrencySymbol: () => '€' }));
ok('title, tiles and the copy button', /Year in review 2026/.test(m) && /data-stat="realized"/.test(m) && /year-review-copy/.test(m), m.slice(0, 300));
ok('no inline styles', !/style="/.test(m));
ok('no transactions: nothing', renderToStaticMarkup(React.createElement(YR.Panel, { transactions: [], figures, formatPrice: String, getCurrencySymbol: () => '€' })) === '');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
