// ============================================================================
// MAERMIN v12.2 - Main Application
// Professional Multi-Asset Portfolio Tracker with Advanced Investment Analytics
// ============================================================================

(function() {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

// Use React hooks
const { useState, useEffect, useMemo, useCallback, useRef } = React;

// Gated debug logger — verbose price/dividend tracing only when explicitly
// enabled (localStorage 'maermin_debug' = '1' or window.__MAERMIN_DEBUG). Keeps
// the production console clean while preserving the diagnostics for support.
const dbg = (function () {
  let on = false;
  try { on = (typeof localStorage !== 'undefined' && localStorage.getItem('maermin_debug') === '1') || (typeof window !== 'undefined' && window.__MAERMIN_DEBUG === true); } catch (e) {}
  return on ? console.log.bind(console) : function () {};
})();

// View-level error boundary so a crash in one view shows a recoverable fallback
// card instead of blanking the whole app. `viewKey` resets it on navigation.
class ViewErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[MAERMIN] view crashed:', error, info); }
  componentDidUpdate(prev) { if (prev.viewKey !== this.props.viewKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    // R5.4: the shared error state (markup only, so it renders even if a shared module broke)
    return React.createElement('div', { className: 'ui-view' },
      React.createElement('div', { className: ['mx-empty', 'ui-view-error'].join(' '), 'data-kind': 'error', role: 'alert' },
        React.createElement('div', { className: 'mx-empty-title' }, '! ' + __('errViewTitle', 'This view hit an error')),
        React.createElement('div', { className: 'mx-empty-text' }, __('errViewBody', 'Your data is safe. Try this view again or switch to another.')),
        React.createElement('code', { className: 'ui-view-error__msg' }, String(this.state.error && this.state.error.message || this.state.error)),
        React.createElement('button', { type: 'button', onClick: () => this.setState({ error: null }), className: ['ui-btn', 'ui-btn--primary', 'ui-btn--md'].join(' ') },
          React.createElement('span', { className: 'ui-btn__label' }, __('retry', 'Retry')))
      )
    );
  }
}


// Theme configuration
// ── Design system: "Atlas Map" (docs/DESIGN-SYSTEM.md) ──────────────────────
// The colours live in styles.css as CSS variables, one block per theme
// (<html data-theme>). These objects are var() references to them, so every
// inline style that reads `currentTheme.*` follows the active theme and the
// views and the stylesheet can never drift apart. Code that needs a real
// colour value (contrast maths, canvas, PDF) calls MaerminTokens.resolve().
// `name` / `mode` drive the root attributes (data-theme / data-mode).
const THEME_TOKENS = {
  background: 'var(--bg)',
  card: 'var(--surface)',
  surface: 'var(--surface)',
  surface2: 'var(--surface-2)',
  cardBorder: 'var(--border-strong)',
  border: 'var(--border)',
  modalBg: 'var(--surface)',
  modalBorder: 'var(--border-strong)',
  text: 'var(--text)',
  textSecondary: 'var(--text-dim)',
  textFaint: 'var(--text-faint)',
  inputBg: 'var(--surface-2)',
  inputBorder: 'var(--control)',
  accent: 'var(--accent)',
  accentFill: 'var(--accent-fill)', // filled buttons with --on-accent text (WCAG AA in every theme)
  accentText: 'var(--on-accent)',
  accentSoft: 'var(--accent-soft)',
  accentGradient: 'var(--accent-fill)',
  glass: 'var(--glass)',
  shadow: 'var(--shadow-1)',
  success: 'var(--gain)',
  danger: 'var(--loss)',
  warning: 'var(--warning)',
  info: 'var(--income)',
  positive: 'var(--gain)',
  negative: 'var(--loss)',
  neutral: 'var(--neutral)'
};
const themeOf = (name, mode) => Object.assign({ name, mode }, THEME_TOKENS);
const themes = {
  dark: themeOf('dark', 'dark'),
  white: themeOf('white', 'light'),
  purple: themeOf('purple', 'dark'), // "Nebula"
  contrast: themeOf('contrast', 'dark'), // WCAG AAA-leaning text, 2 px borders
  cb: themeOf('cb', 'dark') // colour-blind safe (Okabe–Ito): gain blue, loss orange
};

// ============================================================================
// PASSWORD CHANGE MODAL
// ============================================================================
function PasswordModal({ theme, t, onClose, addToast, restoreFocus }) {
  const [curPw, setCurPw]   = useState('');
  const [newPw, setNewPw]   = useState('');
  const [confPw, setConfPw] = useState('');
  const [busy, setBusy]     = useState(false);
  // SEC-017: a password change keeps the data key; if the old password may be
  // known to someone, the key itself has to change too.
  const [rotateToo, setRotateToo] = useState(false);
  // Enter in a field bypasses the disabled button, so guard with a ref that
  // flips synchronously (FINDINGS M-8: two overlapping changes).
  const busyRef = React.useRef(false);

  const handleChange = async () => {
    if (busyRef.current) return;
    if (!curPw || !newPw || !confPw) return;
    if (newPw !== confPw) { addToast(t.passwordMismatch || 'Passwords do not match', 'error'); return; }
    if (newPw.length < 12) { addToast(__('passwordTooShort12', 'Password must be at least 12 characters'), 'warning'); return; }
    // MaerminAuth.changePassword re-wraps the vault's data key with the new
    // password (SEC-005: 12 characters for a new password). With "rotate" the
    // data key itself is replaced afterwards (SEC-017).
    if (!window.MaerminAuth || typeof window.MaerminAuth.changePassword !== 'function') {
      addToast(__('pwChangeUnavailable', 'Password change is unavailable in this build'), 'error'); return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await window.MaerminAuth.changePassword(curPw, newPw);
      if (rotateToo && window.MaerminAuth.rotateKey) {
        await window.MaerminAuth.rotateKey(newPw);
        addToast(__('passwordChangedRotated', 'Password changed and encryption key replaced. Set up a new recovery code and passkey in Security & sync; other devices need this vault again.'), 'success');
      } else {
        addToast(__('passwordChangedOnly', 'Password changed. The encryption key is unchanged: your recovery code and passkey still open the vault, and so does the old password with an old backup. If the old password may be known, replace the key too.'), 'success');
      }
      setCurPw(''); setNewPw(''); setConfPw('');
      onClose();
    } catch (e) {
      const wrong = e && e.message === 'bad-password';
      addToast(wrong ? (t.passwordWrong || 'Current password is incorrect')
                     : (t.passwordChangeFailed || 'Could not change the password. Please try again.'), 'error');
    }
    busyRef.current = false;
    setBusy(false);
  };

  // R5.1: the shared dialog look and fields (placeholders kept, now also the label)
  const UIC = window.MaerminComponents;
  const inp = (value, onChange, placeholder, type='password') =>
    React.createElement('input', {
      type, value, onChange: e => onChange(e.target.value), placeholder, 'aria-label': placeholder,
      onKeyDown: e => e.key === 'Enter' && handleChange(),
      className: 'ui-input'
    });

  return React.createElement(window.MaerminUI.Overlay, {
    onClose, restoreFocus, className: 'ui-modal-backdrop'
  },
    React.createElement('div', {
      ...window.MaerminUI.dialogProps('dlg-password'),
      className: ['ui-modal', 'ui-modal--sm'].join(' ')
    },
      React.createElement('header', { className: 'ui-modal__head' },
        React.createElement('h2', { id: 'dlg-password', className: 'ui-modal__title' }, (t.changePassword || 'Change Password'))),
      React.createElement('div', { className: ['ui-modal__body', 'ui-pw'].join(' ') },
        inp(curPw,  setCurPw,  t.currentPassword || 'Current Password'),
        inp(newPw,  setNewPw,  t.newPassword     || 'New Password'),
        inp(confPw, setConfPw, t.confirmPassword || 'Confirm Password'),
        React.createElement('label', { className: 'ui-rc-kit__check' },
          React.createElement('input', { type: 'checkbox', checked: rotateToo, onChange: (e) => setRotateToo(e.target.checked), className: 'ui-st-check' }),
          React.createElement('span', null, __('pwRotateToo', 'Also replace the encryption key - do this if the old password may be known. Old backups, the recovery code and the passkey then no longer open new data.')))),
      React.createElement('footer', { className: 'ui-modal__foot' },
        React.createElement(UIC.Button, { onClick: onClose }, t.cancel || 'Cancel'),
        React.createElement(UIC.Button, { variant: 'primary', onClick: handleChange, disabled: !curPw || !newPw || !confPw, loading: busy }, t.changePassword || 'Change Password'))
    )
  );
}

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================

function InvestmentTracker() {
  // ========== STATE MANAGEMENT ==========
  
  // Multi-Portfolio
  // Demo mode: when on, the app runs entirely on offline sample data; the user's
  // real transactions/prices are neither read nor written.
  const [demoMode, setDemoMode] = useState(() => !!(window.MaerminDemo && window.MaerminDemo.isActive()));
  const savedPortfolioHook = window.MaerminFeatures4 ? window.MaerminFeatures4.usePortfolios() : null;
  // P5-1.7: the demo's two portfolios live in memory only - the saved list,
  // the active portfolio and the clearing settings of the user stay untouched.
  const [demoPortfolioId, setDemoPortfolioId] = useState(() => window.MaerminMetrics.ALL_PORTFOLIOS);
  const demoPortfolios = useMemo(() => (demoMode && window.MaerminDemo && window.MaerminDemo.getPortfolios) ? window.MaerminDemo.getPortfolios().map((p) => Object.assign({}, p, { name: p.id === 'default' ? __('demoPfMain', 'Main depot') : __('demoPfBroker', 'Savings plan broker') })) : null, [demoMode]);
  const portfolioHook = (demoPortfolios && savedPortfolioHook) ? Object.assign({}, savedPortfolioHook, {
    portfolios: demoPortfolios, activePortfolioId: (demoPortfolioId === window.MaerminMetrics.ALL_PORTFOLIOS || demoPortfolios.some((p) => p.id === demoPortfolioId)) ? demoPortfolioId : 'default',
    setActivePortfolioId: setDemoPortfolioId, addPortfolio: () => null, removePortfolio: () => {}, restorePortfolio: () => {},
    renamePortfolio: () => {}, setClearing: () => {}, setSeparateDepot: () => {}
  }) : savedPortfolioHook;
  const portfolios       = portfolioHook?.portfolios       || [{ id: 'default', name: 'Main Portfolio', color: '#8b7cff' }];
  const activePortfolioId = portfolioHook?.activePortfolioId || 'default';
  const setActivePortfolioId = portfolioHook?.setActivePortfolioId || (() => {});
  // "All portfolios" (MaerminMetrics.ALL_PORTFOLIOS) is a read-only view of
  // every portfolio's live transactions: nothing is ever booked into it. A new
  // row or an import made while it is selected goes to the main portfolio
  // (the transaction form lets the user pick another one).
  const isAllActive = window.MaerminMetrics.isAllPortfolios(activePortfolioId);
  const writePortfolioId = isAllActive ? ((portfolios.find(p => p.id === 'default') || portfolios[0] || { id: 'default' }).id) : activePortfolioId;

  // Transactions - the source of truth for portfolio
  const [transactions, setTransactions] = useState(() => {
    // Demo mode seeds offline sample data instead of the user's store — and is
    // never persisted over it (see the guarded persistence effects below).
    if (window.MaerminDemo && window.MaerminDemo.isActive()) return window.MaerminDemo.getTransactions();
    const saved = localStorage.getItem('transactions');
    return window.MaerminUtils.safeParse(saved, []) || [];
  });
  // v12: market data (prices, priceHistory, worker status, loading, lastRefresh)
  // lives in MaerminMarket (MaerminStore). Read each slice via useStore; the
  // setX shims delegate to the store and — crucially for the hot async fetch
  // path — read the CURRENT value from the store for functional updates, so
  // setPrices(prev => …) from fetchPrices is never stale. All call sites unchanged.
  // Worker reachability for the status indicator (null = not yet probed).
  const workerStatus = window.MaerminStore.useStore(window.MaerminMarket.store, s => s.workerStatus);
  const setWorkerStatus = (v) => window.MaerminMarket.set('workerStatus', typeof v === 'function' ? v(window.MaerminMarket.get('workerStatus')) : v);
  // { state: 'current'|'outdated'|'newer'|'unreachable', version, expected } from ?action=version.
  const workerVersion = window.MaerminStore.useStore(window.MaerminMarket.store, s => s.workerVersion);

  // Prices
  // `fetchedPrices` = quotes fetched THIS session (the store slice). Views read
  // the derived `prices` below (fetched -> last known -> cost basis); anything
  // that books, alerts or records history must keep using `fetchedPrices`.
  const fetchedPrices = window.MaerminStore.useStore(window.MaerminMarket.store, s => s.prices);
  const setPrices = (v) => window.MaerminMarket.set('prices', typeof v === 'function' ? v(window.MaerminMarket.get('prices')) : v);
  const priceHistory = window.MaerminStore.useStore(window.MaerminMarket.store, s => s.priceHistory);
  const setPriceHistory = (v) => window.MaerminMarket.set('priceHistory', typeof v === 'function' ? v(window.MaerminMarket.get('priceHistory')) : v);
  // Per-symbol historical price series fetched for savings-plan symbols (so each
  // back-dated buy is priced on its own day). Separate from the live priceHistory.
  const [savingsHistory, setSavingsHistory] = useState({});
  const loading = window.MaerminStore.useStore(window.MaerminMarket.store, s => s.loading);
  const setLoading = (v) => window.MaerminMarket.set('loading', typeof v === 'function' ? v(window.MaerminMarket.get('loading')) : v);
  const lastRefresh = window.MaerminStore.useStore(window.MaerminMarket.store, s => s.lastRefresh);
  const setLastRefresh = (v) => window.MaerminMarket.set('lastRefresh', typeof v === 'function' ? v(window.MaerminMarket.get('lastRefresh')) : v);
  
  // Currency and exchange rate - needed for portfolio calculation
  const [currency, setCurrency] = useState('EUR');
  // Exchange rate: USD->EUR (how many EUR for 1 USD). EUR is stronger, so ~0.91
  const [exchangeRate, setExchangeRate] = useState(0.91);
  // True once this session fetched a live rate: until then 0.91 is only a
  // start value, and savings plans never book with it.
  const fxLiveFetched = useRef(false);
  // v11: per-date USD→EUR resolver. fetchPrices backfills a daily rate cache
  // (MaerminFxHistory); bumping fxHistVersion rebuilds the resolver so cost
  // basis re-prices each lot on its own day. Falls back to the live rate when
  // the history cache is empty, so behaviour is unchanged until data arrives.
  const fxSeriesFetched = React.useRef(false);
  const [fxHistVersion, setFxHistVersion] = useState(0);
  // Render-time memo for derived values computed inside the render helpers
  // (renderOverview & co. are plain functions, so hooks can't be used there).
  // Recomputes only when a dependency changes by identity — the overview used
  // to rebuild positions, dividends and the health score (incl. price-history
  // risk maths) on EVERY re-render, e.g. each toast or overlay toggle.
  const _renderMemo = useRef({});
  const memoBy = (key, deps, fn) => {
    const e = _renderMemo.current[key];
    if (e && e.deps.length === deps.length && e.deps.every((d, i) => d === deps[i])) return e.v;
    const v = fn();
    _renderMemo.current[key] = { deps, v };
    return v;
  };

  // P5-1.8: in the demo the Worker-only views get the reserved sample URL
  // (answered in the page by MaerminDemoFixtures, never sent anywhere), and the
  // FX resolver gets the demo's EUR/USD history in memory.
  const DFX = window.MaerminDemoFixtures;
  const fxAt = useMemo(
    () => (window.MaerminFxHistory ? window.MaerminFxHistory.fxResolver(exchangeRate, demoMode && DFX ? DFX.fxHistory() : undefined) : null),
    [exchangeRate, fxHistVersion, demoMode]
  );

  // Bumped when a corporate action (split) is added/removed, so buildPositions
  // re-runs. Declared BEFORE the `portfolio` memo that lists it as a
  // dependency: declared later (as it was), the first render threw
  // "Cannot access 'corpActionsRev' before initialization" and the app never
  // mounted after unlock.
  const [corpActionsRev, setCorpActionsRev] = useState(0);

  // ALL portfolios combined portfolio object — used on Overview in "All" mode
  // and as the cost-basis source for positions without any market price.
  const allPortfoliosPortfolio = useMemo(
    () => window.MaerminMetrics.buildPositions(transactions, { exchangeRate, fxAt }),
    [transactions, exchangeRate, fxAt, corpActionsRev]
  );

  // The price map the views read. After unlock nothing has been fetched yet, so
  // a bare `fetchedPrices` valued every holding at 0 (-100%). Instead: this
  // session's quote, else the last known price from the persisted history
  // (badged stale by the data-quality layer), else the position's cost basis
  // (labelled "no price"). See MaerminMarket.effectivePrices.
  // P5-3.9: manual bond quotes (bonds.js, price in % -> per unit of nominal
  // in EUR); bumped when the Bonds panel or the form changes the terms.
  const [bondsRev, setBondsRev] = useState(0);
  const bondPrices = useMemo(() => {
    const B = window.MaerminBonds;
    if (!B || demoMode) return null;
    try { return B.priceMap(B.load(), (v, cur) => window.MaerminUtils.toEUR(v, cur, exchangeRate)); } catch (e) { return null; }
  }, [bondsRev, exchangeRate, demoMode]);
  const priceView = useMemo(
    () => window.MaerminMarket.effectivePrices(bondPrices && Object.keys(bondPrices).length ? { ...fetchedPrices, ...bondPrices } : fetchedPrices, demoMode ? null : priceHistory, allPortfoliosPortfolio),
    [fetchedPrices, bondPrices, priceHistory, allPortfoliosPortfolio, demoMode]
  );
  const prices = priceView.prices;
  window.MaerminMarket.setCostKeys(priceView.costKeys);

  // Data checks from the one FIFO ledger: sells without enough open units and
  // transaction currencies without an exact EUR conversion. Both skew cost
  // basis and tax, so they are listed on the Transactions and Tax views.
  // P5-1.4: the clearing account of every portfolio that has it switched on.
  const clearingByPf = useMemo(() => {
    const L = window.MaerminLedger, out = {};
    if (!L || !L.clearingBalance) return out;
    (portfolios || []).forEach((p) => {
      const c = p && p.clearing;
      if (!c || !c.enabled) return;
      try { out[p.id] = L.clearingBalance(transactions, p.id, { opening: c.openingBalance, openingDate: c.openingDate, exchangeRate, fxAt }); } catch (e) {}
    });
    return out;
  }, [portfolios, transactions, exchangeRate, fxAt]);
  // P5-2.8: every portfolio's securities value (the Portfolios view's numbers)
  // and the balance of its cash account - buying power and allocation by broker
  const pfAllocation = useMemo(() => {
    const M = window.MaerminMetrics;
    if (!M || !M.computePortfolioTotals) return [];
    try {
      return M.computePortfolioTotals(portfolios || [], transactions, prices, { exchangeRate, fxAt }).map((tot) => {
        const p = (portfolios || []).find((x) => x.id === tot.id) || {};
        return { id: tot.id, name: p.name || tot.id, value: tot.value, cash: clearingByPf[tot.id] ? clearingByPf[tot.id].balanceEUR : undefined };
      });
    } catch (e) { return []; }
  }, [portfolios, transactions, prices, exchangeRate, fxAt, clearingByPf]);
  // Sum of the clearing balances (EUR) of the given portfolio ids (all when 'all').
  const cashOf = (which) => {
    const ids = which === 'all' ? Object.keys(clearingByPf) : [which];
    return ids.some(id => clearingByPf[id]) ? ids.reduce((s, id) => s + (clearingByPf[id] ? clearingByPf[id].balanceEUR : 0), 0) : null;
  };

  const ledgerIssuesBase = useMemo(() => {
    const L = window.MaerminLedger;
    let list = [];
    try { list = L ? (L.build(transactions, { exchangeRate, fxAt }).issues || []) : []; } catch (e) { list = []; }
    // P5-1.4: a clearing account below zero (DQ-CASH-NEGATIVE)
    Object.keys(clearingByPf).forEach((id) => {
      const c = clearingByPf[id];
      if (!c.firstNegative) return;
      const pf = (portfolios || []).find(p => p.id === id) || {};
      list.push({ kind: 'cash-negative', severity: 'info', portfolioId: id, portfolioName: pf.name || id, date: c.firstNegative.d, balance: c.minBalance });
    });
    return list;
  }, [transactions, exchangeRate, fxAt, corpActionsRev, clearingByPf, portfolios]);

  // Transactions of the active portfolio (every portfolio's for "All portfolios")
  const activeTransactions = useMemo(() =>
    window.MaerminMetrics.portfolioTransactions(transactions, activePortfolioId),
  [transactions, activePortfolioId]);

  // Portfolio derived from transactions
  // Single active portfolio, derived from its transactions. Delegates to the
  // shared MaerminMetrics.buildPositions so this never drifts from the all-mode
  // build, the dividend/health calcs or the stats below.
  const portfolio = useMemo(
    () => isAllActive ? allPortfoliosPortfolio : window.MaerminMetrics.buildPositions(activeTransactions, { exchangeRate, fxAt }),
    // corpActionsRev: splits are an overlay read by buildPositions, so re-run it
    // when one is added/removed (they are not part of the transactions array).
    [isAllActive, allPortfoliosPortfolio, activeTransactions, exchangeRate, fxAt, corpActionsRev]
  );

  // The clearing accounts of the active view: `clearings` for XIRR, `merged`
  // for the value path (all portfolios combined when "All portfolios" is
  // active, so a transfer between two of them cancels out).
  const activeClearing = useMemo(() => window.MaerminLedger.viewClearing(clearingByPf,
    isAllActive ? portfolios.map(p => p.id) : [activePortfolioId]), [clearingByPf, portfolios, isAllActive, activePortfolioId]);
  
  // UI State
  // Restore the last active view across sessions; renderView's default case
  // falls back to Overview if a stored id no longer exists.
  // v12: persisted UI prefs now flow through MaerminPrefs (the first slice on the
  // MaerminStore SSOT). Same localStorage keys/defaults as before — useState still
  // drives React; MaerminPrefs centralises persistence + lets others subscribe.
  const [activeView, setActiveView] = useState(() => window.MaerminPrefs.get('activeView'));
  useEffect(() => { window.MaerminPrefs.set('activeView', activeView); }, [activeView]);
  const [theme, setTheme] = useState(() => window.MaerminPrefs.get('theme'));
  const [language, setLanguage] = useState(() => window.MaerminPrefs.get('language'));
  useEffect(() => { window.MaerminPrefs.set('language', language); }, [language]);
  // P5-2.5: returns and dividends before ('gross') or after ('net') taxes and fees
  const [grossNet, setGrossNetState] = useState(() => (window.MaerminPrefs.get('grossNet') === 'gross' ? 'gross' : 'net'));
  const setGrossNet = (v) => { const n = v === 'gross' ? 'gross' : 'net'; setGrossNetState(n); window.MaerminPrefs.set('grossNet', n); };
  // P5-2.9: region of the consumer prices for real returns ('' = from the language)
  const [hicpGeo, setHicpGeoState] = useState(() => window.MaerminPrefs.get('hicpGeo') || '');
  const setHicpGeo = (g) => { setHicpGeoState(g); window.MaerminPrefs.set('hicpGeo', g); };
  
  // v6.0 State
  // v12: command-palette + shortcuts open-states live in MaerminUI.overlays
  // (MaerminStore). Read the slice via useStore; setters below call open/close/
  // toggleOverlay. Behaviour-preserving — the app still re-renders on open/close.
  const showCommandPalette = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.commandPalette);
  const showShortcuts = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.shortcuts);
  // v12: toasts moved onto MaerminUI (MaerminStore). addToast delegates to it and
  // <MaerminUI.ToastContainer> subscribes to just that slice, so a toast no longer
  // re-renders the whole app. No App-level toast state needed any more.
  // ETF look-through result (MaerminLookThrough.analyze). The Health panel
  // computes it and hands it up so the advisor's findings can include hidden
  // fund concentrations on the same render pass.
  const [lookThroughResult, setLookThroughResult] = useState(null);

  // Continuous risk monitoring: re-evaluate the structural rules on every
  // price refresh while the app is open, independent of the active view.
  // checkAndNotify dedupes via its cooldown state, so this is cheap and never
  // spams; notifications only fire when the user enabled them in the monitor.
  useEffect(() => {
    if (!window.MaerminRiskMonitor || !Object.keys(fetchedPrices).length) return;
    try { window.MaerminRiskMonitor.checkAndNotify(portfolio, fetchedPrices, priceHistory, lookThroughResult); }
    catch (e) { /* monitoring must never break the app */ }
  }, [fetchedPrices]);

  // Savings-plan catch-up: when the app opens/unlocks (never in the
  // background), book every due plan execution as a REAL buy transaction.
  // Two passes at most: one immediately (history prices cover past due
  // dates), one once live prices arrive (covers executions due today).
  // runCatchUp is idempotent - the (planId, dueDate) marker on each booked
  // transaction guarantees a due date can never book twice - so the second
  // pass and re-renders are safe.
  // Savings-plan catch-up is idempotent (per-(planId,dueDate) markers), so it can
  // safely re-run whenever prices, transactions or the FX rate change - that is
  // what lets a late-arriving plan-symbol price book the back-dated occurrences.
  // The (daily) USD->EUR rate is threaded through so USD plan amounts convert.
  // Deleting a portfolio moves its transactions and savings plans to the Main
  // Portfolio (FINDINGS C-4: they used to keep the deleted id and show in no
  // portfolio). The confirmation lives in the Portfolio Manager.
  const removePortfolioMovingRows = (id) => {
    if (!portfolioHook || id === 'default') return;
    const MG = window.MaerminMigrations;
    if (MG && MG.movePortfolioRows) {
      setTransactions(prev => MG.movePortfolioRows(prev, [id], 'default').items);
      try {
        const plans = JSON.parse(localStorage.getItem('maermin_savings_plans') || '[]');
        const moved = MG.movePortfolioRows(plans, [id], 'default');
        if (moved.moved) localStorage.setItem('maermin_savings_plans', JSON.stringify(moved.items));
      } catch (e) { console.warn('[PORTFOLIO] moving savings plans failed:', e); }
    }
    const pf = (portfolioHook.portfolios || []).find(p => p.id === id);
    portfolioHook.removePortfolio(id);
    // P2-4: the portfolio goes to the trash; its rows keep `movedFrom`, so a
    // restore can move them back.
    if (pf && window.MaerminTrash) window.MaerminTrash.trashed('portfolio', pf.name, pf);
  };

  // The catch-up writers below wait for the start-up pull (FINDINGS H-6):
  // booking interest or dividends before it would book what another device
  // already booked, under new ids.
  const [startupSynced, setStartupSynced] = useState(() => __maerminStartupSyncDone);
  useEffect(() => {
    let live = true;
    __maerminStartupSync.then(() => { if (live) setStartupSynced(true); });
    return () => { live = false; };
  }, []);

  // P2-1 Simple/Advanced navigation (nav-model.js). Until the user picks one,
  // the mode follows the vault: transactions -> Advanced, none -> Simple. It is
  // saved once that is settled: Advanced as soon as transactions exist, Simple
  // only after the start-up pull, so a new device of a synced account does not
  // lock itself into Simple before its transactions arrive. Demo data never
  // decides it.
  const [uiModeStored, setUiModeStored] = useState(() => window.MaerminNav.normalizeMode(window.MaerminPrefs.get('uiMode')));
  const uiMode = window.MaerminNav.initialMode(uiModeStored, transactions.length);
  useEffect(() => {
    if (uiModeStored || demoMode) return;
    if (transactions.length > 0 || startupSynced) {
      window.MaerminPrefs.set('uiMode', uiMode);
      setUiModeStored(uiMode);
    }
  }, [uiModeStored, demoMode, transactions.length, startupSynced, uiMode]);
  const setUiMode = (mode) => {
    const m = window.MaerminNav.normalizeMode(mode);
    if (!m) return;
    window.MaerminPrefs.set('uiMode', m);
    setUiModeStored(m);
  };

  // Post-sync dedupe of automatic bookings. Two devices each run their
  // catch-ups before they sync, so the transaction union can hold the same
  // auto-dividend, exchange trade or interest period twice. Survivors are
  // deterministic, so every device removes the same rows (savings plans do
  // the same inside their own catch-up). Runs before the catch-ups below.
  useEffect(() => {
    if (demoMode || !startupSynced) return;
    const DX = window.MaerminDividendExecutor, XS = window.MaerminExchangeSync, IN = window.MaerminInterest;
    try {
      let working = transactions, removed = 0, accounts = null;
      if (DX && DX.dedupeBooked) { const r = DX.dedupeBooked(working); working = r.transactions; removed += r.removed; }
      if (XS && XS.dedupeImported) { const r = XS.dedupeImported(working); working = r.transactions; removed += r.removed; }
      if (IN && IN.dedupeAccruals && working.some(tx => tx && tx.source === 'interest-accrual')) {
        const r = IN.dedupeAccruals(working, JSON.parse(localStorage.getItem('maermin_networth_accounts') || '[]'), IN.loadLedger());
        if (r.removed) {
          accounts = r.accounts;
          localStorage.setItem('maermin_networth_accounts', JSON.stringify(r.accounts));
          IN.saveLedger(r.ledger);
          working = r.transactions; removed += r.removed;
        }
      }
      if (!removed) return;
      // Re-apply to the latest list: a catch-up may have queued an update.
      setTransactions(prev => {
        let next = prev;
        if (DX && DX.dedupeBooked) next = DX.dedupeBooked(next).transactions;
        if (XS && XS.dedupeImported) next = XS.dedupeImported(next).transactions;
        if (accounts) next = IN.dedupeAccruals(next, accounts).transactions;
        return next;
      });
      addToast(`${removed} ${t.dupAutoRemovedToast || 'duplicate automatic booking(s) removed after sync'}`, 'info');
    } catch (e) { console.warn('[DEDUPE] post-sync dedupe failed:', e); }
  }, [transactions, demoMode, startupSynced]);

  // P5-1.2: a row another device added to a portfolio deleted here arrives by
  // sync after migration v5 ran; move it to Main (with movedFrom, so a trash
  // restore of the portfolio takes it back). A sync that changes local data
  // remounts the app, so the portfolio list and the rows come from the same
  // pull. Like v5, nothing moves when no portfolio list was saved before this
  // mount (usePortfolios saves its default list on mount).
  const [hadSavedPortfolios] = useState(() => { try { return localStorage.getItem('maermin_portfolios') !== null; } catch (e) { return false; } });
  useEffect(() => {
    const MG = window.MaerminMigrations;
    if (demoMode || !startupSynced || !hadSavedPortfolios || !portfolioHook || !MG || !MG.rehomeOrphans) return;
    try {
      const list = portfolioHook.portfolios;
      let moved = MG.rehomeOrphans(transactions, list).moved;
      const plans = JSON.parse(localStorage.getItem('maermin_savings_plans') || '[]');
      const p = MG.rehomeOrphans(plans, list);
      if (p.moved) localStorage.setItem('maermin_savings_plans', JSON.stringify(p.items));
      if (moved) setTransactions(prev => MG.rehomeOrphans(prev, list).items);
      moved += p.moved;
      if (moved) {
        const main = (list.find(x => x.id === 'default') || {}).name || '';
        addToast(__('pfOrphansMoved', '{n} {n:entry|entries} from deleted portfolios moved to {main}', { n: moved, main }), 'info');
      }
    } catch (e) { console.warn('[PORTFOLIO] re-homing orphan rows failed:', e); }
  }, [transactions, demoMode, startupSynced, portfolioHook && portfolioHook.portfolios]);

  const savingsCatchUp = React.useRef({ pendingToasted: false });
  useEffect(() => {
    const EX = window.MaerminSavingsExecutor;
    if (!EX || demoMode || !startupSynced) return; // never book the user's plans into demo data
    const havePrices = Object.keys(fetchedPrices).length > 0;
    try {
      const plans = JSON.parse(localStorage.getItem(EX.PLANS_KEY) || '[]');
      if (!Array.isArray(plans) || !plans.length) return;
      // Effective history = the app's live priceHistory PLUS the per-symbol
      // historical series fetched for savings-plan symbols. That yields a real
      // close at/before each due date, so every buy is priced on its own day.
      const histEff = Object.assign({}, priceHistory, savingsHistory);
      const accurate = (sym, due) => EX.priceAtDate(histEff, fetchedPrices, sym, due);
      // Only a real recorded close (within 7 days of the due date, or today's
      // live price for today's execution) books a buy; anything else stays
      // pending and is reported. Never book at an invented price (audit
      // 2026-10-24 BUG-5; earlier estimated rows are still repriced below).
      const resolvePrice = (plan, dueDate) => EX.priceAtDate(histEff, fetchedPrices, plan.symbol, dueDate);

      // USD amounts convert only at a real rate of the due date (daily history,
      // or today's fetched rate); without one the date stays pending.
      const fxBook = EX.bookingRate(fxAt, exchangeRate, fxLiveFetched.current);

      let working = transactions;
      // 1) Re-price earlier ESTIMATED auto-executions now that real history exists.
      if (EX.repriceEstimated) {
        const rep = EX.repriceEstimated(working, accurate, fxBook); // rate of each due date (M-16)
        if (rep.repriced) {
          working = rep.transactions;
          addToast(__('spRepriced', '{n} estimated savings {n:buy|buys} repriced to the historical close', { n: rep.repriced }), 'success');
        }
      }
      // 2) Book any outstanding occurrences that have a real close.
      const out = EX.runCatchUp(plans, working, resolvePrice, undefined, undefined, fxBook);
      if (out.created.length || out.removedDuplicates || working !== transactions) {
        setTransactions(out.transactions);
        if (out.created.length) addToast(__('spBooked', '{n} savings-plan {n:execution|executions} booked', { n: out.created.length }), 'success');
        if (out.removedDuplicates) addToast(__('spDupRemoved', '{n} duplicate {n:auto-execution|auto-executions} removed after sync', { n: out.removedDuplicates }), 'info');
      }
      if (out.pending.length && havePrices && !savingsCatchUp.current.pendingToasted) {
        savingsCatchUp.current.pendingToasted = true;
        const noFx = out.pending.some(p => p.reason === 'no-exchange-rate');
        addToast(noFx
          ? __('spPendingFx', '{n} savings-plan {n:execution|executions} pending - no exchange rate for the date yet', { n: out.pending.length })
          : __('spPending', '{n} savings-plan {n:execution|executions} pending - no price for the symbol yet', { n: out.pending.length }), 'warning');
      }
    } catch (e) { console.warn('[SAVINGS] catch-up failed:', e); }
  }, [fetchedPrices, transactions, priceHistory, savingsHistory, exchangeRate, fxAt, demoMode, startupSynced]);

  // WI-2: interest accrual catch-up for cash / time-deposit Net-Worth accounts.
  // On app open, grow each interest-bearing account's balance (act/365) and book
  // a type:'interest' transaction so the tax report counts it as capital income.
  // Idempotent: each accrual advances lastAccrualDate and each tx carries an
  // (accountId, periodEnd) marker, so re-runs never double-book.
  useEffect(() => {
    const IN = window.MaerminInterest;
    if (!IN || demoMode || !startupSynced) return;
    try {
      const accounts = JSON.parse(localStorage.getItem('maermin_networth_accounts') || '[]');
      if (!Array.isArray(accounts) || !accounts.some(a => IN.isInterestBearing(a))) return;
      const ledger = IN.loadLedger();
      const out = IN.runCatchUp({ accounts, transactions, ledger, asOf: window.MaerminUtils.todayISO(), portfolioId: writePortfolioId });
      if (out.created.length) {
        localStorage.setItem('maermin_networth_accounts', JSON.stringify(out.accounts));
        IN.saveLedger(out.ledger);
        setTransactions(prev => prev.concat(out.created));
        addToast(`${out.created.length} ${t.interestBookedToast || 'interest accrual(s) booked'}`, 'success');
      }
    } catch (e) { console.warn('[INTEREST] catch-up failed:', e); }
  }, [transactions, writePortfolioId, demoMode, startupSynced]);

  // P5-3.9: bond coupons and redemptions (bonds.js), booked on their dates
  // for the nominal held; idempotent per (portfolio, bond, date).
  useEffect(() => {
    const B = window.MaerminBonds, IN = window.MaerminInterest;
    if (!B || demoMode || !startupSynced) return;
    try {
      if (!transactions.some(tx => tx && tx.category === 'bonds')) return;
      const out = B.catchUp({ transactions, bonds: B.load(), asOf: window.MaerminUtils.todayISO(), ledger: IN ? IN.loadLedger() : undefined });
      if (out.created.length) {
        if (IN && out.postings.length) IN.saveLedger(out.ledger);
        setTransactions(prev => prev.concat(out.created));
        addToast(__('bondBookedToast', '{n} bond booking(s) added (coupons, redemption)', { n: out.created.length }), 'success');
      }
    } catch (e) { console.warn('[BONDS] catch-up failed:', e); }
  }, [transactions, bondsRev, demoMode, startupSynced]);

  // v10.x: dividend auto-booking (opt-in, maermin_div_autobook). When enabled,
  // every dividend whose PAY date has passed is booked as a `type:'dividend'`
  // transaction in the PAYOUT currency (USD stays USD). Idempotent per
  // (symbol|payDate|portfolio) so re-runs never double-book. Amounts are an
  // ESTIMATE (current shares × DividendDataService per-share), hence opt-in.
  const [divAutoBook, setDivAutoBook] = useState(() => {
    try { return !!(window.MaerminDividendExecutor && window.MaerminDividendExecutor.isEnabled()); } catch (e) { return false; }
  });
  // The payouts due, booked into the portfolio that held the shares: under
  // "All portfolios" one pass per portfolio, never a row in the aggregate.
  const dividendsDue = (EX, DS) => {
    const M = window.MaerminMetrics;
    const ids = isAllActive ? portfolios.map(p => p.id) : [activePortfolioId];
    let created = [];
    ids.forEach((id) => {
      const pf = isAllActive ? M.buildPositions(M.portfolioTransactions(transactions, id), { exchangeRate, fxAt }) : portfolio;
      const sched = DS.buildPaymentSchedule(pf, { back: 12, months: 0 });
      created = created.concat(EX.runCatchUp(sched, transactions, id, undefined, EX.loadSkipped ? EX.loadSkipped() : []).created);
    });
    return { created };
  };
  const bookDividends = useCallback((announce) => {
    const EX = window.MaerminDividendExecutor, DS = window.DividendDataService;
    if (!EX || !DS) { if (announce) addToast(__('divEngineMissing', 'Dividend engine not loaded'), 'warning'); return; }
    try {
      const out = dividendsDue(EX, DS);
      if (!out.created.length) { if (announce) addToast(t.divNoneToBook || 'No new dividends to book', 'info'); return; }
      const book = () => {
        const ids = new Set(out.created.map(tx => tx.id));
        setTransactions(prev => prev.concat(out.created));
        if (window.MaerminUI) window.MaerminUI.add(`${out.created.length} ${t.divBookedToast || 'dividend(s) booked (estimated)'}`, 'success', 8000, { label: __('undo', 'Undo'), run: () => {
          setTransactions(prev => prev.filter(tx => !ids.has(tx.id)));
          try { EX.markSkipped && EX.markSkipped(out.created); } catch (e) {}
        } });
      };
      if (!announce) { book(); return; }
      const lines = out.created.slice(0, 8).map(tx => `${tx.symbol} · ${window.MaerminI18n.date(tx.date)} · ${window.MaerminI18n.money(tx.quantity * tx.price, tx.currency || 'EUR')}`);
      if (out.created.length > 8) lines.push(__('divBookMore', '… and {n} more', { n: out.created.length - 8 }));
      askConfirm({
        title: __('divBookTitle', 'Book {n} estimated {n:dividend|dividends}?', { n: out.created.length }),
        message: lines.join('\n') + '\n\n' + __('divBookNote', 'Estimated from the dividend history and the shares you held on each date. They go into your transactions; Undo or delete them if your broker paid a different amount.'),
        confirmLabel: __('divBookConfirm', 'Book')
      }).then((yes) => { if (yes) book(); });
    } catch (e) { console.warn('[DIV] booking failed:', e); }
  }, [portfolio, transactions, activePortfolioId, portfolios, exchangeRate, fxAt]);
  const toggleDivAutoBook = useCallback(() => {
    setDivAutoBook(prev => {
      const next = !prev;
      try { window.MaerminDividendExecutor && window.MaerminDividendExecutor.setEnabled(next); } catch (e) {}
      return next;
    });
  }, []);
  useEffect(() => {
    if (demoMode || !divAutoBook || !startupSynced) return;
    const EX = window.MaerminDividendExecutor, DS = window.DividendDataService;
    if (!EX || !DS) return;
    try {
      const out = dividendsDue(EX, DS);
      if (out.created.length) { setTransactions(prev => prev.concat(out.created)); addToast(`${out.created.length} ${t.divAutoBookedToast || 'dividend(s) auto-booked (estimated)'}`, 'success'); }
    } catch (e) { /* best-effort */ }
  }, [divAutoBook, transactions, portfolio, activePortfolioId, portfolios, exchangeRate, fxAt, demoMode, startupSynced]);

  // Forms & Modals
  const [newTransaction, setNewTransaction] = useState({
    type: 'buy',
    category: 'crypto',
    symbol: '',
    quantity: '',
    price: '',
    date: window.MaerminUtils.todayISO(),
    fees: '',
    notes: '',
    currency: 'EUR', // Track which currency the transaction was added in
    targetPortfolioId: 'default',
  });
  // Required fields the last save attempt found empty (marked in the dialog).
  const [txMissing, setTxMissing] = useState([]);
  // CS2 skins filed as stocks are being moved to the skins category.
  const [skinRepairBusy, setSkinRepairBusy] = useState(false);
  // The form as it was when the dialog opened: closing a changed form asks first.
  const txInitialRef = useRef(null);
  // v12: modal open-states live in MaerminUI.overlays. Read the slice via
  // useStore; keep the setShowX name as a thin shim that delegates to the store,
  // so every existing call site (incl. the Escape handler + toggles) is unchanged.
  const showTransactionModal = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.transactionModal);
  const setShowTransactionModal = (v) => { const n = typeof v === 'function' ? v(showTransactionModal) : v; n ? window.MaerminUI.openOverlay('transactionModal') : window.MaerminUI.closeOverlay('transactionModal'); };
  // The Overview shows the active portfolio ('all' = "All portfolios"). It is
  // not a state of its own: a separate one opened on "All portfolios" while
  // the active portfolio (Analysis -> Returns and every other view) was still
  // the stored one, so the two showed different books (XIRR, TWR, value).
  const overviewMode = isAllActive ? 'all' : activePortfolioId;
  // The app opens on "All portfolios", the Overview's opening view since #194.
  useEffect(() => {
    if (!isAllActive && portfolios.length > 1) setActivePortfolioId(window.MaerminMetrics.ALL_PORTFOLIOS);
  }, []);
  // Which sidebar hub (Analytics / Discover & Tools) is expanded. '' = none.
  const [editingTransactionId, setEditingTransactionId] = useState(null); // null = adding new, id = editing
  const showImportModal = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.importModal);
  const setShowImportModal = (v) => { const n = typeof v === 'function' ? v(showImportModal) : v; n ? window.MaerminUI.openOverlay('importModal') : window.MaerminUI.closeOverlay('importModal'); };
  const [importData, setImportData] = useState('');
  const showPasswordModal = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.passwordModal);
  const setShowPasswordModal = (v) => { const n = typeof v === 'function' ? v(showPasswordModal) : v; n ? window.MaerminUI.openOverlay('passwordModal') : window.MaerminUI.closeOverlay('passwordModal'); };
  const [apiKeys, setApiKeys] = useState(() => {
    try { return JSON.parse(localStorage.getItem('apiKeys') || '{}'); } catch { return {}; }
  });
  // P5-3.1: the Worker for MARKET DATA - the own Worker, else the shared price
  // Worker (market data only; switchable in Settings → Privacy). User data
  // (sync, share, MCP, broker relay, Steam inventory) keeps apiKeys.cs2Worker.
  const [sharedPrices, setSharedPricesState] = useState(() => window.MaerminPrefs.get('sharedPrices'));
  const setSharedPrices = (on) => { const v = on ? 'on' : 'off'; setSharedPricesState(v); window.MaerminPrefs.set('sharedPrices', v); };
  const SWm = window.MaerminSharedWorker;
  const marketWorker = SWm ? SWm.marketBase(apiKeys.cs2Worker, { enabled: SWm.enabledFrom(sharedPrices) }) : (apiKeys.cs2Worker || '');
  const usingSharedPrices = !!(SWm && marketWorker && SWm.isShared(marketWorker));
  const marketApiKeys = useMemo(() => ({ ...apiKeys, cs2Worker: marketWorker }), [apiKeys, marketWorker]);
  // CoinGecko goes through the Worker: the client builds its URLs from it.
  if (window.MaerminCoinGecko && window.MaerminCoinGecko.setBase) window.MaerminCoinGecko.setBase(marketWorker);
  // P5-1.8: the Worker URL the Worker-only views get (the sample URL in the demo).
  const viewWorkerUrl = demoMode && DFX ? DFX.BASE : marketWorker;

  // Fetch a historical price series for each savings-plan symbol (crypto via
  // CoinGecko market_chart in EUR; stocks via the YF Worker, converted to EUR at
  // the daily rate) covering the plan's date span. This is what lets every
  // back-dated buy be priced on ITS OWN day, and lets earlier estimated buys be
  // repriced to the real close. The latest point also seeds the live price map
  // so unheld plan assets get a current price. Fetched once per symbol/span set.
  const savingsHistFetch = React.useRef({ sig: '', complete: false, at: 0 });
  useEffect(() => {
    const EX = window.MaerminSavingsExecutor;
    if (!EX) return;
    let plans;
    try { plans = JSON.parse(localStorage.getItem(EX.PLANS_KEY) || '[]'); } catch (e) { return; }
    if (!Array.isArray(plans) || !plans.length) return;

    const CG_IDS = { btc:'bitcoin', eth:'ethereum', sol:'solana', ada:'cardano', xrp:'ripple', doge:'dogecoin', dot:'polkadot', ltc:'litecoin', bch:'bitcoin-cash', link:'chainlink', matic:'matic-network', avax:'avalanche-2', bnb:'binancecoin', trx:'tron', usdt:'tether', usdc:'usd-coin', uni:'uniswap', atom:'cosmos', etc:'ethereum-classic' };
    const bySym = {};
    plans.forEach(p => {
      if (!p || p.active === false || !p.symbol) return;
      if (p.category !== 'crypto' && p.category !== 'stocks') return;
      const start = p.startDate || window.MaerminUtils.todayISO();
      if (!bySym[p.symbol]) bySym[p.symbol] = { symbol: p.symbol, category: p.category, start };
      else if (start < bySym[p.symbol].start) bySym[p.symbol].start = start;
    });
    const syms = Object.values(bySym);
    if (!syms.length) return;
    const sig = syms.map(s => s.category + ':' + s.symbol + ':' + s.start).sort().join('|');
    const last = savingsHistFetch.current;
    // Same symbol set: done if complete; otherwise retry at most every 10 min.
    if (last.sig === sig && (last.complete || Date.now() - last.at < 10 * 60 * 1000)) return;
    savingsHistFetch.current = { sig, complete: false, at: Date.now() };

    (async () => {
      const histAdd = {}, priceAdd = {};
      let incomplete = false; // a USD day without a real rate was left out
      const nowSec = Math.floor(Date.now() / 1000);
      const workerBase = (marketWorker || '').trim().replace(/\/$/, '');
      for (const s of syms) {
        try {
          let series = null;
          if (s.category === 'crypto') {
            const tkr = (s.symbol || '').toLowerCase();
            const id = CG_IDS[tkr] || tkr;
            const fromSec = Math.floor(new Date(s.start + 'T00:00:00Z').getTime() / 1000) - 86400;
            // Through the Worker; `to` on the hour so the Worker's cache can answer repeats.
            const data = await window.MaerminCoinGecko.get(`coins/${id}/market_chart/range`, { vs_currency: 'eur', from: fromSec, to: Math.ceil(nowSec / 3600) * 3600 }, { priority: 'low', timeoutMs: 20000 }).catch(() => null);
            if (data) {
              series = (data.prices || [])
                .map(pt => ({ timestamp: new Date(pt[0]).toISOString(), price: pt[1] }))
                .filter(r => typeof r.price === 'number' && r.price > 0);
            }
          } else if (workerBase.length > 5) {
            const sym = (s.symbol || '').toUpperCase();
            const months = Math.max(1, Math.ceil((Date.now() - new Date(s.start).getTime()) / (30 * 86400000)));
            const range = months <= 1 ? '1mo' : months <= 3 ? '3mo' : months <= 6 ? '6mo' : months <= 12 ? '1y' : months <= 24 ? '2y' : months <= 60 ? '5y' : months <= 120 ? '10y' : 'max';
            const url = `${workerBase}?action=yf&symbol=${encodeURIComponent(sym)}&interval=1d&range=${range}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (res.ok) {
              const data = await res.json();
              // Only EUR and USD can be converted here. Any other quote currency
              // (GBp pence, CHF, JPY, ...) would be mis-scaled by the USD rate and
              // book wildly wrong quantities - leave those occurrences pending.
              const cur = data.currency || 'USD';
              if (cur !== 'EUR' && cur !== 'USD') { console.warn('[SAVINGS] unsupported quote currency', cur, 'for', sym); continue; }
              // USD closes convert at the rate OF THAT DAY, not today's live
              // rate - otherwise every back-dated quantity carries today's FX.
              // A day without a real rate is left out (no made-up EUR close);
              // the symbol is then fetched again on a later refresh.
              const fxDay = EX.bookingRate(fxAt, exchangeRate, fxLiveFetched.current);
              const rateAt = (d) => cur === 'EUR' ? 1 : fxDay(String(d || '').slice(0, 10));
              const usable = (data.prices || []).filter(r => r && typeof r.price === 'number' && r.price > 0);
              series = usable
                .map(r => { const ts = r.date || r.timestamp; const fx = rateAt(ts); return fx ? { timestamp: ts, price: r.price * fx } : null; })
                .filter(Boolean);
              if (series.length < usable.length) incomplete = true;
            }
          }
          if (series && series.length) {
            histAdd[s.symbol] = series;
            const last = series[series.length - 1].price;
            priceAdd[s.symbol] = last;
            priceAdd[(s.symbol || '').toLowerCase()] = last;
          }
        } catch (e) { console.warn('[SAVINGS] history fetch failed for', s.symbol, e && e.message); }
      }
      // Allow a retry on the next price refresh if nothing could be fetched
      // (offline, rate-limited) instead of pinning the signature forever.
      if (savingsHistFetch.current.sig === sig) savingsHistFetch.current.complete = !incomplete && Object.keys(histAdd).length >= syms.length;
      if (Object.keys(histAdd).length) setSavingsHistory(prev => ({ ...prev, ...histAdd }));
      if (Object.keys(priceAdd).length) setPrices(prev => ({ ...prev, ...priceAdd }));
    })();
  }, [fetchedPrices, apiKeys, exchangeRate]);

  // Daily EUR rates for every other fiat currency in the transactions (CHF,
  // GBP, ...), through the Worker (Yahoo EUR<CUR>=X). MaerminFxHistory.txToEUR
  // then converts such a trade at the rate of ITS date in every view. Runs when
  // a new currency / an earlier trade appears and after a price refresh (the
  // plan itself re-requests a currency at most every 12 h). Not in demo mode.
  const curSyncRef = useRef({ sig: '', at: 0, busy: false });
  const [curTick, setCurTick] = useState(0); // re-check after a run (a currency may have been added meanwhile)
  useEffect(() => {
    const FXH = window.MaerminFxHistory;
    if (!FXH || !FXH.syncCurrencies || demoMode) return;
    const needed = FXH.currenciesNeeded(transactions);
    const curs = Object.keys(needed);
    const rawBase = (marketWorker || '').trim().replace(/\/$/, '');
    if (!curs.length || rawBase.length <= 5) return;
    const sig = rawBase + '#' + curs.sort().map(c => c + ':' + needed[c]).join('|');
    const st = curSyncRef.current;
    if (st.busy || (st.sig === sig && Date.now() - st.at < 10 * 60 * 1000)) return;
    curSyncRef.current = { sig, at: Date.now(), busy: true };
    FXH.syncCurrencies({ transactions, workerBase: rawBase }).then((res) => {
      curSyncRef.current.busy = false;
      setCurTick(n => n + 1);
      if (res.failed.length) dbg('[FX] no rate history for', res.failed.map(f => f.cur + ' (' + f.reason + ')').join(', '));
      if (!res.changed) return;
      if (!FXH.saveCurrencies(res.store)) console.warn('[FX] could not persist the currency history - kept for this session');
      setFxHistVersion(v => v + 1); // new resolver identity -> positions, ledger, tax report recompute
    }).catch(() => { curSyncRef.current.busy = false; });
  }, [transactions, marketWorker, demoMode, lastRefresh, curTick]);
  // ── Daily close history → value path (TWR from day one) ───────────────────
  // priceHistory only has one point per refresh, so TWR, rolling volatility and
  // correlation stayed empty for days after an import. MaerminCloseHistory keeps
  // daily closes back to the first trade of every holding (stocks/commodities and
  // skins through the Worker, crypto from CoinGecko), persisted encrypted;
  // MaerminValuePath turns them + the transactions into the daily value path.
  // Best effort: without a Worker / offline the views fall back to the recorded
  // snapshots and the refresh history as before. Never runs in demo mode.
  // Demo mode: the sample series of MaerminDemo, in memory only (never saved).
  const demoCloses = () => (window.MaerminDemo && window.MaerminDemo.closeHistory) ? window.MaerminDemo.closeHistory(window.MaerminUtils.todayISO()) : null;
  const [closeHistory, setCloseHistory] = useState(() => !window.MaerminCloseHistory ? null : demoMode ? demoCloses() : window.MaerminCloseHistory.load());
  const closeStoreRef = useRef(closeHistory);
  const closeSyncRef = useRef({ sig: '', at: 0, busy: false, failed: 0, pending: 0, rounds: 0, timer: null });
  useEffect(() => () => { if (closeSyncRef.current.timer) clearTimeout(closeSyncRef.current.timer); }, []);
  const [closeTick, setCloseTick] = useState(0);      // re-run for the holdings a batch left over
  const [closePending, setClosePending] = useState(0); // holdings whose history is still to be loaded
  useEffect(() => {
    const CH = window.MaerminCloseHistory;
    // Only after the first price refresh of the session: it resolves exchange
    // suffixes (EUNL -> EUNL.DE) the history needs, and it gets the first go at
    // the Worker's and CoinGecko's request limits.
    if (!CH || demoMode || !lastRefresh) return;
    const need = CH.need(transactions);
    const keys = Object.keys(need);
    if (!keys.length) return;
    const rawBase = (marketWorker || '').trim().replace(/\/$/, '');
    const workerBase = rawBase.length > 5 ? rawBase : '';
    const sig = workerBase + '#' + keys.map(k => k + ':' + need[k].first).sort().join('|');
    const st = closeSyncRef.current;
    // Same holdings: look again at most every 10 min; after 15 s when a batch
    // left holdings over, after 1 min when a request failed. CH.plan() itself
    // only re-requests a series every 6 h.
    if (st.busy || (st.sig === sig && Date.now() - st.at < (st.pending ? 15 : st.failed ? 60 : 600) * 1000)) return;
    closeSyncRef.current = { sig, at: Date.now(), busy: true, failed: 0, pending: 0, rounds: st.sig === sig ? st.rounds : 0, timer: st.timer };
    let suffixCache = {};
    try { suffixCache = JSON.parse(localStorage.getItem('maermin_symbol_suffix') || '{}') || {}; } catch (e) {}
    CH.sync({
      transactions, store: closeStoreRef.current || CH.load(), workerBase, suffixCache,
      // live EUR price: a Yahoo coin pair far off it is another coin
      priceOf: (sym) => { const s = String(sym || ''); return prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || 0; }
    }).then((res) => {
      closeSyncRef.current.busy = false;
      closeSyncRef.current.failed = res.failed.length;
      // Left over by the batch / rate limit (not: no Worker configured): go again shortly.
      const pending = workerBase ? res.skipped.length : res.skipped.filter(k => k.indexOf('crypto|') === 0).length;
      const cur = closeSyncRef.current;
      cur.pending = pending;
      setClosePending(pending);
      // Follow-up batches: only while this run made progress, at most 10 in a
      // row, never from a hidden tab (the next price refresh picks it up).
      if (cur.timer) { clearTimeout(cur.timer); cur.timer = null; }
      if (pending && res.fetched.length && cur.rounds < 10 && !(typeof document !== 'undefined' && document.hidden)) {
        cur.rounds++;
        cur.timer = setTimeout(() => { cur.timer = null; setCloseTick(n => n + 1); }, 20000);
      }
      if (res.failed.length) dbg('[HISTORY] no daily closes for', res.failed.map(f => f.symbol + ' (' + f.reason + ')').join(', '));
      if (!res.changed) { if (!closeStoreRef.current) { closeStoreRef.current = res.store; setCloseHistory(res.store); } return; }
      if (!CH.save(res.store)) console.warn('[HISTORY] could not persist the close history (storage full?) - kept for this session');
      closeStoreRef.current = res.store;
      setCloseHistory(res.store);
    }).catch(() => { closeSyncRef.current.busy = false; });
  }, [transactions, marketWorker, demoMode, lastRefresh, closeTick]);

  // Stored closes are in the quote currency; convert each to EUR at the rate of
  // its day: USD from the daily USD history, CHF / GBp & co. from the currency
  // history (MaerminFxHistory.currencyRateAt) where it reaches that day, else
  // today's cross rate.
  const closeSeriesEUR = useMemo(() => {
    const CH = window.MaerminCloseHistory, FXH = window.MaerminFxHistory;
    const out = {};
    if (!CH || !closeHistory) return out;
    Object.keys(closeHistory.series).forEach((k) => {
      const e = closeHistory.series[k];
      const closes = [];
      CH.closesOf(e).forEach(([d, p]) => {
        let v = p;
        if (e.cur !== 'EUR') {
          const usd = (fxAt && fxAt(d)) || exchangeRate;
          const dated = (FXH && FXH.currencyRateAt && e.cur !== 'USD') ? FXH.currencyRateAt(e.cur, d) : null;
          v = dated > 0 ? p * dated
            : (FXH && FXH.quoteToEUR) ? FXH.quoteToEUR(p, e.cur, usd) : (e.cur === 'USD' ? p * usd : null);
        }
        if (v > 0) closes.push([d, v]);
      });
      if (closes.length) out[k] = { closes, splits: e.splits, cur: e.cur };
    });
    return out;
  }, [closeHistory, fxAt, exchangeRate, demoMode]);

  // Value path of the ACTIVE portfolio. Today is valued at this session's quote
  // where one was fetched (else the last close); quantities are adjusted with
  // the recorded splits only, exactly like the positions list.
  // P5-1.5: one builder for the active portfolio's path and the Overview's.
  // Today's quotes and the recorded splits per series key - the value path and
  // the value-change attribution (P5-2.1) read the same ones.
  const pathInputs = useMemo(() => {
    const CH = window.MaerminCloseHistory, live = {}, splits = {};
    if (!CH) return { live, splits };
    Object.keys(closeSeriesEUR).forEach((k) => {
      const sym = k.slice(k.indexOf('|') + 1);
      const p = fetchedPrices[sym] > 0 ? fetchedPrices[sym] : fetchedPrices[sym.toLowerCase()];
      if (p > 0) live[k] = p;
    });
    const CA = window.MaerminCorporateActions;
    try {
      ((CA && CA.load && CA.load().actions) || []).forEach((a) => {
        const k = CH.keyOf(a.category, a.symbol);
        (splits[k] = splits[k] || []).push({ date: a.date, num: a.num, den: a.den });
      });
    } catch (e) {}
    return { live, splits };
  }, [closeSeriesEUR, fetchedPrices, corpActionsRev]);
  const buildValuePath = (txs, clearing, extra) => {
    const VP = window.MaerminValuePath, CH = window.MaerminCloseHistory;
    if (!VP || !CH || !Object.keys(closeSeriesEUR).length) return null;
    try {
      // P5-1.4: with a clearing account the daily value includes its cash
      // P5-2.5: extra.gross = taxes and fees as money taken out (Analysis → Returns)
      return VP.build(txs, closeSeriesEUR, { today: window.MaerminUtils.todayISO(), exchangeRate, fxAt, live: pathInputs.live, splits: pathInputs.splits, clearing: clearing || null, gross: !!(extra && extra.gross) });
    } catch (e) { console.warn('[HISTORY] value path failed:', e && e.message); return null; }
  };
  // P5-2.2: held funds with a daily close history (replay targets). A fund =
  // the user's fund-type classification, else the look-through heuristic.
  const heldFunds = useMemo(() => {
    const CH = window.MaerminCloseHistory, LT = window.MaerminLookThrough;
    const GT = window.TaxCalculationEngine && window.TaxCalculationEngine.GermanTax;
    if (!CH) return [];
    let types = {};
    try { types = (GT && GT.loadFundTypes) ? GT.loadFundTypes() : {}; } catch (e) {}
    const seen = {}, out = [];
    activeTransactions.forEach((tx) => {
      if (!tx || tx.category !== 'stocks' || tx.type !== 'buy') return;
      const sym = String(tx.symbol || '').toUpperCase(), k = CH.keyOf('stocks', sym);
      if (!sym || seen[k] || !closeSeriesEUR[k]) return;
      seen[k] = true;
      if ((types[sym] && types[sym] !== 'none') || (LT && LT.isFundCandidate && LT.isFundCandidate(sym, tx.symbolName || tx.name))) out.push({ key: k, symbol: sym });
    });
    return out;
  }, [activeTransactions, closeSeriesEUR, demoMode]);
  // P5-2.8: the active portfolio's positions with a fund flag (fund type, else
  // the look-through heuristic) for the allocation by ETF provider
  const providerPositions = useMemo(() => {
    const LT = window.MaerminLookThrough, GT = window.TaxCalculationEngine && window.TaxCalculationEngine.GermanTax;
    let types = {};
    try { types = (GT && GT.loadFundTypes) ? GT.loadFundTypes() : {}; } catch (e) {}
    const out = [];
    Object.keys(portfolio || {}).forEach((cat) => {
      if (!Array.isArray(portfolio[cat])) return;
      portfolio[cat].forEach((pos) => {
        const s = pos.symbol || pos.name || '', S = s.toUpperCase(), name = pos.symbolName || pos.name || '';
        const px = prices[s] || prices[s.toLowerCase()] || prices[S] || pos.purchasePrice || 0;
        const fund = cat === 'stocks' && ((types[S] && types[S] !== 'none') || !!(LT && LT.isFundCandidate && LT.isFundCandidate(S, name)));
        out.push({ symbol: S, name, value: (parseFloat(pos.amount) || 0) * px, fund });
      });
    });
    return out;
  }, [portfolio, prices, demoMode]);
  // P5-2.1: the active portfolio's clearing account for the attribution card
  const returnsClearings = activeClearing.clearings;
  const valuePath = useMemo(() => buildValuePath(activeTransactions, activeClearing.merged),
    [activeTransactions, closeSeriesEUR, fetchedPrices, exchangeRate, fxAt, corpActionsRev, demoMode, activeClearing]);
  // P5-2.5: Analysis → Returns follows the gross / net switch; every other
  // view (risk, analytics, Overview) keeps the net path above.
  const returnsPath = useMemo(() => (grossNet === 'gross' ? buildValuePath(activeTransactions, activeClearing.merged, { gross: true }) : valuePath),
    [grossNet, valuePath, activeTransactions, closeSeriesEUR, fetchedPrices, exchangeRate, fxAt, corpActionsRev, demoMode, activeClearing]);
  // P5-1.8: the demo records no snapshots - period returns read the daily value
  // of all demo portfolios instead (securities only, like the snapshots).
  const demoPeriodSeries = useMemo(() => {
    if (!demoMode) return null;
    const vp = buildValuePath(transactions);
    return vp && vp.points && vp.points.length ? vp.points.map(p => ({ d: p.d, v: p.v })) : null;
  }, [demoMode, transactions, closeSeriesEUR, fetchedPrices, exchangeRate, fxAt, corpActionsRev]);

  // Inputs for the analytics views, all from the same daily closes:
  //   index   flow-neutral TWR index [{ d, v }] (≤ 3 years) - benchmark, rolling risk, factors
  //   bySymbol / byLower   per-holding closes on one date grid (≤ 1 year) for the
  //                        correlation matrix (display symbol) and risk metrics (lower-case)
  const dailyAnalytics = useMemo(() => {
    const VP = window.MaerminValuePath, CH = window.MaerminCloseHistory;
    const none = { index: [], bySymbol: {}, byLower: {}, perHolding: {}, partial: {}, since: null };
    if (!VP || !CH || !valuePath || valuePath.twr === null) return none;
    try {
      const keys = [], labels = {}, lower = {};
      let open = 0;
      ['crypto', 'stocks', 'skins', 'commodities'].forEach((cat) => (portfolio[cat] || []).forEach((pos) => {
        const sym = pos.symbol || pos.name || '';
        const k = CH.keyOf(cat, sym);
        if (labels[k]) return;
        open++;
        if (!closeSeriesEUR[k]) return;
        keys.push(k); labels[k] = sym; lower[k] = sym.toLowerCase();
      }));
      const index = VP.index(valuePath, { max: 756 });
      // Per-holding closes replace the refresh history only when EVERY open
      // position has them - a partly covered book would understate risk and
      // drop holdings from the matrix under a "daily closes" label.
      const full = keys.length > 0 && keys.length === open;
      // Per-holding views (FX attribution) take each holding's own closes, also
      // when not every holding has them (VIS-005).
      const perHolding = {};
      keys.forEach((k) => {
        const pts = closeSeriesEUR[k].closes.filter((c) => c[1] > 0).slice(-365).map((c) => ({ timestamp: c[0], price: c[1] }));
        if (pts.length >= 2) perHolding[labels[k]] = pts;
      });
      return {
        index,
        perHolding,
        // the holdings that have closes, on one date grid (correlation, labelled as partial)
        partial: (!full && keys.length >= 2) ? VP.alignedCloses(closeSeriesEUR, keys, { max: 365, labels }) : {},
        bySymbol: full ? VP.alignedCloses(closeSeriesEUR, keys, { max: 365, labels }) : {},
        byLower: full ? VP.alignedCloses(closeSeriesEUR, keys, { max: 365, labels: lower }) : {},
        since: index.length ? index[0].d : null
      };
    } catch (e) { return none; }
  }, [valuePath, closeSeriesEUR, portfolio]);

  const showApiSettings = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.apiSettings);
  const setShowApiSettings = (v) => { const n = typeof v === 'function' ? v(showApiSettings) : v; n ? window.MaerminUI.openOverlay('apiSettings') : window.MaerminUI.closeOverlay('apiSettings'); };
  const showSettings = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.settings);
  const setShowSettings = (v) => { const n = typeof v === 'function' ? v(showSettings) : v; n ? window.MaerminUI.openOverlay('settings') : window.MaerminUI.closeOverlay('settings'); };
  // R2.1: the phone dock's "More" sheet (Tax, Insight, Settings).
  const showMoreNav = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.moreNav);
  const setShowMoreNav = (v) => { v ? window.MaerminUI.openOverlay('moreNav') : window.MaerminUI.closeOverlay('moreNav'); };

  // Onboarding wizard + recovery-kit enrollment (existing users)
  const showOnboarding = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.onboarding);
  const setShowOnboarding = (v) => { const n = typeof v === 'function' ? v(showOnboarding) : v; n ? window.MaerminUI.openOverlay('onboarding') : window.MaerminUI.closeOverlay('onboarding'); };
  const showRecoveryKit = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.recoveryKit);
  const setShowRecoveryKit = (v) => { const n = typeof v === 'function' ? v(showRecoveryKit) : v; n ? window.MaerminUI.openOverlay('recoveryKit') : window.MaerminUI.closeOverlay('recoveryKit'); };
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  // SEC-017: "Replace encryption key" in Security & sync asks for the password inline.
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotatePw, setRotatePw] = useState('');
  const [rotateBusy, setRotateBusy] = useState(false);
  const [recoverySaved, setRecoverySaved] = useState(false); // "I saved it" ticked in the code dialog
  // Security & Sync settings card
  const showSecurity = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.security);
  const setShowSecurity = (v) => { const n = typeof v === 'function' ? v(showSecurity) : v; n ? window.MaerminUI.openOverlay('security') : window.MaerminUI.closeOverlay('security'); };
  const [syncBusy, setSyncBusy] = useState(false);
  const [securityRev, setSecurityRev] = useState(0); // bump to re-read vault/sync status
  const [recoveryNudgeDismissed, setRecoveryNudgeDismissed] = useState(() => {
    try { return localStorage.getItem('maermin_recovery_nudge') === 'dismissed'; } catch (e) { return false; }
  });
  const [, setFirstStepsRev] = useState(0); // re-render the First steps card after Hide or a backup

  // Transactions filter/search
  const [txSearch, setTxSearch] = useState('');
  const [txSortBy, setTxSortBy] = useState('date-desc'); // date-desc, date-asc, amount-desc, symbol
  const [txDeleteConfirm, setTxDeleteConfirm] = useState(null); // txId waiting for confirm
  const [txType, setTxType] = useState('all'); // R3.3 (B-5): the type chip
  const [txSelected, setTxSelected] = useState(null); // R3.3 (B-5): the booking in the detail panel
  
  // Tax
  const [taxJurisdiction, setTaxJurisdiction] = useState(() => {
    return localStorage.getItem('taxJurisdiction') || 'de';
  });
  // Tax report: selected year + taxpayer details (persisted), used by the
  // filing-grade report builder (MaerminTaxReport).
  const [taxYear, setTaxYear] = useState(() => new Date().getFullYear());
  // Active tab of the Tax view. Kept HERE, not inside TaxCombinedView: that
  // component is declared inside InvestmentTracker, so every re-render of the
  // app (changing the tax year, a price refresh, a toast) remounts it and a
  // local useState fell back to 'fifo' - e.g. picking another year on the Tax
  // Report tab jumped back to the FIFO tab.
  const [taxTab, setTaxTab] = useState('fifo');
  // Bumped when tax settings change, to recompute the summary cards/report.
  const [taxSettingsRev, setTaxSettingsRev] = useState(0);
  // Overview row → position detail modal (transactions, CAGR, splits, journal).
  const [positionDetail, setPositionDetail] = useState(null);
  // P5-5.4: the symbol shown on the Research page
  const [researchSymbol, setResearchSymbol] = useState('');
  // CH-3a: the symbol shown in Charts ('' = the view's own last symbol)
  const [chartsSymbol, setChartsSymbol] = useState('');
  const openCharts = (sym) => { setChartsSymbol(String(sym || '').toUpperCase()); setActiveView('charts'); };
  // P4-2: Overview positions table shows open or fully sold (closed) positions.
  const [posTab, setPosTab] = useState('open');
  const [taxOwner, setTaxOwner] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_tax_owner') || '{}'); } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem('maermin_tax_owner', JSON.stringify(taxOwner)); }, [taxOwner]);

  // Privacy mode — masks all monetary amounts (for screenshots / public viewing)
  const [privacyMode, setPrivacyMode] = useState(() => localStorage.getItem('privacyMode') === '1');
  // Audit 2026-10-24 feature 5: the previous visit day (since-last-visit.js),
  // read once per session after unlock; null = first visit or same day.
  const [lastVisitDay, setLastVisitDay] = useState(null);
  const [sinceVisitClosed, setSinceVisitClosed] = useState(false);
  const lastVisitRead = useRef(false);
  // Audit 2026-10-24 feature 7: the newest RELEASE.md section after an update
  // (whats-new.js). Fetched only when the version differs from the last seen.
  const [whatsNew, setWhatsNew] = useState(null);
  const whatsNewChecked = useRef(false);
  useEffect(() => {
    const WN = window.MaerminWhatsNew, version = window.MaerminBackup && window.MaerminBackup.VERSION;
    if (!WN || !version || demoMode || !startupSynced || whatsNewChecked.current) return;
    whatsNewChecked.current = true;
    if (WN.check(localStorage, version) !== 'show') return;
    fetch('RELEASE.md', { cache: 'no-cache', signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.text() : ''))
      .then((md) => {
        const notes = WN.parseLatest(md);
        if (notes && notes.version === version) setWhatsNew(notes);
        else WN.markSeen(localStorage, version); // no notes for this version: nothing to show
      })
      .catch(() => { /* offline: try again on the next start */ });
  }, [demoMode, startupSynced]);
  useEffect(() => {
    const SV = window.MaerminSinceVisit;
    if (!SV || demoMode || !startupSynced || lastVisitRead.current) return;
    lastVisitRead.current = true;
    setLastVisitDay(SV.begin(localStorage, window.MaerminUtils.todayISO()));
  }, [demoMode, startupSynced]);

  // Bumped when async equity metadata (sector/country) is backfilled, so the
  // Strategy tab recomputes even if the user is already on it.
  const [metaVersion, setMetaVersion] = useState(0);
  // P5-2.10: the active portfolio's holdings with what "fill from data" reads
  const taxonomyHoldings = useMemo(() => {
    const EM = window.MaerminEquityMeta, GT = window.TaxCalculationEngine && window.TaxCalculationEngine.GermanTax;
    let types = {};
    try { types = (GT && GT.loadFundTypes) ? GT.loadFundTypes() : {}; } catch (e) {}
    const out = [];
    Object.keys(portfolio || {}).forEach((cat) => {
      if (!Array.isArray(portfolio[cat])) return;
      portfolio[cat].forEach((pos) => {
        const s = pos.symbol || pos.name || '', S = s.toUpperCase();
        const px = prices[s] || prices[s.toLowerCase()] || prices[S] || pos.purchasePrice || 0;
        const meta = cat === 'stocks' && EM && EM.getMeta ? EM.getMeta(S) : {};
        out.push({ symbol: S, name: pos.symbolName || pos.name || '', category: cat, value: (parseFloat(pos.amount) || 0) * px,
          fundType: types[S] || '', sector: meta.sector || '', country: meta.country || '' });
      });
    });
    return out;
  }, [portfolio, prices, metaVersion, demoMode]);

  // Security log viewer modal (reads window.MaerminAuditLog).
  const showAuditLog = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.auditLog);
  const setShowAuditLog = (v) => { const n = typeof v === 'function' ? v(showAuditLog) : v; n ? window.MaerminUI.openOverlay('auditLog') : window.MaerminUI.closeOverlay('auditLog'); };

  // ========== COMPUTED VALUES ==========
  
  // Merge: English is the base, the selected language overrides it — so any key
  // missing from a non-English locale gracefully falls back to English.
  // MaerminI18n follows the same language during this render, so modules that
  // translate through it (and the locale formatters) match the `t` below.
  window.MaerminI18n.setLang(language);
  const t = window.MaerminI18n.dict(language);
  useEffect(() => { window.MaerminI18n.applyHtmlLang(language); }, [language]);
  const currentTheme = themes[theme] || themes.dark;

  // Mirror the active theme onto <html> so CSS-only chrome (palette, toasts,
  // scrollbars, popovers, bottom dock) follows it via CSS variables.
  // Layout effect: set before the first paint, or a light theme would flash dark.
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', currentTheme.name || 'dark');
    root.setAttribute('data-mode', currentTheme.mode || 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', window.MaerminTokens.resolve('var(--bg)'));
  }, [currentTheme]);
  
  const formatPrice = useCallback((price) => {
    // Privacy mode masks every amount app-wide (formatPrice is the single
    // formatter every view uses), without touching the underlying data.
    if (privacyMode) return '••••••';
    if (price === undefined || price === null || isNaN(price)) return '0.00';
    // All prices are stored in EUR
    // If user wants USD, convert from EUR to USD by dividing by the USD->EUR rate
    const converted = currency === 'USD' && exchangeRate > 0 ? price / exchangeRate : price;
    return window.MaerminI18n.num(converted, 2, language);
  }, [currency, exchangeRate, privacyMode, language]);

  const getCurrencySymbol = () => currency === 'EUR' ? '€' : '$';

  // Category display names
  // P5-1.3: cash bookings in the transactions list.
  const isCashRow = (tx) => !!(window.MaerminLedger && window.MaerminLedger.isCash(tx));
  const portfolioName = (id) => ((portfolios || []).find(p => p.id === id) || {}).name || String(id || '');
  const getCategoryDisplayName = (category) => {
    const displayNames = { crypto: t.crypto || 'Crypto', stocks: t.stocks || 'Stocks', skins: t.cs2Skins || 'CS2 Skins', commodities: __('catCommodities', 'Commodities'), options: __('catOptions', 'Options'), bonds: __('catBonds', 'Bonds') };
    if (displayNames[category]) return displayNames[category];
    // v10.x: resolve user-defined custom categories (custom-categories.js).
    if (window.MaerminCategories) { try { return window.MaerminCategories.label(category); } catch (e) {} }
    return category;
  };

  // Calculate portfolio totals (shared stats helper — same math everywhere).
  const portfolioStats = useMemo(
    () => window.MaerminMetrics.computeStats(portfolio, prices),
    [portfolio, prices]
  );

  // ALL portfolios combined totals — used on Overview to show total wealth.
  const allPortfoliosStats = useMemo(
    () => Object.assign({}, window.MaerminMetrics.computeStats(allPortfoliosPortfolio, prices), { portfolioCount: portfolios.length }),
    [allPortfoliosPortfolio, prices, portfolios]
  );

  // ========== COMMANDS FOR PALETTE ==========
  
  const commands = useMemo(() => [
    // Portfolio
    { id: 'nav:overview',      label: t.overview || 'Overview',            category: __('palCatPortfolio', 'Portfolio'),  shortcut: 'g o' },
    { id: 'nav:transactions',  label: t.transactions || 'Transactions',    category: __('palCatPortfolio', 'Portfolio'),  shortcut: 'g t' },
    { id: 'nav:dividends',     label: t.dividendCalendar || 'Dividends',   category: __('palCatPortfolio', 'Portfolio'),  shortcut: 'g d' },
    { id: 'nav:journal',       label: t.tradeJournal || 'Journal',         category: __('palCatPortfolio', 'Portfolio'),  shortcut: 'g j' },
    // Analysis
    { id: 'nav:returns',       label: t.returns || 'Returns & XIRR',       category: __('palCatAnalysis', 'Analysis'),   shortcut: 'g r' },
    { id: 'nav:performance',   label: t.navPerformance || 'Performance',   category: __('palCatAnalysis', 'Analysis'),   shortcut: 'g f' },
    { id: 'nav:rebalancing',   label: t.rebalancing || 'Rebalancing',      category: __('palCatAnalysis', 'Analysis'),   shortcut: 'g b' },
    { id: 'nav:analytics',     label: t.analytics || 'Portfolio Analysis', category: __('palCatAnalysis', 'Analysis'),   shortcut: 'g a' },
    { id: 'nav:taxes',         label: t.taxes || 'Taxes',                  category: __('palCatAnalysis', 'Analysis'),   shortcut: 'g x' },
    // Tools
    { id: 'nav:intelligence',  label: t.intelTitle || 'Portfolio Intelligence', category: __('palCatTools', 'Tools'), shortcut: 'g i' },
    { id: 'nav:tags',          label: t.navTags || 'Tags',                 category: __('palCatTools', 'Tools'),      shortcut: 'g s' },
    { id: 'nav:discovery',     label: t.discovery || 'Discovery',          category: __('palCatTools', 'Tools'),      shortcut: 'g e' },
    { id: 'nav:charts',        label: __('navCharts', 'Charts'),           category: __('palCatAnalysis', 'Analysis'),   shortcut: 'g k' },
    { id: 'nav:share',         label: t.navShare || 'Share & Compare',     category: __('palCatTools', 'Tools'),      shortcut: 'g h' },
    { id: 'nav:trash',         label: t.navTrash || 'Trash',               category: __('palCatTools', 'Tools') },
    { id: 'nav:privacy',       label: t.navPrivacy || 'Privacy',           category: __('palCatTools', 'Tools') },
    { id: 'nav:watchlist',     label: t.watchlist || 'Watchlist',          category: __('palCatTools', 'Tools'),      shortcut: 'g w' },
    { id: 'nav:rules',         label: t.navRules || 'Alerts & Rules',      category: __('palCatTools', 'Tools'),      shortcut: 'g u' },
    { id: 'nav:categories',    label: t.navCategories || 'Categories',     category: __('palCatTools', 'Tools'),      shortcut: 'g c' },
    { id: 'nav:customize',     label: t.navCustomize || 'Customize Overview', category: __('palCatTools', 'Tools'),   shortcut: 'g y' },
    { id: 'nav:broker-import', label: t.brokerImport || 'Broker Import',   category: __('palCatTools', 'Tools'),      shortcut: 'g m' },
    // Actions
    { id: 'action:add',        label: t.addTransaction || 'Add Transaction', category: __('palCatActions', 'Actions'),  shortcut: 'n' },
    { id: 'action:refresh',    label: t.refresh || 'Refresh prices',       category: __('palCatActions', 'Actions'),    shortcut: 'r' },
    { id: 'action:backup',     label: t.createBackup || 'Create Backup',   category: __('palCatActions', 'Actions'),    shortcut: 'b' },
    { id: 'action:import',     label: t.importData || 'Import Data',       category: __('palCatActions', 'Actions'),    shortcut: 'i' },
    { id: 'action:privacy',    label: t.privacyMode || 'Hide amounts (Privacy)', category: __('palCatActions', 'Actions'), shortcut: 'p' },
    // Settings
    { id: 'settings:dark',     label: t.darkMode || 'Dark Mode',           category: __('palCatDesign', 'Design') },
    { id: 'settings:light',    label: t.whiteMode || 'Light Mode',         category: __('palCatDesign', 'Design') },
    { id: 'settings:purple',   label: t.purpleMode || 'Nebula',       category: __('palCatDesign', 'Design') },
    { id: 'settings:contrast', label: t.contrastMode || 'High Contrast',   category: __('palCatDesign', 'Design') },
    { id: 'settings:cb',       label: t.cbMode || 'Colour-Blind Safe',     category: __('palCatDesign', 'Design') },
    { id: 'settings:mode-simple',   label: (t.uiMode || 'View') + ': ' + (t.uiModeSimple || 'Simple'),     category: __('palCatDesign', 'Design') },
    { id: 'settings:mode-advanced', label: (t.uiMode || 'View') + ': ' + (t.uiModeAdvanced || 'Advanced'), category: __('palCatDesign', 'Design') },
    { id: 'help:shortcuts',    label: t.keyboardShortcuts || 'Keyboard Shortcuts', category: __('palCatHelp', 'Help'), shortcut: '?' },
  ], [t]);

  // ========== COMMAND EXECUTION (moved below function definitions) ==========

  // ========== KEYBOARD SHORTCUTS ==========
  
  // Ref for settings dropdown close-on-outside-click
  const settingsRef = useRef(null);
  const settingsBtnRef = useRef(null);
  // Dialogs opened from the account menu: the menu item is gone when they
  // close, so focus goes back to the account button.
  const focusAccountButton = () => settingsBtnRef.current;

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Escape closes modals & dropdowns — even while an input inside one is focused
      if (e.key === 'Escape') {
        window.MaerminUI.closeOverlay('commandPalette');
        window.MaerminUI.closeOverlay('shortcuts');
        setShowTransactionModal(false);
        setShowImportModal(false);
        setShowApiSettings(false);
        // Closing the settings panel by keyboard gives focus back to its button
        // (it used to fall to <body>, i.e. the start of the page).
        const pop = document.getElementById('mx-settings-panel');
        const active = document.activeElement;
        if (pop && (pop.contains(active) || !active || active === document.body)) {
          setTimeout(() => { if (settingsBtnRef.current) settingsBtnRef.current.focus(); }, 0);
        }
        setShowSettings(false);
        setShowPasswordModal(false);
        return;
      }

      // Command palette: Ctrl+K or Cmd+K — works from anywhere, including inputs
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        window.MaerminUI.toggleOverlay('commandPalette');
        return;
      }

      // Ignore if in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;
      
      // ? shows shortcuts
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        window.MaerminUI.openOverlay('shortcuts');
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
    const savedKeys = window.MaerminUtils.safeParse(saved('apiKeys'), null);
    if (savedKeys) setApiKeys(savedKeys);
    const savedHistory = window.MaerminUtils.safeParse(saved('priceHistory'), null);
    if (savedHistory) setPriceHistory(savedHistory);
  }, []);

  useEffect(() => { window.MaerminPrefs.set('theme', theme); }, [theme]);
  useEffect(() => { window.MaerminPrefs.set('currency', currency); }, [currency]);
  // Demo mode is read-only over the user's data: never write sample transactions
  // back to the real 'transactions' key.
  // Track deletions/edits for conflict-free cloud sync (tombstones + edit
  // stamps, see sync-engine trackTxChanges). The first run of a mount only
  // seeds the baseline, so a remount never stamps anything.
  const txTrackRef = useRef(null);
  useEffect(() => {
    if (demoMode) { txTrackRef.current = null; return; }
    localStorage.setItem('transactions', JSON.stringify(transactions));
    const S = window.MaerminSync;
    if (!S || !S.trackTxChanges) return;
    try {
      const prevMap = txTrackRef.current;
      const res = S.trackTxChanges(prevMap, transactions, localStorage.getItem(S.TX_META_KEY));
      txTrackRef.current = res.map;
      // A deleted savings-plan auto-execution means "skip that due date" -
      // otherwise the idempotent catch-up would book it again immediately.
      const EX = window.MaerminSavingsExecutor;
      if (prevMap && EX && EX.markSkipped) {
        const gone = Object.keys(prevMap).filter((id) => res.map[id] === undefined)
          .map((id) => { try { return JSON.parse(prevMap[id]); } catch (e) { return null; } })
          .filter(Boolean);
        if (gone.length) {
          const plans = window.MaerminUtils.safeParse(localStorage.getItem(EX.PLANS_KEY), []) || [];
          const sk = EX.markSkipped(plans, gone);
          if (sk.changed) localStorage.setItem(EX.PLANS_KEY, JSON.stringify(sk.plans));
          // Same for auto-booked dividends.
          const DX = window.MaerminDividendExecutor;
          if (DX && DX.markSkipped) DX.markSkipped(gone);
        }
      }
      if (res.changed) localStorage.setItem(S.TX_META_KEY, JSON.stringify(res.meta));
      // A real change (not the baseline run after a mount) goes to the other
      // devices without waiting for the tab to be hidden (FINDINGS H-6).
      if (prevMap && S.scheduleSync) S.scheduleSync();
    } catch (e) { console.warn('[sync] change tracking failed:', e); }
  }, [transactions, demoMode]);
  // Quota-safe priceHistory persistence. Per-symbol points are already capped at
  // 100; here we also drop the oldest half if localStorage rejects the write
  // (QuotaExceededError) so the app never crashes on a full store.
  useEffect(() => {
    if (demoMode) return; // don't pollute real history with demo prices
    const write = (obj) => localStorage.setItem('priceHistory', JSON.stringify(obj));
    try { write(priceHistory); }
    catch (e) {
      try {
        const trimmed = {};
        Object.keys(priceHistory).forEach((sym) => {
          const arr = priceHistory[sym] || [];
          trimmed[sym] = arr.slice(-Math.max(10, Math.floor(arr.length / 2)));
        });
        write(trimmed);
        console.warn('[priceHistory] storage near quota — trimmed history in half');
      } catch (e2) { console.error('[priceHistory] could not persist:', e2); }
    }
  }, [priceHistory, demoMode]);
  useEffect(() => { localStorage.setItem('taxJurisdiction', taxJurisdiction); }, [taxJurisdiction]);
  useEffect(() => { localStorage.setItem('privacyMode', privacyMode ? '1' : '0'); }, [privacyMode]);
  useEffect(() => { localStorage.setItem('apiKeys', JSON.stringify(apiKeys)); }, [apiKeys]);

  // v10: record a daily Portfolio Value Snapshot (window.MaerminSnapshots). This
  // is the on-device, ground-truth value history that survives price-API outages
  // and is carried in the full-vault backup. One point per day per portfolio;
  // a same-day change overwrites that day, so this can never bloat storage. Never
  // records in demo mode (would pollute the real series with sample prices).
  // Throttle: prices update on every poll, so we skip the localStorage write when
  // the (rounded) value is unchanged since the last write this session.
  const lastSnapRef = useRef({});
  useEffect(() => {
    try {
      if (demoMode || !window.MaerminSnapshots) return;
      const byPid = {}; // portfolioId -> combined total
      let combined = 0;
      // The open quantities come from the one FIFO ledger (date-ordered, splits
      // applied, same-day buys before sells) - summing raw rows in stored order
      // clamped sells that were stored before their buy and ignored splits
      // (AUDIT BUG-025).
      const M = window.MaerminMetrics;
      if (!M || !M.buildPositions) return;
      const byPortfolio = {};
      transactions.forEach((tx) => { const pid = tx.portfolioId || 'default'; (byPortfolio[pid] = byPortfolio[pid] || []).push(tx); });
      Object.keys(byPortfolio).forEach((pid) => {
        const grouped = M.buildPositions(byPortfolio[pid], { exchangeRate, fxAt });
        Object.keys(grouped).forEach((cat) => (grouped[cat] || []).forEach((pos) => {
          const amount = parseFloat(pos.amount) || 0;
          if (amount <= 0.0001) return;
          const sym = pos.symbol || pos.name || '';
          const pr = prices[sym] || prices[sym.toLowerCase()] || prices[sym.toUpperCase()] || 0;
          const val = amount * pr;
          combined += val;
          byPid[pid] = (byPid[pid] || 0) + val;
        }));
      });
      const round = (v) => Math.round(v * 100) / 100;
      const recordIfChanged = (val, pid) => {
        const key = pid || 'all';
        const r = round(val);
        if (lastSnapRef.current[key] === r) return; // unchanged → skip the write
        window.MaerminSnapshots.record(val, pid);
        lastSnapRef.current[key] = r;
      };
      if (combined > 0) {
        recordIfChanged(combined); // combined 'all' series
        Object.keys(byPid).forEach((pid) => {
          if (byPid[pid] > 0) recordIfChanged(byPid[pid], pid);
        });
        // C3: per-tag value series ('tag:<name>') so each tag's performance over
        // time can be derived later (Tags view). Reuses the same throttle.
        if (window.MaerminTags) {
          try {
            const tpos = window.MaerminTags.positionsFromInputs(transactions, prices);
            const agg = window.MaerminTags.aggregate(window.MaerminTags.load(), tpos);
            agg.rows.forEach((row) => { if (row.value > 0) recordIfChanged(row.value, 'tag:' + row.name); });
          } catch (e) { /* tag series is best-effort */ }
        }
      }
    } catch (e) { /* snapshots are best-effort; never break a render */ }
  }, [transactions, prices, demoMode, exchangeRate, fxAt]);

  // First run: open the guided setup wizard once when there's no Worker, no data
  // and we're not in demo mode. A flag keeps it from reappearing every load.
  useEffect(() => {
    try {
      if (demoMode) return;
      if (localStorage.getItem('maermin_onboarded') === '1') return;
      const hasWorker = (apiKeys.cs2Worker || '').trim().length > 5;
      // Read persisted transactions directly — React state may not be hydrated yet
      // on the first mount, which would otherwise pop the wizard for existing users.
      let hasTx = false;
      try { const s = localStorage.getItem('transactions'); hasTx = !!(s && JSON.parse(s).length); } catch (e) {}
      if (!hasWorker && !hasTx && window.MaerminOnboarding && window.MaerminOnboarding.Wizard) setShowOnboarding(true);
    } catch (e) {}
  }, []); // run once on mount

  // Backup reminder — data is browser-only, so a cleared profile = total loss
  // without an export. Once per mount, after a short delay, nudge the user (toast)
  // if the backup engine says one is due (never in demo mode, never on an empty
  // app). Snoozed for a week so it can't nag; cleared whenever a backup is made.
  useEffect(() => {
    if (demoMode || !window.MaerminBackupReminder) return;
    let txCount = 0;
    try { const s = localStorage.getItem('transactions'); txCount = s ? (JSON.parse(s) || []).length : 0; } catch (e) {}
    if (!window.MaerminBackupReminder.isDue(txCount)) return;
    const id = setTimeout(() => {
      try {
        if (window.MaerminUI) window.MaerminUI.add(__('backupTip', 'Tip: export an encrypted backup (press b) — your data lives only in this browser'), 'warning');
        window.MaerminBackupReminder.recordSnooze(7);
      } catch (e) {}
    }, 4000);
    return () => clearTimeout(id);
  }, []); // run once on mount

  // Event-bus consumer (demonstrates the decoupling): record a lightweight audit
  // breadcrumb whenever prices refresh, without coupling fetchPrices to the audit
  // log. Subscribes once; auto-unsubscribes on unmount.
  useEffect(() => {
    if (!window.MaerminBus) return;
    const off = window.MaerminBus.on('prices:refreshed', (p) => {
      try { if (window.MaerminAuditLog) window.MaerminAuditLog.record('prices.refresh', `${(p && p.count) || 0} quotes`); } catch (e) {}
    });
    return off;
  }, []); // run once on mount

  // Feature 2 (audit 2026-10-24): ask the browser to keep the data (Chromium
  // grants it without a prompt; Firefox only from the Privacy page's button),
  // and say so loudly when a save of the encrypted data fails.
  useEffect(() => {
    const H = window.MaerminStorageHealth;
    if (!H || demoMode) return;
    try { H.autoRequest(); } catch (e) { /* best effort */ }
    if (!window.MaerminBus) return;
    return window.MaerminBus.on('storage:save-failed', () => {
      addToast(__('shSaveFailedToast', 'Your last change could not be saved: browser storage is full or blocked. Make a backup now (Settings → Backup vault).'), 'error', 20000);
    });
  }, [demoMode]);

  // Re-arm cloud sync from its saved config on reload (the transport itself is
  // not persisted). Zero-knowledge: the account id is derived from the vault.
  useEffect(() => {
    try {
      if (!window.MaerminSync || window.MaerminSync.isConfigured()) return;
      const cfg = window.MaerminSync.getConfig && window.MaerminSync.getConfig();
      if (cfg && cfg.provider === 'worker') {
        const endpoint = cfg.endpoint || (apiKeys.cs2Worker || '').trim();
        if (endpoint) {
          window.MaerminSync.configure({ provider: 'worker', endpoint });
          if (window.MaerminSync.enableAutoSync) window.MaerminSync.enableAutoSync();
        }
      } else if (cfg && (cfg.provider === 'file' || cfg.provider === 'webdav') && window.MaerminSync.rearm) {
        // P5-5.6: a file needs its access permission still granted
        window.MaerminSync.rearm().then((yes) => { if (yes && window.MaerminSync.enableAutoSync) window.MaerminSync.enableAutoSync(); }, () => {});
      }
    } catch (e) {}
  }, []); // run once on mount

  // Demo mode drives prices from the offline sample set — no network, instant value.
  useEffect(() => {
    if (demoMode && window.MaerminDemo) {
      setPrices(window.MaerminDemo.getPrices());
      setExchangeRate(window.MaerminDemo.SETTINGS.exchangeRate);
    }
  }, [demoMode]);

  // Probe the Cloudflare Worker so the header shows a live green/red status and a
  // clear message instead of silent null prices. Skipped in demo mode.
  useEffect(() => {
    if (demoMode || !window.MaerminDataQuality) { setWorkerStatus(null); return; }
    let alive = true;
    const probe = () => window.MaerminDataQuality
      .checkWorkerHealth((apiKeys.cs2Worker || '').trim())
      .then((s) => { if (alive) setWorkerStatus(s); });
    probe();
    const iv = setInterval(probe, 60000);
    return () => { alive = false; clearInterval(iv); };
  }, [demoMode, apiKeys.cs2Worker]);

  // Ask the Worker for its version once per URL: an outdated Worker gets one
  // clear "update" notice instead of features failing one by one.
  useEffect(() => {
    const O = window.MaerminOnboarding;
    const url = (apiKeys.cs2Worker || '').trim();
    if (demoMode || !url) window.MaerminMarket.set('workerVersion', null);
    if (demoMode || !url || !O || !O.checkWorkerVersion) return;
    let alive = true;
    O.checkWorkerVersion(url).then((v) => { if (alive) window.MaerminMarket.set('workerVersion', v); });
    return () => { alive = false; };
  }, [demoMode, apiKeys.cs2Worker, showApiSettings]); // re-checked when API Settings opens or closes (after an update)

  // Warm the dividend cache for held stocks (no-op without a Worker URL or when
  // already cached). Lets the Dividend Forecast/Calendar resolve far more than
  // the built-in ticker list. Cache + 24h TTL keep this within free-tier limits.
  useEffect(() => {
    if (portfolio.stocks && portfolio.stocks.length) {
      if (window.DividendDataService) {
        window.DividendDataService.prefetchPortfolio(portfolio, { workerUrl: marketWorker })
          .then((n) => { if (n > 0) setMetaVersion(v => v + 1); }) // refresh Dividend Forecast once data lands
          .catch(() => {});
      }
      // Backfill sector/country metadata for the Strategy tab (covers existing
      // holdings, manual additions and sync updates — anything that changes the
      // derived portfolio). No-op without a Worker URL; static map still applies.
      if (window.MaerminEquityMeta) {
        // Resolve sector/country through the Worker (Yahoo assetProfile); static
        // map otherwise.
        window.MaerminEquityMeta.prefetchPortfolio(portfolio, { workerUrl: marketWorker })
          .then((n) => { if (n > 0) setMetaVersion(v => v + 1); }) // refresh Strategy views once metadata lands
          .catch(() => {});
      }
    }
  }, [portfolio, marketWorker]);

  // Dividend reminders — heads-up before an upcoming pay date lands. Derived from
  // the ONE DividendDataService schedule; deduped per symbol@date so it never
  // nags twice. Only raises a desktop notification when the user already granted
  // permission (never prompts here); always surfaces a quiet toast. No-op in demo
  // mode and when nothing is due within the window.
  useEffect(() => {
    try {
      if (demoMode || !window.MaerminDividendReminder || !window.DividendDataService) return;
      const schedule = window.DividendDataService.buildPaymentSchedule(portfolio, { months: 1, back: 0 });
      const state = window.MaerminDividendReminder.prune(window.MaerminDividendReminder.load());
      const due = window.MaerminDividendReminder.pending(schedule, state, { withinDays: 7 });
      if (!due.length) { window.MaerminDividendReminder.save(state); return; }
      const msg = window.MaerminDividendReminder.summarize(due, { formatPrice });
      addToast(__('divDueSoon', 'Dividend due soon — {msg}', { msg }), 'info');
      try {
        const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';
        if (canNotify && window.MaerminPWA && window.MaerminPWA.notify) {
          window.MaerminPWA.notify(__('divUpcoming', 'Upcoming dividend'), { body: msg });
        }
      } catch (e) {}
      window.MaerminDividendReminder.save(window.MaerminDividendReminder.markNotified(state, due));
    } catch (e) {}
  }, [portfolio, metaVersion, demoMode]);

  // P5-4.3: Vorabpauschale reminder - once a year in December, when tax on
  // the coming January's Vorabpauschale is expected: how much cash to keep on
  // the clearing account. Toast always; a desktop notification only when the
  // user already granted permission. German jurisdiction only, not in demo mode.
  useEffect(() => {
    try {
      const VF = window.MaerminVapForecast, GT = window.TaxCalculationEngine && window.TaxCalculationEngine.GermanTax;
      if (demoMode || taxJurisdiction !== 'de' || !VF || !GT || !window.MaerminGermanTaxView) return;
      const today = window.MaerminUtils.todayISO();
      if (today.slice(5, 7) !== '12') return;
      const state = VF.loadReminded();
      if (state[today.slice(0, 4)]) return;
      const TS = window.MaerminTaxSettings;
      const s = TS ? TS.load() : null;
      const LT = window.MaerminLookThrough;
      const fc = VF.forecast(transactions, {
        asOf: today, priceHistory, prices, exchangeRate,
        fundTypes: GT.loadFundTypes(), vapRecords: GT.loadVapRecords(), basiszinsOverrides: GT.loadBasiszinsOverrides(),
        freistellungsauftrag: s ? s.freistellungsauftrag : 1000, kirchensteuer: s ? s.kirchensteuer : GT.loadKirchensteuerRate(),
        isFund: (sym, name) => !!(LT && LT.isFundCandidate && LT.isFundCandidate(sym, name))
      });
      if (!VF.reminderDue(fc, state, today)) return;
      const msg = VF.reminderText(fc, { formatMoney: (v) => window.MaerminI18n.money(v, 'EUR') });
      addToast(msg, 'info');
      try {
        const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';
        if (canNotify && window.MaerminPWA && window.MaerminPWA.notify) {
          window.MaerminPWA.notify(__('vfReminderTitle', 'Vorabpauschale in January'), { body: msg });
        }
      } catch (e) {}
      VF.saveReminded(VF.markReminded(state, fc.year));
    } catch (e) {}
  }, [transactions, prices, demoMode, taxJurisdiction]);

  // P5-5.1: what the push reminders are planned from. Read fresh each time
  // (a ref keeps the latest props), so the effect below and the Settings panel
  // send the same plan.
  const pushInputRef = useRef(null);
  pushInputRef.current = { transactions, portfolio, prices, priceHistory, exchangeRate, taxJurisdiction };
  const pushCtx = () => {
    const cur = pushInputRef.current || {};
    const today = window.MaerminUtils.todayISO();
    const input = { today, dividends: [], vap: null, crypto: [], ira: null };
    try {
      if (window.DividendDataService) input.dividends = window.DividendDataService.buildPaymentSchedule(cur.portfolio, { months: 4, back: 0 })
        .map((p) => ({ symbol: p.symbol, date: p.date, amount: p.amount, currency: p.currency }));
    } catch (e) {}
    try {
      const VF = window.MaerminVapForecast, GT = window.TaxCalculationEngine && window.TaxCalculationEngine.GermanTax;
      if (cur.taxJurisdiction === 'de' && VF && GT) {
        const TS = window.MaerminTaxSettings; const s = TS ? TS.load() : null; const LT = window.MaerminLookThrough;
        const fc = VF.forecast(cur.transactions, { asOf: today, priceHistory: cur.priceHistory, prices: cur.prices, exchangeRate: cur.exchangeRate,
          fundTypes: GT.loadFundTypes(), vapRecords: GT.loadVapRecords(), basiszinsOverrides: GT.loadBasiszinsOverrides(),
          freistellungsauftrag: s ? s.freistellungsauftrag : 1000, kirchensteuer: s ? s.kirchensteuer : GT.loadKirchensteuerRate(),
          isFund: (sym, name) => !!(LT && LT.isFundCandidate && LT.isFundCandidate(sym, name)) });
        if (fc) input.vap = { year: fc.year, tax: fc.totals.taxWithoutAllowance };
      }
    } catch (e) {}
    try {
      const CC = window.MaerminCryptoCalendar;
      if (cur.taxJurisdiction === 'de' && CC) {
        const TS = window.MaerminTaxSettings; const ts = TS ? TS.load() : {};
        const cal = CC.calendar(cur.transactions, { today, prices: cur.prices, cryptoExemption: ts.cryptoExemption !== false, perWallet: ts.cryptoPerWallet ? ["crypto"] : undefined });
        (cal.coins || []).forEach((c) => (c.lots || []).forEach((l) => { if (!l.free && l.freeOn) input.crypto.push({ symbol: c.symbol, date: l.freeOn, quantity: l.quantity }); }));
      }
    } catch (e) {}
    try {
      const UC = window.MaerminUSContrib;
      if (cur.taxJurisdiction === 'us' && UC) {
        const y = new Date().getFullYear(), year = today.slice(5) <= '04-15' ? y - 1 : y;
        const r = UC.compute(cur.transactions, UC.loadSettings(), { year, exchangeRate: cur.exchangeRate });
        if (r.accounts.some((a) => a.type !== '401k')) input.ira = { year, remaining: r.ira.remaining };
      }
    } catch (e) {}
    const cryptoSyms = new Set((cur.transactions || []).filter((tx) => tx.category === 'crypto').map((tx) => String(tx.symbol || '').toUpperCase()));
    return {
      input,
      rulesState: window.MaerminRules ? window.MaerminRules.load() : null,
      isCrypto: (s) => cryptoSyms.has(s),
      coinId: (s) => (window.MaerminTickers && window.MaerminTickers.coinGeckoId ? window.MaerminTickers.coinGeckoId(s) : null),
      money: (v, c) => window.MaerminI18n.money(v, c || 'EUR'),
      describe: (rule) => (window.MaerminRules ? window.MaerminRules.describe(rule) : '')
    };
  };
  // Re-plan the push reminders a few seconds after the data settles; syncNow
  // itself skips the upload when nothing changed (and re-sends every 12 h).
  useEffect(() => {
    if (demoMode || !window.MaerminPush || !(apiKeys.cs2Worker || '').trim()) return;
    if (!window.MaerminPush.load().enabled) return;
    const id = setTimeout(() => {
      window.MaerminPush.syncNow(Object.assign(pushCtx(), { workerUrl: (apiKeys.cs2Worker || '').trim() })).catch(() => {});
    }, 5000);
    return () => clearTimeout(id);
  }, [transactions, prices, demoMode, taxJurisdiction, apiKeys.cs2Worker]);

  // ========== API FUNCTIONS ==========
  
  const priceRefreshRef = useRef(false); // a refresh is running (see fetchPrices)
  // opts.silent: an automatic refresh (see AUTO PRICE REFRESH) - it reports a
  // problem once, and again only when it changes (FINDINGS M-11).
  const autoNoticeRef = useRef('ok');
  const sideNoticeRef = useRef(new Set()); // P5-1.2: side notices shown since the last clean refresh
  const fetchPrices = async (opts) => {
    const silent = !!(opts && opts.silent);
    const notify = (key, message, type) => {
      const n = window.MaerminMarket.refreshNotice(key, { silent, lastKey: autoNoticeRef.current });
      if (silent || key === 'ok') autoNoticeRef.current = key;
      if (key === 'ok') sideNoticeRef.current.clear();
      if (n.show && message) addToast(message, type);
    };
    const sideNote = (key, message, type, ms) => { if (window.MaerminMarket.sideNotice(key, { silent, shown: sideNoticeRef.current }).show) addToast(message, type, ms); };
    // Demo mode: re-apply offline sample prices, never hit the network.
    if (demoMode && window.MaerminDemo) {
      setPrices(window.MaerminDemo.getPrices());
      setLastRefresh(new Date());
      if (!silent) addToast(__('demoPrices', 'Demo mode — showing sample prices'), 'info');
      return;
    }
    // One refresh at a time: the `r` shortcut, the stale chip, focus and the
    // timers used to start a second run that overwrote the first one's
    // history and cleared `loading` while it still ran (FINDINGS H-7).
    if (priceRefreshRef.current) return;
    priceRefreshRef.current = true;
    setLoading(true);
    // Price the COMBINED book (all portfolios), not just the active one — the
    // refresh button must refresh every portfolio at once, and the `prices` map
    // is global (keyed by symbol, shared across portfolios) so pricing the union
    // is always correct. Falls back to the active portfolio if the combined
    // build is unavailable.
    const pricePortfolio = allPortfoliosPortfolio || portfolio;
    const newPrices = { ...fetchedPrices };
    // Keys written from a source in THIS run. Everything else in newPrices is
    // an older quote; only these count as "updated" and get a fresh stamp.
    const freshKeys = new Set();
    const putFresh = (key, price) => { newPrices[key] = price; freshKeys.add(key); };
    // ISO-8601 so every consumer (TWR, cash-flow chart, Vorabpauschale prefill,
    // savings-plan pricing) can date the point; the old en-US display string
    // had no year and parsed as 2001. Formatting happens at display time.
    const timestamp = new Date().toISOString();
    
    try {
      // First, fetch USD to EUR exchange rate from ExchangeRate-API (free, no key)
      // https://www.exchangerate-api.com/docs/free
      // Exchange rate direction: USD->EUR means how many EUR for 1 USD
      // EUR is stronger than USD, so rate is ~0.91 (1 USD = 0.91 EUR)
      let usdToEur = exchangeRate || 0.91; // Default fallback
      let fxFetched = false; // only a fetched rate is recorded as today's rate (audit 2026-10-24 BUG-6)
      try {
        // Use the open endpoint which is in the CSP
        // A request that never answers must not keep the refresh (and every
        // later one) waiting (audit 2026-10-24 BUG-8).
        const fxRes = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) });
        if (fxRes.ok) {
          const fxData = await fxRes.json();
          if (fxData.result === 'success' && fxData.rates && fxData.rates.EUR) {
            usdToEur = fxData.rates.EUR;
            fxFetched = true;
            fxLiveFetched.current = true;
            setExchangeRate(usdToEur);
            // Keep the full USD-based table so GBp/CHF/JPY… quotes convert correctly.
            if (window.MaerminFxHistory && window.MaerminFxHistory.setUsdRates) window.MaerminFxHistory.setUsdRates(fxData.rates);
            if (window.MaerminDataQuality) window.MaerminDataQuality.recordFetch(['__fx__'], 'open.er-api.com');
            dbg('[PRICES] Exchange rate: 1 USD =', usdToEur.toFixed(4), 'EUR');
          }
        }
      } catch (e) {
        console.error('[PRICES] Exchange rate fetch error:', e);
        dbg('[PRICES] Using fallback exchange rate: 1 USD =', usdToEur, 'EUR');
      }

      // Quote → EUR for any Yahoo currency (EUR, USD, GBp pence, CHF, …).
      // Unknown currency with no rate → null, i.e. the price stays unresolved
      // rather than being mis-scaled by the USD rate.
      const quoteEUR = (px, cur) => {
        const FXH = window.MaerminFxHistory;
        if (FXH && FXH.quoteToEUR) return FXH.quoteToEUR(px, cur || 'USD', usdToEur);
        return px * ((cur || 'USD') === 'EUR' ? 1 : usdToEur);
      };

      // v11: historical USD→EUR so each transaction is priced on its OWN day
      // (cost basis + German tax need the rate of the date, not one static live
      // rate). Always record today's live rate; once per session, best-effort
      // backfill the daily series via the Worker (Yahoo EURUSD=X). Resolver
      // falls back to the live rate for any uncovered date, so this only ever
      // makes conversions MORE accurate.
      try {
        const FXH = window.MaerminFxHistory;
        if (FXH) {
          if (fxFetched) FXH.merge({ [window.MaerminUtils.todayISO()]: usdToEur });
          const wBase = (marketWorker || '').trim().replace(/\/$/, '');
          if (wBase.length > 5 && !fxSeriesFetched.current) {
            fxSeriesFetched.current = true;
            // Incremental: the full daily history (~20 years) is downloaded once;
            // later sessions only fetch the gap since the last successful backfill.
            const FX_MARK = 'maermin_fx_backfill';
            let lastFill = null;
            try { lastFill = localStorage.getItem(FX_MARK); } catch (e) {}
            const gapDays = lastFill ? (Date.now() - new Date(lastFill).getTime()) / 86400000 : Infinity;
            const fxRange = gapDays < 25 ? '1mo' : gapDays < 360 ? '1y' : 'max';
            const r = await fetch(`${wBase}?action=yf&symbol=${encodeURIComponent('EURUSD=X')}&interval=1d&range=${fxRange}`, { signal: AbortSignal.timeout(8000) });
            if (r.ok) {
              const series = FXH.ingestYahooSeries(await r.json());
              if (Object.keys(series).length) { try { localStorage.setItem(FX_MARK, new Date().toISOString()); } catch (e) {} }
              // Replace (not merge) inside the fetched range, so misdated keys of older builds go away.
              if (Object.keys(series).length) { (FXH.applySeries || FXH.merge)(series); dbg('[PRICES] FX history backfilled:', Object.keys(series).length, 'days'); }
            }
          }
          setFxHistVersion(v => v + 1); // rebuild the resolver with the latest cache
        }
      } catch (e) { /* historical FX is best-effort — resolver falls back to live rate */ }

      // Fetch crypto prices from CoinGecko (free, no API key needed)
      if (pricePortfolio.crypto && pricePortfolio.crypto.length > 0) {
        // Prices are fetched per CoinGecko id; a stored ticker ("BTC" from the
        // exchange sync or an import) is mapped to its id ("bitcoin") and the
        // price is stored under the id AND the stored symbol.
        const toId = window.MaerminTickers?.coinGeckoId || (s => String(s || '').toLowerCase());
        const symsById = {};
        pricePortfolio.crypto.forEach(c => {
          const sym = (c.symbol || c.name || '').trim();
          const id = toId(sym);
          if (!id) return;
          (symsById[id] = symsById[id] || []).push(sym);
        });
        const ids = Object.keys(symsById).join(',');
        const pricedIds = {};
        let cgBusy = false;
        if (ids) {
          try {
            // CoinGecko through the Worker (?action=cg: cached, refusals answered
            // with the last good copy), via the shared queue at high priority so
            // charts and history wait behind the prices.
            const data = await window.MaerminCoinGecko.get('simple/price', { ids, vs_currencies: 'eur,usd', include_24hr_change: 'true' }, { priority: 'high', timeoutMs: 20000 });
            if (data && typeof data === 'object') {
              Object.keys(data).forEach(id => {
                // Store EUR price (or convert from USD if EUR not available)
                const eurPrice = data[id].eur || (data[id].usd * usdToEur);
                if (!(eurPrice > 0)) return;
                putFresh(id, eurPrice);
                putFresh(id.toLowerCase(), eurPrice);
                (symsById[id] || []).forEach(sym => { putFresh(sym, eurPrice); putFresh(sym.toLowerCase(), eurPrice); });
                pricedIds[id] = true;
              });
              dbg('[PRICES] Crypto prices fetched:', Object.keys(data).length);
            }
          } catch (e) {
            if (!(e && e.noWorker)) console.error('[PRICES] CoinGecko error:', e);
            if (e && e.rateLimited) cgBusy = true;
            if (e && e.noWorker && !window.__maerminCgHintShown && (window.__maerminCgHintShown = true)) addToast(__('cgNeedsWorker', 'Crypto prices come through your Worker - add its URL in API Settings'), 'warning', 8000);
          }
          // Coins CoinGecko did not price this run (rate limit, unknown id): the
          // Yahoo USD pair through the Worker, the source the daily crypto
          // history already uses (AUDIT BUG-035).
          const cgBase = (marketWorker || '').trim().replace(/\/$/, '');
          const pairOf = window.MaerminTickers && window.MaerminTickers.yahooCryptoSymbol;
          const unpriced = Object.keys(symsById).filter(id => !pricedIds[id]);
          const cryptoNL = window.MaerminCloseHistory && window.MaerminCloseHistory.noListing;
          if (cgBase.length > 5 && pairOf && unpriced.length) {
            await Promise.all(unpriced.map(async (id) => {
              const pair = pairOf((symsById[id] || [])[0] || id);
              if (!pair || (cryptoNL && cryptoNL.has(pair))) return;
              try {
                const r = await fetch(`${cgBase}?action=yf&symbol=${encodeURIComponent(pair)}&interval=1d&range=5d`, { signal: AbortSignal.timeout(8000) });
                if (r.status === 404 && cryptoNL) cryptoNL.mark(pair);
                if (!r.ok) return;
                const j = await r.json();
                const last = j.prices && j.prices[j.prices.length - 1];
                const eurPrice = last && last.price > 0 ? quoteEUR(last.price, j.currency || 'USD') : null;
                if (!(eurPrice > 0)) return;
                putFresh(id, eurPrice); putFresh(id.toLowerCase(), eurPrice);
                (symsById[id] || []).forEach(sym => { putFresh(sym, eurPrice); putFresh(sym.toLowerCase(), eurPrice); });
                pricedIds[id] = true;
              } catch (e) { /* stays unpriced, reported below */ }
            }));
          }
          if (cgBusy && Object.keys(symsById).some(id => !pricedIds[id])) {
            sideNote('cg-rate', __('cgRateLimited', 'CoinGecko is busy (rate limit) - crypto keeps its last prices, refresh again in a minute'), 'warning', 8000);
          }
        }
      }
      
      // ── Stock Prices: Yahoo Finance via the Worker ──────────────────────
      // v11: no more 10-symbol cap (portfolios above 10 stocks silently lost
      // their prices). The Worker (Yahoo) phase runs CONCURRENTLY in small
      // chunks for ALL stocks, and resolved exchange suffixes are cached in
      // localStorage so we never brute-force ".DE/.L/.PA…" for the same symbol
      // twice. A "stock" whose symbol cannot be a ticker (a CS2 skin filed as
      // a stock) is not sent at all: it cost 7 requests per refresh (bare + 6
      // suffixes), every one a 404, and the flood hit the Worker's rate limit.
      const isTicker = window.MaerminTickers?.isMarketSymbol || (() => true);
      if (pricePortfolio.stocks && pricePortfolio.stocks.length > 0) {
        const workerBase = (marketWorker || '').trim().replace(/\/$/, '');
        const hasWorker  = workerBase.length > 5;
        // Known legacy symbols without an exchange suffix.
        // (shared with the daily close history, so quote and history read the same listing)
        const LEGACY_MAP = (window.MaerminCloseHistory || {}).YF_LEGACY || {};
        // Persistent cache of resolved YF symbols (bare → exchange-suffixed).
        let suffixCache = {};
        try { suffixCache = JSON.parse(localStorage.getItem('maermin_symbol_suffix') || '{}') || {}; } catch (e) {}
        let suffixDirty = false;

        const noListing = window.MaerminCloseHistory && window.MaerminCloseHistory.noListing;
        let lastYfStatus = 0;
        const fetchYfPrice = async (yfSym, ms) => {
          lastYfStatus = 0;
          try {
            const res = await fetch(`${workerBase}?action=yf&symbol=${encodeURIComponent(yfSym)}&interval=1d&range=5d`, { signal: AbortSignal.timeout(ms) });
            lastYfStatus = res.status;
            if (!res.ok) return null;
            const data = await res.json();
            const last = data.prices?.[data.prices.length - 1];
            if (last?.price > 0) return quoteEUR(last.price, data.currency);
          } catch (e) { /* caller decides */ }
          return null;
        };

        // Resolve one stock via the Worker. Returns { sym, symL, priceEUR }.
        const resolveStockYF = async (stock) => {
          const sym  = (stock.symbol || stock.name || '').toUpperCase();
          const symL = sym.toLowerCase();
          if (!hasWorker || !isTicker(sym) || (noListing && noListing.has(sym))) return { sym, symL, priceEUR: null };
          const cached = !sym.includes('.') && (suffixCache[sym] || LEGACY_MAP[sym]);
          const primary = sym.includes('.') ? sym : (cached || sym);
          let priceEUR = null;
          try {
            priceEUR = await fetchYfPrice(primary, 8000);
            let all404 = !priceEUR && lastYfStatus === 404;
            if (priceEUR) dbg('[PRICES] Stock (YF):', primary, '→', priceEUR.toFixed(2), 'EUR');
            // Only brute-force suffixes when nothing is known AND the bare symbol failed.
            if (!priceEUR && !sym.includes('.') && !cached) {
              for (const suffix of ['.DE','.L','.PA','.AS','.ST','.CO']) {
                const p = await fetchYfPrice(sym + suffix, 6000);
                if (p) {
                  priceEUR = p; suffixCache[sym] = sym + suffix; suffixDirty = true;
                  dbg('[PRICES] Stock (YF auto-suffix):', sym, '→', sym + suffix, '→', p.toFixed(2), 'EUR');
                  break;
                }
                if (lastYfStatus !== 404) all404 = false;
              }
            }
            if (!priceEUR && all404 && noListing) noListing.mark(sym);
          } catch (e) {
            console.warn('[PRICES] YF stock failed for', sym, '—', e.message);
          }
          return { sym, symL, priceEUR };
        };

        // Worker/Yahoo, concurrent in chunks for ALL stocks.
        const CHUNK = 6;
        for (let i = 0; i < pricePortfolio.stocks.length; i += CHUNK) {
          const settled = await Promise.all(pricePortfolio.stocks.slice(i, i + CHUNK).map(resolveStockYF));
          settled.forEach(r => {
            if (r.priceEUR && r.priceEUR > 0) { putFresh(r.symL, r.priceEUR); putFresh(r.sym, r.priceEUR); }
          });
        }
        if (suffixDirty) { try { localStorage.setItem('maermin_symbol_suffix', JSON.stringify(suffixCache)); } catch (e) {} }
        const notTickers = pricePortfolio.stocks.map(s => s.symbol || s.name || '').filter(s => s && !isTicker(s));
        if (notTickers.length) console.warn('[PRICES] Not priced as stocks (not a ticker - CS2 skin filed as a stock?):', notTickers.join(', '));
      }

      // ── Commodity Prices: Yahoo Finance futures via the Worker ─────────────
      if (pricePortfolio.commodities && pricePortfolio.commodities.length > 0) {
        const workerBase = (marketWorker || '').trim().replace(/\/$/, '');
        const hasWorker  = workerBase.length > 5;

        // Yahoo Finance Futures symbols for commodities
        const YF_COMMODITY = (window.MaerminCloseHistory || {}).YF_COMMODITY || {};

        for (const pos of pricePortfolio.commodities.slice(0, 8)) {
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
                  priceEUR = quoteEUR(last.price, data.currency);
                  if (priceEUR) dbg('[PRICES] Commodity (YF):', sym, '→', yfSym, '→', priceEUR.toFixed(2), 'EUR');
                }
              }
            } catch(e) {
              console.warn('[PRICES] YF commodity failed for', sym, '—', e.message);
            }
          }

          if (priceEUR && priceEUR > 0) {
            putFresh(sym, priceEUR);
            putFresh(symL, priceEUR);
          }
        }
      }


      // CS2 skins: ONE request for every item - CSGO Trader's daily Steam
      // Market price file through the Worker (MaerminSkinPrices). Prices are
      // stored under the ORIGINAL stored symbol so positions keep resolving.
      if (pricePortfolio.skins && pricePortfolio.skins.length > 0) {
        const workerUrl = (marketWorker || '').trim();
        const SKP = window.MaerminSkinPrices;
        if (!workerUrl) {
          console.warn('[PRICES] No Worker URL — add it in API Settings');
          notify('cs2-worker', __('cs2NeedWorker', 'CS2: add your Worker URL in API Settings'), 'warning');
        } else if (SKP) {
          const index = await SKP.load(workerUrl);
          const names = pricePortfolio.skins.map(s => (s.symbol || s.name || '').trim()).filter(Boolean);
          if (!index) {
            sideNote('cs2-list', __('cs2ListFailed', 'CS2: the skin price list could not be loaded - skins keep their last prices'), 'warning');
          } else {
            let matched = 0;
            names.forEach(skinName => {
              const priceUSD = SKP.priceFor(index, skinName);
              if (!(priceUSD > 0)) { console.warn('[PRICES] CS2: not in the price list:', skinName); return; }
              // Skins are delivered in USD → convert to the canonical EUR at full
              // precision (display rounds later). All downstream calcs read this map.
              const priceEUR = window.MaerminUtils.toEUR(priceUSD, 'USD', usdToEur);
              putFresh(skinName.toLowerCase(), priceEUR);
              putFresh(skinName, priceEUR);
              matched++;
            });
            dbg('[PRICES] CS2 matched:', matched, '/', names.length);
            if (matched < names.length) sideNote('cs2-partial:' + (names.length - matched), __('cs2PartialMatch', 'CS2: {found}/{total} prices found — check the skin names match the Steam Market name exactly', { found: matched, total: names.length }), 'info');
          }
        }
      }
      
      // ── Resilience: carry forward last-known prices ────────────────────────
      // When a source has no price this round (the skin price list could not be
      // loaded, CoinGecko refused), dropping to "no price" would silently
      // collapse the portfolio value. Instead reuse the last-known price from the
      // current map and let the data-quality layer badge it "stale · <age>". We
      // deliberately do NOT re-stamp these as live below, so their per-symbol
      // freshness timestamp stays old and the badge stays honest.
      const carriedKeys = new Set();
      const lastKnownSkin = window.MaerminMarket.lastKnownPrices(priceHistory);
      // Crypto too: when CoinGecko refuses (rate limit), coins keep their
      // last-known price (badged stale) instead of dropping to "no price".
      const carryList = [].concat(pricePortfolio.skins || [], pricePortfolio.crypto || []);
      if (carryList.length) {
        carryList.forEach((s) => {
          const orig = (s.symbol || s.name || '').trim();
          if (!orig) return;
          const keyL = orig.toLowerCase();
          const have = (newPrices[orig] > 0) || (newPrices[keyL] > 0);
          if (have) return;
          const prev = (fetchedPrices[orig] > 0) ? fetchedPrices[orig] : (fetchedPrices[keyL] > 0 ? fetchedPrices[keyL] : (lastKnownSkin[orig] > 0 ? lastKnownSkin[orig] : (lastKnownSkin[keyL] > 0 ? lastKnownSkin[keyL] : null)));
          if (prev != null && prev > 0) {
            newPrices[orig] = prev;
            newPrices[keyL] = prev;
            carriedKeys.add(orig); carriedKeys.add(keyL);
            dbg('[PRICES] carried last-known price for', orig, '→', prev.toFixed(2), 'EUR (stale)');
          }
        });
      }

      // Merge onto the current prices: newPrices copied them before the network
      // wait, so a quote the symbol loader added meanwhile would be lost by a
      // plain set. This run's quotes still win.
      setPrices(prev => ({ ...prev, ...newPrices }));
      // Stamp when each symbol was fetched so the data-quality layer can flag
      // stale/failed quotes (feeds the per-position freshness badges). Only keys
      // fetched in this run are stamped: carried and older quotes keep their
      // previous timestamp so their badge stays honest.
      if (window.MaerminDataQuality) {
        window.MaerminDataQuality.recordFetch(Array.from(freshKeys), 'live');
      }

      // Update price history: on the CURRENT state (a restore may have merged
      // history while this refresh ran) and on copies of each series, never
      // the arrays held by state (audit 2026-10-24 BUG-16).
      setPriceHistory(prev => window.MaerminMarket.appendHistory(prev, newPrices, timestamp, 100));
      
      // Count positions priced in THIS run - not map keys (each symbol sits
      // under 2-3 keys, and older quotes were counted too, FINDINGS H-7).
      const olderKeys = Object.keys(newPrices).filter((k) => newPrices[k] > 0 && !freshKeys.has(k));
      const sum = window.MaerminMarket.refreshSummary(pricePortfolio, Array.from(freshKeys), olderKeys);
      setLastRefresh(new Date());
      // Decoupled signal: any module can react to a refresh without the renderer
      // wiring it a bespoke effect (event-bus foundation, Phase-5 decoupling).
      try { if (window.MaerminBus) window.MaerminBus.emit('prices:refreshed', { count: sum.fetched, total: sum.total, at: Date.now() }); } catch (e) {}
      const key = window.MaerminMarket.summaryKey(sum);
      if (sum.outcome === 'none') {
        notify(key, t.pricesNone || 'No prices could be updated - showing the last known prices', 'warning');
      } else if (sum.outcome === 'partial') {
        notify(key, (t.pricesPartial || '{n} of {total} prices updated - {missing} kept their last price or have none')
          .replace('{n}', sum.fetched).replace('{total}', sum.total).replace('{missing}', sum.total - sum.fetched), 'warning');
        if (sum.missing.length) console.warn('[PRICES] not updated this run:', sum.missing.join(', '));
      } else {
        notify('ok', `${t.pricesUpdated || 'Prices updated'} (${sum.fetched})`, 'success');
      }
    } catch (error) {
      console.error('[PRICES] General error:', error);
      notify('error', t.error || 'Error fetching prices', 'error');
    }

    priceRefreshRef.current = false;
    setLoading(false);
  };

  // ========== AUTO PRICE REFRESH ==========
  // Live-quote freshness without a manual click: re-fetch when the user returns
  // to the tab (visibilitychange/focus), when the network comes back (online),
  // and on a slow background interval while the tab is visible. Throttled so a
  // burst of focus/visibility events can't hammer the data sources, and a no-op
  // in demo mode (offline sample prices). fetchPrices is a per-render closure, so
  // it's reached through a ref that always points at the latest one.
  const fetchPricesRef = useRef(fetchPrices);
  fetchPricesRef.current = fetchPrices;
  const lastAutoRefreshRef = useRef(0);
  useEffect(() => {
    if (demoMode) return;
    const MIN_GAP_MS = 2 * 60 * 1000;   // never auto-refresh more than once / 2 min
    const POLL_MS = 5 * 60 * 1000;      // background interval while visible
    const maybeRefresh = (force) => {
      try {
        if (typeof document !== 'undefined' && document.hidden) return;
        const now = Date.now();
        if (!force && now - lastAutoRefreshRef.current < MIN_GAP_MS) return;
        lastAutoRefreshRef.current = now;
        const fn = fetchPricesRef.current;
        if (typeof fn === 'function') fn({ silent: true });
      } catch (e) {}
    };
    const onVisible = () => { if (!document.hidden) maybeRefresh(false); };
    const onOnline = () => maybeRefresh(true);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);
    const iv = setInterval(() => maybeRefresh(false), POLL_MS);
    // First load after unlock: nothing has been fetched this session and no
    // focus/visibility event fires for an already-focused tab, so the app sat
    // on last-known prices until the user clicked Refresh. Fetch once, shortly
    // after mount so the saved Worker URL / API keys are in state.
    const boot = setTimeout(() => maybeRefresh(true), 600);
    return () => {
      clearTimeout(boot);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(iv);
    };
  }, [demoMode]);

  // ========== DEMO MODE ==========
  // Let a first-time user experience a fully-populated app immediately, without
  // deploying a Worker. Toggling never touches the real transaction store.
  const enterDemo = () => {
    if (!window.MaerminDemo) return;
    window.MaerminDemo.enable();
    setDemoMode(true);
    setTransactions(window.MaerminDemo.getTransactions());
    setPrices(window.MaerminDemo.getPrices());
    setExchangeRate(window.MaerminDemo.SETTINGS.exchangeRate);
    setLastRefresh(new Date());
    { const dc = demoCloses(); closeStoreRef.current = null; setCloseHistory(dc); }
    addToast(__('demoOn', 'Demo mode on — exploring sample data'), 'info');
  };
  const exitDemo = () => {
    // P5-1.9: the public demo link runs on in-memory storage - leaving it opens
    // the normal app (vault screen) at the same address without ?demo.
    const PD = window.MaerminPublicDemo;
    if (PD && PD.active) { window.location.assign(PD.exitUrl(window.location)); return; }
    if (window.MaerminDemo) window.MaerminDemo.disable();
    setDemoMode(false);
    const saved = localStorage.getItem('transactions');
    setTransactions(window.MaerminUtils.safeParse(saved, []) || []);
    setPrices({});
    { const real = window.MaerminCloseHistory ? window.MaerminCloseHistory.load() : null; closeStoreRef.current = real; setCloseHistory(real); }
    addToast(__('demoOff', 'Demo mode off — your data restored'), 'success');
  };

  // ========== ONBOARDING WIZARD ==========
  const saveWorkerUrl = (u) => setApiKeys(prev => ({ ...prev, cs2Worker: u }));
  const openOnboarding = () => setShowOnboarding(true);
  const closeOnboarding = () => {
    setShowOnboarding(false);
    try { localStorage.setItem('maermin_onboarded', '1'); } catch (e) {}
  };

  // ========== RECOVERY KIT (let pre-existing vaults add one) ==========
  // The new code stays pending until the user ticks "I saved it" and presses
  // Done; until then an existing code keeps working (FINDINGS M-6).
  const createRecoveryKit = async () => {
    const A = window.MaerminAuth;
    if (recoveryBusy || !A || !A.enrollRecovery) return;
    const replacing = !!(A.getStatus && A.getStatus().hasRecovery);
    if (replacing && window.MaerminUI && window.MaerminUI.confirm) {
      const yes = await window.MaerminUI.confirm({
        title: t.rcRotateTitle || 'Replace your recovery code?',
        message: t.rcRotateMessage || 'You get a new code. Your current code keeps working until you confirm that you saved the new one; after that it stops working.',
        confirmLabel: t.rcRotateConfirm || 'Create new code',
        cancelLabel: t.cancel || 'Cancel'
      });
      if (!yes) return;
    }
    setRecoveryBusy(true);
    A.enrollRecovery({ pending: true }).then((kit) => {
      setRecoveryCode(kit.code);
      setRecoverySaved(false);
      setShowRecoveryKit(true);
      setRecoveryBusy(false);
    }, () => {
      setRecoveryBusy(false);
      addToast(t.rcCreateFailed || 'Could not create a recovery code. Please try again.', 'error');
    });
  };
  const finishRecoveryKit = (confirmed) => {
    if (confirmed && window.MaerminAuth && window.MaerminAuth.confirmRecovery) {
      window.MaerminAuth.confirmRecovery();
      addToast(t.rcSavedToast || 'Recovery code active', 'success');
    }
    setRecoveryCode('');
    setRecoverySaved(false);
    setShowRecoveryKit(false);
    setSecurityRev(r => r + 1);
  };
  const dismissRecoveryNudge = () => {
    setRecoveryNudgeDismissed(true);
    try { localStorage.setItem('maermin_recovery_nudge', 'dismissed'); } catch (e) {}
  };

  // ========== TOAST NOTIFICATIONS ==========
  
  // Delegates to the MaerminUI store (handles id, cap, auto-dismiss). Kept as a
  // function so the dozens of existing addToast(...) call sites are unchanged.
  const addToast = (message, type = 'info', ttl) => {
    if (window.MaerminUI) return window.MaerminUI.add(message, type, ttl);
  };
  // P4-0: a migration postponed because no copy of the data could be saved
  // is said once at start (details in Settings → Trash).
  useEffect(() => {
    const PM = window.MaerminPreMigration;
    const s = PM && PM.status();
    if (s && s.state === 'blocked') addToast(PM.blockedText(s), 'warning', 15000);
  }, []);
  // In-app confirmation (MaerminUI.confirm → Promise<boolean>); the native
  // dialog only as a fallback if the UI module is missing.
  const askConfirm = (opts) => (window.MaerminUI && window.MaerminUI.confirm)
    ? window.MaerminUI.confirm(opts)
    : Promise.resolve(typeof window.confirm === 'function' ? window.confirm([opts.title, opts.message].filter(Boolean).join('\n\n')) : true);
  // A full backup REPLACES the current data: every restore path asks first,
  // naming the backup's date and size next to the current data.
  const askRestoreBackup = (backup) => {
    const sum = (window.MaerminBackup && window.MaerminBackup.summary) ? window.MaerminBackup.summary(backup) : { timestamp: null, transactionCount: null, keyCount: 0 };
    const when = sum.timestamp ? window.MaerminI18n.date(sum.timestamp, 'dateTime') : __('unknownDate', 'an unknown date');
    const count = sum.transactionCount == null ? __('unknownNumberOf', 'an unknown number of') : sum.transactionCount;
    return askConfirm({
      title: t.restoreBackupTitle || 'Replace your data with this backup?',
      message: __('restoreBackupMsg', 'Backup from {when}: {count} transactions, {sets} data sets.\nYour current data ({current} transactions) and every setting stored in the backup will be replaced. This cannot be undone.\n\nTo keep a copy, cancel and use Data Management → Export & Backup first.', { when, count, sets: sum.keyCount, current: transactions.length }),
      confirmLabel: t.restoreBackupConfirm || 'Replace my data',
      danger: true
    });
  };

  // C1: Automation Rules → live notifications. Evaluate the user's rules on every
  // price/transaction change and fire a toast (+ desktop notification via the
  // existing PWA plumbing) when a rule NEWLY triggers. Deduped per rule id and
  // re-armed when the rule relaxes, so it notifies on the transition, not every
  // poll. Reuses the one context-builder the Rules view uses.
  const notifiedRulesRef = useRef({});
  useEffect(() => {
    try {
      if (demoMode || !window.MaerminRules) return;
      const rulesState = window.MaerminRules.load();
      if (!rulesState.rules.length) return;
      const positions = window.MaerminTags ? window.MaerminTags.pricedPositions(transactions, fetchedPrices) : [];
      const byTag = {};
      if (window.MaerminTags) {
        const agg = window.MaerminTags.aggregate(window.MaerminTags.load(), positions.map(p => ({ symbol: p.symbol, valueEUR: p.valueEUR })));
        agg.rows.forEach(r => { byTag[r.name] = r.value; });
      }
      let drop = 0;
      if (window.MaerminSnapshots) {
        const ser = window.MaerminSnapshots.seriesFor(window.MaerminSnapshots.load(), 'all');
        if (ser.length) { let peak = 0; ser.forEach(p => { if (p.v > peak) peak = p.v; }); drop = peak > 0 ? ((peak - ser[ser.length - 1].v) / peak) * 100 : 0; }
      }
      const ctx = window.MaerminRules.buildContext(positions, { byTag, dropFromPeakPct: drop, prices: fetchedPrices });
      const seen = notifiedRulesRef.current;
      window.MaerminRules.evaluate(rulesState, ctx).forEach(res => {
        if (res.triggered && !seen[res.rule.id]) {
          seen[res.rule.id] = true;
          const desc = window.MaerminRules.describe(res.rule);
          addToast((t.rulesAlert || 'Rule triggered') + ': ' + desc, 'warning');
          try { if (window.MaerminPWA && window.MaerminPWA.notify) window.MaerminPWA.notify('MAERMIN · ' + (t.rulesAlert || 'Rule triggered'), { body: desc, tag: 'maermin-rule-' + res.rule.id }); } catch (e) {}
        } else if (!res.triggered && seen[res.rule.id]) {
          delete seen[res.rule.id]; // re-arm for the next time it triggers
        }
      });
    } catch (e) { /* notifications are best-effort */ }
  }, [transactions, fetchedPrices, demoMode]);

  // ========== BACKUP FUNCTIONS ==========
  
  // Encrypted vault backup: disaster recovery (the vault has no password
  // recovery, so an offline backup file is the only safety net). Counts as a
  // backup for the reminder and the First steps card, like the plain one.
  const downloadVaultBackup = () => {
    if (!window.MaerminStorage || !window.MaerminStorage.exportEncryptedBackup) { addToast(__('backupUnavailable', 'Backup unavailable'), 'error'); return; }
    window.MaerminStorage.exportEncryptedBackup().then((backup) => {
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `maermin-vault-backup-${window.MaerminUtils.todayISO()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      if (window.MaerminAuditLog) window.MaerminAuditLog.record('vault.backup.export', 'encrypted vault backup downloaded');
      try { if (window.MaerminBackupReminder) window.MaerminBackupReminder.recordBackup(transactions.length); } catch (e) {}
      setFirstStepsRev(n => n + 1);
      addToast(__('backupEncDownloaded', 'Encrypted backup downloaded — keep it safe'), 'success');
    }).catch((e) => addToast(__('backupFailedMsg', 'Backup failed: {msg}', { msg: (e && e.message) || (t.error || 'Error') }), 'error'));
  };

  const createBackup = () => {
    if (!window.MaerminBackup) { addToast(__('backupEngineMissing', 'Backup engine not loaded'), 'error'); return; }
    // The full backup is PLAIN JSON (all transactions, net worth, taxpayer name
    // and tax ID). With an encrypted vault, point to the encrypted backup first.
    const encryptedAvailable = !!(window.MaerminStorage && window.MaerminStorage.exportEncryptedBackup && window.MaerminStorage.isEnabled && window.MaerminStorage.isEnabled());
    if (encryptedAvailable) {
      askConfirm({
        title: t.backupPlainTitle || 'Create an unencrypted backup?',
        message: t.backupPlainWarning || 'This file is NOT encrypted: anyone with it can read all your data, including taxpayer name and tax ID.\n\nFor an encrypted copy use Settings → "Backup vault (encrypted)".',
        confirmLabel: t.backupPlainConfirm || 'Create unencrypted backup',
        danger: true
      }).then(yes => { if (yes) writeBackup(); });
      return;
    }
    writeBackup();
  };
  const writeBackup = () => {
    // Build the full snapshot via the shared engine (the single source of truth
    // for which keys are data). It stores each key's raw localStorage string,
    // so the backup round-trips EXACTLY what was entered — including positions
    // with no price/fees/optional fields. Live React state can be one tick ahead
    // of localStorage, so overlay the current transactions/priceHistory.
    const backupData = window.MaerminBackup.snapshot({
      overlay: {
        transactions: JSON.stringify(transactions),
        priceHistory: JSON.stringify(priceHistory)
      }
    });
    // Kept for backwards compatibility with older/partial importers that look
    // for a top-level transactions array and settings object.
    backupData.transactions = transactions;
    backupData.settings = { theme, language, currency, taxJurisdiction };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maermin-backup-${window.MaerminUtils.todayISO()}.json`;
    a.click();
    // Revoking synchronously can cancel the download in Firefox/Safari.
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.export', `Full backup (${transactions.length} transactions, ${Object.keys(backupData.store).length} data keys)`);
    // Record the backup so the reminder engine stops nudging until it goes stale.
    try { if (window.MaerminBackupReminder) window.MaerminBackupReminder.recordBackup(transactions.length); } catch (e) {}
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
      a.download = `maermin-export-${window.MaerminUtils.todayISO()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.export', `CSV export (${transactions.length} transactions)`);
      addToast(t.exportSuccess || 'Export successful', 'success');
    }
  };

  // ========== ADD TRANSACTION ==========
  
  // P5-1.3: a cash booking (or a transfer pair) through MaerminUtils.upsertCash.
  const saveCash = () => {
    const form = {
      type: newTransaction.type,
      amount: window.MaerminUtils.parseDecimal(newTransaction.amount),
      currency: newTransaction.currency || 'EUR',
      date: newTransaction.date,
      notes: newTransaction.notes || '',
      portfolioId: newTransaction.targetPortfolioId || writePortfolioId,
      counterPortfolioId: newTransaction.counterPortfolioId || ''
    };
    const res = window.MaerminUtils.upsertCash(transactions, form, editingTransactionId);
    if (res.error) {
      const msg = { amount: __('txAmountInvalid', 'Enter an amount greater than 0'), date: __('txDateMissing', 'Enter a date'),
        counterPortfolioId: __('txTransferPick', 'Pick the other portfolio of the transfer') }[res.error] || (t.error || 'Error');
      addToast(msg, 'error');
      const el = document.getElementById(res.error === 'amount' ? 'tx-amount' : res.error === 'date' ? 'tx-date' : 'tx-cash-counter');
      if (el && el.focus) el.focus();
      return;
    }
    setTransactions(() => res.transactions);
    addToast(editingTransactionId ? (t.transactionUpdated || 'Transaction updated') : (t.transactionAdded || 'Transaction added'), 'success');
    setNewTransaction({ type: 'buy', category: 'crypto', symbol: '', quantity: '', price: '', date: window.MaerminUtils.todayISO(), fees: '', notes: '', currency: currency });
    setEditingTransactionId(null);
    setShowTransactionModal(false);
  };

  const saveTransaction = (opts) => {
    if (window.MaerminLedger && window.MaerminLedger.isCash(newTransaction)) { saveCash(); return; }
    const isOption = newTransaction.category === 'options';
    // UX-022: a typed stock NAME (not a ticker) has no listing - it would never
    // get a price. Ask before saving it.
    const typedSym = String(newTransaction.symbol || '').trim();
    if (!(opts && opts.typedOk) && newTransaction.category === 'stocks' && newTransaction.symbolTyped && typedSym && !/^[A-Z0-9^][A-Z0-9.\-^=]{0,19}$/.test(typedSym)) {
      askConfirm({
        title: __('txNoListingTitle', 'Save "{sym}" without a listing?', { sym: typedSym }),
        message: __('txNoListingMsg', 'No suggestion was picked, so "{sym}" is not a ticker the price sources know: it gets no market price and is valued at cost. Pick a suggestion from the list for live prices.', { sym: typedSym }),
        confirmLabel: __('txNoListingSave', 'Save anyway'), cancelLabel: __('txNoListingPick', 'Pick a listing')
      }).then((yes) => { if (yes) saveTransaction({ typedOk: true }); });
      return;
    }

    // Option contracts: validate via the engine (the contract identity must be
    // sound or the book grouping corrupts) and derive tx.symbol from it — the
    // symbol field is not user-entered for options.
    let optionFields = null;
    if (isOption) {
      const O = window.MaerminOptions;
      if (!O) { addToast(__('optionsModuleMissing', 'Options module not loaded'), 'error'); return; }
      const candidate = {
        underlying: (newTransaction.underlying || '').trim().toUpperCase(),
        optionType: newTransaction.optionType || 'call',
        strike: window.MaerminUtils.parseDecimal(newTransaction.strike),
        expiry: newTransaction.expiry || '',
        contractSize: newTransaction.contractSize === '' || newTransaction.contractSize == null
          ? null : window.MaerminUtils.parseDecimal(newTransaction.contractSize)
      };
      const v = O.validateOptionTx(candidate);
      if (!v.ok) { addToast(v.errors[0], 'error'); return; }
      optionFields = {
        underlying: candidate.underlying,
        optionType: candidate.optionType,
        strike: candidate.strike,
        expiry: candidate.expiry,
        contractSize: candidate.contractSize || O.DEFAULT_CONTRACT_SIZE
      };
    }

    const effectiveSymbol = isOption ? window.MaerminOptions.contractSymbol(optionFields) : newTransaction.symbol;
    // Name the empty required fields, mark them and focus the first one (the
    // toast used to say only "Please fill required fields").
    const missing = window.MaerminUtils.missingTxFields(newTransaction, effectiveSymbol || '');
    if (missing.length) {
      const fieldNames = { symbol: t.symbol || 'Symbol', quantity: t.quantity || 'Quantity', price: t.pricePerUnit || 'Price per Unit' };
      setTxMissing(missing);
      addToast(`${t.fillInFields || 'Please fill in'}: ${missing.map(f => fieldNames[f]).join(', ')}`, 'error');
      setTimeout(() => {
        const dlg = document.querySelector('[aria-labelledby="dlg-transaction"]') || document;
        const el = missing[0] === 'symbol'
          ? dlg.querySelector('[aria-label="Symbol"], [aria-label="Skin"], [aria-label="Underlying symbol"]')
          : document.getElementById('tx-' + missing[0]);
        if (el && el.focus) el.focus();
      }, 0);
      return;
    }
    setTxMissing([]);

    // Locale-tolerant parsing ("1,5" = 1.5) + hard validation: a NaN quantity or
    // price would silently corrupt every downstream metric.
    const qty = window.MaerminUtils.parseDecimal(newTransaction.quantity);
    // P5-3.9: a bond's price is entered in % of the nominal
    const isBond = newTransaction.category === 'bonds' && !!window.MaerminBonds && (newTransaction.type === 'buy' || newTransaction.type === 'sell');
    const price = window.MaerminUtils.parseDecimal(newTransaction.price) / (isBond ? 100 : 1);
    const fees = window.MaerminUtils.parseDecimal(newTransaction.fees);
    // P4-3: foreign tax withheld on a dividend (in the payout currency)
    const wht = window.MaerminUtils.parseDecimal(newTransaction.withholdingTax);
    if (!(qty > 0)) { addToast(t.invalidQuantity || 'Quantity must be a number greater than 0', 'error'); return; }
    if (isNaN(price) || price < 0) { addToast(t.invalidPrice || 'Price must be a valid number', 'error'); return; }

    const transactionData = {
      type: newTransaction.type,
      category: newTransaction.category,
      symbol: effectiveSymbol,                 // exact YF symbol / CoinGecko ID, or derived option contract
      symbolName: newTransaction.symbolName || '',   // human-readable: "Siemens AG"
      symbolLogoUrl: newTransaction.symbolLogoUrl || '', // logo URL for display
      quantity: qty,                           // options: number of contracts
      price: price,                            // options: premium per share
      fees: (isNaN(fees) || fees < 0) ? 0 : fees,
      date: newTransaction.date,
      notes: newTransaction.notes,
      currency: newTransaction.currency || currency,
      portfolioId: newTransaction.targetPortfolioId || writePortfolioId,
      ...(newTransaction.skinIconUrl ? { skinIconUrl: newTransaction.skinIconUrl } : {}),
      ...(newTransaction.type === 'dividend' ? { withholdingTax: (isNaN(wht) || wht < 0) ? 0 : wht } : {}),
      ...(optionFields || {}),
      ...(isBond ? window.MaerminBonds.txExtras(newTransaction) : {})
    };
    if (isBond) {
      const terms = window.MaerminBonds.termsFromForm(newTransaction, newTransaction.symbolName || '');
      if (terms && !window.MaerminBonds.termsOf(window.MaerminBonds.load(), effectiveSymbol)) {
        window.MaerminBonds.save(window.MaerminBonds.setTerms(window.MaerminBonds.load(), effectiveSymbol, terms));
        setBondsRev(v => v + 1);
      }
    }
    
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
      date: window.MaerminUtils.todayISO(),
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
    const initial = {
      type: 'buy',
      // Start on the category entered last here (it was always Crypto).
      category: window.MaerminUtils.defaultTxCategory(transactions, writePortfolioId,
        ['crypto', 'stocks', 'skins', 'commodities', 'options', 'bonds'].concat(window.MaerminCategories ? window.MaerminCategories.ids() : [])),
      symbol: '',
      quantity: '',
      price: '',
      date: window.MaerminUtils.todayISO(),
      fees: '',
      notes: '',
      currency: currency,
      targetPortfolioId: writePortfolioId,
    };
    setNewTransaction(initial);
    txInitialRef.current = initial;
    setTxMissing([]);
    setShowTransactionModal(true);
  };

  // Start editing a transaction
  const editTransaction = (tx) => {
    // P5-1.3: a cash row opens in Cash mode; a transfer always shows as "from
    // this portfolio to the other", whichever half was clicked.
    if (window.MaerminLedger && window.MaerminLedger.isCash(tx)) {
      const tin = tx.type === 'transfer_in';
      setNewTransaction(txInitialRef.current = {
        type: tin ? 'transfer_out' : tx.type,
        category: 'cashflow',
        amount: tx.amount != null ? String(tx.amount) : '',
        currency: tx.currency || 'EUR',
        date: tx.date || window.MaerminUtils.todayISO(),
        notes: tx.notes || '',
        targetPortfolioId: tin ? (tx.counterPortfolioId || writePortfolioId) : (tx.portfolioId || writePortfolioId),
        counterPortfolioId: tin ? (tx.portfolioId || '') : (tx.counterPortfolioId || ''),
        symbol: '', quantity: '', price: '', fees: ''
      });
      setEditingTransactionId(tx.id);
      setTxMissing([]);
      setShowTransactionModal(true);
      return;
    }
    setNewTransaction(txInitialRef.current = {
      type: tx.type || 'buy',
      category: tx.category || 'crypto',
      symbol: tx.symbol || '',
      quantity: tx.quantity?.toString() || '',
      price: tx.price?.toString() || '',
      date: tx.date || window.MaerminUtils.todayISO(),
      fees: tx.fees?.toString() || '',
      withholdingTax: tx.withholdingTax != null ? String(tx.withholdingTax) : '',
      notes: tx.notes || '',
      currency: tx.currency || 'EUR',
      targetPortfolioId: tx.portfolioId || writePortfolioId,
      // Option contract fields (only set on category 'options' rows).
      underlying: tx.underlying || '',
      optionType: tx.optionType || 'call',
      strike: tx.strike?.toString() || '',
      expiry: tx.expiry || '',
      contractSize: tx.contractSize?.toString() || '',
      // P5-3.9: bonds show the price in % and their accrued interest
      ...(tx.category === 'bonds' && (tx.type === 'buy' || tx.type === 'sell') && window.MaerminBonds ? window.MaerminBonds.toForm(tx) : {}),
    });
    setEditingTransactionId(tx.id);
    setTxMissing([]);
    // NOTE: do NOT call openTransactionModal() here — it resets the form and
    // clears editingTransactionId, which made edits save as brand-new records.
    // Just reveal the modal; the form + editingTransactionId are already set.
    setShowTransactionModal(true);
  };

  // R3.3 (B-5): Duplicate - the same booking as a new one, dated today.
  const duplicateTransaction = (tx) => {
    editTransaction(tx);
    setEditingTransactionId(null);
    setNewTransaction((n) => { const d = Object.assign({}, n, { date: window.MaerminUtils.todayISO() }); txInitialRef.current = d; return d; });
  };

  // Delete a transaction: it goes to the trash (P2-4) and the toast offers Undo.
  // P5-1.3: a transfer goes with its other half (one trash entry, one Undo).
  const deleteTransaction = (txId) => {
    const tx = transactions.find(x => x.id === txId);
    const pair = tx && window.MaerminLedger ? window.MaerminLedger.pairOf(transactions, tx) : null;
    const gone = new Set([txId].concat(pair ? [pair.id] : []));
    setTransactions(prev => prev.filter(x => !gone.has(x.id)));
    const TR = window.MaerminTrash;
    if (!tx || !TR) { addToast(t.transactionDeleted || 'Transaction deleted', 'success'); return; }
    const I = window.MaerminI18n;
    const amountTxt = window.MaerminLedger && window.MaerminLedger.isCash(tx) ? I.num(parseFloat(tx.amount) || 0, 2) + ' ' + (tx.currency || 'EUR')
      : (tx.quantity != null ? I.num(tx.quantity, { min: 0, max: 8 }) : '');
    const label = [window.MaerminUtils.txTypeInfo(tx.type).label, amountTxt, tx.symbol, '·', tx.date ? I.date(tx.date) : ''].filter(Boolean).join(' ');
    TR.toastUndo(t.transactionDeleted || 'Transaction deleted', TR.put('transaction', label, pair ? [tx, pair] : tx));
  };

  // Audit 2026-10-24 feature 3: every import run stamps its rows with one
  // importId and is logged (import-runs.js), so Import / Export can undo the
  // whole run: its rows that are still here go to the Trash as one entry.
  const stampImport = (txs, source) => {
    const IR = window.MaerminImportRuns;
    if (!IR || !Array.isArray(txs) || !txs.length) return txs;
    const s = IR.stamp(txs, source);
    IR.save(IR.add(IR.load(), s.run));
    return s.transactions;
  };
  const importSourceLabel = (src) => ({
    paste: __('irSrcPaste', 'Pasted import'), manual: __('irSrcManual', 'Manual import'), broker: __('irSrcBroker', 'Broker import'),
    exchange: __('irSrcExchange', 'Exchange sync'), bank: __('irSrcBank', 'Bank sync'), aggregator: __('irSrcAggregator', 'Aggregator'),
    steam: __('irSrcSteam', 'Steam inventory')
  }[src] || src);
  const undoImport = (run) => {
    const IR = window.MaerminImportRuns;
    const rows = IR ? IR.rowsOf(transactions, run.id) : [];
    if (!rows.length) return;
    setTransactions(prev => prev.filter(x => x.importId !== run.id));
    if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import.undo', `${rows.length} row(s) of an import moved to the Trash`);
    const msg = __('irUndone', '{n} imported {n:row|rows} moved to the Trash', { n: rows.length });
    const TR = window.MaerminTrash;
    if (!TR) { addToast(msg, 'success'); return; }
    const label = __('irTrashLabel', '{source} of {date} · {n} {n:row|rows}', { source: importSourceLabel(run.source), date: window.MaerminI18n.date(run.at, 'dateTime'), n: rows.length });
    TR.toastUndo(msg, TR.put('transaction', label, rows));
  };

  // Restore handlers for the records held in React state (trash.js).
  useEffect(() => {
    const TR = window.MaerminTrash;
    if (!TR) return;
    const offTx = TR.register('transaction', (tx) => {
      setTransactions(prev => TR.restoreInto(prev, Array.isArray(tx) ? tx : [tx]).items); // a transfer pair is one entry
      return true;
    });
    const offPf = TR.register('portfolio', (pf) => {
      if (!portfolioHook || !pf || !pf.id) return false;
      portfolioHook.restorePortfolio(pf);
      // Rows moved to the Main Portfolio on delete go back.
      const back = (rows) => {
        let n = 0;
        const items = (rows || []).map((r) => {
          if (!r || r.movedFrom !== pf.id || r.portfolioId !== 'default') return r;
          n++;
          const next = Object.assign({}, r, { portfolioId: pf.id });
          delete next.movedFrom;
          if (next.source === 'dividend-auto-moved') next.source = 'dividend-auto';
          return next;
        });
        return { items: n ? items : rows, n };
      };
      setTransactions(prev => back(prev).items);
      try {
        const plans = JSON.parse(localStorage.getItem('maermin_savings_plans') || '[]');
        const r = back(plans);
        if (r.n) { localStorage.setItem('maermin_savings_plans', JSON.stringify(r.items)); TR.notify('maermin_savings_plans'); }
      } catch (e) { console.warn('[TRASH] moving savings plans back failed:', e); }
      return true;
    });
    return () => { offTx(); offPf(); };
  }, [portfolioHook && portfolioHook.restorePortfolio]);

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
        // CSV: the wizard's parsing and row checks (MaerminImportMapping), with
        // the dialog's per-row category column. It used to be split into
        // { headers, rows }, which no branch below understood ("Unknown format").
        const IM = window.MaerminImportMapping;
        if (!IM || !IM.quickCSV) throw new Error('Invalid format');
        const res = IM.quickCSV(importData, { currency });
        const firstErr = res.errors[0] ? __('importRowError', 'Row {row}: {reason}', res.errors[0]) : '';
        if (!res.transactions.length) {
          // Keep the dialog and the pasted text so the user can correct it.
          addToast(`${t.noTransactionsFound || 'No transactions found'}${firstErr ? ' - ' + firstErr : ''}`, 'error');
          return;
        }
        const stamp = Date.now();
        // Into the portfolio the user is working in, like "+ Add Transaction".
        const added = stampImport(res.transactions.map((tx, idx) => ({ ...tx, id: (stamp + idx).toString(), notes: tx.notes || '', portfolioId: writePortfolioId })), 'paste');
        setTransactions(prev => [...prev, ...added]);
        const skipped = res.errors.length ? ' - ' + __('importRowsSkipped', '{n} {n:row|rows} skipped ({first})', { n: res.errors.length, first: firstErr }) : '';
        addToast(`${added.length} ${t.transactionsImported || 'transactions imported'}${skipped}`, res.errors.length ? 'warning' : 'success', res.errors.length ? 8000 : undefined);
        (res.warnings || []).slice(0, 2).forEach(w => addToast(w, 'warning', 10000));
        setImportData('');
        setShowImportModal(false);
        return;
      }
      
      if (window.MaerminBackup && window.MaerminBackup.isFullBackup(imported)) {
        // Full backup (format: 'maermin-full'): the engine writes every saved
        // key back to localStorage, then we reload so the feature modules
        // (watchlist, alerts, journal, savings plans, net-worth, …) that read
        // localStorage directly re-hydrate from the restored store.
        // It REPLACES the current data, so ask first and say what changes.
        const doRestore = () => {
          const restored = window.MaerminBackup.restore(imported);
          if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `Full backup restored (${restored} data keys)`);
          addToast(t.importSuccess || 'Backup restored', 'success');
          setImportData('');
          setShowImportModal(false);
          setTimeout(() => window.location.reload(), 600);
        };
        askRestoreBackup(imported).then(yes => { if (yes) doRestore(); }); // cancelled: the dialog and the text stay
        return;
      } else if (Array.isArray(imported)) {
        // Array of transactions
        const newTransactions = imported.map((item, idx) => ({
          id: (Date.now() + idx).toString(),
          type: item.type || 'buy',
          category: item.category || 'crypto',
          symbol: item.symbol || item.asset || '',
          quantity: parseFloat(item.quantity || item.amount) || 0,
          price: parseFloat(item.price) || 0,
          fees: parseFloat(item.fees) || 0,
          date: item.date || window.MaerminUtils.todayISO(),
          notes: item.notes || '',
          currency: item.currency || currency,
          portfolioId: item.portfolioId || writePortfolioId
        }));
        const stampedNew = stampImport(newTransactions, 'paste');
        setTransactions(prev => [...prev, ...stampedNew]);
        addToast(`${newTransactions.length} ${t.transactionsImported || 'transactions imported'}`, 'success');
      } else if (imported.transactions) {
        // Backup format with transactions array
        const stampedRows = stampImport(imported.transactions, 'paste');
        setTransactions(prev => [...prev, ...stampedRows]);
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
              date: item.purchaseDate || window.MaerminUtils.todayISO(),
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
          const stampedOld = stampImport(newTransactions, 'paste');
          setTransactions(prev => [...prev, ...stampedOld]);
          
          // Restore priceHistory if present
          if (imported.priceHistory) {
            setPriceHistory(prev => ({ ...prev, ...imported.priceHistory }));
          }
          
          addToast(`${newTransactions.length} ${t.positionsImported || 'positions imported from backup'}`, 'success');
        } else {
          addToast(t.noDataToImport || 'No data to import', 'warning');
        }
      } else {
        // Keep the dialog and the text: nothing was imported.
        addToast(t.unknownFormat || 'Unknown format', 'error');
        return;
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
      case 'nav:performance':   setActiveView('performance'); break;
      case 'nav:rebalancing':   setActiveView('rebalancing'); break;
      case 'nav:analytics':     setActiveView('analytics'); break;
      case 'nav:taxes':         setActiveView('tax'); break;
      // Tools Navigation
      case 'nav:intelligence':  setActiveView('intelligence'); break;
      case 'nav:tags':          setActiveView('tags'); break;
      case 'nav:discovery':     setActiveView('discovery'); break;
      case 'nav:charts':        setActiveView('charts'); break;
      case 'nav:share':         setActiveView('share'); break;
      case 'nav:trash':         setActiveView('trash'); break;
      case 'nav:privacy':       setActiveView('privacy'); break;
      case 'nav:watchlist':     setActiveView('watchlist'); break;
      case 'nav:rules':         setActiveView('rules'); break;
      case 'nav:categories':    setActiveView('categories'); break;
      case 'nav:customize':     setActiveView('customize'); break;
      case 'nav:broker-import': setActiveView('broker-import'); break;
      // Aktionen
      case 'settings:mode-simple':   switchUiMode('simple'); break;
      case 'settings:mode-advanced': switchUiMode('advanced'); break;
      case 'action:add':        openTransactionModal(); break;
      case 'action:refresh':    fetchPrices(); break;
      case 'action:backup':     createBackup(); break;
      case 'action:import':     setShowImportModal(true); break;
      case 'action:privacy':    setPrivacyMode(p => !p); break;
      // Design
      case 'settings:dark':     setTheme('dark'); break;
      case 'settings:light':    setTheme('white'); break;
      case 'settings:purple':   setTheme('purple'); break;
      case 'settings:contrast': setTheme('contrast'); break;
      case 'settings:cb':       setTheme('cb'); break;
      // Help
      case 'help:shortcuts':    window.MaerminUI.openOverlay('shortcuts'); break;
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
    showImportModal || showApiSettings || showPasswordModal;

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
    // Phase 6 B-6: opens on Broker import (the common task first)
    const [section, setSection]       = React.useState(initialSection || 'broker'); // 'broker' | 'import' | 'export' | 'steam'
    // The view keeps its state now (StableViews): a deep link still switches the tab.
    React.useEffect(() => { if (initialSection) setSection(initialSection); }, [initialSection]);

    // source: text from a picked file; without it the pasted text is used.
    const handleImport = async (source) => {
      const raw = typeof source === 'string' ? source : importText;
      if (!raw.trim()) { addToast(__('pasteFirst', 'Paste JSON or CSV data first'), 'error'); return; }
      setImporting(true);
      try {
        let imported = [];
        const txt = raw.trim();
        if (txt.startsWith('[') || txt.startsWith('{')) {
          const parsed = JSON.parse(txt);
          // A full backup restores ALL data (watchlist, alerts, dividends,
          // journal, savings plans, net-worth, goals, settings, …) via the
          // engine and reloads — not just the transactions list.
          if (window.MaerminBackup && window.MaerminBackup.isFullBackup(parsed)) {
            // Ask first, like the quick Import dialog (cancel keeps the text).
            if (!(await askRestoreBackup(parsed))) return;
            const restored = window.MaerminBackup.restore(parsed);
            if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `Full backup restored (${restored} data keys)`);
            addToast(__('backupRestoredReload', 'Backup restored — reloading…'), 'success');
            setImportText('');
            setTimeout(() => window.location.reload(), 600);
            return;
          }
          imported = Array.isArray(parsed) ? parsed : (parsed.transactions || []);
        } else {
          // CSV: the same parsing and row checks as the quick Import dialog
          // (parseCSV returned { headers, rows }, so every CSV ended in
          // "No transactions found").
          const IM = window.MaerminImportMapping;
          if (!IM || !IM.quickCSV) throw new Error('CSV import not available');
          const res = IM.quickCSV(txt, { currency });
          const firstErr = res.errors[0] ? __('importRowError', 'Row {row}: {reason}', res.errors[0]) : '';
          if (!res.transactions.length) throw new Error((t.noTransactionsFound || 'No transactions found') + (firstErr ? ' - ' + firstErr : ''));
          imported = res.transactions.map(tx => ({ ...tx, notes: tx.notes || '', portfolioId: writePortfolioId }));
          if (res.errors.length) addToast(__('importRowsSkipped', '{n} {n:row|rows} skipped ({first})', { n: res.errors.length, first: firstErr }), 'warning', 8000);
          (res.warnings || []).slice(0, 2).forEach(w => addToast(w, 'warning', 10000));
        }
        if (!imported.length) throw new Error(t.noTransactionsFound || 'No transactions found');
        const newTxs = stampImport(imported.map((tx, i) => ({ id: (Date.now()+i).toString(), ...tx })), 'manual');
        setTransactions(prev => [...prev, ...newTxs]);
        setImportText('');
        addToast(__('txImportedN', '{n} {n:transaction|transactions} imported', { n: newTxs.length }), 'success');
      } catch(e) {
        addToast(__('importFailedMsg', 'Import failed: {msg}', { msg: e.message }), 'error');
      } finally { setImporting(false); }
    };

    // Open a file picker and hand the text of the chosen file to `done`.
    const pickTextFile = (accept, done) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept;
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => done(String(reader.result || ''));
        reader.readAsText(f);
      };
      input.click();
    };

    // R3.4: the view frame; the title is in the page header
    const UIC = window.MaerminComponents;
    return React.createElement('div', { className: 'ui-view' },
      React.createElement('p', { className: 'ui-view__lead' },
        __('dmIntro', 'Export, import, backup your data or use the Broker Import Wizard to import from supported brokers.')
      ),

      // Sections (R2.2, B-3): a segmented control, a select on phones
      React.createElement(window.MaerminComponents.SectionSwitch, {
        label: t.dataManagement || 'Data Management', value: section, onChange: setSection, className: 'ui-section-switch--flush', 'data-testid': 'dm-sections',
        options: [
          { value: 'broker', label: t.brokerImport || 'Broker Import' },
          { value: 'import', label: __('dmManualImport', 'Manual Import') },
          { value: 'export', label: __('dmExportBackup', 'Export & Backup') }
        ].concat(window.MaerminSteamImport ? [{ value: 'steam', label: __('stTab', 'Steam inventory') }] : [])
      }),

      // Steam inventory import (P2-7): CS2 items as purchases, editable preview.
      section === 'steam' && window.MaerminSteamImport && React.createElement(window.MaerminSteamImport.Panel, {
        theme, workerUrl: apiKeys.cs2Worker, transactions, exchangeRate, addToast,
        portfolioId: writePortfolioId,
        onImport: (txs) => {
          const rows = stampImport(txs, 'steam');
          setTransactions(prev => [...prev, ...rows]);
          if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `${txs.length} Steam item transaction(s) imported`);
        }
      }),

      // ── Export & Backup ──────────────────────────────────────────────────
      section === 'export' && React.createElement(UIC.Card, { title: __('dmExportBackup', 'Export & Backup'), subtitle: __('dmTxInDb', '{n} {n:transaction|transactions} in database.', { n: transactions.length }) },
        React.createElement('div', { className: 'ui-actions' },
          React.createElement(UIC.Button, { variant: 'primary', onClick: createBackup }, __('dmJsonBackup', '↓ JSON Backup'), ' ', React.createElement('span', { className: 'ui-btn__hint' }, __('dmFullRestore', '— full restore'))),
          React.createElement(UIC.Button, { onClick: exportData }, __('dmExportCsv', '↑ Export CSV'), ' ', React.createElement('span', { className: 'ui-btn__hint' }, __('dmSpreadsheet', '— spreadsheet'))),
          // Phase 3: restoring used to mean opening the file and pasting it
          // into Manual Import. Same confirm-and-restore path as pasting.
          React.createElement(UIC.Button, { 'data-testid': 'restore-from-file', disabled: importing,
            onClick: () => pickTextFile('.json,application/json', (txt) => handleImport(txt)) }, __('dmRestoreFile', '↺ Restore from file…'))
        ),
        React.createElement('p', { className: 'ui-note' },
          __('dmBackupHint', 'The JSON backup is not encrypted. For an encrypted copy use the account menu → Backup vault (encrypted).'))
      ),

      // ── Manual Import ────────────────────────────────────────────────────
      section === 'import' && React.createElement(UIC.Card, { title: __('dmManualImport', 'Manual Import'),
        subtitle: __('dmManualHint', 'Paste a JSON backup or CSV export. A full JSON backup restores all your data and reloads; a CSV/transaction list is added without replacing existing data.') },
        React.createElement('textarea', {
          value: importText,
          onChange: e => setImportText(e.target.value),
          'aria-label': __('dmManualImport', 'Manual Import'),
          placeholder: '[{"type":"buy","category":"crypto","symbol":"bitcoin","quantity":0.5,"price":45000,"date":"2024-01-15"}]',
          rows: 7, className: ['ui-input', 'ui-textarea'].join(' ')
        }),
        React.createElement('div', { className: 'ui-actions' },
          React.createElement(UIC.Button, { variant: 'primary', onClick: () => handleImport(), disabled: importing || !importText.trim() },
            importing ? __('importing', '◎ Importing...') : __('importBtn', '↑ Import')),
          React.createElement(UIC.Button, { onClick: () => pickTextFile('.json,.csv,application/json,text/csv', setImportText) }, __('dmChooseFile', 'Choose file…')),
          importText.trim() && React.createElement(UIC.Button, { variant: 'quiet', onClick: () => setImportText('') }, __('clearBtn', '✕ Clear'))
        )
      ),

      // ── Broker Import Wizard ─────────────────────────────────────────────
      section === 'broker' && (
        window.MaerminFeatures2
          ? React.createElement(window.MaerminFeatures2.BrokerImportWizard, {
              theme, t, addToast, workerUrl: apiKeys.cs2Worker, embedded: true,
              existing: transactions, // for duplicate detection in the mapping preview
              onImport: (txs) => {
                const newTxs = stampImport(txs.map((tx, i) => ({ id: (Date.now()+i).toString(), ...tx })), 'broker');
                setTransactions(prev => [...prev, ...newTxs]);
                if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `${newTxs.length} transaction(s) imported`);
                addToast(__('txImportedN', '{n} {n:transaction|transactions} imported', { n: newTxs.length }), 'success');
              }
            })
          : React.createElement('p', { className: ['ui-muted', 'is-error'].join(' ') },
              __('brokerModuleMissing', 'Broker Import module not loaded')
            )
      ),

      // Exchange read-only sync (WI-7): import crypto trades from Binance/Kraken/
      // Coinbase/Bitpanda. Keys are encrypted in the vault; sync is manual.
      section === 'broker' && window.MaerminExchangeSync && window.MaerminExchangeSync.Panel &&
        React.createElement(window.MaerminExchangeSync.Panel, {
          theme, t, workerUrl: apiKeys.cs2Worker, existing: transactions, portfolioId: writePortfolioId,
          onImport: (txs) => {
            const rows = stampImport(txs, 'exchange');
            setTransactions(prev => window.MaerminExchangeSync.appendNew(prev, rows));
            if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `${txs.length} exchange trade(s) imported`);
            addToast(__('exTradesImported', '{n} exchange {n:trade|trades} imported', { n: txs.length }), 'success');
          }
        }),

      // Crypto wallets by public address (P5-3.6): read-only balances through
      // the user's own Worker, compared with MAERMIN; nothing booked automatically.
      section === 'broker' && window.MaerminWallets && window.MaerminWallets.Panel &&
        React.createElement(window.MaerminWallets.Panel, { theme, workerUrl: apiKeys.cs2Worker, existing: transactions }),

      // Bank sync over FinTS (P5-3.4): balances, transactions and depot
      // statements through the user's own Worker; PIN and TAN never stored.
      section === 'broker' && window.MaerminBankSync && window.MaerminBankSync.Panel &&
        React.createElement(window.MaerminBankSync.Panel, {
          theme, workerUrl: apiKeys.cs2Worker, existing: transactions, portfolioId: writePortfolioId, addToast, formatAmount: (v, cur) => privacyMode ? '••••••' : window.MaerminI18n.num(v, 2, language) + ' ' + cur,
          onImport: (rows) => {
            const withIds = stampImport(rows.map((r) => ({ ...r, id: window.MaerminUtils.generateId(), portfolioId: writePortfolioId })), 'bank');
            setTransactions(prev => window.MaerminExchangeSync ? window.MaerminExchangeSync.appendNew(prev, withIds) : prev.concat(withIds));
            if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `${rows.length} bank booking(s) imported`);
            addToast(__('bsImported', '{n} bank {n:booking|bookings} imported', { n: rows.length }), 'success');
          }
        }),

      // Bring-your-own-key aggregators (P5-3.5): GoCardless Bank Account Data
      // and SnapTrade with the user's own keys (vault only), read-only.
      section === 'broker' && window.MaerminAggregators && window.MaerminAggregators.Panel &&
        React.createElement(window.MaerminAggregators.Panel, {
          theme, workerUrl: apiKeys.cs2Worker, existing: transactions, portfolioId: writePortfolioId, addToast,
          formatAmount: (v, cur) => privacyMode ? '••••••' : window.MaerminI18n.num(v, 2, language) + ' ' + cur,
          onImport: (rows) => {
            const withIds = stampImport(rows.map((r) => ({ ...r, id: window.MaerminUtils.generateId(), portfolioId: writePortfolioId })), 'aggregator');
            setTransactions(prev => window.MaerminExchangeSync ? window.MaerminExchangeSync.appendNew(prev, withIds) : prev.concat(withIds));
            if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `${rows.length} aggregator row(s) imported`);
            addToast(__('agImported', '{n} {n:row|rows} imported', { n: rows.length }), 'success');
          }
        }),

      // Recent imports with "Undo" (audit 2026-10-24 feature 3, import-runs.js).
      section !== 'export' && window.MaerminImportRuns && (() => {
        const IR = window.MaerminImportRuns;
        const runs = IR.list(IR.load(), transactions).filter(r => r.left > 0).slice(0, 10);
        if (!runs.length) return null;
        return React.createElement(UIC.Card, { title: __('irTitle', 'Recent imports'), subtitle: __('irHint', 'Undo moves the rows of that import that are still here to the Trash, where you can restore them for 30 days.'), 'data-testid': 'import-runs' },
          React.createElement('ul', { className: 'ui-import-runs' }, runs.map(r => React.createElement('li', { key: r.id, className: 'ui-import-runs__item', 'data-run': r.id },
            React.createElement('span', { className: 'ui-import-runs__what' },
              React.createElement('strong', null, importSourceLabel(r.source)), ' · ', window.MaerminI18n.date(r.at, 'dateTime')),
            React.createElement('span', { className: 'ui-muted num' }, r.left === r.count
              ? __('irRows', '{n} {n:row|rows}', { n: r.left })
              : __('irRowsLeft', '{n} of {total} rows left', { n: r.left, total: r.count })),
            React.createElement(UIC.Button, { size: 'sm', 'data-run-undo': r.id, onClick: () => undoImport(r) }, __('irUndo', 'Undo import'))))));
      })()
    );
  };

  // ========== RENDER VIEWS ==========
  
  // ── DIVIDENDS COMBINED VIEW (Calendar + Forecast + Auto-Fetch) ──────────────
  const DividendsCombinedView = ({ portfolio, prices, transactions, apiKeys, theme, t, addToast, formatPrice, getCurrencySymbol, divAutoBook, toggleDivAutoBook, onBookDividends }) => {
    const [tab, setTab] = React.useState('calendar');
    const [fetching, setFetching] = React.useState(false);
    const [divEvents, setDivEvents] = React.useState(() => {
      try { return JSON.parse(localStorage.getItem('maermin_divevents') || '[]'); } catch { return []; }
    });

    React.useEffect(() => { localStorage.setItem('maermin_divevents', JSON.stringify(divEvents)); }, [divEvents]);

    // Auto-fetch dividends for stock positions (Yahoo Finance via the Worker)
    const fetchDividends = async () => {
      const workerBase = (apiKeys?.cs2Worker || '').trim().replace(/\/$/, '');
      const hasWorker  = workerBase.length > 5;

      if (!hasWorker) {
        addToast(__('divNeedWorker', 'Add your Worker URL in Settings to auto-fetch dividends'), 'warning');
        return;
      }

      const isTicker = window.MaerminTickers?.isMarketSymbol || (() => true);
      const stockSymbols = [...new Set(
        transactions.filter(tx => tx.category === 'stocks').map(tx => (tx.symbol || '').toUpperCase()).filter(s => s && isTicker(s))
      )];
      if (!stockSymbols.length) { addToast(__('divNoStocks', 'No stock positions found'), 'info'); return; }

      setFetching(true);

      // Net shares held for a symbol right now (buys − sells).
      const sharesOf = (sym) => {
        let s = 0;
        transactions.filter(tx => (tx.symbol || '').toUpperCase() === sym).forEach(tx => {
          const qty = parseFloat(tx.quantity) || 0;
          if (tx.type === 'buy') s += qty; else if (tx.type === 'sell') s -= qty;
        });
        return Math.max(0, s);
      };

      // Collect EVERY individual payment (one calendar entry per payout) instead
      // of a single lump — so the user sees who pays when and how much.
      const generated = [];

      for (const sym of stockSymbols.slice(0, 20)) {
        let exDate = null, annualPerShare = 0, currency = 'USD', ppy = 4;
        // Query Yahoo under the normalised/renamed ticker (e.g. FB→META, BRK.B→
        // BRK-B) so renamed symbols resolve; keep `sym` for share-matching/labels.
        const qsym = (window.MaerminTickers && window.MaerminTickers.normalizeForDividends(sym)) || sym;

        // ── Primary: Yahoo Finance fundamentals via Worker ─────────────────
        // action=fundamentals (Yahoo quoteSummary) gives the annual dividendRate,
        // the last single payment (→ frequency) and the ex-date.
        const NLd = window.MaerminCloseHistory && window.MaerminCloseHistory.noListing;
        if (hasWorker && !(NLd && NLd.has(qsym))) {
          try {
            const url  = `${workerBase}?action=fundamentals&symbol=${encodeURIComponent(qsym)}`;
            const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (res.ok) {
              const data = await res.json();
              if (!data.error && data.dividendRate > 0) {
                annualPerShare = data.dividendRate;
                ppy = (data.lastDividendValue > 0)
                  ? Math.max(1, Math.min(12, Math.round(data.dividendRate / data.lastDividendValue))) : 4;
                exDate = data.exDividendDate || null;
                currency = data.currency || 'USD';
                dbg(`[DIV] Fundamentals ${sym}: ${annualPerShare}/yr, ppy: ${ppy}, ex: ${exDate}`);
              }
            }
          } catch(e) { console.warn('[DIV] fundamentals failed for', sym, e.message); }
        }

        if (!(annualPerShare > 0)) continue;
        const shares = sharesOf(sym);
        if (shares <= 0) continue;

        const monthsPerPay   = Math.max(1, Math.round(12 / ppy));
        const perPayPerShare = annualPerShare / ppy;
        const perPayAmount   = perPayPerShare * shares;

        // Anchor the FIRST upcoming pay date: roll the ex-date forward to the next
        // occurrence, then pay ~14 days after ex. Without an ex-date, start next month.
        // UTC date maths throughout: the dates are printed with toISOString
        // (audit 2026-10-24 BUG-12: local steps put summer dates a day early).
        let anchor;
        if (exDate) {
          anchor = new Date(exDate);
          if (isNaN(anchor.getTime())) { anchor = new Date(window.MaerminUtils.todayISO() + 'T00:00:00Z'); anchor.setUTCMonth(anchor.getUTCMonth() + 1); }
          else {
            while (anchor.getTime() < Date.now()) anchor.setUTCMonth(anchor.getUTCMonth() + monthsPerPay);
            anchor.setUTCDate(anchor.getUTCDate() + 14); // ex → pay
          }
        } else {
          anchor = new Date(window.MaerminUtils.todayISO() + 'T00:00:00Z'); anchor.setUTCMonth(anchor.getUTCMonth() + 1);
        }

        // One event per individual payment across the next 12 months.
        const horizon = new Date(); horizon.setUTCFullYear(horizon.getUTCFullYear() + 1);
        for (let pd = new Date(anchor); pd <= horizon; pd.setUTCMonth(pd.getUTCMonth() + monthsPerPay)) {
          const dateStr = pd.toISOString().split('T')[0];
          generated.push({
            id: `auto-${sym}-${dateStr}`,
            symbol: sym, date: dateStr,
            amount: parseFloat(perPayAmount.toFixed(4)),
            currency,
            notes: `Auto: ${perPayPerShare.toFixed(4)}/share × ${shares.toFixed(2)} sh · ${ppy}×/yr`
          });
        }
      }

      // Dedupe the generated schedule by id, then REPLACE all prior auto entries
      // with this fresh schedule (keeping every manual entry). One state write.
      const seen = {};
      const freshSchedule = generated.filter(e => !seen[e.id] && (seen[e.id] = true));
      const withSchedule = (prev) => [...prev.filter(e => !String(e.id).startsWith('auto-')), ...freshSchedule];
      // The fetch can outlast this view (up to 20 × 8 s): a state update after
      // the user left is dropped, so save the result directly as well
      // (audit 2026-10-24 BUG-11). The view reads the key when it mounts again.
      try {
        const stored = JSON.parse(localStorage.getItem('maermin_divevents') || '[]');
        localStorage.setItem('maermin_divevents', JSON.stringify(withSchedule(Array.isArray(stored) ? stored : [])));
      } catch (e) { /* storage unavailable: the state update below still applies while mounted */ }
      setDivEvents(withSchedule);

      setFetching(false);
      addToast(freshSchedule.length > 0
        ? __('divScheduledN', '{n} dividend {n:payment|payments} scheduled across the next 12 months', { n: freshSchedule.length })
        : __('divNoneFound', 'No dividend payments found for your holdings'), 'info');
    };

    const tabs = [
      { id: 'calendar', label: __('divTabCalendar', 'Calendar') },
      { id: 'forecast', label: __('divTabForecast', 'Forecast') },
      { id: 'history', label: __('divTabHistory', 'History') },
    ];

    // R3.5: the year as the answer first - expected income for the next 12
    // months and what arrived this year and last year (same basis as the switch).
    const UIC = window.MaerminComponents;
    const M = window.MaerminMetrics, DH = window.MaerminDividendHistory, FXH = window.MaerminFxHistory;
    const expDiv = M ? M.computeExpectedAnnualDividends(portfolio, prices, { exchangeRate }) : null;
    const toEURtx = (amt, tx) => (FXH && FXH.txToEUR) ? FXH.txToEUR(amt, tx.currency || 'EUR', tx.date, exchangeRate, fxAt).value
      : (window.MaerminUtils ? window.MaerminUtils.toEUR(amt, tx.currency || 'EUR', exchangeRate) : amt);
    const divMx = DH ? DH.matrix(transactions, { toEUR: toEURtx, basis: grossNet }) : null;
    const yNow = new Date().getFullYear();
    const divMoney = (v) => `${formatPrice(v)} ${getCurrencySymbol()}`;
    const basisText = grossNet === 'gross' ? __('divBasisGross', 'before withholding tax') : __('divBasisNet', 'after withholding tax');
    const divTile = (label, value, sub, tone, testid) => React.createElement(UIC.Card, { variant: 'answer', className: 'ui-ov-tile', 'data-testid': testid },
      React.createElement(UIC.Stat, { label, value: React.createElement('span', { className: 'mx-kpi-value' }, value), sub, tone }));

    return React.createElement('div', { className: 'ui-view' },
      React.createElement('div', { className: 'ui-ov-tiles', 'data-testid': 'div-answer' },
        divTile(__('ovDivExpected12m', 'Expected dividends (12m)'), expDiv && expDiv.available ? divMoney(expDiv.totalAnnual) : '—',
          expDiv && expDiv.available ? __('perMonthYield', '{amount}/mo · {yield}', { amount: divMoney(expDiv.monthly), yield: window.MaerminI18n.pct(expDiv.yield, 1) }) : (t.kpiDividendsNone || '—'),
          expDiv && expDiv.available ? 'income' : null, 'div-expected'),
        divTile(__('divReceivedIn', 'Received in {y}', { y: yNow }), divMx ? divMoney(divMx.totals[yNow] || 0) : '—', basisText, null, 'div-this-year'),
        divTile(__('divReceivedIn', 'Received in {y}', { y: yNow - 1 }), divMx ? divMoney(divMx.totals[yNow - 1] || 0) : '—', basisText, null, 'div-last-year')
      ),
      // Sections, basis and the booking actions
      React.createElement('div', { className: 'ui-div-tools' },
        React.createElement(window.MaerminComponents.SectionSwitch, { label: t.navDividends || 'Dividends', value: tab, onChange: setTab, 'data-testid': 'div-sections', options: tabs.map(tb => ({ value: tb.id, label: tb.label })) }),
        // P5-2.5: amounts before or after withholding tax (the same choice as Analysis → Returns)
        tab !== 'calendar' && window.MaerminFeatures2 && window.MaerminFeatures2.GrossNetSwitch
          ? React.createElement(window.MaerminFeatures2.GrossNetSwitch, { value: grossNet, onChange: setGrossNet, theme, testid: 'div-gross-net' }) : null,
        React.createElement('span', { className: 'ui-div-tools__spacer', 'aria-hidden': 'true' }),
        React.createElement(UIC.Button, { onClick: fetchDividends, disabled: fetching }, fetching ? __('fetching', 'Fetching...') : __('divAutoFetch', '↓ Auto-fetch dividends')),
        // v10.x: book received dividends as transactions (in the payout currency)
        onBookDividends ? React.createElement(UIC.Button, { onClick: () => onBookDividends(), title: t.divBookHint || 'Create a transaction for each dividend whose pay date has passed (estimated, in its payout currency)' }, t.divBookNow || '＋ Book received dividends') : null,
        toggleDivAutoBook ? React.createElement('label', { title: t.divAutoHint || 'Automatically book each dividend as a transaction (in its payout currency) once its pay date passes', className: 'ui-check' },
          React.createElement('input', { type: 'checkbox', checked: !!divAutoBook, onChange: () => toggleDivAutoBook() }),
          (t.divAutoLabel || 'Auto-book')) : null
      ),
      // Content
      React.createElement('div', { className: 'ui-div-body' },
        tab === 'calendar' && window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.DividendCalendarView, {
            portfolio, prices, metaVersion, theme, t, addToast, events: divEvents, setEvents: setDivEvents, privacyMode, exchangeRate
          }) : null,
        tab === 'forecast' && window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.DividendForecastView, {
            transactions, portfolio, prices, metaVersion, theme, formatPrice, getCurrencySymbol, exchangeRate, fxAt, basis: grossNet
          }) : null,
        tab === 'history' && window.MaerminDividendHistory ?
          React.createElement(window.MaerminDividendHistory.View, {
            transactions, portfolio, exchangeRate, fxAt, basis: grossNet, workerUrl: viewWorkerUrl, theme, formatPrice, getCurrencySymbol
          }) : null,
        // Dividend quality & safety fold-in (no new tab): per-payer safety
        // score, payout/streak/growth/coverage columns with a click-to-open
        // reasoning detail, and the aggregated portfolio dividend health.
        // Gated on the Worker fundamentals route; degrades to history-only.
        window.MaerminDividendQuality && window.MaerminDividendQuality.QualityPanel ?
          React.createElement(window.MaerminDividendQuality.QualityPanel, {
            portfolio, prices, workerUrl: apiKeys?.cs2Worker, exchangeRate,
            theme, t, formatPrice, getCurrencySymbol
          }) : null
      )
    );
  };

  // ── TAX COMBINED VIEW (FIFO + Tax Report) ───────────────────────────────────
  const TaxCombinedView = ({ transactions, prices, theme, t, formatPrice, getCurrencySymbol, taxJurisdiction, setTaxJurisdiction, language }) => {
    const tabState = taxTab, setTab = setTaxTab;
    // Under German tax law the Tax Report tab already carries the DE-aware
    // tax advisor (loss harvesting with separate stock/other loss pots), so the
    // generic harvest tab is only offered for other jurisdictions.
    const showHarvest = taxJurisdiction !== 'de';
    const tab = (tabState === 'harvest' && !showHarvest) ? 'report' : tabState;

    // Tax-loss harvesting (V7) — reuses MaerminMetrics; portfolio + exchangeRate
    // come from the InvestmentTracker closure.
    const renderHarvest = () => {
      const M = window.MaerminMetrics;
      // Rate per lot and jurisdiction (FINDINGS L-2), not one flat German rate.
      const TSm = window.MaerminTaxSettings;
      const h = M ? M.computeTaxLossHarvest(portfolio, prices, transactions, {
        jurisdiction: taxJurisdiction, exchangeRate, fxAt, settings: TSm && TSm.load ? TSm.load() : undefined
      }) : { available: false, rows: [] };
      const sym = getCurrencySymbol();
      // R4.6: the view layout, answer tiles, holdings on the shared rows; a loss carries its sign and ▼
      const UICh = window.MaerminComponents;
      const neg = (v) => '−' + formatPrice(Math.abs(v)) + ' ' + sym;
      const sumCard = (label, value, tone) => React.createElement(UICh.Card, { variant: 'answer', className: 'ui-ov-tile' },
        React.createElement(UICh.Stat, { label, value, tone }));
      return React.createElement('div', { className: ['ui-view', 'ui-view--cont', 'ui-harvest'].join(' ') },
        React.createElement('p', { className: 'ui-view__lead' }, taxJurisdiction === 'us'
          ? (t.taxHarvestSubtitleUs || 'Positions at an unrealised loss you could realise to offset gains. Estimated at 24 % for lots held up to a year and 15 % for longer - not tax advice.')
          : taxJurisdiction === 'ch'
            ? __('taxHarvestSubtitleCh', 'Positions at an unrealised loss. In Switzerland private capital gains are tax-free and losses are not deductible, so selling saves no tax.')
          : taxJurisdiction === 'at'
            ? __('taxHarvestSubtitleAt', 'Positions at an unrealised loss you could realise to offset this year\'s gains (Austria: losses offset only within the same year). Estimated at 27.5 % - not tax advice.')
            : (t.taxHarvestSubtitle || 'Positions at an unrealised loss you could realise to offset gains. Estimated at the German flat rate — not tax advice.')),
        !h.available
          ? React.createElement(UICh.EmptyState, { title: t.taxHarvestTitle || 'Tax-loss harvesting', text: t.taxHarvestNone || 'No positions are currently at an unrealised loss.' })
          : React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'ui-ov-tiles' },
                sumCard(t.taxHarvestTotalLoss || 'Harvestable loss', '▼ ' + neg(h.totalLoss), 'loss'),
                sumCard(t.taxHarvestTotalSavings || 'Est. tax savings', `${formatPrice(h.totalSavings)} ${sym}`, null)),
              React.createElement(UICh.Card, { headingLevel: 'h3', title: t.taxHarvestTitle || 'Tax-loss harvesting' },
                React.createElement('ul', { className: 'ui-rows' }, h.rows.map((r, i) =>
                  React.createElement('li', { key: i, className: 'ui-rows__row' },
                    React.createElement('div', { className: 'ui-df-src' },
                      React.createElement('b', null, r.symbol),
                      r.washSale && React.createElement(UICh.Badge, { tone: 'warning' }, t.taxHarvestWashSale || 'wash-sale risk')),
                    React.createElement('div', { className: 'ui-rows__side' },
                      React.createElement('b', { className: 'tone-loss' }, '▼ ' + neg(r.unrealizedLoss)),
                      !r.washSale && React.createElement('span', null, `${t.taxHarvestSaves || 'saves'} ~${formatPrice(r.taxSavings)} ${sym}`))))))));
    };

    // Phase 6 B-7: the answer first - estimated tax for the selected year, the
    // allowance used and left, the loss pots carried forward, the next deadline.
    // The same report object as the Report tab (getTaxReport).
    const UIC = window.MaerminComponents, I = window.MaerminI18n;
    const tr = (() => { try { return getTaxReport(taxYear); } catch (e) { return null; } })();
    const k = tr && window.MaerminTaxReport && window.MaerminTaxReport.kpis ? window.MaerminTaxReport.kpis(tr) : null;
    const g = tr && tr.summary ? tr.summary.germanDetail : null;
    const taxMoney = (v) => `${formatPrice(v || 0)} ${getCurrencySymbol()}`;
    const DEADLINE = { de: '-07-31', at: '-06-30', us: '-04-15' };
    const deadline = DEADLINE[taxJurisdiction] ? (taxYear + 1) + DEADLINE[taxJurisdiction] : null;
    const tTile = (label, value, sub, tone, testid) => React.createElement(UIC.Card, { variant: 'answer', className: 'ui-ov-tile', 'data-testid': testid },
      React.createElement(UIC.Stat, { label, value: React.createElement('span', { className: 'mx-kpi-value' }, value), sub, tone }));
    const summary = React.createElement('section', { className: 'ui-tax-summary', 'data-testid': 'tax-summary', 'aria-label': __('taxSummaryTitle', 'Tax {y} at a glance', { y: taxYear }) },
      React.createElement('h2', { className: 'ui-ov-block__title' }, __('taxSummaryTitle', 'Tax {y} at a glance', { y: taxYear })),
      React.createElement('div', { className: 'ui-ov-tiles' },
        tTile(__('taxSumDue', 'Estimated tax'), k ? taxMoney(k.taxLiability) : '—',
          taxJurisdiction === 'ch' ? __('taxSumDueCh', 'Cantonal - not estimated here') : __('taxSumDueSub', 'on realised gains and income in {y}', { y: taxYear }), null, 'tax-sum-due'),
        g && g.sparerpauschbetrag > 0 && tTile(__('taxSumAllowance', 'Allowance used'), taxMoney(g.sparerpauschbetragUsed),
          __('taxSumAllowanceLeft', '{left} of {total} left', { left: taxMoney(Math.max(0, g.sparerpauschbetrag - (g.sparerpauschbetragUsed || 0))), total: taxMoney(g.sparerpauschbetrag) }), null, 'tax-sum-allowance'),
        g && g.carryOut && tTile(__('taxSumPots', 'Loss pots carried forward'), taxMoney((g.carryOut.shares || 0) + (g.carryOut.other || 0)),
          __('taxSumPotsSub', 'Shares {shares} · other {other}', { shares: taxMoney(g.carryOut.shares || 0), other: taxMoney(g.carryOut.other || 0) }), null, 'tax-sum-pots'),
        !g && k && tTile(__('realizedGains', 'Realised gains'), taxMoney(k.realizedGains), __('taxSumRealizedSub', 'net, FIFO, {y}', { y: taxYear }), k.realizedGains > 0 ? 'gain' : k.realizedGains < 0 ? 'loss' : null, 'tax-sum-realized'),
        tTile(__('taxSumDeadline', 'Next deadline'), deadline ? I.date(deadline) : '—',
          deadline ? __('taxSumDeadlineSub', 'Tax return for {y} (without an adviser)', { y: taxYear }) : __('taxSumDeadlineCh', 'Set by your canton'), null, 'tax-sum-deadline')
      )
    );

    return React.createElement('div', { className: 'ui-tax' },
      summary,
      React.createElement('div', { className: 'ui-tax__tools' },
        React.createElement(window.MaerminComponents.SectionSwitch, {
          label: t.navTaxFifo || 'Tax & FIFO', value: tab, onChange: setTab, 'data-testid': 'tax-sections',
          options: [
            { value: 'fifo', label: t.taxTabFifo || 'FIFO cost basis' },
            { value: 'report', label: t.taxTabReport || 'Tax Report' },
            { value: 'realized', label: t.taxTabRealized || 'Realised vs unrealised' }
          ].concat(showHarvest ? [{ value: 'harvest', label: t.taxTabHarvest || 'Tax-loss harvesting' }] : [])
        })
      ),
      window.MaerminTrust && React.createElement(window.MaerminTrust.Disclaimer, { theme, kind: 'tax', className: 'ui-tax__note' }),
      React.createElement('div', { className: 'ui-tax__body' },
        tab === 'fifo' && window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.FIFOView, { transactions, prices, exchangeRate, fxAt, theme, formatPrice, getCurrencySymbol }) : null,
        tab === 'report' ? renderTaxView() : null,
        tab === 'realized' && window.MaerminFeatures7 ?
          React.createElement(window.MaerminFeatures7.RealizedUnrealizedView, { transactions, portfolio, prices, theme, formatPrice, getCurrencySymbol, exchangeRate, fxAt }) : null,
        tab === 'harvest' ? renderHarvest() : null
      )
    );
  };

  const renderView = () => {
    // R1.2: the hidden component gallery (?gallery, also with ?demo). Not a view in nav-model.js.
    if (window.MaerminGallery && window.MaerminGallery.isOn(window.location.search)) {
      return React.createElement(window.MaerminGallery.View, { themeName: theme, setTheme });
    }
    switch (activeView) {
      // P5: the one sanctioned new surface — read-only asset discovery. Gated on
      // a Worker URL; the View itself degrades gracefully if the deployed Worker
      // predates the screener endpoint. Prices convert to EUR at ingestion.
      // Feature 1 (v10): Portfolio Intelligence — automatic, ranked detection of
      // structural problems (hidden concentration, style drift, dividend/yield
      // traps, currency/country/sector/liquidity risk, correlation clusters). It
      // reuses MaerminLookThrough's already-fetched result (lookThroughResult,
      // kept from the Health view) for effective exposures and degrades to the
      // direct-concentration fallback when fund data has not been loaded yet.
      case 'intelligence':
        return window.MaerminIntelligence ?
          React.createElement(React.Fragment, null,
            React.createElement(window.MaerminIntelligence.View, {
              // R4.2: the disclaimer sits inside the view frame, under the lead
              disclaimer: window.MaerminTrust && React.createElement(window.MaerminTrust.Disclaimer, { theme: currentTheme, kind: 'invest' }),
              portfolio, prices, transactions: activeTransactions,
              lookThrough: lookThroughResult, theme: currentTheme, t,
              // P5-2.8: emergency fund (Net Worth accounts, FIRE expenses) and buying power
              accounts: window.MaerminMetrics ? window.MaerminMetrics.loadAccounts() : [],
              fire: window.MaerminMetrics ? window.MaerminMetrics.loadFireSettings() : null,
              portfolios: pfAllocation, exchangeRate
            })) : renderAnalyticsPlaceholder(t.intelTitle || 'Portfolio Intelligence');

      // v10.x: snapshot-powered performance cards (1D…Max), derived 100% from the
      // on-device value history — no API. Defaults to the combined 'all' series.
      case 'performance':
        return window.MaerminPerformance ? React.createElement(React.Fragment, null,
          React.createElement(window.MaerminPerformance.View, {
            theme: currentTheme, t, formatPrice, getCurrencySymbol, workerUrl: viewWorkerUrl, demo: demoMode,
            series: demoPeriodSeries || undefined, transactions, exchangeRate, fxAt,
            // Performance Map (WI-4): area = weight, colour = performance (R4.1: the holdings map, inside the view)
            map: window.MaerminPerformanceMap && React.createElement(window.MaerminPerformanceMap.Panel, {
              theme: currentTheme, t, positions: portfolio, prices, exchangeRate,
              privacyMode, formatPrice, getCurrencySymbol
            })
          }),
          // Audit 2026-10-24 feature 8: one calendar year from the Returns figures (year-review.js).
          window.MaerminYearReview && window.MaerminReturnFigures && React.createElement(window.MaerminYearReview.Panel, {
            transactions, formatPrice, getCurrencySymbol, privacyMode,
            figures: (txs, asOf) => window.MaerminReturnFigures.compute(txs, { securitiesValueEUR: 0, exchangeRate, fxAt, today: asOf }),
            snapshots: window.MaerminSnapshots, snapshotState: window.MaerminSnapshots ? window.MaerminSnapshots.load() : null
          })) : renderAnalyticsPlaceholder(t.navPerformance || 'Performance');

      // v10.x: Customize Overview — show/hide/reorder the main Overview sections
      // (MaerminDashboard). renderOverview reads visibleSet() each render.
      case 'customize':
        return window.MaerminDashboard ?
          React.createElement(window.MaerminDashboard.View, {
            theme: currentTheme, t
          }) : renderAnalyticsPlaceholder(t.navCustomize || 'Customize Overview');

      // v10.x: Custom asset categories — define/manage categories beyond the four
      // built-ins. Positions in custom categories are priced & totalled (metrics.js
      // is category-aware); the picker in Add-Transaction lists them.
      case 'categories':
        return window.MaerminCategories ?
          React.createElement(window.MaerminCategories.View, {
            theme: currentTheme, t
          }) : renderAnalyticsPlaceholder(t.navCategories || 'Categories');

      // v10.x: Smart Tags — cross-cutting labels + per-tag value/weight and
      // optional tag-basis target weights (persisted, in backup).
      case 'tags':
        return window.MaerminTags ?
          React.createElement(window.MaerminTags.View, {
            transactions: activeTransactions, prices,
            theme: currentTheme, t, formatPrice, getCurrencySymbol
          }) : renderAnalyticsPlaceholder(t.navTags || 'Tags');

      // v10.x: Automation Rules — local "warn me when…" rules on concentration,
      // allocation and drawdown. We assemble the eval context here from the same
      // live inputs the rest of the app uses (positions, tag values, snapshot peak).
      case 'rules': {
        if (!window.MaerminRules) return renderAnalyticsPlaceholder(t.navRules || 'Alerts & Rules');
        // Reuse the one shared price-lookup (MaerminTags.pricedPositions) instead
        // of a parallel inline loop.
        const rPositions = window.MaerminTags ? window.MaerminTags.pricedPositions(activeTransactions, prices) : [];
        const rTagsState = window.MaerminTags ? window.MaerminTags.load() : null;
        const rByTag = {};
        let rTagNames = [];
        if (window.MaerminTags && rTagsState) {
          const agg = window.MaerminTags.aggregate(rTagsState, rPositions.map(p => ({ symbol: p.symbol, valueEUR: p.valueEUR })));
          agg.rows.forEach(row => { rByTag[row.name] = row.value; });
          rTagNames = window.MaerminTags.listTags(rTagsState).map(tg => tg.name);
        }
        let rDrop = 0;
        if (window.MaerminSnapshots) {
          const ser = window.MaerminSnapshots.seriesFor(window.MaerminSnapshots.load(), 'all');
          if (ser.length) {
            let peak = 0; ser.forEach(p => { if (p.v > peak) peak = p.v; });
            const latest = ser[ser.length - 1].v;
            rDrop = peak > 0 ? ((peak - latest) / peak) * 100 : 0;
          }
        }
        const rSymbols = rPositions.map(p => p.symbol).sort();
        const rCategories = Array.from(new Set(rPositions.map(p => p.category))).sort();
        // R5.1: rules and the risk monitor share one view layout
        return React.createElement('div', { className: 'ui-view' },
          React.createElement(window.MaerminRules.View, {
            positions: rPositions, byTag: rByTag, dropFromPeakPct: rDrop,
            symbols: rSymbols, categories: rCategories, tags: rTagNames,
            prices, theme: currentTheme, t, formatPrice
          }),
          // Risk & drift monitor: preset structural rules with configurable
          // thresholds + local-notification toggle. Its continuous evaluation
          // runs on every price refresh; this is only the settings/status panel.
          window.MaerminRiskMonitor && window.MaerminRiskMonitor.Panel &&
            React.createElement(window.MaerminRiskMonitor.Panel, {
              portfolio, prices, priceHistory, lookThrough: lookThroughResult,
              theme: currentTheme, t
            })
        );
      }

      case 'discovery':
        return window.MaerminDiscovery ?
          React.createElement(window.MaerminDiscovery.View, {
            workerUrl: viewWorkerUrl, usdToEur: exchangeRate,
            theme: currentTheme, t, formatPrice, getCurrencySymbol
          }) : renderAnalyticsPlaceholder(t.navDiscovery || 'Discovery');

      // Sanctioned new surface (round 2): privacy-preserving share snapshots
      // + anonymous benchmarking. Redaction enforced client- AND server-side;
      // opt-in per click; degrades with an upgrade note on older Workers.
      case 'share':
        return window.MaerminShare ?
          React.createElement(window.MaerminShare.View, {
            portfolio, prices, transactions: activeTransactions, priceHistory,
            workerUrl: apiKeys.cs2Worker, theme: currentTheme, t
          }) : renderAnalyticsPlaceholder(t.navShare || 'Share & Compare');

      // P5-5.4: research page per security
      case 'research':
        return window.MaerminResearch ?
          React.createElement(window.MaerminResearch.View, {
            theme: currentTheme, transactions, symbol: researchSymbol, onSymbol: setResearchSymbol, workerUrl: viewWorkerUrl, demo: demoMode, // audit U-1: sample research in demo mode
            exchangeRate, fxAt, privacy: privacyMode,
            onCharts: window.MaerminCharts ? openCharts : null, // CH-3a
            positions: window.MaerminTags ? window.MaerminTags.pricedPositions(transactions, prices) : [],
            symbols: (() => {
              const s = new Set(transactions.filter((tx) => tx.symbol && (tx.category === 'stocks' || tx.category === 'bonds')).map((tx) => String(tx.symbol).toUpperCase()));
              try { (JSON.parse(localStorage.getItem('maermin_watchlist') || '[]') || []).forEach((w) => { if (w && w.symbol) s.add(String(w.symbol).toUpperCase()); }); } catch (e) {}
              return Array.from(s).sort();
            })()
          }) : renderAnalyticsPlaceholder(__('navResearch', 'Research'));

      // P5-5.5: one dated event feed for held and watched symbols, with ICS export
      case 'events':
        return window.MaerminEventFeed ?
          React.createElement(window.MaerminEventFeed.View, (() => {
            const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || d); } catch (e) { return JSON.parse(d); } };
            const CA = window.MaerminCorporateActions;
            return {
              theme: currentTheme, workerUrl: marketWorker, privacy: privacyMode,
              held: ((portfolio && portfolio.stocks) || []).filter((s) => (parseFloat(s.amount) || 0) > 0).map((s) => s.symbol).filter(Boolean),
              watched: (read('maermin_watchlist', '[]') || []).map((w) => w && w.symbol).filter(Boolean),
              input: Object.assign({}, pushCtx().input, { jurisdiction: taxJurisdiction }),
              plans: read('maermin_savings_plans', '[]') || [],
              splits: CA && CA.load ? (CA.load().actions || []) : []
            };
          })()) : renderAnalyticsPlaceholder(__('navEvents', 'Events'));

      // P5-5.3: budget and spending (a separate ledger of bank bookings)
      case 'budget':
        return window.MaerminBudget ?
          React.createElement(window.MaerminBudget.View, { theme: currentTheme, privacy: privacyMode, addToast })
          : renderAnalyticsPlaceholder(__('navBudget', 'Budget'));

      case 'net-worth':
        return window.MaerminFeatures5 ?
          React.createElement(window.MaerminFeatures5.NetWorthView, {
            // Net worth is everything you own: every portfolio once (never the
            // active one alone, never "All portfolios" plus its portfolios).
            portfolioStats: allPortfoliosStats, portfolio: allPortfoliosPortfolio, prices, theme: currentTheme, formatPrice, getCurrencySymbol, t, usdToEur: exchangeRate,
            cashEUR: cashOf('all') || 0
          }) : renderAnalyticsPlaceholder(t.navNetWorth || 'Net Worth');

      case 'cashflow':
        return window.MaerminFeatures5 ?
          // R4.5: the view frame; the page header has the title
          React.createElement('div', { className: 'ui-view', 'data-testid': 'cashflow-view' },
            React.createElement(window.MaerminFeatures5.CashflowChart, {
              transactions: activeTransactions, priceHistory, portfolio, prices,
              theme: currentTheme, formatPrice, getCurrencySymbol, valuePath, exchangeRate, fxAt
            }),
            // P5-2.7: money bought per month and the saving streaks
            window.MaerminInvestTimeline && React.createElement(window.MaerminInvestTimeline.Panel, {
              transactions: activeTransactions, exchangeRate, fxAt, theme: currentTheme, formatPrice, getCurrencySymbol
            })
          ) : renderAnalyticsPlaceholder(t.navCashflow || 'Cash Flow');

      case 'fees':
        return window.MaerminFeatures5 ?
          React.createElement(window.MaerminFeatures5.FeeAnalyzer, {
            transactions: activeTransactions, theme: currentTheme, formatPrice, getCurrencySymbol, exchangeRate, fxAt,
            // Ongoing costs (TER) fold-in: the recurring half of the cost of
            // investing, complementing the transaction fees above (no new tab).
            // Reuses the X-Ray fund-data plumbing; gated + degrading like it. R4.3: inside the view frame.
            extra: window.MaerminCostAnalysis && window.MaerminCostAnalysis.OngoingCostsPanel &&
              React.createElement(window.MaerminCostAnalysis.OngoingCostsPanel, {
                portfolio, prices, workerUrl: marketWorker,
                theme: currentTheme, t, formatPrice, getCurrencySymbol
              })
          }) : renderAnalyticsPlaceholder(t.navFees || 'Fee Analyser');

      case 'portfolios':
        return window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.PortfolioManagerView, {
            portfolios, activePortfolioId, transactions, prices, exchangeRate, fxAt, corpActionsRev,
            theme: currentTheme, t, formatPrice, getCurrencySymbol,
            setActivePortfolioId,
            addPortfolio: portfolioHook?.addPortfolio,
            removePortfolio: removePortfolioMovingRows,
            renamePortfolio: portfolioHook?.renamePortfolio,
            setClearing: portfolioHook?.setClearing, clearing: clearingByPf,
            setSeparateDepot: portfolioHook?.setSeparateDepot
          }) : renderAnalyticsPlaceholder(t.navPortfolios || 'Portfolios');

      case 'savings-plans':
        return window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.SavingsPlanView, {
            transactions: activeTransactions, theme: currentTheme, formatPrice, getCurrencySymbol, t,
            portfolios, activePortfolioId: writePortfolioId,
            // Feed the projection (#6): current investment value + forward dividend yield.
            // NB: use the component-scoped portfolioStats (stats is only defined in
            // the overview block, not here — referencing it crashed the page).
            startValue: portfolioStats.totalValue,
            dividendYield: (window.MaerminMetrics
              ? (window.MaerminMetrics.computeExpectedAnnualDividends(portfolio, prices, { exchangeRate }).yield || 0) / 100
              : 0)
          }) : renderAnalyticsPlaceholder(t.navSavingsPlans || 'Savings Plans');

      case 'returns':
        return window.MaerminFeatures2 ? React.createElement(window.MaerminFeatures2.ReturnsView, {
            transactions: activeTransactions, portfolio, prices, priceHistory, fxAt, exchangeRate,
            valuePath: returnsPath, historyPending: closePending, portfolioId: activePortfolioId, hasWorker: (marketWorker || '').trim().length > 5,
            clearings: returnsClearings, buildPath: (txs, clr) => buildValuePath(txs, clr, { gross: grossNet === 'gross' }),
            grossNet, setGrossNet,
            workerUrl: viewWorkerUrl, hicpGeo, setHicpGeo, // P5-2.9 real returns
            theme: currentTheme, formatPrice, getCurrencySymbol, t,
          // R4.1: the panels sit in the view's own frame, below the heatmap
          // Benchmark overlay (α/β/TE/IR/R²) — folds the analytics engine into Returns.
          panels: window.MaerminAnalyticsViews && React.createElement(React.Fragment, null,
            // P5-2.6: IRR per holding / class / tag, best and worst sales, capital flow
            window.MaerminHoldingReturns && React.createElement(window.MaerminHoldingReturns.Panel, {
              transactions: activeTransactions, portfolio, prices, exchangeRate, fxAt, basis: grossNet,
              theme: currentTheme, formatPrice, getCurrencySymbol
            }),
            // P5-2.1: profit by source over the same daily closes as the value path
            window.MaerminValueAttribution && React.createElement(window.MaerminValueAttribution.Panel, {
              transactions: activeTransactions, series: closeSeriesEUR, live: pathInputs.live, splits: pathInputs.splits,
              clearings: returnsClearings, exchangeRate, fxAt, theme: currentTheme, formatPrice
            }),
            // P5-2.2: the same money in and out replayed into an index or a held fund
            window.MaerminBenchmarkReplay && React.createElement(window.MaerminBenchmarkReplay.Panel, {
              transactions: activeTransactions, series: closeSeriesEUR, live: pathInputs.live, splits: pathInputs.splits,
              clearings: returnsClearings, exchangeRate, fxAt, workerUrl: viewWorkerUrl, funds: heldFunds, theme: currentTheme
            }),
            React.createElement(window.MaerminAnalyticsViews.BenchmarkPanel, {
              portfolio, priceHistory, valueSeries: dailyAnalytics.index, workerUrl: viewWorkerUrl, theme: currentTheme, t, formatPrice
            }),
            // FX attribution: split the EUR return into asset vs exchange-rate
            // parts (no new tab; the EUR/USD path comes via the existing yf route).
            window.MaerminFxAttribution && React.createElement(window.MaerminFxAttribution.Panel, {
              portfolio, prices, priceHistory: { ...priceHistory, ...dailyAnalytics.perHolding }, transactions: activeTransactions,
              workerUrl: viewWorkerUrl, theme: currentTheme, t, formatPrice
            })
          )
        }) : renderAnalyticsPlaceholder(t.navReturns || 'Returns');

      case 'rebalancing':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.RebalancingView, {
            portfolio, prices, theme: currentTheme, formatPrice, getCurrencySymbol, t, setActiveView
          }) : renderAnalyticsPlaceholder(t.navRebalancing || 'Rebalancing');

      case 'attribution':
        return window.MaerminFeatures7 ?
          React.createElement(window.MaerminFeatures7.PerformanceAttribution, {
            portfolio, prices, transactions: activeTransactions, exchangeRate,
            theme: currentTheme, formatPrice, getCurrencySymbol, t,
            // FX attribution fold-in: the currency dimension of attribution (R4.1: inside the view frame).
            extra: window.MaerminFxAttribution && React.createElement(window.MaerminFxAttribution.Panel, {
              portfolio, prices, priceHistory: { ...priceHistory, ...dailyAnalytics.perHolding }, transactions: activeTransactions,
              workerUrl: viewWorkerUrl, theme: currentTheme, t, formatPrice
            })
          }) : renderAnalyticsPlaceholder(t.navAttribution || 'Attribution');

      case 'news':
        return window.MaerminFeatures7 ?
          React.createElement(window.MaerminFeatures7.NewsFeedView, {
            portfolio, transactions: activeTransactions, apiKeys: demoMode && DFX ? { ...apiKeys, cs2Worker: DFX.BASE } : apiKeys,
            theme: currentTheme, formatPrice, getCurrencySymbol
          }) : renderAnalyticsPlaceholder(t.navNewsFeed || 'News Feed');

      case 'data':
      case 'broker-import':
        return React.createElement(StableViews.DataManagementView, {
          transactions, setTransactions, createBackup, exportData,
          theme: currentTheme, t, addToast, formatPrice,
          // Phase 6 B-6: both open on the Broker import (the alias kept its deep link)
          initialSection: 'broker'
        });

      case 'privacy':
        return window.MaerminTrust
          ? React.createElement(window.MaerminTrust.PrivacyView, { theme: currentTheme, portfolio, prices, transactions: activeTransactions, priceHistory, privacyMode })
          : renderAnalyticsPlaceholder(t.navPrivacy || 'Privacy');

      case 'trash':
        return window.MaerminTrash
          // R5.1: the shared view layout
          ? React.createElement('div', { className: 'ui-view' },
              window.MaerminPreMigration && React.createElement(window.MaerminPreMigration.PreMigrationCard, { theme: currentTheme, addToast }),
              React.createElement(window.MaerminTrash.TrashView, { theme: currentTheme, addToast }))
          : renderAnalyticsPlaceholder(t.navTrash || 'Trash');

      case 'journal':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.PositionNotesView, {
            portfolio, theme: currentTheme, t
          }) : renderAnalyticsPlaceholder(t.navJournal || 'Trade Journal');

      case 'dividends':
        return React.createElement(React.Fragment, null,
          React.createElement(StableViews.DividendsCombinedView, {
            portfolio, prices, transactions: activeTransactions, apiKeys: marketApiKeys,
            theme: currentTheme, t, addToast, formatPrice, getCurrencySymbol,
            divAutoBook, toggleDivAutoBook, onBookDividends: () => bookDividends(true)
          }),
          // Yield-on-cost + DRIP (WI-6): per-payer YoC over FIFO cost basis.
          window.MaerminDividendYoc && window.MaerminDividendYoc.Panel &&
            React.createElement('div', { className: 'ui-div-extra' },
              React.createElement(window.MaerminDividendYoc.Panel, {
                portfolio, prices, transactions: activeTransactions, exchangeRate, fxAt,
                theme: currentTheme, t, formatPrice, getCurrencySymbol
              })),
          // Earnings calendar for held stocks (read-only, gated like Discovery).
          // VIS-010: in the same content column as the cards above.
          window.MaerminEarnings && window.MaerminEarnings.Panel &&
            React.createElement('div', { className: 'ui-div-extra' },
              React.createElement(window.MaerminEarnings.Panel, {
                theme: currentTheme,
                workerUrl: viewWorkerUrl,
                symbols: [...new Set(activeTransactions.filter(tx => tx.category === 'stocks').map(tx => (tx.symbol || '').toUpperCase()).filter(Boolean))]
              }))
        );

      case 'tax':
        return React.createElement(StableViews.TaxCombinedView, {
          transactions: activeTransactions, prices,
          theme: currentTheme, t, formatPrice, getCurrencySymbol,
          taxJurisdiction, setTaxJurisdiction, language
        });

      case 'watchlist':
        return window.MaerminFeatures ?
          React.createElement(window.MaerminFeatures.WatchlistView, {
            prices, priceHistory, theme: currentTheme, t, addToast,
            onCharts: window.MaerminCharts ? openCharts : null // CH-3a
          }) : renderAnalyticsPlaceholder(t.navWatchlist || 'Watchlist');

      // CH-3a (Phase 7): the Charts workspace - candles, timeframes, scales.
      // Prices through the Worker (the demo's sample data in demo mode).
      case 'charts':
        return window.MaerminCharts ?
          React.createElement(window.MaerminCharts.View, {
            theme: currentTheme, transactions, symbol: chartsSymbol, onSymbol: setChartsSymbol,
            workerUrl: viewWorkerUrl, exchangeRate, fxAt, demo: demoMode, privacy: privacyMode, // CH-3c: trade tooltips hide amounts
            onOpenRules: () => setActiveView('rules'), // CH-4: after "Create alert at this price"
            symbols: window.MaerminCharts.quickPicks(transactions, (() => { try { return JSON.parse(localStorage.getItem('maermin_watchlist') || '[]') || []; } catch (e) { return []; } })())
          }) : renderAnalyticsPlaceholder(__('navCharts', 'Charts'));

      case 'transactions':
        return renderTransactionsView();
      
      case 'analytics':
        return renderAnalyticsMenu();
      
      case 'investment-analysis':
        return window.InvestmentViews && window.InvestmentViews.InvestmentAnalysisDashboard ?
          React.createElement(window.InvestmentViews.InvestmentAnalysisDashboard, {
            portfolio, prices, priceHistory, dailyCloses: dailyAnalytics.perHolding, metaVersion,
            theme: currentTheme, t, formatPrice, getCurrencySymbol, workerUrl: marketWorker, exchangeRate,
            // P5-5.7: goals linked to portfolios or tags
            transactions, portfolios,
            // P5-2.8: Providers & brokers section
            renderProviders: window.MaerminAllocationGroups ? () => React.createElement(window.MaerminAllocationGroups.Panel, {
              positions: providerPositions, portfolios: pfAllocation, theme: currentTheme, formatPrice, getCurrencySymbol
            }) : null,
            // P5-2.10: Taxonomies section (sector / country / fund type for "fill from data")
            renderTaxonomies: window.MaerminTaxonomies ? () => React.createElement(window.MaerminTaxonomies.Panel, {
              holdings: taxonomyHoldings, noSell: window.MaerminRebalance && window.MaerminRebalance.loadPrefs ? window.MaerminRebalance.loadPrefs().noSell : [],
              theme: currentTheme, formatPrice, getCurrencySymbol
            }) : null
          }) : renderAnalyticsPlaceholder(t.navStrategy || 'Strategy Analysis');

      case 'health':
        return React.createElement(React.Fragment, null,
          window.PortfolioHealth ?
            React.createElement(window.PortfolioHealth.HealthView, {
              portfolio, prices, priceHistory, transactions: activeTransactions,
              theme: currentTheme, t, formatPrice, getCurrencySymbol, setActiveView
            }) : renderAnalyticsPlaceholder(t.navHealthScore || 'Portfolio Health'),
          // ETF look-through (X-Ray): effective per-security exposure plus
          // sector/country/currency look-through — folds into Health (no new
          // tab). Gated on the Worker fundholdings route with a static
          // fallback; hands its result up for the advisor below.
          window.MaerminLookThrough && window.MaerminLookThrough.Panel && React.createElement('div', { className: ['ui-view', 'ui-view--cont'].join(' ') },
            React.createElement(window.MaerminLookThrough.Panel, {
              portfolio, prices, workerUrl: marketWorker, mode: 'overview',
              theme: currentTheme, t, formatPrice, getCurrencySymbol,
              onResult: setLookThroughResult
            })
          ),
          // Fold the (already-tested) AI advisor findings into Health — no new
          // tab. extras feeds pre-computed inputs the advisor cannot gather
          // itself: the look-through result and the risk-monitor evaluation
          // (drawdown/volatility breaches against the user's thresholds).
          window.MaerminAdvisor && window.MaerminAdvisor.Panel && React.createElement('div', { className: ['ui-view', 'ui-view--cont'].join(' ') },
            window.MaerminTrust && React.createElement(window.MaerminTrust.Disclaimer, { theme: currentTheme, kind: 'invest' }),
            React.createElement(window.MaerminAdvisor.Panel, {
              portfolio, prices, transactions: activeTransactions, theme: currentTheme, t,
              // Amounts in the findings follow Privacy Mode and the display currency.
              formatMoney: (v) => `${formatPrice(v)} ${getCurrencySymbol()}`,
              extras: (() => {
                const extras = {};
                if (lookThroughResult) extras.lookThrough = lookThroughResult;
                const RM = window.MaerminRiskMonitor;
                if (RM) {
                  try { extras.riskMonitor = RM.evaluate(RM.gatherInputs(portfolio, prices, priceHistory, lookThroughResult), RM.loadSettings()); }
                  catch (e) { /* monitor unavailable — advisor degrades */ }
                }
                return Object.keys(extras).length ? extras : undefined;
              })()
            })
          )
        );

      default:
        return renderOverview();
    }
  };

  // ========== OVERVIEW VIEW ==========

  const renderOverview = () => {
    // Compute per-portfolio stats for single-portfolio mode
    const selectedPortfolio  = portfolios.find(p => p.id === overviewMode) || portfolios[0];
    const isAllMode          = overviewMode === 'all';

    // v10.x: Overview section visibility (MaerminDashboard / "Customize Overview").
    // Read once per render; an unknown/absent id defaults to visible so a section
    // is never hidden by accident.
    const dashVisSet = window.MaerminDashboard ? window.MaerminDashboard.visibleSet() : null;
    const dashVis = (id) => !dashVisSet || dashVisSet[id] !== false;

    // Nudge pre-existing vaults (created before recovery codes shipped) to add one.
    const _vaultStatus = (window.MaerminAuth && window.MaerminAuth.getStatus) ? window.MaerminAuth.getStatus() : {};
    const showRecoveryNudge = !demoMode && _vaultStatus.hasVault && !_vaultStatus.hasRecovery && !recoveryNudgeDismissed;

    const singleStats = useMemoInline(() => {
      if (isAllMode) return null;
      // Delegate to the shared SSOT so single-portfolio mode uses the SAME
      // FIFO cost basis as "All" mode (was a separate average-cost reducer that
      // diverged from buildPositions after partial sells).
      const filtered = transactions.filter(tx => (tx.portfolioId || 'default') === overviewMode);
      const pf = window.MaerminMetrics.buildPositions(filtered, { exchangeRate, fxAt });
      return window.MaerminMetrics.computeStats(pf, prices);
    }, [overviewMode, transactions, prices, exchangeRate, fxAt, corpActionsRev]);

    const stats  = isAllMode ? allPortfoliosStats : singleStats || allPortfoliosStats;
    const ovCash = cashOf(isAllMode ? 'all' : overviewMode); // P5-1.4: null without a clearing account
    const isUp   = stats.totalProfit >= 0;
    const pctStr = window.MaerminI18n.pct(stats.totalProfitPercent, 2, true);

    // Label names depend on mode
    // VIS-006: value minus the open cost basis - the unrealised part only
    // (Returns → "Total return" also counts sales and dividends).
    const labelReturn = __('ovUnrealisedGain', 'Unrealised gain');

    // R3.1: an answer tile is the shared Stat on a card (a link for the
    // keyboard when it leads somewhere); the figure keeps its currency on one line.
    const UIC = window.MaerminComponents;
    const cxs = (...parts) => parts.filter(Boolean).join(" ");
    const toneName = (color) => color === currentTheme.success ? 'gain' : color === currentTheme.danger ? 'loss' : color === currentTheme.warning ? 'warning' : null;
    const statCard = (label, value, sub, color, onClick) =>
      React.createElement(UIC.Card, { variant: 'answer', className: 'ui-ov-tile' },
        React.createElement(UIC.Stat, { label, value: React.createElement('span', { className: 'mx-kpi-value' }, value), sub, tone: toneName(color), onClick }));

    // Transactions and portfolio for chart — filtered by mode
    const overviewTransactions = isAllMode
      ? transactions
      : memoBy('ovTx', [transactions, overviewMode], () => transactions.filter(tx => (tx.portfolioId || 'default') === overviewMode));

    // Single-portfolio mode delegates to the shared SSOT (FIFO cost basis) too,
    // so the Overview chart/allocation match "All" mode and the stat cards.
    const overviewPortfolio = isAllMode
      ? allPortfoliosPortfolio
      : memoBy('ovPf', [overviewTransactions, exchangeRate, fxAt, corpActionsRev], () => window.MaerminMetrics.buildPositions(overviewTransactions, { exchangeRate, fxAt }));

    // Worker status → the header's green/red dot + a plain-language explanation
    // (never a silent failure when prices can't be fetched).
    const wsState = demoMode || !workerStatus ? 'idle'
      : workerStatus.ok ? 'ok'
      : workerStatus.reachable ? 'warn' : 'bad';
    const wsLabel = demoMode ? __('wsDemo', 'Demo')
      : !workerStatus ? __('wsChecking', 'Worker…')
      : workerStatus.ok ? __('wsLive', 'Live')
      : workerStatus.error === 'no-worker-url' ? __('wsNoWorker', 'No worker') : (t.noData || 'No data');
    const wsTitle = demoMode ? __('wsDemoTitle', 'Demo mode — sample prices, no worker needed')
      : !workerStatus ? __('wsCheckingTitle', 'Checking worker reachability…')
      : workerStatus.ok ? __('wsLiveTitle', 'Price worker online — live quotes')
      : workerStatus.error === 'no-worker-url' ? __('wsNoUrlTitle', 'No worker URL set. Stock/CS2 prices need a Cloudflare Worker — click to set it up in API settings.')
      : workerStatus.reachable ? __('wsErrorTitle', 'Worker reachable but returned an error ({err}). Click to review API settings.', { err: workerStatus.error })
      : __('wsDownTitle', 'Worker not reachable — stock/CS2 prices unavailable. Click to check your worker URL.');

    // FX transparency — the converted-value rate, its source and age, on hover.
    const _fxMeta = window.MaerminDataQuality ? (window.MaerminDataQuality.readMeta()['__fx__'] || {}) : {};
    const fxInfo = window.MaerminDataQuality
      ? window.MaerminDataQuality.fx(exchangeRate, { fetchedAt: _fxMeta.at, source: _fxMeta.source || 'open.er-api.com', pair: 'USD→EUR' })
      : null;

    // Data-health summary across ALL holdings → the top-bar "N prices stale" chip.
    const dqHealth = (function () {
      const Q = window.MaerminDataQuality;
      if (!Q || demoMode) return null;
      const meta = Q.readMeta();
      const items = [];
      ['crypto', 'stocks', 'skins', 'commodities'].forEach((cls) => {
        (allPortfoliosPortfolio[cls] || []).forEach((p) => {
          const sym = p.symbol;
          const e = meta[sym] || meta[String(sym).toUpperCase()] || meta[String(sym).toLowerCase()] || {};
          // A cost-basis fallback is not a price: count it as missing.
          const px = window.MaerminMarket.isCostFallback(sym) ? null
            : (prices[sym] != null ? prices[sym] : (prices[String(sym).toUpperCase()] != null ? prices[String(sym).toUpperCase()] : (prices[String(sym).toLowerCase()] != null ? prices[String(sym).toLowerCase()] : p.currentPrice)));
          items.push({ category: cls, price: px, fetchedAt: e.at });
        });
      });
      return Q.summarize(items);
    })();

    // P5-1.5: return figures of this view (one module with Analysis → Returns).
    // TWR: the active portfolio's path when the view is that portfolio, else a
    // path for the view; it includes cash only when every portfolio in the view
    // keeps a clearing account (P5-1.4).
    const ovFigures = () => memoBy('ovFigures', [overviewTransactions, stats.totalValue, clearingByPf, closeSeriesEUR, fetchedPrices, exchangeRate, fxAt, corpActionsRev, overviewMode, activePortfolioId, valuePath], () => {
      const RF = window.MaerminReturnFigures;
      if (!RF) return null;
      const vc = overviewMode === activePortfolioId ? activeClearing
        : window.MaerminLedger.viewClearing(clearingByPf, isAllMode ? (portfolios || []).map(p => p.id) : [overviewMode]);
      const path = overviewMode === activePortfolioId ? valuePath : buildValuePath(overviewTransactions, vc.merged);
      return RF.compute(overviewTransactions, { securitiesValueEUR: stats.totalValue, exchangeRate, fxAt, today: window.MaerminUtils.todayISO(),
        valuePath: path, clearings: vc.clearings });
    });

    // R3.1: the open positions of this view (category colours from the chart
    // tokens), shared by the holdings map and the allocation section.
    const ovListData = () => {
      const CLASS = {
        crypto:      { label: t.crypto || 'Crypto',        color: 'var(--chart-1)' },
        stocks:      { label: __('catStocksEtfs', 'Stocks & ETFs'), color: 'var(--chart-2)' },
        commodities: { label: __('catCommodities', 'Commodities'),   color: 'var(--chart-3)' },
        skins:       { label: t.cs2Skins || 'CS2 Skins',     color: 'var(--chart-4)' },
      };
      // v10.x: include user-defined custom categories (custom-categories.js) so
      // they show in the Overview donut + legend. catMeta resolves label/colour.
      const customCatIds = window.MaerminCategories ? window.MaerminCategories.ids() : [];
      const catList = ['crypto', 'stocks', 'commodities', 'skins', 'bonds'].concat(customCatIds); // P5-3.9: bonds
      const catMeta = (cat) => CLASS[cat] || (window.MaerminCategories
        ? { label: window.MaerminCategories.label(cat), color: window.MaerminCategories.color(cat) }
        : { label: cat, color: 'var(--text-dim)' });
      // Theme tokens, not fixed dark-theme colours: on the light theme the
      // fixed green read 1.9:1 and the grey 3:1 (Phase 3 contrast pass).
      const green = currentTheme.success, red = currentTheme.danger, gray = currentTheme.textSecondary;
      const glyph = s => (s || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
      // Letters on a category tile: the pastel category colours read only on dark (2.2:1 on light)
      const tileInk = c => currentTheme.mode === 'light' ? currentTheme.text : c;
      const money = v => `${formatPrice(v)} ${getCurrencySymbol()}`;
      const fmtPct = n => window.MaerminI18n.pct(n, 2, true);
      const pxv = p => {
        const sym = (p.symbol || p.name || '');
        return prices[sym] ?? prices[sym.toLowerCase()] ?? prices[sym.toUpperCase()] ?? p.currentPrice ?? 0;
      };
      const list = [];
      catList.forEach(cat =>
        (overviewPortfolio[cat] || []).forEach(p => {
          const price = pxv(p), amount = p.amount || 0, value = amount * price;
          const cost = p.totalCostEUR != null ? p.totalCostEUR : (p.purchasePrice || 0) * amount;
          const pnl = value - cost, pnlPct = cost > 0 ? pnl / cost * 100 : 0;
          list.push({ cat, sym: (p.symbol || p.name || ''), name: p.symbolName || p.name || (p.symbol || ''), amount, price, value, cost, pnl, pnlPct, color: catMeta(cat).color });
        })
      );
      const totalVal = list.reduce((s, p) => s + p.value, 0) || stats.totalValue || 0;
      return { CLASS, catList, catMeta, green, red, gray, glyph, tileInk, money, fmtPct, pxv, list, totalVal };
    };

    // P4-7: the Overview sections as thunks, rendered in the saved order.
    const ovSections = {
      // Audit 2026-10-24 feature 4: what a new vault still needs (first-steps.js).
      firstSteps: () => {
        const FS = window.MaerminFirstSteps;
        if (!FS || demoMode) return null;
        const state = FS.read(null, transactions.length, marketWorker);
        if (!FS.shouldShow(state)) return null;
        return React.createElement(FS.Card, {
          state,
          onAction: (id) => {
            if (id === 'prices') setShowApiSettings(true);
            else if (id === 'backup') downloadVaultBackup();
            else if (id === 'tax') setActiveView('tax');
          },
          onHide: () => {
            const D = window.MaerminDashboard;
            if (D) D.save(D.toggle(D.load(), FS.WIDGET_ID));
            setFirstStepsRev(n => n + 1);
          }
        });
      },
      valueChart: () => (
      window.MaerminFeatures6 && stats.totalPositions > 0 &&
        React.createElement(window.MaerminFeatures6.PortfolioHistoryChart, {
          portfolio:          overviewPortfolio,
          prices,
          transactions:       overviewTransactions,
          apiKeys: marketApiKeys,
          exchangeRate,
          fxAt,
          currentValue:       stats.totalValue,
          totalInvested:      stats.totalInvested,
          totalProfit:        stats.totalProfit,
          totalProfitPercent: stats.totalProfitPercent,
          // demo: drawn from the sample daily closes instead of fetched
          pathPoints:         demoMode && valuePath ? valuePath.points : null,
          theme: currentTheme, formatPrice, getCurrencySymbol
        })
      ),
      statCards: () => (
      (() => {
        const M = window.MaerminMetrics;
        const divOv = M ? memoBy('ovDiv', [overviewPortfolio, prices, exchangeRate], () => M.computeExpectedAnnualDividends(overviewPortfolio, prices, { exchangeRate })) : null;
        const healthOv = M ? memoBy('ovHealth', [overviewPortfolio, prices, t, priceHistory, overviewTransactions], () => M.healthScore(overviewPortfolio, prices, t, { priceHistory, transactions: overviewTransactions })) : null;
        const hColor = (s) => s >= 70 ? currentTheme.success : s >= 40 ? currentTheme.warning : currentTheme.danger;
        const hScore = healthOv && !healthOv.empty ? healthOv.score : null;
        return React.createElement('div', { className: 'ui-ov-tiles' },
          statCard(__('ovCostBasisOpen', 'Cost basis (open)'), `${formatPrice(stats.totalInvested)} ${getCurrencySymbol()}`,
            __('ovAcrossPositions', 'across {n} {n:position|positions}', { n: stats.totalPositions })),
          // P5-1.4: the clearing account(s) of this view, with the total incl. cash
          ovCash !== null && statCard(__('ovCash', 'Cash (clearing account)'), `${formatPrice(ovCash)} ${getCurrencySymbol()}`,
            __('ovTotalInclCash', 'Total incl. cash: {amount}', { amount: `${formatPrice(stats.totalValue + ovCash)} ${getCurrencySymbol()}` }),
            ovCash < 0 ? currentTheme.danger : undefined, () => setActiveView('portfolios')),
          statCard(labelReturn,
            `${isUp ? '+' : ''}${formatPrice(stats.totalProfit)} ${getCurrencySymbol()}`,
            __('ovAllTime', '{pct} all time', { pct: pctStr }),
            isUp ? currentTheme.success : currentTheme.danger),
          statCard(__('ovDivExpected12m', 'Expected dividends (12m)'),
            (divOv && divOv.available) ? `${formatPrice(divOv.totalAnnual)} ${getCurrencySymbol()}` : '—',
            (divOv && divOv.available) ? __('perMonthYield', '{amount}/mo · {yield}', { amount: `${formatPrice(divOv.monthly)} ${getCurrencySymbol()}`, yield: window.MaerminI18n.pct(divOv.yield, 1) }) : (t.kpiDividendsNone || 'No dividend payers'),
            (divOv && divOv.available) ? currentTheme.success : undefined,
            () => setActiveView('dividends')),
          statCard(t.kpiHealth || 'Health Score',
            hScore != null ? String(hScore) : '—',
            hScore != null ? __('ovGrade', 'Grade {g}', { g: healthOv.grade }) : __('ovAddToScore', 'Add positions to score'),
            hScore != null ? hColor(hScore) : undefined,
            () => setActiveView('health'))
        );
      })()
      ),
      returnFigures: () => {
        const f = ovFigures();
        if (!f || !overviewTransactions.length) return null;
        const I = window.MaerminI18n, cur = getCurrencySymbol();
        const money = (v) => v === null ? '—' : `${formatPrice(v)} ${cur}`;
        const pct = (v) => v === null ? '—' : I.pct(v * 100, 2, true);
        const tone = (v) => v === null ? undefined : v > 0 ? currentTheme.success : v < 0 ? currentTheme.danger : undefined;
        const go = () => setActiveView('returns');
        return React.createElement('section', { 'data-testid': 'ov-returns', className: 'ui-ov-block' },
          React.createElement('div', { className: 'ui-ov-block__head' },
            React.createElement('h2', { className: 'ui-ov-block__title' }, __('ovReturnsTitle', 'Returns')),
            React.createElement(UIC.Button, { variant: 'quiet', size: 'sm', onClick: go }, __('ovToReturns', 'Returns →'))),
          React.createElement('div', { className: 'ui-ov-tiles' },
            statCard(__('retXirr', 'XIRR (annualized)'), pct(f.xirr), f.cash !== null ? __('retXirrSubCash', 'Money-weighted p.a., from deposits and withdrawals') : __('retXirrSub', 'Money-weighted return p.a.'), tone(f.xirr), go),
            statCard('TWR', pct(f.twr), f.twr === null ? __('retNoHistory', 'No price history yet')
              : [f.twrAnnualized !== null ? __('retPa', '{pct} p.a.', { pct: I.pct(f.twrAnnualized * 100, 2, true) }) : '', f.twrCash ? __('retInclCash', 'incl. cash account') : ''].filter(Boolean).join(' · '), tone(f.twr), go),
            statCard(__('ovRealized', 'Realised gains'), money(f.realized), __('ovRealizedSub', 'From sales (FIFO)'), tone(f.realized), go),
            statCard(__('ovDividendsReceived', 'Dividends received'), money(f.dividendsNet), __('ovDividendsGross', '{amount} gross', { amount: money(f.dividendsGross) }), undefined, go),
            statCard(__('ovTaxes', 'Taxes'), money(f.taxes), __('ovTaxesSub', 'Withholding + tax bookings − refunds'), undefined, go),
            statCard(__('retTotalFees', 'Total Fees'), money(f.fees), __('ovFeesSub', 'Trade fees + fee bookings'), undefined, go),
            statCard(__('ovNetReturn', 'Net return'), money(f.netReturn), f.netReturnPct === null ? '' : pct(f.netReturnPct), tone(f.netReturn), go)));
      },
      // Phase 6 B-4: what the total is made of - money still invested, the
      // unrealised gain (or loss) and cash, adding up to the total.
      composition: () => {
        if (!stats.totalPositions && !(ovCash > 0)) return null;
        const cur = getCurrencySymbol();
        const money = (v) => `${formatPrice(v)} ${cur}`;
        const cash = ovCash || 0, inv = stats.totalInvested || 0, gain = stats.totalProfit || 0;
        const sec = stats.totalValue || 0, total = sec + cash;
        const segs = (gain >= 0
          ? [{ k: 'inv', v: inv, cls: 'is-cost', label: __('ovMadeInvested', 'Still invested') }, { k: 'gain', v: gain, cls: 'is-gain', label: __('ovUnrealisedGain', 'Unrealised gain') }]
          : [{ k: 'sec', v: sec, cls: 'is-cost', label: __('ovMadeSecurities', 'Securities') }])
          .concat(cash > 0 ? [{ k: 'cash', v: cash, cls: 'is-cash', label: __('ovMadeCash', 'Cash') }] : [])
          .filter((x) => x.v > 0);
        const legend = [
          { k: 'inv', cls: 'is-cost', label: __('ovMadeInvested', 'Still invested'), v: money(inv) },
          { k: 'gain', cls: gain >= 0 ? 'is-gain' : 'is-loss', label: gain >= 0 ? __('ovUnrealisedGain', 'Unrealised gain') : __('ovMadeLoss', 'Unrealised loss'),
            v: (gain > 0 ? '+' : '') + money(gain), tone: gain > 0 ? 'tone-gain' : gain < 0 ? 'tone-loss' : '' }
        ].concat(ovCash !== null ? [{ k: 'cash', cls: 'is-cash', label: __('ovMadeCash', 'Cash'), v: money(cash) }] : []);
        return React.createElement(UIC.Card, { title: __('ovMadeOf', 'What it is made of'), className: 'ui-ov-made', 'data-testid': 'ov-made' },
          React.createElement('div', { className: 'ui-made', role: 'img', 'aria-label': segs.map((x) => x.label + ' ' + money(x.v)).join(', ') },
            segs.map((x) => React.createElement('span', { key: x.k, className: 'ui-made__seg ' + x.cls, style: { flexGrow: x.v } },
              total > 0 && x.v / total > 0.2 ? React.createElement('span', { className: 'num' }, money(x.v)) : null))),
          React.createElement('ul', { className: 'ui-made__legend' },
            legend.map((l) => React.createElement('li', { key: l.k },
              React.createElement('span', { className: 'ui-made__dot ' + l.cls, 'aria-hidden': 'true' }),
              React.createElement('span', null, l.label),
              React.createElement('b', { className: 'num ' + (l.tone || '') }, l.v)))),
          React.createElement('div', { className: 'ui-made__eq' },
            React.createElement('span', null, ovCash !== null
              ? __('ovMadeEq', 'Securities {sec} + cash {cash}', { sec: money(sec), cash: money(cash) })
              : __('ovMadeEqNoCash', 'Securities (no clearing account)')),
            React.createElement('b', { className: 'num' }, '= ' + money(total))));
      },
      // B-4: the next five dated events from local data only (dividend schedule,
      // savings plans, splits, tax dates) - no extra network call on the Overview.
      nextUp: () => {
        const EF = window.MaerminEventFeed;
        if (!EF || !EF.build) return null;
        const I = window.MaerminI18n;
        const list = memoBy('ovNext', [overviewPortfolio, transactions, prices, privacyMode, taxJurisdiction, language], () => {
          const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || d); } catch (e) { return JSON.parse(d); } };
          const CA = window.MaerminCorporateActions;
          const inp = pushCtx().input || {};
          const held = ((overviewPortfolio && overviewPortfolio.stocks) || []).filter((x) => (parseFloat(x.amount) || 0) > 0).map((x) => x.symbol).filter(Boolean);
          try {
            return EF.build({ today: window.MaerminUtils.todayISO(), held, watched: [], earnings: [], dividends: inp.dividends, splits: CA && CA.load ? (CA.load().actions || []) : [],
              plans: read('maermin_savings_plans', '[]') || [], vap: inp.vap, crypto: inp.crypto, ira: inp.ira, jurisdiction: taxJurisdiction },
              { days: 120, amounts: !privacyMode, money: (v, c) => I.money(v, c || 'EUR'), num: (v, d) => I.num(v, d), date: (d) => I.date(d) }).slice(0, 5);
          } catch (e) { return []; }
        });
        return React.createElement(UIC.Card, {
          title: __('ovNextUp', 'Next up'), className: 'ui-ov-next', 'data-testid': 'ov-next',
          action: React.createElement(UIC.Button, { variant: 'quiet', size: 'sm', onClick: () => setActiveView('events') }, __('ovToEvents', 'Events →'))
        },
          list.length
            ? React.createElement('ul', { className: 'ui-next' }, list.map((ev) => React.createElement('li', { key: ev.uid },
                React.createElement('span', { className: cxs('ui-next__date', 'num') }, I.date(ev.date)),
                React.createElement('span', { className: 'ui-next__text' },
                  React.createElement('span', null, ev.title),
                  ev.detail ? React.createElement('span', { className: 'ui-next__detail' }, ev.detail) : null))))
            : React.createElement('p', { className: 'ui-muted' }, __('ovNextNone', 'Nothing in the next 120 days.')));
      },
      // B-4: the holdings map - area = value, colour = return since purchase.
      holdingsMap: () => {
        const d = ovListData();
        const items = d.list.filter((p) => p.value > 0).map((p) => ({
          key: p.cat + '|' + p.sym, label: (p.cat === 'skins' ? d.glyph(p.sym) : p.sym) || p.name, value: p.value, p, // audit V-3: the ticker, not the 4-letter avatar glyph (ALV.DE, not ALVD)
          pct: p.cost > 0 ? p.pnlPct : null, pctText: p.cost > 0 ? window.MaerminI18n.pct(Math.abs(p.pnlPct), 1) : null,
          title: p.name + ' · ' + d.money(p.value) + (p.cost > 0 ? ' · ' + d.fmtPct(p.pnlPct) : '')
        }));
        if (items.length < 2) return null;
        return React.createElement(UIC.Card, {
          title: __('ovHoldingsMap', 'Holdings map'), subtitle: __('ovMapLegend', 'Area = value · colour = return since purchase'), className: 'ui-ov-map', 'data-testid': 'ov-map'
        },
          React.createElement(UIC.HoldingsMap, {
            label: __('ovHoldingsMap', 'Holdings map'), items,
            onPick: (it) => setPositionDetail({ sym: it.p.sym, name: it.p.name, cat: it.p.cat, amount: it.p.amount, avgPrice: it.p.amount > 0 ? it.p.cost / it.p.amount : 0 })
          }));
      },
      allocation: () => (
      stats.totalPositions > 0 && (() => {
        const { catList, catMeta, green, red, gray, glyph, tileInk, money, fmtPct, list, totalVal } = ovListData();

        // Allocation by asset class → donut + legend
        const classes = catList.map(c => {
          const v = list.filter(p => p.cat === c).reduce((s, p) => s + p.value, 0);
          return { c, label: catMeta(c).label, color: catMeta(c).color, value: v, pct: totalVal > 0 ? v / totalVal * 100 : 0 };
        }).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
        const CIRC = 2 * Math.PI * 70; let off = 0;
        const donutSegs = classes.map(ct => {
          const dash = ct.pct / 100 * CIRC;
          const el = React.createElement('circle', { key: ct.c, cx: 90, cy: 90, r: 70, fill: 'none', stroke: ct.color, strokeWidth: 18, strokeDasharray: `${dash.toFixed(2)} ${(CIRC - dash).toFixed(2)}`, strokeDashoffset: (-off).toFixed(2) });
          off += dash; return el;
        });

        const performers = [...list].filter(p => p.cost > 0).sort((a, b) => b.pnlPct - a.pnlPct).slice(0, 4);
        const positions = [...list].sort((a, b) => b.value - a.value);
        // R3.1: holdings as the shared asset cell (tile + name + symbol)
        const avatar = (sym, color) => React.createElement('span', { className: 'ui-asset__av', 'aria-hidden': 'true', style: { background: window.MaerminTokens.alpha(color, 0x22), color: tileInk(color) } }, glyph(sym));
        const asset = (name, sym, color, sub) => React.createElement('span', { className: 'ui-asset' }, avatar(sym, color),
          React.createElement('span', { className: 'ui-asset__text' },
            React.createElement('span', { className: 'ui-asset__name' }, name),
            sub ? React.createElement('span', { className: 'ui-asset__sub' }, sub) : null));
        const toneCls = (v) => v > 0 ? 'tone-gain' : v < 0 ? 'tone-loss' : '';
        const signedMoney = (v) => `${v >= 0 ? '+' : ''}${money(v)}`;

        const allocCard = React.createElement(UIC.Card, { title: __('ovAllocByClass', 'Allocation by asset class'), className: 'ui-ov-alloc' },
          React.createElement('div', { className: 'ui-donut' },
            React.createElement('div', { className: 'ui-donut__chart' },
              React.createElement('svg', { role: 'img', 'aria-label': __('ovAllocAria', 'Allocation: {list}', { list: classes.map(ct => ct.label + ' ' + window.MaerminI18n.pct(ct.pct, 1)).join(', ') }), width: 160, height: 160, viewBox: '0 0 180 180', className: 'ui-donut__svg' },
                React.createElement('circle', { cx: 90, cy: 90, r: 70, fill: 'none', stroke: 'var(--surface-2)', strokeWidth: 18 }),
                ...donutSegs
              ),
              React.createElement('div', { className: 'ui-donut__center' },
                React.createElement('b', { className: 'num' }, String(stats.totalPositions)),
                React.createElement('span', null, __('ovPositionsWord', 'positions')))
            ),
            React.createElement('ul', { className: 'ui-donut__legend' },
              ...classes.map(ct => React.createElement('li', { key: ct.c },
                React.createElement('span', { className: 'ui-swatch', 'aria-hidden': 'true', style: { background: ct.color } }),
                React.createElement('span', { className: 'ui-donut__label' }, ct.label),
                React.createElement('b', { className: 'num' }, window.MaerminI18n.pct(ct.pct, 1)),
                React.createElement('span', { className: cxs('num', 'ui-donut__money') }, money(ct.value))
              ))
            )
          )
        );

        const perfCard = React.createElement(UIC.Card, { title: __('ovTopPerformers', 'Top performers'), className: 'ui-ov-perf' },
          performers.length
            ? React.createElement('ul', { className: 'ui-rank' },
                performers.map(p => React.createElement('li', { key: p.cat + p.sym },
                  asset(p.name, p.sym, p.color, glyph(p.sym)),
                  React.createElement('span', { className: 'ui-rank__side' },
                    React.createElement('b', { className: 'num ' + toneCls(p.pnlPct) }, (p.pnlPct >= 0 ? '▲ ' : '▼ ') + fmtPct(p.pnlPct)),
                    React.createElement('span', { className: 'num' }, money(p.value))))))
            : React.createElement('p', { className: 'ui-muted' }, __('ovNoPriced', 'No priced positions yet — refresh prices to populate.'))
        );

        // P4-2: fully sold positions from the one FIFO ledger (same cost basis
        // as the tax report and the FIFO tab), for the transactions shown here.
        const closedRows = memoBy('ovClosed', [overviewTransactions, exchangeRate, fxAt, corpActionsRev], () => {
          const L = window.MaerminLedger;
          try { return L && L.closedPositions ? L.closedPositions(L.build(overviewTransactions, { exchangeRate, fxAt, perPortfolio: true })) : []; } catch (e) { return []; }
        });
        const showClosed = posTab === 'closed';
        const openDetail = (p) => setPositionDetail({ sym: p.sym, name: p.name, cat: p.cat, amount: p.amount, avgPrice: p.amount > 0 ? p.cost / p.amount : 0 });
        const openCols = [
          { key: 'asset', label: __('colAsset', 'Asset'), phone: 'title', render: (p) => asset(p.name, p.sym, p.color, glyph(p.sym)) },
          { key: 'qty', label: __('colQty', 'Qty'), align: 'right', priority: 2, phone: 'meta', render: (p) => window.MaerminI18n.num(p.amount, p.amount % 1 === 0 ? 0 : 4) },
          { key: 'price', label: t.price || 'Price', align: 'right', priority: 2, render: (p) => React.createElement(React.Fragment, null,
              p.price > 0 ? (p.cat === 'bonds' ? window.MaerminI18n.num(p.price * 100, 2) + ' %' : money(p.price)) : '—', // P5-3.9: a bond's price in % of nominal
              // Valued at cost because no quote has ever been fetched for it.
              window.MaerminMarket.isCostFallback(p.sym) && React.createElement('span', { className: 'ui-cell-note', 'data-testid': 'no-price', title: __('noPriceTitle', 'No market price available yet — valued at cost basis.') }, __('noPriceAtCost', 'no price · at cost'))) },
          { key: 'value', label: __('colValue', 'Value'), align: 'right', phone: 'value', render: (p) => money(p.value) },
          { key: 'weight', label: __('colWeight', 'Weight'), priority: 3, render: (p) => {
              const w = totalVal > 0 ? (p.value / totalVal * 100) : 0;
              return React.createElement('span', { className: 'ui-weight' },
                React.createElement('span', { className: 'ui-weight__bar', 'aria-hidden': 'true' }, React.createElement('span', { style: { width: w + '%', background: p.color } })),
                React.createElement('span', { className: 'num' }, window.MaerminI18n.pct(w, 1)));
            } },
          { key: 'pnl', label: __('colPnl', 'P&L'), align: 'right', phone: 'sub', render: (p) => React.createElement('span', { className: 'ui-pnl ' + toneCls(p.pnl) },
              React.createElement('b', null, signedMoney(p.pnl)), React.createElement('span', null, (p.pnl >= 0 ? '▲ ' : '▼ ') + fmtPct(p.pnlPct))) }
        ];
        const closedCols = [
          { key: 'asset', label: __('colAsset', 'Asset'), phone: 'title', render: (c) => asset(c.symbolName || c.symbol, c.symbol, catMeta(c.category).color, __('ovClosedOn', 'sold {date}', { date: window.MaerminI18n.date(c.closed) })) },
          { key: 'cost', label: __('colDisposedCost', 'Cost basis sold'), align: 'right', priority: 2, phone: 'meta', render: (c) => money(c.cost) },
          { key: 'proceeds', label: __('colProceeds', 'Proceeds'), align: 'right', phone: 'value', render: (c) => money(c.proceeds) },
          { key: 'gain', label: __('colRealizedPnl', 'Realised P&L'), align: 'right', phone: 'sub', render: (c) => React.createElement('span', { className: 'ui-pnl ' + toneCls(c.gain) },
              React.createElement('b', null, signedMoney(c.gain)), React.createElement('span', null, c.ret === null ? '—' : (c.ret >= 0 ? '▲ ' : '▼ ') + fmtPct(c.ret * 100))) }
        ];
        const posTable = showClosed
          ? React.createElement(UIC.Table, {
              'data-testid': 'closed-positions', caption: __('ovPosClosedAria', 'Closed positions'), columns: closedCols, rows: closedRows,
              rowKey: (c) => c.key,
              rowProps: (c) => Object.assign({ 'data-closed-key': c.key, 'aria-label': __('ovPosDetails', '{name} details', { name: c.symbolName || c.symbol }) },
                window.MaerminUtils.clickable(() => setPositionDetail({ sym: c.symbol, name: c.name, cat: c.category, amount: 0, avgPrice: 0, closed: true, closedRow: c }))),
              empty: React.createElement('p', { className: 'ui-muted ui-pad' }, __('ovNoClosed', 'No closed positions yet. A position appears here once it is sold completely.'))
            })
          : React.createElement(UIC.Table, {
              'data-testid': 'open-positions', caption: t.positions || 'Positions', columns: openCols, rows: positions,
              rowKey: (p) => p.cat + '|' + p.sym,
              rowProps: (p) => Object.assign({ 'aria-label': __('ovPosDetails', '{name} details', { name: p.name }) }, window.MaerminUtils.clickable(() => openDetail(p)))
            });
        const positionsCard = React.createElement(UIC.Card, {
          variant: 'plain', className: 'ui-ov-positions',
          title: t.positions || 'Positions',
          action: React.createElement('div', { className: 'ui-ov-positions__tools' },
            React.createElement(UIC.Segmented, {
              size: 'sm', label: __('ovPosShow', 'Show positions'), value: posTab, onChange: setPosTab,
              options: [
                { value: 'open', label: __('ovPosOpen', 'Open'), attrs: { 'data-pos-tab': 'open' } },
                { value: 'closed', label: __('ovPosClosed', 'Closed ({n})', { n: closedRows.length }), attrs: { 'data-pos-tab': 'closed' } }
              ]
            }),
            React.createElement(UIC.Button, { variant: 'quiet', size: 'sm', onClick: () => setActiveView('transactions') }, __('ovViewAll', 'View all →')))
        }, posTable);

        // Return attribution: which holdings drove the total return (reuses the
        // already-computed `list` with per-position value + cost — no recompute).
        const attributionPanel = window.MaerminAttribution && window.MaerminAttribution.Panel
          ? React.createElement(window.MaerminAttribution.Panel, {
              positions: list.map(p => ({ symbol: p.sym, name: p.name, value: p.value, invested: p.cost })),
              theme: currentTheme, formatPrice
            })
          : null;

        return React.createElement(React.Fragment, null,
          // Two columns where they fit, one on phones ('1fr 1fr' could not shrink
          // below the allocation card's content and pushed the page 390px wide).
          React.createElement('div', { className: 'ui-ov-pair' }, allocCard, perfCard),
          positionsCard,
          attributionPanel

        );
      })()
      )
    };
    // The position dialog (opened from the positions table and the holdings map).
    const renderPositionModal = () => (
      positionDetail && window.MaerminFeatures3 && window.MaerminFeatures3.PositionDetailModal &&
        React.createElement(window.MaerminFeatures3.PositionDetailModal, {
          position: positionDetail, transactions: overviewTransactions, prices,
          theme: currentTheme, formatPrice, getCurrencySymbol, t,
          workerUrl: marketWorker,
          // P5-5.4: open the Research page for this position
          onResearch: window.MaerminResearch && positionDetail.cat !== 'crypto' && positionDetail.cat !== 'skins' ? () => { setResearchSymbol(String(positionDetail.sym || '').toUpperCase()); setPositionDetail(null); setActiveView('research'); } : null,
          // CH-3a: open the Charts view for this position
          onCharts: window.MaerminCharts && positionDetail.cat !== 'crypto' && positionDetail.cat !== 'skins' ? () => { const s = positionDetail.sym; setPositionDetail(null); openCharts(s); } : null,
          closeSeries: window.MaerminCloseHistory ? closeSeriesEUR[window.MaerminCloseHistory.keyOf(positionDetail.cat, positionDetail.sym)] : null,
          buildPath: buildValuePath, // P5-2.4: the holding's own monthly returns
          // A split may have been added/removed inside the modal — re-run
          // the positions overlay so values and cost basis update.
          onClose: () => { setPositionDetail(null); setCorpActionsRev(n => n + 1); }
        })
    );
    const ovOrder = window.MaerminDashboard ? window.MaerminDashboard.sectionOrder(window.MaerminDashboard.load(), Object.keys(ovSections)) : Object.keys(ovSections);
    const ovSlot = (i) => { const id = ovOrder[i]; if (!id || !dashVis(id)) return null; const el = ovSections[id](); return el ? React.createElement('div', { key: 'ov-' + id, 'data-ov-section': id }, el) : null; };

    return React.createElement('div', { className: 'ui-ov' },
      // R3.1: the view's toolbar. Title, portfolio scope and Add Transaction are
      // in the page header (R2.1); here: freshness, price service, FX, Import, Refresh.
      React.createElement('div', { className: 'ui-ov-toolbar', 'data-testid': 'ov-toolbar' },
        React.createElement('span', { className: 'ui-ov-toolbar__meta' },
          isAllMode
            ? `${__('ovAllCombined', 'All {n} {n:portfolio|portfolios} combined', { n: portfolios.length })} · ${lastRefresh ? __('ovLastRefresh', 'Last refresh {time}', { time: window.MaerminI18n.date(lastRefresh, 'time') }) : __('ovRefreshToUpdate', 'Refresh to update')}`
            : `${selectedPortfolio?.name || t.portfolio || 'Portfolio'} · ${lastRefresh ? __('ovLastRefresh', 'Last refresh {time}', { time: window.MaerminI18n.date(lastRefresh, 'time') }) : __('ovRefreshToUpdate', 'Refresh to update')}`),
        React.createElement('div', { className: 'ui-ov-toolbar__actions' },
          // Price service status - opens API settings.
          React.createElement('button', { type: 'button', className: 'ui-status', 'data-state': wsState, onClick: () => setShowApiSettings(true), title: wsTitle },
            React.createElement('span', { className: 'ui-status__dot', 'aria-hidden': 'true' }), wsLabel),
          // Outdated Worker: one notice that leads to the update steps.
          !demoMode && workerVersion && workerVersion.state === 'outdated' && React.createElement('button', {
            type: 'button', className: 'ui-status', 'data-state': 'warn', 'data-testid': 'worker-outdated', onClick: () => setShowApiSettings(true),
            title: __('wvOutdatedTitle', 'Your Worker is older than this app expects ({e}). Some features may fail until you update it.', { e: workerVersion.expected })
          }, __('wvOutdated', 'Worker outdated → update')),
          // Data health - only when something is stale or missing.
          dqHealth && (dqHealth.stale + dqHealth.missing) > 0 && React.createElement('button', {
            type: 'button', className: 'ui-status', 'data-state': 'warn', onClick: () => fetchPrices(), title: [
              dqHealth.stale ? __('dqPricesStale', '{n} {n:price|prices} stale', { n: dqHealth.stale }) : '',
              dqHealth.missing ? __('dqPricesMissing', '{n} {n:price|prices} missing', { n: dqHealth.missing }) : ''
            ].filter(Boolean).join(' · ') + ' — ' + __('dqClickRefresh', 'click to refresh prices')
          },
            React.createElement('span', { 'aria-hidden': 'true' }, '!'),
            dqHealth.stale ? __('dqStaleChip', '{n} stale', { n: dqHealth.stale + dqHealth.missing }) : __('dqMissingChip', '{n} missing', { n: dqHealth.missing })
          ),
          // FX transparency - the USD→EUR rate, source and age on hover.
          fxInfo && fxInfo.rate && React.createElement('span', {
            className: 'ui-status num', title: __('fxChipTitle', 'FX: {label} (source: {source})', { label: fxInfo.label, source: fxInfo.source })
          }, `$→€ ${window.MaerminI18n.num(fxInfo.rate, 3)}`),
          // Sample data for a first run (hidden once the vault has its own transactions).
          !demoMode && transactions.length === 0 && React.createElement(UIC.Button, { size: 'sm', onClick: enterDemo, title: __('demoTryTitle', 'Load sample data to explore the app instantly — no setup') }, __('demoTry', '★ Try demo')),
          // Phase 6 B-6: Import leads to Import / Export (Broker import); the paste dialog stays on "i" and the palette
          React.createElement(UIC.Button, { size: 'sm', 'data-testid': 'ov-import', onClick: () => setActiveView('data') }, __('importBtn', '↑ Import')),
          React.createElement(UIC.Button, { size: 'sm', onClick: fetchPrices, disabled: loading }, loading ? __('refreshing', '◎ Refreshing...') : __('refreshPrices', '↻ Refresh prices')),
          portfolios.length > 1 && React.createElement(UIC.Button, { size: 'sm', variant: 'quiet', onClick: () => setActiveView('portfolios') }, __('managePortfolios', 'Manage portfolios →'))
        )
      ),


      // CS2 banner
      !demoMode && portfolio.skins && portfolio.skins.length > 0 && !(marketWorker||'').trim() &&
        // R5.4: the shared warning callout
        React.createElement('div', { role: 'status', className: ['ui-callout', 'ui-callout--warn', 'ui-dq-fix', 'ui-ov-banner'].join(' ') },
          React.createElement('div', { className: 'ui-dq-fix__text' },
            React.createElement('strong', null, '! ' + __('cs2WorkerNeeded', 'CS2 skin prices need a Cloudflare Worker URL')),
            React.createElement('span', { className: 'ui-dq-fix__hint' }, __('cs2WorkerDeploy', 'Deploy the worker.js and paste the URL in API Settings.'))
          ),
          React.createElement(UIC.Button, { variant: 'primary', onClick: () => setShowApiSettings(true) }, __('addWorkerUrl', 'Add Worker URL →'))
        ),

      // CS2 skins filed as stocks (see renderMisfiledSkins)
      !demoMode && renderMisfiledSkins(),
      !demoMode && renderCryptoPairs(),
      !demoMode && renderDividendDuplicates(),

      // Audit 2026-10-24 feature 7: what's new after an update.
      whatsNew && window.MaerminWhatsNew && React.createElement(window.MaerminWhatsNew.Card, {
        notes: whatsNew, onClose: () => { window.MaerminWhatsNew.markSeen(localStorage, whatsNew.version); setWhatsNew(null); }
      }),

      // Audit 2026-10-24 feature 5: what changed since the last visit day.
      !demoMode && lastVisitDay && !sinceVisitClosed && window.MaerminSinceVisit && window.MaerminSnapshots && (() => {
        const SV = window.MaerminSinceVisit;
        const summary = SV.summarize({ since: lastVisitDay, today: window.MaerminUtils.todayISO(), snapshots: window.MaerminSnapshots, snapshotState: window.MaerminSnapshots.load(), transactions });
        return summary && React.createElement(SV.Card, { summary, masked: privacyMode, formatValue: (v) => formatPrice(v) + ' ' + getCurrencySymbol(), onClose: () => setSinceVisitClosed(true) });
      })(),

      // Recovery-kit nudge for vaults created before recovery codes existed
      showRecoveryNudge && React.createElement('div', { role: 'status', className: ['ui-callout', 'ui-callout--warn', 'ui-dq-fix', 'ui-ov-banner'].join(' ') },
        React.createElement('div', { className: 'ui-dq-fix__text' },
          React.createElement('strong', null, '! ' + __('rcNudgeTitle', 'Add a recovery code')),
          React.createElement('span', { className: 'ui-dq-fix__hint' }, __('rcNudgeBody', 'Your vault has no recovery code. Without one, a forgotten password cannot be reset — generate a printable code now.'))
        ),
        React.createElement(UIC.Button, { variant: 'primary', onClick: createRecoveryKit, loading: recoveryBusy }, recoveryBusy ? __('creating', 'Creating…') : __('rcCreate', 'Create recovery code')),
        React.createElement(UIC.Button, { variant: 'quiet', onClick: dismissRecoveryNudge }, __('dismiss', 'Dismiss'))
      ),

      // First run (R3.4): one card with the three ways in; Import leads to
      // Import / Export (Phase 6 B-6), the paste dialog stays on "i".
      stats.totalPositions === 0 && React.createElement(UIC.Card, { className: 'ui-first-run', 'data-testid': 'first-run' },
        React.createElement('h3', { className: 'ui-first-run__title' }, t.welcomeTitle || 'Welcome to MAERMIN'),
        React.createElement('p', { className: 'ui-muted' }, t.welcomeHint || 'Start by adding your first transaction.'),
        React.createElement('div', { className: 'ui-actions' },
          window.MaerminOnboarding && window.MaerminOnboarding.Wizard && React.createElement(UIC.Button, { variant: 'primary', onClick: openOnboarding }, __('guidedSetup', 'Guided setup')),
          React.createElement(UIC.Button, { onClick: () => openTransactionModal() }, '+ ' + (t.addTransaction || 'Add Transaction')),
          React.createElement(UIC.Button, { onClick: () => setActiveView('data') }, t.importData || 'Import Data')
        )
      ),

      // The sections, in the order set in Customize Overview (P4-7). B-4: the hero
      // and "What it is made of" sit side by side when they follow each other.
      React.createElement('div', { className: 'ui-ov-grid' }, ovOrder.map((id, i) => ovSlot(i))),
      renderPositionModal(),

      // Options book (no new tab): tracked separately from the shared positions
      // engine — buildPositions ignores the 'options' category by design. The
      // panel renders nothing when no option transactions exist.
      // P5-3.9: bonds - terms, manual price, next coupon, accrued interest, yield
      window.MaerminBonds && portfolio && (portfolio.bonds || []).length > 0 &&
        React.createElement('div', { className: 'ui-ov-extra' },
          React.createElement(window.MaerminBonds.Panel, {
            theme: currentTheme, positions: portfolio.bonds, today: window.MaerminUtils.todayISO(),
            formatMoney: (v, cur) => window.MaerminI18n.money(v, cur || 'EUR'), onChange: () => setBondsRev(v => v + 1)
          })
        ),
      window.MaerminOptions && window.MaerminOptions.Panel &&
        React.createElement('div', { className: 'ui-ov-extra' },
          React.createElement(window.MaerminOptions.Panel, {
            transactions: overviewTransactions, prices, exchangeRate,
            theme: currentTheme, t, formatPrice, getCurrencySymbol
          })
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

    const renderContent = () => {
      switch(analyticsTab) {
        case 'correlation': return window.CorrelationMatrixView ?
          // Daily closes on one date grid when at least two holdings have them
          // (available right after an import); else the refresh history.
          React.createElement(window.CorrelationMatrixView, Object.keys(dailyAnalytics.bySymbol).length >= 2
            ? { portfolio, priceHistory: dailyAnalytics.bySymbol, historySource: 'daily', t, theme: currentTheme, formatPrice }
            : Object.keys(dailyAnalytics.partial).length >= 2
              ? { portfolio, priceHistory: dailyAnalytics.partial, historySource: 'partial', t, theme: currentTheme, formatPrice }
              : { portfolio, priceHistory, t, theme: currentTheme, formatPrice })
          : renderAnalyticsPlaceholder(t.correlationMatrix || 'Correlation Matrix');
        case 'montecarlo': return React.createElement(React.Fragment, null,
          window.MonteCarloView
            ? React.createElement(window.MonteCarloView, { portfolio, prices, t, theme: currentTheme, currency, formatPrice })
            : renderAnalyticsPlaceholder(t.monteCarloSimulation || 'Monte Carlo'),
          // Fold in the (already-tested) analytics simulator: Future Value · FIRE
          // · Withdrawal · Monte-Carlo success probability — no new tab.
          window.MaerminSimulatorView && React.createElement(window.MaerminSimulatorView.Panel, {
            startValue: allPortfoliosStats.totalValue, theme: currentTheme, t, formatPrice, currency, getCurrencySymbol
          }),
          // Allocation backtester (what-if): backtest a target allocation
          // against real history vs benchmark presets and the actual portfolio.
          window.MaerminBacktester && React.createElement(window.MaerminBacktester.Panel, {
            portfolio, priceHistory, workerUrl: marketWorker,
            theme: currentTheme, t, formatPrice, getCurrencySymbol
          })
        );
        case 'stress': return window.StressTestView ?
          React.createElement(window.StressTestView, { portfolio, prices, t, theme: currentTheme, currency, formatPrice })
          : renderAnalyticsPlaceholder(t.stressTesting || 'Stress Test');
        case 'risk': return React.createElement(React.Fragment, null,
          window.RiskAnalyticsViewV2
            ? React.createElement(window.RiskAnalyticsViewV2, { portfolio, prices, portfolioValueEUR: portfolioStats.totalValue, transactions: activeTransactions, setActiveView, t, theme: currentTheme, formatPrice, getCurrencySymbol,
                priceHistory: Object.keys(dailyAnalytics.byLower).length ? dailyAnalytics.byLower : priceHistory,
                historySource: Object.keys(dailyAnalytics.byLower).length ? 'daily' : 'refresh', valueSeries: dailyAnalytics.index })
            : renderAnalyticsPlaceholder(t.navRiskCorrelation || 'Risk Analysis'),
          // Rolling volatility/return trajectory + Fama-French factor exposure —
          // folds the analytics engine into Risk (no new tab).
          window.MaerminAnalyticsViews && React.createElement('div', { className: ['ui-view', 'ui-view--cont'].join(' ') },
            React.createElement(window.MaerminAnalyticsViews.RollingRiskPanel, { portfolio, priceHistory, valueSeries: dailyAnalytics.index, theme: currentTheme, t }),
            window.MaerminAnalyticsViews.FactorExposurePanel && React.createElement(window.MaerminAnalyticsViews.FactorExposurePanel, { portfolio, priceHistory, valueSeries: dailyAnalytics.index, workerUrl: marketWorker, theme: currentTheme, t }),
            // ETF look-through, risk slice: fund overlap matrix + hidden
            // concentration findings — folds into Risk (no new tab).
            window.MaerminLookThrough && window.MaerminLookThrough.Panel && React.createElement(window.MaerminLookThrough.Panel, {
              portfolio, prices, workerUrl: marketWorker, mode: 'risk',
              theme: currentTheme, t, formatPrice, getCurrencySymbol
            })
          )
        );
        default: return null;
      }
    };

    // R4.2: the sections on one bar; each section renders its own view frame
    return React.createElement('div', { className: 'ui-risk' },
      React.createElement('div', { className: 'ui-subbar' }, React.createElement(window.MaerminComponents.SectionSwitch, { label: t.navRiskCorrelation || 'Risk & Correlation', value: analyticsTab, onChange: setAnalyticsTab, 'data-testid': 'risk-sections', options: tabs.map(tab => ({ value: tab.id, label: tab.label })) })),
      renderContent()
    );
  };

  // ========== TRANSACTIONS VIEW ==========
  
  // P4-6: what a Data check action does. Only 'move-skins' changes data and it
  // asks first (repairMisfiledSkins); the others open the place to fix it.
  const DC = window.MaerminDataCheck;
  const hasWorker = (marketWorker || '').trim().length > 5;
  const runDataAction = (action) => {
    if (!action) return;
    if (action.type === 'edit-transaction') {
      const tx = transactions.find(x => String(x.id) === String(action.txId));
      if (tx) { editTransaction(tx); return; }
    }
    if (action.type === 'show-transactions' || action.type === 'edit-transaction') {
      const sym = String(action.symbol || '').toLowerCase();
      const tx = sym ? transactions.find(x => String(x.symbol || x.name || '').toLowerCase() === sym) : null;
      if (tx) setActivePortfolioId(tx.portfolioId || 'default');
      setTxSearch(action.symbol || '');
      setActiveView('transactions');
      return;
    }
    if (action.type === 'refresh') { fetchPrices(); return; }
    // P5-3.7: a sync source → the import; a difference → the Reconciliation box
    if (action.type === 'open-import') { setActiveView('broker-import'); return; }
    if (action.type === 'open-reconcile') {
      setActiveView('transactions');
      setTimeout(() => { const el = document.querySelector('[data-testid="reconcile"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
      return;
    }
    if (action.type === 'open-api-settings') { setShowApiSettings(true); return; }
    // P5-1.4: deposits that keep the clearing account at zero, after a confirmation
    if (action.type === 'book-deposits') {
      const L = window.MaerminLedger, c = clearingByPf[action.portfolioId];
      const list = (L && c) ? L.missingDeposits(c) : [];
      if (!list.length) return;
      const total = list.reduce((s, x) => s + x.amount, 0);
      const pf = (portfolios || []).find(p => p.id === action.portfolioId) || {};
      window.MaerminUtils.confirmThen({
        title: __('cashBookTitle', 'Book {n} {n:deposit|deposits}?', { n: list.length }),
        message: __('cashBookMsg', '{n} {n:deposit|deposits} of together {amount} are added to "{name}", each on the day the clearing account would go below zero, so it never does. You can edit or delete them like any transaction.', { n: list.length, amount: window.MaerminI18n.money(total, 'EUR'), name: pf.name || action.portfolioId }),
        confirmLabel: __('dcBookDeposits', 'Book the missing deposits'),
        cancelLabel: t.cancel || 'Cancel',
        danger: false
      }, () => {
        const stamp = Date.now();
        const rows = list.map((x, i) => ({ id: 'dep_' + stamp + '_' + i, type: 'deposit', category: 'cashflow', amount: x.amount, currency: 'EUR', date: x.d, portfolioId: action.portfolioId, notes: __('cashBookNote', 'Added by the data check') }));
        setTransactions(prev => prev.concat(rows));
        addToast(__('cashBooked', '{n} {n:deposit|deposits} booked', { n: rows.length }), 'success');
      });
      return;
    }
    if (action.type === 'move-skins') {
      const T = window.MaerminTickers;
      repairMisfiledSkins(T && T.findMisfiledSkins ? T.findMisfiledSkins(transactions) : []);
    }
  };

  // P5-3.7: health findings next to the ledger's - stale prices, broken
  // transfers, stale or failed syncs, reconciliation differences (reconcile.js).
  const healthIssues = () => {
    const RC = window.MaerminReconcile;
    if (!RC || demoMode) return [];
    try {
      const states = RC.currentStates();
      const src = RC.collect(states);
      const today = window.MaerminUtils.todayISO();
      const Q = window.MaerminDataQuality, meta = Q ? Q.readMeta() : {};
      const priceItems = [];
      // without a Worker every price is "stale" - that is the Worker notice's job, not one finding per holding
      if (hasWorker) ['crypto', 'stocks', 'commodities'].forEach((cls) => {
        (allPortfoliosPortfolio[cls] || []).forEach((p) => {
          const sym = p.symbol;
          const e = meta[sym] || meta[String(sym).toUpperCase()] || meta[String(sym).toLowerCase()] || {};
          const px = window.MaerminMarket && window.MaerminMarket.isCostFallback(sym) ? null : (prices[sym] != null ? prices[sym] : (prices[String(sym).toUpperCase()] != null ? prices[String(sym).toUpperCase()] : prices[String(sym).toLowerCase()]));
          priceItems.push({ symbol: sym, price: px, fetchedAt: e.at || null });
        });
      });
      return RC.health({ transactions, syncs: src.syncs, priceItems,
        cash: RC.cashRows(src.cash, RC.load().links, clearingByPf, today), depots: RC.depotRows(src.depots, transactions), crypto: RC.cryptoRows(states.wallets, transactions) });
    } catch (e) { return []; }
  };

  // Collapsible "Data check" box for ledgerIssues (null when there is none).
  const renderLedgerIssues = () => {
    const ledgerIssues = ledgerIssuesBase.concat(healthIssues());
    if (!ledgerIssues.length) return null;
    const warnings = ledgerIssues.filter(i => i.severity === 'warning').length;
    const line = (i) => {
      const sym = i.symbol || __('issueATx', 'A transaction');
      const eg = i.symbol || __('issueATxLower', 'a transaction');
      if (i.kind === 'price-stale') return i.missing ? __('issuePriceMissing', '{sym}: no price yet - load prices, or check the symbol.', { sym }) : __('issuePriceStale', '{sym}: the price is {n} {n:day|days} old.', { sym, n: i.days });
      if (i.kind === 'transfer-broken') return i.reason === 'missing'
        ? __('issueTransferMissing', 'A transfer of {amount} on {date} has no other half in the other portfolio - book it, or delete this row.', { amount: window.MaerminI18n.money(i.amount, 'EUR'), date: window.MaerminI18n.date(i.date) })
        : __('issueTransferDiffers', 'The two halves of the transfer on {date} do not match (amount, currency, date or direction).', { date: window.MaerminI18n.date(i.date) });
      if (i.kind === 'sync-stale') return __('issueSyncStale', '{source}: last synced {n} {n:day|days} ago.', { source: i.source, n: i.days });
      if (i.kind === 'sync-failed') return __('issueSyncFailed', '{source}: the last sync failed on {date} ({msg}).', { source: i.source, date: i.date ? window.MaerminI18n.date(i.date) : '?', msg: i.message });
      if (i.kind === 'recon-diff') return i.what === 'cash'
        ? __('issueReconCash', '{source}: the bank balance differs from the clearing account by {diff}.', { source: i.source, diff: window.MaerminI18n.money(i.diff, 'EUR') })
        : i.what === 'depot' ? __('issueReconDepot', '{source}: {n} {n:position differs|positions differ} from MAERMIN.', { source: i.source, n: i.count })
        : __('issueReconCrypto', 'Crypto wallets: {n} {n:coin differs|coins differ} from MAERMIN.', { n: i.count });
      if (i.kind === 'cash-negative') return __('issueCashNegative', '{name}: the clearing account goes below zero on {date} (lowest {amount}). Deposits are missing - book them, or set an opening balance.', { name: i.portfolioName, date: window.MaerminI18n.date(i.date), amount: window.MaerminI18n.money(i.balance, 'EUR') });
      if (i.kind === 'oversold') return __('issueOversold', '{sym} ({cat}): {qty} more {qty1:unit|units} sold than bought. The excess has no cost basis and is left out of realised gains - add the missing buy or transfer.', { sym, cat: i.category, qty: window.MaerminI18n.num(i.qty, { min: 0, max: 8 }), qty1: +i.qty.toFixed(8) });
      if (i.kind === 'quantity') return __('issueQuantity', '{sym} ({cat}), {type} on {date}: quantity "{qty}" is not a positive number, so the trade is left out. Edit it (a sell needs a positive quantity).', { sym, cat: i.category, type: i.type, date: i.date ? window.MaerminI18n.date(i.date) : __('unknownDate', 'an unknown date'), qty: i.qty });
      if (i.status === 'unknown') return __('issueNoRate', '{sym} in {cur}: no exchange rate, so the amounts are counted as EUR. Change the transaction currency.', { sym, cur: i.currency });
      if (/^(USD|USDT|USDC|BUSD|FDUSD|TUSD|USDP|DAI)$/i.test(String(i.currency))) return __('issueUsdNearest', '{cur} (e.g. {eg}): no stored USD rate for the trade date, so the nearest stored rate is used. Add a Worker URL in API Settings to load the daily history.', { cur: i.currency, eg });
      return (window.MaerminFxHistory && window.MaerminFxHistory.hasHistory && window.MaerminFxHistory.hasHistory(i.currency))
        ? __('issueNoDayRate', "{cur} (e.g. {eg}): no {cur} rate for the trade date (not loaded through the Worker yet, or the rate history does not reach that date) - today's rate is used.", { cur: i.currency, eg })
        : __('issueTodayOnly', "{cur} (e.g. {eg}): converted at today's rate for every date - there is no daily history for this currency.", { cur: i.currency, eg });
    };
    // R4.6: a callout (warning tone when a finding affects cost basis or tax), quiet action buttons
    return React.createElement('details', {
      'data-testid': 'ledger-issues', className: ['ui-callout', 'ui-dq-issues', warnings ? 'ui-callout--warn' : ''].join(' ').trim()
    },
      React.createElement('summary', { className: 'ui-dq-issues__summary' },
        __('issueSummary', 'Data check: {n} {n:issue|issues}', { n: ledgerIssues.length }) + (warnings ? ' ' + __('issueSummaryWarn', '({n} affect cost basis or tax)', { n: warnings }) : '')),
      React.createElement('ul', { className: 'ui-dq-issues__list' },
        ledgerIssues.slice(0, 20).map((i, k) => {
          // P4-6: stable code + one action per finding
          const c = DC ? DC.classify(i, { hasWorker, hasHistory: (cur) => !!(window.MaerminFxHistory && window.MaerminFxHistory.hasHistory && window.MaerminFxHistory.hasHistory(cur)) }) : null;
          return React.createElement('li', { key: k, 'data-dq-code': c ? c.code : undefined }, line(i),
            c && React.createElement('span', { className: 'ui-dq-issues__act' },
              React.createElement('code', null, c.code),
              React.createElement(window.MaerminComponents.Button, { size: 'sm', variant: 'quiet', 'data-dq-action': c.action.type, 'aria-label': DC.actionLabel(c.action) || c.code, onClick: () => runDataAction(c.action) },
                DC.actionLabel(c.action))));
        }),
        ledgerIssues.length > 20 && React.createElement('li', { key: 'more' }, __('andNMore', '… and {n} more', { n: ledgerIssues.length - 20 }))));
  };

  // CS2 skins filed as stocks (an import that did not know them): they get no
  // price, and every refresh sent them to the stock routes, which 404ed and
  // ran the Worker into its rate limit - skin prices then failed too. One
  // click moves them to CS2 Skins, with the exact market names when the Worker
  // can look them up (imports upper-cased them).
  const repairMisfiledSkins = async (found) => {
    const T = window.MaerminTickers;
    if (!T || !found.length || skinRepairBusy) return;
    const count = found.reduce((s, f) => s + f.count, 0);
    // P4-6: data-changing actions confirm through MaerminUtils.confirmThen
    const ok = await window.MaerminUtils.confirmThen({
      title: __('skinMoveTitle', 'Move {n} {n:item|items} to CS2 Skins?', { n: found.length }),
      message: __('skinMoveMsg', '{count} {count:transaction|transactions} of {list} are filed as {cat} but are CS2 items. They will be moved to CS2 Skins so they get CS2 skin prices (Steam Market list). Quantities, prices and dates stay as they are.', { count, list: found.slice(0, 4).map(f => f.symbol).join(', ') + (found.length > 4 ? ' ' + __('andNMoreShort', 'and {n} more', { n: found.length - 4 }) : ''), cat: found[0].category === 'crypto' ? (t.crypto || 'Crypto') : (t.stocks || 'Stocks') }),
      confirmLabel: __('skinMoveBtn', 'Move to CS2 Skins'),
      cancelLabel: t.cancel || 'Cancel',
      danger: false
    }, () => {});
    if (!ok) return;
    setSkinRepairBusy(true);
    const nameMap = {};
    const base = (marketWorker || '').trim().replace(/\/$/, '');
    if (base.length > 5) {
      // Exact names from the skin price list (one request for every item).
      const SKP = window.MaerminSkinPrices;
      const idx = SKP ? await SKP.load(base) : null;
      if (idx) found.forEach(f => {
        const e = idx.byLower[T.normalizeSkinName(f.symbol).toLowerCase()] || idx.byLower[String(f.symbol).toLowerCase()];
        if (e) nameMap[f.symbol] = e.name;
      });
    }
    let moved = 0;
    setTransactions(prev => { const res = T.repairMisfiledSkins(prev, nameMap); moved = res.moved; return res.transactions; });
    setSkinRepairBusy(false);
    const named = Object.keys(nameMap).length;
    addToast(__('skinMoved', '{n} {n:item|items} moved to CS2 Skins', { n: found.length }) + (base.length > 5 ? ' · ' + __('skinMatched', '{named}/{n} matched to their market name', { named, n: found.length }) : '') + ' - ' + __('skinRefreshToLoad', 'refresh prices to load them'), 'success', 8000);
  };

  const renderMisfiledSkins = () => {
    const T = window.MaerminTickers;
    if (!T || !T.findMisfiledSkins) return null;
    const found = T.findMisfiledSkins(transactions);
    if (!found.length) return null;
    return React.createElement('div', {
      role: 'status', 'data-testid': 'misfiled-skins', 'data-dq-code': DC ? DC.CODES.skinMisfiled : undefined,
      className: ['ui-callout', 'ui-callout--warn', 'ui-dq-fix'].join(' ')
    },
      React.createElement('div', { className: 'ui-dq-fix__text' },
        DC && React.createElement('code', null, DC.CODES.skinMisfiled),
        React.createElement('strong', null, __('skinMisfiled', '{n} CS2 {n:item is|items are} filed as {cat}', { n: found.length, cat: found.some(f => f.category === 'stocks') ? (t.stocks || 'Stocks') : (t.crypto || 'Crypto') })),
        React.createElement('span', { className: 'ui-dq-fix__hint' },
          `${found.slice(0, 3).map(f => f.symbol).join(', ')}${found.length > 3 ? ' …' : ''} - ${__('skinMisfiledHint', 'they get no price there. Move them to CS2 Skins to get their skin prices.')}`)),
      React.createElement(window.MaerminComponents.Button, { variant: 'primary', onClick: () => repairMisfiledSkins(found), loading: skinRepairBusy },
        skinRepairBusy ? __('skinLookingUp', 'Looking up market names…') : __('skinMoveBtn', 'Move to CS2 Skins')));
  };

  // DQ-CRYPTO-PAIR: crypto rows imported with the exchange pair as symbol
  // (before the 2026-10 import fix, AUDIT BUG-013) never get a price.
  const renderCryptoPairs = () => {
    const found = DC && DC.cryptoPairs ? DC.cryptoPairs(transactions) : [];
    if (!found.length) return null;
    return React.createElement('div', {
      role: 'status', 'data-testid': 'crypto-pairs', 'data-dq-code': DC.CODES.cryptoPair,
      className: ['ui-callout', 'ui-callout--warn', 'ui-dq-fix'].join(' ')
    },
      React.createElement('div', { className: 'ui-dq-fix__text' },
        React.createElement('code', null, DC.CODES.cryptoPair),
        React.createElement('strong', null, __('dqCryptoPair', '{n} crypto {n:symbol is|symbols are} an exchange pair', { n: found.length })),
        React.createElement('span', { className: 'ui-dq-fix__hint' },
          `${found.slice(0, 3).map(f => f.symbol).join(', ')}${found.length > 3 ? ' …' : ''} - ${__('dqCryptoPairHint', 'they get no price. Edit each row: the coin as symbol (e.g. BTC) and the quote as currency (USDT/USDC count as USD).')}`)),
      React.createElement(window.MaerminComponents.Button, { variant: 'primary', onClick: () => setTxSearch(found[0].symbol) }, __('dcShowTx', 'Show transactions')));
  };

  // DQ-DIV-DUPLICATE: one payout auto-booked twice under two dates (before the
  // audit 2026-10-24 BUG-2 fix). Shown for the user to check; nothing is deleted.
  const renderDividendDuplicates = () => {
    const found = DC && DC.dividendDuplicates ? DC.dividendDuplicates(transactions) : [];
    if (!found.length) return null;
    return React.createElement('div', {
      role: 'status', 'data-testid': 'div-duplicates', 'data-dq-code': DC.CODES.divDuplicate,
      className: ['ui-callout', 'ui-callout--warn', 'ui-dq-fix'].join(' ')
    },
      React.createElement('div', { className: 'ui-dq-fix__text' },
        React.createElement('code', null, DC.CODES.divDuplicate),
        React.createElement('strong', null, __('dqDivDuplicate', '{n} {n:holding has|holdings have} dividends that may be booked twice', { n: found.length })),
        React.createElement('span', { className: 'ui-dq-fix__hint' },
          `${found.slice(0, 3).map(f => f.symbol).join(', ')}${found.length > 3 ? ' …' : ''} - ${__('dqDivDuplicateHint', 'automatic dividend booking may have booked the same payout under two dates. Check the rows and delete the extra one.')}`)),
      React.createElement(window.MaerminComponents.Button, { variant: 'primary', onClick: () => setTxSearch(found[0].symbol) }, __('dcShowTx', 'Show transactions')));
  };

  const renderTransactionsView = () => {
    // Filter by active portfolio first, then by search
    const filtered = transactions.filter(tx => {
      const portfolioMatch = isAllActive || (tx.portfolioId || 'default') === activePortfolioId;
      if (!portfolioMatch) return false;
      if (!txSearch.trim()) return true;
      const q = txSearch.toLowerCase();
      return (tx.symbol || '').toLowerCase().includes(q) ||
             (tx.category || '').toLowerCase().includes(q) ||
             (tx.type || '').toLowerCase().includes(q) ||
             (tx.notes || '').toLowerCase().includes(q) ||
             (tx.symbolName || '').toLowerCase().includes(q);
    });
    const totalAll = activeTransactions.length;

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      switch (txSortBy) {
        case 'date-asc':  return new Date(a.date) - new Date(b.date);
        case 'date-desc': return new Date(b.date) - new Date(a.date);
        case 'amount-desc': { const v = (x) => isCashRow(x) ? (parseFloat(x.amount) || 0) : (parseFloat(x.quantity) || 0) * (parseFloat(x.price) || 0); return v(b) - v(a); }
        case 'symbol': return (a.symbol || '').localeCompare(b.symbol || '');
        default: return new Date(b.date) - new Date(a.date);
      }
    });

    // R3.3 (Phase 6 B-5): type chips, a month-grouped list and one detail
    // panel (beside the list on wide screens, a sheet / dialog below 1100 px)
    // instead of edit and delete buttons in every row.
    const UIC = window.MaerminComponents, I = window.MaerminI18n;
    const GROUPS = [
      { id: 'all', label: __('txChipAll', 'All'), test: () => true },
      { id: 'buy', label: __('txChipBuys', 'Buys'), test: (tx) => tx.type === 'buy' },
      { id: 'sell', label: __('txChipSales', 'Sales'), test: (tx) => tx.type === 'sell' },
      { id: 'income', label: __('txChipIncome', 'Income'), test: (tx) => tx.type === 'dividend' || tx.type === 'interest' },
      { id: 'cash', label: __('txChipCash', 'Cash'), test: (tx) => isCashRow(tx) },
      { id: 'other', label: __('txChipOther', 'Other'), test: (tx) => !['buy', 'sell', 'dividend', 'interest'].includes(tx.type) && !isCashRow(tx) }
    ];
    const counts = {};
    GROUPS.forEach((g) => { counts[g.id] = filtered.filter(g.test).length; });
    const group = GROUPS.find((g) => g.id === txType) || GROUPS[0];
    const shown = sorted.filter(group.test);
    const byDate = txSortBy === 'date-desc' || txSortBy === 'date-asc';
    const rows = [];
    let lastMonth = null;
    shown.forEach((tx) => {
      const m = String(tx.date || '').slice(0, 7);
      if (byDate && m !== lastMonth) {
        const n = shown.filter((x) => String(x.date || '').slice(0, 7) === m).length;
        rows.push({ __group: /^\d{4}-\d{2}$/.test(m) ? I.date(m + '-01', 'monthLong') : (m || '—'), __summary: __('txMonthCount', '{n} {n:booking|bookings}', { n }) });
        lastMonth = m;
      }
      rows.push(tx);
    });
    const pfName = (tx) => ((portfolios.find(p => p.id === (tx.portfolioId || 'default')) || {}).name) || tx.portfolioId || 'default';
    const typeBadge = (tx) => {
      const info = window.MaerminUtils.txTypeInfo(tx.type, t);
      return React.createElement('span', { className: 'ui-txtype', 'data-tone': info.tone }, info.label);
    };
    const assetName = (tx) => isCashRow(tx)
      ? (tx.counterPortfolioId ? (tx.type === 'transfer_out' ? '→ ' : '← ') + portfolioName(tx.counterPortfolioId) : (tx.notes || window.MaerminUtils.txTypeInfo(tx.type, t).label))
      : (tx.symbolName && tx.symbolName !== tx.symbol ? tx.symbolName : tx.symbol);
    const totalText = (tx) => privacyMode ? '••••••' : (isCashRow(tx)
      ? (window.MaerminLedger.CASH_TYPES[tx.type].sign > 0 ? '+' : '−') + I.num(parseFloat(tx.amount) || 0, 2)
      : I.num(tx.quantity * tx.price, 2)) + ' ' + (tx.currency || 'EUR');
    const cols = [
      { key: 'date', label: t.date || 'Date', phone: 'meta', render: (tx) => React.createElement(React.Fragment, null,
          React.createElement('span', { className: 'num' }, I.date(tx.date)),
          // "All portfolios": every row names the portfolio it is booked in
          isAllActive && React.createElement('span', { className: 'ui-cell-note', 'data-testid': 'tx-portfolio-name' }, pfName(tx))) },
      { key: 'type', label: t.transactionType || 'Type', phone: 'meta', render: typeBadge },
      { key: 'asset', label: t.symbol || 'Symbol', phone: 'title', render: (tx) => React.createElement('span', { className: 'ui-asset__text' },
          React.createElement('span', { className: 'ui-asset__name' }, assetName(tx)),
          React.createElement('span', { className: 'ui-asset__sub' }, isCashRow(tx) ? I.category('cashflow') : [tx.symbolName && tx.symbolName !== tx.symbol ? tx.symbol : null, getCategoryDisplayName(tx.category)].filter(Boolean).join(' · '))) },
      { key: 'qty', label: t.quantity || 'Qty', align: 'right', priority: 2, render: (tx) => isCashRow(tx) ? '' : I.num(parseFloat(tx.quantity) || 0, 4) },
      { key: 'price', label: t.price || 'Price', align: 'right', priority: 3, render: (tx) => !isCashRow(tx) && tx.price != null ? (privacyMode ? '••••••' : I.num(tx.price, 2)) : '' },
      { key: 'total', label: t.total || 'Total', align: 'right', phone: 'value', render: (tx) => React.createElement('span', { className: 'ui-txtotal' }, totalText(tx)) }
    ];
    const selectedTx = txSelected ? transactions.find((x) => x.id === txSelected) : null;
    const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1100px)').matches : true;
    const rowLabel = (tx) => `${window.MaerminUtils.txTypeInfo(tx.type, t).label} ${tx.symbolName || tx.symbol || (isCashRow(tx) ? assetName(tx) : '')}, ${String(tx.date || '').slice(0, 10)}`;

    return React.createElement('div', { className: 'ui-view ui-tx' },
      renderMisfiledSkins(),
      renderCryptoPairs(),
      renderDividendDuplicates(),
      renderLedgerIssues(),
      // P5-3.7: what banks, depots and wallets report vs MAERMIN
      window.MaerminReconcile && !demoMode && React.createElement(window.MaerminReconcile.Panel, {
        theme: currentTheme, transactions, portfolios, clearingByPf, onOpenImport: () => setActiveView('broker-import')
      }),
      // Toolbar: count, search, sort; Add Transaction is the page header's action
      React.createElement('div', { className: 'ui-view__bar' },
        React.createElement('p', { className: 'ui-view__lead', 'data-testid': 'tx-count' },
          `${t.transactions || 'Transactions'} (${filtered.length}${filtered.length !== totalAll ? '/' + totalAll : ''})`),
        React.createElement('div', { className: 'ui-tx__tools' },
          React.createElement('input', {
            type: 'search', value: txSearch, onChange: e => setTxSearch(e.target.value),
            placeholder: t.search || 'Search...', 'aria-label': t.search || 'Search...', className: ['ui-input', 'ui-tx__search'].join(' ')
          }),
          React.createElement('select', {
            value: txSortBy, 'aria-label': __('txSortLabel', 'Sort transactions'), onChange: e => setTxSortBy(e.target.value), className: ['ui-input', 'ui-select'].join(' ')
          },
            React.createElement('option', { value: 'date-desc' }, t.newestFirst || 'Newest first'),
            React.createElement('option', { value: 'date-asc'  }, t.oldestFirst || 'Oldest first'),
            React.createElement('option', { value: 'amount-desc'}, t.largestFirst || 'Largest first'),
            React.createElement('option', { value: 'symbol'    }, t.bySymbol || 'By symbol')
          )
        )
      ),
      // B-5: type filter chips with counts (filters, never tabs)
      React.createElement('div', { className: 'ui-chips', role: 'group', 'aria-label': __('txChipsLabel', 'Show bookings of type') },
        GROUPS.filter((g) => g.id === 'all' || counts[g.id] > 0 || txType === g.id).map((g) => React.createElement(UIC.Chip, {
          key: g.id, pressed: txType === g.id, count: counts[g.id], 'data-tx-chip': g.id, onClick: () => setTxType(g.id)
        }, g.label))
      ),
      React.createElement('div', { className: ['ui-tx__layout', selectedTx && wide ? 'has-detail' : ''].join(' ').trim() },
        React.createElement(UIC.Card, { variant: 'plain', className: 'ui-tx__list' },
          React.createElement(UIC.Table, {
            'data-testid': 'tx-table', caption: t.transactions || 'Transactions', columns: cols, rows,
            rowKey: (tx) => tx.id,
            rowProps: (tx) => Object.assign({
              'data-tx-id': tx.id, 'aria-label': rowLabel(tx)
            }, txSelected === tx.id ? { 'aria-current': 'true', className: ['is-clickable', 'is-selected'].join(' ') } : null, window.MaerminUtils.clickable(() => setTxSelected(txSelected === tx.id && wide ? null : tx.id))),
            empty: React.createElement('div', { className: 'ui-pad' },
              React.createElement(UIC.EmptyState, {
                title: txSearch || txType !== 'all' ? (t.noResults || 'No results for your search.') : (t.noTransactions || 'No transactions yet.'),
                text: txSearch || txType !== 'all' ? __('txNoMatchHint', 'Clear the search or choose another type.') : __('txEmptyHint', 'Add your first booking or import a broker export.'),
                kind: 'empty'
              }))
          })
        ),
        selectedTx && wide && React.createElement('aside', { className: 'ui-tx__detail', 'aria-label': __('txDetailTitle', 'Booking') }, renderTxDetail(selectedTx, { pfName, typeBadge, assetName, totalText }))
      ),
      selectedTx && !wide && React.createElement(UIC.Modal, {
        open: true, title: assetName(selectedTx) || __('txDetailTitle', 'Booking'), onClose: () => setTxSelected(null), 'data-testid': 'tx-detail-sheet'
      }, renderTxDetail(selectedTx, { pfName, typeBadge, assetName, totalText, inSheet: true }))
    );
  };

  // R3.3 (B-5): one booking - the record, its FIFO effect for a sale, the
  // tax bookings of the same day, and Edit / Duplicate / Move to trash.
  const renderTxDetail = (tx, h) => {
    const UIC = window.MaerminComponents, I = window.MaerminI18n;
    const money = (v, cur) => privacyMode ? '••••••' : I.num(v, 2) + ' ' + (cur || 'EUR');
    const fact = (label, value, extra) => value === '' || value == null ? null : React.createElement('div', Object.assign({ className: 'ui-facts__row' }, extra || {}),
      React.createElement('dt', null, label), React.createElement('dd', { className: 'num' }, value));
    const cash = isCashRow(tx);
    // FIFO effect of a sale: the lots it took (MaerminLedger, same as the tax report)
    let fifo = null;
    if (tx.type === 'sell' && window.MaerminLedger) {
      const built = memoBy('txFifo', [transactions, exchangeRate, fxAt, corpActionsRev], () => {
        try { return window.MaerminLedger.build(transactions, { exchangeRate, fxAt, perPortfolio: true }); } catch (e) { return null; }
      });
      const ds = [];
      if (built) built.list.forEach((g) => (g.disposals || []).forEach((d) => { if (d.disposalTxId === tx.id) ds.push(d); }));
      if (ds.length) {
        fifo = { lots: ds.length, cost: ds.reduce((s, d) => s + d.costBasis, 0), proceeds: ds.reduce((s, d) => s + d.proceeds, 0), gain: ds.reduce((s, d) => s + d.gain, 0),
          from: ds.map((d) => d.acquisitionDate).sort()[0], longTerm: ds.every((d) => d.longTerm) };
      }
    }
    const sameDayTax = transactions.filter((x) => x.id !== tx.id && (x.type === 'tax' || x.type === 'tax_refund') && String(x.date || '').slice(0, 10) === String(tx.date || '').slice(0, 10) && (x.portfolioId || 'default') === (tx.portfolioId || 'default'));
    const trash = () => window.MaerminUI.confirm({
      title: t.confirmDelete || 'Delete this transaction?',
      message: __('txTrashMsg', 'It goes to the trash for 30 days; Undo brings it back right away.'),
      confirmLabel: t.delete || 'Delete', cancelLabel: t.cancel || 'Cancel', danger: true
    }).then((yes) => { if (yes) { deleteTransaction(tx.id); setTxSelected(null); } });
    return React.createElement('div', { className: ['ui-txd', h.inSheet ? 'is-sheet' : ''].join(' ').trim(), 'data-testid': 'tx-detail' },
      !h.inSheet && React.createElement('div', { className: 'ui-txd__head' },
        h.typeBadge(tx),
        React.createElement('h2', { className: 'ui-txd__title' }, h.assetName(tx)),
        React.createElement(UIC.IconButton, { size: 'sm', label: __('uiClose', 'Close'), onClick: () => setTxSelected(null), icon: React.createElement('span', { 'aria-hidden': 'true' }, '×') })),
      h.inSheet && React.createElement('div', { className: 'ui-txd__head' }, h.typeBadge(tx)),
      React.createElement('div', { className: ['ui-txd__total', 'num'].join(' ') }, h.totalText(tx)),
      React.createElement('dl', { className: 'ui-facts' },
        fact(t.date || 'Date', I.date(tx.date)),
        fact(__('portfolio', 'Portfolio'), h.pfName(tx)),
        !cash && fact(t.symbol || 'Symbol', tx.symbol),
        !cash && fact(__('category', 'Category'), getCategoryDisplayName(tx.category)),
        !cash && fact(t.quantity || 'Qty', I.num(parseFloat(tx.quantity) || 0, 4)),
        !cash && tx.price != null && fact(t.price || 'Price', money(parseFloat(tx.price) || 0, tx.currency)),
        parseFloat(tx.fees) > 0 && fact(__('fees', 'Fees'), money(parseFloat(tx.fees), tx.currency)),
        parseFloat(tx.withholdingTax) > 0 && fact(__('withholdingTax', 'Withholding tax'), money(parseFloat(tx.withholdingTax), tx.currency)),
        tx.notes && !cash && fact(__('notes', 'Notes'), tx.notes)
      ),
      fifo && React.createElement('section', { className: 'ui-txd__block', 'data-testid': 'tx-fifo' },
        React.createElement('h3', null, __('txFifoTitle', 'FIFO effect of this sale')),
        React.createElement('dl', { className: 'ui-facts' },
          fact(__('txFifoLots', 'Lots used'), String(fifo.lots) + (fifo.from ? ' · ' + __('txFifoFrom', 'oldest from {date}', { date: I.date(fifo.from) }) : '')),
          fact(__('colDisposedCost', 'Cost basis sold'), money(fifo.cost)),
          fact(__('colProceeds', 'Proceeds'), money(fifo.proceeds)),
          fact(__('colRealizedPnl', 'Realised P&L'), React.createElement('span', { className: fifo.gain > 0 ? 'tone-gain' : fifo.gain < 0 ? 'tone-loss' : '' }, (fifo.gain > 0 ? '▲ +' : fifo.gain < 0 ? '▼ ' : '') + money(fifo.gain))),
          fifo.longTerm && fact(__('txFifoHeld', 'Holding period'), __('txFifoLong', 'over one year for every lot'))
        )),
      sameDayTax.length > 0 && React.createElement('section', { className: 'ui-txd__block', 'data-testid': 'tx-tax-same-day' },
        React.createElement('h3', null, __('txSameDayTax', 'Tax bookings on the same day')),
        React.createElement('ul', { className: 'ui-txd__list' }, sameDayTax.map((x) => React.createElement('li', { key: x.id },
          React.createElement('button', { type: 'button', className: 'ui-link', onClick: () => setTxSelected(x.id) }, window.MaerminUtils.txTypeInfo(x.type, t).label + (x.notes ? ' · ' + x.notes : '')),
          React.createElement('span', { className: 'num' }, h.totalText(x)))))),
      React.createElement('div', { className: 'ui-txd__actions' },
        React.createElement(UIC.Button, { variant: 'primary', 'data-tx-action': 'edit', onClick: () => editTransaction(tx) }, t.edit || 'Edit'),
        React.createElement(UIC.Button, { 'data-tx-action': 'duplicate', onClick: () => duplicateTransaction(tx) }, __('txDuplicate', 'Duplicate')),
        React.createElement(UIC.Button, { variant: 'danger', 'data-tx-action': 'trash', onClick: trash }, __('txTrash', 'Move to trash')))
    );
  };


  // ========== TAX VIEW ==========
  
  // R3.6: one memoised tax report per year, read by the Tax summary (B-7) and
  // the Report tab, so the two can never disagree.
  const getTaxReport = (currentYear) => {
    // Build the filing-grade report ONCE and derive the on-screen KPIs from it,
    // so the screen and the PDF/Excel export can never disagree (the KPIs used
    // to come from the legacy engine: no FX, crypto taxed like capital income).
    const buildReport = () => window.MaerminTaxReport && window.MaerminTaxReport.build(transactions, {
      year: currentYear, jurisdiction: taxJurisdiction, baseCurrency: 'EUR',
      exchangeRate, fxAt, owner: taxOwner, portfolio, prices,
      // M-15: portfolios marked as a separate depot (the demo's own list in demo mode)
      portfolios: (portfolioHook && portfolioHook.portfolios) || undefined
    });
    // Memoised: the report (FIFO over every transaction + German detail) used
    // to be rebuilt on EVERY render of the app. Besides the props it reads a
    // few stores directly, so their raw strings are part of the key - saving a
    // fund type, a Vorabpauschale record or a tax setting still rebuilds it.
    const storeKey = ['maermin_fund_types', 'maermin_vap_records', 'maermin_basiszins_overrides', 'maermin_kirchensteuer',
      'maermin_tax_settings', 'maermin_tax_overrides', 'maermin_divevents', 'maermin_corporate_actions', 'maermin_corporate_events', 'maermin_fx_usd_rates', 'maermin_loss_carry', 'maermin_at_funds', 'maermin_ch_settings']
      .map(k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }).join('\u0001');
    let taxReport = null;
    try {
      taxReport = memoBy('taxReport', [transactions, currentYear, taxJurisdiction, exchangeRate, fxAt, taxOwner, portfolio, prices, taxSettingsRev, storeKey, portfolioHook && portfolioHook.portfolios], buildReport);
    } catch (e) { console.warn('[TAX] report build failed:', e); }
    return taxReport;
  };

  const renderTaxView = () => {
    const currentYear = taxYear;

    let taxReport = getTaxReport(currentYear);
    const taxData = (window.MaerminTaxReport && window.MaerminTaxReport.kpis)
      ? window.MaerminTaxReport.kpis(taxReport)
      : { realizedGains: 0, shortTerm: 0, longTerm: 0, taxLiability: 0 };

    // Years that have any transaction, newest first (plus the current year).
    const availableYears = (() => {
      const set = new Set([new Date().getFullYear()]);
      transactions.forEach(tx => { if (tx.date) set.add(new Date(tx.date).getFullYear()); });
      return Array.from(set).filter(y => y > 1990 && y < 2100).sort((a, b) => b - a);
    })();

    // R4.6: the view layout, year / rules / exports on the shared Select and Button, taxpayer fields, Stat tiles
    const UIC = window.MaerminComponents;
    const h = React.createElement;
    const sym = getCurrencySymbol();

    return h('div', { className: ['ui-view', 'ui-view--cont', 'ui-tax-report'].join(' ') },
      renderMisfiledSkins(),
      renderCryptoPairs(),
      renderDividendDuplicates(),
      renderLedgerIssues(),
      h('div', { className: 'ui-tax-report__bar' },
        h(UIC.Select, { label: t.taxYear || 'Tax Year', value: currentYear, onChange: (e) => setTaxYear(parseInt(e.target.value, 10)),
          options: availableYears.map(y => ({ value: y, label: String(y) })) }),
        h(UIC.Select, { label: __('taxRulesLabel', 'Tax rules'), value: taxJurisdiction, onChange: (e) => setTaxJurisdiction(e.target.value),
          options: [{ value: 'de', label: t.germany || 'Germany' }, { value: 'at', label: __('austria', 'Austria') }, { value: 'ch', label: __('switzerland', 'Switzerland') }, { value: 'us', label: t.usa || 'USA' }] }),
        h(UIC.Input, { label: __('taxpayerNamePh', 'Taxpayer name (optional)'), value: taxOwner.name || '', fieldClassName: 'ui-tax-report__owner',
          onChange: (e) => setTaxOwner(o => ({ ...o, name: e.target.value })) }),
        h(UIC.Input, { label: __('taxIdPh', 'Tax ID (optional)'), value: taxOwner.taxId || '', fieldClassName: 'ui-tax-report__owner',
          onChange: (e) => setTaxOwner(o => ({ ...o, taxId: e.target.value })) }),
        window.MaerminTaxReport && h('div', { className: 'ui-tax-report__exports' },
          h(UIC.Button, { variant: 'primary', onClick: () => { const r = getTaxReport(currentYear); if (r) window.MaerminTaxReport.exportPDF(r); } }, t.exportPdf || 'Export PDF'),
          h(UIC.Button, { onClick: () => { const r = getTaxReport(currentYear); if (r) window.MaerminTaxReport.exportExcel(r); } }, t.exportExcel || 'Export Excel'))),

      // Tax stats (the taxpayer details above appear on the exported report)
      h('div', { className: 'ui-tiles' },
        h(UIC.Stat, { className: 'ui-tile', label: t.realizedGains || 'Realised gains', value: `${formatPrice(taxData.realizedGains)} ${sym}` }),
        h(UIC.Stat, { className: 'ui-tile', label: (taxData.labels && taxData.labels.shortTerm) || t.shortTermGains || 'Short-term', value: `${formatPrice(taxData.shortTerm || 0)} ${sym}` }),
        h(UIC.Stat, { className: 'ui-tile', label: (taxData.labels && taxData.labels.longTerm) || t.longTermGains || 'Long-term', value: `${formatPrice(taxData.longTerm || 0)} ${sym}` }),
        h(UIC.Stat, { className: 'ui-tile', label: t.taxLiability || 'Est. Tax', value: `${formatPrice(taxData.taxLiability || 0)} ${sym}`, tone: taxData.taxLiability > 0 ? 'warning' : null })),

      // Tax advisor (WI-3): forward-looking crypto Freigrenze countdown +
      // Sparerpauschbetrag headroom + loss-harvesting findings. Estimate only.
      taxJurisdiction === 'de' && window.MaerminTaxAdvisor && window.MaerminTaxAdvisor.Panel &&
        React.createElement(window.MaerminTaxAdvisor.Panel, {
          transactions, prices, exchangeRate, fxAt, taxOwner, privacyMode,
          ...(() => {
            // Feed the advisor the three German loss pots from the SAME report
            // the KPIs use: direct shares, funds + other capital income, and
            // sec. 23 private sales. Funds are identified by the user's fund-
            // type classification or the X-Ray fund heuristic.
            const GT = window.TaxCalculationEngine && window.TaxCalculationEngine.GermanTax;
            const fundTypes = (GT && GT.loadFundTypes) ? GT.loadFundTypes() : {};
            const LT = window.MaerminLookThrough;
            const isFund = (sym, name) => {
              const S = String(sym || '').toUpperCase();
              if (fundTypes[S] && fundTypes[S] !== 'none') return true;
              return !!(LT && LT.isFundCandidate && LT.isFundCandidate(S, name));
            };
            const book = allPortfoliosPortfolio || portfolio;
            const positions = ((book && book.stocks) || []).map((p) => {
              const sym = p.symbol || p.name || '';
              const px = prices[sym] || prices[String(sym).toLowerCase()] || prices[String(sym).toUpperCase()] || 0;
              const amount = parseFloat(p.amount) || 0;
              return { symbol: sym, category: 'stocks', isFund: isFund(sym, p.name),
                costBasisEUR: amount * (parseFloat(p.purchasePrice) || 0), currentValueEUR: px > 0 ? amount * px : amount * (parseFloat(p.purchasePrice) || 0) };
            });
            // Pots + the Sparerpauschbetrag (limit and usage) the report applied.
            return { positions, taxData: window.MaerminTaxAdvisor.taxDataFromReport(taxReport, isFund) };
          })(),
          theme: currentTheme, t, formatPrice, getCurrencySymbol
        }),

      // German fund taxation fold-in (no new tab): Vorabpauschale per
      // accumulating fund + Teilfreistellung classification + the statutory
      // ordered computation. Only relevant for the German jurisdiction.
      taxJurisdiction === 'de' && window.MaerminGermanTaxView && window.MaerminGermanTaxView.Panel &&
        React.createElement(window.MaerminGermanTaxView.Panel, {
          transactions, portfolio, prices, priceHistory, year: currentYear, exchangeRate, fxAt,
          theme: currentTheme, t, formatPrice, getCurrencySymbol,
          onChange: () => setTaxSettingsRev(r => r + 1)
        }),
      // P5-4.1: loss carry-forward per pot, from the same report, with the
      // opening balances from the last assessment and a per-portfolio view.
      taxJurisdiction === 'de' && window.MaerminLossCarry && React.createElement(window.MaerminLossCarry.Panel, {
        theme: currentTheme, report: taxReport, transactions, portfolios, year: currentYear, exchangeRate, fxAt,
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR'),
        onChange: () => setTaxSettingsRev(r => r + 1)
      }),
      // P5-4.3: the Vorabpauschale expected for the coming January and the
      // cash needed on the clearing account.
      taxJurisdiction === 'de' && window.MaerminVapForecast && React.createElement(window.MaerminVapForecast.Panel, {
        theme: currentTheme, transactions, prices, priceHistory, exchangeRate, portfolios, rev: taxSettingsRev,
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR')
      }),
      // P5-4.4: December plan - sell and buy back to use the rest of the
      // Sparerpauschbetrag, checked through the same report.
      taxJurisdiction === 'de' && window.MaerminHarvest && React.createElement(window.MaerminHarvest.Panel, {
        theme: currentTheme, transactions, prices, exchangeRate, fxAt, portfolios, rev: taxSettingsRev,
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR')
      }),
      // P5-4.5: per coin what is tax-free today and in 1-12 months.
      taxJurisdiction === 'de' && window.MaerminCryptoCalendar && React.createElement(window.MaerminCryptoCalendar.Panel, {
        theme: currentTheme, transactions, prices, exchangeRate, fxAt, rev: taxSettingsRev,
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR')
      }),
      // P5-4.6: cost basis and gains under FIFO, LIFO, HIFO and average cost.
      taxJurisdiction === 'de' && window.MaerminCostMethods && React.createElement(window.MaerminCostMethods.Panel, {
        theme: currentTheme, transactions, prices, exchangeRate, fxAt, year: currentYear, portfolios, rev: taxSettingsRev,
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR')
      }),
      // P5-4.2: "if I sell X": lots, gain and the extra tax through the same report.
      taxJurisdiction === 'de' && window.MaerminSellSim && React.createElement(window.MaerminSellSim.Panel, {
        theme: currentTheme, transactions, prices, exchangeRate, fxAt, portfolios, rev: taxSettingsRev,
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR')
      }),
      // Freistellungsaufträge per broker (P2-6): orders vs the allowance, and
      // the headroom left at each broker from its portfolios' income.
      taxJurisdiction === 'de' && window.MaerminFSA && React.createElement(window.MaerminFSA.Panel, {
        theme: currentTheme, transactions, portfolios, year: currentYear, exchangeRate, fxAt,
        allowance: (() => { const TSm = window.MaerminTaxSettings; try { return TSm ? TSm.load().freistellungsauftrag : 1000; } catch (e) { return 1000; } })(),
        // Orders are EUR amounts: shown in EUR whatever the display currency.
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR')
      }),
      // P5-4.9: Austria - the computation under § 27a EStG and the fund inputs.
      taxJurisdiction === 'at' && window.MaerminATTax && React.createElement(window.MaerminATTax.Panel, {
        theme: currentTheme, report: taxReport, transactions, year: currentYear,
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR'),
        onChange: () => setTaxSettingsRev(r => r + 1)
      }),
      // P5-4.11: US - IRA / Roth IRA / 401(k) contributions against the IRS limits.
      taxJurisdiction === 'us' && window.MaerminUSContrib && React.createElement(window.MaerminUSContrib.Panel, {
        theme: currentTheme, transactions, portfolios, exchangeRate, year: currentYear, privacy: privacyMode
      }),
      // P5-4.10: Switzerland - the Wertschriftenverzeichnis, DA-1 and the KS 36 check.
      taxJurisdiction === 'ch' && window.MaerminCHTax && React.createElement(window.MaerminCHTax.Panel, {
        theme: currentTheme, report: taxReport, year: currentYear, privacy: privacyMode,
        onChange: () => setTaxSettingsRev(r => r + 1)
      }),
      // P5-4.8: statement of assets (optionally AES-256 protected), cost
      // roll-forward, DATEV-style bookings and the crypto source-of-funds trace.
      window.MaerminStatements && React.createElement(window.MaerminStatements.Panel, {
        theme: currentTheme, transactions, portfolios, prices, exchangeRate, fxAt, year: currentYear,
        owner: taxOwner && taxOwner.name ? taxOwner.name : ''
      }),
      // P5-4.7: the bank's Jahressteuerbescheinigung against MAERMIN, per line.
      taxJurisdiction === 'de' && window.MaerminTaxCert && React.createElement(window.MaerminTaxCert.Panel, {
        theme: currentTheme, transactions, portfolios, year: currentYear, exchangeRate, fxAt, rev: taxSettingsRev,
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR')
      }),
      // Anlage KAP / KAP-INV lines for portfolios at a broker without German
      // withholding (P2-6).
      taxJurisdiction === 'de' && window.MaerminAnlageKap && React.createElement(window.MaerminAnlageKap.Panel, {
        theme: currentTheme, transactions, portfolios, year: currentYear, exchangeRate, fxAt,
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR')
      }),
      // P4-3: foreign withholding tax per country (estimate, German rules)
      taxJurisdiction === 'de' && window.MaerminWithholding && React.createElement(window.MaerminWithholding.Panel, {
        theme: currentTheme, year: currentYear, dividends: (taxReport && taxReport.dividends) || [],
        formatMoney: (v) => privacyMode ? '••••••' : window.MaerminI18n.money(v, 'EUR')
      }),
      // P5-1.3: cash bookings of the year, for information (not part of the computed tax)
      (() => {
        const cb = taxReport && taxReport.summary && taxReport.summary.cashBookings;
        const keys = cb ? ['tax', 'tax_refund', 'fee', 'fee_refund', 'interest_charge'].filter(k => cb[k] > 0) : [];
        if (!keys.length) return null;
        return React.createElement(window.MaerminComponents.Card, { 'data-testid': 'tax-cash-bookings', headingLevel: 'h3', title: __('taxCashTitle', 'Cash bookings {year}', { year: currentYear }),
          subtitle: __('taxCashNote', 'For information. Taxes already paid or refunded, stand-alone fees and interest charges you booked. They do not change the tax computed above.') },
          React.createElement('ul', { className: 'ui-rows' }, keys.map(k => React.createElement('li', { key: k, 'data-tax-cash': k, className: 'ui-rows__row' },
            React.createElement('span', { className: 'ui-muted' }, window.MaerminUtils.txTypeInfo(k, t).label),
            React.createElement('b', { className: 'num' }, privacyMode ? '••••••' : window.MaerminI18n.money(cb[k], 'EUR'))))));
      })(),
      // Editable tax parameters (Task 8): rate, Soli, church tax, allowance,
      // crypto exemption, Teilfreistellung overrides. Engine + exports read them.
      taxJurisdiction === 'de' && window.MaerminGermanTaxView && window.MaerminGermanTaxView.SettingsPanel &&
        React.createElement(window.MaerminGermanTaxView.SettingsPanel, {
          theme: currentTheme, t, onChange: () => setTaxSettingsRev(r => r + 1)
        })
    );
  };

  // ========== PLACEHOLDER FOR ANALYTICS ==========
  
  const renderAnalyticsPlaceholder = (name) => {
    // R5.2: the shared error state, with a reload as the way out
    return React.createElement('div', { className: 'ui-view' },
      window.MaerminUtils.emptyState({ kind: 'error', role: 'alert', title: name,
        text: t.moduleNotLoaded || 'Module not loaded. Check the browser console for errors.',
        action: { label: __('retry', 'Retry'), onClick: () => window.location.reload() } }));
  };

  // ========== PASSWORD CHANGE MODAL ==========

  const renderPasswordModal = () => {
    if (!showPasswordModal) return null;
    return React.createElement(PasswordModal, {
      theme: currentTheme, t,
      onClose: () => setShowPasswordModal(false),
      restoreFocus: focusAccountButton,
      addToast
    });
  };

  // Security log viewer — recent vault/data events + captured errors.
  const renderAuditLogModal = () => {
    if (!showAuditLog) return null;
    const UIC = window.MaerminComponents;
    const entries = (window.MaerminAuditLog ? window.MaerminAuditLog.getEntries({ limit: 200 }) : []);
    // R5.1: the shared dialog look; the level as a badge with its word
    const levelTone = (lv) => lv === 'error' ? 'loss' : lv === 'warn' ? 'warning' : undefined;
    return React.createElement(window.MaerminUI.Overlay, {
      onClose: () => setShowAuditLog(false), restoreFocus: focusAccountButton, className: 'ui-modal-backdrop'
    },
      React.createElement('div', {
        ...window.MaerminUI.dialogProps('dlg-audit-log'),
        className: ['ui-modal', 'ui-modal--log'].join(' ')
      },
        React.createElement('header', { className: 'ui-modal__head' },
          React.createElement('h2', { id: 'dlg-audit-log', className: 'ui-modal__title' }, (t.securityLog || 'Security log')),
          React.createElement(UIC.Button, { size: 'sm', variant: 'quiet', onClick: () => window.MaerminUtils.confirmThen({
              title: t.auditClearTitle || 'Clear the security log?',
              message: t.auditClearMessage || 'All recorded security events on this device are deleted.',
              confirmLabel: t.clear || 'Clear', cancelLabel: t.cancel || 'Cancel'
            }, () => { if (window.MaerminAuditLog) { window.MaerminAuditLog.clear(); setShowAuditLog(false); setTimeout(() => setShowAuditLog(true), 0); } }) }, t.clear || 'Clear'),
          React.createElement(UIC.IconButton, { size: 'sm', label: t.close || 'Close', onClick: () => setShowAuditLog(false), icon: React.createElement('span', { 'aria-hidden': 'true' }, '×') })
        ),
        React.createElement('div', { className: 'ui-modal__body' },
          entries.length === 0
            ? React.createElement(UIC.EmptyState, { compact: true, text: t.securityLogEmpty || 'No events recorded yet.' })
            : React.createElement('ul', { className: 'ui-log' }, entries.map((e, i) => React.createElement('li', { key: i, className: 'ui-log__row' },
                React.createElement('span', { className: ['ui-log__time', 'num'].join(' ') }, window.MaerminI18n.date(e.t, 'dateTime')),
                React.createElement(UIC.Badge, { tone: levelTone(e.level) }, (e.level === 'error' || e.level === 'warn' ? '! ' : '') + e.type),
                React.createElement('span', { className: 'ui-log__detail' }, e.detail)
              )))
        ),
        React.createElement('footer', { className: ['ui-modal__foot', 'ui-log__foot'].join(' ') },
          (t.securityLogNote || 'Stored locally on this device only. Non-sensitive event metadata — no amounts or secrets.'))
      )
    );
  };

  // ========== TRANSACTION MODAL ==========
  
  const renderTransactionModal = () => {
    if (!showTransactionModal) return null;
    
    const isEditing = !!editingTransactionId;
    // Fields flagged by the last save attempt that are still empty.
    const emptyNow = window.MaerminUtils.missingTxFields(newTransaction,
      newTransaction.category === 'options' ? (newTransaction.underlying || '') : undefined);
    const shownMissing = txMissing.filter(f => emptyNow.includes(f));
    const fieldNames = { symbol: t.symbol || 'Symbol', quantity: t.quantity || 'Quantity', price: t.pricePerUnit || 'Price per Unit' };
    const invalidProps = (f) => shownMissing.includes(f) ? { 'aria-invalid': true, 'aria-describedby': 'tx-missing' } : {};

    // P5-1.3: cash bookings (deposit, withdrawal, transfer, fee, tax, refunds,
    // interest charge) replace the trade fields with type, amount, currency,
    // date, note and - for a transfer - the other portfolio.
    const isCashTx = !!(window.MaerminLedger && window.MaerminLedger.isCash(newTransaction));
    // R5.1: the shared dialog look, fields, chips and buttons (ids and test hooks unchanged)
    const UIC = window.MaerminComponents;
    const INPUT = 'ui-input', SELECT = ['ui-input', 'ui-select'].join(' ');
    const fieldLabel = (id, text) => React.createElement('label', { htmlFor: id, className: 'ui-field__label' }, text);
    const field = (id, text, control, extra) => React.createElement('div', Object.assign({ className: 'ui-field' }, extra || {}), fieldLabel(id, text), control);
    const groupLabel = (id, text) => React.createElement('span', { id, className: 'ui-field__label' }, text);
    const setTx = (patch) => setNewTransaction(prev => ({ ...prev, ...patch }));
    const renderCashFields = () => {
      const UT = window.MaerminUtils;
      const isTr = newTransaction.type === 'transfer_out' || newTransaction.type === 'transfer_in';
      const here = newTransaction.targetPortfolioId || writePortfolioId;
      const others = portfolios.filter(p => p.id !== here);
      const kinds = ['deposit', 'withdrawal', 'transfer_out', 'fee', 'fee_refund', 'tax', 'tax_refund', 'interest_charge'];
      const kindLabel = (k) => k === 'transfer_out' ? __('txTransfer', 'Transfer to another portfolio') : UT.txTypeInfo(k, t).label;
      return React.createElement('div', { 'data-testid': 'tx-cash', className: 'ui-tx-fields' },
        field('tx-cash-type', __('txCashType', 'Booking'),
          React.createElement('select', { id: 'tx-cash-type', value: newTransaction.type === 'transfer_in' ? 'transfer_out' : newTransaction.type,
            onChange: (e) => setTx({ type: e.target.value, counterPortfolioId: e.target.value === 'transfer_out' ? (newTransaction.counterPortfolioId || (others[0] || {}).id || '') : newTransaction.counterPortfolioId }),
            className: SELECT },
            kinds.map(k => React.createElement('option', { key: k, value: k }, kindLabel(k))))),
        isTr && field('tx-cash-counter', __('txTransferTo', 'To portfolio'),
          others.length
            ? React.createElement('select', { id: 'tx-cash-counter', value: newTransaction.counterPortfolioId || '', onChange: (e) => setTx({ counterPortfolioId: e.target.value }), className: SELECT },
                React.createElement('option', { value: '' }, '—'),
                others.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name)))
            : React.createElement('p', { role: 'note', className: 'ui-muted' }, __('txTransferNeedsTwo', 'Create a second portfolio first (Portfolio → Portfolios).'))),
        React.createElement('div', { className: 'ui-tx-pair' },
          field('tx-amount', __('txAmount', 'Amount'),
            React.createElement('input', { id: 'tx-amount', type: 'text', inputMode: 'decimal', value: newTransaction.amount == null ? '' : newTransaction.amount,
              onChange: (e) => setTx({ amount: e.target.value }), placeholder: window.MaerminI18n.num(0, { min: 2, max: 2 }), className: INPUT })),
          field('tx-cash-currency', t.currency || 'Currency',
            React.createElement('select', { id: 'tx-cash-currency', value: newTransaction.currency || 'EUR', onChange: (e) => setTx({ currency: e.target.value }), className: SELECT },
              ['EUR', 'USD'].map(c => React.createElement('option', { key: c, value: c }, c))))),
        field('tx-date', t.date || 'Date',
          React.createElement('input', { id: 'tx-date', type: 'date', value: newTransaction.date, onChange: (e) => setTx({ date: e.target.value }), className: INPUT })),
        field('tx-notes', t.notesOptional || 'Notes (optional)',
          React.createElement('input', { id: 'tx-notes', type: 'text', value: newTransaction.notes || '', onChange: (e) => setTx({ notes: e.target.value }), placeholder: t.notesPlaceholder || 'Optional notes...', className: INPUT }))
      );
    };

    const closeModal = () => {
      setShowTransactionModal(false);
      setEditingTransactionId(null);
      setNewTransaction({
        type: 'buy',
        category: 'crypto',
        symbol: '',
        quantity: '',
        price: '',
        date: window.MaerminUtils.todayISO(),
        fees: '',
        notes: '',
        currency: currency,
        targetPortfolioId: writePortfolioId,
      });
    };
    // Escape, a click beside the dialog and Cancel: a changed form asks before
    // its entries are thrown away (one stray Escape used to lose everything).
    const requestClose = () => {
      const changed = txInitialRef.current && window.MaerminUtils.formChanged(txInitialRef.current, newTransaction);
      if (!changed || !(window.MaerminUI && window.MaerminUI.confirm)) { closeModal(); return; }
      window.MaerminUI.confirm({
        title: isEditing ? (t.discardEditTitle || 'Discard your changes?') : (t.discardTxTitle || 'Discard this transaction?'),
        message: t.discardTxMessage || 'What you entered in this form will be lost.',
        confirmLabel: t.discard || 'Discard',
        cancelLabel: t.keepEditing || 'Keep editing',
        danger: true
      }).then(yes => { if (yes) closeModal(); });
    };

    const qtyLabel = newTransaction.category === 'bonds' && newTransaction.type !== 'dividend' && newTransaction.type !== 'interest' ? __('bondNominal', 'Nominal value') : (t.quantity || 'Quantity');
    const priceLabel = newTransaction.category === 'bonds' && newTransaction.type !== 'dividend' && newTransaction.type !== 'interest' ? __('bondPricePct', 'Price in % of nominal') : (t.pricePerUnit || 'Price per Unit');
    const COMMODITIES = [
      { sym: 'GOLD',    label: __('cmdGold', 'Gold'),         unit: __('unitTroyOz', 'troy oz') },
      { sym: 'SILVER',  label: __('cmdSilver', 'Silver'),       unit: __('unitTroyOz', 'troy oz') },
      { sym: 'PLATINUM',label: __('cmdPlatinum', 'Platinum'),     unit: __('unitTroyOz', 'troy oz') },
      { sym: 'PALLADIUM',label: __('cmdPalladium', 'Palladium'),    unit: __('unitTroyOz', 'troy oz') },
      { sym: 'OIL',     label: __('cmdOilWti', 'Oil (WTI)'),    unit: __('unitBarrel', 'barrel') },
      { sym: 'BRENT',   label: __('cmdOilBrent', 'Oil (Brent)'),  unit: __('unitBarrel', 'barrel') },
      { sym: 'GAS',     label: __('cmdNatGas', 'Natural Gas'),  unit: 'MMBtu' },
      { sym: 'COPPER',  label: __('cmdCopper', 'Copper'),       unit: 'lb' },
      { sym: 'WHEAT',   label: __('cmdWheat', 'Wheat'),        unit: __('unitBushel', 'bushel') },
      { sym: 'CORN',    label: __('cmdCorn', 'Corn'),         unit: __('unitBushel', 'bushel') },
    ];

    const symbolControl = () =>
      // CS2 Skin Picker
      newTransaction.category === 'skins' && window.MaerminFeatures3?.CS2SkinPicker
        ? React.createElement('div', { className: 'ui-tx-picked-wrap' },
            React.createElement(window.MaerminFeatures3.CS2SkinPicker, {
              workerUrl: marketWorker, theme: currentTheme,
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
            newTransaction.symbol && React.createElement('div', { className: 'ui-picked' },
              newTransaction.skinIconUrl
                ? React.createElement('img', { src: newTransaction.skinIconUrl, alt: newTransaction.symbol, className: 'ui-picked__skin' })
                : React.createElement('div', { className: ['ui-picked__skin', 'is-empty'].join(' ') }, 'CS2'),
              React.createElement('div', { className: 'ui-rows__main' },
                React.createElement('b', null, newTransaction.symbol),
                newTransaction.price && React.createElement('span', { className: 'num' }, window.MaerminI18n.money(parseFloat(newTransaction.price), 'USD', 2))
              )
            )
          )

      // Stock Symbol Picker
      : (newTransaction.category === 'stocks' || newTransaction.category === 'crypto') && window.MaerminFeatures3?.SymbolPicker
        ? React.createElement(window.MaerminFeatures3.SymbolPicker, {
            category: newTransaction.category,
            workerUrl: marketWorker,
            theme: currentTheme,
            selectedSymbol: newTransaction.symbol,
            selectedName: newTransaction.symbolName || '',
            onSelect: ({ symbol, ticker, name, logoUrl, exchange, manual }) => {
              if (!symbol) {
                setNewTransaction(prev => ({ ...prev, symbol: '', symbolName: '', symbolLogoUrl: '', symbolTyped: false }));
                return;
              }
              setNewTransaction(prev => ({
                ...prev,
                symbol,           // exact API symbol (CoinGecko ID or YF ticker)
                symbolName: name, // human-readable name stored for display
                symbolLogoUrl: logoUrl || '',
                symbolTyped: !!manual, // typed, no suggestion picked (UX-022)
              }));
            }
          })
      // Option contract fields: underlying + call/put + strike + expiry +
      // contract size. The contract symbol (tx.symbol) is derived on save
      // via MaerminOptions.contractSymbol, so no symbol picker is needed.
      : newTransaction.category === 'options'
        ? React.createElement('div', { className: 'ui-tx-fields' },
            React.createElement('input', {
              type: 'text', value: newTransaction.underlying || '',
              onChange: e => setNewTransaction(prev => ({ ...prev, underlying: e.target.value.toUpperCase() })),
              placeholder: __('underlyingPh', 'Underlying symbol: AAPL, SAP.DE...'), 'aria-label': __('underlyingAria', 'Underlying symbol'),
              className: INPUT
            }),
            React.createElement('div', { className: 'ui-tx-seg' },
              ['call', 'put'].map(ot => React.createElement(UIC.Chip, {
                key: ot,
                pressed: (newTransaction.optionType || 'call') === ot,
                onClick: () => setNewTransaction(prev => ({ ...prev, optionType: ot })),
                className: 'ui-tx-chip'
              }, ot === 'call' ? __('optCall', 'Call') : __('optPut', 'Put')))),
            React.createElement('div', { className: 'ui-tx-opt' },
              React.createElement('input', {
                type: 'number', value: newTransaction.strike || '', min: 0, step: 'any',
                onChange: e => setNewTransaction(prev => ({ ...prev, strike: e.target.value })),
                placeholder: __('strikePh', 'Strike'), 'aria-label': __('strikeAria', 'Strike price'),
                className: INPUT
              }),
              React.createElement('input', {
                type: 'date', value: newTransaction.expiry || '',
                onChange: e => setNewTransaction(prev => ({ ...prev, expiry: e.target.value })),
                title: __('expiryDate', 'Expiry date'), 'aria-label': __('expiryDate', 'Expiry date'),
                className: INPUT
              }),
              React.createElement('input', {
                type: 'number', value: newTransaction.contractSize || '', min: 1,
                onChange: e => setNewTransaction(prev => ({ ...prev, contractSize: e.target.value })),
                placeholder: __('sizePh', 'Size (100)'), 'aria-label': __('contractSize', 'Contract size'), title: __('contractSizeTitle', 'Contract size (shares per contract, default 100)'),
                className: [INPUT, 'ui-tx-size'].join(' ')
              })),
            React.createElement('p', { className: 'ui-note' },
              __('optHint', 'Quantity = number of contracts, price = premium per share. Buy = long / close a short, sell = write (short) / close a long.'))
          )
      : newTransaction.category === 'commodities'
        ? React.createElement('div', { className: 'ui-tx-fields' },
            // Preset buttons
            React.createElement('div', { className: 'ui-bi-chips' },
              COMMODITIES.map(c => React.createElement(UIC.Chip, {
                key: c.sym,
                pressed: newTransaction.symbol === c.sym,
                onClick: () => setNewTransaction(prev => ({ ...prev, symbol: c.sym, notes: prev.notes || `${c.label} (${c.unit})` })),
                className: 'ui-tx-preset'
              }, c.label))
            ),
            // Also allow free-text for ETFs like GLD, SLV
            React.createElement('input', {
              type: 'text', value: newTransaction.symbol,
              onChange: e => setNewTransaction(prev => ({ ...prev, symbol: e.target.value.toUpperCase() })),
              placeholder: __('cmdEtfPh', 'or enter ETF symbol: GLD, SLV, IAU...'), 'aria-label': t.symbol || 'Symbol',
              className: INPUT
            })
          )

      // Default fallback: plain text (for categories without picker)
      : React.createElement('input', {
          type: 'text', value: newTransaction.symbol,
          onChange: e => setNewTransaction(prev => ({ ...prev, symbol: e.target.value.toUpperCase() })),
          placeholder: __('symbolPh', 'Symbol...'), 'aria-label': t.symbol || 'Symbol',
          className: INPUT
        });

    return React.createElement(window.MaerminUI.Overlay, {
      className: 'ui-modal-backdrop',
      onClose: requestClose
    },
      React.createElement('div', {
        ...window.MaerminUI.dialogProps('dlg-transaction'),
        className: ['ui-modal', 'ui-modal--tx'].join(' ')
      },
        // Header with a close button (Phase 3: the dialog had none; Escape and
        // the backdrop were the only ways out on touch).
        React.createElement('header', { className: 'ui-modal__head' },
          React.createElement('h2', { id: 'dlg-transaction', className: 'ui-modal__title' },
            isEditing ? (t.editTransaction || 'Edit Transaction') : (t.addTransaction || 'Add Transaction')),
          React.createElement(UIC.IconButton, { size: 'sm', label: t.close || 'Close', onClick: requestClose, icon: React.createElement('span', { 'aria-hidden': 'true' }, '×') })),

        React.createElement('div', { className: ['ui-modal__body', 'ui-tx'].join(' ') },
        // Portfolio selector — always shown as a select dropdown
        field('tx-portfolio', t.portfolio || 'Portfolio',
          React.createElement('select', {
            id: 'tx-portfolio',
            value: newTransaction.targetPortfolioId || writePortfolioId,
            onChange: e => setNewTransaction(prev => ({ ...prev, targetPortfolioId: e.target.value })),
            className: SELECT
          },
            portfolios.map(p =>
              React.createElement('option', { key: p.id, value: p.id }, p.name)
            )
          )
        ),

        // Type selector: Buy / Sell / Cash
        React.createElement('div', { className: 'ui-field' },
          groupLabel('tx-type-label', t.type || 'Type'),
          React.createElement('div', { role: 'group', 'aria-labelledby': 'tx-type-label', className: 'ui-tx-seg' },
            ['buy', 'sell'].map(type =>
              React.createElement(UIC.Chip, {
                key: type,
                pressed: newTransaction.type === type,
                onClick: () => setNewTransaction(prev => ({ ...prev, type })),
                className: ['ui-tx-chip', type === 'buy' ? 'is-buy' : 'is-sell'].join(' ')
              }, type === 'buy' ? (t.buy || 'Buy') : (t.sell || 'Sell'))
            ),
            // P5-1.3: a cash booking instead of a trade
            React.createElement(UIC.Chip, {
              key: 'cash', 'data-tx-mode': 'cash',
              pressed: isCashTx,
              onClick: () => setNewTransaction(prev => window.MaerminLedger.isCash(prev) ? prev : ({ ...prev, type: 'deposit', amount: prev.amount || '' })),
              className: 'ui-tx-chip'
            }, __('txCash', 'Cash'))
          )
        ),

        isCashTx ? renderCashFields() : React.createElement(React.Fragment, null,
        // Category selector: equal columns that wrap instead of squeezing the labels
        React.createElement('div', { className: 'ui-field' },
          groupLabel('tx-category-label', t.category || 'Category'),
          React.createElement('div', { role: 'group', 'aria-labelledby': 'tx-category-label', className: 'ui-tx-cats' },
            ['crypto', 'stocks', 'skins', 'commodities', 'options', 'bonds']
              .concat(window.MaerminCategories ? window.MaerminCategories.ids() : []).map(cat =>
              React.createElement(UIC.Chip, {
                key: cat,
                pressed: newTransaction.category === cat,
                onClick: () => setNewTransaction(prev => ({ ...prev, category: cat })),
                className: 'ui-tx-chip'
              }, getCategoryDisplayName(cat))
            )
          )
        ),

        // Symbol / Skin / Commodity Picker
        React.createElement('div', { className: 'ui-field' },
          React.createElement('span', { className: 'ui-field__label' }, t.symbol || 'Symbol'),
          symbolControl()),

        React.createElement('div', { className: 'ui-tx-pair' },
          field('tx-quantity', qtyLabel,
            React.createElement('input', {
              id: 'tx-quantity',
              ...invalidProps('quantity'),
              type: 'number',
              value: newTransaction.quantity,
              onChange: (e) => setNewTransaction(prev => ({ ...prev, quantity: e.target.value })),
              step: '0.0001',
              placeholder: '0.00',
              className: INPUT
            })),
          field('tx-price', priceLabel,
            React.createElement('input', {
              id: 'tx-price',
              ...invalidProps('price'),
              type: 'number',
              value: newTransaction.price,
              onChange: (e) => setNewTransaction(prev => ({ ...prev, price: e.target.value })),
              step: '0.01',
              placeholder: '0.00',
              className: INPUT
            }))),

        React.createElement('div', { className: 'ui-tx-pair' },
          field('tx-date', t.date || 'Date',
            React.createElement('input', {
              id: 'tx-date',
              type: 'date',
              value: newTransaction.date,
              onChange: (e) => setNewTransaction(prev => ({ ...prev, date: e.target.value })),
              className: INPUT
            })),
          field('tx-fees', t.feesOptional || 'Fees (optional)',
            React.createElement('input', {
              id: 'tx-fees',
              type: 'number',
              value: newTransaction.fees,
              onChange: (e) => setNewTransaction(prev => ({ ...prev, fees: e.target.value })),
              step: '0.01',
              placeholder: '0.00',
              className: INPUT
            }))),

        // P5-3.9: bond terms (when unknown) and accrued interest
        newTransaction.category === 'bonds' && (newTransaction.type === 'buy' || newTransaction.type === 'sell') && window.MaerminBonds && React.createElement(window.MaerminBonds.FormFields, {
          theme: currentTheme, form: newTransaction, currency,
          onChange: (patch) => setNewTransaction(prev => ({ ...prev, ...patch }))
        }),

        // P4-3: foreign withholding tax on a dividend
        newTransaction.type === 'dividend' && field('tx-wht', __('txWhtLabel', 'Withholding tax (optional, in {cur})', { cur: newTransaction.currency || currency }),
          React.createElement(React.Fragment, null,
            React.createElement('input', {
              id: 'tx-wht',
              type: 'text', inputMode: 'decimal',
              value: newTransaction.withholdingTax || '',
              onChange: (e) => setNewTransaction(prev => ({ ...prev, withholdingTax: e.target.value })),
              placeholder: window.MaerminI18n.num(0, { min: 2, max: 2 }),
              'aria-describedby': 'tx-wht-hint',
              className: INPUT
            }),
            React.createElement('p', { id: 'tx-wht-hint', className: 'ui-note' },
              __('txWhtHint', 'Tax the source country kept before paying out. The German tax view credits up to 15 % of the gross dividend.')))
        ),

        // Notes
        field('tx-notes', t.notesOptional || 'Notes (optional)',
          React.createElement('input', {
            id: 'tx-notes',
            type: 'text',
            value: newTransaction.notes,
            onChange: (e) => setNewTransaction(prev => ({ ...prev, notes: e.target.value })),
            placeholder: t.notesPlaceholder || 'Optional notes...',
            className: INPUT
          })
        ),

        // Currency selector
        React.createElement('div', { className: 'ui-field' },
          groupLabel('tx-currency-label', t.currency || 'Currency'),
          React.createElement('div', { role: 'group', 'aria-labelledby': 'tx-currency-label', className: 'ui-tx-seg' },
            ['EUR', 'USD'].map(cur =>
              React.createElement(UIC.Chip, {
                key: cur,
                pressed: newTransaction.currency === cur,
                onClick: () => setNewTransaction(prev => ({ ...prev, currency: cur })),
                className: 'ui-tx-chip'
              }, cur)
            ),
            // Any other trade currency (CHF, GBP, ...): converted to EUR at the
            // rate of the trade date (MaerminFxHistory, rates via the Worker).
            (() => {
              const FXH = window.MaerminFxHistory;
              const list = (FXH && FXH.FIAT) || [];
              const cur = newTransaction.currency || 'EUR';
              const other = cur !== 'EUR' && cur !== 'USD';
              return React.createElement('select', {
                'aria-label': t.otherCurrency || 'Other currency',
                'data-testid': 'tx-currency-other',
                value: other ? cur : '',
                onChange: (e) => { if (e.target.value) setNewTransaction(prev => ({ ...prev, currency: e.target.value })); },
                className: [SELECT, 'ui-tx-other', other ? 'is-on' : ''].join(' ').trim()
              },
                React.createElement('option', { value: '' }, t.otherCurrency || 'Other…'),
                // keep a stored currency selectable even if it is not in the list (e.g. an imported one)
                (other && list.indexOf(cur) === -1 ? [cur] : []).concat(list).map(c => React.createElement('option', { key: c, value: c }, c))
              );
            })()
          ),
          (() => {
            const FXH = window.MaerminFxHistory;
            const cur = newTransaction.currency || 'EUR';
            if (cur === 'EUR' || cur === 'USD' || !FXH) return null;
            const d = newTransaction.date || window.MaerminUtils.todayISO();
            const res = FXH.txToEUR(1, cur, d, exchangeRate, fxAt);
            const show = (v) => (v >= 0.1 ? window.MaerminI18n.num(v, 4) : window.MaerminI18n.num(Number(v.toPrecision(4)), { min: 0, max: 10 }));
            const hasW = (marketWorker || '').trim().length > 5;
            return React.createElement('p', { 'data-testid': 'tx-currency-hint', className: 'ui-note' },
              res.status === 'exact' ? __('fxHintExact', '1 {cur} = {rate} EUR on {date} (rate of the trade date).', { cur, rate: show(res.value), date: window.MaerminI18n.date(d) })
                : res.status === 'approx' ? (FXH.hasHistory(cur)
                    ? (hasW ? __('fxHintLater', "The {cur} rate of the trade date is loaded after saving. Today's rate until then: 1 {cur} ≈ {rate} EUR.", { cur, rate: show(res.value) })
                            : __('fxHintNoWorker', "Without a Worker only today's rate is available: 1 {cur} ≈ {rate} EUR. Add a Worker URL in API Settings for the rate of the trade date.", { cur, rate: show(res.value) }))
                    : __('fxHintNoHistory', "No daily history for {cur}: today's rate is used for every date (1 {cur} ≈ {rate} EUR).", { cur, rate: show(res.value) }))
                : __('fxHintNone', 'No exchange rate for {cur} - the amount would be counted as EUR.', { cur }));
          })()
        ),

        // Total display
        newTransaction.quantity && newTransaction.price && React.createElement('div', { className: 'ui-tx-total' },
          React.createElement('span', null, t.total || 'Total'),
          React.createElement('b', { className: 'num' },
            `${window.MaerminI18n.num((window.MaerminUtils.parseDecimal(newTransaction.quantity) || 0) * (window.MaerminUtils.parseDecimal(newTransaction.price) || 0), 2)} ${newTransaction.currency || 'EUR'}`
          )
        ),

        // Which required fields are still empty after a save attempt.
        shownMissing.length ? React.createElement('p', {
          id: 'tx-missing', role: 'alert', className: ['ui-callout', 'ui-callout--error', 'ui-tx-missing'].join(' ')
        }, `! ${t.fillInFields || 'Please fill in'}: ${shownMissing.map(f => fieldNames[f]).join(', ')}`) : null
        )),

        // Buttons: always in view in the dialog foot while the body scrolls
        React.createElement('footer', { className: 'ui-modal__foot' },
          React.createElement(UIC.Button, { onClick: requestClose }, t.cancel || 'Cancel'),
          React.createElement(UIC.Button, { variant: 'primary', onClick: () => saveTransaction(), 'data-tx-save': true },
            isEditing
              ? (t.saveChanges || 'Save Changes')
              : isCashTx ? __('txAddBooking', 'Add booking')
              : (newTransaction.type === 'buy' ? (t.addBuy || 'Add Buy') : (t.addSell || 'Add Sell')))
        )
      )
    );
  };

  // ========== IMPORT MODAL ==========
  
  const renderImportModal = () => {
    if (!showImportModal) return null;
    
    // R5.4: the shared dialog look; the field is named, the file picker is a labelled button
    const UIC = window.MaerminComponents;
    return React.createElement(window.MaerminUI.Overlay, {
      className: 'ui-modal-backdrop',
      onClose: () => setShowImportModal(false)
    },
      React.createElement('div', {
        ...window.MaerminUI.dialogProps('dlg-import'),
        className: 'ui-modal'
      },
        React.createElement('header', { className: 'ui-modal__head' },
          React.createElement('h2', { id: 'dlg-import', className: 'ui-modal__title' }, t.importData || 'Import Data')),
        React.createElement('div', { className: ['ui-modal__body', 'ui-imp'].join(' ') },
          React.createElement('p', { className: 'ui-muted' },
            t.importInstructions || 'Paste your transaction data in JSON or CSV format. Supported formats: JSON array, CSV with headers (type, category, symbol, quantity, price, date, fees)'),

          // Format examples
          React.createElement('details', { className: 'ui-sync-details' },
            React.createElement('summary', null, t.showExamples || 'Show format examples'),
            React.createElement('pre', { className: 'ui-imp__pre' }, `JSON:
[{"type":"buy","category":"crypto","symbol":"bitcoin","quantity":0.5,"price":45000,"date":"2024-01-15"}]

CSV:
type,category,symbol,quantity,price,date,fees
buy,crypto,bitcoin,0.5,45000,2024-01-15,10`)
          ),

          // Textarea for data
          React.createElement('textarea', {
            value: importData,
            onChange: (e) => setImportData(e.target.value),
            placeholder: t.pasteDataHere || 'Paste your data here...',
            'aria-label': t.importData || 'Import Data',
            className: ['ui-input', 'ui-textarea', 'ui-imp__data'].join(' ')
          }),

          // File upload
          React.createElement('div', { className: 'ui-bi-drop' },
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
              className: 'sr-only',
              id: 'import-file-input'
            }),
            React.createElement('label', { htmlFor: 'import-file-input', className: 'ui-link' }, t.orUploadFile || 'Or click to upload a file (.json, .csv)')
          )
        ),

        React.createElement('footer', { className: 'ui-modal__foot' },
          React.createElement(UIC.Button, { onClick: () => { setImportData(''); setShowImportModal(false); } }, t.cancel || 'Cancel'),
          React.createElement(UIC.Button, { variant: 'primary', onClick: handleImport, disabled: !importData.trim() }, t.import || 'Import'))
      )
    );
  };

  // ========== API SETTINGS MODAL ==========
  
  // R5.1: the shared dialog look (the Overlay keeps focus in and returns it to the account button)
  const renderApiSettingsModal = () => {
    if (!showApiSettings) return null;
    const UIC = window.MaerminComponents;
    const workerSet = (apiKeys.cs2Worker || '').trim().length > 5;
    const feature = (title, lines) => React.createElement('div', { className: 'ui-api-feat' },
      React.createElement('b', null, title),
      lines.map((l, i) => React.createElement('span', { key: i }, l)));
    const source = (title, badge, text, extra) => React.createElement('section', { className: 'ui-api-src' },
      React.createElement('div', { className: 'ui-dlg-sec__head' },
        React.createElement('h3', { className: 'ui-dlg-sec__title' }, title),
        React.createElement(UIC.Badge, { tone: 'gain' }, badge)),
      React.createElement('p', { className: 'ui-muted' }, text),
      extra || null);
    return React.createElement(window.MaerminUI.Overlay, {
      className: 'ui-modal-backdrop',
      onClose: () => setShowApiSettings(false), restoreFocus: focusAccountButton
    },
      React.createElement('div', {
        ...window.MaerminUI.dialogProps('dlg-api-settings'),
        className: 'ui-modal'
      },
        React.createElement('header', { className: 'ui-modal__head' },
          React.createElement('h2', { id: 'dlg-api-settings', className: 'ui-modal__title' }, t.apiSettings || 'API Settings')),
        React.createElement('div', { className: ['ui-modal__body', 'ui-api'].join(' ') },
          React.createElement('p', { className: 'ui-muted' }, __('apiIntro', 'Live prices come through your Cloudflare Worker. Exchange rates need no key.')),

          // ── Cloudflare Worker (CS2 + Yahoo Finance Historical Data) ─────────
          React.createElement('section', { className: ['ui-api-src', 'is-main'].join(' ') },
            React.createElement('div', { className: 'ui-dlg-sec__head' },
              React.createElement('div', null,
                React.createElement('h3', { className: 'ui-dlg-sec__title' }, 'Cloudflare Worker'),
                React.createElement('div', { className: 'ui-api-badges' },
                  React.createElement(UIC.Badge, { tone: 'gain' }, __('apiFreeNoKey', 'Free · No API key')),
                  React.createElement(UIC.Badge, null, __('apiCs2Prices', 'CS2 Skin Prices')),
                  React.createElement(UIC.Badge, null, __('apiYahooChart', 'Yahoo Finance Chart Data')))),
              React.createElement(UIC.Badge, { tone: workerSet ? 'gain' : 'warning' }, workerSet ? __('apiConfigured', '✓ Configured') : '! ' + __('apiNotConfigured', 'Not configured'))),
            React.createElement('p', { className: 'ui-muted' },
              __('apiWorkerIntro', 'One Worker URL for all live data: stock, ETF and commodity prices and history (Yahoo Finance), crypto prices (CoinGecko), CS2 skin prices (daily Steam Market list), symbol search, dividends, earnings and news - plus encrypted sync and share links when the Worker has storage. No API key needed.')),
            React.createElement('div', { className: 'ui-api-feats' },
              feature(__('apiCs2Prices', 'CS2 Skin Prices'), [__('apiSteamDaily', '→ Steam Market price list (daily)'), __('apiSearchImages', '→ Search with images'), __('apiOneRequest', '→ One request for all skins')]),
              feature(__('apiHistoryChart', 'Portfolio History Chart'), ['→ Yahoo Finance', __('apiExchanges', '→ NYSE, XETRA, London…'), __('apiPeriods', '→ 1H to Max periods')]),
              feature(__('apiCs2History', 'CS2 Price History'), [__('apiAverages', '→ 24 h / 7 / 30 / 90-day averages'), __('apiPerSkin', '→ Per skin over time'), __('apiInChart', '→ Shown in portfolio chart')])),
            React.createElement('div', { className: 'ui-api-steps' },
              workerVersion && workerVersion.state === 'outdated' && React.createElement('p', { 'data-testid': 'worker-version-note', className: ['ui-api-steps__note', 'tone-warning'].join(' ') },
                '! ' + (workerVersion.version
                  ? __('wvOutdatedIs', 'Your Worker is version {v}; this app expects {e}. Update it with the steps below.', { v: workerVersion.version, e: workerVersion.expected })
                  : __('wvOutdatedNone', 'Your Worker is older than {e} (it reports no version). Update it with the steps below.', { e: workerVersion.expected }))),
              workerVersion && (workerVersion.state === 'current' || workerVersion.state === 'newer') && React.createElement('p', { className: ['ui-api-steps__note', 'tone-gain'].join(' ') },
                '✓ ' + __('wvCurrent', 'Worker version {v} — up to date.', { v: workerVersion.version })),
              React.createElement('b', null, __('apiNewWorker', 'No Worker yet?')),
              React.createElement('p', null,
                window.MaerminOnboarding && React.createElement('a', { href: window.MaerminOnboarding.DEPLOY_URL, target: '_blank', rel: 'noopener noreferrer', className: 'ui-link' }, __('obDeployBtn', 'Deploy to Cloudflare ↗')),
                ' ' + __('apiDeployHint', '— one click, then paste the Worker URL below.')),
              React.createElement('b', null, __('apiUpdateWorker', 'Update existing Worker (~1 min):')),
              React.createElement('ol', null,
                React.createElement('li', null, React.createElement('a', { href: 'https://dash.cloudflare.com', target: '_blank', rel: 'noopener noreferrer', className: 'ui-link' }, 'dash.cloudflare.com'), ' → ' + __('apiStep1', 'Workers & Pages → your Worker')),
                React.createElement('li', null, __('apiStep2a', 'Edit code → paste contents of') + ' ', React.createElement('a', { href: (window.MaerminOnboarding && window.MaerminOnboarding.GITHUB_WORKER_URL) || 'https://github.com/Maermin/MAERMIN/blob/main/cf-worker/worker.single.js', target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'api-worker-file', className: 'ui-link' }, React.createElement('code', null, 'cf-worker/worker.single.js')), ' ' + __('apiStep2b', 'from this repository: the whole Worker in one file (worker.js alone needs the files next to it)')),
                React.createElement('li', null, __('apiStep3', 'Save and Deploy — no secrets needed')),
                React.createElement('li', null, __('apiStep4', 'Paste the Worker URL below')))),
            React.createElement(UIC.Input, {
              label: __('apiWorkerLabel', 'Worker URL — live prices, symbol search, research, sync, share links and reminders'),
              value: apiKeys.cs2Worker || '',
              onChange: e => setApiKeys(prev => ({ ...prev, cs2Worker: e.target.value })),
              placeholder: 'https://your-worker-name.your-subdomain.workers.dev',
              spellCheck: false, className: 'ui-api-url'
            }),
            window.MaerminOnboarding && window.MaerminOnboarding.Wizard && React.createElement('div', { className: 'ui-actions' },
              React.createElement(UIC.Button, { onClick: () => { setShowApiSettings(false); openOnboarding(); } }, __('apiGuided', 'Guided setup & connection test')))),

          source('CoinGecko', t.publicApi || 'Public API', t.coingeckoInfo || 'Crypto prices come from CoinGecko through your Worker, which caches them. No API key needed; an optional CoinGecko demo key on the Worker (COINGECKO_API_KEY) raises the limit.'),
          source(t.exchangeRate || 'Exchange Rate', 'ExchangeRate-API', t.exchangeRateInfo || 'Prices quoted in USD or another currency (US stocks, CS2 skins) are converted to EUR with daily exchange rates.',
            React.createElement('p', { className: ['ui-api-rate', 'num'].join(' ') }, '1 USD', ' = ', React.createElement('b', null, `${window.MaerminI18n.num(exchangeRate, 4)} EUR`)))),
        React.createElement('footer', { className: 'ui-modal__foot' },
          React.createElement(UIC.Button, { variant: 'primary', onClick: () => setShowApiSettings(false) }, t.close || 'Close'))
      )
    );
  };

  // ========== ONBOARDING + RECOVERY MODALS ==========
  const renderOnboardingWizard = () => {
    if (!showOnboarding || !window.MaerminOnboarding || !window.MaerminOnboarding.Wizard) return null;
    return React.createElement(window.MaerminOnboarding.Wizard, {
      theme: currentTheme,
      t,
      workerUrl: apiKeys.cs2Worker || '',
      onSaveWorkerUrl: (u) => { saveWorkerUrl(u); addToast(__('workerSavedRefreshing', 'Worker URL saved — refreshing prices'), 'success'); },
      onActivateDemo: () => { closeOnboarding(); enterDemo(); },
      onClose: closeOnboarding
    });
  };

  const renderRecoveryKitModal = () => {
    if (!showRecoveryKit) return null;
    const UIC = window.MaerminComponents;
    const code = recoveryCode;
    const fileText = (window.MaerminAuth && window.MaerminAuth.recoveryFileText) ? window.MaerminAuth.recoveryFileText(code) : code;
    const doDownload = () => {
      try {
        const url = URL.createObjectURL(new Blob([fileText], { type: 'text/plain' }));
        const a = document.createElement('a'); a.href = url; a.download = 'maermin-recovery-code.txt';
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
      } catch (e) {}
    };
    const doPrint = () => {
      try {
        const w = window.open('', '_blank'); if (!w) return;
        const esc = fileText.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
        w.document.write('<title>MAERMIN Recovery Code</title><pre id="rc">' + esc + '</pre>');
        try { var pre = w.document.getElementById('rc'); pre.style.font = '14px ui-monospace,Menlo,monospace'; pre.style.padding = '24px'; pre.style.whiteSpace = 'pre-wrap'; } catch (e) {} // CSSOM: allowed without 'unsafe-inline'
        w.document.close(); w.focus(); w.print();
      } catch (e) {}
    };
    // Report "copied" only when the clipboard write actually succeeded.
    const doCopy = () => {
      const failed = () => addToast(t.rcCopyFailed || 'Copy failed. Select the code and copy it manually.', 'error');
      try {
        navigator.clipboard.writeText(code).then(() => addToast(t.rcCopied || 'Recovery code copied', 'success'), failed);
      } catch (e) { failed(); }
    };
    const altBtn = (label, onClick) => React.createElement(UIC.Button, { onClick }, label);
    // focusField: false - open on the panel so the code is read first, not the checkbox.
    // R5.1: the shared dialog look; above Security & sync, which opens it
    return React.createElement(window.MaerminUI.Overlay, { dismissable: false, focusField: false, restoreFocus: focusAccountButton, className: ['ui-modal-backdrop', 'is-top'].join(' ') },
      React.createElement('div', { ...window.MaerminUI.dialogProps('dlg-recovery'), className: ['ui-modal', 'ui-modal--sm'].join(' ') },
        React.createElement('header', { className: 'ui-modal__head' },
          React.createElement('h2', { id: 'dlg-recovery', className: 'ui-modal__title' }, t.rcTitle || 'Your recovery code')),
        React.createElement('div', { className: ['ui-modal__body', 'ui-rc-kit'].join(' ') },
          React.createElement('p', { className: 'ui-muted' }, t.rcIntro || 'Save this now — it can unlock your vault if you forget your password. It is shown once and never stored in readable form. Anyone with it can open your vault.'),
          React.createElement('div', { className: 'ui-rc-kit__code' }, code),
          React.createElement('div', { className: 'ui-rc-kit__acts' }, doCopy && altBtn(t.rcCopy || 'Copy', doCopy), altBtn(t.rcDownload || 'Download', doDownload), altBtn(t.rcPrint || 'Print', doPrint)),
          React.createElement('label', { className: 'ui-rc-kit__check' },
            React.createElement('input', { type: 'checkbox', checked: recoverySaved, onChange: (e) => setRecoverySaved(e.target.checked), className: 'ui-st-check' }),
            React.createElement('span', null, t.rcSavedCheck || 'I\'ve saved this recovery code somewhere safe and private.'))),
        React.createElement('footer', { className: ['ui-modal__foot', 'ui-rc-kit__foot'].join(' ') },
          React.createElement(UIC.Button, { variant: 'quiet', onClick: () => finishRecoveryKit(false) },
            (window.MaerminAuth && window.MaerminAuth.getStatus && window.MaerminAuth.getStatus().hasRecovery) ? (t.rcKeepOld || 'Cancel — keep my current code') : (t.rcNotNow || 'Not now')),
          React.createElement(UIC.Button, { variant: 'primary', onClick: () => finishRecoveryKit(true), disabled: !recoverySaved }, t.rcDone || 'Done — I\'ve saved it'))
      )
    );
  };

  // SEC-006: while encryption at rest is off, every view says so (the setup
  // screen let it be switched off without a lasting warning).
  const renderAtRestBanner = () => {
    const UIC = window.MaerminComponents;
    const St = window.MaerminStorage, V = window.MaerminVault;
    if (demoMode || !St || !V || !V.isUnlocked || !V.isUnlocked() || St.isEnabled()) return null;
    const turnOn = () => St.enableAtRest().then(() => { addToast(__('atRestOn', 'Data encrypted at rest ✓'), 'success'); setSecurityRev((r) => r + 1); }, () => addToast(__('atRestFailed', 'Could not enable at-rest encryption'), 'error'));
    // R5.1: a warning callout with the shared button
    return React.createElement('div', { role: 'status', 'data-testid': 'atrest-off-banner', className: ['ui-callout', 'ui-callout--warn', 'ui-atrest'].join(' ') },
      React.createElement('span', null, '! ' + __('atRestOffBanner', 'Your portfolio is stored unencrypted in this browser. Anyone with access to this device or a copy of its profile can read it.')),
      React.createElement(UIC.Button, { size: 'sm', variant: 'primary', onClick: turnOn }, __('secEncryptNow', 'Encrypt now')));
  };

  // ========== SECURITY & SYNC MODAL ==========
  const renderSecurityModal = () => {
    if (!showSecurity) return null;
    const UIC = window.MaerminComponents;
    const A = window.MaerminAuth, S = window.MaerminSync;
    const status = (A && A.getStatus) ? A.getStatus() : {};
    const syncCfg = (S && S.getConfig) ? S.getConfig() : null;
    const syncState = (S && S.getState) ? S.getState() : null;
    const workerUrl = (apiKeys.cs2Worker || '').trim();
    const bump = () => setSecurityRev(r => r + 1);
    const lockMin = Math.round((status.autoLockMs || 900000) / 60000);

    const fmtAgo = (ts) => {
      if (!ts) return __('agoNever', 'never');
      const s = Math.floor((Date.now() - ts) / 1000);
      if (s < 60) return __('agoJustNow', 'just now');
      if (s < 3600) return __('agoMin', '{n} min ago', { n: Math.floor(s / 60) });
      if (s < 86400) return __('agoHours', '{n} h ago', { n: Math.floor(s / 3600) });
      return __('agoDays', '{n} d ago', { n: Math.floor(s / 86400) });
    };
    // R5.1: shared badges, buttons, rows and section titles
    const badge = (txt, good) => React.createElement(UIC.Badge, { tone: good ? 'gain' : undefined }, good ? '✓ ' + txt : txt);
    const smallBtn = (label, onClick, disabled) => React.createElement(UIC.Button, { size: 'sm', onClick, disabled }, label);
    const row = (label, control) => React.createElement('div', { className: 'ui-sec-row' }, React.createElement('span', { className: 'ui-sec-row__label' }, label), control);
    const sectionTitle = (txt) => React.createElement('h3', { className: 'ui-sublabel' }, txt);

    const addPasskey = () => { if (!A || !A.enrollPasskey) return; A.enrollPasskey('MAERMIN').then((res) => { if (res && res.enrolled) { addToast(__('passkeyEnrolled', 'Passkey enrolled ✓'), 'success'); bump(); } else { addToast(__('passkeyNoPrf', 'This authenticator has no PRF support'), 'error'); } }, () => addToast(__('passkeyCancelled', 'Passkey enrollment cancelled'), 'error')); };
    const removePasskey = () => {
      if (!A || !A.removePasskey) return;
      askConfirm({ title: __('passkeyRemoveTitle', 'Remove the passkey?'), message: __('passkeyRemoveMsg', 'It can no longer open this vault. A copy of the vault made before still opens with it - replace the encryption key if the device or key is lost.'), confirmLabel: __('passkeyRemove', 'Remove'), danger: true })
        .then((yes) => { if (yes && A.removePasskey()) { addToast(__('passkeyRemoved', 'Passkey removed'), 'success'); bump(); } });
    };
    const rotateKey = () => {
      if (!A || !A.rotateKey || !rotatePw || rotateBusy) return;
      setRotateBusy(true);
      A.rotateKey(rotatePw).then(() => {
        setRotateBusy(false); setRotatePw(''); setRotateOpen(false);
        addToast(__('keyRotated', 'Encryption key replaced. Set up a new recovery code (and passkey); other devices need this vault again.'), 'success'); bump();
      }, (e) => {
        setRotateBusy(false);
        addToast(e && e.message === 'bad-password' ? (t.passwordWrong || 'Current password is incorrect') : __('keyRotateFailed', 'The key could not be replaced; nothing was changed.'), 'error');
      });
    };
    const enableAtRest = () => { if (window.MaerminStorage && window.MaerminStorage.enableAtRest) window.MaerminStorage.enableAtRest().then(() => { addToast(__('atRestOn', 'Data encrypted at rest ✓'), 'success'); bump(); }, () => addToast(__('atRestFailed', 'Could not enable at-rest encryption'), 'error')); };
    const setLock = (min) => { if (A && A.setAutoLock) { A.setAutoLock(min * 60000); addToast(__('autoLockSet', 'Auto-lock set to {n} min', { n: min }), 'success'); bump(); } };
    const runSync = () => { if (!S || !S.sync) return; setSyncBusy(true); S.sync().then((r) => { setSyncBusy(false); addToast(r && r.unchanged ? __('syncUpToDate', 'Already up to date') : __('syncDone', 'Synced ✓'), 'success'); bump(); }, (e) => { setSyncBusy(false); addToast(__('syncFailedMsg', 'Sync failed: {msg}', { msg: (e && e.message) || (t.error || 'Error') }), 'error'); bump(); }); };
    const doEnableSync = () => { if (!workerUrl) { addToast(__('syncNeedWorker', 'Add a Worker URL in API Settings first'), 'error'); return; } if (!S) return; S.configure({ provider: 'worker', endpoint: workerUrl }); if (S.enableAutoSync) S.enableAutoSync(); runSync(); };
    const syncOn = !!((S && S.isConfigured && S.isConfigured()) || (syncCfg && syncCfg.provider));
    // P5-5.6: connect a destination, stop syncing, allow a stored file again
    const TRs = window.MaerminSyncTransports;
    const connectSync = (cfg) => { if (!S) return; S.configure(cfg); if (S.enableAutoSync) S.enableAutoSync(); runSync(); bump(); };
    const stopSync = () => { if (!S || !S.disconnect) return; S.disconnect(); addToast(__('stStopped', 'Sync stopped on this device. The encrypted copy at the destination stays.'), 'success'); bump(); };
    const reconnectFile = () => {
      if (!TRs || !S) return;
      TRs.loadHandle().then((h) => TRs.permitted(h, true).then((yes) => {
        if (!h || !yes) { addToast(TRs.messageFor('file-permission'), 'error'); return; }
        S.configure({ provider: 'file', handle: h, endpoint: h.name }); runSync(); bump();
      })).catch(() => addToast(TRs.messageFor('file-permission'), 'error'));
    };

    // focusField: false - an overview: open on the panel, not on the market-data switch (P5-3.1)
    return React.createElement(window.MaerminUI.Overlay, { onClose: () => setShowSecurity(false), focusField: false, restoreFocus: focusAccountButton, className: 'ui-modal-backdrop' },
      React.createElement('div', { ...window.MaerminUI.dialogProps('dlg-security'), className: 'ui-modal' },
        React.createElement('header', { className: 'ui-modal__head' },
          React.createElement('h2', { id: 'dlg-security', className: 'ui-modal__title' }, __('securitySync', 'Security & sync')),
          React.createElement(UIC.IconButton, { size: 'sm', label: t.close || 'Close', onClick: () => setShowSecurity(false), icon: React.createElement('span', { 'aria-hidden': 'true' }, '×') })),
        React.createElement('div', { className: ['ui-modal__body', 'ui-sec'].join(' ') },
        sectionTitle(__('secVault', 'Vault')),
        row(__('secAtRest', 'Encryption at rest'), status.encryptedAtRest ? badge(__('secOn', 'On'), true) : smallBtn(__('secEncryptNow', 'Encrypt now'), enableAtRest)),
        row(__('secKdf', 'Key derivation'), badge(status.kdf === 'argon2id' ? 'Argon2id' : 'PBKDF2-600k', true)),
        row(__('secAutoLock', 'Auto-lock'), React.createElement('div', { className: 'ui-sec-acts' }, [1, 5, 15, 30].map((m) => React.createElement(UIC.Chip, { key: m, pressed: lockMin === m, onClick: () => setLock(m) }, m + 'm')))),
        sectionTitle(__('secAccess', 'Access')),
        row(__('secPasskey', 'Passkey unlock'), status.hasPasskey
          ? React.createElement('div', { className: 'ui-sec-acts' }, badge(__('secEnrolled', 'Enrolled'), true), smallBtn(__('passkeyRemove', 'Remove'), removePasskey))
          : (status.passkeySupported ? smallBtn(__('secAddPasskey', 'Add passkey'), addPasskey) : badge(__('secUnsupported', 'Unsupported'), false))),
        row(__('secRecovery', 'Recovery code'), status.hasRecovery ? React.createElement('div', { className: 'ui-sec-acts' }, badge(__('secActive', 'Active'), true), smallBtn(__('secRotate', 'Rotate'), createRecoveryKit, recoveryBusy)) : smallBtn(recoveryBusy ? __('creating', 'Creating…') : __('create', 'Create'), createRecoveryKit, recoveryBusy)),
        row(__('secDataKey', 'Encryption key'), smallBtn(__('secReplaceKey', 'Replace'), () => setRotateOpen((o) => !o), rotateBusy)),
        rotateOpen && React.createElement('div', { 'data-testid': 'rotate-key', className: 'ui-sec-rotate' },
          React.createElement('p', { className: 'ui-note' },
            __('secReplaceKeyHint', 'Re-encrypts everything under a new key. Use it when an old password, recovery code, passkey or a copy of this vault may be in other hands: none of them opens new data afterwards. The recovery code and passkey are removed (set them up again), and other synced devices need this vault again.')),
          React.createElement('div', { className: 'ui-ca-add' },
            React.createElement('input', { type: 'password', value: rotatePw, onChange: (e) => setRotatePw(e.target.value), onKeyDown: (e) => e.key === 'Enter' && rotateKey(), placeholder: t.currentPassword || 'Current Password', 'aria-label': t.currentPassword || 'Current Password', autoComplete: 'current-password', className: 'ui-input' }),
            smallBtn(rotateBusy ? __('working', 'Working…') : __('secReplaceKeyNow', 'Replace key'), rotateKey, rotateBusy || !rotatePw))),
        sectionTitle(__('secCloudSync', 'Cloud sync (zero-knowledge)')),
        React.createElement('p', { className: 'ui-note' }, __('secCloudSyncHint2', 'Your encrypted snapshot syncs through your own Worker, a file or a WebDAV folder. Each of them only ever sees ciphertext; the account id is derived from your vault.')),
        // The badge shows a failed last attempt instead of a green "Enabled" (FINDINGS H-6).
        row(__('secStatus', 'Status'), !syncOn ? badge(__('secNotEnabled', 'Not enabled'), false) : (() => {
          const st = (S && S.statusOf) ? S.statusOf(syncState) : { state: syncState && syncState.lastSyncAt ? 'ok' : 'never' };
          if (st.state === 'error') {
            return React.createElement('span', { role: 'status', title: st.message, className: ['ui-badge', 'tone-loss', 'ui-sec-err'].join(' ') },
              '! ' + (t.syncErrorBadge || 'Sync failed {ago}: {error}').replace('{ago}', fmtAgo(st.at)).replace('{error}', st.message));
          }
          return badge(__('syncEnabledLast', 'Enabled · last {ago}', { ago: fmtAgo(syncState && syncState.lastSyncAt) }), true);
        })()),
        // P5-5.6: the destination - your Worker, a local file or a WebDAV folder
        syncOn && TRs ? row(__('stDest', 'Destination'), React.createElement('span', { 'data-testid': 'sync-dest-name', className: 'ui-sec-dest' }, TRs.describe(syncCfg))) : null,
        React.createElement('div', { className: 'ui-actions' },
          syncOn ? smallBtn(syncBusy ? __('syncing', 'Syncing…') : __('syncNow', 'Sync now'), runSync, syncBusy) : null,
          syncOn && TRs && syncCfg && syncCfg.provider === 'file' && !(S && S.isConfigured()) ? smallBtn(__('stReconnect', 'Allow file access'), reconnectFile, syncBusy) : null,
          syncOn && TRs ? smallBtn(__('stStop', 'Stop syncing here'), stopSync, syncBusy) : null,
          syncOn || TRs ? null : smallBtn(syncBusy ? '…' : __('syncEnable', 'Enable & sync'), doEnableSync, syncBusy || !workerUrl)
        ),
        !syncOn && TRs ? React.createElement(TRs.Panel, { theme: currentTheme, workerUrl, busy: syncBusy, onConnect: connectSync }) : null,
        !TRs && !workerUrl && React.createElement('p', { className: ['ui-note', 'tone-warning'].join(' ') }, '! ' + __('syncNeedWorkerHint', 'Add a Worker URL in API Settings to enable sync.')),
        // P5-3.1: where market data comes from, and the shared price service switch
        sectionTitle(__('secMarketData', 'Market data')),
        React.createElement('p', { 'data-testid': 'shared-prices-info', className: 'ui-note' },
          __('secSharedHint', 'Prices, closes, exchange rates, symbol search and fund data come from your own Worker. Without one, the app can use the MAERMIN price service run by the project owner: it only serves market data, sees the symbols you ask about (never amounts, quantities or your vault), keeps no logs beyond its cache, and is never used for sync, share links or broker connections. Your own Worker always wins.')),
        row(__('secSource', 'Source'), badge(workerUrl ? __('secSourceOwn', 'Your Worker') : usingSharedPrices ? __('secSourceShared', 'MAERMIN price service') : __('secSourceNone', 'None (offline prices)'), !!(workerUrl || usingSharedPrices))),
        row(__('secSharedSwitch', 'Use the price service without an own Worker'), React.createElement('label', { className: 'ui-sec-switch' },
          React.createElement('input', { type: 'checkbox', 'data-testid': 'shared-prices-toggle', checked: (window.MaerminSharedWorker ? window.MaerminSharedWorker.enabledFrom(sharedPrices) : false),
            'aria-label': __('secSharedSwitch', 'Use the price service without an own Worker'),
            onChange: (e) => setSharedPrices(e.target.checked), className: 'ui-st-check' }))),
        window.MaerminSharedWorker && !window.MaerminSharedWorker.SHARED_URL && React.createElement('p', { className: 'ui-note' },
          __('secSharedNotYet', 'The price service is not online yet; until then market data needs your own Worker.')),
        // P5-5.1: web push reminders through the user's own Worker
        window.MaerminPush && sectionTitle(__('secPush', 'Push notifications')),
        window.MaerminPush && React.createElement(window.MaerminPush.Panel, { theme: currentTheme, workerUrl: (apiKeys.cs2Worker || '').trim(), getCtx: pushCtx, addToast })
        )
      )
    );
  };

  // ========== MAIN RENDER ==========
  const Icon = window.MaerminIcon || (() => null);
  const Logo = (window.MaerminIcons && window.MaerminIcons.Logo) || (() => null);
  const themeChoices = [
    ['dark', t.darkMode || 'Dark', '#0f1018'], ['white', t.whiteMode || 'Light', '#ffffff'], ['purple', t.purpleMode || 'Nebula', '#140e24'],
    ['contrast', __('themeContrast', 'Contrast'), '#000000'], ['cb', __('themeCbSafe', 'Colour-blind'), '#1f8ad1']
  ];
  // Theme switch with a circular "portal" reveal from the click point
  // (View Transitions API). Falls back to an instant switch.
  const switchTheme = (th, e) => {
    if (th === theme) return;
    const vt = document.startViewTransition;
    const fxOn = !window.MaerminFX || window.MaerminFX.enabled();
    if (!vt || !fxOn || !ReactDOM.flushSync) { setTheme(th); return; }
    const x = e && e.clientX != null ? e.clientX : window.innerWidth - 60;
    const y = e && e.clientY != null ? e.clientY : 40;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const root = document.documentElement;
    root.style.setProperty('--vt-x', x + 'px');
    root.style.setProperty('--vt-y', y + 'px');
    root.style.setProperty('--vt-r', r + 'px');
    root.classList.add('mx-vt-theme');
    const tr = document.startViewTransition(() => {
      ReactDOM.flushSync(() => setTheme(th));
      root.setAttribute('data-theme', th);
      root.setAttribute('data-mode', (themes[th] && themes[th].mode) || 'dark');
    });
    tr.finished.finally(() => root.classList.remove('mx-vt-theme'));
  };
  const segBtn = (key, on, onClick, children, extra) => React.createElement('button', Object.assign({ key, type: 'button', className: on ? 'is-on' : '', onClick, 'aria-pressed': on }, extra || {}), children);
  const switchUiMode = (mode) => {
    if (mode === uiMode) return;
    setUiMode(mode);
    addToast(mode === 'simple' ? (t.uiModeSwitchedSimple || 'Simple view: niche tools are hidden') : (t.uiModeSwitchedAdvanced || 'Advanced view: all tools are shown'), 'info');
  };

  // P2-1: the tabs of a merged page (e.g. Returns · Performance · Attribution).
  // The views of the area are the page tabs in the header (R2.1); R2.2 turns
  // this second row into a segmented control (B-3).
  const renderAreaNav = () => {
    const Nav = window.MaerminNav;
    const tabs = Nav.tabsFor(activeView, uiMode);
    const current = Nav.canonical(activeView);
    if (!tabs.length) return null;
    return React.createElement('div', { className: 'mx-area-nav' },
      React.createElement(window.MaerminComponents.Segmented, {
        className: 'mx-area-tabs', label: t.navAreaTabs || 'Sections', value: current,
        onChange: (id) => { if (id !== current) setActiveView(id); },
        options: tabs.map(x => ({ value: x.id, label: Nav.label(x, t), attrs: { 'data-tab': x.id } }))
      })
    );
  };

  // R2.1 (PLAN Phase 6): the shell. Desktop: rail · page header · main. Phone:
  // the page header is the top bar and a dock replaces the rail (B-2). The
  // areas and their views come from nav-model.js (B-1 labels); view ids,
  // aliases, g+key shortcuts and deep links are unchanged.
  const goArea = (areaId) => {
    const Nav = window.MaerminNav;
    if (Nav.areaOf(activeView) !== areaId) setActiveView(Nav.firstView(areaId, uiMode));
  };
  const MORE_AREAS = ['taxes', 'analysis', 'settings'];

  // R2.3: one demo banner for every view, with the one way out (it was a
  // banner plus a second "Exit demo" button, both on the Overview only).
  const renderDemoBanner = () => demoMode && React.createElement('div', { className: 'ui-demo-banner', 'data-testid': 'demo-banner' },
    React.createElement('span', null, __('demoBanner', '★ You are exploring MAERMIN with sample data — your real data is untouched. Changes made in demo mode are not saved.')),
    React.createElement(window.MaerminComponents.Button, { variant: 'secondary', size: 'sm', onClick: exitDemo }, __('demoExit', 'Exit demo')));

  const renderRail = () => {
    const Nav = window.MaerminNav, C = window.MaerminComponents;
    const current = Nav.areaOf(activeView) || 'portfolio';
    return React.createElement(C.Rail, {
      label: __('mainNav', 'Main'), onSelect: goArea,
      brand: React.createElement(React.Fragment, null,
        Logo({ size: 34 }),
        React.createElement('span', { className: 'ui-rail__version', 'data-testid': 'brand-version' }, 'v' + String((window.MaerminBackup && window.MaerminBackup.VERSION) || '').split('.')[0])),
      items: Nav.AREAS.map((a) => ({ id: a.id, label: Nav.label(a, t), icon: a.icon, active: a.id === current, foot: a.id === 'settings' }))
    });
  };

  const renderPageHeader = (popover) => {
    const Nav = window.MaerminNav, C = window.MaerminComponents;
    const areaId = Nav.areaOf(activeView) || 'portfolio';
    const entries = Nav.visibleEntries(areaId, uiMode, activeView);
    const activeEntry = entries.find((e) => Nav.entryActive(e, activeView));
    const pageTabs = entries.length > 1 && React.createElement(C.PageTabs, {
      label: Nav.label(Nav.getArea(areaId), t),
      value: activeEntry ? activeEntry.id : null,
      tabs: entries.map((e) => ({
        id: e.id, label: Nav.label(e, t),
        attrs: e.tabs ? { 'data-group': e.id, 'data-views': e.tabs.map((x) => x.id).join(' ') } : { 'data-view': e.id }
      })),
      onChange: (id) => {
        const e = entries.find((x) => x.id === id);
        if (e && !Nav.entryActive(e, activeView)) setActiveView(Nav.entryTarget(e, uiMode));
      }
    });
    const hiddenCount = uiMode === 'simple'
      ? Nav.AREAS.reduce((n, a) => n + a.entries.reduce((m, e) => m + (e.tabs || [e]).filter(x => x.advanced).length, 0), 0)
      : 0;
    const modeHint = uiMode === 'simple' && React.createElement('div', { className: 'mx-mode-hint' },
      React.createElement('span', null, window.MaerminI18n.fill(t.uiModeHidden || 'Simple view: {n} tools hidden', { n: hiddenCount })),
      React.createElement('button', { type: 'button', 'data-ui-mode': 'advanced', title: window.MaerminI18n.fill(t.uiModeHidden || 'Simple view: {n} tools hidden', { n: hiddenCount }), onClick: () => switchUiMode('advanced') }, t.uiModeShowAll || 'Show all tools')
    );
    const ALL = window.MaerminMetrics.ALL_PORTFOLIOS;
    const scope = areaId !== 'settings' && portfolios.length > 1 && React.createElement(C.Select, {
      'aria-label': __('ovShowPortfolio', 'Show portfolio'), 'data-testid': 'scope-select',
      value: isAllActive ? ALL : activePortfolioId,
      onChange: (e) => setActivePortfolioId(e.target.value),
      options: [{ value: ALL, label: __('allPortfolios', 'All Portfolios') }].concat(portfolios.map((p) => ({ value: p.id, label: p.name })))
    });
    const hideLabel = privacyMode ? (t.showAmounts || 'Show amounts') : (t.hideAmounts || 'Hide amounts');
    return React.createElement(C.PageHeader, {
      title: Nav.viewTitle(activeView, t) || 'MAERMIN',
      brand: Logo({ size: 30 }),
      scope,
      actions: [
        React.createElement(C.Button, {
          key: 'search', variant: 'quiet', className: 'ui-search', icon: Icon('search', { size: 16 }), kbd: '⌘K',
          'aria-label': t.searchCommands || 'Search features & jump to…',
          onClick: () => window.MaerminUI.openOverlay('commandPalette')
        }, __('navSearch', 'Search')),
        React.createElement(C.IconButton, {
          key: 'privacy', label: hideLabel, pressed: privacyMode, icon: Icon(privacyMode ? 'eye-off' : 'eye', { size: 18 }),
          onClick: () => setPrivacyMode(p => !p)
        }),
        // The account menu: a plain button (Escape focuses it again through
        // settingsBtnRef) and its popover; a click outside the pair closes it.
        React.createElement('div', { key: 'settings', className: 'ui-settings', ref: settingsRef },
          React.createElement('button', {
            type: 'button', ref: settingsBtnRef,
            className: 'ui-icon-btn ui-icon-btn--md ui-settings-btn' + (showSettings ? ' is-on' : ''),
            onClick: () => setShowSettings(!showSettings),
            title: t.settings || 'Settings', 'aria-label': t.settings || 'Settings',
            'aria-expanded': showSettings, 'aria-controls': 'mx-settings-panel'
          }, Icon('settings', { size: 18 })),
          popover || null),
        React.createElement(C.Button, {
          key: 'add', variant: 'primary', className: 'ui-add', icon: Icon('plus', { size: 16 }),
          onClick: () => openTransactionModal()
        }, t.addTransaction || 'Add Transaction')
      ],
      tabs: (pageTabs || modeHint) ? React.createElement(React.Fragment, null, pageTabs || React.createElement('div', { className: 'ui-tabs' }), modeHint) : null
    });
  };

  // B-2: Home · Activity · Add · Income · More; Tax, Insight and Settings sit in "More".
  const renderDock = () => {
    const Nav = window.MaerminNav, C = window.MaerminComponents;
    const current = Nav.areaOf(activeView) || 'portfolio';
    const area = (id) => { const a = Nav.getArea(id); return { id, label: Nav.label(a, t), icon: a.icon, active: current === id, onClick: () => goArea(id) }; };
    const items = [
      area('portfolio'), area('transactions'),
      { id: 'add', add: true, label: t.addTransaction || 'Add Transaction', icon: 'plus', onClick: () => openTransactionModal() },
      area('dividends'),
      { id: 'more', label: __('navMore', 'More'), icon: 'more', active: MORE_AREAS.indexOf(current) > -1, haspopup: 'dialog', expanded: showMoreNav, onClick: () => setShowMoreNav(true) }
    ];
    return React.createElement(React.Fragment, null,
      React.createElement(C.Dock, { label: __('primaryNav', 'Primary'), items }),
      React.createElement(C.Modal, { open: showMoreNav, title: __('navMore', 'More'), onClose: () => setShowMoreNav(false), 'data-testid': 'more-nav' },
        React.createElement('div', { className: 'ui-more' },
          MORE_AREAS.map((id) => {
            const a = Nav.getArea(id), on = current === id;
            return React.createElement('button', {
              key: id, type: 'button', 'data-area': id, className: 'ui-more__item' + (on ? ' is-active' : ''), 'aria-current': on ? 'true' : undefined,
              onClick: () => { setShowMoreNav(false); goArea(id); }
            }, Icon(a.icon, { size: 20 }), React.createElement('span', null, Nav.label(a, t)));
          })))
    );
  };

  const menuItem = (icon, label, onClick, danger) => React.createElement('button', { type: 'button', className: 'mx-menu-item' + (danger ? ' is-danger' : ''), onClick }, Icon(icon, { size: 16 }), React.createElement('span', null, label));
  const popLabel = (text) => React.createElement('span', { className: 'mx-pop-label' }, text);


  // Views defined inside this component were new component types on every
  // render, so React remounted them and dropped their state (a pasted backup,
  // the chosen tab, a half-typed Freistellungsauftrag) whenever the app
  // re-rendered - at least every minute with the Worker status check
  // (Phase 3). Each gets one stable component that runs the latest closure.
  const latestViews = useRef({});
  latestViews.current = { DataManagementView, DividendsCombinedView, TaxCombinedView };
  const StableViews = useMemo(() => {
    const out = {};
    Object.keys(latestViews.current).forEach((name) => {
      const C = (props) => latestViews.current[name](props);
      C.displayName = name;
      out[name] = C;
    });
    return out;
  }, []);

  return React.createElement('div', {
    className: 'mx-app',
    'data-theme': currentTheme.name || theme
  },
    // Skip link: first Tab stop, jumps past header and sidebar
    React.createElement('a', {
      href: '#main', className: 'mx-skip-link',
      onClick: (e) => { e.preventDefault(); const m = document.getElementById('main'); if (m) m.focus(); }
    }, t.skipToContent || 'Skip to content'),
    // R2.1: rail · page header · main (desktop); top bar · main · dock (phone)
    React.createElement('div', { className: 'ui-shell' },
      renderRail(),
      React.createElement('div', { className: 'ui-shell__main' },
        renderPageHeader(showSettings && React.createElement('div', { className: 'mx-popover', id: 'mx-settings-panel', role: 'group', 'aria-label': t.settings || 'Settings' },
            // R5.4: popover sections and switches on classes
            React.createElement('div', { className: 'mx-pop-sec' },
              popLabel(t.theme || 'Theme'),
              React.createElement('div', { className: 'mx-seg' },
                themeChoices.map(([th, lbl, sw]) => segBtn(th, theme === th, (e) => switchTheme(th, e), [
                  React.createElement('span', { key: 's', className: 'mx-swatch', style: { background: sw } }),
                  React.createElement('span', { key: 'l', className: 'mx-seg__lbl' }, lbl)
                ], { title: lbl }))
              )
            ),
            React.createElement('div', { className: ['mx-pop-sec', 'mx-pop-grid'].join(' ') },
              React.createElement('div', null,
                popLabel(t.language || 'Language'),
                React.createElement('div', { className: 'mx-seg' },
                  [['en', 'EN'], ['de', 'DE']].map(([lng, lbl]) => segBtn(lng, language === lng, () => setLanguage(lng), lbl, { title: lng === 'en' ? 'English' : 'Deutsch' }))
                )
              ),
              React.createElement('div', null,
                popLabel(t.currency || 'Currency'),
                React.createElement('div', { className: 'mx-seg' },
                  ['EUR', 'USD'].map(curr => segBtn(curr, currency === curr, () => setCurrency(curr), curr === 'EUR' ? '€ EUR' : '$ USD'))
                )
              )
            ),
            React.createElement('div', { className: 'mx-pop-sec' },
              popLabel(t.uiMode || 'View'),
              React.createElement('div', { className: 'mx-seg' },
                [['simple', t.uiModeSimple || 'Simple'], ['advanced', t.uiModeAdvanced || 'Advanced']].map(([m, lbl]) => segBtn(m, uiMode === m, () => switchUiMode(m), lbl, { 'data-ui-mode': m }))
              )
            ),
            React.createElement('div', { className: 'mx-pop-sec' },
              popLabel(t.privacy || 'Privacy'),
              React.createElement('button', {
                type: 'button',
                className: 'mx-menu-item',
                onClick: () => setPrivacyMode(p => !p),
                title: __('shortcutP', 'Shortcut: p'),
                'aria-pressed': !!privacyMode, 'data-switch': 'privacy'
              },
                React.createElement('span', { className: 'mx-menu-item__main' }, Icon(privacyMode ? 'eye-off' : 'eye', { size: 16 }), t.hideAmounts || 'Hide amounts'),
                React.createElement('span', { className: ['mx-switch', privacyMode ? 'is-on' : ''].join(' ').trim(), 'aria-hidden': 'true' }, React.createElement('span', { className: 'mx-switch__knob' }))
              )
            ),
            // Motion effects (Aurora FX) — toggling reloads so every surface re-inits.
            window.MaerminFX && React.createElement('div', { className: 'mx-pop-sec' },
              popLabel(__('motion', 'Motion')),
              React.createElement('button', {
                type: 'button',
                className: 'mx-menu-item',
                onClick: () => window.MaerminFX.setEnabled(!window.MaerminFX.enabled()),
                'aria-pressed': window.MaerminFX.enabled(), 'data-switch': 'motion'
              },
                React.createElement('span', { className: 'mx-menu-item__main' }, Icon('sparkle', { size: 16 }), __('motionEffects', 'Animations & effects')),
                React.createElement('span', { className: ['mx-switch', window.MaerminFX.enabled() ? 'is-on' : ''].join(' ').trim(), 'aria-hidden': 'true' }, React.createElement('span', { className: 'mx-switch__knob' }))
              )
            ),
            // Corporate actions (stock splits) — global list. Per-symbol add/scan
            // lives in the position detail modal; this is the cross-holding view.
            (function () {
              var CA = window.MaerminCorporateActions;
              if (!CA) return null;
              var all = CA.listFor();
              if (!all.length) return null;
              var removeOne = function (a) {
                askConfirm({ title: t.caRemoveConfirm || 'Remove this split?', message: __('caRemoveMsg', '{sym} {ratio} on {date}. It can be re-added or re-scanned.', { sym: a.symbol, ratio: a.num + ':' + a.den, date: window.MaerminI18n.date(a.date) }), confirmLabel: t.caRemove || 'Remove', danger: true })
                  .then(function (yes) { if (!yes) return; CA.remove(a.id); setCorpActionsRev(function (n) { return n + 1; }); });
              };
              return React.createElement('div', { key: 'corp-' + corpActionsRev, className: 'mx-pop-sec' },
                popLabel(t.caTitle || 'Corporate actions (splits)'),
                React.createElement('ul', { className: 'mx-pop-list' },
                  all.map(function (a) {
                    return React.createElement('li', { key: a.id, className: 'mx-pop-list__row' },
                      React.createElement('b', null, a.symbol + ' ' + a.num + ':' + a.den),
                      React.createElement('span', { className: 'num' }, a.date),
                      React.createElement(window.MaerminComponents.IconButton, { size: 'sm', label: (t.caRemove || 'Remove') + ' ' + a.symbol, onClick: function () { removeOne(a); }, icon: React.createElement('span', { 'aria-hidden': 'true' }, '×') })
                    );
                  })
                )
              );
            })(),
            // P5-3.10: symbol / ISIN changes, mergers, spin-offs - global list
            (function () {
              var CA = window.MaerminCorporateActions;
              if (!CA || !CA.eventsFor) return null;
              var all = CA.eventsFor();
              if (!all.length) return null;
              var removeOne = function (ev) {
                askConfirm({ title: __('ceRemoveTitle', 'Remove this corporate action?'), message: CA.describeEvent(ev), confirmLabel: t.caRemove || 'Remove', danger: true })
                  .then(function (yes) { if (!yes) return; CA.removeEvent(ev.id); setCorpActionsRev(function (n) { return n + 1; }); });
              };
              return React.createElement('div', { key: 'ce-' + corpActionsRev, className: 'mx-pop-sec' },
                popLabel(__('ceTitle', 'Other corporate actions')),
                React.createElement('ul', { className: 'mx-pop-list' },
                  all.map(function (ev) {
                    return React.createElement('li', { key: ev.id, className: 'mx-pop-list__row' },
                      React.createElement('b', null, CA.describeEvent(ev)),
                      React.createElement('span', { className: 'num' }, ev.date),
                      React.createElement(window.MaerminComponents.IconButton, { size: 'sm', label: (t.caRemove || 'Remove') + ' ' + ev.symbol, onClick: function () { removeOne(ev); }, icon: React.createElement('span', { 'aria-hidden': 'true' }, '×') })
                    );
                  })
                )
              );
            })(),
            React.createElement('div', { className: 'mx-divider' }),
            menuItem('key', t.changePassword || 'Change Password', () => { setShowSettings(false); setShowPasswordModal(true); }),
            menuItem('data', t.apiSettings || 'API Settings', () => { setShowSettings(false); setShowApiSettings(true); }),
            menuItem('shield', __('securitySync', 'Security & sync'), () => { setShowSettings(false); setShowSecurity(true); }),
            React.createElement('div', { className: 'mx-divider' }),
            // Encrypted vault backup (downloadVaultBackup).
            menuItem('download', t.backupVault || 'Backup vault (encrypted)', downloadVaultBackup),
            // Restore from an encrypted backup file → reload → unlock with password.
            menuItem('upload', t.restoreVault || 'Restore vault backup', () => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = 'application/json,.json';
                input.onchange = () => {
                  const file = input.files && input.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    let obj; try { obj = JSON.parse(reader.result); } catch { addToast(__('backupInvalidFile', 'Invalid backup file'), 'error'); return; }
                    askConfirm({ title: __('vaultRestoreTitle', 'Restore this encrypted backup?'), message: __('vaultRestoreMsg', "It replaces the current vault. You will need the backup's password to unlock."), confirmLabel: __('vaultReplace', 'Replace vault'), danger: true }).then((yes) => {
                      if (!yes) return;
                      window.MaerminStorage.importEncryptedBackup(obj)
                        .then(() => { if (window.MaerminAuditLog) window.MaerminAuditLog.record('vault.backup.restore', 'encrypted vault backup restored'); addToast(__('backupRestoredReload', 'Backup restored — reloading…'), 'success'); setTimeout(() => window.location.reload(), 800); })
                        .catch((e) => addToast(__('restoreFailedMsg', 'Restore failed: {msg}', { msg: (e && e.message) || (t.error || 'Error') }), 'error'));
                    });
                  };
                  reader.readAsText(file);
                };
                input.click();
              }),
            menuItem('log', t.securityLog || 'Security log', () => { setShowSettings(false); setShowAuditLog(true); }),
            React.createElement('div', { className: 'mx-divider' }),
            menuItem('logout', t.logout || 'Logout', () => { if (window.MaerminAuth) window.MaerminAuth.logout(); }, true)
          )),
        React.createElement('main', { className: 'maermin-main', id: 'main', tabIndex: -1 },
          renderDemoBanner(), renderAtRestBanner(), renderAreaNav(), React.createElement(ViewErrorBoundary, { viewKey: activeView, theme: currentTheme }, renderView()))
      )
    ),
    renderDock(),

    // Modals
    renderTransactionModal(),
    renderImportModal(),
    renderApiSettingsModal(),
    renderPasswordModal(),
    renderAuditLogModal(),
    renderOnboardingWizard(),
    renderRecoveryKitModal(),
    renderSecurityModal(),

    // Command Palette
    window.CommandPalette && React.createElement(window.CommandPalette, {
      isOpen: showCommandPalette,
      onClose: () => window.MaerminUI.closeOverlay('commandPalette'),
      onExecute: executeCommand,
      commands: commands,
      t: t
    }),
    
    // Shortcuts Modal
    window.ShortcutsModal && React.createElement(window.ShortcutsModal, {
      isOpen: showShortcuts,
      onClose: () => window.MaerminUI.closeOverlay('shortcuts'),
      commands: commands,
      t: t,
      theme: currentTheme
    }),
    
    // Toast notifications — own slice of MaerminStore; re-renders independently
    // of the app on add/expire (see ui-store.js).
    window.MaerminUI && React.createElement(window.MaerminUI.ToastContainer, { theme: currentTheme }),
    window.MaerminUI && window.MaerminUI.ConfirmHost && React.createElement(window.MaerminUI.ConfirmHost, { theme: currentTheme })
  );
}

// ============================================================================
// RENDER APPLICATION
// ============================================================================

const root = ReactDOM.createRoot(document.getElementById('root'));
let __maerminMountKey = 0;
let __maerminMounted = false;
function __maerminRender() {
  __maerminMountKey += 1;
  __maerminMounted = true;
  root.render(React.createElement(InvestmentTracker, { key: 'app-' + __maerminMountKey }));
}
function __maerminUnmount() {
  if (!__maerminMounted) return;
  __maerminMounted = false;
  root.render(null);
  // Drop cached market data that reveals holdings; it is re-read on unlock.
  try { if (window.MaerminMarket) { window.MaerminMarket.set('priceHistory', {}); window.MaerminMarket.set('prices', {}); } } catch (e) {}
}
// Cloud sync pulls once after every unlock, before the catch-up writers
// (interest, dividends, savings plans) may book anything: they wait for
// __maerminStartupSync (see `startupSynced` in InvestmentTracker). The pull
// never blocks longer than its timeout; a pull that changes local data
// remounts the app through the onChange listener below (FINDINGS H-6).
let __maerminStartupSync = Promise.resolve();
let __maerminStartupSyncDone = true;
function __maerminStartSync() {
  const S = window.MaerminSync;
  if (!S || !S.syncOnStart) return;
  let endpoint = '';
  try { endpoint = ((JSON.parse(localStorage.getItem('apiKeys') || '{}') || {}).cs2Worker || '').trim(); } catch (e) {}
  __maerminStartupSyncDone = false;
  __maerminStartupSync = S.syncOnStart({ timeoutMs: 8000, endpoint })
    .then((r) => {
      if (r && r.ran && S.enableAutoSync) S.enableAutoSync();
      if (r && r.ran && !r.ok) console.warn('[sync] start-up sync', r.timedOut ? 'timed out' : 'failed: ' + r.error);
    })
    .catch(() => {})
    .then(() => { __maerminStartupSyncDone = true; });
}
let __maerminHooksBound = false;
function __maerminBindLifecycle() {
  if (__maerminHooksBound) return;
  __maerminHooksBound = true;
  try { if (window.MaerminVault && window.MaerminVault.onLock) window.MaerminVault.onLock(__maerminUnmount); } catch (e) {}
  try { if (window.MaerminAuth && window.MaerminAuth.onUnlock) window.MaerminAuth.onUnlock(() => { if (!__maerminMounted) { __maerminStartSync(); __maerminRender(); } }); } catch (e) {}
  try {
    if (window.MaerminSync && window.MaerminSync.onChange) {
      window.MaerminSync.onChange((ev) => {
        const r = ev && ev.type === 'done' && ev.result;
        if (r && __maerminMounted && r.appliedLocal) __maerminRender();
      });
    }
  } catch (e) {}
}
function __maerminMount() {
  const start = () => {
    __maerminBindLifecycle();
    __maerminStartSync();
    __maerminRender();
    dbg('[MAERMIN v12.2] Application initialized');
  };
  // Bring saved data up to the current schema BEFORE the app reads it (runs
  // post-unlock, so encrypted data is already hydrated and readable). A
  // pending migration first gets an encrypted copy of the data (P4-0); when
  // that copy cannot be written, the migrations wait for the next load.
  const PM = window.MaerminPreMigration;
  if (PM && window.MaerminMigrations) {
    PM.guardedRun().catch((e) => console.error('[migrations]', e)).then(start);
    return;
  }
  try { if (window.MaerminMigrations) window.MaerminMigrations.run(); } catch (e) { console.error('[migrations]', e); }
  start();
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

