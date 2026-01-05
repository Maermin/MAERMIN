// ============================================================================
// MAERMIN v4.1 - Extended Calculator Module with Advanced Features
// NO EMOJIS VERSION
// ============================================================================

// ============================================================================
// TRANSACTION HISTORY & COST BASIS TRACKING
// ============================================================================

function calculateCostBasis(transactions, symbol, method) {
  method = method || 'FIFO';
  if (!transactions || !Array.isArray(transactions)) return { totalQuantity: 0, totalCost: 0, averageCost: 0, lots: [] };
  
  const buyTransactions = transactions
    .filter(function(tx) { return tx.type === 'buy' && tx.asset && tx.asset.symbol === symbol; })
    .sort(function(a, b) {
      if (method === 'FIFO') return new Date(a.timestamp) - new Date(b.timestamp);
      if (method === 'LIFO') return new Date(b.timestamp) - new Date(a.timestamp);
      return 0;
    });
  
  const totalQuantity = buyTransactions.reduce(function(sum, tx) { return sum + (tx.quantity || 0); }, 0);
  const totalCost = buyTransactions.reduce(function(sum, tx) { return sum + (tx.totalCost || 0) + (tx.fees || 0); }, 0);
  
  return {
    totalQuantity: totalQuantity,
    totalCost: totalCost,
    averageCost: totalQuantity > 0 ? totalCost / totalQuantity : 0,
    lots: buyTransactions.map(function(tx) {
      return {
        id: tx.id,
        date: tx.timestamp,
        quantity: tx.quantity,
        price: tx.price,
        costBasis: (tx.totalCost || 0) + (tx.fees || 0)
      };
    })
  };
}

function calculateRealizedGains(transactions, year) {
  if (!transactions || !Array.isArray(transactions)) return {
    totalShortTermGains: 0,
    totalLongTermGains: 0,
    totalGains: 0,
    gainsBySymbol: {},
    transactions: []
  };
  
  const sellTransactions = transactions.filter(function(tx) {
    if (tx.type !== 'sell') return false;
    if (year) {
      const txYear = new Date(tx.timestamp).getFullYear();
      return txYear === year;
    }
    return true;
  });
  
  let totalShortTermGains = 0;
  let totalLongTermGains = 0;
  const gainsBySymbol = {};
  
  sellTransactions.forEach(function(tx) {
    const gain = (tx.realizedGain && tx.realizedGain.gain) || 0;
    const isLongTerm = tx.realizedGain && tx.realizedGain.holdingPeriod >= 365;
    
    if (isLongTerm) {
      totalLongTermGains += gain;
    } else {
      totalShortTermGains += gain;
    }
    
    const symbol = tx.asset.symbol;
    if (!gainsBySymbol[symbol]) {
      gainsBySymbol[symbol] = { shortTerm: 0, longTerm: 0, total: 0 };
    }
    gainsBySymbol[symbol][isLongTerm ? 'longTerm' : 'shortTerm'] += gain;
    gainsBySymbol[symbol].total += gain;
  });
  
  return {
    totalShortTermGains: totalShortTermGains,
    totalLongTermGains: totalLongTermGains,
    totalGains: totalShortTermGains + totalLongTermGains,
    gainsBySymbol: gainsBySymbol,
    transactions: sellTransactions
  };
}

