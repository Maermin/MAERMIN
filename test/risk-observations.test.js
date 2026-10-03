// Risk view gate: metrics are only shown when the price history can yield
// enough return observations (risk-analytics.js riskObservations /
// hasMeasurableRisk). Run: node test/risk-observations.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

const R = require('../risk-analytics.js');

console.log('risk observations:');
ok('no history -> 0 observations', R.riskObservations({}) === 0 && R.riskObservations(null) === 0);
ok('one price point -> 0 observations', R.riskObservations({ btc: [100] }) === 0);
ok('n points -> n-1 observations', R.riskObservations({ btc: [1, 2, 3, 4] }) === 3);
ok('longest series counts', R.riskObservations({ a: [1, 2], b: [1, 2, 3, 4, 5, 6, 7] }) === 6);
ok('{price} points are understood', R.riskObservations({ a: [{ price: 1 }, { price: 2 }, { price: 3 }] }) === 2);
ok('non-positive / junk points are ignored', R.riskObservations({ a: [1, 0, null, 'x', 2, NaN, 3], b: 'nope' }) === 2);
ok('below the minimum is not measurable', R.hasMeasurableRisk({ a: [1, 2, 3] }) === false);
ok('a single refresh is not measurable', R.hasMeasurableRisk({ btc: [{ price: 60000 }], aapl: [{ price: 120 }] }) === false);
const enough = Array.from({ length: R.MIN_RISK_OBSERVATIONS + 1 }, (_, i) => 100 + i);
ok('exactly the minimum is measurable', R.hasMeasurableRisk({ a: enough }) === true);

// The reason for the gate: with one point the engine reports zeros.
const m = R.calculatePortfolioRiskMetrics({ crypto: [{ symbol: 'btc', amount: 1, purchasePrice: 100 }] }, { btc: [100] }, 100);
ok('engine yields zero volatility on a single point (hence the gate)', m && m.volatility === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
