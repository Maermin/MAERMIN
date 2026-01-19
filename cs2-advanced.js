// ============================================================================
// MAERMIN v6.0 - CS2 Items Advanced Analytics
// Float value analysis, rarity tracking, market trends
// ============================================================================

/**
 * CS2 Item Rarities and their typical price multipliers
 */
var CS2_RARITIES = {
  'consumer': { name: 'Consumer Grade', color: '#b0c3d9', multiplier: 1 },
  'industrial': { name: 'Industrial Grade', color: '#5e98d9', multiplier: 1.2 },
  'mil-spec': { name: 'Mil-Spec', color: '#4b69ff', multiplier: 1.5 },
  'restricted': { name: 'Restricted', color: '#8847ff', multiplier: 2 },
  'classified': { name: 'Classified', color: '#d32ce6', multiplier: 3 },
  'covert': { name: 'Covert', color: '#eb4b4b', multiplier: 5 },
  'contraband': { name: 'Contraband', color: '#e4ae39', multiplier: 10 },
  'knife': { name: 'Knife', color: '#e4ae39', multiplier: 15 },
  'gloves': { name: 'Gloves', color: '#e4ae39', multiplier: 12 }
};

/**
 * CS2 Wear Conditions and float ranges
 */
var CS2_WEAR_CONDITIONS = {
  'fn': { name: 'Factory New', floatMin: 0, floatMax: 0.07, multiplier: 1.5 },
  'mw': { name: 'Minimal Wear', floatMin: 0.07, floatMax: 0.15, multiplier: 1.2 },
  'ft': { name: 'Field-Tested', floatMin: 0.15, floatMax: 0.38, multiplier: 1 },
  'ww': { name: 'Well-Worn', floatMin: 0.38, floatMax: 0.45, multiplier: 0.8 },
  'bs': { name: 'Battle-Scarred', floatMin: 0.45, floatMax: 1, multiplier: 0.6 }
};

/**
 * Determine wear condition from float value
 */
function getWearCondition(floatValue) {
  if (floatValue < 0.07) return 'fn';
  if (floatValue < 0.15) return 'mw';
  if (floatValue < 0.38) return 'ft';
  if (floatValue < 0.45) return 'ww';
  return 'bs';
}

/**
 * Calculate float value rarity score
 * Lower floats in FN and higher floats in BS are more valuable
 */
function calculateFloatRarityScore(floatValue, wearCondition) {
  var condition = CS2_WEAR_CONDITIONS[wearCondition];
  if (!condition) return 50;
  
  var range = condition.floatMax - condition.floatMin;
  var position = (floatValue - condition.floatMin) / range;
  
  // For FN and MW, lower is better
  if (wearCondition === 'fn' || wearCondition === 'mw') {
    return Math.max(0, 100 - (position * 100));
  }
  
  // For BS, higher (closer to 1.0) is rarer
  if (wearCondition === 'bs') {
    return position * 100;
  }
  
  // For FT and WW, extremes are more interesting
  return 50 + Math.abs(position - 0.5) * 100;
}

/**
 * Analyze CS2 skin portfolio
 */
function analyzeCS2Portfolio(skins) {
  if (!skins || !Array.isArray(skins) || skins.length === 0) {
    return {
      totalValue: 0,
      itemCount: 0,
      rarityDistribution: {},
      wearDistribution: {},
      averageFloat: 0,
      topItems: [],
      recommendations: []
    };
  }
  
  var totalValue = 0;
  var rarityDistribution = {};
  var wearDistribution = {};
  var floatSum = 0;
  var floatCount = 0;
  
  skins.forEach(function(skin) {
    var value = (skin.amount || 1) * (skin.currentPrice || skin.purchasePrice || 0);
    totalValue += value;
    
    // Count by rarity
    var rarity = skin.rarity || 'unknown';
    rarityDistribution[rarity] = (rarityDistribution[rarity] || 0) + 1;
    
    // Count by wear
    var wear = skin.wear || getWearCondition(skin.floatValue || 0.15);
    wearDistribution[wear] = (wearDistribution[wear] || 0) + 1;
    
    // Sum floats
    if (skin.floatValue !== undefined) {
      floatSum += skin.floatValue;
      floatCount++;
    }
  });
  
  // Calculate top items by value
  var topItems = skins.slice().sort(function(a, b) {
    var valueA = (a.amount || 1) * (a.currentPrice || a.purchasePrice || 0);
    var valueB = (b.amount || 1) * (b.currentPrice || b.purchasePrice || 0);
    return valueB - valueA;
  }).slice(0, 5);
  
  // Generate recommendations
  var recommendations = [];
  
  // Check for concentrated value
  if (topItems.length > 0) {
    var topItemValue = (topItems[0].amount || 1) * (topItems[0].currentPrice || topItems[0].purchasePrice || 0);
    if (topItemValue / totalValue > 0.5) {
      recommendations.push({
        type: 'warning',
        message: 'Over 50% of CS2 value is in one item. Consider diversifying.'
      });
    }
  }
  
  // Check for low float FN items
  var lowFloatFN = skins.filter(function(s) {
    return s.floatValue !== undefined && s.floatValue < 0.01;
  });
  if (lowFloatFN.length > 0) {
    recommendations.push({
      type: 'info',
      message: 'You have ' + lowFloatFN.length + ' item(s) with very low float (<0.01). These may command premium prices.'
    });
  }
  
  return {
    totalValue: totalValue,
    itemCount: skins.length,
    rarityDistribution: rarityDistribution,
    wearDistribution: wearDistribution,
    averageFloat: floatCount > 0 ? floatSum / floatCount : 0,
    topItems: topItems,
    recommendations: recommendations
  };
}

