// ============================================================================
// MAERMIN v7.0 - Dividend Data Service with API Integration
// Automatic dividend data fetching, history tracking, and forecasting
// Resolves real dividend data through the Worker (Yahoo fundamentals).
// ============================================================================

(function() {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

// API Configuration
var API_CONFIG = {
  CACHE_DURATION: 24 * 60 * 60 * 1000 // 24 hours
};

// Fallback dividend database for when API is unavailable
var DIVIDEND_DATABASE = {
  // US Tech/Growth
  'AAPL': { annualDividend: 0.96, frequency: 'quarterly', exMonths: [2, 5, 8, 11], growthRate: 0.05, yearsOfGrowth: 12 },
  'MSFT': { annualDividend: 3.00, frequency: 'quarterly', exMonths: [2, 5, 8, 11], growthRate: 0.10, yearsOfGrowth: 21 },
  'NVDA': { annualDividend: 0.16, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.01, yearsOfGrowth: 5 },
  'GOOGL': { annualDividend: 0.80, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0, yearsOfGrowth: 1 },
  'META': { annualDividend: 2.00, frequency: 'quarterly', exMonths: [2, 5, 8, 11], growthRate: 0, yearsOfGrowth: 1 },
  
  // Dividend Aristocrats (25+ years)
  'JNJ': { annualDividend: 4.76, frequency: 'quarterly', exMonths: [2, 5, 8, 11], growthRate: 0.05, yearsOfGrowth: 61 },
  'PG': { annualDividend: 3.76, frequency: 'quarterly', exMonths: [1, 4, 7, 10], growthRate: 0.05, yearsOfGrowth: 67 },
  'KO': { annualDividend: 1.84, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.04, yearsOfGrowth: 61 },
  'PEP': { annualDividend: 5.06, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.07, yearsOfGrowth: 51 },
  'MMM': { annualDividend: 6.00, frequency: 'quarterly', exMonths: [2, 5, 8, 11], growthRate: 0.01, yearsOfGrowth: 65 },
  'CL': { annualDividend: 1.92, frequency: 'quarterly', exMonths: [1, 4, 7, 10], growthRate: 0.03, yearsOfGrowth: 60 },
  'MO': { annualDividend: 3.92, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.04, yearsOfGrowth: 54 },
  'XOM': { annualDividend: 3.80, frequency: 'quarterly', exMonths: [2, 5, 8, 11], growthRate: 0.03, yearsOfGrowth: 41 },
  'CVX': { annualDividend: 6.04, frequency: 'quarterly', exMonths: [2, 5, 8, 11], growthRate: 0.05, yearsOfGrowth: 36 },
  
  // Telecom
  'T': { annualDividend: 1.11, frequency: 'quarterly', exMonths: [1, 4, 7, 10], growthRate: 0, yearsOfGrowth: 0 },
  'VZ': { annualDividend: 2.66, frequency: 'quarterly', exMonths: [1, 4, 7, 10], growthRate: 0.02, yearsOfGrowth: 19 },
  
  // REITs (Monthly dividends)
  'O': { annualDividend: 3.08, frequency: 'monthly', exMonths: [1,2,3,4,5,6,7,8,9,10,11,12], growthRate: 0.04, yearsOfGrowth: 29 },
  'MAIN': { annualDividend: 2.88, frequency: 'monthly', exMonths: [1,2,3,4,5,6,7,8,9,10,11,12], growthRate: 0.03, yearsOfGrowth: 12 },
  'STAG': { annualDividend: 1.47, frequency: 'monthly', exMonths: [1,2,3,4,5,6,7,8,9,10,11,12], growthRate: 0.01, yearsOfGrowth: 12 },
  
  // Banks
  'JPM': { annualDividend: 4.60, frequency: 'quarterly', exMonths: [1, 4, 7, 10], growthRate: 0.10, yearsOfGrowth: 13 },
  'BAC': { annualDividend: 0.96, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.08, yearsOfGrowth: 10 },
  'WFC': { annualDividend: 1.40, frequency: 'quarterly', exMonths: [2, 5, 8, 11], growthRate: 0.15, yearsOfGrowth: 3 },
  
  // German Stocks
  'ALV.DE': { annualDividend: 11.40, frequency: 'annual', exMonths: [5], growthRate: 0.05, yearsOfGrowth: 10, currency: 'EUR' },
  'BAS.DE': { annualDividend: 3.40, frequency: 'annual', exMonths: [5], growthRate: 0.02, yearsOfGrowth: 5, currency: 'EUR' },
  'SAP.DE': { annualDividend: 2.20, frequency: 'annual', exMonths: [5], growthRate: 0.05, yearsOfGrowth: 10, currency: 'EUR' },
  'SIE.DE': { annualDividend: 4.70, frequency: 'annual', exMonths: [2], growthRate: 0.06, yearsOfGrowth: 8, currency: 'EUR' },
  'DTE.DE': { annualDividend: 0.77, frequency: 'annual', exMonths: [4], growthRate: 0.03, yearsOfGrowth: 5, currency: 'EUR' },
  'BMW.DE': { annualDividend: 6.00, frequency: 'annual', exMonths: [5], growthRate: 0.04, yearsOfGrowth: 3, currency: 'EUR' },
  'MBG.DE': { annualDividend: 5.30, frequency: 'annual', exMonths: [5], growthRate: 0.03, yearsOfGrowth: 4, currency: 'EUR' },
  
  // ETFs
  'VYM': { annualDividend: 3.21, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.05, yearsOfGrowth: 15 },
  'SCHD': { annualDividend: 2.64, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.12, yearsOfGrowth: 10 },
  'HDV': { annualDividend: 3.78, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.04, yearsOfGrowth: 10 },
  'SPYD': { annualDividend: 1.54, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.03, yearsOfGrowth: 8 },
  'VIG': { annualDividend: 3.21, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.08, yearsOfGrowth: 15 },
  'VOO': { annualDividend: 6.58, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.06, yearsOfGrowth: 10 },
  'SPY': { annualDividend: 6.58, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.06, yearsOfGrowth: 25 },
  'QQQ': { annualDividend: 2.50, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.08, yearsOfGrowth: 10 },
  
  // High Dividend
  'PM': { annualDividend: 5.20, frequency: 'quarterly', exMonths: [3, 6, 9, 12], growthRate: 0.02, yearsOfGrowth: 15 }
};

// Storage keys
var STORAGE_KEYS = {
  cache: 'maermin_dividend_cache',
  history: 'maermin_dividend_history',
  lastFetch: 'maermin_dividend_last_fetch'
};

// ============================================================================
// DIVIDEND DATA SERVICE
// ============================================================================

var DividendDataService = {
  
  
  // Get from local database
  getFromDatabase: function(symbol) {
    var upperSymbol = (symbol || '').toUpperCase();
    var data = DIVIDEND_DATABASE[upperSymbol];
    if (!data) return null;

    var paymentsPerYear = this.getPaymentsPerYear(data.frequency);
    
    return {
      symbol: upperSymbol,
      annualDividend: data.annualDividend,
      dividendPerShare: data.annualDividend / paymentsPerYear,
      frequency: data.frequency,
      exMonths: data.exMonths,
      growthRate: data.growthRate || 0,
      yearsOfGrowth: data.yearsOfGrowth || 0,
      currency: data.currency || 'USD',
      fromDatabase: true
    };
  },
  
  // Get from cache
  getFromCache: function(symbol) {
    try {
      var cache = JSON.parse(localStorage.getItem(STORAGE_KEYS.cache) || '{}');
      var cached = cache[(symbol || '').toUpperCase()];
      
      if (cached && cached.cachedAt) {
        var age = Date.now() - new Date(cached.cachedAt).getTime();
        if (age < API_CONFIG.CACHE_DURATION) {
          return cached;
        }
      }
    } catch (e) {}
    return null;
  },
  
  // Save to cache
  saveToCache: function(symbol, data) {
    try {
      var cache = JSON.parse(localStorage.getItem(STORAGE_KEYS.cache) || '{}');
      cache[(symbol || '').toUpperCase()] = Object.assign({}, data, { cachedAt: new Date().toISOString() });
      localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(cache));
    } catch (e) {
      console.warn('Could not cache dividend data');
    }
  },
  
  // Get payments per year
  getPaymentsPerYear: function(frequency) {
    var map = { 'monthly': 12, 'quarterly': 4, 'semi-annual': 2, 'semiannual': 2, 'annual': 1 };
    return map[frequency] || 4;
  },

  // Build a dated, per-payment dividend schedule for every dividend-paying
  // holding across the next `months` (default 12) — the source for the Dividend
  // Calendar. ONE entry per individual payout (symbol + pay date + amount), so
  // the user sees who pays when and how much. Pure over the resolved per-symbol
  // data (cache → DB), so it covers any payer warmed by prefetchPortfolio.
  // opts: { months, now } (now injectable for tests). Returns sorted rows:
  //   { symbol, date(ISO), perShare, shares, amount, currency, frequency }
  buildPaymentSchedule: function(portfolio, opts) {
    opts = opts || {};
    var self = this;
    var months = opts.months || 12;                          // forward window
    var back = opts.back != null ? opts.back : 12;           // trailing window (already-received payouts)
    var now = opts.now ? new Date(opts.now) : new Date();
    // All date maths in UTC: dates are stored as UTC 'YYYY-MM-DD' and printed
    // with toISOString (audit 2026-10-24 BUG-12: local month steps put summer
    // pay dates one day early east of UTC).
    var start = new Date(now); start.setUTCMonth(start.getUTCMonth() - back);
    var horizon = new Date(now); horizon.setUTCMonth(horizon.getUTCMonth() + months);
    var stocks = (portfolio && portfolio.stocks) || [];
    var out = [];
    stocks.forEach(function (s) {
      var sym = (s.symbol || s.name || '').toUpperCase();
      var shares = parseFloat(s.amount) || 0;
      if (!sym || shares <= 0) return;
      var d = self.getDividendData(sym);              // cache (Worker) → built-in DB
      if (!d || !(d.annualDividend > 0)) return;
      var ppy = self.getPaymentsPerYear(d.frequency);
      var monthsPerPay = Math.max(1, Math.round(12 / ppy));
      var perShare = d.annualDividend / ppy;
      var amount = perShare * shares;
      var currency = d.currency || 'USD';

      // Anchor the first pay date: prefer the real ex-date, else the stored
      // ex-month, else next month; roll to the next upcoming occurrence; pay
      // ~14 days after ex.
      var anchor = null;
      if (d.exDate) { var a = new Date(d.exDate); if (!isNaN(a.getTime())) anchor = a; }
      if (!anchor && Array.isArray(d.exMonths) && d.exMonths.length) {
        anchor = new Date(Date.UTC(now.getUTCFullYear(), d.exMonths[0] - 1, 15));
      }
      if (!anchor) { anchor = new Date(now); anchor.setUTCMonth(anchor.getUTCMonth() + 1); }
      // Pay lands ~14 days after the ex-date. Roll forward on the PAY date (not
      // the ex-date) so a payout whose ex just passed but whose pay date is still
      // upcoming is NOT skipped to the next period.
      var pay = new Date(anchor); pay.setUTCDate(pay.getUTCDate() + 14);
      while (pay.getTime() < now.getTime()) pay.setUTCMonth(pay.getUTCMonth() + monthsPerPay);

      // Walk BACK from the next upcoming pay to the earliest payout still inside
      // the trailing window, so already-received payments this year are included
      // (and the yearly total reconciles). Each row is flagged past vs upcoming.
      var first = new Date(pay);
      while (true) {
        var prev = new Date(first); prev.setUTCMonth(prev.getUTCMonth() - monthsPerPay);
        if (prev.getTime() < start.getTime()) break;
        first = prev;
      }

      for (var pd = new Date(first); pd.getTime() <= horizon.getTime(); pd.setUTCMonth(pd.getUTCMonth() + monthsPerPay)) {
        var exd = new Date(pd); exd.setUTCDate(exd.getUTCDate() - 14); // inverse of the ~14-day pay lag
        out.push({
          symbol: sym, date: pd.toISOString().split('T')[0],
          exDate: exd.toISOString().split('T')[0],
          perShare: perShare, shares: shares,
          amount: Math.round(amount * 100) / 100, currency: currency, frequency: d.frequency,
          past: pd.getTime() < now.getTime()
        });
      }
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  },

  // Warm the cache for a whole portfolio so the synchronous getDividendData()
  // resolves far more than the ~31 built-in tickers. Resolves via the user's
  // Worker (Yahoo fundamentals) when a Worker URL is supplied. Without one it
  // resolves immediately (built-in DB only). Safe to call on each price refresh; the
  // 24h client cache + the Worker's 6h server cache keep requests cheap.
  prefetchPortfolio: function(portfolio, opts) {
    opts = opts || {};
    var self = this;
    var workerUrl = opts.workerUrl;
    var hasWorker = !!(workerUrl && String(workerUrl).trim().length >= 5);
    var stocks = (portfolio && portfolio.stocks) || [];
    if (!hasWorker || stocks.length === 0) return Promise.resolve(0);
    var norm = (typeof window !== 'undefined' && window.MaerminTickers)
      ? function (s) { return window.MaerminTickers.normalizeForDividends(s) || (s || '').toUpperCase(); }
      : function (s) { return (s || '').toUpperCase(); };
    var symbols = [];
    var seen = {};
    stocks.forEach(function (s) {
      var sym = norm(s.symbol || s.name);
      if (sym && !seen[sym] && !self.getFromCache(sym)) { seen[sym] = true; symbols.push(sym); }
    });
    if (symbols.length === 0) return Promise.resolve(0);
    return Promise.all(symbols.map(function (sym) { return self.fetchDividendFromWorker(sym, workerUrl); })).then(function (rows) {
      return rows.filter(Boolean).length;
    });
  },

  // Infer payment frequency from the annual rate and the last single payment
  // (Yahoo's lastDividendValue). dividendRate / lastDividendValue ≈ payments/yr.
  // No hint → European listings (suffixes) usually pay annually, US quarterly.
  inferFrequency: function(annualRate, lastValue, symbol) {
    var a = parseFloat(annualRate) || 0, l = parseFloat(lastValue) || 0;
    if (a > 0 && l > 0) {
      var ppy = Math.round(a / l);
      if (ppy >= 10) return 'monthly';
      if (ppy >= 3) return 'quarterly';
      if (ppy === 2) return 'semi-annual';
      if (ppy <= 1) return 'annual';
    }
    return /\.(DE|L|PA|AS|SW|CO|MI|VI|ST|HE|MC|F|BE|HM|DU|MU|SG)$/i.test(symbol || '') ? 'annual' : 'quarterly';
  },

  // Resolve dividend data through the user's Worker (Yahoo `fundamentals`) — the
  // same source used for stock prices, so no API key is required. Returns null
  // for non-payers / on any failure (caller keeps the DB / "no data" fallback).
  fetchDividendFromWorker: function(symbol, workerUrl) {
    var self = this;
    var base = (workerUrl || '').trim().replace(/\/$/, '');
    var norm = (typeof window !== 'undefined' && window.MaerminTickers)
      ? function (s) { return window.MaerminTickers.normalizeForDividends(s) || (s || '').toUpperCase(); }
      : function (s) { return (s || '').toUpperCase(); };
    var sym = norm(symbol);
    if (!sym || base.length < 5) return Promise.resolve(null);
    // Not a ticker (e.g. a CS2 skin filed as a stock): Yahoo has nothing.
    var T = typeof window !== 'undefined' && window.MaerminTickers;
    if (T && T.isMarketSymbol && !T.isMarketSymbol(sym)) return Promise.resolve(null);
    var NL = typeof window !== 'undefined' && window.MaerminCloseHistory && window.MaerminCloseHistory.noListing;
    if (NL && NL.has(sym)) return Promise.resolve(null); // no Yahoo listing (AUDIT BUG-036)
    var url = base + '?action=fundamentals&symbol=' + encodeURIComponent(sym);
    return fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) {
        if (!d || d.error || !(d.dividendRate > 0)) return null;
        var freq = self.inferFrequency(d.dividendRate, d.lastDividendValue, sym);
        var exMonth = null;
        if (d.exDividendDate) { var mo = new Date(d.exDividendDate).getUTCMonth(); if (!isNaN(mo)) exMonth = mo + 1; }
        var record = {
          symbol: sym,
          annualDividend: d.dividendRate,
          dividendPerShare: d.lastDividendValue > 0 ? d.lastDividendValue : d.dividendRate / self.getPaymentsPerYear(freq),
          frequency: freq,
          exMonths: exMonth ? [exMonth] : undefined,
          exDate: d.exDividendDate || undefined,
          payDate: d.dividendDate || undefined,
          growthRate: 0,
          yearsOfGrowth: 0,
          currency: d.currency || 'USD',
          fromWorker: true
        };
        self.saveToCache(sym, record);
        return record;
      })
      .catch(function () { return null; });
  },
  
  // Get dividend data (cached, API, or database)
  getDividendData: function(symbol, currentPrice) {
    // Normalise via the validation layer so Yahoo-style symbols (SAP.DE),
    // class shares (BRK.B → BRK-B) and casing all resolve to the provider's
    // canonical ticker. Falls back to plain uppercase if the layer is absent.
    var upperSymbol = (typeof window !== 'undefined' && window.MaerminTickers)
      ? (window.MaerminTickers.normalizeForDividends(symbol) || (symbol || '').toUpperCase())
      : (symbol || '').toUpperCase();

    // Check cache first
    var cached = this.getFromCache(upperSymbol);
    if (cached) {
      return this.enrichDividendData(cached, currentPrice);
    }
    
    // Check database
    var dbData = this.getFromDatabase(upperSymbol);
    if (dbData) {
      return this.enrichDividendData(dbData, currentPrice);
    }
    
    return null;
  },
  
  // Enrich dividend data with calculated fields
  enrichDividendData: function(data, currentPrice) {
    if (!data) return null;
    
    var currentYield = currentPrice > 0 ? (data.annualDividend / currentPrice) * 100 : 0;
    var nextExDate = this.calculateNextExDate(data.exMonths, data.frequency);
    var nextPayDate = this.calculatePayDate(nextExDate);
    
    return Object.assign({}, data, {
      currentYield: currentYield,
      exDate: data.exDate || nextExDate,
      payDate: data.payDate || nextPayDate,
      isDividendAristocrat: (data.yearsOfGrowth || 0) >= 25,
      isDividendKing: (data.yearsOfGrowth || 0) >= 50
    });
  },
  
  // Calculate next ex-dividend date
  calculateNextExDate: function(exMonths, frequency) {
    if (!exMonths || exMonths.length === 0) {
      // Default quarterly schedule
      exMonths = [3, 6, 9, 12];
    }
    
    var today = new Date();
    var currentMonth = today.getMonth() + 1;
    var currentYear = today.getFullYear();
    
    var nextMonth = null;
    for (var i = 0; i < exMonths.length; i++) {
      if (exMonths[i] >= currentMonth) {
        nextMonth = exMonths[i];
        break;
      }
    }
    
    var nextYear = currentYear;
    if (!nextMonth) {
      nextMonth = exMonths[0];
      nextYear = currentYear + 1;
    }
    
    // Build the date in UTC: a local-midnight Date serialised with toISOString()
    // lands on the 14th for any timezone east of UTC.
    return new Date(Date.UTC(nextYear, nextMonth - 1, 15)).toISOString().split('T')[0];
  },
  
  // Calculate payment date
  calculatePayDate: function(exDate) {
    if (!exDate) return null;
    var date = new Date(exDate);
    if (isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() + 14); // UTC arithmetic: no DST off-by-one
    return date.toISOString().split('T')[0];
  },
  
  // Get portfolio dividend data
  getPortfolioDividendData: function(portfolio, prices) {
    var self = this;
    var stocks = portfolio.stocks || [];
    var dividendData = {};
    
    stocks.forEach(function(stock) {
      var symbol = (stock.symbol || stock.name || '').toUpperCase();
      var price = prices[symbol] || prices[symbol.toLowerCase()] || stock.currentPrice || stock.purchasePrice || 0;
      var data = self.getDividendData(symbol, price);
      
      if (data) {
        dividendData[symbol] = data;
      }
    });
    
    return dividendData;
  }
};

// Export
window.DividendDataService = DividendDataService;


})();
