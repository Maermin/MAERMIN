// ============================================================================
// MAERMIN v5.0 - Comprehensive Validation Module
// ============================================================================

function validateRequired(value, fieldName) {
  if (!value || (typeof value === 'string' && value.trim() === '')) {
    return { valid: false, errors: [fieldName + ' ist erforderlich / is required'] };
  }
  return { valid: true, errors: [] };
}

function validatePositiveNumber(value, fieldName) {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) {
    return { valid: false, errors: [fieldName + ' muss positiv sein / must be positive'] };
  }
  return { valid: true, errors: [] };
}

function validateNonNegativeNumber(value, fieldName) {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0) {
    return { valid: false, errors: [fieldName + ' darf nicht negativ sein / must be non-negative'] };
  }
  return { valid: true, errors: [] };
}

function validatePercentage(value, fieldName) {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0 || num > 100) {
    return { valid: false, errors: [fieldName + ' muss zwischen 0 und 100 sein / must be between 0 and 100'] };
  }
  return { valid: true, errors: [] };
}

function validateDate(value, fieldName) {
  if (!value) return { valid: true, errors: [] };
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return { valid: false, errors: [fieldName + ' ist kein gueltiges Datum / is not a valid date'] };
  }
  return { valid: true, errors: [] };
}

function validateIncome(income) {
  const errors = [];
  
  if (!income.name || income.name.trim().length < 2) {
    errors.push('Name muss mindestens 2 Zeichen haben / Name must be at least 2 characters');
  }
  
  const amount = parseFloat(income.amount);
  if (isNaN(amount) || amount <= 0) {
    errors.push('Betrag muss positiv sein / Amount must be positive');
  }
  
  if (!income.type || !['salary', 'freelance', 'rental', 'dividends', 'bonus', 'other'].includes(income.type)) {
    errors.push('Ungueltiger Typ / Invalid type');
  }
  
  if (!income.frequency || !['monthly', 'quarterly', 'yearly'].includes(income.frequency)) {
    errors.push('Ungueltige Haeufigkeit / Invalid frequency');
  }
  
  return { valid: errors.length === 0, errors: errors };
}

function validateExpense(expense) {
  const errors = [];
  
  const validCategories = ['groceries', 'dining', 'transport', 'entertainment', 'shopping', 
                          'healthcare', 'utilities', 'insurance', 'personalCare', 'education', 
                          'gifts', 'charity', 'other'];
  
  if (!expense.category || !validCategories.includes(expense.category)) {
    errors.push('Ungueltige Kategorie / Invalid category');
  }
  
  const amount = parseFloat(expense.monthlyAverage);
  if (isNaN(amount) || amount < 0) {
    errors.push('Betrag darf nicht negativ sein / Amount must be non-negative');
  }
  
  return { valid: errors.length === 0, errors: errors };
}

function validateFixedCost(cost) {
  const errors = [];
  
  if (!cost.name || cost.name.trim().length < 2) {
    errors.push('Name muss mindestens 2 Zeichen haben / Name must be at least 2 characters');
  }
  
  const amount = parseFloat(cost.amount);
  if (isNaN(amount) || amount <= 0) {
    errors.push('Betrag muss positiv sein / Amount must be positive');
  }
  
  const validCategories = ['housing', 'utilities', 'insurance', 'transport', 'subscription', 'other'];
  if (!cost.category || !validCategories.includes(cost.category)) {
    errors.push('Ungueltige Kategorie / Invalid category');
  }
  
  if (!cost.frequency || !['monthly', 'quarterly', 'yearly'].includes(cost.frequency)) {
    errors.push('Ungueltige Haeufigkeit / Invalid frequency');
  }
  
  return { valid: errors.length === 0, errors: errors };
}

function validateDebt(debt) {
  const errors = [];
  
  if (!debt.name || debt.name.trim().length < 2) {
    errors.push('Name muss mindestens 2 Zeichen haben / Name must be at least 2 characters');
  }
  
  const principal = parseFloat(debt.principal);
  if (isNaN(principal) || principal <= 0) {
    errors.push('Ursprungsbetrag muss positiv sein / Principal must be positive');
  }
  
  const balance = parseFloat(debt.currentBalance);
  if (isNaN(balance) || balance < 0) {
    errors.push('Aktueller Stand darf nicht negativ sein / Current balance must be non-negative');
  }
  
  if (balance > principal) {
    errors.push('Stand kann nicht hoeher als Ursprungsbetrag sein / Balance cannot exceed principal');
  }
  
  return { valid: errors.length === 0, errors: errors };
}

function validateTax(tax) {
  const errors = [];
  
  if (!tax.name || tax.name.trim().length < 2) {
    errors.push('Name muss mindestens 2 Zeichen haben / Name must be at least 2 characters');
  }
  
  const validTypes = ['income', 'capital_gains', 'solidarity', 'church', 'trade', 'vat', 'flat'];
  if (!tax.type || !validTypes.includes(tax.type)) {
    errors.push('Ungueltiger Steuertyp / Invalid tax type');
  }
  
  if (tax.type === 'flat' && tax.rate !== undefined) {
    const rate = parseFloat(tax.rate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      errors.push('Steuersatz muss zwischen 0 und 100 sein / Tax rate must be between 0 and 100');
    }
  }
  
  return { valid: errors.length === 0, errors: errors };
}

function validateBudget(budget) {
  const errors = [];
  
  if (!budget.name || budget.name.trim().length < 2) {
    errors.push('Name muss mindestens 2 Zeichen haben / Name must be at least 2 characters');
  }
  
  const amount = parseFloat(budget.amount);
  if (isNaN(amount) || amount <= 0) {
    errors.push('Betrag muss positiv sein / Amount must be positive');
  }
  
  const validCategories = ['groceries', 'dining', 'transport', 'entertainment', 'shopping', 
                          'healthcare', 'utilities', 'other'];
  if (!budget.category || !validCategories.includes(budget.category)) {
    errors.push('Ungueltige Kategorie / Invalid category');
  }
  
  return { valid: errors.length === 0, errors: errors };
}

function validateGoal(goal) {
  const errors = [];
  
  if (!goal.name || goal.name.trim().length < 2) {
    errors.push('Name muss mindestens 2 Zeichen haben / Name must be at least 2 characters');
  }
  
  const target = parseFloat(goal.targetAmount);
  if (isNaN(target) || target <= 0) {
    errors.push('Zielbetrag muss positiv sein / Target amount must be positive');
  }
  
  const current = parseFloat(goal.currentAmount);
  if (isNaN(current) || current < 0) {
    errors.push('Aktueller Betrag darf nicht negativ sein / Current amount must be non-negative');
  }
  
  if (current > target) {
    errors.push('Aktueller Betrag uebersteigt Ziel / Current amount exceeds target');
  }
  
  return { valid: errors.length === 0, errors: errors };
}

// Export
if (typeof window !== 'undefined') {
  window.validateRequired = validateRequired;
  window.validatePositiveNumber = validatePositiveNumber;
  window.validateNonNegativeNumber = validateNonNegativeNumber;
  window.validatePercentage = validatePercentage;
  window.validateDate = validateDate;
  window.validateIncome = validateIncome;
  window.validateExpense = validateExpense;
  window.validateFixedCost = validateFixedCost;
  window.validateDebt = validateDebt;
  window.validateTax = validateTax;
  window.validateBudget = validateBudget;
  window.validateGoal = validateGoal;
  
  console.log('[OK] Validation loaded v5.0');
}
