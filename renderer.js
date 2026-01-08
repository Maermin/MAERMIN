const { useState, useEffect, useMemo } = React;

// Translation object for multi-language support
const translations = typeof completeTranslations !== 'undefined' ? completeTranslations : {
  de: {
    title: 'MAERMIN', portfolio: 'Portfolio', statistics: 'Statistiken',
    crypto: 'Krypto', stocks: 'Aktien', cs2Items: 'CS2 Items', apiKeys: 'API-Keys',
    export: 'Exportieren', import: 'Importieren', refresh: 'Aktualisieren', loading: 'Lädt...',
    totalValue: 'Gesamtwert Portfolio', invested: 'Investiert', profitLoss: 'Gewinn/Verlust',
    position: 'Position', positions: 'Positionen', addNew: 'Neue Position hinzufügen',
    symbol: 'Symbol', amount: 'Anzahl', purchasePrice: 'Einkaufspreis', purchaseDate: 'Kaufdatum',
    fees: 'Gebühren', feesOptional: 'Gebühren (optional)',
    add: 'Hinzufügen', perUnit: '/ Stück', bought: 'Gekauft', current: 'Aktuell',
    ofPortfolio: 'des Portfolios', noPositions: 'Keine Positionen vorhanden. Füge deine erste Position hinzu!',
    noPositionsCategory: 'Keine Positionen in dieser Kategorie', distribution: 'Portfolio-Verteilung',
    visualDistribution: 'Visuelle Verteilung', total: 'Gesamt', details: 'Details',
    apiSettings: 'API-Schlüssel Einstellungen', alphaVantageKey: 'Alpha Vantage API-Key (für Aktien):',
    skinportKey: 'Skinport API-Key (für CS2 Skins):',
    getKeyFree: '-> Kostenlosen API-Key erhalten', save: 'Speichern', cancel: 'Abbrechen',
    fillRequired: 'Bitte fülle alle Pflichtfelder aus!', theme: 'Design', language: 'Sprache',
    whiteMode: 'Hell', darkMode: 'Dunkel', purpleMode: 'Lila', performanceChart: 'Portfolio-Performance',
    assetPerformance: 'Asset-Performance', currency: 'Währung', exchangeRate: 'Wechselkurs',
    edit: 'Bearbeiten', delete: 'Löschen', topPerformers: 'Top-Performer', worstPerformers: 'Schlechteste Performer',
    roi: 'ROI', diversification: 'Diversifikation', averageReturn: 'Durchschn. Rendite',
    totalAssets: 'Gesamt Assets', portfolioHealth: 'Portfolio-Gesundheit', riskLevel: 'Risikolevel',
    holdingPeriod: 'Haltedauer', days: 'Tage', insights: 'Einblicke', recommendations: 'Empfehlungen',
    highRisk: 'Hohes Risiko', mediumRisk: 'Mittleres Risiko', lowRisk: 'Geringes Risiko',
    excellent: 'Ausgezeichnet', good: 'Gut', fair: 'Durchschnittlich', poor: 'Schlecht',
    concentration: 'Konzentration', balanced: 'Ausgewogen', diversified: 'Diversifiziert',
    highlyConcentrated: 'Stark konzentriert',
    // NEW: Financial OS translations
    financialOverview: 'Finanzübersicht',
    netWorth: 'Nettovermögen',
    savingsRate: 'Sparquote',
    cashRunway: 'Cash Runway',
    months: 'Monate',
    financialHealth: 'Finanzielle Gesundheit',
    action: 'Aktion',
    noInsights: 'Keine Einblicke verfügbar',
    // MAERMIN translations
    myDashboard: 'Mein Dashboard',
    editDashboard: 'Dashboard anpassen',
    done: 'Fertig',
    dashboardEditInfo: 'Dashboard anpassen: Klicke auf ein Widget um es zu entfernen.',
    addWidgets: 'Widgets hinzufügen',
    overview: 'Übersicht',
    settings: 'Einstellungen',
    cashflow: 'Cashflow',
    budgets: 'Budgets',
    taxes: 'Steuern',
    addIncome: 'Einkommen hinzufügen',
    addExpense: 'Ausgabe hinzufügen',
    addFixedCost: 'Fixkosten hinzufügen',
    addTax: 'Steuer hinzufügen',
    addBudget: 'Budget hinzufügen',
    income: 'Einkommen',
    expenses: 'Ausgaben',
    fixedCosts: 'Fixkosten',
    monthlyCashflow: 'Monatlicher Cashflow',
    monthlyIncome: 'Monatl. Einkommen',
    monthlyExpenses: 'Monatl. Ausgaben',
    activeBudgets: 'Aktive Budgets',
    taxReserve: 'Steuerreserve',
    portfolioValue: 'Portfolio Wert',
    profit: 'Profit',
    sources: 'Quellen',
    budget: 'Budget',
    noTaxes: 'Keine Steuern',
    noBudgets: 'Keine Budgets',
    positive: 'Positiv',
    negative: 'Negativ',
    rate: 'Rate'
  },
  en: {
    title: 'MAERMIN', portfolio: 'Portfolio', statistics: 'Statistics',
    crypto: 'Crypto', stocks: 'Stocks', cs2Items: 'CS2 Items', apiKeys: 'API Keys',
    export: 'Export', import: 'Import', refresh: 'Refresh', loading: 'Loading...',
    totalValue: 'Total Portfolio Value', invested: 'Invested', profitLoss: 'Profit/Loss',
    position: 'Position', positions: 'Positions', addNew: 'Add New Position',
    symbol: 'Symbol', amount: 'Amount', purchasePrice: 'Purchase Price', purchaseDate: 'Purchase Date',
    fees: 'Fees', feesOptional: 'Fees (optional)',
    add: 'Add', perUnit: '/ Unit', bought: 'Bought', current: 'Current',
    ofPortfolio: 'of Portfolio', noPositions: 'No positions yet. Add your first position!',
    noPositionsCategory: 'No positions in this category', distribution: 'Portfolio Distribution',
    visualDistribution: 'Visual Distribution', total: 'Total', details: 'Details',
    apiSettings: 'API Key Settings', alphaVantageKey: 'Alpha Vantage API Key (for Stocks):',
    skinportKey: 'Skinport API Key (for CS2 Skins):',
    getKeyFree: '-> Get Free API Key', save: 'Save', cancel: 'Cancel',
    fillRequired: 'Please fill in all required fields!', theme: 'Theme', language: 'Language',
    whiteMode: 'Light', darkMode: 'Dark', purpleMode: 'Purple', performanceChart: 'Portfolio Performance',
    assetPerformance: 'Asset Performance', currency: 'Currency', exchangeRate: 'Exchange Rate',
    edit: 'Edit', delete: 'Delete', topPerformers: 'Top Performers', worstPerformers: 'Worst Performers',
    roi: 'ROI', diversification: 'Diversification', averageReturn: 'Avg. Return',
    totalAssets: 'Total Assets', portfolioHealth: 'Portfolio Health', riskLevel: 'Risk Level',
    holdingPeriod: 'Holding Period', days: 'days', insights: 'Insights', recommendations: 'Recommendations',
    highRisk: 'High Risk', mediumRisk: 'Medium Risk', lowRisk: 'Low Risk',
    excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor',
    concentration: 'Concentration', balanced: 'Balanced', diversified: 'Diversified',
    highlyConcentrated: 'Highly Concentrated',
    // NEW: Financial OS translations
    financialOverview: 'Financial Overview',
    netWorth: 'Net Worth',
    savingsRate: 'Savings Rate',
    cashRunway: 'Cash Runway',
    months: 'months',
    financialHealth: 'Financial Health',
    action: 'Action',
    noInsights: 'No insights available',
    // MAERMIN translations
    myDashboard: 'My Dashboard',
    editDashboard: 'Customize Dashboard',
    done: 'Done',
    dashboardEditInfo: 'Customize Dashboard: Click on a widget to remove it. Use the buttons below to add widgets.',
    addWidgets: 'Add Widgets',
    overview: 'Overview',
    settings: 'Settings',
    cashflow: 'Cashflow',
    budgets: 'Budgets',
    taxes: 'Taxes',
    addIncome: 'Add Income',
    addExpense: 'Add Expense',
    addFixedCost: 'Add Fixed Cost',
    addTax: 'Add Tax',
    addBudget: 'Add Budget',
    income: 'Income',
    expenses: 'Expenses',
    fixedCosts: 'Fixed Costs',
    monthlyCashflow: 'Monthly Cashflow',
    monthlyIncome: 'Monthly Income',
    monthlyExpenses: 'Monthly Expenses',
    activeBudgets: 'Active Budgets',
    taxReserve: 'Tax Reserve',
    portfolioValue: 'Portfolio Value',
    profit: 'Profit',
    sources: 'Sources',
    budget: 'Budget',
    noTaxes: 'No Taxes',
    noBudgets: 'No Budgets',
    positive: 'Positive',
    negative: 'Negative',
    rate: 'Rate'
  }
};


// Prompt translations
const getPrompts = (lang) => ({
  // Income prompts
  incomeName: lang === 'de' ? 'Name des Einkommens (z.B. Gehalt, Freelance, Bonus):' : 'Income name (e.g. Salary, Freelance, Bonus):',
  incomeType: lang === 'de' 
    ? 'Typ:\n1 = Gehalt\n2 = Freelance\n3 = Mieteinnahmen\n4 = Dividenden\n5 = Bonus\n\nGib Nummer ein (1-5):'
    : 'Type:\n1 = Salary\n2 = Freelance\n3 = Rental\n4 = Dividends\n5 = Bonus\n\nEnter number (1-5):',
  incomeAmount: lang === 'de' ? 'Monatlicher Betrag:' : 'Monthly amount:',
  incomeFrequency: lang === 'de'
    ? 'Häufigkeit:\n1 = Monatlich\n2 = Quartalsweise\n3 = Jährlich\n\nGib Nummer ein (1-3):'
    : 'Frequency:\n1 = Monthly\n2 = Quarterly\n3 = Yearly\n\nEnter number (1-3):',
  
  // Expense prompts
  expenseCategory: lang === 'de'
    ? 'Kategorie auswählen:\n1 = Lebensmittel\n2 = Restaurant\n3 = Transport\n4 = Unterhaltung\n5 = Shopping\n6 = Gesundheit\n7 = Nebenkosten\n8 = Versicherung\n\nGib Nummer ein (1-8):'
    : 'Choose category:\n1 = Groceries\n2 = Dining\n3 = Transport\n4 = Entertainment\n5 = Shopping\n6 = Healthcare\n7 = Utilities\n8 = Insurance\n\nEnter number (1-8):',
  expenseAmount: lang === 'de' ? 'Monatlicher Durchschnitt:' : 'Monthly average:',
  expenseBudget: lang === 'de' ? 'Budget-Limit setzen? (optional, pro Monat, oder leer):' : 'Set budget limit? (optional, per month, or leave empty):',
  
  // Fixed costs prompts
  fixedName: lang === 'de' ? 'Name der Fixkosten (z.B. Miete, Netflix):' : 'Fixed cost name (e.g. Rent, Netflix):',
  fixedAmount: lang === 'de' ? 'Monatlicher Betrag:' : 'Monthly amount:',
  
  // Tax prompts
  taxName: lang === 'de' ? 'Steuer Name (z.B. Einkommensteuer):' : 'Tax name (e.g. Income Tax):',
  taxType: lang === 'de'
    ? 'Steuertyp:\n1 = Pauschale (flat)\n2 = Progressiv\n\nGib Nummer ein (1-2):'
    : 'Tax type:\n1 = Flat\n2 = Progressive\n\nEnter number (1-2):',
  taxRate: lang === 'de' ? 'Steuersatz in %:' : 'Tax rate in %:',
  taxDeductible: lang === 'de' ? 'Freibetrag (optional, oder leer):' : 'Deductible amount (optional, or leave empty):',
  
  // Budget prompts
  budgetName: lang === 'de' ? 'Budget Name:' : 'Budget name:',
  budgetAmount: lang === 'de' ? 'Budget-Limit (pro Monat):' : 'Budget limit (per month):',
  budgetCategory: lang === 'de'
    ? 'Kategorie:\n1 = Lebensmittel\n2 = Restaurant\n3 = Transport\n4 = Unterhaltung\n5 = Shopping\n6 = Gesundheit\n7 = Nebenkosten\n8 = Sonstiges\n\nGib Nummer ein (1-8):'
    : 'Category:\n1 = Groceries\n2 = Dining\n3 = Transport\n4 = Entertainment\n5 = Shopping\n6 = Healthcare\n7 = Utilities\n8 = Other\n\nEnter number (1-8):',
  budgetThreshold: lang === 'de' ? 'Warnung bei % (z.B. 80):' : 'Alert at % (e.g. 80):',
  
  // Success messages
  incomeAdded: (name, amount, freq) => lang === 'de' 
    ? ` Einkommen "${name}" hinzugefügt! (${amount} ${freq})`
    : ` Income "${name}" added! (${amount} ${freq})`,
  expenseAdded: (cat, amount) => lang === 'de'
    ? ` Ausgabe "${cat}" hinzugefügt! (${amount}/Monat)`
    : ` Expense "${cat}" added! (${amount}/month)`,
  fixedAdded: (name, amount) => lang === 'de'
    ? ` Fixkosten "${name}" hinzugefügt! (${amount}/Monat)`
    : ` Fixed cost "${name}" added! (${amount}/month)`,
  taxAdded: (name, rate) => lang === 'de'
    ? ` Steuer "${name}" hinzugefügt! (${rate}%)`
    : ` Tax "${name}" added! (${rate}%)`,
  budgetAdded: (name, amount) => lang === 'de'
    ? ` Budget "${name}" hinzugefügt! (Limit: ${amount})`
    : ` Budget "${name}" added! (Limit: ${amount})`
});


// Theme configurations for different color schemes
const themes = {
  white: { 
    background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f8fafc 100%)', 
    card: 'rgba(255,255,255,0.9)', 
    cardBorder: 'rgba(0,0,0,0.1)', 
    text: '#1e293b', 
    textSecondary: '#64748b', 
    inputBg: 'rgba(0,0,0,0.05)', 
    inputBorder: 'rgba(0,0,0,0.1)' 
  },
  dark: { 
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)', 
    card: 'rgba(30,41,59,0.9)', 
    cardBorder: 'rgba(255,255,255,0.1)', 
    text: '#f8fafc', 
    textSecondary: '#94a3b8', 
    inputBg: 'rgba(255,255,255,0.05)', 
    inputBorder: 'rgba(255,255,255,0.1)' 
  },
  purple: { 
    background: 'linear-gradient(135deg, #1e293b 0%, #7e22ce 50%, #1e293b 100%)', 
    card: 'rgba(255,255,255,0.1)', 
    cardBorder: 'rgba(255,255,255,0.2)', 
    text: '#ffffff', 
    textSecondary: 'rgba(255,255,255,0.6)', 
    inputBg: 'rgba(255,255,255,0.1)', 
    inputBorder: 'rgba(255,255,255,0.2)' 
  }
};

