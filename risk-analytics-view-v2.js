// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
// ============================================================================
// MAERMIN v6.0 - Risk Analytics View Component
// Visual display of risk metrics
// ============================================================================

function RiskAnalyticsViewV2(props) {
  var portfolio = props.portfolio;
  var prices = props.prices;
  var priceHistory = props.priceHistory;
  var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
  var theme = props.theme || {};
  var formatPrice = props.formatPrice || function(v) { return window.MaerminI18n.num(v, 2); };
  // formatPrice converts to the display currency, so the label must follow it (FINDINGS M-12).
  var currencyLabel = typeof props.getCurrencySymbol === 'function' ? props.getCurrencySymbol() : 'EUR';
  var transactions = props.transactions || [];
  var setActiveView = props.setActiveView;

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  
  var riskMetricsState = useState(null);
  var riskMetrics = riskMetricsState[0];
  var setRiskMetrics = riskMetricsState[1];
  
  var recommendationsState = useState([]);
  var recommendations = recommendationsState[0];
  var setRecommendations = recommendationsState[1];
  
  // Calculate portfolio value
  var portfolioValue = useMemo(function() {
    var total = 0;
    ['crypto', 'stocks', 'skins'].forEach(function(category) {
      var positions = portfolio[category] || [];
      positions.forEach(function(pos) {
        var symbol = (pos.symbol || pos.name || '').toLowerCase();
        var currentPrice = prices[symbol] || pos.purchasePrice || 0;
        total += (pos.amount || 1) * currentPrice;
      });
    });
    return total;
  }, [portfolio, prices]);
  
  var indexSeries = useMemo(function () {
    var vs = props.historySource === 'daily' ? null : props.valueSeries;
    if (!Array.isArray(vs) || typeof MIN_RISK_OBSERVATIONS === 'undefined' || vs.length <= MIN_RISK_OBSERVATIONS) return null;
    return vs.map(function (p) { return p.v; });
  }, [props.valueSeries, props.historySource]);

  // Calculate risk metrics
  useEffect(function() {
    if (typeof calculatePortfolioRiskMetrics !== 'undefined') {
      // Convert price history from [{timestamp, price}, ...] to [price, ...] format
      var convertedHistory = {};
      if (priceHistory && typeof priceHistory === 'object') {
        Object.keys(priceHistory).forEach(function(symbol) {
          var history = priceHistory[symbol];
          if (Array.isArray(history) && history.length > 0) {
            if (typeof history[0] === 'object' && history[0].price !== undefined) {
              convertedHistory[symbol] = history.map(function(item) { return item.price; });
            } else {
              convertedHistory[symbol] = history;
            }
          }
        });
      }
      
      // VIS-005: without daily closes for every holding, the flow-neutral daily
      // index of the whole portfolio (the value path) is the series - the same
      // one the rolling panel below uses - instead of a few refresh prices.
      var riskBook = portfolio, riskValue = portfolioValue;
      if (indexSeries) {
        convertedHistory = { __portfolio__: indexSeries };
        riskBook = { stocks: [{ symbol: '__portfolio__', amount: 1, currentPrice: 1 }] };
        riskValue = 1;
      }
      // Too few observations: the engine returns zeros. Leave riskMetrics
      // null so the "needs history" state renders instead of fake values.
      if (typeof hasMeasurableRisk !== 'undefined' && !hasMeasurableRisk(convertedHistory)) {
        setRiskMetrics(null); setRecommendations([]);
        return;
      }
      var metrics = calculatePortfolioRiskMetrics(riskBook, convertedHistory, riskValue);
      // On the index path the engine works on a value of 1: VaR/CVaR are then
      // per euro - scale them to the portfolio (the Overview's value in EUR).
      if (indexSeries && typeof scaleRiskMoney !== 'undefined') {
        metrics = scaleRiskMoney(metrics, props.portfolioValueEUR > 0 ? props.portfolioValueEUR : portfolioValue);
        // ...and the distribution / recommendations describe the real holdings,
        // not the one synthetic index position.
        if (typeof bookWeights !== 'undefined') metrics.weights = bookWeights(portfolio, prices);
      }
      setRiskMetrics(metrics);
      
      if (typeof generateRiskRecommendations !== 'undefined') {
        var recs = generateRiskRecommendations(metrics, portfolio);
        setRecommendations(recs);
      }
    }
  }, [portfolio, priceHistory, portfolioValue, indexSeries, props.portfolioValueEUR]);
  
  // R4.2: tones instead of colours (warning / loss carry their word or sign),
  // the shared Card, Stat tiles and meters.
  var UIC = window.MaerminComponents;
  var I = window.MaerminI18n;
  var e = React.createElement;
  var riskTone = function (level) { return level === 'low' ? 'gain' : level === 'medium' ? 'warning' : (level === 'high' || level === 'very-high') ? 'loss' : 'neutral'; };

  var getRiskLabel = function(level) {
    var labels = {
      'low': __('rkLow', 'Low'),
      'medium': __('rkMedium', 'Medium'),
      'high': __('rkHigh', 'High'),
      'very-high': __('rkVeryHigh', 'Very High')
    };
    return labels[level] || level;
  };

  var meter = function (pct, tone) {
    return e('span', { className: 'ui-meter', 'aria-hidden': 'true' }, e('span', { className: 'ui-meter__fill', 'data-tone': tone || 'accent', style: { width: Math.max(0, Math.min(100, pct)) + '%' } }));
  };

  // ── Structural risk dimensions (V7) — concentration, rebalancing drift and
  //    currency exposure. These need no price history, so they render even
  //    before volatility/VaR can be measured. All numbers come from the shared
  //    MaerminMetrics service (reuses PortfolioHealth HHI, the RebalancingView
  //    targets, and real transaction currencies).
  function renderDimensions() {
    var M = (typeof window !== 'undefined') && window.MaerminMetrics;
    if (!M) return null;
    var conc = M.computeConcentration(portfolio, prices);
    var drift = M.computeRebalancingDrift(portfolio, prices);
    var fx = M.computeCurrencyExposure(portfolio, prices, transactions);

    var clsLabel = function (c) { var m = { crypto: t.crypto || 'Crypto', stocks: t.stocks || 'Stocks', skins: t.cs2Skins || 'CS2 Items', commodities: t.commodities || 'Commodities' }; return m[c] || c; };
    var driftTone = function (d) { var a = Math.abs(d); return a < 5 ? '' : a < 12 ? 'tone-warning' : 'tone-loss'; };
    var open = function (view) {
      return view && setActiveView ? e(UIC.Button, { variant: 'quiet', size: 'sm', onClick: function () { setActiveView(view); } }, (t.healthOpenView || 'Open') + ' ›') : null;
    };
    var noData = e('p', { className: 'ui-muted' }, t.noData || 'No data');

    return e('div', { className: 'ui-grid-3', 'data-testid': 'risk-dimensions' },
      e(UIC.Card, { title: t.riskConcentration || 'Concentration risk', headingLevel: 'h3', action: open('health') },
        conc.available
          ? e(UIC.Stat, { label: t.riskLargestPosition || 'largest position', value: I.pct(conc.maxWeight * 100, 0), tone: conc.maxWeight > 0.3 ? 'warning' : null,
              sub: I.num(conc.effectiveN || 0, 1) + ' ' + (t.healthEffectivePositions || 'effective positions') })
          : noData),
      e(UIC.Card, { title: t.riskDrift || 'Rebalancing drift', headingLevel: 'h3', action: open('rebalancing') },
        drift.available
          ? e('ul', { className: 'ui-rows' }, drift.rows.map(function (r) {
              return e('li', { key: r.cls, className: 'ui-rows__row' },
                e('span', { className: 'ui-muted' }, clsLabel(r.cls)),
                e('span', { className: 'num' }, I.pct(r.currentPct, 0) + ' / ' + I.pct(r.targetPct, 0) + ' ',
                  e('b', { className: driftTone(r.drift) }, I.pct(r.drift, 0, true))));
            }))
          : drift.reason === 'no-targets'
            ? e('p', { className: 'ui-muted' }, __('rbNoTargetsShort', 'No targets set'))
            : noData),
      e(UIC.Card, { title: t.riskCurrency || 'Currency exposure', headingLevel: 'h3' },
        fx.available
          ? e('ul', { className: 'ui-meters' }, fx.rows.map(function (r) {
              return e('li', { key: r.currency },
                e('span', { className: 'ui-meters__label' }, e('b', null, r.currency), e('span', { className: 'num' }, I.pct(r.pct, 0))),
                meter(r.pct));
            }))
          : noData)
    );
  }

  function sourceLine() {
    // Source of the volatility / VaR / drawdown figures below.
    return e('p', { className: 'ui-view__lead', 'data-testid': 'risk-source', 'data-source': indexSeries ? 'index' : (props.historySource || 'refresh') },
      indexSeries
        ? __('rkBasedIndex', 'Based on the daily value of your portfolio ({n} daily returns)', { n: indexSeries.length - 1 })
        : props.historySource === 'daily'
        ? __('rkBasedDaily', 'Based on daily closing prices ({n} daily returns)', { n: typeof riskObservations !== 'undefined' ? riskObservations(priceHistory) : 0 })
        : __('rkBasedRefresh', 'Based on the prices recorded on your refreshes'));
  }

  // P5-1.6: one plain sentence under a key figure (rules in verdicts.js).
  var V = typeof window !== 'undefined' ? window.MaerminVerdicts : null;
  function verdictLine(r, id) {
    if (!r) return null;
    return e('span', { 'data-testid': 'verdict-' + id, 'data-level': r.level, className: ['ui-verdict', 'ui-verdict--sub'].join(' ') }, r.text);
  }
  var metric = function (label, value, tone, verdict, testid) {
    return e(UIC.Card, { key: label, variant: 'answer', className: 'ui-ov-tile', 'data-testid': testid },
      e(UIC.Stat, { label: label, value: value, tone: tone || null, sub: verdict || null }));
  };

  if (!riskMetrics) {
    // No usable price history yet — still show the structural dimensions.
    return e('div', { className: 'ui-view', 'data-testid': 'risk-view' },
      sourceLine(),
      renderDimensions(),
      window.MaerminUtils.emptyState({ testid: 'risk-need-history', text:
        (t.riskNeedsHistory || 'Refresh prices a few times to unlock volatility, Value-at-Risk and drawdown — these need a short price history.') +
          (typeof riskObservations !== 'undefined' ? ' ' + __('rkObsSoFar', '({n} of {min} observations so far)', { n: riskObservations(priceHistory), min: MIN_RISK_OBSERVATIONS }) : '') })
    );
  }

  var sharpeTone = riskMetrics.sharpeRatio >= 1 ? 'gain' : riskMetrics.sharpeRatio >= 0.5 ? 'warning' : 'loss';
  return e('div', { className: 'ui-view', 'data-testid': 'risk-view' },
    sourceLine(),

    // Risk score: the answer
    e(UIC.Card, { variant: 'hero', 'data-testid': 'risk-score' },
      e('div', { className: 'ui-split' },
        e(UIC.Stat, { size: 'lg', label: t.riskLevel || 'Risk Score', value: I.num(riskMetrics.riskScore, 0), tone: riskTone(riskMetrics.riskLevel) }),
        e(UIC.Badge, { tone: riskTone(riskMetrics.riskLevel) }, getRiskLabel(riskMetrics.riskLevel)))),

    // Structural risk dimensions (always shown)
    renderDimensions(),

    // Metrics
    e('div', { className: 'ui-ov-tiles', 'data-testid': 'risk-metrics' },
      metric(t.volatility || 'Volatility (Annual)', I.pct(riskMetrics.volatility, 1), null, V && verdictLine(V.volatility(riskMetrics.volatility), 'volatility')),
      metric(__('rkVar', 'VaR (95%, 1-day)'), formatPrice(riskMetrics.var95) + ' ' + currencyLabel, null, __('rkVarSub', 'a bad day, 1 in 20')),
      metric('CVaR (' + I.pct(95, 0) + ')', formatPrice(riskMetrics.cvar95) + ' ' + currencyLabel, null, __('rkCvarSub', 'average of those bad days')),
      metric(__('rkSharpe', 'Sharpe Ratio'), I.num(riskMetrics.sharpeRatio, 2), sharpeTone, V && verdictLine(V.sharpe(riskMetrics.sharpeRatio), 'sharpe')),
      metric(__('rkSortino', 'Sortino Ratio'), isFinite(riskMetrics.sortinoRatio) ? I.num(riskMetrics.sortinoRatio, 2) : __('healthNotAvailable', 'n/a'), null, V && verdictLine(V.sortino(riskMetrics.sortinoRatio), 'sortino')),
      metric(__('rkMaxDd', 'Max Drawdown'), '−' + I.pct(Math.abs(riskMetrics.maxDrawdownPercent), 1), riskMetrics.maxDrawdownPercent ? 'loss' : null, V && verdictLine(V.drawdown(riskMetrics.maxDrawdownPercent), 'drawdown'))),
    V && e('p', { 'data-testid': 'verdict-note', className: ['ui-note', 'ui-note--flush'].join(' ') }, V.disclaimer()),

    // Recommendations
    recommendations.length > 0 && e(UIC.Card, { title: t.recommendations || 'Recommendations', headingLevel: 'h3', 'data-testid': 'risk-recs' },
      e('ul', { className: 'ui-findings' }, recommendations.map(function (rec, idx) {
        return e('li', { key: idx, className: 'ui-finding', 'data-level': rec.priority === 'high' ? 'bad' : 'warn' },
          e(UIC.Badge, { tone: rec.priority === 'high' ? 'loss' : 'warning' }, rec.priority === 'high' ? (t.highRisk || 'HIGH') : (t.mediumRisk || 'MEDIUM')),
          e('p', null, rec.message));
      }))),

    // Portfolio Weights
    Object.keys(riskMetrics.weights || {}).length > 0 && e(UIC.Card, { title: t.distribution || 'Portfolio Weights', headingLevel: 'h3', 'data-testid': 'risk-weights' },
      e('ul', { className: ['ui-meters', 'ui-meters--cols'].join(' ') }, Object.entries(riskMetrics.weights).sort(function (a, b) { return b[1] - a[1]; }).map(function (entry) {
        return e('li', { key: entry[0] },
          e('span', { className: 'ui-meters__label' }, e('b', null, entry[0].toUpperCase()), e('span', { className: 'num' }, I.pct(entry[1] * 100, 1))),
          meter(entry[1] * 100));
      })))
  );
}

// Export
if (typeof window !== 'undefined') {
  window.RiskAnalyticsViewV2 = RiskAnalyticsViewV2;
}
