// ============================================================================
// MAERMIN v5.0 - COMPLETE Risk Analytics View
// ============================================================================

window.createRiskAnalyticsView = function(props) {
  try {
    const { safe, currentTheme, getCurrencySymbol, formatPrice, t, language } = props;
    
    // Inline translations for Risk Analytics
    const texts = language === 'de' ? {
      // Main titles
      title: 'Risk Analytics',
      subtitle: 'Umfassende Risikoanalyse deines Portfolios',
      noAssets: 'Keine Assets vorhanden',
      addAssetsPrompt: 'Füge Assets hinzu um Risikoanalyse zu sehen.',
      // Risk sections
      portfolioRiskScore: 'Portfolio Risk Score',
      concentrationRisk: 'Konzentrations-Risiko',
      valueAtRisk: 'Value at Risk (VaR)',
      volatilityMetrics: 'Volatilitäts-Metriken',
      liquidityAnalysis: 'Liquiditäts-Analyse',
      // Risk levels
      highRisk: 'Hohes Risiko',
      mediumRisk: 'Mittleres Risiko',
      lowRisk: 'Niedriges Risiko',
      // Labels
      totalAssets: 'Gesamt Assets',
      portfolioValue: 'Portfolio Wert',
      riskScore: 'Risk Score',
      concentration: 'Konzentration',
      var95: '95% VaR',
      var99: '99% VaR',
      volatility: 'Volatilität',
      liquidity: 'Liquidität',
      // Actions
      recommendations: 'Empfehlungen',
      diversify: 'Diversifizieren',
      monitor: 'Überwachen',
      review: 'Überprüfen',
      // Messages
      wellDiversified: 'Gut diversifiziert',
      needsDiversification: 'Benötigt Diversifikation',
      highConcentration: 'Hohe Konzentration',

      // More labels
      riskFactors: 'Risiko-Faktoren',
      tailRisk: 'Tail Risk - Worst Case Szenario',
      diversificationScore: 'Diversifikations-Score',
      higherScoreBetter: 'Höherer Score = Bessere Diversifikation',
      riskManagement: 'Risk Management Empfehlungen',
      highVolatileAssets: 'Hochvolatile Assets',
      illiquidAssets: 'Illiquide Assets',
      lowLiquidityWarning: 'Diese Assets haben eine niedrige Liquidität und könnten schwierig zu verkaufen sein.',
      errorLoading: 'Fehler beim Laden der Risk Analytics',
      noPositions: 'Keine Positionen vorhanden',
      comprehensiveAnalysis: 'Umfassende Risikoanalyse deines Portfolios mit',
      positions: 'Positionen',
      volatilityMetricsItem: 'Volatilitäts-Metriken',
      liquidityScoring: 'Liquiditäts-Scoring',
      largestPosition: 'Größte Position',
      ofPortfolioInTop3: 'des Portfolios in den größten 3 Positionen',
      dailyMovement: 'Tägliche Bewegung',
      concentratedPortfolio: 'Konzentriertes Portfolio',
      annualizedVolatility: 'Annualisierte Volatilität',
      categoryConcentration: 'Kategorie Konzentration',
      ofPortfolio: 'des Portfolios',
      maxExpectedLoss: 'Max. erwarteter Verlust mit 95% Wahrscheinlichkeit',
      maxExpectedLoss99: 'Max. erwarteter Verlust mit 99% Wahrscheinlichkeit',
      avgVolatility: 'Durchschn. Volatilität',
      highVolatileAssets: 'hochvolatile Assets',
      avgLiquidity: 'Durchschn. Liquidität',
      illiquidAssetsCount: 'illiquide Assets',
      daysToExit: 'Tage bis Exit',
      avgDaysToExit: 'Ø',
      recommendedAction: 'Empfohlene Aktion',
      andMore: 'und',
      moreHighVolAssets: 'weitere hochvolatile Assets',
      positionsLabel: 'Positionen',
      errorOccurred: 'Ein Fehler ist aufgetreten. Bitte prüfe die Browser Console (F12).',
    } : {
      // Main titles
      title: 'Risk Analytics',
      subtitle: 'Comprehensive risk analysis of your portfolio',
      noAssets: 'No assets available',
      addAssetsPrompt: 'Add assets to see risk analysis.',
      // Risk sections
      portfolioRiskScore: 'Portfolio Risk Score',
      concentrationRisk: 'Concentration Risk',
      valueAtRisk: 'Value at Risk (VaR)',
      volatilityMetrics: 'Volatility Metrics',
      liquidityAnalysis: 'Liquidity Analysis',
      // Risk levels
      highRisk: 'High Risk',
      mediumRisk: 'Medium Risk',
      lowRisk: 'Low Risk',
      // Labels
      totalAssets: 'Total Assets',
      portfolioValue: 'Portfolio Value',
      riskScore: 'Risk Score',
      concentration: 'Concentration',
      var95: '95% VaR',
      var99: '99% VaR',
      volatility: 'Volatility',
      liquidity: 'Liquidity',
      // Actions
      recommendations: 'Recommendations',
      diversify: 'Diversify',
      monitor: 'Monitor',
      review: 'Review',
      // Messages
      wellDiversified: 'Well diversified',
      needsDiversification: 'Needs diversification',
      highConcentration: 'High concentration',

      // More labels
      riskFactors: 'Risk Factors',
      tailRisk: 'Tail Risk - Worst Case Scenario',
      diversificationScore: 'Diversification Score',
      higherScoreBetter: 'Higher Score = Better Diversification',
      riskManagement: 'Risk Management Recommendations',
      highVolatileAssets: 'High Volatile Assets',
      illiquidAssets: 'Illiquid Assets',
      lowLiquidityWarning: 'These assets have low liquidity and could be difficult to sell.',
      errorLoading: 'Error loading Risk Analytics',
      noPositions: 'No positions available',
      comprehensiveAnalysis: 'Comprehensive risk analysis of your portfolio with',
      positions: 'positions',
      volatilityMetricsItem: 'Volatility Metrics',
      liquidityScoring: 'Liquidity Scoring',
      largestPosition: 'Largest Position',
      ofPortfolioInTop3: 'of portfolio in top 3 positions',
      dailyMovement: 'Daily Movement',
      concentratedPortfolio: 'Concentrated Portfolio',
      annualizedVolatility: 'Annualized Volatility',
      categoryConcentration: 'Category Concentration',
      ofPortfolio: 'of portfolio',
      maxExpectedLoss: 'Max. expected loss with 95% probability',
      maxExpectedLoss99: 'Max. expected loss with 99% probability',
      avgVolatility: 'Avg. Volatility',
      highVolatileAssets: 'high volatile assets',
      avgLiquidity: 'Avg. Liquidity',
      illiquidAssetsCount: 'illiquid assets',
      daysToExit: 'days to exit',
      avgDaysToExit: 'Avg.',
      recommendedAction: 'Recommended Action',
      andMore: 'and',
      moreHighVolAssets: 'more high volatile assets',
      positionsLabel: 'Positions',
      errorOccurred: 'An error occurred. Please check Browser Console (F12).',
    };
    
    // Safety check
    if (!safe) {
      return React.createElement('div', { 
        style: { 
          textAlign: 'center', 
          padding: '4rem 2rem', 
          color: currentTheme.textSecondary 
        } 
      },
        React.createElement('h3', { 
          style: { 
            fontSize: '1.5rem', 
            color: currentTheme.text 
          } 
        }, 'Fehler: Keine Daten verfügbar')
      );
    }
  
  // Combine all positions from all categories
  const allPositions = [...safe.crypto, ...safe.stocks, ...safe.skins];
  
  // ========== EMPTY STATE ==========
  if (allPositions.length === 0) {
    return React.createElement('div', { 
      style: { 
        textAlign: 'center', 
        padding: '4rem 2rem', 
        color: currentTheme.textSecondary,
        maxWidth: '600px',
        margin: '0 auto'
      } 
    },
      React.createElement('div', { 
        style: { 
          fontSize: '4rem', 
          marginBottom: '1rem', 
          opacity: 0.2 
        } 
      }, '[RISK]'),
      React.createElement('h3', { 
        style: { 
          fontSize: '1.75rem', 
          marginBottom: '1rem', 
          color: currentTheme.text,
          fontWeight: '600'
        } 
      }, texts.noPositions),
      React.createElement('p', { 
        style: { 
          fontSize: '1.1rem',
          lineHeight: 1.6,
          marginBottom: '2rem'
        } 
      }, texts.addAssetsPrompt + ' Du erhältst dann:'),
      React.createElement('div', { 
        style: { 
          textAlign: 'left',
          display: 'inline-block',
          marginTop: '1.5rem'
        } 
      },
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• ' + texts.portfolioRiskScore),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• ' + texts.valueAtRisk + ' Berechnungen'),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• Diversifikations-Analyse'),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• ' + texts.volatilityMetricsItem),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• ' + texts.liquidityScoring),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• Konzentrations-Risiko Analyse'),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• Personalisierte Empfehlungen')
      )
    );
  }
  
  // ========== CACHING SYSTEM TO PREVENT RE-CALCULATION ON LANGUAGE CHANGE ==========
  // Create cache key from position data (not language)
  // Use symbol and amount only - not prices which may fluctuate
  const cacheKey = allPositions.map(p => 
    `${p.symbol || p.name}-${p.amount}`
  ).sort().join('|'); // Sort to ensure consistent order
  
  // Add position count to cache key to detect additions/removals
  const fullCacheKey = `${cacheKey}-${allPositions.length}`;
  
  // Initialize cache if doesn't exist
  if (!window.riskAnalyticsCache) {
    window.riskAnalyticsCache = { key: null };
  }
  
  // ========== CALCULATE ALL RISK METRICS ==========
  let concentration, var95, var99, withVolatility, withLiquidity, riskScore;
  
  // Check if we can use cached values
  const cacheValid = window.riskAnalyticsCache.key === fullCacheKey;
  
  if (cacheValid) {
    // Load from cache
    console.log('[Risk Analytics] ✓ Using cached values (no recalculation needed)');
    concentration = window.riskAnalyticsCache.concentration;
    var95 = window.riskAnalyticsCache.var95;
    var99 = window.riskAnalyticsCache.var99;
    withVolatility = window.riskAnalyticsCache.withVolatility;
    withLiquidity = window.riskAnalyticsCache.withLiquidity;
    riskScore = window.riskAnalyticsCache.riskScore;
  } else {
    console.log('[Risk Analytics] Calculating new values (cache miss or data changed)');
    
  try {
    concentration = window.analyzeConcentration ? window.analyzeConcentration(allPositions) : { 
      diversificationScore: 0, 
      singlePosition: { max: 0, position: 'N/A' },
      topThree: { total: 0, positions: [], risk: 'low' },
      category: { breakdown: { crypto: {count: 0, percent: 0, value: 0}, stocks: {count: 0, percent: 0, value: 0}, skins: {count: 0, percent: 0, value: 0} } }
    };
  } catch (e) {
    console.error('Concentration Analysis Error:', e);
    concentration = { 
      diversificationScore: 0, 
      singlePosition: { max: 0, position: 'N/A' },
      topThree: { total: 0, positions: [], risk: 'low' },
      category: { breakdown: { crypto: {count: 0, percent: 0, value: 0}, stocks: {count: 0, percent: 0, value: 0}, skins: {count: 0, percent: 0, value: 0} } }
    };
  }
  
  try {
    var95 = window.calculateValueAtRisk ? window.calculateValueAtRisk(allPositions, 0.95, 1) : { var: 0, varPercent: 0 };
  } catch (e) {
    console.error('VaR 95 Error:', e);
    var95 = { var: 0, varPercent: 0 };
  }
  
  try {
    var99 = window.calculateValueAtRisk ? window.calculateValueAtRisk(allPositions, 0.99, 1) : { var: 0, varPercent: 0 };
  } catch (e) {
    console.error('VaR 99 Error:', e);
    var99 = { var: 0, varPercent: 0 };
  }
  
  try {
    withVolatility = window.calculateVolatilityMetrics ? window.calculateVolatilityMetrics(allPositions) : allPositions;
  } catch (e) {
    console.error('Volatility Error:', e);
    withVolatility = allPositions;
  }
  
  try {
    withLiquidity = window.calculateLiquidityScores ? window.calculateLiquidityScores(allPositions) : allPositions;
  } catch (e) {
    console.error('Liquidity Error:', e);
    withLiquidity = allPositions;
  }
  
  try {
    riskScore = window.calculatePortfolioRiskScore ? window.calculatePortfolioRiskScore(concentration, var95, withVolatility, withLiquidity) : {
      overallScore: 50,
      rating: texts.mediumRisk,
      color: '#f59e0b',
      factors: { concentration: 50, var: 50, volatility: 50, liquidity: 50 },
      recommendations: []
    };
  } catch (e) {
    console.error('Risk Score Error:', e);
    riskScore = {
      overallScore: 50,
      rating: texts.mediumRisk,
      color: '#f59e0b',
      factors: { concentration: 50, var: 50, volatility: 50, liquidity: 50 },
      recommendations: []
    };
  }
  
    // Save to cache
    window.riskAnalyticsCache = {
      key: fullCacheKey,
      concentration: concentration,
      var95: var95,
      var99: var99,
      withVolatility: withVolatility,
      withLiquidity: withLiquidity,
      riskScore: riskScore
    };
    console.log('[Risk Analytics] ✓ Values cached successfully for key:', fullCacheKey);
  } // End of if (!cacheValid)
  
  // DEBUG LOGGING
  console.log('[Risk Analytics Debug]');
  console.log('Positions:', allPositions.length);
  console.log('VaR 95:', var95);
  console.log('  -> var95.var:', var95 ? var95.var : 'undefined');
  console.log('  -> var95.varPercent:', var95 ? var95.varPercent : 'undefined');
  console.log('VaR 99:', var99);
  console.log('  -> var99.var:', var99 ? var99.var : 'undefined');
  console.log('  -> var99.varPercent:', var99 ? var99.varPercent : 'undefined');
  console.log('Concentration:', concentration);
  console.log('  -> diversificationScore:', concentration ? concentration.diversificationScore : 'undefined');
  console.log('  -> singlePosition:', concentration ? concentration.singlePosition : 'undefined');
  console.log('  -> topThree:', concentration ? concentration.topThree : 'undefined');
  console.log('  -> category:', concentration ? concentration.category : 'undefined');
  console.log('Backend Functions Available:');
  console.log('  -> window.calculateValueAtRisk:', typeof window.calculateValueAtRisk);
  console.log('  -> window.analyzeConcentration:', typeof window.analyzeConcentration);
  console.log('First Position Sample:', allPositions[0]);
  
  // Calculate average volatility across portfolio
  const avgVolatility = withVolatility.reduce((sum, p) => 
    sum + (p.volatility ? p.volatility.annualized : 0), 0) / Math.max(withVolatility.length, 1);
  
  // Calculate average liquidity score
  const avgLiquidity = withLiquidity.reduce((sum, p) => 
    sum + (p.liquidity ? p.liquidity.score : 0), 0) / Math.max(withLiquidity.length, 1);
  
  // Calculate average days to exit
  const avgDaysToExit = withLiquidity.reduce((sum, p) => 
    sum + (p.liquidity ? p.liquidity.daysToExit : 0), 0) / Math.max(withLiquidity.length, 1);
  
  // Find illiquid assets (poor rating)
  const illiquidAssets = withLiquidity.filter(p => p.liquidity && p.liquidity.rating === 'poor');
  
  // Find high volatility assets
  const highVolAssets = withVolatility.filter(p => p.volatility && p.volatility.regime === 'high');
  
  // ========== RENDER MAIN VIEW ==========
  return React.createElement('div', { 
    style: { 
      animation: 'fadeIn 0.3s ease-in' 
    } 
  },
    
    // ========== HEADER ==========
    React.createElement('div', { 
      style: { 
        marginBottom: '2rem' 
      } 
    },
      React.createElement('h2', { 
        style: { 
          color: currentTheme.text, 
          fontSize: '2.25rem', 
          marginBottom: '0.5rem', 
          fontWeight: '700',
          letterSpacing: '-0.025em'
        } 
      }, texts.title),
      React.createElement('p', { 
        style: { 
          color: currentTheme.textSecondary,
          fontSize: '1rem'
        } 
      }, texts.comprehensiveAnalysis + ' ' + allPositions.length + ' ' + texts.positions)
    ),
    
    // ========== MAIN RISK SCORE CARD ==========
    React.createElement('div', { 
      style: { 
        background: currentTheme.card, 
        borderRadius: '1.25rem', 
        padding: '2.5rem', 
        marginBottom: '2rem',
        border: `3px solid ${riskScore.color}`,
        boxShadow: `0 8px 32px ${riskScore.color}30`,
        position: 'relative',
        overflow: 'hidden'
      } 
    },
      // Background gradient effect
      React.createElement('div', { 
        style: { 
          position: 'absolute',
          top: 0,
          right: 0,
          width: '300px',
          height: '300px',
          background: `radial-gradient(circle, ${riskScore.color}15 0%, transparent 70%)`,
          pointerEvents: 'none'
        } 
      }),
      
      React.createElement('div', { 
        style: { 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '2rem',
          position: 'relative'
        } 
      },
        // Left side - Score display
        React.createElement('div', { 
          style: { 
            flex: '0 0 auto' 
          } 
        },
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              color: currentTheme.textSecondary,
              marginBottom: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: '600'
            } 
          }, texts.portfolioRiskScore),
          React.createElement('div', { 
            style: { 
              fontSize: '5rem', 
              fontWeight: 'bold', 
              color: riskScore.color,
              lineHeight: 0.9,
              marginBottom: '0.75rem'
            } 
          }, riskScore.overallScore),
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              color: currentTheme.textSecondary,
              marginBottom: '0.5rem'
            } 
          }, 'von 100'),
          React.createElement('div', { 
            style: { 
              display: 'inline-block',
              padding: '0.5rem 1rem',
              background: riskScore.color,
              color: 'white',
              borderRadius: '0.5rem',
              fontSize: '1.125rem',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.025em',
              marginTop: '0.5rem'
            } 
          }, riskScore.rating)
        ),
        
        // Right side - Risk factors breakdown
        React.createElement('div', { 
          style: { 
            flex: '1 1 auto',
            minWidth: '280px'
          } 
        },
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              color: currentTheme.textSecondary,
              marginBottom: '1rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: '600'
            } 
          }, texts.riskFactors),
          React.createElement('div', { 
            style: { 
              display: 'grid', 
              gridTemplateColumns: 'repeat(2, 1fr)', 
              gap: '1.25rem' 
            } 
          },
            // Concentration Factor
            React.createElement('div', { 
              style: { 
                background: currentTheme.inputBg,
                padding: '1rem',
                borderRadius: '0.75rem'
              } 
            },
              React.createElement('div', { 
                style: { 
                  fontSize: '0.75rem', 
                  color: currentTheme.textSecondary, 
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                } 
              }, texts.concentration),
              React.createElement('div', { 
                style: { 
                  fontSize: '2rem', 
                  fontWeight: 'bold', 
                  color: currentTheme.text 
                } 
              }, Math.round(riskScore.factors.concentration)),
              React.createElement('div', { 
                style: { 
                  marginTop: '0.5rem',
                  height: '6px',
                  background: currentTheme.card,
                  borderRadius: '3px',
                  overflow: 'hidden'
                } 
              },
                React.createElement('div', { 
                  style: { 
                    width: Math.round(riskScore.factors.concentration) + '%',
                    height: '100%',
                    background: riskScore.factors.concentration > 60 ? '#ef4444' : 
                               riskScore.factors.concentration > 40 ? '#f59e0b' : '#10b981',
                    transition: 'width 0.3s'
                  } 
                })
              )
            ),
            
            // VaR Factor
            React.createElement('div', { 
              style: { 
                background: currentTheme.inputBg,
                padding: '1rem',
                borderRadius: '0.75rem'
              } 
            },
              React.createElement('div', { 
                style: { 
                  fontSize: '0.75rem', 
                  color: currentTheme.textSecondary, 
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                } 
              }, 'VaR ' + texts.riskScore),
              React.createElement('div', { 
                style: { 
                  fontSize: '2rem', 
                  fontWeight: 'bold', 
                  color: currentTheme.text 
                } 
              }, Math.round(riskScore.factors.var)),
              React.createElement('div', { 
                style: { 
                  marginTop: '0.5rem',
                  height: '6px',
                  background: currentTheme.card,
                  borderRadius: '3px',
                  overflow: 'hidden'
                } 
              },
                React.createElement('div', { 
                  style: { 
                    width: Math.round(riskScore.factors.var) + '%',
                    height: '100%',
                    background: riskScore.factors.var > 60 ? '#ef4444' : 
                               riskScore.factors.var > 40 ? '#f59e0b' : '#10b981',
                    transition: 'width 0.3s'
                  } 
                })
              )
            ),
            
            // Volatility Factor
            React.createElement('div', { 
              style: { 
                background: currentTheme.inputBg,
                padding: '1rem',
                borderRadius: '0.75rem'
              } 
            },
              React.createElement('div', { 
                style: { 
                  fontSize: '0.75rem', 
                  color: currentTheme.textSecondary, 
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                } 
              }, texts.volatility),
              React.createElement('div', { 
                style: { 
                  fontSize: '2rem', 
                  fontWeight: 'bold', 
                  color: currentTheme.text 
                } 
              }, Math.round(riskScore.factors.volatility)),
              React.createElement('div', { 
                style: { 
                  marginTop: '0.5rem',
                  height: '6px',
                  background: currentTheme.card,
                  borderRadius: '3px',
                  overflow: 'hidden'
                } 
              },
                React.createElement('div', { 
                  style: { 
                    width: Math.round(riskScore.factors.volatility) + '%',
                    height: '100%',
                    background: riskScore.factors.volatility > 60 ? '#ef4444' : 
                               riskScore.factors.volatility > 40 ? '#f59e0b' : '#10b981',
                    transition: 'width 0.3s'
                  } 
                })
              )
            ),
            
            // Liquidity Factor
            React.createElement('div', { 
              style: { 
                background: currentTheme.inputBg,
                padding: '1rem',
                borderRadius: '0.75rem'
              } 
            },
              React.createElement('div', { 
                style: { 
                  fontSize: '0.75rem', 
                  color: currentTheme.textSecondary, 
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                } 
              }, texts.liquidity),
              React.createElement('div', { 
                style: { 
                  fontSize: '2rem', 
                  fontWeight: 'bold', 
                  color: currentTheme.text 
                } 
              }, Math.round(riskScore.factors.liquidity)),
              React.createElement('div', { 
                style: { 
                  marginTop: '0.5rem',
                  height: '6px',
                  background: currentTheme.card,
                  borderRadius: '3px',
                  overflow: 'hidden'
                } 
              },
                React.createElement('div', { 
                  style: { 
                    width: Math.round(riskScore.factors.liquidity) + '%',
                    height: '100%',
                    background: riskScore.factors.liquidity > 60 ? '#ef4444' : 
                               riskScore.factors.liquidity > 40 ? '#f59e0b' : '#10b981',
                    transition: 'width 0.3s'
                  } 
                })
              )
            )
          )
        )
      )
    ),
    
    // ========== VAR & KEY METRICS GRID ==========
    React.createElement('div', { 
      style: { 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
        gap: '1.5rem', 
        marginBottom: '2rem' 
      } 
    },
      
      // VaR 95% Card
      React.createElement('div', { 
        style: { 
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', 
          borderRadius: '1rem', 
          padding: '1.75rem', 
          color: 'white',
          position: 'relative',
          overflow: 'hidden'
        } 
      },
        React.createElement('div', { 
          style: { 
            position: 'absolute',
            top: '-20px',
            right: '-20px',
            width: '80px',
            height: '80px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '50%'
          } 
        }),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.9, 
            marginBottom: '0.75rem',
            fontWeight: '600',
            position: 'relative'
          } 
        }, texts.var95),
        React.createElement('div', { 
          style: { 
            fontSize: '2.25rem', 
            fontWeight: 'bold',
            marginBottom: '0.5rem',
            position: 'relative'
          } 
        }, getCurrencySymbol() + formatPrice(var95.var)),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.85,
            position: 'relative'
          } 
        }, var95.varPercent.toFixed(2) + '% ' + texts.ofPortfolio),
        React.createElement('div', { 
          style: { 
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid rgba(255,255,255,0.2)',
            fontSize: '0.75rem',
            opacity: 0.8,
            position: 'relative'
          } 
        }, texts.maxExpectedLoss)
      ),
      
      // VaR 99% Card
      React.createElement('div', { 
        style: { 
          background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)', 
          borderRadius: '1rem', 
          padding: '1.75rem', 
          color: 'white',
          position: 'relative',
          overflow: 'hidden'
        } 
      },
        React.createElement('div', { 
          style: { 
            position: 'absolute',
            top: '-20px',
            right: '-20px',
            width: '80px',
            height: '80px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '50%'
          } 
        }),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.9, 
            marginBottom: '0.75rem',
            fontWeight: '600',
            position: 'relative'
          } 
        }, texts.var99),
        React.createElement('div', { 
          style: { 
            fontSize: '2.25rem', 
            fontWeight: 'bold',
            marginBottom: '0.5rem',
            position: 'relative'
          } 
        }, getCurrencySymbol() + formatPrice(var99.var)),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.85,
            position: 'relative'
          } 
        }, var99.varPercent.toFixed(2) + '% ' + texts.ofPortfolio),
        React.createElement('div', { 
          style: { 
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid rgba(255,255,255,0.2)',
            fontSize: '0.75rem',
            opacity: 0.8,
            position: 'relative'
          } 
        }, texts.tailRisk)
      ),
      
      // Diversification Card
      React.createElement('div', { 
        style: { 
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', 
          borderRadius: '1rem', 
          padding: '1.75rem', 
          color: 'white',
          position: 'relative',
          overflow: 'hidden'
        } 
      },
        React.createElement('div', { 
          style: { 
            position: 'absolute',
            top: '-20px',
            right: '-20px',
            width: '80px',
            height: '80px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '50%'
          } 
        }),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.9, 
            marginBottom: '0.75rem',
            fontWeight: '600',
            position: 'relative'
          } 
        }, texts.diversificationScore),
        React.createElement('div', { 
          style: { 
            fontSize: '2.25rem', 
            fontWeight: 'bold',
            marginBottom: '0.5rem',
            position: 'relative'
          } 
        }, concentration.diversificationScore + '/100'),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.85,
            position: 'relative'
          } 
        }, 
          concentration.diversificationScore >= 70 ? 'Sehr gut diversifiziert' : 
          concentration.diversificationScore >= 50 ? 'Moderat diversifiziert' : 
          texts.concentratedPortfolio
        ),
        React.createElement('div', { 
          style: { 
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid rgba(255,255,255,0.2)',
            fontSize: '0.75rem',
            opacity: 0.8,
            position: 'relative'
          } 
        }, texts.higherScoreBetter)
      ),
      
      // Largest Position Card
      React.createElement('div', { 
        style: { 
          background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', 
          borderRadius: '1rem', 
          padding: '1.75rem', 
          color: 'white',
          position: 'relative',
          overflow: 'hidden'
        } 
      },
        React.createElement('div', { 
          style: { 
            position: 'absolute',
            top: '-20px',
            right: '-20px',
            width: '80px',
            height: '80px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '50%'
          } 
        }),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.9, 
            marginBottom: '0.75rem',
            fontWeight: '600',
            position: 'relative'
          } 
        }, texts.largestPosition),
        React.createElement('div', { 
          style: { 
            fontSize: '2.25rem', 
            fontWeight: 'bold',
            marginBottom: '0.5rem',
            position: 'relative'
          } 
        }, concentration.singlePosition.max.toFixed(1) + '%'),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.85,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            position: 'relative'
          } 
        }, concentration.singlePosition.position || 'N/A'),
        React.createElement('div', { 
          style: { 
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid rgba(255,255,255,0.2)',
            fontSize: '0.75rem',
            opacity: 0.8,
            position: 'relative'
          } 
        }, 'Empfohlen: < 25% pro Position')
      ),
      
      // Average Volatility Card
      React.createElement('div', { 
        style: { 
          background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
          borderRadius: '1rem', 
          padding: '1.75rem', 
          color: 'white',
          position: 'relative',
          overflow: 'hidden'
        } 
      },
        React.createElement('div', { 
          style: { 
            position: 'absolute',
            top: '-20px',
            right: '-20px',
            width: '80px',
            height: '80px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '50%'
          } 
        }),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.9, 
            marginBottom: '0.75rem',
            fontWeight: '600',
            position: 'relative'
          } 
        }, texts.avgVolatility),
        React.createElement('div', { 
          style: { 
            fontSize: '2.25rem', 
            fontWeight: 'bold',
            marginBottom: '0.5rem',
            position: 'relative'
          } 
        }, Math.round(avgVolatility) + '%'),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.85,
            position: 'relative'
          } 
        }, highVolAssets.length + ' ' + texts.highVolatileAssets),
        React.createElement('div', { 
          style: { 
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid rgba(255,255,255,0.2)',
            fontSize: '0.75rem',
            opacity: 0.8,
            position: 'relative'
          } 
        }, texts.annualizedVolatility)
      ),
      
      // Average Liquidity Card
      React.createElement('div', { 
        style: { 
          background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)', 
          borderRadius: '1rem', 
          padding: '1.75rem', 
          color: 'white',
          position: 'relative',
          overflow: 'hidden'
        } 
      },
        React.createElement('div', { 
          style: { 
            position: 'absolute',
            top: '-20px',
            right: '-20px',
            width: '80px',
            height: '80px',
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '50%'
          } 
        }),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.9, 
            marginBottom: '0.75rem',
            fontWeight: '600',
            position: 'relative'
          } 
        }, texts.avgLiquidity),
        React.createElement('div', { 
          style: { 
            fontSize: '2.25rem', 
            fontWeight: 'bold',
            marginBottom: '0.5rem',
            position: 'relative'
          } 
        }, Math.round(avgLiquidity) + '/100'),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem', 
            opacity: 0.85,
            position: 'relative'
          } 
        }, illiquidAssets.length + ' ' + texts.illiquidAssetsCount),
        React.createElement('div', { 
          style: { 
            marginTop: '1rem',
            paddingTop: '1rem',
            borderTop: '1px solid rgba(255,255,255,0.2)',
            fontSize: '0.75rem',
            opacity: 0.8,
            position: 'relative'
          } 
        }, texts.avgDaysToExit + ' ' + avgDaysToExit.toFixed(1) + ' ' + texts.daysToExit)
      )
    ),
    
    // ========== RECOMMENDATIONS SECTION ==========
    riskScore.recommendations.length > 0 && React.createElement('div', { 
      style: { 
        background: currentTheme.card, 
        borderRadius: '1rem', 
        padding: '2rem',
        marginBottom: '2rem',
        border: `1px solid ${currentTheme.cardBorder}`
      } 
    },
      React.createElement('div', { 
        style: { 
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem'
        } 
      },
        React.createElement('div', { 
          style: { 
            width: '4px',
            height: '28px',
            background: 'linear-gradient(180deg, #3b82f6, #8b5cf6)',
            borderRadius: '2px'
          } 
        }),
        React.createElement('h3', { 
          style: { 
            color: currentTheme.text, 
            fontSize: '1.5rem',
            fontWeight: '600',
            margin: 0
          } 
        }, texts.riskManagement)
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'grid',
          gap: '1rem'
        } 
      },
        riskScore.recommendations.map((rec, idx) => 
          React.createElement('div', { 
            key: idx,
            style: { 
              background: currentTheme.inputBg, 
              borderLeft: '4px solid ' + (
                rec.severity === 'high' ? '#ef4444' : 
                rec.severity === 'medium' ? '#f59e0b' : '#3b82f6'
              ),
              padding: '1.25rem', 
              borderRadius: '0.75rem',
              transition: 'transform 0.2s',
              cursor: 'default'
            } 
          },
            React.createElement('div', { 
              style: { 
                display: 'flex',
                alignItems: 'flex-start',
                gap: '1rem',
                marginBottom: '0.75rem'
              } 
            },
              React.createElement('span', { 
                style: { 
                  padding: '0.375rem 0.75rem',
                  background: rec.severity === 'high' ? '#ef4444' : 
                             rec.severity === 'medium' ? '#f59e0b' : '#3b82f6',
                  color: 'white',
                  borderRadius: '0.375rem',
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  fontWeight: 'bold',
                  letterSpacing: '0.025em',
                  flexShrink: 0
                } 
              }, rec.severity),
              React.createElement('div', { 
                style: { 
                  color: currentTheme.text, 
                  fontWeight: '600',
                  fontSize: '1.05rem',
                  lineHeight: 1.5,
                  flex: 1
                } 
              }, rec.message)
            ),
            React.createElement('div', { 
              style: { 
                color: currentTheme.textSecondary, 
                fontSize: '0.9375rem',
                lineHeight: 1.6,
                paddingLeft: '1rem',
                borderLeft: '2px solid ' + currentTheme.cardBorder
              } 
            }, 
              React.createElement('strong', { style: { color: currentTheme.text } }, texts.recommendedAction + ': '),
              rec.action
            )
          )
        )
      )
    ),
    
    // ========== CATEGORY CONCENTRATION BREAKDOWN ==========
    React.createElement('div', { 
      style: { 
        background: currentTheme.card, 
        borderRadius: '1rem', 
        padding: '2rem',
        marginBottom: '2rem',
        border: `1px solid ${currentTheme.cardBorder}`
      } 
    },
      React.createElement('div', { 
        style: { 
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem'
        } 
      },
        React.createElement('div', { 
          style: { 
            width: '4px',
            height: '28px',
            background: 'linear-gradient(180deg, #10b981, #059669)',
            borderRadius: '2px'
          } 
        }),
        React.createElement('h3', { 
          style: { 
            color: currentTheme.text, 
            fontSize: '1.5rem',
            fontWeight: '600',
            margin: 0
          } 
        }, texts.categoryConcentration)
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
          gap: '1.25rem' 
        } 
      },
        Object.entries(concentration.category.breakdown)
          .filter(([cat, data]) => data.count > 0)
          .map(([cat, data]) => {
            const catColor = cat === 'crypto' ? '#3b82f6' : 
                           cat === 'stocks' ? '#10b981' : 
                           cat === 'skins' ? '#8b5cf6' : '#64748b';
            
            return React.createElement('div', { 
              key: cat,
              style: { 
                background: currentTheme.inputBg, 
                padding: '1.5rem', 
                borderRadius: '0.75rem',
                borderLeft: `5px solid ${catColor}`,
                position: 'relative',
                overflow: 'hidden'
              } 
            },
              React.createElement('div', { 
                style: { 
                  position: 'absolute',
                  top: '0',
                  right: '0',
                  width: '60px',
                  height: '60px',
                  background: catColor + '10',
                  borderRadius: '0 0 0 100%'
                } 
              }),
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary, 
                  fontWeight: '600', 
                  marginBottom: '0.75rem',
                  textTransform: 'uppercase',
                  fontSize: '0.875rem',
                  letterSpacing: '0.05em',
                  position: 'relative'
                } 
              }, cat),
              React.createElement('div', { 
                style: { 
                  color: currentTheme.text, 
                  fontSize: '2.5rem', 
                  fontWeight: 'bold',
                  lineHeight: 1,
                  marginBottom: '0.5rem',
                  position: 'relative'
                } 
              }, data.percent.toFixed(1) + '%'),
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary, 
                  fontSize: '0.875rem',
                  marginBottom: '1rem',
                  position: 'relative'
                } 
              }, 
                data.count + ' Position' + (data.count !== 1 ? 'en' : ''),
                ' • ',
                getCurrencySymbol() + formatPrice(data.value)
              ),
              React.createElement('div', { 
                style: { 
                  height: '8px',
                  background: currentTheme.card,
                  borderRadius: '4px',
                  overflow: 'hidden',
                  position: 'relative'
                } 
              },
                React.createElement('div', { 
                  style: { 
                    width: data.percent + '%',
                    height: '100%',
                    background: catColor,
                    transition: 'width 0.3s'
                  } 
                })
              )
            );
          })
      ),
      
      // Top 3 Concentration Info
      React.createElement('div', { 
        style: { 
          marginTop: '1.5rem',
          padding: '1.25rem',
          background: currentTheme.inputBg,
          borderRadius: '0.75rem'
        } 
      },
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem',
            color: currentTheme.textSecondary,
            marginBottom: '0.75rem',
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          } 
        }, 'Top 3 Positionen'),
        React.createElement('div', { 
          style: { 
            fontSize: '2rem',
            fontWeight: 'bold',
            color: currentTheme.text,
            marginBottom: '0.5rem'
          } 
        }, concentration.topThree.total.toFixed(1) + '%'),
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem',
            color: currentTheme.textSecondary
          } 
        }, 
          texts.ofPortfolioInTop3,
          concentration.topThree.risk === 'high' ? 
            React.createElement('span', { 
              style: { 
                marginLeft: '0.5rem',
                padding: '0.25rem 0.5rem',
                background: '#ef4444',
                color: 'white',
                borderRadius: '0.25rem',
                fontSize: '0.75rem',
                fontWeight: 'bold'
              } 
            }, 'HOCH') : null
        ),
        React.createElement('div', { 
          style: { 
            marginTop: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          } 
        },
          concentration.topThree.positions.map((pos, idx) => 
            React.createElement('div', { 
              key: idx,
              style: { 
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5rem 0',
                borderBottom: idx < concentration.topThree.positions.length - 1 ? 
                  `1px solid ${currentTheme.cardBorder}` : 'none'
              } 
            },
              React.createElement('span', { 
                style: { 
                  color: currentTheme.text,
                  fontWeight: '500'
                } 
              }, (idx + 1) + '. ' + pos.symbol),
              React.createElement('span', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontWeight: '600'
                } 
              }, pos.percent.toFixed(1) + '%')
            )
          )
        )
      )
    ),
    
    // ========== VOLATILITY DETAILS ==========
    highVolAssets.length > 0 && React.createElement('div', { 
      style: { 
        background: currentTheme.card, 
        borderRadius: '1rem', 
        padding: '2rem',
        marginBottom: '2rem',
        border: `1px solid ${currentTheme.cardBorder}`
      } 
    },
      React.createElement('div', { 
        style: { 
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem'
        } 
      },
        React.createElement('div', { 
          style: { 
            width: '4px',
            height: '28px',
            background: 'linear-gradient(180deg, #ef4444, #dc2626)',
            borderRadius: '2px'
          } 
        }),
        React.createElement('h3', { 
          style: { 
            color: currentTheme.text, 
            fontSize: '1.5rem',
            fontWeight: '600',
            margin: 0
          } 
        }, texts.highVolatileAssets + ' (' + highVolAssets.length + ')')
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'grid',
          gap: '1rem'
        } 
      },
        highVolAssets.slice(0, 5).map((asset, idx) => 
          React.createElement('div', { 
            key: idx,
            style: { 
              background: currentTheme.inputBg,
              padding: '1.25rem',
              borderRadius: '0.75rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem'
            } 
          },
            React.createElement('div', { style: { flex: '1 1 auto' } },
              React.createElement('div', { 
                style: { 
                  color: currentTheme.text,
                  fontWeight: '600',
                  fontSize: '1.125rem',
                  marginBottom: '0.25rem'
                } 
              }, asset.symbol || asset.name),
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontSize: '0.875rem'
                } 
              }, asset.category.toUpperCase())
            ),
            React.createElement('div', { 
              style: { 
                textAlign: 'right'
              } 
            },
              React.createElement('div', { 
                style: { 
                  color: '#ef4444',
                  fontWeight: 'bold',
                  fontSize: '1.5rem',
                  marginBottom: '0.25rem'
                } 
              }, asset.volatility.annualized + '%'),
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontSize: '0.75rem',
                  textTransform: 'uppercase'
                } 
              }, asset.volatility.regime)
            ),
            React.createElement('div', { 
              style: { 
                padding: '0.5rem 1rem',
                background: currentTheme.card,
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                color: currentTheme.textSecondary
              } 
            }, texts.dailyMovement + ': ±' + asset.volatility.dailyExpectedMove + '%')
          )
        ),
        highVolAssets.length > 5 && React.createElement('div', { 
          style: { 
            textAlign: 'center',
            padding: '1rem',
            color: currentTheme.textSecondary,
            fontSize: '0.875rem'
          } 
        }, '... ' + texts.andMore + ' ' + (highVolAssets.length - 5) + ' ' + texts.moreHighVolAssets)
      )
    ),
    
    // ========== ILLIQUID ASSETS ==========
    illiquidAssets.length > 0 && React.createElement('div', { 
      style: { 
        background: currentTheme.card, 
        borderRadius: '1rem', 
        padding: '2rem',
        border: `1px solid ${currentTheme.cardBorder}`
      } 
    },
      React.createElement('div', { 
        style: { 
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem'
        } 
      },
        React.createElement('div', { 
          style: { 
            width: '4px',
            height: '28px',
            background: 'linear-gradient(180deg, #f59e0b, #d97706)',
            borderRadius: '2px'
          } 
        }),
        React.createElement('h3', { 
          style: { 
            color: currentTheme.text, 
            fontSize: '1.5rem',
            fontWeight: '600',
            margin: 0
          } 
        }, texts.illiquidAssets + ' (' + illiquidAssets.length + ')')
      ),
      
      React.createElement('div', { 
        style: { 
          marginBottom: '1.5rem',
          padding: '1rem',
          background: currentTheme.inputBg,
          borderRadius: '0.75rem',
          fontSize: '0.9375rem',
          color: currentTheme.textSecondary,
          lineHeight: 1.6
        } 
      }, 
        React.createElement('strong', { style: { color: currentTheme.text } }, 'Hinweis: '),
        texts.lowLiquidityWarning + ' Berücksichtige dies bei deiner Exit-Strategie.'
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'grid',
          gap: '1rem'
        } 
      },
        illiquidAssets.map((asset, idx) => 
          React.createElement('div', { 
            key: idx,
            style: { 
              background: currentTheme.inputBg,
              padding: '1.25rem',
              borderRadius: '0.75rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem'
            } 
          },
            React.createElement('div', { style: { flex: '1 1 auto' } },
              React.createElement('div', { 
                style: { 
                  color: currentTheme.text,
                  fontWeight: '600',
                  fontSize: '1.125rem',
                  marginBottom: '0.25rem'
                } 
              }, asset.symbol || asset.name),
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontSize: '0.875rem'
                } 
              }, asset.category.toUpperCase())
            ),
            React.createElement('div', { 
              style: { 
                textAlign: 'right'
              } 
            },
              React.createElement('div', { 
                style: { 
                  color: '#f59e0b',
                  fontWeight: 'bold',
                  fontSize: '1.5rem',
                  marginBottom: '0.25rem'
                } 
              }, asset.liquidity.score + '/100'),
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontSize: '0.75rem',
                  textTransform: 'uppercase'
                } 
              }, asset.liquidity.rating)
            ),
            React.createElement('div', { 
              style: { 
                padding: '0.5rem 1rem',
                background: currentTheme.card,
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                color: currentTheme.textSecondary
              } 
            }, '~' + asset.liquidity.daysToExit.toFixed(0) + ' ' + texts.daysToExit)
          )
        )
      )
    )
  );
  } catch (error) {
    console.error('Risk Analytics View Error:', error);
    return React.createElement('div', { 
      style: { 
        textAlign: 'center', 
        padding: '4rem 2rem', 
        color: '#9ca3af'
      } 
    },
      React.createElement('h3', { 
        style: { 
          fontSize: '1.5rem', 
          color: '#ef4444',
          marginBottom: '1rem'
        } 
      }, texts.errorLoading),
      React.createElement('p', { 
        style: { 
          fontSize: '1rem',
          marginBottom: '1rem',
          color: '#d1d5db'
        } 
      }, texts.errorOccurred),
      React.createElement('code', { 
        style: { 
          display: 'block',
          background: '#1f2937',
          padding: '1rem',
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          color: '#ef4444'
        } 
      }, error.message)
    );
  }
};

console.log('[OK] Risk Analytics View loaded - COMPLETE VERSION');
