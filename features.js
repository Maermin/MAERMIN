// ============================================================================
// MAERMIN v9.0 – Extended Features
// Implements: Portfolio Pie Chart, Sparklines, Watchlist, Price Alerts,
//             Performance Timeline, Gainers/Losers, Allocation Table,
//             Mobile Responsive Sidebar
// ============================================================================
(function () {
'use strict';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─────────────────────────────────────────────────────────────────────────────
// 1. SVG PIE / DONUT CHART  (no external lib needed)
// ─────────────────────────────────────────────────────────────────────────────
function PieChart({ slices, size = 160, thickness = 38, label, sublabel }) {
  // slices: [{ label, value, color }]
  const [hovered, setHovered] = useState(null);
  const total = slices.reduce((s, c) => s + c.value, 0);
  if (!total) return null;

  const cx = size / 2, cy = size / 2;
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  let cumulative = 0;
  const paths = slices.map((slice, i) => {
    const frac = slice.value / total;
    const offset = circumference * (1 - cumulative);
    const dash   = circumference * frac;
    cumulative  += frac;
    return { ...slice, frac, offset, dash, i };
  });

  return React.createElement('div', { style: { position: 'relative', width: size, height: size, flexShrink: 0 } },
    React.createElement('svg', { width: size, height: size, style: { transform: 'rotate(-90deg)' } },
      React.createElement('circle', {
        cx, cy, r,
        fill: 'none',
        stroke: 'rgba(255,255,255,0.05)',
        strokeWidth: thickness
      }),
      ...paths.map(p =>
        React.createElement('circle', {
          key: p.i,
          cx, cy, r,
          fill: 'none',
          stroke: p.color,
          strokeWidth: hovered === p.i ? thickness + 4 : thickness,
          strokeDasharray: `${p.dash} ${circumference - p.dash}`,
          strokeDashoffset: p.offset,
          style: { transition: 'stroke-width 0.15s', cursor: 'pointer', opacity: hovered !== null && hovered !== p.i ? 0.4 : 1 },
          onMouseEnter: () => setHovered(p.i),
          onMouseLeave: () => setHovered(null)
        })
      )
    ),
    // Center label
    React.createElement('div', {
      style: {
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        textAlign: 'center', pointerEvents: 'none'
      }
    },
      React.createElement('div', {
        style: { fontSize: '0.95rem', fontWeight: '700', color: hovered !== null ? paths[hovered]?.color : 'white', transition: 'color 0.15s' }
      }, hovered !== null ? `${(paths[hovered].frac * 100).toFixed(1)}%` : label),
      React.createElement('div', {
        style: { fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px', maxWidth: '70px', lineHeight: '1.2' }
      }, hovered !== null ? paths[hovered].label : sublabel)
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SPARKLINE  (SVG, single line)
// ─────────────────────────────────────────────────────────────────────────────
function Sparkline({ values, width = 80, height = 32, color }) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  const isUp = values[values.length - 1] >= values[0];
  const lineColor = color || (isUp ? '#22c55e' : '#ef4444');

  return React.createElement('svg', { width, height, style: { overflow: 'visible' } },
    React.createElement('polyline', {
      points: pts,
      fill: 'none',
      stroke: lineColor,
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    }),
    // Fill area
    React.createElement('polyline', {
      points: `0,${height} ${pts} ${width},${height}`,
      fill: lineColor,
      opacity: 0.12
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PORTFOLIO OVERVIEW mit Pie + Gainers/Losers + Sparklines
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORY_COLORS = {
  crypto:      ['#f59e0b','#ef4444','#3b82f6','#f5a524','#06b6d4','#10b981','#f97316','#ec4899','#84cc16','#14b8a6'],
  stocks:      ['#3b82f6','#f5a524','#06b6d4','#10b981','#f59e0b','#ef4444','#f97316','#ec4899','#84cc16','#14b8a6'],
  skins:       ['#06b6d4','#10b981','#f5a524','#f59e0b','#ef4444','#3b82f6','#f97316','#ec4899','#84cc16','#14b8a6'],
  commodities: ['#d97706','#f59e0b','#fbbf24','#92400e','#b45309','#78716c','#a16207','#ca8a04','#d97706','#f97316'],
};

function PortfolioOverviewPanel({ portfolio, prices, priceHistory, theme, formatPrice, getCurrencySymbol, t }) {
  const [activeTab, setActiveTab] = useState('overview'); // overview | crypto | stocks | skins

  // Build enriched positions
  const allPositions = useMemo(() => {
    const result = [];
    ['crypto','stocks','skins','commodities'].forEach((cat, catIdx) => {
      (portfolio[cat] || []).forEach((pos, posIdx) => {
        const sym = (pos.symbol || pos.name || '').toLowerCase();
        const symOrig = pos.symbol || pos.name || '';
        const price = prices[symOrig] || prices[sym] || prices[symOrig.toUpperCase()] || pos.purchasePrice || 0;
        const value = (pos.amount || 1) * price;
        const invested = (pos.amount || 1) * (pos.purchasePrice || 0);
        const profit = value - invested;
        const profitPct = invested > 0 ? (profit / invested) * 100 : 0;
        const history = priceHistory[sym] || priceHistory[symOrig] || [];
        const sparkValues = history.slice(-20).map(h => h.price);
        result.push({
          ...pos, cat, price, value, invested, profit, profitPct,
          sparkValues,
          color: CATEGORY_COLORS[cat][posIdx % 10]
        });
      });
    });
    return result.filter(p => p.value > 0);
  }, [portfolio, prices, priceHistory]);

  // Pie slices by asset class — uses the shared allocation engine (#5) so the
  // breakdown, ordering and colours match everywhere and carry absolute + %.
  // includeCash folds Net-Worth accounts (cash/checking/property/other) into the
  // total so the donut reflects the COMPLETE portfolio summed together, not just
  // the four tradable asset classes.
  const catSlices = useMemo(() => {
    if (window.MaerminAllocation) {
      const a = window.MaerminAllocation.computeAllocation(portfolio, prices, { includeCash: true });
      return a.byClass.map(c => ({ key: c.key, label: c.label, value: c.value, color: c.color, pct: c.pct }));
    }
    const map = { crypto: 0, stocks: 0, skins: 0, commodities: 0 };
    allPositions.forEach(p => { map[p.cat] += p.value; });
    const colors = { crypto: '#f59e0b', stocks: '#3b82f6', skins: '#06b6d4', commodities: '#f59e0b' };
    return Object.entries(map).filter(([,v]) => v > 0).map(([k, v]) => ({
      key: k, label: k.charAt(0).toUpperCase() + k.slice(1), value: v, color: colors[k]
    }));
  }, [portfolio, prices, allPositions]);

  // Position slices for drill-down
  const posSlices = useMemo(() => {
    const filtered = activeTab === 'overview' ? allPositions :
      allPositions.filter(p => p.cat === activeTab);
    return filtered.map(p => ({ label: p.symbol || p.name, value: p.value, color: p.color }));
  }, [allPositions, activeTab]);

  const topGainers = [...allPositions].sort((a,b) => b.profitPct - a.profitPct).slice(0,3);
  const topLosers  = [...allPositions].sort((a,b) => a.profitPct - b.profitPct).slice(0,3);

  const tabStyle = (id) => ({
    padding: '0.35rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: activeTab === id ? '700' : '400',
    background: activeTab === id ? theme.accent : 'transparent',
    color: activeTab === id ? '#13110a' : theme.textSecondary,
    transition: 'all 0.15s'
  });

  if (catSlices.length === 0) return null;

  // Whatever is on screen (asset classes on the overview tab, individual
  // positions when drilled into a class) drives the donut center label and the
  // legend percentages, so ring + center + percentages always sum consistently.
  const ASSET_TABS = ['crypto', 'stocks', 'skins', 'commodities'];
  const displayedSlices = activeTab === 'overview' ? catSlices : posSlices;
  const displayedTotal  = displayedSlices.reduce((s, x) => s + x.value, 0);
  const centerLabel     = formatPrice(displayedTotal);
  const centerSub       = activeTab === 'overview'
    ? (t.totalValue || 'Total Portfolio Value')
    : ((catSlices.find(c => c.key === activeTab) || {}).label || activeTab);

  return React.createElement('div', {
    style: {
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem'
    }
  },
    // Left: Pie + tabs
    React.createElement('div', {
      style: { background: theme.card, borderRadius: '14px', border: `1px solid ${theme.cardBorder}`, padding: '1.25rem' }
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
        React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, t.allocation || 'Allocation'),
        React.createElement('div', { style: { display: 'flex', gap: '0.25rem' } },
          ['overview','crypto','stocks','skins','commodities'].map(tab =>
            React.createElement('button', { key: tab, style: tabStyle(tab), onClick: () => setActiveTab(tab) },
              tab === 'overview' ? '◉' : tab.charAt(0).toUpperCase() + tab.slice(1)
            )
          )
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '1.5rem', alignItems: 'center' } },
        React.createElement(PieChart, {
          slices: displayedSlices,
          size: 150, thickness: 34,
          label: centerLabel,
          sublabel: centerSub
        }),
        React.createElement('div', { style: { flex: 1 } },
          displayedSlices.slice(0,8).map((s, i) => {
            // On the overview tab, clicking an asset class with position-level
            // data drills into it (cash/other have no per-position breakdown).
            const drillable = activeTab === 'overview' && ASSET_TABS.includes(s.key);
            return React.createElement('div', {
              key: i,
              ...(drillable ? window.MaerminUtils.clickable(() => setActiveTab(s.key)) : {}),
              'aria-label': drillable ? `Show ${s.label}` : undefined,
              title: drillable ? `Show ${s.label}` : undefined,
              style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', cursor: drillable ? 'pointer' : 'default' }
            },
              React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 } }),
              React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.75rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.label),
              // Absolute value + percentage of whatever total is on screen (#5),
              // so the legend always sums to 100% of the donut.
              React.createElement('span', { style: { color: theme.text, fontSize: '0.75rem', fontWeight: '600', whiteSpace: 'nowrap' } },
                `${formatPrice(s.value)} ${getCurrencySymbol()} · ${displayedTotal > 0 ? ((s.value / displayedTotal) * 100).toFixed(1) : 0}%`
              )
            );
          })
        )
      )
    ),

    // Right: Gainers & Losers
    React.createElement('div', {
      style: { background: theme.card, borderRadius: '14px', border: `1px solid ${theme.cardBorder}`, padding: '1.25rem' }
    },
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', height: '100%' } },
        // Gainers
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#22c55e', fontWeight: '700', fontSize: '0.8rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' } },
            '▲ ', t.topGainers || 'Top Gainers'
          ),
          topGainers.map((p, i) =>
            React.createElement('div', { key: i, style: { marginBottom: '0.6rem' } },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                React.createElement('span', { style: { color: theme.text, fontSize: '0.8rem', fontWeight: '600' } }, p.symbol || p.name),
                React.createElement('span', { style: { color: '#22c55e', fontSize: '0.8rem', fontWeight: '700' } },
                  `+${p.profitPct.toFixed(1)}%`
                )
              ),
              p.sparkValues.length > 1 && React.createElement(Sparkline, { values: p.sparkValues, width: 70, height: 24, color: '#22c55e' })
            )
          )
        ),
        // Losers
        React.createElement('div', null,
          React.createElement('div', { style: { color: '#ef4444', fontWeight: '700', fontSize: '0.8rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' } },
            '▼ ', t.topLosers || 'Top Losers'
          ),
          topLosers.filter(p => p.profitPct < 0).map((p, i) =>
            React.createElement('div', { key: i, style: { marginBottom: '0.6rem' } },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                React.createElement('span', { style: { color: theme.text, fontSize: '0.8rem', fontWeight: '600' } }, p.symbol || p.name),
                React.createElement('span', { style: { color: '#ef4444', fontSize: '0.8rem', fontWeight: '700' } },
                  `${p.profitPct.toFixed(1)}%`
                )
              ),
              p.sparkValues.length > 1 && React.createElement(Sparkline, { values: p.sparkValues, width: 70, height: 24, color: '#ef4444' })
            )
          )
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. WATCHLIST
// ─────────────────────────────────────────────────────────────────────────────
function WatchlistView({ prices, priceHistory, theme, t, addToast }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_watchlist') || '[]'); } catch { return []; }
  });
  const [newSymbol, setNewSymbol] = useState('');
  const [newCat, setNewCat] = useState('crypto');
  const [newTarget, setNewTarget] = useState('');

  useEffect(() => {
    localStorage.setItem('maermin_watchlist', JSON.stringify(items));
  }, [items]);

  const addItem = () => {
    const sym = newSymbol.trim().toLowerCase();
    if (!sym) return;
    if (items.find(i => i.symbol === sym)) {
      addToast && addToast('Already in watchlist', 'warning');
      return;
    }
    setItems(prev => [...prev, {
      id: Date.now().toString(),
      symbol: sym,
      displaySymbol: newSymbol.trim(),
      category: newCat,
      targetPrice: parseFloat(newTarget) || null,
      addedAt: new Date().toISOString()
    }]);
    setNewSymbol(''); setNewTarget('');
  };

  const removeItem = (id) => setItems(prev => prev.filter(i => i.id !== id));

  const inputStyle = {
    padding: '0.5rem 0.75rem',
    background: theme.inputBg,
    border: `1px solid ${theme.inputBorder}`,
    borderRadius: '8px',
    color: theme.text,
    fontSize: '0.875rem'
  };

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1.25rem' } },
      (t.watchlist || 'Watchlist')
    ),

    // Add row
    React.createElement('div', {
      style: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }
    },
      React.createElement('input', {
        type: 'text', value: newSymbol,
        onChange: e => setNewSymbol(e.target.value),
        onKeyDown: e => e.key === 'Enter' && addItem(),
        placeholder: 'bitcoin, AAPL, AK-47 | Redline...',
        style: { ...inputStyle, flex: '1', minWidth: '160px' }
      }),
      React.createElement('select', {
        value: newCat, onChange: e => setNewCat(e.target.value), style: inputStyle
      },
        React.createElement('option', { value: 'crypto' }, 'Crypto'),
        React.createElement('option', { value: 'stocks' }, 'Stocks'),
        React.createElement('option', { value: 'skins'  }, 'CS2')
      ),
      React.createElement('input', {
        type: 'number', value: newTarget,
        onChange: e => setNewTarget(e.target.value),
        placeholder: 'Target price (opt.)',
        style: { ...inputStyle, width: '150px' }
      }),
      React.createElement('button', {
        onClick: addItem,
        style: {
          padding: '0.5rem 1.25rem', background: theme.accent, color: '#13110a',
          border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600'
        }
      }, '+ Add')
    ),

    // List
    items.length === 0
      ? React.createElement('div', {
          style: { padding: '3rem', textAlign: 'center', color: theme.textSecondary,
            background: theme.card, borderRadius: '16px', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadow }
        },
          React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 } }, '○'),
          React.createElement('div', null, t.watchlistEmpty || 'Add symbols to track them here')
        )
      : React.createElement('div', {
          style: { background: theme.card, borderRadius: '16px', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadow, overflow: 'auto' }
        },
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '500px' } },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['Symbol','Category','Price','Change','Target','Spark',''].map((h,i) =>
                  React.createElement('th', {
                    key: i,
                    style: {
                      padding: '0.75rem 1rem', textAlign: i >= 2 && i <= 5 ? 'right' : i === 6 ? 'center' : 'left',
                      color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`,
                      fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em'
                    }
                  }, h)
                )
              )
            ),
            React.createElement('tbody', null,
              items.map(item => {
                const price = prices[item.symbol] || prices[item.displaySymbol] || 0;
                const history = (priceHistory[item.symbol] || priceHistory[item.displaySymbol] || []).slice(-20);
                const sparkVals = history.map(h => h.price);
                const prevPrice = sparkVals.length > 1 ? sparkVals[sparkVals.length - 2] : price;
                const changePct = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
                const atTarget = item.targetPrice && price >= item.targetPrice;

                return React.createElement('tr', {
                  key: item.id,
                  style: { background: atTarget ? 'rgba(34,197,94,0.05)' : 'transparent' }
                },
                  React.createElement('td', { style: { padding: '0.875rem 1rem' } },
                    React.createElement('div', { style: { fontWeight: '700', color: theme.text, fontSize: '0.9rem' } }, item.displaySymbol),
                    atTarget && React.createElement('div', { style: { color: '#22c55e', fontSize: '0.7rem', fontWeight: '600' } }, '◎ Target reached!')
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem' } },
                    React.createElement('span', {
                      style: {
                        padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600',
                        background: item.category === 'crypto' ? 'rgba(245,158,11,0.15)' :
                                    item.category === 'stocks' ? 'rgba(59,130,246,0.15)' : 'rgba(6,182,212,0.15)',
                        color: item.category === 'crypto' ? '#f59e0b' : item.category === 'stocks' ? '#3b82f6' : '#06b6d4'
                      }
                    }, item.category.toUpperCase())
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right', color: theme.text, fontWeight: '600' } },
                    price > 0 ? price.toFixed(2) : '—'
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right' } },
                    price > 0
                      ? React.createElement('span', {
                          style: { color: changePct >= 0 ? '#22c55e' : '#ef4444', fontWeight: '600', fontSize: '0.875rem' }
                        }, `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`)
                      : React.createElement('span', { style: { color: theme.textSecondary } }, '—')
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right', color: theme.textSecondary, fontSize: '0.875rem' } },
                    item.targetPrice ? item.targetPrice.toFixed(2) : '—'
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right' } },
                    sparkVals.length > 1
                      ? React.createElement(Sparkline, { values: sparkVals, width: 72, height: 28 })
                      : React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.75rem' } }, 'No data')
                  ),
                  React.createElement('td', { style: { padding: '0.5rem', textAlign: 'center' } },
                    React.createElement('button', {
                      onClick: () => removeItem(item.id),
                      style: {
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                        color: '#ef4444', borderRadius: '4px', cursor: 'pointer', padding: '0.25rem 0.5rem', fontSize: '0.75rem'
                      }
                    }, '×')
                  )
                );
              })
            )
          )
        )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PRICE ALERTS VIEW  (persistent, localStorage-based)
// ─────────────────────────────────────────────────────────────────────────────
function PriceAlertsView({ prices, theme, t, addToast, portfolio }) {
  const [alerts, setAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_alerts') || '[]'); } catch { return []; }
  });
  const [sym, setSym] = useState('');
  const [cond, setCond] = useState('above');
  const [price, setPrice] = useState('');

  useEffect(() => {
    localStorage.setItem('maermin_alerts', JSON.stringify(alerts));
  }, [alerts]);

  // Check alerts when prices update
  useEffect(() => {
    if (!Object.keys(prices).length) return;
    setAlerts(prev => prev.map(a => {
      const curr = prices[a.symbol.toLowerCase()] || prices[a.symbol] || 0;
      if (!curr || a.triggered) return a;
      const hit = a.condition === 'above' ? curr >= a.targetPrice : curr <= a.targetPrice;
      if (hit) {
        addToast && addToast(`${a.symbol}: ${a.condition === 'above' ? '≥' : '≤'} ${a.targetPrice.toFixed(2)}`, 'success');
        return { ...a, triggered: true, triggeredAt: new Date().toISOString(), triggeredPrice: curr };
      }
      return a;
    }));
  }, [prices]);

  const addAlert = () => {
    if (!sym.trim() || !price) return;
    setAlerts(prev => [...prev, {
      id: Date.now().toString(),
      symbol: sym.trim(),
      condition: cond,
      targetPrice: parseFloat(price),
      triggered: false,
      createdAt: new Date().toISOString()
    }]);
    setSym(''); setPrice('');
    addToast && addToast('Alert created', 'success');
  };

  const removeAlert = id => setAlerts(prev => prev.filter(a => a.id !== id));
  const resetAlert  = id => setAlerts(prev => prev.map(a => a.id === id ? { ...a, triggered: false, triggeredAt: null } : a));

  const inputStyle = {
    padding: '0.5rem 0.75rem', background: theme.inputBg,
    border: `1px solid ${theme.inputBorder}`, borderRadius: '8px',
    color: theme.text, fontSize: '0.875rem'
  };

  // Smart alerts (V7): portfolio-state alerts derived live from the shared
  // metrics (concentration, rebalancing drift, FIRE progress) plus upcoming
  // dividend ex-dates from the existing calendar store. No setup needed.
  const renderSmartAlerts = () => {
    const M = window.MaerminMetrics;
    if (!M || !portfolio) return null;
    const e = React.createElement;
    const conc = M.computeConcentration(portfolio, prices);
    const drift = M.computeRebalancingDrift(portfolio, prices);
    const pv = drift.available ? drift.total : 0;
    const fire = M.computeFireMetrics(M.computeNetWorth(pv).netWorth);
    let divEvents = [];
    try { divEvents = JSON.parse(localStorage.getItem('maermin_divevents') || '[]'); } catch (e2) {}
    const today = new Date().toISOString().slice(0, 10);
    const upcomingDiv = (divEvents || []).filter(d => d.date && d.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);

    const items = [];
    if (conc.available && conc.maxWeight > 0.3) {
      const top = conc.top && conc.top[0];
      items.push({ sev: 'danger', icon: '◑', title: t.alertConcentration || 'Concentration', msg: (t.alertConcentrationMsg || 'Largest position is {pct}% of the portfolio').replace('{pct}', (conc.maxWeight * 100).toFixed(0)) + (top ? ` (${top.symbol})` : '') });
    }
    if (drift.available && drift.maxDrift > 10) {
      const worst = drift.rows.slice().sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0];
      items.push({ sev: 'warning', icon: '◐', title: t.alertRebalance || 'Rebalancing', msg: (t.alertRebalanceMsg || 'Allocation has drifted {pct}% from target').replace('{pct}', Math.abs(worst.drift).toFixed(0)) });
    }
    if (fire.configured) {
      items.push({ sev: fire.progress >= 100 ? 'success' : 'info', icon: '◉', title: t.kpiFire || 'FIRE', msg: (t.alertFireMsg || 'FIRE progress: {pct}%').replace('{pct}', Math.min(100, fire.progress).toFixed(0)) });
    }
    upcomingDiv.forEach(d => {
      items.push({ sev: 'info', icon: '◎', title: t.alertDividend || 'Dividend', msg: `${d.symbol || ''} ${t.alertDivEx || 'ex-date'} ${d.date}` });
    });

    if (!items.length) return null;
    return e('div', { style: { marginBottom: '1.5rem' } },
      e('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' } }, t.smartAlerts || 'Smart alerts'),
      e('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
        items.map((it, i) => {
          const col = it.sev === 'danger' ? (theme.danger || '#ef4444') : it.sev === 'warning' ? (theme.warning || '#f59e0b') : it.sev === 'success' ? (theme.success || '#22c55e') : (theme.accent || '#f5a524');
          return e('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: theme.card, border: `1px solid ${theme.cardBorder}`, borderLeft: `4px solid ${col}`, borderRadius: '8px' } },
            e('span', { style: { color: col, fontSize: '1rem' } }, it.icon),
            e('div', null,
              e('div', { style: { color: theme.text, fontWeight: 600, fontSize: '0.85rem' } }, it.title),
              e('div', { style: { color: theme.textSecondary, fontSize: '0.8rem' } }, it.msg)));
        })
      )
    );
  };

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1.25rem' } },
      (t.priceAlerts || 'Price Alerts')
    ),

    // Smart alerts (computed from portfolio state)
    renderSmartAlerts(),

    // Create alert
    React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' } },
      React.createElement('input', {
        type: 'text', value: sym, onChange: e => setSym(e.target.value),
        placeholder: 'Symbol (e.g. bitcoin)', style: { ...inputStyle, flex: 1, minWidth: '140px' }
      }),
      React.createElement('select', { value: cond, onChange: e => setCond(e.target.value), style: inputStyle },
        React.createElement('option', { value: 'above' }, '≥ Price goes above'),
        React.createElement('option', { value: 'below' }, '≤ Price drops below')
      ),
      React.createElement('input', {
        type: 'number', value: price, onChange: e => setPrice(e.target.value),
        placeholder: 'Target price', style: { ...inputStyle, width: '140px' }
      }),
      React.createElement('button', {
        onClick: addAlert,
        style: { padding: '0.5rem 1.25rem', background: theme.accent, color: '#13110a', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }
      }, '+ Alert')
    ),

    // Alert list
    alerts.length === 0
      ? React.createElement('div', {
          style: { padding: '3rem', textAlign: 'center', color: theme.textSecondary, background: theme.card, borderRadius: '16px', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadow }
        },
          React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 } }, '◎'),
          'No price alerts set'
        )
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
          alerts.map(a => {
            const curr = prices[a.symbol.toLowerCase()] || prices[a.symbol] || 0;
            const progress = curr > 0 && a.targetPrice > 0
              ? Math.min(100, (a.condition === 'above' ? curr / a.targetPrice : a.targetPrice / curr) * 100)
              : 0;

            return React.createElement('div', {
              key: a.id,
              style: {
                background: a.triggered ? 'rgba(52,211,153,0.08)' : theme.card,
                border: `1px solid ${a.triggered ? 'rgba(52,211,153,0.3)' : theme.cardBorder}`,
                borderRadius: '14px', padding: '1rem 1.25rem', boxShadow: theme.shadow,
                display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'
              }
            },
              React.createElement('div', { style: { flex: 1, minWidth: '200px' } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' } },
                  React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, a.symbol.toUpperCase()),
                  React.createElement('span', {
                    style: {
                      fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '3px', fontWeight: '600',
                      background: a.condition === 'above' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: a.condition === 'above' ? '#22c55e' : '#ef4444'
                    }
                  }, a.condition === 'above' ? `≥ ${a.targetPrice.toFixed(2)}` : `≤ ${a.targetPrice.toFixed(2)}`)
                ),
                // Progress bar
                React.createElement('div', { style: { height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' } },
                  React.createElement('div', {
                    style: {
                      height: '100%', width: `${progress}%`, borderRadius: 2,
                      background: a.triggered ? '#22c55e' : theme.accent,
                      transition: 'width 0.5s ease'
                    }
                  })
                ),
                React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.75rem', marginTop: '0.25rem' } },
                  curr > 0 ? `Current: ${curr.toFixed(2)} · ${progress.toFixed(0)}% to target` : 'Waiting for price data',
                  a.triggered && ` · Triggered at ${parseFloat(a.triggeredPrice).toFixed(2)}`
                )
              ),
              React.createElement('div', { style: { display: 'flex', gap: '0.375rem' } },
                a.triggered && React.createElement('button', {
                  onClick: () => resetAlert(a.id),
                  style: { padding: '0.3rem 0.6rem', background: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }
                }, '↺ Reset'),
                React.createElement('button', {
                  onClick: () => removeAlert(a.id),
                  style: { padding: '0.3rem 0.6rem', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }
                }, '×')
              )
            );
          })
        )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. PERFORMANCE TIMELINE (SVG chart, portfolio total value over time)
// ─────────────────────────────────────────────────────────────────────────────
function PerformanceChart({ priceHistory, portfolio, theme, formatPrice, getCurrencySymbol }) {
  const data = useMemo(() => {
    // Collect all timestamps across all tracked assets
    const tsMap = {};
    Object.entries(priceHistory).forEach(([sym, hist]) => {
      hist.forEach(({ timestamp, price }) => {
        if (!tsMap[timestamp]) tsMap[timestamp] = {};
        tsMap[timestamp][sym] = price;
      });
    });

    const timestamps = Object.keys(tsMap).sort();
    if (timestamps.length < 2) return [];

    return timestamps.map(ts => {
      let totalValue = 0;
      ['crypto','stocks','skins','commodities'].forEach(cat => {
        (portfolio[cat] || []).forEach(pos => {
          const sym = (pos.symbol || pos.name || '').toLowerCase();
          const price = tsMap[ts][sym] || tsMap[ts][pos.symbol] || 0;
          if (price > 0) totalValue += (pos.amount || 1) * price;
        });
      });
      return { ts, value: totalValue };
    }).filter(d => d.value > 0);
  }, [priceHistory, portfolio]);

  if (data.length < 2) return React.createElement('div', {
    style: { padding: '2rem', textAlign: 'center', color: theme.textSecondary, background: theme.card, borderRadius: '16px', boxShadow: theme.shadow, border: `1px solid ${theme.cardBorder}` }
  },
    React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 } }, '↗'),
    'Performance chart will appear after refreshing prices a few times'
  );

  const W = 560, H = 180, PAD = { t: 16, r: 16, b: 32, l: 60 };
  const vals = data.map(d => d.value);
  const min = Math.min(...vals) * 0.99;
  const max = Math.max(...vals) * 1.01;
  const range = max - min || 1;

  const toX = i => PAD.l + ((i / (data.length - 1)) * (W - PAD.l - PAD.r));
  const toY = v => PAD.t + ((1 - (v - min) / range) * (H - PAD.t - PAD.b));

  const pts = data.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const firstVal = vals[0], lastVal = vals[vals.length - 1];
  const totalChange = lastVal - firstVal;
  const changePct = firstVal > 0 ? (totalChange / firstVal) * 100 : 0;
  const isUp = totalChange >= 0;
  const lineColor = isUp ? '#22c55e' : '#ef4444';

  // Y-axis labels
  const yLabels = [min, (min + max) / 2, max].map(v => ({
    y: toY(v),
    label: formatPrice(v)
  }));

  // X-axis labels – first, mid, last
  const xIndices = [0, Math.floor(data.length / 2), data.length - 1];

  return React.createElement('div', {
    style: { background: theme.card, borderRadius: '14px', border: `1px solid ${theme.cardBorder}`, padding: '1.25rem', marginBottom: '1.5rem' }
  },
    // Header
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
      React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, 'Portfolio Performance'),
      React.createElement('div', { style: { display: 'flex', gap: '1rem', alignItems: 'center' } },
        React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '1.1rem' } },
          `${formatPrice(lastVal)} ${getCurrencySymbol()}`
        ),
        React.createElement('span', {
          style: {
            padding: '0.2rem 0.6rem', borderRadius: '6px', fontWeight: '700', fontSize: '0.85rem',
            background: isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: isUp ? '#22c55e' : '#ef4444'
          }
        }, `${isUp ? '+' : ''}${changePct.toFixed(2)}%`)
      )
    ),
    // SVG chart
    React.createElement('svg', {
      viewBox: `0 0 ${W} ${H}`, width: '100%', style: { overflow: 'visible', maxWidth: W }
    },
      // Grid lines
      yLabels.map((yl, i) =>
        React.createElement(React.Fragment, { key: i },
          React.createElement('line', { x1: PAD.l, y1: yl.y, x2: W - PAD.r, y2: yl.y, stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1, strokeDasharray: '4,4' }),
          React.createElement('text', { x: PAD.l - 6, y: yl.y + 4, textAnchor: 'end', fill: 'rgba(255,255,255,0.35)', fontSize: 10 }, yl.label)
        )
      ),
      // X labels
      xIndices.map(i =>
        React.createElement('text', {
          key: i, x: toX(i), y: H - 4, textAnchor: 'middle',
          fill: 'rgba(255,255,255,0.35)', fontSize: 10
        }, data[i].ts)
      ),
      // Area fill
      React.createElement('polygon', {
        points: `${PAD.l},${toY(min)} ${pts} ${toX(data.length-1)},${toY(min)}`,
        fill: lineColor, opacity: 0.08
      }),
      // Line
      React.createElement('polyline', {
        points: pts, fill: 'none', stroke: lineColor, strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round'
      }),
      // Last point dot
      React.createElement('circle', {
        cx: toX(data.length - 1), cy: toY(lastVal), r: 4,
        fill: lineColor, stroke: 'white', strokeWidth: 1.5
      })
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. POSITIONS TABLE (sortable, with current price + P&L bar)
// ─────────────────────────────────────────────────────────────────────────────
function PositionsTable({ portfolio, prices, priceHistory, theme, formatPrice, getCurrencySymbol, t, onAddTransaction }) {
  const [sortKey, setSortKey] = useState('value');
  const [sortDir, setSortDir] = useState('desc');
  const [catFilter, setCatFilter] = useState('all');

  const positions = useMemo(() => {
    const result = [];
    ['crypto','stocks','skins','commodities'].forEach((cat, ci) => {
      (portfolio[cat] || []).forEach((pos, pi) => {
        const sym = (pos.symbol || pos.name || '');
        const symL = sym.toLowerCase();
        const price = prices[sym] || prices[symL] || prices[sym.toUpperCase()] || pos.purchasePrice || 0;
        const value = (pos.amount || 1) * price;
        const invested = (pos.amount || 1) * (pos.purchasePrice || 0);
        const profit = value - invested;
        const profitPct = invested > 0 ? (profit / invested) * 100 : 0;
        const history = (priceHistory[symL] || priceHistory[sym] || []).slice(-20);
        result.push({
          sym, symL, price, value, invested, profit, profitPct, cat,
          amount: pos.amount,
          avgPrice: pos.purchasePrice || 0,
          sparkVals: history.map(h => h.price),
          color: CATEGORY_COLORS[cat][pi % 10]
        });
      });
    });
    return result;
  }, [portfolio, prices, priceHistory]);

  const filtered = catFilter === 'all' ? positions : positions.filter(p => p.cat === catFilter);
  const sorted = [...filtered].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const totalValue = filtered.reduce((s, p) => s + p.value, 0);
  const maxAbsProfit = Math.max(...filtered.map(p => Math.abs(p.profit)), 1);

  const th = (key, label, align = 'right') => {
    const active = sortKey === key;
    const sort = () => { if (active) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(key); setSortDir('desc'); } };
    return React.createElement('th', {
      key,
      onClick: sort,
      tabIndex: 0,
      'aria-sort': active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
      onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } },
      style: {
        padding: '0.75rem 1rem', textAlign: align, cursor: 'pointer',
        color: active ? theme.accent : theme.textSecondary,
        borderBottom: `1px solid ${theme.cardBorder}`,
        fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em',
        userSelect: 'none', whiteSpace: 'nowrap'
      }
    }, label + (active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''));
  };

  const catColors = { crypto: '#f59e0b', stocks: '#3b82f6', skins: '#06b6d4', commodities: '#d97706' };
  const filterBtnStyle = (v) => ({
    padding: '0.3rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
    fontSize: '0.8rem', fontWeight: catFilter === v ? '700' : '400',
    background: catFilter === v ? theme.accent : theme.inputBg,
    color: catFilter === v ? '#fff' : theme.textSecondary
  });

  return React.createElement('div', {
    style: { background: theme.card, borderRadius: '14px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', marginBottom: '1.5rem' }
  },
    // Header
    React.createElement('div', {
      style: { padding: '1rem 1.25rem', borderBottom: `1px solid ${theme.cardBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }
    },
      React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } },
        `${t.positions || 'Positions'} (${sorted.length})`
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.25rem' } },
        ['all','crypto','stocks','skins','commodities'].map(v =>
          React.createElement('button', { key: v, style: filterBtnStyle(v), onClick: () => setCatFilter(v) },
            v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)
          )
        )
      )
    ),
    sorted.length === 0
      ? React.createElement('div', { style: { padding: '2rem', textAlign: 'center', color: theme.textSecondary } },
          'No positions'
        )
      : React.createElement('div', { style: { overflowX: 'auto' } },
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '700px' } },
            React.createElement('thead', null,
              React.createElement('tr', null,
                th('sym',      t.symbol||'Symbol',   'left'),
                th('cat',      'Cat',                'left'),
                th('amount',   t.quantity||'Qty'),
                th('avgPrice', 'Avg Cost'),
                th('price',    t.price||'Price'),
                th('value',    t.total||'Value'),
                th('profit',   'P&L'),
                th('profitPct','P&L %'),
                React.createElement('th', { style: { padding: '0.75rem 1rem', textAlign: 'right', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase' } }, 'Trend'),
                React.createElement('th', { style: { padding: '0.75rem 1rem', textAlign: 'right', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase' } }, 'Share')
              )
            ),
            React.createElement('tbody', null,
              sorted.map((p, i) => {
                const share = totalValue > 0 ? (p.value / totalValue) * 100 : 0;
                const barWidth = maxAbsProfit > 0 ? Math.abs(p.profit) / maxAbsProfit * 100 : 0;
                return React.createElement('tr', {
                  key: p.sym + p.cat,
                  style: { borderBottom: `1px solid ${theme.cardBorder}` },
                  onMouseEnter: e => e.currentTarget.style.background = 'rgba(255,255,255,0.025)',
                  onMouseLeave: e => e.currentTarget.style.background = 'transparent'
                },
                  // Symbol
                  React.createElement('td', { style: { padding: '0.875rem 1rem' } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                      React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 } }),
                      React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, p.sym)
                    )
                  ),
                  // Category
                  React.createElement('td', { style: { padding: '0.875rem 0.5rem' } },
                    React.createElement('span', {
                      style: { fontSize: '0.65rem', fontWeight: '700', padding: '0.15rem 0.35rem', borderRadius: '3px',
                        background: `${catColors[p.cat]}22`, color: catColors[p.cat] }
                    }, p.cat.toUpperCase().slice(0,3))
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', color: theme.text, textAlign: 'right', fontSize: '0.875rem' } }, p.amount?.toFixed?.(4)),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', color: theme.textSecondary, textAlign: 'right', fontSize: '0.875rem' } }, formatPrice(p.avgPrice)),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', color: theme.text, textAlign: 'right', fontWeight: '600', fontSize: '0.875rem' } },
                    p.price > 0 ? formatPrice(p.price) : React.createElement('span', { style: { color: theme.textSecondary } }, '—')
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', color: theme.text, textAlign: 'right', fontWeight: '700', fontSize: '0.875rem' } }, formatPrice(p.value)),
                  // P&L with mini bar
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right' } },
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' } },
                      React.createElement('span', { style: { color: p.profit >= 0 ? '#22c55e' : '#ef4444', fontWeight: '600', fontSize: '0.8rem' } },
                        `${p.profit >= 0 ? '+' : ''}${formatPrice(p.profit)}`
                      ),
                      React.createElement('div', { style: { width: 48, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' } },
                        React.createElement('div', {
                          style: {
                            height: '100%', width: `${barWidth}%`, borderRadius: 2,
                            background: p.profit >= 0 ? '#22c55e' : '#ef4444'
                          }
                        })
                      )
                    )
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right' } },
                    React.createElement('span', {
                      style: {
                        color: p.profitPct >= 0 ? '#22c55e' : '#ef4444',
                        fontWeight: '700', fontSize: '0.875rem'
                      }
                    }, `${p.profitPct >= 0 ? '+' : ''}${p.profitPct.toFixed(2)}%`)
                  ),
                  // Sparkline
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right' } },
                    p.sparkVals.length > 1
                      ? React.createElement(Sparkline, { values: p.sparkVals, width: 60, height: 24 })
                      : React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.7rem' } }, '—')
                  ),
                  // Portfolio share
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right' } },
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.MaerminFeatures = {
    PieChart,
    Sparkline,
    PortfolioOverviewPanel,
    WatchlistView,
    PriceAlertsView,
    PerformanceChart,
    PositionsTable
  };
}

})();
