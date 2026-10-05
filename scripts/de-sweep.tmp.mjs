// Scratch: open every view in German and list English-looking words.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(root, p === '/' ? 'index.html' : p);
  try { if (!(await stat(file)).isFile()) throw 0; res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file)); } catch (e) { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const LOCAL = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': join(root, 'node_modules/react/umd/react.production.min.js'),
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': join(root, 'node_modules/react-dom/umd/react-dom.production.min.js')
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ serviceWorkers: 'block', locale: process.env.LOC || 'de-DE', viewport: { width: 1400, height: 900 } });
await context.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith('http://127.0.0.1')) return route.continue();
  if (LOCAL[url]) return route.fulfill({ path: LOCAL[url], headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/javascript' } });
  const json = (o) => route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(o) });
  if (url.startsWith('https://open.er-api.com')) return json({ result: 'success', rates: { EUR: 0.9, USD: 1 } });
  if (url.startsWith('https://api.coingecko.com/api/v3/simple/price')) return json({ bitcoin: { eur: 60000, usd: 66000 }, ethereum: { eur: 3000, usd: 3300 } });
  return route.abort();
});
const page = await context.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const PW = 'Correct-Horse-9!';
await page.goto(base + '/index.html');
const pw = page.locator('input[type=password]');
await pw.nth(1).waitFor({ timeout: 15000 });
const authText = [await page.locator('#maermin-auth').innerText()];
await pw.nth(0).fill(PW); await pw.nth(1).fill(PW);
await page.locator('#auth-submit').click();
await page.locator('#rc-code').waitFor({ timeout: 30000 });
authText.push(await page.locator('#maermin-auth').innerText());
await page.locator('#rc-saved').check();
await page.locator('#auth-submit').click();
await page.locator('main.maermin-main').waitFor({ timeout: 30000 });
await page.evaluate(() => {
  const tx = (id, type, category, symbol, quantity, price, date, extra) => Object.assign({ id: String(id), type, category, symbol, quantity, price, date, fees: 1, currency: 'EUR', notes: '', portfolioId: 'default' }, extra || {});
  localStorage.setItem('transactions', JSON.stringify([
    tx(1, 'buy', 'crypto', 'bitcoin', 0.5, 30000, '2023-01-10'), tx(2, 'buy', 'stocks', 'AAPL', 10, 150, '2023-02-01', { currency: 'USD' }),
    tx(3, 'buy', 'stocks', 'VWCE.DE', 20, 100, '2023-03-01'), tx(4, 'sell', 'stocks', 'AAPL', 4, 180, '2024-05-01', { currency: 'USD' }),
    tx(5, 'dividend', 'stocks', 'VWCE.DE', 1, 12.5, '2024-06-15'), tx(6, 'buy', 'commodities', 'GOLD', 1, 1800, '2023-05-05'),
    tx(7, 'buy', 'skins', 'AK-47 | Redline (Field-Tested)', 2, 15, '2023-06-01')]));
  localStorage.setItem('maermin_ui_mode', 'advanced');
});
await page.waitForTimeout(1500);
await page.goto(base + '/index.html');
await page.locator('input[type=password]').first().fill(PW);
await page.locator('#auth-submit').click();
await page.locator('nav.maermin-sidebar').waitFor({ timeout: 30000 });
await page.keyboard.press('Escape'); await page.waitForTimeout(800);
await page.keyboard.press('Escape');
const views = await page.evaluate(() => { const ids = []; window.MaerminNav.AREAS.forEach((a) => a.entries.forEach((e) => (e.tabs || [e]).forEach((v) => ids.push(v.id)))); return ids.concat(['correlation', 'montecarlo', 'stress', 'risk', 'broker-import']); });
const EN = /\b(the|and|your|with|for|from|not|no|of|to|is|are|this|Add|Total|Value|Settings|Loading|Refresh|Export|Cancel|Save|Delete|Edit|Close|Price|Date|Type|Amount|Fees|Holdings|Positions?|Returns?|Dividends?|Tax|Taxes|Search|Show|Hide|Back|Next|Create|Remove|Market|Gain|Loss|Profit|Income|Invested|Current|Yield|Annual|Monthly|Weekly|Daily|Year|Years|Months?|Days?|Score|Risk|Rate|Target|Goal|Name|Symbol|Quantity|Cost|Balance|Assets?|Liabilit(y|ies)|Account|Allocation|Performance|Summary|Overview|None|All|Run|Simulation|Scenario|Report|Settings|Enable|Disable|Unknown|Error|Warning|Recommended|Average|Median|Best|Worst|Case|Sell|Buy|Interest|Transactions?|Shares?|Sector|Region|Country|Growth|Strategy|Analysis|Health|Diversification|Exposure|Volatility|Drawdown|News|Watchlist|Rules?|Alerts?|Tags?|Categor(y|ies)|Import|Journal|Notes?)\b/;
const out = {};
for (const id of views) {
  try {
    await page.evaluate((v) => { const fn = window.__maerminSetView; }, id);
    const entry = page.locator('nav.maermin-sidebar [data-view="' + id + '"]');
    if (await entry.count()) await entry.first().click();
    else {
      const group = page.locator('nav.maermin-sidebar [data-views~="' + id + '"]');
      if (await group.count()) { await group.first().click(); const tab = page.locator('main .mx-area-tabs [data-tab="' + id + '"]'); if (await tab.count()) await tab.first().click(); }
      else { continue; }
    }
    await page.waitForTimeout(700);
    const txt = await page.locator('main').innerText();
    const lines = [...new Set(txt.split('\n').map((s) => s.trim()).filter((s) => s && EN.test(s)))];
    out[id] = lines;
  } catch (e) { out[id] = ['ERR ' + e.message]; }
}
const chrome = await page.locator('nav.maermin-sidebar').innerText();
out._sidebar = [...new Set(chrome.split('\n').filter((s) => EN.test(s)))];
out._auth = [...new Set(authText.join('\n').split('\n').filter((s) => EN.test(s)))];
for (const [k, v] of Object.entries(out)) { if (v.length) { console.log('== ' + k); v.slice(0, Number(process.env.MAX || 40)).forEach((l) => console.log('   ' + l.slice(0, 160))); } }
console.log('errors:', errors.slice(0, 5));
await browser.close(); server.close();
