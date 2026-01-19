// ============================================================================
// MAERMIN v5.1 - Advanced Tax Calculation Engine
// Accurate calculations for German and US tax law
// ============================================================================

/**
 * Calculate realized gains from transactions using FIFO method
 * Matches sell transactions with corresponding buy transactions
 */
function calculateRealizedGainsAdvanced(transactions, year) {
  if (!transactions || !Array.isArray(transactions)) {
    return {
      transactions: [],
      totalShortTermGains: 0,
      totalLongTermGains: 0,
      cryptoShortTermGains: 0,
      cryptoLongTermGains: 0,
      stocksShortTermGains: 0,
      stocksLongTermGains: 0
    };
  }

  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);

  // Group transactions by symbol
  const symbols = {};
  
  transactions.forEach(tx => {
    const symbol = tx.asset?.symbol;
    if (!symbol) return;
    
    if (!symbols[symbol]) {
      symbols[symbol] = {
        buys: [],
        sells: [],
        category: tx.asset.category
      };
    }
    
    if (tx.type === 'buy') {
      symbols[symbol].buys.push(tx);
    } else if (tx.type === 'sell') {
      symbols[symbol].sells.push(tx);
    }
  });

  const results = [];
  let totalShortTermGains = 0;
  let totalLongTermGains = 0;
  let cryptoShortTermGains = 0;
  let cryptoLongTermGains = 0;
  let stocksShortTermGains = 0;
  let stocksLongTermGains = 0;

  // Process each symbol
  Object.keys(symbols).forEach(symbol => {
    const data = symbols[symbol];
    
    // Sort buys by date (FIFO)
    data.buys.sort((a, b) => new Date(a.transactionDate || a.timestamp) - new Date(b.transactionDate || b.timestamp));
    
    // Sort sells by date
    data.sells.sort((a, b) => new Date(a.transactionDate || a.timestamp) - new Date(b.transactionDate || b.timestamp));
    
    // Process each sell transaction
    data.sells.forEach(sell => {
      const sellDate = new Date(sell.transactionDate || sell.timestamp);
      
      // Only include sells in the selected year
      if (sellDate < yearStart || sellDate > yearEnd) return;
      
      let remainingQuantity = sell.quantity;
      let totalCostBasis = 0;
      let totalProceeds = sell.totalCost || (sell.price * sell.quantity);
      let weightedHoldingPeriod = 0;
      const matchedBuys = [];
      
      // Match with buys using FIFO
      for (let i = 0; i < data.buys.length && remainingQuantity > 0.0001; i++) {
        const buy = data.buys[i];
        const buyDate = new Date(buy.transactionDate || buy.timestamp);
        
        // Skip buys after sell date
        if (buyDate > sellDate) continue;
        
        // Calculate available quantity from this buy
        const usedQuantity = Math.min(remainingQuantity, buy.quantity);
        
        // Calculate cost basis for this portion
        const costBasis = (buy.price * usedQuantity) + ((buy.fees || 0) * (usedQuantity / buy.quantity));
        totalCostBasis += costBasis;
        
        // Calculate holding period in days
        const holdingPeriodDays = Math.floor((sellDate - buyDate) / (1000 * 60 * 60 * 24));
        weightedHoldingPeriod += holdingPeriodDays * usedQuantity;
        
        matchedBuys.push({
          buyDate: buyDate,
          quantity: usedQuantity,
          price: buy.price,
          costBasis: costBasis,
          holdingPeriod: holdingPeriodDays
        });
        
        remainingQuantity -= usedQuantity;
        
        // Update remaining quantity in buy
        buy.quantity -= usedQuantity;
      }
      
      // Calculate average holding period
      const totalMatchedQuantity = sell.quantity - remainingQuantity;
      const avgHoldingPeriod = totalMatchedQuantity > 0 ? Math.floor(weightedHoldingPeriod / totalMatchedQuantity) : 0;
      
      // Calculate gain/loss
      const sellFees = sell.fees || 0;
      const proceeds = totalProceeds - sellFees;
      const gain = proceeds - totalCostBasis;
      
      // Determine if long-term or short-term
      const isLongTerm = avgHoldingPeriod >= 365;
      
      // Categorize by asset type and term
      if (data.category === 'crypto') {
        if (isLongTerm) {
          cryptoLongTermGains += gain;
          totalLongTermGains += gain;
        } else {
          cryptoShortTermGains += gain;
          totalShortTermGains += gain;
        }
      } else {
        // Stocks, CS2, etc.
        if (isLongTerm) {
          stocksLongTermGains += gain;
          totalLongTermGains += gain;
        } else {
          stocksShortTermGains += gain;
          totalShortTermGains += gain;
        }
      }
      
      // Add to results
      results.push({
        ...sell,
        realizedGain: {
          gain: gain,
          proceeds: proceeds,
          costBasis: totalCostBasis,
          holdingPeriod: avgHoldingPeriod,
          isLongTerm: isLongTerm,
          matchedBuys: matchedBuys
        }
      });
    });
  });

  return {
    transactions: results,
    totalShortTermGains: totalShortTermGains,
    totalLongTermGains: totalLongTermGains,
    totalGains: totalShortTermGains + totalLongTermGains,
    cryptoShortTermGains: cryptoShortTermGains,
    cryptoLongTermGains: cryptoLongTermGains,
    stocksShortTermGains: stocksShortTermGains,
    stocksLongTermGains: stocksLongTermGains
  };
}

