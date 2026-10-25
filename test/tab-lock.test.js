// Node harness for tab-lock.js (one writing tab at a time): the writer/reader
// roles over a fake Web Locks manager and BroadcastChannel, the hand-over
// ("Use here"), and the localStorage / IndexedDB write guards.
// Run: node test/tab-lock.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const tick = () => new Promise((r) => setTimeout(r, 0));

const TL = require('../tab-lock.js');

// A Web Locks manager shared by all "tabs" (exclusive locks, FIFO waiters).
function fakeLocks() {
  const held = {}, queue = {};
  function grant(name, cb) {
    held[name] = true;
    Promise.resolve(cb({ name })).then(() => {
      held[name] = false;
      const next = (queue[name] || []).shift();
      if (next) grant(name, next);
    });
  }
  return {
    request(name, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      if (!held[name]) { grant(name, cb); return Promise.resolve(); }
      if (opts.ifAvailable) { Promise.resolve(cb(null)); return Promise.resolve(); }
      return new Promise((resolve, reject) => {
        const entry = (lock) => { resolve(); return cb(lock); };
        (queue[name] = queue[name] || []).push(entry);
        if (opts.signal) opts.signal.addEventListener('abort', () => {
          const q = queue[name] || [], i = q.indexOf(entry);
          if (i > -1) { q.splice(i, 1); reject(new Error('AbortError')); }
        });
      });
    },
    // A page being replaced (reload) still holds the lock for a moment.
    holdFor(name, ms) { grant(name, () => new Promise((r) => setTimeout(r, ms))); }
  };
}
const timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
// BroadcastChannel: a message reaches every OTHER channel of the same bus.
function fakeBus() {
  const chans = [];
  return () => {
    const ls = [];
    const ch = { postMessage(data) { chans.filter((c) => c !== ch).forEach((c) => c._ls.forEach((f) => f({ data }))); }, addEventListener(t, f) { if (t === 'message') ls.push(f); }, _ls: ls };
    chans.push(ch);
    return ch;
  };
}

(async () => {
  console.log('roles:');
  const locks = fakeLocks(), chan = fakeBus();
  let flushed = 0;
  const a = TL.create({ locks, channel: chan(), onFlush: () => { flushed++; return Promise.resolve(); } });
  const b = TL.create({ locks, channel: chan() });
  ok('before start a tab may write (boot is not blocked)', a.canWrite() && a.role() === 'pending');
  ok('the first tab becomes the writer', (await a.start()) === 'writer' && a.canWrite());
  ok('a second tab becomes a reader and may not write', (await b.start()) === 'reader' && !b.canWrite());

  console.log('"Use here":');
  const seen = [];
  a.onChange((r) => seen.push('a:' + r));
  b.onChange((r) => seen.push('b:' + r));
  const got = await b.takeOver();
  await tick();
  ok('the reader gets the lock and becomes the writer', got === 'writer' && b.canWrite());
  ok('the old writer saved first, then became a reader', flushed === 1 && a.role() === 'reader' && !a.canWrite());
  ok('the old writer stopped writing before the new one started', seen.indexOf('a:reader') > -1 && seen.indexOf('a:reader') < seen.indexOf('b:writer'), seen);
  const c = TL.create({ locks, channel: chan() });
  ok('a third tab is a reader while the new writer holds the lock', (await c.start()) === 'reader');

  console.log('reload (the page being replaced still holds the lock briefly):');
  {
    const l2 = fakeLocks();
    l2.holdFor('maermin-writer', 300);
    const re = TL.create({ locks: l2, channel: chan(), timeout });
    const p = re.start();
    await tick();
    ok('while the lock is coming free the tab waits: no writes, not a reader', re.role() === 'waiting' && !re.canWrite(), re.role());
    ok('the reloaded tab becomes the writer once the old page lets go', (await p) === 'writer' && re.canWrite());
    const l3 = fakeLocks();
    l3.holdFor('maermin-writer', 5000);
    const busy = TL.create({ locks: l3, channel: chan(), timeout: (ms) => timeout(Math.min(ms, 200)) });
    ok('a lock that stays busy past the grace time makes the tab a reader', (await busy.start()) === 'reader');
  }

  console.log('without Web Locks:');
  const old = TL.create({});
  ok('every tab writes, as before (no guard)', (await old.start()) === 'writer' && old.canWrite());

  console.log('localStorage guard:');
  const writes = [];
  const proto = { setItem(k, v) { writes.push('set ' + k); }, removeItem(k) { writes.push('rm ' + k); } };
  const storage = Object.create(proto), other = Object.create(proto);
  let allowed = true;
  TL.installGuard(proto, storage, () => allowed);
  storage.setItem('transactions', '[]');
  allowed = false;
  storage.setItem('transactions', '[1]'); storage.removeItem('maermin_tags');
  other.setItem('x', '1');
  ok('a reader tab drops its localStorage writes and removals', writes.join() === 'set transactions,set x', writes);

  console.log('IndexedDB guard:');
  globalThis.window = { MaerminTabLock: { canWrite: () => false } };
  const IDB = require('../idb-store.js');
  ok('a reader tab does not write IndexedDB (set, del resolve false without a transaction)', (await IDB.set('k', 'v')) === false && (await IDB.del('k')) === false);
  delete globalThis.window;

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
