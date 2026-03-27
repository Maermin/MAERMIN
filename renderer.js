// ============================================================================
// MAERMIN v7.0 - Main Application
// Professional Multi-Asset Portfolio Tracker with Advanced Investment Analytics
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
    modalBg: '#ffffff',
    modalBorder: '#e2e8f0',
    text: '#1e293b',
    textSecondary: '#64748b',
    inputBg: '#f1f5f9',
    inputBorder: '#cbd5e1',
    accent: '#7e22ce',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b'
  },
  dark: {
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
    card: 'rgba(30,41,59,0.9)',
    cardBorder: 'rgba(255,255,255,0.1)',
    modalBg: '#1e293b',
    modalBorder: '#334155',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    inputBg: '#0f172a',
    inputBorder: '#334155',
    accent: '#8b5cf6',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b'
  },
  purple: {
    background: 'linear-gradient(135deg, #1e293b 0%, #7e22ce 50%, #1e293b 100%)',
    card: 'rgba(255,255,255,0.1)',
    cardBorder: 'rgba(255,255,255,0.2)',
    modalBg: '#2d1f47',
    modalBorder: '#4c3575',
    text: '#ffffff',
    textSecondary: 'rgba(255,255,255,0.7)',
    inputBg: '#3d2a5c',
    inputBorder: '#5c4080',
    accent: '#a855f7',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b'
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
      display.style.cssText = 'position:fixed;bottom:5rem;right:1.5rem;background:#1e293b;border:1px solid #334155;border-radius:10px;padding:1rem 1.25rem;z-index:99999;max-width:420px;color:white;font-size:0.8rem;box-shadow:0 10px 30px rgba(0,0,0,0.5)';
      display.innerHTML = `<div style="font-weight:700;margin-bottom:0.5rem">📋 New hash – copy to auth.js:</div><input readonly value="${newHash}" onclick="this.select()" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:0.5rem;color:#a855f7;font-family:monospace;font-size:0.75rem"><div style="color:#94a3b8;margin-top:0.5rem;font-size:0.7rem">Replace MAERMIN_SECRET_HASH in auth.js with this value</div><button onclick="this.parentElement.remove()" style="margin-top:0.5rem;background:none;border:1px solid #334155;border-radius:4px;color:#94a3b8;cursor:pointer;padding:0.25rem 0.5rem;font-size:0.75rem">✕ Close</button>`;
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
    style: { position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',display:'flex',justifyContent:'center',alignItems:'center',zIndex:10001,backdropFilter:'blur(4px)' }
  },
    React.createElement('div', {
      style: { background: theme.modalBg, border:`2px solid ${theme.modalBorder}`, borderRadius:'16px', padding:'2rem', width:'380px', maxWidth:'90vw', boxShadow:'0 25px 50px -12px rgba(0,0,0,0.5)' }
    },
      React.createElement('h2', { style:{ color:theme.text, fontSize:'1.25rem', fontWeight:'700', marginBottom:'1.25rem' } },
        '🔐 ' + (t.changePassword || 'Change Password')
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
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [language, setLanguage] = useState(() => localStorage.getItem('language') || 'en');
  
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
    currency: 'EUR' // Track which currency the transaction was added in
  });
  const [showTransactionModal, setShowTransactionModal] = useState(false);
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

  // Category display names
  const getCategoryDisplayName = (category) => {
    const displayNames = { crypto: t.crypto || 'Crypto', stocks: t.stocks || 'Stocks', skins: t.cs2Skins || 'CS2 Skins' };
    return displayNames[category] || category;
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
    // Portfolio
    { id: 'nav:overview',      label: t.overview || 'Übersicht',          category: 'Portfolio',  shortcut: 'g o' },
    { id: 'nav:transactions',  label: t.transactions || 'Transaktionen',   category: 'Portfolio',  shortcut: 'g t' },
    { id: 'nav:dividends',     label: t.dividendCalendar || 'Dividenden',  category: 'Portfolio',  shortcut: 'g d' },
    { id: 'nav:journal',       label: t.tradeJournal || 'Journal',         category: 'Portfolio',  shortcut: 'g j' },
    // Analyse
    { id: 'nav:returns',       label: t.returns || 'Rendite & XIRR',       category: 'Analyse',    shortcut: 'g r' },
    { id: 'nav:rebalancing',   label: t.rebalancing || 'Rebalancing',      category: 'Analyse',    shortcut: 'g b' },
    { id: 'nav:analytics',     label: t.analytics || 'Portfolio-Analyse',  category: 'Analyse',    shortcut: 'g a' },
    { id: 'nav:taxes',         label: t.taxes || 'Steuern',               category: 'Analyse',    shortcut: 'g x' },
    // Tools
    { id: 'nav:watchlist',     label: t.watchlist || 'Watchlist',          category: 'Tools',      shortcut: 'g w' },
    { id: 'nav:alerts',        label: t.priceAlerts || 'Preisalarme',      category: 'Tools',      shortcut: 'g l' },
    { id: 'nav:broker-import', label: t.brokerImport || 'Broker-Import',   category: 'Tools',      shortcut: 'g m' },
    // Aktionen
    { id: 'action:add',        label: t.addTransaction || 'Transaktion hinzufügen', category: 'Aktionen', shortcut: 'n' },
    { id: 'action:refresh',    label: t.refresh || 'Preise aktualisieren', category: 'Aktionen',   shortcut: 'r' },
    { id: 'action:backup',     label: t.createBackup || 'Backup erstellen', category: 'Aktionen',  shortcut: 'b' },
    { id: 'action:import',     label: t.importData || 'Daten importieren', category: 'Aktionen',   shortcut: 'i' },
    // Einstellungen
    { id: 'settings:dark',     label: t.darkMode || 'Dark Mode',           category: 'Design' },
    { id: 'settings:light',    label: t.whiteMode || 'Light Mode',         category: 'Design' },
    { id: 'settings:purple',   label: t.purpleMode || 'Purple Mode',       category: 'Design' },
    { id: 'settings:lang-de',  label: 'Deutsch',                           category: 'Sprache' },
    { id: 'settings:lang-en',  label: 'English',                           category: 'Sprache' },
    { id: 'help:shortcuts',    label: t.keyboardShortcuts || 'Tastenkürzel', category: 'Hilfe',    shortcut: '?' },
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
    if (saved('language')) setLanguage(saved('language'));
    if (saved('currency')) setCurrency(saved('currency'));
    if (saved('apiKeys')) setApiKeys(JSON.parse(saved('apiKeys')));
    if (saved('priceHistory')) setPriceHistory(JSON.parse(saved('priceHistory')));
  }, []);

  useEffect(() => { localStorage.setItem('theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('language', language); }, [language]);
  useEffect(() => { localStorage.setItem('currency', currency); }, [currency]);
  useEffect(() => { localStorage.setItem('transactions', JSON.stringify(transactions)); }, [transactions]);
  useEffect(() => { localStorage.setItem('priceHistory', JSON.stringify(priceHistory)); }, [priceHistory]);
  useEffect(() => { localStorage.setItem('taxJurisdiction', taxJurisdiction); }, [taxJurisdiction]);
  useEffect(() => { localStorage.setItem('apiKeys', JSON.stringify(apiKeys)); }, [apiKeys]);

  // ========== API FUNCTIONS ==========
  
  const fetchPrices = async () => {
    setLoading(true);
    const newPrices = { ...prices };
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
      
      // ── CS2 Skin Prices ────────────────────────────────────────────────────
      // Priority:
      //   1. Pricempire API (if key set) → real market prices from DMarket/Skinport
      //   2. Steam Community Market (fallback, ~15-30% above market value)
      if (portfolio.skins && portfolio.skins.length > 0) {

        if (apiKeys.pricempire) {
          // ── Pricempire via Cloudflare Worker (CORS proxy) ─────────────────
          // The Worker forwards the request server-side and adds CORS headers.
          // API key is stored as a Worker secret — never sent to the browser.
          // Worker URL format: https://maermin-pricempire-proxy.<your-subdomain>.workers.dev
          try {
            const workerUrl = apiKeys.pricempire.startsWith('https://')
              ? apiKeys.pricempire  // User entered the Worker URL directly
              : null;

            if (!workerUrl) {
              addToast('CS2: paste your Worker URL in ⚙ API Settings (see setup guide)', 'warning');
              console.warn('[PRICES] Pricempire: no Worker URL set. Paste the Cloudflare Worker URL into API Settings.');
            } else {
              const url = `${workerUrl.replace(/\/$/, '')}?app_id=730&sources=dmarket,skinport,cs.money&currency=EUR`;
              console.log('[PRICES] Pricempire: fetching via Worker...');

              const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

              if (res.ok) {
                const items = await res.json();
                if (!Array.isArray(items)) throw new Error('Unexpected response format');

                // Build lookup map: name (lower) → best EUR price
                const priceMap = {};
                const PREFERRED = ['dmarket','skinport','cs.money','skinbaron','lis-skins'];
                items.forEach(item => {
                  const name = (item.market_hash_name || '').toLowerCase();
                  if (!name || !Array.isArray(item.prices)) return;
                  let best = null;
                  for (const src of PREFERRED) {
                    const entry = item.prices.find(p => p.provider_key === src && p.price > 0 && p.count > 0);
                    if (entry) {
                      const eur = entry.price / 100; // EUR cents → EUR
                      if (best === null || eur < best) best = eur;
                    }
                  }
                  if (best !== null && best > 0) priceMap[name] = best;
                });

                console.log('[PRICES] Pricempire: price map for', Object.keys(priceMap).length, 'items');

                let matchedCount = 0;
                portfolio.skins.forEach(skin => {
                  const skinName = (skin.symbol || skin.name || '').trim();
                  const skinLower = skinName.toLowerCase();
                  let price = priceMap[skinLower];
                  if (!price) {
                    const base = skinLower.replace(/\s*\([^)]*\)\s*/g, '').trim();
                    const found = Object.keys(priceMap).find(k => k.replace(/\s*\([^)]*\)\s*/g,'').trim() === base);
                    if (found) price = priceMap[found];
                  }
                  if (price) {
                    newPrices[skinLower] = price;
                    newPrices[skinName] = price;
                    matchedCount++;
                    console.log('[PRICES] CS2:', skinName, '→', price.toFixed(2), 'EUR');
                  } else {
                    console.warn('[PRICES] No price for:', skinName);
                  }
                });

                console.log('[PRICES] CS2 matched:', matchedCount, '/', portfolio.skins.length);
                if (matchedCount < portfolio.skins.length) {
                  addToast(`CS2: ${matchedCount}/${portfolio.skins.length} matched — check names match Steam Market exactly`, 'info');
                }

              } else if (res.status === 401) {
                addToast('Pricempire: invalid API key in Worker secret — re-run: wrangler secret put PRICEMPIRE_KEY', 'error');
              } else if (res.status === 429) {
                addToast('Pricempire: rate limit — free tier: 30k calls/month', 'warning');
              } else if (res.status === 403) {
                addToast('Worker: origin not allowed — add maermin.github.io to ALLOWED_ORIGINS in worker.js', 'error');
              } else {
                console.error('[PRICES] Worker HTTP', res.status);
                addToast('Pricempire Worker error: HTTP ' + res.status, 'warning');
              }
            }
          } catch (e) {
            console.error('[PRICES] Pricempire Worker error:', e.message);
            addToast('CS2 Worker fetch failed: ' + e.message, 'warning');
          }

        } else {
          // No Pricempire key — Steam Market also blocks CORS from GitHub Pages
          // Show a clear setup prompt instead of silent failure
          console.warn('[PRICES] No Pricempire key set — CS2 prices cannot be fetched from GitHub Pages due to CORS restrictions on all CS2 market APIs. Set a Pricempire key in ⚙ API Settings.');
          addToast('CS2 prices need a Pricempire API key — tap ⚙ API Settings to set one (free)', 'warning');
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
      version: '7.0.0',
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
      case 'nav:taxes':         setActiveView('taxes'); break;
      // Tools Navigation
      case 'nav:watchlist':     setActiveView('watchlist'); break;
      case 'nav:alerts':        setActiveView('alerts'); break;
      case 'nav:broker-import': setActiveView('broker-import'); break;
      // Aktionen
      case 'action:add':        setShowTransactionModal(true); break;
      case 'action:refresh':    fetchPrices(); break;
      case 'action:backup':     createBackup(); break;
      case 'action:import':     setShowImportModal(true); break;
      // Design
      case 'settings:dark':     setTheme('dark'); break;
      case 'settings:light':    setTheme('white'); break;
      case 'settings:purple':   setTheme('purple'); break;
      case 'settings:lang-de':  setLanguage('de'); break;
      case 'settings:lang-en':  setLanguage('en'); break;
      // Hilfe
      case 'help:shortcuts':    setShowShortcuts(true); break;
      default: break;
    }
  };

  // ========== RENDER VIEWS ==========
  
  const renderView = () => {
    switch (activeView) {
      case 'returns':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.ReturnsView, {
            transactions, portfolio, prices, priceHistory,
            theme: currentTheme, formatPrice, getCurrencySymbol, t
          }) : renderAnalyticsPlaceholder('Rendite-Analyse');

      case 'rebalancing':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.RebalancingView, {
            portfolio, prices, theme: currentTheme, formatPrice, getCurrencySymbol, t
          }) : renderAnalyticsPlaceholder('Rebalancing');

      case 'broker-import':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.BrokerImportWizard, {
            theme: currentTheme, t, addToast,
            onImport: (txs) => {
              const newTxs = txs.map((tx, i) => ({ id: (Date.now()+i).toString(), ...tx }));
              setTransactions(prev => [...prev, ...newTxs]);
            }
          }) : renderAnalyticsPlaceholder('Broker Import');

      case 'journal':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.PositionNotesView, {
            portfolio, theme: currentTheme, t
          }) : renderAnalyticsPlaceholder('Trade Journal');

      case 'dividends':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.DividendCalendarView, {
            portfolio, theme: currentTheme, t, addToast
          }) : renderAnalyticsPlaceholder('Dividenden');

      case 'watchlist':
        return window.MaerminFeatures ?
          React.createElement(window.MaerminFeatures.WatchlistView, {
            prices, priceHistory, theme: currentTheme, t, addToast
          }) : renderAnalyticsPlaceholder('Watchlist');

      case 'alerts':
        return window.MaerminFeatures ?
          React.createElement(window.MaerminFeatures.PriceAlertsView, {
            prices, theme: currentTheme, t, addToast
          }) : renderAnalyticsPlaceholder('Preisalarme');

      case 'transactions':
        return renderTransactionsView();
      
      case 'taxes':
        return renderTaxView();
      
      case 'analytics':
        return renderAnalyticsMenu();
      
      case 'investment-analysis':
        return window.InvestmentViews && window.InvestmentViews.InvestmentAnalysisDashboard ?
          React.createElement(window.InvestmentViews.InvestmentAnalysisDashboard, {
            portfolio, prices, priceHistory,
            theme: currentTheme, t, formatPrice
          }) : renderAnalyticsPlaceholder('Strategie-Analyse');
      
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
          flexWrap: 'wrap',
          alignItems: 'center'
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
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }
        },
          loading ? (t.loading || 'Loading...') : (t.refresh || 'Refresh'),
          lastRefresh && !loading && React.createElement('span', {
            style: { fontSize: '0.75rem', opacity: 0.6, fontWeight: '400' }
          }, lastRefresh.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))
        ),
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
      
      // CS2 setup banner — shown when user has CS2 skins but no Pricempire key
      portfolio.skins && portfolio.skins.length > 0 && !apiKeys.pricempire &&
        React.createElement('div', {
          style: {
            background: 'rgba(245,158,11,0.06)',
            border: '1px solid rgba(245,158,11,0.25)',
            borderRadius: '10px',
            padding: '0.875rem 1.25rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap'
          }
        },
          React.createElement('span', { style: { fontSize: '1.25rem' } }, '⚠️'),
          React.createElement('div', { style: { flex: 1, minWidth: '200px' } },
            React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '0.875rem' } },
              'CS2 skin prices need a Pricempire API key'
            ),
            React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.8rem', marginTop: '0.125rem' } },
              'All CS2 market APIs (Steam, Skinport) block browser requests. Pricempire is the only working option — free plan, no credit card.'
            )
          ),
          React.createElement('button', {
            onClick: () => setShowApiSettings(true),
            style: {
              padding: '0.5rem 1rem',
              background: currentTheme.warning,
              color: '#1a1a1a',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '700',
              fontSize: '0.8rem',
              whiteSpace: 'nowrap'
            }
          }, 'Set API Key →')
        ),

      // Onboarding hint when portfolio is empty
      portfolioStats.totalPositions === 0 && React.createElement('div', {
        style: {
          background: `linear-gradient(135deg, rgba(59,130,246,0.1), rgba(139,92,246,0.1))`,
          border: `1px solid rgba(139,92,246,0.3)`,
          borderRadius: '12px',
          padding: '2rem',
          marginBottom: '2rem',
          textAlign: 'center'
        }
      },
        React.createElement('div', { style: { fontSize: '2.5rem', marginBottom: '0.75rem' } }, '📈'),
        React.createElement('h3', {
          style: { color: currentTheme.text, fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.5rem' }
        }, t.welcomeTitle || 'Welcome to MAERMIN'),
        React.createElement('p', {
          style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginBottom: '1rem', lineHeight: '1.6' }
        }, t.welcomeHint || 'Start by adding your first transaction. Track Crypto, Stocks, and CS2 Skins – all in one place.'),
        React.createElement('div', {
          style: { display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }
        },
          React.createElement('button', {
            onClick: () => setShowTransactionModal(true),
            style: {
              padding: '0.625rem 1.25rem',
              background: currentTheme.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem'
            }
          }, '+ ' + (t.addTransaction || 'Add Transaction')),
          React.createElement('button', {
            onClick: () => setShowImportModal(true),
            style: {
              padding: '0.625rem 1.25rem',
              background: currentTheme.inputBg,
              color: currentTheme.text,
              border: `1px solid ${currentTheme.cardBorder}`,
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }
          }, t.importData || 'Import Data')
        )
      ),
      
      // Portfolio Overview Panel (Pie + Gainers/Losers)
      window.MaerminFeatures && portfolioStats.totalPositions > 0 &&
        React.createElement(window.MaerminFeatures.PortfolioOverviewPanel, {
          portfolio, prices, priceHistory,
          theme: currentTheme, formatPrice, getCurrencySymbol, t
        }),

      // Performance Chart
      window.MaerminFeatures && portfolioStats.totalPositions > 0 &&
        React.createElement(window.MaerminFeatures.PerformanceChart, {
          priceHistory, portfolio,
          theme: currentTheme, formatPrice, getCurrencySymbol
        }),

      // Positions Table (sortable)
      window.MaerminFeatures && portfolioStats.totalPositions > 0 &&
        React.createElement(window.MaerminFeatures.PositionsTable, {
          portfolio, prices, priceHistory,
          theme: currentTheme, formatPrice, getCurrencySymbol, t,
          onAddTransaction: () => setShowTransactionModal(true)
        }),

      // Recent positions (original, shown only when no features loaded)
      !window.MaerminFeatures && React.createElement('div', {
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
                React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600' } }, pos.symbol || pos.name),
                React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem' } },
                  `${pos.amount} @ ${formatPrice(pos.purchasePrice)}`
                )
              ),
              React.createElement('div', { style: { textAlign: 'right' } },
                React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600' } },
                  `${formatPrice(value)} ${getCurrencySymbol()}`
                ),
                React.createElement('div', {
                  style: { color: profit >= 0 ? currentTheme.success : currentTheme.danger, fontSize: '0.875rem' }
                }, `${profit >= 0 ? '+' : ''}${profitPercent.toFixed(2)}%`)
              )
            );
          })
        )
      )
    );
  };

  // ========== ANALYTICS MENU ==========
  
  const [analyticsTab, setAnalyticsTab] = useState('correlation');

  const renderAnalyticsMenu = () => {
    const tabs = [
      { id: 'correlation', label: t.correlationMatrix || 'Korrelation' },
      { id: 'montecarlo',  label: t.monteCarloSimulation || 'Monte Carlo' },
      { id: 'stress',      label: t.stressTesting || 'Stress-Test' },
      { id: 'risk',        label: t.riskLevel || 'Risiko' },
    ];

    const tabBtn = (id, label) => React.createElement('button', {
      key: id,
      onClick: () => setAnalyticsTab(id),
      style: {
        padding: '0.5rem 1rem', border: 'none', borderRadius: '8px', cursor: 'pointer',
        fontWeight: analyticsTab === id ? '600' : '400', fontSize: '0.875rem',
        background: analyticsTab === id ? currentTheme.accent : currentTheme.inputBg,
        color: analyticsTab === id ? '#fff' : currentTheme.text, transition: 'all 0.15s'
      }
    }, label);

    const renderContent = () => {
      switch(analyticsTab) {
        case 'correlation': return window.CorrelationMatrixView ?
          React.createElement(window.CorrelationMatrixView, { portfolio, priceHistory, t, theme: currentTheme, formatPrice })
          : renderAnalyticsPlaceholder('Korrelationsmatrix');
        case 'montecarlo': return window.MonteCarloView ?
          React.createElement(window.MonteCarloView, { portfolio, prices, t, theme: currentTheme, currency, formatPrice })
          : renderAnalyticsPlaceholder('Monte Carlo');
        case 'stress': return window.StressTestView ?
          React.createElement(window.StressTestView, { portfolio, prices, t, theme: currentTheme, currency, formatPrice })
          : renderAnalyticsPlaceholder('Stress-Test');
        case 'risk': return window.RiskAnalyticsViewV2 ?
          React.createElement(window.RiskAnalyticsViewV2, { portfolio, prices, priceHistory, t, theme: currentTheme, formatPrice })
          : renderAnalyticsPlaceholder('Risikoanalyse');
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
    // Filter
    const filtered = transactions.filter(tx => {
      if (!txSearch.trim()) return true;
      const q = txSearch.toLowerCase();
      return (tx.symbol || '').toLowerCase().includes(q) ||
             (tx.category || '').toLowerCase().includes(q) ||
             (tx.type || '').toLowerCase().includes(q) ||
             (tx.notes || '').toLowerCase().includes(q);
    });

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
          style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '600' }
        }, `${t.transactions || 'Transactions'} (${filtered.length}${filtered.length !== transactions.length ? '/' + transactions.length : ''})`),
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
            onClick: () => setShowTransactionModal(true),
            style: {
              padding: '0.5rem 1.25rem',
              background: currentTheme.accent,
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem'
            }
          }, '+ ' + (t.addTransaction || 'Add'))
        )
      ),

      // Export strip
      transactions.length > 0 && React.createElement('div', {
        style: { display: 'flex', gap: '0.5rem', marginBottom: '1rem' }
      },
        React.createElement('button', {
          onClick: () => createBackup(),
          style: {
            padding: '0.4rem 0.875rem',
            background: currentTheme.inputBg,
            color: currentTheme.text,
            border: `1px solid ${currentTheme.cardBorder}`,
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.8rem'
          }
        }, '💾 ' + (t.createBackup || 'Backup')),
        React.createElement('button', {
          onClick: () => exportData(),
          style: {
            padding: '0.4rem 0.875rem',
            background: currentTheme.inputBg,
            color: currentTheme.text,
            border: `1px solid ${currentTheme.cardBorder}`,
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.8rem'
          }
        }, '📤 ' + (t.exportData || 'Export CSV'))
      ),
      
      // Table
      React.createElement('div', {
        style: {
          background: currentTheme.card,
          borderRadius: '12px',
          border: `1px solid ${currentTheme.cardBorder}`,
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
                              background: 'rgba(139,92,246,0.15)',
                              color: currentTheme.accent,
                              border: `1px solid rgba(139,92,246,0.3)`,
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: '600'
                            }
                          }, '✏️'),
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
                          }, '🗑️')
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
      style: { padding: '3rem', textAlign: 'center', color: currentTheme.textSecondary }
    },
      React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.75rem' } }, '⚠️'),
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
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(4px)'
      },
      onClick: (e) => e.target === e.currentTarget && closeModal()
    },
      React.createElement('div', {
        style: {
          background: currentTheme.modalBg,
          border: `2px solid ${currentTheme.modalBorder}`,
          padding: '2rem',
          borderRadius: '16px',
          width: '480px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '700' }
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
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(4px)'
      },
      onClick: (e) => e.target === e.currentTarget && setShowImportModal(false)
    },
      React.createElement('div', {
        style: {
          background: currentTheme.modalBg,
          border: `2px solid ${currentTheme.modalBorder}`,
          padding: '2rem',
          borderRadius: '16px',
          width: '600px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, marginBottom: '1rem', fontSize: '1.5rem', fontWeight: '700' }
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
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10000,
        backdropFilter: 'blur(4px)'
      },
      onClick: (e) => e.target === e.currentTarget && setShowApiSettings(false)
    },
      React.createElement('div', {
        style: {
          background: currentTheme.modalBg,
          border: `2px solid ${currentTheme.modalBorder}`,
          padding: '2rem',
          borderRadius: '16px',
          width: '500px',
          maxWidth: '90vw',
          maxHeight: '85vh',
          overflow: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '700' }
        }, t.apiSettings || 'API Settings'),
        
        React.createElement('p', {
          style: { color: currentTheme.textSecondary, marginBottom: '1.5rem', fontSize: '0.875rem', lineHeight: '1.5' }
        }, 'Configure API keys for live prices. Crypto (CoinGecko) and exchange rates are always free.'),

        // ── Pricempire via Cloudflare Worker (CS2 — RECOMMENDED) ────────────
        React.createElement('div', {
          style: { background: `linear-gradient(135deg, rgba(139,92,246,0.08), rgba(59,130,246,0.05))`, border: `1px solid rgba(139,92,246,0.25)`, padding: '1.25rem', borderRadius: '10px', marginBottom: '1rem' }
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' } },
            React.createElement('div', null,
              React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1rem', fontWeight: '700' } }, 'Pricempire — CS2 Prices'),
              React.createElement('span', { style: { fontSize: '0.68rem', padding: '0.15rem 0.4rem', borderRadius: '3px', background: 'rgba(34,197,94,0.12)', color: '#22c55e', fontWeight: '700', letterSpacing: '0.04em' } }, 'RECOMMENDED · Free')
            ),
            React.createElement('span', {
              style: { fontSize: '0.75rem', padding: '0.25rem 0.5rem', background: (apiKeys.pricempire||'').startsWith('https://') ? 'rgba(34,197,94,0.18)' : 'rgba(245,158,11,0.15)', color: (apiKeys.pricempire||'').startsWith('https://') ? currentTheme.success : currentTheme.warning, borderRadius: '4px', fontWeight: '600' }
            }, (apiKeys.pricempire||'').startsWith('https://') ? '✓ Worker URL set' : 'Not configured')
          ),
          React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.8rem', marginBottom: '0.875rem', lineHeight: '1.6' } },
            'Real market prices from DMarket, Skinport & CS.Money — typically 15–30% below Steam. Requires a free Cloudflare Worker as CORS proxy (your API key stays server-side, never in the browser).'
          ),
          // Step-by-step
          React.createElement('div', {
            style: { background: currentTheme.inputBg, borderRadius: '8px', padding: '0.875rem', marginBottom: '0.875rem', fontSize: '0.78rem', color: currentTheme.textSecondary, lineHeight: '1.8' }
          },
            React.createElement('div', { style: { fontWeight: '700', color: currentTheme.text, marginBottom: '0.375rem' } }, 'One-time setup (~5 min):'),
            React.createElement('div', null, '1. Get free API key at ', React.createElement('a', { href: 'https://pricempire.com/subscribe', target: '_blank', rel: 'noopener noreferrer', style: { color: currentTheme.accent } }, 'pricempire.com/subscribe')),
            React.createElement('div', null, '2. Create free account at ', React.createElement('a', { href: 'https://workers.cloudflare.com', target: '_blank', rel: 'noopener noreferrer', style: { color: currentTheme.accent } }, 'workers.cloudflare.com')),
            React.createElement('div', null, '3. In Cloudflare Dashboard → Workers → Create → paste ', React.createElement('code', { style: { background: 'rgba(0,0,0,0.2)', padding: '0 4px', borderRadius: '3px' } }, 'cf-worker/worker.js'), ' from the ZIP'),
            React.createElement('div', null, '4. Add secret: Settings → Variables → ', React.createElement('code', { style: { background: 'rgba(0,0,0,0.2)', padding: '0 4px', borderRadius: '3px' } }, 'PRICEMPIRE_KEY'), ' = your API key'),
            React.createElement('div', null, '5. Paste the Worker URL below (looks like: ', React.createElement('code', { style: { background: 'rgba(0,0,0,0.2)', padding: '0 4px', borderRadius: '3px' } }, 'https://maermin-proxy.xxx.workers.dev'), ')')
          ),
          React.createElement('input', {
            type: 'text',
            value: apiKeys.pricempire || '',
            onChange: e => setApiKeys(prev => ({ ...prev, pricempire: e.target.value })),
            placeholder: 'https://maermin-pricempire-proxy.your-subdomain.workers.dev',
            style: { width: '100%', padding: '0.75rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '6px', color: currentTheme.text, fontSize: '0.8rem', fontFamily: 'monospace' }
          })
        ),

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
        }, 'v7.0')
      ),
      
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' }, ref: settingsRef },
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
        
        // Settings button
        React.createElement('button', {
          onClick: () => setShowSettings(!showSettings),
          title: t.settings || 'Settings',
          style: {
            padding: '0.5rem 0.75rem',
            background: showSettings ? currentTheme.accent : currentTheme.inputBg,
            border: `1px solid ${showSettings ? currentTheme.accent : currentTheme.cardBorder}`,
            borderRadius: '8px',
            color: showSettings ? '#fff' : currentTheme.text,
            cursor: 'pointer',
            fontSize: '1rem',
            transition: 'all 0.15s'
          }
        }, '⚙️'),

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
              [['white','☀️'],['dark','🌙'],['purple','💜']].map(([th, ico]) =>
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
          // Language
          React.createElement('div', { style: { marginBottom: '1rem' } },
            React.createElement('label', { style: { color: currentTheme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, t.language || 'Language'),
            React.createElement('div', { style: { display: 'flex', gap: '0.4rem', marginTop: '0.5rem' } },
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
                    fontSize: '0.8rem',
                    fontWeight: language === lang ? '600' : '400'
                  }
                }, lang === 'de' ? '🇩🇪 DE' : '🇬🇧 EN')
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
          }, '🔐 ' + (t.changePassword || 'Change Password')),
          // API Settings
          React.createElement('button', {
            onClick: () => { setShowSettings(false); setShowApiSettings(true); },
            style: {
              width: '100%', padding: '0.5rem', background: 'transparent',
              color: currentTheme.textSecondary, border: 'none',
              borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem',
              textAlign: 'left', marginBottom: '0.25rem'
            }
          }, '🔑 ' + (t.apiSettings || 'API Settings')),
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
          }, '🔒 ' + (t.logout || 'Logout'))
        )
      )
    ),
    
    // Main layout
    React.createElement('div', { style: { display: 'flex', minHeight: 'calc(100vh - 61px)' } },
      // Sidebar
      React.createElement('nav', {
        className: 'maermin-sidebar',
        style: {
          width: '220px',
          padding: '1rem',
          borderRight: `1px solid ${currentTheme.cardBorder}`,
          flexShrink: 0,
          overflowY: 'auto'
        }
      },
        [
          // ── Portfolio ──────────────────────────────
          { group: t.portfolio || 'Portfolio' },
          { id: 'overview',      icon: '◈', label: t.overview      || 'Übersicht' },
          { id: 'transactions',  icon: '↕', label: t.transactions  || 'Transaktionen' },
          { id: 'dividends',     icon: '◎', label: t.dividendCalendar || 'Dividenden' },
          { id: 'journal',       icon: '◉', label: t.tradeJournal  || 'Journal' },
          // ── Analyse ───────────────────────────────
          { group: t.analytics || 'Analyse' },
          { id: 'returns',       icon: '◆', label: t.returns       || 'Rendite & XIRR' },
          { id: 'rebalancing',   icon: '◐', label: t.rebalancing   || 'Rebalancing' },
          { id: 'analytics',     icon: '◇', label: t.analytics     || 'Portfolio-Analyse' },
          { id: 'investment-analysis', icon: '◈', label: t.investmentAnalysis || 'Strategie' },
          { id: 'taxes',         icon: '◻', label: t.taxes         || 'Steuern' },
          // ── Tools ──────────────────────────────────
          { group: t.tools || 'Tools' },
          { id: 'watchlist',     icon: '◯', label: t.watchlist     || 'Watchlist' },
          { id: 'alerts',        icon: '◎', label: t.priceAlerts   || 'Preisalarme' },
          { id: 'broker-import', icon: '◁', label: t.brokerImport  || 'Broker-Import' },
        ].map((item, idx) => {
          // Section Header
          if (item.group) {
            return React.createElement('div', {
              key: 'group-' + idx,
              style: {
                padding: '0.875rem 0.75rem 0.375rem',
                fontSize: '0.65rem',
                fontWeight: '700',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: currentTheme.textSecondary,
                opacity: 0.7,
                marginTop: idx === 0 ? 0 : '0.5rem'
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
              gap: '0.625rem',
              width: '100%',
              padding: '0.5rem 0.75rem',
              marginBottom: '0.125rem',
              background: isActive ? `${currentTheme.accent}22` : 'transparent',
              color: isActive ? currentTheme.accent : currentTheme.textSecondary,
              border: 'none',
              borderRadius: '8px',
              textAlign: 'left',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: isActive ? '600' : '400',
              transition: 'all 0.15s',
              borderLeft: isActive ? `2px solid ${currentTheme.accent}` : '2px solid transparent'
            }
          },
            React.createElement('span', {
              style: { fontSize: '0.75rem', opacity: 0.8, width: '14px', textAlign: 'center', flexShrink: 0 }
            }, item.icon),
            item.label
          );
        }),
      ),
      
      // Main content
      React.createElement('main', {
        className: 'maermin-main',
        style: { flex: 1, overflow: 'auto' }
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
root.render(React.createElement(InvestmentTracker));

console.log('[MAERMIN v7.0] Application initialized');

})(); // End IIFE
