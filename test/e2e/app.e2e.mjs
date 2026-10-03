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
async function wire(context, external) {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1')) return route.continue();
    if (url.startsWith(FX_WORKER)) return answerFromFxWorker(route);
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
    if (url.startsWith('https://api.coingecko.com/api/v3/simple/price')) { fetched.push('crypto'); return json({ eth: { eur: 3000, usd: 3300 } }); }
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
    if (!m || !FX_FIXTURE[decodeURIComponent(m[1])]) return m ? new Response('{}', { status: 404 }) : realFetch(input, init);
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
  await page.getByText('Recovery code').first().waitFor({ timeout: 30000 });
}
async function unlock(page, base) {
  await page.goto(base + '/index.html');
  const pw = page.locator('input[type=password]').first();
  await pw.waitFor({ timeout: 15000 });
  await pw.fill(PASSWORD);
  await page.locator('#auth-submit').click();
  await page.locator('nav.maermin-sidebar').waitFor({ timeout: 30000 });
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
      schema: localStorage.getItem('maermin_schema_version'),
      hist: JSON.parse(localStorage.getItem('priceHistory') || '{}'),
      owner: localStorage.getItem('maermin_tax_owner'),
      rawOwner: R.get('maermin_tax_owner'),
      leak: R.keys().filter((k) => /Mustermann|12345678901/.test(R.get(k) || ''))
    }; })()`);
    ok('migration v4 ran (schema 3 -> 4)', r.schema === '4', 'schema=' + r.schema);
    ok('year-less price points repaired to ISO', (r.hist.btc || []).length === 2 && r.hist.btc.every((p) => /^\d{4}-\d{2}-\d{2}T/.test(p.timestamp)), JSON.stringify(r.hist));
    ok('plaintext v10 store adopted into the vault', /Mustermann/.test(r.owner || '') && r.rawOwner === null && r.leak.length === 0, JSON.stringify({ rawOwner: r.rawOwner, leak: r.leak }));
    ok('no page errors in the upgrade session', errors.length === 0, errors.join(' | '));
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
