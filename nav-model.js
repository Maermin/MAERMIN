// ============================================================================
// MAERMIN — Navigation model  (window.MaerminNav)
// ----------------------------------------------------------------------------
// One source of truth for where every view lives (PLAN P2-1):
//   Portfolio · Transactions · Dividends · Analysis · Taxes · Settings
// The sidebar, the mobile dock and the in-page tab strip all render from this.
//
// - An area holds entries. An entry is one view, or a group of views shown as
//   tabs of one page (e.g. Returns + Performance + Attribution).
// - Simple mode hides the views marked `advanced`. Nothing is deleted: view
//   ids, `g`+key shortcuts and the command palette still reach every view, and
//   a hidden view that is open stays visible in its area.
// - New vaults start in Simple; vaults that already hold transactions start in
//   Advanced (initialMode).
//
// Labels carry a translation key plus an English fallback; the renderer
// resolves them with its `t` dictionary.
// ============================================================================
(function () {
  'use strict';

  var MODE_KEY = 'maermin_ui_mode';
  var MODES = ['simple', 'advanced'];

  function v(id, key, label, advanced) { return { id: id, key: key, label: label, advanced: !!advanced }; }

  var AREAS = [
    { id: 'portfolio', key: 'navAreaPortfolio', label: 'Portfolio', icon: 'portfolios', entries: [
      v('overview', 'navOverview', 'Overview'),
      v('portfolios', 'navPortfolios', 'Portfolios'),
      v('net-worth', 'navNetWorth', 'Net Worth'),
      v('watchlist', 'navWatchlist', 'Watchlist'),
      v('rebalancing', 'navRebalancing', 'Rebalancing', true)
    ] },
    { id: 'transactions', key: 'navAreaTransactions', label: 'Transactions', shortKey: 'navAreaTransactionsShort', short: 'Trades', icon: 'transactions', entries: [
      v('transactions', 'navTransactions', 'Transactions'),
      v('savings-plans', 'navSavingsPlans', 'Savings Plans'),
      v('data', 'navImportExport', 'Import / Export'),
      v('cashflow', 'navCashflow', 'Cash Flow', true),
      v('journal', 'navJournal', 'Journal', true)
    ] },
    { id: 'dividends', key: 'navAreaDividends', label: 'Dividends', icon: 'dividends', entries: [
      v('dividends', 'navDividends', 'Dividends')
    ] },
    { id: 'analysis', key: 'navAreaAnalysis', label: 'Analysis', icon: 'hub-analytics', entries: [
      { id: 'grp-returns', key: 'navGroupReturns', label: 'Returns', tabs: [
        v('returns', 'navReturns', 'Returns & XIRR'),
        v('performance', 'navPerformance', 'Performance'),
        v('attribution', 'navAttribution', 'Attribution', true)
      ] },
      { id: 'grp-health', key: 'navGroupHealthRisk', label: 'Health & Risk', tabs: [
        v('health', 'navHealthScore', 'Health Score'),
        v('intelligence', 'intelTitle', 'Portfolio Intelligence', true),
        v('analytics', 'navRiskCorrelation', 'Risk & Correlation', true)
      ] },
      v('investment-analysis', 'navStrategy', 'Strategy', true),
      v('fees', 'navFees', 'Fee Analyzer', true),
      v('discovery', 'navDiscovery', 'Discovery', true),
      v('news', 'navNewsFeed', 'News Feed', true)
    ] },
    { id: 'taxes', key: 'navAreaTaxes', label: 'Taxes', icon: 'tax', entries: [
      v('tax', 'navTaxFifo', 'Tax & FIFO')
    ] },
    { id: 'settings', key: 'navAreaSettings', label: 'Settings', shortKey: 'navAreaSettingsShort', short: 'Settings', icon: 'settings', entries: [
      v('customize', 'navCustomize', 'Customize Overview'),
      v('categories', 'navCategories', 'Categories', true),
      v('tags', 'navTags', 'Tags', true),
      v('rules', 'navRules', 'Alerts & Rules', true),
      v('share', 'navShare', 'Share & Compare', true),
      v('trash', 'navTrash', 'Trash')
    ] }
  ];

  // View ids that render inside another view.
  var ALIASES = {
    'broker-import': 'data',
    correlation: 'analytics', montecarlo: 'analytics', stress: 'analytics', risk: 'analytics'
  };

  // viewId -> { area, entry, view }
  var INDEX = {};
  AREAS.forEach(function (area) {
    area.entries.forEach(function (entry) {
      (entry.tabs || [entry]).forEach(function (view) {
        INDEX[view.id] = { area: area, entry: entry, view: view };
      });
    });
  });

  function canonical(viewId) { return ALIASES[viewId] || viewId; }
  function lookup(viewId) { return INDEX[canonical(viewId)] || null; }
  function isKnown(viewId) { return !!lookup(viewId); }
  function areaOf(viewId) { var l = lookup(viewId); return l ? l.area.id : null; }
  function isAdvanced(viewId) { var l = lookup(viewId); return !!(l && l.view.advanced); }
  function getArea(areaId) {
    for (var i = 0; i < AREAS.length; i++) if (AREAS[i].id === areaId) return AREAS[i];
    return null;
  }

  function normalizeMode(m) { return MODES.indexOf(m) > -1 ? m : null; }
  // stored: the saved mode or null. A vault with transactions starts Advanced,
  // so existing users keep every tool they had.
  function initialMode(stored, txCount) {
    return normalizeMode(stored) || ((txCount || 0) > 0 ? 'advanced' : 'simple');
  }

  function viewShown(view, mode, activeView) {
    return mode === 'advanced' || !view.advanced || view.id === canonical(activeView);
  }

  // The tabs of a group that the mode shows (the open view always counts).
  function visibleTabs(entry, mode, activeView) {
    if (!entry.tabs) return [];
    return entry.tabs.filter(function (t) { return viewShown(t, mode, activeView); });
  }

  // The sidebar entries of an area for a mode. A group whose tabs are all
  // hidden disappears; a group left with one tab still shows under its name.
  function visibleEntries(areaId, mode, activeView) {
    var area = getArea(areaId);
    if (!area) return [];
    return area.entries.filter(function (e) {
      return e.tabs ? visibleTabs(e, mode, activeView).length > 0 : viewShown(e, mode, activeView);
    });
  }

  // The view an entry opens: the first tab the mode shows.
  function entryTarget(entry, mode) {
    if (!entry.tabs) return entry.id;
    var tabs = visibleTabs(entry, mode, null);
    return (tabs[0] || entry.tabs[0]).id;
  }

  function firstView(areaId, mode) {
    var entries = visibleEntries(areaId, mode, null);
    return entries.length ? entryTarget(entries[0], mode) : null;
  }

  // The tab strip for the open view: the visible tabs of its group, or [] when
  // the view is not part of a group or the group shows only one tab.
  function tabsFor(viewId, mode) {
    var l = lookup(viewId);
    if (!l || !l.entry.tabs) return [];
    var tabs = visibleTabs(l.entry, mode, viewId);
    return tabs.length > 1 ? tabs : [];
  }

  function entryActive(entry, activeView) {
    var id = canonical(activeView);
    return entry.tabs ? entry.tabs.some(function (t) { return t.id === id; }) : entry.id === id;
  }

  // Label resolver: t[key] when translated, else the English fallback.
  function label(item, t) { return (t && item.key && t[item.key]) || item.label; }

  var api = {
    MODE_KEY: MODE_KEY, MODES: MODES, AREAS: AREAS, ALIASES: ALIASES,
    canonical: canonical, isKnown: isKnown, areaOf: areaOf, isAdvanced: isAdvanced, getArea: getArea,
    normalizeMode: normalizeMode, initialMode: initialMode,
    visibleEntries: visibleEntries, visibleTabs: visibleTabs, entryTarget: entryTarget,
    firstView: firstView, tabsFor: tabsFor, entryActive: entryActive, label: label
  };
  if (typeof window !== 'undefined') window.MaerminNav = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
