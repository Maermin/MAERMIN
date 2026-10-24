// ============================================================================
// MAERMIN v12.2 — Advanced Portfolio Features
// 1. Position Detail Modal    — click any position for full breakdown
// 2. CAGR per Position        — annualized return column in positions table
// 3. CS2 Skin Picker / Symbol Picker
// ============================================================================
(function () {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

const { useState, useEffect, useMemo, useRef } = React;

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

// ─────────────────────────────────────────────────────────────────────────────
// 3. POSITION DETAIL MODAL
// Click any position → full breakdown: all transactions, avg cost, CAGR, fees
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// CORPORATE ACTIONS PANEL — per-symbol stock-split manager (folds into the
// position detail modal + the Settings list). List / add / scan / remove the
// splits recorded for one holding. The engine (window.MaerminCorporateActions)
// keeps the math; this is just the surface. Reuses theme tokens + the clickable
// helper, never adds a new tab.
// ─────────────────────────────────────────────────────────────────────────────
function CorporateActionsPanel({ category, symbol, theme, t = {}, workerUrl, sinceDate }) {
  const CA = window.MaerminCorporateActions;
  const [rev, setRev] = useState(0);            // bump to re-read the store
  const [form, setForm] = useState({ date: '', num: '', den: '1', note: '' });
  const [scan, setScan] = useState({ busy: false, msg: '', preview: null });

  const cat = category || 'stocks';
  const actions = useMemo(() => (CA && symbol) ? CA.listFor(cat, symbol) : [], [cat, symbol, rev]);
  if (!CA || !symbol) return null;

  // Resolve the worker base: the passed prop, else the saved API key.
  const workerBase = (function () {
    if (workerUrl) return String(workerUrl).trim().replace(/\/+$/, '');
    try { return String((JSON.parse(localStorage.getItem('apiKeys') || '{}').cs2Worker) || '').trim().replace(/\/+$/, ''); }
    catch (e) { return ''; }
  })();

  // R4.6: a dialog section on the shared inputs, buttons and rows
  const UIC = window.MaerminComponents;
  const h = React.createElement;
  const INPUT = ['ui-input', 'ui-input--sm'].join(' ');

  const ratioText = (a) => `${a.num}:${a.den}` + (a.num >= a.den ? '' : ` (${t.caReverse || 'reverse'})`);

  const addManual = () => {
    const num = parseInt(form.num, 10);
    const den = parseInt(form.den, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { setScan({ busy: false, msg: t.caBadDate || 'Enter a valid date (YYYY-MM-DD).', preview: null }); return; }
    if (!(num > 0) || !(den > 0)) { setScan({ busy: false, msg: t.caBadRatio || 'Ratio must be two positive whole numbers.', preview: null }); return; }
    CA.record({ category: cat, symbol, date: form.date, num, den, source: 'manual', note: form.note });
    setForm({ date: '', num: '', den: '1', note: '' });
    setScan({ busy: false, msg: '', preview: null });
    setRev((n) => n + 1);
  };

  const removeAction = (a) => {
    // In-app confirmation (the native dialog only if MaerminUI is missing).
    const ask = (window.MaerminUI && window.MaerminUI.confirm)
      ? window.MaerminUI.confirm({ title: t.caRemoveConfirm || 'Remove this split?', message: __('caRemoveMsg', '{sym} {ratio} on {date}. It can be re-added or re-scanned.', { sym: a.symbol, ratio: a.num + ':' + a.den, date: window.MaerminI18n.date(a.date) }), confirmLabel: t.caRemove || 'Remove', danger: true })
      : Promise.resolve(typeof window.confirm !== 'function' || window.confirm(t.caRemoveConfirm || 'Remove this split? It can be re-added or re-scanned.'));
    ask.then((yes) => {
      if (!yes) return;
      CA.remove(a.id);
      setRev((n) => n + 1);
    });
  };

  const runScan = () => {
    if (!workerBase) { setScan({ busy: false, msg: t.caNoWorker || 'Add a Worker URL in API Settings to scan, or enter splits manually.', preview: null }); return; }
    setScan({ busy: true, msg: '', preview: null });
    // UX-028: only splits on or after the first purchase are offered
    CA.detectForSymbol(symbol, cat, sinceDate || null, (u) => fetch(u).then((r) => r.json()), { workerBase })
      .then((found) => {
        const existing = {};
        actions.forEach((a) => { existing[a.date] = true; });
        const fresh = (found || []).filter((f) => !existing[f.date]);
        if (!fresh.length) { setScan({ busy: false, msg: t.caNoneFound || 'No new splits found (or the Worker has no split data).', preview: null }); return; }
        setScan({ busy: false, msg: '', preview: fresh.map((f) => ({ ...f, skip: false })) });
      })
      .catch(() => setScan({ busy: false, msg: t.caScanFail || 'Scan failed — enter splits manually.', preview: null }));
  };

  const confirmPreview = () => {
    (scan.preview || []).forEach((p) => {
      if (p.skip) return;
      const num = parseInt(p.num, 10), den = parseInt(p.den, 10);
      if (num > 0 && den > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
        CA.record({ category: cat, symbol, date: p.date, num, den, source: 'auto', note: p.note || '' });
      }
    });
    setScan({ busy: false, msg: '', preview: null });
    setRev((n) => n + 1);
  };
  const patchPreview = (i, patch) => setScan((s) => ({ ...s, preview: s.preview.map((p, j) => j === i ? { ...p, ...patch } : p) }));

  return h('section', { className: 'ui-dlg-sec', 'data-testid': 'ca-panel' },
    h('div', { className: 'ui-dlg-sec__head' },
      h('h3', { className: 'ui-dlg-sec__title' }, t.caTitle || 'Corporate actions (splits)'),
      h(UIC.Button, { size: 'sm', variant: 'quiet', onClick: runScan, loading: scan.busy },
        scan.busy ? (t.caScanning || 'Scanning…') : (t.caScan || 'Scan for splits'))),

    // Existing actions
    actions.length === 0
      ? h('p', { className: 'ui-muted' }, t.caNone || 'No splits recorded for this holding.')
      : h('ul', { className: 'ui-rows' },
          actions.map((a) => h('li', { key: a.id, className: 'ui-rows__row' },
            h('div', { className: 'ui-rows__main' },
              h('b', { className: 'num' }, ratioText(a)),
              h('span', null, window.MaerminI18n.date(a.date) + (a.source === 'auto' ? ' · ' + (t.caAuto || 'auto') : ''))),
            h(UIC.Button, { size: 'sm', variant: 'quiet', onClick: () => removeAction(a), 'aria-label': (t.caRemove || 'Remove') + ' ' + a.date }, t.caRemove || 'Remove')))),

    // Scan preview (editable, write only on confirm)
    scan.preview && h('div', { className: 'ui-callout' },
      h('strong', null, t.caPreview || 'Detected splits — review, edit or skip, then confirm:'),
      scan.preview.map((p, i) => h('div', { key: i, className: ['ui-ca-preview', p.skip ? 'is-skipped' : ''].join(' ') },
        h('input', { type: 'date', 'aria-label': t.caDate || 'Date', value: p.date, onChange: (e) => patchPreview(i, { date: e.target.value }), className: INPUT }),
        h('input', { type: 'number', min: '1', value: p.num, onChange: (e) => patchPreview(i, { num: e.target.value }), className: INPUT, 'aria-label': t.caNum || 'New' }),
        h('input', { type: 'number', min: '1', value: p.den, onChange: (e) => patchPreview(i, { den: e.target.value }), className: INPUT, 'aria-label': t.caDen || 'Old' }),
        h(UIC.Button, { size: 'sm', variant: 'quiet', 'aria-pressed': !!p.skip, onClick: () => patchPreview(i, { skip: !p.skip }) }, p.skip ? (t.caKeep || 'Keep') : (t.caSkip || 'Skip')))),
      h('div', { className: 'ui-actions' },
        h(UIC.Button, { size: 'sm', variant: 'primary', onClick: confirmPreview }, t.caConfirm || 'Add selected'),
        h(UIC.Button, { size: 'sm', onClick: () => setScan({ busy: false, msg: '', preview: null }) }, t.caCancel || 'Cancel'))),

    // Manual add
    h('div', { className: ['ui-form-grid', 'ui-ca-grid'].join(' ') },
      h(UIC.Input, { type: 'date', label: t.caDate || 'Date', value: form.date, onChange: (e) => setForm({ ...form, date: e.target.value }) }),
      h(UIC.Input, { type: 'number', label: t.caNum || 'New', min: '1', placeholder: '10', value: form.num, onChange: (e) => setForm({ ...form, num: e.target.value }) }),
      h(UIC.Input, { type: 'number', label: t.caDen || 'Old', min: '1', placeholder: '1', value: form.den, onChange: (e) => setForm({ ...form, den: e.target.value }) })),
    h('div', { className: 'ui-ca-add' },
      h('input', { 'aria-label': t.caNotePh || 'Note (optional)', placeholder: t.caNotePh || 'Note (optional)', value: form.note, onChange: (e) => setForm({ ...form, note: e.target.value }), className: 'ui-input' }),
      h(UIC.Button, { variant: 'primary', onClick: addManual }, t.caAdd || 'Add split')),
    scan.msg && h('p', { className: ['ui-muted', 'is-error'].join(' '), role: 'status' }, scan.msg),
    h('p', { className: 'ui-note' }, t.caHint || 'Ratio New:Old — e.g. 10:1 forward, 1:10 reverse. Splits apply to lots before the date.')
  );
}

function PositionDetailModal({ position, transactions, prices, theme, formatPrice, getCurrencySymbol, onClose, t = {}, workerUrl, closeSeries, buildPath, onResearch, onCharts }) {
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
      } else if (tx.type === 'sell') {
        // Only sells reduce the position; dividend/interest bookings for the
        // same symbol are income, not disposals.
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

  // P5-2.4: this holding's own daily value path → its monthly returns heatmap
  const posPath = useMemo(() => {
    if (!buildPath || !closeSeries || !posTxs.length) return null;
    const p = buildPath(posTxs);
    return p && p.points && p.points.length > 1 ? p : null;
  }, [posTxs, closeSeries]);

  // V7 investment journal — structured per-position notes (thesis, target,
  // notes, reviews) in maermin_journal. Integrated here instead of a separate
  // module; the standalone notes view will fold into this.
  const jKey = `${position.cat}-${(position.sym || '').toLowerCase()}`;
  const [journalAll, setJournalAll] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_journal') || '{}'); } catch (e) { return {}; }
  });
  const j = journalAll[jKey] || { thesis: '', target: '', notes: '', reviews: [] };
  const saveJournal = (patch) => {
    const next = { ...journalAll, [jKey]: { thesis: j.thesis, target: j.target, notes: j.notes, reviews: j.reviews || [], ...patch, updatedAt: new Date().toISOString() } };
    setJournalAll(next);
    try { localStorage.setItem('maermin_journal', JSON.stringify(next)); } catch (e) {}
  };
  const [reviewDraft, setReviewDraft] = useState('');
  const addReview = () => {
    if (!reviewDraft.trim()) return;
    saveJournal({ reviews: [{ date: new Date().toISOString().slice(0, 10), text: reviewDraft.trim() }, ...(j.reviews || [])] });
    setReviewDraft('');
  };
  // R4.6: figures on Stat tiles, the history on the shared Table, the journal on the shared fields
  const h = React.createElement;
  const sym = getCurrencySymbol();
  const money = (v) => `${formatPrice(v)} ${sym}`;
  const signed = (v) => `${v >= 0 ? '+' : ''}${formatPrice(v)} ${sym}`;
  const TONE = window.MaerminComponents.toneOf;
  const figures = position.closedRow ? [
    // P4-2: a fully sold position - realised figures from the FIFO ledger
    { label: __('colRealizedPnl', 'Realised P&L'), value: signed(position.closedRow.gain), tone: TONE(position.closedRow.gain) },
    { label: __('pdRealizedReturn', 'Realised return'), value: position.closedRow.ret === null ? '—' : window.MaerminI18n.pct(position.closedRow.ret * 100, 2, true),
      tone: position.closedRow.ret === null ? null : TONE(position.closedRow.ret) },
    { label: __('colDisposedCost', 'Cost basis sold'), value: money(position.closedRow.cost) },
    { label: __('colProceeds', 'Proceeds'), value: money(position.closedRow.proceeds) },
    { label: __('pdHeld', 'Held'), value: window.MaerminI18n.date(position.closedRow.opened) + ' – ' + window.MaerminI18n.date(position.closedRow.closed) },
    { label: __('feeTotalPaid', 'Total Fees Paid'), value: money(metrics.totalFees) }
  ] : [
    { label: __('retCurrentValue', 'Current Value'), value: money(metrics.currentValue) },
    { label: __('pdUnrealized', 'Unrealised P&L'), value: signed(metrics.unrealizedPL), tone: TONE(metrics.unrealizedPL) },
    { label: __('pdAvgCost', 'Avg Cost'), value: money(metrics.avgCost) },
    { label: __('pdCurrentPrice', 'Current Price'), value: money(metrics.currentPrice) },
    { label: __('pdUnrealisedPct', 'Unrealised return'), value: window.MaerminI18n.pct(metrics.unrealizedPct, 2, true), tone: TONE(metrics.unrealizedPct) },
    { label: __('pdCagr', 'CAGR (annualized)'), value: metrics.cagr !== null ? window.MaerminI18n.pct(metrics.cagr, 2, true) : '—', tone: metrics.cagr !== null ? TONE(metrics.cagr) : null },
    { label: __('totalInvested', 'Total Invested'), value: money(metrics.totalInvested) },
    { label: __('feeTotalPaid', 'Total Fees Paid'), value: money(metrics.totalFees) }
  ];
  const txAmount = (tx) => {
    const qty = parseFloat(tx.quantity) || 0, price = parseFloat(tx.price) || 0, fees = parseFloat(tx.fees) || 0;
    return qty * price + (tx.type === 'buy' ? fees : -fees);
  };
  const txColumns = [
    { key: 'type', label: __('type', 'Type'), phone: 'title', render: (tx) => {
      const info = window.MaerminUtils.txTypeInfo(tx.type, t);
      return h('span', { className: 'ui-txtype', 'data-tone': info.tone }, info.label);
    } },
    { key: 'date', label: __('date', 'Date'), phone: 'meta', render: (tx) => window.MaerminI18n.date(tx.date) },
    { key: 'qty', label: __('quantity', 'Quantity'), align: 'right', phone: 'meta', render: (tx) => `${window.MaerminI18n.num(parseFloat(tx.quantity) || 0, 4)} @ ${formatPrice(parseFloat(tx.price) || 0)}` },
    { key: 'amount', label: __('amount', 'Amount'), align: 'right', phone: 'value', render: (tx) => h('b', null, money(txAmount(tx))) }
  ];
  const jField = (key, label, ph, rows) => h('div', { className: 'ui-field' },
    h('label', { className: 'ui-field__label', htmlFor: 'pd-j-' + key }, label),
    h('textarea', { id: 'pd-j-' + key, value: j[key], rows: rows || 2, onChange: e => saveJournal({ [key]: e.target.value }), placeholder: ph, className: ['ui-input', 'ui-pd-text'].join(' ') }));

  // R3.1: on the shared Modal (a bottom sheet on phones); the title keeps its
  // id and test hook, Research moves to the footer.
  const UIC = window.MaerminComponents;
  return React.createElement(UIC.Modal, {
    open: true, onClose, titleId: 'dlg-position', className: 'ui-pos-dialog',
    focusField: false, // a detail view: its only field is the note further down
    title: React.createElement('span', { 'data-testid': 'pos-title' },
      // cleanup V-5: the name first ("Bitcoin"), the symbol after it, as in the positions table
      position.name && position.name !== position.sym ? position.name : position.sym,
      position.name && position.name !== position.sym && React.createElement('span', { className: 'ui-pos-dialog__sym' }, position.sym)),
    // P5-5.4: the Research page for this symbol; CH-3a: the Charts view
    footer: onResearch || onCharts ? React.createElement(React.Fragment, null,
      onCharts ? React.createElement(UIC.Button, { onClick: onCharts, 'data-testid': 'pd-charts' }, __('pdCharts', 'Open in Charts')) : null,
      onResearch ? React.createElement(UIC.Button, { onClick: onResearch, 'data-testid': 'pd-research' }, __('pdResearch', 'Research')) : null) : null
  },
      React.createElement('div', { className: 'ui-pos-dialog__meta' },
        React.createElement(UIC.Badge, null, window.MaerminI18n.category(position.cat)),
        metrics.firstBuyDate ? React.createElement('span', null, __('pdSince', 'Since {date}', { date: window.MaerminI18n.date(metrics.firstBuyDate) })) : null),

      // P4-2: daily price since the first buy, with the average cost for an open position
      window.MaerminPositionChart && React.createElement(window.MaerminPositionChart.View, {
        series: closeSeries, avgCost: position.avgPrice, closed: !!position.closed || !(position.amount > 0), firstDate: metrics.firstBuyDate,
        theme, formatPrice, getCurrencySymbol }),

      // P5-2.4: monthly returns of this holding, with the same drill-down
      posPath && window.MaerminFeatures2 && window.MaerminFeatures2.ReturnsHeatmap && h('div', { className: 'ui-dlg-sec' },
        React.createElement(window.MaerminFeatures2.ReturnsHeatmap, {
          steps: posPath.points.map(p => ({ d: p.d, r: p.r })), points: posPath.points, transactions: posTxs, source: 'daily',
          theme, formatPrice, getCurrencySymbol, testid: 'pos-heatmap', flat: true,
          title: __('rhdHoldingTitle', 'Monthly returns of this holding'),
          note: __('rhdHoldingNote', 'Time-weighted, from the daily closing prices: buys and sales do not count as gains, fees and payouts do.') })),

      // Key figures
      h('section', { className: 'ui-dlg-sec' },
        h('div', { className: 'ui-tiles' }, figures.map((m) => h(window.MaerminComponents.Stat, { key: m.label, className: 'ui-tile', label: m.label, value: m.value, tone: m.tone || null })))),

      // Transaction history
      h('section', { className: 'ui-dlg-sec' },
        h('h3', { className: 'ui-dlg-sec__title' }, __('pdTxHistory', 'Transaction History ({n})', { n: posTxs.length })),
        posTxs.length === 0
          ? h('p', { className: 'ui-muted' }, __('noTransactionsFound', 'No transactions found'))
          : h(window.MaerminComponents.Table, { columns: txColumns, rows: posTxs, rowKey: (tx, i) => tx.id || i, caption: __('pdTxHistory', 'Transaction History ({n})', { n: posTxs.length }) })),

      // Investment journal (V7): thesis, target, notes, dated reviews
      h('section', { className: 'ui-dlg-sec' },
        h('h3', { className: 'ui-dlg-sec__title' }, t.journalTitle || 'Investment journal'),
        h('div', { className: 'ui-grid-2' },
          jField('thesis', t.journalThesis || 'Investment thesis', t.journalThesisPh || 'Why do you hold this?'),
          jField('target', t.journalTarget || 'Target / exit', t.journalTargetPh || 'Price target, exit plan...')),
        jField('notes', t.journalNotes || 'Notes', t.journalNotesPh || 'Free notes...', 3),
        h('div', { className: 'ui-field' },
          h('label', { className: 'ui-field__label', htmlFor: 'pd-j-review' }, t.journalReviews || 'Reviews'),
          h('div', { className: 'ui-ca-add' },
            h('input', { id: 'pd-j-review', value: reviewDraft, onChange: e => setReviewDraft(e.target.value), onKeyDown: e => { if (e.key === 'Enter') addReview(); }, placeholder: t.journalAddReview || 'Add a dated review...', className: 'ui-input' }),
            h(window.MaerminComponents.Button, { onClick: addReview, 'aria-label': t.journalAddReview || 'Add a dated review...' }, '+'))),
        (j.reviews || []).length > 0 && h('ul', { className: 'ui-pd-reviews' },
          j.reviews.map((rv, i) => h('li', { key: i },
            h('span', { className: 'num' }, window.MaerminI18n.date(rv.date)),
            h('span', null, rv.text))))
      ),

      // Corporate actions (stock splits) for this holding
      React.createElement(CorporateActionsPanel, { category: position.cat, symbol: position.sym, theme, t, workerUrl,
        sinceDate: posTxs.filter(tx => tx.type === 'buy' && tx.date).map(tx => String(tx.date).slice(0, 10)).sort()[0] || null }),
      // P5-3.10: symbol / ISIN change, merger, spin-off
      window.MaerminCorporateActions && window.MaerminCorporateActions.EventsPanel &&
        React.createElement(window.MaerminCorporateActions.EventsPanel, { category: position.cat, symbol: position.sym, theme })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. CS2 SKIN PICKER
// Ersetzt das Symbol-Textfeld wenn Kategorie = skins
// Sucht in der täglichen Steam-Market-Preisliste (über den Worker)
// Zeigt Skin-Bilder (gebündelte Bildtabelle) und Preise
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
      if (!workerUrl) { setError(__('ssNoWorker', 'No Worker URL set — add it in API Settings')); return; }
      setLoading(true); setError(null);
      // Names and prices from the daily Steam Market price list (the source the
      // portfolio is priced with), pictures from the bundled image table.
      const SKP = window.MaerminSkinPrices;
      try {
        if (!SKP) throw new Error(__('ssModuleMissing', 'Skin price module not loaded'));
        const [index, images] = await Promise.all([SKP.load(workerUrl), SKP.loadImages()]);
        if (!index) throw new Error(__('ssListFailed', 'The skin price list could not be loaded - check the Worker URL'));
        const found = SKP.search(index, query.trim(), 24).map(it => {
          const wear = (it.name.match(/\(([^)]+)\)\s*$/) || [])[1] || null;
          return { ...it, image: SKP.imageFor(images, it.name), wear };
        });
        setResults(found);
        setOpen(true);
        if (!found.length) setError(__('ssNoMatch', 'No CS2 item matches "{q}"', { q: query.trim() }));
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

  // R5.1: the shared field, a popover list on tokens; prices with their currency
  return React.createElement('div', { className: 'ui-picker' },
    // Search input
    React.createElement('div', { className: 'ui-picker__field' },
      React.createElement('input', {
        type: 'text',
        value: query,
        onChange: e => { setQuery(e.target.value); if (!e.target.value) { setResults([]); setOpen(false); } },
        onFocus: () => results.length > 0 && setOpen(true),
        placeholder: __('ssSearchPh', 'Search CS2 skins — e.g. AK-47 Redline...'), 'aria-label': __('ssSkin', 'Skin'),
        className: 'ui-input'
      }),
      loading && React.createElement('span', { className: 'ui-picker__busy', role: 'status', 'aria-label': __('loading', 'Loading...') }, '…')
    ),

    // Error
    error && React.createElement('p', { className: ['ui-note', 'tone-loss'].join(' ') }, '! ' + error),

    // Results dropdown
    open && results.length > 0 && React.createElement('div', { className: ['ui-picker__pop', 'is-wide'].join(' ') },
      // Header
      React.createElement('div', { className: 'ui-picker__head' },
        React.createElement('span', null, __('ssResults', '{n} {n:result|results} — click to select', { n: results.length })),
        React.createElement('button', { type: 'button', onClick: () => setOpen(false), 'aria-label': __('close', 'Close'), className: ['ui-icon-btn', 'ui-icon-btn--sm'].join(' ') },
          React.createElement('span', { 'aria-hidden': 'true' }, '×'))
      ),

      // Grid of skins
      React.createElement('div', { className: 'ui-picker__grid' },
        results.map((item, i) =>
          React.createElement('div', {
            key: i,
            ...window.MaerminUtils.clickable(() => select(item)),
            className: 'ui-picker__skin'
          },
            // Skin image
            item.image
              ? React.createElement('img', {
                  src: item.image, alt: item.name, className: 'ui-picker__img',
                  onError: e => { e.target.hidden = true; }
                })
              : React.createElement('div', { className: ['ui-picker__img', 'is-empty'].join(' ') }, __('ssNoImage', 'No image')),

            // Name
            React.createElement('b', null, item.name),

            // Wear + Price row
            React.createElement('div', { className: 'ui-picker__meta' },
              item.wear && React.createElement('span', { className: 'ui-badge' }, item.wear),
              item.price && React.createElement('span', { className: 'num' }, window.MaerminI18n.money(item.price, 'USD')) // skin prices are USD (Steam Market price list)
            )
          )
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SYMBOL PICKER — Stocks & Crypto
// Searches Yahoo Finance (stocks/ETFs) and CoinGecko (crypto) with logos
// Stores the exact YF symbol or CoinGecko ID on the transaction
// ─────────────────────────────────────────────────────────────────────────────

const EXCHANGE_SHORT = {
  'NMS': 'NASDAQ', 'NYQ': 'NYSE', 'PCX': 'NYSE ARCA',
  'GER': 'XETRA', 'FRA': 'Frankfurt', 'LSE': 'London',
  'PAR': 'Paris', 'AMS': 'Amsterdam', 'STO': 'Stockholm',
  'CPH': 'Copenhagen', 'MIL': 'Milan', 'MCE': 'Madrid',
  'TOR': 'Toronto', 'ASX': 'ASX', 'HKG': 'Hong Kong',
  'TYO': 'Tokyo',
};

const typeLabel = (type) => ({
  EQUITY: __('spkStock', 'Stock'), ETF: 'ETF', MUTUALFUND: __('spkFund', 'Fund'),
  CRYPTOCURRENCY: __('crypto', 'Crypto'), COMMODITY: __('spkCommodity', 'Commodity'),
})[type] || __('spkStock', 'Stock');

function SymbolPicker({ category, workerUrl, theme, onSelect, selectedSymbol, selectedName }) {
  const [query, setQuery]     = useState(selectedName || selectedSymbol || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);
  const [error, setError]     = useState(null);
  const [selected, setSelected] = useState(
    selectedSymbol ? { symbol: selectedSymbol, name: selectedName || selectedSymbol } : null
  );
  const debounceRef = useRef(null);
  const inputRef    = useRef(null);
  const prevCat     = useRef(category);

  const isCrypto = category === 'crypto';
  // A typed crypto symbol: CoinGecko ids are lower case ("quant-network"),
  // tickers upper case ("QNT" - priced through MaerminTickers.coinGeckoId).
  const typedSymbol = (v) => {
    const s = String(v || '').trim();
    if (!isCrypto || !s) return s;
    return /[\s-]/.test(s) ? s.toLowerCase().replace(/\s+/g, '-') : s.toUpperCase();
  };

  // ── Vollständiger Reset wenn Kategorie wechselt ─────────────────────────
  useEffect(() => {
    if (prevCat.current !== category) {
      prevCat.current = category;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setQuery('');
      setResults([]);
      setOpen(false);
      setError(null);
      setSelected(null);
    }
  }, [category]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q || q.length < 2) { setResults([]); setOpen(false); return; }
    if (selected && q === (selected.name || selected.symbol)) return;

    debounceRef.current = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        if (isCrypto) {
          // ── Crypto: CoinGecko only — never shows stocks ──────────────────
          // Through the shared CoinGecko queue (high priority: the user is
          // waiting). A direct call was refused while the price refresh had
          // used up CoinGecko's per-minute limit, and the picker went blank.
          // Through the Worker (?action=cg), via the shared queue (the user is waiting).
          const data = await window.MaerminCoinGecko.get('search', { query: q }, { priority: 'high', skipWhileCooling: true, timeoutMs: 8000 });
          const coins = (data.coins || [])
            .filter(c => {
              // Filter out tokenized stocks (xStock, rStock, Ondo) and stablecoins
              const name = (c.name || '').toLowerCase();
              const sym  = (c.symbol || '').toLowerCase();
              if (name.includes('xstock') || name.includes('rstock') || name.includes('tokenized'))  return false;
              if (name.includes('ondo') && name.includes('stock')) return false;
              if (['usdt','usdc','busd','dai','tusd','usdp','usdd','gusd','frax','lusd'].includes(sym)) return false;
              return true;
            })
            .slice(0, 8).map(c => ({
            symbol:   c.id,                           // CoinGecko ID
            ticker:   c.symbol?.toUpperCase(),
            name:     c.name,
            logoUrl:  c.large || c.thumb,             // direct CoinGecko CDN URL
            type:     'CRYPTOCURRENCY',
            exchange: __('spkRank', 'Rank #{n}', { n: c.market_cap_rank || '—' }),
          }));
          setResults(coins);
          setOpen(coins.length > 0);

        } else {
          // ── Stocks/ETFs: Yahoo Finance via Worker — never shows crypto ────
          if (!workerUrl) { setError(__('spkNeedWorker', 'Add Worker URL in Settings for stock search')); setLoading(false); return; }
          const base = workerUrl.trim().replace(/\/$/, '');
          // Pass type=stock so Worker strictly excludes CRYPTOCURRENCY results
          const res  = await fetch(
            `${base}?action=yfsearch&q=${encodeURIComponent(q)}&type=stock`,
            { signal: AbortSignal.timeout(10000) }
          );
          if (!res.ok) throw new Error(`Search failed: ${res.status}`);
          const data = await res.json();

          const items = (Array.isArray(data) ? data : [])
            // Strict: only stocks/ETFs/funds — explicitly no crypto allowed
            .filter(r => r.type === 'EQUITY' || r.type === 'ETF' || r.type === 'MUTUALFUND')
            .slice(0, 10)
            .map(r => {
              // Logo: Yahoo Finance brand CDN — no external dependency, same source as price data
              const baseSym = r.symbol.split('.')[0].toUpperCase();
              const logoUrl = `https://s.yimg.com/lb/brands/150x150/${baseSym}.png`;
              return {
                symbol:   r.symbol,
                ticker:   r.symbol,
                name:     r.name,
                exchange: EXCHANGE_SHORT[r.exchange] || r.exchange || '',
                type:     r.type || 'EQUITY',
                logoUrl,
                baseSym,
              };
            });

          setResults(items);
          setOpen(items.length > 0);
        }
      } catch(e) {
        setResults([]); setOpen(false);
        setError(isCrypto
          ? __('spkCgBusy', 'CoinGecko search is busy right now. You can still save: type the ticker (e.g. QNT) or the CoinGecko id (e.g. quant-network).')
          : e.message);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, [query, isCrypto, workerUrl]);

  const pick = (item) => {
    setSelected(item);
    setQuery(item.name);
    setResults([]);
    setOpen(false);
    // Pass both the display name and the exact API symbol
    onSelect({
      symbol:  item.symbol,   // CoinGecko ID for crypto, YF symbol for stocks
      ticker:  item.ticker || item.symbol,
      name:    item.name,
      logoUrl: item.logoUrl,
      type:    item.type,
      exchange: item.exchange,
    });
  };

  const clear = () => {
    setSelected(null);
    setQuery('');
    setResults([]);
    setOpen(false);
    onSelect({ symbol: '', name: '', logoUrl: null });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // R5.1: the shared field, a popover list on tokens, the picked listing with ✓ and its exact symbol
  const avatar = (it, cls) => React.createElement('div', { className: ['ui-picker__logo', cls || ''].join(' ').trim(), 'aria-hidden': 'true' },
    // Letter avatar (always there as base layer); the logo on top, hidden on error
    React.createElement('span', null, (it.ticker || it.symbol || '').replace(/\..+$/, '').slice(0, 3)),
    it.logoUrl && React.createElement('img', { src: it.logoUrl, alt: '', onError: e => { if (e.target) e.target.hidden = true; } }));

  return React.createElement('div', { className: 'ui-picker' },

    // ── Search Input ──────────────────────────────────────────────────────
    React.createElement('div', { className: 'ui-picker__row' },
      React.createElement('div', { className: 'ui-picker__field' },
        React.createElement('input', {
          ref: inputRef,
          type: 'text',
          value: query,
          // Typed text counts as the symbol until a suggestion is picked: the
          // form used to see an empty symbol ("Please fill in: Symbol") unless
          // the user clicked a search result, and with the search unavailable
          // nothing could be added at all.
          onChange: e => {
            const v = e.target.value;
            setQuery(v); setSelected(null);
            onSelect({ symbol: typedSymbol(v), name: '', logoUrl: null, manual: true });
          },
          onFocus: () => results.length > 0 && setOpen(true),
          placeholder: isCrypto ? __('spkCryptoPh', 'Search: Bitcoin, Ethereum, Solana...') : __('spkStockPh', 'Search: Apple, ASML, Novo Nordisk...'), 'aria-label': __('symbol', 'Symbol'),
          className: ['ui-input', selected ? 'is-picked' : ''].join(' ').trim()
        }),
        loading && React.createElement('span', { className: 'ui-picker__busy', role: 'status', 'aria-label': __('loading', 'Loading...') }, '…')
      ),
      selected && React.createElement('button', {
        type: 'button', onClick: clear,
        title: __('clearSelection', 'Clear selection'), 'aria-label': __('clearSelection', 'Clear selection'),
        className: ['ui-icon-btn', 'ui-icon-btn--md'].join(' ')
      }, React.createElement('span', { 'aria-hidden': 'true' }, '×'))
    ),

    // ── Typed, not picked: say what will be saved ─────────────────────────
    !selected && query.trim() && React.createElement('p', { className: 'ui-note' },
      isCrypto ? __('spkTypedCoin', 'Saved as typed: {sym} — pick a suggestion for the exact coin.', { sym: typedSymbol(query) }) : __('spkTypedListing', 'Saved as typed: {sym} — pick a suggestion for the exact listing.', { sym: typedSymbol(query) })),

    // ── Selected Preview ──────────────────────────────────────────────────
    selected && React.createElement('div', { className: 'ui-picked' },
      avatar(selected, 'is-lg'),
      React.createElement('div', { className: 'ui-rows__main' },
        // Name + type badge
        React.createElement('div', { className: 'ui-picker__name' },
          React.createElement('b', null, selected.name),
          React.createElement('span', { className: 'ui-badge' }, typeLabel(selected.type)),
          selected.exchange && React.createElement('span', null, selected.exchange)
        ),
        // The exact symbol that will be saved — most important part
        React.createElement('span', { className: ['ui-badge', 'tone-gain', 'ui-picked__sym'].join(' ') },
          '✓ ', React.createElement('code', null, selected.symbol), // exact YF symbol or CoinGecko ID
          ' · ' + (isCrypto ? __('spkCgId', 'CoinGecko ID') : __('spkYfSymbol', 'Yahoo Finance symbol')))
      )
    ),

    // ── Error ─────────────────────────────────────────────────────────────
    error && React.createElement('p', { className: ['ui-note', 'tone-loss'].join(' ') }, '! ' + error),

    // ── Results Dropdown ──────────────────────────────────────────────────
    open && results.length > 0 && React.createElement('div', { className: 'ui-picker__pop' },
      // Header
      React.createElement('div', { className: 'ui-picker__head' },
        React.createElement('span', null, __('spkResults', '{n} {n:result|results} · click to select', { n: results.length })),
        React.createElement('button', { type: 'button', onClick: () => setOpen(false), 'aria-label': __('close', 'Close'), className: ['ui-icon-btn', 'ui-icon-btn--sm'].join(' ') },
          React.createElement('span', { 'aria-hidden': 'true' }, '×'))
      ),

      // Results list
      React.createElement('div', { className: 'ui-picker__list' },
        results.map((item, i) =>
          React.createElement('div', {
            key: i,
            ...window.MaerminUtils.clickable(() => pick(item)),
            className: 'ui-picker__item'
          },
            avatar(item),
            // Info
            React.createElement('div', { className: 'ui-rows__main' },
              React.createElement('div', { className: 'ui-picker__name' },
                React.createElement('b', null, item.ticker || item.symbol),
                React.createElement('span', { className: 'ui-badge' }, typeLabel(item.type)),
                item.exchange && React.createElement('span', null, item.exchange)
              ),
              React.createElement('span', { className: 'ui-picker__sub' }, item.name)
            ),

            // Arrow
            React.createElement('span', { className: 'ui-picker__go', 'aria-hidden': 'true' }, '→')
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
  PositionDetailModal,
  CorporateActionsPanel,
  CS2SkinPicker,
  SymbolPicker,
};


})();