function calculateUnrealizedGains(portfolio, transactions) {
  if (!portfolio || !transactions) return [];
  
  const unrealizedGains = [];
  
  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    const positions = portfolio[category] || [];
    positions.forEach(function(position) {
      const symbol = position.symbol || position.name;
      const costBasis = calculateCostBasis(
        transactions.filter(function(tx) { return tx.asset && tx.asset.symbol === symbol; }),
        symbol,
        'FIFO'
      );
      
      const currentValue = position.amount * (position.currentPrice || position.purchasePrice || 0);
      const totalCost = costBasis.totalCost;
      const unrealizedGain = currentValue - totalCost;
      const unrealizedGainPercent = totalCost > 0 ? (unrealizedGain / totalCost) * 100 : 0;
      
      let avgHoldingPeriod = 0;
      if (costBasis.lots.length > 0) {
        avgHoldingPeriod = costBasis.lots.reduce(function(sum, lot) {
          const days = (Date.now() - new Date(lot.date)) / (1000 * 60 * 60 * 24);
          return sum + (days * lot.quantity);
        }, 0) / costBasis.totalQuantity;
      }
      
      unrealizedGains.push({
        symbol: symbol,
        category: category,
        quantity: position.amount,
        costBasis: totalCost,
        currentValue: currentValue,
        unrealizedGain: unrealizedGain,
        unrealizedGainPercent: unrealizedGainPercent,
        avgCostPerUnit: costBasis.averageCost,
        currentPrice: position.currentPrice || position.purchasePrice || 0,
        holdingPeriod: Math.floor(avgHoldingPeriod),
        isLongTerm: avgHoldingPeriod >= 365
      });
    });
  });
  
  return unrealizedGains;
}

// ============================================================================
// TAX CALCULATIONS (GERMAN TAX LAW)
// ============================================================================

function calculateGermanCapitalGainsTax(transactions, year) {
  if (!transactions || !Array.isArray(transactions)) return {
    year: year || new Date().getFullYear(),
    totalCapitalIncome: 0,
    realizedGains: 0,
    dividendIncome: 0,
    freistellungsauftrag: 1000,
    taxableIncome: 0,
    abgeltungssteuer: 0,
    solidarityTax: 0,
    churchTax: 0,
    totalTax: 0,
    effectiveTaxRate: 0,
    breakdown: { shortTermGains: 0, longTermGains: 0, dividends: 0 }
  };
  
  year = year || new Date().getFullYear();
  
  const ABGELTUNGSSTEUER_RATE = 0.25;
  const SOLIDARITY_SURCHARGE = 0.055;
  const CHURCH_TAX_RATE = 0.09;
  const FREISTELLUNGSAUFTRAG = 1000;
  
  const yearGains = calculateRealizedGains(transactions, year);
  
  const dividendIncome = transactions
    .filter(function(tx) { 
      return tx.type === 'dividend' && new Date(tx.timestamp).getFullYear() === year;
    })
    .reduce(function(sum, tx) { return sum + (tx.totalCost || 0); }, 0);
  
  const totalCapitalIncome = yearGains.totalGains + dividendIncome;
  const taxableIncome = Math.max(0, totalCapitalIncome - FREISTELLUNGSAUFTRAG);
  const abgeltungssteuer = taxableIncome * ABGELTUNGSSTEUER_RATE;
  const solidarityTax = abgeltungssteuer * SOLIDARITY_SURCHARGE;
  const churchTax = abgeltungssteuer * CHURCH_TAX_RATE;
  const totalTax = abgeltungssteuer + solidarityTax;
  
  return {
    year: year,
    totalCapitalIncome: totalCapitalIncome,
    realizedGains: yearGains.totalGains,
    dividendIncome: dividendIncome,
    freistellungsauftrag: FREISTELLUNGSAUFTRAG,
    taxableIncome: taxableIncome,
    abgeltungssteuer: abgeltungssteuer,
    solidarityTax: solidarityTax,
    churchTax: churchTax,
    totalTax: totalTax,
    effectiveTaxRate: totalCapitalIncome > 0 ? (totalTax / totalCapitalIncome) * 100 : 0,
    breakdown: {
      shortTermGains: yearGains.totalShortTermGains,
      longTermGains: yearGains.totalLongTermGains,
      dividends: dividendIncome
    }
  };
}

