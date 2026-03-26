// ============================================================================
// MAERMIN v6.0 - Tax-Efficient Withdrawal Planner Engine
// Optimal withdrawal sequencing, tax bracket management, Roth conversion
// ============================================================================

/**
 * German tax brackets (Abgeltungssteuer + Solidarity + Church Tax)
 * Note: Germany has flat 25% capital gains tax + solidarity surcharge
 */
const GERMAN_TAX_RATES = {
  capitalGains: {
    base: 0.25,          // 25% Abgeltungssteuer
    solidarity: 0.055,    // 5.5% of tax (Solidaritätszuschlag)
    church: 0.08,         // 8% of tax (optional Kirchensteuer)
    effective: 0.26375,   // Without church tax
    effectiveWithChurch: 0.27819
  },
  // Crypto held > 1 year is tax-free in Germany
  cryptoLongTerm: {
    holdingPeriod: 365,
    rate: 0
  },
  // Annual exemption (Sparerpauschbetrag)
  exemption: {
    single: 1000,
    married: 2000
  }
};

/**
 * Account types with tax treatment
 */
const ACCOUNT_TYPES = {
  taxable: {
    name: 'Taxable Brokerage',
    taxOnGains: true,
    taxOnWithdrawal: false,
    capitalGainsTax: true,
    description: 'Regular brokerage - gains taxed when realized'
  },
  crypto: {
    name: 'Cryptocurrency',
    taxOnGains: true,
    taxOnWithdrawal: false,
    holdingPeriodBenefit: true,
    holdingPeriodDays: 365,
    description: 'Tax-free if held > 1 year in Germany'
  },
  riester: {
    name: 'Riester-Rente',
    taxOnGains: false,
    taxOnWithdrawal: true,
    taxRate: 'income',
    description: 'Tax-deferred retirement account'
  },
  ruerup: {
    name: 'Rürup-Rente (Basisrente)',
    taxOnGains: false,
    taxOnWithdrawal: true,
    taxRate: 'income',
    description: 'Tax-deferred pension'
  },
  betrieblich: {
    name: 'Betriebliche Altersvorsorge',
    taxOnGains: false,
    taxOnWithdrawal: true,
    taxRate: 'income',
    description: 'Company pension - taxed on withdrawal'
  },
  tagesgeld: {
    name: 'Savings Account',
    taxOnGains: true,
    taxOnWithdrawal: false,
    capitalGainsTax: true,
    description: 'Interest taxed as capital gains'
  }
};

/**
 * Calculate tax on capital gains (German system)
 */
function calculateCapitalGainsTax(gains, config) {
  const {
    usedExemption = 0,
    hasChurchTax = false,
    isMarried = false
  } = config || {};

  const exemption = isMarried ? 
    GERMAN_TAX_RATES.exemption.married : 
    GERMAN_TAX_RATES.exemption.single;
  
  const availableExemption = Math.max(0, exemption - usedExemption);
  const taxableGains = Math.max(0, gains - availableExemption);

  const taxRate = hasChurchTax ? 
    GERMAN_TAX_RATES.capitalGains.effectiveWithChurch :
    GERMAN_TAX_RATES.capitalGains.effective;

  const tax = taxableGains * taxRate;
  const exemptionUsed = Math.min(gains, availableExemption);

  return {
    grossGains: gains,
    exemptionUsed: exemptionUsed,
    taxableGains: taxableGains,
    taxRate: taxRate * 100,
    tax: tax,
    netGains: gains - tax,
    effectiveRate: gains > 0 ? (tax / gains) * 100 : 0
  };
}

/**
 * Calculate crypto tax (German 1-year rule)
 */
