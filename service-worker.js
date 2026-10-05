/* ============================================================================
 * MAERMIN — Service Worker
 * ----------------------------------------------------------------------------
 * Epic 2 (PWA). A SINGLE worker that serves both the dev build (≈30 separate
 * <script> files) and the production build (one maermin.min.js) because it uses
 * RUNTIME caching, not a hard-coded hashed precache list — so it never needs to
 * be regenerated when the bundle changes.
 *
 * Strategies
 *   - navigation (HTML)      → network-first, fall back to cached app shell
 *                              (this is what makes the app boot OFFLINE).
 *   - same-origin static     → stale-while-revalidate (fast + self-updating).
 *   - whitelisted CDNs       → cache-first (React, jsPDF rarely change).
 *   - market-data / API hosts→ bypass entirely (never cache volatile prices).
 *
 * Also: notification clicks for local alerts and a Background Sync retry hook.
 * ========================================================================== */
'use strict';

var VERSION = 'maermin-v8';
var SHELL_CACHE = VERSION + '-shell';
var RUNTIME_CACHE = VERSION + '-runtime';

// Minimal shell so a cold offline start can boot the app. Relative URLs keep
// this correct under GitHub Pages subpaths (/MAERMIN/) and any static host.
var PRECACHE = ['.', 'index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg'];

// CDN hosts whose assets are safe to cache long-term.
var CDN_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com'];
// Volatile data hosts — must always hit the network, never serve stale prices.
var BYPASS_HOST_PATTERNS = [
  /(^|\.)coingecko\.com$/i,
  /(^|\.)exchangerate-api\.com$/i,
  /(^|\.)er-api\.com$/i,
  /(^|\.)workers\.dev$/i
];

function isBypassHost(host) {
  return BYPASS_HOST_PATTERNS.some(function (re) { return re.test(host); });
}
function isCdnHost(host) {
  return CDN_HOSTS.indexOf(host) !== -1;
}

// ---- install / activate ----------------------------------------------------
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll fails the whole install if any URL 404s; add resiliently instead.
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(url).catch(function () { /* tolerate a missing shell asset */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        // Drop caches from older VERSIONs.
        if (key.indexOf(VERSION) !== 0) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// ---- fetch routing ---------------------------------------------------------
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // never cache mutations

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Volatile market-data APIs: let them go straight to the network.
  if (isBypassHost(url.hostname)) return;

  // App navigations → network-first with offline shell fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        // Only a successful page may replace the offline shell - caching a
        // 404/5xx here would break the next offline start.
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put('index.html', copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('index.html').then(function (m) { return m || caches.match('.'); });
      })
    );
    return;
  }

  var sameOrigin = url.origin === self.location.origin;

  // Same-origin static (js/css/icons) → network-first so a fresh deploy shows
  // immediately; falls back to cache when offline.
  if (sameOrigin) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Whitelisted CDN deps → cache-first.
  if (isCdnHost(url.hostname)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Everything else: default network (no interception).
});

// Network-first with a short timeout: fresh code when the network is healthy,
// but a flaky connection ("lie-fi") no longer stalls app start — after
// NETWORK_TIMEOUT_MS the cached copy is served (the fetch still completes in
// the background and refreshes the cache for next time).
var NETWORK_TIMEOUT_MS = 3000;
function networkFirst(req) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    var network = fetch(req).then(function (res) {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    });
    var timeout = new Promise(function (resolve) {
      setTimeout(function () {
        cache.match(req).then(function (hit) { if (hit) resolve(hit); });
      }, NETWORK_TIMEOUT_MS);
    });
    return Promise.race([network, timeout]).catch(function () {
      return cache.match(req).then(function (hit) { return hit || network; });
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    return cache.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    });
  });
}

function cacheFirst(req) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    return cache.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      });
    });
  });
}

// ---- notification clicks (local notifications from MaerminPWA.notify) -----
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '.';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// ---- background sync hook ---------------------------------------------------
// The cloud-sync engine (next slice) registers tag 'maermin-sync'; here we just
// notify open clients to retry. With no client open the message is a no-op until
// the real sync-engine handler is wired.
self.addEventListener('sync', function (event) {
  if (event.tag && event.tag.indexOf('maermin') === 0) {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then(function (list) {
        list.forEach(function (c) { c.postMessage({ type: 'background-sync', tag: event.tag }); });
      })
    );
  }
});

// ---- update control --------------------------------------------------------
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
