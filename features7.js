// ============================================================================
// MAERMIN v12.2 — Features 7: Performance Attribution, Realized P&L, News Feed
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
function PerformanceAttribution({ portfolio, prices, transactions, exchangeRate, theme, formatPrice, getCurrencySymbol, t = {}, extra }) {
  const Green = theme.success, Red = theme.danger;
  const A = window.MaerminAttribution;

  // Priced positions exactly like the Overview table: value = amount × price,
  // invested = FIFO EUR cost basis (totalCostEUR) with the legacy fallback.
  const positions = useMemo(() => {
    const cats = ['crypto', 'stocks', 'skins', 'commodities', 'bonds'] // P5-3.9: bonds
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

  if (!A) return React.createElement('div', null, window.MaerminUtils.errorNote(__('attrModuleMissing', 'Attribution module not loaded')));
  if (!result || !result.rows.length) return React.createElement('div', null, window.MaerminUtils.emptyNote(__('attrNoPositions', 'No positions to analyze')));

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
  // R4.1: the decomposition as a waterfall (price + dividends = gross, − tax =
  // net), the drivers as answer tiles, the table on the shared Table.
  const UIC = window.MaerminComponents;
  const I = window.MaerminI18n;
  const signedMoney = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + `${formatPrice(Math.abs(v))} ${getCurrencySymbol()}`;
  const steps = [
    { key: 'price', label: t.attrPriceReturn || 'Price appreciation', a: priceGain },
    { key: 'div', label: t.attrDividends || 'Dividends', a: dividendsReceived },
    { key: 'gross', label: t.attrGross || 'Gross return', total: grossReturn },
    { key: 'tax', label: t.attrTaxEffect || 'Est. tax on gains', a: -estTax },
    { key: 'net', label: t.attrNet || 'Net return', total: netReturn }
  ];
  let run = 0, lo = 0, hi = 0;
  steps.forEach(s => { if (s.total === undefined) { s.from = run; run += s.a; s.to = run; } else { s.from = 0; s.to = s.total; } lo = Math.min(lo, s.from, s.to); hi = Math.max(hi, s.from, s.to); });
  const span = (hi - lo) || 1;
  const wfRow = (s) => {
    const v = s.total === undefined ? s.a : s.total;
    const tone = s.total === undefined ? (s.a >= 0 ? 'gain' : 'loss') : 'total';
    return React.createElement('li', { key: s.key, 'data-attr': s.key, className: ['ui-wf__row', s.total === undefined ? '' : 'is-total'].join(' ').trim() },
      React.createElement('span', { className: 'ui-wf__label' }, s.label),
      React.createElement('span', { className: 'ui-wf__track', 'aria-hidden': 'true' },
        React.createElement('span', { className: 'ui-wf__bar', 'data-tone': tone, style: { left: ((Math.min(s.from, s.to) - lo) / span * 100) + '%', width: Math.max(0.6, Math.abs(s.to - s.from) / span * 100) + '%' } })),
      React.createElement('span', { className: ['ui-wf__value', 'num', 'tone-' + (s.total === undefined ? tone : UIC.toneOf(v))].join(' ') }, signedMoney(v)));
  };

  // Rows are sorted by contribution (pp of total return), best first.
  // VIS-007: a contributor only when it added, a detractor only when it took away.
  const first = result.rows[0], last = result.rows[result.rows.length - 1];
  const best = first && first.contributionPP > 0 ? first : null;
  const worst = last && last.contributionPP < 0 ? last : null;
  const pp = (r) => __('ppValue', '{v} pp', { v: (r.contributionPP >= 0 ? '+' : '') + I.num(r.contributionPP, 2) });
  const summary = (label, r, testid) => React.createElement(UIC.Card, { key: label, variant: 'answer', className: 'ui-ov-tile', 'data-testid': testid },
    React.createElement(UIC.Stat, { label, value: pp(r), tone: UIC.toneOf(r.contributionPP), sub: r.name }));

  return React.createElement('div', { className: 'ui-view', 'data-testid': 'attribution-view' },
    React.createElement('p', { className: 'ui-view__lead' }, __('attrSubtitle', 'Which positions drove your portfolio gains and losses')),
    (best || worst) && React.createElement('div', { className: 'ui-ov-tiles' },
      best && summary(__('attrTopContrib', 'Top contributor'), best, 'attr-top'),
      worst && summary(__('attrTopDetract', 'Top detractor'), worst, 'attr-bottom')),
    React.createElement(UIC.Card, { title: t.attrDecomposition || 'Return decomposition', headingLevel: 'h3', 'data-testid': 'attr-decomposition', className: 'ui-chart' },
      React.createElement('ol', { className: 'ui-wf', 'aria-label': t.attrDecomposition || 'Return decomposition' }, steps.map(wfRow)),
      React.createElement('p', { className: 'ui-note' },
        t.attrTaxNote || 'Tax estimated with your tax settings (rate, Soli, church tax, allowance) as if all gains were realised now — illustrative, not tax advice.')),
    // Per-position contribution table — the shared engine's own panel.
    React.createElement(A.Panel, { positions, theme, formatPrice, limit: result.rows.length }),
    extra || null
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
    // Lots matched per portfolio, then one row per holding (the sum of the
    // portfolios in "All portfolios"; a single portfolio is unaffected).
    const L = window.MaerminLedger.build(transactions, { exchangeRate: usdToEur, fxAt, perPortfolio: true });
    const bySymbol = {};
    L.list.forEach(g => {
      const k = g.key.split('|p:')[0];
      const e = bySymbol[k] || (bySymbol[k] = { symbol: g.symbol, symbolName: g.symbolName || g.symbol, category: g.category, buyQueue: [], realizedPnL: 0, realizedCost: 0, sellRevenue: 0 });
      e.buyQueue.push(...g.openLots.map(l => ({ qty: l.qty, price: l.unitCostEUR, remaining: l.qty, date: l.date })));
      e.realizedPnL += g.realizedGain;
      e.realizedCost += g.disposals.reduce((s, d) => s + d.costBasis, 0);
      e.sellRevenue += g.proceedsEUR;
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

  // R4.6: the view layout, answer tiles and the shared Table (phone rows); every P&L with its sign
  const UIC = window.MaerminComponents;
  const h = React.createElement;
  const { results, totalRealized, totalUnrealized } = analysis;
  const signed = (v) => `${v >= 0 ? '+' : ''}${formatPrice(v)}`;
  const pnl = (v, show) => show ? h('span', { className: 'tone-' + UIC.toneOf(v) }, signed(v)) : h('span', { className: 'is-dim' }, '—');
  const tile = (label, value, sub) => h(UIC.Card, { variant: 'answer', className: 'ui-ov-tile' },
    h(UIC.Stat, { label, value: `${signed(value)} ${getCurrencySymbol()}`, sub, tone: UIC.toneOf(value) }));

  return h('div', { className: ['ui-view', 'ui-view--cont', 'ui-ru'].join(' ') },
    h('p', { className: 'ui-view__lead' }, __('ruSubtitle', 'FIFO-based breakdown of locked-in gains/losses vs open positions')),
    h('div', { className: 'ui-ov-tiles' },
      tile(__('fifoRealizedPnl', 'Realized P&L'), totalRealized, __('ruFromClosed', 'From closed/partial positions')),
      tile(__('pdUnrealized', 'Unrealized P&L'), totalUnrealized, __('ruOpenAtCurrent', 'Open positions at current prices')),
      tile(__('ruTotalPnl', 'Total P&L'), totalRealized + totalUnrealized, __('ruCombined', 'Combined realized + unrealized'))),
    h(UIC.Card, { variant: 'plain', headingLevel: 'h3', title: __('ruTitle', 'Realized & Unrealized P&L') },
      h(UIC.Table, { rows: results, rowKey: (e) => e.sym, caption: __('ruTitle', 'Realized & Unrealized P&L'), columns: [
        { key: 'pos', label: __('position', 'Position'), phone: 'title', render: (e) => h('span', { className: 'ui-asset__text' },
          h('span', { className: 'ui-asset__name' }, e.name), h('span', { className: 'ui-asset__sub' }, window.MaerminI18n.category(e.category))) },
        { key: 'real', label: __('fifoRealizedPnl', 'Realized P&L'), align: 'right', phone: 'meta', render: (e) => pnl(e.realizedPnL, e.hasSells) },
        { key: 'unreal', label: __('pdUnrealized', 'Unrealized P&L'), align: 'right', phone: 'meta', render: (e) => pnl(e.unrealizedPnL, e.remainingQty > 0.0001) },
        { key: 'total', label: __('ruTotalPnl', 'Total P&L'), align: 'right', phone: 'value', render: (e) => h('b', null, pnl(e.totalPnL, true)) }
      ] })));
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

  // R4.4: the view frame, symbol Chips, one Card with the headlines as rows.
  const UIC = window.MaerminComponents;
  return React.createElement('div', { className: 'ui-view', 'data-testid': 'news-view' },
    React.createElement('div', { className: 'ui-view__bar' },
      React.createElement('p', { className: 'ui-view__lead' }, __('newsSubtitle', 'Latest news for your held positions'), ' ', window.MaerminDemoFixtures && window.MaerminDemoFixtures.badge(React, theme, workerBase)),
      React.createElement(UIC.Button, { onClick: fetchNews, disabled: !hasWorker, loading, title: hasWorker ? undefined : __('newsNeedWorker', 'Add a Worker URL in API Settings to load news.') },
        loading ? __('loadingDots', '◎ Loading...') : __('refreshBtn', '↻ Refresh'))),

    // No worker warning
    !hasWorker && window.MaerminUtils.emptyState({
      kind: 'worker', testid: 'news-need-worker',
      text: __('newsWorkerHint', 'Add a Cloudflare Worker URL in API Settings to load news. The Worker fetches Yahoo Finance RSS without CORS issues.'),
      action: window.MaerminUI && window.MaerminUI.workerAction ? window.MaerminUI.workerAction() : undefined
    }),

    // Symbol filter
    heldSymbols.length > 0 && React.createElement('div', { className: 'ui-chips', role: 'group', 'aria-label': __('newsFilterAria', 'Show news for') },
      [{ sym: 'all', name: __('all', 'All') }, ...heldSymbols].map(({ sym, name }) =>
        React.createElement(UIC.Chip, { key: sym, pressed: filter === sym, onClick: () => setFilter(sym) }, name))),

    // News items
    filtered.length > 0
      ? React.createElement(UIC.Card, { className: 'ui-card--table', 'data-testid': 'news-list' },
          React.createElement('ul', { className: 'ui-news' },
            filtered.map((item, i) =>
              React.createElement('li', { key: i },
                React.createElement('a', { href: item.link, target: '_blank', rel: 'noopener noreferrer', className: 'ui-news__item' },
                  React.createElement('span', { className: 'ui-news__meta' },
                    React.createElement(UIC.Badge, null, item.sym),
                    item.pubDate instanceof Date && !isNaN(item.pubDate) ? React.createElement('span', null, window.MaerminI18n.date(item.pubDate, 'medium')) : null),
                  React.createElement('span', { className: 'ui-news__title' }, item.title))))))
      : !loading && window.MaerminUtils.emptyState({ testid: 'news-status', text: newsEmptyText(hasWorker, requests) }),
    news.length > 0 && requests.failed > 0 && React.createElement('p', { className: 'ui-note' }, newsPartialText(requests))
  );
}

// What an empty News Feed says (FINDINGS M-14): a Worker that failed every
// request is an error, not an empty feed.
function newsEmptyText(hasWorker, req) {
  if (!hasWorker) return __('newsNeedWorker', 'Add a Worker URL in API Settings to load news.');
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

})();
