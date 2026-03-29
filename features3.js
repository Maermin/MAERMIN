// ============================================================================
// MAERMIN v8.0 — Advanced Portfolio Features
// 1. Benchmark Comparison     — portfolio vs BTC / S&P500 proxy / Gold
// 2. Position Detail Modal    — click any position for full breakdown
// 3. CAGR per Position        — annualized return column in positions table
// 4. Daily P&L Widget         — today's change on overview
// ============================================================================
(function () {
'use strict';

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function calcCAGR(invested, currentValue, purchaseDateStr) {
  if (!invested || invested <= 0 || !purchaseDateStr) return null;
  const start = new Date(purchaseDateStr);
  const now   = new Date();
  const years = (now - start) / (365.25 * 24 * 3600 * 1000);
  if (years < 0.01) return null;
  const ratio = currentValue / invested;
  if (ratio <= 0) return null;
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

function Badge({ value, suffix = '%', size = 'sm' }) {
  const pos = value >= 0;
  return React.createElement('span', {
    style: {
      padding: size === 'sm' ? '0.15rem 0.4rem' : '0.25rem 0.6rem',
      borderRadius: '5px',
      fontSize: size === 'sm' ? '0.72rem' : '0.85rem',
      fontWeight: '700',
      background: pos ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
      color: pos ? '#22c55e' : '#ef4444',
      whiteSpace: 'nowrap'
    }
  }, `${pos ? '+' : ''}${value.toFixed(2)}${suffix}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. BENCHMARK COMPARISON
// Compare portfolio total return % vs BTC, ETH, Gold proxy
// Uses priceHistory (already collected) to compute reference returns
// ─────────────────────────────────────────────────────────────────────────────
function BenchmarkWidget({ portfolio, prices, priceHistory, transactions, theme, formatPrice, getCurrencySymbol }) {
  // Compute portfolio total return %
  const portfolioReturn = useMemo(() => {
    let totalInvested = 0, totalValue = 0;
    ['crypto','stocks','skins'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        const sym = (pos.symbol || pos.name || '');
        const price = prices[sym] || prices[sym.toLowerCase()] || pos.purchasePrice || 0;
        totalInvested += (pos.amount || 0) * (pos.purchasePrice || 0);
        totalValue    += (pos.amount || 0) * price;
      });
    });
    return totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : null;
  }, [portfolio, prices]);

  // BTC return from priceHistory
  const btcReturn = useMemo(() => {
    const hist = priceHistory['bitcoin'] || priceHistory['btc'] || [];
    if (hist.length < 2) return null;
    const first = hist[0].price, last = hist[hist.length - 1].price;
    return first > 0 ? ((last - first) / first) * 100 : null;
  }, [priceHistory]);

  // ETH return
  const ethReturn = useMemo(() => {
    const hist = priceHistory['ethereum'] || priceHistory['eth'] || [];
    if (hist.length < 2) return null;
    const first = hist[0].price, last = hist[hist.length - 1].price;
    return first > 0 ? ((last - first) / first) * 100 : null;
  }, [priceHistory]);

  const benchmarks = [
    { label: 'Your Portfolio', value: portfolioReturn, color: theme.accent, primary: true },
    { label: 'Bitcoin',        value: btcReturn,       color: '#f59e0b' },
    { label: 'Ethereum',       value: ethReturn,       color: '#6366f1' },
  ].filter(b => b.value !== null);

  if (benchmarks.length < 2) return null;

  const absMax = Math.max(...benchmarks.map(b => Math.abs(b.value)), 1);

  const card = (style) => ({ ...style });

  return React.createElement('div', {
    style: {
      background: theme.card,
      border: `1px solid ${theme.cardBorder}`,
      borderRadius: '14px',
      padding: '1.25rem',
      marginBottom: '1.5rem'
    }
  },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
      React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, 'Benchmark Comparison'),
      React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.75rem' } }, 'Since first price refresh')
    ),
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' } },
      benchmarks.map((b, i) => {
        const barPct = Math.abs(b.value) / absMax * 100;
        const isPos  = b.value >= 0;
        return React.createElement('div', { key: i },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' } },
            React.createElement('span', {
              style: {
                color: b.primary ? theme.text : theme.textSecondary,
                fontSize: '0.82rem',
                fontWeight: b.primary ? '700' : '400'
              }
            }, b.label),
            React.createElement(Badge, { value: b.value })
          ),
          // Bar
          React.createElement('div', { style: { height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' } },
            React.createElement('div', {
              style: {
                height: '100%',
                width: `${barPct}%`,
                background: isPos ? b.color : '#ef4444',
                borderRadius: '3px',
                transition: 'width 0.5s ease',
                opacity: b.primary ? 1 : 0.6
              }
            })
          )
        );
      })
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DAILY P&L WIDGET
// Uses the two most recent priceHistory entries to show today's change
// ─────────────────────────────────────────────────────────────────────────────
function DailyPnLCard({ portfolio, priceHistory, theme, formatPrice, getCurrencySymbol }) {
  const { todayValue, yesterdayValue, change, changePct } = useMemo(() => {
    // Collect last 2 price snapshots per symbol
    let todayVal = 0, yesterdayVal = 0;
    ['crypto','stocks','skins'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        const sym   = (pos.symbol || pos.name || '').toLowerCase();
        const hist  = priceHistory[sym] || priceHistory[pos.symbol] || [];
        if (hist.length < 2) return;
        const last   = hist[hist.length - 1].price;
        const prev   = hist[hist.length - 2].price;
        todayVal     += (pos.amount || 0) * last;
        yesterdayVal += (pos.amount || 0) * prev;
      });
    });
    const change    = todayVal - yesterdayVal;
    const changePct = yesterdayVal > 0 ? (change / yesterdayVal) * 100 : 0;
    return { todayValue: todayVal, yesterdayValue: yesterdayVal, change, changePct };
  }, [portfolio, priceHistory]);

  if (yesterdayValue <= 0) return null;

  const isPos = change >= 0;
  const color = isPos ? '#22c55e' : '#ef4444';

  return React.createElement('div', {
    style: {
      background: theme.card,
      border: `1px solid ${isPos ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
      borderRadius: '12px',
      padding: '1.5rem',
      flex: '1',
      minWidth: '180px'
    }
  },
    React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginBottom: '0.375rem' } }, "Today's Change"),
    React.createElement('div', { style: { color, fontSize: '1.6rem', fontWeight: '800', lineHeight: 1, marginBottom: '0.25rem' } },
      `${isPos ? '+' : ''}${formatPrice(change)} ${getCurrencySymbol()}`
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
      React.createElement(Badge, { value: changePct, size: 'sm' }),
      React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.72rem' } }, 'vs last refresh')
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. POSITION DETAIL MODAL
// Click any position → full breakdown: all transactions, avg cost, CAGR, fees
// ─────────────────────────────────────────────────────────────────────────────
function PositionDetailModal({ position, transactions, prices, theme, formatPrice, getCurrencySymbol, onClose }) {
  if (!position) return null;

  // Filter transactions for this position
  const posTxs = useMemo(() => {
    return (transactions || []).filter(tx => {
      const tSym = (tx.symbol || '').toLowerCase().trim();
      const pSym = (position.sym || '').toLowerCase().trim();
      return tSym === pSym && (tx.category || 'crypto') === position.cat;
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [transactions, position]);

  // Compute metrics
  const metrics = useMemo(() => {
    let totalBought = 0, totalSold = 0, totalInvested = 0, totalFees = 0;
    let firstBuyDate = null;
    posTxs.forEach(tx => {
      const qty = parseFloat(tx.quantity) || 0;
      const price = parseFloat(tx.price) || 0;
      const fees  = parseFloat(tx.fees) || 0;
      totalFees += fees;
      if (tx.type === 'buy') {
        totalBought   += qty;
        totalInvested += qty * price + fees;
        if (!firstBuyDate) firstBuyDate = tx.date;
      } else {
        totalSold += qty;
        totalInvested -= qty * price - fees;
      }
    });

    const currentPrice = prices[position.sym] || prices[position.sym?.toLowerCase()] || position.avgPrice;
    const currentValue = position.amount * currentPrice;
    const avgCost      = totalBought > 0 ? totalInvested / totalBought : position.avgPrice;
    const unrealizedPL = currentValue - (position.amount * avgCost);
    const unrealizedPct= (position.amount * avgCost) > 0 ? (unrealizedPL / (position.amount * avgCost)) * 100 : 0;
    const cagr         = calcCAGR(position.amount * avgCost, currentValue, firstBuyDate);

    return { totalBought, totalSold, totalInvested, totalFees, avgCost, currentPrice, currentValue, unrealizedPL, unrealizedPct, cagr, firstBuyDate };
  }, [posTxs, prices, position]);

  const row = (label, value, color = theme.text, mono = false) =>
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: `1px solid ${theme.cardBorder}` }
    },
      React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.82rem' } }, label),
      React.createElement('span', { style: { color, fontWeight: '600', fontSize: '0.875rem', fontFamily: mono ? 'monospace' : 'inherit' } }, value)
    );

  return React.createElement('div', {
    onClick: e => e.target === e.currentTarget && onClose(),
    style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '1rem' }
  },
    React.createElement('div', {
      style: { background: theme.modalBg, border: `1px solid ${theme.modalBorder}`, borderRadius: '16px', width: '520px', maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }
    },
      // Header
      React.createElement('div', {
        style: { padding: '1.25rem 1.5rem', borderBottom: `1px solid ${theme.modalBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
      },
        React.createElement('div', null,
          React.createElement('div', { style: { color: theme.text, fontWeight: '800', fontSize: '1.25rem' } }, position.sym),
          React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.25rem', alignItems: 'center' } },
            React.createElement('span', {
              style: { fontSize: '0.65rem', fontWeight: '700', padding: '0.15rem 0.4rem', borderRadius: '4px',
                background: position.cat === 'crypto' ? 'rgba(245,158,11,0.15)' : position.cat === 'stocks' ? 'rgba(59,130,246,0.15)' : 'rgba(6,182,212,0.15)',
                color: position.cat === 'crypto' ? '#f59e0b' : position.cat === 'stocks' ? '#3b82f6' : '#06b6d4' }
            }, position.cat.toUpperCase()),
            React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.8rem' } },
              metrics.firstBuyDate ? `Since ${metrics.firstBuyDate}` : ''
            )
          )
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.textSecondary, cursor: 'pointer', padding: '0.4rem 0.75rem', fontSize: '0.875rem' }
        }, '×')
      ),

      // Key metrics grid
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: theme.modalBorder, borderBottom: `1px solid ${theme.modalBorder}` }
      },
        [
          { label: 'Current Value',    value: `${formatPrice(metrics.currentValue)} ${getCurrencySymbol()}`, big: true },
          { label: 'Unrealized P&L',   value: `${metrics.unrealizedPL >= 0 ? '+' : ''}${formatPrice(metrics.unrealizedPL)} ${getCurrencySymbol()}`,
            color: metrics.unrealizedPL >= 0 ? '#22c55e' : '#ef4444', big: true },
          { label: 'Avg Cost',         value: `${formatPrice(metrics.avgCost)} ${getCurrencySymbol()}` },
          { label: 'Current Price',    value: `${formatPrice(metrics.currentPrice)} ${getCurrencySymbol()}` },
          { label: 'Total Return',     value: `${metrics.unrealizedPct >= 0 ? '+' : ''}${metrics.unrealizedPct.toFixed(2)}%`,
            color: metrics.unrealizedPct >= 0 ? '#22c55e' : '#ef4444' },
          { label: 'CAGR (annualized)', value: metrics.cagr !== null ? `${metrics.cagr >= 0 ? '+' : ''}${metrics.cagr.toFixed(2)}%` : '—',
            color: metrics.cagr !== null ? (metrics.cagr >= 0 ? '#22c55e' : '#ef4444') : theme.textSecondary },
          { label: 'Total Invested',   value: `${formatPrice(metrics.totalInvested)} ${getCurrencySymbol()}` },
          { label: 'Total Fees Paid',  value: `${formatPrice(metrics.totalFees)} ${getCurrencySymbol()}` },
        ].map((m, i) =>
          React.createElement('div', {
            key: i,
            style: { background: theme.modalBg, padding: '0.875rem 1.25rem' }
          },
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, m.label),
            React.createElement('div', { style: { color: m.color || theme.text, fontWeight: m.big ? '800' : '700', fontSize: m.big ? '1.1rem' : '0.9rem' } }, m.value)
          )
        )
      ),

      // Transaction history
      React.createElement('div', { style: { padding: '1.25rem 1.5rem' } },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem', marginBottom: '0.75rem' } },
          `Transaction History (${posTxs.length})`
        ),
        posTxs.length === 0
          ? React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', textAlign: 'center', padding: '1rem' } }, 'No transactions found')
          : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px' } },
              posTxs.map((tx, i) => {
                const qty = parseFloat(tx.quantity) || 0;
                const price = parseFloat(tx.price) || 0;
                const fees  = parseFloat(tx.fees) || 0;
                const total = qty * price + (tx.type === 'buy' ? fees : -fees);
                return React.createElement('div', {
                  key: i,
                  style: {
                    display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr',
                    gap: '0.5rem', padding: '0.6rem 0',
                    borderBottom: `1px solid ${theme.cardBorder}`,
                    fontSize: '0.8rem', alignItems: 'center'
                  }
                },
                  React.createElement('span', {
                    style: {
                      padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '700', textAlign: 'center',
                      background: tx.type === 'buy' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                      color: tx.type === 'buy' ? '#22c55e' : '#ef4444'
                    }
                  }, tx.type?.toUpperCase()),
                  React.createElement('span', { style: { color: theme.textSecondary } }, tx.date),
                  React.createElement('span', { style: { color: theme.text } }, `${qty.toFixed(4)} @ ${formatPrice(price)}`),
                  React.createElement('span', { style: { color: theme.text, fontWeight: '600', textAlign: 'right' } },
                    `${formatPrice(total)} ${getCurrencySymbol()}`
                  )
                );
              })
            )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ENHANCED POSITIONS TABLE (with CAGR + clickable rows)
// Wraps PositionsTable and adds CAGR column + click handler
// ─────────────────────────────────────────────────────────────────────────────
function EnhancedPositionsTable({ portfolio, prices, priceHistory, transactions, theme, formatPrice, getCurrencySymbol, t, onAddTransaction }) {
  const [detailPosition, setDetailPosition] = useState(null);
  const [sortKey, setSortKey]   = useState('value');
  const [sortDir, setSortDir]   = useState('desc');
  const [catFilter, setCatFilter] = useState('all');

  const CATEGORY_COLORS = {
    crypto: ['#f59e0b','#ef4444','#8b5cf6','#06b6d4','#22c55e','#f97316','#3b82f6','#ec4899','#14b8a6','#a78bfa'],
    stocks: ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#14b8a6','#a78bfa'],
    skins:  ['#06b6d4','#22c55e','#f59e0b','#ef4444','#8b5cf6','#3b82f6','#f97316','#ec4899','#14b8a6','#a78bfa'],
  };

  function Sparkline({ values, width = 60, height = 24 }) {
    if (!values || values.length < 2) return null;
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    }).join(' ');
    const isUp = values[values.length - 1] >= values[0];
    return React.createElement('svg', { width, height, style: { display: 'block' } },
      React.createElement('polyline', {
        points: pts, fill: 'none',
        stroke: isUp ? '#22c55e' : '#ef4444',
        strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round'
      })
    );
  }

  const positions = useMemo(() => {
    // Build iconUrl lookup from transactions metadata (set when user picks a skin)
    const iconBySymbol = {};
    (transactions || []).forEach(tx => {
      if (tx.category === 'skins' && tx.skinIconUrl && tx.symbol) {
        iconBySymbol[tx.symbol] = tx.skinIconUrl;
      }
    });

    const result = [];
    ['crypto','stocks','skins'].forEach((cat, ci) => {
      (portfolio[cat] || []).forEach((pos, pi) => {
        const sym  = (pos.symbol || pos.name || '');
        const symL = sym.toLowerCase();
        const price = prices[sym] || prices[symL] || prices[sym.toUpperCase()] || pos.purchasePrice || 0;
        const value    = (pos.amount || 1) * price;
        const invested = (pos.amount || 1) * (pos.purchasePrice || 0);
        const profit   = value - invested;
        const profitPct = invested > 0 ? (profit / invested) * 100 : 0;
        const cagr      = calcCAGR(invested, value, pos.purchaseDate);
        const history   = (priceHistory[symL] || priceHistory[sym] || []).slice(-20);
        result.push({
          sym, symL, price, value, invested, profit, profitPct, cagr, cat,
          amount: pos.amount,
          avgPrice: pos.purchasePrice || 0,
          purchaseDate: pos.purchaseDate,
          sparkVals: history.map(h => h.price),
          color: CATEGORY_COLORS[cat][pi % 10],
          iconUrl: iconBySymbol[sym] || null,
        });
      });
    });
    return result;
  }, [portfolio, prices, priceHistory, transactions]);

  const filtered = catFilter === 'all' ? positions : positions.filter(p => p.cat === catFilter);
  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (av === null || av === undefined) av = -Infinity;
    if (bv === null || bv === undefined) bv = -Infinity;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const totalValue  = filtered.reduce((s, p) => s + p.value, 0);
  const maxAbsProfit = Math.max(...filtered.map(p => Math.abs(p.profit)), 1);

  const th = (key, label, align = 'right') => {
    const active = sortKey === key;
    return React.createElement('th', {
      key,
      onClick: () => { if (active) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('desc'); } },
      style: {
        padding: '0.75rem 0.875rem', textAlign: align, cursor: 'pointer',
        color: active ? theme.accent : theme.textSecondary,
        borderBottom: `1px solid ${theme.cardBorder}`,
        fontSize: '0.72rem', fontWeight: '600', textTransform: 'uppercase',
        letterSpacing: '0.05em', userSelect: 'none', whiteSpace: 'nowrap'
      }
    }, label + (active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''));
  };

  const catColors = { crypto: '#f59e0b', stocks: '#3b82f6', skins: '#06b6d4' };
  const filterBtn = (v) => ({
    padding: '0.3rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: catFilter === v ? '700' : '400',
    background: catFilter === v ? theme.accent : theme.inputBg,
    color: catFilter === v ? '#fff' : theme.textSecondary
  });

  return React.createElement(React.Fragment, null,
    // Detail Modal
    detailPosition && React.createElement(PositionDetailModal, {
      position: detailPosition,
      transactions,
      prices,
      theme,
      formatPrice,
      getCurrencySymbol,
      onClose: () => setDetailPosition(null)
    }),

    // Table
    React.createElement('div', {
      style: { background: theme.card, borderRadius: '14px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', marginBottom: '1.5rem' }
    },
      // Header
      React.createElement('div', {
        style: { padding: '1rem 1.25rem', borderBottom: `1px solid ${theme.cardBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } },
          React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } },
            `${t.positions || 'Positions'} (${sorted.length})`
          ),
          React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.72rem' } }, 'Click any row for details')
        ),
        React.createElement('div', { style: { display: 'flex', gap: '0.25rem' } },
          ['all','crypto','stocks','skins'].map(v =>
            React.createElement('button', { key: v, style: filterBtn(v), onClick: () => setCatFilter(v) },
              v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)
            )
          )
        )
      ),

      sorted.length === 0
        ? React.createElement('div', { style: { padding: '2rem', textAlign: 'center', color: theme.textSecondary } }, 'No positions')
        : React.createElement('div', { style: { overflowX: 'auto' } },
            React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '780px' } },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  th('sym',       t.symbol||'Symbol',  'left'),
                  th('amount',    t.quantity||'Qty'),
                  th('avgPrice',  'Avg Cost'),
                  th('price',     t.price||'Price'),
                  th('value',     t.total||'Value'),
                  th('profit',    'P&L'),
                  th('profitPct', 'Return'),
                  th('cagr',      'CAGR/yr'),
                  React.createElement('th', {
                    style: { padding: '0.75rem 0.875rem', textAlign: 'right', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.72rem', fontWeight: '600', textTransform: 'uppercase' }
                  }, 'Trend'),
                  React.createElement('th', {
                    style: { padding: '0.75rem 0.875rem', textAlign: 'right', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.72rem', fontWeight: '600', textTransform: 'uppercase' }
                  }, 'Share')
                )
              ),
              React.createElement('tbody', null,
                sorted.map((p, i) => {
                  const share    = totalValue > 0 ? (p.value / totalValue) * 100 : 0;
                  const barWidth = maxAbsProfit > 0 ? Math.abs(p.profit) / maxAbsProfit * 100 : 0;
                  const cagrColor = p.cagr === null ? theme.textSecondary : p.cagr >= 0 ? '#22c55e' : '#ef4444';
                  return React.createElement('tr', {
                    key: p.sym + p.cat,
                    onClick: () => setDetailPosition(p),
                    style: { borderBottom: `1px solid ${theme.cardBorder}`, cursor: 'pointer', transition: 'background 0.1s' },
                    onMouseEnter: e => e.currentTarget.style.background = `${theme.accent}08`,
                    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
                  },
                    // Symbol + category badge + optional CS2 image (stored from SkinPicker)
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem' } },
                      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                        p.cat === 'skins' && p.iconUrl
                          // CS2: show stored skin image from when user picked it
                          ? React.createElement('img', {
                              src: p.iconUrl,
                              alt: p.sym,
                              onError: e => { e.target.style.display = 'none'; },
                              style: { width: 48, height: 28, objectFit: 'contain', borderRadius: '4px', background: 'rgba(0,0,0,0.2)', flexShrink: 0 }
                            })
                          // Crypto/Stocks/Skins without image: color dot
                          : React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 } }),
                        React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem' } }, p.sym),
                        React.createElement('span', {
                          style: { fontSize: '0.6rem', fontWeight: '700', padding: '0.1rem 0.3rem', borderRadius: '3px',
                            background: `${catColors[p.cat]}22`, color: catColors[p.cat] }
                        }, p.cat.slice(0,3).toUpperCase())
                      )
                    ),
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem', color: theme.text, textAlign: 'right', fontSize: '0.82rem' } },
                      p.amount?.toFixed?.(4)
                    ),
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem', color: theme.textSecondary, textAlign: 'right', fontSize: '0.82rem' } },
                      formatPrice(p.avgPrice)
                    ),
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem', color: theme.text, textAlign: 'right', fontWeight: '600', fontSize: '0.82rem' } },
                      p.price > 0 ? formatPrice(p.price) : React.createElement('span', { style: { color: theme.textSecondary } }, '—')
                    ),
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem', color: theme.text, textAlign: 'right', fontWeight: '700', fontSize: '0.875rem' } },
                      formatPrice(p.value)
                    ),
                    // P&L with mini bar
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem', textAlign: 'right' } },
                      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' } },
                        React.createElement('span', { style: { color: p.profit >= 0 ? '#22c55e' : '#ef4444', fontWeight: '600', fontSize: '0.8rem' } },
                          `${p.profit >= 0 ? '+' : ''}${formatPrice(p.profit)}`
                        ),
                        React.createElement('div', { style: { width: 48, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' } },
                          React.createElement('div', { style: { height: '100%', width: `${barWidth}%`, borderRadius: 2, background: p.profit >= 0 ? '#22c55e' : '#ef4444' } })
                        )
                      )
                    ),
                    // Return %
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem', textAlign: 'right' } },
                      React.createElement('span', { style: { color: p.profitPct >= 0 ? '#22c55e' : '#ef4444', fontWeight: '700', fontSize: '0.82rem' } },
                        `${p.profitPct >= 0 ? '+' : ''}${p.profitPct.toFixed(2)}%`
                      )
                    ),
                    // CAGR
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem', textAlign: 'right' } },
                      p.cagr !== null
                        ? React.createElement('span', { style: { color: cagrColor, fontWeight: '700', fontSize: '0.82rem' } },
                            `${p.cagr >= 0 ? '+' : ''}${p.cagr.toFixed(1)}%`
                          )
                        : React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.75rem' } }, '—')
                    ),
                    // Sparkline
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem', textAlign: 'right' } },
                      p.sparkVals.length > 1
                        ? React.createElement(Sparkline, { values: p.sparkVals, width: 60, height: 24 })
                        : React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.7rem' } }, '—')
                    ),
                    // Portfolio share
                    React.createElement('td', { style: { padding: '0.875rem 0.875rem', textAlign: 'right' } },
                      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' } },
                        React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.8rem' } }, `${share.toFixed(1)}%`),
                        React.createElement('div', { style: { width: 48, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' } },
                          React.createElement('div', { style: { height: '100%', width: `${share}%`, background: p.color, borderRadius: 2 } })
                        )
                      )
                    )
                  );
                })
              )
            )
          )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CS2 SKIN IMAGE — zeigt das Steam-CDN-Bild einer Position
