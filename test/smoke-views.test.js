// Smoke tests for the React view layer (renderer-side modules).
//
// WHY: the pure engines (allocation, tax, projection, …) are well covered, but
// every component module — features.js…features7.js, investment-views.js,
// portfolio-health.js — had ZERO automated coverage. A renamed export, a broken
// top-level `const { useState } = React`, or a crash on the initial render path
// would ship silently. This suite is the cheap, broad net:
//
//   Tier 1 (gating): every view module LOADS without throwing, and every
//                    documented component is exported as a function.
//   Tier 2 (gating): a curated set of components RENDERS once (initial render,
//                    hooks stubbed) against representative AND empty data
//                    without throwing.
//
// It is deliberately environment-light (no jsdom): a minimal React stub runs
// each function component a single time, which still executes the render body
// and every useMemo (where the real allocation/projection math lives).
//
// Run: node test/smoke-views.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, err) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (err ? '  → ' + err : '')); }
}

// ---------------------------------------------------------------------------
// Minimal React stub. Enough to (a) satisfy top-level `const {…} = React`
// destructuring at module load, and (b) run a function component once.
// ---------------------------------------------------------------------------
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { $$typeof: 'el', type, props: props || {}, children };
  },
  cloneElement(el, props) { return { ...el, props: { ...el.props, ...props } }; },
  isValidElement(x) { return !!x && x.$$typeof === 'el'; },
  Children: { map: (c, f) => (Array.isArray(c) ? c.map(f) : c == null ? c : [f(c, 0)]), toArray: (c) => [].concat(c) },
  // Hooks — single synchronous render semantics.
  useState(init) { return [typeof init === 'function' ? init() : init, () => {}]; },
  useReducer(_r, init, initFn) { return [initFn ? initFn(init) : init, () => {}]; },
  useMemo(fn) { return fn(); },
  useCallback(fn) { return fn; },
  useEffect() {},
  useLayoutEffect() {},
  useRef(v) { return { current: v === undefined ? null : v }; },
  useContext(ctx) { return ctx && ctx._cur !== undefined ? ctx._cur : (ctx && ctx._def); },
  createContext(def) { const c = { _def: def, _cur: def }; c.Provider = ({ children }) => children; c.Consumer = ({ children }) => (typeof children === 'function' ? children(def) : children); return c; },
  memo(fn) { return fn; },
  forwardRef(fn) { return (props) => fn(props, { current: null }); },
};

// ---------------------------------------------------------------------------
// Browser-ish globals the modules may touch at load or first render.
// ---------------------------------------------------------------------------
const noop = () => {};
const elStub = () => ({ style: {}, setAttribute: noop, appendChild: noop, getContext: () => ({}), classList: { add: noop, remove: noop } });
globalThis.React = React;
globalThis.window = globalThis.window || {};
globalThis.window.React = React;
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.window.localStorage = globalThis.localStorage;
globalThis.document = {
  createElement: elStub, getElementById: () => null, querySelector: () => null,
  querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop, body: elStub(),
};
globalThis.window.document = globalThis.document;
globalThis.window.addEventListener = noop;
globalThis.window.matchMedia = () => ({ matches: false, addListener: noop, removeListener: noop, addEventListener: noop });
globalThis.window.navigator = globalThis.navigator || { language: 'en-US', clipboard: { writeText: noop } };

// ---------------------------------------------------------------------------
// Preload the engine globals the components reach for internally (window.*).
// Each is optional — record but don't hard-fail if one can't load here.
// ---------------------------------------------------------------------------
const engines = [
  '../utils.js', '../allocation.js', '../metrics.js', '../projection.js',
  '../recurring.js', '../equity-metadata.js', '../portfolio-health.js',
  '../data-quality.js', '../portfolio-analytics.js', '../analytics-data.js',
];
console.log('engine preload:');
for (const e of engines) {
  try { require(e); ok('loaded ' + e.replace('../', ''), true); }
  catch (err) { ok('loaded ' + e.replace('../', ''), false, err.message); }
}

