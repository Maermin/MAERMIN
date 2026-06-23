#!/usr/bin/env node
/**
 * MAERMIN web build
 * ------------------------------------------------------------------
 * The app is a set of plain global-IIFE scripts loaded in order by
 * index.html. This build reads that exact order, concatenates the local
 * scripts and minifies them into a single bundle for production
 * (GitHub Pages / Electron), without changing the dev workflow.
 *
 * Output:  dist/index.html, dist/maermin.min.js, dist/styles.css
 * Run:     npm run build:web
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
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
  else local.push(src);
}

if (local.length === 0) {
  throw new Error('No local scripts found in index.html — aborting build.');
}

console.log(`[build] ${local.length} local scripts, ${cdn.length} CDN scripts`);

// Concatenate local scripts in load order (each is a self-contained IIFE).
// The dev index.html sprinkles inline `updateStatus('…')` calls between script
// tags; the bundle drops those, so define a no-op stub up front to keep any
// stray reference harmless WITHOUT needing an inline <script> in prod (which
// would force 'unsafe-inline' back into the CSP).
let combined = 'window.updateStatus=window.updateStatus||function(){};\n';
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
for (const asset of ['manifest.webmanifest', 'service-worker.js', 'icon.svg']) {
  await copyFile(join(root, asset), join(dist, asset));
}

// The loading-screen teardown lived in an inline <script>. Ship it as an
// external file so prod can run under a STRICT CSP with NO 'unsafe-inline' for
// scripts (the whole point of bundling). Same behaviour, CSP-clean.
await writeFile(join(dist, 'boot.js'),
  "window.addEventListener('load',function(){setTimeout(function(){" +
  "var l=document.getElementById('loading');" +
  "if(l){l.classList.add('hidden');setTimeout(function(){l.remove();},500);}" +
  "},600);});\n");

// Production Content-Security-Policy. Because the bundle replaces 70 inline-ish
// script tags with ONE local file (+ pinned CDN deps), script-src no longer
// needs 'unsafe-inline' — the biggest XSS-hardening win of the build. connect-src
// mirrors the data sources the app actually calls (renderer fetchPrices + Worker).
const CSP = "default-src 'self' https:; " +
  "script-src 'self' https://unpkg.com https://cdnjs.cloudflare.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com data:; " +
  "img-src 'self' data: https: https://community.akamai.steamstatic.com; " +
  "connect-src 'self' https://api.coingecko.com https://api.exchangerate-api.com " +
  "https://open.er-api.com https://www.alphavantage.co https://*.workers.dev " +
  "https://cdnjs.cloudflare.com https://www.googleapis.com https://graph.microsoft.com; " +
  "worker-src 'self'; manifest-src 'self'; base-uri 'self'; object-src 'none'";

// Production index.html: keep <head> (CDN deps + styles), single bundle script.
const cdnTags = cdn.map((tag) => `  ${tag}`).join('\n');
const prodHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>MAERMIN v10.0 - Professional Portfolio Tracker</title>
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
    <div class="version-badge">v10.0</div>
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

const kb = (bundle.length / 1024).toFixed(0);
console.log(`[build] dist/maermin.min.js  ${kb} KB`);
console.log('[build] done -> dist/');
