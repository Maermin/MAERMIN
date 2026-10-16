// Node harness for the 2026-10 storage and export hardening: the sync
// destination and the unlisted-symbol cache are encrypted at rest and stay on
// this device (never synced, never in a backup); the unlisted-symbol cache is
// read once the vault is open, so encrypting it does not empty it; the
// calendar export escapes every kind of line break.
// Run: node test/storage-hardening.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k),
  key: (i) => Array.from(mem.keys())[i] || null, get length() { return mem.size; }, clear: () => mem.clear()
};
const fresh = (f) => { delete require.cache[require.resolve(f)]; return require(f); };

console.log('encrypted and device-local:');
const St = require('../storage.js');
['maermin_sync_config', 'maermin_no_listing'].forEach((k) => {
  ok(k + ' is encrypted at rest', St.SENSITIVE_KEYS.indexOf(k) !== -1);
});
const SE = require('../sync-engine.js');
['maermin_sync_config', 'maermin_no_listing'].forEach((k) => {
  ok(k + ' is never taken from or sent in a sync snapshot', SE.syncableKey(k) === false);
});
const backupSrc = fs.readFileSync(path.join(root, 'backup-engine.js'), 'utf8');
ok('neither is in the backup', !/'maermin_sync_config'|'maermin_no_listing'/.test(backupSrc));

console.log('unlisted-symbol cache:');
{
  // The cache is read when it is first used, not when the script loads (the
  // vault is still locked then and an encrypted key reads as empty).
  mem.clear();
  const CH = fresh('../close-history.js');
  mem.set('maermin_no_listing', JSON.stringify({ 'ZELCASH-USD': Date.now() - 1000, 'OLD-USD': Date.now() - 7 * 3600 * 1000 }));
  ok('a mark saved before a reload is found after the vault opened', CH.noListing.has('ZELCASH-USD'));
  ok('marks older than 6 hours are dropped', !CH.noListing.has('OLD-USD'));
}
{
  // While locked: a mark is kept in memory and nothing is read; after the
  // unlock the saved marks are read and merged with it, then saved together.
  mem.clear();
  let open = false; const locked = [];
  globalThis.window = { MaerminVault: { isUnlocked: () => open, onLock: (cb) => locked.push(cb) } };
  const CH = fresh('../close-history.js');
  CH.noListing.mark('gonex-usd');
  ok('a mark made while locked counts at once', CH.noListing.has('GONEX-USD'));
  mem.set('maermin_no_listing', JSON.stringify({ 'ZELCASH-USD': Date.now() - 1000 }));
  ok('nothing is read while locked', !CH.noListing.has('ZELCASH-USD'));
  open = true;
  ok('after the unlock the saved marks are read', CH.noListing.has('ZELCASH-USD') && CH.noListing.has('GONEX-USD'));
  CH.noListing.mark('NOPE-USD');
  const saved = JSON.parse(mem.get('maermin_no_listing') || '{}');
  ok('and saved together with the new ones', !!(saved['ZELCASH-USD'] && saved['GONEX-USD'] && saved['NOPE-USD']), saved);
  open = false; locked.forEach((cb) => cb());
  ok('locked again: no mark is held in memory', !CH.noListing.has('NOPE-USD') && !CH.noListing.has('GONEX-USD'));
  delete globalThis.window;
}
{
  // Without encryption at rest the vault never opens; the cache works as before.
  mem.clear();
  mem.set('maermin_no_listing', JSON.stringify({ 'ZELCASH-USD': Date.now() - 1000 }));
  globalThis.window = { MaerminVault: { isUnlocked: () => false, onLock: () => {} }, MaerminStorage: { isEnabled: () => false } };
  const CH = fresh('../close-history.js');
  ok('no encryption at rest: the saved marks are read', CH.noListing.has('ZELCASH-USD'));
  delete globalThis.window;
}

console.log('calendar export:');
{
  const EF = require('../event-feed.js');
  const ics = EF.toICS([
    { uid: 'x-2026-10-29', date: '2026-10-29', kind: 'earnings', symbol: 'X', title: 'One\rTwo', detail: 'A\r\nB\nC\rD' }
  ], { now: '2026-10-14T08:30:00Z', name: 'MAERMIN' });
  ok('a lone carriage return never reaches the file', !/\r(?!\n)/.test(ics), ics);
  ok('every line break becomes \\n', ics.includes('SUMMARY:One\\nTwo') && ics.includes('DESCRIPTION:A\\nB\\nC\\nD'));
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