function calculateCryptoTax(transactions, year) {
  if (!transactions || !Array.isArray(transactions)) return {
    taxableGains: 0,
    taxFreeGains: 0,
    totalGains: 0,
    taxSavingsFrom1YearRule: 0
  };
  
  const cryptoSells = transactions.filter(function(tx) {
    return tx.type === 'sell' && 
           tx.asset && tx.asset.category === 'crypto' &&
           new Date(tx.timestamp).getFullYear() === year;
  });
  
  let taxableGains = 0;
  let taxFreeGains = 0;
  
  cryptoSells.forEach(function(tx) {
    const holdingPeriod = (tx.realizedGain && tx.realizedGain.holdingPeriod) || 0;
    const gain = (tx.realizedGain && tx.realizedGain.gain) || 0;
    
    if (holdingPeriod >= 365) {
      taxFreeGains += gain;
    } else {
      taxableGains += gain;
    }
  });
  
  return {
    taxableGains: taxableGains,
    taxFreeGains: taxFreeGains,
    totalGains: taxableGains + taxFreeGains,
    taxSavingsFrom1YearRule: taxFreeGains * 0.25
  };
}

function suggestTaxLossHarvesting(portfolio, transactions, currentDate) {
  currentDate = currentDate || new Date();
  const unrealizedGains = calculateUnrealizedGains(portfolio, transactions);
  
  const losers = unrealizedGains
    .filter(function(pos) { return pos.unrealizedGain < 0; })
    .sort(function(a, b) { return a.unrealizedGain - b.unrealizedGain; });
  
  const suggestions = [];
  
  losers.forEach(function(position) {
    const recentBuys = transactions.filter(function(tx) {
      return tx.type === 'buy' &&
             tx.asset && tx.asset.symbol === position.symbol &&
             (currentDate - new Date(tx.timestamp)) / (1000 * 60 * 60 * 24) < 30;
    });
    
    if (recentBuys.length > 0) {
      suggestions.push({
        symbol: position.symbol,
        type: 'wash-sale-warning',
        message: 'Cannot harvest loss on ' + position.symbol + ' due to recent purchase (wash sale rule)',
        unrealizedLoss: position.unrealizedGain
      });
    } else {
      suggestions.push({
        symbol: position.symbol,
        type: 'tax-loss-harvest',
        message: 'Sell ' + position.symbol + ' to realize loss',
        unrealizedLoss: position.unrealizedGain,
        taxSavings: Math.abs(position.unrealizedGain) * 0.25,
        action: 'Consider selling to offset gains'
      });
    }
  });
  
  return suggestions;
}

function generateTaxReport(transactions, portfolio, year) {
  const capitalGainsTax = calculateGermanCapitalGainsTax(transactions, year);
  const cryptoTax = calculateCryptoTax(transactions, year);
  const realizedGains = calculateRealizedGains(transactions, year);
  const unrealizedGains = calculateUnrealizedGains(portfolio, transactions);
  
  return {
    year: year,
    summary: {
      totalRealizedGains: realizedGains.totalGains,
      totalUnrealizedGains: unrealizedGains.reduce(function(sum, p) { return sum + p.unrealizedGain; }, 0),
      totalTaxOwed: capitalGainsTax.totalTax,
      effectiveTaxRate: capitalGainsTax.effectiveTaxRate
    },
    capitalGains: capitalGainsTax,
    crypto: cryptoTax,
    transactions: realizedGains.transactions,
    unrealized: unrealizedGains,
    recommendations: suggestTaxLossHarvesting(portfolio, transactions)
  };
}

// ============================================================================
// PORTFOLIO REBALANCING
// ============================================================================

function analyzePortfolioDrift(portfolio, targetAllocation, transactions) {
  const currentAllocation = {};
  let totalValue = 0;
  
  ['crypto', 'stocks', 'skins'].forEach(function(category) {
    const categoryValue = (portfolio[category] || []).reduce(function(sum, pos) {
      return sum + (pos.amount * (pos.currentPrice || pos.purchasePrice || 0));
    }, 0);
    
    const displayCategory = category === 'skins' ? 'cs2Items' : category;
    currentAllocation[displayCategory] = categoryValue;
    totalValue += categoryValue;
  });
  
  const drift = {};
  let maxDrift = 0;
  
  Object.keys(targetAllocation).forEach(function(category) {
    const target = targetAllocation[category];
    const current = totalValue > 0 ? (currentAllocation[category] / totalValue) * 100 : 0;
    const driftAmount = current - target;
    const driftPercent = target > 0 ? (driftAmount / target) * 100 : 0;
    
    drift[category] = {
      target: target,
      current: current,
      driftAmount: driftAmount,
      driftPercent: Math.abs(driftPercent),
      overweight: driftAmount > 0,
      currentValue: currentAllocation[category],
      targetValue: totalValue * (target / 100)
    };
    
    maxDrift = Math.max(maxDrift, Math.abs(driftAmount));
  });
  
  const needsRebalancing = maxDrift > 5;
  
  return {
    totalValue: totalValue,
    currentAllocation: currentAllocation,
    targetAllocation: targetAllocation,
    drift: drift,
    maxDrift: maxDrift,
    needsRebalancing: needsRebalancing,
    driftScore: maxDrift
  };
}

