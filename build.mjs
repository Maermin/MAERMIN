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
const cdn = [];
const local = [];
let m;
while ((m = scriptRe.exec(html)) !== null) {
  const src = m[1];
  (/^https?:\/\//i.test(src) ? cdn : local).push(src);
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
  target: 'es2020',
  write: false,
});
const bundle = result.outputFiles[0].text;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'maermin.min.js'), bundle);
await copyFile(join(root, 'styles.css'), join(dist, 'styles.css'));

// Production index.html: keep <head> (CDN deps + styles), single bundle script.
const cdnTags = cdn.map((s) => `  <script crossorigin src="${s}"></script>`).join('\n');
const prodHtml = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MAERMIN v9.0 - Professional Portfolio Tracker</title>
  <link rel="stylesheet" href="styles.css">
${cdnTags}
</head>
<body>
  <div id="loading">
    <h1>MAERMIN</h1>
    <div class="version-badge">v9.0</div>
    <div class="subtitle">Multi-Asset Portfolio Tracker with Advanced Analysis</div>
    <div class="loader"></div>
  </div>
  <div id="root"></div>
  <script>window.updateStatus = function(){};</script>
  <script src="maermin.min.js"></script>
  <script>
    window.addEventListener('load', () => setTimeout(() => {
      const l = document.getElementById('loading');
      if (l) { l.classList.add('hidden'); setTimeout(() => l.remove(), 500); }
    }, 600));
  </script>
</body>
</html>
`;
await writeFile(join(dist, 'index.html'), prodHtml);

const kb = (bundle.length / 1024).toFixed(0);
console.log(`[build] dist/maermin.min.js  ${kb} KB`);
console.log('[build] done -> dist/');
