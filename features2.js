// ============================================================================
// MAERMIN v12.0 – Advanced Features
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
  // cleanup V-5: in narrow places (position detail, phones) the grid is cut
  // after a few months with no sign that it scrolls; fade the cut edge while
  // more columns are hidden.
  const scrollRef = useRef(null);
  const [moreRight, setMoreRight] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const check = () => setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check, { passive: true });
    return () => { el.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
  }, [grid]);
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
  // R4.1: a diverging scale on the theme's own gain / loss colours (resolved,
  // so the figure's contrast can be checked); the cell base is the surface.
  const T = window.MaerminTokens;
  const hexOf = (v, fb) => { const r = T && T.resolve ? T.resolve(v) : v; return /^#[0-9a-f]{3,6}$/i.test(String(r || '').trim()) ? String(r).trim() : fb; };
  const scale = { up: hexOf('var(--gain)', '#22c55e'), down: hexOf('var(--loss)', '#ef4444'), base: hexOf(flat ? 'var(--surface-raised, var(--surface))' : 'var(--surface)', '#10151f') };
  const cell = (r, label, maxAbs, key, partial, strong, pick) => {
    if (r === null || r === undefined) {
      return React.createElement('td', { key, 'aria-label': __('rhCellNone', '{label}: no data', { label }), className: ['ui-heat__cell', 'is-empty'].join(' ') }, '—');
    }
    const bg = H.cellColor(r, { up: scale.up, down: scale.down, base: scale.base, maxAbs });
    const text = fmt(r) + (partial ? '*' : '');
    const on = same(sel, pick);
    const toggle = () => setSel(on ? null : pick);
    return React.createElement('td', {
      key, 'data-r': r, 'data-kind': key, 'data-cell': pick.kind + '-' + pick.year + '-' + pick.idx,
      title: label + ': ' + fmt(r) + (partial ? ' (' + __('rhPartial', 'part of the month') + ')' : ''),
      'aria-label': __('rhCellAria', '{label}: {pct}', { label, pct: fmt(r) }) + (partial ? ', ' + __('rhPartial', 'part of the month') : ''),
      role: 'button', tabIndex: 0, 'aria-pressed': on, onClick: toggle,
      onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } },
      className: ['ui-heat__cell', strong ? 'is-strong' : '', on ? 'is-on' : ''].join(' ').trim(),
      style: { background: bg, color: H.textOn(bg) }
    }, text);
  };
  const srcNote = note || (source === 'daily' ? __('rhSrcDaily', 'From the daily closing prices, like the TWR above.')
    : source === 'snapshots' ? __('rhSrcSnapshots', 'From the daily value snapshots, like the TWR above. A period that spans several months counts in the month it ends in.')
    : __('rhSrcRefresh', 'From your price refreshes, like the TWR above. Months without a refresh show —; a period that spans several months counts in the month it ends in.'));
  const UIC = window.MaerminComponents;
  const stat = (key, label, value, sub, tone, extra) => React.createElement(UIC.Stat, Object.assign({ key, 'data-stat': key, className: 'ui-tile', label, value, sub, tone }, extra || {}));
  const toneOf = (v) => UIC.toneOf(v);
  const detailView = () => {
    if (!det) return null;
    const b = det.byType;
    const kinds = [b.buy && __('rhdBuys', '{n} {n:buy|buys}', { n: b.buy }), b.sell && __('rhdSells', '{n} {n:sale|sales}', { n: b.sell }),
      b.income && __('rhdPayouts', '{n} {n:payout|payouts}', { n: b.income }), b.other && __('rhdOther', '{n} other')].filter(Boolean).join(' · ');
    const hasValues = det.endValue !== null;
    return React.createElement('div', { 'data-testid': tid + '-detail', role: 'region', 'aria-live': 'polite', 'aria-label': periodLabel(sel), className: 'ui-heat__detail' },
      React.createElement('div', { className: 'ui-heat__detail-head' },
        React.createElement('strong', null, periodLabel(sel)),
        React.createElement(UIC.IconButton, { size: 'sm', label: __('close', 'Close'), onClick: () => setSel(null), icon: React.createElement('span', { 'aria-hidden': 'true' }, '×') })),
      React.createElement('div', { className: 'ui-tiles' },
        hasValues && stat('start', __('rhdStart', 'Start value'), money(det.startValue), det.startsInside ? __('rhdStartsInside', 'nothing held before') : null),
        hasValues && stat('end', __('rhdEnd', 'End value'), money(det.endValue), det.last ? I.date(det.last) : null),
        hasValues && stat('flow', __('rhdFlow', 'Money in / out'), signed(det.netFlow), null, null),
        hasValues && stat('gain', __('rhdGain', 'Gain'), signed(det.gain), null, toneOf(det.gain)),
        stat('ret', __('rhdReturn', 'Return (TWR)'), det.ret === null ? '—' : fmt(det.ret), null, det.ret === null ? null : toneOf(det.ret), { 'data-r': det.ret === null ? '' : det.ret }),
        stat('acts', __('rhdActivities', 'Activities'), String(det.activities), kinds || null, null, { 'data-n': det.activities })),
      !hasValues && React.createElement('p', { className: 'ui-note' }, __('rhdNoValues', 'Start and end values need the daily closing prices.')));
  };
  const stickyBg = flat ? { background: theme.modalBg || theme.card } : null;
  const body = [
    React.createElement('p', { key: 'src', className: 'ui-heat__src' },
      srcNote + ' ' + __('rhCompound', 'Quarters and years are compounded, not added up.') + (grid ? ' ' + __('rhdHint', 'Select a cell for its details.') : '')),
    !grid
      ? React.createElement('p', { key: 'empty', className: 'ui-muted' }, __('rhEmpty', 'Not enough history yet for monthly returns.'))
      : React.createElement('div', { key: 'grid', ref: scrollRef, role: 'region', tabIndex: 0, 'aria-label': __('rhScrollAria', 'Monthly returns table, scrolls sideways'), 'data-more': moreRight ? 'right' : undefined,
          className: ['ui-heat__scroll', moreRight ? 'has-more' : ''].join(' ').trim() },
          React.createElement('table', { className: 'ui-heat' },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement('th', { scope: 'col', className: 'ui-heat__year', style: stickyBg }, __('rhYear', 'Year')),
              months.map((m, i) => React.createElement('th', { key: 'm' + i, scope: 'col', abbr: monthsLong[i] }, m)),
              [1, 2, 3, 4].map((q) => React.createElement('th', { key: 'q' + q, scope: 'col' }, __('rhQuarter', 'Q{n}', { n: q }))),
              React.createElement('th', { scope: 'col' }, __('rhTotal', 'Year')))),
            React.createElement('tbody', null, grid.years.map((Y) => React.createElement('tr', { key: Y.year },
              React.createElement('th', { scope: 'row', className: 'ui-heat__year', style: stickyBg }, String(Y.year)),
              Y.months.map((r, i) => cell(r, monthsLong[i] + ' ' + Y.year, 0.1, 'm' + i, !!Y.partial[i], false, { kind: 'm', year: Y.year, idx: i })),
              Y.quarters.map((r, q) => cell(r, __('rhQuarter', 'Q{n}', { n: q + 1 }) + ' ' + Y.year, 0.2, 'q' + q, false, false, { kind: 'q', year: Y.year, idx: q })),
              cell(Y.total, String(Y.year), 0.3, 'y', Object.keys(Y.partial).length > 0, true, { kind: 'y', year: Y.year, idx: 0 })))))),
    grid ? React.createElement('ul', { key: 'legend', className: 'ui-chart__legend' },
      React.createElement('li', null, React.createElement('span', { className: 'ui-chart__swatch', 'data-series': 'loss', 'aria-hidden': 'true' }), __('rhLegendLoss', '− loss')),
      React.createElement('li', null, React.createElement('span', { className: 'ui-chart__swatch', 'data-series': 'gain', 'aria-hidden': 'true' }), __('rhLegendGain', '+ gain')),
      React.createElement('li', null, __('rhLegendScale', 'stronger colour = larger move'))) : null,
    grid && grid.years.some((Y) => Object.keys(Y.partial).length) ? React.createElement('p', { key: 'partial', className: 'ui-note' },
      __('rhPartialNote', '* part of the month or year only (the history starts or ends inside it).')) : null,
    React.createElement(React.Fragment, { key: 'det' }, detailView())
  ];
  if (flat) {
    return React.createElement('div', { 'data-testid': tid, className: 'ui-heat-flat' },
      React.createElement('div', { className: 'ui-heat-flat__head' },
        React.createElement('h3', { className: 'ui-card__title' }, title || __('rhTitle', 'Monthly returns')), controls || null),
      body);
  }
  return React.createElement(UIC.Card, { 'data-testid': tid, title: title || __('rhTitle', 'Monthly returns'), headingLevel: 'h3', action: controls || null }, body);
}

