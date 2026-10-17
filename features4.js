// ============================================================================
// MAERMIN v12.0 — Portfolio Management Features
// 1. Multi-Portfolio Manager   — mehrere Depots / Portfolios
// 2. Savings Plan Tracker      — Sparplan-Tracking mit Statistiken
// 3. Dividend Forecast         — 12-Monats-Prognose basierend auf Vergangenheit
// 4. FIFO Cost Basis           — korrekte Steuer-Kostenbasis per FIFO
// ============================================================================
(function () {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED
// ─────────────────────────────────────────────────────────────────────────────
function Card({ theme, children, style = {} }) {
  return React.createElement('div', {
    style: {
      background: theme.card,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px',
      padding: '1.35rem',
      boxShadow: theme.shadow,
      ...style
    }
  }, children);
}

function StatCell({ label, value, sub, color, theme }) {
  return React.createElement('div', {
    style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '14px', padding: '1.1rem 1.25rem', boxShadow: theme.shadow }
  },
    React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem' } }, label),
    React.createElement('div', { style: { color: ((window.MaerminUtils && window.MaerminUtils.ink) ? window.MaerminUtils.ink(color) : color) || theme.text, fontSize: 'var(--text-xl)', fontWeight: '800', letterSpacing: '-0.02em', lineHeight: 1 } }, value),
    sub && React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', marginTop: '0.25rem' } }, sub)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. MULTI-PORTFOLIO MANAGER
// Portfolios sind Labels auf Transaktionen (portfolioId field)
// Kein Datenmigrations-Problem — alle alten Transaktionen gehören zu "default"
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PORTFOLIO = { id: 'default', name: 'Main Portfolio', color: '#8b7cff', icon: '◆' };

// Dividend frequency ids → label.
function freqLabel(f) {
  return ({ weekly: __('freqWeekly', 'Weekly'), biweekly: __('freqBiweekly', 'Bi-weekly'), monthly: __('freqMonthly', 'Monthly'), quarterly: __('freqQuarterly', 'Quarterly'), 'semi-annual': __('freqSemiAnnual', 'Semi-annual'), annual: __('freqAnnual', 'Annual') })[f] || f;
}

function usePortfolios() {
  const [portfolios, setPortfolios] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('maermin_portfolios') || '[]');
      return saved.length > 0 ? saved : [DEFAULT_PORTFOLIO];
    } catch { return [DEFAULT_PORTFOLIO]; }
  });

  const [activePortfolioId, setActivePortfolioId] = useState(() =>
    localStorage.getItem('maermin_active_portfolio') || 'default'
  );

  useEffect(() => { localStorage.setItem('maermin_portfolios', JSON.stringify(portfolios)); }, [portfolios]);
  useEffect(() => { localStorage.setItem('maermin_active_portfolio', activePortfolioId); }, [activePortfolioId]);

  const addPortfolio = (name, color = '#3b82f6') => {
    const id = 'portfolio_' + Date.now();
    const newP = { id, name, color, icon: '◆' };
    setPortfolios(prev => [...prev, newP]);
    return id;
  };

  const removePortfolio = (id) => {
    if (id === 'default') return; // Can't delete the default
    setPortfolios(prev => prev.filter(p => p.id !== id));
    if (activePortfolioId === id) setActivePortfolioId('default');
  };

  // Trash restore (P2-4): put a deleted portfolio back, never twice.
  const restorePortfolio = useCallback((pf) => {
    setPortfolios(prev => prev.some(p => p.id === pf.id) ? prev : [...prev, pf]);
  }, []);

  const renamePortfolio = (id, name) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  };

  // P5-1.4: optional clearing account { enabled, openingBalance, openingDate }.
  const setClearing = (id, patch) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, clearing: { enabled: false, openingBalance: 0, openingDate: '', ...(p.clearing || {}), ...patch } } : p));
  };

  // FINDINGS M-15: optional `separateDepot` - the German tax report keeps this
  // portfolio's shares and funds in their own FIFO pool. Unset = pooled.
  const setSeparateDepot = (id, on) => {
    setPortfolios(prev => prev.map(p => {
      if (p.id !== id) return p;
      const next = { ...p };
      if (on) next.separateDepot = true; else delete next.separateDepot;
      return next;
    }));
  };

  return { portfolios, activePortfolioId, setActivePortfolioId, addPortfolio, removePortfolio, restorePortfolio, renamePortfolio, setClearing, setSeparateDepot };
}

