// ============================================================================
// MAERMIN v6.0 - Margin & Leverage Tracker Engine
// Margin utilization, leverage ratios, margin call simulation
// ============================================================================

/**
 * Margin requirements by asset class
 */
const MARGIN_REQUIREMENTS = {
  stocks: {
    initial: 0.50,      // 50% initial margin
    maintenance: 0.25,  // 25% maintenance margin
    concentrated: 0.30  // Higher for concentrated positions
  },
  etf: {
    initial: 0.50,
    maintenance: 0.25,
    leveraged: 0.75     // Higher for leveraged ETFs
  },
  crypto: {
    initial: 0.50,      // Varies by exchange
    maintenance: 0.20,
    volatile: 0.80      // For highly volatile coins
  },
  options: {
    initial: 1.00,      // Full premium for long options
    maintenance: 0.20,  // For short options
    nakedCall: 1.00     // Naked calls require full margin
  },
  forex: {
    initial: 0.02,      // 50:1 leverage typical
    maintenance: 0.01
  }
};

/**
 * Create margin account
 */
function createMarginAccount(config) {
  const {
    accountValue,
    cashBalance,
    marginDebt = 0,
    positions = [],
    marginRate = 0.08  // Annual interest rate on margin
  } = config;

  return {
    id: 'margin_' + Date.now(),
    accountValue: accountValue,
    cashBalance: cashBalance,
    marginDebt: marginDebt,
    positions: positions,
    marginRate: marginRate,
    createdAt: new Date().toISOString()
  };
}

/**
 * Calculate margin metrics for account
 */
function calculateMarginMetrics(account) {
  const positions = account.positions || [];
  
  // Calculate total position value
  let longValue = 0;
  let shortValue = 0;
  
  positions.forEach(function(pos) {
    const value = (pos.amount || 0) * (pos.currentPrice || 0);
    if (pos.isShort) {
      shortValue += Math.abs(value);
    } else {
      longValue += value;
    }
  });

  const totalPositionValue = longValue + shortValue;
  const equity = account.accountValue - account.marginDebt;
  const marginDebt = account.marginDebt || 0;
  
  // Calculate leverage ratio
  const leverageRatio = equity > 0 ? totalPositionValue / equity : 0;
  
  // Calculate margin utilization
  const initialMarginRequired = calculateRequiredMargin(positions, 'initial');
  const maintenanceMarginRequired = calculateRequiredMargin(positions, 'maintenance');
  
  const marginUtilization = initialMarginRequired > 0 ? 
    (marginDebt / initialMarginRequired) * 100 : 0;
  
  // Excess margin / margin cushion
  const excessMargin = equity - maintenanceMarginRequired;
  const marginCushionPercent = equity > 0 ? 
    (excessMargin / equity) * 100 : 0;
  
  // Distance to margin call
  const distanceToMarginCall = calculateDistanceToMarginCall(
    totalPositionValue, equity, maintenanceMarginRequired
  );

  // Daily interest cost
  const dailyInterestCost = (marginDebt * account.marginRate) / 365;

  return {
    equity: equity,
    marginDebt: marginDebt,
    totalPositionValue: totalPositionValue,
    longValue: longValue,
    shortValue: shortValue,
    leverageRatio: leverageRatio,
    initialMarginRequired: initialMarginRequired,
    maintenanceMarginRequired: maintenanceMarginRequired,
    marginUtilization: marginUtilization,
    excessMargin: excessMargin,
    marginCushionPercent: marginCushionPercent,
    distanceToMarginCall: distanceToMarginCall,
    dailyInterestCost: dailyInterestCost,
    monthlyInterestCost: dailyInterestCost * 30,
    annualInterestCost: marginDebt * account.marginRate,
    status: getMarginStatus(marginUtilization, marginCushionPercent)
  };
}

/**
 * Calculate required margin for positions
 */
function calculateRequiredMargin(positions, marginType) {
  let totalRequired = 0;

  positions.forEach(function(pos) {
    const value = Math.abs((pos.amount || 0) * (pos.currentPrice || 0));
    const assetType = pos.assetType || 'stocks';
    const requirements = MARGIN_REQUIREMENTS[assetType] || MARGIN_REQUIREMENTS.stocks;
    
    let marginRate = requirements[marginType] || requirements.initial;
    
    // Adjust for concentrated positions
    if (pos.isConcentrated) {
      marginRate = Math.max(marginRate, requirements.concentrated || 0.30);
    }
    
    // Adjust for volatility
    if (pos.isVolatile) {
      marginRate = Math.min(1, marginRate * 1.5);
    }

    totalRequired += value * marginRate;
  });

  return totalRequired;
}

