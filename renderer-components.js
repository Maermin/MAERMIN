// ============================================================================
// MAERMIN v6.0 - Main Renderer Application
// Multi-Asset Portfolio Tracker & Financial OS
// ============================================================================

(function() {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

const { useState, useEffect, useMemo, useCallback, useRef } = React;


// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Static formatters live in utils.js (window.MaerminUtils). formatPrice keeps
// its currency-conversion logic here but delegates final number formatting.
const formatPrice = (price, currency = 'EUR', exchangeRate = 1) => {
  if (price === undefined || price === null || isNaN(price)) return '0.00';
  const converted = currency === 'USD' ? price * exchangeRate : price;
  return window.MaerminUtils.formatNumber(converted);
};

// ============================================================================
// COMMAND PALETTE COMPONENT
// ============================================================================

function CommandPalette({ isOpen, onClose, onExecute, commands, t }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      return commands.slice(0, 10);
    }
    const q = query.toLowerCase();
    return commands
      .filter(cmd => 
        cmd.label.toLowerCase().includes(q) ||
        (cmd.description && cmd.description.toLowerCase().includes(q)) ||
        (cmd.keywords && cmd.keywords.some(k => k.toLowerCase().includes(q)))
      )
      .slice(0, 15);
  }, [query, commands]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filteredCommands[selectedIndex]) {
      e.preventDefault();
      onExecute(filteredCommands[selectedIndex].id);
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return React.createElement(window.MaerminUI.Overlay, {
    className: 'command-palette-overlay',
    onClose
  },
    React.createElement('div', { className: 'command-palette', ...window.MaerminUI.dialogProps(null, t.searchCommands || 'Search commands') },
      React.createElement('input', {
        ref: inputRef,
        type: 'text',
        className: 'command-palette-input',
        role: 'combobox', 'aria-expanded': true, 'aria-controls': 'mx-palette-list', 'aria-autocomplete': 'list',
        'aria-label': t.searchCommands || 'Search commands',
        'aria-activedescendant': filteredCommands[selectedIndex] ? 'mx-pal-' + selectedIndex : undefined,
        placeholder: t.searchCommands || 'Search commands...',
        value: query,
        onChange: (e) => setQuery(e.target.value),
        onKeyDown: handleKeyDown
      }),
      React.createElement('div', { className: 'command-palette-results', id: 'mx-palette-list', role: 'listbox', 'aria-label': t.searchCommands || 'Search commands' },
        filteredCommands.length === 0
          ? React.createElement('div', { className: 'command-palette-empty', role: 'status' }, t.noResults || 'No results')
          : filteredCommands.map((cmd, index) =>
              React.createElement('div', {
                key: cmd.id, id: 'mx-pal-' + index, role: 'option', 'aria-selected': index === selectedIndex,
                className: `command-result ${index === selectedIndex ? 'selected' : ''}`,
                onClick: () => {
                  onExecute(cmd.id);
                  onClose();
                },
                onMouseEnter: () => setSelectedIndex(index)
              },
                React.createElement('div', { className: 'command-result-icon' },
                  (function () {
                    // Aurora icon set: map "nav:<view>" / "settings:*" ids to an icon.
                    var I = window.MaerminIcons;
                    var key = String(cmd.id || '').split(':');
                    var name = key[0] === 'nav' ? key[1] : key[0] === 'settings' ? 'settings' : (key[1] || key[0]);
                    if (name === 'taxes') name = 'tax';
                    if (I && I.Icon && I.has(name)) return I.Icon(name, { size: 16 });
                    if (I && I.Icon) return I.Icon(key[0] === 'nav' ? 'chevron' : 'sparkle', { size: 16 });
                    return cmd.icon ? cmd.icon.charAt(0).toUpperCase() : '>';
                  })()
                ),
                React.createElement('div', { className: 'command-result-content' },
                  React.createElement('div', { className: 'command-result-label' }, cmd.label),
                  cmd.description && React.createElement('div', { 
                    className: 'command-result-description' 
                  }, cmd.description)
                ),
                cmd.shortcut && React.createElement('div', { 
                  className: 'command-result-shortcut' 
                }, cmd.shortcut)
              )
            )
      ),
      React.createElement('div', { className: 'command-palette-footer' },
        React.createElement('span', null, React.createElement('kbd', null, 'Enter'), ' ', t.confirm || 'Select'),
        React.createElement('span', null, React.createElement('kbd', null, 'Esc'), ' ', t.close || 'Close'),
        React.createElement('span', null, React.createElement('kbd', null, '↑/↓'), ' ' + __('palNavigate', 'Navigate'))
      )
    )
  );
}

// ============================================================================
// KEYBOARD SHORTCUTS MODAL
// ============================================================================

