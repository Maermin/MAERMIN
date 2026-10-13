// ============================================================================
// MAERMIN v11.0 – Advanced Features
// 1. XIRR / Time-Weighted Return calculator
// 2. Rebalancing Tool
// 3. Broker Import Wizard UI
// 4. Mobile Responsive Nav
// 5. Position Notes / Trade Journal
// 6. Dividend Calendar
// ============================================================================
(function () {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

// Money-Weighted Return (XIRR). Delegates to the pure, Node-tested
// MaerminReturns engine (returns-engine.js), which requires a sign change and
// verifies convergence — fixing the old inline version that returned a bogus
// clamped rate for degenerate (all-outflow / non-converging) inputs.
function calcXIRR(cashflows) {
  if (typeof window !== 'undefined' && window.MaerminReturns) return window.MaerminReturns.xirr(cashflows);
  return null; // engine always present in the app load order; null is the safe miss
}

// Time-Weighted Return from price history. Delegates to the pure MaerminReturns
// engine (returns-engine.js) — same logic, now Node-tested.
function calcTWR(priceHistory, portfolio, transactions) {
  if (typeof window !== 'undefined' && window.MaerminReturns) return window.MaerminReturns.twr(priceHistory, portfolio, transactions);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. XIRR / TWR VIEW
// ─────────────────────────────────────────────────────────────────────────────
// P4-1: monthly returns heatmap (returns-heatmap.js). Rows = years, newest
// first; Jan-Dec, then the compounded quarters and year. Each cell prints its
// figure, so colour is never the only signal (colour-blind theme). On a phone
// the table scrolls inside its card, with the year column fixed.
// P5-2.4: every cell with a figure is a button; it opens the period's detail
// (start / end value, money in / out, gain, return, activities) from the same
// points as the cell (heatmap-drilldown.js). `controls` = the filter above the
// table, `note` replaces the source line (position dialog), `flat` drops the
// card frame.
function ReturnsHeatmap({ steps, points, transactions, source, theme, formatPrice, getCurrencySymbol, controls, note, testid, title, flat }) {
  const H = (typeof window !== 'undefined') ? window.MaerminReturnsHeatmap : null;
  const D = (typeof window !== 'undefined') ? window.MaerminHeatmapDrill : null;
  const grid = useMemo(() => (H && steps && steps.length) ? H.fromSteps(steps) : null, [H, steps]);
  const [sel, setSel] = useState(null); // { kind: 'm' | 'q' | 'y', year, idx }
  const det = useMemo(() => {
    if (!sel || !D) return null;
    const range = D.periodOf(sel.kind, sel.year, sel.idx);
    return range ? D.detail(points && points.length ? points : steps, transactions, range) : null;
  }, [sel, D, points, steps, transactions]);
  if (!H || source === 'none') return null;
  const tid = testid || 'returns-heatmap';
  const I = window.MaerminI18n;
  const months = I.monthNames('short');
  const monthsLong = I.monthNames('long');
  const fmt = (r) => I.pct(r * 100, 1, true);
  const money = (v) => (formatPrice ? formatPrice(v) : I.num(v, 2)) + (getCurrencySymbol ? ' ' + getCurrencySymbol() : '');
  const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v));
  const periodLabel = (p) => p.kind === 'm' ? monthsLong[p.idx] + ' ' + p.year
    : p.kind === 'q' ? __('rhQuarter', 'Q{n}', { n: p.idx + 1 }) + ' ' + p.year : String(p.year);
  const same = (a, b) => !!a && !!b && a.kind === b.kind && a.year === b.year && a.idx === b.idx;
  const cellStyle = { padding: '0.4rem 0.45rem', textAlign: 'right', fontSize: '0.76rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', borderRadius: '5px' };
  const headStyle = { padding: '0.35rem 0.45rem', textAlign: 'right', fontSize: '0.7rem', fontWeight: 600, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' };
  const cell = (r, label, maxAbs, key, partial, strong, pick) => {
    if (r === null || r === undefined) {
      return React.createElement('td', { key, 'aria-label': __('rhCellNone', '{label}: no data', { label }), style: { ...cellStyle, background: 'transparent', color: theme.textSecondary } }, '—');
    }
    const bg = H.cellColor(r, { up: theme.success, down: theme.danger, base: theme.card, maxAbs });
    const text = fmt(r) + (partial ? '*' : '');
    const on = same(sel, pick);
    const toggle = () => setSel(on ? null : pick);
    return React.createElement('td', {
      key, 'data-r': r, 'data-kind': key, 'data-cell': pick.kind + '-' + pick.year + '-' + pick.idx,
      title: label + ': ' + fmt(r) + (partial ? ' (' + __('rhPartial', 'part of the month') + ')' : ''),
      'aria-label': __('rhCellAria', '{label}: {pct}', { label, pct: fmt(r) }) + (partial ? ', ' + __('rhPartial', 'part of the month') : ''),
      role: 'button', tabIndex: 0, 'aria-pressed': on, onClick: toggle,
      onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } },
      style: { ...cellStyle, background: bg, color: H.textOn(bg), fontWeight: strong ? 700 : 500, cursor: 'pointer', boxShadow: on ? `inset 0 0 0 2px ${theme.text}` : 'none' }
    }, text);
  };
  const srcNote = note || (source === 'daily' ? __('rhSrcDaily', 'From the daily closing prices, like the TWR above.')
    : source === 'snapshots' ? __('rhSrcSnapshots', 'From the daily value snapshots, like the TWR above. A period that spans several months counts in the month it ends in.')
    : __('rhSrcRefresh', 'From your price refreshes, like the TWR above. Months without a refresh show —; a period that spans several months counts in the month it ends in.'));
  const stat = (key, label, value, sub, color, extra) => React.createElement('div', { key, 'data-stat': key, ...(extra || {}), style: { minWidth: 0 } },
    React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.2rem' } }, label),
    React.createElement('div', { style: { color: color || theme.text, fontWeight: 700, fontSize: '0.92rem', fontVariantNumeric: 'tabular-nums' } }, value),
    sub && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', marginTop: '0.15rem' } }, sub));
  const tone = (v) => v > 0 ? theme.success : v < 0 ? theme.danger : theme.text;
  const detailView = () => {
    if (!det) return null;
    const b = det.byType;
    const kinds = [b.buy && __('rhdBuys', '{n} {n:buy|buys}', { n: b.buy }), b.sell && __('rhdSells', '{n} {n:sale|sales}', { n: b.sell }),
      b.income && __('rhdPayouts', '{n} {n:payout|payouts}', { n: b.income }), b.other && __('rhdOther', '{n} other')].filter(Boolean).join(' · ');
    const hasValues = det.endValue !== null;
    return React.createElement('div', { 'data-testid': tid + '-detail', role: 'region', 'aria-live': 'polite', 'aria-label': periodLabel(sel),
      style: { marginTop: '0.75rem', padding: '0.85rem 1rem', borderRadius: '12px', border: `1px solid ${theme.cardBorder}`, background: theme.inputBg || 'transparent' } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' } },
        React.createElement('strong', { style: { color: theme.text, fontSize: '0.9rem' } }, periodLabel(sel)),
        React.createElement('button', { onClick: () => setSel(null), 'aria-label': __('close', 'Close'),
          style: { background: 'none', border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.textSecondary, cursor: 'pointer', padding: '0.2rem 0.6rem', fontSize: '0.85rem' } }, '×')),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '0.75rem' } },
        hasValues && stat('start', __('rhdStart', 'Start value'), money(det.startValue), det.startsInside ? __('rhdStartsInside', 'nothing held before') : null),
        hasValues && stat('end', __('rhdEnd', 'End value'), money(det.endValue), det.last ? I.date(det.last) : null),
        hasValues && stat('flow', __('rhdFlow', 'Money in / out'), signed(det.netFlow), null, theme.text),
        hasValues && stat('gain', __('rhdGain', 'Gain'), signed(det.gain), null, tone(det.gain)),
        stat('ret', __('rhdReturn', 'Return (TWR)'), det.ret === null ? '—' : fmt(det.ret), null, det.ret === null ? theme.textSecondary : tone(det.ret), { 'data-r': det.ret === null ? '' : det.ret }),
        stat('acts', __('rhdActivities', 'Activities'), String(det.activities), kinds || null, theme.text, { 'data-n': det.activities })),
      !hasValues && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.74rem', marginTop: '0.6rem' } },
        __('rhdNoValues', 'Start and end values need the daily closing prices.')));
  };
  const frame = flat ? { minWidth: 0 } : { background: theme.card, borderRadius: '16px', boxShadow: theme.shadow, border: `1px solid ${theme.cardBorder}`, padding: '1.25rem', marginBottom: '1.5rem', minWidth: 0 };
  return React.createElement('div', { 'data-testid': tid, style: frame },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.25rem' } },
      React.createElement('h3', { style: { color: theme.text, fontSize: '1rem', fontWeight: 700, margin: 0 } }, title || __('rhTitle', 'Monthly returns')),
      controls || null),
    React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.8rem', margin: '0.25rem 0 0.85rem', lineHeight: 1.5 } },
      srcNote + ' ' + __('rhCompound', 'Quarters and years are compounded, not added up.') + (grid ? ' ' + __('rhdHint', 'Select a cell for its details.') : '')),
    !grid
      ? React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.85rem', padding: '0.75rem 0' } }, __('rhEmpty', 'Not enough history yet for monthly returns.'))
      : React.createElement('div', { role: 'region', tabIndex: 0, 'aria-label': __('rhScrollAria', 'Monthly returns table, scrolls sideways'), style: { overflowX: 'auto', maxWidth: '100%' } },
          React.createElement('table', { style: { borderCollapse: 'separate', borderSpacing: '3px', minWidth: '100%' } },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', { scope: 'col', style: { ...headStyle, textAlign: 'left', position: 'sticky', left: 0, background: flat ? theme.modalBg || theme.card : theme.card } }, __('rhYear', 'Year')),
              months.map((m, i) => React.createElement('th', { key: 'm' + i, scope: 'col', abbr: monthsLong[i], style: headStyle }, m)),
              [1, 2, 3, 4].map((q) => React.createElement('th', { key: 'q' + q, scope: 'col', style: headStyle }, __('rhQuarter', 'Q{n}', { n: q }))),
              React.createElement('th', { scope: 'col', style: headStyle }, __('rhTotal', 'Year')))),
            React.createElement('tbody', null, grid.years.map((Y) => React.createElement('tr', { key: Y.year },
              React.createElement('th', { scope: 'row', style: { ...headStyle, textAlign: 'left', color: theme.text, position: 'sticky', left: 0, background: flat ? theme.modalBg || theme.card : theme.card } }, String(Y.year)),
              Y.months.map((r, i) => cell(r, monthsLong[i] + ' ' + Y.year, 0.1, 'm' + i, !!Y.partial[i], false, { kind: 'm', year: Y.year, idx: i })),
              Y.quarters.map((r, q) => cell(r, __('rhQuarter', 'Q{n}', { n: q + 1 }) + ' ' + Y.year, 0.2, 'q' + q, false, false, { kind: 'q', year: Y.year, idx: q })),
              cell(Y.total, String(Y.year), 0.3, 'y', Object.keys(Y.partial).length > 0, true, { kind: 'y', year: Y.year, idx: 0 })))))),
    grid && grid.years.some((Y) => Object.keys(Y.partial).length) && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.74rem', marginTop: '0.5rem' } },
      __('rhPartialNote', '* part of the month or year only (the history starts or ends inside it).')),
    detailView());
}

