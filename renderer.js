// ============================================================================
// MAERMIN v6.0 - Main Application
// Multi-Asset Portfolio Tracker & Financial OS
// ============================================================================

(function() {
'use strict';

// Use React hooks
const { useState, useEffect, useMemo, useCallback, useRef } = React;

// Get translations
const translations = typeof window.completeTranslations !== 'undefined' ? window.completeTranslations : { de: {}, en: {} };

// Theme configuration
const themes = {
  white: {
    background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f8fafc 100%)',
    card: 'rgba(255,255,255,0.9)',
    cardBorder: 'rgba(0,0,0,0.1)',
    text: '#1e293b',
    textSecondary: '#64748b',
    inputBg: 'rgba(0,0,0,0.05)',
    inputBorder: 'rgba(0,0,0,0.1)',
    accent: '#7e22ce',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b'
  },
  dark: {
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
    card: 'rgba(30,41,59,0.9)',
    cardBorder: 'rgba(255,255,255,0.1)',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    inputBg: 'rgba(255,255,255,0.05)',
    inputBorder: 'rgba(255,255,255,0.1)',
    accent: '#8b5cf6',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b'
  },
  purple: {
    background: 'linear-gradient(135deg, #1e293b 0%, #7e22ce 50%, #1e293b 100%)',
    card: 'rgba(255,255,255,0.1)',
    cardBorder: 'rgba(255,255,255,0.2)',
    text: '#ffffff',
    textSecondary: 'rgba(255,255,255,0.6)',
    inputBg: 'rgba(255,255,255,0.1)',
    inputBorder: 'rgba(255,255,255,0.2)',
    accent: '#a855f7',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b'
  }
};

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

function InvestmentTracker() {
  // ========== STATE MANAGEMENT ==========
  
  // Transactions - the source of truth for portfolio
  const [transactions, setTransactions] = useState(() => {
    const saved = localStorage.getItem('transactions');
    return saved ? JSON.parse(saved) : [];
  });
  
  // Prices
  const [prices, setPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [images, setImages] = useState({});
  const [loading, setLoading] = useState(false);
  
  // Currency and exchange rate - needed for portfolio calculation
  const [currency, setCurrency] = useState('EUR');
  // Exchange rate: USD->EUR (how many EUR for 1 USD). EUR is stronger, so ~0.91
  const [exchangeRate, setExchangeRate] = useState(0.91);
  
  // Portfolio derived from transactions
  const portfolio = useMemo(() => {
    const result = { crypto: [], stocks: [], skins: [] };
    const positionMap = {}; // symbol -> aggregated position
    
    transactions.forEach(tx => {
      const category = tx.category || 'crypto';
      const symbol = (tx.symbol || '').toLowerCase();
      const key = `${category}-${symbol}`;
      
      if (!positionMap[key]) {
        positionMap[key] = {
          symbol: tx.symbol,
          amount: 0,
          totalCostEUR: 0, // Always store in EUR
          purchaseDate: tx.date,
          category: category
        };
      }
      
      // Get price in EUR - convert if transaction was in USD
      let priceEUR = parseFloat(tx.price) || 0;
      if (tx.currency === 'USD' && exchangeRate > 0) {
        // Convert USD to EUR: price in USD * (EUR per USD)
        priceEUR = priceEUR * exchangeRate;
      }
      
      if (tx.type === 'buy') {
        const qty = parseFloat(tx.quantity) || 0;
        positionMap[key].amount += qty;
        positionMap[key].totalCostEUR += qty * priceEUR;
      } else if (tx.type === 'sell') {
        positionMap[key].amount -= parseFloat(tx.quantity) || 0;
      }
    });
    
    // Convert map to arrays
    Object.values(positionMap).forEach(pos => {
      if (pos.amount > 0.0001) { // Only include positions with meaningful amounts
        const avgPriceEUR = pos.totalCostEUR / pos.amount;
        result[pos.category].push({
          id: `${pos.category}-${pos.symbol}`,
          symbol: pos.symbol,
          name: pos.symbol,
          amount: pos.amount,
          purchasePrice: avgPriceEUR, // Always in EUR
          purchaseDate: pos.purchaseDate
        });
      }
    });
    
    return result;
  }, [transactions, exchangeRate]);
  
  // UI State
  const [activeTab, setActiveTab] = useState('crypto');
  const [activeView, setActiveView] = useState('overview');
  const [theme, setTheme] = useState('purple');
  const [language, setLanguage] = useState('de');
  
  // v6.0 State
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState('default');
  const [toasts, setToasts] = useState([]);
  const [alerts, setAlerts] = useState([]);
  
  // Forms & Modals
  const [newTransaction, setNewTransaction] = useState({
    type: 'buy',
    category: 'crypto',
    symbol: '',
    quantity: '',
    price: '',
    date: new Date().toISOString().split('T')[0],
    fees: '',
    notes: '',
    currency: 'EUR' // Track which currency the transaction was added in
  });
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState(null); // null = adding new, id = editing
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState('');
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [apiKeys, setApiKeys] = useState({ alphaVantage: '', skinport: '' });
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Tax
  const [taxJurisdiction, setTaxJurisdiction] = useState(() => {
    return localStorage.getItem('taxJurisdiction') || 'de';
  });

  // ========== COMPUTED VALUES ==========
  
  const t = translations[language] || translations.de;
  const currentTheme = themes[theme];
  
  const formatPrice = useCallback((price) => {
    if (price === undefined || price === null || isNaN(price)) return '0.00';
    // All prices are stored in EUR
    // If user wants USD, convert from EUR to USD by dividing by the USD->EUR rate
    const converted = currency === 'USD' && exchangeRate > 0 ? price / exchangeRate : price;
    return converted.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [currency, exchangeRate]);

  const getCurrencySymbol = () => currency === 'EUR' ? 'EUR' : 'USD';

  // Category display names - internal names stay the same for data consistency
  const getCategoryDisplayName = (category) => {
    const displayNames = {
      crypto: t.crypto || 'Crypto',
      stocks: t.stocks || 'Stocks',
      skins: t.cs2Skins || 'CS2 Skins'
    };
    return displayNames[category] || category;
  };

  // Workspaces
  const workspaces = {
    default: { name: t.defaultWorkspace || 'Default', panels: ['overview'] },
    'tax-season': { name: t.taxSeasonWorkspace || 'Tax Season', panels: ['taxes'] },
    'deep-analysis': { name: t.deepAnalysisWorkspace || 'Deep Analysis', panels: ['analytics'] },
    'daily-check': { name: t.dailyCheckWorkspace || 'Daily Check', panels: ['overview'] }
  };

  // Calculate portfolio totals
  const portfolioStats = useMemo(() => {
    let totalValue = 0;
    let totalInvested = 0;
    let totalPositions = 0;

    ['crypto', 'stocks', 'skins'].forEach(category => {
      const positions = portfolio[category] || [];
      positions.forEach(pos => {
        const symbolOriginal = pos.symbol || pos.name || '';
        const symbolLower = symbolOriginal.toLowerCase();
        const symbolUpper = symbolOriginal.toUpperCase();
        // Try multiple lookups: original case, lowercase, uppercase
        const currentPrice = prices[symbolOriginal] || prices[symbolLower] || prices[symbolUpper] || pos.purchasePrice || 0;
        const value = (pos.amount || 1) * currentPrice;
        const invested = (pos.amount || 1) * (pos.purchasePrice || 0);
        
        totalValue += value;
        totalInvested += invested;
        totalPositions++;
      });
    });

    return {
      totalValue,
      totalInvested,
      totalProfit: totalValue - totalInvested,
      totalProfitPercent: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
      totalPositions
    };
  }, [portfolio, prices]);

  // ========== COMMANDS FOR PALETTE ==========
  
  const commands = useMemo(() => [
    // Navigation
    { id: 'nav:overview', label: t.goToOverview || 'Go to Overview', category: 'Navigation', shortcut: 'g o' },
    { id: 'nav:portfolio', label: t.goToPortfolio || 'Go to Portfolio', category: 'Navigation', shortcut: 'g p' },
    { id: 'nav:analytics', label: t.goToAnalytics || 'Go to Analytics', category: 'Navigation', shortcut: 'g a' },
    { id: 'nav:transactions', label: t.goToTransactions || 'Go to Transactions', category: 'Navigation', shortcut: 'g t' },
    { id: 'nav:taxes', label: t.goToTaxReport || 'Go to Tax Report', category: 'Navigation', shortcut: 'g x' },
    
    // Actions
    { id: 'action:add-position', label: t.addNew || 'Add Position', category: 'Actions', shortcut: 'n' },
    { id: 'action:add-transaction', label: t.addTransaction || 'Add Transaction', category: 'Actions', shortcut: 't' },
    { id: 'action:refresh', label: t.refresh || 'Refresh Prices', category: 'Actions', shortcut: 'r' },
    { id: 'action:import', label: t.importData || 'Import Data', category: 'Actions', shortcut: 'i' },
    { id: 'action:export', label: t.exportData || 'Export Data', category: 'Actions', shortcut: 'e' },
    
    // Analytics
    { id: 'analytics:correlation', label: t.correlationMatrix || 'Correlation Matrix', category: 'Analytics', shortcut: 'a c' },
    { id: 'analytics:montecarlo', label: t.monteCarloSimulation || 'Monte Carlo Simulation', category: 'Analytics', shortcut: 'a m' },
    { id: 'analytics:stress', label: t.stressTesting || 'Stress Testing', category: 'Analytics', shortcut: 'a s' },
    { id: 'analytics:risk', label: t.riskLevel || 'Risk Analytics', category: 'Analytics', shortcut: 'a r' },
    
    // Workspaces
    { id: 'workspace:default', label: t.defaultWorkspace || 'Default Workspace', category: 'Workspaces', shortcut: 'w 1' },
    { id: 'workspace:tax', label: t.taxSeasonWorkspace || 'Tax Season Workspace', category: 'Workspaces', shortcut: 'w 2' },
    { id: 'workspace:analysis', label: t.deepAnalysisWorkspace || 'Analysis Workspace', category: 'Workspaces', shortcut: 'w 3' },
    
    // Settings
    { id: 'settings:theme-light', label: t.whiteMode || 'Light Theme', category: 'Settings' },
    { id: 'settings:theme-dark', label: t.darkMode || 'Dark Theme', category: 'Settings' },
    { id: 'settings:theme-purple', label: t.purpleMode || 'Purple Theme', category: 'Settings' },
    { id: 'settings:lang-de', label: 'Deutsch', category: 'Settings' },
    { id: 'settings:lang-en', label: 'English', category: 'Settings' },
    { id: 'settings:api', label: t.apiSettings || 'API Settings', category: 'Settings' },
    
    // Alerts & Backup
    { id: 'alerts:create', label: t.createAlert || 'Create Price Alert', category: 'Alerts', shortcut: 'l' },
    { id: 'backup:create', label: t.createBackup || 'Create Backup', category: 'Backup', shortcut: 'b c' },
    { id: 'backup:restore', label: t.restoreBackup || 'Restore Backup', category: 'Backup', shortcut: 'b r' },
    
    // Help
    { id: 'help:shortcuts', label: t.keyboardShortcuts || 'Keyboard Shortcuts', category: 'Help', shortcut: '?' }
  ], [t]);

  // ========== COMMAND EXECUTION (moved below function definitions) ==========

  // ========== KEYBOARD SHORTCUTS ==========
  
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore if in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      
      // Command palette: Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
        return;
      }
      
      // Escape closes modals
      if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowShortcuts(false);
        setShowTransactionModal(false);
        setShowImportModal(false);
        setShowApiSettings(false);
        return;
      }
      
      // ? shows shortcuts
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        setShowShortcuts(true);
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ========== DATA PERSISTENCE ==========
  
  useEffect(() => {
    const saved = (key) => localStorage.getItem(key);
    if (saved('theme')) setTheme(saved('theme'));
    if (saved('language')) setLanguage(saved('language'));
    if (saved('currency')) setCurrency(saved('currency'));
    if (saved('apiKeys')) setApiKeys(JSON.parse(saved('apiKeys')));
    if (saved('priceHistory')) setPriceHistory(JSON.parse(saved('priceHistory')));
    if (saved('images')) setImages(JSON.parse(saved('images')));
    if (saved('alerts')) setAlerts(JSON.parse(saved('alerts')));
  }, []);

  useEffect(() => { localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('language', language); }, [language]);
  useEffect(() => { localStorage.setItem('currency', currency); }, [currency]);
  useEffect(() => { localStorage.setItem('transactions', JSON.stringify(transactions)); }, [transactions]);
  useEffect(() => { localStorage.setItem('priceHistory', JSON.stringify(priceHistory)); }, [priceHistory]);
  useEffect(() => { localStorage.setItem('images', JSON.stringify(images)); }, [images]);
  useEffect(() => { localStorage.setItem('taxJurisdiction', taxJurisdiction); }, [taxJurisdiction]);
  useEffect(() => { localStorage.setItem('alerts', JSON.stringify(alerts)); }, [alerts]);
  useEffect(() => { localStorage.setItem('apiKeys', JSON.stringify(apiKeys)); }, [apiKeys]);

  // ========== API FUNCTIONS ==========
  
  const fetchPrices = async () => {
    setLoading(true);
    const newPrices = { ...prices };
    const newImages = { ...images };
    const timestamp = new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    
    try {
      // First, fetch USD to EUR exchange rate from ExchangeRate-API (free, no key)
      // https://www.exchangerate-api.com/docs/free
      // Exchange rate direction: USD->EUR means how many EUR for 1 USD
      // EUR is stronger than USD, so rate is ~0.91 (1 USD = 0.91 EUR)
      let usdToEur = exchangeRate || 0.91; // Default fallback
      try {
        // Use the open endpoint which is in the CSP
        const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
        if (fxRes.ok) {
          const fxData = await fxRes.json();
          if (fxData.result === 'success' && fxData.rates && fxData.rates.EUR) {
            usdToEur = fxData.rates.EUR;
            setExchangeRate(usdToEur);
            console.log('[PRICES] Exchange rate: 1 USD =', usdToEur.toFixed(4), 'EUR');
          }
        }
      } catch (e) {
        console.error('[PRICES] Exchange rate fetch error:', e);
        console.log('[PRICES] Using fallback exchange rate: 1 USD =', usdToEur, 'EUR');
      }
      
      // Fetch crypto prices from CoinGecko (free, no API key needed)
      if (portfolio.crypto && portfolio.crypto.length > 0) {
        const ids = portfolio.crypto.map(c => (c.symbol || c.name || '').toLowerCase()).join(',');
        if (ids) {
          try {
            const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur,usd&include_24hr_change=true`);
            if (res.ok) {
              const data = await res.json();
              Object.keys(data).forEach(id => {
                // Store EUR price (or convert from USD if EUR not available)
                const eurPrice = data[id].eur || (data[id].usd * usdToEur);
                newPrices[id] = eurPrice;
                newPrices[id.toLowerCase()] = eurPrice;
              });
              console.log('[PRICES] Crypto prices fetched:', Object.keys(data).length);
            }
          } catch (e) {
            console.error('[PRICES] CoinGecko error:', e);
          }
        }
      }
      
      // Fetch stock prices from Alpha Vantage (requires API key)
      // Get free API key at: https://www.alphavantage.co/support/#api-key
      // Alpha Vantage returns prices in USD - we need to convert to EUR
      if (portfolio.stocks && portfolio.stocks.length > 0) {
        if (apiKeys.alphaVantage) {
          console.log('[PRICES] Fetching stock prices with Alpha Vantage...');
          for (const stock of portfolio.stocks.slice(0, 5)) { // Limit to 5 due to rate limits
            try {
              const symbol = (stock.symbol || stock.name || '').toUpperCase();
              const res = await fetch(
                `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKeys.alphaVantage}`
              );
              if (res.ok) {
                const data = await res.json();
                if (data['Global Quote'] && data['Global Quote']['05. price']) {
                  const priceUSD = parseFloat(data['Global Quote']['05. price']);
                  // Convert USD to EUR using the daily exchange rate
                  const priceEUR = priceUSD * usdToEur;
                  
                  // Store both lowercase and original symbol
                  newPrices[symbol.toLowerCase()] = priceEUR;
                  newPrices[symbol] = priceEUR;
                  
                  console.log('[PRICES] Stock:', symbol, '| USD:', priceUSD.toFixed(2), '| EUR:', priceEUR.toFixed(2));
                } else if (data['Note']) {
                  console.warn('[PRICES] Alpha Vantage rate limit:', data['Note']);
                  addToast('Alpha Vantage: Rate limit (5/min)', 'warning');
                  break;
                } else if (data['Error Message']) {
                  console.warn('[PRICES] Alpha Vantage error for', symbol, ':', data['Error Message']);
                }
              }
              // Alpha Vantage free tier: 5 calls per minute - wait 12 seconds between calls
              await new Promise(r => setTimeout(r, 12000));
            } catch (e) {
              console.error('[PRICES] Alpha Vantage error:', e);
            }
          }
        } else {
          console.log('[PRICES] No Alpha Vantage API key - skipping stocks. Get free key at: https://www.alphavantage.co/support/#api-key');
        }
      }
      
      // Fetch CS2 skin prices from Skinport (public API, no key needed)
      // API Docs: https://docs.skinport.com/items
      // NOTE: Prices are returned in full currency units (NOT cents)
      if (portfolio.skins && portfolio.skins.length > 0) {
        try {
          console.log('[PRICES] Fetching CS2 skin prices from Skinport...');
          const skinCurrency = 'EUR'; // Always fetch in EUR for consistency
          
          // Skinport API - try with Accept-Encoding header
          const skinportUrl = `https://api.skinport.com/v1/items?app_id=730&currency=${skinCurrency}&tradable=0`;
          
          const res = await fetch(skinportUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json'
            }
          });
          
          if (res.ok) {
            const skinportData = await res.json();
            let matchedCount = 0;
            let unmatchedItems = [];
            
            console.log('[PRICES] Skinport returned', skinportData.length, 'items');
            
            portfolio.skins.forEach(skin => {
              const skinName = (skin.symbol || skin.name || '');
              const skinNameLower = skinName.toLowerCase().trim();
              
              // Try exact match first (case-insensitive)
              let match = skinportData.find(item => {
                const itemName = (item.market_hash_name || '').toLowerCase().trim();
                return itemName === skinNameLower;
              });
              
              // If no exact match, try partial match for cases/collections
              if (!match) {
                match = skinportData.find(item => {
                  const itemName = (item.market_hash_name || '').toLowerCase().trim();
                  // For cases: "Fever Case" should match "Fever Case"
                  // For skins: Try to match main parts
                  const skinBase = skinNameLower.replace(/\s*\([^)]*\)\s*/g, '').trim();
                  const itemBase = itemName.replace(/\s*\([^)]*\)\s*/g, '').trim();
                  return itemBase === skinBase ||
                         (skinNameLower.includes('case') && itemName.includes(skinNameLower.replace(' case', '').trim()));
                });
              }
              
              if (match) {
                // Skinport returns prices in FULL currency units (not cents!)
                // Use min_price if available (lowest listed price), otherwise suggested_price
                const price = match.min_price || match.suggested_price || 0;
                
                if (price > 0) {
                  newPrices[skinNameLower] = price;
                  newPrices[skinName] = price;
                  matchedCount++;
                  console.log('[PRICES] Matched:', skinName, '| Price:', price.toFixed(2), 'EUR');
                }
              } else {
                unmatchedItems.push(skinName);
              }
            });
            
            console.log('[PRICES] CS2 skin prices matched:', matchedCount, '/', portfolio.skins.length);
            if (unmatchedItems.length > 0) {
              console.log('[PRICES] Unmatched skins:', unmatchedItems.slice(0, 5).join(', '), unmatchedItems.length > 5 ? '...' : '');
            }
          } else {
            console.error('[PRICES] Skinport API error:', res.status, res.statusText);
          }
        } catch (e) {
          console.error('[PRICES] Skinport error:', e);
        }
      }
      
      setPrices(newPrices);
      setImages(prev => ({ ...prev, ...newImages }));
      
      // Update price history
      const newHistory = { ...priceHistory };
      Object.entries(newPrices).forEach(([symbol, price]) => {
        if (typeof price === 'number' && !isNaN(price)) {
          if (!newHistory[symbol]) newHistory[symbol] = [];
          newHistory[symbol].push({ timestamp, price });
          if (newHistory[symbol].length > 100) {
            newHistory[symbol] = newHistory[symbol].slice(-100);
          }
        }
      });
      setPriceHistory(newHistory);
      
      const priceCount = Object.keys(newPrices).length;
      addToast(`${t.pricesUpdated || 'Prices updated'} (${priceCount})`, 'success');
    } catch (error) {
      console.error('[PRICES] General error:', error);
      addToast(t.error || 'Error fetching prices', 'error');
    }
    
    setLoading(false);
  };

  // ========== TOAST NOTIFICATIONS ==========
  
  const addToast = (message, type = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  // ========== BACKUP FUNCTIONS ==========
  
  const createBackup = () => {
    const backupData = {
      version: '6.0.0',
      timestamp: new Date().toISOString(),
      portfolio,
      transactions,
      settings: { theme, language, currency, taxJurisdiction },
      alerts
    };
    
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maermin-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    addToast(t.backupCreated || 'Backup created', 'success');
  };

  // ========== EXPORT FUNCTION ==========
  
  const exportData = () => {
    if (window.ImportExportEngine) {
      const csv = window.ImportExportEngine.exportToCSV(transactions);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maermin-export-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      addToast(t.exportSuccess || 'Export successful', 'success');
    }
  };

  // ========== ADD TRANSACTION ==========
  
  const saveTransaction = () => {
    if (!newTransaction.symbol || !newTransaction.quantity || !newTransaction.price) {
      addToast(t.fillRequired || 'Please fill required fields', 'error');
      return;
    }
    
    const transactionData = {
      type: newTransaction.type,
      category: newTransaction.category,
      symbol: newTransaction.symbol,
      quantity: parseFloat(newTransaction.quantity),
      price: parseFloat(newTransaction.price),
      fees: parseFloat(newTransaction.fees) || 0,
      date: newTransaction.date,
      notes: newTransaction.notes,
      currency: newTransaction.currency || currency // Use form currency or default to current
    };
    
    if (editingTransactionId) {
      // Edit existing transaction
      setTransactions(prev => prev.map(tx => 
        tx.id === editingTransactionId 
          ? { ...tx, ...transactionData }
          : tx
      ));
      addToast(t.transactionUpdated || 'Transaction updated', 'success');
    } else {
      // Add new transaction
      const transaction = {
        id: Date.now().toString(),
        ...transactionData
      };
      setTransactions(prev => [...prev, transaction]);
      addToast(t.transactionAdded || 'Transaction added', 'success');
    }
    
    // Reset form
    setNewTransaction({
      type: 'buy',
      category: newTransaction.category,
      symbol: '',
      quantity: '',
      price: '',
      date: new Date().toISOString().split('T')[0],
      fees: '',
      notes: '',
      currency: currency
    });
    setEditingTransactionId(null);
    setShowTransactionModal(false);
  };

  // Start editing a transaction
  const editTransaction = (tx) => {
    setNewTransaction({
      type: tx.type || 'buy',
      category: tx.category || 'crypto',
      symbol: tx.symbol || '',
      quantity: tx.quantity?.toString() || '',
      price: tx.price?.toString() || '',
      date: tx.date || new Date().toISOString().split('T')[0],
      fees: tx.fees?.toString() || '',
      notes: tx.notes || '',
      currency: tx.currency || 'EUR'
    });
    setEditingTransactionId(tx.id);
    setShowTransactionModal(true);
  };

  // Delete a transaction
  const deleteTransaction = (txId) => {
    setTransactions(prev => prev.filter(tx => tx.id !== txId));
    addToast(t.transactionDeleted || 'Transaction deleted', 'success');
  };

  // ========== IMPORT DATA ==========
  
  const handleImport = () => {
    if (!importData.trim()) {
      addToast(t.noDataToImport || 'No data to import', 'error');
      return;
    }
    
    try {
      // Try JSON first
      let imported;
      try {
        imported = JSON.parse(importData);
      } catch {
        // Try CSV
        if (window.ImportExportEngine) {
          imported = window.ImportExportEngine.parseCSV(importData);
        } else {
          throw new Error('Invalid format');
        }
      }
      
      if (Array.isArray(imported)) {
        // Array of transactions
        const newTransactions = imported.map((item, idx) => ({
          id: (Date.now() + idx).toString(),
          type: item.type || 'buy',
          category: item.category || 'crypto',
          symbol: item.symbol || item.asset || '',
          quantity: parseFloat(item.quantity || item.amount) || 0,
          price: parseFloat(item.price) || 0,
          fees: parseFloat(item.fees) || 0,
          date: item.date || new Date().toISOString().split('T')[0],
          notes: item.notes || '',
          currency: item.currency || currency
        }));
        
        setTransactions(prev => [...prev, ...newTransactions]);
        addToast(`${newTransactions.length} ${t.transactionsImported || 'transactions imported'}`, 'success');
      } else if (imported.transactions) {
        // Backup format with transactions array
        setTransactions(prev => [...prev, ...imported.transactions]);
        addToast(t.importSuccess || 'Import successful', 'success');
      } else if (imported.portfolio) {
        // OLD BACKUP FORMAT - Convert portfolio items to transactions
        const newTransactions = [];
        let count = 0;
        
        ['crypto', 'stocks', 'skins'].forEach(category => {
          const items = imported.portfolio[category] || [];
          items.forEach((item, idx) => {
            newTransactions.push({
              id: (Date.now() + count + idx).toString(),
              type: 'buy',
              category: category,
              symbol: item.symbol || item.name || '',
              quantity: parseFloat(item.amount) || 1,
              price: parseFloat(item.purchasePrice) || 0,
              fees: parseFloat(item.fees) || 0,
              date: item.purchaseDate || new Date().toISOString().split('T')[0],
              notes: item.notes || '',
              currency: currency,
              // Preserve CS2 skin metadata
              metadata: item.metadata || null,
              floatValue: item.floatValue || null,
              rarity: item.rarity || null,
              wear: item.wear || null
            });
            count++;
          });
        });
        
        if (newTransactions.length > 0) {
          setTransactions(prev => [...prev, ...newTransactions]);
          
          // Also restore priceHistory and images if present
          if (imported.priceHistory) {
            setPriceHistory(prev => ({ ...prev, ...imported.priceHistory }));
          }
          if (imported.images) {
            setImages(prev => ({ ...prev, ...imported.images }));
          }
          
          addToast(`${newTransactions.length} ${t.positionsImported || 'positions imported from backup'}`, 'success');
        } else {
          addToast(t.noDataToImport || 'No data to import', 'warning');
        }
      } else {
        addToast(t.unknownFormat || 'Unknown format', 'error');
      }
      
      setImportData('');
      setShowImportModal(false);
    } catch (e) {
      console.error('Import error:', e);
      addToast(t.importError || 'Import failed - invalid format', 'error');
    }
  };

  // ========== COMMAND EXECUTION ==========
  
  const executeCommand = (commandId) => {
    switch (commandId) {
      // Navigation
      case 'nav:overview': setActiveView('overview'); break;
      case 'nav:portfolio': setActiveView('portfolio'); break;
      case 'nav:analytics': setActiveView('analytics'); break;
      case 'nav:transactions': setActiveView('transactions'); break;
      case 'nav:taxes': setActiveView('taxes'); break;
      
      // Actions
      case 'action:add-position': setShowTransactionModal(true); break;
      case 'action:add-transaction': setShowTransactionModal(true); break;
      case 'action:refresh': fetchPrices(); break;
      case 'action:import': setShowImportModal(true); break;
      case 'action:export': exportData(); break;
      
      // Analytics
      case 'analytics:correlation': setActiveView('correlation'); break;
      case 'analytics:montecarlo': setActiveView('montecarlo'); break;
      case 'analytics:stress': setActiveView('stress'); break;
      case 'analytics:risk': setActiveView('risk'); break;
      
      // Workspaces
      case 'workspace:default': setActiveWorkspace('default'); setActiveView('overview'); break;
      case 'workspace:tax': setActiveWorkspace('tax-season'); setActiveView('taxes'); break;
      case 'workspace:analysis': setActiveWorkspace('deep-analysis'); setActiveView('analytics'); break;
      
      // Settings
      case 'settings:theme-light': setTheme('white'); break;
      case 'settings:theme-dark': setTheme('dark'); break;
      case 'settings:theme-purple': setTheme('purple'); break;
      case 'settings:lang-de': setLanguage('de'); break;
      case 'settings:lang-en': setLanguage('en'); break;
      case 'settings:api': setShowApiSettings(true); break;
      
      // Alerts & Backup
      case 'alerts:create': setShowAlertModal(true); break;
      case 'backup:create': createBackup(); break;
      case 'backup:restore': setShowBackupModal(true); break;
      
      // Help
      case 'help:shortcuts': setShowShortcuts(true); break;
      
      default:
        console.log('Unknown command:', commandId);
    }
  };

  // ========== RENDER VIEWS ==========
  
  const renderView = () => {
    switch (activeView) {
      case 'correlation':
        return window.CorrelationMatrixView ? 
          React.createElement(window.CorrelationMatrixView, {
            portfolio, priceHistory, t, theme: currentTheme, formatPrice
          }) : React.createElement('div', null, 'Loading...');
      
      case 'montecarlo':
        return window.MonteCarloView ?
          React.createElement(window.MonteCarloView, {
            portfolio, prices, t, theme: currentTheme, currency, formatPrice
          }) : React.createElement('div', null, 'Loading...');
      
      case 'stress':
        return window.StressTestView ?
          React.createElement(window.StressTestView, {
            portfolio, prices, t, theme: currentTheme, currency, formatPrice
          }) : React.createElement('div', null, 'Loading...');
      
      case 'risk':
        return typeof window.RiskAnalyticsViewV2 !== 'undefined' ?
          React.createElement(window.RiskAnalyticsViewV2, {
            portfolio, prices, t, theme: currentTheme, formatPrice
          }) : renderAnalyticsPlaceholder('Risk Analytics');
      
      case 'transactions':
        return renderTransactionsView();
      
      case 'taxes':
        return renderTaxView();
      
      case 'portfolio':
        return renderPortfolioView();
      
      case 'analytics':
        return renderAnalyticsMenu();
      
      default:
        return renderOverview();
    }
  };

  // ========== OVERVIEW VIEW ==========
  
  const renderOverview = () => {
    return React.createElement('div', { style: { padding: '1.5rem' } },
      // Stats cards
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem'
        }
      },
        // Total Value
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            padding: '1.5rem',
            borderRadius: '12px',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginBottom: '0.5rem' } },
            t.totalValue || 'Total Value'
          ),
          React.createElement('div', { style: { color: currentTheme.text, fontSize: '2rem', fontWeight: '700' } },
            `${formatPrice(portfolioStats.totalValue)} ${getCurrencySymbol()}`
          )
        ),
        
        // Invested
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            padding: '1.5rem',
            borderRadius: '12px',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginBottom: '0.5rem' } },
            t.invested || 'Invested'
          ),
          React.createElement('div', { style: { color: currentTheme.text, fontSize: '2rem', fontWeight: '700' } },
            `${formatPrice(portfolioStats.totalInvested)} ${getCurrencySymbol()}`
          )
        ),
        
        // Profit/Loss
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            padding: '1.5rem',
            borderRadius: '12px',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginBottom: '0.5rem' } },
            t.profitLoss || 'Profit/Loss'
          ),
          React.createElement('div', {
            style: {
              color: portfolioStats.totalProfit >= 0 ? currentTheme.success : currentTheme.danger,
              fontSize: '2rem',
              fontWeight: '700'
            }
          },
            `${portfolioStats.totalProfit >= 0 ? '+' : ''}${formatPrice(portfolioStats.totalProfit)} ${getCurrencySymbol()}`
          ),
          React.createElement('div', {
            style: {
              color: portfolioStats.totalProfit >= 0 ? currentTheme.success : currentTheme.danger,
              fontSize: '0.875rem'
            }
          },
            `${portfolioStats.totalProfitPercent >= 0 ? '+' : ''}${portfolioStats.totalProfitPercent.toFixed(2)}%`
          )
        ),
        
        // Positions
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            padding: '1.5rem',
            borderRadius: '12px',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginBottom: '0.5rem' } },
            t.positions || 'Positions'
          ),
          React.createElement('div', { style: { color: currentTheme.text, fontSize: '2rem', fontWeight: '700' } },
            portfolioStats.totalPositions
          )
        )
      ),
      
      // Quick actions
      React.createElement('div', {
        style: {
          display: 'flex',
          gap: '1rem',
          marginBottom: '2rem',
          flexWrap: 'wrap'
        }
      },
        React.createElement('button', {
          onClick: () => setShowTransactionModal(true),
          style: {
            padding: '0.75rem 1.5rem',
            background: currentTheme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600'
          }
        }, t.addTransaction || 'Add Transaction'),
        React.createElement('button', {
          onClick: () => setShowImportModal(true),
          style: {
            padding: '0.75rem 1.5rem',
            background: currentTheme.inputBg,
            color: currentTheme.text,
            border: `1px solid ${currentTheme.cardBorder}`,
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600'
          }
        }, t.importData || 'Import Data'),
        React.createElement('button', {
          onClick: fetchPrices,
          disabled: loading,
          style: {
            padding: '0.75rem 1.5rem',
            background: currentTheme.inputBg,
            color: currentTheme.text,
            border: `1px solid ${currentTheme.cardBorder}`,
            borderRadius: '8px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: '600'
          }
        }, loading ? (t.loading || 'Loading...') : (t.refresh || 'Refresh')),
        React.createElement('button', {
          onClick: () => setActiveView('analytics'),
          style: {
            padding: '0.75rem 1.5rem',
            background: currentTheme.inputBg,
            color: currentTheme.text,
            border: `1px solid ${currentTheme.cardBorder}`,
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600'
          }
        }, t.analytics || 'Analytics'),
        React.createElement('button', {
          onClick: () => setShowApiSettings(true),
          style: {
            padding: '0.75rem 1.5rem',
            background: currentTheme.inputBg,
            color: currentTheme.text,
            border: `1px solid ${currentTheme.cardBorder}`,
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600'
          }
        }, t.apiSettings || 'API Settings')
      ),
      
      // Recent positions
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          padding: '1.5rem',
          borderRadius: '12px',
          border: `1px solid ${currentTheme.cardBorder}`
        }
      },
        React.createElement('h3', {
          style: { color: currentTheme.text, marginBottom: '1rem', fontSize: '1.125rem' }
        }, t.positions || 'Positions'),
        
        ['crypto', 'stocks', 'skins'].flatMap(category =>
          (portfolio[category] || []).slice(0, 5).map(pos => {
            const symbolOriginal = pos.symbol || pos.name || '';
            const symbolLower = symbolOriginal.toLowerCase();
            const symbolUpper = symbolOriginal.toUpperCase();
            // Try multiple lookups: original case, lowercase, uppercase
            const currentPrice = prices[symbolOriginal] || prices[symbolLower] || prices[symbolUpper] || pos.purchasePrice || 0;
            const value = (pos.amount || 1) * currentPrice;
            const invested = (pos.amount || 1) * (pos.purchasePrice || 0);
            const profit = value - invested;
            const profitPercent = invested > 0 ? (profit / invested) * 100 : 0;
            
            return React.createElement('div', {
              key: pos.id,
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1rem 0',
                borderBottom: `1px solid ${currentTheme.cardBorder}`
              }
            },
              React.createElement('div', null,
                React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600' } },
                  pos.symbol || pos.name
                ),
                React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
                  `${pos.amount} @ ${formatPrice(pos.purchasePrice)}`
                )
              ),
              React.createElement('div', { style: { textAlign: 'right' } },
                React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600' } },
                  `${formatPrice(value)} ${getCurrencySymbol()}`
                ),
                React.createElement('div', {
                  style: {
                    color: profit >= 0 ? currentTheme.success : currentTheme.danger,
                    fontSize: '0.875rem'
                  }
                },
                  `${profit >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%`
                )
              )
            );
          })
        )
      )
    );
  };

  // ========== ANALYTICS MENU ==========
  
  const renderAnalyticsMenu = () => {
    const analyticsOptions = [
      { id: 'correlation', label: t.correlationMatrix || 'Correlation Matrix', desc: t.assetCorrelations || 'Asset correlations' },
      { id: 'montecarlo', label: t.monteCarloSimulation || 'Monte Carlo', desc: t.simulationResults || 'Portfolio projections' },
      { id: 'stress', label: t.stressTesting || 'Stress Testing', desc: t.historicalScenarios || 'Historical scenarios' },
      { id: 'risk', label: t.riskLevel || 'Risk Analytics', desc: t.vulnerabilityAnalysis || 'Risk analysis' }
    ];
    
    return React.createElement('div', { style: { padding: '1.5rem' } },
      React.createElement('h2', {
        style: { color: currentTheme.text, marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }
      }, t.analytics || 'Analytics'),
      
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem'
        }
      },
        analyticsOptions.map(opt =>
          React.createElement('div', {
            key: opt.id,
            onClick: () => setActiveView(opt.id),
            style: {
              background: currentTheme.card,
              padding: '1.5rem',
              borderRadius: '12px',
              border: `1px solid ${currentTheme.cardBorder}`,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }
          },
            React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '0.5rem' } }, opt.label),
            React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } }, opt.desc)
          )
        )
      )
    );
  };

  // ========== PORTFOLIO VIEW ==========
  
  const renderPortfolioView = () => {
    return React.createElement('div', { style: { padding: '1.5rem' } },
      // Tabs
      React.createElement('div', {
        style: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }
      },
        ['crypto', 'stocks', 'skins'].map(tab =>
          React.createElement('button', {
            key: tab,
            onClick: () => setActiveTab(tab),
            style: {
              padding: '0.75rem 1.5rem',
              background: activeTab === tab ? currentTheme.accent : currentTheme.inputBg,
              color: activeTab === tab ? '#fff' : currentTheme.text,
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600'
            }
          }, getCategoryDisplayName(tab))
        )
      ),
      
      // Positions list
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          borderRadius: '12px',
          border: `1px solid ${currentTheme.cardBorder}`,
          overflow: 'hidden'
        }
      },
        (portfolio[activeTab] || []).length === 0
          ? React.createElement('div', {
              style: { padding: '2rem', textAlign: 'center', color: currentTheme.textSecondary }
            }, t.noPositionsCategory || 'No positions')
          : (portfolio[activeTab] || []).map(pos => {
              const symbolOriginal = pos.symbol || pos.name || '';
              const symbolLower = symbolOriginal.toLowerCase();
              const symbolUpper = symbolOriginal.toUpperCase();
              const currentPrice = prices[symbolOriginal] || prices[symbolLower] || prices[symbolUpper] || pos.purchasePrice || 0;
              const value = (pos.amount || 1) * currentPrice;
              const invested = (pos.amount || 1) * (pos.purchasePrice || 0);
              const profit = value - invested;
              const profitPercent = invested > 0 ? (profit / invested) * 100 : 0;
              
              return React.createElement('div', {
                key: pos.id,
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '1rem 1.5rem',
                  borderBottom: `1px solid ${currentTheme.cardBorder}`
                }
              },
                React.createElement('div', null,
                  React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '1.125rem' } },
                    pos.symbol || pos.name
                  ),
                  React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
                    `${pos.amount} x ${formatPrice(pos.purchasePrice)} ${getCurrencySymbol()}`
                  )
                ),
                React.createElement('div', { style: { textAlign: 'right' } },
                  React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '1.125rem' } },
                    `${formatPrice(value)} ${getCurrencySymbol()}`
                  ),
                  React.createElement('div', {
                    style: {
                      color: profit >= 0 ? currentTheme.success : currentTheme.danger,
                      fontSize: '0.875rem'
                    }
                  },
                    `${profit >= 0 ? '+' : ''}${formatPrice(profit)} (${profitPercent.toFixed(2)}%)`
                  )
                )
              );
            })
      )
    );
  };

  // ========== TRANSACTIONS VIEW ==========
  
  const renderTransactionsView = () => {
    return React.createElement('div', { style: { padding: '1.5rem' } },
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '600' }
        }, t.transactions || 'Transactions'),
        React.createElement('button', {
          onClick: () => setShowTransactionModal(true),
          style: {
            padding: '0.75rem 1.5rem',
            background: currentTheme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600'
          }
        }, t.addTransaction || 'Add Transaction')
      ),
      
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          borderRadius: '12px',
          border: `1px solid ${currentTheme.cardBorder}`,
          overflow: 'auto'
        }
      },
        transactions.length === 0
          ? React.createElement('div', {
              style: { padding: '2rem', textAlign: 'center', color: currentTheme.textSecondary }
            }, t.noTransactions || 'No transactions')
          : React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '800px' } },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', { style: { textAlign: 'left', padding: '1rem', color: currentTheme.textSecondary, borderBottom: `1px solid ${currentTheme.cardBorder}` } }, t.date || 'Date'),
                  React.createElement('th', { style: { textAlign: 'left', padding: '1rem', color: currentTheme.textSecondary, borderBottom: `1px solid ${currentTheme.cardBorder}` } }, t.transactionType || 'Type'),
                  React.createElement('th', { style: { textAlign: 'left', padding: '1rem', color: currentTheme.textSecondary, borderBottom: `1px solid ${currentTheme.cardBorder}` } }, t.symbol || 'Symbol'),
                  React.createElement('th', { style: { textAlign: 'right', padding: '1rem', color: currentTheme.textSecondary, borderBottom: `1px solid ${currentTheme.cardBorder}` } }, t.quantity || 'Qty'),
                  React.createElement('th', { style: { textAlign: 'right', padding: '1rem', color: currentTheme.textSecondary, borderBottom: `1px solid ${currentTheme.cardBorder}` } }, t.price || 'Price'),
                  React.createElement('th', { style: { textAlign: 'center', padding: '1rem', color: currentTheme.textSecondary, borderBottom: `1px solid ${currentTheme.cardBorder}` } }, t.currency || 'Cur'),
                  React.createElement('th', { style: { textAlign: 'right', padding: '1rem', color: currentTheme.textSecondary, borderBottom: `1px solid ${currentTheme.cardBorder}` } }, t.total || 'Total'),
                  React.createElement('th', { style: { textAlign: 'center', padding: '1rem', color: currentTheme.textSecondary, borderBottom: `1px solid ${currentTheme.cardBorder}` } }, t.actions || 'Actions')
                )
              ),
              React.createElement('tbody', null,
                transactions.slice().reverse().map(tx =>
                  React.createElement('tr', { key: tx.id },
                    React.createElement('td', { style: { padding: '1rem', color: currentTheme.text } }, tx.date),
                    React.createElement('td', { style: { padding: '1rem' } },
                      React.createElement('span', {
                        style: {
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          background: tx.type === 'buy' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                          color: tx.type === 'buy' ? currentTheme.success : currentTheme.danger
                        }
                      }, tx.type === 'buy' ? (t.buy || 'Buy') : (t.sell || 'Sell'))
                    ),
                    React.createElement('td', { style: { padding: '1rem', color: currentTheme.text, fontWeight: '600' } }, tx.symbol),
                    React.createElement('td', { style: { padding: '1rem', color: currentTheme.text, textAlign: 'right' } }, tx.quantity),
                    React.createElement('td', { style: { padding: '1rem', color: currentTheme.text, textAlign: 'right' } }, 
                      tx.price?.toFixed(2)
                    ),
                    React.createElement('td', { style: { padding: '1rem', color: currentTheme.textSecondary, textAlign: 'center', fontSize: '0.8rem' } }, 
                      tx.currency || 'EUR'
                    ),
                    React.createElement('td', { style: { padding: '1rem', color: currentTheme.text, textAlign: 'right', fontWeight: '600' } },
                      `${(tx.quantity * tx.price).toFixed(2)} ${tx.currency || 'EUR'}`
                    ),
                    React.createElement('td', { style: { padding: '0.5rem', textAlign: 'center' } },
                      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'center' } },
                        React.createElement('button', {
                          onClick: () => editTransaction(tx),
                          title: t.edit || 'Edit',
                          style: {
                            padding: '0.4rem 0.75rem',
                            background: currentTheme.accent,
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                          }
                        }, t.edit || 'Edit'),
                        React.createElement('button', {
                          onClick: () => {
                            if (window.confirm(t.confirmDelete || 'Delete this transaction?')) {
                              deleteTransaction(tx.id);
                            }
                          },
                          title: t.delete || 'Delete',
                          style: {
                            padding: '0.4rem 0.75rem',
                            background: currentTheme.danger,
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                          }
                        }, t.delete || 'Delete')
                      )
                    )
                  )
                )
              )
            )
      )
    );
  };

  // ========== TAX VIEW ==========
  
  const renderTaxView = () => {
    const currentYear = new Date().getFullYear();
    
    // Calculate tax data using tax engine if available
    let taxData = { realizedGains: 0, shortTerm: 0, longTerm: 0, taxLiability: 0 };
    
    if (typeof window.TaxCalculationEngine !== 'undefined') {
      const result = window.TaxCalculationEngine.calculateTaxes(transactions, taxJurisdiction, currentYear);
      taxData = result;
    }
    
    return React.createElement('div', { style: { padding: '1.5rem' } },
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '600' }
        }, t.taxReport || 'Tax Report'),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
          React.createElement('select', {
            value: taxJurisdiction,
            onChange: (e) => setTaxJurisdiction(e.target.value),
            style: {
              padding: '0.5rem 1rem',
              background: currentTheme.inputBg,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '8px',
              color: currentTheme.text
            }
          },
            React.createElement('option', { value: 'de' }, t.germany || 'Germany'),
            React.createElement('option', { value: 'us' }, t.usa || 'USA')
          ),
          typeof window.exportTaxPDF !== 'undefined' && React.createElement('button', {
            onClick: () => window.exportTaxPDF(transactions, taxJurisdiction, currentYear, language),
            style: {
              padding: '0.5rem 1rem',
              background: currentTheme.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }
          }, t.exportPdf || 'Export PDF')
        )
      ),
      
      // Tax stats
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem'
        }
      },
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            padding: '1.25rem',
            borderRadius: '12px',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
            t.realizedGains || 'Realized Gains'
          ),
          React.createElement('div', {
            style: {
              color: taxData.realizedGains >= 0 ? currentTheme.success : currentTheme.danger,
              fontSize: '1.5rem',
              fontWeight: '700'
            }
          }, `${formatPrice(taxData.realizedGains)} ${getCurrencySymbol()}`)
        ),
        
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            padding: '1.25rem',
            borderRadius: '12px',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
            t.shortTermGains || 'Short-term'
          ),
          React.createElement('div', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '700' } },
            `${formatPrice(taxData.shortTerm || 0)} ${getCurrencySymbol()}`
          )
        ),
        
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            padding: '1.25rem',
            borderRadius: '12px',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
            t.longTermGains || 'Long-term'
          ),
          React.createElement('div', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '700' } },
            `${formatPrice(taxData.longTerm || 0)} ${getCurrencySymbol()}`
          )
        ),
        
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            padding: '1.25rem',
            borderRadius: '12px',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
            t.taxLiability || 'Est. Tax'
          ),
          React.createElement('div', { style: { color: currentTheme.warning, fontSize: '1.5rem', fontWeight: '700' } },
            `${formatPrice(taxData.taxLiability || 0)} ${getCurrencySymbol()}`
          )
        )
      )
    );
  };

  // ========== PLACEHOLDER FOR ANALYTICS ==========
  
  const renderAnalyticsPlaceholder = (name) => {
    return React.createElement('div', {
      style: {
        padding: '2rem',
        textAlign: 'center',
        color: currentTheme.textSecondary
      }
    }, `${name} - ${t.loading || 'Loading...'}`);
  };

  // ========== TRANSACTION MODAL ==========
  
  const renderTransactionModal = () => {
    if (!showTransactionModal) return null;
    
    const isEditing = !!editingTransactionId;
    
    const closeModal = () => {
      setShowTransactionModal(false);
      setEditingTransactionId(null);
      setNewTransaction({
        type: 'buy',
        category: 'crypto',
        symbol: '',
        quantity: '',
        price: '',
        date: new Date().toISOString().split('T')[0],
        fees: '',
        notes: '',
        currency: currency
      });
    };
    
    return React.createElement('div', {
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000
      },
      onClick: (e) => e.target === e.currentTarget && closeModal()
    },
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          padding: '2rem',
          borderRadius: '12px',
          width: '450px',
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflow: 'auto'
        }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, marginBottom: '1.5rem' }
        }, isEditing ? (t.editTransaction || 'Edit Transaction') : (t.addTransaction || 'Add Transaction')),
        
        // Type selector
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', {
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.type || 'Type'),
          React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
            ['buy', 'sell'].map(type =>
              React.createElement('button', {
                key: type,
                onClick: () => setNewTransaction(prev => ({ ...prev, type })),
                style: {
                  flex: 1,
                  padding: '0.5rem',
                  background: newTransaction.type === type ? 
                    (type === 'buy' ? currentTheme.success : currentTheme.danger) : 
                    currentTheme.inputBg,
                  color: newTransaction.type === type ? '#fff' : currentTheme.text,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: '600'
                }
              }, type === 'buy' ? (t.buy || 'Buy') : (t.sell || 'Sell'))
            )
          )
        ),
        
        // Category selector
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', {
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.category || 'Category'),
          React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
            ['crypto', 'stocks', 'skins'].map(cat =>
              React.createElement('button', {
                key: cat,
                onClick: () => setNewTransaction(prev => ({ ...prev, category: cat })),
                style: {
                  flex: 1,
                  padding: '0.5rem',
                  background: newTransaction.category === cat ? currentTheme.accent : currentTheme.inputBg,
                  color: newTransaction.category === cat ? '#fff' : currentTheme.text,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.875rem'
                }
              }, getCategoryDisplayName(cat))
            )
          )
        ),
        
        // Symbol
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', {
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.symbol || 'Symbol'),
          React.createElement('input', {
            type: 'text',
            value: newTransaction.symbol,
            onChange: (e) => setNewTransaction(prev => ({ ...prev, symbol: e.target.value })),
            placeholder: newTransaction.category === 'crypto' ? 'bitcoin, ethereum...' : 
                        newTransaction.category === 'stocks' ? 'AAPL, MSFT...' : 'AK-47 | Redline...',
            style: {
              width: '100%',
              padding: '0.75rem',
              background: currentTheme.inputBg,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '8px',
              color: currentTheme.text
            }
          })
        ),
        
        // Quantity
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', {
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.quantity || 'Quantity'),
          React.createElement('input', {
            type: 'number',
            value: newTransaction.quantity,
            onChange: (e) => setNewTransaction(prev => ({ ...prev, quantity: e.target.value })),
            step: '0.0001',
            placeholder: '0.00',
            style: {
              width: '100%',
              padding: '0.75rem',
              background: currentTheme.inputBg,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '8px',
              color: currentTheme.text
            }
          })
        ),
        
        // Price per unit
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', {
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.pricePerUnit || 'Price per Unit'),
          React.createElement('input', {
            type: 'number',
            value: newTransaction.price,
            onChange: (e) => setNewTransaction(prev => ({ ...prev, price: e.target.value })),
            step: '0.01',
            placeholder: '0.00',
            style: {
              width: '100%',
              padding: '0.75rem',
              background: currentTheme.inputBg,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '8px',
              color: currentTheme.text
            }
          })
        ),
        
        // Date
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', {
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.date || 'Date'),
          React.createElement('input', {
            type: 'date',
            value: newTransaction.date,
            onChange: (e) => setNewTransaction(prev => ({ ...prev, date: e.target.value })),
            style: {
              width: '100%',
              padding: '0.75rem',
              background: currentTheme.inputBg,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '8px',
              color: currentTheme.text
            }
          })
        ),
        
        // Fees
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', {
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.feesOptional || 'Fees (optional)'),
          React.createElement('input', {
            type: 'number',
            value: newTransaction.fees,
            onChange: (e) => setNewTransaction(prev => ({ ...prev, fees: e.target.value })),
            step: '0.01',
            placeholder: '0.00',
            style: {
              width: '100%',
              padding: '0.75rem',
              background: currentTheme.inputBg,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '8px',
              color: currentTheme.text
            }
          })
        ),
        
        // Notes
        React.createElement('div', { style: { marginBottom: '1.5rem' } },
          React.createElement('label', {
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.notesOptional || 'Notes (optional)'),
          React.createElement('input', {
            type: 'text',
            value: newTransaction.notes,
            onChange: (e) => setNewTransaction(prev => ({ ...prev, notes: e.target.value })),
            placeholder: t.notesPlaceholder || 'Optional notes...',
            style: {
              width: '100%',
              padding: '0.75rem',
              background: currentTheme.inputBg,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '8px',
              color: currentTheme.text
            }
          })
        ),
        
        // Currency selector
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', {
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.currency || 'Currency'),
          React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
            ['EUR', 'USD'].map(cur =>
              React.createElement('button', {
                key: cur,
                onClick: () => setNewTransaction(prev => ({ ...prev, currency: cur })),
                style: {
                  flex: 1,
                  padding: '0.5rem',
                  background: newTransaction.currency === cur ? currentTheme.accent : currentTheme.inputBg,
                  color: newTransaction.currency === cur ? '#fff' : currentTheme.text,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: '600'
                }
              }, cur)
            )
          )
        ),
        
        // Total display
        newTransaction.quantity && newTransaction.price && React.createElement('div', {
          style: {
            padding: '1rem',
            background: currentTheme.inputBg,
            borderRadius: '8px',
            marginBottom: '1.5rem',
            textAlign: 'center'
          }
        },
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
            t.total || 'Total'
          ),
          React.createElement('div', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '700' } },
            `${parseFloat(newTransaction.quantity) * parseFloat(newTransaction.price)} ${newTransaction.currency || 'EUR'}`
          )
        ),
        
        // Buttons
        React.createElement('div', { style: { display: 'flex', gap: '1rem' } },
          React.createElement('button', {
            onClick: closeModal,
            style: {
              flex: 1,
              padding: '0.75rem',
              background: currentTheme.inputBg,
              color: currentTheme.text,
              border: `1px solid ${currentTheme.cardBorder}`,
              borderRadius: '8px',
              cursor: 'pointer'
            }
          }, t.cancel || 'Cancel'),
          React.createElement('button', {
            onClick: saveTransaction,
            style: {
              flex: 1,
              padding: '0.75rem',
              background: newTransaction.type === 'buy' ? currentTheme.success : currentTheme.danger,
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600'
            }
          }, isEditing 
            ? (t.saveChanges || 'Save Changes')
            : (newTransaction.type === 'buy' ? (t.addBuy || 'Add Buy') : (t.addSell || 'Add Sell')))
        )
      )
    );
  };

  // ========== IMPORT MODAL ==========
  
  const renderImportModal = () => {
    if (!showImportModal) return null;
    
    return React.createElement('div', {
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000
      },
      onClick: (e) => e.target === e.currentTarget && setShowImportModal(false)
    },
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          padding: '2rem',
          borderRadius: '12px',
          width: '600px',
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflow: 'auto'
        }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, marginBottom: '1rem' }
        }, t.importData || 'Import Data'),
        
        React.createElement('p', {
          style: { color: currentTheme.textSecondary, marginBottom: '1.5rem', fontSize: '0.875rem' }
        }, t.importInstructions || 'Paste your transaction data in JSON or CSV format. Supported formats: JSON array, CSV with headers (type, category, symbol, quantity, price, date, fees)'),
        
        // Format examples
        React.createElement('div', {
          style: { marginBottom: '1rem' }
        },
          React.createElement('details', {
            style: { color: currentTheme.textSecondary, fontSize: '0.75rem' }
          },
            React.createElement('summary', {
              style: { cursor: 'pointer', marginBottom: '0.5rem' }
            }, t.showExamples || 'Show format examples'),
            React.createElement('pre', {
              style: {
                background: currentTheme.inputBg,
                padding: '0.75rem',
                borderRadius: '6px',
                overflow: 'auto',
                fontSize: '0.7rem'
              }
            }, `JSON:
[{"type":"buy","category":"crypto","symbol":"bitcoin","quantity":0.5,"price":45000,"date":"2024-01-15"}]

CSV:
type,category,symbol,quantity,price,date,fees
buy,crypto,bitcoin,0.5,45000,2024-01-15,10`)
          )
        ),
        
        // Textarea for data
        React.createElement('textarea', {
          value: importData,
          onChange: (e) => setImportData(e.target.value),
          placeholder: t.pasteDataHere || 'Paste your data here...',
          style: {
            width: '100%',
            height: '200px',
            padding: '1rem',
            background: currentTheme.inputBg,
            border: `1px solid ${currentTheme.inputBorder}`,
            borderRadius: '8px',
            color: currentTheme.text,
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            resize: 'vertical',
            marginBottom: '1.5rem'
          }
        }),
        
        // File upload hint
        React.createElement('div', {
          style: {
            padding: '1rem',
            border: `2px dashed ${currentTheme.cardBorder}`,
            borderRadius: '8px',
            textAlign: 'center',
            marginBottom: '1.5rem'
          }
        },
          React.createElement('input', {
            type: 'file',
            accept: '.json,.csv',
            onChange: (e) => {
              const file = e.target.files[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                  setImportData(event.target.result);
                };
                reader.readAsText(file);
              }
            },
            style: { display: 'none' },
            id: 'import-file-input'
          }),
          React.createElement('label', {
            htmlFor: 'import-file-input',
            style: { color: currentTheme.accent, cursor: 'pointer' }
          }, t.orUploadFile || 'Or click to upload a file (.json, .csv)')
        ),
        
        // Buttons
        React.createElement('div', { style: { display: 'flex', gap: '1rem' } },
          React.createElement('button', {
            onClick: () => {
              setImportData('');
              setShowImportModal(false);
            },
            style: {
              flex: 1,
              padding: '0.75rem',
              background: currentTheme.inputBg,
              color: currentTheme.text,
              border: `1px solid ${currentTheme.cardBorder}`,
              borderRadius: '8px',
              cursor: 'pointer'
            }
          }, t.cancel || 'Cancel'),
          React.createElement('button', {
            onClick: handleImport,
            disabled: !importData.trim(),
            style: {
              flex: 1,
              padding: '0.75rem',
              background: importData.trim() ? currentTheme.accent : currentTheme.inputBg,
              color: importData.trim() ? '#fff' : currentTheme.textSecondary,
              border: 'none',
              borderRadius: '8px',
              cursor: importData.trim() ? 'pointer' : 'not-allowed',
              fontWeight: '600'
            }
          }, t.import || 'Import')
        )
      )
    );
  };

  // ========== API SETTINGS MODAL ==========
  
  const renderApiSettingsModal = () => {
    if (!showApiSettings) return null;
    
    return React.createElement('div', {
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000
      },
      onClick: (e) => e.target === e.currentTarget && setShowApiSettings(false)
    },
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          padding: '2rem',
          borderRadius: '12px',
          width: '500px',
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflow: 'auto'
        }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, marginBottom: '1.5rem' }
        }, t.apiSettings || 'API Settings'),
        
        // Info text
        React.createElement('p', {
          style: { color: currentTheme.textSecondary, marginBottom: '1.5rem', fontSize: '0.875rem', lineHeight: '1.5' }
        }, t.apiSettingsInfo || 'Configure API keys for fetching live prices. CS2 Skin prices are fetched from Skinport (no key required). Crypto prices are fetched from CoinGecko (no key required).'),
        
        // Alpha Vantage Section
        React.createElement('div', {
          style: {
            background: currentTheme.inputBg,
            padding: '1.25rem',
            borderRadius: '8px',
            marginBottom: '1rem'
          }
        },
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }
          },
            React.createElement('h3', {
              style: { color: currentTheme.text, fontSize: '1rem', fontWeight: '600' }
            }, 'Alpha Vantage'),
            React.createElement('span', {
              style: { 
                fontSize: '0.75rem', 
                padding: '0.25rem 0.5rem',
                background: apiKeys.alphaVantage ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                color: apiKeys.alphaVantage ? currentTheme.success : currentTheme.danger,
                borderRadius: '4px'
              }
            }, apiKeys.alphaVantage ? (t.configured || 'Configured') : (t.notConfigured || 'Not configured'))
          ),
          React.createElement('p', {
            style: { color: currentTheme.textSecondary, fontSize: '0.8rem', marginBottom: '0.75rem' }
          }, t.alphaVantageInfo || 'Required for stock prices. Free tier: 25 requests/day.'),
          React.createElement('input', {
            type: 'password',
            value: apiKeys.alphaVantage || '',
            onChange: (e) => setApiKeys(prev => ({ ...prev, alphaVantage: e.target.value })),
            placeholder: 'Enter Alpha Vantage API Key',
            style: {
              width: '100%',
              padding: '0.75rem',
              background: currentTheme.background,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '6px',
              color: currentTheme.text,
              marginBottom: '0.5rem'
            }
          }),
          React.createElement('a', {
            href: 'https://www.alphavantage.co/support/#api-key',
            target: '_blank',
            rel: 'noopener noreferrer',
            style: { 
              color: currentTheme.accent, 
              fontSize: '0.8rem',
              textDecoration: 'none'
            }
          }, t.getApiKey || 'Get free API key from alphavantage.co')
        ),
        
        // Skinport Info Section
        React.createElement('div', {
          style: {
            background: currentTheme.inputBg,
            padding: '1.25rem',
            borderRadius: '8px',
            marginBottom: '1rem'
          }
        },
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }
          },
            React.createElement('h3', {
              style: { color: currentTheme.text, fontSize: '1rem', fontWeight: '600' }
            }, 'Skinport'),
            React.createElement('span', {
              style: { 
                fontSize: '0.75rem', 
                padding: '0.25rem 0.5rem',
                background: 'rgba(34,197,94,0.2)',
                color: currentTheme.success,
                borderRadius: '4px'
              }
            }, t.publicApi || 'Public API')
          ),
          React.createElement('p', {
            style: { color: currentTheme.textSecondary, fontSize: '0.8rem' }
          }, t.skinportInfo || 'CS2 skin prices are fetched from the public Skinport API. No API key required.'),
          React.createElement('a', {
            href: 'https://docs.skinport.com/',
            target: '_blank',
            rel: 'noopener noreferrer',
            style: { 
              color: currentTheme.accent, 
              fontSize: '0.8rem',
              textDecoration: 'none',
              display: 'block',
              marginTop: '0.5rem'
            }
          }, t.viewDocs || 'View API documentation')
        ),
        
        // CoinGecko Info Section
        React.createElement('div', {
          style: {
            background: currentTheme.inputBg,
            padding: '1.25rem',
            borderRadius: '8px',
            marginBottom: '1.5rem'
          }
        },
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }
          },
            React.createElement('h3', {
              style: { color: currentTheme.text, fontSize: '1rem', fontWeight: '600' }
            }, 'CoinGecko'),
            React.createElement('span', {
              style: { 
                fontSize: '0.75rem', 
                padding: '0.25rem 0.5rem',
                background: 'rgba(34,197,94,0.2)',
                color: currentTheme.success,
                borderRadius: '4px'
              }
            }, t.publicApi || 'Public API')
          ),
          React.createElement('p', {
            style: { color: currentTheme.textSecondary, fontSize: '0.8rem' }
          }, t.coingeckoInfo || 'Crypto prices are fetched from the public CoinGecko API. No API key required.')
        ),
        
        // Exchange Rate Section
        React.createElement('div', {
          style: {
            background: currentTheme.inputBg,
            padding: '1.25rem',
            borderRadius: '8px',
            marginBottom: '1.5rem'
          }
        },
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }
          },
            React.createElement('h3', {
              style: { color: currentTheme.text, fontSize: '1rem', fontWeight: '600' }
            }, t.exchangeRate || 'Exchange Rate'),
            React.createElement('span', {
              style: { 
                fontSize: '0.75rem', 
                padding: '0.25rem 0.5rem',
                background: 'rgba(34,197,94,0.2)',
                color: currentTheme.success,
                borderRadius: '4px'
              }
            }, 'ExchangeRate-API')
          ),
          React.createElement('p', {
            style: { color: currentTheme.textSecondary, fontSize: '0.8rem', marginBottom: '0.5rem' }
          }, t.exchangeRateInfo || 'Stock prices from Alpha Vantage are in USD and automatically converted to EUR using daily exchange rates.'),
          React.createElement('div', {
            style: { 
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem',
              background: currentTheme.background,
              borderRadius: '6px',
              marginTop: '0.5rem'
            }
          },
            React.createElement('span', { style: { color: currentTheme.text, fontWeight: '600' } }, '1 USD'),
            React.createElement('span', { style: { color: currentTheme.textSecondary } }, '='),
            React.createElement('span', { style: { color: currentTheme.accent, fontWeight: '600' } }, `${exchangeRate.toFixed(4)} EUR`)
          )
        ),
        
        // Close button
        React.createElement('button', {
          onClick: () => setShowApiSettings(false),
          style: {
            width: '100%',
            padding: '0.75rem',
            background: currentTheme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600'
          }
        }, t.close || 'Close')
      )
    );
  };

  // ========== MAIN RENDER ==========
  
  return React.createElement('div', {
    style: {
      minHeight: '100vh',
      background: currentTheme.background,
      color: currentTheme.text
    }
  },
    // Header
    React.createElement('header', {
      style: {
        padding: '1rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: `1px solid ${currentTheme.cardBorder}`
      }
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '1rem' } },
        React.createElement('h1', {
          style: {
            fontSize: '1.5rem',
            fontWeight: '800',
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }
        }, 'MAERMIN'),
        React.createElement('span', {
          style: {
            fontSize: '0.75rem',
            padding: '0.25rem 0.5rem',
            background: currentTheme.inputBg,
            borderRadius: '4px',
            color: currentTheme.textSecondary
          }
        }, 'v6.0')
      ),
      
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } },
        // Command palette hint
        React.createElement('button', {
          onClick: () => setShowCommandPalette(true),
          style: {
            padding: '0.5rem 1rem',
            background: currentTheme.inputBg,
            border: `1px solid ${currentTheme.cardBorder}`,
            borderRadius: '8px',
            color: currentTheme.textSecondary,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem'
          }
        },
          React.createElement('span', null, t.searchCommands || 'Search...'),
          React.createElement('kbd', {
            style: {
              padding: '0.125rem 0.375rem',
              background: currentTheme.card,
              borderRadius: '4px',
              fontSize: '0.75rem'
            }
          }, 'Ctrl+K')
        ),
        
        // Settings
        React.createElement('button', {
          onClick: () => setShowSettings(!showSettings),
          style: {
            padding: '0.5rem',
            background: currentTheme.inputBg,
            border: `1px solid ${currentTheme.cardBorder}`,
            borderRadius: '8px',
            color: currentTheme.text,
            cursor: 'pointer'
          }
        }, 'S')
      )
    ),
    
    // Settings dropdown
    showSettings && React.createElement('div', {
      style: {
        position: 'absolute',
        top: '60px',
        right: '1rem',
        background: currentTheme.card,
        padding: '1rem',
        borderRadius: '12px',
        border: `1px solid ${currentTheme.cardBorder}`,
        zIndex: 1000,
        minWidth: '200px'
      }
    },
      React.createElement('div', { style: { marginBottom: '1rem' } },
        React.createElement('label', { style: { color: currentTheme.textSecondary, fontSize: '0.75rem' } }, t.theme || 'Theme'),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
          ['white', 'dark', 'purple'].map(th =>
            React.createElement('button', {
              key: th,
              onClick: () => setTheme(th),
              style: {
                flex: 1,
                padding: '0.5rem',
                background: theme === th ? currentTheme.accent : currentTheme.inputBg,
                color: theme === th ? '#fff' : currentTheme.text,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.75rem'
              }
            }, th.charAt(0).toUpperCase() + th.slice(1))
          )
        )
      ),
      React.createElement('div', { style: { marginBottom: '1rem' } },
        React.createElement('label', { style: { color: currentTheme.textSecondary, fontSize: '0.75rem' } }, t.language || 'Language'),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
          ['de', 'en'].map(lang =>
            React.createElement('button', {
              key: lang,
              onClick: () => setLanguage(lang),
              style: {
                flex: 1,
                padding: '0.5rem',
                background: language === lang ? currentTheme.accent : currentTheme.inputBg,
                color: language === lang ? '#fff' : currentTheme.text,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.75rem'
              }
            }, lang.toUpperCase())
          )
        )
      ),
      React.createElement('div', null,
        React.createElement('label', { style: { color: currentTheme.textSecondary, fontSize: '0.75rem' } }, t.currency || 'Currency'),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
          ['EUR', 'USD'].map(curr =>
            React.createElement('button', {
              key: curr,
              onClick: () => setCurrency(curr),
              style: {
                flex: 1,
                padding: '0.5rem',
                background: currency === curr ? currentTheme.accent : currentTheme.inputBg,
                color: currency === curr ? '#fff' : currentTheme.text,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.75rem'
              }
            }, curr)
          )
        )
      )
    ),
    
    // Main layout
    React.createElement('div', { style: { display: 'flex', minHeight: 'calc(100vh - 61px)' } },
      // Sidebar
      React.createElement('nav', {
        style: {
          width: '220px',
          padding: '1rem',
          borderRight: `1px solid ${currentTheme.cardBorder}`,
          flexShrink: 0
        }
      },
        [
          { id: 'overview', label: t.overview || 'Overview' },
          { id: 'portfolio', label: t.portfolio || 'Portfolio' },
          { id: 'transactions', label: t.transactions || 'Transactions' },
          { id: 'analytics', label: t.analytics || 'Analytics' },
          { id: 'taxes', label: t.taxes || 'Taxes' }
        ].map(item =>
          React.createElement('button', {
            key: item.id,
            onClick: () => setActiveView(item.id),
            style: {
              display: 'block',
              width: '100%',
              padding: '0.75rem 1rem',
              marginBottom: '0.25rem',
              background: activeView === item.id || 
                (item.id === 'analytics' && ['correlation', 'montecarlo', 'stress', 'risk'].includes(activeView))
                ? currentTheme.accent : 'transparent',
              color: activeView === item.id || 
                (item.id === 'analytics' && ['correlation', 'montecarlo', 'stress', 'risk'].includes(activeView))
                ? '#fff' : currentTheme.text,
              border: 'none',
              borderRadius: '8px',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '0.9375rem'
            }
          }, item.label)
        ),
        
        // Separator
        React.createElement('div', {
          style: { height: '1px', background: currentTheme.cardBorder, margin: '1rem 0' }
        }),
        
        // Workspace indicator
        React.createElement('div', {
          style: { padding: '0.5rem', color: currentTheme.textSecondary, fontSize: '0.75rem' }
        }, `${t.workspaces || 'Workspace'}: ${workspaces[activeWorkspace]?.name || activeWorkspace}`)
      ),
      
      // Main content
      React.createElement('main', {
        style: { flex: 1, overflow: 'auto' }
      }, renderView())
    ),
    
    // Modals
    renderTransactionModal(),
    renderImportModal(),
    renderApiSettingsModal(),
    
    // Command Palette
    window.CommandPalette && React.createElement(window.CommandPalette, {
      isOpen: showCommandPalette,
      onClose: () => setShowCommandPalette(false),
      onExecute: executeCommand,
      commands: commands,
      t: t
    }),
    
    // Shortcuts Modal
    window.ShortcutsModal && React.createElement(window.ShortcutsModal, {
      isOpen: showShortcuts,
      onClose: () => setShowShortcuts(false),
      t: t,
      theme: currentTheme
    }),
    
    // Toast notifications
    React.createElement('div', { className: 'toast-container' },
      toasts.map(toast =>
        React.createElement('div', {
          key: toast.id,
          className: `toast ${toast.type}`,
          style: {
            padding: '1rem 1.5rem',
            background: currentTheme.card,
            borderRadius: '8px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
            color: currentTheme.text,
            borderLeft: `4px solid ${
              toast.type === 'success' ? currentTheme.success :
              toast.type === 'error' ? currentTheme.danger :
              toast.type === 'warning' ? currentTheme.warning :
              currentTheme.accent
            }`
          }
        }, toast.message)
      )
    )
  );
}

// ============================================================================
// RENDER APPLICATION
// ============================================================================

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(InvestmentTracker));

console.log('[MAERMIN v6.0] Application initialized');

})(); // End IIFE
