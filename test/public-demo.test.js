// Node harness for P5-1.9: the public demo link (MaerminPublicDemo).
// Run: node test/public-demo.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const P = require('../public-demo.js');
const fs = require('fs');
const path = require('path');

(function run() {
  console.log('the ?demo parameter:');
  ok('?demo, ?demo=1, ?demo=true switch it on', ['?demo', '?demo=1', '?demo=true', '?x=1&demo', 'demo'].every(P.isDemoQuery));
  ok('anything else leaves it off', ['', '?', '?demo=0', '?demo=no', '?demonstration', '?x=demo', '?nodemo=1'].every((s) => !P.isDemoQuery(s)));
  ok('exit URL drops only the demo parameter', P.exitUrl({ pathname: '/MAERMIN/', search: '?demo', hash: '' }) === '/MAERMIN/' && P.exitUrl({ pathname: '/', search: '?a=1&demo=1', hash: '#x' }) === '/?a=1#x');

  console.log('in-memory storage:');
  const s = P.memStorage({ a: '1' });
  s.setItem('b', 2);
  ok('get/set/remove/key/length like Storage, values as strings', s.getItem('a') === '1' && s.getItem('b') === '2' && s.length === 2 && s.key(1) === 'b' && s.getItem('none') === null);
  s.removeItem('a'); s.clear();
  ok('remove and clear', s.length === 0 && s.getItem('b') === null);
  ok('a key named like a method does not break it', (s.setItem('getItem', 'x'), s.getItem('getItem') === 'x' && typeof s.getItem === 'function'));

  console.log('activation (a fake window):');
  const real = P.memStorage({ maermin_vault_meta: 'REAL', transactions: '[1]' });
  const win = { localStorage: real, sessionStorage: P.memStorage(), indexedDB: {} };
  ok('activate swaps the stores and hides IndexedDB', P.activate(win) === true && win.localStorage !== real && win.indexedDB === undefined);
  ok('the demo tab starts with demo on and onboarding done, nothing else', win.localStorage.getItem('maermin_demo') === '1' && win.localStorage.getItem('maermin_onboarded') === '1' && win.localStorage.length === 2);
  win.localStorage.setItem('transactions', '[]');
  win.sessionStorage.setItem('maermin_relocked', '1');
  ok('writes in the demo never reach the real storage', real.getItem('transactions') === '[1]' && real.getItem('maermin_vault_meta') === 'REAL' && real.length === 2);
  const frozen = Object.freeze({ localStorage: real });
  ok('fails closed (stays a normal page) when the swap is impossible', P.activate(frozen) === false && frozen.localStorage === real);

  console.log('wiring:');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const local = [...html.matchAll(/<script\s+[^>]*src="([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^https?:/.test(s));
  ok('public-demo.js is the first local script (before anything touches storage)', local[0] === 'public-demo.js', local.slice(0, 3).join(', '));
  const auth = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
  ok('auth.js skips the vault only for an active public demo', /MaerminPublicDemo && window\.MaerminPublicDemo\.active/.test(auth));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