function calculateCryptoTax(position, config) {
  const {
    purchaseDate,
    saleDate,
    gains,
    hasChurchTax = false,
    isMarried = false
  } = config;

  const holdingDays = Math.floor(
    (new Date(saleDate) - new Date(purchaseDate)) / (1000 * 60 * 60 * 24)
  );

  const isLongTerm = holdingDays >= 365;

  if (isLongTerm) {
    return {
      holdingDays: holdingDays,
      isLongTerm: true,
      taxExempt: true,
      gains: gains,
      tax: 0,
      netGains: gains,
      message: 'Tax-free: Held longer than 1 year'
    };
  }

  // Short-term: taxed as regular capital gains
  const taxCalc = calculateCapitalGainsTax(gains, {
    hasChurchTax: hasChurchTax,
    isMarried: isMarried
  });

  return {
    holdingDays: holdingDays,
    isLongTerm: false,
    taxExempt: false,
    ...taxCalc,
    message: 'Short-term gain: ' + holdingDays + ' days held, taxed at ' + 
      taxCalc.taxRate.toFixed(2) + '%'
  };
}

/**
 * Plan optimal withdrawal sequence
 * Minimize taxes while meeting withdrawal needs
 */
function planWithdrawalSequence(accounts, withdrawalNeeded, config) {
  const {
    hasChurchTax = false,
    isMarried = false,
    exemptionUsed = 0,
    prioritizeTaxFree = true
  } = config || {};

  const withdrawalPlan = [];
  let remainingNeeded = withdrawalNeeded;
  let totalTax = 0;
  let currentExemptionUsed = exemptionUsed;

  // Sort accounts by tax efficiency
  const sortedAccounts = accounts.slice().sort(function(a, b) {
    // Priority: 1) Tax-free long-term crypto, 2) Use exemption first, 3) Lowest gain %, 4) Tax-deferred last
    
    // Tax-free crypto first
    if (a.isCryptoLongTerm && !b.isCryptoLongTerm) return -1;
    if (!a.isCryptoLongTerm && b.isCryptoLongTerm) return 1;
    
    // Then lowest unrealized gain percentage
    const aGainPct = a.unrealizedGain / (a.value || 1);
    const bGainPct = b.unrealizedGain / (b.value || 1);
    
    return aGainPct - bGainPct;
  });

  sortedAccounts.forEach(function(account) {
    if (remainingNeeded <= 0) return;

    const withdrawalAmount = Math.min(account.value, remainingNeeded);
    
    // Calculate gains on this withdrawal
    const costBasis = account.costBasis || (account.value - account.unrealizedGain);
    const gainRatio = account.unrealizedGain / (account.value || 1);
    const realizedGain = withdrawalAmount * gainRatio;

    let tax = 0;
    let taxDetails = {};

    // Crypto with long-term holding
    if (account.isCryptoLongTerm) {
      tax = 0;
      taxDetails = { taxExempt: true, reason: 'Long-term crypto (>1 year)' };
    }
    // Regular taxable account
    else if (account.type === 'taxable' || account.type === 'crypto') {
      const exemption = isMarried ? 
        GERMAN_TAX_RATES.exemption.married : 
        GERMAN_TAX_RATES.exemption.single;
      const availableExemption = Math.max(0, exemption - currentExemptionUsed);
      
      if (realizedGain > 0) {
        const taxableGain = Math.max(0, realizedGain - availableExemption);
        const taxRate = hasChurchTax ? 
          GERMAN_TAX_RATES.capitalGains.effectiveWithChurch :
          GERMAN_TAX_RATES.capitalGains.effective;
        
        tax = taxableGain * taxRate;
        currentExemptionUsed += Math.min(realizedGain, availableExemption);
        
        taxDetails = {
          realizedGain: realizedGain,
          exemptionApplied: Math.min(realizedGain, availableExemption),
          taxableGain: taxableGain,
          taxRate: taxRate * 100
        };
      }
    }

    totalTax += tax;
    remainingNeeded -= withdrawalAmount;

    withdrawalPlan.push({
      account: account.name,
      accountType: account.type,
      withdrawal: withdrawalAmount,
      realizedGain: realizedGain,
      tax: tax,
      netWithdrawal: withdrawalAmount - tax,
      taxDetails: taxDetails,
      remainingInAccount: account.value - withdrawalAmount
    });
  });

  const totalWithdrawal = withdrawalNeeded - remainingNeeded;
  const netWithdrawal = totalWithdrawal - totalTax;

  return {
    withdrawalNeeded: withdrawalNeeded,
    totalWithdrawal: totalWithdrawal,
    totalTax: totalTax,
    netWithdrawal: netWithdrawal,
    effectiveTaxRate: totalWithdrawal > 0 ? (totalTax / totalWithdrawal) * 100 : 0,
    shortfall: remainingNeeded > 0 ? remainingNeeded : 0,
    withdrawalPlan: withdrawalPlan,
    exemptionUsed: currentExemptionUsed
  };
}

