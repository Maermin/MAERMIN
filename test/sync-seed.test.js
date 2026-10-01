// Sync merge base seeding on upgrade (sync-engine.js seedBase).
// A device that last synced with an older build has no per-key merge base and
// - because the v10 stores joined the snapshot - always looks "changed". Its
// first merge used to be last-write-wins with the local side stamped "now",
// so edits made on other devices were overwritten.
// Run: node test/sync-seed.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

class StorageMock {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
}
const localStorage = new StorageMock();
globalThis.localStorage = localStorage;

const Sync = require('../sync-engine.js');
const BASE = 'maermin_sync_base';
const snap = (data, updatedAt) => ({ v: 1, updatedAt: updatedAt || Date.now(), device: 'b', data });

console.log('seedBase:');
// What device B last synced (old build): only legacy keys.
const synced = { transactions: '[]', maermin_watchlist: '["NVDA"]' };
const state = { lastHash: Sync.contentHash(JSON.stringify(synced)) };
// After the upgrade B also has a never-synced v10 store.
const local = snap(Object.assign({}, synced, { maermin_real_assets: '{"assets":[1]}' }));

ok('upgraded device looks changed (hash differs from lastHash)', Sync.snapshotHash(local) !== state.lastHash);
ok('seeds from the pre-upgrade keys when they are untouched', Sync.seedBase(local, state) === true);
const base = JSON.parse(localStorage.getItem(BASE));
ok('base covers the synced keys only (no never-synced v10 store)',
  base.transactions === Sync.contentHash('[]') && base.maermin_watchlist === Sync.contentHash('["NVDA"]') && !('maermin_real_assets' in base));

// Device A (already upgraded) added MSFT; B's first merge now keeps it.
const remote = snap({ transactions: '[]', maermin_watchlist: '["NVDA","MSFT"]' }, 1000);
const m = Sync.mergeSnapshots(local, remote, base);
ok('edit made on the other device survives the first merge', m.merged.data.maermin_watchlist === '["NVDA","MSFT"]');
ok('never-synced local store is kept', m.merged.data.maermin_real_assets === '{"assets":[1]}');

ok('does not overwrite an existing base', Sync.seedBase(local, state) === false);

localStorage.removeItem(BASE);
const edited = snap({ transactions: '[]', maermin_watchlist: '["NVDA","TSLA"]' });
ok('no seed when the device has its own unsynced edits', Sync.seedBase(edited, state) === false && localStorage.getItem(BASE) === null);
ok('no seed without a previous sync', Sync.seedBase(local, {}) === false);
// whole-snapshot match (no upgrade gap): all keys are seeded
ok('seeds every key when the whole snapshot matches', Sync.seedBase(snap(synced), state) === true &&
  Object.keys(JSON.parse(localStorage.getItem(BASE))).length === 2);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
