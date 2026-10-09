// ============================================================================
// MAERMIN v11.0 — Portfolio Management Features
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
    React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.3rem' } }, label),
    React.createElement('div', { style: { color: color || theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', lineHeight: 1 } }, value),
    sub && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.75rem', marginTop: '0.25rem' } }, sub)
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

  return { portfolios, activePortfolioId, setActivePortfolioId, addPortfolio, removePortfolio, restorePortfolio, renamePortfolio };
}

function PortfolioManagerView({ portfolios, activePortfolioId, transactions, prices, exchangeRate, fxAt, corpActionsRev, theme, t, formatPrice, getCurrencySymbol,
  setActivePortfolioId, addPortfolio, removePortfolio, renamePortfolio }) {

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

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1.5rem' } }, __('pfManager', 'Portfolio Manager')),

    // Portfolio Cards
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      portfolioStats.map(p =>
        React.createElement('div', {
          key: p.id,
          ...window.MaerminUtils.clickable(() => setActivePortfolioId(p.id)),
          'aria-label': __('pfSwitchTo', 'Switch to portfolio {name}', { name: p.name || p.id }),
          'aria-pressed': activePortfolioId === p.id,
          style: {
            background: theme.card, border: `2px solid ${activePortfolioId === p.id ? p.color : theme.cardBorder}`,
            borderRadius: '12px', padding: '1.25rem', cursor: 'pointer', transition: 'all 0.15s'
          }
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.625rem' } },
              React.createElement('div', { style: { width: 12, height: 12, borderRadius: '50%', background: p.color, flexShrink: 0 } }),
              editId === p.id
                ? React.createElement('input', {
                    value: editName, onChange: e => setEditName(e.target.value),
                    onBlur: () => { renamePortfolio(p.id, editName); setEditId(null); },
                    onKeyDown: e => e.key === 'Enter' && (renamePortfolio(p.id, editName), setEditId(null)),
                    autoFocus: true,
                    'aria-label': (t && t.pfNameLabel) || 'Portfolio name',
                    style: { background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, padding: '0.25rem 0.5rem', fontSize: '0.9rem', fontWeight: '700', width: '140px' },
                    onClick: e => e.stopPropagation()
                  })
                : React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.95rem' } }, p.name)
            ),
            React.createElement('div', { style: { display: 'flex', gap: '0.375rem' } },
              React.createElement('button', {
                onClick: e => { e.stopPropagation(); setEditId(p.id); setEditName(p.name); },
                'aria-label': ((t && t.pfRenameAria) || 'Rename portfolio {name}').replace('{name}', p.name),
                title: (t && t.pfRename) || 'Rename',
                style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '0.8rem', padding: '0.25rem' }
              }, '✎'),
              p.id !== 'default' && React.createElement('button', {
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
                style: { background: 'none', border: 'none', color: theme.danger || '#ef4444', cursor: 'pointer', fontSize: '0.8rem', padding: '0.25rem' }
              }, '×')
            )
          ),
          React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', marginBottom: '0.25rem' } },
            `${formatPrice(p.value)} ${getCurrencySymbol()}`
          ),
          React.createElement('div', { style: { display: 'flex', gap: '1rem', fontSize: '0.78rem' } },
            React.createElement('span', { style: { color: p.pnl >= 0 ? theme.success : theme.danger, fontWeight: '600' } },
              `${p.pnl >= 0 ? '+' : ''}${formatPrice(p.pnl)} (${window.MaerminI18n.pct(p.pnlPct, 1)})`
            ),
            React.createElement('span', { style: { color: theme.textSecondary } }, __('pfTxCount', '{n} {n:transaction|transactions}', { n: p.txCount }))
          )
        )
      )
    ),

    // Add new portfolio
    React.createElement(Card, { theme, style: { marginBottom: 0 } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.875rem', fontSize: '0.9rem' } }, __('pfAdd', 'Add Portfolio')),
      React.createElement('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
        React.createElement('input', {
          value: newName, onChange: e => setNewName(e.target.value),
          placeholder: __('pfNewPh', 'e.g. Trade Republic, CS2, Savings'), 'aria-label': __('pfNewAria', 'New portfolio name'),
          style: { flex: 1, minWidth: '180px', padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem' }
        }),
        // Color picker
        React.createElement('div', { style: { display: 'flex', gap: '0.375rem' } },
          COLORS.map(c => React.createElement('button', {
            key: c, onClick: () => setNewColor(c),
            style: { width: 22, height: 22, borderRadius: '50%', background: c, border: newColor === c ? '2px solid white' : '2px solid transparent', cursor: 'pointer', boxShadow: newColor === c ? '0 0 0 2px ' + c : 'none' }
          }))
        ),
        React.createElement('button', {
          onClick: () => { if (newName.trim()) { addPortfolio(newName.trim(), newColor); setNewName(''); } },
          disabled: !newName.trim(),
          style: { padding: '0.625rem 1.25rem', background: newName.trim() ? (theme.accentFill || theme.accent) : theme.inputBg, color: newName.trim() ? '#fff' : theme.textSecondary, border: 'none', borderRadius: '8px', cursor: newName.trim() ? 'pointer' : 'not-allowed', fontWeight: '700', fontSize: '0.875rem' }
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
        React.createElement('div', { id: 'dlg-plan', style: { color: theme.text, fontWeight: '800', fontSize: '1.1rem' } }, title),
        React.createElement('button', {
          onClick: onClose, 'aria-label': __('close', 'Close'),
          style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }
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
    style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', width: '100%' },
    ...props
  });

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.25rem' } }, __('spTitle', 'Savings Plans')),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, __('spSubtitle', 'Track your recurring investment plans and execution rate'))
      ),
      React.createElement('button', {
        onClick: openAdd,
        style: { padding: '0.625rem 1.25rem', background: (theme.accentFill || theme.accent), color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.875rem' }
      }, __('spAddPlan', '+ Add Plan'))
    ),

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
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('symbol', 'Symbol')),
          inp('symbol', { placeholder: __('spSymbolPh', 'BTC, ETH, AAPL...') })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('spAmountPer', 'Amount per execution')),
          React.createElement('div', { style: { display: 'flex', gap: '0.4rem' } },
            React.createElement('input', {
              value: form.amount, onChange: e => setForm(p => ({ ...p, amount: e.target.value })),
              type: 'number', placeholder: '100',
              style: { flex: 1, minWidth: 0, padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem' }
            }),
            React.createElement('select', {
              value: form.amountCurrency, onChange: e => setForm(p => ({ ...p, amountCurrency: e.target.value })),
              'aria-label': __('spAmountCurrency', 'Amount currency'),
              style: { padding: '0.625rem 0.4rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', cursor: 'pointer' }
            },
              React.createElement('option', { value: 'EUR' }, '€ EUR'),
              React.createElement('option', { value: 'USD' }, '$ USD')
            )
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('spFrequency', 'Frequency')),
          React.createElement('select', {
            value: form.frequency, onChange: e => setForm(p => ({ ...p, frequency: e.target.value })),
            style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', width: '100%' }
          },
            Object.entries(FREQ_LABELS).map(([v, l]) => React.createElement('option', { key: v, value: v }, l))
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('category', 'Category')),
          React.createElement('select', {
            value: form.category, onChange: e => setForm(p => ({ ...p, category: e.target.value })),
            style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', width: '100%' }
          },
            ['crypto', 'stocks', 'commodities'].map(c => React.createElement('option', { key: c, value: c }, c))
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('portfolio', 'Portfolio')),
          React.createElement('select', {
            value: form.portfolioId, onChange: e => setForm(p => ({ ...p, portfolioId: e.target.value })),
            style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', width: '100%' }
          },
            portfolios.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name))
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('spStartDate', 'Start Date')),
          inp('startDate', { type: 'date' })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, __('spEndDate', 'End Date')),
          React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', color: theme.textSecondary, fontSize: '0.8rem', marginBottom: '0.35rem', cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: form.noEnd, onChange: e => setForm(p => ({ ...p, noEnd: e.target.checked })) }),
            __('spNoEnd', 'No fixed end date')
          ),
          !form.noEnd && inp('endDate', { type: 'date', min: form.startDate })
        )
      ),
      !form.noEnd && form.endDate && form.endDate < form.startDate &&
        React.createElement('div', { style: { color: '#ef4444', fontSize: '0.78rem', marginBottom: '0.6rem' } }, __('spEndBeforeStart', 'End date must not be before the start date.')),
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.74rem', marginBottom: '0.875rem', lineHeight: 1.5 } },
        __('spAutoHint', 'Due executions are booked automatically as real buy transactions when the app opens (marked, deletable). If no price is available for a due date, the execution stays pending instead of guessing a quantity.')),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
        React.createElement('button', { onClick: savePlan, style: { padding: '0.625rem 1.25rem', background: (theme.accentFill || theme.accent), color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.875rem' } }, editPlan === 'new' ? __('spAddPlanBtn', 'Add Plan') : __('save', 'Save')),
        React.createElement('button', { onClick: requestClose, style: { padding: '0.625rem 1.25rem', background: theme.inputBg, color: theme.text, border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' } }, __('cancel', 'Cancel'))
      )
    ),

    // Plans list
    plans.length === 0
      ? React.createElement(Card, { theme, style: { textAlign: 'center', padding: '3rem' } },
          React.createElement('div', { style: { color: theme.textSecondary, marginBottom: '0.5rem', fontSize: '1.5rem' } }, '◎'),
          React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.25rem' } }, __('spEmpty', 'No savings plans yet')),
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, __('spEmptyHint', 'Add a recurring investment plan to track your execution rate'))
        )
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1rem' } },
          planStats.map(plan =>
            React.createElement(Card, { key: plan.id, theme },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' } },
                // Left: symbol + frequency
                React.createElement('div', null,
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem', flexWrap: 'wrap' } },
                    React.createElement('span', { style: { color: theme.text, fontWeight: '800', fontSize: '1.1rem' } }, plan.symbol),
                    React.createElement('span', { style: { fontSize: '0.7rem', padding: '0.15rem 0.5rem', background: `${theme.accent}22`, color: theme.accent, borderRadius: '4px', fontWeight: '600' } }, FREQ_LABELS[plan.frequency]),
                    React.createElement('span', { style: { fontSize: '0.7rem', color: theme.textSecondary } }, __('spPerExecution', '{amount}/execution', { amount: window.MaerminI18n.money(plan.amount, plan.amountCurrency === 'USD' ? 'USD' : 'EUR', 0) })),
                    // Status: active / completed (end date passed) / paused.
                    React.createElement('span', {
                      style: {
                        fontSize: '0.66rem', padding: '0.12rem 0.45rem', borderRadius: '4px', fontWeight: '700', textTransform: 'uppercase',
                        background: plan.status === 'active' ? 'rgba(34,197,94,0.15)' : plan.status === 'completed' ? 'rgba(148,163,184,0.18)' : 'rgba(245,158,11,0.18)',
                        color: plan.status === 'active' ? theme.success : plan.status === 'completed' ? theme.textSecondary : theme.warning
                      }
                    }, ({ active: __('spStatusActive', 'active'), completed: __('spStatusCompleted', 'completed'), paused: __('spStatusPaused', 'paused') })[plan.status] || plan.status),
                    plan.autoCount > 0 && React.createElement('span', { style: { fontSize: '0.66rem', color: theme.textSecondary } }, __('spAutoBooked', '{n} auto-booked', { n: plan.autoCount }))
                  ),
                  React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.78rem' } },
                    __('spStarted', 'Started {date}', { date: window.MaerminI18n.date(plan.startDate, 'medium') }) +
                    (plan.endDate ? ' · ' + __('spEnds', 'Ends {date}', { date: window.MaerminI18n.date(plan.endDate, 'medium') }) : '') +
                    (plan.nextDate ? ' · ' + __('spNext', 'Next {date}', { date: window.MaerminI18n.date(plan.nextDate, 'medium') }) : ''))
                ),
                // Right: adherence ring
                React.createElement('div', { style: { textAlign: 'center' } },
                  React.createElement('div', {
                    style: {
                      width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
                      background: `conic-gradient(${plan.adherence >= 80 ? '#22c55e' : plan.adherence >= 50 ? '#f59e0b' : '#ef4444'} ${plan.adherence * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
                      position: 'relative'
                    }
                  },
                    React.createElement('div', { style: { position: 'absolute', inset: 4, borderRadius: '50%', background: theme.card, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' } },
                      React.createElement('span', { style: { color: theme.text, fontWeight: '800', fontSize: '0.8rem', lineHeight: 1 } }, window.MaerminI18n.pct(plan.adherence, 0)),
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
                    React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, s.label),
                    React.createElement('div', { style: { color: s.color || theme.text, fontWeight: '700', fontSize: '1rem', marginTop: '0.125rem' } }, s.value)
                  )
                )
              ),
              // Edit / pause / delete
              React.createElement('div', { style: { marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end', gap: '0.9rem' } },
                React.createElement('button', {
                  onClick: () => openEdit(plan),
                  style: { background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600' }
                }, __('edit', 'Edit')),
                plan.status !== 'completed' && React.createElement('button', {
                  onClick: () => setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, active: p.active === false } : p)),
                  style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '0.78rem' }
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
                  style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '0.78rem' }
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
function DividendForecastView({ transactions, portfolio, prices, metaVersion, theme, formatPrice, getCurrencySymbol }) {
  const [forecastYears, setForecastYears] = React.useState(3);

  const dividends = useMemo(() =>
    transactions.filter(tx => tx.type === 'dividend' || (tx.notes || '').toLowerCase().includes('dividend')),
  [transactions]);

  // Derive a per-symbol forward rate. Primary source = the user's own recorded
  // dividend payments (most accurate). When there is no manual history, fall
  // back to the automatic engine (DividendDataService: cache → API → built-in
  // DB, all keyed through the ticker-validation layer) so the forecast works
  // out of the box for recognised holdings. Requirement #4.
  const forecasts = useMemo(() => {
    const bySymbol = {};
    dividends.forEach(tx => {
      const sym = (tx.symbol || '').toLowerCase();
      if (!bySymbol[sym]) bySymbol[sym] = { sym: tx.symbol, payments: [] };
      bySymbol[sym].payments.push({ date: new Date(tx.date), amount: parseFloat(tx.quantity || 0) * parseFloat(tx.price || 0) });
    });
    const result = [];
    Object.values(bySymbol).forEach(({ sym, payments }) => {
      if (payments.length < 1) return;
      payments.sort((a, b) => a.date - b.date);
      const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
      const first = payments[0].date, last = payments[payments.length - 1].date;
      const yearsFraction = Math.max(0.08, (last - first) / (365.25 * 86400000)) || 1;
      const annualRate = totalPaid / yearsFraction;
      const avgPerPayment = totalPaid / payments.length;
      let frequency = 'annual';
      if (payments.length >= 2) {
        const avgGapDays = (last - first) / (payments.length - 1) / 86400000;
        if (avgGapDays < 45)   frequency = 'monthly';
        else if (avgGapDays < 100) frequency = 'quarterly';
        else if (avgGapDays < 200) frequency = 'semi-annual';
      }
      result.push({ sym, annualRate, avgPerPayment, frequency, lastPayment: last, paymentsCount: payments.length, source: 'history' });
    });

    if (result.length === 0 && window.DividendDataService && portfolio && portfolio.stocks) {
      // No manual history → project from current stock holdings × known dividend.
      const data = window.DividendDataService.getPortfolioDividendData(portfolio, prices || {});
      (portfolio.stocks || []).forEach(s => {
        const sym = (s.symbol || s.name || '').toUpperCase();
        const shares = parseFloat(s.amount) || 0;
        const d = data[sym];
        if (!d || shares <= 0 || !(d.annualDividend > 0)) return;
        const annualRate = shares * d.annualDividend;
        const ppy = window.DividendDataService.getPaymentsPerYear(d.frequency);
        result.push({ sym: s.symbol || s.name, annualRate, avgPerPayment: annualRate / ppy, frequency: d.frequency || 'quarterly', paymentsCount: ppy, source: 'estimated' });
      });
    }
    return result.sort((a, b) => b.annualRate - a.annualRate);
  }, [dividends, portfolio, prices, metaVersion]);

  const isEstimated = forecasts.length > 0 && forecasts.every(f => f.source === 'estimated');

  // Build multi-year monthly forecast
  const monthlyForecast = useMemo(() => {
    const months = [];
    const now = new Date();
    const totalMonths = forecastYears * 12;
    for (let i = 0; i < totalMonths; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push({ date: d, year: d.getFullYear(), label: window.MaerminI18n.date(d, { month: 'short', year: '2-digit' }), amount: 0, items: [] });
    }
    forecasts.forEach(f => {
      const paymentsPerYear = f.frequency === 'monthly' ? 12 : f.frequency === 'quarterly' ? 4 : f.frequency === 'semi-annual' ? 2 : 1;
      const perPayment = f.annualRate / paymentsPerYear;
      months.forEach((m, i) => {
        const shouldPay = f.frequency === 'monthly' ? true
          : f.frequency === 'quarterly' ? i % 3 === 0
          : f.frequency === 'semi-annual' ? i % 6 === 0
          : i % 12 === 0;
        if (shouldPay) { m.amount += perPayment; m.items.push({ sym: f.sym, amount: perPayment }); }
      });
    });
    return months;
  }, [forecasts, forecastYears]);

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
      React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1rem' } }, __('dfTitle', 'Dividend Forecast')),
      React.createElement(Card, { theme, style: { textAlign: 'center', padding: '3rem' } },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.4 } }, '◎'),
        React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.5rem' } }, __('dfEmpty', 'No dividend data yet')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem', maxWidth: 360, margin: '0 auto' } },
          __('dfEmptyHint', 'Add dividend transactions, or hold recognised dividend stocks (a Worker URL in API Settings expands coverage beyond the built-in list).')
        )
      )
    );
  }

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header + year selector
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.25rem' } }, __('dfTitle', 'Dividend Forecast')),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.8rem' } },
          isEstimated ? __('dfEstimated', 'Estimated from current holdings × known dividend rates') : __('dfProjected', 'Projected from your recorded dividend frequency and amount'))
      ),
      // Year range toggle
      React.createElement('div', { style: { display: 'flex', background: theme.inputBg, borderRadius: '8px', padding: '0.2rem', gap: '0.15rem' } },
        [1, 2, 3, 5, 10].map(y =>
          React.createElement('button', {
            key: y,
            onClick: () => setForecastYears(y),
            style: {
              padding: '0.3rem 0.6rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: forecastYears === y ? '700' : '400',
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
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem', marginBottom: '1rem' } }, __('dfAnnualSummary', 'Annual Summary')),
      React.createElement('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' } },
        byYear.map(({ year, total }) =>
          React.createElement('div', { key: year, style: { flex: '1 1 120px', textAlign: 'center', padding: '0.875rem', background: theme.inputBg, borderRadius: '10px', border: `1px solid ${theme.cardBorder}` } },
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.375rem' } }, year),
            React.createElement('div', { style: { color: theme.success, fontWeight: '800', fontSize: '1.1rem' } }, `${formatPrice(total)} ${getCurrencySymbol()}`)
          )
        )
      )
    ),

    // Monthly bar chart (show up to 24 months at a time, scrollable)
    React.createElement(Card, { theme, style: { marginBottom: '1.5rem', overflow: 'auto' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem', marginBottom: '1rem' } },
        forecastYears <= 2 ? __('dfMonthly', 'Monthly Breakdown') : __('dfMonthly24', 'Monthly Breakdown (first 24 months)')
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.25rem', alignItems: 'flex-end', height: 120, minWidth: Math.min(forecastYears * 12, 24) * 36 } },
        monthlyForecast.slice(0, Math.min(forecastYears * 12, 24)).map((m, i) => {
          const isNewYear = i > 0 && m.year !== monthlyForecast[i-1].year;
          return React.createElement('div', { key: i, style: { flex: '0 0 32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' } },
            isNewYear && React.createElement('div', { style: { position: 'absolute', width: 1, height: 100, background: 'rgba(255,255,255,0.1)', marginTop: -4 } }),
            React.createElement('div', {
              title: `${m.label}: ${formatPrice(m.amount)} ${getCurrencySymbol()}`,
              style: {
                width: '100%', background: `${theme.accent}cc`, borderRadius: '3px 3px 0 0',
                height: `${Math.max(m.amount > 0 ? 8 : 0, Math.round(m.amount / maxMonth * 90))}px`,
                transition: 'height 0.3s', cursor: 'default',
                opacity: m.year === new Date().getFullYear() ? 1 : 0.7
              }
            }),
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.5rem', textAlign: 'center', whiteSpace: 'nowrap', transform: 'rotate(-45deg)', transformOrigin: 'top center', marginTop: '0.25rem' } },
              window.MaerminI18n.date(m.date, { month: 'short' })
            )
          );
        })
      )
    ),

    // Per-symbol breakdown
    React.createElement(Card, { theme },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.875rem' } }, __('dfBySource', 'By Source (annual rate)')),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
        forecasts.map((f, i) =>
          React.createElement('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: theme.inputBg, borderRadius: '8px' } },
            React.createElement('div', null,
              React.createElement('span', { style: { color: theme.text, fontWeight: '700', marginRight: '0.5rem' } }, f.sym),
              React.createElement('span', { style: { fontSize: '0.68rem', color: theme.textSecondary, padding: '0.1rem 0.35rem', background: `${theme.accent}18`, borderRadius: '3px' } }, freqLabel(f.frequency))
            ),
            React.createElement('span', { style: { color: theme.success, fontWeight: '700', fontSize: '0.875rem' } }, __('perYear', '{amount}/yr', { amount: `${formatPrice(f.annualRate)} ${getCurrencySymbol()}` }))
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
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1rem' } }, __('fifoTitle', 'FIFO Cost Basis')),
    React.createElement(Card, { theme, style: { textAlign: 'center', padding: '3rem' } },
      React.createElement('div', { style: { color: theme.textSecondary } }, __('fifoEmpty', 'Add transactions to see FIFO cost basis analysis'))
    )
  );

  const detail = activeSymbol ? fifo[activeSymbol] : null;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.25rem' } }, __('fifoTitle', 'FIFO Cost Basis')),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, __('fifoSubtitle', 'First In, First Out — standard tax method in Germany'))
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
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: 550, fontSize: '0.82rem' } },
        React.createElement('thead', null,
          React.createElement('tr', null,
            [__('symbol', 'Symbol'), __('fifoAvgCost', 'Avg Cost (FIFO)'), __('fifoQtyHeld', 'Qty Held'), __('fifoTotalCost', 'Total Cost'), __('fifoRealizedPnl', 'Realized P&L'), __('fifoLots', 'Lots')].map((h, i) =>
              React.createElement('th', { key: i, style: { padding: '0.625rem 0.875rem', textAlign: i > 0 ? 'right' : 'left', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: '600', textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: '0.05em', whiteSpace: 'nowrap' } }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          entries.map(e => {
            const sym = (e.symbol || '').toLowerCase();
            const key = sym + '-' + (e.category || 'crypto');
            const currentPrice = prices[e.symbol] || prices[sym] || prices[(e.symbol || '').toUpperCase()] || 0;
            const unrealizedPnL = e.unrealizedQty * (currentPrice - e.avgCostFIFO);
            return React.createElement('tr', {
              key,
              ...window.MaerminUtils.clickable(() => setActiveSymbol(activeSymbol === key ? null : key)),
              'aria-label': __('fifoToggleLots', 'Toggle lot details for {sym}', { sym: e.symbol || key }),
              'aria-expanded': activeSymbol === key,
              style: { borderBottom: `1px solid ${theme.cardBorder}`, cursor: 'pointer', transition: 'background 0.1s' },
              onMouseEnter: el => el.currentTarget.style.background = `${theme.accent}08`,
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
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: 500 } },
          React.createElement('thead', null,
            React.createElement('tr', null,
              [__('fifoBuyDate', 'Buy Date'), __('fifoSellDate', 'Sell Date'), __('colQty', 'Qty'), __('fifoBuyPrice', 'Buy Price'), __('fifoSellPrice', 'Sell Price'), __('colPnl', 'P&L')].map((h, i) =>
                React.createElement('th', { key: i, style: { padding: '0.5rem 0.75rem', textAlign: i > 1 ? 'right' : 'left', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: '600', textTransform: 'uppercase', fontSize: '0.65rem', whiteSpace: 'nowrap' } }, h)
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

console.log('[OK] MAERMIN Features4 v11.0 — Multi-Portfolio, Sparplan, Dividenden-Prognose, FIFO');

})();
