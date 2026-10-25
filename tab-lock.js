// ============================================================================
// MAERMIN — One writing tab at a time  (window.MaerminTabLock)
// ----------------------------------------------------------------------------
// Each open tab keeps its own decrypted copy of the vault and writes it back.
// With two tabs open (the installed app plus a browser tab, say) the tab that
// saved last silently overwrote the other's changes, and its record list could
// orphan keys the other had added (audit 2026-10-24, feature 1: verified with
// two tabs on one vault — tab 1's watchlist was gone after tab 2 saved tags).
//
// Now one tab holds the Web Lock "maermin-writer" and writes. Every other tab
// is a reader: a notice covers it ("MAERMIN is open in another tab") and its
// storage writes (localStorage, IndexedDB) are dropped. "Use here" asks the
// writer over a BroadcastChannel to save, step back and lock its vault; the
// reader then gets the lock and drops the notice. It does not reload: it never
// unlocked (the notice covers the vault screen), so it has no stale data, and
// a reload would free the lock for a moment for the other tab to take back.
//
// Loaded right after public-demo.js, BEFORE crypto-vault / idb-store /
// storage, so the localStorage guard sits under every later wrapper. The
// public demo (?demo, in-memory storage) is left alone. Browsers without Web
// Locks (Safari < 15.4) keep the old behaviour: every tab writes.
//
//   create({ locks, channel, onFlush }) → controller (pure core, Node-tested)
//     .start() → Promise<'writer'|'reader'>   .takeOver() → Promise<'writer'>
//     .giveUp() .role() .canWrite() .onChange(cb)
//   installGuard(storageProto, storage, canWrite) wraps setItem / removeItem
// Tested in test/tab-lock.test.js.
// ============================================================================
(function () {
  'use strict';

  var LOCK_NAME = 'maermin-writer';
  var CHANNEL_NAME = 'maermin-tabs';
  var GRACE_MS = 2000;   // how long a busy lock may take to come free (reload)

  function create(env) {
    env = env || {};
    var role = 'pending';           // 'pending' (start not answered yet) | 'writer' | 'reader'
    var release = null;             // resolves the held lock's promise
    var listeners = [];
    function set(r) {
      if (role === r) return;
      role = r;
      listeners.forEach(function (cb) { try { cb(r); } catch (e) { /* a listener must not break the lock */ } });
    }
    // The lock stays held as long as the callback's promise is pending.
    function hold() { return new Promise(function (resolve) { release = resolve; }); }

    function start() {
      if (!env.locks || typeof env.locks.request !== 'function') { set('writer'); return Promise.resolve('writer'); }
      return new Promise(function (resolveRole) {
        var win = function () { set('writer'); resolveRole('writer'); return hold(); };
        var lose = function () { set('reader'); resolveRole('reader'); return null; };
        env.locks.request(LOCK_NAME, { ifAvailable: true }, function (lock) {
          if (lock) return win();
          // Busy. On a reload the page being replaced may still be letting go
          // of the lock, so wait a moment before calling this tab a reader
          // (no writes while waiting, no notice).
          var signal = typeof env.timeout === 'function' ? env.timeout(GRACE_MS) : null;
          if (!signal) return lose();
          set('waiting');
          Promise.resolve(env.locks.request(LOCK_NAME, { signal: signal }, win)).catch(lose);
          return null;
        });
      });
    }

    // Another tab asked for the lock: save what is pending, stop writing, let go.
    function giveUp() {
      if (role !== 'writer') return Promise.resolve(role);
      return Promise.resolve()
        .then(function () { return env.onFlush ? env.onFlush() : null; })
        .catch(function () { /* save failed: still hand over, the other tab reloads from what is stored */ })
        .then(function () {
          set('reader');
          if (release) { var r = release; release = null; r(); }
          return 'reader';
        });
    }

    function takeOver() {
      if (role === 'writer') return Promise.resolve('writer');
      if (env.channel) { try { env.channel.postMessage({ type: 'take-over' }); } catch (e) { /* closed channel */ } }
      return new Promise(function (resolveRole) {
        env.locks.request(LOCK_NAME, function () { set('writer'); resolveRole('writer'); return hold(); });
      });
    }

    if (env.channel && typeof env.channel.addEventListener === 'function') {
      env.channel.addEventListener('message', function (ev) {
        if (ev && ev.data && ev.data.type === 'take-over') giveUp();
      });
    }

    return {
      start: start, takeOver: takeOver, giveUp: giveUp,
      role: function () { return role; },
      canWrite: function () { return role === 'writer' || role === 'pending'; },
      onChange: function (cb) { if (typeof cb === 'function') listeners.push(cb); }
    };
  }

  // Drop localStorage writes while this tab is a reader. Installed before
  // storage.js, so its "native" setItem is this guard and the encrypted
  // fallback writes are covered too.
  function installGuard(proto, storage, canWrite) {
    if (!proto || !storage || typeof canWrite !== 'function') return false;
    var set = proto.setItem, remove = proto.removeItem;
    proto.setItem = function (key, value) {
      if (this === storage && !canWrite()) return undefined;
      return set.call(this, key, value);
    };
    proto.removeItem = function (key) {
      if (this === storage && !canWrite()) return undefined;
      return remove.call(this, key);
    };
    return true;
  }

  var api = { LOCK_NAME: LOCK_NAME, CHANNEL_NAME: CHANNEL_NAME, create: create, installGuard: installGuard, canWrite: function () { return true; } };

  // ---- browser wiring --------------------------------------------------------
  function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.t(k, f, v) : f; }

  function showNotice(ctrl, gaveUp) {
    if (typeof document === 'undefined' || document.querySelector('[data-testid="tab-lock"]')) return;
    var box = document.createElement('div');
    box.className = 'mx-tablock';
    box.setAttribute('data-testid', 'tab-lock');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'mx-tablock-title');
    var card = document.createElement('div');
    card.className = 'mx-tablock__card';
    var h = document.createElement('h2');
    h.id = 'mx-tablock-title';
    h.textContent = gaveUp ? __('tabLockMovedTitle', 'MAERMIN is now open in another tab') : __('tabLockTitle', 'MAERMIN is already open in another tab');
    var p = document.createElement('p');
    p.textContent = __('tabLockText', 'Only one tab can save your data at a time, so nothing gets overwritten. Use MAERMIN in the other tab, or move it here.');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-btn ui-btn--primary';
    btn.setAttribute('data-testid', 'tab-lock-use-here');
    btn.textContent = __('tabLockUseHere', 'Use here');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = __('tabLockMoving', 'Moving here…');
      // No reload: a reload would let go of the lock for a moment, and the
      // other tab - reloading itself after it locked its vault - could take it
      // back (seen in CI). A reader never unlocked (this notice covers the
      // vault screen), so it holds no data that could be stale: it just goes on.
      ctrl.takeOver().then(function () {
        if (box.parentNode) box.parentNode.removeChild(box);
        var pw = document.querySelector('input[type="password"]');
        if (pw) { try { pw.focus(); } catch (e) { /* not focusable */ } }
      });
    });
    card.appendChild(h); card.appendChild(p); card.appendChild(btn);
    box.appendChild(card);
    (document.body || document.documentElement).appendChild(box);
    try { btn.focus(); } catch (e) { /* not focusable yet */ }
  }

  if (typeof window !== 'undefined') {
    var demo = window.MaerminPublicDemo && window.MaerminPublicDemo.active;
    var locks = typeof navigator !== 'undefined' && navigator.locks;
    if (!demo && locks && typeof BroadcastChannel !== 'undefined') {
      var ctrl = create({
        locks: locks,
        timeout: function (ms) { return (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : null; },
        channel: new BroadcastChannel(CHANNEL_NAME),
        onFlush: function () {
          var S = window.MaerminStorage;
          return S && typeof S.flush === 'function' ? S.flush() : null;
        }
      });
      api.canWrite = ctrl.canWrite;
      api.role = ctrl.role;
      api.takeOver = ctrl.takeOver;
      if (typeof Storage !== 'undefined') installGuard(Storage.prototype, window.localStorage, ctrl.canWrite);
      var wasWriter = false;
      ctrl.onChange(function (r) {
        if (r === 'writer') { wasWriter = true; return; }
        if (r !== 'reader') return;
        var gaveUp = wasWriter;
        // Lock the vault of a tab that handed over: its keys and decrypted
        // data leave memory; the notice offers the way back.
        if (gaveUp && window.MaerminVault && typeof window.MaerminVault.lock === 'function') { try { window.MaerminVault.lock(); } catch (e) { /* already locked */ } }
        var show = function () { showNotice(ctrl, gaveUp); };
        if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
      });
      ctrl.start();
    }
    window.MaerminTabLock = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
