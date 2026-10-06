// ============================================================================
// MAERMIN v10.0 — Features 7: Performance Attribution, Realized P&L, News Feed
// ============================================================================
(function () {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ───────────────────────────────────────────────────────────────────────────
// 1. PERFORMANCE ATTRIBUTION
// Which positions drove the total return. The per-position math is the single
// tested engine (window.MaerminAttribution.compute) fed the same FIFO/EUR cost
// basis the Overview uses — this view adds the return decomposition on top.
// ───────────────────────────────────────────────────────────────────────────
function PerformanceAttribution({ portfolio, prices, transactions, exchangeRate, theme, formatPrice, getCurrencySymbol, t = {} }) {
  const Green = theme.success, Red = theme.danger;
  const A = window.MaerminAttribution;

  // Priced positions exactly like the Overview table: value = amount × price,
  // invested = FIFO EUR cost basis (totalCostEUR) with the legacy fallback.
  const positions = useMemo(() => {
    const cats = ['crypto', 'stocks', 'skins', 'commodities']
      .concat(window.MaerminCategories ? window.MaerminCategories.ids() : []);
    const out = [];
    cats.forEach(cat => {
      (portfolio[cat] || []).forEach(p => {
        const sym = p.symbol || p.name || '';
        const price = prices[sym] ?? prices[sym.toLowerCase()] ?? prices[sym.toUpperCase()] ?? p.currentPrice ?? 0;
        const amount = p.amount || 0;
        const invested = p.totalCostEUR != null ? p.totalCostEUR : (p.purchasePrice || 0) * amount;
        out.push({ symbol: sym, name: p.symbolName || sym, value: amount * price, invested });
      });
    });
    return out;
  }, [portfolio, prices]);

  const result = useMemo(() => (A ? A.compute(positions) : null), [positions]);

  if (!A) return React.createElement('div', { style: { padding: '2rem', textAlign: 'center', color: theme.textSecondary } }, __('attrModuleMissing', 'Attribution module not loaded'));
  if (!result || !result.rows.length) return React.createElement('div', { style: { padding: '2rem', textAlign: 'center', color: theme.textSecondary } }, __('attrNoPositions', 'No positions to analyze'));

  // Return decomposition: unrealised price gain + dividends received (booked
  // dividend transactions only, converted to EUR) and an illustrative tax
  // estimate using the user's own tax settings (rate, Soli, church tax,
  // Sparerpauschbetrag) instead of a hard-coded flat rate.
  const priceGain = result.totalGain;
  const toEUR = (amt, cur) => (window.MaerminUtils ? window.MaerminUtils.toEUR(amt, cur, exchangeRate) : amt);
  const dividendsReceived = (transactions || [])
    .filter(tx => tx.type === 'dividend')
    .reduce((s, tx) => s + toEUR((parseFloat(tx.quantity) || 0) * (parseFloat(tx.price) || 0), tx.currency || 'EUR'), 0);
  const grossReturn = priceGain + dividendsReceived;
  const TS = window.MaerminTaxSettings;
  const taxSettings = TS ? TS.load() : null;
  const taxable = Math.max(0, grossReturn - ((taxSettings && taxSettings.freistellungsauftrag) || 0));
  const estTax = TS ? TS.computeAbgeltung(taxable, taxSettings).total : 0;
  const netReturn = grossReturn - estTax;
  const decompItem = (label, value, color) => React.createElement('div', { key: label },
    React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' } }, label),
    React.createElement('div', { style: { color, fontWeight: 800, fontSize: '1.05rem' } }, `${value >= 0 ? '+' : ''}${formatPrice(value)} ${getCurrencySymbol()}`)
  );

  // Rows are sorted by contribution (pp of total return), best first.
  const best = result.rows[0], worst = result.rows[result.rows.length - 1];
  const summary = (label, r) => React.createElement('div', { key: label, style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '16px', boxShadow: theme.shadow, padding: '1rem' } },
    React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.25rem' } }, label),
    React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.95rem', marginBottom: '0.125rem' } }, r ? r.name : '—'),
    React.createElement('div', { style: { color: r && r.contributionPP >= 0 ? Green : Red, fontWeight: '700', fontSize: '1.1rem' } },
      r ? __('ppValue', '{v} pp', { v: (r.contributionPP >= 0 ? '+' : '') + window.MaerminI18n.num(r.contributionPP, 2) }) : '—')
  );

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { marginBottom: '1.5rem' } },
      React.createElement('h2', { style: { color: theme.text, fontSize: '1.35rem', fontWeight: '800', marginBottom: '0.25rem' } }, t.attributionTitle || 'Performance Attribution'),
      React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.82rem', margin: 0 } },
        __('attrSubtitle', 'Which positions drove your portfolio gains and losses'))),

    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      summary(__('attrTopContrib', 'Top contributor'), best),
      summary(__('attrTopDetract', 'Top detractor'), worst)
    ),

    React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '16px', boxShadow: theme.shadow, padding: '1.25rem', marginBottom: '1.5rem' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.875rem' } }, t.attrDecomposition || 'Return decomposition'),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '1rem' } },
        decompItem(t.attrPriceReturn || 'Price appreciation', priceGain, priceGain >= 0 ? Green : Red),
        decompItem(t.attrDividends || 'Dividends', dividendsReceived, Green),
        decompItem(t.attrGross || 'Gross return', grossReturn, grossReturn >= 0 ? Green : Red),
        decompItem(t.attrTaxEffect || 'Est. tax on gains', -estTax, Red),
        decompItem(t.attrNet || 'Net return', netReturn, netReturn >= 0 ? Green : Red)
      ),
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', marginTop: '0.75rem' } },
        t.attrTaxNote || 'Tax estimated with your tax settings (rate, Soli, church tax, allowance) as if all gains were realised now — illustrative, not tax advice.')
    ),

    // Per-position contribution table — the shared engine's own panel.
    React.createElement(A.Panel, { positions, theme, formatPrice, limit: result.rows.length })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REALIZED vs UNREALIZED P&L
