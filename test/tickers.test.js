// Tests for ticker validation/normalisation (#4). Run: node test/tickers.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

globalThis.window = {};
const T = require('../ticker-validation.js');

(function run() {
  console.log('normalizeForDividends:');
  ok('plain US ticker unchanged', T.normalizeForDividends('AAPL') === 'AAPL');
  ok('lowercase upcased', T.normalizeForDividends('aapl') === 'AAPL');
  ok('whitespace trimmed', T.normalizeForDividends('  msft ') === 'MSFT');
  ok('Xetra suffix preserved', T.normalizeForDividends('SAP.DE') === 'SAP.DE');
  ok('London suffix preserved', T.normalizeForDividends('ULVR.L') === 'ULVR.L');
  ok('share class dot → dash (BRK.B → BRK-B)', T.normalizeForDividends('BRK.B') === 'BRK-B');
  ok('share class dash preserved (BRK-B)', T.normalizeForDividends('BRK-B') === 'BRK-B');

  console.log('parseSymbol / exchange detection:');
  ok('SAP.DE → Xetra exchange', T.parseSymbol('SAP.DE').exchange === 'Xetra');
  ok('SAP.DE base = SAP', T.parseSymbol('SAP.DE').base === 'SAP');
  ok('BRK.B → share class B, no exchange', T.parseSymbol('BRK.B').shareClass === 'B' && T.parseSymbol('BRK.B').exchange === null);

  console.log('validate:');
  ok('valid US ticker', T.validate('AAPL', 'stocks').valid === true);
  ok('valid European ticker reports exchange', T.validate('ASML.AS', 'stocks').exchange === 'Amsterdam');
  ok('name with space rejected', T.validate('Apple Inc', 'stocks').valid === false && T.validate('Apple Inc', 'stocks').reason === 'looks-like-name');
  ok('empty rejected', T.validate('', 'stocks').valid === false);
  ok('crypto category not dividend-eligible', T.validate('BTC', 'crypto').valid === false && T.validate('BTC', 'crypto').reason === 'not-an-equity');
  ok('stocks category eligible', T.isDividendEligible('stocks') === true);

  console.log('validatePortfolio:');
  const report = T.validatePortfolio({ stocks: [
    { symbol: 'AAPL' }, { symbol: 'SAP.DE' }, { symbol: 'Some Company Ltd' }, { symbol: 'BRK.B' }
  ] });
  ok('counts total stocks', report.total === 4);
  ok('flags the unresolved name', report.unresolved === 1 && report.invalid[0].symbol === 'Some Company Ltd');
  ok('valid ones normalised', report.valid.find(v => v.symbol === 'BRK.B').verdict.normalized === 'BRK-B');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
