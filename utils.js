/**
 * MAERMIN - Shared formatting & utility helpers
 * ------------------------------------------------------------------
 * Single source of truth for the static (state-independent) formatters
 * that used to live separately inside renderer-components.js.
 *
 * NOTE: renderer.js keeps its own `formatPrice` because that one depends
 * on live component state (selected currency + exchange rate). The helpers
 * here are pure and safe to share.
 */
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  // Locale formatting lives in i18n.js (MaerminI18n); these keep their old
  // names and follow the selected language. utils.js loads first, so look the
  // module up when a formatter runs.
  function I18n() {
    return (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js');
  }

  // Number with fixed decimals, e.g. 1234.5 -> "1,234.50" (en) / "1.234,50" (de)
  function formatNumber(value, decimals) {
    return I18n().num(value, decimals !== undefined ? decimals : 2);
  }

  // Calendar date, e.g. "2024-03-01" -> "03/01/2024" (en) / "01.03.2024" (de)
  function formatDate(dateStr) {
    return I18n().date(dateStr, 'short');
  }

  // Reasonably-unique id for client-side records
  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Clamp a number into [min, max]
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // Insert-or-update a transaction. The single source of truth for the
  // "edit must UPDATE in place, never CREATE a duplicate" invariant that the
  // transaction modal relies on. When `editingId` is set we ONLY update the
  // matching record (id preserved); if it isn't found we make NO change rather
  // than appending a stray duplicate. When `editingId` is empty we append a new
  // record. Pure — unit-tested in test/transactions.test.js.
  function upsertTransaction(transactions, data, editingId, newId) {
    const list = Array.isArray(transactions) ? transactions : [];
    if (editingId !== null && editingId !== undefined && editingId !== '') {
      let found = false;
      const next = list.map((tx) => {
        if (tx && tx.id === editingId) {
          found = true;
          // Spread data first, then force the original id so it can never change.
          return Object.assign({}, tx, data, { id: tx.id });
        }
        return tx;
      });
      return { transactions: next, updated: found, created: false, found };
    }
    const id = (newId !== null && newId !== undefined && newId !== '') ? newId : generateId();
    return { transactions: list.concat([Object.assign({ id }, data)]), updated: false, created: true, found: true };
  }

  // P5-1.3: save a cash booking from the transaction dialog. form = { type,
  // amount, currency, date, notes, portfolioId, counterPortfolioId? }. A
  // transfer is entered from either side (transfer_out: portfolioId → counter;
  // transfer_in: counter → portfolioId) and stored as a pair (ledger.js).
  // Editing one half updates both (ids and transferId kept); a transfer
  // edited into another type drops its other half, and the other way round
  // gains one. A trade edited into a cash type loses its trade fields.
  // → { transactions, error? ('amount' | 'date' | 'counterPortfolioId') }. Pure.
  const TRADE_FIELDS = ['symbol', 'symbolName', 'symbolLogoUrl', 'skinIconUrl', 'quantity', 'price', 'fees', 'withholdingTax',
    'underlying', 'optionType', 'strike', 'expiry', 'contractSize', 'transferId', 'counterPortfolioId'];
  function upsertCash(transactions, form, editingId, newIdFn) {
    const L = (typeof window !== 'undefined' && window.MaerminLedger) || require('./ledger.js');
    const list = Array.isArray(transactions) ? transactions : [];
    const newId = typeof newIdFn === 'function' ? newIdFn : generateId;
    const f = form || {};
    const isTr = f.type === 'transfer_out' || f.type === 'transfer_in';
    const here = String(f.portfolioId || 'default');
    const from = f.type === 'transfer_in' ? String(f.counterPortfolioId || '') : here;
    const to = f.type === 'transfer_in' ? here : String(f.counterPortfolioId || '');
    const plain = { category: 'cashflow', amount: Number(f.amount), currency: f.currency || 'EUR', date: f.date, notes: f.notes || '' };
    const probe = isTr ? Object.assign({ type: 'transfer_out', portfolioId: from, counterPortfolioId: to, transferId: 'x' }, plain)
      : Object.assign({ type: f.type, portfolioId: here }, plain);
    const bad = L.validateCash(probe);
    if (bad.length) return { transactions: list, error: bad[0] === 'transferId' ? 'counterPortfolioId' : bad[0] };

    const clean = (row) => { const o = Object.assign({}, row); TRADE_FIELDS.forEach((k) => { delete o[k]; }); return o; };
    const editing = editingId !== null && editingId !== undefined && editingId !== '';
    const old = editing ? list.find((tx) => tx && tx.id === editingId) : null;
    if (editing && !old) return { transactions: list };
    const partner = old ? L.pairOf(list, old) : null;

    if (!isTr) {
      const row = Object.assign(old ? clean(old) : { id: newId() }, plain, { type: f.type, portfolioId: here });
      if (!old) return { transactions: list.concat([row]) };
      return { transactions: list.filter((tx) => tx !== partner).map((tx) => (tx === old ? row : tx)) };
    }
    if (!old) return { transactions: list.concat(L.transferPair(Object.assign({ fromPortfolioId: from, toPortfolioId: to }, plain), newId)) };
    // Edit into a transfer: keep the edited row's id on its new side; the other
    // side keeps the partner's id or gets a new one.
    const tid = (partner && old.transferId) || ('tr_' + newId());
    const outOld = old.type === 'transfer_in' && partner ? partner : old;
    const inOld = outOld === old ? partner : old;
    const outRow = Object.assign(clean(outOld), plain, { type: 'transfer_out', portfolioId: from, counterPortfolioId: to, transferId: tid });
    const inRow = Object.assign(inOld ? clean(inOld) : { id: newId() }, plain, { type: 'transfer_in', portfolioId: to, counterPortfolioId: from, transferId: tid });
    const next = list.map((tx) => (tx === outOld ? outRow : tx === inOld ? inRow : tx));
    return { transactions: inOld ? next : next.concat([inRow]) };
  }

  // ── Currency conversion ────────────────────────────────────────────────
  // The app's canonical internal currency is EUR; `usdToEur` is the live rate
  // (1 USD = usdToEur EUR). These centralise the conversion so every call site
  // (skins, stocks, commodities, display) agrees and no rounding happens here —
  // values are kept full-precision and only rounded at DISPLAY time. CS2 skin
  // prices are delivered in USD and MUST go through toEUR on ingestion.
  // Other currencies (GBP, GBp pence, CHF, …) go through the USD cross rates of
  // MaerminFxHistory.quoteToEUR; they were returned unchanged, i.e. counted as
  // EUR (AUDIT BUG-028). Only an amount whose currency no rate covers is still
  // treated as canonical EUR.
  function fxHistory() {
    if (typeof window !== 'undefined' && window.MaerminFxHistory) return window.MaerminFxHistory;
    try { return typeof require === 'function' ? require('./fx-history.js') : null; } catch (e) { return null; }
  }
  function toEUR(amount, currency, usdToEur) {
    const a = parseFloat(amount) || 0;
    if (currency === 'USD' && usdToEur > 0) return a * usdToEur;
    if (!currency || currency === 'EUR' || currency === 'USD') return a;
    const FX = fxHistory();
    const v = FX && FX.quoteToEUR ? FX.quoteToEUR(a, currency, usdToEur) : null;
    return (v != null && isFinite(v)) ? v : a; // unknown currency → treated as canonical
  }

  // Accessibility: make a non-<button> element (div/span/tr/th used as a
  // control) behave like a button for keyboard + assistive-tech users. Returns
  // the prop bag to spread into React.createElement:
  //   React.createElement('div', { ...clickable(() => select(x)), style })
  // It wires onClick AND an Enter/Space onKeyDown to the same handler, and adds
  // role="button" + tabIndex so the element is focusable and announced.
  // Keys and clicks inside a form field of the element (e.g. the rename input
  // on a portfolio card) belong to that field: typing a space there must not
  // be swallowed, and focusing it must not run the card's action (FINDINGS M-10).
  function fromField(e) {
    var el = e && e.target;
    if (!el || el === e.currentTarget) return false;
    var tag = (el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
  }
  function clickable(handler, opts) {
    opts = opts || {};
    return {
      role: opts.role || 'button',
      tabIndex: opts.tabIndex === undefined ? 0 : opts.tabIndex,
      onClick: function (e) { if (!fromField(e)) handler(e); },
      onKeyDown: function (e) {
        if (e && e.target && e.currentTarget && e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          handler(e);
        }
      },
    };
  }

  // Ask before a destructive action (FINDINGS M-9). opts go to
  // MaerminUI.confirm ({ title, message, confirmLabel }); danger is the default.
  // Without the dialog host nothing happens: a one-click delete is the bug.
  function confirmThen(opts, action) {
    var UI = (typeof window !== 'undefined') && window.MaerminUI;
    if (!UI || typeof UI.confirm !== 'function') return Promise.resolve(false);
    return UI.confirm(Object.assign({ danger: true }, opts)).then(function (yes) {
      if (yes) action();
      return !!yes;
    });
  }

  // Text colour for a filled surface: white when it reaches WCAG AA (4.5:1)
  // on `bg`, else near-black. Bright fills (success green, warning amber,
  // the dark-theme accents) get dark text. Non-hex colours keep white.
  // Text colour for a component that takes a colour prop: the fixed semantic
  // hexes (Tailwind green/red/amber/blue/slate) become the theme's own, which
  // read at WCAG AA in every theme. Other colours pass through.
  const INK = {
    '#22c55e': 'var(--success)', '#16a34a': 'var(--success)',
    '#ef4444': 'var(--danger)', '#dc2626': 'var(--danger)',
    '#f59e0b': 'var(--warning)', '#d97706': 'var(--warning)', '#eab308': 'var(--warning)',
    '#3b82f6': 'var(--info)', '#94a3b8': 'var(--text-dim)'
  };
  function ink(c) {
    return (typeof c === 'string' && INK[c.trim().toLowerCase()]) || c;
  }

  // The shared empty / loading / gated state (MaerminUI.EmptyState) as an
  // element; a plain div where the UI store is not loaded (Node harnesses).
  function emptyState(props) {
    const R = typeof React !== 'undefined' ? React : (typeof window !== 'undefined' && window.React);
    const UI = typeof window !== 'undefined' && window.MaerminUI;
    if (UI && UI.EmptyState) return R.createElement(UI.EmptyState, props);
    return R.createElement('div', { 'data-testid': props.testid, 'data-kind': props.kind || 'empty' }, props.title ? props.title + ' ' : '', props.text);
  }
  // "Needs your Worker", inside a card, with a button to API Settings.
  function workerNote(text, testid) {
    const UI = typeof window !== 'undefined' && window.MaerminUI;
    return emptyState({ compact: true, kind: 'worker', testid: testid, text: text, action: UI && UI.workerAction ? UI.workerAction() : undefined });
  }

  // R5.2: a loading or failed state inside a card, on the shared EmptyState.
  function loadingNote(text, testid) {
    return emptyState({ compact: true, kind: 'loading', testid: testid, text: text });
  }
  // retry: an optional function; it adds a Retry button.
  function errorNote(text, retry, testid) {
    return emptyState({ compact: true, kind: 'error', testid: testid, text: text,
      action: typeof retry === 'function' ? { label: __('retry', 'Retry'), onClick: retry } : undefined });
  }
  // "Nothing here (yet)" inside a card.
  function emptyNote(text, testid) {
    return emptyState({ compact: true, kind: 'empty', testid: testid, text: text });
  }

  function onColor(bg) {
    // A theme colour arrives as var(--…) (R1.1): resolve it for the active theme.
    const T = typeof window !== 'undefined' && window.MaerminTokens;
    if (T && T.isVar(bg)) bg = T.resolve(bg);
    const m = String(bg || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return '#ffffff';
    let h = m[1]; if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    return (1.05 / (L + 0.05)) >= 4.5 ? '#ffffff' : '#0b0b14';
  }

  // JSON.parse that never throws — a corrupted storage entry must not take the
  // whole app down at boot; callers get the fallback instead.
  function safeParse(raw, fallback) {
    if (raw === null || raw === undefined || raw === '') return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  // Locale-tolerant decimal parser for user-typed numbers. Accepts both
  // "1234.56" and German-style "1.234,56" / "1,5"; returns NaN when the input
  // is not a number (parseFloat would silently truncate "1,5" to 1).
  function parseDecimal(value) {
    if (typeof value === 'number') return isFinite(value) ? value : NaN;
    if (value === null || value === undefined) return NaN;
    let s = String(value).trim().replace(/\s+/g, '');
    if (!s) return NaN;
    const hasComma = s.indexOf(',') !== -1;
    const hasDot = s.indexOf('.') !== -1;
    if (hasComma && hasDot) {
      // The right-most separator is the decimal mark; the other is thousands.
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (hasComma) {
      // One comma → decimal mark; several → thousands separators.
      s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  // Today's date in the user's LOCAL timezone as YYYY-MM-DD. The widespread
  // `new Date().toISOString().split('T')[0]` returns the UTC date, which is
  // yesterday for European users between midnight and 1-2 AM.
  function todayISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Only http(s) links may reach an href. Third-party content (RSS feeds,
  // API payloads) can carry `javascript:`/`data:` URLs, which React 18 still
  // renders and the CSP ('unsafe-inline') would let execute on click.
  function safeUrl(raw, fallback) {
    const fb = fallback === undefined ? '#' : fallback;
    if (typeof raw !== 'string') return fb;
    const s = raw.trim();
    if (!/^https?:\/\//i.test(s)) return fb;
    try { const u = new URL(s); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : fb; }
    catch (e) { return fb; }
  }

  // Price-point timestamp -> epoch ms, or NaN. Only unambiguous forms are
  // accepted: epoch numbers and ISO-8601 strings. Older builds stored live
  // points as a year-less en-US string ("09/30, 08:14 PM") that V8 parses as
  // the year 2001, which silently broke every date lookup on the history.
  function parseTimestamp(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (v instanceof Date) return v.getTime();
    const s = String(v == null ? '' : v);
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return NaN;
    return new Date(s).getTime();
  }

  // Lazy, SRI-pinned script loader (sequential, cached per URL). Heavy
  // third-party libraries that are only needed for one action (PDF export)
  // load on first use instead of blocking the first paint.
  const _scriptPromises = {};
  function loadScripts(list) {
    if (typeof document === 'undefined') return Promise.reject(new Error('browser only'));
    return (list || []).reduce((chain, lib) => chain.then(() => {
      if (_scriptPromises[lib.src]) return _scriptPromises[lib.src];
      _scriptPromises[lib.src] = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = lib.src;
        if (lib.integrity) { el.integrity = lib.integrity; el.crossOrigin = 'anonymous'; }
        el.onload = resolve;
        el.onerror = () => { delete _scriptPromises[lib.src]; reject(new Error('Failed to load ' + lib.src)); };
        document.head.appendChild(el);
      });
      return _scriptPromises[lib.src];
    }), Promise.resolve());
  }

  // One place that names a transaction type for display. Views used
  // `type === 'buy' ? 'Buy' : 'Sell'`, so a dividend or an interest booking
  // read "SELL". tone: 'in' (money into an asset), 'out' (disposal),
  // 'income' (dividend/interest) or 'neutral' (anything unknown).
  const TX_TYPES = {
    buy:      { key: 'buy',        label: () => __('buy', 'Buy'),             tone: 'in' },
    sell:     { key: 'sell',       label: () => __('sell', 'Sell'),           tone: 'out' },
    dividend: { key: 'txDividend', label: () => __('txDividend', 'Dividend'), tone: 'income' },
    interest: { key: 'txInterest', label: () => __('txInterest', 'Interest'), tone: 'income' },
    // P5-1.3: cash bookings (ledger.js CASH_TYPES); green adds cash, red takes it.
    deposit:         { key: 'txDeposit',        label: () => __('txDeposit', 'Deposit'),                tone: 'in' },
    withdrawal:      { key: 'txWithdrawal',     label: () => __('txWithdrawal', 'Withdrawal'),          tone: 'out' },
    transfer_in:     { key: 'txTransferIn',     label: () => __('txTransferIn', 'Transfer in'),         tone: 'in' },
    transfer_out:    { key: 'txTransferOut',    label: () => __('txTransferOut', 'Transfer out'),       tone: 'out' },
    fee:             { key: 'txFee',            label: () => __('txFee', 'Fee'),                        tone: 'out' },
    fee_refund:      { key: 'txFeeRefund',      label: () => __('txFeeRefund', 'Fee refund'),           tone: 'in' },
    tax:             { key: 'txTax',            label: () => __('txTax', 'Tax'),                        tone: 'out' },
    tax_refund:      { key: 'txTaxRefund',      label: () => __('txTaxRefund', 'Tax refund'),           tone: 'in' },
    interest_charge: { key: 'txInterestCharge', label: () => __('txInterestCharge', 'Interest charge'), tone: 'out' }
  };
  const TX_TONES = {
    // theme colours (styles.css), AA on the card and on their own tint in every theme
    in:      { color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 12%, transparent)' },
    out:     { color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)' },
    income:  { color: 'var(--info)', background: 'color-mix(in srgb, var(--info) 12%, transparent)' },
    neutral: { color: 'var(--text-dim)', background: 'color-mix(in srgb, var(--text-dim) 12%, transparent)' }
  };
  function txTypeInfo(type, t) {
    const raw = String(type == null ? '' : type).trim();
    const def = TX_TYPES[raw.toLowerCase()];
    const tone = def ? def.tone : 'neutral';
    const label = def ? ((t && t[def.key]) || def.label())
      : (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '—');
    return { label, tone, color: TX_TONES[tone].color, background: TX_TONES[tone].background };
  }

  // Required fields of the transaction form that are still empty, in form
  // order ('symbol', 'quantity', 'price'). `symbol` overrides tx.symbol (an
  // option contract derives it). Values are only checked for presence here;
  // the save handler validates the numbers afterwards.
  function missingTxFields(tx, symbol) {
    tx = tx || {};
    const empty = (v) => v == null || String(v).trim() === '';
    const out = [];
    if (empty(symbol != null ? symbol : tx.symbol)) out.push('symbol');
    if (empty(tx.quantity)) out.push('quantity');
    if (empty(tx.price)) out.push('price');
    return out;
  }

  // Has a flat form object changed since `initial`? Values compare as text and
  // a missing key equals '' (a field that appears empty is no change), so the
  // dialog only asks before discarding when the user actually typed or chose
  // something.
  function formChanged(initial, current) {
    initial = initial || {}; current = current || {};
    const txt = (v) => (v == null ? '' : String(v));
    const keys = {};
    Object.keys(initial).concat(Object.keys(current)).forEach((k) => { keys[k] = true; });
    return Object.keys(keys).some((k) => txt(initial[k]) !== txt(current[k]));
  }

  // Category the Add Transaction dialog starts on: the one of the transaction
  // entered last in this portfolio (ids are creation timestamps; without a
  // numeric id the later array entry wins), else `fallback` ('crypto').
  // `allowed` drops categories that no longer exist (a deleted custom one).
  function defaultTxCategory(transactions, portfolioId, allowed, fallback) {
    const pid = portfolioId || 'default';
    let best = null, bestId = -Infinity;
    (Array.isArray(transactions) ? transactions : []).forEach((tx, i) => {
      if (!tx || !tx.category || (tx.portfolioId || 'default') !== pid) return;
      if (Array.isArray(allowed) && allowed.indexOf(tx.category) === -1) return;
      const n = Number(tx.id);
      const key = isFinite(n) && String(tx.id).trim() !== '' ? n : i;
      if (key >= bestId) { bestId = key; best = tx.category; }
    });
    return best || fallback || 'crypto';
  }

  const MaerminUtils = {
    defaultTxCategory,
    formChanged,
    missingTxFields,
    txTypeInfo,
    formatNumber,
    formatDate,
    generateId,
    clamp,
    upsertTransaction,
    upsertCash,
    toEUR,
    clickable,
    confirmThen,
    onColor,
    ink,
    emptyState,
    workerNote,
    loadingNote,
    errorNote,
    emptyNote,
    safeParse,
    parseDecimal,
    todayISO,
    safeUrl,
    parseTimestamp,
    loadScripts,
  };

  if (typeof window !== 'undefined') {
    window.MaerminUtils = MaerminUtils;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MaerminUtils;
  }
})();