// ---------------------------------------------------------------------------
// Tier 1 — every view module loads + exports the documented components.
// ---------------------------------------------------------------------------
const VIEW_MODULES = [
  { file: '../features.js',         ns: 'MaerminFeatures',  comps: ['PieChart', 'Sparkline', 'PriceQualityBadge', 'PortfolioOverviewPanel', 'WatchlistView', 'PriceAlertsView', 'PerformanceChart', 'PositionsTable'] },
  { file: '../features2.js',        ns: 'MaerminFeatures2', comps: ['ReturnsView', 'RebalancingView', 'BrokerImportWizard', 'PositionNotesView', 'DividendCalendarView', 'MobileBottomNav', 'calcXIRR', 'calcTWR'] },
  { file: '../features3.js',        ns: 'MaerminFeatures3', comps: ['BenchmarkWidget', 'DailyPnLCard', 'PositionDetailModal', 'EnhancedPositionsTable', 'CS2SkinPicker', 'CS2SkinImage', 'SymbolPicker'] },
  { file: '../features4.js',        ns: 'MaerminFeatures4', comps: ['usePortfolios', 'PortfolioManagerView', 'PortfolioSwitcher', 'SavingsPlanView', 'DividendForecastView', 'FIFOView', 'calcFIFO'] },
  { file: '../features5.js',        ns: 'MaerminFeatures5', comps: ['PerformancePeriods', 'NetWorthView', 'CashflowChart', 'FeeAnalyzer'] },
  { file: '../features6.js',        ns: 'MaerminFeatures6', comps: ['PortfolioHistoryChart'] },
  { file: '../features7.js',        ns: 'MaerminFeatures7', comps: ['PerformanceAttribution', 'RealizedUnrealizedView', 'NewsFeedView'] },
  { file: '../investment-views.js', ns: 'InvestmentViews',  comps: ['DCAAnalyzerView', 'SectorAllocationView', 'CountryAllocationView', 'CurrencyExposureView', 'LiquidityAnalysisView', 'GoalInvestingView', 'InvestmentAnalysisDashboard', 'AnalysisCard', 'MetricGrid', 'DataTable', 'ProgressBar', 'TabBar'] },
  { file: '../portfolio-health.js', ns: 'PortfolioHealth',  comps: ['HealthView', 'computeHealth'] },
  // Analytics fold-in panels + first-run onboarding (engine surfaced in existing views).
  { file: '../analytics-views.js',  ns: 'MaerminAnalyticsViews', comps: ['BenchmarkPanel', 'RollingRiskPanel', 'FactorExposurePanel'] },
  { file: '../simulator-view.js',   ns: 'MaerminSimulatorView',  comps: ['Panel', 'buildResults', 'defaults'] },
  { file: '../advisor.js',          ns: 'MaerminAdvisor',        comps: ['Panel', 'analyzePortfolio', 'analyzeFromMetrics'] },
  { file: '../onboarding.js',       ns: 'MaerminOnboarding',     comps: ['Wizard', 'probeAll', 'classify', 'endpoints'] },
  { file: '../discovery.js',        ns: 'MaerminDiscovery',      comps: ['View', 'parseResponse', 'buildUrl', 'sortRows', 'dividendScreen', 'toEURRow'] },
  { file: '../etf-lookthrough.js',  ns: 'MaerminLookThrough',    comps: ['Panel', 'analyze', 'parseHoldingsResponse', 'mergeFundData', 'fallbackHoldings', 'positionRows', 'buildUrl', 'loadFundData'] },
  { file: '../cost-analysis.js',    ns: 'MaerminCostAnalysis',   comps: ['OngoingCostsPanel', 'computeOngoingCosts', 'buildFundRows', 'projectCostDrag', 'loadOverrides', 'saveOverride'] },
  { file: '../dividend-quality.js', ns: 'MaerminDividendQuality', comps: ['QualityPanel', 'scorePosition', 'scorePortfolio', 'parseFundamentalsResponse', 'cagrFromSeries', 'buildUrl'] },
  { file: '../risk-monitor.js',     ns: 'MaerminRiskMonitor',     comps: ['Panel', 'evaluate', 'shouldNotify', 'currentDrawdown', 'gatherInputs', 'checkAndNotify', 'loadSettings', 'saveSettings'] },
  { file: '../options-engine.js',   ns: 'MaerminOptions',         comps: ['Panel', 'buildOptionPositions', 'positionMetrics', 'computeStats', 'validateOptionTx', 'contractSymbol', 'hasOptionTransactions'] },
];