/**
 * German Tax Calculation
 * Key differences:
 * - Crypto held > 1 year = TAX FREE (completely exempt!)
 * - Crypto held ≤ 1 year = 25% Abgeltungssteuer + 5.5% Soli
 * - Stocks = Always 25% + Soli (no holding period benefit)
 * - €1,000 Freistellungsauftrag applies to ALL gains
 */
function calculateGermanTax(transactions, year) {
  const gains = calculateRealizedGainsAdvanced(transactions, year);
  
  // GERMAN RULE: Crypto > 1 year is TAX FREE!
  const taxableCryptoGains = gains.cryptoShortTermGains; // Only short-term crypto is taxable
  const taxFreeCryptoGains = gains.cryptoLongTermGains;  // Long-term crypto is TAX FREE
  
  // GERMAN RULE: Stocks always taxed at 25%, regardless of holding period
  const taxableStocksGains = gains.stocksShortTermGains + gains.stocksLongTermGains;
  
  // Total taxable capital income
  const totalCapitalIncome = taxableCryptoGains + taxableStocksGains;
  
  // Apply Freistellungsauftrag (€1,000 tax-free allowance)
  const FREISTELLUNGSAUFTRAG = 1000;
  const taxableIncome = Math.max(0, totalCapitalIncome - FREISTELLUNGSAUFTRAG);
  
  // Calculate Abgeltungssteuer (25%)
  const ABGELTUNGSSTEUER_RATE = 0.25;
  const abgeltungssteuer = taxableIncome * ABGELTUNGSSTEUER_RATE;
  
  // Calculate Solidaritätszuschlag (5.5% of Abgeltungssteuer)
  const SOLIDARITY_RATE = 0.055;
  const solidarityTax = abgeltungssteuer * SOLIDARITY_RATE;
  
  // Total tax owed
  const totalTax = abgeltungssteuer + solidarityTax;
  
  // Effective tax rate
  const effectiveTaxRate = totalCapitalIncome > 0 ? (totalTax / totalCapitalIncome) * 100 : 0;
  
  // Tax savings from crypto 1-year rule
  const cryptoTaxSavings = taxFreeCryptoGains * ABGELTUNGSSTEUER_RATE * (1 + SOLIDARITY_RATE);
  
  return {
    jurisdiction: 'de',
    year: year,
    
    // Breakdown
    cryptoShortTermGains: gains.cryptoShortTermGains,
    cryptoLongTermGains: gains.cryptoLongTermGains,
    cryptoTaxableGains: taxableCryptoGains,
    cryptoTaxFreeGains: taxFreeCryptoGains,
    
    stocksGains: taxableStocksGains,
    
    // Summary
    totalCapitalIncome: totalCapitalIncome,
    freistellungsauftrag: FREISTELLUNGSAUFTRAG,
    freistellungsauftragUsed: Math.min(totalCapitalIncome, FREISTELLUNGSAUFTRAG),
    taxableIncome: taxableIncome,
    
    // Taxes
    abgeltungssteuer: abgeltungssteuer,
    solidarityTax: solidarityTax,
    totalTax: totalTax,
    effectiveTaxRate: effectiveTaxRate,
    
    // Savings
    cryptoTaxSavings: cryptoTaxSavings,
    
    // Transactions
    transactions: gains.transactions
  };
}

