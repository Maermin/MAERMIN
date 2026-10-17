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
// P5-3.4: a FinTS product id for the real Worker, and the synthetic bank behind
// fints.dkb.de (test/fints-bank-sim.js) that the Worker relays to
const workerEnv = { FINTS_PRODUCT_ID: 'E2E-PRODUCT' };
const requireE2E = createRequire(import.meta.url);
const FINTS = requireE2E('../../fints.js');
const fintsBank = requireE2E('../fints-bank-sim.js').createBank();
// P5-3.5: synthetic GoCardless and SnapTrade behind the Worker's broker relay
const aggSim = requireE2E('../aggregator-sim.js');
// P5-3.6: synthetic block explorers behind the Worker's wallet route
const walletSim = requireE2E('../wallet-sim.js');
// P5-3.8: synthetic Bitvavo / Bybit / KuCoin / Bitget behind the broker relay
const exchangeSim = requireE2E('../exchange-sim.js');
// ip: an own client IP (TEST-NET-3) for a check that must not share the
// Worker's per-IP rate limit (120 a minute) with the calls before it.
const workerState = { down: false, oldVersion: false, upstream: [], requests: [], ip: null };
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
// P5-2.9: consumer prices, 2015-01 = 100, +0.2 % a month (the Worker's Eurostat upstream)
const HICP_MONTHS = (() => { const out = [], end = new Date(); for (let y = 2015, m = 1, i = 0; y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth()); i++) { out.push([y + '-' + String(m).padStart(2, '0'), Number((100 * Math.pow(1.002, i)).toFixed(2))]); m++; if (m > 12) { m = 1; y++; } } return out; })();
const hicpAt = (iso) => { const ym = iso.slice(0, 7); let v = null; HICP_MONTHS.forEach((x) => { if (x[0] <= ym) v = x[1]; }); return v; };
const divOf = (sym, i) => (sym === 'AAPL' && i % 63 === 20 ? Number((0.24 + 0.01 * Math.floor(i / 252)).toFixed(4)) : 0);
{
  const cacheMap = new Map();
  globalThis.caches = { default: {
    match: async (req) => { const b = cacheMap.get(req.url); return b === undefined ? undefined : new Response(b); },
    put: async (req, resp) => { cacheMap.set(req.url, await resp.text()); } } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = String(input && input.url ? input.url : input);
    if (/ec\.europa\.eu\/eurostat\/api\/dissemination\/statistics\/1\.0\/data\/prc_hicp_minr/.test(u)) {
      workerState.upstream.push('eurostat');
      const index = {}, value = {};
      HICP_MONTHS.forEach((x, i) => { index[x[0]] = i; value[i] = x[1]; });
      return new Response(JSON.stringify({ version: '2.0', class: 'dataset', updated: '2026-10-02T11:00:00+0200', value, dimension: { time: { category: { index } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/^https:\/\/(bankaccountdata\.gocardless\.com|api\.snaptrade\.com)\//.test(u)) return aggSim.upstream(u, init || {});
    if (/^https:\/\/api\.(bitvavo|bybit|kucoin|bitget)\.com\//.test(u)) return exchangeSim.upstream(u, init || {});
    if (/^https:\/\/(mempool\.space|[a-z]+\.blockscout\.com|api\.mainnet-beta\.solana\.com)\//.test(u)) return walletSim.upstream(u, init || {});
    if (/^https:\/\/fints\.dkb\.de\//.test(u)) return new Response(FINTS.toB64(fintsBank.handle(FINTS.fromB64(init.body))), { status: 200, headers: { 'Content-Type': 'text/plain' } });
    // P5-5.4: the research route's quoteSummary (only that module set: other
    // quoteSummary routes keep their behaviour in this harness)
    if (/query1\.finance\.yahoo\.com\/v10\/finance\/quoteSummary\//.test(u) && /recommendationTrend/.test(decodeURIComponent(u))) {
      const qs = decodeURIComponent(u.match(/quoteSummary\/([^?]+)/)[1]);
      workerState.upstream.push('research:' + qs);
      return new Response(JSON.stringify({ quoteSummary: { result: [{ price: { shortName: qs + ' Sample Corp', currency: 'USD', regularMarketPrice: { raw: 100 } },
        summaryDetail: { trailingPE: { raw: 20 }, marketCap: { raw: 5e11 } },
        financialData: { numberOfAnalystOpinions: { raw: 10 }, targetMeanPrice: { raw: 120 }, targetLowPrice: { raw: 90 }, targetHighPrice: { raw: 150 }, recommendationKey: 'buy' },
        recommendationTrend: { trend: [{ period: '0m', strongBuy: 3, buy: 4, hold: 2, sell: 1, strongSell: 0 }] },
        earnings: { earningsChart: { quarterly: [{ date: '2Q2026', actual: { raw: 1.1 }, estimate: { raw: 1.0 } }] } },
        assetProfile: { sector: 'Technology', country: 'United States', longBusinessSummary: 'Synthetic company for the end-to-end test.' } }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    // P5-5.5: the earnings route's calendarEvents for AAPL (dates relative to today)
    if (/query1\.finance\.yahoo\.com\/v10\/finance\/quoteSummary\/AAPL\?/.test(u) && /modules=calendarEvents/.test(decodeURIComponent(u))) {
      workerState.upstream.push('calendar:AAPL');
      const at = (n) => ({ raw: Math.floor(Date.now() / 86400000 + n) * 86400 });
      return new Response(JSON.stringify({ quoteSummary: { result: [{ price: { shortName: 'Apple', currency: 'USD' },
        calendarEvents: { earnings: { earningsDate: [at(10)], earningsAverage: { raw: 1.75 } }, exDividendDate: at(20), dividendDate: at(24) } }] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
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
  const res = await workerMod.default.fetch(new Request(rq.url(), { method: rq.method(), headers: Object.assign({ Origin: new URL(rq.headers().origin || rq.headers().referer || 'http://127.0.0.1').origin }, workerState.ip ? { 'CF-Connecting-IP': workerState.ip } : {}), body: rq.method() === 'GET' ? undefined : rq.postData() }), workerEnv, { waitUntil() {} });
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
  // Own client IP (TEST-NET-3): the Worker module is shared with the other
  // scenarios, and its per-IP rate limit (120 a minute) would otherwise count
  // their requests too and answer this one with 429.
  const res = await fxWorker.default.fetch(new Request(rq.url(), { method: rq.method(), headers: { 'CF-Connecting-IP': '203.0.113.6' }, body: rq.method() === 'GET' ? undefined : rq.postData() }), {}, { waitUntil() {} });
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
async function unlock(page, base, ready = 'nav.ui-rail') { // phone layout: pass a selector that is visible there
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
// R2.1: the rail opens an area; its views are page tabs in the header
// (data-view, or data-views for a merged page whose own tabs are data-tab in
// main). On phones the rail is hidden; a click from script still works.
const pageTab = (id) => 'header.ui-pagehead [data-view="' + id + '"], header.ui-pagehead [data-views~="' + id + '"]';
async function openView(page, id) {
  let tab = page.locator(pageTab(id));
  if (!(await tab.count())) {
    const area = await page.evaluate((v) => window.MaerminNav.areaOf(v), id);
    if (!area) throw new Error('no area for ' + id);
    await page.evaluate((a) => document.querySelector('nav.ui-rail [data-area="' + a + '"]').click(), area);
    await page.waitForTimeout(150);
    tab = page.locator(pageTab(id));
  }
  if (await tab.count()) {
    if ((await tab.first().getAttribute('aria-selected')) !== 'true' || (await tab.first().getAttribute('data-views'))) await tab.first().click();
  } else if (!(await page.evaluate((v) => window.MaerminNav.firstView(window.MaerminNav.areaOf(v), 'advanced') === v || window.MaerminNav.visibleEntries(window.MaerminNav.areaOf(v), 'advanced', v).length === 1, id))) {
    throw new Error('no page tab for ' + id);
  }
  const sub = page.locator('main .mx-area-tabs [data-tab="' + id + '"]');
  if (await sub.count()) await sub.first().click();
}
// The page tab of the open view (or its merged page) is selected and, on a
// merged page, its own tab too. An area with one view has no page tabs.
async function isOpen(page, id) {
  const tab = page.locator(pageTab(id));
  if (!(await tab.count())) return (await page.evaluate((v) => window.MaerminNav.areaOf(v), id)) === (await page.evaluate(() => { const a = document.querySelector('nav.ui-rail [aria-current="true"]'); return a && a.dataset.area; }));
  if ((await tab.first().getAttribute('aria-selected')) !== 'true') return false;
  const tabs = page.locator('main .mx-area-tabs [data-tab]');
  return !(await tabs.count()) || (await page.locator('main .mx-area-tabs [data-tab="' + id + '"][aria-checked="true"]').count()) > 0;
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
      const sections = await page.locator('nav.ui-rail [data-area]').allInnerTexts();
      ok('rail shows the six areas (B-1 labels)', sections.map((x) => x.trim()).join() === 'Home,Activity,Income,Tax,Insight,Settings', sections.join(','));
      await openView(page, 'customize');
      ok('a vault with transactions starts in Advanced', (await page.evaluate(RAW + '.get("maermin_ui_mode")')) === 'advanced' && (await page.locator(pageTab('tags')).count()) === 1);
      // P5-1.1 (F4), now R2.1: every area, Tax included, is in view at 1440 × 900.
      {
        const size = page.viewportSize();
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(300);
        const pos = await page.evaluate(() => [...document.querySelectorAll('nav.ui-rail [data-area]')].map((b) => { const r = b.getBoundingClientRect(); return b.dataset.area + ':' + (r.top >= 0 && r.bottom <= window.innerHeight); }));
        ok('F4: all six areas, Tax included, are in view at 1440 × 900', pos.length === 6 && pos.every((p) => p.endsWith(':true')), pos.join());
        await page.setViewportSize(size);
        await page.waitForTimeout(300);
      }
      await page.locator('.ui-settings-btn').click();
      await page.locator('#mx-settings-panel [data-ui-mode="simple"]').click();
      await page.locator('.ui-settings-btn').click();
      await page.waitForTimeout(300);
      const simpleOk = (await page.locator(pageTab('tags')).count()) === 0 && (await page.locator('header.ui-pagehead .mx-mode-hint').count()) === 1
        && (await page.evaluate(RAW + '.get("maermin_ui_mode")')) === 'simple';
      ok('Simple hides niche tools, says so and is saved', simpleOk);
      await page.keyboard.press('g'); await page.keyboard.press('u'); // Alerts & Rules: hidden in Simple, the shortcut still works
      await page.waitForTimeout(300);
      ok('a hidden view stays reachable by shortcut and shows in its area', (await page.locator('header.ui-pagehead [data-view="rules"][aria-selected="true"]').count()) === 1);
      await openView(page, 'returns');
      await page.waitForTimeout(200);
      const tabs = (await page.locator('main .mx-area-tabs [data-tab]').evaluateAll((els) => els.map((e) => e.dataset.tab))).join();
      ok('Simple shows Returns + Performance as tabs (no Attribution)', tabs === 'returns,performance', tabs);
      await page.locator('header.ui-pagehead .mx-mode-hint [data-ui-mode="advanced"]').click();
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
    // FINDINGS M-15: the "separate depot" switch is stored on the portfolio and
    // stays on after leaving the view; switched off again it leaves no field
    // behind. (No reload here: the checks below need this session's state.)
    {
      await openView(page, 'portfolios');
      const toggle = page.locator('main [data-pf-depot-toggle="default"]');
      await toggle.check();
      await page.waitForTimeout(300);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('maermin_portfolios') || '[]').filter((p) => p.id === 'default').map((p) => p.separateDepot)[0]);
      await openView(page, 'overview');
      await openView(page, 'portfolios');
      const after = await page.locator('main [data-pf-depot-toggle="default"]').isChecked().catch(() => null);
      await page.locator('main [data-pf-depot-toggle="default"]').uncheck();
      await page.waitForTimeout(300);
      const cleared = await page.evaluate(() => JSON.parse(localStorage.getItem('maermin_portfolios') || '[]').filter((p) => p.id === 'default').map((p) => 'separateDepot' in p)[0]);
      ok('M-15: the separate-depot switch is saved, stays on and clears', stored === true && after === true && cleared === false, JSON.stringify({ stored, after, cleared }));
    }

    // Empty analytics states: a portfolio without price history must say so,
    // not spin forever or print invented / zero figures.
    await openView(page, 'analytics');
    await page.waitForTimeout(400);
    ok('correlation explains missing history instead of "Loading..."', (await page.locator('[data-testid="correlation-empty"]').count()) === 1 && (await page.locator('[data-testid="correlation-loading"]').count()) === 0);
    await page.getByRole('radio', { name: 'Risk Level' }).click();
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
    {
      // P5-3.7: the ledger findings by code; this session's Worker serves crypto
      // only, so a held stock without any price is listed as well (DQ-PRICE-STALE)
      const dq = await page.locator('[data-testid="ledger-issues"] [data-dq-code]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dq-code')));
      const ledgerOnly = dq.filter((c) => c !== 'DQ-PRICE-STALE');
      ok('Data check lists the oversell and the unconvertible currency', ledgerOnly.length === 2 && ledgerOnly.indexOf('DQ-OVERSOLD') > -1 && ledgerOnly.indexOf('DQ-FX-UNKNOWN') > -1, check.slice(0, 120) + ' ' + JSON.stringify(dq));
      ok('P5-3.7: a held position without any price is a DQ-PRICE-STALE finding', dq.filter((c) => c === 'DQ-PRICE-STALE').length <= 2, JSON.stringify(dq));
    }
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
        // R3.3 (B-5): select the row, then "Move to trash" in the detail panel and confirm
        await page.locator('main [data-tx-id][aria-label*="ETH"]').first().click();
        await page.locator('[data-testid="tx-detail"] [data-tx-action="trash"]').click();
        await page.locator('[aria-labelledby="dlg-confirm"]').getByRole('button', { name: 'Delete', exact: true }).click();
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
      ok('Tax view names the supported tax rules', /German, Austrian, Swiss and US tax rules/.test(await page.locator('main [data-testid="disclaimer"][data-kind="tax"]').first().innerText().catch(() => '')), taxNote);
      await openView(page, 'privacy');
      const pv = await page.locator('[data-testid="privacy-view"]').innerText().catch(() => '');
      ok('Settings → Privacy lists what stays local and what goes where', ['Stays on this device', 'Your Cloudflare Worker', 'CoinGecko', 'Cloud sync', 'Share & Compare'].every((x) => pv.includes(x)), pv.slice(0, 160));
      ok('P5-5.1/5.2: Privacy names web push and the local MCP server', /Push notifications: each reminder is encrypted on your device/.test(pv) && /Local MCP server \(maermin-mcp/.test(pv) && /--amounts/.test(pv), pv.slice(-400));
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
    await page.getByRole('radio', { name: 'Tax Report', exact: true }).click();
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

    // P5-4.1: loss carry-forward. No earlier losses in the fixture; an opening
    // balance of 200 in the other pot from the assessment is brought into 2025
    // and used against the AAPL share gain of 490, so nothing is carried on.
    {
      const lc = page.locator('[data-testid="loss-carry-panel"]');
      let before = '', row = '', stored = null, err = '';
      try {
        await lc.waitFor({ timeout: 5000 });
        before = await lc.locator('[data-testid="lc-row-shares"]').innerText();
        await lc.locator('[data-testid="lc-open-other"]').fill('200');
        await lc.locator('[data-testid="lc-open-other"]').press('Enter');
        await page.waitForTimeout(500);
        row = await lc.locator('[data-testid="lc-row-other"]').innerText();
        stored = await page.evaluate(() => JSON.parse(localStorage.getItem('maermin_loss_carry') || 'null'));
        await lc.locator('[data-testid="lc-open-other"]').fill('');
        await lc.locator('[data-testid="lc-open-other"]').press('Enter');
        await page.waitForTimeout(300);
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.1: the loss carry-forward panel shows the pots with nothing carried', /Shares/.test(before) && !/[1-9]\d*\.\d\d/.test(before.replace(/0\.00/g, '')), err || before.replace(/\s+/g, ' '));
      ok('P5-4.1: an opening balance of 200 is brought forward, used in 2025 and not carried on', /200\.00[\s\S]*200\.00[\s\S]*0\.00/.test(row), err || row.replace(/\s+/g, ' '));
      ok('P5-4.1: the opening balance is stored per year and pot', !!stored && stored.opening && stored.opening['2025'] && stored.opening['2025'].other === 200, err || JSON.stringify(stored));
    }

    // P5-4.2: sell simulator. 5 VWCE.DE bought at 110 in 2024, sold at 150 on
    // 2025-06-01: one lot, gain 200; with the AAPL gain of 490 the year stays
    // under the 1,000 allowance, so 200 of it is used and no extra tax.
    {
      const ss = page.locator('[data-testid="sell-sim-panel"]');
      let over = '', result = '', stored = null, n0 = null, err = '';
      try {
        await ss.waitFor({ timeout: 5000 });
        n0 = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').length);
        await ss.locator('[data-testid="ss-holding"]').selectOption('stocks|VWCE.DE');
        await ss.locator('[data-testid="ss-qty"]').fill('6');
        await ss.locator('[data-testid="ss-price"]').fill('150');
        await ss.locator('[data-testid="ss-date"]').fill('2025-06-01');
        await ss.locator('[data-testid="ss-run"]').click();
        over = await ss.locator('[data-testid="ss-error"]').innerText();
        await ss.locator('[data-testid="ss-qty"]').fill('5');
        await ss.locator('[data-testid="ss-run"]').click();
        await page.waitForTimeout(300);
        result = await ss.locator('[data-testid="ss-result"]').innerText();
        stored = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').length);
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.2: selling more than held is refused', /You hold only 5/.test(over), err || over);
      ok('P5-4.2: one lot from 2024, gain 200, 200 of the allowance used, no extra tax',
        /2024/.test(result) && /Gain\s*200\.00/.test(result) && /Sparerpauschbetrag used[^\n]*\n?\s*200\.00/.test(result) && /Extra tax this year\s*0\.00/.test(result), err || result.replace(/\s+/g, ' '));
      ok('P5-4.2: the simulation books nothing', n0 > 0 && stored === n0, err || n0 + ' -> ' + stored);
    }

    // P5-4.3: Vorabpauschale forecast. VWCE.DE is a held fund; the seed has no
    // price for it on 1 January, so it is listed and left out of the total.
    {
      const vf = page.locator('[data-testid="vap-forecast-panel"]');
      let text = '', row = '', cash = '', err = '';
      try {
        await vf.waitFor({ timeout: 5000 });
        text = await vf.innerText();
        row = await vf.locator('[data-testid="vf-row-VWCE.DE"]').innerText();
        cash = await vf.locator('[data-testid="vf-cash"]').innerText();
      } catch (e) { err = e.message.split('\n')[0]; }
      const yr = String(new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear());
      ok('P5-4.3: the forecast panel names the value year and the Basiszins', text.indexOf('Vorabpauschale forecast ' + yr) >= 0 && /Basiszins/.test(text), err || text.slice(0, 200));
      ok('P5-4.3: a held fund without a 1 January price is listed and left out', /no price on 1 January/.test(row), err || row);
      ok('P5-4.3: the cash needed on the first working day of January', /Cash needed on/.test(cash) && /0\.00/.test(cash), err || cash);
    }


    // P5-4.4: December plan. The panel shows the allowance left this year; the
    // seed's only share/fund holding (VWCE.DE) is not at a gain, so there is
    // nothing to harvest.
    {
      const hv = page.locator('[data-testid="harvest-panel"]');
      let text = '', left = '', tax = '', err = '';
      try {
        await hv.waitFor({ timeout: 5000 });
        text = await hv.innerText();
        left = await hv.locator('[data-testid="hv-left"]').innerText();
        if (await hv.locator('[data-testid="hv-result"]').count()) tax = await hv.locator('[data-testid="hv-tax"]').innerText();
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.4: the December plan shows the Sparerpauschbetrag left this year', /December plan/.test(text) && /Sparerpauschbetrag left this year\s*[\d,.]+/.test(left), err || left);
      ok('P5-4.4: no share or fund lot at a gain: nothing to harvest, no plan', !tax && /No share or fund lot is at a gain/.test(text), err || (tax + ' | ' + text.slice(-300)));
    }


    // P5-4.5: crypto tax-free calendar. The seed's ETH (1, bought 2024-02-01)
    // has been held for more than a year: all of it is tax-free today.
    {
      const cc = page.locator('[data-testid="crypto-calendar-panel"]');
      let text = '', today = '', err = '';
      try {
        await cc.waitFor({ timeout: 5000 });
        text = await cc.innerText();
        today = await cc.locator('[data-testid="cc-ETH-0"]').innerText();
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.5: the calendar has the columns today to 12 months', /Today/i.test(text) && /In 12 mo\./i.test(text), err || text.slice(0, 200));
      ok('P5-4.5: ETH bought in 2024 is tax-free today (1)', /^1\b/.test(today.trim()), err || today);
    }


    // P5-4.6: cost-basis methods. The comparison lists the four methods with
    // FIFO marked as the tax report's method; the German detail names the
    // crypto method (pooled FIFO by default).
    {
      const cm = page.locator('[data-testid="cost-methods-panel"]');
      let text = '', legal = '', body = '', err = '';
      try {
        await cm.waitFor({ timeout: 5000 });
        text = await cm.innerText();
        legal = await cm.locator('[data-testid="cm-legal"]').innerText();
        body = await page.innerText('main');
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.6: FIFO, LIFO, HIFO and average cost side by side, FIFO used in the tax report', /FIFO/.test(text) && /LIFO/.test(text) && /HIFO/i.test(text) && /Average cost/i.test(text) && /used in your tax report/.test(legal), err || text.slice(0, 300));
      ok('P5-4.6: the German detail names the crypto method (FIFO across all wallets by default)', /Crypto cost basis\s*FIFO across all wallets/.test(body), err || (body.match(/Crypto cost basis[^\n]*\n?[^\n]*/) || [''])[0]);
    }


    // P5-4.7: tax certificate. Entered by hand (no PDF in the test): a
    // Kapitalertragsteuer of 9,999 cannot match MAERMIN, so the line is
    // flagged; the certificate is stored and then deleted again.
    {
      const tc = page.locator('[data-testid="tax-cert-panel"]');
      let summary = '', row = '', stored = null, after = null, err = '';
      try {
        await tc.waitFor({ timeout: 5000 });
        await tc.locator('[data-testid="tc-add"]').click();
        await tc.locator('[data-testid="tc-v-kest"]').fill('9999');
        await tc.locator('[data-testid="tc-save"]').click();
        await page.waitForTimeout(300);
        summary = await tc.locator('[data-testid="tc-summary"]').first().innerText();
        row = await tc.locator('[data-testid="tc-row-kest"]').first().innerText();
        stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('maermin_tax_certs') || 'null'); } catch (e) { return null; } });
        await tc.locator('button', { hasText: 'Delete' }).first().click();
        await page.waitForTimeout(300);
        after = await tc.locator('[data-testid="tc-cert"]').count();
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.7: a certificate entered by hand is compared line by line; the KapESt line differs', /differ/.test(summary) && /9,999\.00/.test(row), err || (summary + ' | ' + row));
      ok('P5-4.7: the certificate is stored and can be deleted', !!stored && stored.certs.length === 1 && stored.certs[0].values.kest === 9999 && after === 0, err || JSON.stringify(stored) + ' ' + after);
    }


    // P5-4.8: statements and exports. The roll-forward CSV downloads with its
    // header and adds up; the AES-256 encryptor runs on the browser's WebCrypto.
    {
      const sp = page.locator('[data-testid="statements-panel"]');
      let csv = '', enc = null, err = '';
      try {
        await sp.waitFor({ timeout: 5000 });
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), sp.locator('[data-testid="st-rf-csv"]').click()]);
        const p = await dl.path();
        csv = p ? (await import('node:fs')).readFileSync(p, 'utf8') : '';
        enc = await page.evaluate(async () => {
          const src = '%PDF-1.3\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n3 0 obj\n<< /Title (Test) >>\nendobj\nxref\n0 4\n0000000000 65535 f \ntrailer\n<< /Size 4 /Root 1 0 R /Info 3 0 R >>\nstartxref\n0\n%%EOF';
          const out = await window.MaerminPdfAes.encryptPdf(new TextEncoder().encode(src), { userPassword: 'pw' });
          const s = new TextDecoder('latin1').decode(out);
          return { head: s.slice(0, 8), aes: /\/CFM \/AESV3/.test(s), plain: s.indexOf('(Test)') >= 0 };
        });
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.8: the roll-forward CSV downloads with its header', /Category;Symbol;Opening quantity/.test(csv), err || csv.slice(0, 120));
      ok('P5-4.8: AES-256 PDF encryption runs in the browser (PDF 2.0, AESV3, no plaintext)', !!enc && enc.head === '%PDF-2.0' && enc.aes && !enc.plain, err || JSON.stringify(enc));
    }


    // P5-4.9: Austria. Switching the tax system shows the Austrian computation
    // (27.5 %, moving average) and the KPI labels; switching back restores Germany.
    {
      let text = '', kpi = '', back = false, err = '';
      try {
        const sel = page.locator('select', { has: page.locator('option[value="at"]') }).first();
        await sel.selectOption('at');
        const atp = page.locator('[data-testid="at-panel"]');
        await atp.waitFor({ timeout: 5000 });
        text = await atp.innerText();
        kpi = await page.innerText('main');
        await sel.selectOption('de');
        await page.waitForTimeout(400);
        back = (await page.locator('[data-testid="at-panel"]').count()) === 0;
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.9: Austria shows its computation (27.5 %, estimated tax, fund inputs, sources)', /Austria: tax on capital income/.test(text) && /Estimated tax/.test(text) && /Income at 27\.5 %/.test(text) && /§ 27a/.test(text), err || text.slice(0, 300));
      ok('P5-4.9: the KPI cards use the Austrian labels; back to Germany the panel is gone', /Income at 27\.5 %/.test(kpi) && /Crypto Altvermögen, tax-free/.test(kpi) && back, err || String(back));
    }


    // P5-4.10: Switzerland. Switching the tax system shows the Wertschriftenverzeichnis
    // (CHF, columns A/B, KS 36) and the KPI labels; switching back restores Germany.
    {
      let text = '', kpi = '', back = false, err = '';
      try {
        const sel = page.locator('select', { has: page.locator('option[value="ch"]') }).first();
        await sel.selectOption('ch');
        const chp = page.locator('[data-testid="ch-panel"]');
        await chp.waitFor({ timeout: 5000 });
        text = await chp.innerText();
        kpi = await page.innerText('main');
        await sel.selectOption('de');
        await page.waitForTimeout(400);
        back = (await page.locator('[data-testid="ch-panel"]').count()) === 0;
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.10: Switzerland shows the Wertschriftenverzeichnis (wealth, columns A/B, VST, KS 36, sources)', /Switzerland: Wertschriftenverzeichnis/i.test(text) && /at year-end \(wealth\)/i.test(text) && /column A/i.test(text) && /Verrechnungssteuer to reclaim/i.test(text) && /Kreisschreiben 36/i.test(text) && /Art\. 16 Abs\. 3/.test(text), err || text.slice(0, 300));
      ok('P5-4.10: the KPI cards use the Swiss labels; back to Germany the panel is gone', /Securities and crypto at year-end/i.test(kpi) && /Verrechnungssteuer to reclaim/i.test(kpi) && back, err || String(back));
    }


    // P5-4.11: US contribution limits. With the US tax system the Tax view shows
    // the retirement panel; marking a portfolio as a Roth IRA adds the IRA limit.
    {
      let text = '', bar = '', err = '';
      try {
        const sel = page.locator('select', { has: page.locator('option[value="us"]') }).first();
        await sel.selectOption('us');
        const ucp = page.locator('[data-testid="us-contrib-panel"]');
        await ucp.waitFor({ timeout: 5000 });
        text = await ucp.innerText();
        const typeSel = ucp.locator('[data-testid^="uc-pf-"] select').first();
        await typeSel.selectOption('roth-ira');
        await page.locator('[data-testid="uc-ira"]').waitFor({ timeout: 5000 });
        bar = await page.locator('[data-testid="uc-ira"]').innerText();
        await typeSel.selectOption('');
        await sel.selectOption('de');
        await page.waitForTimeout(400);
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-4.11: the US tax system shows the retirement contributions panel with its sources', /Retirement contributions/i.test(text) && /Notice 2025-67/.test(text), err || text.slice(0, 300));
      ok('P5-4.11: a portfolio marked as Roth IRA shows the IRA limit of the selected year and the 15 April deadline', /of 7,[05]00\.00/.test(bar) && /04\/15\/20\d\d/.test(bar), err || bar);
    }

    // P5-5.3: Budget. A Sparkasse CSV export is imported into the separate
    // budget ledger: income, expenses, savings, the cash-flow Sankey and the
    // categories appear; importing it again adds nothing; the portfolio
    // transactions are untouched.
    {
      let text = '', again = '', txBefore = -1, txAfter = -2, err = '';
      const csv = ['"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Betrag";"Waehrung"',
        '"DE1";"01.09.26";"01.09.26";"LOHN";"Gehalt September";"Muster GmbH";"3.000,00";"EUR"',
        '"DE1";"02.09.26";"02.09.26";"LASTSCHRIFT";"Miete September";"Hausverwaltung";"-900,00";"EUR"',
        '"DE1";"03.09.26";"03.09.26";"KARTENZAHLUNG";"REWE SAGT DANKE";"REWE Markt GmbH";"-60,00";"EUR"',
        '"DE1";"10.09.26";"10.09.26";"UEBERWEISUNG";"Sparplan";"Trade Republic";"-400,00";"EUR"'].join('\r\n');
      try {
        txBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').length);
        await openView(page, 'budget');
        const view = page.locator('[data-testid="budget-view"]');
        await view.waitFor({ timeout: 5000 });
        await page.locator('[data-testid="bg-csv"]').setInputFiles({ name: 'Umsaetze.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
        await page.locator('[data-testid="bg-sankey"]').waitFor({ timeout: 5000 });
        text = await view.innerText();
        await page.locator('[data-testid="bg-csv"]').setInputFiles({ name: 'Umsaetze.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
        await page.waitForTimeout(600);
        again = await page.evaluate(() => JSON.parse(localStorage.getItem('maermin_budget') || '{}').txs.length);
        txAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').length);
        await page.evaluate(() => localStorage.removeItem('maermin_budget'));
      } catch (e) { err = e.message.split('\n')[0]; }
      // Back to the Tax view: the PDF export check below clicks its button.
      await openView(page, 'tax').catch(() => {});
      await page.waitForTimeout(400);
      ok('P5-5.3: a bank CSV becomes the month\'s income, expenses, savings and Sankey', !err && /September 2026/.test(text) && /3,000\.00/.test(text) && /960\.00/.test(text) && /400\.00/.test(text) && /Groceries/.test(text) && /Housing/.test(text), err || text.replace(/\n/g, ' | ').slice(0, 400));
      ok('P5-5.3: importing the same export again adds nothing; the portfolio transactions are untouched', again === 4 && txBefore === txAfter, { again, txBefore, txAfter });
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
        if (!(await panel.count())) await page.getByRole('radio', { name: /Steam inventory/ }).click();
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
      // R3.1 (B-4): seven sections; the checks follow the four original ones
      const FOUR = ['valueChart', 'statCards', 'returnFigures', 'allocation'];
      const order = () => page.locator('[data-ov-section]').evaluateAll((els, four) => els.map((x) => x.getAttribute('data-ov-section')).filter((id) => four.includes(id)).join(','), FOUR);
      let a = '', b = '', c = '', said = '', focusOk = false, err = '';
      try {
        await openView(page, 'customize');
        // B-4: seven sections (Allocation is last), so six steps to the top
        for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Move Allocation · Top Performers · Positions up' }).click();
        await page.waitForTimeout(150); // focus is restored after the re-render
        said = await page.locator('main [role="status"][aria-live="polite"]').last().innerText();
        focusOk = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-dash-id')) === 'allocation');
        await openView(page, 'overview'); await page.waitForTimeout(400);
        a = await order();
        await openView(page, 'customize');
        await page.locator('[data-dash-handle="valueChart"]').focus();
        await page.keyboard.press('ArrowDown'); // past "What it is made of"
        await page.waitForTimeout(150);
        await page.locator('[data-dash-handle="valueChart"]').focus();
        await page.keyboard.press('ArrowDown'); // past the stat cards
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
      ok('P4-7: "Move up" puts Allocation first on the Overview, focus stays, position announced', a === 'allocation,valueChart,statCards,returnFigures' && focusOk && /position 1 of 7/.test(said), err || a + ' | ' + said + ' | focus ' + focusOk);
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
        await page.getByRole('radio', { name: 'Tax Report', exact: true }).click();
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
      let howto = '', info = '', chips = '', toast = '', err = '', deposit = null, pdfHint = '', tiles = [];
      try {
        await openView(page, 'data');
        await page.getByRole('radio', { name: /Broker Import/ }).click();
        tiles = await page.getByRole('button', { name: /^Select broker / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').replace('Select broker ', '')));
        await page.getByRole('button', { name: 'Select broker Portfolio Performance' }).click();
        howto = await page.locator('[data-testid="tracker-howto"]').innerText();
        pdfHint = await page.getByText(/^PDF statements:/).first().innerText();
        await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles({ name: 'Depotumsaetze.csv', mimeType: 'text/csv', buffer: Buffer.from(PP, 'utf8') });
        info = await page.locator('[data-testid="tracker-info"]').innerText();
        chips = await page.locator('[data-testid="tracker-info"]').locator('xpath=preceding-sibling::div[1]').innerText();
        await page.getByRole('button', { name: /Import 4/ }).click();
        toast = await page.getByText(/4 transactions imported/).first().innerText();
        deposit = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').find((x) => x.date === '2024-01-15' && x.type === 'deposit'));
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('cleanup D-4: the import wizard has no getquin tile, the other trackers stay', tiles.length > 5 && !tiles.some((n) => /getquin/i.test(n)) && tiles.includes('Parqet') && tiles.includes('CoinTracking'), err || tiles.join(', '));
      ok('P4-8: the PP tile explains the export (Depotumsätze / Kontoumsätze)', /Securities Account Transactions/.test(howto) && /Kontoumsätze/.test(howto), err || howto);
      ok('P4-8: file read as Portfolio Performance, booking rules shown, no column mapping', /How Portfolio Performance rows are booked/.test(info), err || info);
      ok('P4-8 / P5-1.3: 4 valid rows (the deposit is a cash booking now), none skipped', /Detected: Portfolio Performance/.test(chips) && /4 valid/.test(chips) && !/skipped/.test(chips), err || chips);
      ok('P4-8: import books the 4 rows', /4 transactions imported/.test(toast), err || toast);
      ok('P5-1.3: the PP deposit is stored as a cash row of 5,000 EUR', !!deposit && deposit.amount === 5000 && deposit.category === 'cashflow', err || JSON.stringify(deposit));
      ok('P5-3.2: the import names the new PDF brokers and document kinds', /flatex, Consorsbank, DEGIRO, onvista bank/.test(pdfHint) && /tax and fee documents/.test(pdfHint), err || pdfHint);
      ok('P5-3.3: and the batch B brokers', /Baader Bank, Smartbroker\+, Sparkasse \/ Deka, Postbank/.test(pdfHint), err || pdfHint);
    }
    // P5-3.2: the bundled PDF parser reads a made-up flatex sale (taxes withheld
    // -> a tax row) and a Consorsbank dividend (withholding), and the mapping
    // flow keeps both (pdf.js itself is browser-only and needs the CDN)
    {
      const r = await page.evaluate(() => {
        const P = window.MaerminPdfImport, IM = window.MaerminImportMapping;
        const sell = P.parseText(['flatexDEGIRO Bank AG · www.flatex.de', 'Wertpapierabrechnung Verkauf', 'Nr.1 Apple Inc. (US0378331005/865985)',
          'Ausgeführt : 5 St. Kurswert : 1.050,00 EUR', 'Kurs : 210,00 EUR Provision : 5,90 EUR', 'Schlusstag : 10.03.2025',
          'Kapitalertragsteuer : -45,20 EUR', 'Solidaritätszuschlag : -2,48 EUR'].join('\n'));
        const div = P.parseText(['Consorsbank', 'Dividendengutschrift', 'Bestand 20 Stück MICROSOFT CORP. US5949181045', 'Dividende pro Stück 0,83 USD',
          'Quellensteuer 15 % USD 2,49 USD', 'Zahltag 13.06.2025'].join('\n'));
        const prev = IM.preview(P.candidatesToCSV(sell.candidates.concat(div.candidates)), { existing: [] });
        // P5-3.3: a Scalable dividend issued by Baader (made up)
        const sc = P.parseText(['Baader Bank AG', 'Scalable Capital GmbH', 'Dividende', 'Nominale ISIN: US0378331005 WKN: 865985', 'STK 10 Apple Inc.',
          'Zahltag: 15.05.2025', 'Ertrag pro Stück 0,25 USD', 'US-Quellensteuer 15 % USD -0,38 USD'].join('\n'));
        return { brokers: [sell.broker && sell.broker.id, div.broker && div.broker.id], types: prev.transactions.map((x) => x.type).join(','),
          tax: (prev.transactions.find((x) => x.type === 'tax') || {}).amount, wht: (prev.transactions.find((x) => x.type === 'dividend') || {}).withholdingTax, errors: prev.errors.length,
          sc: sc.broker && sc.broker.id + ':' + (sc.candidates[0] || {}).quantity + 'x' + (sc.candidates[0] || {}).price + '-' + (sc.candidates[0] || {}).withholdingTax };
      });
      ok('P5-3.2: bundled parser + mapping: flatex sale with a tax row of 47.68, Consorsbank dividend with 2.49 withholding', r.brokers.join() === 'flatex,consorsbank' && r.types === 'sell,tax,dividend' && Math.abs(r.tax - 47.68) < 1e-9 && Math.abs(r.wht - 2.49) < 1e-9 && r.errors === 0, JSON.stringify(r));
      ok('P5-3.3: bundled parser reads a Scalable dividend issued by Baader (10 x 0.25 USD, 0.38 withholding)', r.sc === 'scalable:10x0.25-0.38', r.sc);
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
    let returnsText = '', intelText = '', rbEmpty = 0, rbPlan = -1, ovReturns = '', ovMain = '';
    let brokerOv = '', rows = 0, before = null, after = null, pills = null;
    // P5-1.8: Worker-only views run on in-page sample data; nothing may reach the network
    const sampleReqs = []; page.on('request', (r) => { if (/maermin\.invalid/.test(r.url())) sampleReqs.push(r.url()); });
    const fixtures = {}; let dqText = '', va = null, br = null, lt = null, dh = null, hrd = null, agd = null, txd = null;
    // cleanup B-5: count value-tick flashes (motion.js) while the demo starts
    await page.addInitScript(() => {
      window.__ticks = [];
      new MutationObserver((muts) => muts.forEach((m) => {
        const el = m.target;
        if (el.classList && (el.classList.contains('mx-tick-up') || el.classList.contains('mx-tick-down')) && el.closest('.maermin-main')) window.__ticks.push(el.textContent.trim().slice(0, 20));
      })).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    let startTicks = null, posDlg = null;
    try {
      await unlock(page, base);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      startTicks = await page.evaluate(() => window.__ticks.slice());
      // cleanup V-5 / U-4: the position detail names the holding, fades the
      // cut edge of its monthly grid and labels every field
      await page.locator('main table tbody tr').filter({ hasText: 'Bitcoin' }).first().click();
      await page.locator('[data-testid="pos-title"]').waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
      posDlg = await page.evaluate(() => {
        const d = [...document.querySelectorAll('[role=dialog]')].pop();
        const t = document.querySelector('[data-testid="pos-title"]');
        const unnamed = d ? [...d.querySelectorAll('input, select, textarea')].filter((i) => i.getClientRects().length && !(i.getAttribute('aria-label') || (i.labels && i.labels.length) || i.title)).map((i) => i.outerHTML.slice(0, 60)) : ['no dialog'];
        return { title: t ? t.innerText : '', more: !!document.querySelector('[data-testid="pos-heatmap"] [data-more="right"]'), unnamed };
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
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
      // cleanup B-2: after picking another option exactly one option of the
      // group looks and reads as selected (fx.js used to keep the first
      // option's primary gradient).
      const pickAndLook = async (view, labels, pick) => {
        await openView(page, view);
        await page.waitForTimeout(1200);
        await page.locator('main button[aria-pressed]').filter({ hasText: new RegExp('^' + pick + '$') }).last().click();
        await page.mouse.move(1, 1);
        await page.waitForTimeout(900);
        return page.evaluate(([labels, pick]) => {
          const bs = [...document.querySelectorAll('main button[aria-pressed]')].filter((b) => labels.includes(b.innerText.trim()) && b.offsetParent);
          const group = bs.filter((b) => b.parentElement === bs.find((x) => x.innerText.trim() === pick && x.getAttribute('aria-pressed') === 'true').parentElement);
          const sig = (b) => { const s = getComputedStyle(b); return s.backgroundImage + '|' + s.backgroundColor; };
          const count = {}; group.forEach((b) => { count[sig(b)] = (count[sig(b)] || 0) + 1; });
          const common = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
          // cleanup V-2: text contrast of the selected option on what is behind it
          const rgb = (c) => { const m = (c.match(/[\d.]+/g) || []).map(Number); return { c: m.slice(0, 3), a: m[3] == null ? 1 : m[3] }; };
          const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
          const under = (el) => { for (let e = el; e; e = e.parentElement) { const b = rgb(getComputedStyle(e).backgroundColor); if (b.a > 0.9) return b.c; } return [255, 255, 255]; };
          const sel = group.find((b) => b.getAttribute('aria-pressed') === 'true');
          let contrast = 0;
          if (sel) { const s = getComputedStyle(sel); const bg = rgb(s.backgroundColor), base = under(sel.parentElement); const c = bg.c.map((v, i) => v * bg.a + base[i] * (1 - bg.a)); const L1 = lum(rgb(s.color).c), L2 = lum(c); contrast = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); }
          return { looks: group.filter((b) => sig(b) !== common).map((b) => b.innerText.trim()), pressed: group.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.innerText.trim()), contrast: Math.round(contrast * 100) / 100 };
        }, [labels, pick]).catch((e) => ({ error: String(e.message).split('\n')[0] }));
      };
      pills = {
        discovery: await pickAndLook('discovery', ['Top Movers', 'Screener', 'Dividends'], 'Dividends'),
        bench: await pickAndLook('returns', ['MSCI World', 'FTSE All-World', 'S&P 500'], 'FTSE All-World')
      };
      // cleanup V-3: each KPI figure stays on one line, its currency included
      await openView(page, 'overview');
      await page.waitForTimeout(1200);
      pills.kpi = await page.evaluate(() => [...document.querySelectorAll('main .mx-kpi-value')].filter((el) => el.offsetParent).map((el) => {
        const r = document.createRange(); r.selectNodeContents(el);
        const tops = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
        return { text: el.innerText.trim(), lines: tops.size };
      }));
      // P5-2.8: Strategy → Providers & brokers
      await openView(page, 'investment-analysis');
      await page.getByRole('radio', { name: /Providers & brokers/ }).first().click().catch(() => {});
      await page.locator('[data-testid="allocation-groups"]').waitFor({ timeout: 8000 }).catch(() => {});
      agd = await page.evaluate(() => {
        const rows = (id) => Array.from(document.querySelectorAll('[data-testid="' + id + '"] [data-key]')).map((d) => ({ key: d.getAttribute('data-key'), v: parseFloat(d.getAttribute('data-v')), pct: parseFloat(d.getAttribute('data-pct')) }));
        return { providers: rows('ag-provider-bars'), brokers: rows('ag-broker-bars') };
      });
      // P5-2.10: Strategy → Taxonomies - Kommer template, fill from data, export and import again
      await page.getByRole('radio', { name: /^Taxonomies$/ }).first().click().catch(() => {});
      await page.locator('[data-testid="tx-template"]').selectOption('kommer').catch(() => {});
      await page.locator('[data-testid="tx-create"]').click().catch(() => {});
      const fillTxt = await page.locator('[data-testid="tx-fill"]').innerText().catch(() => '');
      await page.locator('[data-testid="tx-fill"]').click().catch(() => {});
      await page.waitForTimeout(400);
      txd = await page.evaluate(() => {
        const row = (id) => document.querySelector('[data-testid="tx-tree"] tr[data-node="' + id + '"]');
        const v = (id) => parseFloat(row(id) ? row(id).getAttribute('data-v') : 'NaN');
        const act = row('emerging') && row('emerging').querySelector('[data-action]');
        return { dev: v('developed'), em: v('emerging'), un: v('unassigned'), action: act ? act.getAttribute('data-action') : null, stored: localStorage.getItem('maermin_taxonomies') };
      });
      txd.fill = fillTxt;
      const [txDl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.locator('[data-testid="tx-export"]').click().catch(() => null)]);
      if (txDl) {
        const chunks = []; for await (const c of await txDl.createReadStream()) chunks.push(c);
        txd.json = Buffer.concat(chunks).toString('utf8');
        await page.locator('[data-testid="tx-file"]').setInputFiles({ name: 'kommer.json', mimeType: 'application/json', buffer: Buffer.from(txd.json) });
        await page.waitForTimeout(600);
        txd.options = await page.locator('[data-testid="tx-select"] option').count();
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
      await page.getByRole('radio', { name: /^History$/ }).first().click();
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
      await page.getByRole('radio', { name: /^Forecast$/ }).first().click();
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
      await page.getByRole('radio', { name: /^Tax Report$/ }).first().click();
      await page.waitForTimeout(1200);
      dqText = await page.locator('main').innerText();
      // P5-1.5: the Overview's Returns section
      await openView(page, 'overview');
      await page.locator('[data-testid="ov-returns"]').waitFor({ timeout: 8000 });
      await page.waitForTimeout(1500); // figures count up when they appear
      ovReturns = await page.locator('[data-testid="ov-returns"]').innerText();
      ovMain = await page.locator('main').innerText();
      // P5-1.7: two portfolios in memory; the broker's clearing account shows its cash
      const keys = ['maermin_portfolios', 'maermin_active_portfolio', 'maermin_fund_types', 'maermin_vap_records', 'transactions'];
      before = await page.evaluate((ks) => ks.map((k) => localStorage.getItem(k)), keys);
      await page.locator('[data-testid="scope-select"]').selectOption({ label: 'Savings plan broker' });
      await page.waitForTimeout(1500);
      brokerOv = await page.locator('main').innerText();
      await openView(page, 'transactions');
      await page.waitForTimeout(800);
      rows = await page.evaluate(() => (window.MaerminDemo ? window.MaerminDemo.getTransactions().length : 0));
      await openView(page, 'overview');
      await page.locator('[data-testid="scope-select"]').selectOption({ label: 'All Portfolios' });
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
    { // P5-1.5: the demo opens on "All portfolios" - Analysis -> Returns reads the same book as the Overview
      const pct = (txt, label) => { const m = String(txt).match(new RegExp(label + '[^\\n]*\\n\\s*([+-]?[\\d,]+\\.\\d\\d)%', 'i')); return m ? m[1] : null; };
      const cv = (returnsText.match(/Current Value\s*\n\s*([\d,]+\.\d\d)/i) || [])[1] || null;
      const ot = ovMain.match(/Total portfolio value\s*(?:Sample data\s*)?([\d,]+)\s*(\.\d\d)/i);
      const r = { cv, ovTotal: ot ? ot[1] + ot[2] : null, xirr: [pct(returnsText, 'XIRR'), pct(ovReturns, 'XIRR')], twr: [pct(returnsText, 'TWR'), pct(ovReturns, 'TWR')] };
      ok('P5-1.5: demo Returns "Current value", XIRR and TWR equal the Overview\'s (all portfolios)',
        !!cv && cv === r.ovTotal && !!r.xirr[0] && r.xirr[0] === r.xirr[1] && !!r.twr[0] && r.twr[0] === r.twr[1], err || JSON.stringify(r));
    }
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
      { const x = txd, json = (() => { try { return JSON.parse(x.json); } catch (e) { return null; } })();
        ok('P5-2.10: demo taxonomy from the Kommer template: filled from data, the nodes and "not assigned" add up, emerging below 30 % gets a buy', !!x && /Fill from data \(\d+\)/.test(x.fill) && x.dev > 0 && x.un >= 0 && x.action === 'buy',
          err || JSON.stringify(x && { fill: x.fill, dev: x.dev, em: x.em, un: x.un, action: x.action }));
        ok('P5-2.10: exported as JSON and imported again; the demo keeps it in memory only', !!json && json.format === 'maermin-taxonomy' && json.taxonomy.nodes[0].target === 70 && x.options === 2 && x.stored === null,
          err || JSON.stringify(x && { options: x.options, stored: x.stored, json: (x.json || '').slice(0, 80) })); }
      { const a = agd, sum = (l) => l.reduce((x, r) => x + r.pct, 0);
        ok('P5-2.8: demo funds by provider (Vanguard) and value by broker: two portfolios, shares add up to 100 %', !!a && a.providers.length > 0 && a.providers[0].key === 'Vanguard' && Math.abs(sum(a.providers) - 100) < 1e-6
          && a.brokers.length === 2 && Math.abs(sum(a.brokers) - 100) < 1e-6 && a.brokers.some((b) => b.key === 'demo-broker'), err || JSON.stringify(a)); }
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
    ok('cleanup V-5: the position detail is titled "Bitcoin BTC" and fades the cut edge of its monthly grid', !!posDlg && /^Bitcoin\s*BTC$/.test(posDlg.title.trim()) && posDlg.more, err || JSON.stringify(posDlg));
    ok('cleanup U-4: every field in the position detail has a label', !!posDlg && posDlg.unnamed.length === 0, err || JSON.stringify(posDlg && posDlg.unnamed));
    ok('cleanup B-5: no value ticks flash while the demo Overview starts', Array.isArray(startTicks) && startTicks.length === 0, err || JSON.stringify(startTicks));
    { const one = (r, pick) => !!r && !r.error && r.looks.length === 1 && r.looks[0] === pick && r.pressed.length === 1 && r.pressed[0] === pick;
      ok('cleanup B-2: Discovery shows one selected tab after picking Dividends', one(pills && pills.discovery, 'Dividends'), err || JSON.stringify(pills && pills.discovery));
      ok('cleanup B-2: the benchmark selector shows one selected benchmark after picking FTSE All-World', one(pills && pills.bench, 'FTSE All-World'), err || JSON.stringify(pills && pills.bench));
      ok('cleanup V-2: the selected option reads at WCAG AA (Discovery, benchmarks)', !!pills && pills.discovery.contrast >= 4.5 && pills.bench.contrast >= 4.5, err || JSON.stringify([pills && pills.discovery.contrast, pills && pills.bench.contrast]));
      ok('cleanup V-3: every Overview KPI figure stays on one line', !!pills && Array.isArray(pills.kpi) && pills.kpi.length >= 4 && pills.kpi.every((k) => k.lines === 1), err || JSON.stringify(pills && pills.kpi)); }
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
      await page.locator('nav.ui-rail').waitFor({ timeout: 30000 });
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
      await page.locator('nav.ui-rail').waitFor({ timeout: 30000 });
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
      await openView(page, 'investment-analysis');
      await page.waitForTimeout(800);
      // R2.2 (B-3): on a phone the Strategy sections are one select
      const sel = page.locator('main [data-testid="iv-sections"] select');
      const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent.trim()]));
      sections = opts.length;
      for (let i = 0; i < sections; i++) {
        const label = opts[i][1];
        await sel.selectOption(opts[i][0]);
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
      await page.locator('main [data-tx-id][aria-label^="Transfer out"]').first().click();
      await page.locator('[data-testid="tx-detail"] [data-tx-action="trash"]').click();
      await page.locator('[aria-labelledby="dlg-confirm"]').getByRole('button', { name: 'Delete', exact: true }).click();
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

  // P5-3.11: a P2P loan added from its template in Net Worth (principal,
  // rate, term -> value, monthly interest income, maturity)
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
      localStorage.setItem('transactions', JSON.stringify([]));
    });
    await page.waitForTimeout(1500);
    let asset = null, row = '', err = '', refused = '';
    try {
      await unlock(page, base);
      await page.keyboard.press('Escape');
      await openView(page, 'net-worth');
      await page.getByRole('button', { name: /Add Asset/ }).first().click();
      await page.locator('[data-testid="ra-template"]').selectOption('p2p_loan');
      await page.locator('[data-testid="ra-add"]').click();
      refused = await page.getByText('Fill in the name and the fields marked *.').count().then(String);
      await page.locator('[data-testid="ra-f-name"]').fill('Loan book');
      await page.locator('[data-testid="ra-f-platform"]').fill('Platform X');
      await page.locator('[data-testid="ra-f-principal"]').fill('5.000');
      await page.locator('[data-testid="ra-f-ratePct"]').fill('7,5');
      await page.locator('[data-testid="ra-f-startDate"]').fill('2026-01-01');
      await page.locator('[data-testid="ra-f-termMonths"]').fill('36');
      await page.locator('[data-testid="ra-add"]').click();
      await page.waitForTimeout(500);
      asset = await page.evaluate(() => (JSON.parse(localStorage.getItem('maermin_real_assets') || '{}').assets || [])[0] || null);
      row = (await page.getByText('Loan book').first().locator('xpath=../../..').innerText().catch(() => '')).replace(/\n/g, ' | ');
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('P5-3.11: the template refuses an empty form', refused === '1', err || refused);
    ok('P5-3.11: the P2P loan is stored with its kind, value, income and details',
      !!asset && asset.kind === 'p2p_loan' && asset.valuations[0].value === 5000 && asset.cashflows[0].type === 'interest_income' && asset.cashflows[0].amount === 31.25
      && asset.details.platform === 'Platform X' && asset.details.maturity === '2029-01-01', err || JSON.stringify(asset));
    ok('P5-3.11: the row shows P2P loans, a 7.5 % yield and 5,000.00', /P2P loans/.test(row) && /7\.5\s?%/.test(row) && /5,000\.00/.test(row), err || row);
    ok('no page errors in the asset-template session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // P5-3.10: a merger recorded in the position dialog moves the lots to the
  // new symbol (ratio, cost and dates kept) and books the cash part
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
      localStorage.setItem('transactions', JSON.stringify([
        { id: 'm1', type: 'buy', category: 'stocks', symbol: 'OLDCO', symbolName: 'Old Co', quantity: 100, price: 20, fees: 0, currency: 'EUR', date: '2024-03-01', portfolioId: 'default' }]));
    });
    await page.waitForTimeout(1500);
    let rows = '', stored = null, err = '', pos = '', listed = 0;
    try {
      await unlock(page, base);
      await page.keyboard.press('Escape');
      await openView(page, 'overview');
      await page.locator('tr[aria-label="Old Co details"]').first().click();
      const dlg = page.locator('[aria-labelledby="dlg-position"]');
      await dlg.waitFor({ timeout: 5000 });
      const ce = dlg.locator('[data-testid="ce-panel"]');
      await ce.locator('[data-testid="ce-kind"]').selectOption('merger');
      await ce.locator('[data-testid="ce-date"]').fill('2025-06-02');
      await ce.locator('[data-testid="ce-newSymbol"]').fill('newco');
      await ce.locator('[data-testid="ce-newName"]').fill('New Co');
      await ce.locator('[data-testid="ce-num"]').fill('3');
      await ce.locator('[data-testid="ce-den"]').fill('2');
      await ce.locator('[data-testid="ce-cash"]').fill('1,50');
      await ce.locator('[data-testid="ce-add"]').click();
      listed = await ce.locator('[data-testid="ce-row"]').count();
      rows = (await ce.innerText()).replace(/\n/g, ' | ');
      stored = await page.evaluate(() => JSON.parse(localStorage.getItem('maermin_corporate_events') || '{}'));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      pos = (await page.locator('tr[aria-label="New Co details"]').first().innerText().catch(() => '')).replace(/\n/g, ' | ');
    } catch (e) { err = e.message.split('\n')[0]; }
    const ev = stored && stored.events && stored.events[0];
    ok('P5-3.10: the merger is listed in the position dialog', listed === 1 && /OLDCO -> NEWCO: 3 new for 2 old/.test(rows) && /1\.5 cash per old share/.test(rows), err || rows);
    ok('P5-3.10: stored in maermin_corporate_events (ratio, German "1,50" cash)', !!ev && ev.kind === 'merger' && ev.newSymbol === 'NEWCO' && ev.num === 3 && ev.den === 2 && ev.cashPerShare === 1.5, err || JSON.stringify(stored));
    ok('P5-3.10: the Overview shows 150 New Co at the old cost (2,000.00)', /150/.test(pos) && /2,000\.00/.test(pos), err || pos);
    const income = await page.evaluate(() => {
      const t = window.MaerminCorporateActions.adjust(JSON.parse(localStorage.getItem('transactions') || '[]'));
      return t.filter((x) => x.source === 'corporate-action').map((x) => x.type + ' ' + x.symbol + ' ' + x.quantity * x.price).join();
    }).catch(() => '');
    ok('P5-3.10: the cash part is a dividend of the new symbol (100 x 1.50)', income === 'dividend NEWCO 150', income);
    ok('no page errors in the corporate-actions session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // P5-3.9: a bond bought in the dialog (nominal, price in %, terms, accrued
  // interest), its coupon booked on its date, the manual price in the panel
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
      localStorage.setItem('transactions', JSON.stringify([]));
    });
    await page.waitForTimeout(1500);
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]'));
    const dlg = page.locator('[aria-labelledby="dlg-transaction"]');
    let accrued = '', buy = null, coupon = null, terms = null, panel = '', priced = null, err = '';
    try {
      await unlock(page, base);
      await page.keyboard.press('Escape');
      await openView(page, 'transactions');
      await page.getByRole('button', { name: /Add Transaction/ }).first().click();
      await dlg.waitFor({ timeout: 5000 });
      await dlg.getByRole('button', { name: 'Bonds', exact: true }).click();
      await dlg.locator('input[aria-label="Symbol"]').fill('DE0001102499');
      await dlg.locator('#tx-quantity').fill('10000');
      await dlg.locator('#tx-price').fill('98.5');
      await dlg.locator('#tx-date').fill('2026-03-01');
      await dlg.locator('[data-testid="bond-coupon"]').fill('2');
      await dlg.locator('[data-testid="bond-maturity"]').fill('2030-06-15');
      await dlg.locator('[data-testid="bond-propose"]').click();
      accrued = await dlg.locator('[data-testid="bond-accrued"]').inputValue();
      await dlg.locator('[data-tx-save]').click();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('transactions') || '[]').some((x) => x.source === 'bond-coupon'), null, { timeout: 8000 });
      const all = await stored();
      buy = all.find((x) => x.type === 'buy' && x.category === 'bonds');
      coupon = all.find((x) => x.source === 'bond-coupon' && x.date === '2026-06-15');
      terms = await page.evaluate(() => JSON.parse(localStorage.getItem('maermin_bonds') || '{}'));
      await openView(page, 'overview');
      const p = page.locator('[data-testid="bonds-panel"]');
      await p.waitFor({ timeout: 8000 });
      await p.locator('[data-testid="bond-price"]').fill('101');
      await p.locator('[data-testid="bond-price"]').press('Tab');
      await page.waitForTimeout(400);
      panel = (await p.innerText()).replace(/\n/g, ' | ');
      priced = await page.evaluate(() => JSON.parse(localStorage.getItem('maermin_bonds') || '{}'));
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('P5-3.9: the dialog proposes the accrued interest (10,000 nominal, 2 %, 259 days = 141.92)', accrued === '141.92', err || accrued);
    ok('P5-3.9: the buy stores nominal, price as a fraction of it and the accrued interest',
      !!buy && buy.quantity === 10000 && Math.abs(buy.price - 0.985) < 1e-12 && buy.accruedInterest === 141.92 && buy.symbol === 'DE0001102499', err || JSON.stringify(buy));
    ok('P5-3.9: the terms typed in the dialog are stored', !!(terms.bonds && terms.bonds.DE0001102499 && terms.bonds.DE0001102499.coupon === 2 && terms.bonds.DE0001102499.maturity === '2030-06-15'), err || JSON.stringify(terms));
    ok('P5-3.9: the coupon of 15 June 2026 is booked as interest (200)', !!coupon && coupon.type === 'interest' && coupon.amount === 200, err || JSON.stringify(coupon));
    ok('P5-3.9: the Bonds panel lists the bond and keeps the manual price', /DE0001102499/.test(panel) && /10,000/.test(panel) && priced.bonds && priced.bonds.DE0001102499.price === 101, err || panel);
    ok('no page errors in the bonds session', errors.length === 0, errors.join(' | '));
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
      // P5-2.8: 3,000 EUR on a savings account, 24,000 EUR expenses a year = 1.5 months
      localStorage.setItem('maermin_networth_accounts', JSON.stringify([{ id: 'nw1', name: 'Tagesgeld', type: 'cash', value: 3000, currency: 'EUR' }]));
      localStorage.setItem('maermin_fire_settings', JSON.stringify({ annualExpenses: 24000, withdrawalRate: 4 }));
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
    // P5-2.9: real TWR = (1 + TWR) / (1 + inflation since the first trade) - 1, inflation from the Worker's HICP
    { const inf = page.locator('[data-testid="inflation-card"][data-state="ready"]');
      await inf.waitFor({ timeout: 15000 }).catch(() => {});
      const infV = parseFloat(await inf.getAttribute('data-v').catch(() => 'NaN'));
      const realT = parseFloat(await page.locator('[data-testid="twr-card"]').getAttribute('data-real').catch(() => 'NaN'));
      const today = await page.evaluate(() => window.MaerminUtils.todayISO());
      const wantInf = hicpAt(today) / hicpAt(WEEKDAYS[0]) - 1;
      const wantReal = (1 + expected / 100) / (1 + wantInf) - 1;
      const txt = await inf.innerText().catch(() => '');
      ok('P5-2.9: inflation since the first trade from the Worker\'s HICP (' + (wantInf * 100).toFixed(2) + ' %), real TWR ' + (wantReal * 100).toFixed(2) + ' %',
        Math.abs(infV - wantInf) < 1e-9 && Math.abs(realT - wantReal) < 1e-9 && /Eurostat HICP up to/.test(txt) && workerState.requests.some((r) => /action=hicp&geo=EA/.test(r)),
        infV + ' vs ' + wantInf + ' | ' + realT + ' vs ' + wantReal + ' | ' + txt.replace(/\n/g, ' ').slice(-120)); }
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
      await page.getByRole('radio', { name: /^History$/ }).first().click().catch(() => {});
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
    // P5-2.7: Cash Flow - the first month bought both holdings; two single months make no streak longer than 1
    { await openView(page, 'cashflow');
      const it = page.locator('[data-testid="invest-timeline"]');
      await it.waitFor({ timeout: 10000 }).catch(() => {});
      const ym = WEEKDAYS[0].slice(0, 7), ymMid = WEEKDAYS[mid].slice(0, 7);
      const cell = parseFloat(await it.locator('button[data-ym="' + ym + '"]').getAttribute('data-buys').catch(() => 'NaN'));
      const want0 = 10 * closeOf('VWCE.DE', 0) + 5 * closeOf('AAPL', 0) * 0.9;
      const longest = await it.locator('[data-stat="longest"]').innerText().catch(() => '');
      const ratio = await it.locator('[data-stat="ratio"]').innerText().catch(() => '');
      const months = new Set(WEEKDAYS.map((d) => d.slice(0, 7))).size;
      const buyMonths = ym === ymMid ? 1 : 2;
      await it.locator('button[data-ym="' + ymMid + '"]').click().catch(() => {});
      const det = await it.locator('[data-testid="it-detail"]').innerText().catch(() => '');
      ok('P5-2.7: investment calendar: ' + ym + ' bought ' + want0.toFixed(2) + ' EUR; longest streak 1 month; ' + buyMonths + ' of ' + months + ' months with a buy; a month opens its amounts',
        Math.abs(cell - want0) < 1e-6 && /\b1 month\b/.test(longest) && ratio.includes(buyMonths + ' / ' + months) && /bought .*sold .*net/.test(det),
        cell + ' vs ' + want0 + ' | ' + longest.replace(/\n/g, ' ') + ' | ' + ratio.replace(/\n/g, ' ') + ' | ' + det);
      await openView(page, 'returns'); }
    // P5-2.10: a taxonomy in a real vault: both holdings are equity; the assignment is not stored in plain text
    { await openView(page, 'investment-analysis');
      await page.getByRole('radio', { name: /^Taxonomies$/ }).first().click().catch(() => {});
      await page.locator('[data-testid="tx-template"]').selectOption('asset-classes').catch(() => {});
      await page.locator('[data-testid="tx-create"]').click().catch(() => {});
      await page.locator('[data-testid="tx-fill"]').click().catch(() => {});
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => {
        const row = (id) => document.querySelector('[data-testid="tx-tree"] tr[data-node="' + id + '"]');
        const raw = Object.keys(localStorage).map((k) => localStorage.getItem(k) || '').join('|');
        return { eq: parseFloat(row('equity') ? row('equity').getAttribute('data-pct') : 'NaN'), un: parseFloat(row('unassigned') ? row('unassigned').getAttribute('data-v') : 'NaN'),
          plain: /maermin-taxonomy|"assign":\{"(VWCE|AAPL)/.test(raw) || /"VWCE\.DE":"equity"/.test(raw) };
      });
      ok('P5-2.10: asset classes filled from data: everything is equity, nothing left; the vault keeps it encrypted', Math.abs(r.eq - 100) < 1e-9 && r.un === 0 && r.plain === false, JSON.stringify(r)); }
    // P5-2.8: Intelligence - 3,000 EUR cash against 2,000 EUR a month = 1.5 months, important
    { await openView(page, 'intelligence');
      await page.waitForTimeout(1200);
      const pi = await page.locator('main').innerText().catch(() => '');
      ok('P5-2.8: emergency fund check: 1.5 months of expenses, flagged important', /Your cash covers 1\.5 months of expenses/.test(pi) && /Emergency fund/i.test(pi), (pi.match(/[^\n]*months of expenses[^\n]*/) || [pi.slice(0, 160)])[0]);
      await openView(page, 'returns'); }
    ok('closes came through the Worker route ?action=yf (5-year range for both holdings)', ['VWCE.DE', 'AAPL'].every((x) => workerState.requests.includes('/?action=yf&symbol=' + x + '&interval=1d&range=5y')), workerState.requests.join(' '));
    await page.waitForTimeout(2500); // benchmark fetch
    { const rb = await page.innerText('body'); ok('benchmark comparison is computed from daily returns', /Alpha \(ann\.\)/i.test(rb) && /daily returns since/.test(rb), (rb.match(/Benchmark comparison[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' | ')); }
    // P5-1.6: one plain sentence above the benchmark tiles
    { const v = await page.locator('[data-testid="verdict-benchmark"]').innerText().catch(() => '');
      ok('P5-1.6: benchmark verdict in plain words', /Over this period your portfolio (did [\d.]+ percentage points (better|worse) than|moved roughly in line with)/.test(v), v); }

    await openView(page, 'analytics');
    await page.waitForTimeout(800);
    ok('correlation matrix is there right away, from daily closes', (await page.locator('[data-testid="correlation-source"][data-source="daily"]').count()) === 1 && (await page.locator('[data-testid="correlation-empty"]').count()) === 0);
    await page.getByRole('radio', { name: 'Risk Level' }).click();
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
    // P5-3.4: bank sync over FinTS - the browser builds the messages, the real
    // Worker relays them to the synthetic bank; pushTAN is confirmed "in the app"
    {
      let err = '', methods = '', bal = '', depot = '', booked = null, stored = '', listed = 0;
      try {
        await unlock(page, base);
        await openView(page, 'data');
        await page.getByRole('radio', { name: /Broker Import/ }).click();
        const panel = page.locator('[data-testid="bank-sync"]');
        await panel.waitFor({ timeout: 8000 });
        await page.locator('[data-testid="bs-bank"] option[value="dkb"]').waitFor({ state: 'attached', timeout: 8000 });
        listed = await page.locator('[data-testid="bs-bank"] option').count();
        await page.locator('[data-testid="bs-bank"]').selectOption('dkb');
        await page.locator('[data-testid="bs-blz"]').fill('12030000');
        await page.locator('[data-testid="bs-add"]').click();
        await page.locator('[data-testid="bs-sync"]').click();
        await page.locator('[data-testid="bs-connection"] input[aria-label="Login name"]').fill('demo-user');
        await page.locator('[data-testid="bs-pin"]').fill('4711');
        await page.locator('[data-testid="bs-start"]').click();
        await page.locator('[data-testid="bs-method"]').first().waitFor({ timeout: 10000 });
        methods = (await page.locator('[data-testid="bs-method"]').allInnerTexts()).join('|');
        await page.locator('[data-testid="bs-method"]', { hasText: 'pushTAN' }).click();
        await page.locator('[data-testid="bs-balance"]').first().waitFor({ timeout: 30000 });
        bal = await page.locator('[data-testid="bs-balance"]').first().innerText();
        depot = await page.locator('[data-testid="bs-depot"]').innerText();
        await page.locator('[data-testid="bs-import-tick"]').check();
        await page.locator('[data-testid="bs-import"]').click();
        await page.waitForTimeout(800);
        booked = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').filter((x) => x.source === 'fints').map((x) => x.type).join(','));
        stored = await page.evaluate(() => localStorage.getItem('maermin_bank_sync') || '');
      } catch (e) { err = String(e.message).split('\n')[0]; }
      ok('P5-3.4: bank list from the Worker, the TAN methods the bank offers', listed >= 9 && /pushTAN 2\.0/.test(methods) && /SMS-TAN/.test(methods), err || listed + ' ' + methods);
      ok('P5-3.4: pushTAN confirmed in the app -> balance 2,420.10 EUR', /2,420\.10 EUR/.test(bal), err || bal);
      ok('P5-3.4: depot statement compared with MAERMIN', /not in MAERMIN/.test(depot) && /DE0005933931/.test(depot), err || depot);
      ok('P5-3.4: the four bank transactions booked as cash rows', booked === 'withdrawal,deposit,fee,tax', err || booked);
      ok('P5-3.4: the stored connection holds no PIN, no transactions and no login name', !!stored && stored.indexOf('4711') < 0 && stored.indexOf('Miete') < 0 && /"login":""/.test(stored), err || stored.slice(0, 200));
    }
    // P5-3.5: GoCardless and SnapTrade with the user's own keys, through the
    // real Worker relay to synthetic upstreams; links open in a new tab (stubbed)
    {
      let err = '', gcBal = '', gcBooked = '', stText = '', stBooked = '', opened = [], rawGc = '', rawSt = '', meta = '';
      try {
        await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
        const panel = page.locator('[data-testid="aggregators"]');
        await panel.waitFor({ timeout: 8000 });
        await page.locator('[data-testid="ag-gc-id"]').fill('sid-123');
        await page.locator('[data-testid="ag-gc-key"]').fill('skey-456');
        await page.locator('[data-testid="ag-gc-save"]').click();
        await page.locator('[data-testid="ag-gc-banks"]').click();
        await page.locator('[data-testid="ag-gc-search"]').fill('DKB');
        await page.locator('[data-testid="ag-gc-inst"]', { hasText: 'DKB' }).click();
        await page.locator('[data-testid="ag-gc-sync"]').click();
        await page.locator('[data-testid="ag-gc-balance"]').first().waitFor({ timeout: 15000 });
        gcBal = await page.locator('[data-testid="ag-gc-balance"]').first().innerText();
        await page.locator('[data-testid="ag-gc-tick"]').check();
        await page.locator('[data-testid="ag-gc-import"]').click();
        await page.locator('[data-testid="ag-st-client"]').fill('MAERMIN-TEST');
        await page.locator('[data-testid="ag-st-key"]').fill('ck-secret-789');
        await page.locator('[data-testid="ag-st-save"]').click();
        await page.locator('[data-testid="ag-st-connect"]').click();
        await page.waitForFunction(() => window.__opened.length >= 2, null, { timeout: 15000 });
        await page.locator('[data-testid="ag-st-sync"]').click();
        await page.locator('[data-testid="ag-st-positions"]').waitFor({ timeout: 15000 });
        stText = await page.locator('[data-testid="ag-snaptrade"]').innerText();
        await page.locator('[data-testid="ag-st-import"]').click();
        await page.waitForTimeout(800);
        const res = await page.evaluate(() => {
          const txs = JSON.parse(localStorage.getItem('transactions') || '[]');
          return { gc: txs.filter((x) => x.source === 'gocardless').map((x) => x.type).join(), st: txs.filter((x) => x.source === 'snaptrade').map((x) => x.type).join(),
            opened: window.__opened, meta: localStorage.getItem('maermin_aggregators') || '' };
        });
        res.rawGc = (await page.evaluate(RAW + ".get('maermin_agg_cred_gocardless')")) || '';
        res.rawSt = (await page.evaluate(RAW + ".get('maermin_agg_cred_snaptrade')")) || '';
        gcBooked = res.gc; stBooked = res.st; opened = res.opened; rawGc = res.rawGc; rawSt = res.rawSt; meta = res.meta;
      } catch (e) { err = String(e.message).split('\n')[0]; }
      ok('P5-3.5: GoCardless - bank link opened, balance 1,500.00 EUR after the sync', /ob\.gocardless\.com/.test(opened[0] || '') && /1,500\.00 EUR/.test(gcBal), err || JSON.stringify({ opened, gcBal }));
      ok('P5-3.5: GoCardless - rent, salary and account fee booked; the securities purchase left out', gcBooked === 'withdrawal,deposit,fee', err || gcBooked);
      ok('P5-3.5: SnapTrade - read-only portal opened, positions compared, activities imported once', /snaptrade\.com/.test(opened[1] || '') && /AAPL/.test(stText) && /not in MAERMIN|matches/.test(stText) && stBooked === 'buy,dividend,deposit,fee,sell', err || JSON.stringify({ stBooked, stText: stText.slice(0, 200) }));
      ok('P5-3.5: the API keys are vault-encrypted at rest, the metadata holds none', !!rawGc && rawGc.indexOf('skey-456') < 0 && !!rawSt && rawSt.indexOf('ck-secret-789') < 0 && rawSt.indexOf('user-secret-1') < 0 && meta.indexOf('skey') < 0 && meta.indexOf('ACCESS') < 0, err || meta.slice(0, 200));
    }
    // P5-3.6: watch public addresses (Bitcoin, Ethereum) through the real
    // Worker and synthetic explorers; balances compared, nothing booked
    {
      let err = '', natives = '', tokens = '', cmp = '', invalid = '', stored = '', before = 0, after = 0;
      try {
        const panel = page.locator('[data-testid="wallets"]');
        await panel.waitFor({ timeout: 8000 });
        before = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').length);
        await page.locator('[data-testid="wl-chain"]').selectOption('eth');
        await page.locator('[data-testid="wl-address"]').fill('bc1qnotanethaddress');
        await page.locator('[data-testid="wl-add"]').click();
        invalid = await page.locator('[data-testid="wl-msg"]').innerText();
        await page.locator('[data-testid="wl-chain"]').selectOption('btc');
        await page.locator('[data-testid="wl-address"]').fill(walletSim.BTC);
        await page.locator('[data-testid="wl-add"]').click();
        await page.locator('[data-testid="wl-native"]').first().waitFor({ timeout: 15000 });
        await page.locator('[data-testid="wl-chain"]').selectOption('eth');
        await page.locator('[data-testid="wl-address"]').fill(walletSim.EVM);
        await page.locator('[data-testid="wl-add"]').click();
        await page.locator('[data-testid="wl-native"]').nth(1).waitFor({ timeout: 15000 });
        natives = (await page.locator('[data-testid="wl-native"]').allInnerTexts()).join('|');
        tokens = await page.locator('[data-testid="wl-tokens"]').innerText();
        cmp = await page.locator('[data-testid="wl-compare"]').innerText();
        after = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').length);
        stored = await page.evaluate(() => localStorage.getItem('maermin_wallets') || '');
      } catch (e) { err = String(e.message).split('\n')[0]; }
      ok('P5-3.6: a Bitcoin address on Ethereum is refused', /not a valid Ethereum address/.test(invalid), err || invalid);
      ok('P5-3.6: balances 1 BTC and 1.5 ETH, USDC 2,500 as a token', /^1 BTC\|1\.5 ETH$/.test(natives) && /2,500 USDC/.test(tokens), err || natives + ' / ' + tokens);
      ok('P5-3.6: all wallets compared with MAERMIN, nothing booked', /BTC/.test(cmp) && /not in MAERMIN/.test(cmp) && after === before, err || cmp.replace(/\n/g, ' | ') + ' ' + before + '->' + after);
      ok('P5-3.6: the stored list holds balances, no transactions', /"address":"bc1q/.test(stored) && stored.indexOf('"txs"') < 0, err || stored.slice(0, 160));
    }
    // P5-3.8: a Bitvavo connection (signed in the browser, relayed by the real
    // Worker to the synthetic exchange); KuCoin asks for a passphrase
    {
      let err = '', pass = 0, booked = '', msg = '';
      try {
        await page.locator('[data-testid="ex-exchange"]').selectOption('kucoin');
        pass = await page.locator('[data-testid="ex-passphrase"]').count();
        await page.locator('[data-testid="ex-exchange"]').selectOption('bitvavo');
        await page.getByPlaceholder('API key (read-only)').fill(exchangeSim.KEYS.apiKey);
        await page.getByPlaceholder('API secret').fill(exchangeSim.KEYS.apiSecret);
        await page.getByRole('button', { name: 'Add connection' }).click();
        await page.getByRole('button', { name: 'Sync now' }).first().click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('transactions') || '[]').some((x) => x.exchange === 'bitvavo'), null, { timeout: 15000 });
        booked = await page.evaluate(() => JSON.parse(localStorage.getItem('transactions') || '[]').filter((x) => x.exchange === 'bitvavo').map((x) => x.type + ' ' + x.quantity + ' ' + x.symbol + ' @' + x.price + ' ' + x.currency + ' fee ' + x.fees).join());
      } catch (e) { err = String(e.message).split('\n')[0]; }
      ok('P5-3.8: KuCoin asks for the API passphrase', pass === 1, err || String(pass));
      ok('P5-3.8: Bitvavo sync imports the trade (0.5 BTC at 60,000 EUR, fee 15)', booked === 'buy 0.5 BTC @60000 EUR fee 15', err || booked);
      ok('P5-3.8: every request carried a valid signature', exchangeSim.state.badSig === 0, String(exchangeSim.state.badSig));
    }
    // P5-3.7: the Transactions view compares what the sources reported (the
    // FinTS bank and depot, the wallets above) with MAERMIN, and the Data check
    // lists the differences with stable codes and actions
    {
      let err = '', box = '', codes = [], depotLine = '', linkStatus = '', went = '';
      try {
        await openView(page, 'transactions');
        const rc = page.locator('[data-testid="reconcile"]');
        await rc.waitFor({ timeout: 10000 });
        box = await rc.innerText();
        depotLine = await page.locator('[data-testid="rc-depot"]').first().innerText();
        await page.locator('[data-testid="rc-link"]').first().selectOption('default');
        await page.waitForTimeout(300);
        linkStatus = await page.locator('[data-testid="rc-cash"] tbody tr').first().getAttribute('data-status');
        codes = await page.locator('[data-testid="ledger-issues"] [data-dq-code]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dq-code')));
        await page.locator('[data-testid="ledger-issues"] summary').click();
        await page.locator('[data-testid="ledger-issues"] [data-dq-code="DQ-RECON-DIFF"] [data-dq-action="open-reconcile"]').first().click();
        await page.waitForTimeout(600);
        went = await page.evaluate(() => { const r = document.querySelector('[data-testid="reconcile"]'); return r ? String(Math.round(r.getBoundingClientRect().top)) : 'none'; });
      } catch (e) { err = String(e.message).split('\n')[0]; }
      ok('P5-3.7: the reconciliation box shows the bank account, the depot (0 of 2 match) and the wallets', /Reconciliation: reported vs MAERMIN/.test(box) && /DE02120300000000202051/.test(depotLine + box) && /0 of 2 positions match/.test(depotLine) && /Crypto wallets: 0 of \d+ coins match/.test(box), err || box.replace(/\n/g, ' | ').slice(0, 300));
      ok('P5-3.7: a linked portfolio without a clearing account is said, not compared', linkStatus === 'nocash' || linkStatus === 'differs' || linkStatus === 'match', err || String(linkStatus));
      ok('P5-3.7: the Data check lists DQ-RECON-DIFF for depot and wallets; its action shows the comparison', codes.filter((c) => c === 'DQ-RECON-DIFF').length >= 2 && went !== 'none' && Math.abs(Number(went)) < 400, err || JSON.stringify({ codes, went }));
    }
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
        // cleanup B-1: the by-hand update pastes the one-file Worker; worker.js
        // alone imports its sibling files and cannot start in the dashboard editor.
        const fileLink = await page.locator('[data-testid="api-worker-file"]').first().innerText().catch(() => '');
        const copied = await page.evaluate(() => window.MaerminOnboarding.fetchWorkerSource()
          .then((src) => ({ single: window.MaerminOnboarding.isSingleFile(src), version: (/WORKER_VERSION = ["']([\d.]+)/.exec(src) || [])[1] || '' }))
          .catch((e) => ({ error: String(e && e.message) })));
        ok('cleanup B-1: update steps name worker.single.js and the copy source is one file of this version', fileLink === 'cf-worker/worker.single.js' && copied.single === true && copied.version === workerMod.WORKER_VERSION, fileLink + ' ' + JSON.stringify(copied));
        await page.keyboard.press('Escape');
      }
    }
    workerState.oldVersion = false;
    // P5-5.4: Research page (this session talks to the real Worker code). Key
    // figures, analysts and EPS come through the research route, the chart
    // through yf; MACD can be switched on.
    {
      let text = '', macd = false, err = '';
      workerState.ip = '203.0.113.54';
      try {
        await openView(page, 'research');
        await page.locator('[data-testid="rs-symbol"]').fill('AAPL');
        await page.locator('[data-testid="rs-go"]').click();
        await page.locator('[data-testid="rs-analysts"]').waitFor({ timeout: 15000 });
        await page.locator('[data-testid="rs-chart"]').waitFor({ timeout: 15000 });
        await page.locator('[data-testid="rs-ind-macd"]').click();
        macd = (await page.locator('[data-testid="rs-macd"]').count()) === 1;
        text = await page.locator('[data-testid="research-view"]').innerText();
      } catch (e) {
        err = e.message.split('\n')[0] + ' | worker: ' + workerState.requests.filter((r) => /research|symbol=AAPL/.test(r)).join(', ');
        err += ' | view: ' + (await page.locator('[data-testid="research-view"]').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      }
      workerState.ip = null;
      ok('P5-5.4: the research page shows key figures, analysts (10, mean target +20 %), EPS and the profile; MACD switches on', !err && /AAPL Sample Corp/.test(text) && /10 analysts/.test(text) && /\+20\.0 %/.test(text) && /beat/.test(text) && /Synthetic company/.test(text) && macd, err || text.replace(/\n/g, ' | ').slice(0, 400));
    }
    // P5-5.5: the event feed lists AAPL's earnings and ex-date (Worker earnings
    // route); the type chips filter; the ICS file has the events but no amounts.
    {
      let rows = [], afterFilter = [], ics = '', err = '';
      workerState.ip = '203.0.113.55';
      try {
        await openView(page, 'events');
        await page.locator('[data-testid="evf-row"][data-kind="exdiv"]').first().waitFor({ timeout: 30000 });
        rows = await page.locator('[data-testid="evf-row"]').allInnerTexts();
        await page.locator('[data-testid="evf-kind-earnings"]').click();
        afterFilter = await page.locator('[data-testid="evf-row"][data-kind="earnings"]').allInnerTexts();
        await page.locator('[data-testid="evf-kind-earnings"]').click();
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.locator('[data-testid="evf-ics"]').click()]);
        const p = await dl.path();
        ics = p ? (await import('node:fs')).readFileSync(p, 'utf8') : '';
      } catch (e) { err = e.message.split('\n')[0]; }
      workerState.ip = null;
      const all = rows.join(' | ');
      ok('P5-5.5: the event feed shows AAPL earnings, ex-date and payment from the Worker', !err && /AAPL earnings/.test(all) && /AAPL ex-dividend/.test(all) && /AAPL dividend payment/.test(all), err || all.slice(0, 400));
      ok('P5-5.5: switching a type off hides its rows', !err && afterFilter.length === 0, afterFilter);
      ok('P5-5.5: the ICS export has the events (RFC 5545) and leaves amounts out by default', /^BEGIN:VCALENDAR\r\n/.test(ics) && /SUMMARY:AAPL earnings/.test(ics) && /DTSTART;VALUE=DATE:\d{8}/.test(ics) && !/Consensus EPS/.test(ics) && /END:VCALENDAR\r\n$/.test(ics), ics.slice(0, 300));
    }
    // P5-5.6: sync through a WebDAV folder (an in-memory server with CORS) on a
    // host the site's security policy allows (*.workers.dev). The copy there is
    // a MAERMIN sync record - ciphertext and a MAC; a copy changed without the
    // vault key is refused and not overwritten. A host the policy does not name
    // gets its own message.
    {
      const DAV = 'https://dav-e2e.workers.dev/remote.php/dav/files/e2e/MAERMIN', FILE = DAV + '/maermin-sync.json';
      const dav = { files: {}, n: 0, puts: 0 };
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS' };
      const login = 'Basic ' + Buffer.from('e2e:app-pass-77').toString('base64');
      await page.route('https://dav-e2e.workers.dev/**', async (route) => {
        const rq = route.request(), m = rq.method(), u = rq.url(), h = rq.headers();
        if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if ((h.authorization || '') !== login) return route.fulfill({ status: 401, headers: cors });
        const cur = dav.files[u];
        if (m === 'GET') return cur ? route.fulfill({ status: 200, headers: Object.assign({ ETag: cur.etag, 'Content-Type': 'application/json' }, cors), body: cur.body }) : route.fulfill({ status: 404, headers: cors });
        if (m === 'PUT') {
          if (h['if-none-match'] === '*' && cur) return route.fulfill({ status: 412, headers: cors });
          if (h['if-match'] && (!cur || cur.etag !== h['if-match'])) return route.fulfill({ status: 412, headers: cors });
          dav.files[u] = { body: rq.postData(), etag: '"d' + (++dav.n) + '"' }; dav.puts++;
          return route.fulfill({ status: cur ? 204 : 201, headers: cors });
        }
        return route.fulfill({ status: 405, headers: cors });
      });
      let policy = false, rec = null, dest = '', refused = false, putsBefore = -1, putsAfter = -1, leaked = true, atRest = null, err = '';
      const connect = async (url) => {
        await page.locator('[data-testid="sync-dest-webdav"]').click();
        await page.locator('[data-testid="sync-webdav-url"]').fill(url);
        await page.locator('[data-testid="sync-webdav-user"]').fill('e2e');
        await page.locator('[data-testid="sync-webdav-pass"]').fill('app-pass-77');
        await page.locator('[data-testid="sync-webdav-connect"]').click();
      };
      try {
        await page.locator('.ui-settings-btn').click();
        await page.locator('.mx-menu-item', { hasText: 'Security & sync' }).click();
        await connect('https://dav.e2e.test/remote.php/dav/files/e2e/MAERMIN');
        await page.locator('[role="status"]', { hasText: 'security policy' }).waitFor({ timeout: 10000 });
        policy = true;
        await page.getByRole('button', { name: 'Stop syncing here' }).click();
        await connect(DAV);
        await page.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem('maermin_sync_state') || '{}').lastSyncAt || 0) > 0; } catch (e) { return false; } }, null, { timeout: 15000 });
        await page.locator('[data-testid="sync-dest-name"]').waitFor({ timeout: 5000 });
        dest = await page.locator('[data-testid="sync-dest-name"]').innerText();
        // the destination (server host, account name) is encrypted at rest: not among the plain keys, yet readable unlocked
        atRest = await page.evaluate(() => ({ plain: Object.keys(localStorage).indexOf('maermin_sync_config') !== -1, readable: /dav-e2e/.test(localStorage.getItem('maermin_sync_config') || '') }));
        rec = JSON.parse(dav.files[FILE].body);
        // ciphertext only: version + base64 parts. Plaintext JSON would carry quotes and braces; a symbol
        // name is no test, since random base64 can spell AAPL
        // someone without the key changes the copy: the next sync refuses it
        putsBefore = dav.puts;
        const j = JSON.parse(dav.files[FILE].body); j.blob = j.blob.slice(0, -6) + 'AAAAAA';
        dav.files[FILE] = { body: JSON.stringify(j), etag: '"x1"' };
        await page.getByRole('button', { name: 'Sync now' }).first().click();
        await page.locator('[role="status"]', { hasText: 'changed without your key' }).waitFor({ timeout: 10000 });
        refused = true; putsAfter = dav.puts;
        leaked = await page.evaluate(() => ['maermin_sync_config', 'maermin_sync_state', 'apiKeys'].some((k) => (localStorage.getItem(k) || '').indexOf('app-pass-77') >= 0));
        await page.getByRole('button', { name: 'Stop syncing here' }).click();
        await page.keyboard.press('Escape');
      } catch (e) { err = e.message.split('\n')[0]; }
      await page.unroute('https://dav-e2e.workers.dev/**');
      ok('P5-5.6: a WebDAV host the security policy does not name gets that message', policy, err);
      ok('P5-5.6: WebDAV sync uploads a MAERMIN sync record - ciphertext only, with a MAC', !err && rec && rec.format === 'maermin-sync' && rec.rev >= 1 && /^[0-9a-f]{64}$/.test(rec.mac) && /^[0-9]+(\.[A-Za-z0-9+/=]+)+$/.test(rec.blob) && /dav-e2e\.workers\.dev/.test(dest), err || JSON.stringify(rec || {}).slice(0, 200));
      ok('P5-5.6: a copy changed without the key is refused and not overwritten', !err && refused && putsAfter === putsBefore, err || putsBefore + ' -> ' + putsAfter);
      ok('P5-5.6: the app password is in no plain config key', !err && leaked === false, err);
      ok('hardening: the sync destination is encrypted at rest and readable while unlocked', !err && atRest && atRest.plain === false && atRest.readable === true, err || JSON.stringify(atRest));
    }
    // P5-5.7: a saving goal linked to the portfolio starts its glide path at
    // today's value: on track, the chart and the risk glide line are shown,
    // and the stored goal keeps its link and start.
    {
      let card = null, stored = null, err = '';
      try {
        await openView(page, 'investment-analysis');
        await page.getByRole('radio', { name: /^Goals$/ }).first().click();
        await page.getByRole('button', { name: '+ Add Goal' }).click();
        await page.locator('[data-testid="goal-name"]').fill('E2E house');
        await page.locator('[data-testid="goal-target"]').fill('500000');
        await page.locator('[data-testid="goal-link"]').selectOption('portfolio:default');
        await page.locator('[data-testid="goal-return"]').fill('4');
        await page.locator('[data-testid="goal-create"]').click();
        const c = page.locator('[data-testid="goal-card"]').last();
        await c.waitFor({ timeout: 8000 });
        card = { state: await c.getAttribute('data-state'), chart: await c.locator('[data-testid="goal-chart"]').count(), risk: await c.locator('[data-testid="goal-risk"]').innerText().catch(() => ''), text: await c.innerText() };
        stored = await page.evaluate(() => (JSON.parse(localStorage.getItem('investmentGoals') || '[]') || []).filter((g) => g.name === 'E2E house')[0] || null);
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('P5-5.7: a goal linked to the portfolio is on track on day one, with its glide path chart', !err && card && card.state === 'on-track' && card.chart === 1 && /Portfolio Main Portfolio/.test(card.text), err || JSON.stringify(card).slice(0, 300));
      ok('P5-5.7: the risk glide line compares the suggested and the actual share', !err && card && /90 ?%/.test(card.risk) && /100 ?%/.test(card.risk), err || (card && card.risk));
      ok('P5-5.7: the stored goal keeps the link, the start value and the return', !err && stored && stored.link && stored.link.type === 'portfolio' && stored.link.ids[0] === 'default' && stored.startValue > 0 && stored.expectedReturn === 0.04, err || JSON.stringify(stored));
    }
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
      // By code: the fixture has no quote for NESN.SW, so once its price probe
      // gives up a DQ-PRICE-STALE finding may be listed - that one is not about
      // the CHF conversion this check is for.
      const dq = await page.locator('[data-testid="ledger-issues"] [data-dq-code]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dq-code')));
      ok('Transactions list shows the CHF trade and the Data check has no entry for it', at !== -1 && dq.filter((c) => c !== 'DQ-PRICE-STALE').length === 0, JSON.stringify(dq) + ' ' + tb.slice(tb.indexOf('Quick access'), tb.indexOf('Quick access') + 500).replace(/\n/g, ' | ')); }
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
      // A date input takes three Tab stops (month, day, year) but counts as one
      // control, so each one needs two more presses.
      const dates = await page.evaluate((x) => Array.from(document.querySelectorAll('[role="dialog"] input[type="date"]')).filter((el) => el.getClientRects().length > 0).length, name);
      for (const key of ['Tab', 'Shift+Tab']) for (let i = 0; i < n + 2 + 2 * dates; i++) { await press(key); if (!(await page.evaluate((x) => window.__dlg.seen(x), name))) left++; }
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
    const avatar = page.locator('.ui-settings-btn');
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
    const search = page.locator('.ui-search');
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
    // P5-3.1: Security & sync explains where market data comes from; the shared price service can be switched off
    {
      let info = '', saved = null, err = '';
      try {
        await fromMenu('Security & sync')();
        const box = page.locator('[data-testid="shared-prices-info"]');
        await box.waitFor({ timeout: 5000 });
        info = await box.locator('xpath=..').innerText();
        const toggle = page.locator('[data-testid="shared-prices-toggle"]');
        if (await toggle.isChecked()) await toggle.click();
        saved = await page.evaluate(() => localStorage.getItem('maermin_shared_prices'));
        await page.locator('[data-testid="shared-prices-toggle"]').click();
        await press('Escape');
      } catch (e) { err = String(e.message).split('\n')[0]; }
      ok(tag + 'P5-3.1: Security & sync names the market-data source and what the shared price service sees; its switch is saved', !err && /never amounts, quantities or your vault/.test(info) && /Your Worker|None \(offline prices\)|MAERMIN price service/.test(info) && saved === 'off',
        err || info.replace(/\n/g, ' | ').slice(0, 200) + ' | ' + saved);
    }
    // P5-5.1: Security & sync offers push reminders, says they are encrypted on
    // the device, and names the opt-in price rules; the service worker shows pushes.
    {
      let text = '', swPush = false, err = '';
      try {
        await fromMenu('Security & sync')();
        const panel = page.locator('[data-testid="push-panel"]');
        await panel.waitFor({ timeout: 5000 });
        text = await panel.innerText();
        await press('Escape');
        swPush = await page.evaluate(() => fetch('service-worker.js').then((r) => r.text()).then((t) => /addEventListener\('push'/.test(t)).catch(() => false));
      } catch (e) { err = String(e.message).split('\n')[0]; }
      ok(tag + 'P5-5.1: Security & sync has push reminders, encrypted on the device; the service worker handles push', !err && /encrypted on this device/.test(text) && /Push notifications on this device/.test(text) && swPush,
        err || text.replace(/\n/g, ' | ').slice(0, 200) + ' | sw ' + swPush);
    }
    // R2.1 (B-2): the phone dock is Home · Activity · Add · Income · More; Tax,
    // Insight and Settings open from "More"; an area's views are page tabs.
    if (page.viewportSize().width < 768) {
      const bad = [];
      try {
        const slots = await page.locator('nav.ui-dock [data-area]').evaluateAll((els) => els.map((e) => e.dataset.area));
        if (slots.join() !== 'portfolio,transactions,add,dividends,more') bad.push('dock: ' + slots.join());
        await page.locator('nav.ui-dock [data-area="more"]').click();
        await page.locator('[data-testid="more-nav"] [data-area="analysis"]').click();
        await page.waitForTimeout(300);
        if (!(await page.locator('nav.ui-dock [data-area="more"][aria-current="true"]').count())) bad.push('More not current in Insight');
        if (await page.locator('nav.ui-dock [aria-current="page"]').count()) bad.push('dock slot says aria-current=page');
        const tabs = await page.locator('header.ui-pagehead [role="tab"]').evaluateAll((els) => els.map((e) => e.dataset.tab));
        if (tabs.join() !== 'grp-returns,grp-health') bad.push('page tabs: ' + tabs.join());
        // R2.2 (B-3): one row of page tabs; the merged page's own tabs are a segmented control
        if ((await page.locator('[role="tablist"]').count()) !== 1 || !(await page.locator('main .mx-area-tabs[role="radiogroup"]').count())) bad.push('B-3: tab rows ' + (await page.locator('[role="tablist"]').count()));
        await page.locator('header.ui-pagehead [data-tab="grp-health"]').click();
        await page.waitForTimeout(300);
        if (!(await page.locator('header.ui-pagehead [data-tab="grp-health"][aria-selected="true"]').count())) bad.push('health tab not selected');
        await page.locator('nav.ui-dock [data-area="add"]').click();
        await page.waitForTimeout(300);
        if (!(await page.getByRole('dialog', { name: /Add Transaction/ }).count())) bad.push('Add does not open the transaction dialog');
        await press('Escape');
        await page.waitForTimeout(300);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) bad.push('page scrolls sideways by ' + overflow + 'px');
      } catch (e) { bad.push(String(e.message).split('\n')[0]); }
      ok(tag + 'B-2: dock Home · Activity · Add · Income · More; More reaches Insight; Add opens the dialog; views are page tabs', bad.length === 0, bad.join('; '));
      // cleanup U-1: on a touch screen every visible control is at least 44 px high
      const small = await page.evaluate(() => [...document.querySelectorAll('button, [role="button"], select, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"])')]
        .filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 43.5).map((e) => (e.getAttribute('aria-label') || e.innerText || e.tagName).trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().height)));
      ok(tag + 'cleanup U-1: touch targets are at least 44 px high', small.length === 0, small.join(' | '));
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
    await openView(page, 'overview');
    const side = (await page.locator('nav.ui-rail').innerText() + '\n' + await page.locator('header.ui-pagehead').innerText()).split('\n').filter((s) => EN.test(s));
    for (const l of side) hits.push('rail/header: ' + l);
    ok('German browser: no English UI words in ' + VIEWS.length + ' views, the rail and the page header', hits.length === 0, hits.slice(0, 12).join(' | '));
    await openView(page, 'overview');
    await page.waitForTimeout(800);
    { const body = await settledText(page.locator('main'));
      // "$→€ 0,900" is the FX rate, not an amount; a tab or line break is a cell edge.
      const enAmounts = body.match(/(?<!→)€ ?\d[\d.,]*|\d[\d,]*\.\d{2}\s€/g) || [];
      ok('German browser: amounts use German separators (1.234,56 €), no en-US amounts', /\d,\d{2}\s€/.test(body) && enAmounts.length === 0, enAmounts.slice(0, 6).join(' | ') || body.slice(0, 300)); }
    // the hero figure splits at the decimal comma: '176.756' large, ',66' small (it split at the thousands dot)
    { const hi = await page.locator('main [data-testid="hero-int"]').first().innerText().catch(() => ''), hd = await page.locator('main [data-testid="hero-dec"]').first().innerText().catch(() => '');
      ok('German browser: the portfolio value splits at the decimal comma', /^\d{1,3}(\.\d{3})*$/.test(hi.trim()) && /^,\d{2}$/.test(hd.trim()), hi + ' | ' + hd); }
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
        // R3.1: the one filled Add is the page header's Add Transaction
        const b = document.querySelector('header.ui-pagehead .ui-btn--primary');
        if (!b) return 0;
        const rgb = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = (a) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2]); };
        const cs = getComputedStyle(b);
        // a gradient fill: take its darkest-to-lightest stop as the worst case
        const stops = (cs.backgroundImage.match(/rgba?\([^)]+\)|#[0-9a-f]{6}/gi) || [cs.backgroundColor]).map((c) => c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : rgb(c));
        const fg = lum(rgb(cs.color));
        return Math.min(...stops.map((s) => { const bg = lum(s); return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05); }));
      });
      ok('filled Add Transaction button: text contrast >= 4.5:1 on every stop of its fill', ratio >= 4.5, ratio.toFixed(2)); }

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
    await page.getByRole('radio', { name: /Manual Import/ }).click();
    await page.getByRole('textbox', { name: 'Manual Import' }).fill('[{"type":"buy"}]');
    await page.evaluate(() => window.MaerminMarket.set('workerStatus', { ok: false, reachable: false, error: 'network', at: Date.now() }));
    await page.waitForTimeout(400);
    { const kept = await page.getByRole('textbox', { name: 'Manual Import' }).inputValue().catch(() => '');
      ok('Data view: pasted text and tab survive an app re-render', kept === '[{"type":"buy"}]', kept); }
    { const st = await page.evaluate(() => Array.from(document.querySelectorAll('main [data-testid="dm-sections"] [role="radio"]'))
        .map((b) => ({ t: b.innerText.trim(), p: b.getAttribute('aria-checked'), g: b.classList.contains('mx-primary') })));
      ok('Data sections (R2.2 segmented control): exactly one checked, none carries the old accent styling', st.length >= 3 && st.filter((x) => x.p === 'true').length === 1 && st.every((x) => !x.g), JSON.stringify(st)); }

    // M-4: restore from file runs the backup confirmation
    { const chooser = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
      await page.getByRole('radio', { name: /Export & Backup/ }).click();
      await page.getByRole('button', { name: /Restore from file/ }).click();
      const fc = await chooser;
      ok('Export & Backup offers "Restore from file…" (opens a file picker)', !!fc); }

    // H-2: the Basiszins field can be typed and commits on blur
    await openView(page, 'tax');
    await page.getByRole('radio', { name: 'Tax Report', exact: true }).click();
    { const year = new Date().getFullYear();
      const f = page.getByRole('textbox', { name: 'Basiszins ' + year + ' in percent' });
      let saved = null;
      try {
        await f.fill('2,5'); await f.press('Tab');
        await page.waitForTimeout(300);
        saved = await page.evaluate((y) => (JSON.parse(localStorage.getItem('maermin_basiszins_overrides') || '{}'))[y], year);
      } catch (e) { saved = 'ERR ' + e.message.split('\n')[0]; }
      ok('Basiszins: typing "2,5" and leaving the field saves 2.5 %', Math.abs(saved - 0.025) < 1e-9, String(saved)); }
    // cleanup O-4 / O-5: without a Worker the News view says so in the shared
    // empty state, and its button opens API Settings
    { let shared = 0, opened = false, err = '';
      try {
        await openView(page, 'news');
        await page.waitForTimeout(600);
        shared = await page.locator('main [data-testid="news-need-worker"].mx-empty[data-kind="worker"]').count();
        await page.locator('main [data-testid="news-need-worker"] button', { hasText: 'Open API Settings' }).click();
        await page.locator('[aria-labelledby="dlg-api-settings"]').waitFor({ timeout: 5000 });
        opened = true;
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } catch (e) { err = e.message.split('\n')[0]; }
      ok('cleanup O-4: a Worker notice uses the shared empty state', shared === 1, err || String(shared));
      ok('cleanup O-5: "Open API Settings" in a Worker notice opens API Settings', opened, err); }
    ok('no page errors in the usability session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // cleanup 6b: the light theme in the demo - text reads at WCAG AA on the
  // views 6b touched (type badges, correlation figures, symbol tiles, fee
  // amounts, strategy results), option groups say which option is on, and
  // the Worker-gated cards share one empty state.
  {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1366, height: 900 } });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    await createVault(page, base);
    await page.evaluate(() => { localStorage.setItem('maermin_demo', '1'); localStorage.setItem('maermin_ui_mode', 'advanced'); localStorage.setItem('maermin_onboarded', '1'); localStorage.setItem('theme', 'white'); localStorage.setItem('maermin_fx', 'off'); });
    const low = {}; let tabs = null, empties = null, tiles = null, err = '';
    const SCAN = () => {
      const rgb = (c) => { const srgb = /^color\(srgb/.test(c); const m = (c.replace(/^color\(srgb/, '').match(/[\d.]+/g) || []).map(Number); return { c: srgb ? m.slice(0, 3).map((v) => v * 255) : m.slice(0, 3), a: m[3] == null ? 1 : m[3] }; };
      const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
      const bgAt = (el) => { const layers = []; for (let e = el; e; e = e.parentElement) { const st = getComputedStyle(e); if (/gradient/.test(st.backgroundImage)) return null; const b = rgb(st.backgroundColor); if (b.a > 0) layers.push(b); if (b.a >= 0.99) break; } let base = [255, 255, 255]; for (let i = layers.length - 1; i >= 0; i--) { const l = layers[i]; base = l.c.map((v, k) => v * l.a + base[k] * (1 - l.a)); } return base; };
      const out = []; const seen = new Set();
      const w = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const el = n.parentElement; if (!n.textContent.trim() || !el || seen.has(el)) continue; seen.add(el);
        if (!el.getClientRects().length || el.closest('svg, [aria-hidden="true"], button:disabled')) continue;
        const st = getComputedStyle(el); const bg = bgAt(el); if (!bg) continue;
        let op = 1; for (let e = el; e && e !== document.body; e = e.parentElement) op *= +getComputedStyle(e).opacity;
        const fg = rgb(st.color); const c = fg.c.map((v, k) => (v * fg.a + bg[k] * (1 - fg.a)) * op + bg[k] * (1 - op));
        const L1 = lum(c), L2 = lum(bg), cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(st.fontSize), need = (size >= 24 || (size >= 18.66 && +st.fontWeight >= 700)) ? 3 : 4.5;
        if (cr < need) out.push(n.textContent.trim().slice(0, 20) + ' ' + cr.toFixed(2));
      }
      return out;
    };
    try {
      await unlock(page, base);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      for (const id of ['overview', 'transactions', 'analytics', 'fees', 'investment-analysis', 'net-worth']) {
        await openView(page, id);
        await page.waitForTimeout(1500);
        const r = await page.evaluate(SCAN);
        if (r.length) low[id] = r.slice(0, 6).concat(r.length > 6 ? ['+' + (r.length - 6)] : []);
      }
      await openView(page, 'data');
      await page.getByRole('radio', { name: /Broker Import/ }).first().click();
      await page.waitForTimeout(800);
      tabs = await page.locator('main [data-testid="dm-sections"] [role="radio"]').evaluateAll((bs) => bs.map((b) => b.innerText.trim() + '=' + b.getAttribute('aria-checked')));
      empties = await page.evaluate(() => ['wallets', 'bank-sync', 'aggregators'].map((id) => { const el = document.querySelector('[data-testid="' + id + '"]'); return id + ':' + (el ? el.className + '/' + el.getAttribute('data-kind') : 'none'); }));
      tiles = await page.evaluate(() => ['Portfolio Performance', 'Parqet', 'Scalable Capital'].map((n) => { const b = document.querySelector('[aria-label="Select broker ' + n + '"] div[aria-hidden="true"]'); return b ? b.innerText + '|' + getComputedStyle(b).backgroundColor : 'none'; }));
      ok('cleanup 6b / R2.2: the Data Management sections are one segmented control, one option checked', Array.isArray(tabs) && tabs.length >= 3 && tabs.filter((t) => /=true$/.test(t)).length === 1 && tabs.includes('Broker Import=true') && !tabs.some((t) => /[↓↑◁◆]/.test(t)), err || JSON.stringify(tabs));
      ok('cleanup U-2: the Worker-gated cards share one empty state (demo)', Array.isArray(empties) && empties.every((x) => /:mx-empty\/demo$/.test(x)), err || JSON.stringify(empties));
      ok('cleanup V-6: brokers without a logo get distinct initial tiles (PP, PA, SC)', Array.isArray(tiles) && tiles.map((t) => t.split('|')[0]).join() === 'PP,PA,SC' && new Set(tiles.map((t) => t.split('|')[1])).size === 3, err || JSON.stringify(tiles));
      // R1.1: the theme objects are var() references to the styles.css tokens;
      // the light theme's tokens are live, the page background is flat (no
      // aurora layers) and filled buttons still get the shared primary look
      // (R3.1: the Overview has no legacy filled buttons left; Transactions has).
      await openView(page, 'transactions');
      await page.waitForTimeout(800);
      const tok = await page.evaluate(() => {
        const root = document.documentElement, cs = getComputedStyle(root), app = document.querySelector('.mx-app');
        const fill = [...document.querySelectorAll('main button')].filter((b) => /var\(--accent-fill\)/.test(b.getAttribute('style') || ''));
        return { theme: root.getAttribute('data-theme'), gain: cs.getPropertyValue('--gain').trim(), bg: cs.getPropertyValue('--bg').trim(),
          meta: (document.querySelector('meta[name="theme-color"]') || {}).content, aurora: app ? getComputedStyle(app, '::after').display : 'none',
          resolved: window.MaerminTokens.resolve('var(--loss)'), fills: fill.length, tagged: fill.filter((b) => b.classList.contains('mx-primary') || b.classList.contains('mx-selected') || b.hasAttribute('aria-pressed')).length };
      });
      ok('R1.1: light-theme tokens are live and resolvable (data-theme, --gain, theme-color, MaerminTokens.resolve)', tok.theme === 'white' && tok.gain === '#0a6e44' && tok.bg === '#f5f5f8' && tok.meta === '#f5f5f8' && tok.resolved === '#b32538', JSON.stringify(tok));
      ok('R1.1: flat page background (aurora layer off)', tok.aurora === 'none', JSON.stringify(tok));
      ok('R1.1: accent-filled buttons on var() still get the primary / selected look', tok.fills > 0 && tok.tagged === tok.fills, JSON.stringify(tok));
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('cleanup V-1 / V-2: light-theme text reads at WCAG AA on the views 6b touched', !err && Object.keys(low).length === 0, err || JSON.stringify(low));
    ok('no page errors in the light-theme session', errors.length === 0, errors.join(' | '));
    await context.close();
  }

  // R1.2 / R1.3: the hidden component gallery (?demo&gallery) renders every
  // shared component in all five themes without a page error; page tabs move
  // with the arrow keys; at 360 px nothing scrolls sideways and the Table
  // switches to phone rows.
  {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    await wire(context, external);
    const page = await context.newPage();
    const errors = watch(page);
    const res = { themes: [], tabs: null, narrow: null, sections: 0 };
    let err = '';
    try {
      await page.goto(base + '/index.html?demo&gallery');
      await page.locator('[data-testid="component-gallery"]').waitFor({ timeout: 15000 });
      res.sections = await page.locator('.ui-gallery__section').count();
      for (const t of ['dark', 'white', 'purple', 'contrast', 'cb']) {
        await page.locator('[data-testid="gallery-theme"] [role="radio"]').nth(['dark', 'white', 'purple', 'contrast', 'cb'].indexOf(t)).click();
        await page.waitForTimeout(250);
        res.themes.push(await page.evaluate(() => document.documentElement.getAttribute('data-theme') + ':' + document.querySelectorAll('.ui-btn').length));
      }
      const tab = page.locator('[role="tablist"][aria-label="Home views"] [role="tab"]').first();
      await tab.click();
      await page.keyboard.press('ArrowRight');
      res.tabs = await page.evaluate(() => { const a = document.activeElement; return a && a.getAttribute('role') === 'tab' ? a.textContent + '=' + a.getAttribute('aria-selected') : String(a && a.tagName); });
      await page.setViewportSize({ width: 360, height: 800 });
      await page.waitForTimeout(400);
      res.narrow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, phoneRows: document.querySelectorAll('[data-testid="gallery-table"] .ui-plist__row').length, tables: document.querySelectorAll('[data-testid="gallery-table"] table').length }));
    } catch (e) { err = e.message.split('\n')[0]; }
    ok('R1.2: the component gallery renders its sections in all five themes', !err && res.sections >= 7 && res.themes.join() === 'dark:' + res.themes[0].split(':')[1] + ',white:' + res.themes[1].split(':')[1] + ',purple:' + res.themes[2].split(':')[1] + ',contrast:' + res.themes[3].split(':')[1] + ',cb:' + res.themes[4].split(':')[1] && +res.themes[0].split(':')[1] > 5, err || JSON.stringify(res));
    ok('R1.2: page tabs move with the arrow keys (roving focus, selection follows)', res.tabs === 'Portfolios=true', err || JSON.stringify(res));
    ok('R1.3: at 360 px no sideways scroll, the Table shows phone rows', res.narrow && res.narrow.scroll <= 360 && res.narrow.phoneRows > 0 && res.narrow.tables === 0, err || JSON.stringify(res));
    ok('no page errors in the gallery', errors.length === 0, errors.join(' | '));
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
