// P5-3.1: which Worker the app asks for market data. An own Worker always
// wins; without one the shared price Worker is used (when it exists and the
// user did not switch it off); user-data routes never go to the shared one.
// Run: node test/shared-worker.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

const SW = require('../shared-worker.js');
const SHARED = 'https://prices.example.workers.dev';

console.log('market Worker:');
ok('an own Worker always wins', SW.marketBase('https://mine.workers.dev/', { shared: SHARED, enabled: true }) === 'https://mine.workers.dev');
ok('no own Worker: the shared one', SW.marketBase('', { shared: SHARED, enabled: true }) === SHARED);
ok('... unless switched off', SW.marketBase('', { shared: SHARED, enabled: false }) === '');
ok('no shared Worker configured (empty constant): nothing', SW.marketBase('  ', { shared: '', enabled: true }) === '');
ok('the built-in shared URL is empty until the owner sets one, so nothing changes', SW.SHARED_URL === '' && SW.marketBase('', { enabled: true }) === '');
ok('a shared URL must be https', SW.marketBase('', { shared: 'http://prices.example.workers.dev', enabled: true }) === '');
ok('isShared tells the shared Worker apart', SW.isShared(SHARED, { shared: SHARED }) && !SW.isShared('https://mine.workers.dev', { shared: SHARED }) && !SW.isShared('', { shared: SHARED }));

console.log('\nuser-data Worker:');
ok('user data (sync, share, MCP, broker relay, Steam inventory) only ever uses the own Worker', SW.dataBase('', { shared: SHARED, enabled: true }) === '' && SW.dataBase('https://mine.workers.dev/', { shared: SHARED }) === 'https://mine.workers.dev');

console.log('\nthe setting:');
ok('on by default; "off" switches it off', SW.enabledFrom(null) === true && SW.enabledFrom('on') === true && SW.enabledFrom('off') === false);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
