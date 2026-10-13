#!/usr/bin/env node
// ============================================================================
// MAERMIN — headless browser smoke test (npm run test:e2e)
// ----------------------------------------------------------------------------
// The Node suites test the engines, but nothing mounted the React app: a
// render-time crash (the corpActionsRev TDZ in 8d67845) shipped with every
// gate green. This test runs the REAL app in Chromium, for both the dev entry
// (index.html, unbundled scripts) and the production build (dist/):
//
//   1. create a vault, seed data, reload, unlock -> the app mounts
//   2. open every sidebar view -> no page error, no "view crashed"
//   3. Tax view: KPIs, year switch keeps the tab, PDF export (lazy jsPDF)
//   4. upgrade path: year-less price points + plaintext v10 store + schema 3
//      -> migration v4 and plaintext adoption after unlock
//   5. value history from day one: a three-year book + a Worker -> TWR,
//      correlation, risk and rolling volatility without a manual refresh. The
//      Worker is the REAL cf-worker/worker.js, run in this process; only its
//      upstream (Yahoo) is a synthetic, deterministic fixture.
//   6. other trade currencies: a CHF buy is costed at the CHF rate of its date.
//      The rates come through the REAL cf-worker/worker.js, run in this process;
//      only its upstream (Yahoo) is a synthetic fixture.
//
// Offline by design: React is served from node_modules (same bytes as the
// pinned unpkg URL, so SRI still verifies); every other external request is
// aborted and recorded. jsPDF is fetched from cdnjs only when the network is
// reachable (CI), or from JSPDF_DIR when set; otherwise the PDF step is skipped.
//
// Browser: playwright-core's Chromium (CI: `npx playwright-core install
// chromium`), or CHROME_PATH to use an existing binary.
// ============================================================================
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// English UI dates (MaerminI18n 'short' style): 2026-10-05 -> 10/05/2026.
const usDate = (iso) => iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4);
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
const Returns = createRequire(import.meta.url)('../../returns-engine.js'); // P5-2.6: XIRR by hand

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PASSWORD = 'Correct-Horse-9!';

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

// ---- static server ---------------------------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serve(dir) {
  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(dir, path === '/' ? 'index.html' : path);
    if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
    try {
      if (!(await stat(file)).isFile()) throw new Error('dir');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(404); res.end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---- external requests ------------------------------------------------------
const LOCAL = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': join(root, 'node_modules/react/umd/react.production.min.js'),
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': join(root, 'node_modules/react-dom/umd/react-dom.production.min.js')
};
const JSPDF_DIR = process.env.JSPDF_DIR || '';
const JSPDF = {
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js': 'jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/5.0.8/jspdf.plugin.autotable.min.js': 'jspdf.plugin.autotable.min.js'
};
const fetched = []; // market-data calls answered from fixtures

// ---- the real Worker, with a synthetic Yahoo upstream --------------------------
// Requests to WORKER_URL are answered by cf-worker/worker.js itself. Its own
// outbound fetch (Yahoo) is replaced by deterministic series, so the numbers on
// screen can be checked against values computed here.
const WORKER_URL = 'https://maermin-e2e.workers.dev';
const workerMod = await import('../../cf-worker/worker.js');
const workerState = { down: false, oldVersion: false, upstream: [], requests: [] };
const iso = (d) => d.toISOString().slice(0, 10);
const WEEKDAYS = (() => { // every weekday of the last three years, up to today
  const out = [], end = new Date(), d = new Date(Date.UTC(end.getUTCFullYear() - 3, end.getUTCMonth(), end.getUTCDate()));
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) if (d.getUTCDay() % 6) out.push(iso(d));
  return out;
})();
const SYNTH = { // close of day i
  'VWCE.DE': { currency: 'EUR', px: (i) => 100 * Math.pow(1.0004, i) * (1 + 0.010 * Math.sin(i / 3)) },
  'AAPL': { currency: 'USD', px: (i) => 150 * Math.pow(1.0006, i) * (1 + 0.020 * Math.cos(i / 5)) },
  'EURUSD=X': { currency: 'USD', px: () => 1 / 0.9 } // 1 USD = 0.90 EUR on every day
};
const synthFor = (sym) => SYNTH[sym] || { currency: 'USD', px: (i) => 80 * Math.pow(1.0003, i) * (1 + 0.012 * Math.sin(i / 4 + sym.length)) };
const closeOf = (sym, i) => Number(synthFor(sym).px(i).toFixed(4));
// P5-2.5: AAPL pays a dividend every 63rd weekday, one cent more each year
const divOf = (sym, i) => (sym === 'AAPL' && i % 63 === 20 ? Number((0.24 + 0.01 * Math.floor(i / 252)).toFixed(4)) : 0);
{
  const cacheMap = new Map();
  globalThis.caches = { default: {
    match: async (req) => { const b = cacheMap.get(req.url); return b === undefined ? undefined : new Response(b); },
    put: async (req, resp) => { cacheMap.set(req.url, await resp.text()); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    const m = u.match(/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/([^?]+)/);
    if (!m) return realFetch(input, init);
    const sym = decodeURIComponent(m[1]);
    workerState.upstream.push(sym);
    return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: synthFor(sym).currency, exchangeTimezoneName: 'UTC' },
      timestamp: WEEKDAYS.map((d) => Math.floor(Date.parse(d + 'T16:00:00Z') / 1000)),
      indicators: { quote: [{ close: WEEKDAYS.map((_, i) => closeOf(sym, i)) }] },
      events: { dividends: Object.fromEntries(WEEKDAYS.map((d, i) => [i, d]).filter(([i]) => divOf(sym, i) > 0)
        .map(([i, d]) => { const ts = Math.floor(Date.parse(d + 'T16:00:00Z') / 1000); return [ts, { date: ts, amount: divOf(sym, i) }]; })) } }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}
async function answerFromWorker(route) {
  if (workerState.down) return route.abort();
  const rq = route.request();
  workerState.requests.push(rq.url().slice(WORKER_URL.length));
  // A Worker from before the version route (P2-3) answers like any unknown action.
  if (workerState.oldVersion && /[?&]action=version\b/.test(rq.url())) return route.fulfill({ status: 400, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ error: 'Unknown action' }) });
  const res = await workerMod.default.fetch(new Request(rq.url(), { method: rq.method(), headers: { Origin: new URL(rq.headers().origin || rq.headers().referer || 'http://127.0.0.1').origin }, body: rq.method() === 'GET' ? undefined : rq.postData() }), {}, { waitUntil() {} });
  const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
  headers['access-control-allow-origin'] = '*';
  return route.fulfill({ status: res.status, headers, body: await res.text() });
}
// Scenario 1's Worker: crypto prices (?action=cg) come from a fixture, answered
// under the requested CoinGecko id like the real API (the app maps the stored
// ticker "eth" to the id "ethereum"); every other route has no data.
const CG_WORKER = 'https://maermin-cg-e2e.workers.dev';
async function answerFromCgWorker(route) {
  const u = new URL(route.request().url()), a = u.searchParams.get('action');
  const json = (o, status = 200) => route.fulfill({ status, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
  if (a === 'version') return json({ version: workerMod.WORKER_VERSION, actions: [] });
  if (a === 'cg' && u.searchParams.get('p') === 'simple/price') {
    fetched.push('crypto');
    const ids = (u.searchParams.get('ids') || '').split(',');
    return json(ids.includes('ethereum') ? { ethereum: { eur: 3000, usd: 3300 } } : {});
  }
  return json({ error: 'No data' }, 404);
}
async function wire(context, external) {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1')) return route.continue();
    if (url.startsWith(FX_WORKER)) return answerFromFxWorker(route);
    if (url.startsWith(WORKER_URL)) return answerFromWorker(route);
    if (url.startsWith(CG_WORKER)) return answerFromCgWorker(route);
    if (LOCAL[url]) return route.fulfill({ path: LOCAL[url], headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/javascript' } });
    if (JSPDF[url]) {
      if (JSPDF_DIR && existsSync(join(JSPDF_DIR, JSPDF[url]))) {
        return route.fulfill({ path: join(JSPDF_DIR, JSPDF[url]), headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/javascript' } });
      }
      return route.continue(); // real CDN (CI); fails offline -> PDF step skipped
    }
    // Market data the app fetches by itself right after unlock: answer from
    // fixtures (still offline) and log the call so the test can assert on it.
    const json = (o) => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
    if (url.startsWith('https://open.er-api.com/v6/latest/USD')) { fetched.push('fx'); return json({ result: 'success', rates: { EUR: 0.9, USD: 1 } }); }
    external.push(route.request().method() + ' ' + url.split('?')[0]);
    return route.abort();
  });
}

// ---- the real Worker for the currency scenario (synthetic Yahoo upstream) -----
const FX_WORKER = 'https://maermin-fx-e2e.workers.dev';
const fxWorker = await import('../../cf-worker/worker.js');
const fxCalls = [];
{
  const cacheMap = new Map();
  globalThis.caches = globalThis.caches || { default: {
    match: async (req) => { const b = cacheMap.get(req.url); return b === undefined ? undefined : new Response(b); },
    put: async (req, resp) => { cacheMap.set(req.url, await resp.text()); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    const m = u.match(/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/([^?]+)/);
    if (!m || !FX_FIXTURE[decodeURIComponent(m[1])]) return realFetch(input, init); // other symbols: the synthetic price series above
    const f = FX_FIXTURE[decodeURIComponent(m[1])];
    // one close per day for the last 800 days
    const days = []; for (let i = 800; i >= 0; i--) days.push(Math.floor(Date.now() / 1000) - i * 86400);
    return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: f.currency }, timestamp: days, indicators: { quote: [{ close: days.map((t) => (typeof f.close === 'function' ? f.close(new Date(t * 1000).toISOString().slice(0, 10)) : f.close)) }] } }] } }), { status: 200 });
  };
}
const FX_TRADE_DAY = new Date(Date.now() - 300 * 86400000).toISOString().slice(0, 10);
const FX_FIXTURE = {
  // 1 CHF = 1.06 EUR up to and including the trade day, 1.10 EUR from the next day on:
  // taking the following day's (or the latest) rate would show.
  'EURCHF=X': { currency: 'CHF', close: (d) => (d <= FX_TRADE_DAY ? 1 / 1.06 : 1 / 1.10) },
  'EURUSD=X': { currency: 'USD', close: 1 / 0.9 }
};
async function answerFromFxWorker(route) {
  const rq = route.request();
  fxCalls.push(decodeURIComponent(rq.url().slice(FX_WORKER.length)));
  const res = await fxWorker.default.fetch(new Request(rq.url(), { method: rq.method(), body: rq.method() === 'GET' ? undefined : rq.postData() }), {}, { waitUntil() {} });
  return route.fulfill({ status: res.status, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: await res.text() });
}

// ---- helpers ----------------------------------------------------------------
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /view crashed|ReferenceError|TypeError|before initialization/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300));
  });
  return errors;
}
async function createVault(page, base) {
  await page.goto(base + '/index.html');
  const pw = page.locator('input[type=password]');
  await pw.nth(1).waitFor({ timeout: 15000 });
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.locator('#auth-submit').click();
  // The recovery-code screen itself (the setup text also mentions "recovery code").
  await page.locator('#rc-code').waitFor({ timeout: 30000 });
}
async function unlock(page, base, ready = 'nav.maermin-sidebar') { // phone layout: pass a selector that is visible there
  await page.goto(base + '/index.html');
  const pw = page.locator('input[type=password]').first();
  await pw.waitFor({ timeout: 15000 });
  await pw.fill(PASSWORD);
  await page.locator('#auth-submit').click();
  await page.locator(ready).waitFor({ timeout: 30000 });
}
// Figures count up when they appear (motion.js): read a text only once it has
// stopped changing.
async function settledText(locator) {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const cur = await locator.innerText().catch(() => '');
    if (cur && cur === prev) return cur;
    prev = cur;
    await new Promise((r) => setTimeout(r, 250));
  }
  return prev || '';
}
// Force an app re-render without changing app state (open + close an overlay).
async function rerender(page) {
  await page.evaluate(() => window.MaerminUI.openOverlay('commandPalette'));
  await page.waitForTimeout(200);
  await page.evaluate(() => window.MaerminUI.closeOverlay('commandPalette'));
  await page.waitForTimeout(300);
}
// Click a sidebar entry (data-view). A view inside a merged page (P2-1) is
// reached through its group entry (data-views) and then its tab (data-tab).
async function openView(page, id) {
  const entry = page.locator('nav.maermin-sidebar [data-view="' + id + '"]');
  if (await entry.count()) { await entry.first().click(); return; }
  const group = page.locator('nav.maermin-sidebar [data-views~="' + id + '"]');
  if (!(await group.count())) throw new Error('no sidebar entry for ' + id);
  await group.first().click();
  const tab = page.locator('main .mx-area-tabs [data-tab="' + id + '"]');
  if (await tab.count()) await tab.first().click();
}
// The sidebar marks the open view (or its group) and, on a merged page, the tab.
async function isOpen(page, id) {
  if (await page.locator('nav.maermin-sidebar [data-view="' + id + '"][aria-current="page"]').count()) return true;
  if (!(await page.locator('nav.maermin-sidebar [data-views~="' + id + '"][aria-current="page"]').count())) return false;
  const tabs = page.locator('main .mx-area-tabs [data-tab]');
  return !(await tabs.count()) || (await page.locator('main .mx-area-tabs [data-tab="' + id + '"][aria-current="page"]').count()) > 0;
}
// Raw (un-shimmed) localStorage through a same-origin iframe: storage.js
// patches Storage.prototype in the app window only.
const RAW = `(() => { let f = document.getElementById('__raw'); if (!f) { f = document.createElement('iframe'); f.id = '__raw'; f.style.display = 'none'; document.body.appendChild(f); }
  const W = f.contentWindow; return { get: (k) => W.Storage.prototype.getItem.call(W.localStorage, k),
  set: (k, v) => W.Storage.prototype.setItem.call(W.localStorage, k, v),
  keys: () => { const o = []; for (let i = 0; i < W.localStorage.length; i++) o.push(W.localStorage.key(i)); return o; } }; })()`;

// In-page helpers for the dialog scenario. Deliberately independent of
// ui-store.js: a dialog is found by its accessible name, a Tab stop is any
// visible element the browser itself reports as tabbable (tabIndex >= 0).
const DIALOG_PROBE = () => {
  const nameOf = (d) => { const id = d.getAttribute('aria-labelledby'); return ((id ? (document.getElementById(id) || {}).textContent : d.getAttribute('aria-label')) || '').trim(); };
  const find = (name) => Array.from(document.querySelectorAll('[role="dialog"]')).filter((d) => nameOf(d) === name);
  const shown = (el) => el.getClientRects().length > 0;
  let visited = new Set();
  window.__dlg = {
    desc(el) { return !el ? 'null' : el.tagName + (el.id ? '#' + el.id : '') + ' "' + (el.getAttribute('aria-label') || el.innerText || el.placeholder || '').trim().slice(0, 30) + '"'; },
    info(name) {
      const hit = find(name), d = hit[0], a = document.activeElement;
      const all = Array.from(document.querySelectorAll('[role="dialog"]')).map(nameOf).join(' | ');
      if (!d) return { count: 0, all };
      const focus = a === d ? 'panel' : !d.contains(a) ? 'outside' : /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) ? 'field' : 'control';
      return { count: hit.length, all, modal: d.getAttribute('aria-modal'), focus, active: this.desc(a),
        stops: Array.from(d.querySelectorAll('*')).filter((el) => el.tabIndex >= 0 && !el.disabled && shown(el)).length };
    },
    reset() { visited = new Set(); },
    seen(name) { const d = find(name)[0], a = document.activeElement; if (!d || !d.contains(a)) return false; if (a !== d) visited.add(a); return true; },
    visited() { return visited.size; }
  };
};

