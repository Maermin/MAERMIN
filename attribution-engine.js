// ============================================================================
// MAERMIN v6.0 - Performance Attribution Engine
// Brinson attribution, sector-level decomposition, selection/allocation effects
// ============================================================================

/**
 * Calculate Brinson attribution (single period)
 * Decomposes portfolio return into allocation, selection, and interaction effects
 * 
 * @param {Object} portfolioWeights - Portfolio weights by sector/asset
 * @param {Object} benchmarkWeights - Benchmark weights by sector/asset
 * @param {Object} portfolioReturns - Portfolio returns by sector/asset
 * @param {Object} benchmarkReturns - Benchmark returns by sector/asset
 */
function calculateBrinsonAttribution(portfolioWeights, benchmarkWeights, portfolioReturns, benchmarkReturns) {
  const sectors = new Set([
    ...Object.keys(portfolioWeights),
    ...Object.keys(benchmarkWeights)
  ]);

  let totalAllocationEffect = 0;
  let totalSelectionEffect = 0;
  let totalInteractionEffect = 0;
  const sectorAttribution = [];

  // Calculate benchmark total return
  let benchmarkTotalReturn = 0;
  Object.keys(benchmarkWeights).forEach(function(sector) {
    benchmarkTotalReturn += (benchmarkWeights[sector] || 0) * (benchmarkReturns[sector] || 0);
  });

  // Calculate portfolio total return
  let portfolioTotalReturn = 0;
  Object.keys(portfolioWeights).forEach(function(sector) {
    portfolioTotalReturn += (portfolioWeights[sector] || 0) * (portfolioReturns[sector] || 0);
  });

  // Calculate attribution for each sector
  sectors.forEach(function(sector) {
    const wp = portfolioWeights[sector] || 0;
    const wb = benchmarkWeights[sector] || 0;
    const rp = portfolioReturns[sector] || 0;
    const rb = benchmarkReturns[sector] || 0;

    // Allocation Effect: (Wp - Wb) * (Rb - Benchmark Total Return)
    const allocationEffect = (wp - wb) * (rb - benchmarkTotalReturn);

    // Selection Effect: Wb * (Rp - Rb)
    const selectionEffect = wb * (rp - rb);

    // Interaction Effect: (Wp - Wb) * (Rp - Rb)
    const interactionEffect = (wp - wb) * (rp - rb);

    // Total sector contribution
    const totalEffect = allocationEffect + selectionEffect + interactionEffect;

    totalAllocationEffect += allocationEffect;
    totalSelectionEffect += selectionEffect;
    totalInteractionEffect += interactionEffect;

    sectorAttribution.push({
      sector: sector,
      portfolioWeight: wp * 100,
      benchmarkWeight: wb * 100,
      weightDiff: (wp - wb) * 100,
      portfolioReturn: rp * 100,
      benchmarkReturn: rb * 100,
      returnDiff: (rp - rb) * 100,
      allocationEffect: allocationEffect * 100,
      selectionEffect: selectionEffect * 100,
      interactionEffect: interactionEffect * 100,
      totalEffect: totalEffect * 100
    });
  });

  // Sort by total effect (largest contributors first)
  sectorAttribution.sort(function(a, b) {
    return Math.abs(b.totalEffect) - Math.abs(a.totalEffect);
  });

  const activeReturn = portfolioTotalReturn - benchmarkTotalReturn;

  return {
    portfolioReturn: portfolioTotalReturn * 100,
    benchmarkReturn: benchmarkTotalReturn * 100,
    activeReturn: activeReturn * 100,
    allocationEffect: totalAllocationEffect * 100,
    selectionEffect: totalSelectionEffect * 100,
    interactionEffect: totalInteractionEffect * 100,
    sectorAttribution: sectorAttribution,
    interpretation: interpretBrinsonAttribution(
      totalAllocationEffect, totalSelectionEffect, totalInteractionEffect, activeReturn
    )
  };
}

/**
 * Interpret Brinson attribution results
 */
