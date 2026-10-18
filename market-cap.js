// ============================================================================
// MAERMIN — Market-Cap Size Buckets (Large / Mid / Small)  (window.MaerminMarketCap)
// ----------------------------------------------------------------------------
// Competitive-gap WI-5. Parqet added a "company size" breakdown in 2026. MAERMIN
// had currency exposure but no size buckets. This classifies equity positions by
// EUR-normalised market capitalisation, alongside the Strategy tab's sector /
// country / currency breakdowns (additive, no new tab).
//
// Market cap comes from the Worker `action=fundamentals` route (Yahoo
// summaryDetail.marketCap, in the security's own currency) and is EUR-normalised
// here. A small 30-day localStorage cache (key maermin_marketcap_cache) mirrors
// the equity-metadata cache; it is a derived cache, not user data, so it is NOT
// in the backup. Buckets (EUR): Large >= 10 bn, Mid 2-10 bn, Small < 2 bn,
// Unknown separate. Pure layer Node-tested in test/market-cap.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var CACHE_KEY = 'maermin_marketcap_cache';
  var CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

  // EUR-normalised thresholds. Constants so the test and UI agree.
  var LARGE_MIN = 10e9; // >= 10 bn EUR
  var MID_MIN = 2e9;    // 2-10 bn EUR
  var ORDER = ['large', 'mid', 'small', 'unknown'];
  var LABELS = { get large() { return __('mcLarge', 'Large cap'); }, get mid() { return __('mcMid', 'Mid cap'); }, get small() { return __('mcSmall', 'Small cap'); }, get unknown() { return __('dqUnknown', 'Unknown'); } };

  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : NaN; }

  // EUR value of a market cap given in `currency` (USD * usdToEur, else as-is).
  function capToEUR(cap, currency, usdToEur) {
    var c = num(cap);
    if (!isFinite(c)) return null;
    if (currency === 'USD' && usdToEur > 0) return c * usdToEur;
    return c;
  }

  // Bucket for an EUR market cap. Missing/non-positive -> 'unknown'.
  function bucketFor(capEUR) {
    var c = num(capEUR);
    if (!isFinite(c) || c <= 0) return 'unknown';
    if (c >= LARGE_MIN) return 'large';
    if (c >= MID_MIN) return 'mid';
    return 'small';
  }

  // Aggregate rows [{ symbol, valueEUR, capEUR }] into size buckets. Returns
  // buckets in fixed order with EUR value + percent weight; weights sum to 100
  // including the Unknown bucket.
  function aggregate(rows, opts) {
    rows = Array.isArray(rows) ? rows : [];
    var sums = { large: 0, mid: 0, small: 0, unknown: 0 };
    var total = 0;
    rows.forEach(function (r) {
      var v = num(r && r.valueEUR);
      if (!isFinite(v) || v <= 0) return;
      var b = bucketFor(r.capEUR);
      sums[b] += v;
      total += v;
    });
    var buckets = ORDER.map(function (key) {
      return { key: key, label: LABELS[key], value: sums[key], weight: total > 0 ? (sums[key] / total) * 100 : 0 };
    });
    return { buckets: buckets, total: total };
  }

  // ---- cache + worker fetch (browser) --------------------------------------
  function loadCache() {
    try {
      var raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return (raw && typeof raw === 'object') ? raw : {};
    } catch (e) { return {}; }
  }
  function saveCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* non-fatal */ }
  }
  function cachedCap(symbol) {
    var cache = loadCache();
    var hit = cache[String(symbol).toUpperCase()];
    if (hit && (Date.now() - (hit.ts || 0)) < CACHE_TTL && isFinite(num(hit.cap))) {
      return { cap: hit.cap, currency: hit.currency || 'USD' };
    }
    return null;
  }

  // Fetch missing market caps from the Worker fundamentals route, warming the
  // cache. Injectable `fetchImpl` for tests; resolves to the warmed cache.
  function prefetchCaps(symbols, opts) {
    opts = opts || {};
    var workerUrl = opts.workerUrl;
    var fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!workerUrl || !fetchImpl || !Array.isArray(symbols) || !symbols.length) return Promise.resolve(loadCache());
    var cache = loadCache();
    // Only real tickers: a CS2 skin filed as a stock would just 404 upstream.
    var T = typeof window !== 'undefined' && window.MaerminTickers;
    var isTicker = (T && T.isMarketSymbol) ? T.isMarketSymbol : function () { return true; };
    var missing = symbols
      .map(function (s) { return String(s).toUpperCase(); })
      .filter(isTicker)
      .filter(function (s) { var NL = typeof window !== 'undefined' && window.MaerminCloseHistory && window.MaerminCloseHistory.noListing; return !(NL && NL.has(s)); })
      .filter(function (s) { var h = cache[s]; return !(h && (Date.now() - (h.ts || 0)) < CACHE_TTL); });
    if (!missing.length) return Promise.resolve(cache);
    var base = workerUrl.replace(/\/$/, '');
    return Promise.all(missing.map(function (sym) {
      var url = base + (base.indexOf('?') > -1 ? '&' : '?') + 'action=fundamentals&symbol=' + encodeURIComponent(sym);
      return fetchImpl(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (d && d.marketCap != null && isFinite(num(d.marketCap))) {
          cache[sym] = { cap: num(d.marketCap), currency: d.currency || 'USD', ts: Date.now() };
        } else {
          cache[sym] = { cap: null, currency: d && d.currency || 'USD', ts: Date.now() };
        }
      }).catch(function () { /* leave uncached so a later run can retry */ });
    })).then(function () { saveCache(cache); return cache; });
  }

  var api = {
    CACHE_KEY: CACHE_KEY, LARGE_MIN: LARGE_MIN, MID_MIN: MID_MIN, ORDER: ORDER, LABELS: LABELS,
    capToEUR: capToEUR, bucketFor: bucketFor, aggregate: aggregate,
    loadCache: loadCache, saveCache: saveCache, cachedCap: cachedCap, prefetchCaps: prefetchCaps
  };

  api.Panel = makePanel(api);

  if (typeof window !== 'undefined') window.MaerminMarketCap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view — a size-bucket breakdown for the Strategy tab (no new tab).
  // --------------------------------------------------------------------------
  function makePanel(API) {
    return function Panel(props) {
      var React = (typeof window !== 'undefined') ? window.React : null;
      if (!React) return null;
      var e = React.createElement;
      var useState = React.useState, useEffect = React.useEffect;
      try {
        var theme = props.theme || {};
        var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
        // R4.3: the shared Card and meters on the chart palette
        var UIC = window.MaerminComponents;
        var rate = props.exchangeRate || props.usdToEur || 1;
        var fmt = props.formatPrice || function (n) { return window.MaerminI18n.num(n, 2); };
        var COLORS = { large: 'var(--chart-1)', mid: 'var(--chart-2)', small: 'var(--chart-3)', unknown: 'var(--text-faint)' };

        var groups = props.portfolio || {};
        var prices = props.prices || {};
        var stocks = Array.isArray(groups.stocks) ? groups.stocks : [];

        var v0 = useState(0); var ver = v0[0], setVer = v0[1];
        useEffect(function () {
          var syms = stocks.map(function (p) { return p.symbol; }).filter(Boolean);
          if (!syms.length || !props.workerUrl) return;
          API.prefetchCaps(syms, { workerUrl: props.workerUrl }).then(function () { setVer(function (x) { return x + 1; }); }).catch(function () {});
        }, [stocks.length, props.workerUrl]);
        void ver;

        var rows = stocks.map(function (p) {
          var sym = p.symbol;
          var raw = prices[sym] != null ? prices[sym] : prices[String(sym).toLowerCase()];
          var px = (raw && typeof raw === 'object') ? num(raw.price || raw.value) : num(raw);
          if (!(px > 0)) px = num(p.purchasePrice);
          var valueEUR = num(p.amount) * (isFinite(px) ? px : 0);
          var hit = API.cachedCap(sym);
          var capEUR = hit ? API.capToEUR(hit.cap, hit.currency, rate) : null;
          return { symbol: sym, valueEUR: valueEUR, capEUR: capEUR };
        });
        var agg = API.aggregate(rows, {});

        var bars = agg.buckets.map(function (b) {
          return e('li', { key: b.key },
            e('span', { className: 'ui-meters__label' },
              e('b', null, API.LABELS[b.key] === 'Large cap' ? (t.mcLarge || 'Large cap') : API.LABELS[b.key] === 'Mid cap' ? (t.mcMid || 'Mid cap') : API.LABELS[b.key] === 'Small cap' ? (t.mcSmall || 'Small cap') : (t.mcUnknown || 'Unknown')),
              e('span', { className: 'num' }, window.MaerminI18n.pct(b.weight, 1) + '  ·  ' + fmt(b.value))),
            e('span', { className: 'ui-meter', 'aria-hidden': 'true' },
              e('span', { className: 'ui-meter__fill', style: { width: Math.max(0, Math.min(100, b.weight)) + '%', background: COLORS[b.key] } })));
        });

        return e(UIC.Card, { title: t.mcTitle || 'Company size', subtitle: t.mcSubtitle || 'Equity allocation by market-cap size (EUR-normalised)', headingLevel: 'h3', 'data-testid': 'market-cap' },
          agg.total > 0 ? e('ul', { className: 'ui-meters' }, bars) : e('p', { className: 'ui-muted' }, t.mcEmpty || 'No equity positions to size yet.'));
      } catch (err) {
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || 'var(--danger)' } }, __('mcError', 'Market cap error: ') + (err && err.message));
      }
    };
  }
})();
