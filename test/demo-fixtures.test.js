// Node harness for P5-1.8: demo fixtures for the Worker-only views
// (MaerminDemoFixtures). The router answers only the reserved demo URL, the
// responses parse with the views' own parsers, the FX history ends at the
// demo rate, and the fetch wrapper never reaches the network for demo URLs.
// Run: node test/demo-fixtures.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const F = require('../demo-fixtures.js');
const Disc = require('../discovery.js');
const Earn = require('../earnings-calendar.js');
const D = require('../demo-data.js');
const TODAY = '2026-10-12';

(async function run() {
  console.log('router:');
  ok('only the reserved URL is a demo URL', F.isDemoUrl(F.BASE + '?action=news') && !F.isDemoUrl('https://my-worker.example.workers.dev?action=news') && /\.invalid$/.test(F.BASE));
  ok('a non-demo URL is refused', F.respond('https://example.com/?action=news&symbol=AAPL', TODAY).status === 404);
  ok('unknown actions get a local 404', F.respond(F.BASE + '?action=fundamentals&symbol=AAPL', TODAY).status === 404 && F.respond(F.BASE + '?action=yf&symbol=AAPL', TODAY).status === 404);
  ok('deterministic for a given day', JSON.stringify(F.respond(F.BASE + '?action=screener&scrId=day_gainers', TODAY)) === JSON.stringify(F.respond(F.BASE + '?action=screener&scrId=day_gainers', TODAY)));

  console.log('FX (EUR/USD):');
  const h = F.fxHistory(TODAY);
  const days = Object.keys(h).sort();
  ok('weekdays over ~4 years, today = the demo exchange rate', days.length > 1000 && days[days.length - 1] === TODAY && h[TODAY] === D.SETTINGS.exchangeRate, days[days.length - 1] + ' ' + h[TODAY]);
  ok('every demo trade date is covered within a few days', D.getTransactions().every((t) => days.some((d) => d <= t.date && Date.parse(t.date) - Date.parse(d) <= 4 * 86400000)));
  ok('rates stay in a plausible band (0.85 - 1.0 EUR per USD)', Object.values(h).every((v) => v > 0.85 && v < 1.0));
  const yf = F.respond(F.BASE + '?action=yf&symbol=EURUSD%3DX&interval=1d&range=1y', TODAY).body;
  ok('yf EURUSD=X is USD per EUR and matches the history', yf.prices.length > 240 && Math.abs(yf.prices[yf.prices.length - 1].price - 1 / h[TODAY]) < 1e-3);

  console.log('benchmarks:');
  for (const sym of ['URTH', 'VT', '^GSPC', '^NDX']) {
    const b = F.respond(F.BASE + '?action=yf&symbol=' + encodeURIComponent(sym) + '&interval=1d&range=5y', TODAY).body;
    ok(sym + ': 5 years of weekday closes, ascending, positive', b.prices.length > 1200 && b.prices.every((p, i, a) => p.price > 0 && (i === 0 || p.date > a[i - 1].date)));
  }

  // P5-2.2: accumulating EUR listings for "dividends reinvested"
  for (const sym of ['EUNL.DE', 'VWCE.DE', 'SXR8.DE', 'SXRV.DE']) {
    const b = F.respond(F.BASE + '?action=yf&symbol=' + encodeURIComponent(sym) + '&interval=1d&range=10y', TODAY).body;
    ok(sym + ': EUR closes, ascending, positive', b.currency === 'EUR' && b.prices.length > 1200 && b.prices.every((p, i, a) => p.price > 0 && (i === 0 || p.date > a[i - 1].date)));
  }
  { const s = D.closeHistory(TODAY).series[['stocks', 'VWCE.DE'].join('|')];
    const v = F.respond(F.BASE + '?action=yf&symbol=VWCE.DE&interval=1d&range=1y', TODAY).body.prices;
    ok('VWCE.DE is the demo\'s own fund: its sample closes are the demo closes', !!s && Math.abs(v[v.length - 1].price - s.p[s.p.length - 1]) < 0.01, v[v.length - 1].price + ' vs ' + (s && s.p[s.p.length - 1])); }

  console.log('discovery:');
  const g = Disc.parseResponse(F.respond(Disc.buildUrl(F.BASE, { scrId: 'day_gainers', count: 25 }), TODAY).body);
  ok('gainers parse with the view\'s parser, all up, sorted', g.ok && g.rows.length > 0 && g.rows.every((r, i, a) => r.changePercent > 0 && (i === 0 || r.changePercent <= a[i - 1].changePercent)));
  const l = Disc.parseResponse(F.respond(Disc.buildUrl(F.BASE, { scrId: 'day_losers' }), TODAY).body);
  ok('losers are all down', l.ok && l.rows.length > 0 && l.rows.every((r) => r.changePercent < 0));
  ok('every company is fictional and says so', g.rows.concat(l.rows).every((r) => /\(sample\)$/.test(r.name) && r.exchange === 'SAMPLE'));
  const dv = Disc.parseResponse(F.respond(Disc.buildUrl(F.BASE, { symbols: ['KO', 'PG'] }), TODAY).body);
  ok('the dividend tab gets sample payers with a yield', dv.ok && dv.rows.length > 0 && dv.rows.every((r) => r.dividendYield > 0));

  console.log('news and earnings:');
  const xml = F.respond(F.BASE + '?action=news&symbol=AAPL', TODAY);
  ok('news is RSS with three items, each titled as a sample', xml.type === 'xml' && (xml.body.match(/<item>/g) || []).length === 3 && (xml.body.match(/<title>Sample headline/g) || []).length === 3);
  ok('news links are empty (no real site behind a sample)', !/<link>[^<]/.test(xml.body));
  const er = Earn.parseResponse(F.respond(F.BASE + '?action=earnings&symbol=msft', TODAY).body);
  ok('earnings parse with the view\'s parser: a future weekday, marked estimate', er && er.symbol === 'MSFT' && er.earningsDate > TODAY && er.isEstimate === true && [0, 6].indexOf(new Date(er.earningsDate + 'T00:00:00Z').getUTCDay()) === -1);

  ok('funds get no earnings date (VWCE.DE, IS3N.DE)', ['VWCE.DE', 'IS3N.DE'].every((s) => Earn.parseResponse(F.respond(F.BASE + '?action=earnings&symbol=' + s, TODAY).body) === null));
  const b5 = F.respond(F.BASE + '?action=yf&symbol=URTH&interval=1d&range=1y', TODAY).body.prices;
  ok('the sample index ends at its level today and moves with the demo world ETF', Math.abs(b5[b5.length - 1].price - 140) < 1 && b5.length > 240);

  console.log('fetch wrapper:');
  const calls = [];
  const win = { fetch: function (u) { calls.push(u); return Promise.resolve('real'); }, Response: class { constructor(b, o) { this.b = b; this.status = o.status; } async json() { return JSON.parse(this.b); } async text() { return this.b; } } };
  F.installFetch(win);
  const res = await win.fetch(F.BASE + '?action=screener&scrId=most_actives');
  const body = await res.json();
  ok('a demo URL is answered locally, the real fetch is not called', res.status === 200 && Array.isArray(body.quotes) && calls.length === 0);
  const miss = await win.fetch(F.BASE + '?action=anything');
  ok('an unknown demo request is a local 404, still no network', miss.status === 404 && calls.length === 0);
  await win.fetch('https://example.com/x');
  ok('any other URL goes to the real fetch', calls.length === 1 && calls[0] === 'https://example.com/x');
  const again = win.fetch; F.installFetch(win);
  ok('installing twice does not wrap twice', win.fetch === again);

  // P5-2.5: ten years of monthly closes and dividends for the dividend backtest
  const mo = F.respond(F.BASE + '?action=yf&symbol=AAPL&interval=1mo&range=10y', TODAY);
  ok('a demo stock has monthly closes for ten years', mo.status === 200 && mo.body.prices.length === 121 && mo.body.prices.every((p) => p.price > 0 && /-01$/.test(p.date)), mo.body.prices && mo.body.prices.length);
  ok('... and its dividends, oldest first, matching the recorded ones', mo.body.dividends.length > 5 && mo.body.dividends.some((d) => d.date === '2024-05-16' && d.amount === 0.95)
    && mo.body.dividends.every((d, i, a) => !i || a[i - 1].date <= d.date), JSON.stringify(mo.body.dividends.slice(-3)));
  ok('a symbol outside the demo still gets a local 404', F.respond(F.BASE + '?action=yf&symbol=ZZZZ&interval=1mo&range=10y', TODAY).status === 404);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
