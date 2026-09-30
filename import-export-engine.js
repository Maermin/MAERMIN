// ============================================================================
// MAERMIN v6.0 - Bulk Import/Export Engine
// Support for CSV, Excel, and broker-specific formats
// ============================================================================

// ---- shared parsing helpers ----------------------------------------------
// Locale-aware number parsing is REUSED from import-mapping.js (the one
// implementation that understands "1.234,56"); a bare parseFloat truncated
// German decimals ("180,55" -> 180, "1.234,56" -> 1.234).
function resolveImportMapping() {
  if (typeof window !== 'undefined' && window.MaerminImportMapping) return window.MaerminImportMapping;
  try { return require('./import-mapping.js'); } catch (e) { return null; }
}
function num(value, locale) {
  const IM = resolveImportMapping();
  const n = IM && IM.parseNumber ? IM.parseNumber(value, locale) : parseFloat(value);
  return isFinite(n) ? n : 0;
}

// Trade Republic / German broker transaction type -> 'buy' | 'sell' | null.
// Order matters: "Verkauf" contains "kauf", so sells are matched first.
// Anything that is not a trade (Dividende, Zinsen, Einzahlung, Steuer, ...) is
// skipped instead of being booked as a sell.
function germanTradeType(raw) {
  const t = String(raw || '').toLowerCase();
  if (/verkauf|\bsell\b|\bsale\b/.test(t)) return 'sell';
  if (/kauf|\bbuy\b|sparplan|savings ?plan/.test(t)) return 'buy';
  return null;
}

// Split an exchange pair ('BTCEUR', 'BTC/EUR', 'BTC-USDT') into base + quote.
const PAIR_QUOTES = ['FDUSD', 'USDT', 'USDC', 'BUSD', 'EUR', 'USD', 'BTC', 'ETH', 'BNB'];
function splitPair(pair) {
  const p = String(pair || '').toUpperCase().replace(/[\/\-_ ]/g, '');
  for (const q of PAIR_QUOTES) {
    if (p.length > q.length && p.endsWith(q)) return { base: p.slice(0, -q.length), quote: q };
  }
  return { base: p, quote: '' };
}
// Quote currency -> the app's canonical transaction currency. Stablecoins are
// USD; EUR stays EUR; crypto-to-crypto quotes are returned as-is so the data
// quality layer can flag them (they are never silently treated as EUR).
function quoteCurrency(q) {
  if (q === 'EUR') return 'EUR';
  if (['USD', 'USDT', 'USDC', 'BUSD', 'FDUSD'].includes(q)) return 'USD';
  return q || 'USD';
}

/**
 * Broker-specific parsers for common trading platforms
 */