// The table is built from the same command list the key handler in renderer.js
// reads, so it only ever shows shortcuts that work.
function ShortcutsModal({ isOpen, onClose, t, theme, commands }) {
  if (!isOpen) return null;

  const shortcuts = {};
  const add = (category, item) => { (shortcuts[category] = shortcuts[category] || []).push(item); };
  add(t.navigation || 'Navigation', { keys: ['Ctrl', 'K'], action: t.commandPalette || 'Command Palette' });
  (commands || []).forEach((c) => {
    if (c.shortcut) add(c.category, { keys: c.shortcut.split(' '), action: c.label });
  });

  return React.createElement(window.MaerminUI.Overlay, {
    className: 'command-palette-overlay',
    onClose
  },
    React.createElement('div', { className: 'shortcuts-modal', ...window.MaerminUI.dialogProps('dlg-shortcuts') },
      React.createElement('div', { className: 'shortcuts-modal-header' },
        React.createElement('h2', { id: 'dlg-shortcuts' }, t.keyboardShortcuts || 'Keyboard Shortcuts'),
        React.createElement('button', {
          type: 'button', className: 'shortcuts-modal-close',
          'aria-label': t.close || 'Close', title: t.close || 'Close',
          onClick: onClose
        }, React.createElement('span', { 'aria-hidden': 'true' }, '×'))
      ),
      React.createElement('div', { className: 'shortcuts-modal-content' },
        Object.entries(shortcuts).map(([category, items]) =>
          React.createElement('div', { key: category, className: 'shortcuts-category' },
            React.createElement('h3', null, category),
            items.map((item, idx) =>
              React.createElement('div', { key: idx, className: 'shortcut-item' },
                React.createElement('span', null, item.action),
                React.createElement('div', { className: 'shortcut-keys' },
                  item.keys.map((key, kidx) =>
                    React.createElement('kbd', { key: kidx }, key)
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}

// ============================================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================================

function ToastContainer({ toasts, onRemove }) {
  return React.createElement('div', { className: 'toast-container' },
    toasts.map(toast =>
      React.createElement('div', {
        key: toast.id,
        className: `toast ${toast.type}`,
        ...window.MaerminUtils.clickable(() => onRemove(toast.id)),
        'aria-label': __('toastDismiss', 'Dismiss notification')
      },
        React.createElement('span', null, toast.message)
      )
    )
  );
}

// ============================================================================
// CORRELATION MATRIX VIEW
// ============================================================================

// VIS-008: scenario asset keys in the UI language (were shown raw: "tech_stocks").
function stressAssetLabel(asset) {
  switch (asset) {
    case 'bonds': return __('stAssetBonds', 'Bonds');
    case 'gold': return __('stAssetGold', 'Gold');
    case 'tech_stocks': return __('stAssetTech', 'Tech stocks');
    case 'stablecoins': return __('stAssetStable', 'Stablecoins');
    case 'gaming_stocks': return __('stAssetGaming', 'Gaming stocks');
    default: return window.MaerminI18n.category(asset);
  }
}

function CorrelationMatrixView({ portfolio, priceHistory, historySource, t, theme, formatPrice }) {
  const [correlationData, setCorrelationData] = useState(null);

  useEffect(() => {
    if (!window.CorrelationEngine || !priceHistory || Object.keys(priceHistory).length <= 1) return;
    // Convert price history from [{timestamp, price}, ...] to [price, ...] format
    const convertedHistory = {};
    Object.entries(priceHistory).forEach(([symbol, history]) => {
      if (Array.isArray(history) && history.length > 0) {
        convertedHistory[symbol] = (typeof history[0] === 'object' && history[0].price !== undefined)
          ? history.map(item => item.price)
          : history;
      }
    });

    // Need at least 2 assets with sufficient history
    const validAssets = Object.entries(convertedHistory).filter(([_, h]) => h.length >= 2);
    if (validAssets.length < 2) { setCorrelationData(null); return; }

    // v11: compute the O(n²) matrix OFF the main thread (MaerminCompute → Web
    // Worker), with a guaranteed synchronous fallback. The cancelled guard drops
    // a late async result if priceHistory changed again before it returned.
    let cancelled = false;
    const apply = (data) => { if (!cancelled && data) setCorrelationData(data); };
    if (window.MaerminCompute) {
      window.MaerminCompute.correlation(convertedHistory).then(apply);
    } else {
      const matrix = window.CorrelationEngine.calculateCorrelationMatrix(convertedHistory);
      apply({
        matrix,
        score: window.CorrelationEngine.calculateDiversificationScore(matrix),
        extremes: window.CorrelationEngine.findExtremePairs(matrix)
      });
    }
    return () => { cancelled = true; };
  }, [priceHistory]);

  // R4.2: a diverging scale on the theme (moves together = loss tone, moves
  // apart = gain tone, 0 = the surface), the figure in every cell, a legend in
  // words; the grid scrolls inside its card with the symbol column fixed.
  const H = window.MaerminReturnsHeatmap, T = window.MaerminTokens;
  const hexOf = (v, fb) => { const r = T && T.resolve ? T.resolve(v) : v; return /^#[0-9a-f]{3,6}$/i.test(String(r || '').trim()) ? String(r).trim() : fb; };
  const scale = { up: hexOf('var(--loss)', '#ef4444'), down: hexOf('var(--gain)', '#22c55e'), base: hexOf('var(--surface)', '#10151f') };
  const cellBg = (v) => (H ? H.cellColor(v, { up: scale.up, down: scale.down, base: scale.base, maxAbs: 1 }) : scale.base);

  if (!correlationData) {
    // "Loading..." was shown forever when there was simply nothing to compute.
    // Only say loading while a computation can actually be running.
    const withHistory = Object.values(priceHistory || {}).filter(h => Array.isArray(h) && h.length >= 2).length;
    const computing = withHistory >= 2;
    return h('div', { className: 'ui-view' }, window.MaerminUtils.emptyState({
      testid: computing ? 'correlation-loading' : 'correlation-empty', kind: computing ? 'loading' : 'empty',
      text: computing
      ? (t.loading || 'Loading...')
      : window.MaerminI18n.fill(t.correlationNeedsHistory || 'Not enough price history yet. The correlation matrix needs at least two holdings with two or more recorded prices each ({n} so far). A price point is recorded on every refresh.', { n: withHistory }) }));
  }

  const { matrix, score, extremes } = correlationData;
  const UIC = Components;
  const I = window.MaerminI18n;
  const scoreTone = score.score >= 60 ? 'gain' : score.score >= 40 ? 'warning' : 'loss';
  const sourceText = historySource === 'daily'
    ? __('corrDaily', 'Daily closing prices, {n} daily returns up to today', { n: Math.max(0, ((Object.values(priceHistory || {})[0] || []).length - 1)) })
    : historySource === 'partial'
      ? __('corrPartial', 'Daily closing prices of the {k} holdings that have them, {n} daily returns up to today', { k: Object.keys(priceHistory || {}).length, n: Math.max(0, ((Object.values(priceHistory || {})[0] || []).length - 1)) })
      : __('corrRefresh', 'Prices recorded on your refreshes');
  const pairs = (title, list, testid) => h(UIC.Card, { title, headingLevel: 'h3', 'data-testid': testid },
    h('ul', { className: 'ui-rows' }, list.slice(0, 5).map((pair, idx) => h('li', { key: idx, className: 'ui-rows__row' },
      h('span', { className: 'ui-corr__pair' }, `${pair.asset1} / ${pair.asset2}`),
      h('span', { className: ['ui-corr__chip', 'num'].join(' '), style: { background: cellBg(pair.correlation), color: H ? H.textOn(cellBg(pair.correlation)) : undefined } }, I.num(pair.correlation, 2))))));

  return h('div', { className: 'ui-view', 'data-testid': 'correlation-view' },
    h('div', { className: 'ui-ov-tiles' },
      h(UIC.Card, { variant: 'answer', className: 'ui-ov-tile', 'data-testid': 'corr-score' },
        h(UIC.Stat, { label: t.diversificationScore || 'Diversification Score', value: `${I.num(score.score, 0)}/100`, tone: scoreTone,
          sub: __('corrScoreSub', 'Higher = your holdings move less together') }))),
    h(UIC.Card, { title: t.correlationMatrix || 'Correlation Matrix', headingLevel: 'h3', className: 'ui-chart',
      subtitle: h('span', { 'data-testid': 'correlation-source', 'data-source': historySource || 'refresh' }, sourceText) },
      h('div', { className: 'ui-heat__scroll', role: 'region', tabIndex: 0, 'aria-label': __('corrScrollAria', 'Correlation matrix, scrolls sideways') },
        h('table', { className: ['ui-heat', 'ui-corr'].join(' ') },
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', className: 'ui-heat__year' }, h('span', { className: 'sr-only' }, __('corrHolding', 'Holding'))),
            matrix.symbols.map(symbol => h('th', { key: `col-${symbol}`, scope: 'col', title: symbol }, symbol.substring(0, 7))))),
          h('tbody', null, matrix.symbols.map((rowSymbol, i) => h('tr', { key: `row-${rowSymbol}` },
            h('th', { scope: 'row', className: 'ui-heat__year', title: rowSymbol }, rowSymbol.substring(0, 9)),
            matrix.symbols.map((colSymbol, j) => {
              const value = matrix.matrix[i][j];
              if (i === j) return h('td', { key: `cell-${i}-${j}`, className: ['ui-heat__cell', 'is-empty'].join(' '), 'aria-label': rowSymbol }, '—');
              const bg = cellBg(value);
              return h('td', { key: `cell-${i}-${j}`, className: 'ui-heat__cell', style: { background: bg, color: H ? H.textOn(bg) : undefined, cursor: 'default' },
                title: `${rowSymbol} / ${colSymbol}: ${I.num(value, 2)}` }, I.num(value, 2));
            })))))),
      h('ul', { className: 'ui-chart__legend' },
        h('li', null, h('span', { className: 'ui-chart__swatch', 'data-series': 'loss', 'aria-hidden': 'true' }), __('corrLegendTogether', 'towards +1: move together')),
        h('li', null, h('span', { className: 'ui-chart__swatch', 'data-series': 'gain', 'aria-hidden': 'true' }), __('corrLegendApart', 'towards −1: move apart')),
        h('li', null, __('corrLegendZero', 'pale = little connection')))),
    h('div', { className: 'ui-grid-2' },
      pairs(t.mostCorrelatedPairs || 'Most Correlated', extremes.mostCorrelated, 'corr-most'),
      pairs(t.leastCorrelatedPairs || 'Least Correlated', extremes.leastCorrelated, 'corr-least')));
}

// ============================================================================
// MONTE CARLO SIMULATION VIEW
// ============================================================================

function MonteCarloView({ portfolio, prices, t, theme, currency, formatPrice }) {
  const [config, setConfig] = useState({
    iterations: 10000,
    years: 10,
    monthlyContribution: 500,
    expectedReturn: null,
    volatility: null
  });
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);

  const runSimulation = () => {
    if (!window.MonteCarloEngine) return;

    setIsRunning(true);

    // FIRE target (V7): feed the FIRE number from the shared settings so the
    // engine also reports the probability of reaching financial independence.
    const M = window.MaerminMetrics;
    const fs = M ? M.loadFireSettings() : null;
    const fireNumber = (fs && fs.annualExpenses > 0) ? fs.annualExpenses * (100 / (fs.withdrawalRate || 4)) : 0;
    const cfg = fireNumber > 0 ? Object.assign({}, config, { targetValue: fireNumber }) : config;

    const finish = (simResults) => { setResults(simResults); setIsRunning(false); };
    // v11: run the 10k-iteration simulation OFF the main thread when possible
    // (MaerminCompute → Web Worker). MaerminCompute.montecarlo always resolves —
    // it falls back to a synchronous on-thread run if the worker is unavailable —
    // so this never blocks and never breaks. The setTimeout path is the last-
    // ditch fallback if the compute client itself failed to load.
    // Value every position at its CURRENT price (the engine used to fall back
    // to cost basis and to its 8%/18% defaults because positions carry no
    // currentValue). Plain data, so it can be posted to the worker.
    const valued = {};
    Object.keys(portfolio || {}).forEach(cls => {
      if (!Array.isArray(portfolio[cls])) return;
      valued[cls] = portfolio[cls].map(p => {
        const sym = p.symbol || p.name || '';
        const px = (prices && (prices[sym] || prices[sym.toLowerCase()] || prices[sym.toUpperCase()])) || 0;
        const amount = parseFloat(p.amount) || 0;
        return { symbol: sym, amount, purchasePrice: p.purchasePrice, currentPrice: px, currentValue: px > 0 ? amount * px : 0 };
      });
    });
    if (window.MaerminCompute) {
      window.MaerminCompute.montecarlo(valued, cfg).then(finish);
    } else {
      setTimeout(() => finish(window.MonteCarloEngine.runSimulation(valued, cfg)), 50);
    }
  };

  const currencySymbol = currency === 'EUR' ? 'EUR' : 'USD';
  // R4.2: settings on Field / Input / Select and one primary Button, the
  // outcomes as answer tiles, the percentiles on Table.
  const UIC = Components;
  const I = window.MaerminI18n;
  const money = (v) => `${formatPrice(v)} ${currencySymbol}`;
  const tile = (label, value, tone, testid) => h(UIC.Card, { key: label, variant: 'answer', className: 'ui-ov-tile', 'data-testid': testid },
    h(UIC.Stat, { label, value, tone: tone || null }));
  const fireTone = (p) => p >= 75 ? 'gain' : p >= 40 ? 'warning' : 'loss';

  return h('div', { className: 'ui-view', 'data-testid': 'montecarlo-view' },
    h(UIC.Card, { title: t.monteCarloSimulation || 'Monte Carlo Simulation', headingLevel: 'h3' },
      h('div', { className: 'ui-form-grid' },
        h(UIC.Select, { label: t.iterations || 'Iterations', value: config.iterations,
          onChange: (e) => setConfig(prev => ({ ...prev, iterations: parseInt(e.target.value) })),
          options: [1000, 5000, 10000, 25000].map(n => ({ value: n, label: I.num(n, 0) })) }),
        h(UIC.Input, { label: t.projectionYears || 'Projection Years', type: 'number', min: 1, max: 50, value: config.years,
          onChange: (e) => setConfig(prev => ({ ...prev, years: parseInt(e.target.value) || 10 })) }),
        h(UIC.Input, { label: t.monthlyContribution || 'Monthly Contribution', type: 'number', min: 0, value: config.monthlyContribution,
          onChange: (e) => setConfig(prev => ({ ...prev, monthlyContribution: parseFloat(e.target.value) || 0 })) }),
        h('div', { className: 'ui-form-grid__action' },
          h(UIC.Button, { variant: 'primary', onClick: runSimulation, loading: isRunning, 'data-testid': 'mc-run' },
            isRunning ? (t.loading || 'Running...') : (t.runSimulation || 'Run Simulation'))))),

    results && h('div', { className: 'ui-ov-tiles', 'data-testid': 'mc-outcomes' },
      tile(t.portfolioValue || 'Initial Value', money(results.initialValue), null, 'mc-start'),
      tile(t.medianOutcome || 'Median (50th)', money(results.percentiles[50]), null, 'mc-median'),
      tile(`${t.bestCase || 'Best Case'} (${__('mcP95', '95th')})`, money(results.percentiles[95]), null, 'mc-best'),
      tile(`${t.worstCase || 'Worst Case'} (${__('mcP5', '5th')})`, money(results.percentiles[5]), null, 'mc-worst')),

    // FIRE probability (V7) — shown when a FIRE number is configured (dashboard tile)
    results && results.fireTarget && h(UIC.Card, { title: t.fireProbability || 'FIRE probability', headingLevel: 'h3', 'data-testid': 'mc-fire' },
      h('div', { className: 'ui-split' },
        h(UIC.Stat, { size: 'lg', label: `${t.kpiFireTarget || 'Target'}: ${money(results.fireTarget.value)}`, value: I.pct(results.fireTarget.probability, 0), tone: fireTone(results.fireTarget.probability),
          sub: results.fireTarget.reachedYear
            ? I.fill(t.fireMedianReaches || 'Median path reaches FIRE in year {y}', { y: results.fireTarget.reachedYear })
            : I.fill(t.fireMedianMisses || 'Median path does not reach FIRE within {n} years', { n: results.years }) }))),

    // FIRE hint when not configured
    results && !results.fireTarget && h('p', { className: 'ui-callout' }, t.fireConfigureHint || 'Set your annual expenses on the dashboard FIRE tile to see your FIRE probability here.'),

    // Goal probabilities
    results && h(UIC.Card, { title: t.goalProbability || 'Goal Probabilities', headingLevel: 'h3', 'data-testid': 'mc-goals' },
      h('div', { className: 'ui-tiles' }, results.goalProbabilities.map((goal, idx) =>
        h(UIC.Stat, { key: idx, className: 'ui-tile', label: goal.label, value: I.pct(goal.probability, 0) })))),

    // Percentile table
    results && h(UIC.Card, { title: t.probabilityCones || 'Percentile Distribution', headingLevel: 'h3', className: 'ui-card--table', 'data-testid': 'mc-percentiles' },
      h(UIC.Table, { caption: t.probabilityCones || 'Percentile Distribution', rowKey: (r) => r.p,
        rows: [5, 10, 25, 50, 75, 90, 95].map(p => ({ p, v: results.percentiles[p] })),
        columns: [
          { key: 'p', label: t.percentile || 'Percentile', phone: 'title', render: (r) => __('mcPercentileN', 'P{p}', { p: r.p }) },
          { key: 'v', label: t.portfolioValue || 'Value', align: 'right', phone: 'value', render: (r) => money(r.v) }
        ] }))
  );
}

// ============================================================================
// STRESS TESTING VIEW
// ============================================================================

function StressTestView({ portfolio, prices, t, theme, currency, formatPrice }) {
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [results, setResults] = useState(null);
  const [comparisonResults, setComparisonResults] = useState(null);

  const scenarios = window.StressTestEngine ? window.StressTestEngine.HISTORICAL_SCENARIOS : {};

  const runScenario = (scenarioId) => {
    if (!window.StressTestEngine) return;
    
    setSelectedScenario(scenarioId);
    const scenario = scenarios[scenarioId];
    const result = window.StressTestEngine.applyStressTest(portfolio, scenario, prices);
    setResults(result);
  };

  const runComparison = () => {
    if (!window.StressTestEngine) return;
    
    const scenarioIds = Object.keys(scenarios);
    const comparison = window.StressTestEngine.runScenarioComparison(portfolio, prices, scenarioIds);
    setComparisonResults(comparison);
  };

  const currencySymbol = currency === 'EUR' ? 'EUR' : 'USD';
  // R4.2: scenarios as selectable cards (aria-pressed), the result as answer
  // tiles and Table; every loss carries its minus sign.
  const UIC = Components;
  const I = window.MaerminI18n;
  const money = (v) => `${formatPrice(v)} ${currencySymbol}`;
  const lossPct = (p) => '−' + I.pct(Math.abs(p), 1);
  const tile = (label, value, tone, testid) => h(UIC.Stat, { key: label, className: 'ui-tile', label, value, tone: tone || null, 'data-testid': testid });

  return h('div', { className: 'ui-view', 'data-testid': 'stress-view' },
    h('div', { className: 'ui-view__bar' },
      h('p', { className: 'ui-view__lead' }, __('stLead', 'How your holdings would fare in a repeat of past crises. Pick a scenario.')),
      h(UIC.Button, { variant: 'secondary', onClick: runComparison, 'data-testid': 'st-run-all' }, t.all || 'Run All Scenarios')),

    // Scenario cards
    h('div', { className: 'ui-st-grid' },
      Object.entries(scenarios).map(([id, scenario]) =>
        h('div', Object.assign({
          key: id,
          className: ['ui-st-card', 'scenario-card', selectedScenario === id ? 'selected is-on' : ''].join(' ').trim(),
          'aria-label': __('stRunScenario', 'Run scenario {name}', { name: (scenario && scenario.name) || id }),
          'aria-pressed': selectedScenario === id
        }, window.MaerminUtils.clickable(() => runScenario(id))),
          h('h3', { className: 'ui-st-card__title' }, scenario.name),
          h('p', { className: 'ui-st-card__text' }, scenario.description),
          scenario.note && h('p', { className: 'ui-st-card__note' }, scenario.note),
          h('div', { className: 'ui-st-card__impacts' },
            Object.entries(scenario.impacts).map(([asset, impact]) =>
              impact !== 0 && h(UIC.ToneChip, { key: asset, value: impact, text: `${stressAssetLabel(asset)}: ${I.pct(impact * 100, 0)}` })))))),

    // Results
    results && h(UIC.Card, { title: `${t.scenarioImpact || 'Scenario Impact'}: ${results.scenario}`, headingLevel: 'h3', 'data-testid': 'st-result' },
      h('div', { className: 'ui-tiles' },
        tile(t.portfolioValue || 'Original Value', money(results.originalValue)),
        tile(t.portfolioStressed || 'Stressed Value', money(results.stressedValue)),
        tile(t.potentialLoss || 'Potential Loss', `−${money(results.totalLoss)} (${lossPct(results.lossPercent)})`, results.totalLoss > 0 ? 'loss' : null),
        tile(t.recoveryTime || 'Recovery Time', `${results.recoveryEstimate.months} ${t.months || 'months'}`)),
      h('h4', { className: 'ui-sublabel' }, t.distribution || 'Category Breakdown'),
      h(UIC.Table, { caption: t.distribution || 'Category Breakdown', rowKey: (r) => r.category,
        rows: Object.entries(results.categoryBreakdown).map(([category, data]) => Object.assign({ category }, data)),
        columns: [
          { key: 'category', label: __('category', 'Category'), phone: 'title', render: (r) => I.category(r.category) },
          { key: 'o', label: __('trOriginal', 'Original'), align: 'right', phone: 'meta', render: (r) => money(r.originalValue) },
          { key: 's', label: __('stStressed', 'Stressed'), align: 'right', phone: 'sub', render: (r) => money(r.stressedValue) },
          { key: 'l', label: __('stLoss', 'Loss'), align: 'right', phone: 'value', render: (r) => h(UIC.ToneChip, { value: -Math.abs(r.lossPercent), text: lossPct(r.lossPercent) }) }
        ] })),

    // Comparison results
    comparisonResults && h(UIC.Card, { title: t.historicalScenarios || 'All Scenarios Comparison', headingLevel: 'h3', className: 'ui-card--table', 'data-testid': 'st-compare' },
      h(UIC.Table, { caption: t.historicalScenarios || 'All Scenarios Comparison', rowKey: (r, i) => i,
        rows: comparisonResults.scenarios,
        columns: [
          { key: 'scenario', label: __('stScenario', 'Scenario'), phone: 'title' },
          { key: 'l', label: __('stLoss', 'Loss'), align: 'right', phone: 'value', render: (r) => h(UIC.ToneChip, { value: -Math.abs(r.lossPercent), text: lossPct(r.lossPercent) }) },
          { key: 'r', label: __('stRecovery', 'Recovery'), align: 'right', phone: 'meta', render: (r) => __('stMonthsShort', '{n} mo', { n: r.recoveryEstimate.months }) }
        ] }))
  );
}

// ============================================================================
// SHARED COMPONENTS (PLAN Phase 6, R1.2 — docs/DESIGN-SYSTEM.md § 4)
// ----------------------------------------------------------------------------
// The one set of controls every view composes. Each renders class names from
// styles.css (.ui-*), never inline styles, so themes stay CSS-only and the CSP
// (style-src 'self') holds. Every component passes className, data-testid and
// any other prop through to its root element.
// ============================================================================
const h = React.createElement;
const cx = (...parts) => parts.filter(Boolean).join(' ');
// Props a component consumes itself are removed before the rest reach the DOM.
const omit = (props, keys) => { const out = {}; for (const k in props) if (keys.indexOf(k) < 0) out[k] = props[k]; return out; };

// Money tone of a signed figure (§ 5): gain / loss, zero is neutral.
function toneOf(n) {
  if (typeof n !== 'number' || !isFinite(n) || Math.abs(n) < 1e-9) return 'neutral';
  return n > 0 ? 'gain' : 'loss';
}

function Spinner() { return h('span', { className: 'ui-spinner', 'aria-hidden': 'true' }); }

// Button: primary (one per region), secondary, quiet, danger.
function Button(props) {
  const variant = /^(primary|secondary|quiet|danger)$/.test(props.variant) ? props.variant : 'secondary';
  const size = /^(sm|md|lg)$/.test(props.size) ? props.size : 'md';
  const busy = !!props.loading;
  const rest = omit(props, ['variant', 'size', 'icon', 'kbd', 'loading', 'className', 'children', 'type']);
  return h('button', Object.assign(rest, {
    type: props.type || 'button',
    className: cx('ui-btn', 'ui-btn--' + variant, 'ui-btn--' + size, busy && 'is-loading', props.className),
    'aria-busy': busy ? 'true' : undefined,
    disabled: props.disabled || busy || undefined
  }), busy ? h(Spinner) : props.icon || null, props.children != null ? h('span', { className: 'ui-btn__label' }, props.children) : null,
  props.kbd ? h('kbd', { className: 'ui-kbd' }, props.kbd) : null);
}

// IconButton: square, label required (aria-label + tooltip). pressed -> a toggle.
function IconButton(props) {
  const label = props.label;
  if (!label && typeof console !== 'undefined') console.error('IconButton needs a label');
  const size = props.size === 'lg' ? 'lg' : props.size === 'sm' ? 'sm' : 'md';
  const rest = omit(props, ['label', 'icon', 'pressed', 'size', 'className', 'children', 'type']);
  return h('button', Object.assign(rest, {
    type: props.type || 'button',
    className: cx('ui-icon-btn', 'ui-icon-btn--' + size, props.pressed && 'is-on', props.className),
    'aria-label': label, title: label,
    'aria-pressed': props.pressed == null ? undefined : !!props.pressed
  }), props.icon || props.children);
}

// Card: title / subtitle / one action link; variants plain (no padding), answer, hero.
// R5.3: the heading level follows the nesting, so a view reads h1 (page) → h2 (card) →
// h3 (card in a card or in a dialog) without gaps. The old headingLevel prop is
// accepted and ignored.
const HeadingLevel = React.createContext(0);
function Card(props) {
  const variant = /^(plain|answer|hero)$/.test(props.variant) ? props.variant : null;
  const rest = omit(props, ['title', 'subtitle', 'action', 'variant', 'className', 'children', 'as', 'headingLevel']);
  const ctx = React.useContext(HeadingLevel);
  const level = Math.min(ctx || 2, 6);
  const head = (props.title || props.action) ? h('header', { className: 'ui-card__head' },
    h('div', { className: 'ui-card__titles' },
      props.title ? h('h' + level, { className: 'ui-card__title' }, props.title) : null,
      props.subtitle ? h('p', { className: 'ui-card__subtitle' }, props.subtitle) : null),
    props.action ? h('div', { className: 'ui-card__action' }, props.action) : null) : null;
  const body = h('div', { className: 'ui-card__body' }, props.children);
  return h(props.as || 'section', Object.assign(rest, { className: cx('ui-card', variant && 'ui-card--' + variant, props.className) }),
    head, props.title ? h(HeadingLevel.Provider, { value: level + 1 }, body) : body);
}

// R5.3: a section heading one level below the card (or dialog) it sits in; h2 at the top of a view.
function Heading(props) {
  const ctx = React.useContext(HeadingLevel);
  const rest = omit(props, ['children']);
  return h('h' + Math.min(ctx || 2, 6), rest, props.children);
}

// Stat / KPI: label, value (tone from the figure or given), sub line, split figures.
// A figure never ends in "…": when it is wider than its card, its font steps
// down (to 55 % at most) until it fits; again when the card is resized.
function fitText(el) {
  if (!el) return;
  el.style.fontSize = '';
  if (el.scrollWidth <= el.clientWidth) return;
  const max = parseFloat(getComputedStyle(el).fontSize) || 0;
  for (let s = max - 1; s >= max * 0.55 && el.scrollWidth > el.clientWidth; s -= 1) el.style.fontSize = s + 'px';
}
function useFitText(ref, dep) {
  (typeof document !== 'undefined' && document.createElement ? React.useLayoutEffect : useEffect)(() => { fitText(ref.current); });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => fitText(el));
    ro.observe(el.parentElement || el);
    return () => ro.disconnect();
  }, [dep]);
}

function Stat(props) {
  const valueRef = useRef(null);
  useFitText(valueRef, props.size);
  const tone = props.tone || (typeof props.signed === 'number' ? toneOf(props.signed) : null);
  const clickable = typeof props.onClick === 'function';
  const rest = omit(props, ['label', 'value', 'sub', 'tone', 'signed', 'split', 'className', 'onClick', 'size']);
  const onKey = clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onClick(e); } } : undefined;
  return h('div', Object.assign(rest, {
    className: cx('ui-stat', props.size === 'lg' && 'ui-stat--lg', clickable && 'is-clickable', props.className),
    role: clickable ? 'link' : undefined, tabIndex: clickable ? 0 : undefined,
    onClick: props.onClick, onKeyDown: onKey
  }),
  h('div', { className: 'ui-stat__label' }, props.label),
  h('div', { ref: valueRef, className: cx('ui-stat__value', 'num', tone && 'tone-' + tone) }, props.value),
  props.sub ? h('div', { className: 'ui-stat__sub' }, props.sub) : null,
  Array.isArray(props.split) && props.split.length ? h('div', { className: 'ui-stat__split' },
    props.split.map((s, i) => h('div', { key: i },
      h('span', null, s.label), h('b', { className: cx('num', s.tone && 'tone-' + s.tone) }, s.value)))) : null);
}

// Badge: status words (Sample data, Closed, Expected).
function Badge(props) {
  const rest = omit(props, ['tone', 'className', 'children']);
  return h('span', Object.assign(rest, { className: cx('ui-badge', props.tone && 'tone-' + props.tone, props.className) }), props.children);
}

// Chip: a filter toggle with an optional count.
function Chip(props) {
  const rest = omit(props, ['pressed', 'count', 'className', 'children', 'type']);
  return h('button', Object.assign(rest, { type: 'button', className: cx('ui-chip', props.className), 'aria-pressed': !!props.pressed }),
    h('span', null, props.children), props.count != null ? h('span', { className: cx('ui-chip__count', 'num') }, props.count) : null);
}

// ToneChip: a signed figure on its tone, always with ▲ / ▼ (never colour alone).
function ToneChip(props) {
  const tone = props.tone || toneOf(props.value);
  const mark = tone === 'gain' ? '▲' : tone === 'loss' ? '▼' : '';
  const rest = omit(props, ['value', 'tone', 'text', 'className']);
  return h('span', Object.assign(rest, { className: cx('ui-tone-chip', 'num', 'tone-' + tone, props.className) }),
    mark ? h('span', { 'aria-hidden': 'true' }, mark + ' ') : null, props.text != null ? props.text : String(props.value));
}

// Roving focus for a row of options: arrows, Home, End move and select.
function rovingKeys(e, index, count, select) {
  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % count;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + count) % count;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = count - 1;
  if (next === null) return;
  e.preventDefault();
  select(next);
  const row = e.currentTarget.parentElement;
  const btn = row && row.children[next];
  if (btn && btn.focus) btn.focus();
}

// PageTabs: the views of an area (underline). One row only, never nested.
// A tab may carry extra attributes (the shell puts data-view / data-views on them).
const tabAttrs = (tab) => tab.attrs || {};
function PageTabs(props) {
  const tabs = props.tabs || [];
  const idx = Math.max(0, tabs.findIndex((t) => t.id === props.value));
  const rest = omit(props, ['tabs', 'value', 'onChange', 'label', 'className']);
  return h('div', Object.assign(rest, { role: 'tablist', 'aria-label': props.label, className: cx('ui-tabs', props.className) }),
    tabs.map((t, i) => h('button', {
      key: t.id, type: 'button', role: 'tab', id: t.tabId, 'data-tab': t.id,
      'aria-selected': i === idx, 'aria-controls': t.panelId, tabIndex: i === idx ? 0 : -1,
      className: 'ui-tab', onClick: () => props.onChange && props.onChange(t.id), ...tabAttrs(t),
      onKeyDown: (e) => rovingKeys(e, i, tabs.length, (n) => props.onChange && props.onChange(tabs[n].id))
    }, t.label)));
}

// Segmented: one choice among a few (periods, Net / Gross).
function Segmented(props) {
  const opts = props.options || [];
  // R4.5: a value outside the options (a custom entry) checks none; the first stays focusable
  const found = opts.findIndex((o) => o.value === props.value);
  const idx = found < 0 ? 0 : found;
  const rest = omit(props, ['options', 'value', 'onChange', 'label', 'className', 'size']);
  return h('div', Object.assign(rest, { role: 'radiogroup', 'aria-label': props.label, className: cx('ui-seg', props.size === 'sm' && 'ui-seg--sm', props.className) }),
    opts.map((o, i) => h('button', {
      key: String(o.value), type: 'button', role: 'radio', 'aria-checked': i === found, tabIndex: i === idx ? 0 : -1,
      className: 'ui-seg__opt', disabled: o.disabled || undefined,
      onClick: () => props.onChange && props.onChange(o.value), ...tabAttrs(o),
      onKeyDown: (e) => rovingKeys(e, i, opts.length, (n) => props.onChange && props.onChange(opts[n].value))
    }, o.label)));
}

let fieldSeq = 0;
function useFieldId(given) {
  const ref = React.useRef(null);
  if (!ref.current) ref.current = given || ('ui-field-' + (++fieldSeq));
  return given || ref.current;
}

// Field wrapper: a visible label, the control, a hint or an error linked by id.
function Field(props, control) {
  const id = props.id;
  const msgId = (props.error || props.hint) ? id + '-msg' : undefined;
  return h('div', { className: cx('ui-field', props.error && 'has-error', props.fieldClassName) },
    props.label ? h('label', { className: 'ui-field__label', htmlFor: id }, props.label) : null,
    control(msgId),
    props.error ? h('div', { className: cx('ui-field__msg', 'is-error'), id: msgId, role: 'alert' }, props.error)
      : props.hint ? h('div', { className: 'ui-field__msg', id: msgId }, props.hint) : null);
}

function Input(props) {
  const id = useFieldId(props.id);
  const rest = omit(props, ['label', 'hint', 'error', 'id', 'className', 'fieldClassName']);
  return Field(Object.assign({}, props, { id }), (msgId) => h('input', Object.assign({ type: 'text' }, rest, {
    id, className: cx('ui-input', props.className), 'aria-invalid': props.error ? 'true' : undefined, 'aria-describedby': msgId
  })));
}

function Select(props) {
  const id = useFieldId(props.id);
  const rest = omit(props, ['label', 'hint', 'error', 'id', 'className', 'fieldClassName', 'options']);
  return Field(Object.assign({}, props, { id }), (msgId) => h('select', Object.assign({}, rest, {
    id, className: cx('ui-input', 'ui-select', props.className), 'aria-invalid': props.error ? 'true' : undefined, 'aria-describedby': msgId
  }), (props.options || []).map((o) => h('option', { key: String(o.value), value: o.value, disabled: o.disabled }, o.label))));
}

// Mask: an amount in privacy mode. The figure never reaches the DOM while masked.
function Mask(props) {
  const rest = omit(props, ['masked', 'className', 'children']);
  if (!props.masked) return h('span', Object.assign(rest, { className: cx('ui-mask', props.className) }), props.children);
  return h('span', Object.assign(rest, { className: cx('ui-mask', 'is-masked', props.className), 'aria-label': __('uiHiddenAmount', 'Amount hidden') }), '••••••');
}

const Components = { toneOf, Button, IconButton, Card, Heading, Stat, Badge, Chip, ToneChip, PageTabs, Segmented, Input, Select, Mask, Spinner };

// ---- R1.3: Table, Modal / Sheet, EmptyState, Skeleton, ChartFrame ---------

// true below the phone breakpoint (DESIGN-SYSTEM § 2.4), live on resize.
function useNarrow(query) {
  const q = query || '(max-width: 767px)';
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);
  const [narrow, setNarrow] = React.useState(get);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(q);
    const on = () => setNarrow(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    on();
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else if (mq.removeListener) mq.removeListener(on); };
  }, [q]);
  return narrow;
}

