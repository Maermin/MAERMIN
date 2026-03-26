// ============================================================================
// MAERMIN v6.0 - Dividend & Income Tracker Engine
// Track dividends, yields, DRIP simulation, and income analysis
// ============================================================================

/**
 * Dividend record structure
 * @typedef {Object} DividendRecord
 * @property {string} symbol - Stock symbol
 * @property {number} amount - Dividend amount per share
 * @property {Date} exDate - Ex-dividend date
 * @property {Date} payDate - Payment date
 * @property {Date} recordDate - Record date
 * @property {string} frequency - annual, semi-annual, quarterly, monthly
 */

/**
 * Calculate dividend yield for a position
 */
function calculateDividendYield(position, annualDividend) {
  const currentPrice = position.currentPrice || position.purchasePrice || 0;
  if (currentPrice === 0) return 0;
  
  return (annualDividend / currentPrice) * 100;
}

/**
 * Calculate yield on cost (based on purchase price)
 */
function calculateYieldOnCost(position, annualDividend) {
  const purchasePrice = position.purchasePrice || 0;
  if (purchasePrice === 0) return 0;
  
  return (annualDividend / purchasePrice) * 100;
}

/**
 * Track all dividend income for portfolio
 * @param {Object} portfolio - Portfolio with positions
 * @param {Array} dividendHistory - Historical dividend payments
 * @param {Object} dividendData - Current dividend data per symbol
 */
function trackDividendIncome(portfolio, dividendHistory, dividendData) {
  const positions = portfolio.stocks || [];
  const results = {
    positions: [],
    summary: {
      totalAnnualDividends: 0,
      totalYield: 0,
      totalYieldOnCost: 0,
      monthlyIncome: 0,
      quarterlyIncome: 0
    },
    byMonth: {},
    byQuarter: {}
  };

  let totalValue = 0;
  let totalCost = 0;

  positions.forEach(function(position) {
    const symbol = position.symbol || position.name;
    const shares = position.amount || 0;
    const currentPrice = position.currentPrice || position.purchasePrice || 0;
    const purchasePrice = position.purchasePrice || currentPrice;
    const positionValue = shares * currentPrice;
    const positionCost = shares * purchasePrice;

    totalValue += positionValue;
    totalCost += positionCost;

    // Get dividend data for this symbol
    const divData = dividendData ? dividendData[symbol] : null;
    
    if (divData) {
      const annualDividend = divData.annualDividend || 0;
      const dividendPerShare = divData.dividendPerShare || 0;
      const frequency = divData.frequency || 'quarterly';
      const exDate = divData.exDate;
      const payDate = divData.payDate;

      const annualIncome = shares * annualDividend;
      const currentYield = calculateDividendYield(position, annualDividend);
      const yieldOnCost = calculateYieldOnCost(position, annualDividend);

      results.summary.totalAnnualDividends += annualIncome;

      results.positions.push({
        symbol: symbol,
        shares: shares,
        currentPrice: currentPrice,
        purchasePrice: purchasePrice,
        positionValue: positionValue,
        dividendPerShare: dividendPerShare,
        annualDividend: annualDividend,
        annualIncome: annualIncome,
        currentYield: currentYield,
        yieldOnCost: yieldOnCost,
        frequency: frequency,
        exDate: exDate,
        payDate: payDate,
        payoutRatio: divData.payoutRatio || null,
        dividendGrowthRate: divData.growthRate || null,
        yearsOfGrowth: divData.yearsOfGrowth || null
      });
    }
  });

  // Calculate portfolio-level yields
  if (totalValue > 0) {
    results.summary.totalYield = (results.summary.totalAnnualDividends / totalValue) * 100;
  }
  if (totalCost > 0) {
    results.summary.totalYieldOnCost = (results.summary.totalAnnualDividends / totalCost) * 100;
  }

  results.summary.monthlyIncome = results.summary.totalAnnualDividends / 12;
  results.summary.quarterlyIncome = results.summary.totalAnnualDividends / 4;
  results.summary.totalPortfolioValue = totalValue;
  results.summary.totalCostBasis = totalCost;

  // Analyze dividend history by month/quarter
  if (dividendHistory && dividendHistory.length > 0) {
    dividendHistory.forEach(function(div) {
      const date = new Date(div.payDate || div.date);
      const monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
      const quarterKey = date.getFullYear() + '-Q' + Math.ceil((date.getMonth() + 1) / 3);

      if (!results.byMonth[monthKey]) {
        results.byMonth[monthKey] = { total: 0, dividends: [] };
      }
      results.byMonth[monthKey].total += div.amount || 0;
      results.byMonth[monthKey].dividends.push(div);

      if (!results.byQuarter[quarterKey]) {
        results.byQuarter[quarterKey] = { total: 0, dividends: [] };
      }
      results.byQuarter[quarterKey].total += div.amount || 0;
      results.byQuarter[quarterKey].dividends.push(div);
    });
  }

  return results;
}

