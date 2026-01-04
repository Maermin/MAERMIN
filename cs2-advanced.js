// ============================================================================
// MAERMIN v4.0 - CS2 Advanced Analytics
// ============================================================================
// Specialized features for Counter-Strike 2 item tracking
// ============================================================================

// ============================================================================
// FLOAT VALUE ANALYSIS
// ============================================================================

/**
 * Analyze CS2 item performance by float value ranges
 * @param {Array} cs2Items - Array of CS2 positions
 * @returns {Object} Float analysis with recommendations
 */
function analyzeFloatPerformance(cs2Items) {
  if (!cs2Items || cs2Items.length === 0) {
    return {
      floatRanges: {},
      bestPerforming: null,
      recommendations: []
    };
  }
  
  // Define float ranges
  const ranges = {
    factoryNew: { min: 0, max: 0.07, items: [], avgReturn: 0 },
    minimalWear: { min: 0.07, max: 0.15, items: [], avgReturn: 0 },
    fieldTested: { min: 0.15, max: 0.38, items: [], avgReturn: 0 },
    wellWorn: { min: 0.38, max: 0.45, items: [], avgReturn: 0 },
    battleScarred: { min: 0.45, max: 1.0, items: [], avgReturn: 0 }
  };
  
  // Categorize items by float
  cs2Items.forEach(item => {
    const float = item.metadata?.float || 0.5;
    const currentPrice = item.currentPrice || item.purchasePrice || 0;
    const purchasePrice = item.purchasePrice || currentPrice;
    const returnPct = purchasePrice > 0 ? ((currentPrice - purchasePrice) / purchasePrice) * 100 : 0;
    
    let assignedRange = null;
    for (const [rangeName, range] of Object.entries(ranges)) {
      if (float >= range.min && float < range.max) {
        range.items.push({ ...item, returnPct, float });
        assignedRange = rangeName;
        break;
      }
    }
  });
  
  // Calculate average returns per range
  for (const [rangeName, range] of Object.entries(ranges)) {
    if (range.items.length > 0) {
      range.avgReturn = range.items.reduce((sum, item) => sum + item.returnPct, 0) / range.items.length;
      range.count = range.items.length;
      range.totalValue = range.items.reduce((sum, item) => 
        sum + (item.amount * (item.currentPrice || item.purchasePrice || 0)), 0);
    }
  }
  
  // Find best performing range
  let bestRange = null;
  let bestReturn = -Infinity;
  for (const [rangeName, range] of Object.entries(ranges)) {
    if (range.count > 0 && range.avgReturn > bestReturn) {
      bestReturn = range.avgReturn;
      bestRange = { name: rangeName, ...range };
    }
  }
  
  // Generate recommendations
  const recommendations = [];
  
  // Check for low-float premium opportunities
  const fnItems = ranges.factoryNew.items;
  if (fnItems.length > 0) {
    const veryLowFloat = fnItems.filter(item => item.float < 0.01);
    if (veryLowFloat.length > 0) {
      recommendations.push({
        type: 'low-float-premium',
        message: `You own ${veryLowFloat.length} very low float items (< 0.01). These often command significant premiums.`,
        action: 'Consider specialized marketplaces for low-float items to maximize value.'
      });
    }
  }
  
  // Check for underperforming float ranges
  if (ranges.battleScarred.count > 0 && ranges.battleScarred.avgReturn < -10) {
    recommendations.push({
      type: 'underperforming-float',
      message: 'Battle-Scarred items showing poor performance.',
      action: 'Consider upgrading to better condition items or diversifying float ranges.'
    });
  }
  
  return {
    floatRanges: ranges,
    bestPerforming: bestRange,
    recommendations: recommendations
  };
}

// ============================================================================
// STICKER INVESTMENT TRACKING
// ============================================================================

/**
 * Analyze sticker investments and contributions to weapon value
 * @param {Array} cs2Items - Array of CS2 positions
 * @param {Object} stickerPriceData - Market prices for stickers (optional)
 * @returns {Object} Sticker analysis
 */
