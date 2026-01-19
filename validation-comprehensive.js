// ============================================================================
// MAERMIN v6.0 - Comprehensive Validation Module
// Input validation and data sanitization
// ============================================================================

/**
 * Validate position data
 */
function validatePosition(position) {
  var errors = [];
  
  if (!position) {
    return { valid: false, errors: ['Position data is required'] };
  }
  
  // Symbol validation
  if (!position.symbol && !position.name) {
    errors.push('Symbol or name is required');
  } else {
    var symbol = position.symbol || position.name;
    if (typeof symbol !== 'string' || symbol.trim().length === 0) {
      errors.push('Symbol must be a non-empty string');
    } else if (symbol.length > 50) {
      errors.push('Symbol is too long (max 50 characters)');
    }
  }
  
  // Amount validation
  if (position.amount === undefined || position.amount === null) {
    errors.push('Amount is required');
  } else if (typeof position.amount !== 'number' || isNaN(position.amount)) {
    errors.push('Amount must be a valid number');
  } else if (position.amount <= 0) {
    errors.push('Amount must be greater than 0');
  }
  
  // Purchase price validation
  if (position.purchasePrice === undefined || position.purchasePrice === null) {
    errors.push('Purchase price is required');
  } else if (typeof position.purchasePrice !== 'number' || isNaN(position.purchasePrice)) {
    errors.push('Purchase price must be a valid number');
  } else if (position.purchasePrice < 0) {
    errors.push('Purchase price cannot be negative');
  }
  
  // Purchase date validation (optional but must be valid if provided)
  if (position.purchaseDate) {
    var date = new Date(position.purchaseDate);
    if (isNaN(date.getTime())) {
      errors.push('Purchase date is invalid');
    } else if (date > new Date()) {
      errors.push('Purchase date cannot be in the future');
    }
  }
  
  // Fees validation (optional)
  if (position.fees !== undefined && position.fees !== null && position.fees !== '') {
    if (typeof position.fees !== 'number' || isNaN(position.fees)) {
      errors.push('Fees must be a valid number');
    } else if (position.fees < 0) {
      errors.push('Fees cannot be negative');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate transaction data
 */
function validateTransaction(transaction) {
  var errors = [];
  
  if (!transaction) {
    return { valid: false, errors: ['Transaction data is required'] };
  }
  
  // Type validation
  var validTypes = ['buy', 'sell', 'dividend', 'transfer', 'fee', 'interest'];
  if (!transaction.type) {
    errors.push('Transaction type is required');
  } else if (validTypes.indexOf(transaction.type) === -1) {
    errors.push('Invalid transaction type. Must be one of: ' + validTypes.join(', '));
  }
  
  // Symbol validation
  if (!transaction.symbol && !transaction.asset) {
    errors.push('Symbol or asset is required');
  }
  
  // Quantity validation
  if (transaction.type === 'buy' || transaction.type === 'sell') {
    if (transaction.quantity === undefined || transaction.quantity === null) {
      errors.push('Quantity is required for buy/sell transactions');
    } else if (typeof transaction.quantity !== 'number' || isNaN(transaction.quantity)) {
      errors.push('Quantity must be a valid number');
    } else if (transaction.quantity <= 0) {
      errors.push('Quantity must be greater than 0');
    }
  }
  
  // Price validation
  if (transaction.type === 'buy' || transaction.type === 'sell') {
    if (transaction.price === undefined || transaction.price === null) {
      errors.push('Price is required for buy/sell transactions');
    } else if (typeof transaction.price !== 'number' || isNaN(transaction.price)) {
      errors.push('Price must be a valid number');
    } else if (transaction.price < 0) {
      errors.push('Price cannot be negative');
    }
  }
  
  // Date validation
  if (!transaction.date && !transaction.timestamp && !transaction.transactionDate) {
    errors.push('Transaction date is required');
  } else {
    var dateStr = transaction.date || transaction.timestamp || transaction.transactionDate;
    var date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      errors.push('Transaction date is invalid');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validate API key format
 */
function validateApiKey(key, provider) {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'API key is required' };
  }
  
  key = key.trim();
  
  if (key.length === 0) {
    return { valid: false, error: 'API key cannot be empty' };
  }
  
  // Provider-specific validation
  switch (provider) {
    case 'alphavantage':
      // Alpha Vantage keys are typically 16 alphanumeric characters
      if (!/^[A-Z0-9]{12,20}$/i.test(key)) {
        return { valid: false, error: 'Invalid Alpha Vantage API key format' };
      }
      break;
    case 'skinport':
      // Skinport API keys are typically UUIDs
      if (!/^[a-f0-9-]{32,40}$/i.test(key)) {
        return { valid: false, error: 'Invalid Skinport API key format' };
      }
      break;
  }
  
  return { valid: true };
}

/**
 * Sanitize user input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML
    .slice(0, 1000); // Limit length
}

/**
 * Validate email format
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }
  
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  
  return { valid: true };
}

/**
 * Validate numeric range
 */
function validateNumericRange(value, min, max, fieldName) {
  fieldName = fieldName || 'Value';
  
  if (value === undefined || value === null) {
    return { valid: false, error: fieldName + ' is required' };
  }
  
  if (typeof value !== 'number' || isNaN(value)) {
    return { valid: false, error: fieldName + ' must be a valid number' };
  }
  
  if (min !== undefined && value < min) {
    return { valid: false, error: fieldName + ' must be at least ' + min };
  }
  
  if (max !== undefined && value > max) {
    return { valid: false, error: fieldName + ' must be at most ' + max };
  }
  
  return { valid: true };
}

/**
 * Validate date range
 */
function validateDateRange(startDate, endDate) {
  var start = new Date(startDate);
  var end = new Date(endDate);
  
  if (isNaN(start.getTime())) {
    return { valid: false, error: 'Start date is invalid' };
  }
  
  if (isNaN(end.getTime())) {
    return { valid: false, error: 'End date is invalid' };
  }
  
  if (start > end) {
    return { valid: false, error: 'Start date must be before end date' };
  }
  
  return { valid: true };
}

/**
 * Validate backup password
 */
function validateBackupPassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  
  return { valid: true };
}

/**
 * Validate import data format
 */
function validateImportData(data, format) {
  format = format || 'json';
  
  if (!data) {
    return { valid: false, error: 'No data provided' };
  }
  
  switch (format) {
    case 'json':
      try {
        if (typeof data === 'string') {
          JSON.parse(data);
        }
        return { valid: true };
      } catch (e) {
        return { valid: false, error: 'Invalid JSON format' };
      }
    
    case 'csv':
      if (typeof data !== 'string') {
        return { valid: false, error: 'CSV data must be a string' };
      }
      if (data.indexOf(',') === -1 && data.indexOf(';') === -1) {
        return { valid: false, error: 'Invalid CSV format' };
      }
      return { valid: true };
    
    default:
      return { valid: false, error: 'Unsupported format: ' + format };
  }
}

/**
 * Validate portfolio structure
 */
function validatePortfolio(portfolio) {
  var errors = [];
  
  if (!portfolio || typeof portfolio !== 'object') {
    return { valid: false, errors: ['Portfolio must be an object'] };
  }
  
  var validCategories = ['crypto', 'stocks', 'skins'];
  
  validCategories.forEach(function(category) {
    if (portfolio[category]) {
      if (!Array.isArray(portfolio[category])) {
        errors.push(category + ' must be an array');
      } else {
        portfolio[category].forEach(function(position, index) {
          var posValidation = validatePosition(position);
          if (!posValidation.valid) {
            posValidation.errors.forEach(function(err) {
              errors.push(category + '[' + index + ']: ' + err);
            });
          }
        });
      }
    }
  });
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// Export functions
if (typeof window !== 'undefined') {
  window.validatePosition = validatePosition;
  window.validateTransaction = validateTransaction;
  window.validateApiKey = validateApiKey;
  window.sanitizeInput = sanitizeInput;
  window.validateEmail = validateEmail;
  window.validateNumericRange = validateNumericRange;
  window.validateDateRange = validateDateRange;
  window.validateBackupPassword = validateBackupPassword;
  window.validateImportData = validateImportData;
  window.validatePortfolio = validatePortfolio;
  
  console.log('[VALIDATION] Comprehensive validation module loaded');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validatePosition: validatePosition,
    validateTransaction: validateTransaction,
    validateApiKey: validateApiKey,
    sanitizeInput: sanitizeInput,
    validateEmail: validateEmail,
    validateNumericRange: validateNumericRange,
    validateDateRange: validateDateRange,
    validateBackupPassword: validateBackupPassword,
    validateImportData: validateImportData,
    validatePortfolio: validatePortfolio
  };
}
