// ============================================================================
// MAERMIN v12.1 — Portfolio Management Features
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
  return React.createElement('div', { className: ['ui-card', 'ui-card--pad'].join(' '), style }, children);
}

// R4.5: a small figure on the shared Stat tile; a theme colour becomes a tone.
function StatCell({ label, value, sub, color, theme }) {
  const UIC = window.MaerminComponents;
  const tone = !color ? null : color === theme.success ? 'gain' : color === theme.danger ? 'loss' : color === theme.warning ? 'warning' : null;
  return React.createElement(UIC.Stat, { className: 'ui-tile', label, value, sub, tone });
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
    return React.createElement('div', { 'data-pf-clearing': p.id, className: 'ui-pf-card__section' },
      React.createElement('label', { className: 'ui-check' },
        React.createElement('input', { type: 'checkbox', checked: !!cfg.enabled, 'data-pf-clearing-toggle': p.id, onChange: (e) => setClearing(p.id, { enabled: e.target.checked }) }),
        __('pfClearing', 'Clearing account')),
      cfg.enabled && c && React.createElement('div', { 'data-pf-cash': p.id, className: ['ui-pf-card__cash', 'num', c.balanceEUR < 0 ? 'tone-loss' : ''].join(' ').trim() },
        __('pfCashBalance', 'Cash: {amount}', { amount: `${formatPrice(c.balanceEUR)} ${getCurrencySymbol()}` })),
      cfg.enabled && React.createElement('div', { className: 'ui-pf-card__fields' },
        React.createElement('input', { key: 'ob:' + (cfg.openingBalance || 0), type: 'text', inputMode: 'decimal', 'aria-label': __('pfOpeningBalance', 'Opening balance (EUR)'), placeholder: __('pfOpeningBalance', 'Opening balance (EUR)'),
          defaultValue: cfg.openingBalance ? window.MaerminI18n.num(cfg.openingBalance, { min: 0, max: 2 }) : '', className: ['ui-input', 'ui-input--sm'].join(' '),
          onBlur: (e) => { const v = window.MaerminUtils.parseDecimal(e.target.value); setClearing(p.id, { openingBalance: isFinite(v) ? v : 0 }); },
          onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); } }),
        React.createElement('input', { type: 'date', 'aria-label': __('pfOpeningDate', 'Date of the opening balance'), value: cfg.openingDate || '', className: ['ui-input', 'ui-input--sm'].join(' '),
          onChange: (e) => setClearing(p.id, { openingDate: e.target.value }) })),
      cfg.enabled && React.createElement('p', { className: 'ui-pf-card__hint' },
        __('pfClearingHint', 'Book deposits and withdrawals to this portfolio; trades, dividends, fees and taxes move the balance. Returns then count the cash too. If you also keep this cash as an account under Net Worth, remove it there so it is not counted twice.'))
    );
  };

  // FINDINGS M-15: the depot switch of a card (§ 20 Abs. 4 S. 7 EStG).
  const renderDepot = (p) => React.createElement('div', { 'data-pf-depot': p.id, className: 'ui-pf-card__section' },
    React.createElement('label', { className: 'ui-check' },
      React.createElement('input', { type: 'checkbox', checked: p.separateDepot === true, 'data-pf-depot-toggle': p.id, onChange: (e) => setSeparateDepot(p.id, e.target.checked) }),
      __('pfSeparateDepot', 'Separate depot for German tax')),
    p.separateDepot === true && React.createElement('p', { className: 'ui-pf-card__hint' },
      __('pfSeparateDepotHint', 'A sale of shares or funds here uses only the lots bought in this portfolio (FIFO per depot). Portfolios without the switch count as one depot. Crypto follows its own setting in the tax settings.')));

  // R3.2: portfolio cards on the shared card, buttons and fields. The card's
  // colour dot and its selected outline are the portfolio's own colour (data).
  const UIC = window.MaerminComponents;
  const money = (v) => `${formatPrice(v)} ${getCurrencySymbol()}`;
  const ALL = window.MaerminMetrics.ALL_PORTFOLIOS;
  return React.createElement('div', { className: 'ui-view' },
    React.createElement('p', { className: 'ui-view__lead' }, __('pfLead', 'Each portfolio keeps its own bookings, clearing account and depot setting. Click a card to make it the active one.')),

    // Portfolio cards
    React.createElement('div', { className: 'ui-pf-grid' },
      // "All portfolios": the read-only combined view (MaerminMetrics.ALL_PORTFOLIOS).
      // Its figures are the sum of the cards below; it holds no transactions.
      portfolioStats.length > 1 && (() => {
        const on = activePortfolioId === ALL;
        const value = portfolioStats.reduce((s, p) => s + (p.value || 0), 0), invested = portfolioStats.reduce((s, p) => s + (p.invested || 0), 0);
        return React.createElement('div', { key: ALL, 'data-pf-card': ALL, className: ['ui-card', 'ui-pf-card', 'is-all', on ? 'is-active' : ''].join(' ').trim(),
          onClick: (e) => { if (e.target.tagName !== 'BUTTON') setActivePortfolioId(ALL); } },
          React.createElement('button', { type: 'button', 'data-pf-switch': ALL, className: 'ui-pf-card__name', onClick: () => setActivePortfolioId(ALL), 'aria-pressed': on },
            '◈ ' + __('allPortfolios', 'All Portfolios')),
          React.createElement('p', { className: 'ui-pf-card__hint' }, __('pfAllHint', 'Read-only: all {n} portfolios combined. New bookings go into a portfolio.', { n: portfolioStats.length })),
          React.createElement('div', { className: ['ui-pf-card__value', 'num'].join(' ') }, formatPrice(value)),
          React.createElement('div', { className: 'ui-pf-card__meta' }, `${__('invested', 'Invested')}: ${formatPrice(invested)}`));
      })(),
      portfolioStats.map(p =>
        // P5-1.2: the card is a plain container (it was a role="button" holding
        // the rename input and the action buttons). The portfolio name is the
        // switch button; a click elsewhere on the card still switches (mouse
        // convenience; keyboard and screen readers use the button).
        React.createElement('div', {
          key: p.id,
          'data-pf-card': p.id,
          className: ['ui-card', 'ui-pf-card', activePortfolioId === p.id ? 'is-active' : ''].join(' ').trim(),
          style: activePortfolioId === p.id ? { borderColor: p.color } : undefined,
          onClick: (e) => { if (!/^(BUTTON|INPUT|SUMMARY|LABEL|SELECT)$/.test(e.target.tagName) && !e.target.closest('[data-pf-clearing]')) setActivePortfolioId(p.id); }
        },
          React.createElement('div', { className: 'ui-pf-card__head' },
            React.createElement('span', { className: 'ui-pf-card__dot', 'aria-hidden': 'true', style: { background: p.color } }),
            editId === p.id
              ? React.createElement('input', {
                  value: editName, onChange: e => setEditName(e.target.value),
                  onBlur: () => { renamePortfolio(p.id, editName); setEditId(null); },
                  onKeyDown: e => e.key === 'Enter' && (renamePortfolio(p.id, editName), setEditId(null)),
                  autoFocus: true,
                  'aria-label': (t && t.pfNameLabel) || 'Portfolio name',
                  className: ['ui-input', 'ui-pf-card__rename'].join(' '),
                  onClick: e => e.stopPropagation()
                })
              : React.createElement('button', {
                  type: 'button', 'data-pf-switch': p.id, className: 'ui-pf-card__name',
                  onClick: () => setActivePortfolioId(p.id),
                  'aria-label': __('pfSwitchTo', 'Switch to portfolio {name}', { name: p.name || p.id }),
                  'aria-pressed': activePortfolioId === p.id
                }, p.name),
            React.createElement('span', { className: 'ui-pf-card__tools' },
              React.createElement(UIC.IconButton, {
                size: 'sm', icon: React.createElement('span', { 'aria-hidden': 'true' }, '✎'),
                onClick: e => { e.stopPropagation(); setEditId(p.id); setEditName(p.name); },
                label: ((t && t.pfRenameAria) || 'Rename portfolio {name}').replace('{name}', p.name)
              }),
              p.id !== 'default' && React.createElement(UIC.IconButton, {
                size: 'sm', className: 'is-danger', icon: React.createElement('span', { 'aria-hidden': 'true' }, '×'),
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
                label: ((t && t.pfDeleteAria) || 'Delete portfolio {name}').replace('{name}', p.name)
              })
            )
          ),
          React.createElement('div', { className: ['ui-pf-card__value', 'num'].join(' ') }, money(p.value)),
          React.createElement('div', { className: 'ui-pf-card__meta' },
            React.createElement('span', { className: 'num ' + (p.pnl > 0 ? 'tone-gain' : p.pnl < 0 ? 'tone-loss' : '') },
              `${p.pnl > 0 ? '▲ +' : p.pnl < 0 ? '▼ ' : ''}${formatPrice(p.pnl)} (${window.MaerminI18n.pct(p.pnlPct, 1)})`),
            React.createElement('span', null, __('pfTxCount', '{n} {n:transaction|transactions}', { n: p.txCount }))
          ),
          // P5-1.4: optional clearing account (Verrechnungskonto)
          setClearing && renderClearing(p),
          setSeparateDepot && renderDepot(p)
        )
      )
    ),

    // Add new portfolio
    React.createElement(UIC.Card, { title: __('pfAdd', 'Add Portfolio'), className: 'ui-pf-add' },
      React.createElement('div', { className: 'ui-pf-add__row' },
        React.createElement('input', {
          value: newName, onChange: e => setNewName(e.target.value),
          onKeyDown: e => { if (e.key === 'Enter' && newName.trim()) { addPortfolio(newName.trim(), newColor); setNewName(''); } },
          placeholder: __('pfNewPh', 'e.g. Trade Republic, CS2, Savings'), 'aria-label': __('pfNewAria', 'New portfolio name'),
          className: ['ui-input', 'ui-pf-add__name'].join(' ')
        }),
        // Colour picker (the portfolio's own colour - data, not theme)
        React.createElement('div', { className: 'ui-pf-add__colors', role: 'group', 'aria-label': __('pfColour', 'Colour') },
          COLORS.map((c, i) => React.createElement('button', {
            key: c, type: 'button', onClick: () => setNewColor(c), className: 'ui-pf-swatch',
            'aria-label': __('pfColorN', 'Colour {n}', { n: i + 1 }), 'aria-pressed': newColor === c,
            style: { background: c }
          }))
        ),
        React.createElement(UIC.Button, {
          variant: 'primary', disabled: !newName.trim(),
          onClick: () => { if (newName.trim()) { addPortfolio(newName.trim(), newColor); setNewName(''); } }
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
// R4.5: the plan form on the shared Modal (a sheet on phones); the title keeps its id.
function PlanModal({ theme, title, onClose, children }) {
  return React.createElement(window.MaerminComponents.Modal, { open: true, onClose, title, titleId: 'dlg-plan', 'data-testid': 'plan-dialog' }, children);
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

  const UIC = window.MaerminComponents;
  const fieldIn = (field, label, props = {}) => React.createElement(UIC.Input, Object.assign({
    label, value: form[field], onChange: e => setForm(p => ({ ...p, [field]: e.target.value }))
  }, props));
  const fieldSel = (field, label, options) => React.createElement(UIC.Select, {
    label, value: form[field], onChange: e => setForm(p => ({ ...p, [field]: e.target.value })), options
  });
  const addBtn = () => React.createElement(UIC.Button, { variant: 'primary', onClick: openAdd }, __('spAddPlan', '+ Add Plan'));
  const statusTone = (st) => st === 'active' ? 'gain' : st === 'completed' ? null : 'warning';
  const rateTone = (a) => a >= 80 ? 'gain' : a >= 50 ? 'warning' : 'loss';

  return React.createElement('div', { className: 'ui-view', 'data-testid': 'savings-plans-view' },
    React.createElement('div', { className: 'ui-view__bar' },
      React.createElement('p', { className: 'ui-view__lead' }, __('spSubtitle', 'Track your recurring investment plans and execution rate')),
      addBtn()),

    // UX-021: no plans yet - say so first, with the Add button.
    plans.length === 0 && React.createElement(UIC.EmptyState, {
      title: __('spEmpty', 'No savings plans yet'), text: __('spEmptyHint', 'Add a recurring investment plan to track your execution rate'),
      actions: [{ label: __('spAddPlan', '+ Add Plan'), onClick: openAdd, variant: 'primary' }]
    }),

    // Plans list
    plans.length > 0 && React.createElement('div', { className: 'ui-sp-list' },
      planStats.map(plan =>
        React.createElement(UIC.Card, { key: plan.id, className: 'ui-sp-card', 'data-plan': plan.id },
          React.createElement('div', { className: 'ui-sp-head' },
            React.createElement('div', { className: 'ui-sp-title' },
              React.createElement('div', { className: 'ui-sp-name' },
                React.createElement('b', null, plan.symbol),
                React.createElement(UIC.Badge, null, FREQ_LABELS[plan.frequency]),
                // Status: active / completed (end date passed) / paused.
                React.createElement(UIC.Badge, { tone: statusTone(plan.status) }, ({ active: __('spStatusActive', 'active'), completed: __('spStatusCompleted', 'completed'), paused: __('spStatusPaused', 'paused') })[plan.status] || plan.status),
                React.createElement('span', { className: 'ui-muted' }, __('spPerExecution', '{amount}/execution', { amount: window.MaerminI18n.money(plan.amount, plan.amountCurrency === 'USD' ? 'USD' : 'EUR', 0) })),
                plan.autoCount > 0 && React.createElement('span', { className: 'ui-muted' }, __('spAutoBooked', '{n} auto-booked', { n: plan.autoCount }))),
              React.createElement('p', { className: 'ui-note' },
                __('spStarted', 'Started {date}', { date: window.MaerminI18n.date(plan.startDate, 'medium') }) +
                (plan.endDate ? ' · ' + __('spEnds', 'Ends {date}', { date: window.MaerminI18n.date(plan.endDate, 'medium') }) : '') +
                (plan.nextDate ? ' · ' + __('spNext', 'Next {date}', { date: window.MaerminI18n.date(plan.nextDate, 'medium') }) : ''))),
            // Execution rate ring
            React.createElement('div', { className: ['ui-ring', 'ui-ring--sm'].join(' '), title: __('spRate', 'Execution rate'), style: { background: `conic-gradient(var(--${rateTone(plan.adherence)}) ${plan.adherence * 3.6}deg, var(--surface-2) 0deg)` } },
              React.createElement('div', { className: 'ui-ring__inner' },
                React.createElement('b', { className: 'num' }, window.MaerminI18n.pct(plan.adherence, 0)),
                React.createElement('span', null, __('spRateShort', 'rate'))))),
          // Stats row
          React.createElement('div', { className: 'ui-tiles' },
            React.createElement(UIC.Stat, { className: 'ui-tile', label: __('spExecuted', 'Executed'), value: String(plan.actualCount) }),
            React.createElement(UIC.Stat, { className: 'ui-tile', label: __('spExpected', 'Expected'), value: String(plan.expected) }),
            React.createElement(UIC.Stat, { className: 'ui-tile', label: __('spMissed', 'Missed'), value: (Math.max(0, plan.expected - plan.actualCount) > 0 ? '! ' : '✓ ') + Math.max(0, plan.expected - plan.actualCount), tone: Math.max(0, plan.expected - plan.actualCount) > 0 ? 'warning' : 'gain' }),
            React.createElement(UIC.Stat, { className: 'ui-tile', label: __('totalInvested', 'Total Invested'), value: `${formatPrice(plan.totalInvested)} ${getCurrencySymbol()}` })),
          // Edit / pause / delete
          React.createElement('div', { className: ['ui-actions', 'ui-sp-actions'].join(' ') },
            React.createElement(UIC.Button, { size: 'sm', onClick: () => openEdit(plan) }, __('edit', 'Edit')),
            plan.status !== 'completed' && React.createElement(UIC.Button, { size: 'sm', variant: 'quiet',
              onClick: () => setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, active: p.active === false } : p))
            }, plan.active === false ? __('resume', 'Resume') : __('pause', 'Pause')),
            React.createElement(UIC.Button, { size: 'sm', variant: 'quiet',
              onClick: () => window.MaerminUtils.confirmThen({
                title: ((t && t.spRemoveTitle) || 'Remove the savings plan {name}?').replace('{name}', plan.symbol || ''),
                message: (t && t.spRemoveMessage) || 'Executions already booked stay in your transactions.',
                confirmLabel: (t && t.spRemove) || 'Remove plan', cancelLabel: (t && t.cancel) || 'Cancel'
              }, () => {
                setPlans(prev => prev.filter(p => p.id !== plan.id));
                if (window.MaerminTrash) window.MaerminTrash.trashed('savingsPlan', plan.symbol || plan.name || '', plan);
              })
            }, __('spRemove', 'Remove plan')))
        )
      )
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
      React.createElement('div', { className: 'ui-form-grid' },
        fieldIn('symbol', __('symbol', 'Symbol'), { placeholder: __('spSymbolPh', 'BTC, ETH, AAPL...') }),
        React.createElement('div', { className: 'ui-field' },
          React.createElement('label', { className: 'ui-field__label', htmlFor: 'sp-amount' }, __('spAmountPer', 'Amount per execution')),
          React.createElement('div', { className: 'ui-sp-amount' },
            React.createElement('input', {
              id: 'sp-amount', className: 'ui-input', value: form.amount, onChange: e => setForm(p => ({ ...p, amount: e.target.value })),
              type: 'number', placeholder: '100'
            }),
            React.createElement('select', {
              className: ['ui-input', 'ui-select'].join(' '),
              value: form.amountCurrency, onChange: e => setForm(p => ({ ...p, amountCurrency: e.target.value })),
              'aria-label': __('spAmountCurrency', 'Amount currency')
            },
              React.createElement('option', { value: 'EUR' }, '€ EUR'),
              React.createElement('option', { value: 'USD' }, '$ USD')))),
        fieldSel('frequency', __('spFrequency', 'Frequency'), Object.entries(FREQ_LABELS).map(([v, l]) => ({ value: v, label: l }))),
        fieldSel('category', __('category', 'Category'), ['crypto', 'stocks', 'commodities'].map(c => ({ value: c, label: window.MaerminI18n.category(c) }))),
        fieldSel('portfolioId', __('portfolio', 'Portfolio'), portfolios.map(p => ({ value: p.id, label: p.name }))),
        fieldIn('startDate', __('spStartDate', 'Start Date'), { type: 'date' }),
        React.createElement('div', { className: 'ui-field' },
          React.createElement('span', { className: 'ui-field__label' }, __('spEndDate', 'End Date')),
          React.createElement('label', { className: 'ui-check' },
            React.createElement('input', { type: 'checkbox', checked: form.noEnd, onChange: e => setForm(p => ({ ...p, noEnd: e.target.checked })) }),
            __('spNoEnd', 'No fixed end date')),
          !form.noEnd && React.createElement('input', { type: 'date', min: form.startDate, className: 'ui-input', 'aria-label': __('spEndDate', 'End Date'),
            value: form.endDate, onChange: e => setForm(p => ({ ...p, endDate: e.target.value })) }))
      ),
      !form.noEnd && form.endDate && form.endDate < form.startDate &&
        React.createElement('p', { role: 'alert', className: ['ui-note', 'tone-loss'].join(' ') }, '! ' + __('spEndBeforeStart', 'End date must not be before the start date.')),
      React.createElement('p', { className: 'ui-note' },
        __('spAutoHint', 'Due executions are booked automatically as real buy transactions when the app opens (marked, deletable). If no price is available for a due date, the execution stays pending instead of guessing a quantity.')),
      React.createElement('div', { className: 'ui-actions' },
        React.createElement(UIC.Button, { variant: 'primary', onClick: savePlan }, editPlan === 'new' ? __('spAddPlanBtn', 'Add Plan') : __('save', 'Save')),
        React.createElement(UIC.Button, { onClick: requestClose }, __('cancel', 'Cancel')))
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

  // R4.6: Segmented years, Stat tiles, the months on ChartFrame (with "Show as table"), sources on the shared rows
  const UIC = window.MaerminComponents;
  const h = React.createElement;
  const money = (v) => `${formatPrice(v)} ${getCurrencySymbol()}`;
  if (forecasts.length === 0) {
    return h('div', { className: 'ui-df' },
      h(UIC.EmptyState, { title: __('dfEmpty', 'No dividend data yet'),
        text: __('dfEmptyHint', 'Add dividend transactions, or hold recognised dividend stocks (a Worker URL in API Settings expands coverage beyond the built-in list).') }));
  }

  const monthName = (m) => window.MaerminI18n.date(m.date, { month: 'long', year: 'numeric' });
  return h('div', { className: 'ui-df' },
    h('div', { className: 'ui-view__bar' },
      h('p', { className: 'ui-view__lead' },
        (isEstimated ? __('dfEstimated', 'Estimated from current holdings × known dividend rates') : __('dfProjected', 'Projected from your recorded dividend frequency and amount'))
          + ' · ' + (basis === 'gross' ? __('dhGrossNote', 'Before withholding tax.') : __('dhNetNote', 'After withholding tax.'))),
      h(UIC.Segmented, { size: 'sm', label: __('dfTitle', 'Dividend Forecast'), value: forecastYears, onChange: (y) => { setForecastYears(y); setSelMonth(null); },
        options: [1, 2, 3, 5, 10].map(y => ({ value: y, label: `${y}Y` })) })),

    // KPI tiles
    h('div', { className: 'ui-tiles' },
      h(UIC.Stat, { className: 'ui-tile', label: __('dfTotalYears', '{n}Y Total Forecast', { n: forecastYears }), value: money(totalForecast), tone: 'income' }),
      h(UIC.Stat, { className: 'ui-tile', label: __('dfPerYearAvg', 'Per Year (avg)'), value: money(totalForecast / forecastYears) }),
      h(UIC.Stat, { className: 'ui-tile', label: __('dfMonthlyAvg', 'Monthly Average'), value: money(totalForecast / (forecastYears * 12)) }),
      h(UIC.Stat, { className: 'ui-tile', label: __('dfSources', 'Dividend Sources'), value: String(forecasts.length) })),

    // Annual summary
    forecastYears > 1 && h(UIC.Card, { headingLevel: 'h3', title: __('dfAnnualSummary', 'Annual Summary') },
      h('div', { className: 'ui-tiles' },
        byYear.map(({ year, total }) => h(UIC.Stat, { key: year, className: 'ui-tile', label: String(year), value: money(total), tone: 'income' })))),

    // Monthly bars (up to 24 months); each month is a button that lists its payments below
    h(UIC.ChartFrame, { className: 'ui-df-chart', title: forecastYears <= 2 ? __('dfMonthly', 'Monthly Breakdown') : __('dfMonthly24', 'Monthly Breakdown (first 24 months)'),
      subtitle: __('dfMonthHint', 'Select a month for its payments.'),
      table: { rows: shownMonths.map((m, i) => ({ id: i, m })), columns: [
        { key: 'month', label: __('dfMonthCol', 'Month'), render: (r) => monthName(r.m) },
        { key: 'amount', label: __('amount', 'Amount'), align: 'right', render: (r) => money(r.m.amount) }] } },
      h('div', { className: 'ui-df-scroll' },
        h('div', { 'data-testid': 'df-months', className: 'ui-df-bars', style: { minWidth: shownMonths.length * 36 + 'px' } },
          shownMonths.map((m, i) => {
            const on = selMonth === i;
            return h('button', {
              key: i, type: 'button', 'data-month': i, 'aria-pressed': on, onClick: () => setSelMonth(on ? null : i),
              className: ['ui-df-bar', on ? 'is-on' : '', m.year === new Date().getFullYear() ? '' : 'is-later'].join(' ').trim(),
              'aria-label': __('dfMonthAria', '{month}: {amount}', { month: monthName(m), amount: money(m.amount) }),
              title: `${m.label}: ${money(m.amount)}`
            },
              h('span', { className: 'ui-df-bar__fill', style: { height: `${Math.max(m.amount > 0 ? 8 : 0, Math.round(m.amount / maxMonth * 90))}px` } }),
              h('span', { className: 'ui-df-bar__m' }, window.MaerminI18n.date(m.date, { month: 'short' })),
              h('span', { className: 'ui-df-bar__y' }, String(m.year).slice(2)));
          }))),
      h('div', { 'data-testid': 'df-month-detail', className: 'ui-df-detail' },
        !sel
          ? h('p', { className: 'ui-muted' }, __('dfMonthHint', 'Select a month for its payments.'))
          : h('div', null,
              h('div', { className: 'ui-df-detail__head' },
                h('strong', null, monthName(sel)),
                h('strong', { 'data-v': sel.amount, className: ['num', 'tone-income'].join(' ') }, money(sel.amount))),
              sel.items.length === 0
                ? h('p', { className: 'ui-muted' }, __('dfMonthNone', 'No payment expected this month.'))
                : h('ul', { className: 'ui-rows' }, sel.items.slice().sort((a, b) => b.amount - a.amount).map((it, j) =>
                    h('li', { key: j, 'data-sym': it.sym, className: 'ui-rows__row' },
                      h('div', { className: 'ui-rows__main' }, h('b', null, it.sym),
                        h('span', null, it.source === 'estimated' ? __('dfSrcEstimated', 'estimated, before tax') : __('dfSrcHistory', 'from your last 12 months'))),
                      h('div', { className: 'ui-rows__side' }, h('b', { className: 'num' }, money(it.amount))))))))),

    // Per-symbol breakdown
    h(UIC.Card, { headingLevel: 'h3', title: __('dfBySource', 'By Source (annual rate)') },
      h('ul', { className: 'ui-rows' },
        forecasts.map((f, i) =>
          h('li', { key: i, className: 'ui-rows__row' },
            h('div', { className: 'ui-df-src' }, h('b', null, f.sym), h(UIC.Badge, null, freqLabel(f.frequency))),
            h('div', { className: 'ui-rows__side' }, h('b', { className: ['num', 'tone-income'].join(' ') }, __('perYear', '{amount}/yr', { amount: money(f.annualRate) }))))))));
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

  // R4.6: the view layout, Stat tiles, the shared table look (rows open their lots), signed P&L
  const UIC = window.MaerminComponents;
  const h = React.createElement;
  const sym = getCurrencySymbol();
  const signed = (v) => `${v >= 0 ? '+' : ''}${formatPrice(v)} ${sym}`;
  const tone = (v) => 'tone-' + UIC.toneOf(v);
  if (entries.length === 0) return h('div', { className: ['ui-view', 'ui-view--cont'].join(' ') },
    h(UIC.EmptyState, { title: __('fifoTitle', 'FIFO Cost Basis'), text: __('fifoEmpty', 'Add transactions to see FIFO cost basis analysis') }));

  const detail = activeSymbol ? fifo[activeSymbol] : null;
  const TABLE = ['ui-table', 'ui-table--dense', 'ui-table--tall'].join(' ');

  return h('div', { className: ['ui-view', 'ui-view--cont', 'ui-fifo'].join(' ') },
    h('p', { className: 'ui-view__lead' }, __('fifoSubtitle', 'First In, First Out — standard tax method in Germany')),

    // Summary
    h('div', { className: 'ui-tiles' },
      h(UIC.Stat, { className: 'ui-tile', label: __('fifoTotalRealized', 'Total Realized P&L'), value: signed(totalRealizedPnL), tone: UIC.toneOf(totalRealizedPnL) }),
      h(UIC.Stat, { className: 'ui-tile', label: __('positions', 'Positions'), value: String(entries.length) }),
      h(UIC.Stat, { className: 'ui-tile', label: __('fifoTotalLots', 'Total Realized Lots'), value: String(entries.reduce((s, e) => s + e.realized.length, 0)) })),

    // Position table
    h(UIC.Card, { headingLevel: 'h3', title: __('fifoTitle', 'FIFO Cost Basis') },
      h('div', { className: 'ui-table-wrap' },
        h('table', { className: TABLE },
          h('thead', null, h('tr', null,
            [__('symbol', 'Symbol'), __('fifoAvgCost', 'Avg Cost (FIFO)'), __('fifoQtyHeld', 'Qty Held'), __('fifoTotalCost', 'Total Cost'), __('fifoRealizedPnl', 'Realized P&L'), __('fifoLots', 'Lots')].map((label, i) =>
              h('th', { key: i, scope: 'col', className: i > 0 ? 'is-right' : 'is-sticky' }, label)))),
          h('tbody', null,
            entries.map(e => {
              const key = (e.symbol || '').toLowerCase() + '-' + (e.category || 'crypto');
              return h('tr', {
                key, className: ['is-clickable', activeSymbol === key ? 'is-selected' : ''].join(' ').trim(),
                ...window.MaerminUtils.clickable(() => setActiveSymbol(activeSymbol === key ? null : key)),
                'aria-label': __('fifoToggleLots', 'Toggle lot details for {sym}', { sym: e.symbol || key }),
                'aria-expanded': activeSymbol === key
              },
                h('th', { scope: 'row', className: 'is-sticky' }, e.symbol),
                h('td', null, `${formatPrice(e.avgCostFIFO)} ${sym}`),
                h('td', null, window.MaerminI18n.num(e.unrealizedQty, 4)),
                h('td', { className: 'is-dim' }, `${formatPrice(e.unrealizedCost)} ${sym}`),
                h('td', { className: [tone(e.totalRealizedPnL), 'is-strong'].join(' ') }, signed(e.totalRealizedPnL)),
                h('td', { className: 'is-dim' }, e.realized.length));
            }))))),

    // Lot detail for active symbol
    detail && h(UIC.Card, { headingLevel: 'h3', title: __('fifoRealizedLotsOf', '{sym} — Realized Lots', { sym: detail.symbol }) },
      h('div', { className: 'ui-table-wrap' },
        h('table', { className: TABLE },
          h('thead', null, h('tr', null,
            [__('fifoBuyDate', 'Buy Date'), __('fifoSellDate', 'Sell Date'), __('colQty', 'Qty'), __('fifoBuyPrice', 'Buy Price'), __('fifoSellPrice', 'Sell Price'), __('colPnl', 'P&L')].map((label, i) =>
              h('th', { key: i, scope: 'col', className: i > 1 ? 'is-right' : 'is-left' }, label)))),
          h('tbody', null,
            detail.realized.map((lot, i) =>
              h('tr', { key: i },
                h('td', { className: ['is-left', 'is-dim'].join(' ') }, window.MaerminI18n.date(lot.buyDate)),
                h('td', { className: ['is-left', 'is-dim'].join(' ') }, window.MaerminI18n.date(lot.sellDate)),
                h('td', null, window.MaerminI18n.num(lot.qty, 4)),
                h('td', { className: 'is-dim' }, formatPrice(lot.buyPrice)),
                h('td', { className: 'is-dim' }, formatPrice(lot.sellPrice)),
                h('td', { className: [tone(lot.pnl), 'is-strong'].join(' ') }, signed(lot.pnl)))))))));
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