const BrokerParsers = {
  /**
   * Interactive Brokers Activity Statement
   */
  interactiveBrokers: {
    name: 'Interactive Brokers',
    detect: (headers) => {
      return headers.some(h => h.includes('ClientAccountID')) ||
             headers.some(h => h.includes('TradeID'));
    },
    parse: (rows, headers) => {
      const transactions = [];
      
      rows.forEach(row => {
        // Skip non-trade rows
        if (!row['Asset Category'] || row['Asset Category'] === 'Header') return;
        
        const transaction = {
          type: row['Buy/Sell'] === 'BUY' ? 'buy' : 'sell',
          symbol: row['Symbol'] || row['Description'],
          quantity: Math.abs(parseFloat(row['Quantity']) || 0),
          price: Math.abs(parseFloat(row['T. Price']) || parseFloat(row['Price']) || 0),
          fees: Math.abs(parseFloat(row['Comm/Fee']) || 0),
          date: parseDate(row['Trade Date'] || row['Date/Time']),
          currency: row['Currency'] || 'USD',
          broker: 'Interactive Brokers',
          originalRow: row
        };
        
        if (transaction.symbol && transaction.quantity > 0) {
          transactions.push(transaction);
        }
      });
      
      return transactions;
    }
  },

  /**
   * Degiro Transaction Export
   */
  degiro: {
    name: 'DEGIRO',
    detect: (headers) => {
      return headers.some(h => h.includes('Produkt') || h.includes('Product')) &&
             headers.some(h => h.includes('ISIN'));
    },
    parse: (rows, headers) => {
      const transactions = [];
      
      rows.forEach(row => {
        const loc = (row['Anzahl'] != null || row['Kurs'] != null || row['Aantal'] != null) ? 'de' : undefined;
        const quantity = num(row['Anzahl'] || row['Aantal'] || row['Number'] || 0, loc);
        const price = num(row['Kurs'] || row['Koers'] || row['Price'] || 0, loc);
        
        const transaction = {
          type: quantity > 0 ? 'buy' : 'sell',
          symbol: row['Produkt'] || row['Product'],
          isin: row['ISIN'],
          quantity: Math.abs(quantity),
          price: Math.abs(price),
          fees: Math.abs(num(row['Gebühren'] || row['Kosten'] || row['Fees'] || 0, loc)),
          date: parseDate(row['Datum'] || row['Date']),
          currency: row['Währung'] || row['Currency'] || 'EUR',
          broker: 'DEGIRO',
          originalRow: row
        };
        
        if (transaction.symbol && transaction.quantity > 0) {
          transactions.push(transaction);
        }
      });
      
      return transactions;
    }
  },

  /**
   * Trade Republic Export
   */
  tradeRepublic: {
    name: 'Trade Republic',
    detect: (headers) => {
      return headers.some(h => h.includes('Wertpapier') || h.includes('ISIN')) &&
             headers.some(h => h.includes('Stück') || h.includes('Anteile'));
    },
    parse: (rows, headers) => {
      const transactions = [];
      
      rows.forEach(row => {
        const tradeType = germanTradeType(row['Typ'] || row['Type']);
        if (!tradeType) return; // dividend / interest / cash rows are not trades

        const transaction = {
          type: tradeType,
          symbol: row['Wertpapier'] || row['Name'],
          isin: row['ISIN'],
          quantity: Math.abs(num(row['Stück'] || row['Anteile'] || 0, 'de')),
          price: Math.abs(num(row['Kurs'] || row['Preis'] || 0, 'de')),
          fees: Math.abs(num(row['Gebühren'] || row['Provision'] || 0, 'de')),
          date: parseDate(row['Datum'] || row['Date']),
          currency: 'EUR',
          broker: 'Trade Republic',
          originalRow: row
        };
        
        if (transaction.symbol && transaction.quantity > 0) {
          transactions.push(transaction);
        }
      });
      
      return transactions;
    }
  },

  /**
   * Coinbase Transaction Export
   */
  coinbase: {
    name: 'Coinbase',
    detect: (headers) => {
      return headers.some(h => h.includes('Transaction Type') || h.includes('Asset')) &&
             headers.some(h => h.includes('Quantity Transacted') || h.includes('Spot Price'));
    },
    parse: (rows, headers) => {
      const transactions = [];
      
      rows.forEach(row => {
        const type = (row['Transaction Type'] || '').toLowerCase();
        if (!type.includes('buy') && !type.includes('sell')) return;
        
        const transaction = {
          type: type.includes('buy') ? 'buy' : 'sell',
          symbol: row['Asset'] || row['Currency'],
          quantity: Math.abs(parseFloat(row['Quantity Transacted'] || row['Amount'] || 0)),
          price: Math.abs(parseFloat(row['Spot Price at Transaction'] || row['Spot Price'] || 0)),
          fees: Math.abs(parseFloat(row['Fees'] || row['Fee Amount'] || 0)),
          date: parseDate(row['Timestamp'] || row['Date']),
          currency: row['Spot Price Currency'] || 'USD',
          broker: 'Coinbase',
          originalRow: row
        };
        
        if (transaction.symbol && transaction.quantity > 0) {
          transactions.push(transaction);
        }
      });
      
      return transactions;
    }
  },

  /**
   * Binance Trade History
   */
  binance: {
    name: 'Binance',
    detect: (headers) => {
      return headers.some(h => h.includes('Pair') || h.includes('Market')) &&
             headers.some(h => h.includes('Side') || h.includes('Type'));
    },
    parse: (rows, headers) => {
      const transactions = [];
      
      rows.forEach(row => {
        const side = (row['Side'] || row['Type'] || '').toLowerCase();
        
        // Symbol = the BASE asset of the pair and currency = the QUOTE (it
        // used to keep 'BTCEUR' as the symbol and take the FEE coin, e.g. BNB,
        // as the currency). A fee paid in another coin can't be valued here,
        // so only a quote-currency fee is carried.
        const pair = splitPair(row['Pair'] || row['Market']);
        const feeCoin = String(row['Fee Coin'] || '').toUpperCase();
        const transaction = {
          type: side.includes('buy') ? 'buy' : 'sell',
          symbol: pair.base,
          quantity: Math.abs(num(row['Executed'] || row['Amount'] || row['Qty'] || 0)),
          price: Math.abs(num(row['Price'] || row['Avg Price'] || 0)),
          fees: (!feeCoin || feeCoin === pair.quote) ? Math.abs(num(row['Fee'] || 0)) : 0,
          date: parseDate(row['Date(UTC)'] || row['Date'] || row['Time']),
          currency: quoteCurrency(pair.quote),
          broker: 'Binance',
          originalRow: row
        };
        
        if (transaction.symbol && transaction.quantity > 0) {
          transactions.push(transaction);
        }
      });
      
      return transactions;
    }
  },

  /**
   * Kraken Ledger Export
   */
  kraken: {
    name: 'Kraken',
    detect: (headers) => {
      return headers.some(h => h.includes('txid') || h.includes('refid')) &&
             headers.some(h => h.includes('asset') || h.includes('pair'));
    },
    parse: (rows, headers) => {
      const transactions = [];
      
      rows.forEach(row => {
        const type = (row['type'] || '').toLowerCase();
        if (type !== 'trade') return;
        
        const amount = parseFloat(row['amount'] || 0);
        
        const transaction = {
          type: amount > 0 ? 'buy' : 'sell',
          symbol: row['asset'] || row['pair'],
          quantity: Math.abs(amount),
          price: Math.abs(parseFloat(row['price'] || 0)),
          fees: Math.abs(parseFloat(row['fee'] || 0)),
          date: parseDate(row['time'] || row['date']),
          currency: 'EUR',
          broker: 'Kraken',
          refId: row['refid'],
          originalRow: row
        };
        
        if (transaction.symbol && transaction.quantity > 0) {
          transactions.push(transaction);
        }
      });
      
      return transactions;
    }
  },

  /**
   * Generic CSV format
   */
  generic: {
    name: 'Generic',
    detect: () => true, // Fallback
    parse: (rows, headers) => {
      const transactions = [];
      
      // Try to auto-detect column mappings
      const mapping = detectColumnMapping(headers);
      
      rows.forEach(row => {
        const transaction = {
          type: getValueByMapping(row, mapping.type) || 'buy',
          symbol: getValueByMapping(row, mapping.symbol),
          quantity: Math.abs(num(getValueByMapping(row, mapping.quantity))),
          price: Math.abs(num(getValueByMapping(row, mapping.price))),
          fees: Math.abs(num(getValueByMapping(row, mapping.fees))),
          date: parseDate(getValueByMapping(row, mapping.date)),
          currency: getValueByMapping(row, mapping.currency) || 'EUR',
          broker: 'Manual Import',
          originalRow: row
        };
        
        if (transaction.symbol && transaction.quantity > 0) {
          transactions.push(transaction);
        }
      });
      
      return transactions;
    }
  }
};