/**
 * Find tax-loss harvesting opportunities
 */
function findTaxLossHarvesting(positions, config) {
  const {
    minLoss = 100,
    washSaleRuleDays = 30
  } = config || {};

  const opportunities = [];
  let totalPotentialLoss = 0;
  let potentialTaxSavings = 0;

  positions.forEach(function(position) {
    const unrealizedGain = position.unrealizedGain || 
      ((position.currentPrice - position.purchasePrice) * position.amount);

    if (unrealizedGain < -minLoss) {
      const loss = Math.abs(unrealizedGain);
      const taxSavings = loss * GERMAN_TAX_RATES.capitalGains.effective;

      totalPotentialLoss += loss;
      potentialTaxSavings += taxSavings;

      opportunities.push({
        symbol: position.symbol || position.name,
        currentValue: position.amount * position.currentPrice,
        costBasis: position.amount * position.purchasePrice,
        unrealizedLoss: loss,
        potentialTaxSavings: taxSavings,
        action: 'Sell to realize loss',
        note: 'Wait ' + washSaleRuleDays + ' days before repurchasing to avoid wash sale issues'
      });
    }
  });

  // Sort by tax savings potential
  opportunities.sort(function(a, b) {
    return b.potentialTaxSavings - a.potentialTaxSavings;
  });

  return {
    opportunities: opportunities,
    totalPotentialLoss: totalPotentialLoss,
    totalPotentialTaxSavings: potentialTaxSavings,
    recommendedAction: opportunities.length > 0 ?
      'Consider harvesting ' + opportunities.length + ' positions for up to €' + 
      potentialTaxSavings.toFixed(2) + ' in tax savings' :
      'No significant tax-loss harvesting opportunities found'
  };
}

/**
 * Analyze crypto positions for optimal selling strategy
 */
function analyzeCryptoTaxStrategy(cryptoPositions) {
  const analysis = {
    taxFree: [],
    almostTaxFree: [],
    shortTerm: []
  };

  const today = new Date();

  cryptoPositions.forEach(function(position) {
    const purchaseDate = new Date(position.purchaseDate);
    const holdingDays = Math.floor((today - purchaseDate) / (1000 * 60 * 60 * 24));
    const daysUntilTaxFree = Math.max(0, 365 - holdingDays);

    const positionAnalysis = {
      symbol: position.symbol || position.name,
      purchaseDate: position.purchaseDate,
      holdingDays: holdingDays,
      daysUntilTaxFree: daysUntilTaxFree,
      taxFreeDate: new Date(purchaseDate.getTime() + 365 * 24 * 60 * 60 * 1000),
      currentValue: (position.amount || 0) * (position.currentPrice || 0),
      unrealizedGain: position.unrealizedGain || 
        ((position.currentPrice - position.purchasePrice) * position.amount),
      purchasePrice: position.purchasePrice,
      currentPrice: position.currentPrice
    };

    if (holdingDays >= 365) {
      positionAnalysis.status = 'Tax-free';
      positionAnalysis.recommendation = 'Can sell without capital gains tax';
      analysis.taxFree.push(positionAnalysis);
    } else if (daysUntilTaxFree <= 60) {
      positionAnalysis.status = 'Almost tax-free';
      positionAnalysis.recommendation = 'Wait ' + daysUntilTaxFree + ' days for tax-free sale';
      analysis.almostTaxFree.push(positionAnalysis);
    } else {
      positionAnalysis.status = 'Short-term';
      const taxIfSoldNow = positionAnalysis.unrealizedGain > 0 ?
        positionAnalysis.unrealizedGain * GERMAN_TAX_RATES.capitalGains.effective : 0;
      positionAnalysis.taxIfSoldNow = taxIfSoldNow;
      positionAnalysis.recommendation = taxIfSoldNow > 0 ?
        'Selling now would incur €' + taxIfSoldNow.toFixed(2) + ' in tax' :
        'Currently at a loss - consider tax-loss harvesting';
      analysis.shortTerm.push(positionAnalysis);
    }
  });

  // Calculate summary
  const totalTaxFreeValue = analysis.taxFree.reduce(function(sum, p) {
    return sum + p.currentValue;
  }, 0);
  const totalAlmostTaxFreeValue = analysis.almostTaxFree.reduce(function(sum, p) {
    return sum + p.currentValue;
  }, 0);
  const totalShortTermValue = analysis.shortTerm.reduce(function(sum, p) {
    return sum + p.currentValue;
  }, 0);
  const potentialTaxSavings = analysis.almostTaxFree.reduce(function(sum, p) {
    return sum + (p.unrealizedGain > 0 ? 
      p.unrealizedGain * GERMAN_TAX_RATES.capitalGains.effective : 0);
  }, 0);

  return {
    summary: {
      taxFreePositions: analysis.taxFree.length,
      taxFreeValue: totalTaxFreeValue,
      almostTaxFreePositions: analysis.almostTaxFree.length,
      almostTaxFreeValue: totalAlmostTaxFreeValue,
      shortTermPositions: analysis.shortTerm.length,
      shortTermValue: totalShortTermValue,
      potentialTaxSavingsByWaiting: potentialTaxSavings
    },
    taxFree: analysis.taxFree,
    almostTaxFree: analysis.almostTaxFree,
    shortTerm: analysis.shortTerm,
    recommendation: potentialTaxSavings > 500 ?
      'Consider waiting for ' + analysis.almostTaxFree.length + 
      ' positions to become tax-free (potential savings: €' + 
      potentialTaxSavings.toFixed(2) + ')' :
      'Portfolio is well-positioned for tax-efficient withdrawals'
  };
}

