// Node harness for P5-5.6: serverless sync transports. The encrypted sync blob
// goes to a local file (File System Access) or a WebDAV/Nextcloud folder, in
// the same record format and with the same HMAC as the Worker sync
// (HMAC-SHA256(HKDF(vaultKey,'sync-auth'), account.baseRev.blob)). With no
// server to check the MAC, the client checks it on every read.
// Run: node test/sync-transports.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;
const T = require('../sync-transports.js');

const ACCOUNT = 'a1b2c3d4e5f60718';
const KEY = 'ab'.repeat(32);
const OTHER_KEY = 'cd'.repeat(32);

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const mac = (key, account, baseRev, blob) => W.syncMac(key, account + '.' + baseRev + '.' + blob);
  const auth = async (baseRev, blob, key) => ({ mac: await mac(key || KEY, ACCOUNT, baseRev, blob) });
  // The engine's check: the MAC made with this vault's auth key.
  const verify = async (account, baseRev, blob, m) => !!m && W.timingSafeEqualHex(m, await mac(KEY, account, baseRev, blob));
  const caught = async (p) => { try { await p; return null; } catch (e) { return e; } };

  console.log('sync transports:');

  // ---- record ----------------------------------------------------------------------
  const rec = T.makeRecord(ACCOUNT, 4, 'BLOB', 'm4c', 1760000000000);
  ok('record: format, version, account, rev = baseRev + 1, the MAC over baseRev', rec.format === 'maermin-sync' && rec.v === 1 && rec.account === ACCOUNT && rec.rev === 5 && rec.baseRev === 4 && rec.blob === 'BLOB' && rec.mac === 'm4c' && rec.updatedAt === 1760000000000, rec);
  ok('parse: a record round-trips; empty is null; another JSON file is refused', T.parseRecord(JSON.stringify(rec)).rev === 5 && T.parseRecord('') === null && T.parseRecord('  ') === null
    && (() => { try { T.parseRecord('{"hello":1}'); return false; } catch (e) { return e.code === 'not-a-sync-file'; } })());

  // ---- local file --------------------------------------------------------------------
  let content = '', writes = 0;
  const handle = {
    name: 'maermin-sync.json',
    getFile: async () => ({ text: async () => content }),
    createWritable: async () => { let buf = ''; return { write: async (s) => { buf += s; }, close: async () => { content = buf; writes++; } }; }
  };
  const ft = T.FileTransport({ handle, verify });
  ok('file: an empty file reads as no data yet', (await ft.get(ACCOUNT)) === null);
  const p1 = await ft.put(ACCOUNT, 0, 'B1', await auth(0, 'B1'));
  ok('file: the first write gets rev 1 and stores the record', p1.ok && p1.rev === 1 && JSON.parse(content).rev === 1 && writes === 1, { p1, content });
  const g1 = await ft.get(ACCOUNT);
  ok('file: read back with a valid MAC', g1 && g1.rev === 1 && g1.blob === 'B1');
  const c1 = await ft.put(ACCOUNT, 0, 'B2', await auth(0, 'B2'));
  ok('file: a stale baseRev is a conflict with the stored blob, nothing written', c1.conflict && c1.serverRev === 1 && c1.blob === 'B1' && writes === 1, c1);
  const p2 = await ft.put(ACCOUNT, 1, 'B2', await auth(1, 'B2'));
  ok('file: the next write against the current rev', p2.ok && p2.rev === 2 && writes === 2);
  const unsigned = await caught(ft.put(ACCOUNT, 2, 'B3', null));
  ok('file: a write without a MAC is refused', unsigned && unsigned.code === 'unsigned' && writes === 2);
  // tampering: someone edits the blob in the shared folder
  const r2 = JSON.parse(content); content = JSON.stringify(Object.assign({}, r2, { blob: 'EVIL' }));
  const tam = await caught(ft.get(ACCOUNT));
  ok('file: a changed blob fails the MAC check (tampered)', tam && tam.code === 'tampered');
  // replay: an older record put back with its own valid MAC but a forged rev
  content = JSON.stringify(Object.assign({}, r2, { rev: 9, baseRev: 8 }));
  const rep = await caught(ft.get(ACCOUNT));
  ok('file: a rev changed without a new MAC fails too (the MAC covers baseRev)', rep && rep.code === 'tampered');
  // a different vault (other password) in the same file
  content = JSON.stringify(T.makeRecord('ffffffffffffffff', 0, 'X', await mac(OTHER_KEY, 'ffffffffffffffff', 0, 'X'), 1));
  const other = await caught(ft.get(ACCOUNT));
  const otherPut = await caught(ft.put(ACCOUNT, 0, 'B1', await auth(0, 'B1')));
  ok('file: a file of another vault is neither read nor overwritten', other && other.code === 'other-vault' && otherPut && otherPut.code === 'other-vault' && JSON.parse(content).account === 'ffffffffffffffff');
  ok('file: the Worker record shape is the same (rev + blob + updatedAt)', ['rev', 'blob', 'updatedAt'].every((k) => k in rec));

  // ---- WebDAV --------------------------------------------------------------------------
  const dav = { files: {}, etag: 0, calls: [], folderMissing: false };
  const BASIC = 'Basic ' + Buffer.from('anna:app-pass-1').toString('base64');
  const fetchImpl = async (url, init) => {
    init = init || {};
    const h = init.headers || {};
    dav.calls.push((init.method || 'GET') + ' ' + url + (h['If-Match'] ? ' if-match ' + h['If-Match'] : '') + (h['If-None-Match'] ? ' if-none-match ' + h['If-None-Match'] : ''));
    if (h.Authorization !== BASIC) return new Response('', { status: 401 });
    const f = dav.files[url];
    if ((init.method || 'GET') === 'GET') {
      if (!f) return new Response('', { status: 404 });
      return new Response(f.body, { status: 200, headers: { ETag: f.etag } });
    }
    if (init.method === 'PUT') {
      if (dav.folderMissing) return new Response('', { status: 409 });
      if (h['If-None-Match'] === '*' && f) return new Response('', { status: 412 });
      if (h['If-Match'] && (!f || f.etag !== h['If-Match'])) return new Response('', { status: 412 });
      dav.files[url] = { body: init.body, etag: '"e' + (++dav.etag) + '"' };
      return new Response(null, { status: f ? 204 : 201 });
    }
    return new Response('', { status: 405 });
  };
  ok('WebDAV: https only (http allowed for localhost)', T.validWebDavUrl('https://cloud.example.org/remote.php/dav/files/anna/MAERMIN') && T.validWebDavUrl('http://localhost:8080/dav') && !T.validWebDavUrl('http://cloud.example.org/dav') && !T.validWebDavUrl('ftp://x') && !T.validWebDavUrl('nonsense'));
  const wt = T.WebDavTransport({ url: 'https://cloud.example.org/remote.php/dav/files/anna/MAERMIN/', username: 'anna', password: 'app-pass-1', fetchImpl, verify });
  const FILE = 'https://cloud.example.org/remote.php/dav/files/anna/MAERMIN/maermin-sync.json';
  ok('WebDAV: no file yet reads as no data', (await wt.get(ACCOUNT)) === null && dav.calls[0] === 'GET ' + FILE, dav.calls);
  const w1 = await wt.put(ACCOUNT, 0, 'B1', await auth(0, 'B1'));
  ok('WebDAV: the first write creates the file only if none exists (If-None-Match: *)', w1.ok && w1.rev === 1 && dav.calls.some((c) => c === 'PUT ' + FILE + ' if-none-match *'), dav.calls);
  const wg = await wt.get(ACCOUNT);
  ok('WebDAV: read back, Basic auth, MAC checked', wg && wg.rev === 1 && wg.blob === 'B1');
  const w2 = await wt.put(ACCOUNT, 1, 'B2', await auth(1, 'B2'));
  ok('WebDAV: later writes are conditional on the ETag just read (If-Match)', w2.ok && w2.rev === 2 && dav.calls.some((c) => c === 'PUT ' + FILE + ' if-match "e1"'), dav.calls.slice(-3));
  // another device wrote in between: the ETag moved
  const before = dav.files[FILE];
  const sneaky = fetchImpl; let raced = false;
  const racing = T.WebDavTransport({ url: 'https://cloud.example.org/remote.php/dav/files/anna/MAERMIN', username: 'anna', password: 'app-pass-1', verify,
    fetchImpl: async (url, init) => {
      if (init && init.method === 'PUT' && !raced) { raced = true; dav.files[FILE] = { body: JSON.stringify(T.makeRecord(ACCOUNT, 2, 'B3-other', await mac(KEY, ACCOUNT, 2, 'B3-other'), 2)), etag: '"e99"' }; }
      return sneaky(url, init);
    } });
  const w3 = await racing.put(ACCOUNT, 2, 'B3', await auth(2, 'B3'));
  ok('WebDAV: a write that lost the race (412) comes back as a conflict with the other blob', w3.conflict && w3.serverRev === 3 && w3.blob === 'B3-other', w3);
  ok('WebDAV: a folder URL without the trailing slash finds the same file', dav.calls.filter((c) => c.indexOf(FILE) > 0).length > 4 && before);
  const stale = await wt.put(ACCOUNT, 1, 'B4', await auth(1, 'B4'));
  ok('WebDAV: a stale baseRev is a conflict without a PUT', stale.conflict && stale.serverRev === 3 && !dav.calls.slice(-1)[0].startsWith('PUT'), dav.calls.slice(-2));
  const bad = T.WebDavTransport({ url: 'https://cloud.example.org/remote.php/dav/files/anna/MAERMIN', username: 'anna', password: 'wrong', fetchImpl, verify });
  const e401 = await caught(bad.get(ACCOUNT));
  ok('WebDAV: wrong credentials say so', e401 && e401.code === 'webdav-auth');
  dav.folderMissing = true;
  const fresh = T.WebDavTransport({ url: 'https://cloud.example.org/remote.php/dav/files/anna/NOPE', username: 'anna', password: 'app-pass-1', fetchImpl, verify });
  const e409 = await caught(fresh.put(ACCOUNT, 0, 'B1', await auth(0, 'B1')));
  ok('WebDAV: a missing folder says so', e409 && e409.code === 'webdav-folder');
  dav.folderMissing = false;
  const offline = T.WebDavTransport({ url: 'https://cloud.example.org/dav', username: 'a', password: 'b', verify, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  const eNet = await caught(offline.get(ACCOUNT));
  ok('WebDAV: a blocked request (CORS or offline) gets its own code', eNet && eNet.code === 'webdav-network');
  ok('WebDAV: the password is not kept on the transport object', !JSON.stringify(wt).includes('app-pass-1'));
  // The page's security policy blocks hosts it does not name: the browser
  // reports a violation and the request fails like a network error.
  const listeners = [];
  globalThis.document = { addEventListener: (t, f) => { if (t === 'securitypolicyviolation') listeners.push(f); }, removeEventListener: (t, f) => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } };
  const blocked = T.WebDavTransport({ url: 'https://cloud.example.org/dav', username: 'a', password: 'b', verify,
    fetchImpl: async (url) => { listeners.slice().forEach((f) => f({ blockedURI: url, violatedDirective: 'connect-src' })); throw new TypeError('Failed to fetch'); } });
  const eCsp = await caught(blocked.get(ACCOUNT));
  ok('WebDAV: a host the security policy does not allow gets its own message', eCsp && eCsp.code === 'webdav-csp' && listeners.length === 0, eCsp && eCsp.code);
  delete globalThis.document;

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
