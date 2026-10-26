// Source documents on a transaction (audit 2026-10-24, feature 10).
// Run: node test/attachments.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }

globalThis.window = globalThis.window || {};
globalThis.window.MaerminI18n = require('../i18n.js');
const A = require('../attachments.js');

(async function main() {
  console.log('validate:');
  ok('a PDF under 5 MB is fine', A.validate({ name: 'a.pdf', type: 'application/pdf', size: 1000 }) === null);
  ok('images are fine', ['image/png', 'image/jpeg', 'image/webp'].every((t) => A.validate({ type: t, size: 10 }) === null));
  ok('other types are refused', A.validate({ type: 'text/html', size: 10 }) === 'type' && A.validate({ type: 'image/svg+xml', size: 10 }) === 'type');
  ok('over 5 MB is refused', A.validate({ type: 'application/pdf', size: 5 * 1024 * 1024 + 1 }) === 'size');
  ok('empty is refused', A.validate({ type: 'application/pdf', size: 0 }) === 'empty');

  console.log('base64 round trip:');
  const bytes = new Uint8Array(300000); for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;
  const back = A.unb64(A.b64(bytes.buffer));
  ok('a 300 KB file survives (chunked, no stack overflow)', back.length === bytes.length && back.every((b, i) => b === bytes[i]));

  console.log('index:');
  let idx = A.indexAdd({}, 'tx1', { id: 'a', name: 'a.pdf' });
  idx = A.indexAdd(idx, 'tx1', { id: 'b', name: 'b.png' });
  ok('add keeps the order per transaction', idx.tx1.map((m) => m.id).join() === 'a,b');
  ok('re-adding an id replaces it', A.indexAdd(idx, 'tx1', { id: 'a', name: 'new.pdf' }).tx1.filter((m) => m.id === 'a').length === 1);
  idx = A.indexRemove(idx, 'tx1', 'a');
  ok('remove one', idx.tx1.map((m) => m.id).join() === 'b');
  ok('the last one removes the transaction entry', !('tx1' in A.indexRemove(idx, 'tx1', 'b')));

  console.log('storage (stub vault + in-memory IndexedDB):');
  const store = new Map();
  let key = 'k1';
  window.MaerminIDB = { isSupported: () => true, get: async (k) => (store.has(k) ? store.get(k) : null), set: async (k, v) => { store.set(k, v); return null; }, del: async (k) => { store.delete(k); return null; } };
  window.MaerminVault = {
    isUnlocked: () => true,
    encryptJSON: async (o, ctx) => 'enc:' + key + ':' + ctx + ':' + Buffer.from(JSON.stringify(o)).toString('base64'),
    decryptJSON: async (env, ctx) => { const [p, k, c, body] = env.split(':'); if (p !== 'enc' || k !== key || c !== ctx) throw new Error('bad'); return JSON.parse(Buffer.from(body, 'base64').toString()); }
  };
  const file = { name: 'statement.pdf', type: 'application/pdf', size: 4, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer };
  const meta = await A.add('tx9', file);
  const l = await A.list('tx9');
  ok('added and listed', l.available && l.items.length === 1 && l.items[0].name === 'statement.pdf' && l.items[0].id === meta.id);
  ok('stored encrypted, under its own key, with the attachment context', [...store.keys()].sort().join() === ['att-index', 'att:tx9:' + meta.id].sort().join() && [...store.values()].every((v) => /^enc:k1:attachment:/.test(v)));
  ok('the file content is not readable in the store', [...store.values()].every((v) => !v.includes('statement.pdf') && !v.includes('%PDF')));
  globalThis.Blob = globalThis.Blob || require('node:buffer').Blob;
  const blob = await A.open('tx9', meta.id);
  ok('opens as the original bytes and type', blob.type === 'application/pdf' && Buffer.from(await blob.arrayBuffer()).toString() === '%PDF');
  let refused = '';
  try { await A.add('tx9', { name: 'x.html', type: 'text/html', size: 3, arrayBuffer: async () => new ArrayBuffer(3) }); } catch (e) { refused = e.message; }
  ok('a refused type is not stored', refused === 'type' && store.size === 2);
  key = 'other-vault';
  let unread = '';
  try { await A.open('tx9', meta.id); } catch (e) { unread = e.message; }
  ok('another vault key cannot read it (shown as unreadable)', unread === 'unreadable' && (await A.list('tx9')).unreadable === true);
  key = 'k1';
  await A.remove('tx9', meta.id);
  ok('remove deletes the file and its index entry', store.size === 1 && (await A.list('tx9')).items.length === 0);
  window.MaerminVault.isUnlocked = () => false;
  ok('locked: nothing available', (await A.list('tx9')).available === false);

  console.log('not in backup or sync:');
  const KEYS = require('../backup-engine.js').KEYS;
  ok('no attachment key in the backup keys', !KEYS.some((k) => /^att/.test(k)));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