/**
 * Calculate optimal withdrawal amount to stay within exemption
 */
function calculateOptimalWithdrawal(accounts, config) {
  const {
    isMarried = false,
    exemptionUsed = 0,
    targetExemptionUsage = 1.0 // Use 100% of exemption
  } = config || {};

  const exemption = isMarried ? 
    GERMAN_TAX_RATES.exemption.married : 
    GERMAN_TAX_RATES.exemption.single;
  const availableExemption = (exemption - exemptionUsed) * targetExemptionUsage;

  if (availableExemption <= 0) {
    return {
      optimalWithdrawal: 0,
      message: 'Tax exemption already fully used',
      exemption: exemption,
      exemptionUsed: exemptionUsed
    };
  }

  // Find positions to realize gains equal to exemption
  let totalGainToRealize = 0;
  let totalWithdrawalNeeded = 0;
  const withdrawals = [];

  // Sort by lowest gain percentage (harvest smallest gains first)
  const sortedAccounts = accounts.slice()
    .filter(function(a) { return a.unrealizedGain > 0; })
    .sort(function(a, b) {
      const aGainPct = a.unrealizedGain / a.value;
      const bGainPct = b.unrealizedGain / b.value;
      return aGainPct - bGainPct;
    });

  sortedAccounts.forEach(function(account) {
    if (totalGainToRealize >= availableExemption) return;

    const gainPct = account.unrealizedGain / account.value;
    const remainingExemption = availableExemption - totalGainToRealize;
    
    // How much to withdraw to use remaining exemption?
    const gainToRealize = Math.min(account.unrealizedGain, remainingExemption);
    const withdrawalForGain = gainPct > 0 ? gainToRealize / gainPct : 0;

    totalGainToRealize += gainToRealize;
    totalWithdrawalNeeded += withdrawalForGain;

    withdrawals.push({
      account: account.name,
      withdrawal: withdrawalForGain,
      gainRealized: gainToRealize,
      tax: 0 // Within exemption
    });
  });

  return {
    exemption: exemption,
    exemptionUsed: exemptionUsed,
    availableExemption: availableExemption,
    optimalWithdrawal: totalWithdrawalNeeded,
    gainsRealized: totalGainToRealize,
    taxOnWithdrawal: 0,
    withdrawals: withdrawals,
    message: 'Withdraw €' + totalWithdrawalNeeded.toFixed(2) + 
      ' to realize €' + totalGainToRealize.toFixed(2) + 
      ' in tax-free gains (using exemption)'
  };
}

