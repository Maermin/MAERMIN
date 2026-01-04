// ============================================================================
// MAERMIN v3.0.1 - Extended Calculator Module  
// ============================================================================

function calculateIntegratedCashflow(financialData, assets) {
  assets = assets || [];
  
  // Income calculation
  const salaryIncome = calculateMonthlyIncome(financialData.income || []);
  const dividendIncome = (financialData.income || [])
    .filter(function(inc) { return inc.type === 'dividends'; })
    .reduce(function(sum, inc) {
      return sum + convertToMonthly(inc.amount, inc.frequency);
    }, 0);
  
  const totalIncome = salaryIncome + dividendIncome;
  
  // Expense calculation
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

// Export
if (typeof window !== 'undefined') {
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
  
  console.log('[OK] Calculator Extended + Legacy Functions loaded v3.0.1');
}

// ============================================================================
// LEGACY COMPATIBILITY FUNCTIONS
// ============================================================================

function calculateNetIncome(incomeArray, taxArray) {
  if (!incomeArray || !Array.isArray(incomeArray)) return 0;
  
  const totalIncome = incomeArray.reduce((sum, inc) => {
    const monthlyIncome = convertToMonthly(inc.amount || 0, inc.frequency || 'monthly');
    return sum + monthlyIncome;
  }, 0);
  
  const totalTax = taxArray && Array.isArray(taxArray) ? taxArray.reduce((sum, tax) => {
    const monthlyTax = convertToMonthly(tax.amount || 0, tax.frequency || 'monthly');
    return sum + monthlyTax;
  }, 0) : 0;
  
  return totalIncome - totalTax;
}

function calculateDetailedCashflow(financialData) {
  const monthlyIncome = (financialData.income || []).reduce((sum, inc) => 
    sum + convertToMonthly(inc.amount || 0, inc.frequency || 'monthly'), 0);
  
  const monthlyFixed = (financialData.fixedCosts || []).reduce((sum, cost) => 
    sum + convertToMonthly(cost.amount || 0, cost.frequency || 'monthly'), 0);
  
  const monthlyVariable = calculateVariableExpenses(financialData.variableExpenses || []);
  
  const monthlyDebt = calculateDebtPayments(financialData.debts || []);
  
  const monthlyTax = (financialData.taxes || []).reduce((sum, tax) => 
    sum + convertToMonthly(tax.amount || 0, tax.frequency || 'monthly'), 0);
  
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
  
  const totalBudget = budgets.reduce((sum, b) => sum + (b.amount || 0), 0);
  const totalSpent = budgets.reduce((sum, b) => sum + (b.spent || 0), 0);
  const remaining = totalBudget - totalSpent;
  const utilizationRate = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  
  const budgetsOverLimit = budgets.filter(b => (b.spent || 0) > (b.amount || 0)).length;
  const budgetsUnderLimit = budgets.filter(b => (b.spent || 0) <= (b.amount || 0)).length;
  
  return {
    totalBudget,
    totalSpent,
    remaining,
    utilizationRate,
    budgetsOverLimit,
    budgetsUnderLimit
  };
}

console.log('[OK] Calculator Extended + Legacy Functions loaded v3.0.1');
