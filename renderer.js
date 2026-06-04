// ============================================================================
// MAERMIN v9.0 - Main Application
// Professional Multi-Asset Portfolio Tracker with Advanced Investment Analytics
// ============================================================================

(function() {
'use strict';

// Use React hooks
const { useState, useEffect, useMemo, useCallback, useRef } = React;

// Get translations
const translations = typeof window.completeTranslations !== 'undefined' ? window.completeTranslations : { en: {} };

// Theme configuration
// ── Design system ───────────────────────────────────────────────────────────
// Modern dark-fintech look with a consistent warm-gold accent across all themes.
// Every component reads `currentTheme.*` as inline styles, so these tokens drive
// the entire UI. Extra tokens (accentText, accentSoft, surface2, shadow, …) are
// additive — existing call sites keep working, new/redesigned ones use them.
const GOLD = '#f5a524';        // primary accent (gold) — sits on dark surfaces
const GOLD_DARK = '#c2790a';   // deeper gold for light backgrounds / hovers
const INK = '#13110a';         // near-black ink used as text ON gold buttons

const themes = {
  dark: {
    background: 'radial-gradient(1100px 620px at 50% -12%, #161d2b 0%, #0b1018 52%, #080b11 100%)',
    card: '#10151f',
    surface2: '#161c28',
    cardBorder: 'rgba(255,255,255,0.07)',
    modalBg: '#141a25',
    modalBorder: 'rgba(255,255,255,0.10)',
    text: '#e9edf4',
    textSecondary: '#8b94a7',
    inputBg: '#0c1018',
    inputBorder: 'rgba(255,255,255,0.10)',
    accent: GOLD,
    accentText: INK,
    accentSoft: 'rgba(245,165,36,0.12)',
    shadow: '0 18px 40px -16px rgba(0,0,0,0.65)',
    success: '#34d399',
    danger: '#f87171',
    warning: '#fb923c'
  },
  white: {
    background: 'radial-gradient(1100px 620px at 50% -12%, #ffffff 0%, #f4f6f9 60%, #eef1f5 100%)',
    card: '#ffffff',
    surface2: '#f6f8fb',
    cardBorder: 'rgba(15,23,42,0.09)',
    modalBg: '#ffffff',
    modalBorder: 'rgba(15,23,42,0.10)',
    text: '#0f172a',
    textSecondary: '#5b6473',
    inputBg: '#f1f4f8',
    inputBorder: 'rgba(15,23,42,0.12)',
    accent: GOLD_DARK,
    accentText: '#ffffff',
    accentSoft: 'rgba(194,121,10,0.12)',
    shadow: '0 18px 40px -18px rgba(15,23,42,0.22)',
    success: '#16a34a',
    danger: '#dc2626',
    warning: '#d97706'
  },
  purple: {
    background: 'radial-gradient(1100px 620px at 50% -12%, #1f1234 0%, #140a23 56%, #0d0717 100%)',
    card: '#1a1029',
    surface2: '#211633',
    cardBorder: 'rgba(255,255,255,0.09)',
    modalBg: '#1d1330',
    modalBorder: 'rgba(255,255,255,0.13)',
    text: '#f3eefb',
    textSecondary: '#a99cc0',
    inputBg: '#140b22',
    inputBorder: 'rgba(255,255,255,0.11)',
    accent: GOLD,
    accentText: INK,
    accentSoft: 'rgba(245,165,36,0.13)',
    shadow: '0 18px 40px -16px rgba(0,0,0,0.6)',
    success: '#34d399',
    danger: '#f87171',
    warning: '#fb923c'
  }
};

// ============================================================================
// PASSWORD CHANGE MODAL
// ============================================================================
function PasswordModal({ theme, t, onClose, addToast }) {
  const [curPw, setCurPw]   = useState('');
  const [newPw, setNewPw]   = useState('');
  const [confPw, setConfPw] = useState('');
  const [busy, setBusy]     = useState(false);

  const handleChange = async () => {
    if (!curPw || !newPw || !confPw) return;
    if (newPw !== confPw) { addToast(t.passwordMismatch || 'Passwords do not match', 'error'); return; }
    if (newPw.length < 6)  { addToast('Password must be at least 6 characters', 'warning'); return; }
    setBusy(true);
    try {
      const hashStr = async s => {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
      };
      const curHash  = await hashStr(curPw);
      const newHash  = await hashStr(newPw);

      // Read current hash from auth.js at runtime via MaerminAuth
      const session = sessionStorage.getItem('maermin_auth_session');
      const stored  = session ? JSON.parse(session).hash : null;
      if (!stored || curHash !== stored) {
        addToast(t.passwordWrong || 'Current password is incorrect', 'error');
        setBusy(false); return;
      }
      // Store new hash in sessionStorage so next reload uses new hash
      // NOTE: this only lasts until the user updates auth.js
      // We show them the new hash to copy
      sessionStorage.setItem('maermin_auth_session', JSON.stringify({ hash: newHash, expires: Date.now() + 8*60*60*1000 }));
      addToast(t.passwordChanged || 'Password changed for this session! Copy the hash below to auth.js to make it permanent.', 'success');
      setCurPw(''); setNewPw(''); setConfPw('');

      // Show the new hash in a copyable field
      const display = document.createElement('div');
      display.style.cssText = 'position:fixed;bottom:5rem;right:1.5rem;background:#141a25;border:1px solid rgba(255,255,255,0.10);border-radius:14px;padding:1rem 1.25rem;z-index:99999;max-width:420px;color:#e9edf4;font-size:0.8rem;box-shadow:0 24px 60px -18px rgba(0,0,0,0.75)';
      display.innerHTML = `<div style="font-weight:700;margin-bottom:0.5rem">New hash — copy to auth.js:</div><input readonly value="${newHash}" onclick="this.select()" style="width:100%;background:#0c1018;border:1px solid rgba(255,255,255,0.10);border-radius:8px;padding:0.5rem;color:#f5a524;font-family:ui-monospace,monospace;font-size:0.75rem"><div style="color:#8b94a7;margin-top:0.5rem;font-size:0.7rem">Replace MAERMIN_SECRET_HASH in auth.js with this value</div><button onclick="this.parentElement.remove()" style="margin-top:0.5rem;background:none;border:1px solid rgba(255,255,255,0.10);border-radius:7px;color:#8b94a7;cursor:pointer;padding:0.25rem 0.6rem;font-size:0.75rem">✕ Close</button>`;
      document.body.appendChild(display);
      setTimeout(() => display.remove(), 60000);
    } catch(e) { console.error(e); }
    setBusy(false);
  };

  const inp = (value, onChange, placeholder, type='password') =>
    React.createElement('input', {
      type, value, onChange: e => onChange(e.target.value), placeholder,
      onKeyDown: e => e.key === 'Enter' && handleChange(),
      style: {
        width: '100%', padding: '0.75rem', marginBottom: '0.75rem',
        background: theme.inputBg, border: `1px solid ${theme.inputBorder}`,
        borderRadius: '8px', color: theme.text, fontSize: '0.875rem'
      }
    });

  return React.createElement('div', {
    onClick: e => e.target === e.currentTarget && onClose(),
    style: { position:'fixed',inset:0,background:'rgba(4,6,10,0.62)',display:'flex',justifyContent:'center',alignItems:'center',zIndex:10001,backdropFilter:'blur(8px)' }
  },
    React.createElement('div', {
      style: { background: theme.modalBg, border:`1px solid ${theme.modalBorder}`, borderRadius:'16px', padding:'2rem', width:'380px', maxWidth:'90vw', boxShadow:'0 25px 50px -12px rgba(0,0,0,0.5)' }
    },
      React.createElement('h2', { style:{ color:theme.text, fontSize:'1.25rem', fontWeight:'700', marginBottom:'1.25rem' } },
        (t.changePassword || 'Change Password')
      ),
      inp(curPw,  setCurPw,  t.currentPassword || 'Current Password'),
      inp(newPw,  setNewPw,  t.newPassword     || 'New Password'),
      inp(confPw, setConfPw, t.confirmPassword || 'Confirm Password'),
      React.createElement('div', { style:{ display:'flex', gap:'0.75rem', marginTop:'0.25rem' } },
        React.createElement('button', {
          onClick: onClose,
          style:{ flex:1, padding:'0.75rem', background:theme.inputBg, color:theme.text, border:`1px solid ${theme.cardBorder}`, borderRadius:'8px', cursor:'pointer' }
        }, t.cancel || 'Cancel'),
        React.createElement('button', {
          onClick: handleChange, disabled: busy || !curPw || !newPw || !confPw,
          style:{ flex:1, padding:'0.75rem', background: busy ? theme.inputBg : theme.accent, color:'#fff', border:'none', borderRadius:'8px', cursor: busy ? 'not-allowed' : 'pointer', fontWeight:'600' }
        }, busy ? '...' : (t.changePassword || 'Change Password'))
      )
    )
  );
}

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

function InvestmentTracker() {
  // ========== STATE MANAGEMENT ==========
  
  // Multi-Portfolio
  const portfolioHook = window.MaerminFeatures4 ? window.MaerminFeatures4.usePortfolios() : null;
  const portfolios       = portfolioHook?.portfolios       || [{ id: 'default', name: 'Main Portfolio', color: '#f5a524' }];
  const activePortfolioId = portfolioHook?.activePortfolioId || 'default';
  const setActivePortfolioId = portfolioHook?.setActivePortfolioId || (() => {});

  // Transactions - the source of truth for portfolio
  const [transactions, setTransactions] = useState(() => {
    const saved = localStorage.getItem('transactions');
    return saved ? JSON.parse(saved) : [];
  });
  
  // Prices
  const [prices, setPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  
  // Currency and exchange rate - needed for portfolio calculation
  const [currency, setCurrency] = useState('EUR');
  // Exchange rate: USD->EUR (how many EUR for 1 USD). EUR is stronger, so ~0.91
  const [exchangeRate, setExchangeRate] = useState(0.91);
  
  // Transactions filtered to the active portfolio
  const activeTransactions = useMemo(() =>
    transactions.filter(tx => (tx.portfolioId || 'default') === activePortfolioId),
  [transactions, activePortfolioId]);

  // Portfolio derived from transactions
  const portfolio = useMemo(() => {
    const result = { crypto: [], stocks: [], skins: [], commodities: [] };
    const positionMap = {};
    
    activeTransactions.forEach(tx => {
      const category = tx.category || 'crypto';
      const symbol = (tx.symbol || '').toLowerCase();
      const key = `${category}-${symbol}`;
      
      if (!positionMap[key]) {
        positionMap[key] = {
          symbol: tx.symbol,           // exact YF symbol or CoinGecko ID from SymbolPicker
          symbolName: tx.symbolName || '',  // human-readable name e.g. "Apple Inc."
          symbolLogoUrl: tx.symbolLogoUrl || '', // logo URL
          amount: 0,
          totalCostEUR: 0,
          purchaseDate: tx.date,
          category: category
        };
      }
      // Update name/logo if a later transaction has it (picker was used)
      if (!positionMap[key].symbolName && tx.symbolName) positionMap[key].symbolName = tx.symbolName;
      if (!positionMap[key].symbolLogoUrl && tx.symbolLogoUrl) positionMap[key].symbolLogoUrl = tx.symbolLogoUrl;
      
      // Get price in EUR - convert if transaction was in USD
      let priceEUR = parseFloat(tx.price) || 0;
      if (tx.currency === 'USD' && exchangeRate > 0) {
        priceEUR = priceEUR * exchangeRate;
      }
      
      if (tx.type === 'buy') {
        const qty = parseFloat(tx.quantity) || 0;
        positionMap[key].amount += qty;
        positionMap[key].totalCostEUR += qty * priceEUR;
      } else if (tx.type === 'sell') {
        const qty = parseFloat(tx.quantity) || 0;
        const currentAmount = positionMap[key].amount;
        if (currentAmount > 0) {
          // Reduce cost basis proportionally: sell removes (qty/total) fraction of cost
          const fraction = Math.min(qty, currentAmount) / currentAmount;
          positionMap[key].totalCostEUR -= positionMap[key].totalCostEUR * fraction;
        }
        positionMap[key].amount = Math.max(0, currentAmount - qty);
      }
    });
    
    // Convert map to arrays
    Object.values(positionMap).forEach(pos => {
      if (pos.amount > 0.0001) {
        const avgPriceEUR = pos.totalCostEUR / pos.amount;
        result[pos.category].push({
          id: `${pos.category}-${pos.symbol}`,
          symbol: pos.symbol,
          symbolName: pos.symbolName,
          symbolLogoUrl: pos.symbolLogoUrl,
          name: pos.symbolName || pos.symbol,
          amount: pos.amount,
          purchasePrice: avgPriceEUR,
          purchaseDate: pos.purchaseDate
        });
      }
    });
    
    return result;
  }, [activeTransactions, exchangeRate]);
  
  // UI State
  const [activeTab, setActiveTab] = useState('crypto');
  const [activeView, setActiveView] = useState('overview');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const language = 'en';
  
  // v6.0 State
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [toasts, setToasts] = useState([]);
  
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
    currency: 'EUR', // Track which currency the transaction was added in
    targetPortfolioId: 'default',
  });
  const [showTransactionModal, setShowTransactionModal] = useState(false);
  const [overviewMode, setOverviewMode] = useState('all'); // 'all' | activePortfolioId
  const [editingTransactionId, setEditingTransactionId] = useState(null); // null = adding new, id = editing
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState('');
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [apiKeys, setApiKeys] = useState(() => {
    try { return JSON.parse(localStorage.getItem('apiKeys') || '{}'); } catch { return {}; }
  });
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Transactions filter/search
  const [txSearch, setTxSearch] = useState('');
  const [txSortBy, setTxSortBy] = useState('date-desc'); // date-desc, date-asc, amount-desc, symbol
  const [txDeleteConfirm, setTxDeleteConfirm] = useState(null); // txId waiting for confirm
  
  // Tax
  const [taxJurisdiction, setTaxJurisdiction] = useState(() => {
    return localStorage.getItem('taxJurisdiction') || 'de';
  });

  // Privacy mode — masks all monetary amounts (for screenshots / public viewing)
  const [privacyMode, setPrivacyMode] = useState(() => localStorage.getItem('privacyMode') === '1');

  // ========== COMPUTED VALUES ==========
  
  const t = translations.en || {};
  const currentTheme = themes[theme];
  
  const formatPrice = useCallback((price) => {
    // Privacy mode masks every amount app-wide (formatPrice is the single
    // formatter every view uses), without touching the underlying data.
    if (privacyMode) return '••••••';
    if (price === undefined || price === null || isNaN(price)) return '0.00';
    // All prices are stored in EUR
    // If user wants USD, convert from EUR to USD by dividing by the USD->EUR rate
    const converted = currency === 'USD' && exchangeRate > 0 ? price / exchangeRate : price;
    return converted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }, [currency, exchangeRate, privacyMode]);

  const getCurrencySymbol = () => currency === 'EUR' ? 'EUR' : 'USD';

  // Category display names
  const getCategoryDisplayName = (category) => {
    const displayNames = { crypto: t.crypto || 'Crypto', stocks: t.stocks || 'Stocks', skins: t.cs2Skins || 'CS2 Skins', commodities: 'Commodities' };
    return displayNames[category] || category;
  };

  // Calculate portfolio totals
  const portfolioStats = useMemo(() => {
    let totalValue = 0;
    let totalInvested = 0;
    let totalPositions = 0;

    ['crypto', 'stocks', 'skins', 'commodities'].forEach(category => {
      const positions = portfolio[category] || [];
      positions.forEach(pos => {
        const symbolOriginal = pos.symbol || pos.name || '';
        const symbolLower = symbolOriginal.toLowerCase();
        const symbolUpper = symbolOriginal.toUpperCase();
        const currentPrice = prices[symbolOriginal] || prices[symbolLower] || prices[symbolUpper] || pos.purchasePrice || 0;
        const value    = (pos.amount || 0) * currentPrice;
        const invested = (pos.amount || 0) * (pos.purchasePrice || 0);
        
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

  // ALL portfolios combined portfolio object — used on Overview in "All" mode
  const allPortfoliosPortfolio = useMemo(() => {
    const result = { crypto: [], stocks: [], skins: [], commodities: [] };
    const posMap = {};
    transactions.forEach(tx => {
      const category = tx.category || 'crypto';
      const key = `${category}-${(tx.symbol || '').toLowerCase()}`;
      if (!posMap[key]) posMap[key] = { symbol: tx.symbol, symbolName: tx.symbolName || '', symbolLogoUrl: tx.symbolLogoUrl || '', amount: 0, totalCostEUR: 0, purchaseDate: tx.date, category };
      if (!posMap[key].symbolName && tx.symbolName) posMap[key].symbolName = tx.symbolName;
      let priceEUR = parseFloat(tx.price) || 0;
      if (tx.currency === 'USD' && exchangeRate > 0) priceEUR *= exchangeRate;
      if (tx.type === 'buy') {
        posMap[key].amount += parseFloat(tx.quantity) || 0;
        posMap[key].totalCostEUR += (parseFloat(tx.quantity) || 0) * priceEUR;
      } else if (tx.type === 'sell') {
        const frac = posMap[key].amount > 0 ? Math.min(parseFloat(tx.quantity) || 0, posMap[key].amount) / posMap[key].amount : 0;
        posMap[key].totalCostEUR *= (1 - frac);
        posMap[key].amount = Math.max(0, posMap[key].amount - (parseFloat(tx.quantity) || 0));
      }
    });
    Object.values(posMap).forEach(pos => {
      if (pos.amount > 0.0001) result[pos.category].push({
        ...pos, id: `${pos.category}-${pos.symbol}`,
        name: pos.symbolName || pos.symbol,
        purchasePrice: pos.amount > 0 ? pos.totalCostEUR / pos.amount : 0
      });
    });
    return result;
  }, [transactions, exchangeRate]);

  // ALL portfolios combined — used on Overview to show total wealth across portfolios
  const allPortfoliosStats = useMemo(() => {
    const posMap = {};
    transactions.forEach(tx => {
      const category = tx.category || 'crypto';
      const key = `${category}-${(tx.symbol || '').toLowerCase()}`;
      if (!posMap[key]) posMap[key] = { symbol: tx.symbol, category, amount: 0, totalCostEUR: 0 };
      const qty = parseFloat(tx.quantity) || 0;
      let priceEUR = parseFloat(tx.price) || 0;
      if (tx.currency === 'USD' && exchangeRate > 0) priceEUR *= exchangeRate;
      if (tx.type === 'buy') {
        posMap[key].amount += qty;
        posMap[key].totalCostEUR += qty * priceEUR;
      } else if (tx.type === 'sell') {
        const frac = posMap[key].amount > 0 ? Math.min(qty, posMap[key].amount) / posMap[key].amount : 0;
        posMap[key].totalCostEUR *= (1 - frac);
        posMap[key].amount = Math.max(0, posMap[key].amount - qty);
      }
    });
    let totalValue = 0, totalInvested = 0, totalPositions = 0;
    Object.values(posMap).forEach(pos => {
      if (pos.amount <= 0.0001) return;
      const sym = pos.symbol || '';
      const pr  = prices[sym] || prices[sym.toLowerCase()] || prices[sym.toUpperCase()] || 0;
      totalValue    += pos.amount * pr;
      totalInvested += pos.totalCostEUR;
      totalPositions++;
    });
    return {
      totalValue,
      totalInvested,
      totalProfit: totalValue - totalInvested,
      totalProfitPercent: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
      totalPositions,
      portfolioCount: portfolios.length,
    };
  }, [transactions, prices, exchangeRate, portfolios]);

  // ========== COMMANDS FOR PALETTE ==========
  
  const commands = useMemo(() => [
    // Portfolio
    { id: 'nav:overview',      label: t.overview || 'Overview',            category: 'Portfolio',  shortcut: 'g o' },
    { id: 'nav:transactions',  label: t.transactions || 'Transactions',    category: 'Portfolio',  shortcut: 'g t' },
    { id: 'nav:dividends',     label: t.dividendCalendar || 'Dividends',   category: 'Portfolio',  shortcut: 'g d' },
    { id: 'nav:journal',       label: t.tradeJournal || 'Journal',         category: 'Portfolio',  shortcut: 'g j' },
    // Analysis
    { id: 'nav:returns',       label: t.returns || 'Returns & XIRR',       category: 'Analysis',   shortcut: 'g r' },
    { id: 'nav:rebalancing',   label: t.rebalancing || 'Rebalancing',      category: 'Analysis',   shortcut: 'g b' },
    { id: 'nav:analytics',     label: t.analytics || 'Portfolio Analysis', category: 'Analysis',   shortcut: 'g a' },
    { id: 'nav:taxes',         label: t.taxes || 'Taxes',                  category: 'Analysis',   shortcut: 'g x' },
    // Tools
    { id: 'nav:watchlist',     label: t.watchlist || 'Watchlist',          category: 'Tools',      shortcut: 'g w' },
    { id: 'nav:alerts',        label: t.priceAlerts || 'Price Alerts',     category: 'Tools',      shortcut: 'g l' },
    { id: 'nav:broker-import', label: t.brokerImport || 'Broker Import',   category: 'Tools',      shortcut: 'g m' },
    // Actions
    { id: 'action:add',        label: t.addTransaction || 'Add Transaction', category: 'Actions',  shortcut: 'n' },
    { id: 'action:refresh',    label: t.refresh || 'Refresh prices',       category: 'Actions',    shortcut: 'r' },
    { id: 'action:backup',     label: t.createBackup || 'Create Backup',   category: 'Actions',    shortcut: 'b' },
    { id: 'action:import',     label: t.importData || 'Import Data',       category: 'Actions',    shortcut: 'i' },
    { id: 'action:privacy',    label: t.privacyMode || 'Hide amounts (Privacy)', category: 'Actions', shortcut: 'p' },
    // Settings
    { id: 'settings:dark',     label: t.darkMode || 'Dark Mode',           category: 'Design' },
    { id: 'settings:light',    label: t.whiteMode || 'Light Mode',         category: 'Design' },
    { id: 'settings:purple',   label: t.purpleMode || 'Purple Mode',       category: 'Design' },
    { id: 'help:shortcuts',    label: t.keyboardShortcuts || 'Keyboard Shortcuts', category: 'Help', shortcut: '?' },
  ], [t]);

  // ========== COMMAND EXECUTION (moved below function definitions) ==========

  // ========== KEYBOARD SHORTCUTS ==========
  
  // Ref for settings dropdown close-on-outside-click
  const settingsRef = useRef(null);

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
      
      // Escape closes modals & dropdowns
      if (e.key === 'Escape') {
        setShowCommandPalette(false);
        setShowShortcuts(false);
        setShowTransactionModal(false);
        setShowImportModal(false);
        setShowApiSettings(false);
        setShowSettings(false);
        setShowPasswordModal(false);
        return;
      }
      
      // ? shows shortcuts
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        setShowShortcuts(true);
        return;
      }
    };

    const handleClickOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettings(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // ========== DATA PERSISTENCE ==========
  
  useEffect(() => {
    const saved = (key) => localStorage.getItem(key);
    if (saved('theme')) setTheme(saved('theme'));
    if (saved('currency')) setCurrency(saved('currency'));
    if (saved('apiKeys')) setApiKeys(JSON.parse(saved('apiKeys')));
    if (saved('priceHistory')) setPriceHistory(JSON.parse(saved('priceHistory')));
  }, []);

  useEffect(() => { localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('currency', currency); }, [currency]);
  useEffect(() => { localStorage.setItem('transactions', JSON.stringify(transactions)); }, [transactions]);
  useEffect(() => { localStorage.setItem('priceHistory', JSON.stringify(priceHistory)); }, [priceHistory]);
  useEffect(() => { localStorage.setItem('taxJurisdiction', taxJurisdiction); }, [taxJurisdiction]);
  useEffect(() => { localStorage.setItem('privacyMode', privacyMode ? '1' : '0'); }, [privacyMode]);
  useEffect(() => { localStorage.setItem('apiKeys', JSON.stringify(apiKeys)); }, [apiKeys]);

  // ========== API FUNCTIONS ==========
  
  const fetchPrices = async () => {
    setLoading(true);
    const newPrices = { ...prices };
    const timestamp = new Date().toLocaleString('en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    
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
      
      // ── Stock Prices: Yahoo Finance (primary) → Alpha Vantage (fallback) ──
      if (portfolio.stocks && portfolio.stocks.length > 0) {
        const workerBase = (apiKeys.cs2Worker || '').trim().replace(/\/$/, '');
        const hasWorker  = workerBase.length > 5;

        for (const stock of portfolio.stocks.slice(0, 10)) {
          // Use the exact symbol stored from SymbolPicker — already correct YF format
          // e.g. "SIX2.DE", "NVO", "AAPL", "SHEL.L"
          const sym    = (stock.symbol || stock.name || '').toUpperCase();
          const symL   = sym.toLowerCase();
          let   priceEUR = null;

          // ── Primary: Yahoo Finance via Worker ────────────────────────────
          if (hasWorker) {
            try {
              // If symbol already has exchange suffix (.DE, .L etc.) use directly
              // Otherwise apply known mappings for legacy symbols without suffix
              const LEGACY_MAP = {
                'SIX2':'SIX2.DE','SIE':'SIE.DE','SAP':'SAP.DE','BMW':'BMW.DE',
                'VOW3':'VOW3.DE','BAS':'BAS.DE','ALV':'ALV.DE','DTE':'DTE.DE',
                'DBK':'DBK.DE','ADS':'ADS.DE','RWE':'RWE.DE','MRK':'MRK.DE',
                'NVO':'NVO','SHEL':'SHEL.L','AZN':'AZN.L','BP':'BP.L',
                'LVMH':'MC.PA','TTE':'TTE.PA','AIR':'AIR.PA',
                'ASML':'ASML.AS','ING':'INGA.AS',
              };
              // If symbol already contains a dot (has exchange suffix) use as-is
              const yfSym = sym.includes('.') ? sym : (LEGACY_MAP[sym] || sym);
              const url   = `${workerBase}?action=yf&symbol=${encodeURIComponent(yfSym)}&interval=1d&range=5d`;
              const res   = await fetch(url, { signal: AbortSignal.timeout(8000) });
              if (res.ok) {
                const data = await res.json();
                const last = data.prices?.[data.prices.length - 1];
                if (last?.price > 0) {
                  const rate = data.currency === 'EUR' ? 1 : usdToEur;
                  priceEUR = last.price * rate;
                  console.log('[PRICES] Stock (YF):', yfSym, '→', priceEUR.toFixed(2), 'EUR');
                }
              }
              // If bare symbol failed, try .DE suffix automatically
              if (!priceEUR && !sym.includes('.') && !YF_MAP[sym]) {
                for (const suffix of ['.DE','.L','.PA','.AS','.ST','.CO']) {
                  try {
                    const url2  = `${workerBase}?action=yf&symbol=${encodeURIComponent(sym+suffix)}&interval=1d&range=5d`;
                    const res2  = await fetch(url2, { signal: AbortSignal.timeout(6000) });
                    if (!res2.ok) continue;
                    const data2 = await res2.json();
                    const last2 = data2.prices?.[data2.prices.length - 1];
                    if (last2?.price > 0) {
                      const rate2 = data2.currency === 'EUR' ? 1 : usdToEur;
                      priceEUR = last2.price * rate2;
                      console.log('[PRICES] Stock (YF auto-suffix):', sym, '→', sym+suffix, '→', priceEUR.toFixed(2), 'EUR');
                      break;
                    }
                  } catch { /* try next suffix */ }
                }
              }
            } catch(e) {
              console.warn('[PRICES] YF stock failed for', sym, '—', e.message);
            }
          }

          // ── Fallback: Alpha Vantage ───────────────────────────────────────
          if (!priceEUR && apiKeys.alphaVantage) {
            try {
              console.log('[PRICES] Stock AV fallback:', sym);
              const res  = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${apiKeys.alphaVantage}`);
              const data = await res.json();
              if (data['Global Quote']?.['05. price']) {
                priceEUR = parseFloat(data['Global Quote']['05. price']) * usdToEur;
                console.log('[PRICES] Stock (AV fallback):', sym, '→', priceEUR.toFixed(2), 'EUR');
              } else if (data['Note'] || data['Information']) {
                console.warn('[PRICES] Alpha Vantage rate limit hit for', sym);
                addToast('Alpha Vantage: Rate limit reached', 'warning');
              }
              await new Promise(r => setTimeout(r, 12000)); // AV rate limit
            } catch(e) {
              console.warn('[PRICES] AV stock fallback error for', sym, e.message);
            }
          }

          if (priceEUR && priceEUR > 0) {
            newPrices[symL] = priceEUR;
            newPrices[sym]  = priceEUR;
          }
        }
      }

      // ── Commodity Prices: Yahoo Finance (primary) → Alpha Vantage (fallback) ──
      if (portfolio.commodities && portfolio.commodities.length > 0) {
        const workerBase = (apiKeys.cs2Worker || '').trim().replace(/\/$/, '');
        const hasWorker  = workerBase.length > 5;

        // Yahoo Finance Futures symbols for commodities
        const YF_COMMODITY = {
          'GOLD':'GC=F','XAU':'GC=F','SILVER':'SI=F','XAG':'SI=F',
          'OIL':'CL=F','WTI':'CL=F','BRENT':'BZ=F',
          'GAS':'NG=F','NATURAL_GAS':'NG=F',
          'COPPER':'HG=F','PLATINUM':'PL=F','XPT':'PL=F',
          'PALLADIUM':'PA=F','XPD':'PA=F','WHEAT':'ZW=F','CORN':'ZC=F',
        };

        // Alpha Vantage commodity config (fallback only)
        const AV_COMMODITY = {
          'XAU':{ fn:'CURRENCY_EXCHANGE_RATE', from:'XAU' },
          'GOLD':{ fn:'CURRENCY_EXCHANGE_RATE', from:'XAU' },
          'XAG':{ fn:'CURRENCY_EXCHANGE_RATE', from:'XAG' },
          'SILVER':{ fn:'CURRENCY_EXCHANGE_RATE', from:'XAG' },
          'XPT':{ fn:'CURRENCY_EXCHANGE_RATE', from:'XPT' },
          'PLATINUM':{ fn:'CURRENCY_EXCHANGE_RATE', from:'XPT' },
          'XPD':{ fn:'CURRENCY_EXCHANGE_RATE', from:'XPD' },
          'PALLADIUM':{ fn:'CURRENCY_EXCHANGE_RATE', from:'XPD' },
          'WTI':{ fn:'WTI' },'OIL':{ fn:'WTI' },
          'BRENT':{ fn:'BRENT' },'GAS':{ fn:'NATURAL_GAS' },
          'NATURAL_GAS':{ fn:'NATURAL_GAS' },'COPPER':{ fn:'COPPER' },
          'WHEAT':{ fn:'WHEAT' },'CORN':{ fn:'CORN' },
        };

        for (const pos of portfolio.commodities.slice(0, 8)) {
          const sym  = (pos.symbol || pos.name || '').toUpperCase().trim();
          const symL = sym.toLowerCase();
          let   priceEUR = null;

          // ── Primary: Yahoo Finance Futures via Worker ──────────────────
          if (hasWorker) {
            const yfSym = YF_COMMODITY[sym] || sym;
            try {
              const url  = `${workerBase}?action=yf&symbol=${encodeURIComponent(yfSym)}&interval=1d&range=5d`;
              const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
              if (res.ok) {
                const data = await res.json();
                const last = data.prices?.[data.prices.length - 1];
                if (last?.price > 0) {
                  const rate = data.currency === 'EUR' ? 1 : usdToEur;
                  priceEUR = last.price * rate;
                  console.log('[PRICES] Commodity (YF):', sym, '→', yfSym, '→', priceEUR.toFixed(2), 'EUR');
                }
              }
            } catch(e) {
              console.warn('[PRICES] YF commodity failed for', sym, '—', e.message);
            }
          }

          // ── Fallback: Alpha Vantage ──────────────────────────────────────
          if (!priceEUR && apiKeys.alphaVantage) {
            const avConf = AV_COMMODITY[sym];
            try {
              let priceUSD = null;
              if (avConf?.fn === 'CURRENCY_EXCHANGE_RATE') {
                const res  = await fetch(`https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${avConf.from}&to_currency=USD&apikey=${apiKeys.alphaVantage}`);
                const data = await res.json();
                const rate = data['Realtime Currency Exchange Rate'];
                if (rate?.['5. Exchange Rate']) priceUSD = parseFloat(rate['5. Exchange Rate']);
              } else if (avConf) {
                const res  = await fetch(`https://www.alphavantage.co/query?function=${avConf.fn}&interval=monthly&apikey=${apiKeys.alphaVantage}`);
                const data = await res.json();
                if (data.data?.[0]?.value) priceUSD = parseFloat(data.data[0].value);
              } else {
                // Unknown commodity — try GLOBAL_QUOTE (ETF like GLD, SLV)
                const res  = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${apiKeys.alphaVantage}`);
                const data = await res.json();
                if (data['Global Quote']?.['05. price']) priceUSD = parseFloat(data['Global Quote']['05. price']);
              }
              if (priceUSD && priceUSD > 0) {
                priceEUR = priceUSD * usdToEur;
                console.log('[PRICES] Commodity (AV fallback):', sym, '→', priceEUR.toFixed(2), 'EUR');
              }
              await new Promise(r => setTimeout(r, 12000));
            } catch(e) {
              console.warn('[PRICES] AV commodity fallback error for', sym, e.message);
            }
          }

          if (priceEUR && priceEUR > 0) {
            newPrices[sym]  = priceEUR;
            newPrices[symL] = priceEUR;
          }
        }
      }


      // Worker fetches Steam Market price per skin server-side (bypasses CORS).
      // Sends POST with array of skin names → receives {name: price} map.
      if (portfolio.skins && portfolio.skins.length > 0) {
        const rawWorkerUrl = (apiKeys.cs2Worker || '').trim();
        const workerUrl = rawWorkerUrl
          ? (rawWorkerUrl.startsWith('https://') ? rawWorkerUrl : 'https://' + rawWorkerUrl)
          : null;

        if (!workerUrl) {
          console.warn('[PRICES] No CS2 Worker URL — add it in ⚙ API Settings');
          addToast('CS2: add your Worker URL in ⚙ API Settings', 'warning');
        } else {
          try {
            const skinNames = portfolio.skins.map(s => (s.symbol || s.name || '').trim()).filter(Boolean);
            console.log('[PRICES] CS2 Steam: fetching', skinNames.length, 'skins via Worker...');

            // POST array of names — Worker fetches Steam price per skin
            const res = await fetch(workerUrl.replace(/\/$/, ''), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(skinNames),
              signal: AbortSignal.timeout(60000) // Steam needs ~1.5s per skin
            });

            if (res.ok) {
              const priceMap = await res.json(); // { "AK-47 | Redline (FT)": 12.34, ... }
              let matchedCount = 0;

              skinNames.forEach(skinName => {
                const priceUSD = priceMap[skinName];
                if (priceUSD && priceUSD > 0) {
                  // Skins are delivered in USD → convert to the canonical EUR at
                  // full precision (display rounds later). All downstream calcs
                  // (Net Worth, Allocation, Performance, Showcase) read this map.
                  const priceEUR = window.MaerminUtils.toEUR(priceUSD, 'USD', usdToEur);
                  newPrices[skinName.toLowerCase()] = priceEUR;
                  newPrices[skinName] = priceEUR;
                  matchedCount++;
                  console.log('[PRICES] CS2:', skinName, '→ $' + priceUSD.toFixed(2), '→', priceEUR.toFixed(2), 'EUR');
                } else {
                  console.warn('[PRICES] CS2: no price for', skinName);
                }
              });

              console.log('[PRICES] CS2 matched:', matchedCount, '/', skinNames.length);
              if (matchedCount < skinNames.length) {
                addToast(`CS2: ${matchedCount}/${skinNames.length} prices fetched — check skin names match Steam Market exactly`, 'info');
              }
            } else {
              console.error('[PRICES] CS2 Worker HTTP', res.status);
              addToast('CS2 Worker error: HTTP ' + res.status, 'warning');
            }
          } catch (e) {
            console.error('[PRICES] CS2 Worker error:', e.message);
            addToast('CS2 Worker failed: ' + e.message, 'warning');
          }
        }
      }
      
      setPrices(newPrices);
      
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
      setLastRefresh(new Date());
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
      version: '9.0.0',
      timestamp: new Date().toISOString(),
      transactions,
      settings: { theme, language, currency, taxJurisdiction }
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
      symbol: newTransaction.symbol,           // exact YF symbol (e.g. SIX2.DE) or CoinGecko ID
      symbolName: newTransaction.symbolName || '',   // human-readable: "Siemens AG"
      symbolLogoUrl: newTransaction.symbolLogoUrl || '', // logo URL for display
      quantity: parseFloat(newTransaction.quantity),
      price: parseFloat(newTransaction.price),
      fees: parseFloat(newTransaction.fees) || 0,
      date: newTransaction.date,
      notes: newTransaction.notes,
      currency: newTransaction.currency || currency,
      portfolioId: newTransaction.targetPortfolioId || activePortfolioId,
      ...(newTransaction.skinIconUrl ? { skinIconUrl: newTransaction.skinIconUrl } : {})
    };
    
    // Single tested code path for both edit (UPDATE in place) and add (CREATE).
    // Guarantees that editing never spawns a duplicate record. See
    // MaerminUtils.upsertTransaction + test/transactions.test.js.
    const newId = Date.now().toString();
    setTransactions(prev => window.MaerminUtils.upsertTransaction(prev, transactionData, editingTransactionId, newId).transactions);
    addToast(editingTransactionId ? (t.transactionUpdated || 'Transaction updated') : (t.transactionAdded || 'Transaction added'), 'success');
    
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

  // Open Add Transaction modal — pre-selects the currently active portfolio
  const openTransactionModal = () => {
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
      currency: currency,
      targetPortfolioId: activePortfolioId,
    });
    setShowTransactionModal(true);
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
      currency: tx.currency || 'EUR',
      targetPortfolioId: tx.portfolioId || activePortfolioId,
    });
    setEditingTransactionId(tx.id);
    // NOTE: do NOT call openTransactionModal() here — it resets the form and
    // clears editingTransactionId, which made edits save as brand-new records.
    // Just reveal the modal; the form + editingTransactionId are already set.
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
        
        ['crypto', 'stocks', 'skins', 'commodities'].forEach(category => {
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
          
          // Restore priceHistory if present
          if (imported.priceHistory) {
            setPriceHistory(prev => ({ ...prev, ...imported.priceHistory }));
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
      // Portfolio Navigation
      case 'nav:overview':      setActiveView('overview'); break;
      case 'nav:transactions':  setActiveView('transactions'); break;
      case 'nav:dividends':     setActiveView('dividends'); break;
      case 'nav:journal':       setActiveView('journal'); break;
      // Analyse Navigation
      case 'nav:returns':       setActiveView('returns'); break;
      case 'nav:rebalancing':   setActiveView('rebalancing'); break;
      case 'nav:analytics':     setActiveView('analytics'); break;
      case 'nav:taxes':         setActiveView('tax'); break;
      // Tools Navigation
      case 'nav:watchlist':     setActiveView('watchlist'); break;
      case 'nav:alerts':        setActiveView('alerts'); break;
      case 'nav:broker-import': setActiveView('broker-import'); break;
      // Aktionen
      case 'action:add':        openTransactionModal(); break;
      case 'action:refresh':    fetchPrices(); break;
      case 'action:backup':     createBackup(); break;
      case 'action:import':     setShowImportModal(true); break;
      case 'action:privacy':    setPrivacyMode(p => !p); break;
      // Design
      case 'settings:dark':     setTheme('dark'); break;
      case 'settings:light':    setTheme('white'); break;
      case 'settings:purple':   setTheme('purple'); break;
      // Help
      case 'help:shortcuts':    setShowShortcuts(true); break;
      default: break;
    }
  };

  // ========== GLOBAL KEYBOARD SHORTCUTS (driven by the commands list) ==========
  // Wires up the single-key (n/r/b/i/p) and "g"+key navigation shortcuts that
  // the command palette and shortcuts modal already advertise.
  const execRef = useRef(null);
  execRef.current = executeCommand;
  const gPendingRef = useRef(0);
  const overlayRef = useRef(false);
  overlayRef.current = showCommandPalette || showShortcuts || showTransactionModal ||
    showImportModal || showApiSettings || showPasswordModal || showAlertModal;

  useEffect(() => {
    const single = {};
    const gMap = {};
    commands.forEach(c => {
      if (!c.shortcut) return;
      if (c.shortcut.startsWith('g ')) gMap[c.shortcut.slice(2)] = c.id;
      else if (c.shortcut.length === 1) single[c.shortcut] = c.id;
    });
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (overlayRef.current) return; // don't hijack keys while a modal/palette is open
      const key = e.key.toLowerCase();
      const now = Date.now();
      // "g" then a key → navigation (e.g. "g o" = Overview)
      if (gPendingRef.current && now - gPendingRef.current < 1200) {
        gPendingRef.current = 0;
        if (gMap[key]) { e.preventDefault(); execRef.current(gMap[key]); return; }
      }
      if (key === 'g') { gPendingRef.current = now; return; }
      // single-key actions (n / r / b / i / p)
      if (single[key]) { e.preventDefault(); execRef.current(single[key]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commands]);

  // ========== DATA MANAGEMENT VIEW (Import / Export / Backup) ═══════════════
  const DataManagementView = ({ transactions, setTransactions, createBackup, exportData, theme, t, addToast, formatPrice, initialSection }) => {
    const [importText, setImportText] = React.useState('');
    const [importing, setImporting]   = React.useState(false);
    const [section, setSection]       = React.useState(initialSection || 'export'); // 'export' | 'import' | 'broker'

    const handleImport = async () => {
      if (!importText.trim()) { addToast('Paste JSON or CSV data first', 'error'); return; }
      setImporting(true);
      try {
        let imported = [];
        const txt = importText.trim();
        if (txt.startsWith('[') || txt.startsWith('{')) {
          const parsed = JSON.parse(txt);
          imported = Array.isArray(parsed) ? parsed : (parsed.transactions || []);
        } else if (window.ImportExportEngine) {
          imported = window.ImportExportEngine.parseCSV(txt);
        }
        if (!imported.length) throw new Error('No transactions found in data');
        const newTxs = imported.map((tx, i) => ({ id: (Date.now()+i).toString(), ...tx }));
        setTransactions(prev => [...prev, ...newTxs]);
        setImportText('');
        addToast(`${newTxs.length} transaction(s) imported`, 'success');
      } catch(e) {
        addToast('Import failed: ' + e.message, 'error');
      } finally { setImporting(false); }
    };

    const tabBtn = (id, label, icon) => React.createElement('button', {
      onClick: () => setSection(id),
      style: {
        display: 'flex', alignItems: 'center', gap: '0.375rem',
        padding: '0.5rem 1rem', border: 'none', borderRadius: '8px', cursor: 'pointer',
        fontSize: '0.875rem', fontWeight: section === id ? '700' : '400',
        background: section === id ? theme.accent : theme.inputBg,
        color: section === id ? '#fff' : theme.text,
        transition: 'all 0.12s'
      }
    }, icon, label);

    return React.createElement('div', { style: { padding: '1.5rem' } },
      React.createElement('h2', { style: { color: theme.text, fontSize: '1.35rem', fontWeight: '800', marginBottom: '0.25rem' } }, t.dataManagement || 'Data Management'),
      React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.85rem', marginBottom: '1.5rem' } },
        'Export, import, backup your data or use the Broker Import Wizard to import from supported brokers.'
      ),

      // Section tabs
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' } },
        tabBtn('export', 'Export & Backup', '↓ '),
        tabBtn('import', 'Manual Import', '↑ '),
        tabBtn('broker', 'Broker Import', '◁ ')
      ),

      // ── Export & Backup ──────────────────────────────────────────────────
      section === 'export' && React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '1.5rem' } },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.375rem' } }, 'Export & Backup'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginBottom: '1.25rem' } },
          `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''} in database.`
        ),
        React.createElement('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' } },
          React.createElement('button', {
            onClick: createBackup,
            style: { padding: '0.625rem 1.25rem', background: theme.accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }
          }, '↓ JSON Backup',
            React.createElement('span', { style: { fontSize: '0.72rem', opacity: 0.8, fontWeight: '400' } }, '— full restore')
          ),
          React.createElement('button', {
            onClick: exportData,
            style: { padding: '0.625rem 1.25rem', background: theme.inputBg, color: theme.text, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }
          }, '↑ Export CSV',
            React.createElement('span', { style: { fontSize: '0.72rem', color: theme.textSecondary, fontWeight: '400' } }, '— spreadsheet')
          )
        )
      ),

      // ── Manual Import ────────────────────────────────────────────────────
      section === 'import' && React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '1.5rem' } },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.375rem' } }, 'Manual Import'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginBottom: '1rem' } },
          'Paste a JSON backup or CSV export. New transactions are added without replacing existing data.'
        ),
        React.createElement('textarea', {
          value: importText,
          onChange: e => setImportText(e.target.value),
          placeholder: '[{"type":"buy","category":"crypto","symbol":"bitcoin","quantity":0.5,"price":45000,"date":"2024-01-15"}]',
          rows: 7,
          style: { width: '100%', boxSizing: 'border-box', padding: '0.75rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.8rem', fontFamily: 'monospace', resize: 'vertical', marginBottom: '0.875rem' }
        }),
        React.createElement('div', { style: { display: 'flex', gap: '0.75rem', alignItems: 'center' } },
          React.createElement('button', {
            onClick: handleImport, disabled: importing || !importText.trim(),
            style: { padding: '0.625rem 1.25rem', background: importing || !importText.trim() ? theme.inputBg : theme.accent, color: importing || !importText.trim() ? theme.textSecondary : '#fff', border: 'none', borderRadius: '8px', cursor: importing || !importText.trim() ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '0.875rem' }
          }, importing ? '◎ Importing...' : '↑ Import'),
          importText.trim() && React.createElement('button', {
            onClick: () => setImportText(''),
            style: { padding: '0.625rem 1rem', background: 'none', color: theme.textSecondary, border: 'none', cursor: 'pointer', fontSize: '0.85rem' }
          }, '✕ Clear')
        )
      ),

      // ── Broker Import Wizard ─────────────────────────────────────────────
      section === 'broker' && (
        window.MaerminFeatures2
          ? React.createElement(window.MaerminFeatures2.BrokerImportWizard, {
              theme, t, addToast,
              onImport: (txs) => {
                const newTxs = txs.map((tx, i) => ({ id: (Date.now()+i).toString(), ...tx }));
                setTransactions(prev => [...prev, ...newTxs]);
                addToast(`${newTxs.length} transaction(s) imported`, 'success');
              }
            })
          : React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '3rem', textAlign: 'center', color: theme.textSecondary } },
              'Broker Import module not loaded'
            )
      )
    );
  };

  // ========== RENDER VIEWS ==========
  
  // ── DIVIDENDS COMBINED VIEW (Calendar + Forecast + Auto-Fetch) ──────────────
  const DividendsCombinedView = ({ portfolio, prices, transactions, apiKeys, theme, t, addToast, formatPrice, getCurrencySymbol }) => {
    const [tab, setTab] = React.useState('calendar');
    const [fetching, setFetching] = React.useState(false);
    const [divEvents, setDivEvents] = React.useState(() => {
      try { return JSON.parse(localStorage.getItem('maermin_divevents') || '[]'); } catch { return []; }
    });

    React.useEffect(() => { localStorage.setItem('maermin_divevents', JSON.stringify(divEvents)); }, [divEvents]);

    // Auto-fetch dividends from Alpha Vantage for stock positions
    const fetchDividends = async () => {
      // Primary: Yahoo Finance via Worker — returns dividend data in quote summary
      // Fallback: Alpha Vantage OVERVIEW (if worker not configured)
      const workerBase = (apiKeys?.cs2Worker || '').trim().replace(/\/$/, '');
      const hasWorker  = workerBase.length > 5;
      const avKey      = apiKeys?.alphaVantage;

      if (!hasWorker && !avKey) {
        addToast('Add your Worker URL or Alpha Vantage key in ⚙ Settings to auto-fetch dividends', 'warning');
        return;
      }

      const stockSymbols = [...new Set(
        transactions.filter(tx => tx.category === 'stocks').map(tx => (tx.symbol || '').toUpperCase()).filter(Boolean)
      )];
      if (!stockSymbols.length) { addToast('No stock positions found', 'info'); return; }

      setFetching(true);
      let added = 0;

      for (const sym of stockSymbols.slice(0, 8)) {
        let exDate = null, divPerShare = 0, currency = 'USD';

        // ── Primary: Yahoo Finance via Worker ──────────────────────────────
        // YF quoteSummary returns calendarEvents with dividend info
        if (hasWorker) {
          try {
            // Use YF chart endpoint — meta contains dividend rate
            const url  = `${workerBase}?action=yf&symbol=${encodeURIComponent(sym)}&interval=1d&range=3mo`;
            const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
              const data = await res.json();
              // Yahoo Finance chart meta contains dividendRate and exDividendDate
              const meta = data.meta || {};
              if (meta.dividendRate > 0) {
                divPerShare = meta.dividendRate / 4; // quarterly approximation
                // Look for upcoming ex-date from events
                const events = data.events?.dividends || {};
                const upcoming = Object.values(events).filter(e => e.date > Date.now()/1000 - 86400).sort((a,b) => a.date - b.date);
                if (upcoming.length > 0) {
                  exDate    = new Date(upcoming[0].date * 1000).toISOString().split('T')[0];
                  divPerShare = upcoming[0].amount || divPerShare;
                }
                // Fallback: use next quarter estimate
                if (!exDate && meta.dividendRate > 0) {
                  const nextQ = new Date();
                  nextQ.setMonth(nextQ.getMonth() + 3);
                  exDate = nextQ.toISOString().split('T')[0];
                }
                currency = data.currency || 'USD';
                console.log(`[DIV] YF ${sym}: €${divPerShare}/share, ex: ${exDate}`);
              }
            }
          } catch(e) { console.warn('[DIV] YF failed for', sym, e.message); }
        }

        // ── Fallback: Alpha Vantage OVERVIEW ──────────────────────────────
        if ((!exDate || !divPerShare) && avKey) {
          try {
            const res  = await fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${sym}&apikey=${avKey}`);
            const data = await res.json();
            const avExDate = data.ExDividendDate;
            const avDiv    = parseFloat(data.DividendPerShare) || 0;
            if (avExDate && avExDate !== 'None' && avDiv > 0) {
              exDate     = avExDate;
              divPerShare = avDiv;
              currency   = 'USD';
              console.log(`[DIV] AV fallback ${sym}: $${divPerShare}/share, ex: ${exDate}`);
            }
          } catch(e) { console.warn('[DIV] AV fallback failed for', sym, e.message); }
          await new Promise(r => setTimeout(r, 500));
        }

        if (exDate && divPerShare > 0) {
          const existing = divEvents.find(e => e.symbol === sym && e.date === exDate);
          if (!existing) {
            let shares = 0;
            transactions.filter(tx => tx.symbol?.toUpperCase() === sym).forEach(tx => {
              const qty = parseFloat(tx.quantity) || 0;
              if (tx.type === 'buy') shares += qty; else shares -= qty;
            });
            shares = Math.max(0, shares);
            const totalDiv = shares > 0 ? divPerShare * shares : divPerShare;
            setDivEvents(prev => [...prev, {
              id: `auto-${sym}-${exDate}`,
              symbol: sym, date: exDate,
              amount: parseFloat(totalDiv.toFixed(4)),
              currency,
              notes: `Auto: ${divPerShare.toFixed(4)}/share · ${shares.toFixed(2)} shares`
            }]);
            added++;
          }
        }
      }

      setFetching(false);
      addToast(added > 0 ? `${added} dividend(s) added` : 'No new dividends found — data may not include upcoming payments', 'info');
    };

    const tabs = [
      { id: 'calendar', label: 'Calendar' },
      { id: 'forecast', label: 'Forecast' },
    ];

    const tabBtn = (id, label) => React.createElement('button', {
      onClick: () => setTab(id),
      style: {
        padding: '0.5rem 1.25rem', border: 'none', borderRadius: '8px', cursor: 'pointer',
        fontSize: '0.875rem', fontWeight: tab === id ? '600' : '400',
        background: tab === id ? theme.accent : theme.inputBg,
        color: tab === id ? '#fff' : theme.text, transition: 'all 0.15s'
      }
    }, label);

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      // Tab bar + auto-fetch button
      React.createElement('div', {
        style: { display: 'flex', gap: '0.375rem', padding: '1rem 1.5rem', borderBottom: `1px solid ${theme.cardBorder}`, alignItems: 'center', flexWrap: 'wrap' }
      },
        React.createElement('div', { style: { display: 'flex', gap: '0.375rem' } }, tabs.map(tb => tabBtn(tb.id, tb.label))),
        React.createElement('div', { style: { flex: 1 } }),
        React.createElement('button', {
          onClick: fetchDividends, disabled: fetching,
          style: { padding: '0.45rem 1rem', background: fetching ? theme.inputBg : 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: fetching ? theme.textSecondary : '#22c55e', cursor: fetching ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: '600' }
        }, fetching ? 'Fetching...' : '↓ Auto-fetch dividends')
      ),
      // Content
      React.createElement('div', { style: { flex: 1, overflow: 'auto' } },
        tab === 'calendar' && window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.DividendCalendarView, {
            portfolio, theme, t, addToast
          }) : null,
        tab === 'forecast' && window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.DividendForecastView, {
            transactions, portfolio, prices, theme, formatPrice, getCurrencySymbol
          }) : null
      )
    );
  };

  // ── TAX COMBINED VIEW (FIFO + Tax Report) ───────────────────────────────────
  const TaxCombinedView = ({ transactions, prices, theme, t, formatPrice, getCurrencySymbol, taxJurisdiction, setTaxJurisdiction, language }) => {
    const [tab, setTab] = React.useState('fifo');

    const tabBtn = (id, label) => React.createElement('button', {
      onClick: () => setTab(id),
      style: {
        padding: '0.5rem 1.25rem', border: 'none', borderRadius: '8px', cursor: 'pointer',
        fontSize: '0.875rem', fontWeight: tab === id ? '600' : '400',
        background: tab === id ? theme.accent : theme.inputBg,
        color: tab === id ? '#fff' : theme.text, transition: 'all 0.15s'
      }
    }, label);

    // Tax-loss harvesting (V7) — reuses MaerminMetrics; portfolio + exchangeRate
    // come from the InvestmentTracker closure.
    const renderHarvest = () => {
      const M = window.MaerminMetrics;
      const h = M ? M.computeTaxLossHarvest(portfolio, prices, transactions) : { available: false, rows: [] };
      const sym = getCurrencySymbol();
      const sumCard = (label, value, color) => React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '1rem 1.25rem' } },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, label),
        React.createElement('div', { style: { color, fontSize: '1.4rem', fontWeight: 800 } }, `${formatPrice(value)} ${sym}`));
      return React.createElement('div', { style: { padding: '1.5rem' } },
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.4rem' } }, t.taxHarvestTitle || 'Tax-loss harvesting'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.85rem', marginBottom: '1.25rem' } }, t.taxHarvestSubtitle || 'Positions at an unrealised loss you could realise to offset gains. Estimated at the German flat rate — not tax advice.'),
        !h.available
          ? React.createElement('div', { style: { color: theme.textSecondary } }, t.taxHarvestNone || 'No positions are currently at an unrealised loss.')
          : React.createElement('div', null,
              React.createElement('div', { style: { display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' } },
                sumCard(t.taxHarvestTotalLoss || 'Harvestable loss', h.totalLoss, theme.danger),
                sumCard(t.taxHarvestTotalSavings || 'Est. tax savings', h.totalSavings, theme.success)
              ),
              h.rows.map((r, i) =>
                React.createElement('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', marginBottom: '0.5rem' } },
                  React.createElement('div', null,
                    React.createElement('span', { style: { color: theme.text, fontWeight: 600 } }, r.symbol),
                    r.washSale && React.createElement('span', { style: { marginLeft: '0.5rem', fontSize: '0.7rem', padding: '0.1rem 0.5rem', borderRadius: '4px', background: 'rgba(245,158,11,0.2)', color: theme.warning } }, t.taxHarvestWashSale || 'wash-sale risk')
                  ),
                  React.createElement('div', { style: { textAlign: 'right' } },
                    React.createElement('div', { style: { color: theme.danger, fontWeight: 700 } }, `${formatPrice(r.unrealizedLoss)} ${sym}`),
                    !r.washSale && React.createElement('div', { style: { color: theme.success, fontSize: '0.78rem' } }, `${t.taxHarvestSaves || 'saves'} ~${formatPrice(r.taxSavings)} ${sym}`)
                  )
                )
              )
            )
      );
    };

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      React.createElement('div', {
        style: { display: 'flex', gap: '0.375rem', padding: '1rem 1.5rem', borderBottom: `1px solid ${theme.cardBorder}`, flexWrap: 'wrap' }
      },
        tabBtn('fifo',   t.taxTabFifo || 'FIFO Cost Basis'),
        tabBtn('report', t.taxTabReport || 'Tax Report'),
        tabBtn('realized', t.taxTabRealized || 'Realized vs Unrealized'),
        tabBtn('harvest', t.taxTabHarvest || 'Tax-loss harvesting')
      ),
      React.createElement('div', { style: { flex: 1, overflow: 'auto' } },
        tab === 'fifo' && window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.FIFOView, { transactions, prices, theme, formatPrice, getCurrencySymbol }) : null,
        tab === 'report' ? renderTaxView() : null,
        tab === 'realized' && window.MaerminFeatures7 ?
          React.createElement(window.MaerminFeatures7.RealizedUnrealizedView, { transactions, portfolio, prices, theme, formatPrice, getCurrencySymbol, exchangeRate }) : null,
        tab === 'harvest' ? renderHarvest() : null
      )
    );
  };

  const renderView = () => {
    switch (activeView) {
      case 'net-worth':
        return window.MaerminFeatures5 ?
          React.createElement(window.MaerminFeatures5.NetWorthView, {
            portfolioStats, theme: currentTheme, formatPrice, getCurrencySymbol
          }) : renderAnalyticsPlaceholder('Net Worth');

      case 'cashflow':
        return window.MaerminFeatures5 ?
          React.createElement('div', { style: { padding: '1.5rem' } },
            React.createElement('h2', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1.5rem' } }, t.navCashflow || 'Cash Flow'),
            React.createElement(window.MaerminFeatures5.CashflowChart, {
              transactions: activeTransactions, priceHistory, portfolio, prices,
              theme: currentTheme, formatPrice, getCurrencySymbol
            })
          ) : renderAnalyticsPlaceholder('Cash Flow');

      case 'fees':
        return window.MaerminFeatures5 ?
          React.createElement(window.MaerminFeatures5.FeeAnalyzer, {
            transactions: activeTransactions, theme: currentTheme, formatPrice, getCurrencySymbol
          }) : renderAnalyticsPlaceholder('Fee Analyzer');

      case 'portfolios':
        return window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.PortfolioManagerView, {
            portfolios, activePortfolioId, transactions, prices,
            theme: currentTheme, formatPrice, getCurrencySymbol,
            setActivePortfolioId,
            addPortfolio: portfolioHook?.addPortfolio,
            removePortfolio: portfolioHook?.removePortfolio,
            renamePortfolio: portfolioHook?.renamePortfolio
          }) : renderAnalyticsPlaceholder('Portfolios');

      case 'savings-plans':
        return window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.SavingsPlanView, {
            transactions: activeTransactions, theme: currentTheme, formatPrice, getCurrencySymbol, t,
            // Feed the projection (#6): current investment value + forward dividend yield.
            startValue: stats.totalValue,
            dividendYield: (window.MaerminMetrics
              ? (window.MaerminMetrics.computeExpectedAnnualDividends(portfolio, prices).yield || 0) / 100
              : 0)
          }) : renderAnalyticsPlaceholder('Savings Plans');

      case 'returns':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.ReturnsView, {
            transactions: activeTransactions, portfolio, prices, priceHistory,
            theme: currentTheme, formatPrice, getCurrencySymbol, t
          }) : renderAnalyticsPlaceholder('Returns');

      case 'rebalancing':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.RebalancingView, {
            portfolio, prices, theme: currentTheme, formatPrice, getCurrencySymbol, t
          }) : renderAnalyticsPlaceholder('Rebalancing');

      case 'attribution':
        return window.MaerminFeatures7 ?
          React.createElement(window.MaerminFeatures7.PerformanceAttribution, {
            portfolio, prices, priceHistory, transactions: activeTransactions,
            theme: currentTheme, formatPrice, getCurrencySymbol, t
          }) : renderAnalyticsPlaceholder('Attribution');

      case 'realized':
        return window.MaerminFeatures7 ?
          React.createElement(window.MaerminFeatures7.RealizedUnrealizedView, {
            transactions: activeTransactions, portfolio, prices,
            theme: currentTheme, formatPrice, getCurrencySymbol, exchangeRate
          }) : renderAnalyticsPlaceholder('Realized P&L');

      case 'news':
        return window.MaerminFeatures7 ?
          React.createElement(window.MaerminFeatures7.NewsFeedView, {
            portfolio, transactions: activeTransactions, apiKeys,
            theme: currentTheme, formatPrice, getCurrencySymbol
          }) : renderAnalyticsPlaceholder('News Feed');

      case 'data':
      case 'broker-import':
        return React.createElement(DataManagementView, {
          transactions, setTransactions, createBackup, exportData,
          theme: currentTheme, t, addToast, formatPrice,
          // Broker-Import nav entry deep-links straight to the wizard tab.
          initialSection: activeView === 'broker-import' ? 'broker' : 'export'
        });

      case 'journal':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.PositionNotesView, {
            portfolio, theme: currentTheme, t
          }) : renderAnalyticsPlaceholder('Trade Journal');

      case 'dividends':
        return React.createElement(DividendsCombinedView, {
          portfolio, prices, transactions: activeTransactions, apiKeys,
          theme: currentTheme, t, addToast, formatPrice, getCurrencySymbol
        });

      case 'tax':
        return React.createElement(TaxCombinedView, {
          transactions: activeTransactions, prices,
          theme: currentTheme, t, formatPrice, getCurrencySymbol,
          taxJurisdiction, setTaxJurisdiction, language
        });

      case 'watchlist':
        return window.MaerminFeatures ?
          React.createElement(window.MaerminFeatures.WatchlistView, {
            prices, priceHistory, theme: currentTheme, t, addToast
          }) : renderAnalyticsPlaceholder('Watchlist');

      case 'alerts':
        return window.MaerminFeatures ?
          React.createElement(window.MaerminFeatures.PriceAlertsView, {
            prices, theme: currentTheme, t, addToast, portfolio
          }) : renderAnalyticsPlaceholder('Price Alerts');

      case 'transactions':
        return renderTransactionsView();
      
      case 'analytics':
        return renderAnalyticsMenu();
      
      case 'investment-analysis':
        return window.InvestmentViews && window.InvestmentViews.InvestmentAnalysisDashboard ?
          React.createElement(window.InvestmentViews.InvestmentAnalysisDashboard, {
            portfolio, prices, priceHistory,
            theme: currentTheme, t, formatPrice
          }) : renderAnalyticsPlaceholder('Strategy Analysis');

      case 'health':
        return window.PortfolioHealth ?
          React.createElement(window.PortfolioHealth.HealthView, {
            portfolio, prices, priceHistory, transactions: activeTransactions,
            theme: currentTheme, t, formatPrice, getCurrencySymbol, setActiveView
          }) : renderAnalyticsPlaceholder('Portfolio Health');

      default:
        return renderOverview();
    }
  };

  // ========== DASHBOARD KPI STRIP ==========
  // V7: surfaces the cross-cutting summary numbers (Net Worth, FIRE, expected
  // Dividend income, Health Score) right on the dashboard. Each tile drills
  // into its existing detail view; numbers come from window.MaerminMetrics,
  // which reuses the existing engines (no duplicate logic).

  const DashboardKpiStrip = ({ portfolio, prices, priceHistory, transactions, portfolioValue, theme, t, formatPrice, getCurrencySymbol, setActiveView, language }) => {
    const M = window.MaerminMetrics;
    const [fire, setFire]         = React.useState(() => (M ? M.loadFireSettings() : { annualExpenses: 0, withdrawalRate: 4 }));
    const [editFire, setEditFire] = React.useState(false);

    const sym = getCurrencySymbol();
    const nw      = M ? M.computeNetWorth(portfolioValue) : null;
    const fireM   = (M && nw) ? M.computeFireMetrics(nw.netWorth, fire) : null;
    const divM    = M ? M.computeExpectedAnnualDividends(portfolio, prices) : null;
    const healthM = M ? M.healthScore(portfolio, prices, t, { priceHistory, transactions }) : null;

    const healthColor = (s) => s >= 85 ? '#22c55e' : s >= 70 ? '#84cc16' : s >= 55 ? '#f59e0b' : s >= 40 ? '#f97316' : '#ef4444';

    const tile = (opts) => React.createElement('div', {
      key: opts.key,
      onClick: opts.onClick,
      style: {
        background: theme.card, padding: '1.1rem 1.2rem', borderRadius: '16px',
        border: `1px solid ${theme.cardBorder}`, cursor: opts.onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', gap: '0.4rem',
        transition: 'border-color 0.16s, transform 0.16s, box-shadow 0.16s',
        boxShadow: theme.shadow, minHeight: '96px', justifyContent: 'center'
      },
      onMouseEnter: opts.onClick ? e => { e.currentTarget.style.borderColor = `${theme.accent}66`; e.currentTarget.style.transform = 'translateY(-2px)'; } : undefined,
      onMouseLeave: opts.onClick ? e => { e.currentTarget.style.borderColor = theme.cardBorder; e.currentTarget.style.transform = 'translateY(0)'; } : undefined
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.68rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em' } }, opts.label),
        opts.badge || (opts.onClick && React.createElement('span', { style: { color: theme.accent, fontSize: '0.85rem', opacity: 0.7 } }, '→'))
      ),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.7rem' } },
        opts.ring,
        React.createElement('div', null,
          React.createElement('div', { style: { color: opts.color || theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.025em', lineHeight: 1.05 } }, opts.value),
          opts.sub && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.74rem', marginTop: '0.2rem' } }, opts.sub)
        )
      )
    );

    // Net Worth tile
    const netWorthTile = tile({
      key: 'nw',
      label: t.kpiNetWorth || 'Net Worth',
      value: nw ? `${formatPrice(nw.netWorth)} ${sym}` : '—',
      sub: nw ? `${(t.kpiLiquidity || 'Liquidity')} ${nw.liquidityRatio.toFixed(0)}%` : null,
      color: nw && nw.netWorth < 0 ? '#ef4444' : theme.text,
      onClick: () => setActiveView('net-worth')
    });

    // FIRE tile (+ inline setup)
    const fireValue = !fireM ? '—'
      : !fireM.configured ? (t.kpiSetGoal || 'Set goal')
      : `${Math.min(100, fireM.progress).toFixed(0)}%`;
    const fireSub = fireM && fireM.configured
      ? `${t.kpiFireTarget || 'Target'} ${formatPrice(fireM.fireNumber)} ${sym}`
      : (t.kpiFireHint || 'Tap to set annual expenses');
    const fireRing = (fireM && fireM.configured) ? React.createElement('div', {
      style: {
        width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
        background: `conic-gradient(${theme.accent} ${Math.min(100, fireM.progress) * 3.6}deg, ${theme.inputBg} 0deg)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }
    }, React.createElement('div', { style: { width: '30px', height: '30px', borderRadius: '50%', background: theme.card } })) : null;
    const fireTile = tile({
      key: 'fire',
      label: t.kpiFire || 'FIRE Progress',
      value: fireValue,
      sub: fireSub,
      color: fireM && fireM.configured ? theme.accent : theme.textSecondary,
      ring: fireRing,
      onClick: () => setEditFire(v => !v)
    });

    // Dividend income tile
    const divTile = tile({
      key: 'div',
      label: t.kpiDividends || 'Dividend Income',
      value: (divM && divM.available) ? `${formatPrice(divM.totalAnnual)} ${sym}` : '—',
      sub: (divM && divM.available)
        ? `${formatPrice(divM.monthly)} ${sym}/mo · ${divM.yield.toFixed(1)}%`
        : (t.kpiDividendsNone || 'No dividend payers'),
      color: (divM && divM.available) ? '#22c55e' : theme.textSecondary,
      onClick: () => setActiveView('dividends')
    });

    // Health tile
    const hScore = healthM && !healthM.empty ? healthM.score : null;
    const healthTile = tile({
      key: 'health',
      label: t.kpiHealth || 'Health Score',
      value: hScore != null ? String(hScore) : '—',
      sub: hScore != null ? `${t.healthGrade || 'Grade'} ${healthM.grade}` : null,
      color: hScore != null ? healthColor(hScore) : theme.textSecondary,
      ring: hScore != null ? React.createElement('div', {
        style: {
          width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
          background: `conic-gradient(${healthColor(hScore)} ${hScore * 3.6}deg, ${theme.inputBg} 0deg)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }
      }, React.createElement('div', { style: { width: '30px', height: '30px', borderRadius: '50%', background: theme.card } })) : null,
      onClick: () => setActiveView('health')
    });

    const labelStyle = { display: 'block', color: theme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' };
    const inputStyle = { padding: '0.5rem 0.7rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' };

    return React.createElement('div', { style: { marginBottom: '1.5rem' } },
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem' }
      }, netWorthTile, fireTile, divTile, healthTile),

      // Inline FIRE setup — no modal, no new view
      editFire && React.createElement('div', {
        style: { marginTop: '0.75rem', background: theme.card, border: `1px solid ${theme.accent}44`, borderRadius: '12px', padding: '1rem 1.1rem' }
      },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.75rem' } }, t.fireSetupTitle || 'FIRE planning'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', alignItems: 'end' } },
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle }, `${t.fireAnnualExpenses || 'Annual expenses'} (${sym})`),
            React.createElement('input', {
              type: 'number', defaultValue: fire.annualExpenses || '', placeholder: '24000',
              style: inputStyle,
              onChange: e => setFire(p => ({ ...p, annualExpenses: parseFloat(e.target.value) || 0 }))
            })
          ),
          React.createElement('div', null,
            React.createElement('label', { style: labelStyle }, `${t.fireWithdrawalRate || 'Withdrawal rate'} (%)`),
            React.createElement('input', {
              type: 'number', step: '0.1', defaultValue: fire.withdrawalRate || 4,
              style: inputStyle,
              onChange: e => setFire(p => ({ ...p, withdrawalRate: parseFloat(e.target.value) || 4 }))
            })
          ),
          React.createElement('button', {
            onClick: () => { if (M) M.saveFireSettings(fire); setEditFire(false); },
            style: { padding: '0.55rem 1.1rem', background: theme.accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }
          }, t.save || 'Save')
        ),
        fireM && fireM.configured && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.78rem', marginTop: '0.75rem' } },
          `${t.fireMonthlyPassive || 'Passive income at current net worth'}: ${formatPrice(fireM.monthlyPassiveIncome)} ${sym}/mo · ${fireM.coveredExpenseRatio.toFixed(0)}% ${t.fireOfExpenses || 'of expenses'}`
        )
      )
    );
  };

  // ========== OVERVIEW VIEW ==========

  const renderOverview = () => {
    // Compute per-portfolio stats for single-portfolio mode
    const selectedPortfolio  = portfolios.find(p => p.id === overviewMode) || portfolios[0];
    const isAllMode          = overviewMode === 'all';

    const singleStats = useMemoInline(() => {
      if (isAllMode) return null;
      const posMap = {};
      transactions.filter(tx => (tx.portfolioId || 'default') === overviewMode).forEach(tx => {
        const category = tx.category || 'crypto';
        const key = `${category}-${(tx.symbol || '').toLowerCase()}`;
        if (!posMap[key]) posMap[key] = { symbol: tx.symbol, category, amount: 0, totalCostEUR: 0 };
        const qty = parseFloat(tx.quantity) || 0;
        let priceEUR = parseFloat(tx.price) || 0;
        if (tx.currency === 'USD' && exchangeRate > 0) priceEUR *= exchangeRate;
        if (tx.type === 'buy') {
          posMap[key].amount += qty;
          posMap[key].totalCostEUR += qty * priceEUR;
        } else if (tx.type === 'sell') {
          const frac = posMap[key].amount > 0 ? Math.min(qty, posMap[key].amount) / posMap[key].amount : 0;
          posMap[key].totalCostEUR *= (1 - frac);
          posMap[key].amount = Math.max(0, posMap[key].amount - qty);
        }
      });
      let totalValue = 0, totalInvested = 0, totalPositions = 0;
      Object.values(posMap).forEach(pos => {
        if (pos.amount <= 0.0001) return;
        const sym = pos.symbol || '';
        const pr  = prices[sym] || prices[sym.toLowerCase()] || prices[sym.toUpperCase()] || 0;
        totalValue    += pos.amount * pr;
        totalInvested += pos.totalCostEUR;
        totalPositions++;
      });
      return {
        totalValue, totalInvested, totalPositions,
        totalProfit: totalValue - totalInvested,
        totalProfitPercent: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
      };
    }, [overviewMode, transactions, prices, exchangeRate]);

    const stats  = isAllMode ? allPortfoliosStats : singleStats || allPortfoliosStats;
    const isUp   = stats.totalProfit >= 0;
    const pctStr = `${stats.totalProfitPercent >= 0 ? '+' : ''}${stats.totalProfitPercent.toFixed(2)}%`;

    // Label names depend on mode
    const labelValue  = isAllMode ? 'Total Value'  : 'Portfolio Value';
    const labelReturn = isAllMode ? 'Total Return' : 'Portfolio Return';

    const statCard = (label, value, sub, color, onClick) =>
      React.createElement('div', {
        onClick,
        style: {
          background: currentTheme.card, padding: '1.35rem', borderRadius: '16px',
          border: `1px solid ${currentTheme.cardBorder}`,
          boxShadow: currentTheme.shadow,
          cursor: onClick ? 'pointer' : 'default',
          transition: 'border-color 0.16s, transform 0.16s'
        },
        onMouseEnter: onClick ? e => { e.currentTarget.style.borderColor = `${currentTheme.accent}66`; e.currentTarget.style.transform = 'translateY(-2px)'; } : undefined,
        onMouseLeave: onClick ? e => { e.currentTarget.style.borderColor = currentTheme.cardBorder; e.currentTarget.style.transform = 'translateY(0)'; } : undefined
      },
        React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.72rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem' } }, label),
        React.createElement('div', { style: { color: color || currentTheme.text, fontSize: '1.85rem', fontWeight: '800', letterSpacing: '-0.025em', lineHeight: 1 } }, value),
        sub && React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.78rem', marginTop: '0.4rem' } }, sub)
      );

    // Transactions and portfolio for chart — filtered by mode
    const overviewTransactions = isAllMode
      ? transactions
      : transactions.filter(tx => (tx.portfolioId || 'default') === overviewMode);

    const overviewPortfolio = isAllMode ? allPortfoliosPortfolio : (() => {
      const result = { crypto: [], stocks: [], skins: [], commodities: [] };
      const posMap = {};
      overviewTransactions.forEach(tx => {
        const category = tx.category || 'crypto';
        const symbol   = (tx.symbol || '').toLowerCase();
        const key      = `${category}-${symbol}`;
        if (!posMap[key]) posMap[key] = { symbol: tx.symbol, symbolName: tx.symbolName || '', symbolLogoUrl: tx.symbolLogoUrl || '', amount: 0, totalCostEUR: 0, purchaseDate: tx.date, category };
        if (!posMap[key].symbolName && tx.symbolName) posMap[key].symbolName = tx.symbolName;
        let priceEUR = parseFloat(tx.price) || 0;
        if (tx.currency === 'USD' && exchangeRate > 0) priceEUR *= exchangeRate;
        if (tx.type === 'buy') { posMap[key].amount += parseFloat(tx.quantity)||0; posMap[key].totalCostEUR += (parseFloat(tx.quantity)||0) * priceEUR; }
        else if (tx.type === 'sell') {
          const frac = posMap[key].amount > 0 ? Math.min(parseFloat(tx.quantity)||0, posMap[key].amount) / posMap[key].amount : 0;
          posMap[key].totalCostEUR *= (1-frac);
          posMap[key].amount = Math.max(0, posMap[key].amount - (parseFloat(tx.quantity)||0));
        }
      });
      Object.values(posMap).forEach(pos => {
        if (pos.amount > 0.0001) result[pos.category].push({ ...pos, id: `${pos.category}-${pos.symbol}`, name: pos.symbolName || pos.symbol, purchasePrice: pos.totalCostEUR / pos.amount });
      });
      return result;
    })();

    return React.createElement('div', { style: { padding: '1.5rem' } },

      // ── Header ──────────────────────────────────────────────────────────
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }
      },
        React.createElement('div', null,
          React.createElement('h2', { style: { color: currentTheme.text, fontSize: '1.35rem', fontWeight: '800', marginBottom: '0.125rem' } }, t.navOverview || 'Overview'),
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.72rem' } },
            isAllMode
              ? `All ${portfolios.length} portfolio${portfolios.length > 1 ? 's' : ''} combined · ${lastRefresh ? 'Last refresh ' + lastRefresh.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : 'Refresh to update'}`
              : `${selectedPortfolio?.name || 'Portfolio'} · ${lastRefresh ? 'Last refresh ' + lastRefresh.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : 'Refresh to update'}`
          )
        ),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
          React.createElement('button', { onClick: () => openTransactionModal(), style: { padding: '0.5rem 1rem', background: currentTheme.accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' } }, '+ Add'),
          React.createElement('button', { onClick: () => setShowImportModal(true), style: { padding: '0.5rem 1rem', background: currentTheme.inputBg, color: currentTheme.text, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' } }, '↑ Import'),
          React.createElement('button', { onClick: fetchPrices, disabled: loading, style: { padding: '0.5rem 1rem', background: loading ? currentTheme.inputBg : `${currentTheme.accent}18`, color: loading ? currentTheme.textSecondary : currentTheme.accent, border: `1px solid ${currentTheme.accent}33`, borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.375rem' } }, loading ? '◎ Refreshing...' : '↻ Refresh prices')
        )
      ),

      // ── Portfolio selector tabs ──────────────────────────────────────────
      React.createElement('div', {
        style: { display: 'flex', gap: '0.375rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }
      },
        // All Portfolios tab
        React.createElement('button', {
          onClick: () => setOverviewMode('all'),
          style: {
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            padding: '0.375rem 0.875rem',
            background: overviewMode === 'all' ? `${currentTheme.accent}20` : currentTheme.inputBg,
            border: `1px solid ${overviewMode === 'all' ? currentTheme.accent : currentTheme.cardBorder}`,
            borderRadius: '8px', cursor: 'pointer', transition: 'all 0.1s',
            fontSize: '0.8rem', fontWeight: overviewMode === 'all' ? '700' : '400',
            color: overviewMode === 'all' ? currentTheme.accent : currentTheme.text
          }
        },
          React.createElement('span', { style: { fontSize: '0.7rem' } }, '◈'),
          'All Portfolios'
        ),
        // Divider
        React.createElement('div', { style: { width: 1, height: 20, background: currentTheme.cardBorder, margin: '0 0.125rem' } }),
        // Individual portfolio tabs
        ...portfolios.map(p =>
          React.createElement('button', {
            key: p.id,
            onClick: () => { setOverviewMode(p.id); setActivePortfolioId(p.id); },
            style: {
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.375rem 0.875rem',
              background: overviewMode === p.id ? `${p.color}18` : currentTheme.inputBg,
              border: `1px solid ${overviewMode === p.id ? p.color : currentTheme.cardBorder}`,
              borderRadius: '8px', cursor: 'pointer', transition: 'all 0.1s',
              fontSize: '0.8rem', fontWeight: overviewMode === p.id ? '700' : '400',
              color: currentTheme.text
            }
          },
            React.createElement('div', { style: { width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 } }),
            p.name
          )
        ),
        React.createElement('button', {
          onClick: () => setActiveView('portfolios'),
          style: { fontSize: '0.72rem', color: currentTheme.textSecondary, background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto', padding: '0 0.25rem' }
        }, 'Manage portfolios →')
      ),

      // ── Stats cards ─────────────────────────────────────────────────────
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }
      },
        statCard(labelValue, `${formatPrice(stats.totalValue)} ${getCurrencySymbol()}`,
          lastRefresh ? `as of ${lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Refresh to update'),
        statCard('Invested', `${formatPrice(stats.totalInvested)} ${getCurrencySymbol()}`,
          `${stats.totalPositions} position${stats.totalPositions !== 1 ? 's' : ''}`),
        statCard(labelReturn,
          `${isUp ? '+' : ''}${formatPrice(stats.totalProfit)} ${getCurrencySymbol()}`,
          pctStr,
          isUp ? '#22c55e' : '#ef4444'
        ),
        statCard('Positions', stats.totalPositions,
          isAllMode ? `across ${portfolios.length} portfolio${portfolios.length > 1 ? 's' : ''}` : selectedPortfolio?.name || 'this portfolio',
          undefined, () => setActiveView('transactions')
        )
      ),

      // ── KPI strip: Net Worth · FIRE · Dividend income · Health (V7) ──────
      window.MaerminMetrics && stats.totalPositions > 0 &&
        React.createElement(DashboardKpiStrip, {
          portfolio: overviewPortfolio,
          prices, priceHistory,
          transactions: overviewTransactions,
          portfolioValue: stats.totalValue,
          theme: currentTheme, t, formatPrice, getCurrencySymbol, setActiveView
        }),

      // ── Chart ────────────────────────────────────────────────────────────
      window.MaerminFeatures6 && stats.totalPositions > 0 &&
        React.createElement(window.MaerminFeatures6.PortfolioHistoryChart, {
          portfolio:          overviewPortfolio,
          prices,
          transactions:       overviewTransactions,
          apiKeys,
          exchangeRate,
          currentValue:       stats.totalValue,
          totalInvested:      stats.totalInvested,
          totalProfit:        stats.totalProfit,
          totalProfitPercent: stats.totalProfitPercent,
          theme: currentTheme, formatPrice, getCurrencySymbol
        }),

      // CS2 banner
      portfolio.skins && portfolio.skins.length > 0 && !(apiKeys.cs2Worker||'').trim() &&
        React.createElement('div', { style: { background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '10px', padding: '0.875rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' } },
          React.createElement('span', { style: { fontSize: '1.25rem' } }, '!'),
          React.createElement('div', { style: { flex: 1, minWidth: '200px' } },
            React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '0.875rem' } }, 'CS2 skin prices need a Cloudflare Worker URL'),
            React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.8rem', marginTop: '0.125rem' } }, 'Deploy the worker.js and paste the URL in ⚙ API Settings.')
          ),
          React.createElement('button', { onClick: () => setShowApiSettings(true), style: { padding: '0.5rem 1rem', background: currentTheme.warning, color: '#1a1a1a', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.8rem' } }, 'Add Worker URL →')
        ),

      // Onboarding
      stats.totalPositions === 0 && React.createElement('div', { style: { background: 'linear-gradient(135deg,rgba(59,130,246,0.1),rgba(245,165,36,0.1))', border: '1px solid rgba(245,165,36,0.3)', borderRadius: '12px', padding: '2rem', marginBottom: '2rem', textAlign: 'center' } },
        React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.75rem', color: 'rgba(245,165,36,0.5)', fontWeight: '300' } }, '↗'),
        React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.5rem' } }, t.welcomeTitle || 'Welcome to MAERMIN'),
        React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginBottom: '1rem', lineHeight: '1.6' } }, t.welcomeHint || 'Start by adding your first transaction.'),
        React.createElement('div', { style: { display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' } },
          React.createElement('button', { onClick: () => openTransactionModal(), style: { padding: '0.625rem 1.25rem', background: currentTheme.accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.875rem' } }, '+ ' + (t.addTransaction || 'Add Transaction')),
          React.createElement('button', { onClick: () => setShowImportModal(true), style: { padding: '0.625rem 1.25rem', background: currentTheme.inputBg, color: currentTheme.text, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' } }, t.importData || 'Import Data')
        )
      ),

      // Overview Panel (Pie + Gainers) — uses filtered portfolio
      window.MaerminFeatures && stats.totalPositions > 0 &&
        React.createElement(window.MaerminFeatures.PortfolioOverviewPanel, {
          portfolio: overviewPortfolio, prices, priceHistory,
          theme: currentTheme, formatPrice, getCurrencySymbol, t
        }),

      // Benchmark + Daily P&L
      window.MaerminFeatures3 && stats.totalPositions > 0 &&
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' } },
          React.createElement(window.MaerminFeatures3.BenchmarkWidget, { portfolio: overviewPortfolio, prices, priceHistory, transactions: overviewTransactions, theme: currentTheme, formatPrice, getCurrencySymbol }),
          React.createElement(window.MaerminFeatures3.DailyPnLCard, { portfolio: overviewPortfolio, priceHistory, theme: currentTheme, formatPrice, getCurrencySymbol })
        ),

      // Positions Table
      (window.MaerminFeatures3?.EnhancedPositionsTable || window.MaerminFeatures?.PositionsTable) && stats.totalPositions > 0 &&
        React.createElement(
          window.MaerminFeatures3?.EnhancedPositionsTable || window.MaerminFeatures.PositionsTable,
          { portfolio: overviewPortfolio, prices, priceHistory, transactions: overviewTransactions, theme: currentTheme, formatPrice, getCurrencySymbol, t, onAddTransaction: () => openTransactionModal() }
        )
    );
  };

  // useMemoInline helper — inline useMemo replacement for inside render functions
  function useMemoInline(fn, deps) {
    // We use useMemo from React context, but since this is inside renderOverview
    // (called during render) we compute it directly — deps are captured by closure
    return fn();
  }

  // ========== ANALYTICS MENU ==========
  
  const [analyticsTab, setAnalyticsTab] = useState('correlation');

  const renderAnalyticsMenu = () => {
    const tabs = [
      { id: 'correlation', label: t.correlationMatrix || 'Correlation' },
      { id: 'montecarlo',  label: t.monteCarloSimulation || 'Monte Carlo' },
      { id: 'stress',      label: t.stressTesting || 'Stress Test' },
      { id: 'risk',        label: t.riskLevel || 'Risk' },
    ];

    const tabBtn = (id, label) => React.createElement('button', {
      key: id,
      onClick: () => setAnalyticsTab(id),
      style: {
        padding: '0.5rem 1.1rem', border: 'none', borderRadius: '10px', cursor: 'pointer',
        fontWeight: analyticsTab === id ? '650' : '450', fontSize: '0.875rem',
        background: analyticsTab === id ? currentTheme.accent : currentTheme.inputBg,
        color: analyticsTab === id ? currentTheme.accentText : currentTheme.textSecondary, transition: 'all 0.15s'
      }
    }, label);

    const renderContent = () => {
      switch(analyticsTab) {
        case 'correlation': return window.CorrelationMatrixView ?
          React.createElement(window.CorrelationMatrixView, { portfolio, priceHistory, t, theme: currentTheme, formatPrice })
          : renderAnalyticsPlaceholder('Correlation Matrix');
        case 'montecarlo': return window.MonteCarloView ?
          React.createElement(window.MonteCarloView, { portfolio, prices, t, theme: currentTheme, currency, formatPrice })
          : renderAnalyticsPlaceholder('Monte Carlo');
        case 'stress': return window.StressTestView ?
          React.createElement(window.StressTestView, { portfolio, prices, t, theme: currentTheme, currency, formatPrice })
          : renderAnalyticsPlaceholder('Stress Test');
        case 'risk': return window.RiskAnalyticsViewV2 ?
          React.createElement(window.RiskAnalyticsViewV2, { portfolio, prices, priceHistory, transactions: activeTransactions, setActiveView, t, theme: currentTheme, formatPrice })
          : renderAnalyticsPlaceholder('Risk Analysis');
        default: return null;
      }
    };

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      // Tab bar at top
      React.createElement('div', {
        style: { display: 'flex', gap: '0.375rem', padding: '1rem 1.5rem', borderBottom: `1px solid ${currentTheme.cardBorder}`, flexWrap: 'wrap' }
      }, tabs.map(tab => tabBtn(tab.id, tab.label))),
      // Content
      React.createElement('div', { style: { flex: 1, overflow: 'auto' } }, renderContent())
    );
  };

  // ========== TRANSACTIONS VIEW ==========
  
  const renderTransactionsView = () => {
    // Filter by active portfolio first, then by search
    const filtered = transactions.filter(tx => {
      const portfolioMatch = (tx.portfolioId || 'default') === activePortfolioId;
      if (!portfolioMatch) return false;
      if (!txSearch.trim()) return true;
      const q = txSearch.toLowerCase();
      return (tx.symbol || '').toLowerCase().includes(q) ||
             (tx.category || '').toLowerCase().includes(q) ||
             (tx.type || '').toLowerCase().includes(q) ||
             (tx.notes || '').toLowerCase().includes(q) ||
             (tx.symbolName || '').toLowerCase().includes(q);
    });
    const totalAll = transactions.filter(tx => (tx.portfolioId || 'default') === activePortfolioId).length;

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (txSortBy) {
        case 'date-asc':  return new Date(a.date) - new Date(b.date);
        case 'date-desc': return new Date(b.date) - new Date(a.date);
        case 'amount-desc': return (b.quantity * b.price) - (a.quantity * a.price);
        case 'symbol': return (a.symbol || '').localeCompare(b.symbol || '');
        default: return new Date(b.date) - new Date(a.date);
      }
    });

    const inputStyle = {
      padding: '0.5rem 0.75rem',
      background: currentTheme.inputBg,
      border: `1px solid ${currentTheme.inputBorder}`,
      borderRadius: '8px',
      color: currentTheme.text,
      fontSize: '0.875rem'
    };

    return React.createElement('div', { style: { padding: '1.5rem' } },
      // Header row
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' }
        }, `${t.transactions || 'Transactions'} (${filtered.length}${filtered.length !== totalAll ? '/' + totalAll : ''})`),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } },
          // Search
          React.createElement('input', {
            type: 'text',
            value: txSearch,
            onChange: e => setTxSearch(e.target.value),
            placeholder: t.search || 'Search...',
            style: { ...inputStyle, width: '180px' }
          }),
          // Sort
          React.createElement('select', {
            value: txSortBy,
            onChange: e => setTxSortBy(e.target.value),
            style: inputStyle
          },
            React.createElement('option', { value: 'date-desc' }, t.newestFirst || 'Newest first'),
            React.createElement('option', { value: 'date-asc'  }, t.oldestFirst || 'Oldest first'),
            React.createElement('option', { value: 'amount-desc'}, t.largestFirst || 'Largest first'),
            React.createElement('option', { value: 'symbol'    }, t.bySymbol || 'By symbol')
          ),
          // Add button
          React.createElement('button', {
            onClick: () => openTransactionModal(),
            style: {
              padding: '0.5rem 1.25rem',
              background: currentTheme.accent,
              color: currentTheme.accentText,
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontWeight: '700',
              fontSize: '0.875rem',
              boxShadow: '0 6px 16px -6px rgba(245,165,36,0.5)'
            }
          }, '+ ' + (t.addTransaction || 'Add'))
        )
      ),


      
      // Table
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          borderRadius: '16px',
          border: `1px solid ${currentTheme.cardBorder}`,
          boxShadow: currentTheme.shadow,
          overflow: 'auto'
        }
      },
        sorted.length === 0
          ? React.createElement('div', {
              style: { padding: '3rem', textAlign: 'center', color: currentTheme.textSecondary }
            },
              txSearch ? (t.noResults || 'No results for your search.') : (t.noTransactions || 'No transactions yet.')
            )
          : React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '700px' } },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  ['date','type','symbol','qty','price','cur','total',''].map((h, i) =>
                    React.createElement('th', {
                      key: i,
                      style: {
                        textAlign: i >= 3 && i <= 6 ? 'right' : i === 7 ? 'center' : 'left',
                        padding: '0.875rem 1rem',
                        color: currentTheme.textSecondary,
                        borderBottom: `1px solid ${currentTheme.cardBorder}`,
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }
                    }, h === 'date' ? (t.date||'Date') : h === 'type' ? (t.transactionType||'Type') :
                       h === 'symbol' ? (t.symbol||'Symbol') : h === 'qty' ? (t.quantity||'Qty') :
                       h === 'price' ? (t.price||'Price') : h === 'cur' ? '' : h === 'total' ? (t.total||'Total') : '')
                  )
                )
              ),
              React.createElement('tbody', null,
                sorted.map(tx =>
                  React.createElement(React.Fragment, { key: tx.id },
                    React.createElement('tr', {
                      style: { transition: 'background 0.15s' },
                      onMouseEnter: e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)',
                      onMouseLeave: e => e.currentTarget.style.background = 'transparent'
                    },
                      React.createElement('td', { style: { padding: '0.875rem 1rem', color: currentTheme.text, fontSize: '0.875rem' } }, tx.date),
                      React.createElement('td', { style: { padding: '0.875rem 1rem' } },
                        React.createElement('span', {
                          style: {
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: '700',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            background: tx.type === 'buy' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: tx.type === 'buy' ? currentTheme.success : currentTheme.danger
                          }
                        }, tx.type === 'buy' ? (t.buy||'Buy') : (t.sell||'Sell'))
                      ),
                      React.createElement('td', { style: { padding: '0.875rem 1rem' } },
                        React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '0.875rem' } }, tx.symbol),
                        React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.75rem' } }, tx.category)
                      ),
                      React.createElement('td', { style: { padding: '0.875rem 1rem', color: currentTheme.text, textAlign: 'right', fontSize: '0.875rem' } }, tx.quantity),
                      React.createElement('td', { style: { padding: '0.875rem 1rem', color: currentTheme.text, textAlign: 'right', fontSize: '0.875rem' } },
                        tx.price?.toFixed(2)
                      ),
                      React.createElement('td', { style: { padding: '0.875rem 0.5rem', color: currentTheme.textSecondary, textAlign: 'center', fontSize: '0.75rem' } },
                        tx.currency || 'EUR'
                      ),
                      React.createElement('td', { style: { padding: '0.875rem 1rem', color: currentTheme.text, textAlign: 'right', fontWeight: '600', fontSize: '0.875rem' } },
                        `${(tx.quantity * tx.price).toFixed(2)}`
                      ),
                      React.createElement('td', { style: { padding: '0.5rem 0.75rem', textAlign: 'center' } },
                        React.createElement('div', { style: { display: 'flex', gap: '0.375rem', justifyContent: 'center' } },
                          React.createElement('button', {
                            onClick: () => editTransaction(tx),
                            title: t.edit || 'Edit',
                            style: {
                              padding: '0.3rem 0.6rem',
                              background: currentTheme.accentSoft,
                              color: currentTheme.accent,
                              border: `1px solid ${currentTheme.accent}40`,
                              borderRadius: '7px',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: '600'
                            }
                          }, '✎'),
                          React.createElement('button', {
                            onClick: () => setTxDeleteConfirm(tx.id),
                            title: t.delete || 'Delete',
                            style: {
                              padding: '0.3rem 0.6rem',
                              background: 'rgba(239,68,68,0.1)',
                              color: currentTheme.danger,
                              border: `1px solid rgba(239,68,68,0.25)`,
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.75rem'
                            }
                          }, '×')
                        )
                      )
                    ),
                    // Inline delete confirmation row
                    txDeleteConfirm === tx.id && React.createElement('tr', { key: tx.id + '-confirm' },
                      React.createElement('td', {
                        colSpan: 8,
                        style: {
                          padding: '0.625rem 1rem',
                          background: 'rgba(239,68,68,0.08)',
                          borderTop: `1px solid rgba(239,68,68,0.2)`,
                          borderBottom: `1px solid rgba(239,68,68,0.2)`
                        }
                      },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '1rem' } },
                          React.createElement('span', { style: { color: currentTheme.danger, fontSize: '0.875rem', fontWeight: '500' } },
                            t.confirmDelete || 'Delete this transaction?'
                          ),
                          React.createElement('button', {
                            onClick: () => { deleteTransaction(tx.id); setTxDeleteConfirm(null); },
                            style: {
                              padding: '0.3rem 0.875rem',
                              background: currentTheme.danger,
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              fontWeight: '600'
                            }
                          }, t.delete || 'Delete'),
                          React.createElement('button', {
                            onClick: () => setTxDeleteConfirm(null),
                            style: {
                              padding: '0.3rem 0.875rem',
                              background: currentTheme.inputBg,
                              color: currentTheme.text,
                              border: `1px solid ${currentTheme.cardBorder}`,
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.8rem'
                            }
                          }, t.cancel || 'Cancel')
                        )
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
            onClick: () => window.exportTaxPDF(transactions, taxJurisdiction, currentYear),
            style: {
              padding: '0.5rem 1rem',
              background: currentTheme.accent,
              color: '#13110a',
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
          React.createElement('div', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
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
          React.createElement('div', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
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
          React.createElement('div', { style: { color: currentTheme.warning, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
            `${formatPrice(taxData.taxLiability || 0)} ${getCurrencySymbol()}`
          )
        )
      )
    );
  };

  // ========== PLACEHOLDER FOR ANALYTICS ==========
  
  const renderAnalyticsPlaceholder = (name) => {
    return React.createElement('div', {
      style: { padding: '3rem', textAlign: 'center', color: currentTheme.textSecondary }
    },
      React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.75rem', color: 'rgba(245,158,11,0.7)', fontWeight: '300' } }, '!'),
      React.createElement('div', { style: { fontWeight: '600', marginBottom: '0.5rem', color: currentTheme.text } }, name),
      React.createElement('div', { style: { fontSize: '0.875rem' } },
        t.moduleNotLoaded || 'Module not loaded. Check the browser console for errors.'
      )
    );
  };

  // ========== PASSWORD CHANGE MODAL ==========

  const renderPasswordModal = () => {
    if (!showPasswordModal) return null;
    return React.createElement(PasswordModal, {
      theme: currentTheme, t,
      onClose: () => setShowPasswordModal(false),
      addToast
    });
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
        currency: currency,
        targetPortfolioId: activePortfolioId,
      });
    };
    
    return React.createElement('div', {
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(4,6,10,0.62)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(8px)'
      },
      onClick: (e) => e.target === e.currentTarget && closeModal()
    },
      React.createElement('div', {
        style: {
          background: currentTheme.modalBg,
          border: `1px solid ${currentTheme.modalBorder}`,
          padding: '2rem',
          borderRadius: '16px',
          width: '480px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 32px 70px -20px rgba(0,0,0,0.75)'
        }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' }
        }, isEditing ? (t.editTransaction || 'Edit Transaction') : (t.addTransaction || 'Add Transaction')),
        
        // Portfolio selector — always shown as a select dropdown
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', { style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' } }, 'Portfolio'),
          React.createElement('select', {
            value: newTransaction.targetPortfolioId || activePortfolioId,
            onChange: e => setNewTransaction(prev => ({ ...prev, targetPortfolioId: e.target.value })),
            style: {
              width: '100%', padding: '0.625rem 0.875rem',
              background: currentTheme.inputBg,
              border: `1px solid ${currentTheme.inputBorder}`,
              borderRadius: '8px', color: currentTheme.text,
              fontSize: '0.875rem', cursor: 'pointer'
            }
          },
            portfolios.map(p =>
              React.createElement('option', { key: p.id, value: p.id }, p.name)
            )
          )
        ),

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
            ['crypto', 'stocks', 'skins', 'commodities'].map(cat =>
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
        
          // Symbol / Skin / Commodity Picker
          React.createElement('div', { style: { marginBottom: '1rem' } },
            React.createElement('label', {
              style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
            }, t.symbol || 'Symbol'),

            // CS2 Skin Picker
            newTransaction.category === 'skins' && window.MaerminFeatures3?.CS2SkinPicker
              ? React.createElement('div', null,
                  React.createElement(window.MaerminFeatures3.CS2SkinPicker, {
                    workerUrl: apiKeys.cs2Worker, theme: currentTheme,
                    selectedName: newTransaction.symbol,
                    onSelect: ({ name, price, image }) => {
                      // Skin search prices are USD: store full precision (no
                      // premature rounding) and mark the tx currency USD so the
                      // cost basis converts to EUR exactly like fetched prices.
                      setNewTransaction(prev => ({ ...prev, symbol: name,
                        price: (price != null && price !== '') ? String(price) : prev.price,
                        currency: 'USD',
                        skinIconUrl: image || prev.skinIconUrl }));
                    }
                  }),
                  newTransaction.symbol && React.createElement('div', {
                    style: { marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', background: 'rgba(6,182,212,0.06)', borderRadius: '8px', border: '1px solid rgba(6,182,212,0.15)' }
                  },
                    newTransaction.skinIconUrl
                      ? React.createElement('img', { src: newTransaction.skinIconUrl, alt: newTransaction.symbol, style: { width: 80, height: 47, objectFit: 'contain', borderRadius: '6px', background: 'rgba(0,0,0,0.2)' } })
                      : React.createElement('div', { style: { width: 80, height: 47, background: 'rgba(6,182,212,0.1)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
                          React.createElement('span', { style: { color: 'rgba(6,182,212,0.5)', fontSize: '0.7rem' } }, 'CS2')),
                    React.createElement('div', null,
                      React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '0.8rem' } }, newTransaction.symbol),
                      newTransaction.price && React.createElement('div', { style: { color: '#22c55e', fontSize: '0.75rem', marginTop: '0.125rem' } }, `$${parseFloat(newTransaction.price).toFixed(2)}`)
                    )
                  )
                )

            // Stock Symbol Picker
            : (newTransaction.category === 'stocks' || newTransaction.category === 'crypto') && window.MaerminFeatures3?.SymbolPicker
              ? React.createElement(window.MaerminFeatures3.SymbolPicker, {
                  category: newTransaction.category,
                  workerUrl: apiKeys.cs2Worker,
                  theme: currentTheme,
                  selectedSymbol: newTransaction.symbol,
                  selectedName: newTransaction.symbolName || '',
                  onSelect: ({ symbol, ticker, name, logoUrl, exchange }) => {
                    if (!symbol) {
                      setNewTransaction(prev => ({ ...prev, symbol: '', symbolName: '', symbolLogoUrl: '' }));
                      return;
                    }
                    setNewTransaction(prev => ({
                      ...prev,
                      symbol,           // exact API symbol (CoinGecko ID or YF ticker)
                      symbolName: name, // human-readable name stored for display
                      symbolLogoUrl: logoUrl || '',
                    }));
                  }
                })
            : newTransaction.category === 'commodities'
              ? React.createElement('div', null,
                  // Preset buttons
                  React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.625rem' } },
                    [
                      { sym: 'GOLD',    label: 'Gold',         icon: '◈', color: '#f59e0b', unit: 'troy oz' },
                      { sym: 'SILVER',  label: 'Silver',       icon: '◈', color: '#94a3b8', unit: 'troy oz' },
                      { sym: 'PLATINUM',label: 'Platinum',     icon: '◈', color: '#60a5fa', unit: 'troy oz' },
                      { sym: 'PALLADIUM',label:'Palladium',    icon: '◈', color: '#a78bfa', unit: 'troy oz' },
                      { sym: 'OIL',     label: 'Oil (WTI)',    icon: '◉', color: '#78716c', unit: 'barrel' },
                      { sym: 'BRENT',   label: 'Oil (Brent)',  icon: '◉', color: '#57534e', unit: 'barrel' },
                      { sym: 'GAS',     label: 'Natural Gas',  icon: '◎', color: '#4ade80', unit: 'MMBtu' },
                      { sym: 'COPPER',  label: 'Copper',       icon: '◆', color: '#fb923c', unit: 'lb' },
                      { sym: 'WHEAT',   label: 'Wheat',        icon: '◇', color: '#fcd34d', unit: 'bushel' },
                      { sym: 'CORN',    label: 'Corn',         icon: '◇', color: '#fde68a', unit: 'bushel' },
                    ].map(c => React.createElement('button', {
                      key: c.sym,
                      onClick: () => setNewTransaction(prev => ({ ...prev, symbol: c.sym, notes: prev.notes || `${c.label} (${c.unit})` })),
                      style: {
                        padding: '0.35rem 0.75rem', border: `1px solid ${newTransaction.symbol === c.sym ? c.color : currentTheme.cardBorder}`,
                        borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '600',
                        background: newTransaction.symbol === c.sym ? `${c.color}22` : currentTheme.inputBg,
                        color: newTransaction.symbol === c.sym ? c.color : currentTheme.textSecondary,
                        display: 'flex', alignItems: 'center', gap: '0.25rem'
                      }
                    }, c.label))
                  ),
                  // Also allow free-text for ETFs like GLD, SLV
                  React.createElement('input', {
                    type: 'text', value: newTransaction.symbol,
                    onChange: e => setNewTransaction(prev => ({ ...prev, symbol: e.target.value.toUpperCase() })),
                    placeholder: 'or enter ETF symbol: GLD, SLV, IAU...',
                    style: { width: '100%', padding: '0.625rem 0.875rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '8px', color: currentTheme.text, fontSize: '0.875rem', boxSizing: 'border-box' }
                  })
                )

            // Default fallback: plain text (for categories without picker)
            : React.createElement('input', {
                type: 'text', value: newTransaction.symbol,
                onChange: e => setNewTransaction(prev => ({ ...prev, symbol: e.target.value.toUpperCase() })),
                placeholder: 'Symbol...',
                style: { width: '100%', padding: '0.75rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '8px', color: currentTheme.text }
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
          React.createElement('div', { style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
            `${(parseFloat(newTransaction.quantity) * parseFloat(newTransaction.price)).toFixed(2)} ${newTransaction.currency || 'EUR'}`
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
        background: 'rgba(4,6,10,0.62)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(8px)'
      },
      onClick: (e) => e.target === e.currentTarget && setShowImportModal(false)
    },
      React.createElement('div', {
        style: {
          background: currentTheme.modalBg,
          border: `1px solid ${currentTheme.modalBorder}`,
          padding: '2rem',
          borderRadius: '16px',
          width: '600px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 32px 70px -20px rgba(0,0,0,0.75)'
        }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, marginBottom: '1rem', fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' }
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
        background: 'rgba(4,6,10,0.62)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(8px)'
      },
      onClick: (e) => e.target === e.currentTarget && setShowApiSettings(false)
    },
      React.createElement('div', {
        style: {
          background: currentTheme.modalBg,
          border: `1px solid ${currentTheme.modalBorder}`,
          padding: '2rem',
          borderRadius: '16px',
          width: '500px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 32px 70px -20px rgba(0,0,0,0.75)'
        }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' }
        }, t.apiSettings || 'API Settings'),
        
        React.createElement('p', {
          style: { color: currentTheme.textSecondary, marginBottom: '1.5rem', fontSize: '0.875rem', lineHeight: '1.5' }
        }, 'Configure API keys for live prices. Crypto (CoinGecko) and exchange rates are always free.'),

        // ── Cloudflare Worker (CS2 + Yahoo Finance Historical Data) ─────────
        React.createElement('div', {
          style: { background: `linear-gradient(135deg, rgba(245,165,36,0.08), rgba(59,130,246,0.05))`, border: `1px solid rgba(245,165,36,0.25)`, padding: '1.25rem', borderRadius: '10px', marginBottom: '1rem' }
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' } },
            React.createElement('div', null,
              React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1rem', fontWeight: '700' } }, 'Cloudflare Worker'),
              React.createElement('div', { style: { display: 'flex', gap: '0.375rem', marginTop: '0.25rem', flexWrap: 'wrap' } },
                React.createElement('span', { style: { fontSize: '0.68rem', padding: '0.15rem 0.4rem', borderRadius: '3px', background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: '700' } }, 'Free · No API key'),
                React.createElement('span', { style: { fontSize: '0.68rem', padding: '0.15rem 0.4rem', borderRadius: '3px', background: 'rgba(6,182,212,0.12)', color: '#06b6d4', fontWeight: '700' } }, 'CS2 Skin Prices'),
                React.createElement('span', { style: { fontSize: '0.68rem', padding: '0.15rem 0.4rem', borderRadius: '3px', background: 'rgba(59,130,246,0.12)', color: '#3b82f6', fontWeight: '700' } }, 'Yahoo Finance Chart Data'),
              )
            ),
            React.createElement('span', {
              style: { fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: '600',
                background: (apiKeys.cs2Worker||'').trim().length > 5 ? 'rgba(34,197,94,0.18)' : 'rgba(245,158,11,0.15)',
                color: (apiKeys.cs2Worker||'').trim().length > 5 ? currentTheme.success : currentTheme.warning }
            }, (apiKeys.cs2Worker||'').trim().length > 5 ? '✓ Configured' : 'Not configured')
          ),
          React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.8rem', marginBottom: '0.875rem', lineHeight: '1.6' } },
            'One Worker URL — three features: CS2 skin prices (Steam), historical portfolio chart (Yahoo Finance), and CS2 price history (Steam). No API key needed.'
          ),
          // Three-column feature overview
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '0.875rem' } },
            React.createElement('div', { style: { background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.15)', borderRadius: '6px', padding: '0.625rem 0.75rem', fontSize: '0.72rem', color: currentTheme.textSecondary, lineHeight: '1.6' } },
              React.createElement('div', { style: { color: '#06b6d4', fontWeight: '700', marginBottom: '0.25rem' } }, 'CS2 Skin Prices'),
              React.createElement('div', null, '→ Steam Market prices'),
              React.createElement('div', null, '→ Search with images'),
              React.createElement('div', null, '→ Real-time via POST')
            ),
            React.createElement('div', { style: { background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', borderRadius: '6px', padding: '0.625rem 0.75rem', fontSize: '0.72rem', color: currentTheme.textSecondary, lineHeight: '1.6' } },
              React.createElement('div', { style: { color: '#3b82f6', fontWeight: '700', marginBottom: '0.25rem' } }, 'Portfolio History Chart'),
              React.createElement('div', null, '→ Yahoo Finance'),
              React.createElement('div', null, '→ NYSE, XETRA, London…'),
              React.createElement('div', null, '→ 1H to Max periods')
            ),
            React.createElement('div', { style: { background: 'rgba(245,165,36,0.06)', border: '1px solid rgba(245,165,36,0.15)', borderRadius: '6px', padding: '0.625rem 0.75rem', fontSize: '0.72rem', color: currentTheme.textSecondary, lineHeight: '1.6' } },
              React.createElement('div', { style: { color: '#f5a524', fontWeight: '700', marginBottom: '0.25rem' } }, 'CS2 Price History'),
              React.createElement('div', null, '→ Steam price history'),
              React.createElement('div', null, '→ Per skin over time'),
              React.createElement('div', null, '→ Shown in portfolio chart')
            )
          ),
          React.createElement('div', {
            style: { background: currentTheme.inputBg, borderRadius: '8px', padding: '0.875rem', marginBottom: '0.875rem', fontSize: '0.78rem', color: currentTheme.textSecondary, lineHeight: '1.8' }
          },
            React.createElement('div', { style: { fontWeight: '700', color: currentTheme.text, marginBottom: '0.375rem' } }, 'Update existing Worker (~1 min):'),
            React.createElement('div', null, '1. ', React.createElement('a', { href: 'https://dash.cloudflare.com', target: '_blank', rel: 'noopener noreferrer', style: { color: currentTheme.accent } }, 'dash.cloudflare.com'), ' → Workers & Pages → your Worker'),
            React.createElement('div', null, '2. Edit code → paste contents of ', React.createElement('code', { style: { background: 'rgba(0,0,0,0.2)', padding: '0 4px', borderRadius: '3px' } }, 'cf-worker/worker.js'), ' from ZIP'),
            React.createElement('div', null, '3. Save and Deploy — no secrets needed'),
            React.createElement('div', null, '4. Paste the Worker URL below')
          ),
          React.createElement('label', { style: { display: 'block', color: currentTheme.textSecondary, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.375rem' } },
            'Worker URL — used for CS2 prices, portfolio history chart & CS2 price history'
          ),
          React.createElement('input', {
            type: 'text',
            value: apiKeys.cs2Worker || '',
            onChange: e => setApiKeys(prev => ({ ...prev, cs2Worker: e.target.value })),
            placeholder: 'https://your-worker-name.your-subdomain.workers.dev',
            style: { width: '100%', padding: '0.75rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '6px', color: currentTheme.text, fontSize: '0.8rem', fontFamily: 'monospace' }
          })
        ),

        // Alpha Vantage Section — Fallback only
        React.createElement('div', {
          style: { background: currentTheme.inputBg, padding: '1.25rem', borderRadius: '8px', marginBottom: '1rem' }
        },
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }
          },
            React.createElement('div', null,
              React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1rem', fontWeight: '600' } }, 'Alpha Vantage'),
              React.createElement('span', { style: { fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: '3px', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', fontWeight: '700' } }, 'Fallback only — optional')
            ),
            React.createElement('span', {
              style: { fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '4px',
                background: apiKeys.alphaVantage ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.06)',
                color: apiKeys.alphaVantage ? currentTheme.success : currentTheme.textSecondary }
            }, apiKeys.alphaVantage ? 'Configured' : 'Not configured')
          ),
          React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.8rem', marginBottom: '0.75rem', lineHeight: '1.5' } },
            'Only used when the Cloudflare Worker is not set or Yahoo Finance returns no data for a symbol. Stock & commodity prices are fetched via Yahoo Finance first. Free tier: 25 requests/day.'
          ),
          React.createElement('input', {
            type: 'password',
            value: apiKeys.alphaVantage || '',
            onChange: (e) => setApiKeys(prev => ({ ...prev, alphaVantage: e.target.value })),
            placeholder: 'Enter Alpha Vantage API Key (optional)',
            style: { width: '100%', padding: '0.75rem', background: currentTheme.background, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '6px', color: currentTheme.text, marginBottom: '0.5rem' }
          }),
          React.createElement('a', {
            href: 'https://www.alphavantage.co/support/#api-key',
            target: '_blank', rel: 'noopener noreferrer',
            style: { color: currentTheme.accent, fontSize: '0.8rem', textDecoration: 'none' }
          }, 'Get free API key from alphavantage.co')
        ),

        // Steam Market Info Section
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
            color: '#13110a',
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
        padding: '0.85rem 1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: `1px solid ${currentTheme.cardBorder}`,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: theme === 'white' ? 'rgba(255,255,255,0.72)' : 'rgba(10,13,19,0.62)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)'
      }
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' } },
        // Brand mark — gold gemstone
        React.createElement('div', {
          style: {
            width: '30px', height: '30px', borderRadius: '9px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(140deg, #ffd479 0%, #f5a524 55%, #d97706 100%)',
            color: '#13110a', fontWeight: '900', fontSize: '1rem',
            boxShadow: '0 4px 14px -4px rgba(245,165,36,0.6)'
          }
        }, '◆'),
        React.createElement('h1', {
          style: {
            fontSize: '1.35rem',
            fontWeight: '800',
            letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #ffd479 0%, #f5a524 60%, #d97706 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }
        }, 'MAERMIN'),
        React.createElement('span', {
          style: {
            fontSize: '0.68rem',
            fontWeight: '600',
            padding: '0.2rem 0.5rem',
            background: currentTheme.accentSoft,
            border: `1px solid ${currentTheme.accent}40`,
            borderRadius: '999px',
            color: currentTheme.accent,
            letterSpacing: '0.02em'
          }
        }, 'v9.0'),

      ),

      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' }, ref: settingsRef },
        // Command palette hint
        React.createElement('button', {
          onClick: () => setShowCommandPalette(true),
          style: {
            padding: '0.5rem 0.85rem',
            background: currentTheme.inputBg,
            border: `1px solid ${currentTheme.cardBorder}`,
            borderRadius: '10px',
            color: currentTheme.textSecondary,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem',
            minWidth: '180px'
          },
          onMouseEnter: e => { e.currentTarget.style.borderColor = `${currentTheme.accent}55`; },
          onMouseLeave: e => { e.currentTarget.style.borderColor = currentTheme.cardBorder; }
        },
          React.createElement('span', { style: { opacity: 0.7 } }, '⌕'),
          React.createElement('span', { style: { flex: 1, textAlign: 'left' } }, t.searchCommands || 'Search...'),
          React.createElement('kbd', {
            style: {
              padding: '0.1rem 0.4rem',
              background: currentTheme.card,
              border: `1px solid ${currentTheme.cardBorder}`,
              borderRadius: '5px',
              fontSize: '0.7rem',
              fontFamily: 'ui-monospace, monospace'
            }
          }, '⌘K')
        ),

        // Privacy toggle (mask all amounts)
        React.createElement('button', {
          onClick: () => setPrivacyMode(p => !p),
          title: (privacyMode ? (t.showAmounts || 'Show amounts') : (t.hideAmounts || 'Hide amounts')) + ' (p)',
          style: {
            width: '38px', height: '38px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: privacyMode ? currentTheme.accent : currentTheme.inputBg,
            border: `1px solid ${privacyMode ? currentTheme.accent : currentTheme.cardBorder}`,
            borderRadius: '10px',
            color: privacyMode ? currentTheme.accentText : currentTheme.text,
            cursor: 'pointer',
            fontSize: '1rem',
            transition: 'all 0.15s'
          }
        }, privacyMode ? '⦸' : '⦿'),

        // Settings button
        React.createElement('button', {
          onClick: () => setShowSettings(!showSettings),
          title: t.settings || 'Settings',
          style: {
            width: '38px', height: '38px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: showSettings ? currentTheme.accent : currentTheme.inputBg,
            border: `1px solid ${showSettings ? currentTheme.accent : currentTheme.cardBorder}`,
            borderRadius: '10px',
            color: showSettings ? currentTheme.accentText : currentTheme.text,
            cursor: 'pointer',
            fontSize: '1rem',
            transition: 'all 0.15s'
          }
        }, '⚙'),

        // Settings dropdown
        showSettings && React.createElement('div', {
          style: {
            position: 'absolute',
            top: '58px',
            right: '1rem',
            background: currentTheme.modalBg,
            border: `1px solid ${currentTheme.modalBorder}`,
            padding: '1rem',
            borderRadius: '12px',
            boxShadow: '0 20px 40px -8px rgba(0,0,0,0.5)',
            zIndex: 2000,
            minWidth: '220px'
          }
        },
          // Theme
          React.createElement('div', { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { color: currentTheme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, t.theme || 'Theme'),
            React.createElement('div', { style: { display: 'flex', gap: '0.4rem', marginTop: '0.5rem' } },
              [['white','Light'],['dark','Dark'],['purple','Purple']].map(([th, ico]) =>
                React.createElement('button', {
                  key: th,
                  onClick: () => setTheme(th),
                  style: {
                    flex: 1,
                    padding: '0.4rem',
                    background: theme === th ? currentTheme.accent : currentTheme.inputBg,
                    color: theme === th ? '#fff' : currentTheme.text,
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px'
                  }
                }, ico, React.createElement('span', { style: { fontSize: '0.65rem' } }, th.charAt(0).toUpperCase() + th.slice(1)))
              )
            )
          ),
          // Currency
          React.createElement('div', { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { color: currentTheme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, t.currency || 'Currency'),
            React.createElement('div', { style: { display: 'flex', gap: '0.4rem', marginTop: '0.5rem' } },
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
                    fontSize: '0.8rem',
                    fontWeight: currency === curr ? '600' : '400'
                  }
                }, curr === 'EUR' ? '€ EUR' : '$ USD')
              )
            )
          ),
          // Privacy
          React.createElement('div', { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { color: currentTheme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, t.privacy || 'Privacy'),
            React.createElement('button', {
              onClick: () => setPrivacyMode(p => !p),
              title: 'Shortcut: p',
              style: {
                width: '100%', padding: '0.5rem 0.6rem', marginTop: '0.5rem',
                background: privacyMode ? currentTheme.accent : currentTheme.inputBg,
                color: privacyMode ? '#fff' : currentTheme.text, border: 'none',
                borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }
            },
              React.createElement('span', null, t.hideAmounts || 'Hide amounts'),
              React.createElement('span', { style: { opacity: 0.85 } }, privacyMode ? 'ON' : 'OFF')
            )
          ),
          // Divider
          React.createElement('div', { style: { height: '1px', background: currentTheme.cardBorder, margin: '0.75rem 0' } }),
          // Change Password
          React.createElement('button', {
            onClick: () => { setShowSettings(false); setShowPasswordModal(true); },
            style: {
              width: '100%', padding: '0.5rem', background: 'transparent',
              color: currentTheme.textSecondary, border: 'none',
              borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem',
              textAlign: 'left', marginBottom: '0.25rem'
            }
          }, (t.changePassword || 'Change Password')),
          // API Settings
          React.createElement('button', {
            onClick: () => { setShowSettings(false); setShowApiSettings(true); },
            style: {
              width: '100%', padding: '0.5rem', background: 'transparent',
              color: currentTheme.textSecondary, border: 'none',
              borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem',
              textAlign: 'left', marginBottom: '0.25rem'
            }
          }, (t.apiSettings || 'API Settings')),
          // Divider
          React.createElement('div', { style: { height: '1px', background: currentTheme.cardBorder, margin: '0.75rem 0' } }),
          // Logout
          React.createElement('button', {
            onClick: () => {
              if (window.MaerminAuth) window.MaerminAuth.logout();
            },
            style: {
              width: '100%',
              padding: '0.5rem',
              background: 'rgba(239,68,68,0.08)',
              color: currentTheme.danger,
              border: `1px solid rgba(239,68,68,0.2)`,
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: '500',
              textAlign: 'left'
            }
          }, (t.logout || 'Logout'))
        )
      )
    ),
    
    // Main layout
    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start' } },
      // Sidebar
      React.createElement('nav', {
        className: 'maermin-sidebar',
        style: {
          width: '236px',
          padding: '1rem 0.7rem',
          borderRight: `1px solid ${currentTheme.cardBorder}`,
          flexShrink: 0,
          position: 'sticky',
          top: '61px',
          height: 'calc(100vh - 61px)',
          overflowY: 'auto'
        }
      },
        [
          // ── Portfolio ──────────────────────────────
          { group: t.navGroupPortfolio || 'Portfolio' },
          { id: 'overview',         icon: '⊞', label: t.navOverview || 'Overview' },
          { id: 'transactions',     icon: '⇅', label: t.navTransactions || 'Transactions' },
          { id: 'portfolios',       icon: '▦', label: t.navPortfolios || 'Portfolios' },
          { id: 'net-worth',        icon: '∑', label: t.navNetWorth || 'Net Worth' },
          { id: 'dividends',        icon: '❖', label: t.navDividends || 'Dividends' },
          { id: 'journal',          icon: '✎', label: t.navJournal || 'Journal' },
          // ── Analysis ──────────────────────────────
          { group: t.navGroupAnalysis || 'Analysis' },
          { id: 'returns',          icon: '↗', label: t.navReturns || 'Returns & XIRR' },
          { id: 'rebalancing',      icon: '⇌', label: t.navRebalancing || 'Rebalancing' },
          { id: 'savings-plans',    icon: '⊕', label: t.navSavingsPlans || 'Savings Plans' },
          { id: 'cashflow',         icon: '∿', label: t.navCashflow || 'Cash Flow' },
          { id: 'fees',             icon: '%', label: t.navFees || 'Fee Analyzer' },
          { id: 'analytics',        icon: '◫', label: t.navRiskCorrelation || 'Risk & Correlation' },
          { id: 'health',           icon: '✚', label: t.navHealthScore || 'Health Score' },
          { id: 'investment-analysis', icon: '⊛', label: t.navStrategy || 'Strategy' },
          { id: 'tax',              icon: '§', label: t.navTaxFifo || 'Tax & FIFO' },
          // ── Tools ──────────────────────────────────
          { group: t.navGroupTools || 'Tools' },
          { id: 'watchlist',        icon: '☆', label: t.navWatchlist || 'Watchlist' },
          { id: 'alerts',           icon: '⚑', label: t.navPriceAlerts || 'Price Alerts' },
          { id: 'attribution',     icon: '⊿', label: t.navAttribution || 'Attribution' },
          { id: 'realized',         icon: '✓', label: t.navRealizedPnl || 'Realized P&L' },
          { id: 'news',             icon: '☰', label: t.navNewsFeed || 'News Feed' },
          { id: 'data',             icon: '⇆', label: t.navImportExport || 'Import / Export' },
        ].map((item, idx) => {
          // Section Header
          if (item.group) {
            return React.createElement('div', {
              key: 'group-' + idx,
              style: {
                padding: '0.9rem 0.75rem 0.45rem',
                fontSize: '0.64rem',
                fontWeight: '700',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: currentTheme.textSecondary,
                opacity: 0.65,
                marginTop: idx === 0 ? 0 : '0.6rem'
              }
            }, item.group);
          }
          // Nav Item
          const isActive = activeView === item.id ||
            (item.id === 'analytics' && ['correlation','montecarlo','stress','risk'].includes(activeView));
          return React.createElement('button', {
            key: item.id,
            onClick: () => setActiveView(item.id),
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              width: '100%',
              padding: '0.55rem 0.7rem',
              marginBottom: '0.12rem',
              background: isActive ? currentTheme.accentSoft : 'transparent',
              color: isActive ? currentTheme.accent : currentTheme.textSecondary,
              border: 'none',
              borderRadius: '10px',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '0.83rem',
              fontWeight: isActive ? '650' : '450',
              position: 'relative',
              transition: 'background 0.14s, color 0.14s'
            },
            onMouseEnter: e => { if (!isActive) { e.currentTarget.style.background = currentTheme.surface2; e.currentTarget.style.color = currentTheme.text; } },
            onMouseLeave: e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = currentTheme.textSecondary; } }
          },
            // Active indicator bar
            isActive && React.createElement('span', {
              style: { position: 'absolute', left: '-0.7rem', top: '50%', transform: 'translateY(-50%)', width: '3px', height: '60%', background: currentTheme.accent, borderRadius: '0 3px 3px 0' }
            }),
            React.createElement('span', {
              style: { fontSize: '0.95rem', width: '18px', textAlign: 'center', flexShrink: 0, opacity: isActive ? 1 : 0.85 }
            }, item.icon),
            item.label
          );
        }),
      ),

      // Main content
      React.createElement('main', {
        className: 'maermin-main',
        style: { flex: 1, minWidth: 0, overflow: 'auto' }
      }, renderView())
    ),

    // Mobile Bottom Navigation
    window.MaerminFeatures2 && React.createElement(window.MaerminFeatures2.MobileBottomNav, {
      activeView, setActiveView, theme: currentTheme
    }),
    
    // Modals
    renderTransactionModal(),
    renderImportModal(),
    renderApiSettingsModal(),
    renderPasswordModal(),
    
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
function __maerminMount() {
  root.render(React.createElement(InvestmentTracker));
  console.log('[MAERMIN v9.0] Application initialized');
}
// Wait for the vault to be unlocked before mounting, so the app reads DECRYPTED
// data (storage.js hydrates the in-memory store during unlock). Falls back to an
// immediate mount if the auth module is absent (backward compatible).
if (window.MaerminAuth && typeof window.MaerminAuth.whenUnlocked === 'function') {
  window.MaerminAuth.whenUnlocked().then(__maerminMount);
} else {
  __maerminMount();
}

})(); // End IIFE
