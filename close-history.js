// ============================================================================
// MAERMIN — Daily close history  (window.MaerminCloseHistory)
// ----------------------------------------------------------------------------
// The live `priceHistory` only holds a point per manual refresh, so TWR, rolling
// volatility and correlation stayed empty for days after an import. This module
// keeps a per-holding series of DAILY closes that reaches back to the first
// transaction, so the value path (value-path.js) exists from day one.
//
// Sources (no new host):
//   stocks, commodities   the Worker's `?action=yf` route (Yahoo closes + splits)
//   crypto                the same route with the Yahoo pair ("BTC-USD"); CoinGecko
//                         `market_chart` (EUR, at most a year) when Yahoo has no
//                         such pair, its price is off, or there is no Worker
//
// Closes are stored in their QUOTE currency; conversion to EUR happens when the
// path is built, so a better FX history improves old points too.
//
//   need(transactions)                 holdings that can have a series
//   plan(need, store, nowMs)           what to fetch: full range or just the tail
//   ingestYahoo / ingestCoinGecko      response -> series
//   sync({ transactions, workerBase, fetch, ... })   run the plan (injectable fetch)
//   load() / save()                    persisted at localStorage[KEY]
//
// Storage (sensitive: the keys are the held symbols):
//   { v: 1, series: { 'stocks|AAPL': { cur, src, sym, from, to, req, at,
//                                      d: [dayNumber…], p: [close…],
//                                      splits: [{ date, num, den }] } } }
//   req = the start date asked for at the last full fetch (a source may simply
//   have less history; without it that holding would be re-fetched forever).
//   miss: { key: { at, req } } = asked, no history came back. Not asked again
//   for a day (unless an earlier trade appears), so holdings without a history
//   (delisted ticker, skin without a price graph) cannot use up every batch.
// Pure + dual-exported; tested in test/close-history.test.js.
// ============================================================================
(function () {
  'use strict';

  var KEY = 'maermin_close_history';
  var SCHEMA = 1;
  var DAY = 86400000;
  var MAX_POINTS = 4000;            // ~11 years of daily closes per holding
  var REFRESH_MS = 6 * 3600 * 1000; // a covered series is topped up at most every 6 h
  var MISS_MS = 24 * 3600 * 1000;   // a holding without history is asked again after a day
  var LEAD_DAYS = 7;                // fetch a week before the first trade (prior close)
  // CS2 skins have no daily history source (the chart uses the averages of the
  // daily skin price list instead).
  var CATEGORIES = { stocks: 1, commodities: 1, crypto: 1 };

  // Bare tickers the price refresh maps to an exchange listing. ONE table for
  // the live quote (renderer.js fetchPrices) and the history, so both always
  // read the same listing.
  var YF_LEGACY = {
    'SIX2': 'SIX2.DE', 'SIE': 'SIE.DE', 'SAP': 'SAP.DE', 'BMW': 'BMW.DE',
    'VOW3': 'VOW3.DE', 'BAS': 'BAS.DE', 'ALV': 'ALV.DE', 'DTE': 'DTE.DE',
    'DBK': 'DBK.DE', 'ADS': 'ADS.DE', 'RWE': 'RWE.DE', 'MRK': 'MRK.DE',
    'NVO': 'NVO', 'SHEL': 'SHEL.L', 'AZN': 'AZN.L', 'BP': 'BP.L',
    'LVMH': 'MC.PA', 'TTE': 'TTE.PA', 'AIR': 'AIR.PA',
    'ASML': 'ASML.AS', 'ING': 'INGA.AS'
  };
  var YF_COMMODITY = {
    'GOLD': 'GC=F', 'XAU': 'GC=F', 'SILVER': 'SI=F', 'XAG': 'SI=F',
    'OIL': 'CL=F', 'WTI': 'CL=F', 'BRENT': 'BZ=F',
    'GAS': 'NG=F', 'NATURAL_GAS': 'NG=F',
    'COPPER': 'HG=F', 'PLATINUM': 'PL=F', 'XPT': 'PL=F',
    'PALLADIUM': 'PA=F', 'XPD': 'PA=F', 'WHEAT': 'ZW=F', 'CORN': 'ZC=F'
  };

  function ymd(d) {
    if (!d) return '';
    var s = String(d);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var t = new Date(d);
    return isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
  }
  function dayNo(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / DAY); }
  function isoOf(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function num(x) { var n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : null; }
  function sig(x) { return Number(x.toPrecision(7)); }

  function keyOf(category, symbol) {
    return String(category || 'crypto') + '|' + String(symbol || '').trim().toUpperCase();
  }

  // The Yahoo symbol the live quote uses for this holding.
  function yfSymbol(category, symbol, suffixCache) {
    var sym = String(symbol || '').trim().toUpperCase();
    if (category === 'commodities') return YF_COMMODITY[sym] || sym;
    if (sym.indexOf('.') !== -1) return sym;
    return (suffixCache && suffixCache[sym]) || YF_LEGACY[sym] || sym;
  }

  // Smallest Yahoo range token that reaches back to `fromISO`.
  function rangeFor(fromISO, todayISO) {
    var days = dayNo(todayISO) - dayNo(fromISO);
    if (!(days >= 0)) days = 0;
    if (days <= 25) return '1mo';
    if (days <= 85) return '3mo';
    if (days <= 175) return '6mo';
    if (days <= 360) return '1y';
    if (days <= 725) return '2y';
    if (days <= 1820) return '5y';
    if (days <= 3645) return '10y';
    return 'max';
  }

  // ---- store ---------------------------------------------------------------
  function empty() { return { v: SCHEMA, series: {}, miss: {} }; }
  function cleanEntry(e) {
    if (!e || typeof e !== 'object' || !Array.isArray(e.d) || !Array.isArray(e.p)) return null;
    var d = [], p = [], last = -Infinity;
    for (var i = 0; i < e.d.length && i < e.p.length; i++) {
      var dn = num(e.d[i]), px = num(e.p[i]);
      if (dn == null || px == null || !(px > 0) || dn <= last) continue;
      d.push(dn); p.push(px); last = dn;
    }
    if (!d.length) return null;
    var splits = (Array.isArray(e.splits) ? e.splits : []).filter(function (s) {
      return s && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) && num(s.num) > 0 && num(s.den) > 0;
    }).map(function (s) { return { date: s.date, num: num(s.num), den: num(s.den) }; });
    return {
      cur: String(e.cur || 'EUR'), src: String(e.src || ''), sym: String(e.sym || ''),
      from: /^\d{4}-\d{2}-\d{2}$/.test(String(e.from)) ? e.from : isoOf(d[0]),
      to: isoOf(d[d.length - 1]), req: /^\d{4}-\d{2}-\d{2}$/.test(String(e.req)) ? e.req : '',
      at: num(e.at) || 0, d: d, p: p, splits: splits
    };
  }
  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    var out = empty();
    if (!obj || typeof obj !== 'object' || !obj.series || typeof obj.series !== 'object') return out;
    Object.keys(obj.series).forEach(function (k) {
      var e = cleanEntry(obj.series[k]);
      if (e) out.series[k] = e;
    });
    if (obj.miss && typeof obj.miss === 'object') Object.keys(obj.miss).forEach(function (k) {
      var m = obj.miss[k];
      if (m && num(m.at) > 0 && !out.series[k]) out.miss[k] = { at: num(m.at), req: /^\d{4}-\d{2}-\d{2}$/.test(String(m.req)) ? m.req : '' };
    });
    return out;
  }
  function load() {
    if (typeof localStorage === 'undefined') return empty();
    try { return normalize(localStorage.getItem(KEY)); } catch (e) { return empty(); }
  }
  // false when the write failed (quota) - the caller keeps the data in memory.
  function save(store) {
    if (typeof localStorage === 'undefined') return false;
    try { localStorage.setItem(KEY, JSON.stringify(normalize(store))); return true; } catch (e) { return false; }
  }

  // [[iso, price]…] of an entry.
  function closesOf(entry) {
    var out = [];
    if (!entry) return out;
    for (var i = 0; i < entry.d.length; i++) out.push([isoOf(entry.d[i]), entry.p[i]]);
    return out;
  }

  // ---- ingestion -----------------------------------------------------------
  function build(rows, meta) {
    var by = {};
    rows.forEach(function (r) { if (r && r[0] && r[1] > 0) by[r[0]] = r[1]; }); // last value of a day wins
    var dates = Object.keys(by).sort();
    if (dates.length > MAX_POINTS) dates = dates.slice(dates.length - MAX_POINTS);
    if (!dates.length) return null;
    return {
      cur: meta.cur, src: meta.src, sym: meta.sym || '',
      from: dates[0], to: dates[dates.length - 1], req: '', at: meta.at || 0,
      d: dates.map(dayNo), p: dates.map(function (x) { return sig(by[x]); }),
      splits: meta.splits || []
    };
  }

  // Worker `?action=yf`: { currency, prices: [{ date, price }], splits: [{ date, numerator, denominator }] }
  function ingestYahoo(json, meta) {
    if (!json || json.error || !Array.isArray(json.prices)) return null;
    var rows = json.prices.map(function (r) { return [ymd(r && r.date), num(r && r.price)]; });
    var splits = (Array.isArray(json.splits) ? json.splits : []).map(function (s) {
      return { date: ymd(s && s.date), num: num(s && s.numerator), den: num(s && s.denominator) };
    }).filter(function (s) { return s.date && s.num > 0 && s.den > 0; });
    return build(rows, { cur: String(json.currency || 'USD'), src: 'yf', sym: (meta && meta.sym) || '', at: meta && meta.at, splits: splits });
  }

  // CoinGecko `market_chart?vs_currency=eur`: { prices: [[ms, eur]] }. Daily
  // points are stamped 00:00 UTC, i.e. the close of the PREVIOUS day; the final
  // point is "now" and belongs to today. Subtracting 1 ms maps both correctly.
  function ingestCoinGecko(json, meta) {
    if (!json || !Array.isArray(json.prices)) return null;
    var rows = json.prices.map(function (r) {
      var ms = num(r && r[0]);
      return [ms == null ? '' : new Date(ms - 1).toISOString().slice(0, 10), num(r && r[1])];
    });
    return build(rows, { cur: 'EUR', src: 'cg', sym: (meta && meta.sym) || '', at: meta && meta.at });
  }

  // Merge a freshly fetched series over a stored one (new values win).
  function mergeSeries(old, inc) {
    if (!inc) return old || null;
    if (!old || old.cur !== inc.cur || old.src !== inc.src) return inc;
    var by = {};
    for (var i = 0; i < old.d.length; i++) by[old.d[i]] = old.p[i];
    for (var j = 0; j < inc.d.length; j++) by[inc.d[j]] = inc.p[j];
    var days = Object.keys(by).map(Number).sort(function (a, b) { return a - b; });
    if (days.length > MAX_POINTS) days = days.slice(days.length - MAX_POINTS);
    var seen = {}, splits = [];
    (old.splits || []).concat(inc.splits || []).forEach(function (s) {
      if (seen[s.date]) return; seen[s.date] = true; splits.push(s);
    });
    splits.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return {
      cur: inc.cur, src: inc.src, sym: inc.sym || old.sym,
      from: old.from < inc.from ? old.from : inc.from,
      to: isoOf(days[days.length - 1]), req: old.req || '', at: inc.at || old.at,
      d: days, p: days.map(function (n) { return by[n]; }), splits: splits
    };
  }

  // ---- what is needed ------------------------------------------------------
  // Every holding that was ever bought or sold and has a history source:
  // { key: { key, category, symbol, first: 'YYYY-MM-DD' } }
  function need(transactions) {
    var out = {};
    (transactions || []).forEach(function (tx) {
      if (!tx || (tx.type !== 'buy' && tx.type !== 'sell')) return;
      var cat = tx.category || 'crypto';
      var sym = String(tx.symbol || tx.name || '').trim();
      var d = ymd(tx.date);
      if (!CATEGORIES[cat] || !sym || !d) return;
      var k = keyOf(cat, sym);
      if (!out[k]) out[k] = { key: k, category: cat, symbol: sym, first: d };
      else if (d < out[k].first) out[k].first = d;
    });
    return out;
  }

  // Fetch jobs for the current store. mode 'full' = the whole range from the
  // first trade; 'tail' = only the recent weeks (the series already reaches
  // back far enough and was last topped up more than REFRESH_MS ago).
  function plan(needMap, store, nowMs) {
    store = store && store.series ? store : empty();
    var jobs = [];
    Object.keys(needMap || {}).sort().forEach(function (k) {
      var n = needMap[k], e = store.series[k];
      var from = isoOf(dayNo(n.first) - LEAD_DAYS);
      if (!e) {
        var m = store.miss && store.miss[k];
        if (m && nowMs - m.at < MISS_MS && !(m.req && from < m.req)) return; // no history last time: not again today
        jobs.push({ key: k, category: n.category, symbol: n.symbol, mode: 'full', from: from }); return;
      }
      // Full fetch again only when a trade is now older than what was asked for
      // last time (an earlier trade was added or imported).
      if ((e.req || e.from) > from) {
        jobs.push({ key: k, category: n.category, symbol: n.symbol, mode: 'full', from: from }); return;
      }
      if (nowMs - (e.at || 0) >= REFRESH_MS) {
        jobs.push({ key: k, category: n.category, symbol: n.symbol, mode: 'tail', from: e.to });
      }
    });
    return jobs;
  }

  // ---- fetching ------------------------------------------------------------
  function getJson(fetchFn, url, timeoutMs) {
    var opts = {};
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(timeoutMs || 12000);
    return Promise.resolve(fetchFn(url, opts)).then(function (r) {
      if (!r || !r.ok) { var e = new Error('HTTP ' + (r ? r.status : 0)); e.status = r ? r.status : 0; throw e; }
      return r.json();
    });
  }
  // A MaerminTickers helper when the module is loaded (browser), else null.
  function tickerFn(name) {
    var T = (typeof window !== 'undefined' && window.MaerminTickers) || null;
    return T && typeof T[name] === 'function' ? T[name] : null;
  }
  function cgQueue() {
    var CG = (typeof window !== 'undefined' && window.MaerminCoinGecko) || null;
    return CG && typeof CG.getJson === 'function' ? CG.getJson : null;
  }
  function wait(ms) { return ms > 0 ? new Promise(function (r) { setTimeout(r, ms); }) : Promise.resolve(); }

  // Does a fetched series end near the live price? A ticker Yahoo files under
  // another coin is off by far more than a factor of two. No live price: yes.
  function plausible(series, live) {
    if (!series || !series.p.length) return false;
    if (!(live > 0)) return true;
    var last = series.p[series.p.length - 1];
    return last / live > 0.5 && last / live < 2;
  }

  function fetchCoinGecko(job, o) {
    // CoinGecko knows ids ("bitcoin"), not the tickers ("BTC") the exchange
    // sync and imports store.
    var id = o.cryptoId ? o.cryptoId(job.symbol) : String(job.symbol).toLowerCase();
    // The public API refuses ranges beyond a year (401): ask for at most 365 days.
    var days = Math.min(365, Math.max(2, dayNo(o.today) - dayNo(job.from) + 1));
    var url = 'https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(id) + '/market_chart?vs_currency=eur&days=' + days + '&interval=daily';
    // Through the shared CoinGecko queue when there is one (browser): low
    // priority behind the price refresh; a refusal comes back as status 429.
    var get = o.cgGet ? o.cgGet(url, { priority: 'low', timeoutMs: o.timeoutMs }) : getJson(o.fetch, url, o.timeoutMs);
    return get.then(function (j) { return ingestCoinGecko(j, { at: o.now, sym: id }); });
  }

  function fetchOne(job, o) {
    var today = o.today, meta = { at: o.now };
    if (job.category === 'crypto') {
      // Yahoo through the Worker first ("BTC-USD", years of daily closes, none
      // of CoinGecko's few-calls-a-minute limit); CoinGecko when Yahoo does not
      // know the coin or files the ticker under another one.
      var pair = o.workerBase && o.yahooCrypto ? o.yahooCrypto(job.symbol) : '';
      if (!pair) return fetchCoinGecko(job, o);
      var live = o.priceOf ? o.priceOf(job.symbol) : 0;
      return getJson(o.fetch, o.workerBase + '?action=yf&symbol=' + encodeURIComponent(pair) + '&interval=1d&range=' + rangeFor(job.from, today), o.timeoutMs)
        .then(function (j) { return ingestYahoo(j, { at: o.now, sym: pair }); }, function (e) { if (e && e.status === 429) throw e; return null; })
        .then(function (s) {
          if (plausible(s, live)) return s;
          return fetchCoinGecko(job, o).catch(function (e) {
            // CoinGecko busy: "try later", without stopping the Worker batch.
            if (e && e.status === 429) { var r = new Error('CoinGecko busy'); r.retry = true; throw r; }
            throw e;
          });
        });
    }
    if (!o.workerBase) return Promise.reject(new Error('no Worker'));
    var sym = yfSymbol(job.category, job.symbol, o.suffixCache);
    meta.sym = sym;
    // Not a ticker (a CS2 skin filed as a stock): no request, Yahoo would 404.
    if (o.isTicker && !o.isTicker(sym)) return Promise.reject(new Error('not a market symbol'));
    return getJson(o.fetch, o.workerBase + '?action=yf&symbol=' + encodeURIComponent(sym) + '&interval=1d&range=' + rangeFor(job.from, today), o.timeoutMs)
      .then(function (j) { return ingestYahoo(j, meta); });
  }

  // Run the plan. Never throws; resolves to
  //   { store, changed, fetched: [key], failed: [{ key, symbol, reason }], skipped: [key] }
  // opts: { transactions, store, fetch, workerBase, suffixCache,
  //         now, today, timeoutMs, chunk, chunkDelayMs, cryptoDelayMs, maxWorker, maxCrypto }
  // `skipped` = not tried in this run (no Worker, batch limit, rate limit) - try again later;
  // `failed`  = asked and no history came back.
  function sync(opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var o = {
      fetch: opts.fetch || (typeof fetch !== 'undefined' ? fetch : null),
      workerBase: String(opts.workerBase || '').trim().replace(/\/$/, ''),
      suffixCache: opts.suffixCache || {},
      cryptoId: opts.cryptoId || tickerFn('coinGeckoId'),
      cgGet: opts.cgGet || (opts.fetch ? null : cgQueue()),
      isTicker: opts.isTicker || tickerFn('isMarketSymbol'),
      yahooCrypto: opts.yahooCrypto || tickerFn('yahooCryptoSymbol'),
      priceOf: typeof opts.priceOf === 'function' ? opts.priceOf : null,
      now: now, today: opts.today || new Date(now).toISOString().slice(0, 10),
      timeoutMs: opts.timeoutMs || 12000
    };
    var store = normalize(opts.store || empty());
    var result = { store: store, changed: false, fetched: [], failed: [], skipped: [] };
    if (!o.fetch) return Promise.resolve(result);
    var jobs = plan(need(opts.transactions), store, now);
    // Crypto goes through the Worker (Yahoo) too when there is one and the coin
    // has a Yahoo pair; only the rest asks CoinGecko directly.
    function viaYahoo(j) { return j.category !== 'crypto' || !!(o.workerBase && o.yahooCrypto && o.yahooCrypto(j.symbol)); }
    var viaWorker = jobs.filter(viaYahoo);
    var crypto = jobs.filter(function (j) { return !viaYahoo(j); });

    function missed(job) { if (!store.series[job.key]) { store.miss[job.key] = { at: now, req: job.from }; result.changed = true; } }
    function apply(job, series) {
      if (!series) { result.failed.push({ key: job.key, symbol: job.symbol, reason: 'no history' }); missed(job); return; }
      delete store.miss[job.key];
      var old = store.series[job.key];
      // A split the stored closes do not know rescales all earlier closes, and
      // closes from another source (CoinGecko -> Yahoo) do not merge: the tail
      // cannot be used, the whole range has to be fetched again.
      if (job.mode === 'tail' && old && (old.src !== series.src || old.cur !== series.cur || (series.splits || []).some(function (s) { return s.date > old.to; }))) {
        return fetchOne({ key: job.key, category: job.category, symbol: job.symbol, mode: 'full', from: old.req || old.from }, o)
          .then(function (full) {
            if (!full) { result.failed.push({ key: job.key, symbol: job.symbol, reason: 'split: full history not available' }); return; }
            full.req = old.req || old.from; store.series[job.key] = full; result.changed = true; result.fetched.push(job.key);
          });
      }
      var merged = job.mode === 'tail' ? mergeSeries(old, series) : series;
      if (job.mode === 'full') merged.req = job.from;
      merged.at = now;
      store.series[job.key] = merged;
      result.changed = true;
      result.fetched.push(job.key);
    }
    function run(job) {
      return fetchOne(job, o).then(function (s) { return apply(job, s); })
        .catch(function (e) {
          if (e && e.retry) { result.skipped.push(job.key); return; }
          result.failed.push({ key: job.key, symbol: job.symbol, reason: (e && e.message) || 'failed', status: e && e.status });
          if (e && e.status === 404) missed(job); // the source does not know it (not: timeout, 429, 5xx)
        });
    }

    // Be a polite client: the Worker allows ~120 requests a minute per IP and the
    // price refresh needs most of them, CoinGecko's public API far fewer. So a
    // run takes a bounded batch, pauses between chunks and stops at the first
    // 429; whatever is left over is reported as `skipped` and picked up by the
    // next run.
    var chunk = opts.chunk || 4, p = Promise.resolve();
    var maxWorker = opts.maxWorker || 20, maxCrypto = opts.maxCrypto || 6;
    var chunkDelay = opts.chunkDelayMs == null ? 400 : opts.chunkDelayMs;
    var cryptoDelay = opts.cryptoDelayMs == null ? 2500 : opts.cryptoDelayMs;
    function limitedBy(job) {
      var f = result.failed[result.failed.length - 1];
      return !!(f && f.key === job.key && f.status === 429);
    }
    if (o.workerBase) {
      var stopWorker = false;
      viaWorker.slice(maxWorker).forEach(function (j) { result.skipped.push(j.key); });
      viaWorker = viaWorker.slice(0, maxWorker);
      for (var i = 0; i < viaWorker.length; i += chunk) {
        (function (part, first) {
          p = p.then(function () {
            if (stopWorker) { part.forEach(function (j) { result.skipped.push(j.key); }); return; }
            return wait(first ? 0 : chunkDelay).then(function () { return Promise.all(part.map(run)); }).then(function () {
              // a 429 is "try later", not "no history": hand those back as skipped
              var hit = result.failed.filter(function (f) { return f.status === 429 && part.some(function (j) { return j.key === f.key; }); });
              if (!hit.length) return;
              stopWorker = true;
              result.failed = result.failed.filter(function (f) { return hit.indexOf(f) === -1; });
              hit.forEach(function (f) { result.skipped.push(f.key); });
            });
          });
        })(viaWorker.slice(i, i + chunk), i === 0);
      }
    } else {
      viaWorker.forEach(function (j) { result.skipped.push(j.key); });
    }
    var limited = false;
    crypto.slice(maxCrypto).forEach(function (j) { result.skipped.push(j.key); });
    crypto.slice(0, maxCrypto).forEach(function (job, idx) {
      p = p.then(function () {
        if (limited) { result.skipped.push(job.key); return; }
        return wait(idx ? cryptoDelay : 0).then(function () { return run(job); }).then(function () {
          if (!limitedBy(job)) return;
          limited = true;
          result.failed.pop();
          result.skipped.push(job.key);
        });
      });
    });
    return p.then(function () { return result; }, function () { return result; });
  }

  var api = {
    KEY: KEY, SCHEMA: SCHEMA, REFRESH_MS: REFRESH_MS, MISS_MS: MISS_MS,
    YF_LEGACY: YF_LEGACY, YF_COMMODITY: YF_COMMODITY,
    keyOf: keyOf, yfSymbol: yfSymbol, rangeFor: rangeFor,
    normalize: normalize, load: load, save: save, closesOf: closesOf,
    ingestYahoo: ingestYahoo, ingestCoinGecko: ingestCoinGecko,
    mergeSeries: mergeSeries, need: need, plan: plan, sync: sync
  };
  if (typeof window !== 'undefined') window.MaerminCloseHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