function generateRebalancingSuggestions(portfolio, targetAllocation, transactions) {
  const analysis = analyzePortfolioDrift(portfolio, targetAllocation, transactions);
  
  if (!analysis.needsRebalancing) {
    return {
      rebalanceNeeded: false,
      message: 'Portfolio is well-balanced. No action needed.',
      analysis: analysis
    };
  }
  
  const suggestions = [];
  const trades = [];
  
  Object.keys(analysis.drift).forEach(function(category) {
    const d = analysis.drift[category];
    const amountToAdjust = d.targetValue - d.currentValue;
    
    if (Math.abs(amountToAdjust) < 50) return;
    
    if (amountToAdjust > 0) {
      suggestions.push({
        action: 'BUY',
        category: category,
        amount: amountToAdjust,
        reason: 'Underweight by ' + Math.abs(d.driftAmount).toFixed(2) + '%',
        priority: Math.abs(d.driftPercent) > 20 ? 'high' : 'medium'
      });
      
      trades.push({
        type: 'buy',
        category: category,
        value: amountToAdjust
      });
    } else {
      suggestions.push({
        action: 'SELL',
        category: category,
        amount: Math.abs(amountToAdjust),
        reason: 'Overweight by ' + Math.abs(d.driftAmount).toFixed(2) + '%',
        priority: Math.abs(d.driftPercent) > 20 ? 'high' : 'medium'
      });
      
      trades.push({
        type: 'sell',
        category: category,
        value: Math.abs(amountToAdjust)
      });
    }
  });
  
  return {
    rebalanceNeeded: true,
    analysis: analysis,
    suggestions: suggestions,
    trades: trades,
    estimatedCost: trades.length * 5,
    taxImpact: 0
  };
}

// ============================================================================
// LEGACY COMPATIBILITY FUNCTIONS
// ============================================================================

function calculateIntegratedCashflow(financialData, assets) {
  assets = assets || [];
  
  const salaryIncome = calculateMonthlyIncome(financialData.income || []);
  const dividendIncome = (financialData.income || [])
    .filter(function(inc) { return inc.type === 'dividends'; })
    .reduce(function(sum, inc) {
      return sum + convertToMonthly(inc.amount, inc.frequency);
    }, 0);
  
  const totalIncome = salaryIncome + dividendIncome;
  
  const fixedCosts = calculateMonthlyExpenses(financialData.fixedCosts || []);
  const variableExpenses = calculateVariableExpenses(financialData.variableExpenses || []);
  const debtPayments = calculateDebtPayments(financialData.debts || []);
  
  const totalExpenses = fixedCosts + variableExpenses + debtPayments;
  
  return {
    income: {
      salary: salaryIncome,
      dividends: dividendIncome,
      total: totalIncome
    },
    expenses: {
      fixed: fixedCosts,
      variable: variableExpenses,
      debt: debtPayments,
      total: totalExpenses
    },
    netCashflow: totalIncome - totalExpenses,
    savingsAvailable: Math.max(0, totalIncome - totalExpenses)
  };
}

function calculateVariableExpenses(variableExpenses) {
  return variableExpenses.reduce(function(sum, exp) {
    return sum + (exp.monthlyAverage || 0);
  }, 0);
}

function calculateDebtPayments(debts) {
  return debts.reduce(function(sum, debt) {
    return sum + (debt.monthlyPayment || 0);
  }, 0);
}