/**
 * Auto-detect column mapping from headers
 */
function detectColumnMapping(headers) {
  const mapping = {
    type: null,
    symbol: null,
    quantity: null,
    price: null,
    fees: null,
    date: null,
    currency: null
  };

  const patterns = {
    type: ['type', 'side', 'action', 'buy/sell', 'direction'],
    symbol: ['symbol', 'ticker', 'asset', 'name', 'product', 'coin', 'currency'],
    quantity: ['quantity', 'amount', 'qty', 'units', 'shares', 'size', 'volume'],
    price: ['price', 'rate', 'cost', 'value per'],
    fees: ['fee', 'fees', 'commission', 'cost', 'charges'],
    date: ['date', 'time', 'timestamp', 'created', 'executed'],
    currency: ['currency', 'ccy', 'base']
  };

  headers.forEach(header => {
    const headerLower = header.toLowerCase();
    
    Object.entries(patterns).forEach(([field, keywords]) => {
      if (!mapping[field]) {
        if (keywords.some(k => headerLower.includes(k))) {
          mapping[field] = header;
        }
      }
    });
  });

  return mapping;
}

/**
 * Get value from row by mapping
 */
function getValueByMapping(row, column) {
  if (!column) return null;
  return row[column];
}

/**
 * Parse date string to ISO format
 */
