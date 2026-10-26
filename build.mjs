#!/usr/bin/env node
/**
 * MAERMIN web build
 * ------------------------------------------------------------------
 * The app is a set of plain global-IIFE scripts loaded in order by
 * index.html. This build reads that exact order, concatenates the local
 * scripts and minifies them into a single bundle for production
 * (GitHub Pages), without changing the dev workflow.
 *
 * Output:  dist/index.html, dist/maermin.min.js, dist/styles.css
 * Run:     npm run build:web
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');

const html = await readFile(join(root, 'index.html'), 'utf8');

// Collect <script src="..."> in document order; split into CDN (kept as-is)
// and local files (concatenated into the bundle).
const scriptRe = /<script\s+[^>]*src="([^"]+)"[^>]*>\s*<\/script>/gi;
const cdn = [];      // full original tags (preserves integrity + crossorigin / SRI)
const local = [];    // local src paths to concatenate into the bundle
let m;
while ((m = scriptRe.exec(html)) !== null) {
  const src = m[1];
  if (/^https?:\/\//i.test(src)) cdn.push(m[0]);
  else if (src === 'dev-boot.js') continue; // prod ships its own boot.js
  else local.push(src);
}

if (local.length === 0) {
  throw new Error('No local scripts found in index.html — aborting build.');
}

console.log(`[build] ${local.length} local scripts, ${cdn.length} CDN scripts`);

// Concatenate local scripts in load order (each is a self-contained IIFE).
let combined = '';
for (const src of local) {
  const code = await readFile(join(root, src), 'utf8');
  combined += `\n/* ==== ${src} ==== */\n${code}\n`;
}

// Minify the combined source (transform-only: no import resolution, globals kept).
const result = await build({
  stdin: { contents: combined, resolveDir: root, loader: 'js' },
  bundle: false,
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
  target: 'es2020',
  write: false,
});
const bundle = result.outputFiles[0].text;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'maermin.min.js'), bundle);
await copyFile(join(root, 'styles.css'), join(dist, 'styles.css'));

// Compute worker bundle: the PURE CPU engines + routing client + RPC harness,
// runnable in a Worker (no DOM). `self.window = self` lets the engine files
// self-register on the worker global exactly as in the browser. Keep this list
// in sync with compute.worker.js (the dev entry).
const workerDeps = ['monte-carlo-engine.js', 'correlation-engine.js', 'compute-client.js'];
let workerSrc = 'self.window = self;\n';
for (const dep of workerDeps) workerSrc += `\n/* ==== ${dep} ==== */\n` + (await readFile(join(root, dep), 'utf8')) + '\n';
workerSrc += '\n/* ==== compute.worker.harness.js ==== */\n' + (await readFile(join(root, 'compute.worker.harness.js'), 'utf8')) + '\n';
const workerOut = await build({
  stdin: { contents: workerSrc, resolveDir: root, loader: 'js' },
  bundle: false, minify: true, legalComments: 'none', charset: 'utf8', target: 'es2020', write: false,
});
await writeFile(join(dist, 'compute.worker.js'), workerOut.outputFiles[0].text);
console.log('[build] dist/compute.worker.js  ' + (workerOut.outputFiles[0].text.length / 1024).toFixed(0) + ' KB');

// PWA assets ship as-is (service-worker.js must stay a standalone file served at
// scope; pwa.js is already inside the bundle and registers it).
// RELEASE.md: whats-new.js shows its newest section after an update.
for (const asset of ['manifest.webmanifest', 'icon.svg', 'RELEASE.md']) {
  await copyFile(join(root, asset), join(dist, asset));
}
// service-worker.js is stamped further down, once every file it caches is written.
// Self-hosted web fonts (styles.css @font-face) and their licence (OFL.txt):
// no request to Google Fonts in dev or prod.
await mkdir(join(dist, 'fonts'), { recursive: true });
for (const file of await readdir(join(root, 'fonts'))) {
  await copyFile(join(root, 'fonts', file), join(dist, 'fonts', file));
}
// Data files loaded on demand (data/skin-images.json for the skin picker).
await mkdir(join(dist, 'data'), { recursive: true });
for (const file of await readdir(join(root, 'data'))) {
  await copyFile(join(root, 'data', file), join(dist, 'data', file));
}
// The single-file Worker (npm run build:worker) for the setup wizard's
// "Copy worker.js": a self-hosted dist/ answers it from its own origin.
await mkdir(join(dist, 'cf-worker'), { recursive: true });
await copyFile(join(root, 'cf-worker', 'worker.single.js'), join(dist, 'cf-worker', 'worker.single.js'));

// The loading-screen teardown lived in an inline <script>. Ship it as an
// external file so prod can run under a STRICT CSP with NO 'unsafe-inline' for
// scripts (the whole point of bundling). Same behaviour, CSP-clean.
await writeFile(join(dist, 'boot.js'),
  "window.addEventListener('load',function(){" +
  "var l=document.getElementById('loading');" +
  "if(l){l.classList.add('hidden');setTimeout(function(){l.remove();},500);}" +
  "});\n");

// Production Content-Security-Policy. Because the bundle replaces 70 inline-ish
// script tags with ONE local file (+ pinned CDN deps), script-src no longer
// needs 'unsafe-inline' — the biggest XSS-hardening win of the build. connect-src
// mirrors the data sources the app actually calls (renderer fetchPrices + Worker,
// plus the pinned pdf.js folder for the SRI-checked worker file; SEC-021).
// MAERMIN_CONNECT_SRC adds named https origins for a self-built copy, e.g. a
// WebDAV sync folder (P5-5.6) or a Worker on a custom domain:
//   MAERMIN_CONNECT_SRC="https://cloud.example.org https://worker.example.org" npm run build:web
// Anything that is not a plain https origin is refused, so the list cannot
// widen the policy to every host.
const CONNECT_EXTRA = (process.env.MAERMIN_CONNECT_SRC || '').split(/[\s,]+/).filter(Boolean);
CONNECT_EXTRA.forEach((o) => {
  if (!/^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i.test(o)) throw new Error('MAERMIN_CONNECT_SRC: not a plain https origin: ' + o);
});
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com/react@18.3.1/umd/ https://unpkg.com/react-dom@18.3.1/umd/ https://unpkg.com/klinecharts@10.1.0/dist/umd/ https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/ https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/5.0.8/ https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/",
  "style-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https://community.akamai.steamstatic.com https://s.yimg.com https://coin-images.coingecko.com https://assets.coingecko.com",
  "connect-src 'self' https://api.exchangerate-api.com https://open.er-api.com https://*.workers.dev https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ');
// the extra origins go at the end of connect-src
const CSP_OUT = CONNECT_EXTRA.length ? CSP.replace(/(connect-src [^;]*)/, (m) => m + ' ' + CONNECT_EXTRA.join(' ')) : CSP;

// Production index.html: keep <head> (CDN deps + styles), single bundle script.
const cdnTags = cdn.map((tag) => `  ${tag}`).join('\n');
const prodHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="${CSP_OUT}">
  <title>MAERMIN v12.2 - Private Portfolio Tracker</title>
  <link rel="manifest" href="manifest.webmanifest">
  <meta name="theme-color" content="#10151f">
  <link rel="icon" type="image/svg+xml" href="icon.svg">
  <link rel="apple-touch-icon" href="icon.svg">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="MAERMIN">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="stylesheet" href="styles.css">
${cdnTags}
</head>
<body>
  <div id="loading">
    <h1>MAERMIN</h1>
    <div class="version-badge">v12.2</div>
    <div class="subtitle">Multi-Asset Portfolio Tracker with Advanced Analysis</div>
    <div class="loader"></div>
  </div>
  <div id="root"></div>
  <script src="maermin.min.js"></script>
  <script src="boot.js"></script>
</body>
</html>
`;
await writeFile(join(dist, 'index.html'), prodHtml);

// The service worker's cache version names the build: a new bundle gets a fresh
// cache, the old one is dropped on activate, and a slow connection can no
// longer mix new HTML/CSS with an old cached bundle (audit 2026-10-24 BUG-14).
{
  const h = createHash('sha256');
  for (const f of ['maermin.min.js', 'styles.css', 'boot.js', 'compute.worker.js', 'index.html']) h.update(await readFile(join(dist, f)));
  const stamp = h.digest('hex').slice(0, 10);
  const sw = await readFile(join(root, 'service-worker.js'), 'utf8');
  if (!/var VERSION = '[^']*';/.test(sw)) throw new Error('service-worker.js: VERSION line not found');
  await writeFile(join(dist, 'service-worker.js'), sw.replace(/var VERSION = '([^']*)';/, (m, v) => "var VERSION = '" + v + '-' + stamp + "';"));
  console.log('[build] dist/service-worker.js  cache ' + stamp);
}

const kb = (bundle.length / 1024).toFixed(0);
console.log(`[build] dist/maermin.min.js  ${kb} KB`);
console.log('[build] done -> dist/');
