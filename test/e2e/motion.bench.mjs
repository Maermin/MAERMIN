#!/usr/bin/env node
// ============================================================================
// MAERMIN — motion benchmark (npm run bench:motion)
// ----------------------------------------------------------------------------
// Measures how smooth the UI motion is in the production build (dist/) under a
// throttled CPU, so changes to styles.css / fx.js / motion.js can be compared
// with numbers instead of impressions. Scenarios (demo portfolio, 1440x900):
//
//   idle      5 s on the overview, no input  (ambient animations only)
//   hover     pointer sweeps across the cards (spotlight / tilt / aura)
//   navigate  8 sidebar view switches         (view entrance, reveals)
//   palette   command palette open/close x5   (overlay + dialog spring)
//   scroll    scroll the overview down/up     (scroll progress, reveals)
//
// Per scenario: rAF frame intervals (p50 / p95 / max, share of frames > 25 ms
// = visibly dropped at 60 Hz), main-thread long tasks, and Chrome trace time
// spent in style, layout, paint, raster and script.
//
// Usage: npm run build:web && npm run bench:motion [-- --cpu 4 --json out.json]
// Browser: playwright-core Chromium, or CHROME_PATH.
// ============================================================================
import http from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i > -1 ? args[i + 1] : def; };
const DIR = opt('dir', join(root, 'dist'));
const CPU = Number(opt('cpu', 4));
const OUT = opt('json', '');
const FX_OFF = args.includes('--fx-off');
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);   // e.g. --only idle,hover
const CSS = opt('css', '');                                       // extra CSS injected after load (ablation) // reference: the app's own 'motion off' switch
const PASSWORD = 'Correct-Horse-9!';

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function serve(dir) {
  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(dir, path === '/' ? 'index.html' : path);
    try { if (!(await stat(file)).isFile()) throw 0; res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); }
    catch (e) { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}
const LOCAL = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': join(root, 'node_modules/react/umd/react.production.min.js'),
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': join(root, 'node_modules/react-dom/umd/react-dom.production.min.js')
};

// Frame sampler: rAF intervals + long tasks, installed once per page.
const SAMPLER = `(() => {
  if (window.__mxBench) return;
  const B = window.__mxBench = { on: false, frames: [], long: [] };
  let last = 0;
  (function loop(t) { if (B.on && last) B.frames.push(t - last); last = t; requestAnimationFrame(loop); })(performance.now());
  try { new PerformanceObserver((l) => { if (B.on) l.getEntries().forEach((e) => B.long.push(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch (e) {}
})()`;

const TRACE_CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'gpu'];
const BUCKETS = {
  style: ['UpdateLayoutTree', 'RecalculateStyles', 'ParseAuthorStyleSheet'],
  layout: ['Layout'],
  paint: ['Paint', 'PaintImage', 'UpdateLayer', 'PrePaint'],
  raster: ['RasterTask', 'GPUTask', 'Decode Image'],
  composite: ['CompositeLayers', 'UpdateLayerTree', 'Layerize'],
  script: ['FunctionCall', 'EvaluateScript', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'v8.callFunction']
};
function traceSummary(buf) {
  const ev = JSON.parse(buf.toString()).traceEvents || [];
  const out = {}; Object.keys(BUCKETS).forEach((k) => (out[k] = 0));
  const index = {}; Object.entries(BUCKETS).forEach(([k, names]) => names.forEach((n) => (index[n] = k)));
  for (const e of ev) {
    if (e.ph !== 'X' || !index[e.name]) continue;
    out[index[e.name]] += (e.dur || 0) / 1000;
  }
  Object.keys(out).forEach((k) => (out[k] = Math.round(out[k])));
  return out;
}
function stats(frames, longTasks, ms) {
  const f = frames.slice().sort((a, b) => a - b);
  const q = (p) => (f.length ? f[Math.min(f.length - 1, Math.floor(p * f.length))] : 0);
  const janky = frames.filter((x) => x > 25).length;
  return {
    frames: frames.length,
    fps: frames.length ? +(1000 * frames.length / frames.reduce((a, b) => a + b, 0)).toFixed(1) : 0,
    p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(f[f.length - 1] || 0).toFixed(1),
    jank: frames.length ? +(100 * janky / frames.length).toFixed(1) : 0,
    longTasks: longTasks.length, longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0))
  };
}

