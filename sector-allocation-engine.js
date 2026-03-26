// ============================================================================
// MAERMIN v6.0 - Sector & Industry Allocation Engine
// Sector breakdown, concentration analysis, and rotation signals
// ============================================================================

/**
 * GICS Sectors (Global Industry Classification Standard)
 */
const SECTORS = {
  technology: {
    name: 'Information Technology',
    color: '#007AFF',
    benchmarkWeight: 0.28, // Approximate S&P 500 weight
    cyclicality: 'growth',
    interestRateSensitivity: 'high'
  },
  healthcare: {
    name: 'Health Care',
    color: '#34C759',
    benchmarkWeight: 0.13,
    cyclicality: 'defensive',
    interestRateSensitivity: 'low'
  },
  financials: {
    name: 'Financials',
    color: '#5856D6',
    benchmarkWeight: 0.13,
    cyclicality: 'cyclical',
    interestRateSensitivity: 'high'
  },
  consumerDiscretionary: {
    name: 'Consumer Discretionary',
    color: '#FF9500',
    benchmarkWeight: 0.10,
    cyclicality: 'cyclical',
    interestRateSensitivity: 'medium'
  },
  communication: {
    name: 'Communication Services',
    color: '#FF2D55',
    benchmarkWeight: 0.09,
    cyclicality: 'growth',
    interestRateSensitivity: 'medium'
  },
  industrials: {
    name: 'Industrials',
    color: '#AF52DE',
    benchmarkWeight: 0.08,
    cyclicality: 'cyclical',
    interestRateSensitivity: 'medium'
  },
  consumerStaples: {
    name: 'Consumer Staples',
    color: '#00C7BE',
    benchmarkWeight: 0.06,
    cyclicality: 'defensive',
    interestRateSensitivity: 'low'
  },
  energy: {
    name: 'Energy',
    color: '#FF6B35',
    benchmarkWeight: 0.04,
    cyclicality: 'cyclical',
    interestRateSensitivity: 'low'
  },
  utilities: {
    name: 'Utilities',
    color: '#FFD60A',
    benchmarkWeight: 0.03,
    cyclicality: 'defensive',
    interestRateSensitivity: 'very_high'
  },
  materials: {
    name: 'Materials',
    color: '#8B4513',
    benchmarkWeight: 0.03,
    cyclicality: 'cyclical',
    interestRateSensitivity: 'medium'
  },
  realEstate: {
    name: 'Real Estate',
    color: '#A0522D',
    benchmarkWeight: 0.03,
    cyclicality: 'cyclical',
    interestRateSensitivity: 'very_high'
  },
  crypto: {
    name: 'Cryptocurrency',
    color: '#F7931A',
    benchmarkWeight: 0,
    cyclicality: 'speculative',
    interestRateSensitivity: 'high'
  },
  gaming: {
    name: 'Gaming/CS2 Items',
    color: '#6C5CE7',
    benchmarkWeight: 0,
    cyclicality: 'cyclical',
    interestRateSensitivity: 'low'
  }
};

/**
 * Stock to sector mapping (common stocks)
 */