/**
 * Create dividend calendar with upcoming ex-dates and payment dates
 */
function createDividendCalendar(portfolio, dividendData, monthsAhead) {
  monthsAhead = monthsAhead || 3;
  const positions = portfolio.stocks || [];
  const calendar = [];
  const today = new Date();
  const endDate = new Date();
  endDate.setMonth(endDate.getMonth() + monthsAhead);

  positions.forEach(function(position) {
    const symbol = position.symbol || position.name;
    const shares = position.amount || 0;
    const divData = dividendData ? dividendData[symbol] : null;

    if (divData && divData.exDate) {
      const exDate = new Date(divData.exDate);
      
      // If ex-date is in the future and within our range
      if (exDate >= today && exDate <= endDate) {
        calendar.push({
          type: 'ex-date',
          symbol: symbol,
          date: exDate,
          shares: shares,
          dividendPerShare: divData.dividendPerShare,
          estimatedAmount: shares * (divData.dividendPerShare || 0),
          note: 'Must own shares before this date to receive dividend'
        });
      }

      if (divData.payDate) {
        const payDate = new Date(divData.payDate);
        if (payDate >= today && payDate <= endDate) {
          calendar.push({
            type: 'payment',
            symbol: symbol,
            date: payDate,
            shares: shares,
            dividendPerShare: divData.dividendPerShare,
            estimatedAmount: shares * (divData.dividendPerShare || 0),
            note: 'Dividend payment date'
          });
        }
      }
    }
  });

  // Sort by date
  calendar.sort(function(a, b) {
    return new Date(a.date) - new Date(b.date);
  });

  // Calculate totals
  const exDates = calendar.filter(function(e) { return e.type === 'ex-date'; });
  const payments = calendar.filter(function(e) { return e.type === 'payment'; });

  return {
    events: calendar,
    summary: {
      upcomingExDates: exDates.length,
      upcomingPayments: payments.length,
      totalExpectedIncome: payments.reduce(function(sum, p) { 
        return sum + p.estimatedAmount; 
      }, 0)
    }
  };
}

/**
 * Simulate DRIP (Dividend Reinvestment Plan) over time
 * @param {Object} position - Initial position
 * @param {Object} dividendData - Dividend information
 * @param {number} years - Simulation years
 * @param {Object} config - Configuration options
 */
function simulateDRIP(position, dividendData, years, config) {
  const {
    dividendGrowthRate = 0.05,
    priceGrowthRate = 0.07,
    reinvestAll = true
  } = config || {};

  let shares = position.amount || 0;
  let price = position.currentPrice || position.purchasePrice || 0;
  let annualDividend = dividendData.annualDividend || 0;
  
  const history = [];
  let totalDividendsReceived = 0;
  let totalSharesFromDRIP = 0;

  for (let year = 1; year <= years; year++) {
    // Calculate annual dividend income
    const dividendIncome = shares * annualDividend;
    totalDividendsReceived += dividendIncome;

    // Reinvest dividends
    let newShares = 0;
    if (reinvestAll && price > 0) {
      newShares = dividendIncome / price;
      shares += newShares;
      totalSharesFromDRIP += newShares;
    }

    const portfolioValue = shares * price;

    history.push({
      year: year,
      shares: shares,
      price: price,
      annualDividend: annualDividend,
      dividendIncome: dividendIncome,
      newSharesFromDRIP: newShares,
      portfolioValue: portfolioValue,
      yieldOnOriginalCost: (dividendIncome / (position.amount * position.purchasePrice)) * 100
    });

    // Grow dividend and price for next year
    annualDividend *= (1 + dividendGrowthRate);
    price *= (1 + priceGrowthRate);
  }

  const initialValue = position.amount * (position.currentPrice || position.purchasePrice);
  const finalValue = shares * price;

  return {
    initialShares: position.amount,
    finalShares: shares,
    sharesFromDRIP: totalSharesFromDRIP,
    shareGrowth: ((shares - position.amount) / position.amount) * 100,
    initialValue: initialValue,
    finalValue: finalValue,
    totalReturn: ((finalValue - initialValue) / initialValue) * 100,
    totalDividendsReceived: totalDividendsReceived,
    compoundingEffect: totalSharesFromDRIP * price,
    history: history
  };
}