function analyzeStickerInvestments(cs2Items, stickerPriceData) {
  stickerPriceData = stickerPriceData || {};
  
  if (!cs2Items || cs2Items.length === 0) {
    return {
      totalStickerValue: 0,
      weaponsWithStickers: 0,
      stickerContributionPercent: 0,
      topStickerWeapons: [],
      recommendations: []
    };
  }
  
  const weaponsWithStickers = cs2Items.filter(item => 
    item.metadata?.stickers && item.metadata.stickers.length > 0
  );
  
  if (weaponsWithStickers.length === 0) {
    return {
      totalStickerValue: 0,
      weaponsWithStickers: 0,
      stickerContributionPercent: 0,
      topStickerWeapons: [],
      recommendations: [{
        type: 'no-stickers',
        message: 'No stickered items in portfolio.',
        action: 'Consider tournament sticker investments. Major tournament stickers often appreciate significantly.'
      }]
    };
  }
  
  // Calculate sticker values
  let totalStickerValue = 0;
  let totalWeaponBaseValue = 0;
  
  const weaponsWithStickerAnalysis = weaponsWithStickers.map(item => {
    const stickers = item.metadata.stickers || [];
    const itemCurrentPrice = item.currentPrice || item.purchasePrice || 0;
    
    // Estimate sticker value (simplified - in production use market data)
    let estimatedStickerValue = 0;
    stickers.forEach(sticker => {
      // Check if we have real price data
      if (stickerPriceData[sticker.name]) {
        estimatedStickerValue += stickerPriceData[sticker.name];
      } else {
        // Rough estimation based on sticker type
        if (sticker.name.includes('Gold')) {
          estimatedStickerValue += 100;
        } else if (sticker.name.includes('Holo')) {
          estimatedStickerValue += 50;
        } else if (sticker.name.includes('Foil')) {
          estimatedStickerValue += 30;
        } else {
          estimatedStickerValue += 10; // Regular sticker
        }
      }
    });
    
    // Sticker value is typically 10-30% of market price when applied
    const appliedStickerValue = estimatedStickerValue * 0.15; // 15% average
    const baseWeaponValue = Math.max(itemCurrentPrice - appliedStickerValue, itemCurrentPrice * 0.7);
    
    totalStickerValue += appliedStickerValue;
    totalWeaponBaseValue += baseWeaponValue;
    
    const stickerContribution = itemCurrentPrice > 0 ? (appliedStickerValue / itemCurrentPrice) * 100 : 0;
    
    return {
      ...item,
      stickerValue: appliedStickerValue,
      baseValue: baseWeaponValue,
      stickerContribution: stickerContribution,
      stickerCount: stickers.length
    };
  });
  
  // Sort by sticker contribution
  const topStickerWeapons = weaponsWithStickerAnalysis
    .sort((a, b) => b.stickerValue - a.stickerValue)
    .slice(0, 5);
  
  const totalPortfolioValue = cs2Items.reduce((sum, item) => 
    sum + (item.amount * (item.currentPrice || item.purchasePrice || 0)), 0);
  
  const stickerContributionPercent = totalPortfolioValue > 0 ? 
    (totalStickerValue / totalPortfolioValue) * 100 : 0;
  
  // Generate recommendations
  const recommendations = [];
  
  if (stickerContributionPercent > 50) {
    recommendations.push({
      type: 'high-sticker-exposure',
      message: `Stickers represent ${stickerContributionPercent.toFixed(1)}% of CS2 portfolio value.`,
      action: 'High sticker exposure. Consider liquidity risk - stickered items harder to sell.'
    });
  }
  
  if (totalStickerValue > 1000) {
    recommendations.push({
      type: 'significant-sticker-investment',
      message: `Estimated ${totalStickerValue.toFixed(0)} in applied sticker value.`,
      action: 'Track individual sticker prices. Major tournament stickers can appreciate 300%+.'
    });
  }
  
  return {
    totalStickerValue: totalStickerValue,
    weaponsWithStickers: weaponsWithStickers.length,
    stickerContributionPercent: stickerContributionPercent,
    topStickerWeapons: topStickerWeapons.map(w => ({
      name: w.symbol || w.name,
      stickerValue: w.stickerValue,
      stickerCount: w.stickerCount,
      contribution: w.stickerContribution
    })),
    recommendations: recommendations
  };
}

// ============================================================================
// RARITY-BASED PERFORMANCE ANALYSIS
// ============================================================================

/**
 * Analyze CS2 items by rarity and performance
 * @param {Array} cs2Items - Array of CS2 positions
 * @returns {Object} Rarity analysis
 */