const TXS = [
  { id: 'a1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, fees: 10, currency: 'EUR', date: '2025-02-03', portfolioId: 'default' },
  { id: 'a2', type: 'sell', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 150, currency: 'EUR', date: '2025-06-02', portfolioId: 'default' },
  { id: 'b1', type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 500, currency: 'EUR', date: '2025-01-10', portfolioId: 'default' },
  { id: 'b2', type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 1200, currency: 'EUR', date: '2025-03-10', portfolioId: 'default' },
  { id: 'v1', type: 'buy', category: 'stocks', symbol: 'VWCE.DE', quantity: 5, price: 110, currency: 'EUR', date: '2024-05-02', portfolioId: 'default' },
  // data-check fixtures: a sell without a buy (oversold) and a crypto-quoted trade
  { id: 'x1', type: 'sell', category: 'crypto', symbol: 'ADA', quantity: 5, price: 0, currency: 'EUR', date: '2024-02-01', portfolioId: 'default' },
  { id: 'x2', type: 'buy', category: 'crypto', symbol: 'ETH', quantity: 1, price: 0.05, currency: 'BTC', date: '2024-02-01', portfolioId: 'default' }
];

const VIEWS = ['overview', 'transactions', 'portfolios', 'net-worth', 'dividends', 'journal',
  'returns', 'performance', 'rebalancing', 'savings-plans', 'cashflow', 'fees', 'analytics', 'health',
  'investment-analysis', 'tax', 'intelligence', 'tags', 'categories', 'customize', 'discovery', 'share',
  'watchlist', 'rules', 'attribution', 'news', 'data', 'trash', 'privacy'];

// ---- scenarios ----------------------------------------------------------------
async function runBuild(browser, label, dir) {
  console.log('\n' + label + ' (' + dir.replace(root, '.') + '):');
  const server = await serve(dir);
  const base = 'http://127.0.0.1:' + server.address().port;
  const external = [];

  // 1-3: fresh vault, mount, every view, tax view
  {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    await page.evaluate(([txs, cg]) => {
      localStorage.setItem('transactions', JSON.stringify(txs));
      localStorage.setItem('taxJurisdiction', 'de');
      localStorage.setItem('apiKeys', JSON.stringify({ cs2Worker: cg }));
      localStorage.setItem('maermin_tax_settings', JSON.stringify({ abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true }));
      // recorded daily values of the active portfolio (no trades in between): 3,000 -> 3,300
      localStorage.setItem('maermin_snapshots', JSON.stringify({ version: 1, points: [
        { d: '2025-07-01', v: 3000, pid: 'default' }, { d: '2025-07-02', v: 3150, pid: 'default' }, { d: '2025-07-03', v: 3300, pid: 'default' }] }));
    }, [TXS, CG_WORKER]);
    await page.waitForTimeout(1500); // encrypted persist
    try { await unlock(page, base); }
    catch (e) {
      ok('app mounts after unlock', false, (errors.join(' | ') || e.message).slice(0, 400));
      await context.close(); server.close(); return;
    }
    ok('app mounts after unlock', errors.length === 0, errors.join(' | '));

    // Prices right after unlock: one fetch fires without a click, and holdings
    // that have no quote yet are valued at cost and labelled - never -100%.
    await page.waitForTimeout(2500);
    ok('prices are fetched after unlock, without a click', fetched.includes('fx') && fetched.includes('crypto'), fetched.join(','));
    // CoinGecko calls are queued 1.5 s apart (rate limit), so the quote can
    // land a moment after the request: wait for it instead of a fixed delay.
    await page.waitForFunction(() => /3,550/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
    {
      const b0 = await page.innerText('body');
      ok('unpriced holdings are not shown as a total loss', !/-100\.00%/.test(b0), (b0.match(/.{0,60}-100\.00%.{0,20}/) || [''])[0].replace(/\n/g, ' | '));
      ok('unpriced holdings are labelled "no price"', (await page.locator('[data-testid="no-price"]').count()) > 0);
      // ETH got a quote (3,000 EUR), VWCE.DE has none -> 5 x 110 at cost.
      ok('total = fetched quote + cost fallback (3,550.00)', /3,550/.test(b0), (b0.match(/TOTAL PORTFOLIO VALUE[\s\S]{0,80}/) || [''])[0].replace(/\n/g, ' | '));
    }

    // P4-2: Open/Closed toggle on the positions table; closed rows from the FIFO ledger
    {
      await page.locator('[data-pos-tab="closed"]').click();
      await page.waitForTimeout(300);
      const rows = await page.locator('[data-testid="closed-positions"] tbody tr[data-closed-key]').allInnerTexts();
      const aapl = rows.find((r) => /AAPL/.test(r)) || '', btc = rows.find((r) => /BTC/.test(r)) || '';
      ok('P4-2: Closed lists the two fully sold positions (AAPL, BTC), newest sale first', rows.length === 2 && /AAPL/.test(rows[0]), rows.map((r) => r.replace(/\n/g, ' ')).join(' || '));
      ok('P4-2: AAPL cost 1,010 (incl. fee), proceeds 1,500, realized +490 (+48.51%)', /1,010\.00/.test(aapl) && /1,500\.00/.test(aapl) && /\+490\.00/.test(aapl) && /\+48\.51%/.test(aapl), aapl.replace(/\n/g, ' '));
      ok('P4-2: BTC realized +700 (+140.00%)', /\+700\.00/.test(btc) && /\+140\.00%/.test(btc), btc.replace(/\n/g, ' '));
      await page.locator('[data-testid="closed-positions"] tbody tr[data-closed-key="stocks|AAPL"]').click();
      const dlg = page.locator('[aria-labelledby="dlg-position"]');
      await dlg.waitFor({ timeout: 5000 }).catch(() => {});
      const dt = await dlg.innerText().catch(() => '');
      ok('P4-2: the dialog of a closed position shows realized figures and no average-cost line', /Realized P&L/i.test(dt) && /\+490\.00/.test(dt) && (await page.locator('[data-testid="avg-cost-line"]').count()) === 0, dt.slice(0, 200).replace(/\n/g, ' | '));
      ok('P5-2.4: without daily closes the position dialog shows no heatmap', (await dlg.locator('[data-testid="pos-heatmap"]').count()) === 0);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.locator('[data-pos-tab="open"]').click();
      await page.waitForTimeout(300);
    }

    // P2-1: a vault that already holds transactions opens in Advanced, with
    // the six areas; Simple hides niche tools and the switch persists.
    {
      const sections = await page.locator('nav.maermin-sidebar .mx-nav-section').allInnerTexts();
      ok('sidebar shows the six areas', sections.map((x) => x.trim().toUpperCase()).join() === 'PORTFOLIO,TRANSACTIONS,DIVIDENDS,TAXES,ANALYSIS,SETTINGS', sections.join(','));
      ok('a vault with transactions starts in Advanced', (await page.evaluate(RAW + '.get("maermin_ui_mode")')) === 'advanced' && (await page.locator('nav.maermin-sidebar [data-view="tags"]').count()) === 1);
      // P5-1.1 (F4): Tax & FIFO is visible at 1440 × 900 in Advanced mode
      // without scrolling the sidebar.
      {
        const size = page.viewportSize();
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(300);
        const pos = await page.evaluate(() => {
          const nav = document.querySelector('nav.maermin-sidebar');
          const tax = nav && nav.querySelector('[data-view="tax"]');
          if (!nav || !tax) return null;
          nav.scrollTop = 0;
          const n = nav.getBoundingClientRect(), r = tax.getBoundingClientRect();
          return { bottom: Math.round(r.bottom), navBottom: Math.round(Math.min(n.bottom, window.innerHeight)), top: Math.round(r.top) };
        });
        ok('F4: Tax & FIFO is in view at 1440 × 900 without scrolling the sidebar', !!pos && pos.top >= 0 && pos.bottom <= pos.navBottom, JSON.stringify(pos));
        await page.setViewportSize(size);
        await page.waitForTimeout(300);
      }
      await page.locator('.mx-settings-btn').click();
      await page.locator('#mx-settings-panel [data-ui-mode="simple"]').click();
      await page.locator('.mx-settings-btn').click();
      await page.waitForTimeout(300);
      const simpleOk = (await page.locator('nav.maermin-sidebar [data-view="tags"]').count()) === 0 && (await page.locator('nav.maermin-sidebar .mx-mode-hint').count()) === 1
        && (await page.evaluate(RAW + '.get("maermin_ui_mode")')) === 'simple';
      ok('Simple hides niche tools, says so and is saved', simpleOk);
      await page.keyboard.press('g'); await page.keyboard.press('u'); // Alerts & Rules: hidden in Simple, the shortcut still works
      await page.waitForTimeout(300);
      ok('a hidden view stays reachable by shortcut and shows in its area', (await page.locator('nav.maermin-sidebar [data-view="rules"][aria-current="page"]').count()) === 1);
      await openView(page, 'returns');
      await page.waitForTimeout(200);
      const tabs = (await page.locator('main .mx-area-tabs [data-tab]').evaluateAll((els) => els.map((e) => e.dataset.tab))).join();
      ok('Simple shows Returns + Performance as tabs (no Attribution)', tabs === 'returns,performance', tabs);
      await page.locator('nav.maermin-sidebar .mx-mode-hint [data-ui-mode="advanced"]').click();
      await page.waitForTimeout(200);
      const tabsAdv = (await page.locator('main .mx-area-tabs [data-tab]').evaluateAll((els) => els.map((e) => e.dataset.tab))).join();
      ok('"Show all tools" switches back to Advanced (Attribution tab back)', tabsAdv === 'returns,performance,attribution' && (await page.evaluate(RAW + '.get("maermin_ui_mode")')) === 'advanced', tabsAdv);
    }

    const crashedIn = [], nested = [];
    for (const id of VIEWS) {
      const before = errors.length;
      try { await openView(page, id); } catch (e) { crashedIn.push(id + ': ' + e.message); continue; }
      await page.waitForTimeout(150);
      if (!(await isOpen(page, id))) crashedIn.push(id + ': not active after click');
      if (errors.length > before) crashedIn.push(id + ': ' + errors.slice(before).join(' | '));
      // P5-1.2: no control inside another control (a role="button" card held inputs and buttons).
      const n = await page.evaluate(() => [...document.querySelectorAll('main [role="button"], main button')]
        .filter((el) => el.querySelector('button, input, select, textarea, a[href], [role="button"]')).map((el) => (el.getAttribute('aria-label') || el.innerText || el.tagName).slice(0, 40)));
      if (n.length) nested.push(id + ': ' + n.join(', '));
    }
    ok('every sidebar view renders without an error (' + VIEWS.length + ' views)', crashedIn.length === 0, crashedIn.join(' || '));
    ok('P5-1.2: no view nests a control inside a button', nested.length === 0, nested.join(' || '));

    // M-10: a space typed while renaming a portfolio stays in the name.
    {
      await openView(page, 'portfolios');
      await page.getByRole('button', { name: /Rename portfolio/ }).first().click();
      const field = page.locator('main input[aria-label="Portfolio name"]');
      await field.fill('');
      await field.type('Trade Republic');
      const typed = await field.inputValue();
      await field.press('Enter');
      await page.waitForTimeout(200);
      ok('renaming a portfolio keeps the space ("Trade Republic")', typed === 'Trade Republic' && (await page.locator('main', { hasText: 'Trade Republic' }).count()) > 0, typed);
      await page.getByRole('button', { name: /Rename portfolio/ }).first().click();
      await field.fill('Main Portfolio');
      await field.press('Enter');
    }

    // Empty analytics states: a portfolio without price history must say so,
    // not spin forever or print invented / zero figures.
    await openView(page, 'analytics');
    await page.waitForTimeout(400);
    ok('correlation explains missing history instead of "Loading..."', (await page.locator('[data-testid="correlation-empty"]').count()) === 1 && (await page.locator('[data-testid="correlation-loading"]').count()) === 0);
    await page.getByRole('button', { name: 'Risk Level' }).click();
    await page.waitForTimeout(400);
    { const rb = await page.innerText('body'); ok('risk view shows no zero metrics without history', !/Sharpe Ratio/.test(rb) && /observations so far/.test(rb)); }
    await openView(page, 'investment-analysis');
    await page.waitForTimeout(400);
    { const db = await page.innerText('body'); ok('DCA analyzer shows no demo figures', (await page.locator('[data-testid="dca-empty"]').count()) === 1 && !/DCA Wins|12\.50%/.test(db)); }

    // No Worker and no daily closes in this session: TWR falls back to the
    // recorded snapshots (3,000 -> today's 3,550 with no trade in between).
    await openView(page, 'returns');
    await page.waitForTimeout(300);
    {
      const card = page.locator('[data-testid="twr-card"]');
      const txt = await settledText(card);
      ok('TWR falls back to the recorded snapshots without daily closes (+18.33%)', (await card.getAttribute('data-source')) === 'snapshots' && /\+18\.33%/.test(txt), ((await card.getAttribute('data-source')) + ' | ' + txt).replace(/\n/g, ' | '));
    }

    await openView(page, 'transactions');
    const check = await page.locator('[data-testid="ledger-issues"]').first().innerText().catch(() => '');
    ok('Data check lists the oversell and the unconvertible currency', /Data check: 2 issues/.test(check), check.slice(0, 120));
    // P4-6: each finding has a stable code and an action
    { let codes = [], editSym = '', search = '', err = '';
      try {
        await page.locator('[data-testid="ledger-issues"] summary').first().click();
        codes = await page.locator('[data-testid="ledger-issues"] li[data-dq-code]').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-dq-code')));
        await page.locator('li[data-dq-code="DQ-FX-UNKNOWN"] [data-dq-action="edit-transaction"]').click();
        const dlg = page.locator('[aria-labelledby="dlg-transaction"]');
        await dlg.waitFor({ timeout: 5000 });
        editSym = await dlg.locator('input').evaluateAll((ins) => ins.map((i) => i.value).join('|'));
        await dlg.getByRole('button', { name: 'Close', exact: true }).click();
        await page.waitForTimeout(300);
        await page.locator('li[data-dq-code="DQ-OVERSOLD"] [data-dq-action="show-transactions"]').click();
        await page.waitForTimeout(300);
        search = await page.locator('main input[type="text"], main input[type="search"]').evaluateAll((ins) => ins.map((i) => i.value).filter(Boolean).join('|'));
        await page.locator('main input[value="ADA"]').first().fill(''); // the next steps need the full list
        await page.waitForTimeout(200);
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P4-6: findings carry codes DQ-OVERSOLD and DQ-FX-UNKNOWN', codes.includes('DQ-OVERSOLD') && codes.includes('DQ-FX-UNKNOWN'), err || codes.join(','));
      ok('P4-6: "Edit transaction" opens the ETH trade quoted in BTC', /ETH/.test(editSym) && /0\.05/.test(editSym), err || editSym);
      ok('P4-6: "Show transactions" filters the list to ADA', /ADA/.test(search), err || search); }

    // P2-4: a deleted transaction goes to the trash; Undo and Restore bring it back.
    {
      const hasX2 = () => page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').some((t) => t.id === 'x2'));
      const delX2 = async () => {
        await page.locator('button[aria-label^="Delete: "][aria-label*="ETH"]').first().click();
        await page.locator('tr', { hasText: 'Delete this transaction?' }).getByRole('button', { name: 'Delete', exact: true }).click();
        await page.waitForTimeout(400);
      };
      await delX2();
      const gone = !(await hasX2());
      const undo = page.locator('[data-testid="toast-action"]', { hasText: 'Undo' });
      const undoShown = (await undo.count()) > 0;
      if (undoShown) await undo.first().click();
      await page.waitForTimeout(400);
      ok('delete → toast with Undo → the transaction is back', gone && undoShown && (await hasX2()));
      await delX2();
      await openView(page, 'trash');
      const row = page.locator('[data-testid="trash-view"] li[data-trash-kind="transaction"]');
      const listed = (await row.count()) === 1 && /ETH/.test(await row.first().innerText());
      if (listed) await row.first().getByRole('button', { name: /^Restore/ }).click();
      await page.waitForTimeout(400);
      const tv = await page.locator('[data-testid="trash-view"]').innerText().catch(() => '');
      ok('Settings → Trash lists the deleted transaction and Restore puts it back', listed && (await hasX2()) && /The trash is empty/.test(tv), tv.slice(0, 200));
      const dup = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').filter((t) => t.id === 'x2').length);
      ok('restored once, no duplicate', dup === 1, String(dup));
    }

    // P2-5: the views whose figures could read as advice say they are not.
    {
      const missing = [];
      for (const [id, kind] of [['tax', 'tax'], ['health', 'invest'], ['intelligence', 'invest']]) {
        await openView(page, id);
        await page.waitForTimeout(300);
        const d = page.locator('main [data-testid="disclaimer"][data-kind="' + kind + '"]');
        if (!(await d.count()) || !/No tax or investment advice/.test(await d.first().innerText())) missing.push(id);
      }
      const taxNote = await page.locator('main [data-testid="disclaimer"]').first().innerText().catch(() => '');
      ok('disclaimer on Tax, Health (advisor) and Intelligence', missing.length === 0, missing.join(', '));
      await openView(page, 'tax');
      ok('Tax view names the supported tax rules', /German and US tax rules/.test(await page.locator('main [data-testid="disclaimer"][data-kind="tax"]').first().innerText().catch(() => '')), taxNote);
      await openView(page, 'privacy');
      const pv = await page.locator('[data-testid="privacy-view"]').innerText().catch(() => '');
      ok('Settings → Privacy lists what stays local and what goes where', ['Stays on this device', 'Your Cloudflare Worker', 'CoinGecko', 'Cloud sync', 'Share & Compare'].every((x) => pv.includes(x)), pv.slice(0, 160));
      // P4-5: summary for an AI assistant - redacted by default, full only after a confirmation, never with Privacy Mode
      { let red = '', full = '', priv = null, err = '';
        try {
          await page.locator('[data-ai-level="redacted"]').click();
          red = await page.locator('[data-testid="ai-text"]').inputValue();
          await page.locator('[data-ai-level="full"]').click();
          await page.getByRole('dialog').getByRole('button', { name: 'Show full summary' }).click();
          await page.waitForTimeout(200);
          full = await page.locator('[data-testid="ai-text"]').inputValue();
          await page.keyboard.press('p'); // Privacy Mode on
          await page.waitForTimeout(300);
          priv = { fullBtn: await page.locator('[data-ai-level="full"]').count(), note: await page.locator('[data-testid="ai-privacy-note"]').count(),
            text: await page.locator('[data-testid="ai-text"]').inputValue().catch(() => '') };
          await page.keyboard.press('p'); // off again
          await page.waitForTimeout(200);
        } catch (e) { err = e.message.split('\n')[0]; }
        ok('P4-5: the summary without amounts has weights and no holding or amount', /Asset classes: /.test(red) && !/ETH|VWCE|€|3,000/.test(red), err || red.slice(0, 160));
        ok('P4-5: the full summary (after confirming) names holdings and amounts', /ETH/.test(full) && /VWCE\.DE/.test(full) && /€/.test(full), err || full.slice(0, 160));
        ok('P4-5: with Privacy Mode only the summary without amounts is offered', !!priv && priv.fullBtn === 0 && priv.note === 1 && !/ETH|€/.test(priv.text), JSON.stringify(priv)); }
    }

    // Tax view: go there, pick the report tab and 2025.
    await openView(page, 'tax');
    await page.getByRole('button', { name: 'Tax Report', exact: true }).click();
    await page.locator('select', { has: page.locator('option[value="2025"]') }).first().selectOption('2025');
    await page.waitForTimeout(500);
    const body = await page.innerText('body');
    ok('year switch keeps the Tax Report tab', /Export PDF/.test(body));
    // AAPL 500 + BTC 700 realised; stocks 490 < 1000 allowance, crypto 700 < Freigrenze -> 0 tax
    // The report is memoised: a tax-setting change made outside React state
    // (localStorage) must still rebuild it on the next render.
    await page.evaluate(() => {
      localStorage.setItem('maermin_tax_settings', JSON.stringify({ abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 0, cryptoExemption: true }));
    });
    await rerender(page);
    // no allowance: stock gain 490 -> 490 * 25 % * 1.055 = 129.24 (crypto 700 stays under the Freigrenze)
    { const b2 = await page.innerText('body'); ok('memoised report rebuilds after a stored setting changes (129.24 €)', /Tax Liability\s*129\.24/.test(b2), b2.slice(b2.indexOf('Realized Gains'), b2.indexOf('Realized Gains') + 160).replace(/\n/g, ' | ')); }
    await page.evaluate(() => {
      localStorage.setItem('maermin_tax_settings', JSON.stringify({ abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true }));
    });
    await rerender(page);
    ok('tax KPIs: realised 1,190.00 €, tax 0.00 €', /Realized Gains\s*1,190\.00/.test(body) && /Tax Liability\s*0\.00/.test(body), body.slice(body.indexOf('Realized Gains'), body.indexOf('Realized Gains') + 140).replace(/\n/g, ' | '));

    // P2-6: Freistellungsaufträge per broker. Main Portfolio's 2025 capital
    // income is the AAPL gain of 490 (crypto stays out): order 600 -> 490 used, 110 left.
    {
      const panel = page.locator('[data-testid="fsa-panel"]');
      const addBroker = async (name, amount) => {
        await panel.getByRole('textbox', { name: 'Broker', exact: true }).fill(name);
        await panel.getByRole('textbox', { name: 'Order', exact: true }).fill(amount);
        await panel.getByRole('button', { name: 'Add broker' }).click();
        await page.waitForTimeout(200);
      };
      let row = '';
      try {
        await panel.waitFor({ timeout: 5000 });
        await addBroker('Bank A', '600');
        await panel.locator('label', { hasText: 'Main Portfolio' }).first().locator('input[type=checkbox]').check();
        await page.waitForTimeout(400);
        row = await panel.locator('tr[data-fsa-broker="Bank A"]').innerText();
      } catch (e) { row = 'ERR ' + e.message.split('\n')[0]; }
      ok('FSA: a broker linked to Main Portfolio shows its 2025 income, used and left (490 / 490 / 110)', /490\.00[\s\S]*490\.00[\s\S]*110\.00/.test(row), row.replace(/\s+/g, ' '));
      await addBroker('Broker B', '500');
      const over = await panel.locator('[data-testid="fsa-over"]').innerText().catch(() => '');
      ok('FSA: orders of 1,100 over the 1,000 allowance are flagged', /1,100\.00/.test(over) && /100\.00\s€ more/.test(over), over);
    }

    // P2-6: Anlage KAP lines for a portfolio at a broker without German withholding.
    {
      const kap = page.locator('[data-testid="kap-panel"]');
      let l19 = '', l20 = '', note = '';
      try {
        await kap.locator('label', { hasText: 'Main Portfolio' }).first().locator('input[type=checkbox]').check();
        await page.waitForTimeout(400);
        l19 = await kap.locator('tr[data-kap-line="KAP:19"]').innerText();
        l20 = await kap.locator('tr[data-kap-line="KAP:20"]').innerText();
        note = await kap.locator('[data-testid="kap-check"]').innerText();
      } catch (e) { l19 = 'ERR ' + e.message.split('\n')[0]; }
      ok('Anlage KAP: line 19 and 20 carry the AAPL gain of 490, with the "check the line numbers" note', /490\.00/.test(l19) && /490\.00/.test(l20) && /Check them against the form/.test(note), l19 + ' | ' + l20);
    }

    let pdf = null;
    try {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20000 }),
        page.getByRole('button', { name: 'Export PDF' }).click()
      ]);
      pdf = await download.path();
    } catch (e) { /* offline without JSPDF_DIR */ }
    if (pdf) ok('PDF export lazy-loads jsPDF and downloads', true);
    else if (process.env.CI || JSPDF_DIR) ok('PDF export lazy-loads jsPDF and downloads', false, 'no download (CDN unreachable?)');
    else console.log('  - PDF export skipped (jsPDF not reachable; set JSPDF_DIR to test offline)');

    // P2-7: Steam inventory import through the paste path (no Worker needed).
    {
      const inv = JSON.stringify({ assets: [
        { appid: 730, contextid: '2', assetid: 's1', classid: 'k1', instanceid: '0', amount: '1' },
        { appid: 730, contextid: '2', assetid: 's2', classid: 'k1', instanceid: '0', amount: '1' },
        { appid: 730, contextid: '2', assetid: 's3', classid: 'k2', instanceid: '0', amount: '1' }],
        descriptions: [{ classid: 'k1', instanceid: '0', market_hash_name: 'AK-47 | Redline (Field-Tested)', marketable: 1 },
          { classid: 'k2', instanceid: '0', market_hash_name: 'Service Medal', marketable: 0 }] });
      const panel = page.locator('[data-testid="steam-import"]');
      const readPasted = async () => {
        // The Data view remounts after an import and opens on its first tab.
        if (!(await panel.count())) await page.getByRole('button', { name: /Steam inventory/ }).click();
        if (!(await panel.getByRole('textbox', { name: 'Inventory JSON' }).count())) await panel.getByRole('button', { name: 'Paste instead' }).click();
        await panel.getByRole('textbox', { name: 'Inventory JSON' }).fill(inv);
        await panel.getByRole('button', { name: 'Read pasted inventory' }).click();
        await page.waitForTimeout(300);
      };
      let booked = null, again = '';
      try {
        await openView(page, 'data');
        await readPasted();
        const price = panel.getByRole('textbox', { name: 'Price per item for AK-47 | Redline (Field-Tested)' });
        await price.fill('12.50'); await price.press('Tab');
        await page.waitForTimeout(200);
        await panel.getByRole('button', { name: 'Import 1 row' }).click();
        await page.waitForTimeout(500);
        booked = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').filter((t) => t.source === 'steam-import'));
        await readPasted();
        again = await panel.locator('[data-testid="steam-msg"]').innerText().catch(() => '');
      } catch (e) { again = 'ERR ' + e.message.split('\n')[0]; }
      ok('Steam import: pasted inventory -> one buy of 2 × AK-47 at 12.50 € with both asset ids', !!booked && booked.length === 1 && booked[0].quantity === 2 && booked[0].price === 12.5 && booked[0].category === 'skins' && booked[0].steamAssetIds.join() === 's1,s2', JSON.stringify(booked));
      ok('Steam import: a re-import offers only the item not imported before', /^1 new item \(1 name\)/.test(again) && (await panel.locator('tr[data-steam-item]').count()) === 1, again);
    }
    // P5-1.1 (F2): no default targets. The old app-wide default (as older
    // builds saved it) reads as "no targets": no plan, no skins to buy.
    {
      let empty = 0, plan = -1, kept = '', current = '', targets = null, err = '';
      try {
        await page.evaluate(() => localStorage.setItem('maermin_targets', JSON.stringify({ crypto: 35, stocks: 45, skins: 10, commodities: 10 })));
        await openView(page, 'overview'); await page.waitForTimeout(200);
        await openView(page, 'rebalancing');
        await page.waitForTimeout(400);
        empty = await page.locator('[data-testid="rb-no-targets"]').count();
        plan = await page.locator('[data-testid="rb-plan"]').count();
        kept = await page.evaluate(() => localStorage.getItem('maermin_targets'));
        await page.locator('[data-rb-use-current]').click();
        await page.waitForTimeout(300);
        current = await page.locator('[data-testid="rb-summary"]').innerText();
        targets = await page.evaluate(() => JSON.parse(localStorage.getItem('maermin_targets') || 'null'));
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('F2: the old default reads as no targets - no plan, stored value untouched', empty === 1 && plan === 0 && /"skins":10/.test(kept), err || `empty=${empty} plan=${plan} kept=${kept}`);
      ok('F2: "Use my current allocation" saves targets that add up to 100 with nothing to trade', !!targets && Object.values(targets).reduce((s, v) => s + v, 0) === 100 && /^Nothing to buy or sell/.test(current), err || JSON.stringify(targets) + ' | ' + current);
    }
    // P4-4: Rebalancing - never-sell holding, then invest only
    {
      await page.evaluate(() => localStorage.setItem('maermin_targets', JSON.stringify({ crypto: 30, stocks: 50, skins: 10, commodities: 10 })));
      await openView(page, 'overview'); await page.waitForTimeout(200);
      await openView(page, 'rebalancing');
      await page.waitForTimeout(400);
      let crypto = null, blocked = '', after = null, summary = '';
      try {
        await page.locator('[data-testid="rb-nosell"] summary').click();
        await page.locator('input[data-nosell="ETH"]').check();
        await page.waitForTimeout(300);
        crypto = await page.locator('tr[data-rb-row="crypto"]').getAttribute('data-action');
        blocked = await page.locator('[data-testid="rb-summary"]').innerText();
        await page.locator('[data-rb-mode="cashflow"]').click();
        await page.locator('#rb-invest').fill('1000');
        await page.waitForTimeout(300);
        after = await page.locator('tr[data-rb-row]').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-action')));
        summary = await page.locator('[data-testid="rb-summary"]').innerText();
      } catch (e) { summary = 'ERR ' + e.message.split('\n')[0]; }
      ok('P4-4: ETH marked "never sell" - crypto is held and the plan names what cannot be sold', crypto === 'hold' && /cannot be sold \(never-sell holdings\)/.test(blocked), crypto + ' | ' + blocked);
      ok('P4-4: invest only - 1,000 planned as buys, nothing sold', !!after && !after.includes('sell') && /^Buy 1,000\.00/.test(summary), JSON.stringify(after) + ' | ' + summary);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('maermin_rebalance_prefs') || '{}'));
      const raw = await page.evaluate(RAW + '.get("maermin_rebalance_prefs")');
      ok('P4-4: mode and never-sell list are saved, encrypted', saved.mode === 'cashflow' && (saved.noSell || []).join() === 'ETH' && raw === null, JSON.stringify(saved) + ' raw=' + raw);
    }
    // P4-7: reorder the Overview sections - arrow buttons, keyboard on the handle, pointer drag
    {
      const order = () => page.locator('[data-ov-section]').evaluateAll((els) => els.map((x) => x.getAttribute('data-ov-section')).join(','));
      let a = '', b = '', c = '', said = '', focusOk = false, err = '';
      try {
        await openView(page, 'customize');
        // P5-1.5: four sections (Returns sits third), so three steps to the top
        for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Move Allocation · Top Performers · Positions up' }).click();
        await page.waitForTimeout(150); // focus is restored after the re-render
        said = await page.locator('main [role="status"][aria-live="polite"]').last().innerText();
        focusOk = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-dash-id')) === 'allocation');
        await openView(page, 'overview'); await page.waitForTimeout(400);
        a = await order();
        await openView(page, 'customize');
        await page.locator('[data-dash-handle="valueChart"]').focus();
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(200);
        await openView(page, 'overview'); await page.waitForTimeout(400);
        b = await order();
        await openView(page, 'customize');
        const h = await page.locator('[data-dash-handle="statCards"]').boundingBox();
        const top = await page.locator('[data-dash-row="allocation"]').boundingBox();
        await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
        await page.mouse.down();
        await page.mouse.move(h.x + h.width / 2, top.y + 4, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(200);
        await openView(page, 'overview'); await page.waitForTimeout(400);
        c = await order();
        await openView(page, 'customize');
        await page.getByRole('button', { name: 'Reset to default' }).click();
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P4-7: "Move up" puts Allocation first on the Overview, focus stays, position announced', a === 'allocation,valueChart,statCards,returnFigures' && focusOk && /position 1 of 4/.test(said), err || a + ' | ' + said + ' | focus ' + focusOk);
      ok('P4-7: ArrowDown on a drag handle moves that section', b === 'allocation,statCards,valueChart,returnFigures', err || b);
      ok('P4-7: dragging a handle (pointer) moves the section to the top', c === 'statCards,allocation,valueChart,returnFigures', err || c);
    }
    // P4-3: foreign withholding tax by country (German tax view), from dividend calendar entries
    {
      await page.evaluate(() => localStorage.setItem('maermin_divevents', JSON.stringify([
        { id: 'w1', symbol: 'AAPL', date: '2025-05-10', amount: 100, withholding: 30, currency: 'EUR' },
        { id: 'w2', symbol: 'NESN.SW', date: '2025-04-20', amount: 200, withholding: 70, currency: 'EUR' },
        { id: 'w3', symbol: 'ZZQQ', date: '2025-06-01', amount: 20, withholding: 0, currency: 'EUR' }])));
      let us = '', ch = '', unk = '', title = '', err = '';
      try {
        await openView(page, 'tax');
        await page.getByRole('button', { name: 'Tax Report', exact: true }).click();
        await page.locator('select', { has: page.locator('option[value="2025"]') }).first().selectOption('2025');
        await page.waitForTimeout(500);
        const panel = page.locator('[data-testid="wht-panel"]');
        title = await panel.locator('h3').innerText();
        us = await panel.locator('tr[data-wht-country="US"]').innerText();
        ch = await panel.locator('tr[data-wht-country="CH"]').innerText();
        unk = await panel.locator('tr[data-wht-country="unknown"]').innerText();
      } catch (e) { err = e.message.split('\n')[0]; }
      const flat = (x) => x.replace(/\s+/g, ' ');
      ok('P4-3: panel is labelled an estimate for 2025', /2025 \(estimate\)/.test(title), err || title);
      ok('P4-3: USA - gross 100, withheld 30, creditable 15, reclaim 15', /100\.00/.test(us) && /30\.00/.test(us) && (flat(us).match(/15\.00/g) || []).length === 2, err || flat(us));
      ok('P4-3: Switzerland - withheld 70 of 200, creditable 30, reclaim 40', /200\.00/.test(ch) && /70\.00/.test(ch) && /30\.00/.test(ch) && /40\.00/.test(ch), err || flat(ch));
      ok('P4-3: a dividend without a known country sits in the "unknown" row', /Country unknown/.test(unk) && /20\.00/.test(unk), err || flat(unk));
      await page.evaluate(() => localStorage.setItem('maermin_divevents', '[]'));
    }
    // P4-8: Portfolio Performance export (German layout, made-up figures) through the import wizard
    {
      const PP = ['Datum;Typ;Wert;Buchungswährung;Bruttobetrag;Währung Bruttobetrag;Wechselkurs;Gebühren;Steuern;Stück;ISIN;WKN;Ticker-Symbol;Wertpapiername;Notiz',
        '2024-01-15T00:00;Einlage;5.000,00;EUR;;;;;;;;;;;',
        '2024-01-16T09:30;Kauf;-1.004,99;EUR;;;;4,99;;10;IE00B4L5Y983;A0RPWH;EUNL.DE;iShares Core MSCI World;',
        '2024-03-15T00:00;Dividende;8,50;EUR;11,55;USD;1,0870;;1,59;5;US0378331005;865985;AAPL;Apple Inc.;',
        '2024-06-03T14:00;Verkauf;520,00;EUR;;;;5,00;15,00;5;IE00B4L5Y983;A0RPWH;EUNL.DE;iShares Core MSCI World;'].join('\r\n');
      let howto = '', info = '', chips = '', toast = '', err = '', deposit = null;
      try {
        await openView(page, 'data');
        await page.getByRole('button', { name: /Broker Import/ }).click();
        await page.getByRole('button', { name: 'Select broker Portfolio Performance' }).click();
        howto = await page.locator('[data-testid="tracker-howto"]').innerText();
        await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles({ name: 'Depotumsaetze.csv', mimeType: 'text/csv', buffer: Buffer.from(PP, 'utf8') });
        info = await page.locator('[data-testid="tracker-info"]').innerText();
        chips = await page.locator('[data-testid="tracker-info"]').locator('xpath=preceding-sibling::div[1]').innerText();
        await page.getByRole('button', { name: /Import 4/ }).click();
        toast = await page.getByText(/4 transactions imported/).first().innerText();
        deposit = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').find((x) => x.date === '2024-01-15' && x.type === 'deposit'));
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P4-8: the PP tile explains the export (Depotumsätze / Kontoumsätze)', /Securities Account Transactions/.test(howto) && /Kontoumsätze/.test(howto), err || howto);
      ok('P4-8: file read as Portfolio Performance, booking rules shown, no column mapping', /How Portfolio Performance rows are booked/.test(info), err || info);
      ok('P4-8 / P5-1.3: 4 valid rows (the deposit is a cash booking now), none skipped', /Detected: Portfolio Performance/.test(chips) && /4 valid/.test(chips) && !/skipped/.test(chips), err || chips);
      ok('P4-8: import books the 4 rows', /4 transactions imported/.test(toast), err || toast);
      ok('P5-1.3: the PP deposit is stored as a cash row of 5,000 EUR', !!deposit && deposit.amount === 5000 && deposit.category === 'cashflow', err || JSON.stringify(deposit));
    }
    ok('no page errors in the session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // P4-9: the demo works without a Worker (sample daily closes in memory)
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    await page.evaluate(() => { localStorage.setItem('maermin_demo', '1'); localStorage.setItem('maermin_ui_mode', 'advanced'); localStorage.setItem('maermin_onboarded', '1'); });
    let chart = 0, twr = '', cells = 0, closed = '', stored = 'x', err = '';
    let returnsText = '', intelText = '', rbEmpty = 0, rbPlan = -1, ovReturns = '';
    let brokerOv = '', rows = 0, before = null, after = null;
    // P5-1.8: Worker-only views run on in-page sample data; nothing may reach the network
    const sampleReqs = []; page.on('request', (r) => { if (/maermin\.invalid/.test(r.url())) sampleReqs.push(r.url()); });
    const fixtures = {}; let dqText = '', va = null, br = null, lt = null, dh = null, hrd = null;
    try {
      await unlock(page, base);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      chart = await page.locator('main svg path').count();
      await page.locator('[data-pos-tab="closed"]').click();
      closed = await page.locator('[data-pos-tab="closed"]').innerText();
      await openView(page, 'returns');
      await page.waitForTimeout(800);
      twr = await page.getByText('TWR', { exact: true }).first().locator('xpath=..').innerText();
      cells = await page.locator('[data-r]').count();
      stored = await page.evaluate(() => localStorage.getItem('maermin_close_history'));
      returnsText = await page.locator('main').innerText();
      await page.waitForTimeout(1200);
      fixtures.returns = { badges: await page.locator('main [data-testid="sample-data"]').count(), text: await page.locator('main').innerText() };
      // P5-2.1: profit by source, read for Max and 1M
      va = await page.evaluate(async () => {
        const el = document.querySelector('[data-testid="value-attribution"]');
        if (!el) return null;
        const num = (s) => { const m = String(s).replace(/−/g, '-').match(/[+-]?[\d,]+\.\d\d/); return m ? parseFloat(m[0].replace(/,/g, '')) : NaN; };
        const read = () => { const rows = {}; el.querySelectorAll('[data-testid^="va-row-"]').forEach((r) => { rows[r.getAttribute('data-testid').slice(7)] = num(r.innerText.split('\n').pop()); }); return rows; };
        el.querySelector('[data-testid="va-period-MAX"]').click(); await new Promise((r) => setTimeout(r, 300));
        const max = read();
        el.querySelector('[data-testid="va-period-1M"]').click(); await new Promise((r) => setTimeout(r, 300));
        return { max, m1: read(), biggest: (el.querySelector('[data-testid="va-biggest"]') || {}).innerText || '' };
      });
      // P5-2.2: the same money in MSCI World (dividends reinvested, then price only) and in a held fund
      br = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const card = () => document.querySelector('[data-testid="benchmark-replay"]');
        const num = (s) => { const m = String(s || '').replace(/−/g, '-').match(/[+-]?[\d,]+\.\d\d/); return m ? parseFloat(m[0].replace(/,/g, '')) : NaN; };
        const tile = (k) => { const t = card() && card().querySelector('[data-testid="br-' + k + '"]'); return t ? t.innerText : ''; };
        for (let i = 0; i < 20 && !tile('bench'); i++) await wait(250);
        const read = () => ({ own: num(tile('own')), bench: num(tile('bench')), diff: num(tile('diff')), verdict: (card().querySelector('[data-testid="verdict-replay"]') || {}).innerText || '', text: card().innerText });
        const acc = read();
        card().querySelector('[data-testid="br-reinvest"]').click(); await wait(1200);
        const price = read();
        const f = card().querySelector('[data-testid^="br-fund-"]');
        if (f) { f.click(); await wait(1200); }
        return { acc, price, fund: f ? read() : null };
      });
      // P5-2.3: import a (made-up) holdings file for the demo's world ETF, then export the look-through
      await openView(page, 'health');
      await page.locator('[data-testid="lt-input-VWCE"]').waitFor({ state: 'attached', timeout: 10000 });
      const ltCsv = ['Sample Fund Holdings as of,"Oct 10, 2026"', '', 'Ticker,Name,Sector,Asset Class,Weight (%),Location,Currency',
        'AAPL,APPLE INC,Information Technology,Equity,40,United States,USD', 'NVDA,NVIDIA CORP,Information Technology,Equity,30,United States,USD',
        'SAP,SAP SE,Information Technology,Equity,20,Germany,EUR', '7203,TOYOTA MOTOR CORP,Consumer Discretionary,Equity,9.5,Japan,JPY',
        'EUR,EUR CASH,Cash and/or Derivatives,Cash,0.5,Germany,EUR'].join('\n');
      const storedBefore = await page.evaluate(() => localStorage.getItem('maermin_fund_holdings'));
      await page.locator('[data-testid="lt-input-VWCE"]').setInputFiles({ name: 'sample_holdings.csv', mimeType: 'text/csv', buffer: Buffer.from(ltCsv) });
      await page.waitForTimeout(1200);
      lt = { src: await page.locator('[data-testid="lt-src-VWCE"]').innerText().catch(() => ''), card: await page.locator('[data-testid="lt-files"]').innerText().catch(() => ''),
        table: await page.locator('[data-testid="lt-files"]').locator('xpath=ancestor::div[.//table][1]').locator('table').first().innerText().catch(() => ''), storedAfter: await page.evaluate(() => localStorage.getItem('maermin_fund_holdings')), storedBefore };
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.locator('[data-testid="lt-export"]').click().catch(() => null)]);
      if (dl) { lt.file = dl.suggestedFilename(); const chunks = []; for await (const c of await dl.createReadStream()) chunks.push(c); lt.csv = Buffer.concat(chunks).toString('utf8'); }
      for (const id of ['news', 'discovery', 'performance', 'dividends']) {
        await openView(page, id);
        await page.waitForTimeout(id === 'news' ? 2000 : 1200);
        fixtures[id] = { badges: await page.locator('main [data-testid="sample-data"]').count(), text: await page.locator('main').innerText() };
      }
      // P5-2.6: per holding on Analysis → Returns
      await openView(page, 'returns');
      await page.locator('[data-testid="holding-returns"]').waitFor({ timeout: 10000 }).catch(() => {});
      await page.locator('[data-testid="hr-by-class"]').click().catch(() => {});
      hrd = await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const classes = Array.from(document.querySelectorAll('[data-testid="hr-irr"] tbody tr')).map((tr) => tr.getAttribute('data-key'));
        const best = Array.from(document.querySelectorAll('[data-testid="hr-best"] [data-ret]')).map((d) => parseFloat(d.getAttribute('data-ret')));
        const years = Array.from(document.querySelectorAll('[data-testid="hr-capital"] tr[data-y] td[data-k="net"]')).map((td) => parseFloat(td.getAttribute('data-v')));
        const avg = q('[data-testid="hr-cf-avg"]');
        return { classes, best, years, avg: avg ? parseFloat(avg.getAttribute('data-v')) : NaN, avgText: avg ? avg.innerText : '' };
      });
      await page.locator('[data-testid="hr-cf-month"]').click().catch(() => {});
      hrd.months = await page.locator('[data-testid="hr-capital"] tr[data-ym]').count();
      await openView(page, 'dividends');
      await page.waitForTimeout(800);
      // P5-2.5: Dividends → History (matrix gross / net, growth, backtest) and the forecast months
      await page.getByRole('button', { name: /^History$/ }).first().click();
      await page.locator('[data-testid="div-backtest"] [data-stat="income"]').waitFor({ timeout: 15000 }).catch(() => {});
      const mxRead = () => page.evaluate(() => {
        const t = document.querySelector('[data-testid="div-matrix"]');
        const rows = Array.from(t.querySelectorAll('tbody tr[data-sym]')).map((r) => parseFloat(r.querySelector('td[data-total]').getAttribute('data-total')));
        const yearTot = Array.from(t.querySelectorAll('tr[data-row="total"] td[data-y]')).map((td) => parseFloat(td.getAttribute('data-v')));
        return { rows, years: Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent), grand: parseFloat(t.querySelector('tr[data-row="total"] td[data-total]').getAttribute('data-total')), yearSum: yearTot.reduce((a, b) => a + b, 0) };
      });
      dh = { net: await mxRead() };
      await page.locator('[data-testid="div-gross-net"] [data-basis="gross"]').click();
      await page.waitForTimeout(500);
      dh.gross = await mxRead();
      await page.locator('[data-testid="div-gross-net"] [data-basis="net"]').click();
      dh.growthRows = await page.locator('[data-testid="div-growth"] tbody tr').count();
      dh.bt5 = await page.locator('[data-testid="div-backtest"] tbody tr').count();
      dh.btBadge = await page.locator('[data-testid="div-backtest"] [data-testid="sample-data"]').count();
      await page.locator('[data-testid="bt-years-10"]').click();
      await page.waitForTimeout(400);
      dh.bt10 = await page.locator('[data-testid="div-backtest"] tbody tr').count();
      await page.getByRole('button', { name: /^Forecast$/ }).first().click();
      await page.waitForTimeout(800);
      dh.months = await page.locator('[data-testid="df-months"] button[data-month]').count();
      await page.locator('[data-testid="df-months"] button[data-month="1"]').click();
      dh.month = await page.evaluate(() => {
        const d = document.querySelector('[data-testid="df-month-detail"]');
        const items = Array.from(d.querySelectorAll('[data-sym]')).length;
        const v = d.querySelector('[data-v]');
        return { total: v ? parseFloat(v.getAttribute('data-v')) : NaN, items, text: d.innerText.slice(0, 160) };
      });
      await openView(page, 'tax');
      await page.getByRole('button', { name: /^Tax Report$/ }).first().click();
      await page.waitForTimeout(1200);
      dqText = await page.locator('main').innerText();
      // P5-1.5: the Overview's Returns section
      await openView(page, 'overview');
      await page.locator('[data-testid="ov-returns"]').waitFor({ timeout: 8000 });
      await page.waitForTimeout(1500); // figures count up when they appear
      ovReturns = await page.locator('[data-testid="ov-returns"]').innerText();
      // P5-1.7: two portfolios in memory; the broker's clearing account shows its cash
      const keys = ['maermin_portfolios', 'maermin_active_portfolio', 'maermin_fund_types', 'maermin_vap_records', 'transactions'];
      before = await page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), keys);
      await page.getByRole('button', { name: 'Savings plan broker' }).first().click();
      await page.waitForTimeout(1500);
      brokerOv = await page.locator('main').innerText();
      await openView(page, 'transactions');
      await page.waitForTimeout(800);
      rows = await page.evaluate(() => (window.MaerminDemo ? window.MaerminDemo.getTransactions().length : 0));
      await openView(page, 'overview');
      await page.getByRole('button', { name: 'All Portfolios' }).first().click();
      after = await page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), keys);
      await openView(page, 'intelligence');
      await page.waitForTimeout(800);
      intelText = await page.locator('main').innerText();
      await openView(page, 'rebalancing');
      await page.waitForTimeout(400);
      rbEmpty = await page.locator('[data-testid="rb-no-targets"]').count();
      rbPlan = await page.locator('[data-testid="rb-plan"]').count();
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('F1: demo Intelligence does not call Bitcoin or Ethereum a company', !!intelText && !/(Bitcoin|Ethereum|BTC|ETH)[^\n]{0,60}(exposure|alone is|of your portfolio)/.test(intelText), err || (intelText.match(/[^\n]*(Bitcoin|BTC)[^\n]*/) || ['none'])[0]);
    ok('F2: demo Rebalancing asks for targets and proposes no trades', rbEmpty === 1 && rbPlan === 0, err || `empty=${rbEmpty} plan=${rbPlan}`);
    ok('P5-1.5: demo Overview shows the Returns section with seven figures', ['XIRR', 'TWR', 'Realized gains', 'Dividends received', 'Taxes', 'Total Fees', 'Net return'].every((w) => new RegExp(w, 'i').test(ovReturns)) && (ovReturns.match(/[+-]?\d[\d,]*\.\d\d/g) || []).length >= 6, err || ovReturns.split('\n').join(' | '));
    ok('F3: the "Total bought" card no longer says deposited', /All purchases, incl\. fees/.test(returnsText) && !/Total deposited/i.test(returnsText), err || returnsText.slice(0, 120));
    ok('P4-9: demo draws the value chart without a Worker', chart > 0, err || String(chart));
    { const f = fixtures, sum = (k) => f[k] ? f[k].badges + ' ' + f[k].text.slice(0, 120).replace(/\n/g, ' | ') : 'missing';
      ok('P5-1.8: News shows sample headlines, labelled', !!f.news && f.news.badges > 0 && /Sample headline:/.test(f.news.text), err || sum('news'));
      ok('P5-1.8: Discovery lists fictional sample companies, labelled', !!f.discovery && f.discovery.badges > 0 && /\(sample\)/.test(f.discovery.text), err || sum('discovery'));
      ok('P5-1.8: Returns: benchmark and FX attribution run on sample data, labelled', !!f.returns && f.returns.badges >= 2 && /Alpha \(ann\.\)/i.test(f.returns.text), err || sum('returns'));
      ok('P5-1.8: Performance shows period returns in the demo, labelled', !!f.performance && f.performance.badges > 0 && !/the demo records none/.test(f.performance.text), err || sum('performance'));
      ok('P5-1.8: Earnings calendar lists dates in the demo, labelled', !!f.dividends && f.dividends.badges > 0 && !/Add a Worker URL in API Settings to see upcoming earnings/.test(f.dividends.text), err || sum('dividends'));
      ok('P5-1.8: no request to the sample URL reaches the network', sampleReqs.length === 0, sampleReqs.slice(0, 3).join(' '));
      { const gap = (r) => { const parts = Object.keys(r).filter((k) => k !== 'start' && k !== 'end').reduce((s, k) => s + r[k], 0); return Math.abs(parts - (r.end - r.start)); };
        ok('P5-2.1: Returns shows profit by source; the parts add up to end − start (Max and 1M)', !!va && va.max.start === 0 && va.max.end > 0 && gap(va.max) < 0.1 && va.m1.start > 0 && gap(va.m1) < 0.1 && !('residual' in va.max) && /Biggest driver:/.test(va.biggest),
          err || JSON.stringify(va)); }
      { const n = dh && dh.net, g = dh && dh.gross, sum = (a) => a.reduce((x, y) => x + y, 0);
        ok('P5-2.5: dividend matrix: rows and years add up to the total, back to 2023; gross is above net', !!n && Math.abs(sum(n.rows) - n.grand) < 1e-6 && Math.abs(n.yearSum - n.grand) < 1e-6 && n.years.includes('2023') && g.grand > n.grand + 1,
          err || JSON.stringify(dh && { net: n && n.grand, gross: g && g.grand, years: n && n.years }));
        ok('P5-2.5: growth per payer, and the backtest on sample data: 5 then 10 years', !!dh && dh.growthRows >= 10 && dh.bt5 === 5 && dh.bt10 > 5 && dh.btBadge === 1, err || JSON.stringify(dh && { g: dh.growthRows, b5: dh.bt5, b10: dh.bt10, badge: dh.btBadge }));
        ok('P5-2.5: the forecast has 24 months; a month lists its payments', !!dh && dh.months === 24 && dh.month.total > 0 && dh.month.items > 0, err || JSON.stringify(dh && { m: dh.months, month: dh.month })); }
      { const h = hrd, m = h && (h.avgText.match(/over (\d+) months/) || [])[1];
        ok('P5-2.6: demo per holding: IRR by asset class, best sales ranked, capital flow per year adds up to the monthly average', !!h && h.classes.length >= 3 && h.classes.every((k) => /^class:/.test(k))
          && h.best.length > 0 && h.best.every((r, i, a) => !i || a[i - 1] >= r) && !!m && Math.abs(h.years.reduce((a, b) => a + b, 0) / Number(m) - h.avg) < 1e-6 && h.months === Number(m),
          err || JSON.stringify(h).slice(0, 300)); }
      ok('P5-2.3: a holdings file imported for VWCE: source line, holdings via VWCE in the effective exposure', !!lt && /your file .*4 holdings/.test(lt.src) && /4 holdings imported for VWCE/.test(lt.card) && /NVIDIA CORP[^\n]*via VWCE/i.test(lt.table), err || JSON.stringify(lt).slice(0, 300));
      ok('P5-2.3: the demo keeps the imported file in memory only', !!lt && lt.storedAfter === lt.storedBefore, err || String(lt && lt.storedAfter).slice(0, 80));
      ok('P5-2.3: look-through exports as CSV', !!lt && lt.file === 'maermin-look-through.csv' && /^Security,Key,Effective weight %/.test(lt.csv || '') && /NVIDIA/.test(lt.csv || ''), err || JSON.stringify(lt && { file: lt.file, csv: (lt.csv || '').slice(0, 80) }));
      { const sums = (r) => r && Math.abs(r.own - r.bench - r.diff) < 0.02;
        ok('P5-2.2: same money in MSCI World (EUNL.DE, reinvested) vs your portfolio, with a verdict; own end = profit-by-source end', !!br && sums(br.acc) && Math.abs(br.acc.own - va.max.end) < 0.01 && br.acc.bench > 0 && /MSCI World/.test(br.acc.verdict) && /EUNL\.DE/.test(br.acc.text), err || JSON.stringify(br && br.acc).slice(0, 300));
        ok('P5-2.2: price only (URTH) differs from reinvested and says the dividends are left out', !!br && sums(br.price) && br.price.bench !== br.acc.bench && /Price only \(URTH\)/.test(br.price.text), err || JSON.stringify(br && br.price).slice(0, 300));
        ok('P5-2.2: a held fund can be the comparison', !!br && !!br.fund && sums(br.fund) && /Same money in VWCE\.DE/i.test(br.fund.text), err || JSON.stringify(br && br.fund).slice(0, 300)); }
      ok('P5-1.8: the demo has dated USD rates, the Tax Report shows no data check', /Tax Report/.test(dqText) && !/Data check:/.test(dqText), err || (dqText.match(/Data check[^\n]*/) || [''])[0]); }
    ok('P5-1.7: demo has 300+ rows and a broker portfolio with a clearing account', rows >= 300 && /Cash \(clearing account\)/i.test(brokerOv), err || rows + ' | ' + brokerOv.slice(0, 160).replace(/\n/g, ' | '));
    ok('P5-1.7: switching demo portfolios writes nothing to the user\'s storage', !!before && JSON.stringify(before) === JSON.stringify(after), err || JSON.stringify([before, after]).slice(0, 200));
    ok('P4-9: demo TWR is a figure, the monthly grid is filled', /[+-]\d/.test(twr) && cells > 12, err || twr.replace(/\s+/g, ' ') + ' | cells ' + cells);
    ok('P4-9: demo shows a closed position', /\(1\)/.test(closed), err || closed);
    ok('P4-9: the sample closes are never stored', stored === null, err || String(stored).slice(0, 60));
    ok('no page errors in the demo session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // P5-1.9: the public demo link opens the demo without a vault and never
  // touches the visitor's real storage - neither in a fresh browser nor next
  // to an existing vault.
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    let pwFields = -1, banner = '', positions = 0, realKeys = null, exitTo = '', vaultScreen = 0, err = '';
    try {
      await page.goto(base + '/index.html?demo');
      await page.locator('nav.maermin-sidebar').waitFor({ timeout: 30000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      pwFields = await page.locator('input[type=password]').count();
      banner = await page.locator('main').innerText();
      positions = await page.evaluate(() => (window.MaerminDemo ? window.MaerminDemo.getTransactions().length : 0));
      await openView(page, 'transactions');
      await page.waitForTimeout(500);
      // A second tab of the same browser without ?demo sees the real storage.
      const plain = await context.newPage();
      await plain.goto(base + '/index.html');
      await plain.locator('input[type=password]').first().waitFor({ timeout: 15000 });
      realKeys = await plain.evaluate(() => Object.keys(localStorage).filter((k) => !/^maermin_(theme|lang|language|prefs)/.test(k)));
      await plain.close();
      await openView(page, 'overview');
      await page.waitForTimeout(800);
      await page.getByRole('button', { name: 'Exit demo', exact: true }).first().click();
      await page.waitForURL((u) => !/demo/.test(u.search), { timeout: 10000 });
      exitTo = page.url();
      vaultScreen = await page.locator('input[type=password]').count();
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('P5-1.9: ?demo opens the demo without a password', pwFields === 0 && /sample data/i.test(banner) && positions >= 300, err || pwFields + ' | ' + banner.slice(0, 80));
    ok('P5-1.9: the demo tab writes nothing to the real storage', Array.isArray(realKeys) && !realKeys.some((k) => /transactions|maermin_demo|maermin_portfolios|maermin_onboarded|apiKeys/.test(k)), err || JSON.stringify(realKeys));
    ok('P5-1.9: Exit demo opens the normal app (vault screen) without ?demo', /\/index\.html$/.test(exitTo) && vaultScreen > 0, err || exitTo + ' | ' + vaultScreen);
    ok('no page errors in the public demo', errors.length === 0, errors.join(' | '));
    await context.close();
  }
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await wire(context, external);
    const page = await context.newPage();
    await createVault(page, base);
    await page.waitForTimeout(1500);
    const snap = () => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
    let before = '', after = '', inDemo = -1, unlocked = false, err = '';
    try {
      await page.goto(base + '/index.html');
      await page.locator('input[type=password]').first().waitFor({ timeout: 15000 });
      before = await snap();
      await page.goto(base + '/index.html?demo');
      await page.locator('nav.maermin-sidebar').waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      inDemo = await page.locator('input[type=password]').count();
      await page.goto(base + '/index.html');
      await page.locator('input[type=password]').first().waitFor({ timeout: 15000 });
      after = await snap();
      await unlock(page, base);
      unlocked = true;
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('P5-1.9: next to an existing vault ?demo still opens without a password', inDemo === 0, err || String(inDemo));
    ok('P5-1.9: the vault and its storage are byte-for-byte unchanged and still unlock', !!before && before === after && unlocked, err || 'changed: ' + (before !== after));
    await context.close();
  }

  // P5-1.2: the Strategy sections fit a 375 px phone (two-column cards overflowed)
  {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    await page.evaluate(() => { localStorage.setItem('maermin_demo', '1'); localStorage.setItem('maermin_ui_mode', 'advanced'); localStorage.setItem('maermin_onboarded', '1'); });
    const wide = []; let sections = 0, err = '';
    try {
      await unlock(page, base, 'main.maermin-main');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
      await page.evaluate(() => document.querySelector('nav.maermin-sidebar [data-view="investment-analysis"]').click());
      await page.waitForTimeout(800);
      const bar = 'main div[style*="border-bottom"][style*="flex-wrap"] > button';
      sections = await page.locator(bar).count();
      for (let i = 0; i < sections; i++) {
        const btn = page.locator(bar).nth(i);
        const label = (await btn.innerText()).trim();
        await btn.click();
        await page.waitForTimeout(500);
        const over = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          return [...document.querySelectorAll('main *')].filter((el) => {
            const b = el.getBoundingClientRect();
            if (!b.width || b.right <= vw + 1) return false;
            for (let p = el.parentElement; p && p.tagName !== 'MAIN'; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return false; }
            return true;
          }).length;
        });
        if (over) wide.push(label + ': ' + over);
      }
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('P5-1.2: every Strategy section fits a 375 px screen', !err && sections >= 6 && wide.length === 0, err || `sections=${sections} ${wide.join(', ')}`);
    ok('no page errors in the 375 px session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // P5-1.3: cash bookings in the transaction dialog - a deposit, a transfer pair, delete + Undo
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    await page.evaluate(() => {
      localStorage.setItem('maermin_onboarded', '1');
      localStorage.setItem('maermin_ui_mode', 'advanced');
      localStorage.setItem('maermin_schema_version', String(window.MaerminMigrations.LATEST));
      localStorage.setItem('maermin_portfolios', JSON.stringify([{ id: 'default', name: 'Main Portfolio', color: '#8b7cff' }, { id: 'pf_b', name: 'Broker B', color: '#3b82f6' }]));
      localStorage.setItem('transactions', JSON.stringify([{ id: 'c1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 1, price: 100, currency: 'EUR', date: '2026-01-02', portfolioId: 'default' }]));
    });
    await page.waitForTimeout(1500); // let the encrypted writes finish before the reload
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]'));
    const dlg = page.locator('[aria-labelledby="dlg-transaction"]');
    const book = async (type, amount, counter) => {
      await page.getByRole('button', { name: /Add Transaction/ }).first().click();
      await dlg.waitFor({ timeout: 5000 });
      await dlg.locator('[data-tx-mode="cash"]').click();
      await dlg.locator('#tx-cash-type').selectOption(type);
      if (counter) await dlg.locator('#tx-cash-counter').selectOption(counter);
      await dlg.locator('#tx-amount').fill(amount);
      await dlg.locator('[data-tx-save]').click();
      await page.waitForTimeout(400);
    };
    let dep = null, pair = [], rowText = '', afterDelete = -1, afterUndo = -1, err = '';
    try {
      await unlock(page, base);
      await page.keyboard.press('Escape');
      await openView(page, 'transactions');
      await book('deposit', '1000,50');
      dep = (await stored()).find((x) => x.type === 'deposit');
      await book('transfer_out', '250', 'pf_b');
      pair = (await stored()).filter((x) => x.transferId);
      rowText = await page.locator('main tr', { hasText: 'Transfer out' }).first().innerText();
      await page.locator('button[aria-label^="Delete: Transfer out"]').first().click();
      await page.locator('tr', { hasText: 'Delete this transaction?' }).getByRole('button', { name: 'Delete', exact: true }).click();
      await page.waitForTimeout(400);
      afterDelete = (await stored()).filter((x) => x.transferId).length;
      await page.locator('[data-testid="toast-action"]', { hasText: 'Undo' }).first().click();
      await page.waitForTimeout(400);
      afterUndo = (await stored()).filter((x) => x.transferId).length;
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('P5-1.3: a deposit booked in the dialog (German-style "1000,50") is a cash row', !!dep && dep.amount === 1000.5 && dep.category === 'cashflow' && dep.portfolioId === 'default' && !dep.symbol, err || JSON.stringify(dep));
    ok('P5-1.3: a transfer books both halves with one transferId', pair.length === 2 && pair[0].transferId === pair[1].transferId
      && pair.some((x) => x.type === 'transfer_out' && x.portfolioId === 'default') && pair.some((x) => x.type === 'transfer_in' && x.portfolioId === 'pf_b'), err || JSON.stringify(pair));
    ok('P5-1.3: the list names the other portfolio and the signed amount', /→ Broker B/.test(rowText) && /−250\.00/.test(rowText), err || rowText.replace(/\n/g, ' | '));
    ok('P5-1.3: deleting one half deletes both; Undo brings both back', afterDelete === 0 && afterUndo === 2, err || `afterDelete=${afterDelete} afterUndo=${afterUndo}`);
    ok('no page errors in the cash session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // P5-1.4: clearing account - switch on, negative balance found, missing deposits booked
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    await page.evaluate(() => {
      localStorage.setItem('maermin_onboarded', '1');
      localStorage.setItem('maermin_ui_mode', 'advanced');
      localStorage.setItem('maermin_schema_version', String(window.MaerminMigrations.LATEST));
      localStorage.setItem('maermin_portfolios', JSON.stringify([{ id: 'default', name: 'Main Portfolio', color: '#8b7cff' }]));
      localStorage.setItem('transactions', JSON.stringify([
        { id: 'k1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, fees: 1, currency: 'EUR', date: '2026-01-05', portfolioId: 'default' },
        { id: 'k2', type: 'deposit', category: 'cashflow', amount: 500, currency: 'EUR', date: '2026-01-02', portfolioId: 'default' }]));
    });
    await page.waitForTimeout(1500); // let the encrypted writes finish before the reload
    let cashText = '', finding = 0, dlgText = '', deposits = [], after = '', findingAfter = -1, ovCard = '', saved = null, returnsTxt = '', err = '';
    try {
      await unlock(page, base);
      await page.keyboard.press('Escape');
      await openView(page, 'portfolios');
      await page.locator('[data-pf-clearing-toggle="default"]').check();
      await page.waitForTimeout(400);
      cashText = await page.locator('[data-pf-cash="default"]').innerText();
      saved = await page.evaluate(() => (JSON.parse(localStorage.getItem('maermin_portfolios') || '[]')[0] || {}).clearing);
      await openView(page, 'transactions');
      await page.locator('[data-testid="ledger-issues"] summary').first().click();
      finding = await page.locator('li[data-dq-code="DQ-CASH-NEGATIVE"]').count();
      await page.locator('li[data-dq-code="DQ-CASH-NEGATIVE"] [data-dq-action="book-deposits"]').click();
      const dlg = page.locator('[aria-labelledby="dlg-confirm"]');
      await dlg.waitFor({ timeout: 5000 });
      dlgText = await dlg.innerText();
      await dlg.getByRole('button', { name: 'Book the missing deposits' }).click();
      await page.waitForTimeout(500);
      deposits = (await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]'))).filter((x) => x.type === 'deposit');
      findingAfter = await page.locator('li[data-dq-code="DQ-CASH-NEGATIVE"]').count();
      await openView(page, 'portfolios');
      after = await page.locator('[data-pf-cash="default"]').innerText();
      await openView(page, 'overview');
      await page.getByText('Cash (clearing account)').first().waitFor({ timeout: 8000 }).catch(() => {});
      ovCard = await page.locator('body').innerText();
      await openView(page, 'returns');
      await page.getByText(/from deposits and withdrawals/).first().waitFor({ timeout: 5000 }).catch(() => {});
      returnsTxt = await page.locator('main').innerText();
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('P5-1.4: Returns: XIRR is taken from deposits and withdrawals', /from deposits and withdrawals/i.test(returnsTxt), err || returnsTxt.slice(0, 300));
    ok('P5-1.4: switching the clearing account on is saved with the portfolio', !!saved && saved.enabled === true, err || JSON.stringify(saved));
    ok('P5-1.4: the card shows the balance (500 in, 1,001 out = -501.00)', /-501\.00/.test(cashText), err || cashText);
    ok('P5-1.4: the data check lists DQ-CASH-NEGATIVE', finding === 1, err || String(finding));
    ok('P5-1.4: "book the missing deposits" asks first and names the amount', /501\.00/.test(dlgText), err || dlgText.replace(/\n/g, ' | '));
    ok('P5-1.4: one deposit of 501.00 on the day of the buy is booked', deposits.length === 2 && deposits.some((d) => d.amount === 501 && d.date === '2026-01-05'), err || JSON.stringify(deposits));
    ok('P5-1.4: the balance is 0 and the finding is gone', /\b0\.00/.test(after) && findingAfter === 0, err || `${after} / ${findingAfter}`);
    // labels are upper-cased by CSS, so innerText is too
    ok('P5-1.4: the overview shows the cash card with the total incl. cash', /Cash \(clearing account\)/i.test(ovCard) && /Total incl\. cash: 1,001\.00/i.test(ovCard), err || (ovCard.match(/Cost basis[\s\S]{0,300}/i) || [ovCard.slice(-300)])[0].split('\n').join(' | '));
    ok('no page errors in the clearing session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // P5-1.2: a row synced in for a portfolio deleted on this device moves to Main
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    await page.evaluate(() => {
      localStorage.setItem('maermin_onboarded', '1');
      localStorage.setItem('maermin_schema_version', String(window.MaerminMigrations.LATEST)); // past v5: the post-sync check must do the move
      localStorage.setItem('maermin_portfolios', JSON.stringify([{ id: 'default', name: 'Main Portfolio', color: '#8b7cff' }]));
      localStorage.setItem('transactions', JSON.stringify([
        { id: 'o1', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 1, price: 100, currency: 'EUR', date: '2026-01-02', portfolioId: 'default' },
        { id: 'o2', type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 100, currency: 'EUR', date: '2026-01-03', portfolioId: 'pf_gone' }]));
    });
    await page.waitForTimeout(1500); // let the encrypted writes finish before the reload
    let moved = null, toast = '', err = '', all = '';
    try {
      await unlock(page, base);
      await page.waitForTimeout(1200);
      all = await page.evaluate(() => localStorage.getItem('transactions'));
      moved = JSON.parse(all || '[]').find((x) => x.id === 'o2');
      toast = await page.getByText(/from deleted portfolios moved to/).first().innerText({ timeout: 5000 }).catch(() => 'no toast');
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('P5-1.2: an orphaned row moves to Main and remembers its portfolio', !!moved && moved.portfolioId === 'default' && moved.movedFrom === 'pf_gone', err || String(all).slice(0, 300));
    ok('P5-1.2: the move is announced', /1 entry from deleted portfolios moved to Main Portfolio/.test(toast), err || toast);
    ok('no page errors in the orphan session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // 4: upgrade path
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    await page.evaluate((raw) => {
      // encrypted (through the shim): legacy year-less live price points
      localStorage.setItem('priceHistory', JSON.stringify({ btc: [
        { timestamp: '12/30, 08:14 PM', price: 90000 }, { timestamp: '01/02, 09:00 AM', price: 91000 }] }));
      localStorage.setItem('transactions', JSON.stringify([]));
    });
    await page.waitForTimeout(1500);
    await page.evaluate(`(() => { const R = ${RAW};
      R.set('maermin_tax_owner', JSON.stringify({ name: 'Erika Mustermann', taxId: '12345678901' }));
      R.set('maermin_schema_version', '3'); })()`);
    await unlock(page, base);
    await page.waitForTimeout(1500); // adoption persists asynchronously
    const r = await page.evaluate(`(() => { const R = ${RAW}; return {
      schema: localStorage.getItem('maermin_schema_version'), latest: window.MaerminMigrations.LATEST,
      hasRecovery: window.MaerminAuth.getStatus().hasRecovery,
      hist: JSON.parse(localStorage.getItem('priceHistory') || '{}'),
      owner: localStorage.getItem('maermin_tax_owner'),
      rawOwner: R.get('maermin_tax_owner'),
      leak: R.keys().filter((k) => /Mustermann|12345678901/.test(R.get(k) || ''))
    }; })()`);
    ok('migrations from v4 on ran (schema 3 -> latest)', r.latest >= 4 && r.schema === String(r.latest), 'schema=' + r.schema + ' latest=' + r.latest);
    ok('a reload on the recovery-code screen leaves no unseen active code', r.hasRecovery === false, 'hasRecovery=' + r.hasRecovery);
    ok('year-less price points repaired to ISO', (r.hist.btc || []).length === 2 && r.hist.btc.every((p) => /^\d{4}-\d{2}-\d{2}T/.test(p.timestamp)), JSON.stringify(r.hist));
    ok('plaintext v10 store adopted into the vault', /Mustermann/.test(r.owner || '') && r.rawOwner === null && r.leak.length === 0, JSON.stringify({ rawOwner: r.rawOwner, leak: r.leak }));

    // P4-0: an encrypted copy was taken before the migrations; Settings → Trash restores it
    { const inf = await page.evaluate(() => window.MaerminPreMigration.info());
      const raw = await page.evaluate((k) => window.MaerminIDB.get(k), 'maermin_premigration_backup');
      ok('P4-0: a copy from before the migration exists (schema 3 -> latest)', !!inf && inf.fromVersion === 3 && inf.toVersion === r.latest && inf.transactionCount === 0, JSON.stringify(inf));
      ok('P4-0: the copy is ciphertext (no price or owner in it)', typeof raw === 'string' && !/Mustermann|91000|priceHistory/.test(raw)); }
    await page.evaluate(() => localStorage.setItem('transactions', JSON.stringify([{ id: 'after-update', type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 1, currency: 'EUR', date: '2026-01-02', portfolioId: 'default' }])));
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape'); // empty book: the setup wizard opens by itself
    await page.waitForTimeout(300);
    await openView(page, 'trash');
    const card = page.locator('[data-testid="premigration-card"]');
    await card.waitFor({ timeout: 5000 }).catch(() => {});
    ok('P4-0: Settings → Trash shows the copy', (await card.count()) === 1 && /0 transactions/.test(await card.innerText()));
    await card.getByRole('button', { name: 'Restore copy' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restore copy' }).click();
    await page.waitForTimeout(2500); // flush + reload
    await unlock(page, base);
    { const after = await page.evaluate(() => ({ txs: JSON.parse(localStorage.getItem('transactions') || 'null'), schema: localStorage.getItem('maermin_schema_version'),
        hist: JSON.parse(localStorage.getItem('priceHistory') || '{}') }));
      ok('P4-0: restore brings back the data from before the update', Array.isArray(after.txs) && after.txs.length === 0, JSON.stringify(after.txs));
      ok('P4-0: after the restore the migrations ran again', after.schema === String(r.latest) && (after.hist.btc || []).every((p) => /^\d{4}-\d{2}-\d{2}T/.test(p.timestamp)), after.schema); }
    ok('no page errors in the upgrade session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // 5: value history from day one (real Worker code, synthetic Yahoo upstream)
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    workerState.down = false; workerState.upstream.length = 0; workerState.requests.length = 0;
    const N = WEEKDAYS.length, mid = Math.floor(N / 2);
    // Every trade at the close of its day, no fees: the time-weighted return is
    // then exactly the chained day-to-day change of what was held the day before.
    const book = [
      { id: 'h1', type: 'buy', category: 'stocks', symbol: 'VWCE.DE', quantity: 10, price: closeOf('VWCE.DE', 0), currency: 'EUR', date: WEEKDAYS[0], portfolioId: 'default' },
      { id: 'h2', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 5, price: closeOf('AAPL', 0), currency: 'USD', date: WEEKDAYS[0], portfolioId: 'default' },
      { id: 'h3', type: 'buy', category: 'stocks', symbol: 'VWCE.DE', quantity: 30, price: closeOf('VWCE.DE', mid), currency: 'EUR', date: WEEKDAYS[mid], portfolioId: 'default' }
    ];
    let growth = 1;
    const eur = (sym, i) => closeOf(sym, i) * (sym === 'AAPL' ? 0.9 : 1);
    for (let i = 1; i < N; i++) {
      const qV = i - 1 >= mid ? 40 : 10; // held at the end of day i-1
      growth *= (qV * eur('VWCE.DE', i) + 5 * eur('AAPL', i)) / (qV * eur('VWCE.DE', i - 1) + 5 * eur('AAPL', i - 1));
    }
    const expected = (growth - 1) * 100;
    const naive = ((40 * eur('VWCE.DE', N - 1) + 5 * eur('AAPL', N - 1)) / (10 * eur('VWCE.DE', 0) + 5 * eur('AAPL', 0)) - 1) * 100; // counts the deposit as return

    await createVault(page, base);
    await page.evaluate(({ txs, worker }) => {
      localStorage.setItem('transactions', JSON.stringify(txs));
      localStorage.setItem('apiKeys', JSON.stringify({ cs2Worker: worker }));
    }, { txs: book, worker: WORKER_URL });
    await page.waitForTimeout(1500);
    await unlock(page, base);
    await openView(page, 'returns');
    const card = page.locator('[data-testid="twr-card"][data-source="daily"]');
    let shown = '';
    try { await card.waitFor({ timeout: 15000 }); shown = await settledText(card); } catch (e) { shown = await page.locator('[data-testid="twr-card"]').innerText().catch(() => 'no card'); }
    const want = (expected >= 0 ? '+' : '') + expected.toFixed(2) + '%';
    ok('TWR from day one, without a refresh click: ' + want + ' (value change incl. deposit would read ' + naive.toFixed(0) + '%)', shown.includes(want), shown.replace(/\n/g, ' | '));
    ok('TWR card names the start date and the yearly figure', shown.includes('since ' + usDate(WEEKDAYS[0])) && /% p\.a\./.test(shown), shown.replace(/\n/g, ' | '));
    // P4-1: monthly returns heatmap from the same daily chain
    { const hm = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="returns-heatmap"]');
        if (!root) return null;
        const years = Array.from(root.querySelectorAll('td[data-kind="y"]')).map((td) => parseFloat(td.getAttribute('data-r')));
        const months = Array.from(root.querySelectorAll('td[data-kind^="m"]')).map((td) => parseFloat(td.getAttribute('data-r')));
        return { years, months, rows: root.querySelectorAll('tbody tr').length, text: root.innerText.slice(0, 120) };
      });
      const prodY = hm ? hm.years.reduce((g, r) => g * (1 + r), 1) - 1 : NaN;
      const prodM = hm ? hm.months.reduce((g, r) => g * (1 + r), 1) - 1 : NaN;
      const yearsSpanned = new Set(WEEKDAYS.map((d) => d.slice(0, 4))).size;
      ok('P4-1: monthly returns heatmap, one row per year of history', !!hm && hm.rows === yearsSpanned && /Monthly returns/.test(hm.text), JSON.stringify(hm && { rows: hm.rows, yearsSpanned }));
      ok('P4-1: product of the year totals and of the months = the TWR card', Math.abs(prodY * 100 - expected) < 1e-6 && Math.abs(prodM * 100 - expected) < 1e-6, prodY * 100 + ' / ' + prodM * 100 + ' vs ' + expected); }
    // P5-2.4: a click on the newest year opens its detail; the filter narrows to one holding
    { const yCell = page.locator('[data-testid="returns-heatmap"] tbody tr').first().locator('td[data-kind="y"]');
      const cellR = parseFloat(await yCell.getAttribute('data-r').catch(() => 'NaN'));
      const year = await page.locator('[data-testid="returns-heatmap"] tbody tr').first().locator('th').innerText().catch(() => '');
      await yCell.click().catch(() => {});
      const det = page.locator('[data-testid="returns-heatmap-detail"]');
      await det.waitFor({ timeout: 5000 }).catch(() => {});
      const dt = await det.innerText().catch(() => '');
      const detR = parseFloat(await det.locator('[data-stat="ret"]').getAttribute('data-r').catch(() => 'NaN'));
      const n = parseInt(await det.locator('[data-stat="acts"]').getAttribute('data-n').catch(() => '-1'), 10);
      const endEUR = 40 * eur('VWCE.DE', N - 1) + 5 * eur('AAPL', N - 1);
      const endTxt = endEUR.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      ok('P5-2.4: the year\'s detail has the cell\'s return, its activities and the end value ' + endTxt, Math.abs(detR - cellR) < 1e-9 && n === book.filter((t) => t.date.slice(0, 4) === year).length && dt.includes(endTxt) && /Start value/i.test(dt), JSON.stringify({ cellR, detR, n, year, dt: dt.replace(/\n/g, ' | ').slice(0, 300) }));
      await page.locator('[data-testid="rh-filter"]').selectOption('holding:stocks|VWCE.DE').catch(() => {});
      await page.waitForTimeout(800);
      const f = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="returns-heatmap"]');
        const ys = Array.from(root.querySelectorAll('td[data-kind="y"]')).map((td) => parseFloat(td.getAttribute('data-r')));
        return { prod: ys.reduce((g, r) => g * (1 + r), 1) - 1, text: root.innerText };
      });
      const want = closeOf('VWCE.DE', N - 1) / closeOf('VWCE.DE', 0) - 1;
      ok('P5-2.4: filtered to VWCE.DE the years compound to its own price change, with a note', Math.abs(f.prod - want) < 1e-9 && /Only the selected holdings/.test(f.text), f.prod + ' vs ' + want);
      await page.locator('[data-testid="rh-filter"]').selectOption('all').catch(() => {});
      // the position dialog: VWCE.DE's own heatmap; its months compound to its price change
      await openView(page, 'overview');
      await page.locator('tr[role="button"]', { hasText: 'VWCE.DE' }).first().click().catch(() => {});
      const ph = page.locator('[data-testid="pos-heatmap"]');
      await ph.waitFor({ timeout: 10000 }).catch(() => {});
      const pm = await ph.evaluate((el) => Array.from(el.querySelectorAll('td[data-kind^="m"]')).map((td) => parseFloat(td.getAttribute('data-r')))).catch(() => []);
      const prodP = pm.reduce((g, r) => g * (1 + r), 1) - 1;
      await ph.locator('td[data-kind="y"]').first().click().catch(() => {});
      const pd = await page.locator('[data-testid="pos-heatmap-detail"]').innerText().catch(() => '');
      ok('P5-2.4: the position dialog has the holding\'s own monthly returns (= its price change) with drill-down', pm.length > 0 && Math.abs(prodP - want) < 1e-9 && /Activities/i.test(pd), pm.length + ' | ' + prodP + ' vs ' + want + ' | ' + pd.replace(/\n/g, ' | ').slice(0, 200));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await openView(page, 'returns'); }
    // P5-2.5: gross / net - a book without taxes or fees has the same TWR either way
    { await page.locator('[data-testid="returns-gross-net"] [data-basis="gross"]').click().catch(() => {});
      await page.waitForTimeout(500);
      const g = await settledText(page.locator('[data-testid="twr-card"]')).catch(() => '');
      const note = await page.locator('[data-testid="gross-note"]').count();
      const pref = await page.evaluate(() => localStorage.getItem('maermin_gross_net'));
      await page.locator('[data-testid="returns-gross-net"] [data-basis="net"]').click().catch(() => {});
      await page.waitForTimeout(500);
      ok('P5-2.5: gross switch on Returns: a note, the choice saved, the same TWR without taxes or fees', g.includes(want) && note === 1 && pref === 'gross', g.replace(/\n/g, ' | ') + ' | note ' + note + ' | ' + pref); }
    // P5-2.5: Dividends → History backtests today's 40 VWCE.DE + 5 AAPL over the Worker's dividends
    { await openView(page, 'dividends');
      await page.getByRole('button', { name: /^History$/ }).first().click().catch(() => {});
      const Y = new Date().getFullYear() - 1;
      const row = page.locator('[data-testid="div-backtest"] tr[data-y="' + Y + '"]');
      await row.waitFor({ timeout: 15000 }).catch(() => {});
      const income = parseFloat(await row.locator('td[data-k="income"]').getAttribute('data-v').catch(() => 'NaN'));
      const yieldTxt = await row.locator('td[data-k="yield"]').innerText().catch(() => '');
      let wantInc = 0, iEnd = -1;
      WEEKDAYS.forEach((d, i) => { if (d.slice(0, 4) === String(Y)) wantInc += 5 * divOf('AAPL', i) * 0.9; if (d <= (Y - 1) + '-12-31') iEnd = i; });
      const start = iEnd < 0 ? null : 40 * closeOf('VWCE.DE', iEnd) + 5 * closeOf('AAPL', iEnd) * 0.9;
      const wantYield = start ? (wantInc / start * 100).toFixed(2) + '%' : '–';
      ok('P5-2.5: backtest ' + Y + ': income = 5 AAPL x the dividends paid that year (' + wantInc.toFixed(2) + ' EUR), yield on the value at the start ' + wantYield,
        Math.abs(income - wantInc) < 1e-6 && yieldTxt === wantYield, income + ' vs ' + wantInc + ' | ' + yieldTxt + ' vs ' + wantYield);
      ok('P5-2.5: the backtest asked the Worker for ten years of monthly data, symbols only', ['VWCE.DE', 'AAPL'].every((x) => workerState.requests.includes('/?action=yf&symbol=' + x + '&interval=1mo&range=10y')), workerState.requests.filter((u) => /1mo/.test(u)).join(' '));
      const empty = await page.locator('[data-testid="div-matrix"]').innerText().catch(() => '');
      ok('P5-2.5: without recorded dividends the matrix says so', /No dividends recorded yet/.test(empty), empty.slice(0, 120));
      await openView(page, 'returns'); }
    // P5-2.6: per holding - VWCE.DE's IRR = XIRR of its two buys and its value now; capital flow = all buys
    { const hr = page.locator('[data-testid="holding-returns"]');
      await hr.waitFor({ timeout: 10000 }).catch(() => {});
      const row = hr.locator('[data-testid="hr-irr"] tr[data-key="stocks|VWCE.DE"]');
      const got = parseFloat(await row.locator('td[data-k="irr"]').getAttribute('data-v').catch(() => 'NaN'));
      const value = parseFloat(await row.getAttribute('data-value').catch(() => 'NaN'));
      const invested = parseFloat(await row.getAttribute('data-invested').catch(() => 'NaN'));
      const today = await page.evaluate(() => window.MaerminUtils.todayISO());
      const wantIrr = Returns.xirr([{ date: WEEKDAYS[0], amount: -10 * closeOf('VWCE.DE', 0) }, { date: WEEKDAYS[mid], amount: -30 * closeOf('VWCE.DE', mid) }, { date: today, amount: value }]);
      ok('P5-2.6: VWCE.DE IRR = XIRR of its buys and its value now (' + (wantIrr * 100).toFixed(2) + ' %)', Math.abs(got - wantIrr) < 1e-9 && Math.abs(invested - (10 * closeOf('VWCE.DE', 0) + 30 * closeOf('VWCE.DE', mid))) < 1e-6 && value > 0, got + ' vs ' + wantIrr + ' | ' + invested + ' | ' + value);
      const net = await hr.locator('[data-testid="hr-capital"] tr[data-y] td[data-k="net"]').evaluateAll((tds) => tds.reduce((a, td) => a + parseFloat(td.getAttribute('data-v')), 0)).catch(() => NaN);
      const bought = 10 * closeOf('VWCE.DE', 0) + 5 * closeOf('AAPL', 0) * 0.9 + 30 * closeOf('VWCE.DE', mid);
      const trades = await hr.locator('[data-testid="hr-trades"]').innerText().catch(() => '');
      ok('P5-2.6: capital flow: the years add up to every buy (' + bought.toFixed(2) + ' EUR); no sales yet', Math.abs(net - bought) < 1e-6 && /No sales yet/.test(trades), net + ' vs ' + bought + ' | ' + trades.slice(0, 80)); }
    ok('closes came through the Worker route ?action=yf (5-year range for both holdings)', ['VWCE.DE', 'AAPL'].every((x) => workerState.requests.includes('/?action=yf&symbol=' + x + '&interval=1d&range=5y')), workerState.requests.join(' '));
    await page.waitForTimeout(2500); // benchmark fetch
    { const rb = await page.innerText('body'); ok('benchmark comparison is computed from daily returns', /Alpha \(ann\.\)/i.test(rb) && /daily returns since/.test(rb), (rb.match(/Benchmark comparison[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' | ')); }
    // P5-1.6: one plain sentence above the benchmark tiles
    { const v = await page.locator('[data-testid="verdict-benchmark"]').innerText().catch(() => '');
      ok('P5-1.6: benchmark verdict in plain words', /Over this period your portfolio (did [\d.]+ percentage points (better|worse) than|moved roughly in line with)/.test(v), v); }

    await openView(page, 'analytics');
    await page.waitForTimeout(800);
    ok('correlation matrix is there right away, from daily closes', (await page.locator('[data-testid="correlation-source"][data-source="daily"]').count()) === 1 && (await page.locator('[data-testid="correlation-empty"]').count()) === 0);
    await page.getByRole('button', { name: 'Risk Level' }).click();
    await page.waitForTimeout(800);
    { const rb = await page.innerText('body');
      ok('risk metrics and rolling volatility from daily data', /Sharpe Ratio/.test(rb) && (await page.locator('[data-testid="risk-source"][data-source="daily"]').count()) === 1 && /daily time-weighted returns since/.test(rb), (rb.match(/Rolling volatility[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' | ')); }
    // VaR/CVaR are in EUR of the portfolio on the daily-index path (were 0.01 EUR)
    { const rb = await page.innerText('main');
      const m = rb.match(/VaR \(95%, 1-day\)\s*\n\s*([\d,.]+)/);
      const val = m ? parseFloat(m[1].replace(/,/g, '')) : NaN;
      ok('Risk view names real holdings, never the index placeholder', !/__PORTFOLIO__/i.test(rb), (rb.match(/[^\n]*__PORTFOLIO__[^\n]*/i) || [''])[0]);
      ok('VaR (95 %, 1 day) is a euro amount of the portfolio, not per euro', val > 1, m ? m[0].replace(/\n/g, ' | ') : 'no VaR card'); }
    // P5-1.6: a plain sentence under volatility, Sharpe and drawdown, plus the no-advice note
    { const got = {};
      for (const id of ['volatility', 'sharpe', 'drawdown']) got[id] = await page.locator('[data-testid="verdict-' + id + '"]').getAttribute('data-level').catch(() => null);
      const note = await page.locator('[data-testid="verdict-note"]').innerText().catch(() => '');
      ok('P5-1.6: risk cards carry a verdict and the no-advice note', Object.values(got).every((l) => ['good', 'neutral', 'warn', 'bad'].includes(l)) && /not investment advice/.test(note), JSON.stringify(got) + ' ' + note); }
    await openView(page, 'health');
    await page.waitForTimeout(400);
    { const v = await page.locator('[data-testid="verdict-health"]').innerText().catch(() => '');
      ok('P5-1.6: health score explained in one sentence', v.length > 20 && /not investment advice/.test(v), v); }

    const st = await page.evaluate(`(() => { const R = ${RAW}; const h = JSON.parse(localStorage.getItem('maermin_close_history') || '{}');
      return { keys: Object.keys(h.series || {}).sort(), raw: R.get('maermin_close_history'), leak: R.keys().filter((k) => /stocks\\|(VWCE|AAPL)/.test(R.get(k) || '')) }; })()`);
    ok('close history is stored encrypted (not readable in raw storage)', st.keys.join() === 'stocks|AAPL,stocks|VWCE.DE' && st.raw === null && st.leak.length === 0, JSON.stringify(st));

    // P4-2: an open position's dialog shows its daily price and the average-cost line
    await openView(page, 'overview');
    await page.waitForTimeout(500);
    { await page.locator('tr[aria-label="VWCE.DE details"]').first().click().catch(() => {});
      const chart = page.locator('[data-testid="position-chart"]');
      await chart.waitFor({ timeout: 5000 }).catch(() => {});
      const avg = await page.locator('[data-testid="avg-cost-line"]').innerText().catch(() => '');
      const label = await chart.locator('svg').getAttribute('aria-label').catch(() => '');
      ok('P4-2: open position dialog: daily price chart with the average-cost line', (await chart.count()) === 1 && /Average cost/.test(avg) && /Average cost/.test(label || ''), avg + ' | ' + label);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300); }

    // P2-3: the app asked the Worker for its version; the current one shows no notice.
    await openView(page, 'overview');
    await page.waitForTimeout(500);
    ok('version handshake: ?action=version asked, current Worker shows no "outdated" notice', workerState.requests.includes('/?action=version') && (await page.locator('[data-testid="worker-outdated"]').count()) === 0, workerState.requests.filter((r) => /version/.test(r)).join(' '));

    // Next session with the Worker unreachable: the stored closes still carry it.
    await page.waitForTimeout(1500);
    workerState.down = true;
    await unlock(page, base);
    await openView(page, 'returns');
    await page.waitForTimeout(600);
    { const c2 = page.locator('[data-testid="twr-card"]'); const t2 = await settledText(c2);
      ok('next session, Worker unreachable: TWR still from the stored closes', (await c2.getAttribute('data-source')) === 'daily' && t2.includes('since ' + usDate(WEEKDAYS[0])), t2.replace(/\n/g, ' | ')); }
    workerState.down = false;
    // Next session with a Worker from before the version route: one notice
    // that leads to the update steps in API Settings.
    workerState.oldVersion = true;
    await unlock(page, base);
    await openView(page, 'overview');
    { const chip = page.locator('[data-testid="worker-outdated"]');
      let seen = true; try { await chip.waitFor({ timeout: 8000 }); } catch (e) { seen = false; }
      ok('old Worker: "Worker outdated → update" notice on the overview', seen);
      if (seen) {
        await chip.click();
        const note = page.locator('[data-testid="worker-version-note"]');
        let txt = ''; try { await note.waitFor({ timeout: 5000 }); txt = await note.innerText(); } catch (e) { /* missing */ }
        ok('the notice opens API Settings with the expected version and the update steps', txt.includes(workerMod.WORKER_VERSION) && (await page.locator('a[href^="https://deploy.workers.cloudflare.com/"]').count()) > 0, txt);
        await page.keyboard.press('Escape');
      }
    }
    workerState.oldVersion = false;
    ok('no page errors in the value-history session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // 6: a trade in another currency is converted at the rate of its date
  {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    fxCalls.length = 0;
    const tradeDay = FX_TRADE_DAY;
    await createVault(page, base);
    await page.evaluate(({ day, worker }) => {
      // today's cross rate would give 1 CHF = 1.00 EUR (0.9 / 0.9); the rate of the date is 1.06
      localStorage.setItem('transactions', JSON.stringify([
        { id: 'c1', type: 'buy', category: 'stocks', symbol: 'NESN.SW', quantity: 10, price: 100, fees: 20, currency: 'CHF', date: day, portfolioId: 'default' }]));
      localStorage.setItem('apiKeys', JSON.stringify({ cs2Worker: worker }));
    }, { day: tradeDay, worker: FX_WORKER });
    await page.waitForTimeout(1500);
    // open.er-api fixture has no CHF: add it for this session (CHF per USD = EUR per USD)
    await context.route('https://open.er-api.com/**', (route) => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ result: 'success', rates: { EUR: 0.9, USD: 1, CHF: 0.9 } }) }));
    await unlock(page, base);
    await page.waitForTimeout(3000);
    ok('CHF history requested through the Worker (?action=yf, EURCHF=X)', fxCalls.some((u) => /action=yf&symbol=EURCHF=X&interval=1d&range=1y/.test(u)), fxCalls.join(' '));
    const st = await page.evaluate(`(() => { const R = ${RAW}; const F = window.MaerminFxHistory;
      return { rate: F.currencyRateAt('CHF', '${tradeDay}'), status: F.txToEUR(1, 'CHF', '${tradeDay}', 0.9).status, raw: R.get('maermin_fx_currencies'), stored: !!localStorage.getItem('maermin_fx_currencies') }; })()`);
    ok('rate of the trade date is stored (1 CHF = 1.06 EUR), encrypted', Math.abs(st.rate - 1.06) < 1e-6 && st.status === 'exact' && st.stored && st.raw === null, JSON.stringify(st));
    await openView(page, 'returns');
    await page.waitForTimeout(1200);
    { const rb = await page.innerText('body');
      // 10 x 100 CHF + 20 CHF fee = 1,020 CHF x 1.06 = 1,081.20 EUR (today's rate would give 1,020.00)
      ok('CHF buy is costed at the rate of its date: total bought 1,081.20 €', /TOTAL BOUGHT\s*1,081\.20/i.test(rb), (rb.match(/TOTAL BOUGHT[\s\S]{0,40}/i) || [''])[0].replace(/\n/g, ' | ')); }
    // The price refresh for NESN.SW is still probing listings here (the fixture
    // has no quote for it), and a navigation click that coincides with one of
    // its re-renders can be lost: click until the view is active.
    for (let i = 0; i < 3 && !(await isOpen(page, 'transactions')); i++) {
      await openView(page, 'transactions');
      await page.waitForTimeout(700);
    }
    { const tb = await page.innerText('body'); const at = tb.search(/CHF|nesn/i);
      ok('Transactions list shows the CHF trade and the Data check has no entry for it', at !== -1 && (await page.locator('[data-testid="ledger-issues"]').count()) === 0, tb.slice(tb.indexOf('Quick access'), tb.indexOf('Quick access') + 500).replace(/\n/g, ' | ')); }
    // Add-transaction dialog: CHF is selectable and the rate of the chosen date is shown
    await page.keyboard.press('n');
    const sel = page.locator('[data-testid="tx-currency-other"]');
    await sel.waitFor({ timeout: 5000 });
    await sel.selectOption('CHF');
    await page.locator('input[type=date]').first().fill(tradeDay);
    await page.waitForTimeout(300);
    { const hint = await page.locator('[data-testid="tx-currency-hint"]').innerText().catch(() => '');
      ok('transaction dialog offers CHF and shows the rate of the trade date', hint.includes('1 CHF = 1.0600 EUR on ' + usDate(tradeDay)), hint); }
    ok('no page errors in the currency session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // 7: dialogs for keyboard and screen-reader users, and the skip link.
  // Every overlay is a named modal dialog, takes focus when it opens, keeps Tab
  // inside, closes on Escape (the recovery code must not) and hands focus back.
  for (const vp of [{ label: 'desktop 1366x900', opts: { viewport: { width: 1366, height: 900 } } },
                    { label: 'phone 390x844 touch', opts: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } }]) {
    const context = await browser.newContext({ serviceWorkers: 'block', ...vp.opts });
    await wire(context, external);
    await context.addInitScript(DIALOG_PROBE);
    const page = await context.newPage();
    const errors = watch(page);
    const tag = '[' + vp.label + '] ';
    await createVault(page, base);
    // Finish setup like a user: the recovery code only becomes active once
    // "saved" is ticked and Continue pressed (FINDINGS M-7).
    await page.locator('#rc-saved').check();
    await page.locator('#auth-submit').click();
    await page.locator('main.maermin-main').waitFor({ timeout: 30000 });
    await unlock(page, base, 'main.maermin-main'); // first run: no Worker, no transactions -> the wizard opens by itself

    const info = (name) => page.evaluate((n) => window.__dlg.info(n), name);
    const closed = async (name) => { for (let i = 0; i < 10; i++) { if (!(await info(name)).count) return true; await page.waitForTimeout(100); } return false; };
    const press = async (key) => { await page.keyboard.press(key); await page.waitForTimeout(40); };
    // Tab forwards over every stop plus two, then the same backwards.
    const walk = async (name) => {
      const n = (await info(name)).stops;
      await page.evaluate(() => window.__dlg.reset());
      let left = 0;
      for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < n + 2; i++) { await press(key); if (!(await page.evaluate((x) => window.__dlg.seen(x), name))) left++; }
      return { left, stops: n, visited: await page.evaluate(() => window.__dlg.visited()) };
    };
    // d: { name, open, focus: 'field' | 'panel', back: locator | '#main' }
    const check = async (d) => {
      const bad = [];
      const run = async () => {
        await d.open();
        for (let i = 0; i < 50 && !(await info(d.name)).count; i++) await page.waitForTimeout(100);
        await page.waitForTimeout(250);
        const a = await info(d.name);
        if (a.count !== 1) { bad.push('dialogs named "' + d.name + '": ' + a.count + ' (all: ' + a.all + ')'); return; }
        if (a.modal !== 'true') bad.push('aria-modal=' + a.modal);
        if (a.focus !== d.focus) bad.push('focus on open: ' + a.focus + ' (' + a.active + '), expected ' + d.focus);
        const w = await walk(d.name);
        if (w.left) bad.push('Tab left the dialog ' + w.left + 'x');
        if (w.visited !== w.stops) bad.push('Tab reached ' + w.visited + ' of ' + w.stops + ' controls');
        await press('Escape');
        if (!(await closed(d.name))) { bad.push('Escape did not close it'); return; }
        await page.waitForTimeout(150);
        const back = d.back === '#main' ? await page.evaluate(() => document.activeElement && document.activeElement.id === 'main')
          : await d.back.evaluate((el) => el === document.activeElement).catch(() => false);
        if (!back) bad.push('focus after close: ' + (await page.evaluate(() => window.__dlg.desc(document.activeElement))));
      };
      try { await run(); } catch (e) { bad.push(String(e.message).split('\n')[0]); }
      ok(tag + d.name + ': named modal dialog, focus moves in, Tab stays inside, Escape closes, focus goes back', bad.length === 0, bad.join('; '));
      if ((await info(d.name)).count) { await page.mouse.click(3, 3); await page.waitForTimeout(300); } // leave no dialog behind for the next check
    };
    const wide = async (fn) => { // a view that the phone layout cannot reach without the sidebar
      const size = page.viewportSize();
      if (size.width < 900) { await page.setViewportSize({ width: 1366, height: 900 }); await page.waitForTimeout(300); }
      await fn();
      if (size.width < 900) { await page.setViewportSize(size); await page.waitForTimeout(300); }
    };
    const avatar = page.locator('.mx-settings-btn');
    const fromMenu = (item) => async () => { await avatar.click(); await page.locator('.mx-menu-item', { hasText: item }).click(); };

    await check({ name: 'Set up your data sources', focus: 'panel', back: '#main', open: async () => {} });

    await page.evaluate((txs) => { localStorage.setItem('transactions', JSON.stringify(txs)); }, TXS);
    await page.waitForTimeout(1500); // encrypted persist
    await unlock(page, base, 'main.maermin-main');
    await page.waitForTimeout(1500);

    // P2-1: the vault was created empty, so it stays in Simple after the import.
    ok(tag + 'a new vault starts in Simple and keeps it', (await page.evaluate(RAW + '.get("maermin_ui_mode")')) === 'simple');

    // Skip link: the first Tab stop, visible when focused, and it lands in <main>.
    {
      await press('Tab');
      const first = await page.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(); return { skip: a.classList.contains('mx-skip-link'), text: a.innerText, shown: r.top >= 0 && r.left >= 0 && r.height > 0 }; });
      await press('Enter');
      const onMain = await page.evaluate(() => document.activeElement && document.activeElement.id === 'main' && document.activeElement.tagName === 'MAIN');
      await press('Tab');
      const inside = await page.evaluate(() => { const m = document.getElementById('main'); return !!m && m !== document.activeElement && m.contains(document.activeElement); });
      ok(tag + 'skip link is the first Tab stop, shows when focused and moves focus into <main> (content reached with 3 keys)', first.skip && first.shown && first.text === 'Skip to content' && onMain && inside, JSON.stringify({ first, onMain, inside }));
    }

    const addTx = page.getByRole('button', { name: /Add Transaction/ }).first();
    await wide(() => openView(page, 'transactions'));
    await check({ name: 'Add Transaction', focus: 'field', back: addTx, open: () => addTx.click() });
    await wide(() => openView(page, 'overview'));
    await page.waitForTimeout(400);
    const importBtn = page.getByRole('button', { name: '↑ Import' }).first();
    await check({ name: 'Import Data', focus: 'field', back: importBtn, open: () => importBtn.click() });
    const row = page.locator('main [role="button"]', { hasText: 'VWCE' }).first();
    await check({ name: 'VWCE.DE', focus: 'panel', back: row, open: async () => { await row.scrollIntoViewIfNeeded(); await row.click(); } });
    await check({ name: 'API Settings', focus: 'field', back: avatar, open: fromMenu('API Settings') });
    await check({ name: 'Change Password', focus: 'field', back: avatar, open: fromMenu('Change Password') });
    await check({ name: 'Security log', focus: 'panel', back: avatar, open: fromMenu('Security log') });
    await check({ name: 'Security & sync', focus: 'panel', back: avatar, open: fromMenu('Security & sync') });
    const search = page.locator('.mx-search');
    await check({ name: 'Search commands...', focus: 'field', back: search, open: () => search.click() });
    await check({ name: 'Keyboard Shortcuts', focus: 'panel', back: avatar, open: async () => { await avatar.focus(); await page.keyboard.press('?'); } });
    await wide(() => openView(page, 'savings-plans'));
    await page.waitForTimeout(300);
    const addPlan = page.getByRole('button', { name: '+ Add Plan' }).first();
    await check({ name: 'New Savings Plan', focus: 'field', back: addPlan, open: () => addPlan.click() });

    // Recovery code, opened over Security & sync: Escape and a click beside it
    // must not close it (the code is shown once); Tab stays inside it; closing
    // it puts focus back into the dialog underneath; one Escape then closes that.
    {
      const bad = [];
      try {
        await fromMenu('Security & sync')();
        await page.getByRole('button', { name: 'Rotate' }).click();
        // Replacing an active code asks first (FINDINGS M-6).
        await page.getByRole('button', { name: 'Create new code' }).click();
        await page.getByText('Your recovery code').waitFor({ timeout: 30000 });
        await page.waitForTimeout(300);
        const a = await info('Your recovery code');
        if (a.count !== 1 || a.modal !== 'true') bad.push('not a named modal dialog (' + a.all + ')');
        if (a.focus !== 'panel') bad.push('focus on open: ' + a.focus + ' (' + a.active + ')');
        const w = await walk('Your recovery code');
        if (w.left) bad.push('Tab left the dialog ' + w.left + 'x');
        if (w.visited !== w.stops) bad.push('Tab reached ' + w.visited + ' of ' + w.stops + ' controls');
        await press('Escape');
        await page.waitForTimeout(300);
        if (!(await info('Your recovery code')).count) bad.push('Escape closed the recovery code');
        if (!(await info('Security & sync')).count) bad.push('Escape closed the dialog underneath');
        await page.mouse.click(3, 3);
        await page.waitForTimeout(300);
        if (!(await info('Your recovery code')).count) bad.push('a click beside it closed the recovery code');
        // Done stays disabled until the user confirms saving the code (M-6).
        if (await page.getByRole('button', { name: /I've saved it/ }).isEnabled()) bad.push('Done is enabled before the saved checkbox is ticked');
        await page.getByRole('checkbox', { name: /saved this recovery code/ }).check();
        await page.getByRole('button', { name: /I've saved it/ }).click();
        if (!(await closed('Your recovery code'))) bad.push('"Done" did not close it');
        await page.waitForTimeout(150);
        const under = await info('Security & sync');
        if (under.count !== 1 || under.focus === 'outside') bad.push('focus after close is not in Security & sync: ' + under.active);
        await press('Escape');
        if (!(await closed('Security & sync'))) bad.push('Escape did not close Security & sync afterwards');
      } catch (e) { bad.push(String(e.message).split('\n')[0]); }
      ok(tag + 'Your recovery code: modal over Security & sync, not closed by Escape or a click beside it, focus returns to the dialog underneath', bad.length === 0, bad.join('; '));
    }
    // P2-1: the phone dock has one button per area; an area's views are chips.
    if (page.viewportSize().width < 900) {
      const bad = [];
      try {
        const areas = await page.locator('.mx-bottom-nav [data-area]').evaluateAll((els) => els.map((e) => e.dataset.area));
        if (areas.join() !== 'portfolio,transactions,dividends,taxes,analysis,settings') bad.push('dock: ' + areas.join());
        await page.locator('.mx-bottom-nav [data-area="analysis"]').click();
        await page.waitForTimeout(300);
        if (!(await page.locator('.mx-bottom-nav [data-area="analysis"][aria-current="page"]').count())) bad.push('analysis not current');
        const chips = await page.locator('main .mx-area-entries [data-area-entry]').evaluateAll((els) => els.filter((e) => e.getClientRects().length).map((e) => e.dataset.areaEntry));
        if (chips.join() !== 'grp-returns,grp-health') bad.push('chips: ' + chips.join());
        await page.locator('main .mx-area-entries [data-area-entry="grp-health"]').click();
        await page.waitForTimeout(300);
        if (!(await page.locator('main .mx-area-entries [data-area-entry="grp-health"][aria-current="page"]').count())) bad.push('health chip not current');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) bad.push('page scrolls sideways by ' + overflow + 'px');
      } catch (e) { bad.push(String(e.message).split('\n')[0]); }
      ok(tag + 'dock shows the six areas and the area views as chips', bad.length === 0, bad.join('; '));
    }
    ok(tag + 'no page errors in the dialog session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // 8: German browser (P2-2): the app follows navigator.language, every view
  // is German and numbers use German separators. The deny-list holds common
  // English UI words that never occur in German text; accepted loan words
  // (Performance, Watchlist, Tags, Journal, Score, ETF …) are not in it.
  {
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'de-DE', viewport: { width: 1400, height: 900 } });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    const authText = await page.locator('#maermin-auth').innerText();
    await page.evaluate((txs) => {
      localStorage.setItem('transactions', JSON.stringify(txs));
      localStorage.setItem('maermin_ui_mode', 'advanced');
    }, TXS);
    await page.waitForTimeout(1500);
    await unlock(page, base);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const EN = /\b(the|and|your|with|from|this|Add|Total|Value|Settings|Loading|Save|Delete|Cancel|Close|Edit|Date|Price|Holdings|Invested|Income|Returns?|Search|Show|Hide|Back|Next|Error|Warning|Unknown|Quantity|Fees?|Amount|Shares|Yearly|Monthly|Annual|Gain|Loss|Profit|Buy|Sell|Dividends|Taxes|Overview|Transactions)\b/;
    const hits = [];
    ok('German browser: <html lang="de">', (await page.evaluate(() => document.documentElement.lang)) === 'de');
    { const bad = authText.split('\n').filter((s) => EN.test(s)); ok('German browser: recovery-code screen is German', bad.length === 0, bad.join(' | ')); }
    for (const id of VIEWS) {
      try { await openView(page, id); } catch (e) { hits.push(id + ': ' + e.message); continue; }
      await page.waitForTimeout(500);
      const lines = (await page.locator('main').innerText()).split('\n').map((s) => s.trim()).filter((s) => EN.test(s));
      for (const l of new Set(lines)) hits.push(id + ': ' + l.slice(0, 100));
    }
    const side = (await page.locator('nav.maermin-sidebar').innerText()).split('\n').filter((s) => EN.test(s));
    for (const l of side) hits.push('sidebar: ' + l);
    ok('German browser: no English UI words in ' + VIEWS.length + ' views and the sidebar', hits.length === 0, hits.slice(0, 12).join(' | '));
    await openView(page, 'overview');
    await page.waitForTimeout(800);
    { const body = await settledText(page.locator('main'));
      // "$→€ 0,900" is the FX rate, not an amount; a tab or line break is a cell edge.
      const enAmounts = body.match(/(?<!→)€ ?\d[\d.,]*|\d[\d,]*\.\d{2}\s€/g) || [];
      ok('German browser: amounts use German separators (1.234,56 €), no en-US amounts', /\d,\d{2}\s€/.test(body) && enAmounts.length === 0, enAmounts.slice(0, 6).join(' | ') || body.slice(0, 300)); }
    ok('no page errors in the German session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // 9: Phase 3 usability fixes (docs/USABILITY.md): dialog close + visible
  // save, one selected tab, view state that survives an app re-render, number
  // fields that can be typed, AA contrast on filled buttons, restore from file.
  {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    await page.evaluate((txs) => { localStorage.setItem('transactions', JSON.stringify(txs)); localStorage.setItem('maermin_ui_mode', 'advanced'); }, TXS);
    await page.waitForTimeout(1500);
    await unlock(page, base);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    // M-1: filled primary button reaches 4.5:1 (dark theme)
    { const ratio = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('main button')).find((x) => /^\+\s*Add$/.test(x.innerText.trim()));
        if (!b) return 0;
        const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = (a) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2]); };
        const cs = getComputedStyle(b);
        // a gradient fill: take its darkest-to-lightest stop as the worst case
        const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)|#[0-9a-f]{6}/gi) || [cs.backgroundColor]).map((c) => c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : rgb(c));
        const fg = lum(rgb(cs.color));
        return Math.min(...stops.map((s) => { const bg = lum(s); return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05); }));
      });
      ok('filled "+ Add" button: text contrast >= 4.5:1 on every stop of its fill', ratio >= 4.5, ratio.toFixed(2)); }

    // M-3: Add transaction has a close button and its save button is in view
    await page.keyboard.press('n');
    const dlg = page.locator('[aria-labelledby="dlg-transaction"]');
    await dlg.waitFor({ timeout: 5000 });
    { const save = dlg.getByRole('button', { name: /^Add Buy$/ });
      const box = await save.boundingBox();
      ok('Add transaction: save button visible without scrolling (900 px window)', !!box && box.y + box.height <= 900, JSON.stringify(box));
      await dlg.getByRole('button', { name: 'Close', exact: true }).click();
      await page.waitForTimeout(300);
      ok('Add transaction: the close button closes it', (await dlg.count()) === 0); }

    // H-1 + M-5: Data view keeps its state through an app re-render; one tab selected
    await openView(page, 'data');
    await page.getByRole('button', { name: /Manual Import/ }).click();
    await page.getByRole('textbox', { name: 'Manual Import' }).fill('[{"type":"buy"}]');
    await page.evaluate(() => window.MaerminMarket.set('workerStatus', { ok: false, reachable: false, error: 'network', at: Date.now() }));
    await page.waitForTimeout(400);
    { const kept = await page.getByRole('textbox', { name: 'Manual Import' }).inputValue().catch(() => '');
      ok('Data view: pasted text and tab survive an app re-render', kept === '[{"type":"buy"}]', kept); }
    { const st = await page.evaluate(() => Array.from(document.querySelectorAll('main button[aria-pressed]')).filter((b) => /Export & Backup|Manual Import|Broker Import|Steam inventory/.test(b.innerText))
        .map((b) => ({ t: b.innerText.trim(), p: b.getAttribute('aria-pressed'), g: b.classList.contains('mx-primary') })));
      ok('Data tabs: exactly one pressed, and only it carries the accent styling', st.filter((x) => x.p === 'true').length === 1 && st.every((x) => !x.g || x.p === 'true'), JSON.stringify(st)); }

    // M-4: restore from file runs the backup confirmation
    { const chooser = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
      await page.getByRole('button', { name: /Export & Backup/ }).click();
      await page.getByRole('button', { name: /Restore from file/ }).click();
      const fc = await chooser;
      ok('Export & Backup offers "Restore from file…" (opens a file picker)', !!fc); }

    // H-2: the Basiszins field can be typed and commits on blur
    await openView(page, 'tax');
    await page.getByRole('button', { name: 'Tax Report', exact: true }).click();
    { const year = new Date().getFullYear();
      const f = page.getByRole('textbox', { name: 'Basiszins ' + year + ' in percent' });
      let saved = null;
      try {
        await f.fill('2,5'); await f.press('Tab');
        await page.waitForTimeout(300);
        saved = await page.evaluate((y) => (JSON.parse(localStorage.getItem('maermin_basiszins_overrides') || '{}'))[y], year);
      } catch (e) { saved = 'ERR ' + e.message.split('\n')[0]; }
      ok('Basiszins: typing "2,5" and leaving the field saves 2.5 %', Math.abs(saved - 0.025) < 1e-9, String(saved)); }
    ok('no page errors in the usability session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  const unexpected = [...new Set(external)].filter((u) => !/open\.er-api\.com|api\.exchangerate-api\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u));
  ok('no unexpected external requests', unexpected.length === 0, unexpected.join(', '));
  server.close();
}

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
try {
  await runBuild(browser, 'dev entry', root);
  if (existsSync(join(root, 'dist', 'index.html'))) await runBuild(browser, 'production build', join(root, 'dist'));
  else { failed++; console.error('  ✗ dist/ missing — run npm run build:web first'); }
} finally {
  await browser.close();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