// EmptyState: the shared MaerminUI.EmptyState (title, one sentence, one or more next
// actions; kinds empty / worker / demo / loading). Re-exported so views take every
// component from one place.
function EmptyState(props) {
  const UI = window.MaerminUI;
  return UI && UI.EmptyState ? h(UI.EmptyState, props) : null;
}

// Skeleton: placeholder shapes while data loads (shown after 150 ms by CSS).
function Skeleton(props) {
  const shape = /^(text|kpi|row|chart|block)$/.test(props.shape) ? props.shape : 'text';
  const n = Math.max(1, props.lines || 1);
  return h('div', { className: cx('ui-skel', 'ui-skel--' + shape, props.className), 'aria-hidden': 'true', 'data-testid': props['data-testid'] },
    Array.from({ length: shape === 'text' || shape === 'row' ? n : 1 }, (_, i) => h('span', { key: i, className: 'ui-skel__bar' })));
}

// Row overflow menu: one IconButton, a small menu of actions.
function RowMenu(props) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); const b = ref.current && ref.current.querySelector('button'); if (b) b.focus(); } };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  const items = props.items || [];
  return h('div', { className: 'ui-rowmenu', ref },
    h(IconButton, { size: 'sm', label: props.label || __('uiRowActions', 'Actions'), 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: (e) => { e.stopPropagation(); setOpen(!open); }, icon: h('span', { 'aria-hidden': 'true' }, '⋯') }),
    open ? h('div', { className: 'ui-rowmenu__list', role: 'menu' },
      items.map((it, i) => h('button', {
        key: i, type: 'button', role: 'menuitem', className: cx('ui-rowmenu__item', it.danger && 'is-danger'), autoFocus: i === 0,
        onClick: (e) => { e.stopPropagation(); setOpen(false); it.onClick && it.onClick(); }
      }, it.label))) : null);
}

