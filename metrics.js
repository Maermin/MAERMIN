/**
 * MAERMIN - Shared Portfolio Metrics
 * ------------------------------------------------------------------
 * A single source of truth for the cross-cutting numbers that V7
 * surfaces in several places (dashboard KPIs, Net Worth, Monte Carlo,
 * Forecasting). It does NOT introduce new calculation engines — it
 * reuses what already exists:
 *
 *   - Net Worth   : the exact formula NetWorthView (features5) uses,
 *                   reading the same `maermin_networth_accounts` store.
 *   - Dividends   : window.DividendDataService.getPortfolioDividendData
 *                   (per-symbol annual dividend lookup).
 *   - Health      : window.PortfolioHealth.computeHealth.
 *   - FIRE        : the only genuinely new bit of arithmetic — the 4%
 *                   rule applied to net worth + a single user input
 *                   (annual expenses). No dependency on the orphaned
 *                   calculator-extended financialData model.
 *
 * Exposes window.MaerminMetrics. Pure functions; UI stays in the views.
 */
(function () {
  'use strict';

  // Account types that count as liabilities — must match NetWorthView (features5).
  var LIABILITY_TYPES = ['loan', 'credit', 'other_liability'];
  var NETWORTH_ACCOUNTS_KEY = 'maermin_networth_accounts';
  var FIRE_SETTINGS_KEY = 'maermin_fire_settings';
  var DEFAULT_FIRE = { annualExpenses: 0, withdrawalRate: 4 };

  function isLiability(type) { return LIABILITY_TYPES.indexOf(type) !== -1; }

  function loadAccounts() {
    try { return JSON.parse(localStorage.getItem(NETWORTH_ACCOUNTS_KEY) || '[]'); }
    catch (e) { return []; }
  }

  // ---- Net Worth -----------------------------------------------------------
  // netWorth = portfolio value + non-liability accounts - liability accounts.
  // Same definition as NetWorthView, centralised so both read one truth.
  function computeNetWorth(portfolioValue, accounts) {
    accounts = accounts || loadAccounts();
    var assets = 0, liabilities = 0;
    accounts.forEach(function (a) {
      var v = parseFloat(a.value || 0) || 0;
      if (isLiability(a.type)) liabilities += v; else assets += v;
    });
    var pv = parseFloat(portfolioValue || 0) || 0;
    var total = pv + assets;
    // Liquidity ratio = share of net worth held in cash/checking accounts.
    var liquid = 0;
    accounts.forEach(function (a) {
      if (a.type === 'cash' || a.type === 'checking') liquid += parseFloat(a.value || 0) || 0;
    });
    var net = pv + assets - liabilities;
    return {
      portfolioValue: pv,
      manualAssets: assets,
      liabilities: liabilities,
      assets: total,
      netWorth: net,
      liquidAssets: liquid,
      liquidityRatio: net > 0 ? (liquid / net) * 100 : 0
    };
  }

  // ---- FIRE ----------------------------------------------------------------
  function loadFireSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem(FIRE_SETTINGS_KEY) || '{}');
      return {
        annualExpenses: parseFloat(saved.annualExpenses) || DEFAULT_FIRE.annualExpenses,
        withdrawalRate: parseFloat(saved.withdrawalRate) || DEFAULT_FIRE.withdrawalRate
      };
    } catch (e) { return { annualExpenses: DEFAULT_FIRE.annualExpenses, withdrawalRate: DEFAULT_FIRE.withdrawalRate }; }
  }

  function saveFireSettings(s) {
    try {
      localStorage.setItem(FIRE_SETTINGS_KEY, JSON.stringify({
        annualExpenses: parseFloat(s.annualExpenses) || 0,
        withdrawalRate: parseFloat(s.withdrawalRate) || DEFAULT_FIRE.withdrawalRate
      }));
    } catch (e) { /* storage full / unavailable — non-fatal */ }
  }

  // FIRE = financial independence number via the safe-withdrawal-rate rule.
  // fireNumber = annualExpenses / (withdrawalRate%)  ==  annualExpenses * (100/wr).
  // `monthlySavings` is optional; when provided we estimate years-to-FIRE.
  function computeFireMetrics(netWorth, settings, monthlySavings) {
    settings = settings || loadFireSettings();
    var wr = settings.withdrawalRate > 0 ? settings.withdrawalRate : DEFAULT_FIRE.withdrawalRate;
    var annualExpenses = settings.annualExpenses > 0 ? settings.annualExpenses : 0;
    var configured = annualExpenses > 0;
    var fireNumber = configured ? annualExpenses * (100 / wr) : 0;
    var progress = fireNumber > 0 ? (netWorth / fireNumber) * 100 : 0;
    var currentAnnualPassive = netWorth * (wr / 100);

    // Simple (non-compounding) years estimate from a steady monthly contribution.
    var yearsToFire = null;
    if (configured && progress < 100 && monthlySavings > 0) {
      yearsToFire = (fireNumber - netWorth) / (monthlySavings * 12);
    } else if (configured && progress >= 100) {
      yearsToFire = 0;
    }

    return {
      configured: configured,
      fireNumber: fireNumber,
      netWorth: netWorth,
      withdrawalRate: wr,
      annualExpenses: annualExpenses,
      progress: Math.max(0, progress),
      monthlyPassiveIncome: currentAnnualPassive / 12,
      coveredExpenseRatio: annualExpenses > 0 ? (currentAnnualPassive / annualExpenses) * 100 : 0,
      yearsToFire: yearsToFire
    };
  }

  // ---- Dividends -----------------------------------------------------------
  // Expected forward annual dividend income from current stock holdings.
  // Reuses DividendDataService's per-symbol lookup (DB/cache/API) — same
  // shares*annualDividend basis as analyzePortfolioDividends, without the
  // heavy historical/forecast/calendar work or its console logging.
  function computeExpectedAnnualDividends(portfolio, prices) {
    var empty = { available: false, totalAnnual: 0, monthly: 0, yield: 0, payers: 0 };
    var svc = (typeof window !== 'undefined') && window.DividendDataService;
    if (!svc || typeof svc.getPortfolioDividendData !== 'function') return empty;
    portfolio = portfolio || {};
    prices = prices || {};
    try {
      var data = svc.getPortfolioDividendData(portfolio, prices) || {};
      var stocks = portfolio.stocks || [];
      var totalAnnual = 0, totalValue = 0, payers = 0;
      stocks.forEach(function (s) {
        var sym = (s.symbol || s.name || '').toUpperCase();
        var shares = parseFloat(s.amount || 0) || 0;
        if (shares <= 0) return;
        var price = prices[sym] || prices[sym.toLowerCase()] || s.currentPrice || s.purchasePrice || 0;
        totalValue += shares * price;
        var d = data[sym];
        if (d && d.annualDividend > 0) { totalAnnual += shares * d.annualDividend; payers++; }
      });
      return {
        available: payers > 0,
        totalAnnual: totalAnnual,
        monthly: totalAnnual / 12,
        yield: totalValue > 0 ? (totalAnnual / totalValue) * 100 : 0,
        payers: payers
      };
    } catch (e) { return empty; }
  }

  // ---- Health --------------------------------------------------------------
  // Thin pass-through so callers don't have to reach into PortfolioHealth.
  // extras (optional): { priceHistory, transactions, accounts } — enables the
  // risk / liquidity / tax sub-scores; degrades gracefully when omitted.
  function healthScore(portfolio, prices, t, extras) {
    var ph = (typeof window !== 'undefined') && window.PortfolioHealth;
    if (!ph || typeof ph.computeHealth !== 'function') return null;
    try { return ph.computeHealth(portfolio, prices, t, extras); }
    catch (e) { return null; }
  }

  // ---- Allocation / risk dimensions ---------------------------------------
  function priceOf(prices, pos) {
    var s = pos.symbol || pos.name || '';
    return prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || pos.currentPrice || 0;
  }
  function classValue(portfolio, prices, cls) {
    return (portfolio[cls] || []).reduce(function (sum, p) {
      return sum + (parseFloat(p.amount) || 0) * priceOf(prices, p);
    }, 0);
  }

  // Concentration — reuses PortfolioHealth's HHI math (no second implementation).
  function computeConcentration(portfolio, prices) {
    var ph = (typeof window !== 'undefined') && window.PortfolioHealth;
    if (!ph || typeof ph.computeHealth !== 'function') return { available: false, maxWeight: 0, effectiveN: 0, top: [] };
    try {
      var h = ph.computeHealth(portfolio, prices, {});
      if (!h || h.empty) return { available: false, maxWeight: 0, effectiveN: 0, top: [] };
      return { available: true, maxWeight: h.maxWeight, effectiveN: h.effectiveN, classCount: h.classCount, top: h.top || [] };
    } catch (e) { return { available: false, maxWeight: 0, effectiveN: 0, top: [] }; }
  }

  // Rebalancing drift vs the targets RebalancingView stores (same localStorage key).
  var REBAL_TARGETS_KEY = 'maermin_targets';
  var DEFAULT_TARGETS = { crypto: 35, stocks: 45, skins: 10, commodities: 10 };
  function loadTargets() {
    try {
      var saved = JSON.parse(localStorage.getItem(REBAL_TARGETS_KEY) || 'null');
      return saved && typeof saved === 'object' ? Object.assign({}, DEFAULT_TARGETS, saved) : Object.assign({}, DEFAULT_TARGETS);
    } catch (e) { return Object.assign({}, DEFAULT_TARGETS); }
  }
  function computeRebalancingDrift(portfolio, prices, targets) {
    targets = targets || loadTargets();
    var classes = ['crypto', 'stocks', 'skins', 'commodities'];
    var values = {}, total = 0;
    classes.forEach(function (c) { values[c] = classValue(portfolio, prices, c); total += values[c]; });
    if (total <= 0) return { available: false, rows: [], maxDrift: 0 };
    var rows = classes.map(function (c) {
      var currentPct = (values[c] / total) * 100;
      var targetPct = targets[c] || 0;
      return { cls: c, currentPct: currentPct, targetPct: targetPct, drift: currentPct - targetPct, value: values[c] };
    }).filter(function (r) { return r.value > 0 || r.targetPct > 0; });
    var maxDrift = rows.reduce(function (m, r) { return Math.max(m, Math.abs(r.drift)); }, 0);
    return { available: true, rows: rows, maxDrift: maxDrift, total: total };
  }

  // Currency exposure — uses each position's transaction currency (real data),
  // falling back to a per-class default only when a position has no dated tx.
  function computeCurrencyExposure(portfolio, prices, transactions) {
    transactions = transactions || [];
    var curByKey = {};
    transactions.forEach(function (tx) {
      var key = (tx.category || 'crypto') + '-' + (tx.symbol || '').toLowerCase();
      if (tx.currency && !curByKey[key]) curByKey[key] = tx.currency;
    });
    var byCur = {}, total = 0;
    ['crypto', 'stocks', 'skins', 'commodities'].forEach(function (cls) {
      (portfolio[cls] || []).forEach(function (p) {
        var val = (parseFloat(p.amount) || 0) * priceOf(prices, p);
        if (val <= 0) return;
        var cur = curByKey[cls + '-' + (p.symbol || '').toLowerCase()] || ((cls === 'crypto' || cls === 'skins') ? 'USD' : 'EUR');
        byCur[cur] = (byCur[cur] || 0) + val;
        total += val;
      });
    });
    if (total <= 0) return { available: false, rows: [], currencyCount: 0 };
    var rows = Object.keys(byCur).map(function (c) { return { currency: c, value: byCur[c], pct: (byCur[c] / total) * 100 }; })
      .sort(function (a, b) { return b.value - a.value; });
    return { available: true, rows: rows, total: total, currencyCount: rows.length };
  }

  // Tax-loss harvesting candidates — open positions at an unrealised loss that
  // could be sold to offset realised gains. Uses the real portfolio (average
  // cost lives in purchasePrice) + transactions for a 30-day wash-sale flag.
  // rate defaults to the German flat capital-gains rate (Abgeltungssteuer).
  function computeTaxLossHarvest(portfolio, prices, transactions, opts) {
    opts = opts || {};
    var rate = opts.rate != null ? opts.rate : 0.26375;
    transactions = transactions || [];
    var now = Date.now();
    var recentBuy = {};
    transactions.forEach(function (tx) {
      if (tx.type !== 'buy' || !tx.date) return;
      if ((now - new Date(tx.date).getTime()) / 86400000 <= 30) {
        recentBuy[(tx.category || '') + '-' + (tx.symbol || '').toLowerCase()] = true;
      }
    });
    var rows = [];
    ['crypto', 'stocks', 'skins', 'commodities'].forEach(function (cls) {
      (portfolio[cls] || []).forEach(function (p) {
        var amount = parseFloat(p.amount) || 0;
        var price = priceOf(prices, p);
        var cost = parseFloat(p.purchasePrice) || 0;
        if (amount <= 0 || price <= 0 || cost <= 0) return;
        var unrealized = (price - cost) * amount;
        if (unrealized < 0) {
          var wash = !!recentBuy[cls + '-' + (p.symbol || p.name || '').toLowerCase()];
          rows.push({
            symbol: p.symbol || p.name, cls: cls,
            unrealizedLoss: unrealized,
            taxSavings: wash ? 0 : Math.abs(unrealized) * rate,
            washSale: wash
          });
        }
      });
    });
    rows.sort(function (a, b) { return a.unrealizedLoss - b.unrealizedLoss; });
    return {
      available: rows.length > 0,
      rows: rows,
      totalLoss: rows.reduce(function (s, r) { return s + r.unrealizedLoss; }, 0),
      totalSavings: rows.reduce(function (s, r) { return s + r.taxSavings; }, 0),
      rate: rate
    };
  }

  // ---- Position aggregation (single source of truth) -----------------------
  // Build the grouped portfolio object {crypto,stocks,skins,commodities} from a
  // flat transaction list. Cost basis is kept in EUR (USD tx converted with the
  // live rate), and sells reduce the basis proportionally. This is the ONE
  // implementation the renderer's `portfolio`, `allPortfoliosPortfolio`,
  // `portfolioStats` and `allPortfoliosStats` all delegate to, so the four can
  // never drift apart. Pure + unit-tested (test/positions.test.js).
  var ASSET_CLASSES = ['crypto', 'stocks', 'skins', 'commodities'];

  function buildPositions(transactions, opts) {
    opts = opts || {};
    var rate = parseFloat(opts.exchangeRate) || 0; // USD -> EUR
    var result = { crypto: [], stocks: [], skins: [], commodities: [] };
    var map = {};
    (transactions || []).forEach(function (tx) {
      var category = tx.category || 'crypto';
      if (!result[category]) return; // ignore unknown classes
      var symLower = (tx.symbol || '').toLowerCase();
      var key = category + '-' + symLower;
      if (!map[key]) {
        map[key] = {
          symbol: tx.symbol, symbolName: tx.symbolName || '', symbolLogoUrl: tx.symbolLogoUrl || '',
          amount: 0, totalCostEUR: 0, purchaseDate: tx.date, category: category
        };
      }
      if (!map[key].symbolName && tx.symbolName) map[key].symbolName = tx.symbolName;
      if (!map[key].symbolLogoUrl && tx.symbolLogoUrl) map[key].symbolLogoUrl = tx.symbolLogoUrl;

      var qty = parseFloat(tx.quantity) || 0;
      var priceEUR = parseFloat(tx.price) || 0;
      if (tx.currency === 'USD' && rate > 0) priceEUR *= rate;

      if (tx.type === 'buy') {
        map[key].amount += qty;
        map[key].totalCostEUR += qty * priceEUR;
      } else if (tx.type === 'sell') {
        var cur = map[key].amount;
        if (cur > 0) {
          var frac = Math.min(qty, cur) / cur;
          map[key].totalCostEUR -= map[key].totalCostEUR * frac;
        }
        map[key].amount = Math.max(0, cur - qty);
      }
    });
    Object.keys(map).forEach(function (k) {
      var pos = map[k];
      if (pos.amount > 0.0001) {
        result[pos.category].push({
          id: pos.category + '-' + pos.symbol,
          symbol: pos.symbol,
          symbolName: pos.symbolName,
          symbolLogoUrl: pos.symbolLogoUrl,
          name: pos.symbolName || pos.symbol,
          amount: pos.amount,
          purchasePrice: pos.amount > 0 ? pos.totalCostEUR / pos.amount : 0,
          purchaseDate: pos.purchaseDate
        });
      }
    });
    return result;
  }

  // Totals for a grouped portfolio object using the current EUR price map.
  function computeStats(portfolio, prices) {
    portfolio = portfolio || {};
    prices = prices || {};
    var totalValue = 0, totalInvested = 0, totalPositions = 0;
    ASSET_CLASSES.forEach(function (cls) {
      (portfolio[cls] || []).forEach(function (pos) {
        var amount = parseFloat(pos.amount) || 0;
        var price = priceOf(prices, pos) || parseFloat(pos.purchasePrice) || 0;
        totalValue += amount * price;
        totalInvested += amount * (parseFloat(pos.purchasePrice) || 0);
        totalPositions++;
      });
    });
    return {
      totalValue: totalValue,
      totalInvested: totalInvested,
      totalProfit: totalValue - totalInvested,
      totalProfitPercent: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
      totalPositions: totalPositions
    };
  }

  var api = {
    ASSET_CLASSES: ASSET_CLASSES,
    buildPositions: buildPositions,
    computeStats: computeStats,
    LIABILITY_TYPES: LIABILITY_TYPES,
    NETWORTH_ACCOUNTS_KEY: NETWORTH_ACCOUNTS_KEY,
    FIRE_SETTINGS_KEY: FIRE_SETTINGS_KEY,
    isLiability: isLiability,
    loadAccounts: loadAccounts,
    computeNetWorth: computeNetWorth,
    loadFireSettings: loadFireSettings,
    saveFireSettings: saveFireSettings,
    computeFireMetrics: computeFireMetrics,
    computeExpectedAnnualDividends: computeExpectedAnnualDividends,
    healthScore: healthScore,
    REBAL_TARGETS_KEY: REBAL_TARGETS_KEY,
    loadTargets: loadTargets,
    computeConcentration: computeConcentration,
    computeRebalancingDrift: computeRebalancingDrift,
    computeCurrencyExposure: computeCurrencyExposure,
    computeTaxLossHarvest: computeTaxLossHarvest
  };

  if (typeof window !== 'undefined') window.MaerminMetrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