/**
 * Generate tax-efficient withdrawal report
 */
function generateWithdrawalReport(accounts, cryptoPositions, config) {
  const { withdrawalNeeded = 0 } = config || {};

  // Crypto analysis
  const cryptoAnalysis = analyzeCryptoTaxStrategy(cryptoPositions || []);

  // Tax-loss harvesting
  const allPositions = [].concat(accounts || [], cryptoPositions || []);
  const taxLossOpportunities = findTaxLossHarvesting(allPositions, config);

  // Optimal exemption usage
  const exemptionOptimization = calculateOptimalWithdrawal(accounts || [], config);

  // Withdrawal plan if needed
  let withdrawalPlan = null;
  if (withdrawalNeeded > 0) {
    withdrawalPlan = planWithdrawalSequence(accounts || [], withdrawalNeeded, config);
  }

  return {
    generated: new Date().toISOString(),
    taxRates: GERMAN_TAX_RATES,
    cryptoAnalysis: cryptoAnalysis,
    taxLossHarvesting: taxLossOpportunities,
    exemptionOptimization: exemptionOptimization,
    withdrawalPlan: withdrawalPlan,
    recommendations: generateTaxRecommendations(
      cryptoAnalysis, taxLossOpportunities, exemptionOptimization
    )
  };
}

/**
 * Generate tax recommendations
 */
function generateTaxRecommendations(cryptoAnalysis, taxLoss, exemption) {
  const recommendations = [];

  // Crypto waiting opportunities
  if (cryptoAnalysis.summary.potentialTaxSavingsByWaiting > 200) {
    recommendations.push({
      type: 'crypto',
      priority: 'high',
      title: 'Wait for Tax-Free Crypto',
      message: cryptoAnalysis.summary.almostTaxFreePositions + 
        ' crypto positions will become tax-free soon',
      potentialSavings: cryptoAnalysis.summary.potentialTaxSavingsByWaiting
    });
  }

  // Tax-loss harvesting
  if (taxLoss.totalPotentialTaxSavings > 100) {
    recommendations.push({
      type: 'tax_loss',
      priority: 'medium',
      title: 'Tax-Loss Harvesting',
      message: 'Harvest losses to offset gains',
      potentialSavings: taxLoss.totalPotentialTaxSavings
    });
  }

  // Use exemption
  if (exemption.availableExemption > 500) {
    recommendations.push({
      type: 'exemption',
      priority: 'medium',
      title: 'Use Annual Exemption',
      message: 'Realize €' + exemption.availableExemption.toFixed(0) + 
        ' in gains tax-free this year',
      potentialSavings: exemption.availableExemption * 
        GERMAN_TAX_RATES.capitalGains.effective
    });
  }

  // Sort by potential savings
  recommendations.sort(function(a, b) {
    return b.potentialSavings - a.potentialSavings;
  });

  return recommendations;
}

// Export functions
if (typeof window !== 'undefined') {
  window.TaxWithdrawalEngine = {
    GERMAN_TAX_RATES: GERMAN_TAX_RATES,
    ACCOUNT_TYPES: ACCOUNT_TYPES,
    calculateCapitalGainsTax: calculateCapitalGainsTax,
    calculateCryptoTax: calculateCryptoTax,
    planWithdrawalSequence: planWithdrawalSequence,
    findTaxLossHarvesting: findTaxLossHarvesting,
    analyzeCryptoTaxStrategy: analyzeCryptoTaxStrategy,
    calculateOptimalWithdrawal: calculateOptimalWithdrawal,
    generateWithdrawalReport: generateWithdrawalReport
  };
  
  console.log('[OK] Tax-Efficient Withdrawal Engine loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GERMAN_TAX_RATES,
    ACCOUNT_TYPES,
    calculateCapitalGainsTax,
    calculateCryptoTax,
    planWithdrawalSequence,
    findTaxLossHarvesting,
    analyzeCryptoTaxStrategy,
    calculateOptimalWithdrawal,
    generateWithdrawalReport
  };
}