// Full FIFO-based breakdown of realized gains + remaining unrealized
// ─────────────────────────────────────────────────────────────────────────────
function RealizedUnrealizedView({ transactions, portfolio, prices, theme, formatPrice, getCurrencySymbol, exchangeRate, fxAt }) {
  const Green = theme.success, Red = theme.danger;
  const usdToEur = exchangeRate || 0.91;

  const analysis = useMemo(() => {
    // FIFO per position from the ONE ledger (ledger.js) — identical to the
    // FIFO tab and the tax report (fees, per-date FX, splits).
    const L = window.MaerminLedger.build(transactions, { exchangeRate: usdToEur, fxAt });
    const bySymbol = {};
    L.list.forEach(g => {
      bySymbol[g.key] = {
        symbol: g.symbol, symbolName: g.symbolName || g.symbol, category: g.category,
        buyQueue: g.openLots.map(l => ({ qty: l.qty, price: l.unitCostEUR, remaining: l.qty, date: l.date })),
        realizedPnL: g.realizedGain,
        realizedCost: g.disposals.reduce((s, d) => s + d.costBasis, 0),
        sellRevenue: g.proceedsEUR
      };
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
  }, [transactions, prices, usdToEur, fxAt]);

  const statCard = (label, value, sub, color) =>
    React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '16px', boxShadow: theme.shadow, padding: '1.25rem' } },
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.375rem' } }, label),
      React.createElement('div', { style: { color: color || theme.text, fontSize: '1.6rem', fontWeight: '800', letterSpacing: '-0.02em', lineHeight: 1 } }, value),
      sub && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.75rem', marginTop: '0.375rem' } }, sub)
    );

  const { results, totalRealized, totalUnrealized } = analysis;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.35rem', fontWeight: '800', marginBottom: '0.25rem' } }, __('ruTitle', 'Realized & Unrealized P&L')),
    React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.82rem', marginBottom: '1.5rem' } },
      __('ruSubtitle', 'FIFO-based breakdown of locked-in gains/losses vs open positions')),

    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      statCard(__('fifoRealizedPnl', 'Realized P&L'), `${totalRealized >= 0 ? '+' : ''}${formatPrice(totalRealized)} ${getCurrencySymbol()}`, __('ruFromClosed', 'From closed/partial positions'), totalRealized >= 0 ? Green : Red),
      statCard(__('pdUnrealized', 'Unrealized P&L'), `${totalUnrealized >= 0 ? '+' : ''}${formatPrice(totalUnrealized)} ${getCurrencySymbol()}`, __('ruOpenAtCurrent', 'Open positions at current prices'), totalUnrealized >= 0 ? Green : Red),
      statCard(__('ruTotalPnl', 'Total P&L'), `${(totalRealized+totalUnrealized) >= 0 ? '+' : ''}${formatPrice(totalRealized+totalUnrealized)} ${getCurrencySymbol()}`, __('ruCombined', 'Combined realized + unrealized'), (totalRealized+totalUnrealized) >= 0 ? Green : Red)
    ),

    // Table
    React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '16px', boxShadow: theme.shadow, overflow: 'auto' } },
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' } },
        React.createElement('thead', null,
          React.createElement('tr', { style: { borderBottom: `1px solid ${theme.cardBorder}` } },
            [__('position', 'Position'), __('fifoRealizedPnl', 'Realized P&L'), __('pdUnrealized', 'Unrealized P&L'), __('ruTotalPnl', 'Total P&L')].map((h, hi) =>
              React.createElement('th', { key: h, style: { padding: '0.75rem 1rem', textAlign: hi === 0 ? 'left' : 'right', color: theme.textSecondary, fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, h)
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
  // Requests of the last load: a Worker that fails is not "no news" (FINDINGS M-14).
  const [requests, setRequests] = useState({ tried: 0, failed: 0 });

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
      let tried = 0, failed = 0;

      // Use Yahoo Finance news RSS (free, no key)
      for (const { sym, name, cat } of heldSymbols.slice(0, 5)) {
        try {
          if (cat === 'skins') continue; // no news for CS2 skins
          const yfSym = sym.toUpperCase();

          // Yahoo's RSS has no CORS headers and isn't in the CSP connect-src, so
          // a direct fetch can never succeed - only go through the Worker.
          if (!workerBase) break;
          const url = `${workerBase}?action=news&symbol=${encodeURIComponent(yfSym)}`;

          tried++;
          const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) { failed++; continue; }

          const text = await res.text();
          // Parse RSS XML
          const parser = new DOMParser();
          const doc    = parser.parseFromString(text, 'text/xml');
          const items  = [...doc.querySelectorAll('item')].slice(0, 4);
          items.forEach(item => {
            const title   = item.querySelector('title')?.textContent || '';
            const rawLink = item.querySelector('link')?.textContent || '';
            const link    = window.MaerminUtils && window.MaerminUtils.safeUrl ? window.MaerminUtils.safeUrl(rawLink) : '#';
            const pubDate = item.querySelector('pubDate')?.textContent || '';
            const description = item.querySelector('description')?.textContent || '';
            if (title) allNews.push({ sym: yfSym, name, title, link, pubDate: new Date(pubDate), description });
          });
        } catch(e) { failed++; }
      }
      setRequests({ tried, failed });

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
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.35rem', fontWeight: '800', marginBottom: '0.125rem' } }, __('newsTitle', 'News Feed')),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.8rem' } }, __('newsSubtitle', 'Latest news for your held positions'))
      ),
      React.createElement('button', { onClick: fetchNews, disabled: loading, style: { padding: '0.5rem 1rem', background: loading ? theme.inputBg : `${theme.accent}18`, color: loading ? theme.textSecondary : theme.accent, border: `1px solid ${theme.accent}33`, borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontWeight: '600' } },
        loading ? __('loadingDots', '◎ Loading...') : __('refreshBtn', '↻ Refresh')
      )
    ),

    // No worker warning
    !hasWorker && React.createElement('div', { style: { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '10px', padding: '0.875rem 1.25rem', marginBottom: '1.25rem', fontSize: '0.82rem', color: theme.text } },
      __('newsWorkerHint', 'Add a Cloudflare Worker URL in Settings to load news. The Worker fetches Yahoo Finance RSS without CORS issues.')
    ),

    // Symbol filter tabs
    heldSymbols.length > 0 && React.createElement('div', { style: { display: 'flex', gap: '0.375rem', marginBottom: '1.25rem', flexWrap: 'wrap' } },
      [{ sym: 'all', name: __('all', 'All') }, ...heldSymbols].map(({ sym, name }) =>
        React.createElement('button', {
          key: sym,
          onClick: () => setFilter(sym),
          style: {
            padding: '0.3rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: filter === sym ? '700' : '400',
            background: filter === sym ? (theme.accentFill || theme.accent) : theme.inputBg,
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
                  item.pubDate instanceof Date && !isNaN(item.pubDate) ? window.MaerminI18n.date(item.pubDate, 'medium') : ''
                )
              ),
              React.createElement('div', { style: { color: theme.text, fontWeight: '600', fontSize: '0.9rem', lineHeight: 1.4 } }, item.title)
            )
          )
        )
      : !loading && React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '16px', boxShadow: theme.shadow, padding: '3rem', textAlign: 'center', color: theme.textSecondary } },
          React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 } }, '☰'),
          React.createElement('div', { 'data-testid': 'news-status' }, newsEmptyText(hasWorker, requests))
        ),
    news.length > 0 && requests.failed > 0 && React.createElement('div', { style: { marginTop: '0.75rem', color: theme.textSecondary, fontSize: '0.78rem' } },
      newsPartialText(requests))
  );
}

// What an empty News Feed says (FINDINGS M-14): a Worker that failed every
// request is an error, not an empty feed.
function newsEmptyText(hasWorker, req) {
  if (!hasWorker) return __('newsNeedWorker', 'Add Worker URL to load news');
  if (req && req.tried > 0 && req.failed === req.tried) return __('newsAllFailed', 'News could not be loaded: your Worker did not answer ({failed} of {tried} requests failed). Check the Worker URL in API Settings or redeploy the Worker.', req);
  return __('newsNone', 'No news found for your positions');
}
function newsPartialText(req) {
  return __('newsPartial', 'News for {failed} of {tried} positions could not be loaded.', req);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
window.MaerminFeatures7 = { PerformanceAttribution, RealizedUnrealizedView, NewsFeedView, newsEmptyText };
console.log('[OK] MAERMIN Features7 v10.0 — Performance Attribution, Realized P&L, News Feed');

})();