function ReturnsView({ transactions, portfolio, prices, priceHistory, theme, formatPrice, getCurrencySymbol, t, fxAt, exchangeRate, valuePath, historyPending, portfolioId, hasWorker, clearing, buildPath }) {
  const R = (typeof window !== 'undefined') ? window.MaerminReturns : null;
  const D = (typeof window !== 'undefined') ? window.MaerminHeatmapDrill : null;
  // Current EUR value over EVERY class in the book (custom categories too),
  // using the same price lookup as MaerminMetrics.
  const currentValue = useMemo(() => {
    let v = 0;
    Object.keys(portfolio || {}).forEach(cat => {
      if (!Array.isArray(portfolio[cat])) return;
      portfolio[cat].forEach(pos => {
        const sym = pos.symbol || pos.name || '';
        const p = prices[sym] || prices[sym.toLowerCase()] || prices[sym.toUpperCase()] || pos.purchasePrice || 0;
        v += (parseFloat(pos.amount) || 0) * p;
      });
    });
    return v;
  }, [portfolio, prices]);

  // P5-1.5: XIRR, total return, purchases, proceeds and fees come from the one
  // module the Overview uses too (MaerminReturnFigures), so both always agree.
  // With a clearing account (P5-1.4) XIRR counts deposits and withdrawals.
  const figs = useMemo(() => window.MaerminReturnFigures.compute(transactions, {
    securitiesValueEUR: currentValue, exchangeRate, fxAt, today: window.MaerminUtils.todayISO(),
    clearings: clearing ? { [portfolioId || 'default']: clearing } : null
  }), [transactions, currentValue, exchangeRate, fxAt, clearing, portfolioId]);
  const xirrResult = transactions.length ? figs.xirr : null;

  // TWR, best source first:
  //   1. the daily value path (transactions × daily closes) - from the first trade
  //   2. the recorded daily value snapshots, chain-linked around deposits
  //   3. the per-refresh price history (needs refreshes on several days)
  const twrInfo = useMemo(() => {
    const VP = window.MaerminValuePath, SN = window.MaerminSnapshots;
    // steps: the chain of period returns behind the figure (monthly heatmap).
    // points: the same chain with values and flows (P5-2.4 drill-down).
    if (valuePath && valuePath.twr !== null) return { source: 'daily', value: valuePath.twr, annualized: valuePath.annualized, since: valuePath.start, missing: valuePath.missing || [],
      steps: (valuePath.points || []).map(p => ({ d: p.d, r: p.r })), points: valuePath.points || [] };
    if (VP && SN && transactions.length) {
      try {
        const pts = SN.seriesFor(SN.load(), portfolioId || SN.ALL);
        const flows = VP.flowsOf(transactions, { exchangeRate, fxAt });
        const r = VP.fromValues(pts, flows);
        if (r) {
          // a snapshot carries the flows since the one before (fromValues books them at the end)
          const rOf = {}; (r.steps || []).forEach(s => { rOf[s.d] = s.r; });
          let prev = '';
          const points = pts.map(p => {
            const d = String(p.d).slice(0, 10);
            const flow = flows.reduce((a, f) => a + (f.d > prev && f.d <= d ? f.amount : 0), 0);
            prev = d;
            return { d, v: p.v, flow, r: rOf[d] !== undefined ? rOf[d] : null };
          });
          return { source: 'snapshots', value: r.twr, annualized: r.annualized, since: r.start, missing: [], steps: r.steps || [], points };
        }
      } catch (e) { /* fall through */ }
    }
    const legacy = (R && R.twrSteps) ? R.twrSteps(priceHistory, portfolio, transactions) : null;
    if (legacy) return { source: 'refresh', value: legacy.twr, annualized: null, since: null, missing: [], steps: legacy.steps };
    const plain = calcTWR(priceHistory, portfolio, transactions);
    return { source: plain !== null ? 'refresh' : 'none', value: plain, annualized: null, since: null, missing: [], steps: [] };
  }, [valuePath, priceHistory, portfolio, transactions, portfolioId, exchangeRate, fxAt, R]);
  // P5-2.4: heatmap filter (asset class / category, tag, holding). The filtered
  // path is the same daily value path over that subset of transactions, without
  // the cash account. Only with daily closes.
  const [hmFilter, setHmFilter] = useState('all');
  useEffect(() => { setHmFilter('all'); }, [portfolioId]);
  const tagsState = useMemo(() => { try { return window.MaerminTags ? window.MaerminTags.load() : null; } catch (e) { return null; } }, [transactions]);
  const hmOptions = useMemo(() => D ? D.options(transactions.filter(tx => tx && tx.category !== 'cashflow'), tagsState) : null, [D, transactions, tagsState]);
  const hmFiltered = useMemo(() => {
    if (!D || !buildPath || hmFilter === 'all' || twrInfo.source !== 'daily') return null;
    const i = hmFilter.indexOf(':');
    const txs = D.filterTransactions(transactions, { kind: hmFilter.slice(0, i), value: hmFilter.slice(i + 1) }, tagsState);
    const p = txs.length ? buildPath(txs) : null;
    const pts = (p && p.points) || [];
    return { txs, points: pts, steps: pts.map(x => ({ d: x.d, r: x.r })) };
    // buildPath is a new function on every render; valuePath changes with its inputs
  }, [D, hmFilter, transactions, tagsState, valuePath, twrInfo.source]);
  const hmControls = (D && buildPath && hmOptions && twrInfo.source === 'daily' && (hmOptions.classes.length + hmOptions.tags.length + hmOptions.holdings.length) > 1)
    ? React.createElement('select', {
        'data-testid': 'rh-filter', 'aria-label': __('rhdFilterAria', 'Show the monthly returns of'), value: hmFilter, onChange: e => setHmFilter(e.target.value),
        style: { padding: '0.4rem 0.6rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder || theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.8rem', maxWidth: '100%' }
      },
        React.createElement('option', { value: 'all' }, __('rhdAll', 'Whole portfolio')),
        React.createElement('optgroup', { label: __('rhdClasses', 'Asset class / category') },
          hmOptions.classes.map(c => React.createElement('option', { key: c, value: 'class:' + c }, window.MaerminI18n.category(c)))),
        hmOptions.tags.length > 0 && React.createElement('optgroup', { label: __('rhdTags', 'Tags') },
          hmOptions.tags.map(n => React.createElement('option', { key: n, value: 'tag:' + n }, n))),
        React.createElement('optgroup', { label: __('rhdHoldings', 'Holdings') },
          hmOptions.holdings.map(h => React.createElement('option', { key: h.key, value: 'holding:' + h.key }, h.symbol + ' (' + window.MaerminI18n.category(h.category) + ')'))))
    : null;
  const twrResult = twrInfo.value;
  const since = twrInfo.since ? window.MaerminI18n.date(twrInfo.since) : '';
  const twrSub = twrInfo.source === 'daily'
    ? (__('retTwrSince', 'Time-weighted, since {date}', { date: since }) + (twrInfo.annualized !== null ? ' · ' + __('retPa', '{pct} p.a.', { pct: window.MaerminI18n.pct(twrInfo.annualized * 100, 2, true) }) : ''))
    : twrInfo.source === 'snapshots' ? __('retSnapshotsSince', 'From daily value snapshots since {date}', { date: since })
    : twrInfo.source === 'refresh' ? __('retFromRefreshes', 'From your price refreshes')
    : __('retNoHistory', 'No price history yet');
  // P5-1.4: say when the cash of the clearing account is part of the figure
  const twrSubCash = twrSub + (twrInfo.source === 'daily' && valuePath && valuePath.cash ? ' · ' + __('retInclCash', 'incl. cash account') : '');

  // Simple holding period stats — every amount in EUR (P5-1.5: from figs).
  const stats = useMemo(() => {
    if (!transactions.length) return null;
    const dates = transactions.map(tx => new Date(tx.date)).sort((a,b)=>a-b);
    const holdingDays = dates.length > 0 ? Math.floor((new Date() - dates[0]) / (24*3600*1000)) : 0;
    return { invested: figs.invested, received: figs.proceeds, currentValue, totalReturn: figs.netReturn,
      totalReturnPct: figs.netReturnPct === null ? 0 : figs.netReturnPct, totalFees: figs.fees, holdingDays };
  }, [transactions, figs, currentValue]);

  const card = (label, value, sub, color) =>
    React.createElement('div', {
      style: { background: theme.card, borderRadius: '16px', boxShadow: theme.shadow, border: `1px solid ${theme.cardBorder}`, padding: '1.25rem' }
    },
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, label),
      React.createElement('div', { style: { color: color || theme.text, fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.02em' } }, value),
      sub && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginTop: '0.25rem' } }, sub)
    );

  const fmtPct = v => v !== null ? window.MaerminI18n.pct(v * 100, 2, true) : '—';
  const color  = v => v > 0 ? theme.success : v < 0 ? theme.danger : theme.text;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.5rem' } }, (t.returnAnalysis || 'Return Analysis')),
    React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: '1.6' } },
      t.returnsHint || 'XIRR (Money-Weighted Return) accounts for the timing and size of your cash flows. TWR shows portfolio performance independent of cash flows.'
    ),

    // Main KPIs
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      card(__('retXirr', 'XIRR (annualized)'), xirrResult !== null ? fmtPct(xirrResult) : '—', clearing ? __('retXirrSubCash', 'Money-weighted p.a., from deposits and withdrawals') : __('retXirrSub', 'Money-weighted return p.a.'), xirrResult !== null ? color(xirrResult) : theme.textSecondary),
      React.createElement('div', { 'data-testid': 'twr-card', 'data-source': twrInfo.source, style: { display: 'contents' } },
        card('TWR', twrResult !== null ? fmtPct(twrResult) : '—', twrSubCash, twrResult !== null ? color(twrResult) : theme.textSecondary)),
      stats && card(__('ovTotalReturn', 'Total Return'), fmtPct(stats.totalReturnPct), `${formatPrice(stats.totalReturn)} ${getCurrencySymbol()}`, color(stats.totalReturnPct)),
      stats && card(__('holdingPeriod', 'Holding Period'), __('retDays', '{n} d', { n: stats.holdingDays }), __('retSinceFirst', 'Since first transaction'), theme.text)
    ),

    stats && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      card(__('retTotalBought', 'Total bought'), `${formatPrice(stats.invested)} ${getCurrencySymbol()}`, __('retTotalBoughtSub', 'All purchases, incl. fees'), theme.text),
      card(__('retCurrentValue', 'Current Value'), `${formatPrice(stats.currentValue)} ${getCurrencySymbol()}`, __('retOpenPositions', 'Open positions'), theme.text),
      card(__('retProceeds', 'Proceeds received'), `${formatPrice(stats.received)} ${getCurrencySymbol()}`, __('retRealizedSub', 'Sales + dividends/interest'), theme.text),
      card(__('retTotalFees', 'Total Fees'), `${formatPrice(stats.totalFees)} ${getCurrencySymbol()}`, __('retAllTx', 'All transactions'), '#ef4444')
    ),

    // P4-1: month × year grid of the same chain of returns
    // P5-2.4: cells open the period's detail; the filter narrows to a subset
    React.createElement(ReturnsHeatmap, hmFiltered
      ? { steps: hmFiltered.steps, points: hmFiltered.points, transactions: hmFiltered.txs, source: 'daily', theme, formatPrice, getCurrencySymbol, controls: hmControls,
          note: __('rhdFilterNote', 'Only the selected holdings, from the same daily closing prices; the cash account is left out.') }
      : { steps: twrInfo.steps, points: twrInfo.points, transactions, source: twrInfo.source, theme, formatPrice, getCurrencySymbol, controls: hmControls }),

    // Explanation
    React.createElement('div', {
      style: { background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '10px', padding: '1rem', fontSize: '0.8rem', color: theme.textSecondary, lineHeight: '1.7' }
    },
      React.createElement('strong', { style: { color: theme.text } }, __('retNote', 'Note:') + ' '),
      twrInfo.source === 'daily'
        ? (__('retNoteDaily', 'TWR is built from your transactions and the daily closing prices since {date}: deposits and withdrawals do not count, fees and dividends do.', { date: since })
          + (twrInfo.missing.length ? ' ' + (historyPending > 0
              ? __('retNotYetIncluded', 'Not included yet: {list} (price history for {n} {n:holding is|holdings are} still loading).', { list: twrInfo.missing.map(m => m.symbol).join(', '), n: historyPending })
              : __('retNotIncluded', 'Not included (no price history available): {list}.', { list: twrInfo.missing.map(m => m.symbol).join(', ') })) : '')
          + ' ' + __('retXirrNeeds', 'XIRR needs at least one buy and the current portfolio value.'))
        : twrInfo.source === 'snapshots'
          ? __('retNoteSnapshots', 'Daily closing prices are not available right now, so TWR is chain-linked from the portfolio values recorded on this device (one per day the app was open).') + ' ' + __('retXirrNeeds', 'XIRR needs at least one buy and the current portfolio value.')
          : ((hasWorker
              ? __('retNoteNotLoaded', 'Daily closing prices for your holdings have not been loaded yet (offline, or the symbols were not found).')
              : __('retNoteNeedWorker', 'Daily closing prices for stocks, ETFs, commodities and skins are loaded through your Worker - add its URL in API Settings.'))
            + ' ' + __('retNoteUntil', 'Until then TWR uses your price refreshes and needs refreshes on several days.') + ' ' + __('retXirrNeeds', 'XIRR needs at least one buy and the current portfolio value.'))
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REBALANCING TOOL
// ─────────────────────────────────────────────────────────────────────────────
// P4-4: the asset-class rebalancing runs on MaerminRebalance.plan(): a
// tolerance band per target (share of the target with a floor in percentage
// points), an "invest only" mode that plans buys from new money without
// selling, and holdings marked "never sell". Targets stay in maermin_targets;
// mode, bands and the never-sell list in maermin_rebalance_prefs.
// P5-1.1 (F2): no default targets (MaerminMetrics.loadTargets). Until the user
// sets some, the view asks for them and plans nothing; targets are saved only
// when the user changes them.
function RebalancingView({ portfolio, prices, theme, formatPrice, getCurrencySymbol, t, setActiveView }) {
  const RB = window.MaerminRebalance;
  const M = window.MaerminMetrics;
  const CATS = ['crypto', 'stocks', 'skins', 'commodities'];
  const [targets, setTargetsState] = useState(() => M.loadTargets());
  const setTargets = (update) => setTargetsState(prev => {
    const next = typeof update === 'function' ? update(prev) : update;
    try { localStorage.setItem(M.REBAL_TARGETS_KEY, JSON.stringify(next)); } catch (e) { /* storage full: keep in memory */ }
    return next;
  });
  const [editing, setEditing] = useState(false);
  const [investAmount, setInvestAmount] = useState('');
  const [prefs, setPrefsState] = useState(() => RB.loadPrefs());
  const setPrefs = (next) => { const n = RB.normalizePrefs(next); RB.savePrefs(n); setPrefsState(n); };

  const totalTarget = Object.values(targets).reduce((s, v) => s + v, 0);
  const I = window.MaerminI18n;
  const money = (v) => `${formatPrice(v)} ${getCurrencySymbol()}`;

  // Holdings per asset class (value at today's price), for the bucket values
  // and the never-sell list.
  const holdings = useMemo(() => {
    const out = [];
    CATS.forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        const sym = String(pos.symbol || pos.name || '');
        const p = prices[sym.toLowerCase()] || prices[sym] || pos.purchasePrice || 0;
        const value = (pos.amount || 1) * p;
        if (value > 0) out.push({ cat, symbol: sym, name: pos.symbolName || sym, value });
      });
    });
    return out.sort((a, b) => b.value - a.value);
  }, [portfolio, prices]);

  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const invest = Math.max(0, (window.MaerminUtils.parseDecimal ? window.MaerminUtils.parseDecimal(investAmount) : parseFloat(investAmount)) || 0);
  const noSellSet = new Set(prefs.noSell);
  const result = useMemo(() => {
    const actual = CATS.map(cat => {
      const hs = holdings.filter(h => h.cat === cat);
      const value = hs.reduce((s, h) => s + h.value, 0);
      const sellable = hs.filter(h => !noSellSet.has(h.symbol.toUpperCase())).reduce((s, h) => s + h.value, 0);
      return { key: cat, value, sellable };
    });
    return RB.plan({ version: 1, basis: 'category', targets }, actual,
      { mode: prefs.mode, contribution: invest, defaultBand: prefs.defaultBand, bands: prefs.bands });
  }, [holdings, targets, prefs, invest]);
  const rowOf = {}; result.rows.forEach(r => { rowOf[r.key] = r; });
  const noTargets = !M.hasTargets(targets);
  const useCurrent = () => {
    const values = {};
    holdings.forEach(h => { values[h.cat] = (values[h.cat] || 0) + h.value; });
    setTargets(M.targetsFromAllocation(values));
  };

  const catColors = { crypto: '#8b7cff', stocks: '#3b82f6', skins: '#06b6d4', commodities: '#fb7185' };
  const catLabels = { crypto: I.category('crypto'), stocks: I.category('stocks'), skins: I.category('skins'), commodities: I.category('commodities') };
  const card = { background: theme.card, borderRadius: '16px', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadow, padding: '1.5rem', marginBottom: '1rem' };
  const small = { color: theme.textSecondary, fontSize: '0.78rem' };
  const inputStyle = { width: '4.5rem', padding: '0.35rem 0.5rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '7px', color: theme.text, fontSize: '0.82rem', textAlign: 'right' };

  // A number field that commits on blur / Enter (typing "2," must not snap back).
  const NumField = ({ value, onCommit, label, suffix, id }) => React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem' } },
    React.createElement('input', {
      key: id + ':' + value, id, type: 'text', inputMode: 'decimal', defaultValue: I.num(value, { min: 0, max: 2 }), 'aria-label': label, style: inputStyle,
      onBlur: (e) => { const v = window.MaerminUtils.parseDecimal(e.target.value); if (isFinite(v) && v >= 0) onCommit(v); else e.target.value = I.num(value, { min: 0, max: 2 }); },
      onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur(); }
    }),
    suffix && React.createElement('span', { style: small }, suffix));

  const bandOf = (cat) => prefs.bands[cat] || prefs.defaultBand;
  const setBand = (cat, patch) => {
    const bands = { ...prefs.bands };
    if (cat === null) { setPrefs({ ...prefs, defaultBand: { ...prefs.defaultBand, ...patch } }); return; }
    bands[cat] = { ...bandOf(cat), ...patch };
    setPrefs({ ...prefs, bands });
  };
  const resetBand = (cat) => { const bands = { ...prefs.bands }; delete bands[cat]; setPrefs({ ...prefs, bands }); };
  const toggleNoSell = (sym) => {
    const k = sym.toUpperCase();
    setPrefs({ ...prefs, noSell: noSellSet.has(k) ? prefs.noSell.filter(x => x !== k) : prefs.noSell.concat(k) });
  };
  const modeBtn = (id, label) => React.createElement('button', {
    type: 'button', 'aria-pressed': prefs.mode === id, 'data-rb-mode': id, onClick: () => setPrefs({ ...prefs, mode: id }),
    style: { padding: '0.45rem 0.85rem', fontSize: '0.8rem', fontWeight: 600, borderRadius: '8px', cursor: 'pointer',
      background: prefs.mode === id ? (theme.accentFill || theme.accent) : 'transparent', color: prefs.mode === id ? '#ffffff' : theme.text,
      border: `1px solid ${prefs.mode === id ? 'transparent' : theme.cardBorder}` }
  }, label);
  const cashflow = prefs.mode === 'cashflow';

  const actionLabel = (r) => {
    if (r.action === 'buy') return `${__('rbBuy', '+ Buy')} ${money(r.deltaValue)}`;
    if (r.action === 'sell') return `${__('rbSell', '− Sell')} ${money(-r.deltaValue)}`;
    if (r.blockedSell > 0.005) return __('rbHoldBlocked', 'Hold (never-sell holdings)');
    return Math.abs(r.driftPp) <= r.bandPp ? __('rbWithinBand', '✓ Within ±{pp} pp', { pp: I.num(r.bandPp, { min: 0, max: 1 }) }) : __('rbBalanced', '✓ Balanced');
  };

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' } },
      React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', margin: 0 } }, (t.rebalancing || 'Rebalancing'))),

    // This view rebalances by ASSET CLASS. Tag-based target weights live in the Tags view.
    (setActiveView && window.MaerminTags) ? React.createElement('button', {
      onClick: () => setActiveView('tags'),
      style: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginBottom: '1.25rem', padding: '0.5rem 0.85rem', background: 'transparent', color: theme.accent, border: `1px solid ${theme.accent}55`, borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }
    }, '⛯ ', (t.rebalanceByTagHint || 'Rebalance by tag instead → Tags view')) : null,

    // No targets yet: nothing to plan until the user sets them.
    noTargets && !editing && React.createElement('div', { 'data-testid': 'rb-no-targets', style: card },
      React.createElement('div', { style: { color: theme.text, fontWeight: 700, marginBottom: '0.4rem' } }, __('rbNoTargetsTitle', 'No target allocation yet')),
      React.createElement('p', { style: { ...small, fontSize: '0.85rem', margin: '0 0 1rem', lineHeight: 1.55 } },
        __('rbNoTargetsText', 'Rebalancing compares your holdings with target weights that you choose. Nothing is suggested until you set them.')),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' } },
        holdings.length > 0 && React.createElement('button', {
          type: 'button', 'data-rb-use-current': true, onClick: useCurrent,
          style: { padding: '0.55rem 1rem', fontSize: '0.85rem', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', border: 'none',
            background: theme.accentFill || theme.accent, color: '#ffffff' }
        }, __('rbUseCurrent', 'Use my current allocation')),
        React.createElement('button', {
          type: 'button', 'data-rb-set-targets': true, onClick: () => setEditing(true),
          style: { padding: '0.55rem 1rem', fontSize: '0.85rem', fontWeight: 600, borderRadius: '8px', cursor: 'pointer',
            background: 'transparent', color: theme.text, border: `1px solid ${theme.cardBorder}` }
        }, __('rbSetTargets', 'Set targets')))),

    // Mode + new money
    !noTargets && React.createElement('div', { style: card },
      React.createElement('div', { role: 'group', 'aria-label': __('rbModeAria', 'How to rebalance'), style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' } },
        modeBtn('full', __('rbModeFull', 'Buy and sell')), modeBtn('cashflow', __('rbModeCash', 'Invest only (no sales)'))),
      React.createElement('p', { style: { ...small, margin: '0 0 0.9rem', lineHeight: 1.5 } }, cashflow
        ? __('rbModeCashHint', 'New money goes to the classes furthest below target, in proportion to the gap. Nothing is sold.')
        : __('rbModeFullHint', 'Classes outside their tolerance band go back to target: sales first, then buys from the sales and any new money.')),
      React.createElement('label', { htmlFor: 'rb-invest', style: { ...small, display: 'block', marginBottom: '0.375rem' } },
        cashflow ? __('rbInvestAmount', 'Amount to invest') : (t.additionalInvestment || 'Additional amount (optional)')),
      React.createElement('input', {
        id: 'rb-invest', type: 'text', inputMode: 'decimal', value: investAmount,
        onChange: e => setInvestAmount(e.target.value),
        placeholder: I.num(0, { min: 2, max: 2 }),
        style: { width: '200px', padding: '0.5rem 0.75rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem' }
      })
    ),

    // Target allocation + tolerance per target
    (!noTargets || editing) && React.createElement('div', { style: card },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' } },
        React.createElement('span', { style: { color: theme.text, fontWeight: '700' } }, t.targetAllocation || 'Target Allocation'),
        React.createElement('span', {
          style: { fontSize: '0.8rem', color: totalTarget === 100 ? theme.success : theme.danger, fontWeight: '600' }
        }, `${I.pct(totalTarget, 0)} ${totalTarget === 100 ? '✓' : '≠ ' + I.pct(100, 0)}`)
      ),
      !cashflow && React.createElement('div', { 'data-testid': 'rb-default-band', style: { ...small, display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem', lineHeight: 1.8 } },
        __('rbBandDefault', 'Tolerance for every class:'),
        NumField({ id: 'rb-band-rel', value: prefs.defaultBand.rel * 100, label: __('rbBandRelAria', 'Tolerance as a share of the target, in percent'), suffix: __('rbBandRelSuffix', '% of the target,'), onCommit: (v) => setBand(null, { rel: Math.min(v, 100) / 100 }) }),
        __('rbBandAtLeast', 'at least'),
        NumField({ id: 'rb-band-abs', value: prefs.defaultBand.abs, label: __('rbBandAbsAria', 'Minimum tolerance in percentage points'), suffix: __('rbBandAbsSuffix', 'pp'), onCommit: (v) => setBand(null, { abs: Math.min(v, 100) }) })),
      CATS.map(cat => {
        const r = rowOf[cat] || { bandPp: 0 };
        const own = !!prefs.bands[cat];
        return React.createElement('div', { key: cat, style: { marginBottom: '1rem' } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' } },
            React.createElement('label', { htmlFor: 'rb-t-' + cat, style: { color: catColors[cat], fontWeight: '600', fontSize: '0.875rem' } }, catLabels[cat]),
            React.createElement('span', { style: { color: theme.text, fontWeight: '700' } }, I.pct(targets[cat] || 0, 0))
          ),
          React.createElement('input', {
            id: 'rb-t-' + cat, type: 'range', min: 0, max: 100, value: targets[cat] || 0,
            onChange: e => setTargets(prev => ({ ...prev, [cat]: parseInt(e.target.value) })),
            style: { width: '100%', accentColor: catColors[cat] }
          }),
          !cashflow && React.createElement('details', { 'data-rb-band': cat, open: own, style: { ...small, marginTop: '0.2rem' } },
            React.createElement('summary', { style: { cursor: 'pointer', minHeight: '24px', display: 'list-item', paddingTop: '0.2rem' } },
              __('rbBandRow', 'Tolerance ±{pp} pp', { pp: I.num(r.bandPp, { min: 0, max: 1 }) }) + (own ? ' · ' + __('rbBandOwn', 'own setting') : '')),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem', lineHeight: 1.8 } },
              NumField({ id: 'rb-rel-' + cat, value: bandOf(cat).rel * 100, label: __('rbBandRelFor', 'Tolerance for {name} as a share of the target, in percent', { name: catLabels[cat] }), suffix: __('rbBandRelSuffix', '% of the target,'), onCommit: (v) => setBand(cat, { rel: Math.min(v, 100) / 100 }) }),
              __('rbBandAtLeast', 'at least'),
              NumField({ id: 'rb-abs-' + cat, value: bandOf(cat).abs, label: __('rbBandAbsFor', 'Minimum tolerance for {name} in percentage points', { name: catLabels[cat] }), suffix: __('rbBandAbsSuffix', 'pp'), onCommit: (v) => setBand(cat, { abs: Math.min(v, 100) }) }),
              own && React.createElement('button', { type: 'button', onClick: () => resetBand(cat), style: { background: 'transparent', border: `1px solid ${theme.cardBorder}`, color: theme.textSecondary, borderRadius: '7px', padding: '0.2rem 0.55rem', cursor: 'pointer', fontSize: '0.75rem', minHeight: '24px' } }, __('rbBandUseDefault', 'Use the default'))))
        );
      })
    ),

    // Never sell
    !noTargets && holdings.length > 0 && React.createElement('details', { 'data-testid': 'rb-nosell', style: { ...card, padding: '1rem 1.5rem' } },
      React.createElement('summary', { style: { cursor: 'pointer', color: theme.text, fontWeight: 700, fontSize: '0.9rem', minHeight: '24px' } },
        __('rbNoSellTitle', 'Holdings you never sell ({n})', { n: prefs.noSell.filter(s => holdings.some(h => h.symbol.toUpperCase() === s)).length })),
      React.createElement('p', { style: { ...small, margin: '0.5rem 0 0.75rem', lineHeight: 1.5 } },
        __('rbNoSellHint', 'A class can only be sold down with the holdings that are not marked here. What cannot be sold is shown in the plan.')),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.35rem' } },
        holdings.map(h => React.createElement('label', { key: h.cat + '|' + h.symbol, style: { display: 'flex', alignItems: 'center', gap: '0.6rem', minHeight: '28px', color: theme.text, fontSize: '0.84rem', cursor: 'pointer' } },
          React.createElement('input', { type: 'checkbox', checked: noSellSet.has(h.symbol.toUpperCase()), onChange: () => toggleNoSell(h.symbol), 'data-nosell': h.symbol, style: { width: '24px', height: '24px', margin: 0, accentColor: theme.accent } }),
          React.createElement('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, h.name, React.createElement('span', { style: { ...small, marginLeft: '0.4rem' } }, catLabels[h.cat])),
          React.createElement('span', { style: small }, money(h.value)))))
    ),

    // Results table
    totalValue > 0 && !noTargets && React.createElement('div', {
      'data-testid': 'rb-plan', style: { background: theme.card, borderRadius: '16px', border: `1px solid ${theme.cardBorder}`, boxShadow: theme.shadow, overflow: 'hidden' }
    },
      React.createElement('div', { style: { padding: '1rem 1.25rem', borderBottom: `1px solid ${theme.cardBorder}` } },
        React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, t.rebalancingPlan || 'Rebalancing Plan'),
        React.createElement('div', { 'data-testid': 'rb-summary', style: { ...small, marginTop: '0.3rem', lineHeight: 1.5 } },
          [(result.summary.toBuy > 0.005 || result.summary.toSell > 0.005) ? __('rbSumBuy', 'Buy {amt}', { amt: money(result.summary.toBuy) }) : __('rbSumNothing', 'Nothing to buy or sell'),
           !cashflow && result.summary.toSell > 0.005 && __('rbSumSell', 'sell {amt}', { amt: money(result.summary.toSell) }),
           result.summary.cashLeft > 0.005 && __('rbSumCashLeft', '{amt} stays uninvested (after these trades every class is within its band)', { amt: money(result.summary.cashLeft) }),
           result.summary.blocked > 0.005 && __('rbSumBlocked', '{amt} cannot be sold (never-sell holdings)', { amt: money(result.summary.blocked) })
          ].filter(Boolean).join(' · '))
      ),
      React.createElement('div', { role: 'region', tabIndex: 0, 'aria-label': t.rebalancingPlan || 'Rebalancing Plan', style: { overflowX: 'auto' } },
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
        React.createElement('thead', null,
          React.createElement('tr', null,
            [__('category', 'Category'), __('rbCurrent', 'Current'), __('rbCurrentPct', 'Current %'), __('rbTargetPct', 'Target %'), __('targetValue', 'Target Value'), __('action', 'Action')].map((h, i) =>
              React.createElement('th', {
                key: i,
                style: { padding: '0.75rem 1rem', textAlign: i === 0 ? 'left' : 'right', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase' }
              }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          CATS.map(cat => {
            const r = rowOf[cat];
            // Only classes the user holds or has a target for.
            if (!r || (!(r.actualValue > 0.005) && !(r.targetPct > 0))) return null;
            const tone = r.action === 'buy' ? theme.success : r.action === 'sell' ? theme.danger : (r.blockedSell > 0.005 ? theme.warning : theme.success);
            return React.createElement('tr', { key: cat, 'data-rb-row': cat, 'data-action': r.action },
              React.createElement('td', { style: { padding: '1rem', fontWeight: '700', color: catColors[cat] } }, catLabels[cat]),
              React.createElement('td', { style: { padding: '1rem', color: theme.text, textAlign: 'right' } }, money(r.actualValue)),
              React.createElement('td', { style: { padding: '1rem', textAlign: 'right' } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' } },
                  React.createElement('div', { style: { width: 40, height: 4, background: theme.inputBg, borderRadius: 2, overflow: 'hidden' } },
                    React.createElement('div', { style: { height: '100%', width: `${Math.min(100, r.actualPct)}%`, background: catColors[cat], borderRadius: 2 } })
                  ),
                  React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.875rem', minWidth: '3rem', textAlign: 'right' } }, I.pct(r.actualPct, 1))
                )
              ),
              React.createElement('td', { style: { padding: '1rem', color: theme.text, textAlign: 'right', fontWeight: '600' } }, I.pct(r.targetPct, 0)),
              React.createElement('td', { style: { padding: '1rem', color: theme.text, textAlign: 'right' } }, money(r.targetValue)),
              React.createElement('td', { style: { padding: '1rem', textAlign: 'right' } },
                React.createElement('span', { style: { padding: '0.25rem 0.75rem', borderRadius: '6px', fontWeight: '700', fontSize: '0.8rem', whiteSpace: 'nowrap', border: `1px solid ${tone}55`, color: tone } }, actionLabel(r)),
                r.blockedSell > 0.005 && r.action !== 'hold' && React.createElement('div', { style: { ...small, marginTop: '0.25rem' } },
                  __('rbBlockedRow', '{amt} not sold (never-sell holdings)', { amt: money(r.blockedSell) })))
            );
          })
        )
      ))
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT PARSERS
// ─────────────────────────────────────────────────────────────────────────────

// ── Broker parsers entry point ───────────────────────────────────────────────
function parseByBroker(text, brokerId) {
  // CoinTracking: the shared parser (two legs per row, three "Cur." columns).
  if (brokerId === 'cointracking') {
    const IM = window.MaerminImportMapping;
    return IM && IM.parseCoinTracking ? IM.parseCoinTracking(text).transactions : [];
  }
  // For other brokers, fall through to ImportExportEngine
  const engine = window.ImportExportEngine;
  if (!engine) return [];
  try {
    const result = engine.importData(text, 'csv', { broker: brokerId });
    return result?.transactions || [];
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. BROKER IMPORT WIZARD
// ─────────────────────────────────────────────────────────────────────────────

// Inline SVG/PNG data-URIs der Broker-Logos — keine externe Abhängigkeit
const BROKER_LOGOS = {
  cointracking: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#1a73e8"/><text x="50" y="68" font-size="52" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">CT</text></svg>`,
  getquin:      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#00c805"/><text x="50" y="68" font-size="52" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">gq</text></svg>`,
  degiro:       `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#ff6600"/><text x="50" y="68" font-size="42" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">DE</text></svg>`,
  tradeRepublic:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#111"/><text x="50" y="68" font-size="52" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">TR</text></svg>`,
  interactiveBrokers:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#d40000"/><text x="50" y="68" font-size="52" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">IB</text></svg>`,
  coinbase:     `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#0052ff"/><circle cx="50" cy="50" r="28" fill="white"/><circle cx="50" cy="50" r="18" fill="#0052ff"/></svg>`,
  binance:      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#f0b90b"/><text x="50" y="63" font-size="34" font-weight="900" font-family="Arial,sans-serif" fill="#111" text-anchor="middle">BNB</text></svg>`,
  kraken:       `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#5741d9"/><text x="50" y="63" font-size="34" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">KRK</text></svg>`,
  generic:      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#334155"/><text x="50" y="65" font-size="42" font-family="Arial,sans-serif" fill="#94a3b8" text-anchor="middle">CSV</text></svg>`,
};

function svgToDataUri(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function BrokerLogo({ brokerId, name, size = 36 }) {
  const svg = BROKER_LOGOS[brokerId];
  if (!svg) {
    return React.createElement('div', {
      style: {
        width: size, height: size, borderRadius: '8px', flexShrink: 0,
        background: 'rgba(139,124,255,0.15)', border: '1px solid rgba(139,124,255,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.42) + 'px', fontWeight: '800', color: '#8b7cff',
      }
    }, (name || '?')[0].toUpperCase());
  }
  return React.createElement('img', {
    src: svgToDataUri(svg),
    alt: name,
    style: { width: size, height: size, borderRadius: '8px', flexShrink: 0, display: 'block' }
  });
}

// Category id of the tracker tiles (label via biCatTracker).
const CAT_TRACKER = 'Portfolio Tracker';
const BROKERS = [
  { id: 'cointracking',       name: 'CoinTracking',        hint: 'CSV Full Export',              category: CAT_TRACKER },
  { id: 'portfolioPerformance', name: 'Portfolio Performance', hint: '', hintKey: 'bhPpCsv', category: CAT_TRACKER },
  { id: 'parqet',             name: 'Parqet',               hint: '', hintKey: 'bhParqetCsv', category: CAT_TRACKER },
  { id: 'getquin',            name: 'getquin',              hint: 'No CSV export available', hintKey: 'bhNoExport', category: CAT_TRACKER, noExport: true },
  { id: 'degiro',             name: 'DEGIRO',               hint: 'Transactions.csv',             category: 'Broker' },
  { id: 'tradeRepublic',      name: 'Trade Republic',       hint: 'Transaction history CSV', hintKey: 'bhTxHistory', category: 'Broker' },
  { id: 'scalable',           name: 'Scalable Capital',     hint: 'Transaction report CSV', hintKey: 'bhTxReport', category: 'Broker' },
  { id: 'interactiveBrokers', name: 'Interactive Brokers',  hint: 'Activity Statement CSV',       category: 'Broker' },
  { id: 'coinbase',           name: 'Coinbase',             hint: 'Standard CSV export', hintKey: 'bhStandard', category: 'Crypto' },
  { id: 'binance',            name: 'Binance',              hint: 'Trade History CSV',            category: 'Crypto' },
  { id: 'kraken',             name: 'Kraken',               hint: 'Ledger CSV',                   category: 'Crypto' },
  { id: 'generic',            name: 'Other / Manual',       hint: 'MAERMIN standard CSV / JSON', hintKey: 'bhMaermin',  category: 'Other' },
];

// Import field ids -> labels.
function fieldLabel(f) {
  return ({ date: __('date', 'Date'), type: __('type', 'Type'), symbol: __('symbol', 'Symbol'), quantity: __('quantity', 'Quantity'), price: __('price', 'Price'), fee: __('feeFee', 'Fee'), currency: __('currency', 'Currency') })[f] || f;
}

function BrokerImportWizard({ theme, t, addToast, onImport, existing, workerUrl }) {
  const [step, setStep]             = useState(0);
  const [selectedBroker, setBroker] = useState(null);
  const [rawData, setRawData]       = useState('');
  const [parsed, setParsed]         = useState([]);
  const [fileName, setFileName]     = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const fileRef = useRef();

  // ── Smart mapping preview (window.MaerminImportMapping) ───────────────────
  // mp = { headers, broker, mapping, transactions(dup-flagged), errors, stats }.
  // mapping is user-editable; editing re-runs preview() so the table, errors and
  // duplicate count update live before anything is imported.
  const [mpRaw, setMp]              = useState(null);
  const [mapping, setMapping]       = useState(null);
  const [includeDupes, setIncludeDupes] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  // Reusable CSV import presets (WI-8): saved column mappings for unknown brokers.
  const [presets, setPresets]       = useState(() => {
    try { return (window.MaerminImportMapping && window.MaerminImportMapping.loadPresets) ? window.MaerminImportMapping.loadPresets().presets : []; }
    catch (e) { return []; }
  });
  const [selectedPreset, setSelectedPreset] = useState('');

  const catHint = /crypto/i.test((BROKERS.find(b => b.id === selectedBroker) || {}).category || '') ? 'crypto' : undefined;

  // ── ISIN → ticker (MaerminImportMapping.applyTickerMap) ──────────────────
  // Broker files carry ISINs; quotes need a listing. For every ISIN in the
  // preview the Worker's symbol search is asked for its listings and the one
  // matching the trade currency is proposed. isinPicks holds the (editable)
  // choice per ISIN; `mp` is the preview with those tickers applied, so the
  // table, the duplicate check and the import all see the final symbols.
  const [isinPicks, setIsinPicks]   = useState({});   // { ISIN: { symbol, name, currencyMismatch } }
  const [isinCands, setIsinCands]   = useState({});   // { ISIN: [candidates] }
  const [isinBusy, setIsinBusy]     = useState(false);
  const isinList = useMemo(() => {
    const IM = window.MaerminImportMapping;
    return (IM && IM.collectIsins && mpRaw) ? IM.collectIsins(mpRaw.transactions) : [];
  }, [mpRaw]);
  const isinKey = isinList.map(x => x.isin + ':' + x.currency).join(',');
  useEffect(() => {
    const IM = window.MaerminImportMapping;
    if (!IM || !isinList.length) { setIsinPicks({}); setIsinCands({}); setIsinBusy(false); return; }
    let cancelled = false;
    setIsinBusy(true);
    IM.resolveIsins(isinList, { workerBase: workerUrl }).then(found => {
      if (cancelled) return;
      const picks = {};
      isinList.forEach(x => { const p = IM.pickListing(found[x.isin], x.currency); if (p) picks[x.isin] = p; });
      setIsinCands(found);
      // Keep anything the user already chose for an ISIN that is still present.
      setIsinPicks(prev => { const next = Object.assign({}, picks); Object.keys(prev).forEach(k => { if (prev[k] && prev[k].manual && found[k] !== undefined) next[k] = prev[k]; }); return next; });
      setIsinBusy(false);
    });
    return () => { cancelled = true; };
  }, [isinKey, workerUrl]);
  const setIsinTicker = (isin, symbol, name) => setIsinPicks(prev => Object.assign({}, prev, { [isin]: { symbol: String(symbol || '').trim().toUpperCase(), name: name || '', manual: true } }));
  const mp = useMemo(() => {
    const IM = window.MaerminImportMapping;
    if (!mpRaw || !isinList.length || !IM || !IM.applyTickerMap) return mpRaw;
    return IM.applyTickerMap(mpRaw, isinPicks, existing || []);
  }, [mpRaw, isinPicks, isinKey, existing]);

  // Build the preview whenever fresh raw data arrives (auto-detects broker +
  // column mapping). Editing the mapping goes through updateMapping() instead, so
  // this effect never fights user edits.
  useEffect(() => {
    const IM = window.MaerminImportMapping;
    if (!IM || !rawData || rawData === ' ') { setMp(null); setMapping(null); return; }
    try {
      const prev = IM.preview(rawData, { existing: existing || [], category: catHint, broker: selectedBroker });
      setMapping(prev.mapping);
      setMp(prev);
    } catch (e) { console.error('[IMPORT] mapping preview error:', e); setMp(null); }
  }, [rawData]);

  // Re-run the preview with a user-edited column → field mapping.
  const updateMapping = (field, header) => {
    const IM = window.MaerminImportMapping;
    const next = Object.assign({}, mapping, { [field]: header || null });
    setMapping(next);
    if (IM && rawData) {
      try { setMp(IM.preview(rawData, { existing: existing || [], category: catHint, mapping: next, broker: selectedBroker })); }
      catch (e) { console.error('[IMPORT] remap error:', e); }
    }
  };

  // Import the validated, de-duplicated rows from the mapping preview.
  const doImportMapped = () => {
    const IM = window.MaerminImportMapping;
    if (!IM || !mp) return;
    const out = IM.commit(mp, { includeDuplicates: includeDupes });
    if (!out.transactions.length) { addToast && addToast(__('biNothing', 'Nothing to import'), 'warning'); return; }
    onImport && onImport(out.transactions);
    setImportedCount(out.transactions.length);
    setStep(3);
    addToast && addToast(__('txImportedN', '{n} {n:transaction|transactions} imported', { n: out.transactions.length }) + (out.skipped ? ' · ' + __('biDupSkipped', '{n} {n:duplicate|duplicates} skipped', { n: out.skipped }) : ''), 'success');
  };

  // --- import presets (WI-8): save / load / delete the current column mapping ---
  const refreshPresets = () => {
    const IM = window.MaerminImportMapping;
    try { setPresets(IM && IM.loadPresets ? IM.loadPresets().presets : []); } catch (e) { /* ignore */ }
  };
  const applyPresetById = (id) => {
    const IM = window.MaerminImportMapping;
    setSelectedPreset(id);
    if (!IM || !id || !mp) return;
    const preset = IM.getPreset(IM.loadPresets(), id);
    if (!preset) return;
    const res = IM.applyPreset(preset, mp.headers);
    setMapping(res.mapping);
    try { setMp(IM.preview(rawData, { existing: existing || [], category: res.category || catHint, mapping: res.mapping, broker: selectedBroker })); }
    catch (e) { console.error('[IMPORT] preset apply error:', e); }
    if (res.missing.length) addToast && addToast(__('biPresetApplied', 'Preset applied') + ' · ' + __('biPresetMissing', '{n} {n:column|columns} not found in this file', { n: res.missing.length }), 'warning');
    else addToast && addToast(__('biPresetApplied', 'Preset applied'), 'success');
  };
  const saveCurrentPreset = () => {
    const IM = window.MaerminImportMapping;
    if (!IM || !mapping) return;
    const name = (typeof prompt === 'function') ? prompt(__('biPresetName', 'Preset name (e.g. your broker):')) : null;
    if (!name) return;
    const preset = IM.buildPreset({ name, mapping, category: (mp && mp.category) || catHint || 'stocks' });
    const next = IM.upsertPreset(IM.loadPresets(), preset);
    IM.savePresets(next);
    refreshPresets();
    addToast && addToast(__('biPresetSaved', 'Mapping preset saved'), 'success');
  };
  const deleteSelectedPreset = () => {
    const IM = window.MaerminImportMapping;
    if (!IM || !selectedPreset) return;
    IM.savePresets(IM.removePreset(IM.loadPresets(), selectedPreset));
    setSelectedPreset('');
    refreshPresets();
    addToast && addToast(__('biPresetDeleted', 'Preset deleted'), 'info');
  };

  const selectedBrokerObj = BROKERS.find(b => b.id === selectedBroker);
  // Exchanges with a read-only API are synced via the Exchange sync panel
  // (MaerminExchangeSync, keys kept in the vault) shown below this wizard.
  const exchangeSyncSupported = !!(window.MaerminExchangeSync && ['binance', 'kraken', 'coinbase'].includes(selectedBroker));

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = e => { setRawData(e.target.result); setStep(2); };
    reader.readAsText(file, 'UTF-8');
  };

  // PDF statements (Trade Republic, Scalable, ING, DKB, Comdirect): extract +
  // parse fully client-side via MaerminPdfImport, then feed the candidates as
  // CSV into the SAME mapping preview flow below — one import pipeline, with
  // the editable preview as the safety net for layout drift. Several PDFs can
  // be dropped at once; per-file problems surface as toasts, the rest imports.
  const [pdfBusy, setPdfBusy] = useState(false);
  const handlePdfFiles = (files) => {
    const PI = window.MaerminPdfImport;
    if (!PI) { addToast && addToast(__('biPdfMissing', 'PDF import module not loaded'), 'error'); return; }
    setPdfBusy(true);
    setFileName(files.length === 1 ? files[0].name : __('biPdfStatements', '{n} PDF statements', { n: files.length }));
    PI.parseFiles(files).then(out => {
      setPdfBusy(false);
      out.errors.slice(0, 3).forEach(e => addToast && addToast(e, 'warning'));
      if (!out.candidates.length) {
        addToast && addToast(__('biPdfNone', 'No transactions recognised in the PDF(s) - is it a settlement statement?'), 'error');
        return;
      }
      addToast && addToast(__('biPdfRecognised', '{n} {n:transaction|transactions} recognised', { n: out.candidates.length }) + (out.brokers.length ? ' (' + out.brokers.join(', ') + ')' : '') + ' - ' + __('biReviewFirst', 'review before importing'), 'success');
      setRawData(out.csv);
      setStep(2);
    }).catch(e => {
      setPdfBusy(false);
      addToast && addToast(__('biPdfFailed', 'PDF parsing failed: {msg}', { msg: (e && e.message) || e }), 'error');
    });
  };

  // Route a dropped/picked selection: PDFs go through the PDF pipeline, the
  // first non-PDF file keeps the legacy text path.
  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdfs.length) handlePdfFiles(pdfs);
    else handleFile(files[0]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  useEffect(() => {
    if (!rawData || !selectedBroker || selectedBroker === 'getquin') return;
    try {
      const txs = parseByBroker(rawData, selectedBroker);
      // No toast when this legacy parser finds nothing: the mapping preview
      // above is the real pipeline and reports its own result ("✓ N valid"),
      // so a "No transactions detected" toast next to it was contradictory.
      // The step-2 paste fallback still says so when BOTH found nothing.
      setParsed(Array.isArray(txs) ? txs : []);
    } catch(e) {
      console.error('[IMPORT] Parse error:', e);
      addToast && addToast(__('biParseError', 'Parsing error: {msg}', { msg: e.message }), 'error');
    }
  }, [rawData, selectedBroker]);

  const doImport = () => {
    if (!parsed.length) return;
    onImport && onImport(parsed);
    setImportedCount(parsed.length);
    setStep(3);
    addToast && addToast(__('txImportedN', '{n} {n:transaction|transactions} imported', { n: parsed.length }), 'success');
  };

  const reset = () => { setStep(0); setBroker(null); setRawData(''); setParsed([]); setFileName(''); };

  const btn = (label, onClick, primary=false, disabled=false) =>
    React.createElement('button', {
      onClick, disabled,
      style: {
        padding: '0.625rem 1.25rem', border: 'none', borderRadius: '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: '600', fontSize: '0.875rem', opacity: disabled ? 0.5 : 1,
        background: primary ? (theme.accentFill || theme.accent) : theme.inputBg,
        color: primary ? '#fff' : theme.text
      }
    }, label);

  const steps = [__('biStepSource', 'Select source'), __('biStepLoad', 'Load file'), __('biStepPreview', 'Preview'), __('biStepDone', 'Done')];

  // Say before importing how rows in another currency will be converted:
  // CHF, GBP & co. at the rate of each trade date (loaded through the Worker
  // after the import); a currency with no rate at all (e.g. a BTC or BNB
  // quote) would be counted as EUR.
  const currencyNotice = (txs) => {
    const FXH = window.MaerminFxHistory;
    const rep = (FXH && FXH.currencyReport) ? FXH.currencyReport(txs) : [];
    if (!rep.length) return null;
    const bad = rep.some(r => r.status === 'unknown');
    return React.createElement('div', { role: 'status', style: { background: bad ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.08)', border: `1px solid ${bad ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`, borderRadius: '8px', padding: '0.6rem 0.8rem', marginBottom: '0.9rem', fontSize: '0.78rem', color: theme.text, lineHeight: 1.6 } },
      rep.map(r => React.createElement('div', { key: r.currency },
        React.createElement('strong', null, __('biCurRows', '{n} {n:row|rows} in {cur}:', { n: r.count, cur: r.currency }) + ' '),
        r.status === 'unknown'
          ? __('biCurUnknown', 'no exchange rate - these amounts would be counted as EUR. Fix the currency column (or the source file) before importing.')
          : r.status === 'history'
            ? __('biCurHistory', "will be converted at the {cur} rate of each trade date. The rates are loaded through your Worker after the import; until then (or without a Worker) today's rate is used and the Data check lists them.", { cur: r.currency })
            : __('biCurToday', "converted with today's {cur} rate for every date (no daily history for this currency).", { cur: r.currency }))));
  };

  // Group brokers by category
  const categories = [...new Set(BROKERS.map(b => b.category))];

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1.25rem' } },
      (t.brokerImport || 'Import')
    ),

    // Step indicator
    React.createElement('div', { style: { display: 'flex', gap: '0', marginBottom: '2rem', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${theme.cardBorder}` } },
      steps.map((s, i) =>
        React.createElement('div', { key: i, style: {
          flex: 1, padding: '0.625rem', textAlign: 'center', fontSize: '0.8rem',
          fontWeight: i === step ? '700' : '400',
          background: i === step ? (theme.accentFill || theme.accent) : i < step ? 'rgba(139,124,255,0.15)' : theme.card,
          color: i === step ? '#ffffff' : i < step ? theme.accent : theme.textSecondary,
          borderRight: i < steps.length-1 ? `1px solid ${theme.cardBorder}` : 'none'
        } }, `${i < step ? '✓ ' : ''}${s}`)
      )
    ),

    // ── Step 0: Source select ────────────────────────────────────────────────
    step === 0 && React.createElement('div', null,
      categories.map(cat =>
        React.createElement('div', { key: cat, style: { marginBottom: '1.25rem' } },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.68rem', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem', paddingLeft: '0.25rem' } }, ({ 'Portfolio Tracker': __('biCatTracker', 'Portfolio Tracker'), Broker: __('biCatBroker', 'Broker'), Crypto: __('crypto', 'Crypto'), Other: __('biCatOther', 'Other') })[cat] || cat),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0.625rem' } },
            BROKERS.filter(b => b.category === cat).map(b =>
              React.createElement('div', {
                key: b.id,
                ...window.MaerminUtils.clickable(() => { setBroker(b.id); setStep(1); }),
                'aria-label': __('biSelectBroker', 'Select broker {name}', { name: b.name || b.id }),
                style: {
                  background: selectedBroker === b.id ? `${theme.accent}22` : theme.card,
                  border: `1px solid ${selectedBroker === b.id ? theme.accent : theme.cardBorder}`,
                  borderRadius: '10px', padding: '0.875rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.75rem', transition: 'all 0.15s',
                  opacity: b.noExport ? 0.75 : 1
                }
              },
                React.createElement(BrokerLogo, { brokerId: b.id, name: b.name, size: 36 }),
                React.createElement('div', null,
                  React.createElement('div', { style: { color: theme.text, fontWeight: '600', fontSize: '0.875rem' } }, b.name),
                  React.createElement('div', { style: { color: b.noExport ? theme.warning : theme.textSecondary, fontSize: '0.7rem', marginTop: '0.125rem' } }, b.hintKey ? __(b.hintKey, b.hint) : b.hint)
                )
              )
            )
          )
        )
      )
    ),

    // ── Step 1: getquin info OR file upload ──────────────────────────────────
    step === 1 && selectedBroker === 'getquin' && React.createElement('div', null,
      React.createElement('div', {
        style: { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '16px', padding: '1.5rem', marginBottom: '1.5rem' }
      },
        
        React.createElement('h3', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.75rem' } }, __('biGetquinTitle', 'getquin has no CSV export')),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem', lineHeight: '1.7', marginBottom: '1rem' } },
          __('biGetquinBody', 'getquin does not let you export your transactions. Once the data is in there, it is "locked in" — that is a deliberate design decision by the app.')
        ),
        React.createElement('div', { style: { color: theme.text, fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' } }, __('biYourOptions', 'Your options:')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', lineHeight: '2' } },
          React.createElement('div', null, __('biOpt1', '① Enter transactions manually in MAERMIN (+ Symbol key, or Add Transaction)')),
          React.createElement('div', null, __('biOpt2', '② Export the original broker CSV and import it here (e.g. DEGIRO, Trade Republic, Coinbase)')),
          React.createElement('div', null, __('biOpt3', '③ Take a screenshot of your getquin positions and enter them manually'))
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
        btn(__('back', '← Back'), reset),
        btn(__('biAddManually', 'Add manually'), () => { addToast && addToast(__('biUsePlusTx', 'Use "+ Transaction" to enter positions manually'), 'info'); reset(); })
      )
    ),

    // ── Step 1: CoinTracking info + file upload ──────────────────────────────
    step === 1 && selectedBroker === 'cointracking' && React.createElement('div', null,
      React.createElement('div', {
        style: { background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', fontSize: '0.8rem', color: theme.textSecondary, lineHeight: '1.8' }
      },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.375rem' } }, __('biCtInstr', 'CoinTracking export instructions:')),
        React.createElement('div', null, '1. ' + __('biCtStep1', 'In CoinTracking:') + ' ', React.createElement('b', { style: { color: theme.text } }, 'Reports → All Transactions')),
        React.createElement('div', null, '2. ' + __('biCtStep2', 'Top right:') + ' ', React.createElement('b', { style: { color: theme.text } }, '"Export" → "CSV (Full Export)"')),
        React.createElement('div', null, __('biCtStep3', '3. Upload the downloaded file here')),
        React.createElement('div', { style: { marginTop: '0.5rem', color: theme.accent, fontSize: '0.75rem' } }, __('biCtBooked', '✓ Booked: Trade, Income, Staking, Mining, Airdrop, Gift/Tip, Interest, Spend · English and German exports')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.75rem' } }, __('biCtFull', 'Use the full export: its "value in EUR" columns price coin-to-coin trades and rewards. Deposits and withdrawals are transfers and are not booked.'))
      ),
      React.createElement('div', {
        onDrop: handleDrop, onDragOver: e => e.preventDefault(),
        ...window.MaerminUtils.clickable(() => fileRef.current?.click()),
        'aria-label': __('biChooseCsv', 'Choose CSV file to import'),
        style: { border: `2px dashed ${theme.cardBorder}`, borderRadius: '16px', padding: '2.5rem', textAlign: 'center', cursor: 'pointer', marginBottom: '1rem' }
      },
        React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.4 } }, '↑'),
        React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.25rem' } }, __('biDropCt', 'Drop CoinTracking CSV here')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem' } }, __('biOrClickSelect', 'or click to select')),
        React.createElement('input', { type: 'file', accept: '.csv,.txt', ref: fileRef, style: { display: 'none' }, onChange: e => handleFile(e.target.files[0]) })
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
        btn(__('back', '← Back'), () => setStep(0))
      )
    ),

    // ── Step 1: Generic file upload ──────────────────────────────────────────
    step === 1 && selectedBroker !== 'getquin' && selectedBroker !== 'cointracking' && React.createElement('div', null,
      (selectedBroker === 'portfolioPerformance' || selectedBroker === 'parqet') && React.createElement('div', { 'data-testid': 'tracker-howto', style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '1rem', marginBottom: '1rem', fontSize: '0.8rem', color: theme.textSecondary, lineHeight: '1.8' } },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.375rem' } }, __('biTrackerInstr', 'How to export:')),
        selectedBroker === 'portfolioPerformance'
          ? React.createElement('div', null,
              React.createElement('div', null, __('biPpStep1', '1. In Portfolio Performance open the CSV export (window "Export CSV", German "CSV exportieren").')),
              React.createElement('div', null, __('biPpStep2', '2. Choose "Securities Account Transactions" (Depotumsätze) for purchases and sales, and "Account Transactions" (Kontoumsätze) for dividends, deposits, withdrawals, fees and taxes.')),
              React.createElement('div', null, __('biPpStep3', '3. Upload each file here. The program language must be English or German. A purchase in both files is recognised as a duplicate.')))
          : React.createElement('div', null,
              React.createElement('div', null, __('biPqStep1', '1. In Parqet open Activities and choose Export (CSV).')),
              React.createElement('div', null, __('biPqStep2', '2. Upload the file here. Securities, crypto, deposits, withdrawals, fees and taxes are imported; other cash bookings are listed, not booked.')))
      ),
      exchangeSyncSupported && React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.78rem', lineHeight: '1.6', marginBottom: '1rem' } },
        __('biPreferLive', 'Prefer a live import? Use Exchange sync below with a read-only API key (stored encrypted in your vault).')),
      React.createElement('div', {
        onDrop: handleDrop, onDragOver: e => e.preventDefault(),
        ...window.MaerminUtils.clickable(() => fileRef.current?.click()),
        'aria-label': __('biChooseCsv', 'Choose CSV file to import'),
        style: { border: `2px dashed ${theme.cardBorder}`, borderRadius: '16px', padding: '3rem', textAlign: 'center', cursor: 'pointer', marginBottom: '1rem' }
      },
        React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.4 } }, '↑'),
        React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.25rem' } }, pdfBusy ? __('biReadingPdf', 'Reading PDF statement(s)...') : __('biDragHere', 'Drag CSV or PDF statement(s) here')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, `${__('biOrClick', 'Or click')} · ${selectedBrokerObj?.name || ''} · ${selectedBrokerObj ? (selectedBrokerObj.hintKey ? __(selectedBrokerObj.hintKey, selectedBrokerObj.hint) : selectedBrokerObj.hint) : ''}`),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.75rem', marginTop: '0.3rem' } }, __('biPdfSupported', 'PDF settlement statements: Trade Republic, Scalable, ING, DKB, Comdirect - parsed on this device, the file never leaves it.')),
        React.createElement('input', { type: 'file', accept: '.csv,.txt,.json,.pdf', multiple: true, ref: fileRef, style: { display: 'none' }, onChange: e => handleFiles(e.target.files) })
      ),
      React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.8rem', lineHeight: '1.6' } }, __('biLocalOnly', 'All data stays local. Nothing is uploaded.')),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '1rem' } },
        btn(__('back', '← Back'), () => setStep(0)),
        btn(__('biPasteText', 'Paste text'), () => { setRawData(' '); setStep(2); })
      )
    ),

    // ── Step 2: Preview & mapping ────────────────────────────────────────────
    step === 2 && React.createElement('div', null,
      (!mp && parsed.length > 0) && currencyNotice(parsed),
      fileName && React.createElement('div', { style: { marginBottom: '1rem', color: theme.textSecondary, fontSize: '0.875rem' } }, `${fileName}`),

      // Paste fallback when there is no data yet (or the mapping module is absent).
      (!mp && parsed.length === 0) && React.createElement('div', null,
        React.createElement('p', { style: { color: theme.warning, marginBottom: '1rem' } }, __('biNoneDetected', 'No transactions detected. Paste CSV content manually:')),
        React.createElement('textarea', {
          value: rawData === ' ' ? '' : rawData,
          onChange: e => setRawData(e.target.value),
          placeholder: __('biPasteCsvPh', 'Paste CSV content...'),
          style: { width: '100%', height: '150px', padding: '0.75rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', marginBottom: '0.75rem' }
        })
      ),

      // NEW smart mapping preview (window.MaerminImportMapping).
      mp && (function () {
        const reqMissing = (window.MaerminImportMapping.REQUIRED || []).filter(f => !mapping || !mapping[f]);
        const selStyle = (field) => ({
          padding: '0.4rem 0.5rem', minHeight: '40px', background: theme.inputBg,
          border: `1px solid ${(window.MaerminImportMapping.REQUIRED.indexOf(field) !== -1 && (!mapping || !mapping[field])) ? '#ef4444' : theme.inputBorder}`,
          borderRadius: '6px', color: theme.text, fontSize: '0.78rem', width: '100%'
        });
        return React.createElement('div', null,
          // Summary chips: broker + counts.
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.9rem', fontSize: '0.8rem' } },
            mp.broker && React.createElement('span', { style: { padding: '0.25rem 0.6rem', borderRadius: '20px', background: `${theme.accent}1e`, color: theme.accent, fontWeight: '700' } }, mp.broker.chosen ? __('biColsDetected', '{name} (columns detected)', { name: mp.broker.name }) : __('biDetected', 'Detected: {name}', { name: mp.broker.name })),
            React.createElement('span', { style: { padding: '0.25rem 0.6rem', borderRadius: '20px', background: 'rgba(34,197,94,0.15)', color: theme.success, fontWeight: '700' } }, __('biValid', '✓ {n} valid', { n: mp.stats.ok })),
            mp.errors.length > 0 && React.createElement('span', { ...window.MaerminUtils.clickable(() => setShowErrors(v => !v)), 'aria-label': __('biToggleErrors', 'Toggle error details'), style: { padding: '0.25rem 0.6rem', borderRadius: '20px', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: '700', cursor: 'pointer' } }, `${__('biSkipped', '✗ {n} skipped', { n: mp.errors.length })} ${showErrors ? '▲' : '▼'}`),
            (mp.stats.duplicates > 0) && React.createElement('span', { style: { padding: '0.25rem 0.6rem', borderRadius: '20px', background: 'rgba(245,158,11,0.15)', color: theme.warning, fontWeight: '700' } }, __('biDuplicates', '! {n} {n:duplicate|duplicates}', { n: mp.stats.duplicates }))
          ),

          // Fixed-format files (CoinTracking) are read by their own parser: say
          // how rows are booked and list what needs a look instead of a mapping.
          mp.fixedFormat && React.createElement('div', { 'data-testid': mp.format ? 'tracker-info' : 'ct-info', style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '0.9rem', marginBottom: '0.9rem', fontSize: '0.78rem', color: theme.textSecondary, lineHeight: 1.6 } },
            mp.format
              ? React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.3rem' } }, __('biTrackerHow', 'How {name} rows are booked', { name: mp.broker ? mp.broker.name : '' }))
              : React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.3rem' } }, __('biCtHow', 'How CoinTracking rows are booked')),
            mp.format
              ? React.createElement('div', null, __('biTrackerRules', 'Purchases and inbound deliveries become buys at their price before fees (taxes on a purchase count as costs). Sales become sells; tax withheld on a sale goes to the note, not into the cost basis. Dividends are booked gross with the foreign tax as withholding tax. Deposits, withdrawals, fees, taxes, refunds and interest charges become cash bookings. Interest on cash, transfers between your own accounts and outbound deliveries are not booked; the skipped list says why.'))
              : React.createElement('div', null, __('biCtRules', 'Trades become buys and sells (a coin-to-coin trade is a sale plus a purchase at the recorded value). Income, staking, mining and airdrops are buys at their market value. Deposits and withdrawals between your own wallets are not booked') + (mp.stats.transfers ? ' ' + __('biInThisFile', '({n} in this file)', { n: mp.stats.transfers }) : '') + __('biCtRulesEnd', '; the skipped list says why each row was left out.')),
            (mp.warnings || []).length > 0 && React.createElement('ul', { role: 'status', style: { margin: '0.5rem 0 0', paddingLeft: '1.1rem', color: theme.warning } },
              mp.warnings.slice(0, 8).map((w, i) => React.createElement('li', { key: i }, w)),
              mp.warnings.length > 8 && React.createElement('li', { key: 'more' }, __('andNMore', '… and {n} more', { n: mp.warnings.length - 8 })))
          ),

          // Editable column → field mapping.
          !mp.fixedFormat && React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '0.9rem', marginBottom: '0.9rem' } },
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' } }, __('biColMapping', 'Column mapping (edit if a column is wrong)')),
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.6rem' } },
              (window.MaerminImportMapping.FIELDS).map(field =>
                React.createElement('label', { key: field, style: { display: 'block' } },
                  React.createElement('span', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.7rem', marginBottom: '0.2rem' } },
                    fieldLabel(field) + (window.MaerminImportMapping.REQUIRED.indexOf(field) !== -1 ? ' *' : '')),
                  React.createElement('select', {
                    value: (mapping && mapping[field]) || '',
                    onChange: e => updateMapping(field, e.target.value || null),
                    style: selStyle(field)
                  },
                    React.createElement('option', { value: '' }, __('biNone', '— none —')),
                    mp.headers.map((h, i) => React.createElement('option', { key: i, value: h }, h))
                  )
                )
              )
            ),
            reqMissing.length > 0 && React.createElement('div', { style: { color: '#ef4444', fontSize: '0.74rem', marginTop: '0.5rem' } }, __('biMapRequired', 'Map the required field(s): {list}', { list: reqMissing.map(fieldLabel).join(', ') })),

            // Reusable mapping presets (WI-8): load a saved mapping for this
            // broker, save the current one, or delete a preset.
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.7rem', paddingTop: '0.7rem', borderTop: `1px solid ${theme.cardBorder}` } },
              React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.72rem', fontWeight: '700' } }, t.presetLabel || 'Mapping preset'),
              React.createElement('select', {
                value: selectedPreset, onChange: e => applyPresetById(e.target.value),
                style: { padding: '0.35rem 0.5rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.78rem' }
              },
                React.createElement('option', { value: '' }, t.presetLoad || 'Load preset…'),
                presets.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name))
              ),
              React.createElement('button', { onClick: saveCurrentPreset,
                style: { padding: '0.35rem 0.7rem', background: (theme.accentFill || theme.accent), color: '#ffffff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.76rem', fontWeight: '700' } }, t.presetSave || 'Save preset'),
              selectedPreset && React.createElement('button', { onClick: deleteSelectedPreset,
                style: { padding: '0.35rem 0.7rem', background: 'none', color: theme.textSecondary, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.76rem' } }, t.presetDelete || 'Delete')
            )
          ),

          // ISIN → ticker: one row per ISIN with the proposed listing, editable.
          isinList.length > 0 && React.createElement('div', { 'data-testid': 'isin-map', style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '0.9rem', marginBottom: '0.9rem' } },
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' } }, __('biIsinTicker', 'ISIN → ticker')),
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.76rem', lineHeight: 1.5, marginBottom: '0.6rem' } },
              isinBusy ? __('biLookingUp', 'Looking up listings…')
                : __('biIsinHint', 'Prices are fetched per listing, so each ISIN needs a ticker. Proposed: the listing in the trade currency. Change it if it is not the one you hold.')),
            isinList.map(x => {
              const pick = isinPicks[x.isin] || {};
              const cands = isinCands[x.isin] || [];
              const inCands = cands.some(c => String(c.symbol).toUpperCase() === pick.symbol);
              return React.createElement('div', { key: x.isin, style: { display: 'grid', gridTemplateColumns: 'minmax(120px, 150px) minmax(140px, 1fr) minmax(110px, 140px)', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', fontSize: '0.78rem' } },
                React.createElement('span', { style: { color: theme.text, fontFamily: 'monospace' } }, x.isin, React.createElement('span', { style: { color: theme.textSecondary } }, ' · ' + x.currency)),
                React.createElement('select', {
                  'aria-label': __('biListingFor', 'Listing for {isin}', { isin: x.isin }), value: inCands ? pick.symbol : '',
                  onChange: e => { const c = cands.find(k => String(k.symbol).toUpperCase() === e.target.value); if (c) setIsinTicker(x.isin, c.symbol, c.name); },
                  disabled: !cands.length,
                  style: { padding: '0.4rem 0.5rem', minHeight: '40px', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.78rem', width: '100%' }
                },
                  React.createElement('option', { value: '' }, cands.length ? ((pick.symbol && !inCands) ? __('biOther', 'other: {sym}', { sym: pick.symbol }) : __('biChooseListing', '— choose a listing —')) : (isinBusy ? __('biSearching', 'searching…') : (workerUrl ? __('biNoListing', 'no listing found') : __('biNeedsWorker', 'needs a Worker URL')))),
                  cands.map(c => React.createElement('option', { key: c.symbol, value: String(c.symbol).toUpperCase() }, `${c.symbol} — ${c.name || ''}${c.exchange ? ' (' + c.exchange + ')' : ''}`))
                ),
                React.createElement('input', {
                  'aria-label': __('biTickerFor', 'Ticker for {isin}', { isin: x.isin }), placeholder: __('biTickerPh', 'ticker'), value: pick.symbol || '',
                  onChange: e => setIsinTicker(x.isin, e.target.value, ''),
                  style: { padding: '0.4rem 0.5rem', minHeight: '40px', background: theme.inputBg, border: `1px solid ${pick.symbol ? theme.inputBorder : '#ef4444'}`, borderRadius: '6px', color: theme.text, fontSize: '0.78rem', width: '100%', boxSizing: 'border-box' }
                }),
                pick.currencyMismatch && React.createElement('span', { style: { gridColumn: '1 / -1', color: '#f59e0b', fontSize: '0.72rem' } }, __('biCurMismatch', 'No {cur} listing found — {sym} is quoted in another currency. Its price is converted, so P&L will include the exchange-rate move.', { cur: x.currency, sym: pick.symbol }))
              );
            }),
            (!isinBusy && mp.stats.isinUnresolved > 0) && React.createElement('div', { role: 'status', 'data-testid': 'isin-unresolved', style: { color: '#ef4444', fontSize: '0.76rem', marginTop: '0.4rem' } },
              __('biIsinUnresolved', '{n} {n:row has|rows have} no ticker yet. They would be imported under their ISIN and stay without a price — enter a ticker above.', { n: mp.stats.isinUnresolved }))
          ),

          // Currencies that can't be converted exactly (see MaerminFxHistory.txToEUR).
          currencyNotice(mp.transactions),

          // Row-accurate error report.
          showErrors && mp.errors.length > 0 && React.createElement('div', { style: { background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '0.6rem 0.8rem', marginBottom: '0.9rem', maxHeight: '160px', overflow: 'auto', fontSize: '0.76rem' } },
            mp.errors.slice(0, 50).map((er, i) => React.createElement('div', { key: i, style: { color: theme.textSecondary, lineHeight: '1.7' } },
              React.createElement('span', { style: { color: '#ef4444', fontWeight: '700' } }, __('importRowLabel', 'Row {row}:', { row: er.row }) + ' '), er.reason)),
            mp.errors.length > 50 && React.createElement('div', { style: { color: theme.textSecondary } }, __('andNMore', '… and {n} more', { n: mp.errors.length - 50 }))
          ),

          // Duplicate handling toggle.
          (mp.stats.duplicates > 0) && React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.9rem', fontSize: '0.82rem', color: theme.text, cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: includeDupes, onChange: e => setIncludeDupes(e.target.checked) }),
            __('biImportDupes', 'Import the {n} {n:duplicate|duplicates} too (already in your portfolio)', { n: mp.stats.duplicates })
          ),

          // Preview table — duplicates greyed + flagged.
          React.createElement('div', { style: { background: theme.card, borderRadius: '10px', border: `1px solid ${theme.cardBorder}`, overflow: 'auto', maxHeight: '300px' } },
            React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '560px', fontSize: '0.8rem' } },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  [__('date', 'Date'), __('type', 'Type'), __('symbol', 'Symbol'), __('quantity', 'Quantity'), __('price', 'Price'), __('fees', 'Fees'), ''].map((h, i) =>
                    React.createElement('th', { key: i, style: { padding: '0.6rem 0.875rem', textAlign: (i > 2 && i < 6) ? 'right' : 'left', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: '600' } }, h)
                  )
                )
              ),
              React.createElement('tbody', null,
                mp.transactions.slice(0, 20).map((tx, i) =>
                  React.createElement('tr', { key: i, style: { opacity: tx.duplicate ? 0.45 : 1 } },
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.text } }, tx.date ? window.MaerminI18n.date(tx.date) : '—'),
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem' } },
                      React.createElement('span', { style: { padding: '0.125rem 0.375rem', borderRadius: '3px', fontSize: '0.7rem', fontWeight: '700', background: tx.type === 'buy' ? 'rgba(34,197,94,0.15)' : tx.type === 'sell' ? 'rgba(239,68,68,0.15)' : 'rgba(139,124,255,0.15)', color: tx.type === 'buy' ? '#22c55e' : tx.type === 'sell' ? '#ef4444' : theme.accent } }, window.MaerminUtils.txTypeInfo(tx.type, t).label.toUpperCase())
                    ),
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: tx.unresolvedIsin ? '#ef4444' : theme.text, fontWeight: '600' } },
                      tx.symbol || '—',
                      (tx.isin && !tx.unresolvedIsin) && React.createElement('div', { style: { color: theme.textSecondary, fontWeight: '400', fontSize: '0.68rem', fontFamily: 'monospace' } }, tx.isin),
                      tx.unresolvedIsin && React.createElement('div', { style: { fontWeight: '400', fontSize: '0.68rem' } }, __('biNoTicker', 'no ticker'))),
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.text, textAlign: 'right' } }, (typeof tx.quantity === 'number' ? window.MaerminI18n.num(tx.quantity, 4) : '—')),
                    // P5-1.3: a cash row shows its amount in the price column
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.text, textAlign: 'right' } }, (typeof tx.price === 'number' ? window.MaerminI18n.num(tx.price, 2) : typeof tx.amount === 'number' ? window.MaerminI18n.num(tx.amount, 2) + ' ' + (tx.currency || 'EUR') : '—')),
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.textSecondary, textAlign: 'right' } }, window.MaerminI18n.num(typeof tx.fees === 'number' ? tx.fees : 0, 2)),
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', textAlign: 'right' } }, tx.duplicate ? React.createElement('span', { style: { color: '#f59e0b', fontSize: '0.68rem', fontWeight: '700' } }, 'DUP') : '')
                  )
                )
              )
            )
          ),
          mp.transactions.length > 20 && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginTop: '0.5rem' } }, __('andNMore', '… and {n} more', { n: mp.transactions.length - 20 }))
        );
      })(),

      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '1rem' } },
        btn(__('back', '← Back'), () => setStep(1)),
        mp
          ? btn(__('biImportN', '✓ Import {n}', { n: Math.max(0, mp.stats.ok - (includeDupes ? 0 : (mp.stats.duplicates || 0))) }), doImportMapped, true, (mp.stats.ok - (includeDupes ? 0 : (mp.stats.duplicates || 0))) <= 0)
          : btn(__('biImportN', '✓ Import {n}', { n: parsed.length }), doImport, true, parsed.length === 0)
      )
    ),

    // ── Step 3: Done ─────────────────────────────────────────────────────────
    step === 3 && React.createElement('div', { style: { textAlign: 'center', padding: '3rem' } },
      React.createElement('div', { style: { fontSize: '2rem', marginBottom: '1rem', color: '#22c55e' } }, '✓'),
      React.createElement('h3', { style: { color: theme.text, fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.5rem' } }, __('biSuccess', 'Import successful!')),
      React.createElement('p', { style: { color: theme.textSecondary, marginBottom: '1.5rem' } }, __('biAddedN', '{n} {n:transaction was|transactions were} added.', { n: importedCount })),
      btn(__('biStartNew', 'Start a new import'), reset, true)
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. POSITION NOTES / TRADE JOURNAL
// ─────────────────────────────────────────────────────────────────────────────
function PositionNotesView({ portfolio, theme, t }) {
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_notes') || '{}'); } catch { return {}; }
  });
  const [active, setActive] = useState(null);
  const [draft, setDraft]   = useState('');

  useEffect(() => { localStorage.setItem('maermin_notes', JSON.stringify(notes)); }, [notes]);

  const allPositions = useMemo(() => {
    const result = [];
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        result.push({ key: `${cat}-${pos.symbol||pos.name}`, sym: pos.symbol||pos.name, cat });
      });
    });
    return result;
  }, [portfolio]);

  const save = () => {
    if (!active) return;
    setNotes(prev => ({ ...prev, [active]: { text: draft, updatedAt: new Date().toISOString() } }));
    setActive(null); setDraft('');
  };

  const noteCount = Object.keys(notes).filter(k => notes[k]?.text).length;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '0.5rem' } }, (t.tradeJournal || 'Trade Journal')),
    React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem', marginBottom: '1.5rem' } }, __('jnNotesCount', '{n} of {total} positions have notes', { n: noteCount, total: allPositions.length })),

    allPositions.length === 0
      ? React.createElement('div', { style: { padding: '3rem', textAlign: 'center', color: theme.textSecondary, background: theme.card, borderRadius: '16px', boxShadow: theme.shadow, border: `1px solid ${theme.cardBorder}` } },
          __('jnAddFirst', 'Add positions first')
        )
      : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: '0.75rem' } },
          allPositions.map(p => {
            const note = notes[p.key];
            const isActive = active === p.key;
            return React.createElement('div', {
              key: p.key,
              style: {
                background: theme.card, borderRadius: '16px', boxShadow: theme.shadow,
                border: `1px solid ${isActive ? theme.accent : note?.text ? 'rgba(139,124,255,0.3)' : theme.cardBorder}`,
                padding: '1rem', transition: 'all 0.15s'
              }
            },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' } },
                React.createElement('div', null,
                  React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, p.sym),
                  React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.75rem', marginLeft: '0.5rem' } }, p.cat)
                ),
                note?.updatedAt && React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.7rem' } },
                  window.MaerminI18n.date(note.updatedAt)
                )
              ),
              isActive
                ? React.createElement('div', null,
                    React.createElement('textarea', {
                      value: draft, autoFocus: true,
                      onChange: e => setDraft(e.target.value),
                      placeholder: __('jnThesisPh', 'Investment thesis, target price, risks, strategy...'),
                      style: { width: '100%', height: '120px', padding: '0.625rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', resize: 'vertical', marginBottom: '0.5rem', lineHeight: '1.5' }
                    }),
                    React.createElement('div', { style: { display: 'flex', gap: '0.375rem' } },
                      React.createElement('button', { onClick: save, style: { padding: '0.375rem 0.875rem', background: (theme.accentFill || theme.accent), color: '#ffffff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' } }, __('save', 'Save')),
                      React.createElement('button', { onClick: () => { setActive(null); setDraft(''); }, style: { padding: '0.375rem 0.875rem', background: theme.inputBg, color: theme.text, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' } }, __('cancel', 'Cancel'))
                    )
                  )
                : React.createElement('div', {
                    ...window.MaerminUtils.clickable(() => { setActive(p.key); setDraft(note?.text || ''); }),
                    'aria-label': note?.text ? __('jnEditNote', 'Edit note') : __('jnAddNote', 'Add note'),
                    style: { cursor: 'pointer', minHeight: '60px', padding: '0.5rem', background: theme.inputBg, borderRadius: '6px', fontSize: '0.8rem', color: note?.text ? theme.text : theme.textSecondary, lineHeight: '1.5', whiteSpace: 'pre-wrap' }
                  }, note?.text || __('jnAddNotePh', '+ Add note...'))
            );
          })
        )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DIVIDEND CALENDAR
// ─────────────────────────────────────────────────────────────────────────────
// Frequency of a derived payout in the UI language. It was called but never
// defined (since the P2-2 translation change), so building the derived schedule
// threw inside its try/catch and the calendar never showed a single auto-derived
// payout - "Year: €0.00" for every holder (AUDIT BUG-037).
function freqLabel(f) {
  switch (String(f || '').toLowerCase().replace(/[^a-z]/g, '')) {
    case 'weekly': return __('freqWeekly', 'Weekly');
    case 'biweekly': return __('freqBiweekly', 'Bi-weekly');
    case 'monthly': return __('freqMonthly', 'Monthly');
    case 'quarterly': return __('freqQuarterly', 'Quarterly');
    case 'semiannual': return __('freqSemiAnnual', 'Semi-annual');
    case 'annual': case 'yearly': return __('freqAnnual', 'Annual');
    default: return String(f || '');
  }
}

function DividendCalendarView({ portfolio, prices, metaVersion, theme, t, addToast, events: eventsProp, setEvents: setEventsProp, privacyMode, exchangeRate }) {
  // Privacy Mode masks every amount, like the app's formatPrice.
  const amt = (text) => (privacyMode ? '••••••' : text);
  // Controlled when the parent passes events/setEvents (so auto-fetched payments
  // appear immediately); otherwise self-manage from localStorage (standalone use).
  const controlled = eventsProp != null && typeof setEventsProp === 'function';
  const [localEvents, setLocalEvents] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_divevents') || '[]'); } catch { return []; }
  });
  const manualEvents = controlled ? eventsProp : localEvents;
  const setEvents = controlled ? setEventsProp : setLocalEvents;
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ symbol: '', date: '', amount: '', withholding: '', currency: 'EUR', notes: '' });
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });

  // Persist only when uncontrolled — the parent owns persistence otherwise.
  useEffect(() => { if (!controlled) localStorage.setItem('maermin_divevents', JSON.stringify(localEvents)); }, [localEvents, controlled]);

  // AUTO-DERIVED payments: every individual payout from every dividend-paying
  // holding for the next 12 months, straight from the dividend service (warmed
  // via the Worker for all symbols). Read-only; merged with manual entries.
  // metaVersion is in the deps so it refreshes once the Worker data lands.
  const derivedEvents = useMemo(() => {
    const svc = window.DividendDataService;
    if (!svc || typeof svc.buildPaymentSchedule !== 'function') return [];
    try {
      return svc.buildPaymentSchedule(portfolio, {}).map(p => ({
        id: `derived-${p.symbol}-${p.date}`,
        symbol: p.symbol, date: p.date, amount: p.amount, currency: p.currency,
        notes: __('dcDerivedNote', '≈ {perShare}/sh × {shares}', { perShare: window.MaerminI18n.num(p.perShare, 3), shares: window.MaerminI18n.num(p.shares, { min: 0, max: 4 }) }) + ' · ' + (p.frequency ? freqLabel(p.frequency) : __('dcEst', 'est.')) + (p.past ? ' · ' + __('dcReceived', 'received') : ''),
        derived: true, past: !!p.past
      }));
    } catch (e) { return []; }
  }, [portfolio, prices, metaVersion]);

  // Display set = genuinely manual entries + auto-derived payments. Stale
  // "auto-" snapshots from the old button flow are superseded by the live
  // derived schedule, so they are hidden (they remain in storage and can be
  // cleared via the auto-fetch button). Manual entries always win on a date.
  const events = useMemo(() => {
    const manualOnly = manualEvents.filter(e => !String(e.id).startsWith('auto-'));
    const taken = new Set(manualOnly.map(e => `${(e.symbol || '').toUpperCase()}|${e.date}`));
    const extra = derivedEvents.filter(e => !taken.has(`${(e.symbol || '').toUpperCase()}|${e.date}`));
    return manualOnly.concat(extra);
  }, [manualEvents, derivedEvents]);

  const addEvent = () => {
    if (!form.symbol || !form.date || !form.amount) return;
    // P4-3: foreign tax withheld (optional), read by the tax report and the withholding table
    const wht = window.MaerminUtils.parseDecimal(form.withholding);
    setEvents(prev => [...prev, { id: Date.now().toString(), ...form, amount: parseFloat(form.amount), withholding: (isFinite(wht) && wht > 0) ? wht : 0 }]);
    setForm({ symbol: '', date: '', amount: '', withholding: '', currency: 'EUR', notes: '' });
    setShowAdd(false);
    addToast && addToast(__('dcAdded', 'Dividend added'), 'success');
  };

  // First payments can be months out, so the current month's grid may be empty.
  // Jump ONCE to the month of the next upcoming payment so the calendar isn't
  // blank; a ref guards against overriding the user's own navigation afterwards.
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (jumpedRef.current || !events.length) return;
    const now = new Date();
    const hasThisMonth = events.some(e => { const d = new Date(e.date); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); });
    if (hasThisMonth) { jumpedRef.current = true; return; }
    const next = events.map(e => new Date(e.date)).filter(d => !isNaN(d) && d >= now).sort((a, b) => a - b)[0];
    if (next) { setViewMonth({ year: next.getFullYear(), month: next.getMonth() }); jumpedRef.current = true; }
  }, [events]);

  const { year, month } = viewMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Mon-start
  const daysInMonth = lastDay.getDate();

  const monthEvents = events.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  // Totals in EUR: derived payouts carry their own currency (USD for a US payer).
  const eurOf = (e) => window.MaerminUtils ? window.MaerminUtils.toEUR(e.amount || 0, e.currency || 'EUR', exchangeRate) : (e.amount || 0);
  const totalThisMonth = monthEvents.reduce((s, e) => s + eurOf(e), 0);
  const totalYear = events.filter(e => new Date(e.date).getFullYear() === year).reduce((s, e) => s + eurOf(e), 0);

  const days = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  const dayEvents = (d) => monthEvents.filter(e => new Date(e.date).getDate() === d);
  const today = new Date();

  const monthNames = window.MaerminI18n.monthNames('short');

  const inp = (field, placeholder, type='text', opts) =>
    React.createElement('input', { type, value: form[field], placeholder, ...opts, onChange: e => setForm(p=>({...p,[field]:e.target.value})),
      style: { flex: 1, padding: '0.5rem 0.75rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.875rem' }
    });

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } }, (t.dividendCalendar || 'Dividend Calendar')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.85rem', marginTop: '0.25rem' } },
          `${monthNames[month]} ${year}: ${amt(window.MaerminI18n.money(totalThisMonth, 'EUR'))} · ${__('dcYear', 'Year {y}', { y: year })}: ${amt(window.MaerminI18n.money(totalYear, 'EUR'))}`
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } },
        React.createElement('button', { onClick: () => setViewMonth(p => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; }), style: { padding: '0.5rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, cursor: 'pointer' } }, '←'),
        React.createElement('span', { style: { color: theme.text, fontWeight: '700', minWidth: '100px', textAlign: 'center' } }, `${monthNames[month]} ${year}`),
        React.createElement('button', { onClick: () => setViewMonth(p => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; }), style: { padding: '0.5rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, cursor: 'pointer' } }, '→'),
        React.createElement('button', { onClick: () => setShowAdd(p=>!p), style: { padding: '0.5rem 0.875rem', background: (theme.accentFill || theme.accent), color: '#ffffff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' } }, __('dcAddBtn', '+ Dividend'))
      )
    ),

    // Add form
    showAdd && React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
      inp('symbol', __('dcSymbolPh', 'Symbol (e.g. AAPL)')),
      inp('date', __('date', 'Date'), 'date'),
      inp('amount', __('amount', 'Amount'), 'number', { step: '0.01' }),
      inp('withholding', __('dcWhtPh', 'Withholding tax (opt.)'), 'text', { inputMode: 'decimal', 'aria-label': __('dcWhtPh', 'Withholding tax (opt.)') }),
      React.createElement('select', { value: form.currency, onChange: e=>setForm(p=>({...p,currency:e.target.value})), style: { padding: '0.5rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text } },
        React.createElement('option', { value: 'EUR' }, '€'),
        React.createElement('option', { value: 'USD' }, '$')
      ),
      inp('notes', __('dcNotePh', 'Note (opt.)')),
      React.createElement('button', { onClick: addEvent, style: { padding: '0.5rem 1rem', background: (theme.accentFill || theme.accent), color: '#ffffff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', whiteSpace: 'nowrap' } }, __('add', 'Add'))
    ),

    // Calendar grid
    React.createElement('div', { style: { background: theme.card, borderRadius: '16px', boxShadow: theme.shadow, border: `1px solid ${theme.cardBorder}`, overflow: 'hidden' } },
      // Weekdays header
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' } },
        window.MaerminI18n.weekdayNames('short').map(d =>
          React.createElement('div', { key: d, style: { padding: '0.625rem', textAlign: 'center', color: theme.textSecondary, fontSize: '0.75rem', fontWeight: '600', borderBottom: `1px solid ${theme.cardBorder}` } }, d)
        )
      ),
      // Days
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' } },
        days.map((d, i) => {
          const evs = d ? dayEvents(d) : [];
          const isToday = d && today.getDate()===d && today.getMonth()===month && today.getFullYear()===year;
          return React.createElement('div', {
            key: i,
            style: {
              minHeight: '70px', padding: '0.375rem', borderRight: i%7<6 ? `1px solid ${theme.cardBorder}` : 'none',
              borderBottom: `1px solid ${theme.cardBorder}`,
              background: isToday ? 'rgba(139,124,255,0.08)' : 'transparent'
            }
          },
            d && React.createElement('div', { style: { fontSize: '0.75rem', fontWeight: isToday ? '700' : '400', color: isToday ? theme.accent : theme.text, marginBottom: '0.25rem' } }, d),
            evs.map(e =>
              React.createElement('div', Object.assign({
                key: e.id,
                title: `${e.symbol}: ${window.MaerminI18n.money(e.amount, e.currency || 'EUR')}${e.notes ? ' · ' + e.notes : ''}${e.derived ? ' · ' + __('dcProjected', 'projected') : ''}`,
                'aria-label': e.derived ? __('dcProjectedAria', 'Projected dividend {sym} {amount}', { sym: e.symbol, amount: window.MaerminI18n.money(e.amount, e.currency || 'EUR') }) : __('dcDeleteAria', 'Delete dividend {sym} {amount}', { sym: e.symbol, amount: window.MaerminI18n.money(e.amount, e.currency || 'EUR') }),
                style: {
                  background: e.past ? 'rgba(148,163,184,0.12)' : (e.derived ? 'rgba(59,130,246,0.14)' : 'rgba(34,197,94,0.15)'),
                  color: e.past ? theme.textSecondary : (e.derived ? theme.accent : theme.success),
                  fontSize: '0.65rem', fontWeight: '600', padding: '0.15rem 0.3rem', borderRadius: '3px', marginBottom: '0.15rem',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  cursor: e.derived ? 'default' : 'pointer',
                  borderLeft: e.past ? '2px solid rgba(148,163,184,0.5)' : (e.derived ? '2px solid rgba(59,130,246,0.6)' : 'none')
                }
              }, e.derived ? {} : window.MaerminUtils.clickable(() => {
                // In-app confirmation (the native dialog only if MaerminUI is missing).
                const ask = (window.MaerminUI && window.MaerminUI.confirm)
                  ? window.MaerminUI.confirm({ title: __('dcDeleteTitle', 'Delete this dividend?'), message: __('dcDeleteMsg', '{sym} {amount} on {date}', { sym: e.symbol, amount: window.MaerminI18n.money(e.amount, e.currency || 'EUR'), date: window.MaerminI18n.date(e.date) }), confirmLabel: __('delete', 'Delete'), danger: true })
                  : Promise.resolve(window.confirm(__('dcDeleteTitle', 'Delete this dividend?')));
                ask.then(yes => { if (yes) setEvents(prev => prev.filter(ev => ev.id !== e.id)); });
              })),
              `${e.symbol} ${amt('+' + window.MaerminI18n.money(e.amount, e.currency || 'EUR'))}`)
            )
          );
        })
      )
    ),

    // Upcoming list
    events.filter(e => new Date(e.date) >= today).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,5).length > 0 &&
    React.createElement('div', { style: { marginTop: '1rem' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.5rem' } }, __('dcUpcoming', 'Upcoming dividends')),
      events.filter(e => new Date(e.date) >= today).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,60).map(e =>
        React.createElement('div', { key: e.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.625rem 0.75rem', background: theme.card, borderRadius: '6px', marginBottom: '0.375rem', border: `1px solid ${theme.cardBorder}` } },
          React.createElement('span', { style: { color: theme.text, fontWeight: '600', fontSize: '0.875rem', minWidth: '64px' } }, e.symbol),
          React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, window.MaerminI18n.date(e.date)),
          React.createElement('span', { style: { color: e.derived ? theme.accent : theme.success, fontWeight: '700', fontSize: '0.875rem' } }, amt('+' + window.MaerminI18n.money(e.amount, e.currency || 'EUR')))
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. MOBILE NAV (floating dock, styled by styles.css .mx-bottom-nav)
// ─────────────────────────────────────────────────────────────────────────────

function MobileBottomNav({ activeView, setActiveView, theme, uiMode, t }) {
  // Aurora redesign: floating glass dock. All styling lives in styles.css
  // (.mx-bottom-nav) so it follows the active theme via CSS variables.
  // P2-1: one button per navigation area (nav-model.js); the views inside an
  // area are the chip row at the top of the page.
  const Nav = window.MaerminNav;
  const Icon = window.MaerminIcon || (() => null);
  const tt = t || {};
  const current = Nav ? Nav.areaOf(activeView) : null;

  return React.createElement('nav', { className: 'mx-bottom-nav maermin-bottom-nav', 'aria-label': __('primaryNav', 'Primary') },
    (Nav ? Nav.AREAS : []).map(area => {
      const active = current === area.id;
      const label = (area.shortKey && tt[area.shortKey]) || area.short || Nav.label(area, tt);
      return React.createElement('button', {
        key: area.id,
        type: 'button',
        className: active ? 'is-active' : '',
        'aria-current': active ? 'page' : undefined,
        'data-area': area.id,
        title: Nav.label(area, tt),
        onClick: () => { if (!active) setActiveView(Nav.firstView(area.id, uiMode || 'advanced')); }
      },
        Icon(area.icon, { size: 20 }),
        React.createElement('span', { className: 'mx-bottom-label' }, label)
      );
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.MaerminFeatures2 = {
    ReturnsView,
    ReturnsHeatmap,
    RebalancingView,
    BrokerImportWizard,
    PositionNotesView,
    DividendCalendarView,
    MobileBottomNav,
    calcXIRR,
    calcTWR
  };
}

})();
