// The Worker reports WORKER_VERSION on ?action=version and the app compares it
// with EXPECTED_WORKER_VERSION (onboarding.js). Both must name the same release,
// and the route must answer without an upstream call.
// Run: node test/worker-version.test.js
'use strict';
const { readFileSync } = require('node:fs');
const path = require('node:path');

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

(async function run() {
const W = await import('../cf-worker/worker.js');
const O = require('../onboarding.js');
console.log('worker version handshake:');
ok('worker and app name the same version', W.WORKER_VERSION === O.EXPECTED_WORKER_VERSION, W.WORKER_VERSION + ' vs ' + O.EXPECTED_WORKER_VERSION);
ok('version format YYYY.M.N', /^\d{4}\.\d{1,2}\.\d+$/.test(W.WORKER_VERSION));

const src = readFileSync(path.join(__dirname, '../cf-worker/worker.js'), 'utf8');
const routes = [...new Set([...src.matchAll(/action === '([a-z]+)'/g)].map((m) => m[1]))].sort();
ok('WORKER_ACTIONS lists every route', routes.join() === [...W.WORKER_ACTIONS].sort().join(), routes.join());

let upstream = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { upstream++; throw new Error('no upstream expected'); };
try {
  const r = await W.default.fetch(new Request('https://w.example.dev/?action=version', { headers: { Origin: 'http://localhost:8080' } }), {}, {});
  const body = await r.json();
  ok('?action=version → 200 { version, actions }', r.status === 200 && body.version === W.WORKER_VERSION && Array.isArray(body.actions) && body.actions.includes('yf'), r.status + ' ' + JSON.stringify(body));
  ok('no upstream request for the version', upstream === 0);
} finally { globalThis.fetch = realFetch; }

const toml = readFileSync(path.join(__dirname, '../cf-worker/wrangler.toml'), 'utf8');
ok('wrangler.toml has no placeholder resource id (Deploy button provisions KV)', !/REPLACE_WITH|^\s*id\s*=/m.test(toml));

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})();
