// Node harness for P5-5.6: the sync engine with its three destinations
// (Worker, local file, WebDAV). Configuring keeps no secret in the plain
// config; switching to another destination starts without a merge base, so an
// older copy found there cannot overwrite newer local data; the WebDAV login
// is encrypted, device-local and never in a backup. (The round-trip through
// a WebDAV server runs in the e2e test, with the real vault.)
// Run: node test/sync-destinations.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;
const fs = require('fs');
const path = require('path');
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
  key: (i) => Array.from(mem.keys())[i] || null, get length() { return mem.size; }, clear: () => mem.clear()
};
const S = require('../sync-engine.js');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

(async function run() {
  console.log('sync destinations:');
  const fakeHandle = { name: 'maermin-sync.json', getFile: async () => ({ text: async () => '' }), createWritable: async () => ({ write: async () => {}, close: async () => {} }) };

  S.configure({ provider: 'worker', endpoint: 'https://w.example.workers.dev' });
  ok('worker: configured as before', S.isConfigured() && S.getConfig().provider === 'worker');
  localStorage.setItem(S.STATE_KEY, JSON.stringify({ rev: 7, lastHash: 'abcd1234', lastSyncAt: 5 }));
  localStorage.setItem('maermin_sync_base', JSON.stringify({ transactions: 'ffff0000' }));
  S.configure({ provider: 'worker', endpoint: 'https://w.example.workers.dev' });
  ok('the same destination again keeps the sync state', JSON.parse(localStorage.getItem(S.STATE_KEY)).lastHash === 'abcd1234');

  S.configure({ provider: 'webdav', endpoint: 'https://cloud.example.org/dav/MAERMIN', username: 'anna', password: 'app-pass-1', fetchImpl: async () => new Response('', { status: 404 }) });
  const cfg = S.getConfig();
  ok('webdav: configured, the plain config holds provider and folder only', S.isConfigured() && cfg.provider === 'webdav' && cfg.endpoint === 'https://cloud.example.org/dav/MAERMIN' && !/app-pass-1|anna/.test(localStorage.getItem('maermin_sync_config')), cfg);
  const st = JSON.parse(localStorage.getItem(S.STATE_KEY));
  ok('switching the destination starts over: no last hash, revision 0, empty merge base', st.lastHash === null && st.rev === 0 && localStorage.getItem('maermin_sync_base') === '{}', { st, base: localStorage.getItem('maermin_sync_base') });

  S.configure({ provider: 'file', handle: fakeHandle, endpoint: fakeHandle.name });
  ok('file: configured with the handle, the config names the file', S.isConfigured() && S.getConfig().provider === 'file' && S.getConfig().endpoint === 'maermin-sync.json');
  ok('without an unlocked vault no MAC is accepted', (await S.verifyMac('a', 0, 'b', 'c')) === false);

  S.disconnect();
  ok('disconnect: no transport, no config, the WebDAV login removed', !S.isConfigured() && S.getConfig() === null && localStorage.getItem('maermin_webdav') === null);

  // ---- where the WebDAV login is kept ------------------------------------------------
  const storage = read('storage.js'), sync = read('sync-engine.js'), backup = read('backup-engine.js'), mcp = read('mcp/lib/index.js');
  ok('maermin_webdav is encrypted at rest, device-local, not in the backup and dropped by the MCP server', /'maermin_webdav'/.test(storage) && /LOCAL_ONLY_KEYS[^;]*'maermin_webdav'/.test(sync) && !/'maermin_webdav'/.test(backup) && /DROP[^;]*'maermin_webdav'/.test(mcp));
  ok('the engine never syncs the login (device-local key)', S.syncableKey('maermin_webdav') === false);
  ok('index.html loads the transports before the engine', (() => { const h = read('index.html'); const a = h.indexOf('sync-transports.js'), b = h.indexOf('sync-engine.js'); return a > 0 && b > a; })());

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
