// ============================================================================
// MAERMIN - dev/desktop boot helper (loading-screen teardown + module check).
// Moved out of an inline <script> in index.html so the page runs under a CSP
// WITHOUT 'unsafe-inline' for scripts. The production build ships its own
// boot.js and skips this file.
// ============================================================================
// No artificial delay: the splash fades as soon as the page has loaded (it
// used to wait an extra ~0.8 s here and ~1.1 s in the production boot.js).
window.addEventListener('load', () => {
  updateStatus('Ready!');
  const loading = document.getElementById('loading');
  if (loading) {
    loading.classList.add('hidden');
    setTimeout(() => loading.remove(), 500);
  }
});

console.log('%c[MAERMIN v11.0] Professional Portfolio Tracker', 'font-size: 20px; font-weight: bold; color: #7e22ce; background: #f3e8ff; padding: 8px;');
console.log('[INFO] v11.0: One FIFO ledger · Value history from day one · Trade-date FX · Anlage KAP · Steam import');
console.log('[INFO] DCA Analyzer, Dividend Tracker, Benchmark Comparison');
console.log('[INFO] Goal Planning, Portfolio Optimization, Factor Analysis');
console.log('[INFO] Sector Allocation, Currency Exposure, Liquidity Analysis');
console.log('[INFO] Economic Indicators, Options/Greeks, Attribution');
console.log('[INFO] Tax Withdrawal Planning, Margin Tracker, Sentiment Analysis');
console.log('[INFO] Press Ctrl+K to open Command Palette');

setTimeout(() => {
  const checks = [
    { name: 'React', check: () => typeof React !== 'undefined' },
    { name: 'ReactDOM', check: () => typeof ReactDOM !== 'undefined' },
    { name: 'Monte Carlo Engine', check: () => typeof window.MonteCarloEngine !== 'undefined' },
    { name: 'Correlation Engine', check: () => typeof window.CorrelationEngine !== 'undefined' },
    { name: 'Stress Test Engine', check: () => typeof window.StressTestEngine !== 'undefined' },
    { name: 'Risk Analytics View', check: () => typeof window.RiskAnalyticsViewV2 !== 'undefined' },
    { name: 'DCA Analyzer Engine', check: () => typeof window.DCAAnalyzerEngine !== 'undefined' },
    { name: 'Tax Calculation Engine', check: () => typeof window.TaxCalculationEngine !== 'undefined' },
    { name: 'Import/Export Engine', check: () => typeof window.ImportExportEngine !== 'undefined' },
    { name: 'Dividend Data Service', check: () => typeof window.DividendDataService !== 'undefined' },
    { name: 'Investment Views', check: () => typeof window.InvestmentViews !== 'undefined' },
    { name: 'Command Palette', check: () => typeof window.CommandPalette !== 'undefined' },
    { name: 'Portfolio Snapshots', check: () => typeof window.MaerminSnapshots !== 'undefined' },
    { name: 'Smart Tags', check: () => typeof window.MaerminTags !== 'undefined' },
    { name: 'Dashboard Layout', check: () => typeof window.MaerminDashboard !== 'undefined' },
    { name: 'Performance Cards', check: () => typeof window.MaerminPerformance !== 'undefined' },
    { name: 'Rebalancing Planner', check: () => typeof window.MaerminRebalance !== 'undefined' },
    { name: 'Automation Rules', check: () => typeof window.MaerminRules !== 'undefined' },
    { name: 'Custom Categories', check: () => typeof window.MaerminCategories !== 'undefined' },
    { name: 'Dividend Auto-book', check: () => typeof window.MaerminDividendExecutor !== 'undefined' },
    { name: 'FX History', check: () => typeof window.MaerminFxHistory !== 'undefined' },
    { name: 'Compute Client', check: () => typeof window.MaerminCompute !== 'undefined' },
    { name: 'IndexedDB Store', check: () => typeof window.MaerminIDB !== 'undefined' },
    { name: 'State Store', check: () => typeof window.MaerminStore !== 'undefined' },
    { name: 'Prefs Store', check: () => typeof window.MaerminPrefs !== 'undefined' },
    { name: 'UI Store', check: () => typeof window.MaerminUI !== 'undefined' },
    { name: 'Market Store', check: () => typeof window.MaerminMarket !== 'undefined' },
    { name: 'jsPDF (lazy)', check: () => true }
  ];
  
  console.log('[MODULE CHECK MAERMIN v11.0]');
  let loaded = 0;
  checks.forEach(item => {
    const status = item.check();
    if (status) loaded++;
    console.log('  ' + (status ? '[OK]' : '[MISSING]') + ' ' + item.name);
  });
  
  console.log(`[LOADED] ${loaded}/${checks.length} modules`);
  if (loaded === checks.length) {
    console.log('%cAll modules loaded!', 'color: #22c55e; font-weight: bold');
  } else {
    console.warn(`[WARN] ${checks.length - loaded} module(s) missing – check errors above`);
  }
}, 1500);
  
