// ============================================================================
// MAERMIN v6.0 - Options & Derivatives Tracking Engine
// Options portfolio tracking, Greeks calculation, strategy analysis
// ============================================================================

/**
 * Option types
 */
const OPTION_TYPES = {
  CALL: 'call',
  PUT: 'put'
};

/**
 * Common option strategies
 */
const OPTION_STRATEGIES = {
  longCall: {
    name: 'Long Call',
    legs: [{ type: 'call', position: 'long' }],
    outlook: 'bullish',
    maxLoss: 'premium paid',
    maxGain: 'unlimited'
  },
  longPut: {
    name: 'Long Put',
    legs: [{ type: 'put', position: 'long' }],
    outlook: 'bearish',
    maxLoss: 'premium paid',
    maxGain: 'strike - premium'
  },
  coveredCall: {
    name: 'Covered Call',
    legs: [
      { type: 'stock', position: 'long' },
      { type: 'call', position: 'short' }
    ],
    outlook: 'neutral to slightly bullish',
    maxLoss: 'stock price - premium received',
    maxGain: 'strike - stock price + premium'
  },
  protectivePut: {
    name: 'Protective Put',
    legs: [
      { type: 'stock', position: 'long' },
      { type: 'put', position: 'long' }
    ],
    outlook: 'bullish with downside protection',
    maxLoss: 'stock price - strike + premium',
    maxGain: 'unlimited'
  },
  bullCallSpread: {
    name: 'Bull Call Spread',
    legs: [
      { type: 'call', position: 'long', strikeType: 'lower' },
      { type: 'call', position: 'short', strikeType: 'higher' }
    ],
    outlook: 'moderately bullish',
    maxLoss: 'net premium paid',
    maxGain: 'strike difference - net premium'
  },
  bearPutSpread: {
    name: 'Bear Put Spread',
    legs: [
      { type: 'put', position: 'long', strikeType: 'higher' },
      { type: 'put', position: 'short', strikeType: 'lower' }
    ],
    outlook: 'moderately bearish',
    maxLoss: 'net premium paid',
    maxGain: 'strike difference - net premium'
  },
  ironCondor: {
    name: 'Iron Condor',
    legs: [
      { type: 'put', position: 'short', strikeType: 'lower_mid' },
      { type: 'put', position: 'long', strikeType: 'lowest' },
      { type: 'call', position: 'short', strikeType: 'upper_mid' },
      { type: 'call', position: 'long', strikeType: 'highest' }
    ],
    outlook: 'neutral',
    maxLoss: 'wing width - net premium',
    maxGain: 'net premium received'
  },
  straddle: {
    name: 'Long Straddle',
    legs: [
      { type: 'call', position: 'long', strikeType: 'atm' },
      { type: 'put', position: 'long', strikeType: 'atm' }
    ],
    outlook: 'volatile (big move either direction)',
    maxLoss: 'total premium paid',
    maxGain: 'unlimited'
  },
  strangle: {
    name: 'Long Strangle',
    legs: [
      { type: 'call', position: 'long', strikeType: 'otm' },
      { type: 'put', position: 'long', strikeType: 'otm' }
    ],
    outlook: 'volatile (big move either direction)',
    maxLoss: 'total premium paid',
    maxGain: 'unlimited'
  },
  wheel: {
    name: 'Wheel Strategy',
    description: 'Sell puts until assigned, then sell calls until called away',
    outlook: 'neutral to bullish',
    phases: ['cash-secured put', 'covered call']
  }
};

/**
 * Calculate option price using Black-Scholes model
 * @param {string} type - 'call' or 'put'
 * @param {number} S - Current stock price
 * @param {number} K - Strike price
 * @param {number} T - Time to expiration (in years)
 * @param {number} r - Risk-free interest rate
 * @param {number} sigma - Volatility (annualized)
 */
function blackScholes(type, S, K, T, r, sigma) {
  if (T <= 0) {
    // At expiration
    if (type === 'call') return Math.max(0, S - K);
    return Math.max(0, K - S);
  }

  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const NNd1 = normalCDF(-d1);
  const NNd2 = normalCDF(-d2);

  if (type === 'call') {
    return S * Nd1 - K * Math.exp(-r * T) * Nd2;
  } else {
    return K * Math.exp(-r * T) * NNd2 - S * NNd1;
  }
}

/**
 * Standard normal cumulative distribution function
 */
