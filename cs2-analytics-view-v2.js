// ============================================================================
// MAERMIN v6.0 - CS2 Analytics View Component
// Visual display of CS2 item metrics
// ============================================================================

function CS2AnalyticsViewV2(props) {
  var portfolio = props.portfolio;
  var prices = props.prices;
  var t = props.t || {};
  var theme = props.theme || {};
  var formatPrice = props.formatPrice || function(v) { return v.toFixed(2); };
  
  var useState = React.useState;
  var useMemo = React.useMemo;
  
  var skins = portfolio.skins || [];
  
  var metrics = useMemo(function() {
    if (typeof calculateCS2Metrics !== 'undefined') {
      return calculateCS2Metrics(skins, {});
    }
    return null;
  }, [skins]);
  
  if (!metrics || skins.length === 0) {
    return React.createElement('div', {
      style: {
        padding: '2rem',
        textAlign: 'center',
        color: theme.textSecondary
      }
    }, t.noPositionsCategory || 'No CS2 items in portfolio');
  }
  
  var getRarityColor = function(rarity) {
    var colors = {
      'consumer': '#b0c3d9',
      'industrial': '#5e98d9',
      'mil-spec': '#4b69ff',
      'restricted': '#8847ff',
      'classified': '#d32ce6',
      'covert': '#eb4b4b',
      'contraband': '#e4ae39',
      'knife': '#e4ae39',
      'gloves': '#e4ae39'
    };
    return colors[rarity] || theme.textSecondary;
  };
  
  var getWearLabel = function(wear) {
    var labels = {
      'fn': 'Factory New',
      'mw': 'Minimal Wear',
      'ft': 'Field-Tested',
      'ww': 'Well-Worn',
      'bs': 'Battle-Scarred'
    };
    return labels[wear] || wear;
  };
  
  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header
    React.createElement('h2', {
      style: { color: theme.text, fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' }
    }, 'CS2 ' + (t.analytics || 'Analytics')),
    
    // Summary Stats
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }
    },
      // Total Value
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          t.totalValue || 'Total Value'
        ),
        React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700' } },
          formatPrice(metrics.totalValue) + ' EUR'
        )
      ),
      
      // Profit
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          t.profitLoss || 'Profit/Loss'
        ),
        React.createElement('div', {
          style: {
            color: metrics.profit >= 0 ? theme.success : theme.danger,
            fontSize: '1.5rem',
            fontWeight: '700'
          }
        }, (metrics.profit >= 0 ? '+' : '') + formatPrice(metrics.profit) + ' EUR'),
        React.createElement('div', {
          style: { color: metrics.profit >= 0 ? theme.success : theme.danger, fontSize: '0.875rem' }
        }, (metrics.profitPercent >= 0 ? '+' : '') + metrics.profitPercent.toFixed(2) + '%')
      ),
      
      // Item Count
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          t.positions || 'Items'
        ),
        React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700' } },
          metrics.itemCount
        )
      ),
      
      // Average Float
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
          'Avg. Float'
        ),
        React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700' } },
          metrics.averageFloat.toFixed(4)
        )
      )
    ),
    
    // Distributions
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }
    },
      // Rarity Distribution
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('h3', {
          style: { color: theme.text, marginBottom: '1rem', fontSize: '1rem' }
        }, 'Rarity Distribution'),
        Object.entries(metrics.rarityDistribution).map(function(entry) {
          var rarity = entry[0];
          var count = entry[1];
          var percentage = (count / metrics.itemCount) * 100;
          return React.createElement('div', {
            key: rarity,
            style: { marginBottom: '0.75rem' }
          },
            React.createElement('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '0.25rem'
              }
            },
              React.createElement('span', { style: { color: getRarityColor(rarity), fontWeight: '500' } },
                rarity.charAt(0).toUpperCase() + rarity.slice(1)
              ),
              React.createElement('span', { style: { color: theme.textSecondary } },
                count + ' (' + percentage.toFixed(0) + '%)'
              )
            ),
            React.createElement('div', {
              style: {
                height: '6px',
                background: theme.inputBg,
                borderRadius: '3px',
                overflow: 'hidden'
              }
            },
              React.createElement('div', {
                style: {
                  width: percentage + '%',
                  height: '100%',
                  background: getRarityColor(rarity),
                  borderRadius: '3px'
                }
              })
            )
          );
        })
      ),
      
      // Wear Distribution
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: '1px solid ' + theme.cardBorder
        }
      },
        React.createElement('h3', {
          style: { color: theme.text, marginBottom: '1rem', fontSize: '1rem' }
        }, 'Wear Distribution'),
        Object.entries(metrics.wearDistribution).map(function(entry) {
          var wear = entry[0];
          var count = entry[1];
          var percentage = (count / metrics.itemCount) * 100;
          return React.createElement('div', {
            key: wear,
            style: { marginBottom: '0.75rem' }
          },
            React.createElement('div', {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '0.25rem'
              }
            },
              React.createElement('span', { style: { color: theme.text, fontWeight: '500' } },
                getWearLabel(wear)
              ),
              React.createElement('span', { style: { color: theme.textSecondary } },
                count + ' (' + percentage.toFixed(0) + '%)'
              )
            ),
            React.createElement('div', {
              style: {
                height: '6px',
                background: theme.inputBg,
                borderRadius: '3px',
                overflow: 'hidden'
              }
            },
              React.createElement('div', {
                style: {
                  width: percentage + '%',
                  height: '100%',
                  background: theme.accent,
                  borderRadius: '3px'
                }
              })
            )
          );
        })
      )
    ),
    
    // Top Items
    metrics.topItems.length > 0 && React.createElement('div', {
      style: {
        background: theme.card,
        padding: '1.25rem',
        borderRadius: '12px',
        border: '1px solid ' + theme.cardBorder,
        marginBottom: '1.5rem'
      }
    },
      React.createElement('h3', {
        style: { color: theme.text, marginBottom: '1rem', fontSize: '1rem' }
      }, t.topPerformers || 'Top Items by Value'),
      metrics.topItems.map(function(item, idx) {
        var value = (item.amount || 1) * (item.currentPrice || item.purchasePrice || 0);
        return React.createElement('div', {
          key: idx,
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem 0',
            borderBottom: idx < metrics.topItems.length - 1 ? '1px solid ' + theme.cardBorder : 'none'
          }
        },
          React.createElement('div', null,
            React.createElement('div', { style: { color: theme.text, fontWeight: '600' } },
              item.name || item.symbol
            ),
            item.floatValue !== undefined && React.createElement('div', {
              style: { color: theme.textSecondary, fontSize: '0.875rem' }
            }, 'Float: ' + item.floatValue.toFixed(6))
          ),
          React.createElement('div', { style: { textAlign: 'right' } },
            React.createElement('div', { style: { color: theme.text, fontWeight: '600' } },
              formatPrice(value) + ' EUR'
            )
          )
        );
      })
    ),
    
    // Recommendations
    metrics.recommendations.length > 0 && React.createElement('div', {
      style: {
        background: theme.card,
        padding: '1.25rem',
        borderRadius: '12px',
        border: '1px solid ' + theme.cardBorder
      }
    },
      React.createElement('h3', {
        style: { color: theme.text, marginBottom: '1rem', fontSize: '1rem' }
      }, t.recommendations || 'Recommendations'),
      metrics.recommendations.map(function(rec, idx) {
        return React.createElement('div', {
          key: idx,
          style: {
            padding: '0.75rem',
            marginBottom: idx < metrics.recommendations.length - 1 ? '0.5rem' : 0,
            background: theme.inputBg,
            borderRadius: '8px',
            borderLeft: '4px solid ' + (rec.type === 'warning' ? theme.warning : theme.accent)
          }
        },
          React.createElement('p', { style: { color: theme.text, margin: 0 } }, rec.message)
        );
      })
    )
  );
}

// Export
if (typeof window !== 'undefined') {
  window.CS2AnalyticsViewV2 = CS2AnalyticsViewV2;
}
