// ============================================================================
// MAERMIN v6.0 - Sentiment & News Integration Engine
// News aggregation, sentiment analysis, social media signals
// ============================================================================

/**
 * Sentiment score ranges
 */
const SENTIMENT_RANGES = {
  veryBearish: { min: -1.0, max: -0.6, label: 'Very Bearish', color: '#CC0000' },
  bearish: { min: -0.6, max: -0.2, label: 'Bearish', color: '#FF6600' },
  neutral: { min: -0.2, max: 0.2, label: 'Neutral', color: '#999999' },
  bullish: { min: 0.2, max: 0.6, label: 'Bullish', color: '#66CC00' },
  veryBullish: { min: 0.6, max: 1.0, label: 'Very Bullish', color: '#00CC00' }
};

/**
 * News sources with reliability ratings
 */
const NEWS_SOURCES = {
  // Financial news
  reuters: { name: 'Reuters', reliability: 0.95, type: 'news' },
  bloomberg: { name: 'Bloomberg', reliability: 0.93, type: 'news' },
  wsj: { name: 'Wall Street Journal', reliability: 0.90, type: 'news' },
  ft: { name: 'Financial Times', reliability: 0.92, type: 'news' },
  cnbc: { name: 'CNBC', reliability: 0.80, type: 'news' },
  
  // Crypto news
  coindesk: { name: 'CoinDesk', reliability: 0.82, type: 'crypto' },
  cointelegraph: { name: 'CoinTelegraph', reliability: 0.75, type: 'crypto' },
  theblock: { name: 'The Block', reliability: 0.85, type: 'crypto' },
  
  // Social media
  twitter: { name: 'Twitter/X', reliability: 0.50, type: 'social' },
  reddit: { name: 'Reddit', reliability: 0.45, type: 'social' },
  stocktwits: { name: 'StockTwits', reliability: 0.40, type: 'social' },
  
  // Gaming/CS2
  hltv: { name: 'HLTV', reliability: 0.85, type: 'gaming' },
  steamcommunity: { name: 'Steam Community', reliability: 0.60, type: 'gaming' }
};

/**
 * Sentiment keywords for basic analysis
 */
const SENTIMENT_KEYWORDS = {
  positive: [
    'bullish', 'surge', 'rally', 'gain', 'profit', 'growth', 'breakthrough',
    'record high', 'outperform', 'beat', 'upgrade', 'buy', 'strong',
    'momentum', 'optimistic', 'confidence', 'recovery', 'boom', 'soar',
    'moon', 'hodl', 'diamond hands', 'pump', 'breakout', 'ath'
  ],
  negative: [
    'bearish', 'crash', 'plunge', 'loss', 'decline', 'drop', 'fall',
    'record low', 'underperform', 'miss', 'downgrade', 'sell', 'weak',
    'concern', 'pessimistic', 'fear', 'recession', 'bust', 'tank',
    'dump', 'rekt', 'paper hands', 'rug pull', 'breakdown', 'capitulation'
  ],
  uncertainty: [
    'volatile', 'uncertain', 'risk', 'caution', 'warning', 'mixed',
    'unclear', 'debate', 'question', 'concern', 'watch', 'monitor'
  ]
};

/**
 * Create news item
 */
function createNewsItem(config) {
  const {
    title,
    summary,
    source,
    url,
    publishedAt,
    symbols = [],
    category
  } = config;

  const sentiment = analyzeTextSentiment(title + ' ' + (summary || ''));
  const sourceInfo = NEWS_SOURCES[source] || { reliability: 0.5 };

  return {
    id: 'news_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    title: title,
    summary: summary,
    source: source,
    sourceName: sourceInfo.name || source,
    sourceReliability: sourceInfo.reliability,
    url: url,
    publishedAt: publishedAt || new Date().toISOString(),
    symbols: symbols,
    category: category || sourceInfo.type,
    sentiment: sentiment,
    createdAt: new Date().toISOString()
  };
}

/**
 * Analyze text sentiment (basic keyword-based)
 */