/**
 * Estimate item value based on characteristics
 */
function estimateCS2ItemValue(item, basePrice) {
  var multiplier = 1;
  
  // Apply rarity multiplier
  var rarity = CS2_RARITIES[item.rarity];
  if (rarity) {
    multiplier *= rarity.multiplier;
  }
  
  // Apply wear multiplier
  var wear = CS2_WEAR_CONDITIONS[item.wear];
  if (wear) {
    multiplier *= wear.multiplier;
  }
  
  // Apply float rarity bonus (up to 20% for exceptional floats)
  if (item.floatValue !== undefined) {
    var floatScore = calculateFloatRarityScore(item.floatValue, item.wear);
    if (floatScore > 90) {
      multiplier *= 1.2;
    } else if (floatScore > 75) {
      multiplier *= 1.1;
    }
  }
  
  // StatTrak bonus
  if (item.isStatTrak) {
    multiplier *= 1.5;
  }
  
  // Souvenir bonus
  if (item.isSouvenir) {
    multiplier *= 2;
  }
  
  return basePrice * multiplier;
}

/**
 * Calculate CS2 portfolio metrics
 */
function calculateCS2Metrics(skins, priceHistory) {
  var analysis = analyzeCS2Portfolio(skins);
  
  var invested = skins.reduce(function(sum, skin) {
    return sum + (skin.amount || 1) * (skin.purchasePrice || 0);
  }, 0);
  
  var profit = analysis.totalValue - invested;
  var profitPercent = invested > 0 ? (profit / invested) * 100 : 0;
  
  // Calculate holding periods
  var totalHoldingDays = 0;
  var holdingCount = 0;
  var now = new Date();
  
  skins.forEach(function(skin) {
    if (skin.purchaseDate) {
      var purchaseDate = new Date(skin.purchaseDate);
      var days = Math.floor((now - purchaseDate) / (1000 * 60 * 60 * 24));
      totalHoldingDays += days;
      holdingCount++;
    }
  });
  
  var avgHoldingPeriod = holdingCount > 0 ? totalHoldingDays / holdingCount : 0;
  
  return {
    totalValue: analysis.totalValue,
    invested: invested,
    profit: profit,
    profitPercent: profitPercent,
    itemCount: analysis.itemCount,
    avgHoldingPeriod: avgHoldingPeriod,
    rarityDistribution: analysis.rarityDistribution,
    wearDistribution: analysis.wearDistribution,
    averageFloat: analysis.averageFloat,
    topItems: analysis.topItems,
    recommendations: analysis.recommendations
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.CS2_RARITIES = CS2_RARITIES;
  window.CS2_WEAR_CONDITIONS = CS2_WEAR_CONDITIONS;
  window.getWearCondition = getWearCondition;
  window.calculateFloatRarityScore = calculateFloatRarityScore;
  window.analyzeCS2Portfolio = analyzeCS2Portfolio;
  window.estimateCS2ItemValue = estimateCS2ItemValue;
  window.calculateCS2Metrics = calculateCS2Metrics;
  
  console.log('[CS2] Advanced Analytics Module loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CS2_RARITIES: CS2_RARITIES,
    CS2_WEAR_CONDITIONS: CS2_WEAR_CONDITIONS,
    getWearCondition: getWearCondition,
    calculateFloatRarityScore: calculateFloatRarityScore,
    analyzeCS2Portfolio: analyzeCS2Portfolio,
    estimateCS2ItemValue: estimateCS2ItemValue,
    calculateCS2Metrics: calculateCS2Metrics
  };
}
