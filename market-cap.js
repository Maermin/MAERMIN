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

  var CACHE_KEY = 'maermin_marketcap_cache';
  var CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

  // EUR-normalised thresholds. Constants so the test and UI agree.
  var LARGE_MIN = 10e9; // >= 10 bn EUR
  var MID_MIN = 2e9;    // 2-10 bn EUR
  var ORDER = ['large', 'mid', 'small', 'unknown'];
  var LABELS = { large: 'Large cap', mid: 'Mid cap', small: 'Small cap', unknown: 'Unknown' };

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
    var missing = symbols
      .map(function (s) { return String(s).toUpperCase(); })
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
        var t = props.t || {};
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f';
        var rate = props.exchangeRate || props.usdToEur || 1;
        var fmt = props.formatPrice || function (n) { return (Math.round(n * 100) / 100).toLocaleString(); };
        var COLORS = { large: theme.accent || '#f5a524', mid: '#3b82f6', small: '#14b8a6', unknown: theme.textSecondary || '#6b7280' };

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
          return e('div', { key: b.key, style: { marginBottom: '0.6rem' } },
            e('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' } },
              e('span', { style: { color: text, fontWeight: 600 } }, API.LABELS[b.key] === 'Large cap' ? (t.mcLarge || 'Large cap') : API.LABELS[b.key] === 'Mid cap' ? (t.mcMid || 'Mid cap') : API.LABELS[b.key] === 'Small cap' ? (t.mcSmall || 'Small cap') : (t.mcUnknown || 'Unknown')),
              e('span', { style: { color: dim } }, b.weight.toFixed(1) + '%  ·  ' + fmt(b.value))),
            e('div', { style: { height: 8, borderRadius: 6, background: theme.inputBg || '#0c1018', overflow: 'hidden' } },
              e('div', { style: { width: Math.max(0, Math.min(100, b.weight)) + '%', height: '100%', background: COLORS[b.key], transition: 'width 0.3s' } })));
        });

        return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', margin: '1rem 1.5rem' } },
          e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem' } }, t.mcTitle || 'Company size'),
          e('div', { style: { color: dim, fontSize: '0.76rem', marginBottom: '0.9rem' } }, t.mcSubtitle || 'Equity allocation by market-cap size (EUR-normalised)'),
          agg.total > 0 ? bars : e('div', { style: { color: dim, fontSize: '0.84rem' } }, t.mcEmpty || 'No equity positions to size yet.'));
      } catch (err) {
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, 'Market cap error: ' + (err && err.message));
      }
    };
  }
})();