function InvestmentTracker() {
  // State management for portfolio data
  const [portfolio, setPortfolio] = useState({ crypto: [], stocks: [], skins: [] });
  const [prices, setPrices] = useState({});
  const [images, setImages] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [loading, setLoading] = useState(false);
  
  // UI state management
  const [activeTab, setActiveTab] = useState('crypto');
  const [activeView, setActiveView] = useState('overview');
  const [dashboardWidgets, setDashboardWidgets] = useState(() => {
    const saved = localStorage.getItem('dashboardWidgets');
    const validWidgets = ['networth', 'health', 'portfolio'];
    const defaultWidgets = ['networth', 'health', 'portfolio'];
    
    if (saved) {
      const parsedWidgets = JSON.parse(saved);
      return parsedWidgets.filter(w => validWidgets.includes(w));
    }
    return defaultWidgets;
  });
  const [editingDashboard, setEditingDashboard] = useState(false);
  const [theme, setTheme] = useState('purple');
  const [language, setLanguage] = useState('de');
  const [currency, setCurrency] = useState('EUR');
  const [exchangeRate, setExchangeRate] = useState(1.1);
  
  // Form and settings state
  const [newItem, setNewItem] = useState({ 
    symbol: '', 
    amount: '', 
    purchasePrice: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    fees: '', // Fees field
    // CS2-specific fields
    floatValue: '',
    rarity: '',
    wear: ''
  });
  const [apiKeys, setApiKeys] = useState({ alphaVantage: '', steamApi: '', skinport: '' });
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Price update modal state
  const [priceUpdateModal, setPriceUpdateModal] = useState({ show: false, item: null, currentPrice: 0 });
  const [newPriceInput, setNewPriceInput] = useState('');

  const [editingItem, setEditingItem] = useState(null);

  // NEW v5.1: Transaction History State
  const [transactions, setTransactions] = useState(() => {
    const saved = localStorage.getItem('transactions');
    return saved ? JSON.parse(saved) : [];
  });

  // NEW v5.1: Transaction Form State
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [newTransaction, setNewTransaction] = useState({
    type: 'buy',
    category: 'crypto',
    symbol: '',
    quantity: '',
    price: '',
    fees: '',
    date: new Date().toISOString().split('T')[0], // Today's date in YYYY-MM-DD format
    currency: 'EUR' // NEW: Transaction currency
  });

  // Portfolio is ALWAYS calculated from transactions only
  const portfolioMode = 'transactions';

  // NEW v5.1: Tax jurisdiction (for PDF export)
  const [taxJurisdiction, setTaxJurisdiction] = useState(() => {
    const saved = localStorage.getItem('taxJurisdiction');
    return saved || 'de'; // 'de' for Germany, 'us' for US
  });

  // NEW v5.1: Rebalancing State
  const [targetAllocation, setTargetAllocation] = useState(() => {
    const saved = localStorage.getItem('targetAllocation');
    return saved ? JSON.parse(saved) : { crypto: 40, stocks: 50, cs2Items: 10 };
  });

  // ========== NEW: Financial OS State ==========
  const [financialData, setFinancialData] = useState(() => {
    // Try to load from localStorage
    const saved = localStorage.getItem('financialData');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        // Migrate to MAERMIN if needed
        if (typeof migrateFinancialData !== 'undefined') {
          return migrateFinancialData(data);
        }
        // Add MAERMIN fields if missing
        return {
          ...data,
          variableExpenses: data.variableExpenses || [],
          taxes: data.taxes || [],
          budgets: data.budgets || [],
          transactions: data.transactions || []
        };
      } catch (e) {
        console.error('Failed to load financial data:', e);
      }
    }
    // Create initial state (MAERMIN or fallback)
    return typeof createInitialMaerminData !== 'undefined' 
      ? createInitialMaerminData()
      : typeof createInitialFinancialData !== 'undefined'
      ? createInitialFinancialData()
      : { cashAccounts: [], debts: [], fixedCosts: [], income: [], goals: [], snapshots: [], variableExpenses: [], taxes: [], budgets: [], transactions: [] };
  });

  const t = translations[language];
  const currentTheme = themes[theme];

  // Helper function to format prices with proper locale
  const formatPrice = (price) => {
    if (price === undefined || price === null || isNaN(price)) return '0.00';
    const converted = currency === 'USD' ? price * exchangeRate : price;
    return converted.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getCurrencySymbol = () => currency === 'EUR' ? '€' : '$';
  const getPositionText = (count) => count === 1 ? t.position : t.positions;

  // Fetch current EUR to USD exchange rate
  const fetchExchangeRate = async () => {
    try {
      console.log(' Fetching live EUR/USD exchange rate...');
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/EUR');
      
      if (!res.ok) throw new Error('API request failed');
      
      const data = await res.json();
      
      if (data.rates && data.rates.USD) {
        const rate = data.rates.USD;
        console.log(' Live rate: 1 EUR = ' + rate.toFixed(4) + ' USD');
        setExchangeRate(rate);
        localStorage.setItem('exchangeRate', rate.toString());
        localStorage.setItem('exchangeRateLastUpdate', new Date().toISOString());
      }
    } catch (err) {
      console.warn(' Could not fetch live rate:', err);
      const savedRate = localStorage.getItem('exchangeRate');
      if (savedRate) {
        console.log(' Using saved rate: ' + parseFloat(savedRate).toFixed(4));
        setExchangeRate(parseFloat(savedRate));
      } else {
        console.log(' Using default rate: 1.10');
        setExchangeRate(1.1);
      }
    }
  };

  // Auto-update exchange rate when switching to USD
  useEffect(() => {
    if (currency === 'USD') {
      const lastUpdate = localStorage.getItem('exchangeRateLastUpdate');
      const oneHourAgo = Date.now() - 3600000; // 1 hour
      
      if (!lastUpdate || new Date(lastUpdate).getTime() < oneHourAgo) {
        console.log(' Exchange rate needs update (>1h old)...');
        fetchExchangeRate();
      } else {
        console.log(' Using cached rate (updated ' + Math.round((Date.now() - new Date(lastUpdate).getTime()) / 60000) + ' min ago)');
      }
    }
  }, [currency]);

  // Load saved data from localStorage on component mount
  useEffect(() => {
    const saved = (key) => localStorage.getItem(key);
    if (saved('theme')) setTheme(saved('theme'));
    if (saved('language')) setLanguage(saved('language'));
    if (saved('currency')) setCurrency(saved('currency'));
    if (saved('apiKeys')) setApiKeys(JSON.parse(saved('apiKeys')));
    if (saved('portfolio')) setPortfolio(JSON.parse(saved('portfolio')));
    if (saved('priceHistory')) setPriceHistory(JSON.parse(saved('priceHistory')));
    if (saved('images')) setImages(JSON.parse(saved('images')));
    fetchExchangeRate();
  }, []);

  // Persist state changes to localStorage
  useEffect(() => { localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('language', language); }, [language]);
  useEffect(() => { localStorage.setItem('currency', currency); }, [currency]);
  useEffect(() => { localStorage.setItem('portfolio', JSON.stringify(portfolio)); }, [portfolio]);

  // NEW v5.1: Persist transactions
  useEffect(() => { 
    localStorage.setItem('transactions', JSON.stringify(transactions)); 
  }, [transactions]);

  // NEW v5.1: Persist target allocation
  useEffect(() => { 
    localStorage.setItem('targetAllocation', JSON.stringify(targetAllocation)); 
  }, [targetAllocation]);

  // Portfolio mode is always 'transactions' now - no persistence needed

  // NEW v5.1: Persist tax jurisdiction
  useEffect(() => { 
    localStorage.setItem('taxJurisdiction', taxJurisdiction); 
  }, [taxJurisdiction]);
  useEffect(() => { localStorage.setItem('priceHistory', JSON.stringify(priceHistory)); }, [priceHistory]);
  useEffect(() => { localStorage.setItem('dashboardWidgets', JSON.stringify(dashboardWidgets)); }, [dashboardWidgets]);
  useEffect(() => { localStorage.setItem('images', JSON.stringify(images)); }, [images]);
  useEffect(() => { try { localStorage.setItem('financialData', JSON.stringify(financialData)); } catch(e) {} }, [financialData]);

  // Save API keys to localStorage
  const saveApiKeys = () => {
    localStorage.setItem('apiKeys', JSON.stringify(apiKeys));
    setShowApiSettings(false);
    alert(language === 'de' ? 'API-Keys gespeichert!' : 'API Keys saved!');
  };

  // Fetch current prices from various APIs
  const fetchPrices = async () => {
    setLoading(true);
    const newPrices = {}, newHistory = {...priceHistory}, newImages = {...images};
    
    try {
      // Fetch cryptocurrency prices from CoinGecko
      if (portfolio.crypto && portfolio.crypto.length > 0) {
        const ids = portfolio.crypto.map(c => c.symbol.toLowerCase()).join(',');
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur`);
        const data = await res.json();
        
        // Fetch coin images
        for (const coin of portfolio.crypto) {
          const id = coin.symbol.toLowerCase();
          if (!newImages[id]) {
            try {
              const info = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=false`);
              const coinInfo = await info.json();
              if (coinInfo.image?.small) newImages[id] = coinInfo.image.small;
            } catch (e) {}
          }
        }
        
        // Store prices and history
        Object.keys(data).forEach(id => {
          newPrices[id] = data[id].eur;
          if (!newHistory[id]) newHistory[id] = [];
          const now = new Date();
          const day = String(now.getDate()).padStart(2, '0');
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const hour = String(now.getHours()).padStart(2, '0');
          const minute = String(now.getMinutes()).padStart(2, '0');
          const timestamp = language === 'de' ? `${day}/${month} ${hour}:${minute}` : `${month}/${day} ${hour}:${minute}`;
          
          newHistory[id].push({ 
            timestamp: timestamp, 
            price: data[id].eur 
          });
          if (newHistory[id].length > 20) newHistory[id] = newHistory[id].slice(-20);
        });
      }
      
      // Fetch stock prices from Alpha Vantage
      if (portfolio.stocks && portfolio.stocks.length > 0) {
        if (apiKeys.alphaVantage) {
          for (const stock of portfolio.stocks) {
            try {
              const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${stock.symbol}&apikey=${apiKeys.alphaVantage}`);
              const data = await res.json();
              if (data['Global Quote']?.['05. price']) {
                const usd = parseFloat(data['Global Quote']['05. price']);
                const eur = usd / exchangeRate;
                newPrices[stock.symbol] = eur;
                if (!newHistory[stock.symbol]) newHistory[stock.symbol] = [];
                
                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const hour = String(now.getHours()).padStart(2, '0');
                const minute = String(now.getMinutes()).padStart(2, '0');
                const timestamp = language === 'de' ? `${day}/${month} ${hour}:${minute}` : `${month}/${day} ${hour}:${minute}`;
                
                newHistory[stock.symbol].push({ 
                  timestamp: timestamp, 
                  price: eur 
                });
                if (newHistory[stock.symbol].length > 20) newHistory[stock.symbol] = newHistory[stock.symbol].slice(-20);
              }
              if (!newImages[stock.symbol]) newImages[stock.symbol] = `https://logo.clearbit.com/${stock.symbol.toLowerCase()}.com`;
              await new Promise(r => setTimeout(r, 12000)); // Rate limiting
            } catch (e) {}
          }
        } else {
          // Use mock data if no API key is provided
          portfolio.stocks.forEach(s => {
            const last = prices[s.symbol] || Math.random() * 200 + 50;
            newPrices[s.symbol] = Math.max(10, last + (Math.random() - 0.5) * 10);
            if (!newHistory[s.symbol]) newHistory[s.symbol] = [];
            
            const now = new Date();
            const day = String(now.getDate()).padStart(2, '0');
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const hour = String(now.getHours()).padStart(2, '0');
            const minute = String(now.getMinutes()).padStart(2, '0');
            const timestamp = language === 'de' ? `${day}/${month} ${hour}:${minute}` : `${month}/${day} ${hour}:${minute}`;
            
            newHistory[s.symbol].push({ 
              timestamp: timestamp, 
              price: newPrices[s.symbol] 
            });
            if (newHistory[s.symbol].length > 20) newHistory[s.symbol] = newHistory[s.symbol].slice(-20);
            if (!newImages[s.symbol]) newImages[s.symbol] = `https://logo.clearbit.com/${s.symbol.toLowerCase()}.com`;
          });
        }
      }
      
      // Fetch CS2 skin prices from Skinport API
      // Skinport requires API key for authentication
      if (portfolio.skins && portfolio.skins.length > 0 && apiKeys.skinport) {
        console.log('[CS2 PRICES] Fetching from Skinport API with authentication...');
        
        try {
          // Skinport API endpoint with authentication
          // Documentation: https://docs.skinport.com/
          const skinportUrl = `https://api.skinport.com/v1/items?app_id=730&currency=EUR&tradable=1`;
          
          const skinportRes = await fetch(skinportUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKeys.skinport}`,
              'Accept': 'application/json'
            }
          });
          
          if (skinportRes.ok) {
            const skinportData = await skinportRes.json();
            
            console.log(`[CS2] Received ${skinportData.length || 0} items from Skinport`);
            
            // Match user's skins with Skinport data
            for (const skin of portfolio.skins) {
              const itemData = skinportData.find(item => 
                item.market_hash_name && 
                item.market_hash_name.toUpperCase() === skin.symbol.toUpperCase()
              );
              
              if (itemData && itemData.min_price) {
                const priceInEur = parseFloat(itemData.min_price);
                
                // Store with UPPERCASE key to match portfolio symbols
                newPrices[skin.symbol.toUpperCase()] = priceInEur;
                newPrices[skin.symbol] = priceInEur; // Also store with original case
                newPrices[skin.symbol.toLowerCase()] = priceInEur; // And lowercase for safety
                
                if (!newHistory[skin.symbol]) newHistory[skin.symbol] = [];
                
                const now = new Date();
                const day = String(now.getDate()).padStart(2, '0');
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const hour = String(now.getHours()).padStart(2, '0');
                const minute = String(now.getMinutes()).padStart(2, '0');
                const timestamp = language === 'de' ? `${day}/${month} ${hour}:${minute}` : `${month}/${day} ${hour}:${minute}`;
                
                newHistory[skin.symbol].push({ 
                  timestamp: timestamp, 
                  price: priceInEur 
                });
                if (newHistory[skin.symbol].length > 20) newHistory[skin.symbol] = newHistory[skin.symbol].slice(-20);
                
                console.log(`[CS2] ${skin.symbol}: €${priceInEur.toFixed(2)} (Skinport)`);
              } else {
                console.log(`[CS2] Item not found on Skinport: ${skin.symbol}`);
              }
            }
          } else if (skinportRes.status === 401) {
            console.error('[CS2] Skinport API: Invalid API key (401 Unauthorized)');
            console.log('[CS2] Please check your Skinport API key in Settings → API Keys');
          } else if (skinportRes.status === 429) {
            console.error('[CS2] Skinport API: Rate limit exceeded (429)');
            console.log('[CS2] Please wait before fetching prices again');
          } else {
            console.error(`[CS2] Skinport API returned error: ${skinportRes.status}`);
          }
        } catch (e) {
          console.error('[CS2] Error fetching from Skinport API:', e.message);
          console.log('[CS2] Make sure you have a valid Skinport API key in Settings → API Keys');
        }
        
        console.log('[CS2 PRICES] Skinport fetch complete');
      } else if (portfolio.skins && portfolio.skins.length > 0 && !apiKeys.skinport) {
        console.log('[CS2 PRICES] Skinport API key not set. Go to Settings → API Keys to add your key.');
        console.log('[CS2 PRICES] Get your free API key at: https://skinport.com/api');
      }
      
      setPrices(newPrices);
      setPriceHistory(newHistory);
      setImages(newImages);
    } catch (e) {}
    setLoading(false);
  };

  // Auto-fetch prices when portfolio changes
  useEffect(() => {
    if ((portfolio.crypto && portfolio.crypto.length > 0) || 
        (portfolio.stocks && portfolio.stocks.length > 0) || 
        (portfolio.skins && portfolio.skins.length > 0)) {
      fetchPrices();
    }
  }, [portfolio]);

  // Add new investment item
  const addItem = () => {
    if (!newItem.symbol || !newItem.amount || !newItem.purchasePrice) return alert(t.fillRequired);
    
    const baseItem = {
      id: Date.now(), 
      symbol: newItem.symbol,
      amount: parseFloat(newItem.amount), 
      purchasePrice: parseFloat(newItem.purchasePrice),
      purchaseDate: newItem.purchaseDate
    };
    
    // Add CS2-specific metadata if this is a CS2 item
    if (activeTab === 'skins') {
      baseItem.metadata = {
        float: newItem.floatValue ? parseFloat(newItem.floatValue) : undefined,
        rarity: newItem.rarity || undefined,
        wear: newItem.wear || undefined
      };
    }
    
    setPortfolio(p => ({ 
      ...p, 
      [activeTab]: [...(p[activeTab] || []), baseItem] 
    }));
    
    setNewItem({ 
      symbol: '', 
      amount: '', 
      purchasePrice: '',
      purchaseDate: new Date().toISOString().split('T')[0],
      floatValue: '',
      rarity: '',
      wear: ''
    });
  };

  // Remove investment item
  const removeItem = (id) => setPortfolio(p => ({ 
    ...p, 
    [activeTab]: (p[activeTab] || []).filter(i => i.id !== id) 
  }));

  // Start editing an item
  const startEdit = (item) => {
    setEditingItem({ 
      ...item, 
      purchaseDate: item.purchaseDate || new Date().toISOString().split('T')[0],
      floatValue: item.metadata?.float || '',
      rarity: item.metadata?.rarity || '',
      wear: item.metadata?.wear || ''
    });
  };

  // Save edited item
  const saveEdit = () => {
    if (!editingItem) return;
    
    const updatedItem = {
      ...editingItem,
      amount: parseFloat(editingItem.amount),
      purchasePrice: parseFloat(editingItem.purchasePrice)
    };
    
    // Handle CS2 metadata
    if (activeTab === 'skins') {
      updatedItem.metadata = {
        float: editingItem.floatValue ? parseFloat(editingItem.floatValue) : editingItem.metadata?.float,
        rarity: editingItem.rarity || editingItem.metadata?.rarity,
        wear: editingItem.wear || editingItem.metadata?.wear
      };
    }
    
    setPortfolio(p => ({
      ...p,
      [activeTab]: (p[activeTab] || []).map(i => i.id === editingItem.id ? updatedItem : i)
    }));
    setEditingItem(null);
  };

  const cancelEdit = () => setEditingItem(null);

  // Export portfolio data to JSON file
  // NEW v5.1: Transaction management
  const addTransaction = (transaction) => {
    setTransactions(prev => [...prev, transaction]);
  };

  const deleteTransaction = (id) => {
    if (confirm(language === 'de' ? 'Transaktion loeschen?' : 'Delete transaction?')) {
      setTransactions(prev => prev.filter(tx => tx.id !== id));
    }
  };

  // NEW v5.1: Calculate current portfolio holdings from transactions
  const calculateHoldingsFromTransactions = () => {
    const holdings = {};
    
    // Process each transaction
    transactions.forEach(tx => {
      const key = `${tx.asset.symbol}_${tx.asset.category}`;
      
      if (!holdings[key]) {
        holdings[key] = {
          symbol: tx.asset.symbol,
          category: tx.asset.category,
          totalQuantity: 0,
          totalCost: 0,
          totalFees: 0,
          transactions: []
        };
      }
      
      const holding = holdings[key];
      holding.transactions.push(tx);
      
      if (tx.type === 'buy') {
        holding.totalQuantity += tx.quantity;
        holding.totalCost += tx.totalCost;
        holding.totalFees += tx.fees || 0;
      } else if (tx.type === 'sell') {
        holding.totalQuantity -= tx.quantity;
        // For sells, subtract the cost (but keep tracking for avg price calculation)
      }
    });
    
    // Convert to portfolio format (only include assets with quantity > 0)
    const portfolioFromTransactions = {
      crypto: [],
      stocks: [],
      skins: []
    };
    
    Object.values(holdings).forEach(holding => {
      if (holding.totalQuantity > 0.0001) { // Only show if we still own it (accounting for floating point)
        // Calculate weighted average purchase price
        let totalBuyQuantity = 0;
        let totalBuyCost = 0;
        
        holding.transactions.forEach(tx => {
          if (tx.type === 'buy') {
            totalBuyQuantity += tx.quantity;
            totalBuyCost += tx.totalCost;
          }
        });
        
        const avgPurchasePrice = totalBuyQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;
        
        // Get the earliest purchase date
        const purchaseDate = holding.transactions
          .filter(tx => tx.type === 'buy')
          .map(tx => tx.transactionDate || tx.timestamp)
          .sort()[0];
        
        const position = {
          id: holding.symbol + '_' + Date.now(),
          symbol: holding.symbol,
          amount: holding.totalQuantity,
          purchasePrice: avgPurchasePrice,
          purchaseDate: purchaseDate,
          fees: holding.totalFees,
          currentPrice: 0 // Will be filled by price fetching
        };
        
        // Add to appropriate category
        if (holding.category === 'crypto') {
          portfolioFromTransactions.crypto.push(position);
        } else if (holding.category === 'stocks') {
          portfolioFromTransactions.stocks.push(position);
        } else if (holding.category === 'cs2') {
          portfolioFromTransactions.skins.push(position);
        }
      }
    });
    
    return portfolioFromTransactions;
  };

    const exportData = () => {
    const blob = new Blob([JSON.stringify({ 
      portfolio, 
      priceHistory, 
      images, 
      exportDate: new Date().toISOString() 
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portfolio-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  // Import portfolio data from JSON file
  const importData = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        setPortfolio(data.portfolio || { crypto: [], stocks: [], skins: [] });
        setPriceHistory(data.priceHistory || {});
        setImages(data.images || {});
        alert(language === 'de' ? 'Daten erfolgreich importiert!' : 'Data imported successfully!');
      } catch (e) { alert(language === 'de' ? 'Fehler beim Importieren!' : 'Import error!'); }
    };
    reader.readAsText(file);
  };

  // Tab configuration
  const tabs = [
    { id: 'crypto', label: t.crypto, placeholder: language === 'de' ? 'z.B. bitcoin, ethereum' : 'e.g. bitcoin, ethereum' },
    { id: 'stocks', label: t.stocks, placeholder: language === 'de' ? 'z.B. AAPL, MSFT' : 'e.g. AAPL, MSFT' },
    { id: 'skins', label: t.cs2Items, placeholder: language === 'de' ? 'z.B. AK-47 | Redline' : 'e.g. AK-47 | Redline' }
  ];

  // Safe portfolio access with fallback to empty arrays
  // Get portfolio data based on current mode
  const getActivePortfolio = () => {
    if (portfolioMode === 'transactions') {
      return calculateHoldingsFromTransactions();
    }
    return portfolio;
  };

  const activePortfolio = getActivePortfolio();

  const safe = { 
    crypto: activePortfolio.crypto || [], 
    stocks: activePortfolio.stocks || [], 
    skins: activePortfolio.skins || [] 
  };
  
  // Calculate total value for a category
  const calcTotal = (cat) => (safe[cat] || []).reduce((s, i) => 
    s + ((prices[i.symbol.toLowerCase()] || prices[i.symbol] || 0) * i.amount), 0
  );
  
  // Calculate total invested for a category
  const calcInvest = (cat) => (safe[cat] || []).reduce((s, i) => 
    s + ((i.purchasePrice || 0) * i.amount), 0
  );
  
  // Calculate total fees for a category
  const calcFees = (cat) => (safe[cat] || []).reduce((s, i) => 
    s + (parseFloat(i.fees) || 0), 0
  );
  
  // Calculate profit/loss for a category (including fees)
  const calcProfit = (cat) => calcTotal(cat) - calcInvest(cat) - calcFees(cat);
  
  // Portfolio-wide calculations
  const total = calcTotal('crypto') + calcTotal('stocks') + calcTotal('skins');
  const invest = calcInvest('crypto') + calcInvest('stocks') + calcInvest('skins');
  const totalFees = calcFees('crypto') + calcFees('stocks') + calcFees('skins');
  const profit = total - invest - totalFees; // Profit minus total fees
  
  // ========== NEW: Financial Metrics ==========
  const metrics = useMemo(() => {
    // Check if modules are loaded
    if (typeof calculateNetWorth === 'undefined') {
      return {
        totalCash: 0, totalDebt: 0, monthlyIncome: 0, monthlyExpenses: 0,
        netWorth: total, savingsRate: 0, cashRunway: 0,
        debtToIncomeRatio: 0, investmentRatio: 100,
        costBreakdown: { essential: 0, optional: 0, total: 0 }
      };
    }
    try {
      const totalCash = calculateTotalCash(financialData.cashAccounts || [], exchangeRate);
      const totalDebt = calculateTotalDebt(financialData.debts || []);
      return {
        totalCash,
        totalDebt,
        monthlyIncome: calculateMonthlyIncome(financialData.income || []),
        monthlyExpenses: calculateMonthlyFixedCosts(financialData.fixedCosts || []),
        monthlyDebtPayments: calculateMonthlyDebtPayments(financialData.debts || []),
        netWorth: calculateNetWorth({
          investmentValue: total,
          cashAccounts: financialData.cashAccounts || [],
          debts: financialData.debts || [],
          exchangeRate
        }),
        savingsRate: calculateSavingsRate({
          income: financialData.income || [],
          fixedCosts: financialData.fixedCosts || [],
          debts: financialData.debts || []
        }),
        cashRunway: calculateCashRunway({
          cashAccounts: financialData.cashAccounts || [],
          fixedCosts: financialData.fixedCosts || [],
          debts: financialData.debts || [],
          exchangeRate
        }),
        debtToIncomeRatio: calculateDebtToIncomeRatio({
          debts: financialData.debts || [],
          income: financialData.income || []
        }),
        investmentRatio: calculateInvestmentRatio({
          investmentValue: total,
          cashAccounts: financialData.cashAccounts || [],
          exchangeRate
        }),
        costBreakdown: calculateCostBreakdown(financialData.fixedCosts || [])
      };
    } catch (error) {
      console.error('Error calculating metrics:', error);
      return {
        totalCash: 0, totalDebt: 0, monthlyIncome: 0, monthlyExpenses: 0,
        netWorth: total, savingsRate: 0, cashRunway: 0,
        debtToIncomeRatio: 0, investmentRatio: 100,
        costBreakdown: { essential: 0, optional: 0, total: 0 }
      };
    }
  }, [financialData, total, exchangeRate]);

  metrics.essentialCosts = metrics.costBreakdown.essential;
  metrics.optionalCosts = metrics.costBreakdown.optional;

  // Generate insights
  const insights = useMemo(() => {
    if (typeof generateInsights === 'undefined') return [];
    try {
      return generateInsights(metrics, financialData);
    } catch (error) {
      console.error('Error generating insights:', error);
      return [];
    }
  }, [metrics, financialData]);

  // Calculate health score
  const healthScore = useMemo(() => {
    if (typeof calculateFinancialHealthScore === 'undefined') {
      return { score: 0, rating: t.fair, color: '#f59e0b' };
    }
    try {
      return calculateFinancialHealthScore(metrics);
    } catch (error) {
      console.error('Error calculating health score:', error);
      return { score: 0, rating: t.fair, color: '#f59e0b' };
    }
  }, [metrics]);
  

  
  // ========== MAERMIN: Extended Metrics ==========
  const maerminMetrics = useMemo(() => {
    // Check if MAERMIN functions are available
    if (typeof calculateNetIncome === 'undefined' || 
        typeof calculateDetailedCashflow === 'undefined' ||
        typeof calculateOverallBudgetStatus === 'undefined') {
      console.warn(' MAERMIN calculator functions not loaded');
      return { netIncome: null, cashflow: null, budgetStatus: null };
    }
    
    try {
      const netIncome = calculateNetIncome(
        financialData.income || [],
        financialData.taxes || []
      );
      
      const cashflow = calculateDetailedCashflow({
        income: financialData.income || [],
        fixedCosts: financialData.fixedCosts || [],
        variableExpenses: financialData.variableExpenses || [],
        debts: financialData.debts || [],
        taxes: financialData.taxes || []
      });
      
      const budgetStatus = calculateOverallBudgetStatus(
        financialData.budgets || []
      );
      
      return { netIncome, cashflow, budgetStatus };
    } catch (error) {
      console.error(' MAERMIN metrics calculation error:', error);
      return { netIncome: null, cashflow: null, budgetStatus: null };
    }
  }, [financialData, total, exchangeRate]);

    const profitPct = invest > 0 ? (profit / invest) * 100 : 0;
  
  // Calculate percentage of total for a category
  const getPct = (cat) => total === 0 ? 0 : ((calcTotal(cat) / total) * 100).toFixed(1);
  
  // Format date for display based on language
  const fmtDate = (d) => {
    const date = new Date(d);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    // German: DD/MM/YYYY, English: MM/DD/YYYY
    return language === 'de' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  };
  

  // Fetch live exchange rates
  
    // Calculate days since purchase
  const getDaysSincePurchase = (purchaseDate) => {
    const today = new Date();
    const purchase = new Date(purchaseDate);
    const diffTime = Math.abs(today - purchase);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // ============= ADVANCED STATISTICS CALCULATIONS =============
  
  // Get all assets across all categories with their performance metrics
  const getAllAssets = () => {
    const allAssets = [];
    ['crypto', 'stocks', 'skins'].forEach(cat => {
      safe[cat].forEach(item => {
        const curr = item.currentPrice || prices[item.symbol.toLowerCase()] || prices[item.symbol] || item.purchasePrice || 0;
        const val = curr * item.amount;
        const inv = (item.purchasePrice || 0) * item.amount;
        const fees = parseFloat(item.fees) || 0;
        const prof = val - inv - fees; // Profit minus fees
        const profPct = inv > 0 ? (prof / inv) * 100 : 0;
        const daysSince = getDaysSincePurchase(item.purchaseDate);
        
        allAssets.push({
          ...item,
          category: cat,
          currentPrice: curr,
          value: val,
          invested: inv,
          profit: prof,
          profitPct: profPct,
          holdingDays: daysSince,
          percentOfPortfolio: total > 0 ? (val / total) * 100 : 0
        });
      });
    });
    return allAssets;
  };

  // Get top performers sorted by profit percentage
  const getTopPerformers = (limit = 5) => {
    return getAllAssets()
      .filter(a => a.invested > 0)
      .sort((a, b) => b.profitPct - a.profitPct)
      .slice(0, limit);
  };

  // Get worst performers sorted by profit percentage
  const getWorstPerformers = (limit = 5) => {
    return getAllAssets()
      .filter(a => a.invested > 0)
      .sort((a, b) => a.profitPct - b.profitPct)
      .slice(0, limit);
  };

  // Calculate portfolio diversification score (0-100)
  const getDiversificationScore = () => {
    const assets = getAllAssets();
    if (assets.length === 0) return 0;
    
    // Calculate Herfindahl-Hirschman Index (HHI)
    const hhi = assets.reduce((sum, asset) => {
      const share = asset.percentOfPortfolio;
      return sum + (share * share);
    }, 0);
    
    // Convert HHI to diversification score (inverted and normalized to 0-100)
    // HHI ranges from 0 (perfect diversification) to 10000 (complete concentration)
    const diversificationScore = Math.max(0, 100 - (hhi / 100));
    return diversificationScore.toFixed(0);
  };

  // Calculate average return across all assets
  const getAverageReturn = () => {
    const assets = getAllAssets().filter(a => a.invested > 0);
    if (assets.length === 0) return 0;
    
    const totalReturn = assets.reduce((sum, a) => sum + a.profitPct, 0);
    return (totalReturn / assets.length).toFixed(2);
  };

  // Assess portfolio risk level based on volatility and concentration
  const getRiskLevel = () => {
    const divScore = parseFloat(getDiversificationScore());
    const avgReturn = parseFloat(getAverageReturn());
    
    // Simple risk assessment based on diversification and returns
    if (divScore < 30 || Math.abs(avgReturn) > 50) return t.highRisk;
    if (divScore < 60 || Math.abs(avgReturn) > 25) return t.mediumRisk;
    return t.lowRisk;
  };

  // Get portfolio health rating
  const getPortfolioHealth = () => {
    const divScore = parseFloat(getDiversificationScore());
    const avgReturn = parseFloat(getAverageReturn());
    const profitableAssets = getAllAssets().filter(a => a.profit > 0).length;
    const totalAssets = getAllAssets().length;
    const profitableRatio = totalAssets > 0 ? (profitableAssets / totalAssets) * 100 : 0;
    
    // Health score considers diversification, returns, and profitable asset ratio
    const healthScore = (divScore * 0.3) + ((avgReturn + 50) * 0.4) + (profitableRatio * 0.3);
    
    if (healthScore >= 75) return { rating: t.excellent, color: '#10b981' };
    if (healthScore >= 60) return { rating: t.good, color: '#3b82f6' };
    if (healthScore >= 40) return { rating: t.fair, color: '#f59e0b' };
    return { rating: t.poor, color: '#ef4444' };
  };

  // Get concentration rating
  const getConcentration = () => {
    const divScore = parseFloat(getDiversificationScore());
    
    if (divScore >= 70) return t.diversified;
    if (divScore >= 40) return t.balanced;
    return t.highlyConcentrated;
  };

  // Get largest position
  const getLargestPosition = () => {
    const assets = getAllAssets();
    if (assets.length === 0) return null;
    return assets.reduce((max, asset) => asset.value > max.value ? asset : max, assets[0]);
  };

  // Calculate total asset count
  const getTotalAssetCount = () => {
    return getAllAssets().length;
  };

  function TransactionHistoryView() {
  const [showModal, setShowModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null); // NEW: For editing
  
  const sortedTransactions = [...transactions].sort((a, b) => 
    new Date(b.timestamp) - new Date(a.timestamp)
  );
  
  const handleAddTransaction = () => {
    // Validate required fields
    if (!newTransaction.symbol || !newTransaction.quantity || !newTransaction.price || !newTransaction.date || !newTransaction.currency) {
      alert(language === 'de' ? 'Bitte fülle alle Pflichtfelder aus!' : 'Please fill in all required fields!');
      return;
    }

    const quantity = parseFloat(newTransaction.quantity);
    const price = parseFloat(newTransaction.price);
    const fees = parseFloat(newTransaction.fees) || 0;

    if (editingTransaction) {
      // UPDATE existing transaction
      const updatedTx = {
        ...editingTransaction,
        timestamp: new Date(newTransaction.date).toISOString(),
        transactionDate: newTransaction.date,
        type: newTransaction.type,
        asset: { 
          symbol: newTransaction.symbol.toUpperCase(), 
          category: newTransaction.category 
        },
        quantity: quantity,
        price: price,
        totalCost: quantity * price,
        fees: fees,
        currency: newTransaction.currency // Use transaction's currency
      };
      
      setTransactions(prevTransactions => 
        prevTransactions.map(tx => tx.id === editingTransaction.id ? updatedTx : tx)
      );
      
      setEditingTransaction(null);
    } else {
      // ADD new transaction
      const newTx = {
        id: 'tx_' + Date.now() + '_' + Math.random(),
        timestamp: new Date(newTransaction.date).toISOString(),
        transactionDate: newTransaction.date,
        type: newTransaction.type,
        asset: { 
          symbol: newTransaction.symbol.toUpperCase(), 
          category: newTransaction.category 
        },
        quantity: quantity,
        price: price,
        totalCost: quantity * price,
        fees: fees,
        currency: newTransaction.currency // Use transaction's currency
      };
      
      addTransaction(newTx);
    }
    
    // Reset form and hide it
    setNewTransaction({
      type: 'buy',
      category: 'crypto',
      symbol: '',
      quantity: '',
      price: '',
      fees: '',
      date: new Date().toISOString().split('T')[0],
      currency: 'EUR' // Reset to EUR
    });
    setShowTransactionForm(false);
  };
  
  const handleEditTransaction = (tx) => {
    // Pre-fill form with transaction data
    setNewTransaction({
      type: tx.type,
      category: tx.asset.category,
      symbol: tx.asset.symbol,
      quantity: tx.quantity.toString(),
      price: tx.price.toString(),
      fees: (tx.fees || 0).toString(),
      date: tx.transactionDate || new Date(tx.timestamp).toISOString().split('T')[0],
      currency: tx.currency || 'EUR' // Default to EUR if not set
    });
    setEditingTransaction(tx);
    setShowTransactionForm(true);
  };
  
  const handleCancelEdit = () => {
    setEditingTransaction(null);
    setNewTransaction({
      type: 'buy',
      category: 'crypto',
      symbol: '',
      quantity: '',
      price: '',
      fees: '',
      date: new Date().toISOString().split('T')[0],
      currency: 'EUR'
    });
    setShowTransactionForm(false);
  };
  
  return React.createElement('div', { style: { padding: '2rem' } },
    React.createElement('div', { 
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' } 
    },
      React.createElement('h2', { style: { color: currentTheme.text, fontSize: '2rem', fontWeight: '700' } }, 
        language === 'de' ? 'Transaktionsverlauf' : 'Transaction History'
      ),
      React.createElement('button', {
        onClick: () => {
          if (showTransactionForm) {
            // Form is open - close it (and cancel any editing)
            handleCancelEdit();
          } else {
            // Form is closed - open it
            setShowTransactionForm(true);
          }
        },
        style: {
          padding: '0.75rem 1.5rem',
          background: showTransactionForm ? '#ef4444' : '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '0.5rem',
          cursor: 'pointer',
          fontWeight: '600'
        }
      }, showTransactionForm 
        ? (language === 'de' ? 'Abbrechen' : 'Cancel')
        : (language === 'de' ? 'Transaktion hinzufuegen' : 'Add Transaction'))
    ),

    // Transaction Form
    showTransactionForm && React.createElement('div', { 
      style: { 
        background: currentTheme.inputBg, 
        borderRadius: '1rem', 
        padding: '1.5rem', 
        marginBottom: '1.5rem',
        border: `2px solid ${editingTransaction ? '#f59e0b' : currentTheme.cardBorder}`
      } 
    },
      React.createElement('h3', { 
        style: { 
          color: editingTransaction ? '#f59e0b' : currentTheme.text,
          fontWeight: '600', 
          marginBottom: '1rem' 
        } 
      }, editingTransaction 
        ? (language === 'de' ? 'Transaktion bearbeiten' : 'Edit Transaction')
        : (language === 'de' ? 'Neue Transaktion' : 'New Transaction')
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
          gap: '1rem', 
          alignItems: 'end' 
        } 
      },
        // Transaction Type
        React.createElement('div', {}, 
          React.createElement('label', { 
            style: { 
              color: currentTheme.text, 
              fontSize: '0.875rem', 
              display: 'block', 
              marginBottom: '0.25rem' 
            } 
          }, (language === 'de' ? 'Typ' : 'Type') + ' *'), 
          React.createElement('select', { 
            value: newTransaction.type, 
            onChange: (e) => setNewTransaction({...newTransaction, type: e.target.value}), 
            style: { 
              width: '100%', 
              padding: '0.5rem', 
              background: currentTheme.inputBg, 
              border: `1px solid ${currentTheme.inputBorder}`, 
              borderRadius: '0.5rem', 
              color: currentTheme.text 
            } 
          },
            React.createElement('option', { value: 'buy' }, language === 'de' ? 'Kauf' : 'Buy'),
            React.createElement('option', { value: 'sell' }, language === 'de' ? 'Verkauf' : 'Sell')
          )
        ),
        
        // Category
        React.createElement('div', {}, 
          React.createElement('label', { 
            style: { 
              color: currentTheme.text, 
              fontSize: '0.875rem', 
              display: 'block', 
              marginBottom: '0.25rem' 
            } 
          }, (language === 'de' ? 'Kategorie' : 'Category') + ' *'), 
          React.createElement('select', { 
            value: newTransaction.category, 
            onChange: (e) => setNewTransaction({...newTransaction, category: e.target.value}), 
            style: { 
              width: '100%', 
              padding: '0.5rem', 
              background: currentTheme.inputBg, 
              border: `1px solid ${currentTheme.inputBorder}`, 
              borderRadius: '0.5rem', 
              color: currentTheme.text 
            } 
          },
            React.createElement('option', { value: 'crypto' }, language === 'de' ? 'Krypto' : 'Crypto'),
            React.createElement('option', { value: 'stocks' }, language === 'de' ? 'Aktien' : 'Stocks'),
            React.createElement('option', { value: 'cs2' }, 'CS2 Items')
          )
        ),
        
        // Symbol
        React.createElement('div', {}, 
          React.createElement('label', { 
            style: { 
              color: currentTheme.text, 
              fontSize: '0.875rem', 
              display: 'block', 
              marginBottom: '0.25rem' 
            } 
          }, (language === 'de' ? 'Symbol/Name' : 'Symbol/Name') + ' *'), 
          React.createElement('input', { 
            type: 'text', 
            placeholder: 'BTC, AAPL, AWP...', 
            value: newTransaction.symbol, 
            onChange: (e) => setNewTransaction({...newTransaction, symbol: e.target.value}), 
            style: { 
              width: '100%', 
              padding: '0.5rem', 
              background: currentTheme.inputBg, 
              border: `1px solid ${currentTheme.inputBorder}`, 
              borderRadius: '0.5rem', 
              color: currentTheme.text 
            } 
          })
        ),
        
        // Quantity
        React.createElement('div', {}, 
          React.createElement('label', { 
            style: { 
              color: currentTheme.text, 
              fontSize: '0.875rem', 
              display: 'block', 
              marginBottom: '0.25rem' 
            } 
          }, (language === 'de' ? 'Menge' : 'Quantity') + ' *'), 
          React.createElement('input', { 
            type: 'number', 
            step: '0.001', 
            placeholder: '0.1',
            value: newTransaction.quantity, 
            onChange: (e) => setNewTransaction({...newTransaction, quantity: e.target.value}), 
            style: { 
              width: '100%', 
              padding: '0.5rem', 
              background: currentTheme.inputBg, 
              border: `1px solid ${currentTheme.inputBorder}`, 
              borderRadius: '0.5rem', 
              color: currentTheme.text 
            } 
          })
        ),
        
        // Price
        React.createElement('div', {}, 
          React.createElement('label', { 
            style: { 
              color: currentTheme.text, 
              fontSize: '0.875rem', 
              display: 'block', 
              marginBottom: '0.25rem' 
            } 
          }, (language === 'de' ? 'Preis' : 'Price') + ' *'), 
          React.createElement('input', { 
            type: 'number', 
            step: '0.01', 
            placeholder: '46800.00',
            value: newTransaction.price, 
            onChange: (e) => setNewTransaction({...newTransaction, price: e.target.value}), 
            style: { 
              width: '100%', 
              padding: '0.5rem', 
              background: currentTheme.inputBg, 
              border: `1px solid ${currentTheme.inputBorder}`, 
              borderRadius: '0.5rem', 
              color: currentTheme.text 
            } 
          })
        ),
        
        // Fees
        React.createElement('div', {}, 
          React.createElement('label', { 
            style: { 
              color: currentTheme.text, 
              fontSize: '0.875rem', 
              display: 'block', 
              marginBottom: '0.25rem' 
            } 
          }, (language === 'de' ? 'Gebühren (optional)' : 'Fees (optional)')), 
          React.createElement('input', { 
            type: 'number', 
            step: '0.01',
            min: '0',
            placeholder: '0.00',
            value: newTransaction.fees || '', 
            onChange: (e) => setNewTransaction({...newTransaction, fees: e.target.value}), 
            style: { 
              width: '100%', 
              padding: '0.5rem', 
              background: currentTheme.inputBg, 
              border: `1px solid ${currentTheme.inputBorder}`, 
              borderRadius: '0.5rem', 
              color: currentTheme.text 
            } 
          })
        ),
        
        // Date
        React.createElement('div', {}, 
          React.createElement('label', { 
            style: { 
              color: currentTheme.text, 
              fontSize: '0.875rem', 
              display: 'block', 
              marginBottom: '0.25rem' 
            } 
          }, (language === 'de' ? 'Datum' : 'Date') + ' *'), 
          React.createElement('input', { 
            type: 'date', 
            value: newTransaction.date, 
            onChange: (e) => setNewTransaction({...newTransaction, date: e.target.value}), 
            style: { 
              width: '100%', 
              padding: '0.5rem', 
              background: currentTheme.inputBg, 
              border: `1px solid ${currentTheme.inputBorder}`, 
              borderRadius: '0.5rem', 
              color: currentTheme.text 
            } 
          })
        ),
        
        // Currency Selector (NEW)
        React.createElement('div', {}, 
          React.createElement('label', { 
            style: { 
              color: currentTheme.text, 
              fontSize: '0.875rem', 
              display: 'block', 
              marginBottom: '0.25rem' 
            } 
          }, (language === 'de' ? 'Waehrung' : 'Currency') + ' *'), 
          React.createElement('select', { 
            value: newTransaction.currency, 
            onChange: (e) => setNewTransaction({...newTransaction, currency: e.target.value}), 
            style: { 
              width: '100%', 
              padding: '0.5rem', 
              background: currentTheme.inputBg, 
              border: `1px solid ${currentTheme.inputBorder}`, 
              borderRadius: '0.5rem', 
              color: currentTheme.text 
            } 
          },
            React.createElement('option', { value: 'EUR' }, 'EUR (€)'),
            React.createElement('option', { value: 'USD' }, 'USD ($)')
          )
        ),
        
        // Add/Save Button
        React.createElement('button', { 
          onClick: handleAddTransaction, 
          style: { 
            padding: '0.5rem 1.5rem', 
            background: editingTransaction ? '#f59e0b' : '#16a34a',
            color: 'white', 
            borderRadius: '0.5rem', 
            border: 'none', 
            cursor: 'pointer', 
            height: '40px',
            fontWeight: '600'
          } 
        }, editingTransaction 
          ? (language === 'de' ? 'Speichern' : 'Save')
          : (language === 'de' ? 'Hinzufügen' : 'Add')
        )
      )
    ),
    
    sortedTransactions.length === 0 ?
      React.createElement('div', {
        style: {
          textAlign: 'center',
          padding: '4rem 2rem',
          background: currentTheme.card,
          borderRadius: '1rem',
          border: `1px solid ${currentTheme.cardBorder}`
        }
      },
        React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '1.125rem' } },
          language === 'de' ? 'Keine Transaktionen vorhanden' : 'No transactions yet'
        ),
        React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginTop: '0.5rem' } },
          language === 'de' ? 'Fuege deine erste Transaktion hinzu!' : 'Add your first transaction!'
        )
      ) :
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          borderRadius: '1rem',
          border: `1px solid ${currentTheme.cardBorder}`,
          overflow: 'hidden'
        }
      },
        React.createElement('div', { style: { overflowX: 'auto' } },
          React.createElement('table', { 
            style: { 
              width: '100%', 
              borderCollapse: 'collapse',
              minWidth: '800px'
            } 
          },
            React.createElement('thead', {},
              React.createElement('tr', { 
                style: { 
                  background: 'rgba(59,130,246,0.1)', 
                  borderBottom: `2px solid ${currentTheme.cardBorder}` 
                } 
              },
                [
                  language === 'de' ? 'Datum' : 'Date',
                  language === 'de' ? 'Typ' : 'Type',
                  'Asset',
                  language === 'de' ? 'Menge' : 'Quantity',
                  language === 'de' ? 'Preis' : 'Price',
                  'Total',
                  language === 'de' ? 'Gewinn' : 'Gain',
                  language === 'de' ? 'Aktionen' : 'Actions'
                ].map((heading, i) => 
                  React.createElement('th', {
                    key: i,
                    style: {
                      padding: '1rem',
                      textAlign: 'left',
                      color: currentTheme.text,
                      fontWeight: '600',
                      fontSize: '0.875rem'
                    }
                  }, heading)
                )
              )
            ),
            React.createElement('tbody', {},
              sortedTransactions.map((tx) => 
                React.createElement('tr', {
                  key: tx.id,
                  style: {
                    borderBottom: `1px solid ${currentTheme.cardBorder}`
                  }
                },
                  React.createElement('td', { 
                    style: { padding: '1rem', color: currentTheme.text, fontSize: '0.875rem' } 
                  },
                    new Date(tx.timestamp).toLocaleDateString()
                  ),
                  React.createElement('td', { 
                    style: { padding: '1rem' } 
                  },
                    React.createElement('span', {
                      style: {
                        padding: '0.25rem 0.75rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        background: tx.type === 'buy' ? 'rgba(16,185,129,0.1)' : 
                                   tx.type === 'sell' ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)',
                        color: tx.type === 'buy' ? '#10b981' : 
                               tx.type === 'sell' ? '#ef4444' : '#3b82f6'
                      }
                    }, tx.type.toUpperCase())
                  ),
                  React.createElement('td', { 
                    style: { padding: '1rem', color: currentTheme.text, fontWeight: '600' } 
                  },
                    tx.asset.symbol
                  ),
                  React.createElement('td', { 
                    style: { padding: '1rem', color: currentTheme.text } 
                  },
                    tx.quantity
                  ),
                  React.createElement('td', { 
                    style: { padding: '1rem', color: currentTheme.text } 
                  },
                    (tx.currency === 'USD' ? '$' : '€') + formatPrice(tx.price)
                  ),
                  React.createElement('td', { 
                    style: { padding: '1rem', color: currentTheme.text, fontWeight: '600' } 
                  },
                    (tx.currency === 'USD' ? '$' : '€') + formatPrice(tx.totalCost)
                  ),
                  React.createElement('td', { 
                    style: { padding: '1rem' } 
                  },
                    tx.realizedGain ? 
                      React.createElement('span', {
                        style: {
                          color: tx.realizedGain.gain >= 0 ? '#10b981' : '#ef4444',
                          fontWeight: '600'
                        }
                      },
                        (tx.realizedGain.gain >= 0 ? '+' : '') + getCurrencySymbol() + formatPrice(tx.realizedGain.gain)
                      ) : 
                      React.createElement('span', { style: { color: currentTheme.textSecondary } }, '-')
                  ),
                  React.createElement('td', { 
                    style: { padding: '1rem', display: 'flex', gap: '0.5rem' } 
                  },
                    React.createElement('button', {
                      onClick: () => handleEditTransaction(tx),
                      style: {
                        padding: '0.25rem 0.75rem',
                        background: 'rgba(59,130,246,0.1)',
                        color: '#3b82f6',
                        border: 'none',
                        borderRadius: '0.25rem',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }
                    }, language === 'de' ? 'Bearbeiten' : 'Edit'),
                    React.createElement('button', {
                      onClick: () => {
                        if (confirm(language === 'de' 
                          ? 'Transaktion wirklich löschen?' 
                          : 'Delete this transaction?')) {
                          deleteTransaction(tx.id);
                        }
                      },
                      style: {
                        padding: '0.25rem 0.75rem',
                        background: 'rgba(239,68,68,0.1)',
                        color: '#ef4444',
                        border: 'none',
                        borderRadius: '0.25rem',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }
                    }, language === 'de' ? 'Loeschen' : 'Delete')
                  )
                )
              )
            )
          )
        )
      )
  );
}

// ============================================================================
// TAX REPORT VIEW
// ============================================================================


// ============================================================================
// EXPORT NOTE
// ============================================================================


  function TaxReportView() {
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    
    const taxReport = useMemo(() => {
      if (typeof generateTaxReportAdvanced === 'undefined') {
        console.error('Advanced tax calculation not loaded');
        return null;
      }
      return generateTaxReportAdvanced(transactions, selectedYear, taxJurisdiction);
    }, [transactions, selectedYear, taxJurisdiction]);
    
    const handlePDFExport = () => {
      if (!taxReport) {
        alert(language === 'de' ? 'Kein Steuerbericht verfügbar' : 'No tax report available');
        return;
      }
      
      if (typeof exportTaxReportPDF === 'undefined') {
        alert(language === 'de' ? 'PDF Export Modul nicht geladen' : 'PDF export module not loaded');
        return;
      }
      
      try {
        exportTaxReportPDF(taxReport, currency, selectedYear, taxJurisdiction);
      } catch (error) {
        console.error('PDF export error:', error);
        alert(language === 'de' ? 'Fehler beim PDF-Export: ' + error.message : 'Error exporting PDF: ' + error.message);
      }
    };
    
    if (!taxReport) {
      return React.createElement('div', { style: { padding: '2rem', color: currentTheme.text } },
        language === 'de' ? 'Steuerfunktionen werden geladen...' : 'Loading tax functions...'
      );
    }
    
    return React.createElement('div', { style: { padding: '2rem' } },
      React.createElement('div', { 
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' } 
      },
        React.createElement('div', {},
          React.createElement('h2', { style: { color: currentTheme.text, fontSize: '2rem', fontWeight: '700', marginBottom: '0.5rem' } },
            (language === 'de' ? 'Steuerbericht ' : 'Tax Report ') + selectedYear
          ),
          React.createElement('select', {
            value: selectedYear,
            onChange: (e) => setSelectedYear(parseInt(e.target.value)),
            style: {
              padding: '0.5rem 1rem',
              background: currentTheme.inputBg,
              color: currentTheme.text,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '0.5rem',
              cursor: 'pointer'
            }
          },
            [2026, 2025, 2024, 2023, 2022].map(year =>
              React.createElement('option', { key: year, value: year }, year)
            )
          )
        ),
        React.createElement('div', { style: { display: 'flex', gap: '1rem', alignItems: 'center' } },
          // Jurisdiction Selector
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
            React.createElement('label', { 
              style: { 
                fontSize: '0.75rem', 
                color: currentTheme.textSecondary,
                textTransform: 'uppercase',
                fontWeight: '600'
              } 
            }, language === 'de' ? 'Steuerland' : 'Tax Country'),
            React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
              React.createElement('button', {
                onClick: () => setTaxJurisdiction('de'),
                style: {
                  padding: '0.5rem 1rem',
                  background: taxJurisdiction === 'de' ? '#3b82f6' : 'transparent',
                  color: taxJurisdiction === 'de' ? 'white' : currentTheme.text,
                  border: `2px solid ${taxJurisdiction === 'de' ? '#3b82f6' : currentTheme.inputBorder}`,
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }
              }, language === 'de' ? 'Deutschland' : 'Germany'),
              React.createElement('button', {
                onClick: () => setTaxJurisdiction('us'),
                style: {
                  padding: '0.5rem 1rem',
                  background: taxJurisdiction === 'us' ? '#10b981' : 'transparent',
                  color: taxJurisdiction === 'us' ? 'white' : currentTheme.text,
                  border: `2px solid ${taxJurisdiction === 'us' ? '#10b981' : currentTheme.inputBorder}`,
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '0.875rem'
                }
              }, language === 'de' ? 'USA' : 'USA')
            )
          ),
          // Export PDF Button
          React.createElement('button', {
            onClick: handlePDFExport,
            style: {
              padding: '0.75rem 1.5rem',
              background: taxJurisdiction === 'de' ? '#3b82f6' : '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginTop: '1.5rem'
            }
          }, 
            language === 'de' ? 'PDF Exportieren' : 'Export PDF'
          )
        )
      ),
      
      // Tax Difference Highlight
      React.createElement('div', {
        style: {
          background: taxJurisdiction === 'de' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
          border: `2px solid ${taxJurisdiction === 'de' ? '#3b82f6' : '#10b981'}`,
          borderRadius: '1rem',
          padding: '1.5rem',
          marginBottom: '2rem'
        }
      },
        React.createElement('h3', {
          style: {
            color: taxJurisdiction === 'de' ? '#3b82f6' : '#10b981',
            fontWeight: '700',
            fontSize: '1.125rem',
            marginBottom: '0.75rem'
          }
        }, taxJurisdiction === 'de' 
          ? 'DEUTSCHE BESONDERHEIT' 
          : 'U.S. TAX TREATMENT'
        ),
        taxJurisdiction === 'de' ? 
          React.createElement('div', {},
            React.createElement('p', { style: { color: currentTheme.text, marginBottom: '0.5rem', fontSize: '0.95rem' } },
              'Krypto > 1 Jahr = STEUERFREI! (Paragraph 23 EStG)'
            ),
            React.createElement('p', { style: { color: currentTheme.text, marginBottom: '0.5rem', fontSize: '0.95rem' } },
              'Krypto <= 1 Jahr = 25% Abgeltungssteuer + 5,5% Soli'
            ),
            React.createElement('p', { style: { color: currentTheme.text, fontSize: '0.95rem' } },
              'Aktien = Immer 25% + Soli (keine Haltefrist-Befreiung)'
            )
          ) :
          React.createElement('div', {},
            React.createElement('p', { style: { color: currentTheme.text, marginBottom: '0.5rem', fontSize: '0.95rem' } },
              'ALL crypto/stock sales are TAXABLE (no exemptions)'
            ),
            React.createElement('p', { style: { color: currentTheme.text, marginBottom: '0.5rem', fontSize: '0.95rem' } },
              'Short-term (≤ 1 year) = Ordinary income rates (10-37%)'
            ),
            React.createElement('p', { style: { color: currentTheme.text, fontSize: '0.95rem' } },
              'Long-term (> 1 year) = Preferential rates (0%, 15%, 20%)'
            )
          )
      ),
      
      React.createElement('div', { 
        style: { 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
          gap: '1rem', 
          marginBottom: '2rem' 
        } 
      },
        (taxJurisdiction === 'de' ? [
          {
            title: language === 'de' ? 'Steuerpflichtige Gewinne' : 'Taxable Gains',
            value: getCurrencySymbol() + formatPrice(taxReport.totalCapitalIncome || 0),
            color: '#3b82f6'
          },
          {
            title: language === 'de' ? 'Steuerfreie Krypto-Gewinne' : 'Tax-Free Crypto Gains',
            value: getCurrencySymbol() + formatPrice(taxReport.cryptoTaxFreeGains || 0),
            color: '#10b981'
          },
          {
            title: language === 'de' ? 'Gesamte Steuerschuld' : 'Total Tax Owed',
            value: getCurrencySymbol() + formatPrice(taxReport.totalTax || 0),
            color: '#ef4444'
          },
          {
            title: language === 'de' ? 'Steuerersparnis (1-Jahr-Regel)' : 'Tax Savings (1-Year Rule)',
            value: getCurrencySymbol() + formatPrice(taxReport.cryptoTaxSavings || 0),
            color: '#10b981'
          }
        ] : [
          {
            title: language === 'de' ? 'Kurzfristige Gewinne' : 'Short-Term Gains',
            value: getCurrencySymbol() + formatPrice(taxReport.shortTermGains || 0),
            color: '#ef4444'
          },
          {
            title: language === 'de' ? 'Langfristige Gewinne' : 'Long-Term Gains',
            value: getCurrencySymbol() + formatPrice(taxReport.longTermGains || 0),
            color: '#10b981'
          },
          {
            title: language === 'de' ? 'Geschätzte Steuerschuld' : 'Estimated Tax Owed',
            value: getCurrencySymbol() + formatPrice(taxReport.totalTax || 0),
            color: '#ef4444'
          },
          {
            title: language === 'de' ? 'Effektiver Steuersatz' : 'Effective Tax Rate',
            value: (taxReport.effectiveTaxRate || 0).toFixed(2) + '%',
            color: '#f59e0b'
          }
        ]).map((card, i) =>
          React.createElement('div', {
            key: i,
            style: {
              background: currentTheme.card,
              borderRadius: '1rem',
              padding: '1.5rem',
              border: `1px solid ${currentTheme.cardBorder}`
            }
          },
            React.createElement('div', { style: { fontSize: '0.875rem', color: currentTheme.textSecondary, marginBottom: '0.5rem' } }, card.title),
            React.createElement('div', { style: { fontSize: '2rem', fontWeight: '700', color: card.color } }, card.value)
          )
        )
      ),
      
      // Transaction list or info message
      taxReport.transactions && taxReport.transactions.length > 0 ?
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            borderRadius: '1rem',
            padding: '2rem',
            border: `1px solid ${currentTheme.cardBorder}`,
            marginBottom: '2rem'
          }
        },
          React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '1rem', fontSize: '1.25rem' } },
            language === 'de' ? `${taxReport.transactions.length} Transaktionen in ${selectedYear}` : `${taxReport.transactions.length} Transactions in ${selectedYear}`
          ),
          React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
            language === 'de' 
              ? 'Exportieren Sie den PDF-Bericht für eine vollständige Transaktionsliste.'
              : 'Export the PDF report for a complete transaction list.'
          )
        ) :
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            borderRadius: '1rem',
            padding: '2rem',
            border: `1px solid ${currentTheme.cardBorder}`,
            marginBottom: '2rem',
            textAlign: 'center'
          }
        },
          React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '1rem' } },
            language === 'de' 
              ? 'Keine Transaktionen für dieses Jahr vorhanden.'
              : 'No transactions for this year.'
          )
        ),
      
      taxReport.recommendations && taxReport.recommendations.length > 0 &&
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            borderRadius: '1rem',
            padding: '2rem',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '1.5rem', fontSize: '1.5rem' } },
            language === 'de' ? 'Optimierungsvorschlaege' : 'Tax Optimization Suggestions'
          ),
          taxReport.recommendations.map((rec, i) =>
            React.createElement('div', {
              key: i,
              style: {
                background: rec.type === 'wash-sale-warning' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                border: '1px solid ' + (rec.type === 'wash-sale-warning' ? '#ef4444' : '#10b981'),
                padding: '1rem',
                borderRadius: '0.5rem',
                marginBottom: '1rem'
              }
            },
              React.createElement('h4', { 
                style: { color: currentTheme.text, marginBottom: '0.5rem', fontWeight: '600' } 
              }, rec.symbol),
              React.createElement('p', { style: { color: currentTheme.text, marginBottom: '0.5rem' } }, rec.message),
              rec.taxSavings && 
                React.createElement('p', { style: { color: '#10b981', fontWeight: '600' } },
                  (language === 'de' ? 'Moegliche Steuerersparnis: ' : 'Potential tax savings: ') +
                  getCurrencySymbol() + formatPrice(rec.taxSavings)
                )
            )
          )
        )
    );
  }

  function RebalancingView() {
    const rebalanceSuggestions = useMemo(() => {
      if (typeof generateRebalancingSuggestions === 'undefined') return null;
      return generateRebalancingSuggestions(portfolio, targetAllocation, transactions);
    }, [portfolio, targetAllocation, transactions]);
    
    if (!rebalanceSuggestions) {
      return React.createElement('div', { style: { padding: '2rem', color: currentTheme.text } },
        language === 'de' ? 'Rebalancing-Funktionen werden geladen...' : 'Loading rebalancing functions...'
      );
    }
    
    const totalTarget = Object.values(targetAllocation).reduce((a, b) => a + b, 0);
    
    return React.createElement('div', { style: { padding: '2rem' } },
      React.createElement('h2', { 
        style: { color: currentTheme.text, fontSize: '2rem', fontWeight: '700', marginBottom: '2rem' } 
      },
        language === 'de' ? 'Portfolio Rebalancing' : 'Portfolio Rebalancing'
      ),
      
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          borderRadius: '1rem',
          padding: '2rem',
          border: `1px solid ${currentTheme.cardBorder}`,
          marginBottom: '2rem'
        }
      },
        React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '1rem', fontSize: '1.25rem' } },
          language === 'de' ? 'Zielaufteilung' : 'Target Allocation'
        ),
        React.createElement('div', { 
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' } 
        },
          Object.entries(targetAllocation).map(([category, percent]) =>
            React.createElement('div', { key: category },
              React.createElement('label', { 
                style: { display: 'block', color: currentTheme.text, marginBottom: '0.5rem', fontWeight: '600' } 
              },
                category.charAt(0).toUpperCase() + category.slice(1)
              ),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                React.createElement('input', {
                  type: 'number',
                  value: percent,
                  onChange: (e) => setTargetAllocation({ ...targetAllocation, [category]: parseInt(e.target.value) || 0 }),
                  min: 0,
                  max: 100,
                  style: {
                    flex: 1,
                    padding: '0.75rem',
                    background: currentTheme.inputBg,
                    color: currentTheme.text,
                    border: `1px solid ${currentTheme.inputBorder}`,
                    borderRadius: '0.5rem'
                  }
                }),
                React.createElement('span', { style: { color: currentTheme.text, fontWeight: '600' } }, '%')
              )
            )
          )
        ),
        React.createElement('p', { 
          style: { 
            marginTop: '1rem', 
            color: totalTarget !== 100 ? '#ef4444' : currentTheme.textSecondary,
            fontSize: '0.875rem'
          } 
        },
          (language === 'de' ? 'Gesamt: ' : 'Total: ') + totalTarget + '%' +
          (totalTarget !== 100 ? (language === 'de' ? ' (Muss 100% sein!)' : ' (Must equal 100%!)') : '')
        )
      ),
      
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          borderRadius: '1rem',
          padding: '2rem',
          border: `1px solid ${currentTheme.cardBorder}`,
          marginBottom: '2rem'
        }
      },
        React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '1.5rem', fontSize: '1.25rem' } },
          language === 'de' ? 'Aktuelle Aufteilung' : 'Current Allocation'
        ),
        Object.entries(rebalanceSuggestions.analysis.drift).map(([category, data]) =>
          React.createElement('div', { key: category, style: { marginBottom: '1.5rem' } },
            React.createElement('div', { 
              style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' } 
            },
              React.createElement('span', { style: { color: currentTheme.text, fontWeight: '600' } },
                category.charAt(0).toUpperCase() + category.slice(1)
              ),
              React.createElement('span', { style: { color: currentTheme.textSecondary } },
                (language === 'de' ? 'Aktuell: ' : 'Current: ') + data.current.toFixed(1) + '% | ' +
                (language === 'de' ? 'Ziel: ' : 'Target: ') + data.target + '%' +
                (data.overweight ? 
                  ' (+' + data.driftAmount.toFixed(1) + '%)' :
                  ' (' + data.driftAmount.toFixed(1) + '%)')
              )
            ),
            React.createElement('div', {
              style: {
                width: '100%',
                height: '24px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '12px',
                overflow: 'hidden',
                position: 'relative'
              }
            },
              React.createElement('div', {
                style: {
                  width: data.current + '%',
                  height: '100%',
                  background: data.overweight ? '#ef4444' : '#10b981',
                  position: 'absolute'
                }
              }),
              React.createElement('div', {
                style: {
                  position: 'absolute',
                  left: data.target + '%',
                  height: '100%',
                  width: '3px',
                  background: '#ffffff'
                }
              })
            )
          )
        )
      ),
      
      rebalanceSuggestions.rebalanceNeeded ?
        React.createElement('div', {
          style: {
            background: currentTheme.card,
            borderRadius: '1rem',
            padding: '2rem',
            border: `1px solid ${currentTheme.cardBorder}`
          }
        },
          React.createElement('div', {
            style: {
              background: 'rgba(251,191,36,0.1)',
              border: '1px solid #fbbf24',
              padding: '1rem',
              borderRadius: '0.5rem',
              marginBottom: '1.5rem'
            }
          },
            React.createElement('p', { style: { color: currentTheme.text, fontWeight: '600', marginBottom: '0.5rem' } },
              language === 'de' ? 'Portfolio ist nicht ausbalanciert!' : 'Portfolio is out of balance!'
            ),
            React.createElement('p', { style: { color: currentTheme.text, fontSize: '0.875rem' } },
              (language === 'de' ? 'Maximale Abweichung: ' : 'Maximum drift: ') + 
              rebalanceSuggestions.analysis.maxDrift.toFixed(2) + '%'
            )
          ),
          
          React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '1rem', fontSize: '1.25rem' } },
            language === 'de' ? 'Empfohlene Massnahmen' : 'Recommended Actions'
          ),
          
          rebalanceSuggestions.suggestions.map((sug, i) =>
            React.createElement('div', {
              key: i,
              style: {
                background: sug.action === 'BUY' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: '1px solid ' + (sug.action === 'BUY' ? '#10b981' : '#ef4444'),
                padding: '1.5rem',
                borderRadius: '0.5rem',
                marginBottom: '1rem'
              }
            },
              React.createElement('div', { 
                style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.75rem' } 
              },
                React.createElement('div', {},
                  React.createElement('h4', { 
                    style: { 
                      color: currentTheme.text, 
                      fontWeight: '700',
                      fontSize: '1.125rem',
                      marginBottom: '0.25rem'
                    } 
                  },
                    (language === 'de' ? (sug.action === 'BUY' ? 'KAUFEN' : 'VERKAUFEN') : sug.action) + 
                    ' ' + sug.category
                  ),
                  React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
                    sug.reason
                  )
                ),
                React.createElement('span', {
                  style: {
                    padding: '0.25rem 0.75rem',
                    borderRadius: '0.25rem',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    background: sug.priority === 'high' ? '#ef4444' : '#f59e0b',
                    color: 'white'
                  }
                }, sug.priority.toUpperCase())
              ),
              React.createElement('p', { 
                style: { 
                  color: currentTheme.text, 
                  fontSize: '1.25rem', 
                  fontWeight: '700' 
                } 
              },
                (language === 'de' ? 'Betrag: ' : 'Amount: ') + 
                getCurrencySymbol() + formatPrice(sug.amount)
              )
            )
          )
        ) :
        React.createElement('div', {
          style: {
            background: 'rgba(16,185,129,0.1)',
            border: '1px solid #10b981',
            padding: '3rem 2rem',
            borderRadius: '1rem',
            textAlign: 'center'
          }
        },
          React.createElement('div', { style: { fontSize: '3rem', marginBottom: '1rem' } }, 'OK'),
          React.createElement('h3', { style: { color: '#10b981', marginBottom: '0.5rem', fontSize: '1.5rem' } },
            language === 'de' ? 'Portfolio ist gut ausbalanciert!' : 'Portfolio is well-balanced!'
          ),
          React.createElement('p', { style: { color: currentTheme.text } },
            language === 'de' ? 'Derzeit ist kein Rebalancing erforderlich.' : 'No rebalancing needed at this time.'
          )
        )
    );
  }

    // ========== RENDER WITH SIDEBAR ==========
  return React.createElement('div', { style: { display: 'flex', height: '100vh', overflow: 'hidden' } },
    
    // ========== SIDEBAR ==========
    React.createElement('div', { className: 'sidebar', style: { width: '280px', background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)', color: 'white', display: 'flex', flexDirection: 'column', boxShadow: '4px 0 20px rgba(0,0,0,0.1)', zIndex: 100 } },
      
      // Sidebar Header
      React.createElement('div', { style: { padding: '2rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' } },
        React.createElement('div', { style: { fontSize: '1.75rem', fontWeight: '800', background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: '0.25rem' } }, 'MAERMIN'),
        React.createElement('div', { style: { fontSize: '0.65rem', opacity: 0.6, letterSpacing: '0.05em', textTransform: 'uppercase' } }, 'Smart Money Management')
      ),
      
      // Sidebar Navigation
      React.createElement('div', { style: { flex: 1, padding: '1rem 0', overflowY: 'auto' } },
        [
          { view: 'overview', label: t.overview },
          { view: 'portfolio', label: t.portfolio },
          { view: 'charts', label: t.statistics },
          { view: 'transactions', label: language === 'de' ? 'Transaktionen' : 'Transactions' },
          { view: 'taxreports', label: language === 'de' ? 'Steuerberichte' : 'Tax Reports' },
          { view: 'rebalancing', label: 'Rebalancing' },
          { view: 'risk', label: 'Risk Analytics' },
          { view: 'cs2analytics', label: 'CS2 Analytics' }
        ].map(item => 
          React.createElement('div', {
            key: item.view,
            onClick: () => setActiveView(item.view),
            style: {
              display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1.5rem',
              cursor: 'pointer', transition: 'all 0.2s',
              borderLeft: activeView === item.view ? '3px solid #3b82f6' : '3px solid transparent',
              background: activeView === item.view ? 'rgba(59,130,246,0.1)' : 'transparent',
              color: activeView === item.view ? 'white' : 'rgba(255,255,255,0.7)'
            }
          },
            React.createElement('span', { style: { fontWeight: '500', fontSize: '0.9375rem' } }, item.label)
          )
        )
      ),
      
      // Sidebar Footer
      React.createElement('div', { style: { padding: '1rem 1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' } },
        React.createElement('div', { style: { fontSize: '0.75rem', opacity: 0.5, marginBottom: '0.75rem' } }, 'MAERMIN v5.1'),
        React.createElement('button', {
          onClick: () => setTheme(theme === 'dark' ? 'white' : theme === 'white' ? 'purple' : 'dark'),
          style: { width: '100%', padding: '0.625rem', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '0.5rem', color: 'white', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '500', transition: 'all 0.2s' }
        }, theme === 'dark' ? ' Dark' : theme === 'white' ? ' Light' : ' Purple')
      )
    ),
    
    // ========== MAIN CONTENT ==========
    React.createElement('div', { style: { flex: 1, overflowY: 'auto' } },
      React.createElement('div', { style: { minHeight: '100%', background: currentTheme.background, padding: '2rem' } },
        React.createElement('div', { style: { maxWidth: '1400px', margin: '0 auto' } },
          React.createElement('div', { style: { background: currentTheme.card, backdropFilter: 'blur(10px)', borderRadius: '1rem', padding: '2rem', border: `1px solid ${currentTheme.cardBorder}` } },
        
        // Header with title and action buttons
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' } },
          React.createElement('h1', { style: { fontSize: '2.5rem', fontWeight: 'bold', color: currentTheme.text } }, t.title),
          React.createElement('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' } },
            React.createElement('button', { onClick: () => setShowSettings(!showSettings), style: { padding: '0.5rem 1rem', background: '#9333ea', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: '600' } }, t.settings),
            React.createElement('button', { onClick: () => setShowApiSettings(!showApiSettings), style: { padding: '0.5rem 1rem', background: '#ca8a04', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: '600' } }, t.apiKeys),
            React.createElement('button', { onClick: exportData, style: { padding: '0.5rem 1rem', background: '#16a34a', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: '600' } }, t.export),
            React.createElement('label', { style: { padding: '0.5rem 1rem', background: '#9333ea', color: 'white', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' } }, t.import, React.createElement('input', { type: 'file', accept: '.json', onChange: importData, style: { display: 'none' } })),
            React.createElement('button', { onClick: fetchPrices, disabled: loading, style: { padding: '0.5rem 1rem', background: '#2563eb', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', opacity: loading ? 0.5 : 1, fontWeight: '600' } }, loading ? (t.loading) : (t.refresh))
          )
        ),

        // Settings panel
        showSettings && React.createElement('div', { style: { background: currentTheme.inputBg, borderRadius: '1rem', padding: '1.5rem', marginBottom: '1.5rem', border: `2px solid ${currentTheme.inputBorder}` } },
          React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '1rem' } }, ' ' + (language === 'de' ? 'Einstellungen' : t.settings)),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' } },
            React.createElement('div', {},
              React.createElement('label', { style: { color: currentTheme.text, display: 'block', marginBottom: '0.5rem', fontWeight: '600' } }, t.theme + ':'),
              React.createElement('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
                ['white', 'dark', 'purple'].map(th => React.createElement('button', { key: th, onClick: () => setTheme(th), style: { padding: '0.5rem 1.5rem', background: theme === th ? '#3b82f6' : currentTheme.inputBg, color: theme === th ? 'white' : currentTheme.text, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' } }, th === 'white' ? (t.whiteMode) : th === 'dark' ? (t.darkMode) : (t.purpleMode)))
              )
            ),
            React.createElement('div', {},
              React.createElement('label', { style: { color: currentTheme.text, display: 'block', marginBottom: '0.5rem', fontWeight: '600' } }, t.language + ':'),
              React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                React.createElement('button', { 
                  onClick: () => { 
                    setLanguage('de'); 
                    localStorage.setItem('language', 'de');
                  }, 
                  style: { padding: '0.5rem 1.5rem', background: language === 'de' ? '#3b82f6' : currentTheme.inputBg, color: language === 'de' ? 'white' : currentTheme.text, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' } 
                }, 'DE (Deutsch)'),
                React.createElement('button', { 
                  onClick: () => { 
                    setLanguage('en'); 
                    localStorage.setItem('language', 'en');
                  }, 
                  style: { padding: '0.5rem 1.5rem', background: language === 'en' ? '#3b82f6' : currentTheme.inputBg, color: language === 'en' ? 'white' : currentTheme.text, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' } 
                }, 'EN (English)')
              )
            ),
            React.createElement('div', {},
              React.createElement('label', { style: { color: currentTheme.text, display: 'block', marginBottom: '0.5rem', fontWeight: '600' } }, t.currency + ':'),
              React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                React.createElement('button', { onClick: () => setCurrency('EUR'), style: { padding: '0.5rem 1.5rem', background: currency === 'EUR' ? '#3b82f6' : currentTheme.inputBg, color: currency === 'EUR' ? 'white' : currentTheme.text, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' } }, 'EUR (€)'),
                React.createElement('button', { onClick: () => setCurrency('USD'), style: { padding: '0.5rem 1.5rem', background: currency === 'USD' ? '#3b82f6' : currentTheme.inputBg, color: currency === 'USD' ? 'white' : currentTheme.text, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', cursor: 'pointer', fontWeight: '600' } }, 'USD ($)')
              ),
              currency === 'USD' && React.createElement('div', { style: { marginTop: '0.75rem' } },
                React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' } },
                  React.createElement('span', { style: { fontSize: '0.875rem', color: currentTheme.text, fontWeight: '600' } }, 
                    `1 EUR = ${exchangeRate.toFixed(4)} USD`
                  ),
                  React.createElement('button', {
                    onClick: fetchExchangeRate,
                    style: {
                      padding: '0.375rem 0.75rem',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.375rem',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: '600'
                    }
                  }, ' ' + (language === 'de' ? 'Live-Kurs' : 'Live Rate'))
                ),
                localStorage.getItem('exchangeRateLastUpdate') && React.createElement('div', { 
                  style: { fontSize: '0.7rem', color: currentTheme.textSecondary } 
                }, 
                  ' ' + (language === 'de' ? 'Aktualisiert: ' : 'Updated: ') + 
                  new Date(localStorage.getItem('exchangeRateLastUpdate')).toLocaleString(language === 'de' ? 'de-DE' : 'en-US', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                )
              )
            )
          ),
          React.createElement('button', { onClick: () => setShowSettings(false), style: { padding: '0.5rem 1.5rem', background: '#4b5563', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' } }, t.cancel)
        ),

        // API Settings panel
        showApiSettings && React.createElement('div', { style: { background: currentTheme.inputBg, borderRadius: '1rem', padding: '1.5rem', marginBottom: '1.5rem', border: `2px solid rgba(234,179,8,0.5)` } },
          React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '1rem' } }, ' ' + t.apiSettings),
          
          React.createElement('label', { style: { color: currentTheme.text, display: 'block', marginBottom: '0.5rem' } }, t.alphaVantageKey),
          React.createElement('input', { type: 'text', value: apiKeys.alphaVantage, onChange: (e) => setApiKeys({...apiKeys, alphaVantage: e.target.value}), placeholder: 'ABCDEFGHIJKLMNOP', style: { width: '100%', padding: '0.5rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', color: currentTheme.text, marginBottom: '0.5rem' } }),
          React.createElement('a', { href: 'https://www.alphavantage.co/support/#api-key', target: '_blank', rel: 'noopener noreferrer', style: { color: '#3b82f6', fontSize: '0.875rem', textDecoration: 'none', display: 'block', marginBottom: '1rem' } }, t.getKeyFree + ' (Alpha Vantage)'),
          
          React.createElement('label', { style: { color: currentTheme.text, display: 'block', marginBottom: '0.5rem' } }, t.skinportKey),
          React.createElement('input', { type: 'text', value: apiKeys.skinport, onChange: (e) => setApiKeys({...apiKeys, skinport: e.target.value}), placeholder: 'your-skinport-api-key', style: { width: '100%', padding: '0.5rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', color: currentTheme.text, marginBottom: '0.5rem' } }),
          React.createElement('a', { href: 'https://skinport.com/api', target: '_blank', rel: 'noopener noreferrer', style: { color: '#3b82f6', fontSize: '0.875rem', textDecoration: 'none', display: 'block', marginBottom: '1rem' } }, t.getKeyFree + ' (Skinport)'),
          
          React.createElement('div', { style: { display: 'flex', gap: '0.75rem' } },
            React.createElement('button', { onClick: saveApiKeys, style: { padding: '0.5rem 1.5rem', background: '#16a34a', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' } }, t.save),
            React.createElement('button', { onClick: () => setShowApiSettings(false), style: { padding: '0.5rem 1.5rem', background: '#4b5563', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' } }, t.cancel)
          )
        ),

        // View navigation now in sidebar (left)
        React.createElement('div', { style: { display: 'none' } }, // Old buttons hidden - using sidebar now
          React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' } },
            React.createElement('button', { onClick: () => setActiveView('overview'), style: { padding: '0.75rem 1.5rem', background: activeView === 'overview' ? '#3b82f6' : currentTheme.inputBg, color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: '600' } }, ' ' + t.financialOverview),
            React.createElement('button', { onClick: () => setActiveView('portfolio'), style: { padding: '0.75rem 1.5rem', background: activeView === 'portfolio' ? '#3b82f6' : currentTheme.inputBg, color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: '600' } }, ' ' + t.portfolio),
            React.createElement('button', { onClick: () => setActiveView('charts'), style: { padding: '0.75rem 1.5rem', background: activeView === 'charts' ? '#3b82f6' : currentTheme.inputBg, color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: '600' } }, ' ' + t.statistics),
          )
        ),

        // ============= PORTFOLIO VIEW =============
        activeView === 'portfolio' && React.createElement('div', {},
          // Main portfolio summary card
          React.createElement('div', { style: { background: 'linear-gradient(90deg, #f97316, #ec4899)', borderRadius: '1rem', padding: '1.5rem', color: 'white', marginBottom: '2rem' } },
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' } },
              React.createElement('div', {}, 
                React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.9 } }, t.totalValue), 
                React.createElement('div', { style: { fontSize: '2.5rem', fontWeight: 'bold' } }, getCurrencySymbol() + formatPrice(total))
              ),
              React.createElement('div', {}, 
                React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.9 } }, t.invested), 
                React.createElement('div', { style: { fontSize: '2rem', fontWeight: 'bold' } }, getCurrencySymbol() + formatPrice(invest))
              ),
              React.createElement('div', {}, 
                React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.9 } }, t.profitLoss), 
                React.createElement('div', { style: { fontSize: '2rem', fontWeight: 'bold', color: profit >= 0 ? '#10b981' : '#ef4444' } }, (profit >= 0 ? '+' : '') + getCurrencySymbol() + formatPrice(Math.abs(profit))), 
                React.createElement('div', { style: { fontSize: '1rem', opacity: 0.9 } }, `(${profitPct >= 0 ? '+' : ''}${formatPrice(profitPct)}%)`)
              )
            )
          ),

          // Category summary cards
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem', marginBottom: '2rem' } },
            [['crypto', '#3b82f6', '#2563eb'], ['stocks', '#10b981', '#059669'], ['skins', '#8b5cf6', '#7c3aed']].map(([cat, c1, c2]) => {
              const catProfit = calcProfit(cat);
              const catInvest = calcInvest(cat);
              const catProfitPct = catInvest > 0 ? (catProfit / catInvest) * 100 : 0;
              return React.createElement('div', { key: cat, style: { background: `linear-gradient(135deg, ${c1}, ${c2})`, borderRadius: '1rem', padding: '1.5rem', color: 'white' } },
                React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.8 } }, t[cat === 'skins' ? 'cs2Items' : cat]),
                React.createElement('div', { style: { fontSize: '2rem', fontWeight: 'bold', margin: '0.5rem 0' } }, getCurrencySymbol() + formatPrice(calcTotal(cat))),
                React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.8 } }, safe[cat].length + ' ' + getPositionText(safe[cat].length)),
                React.createElement('div', { style: { fontSize: '0.875rem', marginTop: '0.5rem', fontWeight: '600', color: catProfit >= 0 ? '#86efac' : '#fca5a5' } }, (catProfit >= 0 ? ' +' : ' ') + getCurrencySymbol() + formatPrice(Math.abs(catProfit)) + ` (${catProfitPct >= 0 ? '+' : ''}${formatPrice(catProfitPct)}%)`)
              );
            })
          ),

          // Category tabs
          React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' } },
            tabs.map(tab => React.createElement('button', { 
              key: tab.id, 
              onClick: () => setActiveTab(tab.id), 
              style: { 
                padding: '0.75rem 1.5rem', 
                background: activeTab === tab.id ? '#3b82f6' : currentTheme.inputBg, 
                color: 'white', 
                borderRadius: '0.5rem', 
                border: 'none', 
                cursor: 'pointer', 
                fontWeight: '600' 
              } 
            }, tab.label))
          ),

          // Portfolio always shows transactions - no manual mode
          React.createElement('div', {
            style: {
              background: 'rgba(16,185,129,0.1)',
              border: '2px solid #10b981',
              borderRadius: '1rem',
              padding: '1rem',
              marginBottom: '1.5rem',
              textAlign: 'center'
            }
          },
            React.createElement('div', { 
              style: { 
                color: '#10b981', 
                fontWeight: '600',
                fontSize: '0.95rem'
              } 
            }, 
              language === 'de' 
                ? 'Portfolio wird automatisch aus Transaktionen berechnet' 
                : 'Portfolio automatically calculated from Transactions'
            )
          ),

          // Position list
          React.createElement('div', {},
            safe[activeTab].length === 0 ? 
              React.createElement('div', { style: { textAlign: 'center', padding: '3rem', color: currentTheme.textSecondary } }, t.noPositions) :
              safe[activeTab].map(item => {
                const curr = item.currentPrice || prices[item.symbol.toLowerCase()] || prices[item.symbol] || item.purchasePrice || 0;
                const val = curr * item.amount;
                const inv = (item.purchasePrice || 0) * item.amount;
                const fees = parseFloat(item.fees) || 0;
                const prof = val - inv - fees; // Profit minus fees
                const profPct = inv > 0 ? (prof / inv) * 100 : 0;
                const img = images[item.symbol.toLowerCase()] || images[item.symbol];
                
                // Edit mode for this item
                if (editingItem && editingItem.id === item.id) {
                  return React.createElement('div', { 
                    key: item.id, 
                    style: { 
                      background: currentTheme.inputBg, 
                      borderRadius: '0.75rem', 
                      padding: '1rem', 
                      marginBottom: '0.75rem', 
                      border: `2px solid #3b82f6` 
                    } 
                  },
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1rem' } },
                      React.createElement('div', {}, 
                        React.createElement('label', { style: { color: currentTheme.text, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' } }, t.symbol), 
                        React.createElement('input', { 
                          type: 'text', 
                          value: editingItem.symbol, 
                          onChange: (e) => setEditingItem({...editingItem, symbol: e.target.value}), 
                          style: { width: '100%', padding: '0.5rem', background: currentTheme.card, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', color: currentTheme.text } 
                        })
                      ),
                      React.createElement('div', {}, 
                        React.createElement('label', { style: { color: currentTheme.text, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' } }, t.amount), 
                        React.createElement('input', { 
                          type: 'number', 
                          step: '0.001', 
                          value: editingItem.amount, 
                          onChange: (e) => setEditingItem({...editingItem, amount: e.target.value}), 
                          style: { width: '100%', padding: '0.5rem', background: currentTheme.card, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', color: currentTheme.text } 
                        })
                      ),
                      React.createElement('div', {}, 
                        React.createElement('label', { style: { color: currentTheme.text, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' } }, t.purchasePrice), 
                        React.createElement('input', { 
                          type: 'number', 
                          step: '0.01', 
                          value: editingItem.purchasePrice, 
                          onChange: (e) => setEditingItem({...editingItem, purchasePrice: e.target.value}), 
                          style: { width: '100%', padding: '0.5rem', background: currentTheme.card, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', color: currentTheme.text } 
                        })
                      ),
                      React.createElement('div', {}, 
                        React.createElement('label', { style: { color: currentTheme.text, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' } }, t.purchaseDate), 
                        React.createElement('input', { 
                          type: 'date', 
                          value: editingItem.purchaseDate, 
                          onChange: (e) => setEditingItem({...editingItem, purchaseDate: e.target.value}), 
                          style: { width: '100%', padding: '0.5rem', background: currentTheme.card, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', color: currentTheme.text } 
                        })
                      ),
                      React.createElement('div', {}, 
                        React.createElement('label', { style: { color: currentTheme.text, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' } }, t.feesOptional), 
                        React.createElement('input', { 
                          type: 'number', 
                          step: '0.01',
                          min: '0',
                          placeholder: '0.00',
                          value: editingItem.fees || '', 
                          onChange: (e) => setEditingItem({...editingItem, fees: e.target.value}), 
                          style: { width: '100%', padding: '0.5rem', background: currentTheme.card, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', color: currentTheme.text } 
                        })
                      ),
                      activeTab === 'skins' && React.createElement('div', {}, 
                        React.createElement('label', { style: { color: currentTheme.text, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' } }, 'Float Value'), 
                        React.createElement('input', { 
                          type: 'number', 
                          step: '0.0001',
                          min: '0',
                          max: '1',
                          value: editingItem.floatValue || '', 
                          onChange: (e) => setEditingItem({...editingItem, floatValue: e.target.value}), 
                          style: { width: '100%', padding: '0.5rem', background: currentTheme.card, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', color: currentTheme.text } 
                        })
                      ),
                      activeTab === 'skins' && React.createElement('div', {}, 
                        React.createElement('label', { style: { color: currentTheme.text, fontSize: '0.875rem', display: 'block', marginBottom: '0.25rem' } }, 'Rarity'), 
                        React.createElement('select', { 
                          value: editingItem.rarity || '', 
                          onChange: (e) => setEditingItem({...editingItem, rarity: e.target.value}), 
                          style: { width: '100%', padding: '0.5rem', background: currentTheme.card, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '0.5rem', color: currentTheme.text } 
                        },
                          React.createElement('option', { value: '' }, '-- Select --'),
                          React.createElement('option', { value: 'consumer_grade' }, 'Consumer Grade'),
                          React.createElement('option', { value: 'industrial_grade' }, 'Industrial Grade'),
                          React.createElement('option', { value: 'mil_spec' }, 'Mil-Spec'),
                          React.createElement('option', { value: 'restricted' }, 'Restricted'),
                          React.createElement('option', { value: 'classified' }, 'Classified'),
                          React.createElement('option', { value: 'covert' }, 'Covert'),
                          React.createElement('option', { value: 'contraband' }, 'Contraband'),
                          React.createElement('option', { value: 'knife' }, 'Knife'),
                          React.createElement('option', { value: 'glove' }, 'Glove')
                        )
                      )
                    ),
                    React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                      React.createElement('button', { 
                        onClick: saveEdit, 
                        style: { padding: '0.5rem 1rem', background: '#16a34a', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' } 
                      }, ' ' + t.save),
                      React.createElement('button', { 
                        onClick: cancelEdit, 
                        style: { padding: '0.5rem 1rem', background: '#4b5563', color: 'white', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' } 
                      }, ' ' + t.cancel)
                    )
                  );
                }
                
                // Normal display mode
                return React.createElement('div', { 
                  key: item.id, 
                  style: { 
                    background: currentTheme.inputBg, 
                    borderRadius: '0.75rem', 
                    padding: '1rem', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    marginBottom: '0.75rem', 
                    border: `1px solid ${currentTheme.inputBorder}` 
                  } 
                },
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '1rem', flex: 1 } },
                    img && React.createElement('img', { 
                      src: img, 
                      alt: item.symbol, 
                      style: { width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', background: 'white' }, 
                      onError: (e) => { e.target.style.display = 'none'; } 
                    }),
                    React.createElement('div', {},
                      React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '1.125rem' } }, item.symbol.toUpperCase()),
                      React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } }, `${t.amount}: ${item.amount} | ${t.bought}: ${fmtDate(item.purchaseDate)}`),
                      React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } }, `${t.purchasePrice}: ${getCurrencySymbol()}${formatPrice(item.purchasePrice || 0)} ${t.perUnit}`),
                      activeTab === 'skins' && React.createElement('a', {
                        href: `https://skinport.com/market?search=${encodeURIComponent(item.symbol)}`,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        style: {
                          color: '#10b981',
                          fontSize: '0.75rem',
                          textDecoration: 'none',
                          display: 'inline-block',
                          marginTop: '0.25rem',
                          fontWeight: '600'
                        }
                      }, 'Check Skinport Price →'),
                      activeTab === 'skins' && item.metadata?.float !== undefined && React.createElement('div', { style: { color: '#06b6d4', fontSize: '0.875rem', fontWeight: '600' } }, `Float: ${item.metadata.float.toFixed(4)}`),
                      activeTab === 'skins' && item.metadata?.rarity && React.createElement('div', { style: { color: '#8b5cf6', fontSize: '0.875rem', fontWeight: '600' } }, `Rarity: ${item.metadata.rarity.replace(/_/g, ' ').toUpperCase()}`)
                    )
                  ),
                  React.createElement('div', { style: { textAlign: 'right', marginRight: '1rem' } },
                    React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '1.25rem' } }, getCurrencySymbol() + formatPrice(val)),
                    React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } }, getCurrencySymbol() + formatPrice(curr) + ' ' + t.perUnit),
                    activeTab === 'skins' && React.createElement('div', { 
                      style: { 
                        fontSize: '0.75rem', 
                        color: '#8b5cf6',
                        marginTop: '0.5rem',
                        cursor: 'pointer',
                        fontWeight: '600',
                        textDecoration: 'underline'
                      },
                      onClick: () => {
                        setPriceUpdateModal({ show: true, item: item, currentPrice: curr });
                        setNewPriceInput(curr.toString());
                      }
                    }, language === 'de' ? 'Preis manuell ändern' : 'Update Price Manually'),
                    React.createElement('div', { style: { fontSize: '0.875rem', fontWeight: '600', color: prof >= 0 ? '#10b981' : '#ef4444', marginTop: '0.25rem' } }, (prof >= 0 ? '+' : '') + getCurrencySymbol() + formatPrice(Math.abs(prof)) + ` (${profPct >= 0 ? '+' : ''}${formatPrice(profPct)}%)`)
                  )
                );
              })
          )
        ),
        
        // Price Update Modal (for CS2 items)
        priceUpdateModal.show && React.createElement('div', {
          style: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          },
          onClick: () => setPriceUpdateModal({ show: false, item: null, currentPrice: 0 })
        },
          React.createElement('div', {
            style: {
              background: currentTheme.inputBg,
              borderRadius: '1rem',
              padding: '2rem',
              maxWidth: '500px',
              width: '90%',
              border: `2px solid ${currentTheme.inputBorder}`
            },
            onClick: (e) => e.stopPropagation()
          },
            React.createElement('h3', {
              style: { color: currentTheme.text, marginBottom: '1rem', fontSize: '1.25rem', fontWeight: '600' }
            }, language === 'de' ? 'Preis aktualisieren' : 'Update Price'),
            React.createElement('div', {
              style: { color: currentTheme.textSecondary, marginBottom: '1rem', fontSize: '0.875rem' }
            }, priceUpdateModal.item?.symbol),
            React.createElement('div', {
              style: { color: currentTheme.textSecondary, marginBottom: '1rem', fontSize: '0.875rem' }
            }, (language === 'de' ? 'Aktueller Preis: ' : 'Current Price: ') + getCurrencySymbol() + formatPrice(priceUpdateModal.currentPrice)),
            React.createElement('label', {
              style: { color: currentTheme.text, display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }
            }, language === 'de' ? 'Neuer Preis:' : 'New Price:'),
            React.createElement('input', {
              type: 'number',
              step: '0.01',
              value: newPriceInput,
              onChange: (e) => setNewPriceInput(e.target.value),
              style: {
                width: '100%',
                padding: '0.75rem',
                background: currentTheme.card,
                border: `2px solid ${currentTheme.inputBorder}`,
                borderRadius: '0.5rem',
                color: currentTheme.text,
                fontSize: '1.125rem',
                marginBottom: '1.5rem'
              },
              autoFocus: true,
              onKeyPress: (e) => {
                if (e.key === 'Enter') {
                  const newPrice = parseFloat(newPriceInput);
                  if (!isNaN(newPrice) && newPrice > 0) {
                    const updatedPrices = {...prices};
                    updatedPrices[priceUpdateModal.item.symbol] = newPrice;
                    updatedPrices[priceUpdateModal.item.symbol.toUpperCase()] = newPrice;
                    updatedPrices[priceUpdateModal.item.symbol.toLowerCase()] = newPrice;
                    setPrices(updatedPrices);
                    setPriceUpdateModal({ show: false, item: null, currentPrice: 0 });
                  }
                }
              }
            }),
            React.createElement('div', { style: { display: 'flex', gap: '0.75rem' } },
              React.createElement('button', {
                onClick: () => {
                  const newPrice = parseFloat(newPriceInput);
                  if (!isNaN(newPrice) && newPrice > 0) {
                    const updatedPrices = {...prices};
                    updatedPrices[priceUpdateModal.item.symbol] = newPrice;
                    updatedPrices[priceUpdateModal.item.symbol.toUpperCase()] = newPrice;
                    updatedPrices[priceUpdateModal.item.symbol.toLowerCase()] = newPrice;
                    setPrices(updatedPrices);
                    setPriceUpdateModal({ show: false, item: null, currentPrice: 0 });
                  }
                },
                style: {
                  flex: 1,
                  padding: '0.75rem',
                  background: '#16a34a',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontWeight: '600'
                }
              }, language === 'de' ? 'Speichern' : 'Save'),
              React.createElement('button', {
                onClick: () => setPriceUpdateModal({ show: false, item: null, currentPrice: 0 }),
                style: {
                  flex: 1,
                  padding: '0.75rem',
                  background: '#6b7280',
                  color: 'white',
                  border: 'none',
                  borderRadius: '0.5rem',
                  cursor: 'pointer',
                  fontWeight: '600'
                }
              }, language === 'de' ? 'Abbrechen' : 'Cancel')
            )
          )
        ),

        // ============= STATISTICS VIEW =============
        activeView === 'charts' && React.createElement('div', {},
          
          // Portfolio health metrics
          React.createElement('div', { style: { background: currentTheme.inputBg, borderRadius: '1rem', padding: '2rem', marginBottom: '2rem', border: `1px solid ${currentTheme.inputBorder}` } },
            React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' } }, ' ' + t.portfolioHealth),
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' } },
              // Portfolio health rating
              React.createElement('div', { style: { background: currentTheme.card, borderRadius: '0.75rem', padding: '1.5rem', border: `1px solid ${currentTheme.inputBorder}` } },
                React.createElement('div', { style: { fontSize: '0.875rem', color: currentTheme.textSecondary, marginBottom: '0.5rem' } }, t.portfolioHealth),
                React.createElement('div', { style: { fontSize: '1.75rem', fontWeight: 'bold', color: getPortfolioHealth().color } }, getPortfolioHealth().rating)
              ),
              // Diversification score
              React.createElement('div', { style: { background: currentTheme.card, borderRadius: '0.75rem', padding: '1.5rem', border: `1px solid ${currentTheme.inputBorder}` } },
                React.createElement('div', { style: { fontSize: '0.875rem', color: currentTheme.textSecondary, marginBottom: '0.5rem' } }, t.diversification),
                React.createElement('div', { style: { fontSize: '1.75rem', fontWeight: 'bold', color: currentTheme.text } }, getDiversificationScore() + '/100'),
                React.createElement('div', { style: { fontSize: '0.75rem', color: currentTheme.textSecondary, marginTop: '0.25rem' } }, getConcentration())
              ),
              // Average return
              React.createElement('div', { style: { background: currentTheme.card, borderRadius: '0.75rem', padding: '1.5rem', border: `1px solid ${currentTheme.inputBorder}` } },
                React.createElement('div', { style: { fontSize: '0.875rem', color: currentTheme.textSecondary, marginBottom: '0.5rem' } }, t.averageReturn),
                React.createElement('div', { style: { fontSize: '1.75rem', fontWeight: 'bold', color: parseFloat(getAverageReturn()) >= 0 ? '#10b981' : '#ef4444' } }, (parseFloat(getAverageReturn()) >= 0 ? '+' : '') + getAverageReturn() + '%')
              ),
              // Total assets
              React.createElement('div', { style: { background: currentTheme.card, borderRadius: '0.75rem', padding: '1.5rem', border: `1px solid ${currentTheme.inputBorder}` } },
                React.createElement('div', { style: { fontSize: '0.875rem', color: currentTheme.textSecondary, marginBottom: '0.5rem' } }, t.totalAssets),
                React.createElement('div', { style: { fontSize: '1.75rem', fontWeight: 'bold', color: currentTheme.text } }, getTotalAssetCount())
              ),
              // Risk level
              React.createElement('div', { style: { background: currentTheme.card, borderRadius: '0.75rem', padding: '1.5rem', border: `1px solid ${currentTheme.inputBorder}` } },
                React.createElement('div', { style: { fontSize: '0.875rem', color: currentTheme.textSecondary, marginBottom: '0.5rem' } }, t.riskLevel),
                React.createElement('div', { style: { fontSize: '1.25rem', fontWeight: 'bold', color: getRiskLevel() === t.highRisk ? '#ef4444' : getRiskLevel() === t.mediumRisk ? '#f59e0b' : '#10b981' } }, getRiskLevel())
              )
            )
          ),

          // Top and worst performers
          getTotalAssetCount() > 0 && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem', marginBottom: '2rem' } },
            // Top performers
            React.createElement('div', { style: { background: currentTheme.inputBg, borderRadius: '1rem', padding: '1.5rem', border: `1px solid ${currentTheme.inputBorder}` } },
              React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' } }, ' ' + t.topPerformers),
              getTopPerformers(5).length === 0 ? 
                React.createElement('div', { style: { textAlign: 'center', padding: '2rem', color: currentTheme.textSecondary } }, t.noPositions) :
                getTopPerformers(5).map((asset, idx) => 
                  React.createElement('div', { 
                    key: asset.id, 
                    style: { 
                      background: currentTheme.card, 
                      borderRadius: '0.5rem', 
                      padding: '1rem', 
                      marginBottom: '0.75rem', 
                      border: `1px solid ${currentTheme.inputBorder}`,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    } 
                  },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } },
                      React.createElement('div', { style: { fontSize: '1.5rem', fontWeight: 'bold', color: currentTheme.textSecondary } }, '#' + (idx + 1)),
                      React.createElement('div', {},
                        React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600' } }, asset.symbol.toUpperCase()),
                        React.createElement('div', { style: { fontSize: '0.75rem', color: currentTheme.textSecondary } }, t[asset.category === 'skins' ? 'cs2Items' : asset.category])
                      )
                    ),
                    React.createElement('div', { style: { textAlign: 'right' } },
                      React.createElement('div', { style: { fontSize: '1.25rem', fontWeight: 'bold', color: '#10b981' } }, '+' + formatPrice(asset.profitPct) + '%'),
                      React.createElement('div', { style: { fontSize: '0.75rem', color: currentTheme.textSecondary } }, getCurrencySymbol() + formatPrice(asset.profit))
                    )
                  )
                )
            ),
            
            // Worst performers
            React.createElement('div', { style: { background: currentTheme.inputBg, borderRadius: '1rem', padding: '1.5rem', border: `1px solid ${currentTheme.inputBorder}` } },
              React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1.25rem', fontWeight: '600', marginBottom: '1rem' } }, ' ' + t.worstPerformers),
              getWorstPerformers(5).length === 0 ? 
                React.createElement('div', { style: { textAlign: 'center', padding: '2rem', color: currentTheme.textSecondary } }, t.noPositions) :
                getWorstPerformers(5).map((asset, idx) => 
                  React.createElement('div', { 
                    key: asset.id, 
                    style: { 
                      background: currentTheme.card, 
                      borderRadius: '0.5rem', 
                      padding: '1rem', 
                      marginBottom: '0.75rem', 
                      border: `1px solid ${currentTheme.inputBorder}`,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    } 
                  },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } },
                      React.createElement('div', { style: { fontSize: '1.5rem', fontWeight: 'bold', color: currentTheme.textSecondary } }, '#' + (idx + 1)),
                      React.createElement('div', {},
                        React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600' } }, asset.symbol.toUpperCase()),
                        React.createElement('div', { style: { fontSize: '0.75rem', color: currentTheme.textSecondary } }, t[asset.category === 'skins' ? 'cs2Items' : asset.category])
                      )
                    ),
                    React.createElement('div', { style: { textAlign: 'right' } },
                      React.createElement('div', { style: { fontSize: '1.25rem', fontWeight: 'bold', color: '#ef4444' } }, formatPrice(asset.profitPct) + '%'),
                      React.createElement('div', { style: { fontSize: '0.75rem', color: currentTheme.textSecondary } }, getCurrencySymbol() + formatPrice(Math.abs(asset.profit)))
                    )
                  )
                )
            )
          ),

          // Portfolio distribution
          React.createElement('div', { style: { background: currentTheme.inputBg, borderRadius: '1rem', padding: '2rem', marginBottom: '2rem', border: `1px solid ${currentTheme.inputBorder}` } },
            React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' } }, t.distribution),
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' } },
              [['crypto', '#3b82f6'], ['stocks', '#10b981'], ['skins', '#8b5cf6']].map(([cat, color]) => {
                const catProfit = calcProfit(cat);
                const catInvest = calcInvest(cat);
                const catProfitPct = catInvest > 0 ? (catProfit / catInvest) * 100 : 0;
                return React.createElement('div', { 
                  key: cat, 
                  style: { background: `linear-gradient(135deg, ${color}, ${color}dd)`, borderRadius: '0.75rem', padding: '1.5rem', color: 'white' } 
                },
                  React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.8, marginBottom: '0.5rem' } }, t[cat === 'skins' ? 'cs2Items' : cat]),
                  React.createElement('div', { style: { fontSize: '2rem', fontWeight: 'bold' } }, getPct(cat) + '%'),
                  React.createElement('div', { style: { fontSize: '1rem', marginTop: '0.5rem' } }, getCurrencySymbol() + formatPrice(calcTotal(cat))),
                  React.createElement('div', { style: { fontSize: '0.875rem', marginTop: '0.25rem', fontWeight: '600', color: catProfit >= 0 ? '#86efac' : '#fca5a5' } }, (catProfit >= 0 ? ' +' : ' ') + getCurrencySymbol() + formatPrice(Math.abs(catProfit)) + ` (${catProfitPct >= 0 ? '+' : ''}${formatPrice(catProfitPct)}%)`)
                );
              })
            )
          ),

          // Detailed asset breakdown by category
          React.createElement('div', { style: { background: currentTheme.inputBg, borderRadius: '1rem', padding: '2rem', border: `1px solid ${currentTheme.inputBorder}` } },
            React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' } }, tabs.find(t => t.id === activeTab)?.label + ' - ' + t.details),
            safe[activeTab].length === 0 ?
              React.createElement('div', { style: { textAlign: 'center', padding: '3rem', color: currentTheme.textSecondary } }, t.noPositionsCategory) :
              safe[activeTab].map(item => {
                const curr = item.currentPrice || prices[item.symbol.toLowerCase()] || prices[item.symbol] || item.purchasePrice || 0;
                const val = curr * item.amount;
                const inv = (item.purchasePrice || 0) * item.amount;
                const fees = parseFloat(item.fees) || 0;
                const prof = val - inv - fees; // Profit minus fees
                const profPct = inv > 0 ? (prof / inv) * 100 : 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                const img = images[item.symbol.toLowerCase()] || images[item.symbol];
                const daysSince = getDaysSincePurchase(item.purchaseDate);
                
                return React.createElement('div', { 
                  key: item.id, 
                  style: { 
                    background: currentTheme.card, 
                    borderRadius: '0.75rem', 
                    padding: '1.5rem', 
                    marginBottom: '1rem', 
                    border: `1px solid ${currentTheme.inputBorder}` 
                  } 
                },
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '1rem' } },
                      img && React.createElement('img', { 
                        src: img, 
                        alt: item.symbol, 
                        style: { width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover', background: 'white' }, 
                        onError: (e) => { e.target.style.display = 'none'; } 
                      }),
                      React.createElement('div', {},
                        React.createElement('div', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '600' } }, item.symbol.toUpperCase()),
                        React.createElement('div', { style: { color: currentTheme.textSecondary, marginTop: '0.25rem' } }, `${t.amount}: ${item.amount} | ${t.bought}: ${fmtDate(item.purchaseDate)}`),
                        React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginTop: '0.25rem' } }, `${t.purchasePrice}: ${getCurrencySymbol()}${formatPrice(item.purchasePrice || 0)} → ${t.current}: ${getCurrencySymbol()}${formatPrice(curr)}`),
                        item.fees && parseFloat(item.fees) > 0 && React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginTop: '0.25rem' } }, `${t.fees}: ${getCurrencySymbol()}${formatPrice(parseFloat(item.fees))}`),
                        React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginTop: '0.25rem' } }, `${t.holdingPeriod}: ${daysSince} ${t.days}`)
                      )
                    ),
                    React.createElement('div', { style: { textAlign: 'right' } },
                      React.createElement('div', { style: { color: currentTheme.text, fontSize: '1.75rem', fontWeight: 'bold' } }, getCurrencySymbol() + formatPrice(val)),
                      React.createElement('div', { style: { color: currentTheme.textSecondary, marginTop: '0.25rem' } }, pct + '% ' + (t.ofPortfolio || 'des Portfolios')),
                      React.createElement('div', { style: { fontSize: '1.125rem', fontWeight: '600', color: prof >= 0 ? '#10b981' : '#ef4444', marginTop: '0.5rem' } }, (prof >= 0 ? '+' : '') + getCurrencySymbol() + formatPrice(Math.abs(prof))),
                      React.createElement('div', { style: { fontSize: '0.875rem', color: prof >= 0 ? '#86efac' : '#fca5a5' } }, `(${profPct >= 0 ? '+' : ''}${formatPrice(profPct)}%)`)
                    )
                  ),
                  // Progress bar showing portfolio percentage
                  React.createElement('div', { style: { background: currentTheme.inputBg, height: '8px', borderRadius: '4px', overflow: 'hidden' } },
                    React.createElement('div', { style: { background: prof >= 0 ? '#10b981' : '#ef4444', height: '100%', width: pct + '%', transition: 'width 0.3s' } })
                  )
                );
              })
          )


        ),
        
        // ========== RISK ANALYTICS VIEW ==========
        activeView === 'risk' && window.createRiskAnalyticsView && window.createRiskAnalyticsView({
          safe: safe,
          currentTheme: currentTheme,
          getCurrencySymbol: getCurrencySymbol,
          formatPrice: formatPrice,
          t: t,
          language: language
        }),
        
        // ========== CS2 ANALYTICS VIEW ==========
        activeView === 'cs2analytics' && window.createCS2AnalyticsView && window.createCS2AnalyticsView({
          safe: safe,
          prices: prices,
          currentTheme: currentTheme,
          getCurrencySymbol: getCurrencySymbol,
          formatPrice: formatPrice,
          t: t,
          language: language
        }),
        
        // ========== NEW v5.1: TRANSACTION HISTORY VIEW ==========
        React.createElement('div', { style: { display: activeView === 'transactions' ? 'block' : 'none' } },
          TransactionHistoryView()
        ),
        
        // ========== NEW v5.1: TAX REPORT VIEW ==========
        React.createElement('div', { style: { display: activeView === 'taxreports' ? 'block' : 'none' } },
          TaxReportView()
        ),
        
        // ========== NEW v5.1: REBALANCING VIEW ==========
        React.createElement('div', { style: { display: activeView === 'rebalancing' ? 'block' : 'none' } },
          RebalancingView()
        ),
        
        // ========== NEW: FINANCIAL OVERVIEW VIEW ==========
        // ========== CUSTOMIZABLE DASHBOARD VIEW ==========