/**
 * Get margin account status
 */
function getMarginStatus(utilization, cushion) {
  if (cushion < 0) {
    return {
      level: 'danger',
      message: 'MARGIN CALL - Deposit funds or close positions immediately',
      color: '#FF0000'
    };
  }
  if (cushion < 10) {
    return {
      level: 'warning',
      message: 'Near margin call - consider reducing leverage',
      color: '#FF6600'
    };
  }
  if (utilization > 80) {
    return {
      level: 'caution',
      message: 'High margin utilization',
      color: '#FFCC00'
    };
  }
  if (utilization > 50) {
    return {
      level: 'moderate',
      message: 'Moderate margin usage',
      color: '#99CC00'
    };
  }
  return {
    level: 'healthy',
    message: 'Comfortable margin cushion',
    color: '#00CC00'
  };
}

/**
 * Calculate distance to margin call
 */
function calculateDistanceToMarginCall(positionValue, equity, maintenanceMargin) {
  if (positionValue <= 0) return { percent: 100, priceMove: 'N/A' };
  
  // Equity must stay above maintenance margin
  // Find % drop that would trigger margin call
  // At margin call: (positionValue * (1 - x)) - marginDebt = maintenanceMargin * (positionValue * (1 - x))
  
  const marginDebt = positionValue - equity;
  
  // Simplified calculation
  const currentMarginPct = equity / positionValue;
  const maintenanceMarginPct = maintenanceMargin / positionValue;
  
  const dropToMarginCall = currentMarginPct - maintenanceMarginPct;
  const percentToMarginCall = (dropToMarginCall / currentMarginPct) * 100;

  return {
    percent: Math.max(0, percentToMarginCall),
    absoluteDrop: positionValue * dropToMarginCall,
    message: percentToMarginCall > 0 ?
      'Portfolio can drop ' + percentToMarginCall.toFixed(1) + '% before margin call' :
      'MARGIN CALL TRIGGERED'
  };
}

/**
 * Simulate margin call scenario
 */
function simulateMarginCall(account, priceDropPercent) {
  const positions = account.positions || [];
  const metrics = calculateMarginMetrics(account);
  
  // Apply price drop to all positions
  const newPositions = positions.map(function(pos) {
    const newPrice = pos.currentPrice * (1 - priceDropPercent / 100);
    return Object.assign({}, pos, { currentPrice: newPrice });
  });

  // Calculate new position value
  let newPositionValue = 0;
  newPositions.forEach(function(pos) {
    newPositionValue += Math.abs((pos.amount || 0) * (pos.currentPrice || 0));
  });

  // New equity
  const newEquity = newPositionValue - account.marginDebt;
  
  // New maintenance requirement
  const newMaintenanceRequired = calculateRequiredMargin(newPositions, 'maintenance');
  
  // Check for margin call
  const marginCallTriggered = newEquity < newMaintenanceRequired;
  const marginDeficit = marginCallTriggered ? newMaintenanceRequired - newEquity : 0;

  // What needs to happen to meet margin call
  let actionsNeeded = [];
  if (marginCallTriggered) {
    actionsNeeded.push({
      action: 'Deposit Cash',
      amount: marginDeficit,
      description: 'Deposit €' + marginDeficit.toFixed(2) + ' to meet margin requirement'
    });
    
    // Or sell positions
    const sellAmount = marginDeficit / (1 - MARGIN_REQUIREMENTS.stocks.maintenance);
    actionsNeeded.push({
      action: 'Sell Positions',
      amount: sellAmount,
      description: 'Sell €' + sellAmount.toFixed(2) + ' worth of positions'
    });
  }

  return {
    priceDropPercent: priceDropPercent,
    originalValue: metrics.totalPositionValue,
    newPositionValue: newPositionValue,
    originalEquity: metrics.equity,
    newEquity: newEquity,
    valueLost: metrics.totalPositionValue - newPositionValue,
    equityLost: metrics.equity - newEquity,
    marginCallTriggered: marginCallTriggered,
    marginDeficit: marginDeficit,
    actionsNeeded: actionsNeeded
  };
}

/**
 * Calculate optimal leverage for risk tolerance
 */
