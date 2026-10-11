// ============================================================================
// MAERMIN — PWA Controller  (window.MaerminPWA)
// ----------------------------------------------------------------------------
// Epic 2 client side: registers the service worker, the install prompt,
// local notifications, and background-sync requests.
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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var SW_URL = 'service-worker.js';   // relative → correct under GH Pages subpaths
  var SW_SCOPE = './';
  var INSTALL_DISMISS_KEY = 'maermin_pwa_install_dismissed';

  var registration = null;
  var deferredInstall = null;
  var listeners = { sync: [] };

  function emit(type, payload) {
    (listeners[type] || []).forEach(function (cb) { try { cb(payload); } catch (e) {} });
  }
  function on(type, cb) { if (listeners[type] && typeof cb === 'function') listeners[type].push(cb); }

  // ---- registration ------------------------------------------------------------
  function register() {
    if (!('serviceWorker' in navigator)) return;
    // file:// (index.html opened directly) can't host a SW — skip gracefully.
    if (location.protocol === 'file:') return;

    navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
      .then(function (reg) { registration = reg || null; })
      .catch(function (e) { console.warn('[MAERMIN PWA] SW registration failed:', e); });

    // Background-sync retries are forwarded from the SW to the app.
    navigator.serviceWorker.addEventListener('message', function (ev) {
      if (ev.data && ev.data.type === 'background-sync') emit('sync', ev.data.tag);
    });

    // Reload once a new SW takes control (service-worker.js calls skipWaiting()
    // on install, so an update applies on the next load).
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return; refreshing = true; window.location.reload();
    });
  }

  // ---- install prompt -------------------------------------------------------
  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true;
  }

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
      '<div class="mpwa-ic">M</div>' +
      '<div class="mpwa-tx"><b>' + __('pwaInstallTitle', 'Install MAERMIN') + '</b><span>' + __('pwaInstallSub', 'Add to your device for offline access') + '</span></div>' +
      '<button class="mpwa-go" id="mpwa-go">' + __('pwaInstall', 'Install') + '</button>' +
      '<button class="mpwa-no" id="mpwa-no" title="' + __('pwaDismiss', 'Dismiss') + '">✕</button>';
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
    promptInstall: promptInstall,
    notificationsSupported: notificationsSupported,
    notificationPermission: notificationPermission,
    requestNotifications: requestNotifications,
    notify: notify,
    requestBackgroundSync: requestBackgroundSync
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
})();