const STOCK_SECTOR_MAP = {
  // Technology
  'AAPL': 'technology', 'MSFT': 'technology', 'GOOGL': 'technology', 
  'GOOG': 'technology', 'NVDA': 'technology', 'AMD': 'technology',
  'INTC': 'technology', 'CRM': 'technology', 'ADBE': 'technology',
  'ORCL': 'technology', 'IBM': 'technology', 'CSCO': 'technology',
  
  // Healthcare
  'JNJ': 'healthcare', 'UNH': 'healthcare', 'PFE': 'healthcare',
  'ABBV': 'healthcare', 'MRK': 'healthcare', 'LLY': 'healthcare',
  'TMO': 'healthcare', 'ABT': 'healthcare', 'AMGN': 'healthcare',
  
  // Financials
  'JPM': 'financials', 'BAC': 'financials', 'WFC': 'financials',
  'GS': 'financials', 'MS': 'financials', 'BLK': 'financials',
  'C': 'financials', 'AXP': 'financials', 'V': 'financials',
  'MA': 'financials', 'PYPL': 'financials',
  
  // Consumer Discretionary
  'AMZN': 'consumerDiscretionary', 'TSLA': 'consumerDiscretionary',
  'HD': 'consumerDiscretionary', 'MCD': 'consumerDiscretionary',
  'NKE': 'consumerDiscretionary', 'SBUX': 'consumerDiscretionary',
  'TGT': 'consumerDiscretionary', 'LOW': 'consumerDiscretionary',
  
  // Communication
  'META': 'communication', 'NFLX': 'communication', 'DIS': 'communication',
  'CMCSA': 'communication', 'T': 'communication', 'VZ': 'communication',
  'TMUS': 'communication', 'SPOT': 'communication',
  
  // Industrials
  'CAT': 'industrials', 'BA': 'industrials', 'HON': 'industrials',
  'UPS': 'industrials', 'RTX': 'industrials', 'DE': 'industrials',
  'GE': 'industrials', 'LMT': 'industrials', 'MMM': 'industrials',
  
  // Consumer Staples
  'PG': 'consumerStaples', 'KO': 'consumerStaples', 'PEP': 'consumerStaples',
  'WMT': 'consumerStaples', 'COST': 'consumerStaples', 'PM': 'consumerStaples',
  'MO': 'consumerStaples', 'CL': 'consumerStaples',
  
  // Energy
  'XOM': 'energy', 'CVX': 'energy', 'COP': 'energy',
  'SLB': 'energy', 'EOG': 'energy', 'OXY': 'energy',
  
  // Utilities
  'NEE': 'utilities', 'DUK': 'utilities', 'SO': 'utilities',
  'D': 'utilities', 'AEP': 'utilities',
  
  // Materials
  'LIN': 'materials', 'APD': 'materials', 'SHW': 'materials',
  'FCX': 'materials', 'NEM': 'materials',
  
  // Real Estate
  'AMT': 'realEstate', 'PLD': 'realEstate', 'CCI': 'realEstate',
  'EQIX': 'realEstate', 'SPG': 'realEstate',
  
  // Crypto
  'BTC': 'crypto', 'ETH': 'crypto', 'SOL': 'crypto',
  'ADA': 'crypto', 'DOT': 'crypto', 'AVAX': 'crypto',
  'MATIC': 'crypto', 'LINK': 'crypto', 'XRP': 'crypto'
};

/**
 * Get sector for a symbol
 */
function getSector(symbol, category) {
  const upperSymbol = (symbol || '').toUpperCase();
  
  // Check stock sector map first
  if (STOCK_SECTOR_MAP[upperSymbol]) {
    return STOCK_SECTOR_MAP[upperSymbol];
  }
  
  // Determine by category
  if (category === 'crypto') return 'crypto';
  if (category === 'skins') return 'gaming';
  
  // Default to technology for unknown
  return 'technology';
}

/**
 * Calculate sector allocation for portfolio
 */
function calculateSectorAllocation(portfolio) {
  const allocation = {};
  let totalValue = 0;

  // Initialize all sectors
  Object.keys(SECTORS).forEach(function(sector) {
    allocation[sector] = {
      value: 0,
      positions: [],
      weight: 0
    };
  });

  // Process each category
  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    (portfolio[category] || []).forEach(function(pos) {
      const symbol = pos.symbol || pos.name;
      const value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      const sector = getSector(symbol, category);

      if (allocation[sector]) {
        allocation[sector].value += value;
        allocation[sector].positions.push({
          symbol: symbol,
          value: value,
          category: category
        });
      }

      totalValue += value;
    });
  });

  // Calculate weights
  Object.keys(allocation).forEach(function(sector) {
    allocation[sector].weight = totalValue > 0 ? 
      (allocation[sector].value / totalValue) * 100 : 0;
    allocation[sector].name = SECTORS[sector].name;
    allocation[sector].color = SECTORS[sector].color;
    allocation[sector].benchmarkWeight = SECTORS[sector].benchmarkWeight * 100;
    allocation[sector].overUnderWeight = allocation[sector].weight - 
      (SECTORS[sector].benchmarkWeight * 100);
  });

  return {
    allocation: allocation,
    totalValue: totalValue,
    sectorCount: Object.keys(allocation).filter(function(s) {
      return allocation[s].value > 0;
    }).length
  };
}

