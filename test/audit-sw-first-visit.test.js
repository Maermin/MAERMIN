// Regression test, AUDIT.md run 2026-10-24 BUG-13: the page reloaded itself
// when the service worker first took control (first visit), usually while the
// vault screen was being typed into. That reload was also what put the app's
// scripts into the offline cache. Now the first take-over sends the loaded
// files to the service worker to cache, and only an UPDATE reloads.
// Run: node test/audit-sw-first-visit.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---- the page side (pwa.js) ---------------------------------------------------
function loadPwa(hadController) {
  const listeners = {};
  const posted = [];
  let reloads = 0;
  const controller = { postMessage: (m) => posted.push(m) };
  const sw = {
    controller: hadController ? controller : null,
    register: () => Promise.resolve({}),
    addEventListener: (type, cb) => { (listeners[type] = listeners[type] || []).push(cb); }
  };
  const ORIGIN = 'https://example.github.io';
  const ctx = {
    console,
    location: { protocol: 'https:', origin: ORIGIN, href: ORIGIN + '/MAERMIN/', reload: () => { reloads++; } },
    navigator: { serviceWorker: sw },
    document: {
      readyState: 'complete',
      querySelectorAll: () => [{ src: ORIGIN + '/MAERMIN/renderer.js' }, { href: ORIGIN + '/MAERMIN/styles.css' }, { src: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js' }]
    },
    performance: { getEntriesByType: () => [{ name: ORIGIN + '/MAERMIN/fonts/x.woff2' }, { name: 'https://open.er-api.com/v6/latest/USD' }] },
    setTimeout, Promise
  };
  ctx.window = ctx;
  ctx.window.addEventListener = () => {};
  ctx.window.matchMedia = () => ({ matches: false });
  vm.createContext(ctx);
  vm.runInContext(read('pwa.js'), ctx);
  return {
    takeOver() { sw.controller = controller; (listeners.controllerchange || []).forEach((cb) => cb()); },
    get reloads() { return reloads; }, posted
  };
}

console.log('pwa.js on the first take-over and on an update:');
{
  const first = loadPwa(false);
  first.takeOver();
  ok('first visit: no reload when the service worker takes control', first.reloads === 0, first.reloads);
  const msg = first.posted[0] || {};
  ok('first visit: the loaded files are sent to the service worker to cache', msg.type === 'warm-cache' && Array.isArray(msg.urls) && msg.urls.some((u) => /renderer\.js$/.test(u)) && msg.urls.some((u) => /styles\.css$/.test(u)), msg);
  ok('first visit: API calls are not sent for caching', !(msg.urls || []).some((u) => /er-api/.test(u)), msg.urls);
  const update = loadPwa(true);
  update.takeOver();
  ok('update: a new service worker taking over still reloads the page once', update.reloads === 1, update.reloads);
}

// ---- the service-worker side ---------------------------------------------------
function loadSw() {
  const handlers = {};
  const added = [];
  const cache = { add: (u) => { added.push(u); return Promise.resolve(); }, match: () => Promise.resolve(undefined), put: () => Promise.resolve() };
  const ctx = {
    console, Promise, URL, setTimeout,
    caches: { open: () => Promise.resolve(cache), keys: () => Promise.resolve([]), match: () => Promise.resolve(undefined), delete: () => Promise.resolve(true) },
    fetch: () => Promise.reject(new Error('offline'))
  };
  ctx.self = { location: { origin: 'https://example.github.io', href: 'https://example.github.io/MAERMIN/service-worker.js' },
    addEventListener: (type, cb) => { handlers[type] = cb; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() }, registration: {} };
  vm.createContext(ctx);
  vm.runInContext(read('service-worker.js'), ctx);
  return { handlers, added };
}

(async () => {
  console.log('service-worker.js caches the files the page sends:');
  const s = loadSw();
  let waited = null;
  if (s.handlers.message) {
    s.handlers.message({ data: { type: 'warm-cache', urls: ['https://example.github.io/MAERMIN/renderer.js', 'https://evil.example/x.js', 'https://unpkg.com/react@18.3.1/umd/react.production.min.js', 'not a url'] }, waitUntil: (p) => { waited = p; } });
    await waited;
  }
  ok('a message handler for warm-cache exists', !!s.handlers.message);
  ok('same-origin and allowlisted CDN files are cached', s.added.includes('https://example.github.io/MAERMIN/renderer.js') && s.added.includes('https://unpkg.com/react@18.3.1/umd/react.production.min.js'), s.added);
  ok('other origins are never cached on request', !s.added.some((u) => /evil/.test(u)), s.added);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
