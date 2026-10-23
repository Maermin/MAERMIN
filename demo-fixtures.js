// ============================================================================
// MAERMIN — Demo fixtures for Worker-only views  (window.MaerminDemoFixtures)
// ----------------------------------------------------------------------------
// P5-1.8. In demo mode the views that need a Cloudflare Worker (News,
// Discovery, FX attribution, benchmark comparison, earnings) get the reserved
// URL BASE instead of the user's Worker. A fetch to BASE never leaves the
// page: the wrapper below answers it from the deterministic sample data here
// (unknown actions get a local 404). Nothing is stored. Every view shows a
// "Sample data" chip (badge()) while it runs on these fixtures.
//
// Also the demo's EUR/USD history (fxHistory) for the app's FX resolver, so
// USD trades convert at a dated rate without a Worker.
//
// Sample content is made up: Discovery lists fictional companies; news and
// earnings for the demo holdings say they are samples; the benchmark and FX
// series are synthetic. Pure parts are Node-tested (test/demo-fixtures.test.js).
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var BASE = 'https://demo.maermin.invalid';
  var DAY = 86400000;
  var END_RATE = 0.92; // EUR per USD today = the demo's exchange rate

  function dayNo(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / DAY); }
  function iso(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function weekend(n) { var w = new Date(n * DAY).getUTCDay(); return w === 0 || w === 6; }
  function r(x, d) { var f = Math.pow(10, d); return Math.round(x * f) / f; }
  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function todayISO() {
    var U = typeof window !== 'undefined' && window.MaerminUtils;
    return U && U.todayISO ? U.todayISO() : new Date().toISOString().slice(0, 10);
  }
  function isDemoUrl(u) { return typeof u === 'string' && u.indexOf(BASE) === 0; }

  // ---- synthetic daily series --------------------------------------------
  // EUR per USD on each day of the last ~4 years; 0.92 today, smooth waves.
  function fxRate(n, today) {
    var x = n - today;
    return END_RATE * Math.exp(0.035 * Math.sin(x / 140) + 0.012 * Math.sin(x / 23));
  }
  // { 'YYYY-MM-DD': EUR per USD } on weekdays — the shape fxResolver reads.
  function fxHistory(todayIso) {
    var t = dayNo(todayIso || todayISO()), out = {};
    for (var n = t - 4 * 366; n <= t; n++) if (!weekend(n)) out[iso(n)] = r(fxRate(n, t), 5);
    return out;
  }
  // Benchmark index levels follow the demo's own world ETF (VWCE.DE closes of
  // MaerminDemo.closeHistory) in USD, so beta and correlation look like a
  // world-equity book against an index: [level today, extra yearly drift].
  var BENCH = { URTH: [140, 0], VT: [105, -0.005], '^GSPC': [5200, 0.02], '^NDX': [18500, 0.05] };
  var _world = { today: null, d: null, p: null };
  function worldPath(today) {
    if (_world.today === today) return _world;
    var DEMO = (typeof window !== 'undefined' && window.MaerminDemo) || require('./demo-data.js');
    var s = DEMO.closeHistory ? DEMO.closeHistory(iso(today)).series[['stocks', 'VWCE.DE'].join('|')] : null; // close-history key
    _world = { today: today, d: s ? s.d : [today], p: s ? s.p : [100] };
    return _world;
  }
  function worldAt(w, n) {
    if (n < w.d[0]) return w.p[0] * Math.exp(-0.08 * (w.d[0] - n) / 365); // before the demo: a plain drift
    var lo = 0, hi = w.d.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (w.d[mid] <= n) lo = mid; else hi = mid - 1; }
    return w.p[lo];
  }
  // P5-2.2: accumulating EUR listings of the same indices (total return),
  // levelled on the demo world ETF in EUR; VWCE.DE is the demo's own fund.
  var BENCH_EUR = { 'EUNL.DE': [104, 0.005], 'VWCE.DE': [0, 0], 'SXR8.DE': [590, 0.025], 'SXRV.DE': [1080, 0.055] };
  function eurLevel(sym, n, today) {
    var b = BENCH_EUR[sym], w = worldPath(today);
    if (!b[0]) return worldAt(w, n);
    var x = n - today;
    return b[0] * (worldAt(w, n) / worldAt(w, today)) * Math.exp(b[1] * x / 365 + 0.003 * Math.sin(x / (8 + hash(sym) % 5)));
  }
  function benchLevel(sym, n, today) {
    var b = BENCH[sym], h = hash(sym), x = n - today, w = worldPath(today);
    var usd = (worldAt(w, n) / fxRate(n, today)) / (worldAt(w, today) / fxRate(today, today));
    return b[0] * usd * Math.exp(b[1] * x / 365 + 0.004 * Math.sin(x / (9 + h % 7)));
  }
  // A few days more than the range, so a period start on a weekend is covered.
  var RANGE_DAYS = { '5d': 10, '1mo': 35, '3mo': 96, '6mo': 187, '1y': 372, '2y': 737, '5y': 1833, '10y': 1833, max: 1833 };
  function yfSeries(sym, range, todayIso) {
    var t = dayNo(todayIso || todayISO()), days = RANGE_DAYS[range] || 366, prices = [];
    for (var n = t - days; n <= t; n++) {
      if (weekend(n)) continue;
      var p = sym === 'EURUSD=X' ? 1 / fxRate(n, t) : BENCH_EUR[sym] ? eurLevel(sym, n, t) : benchLevel(sym, n, t);
      prices.push({ date: iso(n), price: r(p, 4) });
    }
    return { symbol: sym, currency: BENCH_EUR[sym] ? 'EUR' : 'USD', sample: true, prices: prices };
  }

  // ---- P5-2.5: ten years of monthly closes and dividends of a demo stock ----
  // For the dividend backtest (Dividends → History; ?action=yf&interval=1mo).
  // Closes follow the demo's own daily closes and drift back 7 % a year before
  // them; dividends repeat the demo's recorded payments, and before the first
  // recorded year they shrink by 5 % a year. Made up like the rest.
  var _closes = { today: null, series: null };
  function demoSeries(today) {
    if (_closes.today !== today) {
      var DEMO = (typeof window !== 'undefined' && window.MaerminDemo) || require('./demo-data.js');
      _closes = { today: today, series: DEMO.closeHistory ? DEMO.closeHistory(iso(today)).series : {} };
    }
    return _closes.series;
  }
  function yfMonthly(sym, todayIso) {
    var DEMO = (typeof window !== 'undefined' && window.MaerminDemo) || require('./demo-data.js');
    var txs = (DEMO.getTransactions ? DEMO.getTransactions() : []).filter(function (x) { return x.category === 'stocks' && String(x.symbol).toUpperCase() === sym; });
    if (!txs.length) return null;
    var t = dayNo(todayIso || todayISO()), y0 = parseInt(iso(t).slice(0, 4), 10), m0 = parseInt(iso(t).slice(5, 7), 10);
    var hs = demoSeries(t)['stocks|' + sym];
    var closeAt = function (n) {
      if (!hs || !hs.d.length) return 50 * Math.exp(-0.07 * (t - n) / 365);
      if (n < hs.d[0]) return hs.p[0] * Math.exp(-0.07 * (hs.d[0] - n) / 365);
      var lo = 0, hi = hs.d.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (hs.d[mid] <= n) lo = mid; else hi = mid - 1; }
      return hs.p[lo];
    };
    var prices = [];
    for (var k = 0; k <= 120; k++) {
      var y = y0 - 10 + Math.floor((m0 - 1 + k) / 12), m = (m0 - 1 + k) % 12 + 1;
      var first = y + '-' + String(m).padStart(2, '0') + '-01';
      if (first > iso(t)) break;
      var endN = Math.min(t, dayNo(m === 12 ? (y + 1) + '-01-01' : y + '-' + String(m + 1).padStart(2, '0') + '-01') - 1);
      prices.push({ date: first, price: r(closeAt(endN), 4) });
    }
    var divs = txs.filter(function (x) { return x.type === 'dividend'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var dividends = [];
    if (divs.length) {
      var byYear = {}, months = {};
      divs.forEach(function (x) { byYear[x.date.slice(0, 4)] = x.price; months[x.date.slice(5)] = true; });
      var firstY = parseInt(divs[0].date.slice(0, 4), 10), dps0 = divs[0].price;
      for (var yy = y0 - 10; yy <= y0; yy++) {
        Object.keys(months).sort().forEach(function (md) {
          var d = yy + '-' + md;
          if (d > iso(t)) return;
          var dps = byYear[yy] !== undefined ? byYear[yy] : yy < firstY ? dps0 * Math.pow(1.05, yy - firstY) : divs[divs.length - 1].price;
          dividends.push({ date: d, amount: r(dps, 4) });
        });
      }
    }
    return { symbol: sym, currency: txs[0].currency || 'EUR', sample: true, prices: prices, splits: [], dividends: dividends };
  }

  // ---- CH-3a: candles for the Charts view (requests marked bars=1) ------------
  // Made up from the demo's own daily closes (drifting back 7 % a year before
  // the demo starts), so the chart ends on the price the portfolio shows. Open,
  // high, low and volume come from a seeded hash; intraday bars walk from the
  // previous close to the day's close inside the session. Deterministic.
  var BAR_DAYS = { '1d': 1, '5d': 7, '1mo': 31, '3mo': 92, '6mo': 183, '1y': 366, '2y': 731, '5y': 1827, '10y': 3653, max: 3653 };
  var BAR_MIN = { '1m': 1, '2m': 2, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '90m': 90, '1h': 60 };
  function unit(seed) { return (hash(seed) % 100000) / 100000; } // 0 … 1
  function yfBars(sym, interval, range, todayIso) {
    var t = dayNo(todayIso || todayISO());
    var hs = demoSeries(t)['stocks|' + sym];
    if (!hs || !hs.d.length) return null;
    var closeAt = function (n) {
      if (n < hs.d[0]) return hs.p[0] * Math.exp(-0.07 * (hs.d[0] - n) / 365) * (1 + 0.012 * Math.sin(n / 5.3 + hash(sym) % 7));
      var lo = 0, hi = hs.d.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (hs.d[mid] <= n) lo = mid; else hi = mid - 1; }
      return hs.p[lo];
    };
    var usd = hs.cur === 'USD';
    var tz = usd ? 'America/New_York' : 'Europe/Berlin';
    var open0 = usd ? 870 : 480, sessionMin = usd ? 390 : 510; // minutes after 00:00 UTC; session length
    var vol0 = 20000 + hash(sym) % 80000;
    var days = [];
    for (var n = t - (BAR_DAYS[range] || 366); n <= t; n++) if (!weekend(n)) days.push(n);
    var prev = closeAt(days[0] - 1);
    var daily = days.map(function (n) {
      var c = closeAt(n), o = prev * (1 + (unit(sym + ':o:' + n) - 0.5) * 0.01);
      var h = Math.max(o, c) * (1 + unit(sym + ':h:' + n) * 0.012), l = Math.min(o, c) * (1 - unit(sym + ':l:' + n) * 0.012);
      prev = c;
      return { n: n, o: o, h: h, l: l, c: c, v: Math.round(vol0 * (0.5 + unit(sym + ':v:' + n))) };
    });
    var bar = function (ts, b) { return { ts: ts, date: new Date(ts * 1000).toISOString().slice(0, 10), price: r(b.c, 4), o: r(b.o, 4), h: r(b.h, 4), l: r(b.l, 4), v: b.v }; };
    var prices = [];
    var step = BAR_MIN[interval];
    if (step) {
      daily.forEach(function (d) {
        var k = Math.floor(sessionMin / step), p0 = d.o, path = [p0];
        for (var i = 1; i <= k; i++) {
          // a bridge from the open to the close with seeded wiggles
          var lin = d.o + (d.c - d.o) * i / k;
          path.push(i === k ? d.c : lin * (1 + (unit(sym + ':' + d.n + ':' + i) - 0.5) * 0.004 * Math.sin(Math.PI * i / k)));
        }
        for (var j = 0; j < k; j++) {
          var o = path[j], c = path[j + 1];
          var w = 0.0015 * unit(sym + ':w:' + d.n + ':' + j);
          prices.push(bar(d.n * 86400 + (open0 + j * step) * 60, { o: o, c: c, h: Math.max(o, c) * (1 + w), l: Math.min(o, c) * (1 - w), v: Math.max(1, Math.round(d.v / k * (0.4 + unit(sym + ':iv:' + d.n + ':' + j) * 1.2))) }));
        }
      });
    } else if (interval === '1wk' || interval === '1mo') {
      var key = function (n) {
        if (interval === '1mo') return iso(n).slice(0, 7);
        var wd = (new Date(n * DAY).getUTCDay() + 6) % 7; return String(n - wd);
      };
      var groups = [];
      daily.forEach(function (d) {
        var g = groups[groups.length - 1];
        if (!g || g.k !== key(d.n)) groups.push({ k: key(d.n), n: d.n, o: d.o, h: d.h, l: d.l, c: d.c, v: d.v });
        else { g.h = Math.max(g.h, d.h); g.l = Math.min(g.l, d.l); g.c = d.c; g.v += d.v; }
      });
      groups.forEach(function (g) { prices.push(bar(g.n * 86400 + open0 * 60, g)); });
    } else {
      daily.forEach(function (d) { prices.push(bar(d.n * 86400 + (open0 + sessionMin) * 60, d)); });
    }
    return { symbol: sym, currency: hs.cur || 'EUR', exchangeTz: tz, sample: true, prices: prices, splits: [], dividends: [] };
  }

  // ---- P5-2.9: consumer prices (HICP shape of the Worker), made up ----------
  // 2015 = 100, about 2.5 % a year with a bump in 2022, published up to last month.
  function hicp(geo, todayIso) {
    var t = (todayIso || todayISO()), y1 = parseInt(t.slice(0, 4), 10), m1 = parseInt(t.slice(5, 7), 10) - 1;
    var months = [], v = 100;
    for (var y = 2015; y <= y1; y++) {
      for (var m = 1; m <= 12; m++) {
        if (y === y1 && m > m1) break;
        months.push([y + '-' + String(m).padStart(2, '0'), r(v, 2)]);
        v *= 1 + (y === 2022 ? 0.0075 : y === 2023 ? 0.004 : 0.002) + 0.0005 * Math.sin(m + hash(geo) % 7);
      }
    }
    return { geo: geo, base: '2015=100', updated: t, source: 'sample', sample: true, months: months };
  }

  // ---- Discovery: fictional companies --------------------------------------
  // The list lives with the other made-up demo data (demo-data.js).
  var DEMO = (typeof window !== 'undefined' && window.MaerminDemo) || require('./demo-data.js');
  var COMPANIES = DEMO.SAMPLE_COMPANIES || [];
  function quoteOf(c, day) {
    var h = hash(c[0] + '|' + day);
    var price = 8 + hash(c[0]) % 240 + (h % 1000) / 100;
    return {
      symbol: c[0], name: c[1], price: r(price, 2), currency: 'USD',
      changePercent: r(((h >>> 8) % 1400) / 100 - 7, 2),
      marketCap: (2 + hash(c[0]) % 180) * 1e9,
      dividendYield: c[2] === 'div' ? r(0.02 + (hash(c[0]) % 40) / 1000, 4) : (c[2] === 'small' ? null : r((hash(c[0]) % 12) / 1000, 4)),
      type: 'EQUITY', exchange: 'SAMPLE', volume: 1e5 + (h % 9000) * 1000
    };
  }
  var SCREEN_KIND = { growth_technology_stocks: 'tech', undervalued_growth_stocks: 'growth', aggressive_small_caps: 'small' };
  function screener(params, todayIso) {
    var day = todayIso || todayISO();
    var rows = COMPANIES.map(function (c) { return quoteOf(c, day); });
    if (params.symbols) {
      var want = params.symbols.split(',');
      rows = rows.filter(function (q) { return want.indexOf(q.symbol) !== -1; });
      if (!rows.length) rows = COMPANIES.filter(function (c) { return c[2] === 'div'; }).map(function (c) { return quoteOf(c, day); });
    } else if (SCREEN_KIND[params.scrId]) {
      var kind = SCREEN_KIND[params.scrId];
      rows = rows.filter(function (q, i) { return COMPANIES[i][2] === kind || (kind === 'growth' && COMPANIES[i][2] === 'tech'); });
    } else if (params.scrId === 'day_gainers') rows = rows.filter(function (q) { return q.changePercent > 0; }).sort(function (a, b) { return b.changePercent - a.changePercent; });
    else if (params.scrId === 'day_losers') rows = rows.filter(function (q) { return q.changePercent < 0; }).sort(function (a, b) { return a.changePercent - b.changePercent; });
    else rows.sort(function (a, b) { return b.volume - a.volume; });
    return { sample: true, quotes: rows };
  }

  // ---- News: three sample items per holding, RSS like the Worker's ---------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function news(symbol, todayIso) {
    var t = dayNo(todayIso || todayISO()), h = hash(symbol);
    var items = [
      [__('dfxNews1', 'Sample headline: {sym} in the quarterly reporting season', { sym: symbol }), __('dfxNewsBody1', 'Made-up demo text. Real headlines appear once a Worker is set up.')],
      [__('dfxNews2', 'Sample headline: analysts discuss {sym}', { sym: symbol }), __('dfxNewsBody2', 'Made-up demo text, not news about this company.')],
      [__('dfxNews3', 'Sample headline: what moved {sym} this week', { sym: symbol }), __('dfxNewsBody3', 'Made-up demo text for the demo portfolio.')]
    ];
    var xml = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>' + items.map(function (it, i) {
      var d = new Date((t - 1 - i * 3 - h % 3) * DAY + 9 * 3600000).toUTCString();
      return '<item><title>' + esc(it[0]) + '</title><link></link><pubDate>' + d + '</pubDate><description>' + esc(it[1]) + '</description></item>';
    }).join('') + '</channel></rss>';
    return xml;
  }

  // ---- Earnings: an estimated date per holding in the next ~3 months -------
  function earnings(symbol, todayIso) {
    // Funds report no earnings (the demo's fund types say which are funds).
    var DEMO = (typeof window !== 'undefined' && window.MaerminDemo) || require('./demo-data.js');
    var funds = (DEMO.store && DEMO.store('maermin_fund_types')) || {};
    if (funds[symbol]) return { symbol: symbol, error: 'no-earnings' };
    var t = dayNo(todayIso || todayISO()), h = hash(symbol);
    var n = t + 6 + h % 80;
    while (weekend(n)) n++;
    return { symbol: symbol, name: symbol, currency: 'USD', earningsDate: iso(n), isEstimate: true, sample: true,
      epsEstimate: r(0.4 + (h % 400) / 100, 2), revenueEstimate: (1 + h % 90) * 1e9 };
  }

  // ---- the router ------------------------------------------------------------
  function query(url) {
    var q = {}, i = url.indexOf('?');
    if (i < 0) return q;
    url.slice(i + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p.slice(1).join('=') || ''); });
    return q;
  }
  // -> { status, type: 'json' | 'xml', body }
  function respond(url, todayIso) {
    if (!isDemoUrl(url)) return { status: 404, type: 'json', body: { error: 'not-demo-url' } };
    var q = query(url);
    if (q.action === 'yf' && q.bars === '1' && q.symbol) {
      var bars = yfBars(q.symbol.toUpperCase(), q.interval, q.range, todayIso);
      if (bars) return { status: 200, type: 'json', body: bars };
    }
    if (q.action === 'yf' && q.interval === '1mo' && q.symbol) {
      var mo = yfMonthly(q.symbol.toUpperCase(), todayIso);
      if (mo) return { status: 200, type: 'json', body: mo };
    }
    if (q.action === 'yf' && (q.symbol === 'EURUSD=X' || BENCH[q.symbol] || BENCH_EUR[q.symbol])) return { status: 200, type: 'json', body: yfSeries(q.symbol, q.range, todayIso) };
    if (q.action === 'hicp' && q.geo) return { status: 200, type: 'json', body: hicp(q.geo, todayIso) };
    if (q.action === 'screener') return { status: 200, type: 'json', body: screener(q, todayIso) };
    if (q.action === 'news' && q.symbol) return { status: 200, type: 'xml', body: news(q.symbol, todayIso) };
    if (q.action === 'earnings' && q.symbol) return { status: 200, type: 'json', body: earnings(q.symbol.toUpperCase(), todayIso) };
    return { status: 404, type: 'json', body: { error: 'no-sample-data' } };
  }

  // Answer fetches to BASE in the page; everything else goes to the real fetch.
  function installFetch(win) {
    if (!win || !win.fetch || win.fetch.__maerminDemo) return;
    var real = win.fetch;
    var wrapped = function (input, init) {
      var u = typeof input === 'string' ? input : (input && input.url);
      if (!isDemoUrl(u)) return real.apply(this, arguments);
      var res = respond(u);
      var body = res.type === 'xml' ? res.body : JSON.stringify(res.body);
      return Promise.resolve(new win.Response(body, { status: res.status, headers: { 'Content-Type': res.type === 'xml' ? 'application/rss+xml' : 'application/json' } }));
    };
    wrapped.__maerminDemo = true;
    win.fetch = wrapped;
  }

  // The "Sample data" chip a view shows while it runs on these fixtures.
  function badge(React, theme, workerUrl) {
    if (!React || !isDemoUrl(String(workerUrl || '').trim())) return null;
    theme = theme || {};
    return React.createElement('span', { 'data-testid': 'sample-data', title: __('dfxTitle', 'Made-up demo data - not real market data'),
      style: { display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: '6px', fontSize: 'var(--text-2xs)', fontWeight: 600, verticalAlign: 'middle',
        color: theme.textSecondary || '#9aa4b2', background: theme.inputBg || 'rgba(255,255,255,0.06)', border: '1px solid ' + (theme.cardBorder || 'rgba(255,255,255,0.12)') } },
      __('dfxBadge', 'Sample data'));
  }

  var api = { BASE: BASE, isDemoUrl: isDemoUrl, fxHistory: fxHistory, yfSeries: yfSeries, yfBars: yfBars, screener: screener, news: news, earnings: earnings, respond: respond, installFetch: installFetch, badge: badge };
  if (typeof window !== 'undefined') { window.MaerminDemoFixtures = api; installFetch(window); }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