function analyzeTextSentiment(text) {
  if (!text) return { score: 0, label: 'Neutral', confidence: 0 };

  const lowerText = text.toLowerCase();
  let positiveCount = 0;
  let negativeCount = 0;
  let uncertaintyCount = 0;

  SENTIMENT_KEYWORDS.positive.forEach(function(keyword) {
    if (lowerText.indexOf(keyword) !== -1) positiveCount++;
  });

  SENTIMENT_KEYWORDS.negative.forEach(function(keyword) {
    if (lowerText.indexOf(keyword) !== -1) negativeCount++;
  });

  SENTIMENT_KEYWORDS.uncertainty.forEach(function(keyword) {
    if (lowerText.indexOf(keyword) !== -1) uncertaintyCount++;
  });

  const totalKeywords = positiveCount + negativeCount;
  
  if (totalKeywords === 0) {
    return { score: 0, label: 'Neutral', confidence: 0.3 };
  }

  // Calculate score (-1 to 1)
  const rawScore = (positiveCount - negativeCount) / totalKeywords;
  const score = Math.max(-1, Math.min(1, rawScore));

  // Confidence based on keyword density
  const wordCount = text.split(/\s+/).length;
  const keywordDensity = totalKeywords / wordCount;
  const confidence = Math.min(0.9, 0.3 + keywordDensity * 10);

  // Reduce confidence if high uncertainty
  const adjustedConfidence = uncertaintyCount > 2 ? 
    confidence * 0.7 : confidence;

  // Get label
  let label = 'Neutral';
  for (var range in SENTIMENT_RANGES) {
    if (score >= SENTIMENT_RANGES[range].min && score < SENTIMENT_RANGES[range].max) {
      label = SENTIMENT_RANGES[range].label;
      break;
    }
  }

  return {
    score: score,
    label: label,
    confidence: adjustedConfidence,
    positiveKeywords: positiveCount,
    negativeKeywords: negativeCount,
    uncertaintyKeywords: uncertaintyCount
  };
}

/**
 * Aggregate sentiment for a symbol
 */
function aggregateSentiment(newsItems, symbol) {
  const relevantNews = symbol ? 
    newsItems.filter(function(n) {
      return n.symbols && n.symbols.indexOf(symbol) !== -1;
    }) : newsItems;

  if (relevantNews.length === 0) {
    return {
      symbol: symbol,
      aggregateSentiment: 0,
      label: 'No Data',
      newsCount: 0,
      confidence: 0
    };
  }

  // Weight by source reliability and recency
  let weightedSum = 0;
  let totalWeight = 0;
  const now = new Date();

  relevantNews.forEach(function(news) {
    const ageHours = (now - new Date(news.publishedAt)) / (1000 * 60 * 60);
    const recencyWeight = Math.max(0.1, 1 - (ageHours / 168)); // Decay over 1 week
    const reliabilityWeight = news.sourceReliability || 0.5;
    const confidenceWeight = news.sentiment.confidence || 0.5;
    
    const weight = recencyWeight * reliabilityWeight * confidenceWeight;
    
    weightedSum += news.sentiment.score * weight;
    totalWeight += weight;
  });

  const aggregateScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Get label
  let label = 'Neutral';
  for (var range in SENTIMENT_RANGES) {
    if (aggregateScore >= SENTIMENT_RANGES[range].min && 
        aggregateScore < SENTIMENT_RANGES[range].max) {
      label = SENTIMENT_RANGES[range].label;
      break;
    }
  }

  // Calculate sentiment momentum (comparing recent vs older)
  const recentNews = relevantNews.filter(function(n) {
    return (now - new Date(n.publishedAt)) < 24 * 60 * 60 * 1000;
  });
  const olderNews = relevantNews.filter(function(n) {
    return (now - new Date(n.publishedAt)) >= 24 * 60 * 60 * 1000;
  });

  let sentimentMomentum = 0;
  if (recentNews.length > 0 && olderNews.length > 0) {
    const recentAvg = recentNews.reduce(function(sum, n) {
      return sum + n.sentiment.score;
    }, 0) / recentNews.length;
    const olderAvg = olderNews.reduce(function(sum, n) {
      return sum + n.sentiment.score;
    }, 0) / olderNews.length;
    sentimentMomentum = recentAvg - olderAvg;
  }

  return {
    symbol: symbol,
    aggregateSentiment: aggregateScore,
    label: label,
    newsCount: relevantNews.length,
    recentNewsCount: recentNews.length,
    confidence: Math.min(0.9, 0.3 + relevantNews.length * 0.05),
    sentimentMomentum: sentimentMomentum,
    momentumLabel: sentimentMomentum > 0.1 ? 'improving' :
                  sentimentMomentum < -0.1 ? 'deteriorating' : 'stable',
    sources: countSources(relevantNews)
  };
}

/**
 * Count news by source
 */
