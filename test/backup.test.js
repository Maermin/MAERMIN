// Node harness for the full-vault backup engine. No browser tooling in this
// env, so we stub a minimal localStorage and exercise the real snapshot/restore
// logic from backup-engine.js. Run: node test/backup.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function throws(name, fn, msgIncludes) {
  try { fn(); failed++; console.error('  ✗ ' + name + ' (did not throw)'); }
  catch (e) {
    const good = !msgIncludes || (e && String(e.message).includes(msgIncludes));
    if (good) { passed++; console.log('  ✓ ' + name); }
    else { failed++; console.error('  ✗ ' + name + ' (wrong error: ' + (e && e.message) + ')'); }
  }
}

// ---- minimal localStorage stub --------------------------------------------
class StorageMock {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
  get size() { return this._d.size; }
}
globalThis.localStorage = new StorageMock();

const Backup = require('../backup-engine.js');

(function run() {
  console.log('backup-engine:');

  // ---- security: secrets never travel in a plain-text backup ----
  ok('apiKeys is NOT a backup key', Backup.KEYS.indexOf('apiKeys') === -1);
  ok('transactions IS a backup key', Backup.KEYS.indexOf('transactions') !== -1);
  ok('keys cover the spread-out feature stores',
    ['maermin_watchlist', 'maermin_alerts', 'maermin_journal', 'maermin_savings_plans',
     'maermin_networth_accounts', 'investmentGoals', 'maermin_fire_settings']
      .every(k => Backup.KEYS.indexOf(k) !== -1));
  ok('keys cover the v10 feature stores',
    ['maermin_snapshots', 'maermin_tags', 'maermin_dashboard_layout', 'maermin_rebalance_targets', 'maermin_rules', 'maermin_custom_categories']
      .every(k => Backup.KEYS.indexOf(k) !== -1));

  // ---- seed a realistic store, INCLUDING an item with no price ----
  const txList = [
    { id: '1', category: 'crypto', symbol: 'BTC', quantity: 0.5, price: 38000, fees: 4.9 },
    // The case the user cares about: a position with no price / no fees set.
    { id: '2', category: 'skins', symbol: 'AK-47 Redline', quantity: 1 },
    { id: '3', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 0, notes: 'gift' }
  ];
  localStorage.setItem('transactions', JSON.stringify(txList));
  localStorage.setItem('maermin_watchlist', JSON.stringify([{ symbol: 'ETH' }]));
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('apiKeys', JSON.stringify({ cs2Worker: 'https://secret.example/abc' }));
  // a UI-only flag that must NOT be in the backup
  localStorage.setItem('maermin_onboarded', '1');

  const backup = Backup.snapshot();

  ok('format + version stamped', backup.format === 'maermin-full' && !!backup.version);
  ok('store captured present data keys', !!backup.store.transactions && !!backup.store.maermin_watchlist && backup.store.theme === 'dark');
  ok('store omits absent keys', !('maermin_journal' in backup.store));
  ok('store omits secrets (apiKeys)', !('apiKeys' in backup.store));
  ok('store omits UI-only flags', !('maermin_onboarded' in backup.store));

  // The crux: the price-less item must round-trip byte-for-byte (no field
  // dropped, no price coerced to 0 by the backup itself).
  ok('price-less item survives snapshot intact',
    backup.store.transactions === JSON.stringify(txList));
  const reparsed = JSON.parse(backup.store.transactions);
  ok('price-less item still has no price field', !('price' in reparsed[1]));
  ok('explicit price:0 item keeps its 0', reparsed[2].price === 0);

  // ---- restore into a wiped store ----
  const fresh = new StorageMock();
  // pre-existing secret on the "new device" must NOT be wiped by a restore
  fresh.setItem('apiKeys', JSON.stringify({ cs2Worker: 'https://kept.example' }));
  const count = Backup.restore(backup, { storage: fresh });

  ok('restore reports keys written', count === Object.keys(backup.store).length);
  ok('transactions restored exactly', fresh.getItem('transactions') === JSON.stringify(txList));
  ok('watchlist restored', fresh.getItem('maermin_watchlist') === JSON.stringify([{ symbol: 'ETH' }]));
  ok('theme restored', fresh.getItem('theme') === 'dark');
  ok('restore left existing apiKeys untouched',
    fresh.getItem('apiKeys') === JSON.stringify({ cs2Worker: 'https://kept.example' }));

  // ---- overlay wins over storage (live React state a tick ahead) ----
  const overlaid = Backup.snapshot({ overlay: { transactions: JSON.stringify([{ id: '9', symbol: 'LIVE' }]) } });
  ok('overlay overrides stored value', overlaid.store.transactions === JSON.stringify([{ id: '9', symbol: 'LIVE' }]));
  ok('overlay does not affect other keys', overlaid.store.theme === 'dark');

  // ---- whitelist: a foreign/tampered key cannot be injected on restore ----
  const evil = { format: 'maermin-full', store: { transactions: '[]', __proto__pollute: 'x', some_other_app: 'y' } };
  const evilDst = new StorageMock();
  const evilCount = Backup.restore(evil, { storage: evilDst });
  ok('restore ignores non-whitelisted keys', evilCount === 1 && evilDst.getItem('some_other_app') === null);

  // ---- isFullBackup / malformed input ----
  ok('isFullBackup true for real backup', Backup.isFullBackup(backup));
  ok('isFullBackup false for tx array', !Backup.isFullBackup([{ id: '1' }]));
  ok('isFullBackup false for old portfolio format', !Backup.isFullBackup({ portfolio: {} }));
  throws('restore rejects a malformed object', () => Backup.restore({ nope: true }, { storage: new StorageMock() }), 'bad-backup');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
