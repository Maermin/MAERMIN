// ============================================================================
// MAERMIN — Historical FX Rates  (window.MaerminFxHistory)
// ----------------------------------------------------------------------------
// The app converts every USD transaction to EUR with ONE live USD→EUR rate.
// That is wrong for cost basis and German tax, which require the rate AT THE
// TRANSACTION DATE (the ECB reference rate of the day). This module keeps a
// small local cache of daily USD→EUR rates and resolves the right rate for any
// date, so buildPositions / the tax report can price each lot on its own day.
//
//   load() / save(map) / merge(map)     persisted at localStorage[KEY]
//   ingestYahooSeries(json)             turn the Worker's EURUSD=X response
//                                        (USD per 1 EUR) into { date: usdEur }
//   rateAt(history, dateISO, fallback)  nearest-on-or-before lookup (pure)
//   fxResolver(fallback, history?)      → (dateISO) => rate, O(log n) per call
//
// Other fiat currencies (CHF, GBP, …) have their own daily history, one series
// per currency that occurs in the transactions, from the Worker's
// `?action=yf&symbol=EUR<CUR>=X` (units of CUR per 1 EUR):
//   currenciesNeeded(transactions)      { CHF: firstTradeDate, … }
//   syncCurrencies({ transactions, workerBase, fetch })   fetch what is missing
//   currencyRateAt(cur, dateISO)        EUR per 1 unit on that day | null
// txToEUR uses it, so every consumer (ledger, tax report, XIRR, fees) converts
// such a trade at the rate of ITS date. Stored at localStorage[CUR_KEY]
// (sensitive: it lists the currencies traded and since when).
//
// Pure + Node-tested. Fetching the series is the renderer's job (best effort via
// the Cloudflare Worker); everything here is offline + deterministic. FX rates
// are public market data, so this cache is NOT a SENSITIVE_KEY.
// ============================================================================
(function () {
  'use strict';

  var KEY = 'maermin_fx_history'; // { 'YYYY-MM-DD': usdToEur }

  function ymd(d) {
    if (!d) return '';
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    try { var t = new Date(d); return isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10); }
    catch (e) { return ''; }
  }
  function num(x) { var n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : null; }

  function load() {
    if (typeof localStorage === 'undefined') return {};
    try { var raw = localStorage.getItem(KEY); var o = raw ? JSON.parse(raw) : {}; return (o && typeof o === 'object') ? o : {}; }
    catch (e) { return {}; }
  }
  function save(map) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(KEY, JSON.stringify(map || {})); } catch (e) { /* quota / unavailable */ }
  }
  // Merge new rates into the stored cache (new values win). Returns the merged map.
  function merge(newMap) {
    var cur = load();
    if (newMap && typeof newMap === 'object') {
      Object.keys(newMap).forEach(function (k) {
        var d = ymd(k), r = num(newMap[k]);
        if (d && r != null && r > 0) cur[d] = r;
      });
    }
    save(cur);
    return cur;
  }

  // The Worker's `?action=yf&symbol=EURUSD=X` response is { prices:[{date, price}] }
  // where price = USD per 1 EUR (e.g. 1.08). USD→EUR = 1 / price. Produces a
  // { 'YYYY-MM-DD': usdToEur } map; rows with a non-positive price are dropped.
  function ingestYahooSeries(json) {
    var out = {};
    var prices = json && json.prices;
    if (!Array.isArray(prices)) return out;
    prices.forEach(function (p) {
      var d = ymd(p && p.date);
      var eurUsd = num(p && p.price);
      if (d && eurUsd != null && eurUsd > 0) out[d] = 1 / eurUsd; // USD→EUR
    });
    return out;
  }

  // Nearest rate on or before `dateISO`. If the date precedes all data, the
  // EARLIEST known rate is used (closer than today's); if it is after all data,
  // the LATEST known rate. Empty history → `fallback`. Pure.
  function rateAt(history, dateISO, fallback) {
    var fb = num(fallback);
    if (!history || typeof history !== 'object') return fb;
    var keys = Object.keys(history);
    if (!keys.length) return fb;
    var target = ymd(dateISO);
    if (!target) return fb != null ? fb : pick(history, keys.sort()[keys.length - 1]);
    keys.sort();
    // binary search for the last key <= target
    var lo = 0, hi = keys.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (keys[mid] <= target) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (ans === -1) return pick(history, keys[0]);          // before all data → earliest
    return pick(history, keys[ans]);
  }
  function pick(history, key) { var r = num(history[key]); return r != null && r > 0 ? r : null; }

  // Bind a fast resolver: pre-sorts the keys ONCE so each lookup is O(log n) —
  // matters for 10k+ transactions. Returns (dateISO) => rate, falling back to
  // `fallback` (the live rate) when the cache is empty or has no usable value.
  function fxResolver(fallback, history) {
    var fb = num(fallback);
    var hist = history || load();
    var keys = Object.keys(hist).filter(function (k) { return pick(hist, k) != null; }).sort();
    if (!keys.length) return function () { return fb; };
    return function (dateISO) {
      var target = ymd(dateISO);
      if (!target) return fb != null ? fb : pick(hist, keys[keys.length - 1]);
      var lo = 0, hi = keys.length - 1, ans = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (keys[mid] <= target) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
      }
      var r = pick(hist, ans === -1 ? keys[0] : keys[ans]);
      return r != null ? r : fb;
    };
  }

  // ---- other quote currencies ---------------------------------------------
  // Yahoo quotes many listings in neither EUR nor USD (LSE in GBp pence, SIX in
  // CHF, ...). The app used to multiply every non-EUR quote by the USD rate
  // (a GBp price came out ~100x too high). `usdRates` is the open.er-api
  // "latest/USD" map: units of each currency per 1 USD (EUR, GBP, CHF, ...).
  var RATES_KEY = 'maermin_fx_usd_rates';
  var _usdRates = null;
  function setUsdRates(rates) {
    if (!rates || typeof rates !== 'object') return;
    _usdRates = rates;
    if (typeof localStorage !== 'undefined') { try { localStorage.setItem(RATES_KEY, JSON.stringify(rates)); } catch (e) {} }
  }
  function usdRates() {
    if (_usdRates) return _usdRates;
    if (typeof localStorage !== 'undefined') {
      try { var r = JSON.parse(localStorage.getItem(RATES_KEY) || 'null'); if (r && typeof r === 'object') _usdRates = r; } catch (e) {}
    }
    return _usdRates || {};
  }
  // Minor units quoted by exchanges: price / 100 in the major currency.
  var MINOR = { GBP_: 'GBP', GBX: 'GBP', ZAC: 'ZAR', ILA: 'ILS' };
  // Convert a quote to EUR. usdToEur = EUR per 1 USD (the app's live rate).
  // Returns null when the currency is unknown and no rate is available, so
  // callers can leave the price unresolved instead of booking a wrong value.
  function quoteToEUR(price, currency, usdToEur, rates) {
    var p = num(price);
    if (p == null) return null;
    var cur = String(currency || 'USD').trim() || 'USD';
    if (cur === 'GBp') cur = 'GBP_';
    cur = cur.toUpperCase() === 'GBP_' ? 'GBP_' : cur.toUpperCase();
    if (MINOR[cur]) { p = p / 100; cur = MINOR[cur]; }
    if (cur === 'EUR') return p;
    var uE = num(usdToEur);
    if (cur === 'USD') return uE > 0 ? p * uE : null;
    rates = rates || usdRates();
    var perUsd = num(rates[cur]);
    var eurPerUsd = uE > 0 ? uE : num(rates.EUR);
    if (!(perUsd > 0) || !(eurPerUsd > 0)) return null;
    return (p / perUsd) * eurPerUsd;
  }

  // ---- daily history for other fiat currencies ------------------------------
  var CUR_KEY = 'maermin_fx_currencies';
  // { v: 1, cur: { CHF: { req, at, d: [dayNumber…], r: [EUR per 1 CHF…] } }, miss: { XXX: at } }
  var DAY = 86400000;
  var CUR_REFRESH_MS = 12 * 3600 * 1000;  // top up a covered currency at most twice a day
  var CUR_MISS_MS = 24 * 3600 * 1000;     // a currency the source does not know: ask again after a day
  var CUR_MAX_GAP_DAYS = 7;               // a fixing older than this is not "the rate of that date"
  var CUR_LEAD_DAYS = 10;                 // fetch from a few days before the first trade (prior fixing)
  // Currencies with a Yahoo EUR cross. Anything else (a crypto quote like BTC,
  // a typo) is never requested and stays 'unknown' / 'approx' as before.
  var FIAT = ['CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON',
    'HKD', 'SGD', 'CNY', 'INR', 'KRW', 'TWD', 'THB', 'BRL', 'MXN', 'ZAR', 'TRY', 'ILS'];
  var FIAT_SET = {}; FIAT.forEach(function (c) { FIAT_SET[c] = true; });

  // 'GBp' / 'GBX' (pence) → { cur: 'GBP', div: 100 }; plain codes → div 1.
  function majorOf(currency) {
    var raw = String(currency || '').trim();
    var up = raw.toUpperCase();
    if (raw === 'GBp' || up === 'GBX') return { cur: 'GBP', div: 100 };
    if (up === 'ZAC') return { cur: 'ZAR', div: 100 };
    if (up === 'ILA') return { cur: 'ILS', div: 100 };
    return { cur: up, div: 1 };
  }
  function hasHistory(currency) { return !!FIAT_SET[majorOf(currency).cur]; }
  function dayNo(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / DAY); }
  function isoOfDay(n) { return new Date(n * DAY).toISOString().slice(0, 10); }

  // Parsed store, cached together with the raw string it was parsed from: a
  // lock (the shim then returns null), a sync from another device or a restore
  // changes the stored string, and the cache follows instead of serving - or
  // later overwriting - newer data with an old copy.
  var _cur = null, _curRaw = null;
  function emptyCur() { return { v: 1, cur: {}, miss: {} }; }
  function normalizeCurrencies(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    var out = emptyCur();
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(obj.cur || {}).forEach(function (c) {
      var e = obj.cur[c];
      if (!FIAT_SET[c] || !e || !Array.isArray(e.d) || !Array.isArray(e.r)) return;
      var d = [], r = [], last = -Infinity;
      for (var i = 0; i < e.d.length && i < e.r.length; i++) {
        var dn = num(e.d[i]), rate = num(e.r[i]);
        if (dn == null || rate == null || !(rate > 0) || dn <= last) continue;
        d.push(dn); r.push(rate); last = dn;
      }
      if (d.length) out.cur[c] = { req: ymd(e.req) || isoOfDay(d[0]), at: num(e.at) || 0, d: d, r: r };
    });
    Object.keys(obj.miss || {}).forEach(function (c) { if (FIAT_SET[c] && num(obj.miss[c]) > 0 && !out.cur[c]) out.miss[c] = num(obj.miss[c]); });
    return out;
  }
  function loadCurrencies() {
    if (typeof localStorage === 'undefined') return _cur || (_cur = emptyCur());
    var raw = null;
    try { raw = localStorage.getItem(CUR_KEY); } catch (e) { raw = null; }
    if (_cur && raw === _curRaw) return _cur;
    _curRaw = raw;
    _cur = normalizeCurrencies(raw);
    return _cur;
  }
  // Replace the store (and persist where there is a localStorage). Returns false
  // when the write failed; the data then stays usable for this session.
  function saveCurrencies(store) {
    _cur = normalizeCurrencies(store);
    if (typeof localStorage === 'undefined') return false;
    try {
      localStorage.setItem(CUR_KEY, JSON.stringify(_cur));
      _curRaw = localStorage.getItem(CUR_KEY); // null while locked (write dropped): the next load starts empty
      return _curRaw !== null;
    } catch (e) { return false; }
  }
  function resetCurrencyCache() { _cur = null; _curRaw = null; }

  // EUR per 1 unit of `currency` on `dateISO` (last fixing on or before it, at
  // most CUR_MAX_GAP_DAYS earlier - weekends and holidays), or null when the
  // history does not reach that date: a date before the first stored day is NOT
  // answered with a later rate, and a history that was not topped up is NOT
  // answered with an old one. The caller then falls back to 'approx'.
  function currencyRateAt(currency, dateISO) {
    var m = majorOf(currency), e = loadCurrencies().cur[m.cur];
    var target = ymd(dateISO);
    if (!e || !target) return null;
    var t = dayNo(target), lo = 0, hi = e.d.length - 1, ans = -1;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (e.d[mid] <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; } }
    if (ans === -1 || t - e.d[ans] > CUR_MAX_GAP_DAYS) return null;
    return e.r[ans] / m.div;
  }

  // Worker `?action=yf&symbol=EURCHF=X`: { prices: [{ date, price }] }, price =
  // CHF per 1 EUR → EUR per 1 CHF = 1 / price. → { d: [dayNo], r: [rate] } | null
  // The Worker labels a bar with the UTC date of its timestamp. Yahoo stamps
  // daily FX bars at local midnight of the exchange time zone (Europe/London),
  // which in summer is 23:00 UTC of the day BEFORE - Monday's bar would be
  // filed under Sunday. So the day is taken from `ts` in `exchangeTz` when both
  // are present, and from `date` otherwise.
  function barDate(p, tz) {
    var ts = num(p && p.ts);
    if (ts != null && tz && typeof Intl !== 'undefined') {
      try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts * 1000)); }
      catch (e) { /* unknown zone -> the Worker's date */ }
    }
    return ymd(p && p.date);
  }
  function ingestYahooCross(json) {
    var prices = json && !json.error && json.prices;
    if (!Array.isArray(prices)) return null;
    var by = {}, tz = json.exchangeTz && json.exchangeTz !== 'UTC' ? String(json.exchangeTz) : '';
    prices.forEach(function (p) {
      var d = ymd(barDate(p, tz)), px = num(p && p.price);
      if (d && px != null && px > 0) by[dayNo(d)] = Number((1 / px).toPrecision(8));
    });
    var days = Object.keys(by).map(Number).sort(function (a, b) { return a - b; });
    return days.length ? { d: days, r: days.map(function (n) { return by[n]; }) } : null;
  }

  // Fiat currencies of the transactions that have a history source, each with
  // the date of its earliest transaction: { CHF: '2023-04-11', GBP: … }
  function currenciesNeeded(transactions) {
    var out = {};
    (transactions || []).forEach(function (tx) {
      if (!tx || !tx.currency) return;
      var c = majorOf(tx.currency).cur, d = ymd(tx.date);
      if (!FIAT_SET[c] || !d || !isFinite(dayNo(d))) return; // an impossible date (2024-13-01) is no reason to fetch
      if (!out[c] || d < out[c]) out[c] = d;
    });
    return out;
  }

  function fxRange(fromISO, todayISO) {
    var days = dayNo(todayISO) - dayNo(fromISO);
    return days <= 25 ? '1mo' : days <= 85 ? '3mo' : days <= 175 ? '6mo' : days <= 360 ? '1y' : days <= 725 ? '2y'
      : days <= 1820 ? '5y' : days <= 3645 ? '10y' : 'max';
  }

  // What to fetch: [{ cur, from, mode: 'full' | 'tail' }]
  function planCurrencies(needed, store, nowMs) {
    store = store || emptyCur();
    var jobs = [];
    Object.keys(needed || {}).sort().forEach(function (c) {
      var from = isoOfDay(dayNo(needed[c]) - CUR_LEAD_DAYS), e = store.cur[c];
      if (!e) {
        if (store.miss[c] && nowMs - store.miss[c] < CUR_MISS_MS) return;
        jobs.push({ cur: c, from: from, mode: 'full' }); return;
      }
      if (e.req > from) { jobs.push({ cur: c, from: from, mode: 'full' }); return; } // an earlier trade appeared
      if (nowMs - e.at >= CUR_REFRESH_MS) jobs.push({ cur: c, from: isoOfDay(e.d[e.d.length - 1]), mode: 'tail' });
    });
    return jobs;
  }

  // Fetch the missing currency histories through the Worker. Never throws.
  //   opts: { transactions, workerBase, fetch, now, today, store?, timeoutMs }
  //   → { store, changed, fetched: [cur], failed: [{ cur, reason }] }
  function syncCurrencies(opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var today = opts.today || new Date(now).toISOString().slice(0, 10);
    var base = String(opts.workerBase || '').trim().replace(/\/$/, '');
    var fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    var store = normalizeCurrencies(opts.store || loadCurrencies());
    var result = { store: store, changed: false, fetched: [], failed: [] };
    if (!base || !fetchFn) return Promise.resolve(result);
    var jobs;
    try { jobs = planCurrencies(currenciesNeeded(opts.transactions), store, now); } catch (e) { return Promise.resolve(result); }
    var p = Promise.resolve();
    jobs.forEach(function (job) {
      p = p.then(function () {
        var url = base + '?action=yf&symbol=' + encodeURIComponent('EUR' + job.cur + '=X') + '&interval=1d&range=' + fxRange(job.from, today);
        var init = {};
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(opts.timeoutMs || 10000);
        return Promise.resolve(fetchFn(url, init)).then(function (r) {
          if (!r || !r.ok) { var e = new Error('HTTP ' + (r ? r.status : 0)); e.status = r ? r.status : 0; throw e; }
          return r.json();
        }).then(function (json) {
          var inc = ingestYahooCross(json);
          if (!inc) { result.failed.push({ cur: job.cur, reason: 'no rates' }); if (!store.cur[job.cur]) { store.miss[job.cur] = now; result.changed = true; } return; }
          var old = store.cur[job.cur], by = {};
          if (old && job.mode === 'tail') for (var i = 0; i < old.d.length; i++) by[old.d[i]] = old.r[i];
          for (var j = 0; j < inc.d.length; j++) by[inc.d[j]] = inc.r[j];
          var days = Object.keys(by).map(Number).sort(function (a, b) { return a - b; });
          store.cur[job.cur] = { req: job.mode === 'full' ? job.from : old.req, at: now, d: days, r: days.map(function (n) { return by[n]; }) };
          delete store.miss[job.cur];
          result.changed = true; result.fetched.push(job.cur);
        }).catch(function (e) {
          result.failed.push({ cur: job.cur, reason: (e && e.message) || 'failed' });
          if (e && e.status === 404 && !store.cur[job.cur]) { store.miss[job.cur] = now; result.changed = true; }
        });
      });
    });
    return p.then(function () { return result; }, function () { return result; });
  }

  // ---- transaction amounts -> EUR -------------------------------------------
  // The ONE conversion for booked amounts (price, fees, dividends) of a
  // transaction. Returns { value, status } where status is
  //   'exact'   EUR, or USD / a USD stablecoin at the rate of the tx date
  //             (fxAt(date), falling back to the static `rate`)
  //             another fiat currency (CHF, GBP, JPY, ...) when its daily
  //             history covers the tx date (currencyRateAt)
  //   'approx'  another fiat currency WITHOUT a stored rate for that date (no
  //             Worker, not loaded yet, date before the history): converted
  //             with the CURRENT cross rate
  //   'unknown' no rate (e.g. a crypto quote like BTC or BNB): the amount is
  //             returned unconverted so totals don't collapse to 0, and the
  //             caller must flag it (data-quality issue).
  var USD_PEGGED = { USD: 1, USDT: 1, USDC: 1, BUSD: 1, FDUSD: 1, TUSD: 1, USDP: 1, DAI: 1 };
  function txToEUR(amount, currency, dateISO, rate, fxAt, rates) {
    var a = num(amount) || 0;
    var cur = String(currency || 'EUR').trim();
    var up = cur.toUpperCase();
    if (up === 'EUR' || up === '') return { value: a, status: 'exact' };
    if (USD_PEGGED[up]) {
      var r = (typeof fxAt === 'function' && dateISO) ? (fxAt(dateISO) || rate) : rate;
      r = num(r);
      return r > 0 ? { value: a * r, status: 'exact' } : { value: a, status: 'unknown' };
    }
    var dated = dateISO ? currencyRateAt(cur, dateISO) : null;
    if (dated > 0) return { value: a * dated, status: 'exact' };
    var v = quoteToEUR(a, cur, rate, rates);
    return v == null ? { value: a, status: 'unknown' } : { value: v, status: 'approx' };
  }

  // Currencies of a transaction list that do NOT convert exactly yet, for the
  // import preview: [{ currency, status, count }] with status
  //   'history'  fiat with a daily history source: converted at the rate of each
  //              trade date once the rates are loaded through the Worker
  //   'approx'   fiat without one: today's cross rate for every date
  //   'unknown'  no rate at all
  function currencyReport(transactions, rate, rates) {
    var by = {};
    (transactions || []).forEach(function (tx) {
      if (!tx) return;
      var st = txToEUR(1, tx.currency, tx.date, rate || 1, null, rates).status;
      if (st === 'exact') return;
      if (st === 'approx' && hasHistory(tx.currency)) st = 'history';
      var k = String(tx.currency);
      (by[k] = by[k] || { currency: k, status: st, count: 0 }).count++;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  function has() { var h = load(); return Object.keys(h).length > 0; }

  var api = {
    KEY: KEY,
    load: load, save: save, merge: merge,
    ingestYahooSeries: ingestYahooSeries,
    rateAt: rateAt,
    fxResolver: fxResolver,
    setUsdRates: setUsdRates,
    usdRates: usdRates,
    quoteToEUR: quoteToEUR,
    txToEUR: txToEUR,
    currencyReport: currencyReport,
    USD_PEGGED: USD_PEGGED,
    CUR_KEY: CUR_KEY, FIAT: FIAT, hasHistory: hasHistory, majorOf: majorOf,
    currencyRateAt: currencyRateAt, ingestYahooCross: ingestYahooCross,
    currenciesNeeded: currenciesNeeded, planCurrencies: planCurrencies, syncCurrencies: syncCurrencies,
    loadCurrencies: loadCurrencies, saveCurrencies: saveCurrencies, normalizeCurrencies: normalizeCurrencies,
    resetCurrencyCache: resetCurrencyCache,
    has: has
  };
  if (typeof window !== 'undefined') window.MaerminFxHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