function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  
  // Try common formats
  const formats = [
    // ISO
    /^\d{4}-\d{2}-\d{2}/,
    // DD/MM/YYYY or DD.MM.YYYY
    /^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})/,
    // MM/DD/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    // YYYY/MM/DD
    /^(\d{4})\/(\d{2})\/(\d{2})/
  ];

  try {
    // Try native parsing first
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    // Try DD/MM/YYYY format (common in Europe)
    const euroMatch = dateStr.match(/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})/);
    if (euroMatch) {
      const [, day, month, year] = euroMatch;
      return new Date(year, month - 1, day).toISOString();
    }

    return new Date().toISOString();
  } catch (e) {
    return new Date().toISOString();
  }
}

/**
 * Main import function
 */
function importData(data, format, options = {}) {
  let headers, rows;

  if (format === 'csv') {
    const parsed = parseCSV(data);
    headers = parsed.headers;
    rows = parsed.rows;
  } else if (format === 'json') {
    if (Array.isArray(data)) {
      rows = data;
      headers = data.length > 0 ? Object.keys(data[0]) : [];
    } else if (data.transactions) {
      rows = data.transactions;
      headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    } else {
      throw new Error('Invalid JSON format');
    }
  } else {
    throw new Error(`Unsupported format: ${format}`);
  }

  // Detect broker and parse. An explicitly chosen broker (the import wizard's
  // selection) wins over header sniffing, which used to pick the first
  // matching detector regardless of what the user selected.
  let parser = null;
  let detectedBroker = 'Unknown';

  if (options.broker && BrokerParsers[options.broker]) {
    parser = BrokerParsers[options.broker];
    detectedBroker = parser.name;
  }
  for (const [brokerId, brokerParser] of Object.entries(parser ? {} : BrokerParsers)) {
    if (brokerParser.detect(headers)) {
      parser = brokerParser;
      detectedBroker = brokerParser.name;
      break;
    }
  }

  if (!parser) {
    parser = BrokerParsers.generic;
    detectedBroker = 'Generic';
  }

  const transactions = parser.parse(rows, headers);

  // Detect duplicates if existing data provided
  let duplicates = [];
  if (options.existingTransactions) {
    const result = detectDuplicates(transactions, options.existingTransactions);
    duplicates = result.duplicates;
  }

  // Categorize assets
  const categorized = categorizeAssets(transactions);

  return {
    broker: detectedBroker,
    totalRows: rows.length,
    parsedTransactions: transactions.length,
    transactions: categorized,
    duplicates,
    headers,
    preview: transactions.slice(0, 10)
  };
}