// ─────────────────────────────────────────────────────────────────────────────
function CS2SkinImage({ name, size = 48, style = {} }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!name) return;
    // Build Steam Market thumbnail URL directly from the name
    const hash = encodeURIComponent(name);
    setSrc(`https://community.akamai.steamstatic.com/economy/image/class/730/${hash}/330x192`);
  }, [name]);

  if (err || !src) {
    return React.createElement('div', {
      style: {
        width: size, height: Math.round(size * 0.58), borderRadius: '6px',
        background: 'rgba(6,182,212,0.1)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0, ...style
      }
    }, React.createElement('span', { style: { fontSize: '0.6rem', color: 'rgba(6,182,212,0.5)' } }, 'CS2'));
  }

  return React.createElement('img', {
    src, alt: name, onError: () => setErr(true),
    style: { width: size, height: Math.round(size * 0.58), objectFit: 'contain', borderRadius: '6px', flexShrink: 0, ...style }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. CS2 SKIN PICKER
// Ersetzt das Symbol-Textfeld wenn Kategorie = skins
// Sucht über den Cloudflare Worker → Steam Market Search
// Zeigt Skin-Bilder, Preise, Rarity-Farben
// ─────────────────────────────────────────────────────────────────────────────
function CS2SkinPicker({ workerUrl, theme, onSelect, selectedName }) {
  const [query, setQuery]       = useState(selectedName || '');
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [open, setOpen]         = useState(false);
  const debounceRef             = useRef(null);

  // Search when query changes (debounced 400ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query === selectedName) { setResults([]); return; }

    debounceRef.current = setTimeout(async () => {
      if (!workerUrl) { setError('No Worker URL set — add it in ⚙ API Settings'); return; }
      setLoading(true); setError(null);
      try {
        const base = workerUrl.trim().replace(/\/$/, '');
        const url  = `${base}?action=search&q=${encodeURIComponent(query.trim())}`;
        const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error('Worker returned ' + res.status);
        const data = await res.json();
        if (Array.isArray(data)) {
          setResults(data);
          setOpen(true);
        } else {
          setError(data.error || 'Search failed');
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, [query, workerUrl]);

  const select = (item) => {
    setQuery(item.name);
    setResults([]);
    setOpen(false);
    onSelect({ name: item.name, price: item.price, image: item.image });
  };

  const RARITY_ORDER = ['Consumer Grade','Industrial Grade','Mil-Spec Grade','Restricted','Classified','Covert','Contraband','Extraordinary'];

  return React.createElement('div', { style: { position: 'relative' } },
    // Search input
    React.createElement('div', { style: { position: 'relative' } },
      React.createElement('input', {
        type: 'text',
        value: query,
        onChange: e => { setQuery(e.target.value); if (!e.target.value) { setResults([]); setOpen(false); } },
        onFocus: () => results.length > 0 && setOpen(true),
        placeholder: 'Search CS2 skins — e.g. AK-47 Redline...',
        style: {
          width: '100%', padding: '0.75rem 2.5rem 0.75rem 0.75rem',
          background: theme.inputBg, border: `1px solid ${theme.inputBorder}`,
          borderRadius: '8px', color: theme.text, fontSize: '0.875rem',
          boxSizing: 'border-box'
        }
      }),
      loading && React.createElement('div', {
        style: { position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: theme.textSecondary, fontSize: '0.75rem' }
      }, '...')
    ),

    // Error
    error && React.createElement('div', {
      style: { fontSize: '0.75rem', color: theme.danger || '#ef4444', marginTop: '0.25rem', padding: '0 0.25rem' }
    }, error),

    // Results dropdown
    open && results.length > 0 && React.createElement('div', {
      style: {
        position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 9999,
        background: theme.modalBg || theme.card,
        border: `1px solid ${theme.modalBorder || theme.cardBorder}`,
        borderRadius: '10px', overflow: 'hidden',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        maxHeight: '420px', overflowY: 'auto'
      }
    },
      // Header
      React.createElement('div', {
        style: { padding: '0.625rem 0.875rem', borderBottom: `1px solid ${theme.cardBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
      },
        React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.72rem' } }, `${results.length} results — click to select`),
        React.createElement('button', {
          onClick: () => setOpen(false),
          style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.25rem' }
        }, '×')
      ),

      // Grid of skins
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1px', background: theme.cardBorder }
      },
        results.map((item, i) =>
          React.createElement('div', {
            key: i,
            onClick: () => select(item),
            style: {
              background: theme.card, cursor: 'pointer', padding: '0.75rem',
              display: 'flex', flexDirection: 'column', gap: '0.375rem',
              transition: 'background 0.1s'
            },
            onMouseEnter: e => e.currentTarget.style.background = `${theme.accent}15`,
            onMouseLeave: e => e.currentTarget.style.background = theme.card
          },
            // Skin image
            item.image
              ? React.createElement('img', {
                  src: item.image, alt: item.name,
                  style: { width: '100%', aspectRatio: '330/192', objectFit: 'contain', borderRadius: '6px', background: 'rgba(0,0,0,0.3)' },
                  onError: e => { e.target.style.display = 'none'; }
                })
              : React.createElement('div', {
                  style: { width: '100%', aspectRatio: '330/192', background: 'rgba(6,182,212,0.08)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
                }, React.createElement('span', { style: { color: 'rgba(6,182,212,0.4)', fontSize: '0.7rem' } }, 'No image')),

            // Rarity bar
            item.rarityColor && React.createElement('div', {
              style: { height: '2px', borderRadius: '1px', background: item.rarityColor, opacity: 0.8 }
            }),

            // Name
            React.createElement('div', {
              style: { color: theme.text, fontSize: '0.72rem', fontWeight: '600', lineHeight: '1.3', wordBreak: 'break-word' }
            }, item.name),

            // Wear + Price row
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem' } },
              item.wear && React.createElement('span', {
                style: { fontSize: '0.65rem', color: theme.textSecondary, background: 'rgba(255,255,255,0.05)', padding: '0.1rem 0.3rem', borderRadius: '3px' }
              }, item.wear),
              item.price && React.createElement('span', {
                style: { fontSize: '0.75rem', fontWeight: '700', color: '#22c55e' }
              }, `€${item.price.toFixed(2)}`)
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
window.MaerminFeatures3 = {
  BenchmarkWidget,
  DailyPnLCard,
  PositionDetailModal,
  EnhancedPositionsTable,
  CS2SkinPicker,
  CS2SkinImage,
};

console.log('[OK] MAERMIN Features3 v8.0 loaded — Benchmark, Position Detail, CAGR, Daily P&L, CS2 Skin Picker');

})();
