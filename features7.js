// ============================================================================
// MAERMIN v9.0 — Features 7: Performance Attribution, Realized P&L, News Feed
// ============================================================================
(function () {
'use strict';

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ─────────────────────────────────────────────────────────────────────────────
// 1. PERFORMANCE ATTRIBUTION
// Shows which positions drove portfolio gains/losses (contribution analysis)
// ─────────────────────────────────────────────────────────────────────────────
function PerformanceAttribution({ portfolio, prices, priceHistory, transactions, theme, formatPrice, getCurrencySymbol, t = {} }) {
  const Green = '#22c55e', Red = '#ef4444';

  const attribution = useMemo(() => {
    const results = [];
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        const sym = pos.symbol || pos.name || '';
        const symL = sym.toLowerCase();
        const curPrice = prices[sym] || prices[symL] || prices[sym.toUpperCase()] || 0;
        const value = pos.amount * curPrice;
        const cost  = pos.amount * (pos.purchasePrice || 0);
        const pnl   = value - cost;
        const pct   = cost > 0 ? (pnl / cost) * 100 : 0;
        if (value < 0.01) return;
        results.push({ sym, name: pos.symbolName || sym, cat, value, cost, pnl, pct, amount: pos.amount, curPrice });
      });
    });
    return results.sort((a, b) => b.pnl - a.pnl);
  }, [portfolio, prices]);

  const totalPnl = attribution.reduce((s, p) => s + p.pnl, 0);
  const totalVal = attribution.reduce((s, p) => s + p.value, 0);

  // V7: decompose total return into price appreciation vs dividend income, and
  // show the tax effect (German flat rate on gains). Dividends come from the
  // real dividend transactions; price P&L is the attribution total above.
  const TAX_RATE = 0.26375;
  const dividendsReceived = (transactions || [])
    .filter(tx => tx.type === 'dividend' || (tx.notes || '').toLowerCase().includes('dividend'))
    .reduce((s, tx) => s + (parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0), 0);
  const grossReturn = totalPnl + dividendsReceived;
  const estTaxOnGains = totalPnl > 0 ? totalPnl * TAX_RATE : 0;
  const netReturn = grossReturn - estTaxOnGains;
  const decompItem = (label, value, color) => React.createElement('div', { key: label },
    React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' } }, label),
    React.createElement('div', { style: { color, fontWeight: 800, fontSize: '1.05rem' } }, `${value >= 0 ? '+' : ''}${formatPrice(value)} ${getCurrencySymbol()}`)
  );

  const catColors = { crypto: '#f59e0b', stocks: '#3b82f6', skins: '#8b5cf6', commodities: '#06b6d4' };

  if (!attribution.length) return React.createElement('div', { style: { padding: '2rem', textAlign: 'center', color: theme.textSecondary } }, 'No positions to analyze');

  // V7: the AI copilot explains the attribution + return decomposition this
  // view already computed — it does not recompute any P&L.
  const aiCtx = {
    title: t.attributionTitle || 'Performance Attribution',
    data: {
      currency: getCurrencySymbol(),
      totalValue: Math.round(totalVal),
      bestPerformer: attribution[0] ? { name: attribution[0].name, returnPct: +attribution[0].pct.toFixed(1), pnl: Math.round(attribution[0].pnl) } : null,
      worstPerformer: { name: attribution[attribution.length - 1].name, returnPct: +attribution[attribution.length - 1].pct.toFixed(1), pnl: Math.round(attribution[attribution.length - 1].pnl) },
      decomposition: {
        priceAppreciation: Math.round(totalPnl),
        dividends: Math.round(dividendsReceived),
        grossReturn: Math.round(grossReturn),
        estTaxOnGains: -Math.round(estTaxOnGains),
        netReturn: Math.round(netReturn),
      },
      topPositions: attribution.slice(0, 5).map(p => ({ name: p.name, pnl: Math.round(p.pnl), returnPct: +p.pct.toFixed(1) })),
    },
  };

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.35rem', fontWeight: '800', marginBottom: '0.25rem' } }, 'Performance Attribution'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.82rem', margin: 0 } },
          'Which positions drove your portfolio gains and losses')),
      window.AICopilot ? React.createElement(window.AICopilot.Button, { theme: theme, t: t, context: aiCtx }) : null),

    // Summary bar
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      [
        { label: 'Best Performer', val: attribution[0], isGood: true },
        { label: 'Worst Performer', val: attribution[attribution.length-1], isGood: false },
      ].map(({ label, val, isGood }) =>
        React.createElement('div', { key: label, style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '1rem' } },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.25rem' } }, label),
          React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.95rem', marginBottom: '0.125rem' } }, val?.name || '—'),
          React.createElement('div', { style: { color: (val?.pnl || 0) >= 0 ? Green : Red, fontWeight: '700', fontSize: '1.1rem' } },
            val ? `${val.pct >= 0 ? '+' : ''}${val.pct.toFixed(1)}%` : '—'
          )
        )
      )
    ),

    // Return decomposition (V7): price appreciation vs dividend income, and tax effect
    React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.875rem' } }, t.attrDecomposition || 'Return decomposition'),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '1rem' } },
        decompItem(t.attrPriceReturn || 'Price appreciation', totalPnl, totalPnl >= 0 ? Green : Red),
        decompItem(t.attrDividends || 'Dividends', dividendsReceived, Green),
        decompItem(t.attrGross || 'Gross return', grossReturn, grossReturn >= 0 ? Green : Red),
        decompItem(t.attrTaxEffect || 'Est. tax on gains', -estTaxOnGains, Red),
        decompItem(t.attrNet || 'Net return', netReturn, netReturn >= 0 ? Green : Red)
      ),
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', marginTop: '0.75rem' } },
        t.attrTaxNote || 'Tax estimated at the German flat rate on unrealised gains — illustrative, not tax advice.')
    ),

    // Attribution waterfall list
    React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', overflow: 'hidden' } },
      React.createElement('div', { style: { padding: '0.875rem 1.25rem', borderBottom: `1px solid ${theme.cardBorder}`, display: 'flex', gap: '1rem', fontSize: '0.7rem', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' } },
        React.createElement('div', { style: { flex: 2 } }, 'Position'),
        React.createElement('div', { style: { flex: 1, textAlign: 'right' } }, 'Value'),
        React.createElement('div', { style: { flex: 1, textAlign: 'right' } }, 'P&L'),
        React.createElement('div', { style: { flex: 1, textAlign: 'right' } }, 'Return'),
        React.createElement('div', { style: { flex: 2 } }, 'Contribution')
      ),
      attribution.map((pos, i) => {
        const contribution = totalVal > 0 ? (pos.value / totalVal) * 100 : 0;
        const barW = Math.abs(pos.pnl) / Math.max(...attribution.map(p => Math.abs(p.pnl)), 1) * 100;
        const isUp = pos.pnl >= 0;
        return React.createElement('div', { key: pos.sym, style: { padding: '0.75rem 1.25rem', borderBottom: i < attribution.length-1 ? `1px solid ${theme.cardBorder}` : 'none', display: 'flex', alignItems: 'center', gap: '1rem' } },
          // Name + category
          React.createElement('div', { style: { flex: 2, minWidth: 0 } },
            React.createElement('div', { style: { fontWeight: '600', color: theme.text, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, pos.name),
            React.createElement('span', { style: { fontSize: '0.65rem', padding: '0.1rem 0.3rem', borderRadius: '3px', background: `${catColors[pos.cat]}20`, color: catColors[pos.cat], fontWeight: '600' } }, pos.cat)
          ),
          React.createElement('div', { style: { flex: 1, textAlign: 'right', color: theme.textSecondary, fontSize: '0.82rem' } }, `${formatPrice(pos.value)} ${getCurrencySymbol()}`),
          React.createElement('div', { style: { flex: 1, textAlign: 'right', fontWeight: '600', color: isUp ? Green : Red, fontSize: '0.82rem' } }, `${isUp?'+':''}${formatPrice(pos.pnl)}`),
          React.createElement('div', { style: { flex: 1, textAlign: 'right', fontWeight: '700', color: isUp ? Green : Red, fontSize: '0.82rem' } }, `${isUp?'+':''}${pos.pct.toFixed(1)}%`),
          // Contribution bar
          React.createElement('div', { style: { flex: 2, display: 'flex', alignItems: 'center', gap: '0.5rem' } },
            React.createElement('div', { style: { flex: 1, height: 6, background: theme.inputBg, borderRadius: 3, overflow: 'hidden' } },
              React.createElement('div', { style: { width: `${barW}%`, height: '100%', background: isUp ? Green : Red, borderRadius: 3, transition: 'width 0.4s' } })
            ),
            React.createElement('div', { style: { fontSize: '0.65rem', color: theme.textSecondary, minWidth: 32, textAlign: 'right' } }, `${contribution.toFixed(1)}%`)
          )
        );
      })
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REALIZED vs UNREALIZED P&L
// Full FIFO-based breakdown of realized gains + remaining unrealized
// ─────────────────────────────────────────────────────────────────────────────
function RealizedUnrealizedView({ transactions, portfolio, prices, theme, formatPrice, getCurrencySymbol, exchangeRate }) {
  const Green = '#22c55e', Red = '#ef4444';
  const usdToEur = exchangeRate || 0.91;

  const analysis = useMemo(() => {
    // FIFO per symbol
    const bySymbol = {};
    const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    sorted.forEach(tx => {
      const key = `${tx.category || 'crypto'}-${(tx.symbol || '').toLowerCase()}`;
      if (!bySymbol[key]) bySymbol[key] = { symbol: tx.symbol, symbolName: tx.symbolName || tx.symbol, category: tx.category || 'crypto', buyQueue: [], realizedPnL: 0, realizedCost: 0, sellRevenue: 0 };
      const e = bySymbol[key];
      let price = parseFloat(tx.price) || 0;
      if ((tx.currency || 'EUR') === 'USD') price *= usdToEur;
      const qty = parseFloat(tx.quantity) || 0;

      if (tx.type === 'buy') {
        e.buyQueue.push({ qty, price, remaining: qty, date: tx.date });
      } else if (tx.type === 'sell') {
        let toSell = qty;
        const revenue = price * qty;
        let costBasis = 0;
        while (toSell > 0 && e.buyQueue.length > 0) {
          const lot = e.buyQueue[0];
          const used = Math.min(toSell, lot.remaining);
          costBasis += used * lot.price;
          lot.remaining -= used;
          toSell -= used;
          if (lot.remaining < 0.0001) e.buyQueue.shift();
        }
        e.realizedPnL += revenue - costBasis;
        e.realizedCost += costBasis;
        e.sellRevenue += revenue;
      }
    });

    // Compute unrealized for remaining lots
    const results = Object.values(bySymbol).map(e => {
      const sym = e.symbol || '';
      const curPrice = prices[sym] || prices[sym.toLowerCase()] || prices[sym.toUpperCase()] || 0;
      const remainingQty = e.buyQueue.reduce((s, l) => s + l.remaining, 0);
      const remainingCost = e.buyQueue.reduce((s, l) => s + l.remaining * l.price, 0);
      const unrealizedValue = remainingQty * curPrice;
      const unrealizedPnL = unrealizedValue - remainingCost;

      return {
        sym, name: e.symbolName, category: e.category,
        realizedPnL: e.realizedPnL, realizedCost: e.realizedCost, sellRevenue: e.sellRevenue,
        unrealizedPnL, unrealizedValue, unrealizedCost: remainingCost, remainingQty,
        totalPnL: e.realizedPnL + unrealizedPnL,
        hasSells: e.sellRevenue > 0
      };
    }).filter(e => e.realizedCost > 0 || e.unrealizedCost > 0);

    const totalRealized   = results.reduce((s, e) => s + e.realizedPnL, 0);
    const totalUnrealized = results.reduce((s, e) => s + e.unrealizedPnL, 0);
    return { results: results.sort((a, b) => b.totalPnL - a.totalPnL), totalRealized, totalUnrealized };
  }, [transactions, prices, usdToEur]);

  const statCard = (label, value, sub, color) =>
    React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '1.25rem' } },
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.375rem' } }, label),
      React.createElement('div', { style: { color: color || theme.text, fontSize: '1.6rem', fontWeight: '800', letterSpacing: '-0.02em', lineHeight: 1 } }, value),
      sub && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.75rem', marginTop: '0.375rem' } }, sub)
    );

  const { results, totalRealized, totalUnrealized } = analysis;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.35rem', fontWeight: '800', marginBottom: '0.25rem' } }, 'Realized & Unrealized P&L'),
    React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.82rem', marginBottom: '1.5rem' } },
      'FIFO-based breakdown of locked-in gains/losses vs open positions'),

    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      statCard('Realized P&L', `${totalRealized >= 0 ? '+' : ''}${formatPrice(totalRealized)} ${getCurrencySymbol()}`, 'From closed/partial positions', totalRealized >= 0 ? Green : Red),
      statCard('Unrealized P&L', `${totalUnrealized >= 0 ? '+' : ''}${formatPrice(totalUnrealized)} ${getCurrencySymbol()}`, 'Open positions at current prices', totalUnrealized >= 0 ? Green : Red),
      statCard('Total P&L', `${(totalRealized+totalUnrealized) >= 0 ? '+' : ''}${formatPrice(totalRealized+totalUnrealized)} ${getCurrencySymbol()}`, 'Combined realized + unrealized', (totalRealized+totalUnrealized) >= 0 ? Green : Red)
    ),

    // Table
    React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', overflow: 'auto' } },
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' } },
        React.createElement('thead', null,
          React.createElement('tr', { style: { borderBottom: `1px solid ${theme.cardBorder}` } },
            ['Position', 'Realized P&L', 'Unrealized P&L', 'Total P&L'].map(h =>
              React.createElement('th', { key: h, style: { padding: '0.75rem 1rem', textAlign: h === 'Position' ? 'left' : 'right', color: theme.textSecondary, fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          results.map((e, i) =>
            React.createElement('tr', { key: e.sym, style: { borderBottom: i < results.length-1 ? `1px solid ${theme.cardBorder}` : 'none' } },
              React.createElement('td', { style: { padding: '0.75rem 1rem' } },
                React.createElement('div', { style: { fontWeight: '600', color: theme.text } }, e.name),
                React.createElement('div', { style: { fontSize: '0.7rem', color: theme.textSecondary } }, e.category)
              ),
              React.createElement('td', { style: { padding: '0.75rem 1rem', textAlign: 'right', color: e.realizedPnL >= 0 ? Green : Red, fontWeight: '600' } },
                e.hasSells ? `${e.realizedPnL >= 0 ? '+' : ''}${formatPrice(e.realizedPnL)}` : React.createElement('span', { style: { color: theme.textSecondary } }, '—')
              ),
              React.createElement('td', { style: { padding: '0.75rem 1rem', textAlign: 'right', color: e.unrealizedPnL >= 0 ? Green : Red, fontWeight: '600' } },
                e.remainingQty > 0.0001 ? `${e.unrealizedPnL >= 0 ? '+' : ''}${formatPrice(e.unrealizedPnL)}` : React.createElement('span', { style: { color: theme.textSecondary } }, '—')
              ),
              React.createElement('td', { style: { padding: '0.75rem 1rem', textAlign: 'right', color: e.totalPnL >= 0 ? Green : Red, fontWeight: '700' } },
                `${e.totalPnL >= 0 ? '+' : ''}${formatPrice(e.totalPnL)}`
              )
            )
          )
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. NEWS FEED — Financial news for held positions via free APIs
// Uses NewsAPI (free tier) or falls back to Yahoo Finance RSS
// ─────────────────────────────────────────────────────────────────────────────
function NewsFeedView({ portfolio, transactions, apiKeys, theme, formatPrice }) {
  const [news, setNews]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter]   = useState('all'); // 'all' or symbol

  const heldSymbols = useMemo(() => {
    const syms = new Set();
    ['crypto','stocks','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        if (pos.amount > 0) syms.add({ sym: pos.symbol, name: pos.symbolName || pos.symbol, cat });
      });
    });
    return [...syms].slice(0, 8); // limit to 8 symbols
  }, [portfolio]);

  const fetchNews = useCallback(async () => {
    if (!heldSymbols.length) return;
    setLoading(true);
    try {
      // Try Yahoo Finance RSS via Worker for each symbol
      const workerBase = (apiKeys?.cs2Worker || '').trim().replace(/\/$/, '');
      const allNews = [];

      // Use Yahoo Finance news RSS (free, no key)
      for (const { sym, name, cat } of heldSymbols.slice(0, 5)) {
        try {
          if (cat === 'skins') continue; // no news for CS2 skins
          const yfSym = sym.toUpperCase();
          const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yfSym)}&region=US&lang=en-US`;

          let url;
          if (workerBase) {
            url = `${workerBase}?action=news&symbol=${encodeURIComponent(yfSym)}`;
          } else {
            // Direct fetch may be blocked by CORS — worker recommended
            url = rssUrl;
          }

          const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) continue;

          const text = await res.text();
          // Parse RSS XML
          const parser = new DOMParser();
          const doc    = parser.parseFromString(text, 'text/xml');
          const items  = [...doc.querySelectorAll('item')].slice(0, 4);
          items.forEach(item => {
            const title   = item.querySelector('title')?.textContent || '';
            const link    = item.querySelector('link')?.textContent || '#';
            const pubDate = item.querySelector('pubDate')?.textContent || '';
            const description = item.querySelector('description')?.textContent || '';
            if (title) allNews.push({ sym: yfSym, name, title, link, pubDate: new Date(pubDate), description });
          });
        } catch(e) { /* skip */ }
      }

      // Sort by date, newest first
      allNews.sort((a, b) => b.pubDate - a.pubDate);
      setNews(allNews);
    } catch(e) {
      console.warn('[NEWS]', e.message);
    } finally {
      setLoading(false);
    }
  }, [heldSymbols, apiKeys]);

  useEffect(() => { fetchNews(); }, [fetchNews]);

  const filtered = filter === 'all' ? news : news.filter(n => n.sym === filter);
  const workerBase = (apiKeys?.cs2Worker || '').trim();
  const hasWorker = workerBase.length > 5;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.35rem', fontWeight: '800', marginBottom: '0.125rem' } }, 'News Feed'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.8rem' } }, 'Latest news for your held positions')
      ),
      React.createElement('button', { onClick: fetchNews, disabled: loading, style: { padding: '0.5rem 1rem', background: loading ? theme.inputBg : `${theme.accent}18`, color: loading ? theme.textSecondary : theme.accent, border: `1px solid ${theme.accent}33`, borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontWeight: '600' } },
        loading ? '◎ Loading...' : '↻ Refresh'
      )
    ),

    // No worker warning
    !hasWorker && React.createElement('div', { style: { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px', padding: '0.875rem 1.25rem', marginBottom: '1.25rem', fontSize: '0.82rem', color: theme.text } },
      '⚠ Add a Cloudflare Worker URL in ⚙ Settings to load news. The Worker fetches Yahoo Finance RSS without CORS issues.'
    ),

    // Symbol filter tabs
    heldSymbols.length > 0 && React.createElement('div', { style: { display: 'flex', gap: '0.375rem', marginBottom: '1.25rem', flexWrap: 'wrap' } },
      [{ sym: 'all', name: 'All' }, ...heldSymbols].map(({ sym, name }) =>
        React.createElement('button', {
          key: sym,
          onClick: () => setFilter(sym),
          style: {
            padding: '0.3rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: filter === sym ? '700' : '400',
            background: filter === sym ? theme.accent : theme.inputBg,
            color: filter === sym ? '#fff' : theme.textSecondary
          }
        }, name)
      )
    ),

    // News items
    filtered.length > 0
      ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' } },
          filtered.map((item, i) =>
            React.createElement('a', {
              key: i, href: item.link, target: '_blank', rel: 'noopener noreferrer',
              style: { textDecoration: 'none', display: 'block', background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '1rem 1.25rem', transition: 'border-color 0.15s', cursor: 'pointer' },
              onMouseEnter: e => e.currentTarget.style.borderColor = theme.accent,
              onMouseLeave: e => e.currentTarget.style.borderColor = theme.cardBorder
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' } },
                React.createElement('span', { style: { fontSize: '0.65rem', padding: '0.1rem 0.35rem', background: `${theme.accent}18`, color: theme.accent, borderRadius: '3px', fontWeight: '700' } }, item.sym),
                React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.72rem' } },
                  item.pubDate instanceof Date && !isNaN(item.pubDate) ? item.pubDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
                )
              ),
              React.createElement('div', { style: { color: theme.text, fontWeight: '600', fontSize: '0.9rem', lineHeight: 1.4 } }, item.title)
            )
          )
        )
      : !loading && React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '12px', padding: '3rem', textAlign: 'center', color: theme.textSecondary } },
          React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 } }, '📰'),
          React.createElement('div', null, hasWorker ? 'No news found for your positions' : 'Add Worker URL to load news')
        )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
window.MaerminFeatures7 = { PerformanceAttribution, RealizedUnrealizedView, NewsFeedView };
console.log('[OK] MAERMIN Features7 v9.0 — Performance Attribution, Realized P&L, News Feed');

})();