function calculateOptimalLeverage(portfolio, riskTolerance, maxDrawdownAcceptable) {
  const volatility = portfolio.volatility || 0.20; // Annual volatility
  
  // Kelly Criterion simplified
  const expectedReturn = portfolio.expectedReturn || 0.08;
  const riskFreeRate = 0.02;
  const excessReturn = expectedReturn - riskFreeRate;
  
  const kellyLeverage = excessReturn / (volatility * volatility);
  
  // Adjust for risk tolerance
  const riskMultiplier = {
    conservative: 0.25,
    moderate: 0.50,
    aggressive: 0.75,
    veryAggressive: 1.00
  }[riskTolerance] || 0.50;

  const recommendedLeverage = kellyLeverage * riskMultiplier;
  
  // Calculate max leverage for acceptable drawdown
  // Approximate: maxDrawdown ≈ leverage * volatility * 2 (99% confidence)
  const maxLeverageForDrawdown = maxDrawdownAcceptable / (volatility * 2);

  // Take the more conservative of the two
  const optimalLeverage = Math.min(
    Math.max(1, recommendedLeverage),
    maxLeverageForDrawdown,
    4 // Hard cap at 4x leverage
  );

  return {
    kellyOptimal: kellyLeverage,
    riskAdjusted: recommendedLeverage,
    maxForDrawdown: maxLeverageForDrawdown,
    recommended: optimalLeverage,
    portfolioVolatility: volatility * 100,
    expectedReturn: expectedReturn * 100,
    expectedDrawdown: optimalLeverage * volatility * 2 * 100,
    interpretation: interpretLeverageRecommendation(optimalLeverage, riskTolerance)
  };
}

/**
 * Interpret leverage recommendation
 */
function interpretLeverageRecommendation(leverage, riskTolerance) {
  if (leverage <= 1) {
    return 'No leverage recommended - use cash positions only';
  } else if (leverage <= 1.5) {
    return 'Minimal leverage appropriate - up to 1.5x';
  } else if (leverage <= 2) {
    return 'Moderate leverage acceptable - up to 2x';
  } else if (leverage <= 3) {
    return 'Higher leverage possible but use caution - up to 3x';
  }
  return 'High leverage - only for experienced traders with strict risk management';
}

/**
 * Track margin over time
 */
function trackMarginHistory(currentMetrics, history) {
  history = history || [];
  
  history.push({
    timestamp: new Date().toISOString(),
    equity: currentMetrics.equity,
    marginDebt: currentMetrics.marginDebt,
    leverageRatio: currentMetrics.leverageRatio,
    marginUtilization: currentMetrics.marginUtilization,
    marginCushion: currentMetrics.marginCushionPercent
  });

  // Keep last 365 days
  if (history.length > 365) {
    history = history.slice(-365);
  }

  // Calculate trends
  const recent = history.slice(-30);
  const avgLeverage = recent.reduce(function(sum, h) {
    return sum + h.leverageRatio;
  }, 0) / recent.length;

  const avgUtilization = recent.reduce(function(sum, h) {
    return sum + h.marginUtilization;
  }, 0) / recent.length;

  const leverageTrend = recent.length > 1 ?
    recent[recent.length - 1].leverageRatio - recent[0].leverageRatio : 0;

  return {
    history: history,
    dataPoints: history.length,
    averageLeverage30d: avgLeverage,
    averageUtilization30d: avgUtilization,
    leverageTrend: leverageTrend > 0.1 ? 'increasing' :
                  leverageTrend < -0.1 ? 'decreasing' : 'stable',
    maxLeverage: Math.max.apply(null, history.map(function(h) { return h.leverageRatio; })),
    minMarginCushion: Math.min.apply(null, history.map(function(h) { return h.marginCushion; }))
  };
}

/**
 * Calculate liquidation risk
 */