function convertToMonthly(amount, frequency) {
  switch (frequency) {
    case 'monthly': return amount;
    case 'quarterly': return amount / 3;
    case 'yearly': return amount / 12;
    default: return amount;
  }
}

function calculateIntegratedNetWorth(financialData, assets) {
  assets = assets || [];
  
  const totalCash = calculateTotalCash(financialData.cashAccounts || []);
  const portfolioValue = calculatePortfolioValue(assets);
  const totalDebt = calculateTotalDebt(financialData.debts || []);
  
  return {
    cash: totalCash,
    investments: portfolioValue,
    assets: totalCash + portfolioValue,
    debts: totalDebt,
    netWorth: totalCash + portfolioValue - totalDebt
  };
}

function calculatePortfolioValue(assets) {
  return assets.reduce(function(sum, asset) {
    const currentPrice = asset.currentPrice || asset.purchasePrice;
    return sum + (asset.amount * currentPrice);
  }, 0);
}

function calculateFixedCostRatio(financialData) {
  const fixedCosts = calculateMonthlyExpenses(financialData.fixedCosts || []);
  const income = calculateMonthlyIncome(financialData.income || []);
  
  if (income === 0) return 0;
  return (fixedCosts / income) * 100;
}

function calculateVariableCostRatio(financialData) {
  const variableExpenses = calculateVariableExpenses(financialData.variableExpenses || []);
  const income = calculateMonthlyIncome(financialData.income || []);
  
  if (income === 0) return 0;
  return (variableExpenses / income) * 100;
}

function calculateDebtToIncomeRatio(financialData) {
  const monthlyDebtPayments = calculateDebtPayments(financialData.debts || []);
  const monthlyIncome = calculateMonthlyIncome(financialData.income || []);
  
  if (monthlyIncome === 0) return 0;
  return (monthlyDebtPayments / monthlyIncome) * 100;
}

function calculateEnhancedCashBuffer(financialData) {
  const totalCash = calculateTotalCash(financialData.cashAccounts || []);
  const emergencyFundCash = (financialData.cashAccounts || [])
    .filter(function(acc) { return acc.isEmergencyFund; })
    .reduce(function(sum, acc) { return sum + acc.balance; }, 0);
  
  const monthlyExpenses = calculateMonthlyExpenses(financialData.fixedCosts || []) +
                         calculateVariableExpenses(financialData.variableExpenses || []);
  
  return {
    totalMonths: monthlyExpenses > 0 ? totalCash / monthlyExpenses : Infinity,
    emergencyFundMonths: emergencyFundCash > 0 && monthlyExpenses > 0 ? emergencyFundCash / monthlyExpenses : 0,
    totalCash: totalCash,
    emergencyFundCash: emergencyFundCash,
    monthlyExpenses: monthlyExpenses
  };
}

function calculateFIREMetrics(financialData, assets, withdrawalRate) {
  assets = assets || [];
  withdrawalRate = withdrawalRate || 4;
  
  const netWorth = calculateIntegratedNetWorth(financialData, assets);
  const yearlyExpenses = (calculateMonthlyExpenses(financialData.fixedCosts || []) +
                          calculateVariableExpenses(financialData.variableExpenses || [])) * 12;
  
  const fireNumber = yearlyExpenses * (100 / withdrawalRate);
  const fireProgress = (netWorth.netWorth / fireNumber) * 100;
  
  const cashflow = calculateIntegratedCashflow(financialData, assets);
  const yearsToFIRE = fireProgress >= 100 ? 0 :
    cashflow.savingsAvailable > 0 ?
      (fireNumber - netWorth.netWorth) / (cashflow.savingsAvailable * 12) :
      Infinity;
  
  return {
    fireNumber: fireNumber,
    currentNetWorth: netWorth.netWorth,
    progress: fireProgress,
    yearsToFIRE: Math.max(0, yearsToFIRE),
    monthlyPassiveIncome: (netWorth.netWorth * (withdrawalRate / 100)) / 12,
    requiredMonthlyPassiveIncome: yearlyExpenses / 12
  };
}