function PortfolioManagerView({ portfolios, activePortfolioId, transactions, prices, exchangeRate, fxAt, corpActionsRev, theme, t, formatPrice, getCurrencySymbol,
  setActivePortfolioId, addPortfolio, removePortfolio, renamePortfolio, setClearing, clearing, setSeparateDepot }) {

  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [editId, setEditId]     = useState(null);
  const [editName, setEditName] = useState('');

  const COLORS = ['#8b7cff','#3b82f6','#22c55e','#f59e0b','#ef4444','#06b6d4','#f97316','#ec4899'];

  // Value per portfolio — from the shared positions engine (MaerminMetrics), the
  // same numbers the Overview shows for that portfolio. The former local loop
  // subtracted the quantity of EVERY non-buy (so one booked dividend removed
  // the whole position), ignored FX and never reduced "invested" on a sale.
  const portfolioStats = useMemo(() => {
    const totals = window.MaerminMetrics.computePortfolioTotals(portfolios, transactions, prices, { exchangeRate, fxAt });
    const byId = {};
    totals.forEach(t => { byId[t.id] = t; });
    return portfolios.map(p => ({ ...p, ...(byId[p.id] || { value: 0, invested: 0, txCount: 0, pnl: 0, pnlPct: 0 }) }));
  }, [portfolios, transactions, prices, exchangeRate, fxAt, corpActionsRev]);

  // P5-1.4: the clearing account of a card. The balance follows from the
  // bookings (MaerminLedger.clearingBalance); the user sets only the switch and
  // an optional opening balance.
  const renderClearing = (p) => {
    const cfg = p.clearing || {};
    const c = clearing && clearing[p.id];
    const small = { color: theme.textSecondary, fontSize: '0.75rem', lineHeight: 1.5 };
    const field = { padding: '0.35rem 0.5rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' };
    return React.createElement('div', { 'data-pf-clearing': p.id, style: { marginTop: '0.85rem', paddingTop: '0.75rem', borderTop: `1px solid ${theme.cardBorder}` } },
      React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.text, fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', minHeight: '24px' } },
        React.createElement('input', { type: 'checkbox', checked: !!cfg.enabled, 'data-pf-clearing-toggle': p.id, onChange: (e) => setClearing(p.id, { enabled: e.target.checked }), style: { width: '20px', height: '20px', margin: 0, accentColor: theme.accent } }),
        __('pfClearing', 'Clearing account')),
      cfg.enabled && c && React.createElement('div', { 'data-pf-cash': p.id, style: { color: c.balanceEUR < 0 ? theme.danger : theme.text, fontSize: 'var(--text-body)', fontWeight: 700, margin: '0.4rem 0 0.2rem' } },
        __('pfCashBalance', 'Cash: {amount}', { amount: `${formatPrice(c.balanceEUR)} ${getCurrencySymbol()}` })),
      cfg.enabled && React.createElement('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.4rem' } },
        React.createElement('input', { key: 'ob:' + (cfg.openingBalance || 0), type: 'text', inputMode: 'decimal', 'aria-label': __('pfOpeningBalance', 'Opening balance (EUR)'), placeholder: __('pfOpeningBalance', 'Opening balance (EUR)'),
          defaultValue: cfg.openingBalance ? window.MaerminI18n.num(cfg.openingBalance, { min: 0, max: 2 }) : '', style: { ...field, width: '9.5rem' },
          onBlur: (e) => { const v = window.MaerminUtils.parseDecimal(e.target.value); setClearing(p.id, { openingBalance: isFinite(v) ? v : 0 }); },
          onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); } }),
        React.createElement('input', { type: 'date', 'aria-label': __('pfOpeningDate', 'Date of the opening balance'), value: cfg.openingDate || '', style: field,
          onChange: (e) => setClearing(p.id, { openingDate: e.target.value }) })),
      cfg.enabled && React.createElement('p', { style: { ...small, margin: '0.45rem 0 0' } },
        __('pfClearingHint', 'Book deposits and withdrawals to this portfolio; trades, dividends, fees and taxes move the balance. Returns then count the cash too. If you also keep this cash as an account under Net Worth, remove it there so it is not counted twice.'))
    );
  };

  // FINDINGS M-15: the depot switch of a card (§ 20 Abs. 4 S. 7 EStG).
  const renderDepot = (p) => React.createElement('div', { 'data-pf-depot': p.id, style: { marginTop: '0.6rem' } },
    React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', color: theme.text, fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', minHeight: '24px' } },
      React.createElement('input', { type: 'checkbox', checked: p.separateDepot === true, 'data-pf-depot-toggle': p.id, onChange: (e) => setSeparateDepot(p.id, e.target.checked), style: { width: '20px', height: '20px', margin: 0, accentColor: theme.accent } }),
      __('pfSeparateDepot', 'Separate depot for German tax')),
    p.separateDepot === true && React.createElement('p', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', lineHeight: 1.5, margin: '0.35rem 0 0' } },
      __('pfSeparateDepotHint', 'A sale of shares or funds here uses only the lots bought in this portfolio (FIFO per depot). Portfolios without the switch count as one depot. Crypto follows its own setting in the tax settings.')));

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: 'var(--text-xl)', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1.5rem' } }, __('pfManager', 'Portfolio Manager')),

    // Portfolio Cards
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      // "All portfolios": the read-only combined view (MaerminMetrics.ALL_PORTFOLIOS).
      // Its figures are the sum of the cards below; it holds no transactions.
      portfolioStats.length > 1 && (() => {
        const ALL = window.MaerminMetrics.ALL_PORTFOLIOS, on = activePortfolioId === ALL;
        const value = portfolioStats.reduce((s, p) => s + (p.value || 0), 0), invested = portfolioStats.reduce((s, p) => s + (p.invested || 0), 0);
        return React.createElement('div', { key: ALL, 'data-pf-card': ALL,
          onClick: (e) => { if (e.target.tagName !== 'BUTTON') setActivePortfolioId(ALL); },
          style: { background: theme.card, border: `2px ${on ? 'solid ' + theme.accent : 'dashed ' + theme.cardBorder}`, borderRadius: '12px', padding: '1.25rem', cursor: 'pointer' } },
          React.createElement('button', { type: 'button', 'data-pf-switch': ALL, onClick: () => setActivePortfolioId(ALL), 'aria-pressed': on,
            style: { background: 'none', border: 'none', padding: '0.15rem 0', minHeight: '24px', cursor: 'pointer', color: theme.text, fontWeight: '700', fontSize: 'var(--text-md)' } },
            '◈ ' + __('allPortfolios', 'All Portfolios')),
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', margin: '0.35rem 0 0.75rem' } },
            __('pfAllHint', 'Read-only: all {n} portfolios combined. New bookings go into a portfolio.', { n: portfolioStats.length })),
          React.createElement('div', { style: { color: theme.text, fontSize: 'var(--text-lg)', fontWeight: '800' } }, formatPrice(value)),
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)' } }, `${__('invested', 'Invested')}: ${formatPrice(invested)}`));
      })(),
      portfolioStats.map(p =>
        // P5-1.2: the card is a plain container (it was a role="button" holding
        // the rename input and the action buttons). The portfolio name is the
        // switch button; a click elsewhere on the card still switches (mouse
        // convenience; keyboard and screen readers use the button).
        React.createElement('div', {
          key: p.id,
          'data-pf-card': p.id,
          onClick: (e) => { if (!/^(BUTTON|INPUT|SUMMARY|LABEL|SELECT)$/.test(e.target.tagName) && !e.target.closest('[data-pf-clearing]')) setActivePortfolioId(p.id); },
          style: {
            background: theme.card, border: `2px solid ${activePortfolioId === p.id ? p.color : theme.cardBorder}`,
            borderRadius: '12px', padding: '1.25rem', cursor: 'pointer', transition: 'all 0.15s'
          }
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.75rem' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0 } },
              React.createElement('div', { style: { width: 12, height: 12, borderRadius: '50%', background: p.color, flexShrink: 0 } }),
              editId === p.id
                ? React.createElement('input', {
                    value: editName, onChange: e => setEditName(e.target.value),
                    onBlur: () => { renamePortfolio(p.id, editName); setEditId(null); },
                    onKeyDown: e => e.key === 'Enter' && (renamePortfolio(p.id, editName), setEditId(null)),
                    autoFocus: true,
                    'aria-label': (t && t.pfNameLabel) || 'Portfolio name',
                    style: { background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, padding: '0.25rem 0.5rem', fontSize: 'var(--text-base)', fontWeight: '700', width: '140px' },
                    onClick: e => e.stopPropagation()
                  })
                : React.createElement('button', {
                    type: 'button', 'data-pf-switch': p.id,
                    onClick: () => setActivePortfolioId(p.id),
                    'aria-label': __('pfSwitchTo', 'Switch to portfolio {name}', { name: p.name || p.id }),
                    'aria-pressed': activePortfolioId === p.id,
                    style: { background: 'none', border: 'none', padding: '0.15rem 0', minHeight: '24px', cursor: 'pointer', textAlign: 'left',
                      color: theme.text, fontWeight: '700', fontSize: 'var(--text-md)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                  }, p.name)
            ),
            React.createElement('div', { style: { display: 'flex', gap: '0.375rem', flexShrink: 0 } },
              React.createElement('button', {
                type: 'button',
                onClick: e => { e.stopPropagation(); setEditId(p.id); setEditName(p.name); },
                'aria-label': ((t && t.pfRenameAria) || 'Rename portfolio {name}').replace('{name}', p.name),
                title: (t && t.pfRename) || 'Rename',
                style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: 'var(--text-sm)', padding: '0.25rem', minWidth: '24px', minHeight: '24px' }
              }, '✎'),
              p.id !== 'default' && React.createElement('button', {
                type: 'button',
                onClick: e => {
                  e.stopPropagation();
                  const tt = t || {};
                  const main = (portfolios.find(x => x.id === 'default') || DEFAULT_PORTFOLIO).name;
                  const msg = (tt.pfDeleteMessage || '{n} transaction(s) and the savings plans of this portfolio move to "{main}". Nothing is deleted.')
                    .replace('{n}', String(p.txCount)).replace('{main}', main);
                  window.MaerminUI.confirm({
                    title: (tt.pfDeleteTitle || 'Delete portfolio "{name}"?').replace('{name}', p.name),
                    message: msg,
                    confirmLabel: tt.pfDeleteConfirm || 'Delete portfolio',
                    cancelLabel: tt.cancel || 'Cancel',
                    danger: true
                  }).then(yes => { if (yes) removePortfolio(p.id); });
                },
                'aria-label': ((t && t.pfDeleteAria) || 'Delete portfolio {name}').replace('{name}', p.name),
                style: { background: 'none', border: 'none', color: theme.danger || 'var(--danger)', cursor: 'pointer', fontSize: 'var(--text-sm)', padding: '0.25rem', minWidth: '24px', minHeight: '24px' }
              }, '×')
            )
          ),
          React.createElement('div', { style: { color: theme.text, fontSize: 'var(--text-xl)', fontWeight: '800', marginBottom: '0.25rem' } },
            `${formatPrice(p.value)} ${getCurrencySymbol()}`
          ),
          React.createElement('div', { style: { display: 'flex', gap: '1rem', fontSize: 'var(--text-xs)' } },
            React.createElement('span', { style: { color: p.pnl >= 0 ? theme.success : theme.danger, fontWeight: '600' } },
              `${p.pnl >= 0 ? '+' : ''}${formatPrice(p.pnl)} (${window.MaerminI18n.pct(p.pnlPct, 1)})`
            ),
            React.createElement('span', { style: { color: theme.textSecondary } }, __('pfTxCount', '{n} {n:transaction|transactions}', { n: p.txCount }))
          ),
          // P5-1.4: optional clearing account (Verrechnungskonto)
          setClearing && renderClearing(p),
          setSeparateDepot && renderDepot(p)
        )
      )
    ),

    // Add new portfolio
    React.createElement(Card, { theme, style: { marginBottom: 0 } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.875rem', fontSize: 'var(--text-base)' } }, __('pfAdd', 'Add Portfolio')),
      React.createElement('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
        React.createElement('input', {
          value: newName, onChange: e => setNewName(e.target.value),
          placeholder: __('pfNewPh', 'e.g. Trade Republic, CS2, Savings'), 'aria-label': __('pfNewAria', 'New portfolio name'),
          style: { flex: 1, minWidth: '180px', padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: 'var(--text-base)' }
        }),
        // Color picker
        React.createElement('div', { style: { display: 'flex', gap: '0.375rem' } },
          COLORS.map((c, i) => React.createElement('button', {
            key: c, type: 'button', onClick: () => setNewColor(c),
            'aria-label': __('pfColorN', 'Colour {n}', { n: i + 1 }), 'aria-pressed': newColor === c,
            style: { width: 24, height: 24, borderRadius: '50%', background: c, border: newColor === c ? '2px solid white' : '2px solid transparent', cursor: 'pointer', boxShadow: newColor === c ? '0 0 0 2px ' + c : 'none' }
          }))
        ),
        React.createElement('button', {
          onClick: () => { if (newName.trim()) { addPortfolio(newName.trim(), newColor); setNewName(''); } },
          disabled: !newName.trim(),
          style: { padding: '0.625rem 1.25rem', background: newName.trim() ? (theme.accentFill || theme.accent) : theme.inputBg, color: newName.trim() ? 'var(--on-accent)' : theme.textSecondary, border: 'none', borderRadius: '8px', cursor: newName.trim() ? 'pointer' : 'not-allowed', fontWeight: '700', fontSize: 'var(--text-base)' }
        }, __('addShort', '+ Add'))
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SAVINGS PLAN TRACKER (Sparplan)
// User defines recurring investment plans → MAERMIN tracks execution
// ─────────────────────────────────────────────────────────────────────────────
// Slim reusable modal: backdrop blur, close on button/Escape/backdrop click
// (Escape, backdrop and focus handling come from MaerminUI.Overlay).
// Scrolls internally, so content stays reachable regardless of page height -
// the reason the savings-plan form moved here from an inline card.
function PlanModal({ theme, title, onClose, children }) {
  return React.createElement(window.MaerminUI.Overlay, {
    onClose,
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000,
      background: 'rgba(4,6,10,0.62)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }
  },
    React.createElement('div', {
      ...window.MaerminUI.dialogProps('dlg-plan'),
      style: {
        background: theme.modalBg || theme.card, border: `1px solid ${theme.modalBorder || theme.cardBorder}`,
        borderRadius: '16px', padding: '1.5rem', width: '560px', maxWidth: '92vw',
        maxHeight: '85vh', overflow: 'auto', boxShadow: '0 32px 70px -20px rgba(0,0,0,0.6)'
      }
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.1rem' } },
        React.createElement('div', { id: 'dlg-plan', style: { color: theme.text, fontWeight: '800', fontSize: 'var(--text-lg)' } }, title),
        React.createElement('button', {
          onClick: onClose, 'aria-label': __('close', 'Close'),
          style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: 'var(--text-title)', lineHeight: 1 }
        }, 'x')
      ),
      children
    )
  );
}

function SavingsPlanView({ transactions, theme, formatPrice, getCurrencySymbol, t, startValue, dividendYield, portfolios = [{ id: 'default', name: 'Main Portfolio' }], activePortfolioId = 'default' }) {
  const [plans, setPlans] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_savings_plans') || '[]'); } catch { return []; }
  });
  // editPlan: null = closed, 'new' = create, otherwise the plan being edited.
  // The form lives in a MODAL now - the projection graph above made the old
  // inline card scroll out of view.
  const [editPlan, setEditPlan] = useState(null);
  const emptyForm = () => ({ symbol: '', amount: '', amountCurrency: 'EUR', frequency: 'monthly', category: 'crypto', startDate: window.MaerminUtils.todayISO(), endDate: '', noEnd: true, portfolioId: activePortfolioId || 'default' });
  const [form, setForm] = useState(emptyForm);

  useEffect(() => { localStorage.setItem('maermin_savings_plans', JSON.stringify(plans)); }, [plans]);
  // A restore from the trash (or a portfolio restore) wrote the key: reload it.
  if (window.MaerminTrash) window.MaerminTrash.useReload('maermin_savings_plans', () => {
    try { setPlans(JSON.parse(localStorage.getItem('maermin_savings_plans') || '[]')); } catch (e) { /* keep */ }
  });

  // The form as it was opened: Escape, a click beside the dialog or Cancel
  // ask before a changed form is thrown away (FINDINGS L-5).
  const formInitialRef = useRef(null);
  const openAdd = () => { const f = emptyForm(); formInitialRef.current = f; setForm(f); setEditPlan('new'); };
  const requestClose = () => {
    const U = window.MaerminUtils;
    const changed = formInitialRef.current && U.formChanged(formInitialRef.current, form);
    if (!changed) { setEditPlan(null); return; }
    U.confirmThen({
      title: (t && t.discardPlanTitle) || 'Discard this savings plan?',
      message: (t && t.discardTxMessage) || 'What you entered in this form will be lost.',
      confirmLabel: (t && t.discard) || 'Discard',
      cancelLabel: (t && t.keepEditing) || 'Keep editing'
    }, () => setEditPlan(null));
  };
  const openEdit = (plan) => {
    formInitialRef.current = {
      symbol: plan.symbol || '', amount: String(plan.amount || ''), frequency: plan.frequency || 'monthly',
      category: plan.category || 'crypto', startDate: plan.startDate || window.MaerminUtils.todayISO(),
      endDate: plan.endDate || '', noEnd: !plan.endDate,
      portfolioId: plan.portfolioId || activePortfolioId || 'default',
      amountCurrency: plan.amountCurrency || 'EUR'
    };
    setForm(formInitialRef.current);
    setEditPlan(plan);
  };

  const savePlan = () => {
    if (!form.symbol || !form.amount) return;
    const endDate = form.noEnd ? null : (form.endDate || null);
    if (endDate && endDate < form.startDate) return; // end before start makes no schedule
    const fields = {
      symbol: form.symbol.trim(), amount: parseFloat(form.amount), frequency: form.frequency,
      category: form.category, startDate: form.startDate, endDate,
      portfolioId: form.portfolioId || 'default',
      amountCurrency: form.amountCurrency === 'USD' ? 'USD' : 'EUR'
    };
    if (editPlan === 'new') {
      setPlans(prev => [...prev, { id: Date.now().toString(), ...fields, active: true, createdAt: new Date().toISOString() }]);
    } else {
      setPlans(prev => prev.map(p => p.id === editPlan.id ? { ...p, ...fields } : p));
    }
    setEditPlan(null);
  };

  // For each plan: expected executions (CALENDAR-exact via the executor, which
  // reuses MaerminRecurring - the old 30.44-days-per-month approximation is
  // gone), actual executions, adherence, status (active/completed/paused).
  const planStats = useMemo(() => {
    const EX = window.MaerminSavingsExecutor;
    return plans.map(plan => {
      const start = new Date(plan.startDate);
      const symL  = (plan.symbol || '').toLowerCase();
      const occurrences = EX ? EX.occurrences(plan) : [];
      const expected = occurrences.length;
      const status = EX ? EX.planStatus(plan) : 'active';

      // Count actual buy transactions for this symbol since start (manual or
      // auto-booked; the end date caps the window for completed plans).
      const actual = transactions.filter(tx =>
        tx.type === 'buy' &&
        (tx.symbol || '').toLowerCase() === symL &&
        new Date(tx.date) >= start &&
        (!plan.endDate || tx.date <= plan.endDate)
      );
      const autoCount = actual.filter(tx => tx.source === 'savings-plan' && tx.planId === plan.id).length;

      const actualCount   = actual.length;
      const totalInvested = actual.reduce((s, tx) => s + (parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0), 0);
      const adherence     = expected > 0 ? Math.min(100, Math.round(actualCount / expected * 100)) : 100;

      // Next due date from the calendar schedule (null once completed).
      let nextDate = null;
      if (status === 'active' && EX) {
        const horizon = EX.occurrences({ ...plan, endDate: plan.endDate }, window.MaerminUtils.todayISO(new Date(Date.now() + 400 * 86400000)));
        const todayIso = window.MaerminUtils.todayISO();
        const next = horizon.find(o => o.date > todayIso);
        if (next) nextDate = new Date(next.date);
      }

      return { ...plan, expected, actualCount, autoCount, totalInvested, adherence, nextDate, status };
    });
  }, [plans, transactions]);

  const FREQ_LABELS = { weekly: __('freqWeekly', 'Weekly'), biweekly: __('freqBiweekly', 'Bi-weekly'), monthly: __('freqMonthly', 'Monthly'), quarterly: __('freqQuarterly', 'Quarterly') };

  const inp = (field, props = {}) => React.createElement('input', {
    value: form[field], onChange: e => setForm(p => ({ ...p, [field]: e.target.value })),
    style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: 'var(--text-base)', width: '100%' },
    ...props
  });

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: 'var(--text-xl)', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.25rem' } }, __('spTitle', 'Savings Plans')),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: 'var(--text-base)' } }, __('spSubtitle', 'Track your recurring investment plans and execution rate'))
      ),
      React.createElement('button', {
        onClick: openAdd,
        style: { padding: '0.625rem 1.25rem', background: (theme.accentFill || theme.accent), color: 'var(--on-accent)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: 'var(--text-base)' }
      }, __('spAddPlan', '+ Add Plan'))
    ),

    // UX-021: no plans yet - say so first, with the Add button.
    plans.length === 0 && React.createElement(Card, { theme, style: { textAlign: 'center', padding: '2.5rem', marginBottom: '1.5rem' } },
      React.createElement('div', { style: { color: theme.textSecondary, marginBottom: '0.5rem', fontSize: 'var(--text-xl)' } }, '◎'),
      React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.25rem' } }, __('spEmpty', 'No savings plans yet')),
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-base)', marginBottom: '1rem' } }, __('spEmptyHint', 'Add a recurring investment plan to track your execution rate')),
      React.createElement('button', { onClick: openAdd, style: { padding: '0.625rem 1.25rem', background: (theme.accentFill || theme.accent), color: 'var(--on-accent)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: 'var(--text-base)' } }, __('spAddPlan', '+ Add Plan'))),

    // Whole-portfolio projection (#6): composes current value + these savings
    // plans + dividends + recurring liabilities across 3 scenarios.
    window.MaerminProjection && React.createElement(window.MaerminProjection.Panel, {
      startValue: startValue || 0,
      savingsPlans: plans,
      dividendYield: dividendYield || 0,
      theme, formatPrice, getCurrencySymbol, t,
      scopeLabel: __('portfolio', 'Portfolio')
    }),

    // Add/Edit Plan MODAL (independent of the projection graph's height).
    editPlan && React.createElement(PlanModal, { theme, onClose: requestClose, title: editPlan === 'new' ? __('spNewPlan', 'New Savings Plan') : __('spEditPlan', 'Edit {name}', { name: form.symbol || __('spPlan', 'Plan') }) },
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '0.875rem' } },
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: 'var(--text-xs)', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('symbol', 'Symbol')),
          inp('symbol', { placeholder: __('spSymbolPh', 'BTC, ETH, AAPL...') })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: 'var(--text-xs)', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('spAmountPer', 'Amount per execution')),
          React.createElement('div', { style: { display: 'flex', gap: '0.4rem' } },
            React.createElement('input', {
              value: form.amount, onChange: e => setForm(p => ({ ...p, amount: e.target.value })),
              type: 'number', placeholder: '100',
              style: { flex: 1, minWidth: 0, padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: 'var(--text-base)' }
            }),
            React.createElement('select', {
              value: form.amountCurrency, onChange: e => setForm(p => ({ ...p, amountCurrency: e.target.value })),
              'aria-label': __('spAmountCurrency', 'Amount currency'),
              style: { padding: '0.625rem 0.4rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: 'var(--text-base)', cursor: 'pointer' }
            },
              React.createElement('option', { value: 'EUR' }, '€ EUR'),
              React.createElement('option', { value: 'USD' }, '$ USD')
            )
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: 'var(--text-xs)', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('spFrequency', 'Frequency')),
          React.createElement('select', {
            value: form.frequency, onChange: e => setForm(p => ({ ...p, frequency: e.target.value })),
            style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: 'var(--text-base)', width: '100%' }
          },
            Object.entries(FREQ_LABELS).map(([v, l]) => React.createElement('option', { key: v, value: v }, l))
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: 'var(--text-xs)', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('category', 'Category')),
          React.createElement('select', {
            value: form.category, onChange: e => setForm(p => ({ ...p, category: e.target.value })),
            style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: 'var(--text-base)', width: '100%' }
          },
            ['crypto', 'stocks', 'commodities'].map(c => React.createElement('option', { key: c, value: c }, c))
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: 'var(--text-xs)', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('portfolio', 'Portfolio')),
          React.createElement('select', {
            value: form.portfolioId, onChange: e => setForm(p => ({ ...p, portfolioId: e.target.value })),
            style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: 'var(--text-base)', width: '100%' }
          },
            portfolios.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name))
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: 'var(--text-xs)', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('spStartDate', 'Start Date')),
          inp('startDate', { type: 'date' })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: 'var(--text-xs)', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('spEndDate', 'End Date')),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', color: theme.textSecondary, fontSize: 'var(--text-sm)', marginBottom: '0.35rem', cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: form.noEnd, onChange: e => setForm(p => ({ ...p, noEnd: e.target.checked })) }),
            __('spNoEnd', 'No fixed end date')
          ),
          !form.noEnd && inp('endDate', { type: 'date', min: form.startDate })
        )
      ),
      !form.noEnd && form.endDate && form.endDate < form.startDate &&
        React.createElement('div', { style: { color: 'var(--danger)', fontSize: 'var(--text-xs)', marginBottom: '0.6rem' } }, __('spEndBeforeStart', 'End date must not be before the start date.')),
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', marginBottom: '0.875rem', lineHeight: 1.5 } },
        __('spAutoHint', 'Due executions are booked automatically as real buy transactions when the app opens (marked, deletable). If no price is available for a due date, the execution stays pending instead of guessing a quantity.')),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
        React.createElement('button', { onClick: savePlan, style: { padding: '0.625rem 1.25rem', background: (theme.accentFill || theme.accent), color: 'var(--on-accent)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: 'var(--text-base)' } }, editPlan === 'new' ? __('spAddPlanBtn', 'Add Plan') : __('save', 'Save')),
        React.createElement('button', { onClick: requestClose, style: { padding: '0.625rem 1.25rem', background: theme.inputBg, color: theme.text, border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: 'var(--text-base)' } }, __('cancel', 'Cancel'))
      )
    ),

    // Plans list
    plans.length === 0
      ? null
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1rem' } },
          planStats.map(plan =>
            React.createElement(Card, { key: plan.id, theme },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' } },
                // Left: symbol + frequency
                React.createElement('div', null,
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem', flexWrap: 'wrap' } },
                    React.createElement('span', { style: { color: theme.text, fontWeight: '800', fontSize: 'var(--text-lg)' } }, plan.symbol),
                    React.createElement('span', { style: { fontSize: 'var(--text-2xs)', padding: '0.15rem 0.5rem', background: `${window.MaerminTokens.alpha(theme.accent, 0x22)}`, color: theme.accent, borderRadius: '4px', fontWeight: '600' } }, FREQ_LABELS[plan.frequency]),
                    React.createElement('span', { style: { fontSize: 'var(--text-2xs)', color: theme.textSecondary } }, __('spPerExecution', '{amount}/execution', { amount: window.MaerminI18n.money(plan.amount, plan.amountCurrency === 'USD' ? 'USD' : 'EUR', 0) })),
                    // Status: active / completed (end date passed) / paused.
                    React.createElement('span', {
                      style: {
                        fontSize: 'var(--text-2xs)', padding: '0.12rem 0.45rem', borderRadius: '4px', fontWeight: '700', textTransform: 'uppercase',
                        background: plan.status === 'active' ? 'color-mix(in srgb, var(--success) 15%, transparent)' : plan.status === 'completed' ? 'color-mix(in srgb, var(--text-dim) 18%, transparent)' : 'color-mix(in srgb, var(--warning) 18%, transparent)',
                        color: plan.status === 'active' ? theme.success : plan.status === 'completed' ? theme.textSecondary : theme.warning
                      }
                    }, ({ active: __('spStatusActive', 'active'), completed: __('spStatusCompleted', 'completed'), paused: __('spStatusPaused', 'paused') })[plan.status] || plan.status),
                    plan.autoCount > 0 && React.createElement('span', { style: { fontSize: 'var(--text-2xs)', color: theme.textSecondary } }, __('spAutoBooked', '{n} auto-booked', { n: plan.autoCount }))
                  ),
                  React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)' } },
                    __('spStarted', 'Started {date}', { date: window.MaerminI18n.date(plan.startDate, 'medium') }) +
                    (plan.endDate ? ' · ' + __('spEnds', 'Ends {date}', { date: window.MaerminI18n.date(plan.endDate, 'medium') }) : '') +
                    (plan.nextDate ? ' · ' + __('spNext', 'Next {date}', { date: window.MaerminI18n.date(plan.nextDate, 'medium') }) : ''))
                ),
                // Right: adherence ring
                React.createElement('div', { style: { textAlign: 'center' } },
                  React.createElement('div', {
                    style: {
                      width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
                      background: `conic-gradient(${plan.adherence >= 80 ? 'var(--success)' : plan.adherence >= 50 ? 'var(--warning)' : 'var(--danger)'} ${plan.adherence * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
                      position: 'relative'
                    }
                  },
                    React.createElement('div', { style: { position: 'absolute', inset: 4, borderRadius: '50%', background: theme.card, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' } },
                      React.createElement('span', { style: { color: theme.text, fontWeight: '800', fontSize: 'var(--text-sm)', lineHeight: 1 } }, window.MaerminI18n.pct(plan.adherence, 0)),
                      React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.55rem' } }, 'rate')
                    )
                  )
                )
              ),
              // Stats row
              React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem', marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${theme.cardBorder}` } },
                [
                  { label: __('spExecuted', 'Executed'), value: plan.actualCount },
                  { label: __('spExpected', 'Expected'), value: plan.expected },
                  { label: __('spMissed', 'Missed'), value: Math.max(0, plan.expected - plan.actualCount), color: Math.max(0, plan.expected - plan.actualCount) > 0 ? theme.danger : theme.success },
                  { label: __('totalInvested', 'Total Invested'), value: `${formatPrice(plan.totalInvested)} ${getCurrencySymbol()}` },
                ].map((s, i) =>
                  React.createElement('div', { key: i },
                    React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: '0.05em' } }, s.label),
                    React.createElement('div', { style: { color: s.color || theme.text, fontWeight: '700', fontSize: 'var(--text-body)', marginTop: '0.125rem' } }, s.value)
                  )
                )
              ),
              // Edit / pause / delete
              React.createElement('div', { style: { marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end', gap: '0.9rem' } },
                React.createElement('button', {
                  onClick: () => openEdit(plan),
                  style: { background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: '600' }
                }, __('edit', 'Edit')),
                plan.status !== 'completed' && React.createElement('button', {
                  onClick: () => setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, active: p.active === false } : p)),
                  style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: 'var(--text-xs)' }
                }, plan.active === false ? __('resume', 'Resume') : __('pause', 'Pause')),
                React.createElement('button', {
                  onClick: () => window.MaerminUtils.confirmThen({
                    title: ((t && t.spRemoveTitle) || 'Remove the savings plan {name}?').replace('{name}', plan.symbol || ''),
                    message: (t && t.spRemoveMessage) || 'Executions already booked stay in your transactions.',
                    confirmLabel: (t && t.spRemove) || 'Remove plan', cancelLabel: (t && t.cancel) || 'Cancel'
                  }, () => {
                    setPlans(prev => prev.filter(p => p.id !== plan.id));
                    if (window.MaerminTrash) window.MaerminTrash.trashed('savingsPlan', plan.symbol || plan.name || '', plan);
                  }),
                  style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: 'var(--text-xs)' }
                }, __('spRemove', 'Remove plan'))
              )
            )
          )
        )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DIVIDEND FORECAST — 12-Monats-Prognose