console.log('\nTier 1 — module load + exports:');
for (const m of VIEW_MODULES) {
  let loaded = true;
  try { require(m.file); } catch (err) { loaded = false; ok('load ' + m.ns, false, err.message); }
  if (!loaded) continue;
  ok('load ' + m.ns, true);
  const api = globalThis.window[m.ns];
  ok(m.ns + ' namespace registered', !!api && typeof api === 'object');
  if (!api) continue;
  for (const c of m.comps) ok(m.ns + '.' + c + ' is a function', typeof api[c] === 'function', typeof api[c]);
}

// ---------------------------------------------------------------------------
// Tier 2 — curated render smoke. Representative + empty data, no throw.
// ---------------------------------------------------------------------------
const theme = {
  bg: '#0b0e13', card: '#10151f', cardBorder: 'rgba(255,255,255,0.08)', text: '#e9eef5',
  textSecondary: '#8a93a3', accent: '#f5a524', inputBg: '#161c27', positive: '#16a34a',
  negative: '#ef4444', border: 'rgba(255,255,255,0.08)',
};
const formatPrice = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const getCurrencySymbol = () => '€';
const portfolio = {
  stocks: [{ symbol: 'AAPL', amount: 10, avgPrice: 150, cat: 'stocks' }, { symbol: 'VWCE', amount: 5, avgPrice: 100, cat: 'stocks' }],
  crypto: [{ symbol: 'BTC', amount: 1, avgPrice: 40000, cat: 'crypto' }],
  skins: [{ symbol: 'AK', name: 'AK-47', amount: 2, avgPrice: 30, cat: 'skins' }],
  commodities: [{ symbol: 'GOLD', amount: 3, avgPrice: 60, cat: 'commodities' }],
};
const prices = { AAPL: 170, VWCE: 110, BTC: 50000, AK: 40, GOLD: 65 };
const now = Date.now();
// priceHistory entries match the app's real shape: { timestamp:<string>, price }
// (renderer.js pushes { timestamp, price }; consumers read h.price / h.timestamp).
const iso = (ms) => new Date(ms).toISOString();
const priceHistory = {
  AAPL: [{ timestamp: iso(now - 8.64e7), price: 160 }, { timestamp: iso(now), price: 170 }],
  BTC:  [{ timestamp: iso(now - 8.64e7), price: 48000 }, { timestamp: iso(now), price: 50000 }],
};
const transactions = [
  { id: 't1', type: 'buy', asset: 'stocks', symbol: 'AAPL', amount: 10, price: 150, fee: 1, date: '2024-01-15', timestamp: now - 3e9 },
  { id: 't2', type: 'buy', asset: 'crypto', symbol: 'BTC', amount: 1, price: 40000, fee: 5, date: '2024-03-01', timestamp: now - 2e9 },
  { id: 't3', type: 'dividend', asset: 'stocks', symbol: 'AAPL', amount: 0, price: 0, cashAmount: 12, date: '2024-06-01', timestamp: now - 1e9 },
];
const baseProps = {
  portfolio, prices, priceHistory, transactions, theme, t: {},
  formatPrice, getCurrencySymbol, exchangeRate: 1, apiKeys: {},
  portfolioStats: { totalValue: 60000, totalCost: 45000, totalPnL: 15000, totalPnLPct: 33.3 },
  startValue: 60000, dividendYield: 0.02, addToast: noop, setActiveTab: noop,
  setTransactions: noop, onClose: noop, onSelect: noop,
};
const emptyProps = {
  ...baseProps, portfolio: { stocks: [], crypto: [], skins: [], commodities: [] },
  prices: {}, priceHistory: {}, transactions: [],
  portfolioStats: { totalValue: 0, totalCost: 0, totalPnL: 0, totalPnLPct: 0 }, startValue: 0,
};