function analyzeRarityPerformance(cs2Items) {
  if (!cs2Items || cs2Items.length === 0) {
    return { rarityBreakdown: {}, recommendations: [] };
  }
  
  const rarities = {
    consumer: { name: 'Consumer Grade', items: [], avgReturn: 0, color: '#b0c3d9' },
    industrial: { name: 'Industrial Grade', items: [], avgReturn: 0, color: '#5e98d9' },
    milSpec: { name: 'Mil-Spec', items: [], avgReturn: 0, color: '#4b69ff' },
    restricted: { name: 'Restricted', items: [], avgReturn: 0, color: '#8847ff' },
    classified: { name: 'Classified', items: [], avgReturn: 0, color: '#d32ce6' },
    covert: { name: 'Covert', items: [], avgReturn: 0, color: '#eb4b4b' },
    contraband: { name: 'Contraband', items: [], avgReturn: 0, color: '#e4ae39' },
    knife: { name: 'Knife', items: [], avgReturn: 0, color: '#ffd700' }
  };
  
  // Categorize items
  cs2Items.forEach(item => {
    const rarity = item.metadata?.rarity || 'industrial';
    const currentPrice = item.currentPrice || item.purchasePrice || 0;
    const purchasePrice = item.purchasePrice || currentPrice;
    const returnPct = purchasePrice > 0 ? ((currentPrice - purchasePrice) / purchasePrice) * 100 : 0;
    
    if (rarities[rarity]) {
      rarities[rarity].items.push({ ...item, returnPct });
    }
  });
  
  // Calculate metrics per rarity
  for (const [rarityKey, rarity] of Object.entries(rarities)) {
    if (rarity.items.length > 0) {
      rarity.count = rarity.items.length;
      rarity.avgReturn = rarity.items.reduce((sum, item) => sum + item.returnPct, 0) / rarity.count;
      rarity.totalValue = rarity.items.reduce((sum, item) => 
        sum + (item.amount * (item.currentPrice || item.purchasePrice || 0)), 0);
      rarity.avgValue = rarity.totalValue / rarity.count;
    }
  }
  
  // Find best performing rarity
  let bestRarity = null;
  let bestReturn = -Infinity;
  for (const [key, rarity] of Object.entries(rarities)) {
    if (rarity.count > 0 && rarity.avgReturn > bestReturn) {
      bestReturn = rarity.avgReturn;
      bestRarity = { key, ...rarity };
    }
  }
  
  // Generate recommendations
  const recommendations = [];
  
  if (rarities.knife.count > 0) {
    const knifeValue = rarities.knife.totalValue;
    const totalValue = Object.values(rarities).reduce((sum, r) => sum + (r.totalValue || 0), 0);
    const knifePercent = (knifeValue / totalValue) * 100;
    
    if (knifePercent > 50) {
      recommendations.push({
        type: 'high-knife-concentration',
        message: `Knives represent ${knifePercent.toFixed(1)}% of CS2 portfolio.`,
        action: 'Consider diversification. Knife market can be illiquid for high-value items.'
      });
    }
  }
  
  if (rarities.covert.count === 0 && rarities.classified.count === 0 && cs2Items.length > 5) {
    recommendations.push({
      type: 'low-rarity-focus',
      message: 'Portfolio focused on lower-rarity items.',
      action: 'Consider adding Classified/Covert items for better long-term appreciation potential.'
    });
  }
  
  return {
    rarityBreakdown: rarities,
    bestPerforming: bestRarity,
    recommendations: recommendations
  };
}

// ============================================================================
// CS2 MARKET SENTIMENT INDICATORS
// ============================================================================

/**
 * Calculate CS2 market health indicators
 * @param {Array} cs2Items - Array of CS2 positions
 * @param {Object} marketData - Additional market data (optional)
 * @returns {Object} Market sentiment
 */