function countSources(newsItems) {
  const counts = {};
  newsItems.forEach(function(news) {
    const source = news.source || 'unknown';
    counts[source] = (counts[source] || 0) + 1;
  });
  return counts;
}

/**
 * Calculate Fear & Greed Index (simplified)
 */
function calculateFearGreedIndex(marketData) {
  const {
    priceVsMA = 0,        // Price vs 125-day MA (-1 to 1)
    volatility = 0,        // VIX or similar (-1 high fear to 1 low fear)
    momentum = 0,          // Market momentum (-1 to 1)
    volume = 0,            // Volume vs average (-1 to 1)
    socialSentiment = 0,   // Aggregated social sentiment
    putCallRatio = 0       // Put/Call ratio signal (-1 to 1)
  } = marketData;

  // Weights for each component
  const weights = {
    priceVsMA: 0.20,
    volatility: 0.20,
    momentum: 0.20,
    volume: 0.10,
    socialSentiment: 0.15,
    putCallRatio: 0.15
  };

  // Calculate weighted score
  const score = 
    priceVsMA * weights.priceVsMA +
    volatility * weights.volatility +
    momentum * weights.momentum +
    volume * weights.volume +
    socialSentiment * weights.socialSentiment +
    putCallRatio * weights.putCallRatio;

  // Convert to 0-100 scale
  const index = Math.round((score + 1) * 50);
  const clampedIndex = Math.max(0, Math.min(100, index));

  let label, interpretation;
  if (clampedIndex <= 20) {
    label = 'Extreme Fear';
    interpretation = 'Market is very fearful - potential buying opportunity';
  } else if (clampedIndex <= 40) {
    label = 'Fear';
    interpretation = 'Market sentiment is negative';
  } else if (clampedIndex <= 60) {
    label = 'Neutral';
    interpretation = 'Market sentiment is balanced';
  } else if (clampedIndex <= 80) {
    label = 'Greed';
    interpretation = 'Market sentiment is positive';
  } else {
    label = 'Extreme Greed';
    interpretation = 'Market is very greedy - exercise caution';
  }

  return {
    index: clampedIndex,
    label: label,
    interpretation: interpretation,
    components: {
      priceVsMA: { value: priceVsMA, weight: weights.priceVsMA },
      volatility: { value: volatility, weight: weights.volatility },
      momentum: { value: momentum, weight: weights.momentum },
      volume: { value: volume, weight: weights.volume },
      socialSentiment: { value: socialSentiment, weight: weights.socialSentiment },
      putCallRatio: { value: putCallRatio, weight: weights.putCallRatio }
    },
    contrarian: clampedIndex <= 25 ? 'buy' : clampedIndex >= 75 ? 'sell' : 'hold'
  };
}

/**
 * Track social media mentions
 */
function trackSocialMentions(symbol, mentions) {
  mentions = mentions || [];

  const now = new Date();
  const last24h = mentions.filter(function(m) {
    return (now - new Date(m.timestamp)) < 24 * 60 * 60 * 1000;
  });
  const last7d = mentions.filter(function(m) {
    return (now - new Date(m.timestamp)) < 7 * 24 * 60 * 60 * 1000;
  });

  // Calculate mention velocity
  const hourlyRate24h = last24h.length / 24;
  const hourlyRate7d = last7d.length / (7 * 24);
  const mentionVelocity = hourlyRate7d > 0 ? hourlyRate24h / hourlyRate7d : 1;

  // Sentiment breakdown
  let positive = 0, negative = 0, neutral = 0;
  last24h.forEach(function(m) {
    if (m.sentiment > 0.2) positive++;
    else if (m.sentiment < -0.2) negative++;
    else neutral++;
  });

  const total = last24h.length || 1;
  const sentimentRatio = (positive - negative) / total;

  return {
    symbol: symbol,
    mentions24h: last24h.length,
    mentions7d: last7d.length,
    hourlyRate: hourlyRate24h,
    mentionVelocity: mentionVelocity,
    velocityLabel: mentionVelocity > 2 ? 'surging' :
                  mentionVelocity > 1.5 ? 'increasing' :
                  mentionVelocity < 0.5 ? 'declining' : 'stable',
    sentimentBreakdown: {
      positive: positive,
      negative: negative,
      neutral: neutral,
      ratio: sentimentRatio
    },
    trending: mentionVelocity > 2 && last24h.length > 100,
    alert: mentionVelocity > 3 ? 
      'Unusual social media activity detected' : null
  };
}

