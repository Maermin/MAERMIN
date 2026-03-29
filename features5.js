// ============================================================================
// MAERMIN v8.2 — Professional Analytics Features
// 1. Performance Period Selector  — 1D / 1W / 1M / YTD / 1Y / Max
// 2. Net Worth Dashboard          — Vermögen inkl. Cash, Immobilien, Schulden
// 3. Cashflow Chart               — Investiert vs. Portfoliowert über Zeit
// 4. Fee Analyzer                 — Gebührenanalyse total, pro Jahr, pro Asset
// ============================================================================
(function () {
'use strict';

const { useState, useEffect, useMemo, useRef } = React;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function Card({ theme, children, style = {} }) {
  return React.createElement('div', {
    style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '1.25rem', ...style }
  }, children);
}

function KpiCard({ theme, label, value, sub, color, badge }) {
  return React.createElement('div', {
    style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '1.25rem' }
  },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.375rem' } },
      React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em' } }, label),
      badge && React.createElement('span', {
        style: { fontSize: '0.68rem', fontWeight: '700', padding: '0.1rem 0.4rem', borderRadius: '4px',
          background: badge.pos ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: badge.pos ? '#22c55e' : '#ef4444' }
      }, badge.text)
    ),
    React.createElement('div', { style: { color: color || theme.text, fontSize: '1.6rem', fontWeight: '800', lineHeight: 1, letterSpacing: '-0.02em' } }, value),
    sub && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.78rem', marginTop: '0.25rem' } }, sub)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PERFORMANCE PERIOD SELECTOR
// Shows portfolio return % for: 1D, 1W, 1M, YTD, 1Y, Max
// Uses priceHistory snapshots — no extra API calls needed
// ─────────────────────────────────────────────────────────────────────────────
function PerformancePeriods({ portfolio, priceHistory, prices, theme, formatPrice, getCurrencySymbol }) {
  const [activePeriod, setActivePeriod] = useState('1M');

  const PERIODS = [
    { id: '1D',  label: '1D',  days: 1   },
    { id: '1W',  label: '1W',  days: 7   },
    { id: '1M',  label: '1M',  days: 30  },
    { id: 'YTD', label: 'YTD', days: null }, // special: since Jan 1
    { id: '1Y',  label: '1Y',  days: 365 },
    { id: 'Max', label: 'Max', days: null }, // all time
  ];

  // Build a timeline of total portfolio values from priceHistory
  const timeline = useMemo(() => {
    // Collect all unique timestamps
    const tsSet = new Set();
    Object.values(priceHistory).forEach(hist => hist.forEach(h => tsSet.add(h.timestamp)));
    const sortedTs = [...tsSet].sort();

    // All current positions
    const positions = [];
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        positions.push({ sym: (pos.symbol || pos.name || '').toLowerCase(), symOrig: pos.symbol || pos.name || '', amount: pos.amount || 0 });
      });
    });

    return sortedTs.map(ts => {
      let value = 0;
      positions.forEach(pos => {
        const hist = priceHistory[pos.sym] || priceHistory[pos.symOrig] || [];
        // Find the price at or before this timestamp
        const entry = [...hist].reverse().find(h => h.timestamp <= ts);
        if (entry) value += pos.amount * entry.price;
      });
      return { ts, value };
    }).filter(d => d.value > 0);
  }, [priceHistory, portfolio]);

  // Current value from live prices
  const currentValue = useMemo(() => {
    let v = 0;
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        const sym = (pos.symbol || pos.name || '');
        const p = prices[sym] || prices[sym.toLowerCase()] || pos.purchasePrice || 0;
        v += (pos.amount || 0) * p;
      });
    });
    return v;
  }, [portfolio, prices]);

  // Compute return for each period
  const periodData = useMemo(() => {
    const now = new Date();
    return PERIODS.map(p => {
      let startValue = null;
      if (p.id === 'YTD') {
        const jan1 = new Date(now.getFullYear(), 0, 1).toISOString();
        const snap = timeline.find(d => d.ts >= jan1);
        startValue = snap?.value ?? (timeline[0]?.value ?? null);
      } else if (p.id === 'Max') {
        startValue = timeline[0]?.value ?? null;
      } else {
        const cutoff = new Date(now - p.days * 86400000).toISOString();
        const snap = timeline.slice().reverse().find(d => d.ts <= cutoff);
        startValue = snap?.value ?? (timeline[0]?.value ?? null);
      }

      if (!startValue || startValue <= 0 || currentValue <= 0) {
        return { ...p, change: null, changePct: null };
      }
      const change    = currentValue - startValue;
      const changePct = (change / startValue) * 100;
      return { ...p, change, changePct, startValue };
    });
  }, [timeline, currentValue, PERIODS]);

  const active = periodData.find(p => p.id === activePeriod) || periodData[0];

  return React.createElement('div', {
    style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '14px', padding: '1.25rem', marginBottom: '1.5rem' }
  },
    // Header
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' } },
      React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, 'Performance by Period'),
      // Period buttons
      React.createElement('div', { style: { display: 'flex', gap: '0.25rem', background: theme.inputBg, borderRadius: '8px', padding: '0.2rem' } },
        periodData.map(p =>
          React.createElement('button', {
            key: p.id,
            onClick: () => setActivePeriod(p.id),
            style: {
              padding: '0.3rem 0.6rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: activePeriod === p.id ? '700' : '400',
              background: activePeriod === p.id ? theme.accent : 'transparent',
              color: activePeriod === p.id ? '#fff' : p.changePct !== null ? (p.changePct >= 0 ? '#22c55e' : '#ef4444') : theme.textSecondary,
              transition: 'all 0.1s'
            }
          }, p.label)
        )
      )
    ),

    // Active period detail
    active.changePct !== null
      ? React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1rem' } },
          React.createElement('span', {
            style: { fontSize: '2.25rem', fontWeight: '800', letterSpacing: '-0.03em',
              color: active.changePct >= 0 ? '#22c55e' : '#ef4444' }
          }, `${active.changePct >= 0 ? '+' : ''}${active.changePct.toFixed(2)}%`),
          React.createElement('span', {
            style: { fontSize: '1.1rem', fontWeight: '600', color: active.changePct >= 0 ? '#22c55e' : '#ef4444' }
          }, `${active.change >= 0 ? '+' : ''}${formatPrice(active.change)} ${getCurrencySymbol()}`)
        )
      : React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem', marginBottom: '1rem' } }, 'Not enough price history yet — refresh prices a few times'),

    // All periods mini-grid
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.5rem' } },
      periodData.map(p =>
        React.createElement('div', {
          key: p.id,
          onClick: () => setActivePeriod(p.id),
          style: {
            textAlign: 'center', padding: '0.5rem 0.25rem', borderRadius: '8px', cursor: 'pointer',
            background: activePeriod === p.id ? `${theme.accent}15` : 'transparent',
            border: `1px solid ${activePeriod === p.id ? theme.accent : 'transparent'}`,
            transition: 'all 0.1s'
          }
        },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.65rem', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, p.label),
          React.createElement('div', {
            style: { fontSize: '0.8rem', fontWeight: '700',
              color: p.changePct === null ? theme.textSecondary : p.changePct >= 0 ? '#22c55e' : '#ef4444' }
          }, p.changePct !== null ? `${p.changePct >= 0 ? '+' : ''}${p.changePct.toFixed(1)}%` : '—')
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. NET WORTH DASHBOARD
// Adds cash accounts, property, and liabilities to the portfolio value
// ─────────────────────────────────────────────────────────────────────────────
function NetWorthView({ portfolioStats, theme, formatPrice, getCurrencySymbol }) {
  const [accounts, setAccounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_networth_accounts') || '[]'); } catch { return []; }
  });
  const [showAdd, setShowAdd]   = useState(false);
  const [form, setForm]         = useState({ name: '', value: '', type: 'cash', currency: 'EUR' });

  useEffect(() => { localStorage.setItem('maermin_networth_accounts', JSON.stringify(accounts)); }, [accounts]);

  const TYPES = {
    cash:      { label: 'Cash / Savings',   color: '#22c55e', icon: '◈' },
    checking:  { label: 'Checking Account', color: '#3b82f6', icon: '◆' },
    property:  { label: 'Real Estate',      color: '#f59e0b', icon: '◉' },
    crypto_wallet: { label: 'Crypto Wallet', color: '#8b5cf6', icon: '◎' },
    other_asset: { label: 'Other Asset',    color: '#06b6d4', icon: '◇' },
    loan:      { label: 'Loan / Mortgage',  color: '#ef4444', icon: '◐' },
    credit:    { label: 'Credit Card',      color: '#ef4444', icon: '◑' },
    other_liability: { label: 'Other Liability', color: '#f97316', icon: '◒' },
  };

  const LIABILITIES = new Set(['loan','credit','other_liability']);

  const totalAssets      = accounts.filter(a => !LIABILITIES.has(a.type)).reduce((s,a) => s + parseFloat(a.value||0), 0);
  const totalLiabilities = accounts.filter(a => LIABILITIES.has(a.type)).reduce((s,a) => s + parseFloat(a.value||0), 0);
  const portfolioValue   = portfolioStats.totalValue;
  const netWorth         = portfolioValue + totalAssets - totalLiabilities;

  const addAccount = () => {
    if (!form.name || !form.value) return;
    setAccounts(prev => [...prev, { id: Date.now().toString(), ...form, value: parseFloat(form.value) }]);
    setForm({ name: '', value: '', type: 'cash', currency: 'EUR' });
    setShowAdd(false);
  };

  const inp = (field, props = {}) => React.createElement('input', {
    value: form[field], onChange: e => setForm(p => ({ ...p, [field]: e.target.value })),
    style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', width: '100%', boxSizing: 'border-box' },
    ...props
  });

  // Net worth bar: split into portfolio | cash | property | liabilities
  const barTotal = netWorth > 0 ? netWorth + totalLiabilities : 1;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.25rem' } }, 'Net Worth'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, 'Total wealth including investments, cash accounts, real estate and liabilities')
      ),
      React.createElement('button', {
        onClick: () => setShowAdd(!showAdd),
        style: { padding: '0.625rem 1.25rem', background: theme.accent, color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.875rem' }
      }, '+ Add Account')
    ),

    // KPI row
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      React.createElement(KpiCard, { theme, label: 'Net Worth', value: `${formatPrice(netWorth)} ${getCurrencySymbol()}`, color: netWorth >= 0 ? '#22c55e' : '#ef4444' }),
      React.createElement(KpiCard, { theme, label: 'Investment Portfolio', value: `${formatPrice(portfolioValue)} ${getCurrencySymbol()}`,
        badge: { pos: true, text: `${(portfolioValue / (netWorth + totalLiabilities) * 100).toFixed(0)}%` } }),
      React.createElement(KpiCard, { theme, label: 'Cash & Other Assets', value: `${formatPrice(totalAssets)} ${getCurrencySymbol()}` }),
      React.createElement(KpiCard, { theme, label: 'Total Liabilities', value: `${formatPrice(totalLiabilities)} ${getCurrencySymbol()}`, color: totalLiabilities > 0 ? '#ef4444' : theme.text }),
    ),

    // Visual net worth bar
    netWorth > 0 && React.createElement(Card, { theme, style: { marginBottom: '1.5rem' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem', marginBottom: '0.75rem' } }, 'Wealth Composition'),
      React.createElement('div', { style: { height: '20px', borderRadius: '10px', overflow: 'hidden', display: 'flex', background: theme.inputBg } },
        [
          { value: portfolioValue, color: '#8b5cf6', label: 'Portfolio' },
          { value: totalAssets,    color: '#22c55e', label: 'Cash & Assets' },
        ].filter(s => s.value > 0).map((s, i) =>
          React.createElement('div', { key: i, title: `${s.label}: ${formatPrice(s.value)}`,
            style: { width: `${s.value / barTotal * 100}%`, background: s.color, transition: 'width 0.4s' } })
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '1rem', marginTop: '0.625rem', flexWrap: 'wrap' } },
        [{ label: 'Portfolio', color: '#8b5cf6', value: portfolioValue },
         { label: 'Cash & Assets', color: '#22c55e', value: totalAssets },
         { label: 'Liabilities', color: '#ef4444', value: -totalLiabilities }].map((s, i) =>
          React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.78rem' } },
            React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: s.color } }),
            React.createElement('span', { style: { color: theme.textSecondary } }, s.label),
            React.createElement('span', { style: { color: s.value >= 0 ? theme.text : '#ef4444', fontWeight: '600' } }, `${formatPrice(Math.abs(s.value))} ${getCurrencySymbol()}`)
          )
        )
      )
    ),

    // Add account form
    showAdd && React.createElement(Card, { theme, style: { marginBottom: '1.5rem', border: `1px solid ${theme.accent}44` } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '1rem' } }, 'Add Account or Liability'),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '0.875rem' } },
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, 'Name'),
          inp('name', { placeholder: 'e.g. ING Tagesgeld, Mortgage...' })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, 'Type'),
          React.createElement('select', { value: form.type, onChange: e => setForm(p => ({ ...p, type: e.target.value })),
            style: { padding: '0.625rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', width: '100%' }
          }, Object.entries(TYPES).map(([v, t]) => React.createElement('option', { key: v, value: v }, t.label)))
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase' } }, `Value (${getCurrencySymbol()})`),
          inp('value', { type: 'number', placeholder: '10000' })
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
        React.createElement('button', { onClick: addAccount, style: { padding: '0.625rem 1.25rem', background: theme.accent, color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '0.875rem' } }, 'Add'),
        React.createElement('button', { onClick: () => setShowAdd(false), style: { padding: '0.625rem 1.25rem', background: theme.inputBg, color: theme.text, border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem' } }, 'Cancel')
      )
    ),

    // Account list
    accounts.length > 0 && React.createElement(Card, { theme },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.875rem' } }, 'Accounts & Liabilities'),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
        accounts.map(acc => {
          const typeInfo = TYPES[acc.type] || TYPES.other_asset;
          const isLiability = LIABILITIES.has(acc.type);
          return React.createElement('div', { key: acc.id,
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: theme.inputBg, borderRadius: '8px' }
          },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.625rem' } },
              React.createElement('span', { style: { color: typeInfo.color, fontSize: '0.9rem' } }, typeInfo.icon),
              React.createElement('div', null,
                React.createElement('div', { style: { color: theme.text, fontWeight: '600', fontSize: '0.875rem' } }, acc.name),
                React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem' } }, typeInfo.label)
              )
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } },
              React.createElement('span', { style: { color: isLiability ? '#ef4444' : '#22c55e', fontWeight: '700', fontSize: '0.9rem' } },
                `${isLiability ? '-' : '+'}${formatPrice(acc.value)} ${getCurrencySymbol()}`
              ),
              React.createElement('button', { onClick: () => setAccounts(prev => prev.filter(a => a.id !== acc.id)),
                style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '0.9rem', padding: '0.25rem' }
              }, '×')
            )
          );
        })
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CASHFLOW CHART
// Shows two lines: cumulative invested (from transactions) vs portfolio value (from priceHistory)
// Gap between lines = unrealized P&L at any point in time
// ─────────────────────────────────────────────────────────────────────────────
function CashflowChart({ transactions, priceHistory, portfolio, prices, theme, formatPrice, getCurrencySymbol }) {
  // Build cumulative invested timeline from transactions
  const investedSeries = useMemo(() => {
    const sorted = [...transactions]
      .filter(tx => tx.type === 'buy' || tx.type === 'sell')
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    let cumulative = 0;
    const points = [];
    sorted.forEach(tx => {
      const amount = (parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0);
      cumulative += tx.type === 'buy' ? amount : -amount;
      points.push({ date: tx.date, value: Math.max(0, cumulative) });
    });
    return points;
  }, [transactions]);

  // Build portfolio value timeline from priceHistory
  const valueSeries = useMemo(() => {
    const tsSet = new Set();
    Object.values(priceHistory).forEach(hist => hist.forEach(h => tsSet.add(h.timestamp)));
    const sorted = [...tsSet].sort();

    const positions = [];
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        positions.push({ sym: (pos.symbol || pos.name || '').toLowerCase(), amount: pos.amount || 0 });
      });
    });

    return sorted.map(ts => {
      let value = 0;
      positions.forEach(pos => {
        const hist = priceHistory[pos.sym] || [];
        const entry = [...hist].reverse().find(h => h.timestamp <= ts);
        if (entry) value += pos.amount * entry.price;
      });
      return { date: ts.split('T')[0] || ts.substring(0, 10), value };
    }).filter(d => d.value > 0);
  }, [priceHistory, portfolio]);

  if (investedSeries.length < 2 && valueSeries.length < 2) {
    return React.createElement(Card, { theme, style: { textAlign: 'center', padding: '3rem', marginBottom: '1.5rem' } },
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.9rem' } }, 'Add transactions and refresh prices a few times to see your cashflow chart')
    );
  }

  // Merge into single timeline for chart
  const allDates = [...new Set([
    ...investedSeries.map(p => p.date),
    ...valueSeries.map(p => p.date)
  ])].sort();

  // Forward-fill values
  const chartData = allDates.map(date => {
    const inv = [...investedSeries].reverse().find(p => p.date <= date);
    const val = [...valueSeries].reverse().find(p => p.date <= date);
    return { date, invested: inv?.value ?? 0, value: val?.value ?? 0 };
  }).filter(d => d.invested > 0 || d.value > 0);

  if (chartData.length < 2) return null;

  const W = 600, H = 200, PAD = { t: 16, r: 16, b: 32, l: 64 };
  const allVals   = chartData.flatMap(d => [d.invested, d.value]).filter(v => v > 0);
  const minV      = Math.min(...allVals) * 0.98;
  const maxV      = Math.max(...allVals) * 1.02;
  const range     = maxV - minV || 1;
  const toX       = i => PAD.l + (i / (chartData.length - 1)) * (W - PAD.l - PAD.r);
  const toY       = v => PAD.t + (1 - (v - minV) / range) * (H - PAD.t - PAD.b);

  const invPts   = chartData.map((d, i) => `${toX(i)},${toY(d.invested)}`).join(' ');
  const valPts   = chartData.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const lastInv  = chartData[chartData.length - 1].invested;
  const lastVal  = chartData[chartData.length - 1].value;
  const pnl      = lastVal - lastInv;
  const pnlPct   = lastInv > 0 ? (pnl / lastInv) * 100 : 0;
  const isUp     = pnl >= 0;

  // x-axis labels: first, mid, last
  const xIdxs = [0, Math.floor(chartData.length / 2), chartData.length - 1];

  return React.createElement(Card, { theme, style: { marginBottom: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' } },
      React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, 'Cash Flow — Invested vs. Portfolio Value'),
      React.createElement('span', {
        style: { fontSize: '0.85rem', fontWeight: '700', padding: '0.25rem 0.75rem', borderRadius: '6px',
          background: isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
          color: isUp ? '#22c55e' : '#ef4444' }
      }, `${isUp ? '+' : ''}${formatPrice(pnl)} (${pnlPct.toFixed(1)}%)`)
    ),
    React.createElement('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', style: { overflow: 'visible' } },
      // Grid
      [minV, (minV + maxV) / 2, maxV].map((v, i) =>
        React.createElement(React.Fragment, { key: i },
          React.createElement('line', { x1: PAD.l, y1: toY(v), x2: W - PAD.r, y2: toY(v), stroke: 'rgba(255,255,255,0.05)', strokeDasharray: '4,4', strokeWidth: 1 }),
          React.createElement('text', { x: PAD.l - 6, y: toY(v) + 4, textAnchor: 'end', fill: 'rgba(255,255,255,0.3)', fontSize: 10 }, formatPrice(v))
        )
      ),
      // Area between lines (P&L fill)
      React.createElement('polygon', {
        points: `${chartData.map((d,i) => `${toX(i)},${toY(d.invested)}`).join(' ')} ${chartData.map((d,i) => `${toX(chartData.length-1-i)},${toY(chartData[chartData.length-1-i].value)}`).join(' ')}`,
        fill: isUp ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'
      }),
      // Invested line (dashed)
      React.createElement('polyline', { points: invPts, fill: 'none', stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1.5, strokeDasharray: '5,3' }),
      // Value line
      React.createElement('polyline', { points: valPts, fill: 'none', stroke: isUp ? '#22c55e' : '#ef4444', strokeWidth: 2, strokeLinejoin: 'round' }),
      // X axis labels
      xIdxs.map(i =>
        React.createElement('text', { key: i, x: toX(i), y: H - 4, textAnchor: 'middle', fill: 'rgba(255,255,255,0.3)', fontSize: 10 },
          chartData[i].date
        )
      )
    ),
    // Legend
    React.createElement('div', { style: { display: 'flex', gap: '1.5rem', marginTop: '0.75rem', justifyContent: 'flex-end' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: theme.textSecondary } },
        React.createElement('div', { style: { width: 20, height: 2, background: 'rgba(255,255,255,0.35)', borderTop: '2px dashed rgba(255,255,255,0.35)' } }),
        `Invested: ${formatPrice(lastInv)} ${getCurrencySymbol()}`
      ),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: theme.textSecondary } },
        React.createElement('div', { style: { width: 20, height: 2, background: isUp ? '#22c55e' : '#ef4444' } }),
        `Value: ${formatPrice(lastVal)} ${getCurrencySymbol()}`
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. FEE ANALYZER
// Total fees, fee rate, by year, by category, by exchange/broker
// ─────────────────────────────────────────────────────────────────────────────
function FeeAnalyzer({ transactions, theme, formatPrice, getCurrencySymbol }) {
  const stats = useMemo(() => {
    const feeTxs = transactions.filter(tx => (parseFloat(tx.fees) || 0) > 0);
    const totalFees    = feeTxs.reduce((s, tx) => s + (parseFloat(tx.fees) || 0), 0);
    const totalInvested = transactions.filter(tx => tx.type === 'buy')
      .reduce((s, tx) => s + (parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0), 0);
    const feeRate      = totalInvested > 0 ? (totalFees / totalInvested) * 100 : 0;

    // By year
    const byYear = {};
    feeTxs.forEach(tx => {
      const y = (tx.date || '').substring(0, 4) || 'Unknown';
      if (!byYear[y]) byYear[y] = { fees: 0, count: 0 };
      byYear[y].fees  += parseFloat(tx.fees) || 0;
      byYear[y].count += 1;
    });

    // By category
    const byCategory = {};
    feeTxs.forEach(tx => {
      const cat = tx.category || 'crypto';
      if (!byCategory[cat]) byCategory[cat] = 0;
      byCategory[cat] += parseFloat(tx.fees) || 0;
    });

    // By exchange/broker (from tx.notes — first word)
    const byBroker = {};
    feeTxs.forEach(tx => {
      const note  = (tx.notes || '').trim();
      const broker = note.split(/[\s·]/)[0] || 'Unknown';
      if (!byBroker[broker]) byBroker[broker] = 0;
      byBroker[broker] += parseFloat(tx.fees) || 0;
    });

    // Average fee per transaction
    const avgFee = feeTxs.length > 0 ? totalFees / feeTxs.length : 0;

    return { totalFees, totalInvested, feeRate, byYear, byCategory, byBroker, avgFee, txCount: feeTxs.length };
  }, [transactions]);

  const CAT_COLORS = { crypto: '#f59e0b', stocks: '#3b82f6', skins: '#06b6d4', commodities: '#d97706' };

  const maxYear = Math.max(...Object.values(stats.byYear).map(y => y.fees), 1);

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.375rem' } }, 'Fee Analyzer'),
    React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem', marginBottom: '1.5rem' } }, 'Total cost of investing — transaction fees, exchange fees, and more'),

    // KPIs
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      React.createElement(KpiCard, { theme, label: 'Total Fees Paid', value: `${formatPrice(stats.totalFees)} ${getCurrencySymbol()}`, color: '#ef4444' }),
      React.createElement(KpiCard, { theme, label: 'Fee Rate', value: `${stats.feeRate.toFixed(3)}%`, sub: '% of total invested' }),
      React.createElement(KpiCard, { theme, label: 'Avg Fee / Trade', value: `${formatPrice(stats.avgFee)} ${getCurrencySymbol()}` }),
      React.createElement(KpiCard, { theme, label: 'Transactions with Fees', value: stats.txCount }),
    ),

    stats.totalFees === 0
      ? React.createElement(Card, { theme, style: { textAlign: 'center', padding: '2rem' } },
          React.createElement('div', { style: { color: theme.textSecondary } }, 'No fees recorded in your transactions yet. Add fees when entering transactions.')
        )
      : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' } },

          // By Year
          React.createElement(Card, { theme },
            React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem', marginBottom: '1rem' } }, 'Fees by Year'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.625rem' } },
              Object.entries(stats.byYear).sort((a,b) => b[0].localeCompare(a[0])).map(([year, data]) =>
                React.createElement('div', { key: year },
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem' } },
                    React.createElement('span', { style: { color: theme.text, fontWeight: '600' } }, year),
                    React.createElement('span', { style: { color: '#ef4444', fontWeight: '700' } }, `${formatPrice(data.fees)} ${getCurrencySymbol()}`)
                  ),
                  React.createElement('div', { style: { height: 6, background: theme.inputBg, borderRadius: 3, overflow: 'hidden' } },
                    React.createElement('div', { style: { height: '100%', width: `${data.fees / maxYear * 100}%`, background: '#ef4444', opacity: 0.7, borderRadius: 3 } })
                  )
                )
              )
            )
          ),

          // By Category
          React.createElement(Card, { theme },
            React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem', marginBottom: '1rem' } }, 'Fees by Asset Class'),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.625rem' } },
              Object.entries(stats.byCategory).sort((a,b) => b[1]-a[1]).map(([cat, fees]) => {
                const pct = stats.totalFees > 0 ? fees / stats.totalFees * 100 : 0;
                const color = CAT_COLORS[cat] || '#8b5cf6';
                return React.createElement('div', { key: cat },
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem' } },
                    React.createElement('span', { style: { color: theme.text, fontWeight: '600', textTransform: 'capitalize' } }, cat),
                    React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                      React.createElement('span', { style: { color: theme.textSecondary } }, `${pct.toFixed(1)}%`),
                      React.createElement('span', { style: { color, fontWeight: '700' } }, `${formatPrice(fees)} ${getCurrencySymbol()}`)
                    )
                  ),
                  React.createElement('div', { style: { height: 6, background: theme.inputBg, borderRadius: 3, overflow: 'hidden' } },
                    React.createElement('div', { style: { height: '100%', width: `${pct}%`, background: color, opacity: 0.7, borderRadius: 3 } })
                  )
                );
              })
            )
          ),

          // Top cost items
          React.createElement(Card, { theme, style: { gridColumn: 'span 2' } },
            React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem', marginBottom: '0.75rem' } }, 'Most Expensive Transactions'),
            React.createElement('div', { style: { overflowX: 'auto' } },
              React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 420 } },
                React.createElement('thead', null,
                  React.createElement('tr', null,
                    ['Date', 'Symbol', 'Type', 'Trade Value', 'Fee', 'Fee %'].map((h, i) =>
                      React.createElement('th', { key: i, style: { padding: '0.5rem 0.75rem', textAlign: i > 2 ? 'right' : 'left', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: '600', textTransform: 'uppercase', fontSize: '0.65rem', whiteSpace: 'nowrap' } }, h)
                    )
                  )
                ),
                React.createElement('tbody', null,
                  [...transactions]
                    .filter(tx => (parseFloat(tx.fees) || 0) > 0)
                    .sort((a, b) => (parseFloat(b.fees) || 0) - (parseFloat(a.fees) || 0))
                    .slice(0, 10)
                    .map((tx, i) => {
                      const fee      = parseFloat(tx.fees) || 0;
                      const trade    = (parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0);
                      const feeRate  = trade > 0 ? (fee / trade * 100).toFixed(3) : '—';
                      return React.createElement('tr', { key: i, style: { borderBottom: `1px solid ${theme.cardBorder}` } },
                        React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.textSecondary } }, tx.date),
                        React.createElement('td', { style: { padding: '0.5rem 0.75rem', color: theme.text, fontWeight: '600' } }, tx.symbol),
                        React.createElement('td', { style: { padding: '0.5rem 0.75rem' } },
                          React.createElement('span', { style: { color: tx.type === 'buy' ? '#22c55e' : '#ef4444', fontWeight: '600', fontSize: '0.72rem' } }, tx.type?.toUpperCase())
                        ),
                        React.createElement('td', { style: { padding: '0.5rem 0.75rem', textAlign: 'right', color: theme.textSecondary } }, `${formatPrice(trade)} ${getCurrencySymbol()}`),
                        React.createElement('td', { style: { padding: '0.5rem 0.75rem', textAlign: 'right', color: '#ef4444', fontWeight: '700' } }, `${formatPrice(fee)} ${getCurrencySymbol()}`),
                        React.createElement('td', { style: { padding: '0.5rem 0.75rem', textAlign: 'right', color: theme.textSecondary } }, typeof feeRate === 'string' ? `${feeRate}%` : '—')
                      );
                    })
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
window.MaerminFeatures5 = {
  PerformancePeriods,
  NetWorthView,
  CashflowChart,
  FeeAnalyzer,
};

console.log('[OK] MAERMIN Features5 v8.2 — Performance Periods, Net Worth, Cashflow, Fee Analyzer');

})();
