// ============================================================================
// MAERMIN v10.0 — Advanced Portfolio Features
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
function CorporateActionsPanel({ category, symbol, theme, t = {}, workerUrl }) {
  const CA = window.MaerminCorporateActions;
  const clickable = (window.MaerminUtils && window.MaerminUtils.clickable) || ((h) => ({ onClick: h, role: 'button', tabIndex: 0 }));
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

  const label = { display: 'block', color: theme.textSecondary, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' };
  const input = { width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder || theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.82rem', fontFamily: 'inherit' };
  const btn = (bg, color) => ({ padding: '0.45rem 0.8rem', background: bg, color: color, border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' });

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
    CA.detectForSymbol(symbol, cat, null, (u) => fetch(u).then((r) => r.json()), { workerBase })
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

  return React.createElement('div', { style: { padding: '1.25rem 1.5rem', borderTop: `1px solid ${theme.modalBorder}` } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem' } }, t.caTitle || 'Corporate actions (splits)'),
      React.createElement('button', { onClick: runScan, disabled: scan.busy, style: { ...btn(theme.inputBg, theme.text), opacity: scan.busy ? 0.6 : 1 } },
        scan.busy ? (t.caScanning || 'Scanning…') : (t.caScan || 'Scan for splits'))
    ),

    // Existing actions
    actions.length === 0
      ? React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginBottom: '0.75rem' } }, t.caNone || 'No splits recorded for this holding.')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', marginBottom: '0.75rem' } },
          actions.map((a) => React.createElement('div', {
            key: a.id,
            style: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', alignItems: 'center', padding: '0.5rem 0', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.82rem' }
          },
            React.createElement('span', { style: { color: theme.textSecondary } }, a.date),
            React.createElement('span', { style: { color: theme.text, fontWeight: 600 } }, ratioText(a) + (a.source === 'auto' ? ' · ' + (t.caAuto || 'auto') : '')),
            React.createElement('span', Object.assign({}, clickable(() => removeAction(a)), {
              style: { color: theme.danger || '#ef4444', cursor: 'pointer', fontSize: '0.78rem', justifySelf: 'end' },
              'aria-label': (t.caRemove || 'Remove') + ' ' + a.date
            }), t.caRemove || 'Remove')
          ))
        ),

    // Scan preview (editable, write only on confirm)
    scan.preview && React.createElement('div', { style: { background: theme.inputBg, borderRadius: '10px', padding: '0.75rem', marginBottom: '0.75rem' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: 600, fontSize: '0.8rem', marginBottom: '0.5rem' } }, t.caPreview || 'Detected splits — review, edit or skip, then confirm:'),
      scan.preview.map((p, i) => React.createElement('div', { key: i, style: { display: 'grid', gridTemplateColumns: '1.3fr 0.6fr 0.6fr auto', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem', opacity: p.skip ? 0.45 : 1 } },
        React.createElement('input', { type: 'date', value: p.date, onChange: (e) => patchPreview(i, { date: e.target.value }), style: input }),
        React.createElement('input', { type: 'number', min: '1', value: p.num, onChange: (e) => patchPreview(i, { num: e.target.value }), style: input, 'aria-label': 'numerator' }),
        React.createElement('input', { type: 'number', min: '1', value: p.den, onChange: (e) => patchPreview(i, { den: e.target.value }), style: input, 'aria-label': 'denominator' }),
        React.createElement('span', Object.assign({}, clickable(() => patchPreview(i, { skip: !p.skip })), { style: { color: theme.textSecondary, cursor: 'pointer', fontSize: '0.76rem' } }), p.skip ? (t.caKeep || 'Keep') : (t.caSkip || 'Skip'))
      )),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
        React.createElement('button', { onClick: confirmPreview, style: btn(theme.success || '#22c55e', '#08130b') }, t.caConfirm || 'Add selected'),
        React.createElement('button', { onClick: () => setScan({ busy: false, msg: '', preview: null }), style: btn(theme.inputBg, theme.text) }, t.caCancel || 'Cancel')
      )
    ),

    // Manual add
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1.3fr 0.6fr 0.6fr', gap: '0.5rem', alignItems: 'end' } },
      React.createElement('div', null, React.createElement('label', { style: label }, t.caDate || 'Date'),
        React.createElement('input', { type: 'date', value: form.date, onChange: (e) => setForm({ ...form, date: e.target.value }), style: input })),
      React.createElement('div', null, React.createElement('label', { style: label }, t.caNum || 'New'),
        React.createElement('input', { type: 'number', min: '1', placeholder: '10', value: form.num, onChange: (e) => setForm({ ...form, num: e.target.value }), style: input })),
      React.createElement('div', null, React.createElement('label', { style: label }, t.caDen || 'Old'),
        React.createElement('input', { type: 'number', min: '1', placeholder: '1', value: form.den, onChange: (e) => setForm({ ...form, den: e.target.value }), style: input }))
    ),
    React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' } },
      React.createElement('input', { placeholder: t.caNotePh || 'Note (optional)', value: form.note, onChange: (e) => setForm({ ...form, note: e.target.value }), style: { ...input, flex: 1 } }),
      React.createElement('button', { onClick: addManual, style: btn(theme.accent, '#ffffff') }, t.caAdd || 'Add split')
    ),
    scan.msg && React.createElement('div', { style: { color: theme.warning || '#f59e0b', fontSize: '0.76rem', marginTop: '0.5rem' } }, scan.msg),
    React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.72rem', marginTop: '0.5rem' } },
      t.caHint || 'Ratio New:Old — e.g. 10:1 forward, 1:10 reverse. Splits apply to lots before the date.')
  );
}