/**
 * Compare DRIP vs taking dividends as cash
 */
function compareDRIPvsCash(position, dividendData, years, config) {
  const {
    dividendGrowthRate = 0.05,
    priceGrowthRate = 0.07,
    cashReinvestmentRate = 0.02 // Rate if cash is put in savings
  } = config || {};

  // Simulate DRIP
  const dripResult = simulateDRIP(position, dividendData, years, {
    dividendGrowthRate: dividendGrowthRate,
    priceGrowthRate: priceGrowthRate,
    reinvestAll: true
  });

  // Simulate taking cash
  let shares = position.amount;
  let price = position.currentPrice || position.purchasePrice;
  let annualDividend = dividendData.annualDividend || 0;
  let cashAccumulated = 0;

  for (let year = 1; year <= years; year++) {
    const dividendIncome = shares * annualDividend;
    cashAccumulated += dividendIncome;
    cashAccumulated *= (1 + cashReinvestmentRate); // Interest on cash

    // Grow dividend and price
    annualDividend *= (1 + dividendGrowthRate);
    price *= (1 + priceGrowthRate);
  }

  const cashFinalStockValue = shares * price;
  const cashTotalValue = cashFinalStockValue + cashAccumulated;

  return {
    drip: {
      finalValue: dripResult.finalValue,
      finalShares: dripResult.finalShares,
      totalDividendsReinvested: dripResult.totalDividendsReceived
    },
    cash: {
      finalStockValue: cashFinalStockValue,
      cashAccumulated: cashAccumulated,
      totalValue: cashTotalValue,
      finalShares: shares
    },
    comparison: {
      dripAdvantage: dripResult.finalValue - cashTotalValue,
      dripAdvantagePercent: ((dripResult.finalValue - cashTotalValue) / cashTotalValue) * 100,
      winner: dripResult.finalValue > cashTotalValue ? 'DRIP' : 'Cash',
      recommendation: dripResult.finalValue > cashTotalValue * 1.1 ?
        'DRIP significantly outperforms - strongly recommend reinvesting dividends' :
        'Results are similar - choose based on income needs'
    }
  };
}

/**
 * Analyze dividend growth history and sustainability
 */
function analyzeDividendGrowth(dividendHistory, symbol) {
  if (!dividendHistory || dividendHistory.length < 2) {
    return { error: 'Insufficient dividend history' };
  }

  // Sort by date
  const sorted = dividendHistory.slice().sort(function(a, b) {
    return new Date(a.date) - new Date(b.date);
  });

  // Calculate year-over-year growth
  const growthRates = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].amount > 0) {
      const growth = (sorted[i].amount - sorted[i - 1].amount) / sorted[i - 1].amount;
      growthRates.push({
        fromDate: sorted[i - 1].date,
        toDate: sorted[i].date,
        growth: growth * 100
      });
    }
  }

  // Calculate averages
  const avgGrowth = growthRates.length > 0 ?
    growthRates.reduce(function(sum, g) { return sum + g.growth; }, 0) / growthRates.length :
    0;

  // Check for cuts
  const cuts = growthRates.filter(function(g) { return g.growth < 0; });
  const increases = growthRates.filter(function(g) { return g.growth > 0; });

  // Consecutive years of growth
  let consecutiveGrowth = 0;
  for (let i = growthRates.length - 1; i >= 0; i--) {
    if (growthRates[i].growth > 0) {
      consecutiveGrowth++;
    } else {
      break;
    }
  }

  // Dividend aristocrat status (25+ years of growth)
  const isDividendAristocrat = consecutiveGrowth >= 25;
  const isDividendKing = consecutiveGrowth >= 50;

  return {
    symbol: symbol,
    totalPayments: sorted.length,
    averageGrowthRate: avgGrowth,
    consecutiveYearsOfGrowth: consecutiveGrowth,
    dividendCuts: cuts.length,
    dividendIncreases: increases.length,
    isDividendAristocrat: isDividendAristocrat,
    isDividendKing: isDividendKing,
    latestDividend: sorted[sorted.length - 1].amount,
    firstDividend: sorted[0].amount,
    totalGrowth: sorted[0].amount > 0 ?
      ((sorted[sorted.length - 1].amount - sorted[0].amount) / sorted[0].amount) * 100 : 0,
    growthHistory: growthRates,
    sustainability: calculateDividendSustainability(avgGrowth, cuts.length, consecutiveGrowth)
  };
}