function normalCDF(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Standard normal probability density function
 */
function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Calculate option Greeks
 * @param {string} type - 'call' or 'put'
 * @param {number} S - Current stock price
 * @param {number} K - Strike price
 * @param {number} T - Time to expiration (in years)
 * @param {number} r - Risk-free interest rate
 * @param {number} sigma - Volatility
 */
function calculateGreeks(type, S, K, T, r, sigma) {
  if (T <= 0) {
    return {
      delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0
    };
  }

  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const Nd1 = normalCDF(d1);
  const Nd2 = normalCDF(d2);
  const nd1 = normalPDF(d1);

  let delta, rho;

  if (type === 'call') {
    delta = Nd1;
    rho = K * T * Math.exp(-r * T) * Nd2 / 100;
  } else {
    delta = Nd1 - 1;
    rho = -K * T * Math.exp(-r * T) * normalCDF(-d2) / 100;
  }

  // Gamma (same for calls and puts)
  const gamma = nd1 / (S * sigma * Math.sqrt(T));

  // Theta (per day)
  const theta_annual = -(S * nd1 * sigma) / (2 * Math.sqrt(T));
  const theta_rate = r * K * Math.exp(-r * T);
  
  let theta;
  if (type === 'call') {
    theta = (theta_annual - theta_rate * Nd2) / 365;
  } else {
    theta = (theta_annual + theta_rate * normalCDF(-d2)) / 365;
  }

  // Vega (per 1% change in vol)
  const vega = S * Math.sqrt(T) * nd1 / 100;

  return {
    delta: delta,
    gamma: gamma,
    theta: theta,
    vega: vega,
    rho: rho
  };
}

/**
 * Calculate implied volatility using Newton-Raphson method
 */
function calculateImpliedVolatility(type, optionPrice, S, K, T, r) {
  if (T <= 0) return 0;

  let sigma = 0.3; // Initial guess
  const tolerance = 0.0001;
  const maxIterations = 100;

  for (let i = 0; i < maxIterations; i++) {
    const price = blackScholes(type, S, K, T, r, sigma);
    const vega = calculateGreeks(type, S, K, T, r, sigma).vega * 100;

    if (Math.abs(vega) < 0.0001) break;

    const diff = price - optionPrice;
    if (Math.abs(diff) < tolerance) break;

    sigma = sigma - diff / vega;
    sigma = Math.max(0.01, Math.min(5, sigma)); // Bounds
  }

  return sigma;
}

/**
 * Create option position
 */
function createOptionPosition(config) {
  const {
    symbol,
    underlying,
    type,
    strike,
    expiration,
    quantity,
    premium,
    position // 'long' or 'short'
  } = config;

  const expirationDate = new Date(expiration);
  const today = new Date();
  const daysToExpiration = Math.max(0, (expirationDate - today) / (1000 * 60 * 60 * 24));
  const yearsToExpiration = daysToExpiration / 365;

  return {
    id: 'opt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
    symbol: symbol,
    underlying: underlying,
    type: type,
    strike: strike,
    expiration: expiration,
    daysToExpiration: daysToExpiration,
    yearsToExpiration: yearsToExpiration,
    quantity: quantity,
    premium: premium,
    position: position,
    multiplier: 100, // Standard option multiplier
    totalPremium: premium * quantity * 100,
    createdAt: new Date().toISOString()
  };
}

/**
 * Calculate option position P&L at various prices
 */
function calculateOptionPnL(option, currentPrice, underlyingPrices) {
  const results = [];
  const isLong = option.position === 'long';
  const multiplier = option.multiplier || 100;

  underlyingPrices.forEach(function(price) {
    let intrinsicValue;
    if (option.type === 'call') {
      intrinsicValue = Math.max(0, price - option.strike);
    } else {
      intrinsicValue = Math.max(0, option.strike - price);
    }

    let pnlPerContract;
    if (isLong) {
      pnlPerContract = (intrinsicValue - option.premium) * multiplier;
    } else {
      pnlPerContract = (option.premium - intrinsicValue) * multiplier;
    }

    const totalPnL = pnlPerContract * option.quantity;
    const returnPercent = option.totalPremium !== 0 ?
      (totalPnL / Math.abs(option.totalPremium)) * 100 : 0;

    results.push({
      underlyingPrice: price,
      intrinsicValue: intrinsicValue,
      pnlPerContract: pnlPerContract,
      totalPnL: totalPnL,
      returnPercent: returnPercent
    });
  });

  // Calculate breakeven
  let breakeven;
  if (option.type === 'call') {
    breakeven = isLong ? option.strike + option.premium : option.strike + option.premium;
  } else {
    breakeven = isLong ? option.strike - option.premium : option.strike - option.premium;
  }

  return {
    option: option,
    currentUnderlyingPrice: currentPrice,
    pnlScenarios: results,
    breakeven: breakeven,
    maxLoss: isLong ? -option.totalPremium : 'unlimited',
    maxGain: isLong ? 'unlimited' : option.totalPremium
  };
}

/**
 * Analyze options portfolio
 */
function analyzeOptionsPortfolio(options, underlyingPrices) {
  const portfolioGreeks = {
    delta: 0,
    gamma: 0,
    theta: 0,
    vega: 0,
    rho: 0
  };

  let totalPremium = 0;
  let totalValue = 0;
  const positionAnalysis = [];

  options.forEach(function(option) {
    const underlyingPrice = underlyingPrices[option.underlying] || 100;
    const riskFreeRate = 0.05; // Assume 5%
    const volatility = 0.30; // Assume 30% if not specified

    // Calculate theoretical price
    const theoreticalPrice = blackScholes(
      option.type,
      underlyingPrice,
      option.strike,
      option.yearsToExpiration,
      riskFreeRate,
      volatility
    );

    // Calculate Greeks
    const greeks = calculateGreeks(
      option.type,
      underlyingPrice,
      option.strike,
      option.yearsToExpiration,
      riskFreeRate,
      volatility
    );

    // Adjust for position and quantity
    const positionSign = option.position === 'long' ? 1 : -1;
    const contracts = option.quantity;
    const multiplier = option.multiplier || 100;

    // Add to portfolio Greeks
    portfolioGreeks.delta += greeks.delta * positionSign * contracts * multiplier;
    portfolioGreeks.gamma += greeks.gamma * contracts * multiplier;
    portfolioGreeks.theta += greeks.theta * positionSign * contracts * multiplier;
    portfolioGreeks.vega += greeks.vega * positionSign * contracts * multiplier;
    portfolioGreeks.rho += greeks.rho * positionSign * contracts * multiplier;

    totalPremium += option.totalPremium * positionSign;
    totalValue += theoreticalPrice * contracts * multiplier * positionSign;

    positionAnalysis.push({
      option: option,
      underlyingPrice: underlyingPrice,
      theoreticalPrice: theoreticalPrice,
      marketPrice: option.premium,
      priceDifference: theoreticalPrice - option.premium,
      greeks: greeks,
      adjustedDelta: greeks.delta * positionSign * contracts * multiplier,
      daysToExpiration: option.daysToExpiration,
      moneyness: option.type === 'call' ?
        (underlyingPrice - option.strike) / option.strike * 100 :
        (option.strike - underlyingPrice) / option.strike * 100
    });
  });

  // Calculate portfolio-level metrics
  const deltaExposure = portfolioGreeks.delta * 100; // In underlying terms
  const dailyTheta = portfolioGreeks.theta;
  const vegaExposure = portfolioGreeks.vega;

  return {
    portfolioGreeks: portfolioGreeks,
    totalPremium: totalPremium,
    totalTheoreticalValue: totalValue,
    unrealizedPnL: totalValue - totalPremium,
    positions: positionAnalysis,
    summary: {
      deltaExposure: deltaExposure,
      deltaEquivalentShares: Math.round(portfolioGreeks.delta),
      dailyThetaDecay: dailyTheta,
      weeklyThetaDecay: dailyTheta * 7,
      vegaExposure: vegaExposure,
      positionCount: options.length
    },
    riskMetrics: calculateOptionsRisk(portfolioGreeks, options)
  };
}

/**
 * Calculate options portfolio risk metrics
 */
function calculateOptionsRisk(portfolioGreeks, options) {
  const risks = [];

  // Delta risk
  if (Math.abs(portfolioGreeks.delta) > 500) {
    risks.push({
      type: 'delta',
      severity: 'high',
      message: 'High delta exposure (' + Math.round(portfolioGreeks.delta) + ' equivalent shares)'
    });
  }

  // Gamma risk
  if (portfolioGreeks.gamma > 50) {
    risks.push({
      type: 'gamma',
      severity: 'medium',
      message: 'High gamma - position will change rapidly with price moves'
    });
  }

  // Theta decay
  if (portfolioGreeks.theta < -50) {
    risks.push({
      type: 'theta',
      severity: 'medium',
      message: 'Significant time decay: ' + portfolioGreeks.theta.toFixed(2) + ' per day'
    });
  }

  // Vega exposure
  if (Math.abs(portfolioGreeks.vega) > 200) {
    risks.push({
      type: 'vega',
      severity: 'medium',
      message: 'High volatility sensitivity'
    });
  }

  // Expiration risk
  const nearExpiry = options.filter(function(o) {
    return o.daysToExpiration < 7;
  });
  if (nearExpiry.length > 0) {
    risks.push({
      type: 'expiration',
      severity: 'high',
      message: nearExpiry.length + ' position(s) expiring within 7 days'
    });
  }

  return risks;
}

/**
 * Wheel strategy tracker
 */
function trackWheelStrategy(wheelPosition) {
  const {
    underlying,
    phase, // 'csp' (cash-secured put) or 'cc' (covered call)
    shares,
    costBasis,
    options,
    premiumCollected,
    startDate
  } = wheelPosition;

  // Calculate total premium collected
  const totalPremium = (premiumCollected || 0) + 
    (options || []).reduce(function(sum, opt) {
      return sum + (opt.premium * opt.quantity * 100);
    }, 0);

  // Calculate annualized return
  const startDateObj = new Date(startDate);
  const daysActive = Math.max(1, (new Date() - startDateObj) / (1000 * 60 * 60 * 24));
  const capitalRequired = phase === 'csp' ? 
    (options[0] ? options[0].strike * 100 : 0) :
    (shares * costBasis);
  
  const returnOnCapital = capitalRequired > 0 ?
    (totalPremium / capitalRequired) * 100 : 0;
  const annualizedReturn = (returnOnCapital / daysActive) * 365;

  return {
    underlying: underlying,
    phase: phase,
    phaseName: phase === 'csp' ? 'Cash-Secured Put' : 'Covered Call',
    shares: shares,
    costBasis: costBasis,
    capitalRequired: capitalRequired,
    totalPremiumCollected: totalPremium,
    daysActive: daysActive,
    returnOnCapital: returnOnCapital,
    annualizedReturn: annualizedReturn,
    currentOptions: options,
    status: getWheelStatus(phase, options)
  };
}

/**
 * Get wheel strategy status
 */
function getWheelStatus(phase, options) {
  if (!options || options.length === 0) {
    return phase === 'csp' ? 
      'Ready to sell put' : 
      'Ready to sell call';
  }

  const activeOption = options[0];
  if (activeOption.daysToExpiration < 3) {
    return 'Option expiring soon - monitor for assignment/exercise';
  }

  return 'Position active';
}

/**
 * Generate options report
 */
function generateOptionsReport(options, underlyingPrices) {
  const analysis = analyzeOptionsPortfolio(options, underlyingPrices);

  // Group by underlying
  const byUnderlying = {};
  options.forEach(function(opt) {
    if (!byUnderlying[opt.underlying]) {
      byUnderlying[opt.underlying] = [];
    }
    byUnderlying[opt.underlying].push(opt);
  });

  // Expiration calendar
  const expirations = {};
  options.forEach(function(opt) {
    const expDate = opt.expiration.split('T')[0];
    if (!expirations[expDate]) {
      expirations[expDate] = [];
    }
    expirations[expDate].push(opt);
  });

  return {
    generated: new Date().toISOString(),
    summary: analysis.summary,
    portfolioGreeks: analysis.portfolioGreeks,
    totalValue: analysis.totalTheoreticalValue,
    unrealizedPnL: analysis.unrealizedPnL,
    positions: analysis.positions,
    byUnderlying: byUnderlying,
    expirationCalendar: expirations,
    risks: analysis.riskMetrics,
    recommendations: generateOptionsRecommendations(analysis)
  };
}

/**
 * Generate options recommendations
 */
function generateOptionsRecommendations(analysis) {
  const recommendations = [];
  const greeks = analysis.portfolioGreeks;

  // Delta hedging suggestion
  if (Math.abs(greeks.delta) > 200) {
    const hedgeShares = -Math.round(greeks.delta);
    recommendations.push({
      type: 'hedge',
      priority: 'high',
      message: 'Consider delta hedging with ' + Math.abs(hedgeShares) + ' shares ' +
        (hedgeShares > 0 ? 'long' : 'short')
    });
  }

  // Theta optimization
  if (greeks.theta < -100) {
    recommendations.push({
      type: 'theta',
      priority: 'medium',
      message: 'High theta decay. Consider rolling positions to capture premium.'
    });
  }

  // Expiration management
  const nearExpiry = analysis.positions.filter(function(p) {
    return p.option.daysToExpiration < 5;
  });
  nearExpiry.forEach(function(pos) {
    recommendations.push({
      type: 'expiration',
      priority: 'high',
      message: pos.option.symbol + ' expires in ' + 
        Math.round(pos.option.daysToExpiration) + ' days. Review for roll or close.'
    });
  });

  return recommendations;
}

// Export functions
if (typeof window !== 'undefined') {
  window.OptionsEngine = {
    OPTION_TYPES: OPTION_TYPES,
    OPTION_STRATEGIES: OPTION_STRATEGIES,
    blackScholes: blackScholes,
    calculateGreeks: calculateGreeks,
    calculateImpliedVolatility: calculateImpliedVolatility,
    createOptionPosition: createOptionPosition,
    calculateOptionPnL: calculateOptionPnL,
    analyzeOptionsPortfolio: analyzeOptionsPortfolio,
    trackWheelStrategy: trackWheelStrategy,
    generateOptionsReport: generateOptionsReport
  };
  
  console.log('[OK] Options & Derivatives Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OPTION_TYPES,
    OPTION_STRATEGIES,
    blackScholes,
    calculateGreeks,
    calculateImpliedVolatility,
    createOptionPosition,
    calculateOptionPnL,
    analyzeOptionsPortfolio,
    trackWheelStrategy,
    generateOptionsReport
  };
}
