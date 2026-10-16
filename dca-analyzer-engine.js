// ============================================================================
// MAERMIN v6.0 - Dollar Cost Averaging (DCA) Analyzer Engine
// Compare lump sum vs DCA, optimize contribution schedules, backtest strategies
// ============================================================================

/**
 * Analyze DCA vs Lump Sum investment strategy
 * @param {number} totalInvestment - Total amount to invest
 * @param {Array} priceHistory - Historical prices array
 * @param {Object} config - Configuration options
 * @returns {Object} Comparison results
 */
function compareDCAvsLumpSum(totalInvestment, priceHistory, config = {}) {
  const {
    dcaPeriods = 12,           // Number of DCA purchases
    dcaFrequency = 'monthly',  // weekly, biweekly, monthly
    startIndex = 0             // Where to start in price history
  } = config;

  // Never shown as is: the view words its message from neededDays / haveDays.
  const INSUFFICIENT = 'Insufficient price history for analysis';
  if (!priceHistory || priceHistory.length < dcaPeriods) {
    return { error: INSUFFICIENT };
  }

  // cleanup B-3 (FINDINGS M-4): dated prices ({ timestamp, price }, daily
  // closes or refresh points) step by CALENDAR period from the first date and
  // buy on the first point on or after each due date. The old index step (30
  // points = a "month") made 12 monthly buys span ~17 months of trading days
  // and piled the rest onto the last price when the history ran out.
  const dated = typeof priceHistory[0] === 'object' && priceHistory[0] !== null;
  const priceAt = (i) => dated ? Number(priceHistory[i].price) : Number(priceHistory[i]);
  const timeAt = (i) => dcaToTime(priceHistory[i].timestamp != null ? priceHistory[i].timestamp : priceHistory[i].date);
  const picks = [];
  if (dated) {
    const t0 = timeAt(startIndex), tEnd = timeAt(priceHistory.length - 1);
    if (!isFinite(t0) || !isFinite(tEnd)) return { error: INSUFFICIENT };
    let j = startIndex;
    for (let i = 0; i < dcaPeriods; i++) {
      const due = dcaStepFrom(t0, i, dcaFrequency);
      while (j < priceHistory.length && !(timeAt(j) >= due)) j++;
      if (j >= priceHistory.length) {
        return { error: INSUFFICIENT,
          neededDays: Math.round((dcaStepFrom(t0, dcaPeriods - 1, dcaFrequency) - t0) / 864e5),
          haveDays: Math.round((tEnd - t0) / 864e5) };
      }
      picks.push(j);
    }
  } else {
    // Undated prices: index steps (kept for callers without dates).
    const intervalMap = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 };
    const interval = intervalMap[dcaFrequency] || 30;
    for (let i = 0; i < dcaPeriods; i++) picks.push(Math.min(startIndex + (i * interval), priceHistory.length - 1));
  }
  const lastPrice = priceAt(priceHistory.length - 1);

  // Lump Sum: Buy everything at start
  const lumpSumPrice = priceAt(startIndex);
  const lumpSumShares = totalInvestment / lumpSumPrice;
  const lumpSumFinalValue = lumpSumShares * lastPrice;

  // DCA: Spread purchases over time
  const dcaAmount = totalInvestment / dcaPeriods;
  let dcaShares = 0;
  const dcaPurchases = [];
  let dcaTotalCost = 0;

  for (let i = 0; i < dcaPeriods; i++) {
    const priceIndex = picks[i];
    const price = priceAt(priceIndex);
    const shares = dcaAmount / price;

    dcaShares += shares;
    dcaTotalCost += dcaAmount;

    dcaPurchases.push({
      period: i + 1,
      priceIndex,
      date: dated ? new Date(timeAt(priceIndex)).toISOString().slice(0, 10) : null,
      price,
      amount: dcaAmount,
      shares,
      cumulativeShares: dcaShares,
      cumulativeCost: dcaTotalCost,
      averageCost: dcaTotalCost / dcaShares
    });
  }

  const dcaFinalValue = dcaShares * lastPrice;
  const dcaAverageCost = totalInvestment / dcaShares;

  // Calculate returns
  const lumpSumReturn = ((lumpSumFinalValue - totalInvestment) / totalInvestment) * 100;
  const dcaReturn = ((dcaFinalValue - totalInvestment) / totalInvestment) * 100;

  // Determine winner
  const winner = lumpSumReturn > dcaReturn ? 'lumpsum' : 'dca';
  const difference = Math.abs(lumpSumReturn - dcaReturn);

  return {
    totalInvestment,
    periods: dcaPeriods,
    frequency: dcaFrequency,
    
    lumpSum: {
      purchasePrice: lumpSumPrice,
      shares: lumpSumShares,
      finalValue: lumpSumFinalValue,
      return: lumpSumReturn,
      returnAmount: lumpSumFinalValue - totalInvestment
    },
    
    dca: {
      averageCost: dcaAverageCost,
      shares: dcaShares,
      finalValue: dcaFinalValue,
      return: dcaReturn,
      returnAmount: dcaFinalValue - totalInvestment,
      purchases: dcaPurchases,
      lowestPrice: Math.min(...dcaPurchases.map(p => p.price)),
      highestPrice: Math.max(...dcaPurchases.map(p => p.price))
    },
    
    comparison: {
      winner,
      difference,
      lumpSumAdvantage: lumpSumReturn - dcaReturn,
      dcaVolatilityReduction: calculateVolatilityReduction(dcaPurchases)
    }
  };
}

// 'YYYY-MM-DD' (UTC midnight), an ISO string or ms -> ms; NaN otherwise.
function dcaToTime(t) {
  if (typeof t === 'number') return t;
  const s = String(t || '');
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : s);
}

// The i-th due date from t0: calendar months for monthly / quarterly (the day
// of month is clamped, 31 Jan -> 28 Feb), days otherwise.
function dcaStepFrom(t0, i, freq) {
  const days = { daily: 1, weekly: 7, biweekly: 14 }[freq];
  if (days) return t0 + i * days * 864e5;
  const months = (freq === 'quarterly' ? 3 : 1) * i;
  const d = new Date(t0);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(day, last));
}

/**
 * Calculate volatility reduction from DCA
 */
function calculateVolatilityReduction(purchases) {
  if (purchases.length < 2) return 0;
  
  const prices = purchases.map(p => p.price);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - avgPrice, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  
  // Coefficient of variation as volatility measure
  return (stdDev / avgPrice) * 100;
}

// Export functions
if (typeof window !== 'undefined') {
  window.DCAAnalyzerEngine = {
    compareDCAvsLumpSum
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    compareDCAvsLumpSum
  };
}