/**
 * Parse CSV string
 */
// Split CSV text into records. Newlines INSIDE quoted fields (multi-line notes
// in broker exports) stay part of the record instead of breaking it apart; a
// leading UTF-8 BOM (Excel "CSV UTF-8") is stripped so the first header still
// matches; blank records are dropped.
function splitCSVRecords(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { inQ = !inQ; cur += c; continue; }
    if (!inQ && (c === '\n' || c === '\r')) {
      if (c === '\r' && s[i + 1] === '\n') i++;
      if (cur.trim() !== '') out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

function parseCSV(content) {
  const lines = splitCSVRecords(content);
  if (lines.length === 0) return { headers: [], rows: [] };

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : 
                    firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  const headers = parseCSVLine(lines[0], delimiter);
  const rows = lines.slice(1).map(line => {
    const values = parseCSVLine(line, delimiter);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = values[i] || '';
    });
    return row;
  });

  return { headers, rows };
}

/**
 * Parse single CSV line
 */
function parseCSVLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Detect duplicate transactions
 */
function detectDuplicates(newTransactions, existingTransactions) {
  const duplicates = [];
  const unique = [];

  newTransactions.forEach(newTx => {
    const isDuplicate = existingTransactions.some(existingTx => {
      return existingTx.symbol === newTx.symbol &&
             existingTx.quantity === newTx.quantity &&
             existingTx.price === newTx.price &&
             Math.abs(new Date(existingTx.date) - new Date(newTx.date)) < 86400000; // Same day
    });

    if (isDuplicate) {
      duplicates.push(newTx);
    } else {
      unique.push(newTx);
    }
  });

  return { duplicates, unique };
}

/**
 * Categorize assets by type (crypto, stocks, skins)
 */
function categorizeAssets(transactions) {
  const cryptoSymbols = [
    'BTC', 'ETH', 'XRP', 'ADA', 'SOL', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI',
    'ATOM', 'LTC', 'BCH', 'XLM', 'ALGO', 'VET', 'NEAR', 'FTM', 'MANA', 'SAND',
    'DOGE', 'SHIB', 'APE', 'CRO', 'AAVE', 'MKR', 'COMP', 'SNX', 'YFI', 'SUSHI'
  ];

  return transactions.map(tx => {
    let category = 'stocks'; // Default

    const symbolUpper = (tx.symbol || '').toUpperCase();
    
    // Check if crypto
    if (cryptoSymbols.some(c => symbolUpper.includes(c))) {
      category = 'crypto';
    }
    // Check if CS2 skin (usually has specific naming)
    else if (symbolUpper.includes('|') || 
             symbolUpper.includes('SKIN') || 
             symbolUpper.includes('KNIFE') ||
             symbolUpper.includes('GLOVES')) {
      category = 'skins';
    }

    return { ...tx, category };
  });
}

/**
 * Export transactions to various formats
 */