function interpretBrinsonAttribution(allocation, selection, interaction, activeReturn) {
  const interpretations = [];

  if (activeReturn > 0) {
    interpretations.push({
      type: 'positive',
      message: 'Portfolio outperformed benchmark by ' + (activeReturn * 100).toFixed(2) + '%'
    });
  } else {
    interpretations.push({
      type: 'negative',
      message: 'Portfolio underperformed benchmark by ' + Math.abs(activeReturn * 100).toFixed(2) + '%'
    });
  }

  // Allocation effect interpretation
  if (allocation > 0.005) {
    interpretations.push({
      type: 'positive',
      message: 'Sector allocation added ' + (allocation * 100).toFixed(2) + '% - overweighting winning sectors helped'
    });
  } else if (allocation < -0.005) {
    interpretations.push({
      type: 'negative',
      message: 'Sector allocation detracted ' + (allocation * 100).toFixed(2) + '% - sector weighting decisions hurt'
    });
  }

  // Selection effect interpretation
  if (selection > 0.005) {
    interpretations.push({
      type: 'positive',
      message: 'Security selection added ' + (selection * 100).toFixed(2) + '% - stock picking was successful'
    });
  } else if (selection < -0.005) {
    interpretations.push({
      type: 'negative',
      message: 'Security selection detracted ' + (selection * 100).toFixed(2) + '% - stock picking hurt performance'
    });
  }

  // Interaction effect
  if (Math.abs(interaction) > 0.005) {
    interpretations.push({
      type: 'info',
      message: 'Interaction effect: ' + (interaction * 100).toFixed(2) + '% - combined impact of allocation and selection'
    });
  }

  // Primary driver
  const absAllocation = Math.abs(allocation);
  const absSelection = Math.abs(selection);
  
  if (absAllocation > absSelection * 1.5) {
    interpretations.push({
      type: 'insight',
      message: 'Primary performance driver: Sector allocation decisions'
    });
  } else if (absSelection > absAllocation * 1.5) {
    interpretations.push({
      type: 'insight',
      message: 'Primary performance driver: Security selection within sectors'
    });
  }

  return interpretations;
}

/**
 * Calculate multi-period attribution (geometric linking)
 * Links single-period attributions over time
 */
function calculateMultiPeriodAttribution(periodAttributions) {
  if (!periodAttributions || periodAttributions.length === 0) {
    return { error: 'No period data provided' };
  }

  // Compound returns
  let cumulativePortfolioReturn = 1;
  let cumulativeBenchmarkReturn = 1;

  periodAttributions.forEach(function(period) {
    cumulativePortfolioReturn *= (1 + period.portfolioReturn / 100);
    cumulativeBenchmarkReturn *= (1 + period.benchmarkReturn / 100);
  });

  cumulativePortfolioReturn = (cumulativePortfolioReturn - 1) * 100;
  cumulativeBenchmarkReturn = (cumulativeBenchmarkReturn - 1) * 100;
  const cumulativeActiveReturn = cumulativePortfolioReturn - cumulativeBenchmarkReturn;

  // Sum attribution effects (simplified approach)
  // Note: For exact linking, should use Carino or Menchero methods
  let totalAllocation = 0;
  let totalSelection = 0;
  let totalInteraction = 0;

  periodAttributions.forEach(function(period) {
    totalAllocation += period.allocationEffect;
    totalSelection += period.selectionEffect;
    totalInteraction += period.interactionEffect;
  });

  // Build sector-level cumulative attribution
  const sectorCumulative = {};
  
  periodAttributions.forEach(function(period) {
    (period.sectorAttribution || []).forEach(function(sector) {
      if (!sectorCumulative[sector.sector]) {
        sectorCumulative[sector.sector] = {
          allocationEffect: 0,
          selectionEffect: 0,
          interactionEffect: 0,
          totalEffect: 0
        };
      }
      sectorCumulative[sector.sector].allocationEffect += sector.allocationEffect;
      sectorCumulative[sector.sector].selectionEffect += sector.selectionEffect;
      sectorCumulative[sector.sector].interactionEffect += sector.interactionEffect;
      sectorCumulative[sector.sector].totalEffect += sector.totalEffect;
    });
  });

  // Convert to array and sort
  const sectorSummary = Object.keys(sectorCumulative).map(function(sector) {
    return {
      sector: sector,
      ...sectorCumulative[sector]
    };
  }).sort(function(a, b) {
    return Math.abs(b.totalEffect) - Math.abs(a.totalEffect);
  });

  return {
    periods: periodAttributions.length,
    cumulativePortfolioReturn: cumulativePortfolioReturn,
    cumulativeBenchmarkReturn: cumulativeBenchmarkReturn,
    cumulativeActiveReturn: cumulativeActiveReturn,
    totalAllocationEffect: totalAllocation,
    totalSelectionEffect: totalSelection,
    totalInteractionEffect: totalInteraction,
    sectorSummary: sectorSummary,
    topContributors: sectorSummary.filter(function(s) { return s.totalEffect > 0; }).slice(0, 5),
    topDetractors: sectorSummary.filter(function(s) { return s.totalEffect < 0; }).slice(0, 5)
  };
}