/**
 * Detect sentiment divergence (price vs sentiment)
 */
function detectSentimentDivergence(priceData, sentimentData) {
  const {
    priceChange,      // Recent price change (%)
    priceTrend        // 'up', 'down', 'sideways'
  } = priceData;

  const {
    sentimentScore,   // -1 to 1
    sentimentTrend    // 'improving', 'deteriorating', 'stable'
  } = sentimentData;

  let divergence = null;
  let signal = null;

  // Bullish divergence: price down but sentiment improving
  if (priceChange < -5 && sentimentScore > 0.2 && sentimentTrend === 'improving') {
    divergence = 'bullish';
    signal = 'Price weakness with improving sentiment - potential reversal';
  }
  // Bearish divergence: price up but sentiment deteriorating
  else if (priceChange > 5 && sentimentScore < -0.2 && sentimentTrend === 'deteriorating') {
    divergence = 'bearish';
    signal = 'Price strength with deteriorating sentiment - caution advised';
  }
  // Confirmation
  else if (priceChange > 5 && sentimentScore > 0.3) {
    divergence = 'confirmation_bullish';
    signal = 'Price and sentiment aligned bullish';
  }
  else if (priceChange < -5 && sentimentScore < -0.3) {
    divergence = 'confirmation_bearish';
    signal = 'Price and sentiment aligned bearish';
  }

  return {
    priceChange: priceChange,
    sentimentScore: sentimentScore,
    divergence: divergence,
    signal: signal,
    actionable: divergence === 'bullish' || divergence === 'bearish'
  };
}

/**
 * Generate news alerts based on criteria
 */
function generateNewsAlerts(newsItems, alertConfig) {
  const {
    watchlist = [],
    sentimentThreshold = 0.5,
    mentionThreshold = 10,
    keywords = []
  } = alertConfig;

  const alerts = [];

  // Check for significant sentiment changes
  watchlist.forEach(function(symbol) {
    const symbolNews = newsItems.filter(function(n) {
      return n.symbols && n.symbols.indexOf(symbol) !== -1;
    });

    if (symbolNews.length === 0) return;

    const sentiment = aggregateSentiment(symbolNews, symbol);

    if (Math.abs(sentiment.aggregateSentiment) >= sentimentThreshold) {
      alerts.push({
        type: 'sentiment',
        symbol: symbol,
        level: sentiment.aggregateSentiment > 0 ? 'bullish' : 'bearish',
        score: sentiment.aggregateSentiment,
        message: symbol + ' sentiment is ' + sentiment.label + 
          ' based on ' + sentiment.newsCount + ' news items'
      });
    }

    if (sentiment.sentimentMomentum > 0.3) {
      alerts.push({
        type: 'momentum',
        symbol: symbol,
        level: 'improving',
        message: symbol + ' sentiment rapidly improving'
      });
    } else if (sentiment.sentimentMomentum < -0.3) {
      alerts.push({
        type: 'momentum',
        symbol: symbol,
        level: 'deteriorating',
        message: symbol + ' sentiment rapidly deteriorating'
      });
    }
  });

  // Check for keyword alerts
  keywords.forEach(function(keyword) {
    const matchingNews = newsItems.filter(function(n) {
      return (n.title + ' ' + n.summary).toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
    });

    if (matchingNews.length > 0) {
      alerts.push({
        type: 'keyword',
        keyword: keyword,
        count: matchingNews.length,
        message: keyword + ' mentioned in ' + matchingNews.length + ' news items'
      });
    }
  });

  // Sort by importance
  alerts.sort(function(a, b) {
    const priority = { sentiment: 1, momentum: 2, keyword: 3 };
    return (priority[a.type] || 99) - (priority[b.type] || 99);
  });

  return alerts;
}

/**
 * Generate sentiment report for portfolio
 */
