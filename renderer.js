// ============================================================================
// MAERMIN v10.0 - Main Application
// Professional Multi-Asset Portfolio Tracker with Advanced Investment Analytics
// ============================================================================

(function() {
'use strict';

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
    const th = this.props.theme || {};
    return React.createElement('div', { style: { padding: '2rem' } },
      React.createElement('div', { style: { maxWidth: 520, margin: '2rem auto', textAlign: 'center', background: th.card || '#141a25', border: `1px solid ${th.cardBorder || 'rgba(255,255,255,0.08)'}`, borderRadius: '14px', padding: '2rem' } },
        React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', fontWeight: '700' } }, '!'),
        React.createElement('div', { style: { color: th.text || '#e9edf4', fontWeight: 800, fontSize: '1.05rem', marginBottom: '0.5rem' } }, 'This view hit an error'),
        React.createElement('div', { style: { color: th.textSecondary || '#8b94a7', fontSize: '0.85rem', marginBottom: '1.25rem' } }, 'Your data is safe. Try this view again or switch to another.'),
        React.createElement('div', { style: { color: th.textSecondary || '#8b94a7', fontSize: '0.72rem', fontFamily: 'ui-monospace,monospace', marginBottom: '1.25rem', wordBreak: 'break-word', opacity: 0.8 } }, String(this.state.error && this.state.error.message || this.state.error)),
        React.createElement('button', { onClick: () => this.setState({ error: null }),
          style: { padding: '0.5rem 1.1rem', background: th.accent || '#8b7cff', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' } }, 'Retry')
      )
    );
  }
}

// Get translations
const translations = typeof window.completeTranslations !== 'undefined' ? window.completeTranslations : { en: {} };

// Theme configuration
// ── Design system: "Aurora" ─────────────────────────────────────────────────
// Deep ink canvas lit by soft violet/cyan aurora glows, crisp elevated
// surfaces, Geist typography and a single electric-violet accent. Every
// component reads `currentTheme.*` as inline styles, so these tokens drive the
// entire UI. `name` / `mode` are consumed by the shell and styles.css (the
// root element gets data-theme / data-mode) — all other tokens are unchanged
// in shape so existing call sites keep working.
const ACCENT = '#8b7cff';       // electric violet — primary accent on dark
const ACCENT_DEEP = '#6d5dfc';  // deeper violet for light surfaces / hovers
const ON_ACCENT = '#ffffff';    // text on accent fills

const themes = {
  dark: {
    name: 'dark', mode: 'dark',
    background: 'radial-gradient(900px 520px at 12% -8%, rgba(124,92,255,0.20) 0%, transparent 62%), radial-gradient(760px 480px at 92% -6%, rgba(56,189,248,0.10) 0%, transparent 60%), radial-gradient(1200px 800px at 50% 120%, rgba(124,92,255,0.07) 0%, transparent 60%), #07080d',
    card: '#0f1018',
    surface2: '#171824',
    cardBorder: 'rgba(255,255,255,0.07)',
    modalBg: '#12131d',
    modalBorder: 'rgba(255,255,255,0.10)',
    text: '#f1f2f8',
    textSecondary: '#8d91a7',
    inputBg: '#0b0c13',
    inputBorder: 'rgba(255,255,255,0.09)',
    accent: ACCENT,
    accentText: ON_ACCENT,
    accentSoft: 'rgba(139,124,255,0.14)',
    accentGradient: 'linear-gradient(135deg, #a597ff 0%, #7c6cff 50%, #5b8cff 100%)',
    glass: 'rgba(12,13,20,0.66)',
    shadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 48px -24px rgba(0,0,0,0.7)',
    success: '#3ddc97',
    danger: '#ff6b81',
    warning: '#ffb454'
  },
  white: {
    name: 'white', mode: 'light',
    background: 'radial-gradient(900px 520px at 10% -10%, rgba(124,92,255,0.12) 0%, transparent 60%), radial-gradient(760px 480px at 95% -8%, rgba(56,189,248,0.10) 0%, transparent 60%), #f6f7fb',
    card: '#ffffff',
    surface2: '#f2f3f9',
    cardBorder: 'rgba(17,19,40,0.08)',
    modalBg: '#ffffff',
    modalBorder: 'rgba(17,19,40,0.10)',
    text: '#0d0f1c',
    textSecondary: '#5d6278',
    inputBg: '#f3f4f9',
    inputBorder: 'rgba(17,19,40,0.12)',
    accent: ACCENT_DEEP,
    accentText: ON_ACCENT,
    accentSoft: 'rgba(109,93,252,0.10)',
    accentGradient: 'linear-gradient(135deg, #8b7cff 0%, #6d5dfc 50%, #3f6fff 100%)',
    glass: 'rgba(255,255,255,0.72)',
    shadow: '0 1px 2px rgba(17,19,40,0.04), 0 18px 40px -22px rgba(17,19,40,0.18)',
    success: '#0f9f68',
    danger: '#e5484d',
    warning: '#d97706'
  },
  // "Nebula" — the purple theme, re-imagined as a deep violet night sky.
  purple: {
    name: 'purple', mode: 'dark',
    background: 'radial-gradient(900px 560px at 15% -10%, rgba(168,85,247,0.26) 0%, transparent 62%), radial-gradient(800px 520px at 90% 0%, rgba(236,72,153,0.12) 0%, transparent 60%), #0b0716',
    card: '#140e24',
    surface2: '#1c1530',
    cardBorder: 'rgba(255,255,255,0.08)',
    modalBg: '#181029',
    modalBorder: 'rgba(255,255,255,0.12)',
    text: '#f5f0ff',
    textSecondary: '#a597c2',
    inputBg: '#100a1d',
    inputBorder: 'rgba(255,255,255,0.10)',
    accent: '#b26bff',
    accentText: ON_ACCENT,
    accentSoft: 'rgba(178,107,255,0.16)',
    accentGradient: 'linear-gradient(135deg, #d59bff 0%, #a855f7 50%, #ec4899 100%)',
    glass: 'rgba(14,9,26,0.66)',
    shadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 24px 48px -24px rgba(0,0,0,0.7)',
    success: '#3ddc97',
    danger: '#ff6b81',
    warning: '#ffb454'
  },
  // High-contrast theme (WCAG AAA-leaning): pure-black canvas, white text,
  // heavy borders. Accent chosen to clear 4.5:1 against both black and white.
  contrast: {
    name: 'contrast', mode: 'dark',
    background: '#000000',
    card: '#0a0a0a',
    surface2: '#161616',
    cardBorder: 'rgba(255,255,255,0.35)',
    modalBg: '#000000',
    modalBorder: 'rgba(255,255,255,0.5)',
    text: '#ffffff',
    textSecondary: '#d6d6d6',
    inputBg: '#000000',
    inputBorder: 'rgba(255,255,255,0.5)',
    accent: '#4d7cff',
    accentText: ON_ACCENT,
    accentSoft: 'rgba(77,124,255,0.22)',
    accentGradient: '#4d7cff',
    glass: 'rgba(0,0,0,0.9)',
    shadow: '0 0 0 1px rgba(255,255,255,0.25)',
    success: '#00e676',
    danger: '#ff5252',
    warning: '#ffb300'
  },
  // Colour-blind-safe (Okabe–Ito): positive = sky-blue, negative = orange,
  // never red/green. P&L colours flow from theme.success/danger.
  cb: {
    name: 'cb', mode: 'dark',
    background: 'radial-gradient(900px 520px at 12% -8%, rgba(0,114,178,0.22) 0%, transparent 62%), #07090d',
    card: '#0f1118',
    surface2: '#171a24',
    cardBorder: 'rgba(255,255,255,0.08)',
    modalBg: '#12141d',
    modalBorder: 'rgba(255,255,255,0.10)',
    text: '#f1f2f8',
    textSecondary: '#9aa1b4',
    inputBg: '#0b0d13',
    inputBorder: 'rgba(255,255,255,0.10)',
    accent: '#1f8ad1',
    accentText: ON_ACCENT,
    accentSoft: 'rgba(86,180,233,0.16)',
    accentGradient: 'linear-gradient(135deg, #56B4E9 0%, #0072B2 100%)',
    glass: 'rgba(12,13,20,0.66)',
    shadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 48px -24px rgba(0,0,0,0.7)',
    success: '#56B4E9',
    danger: '#E69F00',
    warning: '#F0E442'
  }
};

// ============================================================================
// PASSWORD CHANGE MODAL
// ============================================================================
function PasswordModal({ theme, t, onClose, addToast, restoreFocus }) {
  const [curPw, setCurPw]   = useState('');
  const [newPw, setNewPw]   = useState('');
  const [confPw, setConfPw] = useState('');
  const [busy, setBusy]     = useState(false);

  const handleChange = async () => {
    if (!curPw || !newPw || !confPw) return;
    if (newPw !== confPw) { addToast(t.passwordMismatch || 'Passwords do not match', 'error'); return; }
    if (newPw.length < 8)  { addToast('Password must be at least 8 characters', 'warning'); return; }
    // v11: real vault re-key (replaces the obsolete SHA-256 "copy hash to
    // auth.js" flow). MaerminAuth.changePassword re-derives the AES key and
    // re-encrypts the data blob under the new password — fully zero-knowledge.
    if (!window.MaerminAuth || typeof window.MaerminAuth.changePassword !== 'function') {
      addToast('Password change is unavailable in this build', 'error'); return;
    }
    setBusy(true);
    try {
      await window.MaerminAuth.changePassword(curPw, newPw);
      addToast(t.passwordChanged || 'Password changed. Re-generate your recovery code in Security settings.', 'success');
      setCurPw(''); setNewPw(''); setConfPw('');
      onClose();
    } catch (e) {
      const wrong = e && e.message === 'bad-password';
      addToast(wrong ? (t.passwordWrong || 'Current password is incorrect')
                     : 'Could not change the password. Please try again.', 'error');
    }
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

  return React.createElement(window.MaerminUI.Overlay, {
    onClose, restoreFocus,
    style: { position:'fixed',inset:0,background:'rgba(4,6,10,0.62)',display:'flex',justifyContent:'center',alignItems:'center',zIndex:10001,backdropFilter:'blur(8px)' }
  },
    React.createElement('div', {
      ...window.MaerminUI.dialogProps('dlg-password'),
      style: { background: theme.modalBg, border:`1px solid ${theme.modalBorder}`, borderRadius:'16px', padding:'2rem', width:'380px', maxWidth:'90vw', boxShadow:'0 25px 50px -12px rgba(0,0,0,0.5)' }
    },
      React.createElement('h2', { id: 'dlg-password', style:{ color:theme.text, fontSize:'1.25rem', fontWeight:'700', marginBottom:'1.25rem' } },
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
  const portfolios       = portfolioHook?.portfolios       || [{ id: 'default', name: 'Main Portfolio', color: '#8b7cff' }];
  const activePortfolioId = portfolioHook?.activePortfolioId || 'default';
  const setActivePortfolioId = portfolioHook?.setActivePortfolioId || (() => {});

  // Transactions - the source of truth for portfolio
  const [transactions, setTransactions] = useState(() => {
    // Demo mode seeds offline sample data instead of the user's store — and is
    // never persisted over it (see the guarded persistence effects below).
    if (window.MaerminDemo && window.MaerminDemo.isActive()) return window.MaerminDemo.getTransactions();
    const saved = localStorage.getItem('transactions');
    return window.MaerminUtils.safeParse(saved, []) || [];
  });
  // Demo mode: when on, the app runs entirely on offline sample data; the user's
  // real transactions/prices are neither read nor written.
  const [demoMode, setDemoMode] = useState(() => !!(window.MaerminDemo && window.MaerminDemo.isActive()));
  // v12: market data (prices, priceHistory, worker status, loading, lastRefresh)
  // lives in MaerminMarket (MaerminStore). Read each slice via useStore; the
  // setX shims delegate to the store and — crucially for the hot async fetch
  // path — read the CURRENT value from the store for functional updates, so
  // setPrices(prev => …) from fetchPrices is never stale. All call sites unchanged.
  // Worker reachability for the status indicator (null = not yet probed).
  const workerStatus = window.MaerminStore.useStore(window.MaerminMarket.store, s => s.workerStatus);
  const setWorkerStatus = (v) => window.MaerminMarket.set('workerStatus', typeof v === 'function' ? v(window.MaerminMarket.get('workerStatus')) : v);

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

  const fxAt = useMemo(
    () => (window.MaerminFxHistory ? window.MaerminFxHistory.fxResolver(exchangeRate) : null),
    [exchangeRate, fxHistVersion]
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
  const priceView = useMemo(
    () => window.MaerminMarket.effectivePrices(fetchedPrices, demoMode ? null : priceHistory, allPortfoliosPortfolio),
    [fetchedPrices, priceHistory, allPortfoliosPortfolio, demoMode]
  );
  const prices = priceView.prices;
  window.MaerminMarket.setCostKeys(priceView.costKeys);

  // Data checks from the one FIFO ledger: sells without enough open units and
  // transaction currencies without an exact EUR conversion. Both skew cost
  // basis and tax, so they are listed on the Transactions and Tax views.
  const ledgerIssues = useMemo(() => {
    const L = window.MaerminLedger;
    try { return L ? (L.build(transactions, { exchangeRate, fxAt }).issues || []) : []; } catch (e) { return []; }
  }, [transactions, exchangeRate, fxAt, corpActionsRev]);

  // Transactions filtered to the active portfolio
  const activeTransactions = useMemo(() =>
    transactions.filter(tx => (tx.portfolioId || 'default') === activePortfolioId),
  [transactions, activePortfolioId]);

  // Portfolio derived from transactions
  // Single active portfolio, derived from its transactions. Delegates to the
  // shared MaerminMetrics.buildPositions so this never drifts from the all-mode
  // build, the dividend/health calcs or the stats below.
  const portfolio = useMemo(
    () => window.MaerminMetrics.buildPositions(activeTransactions, { exchangeRate, fxAt }),
    // corpActionsRev: splits are an overlay read by buildPositions, so re-run it
    // when one is added/removed (they are not part of the transactions array).
    [activeTransactions, exchangeRate, fxAt, corpActionsRev]
  );
  
  // UI State
  const [activeTab, setActiveTab] = useState('crypto');
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
  const savingsCatchUp = React.useRef({ pendingToasted: false });
  useEffect(() => {
    const EX = window.MaerminSavingsExecutor;
    if (!EX || demoMode) return; // never book the user's plans into demo data
    const havePrices = Object.keys(fetchedPrices).length > 0;
    try {
      const plans = JSON.parse(localStorage.getItem(EX.PLANS_KEY) || '[]');
      if (!Array.isArray(plans) || !plans.length) return;
      // Effective history = the app's live priceHistory PLUS the per-symbol
      // historical series fetched for savings-plan symbols. That yields a real
      // close at/before each due date, so every buy is priced on its own day.
      const histEff = Object.assign({}, priceHistory, savingsHistory);
      const accurate = (sym, due) => EX.priceAtDate(histEff, fetchedPrices, sym, due);
      const resolvePrice = (plan, dueDate) => EX.priceForBackfill
        ? EX.priceForBackfill(histEff, fetchedPrices, plan.symbol, dueDate)
        : EX.priceAtDate(histEff, fetchedPrices, plan.symbol, dueDate);

      let working = transactions;
      // 1) Re-price earlier ESTIMATED auto-executions now that real history exists.
      if (EX.repriceEstimated) {
        const rep = EX.repriceEstimated(working, accurate, exchangeRate);
        if (rep.repriced) {
          working = rep.transactions;
          addToast(`${rep.repriced} estimated savings buy(s) repriced to the historical close`, 'success');
        }
      }
      // 2) Book any outstanding occurrences (real close when available, else a
      //    flagged estimate from the current price).
      const out = EX.runCatchUp(plans, working, resolvePrice, undefined, undefined, exchangeRate);
      if (out.created.length || out.removedDuplicates || working !== transactions) {
        setTransactions(out.transactions);
        if (out.created.length) addToast(`${out.created.length} savings-plan execution(s) booked`, 'success');
        if (out.removedDuplicates) addToast(`${out.removedDuplicates} duplicate auto-execution(s) removed after sync`, 'info');
      }
      if (out.pending.length && havePrices && !savingsCatchUp.current.pendingToasted) {
        savingsCatchUp.current.pendingToasted = true;
        addToast(`${out.pending.length} savings-plan execution(s) pending - no price for the symbol yet`, 'warning');
      }
    } catch (e) { console.warn('[SAVINGS] catch-up failed:', e); }
  }, [fetchedPrices, transactions, priceHistory, savingsHistory, exchangeRate, demoMode]);

  // WI-2: interest accrual catch-up for cash / time-deposit Net-Worth accounts.
  // On app open, grow each interest-bearing account's balance (act/365) and book
  // a type:'interest' transaction so the tax report counts it as capital income.
  // Idempotent: each accrual advances lastAccrualDate and each tx carries an
  // (accountId, periodEnd) marker, so re-runs never double-book.
  useEffect(() => {
    const IN = window.MaerminInterest;
    if (!IN || demoMode) return;
    try {
      const accounts = JSON.parse(localStorage.getItem('maermin_networth_accounts') || '[]');
      if (!Array.isArray(accounts) || !accounts.some(a => IN.isInterestBearing(a))) return;
      const ledger = IN.loadLedger();
      const out = IN.runCatchUp({ accounts, transactions, ledger, asOf: window.MaerminUtils.todayISO(), portfolioId: activePortfolioId });
      if (out.created.length) {
        localStorage.setItem('maermin_networth_accounts', JSON.stringify(out.accounts));
        IN.saveLedger(out.ledger);
        setTransactions(out.transactions);
        addToast(`${out.created.length} ${t.interestBookedToast || 'interest accrual(s) booked'}`, 'success');
      }
    } catch (e) { console.warn('[INTEREST] catch-up failed:', e); }
  }, [transactions, activePortfolioId, demoMode]);

  // v10.x: dividend auto-booking (opt-in, maermin_div_autobook). When enabled,
  // every dividend whose PAY date has passed is booked as a `type:'dividend'`
  // transaction in the PAYOUT currency (USD stays USD). Idempotent per
  // (symbol|payDate|portfolio) so re-runs never double-book. Amounts are an
  // ESTIMATE (current shares × DividendDataService per-share), hence opt-in.
  const [divAutoBook, setDivAutoBook] = useState(() => {
    try { return !!(window.MaerminDividendExecutor && window.MaerminDividendExecutor.isEnabled()); } catch (e) { return false; }
  });
  const bookDividends = useCallback((announce) => {
    const EX = window.MaerminDividendExecutor, DS = window.DividendDataService;
    if (!EX || !DS) { if (announce) addToast('Dividend engine not loaded', 'warning'); return; }
    try {
      const sched = DS.buildPaymentSchedule(portfolio, { back: 12, months: 0 });
      const out = EX.runCatchUp(sched, transactions, activePortfolioId, undefined, EX.loadSkipped ? EX.loadSkipped() : []);
      if (out.created.length) { setTransactions(out.transactions); addToast(`${out.created.length} ${t.divBookedToast || 'dividend(s) booked (estimated)'}`, 'success'); }
      else if (announce) { addToast(t.divNoneToBook || 'No new dividends to book', 'info'); }
    } catch (e) { console.warn('[DIV] booking failed:', e); }
  }, [portfolio, transactions, activePortfolioId]);
  const toggleDivAutoBook = useCallback(() => {
    setDivAutoBook(prev => {
      const next = !prev;
      try { window.MaerminDividendExecutor && window.MaerminDividendExecutor.setEnabled(next); } catch (e) {}
      return next;
    });
  }, []);
  useEffect(() => {
    if (demoMode || !divAutoBook) return;
    const EX = window.MaerminDividendExecutor, DS = window.DividendDataService;
    if (!EX || !DS) return;
    try {
      const sched = DS.buildPaymentSchedule(portfolio, { back: 12, months: 0 });
      const out = EX.runCatchUp(sched, transactions, activePortfolioId, undefined, EX.loadSkipped ? EX.loadSkipped() : []);
      if (out.created.length) { setTransactions(out.transactions); addToast(`${out.created.length} ${t.divAutoBookedToast || 'dividend(s) auto-booked (estimated)'}`, 'success'); }
    } catch (e) { /* best-effort */ }
  }, [divAutoBook, transactions, portfolio, activePortfolioId, demoMode]);

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
  // The form as it was when the dialog opened: closing a changed form asks first.
  const txInitialRef = useRef(null);
  // v12: modal open-states live in MaerminUI.overlays. Read the slice via
  // useStore; keep the setShowX name as a thin shim that delegates to the store,
  // so every existing call site (incl. the Escape handler + toggles) is unchanged.
  const showTransactionModal = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.transactionModal);
  const setShowTransactionModal = (v) => { const n = typeof v === 'function' ? v(showTransactionModal) : v; n ? window.MaerminUI.openOverlay('transactionModal') : window.MaerminUI.closeOverlay('transactionModal'); };
  const [overviewMode, setOverviewMode] = useState('all'); // 'all' | activePortfolioId
  // Which sidebar hub (Analytics / Discover & Tools) is expanded. '' = none.
  const [openHub, setOpenHub] = useState('');
  const [editingTransactionId, setEditingTransactionId] = useState(null); // null = adding new, id = editing
  const showImportModal = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.importModal);
  const setShowImportModal = (v) => { const n = typeof v === 'function' ? v(showImportModal) : v; n ? window.MaerminUI.openOverlay('importModal') : window.MaerminUI.closeOverlay('importModal'); };
  const [importData, setImportData] = useState('');
  const showAlertModal = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.alertModal);
  const setShowAlertModal = (v) => { const n = typeof v === 'function' ? v(showAlertModal) : v; n ? window.MaerminUI.openOverlay('alertModal') : window.MaerminUI.closeOverlay('alertModal'); };
  const showPasswordModal = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.passwordModal);
  const setShowPasswordModal = (v) => { const n = typeof v === 'function' ? v(showPasswordModal) : v; n ? window.MaerminUI.openOverlay('passwordModal') : window.MaerminUI.closeOverlay('passwordModal'); };
  const [apiKeys, setApiKeys] = useState(() => {
    try { return JSON.parse(localStorage.getItem('apiKeys') || '{}'); } catch { return {}; }
  });

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
      const nowSec = Math.floor(Date.now() / 1000);
      const workerBase = (apiKeys.cs2Worker || '').trim().replace(/\/$/, '');
      for (const s of syms) {
        try {
          let series = null;
          if (s.category === 'crypto') {
            const tkr = (s.symbol || '').toLowerCase();
            const id = CG_IDS[tkr] || tkr;
            const fromSec = Math.floor(new Date(s.start + 'T00:00:00Z').getTime() / 1000) - 86400;
            const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart/range?vs_currency=eur&from=${fromSec}&to=${nowSec}`;
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
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
              // USD closes convert at the rate OF THAT DAY (fxAt), not today's
              // live rate - otherwise every back-dated quantity carries today's FX.
              const rateAt = (d) => cur === 'EUR' ? 1 : ((fxAt && fxAt(d)) || exchangeRate || 0.92);
              series = (data.prices || [])
                .filter(r => r && typeof r.price === 'number' && r.price > 0)
                .map(r => { const ts = r.date || r.timestamp; return { timestamp: ts, price: r.price * rateAt(ts) }; });
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
      if (savingsHistFetch.current.sig === sig) savingsHistFetch.current.complete = Object.keys(histAdd).length >= syms.length;
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
    const rawBase = (apiKeys.cs2Worker || '').trim().replace(/\/$/, '');
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
  }, [transactions, apiKeys.cs2Worker, demoMode, lastRefresh, curTick]);
  // ── Daily close history → value path (TWR from day one) ───────────────────
  // priceHistory only has one point per refresh, so TWR, rolling volatility and
  // correlation stayed empty for days after an import. MaerminCloseHistory keeps
  // daily closes back to the first trade of every holding (stocks/commodities and
  // skins through the Worker, crypto from CoinGecko), persisted encrypted;
  // MaerminValuePath turns them + the transactions into the daily value path.
  // Best effort: without a Worker / offline the views fall back to the recorded
  // snapshots and the refresh history as before. Never runs in demo mode.
  const [closeHistory, setCloseHistory] = useState(() => (demoMode || !window.MaerminCloseHistory) ? null : window.MaerminCloseHistory.load());
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
    const rawBase = (apiKeys.cs2Worker || '').trim().replace(/\/$/, '');
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
      normalizeSkin: window.MaerminTickers && window.MaerminTickers.normalizeSkinName
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
  }, [transactions, apiKeys.cs2Worker, demoMode, lastRefresh, closeTick]);

  // Stored closes are in the quote currency; convert each to EUR at the rate of
  // its day: USD from the daily USD history, CHF / GBp & co. from the currency
  // history (MaerminFxHistory.currencyRateAt) where it reaches that day, else
  // today's cross rate.
  const closeSeriesEUR = useMemo(() => {
    const CH = window.MaerminCloseHistory, FXH = window.MaerminFxHistory;
    const out = {};
    if (!CH || !closeHistory || demoMode) return out;
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
  const valuePath = useMemo(() => {
    const VP = window.MaerminValuePath, CH = window.MaerminCloseHistory;
    if (!VP || !CH || demoMode || !Object.keys(closeSeriesEUR).length) return null;
    try {
      const live = {};
      Object.keys(closeSeriesEUR).forEach((k) => {
        const sym = k.slice(k.indexOf('|') + 1);
        const p = fetchedPrices[sym] > 0 ? fetchedPrices[sym] : fetchedPrices[sym.toLowerCase()];
        if (p > 0) live[k] = p;
      });
      const splits = {};
      const CA = window.MaerminCorporateActions;
      ((CA && CA.load && CA.load().actions) || []).forEach((a) => {
        const k = CH.keyOf(a.category, a.symbol);
        (splits[k] = splits[k] || []).push({ date: a.date, num: a.num, den: a.den });
      });
      return VP.build(activeTransactions, closeSeriesEUR, { today: window.MaerminUtils.todayISO(), exchangeRate, fxAt, live, splits });
    } catch (e) { console.warn('[HISTORY] value path failed:', e && e.message); return null; }
  }, [activeTransactions, closeSeriesEUR, fetchedPrices, exchangeRate, fxAt, corpActionsRev, demoMode]);

  // Inputs for the analytics views, all from the same daily closes:
  //   index   flow-neutral TWR index [{ d, v }] (≤ 3 years) - benchmark, rolling risk, factors
  //   bySymbol / byLower   per-holding closes on one date grid (≤ 1 year) for the
  //                        correlation matrix (display symbol) and risk metrics (lower-case)
  const dailyAnalytics = useMemo(() => {
    const VP = window.MaerminValuePath, CH = window.MaerminCloseHistory;
    const none = { index: [], bySymbol: {}, byLower: {}, since: null };
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
      return {
        index,
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

  // Onboarding wizard + recovery-kit enrollment (existing users)
  const showOnboarding = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.onboarding);
  const setShowOnboarding = (v) => { const n = typeof v === 'function' ? v(showOnboarding) : v; n ? window.MaerminUI.openOverlay('onboarding') : window.MaerminUI.closeOverlay('onboarding'); };
  const showRecoveryKit = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.recoveryKit);
  const setShowRecoveryKit = (v) => { const n = typeof v === 'function' ? v(showRecoveryKit) : v; n ? window.MaerminUI.openOverlay('recoveryKit') : window.MaerminUI.closeOverlay('recoveryKit'); };
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  // Security & Sync settings card
  const showSecurity = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.security);
  const setShowSecurity = (v) => { const n = typeof v === 'function' ? v(showSecurity) : v; n ? window.MaerminUI.openOverlay('security') : window.MaerminUI.closeOverlay('security'); };
  const [syncBusy, setSyncBusy] = useState(false);
  const [securityRev, setSecurityRev] = useState(0); // bump to re-read vault/sync status
  const [recoveryNudgeDismissed, setRecoveryNudgeDismissed] = useState(() => {
    try { return localStorage.getItem('maermin_recovery_nudge') === 'dismissed'; } catch (e) { return false; }
  });

  // Transactions filter/search
  const [txSearch, setTxSearch] = useState('');
  const [txSortBy, setTxSortBy] = useState('date-desc'); // date-desc, date-asc, amount-desc, symbol
  const [txDeleteConfirm, setTxDeleteConfirm] = useState(null); // txId waiting for confirm
  
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
  const [taxOwner, setTaxOwner] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_tax_owner') || '{}'); } catch { return {}; }
  });
  useEffect(() => { localStorage.setItem('maermin_tax_owner', JSON.stringify(taxOwner)); }, [taxOwner]);

  // Privacy mode — masks all monetary amounts (for screenshots / public viewing)
  const [privacyMode, setPrivacyMode] = useState(() => localStorage.getItem('privacyMode') === '1');

  // Bumped when async equity metadata (sector/country) is backfilled, so the
  // Strategy tab recomputes even if the user is already on it.
  const [metaVersion, setMetaVersion] = useState(0);

  // Security log viewer modal (reads window.MaerminAuditLog).
  const showAuditLog = window.MaerminStore.useStore(window.MaerminUI.overlays, s => !!s.auditLog);
  const setShowAuditLog = (v) => { const n = typeof v === 'function' ? v(showAuditLog) : v; n ? window.MaerminUI.openOverlay('auditLog') : window.MaerminUI.closeOverlay('auditLog'); };

  // ========== COMPUTED VALUES ==========
  
  // Merge: English is the base, the selected language overrides it — so any key
  // missing from a non-English locale gracefully falls back to English.
  const t = Object.assign({}, translations.en || {}, translations[language] || {});
  const currentTheme = themes[theme] || themes.dark;

  // Mirror the active theme onto <html> so CSS-only chrome (palette, toasts,
  // scrollbars, popovers, bottom dock) follows it via CSS variables.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', currentTheme.name || 'dark');
    root.setAttribute('data-mode', currentTheme.mode || 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', currentTheme.mode === 'light' ? '#f6f7fb' : (currentTheme.name === 'contrast' ? '#000000' : '#07080d'));
  }, [currentTheme]);
  
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

  const getCurrencySymbol = () => currency === 'EUR' ? '€' : '$';

  // Category display names
  const getCategoryDisplayName = (category) => {
    const displayNames = { crypto: t.crypto || 'Crypto', stocks: t.stocks || 'Stocks', skins: t.cs2Skins || 'CS2 Skins', commodities: 'Commodities', options: 'Options' };
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
    { id: 'nav:overview',      label: t.overview || 'Overview',            category: 'Portfolio',  shortcut: 'g o' },
    { id: 'nav:transactions',  label: t.transactions || 'Transactions',    category: 'Portfolio',  shortcut: 'g t' },
    { id: 'nav:dividends',     label: t.dividendCalendar || 'Dividends',   category: 'Portfolio',  shortcut: 'g d' },
    { id: 'nav:journal',       label: t.tradeJournal || 'Journal',         category: 'Portfolio',  shortcut: 'g j' },
    // Analysis
    { id: 'nav:returns',       label: t.returns || 'Returns & XIRR',       category: 'Analysis',   shortcut: 'g r' },
    { id: 'nav:performance',   label: t.navPerformance || 'Performance',   category: 'Analysis',   shortcut: 'g f' },
    { id: 'nav:rebalancing',   label: t.rebalancing || 'Rebalancing',      category: 'Analysis',   shortcut: 'g b' },
    { id: 'nav:analytics',     label: t.analytics || 'Portfolio Analysis', category: 'Analysis',   shortcut: 'g a' },
    { id: 'nav:taxes',         label: t.taxes || 'Taxes',                  category: 'Analysis',   shortcut: 'g x' },
    // Tools
    { id: 'nav:intelligence',  label: t.intelTitle || 'Portfolio Intelligence', category: 'Tools', shortcut: 'g i' },
    { id: 'nav:tags',          label: t.navTags || 'Tags',                 category: 'Tools',      shortcut: 'g s' },
    { id: 'nav:discovery',     label: t.discovery || 'Discovery',          category: 'Tools',      shortcut: 'g e' },
    { id: 'nav:share',         label: t.navShare || 'Share & Compare',     category: 'Tools',      shortcut: 'g h' },
    { id: 'nav:watchlist',     label: t.watchlist || 'Watchlist',          category: 'Tools',      shortcut: 'g w' },
    { id: 'nav:rules',         label: t.navRules || 'Alerts & Rules',      category: 'Tools',      shortcut: 'g u' },
    { id: 'nav:categories',    label: t.navCategories || 'Categories',     category: 'Tools',      shortcut: 'g c' },
    { id: 'nav:customize',     label: t.navCustomize || 'Customize Overview', category: 'Tools',   shortcut: 'g y' },
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
    { id: 'settings:contrast', label: t.contrastMode || 'High Contrast',   category: 'Design' },
    { id: 'settings:cb',       label: t.cbMode || 'Colour-Blind Safe',     category: 'Design' },
    { id: 'help:shortcuts',    label: t.keyboardShortcuts || 'Keyboard Shortcuts', category: 'Help', shortcut: '?' },
  ], [t]);

  // ========== COMMAND EXECUTION (moved below function definitions) ==========

  // ========== KEYBOARD SHORTCUTS ==========
  
  // Ref for settings dropdown close-on-outside-click
  const settingsRef = useRef(null);
  const settingsBtnRef = useRef(null);
  // Dialogs opened from the account menu: the menu item is gone when they
  // close, so focus goes back to the account button.
  const focusAccountButton = () => settingsRef.current && settingsRef.current.querySelector('.mx-avatar');

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
      const posMap = {};
      transactions.forEach((tx) => {
        const pid = tx.portfolioId || 'default';
        const category = tx.category || 'crypto';
        const key = pid + '|' + category + '-' + (tx.symbol || '').toLowerCase();
        if (!posMap[key]) posMap[key] = { pid, symbol: tx.symbol, amount: 0 };
        const qty = parseFloat(tx.quantity) || 0;
        if (tx.type === 'buy') posMap[key].amount += qty;
        else if (tx.type === 'sell') posMap[key].amount = Math.max(0, posMap[key].amount - qty);
      });
      Object.values(posMap).forEach((pos) => {
        if (pos.amount <= 0.0001) return;
        const sym = pos.symbol || '';
        const pr = prices[sym] || prices[sym.toLowerCase()] || prices[sym.toUpperCase()] || 0;
        const val = pos.amount * pr;
        combined += val;
        byPid[pos.pid] = (byPid[pos.pid] || 0) + val;
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
  }, [transactions, prices, demoMode]);

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
        if (window.MaerminUI) window.MaerminUI.add('Tip: export an encrypted backup (press b) — your data lives only in this browser', 'warning');
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

  // Warm the dividend cache for held stocks (no-op without a Worker URL or when
  // already cached). Lets the Dividend Forecast/Calendar resolve far more than
  // the built-in ticker list. Cache + 24h TTL keep this within free-tier limits.
  useEffect(() => {
    if (portfolio.stocks && portfolio.stocks.length) {
      if (window.DividendDataService) {
        window.DividendDataService.prefetchPortfolio(portfolio, { workerUrl: apiKeys.cs2Worker })
          .then((n) => { if (n > 0) setMetaVersion(v => v + 1); }) // refresh Dividend Forecast once data lands
          .catch(() => {});
      }
      // Backfill sector/country metadata for the Strategy tab (covers existing
      // holdings, manual additions and sync updates — anything that changes the
      // derived portfolio). No-op without a Worker URL; static map still applies.
      if (window.MaerminEquityMeta) {
        // Resolve sector/country through the Worker (Yahoo assetProfile); static
        // map otherwise.
        window.MaerminEquityMeta.prefetchPortfolio(portfolio, { workerUrl: apiKeys.cs2Worker })
          .then((n) => { if (n > 0) setMetaVersion(v => v + 1); }) // refresh Strategy views once metadata lands
          .catch(() => {});
      }
    }
  }, [portfolio, apiKeys.cs2Worker]);

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
      addToast('Dividend due soon — ' + msg, 'info');
      try {
        const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';
        if (canNotify && window.MaerminPWA && window.MaerminPWA.notify) {
          window.MaerminPWA.notify('Upcoming dividend', { body: msg });
        }
      } catch (e) {}
      window.MaerminDividendReminder.save(window.MaerminDividendReminder.markNotified(state, due));
    } catch (e) {}
  }, [portfolio, metaVersion, demoMode]);

  // ========== API FUNCTIONS ==========
  
  const fetchPrices = async () => {
    // Demo mode: re-apply offline sample prices, never hit the network.
    if (demoMode && window.MaerminDemo) {
      setPrices(window.MaerminDemo.getPrices());
      setLastRefresh(new Date());
      addToast('Demo mode — showing sample prices', 'info');
      return;
    }
    setLoading(true);
    // Price the COMBINED book (all portfolios), not just the active one — the
    // refresh button must refresh every portfolio at once, and the `prices` map
    // is global (keyed by symbol, shared across portfolios) so pricing the union
    // is always correct. Falls back to the active portfolio if the combined
    // build is unavailable.
    const pricePortfolio = allPortfoliosPortfolio || portfolio;
    const newPrices = { ...fetchedPrices };
    const avFallbackSyms = new Set(); // symbols resolved via Alpha Vantage (provenance)
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
      try {
        // Use the open endpoint which is in the CSP
        const fxRes = await fetch('https://open.er-api.com/v6/latest/USD');
        if (fxRes.ok) {
          const fxData = await fxRes.json();
          if (fxData.result === 'success' && fxData.rates && fxData.rates.EUR) {
            usdToEur = fxData.rates.EUR;
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
          FXH.merge({ [window.MaerminUtils.todayISO()]: usdToEur });
          const wBase = (apiKeys.cs2Worker || '').trim().replace(/\/$/, '');
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
              if (Object.keys(series).length) { FXH.merge(series); dbg('[PRICES] FX history backfilled:', Object.keys(series).length, 'days'); }
            }
          }
          setFxHistVersion(v => v + 1); // rebuild the resolver with the latest cache
        }
      } catch (e) { /* historical FX is best-effort — resolver falls back to live rate */ }

      // Fetch crypto prices from CoinGecko (free, no API key needed)
      if (pricePortfolio.crypto && pricePortfolio.crypto.length > 0) {
        const ids = pricePortfolio.crypto.map(c => (c.symbol || c.name || '').toLowerCase()).join(',');
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
              dbg('[PRICES] Crypto prices fetched:', Object.keys(data).length);
            }
          } catch (e) {
            console.error('[PRICES] CoinGecko error:', e);
          }
        }
      }
      
      // ── Stock Prices: Yahoo Finance (primary) → Alpha Vantage (fallback) ──
      // v11: no more 10-symbol cap (portfolios above 10 stocks silently lost
      // their prices). The Worker (Yahoo) phase now runs CONCURRENTLY in small
      // chunks for ALL stocks, and resolved exchange suffixes are cached in
      // localStorage so we never brute-force ".DE/.L/.PA…" for the same symbol
      // twice. The Alpha Vantage fallback stays SEQUENTIAL (AV rate-limits hard)
      // and only runs for the genuine misses.
      if (pricePortfolio.stocks && pricePortfolio.stocks.length > 0) {
        const workerBase = (apiKeys.cs2Worker || '').trim().replace(/\/$/, '');
        const hasWorker  = workerBase.length > 5;
        // Known legacy symbols without an exchange suffix.
        // (shared with the daily close history, so quote and history read the same listing)
        const LEGACY_MAP = (window.MaerminCloseHistory || {}).YF_LEGACY || {};
        // Persistent cache of resolved YF symbols (bare → exchange-suffixed).
        let suffixCache = {};
        try { suffixCache = JSON.parse(localStorage.getItem('maermin_symbol_suffix') || '{}') || {}; } catch (e) {}
        let suffixDirty = false;

        const fetchYfPrice = async (yfSym, ms) => {
          try {
            const res = await fetch(`${workerBase}?action=yf&symbol=${encodeURIComponent(yfSym)}&interval=1d&range=5d`, { signal: AbortSignal.timeout(ms) });
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
          if (!hasWorker) return { sym, symL, priceEUR: null };
          const cached = !sym.includes('.') && (suffixCache[sym] || LEGACY_MAP[sym]);
          const primary = sym.includes('.') ? sym : (cached || sym);
          let priceEUR = null;
          try {
            priceEUR = await fetchYfPrice(primary, 8000);
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
              }
            }
          } catch (e) {
            console.warn('[PRICES] YF stock failed for', sym, '—', e.message);
          }
          return { sym, symL, priceEUR };
        };

        // Phase 1 — Worker/Yahoo, concurrent in chunks for ALL stocks.
        const misses = [];
        const CHUNK = 6;
        for (let i = 0; i < pricePortfolio.stocks.length; i += CHUNK) {
          const settled = await Promise.all(pricePortfolio.stocks.slice(i, i + CHUNK).map(resolveStockYF));
          settled.forEach(r => {
            if (r.priceEUR && r.priceEUR > 0) { newPrices[r.symL] = r.priceEUR; newPrices[r.sym] = r.priceEUR; }
            else misses.push(r);
          });
        }
        if (suffixDirty) { try { localStorage.setItem('maermin_symbol_suffix', JSON.stringify(suffixCache)); } catch (e) {} }

        // Phase 2 — Alpha Vantage fallback, sequential, misses only.
        if (apiKeys.alphaVantage && misses.length) {
          for (const r of misses) {
            try {
              dbg('[PRICES] Stock AV fallback:', r.sym);
              const res  = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${r.sym}&apikey=${apiKeys.alphaVantage}`);
              const data = await res.json();
              if (data['Global Quote']?.['05. price']) {
                const priceEUR = parseFloat(data['Global Quote']['05. price']) * usdToEur;
                if (priceEUR > 0) {
                  newPrices[r.symL] = priceEUR; newPrices[r.sym] = priceEUR;
                  avFallbackSyms.add(r.sym);
                  dbg('[PRICES] Stock (AV fallback):', r.sym, '→', priceEUR.toFixed(2), 'EUR');
                }
              } else if (data['Note'] || data['Information']) {
                console.warn('[PRICES] Alpha Vantage rate limit hit for', r.sym);
                addToast('Alpha Vantage: Rate limit reached', 'warning');
                break; // stop hammering AV once rate-limited
              }
              await new Promise(rr => setTimeout(rr, 12000)); // AV rate limit
            } catch(e) {
              console.warn('[PRICES] AV stock fallback error for', r.sym, e.message);
            }
          }
        }
      }

      // ── Commodity Prices: Yahoo Finance (primary) → Alpha Vantage (fallback) ──
      if (pricePortfolio.commodities && pricePortfolio.commodities.length > 0) {
        const workerBase = (apiKeys.cs2Worker || '').trim().replace(/\/$/, '');
        const hasWorker  = workerBase.length > 5;

        // Yahoo Finance Futures symbols for commodities
        const YF_COMMODITY = (window.MaerminCloseHistory || {}).YF_COMMODITY || {};

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
                avFallbackSyms.add(sym);
                dbg('[PRICES] Commodity (AV fallback):', sym, '→', priceEUR.toFixed(2), 'EUR');
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
      if (pricePortfolio.skins && pricePortfolio.skins.length > 0) {
        const rawWorkerUrl = (apiKeys.cs2Worker || '').trim();
        const workerUrl = rawWorkerUrl
          ? (rawWorkerUrl.startsWith('https://') ? rawWorkerUrl : 'https://' + rawWorkerUrl)
          : null;

        if (!workerUrl) {
          console.warn('[PRICES] No CS2 Worker URL — add it in API Settings');
          addToast('CS2: add your Worker URL in API Settings', 'warning');
        } else {
          try {
            // ONE normalising place for market_hash_name lookups (Souvenir /
            // StatTrak prefixes, separator spacing) — MaerminTickers. Prices
            // are stored back under the ORIGINAL stored symbol so positions
            // keep resolving; the normalised name is only what Steam sees.
            const normalize = window.MaerminTickers?.normalizeSkinName || (n => n);
            const skinPairs = pricePortfolio.skins
              .map(s => { const orig = (s.symbol || s.name || '').trim(); return { orig, norm: normalize(orig) }; })
              .filter(p => p.orig);
            const skinNames = skinPairs.map(p => p.norm);
            dbg('[PRICES] CS2 Steam: fetching', skinNames.length, 'skins via Worker...');

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

              skinPairs.forEach(({ orig: skinName, norm }) => {
                const priceUSD = priceMap[norm] != null ? priceMap[norm] : priceMap[skinName];
                if (priceUSD && priceUSD > 0) {
                  // Skins are delivered in USD → convert to the canonical EUR at
                  // full precision (display rounds later). All downstream calcs
                  // (Net Worth, Allocation, Performance, Showcase) read this map.
                  const priceEUR = window.MaerminUtils.toEUR(priceUSD, 'USD', usdToEur);
                  newPrices[skinName.toLowerCase()] = priceEUR;
                  newPrices[skinName] = priceEUR;
                  matchedCount++;
                  dbg('[PRICES] CS2:', skinName, '→ $' + priceUSD.toFixed(2), '→', priceEUR.toFixed(2), 'EUR');
                } else {
                  console.warn('[PRICES] CS2: no price for', skinName);
                }
              });

              dbg('[PRICES] CS2 matched:', matchedCount, '/', skinNames.length);
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
      
      // ── Resilience: carry forward last-known CS2 skin prices ────────────────
      // Steam 429-throttles bulk skin fetches, so some skins return no price this
      // round. Dropping them to "no price" silently collapses the CS2 portfolio
      // value. Instead reuse the last-known price from the current map and let the
      // data-quality layer badge it "stale · <age>". We deliberately do NOT
      // re-stamp these as live below, so their per-symbol freshness timestamp
      // stays old and the badge stays honest. Last-known persists across multiple
      // throttled refreshes because `prices` already holds the carried value.
      const carriedKeys = new Set();
      const lastKnownSkin = window.MaerminMarket.lastKnownPrices(priceHistory);
      if (pricePortfolio.skins && pricePortfolio.skins.length) {
        pricePortfolio.skins.forEach((s) => {
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
            dbg('[PRICES] CS2: carried last-known price for', orig, '→', prev.toFixed(2), 'EUR (stale)');
          }
        });
      }

      setPrices(newPrices);
      // Stamp when each symbol was fetched so the data-quality layer can flag
      // stale/failed quotes (feeds the per-position freshness badges). Carried
      // skins are excluded so they keep their previous timestamp and badge stale.
      if (window.MaerminDataQuality) {
        window.MaerminDataQuality.recordFetch(Object.keys(newPrices).filter((k) => !carriedKeys.has(k)), 'live');
        // Provenance: mark symbols that came from the Alpha Vantage fallback so the
        // badge can show WHY (primary source returned no data) — not a silent swap.
        if (avFallbackSyms.size) {
          window.MaerminDataQuality.recordFetch([...avFallbackSyms], 'Alpha Vantage', { fallback: true, reason: 'Yahoo Finance returned no data' });
        }
      }

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
      // Decoupled signal: any module can react to a refresh without the renderer
      // wiring it a bespoke effect (event-bus foundation, Phase-5 decoupling).
      try { if (window.MaerminBus) window.MaerminBus.emit('prices:refreshed', { count: priceCount, at: Date.now() }); } catch (e) {}
      addToast(`${t.pricesUpdated || 'Prices updated'} (${priceCount})`, 'success');
    } catch (error) {
      console.error('[PRICES] General error:', error);
      addToast(t.error || 'Error fetching prices', 'error');
    }
    
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
        if (typeof fn === 'function') fn();
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
    addToast('Demo mode on — exploring sample data', 'info');
  };
  const exitDemo = () => {
    if (window.MaerminDemo) window.MaerminDemo.disable();
    setDemoMode(false);
    const saved = localStorage.getItem('transactions');
    setTransactions(window.MaerminUtils.safeParse(saved, []) || []);
    setPrices({});
    addToast('Demo mode off — your data restored', 'success');
  };

  // ========== ONBOARDING WIZARD ==========
  const saveWorkerUrl = (u) => setApiKeys(prev => ({ ...prev, cs2Worker: u }));
  const openOnboarding = () => setShowOnboarding(true);
  const closeOnboarding = () => {
    setShowOnboarding(false);
    try { localStorage.setItem('maermin_onboarded', '1'); } catch (e) {}
  };

  // ========== RECOVERY KIT (let pre-existing vaults add one) ==========
  const createRecoveryKit = () => {
    if (recoveryBusy || !window.MaerminAuth || !window.MaerminAuth.enrollRecovery) return;
    setRecoveryBusy(true);
    window.MaerminAuth.enrollRecovery().then((kit) => {
      setRecoveryCode(kit.code);
      setShowRecoveryKit(true);
      setRecoveryBusy(false);
    }, () => {
      setRecoveryBusy(false);
      addToast('Could not create a recovery code. Please try again.', 'error');
    });
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
  // In-app confirmation (MaerminUI.confirm → Promise<boolean>); the native
  // dialog only as a fallback if the UI module is missing.
  const askConfirm = (opts) => (window.MaerminUI && window.MaerminUI.confirm)
    ? window.MaerminUI.confirm(opts)
    : Promise.resolve(typeof window.confirm === 'function' ? window.confirm([opts.title, opts.message].filter(Boolean).join('\n\n')) : true);
  // A full backup REPLACES the current data: every restore path asks first,
  // naming the backup's date and size next to the current data.
  const askRestoreBackup = (backup) => {
    const sum = (window.MaerminBackup && window.MaerminBackup.summary) ? window.MaerminBackup.summary(backup) : { timestamp: null, transactionCount: null, keyCount: 0 };
    const when = sum.timestamp ? new Date(sum.timestamp).toLocaleString() : 'an unknown date';
    const count = sum.transactionCount == null ? 'an unknown number of' : sum.transactionCount;
    return askConfirm({
      title: t.restoreBackupTitle || 'Replace your data with this backup?',
      message: `Backup from ${when}: ${count} transactions, ${sum.keyCount} data sets.\n` +
        `Your current data (${transactions.length} transactions) and every setting stored in the backup will be replaced. This cannot be undone.\n\n` +
        'To keep a copy, cancel and use Data Management → Export & Backup first.',
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
          try { if (window.MaerminPWA && window.MaerminPWA.notify) window.MaerminPWA.notify('MAERMIN — ' + (t.rulesAlert || 'Rule triggered'), { body: desc, tag: 'maermin-rule-' + res.rule.id }); } catch (e) {}
        } else if (!res.triggered && seen[res.rule.id]) {
          delete seen[res.rule.id]; // re-arm for the next time it triggers
        }
      });
    } catch (e) { /* notifications are best-effort */ }
  }, [transactions, fetchedPrices, demoMode]);

  // ========== BACKUP FUNCTIONS ==========
  
  const createBackup = () => {
    if (!window.MaerminBackup) { addToast('Backup engine not loaded', 'error'); return; }
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
  
  const saveTransaction = () => {
    const isOption = newTransaction.category === 'options';

    // Option contracts: validate via the engine (the contract identity must be
    // sound or the book grouping corrupts) and derive tx.symbol from it — the
    // symbol field is not user-entered for options.
    let optionFields = null;
    if (isOption) {
      const O = window.MaerminOptions;
      if (!O) { addToast('Options module not loaded', 'error'); return; }
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
    const price = window.MaerminUtils.parseDecimal(newTransaction.price);
    const fees = window.MaerminUtils.parseDecimal(newTransaction.fees);
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
      portfolioId: newTransaction.targetPortfolioId || activePortfolioId,
      ...(newTransaction.skinIconUrl ? { skinIconUrl: newTransaction.skinIconUrl } : {}),
      ...(optionFields || {})
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
      category: window.MaerminUtils.defaultTxCategory(transactions, activePortfolioId,
        ['crypto', 'stocks', 'skins', 'commodities', 'options'].concat(window.MaerminCategories ? window.MaerminCategories.ids() : [])),
      symbol: '',
      quantity: '',
      price: '',
      date: window.MaerminUtils.todayISO(),
      fees: '',
      notes: '',
      currency: currency,
      targetPortfolioId: activePortfolioId,
    };
    setNewTransaction(initial);
    txInitialRef.current = initial;
    setTxMissing([]);
    setShowTransactionModal(true);
  };

  // Start editing a transaction
  const editTransaction = (tx) => {
    setNewTransaction(txInitialRef.current = {
      type: tx.type || 'buy',
      category: tx.category || 'crypto',
      symbol: tx.symbol || '',
      quantity: tx.quantity?.toString() || '',
      price: tx.price?.toString() || '',
      date: tx.date || window.MaerminUtils.todayISO(),
      fees: tx.fees?.toString() || '',
      notes: tx.notes || '',
      currency: tx.currency || 'EUR',
      targetPortfolioId: tx.portfolioId || activePortfolioId,
      // Option contract fields (only set on category 'options' rows).
      underlying: tx.underlying || '',
      optionType: tx.optionType || 'call',
      strike: tx.strike?.toString() || '',
      expiry: tx.expiry || '',
      contractSize: tx.contractSize?.toString() || '',
    });
    setEditingTransactionId(tx.id);
    setTxMissing([]);
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
        // CSV: the wizard's parsing and row checks (MaerminImportMapping), with
        // the dialog's per-row category column. It used to be split into
        // { headers, rows }, which no branch below understood ("Unknown format").
        const IM = window.MaerminImportMapping;
        if (!IM || !IM.quickCSV) throw new Error('Invalid format');
        const res = IM.quickCSV(importData, { currency });
        const firstErr = res.errors[0] ? `Row ${res.errors[0].row}: ${res.errors[0].reason}` : '';
        if (!res.transactions.length) {
          // Keep the dialog and the pasted text so the user can correct it.
          addToast(`${t.noTransactionsFound || 'No transactions found'}${firstErr ? ' - ' + firstErr : ''}`, 'error');
          return;
        }
        const stamp = Date.now();
        // Into the portfolio the user is working in, like "+ Add Transaction".
        const added = res.transactions.map((tx, idx) => ({ ...tx, id: (stamp + idx).toString(), notes: tx.notes || '', portfolioId: activePortfolioId }));
        setTransactions(prev => [...prev, ...added]);
        const skipped = res.errors.length ? ` - ${res.errors.length} row(s) skipped (${firstErr})` : '';
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
          portfolioId: item.portfolioId || activePortfolioId
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
      case 'nav:share':         setActiveView('share'); break;
      case 'nav:watchlist':     setActiveView('watchlist'); break;
      case 'nav:rules':         setActiveView('rules'); break;
      case 'nav:categories':    setActiveView('categories'); break;
      case 'nav:customize':     setActiveView('customize'); break;
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
          // A full backup restores ALL data (watchlist, alerts, dividends,
          // journal, savings plans, net-worth, goals, settings, …) via the
          // engine and reloads — not just the transactions list.
          if (window.MaerminBackup && window.MaerminBackup.isFullBackup(parsed)) {
            // Ask first, like the quick Import dialog (cancel keeps the text).
            if (!(await askRestoreBackup(parsed))) return;
            const restored = window.MaerminBackup.restore(parsed);
            if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `Full backup restored (${restored} data keys)`);
            addToast('Backup restored — reloading…', 'success');
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
          const firstErr = res.errors[0] ? `Row ${res.errors[0].row}: ${res.errors[0].reason}` : '';
          if (!res.transactions.length) throw new Error('No transactions found' + (firstErr ? ' - ' + firstErr : ''));
          imported = res.transactions.map(tx => ({ ...tx, notes: tx.notes || '', portfolioId: activePortfolioId }));
          if (res.errors.length) addToast(`${res.errors.length} row(s) skipped (${firstErr})`, 'warning', 8000);
          (res.warnings || []).slice(0, 2).forEach(w => addToast(w, 'warning', 10000));
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
            style: { padding: '0.625rem 1.25rem', background: theme.accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }
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
          'Paste a JSON backup or CSV export. A full JSON backup restores all your data and reloads; a CSV/transaction list is added without replacing existing data.'
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
              theme, t, addToast, workerUrl: apiKeys.cs2Worker,
              existing: transactions, // for duplicate detection in the mapping preview
              onImport: (txs) => {
                const newTxs = txs.map((tx, i) => ({ id: (Date.now()+i).toString(), ...tx }));
                setTransactions(prev => [...prev, ...newTxs]);
                if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `${newTxs.length} transaction(s) imported`);
                addToast(`${newTxs.length} transaction(s) imported`, 'success');
              }
            })
          : React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '3rem', textAlign: 'center', color: theme.textSecondary } },
              'Broker Import module not loaded'
            )
      ),

      // Exchange read-only sync (WI-7): import crypto trades from Binance/Kraken/
      // Coinbase/Bitpanda. Keys are encrypted in the vault; sync is manual.
      section === 'broker' && window.MaerminExchangeSync && window.MaerminExchangeSync.Panel &&
        React.createElement(window.MaerminExchangeSync.Panel, {
          theme, t, workerUrl: apiKeys.cs2Worker, existing: transactions, portfolioId: activePortfolioId,
          onImport: (txs) => {
            setTransactions(prev => [...prev, ...txs]);
            if (window.MaerminAuditLog) window.MaerminAuditLog.record('data.import', `${txs.length} exchange trade(s) imported`);
            addToast(`${txs.length} exchange trade(s) imported`, 'success');
          }
        })
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

    // Auto-fetch dividends from Alpha Vantage for stock positions
    const fetchDividends = async () => {
      // Primary: Yahoo Finance via Worker — returns dividend data in quote summary
      // Fallback: Alpha Vantage OVERVIEW (if worker not configured)
      const workerBase = (apiKeys?.cs2Worker || '').trim().replace(/\/$/, '');
      const hasWorker  = workerBase.length > 5;
      const avKey      = apiKeys?.alphaVantage;

      if (!hasWorker && !avKey) {
        addToast('Add your Worker URL or Alpha Vantage key in Settings to auto-fetch dividends', 'warning');
        return;
      }

      const stockSymbols = [...new Set(
        transactions.filter(tx => tx.category === 'stocks').map(tx => (tx.symbol || '').toUpperCase()).filter(Boolean)
      )];
      if (!stockSymbols.length) { addToast('No stock positions found', 'info'); return; }

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
        // Query Yahoo under the normalised/renamed ticker (e.g. FISV→FI, BRK.B→
        // BRK-B) so renamed symbols resolve; keep `sym` for share-matching/labels.
        const qsym = (window.MaerminTickers && window.MaerminTickers.normalizeForDividends(sym)) || sym;

        // ── Primary: Yahoo Finance fundamentals via Worker ─────────────────
        // action=fundamentals (Yahoo quoteSummary) gives the annual dividendRate,
        // the last single payment (→ frequency) and the ex-date.
        if (hasWorker) {
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

        // ── Fallback: Alpha Vantage OVERVIEW (annual DPS + ex-date) ────────
        if ((!annualPerShare || !exDate) && avKey) {
          try {
            const res  = await fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${qsym}&apikey=${avKey}`);
            const data = await res.json();
            const avDiv = parseFloat(data.DividendPerShare) || 0; // AV reports the ANNUAL per-share
            if (avDiv > 0) {
              if (!annualPerShare) annualPerShare = avDiv;
              if (!exDate && data.ExDividendDate && data.ExDividendDate !== 'None') exDate = data.ExDividendDate;
              currency = 'USD';
              dbg(`[DIV] AV fallback ${sym}: $${avDiv}/yr, ex: ${exDate}`);
            }
          } catch(e) { console.warn('[DIV] AV fallback failed for', sym, e.message); }
          await new Promise(r => setTimeout(r, 500));
        }

        if (!(annualPerShare > 0)) continue;
        const shares = sharesOf(sym);
        if (shares <= 0) continue;

        const monthsPerPay   = Math.max(1, Math.round(12 / ppy));
        const perPayPerShare = annualPerShare / ppy;
        const perPayAmount   = perPayPerShare * shares;

        // Anchor the FIRST upcoming pay date: roll the ex-date forward to the next
        // occurrence, then pay ~14 days after ex. Without an ex-date, start next month.
        let anchor;
        if (exDate) {
          anchor = new Date(exDate);
          if (isNaN(anchor.getTime())) { anchor = new Date(); anchor.setMonth(anchor.getMonth() + 1); }
          else {
            while (anchor.getTime() < Date.now()) anchor.setMonth(anchor.getMonth() + monthsPerPay);
            anchor.setDate(anchor.getDate() + 14); // ex → pay
          }
        } else {
          anchor = new Date(); anchor.setMonth(anchor.getMonth() + 1);
        }

        // One event per individual payment across the next 12 months.
        const horizon = new Date(); horizon.setFullYear(horizon.getFullYear() + 1);
        for (let pd = new Date(anchor); pd <= horizon; pd.setMonth(pd.getMonth() + monthsPerPay)) {
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
      setDivEvents(prev => {
        const manual = prev.filter(e => !String(e.id).startsWith('auto-'));
        return [...manual, ...freshSchedule];
      });

      setFetching(false);
      addToast(freshSchedule.length > 0
        ? `${freshSchedule.length} dividend payment(s) scheduled across the next 12 months`
        : 'No dividend payments found for your holdings', 'info');
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
          style: { padding: '0.45rem 1rem', background: fetching ? theme.inputBg : 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', color: fetching ? theme.textSecondary : theme.success, cursor: fetching ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: '600' }
        }, fetching ? 'Fetching...' : '↓ Auto-fetch dividends'),
        // v10.x: book received dividends as transactions (in the payout currency)
        onBookDividends ? React.createElement('button', {
          onClick: () => onBookDividends(),
          title: t.divBookHint || 'Create a transaction for each dividend whose pay date has passed (estimated, in its payout currency)',
          style: { padding: '0.45rem 1rem', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }
        }, t.divBookNow || '＋ Book received dividends') : null,
        toggleDivAutoBook ? React.createElement('label', {
          title: t.divAutoHint || 'Automatically book each dividend as a transaction (in its payout currency) once its pay date passes',
          style: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: theme.textSecondary, cursor: 'pointer', userSelect: 'none' }
        },
          React.createElement('input', { type: 'checkbox', checked: !!divAutoBook, onChange: () => toggleDivAutoBook(), style: { accentColor: theme.accent, cursor: 'pointer' } }),
          (t.divAutoLabel || 'Auto-book')) : null
      ),
      // Content
      React.createElement('div', { style: { flex: 1, overflow: 'auto' } },
        tab === 'calendar' && window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.DividendCalendarView, {
            portfolio, prices, metaVersion, theme, t, addToast, events: divEvents, setEvents: setDivEvents, privacyMode
          }) : null,
        tab === 'forecast' && window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.DividendForecastView, {
            transactions, portfolio, prices, metaVersion, theme, formatPrice, getCurrencySymbol
          }) : null,
        // Dividend quality & safety fold-in (no new tab): per-payer safety
        // score, payout/streak/growth/coverage columns with a click-to-open
        // reasoning detail, and the aggregated portfolio dividend health.
        // Gated on the Worker fundamentals route; degrades to history-only.
        window.MaerminDividendQuality && window.MaerminDividendQuality.QualityPanel ?
          React.createElement(window.MaerminDividendQuality.QualityPanel, {
            portfolio, prices, workerUrl: apiKeys?.cs2Worker,
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
        showHarvest && tabBtn('harvest', t.taxTabHarvest || 'Tax-loss harvesting')
      ),
      React.createElement('div', { style: { flex: 1, overflow: 'auto' } },
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
          React.createElement(window.MaerminIntelligence.View, {
            portfolio, prices, transactions: activeTransactions,
            lookThrough: lookThroughResult, theme: currentTheme, t
          }) : renderAnalyticsPlaceholder('Portfolio Intelligence');

      // v10.x: snapshot-powered performance cards (1D…Max), derived 100% from the
      // on-device value history — no API. Defaults to the combined 'all' series.
      case 'performance':
        return window.MaerminPerformance ?
          React.createElement('div', null,
            // Performance Map treemap (WI-4): area = weight, colour = performance.
            window.MaerminPerformanceMap && React.createElement('div', { style: { padding: '1.5rem 1.5rem 0' } },
              React.createElement(window.MaerminPerformanceMap.Panel, {
                theme: currentTheme, t, positions: portfolio, prices, exchangeRate,
                privacyMode, formatPrice, getCurrencySymbol
              })),
            React.createElement(window.MaerminPerformance.View, {
              theme: currentTheme, t, formatPrice, getCurrencySymbol, workerUrl: apiKeys.cs2Worker
            })
          ) : renderAnalyticsPlaceholder('Performance');

      // v10.x: Customize Overview — show/hide/reorder the main Overview sections
      // (MaerminDashboard). renderOverview reads visibleSet() each render.
      case 'customize':
        return window.MaerminDashboard ?
          React.createElement(window.MaerminDashboard.View, {
            theme: currentTheme, t
          }) : renderAnalyticsPlaceholder('Customize Overview');

      // v10.x: Custom asset categories — define/manage categories beyond the four
      // built-ins. Positions in custom categories are priced & totalled (metrics.js
      // is category-aware); the picker in Add-Transaction lists them.
      case 'categories':
        return window.MaerminCategories ?
          React.createElement(window.MaerminCategories.View, {
            theme: currentTheme, t
          }) : renderAnalyticsPlaceholder('Categories');

      // v10.x: Smart Tags — cross-cutting labels + per-tag value/weight and
      // optional tag-basis target weights (persisted, in backup).
      case 'tags':
        return window.MaerminTags ?
          React.createElement(window.MaerminTags.View, {
            transactions: activeTransactions, prices,
            theme: currentTheme, t, formatPrice, getCurrencySymbol
          }) : renderAnalyticsPlaceholder('Tags');

      // v10.x: Automation Rules — local "warn me when…" rules on concentration,
      // allocation and drawdown. We assemble the eval context here from the same
      // live inputs the rest of the app uses (positions, tag values, snapshot peak).
      case 'rules': {
        if (!window.MaerminRules) return renderAnalyticsPlaceholder('Alerts & Rules');
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
        return React.createElement(React.Fragment, null,
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
            workerUrl: apiKeys.cs2Worker, usdToEur: exchangeRate,
            theme: currentTheme, t, formatPrice, getCurrencySymbol
          }) : renderAnalyticsPlaceholder('Discovery');

      // Sanctioned new surface (round 2): privacy-preserving share snapshots
      // + anonymous benchmarking. Redaction enforced client- AND server-side;
      // opt-in per click; degrades with an upgrade note on older Workers.
      case 'share':
        return window.MaerminShare ?
          React.createElement(window.MaerminShare.View, {
            portfolio, prices, transactions: activeTransactions,
            workerUrl: apiKeys.cs2Worker, theme: currentTheme, t
          }) : renderAnalyticsPlaceholder('Share & Compare');

      case 'net-worth':
        return window.MaerminFeatures5 ?
          React.createElement(window.MaerminFeatures5.NetWorthView, {
            portfolioStats, portfolio, prices, theme: currentTheme, formatPrice, getCurrencySymbol, t, usdToEur: exchangeRate
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
          React.createElement(React.Fragment, null,
            React.createElement(window.MaerminFeatures5.FeeAnalyzer, {
              transactions: activeTransactions, theme: currentTheme, formatPrice, getCurrencySymbol
            }),
            // Ongoing costs (TER) fold-in: the recurring half of the cost of
            // investing, complementing the transaction fees above (no new tab).
            // Reuses the X-Ray fund-data plumbing; gated + degrading like it.
            window.MaerminCostAnalysis && window.MaerminCostAnalysis.OngoingCostsPanel &&
              React.createElement(window.MaerminCostAnalysis.OngoingCostsPanel, {
                portfolio, prices, workerUrl: apiKeys.cs2Worker,
                theme: currentTheme, t, formatPrice, getCurrencySymbol
              })
          ) : renderAnalyticsPlaceholder('Fee Analyzer');

      case 'portfolios':
        return window.MaerminFeatures4 ?
          React.createElement(window.MaerminFeatures4.PortfolioManagerView, {
            portfolios, activePortfolioId, transactions, prices, exchangeRate, fxAt, corpActionsRev,
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
            portfolios, activePortfolioId,
            // Feed the projection (#6): current investment value + forward dividend yield.
            // NB: use the component-scoped portfolioStats (stats is only defined in
            // the overview block, not here — referencing it crashed the page).
            startValue: portfolioStats.totalValue,
            dividendYield: (window.MaerminMetrics
              ? (window.MaerminMetrics.computeExpectedAnnualDividends(portfolio, prices).yield || 0) / 100
              : 0)
          }) : renderAnalyticsPlaceholder('Savings Plans');

      case 'returns':
        return window.MaerminFeatures2 ? React.createElement('div', null,
          React.createElement(window.MaerminFeatures2.ReturnsView, {
            transactions: activeTransactions, portfolio, prices, priceHistory, fxAt, exchangeRate,
            valuePath, historyPending: closePending, portfolioId: activePortfolioId, hasWorker: (apiKeys.cs2Worker || '').trim().length > 5,
            theme: currentTheme, formatPrice, getCurrencySymbol, t
          }),
          // Benchmark overlay (α/β/TE/IR/R²) — folds the analytics engine into Returns.
          window.MaerminAnalyticsViews && React.createElement('div', { style: { padding: '0 1.5rem 1.5rem' } },
            React.createElement(window.MaerminAnalyticsViews.BenchmarkPanel, {
              portfolio, priceHistory, valueSeries: dailyAnalytics.index, workerUrl: apiKeys.cs2Worker, theme: currentTheme, t, formatPrice
            }),
            // FX attribution: split the EUR return into asset vs exchange-rate
            // parts (no new tab; the EUR/USD path comes via the existing yf route).
            window.MaerminFxAttribution && React.createElement(window.MaerminFxAttribution.Panel, {
              portfolio, prices, priceHistory, transactions: activeTransactions,
              workerUrl: apiKeys.cs2Worker, theme: currentTheme, t, formatPrice
            })
          )
        ) : renderAnalyticsPlaceholder('Returns');

      case 'rebalancing':
        return window.MaerminFeatures2 ?
          React.createElement(window.MaerminFeatures2.RebalancingView, {
            portfolio, prices, theme: currentTheme, formatPrice, getCurrencySymbol, t, setActiveView
          }) : renderAnalyticsPlaceholder('Rebalancing');

      case 'attribution':
        return window.MaerminFeatures7 ?
          React.createElement(React.Fragment, null,
            React.createElement(window.MaerminFeatures7.PerformanceAttribution, {
              portfolio, prices, transactions: activeTransactions, exchangeRate,
              theme: currentTheme, formatPrice, getCurrencySymbol, t
            }),
            // FX attribution fold-in: the currency dimension of attribution.
            window.MaerminFxAttribution && React.createElement('div', { style: { padding: '0 1.5rem 1.5rem' } },
              React.createElement(window.MaerminFxAttribution.Panel, {
                portfolio, prices, priceHistory, transactions: activeTransactions,
                workerUrl: apiKeys.cs2Worker, theme: currentTheme, t, formatPrice
              })
            )
          ) : renderAnalyticsPlaceholder('Attribution');

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
        return React.createElement(React.Fragment, null,
          React.createElement(DividendsCombinedView, {
            portfolio, prices, transactions: activeTransactions, apiKeys,
            theme: currentTheme, t, addToast, formatPrice, getCurrencySymbol,
            divAutoBook, toggleDivAutoBook, onBookDividends: () => bookDividends(true)
          }),
          // Yield-on-cost + DRIP (WI-6): per-payer YoC over FIFO cost basis.
          window.MaerminDividendYoc && window.MaerminDividendYoc.Panel &&
            React.createElement('div', { style: { padding: '0 1.5rem' } },
              React.createElement(window.MaerminDividendYoc.Panel, {
                portfolio, prices, transactions: activeTransactions, exchangeRate, fxAt,
                theme: currentTheme, t, formatPrice, getCurrencySymbol
              })),
          // Earnings calendar for held stocks (read-only, gated like Discovery).
          window.MaerminEarnings && window.MaerminEarnings.Panel &&
            React.createElement(window.MaerminEarnings.Panel, {
              theme: currentTheme,
              workerUrl: apiKeys.cs2Worker,
              symbols: [...new Set(activeTransactions.filter(tx => tx.category === 'stocks').map(tx => (tx.symbol || '').toUpperCase()).filter(Boolean))]
            })
        );

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

      case 'transactions':
        return renderTransactionsView();
      
      case 'analytics':
        return renderAnalyticsMenu();
      
      case 'investment-analysis':
        return window.InvestmentViews && window.InvestmentViews.InvestmentAnalysisDashboard ?
          React.createElement(window.InvestmentViews.InvestmentAnalysisDashboard, {
            portfolio, prices, priceHistory, metaVersion,
            theme: currentTheme, t, formatPrice, workerUrl: apiKeys.cs2Worker, exchangeRate
          }) : renderAnalyticsPlaceholder('Strategy Analysis');

      case 'health':
        return React.createElement(React.Fragment, null,
          window.PortfolioHealth ?
            React.createElement(window.PortfolioHealth.HealthView, {
              portfolio, prices, priceHistory, transactions: activeTransactions,
              theme: currentTheme, t, formatPrice, getCurrencySymbol, setActiveView
            }) : renderAnalyticsPlaceholder('Portfolio Health'),
          // ETF look-through (X-Ray): effective per-security exposure plus
          // sector/country/currency look-through — folds into Health (no new
          // tab). Gated on the Worker fundholdings route with a static
          // fallback; hands its result up for the advisor below.
          window.MaerminLookThrough && window.MaerminLookThrough.Panel && React.createElement('div', { style: { padding: '0 1.5rem 0' } },
            React.createElement(window.MaerminLookThrough.Panel, {
              portfolio, prices, workerUrl: apiKeys.cs2Worker, mode: 'overview',
              theme: currentTheme, t, formatPrice, getCurrencySymbol,
              onResult: setLookThroughResult
            })
          ),
          // Fold the (already-tested) AI advisor findings into Health — no new
          // tab. extras feeds pre-computed inputs the advisor cannot gather
          // itself: the look-through result and the risk-monitor evaluation
          // (drawdown/volatility breaches against the user's thresholds).
          window.MaerminAdvisor && window.MaerminAdvisor.Panel && React.createElement('div', { style: { padding: '1rem 1.5rem 1.5rem' } },
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

  // ========== DASHBOARD KPI STRIP ==========
  // V7: surfaces the cross-cutting summary numbers (Net Worth, FIRE, expected
  // Dividend income, Health Score) right on the dashboard. Each tile drills
  // into its existing detail view; numbers come from window.MaerminMetrics,
  // which reuses the existing engines (no duplicate logic).

  const DashboardKpiStrip = ({ portfolio, prices, priceHistory, transactions, portfolioValue, theme, t, formatPrice, getCurrencySymbol, setActiveView, language }) => {
    const M = window.MaerminMetrics;
    const [fire, setFire]         = React.useState(() => (M ? M.loadFireSettings() : { annualExpenses: 0, withdrawalRate: 4 }));
    const [editFire, setEditFire] = React.useState(false);
    // Coast-FIRE planning inputs (ephemeral — pure what-if sliders, not persisted).
    const [retireYears, setRetireYears] = React.useState(20);
    const [realReturn, setRealReturn]   = React.useState(5);

    const sym = getCurrencySymbol();
    const nw      = M ? M.computeNetWorth(portfolioValue) : null;
    const fireM   = (M && nw) ? M.computeFireMetrics(nw.netWorth, fire) : null;
    const divM    = M ? memoBy('kpiDiv', [portfolio, prices], () => M.computeExpectedAnnualDividends(portfolio, prices)) : null;
    const healthM = M ? memoBy('kpiHealth', [portfolio, prices, t, priceHistory, transactions], () => M.healthScore(portfolio, prices, t, { priceHistory, transactions })) : null;

    const healthColor = (s) => s >= 70 ? theme.success : s >= 40 ? theme.warning : theme.danger;

    const tile = (opts) => React.createElement('div', {
      key: opts.key,
      onClick: opts.onClick,
      role: opts.onClick ? 'button' : undefined,
      tabIndex: opts.onClick ? 0 : undefined,
      'aria-label': opts.onClick && typeof opts.label === 'string' ? opts.label : undefined,
      onKeyDown: opts.onClick ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(e); } }) : undefined,
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
      color: (divM && divM.available) ? theme.success : theme.textSecondary,
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
            style: { padding: '0.55rem 1.1rem', background: theme.accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.85rem' }
          }, t.save || 'Save')
        ),
        fireM && fireM.configured && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.78rem', marginTop: '0.75rem' } },
          `${t.fireMonthlyPassive || 'Passive income at current net worth'}: ${formatPrice(fireM.monthlyPassiveIncome)} ${sym}/mo · ${fireM.coveredExpenseRatio.toFixed(0)}% ${t.fireOfExpenses || 'of expenses'}`
        ),

        // Coast-FIRE — the amount needed today so growth alone reaches FIRE by the
        // target year. Pure what-if; reuses the FIRE number already computed above.
        fireM && fireM.configured && window.MaerminFireExtras && React.createElement('div', { style: { marginTop: '0.9rem', borderTop: `1px solid ${theme.cardBorder}`, paddingTop: '0.85rem' } },
          React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.82rem', marginBottom: '0.6rem' } }, t.coastFireTitle || 'Coast-FIRE'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '0.7rem' } },
            React.createElement('div', null,
              React.createElement('label', { style: labelStyle }, t.coastYears || 'Years to retirement'),
              React.createElement('input', { type: 'number', min: '1', defaultValue: retireYears, style: inputStyle,
                onChange: e => setRetireYears(Math.max(0, parseFloat(e.target.value) || 0)) })
            ),
            React.createElement('div', null,
              React.createElement('label', { style: labelStyle }, t.coastReturn || 'Real return (%)'),
              React.createElement('input', { type: 'number', step: '0.1', defaultValue: realReturn, style: inputStyle,
                onChange: e => setRealReturn(parseFloat(e.target.value) || 0) })
            )
          ),
          (() => {
            const coast = window.MaerminFireExtras.coastFire({ fireNumber: fireM.fireNumber, currentNetWorth: nw.netWorth, realReturn, yearsToRetirement: retireYears });
            const reached = coast.coastReached;
            return React.createElement('div', { style: { fontSize: '0.78rem', color: theme.textSecondary } },
              React.createElement('div', null,
                `${t.coastNumber || 'Coast number (needed today)'}: `,
                React.createElement('span', { style: { color: theme.text, fontWeight: '700' } }, `${formatPrice(coast.coastNumber)} ${sym}`),
                ` · ${Math.min(999, coast.coastProgress).toFixed(0)}%`
              ),
              React.createElement('div', { style: { marginTop: '0.35rem', color: reached ? (theme.success || '#22c55e') : theme.textSecondary } },
                reached
                  ? (t.coastReachedMsg || 'Coast reached — growth alone gets you to FIRE; new contributions are optional.')
                  : (t.coastNotYetMsg || 'Keep contributing — you have not hit your coast number yet.')
              ),
              React.createElement('div', { style: { marginTop: '0.35rem' } },
                `${t.coastProjected || 'Projected at retirement'}: ${formatPrice(coast.projectedAtRetirement)} ${sym} (${coast.projectedSurplus >= 0 ? '+' : ''}${formatPrice(coast.projectedSurplus)} ${sym} ${t.coastVsTarget || 'vs target'})`
              )
            );
          })()
        )
      )
    );
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
      : memoBy('ovTx', [transactions, overviewMode], () => transactions.filter(tx => (tx.portfolioId || 'default') === overviewMode));

    // Single-portfolio mode delegates to the shared SSOT (FIFO cost basis) too,
    // so the Overview chart/allocation match "All" mode and the stat cards.
    const overviewPortfolio = isAllMode
      ? allPortfoliosPortfolio
      : memoBy('ovPf', [overviewTransactions, exchangeRate, fxAt, corpActionsRev], () => window.MaerminMetrics.buildPositions(overviewTransactions, { exchangeRate, fxAt }));

    // Worker status → the header's green/red dot + a plain-language explanation
    // (never a silent failure when prices can't be fetched).
    const wsColor = demoMode ? '#8a93a3'
      : !workerStatus ? '#8a93a3'
      : workerStatus.ok ? '#22c55e'
      : workerStatus.reachable ? '#f59e0b' : '#ef4444';
    const wsLabel = demoMode ? 'Demo'
      : !workerStatus ? 'Worker…'
      : workerStatus.ok ? 'Live'
      : workerStatus.error === 'no-worker-url' ? 'No worker' : 'No data';
    const wsTitle = demoMode ? 'Demo mode — sample prices, no worker needed'
      : !workerStatus ? 'Checking worker reachability…'
      : workerStatus.ok ? 'Price worker online — live quotes'
      : workerStatus.error === 'no-worker-url' ? 'No worker URL set. Stock/CS2 prices need a Cloudflare Worker — click to set it up in API settings.'
      : workerStatus.reachable ? ('Worker reachable but returned an error (' + workerStatus.error + '). Click to review API settings.')
      : 'Worker not reachable — stock/CS2 prices unavailable. Click to check your worker URL.';

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

    return React.createElement('div', { style: { padding: '1.5rem' } },

      // ── Demo-mode banner ─────────────────────────────────────────────────
      demoMode && React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', padding: '0.6rem 0.9rem', marginBottom: '1rem', borderRadius: '10px', background: `${currentTheme.accent}14`, border: `1px solid ${currentTheme.accent}55`, color: currentTheme.text, fontSize: '0.82rem' } },
        React.createElement('span', null, '★ You are exploring MAERMIN with sample data — your real data is untouched. Changes made in demo mode are not saved.'),
        React.createElement('button', { onClick: exitDemo, style: { marginLeft: 'auto', minHeight: '40px', padding: '0.45rem 0.9rem', background: currentTheme.accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.8rem' } }, 'Exit demo & use my data')
      ),

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
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } },
          // Worker status indicator — click opens API settings.
          React.createElement('div', {
            onClick: () => setShowApiSettings(true), title: wsTitle,
            style: { display: 'flex', alignItems: 'center', gap: '0.4rem', minHeight: '40px', padding: '0.5rem 0.7rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', color: currentTheme.textSecondary }
          },
            React.createElement('span', { style: { width: 9, height: 9, borderRadius: '50%', background: wsColor, flexShrink: 0, boxShadow: `0 0 6px ${wsColor}` } }),
            wsLabel
          ),
          // Data-health chip — only appears when something is stale/missing.
          dqHealth && (dqHealth.stale + dqHealth.missing) > 0 && React.createElement('div', {
            onClick: () => fetchPrices(), title: [
              dqHealth.stale ? dqHealth.stale + ' price' + (dqHealth.stale > 1 ? 's' : '') + ' stale' : '',
              dqHealth.missing ? dqHealth.missing + ' price' + (dqHealth.missing > 1 ? 's' : '') + ' missing' : ''
            ].filter(Boolean).join(' · ') + ' — click to refresh prices',
            style: { display: 'flex', alignItems: 'center', gap: '0.4rem', minHeight: '40px', padding: '0.5rem 0.7rem', background: `${currentTheme.warning}14`, border: `1px solid ${currentTheme.warning}55`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', color: currentTheme.warning, fontWeight: '600' }
          },
            React.createElement('span', { style: { fontWeight: '800' } }, '!'),
            (dqHealth.stale + dqHealth.missing) + (dqHealth.stale ? ' stale' : ' missing')
          ),
          // FX transparency chip — shows the USD→EUR rate, source + age on hover.
          fxInfo && fxInfo.rate && React.createElement('div', {
            title: 'FX: ' + fxInfo.label + ' (source: ' + fxInfo.source + ')',
            style: { display: 'flex', alignItems: 'center', minHeight: '40px', padding: '0.5rem 0.7rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', fontSize: '0.78rem', color: currentTheme.textSecondary }
          }, `$→€ ${fxInfo.rate.toFixed(3)}`),
          // Demo toggle — instant value for first-run users.
          demoMode
            ? React.createElement('button', { onClick: exitDemo, style: { minHeight: '40px', padding: '0.5rem 0.9rem', background: currentTheme.inputBg, color: currentTheme.text, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' } }, 'Exit demo')
            : React.createElement('button', { onClick: enterDemo, title: 'Load sample data to explore the app instantly — no setup', style: { minHeight: '40px', padding: '0.5rem 0.9rem', background: currentTheme.inputBg, color: currentTheme.text, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' } }, '★ Try demo'),
          React.createElement('button', { onClick: () => openTransactionModal(), style: { padding: '0.5rem 1rem', background: currentTheme.accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.85rem' } }, '+ Add'),
          React.createElement('button', { onClick: () => setShowImportModal(true), style: { padding: '0.5rem 1rem', background: currentTheme.inputBg, color: currentTheme.text, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' } }, '↑ Import'),
          React.createElement('button', { onClick: fetchPrices, disabled: loading, style: { padding: '0.5rem 1rem', background: loading ? currentTheme.inputBg : `${currentTheme.accent}18`, color: loading ? currentTheme.textSecondary : currentTheme.accent, border: `1px solid ${currentTheme.accent}33`, borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.375rem' } }, loading ? '◎ Refreshing...' : '↻ Refresh prices')
        )
      ),

      // ── Portfolio selector tabs ──────────────────────────────────────────
      React.createElement('div', {
        role: 'group', 'aria-label': 'Show portfolio',
        style: { display: 'flex', gap: '0.375rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }
      },
        // All Portfolios tab
        React.createElement('button', {
          'aria-pressed': overviewMode === 'all',
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
            'aria-pressed': overviewMode === p.id,
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

      // ── Hero: total portfolio value ─────────────────────────────────────
      // The history chart already combines the big value, the all-time return
      // and the 1H…Max timeframe tabs — so it IS the hero. Rendered first.
      dashVis('valueChart') && window.MaerminFeatures6 && stats.totalPositions > 0 &&
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

      // ── Stats cards (mockup parity: Invested · Total Return · Dividends · Health) ──
      dashVis('statCards') && (() => {
        const M = window.MaerminMetrics;
        const divOv = M ? memoBy('ovDiv', [overviewPortfolio, prices], () => M.computeExpectedAnnualDividends(overviewPortfolio, prices)) : null;
        const healthOv = M ? memoBy('ovHealth', [overviewPortfolio, prices, t, priceHistory, overviewTransactions], () => M.healthScore(overviewPortfolio, prices, t, { priceHistory, transactions: overviewTransactions })) : null;
        const hColor = (s) => s >= 70 ? currentTheme.success : s >= 40 ? currentTheme.warning : currentTheme.danger;
        const hScore = healthOv && !healthOv.empty ? healthOv.score : null;
        return React.createElement('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }
        },
          statCard('Invested', `${formatPrice(stats.totalInvested)} ${getCurrencySymbol()}`,
            `across ${stats.totalPositions} position${stats.totalPositions !== 1 ? 's' : ''}`),
          statCard(labelReturn,
            `${isUp ? '+' : ''}${formatPrice(stats.totalProfit)} ${getCurrencySymbol()}`,
            `${pctStr} all time`,
            isUp ? currentTheme.success : currentTheme.danger),
          statCard('Dividends (12m)',
            (divOv && divOv.available) ? `${formatPrice(divOv.totalAnnual)} ${getCurrencySymbol()}` : '—',
            (divOv && divOv.available) ? `${formatPrice(divOv.monthly)} ${getCurrencySymbol()}/mo · ${divOv.yield.toFixed(1)}%` : 'No dividend payers',
            (divOv && divOv.available) ? currentTheme.success : undefined,
            () => setActiveView('dividends')),
          statCard('Health Score',
            hScore != null ? String(hScore) : '—',
            hScore != null ? `Grade ${healthOv.grade}` : 'Add positions to score',
            hScore != null ? hColor(hScore) : undefined,
            () => setActiveView('health'))
        );
      })(),

      // ── KPI strip removed: Dividends + Health now live in the stat cards above
      //    (Net Worth / FIRE remain reachable from their own sidebar views).
      false &&
        React.createElement(DashboardKpiStrip, {
          portfolio: overviewPortfolio,
          prices, priceHistory,
          transactions: overviewTransactions,
          portfolioValue: stats.totalValue,
          theme: currentTheme, t, formatPrice, getCurrencySymbol, setActiveView
        }),

      // ── Chart ────────────────────────────────────────────────────────────
      // (Portfolio value chart moved up to the Overview hero slot — see above)
      false &&
        React.createElement('div', null),

      // CS2 banner
      portfolio.skins && portfolio.skins.length > 0 && !(apiKeys.cs2Worker||'').trim() &&
        React.createElement('div', { style: { background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '10px', padding: '0.875rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' } },
          React.createElement('span', { style: { fontSize: '1.25rem' } }, '!'),
          React.createElement('div', { style: { flex: 1, minWidth: '200px' } },
            React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '0.875rem' } }, 'CS2 skin prices need a Cloudflare Worker URL'),
            React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.8rem', marginTop: '0.125rem' } }, 'Deploy the worker.js and paste the URL in API Settings.')
          ),
          React.createElement('button', { onClick: () => setShowApiSettings(true), style: { padding: '0.5rem 1rem', background: currentTheme.warning, color: '#1a1a1a', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '0.8rem' } }, 'Add Worker URL →')
        ),

      // Recovery-kit nudge for vaults created before recovery codes existed
      showRecoveryNudge && React.createElement('div', { style: { background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: '10px', padding: '0.875rem 1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' } },
        React.createElement('span', { style: { fontSize: '1.25rem', color: currentTheme.warning, fontWeight: '700' } }, '!'),
        React.createElement('div', { style: { flex: 1, minWidth: '220px' } },
          React.createElement('div', { style: { color: currentTheme.text, fontWeight: '600', fontSize: '0.875rem' } }, 'Add a recovery code'),
          React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.8rem', marginTop: '0.125rem' } }, 'Your vault has no recovery code. Without one, a forgotten password cannot be reset — generate a printable code now.')
        ),
        React.createElement('button', { onClick: createRecoveryKit, disabled: recoveryBusy, style: { padding: '0.5rem 1rem', background: currentTheme.accent, color: '#ffffff', border: 'none', borderRadius: '6px', cursor: recoveryBusy ? 'wait' : 'pointer', fontWeight: '700', fontSize: '0.8rem' } }, recoveryBusy ? 'Creating…' : 'Create recovery code'),
        React.createElement('button', { onClick: dismissRecoveryNudge, style: { padding: '0.5rem 0.75rem', background: 'transparent', color: currentTheme.textSecondary, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' } }, 'Dismiss')
      ),

      // Onboarding
      stats.totalPositions === 0 && React.createElement('div', { style: { background: 'linear-gradient(135deg,rgba(59,130,246,0.1),rgba(139,124,255,0.1))', border: '1px solid rgba(139,124,255,0.3)', borderRadius: '12px', padding: '2rem', marginBottom: '2rem', textAlign: 'center' } },
        React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.75rem', color: 'rgba(139,124,255,0.5)', fontWeight: '300' } }, '↗'),
        React.createElement('h3', { style: { color: currentTheme.text, fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.5rem' } }, t.welcomeTitle || 'Welcome to MAERMIN'),
        React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.875rem', marginBottom: '1rem', lineHeight: '1.6' } }, t.welcomeHint || 'Start by adding your first transaction.'),
        React.createElement('div', { style: { display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' } },
          window.MaerminOnboarding && window.MaerminOnboarding.Wizard && React.createElement('button', { onClick: openOnboarding, style: { padding: '0.625rem 1.25rem', background: currentTheme.accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.875rem' } }, 'Guided setup'),
          React.createElement('button', { onClick: () => openTransactionModal(), style: { padding: '0.625rem 1.25rem', background: currentTheme.inputBg, color: currentTheme.text, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '0.875rem' } }, '+ ' + (t.addTransaction || 'Add Transaction')),
          React.createElement('button', { onClick: () => setShowImportModal(true), style: { padding: '0.625rem 1.25rem', background: currentTheme.inputBg, color: currentTheme.text, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' } }, t.importData || 'Import Data')
        )
      ),

      // ── Allocation + Top performers + Positions (mockup-exact, real data) ──
      dashVis('allocation') && stats.totalPositions > 0 && (() => {
        const CLASS = {
          crypto:      { label: 'Crypto',        color: '#8b7cff' },
          stocks:      { label: 'Stocks & ETFs', color: '#6ea8ff' },
          commodities: { label: 'Commodities',   color: '#b98cff' },
          skins:       { label: 'CS2 Skins',     color: '#5fd0c5' },
        };
        // v10.x: include user-defined custom categories (custom-categories.js) so
        // they show in the Overview donut + legend. catMeta resolves label/colour.
        const customCatIds = window.MaerminCategories ? window.MaerminCategories.ids() : [];
        const catList = ['crypto', 'stocks', 'commodities', 'skins'].concat(customCatIds);
        const catMeta = (cat) => CLASS[cat] || (window.MaerminCategories
          ? { label: window.MaerminCategories.label(cat), color: window.MaerminCategories.color(cat) }
          : { label: cat, color: '#8b94a7' });
        const green = '#34d399', red = '#f87171', gray = '#8b94a7';
        const glyph = s => (s || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
        const money = v => `${formatPrice(v)} ${getCurrencySymbol()}`;
        const fmtPct = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
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

        const sectionTitle = txt => React.createElement('div', { style: { fontSize: '0.92rem', fontWeight: '600', marginBottom: '1.1rem', color: currentTheme.text } }, txt);

        const allocCard = React.createElement('div', { style: { background: currentTheme.card, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '16px', padding: '1.4rem 1.5rem' } },
          sectionTitle('Allocation by asset class'),
          // Wraps on narrow screens: the legend moves below the donut.
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '1.6rem', flexWrap: 'wrap', justifyContent: 'center' } },
            React.createElement('div', { style: { position: 'relative', width: '160px', height: '160px', flexShrink: 0 } },
              React.createElement('svg', { width: 160, height: 160, viewBox: '0 0 180 180', style: { transform: 'rotate(-90deg)' } },
                React.createElement('circle', { cx: 90, cy: 90, r: 70, fill: 'none', stroke: currentTheme.inputBg, strokeWidth: 18 }),
                ...donutSegs
              ),
              React.createElement('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' } },
                React.createElement('div', { style: { fontFamily: "'Geist', sans-serif", fontSize: '1.5rem', fontWeight: '700', lineHeight: 1, color: currentTheme.text } }, String(stats.totalPositions)),
                React.createElement('div', { style: { fontSize: '0.62rem', color: gray, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '0.15rem' } }, 'positions')
              )
            ),
            React.createElement('div', { style: { flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.7rem' } },
              ...classes.map(ct => React.createElement('div', { key: ct.c, style: { display: 'flex', alignItems: 'center', gap: '0.6rem' } },
                React.createElement('span', { style: { width: '9px', height: '9px', borderRadius: '3px', background: ct.color, flexShrink: 0 } }),
                React.createElement('span', { style: { flex: 1, fontSize: '0.82rem', color: currentTheme.text } }, ct.label),
                React.createElement('span', { style: { fontFamily: "'Geist', sans-serif", fontSize: '0.84rem', fontWeight: '600', color: currentTheme.text } }, `${ct.pct.toFixed(1)}%`),
                React.createElement('span', { style: { fontSize: '0.76rem', color: gray, width: '78px', textAlign: 'right' } }, money(ct.value))
              ))
            )
          )
        );

        const perfCard = React.createElement('div', { style: { background: currentTheme.card, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '16px', padding: '1.4rem 1.5rem' } },
          sectionTitle('Top performers'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.55rem' } },
            performers.length
              ? performers.map(p => React.createElement('div', { key: p.cat + p.sym, style: { display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '0.5rem 0.1rem' } },
                  React.createElement('div', { style: { width: '34px', height: '34px', borderRadius: '9px', background: `${p.color}22`, color: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Geist', sans-serif", fontWeight: '700', fontSize: '0.78rem', flexShrink: 0 } }, glyph(p.sym)),
                  React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                    React.createElement('div', { style: { fontSize: '0.84rem', fontWeight: '600', color: currentTheme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.name),
                    React.createElement('div', { style: { fontSize: '0.72rem', color: gray, fontFamily: "'Geist Mono', monospace" } }, glyph(p.sym))
                  ),
                  React.createElement('div', { style: { textAlign: 'right' } },
                    React.createElement('div', { style: { fontFamily: "'Geist', sans-serif", fontSize: '0.88rem', fontWeight: '600', color: p.pnlPct >= 0 ? green : red } }, fmtPct(p.pnlPct)),
                    React.createElement('div', { style: { fontSize: '0.72rem', color: gray } }, money(p.value))
                  )
                ))
              : React.createElement('div', { style: { fontSize: '0.8rem', color: gray } }, 'No priced positions yet — refresh prices to populate.')
          )
        );

        const th = (label, align, pad, width) => React.createElement('th', { key: label, style: { textAlign: align, padding: pad, fontSize: '0.66rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', color: gray, width } }, label);

        const positionsCard = React.createElement('div', { style: { background: currentTheme.card, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '16px', overflow: 'hidden', marginBottom: '1.5rem' } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem 0.9rem' } },
            React.createElement('div', { style: { fontSize: '0.92rem', fontWeight: '600', color: currentTheme.text } }, 'Positions'),
            React.createElement('div', { onClick: () => setActiveView('transactions'), style: { fontSize: '0.76rem', color: gray, cursor: 'pointer' } }, 'View all →')
          ),
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' } },
            React.createElement('thead', null,
              React.createElement('tr', { style: { borderTop: `1px solid ${currentTheme.cardBorder}` } },
                th('Asset', 'left', '0.7rem 1.5rem'),
                th('Qty', 'right', '0.7rem 0.75rem'),
                th('Price', 'right', '0.7rem 0.75rem'),
                th('Value', 'right', '0.7rem 0.75rem'),
                th('Weight', 'left', '0.7rem 1rem', '120px'),
                th('P&L', 'right', '0.7rem 1.5rem')
              )
            ),
            React.createElement('tbody', null,
              positions.map(p => React.createElement('tr', {
                key: p.cat + p.sym,
                ...window.MaerminUtils.clickable(() => setPositionDetail({
                  sym: p.sym, cat: p.cat, amount: p.amount,
                  avgPrice: p.amount > 0 ? p.cost / p.amount : 0
                })),
                'aria-label': `${p.name} details`,
                style: { borderTop: `1px solid ${currentTheme.cardBorder}`, cursor: 'pointer' }
              },
                React.createElement('td', { style: { padding: '0.85rem 1.5rem' } },
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.7rem' } },
                    React.createElement('div', { style: { width: '32px', height: '32px', borderRadius: '9px', background: `${p.color}22`, color: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Geist', sans-serif", fontWeight: '700', fontSize: '0.78rem', flexShrink: 0 } }, glyph(p.sym)),
                    React.createElement('div', null,
                      React.createElement('div', { style: { fontSize: '0.85rem', fontWeight: '600', color: currentTheme.text } }, p.name),
                      React.createElement('div', { style: { fontSize: '0.7rem', color: gray, fontFamily: "'Geist Mono', monospace" } }, glyph(p.sym))
                    )
                  )
                ),
                React.createElement('td', { style: { textAlign: 'right', padding: '0.85rem 0.75rem', fontFamily: "'Geist Mono', monospace", fontSize: '0.8rem', color: currentTheme.textSecondary } }, p.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })),
                React.createElement('td', { style: { textAlign: 'right', padding: '0.85rem 0.75rem', fontFamily: "'Geist', sans-serif", fontSize: '0.82rem', color: currentTheme.text } },
                  p.price > 0 ? money(p.price) : '—',
                  // Valued at cost because no quote has ever been fetched for it.
                  window.MaerminMarket.isCostFallback(p.sym) && React.createElement('div', { 'data-testid': 'no-price', title: 'No market price available yet — valued at cost basis.', style: { fontSize: '0.62rem', color: gray } }, 'no price · at cost')
                ),
                React.createElement('td', { style: { textAlign: 'right', padding: '0.85rem 0.75rem', fontFamily: "'Geist', sans-serif", fontSize: '0.85rem', fontWeight: '600', color: currentTheme.text } }, money(p.value)),
                React.createElement('td', { style: { padding: '0.85rem 1rem' } },
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                    React.createElement('div', { style: { flex: 1, height: '5px', background: currentTheme.inputBg, borderRadius: '3px', overflow: 'hidden' } },
                      React.createElement('div', { style: { width: `${totalVal > 0 ? (p.value / totalVal * 100) : 0}%`, height: '100%', background: p.color, borderRadius: '3px' } })
                    ),
                    React.createElement('span', { style: { fontSize: '0.72rem', color: gray, fontFamily: "'Geist', sans-serif" } }, `${totalVal > 0 ? (p.value / totalVal * 100).toFixed(1) : '0.0'}%`)
                  )
                ),
                React.createElement('td', { style: { textAlign: 'right', padding: '0.85rem 1.5rem' } },
                  React.createElement('div', { style: { fontFamily: "'Geist', sans-serif", fontSize: '0.85rem', fontWeight: '600', color: p.pnl >= 0 ? green : red } }, `${p.pnl >= 0 ? '+' : ''}${money(p.pnl)}`),
                  React.createElement('div', { style: { fontSize: '0.72rem', color: p.pnl >= 0 ? green : red } }, fmtPct(p.pnlPct))
                )
              ))
            )
          )
        );

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
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1rem', marginBottom: '1.25rem' } }, allocCard, perfCard),
          positionsCard,
          attributionPanel,
          positionDetail && window.MaerminFeatures3 && window.MaerminFeatures3.PositionDetailModal &&
            React.createElement(window.MaerminFeatures3.PositionDetailModal, {
              position: positionDetail, transactions: overviewTransactions, prices,
              theme: currentTheme, formatPrice, getCurrencySymbol, t,
              workerUrl: apiKeys.cs2Worker,
              // A split may have been added/removed inside the modal — re-run
              // the positions overlay so values and cost basis update.
              onClose: () => { setPositionDetail(null); setCorpActionsRev(n => n + 1); }
            })
        );
      })(),

      // Options book (no new tab): tracked separately from the shared positions
      // engine — buildPositions ignores the 'options' category by design. The
      // panel renders nothing when no option transactions exist.
      window.MaerminOptions && window.MaerminOptions.Panel &&
        React.createElement('div', { style: { marginTop: '1.5rem' } },
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
          // Daily closes on one date grid when at least two holdings have them
          // (available right after an import); else the refresh history.
          React.createElement(window.CorrelationMatrixView, Object.keys(dailyAnalytics.bySymbol).length >= 2
            ? { portfolio, priceHistory: dailyAnalytics.bySymbol, historySource: 'daily', t, theme: currentTheme, formatPrice }
            : { portfolio, priceHistory, t, theme: currentTheme, formatPrice })
          : renderAnalyticsPlaceholder('Correlation Matrix');
        case 'montecarlo': return React.createElement(React.Fragment, null,
          window.MonteCarloView
            ? React.createElement(window.MonteCarloView, { portfolio, prices, t, theme: currentTheme, currency, formatPrice })
            : renderAnalyticsPlaceholder('Monte Carlo'),
          // Fold in the (already-tested) analytics simulator: Future Value · FIRE
          // · Withdrawal · Monte-Carlo success probability — no new tab.
          window.MaerminSimulatorView && React.createElement(window.MaerminSimulatorView.Panel, {
            startValue: allPortfoliosStats.totalValue, theme: currentTheme, t, formatPrice, currency, getCurrencySymbol
          }),
          // Allocation backtester (what-if): backtest a target allocation
          // against real history vs benchmark presets and the actual portfolio.
          window.MaerminBacktester && React.createElement(window.MaerminBacktester.Panel, {
            portfolio, priceHistory, workerUrl: apiKeys.cs2Worker,
            theme: currentTheme, t, formatPrice, getCurrencySymbol
          })
        );
        case 'stress': return window.StressTestView ?
          React.createElement(window.StressTestView, { portfolio, prices, t, theme: currentTheme, currency, formatPrice })
          : renderAnalyticsPlaceholder('Stress Test');
        case 'risk': return React.createElement(React.Fragment, null,
          window.RiskAnalyticsViewV2
            ? React.createElement(window.RiskAnalyticsViewV2, { portfolio, prices, transactions: activeTransactions, setActiveView, t, theme: currentTheme, formatPrice,
                priceHistory: Object.keys(dailyAnalytics.byLower).length ? dailyAnalytics.byLower : priceHistory,
                historySource: Object.keys(dailyAnalytics.byLower).length ? 'daily' : 'refresh' })
            : renderAnalyticsPlaceholder('Risk Analysis'),
          // Rolling volatility/return trajectory + Fama-French factor exposure —
          // folds the analytics engine into Risk (no new tab).
          window.MaerminAnalyticsViews && React.createElement('div', { style: { padding: '0 1.5rem 1.5rem' } },
            React.createElement(window.MaerminAnalyticsViews.RollingRiskPanel, { portfolio, priceHistory, valueSeries: dailyAnalytics.index, theme: currentTheme, t }),
            window.MaerminAnalyticsViews.FactorExposurePanel && React.createElement(window.MaerminAnalyticsViews.FactorExposurePanel, { portfolio, priceHistory, valueSeries: dailyAnalytics.index, workerUrl: apiKeys.cs2Worker, theme: currentTheme, t }),
            // ETF look-through, risk slice: fund overlap matrix + hidden
            // concentration findings — folds into Risk (no new tab).
            window.MaerminLookThrough && window.MaerminLookThrough.Panel && React.createElement(window.MaerminLookThrough.Panel, {
              portfolio, prices, workerUrl: apiKeys.cs2Worker, mode: 'risk',
              theme: currentTheme, t, formatPrice, getCurrencySymbol
            })
          )
        );
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
  
  // Collapsible "Data check" box for ledgerIssues (null when there is none).
  const renderLedgerIssues = () => {
    if (!ledgerIssues.length) return null;
    const warnings = ledgerIssues.filter(i => i.severity === 'warning').length;
    const line = (i) => {
      if (i.kind === 'oversold') return `${i.symbol} (${i.category}): ${+i.qty.toFixed(8)} more unit(s) sold than bought. The excess has no cost basis and is left out of realised gains - add the missing buy or transfer.`;
      if (i.kind === 'quantity') return `${i.symbol || 'A transaction'} (${i.category}), ${i.type} on ${i.date || 'an unknown date'}: quantity "${i.qty}" is not a positive number, so the trade is left out. Edit it (a sell needs a positive quantity).`;
      if (i.status === 'unknown') return `${i.symbol || 'A transaction'} in ${i.currency}: no exchange rate, so the amounts are counted as EUR. Change the transaction currency.`;
      if (/^(USD|USDT|USDC|BUSD|FDUSD|TUSD|USDP|DAI)$/i.test(String(i.currency))) return `${i.currency} (e.g. ${i.symbol || 'a transaction'}): no stored USD rate for the trade date, so the nearest stored rate is used. Add a Worker URL in API Settings to load the daily history.`;
      return (window.MaerminFxHistory && window.MaerminFxHistory.hasHistory && window.MaerminFxHistory.hasHistory(i.currency))
        ? `${i.currency} (e.g. ${i.symbol || 'a transaction'}): no ${i.currency} rate for the trade date (not loaded through the Worker yet, or the rate history does not reach that date) - today's rate is used.`
        : `${i.currency} (e.g. ${i.symbol || 'a transaction'}): converted at today's rate for every date - there is no daily history for this currency.`;
    };
    return React.createElement('details', {
      'data-testid': 'ledger-issues',
      style: { background: warnings ? 'rgba(245,158,11,0.08)' : currentTheme.inputBg, border: `1px solid ${warnings ? 'rgba(245,158,11,0.35)' : currentTheme.inputBorder}`, borderRadius: '10px', padding: '0.6rem 0.9rem', marginBottom: '1rem', fontSize: '0.82rem', color: currentTheme.text }
    },
      React.createElement('summary', { style: { cursor: 'pointer', fontWeight: 700 } },
        `Data check: ${ledgerIssues.length} issue${ledgerIssues.length === 1 ? '' : 's'}` + (warnings ? ` (${warnings} affect cost basis or tax)` : '')),
      React.createElement('ul', { style: { margin: '0.5rem 0 0', paddingLeft: '1.1rem', lineHeight: 1.6, color: currentTheme.textSecondary } },
        ledgerIssues.slice(0, 20).map((i, k) => React.createElement('li', { key: k }, line(i))),
        ledgerIssues.length > 20 && React.createElement('li', { key: 'more' }, `… and ${ledgerIssues.length - 20} more`)));
  };

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
      renderLedgerIssues(),
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
              boxShadow: '0 6px 16px -6px rgba(139,124,255,0.5)'
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
                            background: window.MaerminUtils.txTypeInfo(tx.type, t).background,
                            color: tx.type === 'buy' ? currentTheme.success : tx.type === 'sell' ? currentTheme.danger : window.MaerminUtils.txTypeInfo(tx.type, t).color
                          }
                        }, window.MaerminUtils.txTypeInfo(tx.type, t).label)
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
                            // Which row: nine identical "Edit" buttons said nothing to a screen reader.
                            'aria-label': `${t.edit || 'Edit'}: ${window.MaerminUtils.txTypeInfo(tx.type, t).label} ${tx.symbolName || tx.symbol || ''}, ${String(tx.date || '').slice(0, 10)}`,
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
                            'aria-label': `${t.delete || 'Delete'}: ${window.MaerminUtils.txTypeInfo(tx.type, t).label} ${tx.symbolName || tx.symbol || ''}, ${String(tx.date || '').slice(0, 10)}`,
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
    const currentYear = taxYear;

    // Build the filing-grade report ONCE and derive the on-screen KPIs from it,
    // so the screen and the PDF/Excel export can never disagree (the KPIs used
    // to come from the legacy engine: no FX, crypto taxed like capital income).
    const buildReport = () => window.MaerminTaxReport && window.MaerminTaxReport.build(transactions, {
      year: currentYear, jurisdiction: taxJurisdiction, baseCurrency: 'EUR',
      exchangeRate, fxAt, owner: taxOwner, portfolio, prices
    });
    // Memoised: the report (FIFO over every transaction + German detail) used
    // to be rebuilt on EVERY render of the app. Besides the props it reads a
    // few stores directly, so their raw strings are part of the key - saving a
    // fund type, a Vorabpauschale record or a tax setting still rebuilds it.
    const storeKey = ['maermin_fund_types', 'maermin_vap_records', 'maermin_basiszins_overrides', 'maermin_kirchensteuer',
      'maermin_tax_settings', 'maermin_tax_overrides', 'maermin_divevents', 'maermin_corporate_actions', 'maermin_fx_usd_rates']
      .map(k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }).join('\u0001');
    let taxReport = null;
    try {
      taxReport = memoBy('taxReport', [transactions, currentYear, taxJurisdiction, exchangeRate, fxAt, taxOwner, portfolio, prices, taxSettingsRev, storeKey], buildReport);
    } catch (e) { console.warn('[TAX] report build failed:', e); }
    const taxData = (window.MaerminTaxReport && window.MaerminTaxReport.kpis)
      ? window.MaerminTaxReport.kpis(taxReport)
      : { realizedGains: 0, shortTerm: 0, longTerm: 0, taxLiability: 0 };

    // Years that have any transaction, newest first (plus the current year).
    const availableYears = (() => {
      const set = new Set([new Date().getFullYear()]);
      transactions.forEach(tx => { if (tx.date) set.add(new Date(tx.date).getFullYear()); });
      return Array.from(set).filter(y => y > 1990 && y < 2100).sort((a, b) => b - a);
    })();

    const inputStyle = { padding: '0.5rem 0.75rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '8px', color: currentTheme.text, fontSize: '0.85rem' };

    return React.createElement('div', { style: { padding: '1.5rem' } },
      renderLedgerIssues(),
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }
      },
        React.createElement('h2', {
          style: { color: currentTheme.text, fontSize: '1.5rem', fontWeight: '600' }
        }, t.taxReport || 'Tax Report'),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
          React.createElement('select', {
            value: currentYear, onChange: (e) => setTaxYear(parseInt(e.target.value, 10)),
            style: inputStyle, title: 'Tax year'
          }, availableYears.map(y => React.createElement('option', { key: y, value: y }, y))),
          React.createElement('select', {
            value: taxJurisdiction,
            onChange: (e) => setTaxJurisdiction(e.target.value),
            style: inputStyle
          },
            React.createElement('option', { value: 'de' }, t.germany || 'Germany'),
            React.createElement('option', { value: 'us' }, t.usa || 'USA')
          ),
          window.MaerminTaxReport && React.createElement('button', {
            onClick: () => { const r = buildReport(); if (r) window.MaerminTaxReport.exportPDF(r); },
            style: { padding: '0.5rem 1rem', background: currentTheme.accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }
          }, t.exportPdf || 'Export PDF'),
          window.MaerminTaxReport && React.createElement('button', {
            onClick: () => { const r = buildReport(); if (r) window.MaerminTaxReport.exportExcel(r); },
            style: { padding: '0.5rem 1rem', background: 'rgba(34,197,94,0.15)', color: currentTheme.success, border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }
          }, t.exportExcel || 'Export Excel')
        )
      ),

      // Taxpayer details (appear on the exported report).
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' } },
        React.createElement('input', { placeholder: 'Taxpayer name (optional)', value: taxOwner.name || '',
          onChange: (e) => setTaxOwner(o => ({ ...o, name: e.target.value })), style: { ...inputStyle, flex: 1, minWidth: 180 } }),
        React.createElement('input', { placeholder: 'Tax ID (optional)', value: taxOwner.taxId || '',
          onChange: (e) => setTaxOwner(o => ({ ...o, taxId: e.target.value })), style: { ...inputStyle, flex: 1, minWidth: 140 } })
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
      ),

      // Tax advisor (WI-3): forward-looking crypto Freigrenze countdown +
      // Sparerpauschbetrag headroom + loss-harvesting findings. Estimate only.
      taxJurisdiction === 'de' && window.MaerminTaxAdvisor && window.MaerminTaxAdvisor.Panel &&
        React.createElement(window.MaerminTaxAdvisor.Panel, {
          transactions, prices, exchangeRate, fxAt, taxOwner,
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
      restoreFocus: focusAccountButton,
      addToast
    });
  };

  // Security log viewer — recent vault/data events + captured errors.
  const renderAuditLogModal = () => {
    if (!showAuditLog) return null;
    const th = currentTheme;
    const entries = (window.MaerminAuditLog ? window.MaerminAuditLog.getEntries({ limit: 200 }) : []);
    const levelColor = (lv) => lv === 'error' ? '#ef4444' : lv === 'warn' ? '#f59e0b' : th.textSecondary;
    return React.createElement(window.MaerminUI.Overlay, {
      onClose: () => setShowAuditLog(false), restoreFocus: focusAccountButton,
      style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }
    },
      React.createElement('div', {
        ...window.MaerminUI.dialogProps('dlg-audit-log'),
        style: { background: th.card, border: `1px solid ${th.cardBorder}`, borderRadius: '14px', width: '100%', maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.1rem 1.25rem', borderBottom: `1px solid ${th.cardBorder}` } },
          React.createElement('div', { id: 'dlg-audit-log', style: { color: th.text, fontWeight: 800, fontSize: '1rem' } }, (t.securityLog || 'Security log')),
          React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
            React.createElement('button', { onClick: () => { if (window.MaerminAuditLog) { window.MaerminAuditLog.clear(); setShowAuditLog(false); setTimeout(() => setShowAuditLog(true), 0); } },
              style: { padding: '0.35rem 0.7rem', background: 'transparent', border: `1px solid ${th.cardBorder}`, borderRadius: '7px', color: th.textSecondary, cursor: 'pointer', fontSize: '0.75rem' } }, t.clear || 'Clear'),
            React.createElement('button', { onClick: () => setShowAuditLog(false),
              style: { padding: '0.35rem 0.7rem', background: 'transparent', border: `1px solid ${th.cardBorder}`, borderRadius: '7px', color: th.textSecondary, cursor: 'pointer', fontSize: '0.75rem' } }, '✕')
          )
        ),
        React.createElement('div', { style: { padding: '0.5rem 0.75rem', overflow: 'auto' } },
          entries.length === 0
            ? React.createElement('div', { style: { color: th.textSecondary, padding: '2rem', textAlign: 'center', fontSize: '0.85rem' } }, t.securityLogEmpty || 'No events recorded yet.')
            : entries.map((e, i) => React.createElement('div', { key: i, style: { display: 'flex', gap: '0.75rem', padding: '0.5rem 0.5rem', borderBottom: `1px solid ${th.cardBorder}33`, fontSize: '0.78rem', alignItems: 'baseline' } },
                React.createElement('span', { style: { color: th.textSecondary, fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap', opacity: 0.8 } }, new Date(e.t).toLocaleString('en-US')),
                React.createElement('span', { style: { color: levelColor(e.level), fontWeight: 600, whiteSpace: 'nowrap' } }, e.type),
                React.createElement('span', { style: { color: th.text, flex: 1, wordBreak: 'break-word' } }, e.detail)
              ))
        ),
        React.createElement('div', { style: { padding: '0.6rem 1.25rem', borderTop: `1px solid ${th.cardBorder}`, color: th.textSecondary, fontSize: '0.7rem' } },
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
        targetPortfolioId: activePortfolioId,
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

    return React.createElement(window.MaerminUI.Overlay, {
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
      onClose: requestClose
    },
      React.createElement('div', {
        ...window.MaerminUI.dialogProps('dlg-transaction'),
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
          id: 'dlg-transaction',
          style: { color: currentTheme.text, marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' }
        }, isEditing ? (t.editTransaction || 'Edit Transaction') : (t.addTransaction || 'Add Transaction')),
        
        // Portfolio selector — always shown as a select dropdown
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', { htmlFor: 'tx-portfolio', style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' } }, 'Portfolio'),
          React.createElement('select', {
            id: 'tx-portfolio',
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
            id: 'tx-type-label',
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.type || 'Type'),
          React.createElement('div', { role: 'group', 'aria-labelledby': 'tx-type-label', style: { display: 'flex', gap: '0.5rem' } },
            ['buy', 'sell'].map(type =>
              React.createElement('button', {
                key: type,
                'aria-pressed': newTransaction.type === type,
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
            id: 'tx-category-label',
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.category || 'Category'),
          React.createElement('div', { role: 'group', 'aria-labelledby': 'tx-category-label', style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
            ['crypto', 'stocks', 'skins', 'commodities', 'options']
              .concat(window.MaerminCategories ? window.MaerminCategories.ids() : []).map(cat =>
              React.createElement('button', {
                key: cat,
                'aria-pressed': newTransaction.category === cat,
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
                      newTransaction.price && React.createElement('div', { style: { color: currentTheme.success, fontSize: '0.75rem', marginTop: '0.125rem' } }, `$${parseFloat(newTransaction.price).toFixed(2)}`)
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
            // Option contract fields: underlying + call/put + strike + expiry +
            // contract size. The contract symbol (tx.symbol) is derived on save
            // via MaerminOptions.contractSymbol, so no symbol picker is needed.
            : newTransaction.category === 'options'
              ? React.createElement('div', null,
                  React.createElement('input', {
                    type: 'text', value: newTransaction.underlying || '',
                    onChange: e => setNewTransaction(prev => ({ ...prev, underlying: e.target.value.toUpperCase() })),
                    placeholder: 'Underlying symbol: AAPL, SAP.DE...', 'aria-label': 'Underlying symbol',
                    style: { width: '100%', padding: '0.625rem 0.875rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '8px', color: currentTheme.text, fontSize: '0.875rem', boxSizing: 'border-box', marginBottom: '0.625rem' }
                  }),
                  React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '0.625rem' } },
                    ['call', 'put'].map(ot => React.createElement('button', {
                      key: ot,
                      'aria-pressed': (newTransaction.optionType || 'call') === ot,
                      onClick: () => setNewTransaction(prev => ({ ...prev, optionType: ot })),
                      style: {
                        flex: 1, padding: '0.5rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600',
                        background: (newTransaction.optionType || 'call') === ot ? (ot === 'call' ? '#22c55e' : '#ef4444') : currentTheme.inputBg,
                        color: (newTransaction.optionType || 'call') === ot ? '#fff' : currentTheme.text
                      }
                    }, ot === 'call' ? 'Call' : 'Put'))),
                  React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                    React.createElement('input', {
                      type: 'number', value: newTransaction.strike || '', min: 0, step: 'any',
                      onChange: e => setNewTransaction(prev => ({ ...prev, strike: e.target.value })),
                      placeholder: 'Strike', 'aria-label': 'Strike price',
                      style: { flex: 1, padding: '0.625rem 0.875rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '8px', color: currentTheme.text, fontSize: '0.875rem', minWidth: 0 }
                    }),
                    React.createElement('input', {
                      type: 'date', value: newTransaction.expiry || '',
                      onChange: e => setNewTransaction(prev => ({ ...prev, expiry: e.target.value })),
                      title: 'Expiry date', 'aria-label': 'Expiry date',
                      style: { flex: 1, padding: '0.625rem 0.875rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '8px', color: currentTheme.text, fontSize: '0.875rem', minWidth: 0 }
                    }),
                    React.createElement('input', {
                      type: 'number', value: newTransaction.contractSize || '', min: 1,
                      onChange: e => setNewTransaction(prev => ({ ...prev, contractSize: e.target.value })),
                      placeholder: 'Size (100)', 'aria-label': 'Contract size', title: 'Contract size (shares per contract, default 100)',
                      style: { width: '90px', padding: '0.625rem 0.875rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '8px', color: currentTheme.text, fontSize: '0.875rem' }
                    })),
                  React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.72rem', marginTop: '0.5rem', lineHeight: 1.5 } },
                    'Quantity = number of contracts, price = premium per share. Buy = long / close a short, sell = write (short) / close a long.')
                )
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
                      'aria-pressed': newTransaction.symbol === c.sym,
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
                    placeholder: 'or enter ETF symbol: GLD, SLV, IAU...', 'aria-label': 'Symbol',
                    style: { width: '100%', padding: '0.625rem 0.875rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '8px', color: currentTheme.text, fontSize: '0.875rem', boxSizing: 'border-box' }
                  })
                )

            // Default fallback: plain text (for categories without picker)
            : React.createElement('input', {
                type: 'text', value: newTransaction.symbol,
                onChange: e => setNewTransaction(prev => ({ ...prev, symbol: e.target.value.toUpperCase() })),
                placeholder: 'Symbol...', 'aria-label': 'Symbol',
                style: { width: '100%', padding: '0.75rem', background: currentTheme.inputBg, border: `1px solid ${currentTheme.inputBorder}`, borderRadius: '8px', color: currentTheme.text }
              })
          ),
        
        // Quantity
        React.createElement('div', { style: { marginBottom: '1rem' } },
          React.createElement('label', {
            htmlFor: 'tx-quantity',
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.quantity || 'Quantity'),
          React.createElement('input', {
            id: 'tx-quantity',
            ...invalidProps('quantity'),
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
            htmlFor: 'tx-price',
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.pricePerUnit || 'Price per Unit'),
          React.createElement('input', {
            id: 'tx-price',
            ...invalidProps('price'),
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
            htmlFor: 'tx-date',
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.date || 'Date'),
          React.createElement('input', {
            id: 'tx-date',
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
            htmlFor: 'tx-fees',
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.feesOptional || 'Fees (optional)'),
          React.createElement('input', {
            id: 'tx-fees',
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
            htmlFor: 'tx-notes',
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.notesOptional || 'Notes (optional)'),
          React.createElement('input', {
            id: 'tx-notes',
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
            id: 'tx-currency-label',
            style: { display: 'block', color: currentTheme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
          }, t.currency || 'Currency'),
          React.createElement('div', { role: 'group', 'aria-labelledby': 'tx-currency-label', style: { display: 'flex', gap: '0.5rem' } },
            ['EUR', 'USD'].map(cur =>
              React.createElement('button', {
                key: cur,
                'aria-pressed': newTransaction.currency === cur,
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
                style: {
                  flex: 1, padding: '0.5rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600',
                  background: other ? currentTheme.accent : currentTheme.inputBg, color: other ? '#fff' : currentTheme.text,
                  border: 'none'
                }
              },
                React.createElement('option', { value: '', style: { background: currentTheme.inputBg, color: currentTheme.text } }, t.otherCurrency || 'Other…'),
                // keep a stored currency selectable even if it is not in the list (e.g. an imported one)
                (other && list.indexOf(cur) === -1 ? [cur] : []).concat(list).map(c => React.createElement('option', { key: c, value: c, style: { background: currentTheme.inputBg, color: currentTheme.text } }, c))
              );
            })()
          ),
          (() => {
            const FXH = window.MaerminFxHistory;
            const cur = newTransaction.currency || 'EUR';
            if (cur === 'EUR' || cur === 'USD' || !FXH) return null;
            const d = newTransaction.date || window.MaerminUtils.todayISO();
            const res = FXH.txToEUR(1, cur, d, exchangeRate, fxAt);
            const show = (v) => (v >= 0.1 ? v.toFixed(4) : v.toPrecision(4));
            const hasW = (apiKeys.cs2Worker || '').trim().length > 5;
            return React.createElement('div', { 'data-testid': 'tx-currency-hint', style: { color: currentTheme.textSecondary, fontSize: '0.78rem', marginTop: '0.4rem', lineHeight: 1.5 } },
              res.status === 'exact' ? `1 ${cur} = ${show(res.value)} EUR on ${d} (rate of the trade date).`
                : res.status === 'approx' ? (FXH.hasHistory(cur)
                    ? (hasW ? `The ${cur} rate of the trade date is loaded after saving. Today's rate until then: 1 ${cur} ≈ ${show(res.value)} EUR.`
                            : `Without a Worker only today's rate is available: 1 ${cur} ≈ ${show(res.value)} EUR. Add a Worker URL in API Settings for the rate of the trade date.`)
                    : `No daily history for ${cur}: today's rate is used for every date (1 ${cur} ≈ ${show(res.value)} EUR).`)
                : `No exchange rate for ${cur} - the amount would be counted as EUR.`);
          })()
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
            `${((window.MaerminUtils.parseDecimal(newTransaction.quantity) || 0) * (window.MaerminUtils.parseDecimal(newTransaction.price) || 0)).toFixed(2)} ${newTransaction.currency || 'EUR'}`
          )
        ),
        
        // Which required fields are still empty after a save attempt.
        shownMissing.length ? React.createElement('div', {
          id: 'tx-missing', role: 'alert',
          style: { color: currentTheme.danger, fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }
        }, `${t.fillInFields || 'Please fill in'}: ${shownMissing.map(f => fieldNames[f]).join(', ')}`) : null,

        // Buttons
        React.createElement('div', { style: { display: 'flex', gap: '1rem' } },
          React.createElement('button', {
            onClick: requestClose,
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
    
    return React.createElement(window.MaerminUI.Overlay, {
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
      onClose: () => setShowImportModal(false)
    },
      React.createElement('div', {
        ...window.MaerminUI.dialogProps('dlg-import'),
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
          id: 'dlg-import',
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
    
    return React.createElement(window.MaerminUI.Overlay, {
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
      onClose: () => setShowApiSettings(false), restoreFocus: focusAccountButton
    },
      React.createElement('div', {
        ...window.MaerminUI.dialogProps('dlg-api-settings'),
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
          id: 'dlg-api-settings',
          style: { color: currentTheme.text, marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' }
        }, t.apiSettings || 'API Settings'),
        
        React.createElement('p', {
          style: { color: currentTheme.textSecondary, marginBottom: '1.5rem', fontSize: '0.875rem', lineHeight: '1.5' }
        }, 'Configure API keys for live prices. Crypto (CoinGecko) and exchange rates are always free.'),

        // ── Cloudflare Worker (CS2 + Yahoo Finance Historical Data) ─────────
        React.createElement('div', {
          style: { background: `linear-gradient(135deg, rgba(139,124,255,0.08), rgba(59,130,246,0.05))`, border: `1px solid rgba(139,124,255,0.25)`, padding: '1.25rem', borderRadius: '10px', marginBottom: '1rem' }
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
            React.createElement('div', { style: { background: 'rgba(139,124,255,0.06)', border: '1px solid rgba(139,124,255,0.15)', borderRadius: '6px', padding: '0.625rem 0.75rem', fontSize: '0.72rem', color: currentTheme.textSecondary, lineHeight: '1.6' } },
              React.createElement('div', { style: { color: '#8b7cff', fontWeight: '700', marginBottom: '0.25rem' } }, 'CS2 Price History'),
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
          }),
          window.MaerminOnboarding && window.MaerminOnboarding.Wizard && React.createElement('button', {
            onClick: () => { setShowApiSettings(false); openOnboarding(); },
            style: { marginTop: '0.625rem', padding: '0.5rem 0.9rem', background: 'transparent', color: currentTheme.accent, border: `1px solid ${currentTheme.accent}`, borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '0.8rem' }
          }, 'Guided setup & connection test')
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
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600'
          }
        }, t.close || 'Close')
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
      onSaveWorkerUrl: (u) => { saveWorkerUrl(u); addToast('Worker URL saved — refreshing prices', 'success'); },
      onActivateDemo: () => { closeOnboarding(); enterDemo(); },
      onClose: closeOnboarding
    });
  };

  const renderRecoveryKitModal = () => {
    if (!showRecoveryKit) return null;
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
        w.document.write('<title>MAERMIN Recovery Code</title><pre style="font:14px ui-monospace,Menlo,monospace;padding:24px;white-space:pre-wrap">' + esc + '</pre>');
        w.document.close(); w.focus(); w.print();
      } catch (e) {}
    };
    const doCopy = () => { try { navigator.clipboard.writeText(code); addToast('Recovery code copied', 'success'); } catch (e) {} };
    const altBtn = (label, onClick) => React.createElement('button', { onClick, style: { flex: 1, padding: '0.6rem', background: 'transparent', color: currentTheme.text, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem' } }, label);
    return React.createElement(window.MaerminUI.Overlay, { dismissable: false, restoreFocus: focusAccountButton, style: { position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(3,6,12,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' } },
      React.createElement('div', { ...window.MaerminUI.dialogProps('dlg-recovery'), style: { background: currentTheme.cardBg || '#141a25', border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '16px', padding: '1.75rem', width: '100%', maxWidth: '460px', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.7)' } },
        React.createElement('h3', { id: 'dlg-recovery', style: { color: currentTheme.text, fontSize: '1.15rem', fontWeight: '700', margin: '0 0 0.5rem' } }, 'Your recovery code'),
        React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.85rem', lineHeight: '1.55', margin: '0 0 1rem' } }, 'Save this now — it can unlock your vault if you forget your password. It is shown once and never stored in readable form. Anyone with it can open your vault.'),
        React.createElement('div', { style: { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: '1.05rem', letterSpacing: '0.05em', color: currentTheme.accent, background: currentTheme.inputBg, border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '10px', padding: '1rem', textAlign: 'center', wordBreak: 'break-all', userSelect: 'all', marginBottom: '0.9rem' } }, code),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1rem' } }, doCopy && altBtn('Copy', doCopy), altBtn('Download', doDownload), altBtn('Print', doPrint)),
        React.createElement('button', { onClick: () => setShowRecoveryKit(false), style: { width: '100%', padding: '0.7rem', background: currentTheme.accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.9rem' } }, 'Done — I\'ve saved it')
      )
    );
  };

  // ========== SECURITY & SYNC MODAL ==========
  const renderSecurityModal = () => {
    if (!showSecurity) return null;
    const A = window.MaerminAuth, S = window.MaerminSync;
    const status = (A && A.getStatus) ? A.getStatus() : {};
    const syncCfg = (S && S.getConfig) ? S.getConfig() : null;
    const syncState = (S && S.getState) ? S.getState() : null;
    const workerUrl = (apiKeys.cs2Worker || '').trim();
    const bump = () => setSecurityRev(r => r + 1);
    const lockMin = Math.round((status.autoLockMs || 900000) / 60000);

    const fmtAgo = (ts) => {
      if (!ts) return 'never';
      const s = Math.floor((Date.now() - ts) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + ' min ago';
      if (s < 86400) return Math.floor(s / 3600) + ' h ago';
      return Math.floor(s / 86400) + ' d ago';
    };
    const badge = (txt, good) => React.createElement('span', { style: { fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: good ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)', color: good ? currentTheme.success : currentTheme.textSecondary, fontWeight: '700' } }, txt);
    const smallBtn = (label, onClick, disabled) => React.createElement('button', { onClick, disabled, style: { padding: '0.4rem 0.8rem', background: 'transparent', color: currentTheme.accent, border: `1px solid ${currentTheme.accent}`, borderRadius: '6px', cursor: disabled ? 'wait' : 'pointer', fontSize: '0.78rem', fontWeight: '600', opacity: disabled ? 0.6 : 1 } }, label);
    const row = (label, control) => React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.55rem 0', borderBottom: `1px solid ${currentTheme.cardBorder}` } }, React.createElement('span', { style: { color: currentTheme.text, fontSize: '0.85rem' } }, label), control);
    const sectionTitle = (txt) => React.createElement('div', { style: { color: currentTheme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '1.1rem 0 0.3rem' } }, txt);

    const addPasskey = () => { if (!A || !A.enrollPasskey) return; A.enrollPasskey('MAERMIN').then((res) => { if (res && res.enrolled) { addToast('Passkey enrolled ✓', 'success'); bump(); } else { addToast('This authenticator has no PRF support', 'error'); } }, () => addToast('Passkey enrollment cancelled', 'error')); };
    const enableAtRest = () => { if (window.MaerminStorage && window.MaerminStorage.enableAtRest) window.MaerminStorage.enableAtRest().then(() => { addToast('Data encrypted at rest ✓', 'success'); bump(); }, () => addToast('Could not enable at-rest encryption', 'error')); };
    const setLock = (min) => { if (A && A.setAutoLock) { A.setAutoLock(min * 60000); addToast('Auto-lock set to ' + min + ' min', 'success'); bump(); } };
    const runSync = () => { if (!S || !S.sync) return; setSyncBusy(true); S.sync().then((r) => { setSyncBusy(false); addToast(r && r.unchanged ? 'Already up to date' : 'Synced ✓', 'success'); bump(); }, (e) => { setSyncBusy(false); addToast('Sync failed: ' + ((e && e.message) || 'error'), 'error'); }); };
    const doEnableSync = () => { if (!workerUrl) { addToast('Add a Worker URL in API Settings first', 'error'); return; } if (!S) return; S.configure({ provider: 'worker', endpoint: workerUrl }); if (S.enableAutoSync) S.enableAutoSync(); runSync(); };
    const syncOn = !!((S && S.isConfigured && S.isConfigured()) || (syncCfg && syncCfg.provider));

    return React.createElement(window.MaerminUI.Overlay, { onClose: () => setShowSecurity(false), restoreFocus: focusAccountButton, style: { position: 'fixed', inset: 0, zIndex: 9050, background: 'rgba(3,6,12,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' } },
      React.createElement('div', { ...window.MaerminUI.dialogProps('dlg-security'), style: { background: currentTheme.modalBg || currentTheme.cardBg || '#141a25', border: `1px solid ${currentTheme.cardBorder}`, borderRadius: '16px', padding: '1.75rem', width: '100%', maxWidth: '500px', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 30px 70px -20px rgba(0,0,0,0.7)' } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' } },
          React.createElement('h3', { id: 'dlg-security', style: { color: currentTheme.text, fontSize: '1.15rem', fontWeight: '700', margin: 0 } }, 'Security & sync'),
          React.createElement('button', { onClick: () => setShowSecurity(false), 'aria-label': 'Close', style: { background: 'none', border: 'none', color: currentTheme.textSecondary, fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 } }, '×')
        ),
        sectionTitle('Vault'),
        row('Encryption at rest', status.encryptedAtRest ? badge('On', true) : smallBtn('Encrypt now', enableAtRest)),
        row('Key derivation', badge(status.kdf === 'argon2id' ? 'Argon2id' : 'PBKDF2-600k', true)),
        row('Auto-lock', React.createElement('div', { style: { display: 'flex', gap: '0.3rem' } }, [1, 5, 15, 30].map((m) => React.createElement('button', { key: m, onClick: () => setLock(m), style: { padding: '0.3rem 0.5rem', background: lockMin === m ? currentTheme.accent : currentTheme.inputBg, color: lockMin === m ? '#ffffff' : currentTheme.text, border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: lockMin === m ? '700' : '500' } }, m + 'm')))),
        sectionTitle('Access'),
        row('Passkey unlock', status.passkeySupported ? (status.hasPasskey ? badge('Enrolled', true) : smallBtn('Add passkey', addPasskey)) : badge('Unsupported', false)),
        row('Recovery code', status.hasRecovery ? React.createElement('div', { style: { display: 'flex', gap: '0.4rem', alignItems: 'center' } }, badge('Active', true), smallBtn('Rotate', createRecoveryKit, recoveryBusy)) : smallBtn(recoveryBusy ? 'Creating…' : 'Create', createRecoveryKit, recoveryBusy)),
        sectionTitle('Cloud sync (zero-knowledge)'),
        React.createElement('p', { style: { color: currentTheme.textSecondary, fontSize: '0.76rem', lineHeight: '1.5', margin: '0 0 0.4rem' } }, 'Your encrypted snapshot syncs via your own Worker. The server only ever sees ciphertext; the account id is derived from your vault.'),
        row('Status', syncOn ? badge('Enabled · last ' + fmtAgo(syncState && syncState.lastSyncAt), true) : badge('Not enabled', false)),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.7rem' } },
          syncOn ? smallBtn(syncBusy ? 'Syncing…' : 'Sync now', runSync, syncBusy) : null,
          syncOn ? null : smallBtn(syncBusy ? '…' : 'Enable & sync', doEnableSync, syncBusy || !workerUrl)
        ),
        !workerUrl && React.createElement('div', { style: { color: currentTheme.warning, fontSize: '0.74rem', marginTop: '0.4rem' } }, 'Add a Worker URL in API Settings to enable sync.')
      )
    );
  };

  // ========== MAIN RENDER ==========
  const Icon = window.MaerminIcon || (() => null);
  const Logo = (window.MaerminIcons && window.MaerminIcons.Logo) || (() => null);
  const themeChoices = [
    ['dark', 'Dark', '#0f1018'], ['white', 'Light', '#ffffff'], ['purple', 'Nebula', '#140e24'],
    ['contrast', 'Contrast', '#000000'], ['cb', 'CB-safe', '#1f8ad1']
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
  const menuItem = (icon, label, onClick, danger) => React.createElement('button', { type: 'button', className: 'mx-menu-item' + (danger ? ' is-danger' : ''), onClick }, Icon(icon, { size: 16 }), React.createElement('span', null, label));
  const popLabel = (text) => React.createElement('span', { className: 'mx-pop-label' }, text);

  return React.createElement('div', {
    className: 'mx-app',
    'data-theme': currentTheme.name || theme,
    style: {
      minHeight: '100vh',
      background: currentTheme.background,
      backgroundAttachment: 'fixed',
      color: currentTheme.text
    }
  },
    // Skip link: first Tab stop, jumps past header and sidebar
    React.createElement('a', {
      href: '#main', className: 'mx-skip-link',
      onClick: (e) => { e.preventDefault(); const m = document.getElementById('main'); if (m) m.focus(); }
    }, t.skipToContent || 'Skip to content'),
    // Header — frosted glass top bar
    React.createElement('header', { className: 'mx-header maermin-header' },
      // Animated hairline under the header (styles.css .mx-hairline): a clipped
      // strip whose sheen moves by transform, so it runs on the compositor.
      React.createElement('span', { className: 'mx-hairline', 'aria-hidden': 'true' }),
      React.createElement('div', { className: 'mx-brand' },
        Logo({ size: 32 }),
        React.createElement('h1', { className: 'mx-brand-name' }, 'MAERMIN'),
        React.createElement('span', { className: 'mx-brand-tag' }, 'v10')
      ),

      // Command search
      React.createElement('button', {
        type: 'button',
        className: 'mx-search',
        onClick: () => window.MaerminUI.openOverlay('commandPalette'),
        'aria-label': t.searchCommands || 'Search features & jump to…'
      },
        Icon('search', { size: 16 }),
        React.createElement('span', null, t.searchCommands || 'Search features & jump to…'),
        React.createElement('kbd', { className: 'mx-kbd' }, '⌘K')
      ),

      React.createElement('div', { className: 'mx-actions', ref: settingsRef },
        React.createElement('div', { className: 'mx-live', title: 'App is live' }, React.createElement('i'), 'Live'),

        // Privacy toggle (mask all amounts)
        React.createElement('button', {
          type: 'button',
          className: 'mx-icon-btn' + (privacyMode ? ' is-on' : ''),
          onClick: () => setPrivacyMode(p => !p),
          title: (privacyMode ? (t.showAmounts || 'Show amounts') : (t.hideAmounts || 'Hide amounts')) + ' (p)',
          'aria-label': privacyMode ? (t.showAmounts || 'Show amounts') : (t.hideAmounts || 'Hide amounts'),
          'aria-pressed': privacyMode
        }, Icon(privacyMode ? 'eye-off' : 'eye', { size: 18 })),

        // Settings button
        React.createElement('button', {
          type: 'button',
          ref: settingsBtnRef,
          className: 'mx-icon-btn' + (showSettings ? ' is-on' : ''),
          onClick: () => setShowSettings(!showSettings),
          title: t.settings || 'Settings',
          'aria-label': t.settings || 'Settings',
          'aria-expanded': showSettings,
          'aria-controls': 'mx-settings-panel'
        }, Icon('settings', { size: 18 })),

        // Settings popover: a labelled group of ordinary buttons (Tab moves
        // through them). It used to claim role="menu" without menu items or
        // arrow-key handling.
        showSettings && React.createElement('div', { className: 'mx-popover', id: 'mx-settings-panel', role: 'group', 'aria-label': t.settings || 'Settings' },
          React.createElement('div', { style: { marginBottom: '0.9rem' } },
            popLabel(t.theme || 'Theme'),
            React.createElement('div', { className: 'mx-seg' },
              themeChoices.map(([th, lbl, sw]) => segBtn(th, theme === th, (e) => switchTheme(th, e), [
                React.createElement('span', { key: 's', className: 'mx-swatch', style: { background: sw } }),
                React.createElement('span', { key: 'l', style: { fontSize: '0.64rem' } }, lbl)
              ], { title: lbl }))
            )
          ),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.9rem' } },
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
          React.createElement('div', { style: { marginBottom: '0.9rem' } },
            popLabel(t.privacy || 'Privacy'),
            React.createElement('button', {
              type: 'button',
              className: 'mx-menu-item',
              onClick: () => setPrivacyMode(p => !p),
              title: 'Shortcut: p',
              style: { justifyContent: 'space-between', background: 'var(--hover)', border: '1px solid var(--border)' }
            },
              React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '0.6rem' } }, Icon(privacyMode ? 'eye-off' : 'eye', { size: 16 }), t.hideAmounts || 'Hide amounts'),
              React.createElement('span', { style: { width: 34, height: 20, borderRadius: 999, padding: 2, background: privacyMode ? 'var(--accent)' : 'var(--border-strong)', transition: 'background .15s', display: 'flex', justifyContent: privacyMode ? 'flex-end' : 'flex-start' } },
                React.createElement('span', { style: { width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)' } }))
            )
          ),
          // Motion effects (Aurora FX) — toggling reloads so every surface re-inits.
          window.MaerminFX && React.createElement('div', { style: { marginBottom: '0.9rem' } },
            popLabel('Motion'),
            React.createElement('button', {
              type: 'button',
              className: 'mx-menu-item',
              onClick: () => window.MaerminFX.setEnabled(!window.MaerminFX.enabled()),
              style: { justifyContent: 'space-between', background: 'var(--hover)', border: '1px solid var(--border)' }
            },
              React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '0.6rem' } }, Icon('sparkle', { size: 16 }), 'Animations & effects'),
              React.createElement('span', { style: { width: 34, height: 20, borderRadius: 999, padding: 2, background: window.MaerminFX.enabled() ? 'var(--accent)' : 'var(--border-strong)', display: 'flex', justifyContent: window.MaerminFX.enabled() ? 'flex-end' : 'flex-start' } },
                React.createElement('span', { style: { width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)' } }))
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
              askConfirm({ title: t.caRemoveConfirm || 'Remove this split?', message: a.symbol + ' ' + a.num + ':' + a.den + ' on ' + a.date + '. It can be re-added or re-scanned.', confirmLabel: t.caRemove || 'Remove', danger: true })
                .then(function (yes) { if (!yes) return; CA.remove(a.id); setCorpActionsRev(function (n) { return n + 1; }); });
            };
            return React.createElement('div', { key: 'corp-' + corpActionsRev, style: { marginBottom: '1rem' } },
              React.createElement('label', { style: { color: currentTheme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, t.caTitle || 'Corporate actions (splits)'),
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '0.5rem', maxHeight: '140px', overflow: 'auto' } },
                all.map(function (a) {
                  return React.createElement('div', { key: a.id, style: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.4rem', alignItems: 'center', padding: '0.3rem 0', borderBottom: '1px solid ' + currentTheme.cardBorder, fontSize: '0.76rem' } },
                    React.createElement('span', { style: { color: currentTheme.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a.symbol + ' ' + a.num + ':' + a.den),
                    React.createElement('span', { style: { color: currentTheme.textSecondary } }, a.date),
                    React.createElement('span', Object.assign({}, ((window.MaerminUtils && window.MaerminUtils.clickable) ? window.MaerminUtils.clickable(function () { removeOne(a); }) : { onClick: function () { removeOne(a); } }), { style: { color: currentTheme.danger || '#ef4444', cursor: 'pointer' }, 'aria-label': (t.caRemove || 'Remove') + ' ' + a.symbol }), '×')
                  );
                })
              )
            );
          })(),
          React.createElement('div', { className: 'mx-divider' }),
          menuItem('key', t.changePassword || 'Change Password', () => { setShowSettings(false); setShowPasswordModal(true); }),
          menuItem('data', t.apiSettings || 'API Settings', () => { setShowSettings(false); setShowApiSettings(true); }),
          menuItem('shield', 'Security & sync', () => { setShowSettings(false); setShowSecurity(true); }),
          React.createElement('div', { className: 'mx-divider' }),
          // Encrypted vault backup — disaster recovery (the vault has no password
          // recovery, so an offline backup file is the only safety net).
          menuItem('download', t.backupVault || 'Backup vault (encrypted)', () => {
              if (!window.MaerminStorage || !window.MaerminStorage.exportEncryptedBackup) { addToast('Backup unavailable', 'error'); return; }
              window.MaerminStorage.exportEncryptedBackup().then((backup) => {
                const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `maermin-vault-backup-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                if (window.MaerminAuditLog) window.MaerminAuditLog.record('vault.backup.export', 'encrypted vault backup downloaded');
                addToast('Encrypted backup downloaded — keep it safe', 'success');
              }).catch((e) => addToast('Backup failed: ' + (e && e.message || 'error'), 'error'));
            }),
          // Restore from an encrypted backup file → reload → unlock with password.
          menuItem('upload', t.restoreVault || 'Restore vault backup', () => {
              const input = document.createElement('input');
              input.type = 'file'; input.accept = 'application/json,.json';
              input.onchange = () => {
                const file = input.files && input.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  let obj; try { obj = JSON.parse(reader.result); } catch { addToast('Invalid backup file', 'error'); return; }
                  askConfirm({ title: 'Restore this encrypted backup?', message: 'It replaces the current vault. You will need the backup\'s password to unlock.', confirmLabel: 'Replace vault', danger: true }).then((yes) => {
                    if (!yes) return;
                    window.MaerminStorage.importEncryptedBackup(obj)
                      .then(() => { if (window.MaerminAuditLog) window.MaerminAuditLog.record('vault.backup.restore', 'encrypted vault backup restored'); addToast('Backup restored — reloading…', 'success'); setTimeout(() => window.location.reload(), 800); })
                      .catch((e) => addToast('Restore failed: ' + (e && e.message || 'error'), 'error'));
                  });
                };
                reader.readAsText(file);
              };
              input.click();
            }),
          menuItem('log', t.securityLog || 'Security log', () => { setShowSettings(false); setShowAuditLog(true); }),
          React.createElement('div', { className: 'mx-divider' }),
          menuItem('logout', t.logout || 'Logout', () => { if (window.MaerminAuth) window.MaerminAuth.logout(); }, true)
        ),

        // User avatar — opens the account/settings menu
        React.createElement('button', {
          type: 'button',
          className: 'mx-avatar',
          onClick: () => setShowSettings(s => !s),
          title: t.settings || 'Account', 'aria-label': 'Account',
          'aria-expanded': showSettings, 'aria-controls': 'mx-settings-panel'
        }, 'MA')
      )
    ),

    // Main layout
    React.createElement('div', { className: 'mx-body' },
      // Sidebar
      React.createElement('nav', { className: 'maermin-sidebar', 'aria-label': 'Main' },
        (() => {
          const portfolioItems = [
            { id: 'overview',     label: t.navOverview || 'Overview' },
            { id: 'transactions', label: t.navTransactions || 'Transactions' },
            { id: 'portfolios',   label: t.navPortfolios || 'Portfolios' },
            { id: 'net-worth',    label: t.navNetWorth || 'Net Worth' },
            { id: 'dividends',    label: t.navDividends || 'Dividends' },
            { id: 'journal',      label: t.navJournal || 'Journal' },
          ];
          const hubs = [
            { id: 'hub-analytics', label: 'Analytics', children: [
              { id: 'returns',             label: t.navReturns || 'Returns & XIRR' },
              { id: 'performance',         label: t.navPerformance || 'Performance' },
              { id: 'rebalancing',         label: t.navRebalancing || 'Rebalancing' },
              { id: 'savings-plans',       label: t.navSavingsPlans || 'Savings Plans' },
              { id: 'cashflow',            label: t.navCashflow || 'Cash Flow' },
              { id: 'fees',                label: t.navFees || 'Fee Analyzer' },
              { id: 'analytics',           label: t.navRiskCorrelation || 'Risk & Correlation' },
              { id: 'health',              label: t.navHealthScore || 'Health Score' },
              { id: 'investment-analysis', label: t.navStrategy || 'Strategy' },
              { id: 'tax',                 label: t.navTaxFifo || 'Tax & FIFO' },
            ]},
            { id: 'hub-tools', label: 'Discover & Tools', children: [
              { id: 'intelligence', label: t.intelTitle || 'Portfolio Intelligence' },
              { id: 'tags',        label: t.navTags || 'Tags' },
              { id: 'categories',  label: t.navCategories || 'Categories' },
              { id: 'customize',   label: t.navCustomize || 'Customize Overview' },
              { id: 'discovery',   label: t.navDiscovery || 'Discovery' },
              { id: 'share',       label: t.navShare || 'Share & Compare' },
              { id: 'watchlist',   label: t.navWatchlist || 'Watchlist' },
              { id: 'rules',       label: t.navRules || 'Alerts & Rules' },
              { id: 'attribution', label: t.navAttribution || 'Attribution' },
              { id: 'news',        label: t.navNewsFeed || 'News Feed' },
              { id: 'data',        label: t.navImportExport || 'Import / Export' },
            ]},
          ];

          const isLeafActive = (id) => activeView === id ||
            (id === 'analytics' && ['correlation', 'montecarlo', 'stress', 'risk'].includes(activeView));

          const sectionLabel = (text) => React.createElement('div', { key: 'sec-' + text, className: 'mx-nav-section' }, text);

          const navButton = (item, child) => {
            const active = isLeafActive(item.id);
            return React.createElement('button', {
              key: item.id,
              type: 'button',
              className: 'mx-nav' + (child ? ' is-child' : '') + (active ? ' is-active' : ''),
              'aria-current': active ? 'page' : undefined,
              'data-view': item.id,
              onClick: () => setActiveView(item.id)
            },
              Icon(item.id, { size: child ? 15 : 17 }),
              React.createElement('span', { className: 'mx-nav-label' }, item.label)
            );
          };

          const hubButton = (hub) => {
            const childActive = hub.children.some(c => isLeafActive(c.id));
            const expanded = openHub === hub.id || childActive;
            return React.createElement('div', { key: hub.id },
              React.createElement('button', {
                type: 'button',
                className: 'mx-nav' + (childActive ? ' has-active' : ''),
                'aria-expanded': expanded,
                'data-hub': hub.id,
                style: childActive ? { color: 'var(--text)' } : undefined,
                onClick: () => setOpenHub(prev => prev === hub.id ? '' : hub.id)
              },
                Icon(hub.id, { size: 17 }),
                React.createElement('span', { className: 'mx-nav-label' }, hub.label),
                React.createElement('span', { className: 'mx-count' }, String(hub.children.length)),
                React.createElement('span', { className: 'mx-chev' + (expanded ? ' is-open' : '') }, Icon('chevron', { size: 14 }))
              ),
              expanded && React.createElement('div', { className: 'mx-hub-children' }, hub.children.map(c => navButton(c, true)))
            );
          };

          const quickAccess = React.createElement('div', { key: 'quick-access', className: 'mx-promo' },
            React.createElement('div', { className: 'mx-promo-title' }, Icon('sparkle', { size: 15 }), 'Quick access'),
            React.createElement('div', { className: 'mx-promo-text' }, 'Jump to any module, holding or action instantly.'),
            React.createElement('button', { type: 'button', onClick: () => window.MaerminUI.openOverlay('commandPalette') },
              React.createElement('span', null, 'Open palette'),
              React.createElement('kbd', { className: 'mx-kbd' }, '⌘K')
            )
          );

          return [
            sectionLabel(t.navGroupPortfolio || 'Portfolio'),
            ...portfolioItems.map(it => navButton(it, false)),
            sectionLabel('Insights'),
            ...hubs.map(hubButton),
            React.createElement('div', { key: 'spacer', style: { flex: 1, minHeight: '1rem' } }),
            quickAccess
          ];
        })()
      ),

      // Main content
      React.createElement('main', { className: 'maermin-main', id: 'main', tabIndex: -1 }, React.createElement(ViewErrorBoundary, { viewKey: activeView, theme: currentTheme }, renderView()))
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
let __maerminHooksBound = false;
function __maerminBindLifecycle() {
  if (__maerminHooksBound) return;
  __maerminHooksBound = true;
  try { if (window.MaerminVault && window.MaerminVault.onLock) window.MaerminVault.onLock(__maerminUnmount); } catch (e) {}
  try { if (window.MaerminAuth && window.MaerminAuth.onUnlock) window.MaerminAuth.onUnlock(() => { if (!__maerminMounted) __maerminRender(); }); } catch (e) {}
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
  // Bring saved data up to the current schema BEFORE the app reads it (runs
  // post-unlock, so encrypted data is already hydrated and readable).
  try { if (window.MaerminMigrations) window.MaerminMigrations.run(); } catch (e) { console.error('[migrations]', e); }
  __maerminBindLifecycle();
  __maerminRender();
  dbg('[MAERMIN v10.0] Application initialized');
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

