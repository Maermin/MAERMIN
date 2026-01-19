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
      var metrics = calculatePortfolioRiskMetrics(portfolio, priceHistory, portfolioValue);
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
  
  var getRiskLabel = function(level, lang) {
    var labels = {
      'low': lang === 'de' ? 'Niedrig' : 'Low',
      'medium': lang === 'de' ? 'Mittel' : 'Medium',
      'high': lang === 'de' ? 'Hoch' : 'High',
      'very-high': lang === 'de' ? 'Sehr Hoch' : 'Very High'
    };
    return labels[level] || level;
  };
  
  if (!riskMetrics) {
    return React.createElement('div', {
      style: { padding: '2rem', textAlign: 'center', color: theme.textSecondary }
    }, t.loading || 'Loading...');
  }
  
  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header
    React.createElement('h2', {
      style: { color: theme.text, fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' }
    }, t.riskLevel || 'Risk Analytics'),
    
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
        React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700' } },
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
        React.createElement('div', { style: { color: theme.danger || '#ef4444', fontSize: '1.5rem', fontWeight: '700' } },
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
        React.createElement('div', { style: { color: theme.danger || '#ef4444', fontSize: '1.5rem', fontWeight: '700' } },
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
        React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700' } },
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
        React.createElement('div', { style: { color: theme.danger || '#ef4444', fontSize: '1.5rem', fontWeight: '700' } },
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
