// ============================================================================
// MAERMIN — Allocation Engine  (window.MaerminAllocation)
// ----------------------------------------------------------------------------
// Feature #5: a single allocation computation that works BOTH portfolio-wide and
// per-portfolio (the caller passes whichever `portfolio` object it wants), and
// breaks holdings down by asset class — Stocks, ETFs (optional split), Crypto,
// CS2 Skins, Commodities, Cash and Other — with absolute AND percentage values
// plus per-class drill-down. Pure + unit-tested (test/allocation.test.js).
//
// Prices are the canonical-EUR map (skins already USD→EUR converted upstream),
// so every figure here is in the same currency the UI formats.
// ============================================================================
(function () {
  'use strict';

  var CLASS_LABELS = {
    stocks: 'Stocks', etfs: 'ETFs', crypto: 'Crypto', skins: 'CS2 Skins',
    commodities: 'Commodities', cash: 'Cash', other: 'Other'
  };
  var CLASS_COLORS = {
    stocks: '#3b82f6', etfs: '#6366f1', crypto: '#f59e0b', skins: '#06b6d4',
    commodities: '#d97706', cash: '#22c55e', other: '#8b94a7'
  };

  function priceOf(prices, pos) {
    var s = pos.symbol || pos.name || '';
    return prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || pos.currentPrice || pos.purchasePrice || 0;
  }

  // Label + colour for a class key. Built-ins use the maps above; custom
  // categories (custom-categories.js) resolve to their user label/colour; an
  // unknown key falls back to the raw key + grey.
  function classMeta(key) {
    if (CLASS_LABELS[key]) return { label: CLASS_LABELS[key], color: CLASS_COLORS[key] || '#888' };
    if (typeof window !== 'undefined' && window.MaerminCategories) {
      try { return { label: window.MaerminCategories.label(key), color: window.MaerminCategories.color(key) }; }
      catch (e) { /* fall through */ }
    }
    return { label: key, color: '#888' };
  }

  // The asset classes to scan: the four built-ins plus any custom categories
  // (explicit opts.categories wins, else the registry). Pure in Node (no window).
  function scanClasses(opts) {
    var classes = ['crypto', 'stocks', 'skins', 'commodities'];
    var extra = opts.categories ||
      ((typeof window !== 'undefined' && window.MaerminCategories && window.MaerminCategories.ids) ? window.MaerminCategories.ids() : []);
    (extra || []).forEach(function (c) { if (c && classes.indexOf(c) === -1) classes.push(c); });
    return classes;
  }

  function loadAccounts() {
    try { return JSON.parse(localStorage.getItem('maermin_networth_accounts') || '[]'); }
    catch (e) { return []; }
  }

  // computeAllocation(portfolio, prices, opts)
  //   opts.includeCash   : fold cash/checking + other_asset accounts in
  //   opts.accounts      : explicit accounts (else loaded from storage)
  //   opts.classifyEtf   : fn(position) -> true to move a stock into 'etfs'
  function computeAllocation(portfolio, prices, opts) {
    portfolio = portfolio || {};
    prices = prices || {};
    opts = opts || {};
    var classifyEtf = typeof opts.classifyEtf === 'function' ? opts.classifyEtf : null;

    var buckets = {}; // key -> { value, positions: [] }
    function bucket(key) { return (buckets[key] || (buckets[key] = { value: 0, positions: [] })); }

    scanClasses(opts).forEach(function (cls) {
      (portfolio[cls] || []).forEach(function (pos) {
        var amount = parseFloat(pos.amount) || 0;
        var value = amount * priceOf(prices, pos);
        if (value <= 0) return;
        var key = cls;
        if (cls === 'stocks' && classifyEtf && classifyEtf(pos)) key = 'etfs';
        var b = bucket(key);
        b.value += value;
        b.positions.push({ symbol: pos.symbol || pos.name, value: value });
      });
    });

    if (opts.includeCash) {
      var accounts = opts.accounts || loadAccounts();
      accounts.forEach(function (a) {
        var v = parseFloat(a.value || 0) || 0;
        if (v <= 0) return;
        if (a.type === 'cash' || a.type === 'checking') { var bc = bucket('cash'); bc.value += v; bc.positions.push({ symbol: a.name || 'Cash', value: v }); }
        else if (a.type === 'other_asset' || a.type === 'property' || a.type === 'crypto_wallet') { var bo = bucket('other'); bo.value += v; bo.positions.push({ symbol: a.name || 'Other', value: v }); }
      });
    }

    var total = Object.keys(buckets).reduce(function (s, k) { return s + buckets[k].value; }, 0);

    var byClass = Object.keys(buckets).map(function (key) {
      var b = buckets[key];
      var positions = b.positions
        .sort(function (x, y) { return y.value - x.value; })
        .map(function (p) { return { symbol: p.symbol, value: p.value, pct: total > 0 ? (p.value / total) * 100 : 0 }; });
      var meta = classMeta(key);
      return {
        key: key, label: meta.label, color: meta.color,
        value: b.value, pct: total > 0 ? (b.value / total) * 100 : 0,
        count: positions.length, positions: positions
      };
    }).sort(function (a, b) { return b.value - a.value; });

    return { total: total, byClass: byClass, available: total > 0 };
  }

  var api = {
    CLASS_LABELS: CLASS_LABELS, CLASS_COLORS: CLASS_COLORS,
    computeAllocation: computeAllocation
  };
  if (typeof window !== 'undefined') window.MaerminAllocation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
