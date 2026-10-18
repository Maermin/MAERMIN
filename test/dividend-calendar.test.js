// Dividend Calendar (AUDIT BUG-037): the auto-derived payout schedule never
// showed - a call to an undefined freqLabel() threw inside the derivation's
// try/catch, so every holder saw "Year …: €0.00". Totals must also be in EUR.
// Run: node test/dividend-calendar.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
globalThis.React = React;
globalThis.window = globalThis;
globalThis.localStorage = { _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const _log = console.log; console.log = () => {};
window.MaerminI18n = require('../i18n.js');
window.MaerminUtils = require('../utils.js');
window.MaerminComponents = require('../renderer-components.js').Components; // R4.6: the calendar renders the shared components
require('../features2.js');
console.log = _log;

const now = new Date();
const y = now.getFullYear();
const iso = (m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
// Two USD payouts this year (one this month), as DividendDataService derives them.
window.DividendDataService = {
  buildPaymentSchedule: () => [
    { symbol: 'AAPL', date: iso(now.getMonth() + 1, 1), perShare: 0.25, shares: 10, amount: 2.5, currency: 'USD', frequency: 'quarterly', past: true },
    { symbol: 'AAPL', date: iso(now.getMonth() + 1 > 3 ? now.getMonth() - 2 : now.getMonth() + 1, 2), perShare: 0.25, shares: 10, amount: 2.5, currency: 'USD', frequency: 'quarterly', past: true }
  ]
};

console.log('dividend calendar:');
const html = renderToStaticMarkup(React.createElement(window.MaerminFeatures2.DividendCalendarView, {
  portfolio: { stocks: [{ symbol: 'AAPL', amount: 10 }] }, prices: {}, metaVersion: 0, theme: {}, t: {},
  events: [], setEvents: () => {}, exchangeRate: 0.9
}));
const m = html.match(/Year \d{4}: ([^<]+)/);
ok('the derived payouts reach the calendar (year total is not 0)', m && !/0\.00/.test(m[1]), m ? m[1] : html.slice(0, 200));
ok('the year total is in EUR: 2 x 2.50 USD x 0.9 = 4.50', m && /4\.50/.test(m[1]), m ? m[1] : '');
ok('a derived payout shows its frequency in words', /Quarterly/.test(html));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
