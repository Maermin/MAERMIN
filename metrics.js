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

  var api = {
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
    healthScore: healthScore
  };

  if (typeof window !== 'undefined') window.MaerminMetrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
