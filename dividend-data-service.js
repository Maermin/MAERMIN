// ============================================================================
// MAERMIN v7.0 - Dividend Data Service with API Integration
// Automatic dividend data fetching, history tracking, and forecasting
// Uses Financial Modeling Prep API (free tier) for real dividend data
// ============================================================================

(function() {
'use strict';

// API Configuration
var API_CONFIG = {
  // Financial Modeling Prep - Free tier allows 250 requests/day
  FMP_BASE_URL: 'https://financialmodelingprep.com/api/v3',
  FMP_API_KEY: '', // User can set via setApiKey()
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
  apiKey: 'maermin_fmp_api_key',
  cache: 'maermin_dividend_cache',
  history: 'maermin_dividend_history',
  lastFetch: 'maermin_dividend_last_fetch'
};

// ============================================================================
// DIVIDEND DATA SERVICE
// ============================================================================

var DividendDataService = {
  
  // Set API key for Financial Modeling Prep
  setApiKey: function(key) {
    API_CONFIG.FMP_API_KEY = key;
    try {
      localStorage.setItem(STORAGE_KEYS.apiKey, key);
    } catch (e) {
      console.warn('Could not save API key to localStorage');
    }
    return this;
  },
  
  // Get API key
  getApiKey: function() {
    if (API_CONFIG.FMP_API_KEY) return API_CONFIG.FMP_API_KEY;
    try {
      var saved = localStorage.getItem(STORAGE_KEYS.apiKey);
      if (saved) {
        API_CONFIG.FMP_API_KEY = saved;
        return saved;
      }
    } catch (e) {}
    return null;
  },
  
  // Fetch dividend data from API
  fetchDividendFromAPI: function(symbol) {
    var self = this;
    var apiKey = this.getApiKey();
    
    if (!apiKey) {
      /* quiet: no API key, DB fallback */
      return Promise.resolve(this.getFromDatabase(symbol));
    }
    
    var url = API_CONFIG.FMP_BASE_URL + '/historical-price-full/stock_dividend/' + symbol + '?apikey=' + apiKey;
    
    return fetch(url)
      .then(function(response) {
        if (!response.ok) throw new Error('API error: ' + response.status);
        return response.json();
      })
      .then(function(data) {
        if (data && data.historical && data.historical.length > 0) {
          var dividends = data.historical;
          var latestDiv = dividends[0];
          
          // Calculate annual dividend from last 4 payments
          var recentDivs = dividends.slice(0, 4);
          var annualTotal = recentDivs.reduce(function(sum, d) {
            return sum + (d.dividend || 0);
          }, 0);
          
          // Determine frequency
          var frequency = 'quarterly';
          if (recentDivs.length >= 12) frequency = 'monthly';
          else if (recentDivs.length <= 2) frequency = 'semi-annual';
          else if (recentDivs.length === 1) frequency = 'annual';
          
          // Calculate growth rate
          var growthRate = 0;
          if (dividends.length >= 8) {
            var lastYear = dividends.slice(0, 4).reduce(function(s, d) { return s + d.dividend; }, 0);
            var prevYear = dividends.slice(4, 8).reduce(function(s, d) { return s + d.dividend; }, 0);
            if (prevYear > 0) {
              growthRate = (lastYear - prevYear) / prevYear;
            }
          }
          
          var result = {
            symbol: symbol,
            annualDividend: annualTotal,
            dividendPerShare: latestDiv.dividend,
            frequency: frequency,
            exDate: latestDiv.date,
            payDate: latestDiv.paymentDate,
            growthRate: growthRate,
            yearsOfGrowth: self.calculateYearsOfGrowth(dividends),
            fromAPI: true
          };
          
          // Cache the result
          self.saveToCache(symbol, result);

          
          return result;
        }
        
        // No dividend data from API, use fallback
        return self.getFromDatabase(symbol);
      })
      .catch(function(err) {
        console.warn('[DividendService] API error for ' + symbol + ':', err.message);
        return self.getFromDatabase(symbol);
      });
  },
  
  // Calculate years of consecutive dividend growth
  calculateYearsOfGrowth: function(dividends) {
    if (!dividends || dividends.length < 8) return 0;
    
    var years = 0;
    var yearlyDivs = {};
    
    // Group by year
    dividends.forEach(function(d) {
      var year = new Date(d.date).getFullYear();
      if (!yearlyDivs[year]) yearlyDivs[year] = 0;
      yearlyDivs[year] += d.dividend || 0;
    });
    
    var sortedYears = Object.keys(yearlyDivs).sort().reverse();
    for (var i = 0; i < sortedYears.length - 1; i++) {
      var current = yearlyDivs[sortedYears[i]];
      var previous = yearlyDivs[sortedYears[i + 1]];
      if (current >= previous && previous > 0) {
        years++;
      } else {
        break;
      }
    }
    
    return years;
  },
  
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
    var start = new Date(now); start.setMonth(start.getMonth() - back);
    var horizon = new Date(now); horizon.setMonth(horizon.getMonth() + months);
    var stocks = (portfolio && portfolio.stocks) || [];
    var out = [];
    stocks.forEach(function (s) {
      var sym = (s.symbol || s.name || '').toUpperCase();
      var shares = parseFloat(s.amount) || 0;
      if (!sym || shares <= 0) return;
      var d = self.getDividendData(sym);              // cache (Worker/FMP) → built-in DB
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
        anchor = new Date(now.getFullYear(), d.exMonths[0] - 1, 15);
      }
      if (!anchor) { anchor = new Date(now); anchor.setMonth(anchor.getMonth() + 1); }
      // Pay lands ~14 days after the ex-date. Roll forward on the PAY date (not
      // the ex-date) so a payout whose ex just passed but whose pay date is still
      // upcoming is NOT skipped to the next period.
      var pay = new Date(anchor); pay.setDate(pay.getDate() + 14);
      while (pay.getTime() < now.getTime()) pay.setMonth(pay.getMonth() + monthsPerPay);

      // Walk BACK from the next upcoming pay to the earliest payout still inside
      // the trailing window, so already-received payments this year are included
      // (and the yearly total reconciles). Each row is flagged past vs upcoming.
      var first = new Date(pay);
      while (true) {
        var prev = new Date(first); prev.setMonth(prev.getMonth() - monthsPerPay);
        if (prev.getTime() < start.getTime()) break;
        first = prev;
      }

      for (var pd = new Date(first); pd.getTime() <= horizon.getTime(); pd.setMonth(pd.getMonth() + monthsPerPay)) {
        out.push({
          symbol: sym, date: pd.toISOString().split('T')[0],
          perShare: perShare, shares: shares,
          amount: Math.round(amount * 100) / 100, currency: currency, frequency: d.frequency,
          past: pd.getTime() < now.getTime()
        });
      }
    });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  },

  // Return EXACTLY `count` ex-dividend month numbers. Uses the stored months
  // when they already cover the frequency; otherwise spreads `count` payments
  // evenly across the year (so a monthly payer gets 12, not the default 4).
  buildPaymentMonths: function(exMonths, count) {
    count = count || 4;
    if (Array.isArray(exMonths) && exMonths.length >= count) return exMonths.slice(0, count);
    var months = [];
    var step = 12 / count;
    for (var i = 0; i < count; i++) {
      var m = Math.round(step * (i + 1)); // 1 → [12]; 2 → [6,12]; 4 → [3,6,9,12]; 12 → [1..12]
      if (m < 1) m = 1; if (m > 12) m = 12;
      months.push(m);
    }
    return months;
  },

  // Warm the cache for a whole portfolio so the synchronous getDividendData()
  // resolves far more than the ~31 built-in tickers. Resolves via the user's
  // Worker (Yahoo fundamentals) when a Worker URL is supplied — NO FMP key
  // needed — and falls back to the FMP API when a key is set. With neither,
  // resolves immediately (DB-only). Safe to call on each price refresh; the
  // 24h client cache + the Worker's 6h server cache keep requests cheap.
  prefetchPortfolio: function(portfolio, opts) {
    opts = opts || {};
    var self = this;
    var workerUrl = opts.workerUrl;
    var hasWorker = !!(workerUrl && String(workerUrl).trim().length >= 5);
    var hasKey = !!this.getApiKey();
    var stocks = (portfolio && portfolio.stocks) || [];
    if ((!hasWorker && !hasKey) || stocks.length === 0) return Promise.resolve(0);
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
    var resolveOne = hasWorker
      ? function (sym) { return self.fetchDividendFromWorker(sym, workerUrl); }
      : function (sym) { return self.fetchDividendFromAPI(sym).catch(function () { return null; }); };
    return Promise.all(symbols.map(resolveOne)).then(function (rows) {
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
  // same source used for stock prices, so no FMP key is required. Returns null
  // for non-payers / on any failure (caller keeps the DB / "no data" fallback).
  fetchDividendFromWorker: function(symbol, workerUrl) {
    var self = this;
    var base = (workerUrl || '').trim().replace(/\/$/, '');
    var norm = (typeof window !== 'undefined' && window.MaerminTickers)
      ? function (s) { return window.MaerminTickers.normalizeForDividends(s) || (s || '').toUpperCase(); }
      : function (s) { return (s || '').toUpperCase(); };
    var sym = norm(symbol);
    if (!sym || base.length < 5) return Promise.resolve(null);
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
    
    return new Date(nextYear, nextMonth - 1, 15).toISOString().split('T')[0];
  },
  
  // Calculate payment date
  calculatePayDate: function(exDate) {
    if (!exDate) return null;
    var date = new Date(exDate);
    date.setDate(date.getDate() + 14);
    return date.toISOString().split('T')[0];
  },
  
  // Fetch multiple symbols from API
  fetchMultipleFromAPI: function(symbols) {
    var self = this;
    var promises = symbols.map(function(sym) {
      return self.fetchDividendFromAPI(sym);
    });
    return Promise.all(promises);
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
  },
  
  // Calculate historical dividends
  calculateHistoricalDividends: function(portfolio, dividendData, yearsBack) {
    yearsBack = yearsBack || 5;
    var self = this;
    var stocks = portfolio.stocks || [];
    var currentYear = new Date().getFullYear();
    var yearlyData = {};
    
    for (var y = currentYear - yearsBack; y <= currentYear; y++) {
      yearlyData[y] = {
        year: y,
        totalDividends: 0,
        byStock: {},
        payments: []
      };
    }
    
    stocks.forEach(function(stock) {
      var symbol = (stock.symbol || stock.name || '').toUpperCase();
      var shares = stock.amount || 0;
      var purchaseDate = stock.purchaseDate ? new Date(stock.purchaseDate) : null;
      var divData = dividendData[symbol];
      
      if (!divData || shares === 0) return;
      
      var annualDiv = divData.annualDividend || 0;
      var growthRate = divData.growthRate || 0;
      var paymentsPerYear = self.getPaymentsPerYear(divData.frequency);
      
      for (var y = currentYear - yearsBack; y <= currentYear; y++) {
        if (purchaseDate && purchaseDate.getFullYear() > y) continue;
        
        var yearsAgo = currentYear - y;
        var historicalAnnualDiv = annualDiv / Math.pow(1 + growthRate, yearsAgo);
        var yearlyIncome = shares * historicalAnnualDiv;
        
        yearlyData[y].totalDividends += yearlyIncome;
        yearlyData[y].byStock[symbol] = {
          symbol: symbol,
          shares: shares,
          annualDividend: historicalAnnualDiv,
          totalReceived: yearlyIncome,
          paymentsPerYear: paymentsPerYear
        };
      }
    });
    
    return yearlyData;
  },
  
  // Forecast dividends
  forecastDividends: function(portfolio, dividendData, years) {
    years = years || 3;
    var self = this;
    var stocks = portfolio.stocks || [];
    var currentYear = new Date().getFullYear();
    var forecasts = {};
    
    for (var y = currentYear; y < currentYear + years; y++) {
      forecasts[y] = {
        year: y,
        totalProjected: 0,
        byStock: {},
        byQuarter: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 },
        byMonth: {}
      };
      
      for (var m = 1; m <= 12; m++) {
        forecasts[y].byMonth[m] = { total: 0, stocks: [] };
      }
    }
    
    stocks.forEach(function(stock) {
      var symbol = (stock.symbol || stock.name || '').toUpperCase();
      var shares = stock.amount || 0;
      var divData = dividendData[symbol];
      
      if (!divData || shares === 0) return;
      
      var baseAnnualDiv = divData.annualDividend || 0;
      var growthRate = divData.growthRate || 0;
      var paymentsPerYear = self.getPaymentsPerYear(divData.frequency);
      // Build a payment-month schedule of EXACTLY paymentsPerYear entries.
      // Bug fix: monthly payers (12/yr) used to be capped at the 4 default
      // ex-months, under-counting income by ~66%. When the stored exMonths
      // don't cover the frequency, spread payments evenly across the year.
      var exMonths = self.buildPaymentMonths(divData.exMonths, paymentsPerYear);
      
      for (var y = currentYear; y < currentYear + years; y++) {
        var yearsOut = y - currentYear;
        var projectedAnnualDiv = baseAnnualDiv * Math.pow(1 + growthRate, yearsOut);
        var yearlyIncome = shares * projectedAnnualDiv;
        
        forecasts[y].totalProjected += yearlyIncome;
        forecasts[y].byStock[symbol] = {
          symbol: symbol,
          shares: shares,
          annualDividend: projectedAnnualDiv,
          totalExpected: yearlyIncome,
          growthFromCurrent: yearsOut > 0 ? ((projectedAnnualDiv / baseAnnualDiv) - 1) * 100 : 0
        };
        
        var perPayment = yearlyIncome / paymentsPerYear;
        exMonths.forEach(function(month) {
          // Pay date lands ~1 month after the ex-date month.
          var payMonth = (month % 12) + 1;

          forecasts[y].byMonth[payMonth].total += perPayment;
          forecasts[y].byMonth[payMonth].stocks.push({ symbol: symbol, amount: perPayment });
          
          var quarter = Math.ceil(payMonth / 3);
          forecasts[y].byQuarter['Q' + quarter] += perPayment;
        });
      }
    });
    
    return forecasts;
  },
  
  // Create dividend calendar
  createDividendCalendar: function(portfolio, dividendData, monthsAhead) {
    monthsAhead = monthsAhead || 6;
    var stocks = portfolio.stocks || [];
    var events = [];
    var today = new Date();
    var endDate = new Date();
    endDate.setMonth(endDate.getMonth() + monthsAhead);
    
    stocks.forEach(function(stock) {
      var symbol = (stock.symbol || stock.name || '').toUpperCase();
      var shares = stock.amount || 0;
      var divData = dividendData[symbol];
      
      if (!divData || shares === 0) return;
      
      var divPerShare = divData.dividendPerShare || (divData.annualDividend / 4);
      
      if (divData.exDate) {
        var exDate = new Date(divData.exDate);
        if (exDate >= today && exDate <= endDate) {
          events.push({
            type: 'ex-date',
            symbol: symbol,
            date: divData.exDate,
            shares: shares,
            dividendPerShare: divPerShare,
            estimatedAmount: shares * divPerShare
          });
        }
      }
      
      if (divData.payDate) {
        var payDate = new Date(divData.payDate);
        if (payDate >= today && payDate <= endDate) {
          events.push({
            type: 'payment',
            symbol: symbol,
            date: divData.payDate,
            shares: shares,
            dividendPerShare: divPerShare,
            estimatedAmount: shares * divPerShare
          });
        }
      }
    });
    
    events.sort(function(a, b) {
      return new Date(a.date) - new Date(b.date);
    });
    
    var totalExpected = events
      .filter(function(e) { return e.type === 'payment'; })
      .reduce(function(sum, e) { return sum + e.estimatedAmount; }, 0);
    
    return {
      events: events,
      summary: {
        upcomingPayments: events.filter(function(e) { return e.type === 'payment'; }).length,
        totalExpectedIncome: totalExpected
      }
    };
  },
  
  // Create stock breakdown
  createStockBreakdown: function(stocks, dividendData, prices) {
    var self = this;
    
    return stocks.map(function(stock) {
      var symbol = (stock.symbol || stock.name || '').toUpperCase();
      var shares = stock.amount || 0;
      var price = prices[symbol] || prices[symbol.toLowerCase()] || stock.currentPrice || stock.purchasePrice || 0;
      var purchasePrice = stock.purchasePrice || price;
      var divData = dividendData[symbol];
      
      if (!divData) {
        return {
          symbol: symbol,
          shares: shares,
          currentPrice: price,
          hasDividend: false,
          annualIncome: 0
        };
      }
      
      var yieldOnCost = purchasePrice > 0 ? (divData.annualDividend / purchasePrice) * 100 : 0;
      
      return {
        symbol: symbol,
        shares: shares,
        currentPrice: price,
        purchasePrice: purchasePrice,
        hasDividend: true,
        dividendPerShare: divData.annualDividend,
        frequency: divData.frequency,
        annualIncome: shares * divData.annualDividend,
        monthlyIncome: (shares * divData.annualDividend) / 12,
        currentYield: divData.currentYield || 0,
        yieldOnCost: yieldOnCost,
        nextExDate: divData.exDate,
        nextPayDate: divData.payDate,
        yearsOfGrowth: divData.yearsOfGrowth || 0,
        isDividendAristocrat: divData.isDividendAristocrat || false,
        isDividendKing: divData.isDividendKing || false,
        growthRate: ((divData.growthRate || 0) * 100).toFixed(1) + '%'
      };
    }).sort(function(a, b) {
      return (b.annualIncome || 0) - (a.annualIncome || 0);
    });
  },
  
  // Create analysis insights
  createAnalysisInsights: function(summary, historical, forecast) {
    var insights = [];
    var currentYear = new Date().getFullYear();
    
    var lastYear = historical[currentYear - 1];
    var thisYear = forecast[currentYear];
    
    if (lastYear && thisYear && lastYear.totalDividends > 0) {
      var growth = ((thisYear.totalProjected - lastYear.totalDividends) / lastYear.totalDividends) * 100;
      insights.push({
        type: growth >= 0 ? 'positive' : 'warning',
        message: growth >= 0 ?
          'Dividend income projected to grow ' + growth.toFixed(1) + '% vs last year' :
          'Dividend income projected to decrease ' + Math.abs(growth).toFixed(1) + '% vs last year'
      });
    }
    
    if (summary && summary.monthlyIncome > 0) {
      insights.push({
        type: 'info',
        message: 'Average monthly dividend income: ' + summary.monthlyIncome.toFixed(2) + ' EUR'
      });
    }
    
    if (summary && summary.totalYield) {
      if (summary.totalYield > 5) {
        insights.push({
          type: 'warning',
          message: 'High portfolio yield (' + summary.totalYield.toFixed(2) + '%) - verify dividend sustainability'
        });
      } else if (summary.totalYield < 2 && summary.totalYield > 0) {
        insights.push({
          type: 'info',
          message: 'Portfolio yield: ' + summary.totalYield.toFixed(2) + '% - consider adding dividend stocks'
        });
      }
    }
    
    return insights;
  },
  
  // Main analysis function
  analyzePortfolioDividends: function(portfolio, prices, options) {
    var self = this;
    var stocks = portfolio.stocks || [];
    


    stocks.forEach(function(s, i) {

    });
    var dividendData = this.getPortfolioDividendData(portfolio, prices);
    
    // Calculate summary
    var totalAnnual = 0;
    var totalValue = 0;
    var totalCost = 0;
    var positions = [];
    
    stocks.forEach(function(stock) {
      var symbol = (stock.symbol || stock.name || '').toUpperCase();
      var shares = stock.amount || 0;
      var price = prices[symbol] || prices[symbol.toLowerCase()] || stock.currentPrice || stock.purchasePrice || 0;
      var purchasePrice = stock.purchasePrice || price;
      var divData = dividendData[symbol];
      
      var positionValue = shares * price;
      var positionCost = shares * purchasePrice;
      totalValue += positionValue;
      totalCost += positionCost;
      
      if (divData && shares > 0) {
        var annualIncome = shares * divData.annualDividend;
        totalAnnual += annualIncome;
        
        positions.push({
          symbol: symbol,
          shares: shares,
          annualIncome: annualIncome,
          currentYield: divData.currentYield,
          yieldOnCost: purchasePrice > 0 ? (divData.annualDividend / purchasePrice) * 100 : 0,
          frequency: divData.frequency,
          yearsOfGrowth: divData.yearsOfGrowth
        });
      }
    });
    
    var summary = {
      totalAnnualDividends: totalAnnual,
      totalYield: totalValue > 0 ? (totalAnnual / totalValue) * 100 : 0,
      totalYieldOnCost: totalCost > 0 ? (totalAnnual / totalCost) * 100 : 0,
      monthlyIncome: totalAnnual / 12,
      quarterlyIncome: totalAnnual / 4,
      totalPortfolioValue: totalValue,
      totalCostBasis: totalCost
    };
    
    var historical = this.calculateHistoricalDividends(portfolio, dividendData, 5);
    var forecast = this.forecastDividends(portfolio, dividendData, 3);
    var calendar = this.createDividendCalendar(portfolio, dividendData, 6);
    var stockBreakdown = this.createStockBreakdown(stocks, dividendData, prices);
    var analysis = this.createAnalysisInsights(summary, historical, forecast);
    
    return {
      summary: summary,
      positions: positions,
      historical: historical,
      forecast: forecast,
      calendar: calendar,
      stockBreakdown: stockBreakdown,
      dividendData: dividendData,
      analysis: analysis
    };
  }
};

// Export
window.DividendDataService = DividendDataService;
window.DIVIDEND_DATABASE = DIVIDEND_DATABASE;

console.log('[OK] Dividend Data Service v7.0 loaded (with API support)');

})();