function calculateCS2MarketSentiment(cs2Items, marketData) {
  marketData = marketData || {};
  
  if (!cs2Items || cs2Items.length === 0) {
    return {
      sentiment: 'neutral',
      score: 50,
      indicators: {},
      signals: []
    };
  }
  
  let sentimentScore = 50; // 0-100, 50 is neutral
  const indicators = {};
  const signals = [];
  
  // Indicator 1: Price momentum (% of items with positive returns)
  const itemsWithGains = cs2Items.filter(item => {
    const current = item.currentPrice || item.purchasePrice || 0;
    const purchase = item.purchasePrice || current;
    return current > purchase;
  }).length;
  
  const momentumPercent = (itemsWithGains / cs2Items.length) * 100;
  indicators.momentum = momentumPercent;
  
  if (momentumPercent > 70) {
    sentimentScore += 15;
    signals.push({ type: 'positive', message: 'Strong upward momentum. 70%+ positions profitable.' });
  } else if (momentumPercent < 30) {
    sentimentScore -= 15;
    signals.push({ type: 'negative', message: 'Weak momentum. 70%+ positions losing value.' });
  }
  
  // Indicator 2: Average holding return
  const avgReturn = cs2Items.reduce((sum, item) => {
    const current = item.currentPrice || item.purchasePrice || 0;
    const purchase = item.purchasePrice || current;
    const ret = purchase > 0 ? ((current - purchase) / purchase) * 100 : 0;
    return sum + ret;
  }, 0) / cs2Items.length;
  
  indicators.avgReturn = avgReturn;
  
  if (avgReturn > 20) {
    sentimentScore += 10;
    signals.push({ type: 'positive', message: `Average return of ${avgReturn.toFixed(1)}% is strong.` });
  } else if (avgReturn < -20) {
    sentimentScore -= 10;
    signals.push({ type: 'negative', message: `Average return of ${avgReturn.toFixed(1)}% is concerning.` });
  }
  
  // Indicator 3: Volatility (proxy for market activity)
  // Higher volatility can indicate either opportunity or instability
  const recentVolatility = calculateRecentVolatility(cs2Items);
  indicators.volatility = recentVolatility;
  
  if (recentVolatility > 60) {
    signals.push({ type: 'warning', message: 'High volatility detected. Exercise caution.' });
  }
  
  // Determine overall sentiment
  let sentiment = 'neutral';
  if (sentimentScore >= 65) sentiment = 'bullish';
  else if (sentimentScore >= 55) sentiment = 'slightly bullish';
  else if (sentimentScore <= 35) sentiment = 'bearish';
  else if (sentimentScore <= 45) sentiment = 'slightly bearish';
  
  return {
    sentiment: sentiment,
    score: Math.round(sentimentScore),
    indicators: indicators,
    signals: signals
  };
}

function calculateRecentVolatility(items) {
  // Simplified volatility measure based on price spreads
  const volatilities = items.map(item => {
    const current = item.currentPrice || item.purchasePrice || 0;
    const purchase = item.purchasePrice || current;
    const change = purchase > 0 ? Math.abs((current - purchase) / purchase) * 100 : 0;
    return change;
  });
  
  return volatilities.reduce((sum, v) => sum + v, 0) / Math.max(volatilities.length, 1);
}

// ============================================================================
// CASE OPENING EXPECTED VALUE CALCULATOR
// ============================================================================

/**
 * Calculate expected value of opening CS2 cases
 * @param {Object} caseData - Case information with contents and prices
 * @param {number} keyPrice - Current key price
 * @returns {Object} EV analysis
 */
function calculateCaseOpeningEV(caseData, keyPrice) {
  keyPrice = keyPrice || 2.5; // Default key price
  
  if (!caseData || !caseData.contents) {
    return {
      expectedValue: 0,
      ev: -keyPrice,
      breakEvenProbability: 0,
      recommendation: 'Insufficient case data'
    };
  }
  
  const contents = caseData.contents || [];
  
  // Calculate expected value
  let expectedValue = 0;
  contents.forEach(item => {
    const probability = item.probability || 0;
    const value = item.marketPrice || 0;
    expectedValue += probability * value;
  });
  
  const netEV = expectedValue - keyPrice;
  const evPercent = (netEV / keyPrice) * 100;
  
  // Calculate break-even probability
  const profitableItems = contents.filter(item => (item.marketPrice || 0) > keyPrice);
  const breakEvenProb = profitableItems.reduce((sum, item) => sum + (item.probability || 0), 0) * 100;
  
  // Generate recommendation
  let recommendation = '';
  if (netEV > 0) {
    recommendation = `POSITIVE EV! Expected profit of $${netEV.toFixed(2)} per case. Very rare - consider opening.`;
  } else if (evPercent > -20) {
    recommendation = `Near break-even (${evPercent.toFixed(1)}% EV). Only open for entertainment, not profit.`;
  } else {
    recommendation = `Negative EV (${evPercent.toFixed(1)}%). Better to buy items directly from market.`;
  }
  
  return {
    expectedValue: expectedValue,
    ev: netEV,
    evPercent: evPercent,
    breakEvenProbability: breakEvenProb,
    keyPrice: keyPrice,
    recommendation: recommendation
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof window !== 'undefined') {
  window.analyzeFloatPerformance = analyzeFloatPerformance;
  window.analyzeStickerInvestments = analyzeStickerInvestments;
  window.analyzeRarityPerformance = analyzeRarityPerformance;
  window.calculateCS2MarketSentiment = calculateCS2MarketSentiment;
  window.calculateCaseOpeningEV = calculateCaseOpeningEV;
  
  console.log('[OK] CS2 Advanced Analytics loaded v4.0');
}