// Components that MUST render cleanly under stubs against both datasets.
// (Leaf/data components; container views that pull many child components are
// covered at Tier 1 — full-tree rendering needs a real DOM, out of scope here.)
const MUST_RENDER = [
  ['MaerminFeatures', 'PieChart', { slices: [{ key: 'stocks', label: 'Stocks', value: 2200, color: '#f5a524', pct: 60 }, { key: 'crypto', label: 'Crypto', value: 50000, color: '#3b82f6', pct: 40 }], size: 150, thickness: 34, label: '52k', sublabel: 'Total' }],
  ['MaerminFeatures', 'Sparkline', { data: [1, 3, 2, 5, 4], color: '#16a34a' }],
  ['MaerminFeatures', 'PriceQualityBadge', { category: 'stocks', price: 228, fetchedAt: Date.now(), theme }],
  ['MaerminFeatures', 'PriceQualityBadge', { category: 'crypto', price: 0, theme }], // unavailable → no silent zero
  ['MaerminFeatures', 'PortfolioOverviewPanel', baseProps],
  ['MaerminFeatures', 'PositionsTable', baseProps],
  ['MaerminFeatures', 'PerformanceChart', baseProps],
  ['MaerminFeatures5', 'NetWorthView', baseProps],
  ['MaerminFeatures5', 'FeeAnalyzer', baseProps],
  ['MaerminFeatures5', 'CashflowChart', baseProps],
  ['MaerminFeatures2', 'ReturnsView', baseProps],
  ['MaerminFeatures2', 'RebalancingView', baseProps],
  ['MaerminFeatures7', 'RealizedUnrealizedView', baseProps],
  ['InvestmentViews', 'AnalysisCard', { title: 'X', theme, children: null }],
  ['InvestmentViews', 'ProgressBar', { value: 40, max: 100, theme }],
  ['InvestmentViews', 'MetricGrid', { metrics: [{ label: 'A', value: '1' }], theme }],
  ['PortfolioHealth', 'HealthView', baseProps],
  // Wealth-projection chart. baseProps drives the representative curve; the
  // empty-data variant (startValue 0 → all-zero scenarios) exercises the SVG
  // axis/area/marker geometry on a flat curve, the path most prone to NaN /
  // divide-by-zero in the Y-range fitting.
  ['MaerminProjection', 'Panel', baseProps],
  // Leaf chart / data / card components. Prop-bag components take baseProps so
  // they also get the empty-data variant for free; the two with bespoke props
  // (DataTable, TabBar) follow the AnalysisCard/MetricGrid pattern above.
  ['MaerminFeatures6', 'PortfolioHistoryChart', baseProps],
  ['MaerminFeatures3', 'DailyPnLCard', baseProps],
  ['MaerminFeatures3', 'BenchmarkWidget', baseProps],
  ['MaerminFeatures3', 'EnhancedPositionsTable', baseProps],
  ['MaerminFeatures7', 'PerformanceAttribution', baseProps],
  ['MaerminFeatures7', 'NewsFeedView', baseProps],
  ['MaerminFeatures4', 'DividendForecastView', baseProps],
  ['MaerminFeatures2', 'DividendCalendarView', baseProps],
  ['InvestmentViews', 'SectorAllocationView', baseProps],
  ['InvestmentViews', 'CountryAllocationView', baseProps],
  ['InvestmentViews', 'CurrencyExposureView', baseProps],
  ['InvestmentViews', 'LiquidityAnalysisView', baseProps],
  ['InvestmentViews', 'DataTable', { headers: ['A', 'B'], rows: [['1', '2']], theme }],
  ['InvestmentViews', 'TabBar', { tabs: [{ id: 'x', label: 'X' }], active: 'x', onChange: noop, theme }],
  // Analytics fold-in panels: gate the no-worker / short-history note paths and the
  // engine-backed render. Hooks are stubbed (no fetch fires), so these exercise the
  // synchronous render body against representative + empty data.
  ['MaerminAnalyticsViews', 'BenchmarkPanel', baseProps],
  ['MaerminAnalyticsViews', 'RollingRiskPanel', baseProps],
  ['MaerminAnalyticsViews', 'FactorExposurePanel', baseProps],
  ['MaerminSimulatorView', 'Panel', baseProps],
  ['MaerminAdvisor', 'Panel', baseProps],
  // Discovery surface (P5): no worker URL in baseProps → renders the gated note
  // path; empty data exercises the same. Hooks stubbed, so no fetch fires.
  ['MaerminDiscovery', 'View', baseProps],
  // ETF look-through panel: baseProps holds VWCE (a fund candidate) but no
  // worker URL and stubbed hooks → exercises the pre-fetch render paths; empty
  // data exercises the no-candidates note.
  ['MaerminLookThrough', 'Panel', baseProps],
  // Ongoing-costs (TER) panel: same gating; pre-fetch render + no-candidates note.
  ['MaerminCostAnalysis', 'OngoingCostsPanel', baseProps],
  // Dividend quality panel: renders against the stubbed DividendDataService-less
  // window (no payers note) and empty data. Hooks stubbed, no fetch fires.
  ['MaerminDividendQuality', 'QualityPanel', baseProps],
  // Risk monitor panel: evaluates the rules synchronously from the stubbed
  // metrics globals; empty data exercises the all-unavailable path.
  ['MaerminRiskMonitor', 'Panel', baseProps],
  // Options panel: baseProps has no option transactions → must render null
  // (the gate); the bespoke props exercise the full book table (long open,
  // short, intrinsic against the prices map).
  ['MaerminOptions', 'Panel', baseProps],
  ['MaerminOptions', 'Panel', {
    ...baseProps,
    exchangeRate: 0.9,
    transactions: [
      { category: 'options', type: 'buy', underlying: 'AAPL', optionType: 'call', strike: 150, expiry: '2099-12-17', quantity: 1, price: 5, currency: 'USD', date: '2026-01-05' },
      { category: 'options', type: 'sell', underlying: 'VWCE', optionType: 'put', strike: 100, expiry: '2099-06-18', quantity: 2, price: 3, currency: 'EUR', date: '2026-02-10' },
    ],
  }],
];

function renderOnce(Comp, props) {
  const out = Comp(props);
  // null/false is a legitimate render (e.g. empty-state guards). Anything that
  // isn't an element/null means the component returned something unrenderable.
  if (out === null || out === false || out === undefined) return true;
  return React.isValidElement(out) || typeof out === 'object';
}

console.log('\nTier 2 — render smoke (representative + empty data):');
for (const [ns, name, props] of MUST_RENDER) {
  const Comp = globalThis.window[ns] && globalThis.window[ns][name];
  if (typeof Comp !== 'function') { ok(ns + '.' + name + ' available to render', false, 'not a function'); continue; }
  let okRep = false, repErr = '';
  try { okRep = renderOnce(Comp, props); } catch (e) { repErr = e.message; }
  ok(ns + '.' + name + ' renders (representative)', okRep, repErr);
  // Empty-data variant only for the prop-bag components (skip ones with bespoke props).
  if (props === baseProps) {
    let okEmpty = false, emptyErr = '';
    try { okEmpty = renderOnce(Comp, emptyProps); } catch (e) { emptyErr = e.message; }
    ok(ns + '.' + name + ' renders (empty data)', okEmpty, emptyErr);
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