function calculateBudgetUtilization(financialData) {
  const budgets = financialData.budgets || [];
  const activeBudgets = budgets.filter(function(b) { return b.isActive; });
  
  const utilization = activeBudgets.map(function(budget) {
    const spent = budget.currentSpent || 0;
    const limit = budget.amount || 1;
    const percentage = (spent / limit) * 100;
    const status = percentage >= 100 ? 'exceeded' : 
                   percentage >= (budget.alertThreshold || 80) ? 'warning' : 'ok';
    
    return {
      id: budget.id,
      name: budget.name,
      category: budget.category,
      spent: spent,
      limit: limit,
      remaining: limit - spent,
      percentage: percentage,
      status: status
    };
  });
  
  const totalBudgeted = activeBudgets.reduce(function(sum, b) { return sum + b.amount; }, 0);
  const totalSpent = activeBudgets.reduce(function(sum, b) { return sum + (b.currentSpent || 0); }, 0);
  
  return {
    budgets: utilization,
    summary: {
      totalBudgeted: totalBudgeted,
      totalSpent: totalSpent,
      totalRemaining: totalBudgeted - totalSpent,
      utilization: totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0
    }
  };
}

function calculateGoalProgress(financialData) {
  const goals = financialData.goals || [];
  const monthlySavings = calculateIntegratedCashflow(financialData).savingsAvailable;
  
  return goals.map(function(goal) {
    const progress = (goal.currentAmount / goal.targetAmount) * 100;
    const remaining = goal.targetAmount - goal.currentAmount;
    const monthlyContribution = goal.monthlyContribution || (monthlySavings / Math.max(goals.length, 1));
    const monthsToGoal = monthlyContribution > 0 ? remaining / monthlyContribution : Infinity;
    
    var onTrack = true;
    if (goal.deadline) {
      const deadline = new Date(goal.deadline);
      const today = new Date();
      const monthsRemaining = (deadline - today) / (1000 * 60 * 60 * 24 * 30);
      const requiredMonthlyContribution = monthsRemaining > 0 ? remaining / monthsRemaining : Infinity;
      onTrack = monthlyContribution >= requiredMonthlyContribution;
    }
    
    return {
      id: goal.id,
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      progress: progress,
      remaining: remaining,
      monthsToGoal: monthsToGoal,
      onTrack: onTrack
    };
  });
}

function calculateNetIncome(incomeArray, taxArray) {
  if (!incomeArray || !Array.isArray(incomeArray)) return 0;
  
  const totalIncome = incomeArray.reduce(function(sum, inc) {
    const monthlyIncome = convertToMonthly(inc.amount || 0, inc.frequency || 'monthly');
    return sum + monthlyIncome;
  }, 0);
  
  const totalTax = taxArray && Array.isArray(taxArray) ? taxArray.reduce(function(sum, tax) {
    const monthlyTax = convertToMonthly(tax.amount || 0, tax.frequency || 'monthly');
    return sum + monthlyTax;
  }, 0) : 0;
  
  return totalIncome - totalTax;
}

function calculateDetailedCashflow(financialData) {
  const monthlyIncome = (financialData.income || []).reduce(function(sum, inc) {
    return sum + convertToMonthly(inc.amount || 0, inc.frequency || 'monthly');
  }, 0);
  
  const monthlyFixed = (financialData.fixedCosts || []).reduce(function(sum, cost) {
    return sum + convertToMonthly(cost.amount || 0, cost.frequency || 'monthly');
  }, 0);
  
  const monthlyVariable = calculateVariableExpenses(financialData.variableExpenses || []);
  const monthlyDebt = calculateDebtPayments(financialData.debts || []);
  
  const monthlyTax = (financialData.taxes || []).reduce(function(sum, tax) {
    return sum + convertToMonthly(tax.amount || 0, tax.frequency || 'monthly');
  }, 0);
  
  const totalExpenses = monthlyFixed + monthlyVariable + monthlyDebt + monthlyTax;
  const netCashflow = monthlyIncome - totalExpenses;
  
  return {
    income: monthlyIncome,
    fixedCosts: monthlyFixed,
    variableExpenses: monthlyVariable,
    debtPayments: monthlyDebt,
    taxes: monthlyTax,
    totalExpenses: totalExpenses,
    netCashflow: netCashflow,
    savingsRate: monthlyIncome > 0 ? (netCashflow / monthlyIncome) * 100 : 0
  };
}

