// ============================================================================
// MAERMIN v10.0 – Extended Features
// Implements: Sparklines, price-quality badge, Watchlist
// ============================================================================
(function () {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

const { useState, useEffect } = React;

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
// 4. WATCHLIST
// ─────────────────────────────────────────────────────────────────────────────
function WatchlistView({ prices, priceHistory, theme, t, addToast }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_watchlist') || '[]'); } catch { return []; }
  });
  const [newSymbol, setNewSymbol] = useState('');
  const [newCat, setNewCat] = useState('crypto');
  const [newTarget, setNewTarget] = useState('');
  const [newNote, setNewNote] = useState(''); // v10.x: thesis note per watch item

  useEffect(() => {
    localStorage.setItem('maermin_watchlist', JSON.stringify(items));
  }, [items]);

  const addItem = () => {
    const sym = newSymbol.trim().toLowerCase();
    if (!sym) return;
    if (items.find(i => i.symbol === sym)) {
      addToast && addToast(__('wlAlready', 'Already in watchlist'), 'warning');
      return;
    }
    setItems(prev => [...prev, {
      id: Date.now().toString(),
      symbol: sym,
      displaySymbol: newSymbol.trim(),
      category: newCat,
      targetPrice: parseFloat(newTarget) || null,
      note: newNote.trim() || null,
      addedAt: new Date().toISOString()
    }]);
    setNewSymbol(''); setNewTarget(''); setNewNote('');
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
        placeholder: __('wlSymbolPh', 'bitcoin, AAPL, AK-47 | Redline...'),
        style: { ...inputStyle, flex: '1', minWidth: '160px' }
      }),
      React.createElement('select', {
        value: newCat, onChange: e => setNewCat(e.target.value), style: inputStyle
      },
        React.createElement('option', { value: 'crypto' }, __('crypto', 'Crypto')),
        React.createElement('option', { value: 'stocks' }, __('stocks', 'Stocks')),
        React.createElement('option', { value: 'skins'  }, 'CS2')
      ),
      React.createElement('input', {
        type: 'number', value: newTarget,
        onChange: e => setNewTarget(e.target.value),
        placeholder: __('wlTargetPh', 'Target price (opt.)'),
        style: { ...inputStyle, width: '150px' }
      }),
      React.createElement('input', {
        type: 'text', value: newNote,
        onChange: e => setNewNote(e.target.value),
        onKeyDown: e => e.key === 'Enter' && addItem(),
        placeholder: t.watchlistNote || 'Note / thesis (opt.)',
        style: { ...inputStyle, width: '200px' }
      }),
      React.createElement('button', {
        onClick: addItem,
        style: {
          padding: '0.5rem 1.25rem', background: theme.accent, color: '#ffffff',
          border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600'
        }
      }, __('addShort', '+ Add'))
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
                [__('symbol', 'Symbol'),__('category', 'Category'),__('price', 'Price'),__('wlChange', 'Change'),__('wlTarget', 'Target'),__('wlSpark', 'Spark'),''].map((h,i) =>
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
                // v10.x: signed distance from current price to the target (+ = upside left).
                const distPct = (item.targetPrice && price > 0) ? ((item.targetPrice - price) / price) * 100 : null;

                return React.createElement('tr', {
                  key: item.id,
                  style: { background: atTarget ? 'rgba(34,197,94,0.05)' : 'transparent' }
                },
                  React.createElement('td', { style: { padding: '0.875rem 1rem' } },
                    React.createElement('div', { style: { fontWeight: '700', color: theme.text, fontSize: '0.9rem' } }, item.displaySymbol),
                    atTarget && React.createElement('div', { style: { color: theme.success, fontSize: '0.7rem', fontWeight: '600' } }, __('wlTargetReached', '◎ Target reached!')),
                    item.note && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', marginTop: '0.15rem', maxWidth: '220px', whiteSpace: 'normal', lineHeight: 1.35 } }, item.note)
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem' } },
                    React.createElement('span', {
                      style: {
                        padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: '600',
                        background: item.category === 'crypto' ? 'rgba(245,158,11,0.15)' :
                                    item.category === 'stocks' ? 'rgba(59,130,246,0.15)' : 'rgba(6,182,212,0.15)',
                        color: item.category === 'crypto' ? '#f59e0b' : item.category === 'stocks' ? '#3b82f6' : '#06b6d4'
                      }
                    }, window.MaerminI18n.category(item.category).toUpperCase())
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right', color: theme.text, fontWeight: '600' } },
                    price > 0 ? window.MaerminI18n.num(price, 2) : '—'
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right' } },
                    price > 0
                      ? React.createElement('span', {
                          style: { color: changePct >= 0 ? theme.success : theme.danger, fontWeight: '600', fontSize: '0.875rem' }
                        }, window.MaerminI18n.pct(changePct, 2, true))
                      : React.createElement('span', { style: { color: theme.textSecondary } }, '—')
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right', color: theme.textSecondary, fontSize: '0.875rem' } },
                    item.targetPrice ? window.MaerminI18n.num(item.targetPrice, 2) : '—',
                    (distPct !== null && !atTarget) && React.createElement('div', {
                      style: { color: theme.textSecondary, fontSize: '0.7rem', marginTop: '0.1rem', opacity: 0.85 }
                    }, `${window.MaerminI18n.pct(distPct, 1, true)} ${distPct >= 0 ? (t.watchlistToGo || 'to go') : (t.watchlistAbove || 'above')}`)
                  ),
                  React.createElement('td', { style: { padding: '0.875rem 1rem', textAlign: 'right' } },
                    sparkVals.length > 1
                      ? React.createElement(Sparkline, { values: sparkVals, width: 72, height: 28 })
                      : React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.75rem' } }, __('noData', 'No data'))
                  ),
                  React.createElement('td', { style: { padding: '0.5rem', textAlign: 'center' } },
                    React.createElement('button', {
                      onClick: () => removeItem(item.id),
                      'aria-label': __('wlRemoveAria', 'Remove {sym} from the watchlist', { sym: item.displaySymbol || item.symbol || '' }),
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
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.MaerminFeatures = {
    Sparkline,
    WatchlistView
  };
}

})();