function exportData(transactions, format, options = {}) {
  switch (format) {
    case 'csv':
      return exportToCSV(transactions, options);
    case 'json':
      return exportToJSON(transactions, options);
    case 'excel':
      return exportToExcelData(transactions, options);
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
}

/**
 * One CSV cell: quotes are doubled (a `"` in a symbol/note broke the row), and
 * text that a spreadsheet would evaluate as a formula (= + - @, tab, CR) is
 * prefixed with an apostrophe - imported broker data is third-party input and
 * must not become a live =HYPERLINK()/DDE formula when the export is opened.
 * Plain numbers (including negatives) are left untouched.
 */
function csvCell(cell) {
  let s = cell === null || cell === undefined ? '' : String(cell);
  const isNumber = s.trim() !== '' && isFinite(Number(s));
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * Export to CSV string
 */
function exportToCSV(transactions, options = {}) {
  const headers = options.headers || [
    'Date', 'Type', 'Symbol', 'Category', 'Quantity', 'Price', 'Total', 'Fees', 'Currency'
  ];

  const rows = transactions.map(tx => [
    tx.date || '',
    tx.type || '',
    tx.symbol || '',
    tx.category || '',
    tx.quantity || '',
    tx.price || '',
    ((tx.quantity || 0) * (tx.price || 0)).toFixed(2),
    tx.fees || '',
    tx.currency || ''
  ]);

  const csvContent = [
    headers.map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(','))
  ].join('\n');

  return csvContent;
}

/**
 * Export to JSON string
 */
function exportToJSON(transactions, options = {}) {
  const data = {
    exportDate: new Date().toISOString(),
    version: '6.0',
    count: transactions.length,
    transactions: transactions.map(tx => ({
      date: tx.date,
      type: tx.type,
      symbol: tx.symbol,
      category: tx.category,
      quantity: tx.quantity,
      price: tx.price,
      fees: tx.fees,
      currency: tx.currency
    }))
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Generate Excel-compatible data structure
 */
function exportToExcelData(transactions, options = {}) {
  return {
    sheets: [
      {
        name: 'Transactions',
        headers: ['Date', 'Type', 'Symbol', 'Category', 'Quantity', 'Price', 'Total', 'Fees', 'Currency'],
        rows: transactions.map(tx => [
          tx.date,
          tx.type,
          tx.symbol,
          tx.category,
          tx.quantity,
          tx.price,
          (tx.quantity || 0) * (tx.price || 0),
          tx.fees,
          tx.currency
        ])
      },
      {
        name: 'Summary',
        headers: ['Category', 'Count', 'Total Value', 'Total Fees'],
        rows: summarizeByCategory(transactions)
      }
    ]
  };
}

/**
 * Summarize transactions by category
 */
function summarizeByCategory(transactions) {
  const summary = {};

  transactions.forEach(tx => {
    const cat = tx.category || 'other';
    if (!summary[cat]) {
      summary[cat] = { count: 0, value: 0, fees: 0 };
    }
    summary[cat].count++;
    summary[cat].value += (tx.quantity || 0) * (tx.price || 0);
    summary[cat].fees += tx.fees || 0;
  });

  return Object.entries(summary).map(([category, data]) => [
    category,
    data.count,
    data.value.toFixed(2),
    data.fees.toFixed(2)
  ]);
}

/**
 * Column mapping wizard helper
 */
function createColumnMappingWizard(headers) {
  const fields = [
    { id: 'type', label: 'Transaction Type (Buy/Sell)', required: false },
    { id: 'symbol', label: 'Asset Symbol/Name', required: true },
    { id: 'quantity', label: 'Quantity/Amount', required: true },
    { id: 'price', label: 'Price per Unit', required: true },
    { id: 'fees', label: 'Fees/Commission', required: false },
    { id: 'date', label: 'Date/Timestamp', required: true },
    { id: 'currency', label: 'Currency', required: false }
  ];

  const suggestions = detectColumnMapping(headers);

  return {
    fields,
    headers,
    suggestions,
    validate: (mapping) => {
      const required = fields.filter(f => f.required);
      const missing = required.filter(f => !mapping[f.id]);
      return {
        valid: missing.length === 0,
        missing: missing.map(f => f.label)
      };
    }
  };
}

// Export for use
if (typeof window !== 'undefined') {
  window.ImportExportEngine = {
    BrokerParsers,
    importData,
    exportData,
    exportToCSV,
    exportToJSON,
    parseCSV,
    detectDuplicates,
    categorizeAssets,
    createColumnMappingWizard
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BrokerParsers,
    germanTradeType,
    splitPair,
    quoteCurrency,
    importData,
    exportData,
    exportToCSV,
    exportToJSON,
    parseCSV,
    detectDuplicates,
    categorizeAssets,
    createColumnMappingWizard
  };
}