/**
 * Analyze sector concentration risk
 */
function analyzeSectorConcentration(portfolio) {
  const sectorData = calculateSectorAllocation(portfolio);
  const allocation = sectorData.allocation;
  
  const concentrationRisks = [];
  let herfindahlIndex = 0;

  // Sort sectors by weight
  const sortedSectors = Object.keys(allocation)
    .filter(function(s) { return allocation[s].weight > 0; })
    .sort(function(a, b) { return allocation[b].weight - allocation[a].weight; });

  sortedSectors.forEach(function(sector) {
    const weight = allocation[sector].weight;
    herfindahlIndex += Math.pow(weight / 100, 2);

    if (weight > 40) {
      concentrationRisks.push({
        sector: sector,
        sectorName: allocation[sector].name,
        weight: weight,
        severity: 'high',
        message: 'Extremely high concentration in ' + allocation[sector].name + 
                ' (' + weight.toFixed(1) + '%) - significant sector risk'
      });
    } else if (weight > 25) {
      concentrationRisks.push({
        sector: sector,
        sectorName: allocation[sector].name,
        weight: weight,
        severity: 'medium',
        message: 'High concentration in ' + allocation[sector].name + 
                ' (' + weight.toFixed(1) + '%)'
      });
    }
  });

  // Normalized Herfindahl Index (0 to 1)
  const normalizedHHI = (herfindahlIndex - 1/sortedSectors.length) / 
                        (1 - 1/sortedSectors.length);

  let diversificationLevel;
  if (normalizedHHI < 0.15) diversificationLevel = 'excellent';
  else if (normalizedHHI < 0.25) diversificationLevel = 'good';
  else if (normalizedHHI < 0.4) diversificationLevel = 'moderate';
  else diversificationLevel = 'poor';

  return {
    concentrationRisks: concentrationRisks,
    herfindahlIndex: herfindahlIndex,
    normalizedHHI: normalizedHHI,
    diversificationLevel: diversificationLevel,
    topSector: sortedSectors[0] ? {
      sector: sortedSectors[0],
      name: allocation[sortedSectors[0]].name,
      weight: allocation[sortedSectors[0]].weight
    } : null,
    top3Sectors: sortedSectors.slice(0, 3).map(function(s) {
      return {
        sector: s,
        name: allocation[s].name,
        weight: allocation[s].weight
      };
    })
  };
}

/**
 * Compare portfolio sectors to benchmark
 */
function compareToBenchmark(portfolio, benchmarkName) {
  benchmarkName = benchmarkName || 'S&P 500';
  const sectorData = calculateSectorAllocation(portfolio);
  const allocation = sectorData.allocation;

  const comparison = [];
  let totalOverweight = 0;
  let totalUnderweight = 0;

  Object.keys(SECTORS).forEach(function(sector) {
    const portfolioWeight = allocation[sector] ? allocation[sector].weight : 0;
    const benchmarkWeight = SECTORS[sector].benchmarkWeight * 100;
    const difference = portfolioWeight - benchmarkWeight;

    if (portfolioWeight > 0 || benchmarkWeight > 0) {
      comparison.push({
        sector: sector,
        name: SECTORS[sector].name,
        portfolioWeight: portfolioWeight,
        benchmarkWeight: benchmarkWeight,
        difference: difference,
        status: difference > 5 ? 'overweight' : 
               difference < -5 ? 'underweight' : 'neutral'
      });

      if (difference > 0) totalOverweight += difference;
      else totalUnderweight += Math.abs(difference);
    }
  });

  // Sort by absolute difference
  comparison.sort(function(a, b) {
    return Math.abs(b.difference) - Math.abs(a.difference);
  });

  // Active share approximation
  const activeShare = comparison.reduce(function(sum, c) {
    return sum + Math.abs(c.difference);
  }, 0) / 2;

  return {
    benchmark: benchmarkName,
    comparison: comparison,
    overweightSectors: comparison.filter(function(c) { return c.status === 'overweight'; }),
    underweightSectors: comparison.filter(function(c) { return c.status === 'underweight'; }),
    totalActivePositioning: totalOverweight + totalUnderweight,
    activeShare: activeShare,
    interpretation: activeShare > 50 ? 'Highly active vs benchmark' :
                   activeShare > 25 ? 'Moderately active vs benchmark' :
                   'Close to benchmark allocation'
  };
}

