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
import { chromium } from 'playwright-core';

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
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js': 'jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js': 'jspdf.plugin.autotable.min.js'
};
const fetched = []; // market-data calls answered from fixtures

// ---- the real Worker, with a synthetic Yahoo upstream --------------------------
// Requests to WORKER_URL are answered by cf-worker/worker.js itself. Its own
// outbound fetch (Yahoo) is replaced by deterministic series, so the numbers on
// screen can be checked against values computed here.
const WORKER_URL = 'https://maermin-e2e.workers.dev';
const workerMod = await import('../../cf-worker/worker.js');
const workerState = { down: false, upstream: [], requests: [] };
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
      indicators: { quote: [{ close: WEEKDAYS.map((_, i) => closeOf(sym, i)) }] } }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}
async function answerFromWorker(route) {
  if (workerState.down) return route.abort();
  const rq = route.request();
  workerState.requests.push(rq.url().slice(WORKER_URL.length));
  const res = await workerMod.default.fetch(new Request(rq.url(), { method: rq.method(), headers: { Origin: new URL(rq.headers().origin || rq.headers().referer || 'http://127.0.0.1').origin }, body: rq.method() === 'GET' ? undefined : rq.postData() }), {}, { waitUntil() {} });
  const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
  headers['access-control-allow-origin'] = '*';
  return route.fulfill({ status: res.status, headers, body: await res.text() });
}
async function wire(context, external) {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1')) return route.continue();
    if (url.startsWith(FX_WORKER)) return answerFromFxWorker(route);
    if (url.startsWith(WORKER_URL)) return answerFromWorker(route);
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
    // Answers under the requested CoinGecko id, like the real API (the app
    // maps the stored ticker "eth" to the id "ethereum").
    if (url.startsWith('https://api.coingecko.com/api/v3/simple/price')) {
      fetched.push('crypto');
      const ids = (new URL(url).searchParams.get('ids') || '').split(',');      return json(ids.includes('ethereum') ? { ethereum: { eur: 3000, usd: 3300 } } : {});
    }
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
// Click a sidebar entry (data-view); expand the hubs until it is visible.
async function openView(page, id) {
  const entry = page.locator('nav.maermin-sidebar [data-view="' + id + '"]');
  if (!(await entry.count())) {
    const hubs = page.locator('nav.maermin-sidebar [data-hub][aria-expanded="false"]');
    for (let i = 0; i < await hubs.count() && !(await entry.count()); i++) await hubs.nth(i).click();
  }
  if (!(await entry.count())) throw new Error('no sidebar entry for ' + id);
  await entry.first().click();
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
  'watchlist', 'rules', 'attribution', 'news', 'data'];

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
    await page.evaluate((txs) => {
      localStorage.setItem('transactions', JSON.stringify(txs));
      localStorage.setItem('taxJurisdiction', 'de');
      localStorage.setItem('maermin_tax_settings', JSON.stringify({ abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true }));
      // recorded daily values of the active portfolio (no trades in between): 3,000 -> 3,300
      localStorage.setItem('maermin_snapshots', JSON.stringify({ version: 1, points: [
        { d: '2025-07-01', v: 3000, pid: 'default' }, { d: '2025-07-02', v: 3150, pid: 'default' }, { d: '2025-07-03', v: 3300, pid: 'default' }] }));
    }, TXS);
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

    const crashedIn = [];
    for (const id of VIEWS) {
      const before = errors.length;
      try { await openView(page, id); } catch (e) { crashedIn.push(id + ': ' + e.message); continue; }
      await page.waitForTimeout(150);
      if (!(await page.locator('nav.maermin-sidebar [data-view="' + id + '"][aria-current="page"]').count())) crashedIn.push(id + ': not active after click');
      if (errors.length > before) crashedIn.push(id + ': ' + errors.slice(before).join(' | '));
    }
    ok('every sidebar view renders without an error (' + VIEWS.length + ' views)', crashedIn.length === 0, crashedIn.join(' || '));

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
    ok('no page errors in the session', errors.length === 0, errors.join(' | '));
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
      hist: JSON.parse(localStorage.getItem('priceHistory') || '{}'),
      owner: localStorage.getItem('maermin_tax_owner'),
      rawOwner: R.get('maermin_tax_owner'),
      leak: R.keys().filter((k) => /Mustermann|12345678901/.test(R.get(k) || ''))
    }; })()`);
    ok('migrations from v4 on ran (schema 3 -> latest)', r.latest >= 4 && r.schema === String(r.latest), 'schema=' + r.schema + ' latest=' + r.latest);
    ok('year-less price points repaired to ISO', (r.hist.btc || []).length === 2 && r.hist.btc.every((p) => /^\d{4}-\d{2}-\d{2}T/.test(p.timestamp)), JSON.stringify(r.hist));
    ok('plaintext v10 store adopted into the vault', /Mustermann/.test(r.owner || '') && r.rawOwner === null && r.leak.length === 0, JSON.stringify({ rawOwner: r.rawOwner, leak: r.leak }));
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
    ok('TWR card names the start date and the yearly figure', shown.includes('since ' + WEEKDAYS[0]) && /% p\.a\./.test(shown), shown.replace(/\n/g, ' | '));
    ok('closes came through the Worker route ?action=yf (5-year range for both holdings)', ['VWCE.DE', 'AAPL'].every((x) => workerState.requests.includes('/?action=yf&symbol=' + x + '&interval=1d&range=5y')), workerState.requests.join(' '));
    await page.waitForTimeout(2500); // benchmark fetch
    { const rb = await page.innerText('body'); ok('benchmark comparison is computed from daily returns', /Alpha \(ann\.\)/i.test(rb) && /daily returns since/.test(rb), (rb.match(/Benchmark comparison[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' | ')); }

    await openView(page, 'analytics');
    await page.waitForTimeout(800);
    ok('correlation matrix is there right away, from daily closes', (await page.locator('[data-testid="correlation-source"][data-source="daily"]').count()) === 1 && (await page.locator('[data-testid="correlation-empty"]').count()) === 0);
    await page.getByRole('button', { name: 'Risk Level' }).click();
    await page.waitForTimeout(800);
    { const rb = await page.innerText('body');
      ok('risk metrics and rolling volatility from daily data', /Sharpe Ratio/.test(rb) && (await page.locator('[data-testid="risk-source"][data-source="daily"]').count()) === 1 && /daily time-weighted returns since/.test(rb), (rb.match(/Rolling volatility[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' | ')); }

    const st = await page.evaluate(`(() => { const R = ${RAW}; const h = JSON.parse(localStorage.getItem('maermin_close_history') || '{}');
      return { keys: Object.keys(h.series || {}).sort(), raw: R.get('maermin_close_history'), leak: R.keys().filter((k) => /stocks\\|(VWCE|AAPL)/.test(R.get(k) || '')) }; })()`);
    ok('close history is stored encrypted (not readable in raw storage)', st.keys.join() === 'stocks|AAPL,stocks|VWCE.DE' && st.raw === null && st.leak.length === 0, JSON.stringify(st));

    // Next session with the Worker unreachable: the stored closes still carry it.
    await page.waitForTimeout(1500);
    workerState.down = true;
    await unlock(page, base);
    await openView(page, 'returns');
    await page.waitForTimeout(600);
    { const c2 = page.locator('[data-testid="twr-card"]'); const t2 = await settledText(c2);
      ok('next session, Worker unreachable: TWR still from the stored closes', (await c2.getAttribute('data-source')) === 'daily' && t2.includes('since ' + WEEKDAYS[0]), t2.replace(/\n/g, ' | ')); }
    workerState.down = false;
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
      ok('CHF buy is costed at the rate of its date: invested 1,081.20 €', /INVESTED\s*1,081\.20/i.test(rb), (rb.match(/INVESTED[\s\S]{0,40}/i) || [''])[0].replace(/\n/g, ' | ')); }
    // The price refresh for NESN.SW is still probing listings here (the fixture
    // has no quote for it), and a navigation click that coincides with one of
    // its re-renders can be lost: click until the view is active.
    for (let i = 0; i < 3 && !(await page.locator('nav.maermin-sidebar [data-view="transactions"][aria-current="page"]').count()); i++) {
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
      ok('transaction dialog offers CHF and shows the rate of the trade date', hint.includes('1 CHF = 1.0600 EUR on ' + tradeDay), hint); }
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
    const avatar = page.locator('.mx-avatar');
    const fromMenu = (item) => async () => { await avatar.click(); await page.locator('.mx-menu-item', { hasText: item }).click(); };

    await check({ name: 'Set up your data sources', focus: 'panel', back: '#main', open: async () => {} });

    await page.evaluate((txs) => { localStorage.setItem('transactions', JSON.stringify(txs)); }, TXS);
    await page.waitForTimeout(1500); // encrypted persist
    await unlock(page, base, 'main.maermin-main');
    await page.waitForTimeout(1500);

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
    ok(tag + 'no page errors in the dialog session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  const unexpected = [...new Set(external)].filter((u) => !/api\.coingecko\.com|open\.er-api\.com|api\.exchangerate-api\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u));
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
