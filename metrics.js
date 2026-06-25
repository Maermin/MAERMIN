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

  // v10.x: the asset classes to scan = the four built-ins plus any custom
  // categories (custom-categories.js). Pure in Node (no window → just the four),
  // so existing tests are unaffected.
  function allClasses() {
    var base = ['crypto', 'stocks', 'skins', 'commodities'];
    var extra = (typeof window !== 'undefined' && window.MaerminCategories && window.MaerminCategories.ids) ? window.MaerminCategories.ids() : [];
    (extra || []).forEach(function (c) { if (c && base.indexOf(c) === -1) base.push(c); });
    return base;
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
    var classes = allClasses();
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
    allClasses().forEach(function (cls) {
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
    allClasses().forEach(function (cls) {
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

  // Convert a transaction's per-unit price to EUR. USD is converted with the
  // rate AT THE TRANSACTION DATE when an `fxAt(dateISO)` resolver is supplied
  // (historical, correct for cost basis + German tax), else with the single
  // static `rate` (backward-compatible). Other currencies are treated as EUR.
  function txPriceEUR(tx, rate, fxAt) {
    var p = parseFloat(tx.price) || 0;
    if (tx.currency === 'USD') {
      var r = fxAt ? (fxAt(tx.date) || rate) : rate;
      if (r > 0) p *= r;
    }
    return p;
  }

  // FIFO lot matching for ONE symbol's buy/sell transactions. Transactions are
  // sorted chronologically and sells consume the OLDEST open lots first — the
  // statutory German method and the SAME method tax-report-builder.js uses for
  // realized disposals. Switching the displayed cost basis to this (it was a
  // proportional AVERAGE-cost reduction) means the position list and the tax
  // report can no longer disagree on cost basis after a partial sell. Pure +
  // exported for tests. Returns the OPEN lots' { amount, totalCostEUR, firstDate }
  // (amount/totalCostEUR are 0 when the position is fully sold).
  function matchFifoLots(txs, rate, fxAt) {
    var sorted = (txs || []).slice().sort(function (a, b) {
      var da = a && a.date ? new Date(a.date).getTime() : 0;
      var db = b && b.date ? new Date(b.date).getTime() : 0;
      if (isNaN(da)) da = 0;
      if (isNaN(db)) db = 0;
      if (da !== db) return da - db;
      // Same date: a BUY must be processed before a SELL so a same-day sale can
      // consume the lot it sold. Input order (e.g. a broker CSV listing the sell
      // first) must not leave the buy un-consumable and overstate the position.
      var ra = a && a.type === 'sell' ? 1 : 0;
      var rb = b && b.type === 'sell' ? 1 : 0;
      return ra - rb;
    });
    var lots = []; // open buy lots, oldest first: { qty, priceEUR, date }
    sorted.forEach(function (tx) {
      var qty = parseFloat(tx.quantity) || 0;
      if (qty <= 0) return;
      if (tx.type === 'buy') {
        lots.push({ qty: qty, priceEUR: txPriceEUR(tx, rate, fxAt), date: tx.date });
      } else if (tx.type === 'sell') {
        var remaining = qty;
        while (remaining > 1e-9 && lots.length) {
          var lot = lots[0];
          var used = Math.min(remaining, lot.qty);
          lot.qty -= used;
          remaining -= used;
          if (lot.qty <= 1e-9) lots.shift();
        }
      }
    });
    var amount = 0, totalCostEUR = 0, firstDate = null;
    lots.forEach(function (l) {
      amount += l.qty;
      totalCostEUR += l.qty * l.priceEUR;
      if (firstDate == null) firstDate = l.date;
    });
    return { amount: amount, totalCostEUR: totalCostEUR, firstDate: firstDate };
  }

  function buildPositions(transactions, opts) {
    opts = opts || {};
    var rate = parseFloat(opts.exchangeRate) || 0; // USD -> EUR (static fallback)
    var fxAt = (typeof opts.fxAt === 'function') ? opts.fxAt : null; // per-date USD→EUR
    var result = { crypto: [], stocks: [], skins: [], commodities: [] };
    // v10.x: register custom-category buckets (custom-categories.js) so their
    // positions are kept and valued instead of being dropped as "unknown".
    var extraCats = opts.categories ||
      ((typeof window !== 'undefined' && window.MaerminCategories && window.MaerminCategories.ids) ? window.MaerminCategories.ids() : []);
    (extraCats || []).forEach(function (c) { if (c && !result[c]) result[c] = []; });
    // Group every transaction by category+symbol, then FIFO-match each group so
    // the remaining position carries a real lot-based cost basis.
    var groups = {};
    (transactions || []).forEach(function (tx) {
      var category = tx.category || 'crypto';
      if (!result[category]) return; // ignore unknown classes
      var key = category + '-' + (tx.symbol || '').toLowerCase();
      if (!groups[key]) {
        groups[key] = { category: category, symbol: tx.symbol, symbolName: tx.symbolName || '', symbolLogoUrl: tx.symbolLogoUrl || '', txs: [] };
      }
      if (!groups[key].symbolName && tx.symbolName) groups[key].symbolName = tx.symbolName;
      if (!groups[key].symbolLogoUrl && tx.symbolLogoUrl) groups[key].symbolLogoUrl = tx.symbolLogoUrl;
      groups[key].txs.push(tx);
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      var open = matchFifoLots(g.txs, rate, fxAt);
      if (open.amount > 0.0001) {
        result[g.category].push({
          id: g.category + '-' + g.symbol,
          symbol: g.symbol,
          symbolName: g.symbolName,
          symbolLogoUrl: g.symbolLogoUrl,
          name: g.symbolName || g.symbol,
          amount: open.amount,
          purchasePrice: open.amount > 0 ? open.totalCostEUR / open.amount : 0,
          purchaseDate: open.firstDate
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
    // v10.x: iterate ALL portfolio classes (built-in + custom) so custom-category
    // value is included in the headline totals. Robust against non-array values.
    Object.keys(portfolio).forEach(function (cls) {
      var list = Array.isArray(portfolio[cls]) ? portfolio[cls] : [];
      list.forEach(function (pos) {
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
    matchFifoLots: matchFifoLots,
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