/**
 * Analyze sector cyclicality exposure
 */
function analyzeCyclicality(portfolio) {
  const sectorData = calculateSectorAllocation(portfolio);
  const allocation = sectorData.allocation;

  const cyclicalityExposure = {
    defensive: 0,
    cyclical: 0,
    growth: 0,
    speculative: 0
  };

  Object.keys(allocation).forEach(function(sector) {
    if (allocation[sector].weight > 0) {
      const cyclicality = SECTORS[sector].cyclicality;
      if (cyclicalityExposure[cyclicality] !== undefined) {
        cyclicalityExposure[cyclicality] += allocation[sector].weight;
      }
    }
  });

  // Determine market regime suitability
  let bestRegime;
  if (cyclicalityExposure.defensive > 40) {
    bestRegime = 'recession';
  } else if (cyclicalityExposure.growth > 40) {
    bestRegime = 'expansion';
  } else if (cyclicalityExposure.cyclical > 40) {
    bestRegime = 'recovery';
  } else {
    bestRegime = 'all-weather';
  }

  return {
    exposure: cyclicalityExposure,
    bestRegime: bestRegime,
    interpretation: getRegimeInterpretation(cyclicalityExposure),
    recommendations: getCyclicalityRecommendations(cyclicalityExposure)
  };
}

/**
 * Get regime interpretation
 */
function getRegimeInterpretation(exposure) {
  if (exposure.defensive > 50) {
    return 'Portfolio is defensively positioned - may underperform in bull markets';
  } else if (exposure.cyclical > 50) {
    return 'Portfolio is cyclically positioned - may outperform in economic recovery';
  } else if (exposure.growth > 40) {
    return 'Portfolio has strong growth tilt - sensitive to interest rate changes';
  } else if (exposure.speculative > 30) {
    return 'Portfolio has significant speculative exposure - high risk/reward';
  }
  return 'Portfolio has balanced cyclicality exposure';
}

/**
 * Get cyclicality recommendations
 */
function getCyclicalityRecommendations(exposure) {
  const recommendations = [];

  if (exposure.defensive > 60) {
    recommendations.push({
      type: 'suggestion',
      message: 'Consider adding cyclical exposure if you expect economic growth'
    });
  }

  if (exposure.cyclical > 60) {
    recommendations.push({
      type: 'warning',
      message: 'High cyclical exposure - vulnerable to economic slowdown'
    });
  }

  if (exposure.speculative > 40) {
    recommendations.push({
      type: 'warning',
      message: 'High speculative allocation - ensure this aligns with your risk tolerance'
    });
  }

  if (exposure.defensive < 15 && exposure.speculative < 30) {
    recommendations.push({
      type: 'suggestion',
      message: 'Consider adding defensive sectors for downside protection'
    });
  }

  return recommendations;
}

/**
 * Analyze interest rate sensitivity
 */
function analyzeInterestRateSensitivity(portfolio) {
  const sectorData = calculateSectorAllocation(portfolio);
  const allocation = sectorData.allocation;

  const sensitivity = {
    veryHigh: 0,
    high: 0,
    medium: 0,
    low: 0
  };

  const sensitivityMapping = {
    very_high: 'veryHigh',
    high: 'high',
    medium: 'medium',
    low: 'low'
  };

  Object.keys(allocation).forEach(function(sector) {
    if (allocation[sector].weight > 0) {
      const sectorSensitivity = SECTORS[sector].interestRateSensitivity;
      const mapped = sensitivityMapping[sectorSensitivity];
      if (mapped) {
        sensitivity[mapped] += allocation[sector].weight;
      }
    }
  });

  // Calculate overall sensitivity score (0-100)
  const sensitivityScore = 
    (sensitivity.veryHigh * 1 + sensitivity.high * 0.7 + 
     sensitivity.medium * 0.4 + sensitivity.low * 0.1);

  let outlook;
  if (sensitivityScore > 60) {
    outlook = 'Portfolio will likely underperform if rates rise significantly';
  } else if (sensitivityScore > 40) {
    outlook = 'Portfolio has moderate interest rate sensitivity';
  } else {
    outlook = 'Portfolio is relatively insulated from rate changes';
  }

  return {
    sensitivity: sensitivity,
    sensitivityScore: sensitivityScore,
    outlook: outlook,
    risingSateImpact: sensitivityScore > 50 ? 'negative' : 'neutral',
    fallingSateImpact: sensitivityScore > 50 ? 'positive' : 'neutral'
  };
}