// P5-2.5: gross / net switch (Analysis → Returns and Dividends). Net = after
// taxes and fees (the default); gross = taxes and fees count as money taken
// out instead of as a loss. The choice is the prefs-store key grossNet.
function GrossNetSwitch({ value, onChange, theme, testid }) {
  const v = value === 'gross' ? 'gross' : 'net';
  // R4.1: the shared Segmented; data-basis stays on each option
  return React.createElement(window.MaerminComponents.Segmented, {
    label: __('gnAria', 'Taxes and fees'), value: v, size: 'sm', 'data-testid': testid || 'gross-net', className: 'ui-gross-net',
    onChange: (id) => onChange && onChange(id),
    options: [
      { value: 'net', label: __('gnNet', 'Net'), attrs: { 'data-basis': 'net', title: __('gnNetTitle', 'After taxes and fees') } },
      { value: 'gross', label: __('gnGross', 'Gross'), attrs: { 'data-basis': 'gross', title: __('gnGrossTitle', 'Before taxes and fees') } }
    ]
  });
}

function ReturnsView({ transactions, portfolio, prices, priceHistory, theme, formatPrice, getCurrencySymbol, t, fxAt, exchangeRate, valuePath, historyPending, portfolioId, hasWorker, clearings, buildPath, grossNet, setGrossNet, workerUrl, hicpGeo, setHicpGeo, panels }) {
  const gross = grossNet === 'gross';
  // P5-2.9: consumer prices (Eurostat HICP through the Worker) for the real figures
  const RRm = window.MaerminRealReturns;
  const geo = hicpGeo || (RRm ? RRm.defaultGeo(window.MaerminI18n.lang()) : 'EA');
  const hicp = RRm ? RRm.useHicp(workerUrl, geo) : { state: 'none', series: null };
  const R = (typeof window !== 'undefined') ? window.MaerminReturns : null;
  const D = (typeof window !== 'undefined') ? window.MaerminHeatmapDrill : null;
  // Current EUR value over EVERY class in the book (custom categories too):
  // the Overview's own total (MaerminMetrics.computeStats), so both agree.
  const currentValue = useMemo(() => window.MaerminMetrics.computeStats(portfolio, prices).totalValue, [portfolio, prices]);

  // P5-1.5: XIRR, total return, purchases, proceeds and fees come from the one
  // module the Overview uses too (MaerminReturnFigures), so both always agree.
  // With a clearing account (P5-1.4) XIRR counts deposits and withdrawals;
  // `clearings` = { portfolioId: clearing } of the view (all of them for "All portfolios").
  const figs = useMemo(() => window.MaerminReturnFigures.compute(transactions, {
    securitiesValueEUR: currentValue, exchangeRate, fxAt, today: window.MaerminUtils.todayISO(),
    clearings: clearings || null, gross
  }), [transactions, currentValue, exchangeRate, fxAt, clearings, gross]);
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
        className: ['ui-input', 'ui-select', 'ui-input--sm', 'ui-heat__filter'].join(' ')
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
  // P5-2.9: real (after inflation) XIRR, TWR and the inflation over the same period
  const todayISO = window.MaerminUtils.todayISO();
  const firstTx = useMemo(() => transactions.reduce((m, tx) => { const d = String(tx && tx.date || '').slice(0, 10); return d && (!m || d < m) ? d : m; }, ''), [transactions]);
  const real = useMemo(() => {
    if (!RRm || !hicp.series) return null;
    const start = twrInfo.since || firstTx;
    return {
      xirr: figs.xirr !== null && figs.xirrFlows ? RRm.realXirr(figs.xirrFlows, hicp.series, window.MaerminReturns.xirr) : null,
      twr: twrInfo.value !== null && twrInfo.since ? RRm.realTwr(twrInfo.value, twrInfo.since, todayISO, hicp.series) : null,
      inflation: start ? RRm.inflation(hicp.series, start, todayISO) : null
    };
  }, [RRm, hicp.series, figs, twrInfo, firstTx, todayISO]);
  const regionName = (g) => {
    if (g === 'EA') return __('rrEuroArea', 'Euro area');
    try { return new Intl.DisplayNames([window.MaerminI18n.lang()], { type: 'region' }).of(g === 'EL' ? 'GR' : g); } catch (e) { return g; }
  };
  const since = twrInfo.since ? window.MaerminI18n.date(twrInfo.since) : '';
  const twrSub = twrInfo.source === 'daily'
    ? (__('retTwrSince', 'Time-weighted, since {date}', { date: since }) + (twrInfo.annualized !== null ? ' · ' + __('retPa', '{pct} p.a.', { pct: window.MaerminI18n.pct(twrInfo.annualized * 100, 2, true) }) : ''))
    : twrInfo.source === 'snapshots' ? __('retSnapshotsSince', 'From daily value snapshots since {date}', { date: since })
    : twrInfo.source === 'refresh' ? __('retFromRefreshes', 'From your price refreshes')
    : __('retNoHistory', 'No price history yet');
  // P5-1.4: say when the cash of the clearing account is part of the figure
  const twrSubCash = twrSub + (twrInfo.source === 'daily' && valuePath && valuePath.cash ? ' · ' + __('retInclCash', 'incl. cash account') : '')
    + (gross && twrInfo.source !== 'daily' && twrInfo.source !== 'none' ? ' · ' + __('gnTwrNetOnly', 'after taxes and fees') : '');

  // Simple holding period stats — every amount in EUR (P5-1.5: from figs).
  const stats = useMemo(() => {
    if (!transactions.length) return null;
    const dates = transactions.map(tx => new Date(tx.date)).sort((a,b)=>a-b);
    const holdingDays = dates.length > 0 ? Math.floor((new Date() - dates[0]) / (24*3600*1000)) : 0;
    return { invested: figs.invested, received: figs.proceeds, currentValue, totalReturn: figs.netReturn,
      totalReturnPct: figs.netReturnPct === null ? 0 : figs.netReturnPct, totalFees: figs.fees, holdingDays };
  }, [transactions, figs, currentValue]);

  const UIC = window.MaerminComponents;
  const fmtPct = v => v !== null ? window.MaerminI18n.pct(v * 100, 2, true) : '—';
  const money = v => `${formatPrice(v)} ${getCurrencySymbol()}`;
  // R4.1: the answer tiles (Card + Stat) and the money behind them as smaller tiles
  const tile = (testid, attrs, label, value, sub, tone, extra) => React.createElement(UIC.Card, Object.assign({ variant: 'answer', className: 'ui-ov-tile', 'data-testid': testid }, attrs || {}),
    React.createElement(UIC.Stat, { label, value: React.createElement('span', { className: 'mx-kpi-value' }, value), sub, tone }), extra || null);
  const small = (key, label, value, sub) => React.createElement(UIC.Stat, { key, 'data-stat': key, className: 'ui-tile', label, value: React.createElement('span', { className: 'mx-kpi-value' }, value), sub });
  const inflSub = real && real.inflation
    ? __('rrInflSub', 'Prices since {date}', { date: window.MaerminI18n.date(twrInfo.since || firstTx) })
      + (real.inflation.annualized !== null ? ' · ' + __('retPa', '{pct} p.a.', { pct: fmtPct(real.inflation.annualized) }) : '')
      + ' · ' + __('rrSource', 'Eurostat HICP up to {month}', { month: real.inflation.to })
    : hicp.state === 'none' ? __('rrNeedWorker', 'Consumer prices come through your Worker - add its URL in API Settings.')
    : hicp.state === 'outdated' ? __('rrOutdated', 'Your Worker does not send consumer prices yet. Redeploy it with the current version.')
    : hicp.state === 'loading' ? __('rrLoading', 'Loading consumer prices…')
    : __('rrUnavailable', 'Consumer prices are not available right now.');

  return React.createElement('div', { className: 'ui-view', 'data-testid': 'returns-view' },
    React.createElement('div', { className: 'ui-view__bar' },
      React.createElement('p', { className: 'ui-view__lead' },
        t.returnsHint || 'XIRR (Money-Weighted Return) accounts for the timing and size of your cash flows. TWR shows portfolio performance independent of cash flows.'),
      setGrossNet && React.createElement(GrossNetSwitch, { value: grossNet, onChange: setGrossNet, theme, testid: 'returns-gross-net' })),
    gross && React.createElement('p', { 'data-testid': 'gross-note', className: 'ui-note ui-note--flush' },
      __('gnReturnsNote', 'Gross: withholding tax, tax bookings and fees count as money taken out, not as a loss.')),

    // The answer: XIRR, TWR, total return, inflation over the same period
    React.createElement('div', { className: 'ui-ov-tiles', 'data-testid': 'returns-answer' },
      tile('xirr-card', { 'data-real': real && real.xirr !== null ? real.xirr : '' }, __('retXirr', 'XIRR (annualized)'), xirrResult !== null ? fmtPct(xirrResult) : '—',
        (clearings ? __('retXirrSubCash', 'Money-weighted p.a., from deposits and withdrawals') : __('retXirrSub', 'Money-weighted return p.a.'))
          + (real && real.xirr !== null ? ' · ' + __('rrRealPa', 'real {pct} p.a.', { pct: fmtPct(real.xirr) }) : ''), xirrResult !== null ? UIC.toneOf(xirrResult) : null),
      tile('twr-card', { 'data-source': twrInfo.source, 'data-real': real && real.twr ? real.twr.real : '' }, 'TWR', twrResult !== null ? fmtPct(twrResult) : '—',
        twrSubCash + (real && real.twr ? ' · ' + __('rrReal', 'real {pct}', { pct: fmtPct(real.twr.real) }) + (real.twr.realAnnualized !== null ? ' (' + __('retPa', '{pct} p.a.', { pct: fmtPct(real.twr.realAnnualized) }) + ')' : '') : ''),
        twrResult !== null ? UIC.toneOf(twrResult) : null),
      stats && tile('total-return-card', { 'data-v': stats.totalReturn }, __('ovTotalReturn', 'Total Return'), fmtPct(stats.totalReturnPct),
        (stats.totalReturn > 0 ? '+' : stats.totalReturn < 0 ? '−' : '') + money(Math.abs(stats.totalReturn)) + (gross ? ' · ' + __('gnBeforeShort', 'before taxes and fees') : ''), UIC.toneOf(stats.totalReturnPct)),
      // P5-2.9: inflation over the same period, with the region
      RRm && tile('inflation-card', { 'data-state': hicp.state, 'data-v': real && real.inflation ? real.inflation.total : '' }, __('rrInflation', 'Inflation'),
        real && real.inflation ? fmtPct(real.inflation.total) : (hicp.state === 'loading' ? '…' : '—'), inflSub, null,
        React.createElement('div', { className: 'ui-ret-infl' },
          setHicpGeo && React.createElement(UIC.Select, { 'data-testid': 'hicp-geo', 'aria-label': __('rrRegion', 'Region of the consumer prices'), value: geo, className: 'ui-input--sm',
            onChange: (e) => setHicpGeo(e.target.value), options: RRm.GEOS.map((g) => ({ value: g, label: regionName(g) })) }),
          window.MaerminDemoFixtures && window.MaerminDemoFixtures.badge ? window.MaerminDemoFixtures.badge(React, theme, workerUrl) : null))
    ),

    // The money behind the figures
    stats && React.createElement(UIC.Card, { title: __('retMoneyTitle', 'Money in and out'), headingLevel: 'h3', 'data-testid': 'returns-money' },
      React.createElement('div', { className: 'ui-tiles' },
        small('bought', __('retTotalBought', 'Total bought'), money(stats.invested), __('retTotalBoughtSub', 'All purchases, incl. fees')),
        small('value', __('retCurrentValue', 'Current Value'), money(stats.currentValue), __('retOpenPositions', 'Open positions')),
        small('proceeds', __('retProceeds', 'Proceeds received'), money(stats.received), __('retRealizedSub', 'Sales + dividends/interest')),
        small('fees', __('retTotalFees', 'Total Fees'), money(stats.totalFees), __('retAllTx', 'All transactions')),
        small('held', __('holdingPeriod', 'Holding Period'), __('retDays', '{n} d', { n: stats.holdingDays }), __('retSinceFirst', 'Since first transaction')))),

    // P4-1: month × year grid of the same chain of returns
    // P5-2.4: cells open the period's detail; the filter narrows to a subset
    React.createElement(ReturnsHeatmap, hmFiltered
      ? { steps: hmFiltered.steps, points: hmFiltered.points, transactions: hmFiltered.txs, source: 'daily', theme, formatPrice, getCurrencySymbol, controls: hmControls,
          note: __('rhdFilterNote', 'Only the selected holdings, from the same daily closing prices; the cash account is left out.') }
      : { steps: twrInfo.steps, points: twrInfo.points, transactions, source: twrInfo.source, theme, formatPrice, getCurrencySymbol, controls: hmControls }),

    // Explanation
    React.createElement('div', { className: 'ui-callout', 'data-testid': 'returns-note' },
      React.createElement('strong', null, __('retNote', 'Note:') + ' '),
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
    ),
    panels || null
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

  // R4.5: category colours from the chart palette (as on the Overview); text stays the text colour
  const catColors = { crypto: 'var(--chart-1)', stocks: 'var(--chart-2)', skins: 'var(--chart-3)', commodities: 'var(--chart-4)' };
  const UIC = window.MaerminComponents;
  const CARD = ['ui-card', 'ui-card--pad', 'ui-rb-card'].join(' ');
  const catLabels = { crypto: I.category('crypto'), stocks: I.category('stocks'), skins: I.category('skins'), commodities: I.category('commodities') };
  const small = { color: 'var(--text-dim)', fontSize: 'var(--type-caption)' };

  // A number field that commits on blur / Enter (typing "2," must not snap back).
  const NumField = ({ value, onCommit, label, suffix, id }) => React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '0.3rem' } },
    React.createElement('input', {
      key: id + ':' + value, id, type: 'text', inputMode: 'decimal', defaultValue: I.num(value, { min: 0, max: 2 }), 'aria-label': label, className: ['ui-input', 'ui-input--sm', 'ui-input--num'].join(' '),
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
  const modeOpt = (id, label) => ({ value: id, label, attrs: { 'data-rb-mode': id } });
  const cashflow = prefs.mode === 'cashflow';

  const actionLabel = (r) => {
    if (r.action === 'buy') return `${__('rbBuy', '+ Buy')} ${money(r.deltaValue)}`;
    if (r.action === 'sell') return `${__('rbSell', '− Sell')} ${money(-r.deltaValue)}`;
    if (r.blockedSell > 0.005) return __('rbHoldBlocked', 'Hold (never-sell holdings)');
    return Math.abs(r.driftPp) <= r.bandPp ? __('rbWithinBand', '✓ Within ±{pp} pp', { pp: I.num(r.bandPp, { min: 0, max: 1 }) }) : __('rbBalanced', '✓ Balanced');
  };

  return React.createElement('div', { className: 'ui-view', 'data-testid': 'rebalancing-view' },
    // This view rebalances by ASSET CLASS. Tag-based target weights live in the Tags view.
    React.createElement('div', { className: 'ui-view__bar' },
      React.createElement('p', { className: 'ui-view__lead' }, __('rbLead', 'Compare your asset classes with the weights you choose, and see what to buy or sell to get back.')),
      (setActiveView && window.MaerminTags) ? React.createElement(UIC.Button, { variant: 'quiet', onClick: () => setActiveView('tags') },
        '⛯ ', (t.rebalanceByTagHint || 'Rebalance by tag instead → Tags view')) : null),

    // No targets yet: nothing to plan until the user sets them.
    noTargets && !editing && window.MaerminUtils.emptyState({
      testid: 'rb-no-targets',
      title: __('rbNoTargetsTitle', 'No target allocation yet'),
      text: __('rbNoTargetsText', 'Rebalancing compares your holdings with target weights that you choose. Nothing is suggested until you set them.'),
      actions: [
        holdings.length > 0 && { label: __('rbUseCurrent', 'Use my current allocation'), onClick: useCurrent, variant: 'primary', props: { 'data-rb-use-current': true } },
        { label: __('rbSetTargets', 'Set targets'), onClick: () => setEditing(true), props: { 'data-rb-set-targets': true } }
      ]
    }),

    // Mode + new money
    !noTargets && React.createElement('div', { className: CARD },
      React.createElement(UIC.Segmented, { label: __('rbModeAria', 'How to rebalance'), value: prefs.mode, onChange: (id) => setPrefs({ ...prefs, mode: id }),
        options: [modeOpt('full', __('rbModeFull', 'Buy and sell')), modeOpt('cashflow', __('rbModeCash', 'Invest only (no sales)'))] }),
      React.createElement('p', { className: 'ui-note' }, cashflow
        ? __('rbModeCashHint', 'New money goes to the classes furthest below target, in proportion to the gap. Nothing is sold.')
        : __('rbModeFullHint', 'Classes outside their tolerance band go back to target: sales first, then buys from the sales and any new money.')),
      React.createElement('label', { htmlFor: 'rb-invest', className: 'ui-field__label' },
        cashflow ? __('rbInvestAmount', 'Amount to invest') : (t.additionalInvestment || 'Additional amount (optional)')),
      React.createElement('input', {
        id: 'rb-invest', type: 'text', inputMode: 'decimal', value: investAmount,
        onChange: e => setInvestAmount(e.target.value),
        placeholder: I.num(0, { min: 2, max: 2 }),
        className: ['ui-input', 'ui-rb-invest'].join(' ')
      })
    ),

    // Target allocation + tolerance per target
    (!noTargets || editing) && React.createElement('div', { className: CARD },
      React.createElement('div', { className: 'ui-rb-head' },
        React.createElement('h3', { className: 'ui-card__title' }, t.targetAllocation || 'Target Allocation'),
        React.createElement(UIC.Badge, { tone: totalTarget === 100 ? 'gain' : 'loss' }, `${I.pct(totalTarget, 0)} ${totalTarget === 100 ? '✓' : '≠ ' + I.pct(100, 0)}`)
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
            React.createElement('label', { htmlFor: 'rb-t-' + cat, className: 'ui-rb-cat' }, React.createElement('span', { className: 'ui-swatch', style: { background: catColors[cat] }, 'aria-hidden': 'true' }), catLabels[cat]),
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
              own && React.createElement(UIC.Button, { size: 'sm', variant: 'quiet', onClick: () => resetBand(cat) }, __('rbBandUseDefault', 'Use the default'))))
        );
      })
    ),

    // Never sell
    !noTargets && holdings.length > 0 && React.createElement('details', { 'data-testid': 'rb-nosell', className: CARD },
      React.createElement('summary', { className: 'ui-rb-summary' },
        __('rbNoSellTitle', 'Holdings you never sell ({n})', { n: prefs.noSell.filter(s => holdings.some(h => h.symbol.toUpperCase() === s)).length })),
      React.createElement('p', { style: { ...small, margin: '0.5rem 0 0.75rem', lineHeight: 1.5 } },
        __('rbNoSellHint', 'A class can only be sold down with the holdings that are not marked here. What cannot be sold is shown in the plan.')),
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.35rem' } },
        holdings.map(h => React.createElement('label', { key: h.cat + '|' + h.symbol, className: 'ui-rb-nosell' },
          React.createElement('input', { type: 'checkbox', checked: noSellSet.has(h.symbol.toUpperCase()), onChange: () => toggleNoSell(h.symbol), 'data-nosell': h.symbol, className: 'ui-rb-check' }),
          React.createElement('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, h.name, React.createElement('span', { style: { ...small, marginLeft: '0.4rem' } }, catLabels[h.cat])),
          React.createElement('span', { style: small }, money(h.value)))))
    ),

    // Results table
    totalValue > 0 && !noTargets && React.createElement('section', {
      'data-testid': 'rb-plan', className: ['ui-card', 'ui-card--table'].join(' ')
    },
      React.createElement('div', { className: 'ui-rb-planhead' },
        React.createElement('h3', { className: 'ui-card__title' }, t.rebalancingPlan || 'Rebalancing Plan'),
        React.createElement('p', { 'data-testid': 'rb-summary', className: 'ui-note' },
          [(result.summary.toBuy > 0.005 || result.summary.toSell > 0.005) ? __('rbSumBuy', 'Buy {amt}', { amt: money(result.summary.toBuy) }) : __('rbSumNothing', 'Nothing to buy or sell'),
           !cashflow && result.summary.toSell > 0.005 && __('rbSumSell', 'sell {amt}', { amt: money(result.summary.toSell) }),
           result.summary.cashLeft > 0.005 && __('rbSumCashLeft', '{amt} stays uninvested (after these trades every class is within its band)', { amt: money(result.summary.cashLeft) }),
           result.summary.blocked > 0.005 && __('rbSumBlocked', '{amt} cannot be sold (never-sell holdings)', { amt: money(result.summary.blocked) })
          ].filter(Boolean).join(' · '))
      ),
      React.createElement('div', { role: 'region', tabIndex: 0, 'aria-label': t.rebalancingPlan || 'Rebalancing Plan', className: 'ui-table-wrap' },
      React.createElement('table', { className: 'ui-table' },
        React.createElement('thead', null,
          React.createElement('tr', null,
            [__('category', 'Category'), __('rbCurrent', 'Current'), __('rbCurrentPct', 'Current %'), __('rbTargetPct', 'Target %'), __('targetValue', 'Target Value'), __('action', 'Action')].map((h, i) =>
              React.createElement('th', { key: i, scope: 'col', className: i === 0 ? undefined : 'is-right' }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          CATS.map(cat => {
            const r = rowOf[cat];
            // Only classes the user holds or has a target for.
            if (!r || (!(r.actualValue > 0.005) && !(r.targetPct > 0))) return null;
            const tone = r.action === 'buy' ? 'gain' : r.action === 'sell' ? 'loss' : (r.blockedSell > 0.005 ? 'warning' : 'gain');
            return React.createElement('tr', { key: cat, 'data-rb-row': cat, 'data-action': r.action },
              React.createElement('td', null, React.createElement('span', { className: 'ui-rb-cat' }, React.createElement('span', { className: 'ui-swatch', style: { background: catColors[cat] }, 'aria-hidden': 'true' }), catLabels[cat])),
              React.createElement('td', { className: ['is-right', 'num'].join(' ') }, money(r.actualValue)),
              React.createElement('td', { className: ['is-right', 'num'].join(' ') },
                React.createElement('span', { className: 'ui-rb-pct' },
                  React.createElement('span', { className: 'ui-meter', 'aria-hidden': 'true' },
                    React.createElement('span', { className: 'ui-meter__fill', style: { width: `${Math.min(100, r.actualPct)}%`, background: catColors[cat] } })),
                  I.pct(r.actualPct, 1))
              ),
              React.createElement('td', { className: ['is-right', 'num', 'is-strong'].join(' ') }, I.pct(r.targetPct, 0)),
              React.createElement('td', { className: ['is-right', 'num'].join(' ') }, money(r.targetValue)),
              React.createElement('td', { className: 'is-right' },
                React.createElement(UIC.Badge, { tone }, actionLabel(r)),
                r.blockedSell > 0.005 && r.action !== 'hold' && React.createElement('div', { className: 'ui-note' },
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

const FALLBACK_TINTS = ['#8b7cff', '#3b82f6', '#14b8a6', '#f97316', '#ec4899', '#22c55e'];
function BrokerLogo({ brokerId, name, size = 36 }) {
  const svg = BROKER_LOGOS[brokerId];
  if (!svg) {
    // No logo: the initials (Portfolio Performance -> PP) on a tint picked from
    // the name, so tiles without a logo are told apart; text in the theme colour
    // (violet on violet was 3.27:1 on the light theme).
    const words = String(name || '?').trim().split(/\s+/);
    const initials = (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
    const hue = FALLBACK_TINTS[[...String(name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % FALLBACK_TINTS.length];
    return React.createElement('div', {
      'aria-hidden': 'true',
      style: {
        width: size, height: size, borderRadius: '8px', flexShrink: 0,
        background: `color-mix(in srgb, ${hue} 22%, transparent)`, border: `1px solid color-mix(in srgb, ${hue} 40%, transparent)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.36) + 'px', fontWeight: '800', color: 'var(--text)', letterSpacing: '-0.02em'
      }
    }, initials);
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

function BrokerImportWizard({ theme, t, addToast, onImport, existing, workerUrl, embedded }) {
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

  // PDF statements (Trade Republic, Scalable, ING, DKB, Comdirect; P5-3.2 flatex,
  // Consorsbank, DEGIRO, onvista bank; P5-3.3 Baader Bank, Smartbroker+,
  // Sparkasse / Deka, Postbank - incl. tax and fee documents): extract +
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
    if (!rawData || !selectedBroker) return;
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
        fontWeight: '600', fontSize: 'var(--text-base)', opacity: disabled ? 0.5 : 1,
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
    return React.createElement('div', { role: 'status', style: { background: bad ? 'color-mix(in srgb, var(--danger) 6%, transparent)' : 'color-mix(in srgb, var(--warning) 8%, transparent)', border: `1px solid ${bad ? 'color-mix(in srgb, var(--danger) 30%, transparent)' : 'color-mix(in srgb, var(--warning) 30%, transparent)'}`, borderRadius: '8px', padding: '0.6rem 0.8rem', marginBottom: '0.9rem', fontSize: 'var(--text-xs)', color: theme.text, lineHeight: 1.6 } },
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

  // embedded: inside Data Management, which names the section already (no
  // second heading, no second padding)
  return React.createElement('div', { style: { padding: embedded ? 0 : '1.5rem' } },
    !embedded && React.createElement('h2', { style: { color: theme.text, fontSize: 'var(--text-xl)', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '1.25rem' } },
      (t.brokerImport || 'Import')
    ),

    // Step indicator
    React.createElement('div', { style: { display: 'flex', gap: '0', marginBottom: '2rem', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${theme.cardBorder}` } },
      steps.map((s, i) =>
        React.createElement('div', { key: i, style: {
          flex: 1, padding: '0.625rem', textAlign: 'center', fontSize: 'var(--text-sm)',
          fontWeight: i === step ? '700' : '400',
          background: i === step ? (theme.accentFill || theme.accent) : i < step ? 'var(--accent-soft)' : theme.card,
          color: i === step ? 'var(--on-accent)' : i < step ? theme.accent : theme.textSecondary,
          borderRight: i < steps.length-1 ? `1px solid ${theme.cardBorder}` : 'none'
        } }, `${i < step ? '✓ ' : ''}${s}`)
      )
    ),

    // ── Step 0: Source select ────────────────────────────────────────────────
    step === 0 && React.createElement('div', null,
      categories.map(cat =>
        React.createElement('div', { key: cat, style: { marginBottom: '1.25rem' } },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-2xs)', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem', paddingLeft: '0.25rem' } }, ({ 'Portfolio Tracker': __('biCatTracker', 'Portfolio Tracker'), Broker: __('biCatBroker', 'Broker'), Crypto: __('crypto', 'Crypto'), Other: __('biCatOther', 'Other') })[cat] || cat),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0.625rem' } },
            BROKERS.filter(b => b.category === cat).map(b =>
              React.createElement('div', {
                key: b.id,
                ...window.MaerminUtils.clickable(() => { setBroker(b.id); setStep(1); }),
                'aria-label': __('biSelectBroker', 'Select broker {name}', { name: b.name || b.id }),
                style: {
                  background: selectedBroker === b.id ? `${window.MaerminTokens.alpha(theme.accent, 0x22)}` : theme.card,
                  border: `1px solid ${selectedBroker === b.id ? theme.accent : theme.cardBorder}`,
                  borderRadius: '10px', padding: '0.875rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.75rem', transition: 'all 0.15s'
                }
              },
                React.createElement(BrokerLogo, { brokerId: b.id, name: b.name, size: 36 }),
                React.createElement('div', null,
                  React.createElement('div', { style: { color: theme.text, fontWeight: '600', fontSize: 'var(--text-base)' } }, b.name),
                  React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-2xs)', marginTop: '0.125rem' } }, b.hintKey ? __(b.hintKey, b.hint) : b.hint)
                )
              )
            )
          )
        )
      )
    ),

    // ── Step 1: CoinTracking info + file upload ──────────────────────────────
    step === 1 && selectedBroker === 'cointracking' && React.createElement('div', null,
      React.createElement('div', {
        style: { background: 'color-mix(in srgb, var(--success) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 20%, transparent)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', fontSize: 'var(--text-sm)', color: theme.textSecondary, lineHeight: '1.8' }
      },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.375rem' } }, __('biCtInstr', 'CoinTracking export instructions:')),
        React.createElement('div', null, '1. ' + __('biCtStep1', 'In CoinTracking:') + ' ', React.createElement('b', { style: { color: theme.text } }, 'Reports → All Transactions')),
        React.createElement('div', null, '2. ' + __('biCtStep2', 'Top right:') + ' ', React.createElement('b', { style: { color: theme.text } }, '"Export" → "CSV (Full Export)"')),
        React.createElement('div', null, __('biCtStep3', '3. Upload the downloaded file here')),
        React.createElement('div', { style: { marginTop: '0.5rem', color: theme.accent, fontSize: 'var(--text-xs)' } }, __('biCtBooked', '✓ Booked: Trade, Income, Staking, Mining, Airdrop, Gift/Tip, Interest, Spend · English and German exports')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)' } }, __('biCtFull', 'Use the full export: its "value in EUR" columns price coin-to-coin trades and rewards. Deposits and withdrawals are transfers and are not booked.'))
      ),
      React.createElement('div', {
        onDrop: handleDrop, onDragOver: e => e.preventDefault(),
        ...window.MaerminUtils.clickable(() => fileRef.current?.click()),
        'aria-label': __('biChooseCsv', 'Choose CSV file to import'),
        style: { border: `2px dashed ${theme.cardBorder}`, borderRadius: '16px', padding: '2.5rem', textAlign: 'center', cursor: 'pointer', marginBottom: '1rem' }
      },
        React.createElement('div', { style: { fontSize: 'var(--text-2xl)', marginBottom: '0.5rem', opacity: 0.4 } }, '↑'),
        React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.25rem' } }, __('biDropCt', 'Drop CoinTracking CSV here')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-sm)' } }, __('biOrClickSelect', 'or click to select')),
        React.createElement('input', { type: 'file', accept: '.csv,.txt', ref: fileRef, style: { display: 'none' }, onChange: e => handleFile(e.target.files[0]) })
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
        btn(__('back', '← Back'), () => setStep(0))
      )
    ),

    // ── Step 1: Generic file upload ──────────────────────────────────────────
    step === 1 && selectedBroker !== 'cointracking' && React.createElement('div', null,
      (selectedBroker === 'portfolioPerformance' || selectedBroker === 'parqet') && React.createElement('div', { 'data-testid': 'tracker-howto', style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '1rem', marginBottom: '1rem', fontSize: 'var(--text-sm)', color: theme.textSecondary, lineHeight: '1.8' } },
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
      exchangeSyncSupported && React.createElement('p', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', lineHeight: '1.6', marginBottom: '1rem' } },
        __('biPreferLive', 'Prefer a live import? Use Exchange sync below with a read-only API key (stored encrypted in your vault).')),
      React.createElement('div', {
        onDrop: handleDrop, onDragOver: e => e.preventDefault(),
        ...window.MaerminUtils.clickable(() => fileRef.current?.click()),
        'aria-label': __('biChooseCsv', 'Choose CSV file to import'),
        style: { border: `2px dashed ${theme.cardBorder}`, borderRadius: '16px', padding: '3rem', textAlign: 'center', cursor: 'pointer', marginBottom: '1rem' }
      },
        React.createElement('div', { style: { fontSize: 'var(--text-2xl)', marginBottom: '0.5rem', opacity: 0.4 } }, '↑'),
        React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.25rem' } }, pdfBusy ? __('biReadingPdf', 'Reading PDF statement(s)...') : __('biDragHere', 'Drag CSV or PDF statement(s) here')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-base)' } }, `${__('biOrClick', 'Or click')} · ${selectedBrokerObj?.name || ''} · ${selectedBrokerObj ? (selectedBrokerObj.hintKey ? __(selectedBrokerObj.hintKey, selectedBrokerObj.hint) : selectedBrokerObj.hint) : ''}`),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', marginTop: '0.3rem' } }, __('biPdfSupported', 'PDF statements: Trade Republic, Scalable, ING, DKB, Comdirect, flatex, Consorsbank, DEGIRO, onvista bank, Baader Bank, Smartbroker+, Sparkasse / Deka, Postbank - trades, dividends, tax and fee documents; parsed on this device, the file never leaves it.')),
        React.createElement('input', { type: 'file', accept: '.csv,.txt,.json,.pdf', multiple: true, ref: fileRef, style: { display: 'none' }, onChange: e => handleFiles(e.target.files) })
      ),
      React.createElement('p', { style: { color: theme.textSecondary, fontSize: 'var(--text-sm)', lineHeight: '1.6' } }, __('biLocalOnly', 'All data stays local. Nothing is uploaded.')),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '1rem' } },
        btn(__('back', '← Back'), () => setStep(0)),
        btn(__('biPasteText', 'Paste text'), () => { setRawData(' '); setStep(2); })
      )
    ),

    // ── Step 2: Preview & mapping ────────────────────────────────────────────
    step === 2 && React.createElement('div', null,
      (!mp && parsed.length > 0) && currencyNotice(parsed),
      fileName && React.createElement('div', { style: { marginBottom: '1rem', color: theme.textSecondary, fontSize: 'var(--text-base)' } }, `${fileName}`),

      // Paste fallback when there is no data yet (or the mapping module is absent).
      (!mp && parsed.length === 0) && React.createElement('div', null,
        React.createElement('p', { style: { color: theme.warning, marginBottom: '1rem' } }, __('biNoneDetected', 'No transactions detected. Paste CSV content manually:')),
        React.createElement('textarea', {
          value: rawData === ' ' ? '' : rawData,
          onChange: e => setRawData(e.target.value),
          placeholder: __('biPasteCsvPh', 'Paste CSV content...'),
          style: { width: '100%', height: '150px', padding: '0.75rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontFamily: 'monospace', fontSize: 'var(--text-sm)', resize: 'vertical', marginBottom: '0.75rem' }
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
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.9rem', fontSize: 'var(--text-sm)' } },
            mp.broker && React.createElement('span', { style: { padding: '0.25rem 0.6rem', borderRadius: '20px', background: `${window.MaerminTokens.alpha(theme.accent, 0x1e)}`, color: theme.accent, fontWeight: '700' } }, mp.broker.chosen ? __('biColsDetected', '{name} (columns detected)', { name: mp.broker.name }) : __('biDetected', 'Detected: {name}', { name: mp.broker.name })),
            React.createElement('span', { style: { padding: '0.25rem 0.6rem', borderRadius: '20px', background: 'color-mix(in srgb, var(--success) 15%, transparent)', color: theme.success, fontWeight: '700' } }, __('biValid', '✓ {n} valid', { n: mp.stats.ok })),
            mp.errors.length > 0 && React.createElement('span', { ...window.MaerminUtils.clickable(() => setShowErrors(v => !v)), 'aria-label': __('biToggleErrors', 'Toggle error details'), style: { padding: '0.25rem 0.6rem', borderRadius: '20px', background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)', fontWeight: '700', cursor: 'pointer' } }, `${__('biSkipped', '✗ {n} skipped', { n: mp.errors.length })} ${showErrors ? '▲' : '▼'}`),
            (mp.stats.duplicates > 0) && React.createElement('span', { style: { padding: '0.25rem 0.6rem', borderRadius: '20px', background: 'color-mix(in srgb, var(--warning) 15%, transparent)', color: theme.warning, fontWeight: '700' } }, __('biDuplicates', '! {n} {n:duplicate|duplicates}', { n: mp.stats.duplicates }))
          ),

          // Fixed-format files (CoinTracking) are read by their own parser: say
          // how rows are booked and list what needs a look instead of a mapping.
          mp.fixedFormat && React.createElement('div', { 'data-testid': mp.format ? 'tracker-info' : 'ct-info', style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '0.9rem', marginBottom: '0.9rem', fontSize: 'var(--text-xs)', color: theme.textSecondary, lineHeight: 1.6 } },
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
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' } }, __('biColMapping', 'Column mapping (edit if a column is wrong)')),
            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.6rem' } },
              (window.MaerminImportMapping.FIELDS).map(field =>
                React.createElement('label', { key: field, style: { display: 'block' } },
                  React.createElement('span', { style: { display: 'block', color: theme.textSecondary, fontSize: 'var(--text-2xs)', marginBottom: '0.2rem' } },
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
            reqMissing.length > 0 && React.createElement('div', { style: { color: 'var(--danger)', fontSize: 'var(--text-xs)', marginTop: '0.5rem' } }, __('biMapRequired', 'Map the required field(s): {list}', { list: reqMissing.map(fieldLabel).join(', ') })),

            // Reusable mapping presets (WI-8): load a saved mapping for this
            // broker, save the current one, or delete a preset.
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.7rem', paddingTop: '0.7rem', borderTop: `1px solid ${theme.cardBorder}` } },
              React.createElement('span', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', fontWeight: '700' } }, t.presetLabel || 'Mapping preset'),
              React.createElement('select', {
                value: selectedPreset, onChange: e => applyPresetById(e.target.value),
                style: { padding: '0.35rem 0.5rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, fontSize: 'var(--text-xs)' }
              },
                React.createElement('option', { value: '' }, t.presetLoad || 'Load preset…'),
                presets.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name))
              ),
              React.createElement('button', { onClick: saveCurrentPreset,
                style: { padding: '0.35rem 0.7rem', background: (theme.accentFill || theme.accent), color: 'var(--on-accent)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: '700' } }, t.presetSave || 'Save preset'),
              selectedPreset && React.createElement('button', { onClick: deleteSelectedPreset,
                style: { padding: '0.35rem 0.7rem', background: 'none', color: theme.textSecondary, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', cursor: 'pointer', fontSize: 'var(--text-xs)' } }, t.presetDelete || 'Delete')
            )
          ),

          // ISIN → ticker: one row per ISIN with the proposed listing, editable.
          isinList.length > 0 && React.createElement('div', { 'data-testid': 'isin-map', style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '0.9rem', marginBottom: '0.9rem' } },
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' } }, __('biIsinTicker', 'ISIN → ticker')),
            React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-xs)', lineHeight: 1.5, marginBottom: '0.6rem' } },
              isinBusy ? __('biLookingUp', 'Looking up listings…')
                : __('biIsinHint', 'Prices are fetched per listing, so each ISIN needs a ticker. Proposed: the listing in the trade currency. Change it if it is not the one you hold.')),
            isinList.map(x => {
              const pick = isinPicks[x.isin] || {};
              const cands = isinCands[x.isin] || [];
              const inCands = cands.some(c => String(c.symbol).toUpperCase() === pick.symbol);
              return React.createElement('div', { key: x.isin, style: { display: 'grid', gridTemplateColumns: 'minmax(120px, 150px) minmax(140px, 1fr) minmax(110px, 140px)', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem', fontSize: 'var(--text-xs)' } },
                React.createElement('span', { style: { color: theme.text, fontFamily: 'monospace' } }, x.isin, React.createElement('span', { style: { color: theme.textSecondary } }, ' · ' + x.currency)),
                React.createElement('select', {
                  'aria-label': __('biListingFor', 'Listing for {isin}', { isin: x.isin }), value: inCands ? pick.symbol : '',
                  onChange: e => { const c = cands.find(k => String(k.symbol).toUpperCase() === e.target.value); if (c) setIsinTicker(x.isin, c.symbol, c.name); },
                  disabled: !cands.length,
                  style: { padding: '0.4rem 0.5rem', minHeight: '40px', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, fontSize: 'var(--text-xs)', width: '100%' }
                },
                  React.createElement('option', { value: '' }, cands.length ? ((pick.symbol && !inCands) ? __('biOther', 'other: {sym}', { sym: pick.symbol }) : __('biChooseListing', '— choose a listing —')) : (isinBusy ? __('biSearching', 'searching…') : (workerUrl ? __('biNoListing', 'no listing found') : __('biNeedsWorker', 'needs a Worker URL')))),
                  cands.map(c => React.createElement('option', { key: c.symbol, value: String(c.symbol).toUpperCase() }, `${c.symbol} — ${c.name || ''}${c.exchange ? ' (' + c.exchange + ')' : ''}`))
                ),
                React.createElement('input', {
                  'aria-label': __('biTickerFor', 'Ticker for {isin}', { isin: x.isin }), placeholder: __('biTickerPh', 'ticker'), value: pick.symbol || '',
                  onChange: e => setIsinTicker(x.isin, e.target.value, ''),
                  style: { padding: '0.4rem 0.5rem', minHeight: '40px', background: theme.inputBg, border: `1px solid ${pick.symbol ? theme.inputBorder : 'var(--danger)'}`, borderRadius: '6px', color: theme.text, fontSize: 'var(--text-xs)', width: '100%', boxSizing: 'border-box' }
                }),
                pick.currencyMismatch && React.createElement('span', { style: { gridColumn: '1 / -1', color: 'var(--warning)', fontSize: 'var(--text-xs)' } }, __('biCurMismatch', 'No {cur} listing found — {sym} is quoted in another currency. Its price is converted, so P&L will include the exchange-rate move.', { cur: x.currency, sym: pick.symbol }))
              );
            }),
            (!isinBusy && mp.stats.isinUnresolved > 0) && React.createElement('div', { role: 'status', 'data-testid': 'isin-unresolved', style: { color: 'var(--danger)', fontSize: 'var(--text-xs)', marginTop: '0.4rem' } },
              __('biIsinUnresolved', '{n} {n:row has|rows have} no ticker yet. They would be imported under their ISIN and stay without a price — enter a ticker above.', { n: mp.stats.isinUnresolved }))
          ),

          // Currencies that can't be converted exactly (see MaerminFxHistory.txToEUR).
          currencyNotice(mp.transactions),

          // Row-accurate error report.
          showErrors && mp.errors.length > 0 && React.createElement('div', { style: { background: 'color-mix(in srgb, var(--danger) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)', borderRadius: '8px', padding: '0.6rem 0.8rem', marginBottom: '0.9rem', maxHeight: '160px', overflow: 'auto', fontSize: 'var(--text-xs)' } },
            mp.errors.slice(0, 50).map((er, i) => React.createElement('div', { key: i, style: { color: theme.textSecondary, lineHeight: '1.7' } },
              React.createElement('span', { style: { color: 'var(--danger)', fontWeight: '700' } }, __('importRowLabel', 'Row {row}:', { row: er.row }) + ' '), er.reason)),
            mp.errors.length > 50 && React.createElement('div', { style: { color: theme.textSecondary } }, __('andNMore', '… and {n} more', { n: mp.errors.length - 50 }))
          ),

          // Duplicate handling toggle.
          (mp.stats.duplicates > 0) && React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.9rem', fontSize: 'var(--text-sm)', color: theme.text, cursor: 'pointer' } },
            React.createElement('input', { type: 'checkbox', checked: includeDupes, onChange: e => setIncludeDupes(e.target.checked) }),
            __('biImportDupes', 'Import the {n} {n:duplicate|duplicates} too (already in your portfolio)', { n: mp.stats.duplicates })
          ),

          // Preview table — duplicates greyed + flagged.
          React.createElement('div', { style: { background: theme.card, borderRadius: '10px', border: `1px solid ${theme.cardBorder}`, overflow: 'auto', maxHeight: '300px' } },
            React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '560px', fontSize: 'var(--text-sm)' } },
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
                      React.createElement('span', { style: { padding: '0.125rem 0.375rem', borderRadius: '3px', fontSize: 'var(--text-2xs)', fontWeight: '700', background: window.MaerminUtils.txTypeInfo(tx.type).background, color: window.MaerminUtils.txTypeInfo(tx.type).color } }, window.MaerminUtils.txTypeInfo(tx.type, t).label.toUpperCase())
                    ),
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: tx.unresolvedIsin ? theme.danger : theme.text, fontWeight: '600' } },
                      tx.symbol || '—',
                      (tx.isin && !tx.unresolvedIsin) && React.createElement('div', { style: { color: theme.textSecondary, fontWeight: '400', fontSize: 'var(--text-2xs)', fontFamily: 'monospace' } }, tx.isin),
                      tx.unresolvedIsin && React.createElement('div', { style: { fontWeight: '400', fontSize: 'var(--text-2xs)' } }, __('biNoTicker', 'no ticker'))),
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.text, textAlign: 'right' } }, (typeof tx.quantity === 'number' ? window.MaerminI18n.num(tx.quantity, 4) : '—')),
                    // P5-1.3: a cash row shows its amount in the price column
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.text, textAlign: 'right' } }, (typeof tx.price === 'number' ? window.MaerminI18n.num(tx.price, 2) : typeof tx.amount === 'number' ? window.MaerminI18n.num(tx.amount, 2) + ' ' + (tx.currency || 'EUR') : '—')),
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.textSecondary, textAlign: 'right' } }, window.MaerminI18n.num(typeof tx.fees === 'number' ? tx.fees : 0, 2)),
                    React.createElement('td', { style: { padding: '0.5rem 0.875rem', textAlign: 'right' } }, tx.duplicate ? React.createElement('span', { style: { color: 'var(--warning)', fontSize: 'var(--text-2xs)', fontWeight: '700' } }, 'DUP') : '')
                  )
                )
              )
            )
          ),
          mp.transactions.length > 20 && React.createElement('div', { style: { color: theme.textSecondary, fontSize: 'var(--text-sm)', marginTop: '0.5rem' } }, __('andNMore', '… and {n} more', { n: mp.transactions.length - 20 }))
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
      React.createElement('div', { style: { fontSize: 'var(--text-2xl)', marginBottom: '1rem', color: 'var(--success)' } }, '✓'),
      React.createElement('h3', { style: { color: theme.text, fontSize: 'var(--text-title)', fontWeight: '700', marginBottom: '0.5rem' } }, __('biSuccess', 'Import successful!')),
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
  // R4.5: the view frame, one card per position on the shared card, the
  // shared textarea and buttons; a note is a quiet button that opens the editor.
  const UIC = window.MaerminComponents;

  return React.createElement('div', { className: 'ui-view', 'data-testid': 'journal-view' },
    React.createElement('p', { className: 'ui-view__lead' }, __('jnNotesCount', '{n} of {total} positions have notes', { n: noteCount, total: allPositions.length })),

    allPositions.length === 0
      ? React.createElement(UIC.EmptyState, { text: __('jnAddFirst', 'Add positions first') })
      : React.createElement('div', { className: 'ui-jn-grid' },
          allPositions.map(p => {
            const note = notes[p.key];
            const isActive = active === p.key;
            return React.createElement('section', { key: p.key, 'data-journal': p.key,
              className: ['ui-card', 'ui-jn-card', isActive ? 'is-editing' : '', note?.text ? 'has-note' : ''].join(' ').trim() },
              React.createElement('div', { className: 'ui-jn-head' },
                React.createElement('span', null, React.createElement('b', null, p.sym), ' ', React.createElement('span', { className: 'ui-muted' }, window.MaerminI18n.category(p.cat))),
                note?.updatedAt && React.createElement('span', { className: 'ui-note' }, window.MaerminI18n.date(note.updatedAt))),
              isActive
                ? React.createElement('div', { className: 'ui-jn-edit' },
                    React.createElement('textarea', {
                      value: draft, autoFocus: true, className: ['ui-input', 'ui-textarea'].join(' '),
                      'aria-label': __('jnEditNote', 'Edit note') + ' · ' + p.sym,
                      onChange: e => setDraft(e.target.value),
                      placeholder: __('jnThesisPh', 'Investment thesis, target price, risks, strategy...')
                    }),
                    React.createElement('div', { className: 'ui-actions' },
                      React.createElement(UIC.Button, { variant: 'primary', size: 'sm', onClick: save }, __('save', 'Save')),
                      React.createElement(UIC.Button, { size: 'sm', onClick: () => { setActive(null); setDraft(''); } }, __('cancel', 'Cancel'))))
                : React.createElement('div', Object.assign({
                    'aria-label': note?.text ? __('jnEditNote', 'Edit note') : __('jnAddNote', 'Add note'),
                    className: ['ui-jn-note', note?.text ? '' : 'is-empty'].join(' ').trim()
                  }, window.MaerminUtils.clickable(() => { setActive(p.key); setDraft(note?.text || ''); })), note?.text || __('jnAddNotePh', '+ Add note...'))
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
  // R3.5: a holding's name for its symbol (shown next to it in the upcoming list)
  const nameOf = (sym) => {
    const up = String(sym || '').toUpperCase();
    const p = ((portfolio && portfolio.stocks) || []).find((x) => String(x.symbol || '').toUpperCase() === up);
    return p && p.symbolName && p.symbolName.toUpperCase() !== up ? p.symbolName : '';
  };
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

  // R4.6: Card with month IconButtons and the add Button, shared inputs, the grid on tokens, upcoming on shared rows
  const UIC = window.MaerminComponents;
  const h = React.createElement;
  const inp = (field, label, type = 'text', opts) =>
    h(UIC.Input, { key: field, type, label, value: form[field], ...opts, onChange: e => setForm(p => ({ ...p, [field]: e.target.value })) });
  const shiftMonth = (n) => setViewMonth(p => { const d = new Date(p.year, p.month + n); return { year: d.getFullYear(), month: d.getMonth() }; });
  const evKind = (e) => e.past ? 'past' : (e.derived ? 'derived' : 'manual');
  const upcoming = events.filter(e => new Date(e.date) >= today).sort((a, b) => new Date(a.date) - new Date(b.date));

  return h('div', { className: 'ui-dc' },
    h(UIC.Card, { className: 'ui-dc-card', headingLevel: 'h3', title: (t.dividendCalendar || 'Dividend Calendar'),
      subtitle: `${monthNames[month]} ${year}: ${amt(window.MaerminI18n.money(totalThisMonth, 'EUR'))} · ${__('dcYear', 'Year {y}', { y: year })}: ${amt(window.MaerminI18n.money(totalYear, 'EUR'))}`,
      action: h('div', { className: 'ui-dc-nav' },
        h(UIC.IconButton, { size: 'sm', label: __('dcPrevMonth', 'Previous month'), onClick: () => shiftMonth(-1), icon: h('span', { 'aria-hidden': 'true' }, '←') }),
        h('span', { className: 'ui-dc-nav__month', 'aria-live': 'polite' }, `${monthNames[month]} ${year}`),
        h(UIC.IconButton, { size: 'sm', label: __('dcNextMonth', 'Next month'), onClick: () => shiftMonth(1), icon: h('span', { 'aria-hidden': 'true' }, '→') }),
        h(UIC.Button, { size: 'sm', variant: 'primary', 'aria-expanded': showAdd, onClick: () => setShowAdd(p => !p) }, __('dcAddBtn', '+ Dividend'))) },

      // Add form
      showAdd && h('div', { className: ['ui-form-grid', 'ui-dc-form'].join(' ') },
        inp('symbol', __('dcSymbolPh', 'Symbol (e.g. AAPL)')),
        inp('date', __('date', 'Date'), 'date'),
        inp('amount', __('amount', 'Amount'), 'number', { step: '0.01' }),
        inp('withholding', __('dcWhtPh', 'Withholding tax (opt.)'), 'text', { inputMode: 'decimal' }),
        h(UIC.Select, { label: __('currency', 'Currency'), value: form.currency, onChange: e => setForm(p => ({ ...p, currency: e.target.value })),
          options: [{ value: 'EUR', label: '€' }, { value: 'USD', label: '$' }] }),
        inp('notes', __('dcNotePh', 'Note (opt.)')),
        h('div', { className: 'ui-form-grid__action' }, h(UIC.Button, { variant: 'primary', onClick: addEvent }, __('add', 'Add')))),

      // Calendar grid
      h('div', { className: 'ui-dcal' },
        h('div', { className: 'ui-dcal__head', 'aria-hidden': 'true' },
          window.MaerminI18n.weekdayNames('short').map(d => h('div', { key: d }, d))),
        h('div', { className: 'ui-dcal__grid' },
          days.map((d, i) => {
            const evs = d ? dayEvents(d) : [];
            const isToday = d && today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;
            return h('div', { key: i, className: ['ui-dcal__day', d ? '' : 'is-blank', isToday ? 'is-today' : ''].join(' ').trim() },
              d && h('div', { className: 'ui-dcal__num' }, d),
              evs.map(e =>
                h('div', Object.assign({
                  key: e.id, className: 'ui-dcal__ev', 'data-kind': evKind(e),
                  title: `${e.symbol}: ${window.MaerminI18n.money(e.amount, e.currency || 'EUR')}${e.notes ? ' · ' + e.notes : ''}${e.derived ? ' · ' + __('dcProjected', 'projected') : ''}`,
                  'aria-label': e.derived ? __('dcProjectedAria', 'Projected dividend {sym} {amount}', { sym: e.symbol, amount: window.MaerminI18n.money(e.amount, e.currency || 'EUR') }) : __('dcDeleteAria', 'Delete dividend {sym} {amount}', { sym: e.symbol, amount: window.MaerminI18n.money(e.amount, e.currency || 'EUR') })
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
      h('ul', { className: 'ui-dcal__legend' },
        h('li', null, h('span', { className: 'ui-dcal__key', 'data-kind': 'derived', 'aria-hidden': 'true' }), __('dcProjected', 'projected')),
        h('li', null, h('span', { className: 'ui-dcal__key', 'data-kind': 'manual', 'aria-hidden': 'true' }), __('dcManual', 'entered by you (select to delete)')),
        h('li', null, h('span', { className: 'ui-dcal__key', 'data-kind': 'past', 'aria-hidden': 'true' }), __('dcReceived', 'received')))
    ),

    // Upcoming list
    upcoming.length > 0 && h(UIC.Card, { className: 'ui-dc-up', headingLevel: 'h3', title: __('dcUpcoming', 'Upcoming dividends') },
      h('ul', { className: 'ui-rows' },
        upcoming.slice(0, 60).map(e =>
          h('li', { key: e.id, className: 'ui-rows__row' },
            // R3.5: the holding's name next to its symbol
            h('div', { className: 'ui-rows__main' },
              h('b', null, e.symbol),
              nameOf(e.symbol) ? h('span', null, nameOf(e.symbol)) : null),
            h('div', { className: 'ui-rows__side' },
              h('b', { className: ['num', 'tone-income'].join(' ') }, amt('+' + window.MaerminI18n.money(e.amount, e.currency || 'EUR'))),
              h('span', { className: 'num' }, window.MaerminI18n.date(e.date) + (e.derived ? ' · ' + __('dcProjected', 'projected') : ''))))
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
        'aria-current': active ? 'true' : undefined, // cleanup V-7: the area holds the page; the view chip is the "page"
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
    GrossNetSwitch,
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