// Table: one money table for desktop, two-line rows on phones.
//   columns: [{ key, label, align, priority (1 always, 2 tablet+, 3 desktop), render(row),
//               sortable, phone: 'title' | 'meta' | 'value' | 'sub' }]
//   rows: data rows; a row with `__group` is a group header ({ __group: label, __summary: node }).
function Table(props) {
  const cols = props.columns || [];
  const rows = props.rows || [];
  const narrowAuto = useNarrow();
  const narrow = props.layout === 'phone' ? true : props.layout === 'table' ? false : narrowAuto;
  const keyOf = props.rowKey || ((r, i) => r.id != null ? r.id : i);
  const cell = (c, r) => (c.render ? c.render(r) : r[c.key]);
  const sel = props.selected;
  const selectable = !!props.onSelect;
  if (props.loading && !rows.length) return h('div', { className: 'ui-table-wrap', 'data-testid': props['data-testid'] }, h(Skeleton, { shape: 'row', lines: 5 }));
  if (!rows.length) return props.empty || null;

  if (narrow) {
    const pick = (role) => cols.filter((c) => c.phone === role);
    const title = pick('title'), meta = pick('meta'), value = pick('value'), sub = pick('sub');
    return h('ul', { className: cx('ui-plist', props.className), 'data-testid': props['data-testid'], 'aria-label': props.caption },
      rows.map((r, i) => r.__group
        ? h('li', { key: 'g' + i, className: 'ui-plist__group' }, h('span', null, r.__group), r.__summary ? h('span', { className: 'num' }, r.__summary) : null)
        : h('li', Object.assign({
          key: keyOf(r, i), className: cx('ui-plist__row', (props.onRowClick || props.rowProps) && 'is-clickable', sel && sel.has(keyOf(r, i)) && 'is-selected')
        }, props.onRowClick ? { onClick: () => props.onRowClick(r), tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter') props.onRowClick(r); } } : null,
        props.rowProps ? props.rowProps(r) : null),
        h('div', { className: 'ui-plist__main' },
          h('div', { className: 'ui-plist__title' }, title.map((c) => h('span', { key: c.key }, cell(c, r)))),
          meta.length ? h('div', { className: 'ui-plist__meta' }, meta.map((c, k) => h('span', { key: c.key }, k ? ' · ' : '', cell(c, r)))) : null),
        h('div', { className: cx('ui-plist__side', 'num') },
          value.map((c) => h('div', { key: c.key, className: 'ui-plist__value' }, cell(c, r))),
          sub.map((c) => h('div', { key: c.key, className: 'ui-plist__sub' }, cell(c, r)))),
        props.rowActions ? h(RowMenu, { items: props.rowActions(r) }) : null)));
  }

  const sort = props.sort || {};
  const head = h('thead', null, h('tr', null,
    selectable ? h('th', { className: 'ui-table__check', scope: 'col' }, h('input', { type: 'checkbox', 'aria-label': __('uiSelectAll', 'Select all'),
      checked: !!(sel && rows.filter((r) => !r.__group).every((r, i) => sel.has(keyOf(r, i)))), onChange: (e) => props.onSelect(e.target.checked ? 'all' : 'none') })) : null,
    cols.map((c) => {
      const dir = sort.key === c.key ? sort.dir : null;
      return h('th', { key: c.key, scope: 'col', className: cx(c.align === 'right' && 'is-right', 'p' + (c.priority || 1)), 'aria-sort': dir ? (dir === 'asc' ? 'ascending' : 'descending') : undefined },
        c.sortable && props.onSort ? h('button', { type: 'button', className: 'ui-table__sort', onClick: () => props.onSort(c.key, dir === 'asc' ? 'desc' : 'asc') },
          c.label, h('span', { 'aria-hidden': 'true', className: 'ui-table__sortmark' }, dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕')) : c.label);
    }),
    props.rowActions ? h('th', { className: 'ui-table__act', scope: 'col' }, h('span', { className: 'sr-only' }, __('uiRowActions', 'Actions'))) : null));
  const body = h('tbody', null, rows.map((r, i) => {
    if (r.__group) {
      return h('tr', { key: 'g' + i, className: 'ui-table__group' },
        h('td', { colSpan: cols.length + (selectable ? 1 : 0) + (props.rowActions ? 1 : 0) },
          h('span', null, r.__group), r.__summary ? h('span', { className: cx('num', 'ui-table__summary') }, r.__summary) : null));
    }
    const k = keyOf(r, i);
    // rowProps last: a row's own handlers (keyboard-clickable rows) win
    return h('tr', Object.assign({
      key: k, className: cx((props.onRowClick || props.rowProps) && 'is-clickable', sel && sel.has(k) && 'is-selected')
    }, props.onRowClick ? { onClick: () => props.onRowClick(r) } : null, props.rowProps ? props.rowProps(r) : null),
    selectable ? h('td', { className: 'ui-table__check' }, h('input', { type: 'checkbox', 'aria-label': __('uiSelectRow', 'Select row'), checked: !!(sel && sel.has(k)), onClick: (e) => e.stopPropagation(), onChange: (e) => props.onSelect(k, e.target.checked) })) : null,
    cols.map((c) => h('td', { key: c.key, className: cx(c.align === 'right' && 'is-right num', 'p' + (c.priority || 1)) }, cell(c, r))),
    props.rowActions ? h('td', { className: 'ui-table__act' }, h(RowMenu, { items: props.rowActions(r) })) : null);
  }));
  return h('div', { className: cx('ui-table-wrap', props.className), 'data-testid': props['data-testid'] },
    h('table', { className: 'ui-table' }, props.caption ? h('caption', { className: 'sr-only' }, props.caption) : null, head, body));
}

// Modal: a dialog on MaerminUI.Overlay (focus trap, Escape, focus back). Phones get a bottom sheet.
let dlgSeq = 0;
function Modal(props) {
  const Overlay = window.MaerminUI && window.MaerminUI.Overlay;
  const narrow = useNarrow();
  // titleId: a fixed id for the title (a dialog other code or tests address by it)
  const idRef = React.useRef(props.titleId || ('ui-dlg-' + (++dlgSeq)));
  if (!props.open || !Overlay) return null;
  const sheet = props.sheet !== false && narrow;
  return h(Overlay, { onClose: props.onClose, dismissable: props.dismissable, focusField: props.focusField, className: cx('ui-modal-backdrop', sheet && 'is-sheet') },
    h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': idRef.current, className: cx('ui-modal', sheet && 'ui-modal--sheet', props.size === 'lg' && 'ui-modal--lg', props.className), 'data-testid': props['data-testid'] },
      sheet ? h('span', { className: 'ui-modal__handle', 'aria-hidden': 'true' }) : null,
      h('header', { className: 'ui-modal__head' },
        h('h2', { id: idRef.current, className: 'ui-modal__title' }, props.title),
        props.onClose ? h(IconButton, { size: 'sm', label: __('uiClose', 'Close'), onClick: props.onClose, icon: h('span', { 'aria-hidden': 'true' }, '×') }) : null),
      h('div', { className: 'ui-modal__body' }, h(HeadingLevel.Provider, { value: 3 }, props.children)),
      props.footer ? h('footer', { className: 'ui-modal__foot' }, props.footer) : null));
}

// ChartFrame: title, subtitle, the chart, a legend in words, "Show as table", source.
function ChartFrame(props) {
  const [asTable, setAsTable] = React.useState(false);
  const canTable = !!(props.table && props.table.columns && props.table.rows);
  return h(Card, { title: props.title, subtitle: props.subtitle, className: cx('ui-chart', props.className), 'data-testid': props['data-testid'],
    // R4.1: the view's own control (periods) and the table switch side by side
    action: canTable ? h('div', { className: 'ui-chart__actions' }, props.action || null,
      h(Button, { variant: 'quiet', size: 'sm', 'aria-pressed': asTable, onClick: () => setAsTable(!asTable) }, asTable ? __('uiHideTable', 'Show chart') : __('uiShowTable', 'Show as table'))) : props.action },
  asTable ? h(Table, Object.assign({ caption: props.title, layout: 'table' }, props.table)) : h('div', { className: 'ui-chart__plot', role: props.summary ? 'img' : undefined, 'aria-label': props.summary }, props.children),
  Array.isArray(props.legend) && props.legend.length ? h('ul', { className: 'ui-chart__legend' },
    props.legend.map((l, i) => h('li', { key: i }, h('span', { className: 'ui-chart__swatch', 'data-series': l.series || i + 1, 'aria-hidden': 'true' }), l.label, l.value != null ? h('b', { className: 'num' }, l.value) : null))) : null,
  props.source ? h('p', { className: 'ui-chart__source' }, props.source) : null);
}

Object.assign(Components, { useNarrow, EmptyState, Skeleton, RowMenu, Table, Modal, ChartFrame });

// ---- R2.1: app shell — Rail, PageHeader, Dock (DESIGN-SYSTEM § 4, § 9) ----
const shellIcon = (name, size) => (window.MaerminIcon ? window.MaerminIcon(name, { size }) : null);

// Rail (desktop): the areas, Settings at the foot. items: { id, label, icon, active, foot }.
// An area holds the page, so the active item is aria-current="true", not "page".
function Rail(props) {
  const items = props.items || [];
  const item = (it) => h('button', {
    key: it.id, type: 'button', 'data-area': it.id, className: cx('ui-rail__item', it.active && 'is-active'),
    'aria-current': it.active ? 'true' : undefined, onClick: () => props.onSelect && props.onSelect(it.id)
  }, shellIcon(it.icon, 22), h('span', { className: 'ui-rail__label' }, it.label));
  return h('nav', { className: cx('ui-rail', props.className), 'aria-label': props.label },
    props.brand ? h('div', { className: 'ui-rail__brand' }, props.brand) : null,
    items.filter((it) => !it.foot).map(item),
    h('div', { className: 'ui-rail__spacer', 'aria-hidden': 'true' }),
    items.filter((it) => it.foot).map(item));
}

// PageHeader: title, portfolio scope, actions, then one row of page tabs.
// On phones the same header is the top bar (brand shows, the title stays).
function PageHeader(props) {
  return h('header', { className: cx('ui-pagehead', props.className) },
    h('div', { className: 'ui-pagehead__row' },
      props.brand ? h('div', { className: 'ui-pagehead__brand' }, props.brand) : null,
      h('h1', { className: 'ui-pagehead__title' }, props.title),
      props.scope ? h('div', { className: 'ui-pagehead__scope' }, props.scope) : null,
      h('div', { className: 'ui-pagehead__actions', ref: props.actionsRef }, props.actions)),
    props.tabs ? h('div', { className: 'ui-pagehead__tabs' }, props.tabs) : null);
}

// Dock (phone): five slots, the middle one is Add. items: { id, label, icon, active, add, onClick }.
function Dock(props) {
  return h('nav', { className: cx('ui-dock', props.className), 'aria-label': props.label },
    (props.items || []).map((it) => h('button', {
      key: it.id, type: 'button', 'data-area': it.id,
      className: cx('ui-dock__item', it.add && 'ui-dock__add', it.active && 'is-active'),
      'aria-current': it.active ? 'true' : undefined, 'aria-label': it.add ? it.label : undefined,
      'aria-haspopup': it.haspopup, 'aria-expanded': it.expanded, title: it.add ? it.label : undefined, onClick: it.onClick
    }, shellIcon(it.icon, it.add ? 26 : 22), it.add ? null : h('span', { className: 'ui-dock__label' }, it.label))));
}

// SectionSwitch (B-3): the sections inside a view, never a second row of page
// tabs. A segmented control; on phones a select once there are more than three
// sections (they wrapped into two or three rows of pills).
function SectionSwitch(props) {
  const narrow = useNarrow();
  const opts = props.options || [];
  const wrap = (child) => h('div', { className: cx('ui-section-switch', props.className), 'data-testid': props['data-testid'] }, child);
  if (narrow && opts.length > 3) {
    return wrap(h(Select, {
      'aria-label': props.label, value: props.value, fieldClassName: 'ui-section-switch__select',
      onChange: (e) => props.onChange && props.onChange(e.target.value),
      options: opts.map((o) => ({ value: o.value, label: o.label }))
    }));
  }
  return wrap(h(Segmented, { label: props.label, value: props.value, onChange: props.onChange, options: opts }));
}

// ---- R3.1: holdings map (B-4) -------------------------------------------

// Pack positions into columns: the largest first, each into the lightest
// column. A column's width and a tile's height follow value, so area ~ value.
function mapColumns(items, n) {
  const list = (items || []).filter((it) => it && it.value > 0).slice().sort((a, b) => b.value - a.value);
  const cols = [];
  for (let i = 0; i < Math.max(1, Math.min(n || 1, list.length)); i++) cols.push({ sum: 0, items: [] });
  list.forEach((it) => { let k = 0; cols.forEach((c, j) => { if (c.sum < cols[k].sum) k = j; }); cols[k].items.push(it); cols[k].sum += it.value; });
  return cols.filter((c) => c.items.length);
}

// Tile tone: the return since purchase on a log scale, gain or loss tint.
function mapTint(pct) {
  if (typeof pct !== 'number' || !isFinite(pct)) return 'var(--surface-2)';
  const a = Math.min(Math.log10(1 + Math.abs(pct)) / 3, 1);
  return 'color-mix(in srgb, var(--' + (pct >= 0 ? 'gain' : 'loss') + ') ' + Math.round(14 + a * 46) + '%, var(--surface))';
}

// HoldingsMap: area = value, colour = return since purchase (always with ▲ / ▼).
// items: { key, label, title, value, pct, pctText }. onPick(item) opens a holding.
function HoldingsMap(props) {
  const narrow = useNarrow();
  // Phones show the largest holdings only; the table below lists every one.
  const items = narrow && props.items ? props.items.slice().sort((x, y) => y.value - x.value).slice(0, props.phoneMax || 12) : props.items;
  const cols = mapColumns(items, narrow ? 2 : (props.columns || 4));
  if (!cols.length) return props.empty || null;
  return h('div', { className: cx('ui-map', props.className), 'data-testid': props['data-testid'], role: 'group', 'aria-label': props.label },
    cols.map((c, ci) => h('div', { key: ci, className: 'ui-map__col', style: { flexGrow: c.sum } },
      c.items.map((it) => h('button', {
        key: it.key, type: 'button', className: 'ui-map__tile', 'data-map-key': it.key,
        style: { flexGrow: it.value, background: mapTint(it.pct) }, title: it.title,
        'aria-label': it.title, onClick: props.onPick ? () => props.onPick(it) : undefined
      },
      h('b', null, it.label),
      it.pctText ? h('span', { className: 'num' }, (it.pct >= 0 ? '▲ ' : '▼ ') + it.pctText) : null)))));
}

Object.assign(Components, { Rail, PageHeader, Dock, SectionSwitch, HoldingsMap, mapColumns, mapTint });

// Export components
if (typeof window !== 'undefined') {
  window.CommandPalette = CommandPalette;
  window.ShortcutsModal = ShortcutsModal;
  window.ToastContainer = ToastContainer;
  window.CorrelationMatrixView = CorrelationMatrixView;
  window.MonteCarloView = MonteCarloView;
  window.StressTestView = StressTestView;
  window.MaerminComponents = Components;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { Components };

})(); // End IIFE