function generateSentimentReport(newsItems, portfolio, marketData) {
  const symbols = [];
  
  // Extract symbols from portfolio
  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    (portfolio[category] || []).forEach(function(pos) {
      const symbol = pos.symbol || pos.name;
      if (symbols.indexOf(symbol) === -1) {
        symbols.push(symbol);
      }
    });
  });

  // Calculate sentiment for each symbol
  const symbolSentiments = symbols.map(function(symbol) {
    return aggregateSentiment(newsItems, symbol);
  });

  // Calculate portfolio-weighted sentiment
  let weightedSentiment = 0;
  let totalValue = 0;

  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    (portfolio[category] || []).forEach(function(pos) {
      const symbol = pos.symbol || pos.name;
      const value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      const symbolSent = symbolSentiments.find(function(s) { return s.symbol === symbol; });
      
      if (symbolSent && symbolSent.newsCount > 0) {
        weightedSentiment += value * symbolSent.aggregateSentiment;
        totalValue += value;
      }
    });
  });

  const portfolioSentiment = totalValue > 0 ? weightedSentiment / totalValue : 0;

  // Fear & Greed
  const fearGreed = calculateFearGreedIndex(marketData || {});

  // Recent important news
  const recentNews = newsItems
    .filter(function(n) {
      return (new Date() - new Date(n.publishedAt)) < 24 * 60 * 60 * 1000;
    })
    .sort(function(a, b) {
      return Math.abs(b.sentiment.score) - Math.abs(a.sentiment.score);
    })
    .slice(0, 10);

  return {
    generated: new Date().toISOString(),
    portfolioSentiment: {
      score: portfolioSentiment,
      label: getSentimentLabel(portfolioSentiment)
    },
    fearGreedIndex: fearGreed,
    symbolSentiments: symbolSentiments.sort(function(a, b) {
      return b.aggregateSentiment - a.aggregateSentiment;
    }),
    mostBullish: symbolSentiments.filter(function(s) {
      return s.aggregateSentiment > 0.3;
    }),
    mostBearish: symbolSentiments.filter(function(s) {
      return s.aggregateSentiment < -0.3;
    }),
    recentImportantNews: recentNews,
    totalNewsAnalyzed: newsItems.length,
    summary: generateSentimentSummary(portfolioSentiment, fearGreed, symbolSentiments)
  };
}

/**
 * Get sentiment label from score
 */
function getSentimentLabel(score) {
  for (var range in SENTIMENT_RANGES) {
    if (score >= SENTIMENT_RANGES[range].min && score < SENTIMENT_RANGES[range].max) {
      return SENTIMENT_RANGES[range].label;
    }
  }
  return 'Neutral';
}

/**
 * Generate sentiment summary
 */
function generateSentimentSummary(portfolioSentiment, fearGreed, symbolSentiments) {
  const summaryPoints = [];

  // Portfolio sentiment
  if (portfolioSentiment > 0.3) {
    summaryPoints.push('Overall portfolio sentiment is bullish');
  } else if (portfolioSentiment < -0.3) {
    summaryPoints.push('Overall portfolio sentiment is bearish');
  } else {
    summaryPoints.push('Portfolio sentiment is neutral');
  }

  // Fear & Greed
  if (fearGreed.index <= 25) {
    summaryPoints.push('Market showing extreme fear - contrarian buying opportunity?');
  } else if (fearGreed.index >= 75) {
    summaryPoints.push('Market showing extreme greed - consider taking profits');
  }

  // Highlight extremes
  const bullish = symbolSentiments.filter(function(s) { return s.aggregateSentiment > 0.5; });
  const bearish = symbolSentiments.filter(function(s) { return s.aggregateSentiment < -0.5; });

  if (bullish.length > 0) {
    summaryPoints.push('Strong bullish sentiment: ' + bullish.map(function(s) {
      return s.symbol;
    }).join(', '));
  }

  if (bearish.length > 0) {
    summaryPoints.push('Strong bearish sentiment: ' + bearish.map(function(s) {
      return s.symbol;
    }).join(', '));
  }

  return summaryPoints;
}

// Export functions
if (typeof window !== 'undefined') {
  window.SentimentNewsEngine = {
    SENTIMENT_RANGES: SENTIMENT_RANGES,
    NEWS_SOURCES: NEWS_SOURCES,
    createNewsItem: createNewsItem,
    analyzeTextSentiment: analyzeTextSentiment,
    aggregateSentiment: aggregateSentiment,
    calculateFearGreedIndex: calculateFearGreedIndex,
    trackSocialMentions: trackSocialMentions,
    detectSentimentDivergence: detectSentimentDivergence,
    generateNewsAlerts: generateNewsAlerts,
    generateSentimentReport: generateSentimentReport
  };
  
  console.log('[OK] Sentiment & News Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SENTIMENT_RANGES,
    NEWS_SOURCES,
    createNewsItem,
    analyzeTextSentiment,
    aggregateSentiment,
    calculateFearGreedIndex,
    trackSocialMentions,
    detectSentimentDivergence,
    generateNewsAlerts,
    generateSentimentReport
  };
}