function PositionDetailModal({ position, transactions, prices, theme, formatPrice, getCurrencySymbol, onClose, t = {}, workerUrl }) {
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
  const jLabel = { display: 'block', color: theme.textSecondary, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' };
  const jInput = { width: '100%', boxSizing: 'border-box', padding: '0.5rem 0.7rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder || theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.82rem', fontFamily: 'inherit' };

  const row = (label, value, color = theme.text, mono = false) =>
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: `1px solid ${theme.cardBorder}` }
    },
      React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.82rem' } }, label),
      React.createElement('span', { style: { color, fontWeight: '600', fontSize: '0.875rem', fontFamily: mono ? 'monospace' : 'inherit' } }, value)
    );

  return React.createElement(window.MaerminUI.Overlay, {
    onClose,
    focusField: false, // a detail view: its only field is the note further down
    style: { position: 'fixed', inset: 0, background: 'rgba(4,6,10,0.62)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '1rem' }
  },
    React.createElement('div', {
      ...window.MaerminUI.dialogProps('dlg-position'),
      style: { background: theme.modalBg, border: `1px solid ${theme.modalBorder}`, borderRadius: '16px', width: '520px', maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 25px 60px rgba(0,0,0,0.5)' }
    },
      // Header
      React.createElement('div', {
        style: { padding: '1.25rem 1.5rem', borderBottom: `1px solid ${theme.modalBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
      },
        React.createElement('div', null,
          React.createElement('div', { id: 'dlg-position', style: { color: theme.text, fontWeight: '800', fontSize: '1.25rem' } }, position.sym),
          React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.25rem', alignItems: 'center' } },
            React.createElement('span', {
              style: { fontSize: '0.65rem', fontWeight: '700', padding: '0.15rem 0.4rem', borderRadius: '4px',
                background: position.cat === 'crypto' ? 'rgba(245,158,11,0.15)' : position.cat === 'stocks' ? 'rgba(59,130,246,0.15)' : 'rgba(6,182,212,0.15)',
                color: position.cat === 'crypto' ? '#f59e0b' : position.cat === 'stocks' ? '#3b82f6' : '#06b6d4' }
            }, window.MaerminI18n.category(position.cat).toUpperCase()),
            React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.8rem' } },
              metrics.firstBuyDate ? __('pdSince', 'Since {date}', { date: window.MaerminI18n.date(metrics.firstBuyDate) }) : ''
            )
          )
        ),
        React.createElement('button', {
          onClick: onClose,
          'aria-label': __('close', 'Close'),
          style: { background: 'none', border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.textSecondary, cursor: 'pointer', padding: '0.4rem 0.75rem', fontSize: '0.875rem' }
        }, '×')
      ),

      // Key metrics grid
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: theme.modalBorder, borderBottom: `1px solid ${theme.modalBorder}` }
      },
        [
          { label: __('retCurrentValue', 'Current Value'),    value: `${formatPrice(metrics.currentValue)} ${getCurrencySymbol()}`, big: true },
          { label: __('pdUnrealized', 'Unrealized P&L'),   value: `${metrics.unrealizedPL >= 0 ? '+' : ''}${formatPrice(metrics.unrealizedPL)} ${getCurrencySymbol()}`,
            color: metrics.unrealizedPL >= 0 ? theme.success : theme.danger, big: true },
          { label: __('pdAvgCost', 'Avg Cost'),         value: `${formatPrice(metrics.avgCost)} ${getCurrencySymbol()}` },
          { label: __('pdCurrentPrice', 'Current Price'),    value: `${formatPrice(metrics.currentPrice)} ${getCurrencySymbol()}` },
          { label: __('ovTotalReturn', 'Total Return'),     value: window.MaerminI18n.pct(metrics.unrealizedPct, 2, true),
            color: metrics.unrealizedPct >= 0 ? theme.success : theme.danger },
          { label: __('pdCagr', 'CAGR (annualized)'), value: metrics.cagr !== null ? window.MaerminI18n.pct(metrics.cagr, 2, true) : '—',
            color: metrics.cagr !== null ? (metrics.cagr >= 0 ? theme.success : theme.danger) : theme.textSecondary },
          { label: __('totalInvested', 'Total Invested'),   value: `${formatPrice(metrics.totalInvested)} ${getCurrencySymbol()}` },
          { label: __('feeTotalPaid', 'Total Fees Paid'),  value: `${formatPrice(metrics.totalFees)} ${getCurrencySymbol()}` },
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
          __('pdTxHistory', 'Transaction History ({n})', { n: posTxs.length })
        ),
        posTxs.length === 0
          ? React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', textAlign: 'center', padding: '1rem' } }, __('noTransactionsFound', 'No transactions found'))
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
                      background: window.MaerminUtils.txTypeInfo(tx.type, t).background,
                      color: window.MaerminUtils.txTypeInfo(tx.type, t).color
                    }
                  }, window.MaerminUtils.txTypeInfo(tx.type, t).label.toUpperCase()),
                  React.createElement('span', { style: { color: theme.textSecondary } }, window.MaerminI18n.date(tx.date)),
                  React.createElement('span', { style: { color: theme.text } }, `${window.MaerminI18n.num(qty, 4)} @ ${formatPrice(price)}`),
                  React.createElement('span', { style: { color: theme.text, fontWeight: '600', textAlign: 'right' } },
                    `${formatPrice(total)} ${getCurrencySymbol()}`
                  )
                );
              })
            )
      ),

      // Investment journal (V7): thesis, target, notes, dated reviews
      React.createElement('div', { style: { padding: '1.25rem 1.5rem', borderTop: `1px solid ${theme.modalBorder}` } },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem', marginBottom: '0.75rem' } }, t.journalTitle || 'Investment journal'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' } },
          React.createElement('div', null,
            React.createElement('label', { style: jLabel }, t.journalThesis || 'Investment thesis'),
            React.createElement('textarea', { value: j.thesis, onChange: e => saveJournal({ thesis: e.target.value }), placeholder: t.journalThesisPh || 'Why do you hold this?', style: { ...jInput, minHeight: '52px', resize: 'vertical' } })
          ),
          React.createElement('div', null,
            React.createElement('label', { style: jLabel }, t.journalTarget || 'Target / exit'),
            React.createElement('textarea', { value: j.target, onChange: e => saveJournal({ target: e.target.value }), placeholder: t.journalTargetPh || 'Price target, exit plan...', style: { ...jInput, minHeight: '52px', resize: 'vertical' } })
          )
        ),
        React.createElement('label', { style: jLabel }, t.journalNotes || 'Notes'),
        React.createElement('textarea', { value: j.notes, onChange: e => saveJournal({ notes: e.target.value }), placeholder: t.journalNotesPh || 'Free notes...', style: { ...jInput, minHeight: '60px', resize: 'vertical', marginBottom: '0.75rem' } }),
        React.createElement('label', { style: jLabel }, t.journalReviews || 'Reviews'),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' } },
          React.createElement('input', { value: reviewDraft, onChange: e => setReviewDraft(e.target.value), onKeyDown: e => { if (e.key === 'Enter') addReview(); }, placeholder: t.journalAddReview || 'Add a dated review...', style: { ...jInput, flex: 1 } }),
          React.createElement('button', { onClick: addReview, style: { padding: '0.5rem 0.9rem', background: theme.accent, color: '#ffffff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem' } }, '+')
        ),
        (j.reviews || []).length > 0 && React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.4rem' } },
          j.reviews.map((rv, i) => React.createElement('div', { key: i, style: { fontSize: '0.8rem', borderLeft: `2px solid ${theme.cardBorder}`, paddingLeft: '0.6rem' } },
            React.createElement('span', { style: { color: theme.textSecondary, fontWeight: 600, marginRight: '0.4rem' } }, rv.date),
            React.createElement('span', { style: { color: theme.text } }, rv.text)))
        )
      ),

      // Corporate actions (stock splits) for this holding
      React.createElement(CorporateActionsPanel, { category: position.cat, symbol: position.sym, theme, t, workerUrl })
    )
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

  return React.createElement('div', { style: { position: 'relative' } },
    // Search input
    React.createElement('div', { style: { position: 'relative' } },
      React.createElement('input', {
        type: 'text',
        value: query,
        onChange: e => { setQuery(e.target.value); if (!e.target.value) { setResults([]); setOpen(false); } },
        onFocus: () => results.length > 0 && setOpen(true),
        placeholder: __('ssSearchPh', 'Search CS2 skins — e.g. AK-47 Redline...'), 'aria-label': __('ssSkin', 'Skin'),
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
        React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.72rem' } }, __('ssResults', '{n} {n:result|results} — click to select', { n: results.length })),
        React.createElement('button', {
          onClick: () => setOpen(false),
          'aria-label': __('close', 'Close'),
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
            ...window.MaerminUtils.clickable(() => select(item)),
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
                }, React.createElement('span', { style: { color: 'rgba(6,182,212,0.4)', fontSize: '0.7rem' } }, __('ssNoImage', 'No image'))),

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
              }, window.MaerminI18n.money(item.price, 'USD')) // skin prices are USD (Steam Market price list)
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

const TYPE_COLOR = {
  EQUITY: '#3b82f6', ETF: '#06b6d4', MUTUALFUND: '#8b7cff',
  CRYPTOCURRENCY: '#f59e0b', COMMODITY: '#d97706',
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
          const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`;
          const CG  = window.MaerminCoinGecko;
          const data = CG
            ? await CG.getJson(url, { priority: 'high', timeoutMs: 8000 })
            : await fetch(url, { signal: AbortSignal.timeout(8000) }).then(r => { if (!r.ok) throw new Error(`Search failed: ${r.status}`); return r.json(); });
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

  return React.createElement('div', { style: { position: 'relative' } },

    // ── Search Input ──────────────────────────────────────────────────────
    React.createElement('div', { style: { position: 'relative', display: 'flex', gap: '0.5rem', alignItems: 'center' } },
      React.createElement('div', { style: { flex: 1, position: 'relative' } },
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
          style: {
            width: '100%', padding: '0.75rem 2.5rem 0.75rem 0.875rem',
            background: theme.inputBg, border: `1px solid ${selected ? theme.accent : theme.inputBorder}`,
            borderRadius: '8px', color: theme.text, fontSize: '0.875rem', boxSizing: 'border-box',
            transition: 'border-color 0.15s'
          }
        }),
        loading && React.createElement('div', {
          style: { position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: theme.textSecondary, fontSize: '0.8rem' }
        }, '◎')
      ),
      selected && React.createElement('button', {
        onClick: clear,
        title: __('clearSelection', 'Clear selection'), 'aria-label': __('clearSelection', 'Clear selection'),
        style: { padding: '0.5rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '0.875rem', lineHeight: 1 }
      }, '×')
    ),

    // ── Typed, not picked: say what will be saved ─────────────────────────
    !selected && query.trim() && React.createElement('div', {
      style: { marginTop: '0.4rem', fontSize: '0.72rem', color: theme.textSecondary }
    }, isCrypto ? __('spkTypedCoin', 'Saved as typed: {sym} — pick a suggestion for the exact coin.', { sym: typedSymbol(query) }) : __('spkTypedListing', 'Saved as typed: {sym} — pick a suggestion for the exact listing.', { sym: typedSymbol(query) })),

    // ── Selected Preview ──────────────────────────────────────────────────
    selected && React.createElement('div', {
      style: { marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 0.875rem', background: `${theme.accent}0d`, border: `1px solid ${theme.accent}33`, borderRadius: '8px' }
    },
      // Logo
      React.createElement('div', {
        style: { width: 40, height: 40, borderRadius: '8px', flexShrink: 0, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }
      },
        React.createElement('span', {
          style: {
            fontSize: '0.6rem', fontWeight: '800', position: 'absolute',
            color: (['#3b82f6','#8b7cff','#06b6d4','#f59e0b','#22c55e','#ef4444'])[((selected.ticker||selected.symbol||'A').charCodeAt(0)) % 6]
          }
        }, (selected.ticker || selected.symbol || '').replace(/\..+$/, '').slice(0, 3)),
        selected.logoUrl && React.createElement('img', {
          src: selected.logoUrl, alt: '',
          style: { width: 40, height: 40, objectFit: 'contain', position: 'absolute', background: 'rgba(15,15,25,0.9)', borderRadius: '8px' },
          onError: e => { if (e.target) e.target.style.display = 'none'; }
        })
      ),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        // Name + type badge
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.25rem' } },
          React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem' } }, selected.name),
          React.createElement('span', { style: { fontSize: '0.62rem', padding: '0.1rem 0.35rem', borderRadius: '3px', background: `${TYPE_COLOR[selected.type] || theme.accent}20`, color: TYPE_COLOR[selected.type] || theme.accent, fontWeight: '700' } }, typeLabel(selected.type)),
          selected.exchange && React.createElement('span', { style: { fontSize: '0.65rem', color: theme.textSecondary } }, selected.exchange)
        ),
        // The exact symbol that will be saved — most important part
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.5rem', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '5px', width: 'fit-content' }
        },
          React.createElement('span', { style: { color: '#22c55e', fontSize: '0.7rem' } }, '✓'),
          React.createElement('span', { style: { color: '#22c55e', fontWeight: '700', fontSize: '0.8rem', fontFamily: 'monospace', letterSpacing: '0.03em' } },
            isCrypto ? selected.symbol : selected.symbol  // exact YF symbol or CoinGecko ID
          ),
          React.createElement('span', { style: { color: 'rgba(34,197,94,0.6)', fontSize: '0.65rem' } },
            isCrypto ? '· ' + __('spkCgId', 'CoinGecko ID') : '· ' + __('spkYfSymbol', 'Yahoo Finance symbol')
          )
        )
      )
    ),

    // ── Error ─────────────────────────────────────────────────────────────
    error && React.createElement('div', {
      style: { fontSize: '0.75rem', color: '#ef4444', marginTop: '0.25rem', padding: '0 0.25rem' }
    }, error),

    // ── Results Dropdown ──────────────────────────────────────────────────
    open && results.length > 0 && React.createElement('div', {
      style: {
        position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 9999,
        background: theme.modalBg || theme.card,
        border: `1px solid ${theme.modalBorder || theme.cardBorder}`,
        borderRadius: '10px', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        maxHeight: '360px', overflowY: 'auto'
      }
    },
      // Header
      React.createElement('div', {
        style: { padding: '0.5rem 0.875rem', borderBottom: `1px solid ${theme.cardBorder}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
      },
        React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.7rem' } },
          __('spkResults', '{n} {n:result|results} · click to select', { n: results.length })
        ),
        React.createElement('button', {
          onClick: () => setOpen(false),
          'aria-label': __('close', 'Close'),
          style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem', lineHeight: 1 }
        }, '×')
      ),

      // Results list
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
        results.map((item, i) =>
          React.createElement('div', {
            key: i,
            ...window.MaerminUtils.clickable(() => pick(item)),
            style: {
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.625rem 0.875rem',
              borderBottom: i < results.length - 1 ? `1px solid ${theme.cardBorder}` : 'none',
              cursor: 'pointer', transition: 'background 0.1s'
            },
            onMouseEnter: e => e.currentTarget.style.background = `${theme.accent}10`,
            onMouseLeave: e => e.currentTarget.style.background = 'transparent'
          },
            // Logo — letter avatar always rendered underneath; img shown on top if it loads
            React.createElement('div', {
              style: { width: 36, height: 36, borderRadius: '8px', flexShrink: 0, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }
            },
              // Letter avatar (always there as base layer)
              React.createElement('span', {
                style: {
                  fontSize: '0.6rem', fontWeight: '800', position: 'absolute',
                  color: (['#3b82f6','#8b7cff','#06b6d4','#f59e0b','#22c55e','#ef4444'])[((item.ticker||item.symbol||'A').charCodeAt(0)) % 6]
                }
              }, (item.ticker || item.symbol || '').replace(/\..+$/, '').slice(0, 3)),
              // Logo image on top — hidden on error (reveals letter avatar)
              item.logoUrl && React.createElement('img', {
                src: item.logoUrl, alt: '',
                style: { width: 36, height: 36, objectFit: 'contain', position: 'absolute', background: 'rgba(15,15,25,0.85)', borderRadius: '8px' },
                onError: e => { if (e.target) e.target.style.display = 'none'; }
              })
            ),

            // Info
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' } },
                React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.875rem' } }, item.ticker || item.symbol),
                React.createElement('span', {
                  style: { fontSize: '0.6rem', padding: '0.1rem 0.3rem', borderRadius: '3px', background: `${TYPE_COLOR[item.type] || '#3b82f6'}20`, color: TYPE_COLOR[item.type] || '#3b82f6', fontWeight: '600' }
                }, typeLabel(item.type)),
                item.exchange && React.createElement('span', { style: { fontSize: '0.65rem', color: theme.textSecondary } }, item.exchange)
              ),
              React.createElement('div', {
                style: { color: theme.textSecondary, fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.1rem' }
              }, item.name)
            ),

            // Arrow
            React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.8rem', opacity: 0.5 } }, '→')
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

console.log('[OK] MAERMIN Features3 v10.0 loaded — Position Detail, CAGR, CS2 Skin Picker, Symbol Picker');

})();
