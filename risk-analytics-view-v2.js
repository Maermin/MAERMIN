// ============================================================================
// MAERMIN v6.0 - Risk Analytics View Component
// Visual display of risk metrics
// ============================================================================

function RiskAnalyticsViewV2(props) {
  var portfolio = props.portfolio;
  var prices = props.prices;
  var priceHistory = props.priceHistory;
  var t = props.t || {};
  var theme = props.theme || {};
  var formatPrice = props.formatPrice || function(v) { return v.toFixed(2); };
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
      
      var metrics = calculatePortfolioRiskMetrics(portfolio, convertedHistory, portfolioValue);
      setRiskMetrics(metrics);
      
      if (typeof generateRiskRecommendations !== 'undefined') {
        var recs = generateRiskRecommendations(metrics, portfolio);
        setRecommendations(recs);
      }
    }
  }, [portfolio, priceHistory, portfolioValue]);
  
  var getRiskColor = function(level) {
    switch (level) {
      case 'low': return theme.success || '#22c55e';
      case 'medium': return theme.warning || '#f59e0b';
      case 'high': return theme.danger || '#ef4444';
      case 'very-high': return '#dc2626';
      default: return theme.textSecondary || '#6b7280';
    }
  };
  
  var getRiskLabel = function(level) {
    var labels = {
      'low': 'Low',
      'medium': 'Medium',
      'high': 'High',
      'very-high': 'Very High'
    };
    return labels[level] || level;
  };
  
  // ── Structural risk dimensions (V7) — concentration, rebalancing drift and
  //    currency exposure. These need no price history, so they render even
  //    before volatility/VaR can be measured. All numbers come from the shared
  //    MaerminMetrics service (reuses PortfolioHealth HHI, the RebalancingView
  //    targets, and real transaction currencies).
  function renderDimensions() {
    var M = (typeof window !== 'undefined') && window.MaerminMetrics;
    if (!M) return null;
    var e = React.createElement;
    var conc = M.computeConcentration(portfolio, prices);
    var drift = M.computeRebalancingDrift(portfolio, prices);
    var fx = M.computeCurrencyExposure(portfolio, prices, transactions);

    var clsLabel = function (c) { var m = { crypto: t.crypto || 'Crypto', stocks: t.stocks || 'Stocks', skins: t.cs2Skins || 'CS2 Items', commodities: t.commodities || 'Commodities' }; return m[c] || c; };
    var driftColor = function (d) { var a = Math.abs(d); return a < 5 ? (theme.success || '#22c55e') : a < 12 ? (theme.warning || '#f59e0b') : (theme.danger || '#ef4444'); };
    var box = function (children) { return e('div', { style: { background: theme.card, padding: '1.25rem', borderRadius: '12px', border: '1px solid ' + theme.cardBorder } }, children); };
    var head = function (label, view) {
      var clickable = !!(view && setActiveView);
      return e('div', {
        onClick: clickable ? function () { setActiveView(view); } : undefined,
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', cursor: clickable ? 'pointer' : 'default' }
      },
        e('span', { style: { color: theme.text, fontWeight: 600, fontSize: '0.95rem' } }, label),
        clickable ? e('span', { style: { color: theme.textSecondary, fontSize: '0.82rem' } }, (t.healthOpenView || 'Open') + ' ›') : null);
    };
    var noData = e('div', { style: { color: theme.textSecondary, fontSize: '0.85rem' } }, t.noData || 'No data');

    return e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      box([
        head(t.riskConcentration || 'Concentration risk', 'health'),
        conc.available
          ? e('div', { key: 'c' },
              e('div', { style: { display: 'flex', alignItems: 'baseline', gap: '0.5rem' } },
                e('span', { style: { fontSize: '1.6rem', fontWeight: 800, color: conc.maxWeight > 0.3 ? (theme.danger || '#ef4444') : theme.text } }, (conc.maxWeight * 100).toFixed(0) + '%'),
                e('span', { style: { color: theme.textSecondary, fontSize: '0.8rem' } }, t.riskLargestPosition || 'largest position')),
              e('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginTop: '0.35rem' } }, (conc.effectiveN || 0).toFixed(1) + ' ' + (t.healthEffectivePositions || 'effective positions')))
          : noData
      ]),
      box([
        head(t.riskDrift || 'Rebalancing drift', 'rebalancing'),
        drift.available
          ? e('div', { key: 'd' }, drift.rows.map(function (r) {
              return e('div', { key: r.cls, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', fontSize: '0.8rem' } },
                e('span', { style: { color: theme.textSecondary } }, clsLabel(r.cls)),
                e('span', { style: { color: theme.text } },
                  r.currentPct.toFixed(0) + '% / ' + r.targetPct.toFixed(0) + '% ',
                  e('span', { style: { color: driftColor(r.drift), fontWeight: 700 } }, (r.drift >= 0 ? '+' : '') + r.drift.toFixed(0) + '%')));
            }))
          : noData
      ]),
      box([
        head(t.riskCurrency || 'Currency exposure', null),
        fx.available
          ? e('div', { key: 'f' }, fx.rows.map(function (r) {
              return e('div', { key: r.currency, style: { marginBottom: '0.5rem' } },
                e('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.2rem' } },
                  e('span', { style: { color: theme.text, fontWeight: 600 } }, r.currency),
                  e('span', { style: { color: theme.textSecondary } }, r.pct.toFixed(0) + '%')),
                e('div', { style: { height: '6px', background: theme.inputBg, borderRadius: '3px', overflow: 'hidden' } },
                  e('div', { style: { height: '100%', width: r.pct + '%', background: theme.accent, borderRadius: '3px' } })));
            }))
          : noData
      ])
    );
  }

  // V7: reuse the structural numbers this view already computes as the AI
  // copilot context — no second risk engine.
  function riskAiContext() {
    var M = (typeof window !== 'undefined') && window.MaerminMetrics;
    var data = {};
    if (riskMetrics) { data.riskScore = Math.round(riskMetrics.riskScore); data.riskLevel = getRiskLabel(riskMetrics.riskLevel); }
    if (M) {
      var conc = M.computeConcentration(portfolio, prices);
      var drift = M.computeRebalancingDrift(portfolio, prices);
      var fx = M.computeCurrencyExposure(portfolio, prices, transactions);
      if (conc.available) data.concentration = { largestPositionPct: Math.round(conc.maxWeight * 100), effectivePositions: +(conc.effectiveN || 0).toFixed(1) };
      if (drift.available) data.rebalancingDrift = drift.rows.map(function (r) { return { class: r.cls, currentPct: Math.round(r.currentPct), targetPct: Math.round(r.targetPct), driftPct: Math.round(r.drift) }; });
      if (fx.available) data.currencyExposure = fx.rows.map(function (r) { return { currency: r.currency, pct: Math.round(r.pct) }; });
    }
    return { title: t.riskLevel || 'Risk Analytics', data: data };
  }
  function riskHeader() {
    var e = React.createElement;
    return e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' } },
      e('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '600', margin: 0 } }, t.riskLevel || 'Risk Analytics'),
      window.AICopilot ? e(window.AICopilot.Button, { theme: theme, t: t, context: riskAiContext() }) : null);
  }

  if (!riskMetrics) {
    // No usable price history yet — still show the structural dimensions.
    return React.createElement('div', { style: { padding: '1.5rem' } },
      riskHeader(),
      renderDimensions(),
      React.createElement('div', { style: { background: theme.card, padding: '1.25rem', borderRadius: '12px', border: '1px solid ' + theme.cardBorder, color: theme.textSecondary, fontSize: '0.875rem' } },
        t.riskNeedsHistory || 'Refresh prices a few times to unlock volatility, Value-at-Risk and drawdown — these need a short price history.')
    );
  }

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header
    riskHeader(),

    // Structural risk dimensions (always shown)
    renderDimensions(),

    // Risk Score Card
    React.createElement('div', {
      style: {
        background: theme.card,
        padding: '2rem',
        borderRadius: '12px',
        border: '1px solid ' + theme.cardBorder,
        marginBottom: '1.5rem',
        textAlign: 'center'
      }
    },
      React.createElement('div', {
        style: { fontSize: '4rem', fontWeight: '700', color: getRiskColor(riskMetrics.riskLevel) }
      }, riskMetrics.riskScore.toFixed(0)),
      React.createElement('div', {
        style: { fontSize: '1.25rem', color: theme.textSecondary, marginBottom: '0.5rem' }
      }, t.riskLevel || 'Risk Score'),
      React.createElement('div', {
        style: {
          display: 'inline-block',
          padding: '0.25rem 1rem',
          borderRadius: '2rem',
          background: getRiskColor(riskMetrics.riskLevel),
          color: '#fff',
          fontWeight: '600'
        }
      }, getRiskLabel(riskMetrics.riskLevel))
    ),
    
    // Metrics Grid
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }
    },
      // Volatility
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          t.volatility || 'Volatility (Annual)'
        ),
        React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
          riskMetrics.volatility.toFixed(1) + '%'
        )
      ),
      
      // VaR
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          'VaR (95%, 1-day)'
        ),
        React.createElement('div', { style: { color: theme.danger || '#ef4444', fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
          formatPrice(riskMetrics.var95) + ' EUR'
        )
      ),
      
      // CVaR
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          'CVaR (95%)'
        ),
        React.createElement('div', { style: { color: theme.danger || '#ef4444', fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
          formatPrice(riskMetrics.cvar95) + ' EUR'
        )
      ),
      
      // Sharpe Ratio
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          'Sharpe Ratio'
        ),
        React.createElement('div', {
          style: {
            color: riskMetrics.sharpeRatio >= 1 ? theme.success : 
                   riskMetrics.sharpeRatio >= 0.5 ? theme.warning : theme.danger,
            fontSize: '1.5rem',
            fontWeight: '700'
          }
        }, riskMetrics.sharpeRatio.toFixed(2))
      ),
      
      // Sortino Ratio
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          'Sortino Ratio'
        ),
        React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
          isFinite(riskMetrics.sortinoRatio) ? riskMetrics.sortinoRatio.toFixed(2) : 'N/A'
        )
      ),
      
      // Max Drawdown
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          'Max Drawdown'
        ),
        React.createElement('div', { style: { color: theme.danger || '#ef4444', fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
          '-' + riskMetrics.maxDrawdownPercent.toFixed(1) + '%'
        )
      )
    ),
    
    // Recommendations
    recommendations.length > 0 && React.createElement('div', {
      style: {
        background: theme.card,
        padding: '1.5rem',
        borderRadius: '12px',
        border: '1px solid ' + theme.cardBorder
      }
    },
      React.createElement('h3', {
        style: { color: theme.text, marginBottom: '1rem', fontSize: '1.125rem' }
      }, t.recommendations || 'Recommendations'),
      recommendations.map(function(rec, idx) {
        return React.createElement('div', {
          key: idx,
          style: {
            padding: '1rem',
            marginBottom: idx < recommendations.length - 1 ? '0.75rem' : 0,
            background: theme.inputBg,
            borderRadius: '8px',
            borderLeft: '4px solid ' + (rec.type === 'warning' ? theme.warning : theme.accent)
          }
        },
          React.createElement('div', {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.25rem'
            }
          },
            React.createElement('span', {
              style: {
                fontSize: '0.75rem',
                padding: '0.125rem 0.5rem',
                borderRadius: '4px',
                background: rec.priority === 'high' ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)',
                color: rec.priority === 'high' ? theme.danger : theme.warning
              }
            }, rec.priority === 'high' ? (t.highRisk || 'HIGH') : (t.mediumRisk || 'MEDIUM'))
          ),
          React.createElement('p', { style: { color: theme.text, margin: 0 } }, rec.message)
        );
      })
    ),
    
    // Portfolio Weights
    Object.keys(riskMetrics.weights || {}).length > 0 && React.createElement('div', {
      style: {
        marginTop: '1.5rem',
        background: theme.card,
        padding: '1.5rem',
        borderRadius: '12px',
        border: '1px solid ' + theme.cardBorder
      }
    },
      React.createElement('h3', {
        style: { color: theme.text, marginBottom: '1rem', fontSize: '1.125rem' }
      }, t.distribution || 'Portfolio Weights'),
      Object.entries(riskMetrics.weights).sort(function(a, b) {
        return b[1] - a[1];
      }).map(function(entry, idx) {
        var symbol = entry[0];
        var weight = entry[1];
        return React.createElement('div', {
          key: symbol,
          style: {
            display: 'flex',
            alignItems: 'center',
            marginBottom: '0.75rem'
          }
        },
          React.createElement('span', {
            style: { width: '80px', color: theme.text, fontWeight: '600' }
          }, symbol.toUpperCase()),
          React.createElement('div', {
            style: {
              flex: 1,
              height: '8px',
              background: theme.inputBg,
              borderRadius: '4px',
              overflow: 'hidden',
              marginRight: '1rem'
            }
          },
            React.createElement('div', {
              style: {
                width: (weight * 100) + '%',
                height: '100%',
                background: theme.accent,
                borderRadius: '4px'
              }
            })
          ),
          React.createElement('span', {
            style: { width: '50px', textAlign: 'right', color: theme.textSecondary }
          }, (weight * 100).toFixed(1) + '%')
        );
      })
    )
  );
}

// Export
if (typeof window !== 'undefined') {
  window.RiskAnalyticsViewV2 = RiskAnalyticsViewV2;
}
