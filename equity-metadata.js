// ============================================================================
// MAERMIN — Equity Metadata Service  (window.MaerminEquityMeta)
// ----------------------------------------------------------------------------
// Strategy tab fix: Sector and Country allocation were driven by tiny hardcoded
// maps (~16 sectors, ~40 countries), so almost everything fell into "Other".
// This is the single source for per-ticker sector + country metadata:
//
//   getMeta(symbol)          → { sector, country, industry, source } (sync:
//                              cache → expanded static map → 'Other')
//   prefetchPortfolio(pf)    → fetch missing tickers from the FMP profile API
//                              (when a key is set) and warm the cache. No key →
//                              static-only, still far better than before.
//
// Same architecture as dividend-data-service.js: 30-day localStorage cache,
// ticker normalisation via MaerminTickers, FMP key shared
// (localStorage 'maermin_fmp_api_key'). Pure-ish + unit-tested
// (test/equity-meta.test.js).
// ============================================================================
(function () {
  'use strict';

  var FMP_BASE = 'https://financialmodelingprep.com/api/v3';
  var API_KEY_STORAGE = 'maermin_fmp_api_key';
  var CACHE_KEY = 'maermin_equity_meta_cache';
  var CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days — metadata is near-static

  // Expanded static fallback so coverage is decent even with no API key. Keyed
  // by the canonical ticker (exchange suffix kept, e.g. SAP.DE). Values:
  // [sector, country].
  var STATIC = {
    // US mega/large cap
    AAPL: ['Technology', 'USA'], MSFT: ['Technology', 'USA'], GOOGL: ['Communication Services', 'USA'],
    GOOG: ['Communication Services', 'USA'], AMZN: ['Consumer Discretionary', 'USA'], NVDA: ['Technology', 'USA'],
    META: ['Communication Services', 'USA'], TSLA: ['Consumer Discretionary', 'USA'], AVGO: ['Technology', 'USA'],
    AMD: ['Technology', 'USA'], INTC: ['Technology', 'USA'], CRM: ['Technology', 'USA'], ORCL: ['Technology', 'USA'],
    ADBE: ['Technology', 'USA'], CSCO: ['Technology', 'USA'], QCOM: ['Technology', 'USA'], TXN: ['Technology', 'USA'],
    JNJ: ['Healthcare', 'USA'], PFE: ['Healthcare', 'USA'], UNH: ['Healthcare', 'USA'], LLY: ['Healthcare', 'USA'],
    ABBV: ['Healthcare', 'USA'], MRK: ['Healthcare', 'USA'], TMO: ['Healthcare', 'USA'], ABT: ['Healthcare', 'USA'],
    JPM: ['Financials', 'USA'], BAC: ['Financials', 'USA'], WFC: ['Financials', 'USA'], GS: ['Financials', 'USA'],
    MS: ['Financials', 'USA'], V: ['Financials', 'USA'], MA: ['Financials', 'USA'], BRK: ['Financials', 'USA'],
    'BRK-B': ['Financials', 'USA'], 'BRK-A': ['Financials', 'USA'], AXP: ['Financials', 'USA'],
    HD: ['Consumer Discretionary', 'USA'], MCD: ['Consumer Discretionary', 'USA'], NKE: ['Consumer Discretionary', 'USA'],
    SBUX: ['Consumer Discretionary', 'USA'], LOW: ['Consumer Discretionary', 'USA'],
    KO: ['Consumer Staples', 'USA'], PEP: ['Consumer Staples', 'USA'], PG: ['Consumer Staples', 'USA'],
    COST: ['Consumer Staples', 'USA'], WMT: ['Consumer Staples', 'USA'], MO: ['Consumer Staples', 'USA'], PM: ['Consumer Staples', 'USA'],
    XOM: ['Energy', 'USA'], CVX: ['Energy', 'USA'], COP: ['Energy', 'USA'],
    DIS: ['Communication Services', 'USA'], NFLX: ['Communication Services', 'USA'], T: ['Communication Services', 'USA'], VZ: ['Communication Services', 'USA'],
    BA: ['Industrials', 'USA'], CAT: ['Industrials', 'USA'], GE: ['Industrials', 'USA'], MMM: ['Industrials', 'USA'], HON: ['Industrials', 'USA'], UPS: ['Industrials', 'USA'],
    O: ['Real Estate', 'USA'], MAIN: ['Financials', 'USA'], STAG: ['Real Estate', 'USA'],
    // US ETFs (treated as their broad exposure)
    SPY: ['ETF', 'USA'], VOO: ['ETF', 'USA'], QQQ: ['ETF', 'USA'], VTI: ['ETF', 'USA'],
    VYM: ['ETF', 'USA'], SCHD: ['ETF', 'USA'], VIG: ['ETF', 'USA'], HDV: ['ETF', 'USA'], SPYD: ['ETF', 'USA'],
    // Germany (Xetra)
    'SAP.DE': ['Technology', 'Germany'], 'SIE.DE': ['Industrials', 'Germany'], 'ALV.DE': ['Financials', 'Germany'],
    'BMW.DE': ['Consumer Discretionary', 'Germany'], 'BAS.DE': ['Materials', 'Germany'], 'MBG.DE': ['Consumer Discretionary', 'Germany'],
    'VOW3.DE': ['Consumer Discretionary', 'Germany'], 'DTE.DE': ['Communication Services', 'Germany'], 'IFX.DE': ['Technology', 'Germany'],
    'AIR.DE': ['Industrials', 'Germany'], 'DBK.DE': ['Financials', 'Germany'], 'ADS.DE': ['Consumer Discretionary', 'Germany'],
    // Other Europe
    'ASML.AS': ['Technology', 'Netherlands'], 'ADYEN.AS': ['Technology', 'Netherlands'],
    'MC.PA': ['Consumer Discretionary', 'France'], 'OR.PA': ['Consumer Staples', 'France'], 'AIR.PA': ['Industrials', 'France'], 'TTE.PA': ['Energy', 'France'],
    'NESN.SW': ['Consumer Staples', 'Switzerland'], 'ROG.SW': ['Healthcare', 'Switzerland'], 'NOVN.SW': ['Healthcare', 'Switzerland'],
    'AZN.L': ['Healthcare', 'UK'], 'HSBA.L': ['Financials', 'UK'], 'SHEL.L': ['Energy', 'UK'], 'BP.L': ['Energy', 'UK'], 'ULVR.L': ['Consumer Staples', 'UK'],
    // Asia
    BABA: ['Consumer Discretionary', 'China'], NIO: ['Consumer Discretionary', 'China'], TCEHY: ['Communication Services', 'China'],
    TSM: ['Technology', 'Taiwan'], SONY: ['Technology', 'Japan'], TM: ['Consumer Discretionary', 'Japan'],
    // Additional common holdings (immediate coverage before Worker enrichment)
    CHKP: ['Technology', 'Israel'], FISV: ['Technology', 'USA'], FI: ['Technology', 'USA'],
    KHC: ['Consumer Staples', 'USA'], NVO: ['Healthcare', 'Denmark'], NVS: ['Healthcare', 'Switzerland'],
    ASML: ['Technology', 'Netherlands'], AZN: ['Healthcare', 'UK'], SHEL: ['Energy', 'UK'], BP: ['Energy', 'UK'],
    'SIX2.DE': ['Industrials', 'Germany'], 'RWE.DE': ['Utilities', 'Germany'], 'MRK.DE': ['Healthcare', 'Germany'],
    'NOVO-B.CO': ['Healthcare', 'Denmark'], 'NESN.SW': ['Consumer Staples', 'Switzerland'],
    PYPL: ['Financials', 'USA'], SQ: ['Technology', 'USA'], PLTR: ['Technology', 'USA'],
    CVS: ['Healthcare', 'USA'],
    GILD: ['Healthcare', 'USA'], AMGN: ['Healthcare', 'USA'], BMY: ['Healthcare', 'USA'],
    INTU: ['Technology', 'USA'], NOW: ['Technology', 'USA'], UBER: ['Technology', 'USA'],
    DE: ['Industrials', 'USA'], LMT: ['Industrials', 'USA'], RTX: ['Industrials', 'USA'],
    // World/ex-US index ETFs (Strategy treats ETFs as their broad exposure)
    VWCE: ['ETF', 'Global'], 'VWCE.DE': ['ETF', 'Global'], 'VWRL.L': ['ETF', 'Global'],
    'EUNL.DE': ['ETF', 'Global'], 'IWDA.AS': ['ETF', 'Global'], 'VUSA.L': ['ETF', 'USA'],
    'SXR8.DE': ['ETF', 'USA'], 'XDWD.DE': ['ETF', 'Global']
  };

  function norm(symbol) {
    if (typeof window !== 'undefined' && window.MaerminTickers) {
      return window.MaerminTickers.normalizeForDividends(symbol) || (symbol || '').toUpperCase();
    }
    return (symbol || '').toUpperCase();
  }

  function getApiKey() {
    try { return localStorage.getItem(API_KEY_STORAGE) || null; } catch (e) { return null; }
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function getFromCache(symbol) {
    var c = readCache()[symbol];
    if (c && c.cachedAt && (Date.now() - c.cachedAt) < CACHE_TTL) return c;
    return null;
  }
  function saveToCache(symbol, meta) {
    try {
      var c = readCache();
      c[symbol] = { sector: meta.sector || 'Other', country: meta.country || 'Other', industry: meta.industry || '', cachedAt: Date.now() };
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* best-effort */ }
  }

  // Synchronous resolve: cache → static → Other.
  function getMeta(symbol) {
    var sym = norm(symbol);
    if (!sym) return { sector: 'Other', country: 'Other', industry: '', source: 'none' };
    var cached = getFromCache(sym);
    if (cached) return { sector: cached.sector, country: cached.country, industry: cached.industry || '', source: 'cache' };
    var s = STATIC[sym];
    if (s) return { sector: s[0], country: s[1], industry: '', source: 'static' };
    return { sector: 'Other', country: 'Other', industry: '', source: 'unknown' };
  }

  function fetchFromAPI(symbol) {
    var sym = norm(symbol);
    var key = getApiKey();
    if (!key) return Promise.resolve(null);
    var url = FMP_BASE + '/profile/' + encodeURIComponent(sym) + '?apikey=' + key;
    return fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) {
        var p = Array.isArray(data) ? data[0] : data;
        if (!p) return null;
        var meta = { sector: sectorName(p.sector) || 'Other', country: countryName(p.country) || 'Other', industry: p.industry || '' };
        saveToCache(sym, meta);
        return meta;
      })
      .catch(function () { return null; });
  }

  // FMP returns ISO country codes (US, DE, …) on some endpoints; map the common
  // ones to readable names so the chart labels match the static map.
  var ISO = { US: 'USA', DE: 'Germany', GB: 'UK', FR: 'France', NL: 'Netherlands', CH: 'Switzerland',
    CN: 'China', JP: 'Japan', TW: 'Taiwan', CA: 'Canada', AU: 'Australia', IT: 'Italy', ES: 'Spain', SE: 'Sweden',
    DK: 'Denmark', IL: 'Israel', IE: 'Ireland', FI: 'Finland', NO: 'Norway', BE: 'Belgium', AT: 'Austria' };
  // Yahoo assetProfile returns FULL country names; normalise the few that differ
  // from the labels the static map / chart legend use.
  var NAME = { 'United States': 'USA', 'United Kingdom': 'UK', 'Korea, Republic of': 'South Korea' };
  function countryName(c) { if (!c) return null; return ISO[c] || NAME[c] || c; }

  // Yahoo's assetProfile sector taxonomy differs from the GICS-style labels the
  // static map and the chart colours use; map them so Worker-resolved and
  // static-resolved holdings land in the SAME bucket (no "Financials" vs
  // "Financial Services" split). Unmapped sectors pass through unchanged.
  var SECTOR_NAME = {
    'Financial Services': 'Financials',
    'Consumer Cyclical': 'Consumer Discretionary',
    'Consumer Defensive': 'Consumer Staples',
    'Basic Materials': 'Materials'
  };
  function sectorName(s) { if (!s) return null; return SECTOR_NAME[s] || s; }

  // Resolve sector/country via the user's Worker (Yahoo assetProfile) — the same
  // source already used for stock prices, so no extra API key is needed. Returns
  // null on any failure (caller keeps the static/Other fallback). Caches on hit.
  function fetchFromWorker(symbol, workerUrl) {
    var sym = norm(symbol);
    var base = (workerUrl || '').trim().replace(/\/$/, '');
    if (!sym || base.length < 5) return Promise.resolve(null);
    var url = base + '?action=profile&symbol=' + encodeURIComponent(sym);
    return fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) {
        if (!data || data.error || (!data.sector && !data.country)) return null;
        var meta = { sector: sectorName(data.sector) || 'Other', country: countryName(data.country) || 'Other', industry: data.industry || '' };
        saveToCache(sym, meta);
        return meta;
      })
      .catch(function () { return null; });
  }

  // Warm the cache for all stock holdings (missing + uncached only). Resolves
  // sector/country through the user's Worker (Yahoo assetProfile) when a Worker
  // URL is supplied — no FMP key required — and falls back to the FMP profile
  // API when a key is set. With neither, resolves 0 (the static map still
  // applies). Safe to call on every portfolio change.
  function prefetchPortfolio(portfolio, opts) {
    opts = opts || {};
    var workerUrl = opts.workerUrl;
    var hasWorker = !!(workerUrl && String(workerUrl).trim().length >= 5);
    var hasKey = !!getApiKey();
    var stocks = (portfolio && portfolio.stocks) || [];
    if ((!hasWorker && !hasKey) || stocks.length === 0) return Promise.resolve(0);
    var seen = {}, todo = [];
    stocks.forEach(function (s) {
      var sym = norm(s.symbol || s.name);
      if (sym && !seen[sym] && !getFromCache(sym)) { seen[sym] = true; todo.push(sym); }
    });
    if (todo.length === 0) return Promise.resolve(0);
    var resolveOne = hasWorker
      ? function (sym) { return fetchFromWorker(sym, workerUrl); }
      : function (sym) { return fetchFromAPI(sym); };
    return Promise.all(todo.map(resolveOne)).then(function (rows) { return rows.filter(Boolean).length; });
  }

  var api = {
    STATIC: STATIC,
    getMeta: getMeta,
    getFromCache: getFromCache,
    saveToCache: saveToCache,
    fetchFromAPI: fetchFromAPI,
    fetchFromWorker: fetchFromWorker,
    prefetchPortfolio: prefetchPortfolio,
    countryName: countryName,
    sectorName: sectorName,
    _norm: norm
  };
  if (typeof window !== 'undefined') window.MaerminEquityMeta = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