/**
 * US Tax Calculation
 * Key differences:
 * - ALL sales are taxable (crypto and stocks treated the same)
 * - Short-term (≤ 1 year) = Ordinary income rates (estimated at 24%)
 * - Long-term (> 1 year) = Preferential rates (15% for most taxpayers)
 * - No general exemption amount
 */
function calculateUSTax(transactions, year) {
  const gains = calculateRealizedGainsAdvanced(transactions, year);
  
  // US RULE: ALL gains are taxable (crypto and stocks same treatment)
  const shortTermGains = gains.totalShortTermGains;
  const longTermGains = gains.totalLongTermGains;
  
  // Tax rate estimates (vary by income bracket)
  const SHORT_TERM_RATE = 0.24;  // Ordinary income - using 24% bracket estimate
  const LONG_TERM_RATE = 0.15;   // Long-term capital gains - 15% for most taxpayers
  
  // Calculate taxes
  const shortTermTax = shortTermGains * SHORT_TERM_RATE;
  const longTermTax = longTermGains * LONG_TERM_RATE;
  const totalTax = shortTermTax + longTermTax;
  
  // Total gains
  const totalGains = shortTermGains + longTermGains;
  
  // Effective tax rate
  const effectiveTaxRate = totalGains > 0 ? (totalTax / totalGains) * 100 : 0;
  
  return {
    jurisdiction: 'us',
    year: year,
    
    // Breakdown
    shortTermGains: shortTermGains,
    longTermGains: longTermGains,
    
    cryptoShortTermGains: gains.cryptoShortTermGains,
    cryptoLongTermGains: gains.cryptoLongTermGains,
    stocksShortTermGains: gains.stocksShortTermGains,
    stocksLongTermGains: gains.stocksLongTermGains,
    
    // Summary
    totalGains: totalGains,
    
    // Taxes (estimates)
    shortTermTax: shortTermTax,
    longTermTax: longTermTax,
    totalTax: totalTax,
    effectiveTaxRate: effectiveTaxRate,
    
    // Rate information
    shortTermRate: SHORT_TERM_RATE * 100,
    longTermRate: LONG_TERM_RATE * 100,
    
    // Transactions
    transactions: gains.transactions
  };
}

/**
 * Generate comprehensive tax report for selected jurisdiction
 */
function generateTaxReportAdvanced(transactions, year, jurisdiction) {
  if (jurisdiction === 'de') {
    return calculateGermanTax(transactions, year);
  } else if (jurisdiction === 'us') {
    return calculateUSTax(transactions, year);
  } else {
    throw new Error('Unknown jurisdiction: ' + jurisdiction);
  }
}

// Make functions globally available
window.calculateRealizedGainsAdvanced = calculateRealizedGainsAdvanced;
window.calculateGermanTax = calculateGermanTax;
window.calculateUSTax = calculateUSTax;
window.generateTaxReportAdvanced = generateTaxReportAdvanced;

// Create TaxCalculationEngine object for easy access
window.TaxCalculationEngine = {
  calculateRealizedGains: calculateRealizedGainsAdvanced,
  calculateGermanTax: calculateGermanTax,
  calculateUSTax: calculateUSTax,
  generateTaxReport: generateTaxReportAdvanced,
  calculateTaxes: function(transactions, jurisdiction, year) {
    var result = generateTaxReportAdvanced(transactions, year, jurisdiction);
    return {
      realizedGains: result.totalCapitalIncome || 0,
      shortTerm: result.cryptoShortTermGains || result.shortTermGains || 0,
      longTerm: result.cryptoLongTermGains || result.longTermGains || 0,
      taxLiability: result.totalTax || 0,
      taxFree: result.cryptoTaxFreeGains || 0,
      transactions: result.transactions || []
    };
  }
};

console.log('[TAX ENGINE] Advanced tax calculation loaded');
console.log('[TAX ENGINE] Supports: Germany (1-year crypto exemption) | USA (all taxable)');
