// ============================================================================
// MAERMIN v4.0 - COMPLETE CS2 Analytics View
// ============================================================================
// Vollständige UI für CS2 Analytics Tab - KEINE KOMPRESSION
// Alle Features vollständig implementiert
// ============================================================================

window.createCS2AnalyticsView = function(props) {
  try {
    const { safe, prices, currentTheme, getCurrencySymbol, formatPrice, t, language } = props;
    
    // Inline translations for CS2 Analytics
    const texts = language === 'de' ? {
      // Header
      title: 'CS2 Advanced Analytics',
      subtitle: 'Detaillierte Analyse deines CS2 Portfolios mit',
      noItems: 'Keine CS2 Items vorhanden',
      addItemsPrompt: 'Füge CS2 Items im Portfolio Tab hinzu um detaillierte Analytics zu sehen.',
      // Market Sentiment
      marketSentiment: 'Market Sentiment',
      ofTotal: 'von 100',
      bullish: 'Bullisch',
      bearish: 'Bärisch', 
      neutral: 'Neutral',
      marketSignals: 'Market Signale',
      // Quick Stats
      totalItems: 'Gesamt CS2 Items',
      withStickers: 'mit Stickern',
      portfolioValue: 'Portfolio Wert',
      invested: 'Investiert',
      avgReturn: 'Durchschn. Return',
      overAllItems: 'Über alle Items',
      totalProfit: 'Gesamt Profit',
      roi: 'ROI',
      stickerValue: 'Sticker Wert',
      ofPortfolio: 'des Portfolios',
      bestFloatRange: 'Best Float Range',
      // Sections
      floatAnalysis: 'Float Value Analysis',
      stickerAnalysis: 'Sticker Analysis',
      rarityDistribution: 'Rarity Distribution & Performance',
      performanceHighlights: 'Performance Highlights',
      // Performance
      bestPerformer: 'Best Performer',
      worstPerformer: 'Worst Performer',
      lowestFloat: 'Niedrigster Float',
      highestFloat: 'Höchster Float',
      // Float Ranges
      factoryNew: 'Factory New',
      minimalWear: 'Minimal Wear',
      fieldTested: 'Field-Tested',
      wellWorn: 'Well-Worn',
      battleScarred: 'Battle-Scarred',
      // Rarities
      consumerGrade: 'Consumer Grade',
      industrialGrade: 'Industrial Grade',
      milSpec: 'Mil-Spec',
      restricted: 'Restricted',
      classified: 'Classified',
      covert: 'Covert',
      contraband: 'Contraband',
      knife: 'Knife',
      glove: 'Glove',
      // General
      items: 'Items',
      value: 'Wert',
      premium: 'Premium',
      avgReturnShort: 'Ø Return',
      weaponsWithStickers: 'Weapons mit Stickern',
      recommendations: 'Empfehlungen',
      noData: 'Keine Daten',
      // Signals
      strongMomentum: 'Starker Momentum',
      weakMomentum: 'Schwacher Momentum',
      positionsGaining: 'Positionen steigen',
      positionsLosing: 'Positionen fallen',
      highVolatility: 'Hohe Volatilität',
      stableMarket: 'Stabiler Markt'
    } : {
      // Header
      title: 'CS2 Advanced Analytics',
      subtitle: 'Detailed analysis of your CS2 Portfolio with',
      noItems: 'No CS2 Items Available',
      addItemsPrompt: 'Add CS2 Items in the Portfolio Tab to see detailed Analytics.',
      // Market Sentiment
      marketSentiment: 'Market Sentiment',
      ofTotal: 'of 100',
      bullish: 'Bullish',
      bearish: 'Bearish',
      neutral: 'Neutral',
      marketSignals: 'Market Signals',
      // Quick Stats
      totalItems: 'Total CS2 Items',
      withStickers: 'with Stickers',
      portfolioValue: 'Portfolio Value',
      invested: 'Invested',
      avgReturn: 'Average Return',
      overAllItems: 'Over all Items',
      totalProfit: 'Total Profit',
      roi: 'ROI',
      stickerValue: 'Sticker Value',
      ofPortfolio: 'of Portfolio',
      bestFloatRange: 'Best Float Range',
      // Sections
      floatAnalysis: 'Float Value Analysis',
      stickerAnalysis: 'Sticker Analysis',
      rarityDistribution: 'Rarity Distribution & Performance',
      performanceHighlights: 'Performance Highlights',
      // Performance
      bestPerformer: 'Best Performer',
      worstPerformer: 'Worst Performer',
      lowestFloat: 'Lowest Float',
      highestFloat: 'Highest Float',
      // Float Ranges
      factoryNew: 'Factory New',
      minimalWear: 'Minimal Wear',
      fieldTested: 'Field-Tested',
      wellWorn: 'Well-Worn',
      battleScarred: 'Battle-Scarred',
      // Rarities
      consumerGrade: 'Consumer Grade',
      industrialGrade: 'Industrial Grade',
      milSpec: 'Mil-Spec',
      restricted: 'Restricted',
      classified: 'Classified',
      covert: 'Covert',
      contraband: 'Contraband',
      knife: 'Knife',
      glove: 'Glove',
      // General
      items: 'Items',
      value: 'Value',
      premium: 'Premium',
      avgReturnShort: 'Avg Return',
      weaponsWithStickers: 'Weapons with Stickers',
      recommendations: 'Recommendations',
      noData: 'No Data',
      // Signals
      strongMomentum: 'Strong momentum',
      weakMomentum: 'Weak momentum',
      positionsGaining: 'positions gaining value',
      positionsLosing: 'positions losing value',
      highVolatility: 'High volatility',
      stableMarket: 'Stable market'
    };
    
    // Safety check
    if (!safe || !safe.skins) {
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
        }, 'Fehler: ' + texts.noData)
      );
    }
  
  // ========== EMPTY STATE ==========
  if (!safe.skins || !Array.isArray(safe.skins) || safe.skins.length === 0) {
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
      }, '[CS2]'),
      React.createElement('h3', { 
        style: { 
          fontSize: '1.75rem', 
          marginBottom: '1rem', 
          color: currentTheme.text,
          fontWeight: '600'
        } 
      }, texts.noItems),
      React.createElement('p', { 
        style: { 
          fontSize: '1.1rem',
          lineHeight: 1.6,
          marginBottom: '2rem'
        } 
      }, texts.addItemsPrompt),
      React.createElement('div', { 
        style: { 
          textAlign: 'left',
          display: 'inline-block',
          marginTop: '1.5rem'
        } 
      },
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• ' + texts.marketSentiment + ' Analyse'),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• Float Value Performance'),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• Sticker Investment Tracking'),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• ' + texts.rarityDistribution),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• Portfolio Performance Metrics'),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• Detaillierte Item Statistics'),
        React.createElement('div', { style: { marginBottom: '0.75rem', opacity: 0.8 } }, '• Investment Recommendations')
      )
    );
  }
  
  // ========== ENRICH ITEMS WITH CURRENT PRICES ==========
  // Add currentPrice from prices API to each item
  const enrichedSkins = safe.skins.map(item => {
    if (item.currentPrice) return item; // Already has currentPrice
    
    const apiPrice = prices && (prices[item.symbol.toLowerCase()] || prices[item.symbol]);
    if (apiPrice) {
      return { ...item, currentPrice: apiPrice };
    }
    return item;
  });
  
  // ========== CALCULATE ALL CS2 METRICS ==========
  let floatAnalysis, stickerAnalysis, rarityAnalysis, sentiment;
  
  try {
    floatAnalysis = analyzeFloatPerformance ? analyzeFloatPerformance(enrichedSkins) : { bestPerforming: null, floatRanges: {}, recommendations: [] };
  } catch (e) {
    console.error('Float Analysis Error:', e);
    floatAnalysis = { bestPerforming: null, floatRanges: {}, recommendations: [] };
  }
  
  try {
    stickerAnalysis = analyzeStickerInvestments ? analyzeStickerInvestments(enrichedSkins) : { 
      totalStickerValue: 0, 
      stickerContributionPercent: 0, 
      weaponsWithStickers: 0, 
      topStickerWeapons: [], 
      warnings: [],
      recommendations: []
    };
  } catch (e) {
    console.error('Sticker Analysis Error:', e);
    stickerAnalysis = { 
      totalStickerValue: 0, 
      stickerContributionPercent: 0, 
      weaponsWithStickers: 0, 
      topStickerWeapons: [], 
      warnings: [],
      recommendations: []
    };
  }
  
  try {
    rarityAnalysis = analyzeRarityPerformance ? analyzeRarityPerformance(enrichedSkins) : { rarityBreakdown: {}, bestRarity: null };
  } catch (e) {
    console.error('Rarity Analysis Error:', e);
    rarityAnalysis = { rarityBreakdown: {}, bestRarity: null };
  }
  
  try {
    sentiment = calculateCS2MarketSentiment ? calculateCS2MarketSentiment(enrichedSkins) : { score: 50, sentiment: texts.neutral, signals: [] };
  } catch (e) {
    console.error('Sentiment Analysis Error:', e);
    sentiment = { score: 50, sentiment: texts.neutral, signals: [] };
  }
  
  // Calculate portfolio totals
  const totalValue = enrichedSkins.reduce((sum, item) => {
    const currentPrice = item.currentPrice || 
                        (prices && (prices[item.symbol.toLowerCase()] || prices[item.symbol])) || 
                        item.purchasePrice || 0;
    return sum + (item.amount * currentPrice);
  }, 0);
  
  const totalInvested = enrichedSkins.reduce((sum, item) => 
    sum + (item.amount * (item.purchasePrice || 0)), 0);
  
  const totalProfit = totalValue - totalInvested;
  const totalReturn = totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0;
  
  // Calculate average return
  const avgReturn = enrichedSkins.length > 0 ? (enrichedSkins.reduce((sum, item) => {
    const current = item.currentPrice || 
                   (prices && (prices[item.symbol.toLowerCase()] || prices[item.symbol])) || 
                   item.purchasePrice || 0;
    const purchase = item.purchasePrice || current;
    const ret = purchase > 0 ? ((current - purchase) / purchase) * 100 : 0;
    return sum + ret;
  }, 0) / enrichedSkins.length) : 0;
  
  // Find best and worst performing items
  const withReturns = enrichedSkins.map(item => {
    const current = item.currentPrice || 
                   (prices && (prices[item.symbol.toLowerCase()] || prices[item.symbol])) || 
                   item.purchasePrice || 0;
    const purchase = item.purchasePrice || current;
    const ret = purchase > 0 ? ((current - purchase) / purchase) * 100 : 0;
    const value = item.amount * current;
    return { ...item, return: ret, value: value };
  }).sort((a, b) => b.return - a.return);
  
  const bestItem = withReturns[0];
  const worstItem = withReturns[withReturns.length - 1];
  
  // Find items with extreme floats
  const itemsWithFloat = enrichedSkins.filter(item => item.metadata?.float !== undefined && item.metadata?.float !== null);
  const lowestFloat = itemsWithFloat.length > 0 ? 
    itemsWithFloat.reduce((min, item) => (item.metadata.float < min.metadata.float ? item : min)) : null;
  const highestFloat = itemsWithFloat.length > 0 ? 
    itemsWithFloat.reduce((max, item) => (item.metadata.float > max.metadata.float ? item : max)) : null;
  
  // Count stickered items
  const stickeredItems = enrichedSkins.filter(item => 
    item.metadata?.stickers && Array.isArray(item.metadata.stickers) && item.metadata.stickers.length > 0
  );
  
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
      }, 'CS2 Advanced Analytics'),
      React.createElement('p', { 
        style: { 
          color: currentTheme.textSecondary,
          fontSize: '1rem'
        } 
      }, 'Detaillierte Analyse deines CS2 Portfolios mit ' + enrichedSkins.length + ' Items')
    ),
    
    // ========== MARKET SENTIMENT CARD ==========
    React.createElement('div', { 
      style: { 
        background: currentTheme.card, 
        borderRadius: '1.25rem', 
        padding: '2.5rem', 
        marginBottom: '2rem',
        border: `1px solid ${currentTheme.cardBorder}`,
        position: 'relative',
        overflow: 'hidden'
      } 
    },
      // Background effect
      React.createElement('div', { 
        style: { 
          position: 'absolute',
          top: '-50px',
          right: '-50px',
          width: '200px',
          height: '200px',
          background: sentiment.sentiment.includes(texts.bullish) ? 
            'radial-gradient(circle, rgba(16, 185, 129, 0.15) 0%, transparent 70%)' : 
            sentiment.sentiment.includes(texts.bearish) ? 
            'radial-gradient(circle, rgba(239, 68, 68, 0.15) 0%, transparent 70%)' :
            'radial-gradient(circle, rgba(245, 158, 11, 0.15) 0%, transparent 70%)',
          pointerEvents: 'none'
        } 
      }),
      
      React.createElement('div', { 
        style: { 
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem',
          position: 'relative'
        } 
      },
        React.createElement('div', { 
          style: { 
            width: '4px',
            height: '28px',
            background: sentiment.sentiment.includes(texts.bullish) ? 
              'linear-gradient(180deg, #10b981, #059669)' : 
              sentiment.sentiment.includes(texts.bearish) ? 
              'linear-gradient(180deg, #ef4444, #dc2626)' :
              'linear-gradient(180deg, #f59e0b, #d97706)',
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
        }, texts.marketSentiment)
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'flex', 
          gap: '3rem', 
          alignItems: 'center',
          flexWrap: 'wrap',
          position: 'relative'
        } 
      },
        // Sentiment Score Display
        React.createElement('div', { 
          style: { 
            flex: '0 0 auto'
          } 
        },
          React.createElement('div', { 
            style: { 
              fontSize: '5rem', 
              fontWeight: 'bold', 
              color: sentiment.sentiment.includes(texts.bullish) ? '#10b981' : 
                     sentiment.sentiment.includes(texts.bearish) ? '#ef4444' : '#f59e0b',
              lineHeight: 0.9,
              marginBottom: '0.75rem'
            } 
          }, sentiment.score),
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
              background: sentiment.sentiment.includes(texts.bullish) ? '#10b981' : 
                         sentiment.sentiment.includes(texts.bearish) ? '#ef4444' : '#f59e0b',
              color: 'white',
              borderRadius: '0.5rem',
              fontSize: '1.125rem',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.025em',
              marginTop: '0.5rem'
            } 
          }, sentiment.sentiment)
        ),
        
        // Sentiment Signals
        React.createElement('div', { 
          style: { 
            flex: '1 1 300px'
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
          }, texts.marketSignals),
          React.createElement('div', { 
            style: { 
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            } 
          },
            sentiment.signals.map((signal, idx) => 
              React.createElement('div', { 
                key: idx,
                style: { 
                  padding: '1rem 1.25rem', 
                  background: currentTheme.inputBg,
                  borderRadius: '0.75rem',
                  fontSize: '0.9375rem',
                  color: currentTheme.text,
                  borderLeft: `4px solid ${
                    signal.type === 'positive' ? '#10b981' : 
                    signal.type === 'negative' ? '#ef4444' : '#f59e0b'
                  }`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem'
                } 
              },
                React.createElement('span', { 
                  style: { 
                    padding: '0.25rem 0.5rem',
                    background: signal.type === 'positive' ? '#10b981' : 
                               signal.type === 'negative' ? '#ef4444' : '#f59e0b',
                    color: 'white',
                    borderRadius: '0.25rem',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    flexShrink: 0
                  } 
                }, signal.type),
                React.createElement('span', { style: { flex: 1 } }, signal.message)
              )
            )
          )
        )
      )
    ),
    
    // ========== QUICK STATS GRID ==========
    React.createElement('div', { 
      style: { 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
        gap: '1.5rem', 
        marginBottom: '2rem' 
      } 
    },
      
      // Total Items
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
        }, texts.totalItems),
        React.createElement('div', { 
          style: { 
            fontSize: '3rem', 
            fontWeight: 'bold',
            position: 'relative'
          } 
        }, enrichedSkins.length),
        React.createElement('div', { 
          style: { 
            fontSize: '0.75rem', 
            opacity: 0.8,
            marginTop: '0.5rem',
            position: 'relative'
          } 
        }, stickeredItems.length + ' ' + texts.withStickers)
      ),
      
      // Portfolio Value
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
        }, texts.portfolioValue),
        React.createElement('div', { 
          style: { 
            fontSize: '2rem', 
            fontWeight: 'bold',
            position: 'relative'
          } 
        }, getCurrencySymbol() + formatPrice(totalValue)),
        React.createElement('div', { 
          style: { 
            fontSize: '0.75rem', 
            opacity: 0.8,
            marginTop: '0.5rem',
            position: 'relative'
          } 
        }, texts.invested + ': ' + getCurrencySymbol() + formatPrice(totalInvested))
      ),
      
      // Average Return
      React.createElement('div', { 
        style: { 
          background: avgReturn >= 0 ? 
            'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 
            'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', 
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
        }, texts.avgReturn),
        React.createElement('div', { 
          style: { 
            fontSize: '2.5rem', 
            fontWeight: 'bold',
            position: 'relative'
          } 
        }, (avgReturn >= 0 ? '+' : '') + avgReturn.toFixed(1) + '%'),
        React.createElement('div', { 
          style: { 
            fontSize: '0.75rem', 
            opacity: 0.8,
            marginTop: '0.5rem',
            position: 'relative'
          } 
        }, texts.overAllItems)
      ),
      
      // Total Profit
      React.createElement('div', { 
        style: { 
          background: totalProfit >= 0 ? 
            'linear-gradient(135deg, #059669 0%, #047857 100%)' : 
            'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)', 
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
        }, texts.totalProfit),
        React.createElement('div', { 
          style: { 
            fontSize: '2rem', 
            fontWeight: 'bold',
            position: 'relative'
          } 
        }, (totalProfit >= 0 ? '+' : '') + getCurrencySymbol() + formatPrice(Math.abs(totalProfit))),
        React.createElement('div', { 
          style: { 
            fontSize: '0.75rem', 
            opacity: 0.8,
            marginTop: '0.5rem',
            position: 'relative'
          } 
        }, (totalReturn >= 0 ? '+' : '') + totalReturn.toFixed(1) + '% ROI')
      ),
      
      // Sticker Value
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
        }, texts.stickerValue),
        React.createElement('div', { 
          style: { 
            fontSize: '2rem', 
            fontWeight: 'bold',
            position: 'relative'
          } 
        }, getCurrencySymbol() + formatPrice(stickerAnalysis.totalStickerValue)),
        React.createElement('div', { 
          style: { 
            fontSize: '0.75rem', 
            opacity: 0.8,
            marginTop: '0.5rem',
            position: 'relative'
          } 
        }, stickerAnalysis.stickerContributionPercent.toFixed(1) + '% des Portfolios')
      ),
      
      // Best Float Range
      floatAnalysis.bestPerforming && React.createElement('div', { 
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
        }, 'Best Float Range'),
        React.createElement('div', { 
          style: { 
            fontSize: '1.5rem', 
            fontWeight: 'bold',
            position: 'relative'
          } 
        }, floatAnalysis.bestPerforming.name),
        React.createElement('div', { 
          style: { 
            fontSize: '0.75rem', 
            opacity: 0.8,
            marginTop: '0.5rem',
            position: 'relative'
          } 
        }, '+' + floatAnalysis.bestPerforming.avgReturn.toFixed(1) + '% Avg Return')
      )
    ),
    
    // ========== FLOAT VALUE ANALYSIS ==========
    floatAnalysis.bestPerforming && React.createElement('div', { 
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
            background: 'linear-gradient(180deg, #06b6d4, #0891b2)',
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
        }, 'Float Value Performance')
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '1.25rem'
        } 
      },
        Object.entries(floatAnalysis.floatRanges)
          .filter(([name, data]) => data.count > 0)
          .map(([name, data]) => {
            const isBesr = floatAnalysis.bestPerforming && floatAnalysis.bestPerforming.name === name;
            
            return React.createElement('div', { 
              key: name,
              style: { 
                background: currentTheme.inputBg,
                padding: '1.5rem',
                borderRadius: '0.75rem',
                border: isBesr ? '2px solid #06b6d4' : 'none',
                position: 'relative',
                overflow: 'hidden'
              } 
            },
              isBesr && React.createElement('div', { 
                style: { 
                  position: 'absolute',
                  top: '0.5rem',
                  right: '0.5rem',
                  padding: '0.25rem 0.5rem',
                  background: '#06b6d4',
                  color: 'white',
                  borderRadius: '0.25rem',
                  fontSize: '0.625rem',
                  fontWeight: 'bold',
                  textTransform: 'uppercase'
                } 
              }, 'BEST'),
              
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontSize: '0.875rem',
                  marginBottom: '0.75rem',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.025em'
                } 
              }, name),
              
              React.createElement('div', { 
                style: { 
                  color: currentTheme.text,
                  fontSize: '2rem',
                  fontWeight: 'bold',
                  marginBottom: '0.5rem',
                  color: data.avgReturn >= 0 ? '#10b981' : '#ef4444'
                } 
              }, (data.avgReturn >= 0 ? '+' : '') + data.avgReturn.toFixed(1) + '%'),
              
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontSize: '0.875rem',
                  marginBottom: '0.75rem'
                } 
              }, data.count + ' Item' + (data.count !== 1 ? 's' : '')),
              
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontSize: '0.875rem'
                } 
              }, 'Range: ' + data.range)
            );
          })
      ),
      
      // Float recommendations
      floatAnalysis.recommendations.length > 0 && React.createElement('div', { 
        style: { 
          marginTop: '1.5rem',
          padding: '1.25rem',
          background: currentTheme.inputBg,
          borderRadius: '0.75rem',
          borderLeft: '4px solid #06b6d4'
        } 
      },
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem',
            fontWeight: '600',
            color: currentTheme.text,
            marginBottom: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.025em'
          } 
        }, 'Float Recommendations'),
        React.createElement('div', { 
          style: { 
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          } 
        },
          floatAnalysis.recommendations.map((rec, idx) => 
            React.createElement('div', { 
              key: idx,
              style: { 
                color: currentTheme.textSecondary,
                fontSize: '0.9375rem',
                lineHeight: 1.6
              } 
            }, '• ' + rec)
          )
        )
      )
    ),
    
    // ========== STICKER ANALYSIS ==========
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
        }, 'Sticker Investment Analysis')
      ),
      
      // Sticker stats grid
      React.createElement('div', { 
        style: { 
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem'
        } 
      },
        React.createElement('div', { 
          style: { 
            background: currentTheme.inputBg,
            padding: '1.25rem',
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
          }, 'Stickered Items'),
          React.createElement('div', { 
            style: { 
              fontSize: '2rem',
              fontWeight: 'bold',
              color: currentTheme.text
            } 
          }, stickerAnalysis.weaponsWithStickers)
        ),
        
        React.createElement('div', { 
          style: { 
            background: currentTheme.inputBg,
            padding: '1.25rem',
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
          }, 'Total Sticker Value'),
          React.createElement('div', { 
            style: { 
              fontSize: '1.5rem',
              fontWeight: 'bold',
              color: currentTheme.text
            } 
          }, getCurrencySymbol() + formatPrice(stickerAnalysis.totalStickerValue))
        ),
        
        React.createElement('div', { 
          style: { 
            background: currentTheme.inputBg,
            padding: '1.25rem',
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
          }, 'Portfolio %'),
          React.createElement('div', { 
            style: { 
              fontSize: '2rem',
              fontWeight: 'bold',
              color: currentTheme.text
            } 
          }, stickerAnalysis.stickerContributionPercent.toFixed(1) + '%')
        )
      ),
      
      // Top 5 Stickered Items
      stickerAnalysis.topStickerWeapons.length > 0 && React.createElement('div', { 
        style: { 
          marginTop: '1.5rem'
        } 
      },
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem',
            fontWeight: '600',
            color: currentTheme.text,
            marginBottom: '1rem',
            textTransform: 'uppercase',
            letterSpacing: '0.025em'
          } 
        }, 'Top 5 Weapons by Sticker Value'),
        React.createElement('div', { 
          style: { 
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          } 
        },
          stickerAnalysis.topStickerWeapons.slice(0, 5).map((weapon, idx) => 
            React.createElement('div', { 
              key: idx,
              style: { 
                background: currentTheme.inputBg,
                padding: '1rem 1.25rem',
                borderRadius: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem'
              } 
            },
              React.createElement('div', { style: { flex: 1 } },
                React.createElement('div', { 
                  style: { 
                    color: currentTheme.text,
                    fontWeight: '600',
                    marginBottom: '0.25rem'
                  } 
                }, weapon.name),
                React.createElement('div', { 
                  style: { 
                    color: currentTheme.textSecondary,
                    fontSize: '0.875rem'
                  } 
                }, weapon.stickerCount + ' Sticker' + (weapon.stickerCount !== 1 ? 's' : ''))
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
                    fontSize: '1.125rem'
                  } 
                }, getCurrencySymbol() + formatPrice(weapon.stickerValue)),
                React.createElement('div', { 
                  style: { 
                    color: currentTheme.textSecondary,
                    fontSize: '0.75rem'
                  } 
                }, weapon.stickerPercent.toFixed(1) + '% of weapon value')
              )
            )
          )
        )
      ),
      
      // Sticker warnings
      stickerAnalysis.recommendations.length > 0 && React.createElement('div', { 
        style: { 
          marginTop: '1.5rem',
          padding: '1.25rem',
          background: '#fef3c7',
          borderRadius: '0.75rem',
          borderLeft: '4px solid #f59e0b'
        } 
      },
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem',
            fontWeight: '600',
            color: '#92400e',
            marginBottom: '0.75rem'
          } 
        }, 'Sticker Exposure Warning'),
        React.createElement('div', { 
          style: { 
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          } 
        },
          stickerAnalysis.recommendations.map((warn, idx) => 
            React.createElement('div', { 
              key: idx,
              style: { 
                color: '#92400e',
                fontSize: '0.9375rem',
                lineHeight: 1.6
              } 
            }, '• ' + warn)
          )
        )
      )
    ),
    
    // ========== RARITY DISTRIBUTION ==========
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
            background: 'linear-gradient(180deg, #8b5cf6, #7c3aed)',
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
        }, texts.rarityDistribution)
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '1.25rem'
        } 
      },
        Object.entries(rarityAnalysis.rarityBreakdown)
          .filter(([rarity, data]) => data.count > 0)
          .sort((a, b) => b[1].totalValue - a[1].totalValue)
          .map(([rarity, data]) => 
            React.createElement('div', { 
              key: rarity,
              style: { 
                background: currentTheme.inputBg,
                padding: '1.5rem',
                borderRadius: '0.75rem',
                borderLeft: `5px solid ${data.color}`,
                position: 'relative',
                overflow: 'hidden'
              } 
            },
              React.createElement('div', { 
                style: { 
                  position: 'absolute',
                  top: '0',
                  right: '0',
                  width: '50px',
                  height: '50px',
                  background: data.color + '20',
                  borderRadius: '0 0 0 100%'
                } 
              }),
              
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontSize: '0.75rem',
                  marginBottom: '0.75rem',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  letterSpacing: '0.025em',
                  position: 'relative'
                } 
              }, data.name),
              
              React.createElement('div', { 
                style: { 
                  color: data.avgReturn >= 0 ? '#10b981' : '#ef4444',
                  fontSize: '1.75rem',
                  fontWeight: 'bold',
                  marginBottom: '0.5rem',
                  position: 'relative'
                } 
              }, (data.avgReturn >= 0 ? '+' : '') + data.avgReturn.toFixed(1) + '%'),
              
              React.createElement('div', { 
                style: { 
                  color: currentTheme.textSecondary,
                  fontSize: '0.875rem',
                  marginBottom: '0.5rem',
                  position: 'relative'
                } 
              }, data.count + ' Item' + (data.count !== 1 ? 's' : '')),
              
              React.createElement('div', { 
                style: { 
                  color: currentTheme.text,
                  fontSize: '0.875rem',
                  fontWeight: '600',
                  position: 'relative'
                } 
              }, getCurrencySymbol() + formatPrice(data.totalValue))
            )
          )
      ),
      
      // Best rarity
      rarityAnalysis.bestRarity && React.createElement('div', { 
        style: { 
          marginTop: '1.5rem',
          padding: '1.25rem',
          background: currentTheme.inputBg,
          borderRadius: '0.75rem',
          borderLeft: `4px solid ${rarityAnalysis.bestRarity.color}`
        } 
      },
        React.createElement('div', { 
          style: { 
            fontSize: '0.875rem',
            fontWeight: '600',
            color: currentTheme.text,
            marginBottom: '0.5rem'
          } 
        }, 'Best Performing Rarity: ' + rarityAnalysis.bestRarity.name),
        React.createElement('div', { 
          style: { 
            color: currentTheme.textSecondary,
            fontSize: '0.9375rem',
            lineHeight: 1.6
          } 
        }, 
          'Average Return: ',
          React.createElement('strong', { 
            style: { 
              color: rarityAnalysis.bestRarity.avgReturn >= 0 ? '#10b981' : '#ef4444'
            } 
          }, (rarityAnalysis.bestRarity.avgReturn >= 0 ? '+' : '') + rarityAnalysis.bestRarity.avgReturn.toFixed(1) + '%'),
          ' über ' + rarityAnalysis.bestRarity.count + ' Items'
        )
      )
    ),
    
    // ========== PERFORMANCE HIGHLIGHTS ==========
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
            background: 'linear-gradient(180deg, #10b981, #ef4444)',
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
        }, texts.performanceHighlights)
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.25rem'
        } 
      },
        // Best Item
        React.createElement('div', { 
          style: { 
            background: 'linear-gradient(135deg, #10b981, #059669)',
            padding: '1.75rem',
            borderRadius: '0.75rem',
            color: 'white'
          } 
        },
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              opacity: 0.9,
              marginBottom: '1rem',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.025em'
            } 
          }, texts.bestPerformer),
          React.createElement('div', { 
            style: { 
              fontSize: '1.25rem',
              fontWeight: 'bold',
              marginBottom: '0.75rem',
              wordBreak: 'break-word'
            } 
          }, bestItem.symbol || bestItem.name || 'N/A'),
          React.createElement('div', { 
            style: { 
              fontSize: '2.5rem',
              fontWeight: 'bold',
              marginBottom: '0.5rem'
            } 
          }, '+' + bestItem.return.toFixed(1) + '%'),
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              opacity: 0.85
            } 
          }, 'Value: ' + getCurrencySymbol() + formatPrice(bestItem.value))
        ),
        
        // Worst Item
        React.createElement('div', { 
          style: { 
            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            padding: '1.75rem',
            borderRadius: '0.75rem',
            color: 'white'
          } 
        },
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              opacity: 0.9,
              marginBottom: '1rem',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.025em'
            } 
          }, texts.worstPerformer),
          React.createElement('div', { 
            style: { 
              fontSize: '1.25rem',
              fontWeight: 'bold',
              marginBottom: '0.75rem',
              wordBreak: 'break-word'
            } 
          }, worstItem.symbol || worstItem.name || 'N/A'),
          React.createElement('div', { 
            style: { 
              fontSize: '2.5rem',
              fontWeight: 'bold',
              marginBottom: '0.5rem'
            } 
          }, worstItem.return.toFixed(1) + '%'),
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              opacity: 0.85
            } 
          }, 'Value: ' + getCurrencySymbol() + formatPrice(worstItem.value))
        ),
        
        // Lowest Float (if available)
        lowestFloat && React.createElement('div', { 
          style: { 
            background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
            padding: '1.75rem',
            borderRadius: '0.75rem',
            color: 'white'
          } 
        },
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              opacity: 0.9,
              marginBottom: '1rem',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.025em'
            } 
          }, texts.lowestFloat),
          React.createElement('div', { 
            style: { 
              fontSize: '1.25rem',
              fontWeight: 'bold',
              marginBottom: '0.75rem',
              wordBreak: 'break-word'
            } 
          }, lowestFloat.symbol || lowestFloat.name || 'N/A'),
          React.createElement('div', { 
            style: { 
              fontSize: '2.5rem',
              fontWeight: 'bold',
              marginBottom: '0.5rem'
            } 
          }, lowestFloat.metadata.float.toFixed(4)),
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              opacity: 0.85
            } 
          }, 'Factory New Premium')
        ),
        
        // Highest Float (if available)
        highestFloat && React.createElement('div', { 
          style: { 
            background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
            padding: '1.75rem',
            borderRadius: '0.75rem',
            color: 'white'
          } 
        },
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              opacity: 0.9,
              marginBottom: '1rem',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.025em'
            } 
          }, texts.highestFloat),
          React.createElement('div', { 
            style: { 
              fontSize: '1.25rem',
              fontWeight: 'bold',
              marginBottom: '0.75rem',
              wordBreak: 'break-word'
            } 
          }, highestFloat.symbol || highestFloat.name || 'N/A'),
          React.createElement('div', { 
            style: { 
              fontSize: '2.5rem',
              fontWeight: 'bold',
              marginBottom: '0.5rem'
            } 
          }, highestFloat.metadata.float.toFixed(4)),
          React.createElement('div', { 
            style: { 
              fontSize: '0.875rem',
              opacity: 0.85
            } 
          }, 'Battle-Scarred')
        )
      )
    )
  );
  } catch (error) {
    console.error('CS2 Analytics View Error:', error);
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
      }, 'Fehler beim Laden der CS2 Analytics'),
      React.createElement('p', { 
        style: { 
          fontSize: '1rem',
          marginBottom: '1rem',
          color: '#d1d5db'
        } 
      }, 'Ein Fehler ist aufgetreten. Bitte prüfe die Browser Console (F12).'),
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

console.log('[OK] CS2 Analytics View loaded - COMPLETE VERSION');