/**
 * Calculate holdings-based attribution
 * Attribution at the individual security level
 */
function calculateHoldingsAttribution(holdings, benchmarkHoldings, returns, benchmarkReturns) {
  const attribution = [];
  let totalContribution = 0;

  Object.keys(holdings).forEach(function(symbol) {
    const weight = holdings[symbol] || 0;
    const benchmarkWeight = benchmarkHoldings ? (benchmarkHoldings[symbol] || 0) : 0;
    const returnVal = returns[symbol] || 0;
    const benchmarkReturn = benchmarkReturns ? (benchmarkReturns[symbol] || 0) : 0;

    // Contribution = weight * return
    const contribution = weight * returnVal;
    
    // Active contribution = contribution vs benchmark
    const benchmarkContribution = benchmarkWeight * benchmarkReturn;
    const activeContribution = contribution - benchmarkContribution;

    // Allocation vs selection
    const portfolioOverweight = weight - benchmarkWeight;
    const allocationEffect = portfolioOverweight * benchmarkReturn;
    const selectionEffect = weight * (returnVal - benchmarkReturn);

    totalContribution += contribution;

    attribution.push({
      symbol: symbol,
      weight: weight * 100,
      benchmarkWeight: benchmarkWeight * 100,
      overweight: portfolioOverweight * 100,
      return: returnVal * 100,
      benchmarkReturn: benchmarkReturn * 100,
      excessReturn: (returnVal - benchmarkReturn) * 100,
      contribution: contribution * 100,
      allocationEffect: allocationEffect * 100,
      selectionEffect: selectionEffect * 100,
      activeContribution: activeContribution * 100
    });
  });

  // Sort by contribution
  attribution.sort(function(a, b) {
    return Math.abs(b.contribution) - Math.abs(a.contribution);
  });

  return {
    holdings: attribution,
    totalContribution: totalContribution * 100,
    topContributors: attribution.filter(function(h) { return h.contribution > 0; }).slice(0, 10),
    topDetractors: attribution.filter(function(h) { return h.contribution < 0; }).slice(0, 10),
    largestOverweights: attribution.slice().sort(function(a, b) {
      return b.overweight - a.overweight;
    }).slice(0, 5),
    largestUnderweights: attribution.slice().sort(function(a, b) {
      return a.overweight - b.overweight;
    }).slice(0, 5)
  };
}

/**
 * Factor-based attribution
 * Attribute returns to factor exposures
 */
function calculateFactorAttribution(portfolioReturns, factorReturns, factorExposures) {
  const attribution = [];
  let explainedReturn = 0;

  Object.keys(factorExposures).forEach(function(factor) {
    const exposure = factorExposures[factor] || 0;
    const factorReturn = factorReturns[factor] || 0;
    const contribution = exposure * factorReturn;

    explainedReturn += contribution;

    attribution.push({
      factor: factor,
      exposure: exposure,
      factorReturn: factorReturn * 100,
      contribution: contribution * 100
    });
  });

  // Sort by absolute contribution
  attribution.sort(function(a, b) {
    return Math.abs(b.contribution) - Math.abs(a.contribution);
  });

  const totalReturn = portfolioReturns.total || 0;
  const residualReturn = totalReturn - explainedReturn;
  const rSquared = totalReturn !== 0 ? 
    1 - (residualReturn * residualReturn) / (totalReturn * totalReturn) : 0;

  return {
    totalReturn: totalReturn * 100,
    factorAttribution: attribution,
    explainedReturn: explainedReturn * 100,
    residualReturn: residualReturn * 100,
    rSquared: rSquared,
    interpretation: {
      percentExplained: (explainedReturn / totalReturn * 100).toFixed(1) + '%',
      topFactor: attribution[0] ? attribution[0].factor : null,
      alpha: residualReturn * 100
    }
  };
}