/**
 * Generate sector rotation signals based on economic cycle
 */
function generateSectorRotationSignals(currentCyclePhase) {
  const signals = {
    earlyRecovery: {
      overweight: ['consumerDiscretionary', 'financials', 'industrials', 'materials'],
      underweight: ['utilities', 'consumerStaples', 'healthcare'],
      description: 'Early cycle favors cyclicals and financials'
    },
    midCycle: {
      overweight: ['technology', 'industrials', 'materials'],
      underweight: ['utilities', 'consumerStaples'],
      description: 'Mid cycle favors technology and industrials'
    },
    lateCycle: {
      overweight: ['energy', 'materials', 'healthcare'],
      underweight: ['technology', 'consumerDiscretionary'],
      description: 'Late cycle favors energy and commodities'
    },
    recession: {
      overweight: ['utilities', 'consumerStaples', 'healthcare'],
      underweight: ['consumerDiscretionary', 'financials', 'industrials'],
      description: 'Recession favors defensive sectors'
    }
  };

  const currentSignal = signals[currentCyclePhase] || signals.midCycle;

  return {
    phase: currentCyclePhase,
    signal: currentSignal,
    overweightSectors: currentSignal.overweight.map(function(s) {
      return { sector: s, name: SECTORS[s].name };
    }),
    underweightSectors: currentSignal.underweight.map(function(s) {
      return { sector: s, name: SECTORS[s].name };
    })
  };
}

/**
 * Generate sector allocation report
 */
function generateSectorReport(portfolio, config) {
  config = config || {};
  const currentCycle = config.economicCycle || 'midCycle';

  const allocation = calculateSectorAllocation(portfolio);
  const concentration = analyzeSectorConcentration(portfolio);
  const benchmarkComparison = compareToBenchmark(portfolio);
  const cyclicality = analyzeCyclicality(portfolio);
  const rateSensitivity = analyzeInterestRateSensitivity(portfolio);
  const rotationSignals = generateSectorRotationSignals(currentCycle);

  return {
    generated: new Date().toISOString(),
    allocation: allocation,
    concentration: concentration,
    benchmarkComparison: benchmarkComparison,
    cyclicality: cyclicality,
    interestRateSensitivity: rateSensitivity,
    rotationSignals: rotationSignals,
    summary: {
      topSector: concentration.topSector,
      diversificationLevel: concentration.diversificationLevel,
      activeShare: benchmarkComparison.activeShare,
      regime: cyclicality.bestRegime
    }
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.SectorAllocationEngine = {
    SECTORS: SECTORS,
    getSector: getSector,
    calculateSectorAllocation: calculateSectorAllocation,
    analyzeSectorConcentration: analyzeSectorConcentration,
    compareToBenchmark: compareToBenchmark,
    analyzeCyclicality: analyzeCyclicality,
    analyzeInterestRateSensitivity: analyzeInterestRateSensitivity,
    generateSectorRotationSignals: generateSectorRotationSignals,
    generateSectorReport: generateSectorReport
  };
  
  console.log('[OK] Sector Allocation Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SECTORS,
    getSector,
    calculateSectorAllocation,
    analyzeSectorConcentration,
    compareToBenchmark,
    analyzeCyclicality,
    analyzeInterestRateSensitivity,
    generateSectorRotationSignals,
    generateSectorReport
  };
}