// Replace the activeView === 'overview' section with this

activeView === 'overview' && React.createElement('div', {},
  // Dashboard Header with Edit Button
  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' } },
    React.createElement('h2', { style: { color: currentTheme.text, fontSize: '2rem', fontWeight: '700' } }, ' Mein Dashboard'),
    React.createElement('button', {
      onClick: () => setEditingDashboard(!editingDashboard),
      style: { 
        padding: '0.75rem 1.5rem', 
        background: editingDashboard ? '#ef4444' : '#3b82f6', 
        color: 'white', 
        border: 'none', 
        borderRadius: '0.5rem', 
        cursor: 'pointer', 
        fontWeight: '600',
        transition: 'all 0.2s'
      }
    }, editingDashboard ? ' Fertig' : ' Dashboard anpassen')
  ),
  
  // Edit Mode Info
  editingDashboard && React.createElement('div', { 
    style: { 
      background: '#dbeafe', 
      border: '1px solid #3b82f6', 
      borderRadius: '0.5rem', 
      padding: '1rem', 
      marginBottom: '2rem',
      color: '#1e40af'
    } 
  },
    React.createElement('strong', {}, ' Dashboard anpassen:'),
    ' Klicke auf ein Widget um es zu entfernen. Nutze die Buttons unten um Widgets hinzuzufügen.'
  ),
  
  // Dashboard Widgets Grid
  React.createElement('div', { 
    style: { 
      display: 'grid', 
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
      gap: '1.5rem', 
      marginBottom: '2rem' 
    } 
  },
    dashboardWidgets.map(widget => {
      const widgetData = {
        networth: {
          title: t.netWorth,
          value: getCurrencySymbol() + formatPrice(metrics.netWorth || 0),
          subtitle: getCurrencySymbol() + formatPrice((total || 0) + (metrics.totalCash || 0)) + ' - ' + getCurrencySymbol() + formatPrice(metrics.totalDebt || 0),
          gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)',
          icon: ''
        },
        savingsrate: {
          title: t.savingsRate,
          value: (metrics.savingsRate || 0).toFixed(1) + '%',
          subtitle: getCurrencySymbol() + formatPrice((metrics.monthlyIncome || 0) - (metrics.monthlyExpenses || 0) - (metrics.monthlyDebtPayments || 0)) + '/mo',
          gradient: 'linear-gradient(135deg, #10b981, #059669)',
          icon: ''
        },
        cashflow: {
          title: t.monthlyCashflow,
          value: getCurrencySymbol() + formatPrice((maerminMetrics.cashflow && maerminMetrics.cashflow.netCashflow) || 0),
          subtitle: maerminMetrics.cashflow ? (maerminMetrics.cashflow.netCashflow >= 0 ? t.positive : t.negative) : 'N/A',
          gradient: maerminMetrics.cashflow && maerminMetrics.cashflow.netCashflow >= 0 ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #ef4444, #dc2626)',
          icon: ''
        },
        cashrunway: {
          title: t.cashRunway,
          value: metrics.cashRunway > 999 ? '[INF]' : (metrics.cashRunway || 0).toFixed(1),
          subtitle: t.months,
          gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
          icon: '[CR]'
        },
        health: {
          title: t.financialHealth,
          value: healthScore.score + '/100',
          subtitle: healthScore.rating,
          gradient: 'linear-gradient(135deg, ' + healthScore.color + ', ' + healthScore.color + 'dd)',
          icon: ''
        },
        portfolio: {
          title: t.portfolioValue,
          value: getCurrencySymbol() + formatPrice(total || 0),
          subtitle: t.profit + ': ' + ((profit || 0) >= 0 ? '+' : '') + getCurrencySymbol() + formatPrice(profit || 0),
          gradient: profit >= 0 ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #ef4444, #dc2626)',
          icon: ''
        },
        income: {
          title: t.monthlyIncome,
          value: getCurrencySymbol() + formatPrice(metrics.monthlyIncome || 0),
          subtitle: (financialData.income || []).length + ' ' + t.sources,
          gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
          icon: ''
        },
        expenses: {
          title: t.monthlyExpenses,
          value: getCurrencySymbol() + formatPrice((metrics.monthlyExpenses || 0) + (metrics.monthlyDebtPayments || 0)),
          subtitle: 'Fixkosten + Variable',
          gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
          icon: ''
        },
        budgets: {
          title: t.activeBudgets,
          value: (financialData.budgets || []).filter(b => b.isActive).length,
          subtitle: maerminMetrics.budgetStatus && maerminMetrics.budgetStatus.totalBudgeted ? maerminMetrics.budgetStatus.totalBudgeted.toFixed(0) + '€ Budget' : t.noBudgets,
          gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
          icon: ''
        },
        taxes: {
          title: t.taxReserve,
          value: maerminMetrics.netIncome && maerminMetrics.netIncome.monthlyTax ? getCurrencySymbol() + formatPrice(maerminMetrics.netIncome.monthlyTax) : 'N/A',
          subtitle: maerminMetrics.netIncome && maerminMetrics.netIncome.effectiveRate ? maerminMetrics.netIncome.effectiveRate.toFixed(1) + '% ' + t.rate : t.noTaxes,
          gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
          icon: '[TX]'
        }
      };
      
      const data = widgetData[widget];
      if (!data) return null;
      
      return React.createElement('div', {
        key: widget,
        onClick: editingDashboard ? () => {
          if (confirm('Widget "' + data.title + '" vom Dashboard entfernen?')) {
            setDashboardWidgets(prev => prev.filter(w => w !== widget));
          }
        } : null,
        style: {
          background: data.gradient,
          borderRadius: '1rem',
          padding: '1.5rem',
          color: 'white',
          cursor: editingDashboard ? 'pointer' : 'default',
          transition: 'all 0.2s',
          border: editingDashboard ? '3px dashed rgba(255,255,255,0.5)' : 'none',
          transform: editingDashboard ? 'scale(0.98)' : 'scale(1)',
          position: 'relative'
        }
      },
        editingDashboard && React.createElement('div', {
          style: {
            position: 'absolute',
            top: '0.5rem',
            right: '0.5rem',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px'
          }
        }, 'X'),
        React.createElement('div', { style: { fontSize: '1.5rem', marginBottom: '0.5rem' } }, data.icon),
        React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.9 } }, data.title),
        React.createElement('div', { style: { fontSize: '2.5rem', fontWeight: 'bold', margin: '0.5rem 0' } }, data.value),
        React.createElement('div', { style: { fontSize: '0.875rem', opacity: 0.8 } }, data.subtitle)
      );
    })
  ),
  
  // Add Widget Buttons (only in edit mode)
  editingDashboard && React.createElement('div', { 
    style: { 
      background: currentTheme.card, 
      borderRadius: '1rem', 
      padding: '1.5rem',
      border: `1px solid ${currentTheme.cardBorder}`
    } 
  },
    React.createElement('h3', { style: { color: currentTheme.text, marginBottom: '1rem', fontSize: '1.25rem' } }, ' Widgets hinzufügen'),
    React.createElement('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' } },
      ['networth', 'savingsrate', 'cashflow', 'cashrunway', 'health', 'portfolio', 'income', 'expenses', 'budgets', 'taxes'].map(widgetId => {
        const isAdded = dashboardWidgets.includes(widgetId);
        const labels = {
          networth: ' ' + t.netWorth,
          savingsrate: ' ' + t.savingsRate,
          cashflow: ' ' + t.cashflow,
          cashrunway: '[CR] ' + t.cashRunway,
          health: ' ' + t.financialHealth,
          portfolio: ' ' + t.portfolio,
          income: ' ' + t.income,
          expenses: ' ' + t.expenses,
          budgets: ' ' + t.budgets,
          taxes: '[TX] ' + t.taxes
        };
        
        return React.createElement('button', {
          key: widgetId,
          onClick: () => {
            if (!isAdded) {
              setDashboardWidgets(prev => [...prev, widgetId]);
            }
          },
          disabled: isAdded,
          style: {
            padding: '0.75rem 1.25rem',
            background: isAdded ? currentTheme.inputBg : '#3b82f6',
            color: isAdded ? currentTheme.textSecondary : 'white',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: isAdded ? 'not-allowed' : 'pointer',
            fontWeight: '600',
            opacity: isAdded ? 0.5 : 1
          }
        }, labels[widgetId] + (isAdded ? ' ' : ''));
      })
    )
  )
),

        // ========== NEW: INSIGHTS VIEW ==========
        
        // ========== MAERMIN: CASHFLOW VIEW ==========
        
        // ========== MAERMIN: TAX VIEW ==========
        
        // ========== MAERMIN: BUDGET VIEW ==========
      )
        )
      )
    )
  );
}

// Render the application
ReactDOM.render(React.createElement(InvestmentTracker), document.getElementById('root'));