/**
 * Risk-adjusted attribution
 * Decomposes risk-adjusted performance
 */
function calculateRiskAdjustedAttribution(portfolioData, benchmarkData, riskFreeRate) {
  riskFreeRate = riskFreeRate || 0.02;

  // Calculate Sharpe ratios
  const portfolioSharpe = (portfolioData.return - riskFreeRate) / portfolioData.volatility;
  const benchmarkSharpe = (benchmarkData.return - riskFreeRate) / benchmarkData.volatility;
  const sharpeAlpha = portfolioSharpe - benchmarkSharpe;

  // Information ratio
  const trackingError = portfolioData.trackingError || 0.05;
  const activeReturn = portfolioData.return - benchmarkData.return;
  const informationRatio = trackingError > 0 ? activeReturn / trackingError : 0;

  // Treynor ratio (if beta available)
  const beta = portfolioData.beta || 1;
  const portfolioTreynor = (portfolioData.return - riskFreeRate) / beta;
  const benchmarkTreynor = (benchmarkData.return - riskFreeRate) / 1; // Benchmark beta = 1
  const treynorAlpha = portfolioTreynor - benchmarkTreynor;

  // Jensen's alpha
  const capmExpectedReturn = riskFreeRate + beta * (benchmarkData.return - riskFreeRate);
  const jensensAlpha = portfolioData.return - capmExpectedReturn;

  return {
    portfolioReturn: portfolioData.return * 100,
    benchmarkReturn: benchmarkData.return * 100,
    activeReturn: activeReturn * 100,
    portfolioVolatility: portfolioData.volatility * 100,
    benchmarkVolatility: benchmarkData.volatility * 100,
    riskMetrics: {
      portfolioSharpe: portfolioSharpe,
      benchmarkSharpe: benchmarkSharpe,
      sharpeAlpha: sharpeAlpha,
      informationRatio: informationRatio,
      portfolioTreynor: portfolioTreynor * 100,
      jensensAlpha: jensensAlpha * 100,
      beta: beta
    },
    interpretation: interpretRiskAdjustedAttribution(
      sharpeAlpha, informationRatio, jensensAlpha
    )
  };
}

/**
 * Interpret risk-adjusted attribution
 */
function interpretRiskAdjustedAttribution(sharpeAlpha, informationRatio, jensensAlpha) {
  const interpretations = [];

  if (sharpeAlpha > 0.2) {
    interpretations.push({
      type: 'positive',
      message: 'Superior risk-adjusted performance (Sharpe Alpha: ' + sharpeAlpha.toFixed(2) + ')'
    });
  } else if (sharpeAlpha < -0.2) {
    interpretations.push({
      type: 'negative',
      message: 'Inferior risk-adjusted performance (Sharpe Alpha: ' + sharpeAlpha.toFixed(2) + ')'
    });
  }

  if (informationRatio > 0.5) {
    interpretations.push({
      type: 'positive',
      message: 'Excellent active management (IR: ' + informationRatio.toFixed(2) + ')'
    });
  } else if (informationRatio > 0.2) {
    interpretations.push({
      type: 'positive',
      message: 'Good active management (IR: ' + informationRatio.toFixed(2) + ')'
    });
  } else if (informationRatio < 0) {
    interpretations.push({
      type: 'negative',
      message: 'Active management not adding value (IR: ' + informationRatio.toFixed(2) + ')'
    });
  }

  if (jensensAlpha > 0.02) {
    interpretations.push({
      type: 'positive',
      message: "Positive Jensen's Alpha: " + (jensensAlpha * 100).toFixed(2) + '% - outperforming risk-adjusted expectations'
    });
  } else if (jensensAlpha < -0.02) {
    interpretations.push({
      type: 'negative',
      message: "Negative Jensen's Alpha: " + (jensensAlpha * 100).toFixed(2) + '% - underperforming risk-adjusted expectations'
    });
  }

  return interpretations;
}

/**
 * Generate comprehensive attribution report
 */