// Schaut auf historische Dividenden-Einträge und projiziert sie voraus
// ─────────────────────────────────────────────────────────────────────────────
function DividendForecastView({ transactions, portfolio, prices, metaVersion, theme, formatPrice, getCurrencySymbol, exchangeRate, fxAt, basis }) {
  // P5-2.5: 24 months by default; a month opens its payments
  const [forecastYears, setForecastYears] = React.useState(2);
  const [selMonth, setSelMonth] = React.useState(null);
  const DH = window.MaerminDividendHistory;

  const dividends = useMemo(() =>
    transactions.filter(tx => tx.type === 'dividend' || (tx.notes || '').toLowerCase().includes('dividend')),
  [transactions]);

  // Per-payer forward rate (dividend-forecast.js): the user's own payments of
  // the last twelve months, in EUR at their dates. Payers without such history
  // (none recorded, or only older ones) use the resolved per-share rate of the
  // DividendDataService × the shares held (AUDIT BUG-032).
  const forecasts = useMemo(() => {
    const FX = window.MaerminFxHistory, U = window.MaerminUtils;
    const toEUR = (tx) => {
      // P5-2.5: gross or net of withholding tax, like the switch says
      const amt = DH ? DH.amountOf(tx, basis) : (parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0);
      if (FX && FX.txToEUR) return FX.txToEUR(amt, tx.currency || 'EUR', tx.date, exchangeRate, fxAt).value;
      return U ? U.toEUR(amt, tx.currency || 'EUR', exchangeRate) : amt;
    };
    const DF = window.MaerminDividendForecast;
    const result = DF ? DF.forecastRates(dividends, { toEUR }).rates : [];
    const covered = Object.create(null); // keys are imported symbols (SEC-023)
    result.forEach(f => { covered[String(f.sym).toUpperCase()] = true; });
    if (window.DividendDataService && portfolio && portfolio.stocks) {
      const data = window.DividendDataService.getPortfolioDividendData(portfolio, prices || {});
      (portfolio.stocks || []).forEach(s => {
        const sym = (s.symbol || s.name || '').toUpperCase();
        if (covered[sym]) return;
        const shares = parseFloat(s.amount) || 0;
        const d = data[sym];
        if (!d || shares <= 0 || !(d.annualDividend > 0)) return;
        const cur = d.currency || 'USD';
        const annualRate = (U && cur !== 'EUR') ? U.toEUR(shares * d.annualDividend, cur, exchangeRate) : shares * d.annualDividend; // in EUR (BUG-038)
        const ppy = window.DividendDataService.getPaymentsPerYear(d.frequency);
        result.push({ sym: s.symbol || s.name, annualRate, perPayment: annualRate / ppy, frequency: d.frequency || 'quarterly', paymentsPerYear: ppy, paymentsCount: ppy, source: 'estimated' });
      });
    }
    return result.sort((a, b) => b.annualRate - a.annualRate);
  }, [dividends, portfolio, prices, metaVersion, exchangeRate, fxAt, basis]);

  const isEstimated = forecasts.length > 0 && forecasts.every(f => f.source === 'estimated');

  // Build multi-year monthly forecast
  // History: the months the payer actually paid in. Estimated: evenly spread
  // (MaerminDividendHistory.months, Node-tested).
  const monthlyForecast = useMemo(() => {
    if (!DH) return [];
    return DH.months(forecasts, { today: window.MaerminUtils.todayISO(), months: forecastYears * 12 }).map(m => {
      const d = new Date(m.y, m.m, 1);
      return { date: d, year: m.y, label: window.MaerminI18n.date(d, { month: 'short', year: '2-digit' }), amount: m.amount, items: m.items };
    });
  }, [forecasts, forecastYears]);
  const shownMonths = monthlyForecast.slice(0, Math.min(forecastYears * 12, 24));
  const sel = selMonth !== null && shownMonths[selMonth] ? shownMonths[selMonth] : null;

  // Group by year for summary
  const byYear = useMemo(() => {
    const map = {};
    monthlyForecast.forEach(m => {
      if (!map[m.year]) map[m.year] = 0;
      map[m.year] += m.amount;
    });
    return Object.entries(map).map(([year, total]) => ({ year: parseInt(year), total }));
  }, [monthlyForecast]);

  const totalForecast = monthlyForecast.reduce((s, m) => s + m.amount, 0);
  const maxMonth      = Math.max(...monthlyForecast.map(m => m.amount), 1);

  if (forecasts.length === 0) {
    return React.createElement('div', { style: { padding: '1.5rem' } },
      React.createElement('h2', { style: { color: theme.text, fontSize: 'var(--text-xl)', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1rem' } }, __('dfTitle', 'Dividend Forecast')),
      React.createElement(Card, { theme, style: { textAlign: 'center', padding: '3rem' } },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-2xl)', marginBottom: '0.5rem', opacity: 0.4 } }, '◎'),
        React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.5rem' } }, __('dfEmpty', 'No dividend data yet')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-base)', maxWidth: 360, margin: '0 auto' } },
          __('dfEmptyHint', 'Add dividend transactions, or hold recognised dividend stocks (a Worker URL in API Settings expands coverage beyond the built-in list).')
        )
      )
    );
  }

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header + year selector
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: 'var(--text-xl)', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.25rem' } }, __('dfTitle', 'Dividend Forecast')),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: 'var(--text-sm)' } },
          (isEstimated ? __('dfEstimated', 'Estimated from current holdings × known dividend rates') : __('dfProjected', 'Projected from your recorded dividend frequency and amount'))
            + ' · ' + (basis === 'gross' ? __('dhGrossNote', 'Before withholding tax.') : __('dhNetNote', 'After withholding tax.')))
      ),
      // Year range toggle
      React.createElement('div', { style: { display: 'flex', background: theme.inputBg, borderRadius: '8px', padding: '0.2rem', gap: '0.15rem' } },
        [1, 2, 3, 5, 10].map(y =>
          React.createElement('button', {
            key: y,
            onClick: () => setForecastYears(y),
            style: {
              padding: '0.3rem 0.6rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontSize: 'var(--text-xs)', fontWeight: forecastYears === y ? '700' : '400',
              background: forecastYears === y ? (theme.accentFill || theme.accent) : 'transparent',
              color: forecastYears === y ? '#ffffff' : theme.textSecondary
            }
          }, `${y}Y`)
        )
      )
    ),

    // KPI cards
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      React.createElement(StatCell, { theme, label: __('dfTotalYears', '{n}Y Total Forecast', { n: forecastYears }), value: `${formatPrice(totalForecast)} ${getCurrencySymbol()}`, color: theme.success }),
      React.createElement(StatCell, { theme, label: __('dfPerYearAvg', 'Per Year (avg)'), value: `${formatPrice(totalForecast / forecastYears)} ${getCurrencySymbol()}` }),
      React.createElement(StatCell, { theme, label: __('dfMonthlyAvg', 'Monthly Average'), value: `${formatPrice(totalForecast / (forecastYears * 12))} ${getCurrencySymbol()}` }),
      React.createElement(StatCell, { theme, label: __('dfSources', 'Dividend Sources'), value: forecasts.length })
    ),

    // Annual summary table
    forecastYears > 1 && React.createElement(Card, { theme, style: { marginBottom: '1.5rem' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: 'var(--text-base)', marginBottom: '1rem' } }, __('dfAnnualSummary', 'Annual Summary')),
      React.createElement('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' } },
        byYear.map(({ year, total }) =>
          React.createElement('div', { key: year, style: { flex: '1 1 120px', textAlign: 'center', padding: '0.875rem', background: theme.inputBg, borderRadius: '10px', border: `1px solid ${theme.cardBorder}` } },
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.375rem' } }, year),
            React.createElement('div', { style: { color: theme.success, fontWeight: '800', fontSize: 'var(--text-lg)' } }, `${formatPrice(total)} ${getCurrencySymbol()}`)
          )
        )
      )
    ),

    // Monthly bar chart (show up to 24 months at a time, scrollable)
    React.createElement(Card, { theme, style: { marginBottom: '1.5rem', overflow: 'auto' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: 'var(--text-base)', marginBottom: '1rem' } },
        forecastYears <= 2 ? __('dfMonthly', 'Monthly Breakdown') : __('dfMonthly24', 'Monthly Breakdown (first 24 months)')
      ),
      React.createElement('div', { 'data-testid': 'df-months', style: { display: 'flex', gap: '0.25rem', alignItems: 'flex-end', height: 132, minWidth: shownMonths.length * 36 } },
        shownMonths.map((m, i) => {
          const on = selMonth === i;
          // P5-2.5: each month is a button that lists its payments below
          return React.createElement('button', {
            key: i, type: 'button', 'data-month': i, 'aria-pressed': on, onClick: () => setSelMonth(on ? null : i),
            'aria-label': __('dfMonthAria', '{month}: {amount}', { month: window.MaerminI18n.date(m.date, { month: 'long', year: 'numeric' }), amount: `${formatPrice(m.amount)} ${getCurrencySymbol()}` }),
            title: `${m.label}: ${formatPrice(m.amount)} ${getCurrencySymbol()}`,
            style: { flex: '0 0 32px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: '0.2rem', padding: 0, border: 'none', background: on ? `${window.MaerminTokens.alpha(theme.accent, 0x14)}` : 'transparent', borderRadius: '6px', cursor: 'pointer' }
          },
            React.createElement('div', {
              style: {
                width: '100%', background: on ? theme.accent : `${window.MaerminTokens.alpha(theme.accent, 0xcc)}`, borderRadius: '3px 3px 0 0',
                height: `${Math.max(m.amount > 0 ? 8 : 0, Math.round(m.amount / maxMonth * 90))}px`,
                transition: 'height 0.3s',
                opacity: m.year === new Date().getFullYear() ? 1 : 0.7
              }
            }),
            React.createElement('div', { style: { color: on ? theme.text : theme.textSecondary, fontSize: 'var(--text-3xs)', textAlign: 'center', whiteSpace: 'nowrap', fontWeight: on ? 700 : 400 } },
              window.MaerminI18n.date(m.date, { month: 'short' })
            ),
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.55rem', whiteSpace: 'nowrap' } }, String(m.year).slice(2))
          );
        })
      ),
      React.createElement('div', { 'data-testid': 'df-month-detail', style: { marginTop: '0.75rem', borderTop: `1px solid ${theme.cardBorder}`, paddingTop: '0.75rem' } },
        !sel
          ? React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-sm)' } }, __('dfMonthHint', 'Select a month for its payments.'))
          : React.createElement('div', null,
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' } },
                React.createElement('strong', { style: { color: theme.text, fontSize: 'var(--text-base)' } }, window.MaerminI18n.date(sel.date, { month: 'long', year: 'numeric' })),
                React.createElement('strong', { 'data-v': sel.amount, style: { color: theme.success, fontSize: 'var(--text-base)' } }, `${formatPrice(sel.amount)} ${getCurrencySymbol()}`)),
              sel.items.length === 0
                ? React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-sm)' } }, __('dfMonthNone', 'No payment expected this month.'))
                : sel.items.slice().sort((a, b) => b.amount - a.amount).map((it, j) =>
                    React.createElement('div', { key: j, 'data-sym': it.sym, style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', padding: '0.35rem 0', fontSize: 'var(--text-sm)', borderTop: j ? `1px solid ${theme.cardBorder}` : 'none' } },
                      React.createElement('span', { style: { color: theme.text, fontWeight: 600 } }, it.sym,
                        React.createElement('span', { style: { color: theme.textSecondary, fontWeight: 400, marginLeft: '0.5rem', fontSize: 'var(--text-xs)' } },
                          it.source === 'estimated' ? __('dfSrcEstimated', 'estimated, before tax') : __('dfSrcHistory', 'from your last 12 months'))),
                      React.createElement('span', { style: { color: theme.text, fontVariantNumeric: 'tabular-nums' } }, `${formatPrice(it.amount)} ${getCurrencySymbol()}`))))
      )
    ),

    // Per-symbol breakdown
    React.createElement(Card, { theme },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: 'var(--text-base)', marginBottom: '0.875rem' } }, __('dfBySource', 'By Source (annual rate)')),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
        forecasts.map((f, i) =>
          React.createElement('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: theme.inputBg, borderRadius: '8px' } },
            React.createElement('div', null,
              React.createElement('span', { style: { color: theme.text, fontWeight: '700', marginRight: '0.5rem' } }, f.sym),
              React.createElement('span', { style: { fontSize: 'var(--text-2xs)', color: theme.textSecondary, padding: '0.1rem 0.35rem', background: `${window.MaerminTokens.alpha(theme.accent, 0x18)}`, borderRadius: '3px' } }, freqLabel(f.frequency))
            ),
            React.createElement('span', { style: { color: theme.success, fontWeight: '700', fontSize: 'var(--text-base)' } }, __('perYear', '{amount}/yr', { amount: `${formatPrice(f.annualRate)} ${getCurrencySymbol()}` }))
          )
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. FIFO COST BASIS — Steuer-genaue Kostenbasis (First In, First Out)
// Für jede Sell-Transaktion: welche Buy-Lots wurden zuerst gekauft
// ─────────────────────────────────────────────────────────────────────────────
// FIFO per position from the ONE ledger (ledger.js): EUR at each date's FX,
// buy fees in the cost basis, sell fees in the proceeds, splits applied — the
// same lots the tax report uses. Shape kept for the view below.
function calcFIFO(transactions, opts) {
  opts = opts || {};
  const L = window.MaerminLedger.build(transactions, { exchangeRate: opts.exchangeRate, fxAt: opts.fxAt });
  const out = {};
  L.list.forEach(g => {
    const key = ((g.symbol || '') + '-' + (g.category || 'crypto')).toLowerCase();
    out[key] = {
      symbol: g.symbol, category: g.category,
      buyQueue: g.openLots.map(l => ({ date: l.date, price: l.unitCostEUR, qty: l.qty, remaining: l.qty })),
      realized: g.disposals.map(d => ({ buyDate: d.acquisitionDate, buyPrice: d.unitCostEUR, qty: d.qty,
        sellDate: d.disposalDate, sellPrice: d.qty > 0 ? d.proceeds / d.qty : d.unitProceedsEUR, pnl: d.gain, longTerm: d.longTerm })),
      unrealizedQty: g.openQty,
      unrealizedCost: g.openCostEUR,
      avgCostFIFO: g.openQty > 0 ? g.openCostEUR / g.openQty : 0,
      totalRealizedPnL: g.realizedGain,
      oversold: g.oversold
    };
  });
  return out;
}

function FIFOView({ transactions, prices, theme, formatPrice, getCurrencySymbol, exchangeRate, fxAt }) {
  const fifo = useMemo(() => calcFIFO(transactions, { exchangeRate, fxAt }), [transactions, exchangeRate, fxAt]);
  const [activeSymbol, setActiveSymbol] = useState(null);

  const entries = Object.values(fifo).filter(e => e.realized.length > 0 || e.unrealizedQty > 0.0001);
  const totalRealizedPnL = entries.reduce((s, e) => s + e.totalRealizedPnL, 0);

  if (entries.length === 0) return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: 'var(--text-xl)', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1rem' } }, __('fifoTitle', 'FIFO Cost Basis')),
    React.createElement(Card, { theme, style: { textAlign: 'center', padding: '3rem' } },
      React.createElement('div', { style: { color: theme.textSecondary } }, __('fifoEmpty', 'Add transactions to see FIFO cost basis analysis'))
    )
  );

  const detail = activeSymbol ? fifo[activeSymbol] : null;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: 'var(--text-xl)', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.25rem' } }, __('fifoTitle', 'FIFO Cost Basis')),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: 'var(--text-base)' } }, __('fifoSubtitle', 'First In, First Out — standard tax method in Germany'))
      )
    ),

    // Summary
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      React.createElement(StatCell, { theme, label: __('fifoTotalRealized', 'Total Realized P&L'), value: `${totalRealizedPnL >= 0 ? '+' : ''}${formatPrice(totalRealizedPnL)} ${getCurrencySymbol()}`,
        color: totalRealizedPnL >= 0 ? theme.success : theme.danger }),
      React.createElement(StatCell, { theme, label: __('positions', 'Positions'), value: entries.length }),
      React.createElement(StatCell, { theme, label: __('fifoTotalLots', 'Total Realized Lots'), value: entries.reduce((s, e) => s + e.realized.length, 0) })
    ),

    // Position table
    React.createElement(Card, { theme, style: { marginBottom: '1rem', overflow: 'auto' } },
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: 550, fontSize: 'var(--text-sm)' } },
        React.createElement('thead', null,
          React.createElement('tr', null,
            [__('symbol', 'Symbol'), __('fifoAvgCost', 'Avg Cost (FIFO)'), __('fifoQtyHeld', 'Qty Held'), __('fifoTotalCost', 'Total Cost'), __('fifoRealizedPnl', 'Realized P&L'), __('fifoLots', 'Lots')].map((h, i) =>
              React.createElement('th', { key: i, style: { padding: '0.625rem 0.875rem', textAlign: i > 0 ? 'right' : 'left', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: '600', textTransform: 'uppercase', fontSize: 'var(--text-2xs)', letterSpacing: '0.05em', whiteSpace: 'nowrap' } }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          entries.map(e => {
            const sym = (e.symbol || '').toLowerCase();
            const key = sym + '-' + (e.category || 'crypto');
            return React.createElement('tr', {
              key,
              ...window.MaerminUtils.clickable(() => setActiveSymbol(activeSymbol === key ? null : key)),
              'aria-label': __('fifoToggleLots', 'Toggle lot details for {sym}', { sym: e.symbol || key }),
              'aria-expanded': activeSymbol === key,
              style: { borderBottom: `1px solid ${theme.cardBorder}`, cursor: 'pointer', transition: 'background 0.1s' },
              onMouseEnter: el => el.currentTarget.style.background = `${window.MaerminTokens.alpha(theme.accent, 0x08)}`,
              onMouseLeave: el => el.currentTarget.style.background = 'transparent'
            },
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', color: theme.text, fontWeight: '700' } }, e.symbol),
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', color: theme.text, textAlign: 'right' } }, `${formatPrice(e.avgCostFIFO)} ${getCurrencySymbol()}`),
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', color: theme.text, textAlign: 'right' } }, window.MaerminI18n.num(e.unrealizedQty, 4)),
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', color: theme.textSecondary, textAlign: 'right' } }, `${formatPrice(e.unrealizedCost)} ${getCurrencySymbol()}`),
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', textAlign: 'right', color: e.totalRealizedPnL >= 0 ? theme.success : theme.danger, fontWeight: '700' } },
                `${e.totalRealizedPnL >= 0 ? '+' : ''}${formatPrice(e.totalRealizedPnL)} ${getCurrencySymbol()}`
              ),
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', textAlign: 'right', color: theme.textSecondary } }, e.realized.length)
            );
          })
        )
      )
    ),

    // Lot detail for active symbol
    detail && React.createElement(Card, { theme },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.875rem' } }, __('fifoRealizedLotsOf', '{sym} — Realized Lots', { sym: detail.symbol })),
      React.createElement('div', { style: { overflowX: 'auto' } },
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)', minWidth: 500 } },
          React.createElement('thead', null,
            React.createElement('tr', null,
              [__('fifoBuyDate', 'Buy Date'), __('fifoSellDate', 'Sell Date'), __('colQty', 'Qty'), __('fifoBuyPrice', 'Buy Price'), __('fifoSellPrice', 'Sell Price'), __('colPnl', 'P&L')].map((h, i) =>
                React.createElement('th', { key: i, style: { padding: '0.5rem 0.75rem', textAlign: i > 1 ? 'right' : 'left', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: '600', textTransform: 'uppercase', fontSize: 'var(--text-3xs)', whiteSpace: 'nowrap' } }, h)
              )
            )
          ),
          React.createElement('tbody', null,
            detail.realized.map((lot, i) =>
              React.createElement('tr', { key: i, style: { borderBottom: `1px solid ${theme.cardBorder}` } },
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.textSecondary } }, window.MaerminI18n.date(lot.buyDate)),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.textSecondary } }, window.MaerminI18n.date(lot.sellDate)),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.text, textAlign: 'right' } }, window.MaerminI18n.num(lot.qty, 4)),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.textSecondary, textAlign: 'right' } }, `${formatPrice(lot.buyPrice)}`),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.textSecondary, textAlign: 'right' } }, `${formatPrice(lot.sellPrice)}`),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: '700', color: lot.pnl >= 0 ? theme.success : theme.danger } },
                  `${lot.pnl >= 0 ? '+' : ''}${formatPrice(lot.pnl)} ${getCurrencySymbol()}`
                )
              )
            )
          )
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
window.MaerminFeatures4 = {
  usePortfolios,
  PortfolioManagerView,
  SavingsPlanView,
  DividendForecastView,
  FIFOView,
  calcFIFO,
};


})();