function calculateOverallBudgetStatus(budgets) {
  if (!budgets || !Array.isArray(budgets) || budgets.length === 0) {
    return {
      totalBudget: 0,
      totalSpent: 0,
      remaining: 0,
      utilizationRate: 0,
      budgetsOverLimit: 0,
      budgetsUnderLimit: 0
    };
  }
  
  const totalBudget = budgets.reduce(function(sum, b) { return sum + (b.amount || 0); }, 0);
  const totalSpent = budgets.reduce(function(sum, b) { return sum + (b.spent || 0); }, 0);
  const remaining = totalBudget - totalSpent;
  const utilizationRate = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  
  const budgetsOverLimit = budgets.filter(function(b) { return (b.spent || 0) > (b.amount || 0); }).length;
  const budgetsUnderLimit = budgets.filter(function(b) { return (b.spent || 0) <= (b.amount || 0); }).length;
  
  return {
    totalBudget: totalBudget,
    totalSpent: totalSpent,
    remaining: remaining,
    utilizationRate: utilizationRate,
    budgetsOverLimit: budgetsOverLimit,
    budgetsUnderLimit: budgetsUnderLimit
  };
}

// Helper functions
function calculateMonthlyIncome(income) {
  return income.reduce(function(sum, inc) {
    return sum + convertToMonthly(inc.amount || 0, inc.frequency || 'monthly');
  }, 0);
}

function calculateMonthlyExpenses(fixedCosts) {
  return fixedCosts.reduce(function(sum, cost) {
    return sum + convertToMonthly(cost.amount || 0, cost.frequency || 'monthly');
  }, 0);
}

function calculateTotalCash(cashAccounts) {
  return cashAccounts.reduce(function(sum, acc) {
    return sum + (acc.balance || 0);
  }, 0);
}

function calculateTotalDebt(debts) {
  return debts.reduce(function(sum, debt) {
    return sum + (debt.currentBalance || 0);
  }, 0);
}

// ============================================================================
// EXPORTS
// ============================================================================

if (typeof window !== 'undefined') {
  window.calculateCostBasis = calculateCostBasis;
  window.calculateRealizedGains = calculateRealizedGains;
  window.calculateUnrealizedGains = calculateUnrealizedGains;
  window.calculateGermanCapitalGainsTax = calculateGermanCapitalGainsTax;
  window.calculateCryptoTax = calculateCryptoTax;
  window.suggestTaxLossHarvesting = suggestTaxLossHarvesting;
  window.generateTaxReport = generateTaxReport;
  window.analyzePortfolioDrift = analyzePortfolioDrift;
  window.generateRebalancingSuggestions = generateRebalancingSuggestions;
  window.calculateIntegratedCashflow = calculateIntegratedCashflow;
  window.calculateIntegratedNetWorth = calculateIntegratedNetWorth;
  window.calculatePortfolioValue = calculatePortfolioValue;
  window.calculateVariableExpenses = calculateVariableExpenses;
  window.calculateDebtPayments = calculateDebtPayments;
  window.convertToMonthly = convertToMonthly;
  window.calculateFixedCostRatio = calculateFixedCostRatio;
  window.calculateVariableCostRatio = calculateVariableCostRatio;
  window.calculateDebtToIncomeRatio = calculateDebtToIncomeRatio;
  window.calculateEnhancedCashBuffer = calculateEnhancedCashBuffer;
  window.calculateFIREMetrics = calculateFIREMetrics;
  window.calculateBudgetUtilization = calculateBudgetUtilization;
  window.calculateGoalProgress = calculateGoalProgress;
  window.calculateNetIncome = calculateNetIncome;
  window.calculateDetailedCashflow = calculateDetailedCashflow;
  window.calculateOverallBudgetStatus = calculateOverallBudgetStatus;
  
  console.log('[OK] Calculator Extended v4.1 - All features loaded');
}