function calculateLiquidationRisk(account, volatilityAssumption) {
  volatilityAssumption = volatilityAssumption || 0.20;
  
  const metrics = calculateMarginMetrics(account);
  const distanceToCall = metrics.distanceToMarginCall.percent;
  
  // Probability of reaching margin call (simplified normal distribution)
  // Assuming daily volatility and 30-day horizon
  const dailyVol = volatilityAssumption / Math.sqrt(252);
  const vol30Day = dailyVol * Math.sqrt(30);
  
  // How many standard deviations away is margin call?
  const stdDevsToCall = (distanceToCall / 100) / vol30Day;
  
  // Approximate probability using standard normal
  let probability;
  if (stdDevsToCall <= 0) {
    probability = 100;
  } else if (stdDevsToCall >= 4) {
    probability = 0.01;
  } else {
    // Simplified approximation
    probability = Math.max(0, 50 * Math.exp(-0.5 * stdDevsToCall * stdDevsToCall));
  }

  return {
    distanceToMarginCall: distanceToCall,
    volatilityAssumption: volatilityAssumption * 100,
    volatility30Day: vol30Day * 100,
    standardDeviationsToCall: stdDevsToCall,
    probability30Day: probability,
    riskLevel: probability > 20 ? 'high' :
              probability > 5 ? 'elevated' :
              probability > 1 ? 'moderate' : 'low',
    recommendation: probability > 10 ?
      'Consider reducing leverage to lower liquidation risk' :
      'Liquidation risk is acceptable'
  };
}

/**
 * Generate margin report
 */
function generateMarginReport(account, history) {
  const metrics = calculateMarginMetrics(account);
  const liquidationRisk = calculateLiquidationRisk(account);
  const historyAnalysis = trackMarginHistory(metrics, history);

  // Simulate scenarios
  const scenarios = [5, 10, 15, 20, 30].map(function(drop) {
    return simulateMarginCall(account, drop);
  });

  // Find first scenario that triggers margin call
  const marginCallScenario = scenarios.find(function(s) {
    return s.marginCallTriggered;
  });

  return {
    generated: new Date().toISOString(),
    summary: {
      equity: metrics.equity,
      marginDebt: metrics.marginDebt,
      leverageRatio: metrics.leverageRatio,
      marginUtilization: metrics.marginUtilization,
      status: metrics.status
    },
    metrics: metrics,
    liquidationRisk: liquidationRisk,
    scenarios: scenarios,
    marginCallThreshold: marginCallScenario ?
      marginCallScenario.priceDropPercent : 'Beyond 30% drop',
    history: historyAnalysis,
    recommendations: generateMarginRecommendations(metrics, liquidationRisk)
  };
}

/**
 * Generate margin recommendations
 */
function generateMarginRecommendations(metrics, liquidationRisk) {
  const recommendations = [];

  if (metrics.marginUtilization > 70) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      message: 'Margin utilization is high (' + metrics.marginUtilization.toFixed(1) + '%). ' +
        'Consider reducing positions or adding equity.'
    });
  }

  if (metrics.leverageRatio > 2.5) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      message: 'Leverage ratio (' + metrics.leverageRatio.toFixed(2) + 'x) is elevated. ' +
        'High risk of significant losses.'
    });
  }

  if (liquidationRisk.probability30Day > 5) {
    recommendations.push({
      type: 'caution',
      priority: 'high',
      message: liquidationRisk.probability30Day.toFixed(1) + '% chance of margin call in next 30 days'
    });
  }

  if (metrics.annualInterestCost > 1000) {
    recommendations.push({
      type: 'info',
      priority: 'medium',
      message: 'Annual margin interest: €' + metrics.annualInterestCost.toFixed(2) + '. ' +
        'Consider if leverage benefit exceeds this cost.'
    });
  }

  if (metrics.marginCushionPercent < 20) {
    recommendations.push({
      type: 'caution',
      priority: 'medium',
      message: 'Limited margin cushion (' + metrics.marginCushionPercent.toFixed(1) + '%). ' +
        'Small price drops could trigger margin call.'
    });
  }

  return recommendations;
}

// Export functions
if (typeof window !== 'undefined') {
  window.MarginLeverageEngine = {
    MARGIN_REQUIREMENTS: MARGIN_REQUIREMENTS,
    createMarginAccount: createMarginAccount,
    calculateMarginMetrics: calculateMarginMetrics,
    calculateRequiredMargin: calculateRequiredMargin,
    simulateMarginCall: simulateMarginCall,
    calculateOptimalLeverage: calculateOptimalLeverage,
    trackMarginHistory: trackMarginHistory,
    calculateLiquidationRisk: calculateLiquidationRisk,
    generateMarginReport: generateMarginReport
  };
  
  console.log('[OK] Margin & Leverage Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MARGIN_REQUIREMENTS,
    createMarginAccount,
    calculateMarginMetrics,
    calculateRequiredMargin,
    simulateMarginCall,
    calculateOptimalLeverage,
    trackMarginHistory,
    calculateLiquidationRisk,
    generateMarginReport
  };
}