function generateAttributionReport(portfolio, benchmark, periodData) {
  // Single period Brinson attribution
  const brinsonAttribution = calculateBrinsonAttribution(
    periodData.portfolioWeights,
    periodData.benchmarkWeights,
    periodData.portfolioReturns,
    periodData.benchmarkReturns
  );

  // Holdings attribution
  const holdingsAttribution = calculateHoldingsAttribution(
    periodData.holdingsWeights || {},
    periodData.benchmarkHoldingsWeights || {},
    periodData.holdingsReturns || {},
    periodData.benchmarkHoldingsReturns || {}
  );

  // Risk-adjusted attribution
  const riskAdjusted = calculateRiskAdjustedAttribution(
    periodData.portfolioRiskData || { return: brinsonAttribution.portfolioReturn / 100, volatility: 0.15 },
    periodData.benchmarkRiskData || { return: brinsonAttribution.benchmarkReturn / 100, volatility: 0.12 }
  );

  return {
    generated: new Date().toISOString(),
    period: periodData.period || 'Current',
    summary: {
      portfolioReturn: brinsonAttribution.portfolioReturn,
      benchmarkReturn: brinsonAttribution.benchmarkReturn,
      activeReturn: brinsonAttribution.activeReturn,
      allocationEffect: brinsonAttribution.allocationEffect,
      selectionEffect: brinsonAttribution.selectionEffect
    },
    brinsonAttribution: brinsonAttribution,
    holdingsAttribution: holdingsAttribution,
    riskAdjustedAttribution: riskAdjusted,
    keyInsights: generateKeyInsights(brinsonAttribution, holdingsAttribution, riskAdjusted)
  };
}

/**
 * Generate key insights from attribution analysis
 */
function generateKeyInsights(brinson, holdings, riskAdjusted) {
  const insights = [];

  // Performance insight
  if (brinson.activeReturn > 0) {
    insights.push({
      type: 'performance',
      message: 'Portfolio outperformed by ' + brinson.activeReturn.toFixed(2) + '%'
    });
  } else {
    insights.push({
      type: 'performance',
      message: 'Portfolio underperformed by ' + Math.abs(brinson.activeReturn).toFixed(2) + '%'
    });
  }

  // Primary driver
  if (Math.abs(brinson.allocationEffect) > Math.abs(brinson.selectionEffect)) {
    insights.push({
      type: 'driver',
      message: 'Sector allocation was the primary driver of relative performance'
    });
  } else {
    insights.push({
      type: 'driver',
      message: 'Security selection was the primary driver of relative performance'
    });
  }

  // Top contributor
  if (holdings.topContributors && holdings.topContributors[0]) {
    const top = holdings.topContributors[0];
    insights.push({
      type: 'contributor',
      message: 'Top contributor: ' + top.symbol + ' added ' + top.contribution.toFixed(2) + '%'
    });
  }

  // Top detractor
  if (holdings.topDetractors && holdings.topDetractors[0]) {
    const worst = holdings.topDetractors[0];
    insights.push({
      type: 'detractor',
      message: 'Top detractor: ' + worst.symbol + ' cost ' + Math.abs(worst.contribution).toFixed(2) + '%'
    });
  }

  // Skill assessment
  if (riskAdjusted.riskMetrics.informationRatio > 0.3) {
    insights.push({
      type: 'skill',
      message: 'Active decisions are adding value (positive Information Ratio)'
    });
  } else if (riskAdjusted.riskMetrics.informationRatio < -0.3) {
    insights.push({
      type: 'skill',
      message: 'Active decisions are detracting value - consider passive approach'
    });
  }

  return insights;
}

// Export functions
if (typeof window !== 'undefined') {
  window.AttributionEngine = {
    calculateBrinsonAttribution: calculateBrinsonAttribution,
    calculateMultiPeriodAttribution: calculateMultiPeriodAttribution,
    calculateHoldingsAttribution: calculateHoldingsAttribution,
    calculateFactorAttribution: calculateFactorAttribution,
    calculateRiskAdjustedAttribution: calculateRiskAdjustedAttribution,
    generateAttributionReport: generateAttributionReport
  };
  
  console.log('[OK] Performance Attribution Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateBrinsonAttribution,
    calculateMultiPeriodAttribution,
    calculateHoldingsAttribution,
    calculateFactorAttribution,
    calculateRiskAdjustedAttribution,
    generateAttributionReport
  };
}
