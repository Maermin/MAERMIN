// ============================================================================
// MAERMIN — PWA Controller  (window.MaerminPWA)
// ----------------------------------------------------------------------------
// Epic 2 client side: registers the service worker, manages updates, the
// install prompt, local notifications, and background-sync requests.
//
// Per the V7 rule we don't bolt on new chrome — the only UI is ONE small,
// dismissible "Install" toast shown when the browser offers installation (the
// standard discoverable affordance). Everything else is an API for a future
// Settings card to call (MaerminPWA.promptInstall / requestNotifications / …).
//
// Loaded as a normal app script, so it ends up in the production bundle; the
// service-worker.js file stays standalone (the browser fetches it at scope).
// ============================================================================
(function () {
  'use strict';

  var SW_URL = 'service-worker.js';   // relative → correct under GH Pages subpaths
  var SW_SCOPE = './';
  var INSTALL_DISMISS_KEY = 'maermin_pwa_install_dismissed';

  var registration = null;
  var deferredInstall = null;
  var updateReady = false;
  var listeners = { update: [], install: [], sync: [] };

  function emit(type, payload) {
    (listeners[type] || []).forEach(function (cb) { try { cb(payload); } catch (e) {} });
  }
  function on(type, cb) { if (listeners[type] && typeof cb === 'function') listeners[type].push(cb); }

  // ---- registration + update flow ------------------------------------------
  function register() {
    if (!('serviceWorker' in navigator)) return;
    // file:// (index.html opened directly) can't host a SW — skip gracefully.
    if (location.protocol === 'file:') return;

    navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
      .then(function (reg) {
        registration = reg;
        // Detect an updated worker waiting to take over.
        if (reg.waiting) { updateReady = true; emit('update', reg); }
        reg.addEventListener('updatefound', function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              updateReady = true; emit('update', reg);
            }
          });
        });
      })
      .catch(function (e) { console.warn('[MAERMIN PWA] SW registration failed:', e); });

    // Background-sync retries are forwarded from the SW to the app.
    navigator.serviceWorker.addEventListener('message', function (ev) {
      if (ev.data && ev.data.type === 'background-sync') emit('sync', ev.data.tag);
    });

    // Reload once the new SW takes control (after applyUpdate()).
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return; refreshing = true; window.location.reload();
    });
  }

  function applyUpdate() {
    if (registration && registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  // ---- install prompt -------------------------------------------------------
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }
  function canInstall() { return !!deferredInstall; }

  function promptInstall() {
    if (!deferredInstall) return Promise.resolve({ outcome: 'unavailable' });
    var p = deferredInstall;
    deferredInstall = null;
    p.prompt();
    return p.userChoice;
  }

  // A tiny, theme-matched, dismissible install toast (the only injected UI).
  function showInstallToast() {
    if (isStandalone()) return;
    try { if (localStorage.getItem(INSTALL_DISMISS_KEY) === '1') return; } catch (e) {}
    if (document.getElementById('maermin-pwa-install')) return;

    var bar = document.createElement('div');
    bar.id = 'maermin-pwa-install';
    bar.innerHTML =
      '<style>' +
      '#maermin-pwa-install{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);' +
      'z-index:99998;display:flex;align-items:center;gap:14px;padding:12px 16px;' +
      'background:rgba(20,26,37,0.96);border:1px solid rgba(139,124,255,0.35);border-radius:14px;' +
      'box-shadow:0 18px 50px -12px rgba(0,0,0,0.7);backdrop-filter:blur(14px);' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#e9edf4;' +
      'max-width:calc(100vw - 32px);animation:mpwaIn .35s cubic-bezier(.16,1,.3,1)}' +
      '@keyframes mpwaIn{from{opacity:0;transform:translate(-50%,14px)}to{opacity:1;transform:translate(-50%,0)}}' +
      '#maermin-pwa-install .mpwa-ic{width:34px;height:34px;border-radius:9px;flex:0 0 auto;' +
      'background:linear-gradient(135deg,#c3b8ff,#8b7cff 55%,#5b8cff);display:flex;align-items:center;' +
      'justify-content:center;color:#ffffff;font-weight:800;font-size:18px}' +
      '#maermin-pwa-install .mpwa-tx{font-size:.86rem;line-height:1.25}' +
      '#maermin-pwa-install .mpwa-tx b{display:block;font-size:.9rem}' +
      '#maermin-pwa-install .mpwa-tx span{color:#8b94a7}' +
      '#maermin-pwa-install button{border:none;cursor:pointer;border-radius:9px;font-weight:700;' +
      'font-size:.82rem;padding:8px 12px}' +
      '#maermin-pwa-install .mpwa-go{background:linear-gradient(135deg,#c3b8ff,#8b7cff 55%,#5b8cff);color:#ffffff}' +
      '#maermin-pwa-install .mpwa-no{background:transparent;color:#8b94a7;padding:8px}' +
      '</style>' +
      '<div class="mpwa-ic">M</div>' +
      '<div class="mpwa-tx"><b>Install MAERMIN</b><span>Add to your device for offline access</span></div>' +
      '<button class="mpwa-go" id="mpwa-go">Install</button>' +
      '<button class="mpwa-no" id="mpwa-no" title="Dismiss">✕</button>';
    document.body.appendChild(bar);

    document.getElementById('mpwa-go').addEventListener('click', function () {
      promptInstall().then(function () { bar.remove(); });
    });
    document.getElementById('mpwa-no').addEventListener('click', function () {
      try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch (e) {}
      bar.remove();
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    emit('install', true);
    // Defer the toast until the app is unlocked, so it never overlaps the auth screen.
    if (window.MaerminAuth && window.MaerminAuth.whenUnlocked) {
      window.MaerminAuth.whenUnlocked().then(function () { setTimeout(showInstallToast, 1500); });
    } else {
      setTimeout(showInstallToast, 1500);
    }
  });
  window.addEventListener('appinstalled', function () {
    deferredInstall = null;
    var bar = document.getElementById('maermin-pwa-install');
    if (bar) bar.remove();
  });

  // ---- notifications ----------------------------------------------------------
  function notificationsSupported() { return 'Notification' in window; }
  function notificationPermission() { return notificationsSupported() ? Notification.permission : 'denied'; }
  function requestNotifications() {
    if (!notificationsSupported()) return Promise.resolve('denied');
    return Notification.requestPermission();
  }

  // Local notification — works WITHOUT a server. The price-alerts feature can
  // call this today.
  function notify(title, options) {
    options = options || {};
    if (notificationPermission() !== 'granted') return Promise.resolve(false);
    if (registration && registration.showNotification) {
      return registration.showNotification(title, Object.assign({ icon: 'icon.svg', badge: 'icon.svg' }, options))
        .then(function () { return true; });
    }
    try { new Notification(title, options); return Promise.resolve(true); }
    catch (e) { return Promise.resolve(false); }
  }

  // ---- background sync ------------------------------------------------------
  function requestBackgroundSync(tag) {
    tag = tag || 'maermin-sync';
    if (!registration || !registration.sync) return Promise.resolve(false);
    return registration.sync.register(tag).then(function () { return true; })
      .catch(function () { return false; });
  }

  window.MaerminPWA = {
    on: on,
    isStandalone: isStandalone,
    canInstall: canInstall,
    promptInstall: promptInstall,
    hasUpdate: function () { return updateReady; },
    applyUpdate: applyUpdate,
    notificationsSupported: notificationsSupported,
    notificationPermission: notificationPermission,
    requestNotifications: requestNotifications,
    notify: notify,
    requestBackgroundSync: requestBackgroundSync
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
})();