async function measure(browser, page, name, fn) {
  await page.evaluate(() => { const B = window.__mxBench; B.frames = []; B.long = []; B.on = true; });
  await browser.startTracing(page, { categories: TRACE_CATS });
  const t0 = Date.now();
  await fn();
  const ms = Date.now() - t0;
  const buf = await browser.stopTracing();
  const s = await page.evaluate(() => { const B = window.__mxBench; B.on = false; return { frames: B.frames, long: B.long }; });
  return Object.assign({ scenario: name, ms }, stats(s.frames, s.long, ms), traceSummary(buf));
}

async function main() {
  const server = await serve(DIR);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
  await context.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('http://127.0.0.1')) return r.continue();
    if (LOCAL[u]) return r.fulfill({ path: LOCAL[u], headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/javascript' } });
    return r.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // vault + demo portfolio
  await page.goto(base + '/index.html');
  const pw = page.locator('input[type=password]');
  await pw.nth(1).waitFor();
  await pw.nth(0).fill(PASSWORD); await pw.nth(1).fill(PASSWORD);
  await page.locator('#auth-submit').click();
  await page.getByText('Recovery code').first().waitFor({ timeout: 30000 });
  await page.evaluate(() => { localStorage.setItem('maermin_demo', '1'); localStorage.setItem('maermin_active_view', 'overview'); localStorage.setItem('maermin_onboarded', '1'); });
  if (FX_OFF) await page.evaluate(() => localStorage.setItem('maermin_fx', 'off'));
  await page.waitForTimeout(1200);
  await page.goto(base + '/index.html');
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.locator('#auth-submit').click();
  await page.locator('nav.maermin-sidebar').waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500); // let entrance animations + count-ups finish
  // close anything modal (onboarding, tips)
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  await page.evaluate(SAMPLER);
  if (CSS) { await page.addStyleTag({ content: CSS }); await page.waitForTimeout(300); }

  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

  const results = [];
  if (!ONLY.length || ONLY.includes('idle')) results.push(await measure(browser, page, 'idle', () => page.waitForTimeout(5000)));

  if (!ONLY.length || ONLY.includes('hover')) results.push(await measure(browser, page, 'hover', async () => {
    const cards = await page.locator('.mx-card').evaluateAll((els) => els.slice(0, 12).map((e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; }).filter((c) => c[1] > 0 && c[1] < 900));
    if (!cards.length) { await page.waitForTimeout(3000); return; }
    for (let pass = 0; pass < 2; pass++) {
      for (const [x, y, w] of cards) {
        await page.mouse.move(x - w / 3, y, { steps: 12 });
        await page.mouse.move(x + w / 3, y + 10, { steps: 12 });
      }
    }
  }));

  if (!ONLY.length || ONLY.includes('navigate')) results.push(await measure(browser, page, 'navigate', async () => {
    const views = ['transactions', 'dividends', 'net-worth', 'overview', 'portfolios', 'journal', 'overview', 'transactions'];
    for (const v of views) {
      const b = page.locator('nav.maermin-sidebar [data-view="' + v + '"]');
      if (await b.count()) await b.first().click();
      await page.waitForTimeout(900);
    }
  }));

  if (!ONLY.length || ONLY.includes('palette')) results.push(await measure(browser, page, 'palette', async () => {
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.MaerminUI.openOverlay('commandPalette'));
      await page.waitForTimeout(500);
      await page.evaluate(() => window.MaerminUI.closeOverlay('commandPalette'));
      await page.waitForTimeout(400);
    }
  }));

  if (!ONLY.length || ONLY.includes('scroll')) results.push(await measure(browser, page, 'scroll', async () => {
    await page.mouse.move(900, 500);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 220); await page.waitForTimeout(90); }
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -220); await page.waitForTimeout(90); }
    await page.waitForTimeout(600);
  }));

  await browser.close();
  server.close();

  const cols = ['scenario', 'fps', 'p50', 'p95', 'max', 'jank', 'longTasks', 'longTaskMs', 'style', 'layout', 'paint', 'raster', 'composite', 'script'];
  console.log('\nmotion benchmark — ' + DIR.replace(root, '.') + ' · CPU ' + CPU + 'x slower · 1440x900' + (FX_OFF ? ' · motion OFF' : ''));
  console.log('(fps/p50/p95/max: rAF frame interval in ms; jank = % frames > 25 ms; trace columns = ms of main/raster thread time)\n');
  console.log(cols.map((c) => c.padStart(c === 'scenario' ? 9 : 10)).join(''));
  for (const r of results) console.log(cols.map((c) => String(r[c]).padStart(c === 'scenario' ? 9 : 10)).join(''));
  if (errors.length) console.log('\npage errors: ' + errors.join(' | '));
  if (OUT) await writeFile(OUT, JSON.stringify({ cpu: CPU, dir: DIR, results }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
