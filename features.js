// ============================================================================
// MAERMIN v12.0 – Extended Features
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
  // R4.4: theme tokens (set as style so var() resolves inside the SVG)
  const lineColor = color || (isUp ? 'var(--gain)' : 'var(--loss)');

  return React.createElement('svg', { width, height, style: { overflow: 'visible' }, 'aria-hidden': 'true' },
    React.createElement('polyline', {
      points: pts,
      fill: 'none',
      style: { stroke: lineColor },
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    }),
    // Fill area
    React.createElement('polyline', {
      points: `0,${height} ${pts} ${width},${height}`,
      style: { fill: lineColor },
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

  // R4.4: the add row on the shared inputs and Button, the list on the shared
  // Table (phone rows, one named remove button per row), every change with its sign.
  const UIC = window.MaerminComponents;
  const rows = items.map(item => {
    const price = prices[item.symbol] || prices[item.displaySymbol] || 0;
    const history = (priceHistory[item.symbol] || priceHistory[item.displaySymbol] || []).slice(-20);
    const sparkVals = history.map(h => h.price);
    const prevPrice = sparkVals.length > 1 ? sparkVals[sparkVals.length - 2] : price;
    const changePct = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
    const atTarget = !!(item.targetPrice && price >= item.targetPrice);
    // v10.x: signed distance from current price to the target (+ = upside left).
    const distPct = (item.targetPrice && price > 0) ? ((item.targetPrice - price) / price) * 100 : null;
    return { item, id: item.id, price, sparkVals, changePct, atTarget, distPct };
  });

  return React.createElement('div', { className: 'ui-view', 'data-testid': 'watchlist-view' },
    // Add row
    React.createElement(UIC.Card, { title: __('wlAddTitle', 'Watch a symbol'), headingLevel: 'h3' },
      React.createElement('div', { className: 'ui-wl-add' },
        React.createElement('input', {
          type: 'text', value: newSymbol, className: ['ui-input', 'ui-wl-add__sym'].join(' '),
          onChange: e => setNewSymbol(e.target.value),
          onKeyDown: e => e.key === 'Enter' && addItem(),
          placeholder: __('wlSymbolPh', 'bitcoin, AAPL, AK-47 | Redline...'), 'aria-label': __('symbol', 'Symbol')
        }),
        React.createElement('select', {
          value: newCat, onChange: e => setNewCat(e.target.value), className: ['ui-input', 'ui-select'].join(' '), 'aria-label': __('category', 'Category')
        },
          React.createElement('option', { value: 'crypto' }, __('crypto', 'Crypto')),
          React.createElement('option', { value: 'stocks' }, __('stocks', 'Stocks')),
          React.createElement('option', { value: 'skins'  }, 'CS2')
        ),
        React.createElement('input', {
          type: 'number', value: newTarget, className: 'ui-input',
          onChange: e => setNewTarget(e.target.value),
          placeholder: __('wlTargetPh', 'Target price (opt.)'), 'aria-label': __('wlTargetPh', 'Target price (opt.)')
        }),
        React.createElement('input', {
          type: 'text', value: newNote, className: 'ui-input',
          onChange: e => setNewNote(e.target.value),
          onKeyDown: e => e.key === 'Enter' && addItem(),
          placeholder: t.watchlistNote || 'Note / thesis (opt.)', 'aria-label': t.watchlistNote || 'Note / thesis (opt.)'
        }),
        React.createElement(UIC.Button, { variant: 'primary', onClick: addItem }, __('addShort', '+ Add'))
      )
    ),

    // List
    items.length === 0
      ? React.createElement(UIC.EmptyState, { title: t.watchlist || 'Watchlist', text: t.watchlistEmpty || 'Add symbols to track them here' })
      : React.createElement(UIC.Card, { className: 'ui-card--table', 'data-testid': 'watchlist-table' },
          React.createElement(UIC.Table, {
            caption: t.watchlist || 'Watchlist', rows, rowKey: (r) => r.id,
            rowProps: (r) => (r.atTarget ? { 'data-target': 'reached' } : null),
            columns: [
              { key: 'sym', label: __('symbol', 'Symbol'), phone: 'title', render: (r) => React.createElement('span', { className: 'ui-wl-sym' },
                React.createElement('b', null, r.item.displaySymbol),
                r.atTarget ? React.createElement('span', { className: 'tone-gain' }, __('wlTargetReached', '◎ Target reached!')) : null,
                r.item.note ? React.createElement('span', { className: 'ui-wl-note' }, r.item.note) : null) },
              { key: 'cat', label: __('category', 'Category'), priority: 2, phone: 'meta', render: (r) => React.createElement(UIC.Badge, null, window.MaerminI18n.category(r.item.category)) },
              { key: 'price', label: __('price', 'Price'), align: 'right', phone: 'value', render: (r) => r.price > 0 ? window.MaerminI18n.num(r.price, 2) : '—' },
              { key: 'chg', label: __('wlChange', 'Change'), align: 'right', phone: 'sub', render: (r) => r.price > 0 ? React.createElement(UIC.ToneChip, { value: r.changePct, text: window.MaerminI18n.pct(r.changePct, 2, true) }) : '—' },
              { key: 'target', label: __('wlTarget', 'Target'), align: 'right', priority: 2, render: (r) => React.createElement('span', { className: 'ui-wl-target' },
                r.item.targetPrice ? window.MaerminI18n.num(r.item.targetPrice, 2) : '—',
                (r.distPct !== null && !r.atTarget) ? React.createElement('span', null, `${window.MaerminI18n.pct(r.distPct, 1, true)} ${r.distPct >= 0 ? (t.watchlistToGo || 'to go') : (t.watchlistAbove || 'above')}`) : null) },
              { key: 'spark', label: __('wlSpark', 'Spark'), align: 'right', priority: 3, render: (r) => r.sparkVals.length > 1
                ? React.createElement(Sparkline, { values: r.sparkVals, width: 72, height: 28 })
                : React.createElement('span', { className: 'ui-muted' }, __('noData', 'No data')) },
              { key: 'rm', label: React.createElement('span', { className: 'sr-only' }, __('wlRemove', 'Remove')), align: 'right', phone: 'sub', render: (r) => React.createElement(UIC.IconButton, {
                size: 'sm', className: 'ui-wl-remove', onClick: () => removeItem(r.id),
                label: __('wlRemoveAria', 'Remove {sym} from the watchlist', { sym: r.item.displaySymbol || r.item.symbol || '' }),
                icon: React.createElement('span', { 'aria-hidden': 'true' }, '×') }) }
            ]
          }))
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
