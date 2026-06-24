// Node harness for the earnings-calendar engine. Pure parse + build, no browser.
// Run: node test/earnings-calendar.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const E = require('../earnings-calendar.js');

const NOW = new Date('2026-03-10T12:00:00Z').getTime();
function iso(days) { return new Date(NOW + days * 86400000).toISOString().split('T')[0]; }

(function run() {
  console.log('earnings-calendar:');

  // ---- parseResponse ----
  ok('rejects error payloads', E.parseResponse({ error: 'x', symbol: 'AAPL' }) === null);
  ok('rejects payloads without a date', E.parseResponse({ symbol: 'AAPL' }) === null);
  const p = E.parseResponse({ symbol: 'aapl', name: 'Apple', earningsDate: iso(5), isEstimate: true, epsEstimate: 1.5, revenueEstimate: 1e11 });
  ok('parses + uppercases symbol', p && p.symbol === 'AAPL');
  ok('carries estimate fields', p.epsEstimate === 1.5 && p.isEstimate === true);

  // ---- buildCalendar ----
  const rows = [
    E.parseResponse({ symbol: 'MSFT', earningsDate: iso(3) }),
    E.parseResponse({ symbol: 'KO',   earningsDate: iso(40) }),
    E.parseResponse({ symbol: 'OLD',  earningsDate: iso(-5) }),   // past → dropped
    E.parseResponse({ symbol: 'FAR',  earningsDate: iso(400) }),  // beyond 6mo → dropped
  ];
  const cal = E.buildCalendar(rows, { now: NOW, months: 6 });
  ok('keeps only future-within-window reports', cal.length === 2);
  ok('drops past reports', !cal.find(r => r.symbol === 'OLD'));
  ok('drops beyond-horizon reports', !cal.find(r => r.symbol === 'FAR'));
  ok('sorted soonest first', cal[0].symbol === 'MSFT' && cal[1].symbol === 'KO');
  ok('daysUntil computed', cal[0].daysUntil === 3);

  ok('nextReport returns the soonest', E.nextReport(cal).symbol === 'MSFT');
  ok('nextReport of empty is null', E.nextReport([]) === null);
  ok('empty input → empty calendar', E.buildCalendar([], { now: NOW }).length === 0);

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