/**
 * Calculate dividend sustainability score
 */
function calculateDividendSustainability(avgGrowth, cuts, consecutiveGrowth) {
  let score = 50; // Base score

  // Reward growth
  score += Math.min(20, avgGrowth);

  // Penalize cuts
  score -= cuts * 10;

  // Reward consistency
  score += Math.min(30, consecutiveGrowth);

  score = Math.max(0, Math.min(100, score));

  let rating;
  if (score >= 80) rating = 'Excellent';
  else if (score >= 60) rating = 'Good';
  else if (score >= 40) rating = 'Fair';
  else rating = 'Poor';

  return {
    score: score,
    rating: rating,
    interpretation: rating === 'Excellent' ? 'Highly sustainable dividend with strong growth' :
      rating === 'Good' ? 'Stable dividend with consistent payments' :
      rating === 'Fair' ? 'Some concerns about dividend stability' :
      'High risk of dividend cut'
  };
}

/**
 * Project future dividend income
 */
function projectDividendIncome(portfolio, dividendData, years, growthRate) {
  growthRate = growthRate || 0.05;
  const currentIncome = trackDividendIncome(portfolio, [], dividendData);
  const projections = [];

  let annualIncome = currentIncome.summary.totalAnnualDividends;

  for (let year = 1; year <= years; year++) {
    annualIncome *= (1 + growthRate);
    projections.push({
      year: year,
      annualIncome: annualIncome,
      monthlyIncome: annualIncome / 12,
      growthFromCurrent: ((annualIncome - currentIncome.summary.totalAnnualDividends) / 
        currentIncome.summary.totalAnnualDividends) * 100
    });
  }

  return {
    currentAnnualIncome: currentIncome.summary.totalAnnualDividends,
    assumedGrowthRate: growthRate * 100,
    projections: projections,
    incomeIn5Years: projections[4] ? projections[4].annualIncome : null,
    incomeIn10Years: projections[9] ? projections[9].annualIncome : null,
    totalIncomeOver: years,
    cumulativeIncome: projections.reduce(function(sum, p) { 
      return sum + p.annualIncome; 
    }, 0)
  };
}

/**
 * Find best dividend stocks from portfolio
 */
function rankDividendPositions(portfolio, dividendData) {
  const tracked = trackDividendIncome(portfolio, [], dividendData);
  
  // Score each position
  const scored = tracked.positions.map(function(pos) {
    let score = 0;
    
    // Yield (up to 30 points)
    score += Math.min(30, pos.currentYield * 5);
    
    // Yield on cost (up to 20 points)
    score += Math.min(20, pos.yieldOnCost * 3);
    
    // Dividend growth (up to 25 points)
    if (pos.dividendGrowthRate) {
      score += Math.min(25, pos.dividendGrowthRate * 2.5);
    }
    
    // Years of growth (up to 25 points)
    if (pos.yearsOfGrowth) {
      score += Math.min(25, pos.yearsOfGrowth);
    }
    
    // Penalize high payout ratio
    if (pos.payoutRatio && pos.payoutRatio > 80) {
      score -= (pos.payoutRatio - 80) / 2;
    }
    
    return {
      ...pos,
      dividendScore: Math.max(0, Math.min(100, score))
    };
  });

  // Sort by score
  scored.sort(function(a, b) {
    return b.dividendScore - a.dividendScore;
  });

  return {
    rankings: scored,
    topPicks: scored.slice(0, 5),
    avgDividendScore: scored.length > 0 ?
      scored.reduce(function(sum, s) { return sum + s.dividendScore; }, 0) / scored.length :
      0
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.DividendTracker = {
    calculateDividendYield: calculateDividendYield,
    calculateYieldOnCost: calculateYieldOnCost,
    trackDividendIncome: trackDividendIncome,
    createDividendCalendar: createDividendCalendar,
    simulateDRIP: simulateDRIP,
    compareDRIPvsCash: compareDRIPvsCash,
    analyzeDividendGrowth: analyzeDividendGrowth,
    projectDividendIncome: projectDividendIncome,
    rankDividendPositions: rankDividendPositions
  };
  
  console.log('[OK] Dividend Tracker Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateDividendYield,
    calculateYieldOnCost,
    trackDividendIncome,
    createDividendCalendar,
    simulateDRIP,
    compareDRIPvsCash,
    analyzeDividendGrowth,
    projectDividendIncome,
    rankDividendPositions
  };
}
