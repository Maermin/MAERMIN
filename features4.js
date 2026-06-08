// ============================================================================
// MAERMIN v9.0 — Portfolio Management Features
// 1. Multi-Portfolio Manager   — mehrere Depots / Portfolios
// 2. Savings Plan Tracker      — Sparplan-Tracking mit Statistiken
// 3. Dividend Forecast         — 12-Monats-Prognose basierend auf Vergangenheit
// 4. FIFO Cost Basis           — korrekte Steuer-Kostenbasis per FIFO
// ============================================================================
(function () {
'use strict';

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

const DEFAULT_PORTFOLIO = { id: 'default', name: 'Main Portfolio', color: '#f5a524', icon: '◆' };

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

  const renamePortfolio = (id, name) => {
    setPortfolios(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  };

  return { portfolios, activePortfolioId, setActivePortfolioId, addPortfolio, removePortfolio, renamePortfolio };
}

function PortfolioSwitcher({ portfolios, activePortfolioId, setActivePortfolioId, transactions, prices, theme }) {

  const portfolioValues = useMemo(() => {
    const values = {};
    portfolios.forEach(p => {
      const txs = transactions.filter(tx => (tx.portfolioId || 'default') === p.id);
      const holdings = {};
      txs.forEach(tx => {
        const key = (tx.symbol || '').toLowerCase();
        if (!holdings[key]) holdings[key] = { amount: 0, sym: tx.symbol };
        if (tx.type === 'buy') holdings[key].amount += parseFloat(tx.quantity) || 0;
        else holdings[key].amount -= parseFloat(tx.quantity) || 0;
      });
      let total = 0;
      Object.values(holdings).forEach(h => {
        const pr = prices[h.sym] || prices[(h.sym || '').toLowerCase()] || 0;
        total += Math.max(0, h.amount) * pr;
      });
      values[p.id] = total;
    });
    return values;
  }, [portfolios, transactions, prices]);

  return React.createElement('div', { style: { display: 'flex', gap: '0.25rem', padding: '0.25rem', background: theme.inputBg, borderRadius: '10px' } },
    portfolios.map(p =>
      React.createElement('button', {
        key: p.id,
        onClick: () => setActivePortfolioId(p.id),
        title: portfolioValues[p.id] ? `€${portfolioValues[p.id].toFixed(0)}` : '',
        style: {
          padding: '0.35rem 0.75rem', border: 'none', borderRadius: '7px', cursor: 'pointer',
          fontSize: '0.78rem', fontWeight: activePortfolioId === p.id ? '700' : '400',
          background: activePortfolioId === p.id ? p.color : 'transparent',
          color: activePortfolioId === p.id ? '#fff' : theme.textSecondary,
          transition: 'all 0.15s', whiteSpace: 'nowrap'
        }
      }, p.name)
    )
  );
}

function PortfolioManagerView({ portfolios, activePortfolioId, transactions, prices, theme, formatPrice, getCurrencySymbol,
  setActivePortfolioId, addPortfolio, removePortfolio, renamePortfolio }) {

  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [editId, setEditId]     = useState(null);
  const [editName, setEditName] = useState('');

  const COLORS = ['#f5a524','#3b82f6','#22c55e','#f59e0b','#ef4444','#06b6d4','#f97316','#ec4899'];

  // Value per portfolio
  const portfolioStats = useMemo(() => {
    return portfolios.map(p => {
      const txs = transactions.filter(tx => (tx.portfolioId || 'default') === p.id);
      const holdings = {};
      txs.forEach(tx => {
        const key = (tx.symbol || '').toLowerCase();
        if (!holdings[key]) holdings[key] = { amount: 0, invested: 0, sym: tx.symbol };
        const qty = parseFloat(tx.quantity) || 0;
        const price = parseFloat(tx.price) || 0;
        if (tx.type === 'buy') { holdings[key].amount += qty; holdings[key].invested += qty * price; }
        else { holdings[key].amount -= qty; }
      });
      let value = 0, invested = 0;
      Object.values(holdings).forEach(h => {
        const pr = prices[h.sym] || prices[(h.sym || '').toLowerCase()] || 0;
        value += Math.max(0, h.amount) * pr;
        invested += h.invested;
      });
      return { ...p, value, invested, txCount: txs.length, pnl: value - invested, pnlPct: invested > 0 ? (value - invested) / invested * 100 : 0 };
    });
  }, [portfolios, transactions, prices]);

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1.5rem' } }, 'Portfolio Manager'),

    // Portfolio Cards
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      portfolioStats.map(p =>
        React.createElement('div', {
          key: p.id,
          ...window.MaerminUtils.clickable(() => setActivePortfolioId(p.id)),
          'aria-label': 'Switch to portfolio ' + (p.name || p.id),
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
                    style: { background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, padding: '0.25rem 0.5rem', fontSize: '0.9rem', fontWeight: '700', width: '140px' },
                    onClick: e => e.stopPropagation()
                  })
                : React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.95rem' } }, p.name)
            ),
            React.createElement('div', { style: { display: 'flex', gap: '0.375rem' } },
              React.createElement('button', {
                onClick: e => { e.stopPropagation(); setEditId(p.id); setEditName(p.name); },
                style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '0.8rem', padding: '0.25rem' }
              }, '✎'),
              p.id !== 'default' && React.createElement('button', {
                onClick: e => { e.stopPropagation(); if (confirm(`Delete "${p.name}"? Transactions will move to Main Portfolio.`)) removePortfolio(p.id); },
                style: { background: 'none', border: 'none', color: theme.danger || '#ef4444', cursor: 'pointer', fontSize: '0.8rem', padding: '0.25rem' }
              }, '×')
            )
          ),
          React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', marginBottom: '0.25rem' } },
            `${formatPrice(p.value)} ${getCurrencySymbol()}`
          ),
          React.createElement('div', { style: { display: 'flex', gap: '1rem', fontSize: '0.78rem' } },
            React.createElement('span', { style: { color: p.pnl >= 0 ? '#22c55e' : '#ef4444', fontWeight: '600' } },
              `${p.pnl >= 0 ? '+' : ''}${formatPrice(p.pnl)} (${p.pnlPct.toFixed(1)}%)`
            ),
            React.createElement('span', { style: { color: theme.textSecondary } }, `${p.txCount} transactions`)
          )
        )
      )
    ),

    // Add new portfolio
    React.createElement(Card, { theme, style: { marginBottom: 0 } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.875rem', fontSize: '0.9rem' } }, 'Add Portfolio'),
      React.createElement('div', { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
        React.createElement('input', {
          value: newName, onChange: e => setNewName(e.target.value),
          placeholder: 'e.g. Trade Republic, CS2, Savings',
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
          style: { padding: '0.625rem 1.25rem', background: newName.trim() ? theme.accent : theme.inputBg, color: newName.trim() ? '#fff' : theme.textSecondary, border: 'none', borderRadius: '8px', cursor: newName.trim() ? 'pointer' : 'not-allowed', fontWeight: '700', fontSize: '0.875rem' }
        }, '+ Add')
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SAVINGS PLAN TRACKER (Sparplan)
// User defines recurring investment plans → MAERMIN tracks execution
// ─────────────────────────────────────────────────────────────────────────────
function SavingsPlanView({ transactions, theme, formatPrice, getCurrencySymbol, t, startValue, dividendYield }) {
  const [plans, setPlans] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_savings_plans') || '[]'); } catch { return []; }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState({ symbol: '', amount: '', frequency: 'monthly', category: 'crypto', startDate: new Date().toISOString().split('T')[0] });

  useEffect(() => { localStorage.setItem('maermin_savings_plans', JSON.stringify(plans)); }, [plans]);

  const addPlan = () => {
    if (!form.symbol || !form.amount) return;
    setPlans(prev => [...prev, { id: Date.now().toString(), ...form, amount: parseFloat(form.amount), active: true, createdAt: new Date().toISOString() }]);
    setForm({ symbol: '', amount: '', frequency: 'monthly', category: 'crypto', startDate: new Date().toISOString().split('T')[0] });
    setShowAdd(false);
  };

  // For each plan, compute: expected executions, actual executions, adherence rate
  const planStats = useMemo(() => {
    return plans.map(plan => {
      const start = new Date(plan.startDate);
      const now   = new Date();
      const symL  = (plan.symbol || '').toLowerCase();

      // Count expected executions
      const msPerPeriod = plan.frequency === 'weekly' ? 7*86400000
        : plan.frequency === 'biweekly' ? 14*86400000
        : plan.frequency === 'monthly' ? 30.44*86400000
        : 91.31*86400000; // quarterly

      const expected = Math.max(0, Math.floor((now - start) / msPerPeriod));

      // Count actual buy transactions for this symbol since start
      const actual = transactions.filter(tx =>
        tx.type === 'buy' &&
        (tx.symbol || '').toLowerCase() === symL &&
        new Date(tx.date) >= start
      );

      const actualCount   = actual.length;
      const totalInvested = actual.reduce((s, tx) => s + (parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0), 0);
      const adherence     = expected > 0 ? Math.min(100, Math.round(actualCount / expected * 100)) : 100;

      // Next expected date
      const lastExecution = actual.length > 0
        ? new Date(Math.max(...actual.map(tx => new Date(tx.date))))
        : start;
      const nextDate = new Date(lastExecution.getTime() + msPerPeriod);

      return { ...plan, expected, actualCount, totalInvested, adherence, nextDate, lastExecution };
    });
  }, [plans, transactions]);

  const FREQ_LABELS = { weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly', quarterly: 'Quarterly' };

  const inp = (field, props = {}) => React.createElement('input', {
    value: form[field], onChange: e => setForm(p => ({ ...p, [field]: e.target.value })),
    style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', width: '100%' },
    ...props
  });

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.25rem' } }, 'Savings Plans'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, 'Track your recurring investment plans and execution rate')
      ),
      React.createElement('button', {
        onClick: () => setShowAdd(!showAdd),
        style: { padding: '0.625rem 1.25rem', background: theme.accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.875rem' }
      }, '+ Add Plan')
    ),

    // Whole-portfolio projection (#6): composes current value + these savings
    // plans + dividends + recurring liabilities across 3 scenarios.
    window.MaerminProjection && React.createElement(window.MaerminProjection.Panel, {
      startValue: startValue || 0,
      savingsPlans: plans,
      dividendYield: dividendYield || 0,
      theme, formatPrice, getCurrencySymbol, t,
      scopeLabel: 'Portfolio'
    }),

    // Add Plan Form
    showAdd && React.createElement(Card, { theme, style: { marginBottom: '1.5rem', border: `1px solid ${theme.accent}44` } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '1rem' } }, 'New Savings Plan'),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '0.875rem' } },
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, 'Symbol'),
          inp('symbol', { placeholder: 'BTC, ETH, AAPL...' })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, 'Amount per execution (€)'),
          inp('amount', { type: 'number', placeholder: '100' })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, 'Frequency'),
          React.createElement('select', {
            value: form.frequency, onChange: e => setForm(p => ({ ...p, frequency: e.target.value })),
            style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', width: '100%' }
          },
            Object.entries(FREQ_LABELS).map(([v, l]) => React.createElement('option', { key: v, value: v }, l))
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, 'Start Date'),
          inp('startDate', { type: 'date' })
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
        React.createElement('button', { onClick: addPlan, style: { padding: '0.625rem 1.25rem', background: theme.accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.875rem' } }, 'Add Plan'),
        React.createElement('button', { onClick: () => setShowAdd(false), style: { padding: '0.625rem 1.25rem', background: theme.inputBg, color: theme.text, border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' } }, 'Cancel')
      )
    ),

    // Plans list
    plans.length === 0
      ? React.createElement(Card, { theme, style: { textAlign: 'center', padding: '3rem' } },
          React.createElement('div', { style: { color: theme.textSecondary, marginBottom: '0.5rem', fontSize: '1.5rem' } }, '◎'),
          React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.25rem' } }, 'No savings plans yet'),
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, 'Add a recurring investment plan to track your execution rate')
        )
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1rem' } },
          planStats.map(plan =>
            React.createElement(Card, { key: plan.id, theme },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' } },
                // Left: symbol + frequency
                React.createElement('div', null,
                  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' } },
                    React.createElement('span', { style: { color: theme.text, fontWeight: '800', fontSize: '1.1rem' } }, plan.symbol),
                    React.createElement('span', { style: { fontSize: '0.7rem', padding: '0.15rem 0.5rem', background: `${theme.accent}22`, color: theme.accent, borderRadius: '4px', fontWeight: '600' } }, FREQ_LABELS[plan.frequency]),
                    React.createElement('span', { style: { fontSize: '0.7rem', color: theme.textSecondary } }, `€${plan.amount.toFixed(0)}/execution`)
                  ),
                  React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.78rem' } }, `Started ${plan.startDate} · Next ~${plan.nextDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`)
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
                      React.createElement('span', { style: { color: theme.text, fontWeight: '800', fontSize: '0.8rem', lineHeight: 1 } }, `${plan.adherence}%`),
                      React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.55rem' } }, 'rate')
                    )
                  )
                )
              ),
              // Stats row
              React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem', marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${theme.cardBorder}` } },
                [
                  { label: 'Executed', value: plan.actualCount },
                  { label: 'Expected', value: plan.expected },
                  { label: 'Missed', value: Math.max(0, plan.expected - plan.actualCount), color: Math.max(0, plan.expected - plan.actualCount) > 0 ? '#ef4444' : '#22c55e' },
                  { label: 'Total Invested', value: `${formatPrice(plan.totalInvested)} ${getCurrencySymbol()}` },
                ].map((s, i) =>
                  React.createElement('div', { key: i },
                    React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, s.label),
                    React.createElement('div', { style: { color: s.color || theme.text, fontWeight: '700', fontSize: '1rem', marginTop: '0.125rem' } }, s.value)
                  )
                )
              ),
              // Delete button
              React.createElement('div', { style: { marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' } },
                React.createElement('button', {
                  onClick: () => setPlans(prev => prev.filter(p => p.id !== plan.id)),
                  style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '0.78rem' }
                }, '× Remove plan')
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
function DividendForecastView({ transactions, portfolio, prices, theme, formatPrice, getCurrencySymbol }) {
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
  }, [dividends, portfolio, prices]);

  const isEstimated = forecasts.length > 0 && forecasts.every(f => f.source === 'estimated');

  // Build multi-year monthly forecast
  const monthlyForecast = useMemo(() => {
    const months = [];
    const now = new Date();
    const totalMonths = forecastYears * 12;
    for (let i = 0; i < totalMonths; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push({ date: d, year: d.getFullYear(), label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }), amount: 0, items: [] });
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
      React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1rem' } }, 'Dividend Forecast'),
      React.createElement(Card, { theme, style: { textAlign: 'center', padding: '3rem' } },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.4 } }, '◎'),
        React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.5rem' } }, 'No dividend data yet'),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem', maxWidth: 360, margin: '0 auto' } },
          'Add dividend transactions, or hold recognised dividend stocks (an FMP API key in Settings expands coverage beyond the built-in list).'
        )
      )
    );
  }

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header + year selector
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.25rem' } }, 'Dividend Forecast'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.8rem' } },
          isEstimated ? 'Estimated from current holdings × known dividend rates' : 'Projected from your recorded dividend frequency and amount')
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
              background: forecastYears === y ? theme.accent : 'transparent',
              color: forecastYears === y ? '#13110a' : theme.textSecondary
            }
          }, `${y}Y`)
        )
      )
    ),

    // KPI cards
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      React.createElement(StatCell, { theme, label: `${forecastYears}Y Total Forecast`, value: `${formatPrice(totalForecast)} ${getCurrencySymbol()}`, color: '#22c55e' }),
      React.createElement(StatCell, { theme, label: 'Per Year (avg)', value: `${formatPrice(totalForecast / forecastYears)} ${getCurrencySymbol()}` }),
      React.createElement(StatCell, { theme, label: 'Monthly Average', value: `${formatPrice(totalForecast / (forecastYears * 12))} ${getCurrencySymbol()}` }),
      React.createElement(StatCell, { theme, label: 'Dividend Sources', value: forecasts.length })
    ),

    // Annual summary table
    forecastYears > 1 && React.createElement(Card, { theme, style: { marginBottom: '1.5rem' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem', marginBottom: '1rem' } }, 'Annual Summary'),
      React.createElement('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' } },
        byYear.map(({ year, total }) =>
          React.createElement('div', { key: year, style: { flex: '1 1 120px', textAlign: 'center', padding: '0.875rem', background: theme.inputBg, borderRadius: '10px', border: `1px solid ${theme.cardBorder}` } },
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.375rem' } }, year),
            React.createElement('div', { style: { color: '#22c55e', fontWeight: '800', fontSize: '1.1rem' } }, `${formatPrice(total)} ${getCurrencySymbol()}`)
          )
        )
      )
    ),

    // Monthly bar chart (show up to 24 months at a time, scrollable)
    React.createElement(Card, { theme, style: { marginBottom: '1.5rem', overflow: 'auto' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem', marginBottom: '1rem' } },
        forecastYears <= 2 ? 'Monthly Breakdown' : 'Monthly Breakdown (first 24 months)'
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
              m.date.toLocaleDateString('en-US', { month: 'short' })
            )
          );
        })
      )
    ),

    // Per-symbol breakdown
    React.createElement(Card, { theme },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.875rem' } }, 'By Source (annual rate)'),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
        forecasts.map((f, i) =>
          React.createElement('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: theme.inputBg, borderRadius: '8px' } },
            React.createElement('div', null,
              React.createElement('span', { style: { color: theme.text, fontWeight: '700', marginRight: '0.5rem' } }, f.sym),
              React.createElement('span', { style: { fontSize: '0.68rem', color: theme.textSecondary, padding: '0.1rem 0.35rem', background: `${theme.accent}18`, borderRadius: '3px' } }, f.frequency)
            ),
            React.createElement('span', { style: { color: '#22c55e', fontWeight: '700', fontSize: '0.875rem' } }, `${formatPrice(f.annualRate)} ${getCurrencySymbol()}/yr`)
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
function calcFIFO(transactions) {
  // Returns { symbol: { realizedPnL, lots: [{buyDate, buyPrice, qty, sellDate, sellPrice, pnl}] } }
  const bySymbol = {};

  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

  sorted.forEach(tx => {
    const sym = ((tx.symbol || '') + '-' + (tx.category || 'crypto')).toLowerCase();
    if (!bySymbol[sym]) bySymbol[sym] = { symbol: tx.symbol, category: tx.category, buyQueue: [], realized: [], unrealizedQty: 0, unrealizedCost: 0 };
    const entry = bySymbol[sym];

    if (tx.type === 'buy') {
      entry.buyQueue.push({ date: tx.date, price: parseFloat(tx.price) || 0, qty: parseFloat(tx.quantity) || 0, remaining: parseFloat(tx.quantity) || 0 });
    } else if (tx.type === 'sell') {
      let remainingSell = parseFloat(tx.quantity) || 0;
      const sellPrice   = parseFloat(tx.price) || 0;
      while (remainingSell > 0.000001 && entry.buyQueue.length > 0) {
        const lot = entry.buyQueue[0];
        const usedQty = Math.min(lot.remaining, remainingSell);
        const pnl = usedQty * (sellPrice - lot.price);
        entry.realized.push({ buyDate: lot.date, buyPrice: lot.price, qty: usedQty, sellDate: tx.date, sellPrice, pnl });
        lot.remaining -= usedQty;
        remainingSell -= usedQty;
        if (lot.remaining < 0.000001) entry.buyQueue.shift();
      }
    }
  });

  // Compute unrealized cost basis from remaining lots
  Object.values(bySymbol).forEach(entry => {
    let qty = 0, cost = 0;
    entry.buyQueue.forEach(lot => { qty += lot.remaining; cost += lot.remaining * lot.price; });
    entry.unrealizedQty  = qty;
    entry.unrealizedCost = cost;
    entry.avgCostFIFO    = qty > 0 ? cost / qty : 0;
    entry.totalRealizedPnL = entry.realized.reduce((s, r) => s + r.pnl, 0);
  });

  return bySymbol;
}

function FIFOView({ transactions, prices, theme, formatPrice, getCurrencySymbol }) {
  const fifo = useMemo(() => calcFIFO(transactions), [transactions]);
  const [activeSymbol, setActiveSymbol] = useState(null);

  const entries = Object.values(fifo).filter(e => e.realized.length > 0 || e.unrealizedQty > 0.0001);
  const totalRealizedPnL = entries.reduce((s, e) => s + e.totalRealizedPnL, 0);

  if (entries.length === 0) return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1rem' } }, 'FIFO Cost Basis'),
    React.createElement(Card, { theme, style: { textAlign: 'center', padding: '3rem' } },
      React.createElement('div', { style: { color: theme.textSecondary } }, 'Add transactions to see FIFO cost basis analysis')
    )
  );

  const detail = activeSymbol ? fifo[activeSymbol] : null;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.25rem' } }, 'FIFO Cost Basis'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, 'First In, First Out — standard tax method in Germany')
      )
    ),

    // Summary
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      React.createElement(StatCell, { theme, label: 'Total Realized P&L', value: `${totalRealizedPnL >= 0 ? '+' : ''}${formatPrice(totalRealizedPnL)} ${getCurrencySymbol()}`,
        color: totalRealizedPnL >= 0 ? '#22c55e' : '#ef4444' }),
      React.createElement(StatCell, { theme, label: 'Positions', value: entries.length }),
      React.createElement(StatCell, { theme, label: 'Total Realized Lots', value: entries.reduce((s, e) => s + e.realized.length, 0) })
    ),

    // Position table
    React.createElement(Card, { theme, style: { marginBottom: '1rem', overflow: 'auto' } },
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: 550, fontSize: '0.82rem' } },
        React.createElement('thead', null,
          React.createElement('tr', null,
            ['Symbol', 'Avg Cost (FIFO)', 'Qty Held', 'Total Cost', 'Realized P&L', 'Lots'].map((h, i) =>
              React.createElement('th', { key: i, style: { padding: '0.625rem 0.875rem', textAlign: i > 0 ? 'right' : 'left', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: '600', textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: '0.05em', whiteSpace: 'nowrap' } }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          entries.map(e => {
            const sym = (e.symbol || '').toLowerCase();
            const key = sym + '-' + (e.category || 'crypto');
            const currentPrice = prices[e.symbol] || prices[sym] || 0;
            const unrealizedPnL = e.unrealizedQty * (currentPrice - e.avgCostFIFO);
            return React.createElement('tr', {
              key,
              ...window.MaerminUtils.clickable(() => setActiveSymbol(activeSymbol === key ? null : key)),
              'aria-label': 'Toggle lot details for ' + (e.symbol || key),
              'aria-expanded': activeSymbol === key,
              style: { borderBottom: `1px solid ${theme.cardBorder}`, cursor: 'pointer', transition: 'background 0.1s' },
              onMouseEnter: el => el.currentTarget.style.background = `${theme.accent}08`,
              onMouseLeave: el => el.currentTarget.style.background = 'transparent'
            },
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', color: theme.text, fontWeight: '700' } }, e.symbol),
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', color: theme.text, textAlign: 'right' } }, `${formatPrice(e.avgCostFIFO)} ${getCurrencySymbol()}`),
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', color: theme.text, textAlign: 'right' } }, e.unrealizedQty.toFixed(4)),
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', color: theme.textSecondary, textAlign: 'right' } }, `${formatPrice(e.unrealizedCost)} ${getCurrencySymbol()}`),
              React.createElement('td', { style: { padding: '0.75rem 0.875rem', textAlign: 'right', color: e.totalRealizedPnL >= 0 ? '#22c55e' : '#ef4444', fontWeight: '700' } },
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
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.875rem' } }, `${detail.symbol} — Realized Lots`),
      React.createElement('div', { style: { overflowX: 'auto' } },
        React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: 500 } },
          React.createElement('thead', null,
            React.createElement('tr', null,
              ['Buy Date', 'Sell Date', 'Qty', 'Buy Price', 'Sell Price', 'P&L'].map((h, i) =>
                React.createElement('th', { key: i, style: { padding: '0.5rem 0.75rem', textAlign: i > 1 ? 'right' : 'left', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: '600', textTransform: 'uppercase', fontSize: '0.65rem', whiteSpace: 'nowrap' } }, h)
              )
            )
          ),
          React.createElement('tbody', null,
            detail.realized.map((lot, i) =>
              React.createElement('tr', { key: i, style: { borderBottom: `1px solid ${theme.cardBorder}` } },
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.textSecondary } }, lot.buyDate),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.textSecondary } }, lot.sellDate),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.text, textAlign: 'right' } }, lot.qty.toFixed(4)),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.textSecondary, textAlign: 'right' } }, `${formatPrice(lot.buyPrice)}`),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.textSecondary, textAlign: 'right' } }, `${formatPrice(lot.sellPrice)}`),
                React.createElement('td', { style: { padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: '700', color: lot.pnl >= 0 ? '#22c55e' : '#ef4444' } },
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
  PortfolioSwitcher,
  SavingsPlanView,
  DividendForecastView,
  FIFOView,
  calcFIFO,
};

console.log('[OK] MAERMIN Features4 v9.0 — Multi-Portfolio, Sparplan, Dividenden-Prognose, FIFO');

})();
