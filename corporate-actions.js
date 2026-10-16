// ============================================================================
// MAERMIN — Corporate-Action Engine  (window.MaerminCorporateActions)
// ----------------------------------------------------------------------------
// Applies stock splits and reverse splits to a flat transaction list so every
// downstream number (position value, P&L, CAGR, the value chart, FIFO cost
// basis and the tax report) stays self-consistent across a split.
//
// THE INVARIANT (why the overlay approach is correct)
// ---------------------------------------------------
// A forward split of ratio N:M (10:1 -> N=10, M=1) applied to every buy/sell
// lot that occurred STRICTLY BEFORE the split's effective date:
//
//     quantity -> quantity * (N / M)
//     price    -> price    * (M / N)
//
// This keeps quantity * price (the cash amount) constant and leaves the cost
// basis unchanged — only the per-share split changes. Therefore XIRR/TWR
// cashflows (amount = qty * price, invariant), FIFO cost basis, realised /
// unrealised P&L and the value chart all stay correct when the adjustment is
// applied UNIFORMLY to every consumer. A reverse split is the same formula with
// N < M (e.g. 1:10 -> N=1, M=10). Because `adjust` is the IDENTITY when no
// action is stored, wiring it into the shared metrics service is a no-op for
// every existing user until they record their first split.
//
// DATA MODEL (versioned + defensive, like portfolio-snapshots.js)
//   { version: 1, actions: [
//       { id, kind: 'split', category, symbol, date: 'YYYY-MM-DD',
//         num: <int>, den: <int>, source: 'auto' | 'manual', note: '' } ] }
//   num/den are the split ratio (10:1 -> num:10, den:1). One action per
//   (symbol, date); a re-record of the same (symbol, date) overwrites.
//
// FURTHER ACTIONS (P5-3.10) live in their own key 'maermin_corporate_events'
// so an older app version never reads a merger ratio as a split, nor drops
// them when it saves its split list:
//
//   { version: 1, events: [
//       { id, kind: 'symbol_change' | 'isin_change' | 'merger' | 'spinoff',
//         category, symbol (old / parent), date (effective), newSymbol,
//         newName, num, den (merger: new shares per old; spin-off: child
//         shares per parent share), cashPerShare (merger), costShare
//         (spin-off: fraction of the parent's cost that moves to the child),
//         currency, note } ] }
//
//   symbol / ISIN change  every row of the old symbol before the date moves to
//                         the new one; quantities, cost and dates unchanged
//   merger                old shares x num/den become new shares; cost and
//                         acquisition dates carry over (share exchange, tax-
//                         neutral under sec. 20 (4a) S.1 EStG); a cash part per
//                         old share is capital income on the date (S.2),
//                         booked as a dividend row of the new symbol
//   spin-off              each parent lot still open on the date gets a child
//                         lot (qty x num/den, the parent lot's date) carrying
//                         costShare of its cost; the parent lot keeps the rest
//                         (sec. 20 (4a) S.7). A lot partly sold before is split
//                         so the earlier sale keeps its gain.
//
// Splits and events are applied together in date order (a split of the new
// symbol after a rename reaches the renamed lots). With no event recorded the
// split-only path below runs unchanged.
//
// Pure math (normalize / adjust / ratioFromYahoo) is split from the
// localStorage helpers (load / save / record / remove) so the engine is
// unit-tested headlessly in Node (test/corporate-actions.test.js).
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var STORAGE_KEY = 'maermin_corporate_actions';
  var SCHEMA = 1;
  var EVENTS_KEY = 'maermin_corporate_events';
  var EVENT_KINDS = { symbol_change: 1, isin_change: 1, merger: 1, spinoff: 1 };

  function isISODate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function toInt(v) { var n = parseInt(v, 10); return isFinite(n) ? n : NaN; }

  // Stable, collision-resistant id for a recorded action (no crypto dependency).
  function makeId(category, symbol, date) {
    return 'ca-' + String(category || '') + '-' + String(symbol || '').toLowerCase() + '-' + String(date || '');
  }

  // Coerce any stored / foreign value into a clean {version, actions[]} object.
  // A malformed action is dropped silently so one corrupt entry can never break
  // the app. Sorted by date (then symbol) and de-duped on (symbol, date) — a
  // later entry for the same key overwrites an earlier one.
  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var list = Array.isArray(obj.actions) ? obj.actions : [];
    var byKey = {};
    list.forEach(function (a) {
      if (!a || typeof a !== 'object') return;
      if (!isISODate(a.date)) return;
      var symbol = (a.symbol == null ? '' : String(a.symbol)).trim();
      if (!symbol) return;
      var num = toInt(a.num);
      var den = toInt(a.den);
      if (!isFinite(num) || !isFinite(den) || num <= 0 || den <= 0) return;
      var category = (a.category == null ? '' : String(a.category)).trim() || 'stocks';
      var dedupKey = category + '|' + symbol.toLowerCase() + '|' + a.date;
      byKey[dedupKey] = {
        id: a.id ? String(a.id) : makeId(category, symbol, a.date),
        kind: 'split',
        category: category,
        symbol: symbol,
        date: a.date,
        num: num,
        den: den,
        source: a.source === 'auto' ? 'auto' : 'manual',
        note: a.note == null ? '' : String(a.note)
      };
    });
    var actions = Object.keys(byKey).map(function (k) { return byKey[k]; });
    actions.sort(sortActions);
    return { version: SCHEMA, actions: actions };
  }

  function sortActions(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    var sa = a.symbol.toLowerCase(), sb = b.symbol.toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  function sameAsset(tx, action) {
    var txCat = (tx.category || 'crypto');
    var txSym = (tx.symbol || tx.name || '');
    return txCat === action.category &&
      String(txSym).toLowerCase() === String(action.symbol).toLowerCase();
  }

  // Map a Yahoo Finance split event to a clean { num, den } ratio. Yahoo reports
  // a split as { numerator, denominator } (a 10-for-1 forward split is
  // numerator:10, denominator:1; a 1-for-10 reverse split is 1, 10). Some
  // payloads instead carry a "splitRatio" string like "10:1" — both are handled.
  // Returns null when the event is unusable.
  function ratioFromYahoo(ev) {
    if (!ev || typeof ev !== 'object') return null;
    var num = toInt(ev.numerator);
    var den = toInt(ev.denominator);
    if ((!isFinite(num) || !isFinite(den)) && typeof ev.splitRatio === 'string') {
      var parts = ev.splitRatio.split(/[:/]/);
      if (parts.length === 2) { num = toInt(parts[0]); den = toInt(parts[1]); }
    }
    if (!isFinite(num) || !isFinite(den) || num <= 0 || den <= 0) return null;
    return { num: num, den: den };
  }

  // ---- further actions (P5-3.10) ------------------------------------------------
  // "1,50" / "1.50" / 1.5 -> 1.5
  function dec(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).trim().replace(/\s/g, '');
    if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }
  function normalizeEvents(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var list = Array.isArray(obj.events) ? obj.events : [];
    var byKey = {};
    list.forEach(function (e) {
      if (!e || typeof e !== 'object' || !EVENT_KINDS[e.kind] || !isISODate(e.date)) return;
      var symbol = String(e.symbol == null ? '' : e.symbol).trim();
      var newSymbol = String(e.newSymbol == null ? '' : e.newSymbol).trim();
      if (!symbol || !newSymbol || symbol.toLowerCase() === newSymbol.toLowerCase()) return;
      var category = String(e.category == null ? '' : e.category).trim() || 'stocks';
      var out = { id: '', kind: e.kind, category: category, symbol: symbol, date: e.date, newSymbol: newSymbol,
        newName: e.newName == null ? '' : String(e.newName).trim(), num: 1, den: 1, note: e.note == null ? '' : String(e.note) };
      if (e.kind === 'merger' || e.kind === 'spinoff') {
        var num = dec(e.num), den = dec(e.den);
        if (!(num > 0) || !(den > 0)) return;
        out.num = num; out.den = den;
      }
      if (e.kind === 'merger') {
        var cash = dec(e.cashPerShare);
        out.cashPerShare = cash > 0 ? cash : 0;
      }
      if (e.kind === 'spinoff') {
        var share = e.costSharePct != null && e.costSharePct !== '' ? dec(e.costSharePct) / 100 : dec(e.costShare);
        if (!(share >= 0 && share <= 1)) return;
        out.costShare = share;
      }
      if (e.currency && /^[A-Za-z]{3}$/.test(String(e.currency))) out.currency = String(e.currency).toUpperCase();
      out.id = e.id ? String(e.id) : ('ce-' + e.kind + '-' + category + '-' + symbol.toLowerCase() + '-' + e.date);
      byKey[category + '|' + symbol.toLowerCase() + '|' + e.date + '|' + e.kind] = out;
    });
    var events = Object.keys(byKey).map(function (k) { return byKey[k]; });
    events.sort(sortActions);
    return { version: SCHEMA, events: events };
  }

  function pidOf(tx) { return String(tx.portfolioId || 'default'); }
  function before(tx, date) { return !!(tx.date && String(tx.date).slice(0, 10) < date); }
  function isTrade(tx) { return !!tx && (tx.type === 'buy' || tx.type === 'sell'); }

  function applySplit(rows, a) {
    return rows.map(function (tx) {
      if (!isTrade(tx) || !sameAsset(tx, a) || !before(tx, a.date)) return tx;
      var f = a.num / a.den, next = Object.assign({}, tx);
      var q = parseFloat(tx.quantity), p = parseFloat(tx.price);
      if (isFinite(q)) next.quantity = q * f;
      if (isFinite(p)) next.price = p / f;
      return next;
    });
  }

  function renamed(tx, ev) {
    return Object.assign({}, tx, { symbol: ev.newSymbol, symbolName: ev.newName || tx.symbolName || '',
      caOrigSymbol: tx.caOrigSymbol || tx.symbol });
  }

  function applyRename(rows, ev) {
    return rows.map(function (tx) {
      if (!tx || !sameAsset(tx, ev) || !before(tx, ev.date)) return tx;
      return renamed(tx, ev);
    });
  }

  function applyMerger(rows, ev) {
    var f = ev.num / ev.den, held = {}, first = {}, booked = {};
    rows.forEach(function (tx) {
      if (tx && tx.caEventId === ev.id) booked[pidOf(tx)] = true;
    });
    var out = rows.map(function (tx) {
      if (!isTrade(tx) || !sameAsset(tx, ev) || !before(tx, ev.date)) return tx;
      var pid = pidOf(tx), q = parseFloat(tx.quantity) || 0;
      held[pid] = (held[pid] || 0) + (tx.type === 'buy' ? q : -q);
      if (!first[pid]) first[pid] = tx;
      var next = renamed(tx, ev), p = parseFloat(tx.price);
      next.quantity = q * f;
      if (isFinite(p)) next.price = p / f;
      return next;
    });
    if (ev.cashPerShare > 0) {
      Object.keys(held).forEach(function (pid) {
        if (!(held[pid] > 1e-9) || booked[pid]) return;
        var src = first[pid];
        out.push({ id: ev.id + '-cash-' + pid, type: 'dividend', category: ev.category, symbol: ev.newSymbol,
          symbolName: ev.newName || '', quantity: held[pid], price: ev.cashPerShare, fees: 0,
          currency: ev.currency || src.currency || 'EUR', date: ev.date, portfolioId: src.portfolioId,
          source: 'corporate-action', caEventId: ev.id, auto: true, notes: __('ceMergerCashNote', 'Cash from the merger') });
      });
    }
    return out;
  }

  // FIFO per portfolio over the parent's trades before the date -> the open
  // quantity of each buy row (the ledger's order: date, buys before sells).
  function openPerBuy(rows, ev) {
    var byPid = {};
    rows.forEach(function (tx, i) {
      if (!isTrade(tx) || !sameAsset(tx, ev) || !before(tx, ev.date)) return;
      (byPid[pidOf(tx)] = byPid[pidOf(tx)] || []).push({ tx: tx, i: i });
    });
    var open = {};
    Object.keys(byPid).forEach(function (pid) {
      var list = byPid[pid].slice().sort(function (a, b) {
        var da = String(a.tx.date), db = String(b.tx.date);
        if (da !== db) return da < db ? -1 : 1;
        if (a.tx.type !== b.tx.type) return a.tx.type === 'buy' ? -1 : 1;
        return a.i - b.i;
      });
      var queue = [];
      list.forEach(function (x) {
        var q = parseFloat(x.tx.quantity) || 0;
        if (x.tx.type === 'buy') { var lot = { i: x.i, left: q }; queue.push(lot); open[x.i] = lot; return; }
        while (q > 1e-12 && queue.length) {
          var head = queue[0], used = Math.min(head.left, q);
          head.left -= used; q -= used;
          if (head.left <= 1e-12) queue.shift();
        }
      });
    });
    return open;
  }

  function applySpinoff(rows, ev) {
    if (rows.some(function (tx) { return tx && tx.caEventId === ev.id; })) return rows; // applied already
    var open = openPerBuy(rows, ev), f = ev.num / ev.den, cs = ev.costShare, out = [];
    rows.forEach(function (tx, i) {
      var lot = open[i];
      if (!lot || !(lot.left > 1e-12)) { out.push(tx); return; }
      var q = parseFloat(tx.quantity) || 0, p = parseFloat(tx.price) || 0, fees = parseFloat(tx.fees) || 0;
      var left = lot.left, sold = q - left;
      var openFees = q > 0 ? fees * left / q : 0;
      if (sold > 1e-12) out.push(Object.assign({}, tx, { id: String(tx.id) + '~sold', quantity: sold, fees: fees - openFees }));
      out.push(Object.assign({}, tx, { quantity: left, price: p * (1 - cs), fees: openFees * (1 - cs) }));
      var childQty = left * f;
      if (childQty > 1e-12) out.push({ id: String(tx.id) + '~' + ev.id, type: 'buy', category: ev.category, symbol: ev.newSymbol,
        symbolName: ev.newName || '', quantity: childQty, price: (left * p + openFees) * cs / childQty, fees: 0,
        currency: tx.currency, date: tx.date, portfolioId: tx.portfolioId, source: 'corporate-action', caEventId: ev.id, auto: true });
    });
    return out;
  }

  function applyEvent(rows, ev) {
    if (ev.kind === 'merger') return applyMerger(rows, ev);
    if (ev.kind === 'spinoff') return applySpinoff(rows, ev);
    return applyRename(rows, ev);
  }

  // PURE. Returns a NEW transactions array (never mutates the input) where, for
  // each stored split, every buy/sell tx of the matching (category, symbol) with
  // date STRICTLY BEFORE the split date has its quantity and price scaled by the
  // invariant above. Multiple splits on one symbol compound in date order. When
  // there are no actions, the INPUT ARRAY is returned unchanged (identity) so
  // there is zero behaviour change until a user records a split. `state` is
  // optional (defaults to load()) so the function stays pure/testable.
  function adjust(transactions, state, eventState) {
    if (!Array.isArray(transactions)) return transactions;
    var st = state === undefined ? load() : normalize(state);
    var ev = eventState === undefined ? loadEvents() : normalizeEvents(eventState);
    if (ev.events.length) {
      // P5-3.10: splits and further actions together, in date order (a split
      // before an event of the same day)
      var steps = st.actions.map(function (a) { return { date: a.date, rank: 0, split: a }; })
        .concat(ev.events.map(function (e) { return { date: e.date, rank: 1, ev: e }; }));
      steps.sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.rank - b.rank; });
      var rows = transactions;
      steps.forEach(function (s) { rows = s.split ? applySplit(rows, s.split) : applyEvent(rows, s.ev); });
      return rows;
    }
    if (!st.actions.length) return transactions; // identity — no-op fast path

    return transactions.map(function (tx) {
      if (!tx || (tx.type !== 'buy' && tx.type !== 'sell')) return tx;
      var qty = parseFloat(tx.quantity);
      var price = parseFloat(tx.price);
      var factor = 1; // net quantity multiplier from every split after this tx
      st.actions.forEach(function (action) {
        if (!sameAsset(tx, action)) return;
        if (!(tx.date && tx.date < action.date)) return; // strictly before
        factor *= (action.num / action.den);
      });
      if (factor === 1) return tx; // untouched — no split applies to this lot
      var next = Object.assign({}, tx);
      if (isFinite(qty)) next.quantity = qty * factor;
      if (isFinite(price)) next.price = price / factor; // cash amount qty*price held constant
      return next;
    });
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }

  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, actions: [] };
    try { return normalize(s.getItem(STORAGE_KEY)); }
    catch (e) { return { version: SCHEMA, actions: [] }; }
  }

  function save(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; }
    catch (e) { return false; }
  }

  // Record (or overwrite the same (symbol, date)) one split and persist. Returns
  // the saved state. `entry`: { category, symbol, date, num, den, source?, note? }.
  function record(entry) {
    var st = load();
    st.actions.push(entry || {});
    var next = normalize(st);
    save(next);
    return next;
  }

  // Remove one action by id (or by (category, symbol, date)) and persist.
  function remove(idOrMatch) {
    var st = load();
    st.actions = st.actions.filter(function (a) {
      if (typeof idOrMatch === 'string') return a.id !== idOrMatch;
      if (idOrMatch && typeof idOrMatch === 'object') {
        return !(a.category === idOrMatch.category &&
          String(a.symbol).toLowerCase() === String(idOrMatch.symbol).toLowerCase() &&
          a.date === idOrMatch.date);
      }
      return true;
    });
    save(st);
    return st;
  }

  // ---- further actions: storage ------------------------------------------------
  function loadEvents() {
    var s = store();
    if (!s) return { version: SCHEMA, events: [] };
    try { return normalizeEvents(s.getItem(EVENTS_KEY)); }
    catch (e) { return { version: SCHEMA, events: [] }; }
  }
  function saveEvents(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(EVENTS_KEY, JSON.stringify(normalizeEvents(state))); return true; }
    catch (e) { return false; }
  }
  function recordEvent(entry) {
    var st = loadEvents();
    st.events.push(entry || {});
    var next = normalizeEvents(st);
    saveEvents(next);
    return next;
  }
  function removeEvent(id) {
    var st = loadEvents();
    st.events = st.events.filter(function (e) { return e.id !== id; });
    saveEvents(st);
    return st;
  }
  // The events touching one holding, as the old or the new symbol.
  function eventsFor(category, symbol, state) {
    var st = state === undefined ? loadEvents() : normalizeEvents(state);
    if (!category && !symbol) return st.events.slice();
    var s = String(symbol || '').toLowerCase();
    return st.events.filter(function (e) {
      return e.category === category && (e.symbol.toLowerCase() === s || e.newSymbol.toLowerCase() === s);
    });
  }

  // One line for a list: "FB -> META (symbol change)".
  function fmtNum(v) { var I = (typeof window !== 'undefined') && window.MaerminI18n; return I && I.num ? I.num(v, { min: 0, max: 6 }) : String(v); }
  function kindLabel(kind) {
    return ({ symbol_change: __('ceKindSymbol', 'Symbol change'), isin_change: __('ceKindIsin', 'ISIN change'),
      merger: __('ceKindMerger', 'Merger (share exchange)'), spinoff: __('ceKindSpinoff', 'Spin-off') })[kind] || kind;
  }
  function describeEvent(e) {
    if (!e) return '';
    if (e.kind === 'merger') return __('ceDescMerger', '{old} -> {new}: {num} new for {den} old', { old: e.symbol, 'new': e.newSymbol, num: fmtNum(e.num), den: fmtNum(e.den) })
      + (e.cashPerShare > 0 ? ' · ' + __('ceDescCash', '{cash} cash per old share', { cash: fmtNum(e.cashPerShare) }) : '');
    if (e.kind === 'spinoff') return __('ceDescSpinoff', '{old} spins off {new}: {num} for {den}, {pct} % of the cost', { old: e.symbol, 'new': e.newSymbol, num: fmtNum(e.num), den: fmtNum(e.den), pct: fmtNum(Math.round(e.costShare * 10000) / 100) });
    return e.symbol + ' -> ' + e.newSymbol + ' (' + kindLabel(e.kind) + ')';
  }

  // Further actions of one holding, in the position detail (under the splits).
  // props: { category, symbol, theme }
  function EventsPanel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React || !props.symbol) return null;
    var e = React.createElement, th = props.theme || {};
    var revS = React.useState(0), rev = revS[0], setRev = revS[1];
    var fS = React.useState({ kind: 'symbol_change', date: '', newSymbol: '', newName: '', num: '1', den: '1', cash: '', pct: '' }), form = fS[0], setForm = fS[1];
    var mS = React.useState(''), msg = mS[0], setMsg = mS[1];
    var cat = props.category || 'stocks';
    var list = React.useMemo(function () { return eventsFor(cat, props.symbol); }, [cat, props.symbol, rev]);
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var input = { width: '100%', boxSizing: 'border-box', padding: '0.45rem 0.6rem', background: th.inputBg, border: '1px solid ' + (th.inputBorder || border), borderRadius: '8px', color: text, fontSize: '0.82rem', fontFamily: 'inherit' };
    var label = { display: 'block', color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' };
    var set = function (k) { return function (ev) { var o = Object.assign({}, form); o[k] = ev.target.value; setForm(o); }; };
    var field = function (k, lbl, attrs) {
      return e('div', { key: k }, e('label', { style: label }, lbl), e('input', Object.assign({ value: form[k], onChange: set(k), style: input, 'aria-label': lbl, 'data-testid': 'ce-' + k }, attrs || {})));
    };
    var ratio = form.kind === 'merger' || form.kind === 'spinoff';
    var add = function () {
      var entry = { kind: form.kind, category: cat, symbol: props.symbol, date: form.date, newSymbol: String(form.newSymbol || '').trim().toUpperCase(), newName: form.newName };
      if (ratio) { entry.num = form.num; entry.den = form.den; }
      if (form.kind === 'merger') entry.cashPerShare = form.cash;
      if (form.kind === 'spinoff') entry.costSharePct = form.pct;
      if (!normalizeEvents({ events: [entry] }).events.length) { setMsg(__('ceInvalid', 'Fill in the date, the new symbol (different from the old one) and, for a merger or spin-off, the ratio; a spin-off also needs the cost share (0-100 %).')); return; }
      recordEvent(entry);
      setMsg(''); setForm({ kind: form.kind, date: '', newSymbol: '', newName: '', num: '1', den: '1', cash: '', pct: '' });
      setRev(rev + 1);
      if (props.onChange) props.onChange();
    };
    var remove = function (ev) {
      var ask = (window.MaerminUI && window.MaerminUI.confirm)
        ? window.MaerminUI.confirm({ title: __('ceRemoveTitle', 'Remove this corporate action?'), message: describeEvent(ev), confirmLabel: __('caRemove', 'Remove'), danger: true })
        : Promise.resolve(true);
      ask.then(function (yes) { if (!yes) return; removeEvent(ev.id); setRev(rev + 1); if (props.onChange) props.onChange(); });
    };
    return e('div', { 'data-testid': 'ce-panel', style: { padding: '1.25rem 1.5rem', borderTop: '1px solid ' + (th.modalBorder || border) } },
      e('div', { style: { color: text, fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.75rem' } }, __('ceTitle', 'Other corporate actions')),
      list.length ? e('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', marginBottom: '0.75rem' } }, list.map(function (ev) {
        return e('div', { key: ev.id, 'data-testid': 'ce-row', style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.6rem', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid ' + border, fontSize: '0.82rem' } },
          e('span', { style: { color: dim } }, ev.date),
          e('span', { style: { color: text, fontWeight: 600 } }, describeEvent(ev)),
          e('button', { type: 'button', onClick: function () { remove(ev); }, 'aria-label': __('caRemove', 'Remove') + ' ' + ev.date,
            style: { background: 'transparent', border: 'none', color: th.danger || 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' } }, __('caRemove', 'Remove')));
      })) : e('div', { style: { color: dim, fontSize: '0.8rem', marginBottom: '0.75rem' } }, __('ceNone', 'No symbol or ISIN change, merger or spin-off recorded.')),
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', alignItems: 'end' } },
        e('div', null, e('label', { style: label }, __('ceKind', 'Kind')),
          e('select', { value: form.kind, onChange: set('kind'), style: input, 'aria-label': __('ceKind', 'Kind'), 'data-testid': 'ce-kind' },
            ['symbol_change', 'isin_change', 'merger', 'spinoff'].map(function (k) { return e('option', { key: k, value: k }, kindLabel(k)); }))),
        field('date', __('caDate', 'Date'), { type: 'date' }),
        field('newSymbol', form.kind === 'isin_change' ? __('ceNewIsin', 'New ISIN') : form.kind === 'spinoff' ? __('ceChildSymbol', 'New company symbol') : __('ceNewSymbol', 'New symbol'), { type: 'text' }),
        field('newName', __('ceNewName', 'Name (optional)'), { type: 'text' }),
        ratio && field('num', form.kind === 'spinoff' ? __('ceSpinNum', 'New shares') : __('ceMergeNum', 'New shares'), { type: 'text', inputMode: 'decimal' }),
        ratio && field('den', form.kind === 'spinoff' ? __('ceSpinDen', 'per held shares') : __('ceMergeDen', 'per old shares'), { type: 'text', inputMode: 'decimal' }),
        form.kind === 'merger' && field('cash', __('ceCash', 'Cash per old share (optional)'), { type: 'text', inputMode: 'decimal' }),
        form.kind === 'spinoff' && field('pct', __('ceCostPct', 'Share of the cost, %'), { type: 'text', inputMode: 'decimal' }),
        e('button', { type: 'button', onClick: add, 'data-testid': 'ce-add', style: { padding: '0.5rem 0.8rem', background: th.accentFill || th.accent || '#3b82f6', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' } },
          __('ceAdd', 'Add action'))),
      msg && e('div', { style: { color: th.warning || 'var(--warning)', fontSize: '0.76rem', marginTop: '0.5rem' } }, msg),
      e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.5rem', lineHeight: 1.5 } },
        form.kind === 'merger' ? __('ceHintMerger', 'Your shares before the date become shares of the new company; cost and purchase dates carry over (tax-neutral exchange). A cash part is booked as capital income on the date.')
          : form.kind === 'spinoff' ? __('ceHintSpinoff', 'Shares of the new company are added with the purchase dates of your shares and the given share of their cost (it is on your bank\'s statement); your shares keep the rest.')
          : __('ceHintRename', 'All bookings before the date move to the new symbol; quantities, cost and dates stay.')));
  }

  // List the stored actions, optionally filtered to one (category, symbol).
  function listFor(category, symbol, state) {
    var st = state === undefined ? load() : normalize(state);
    if (!category && !symbol) return st.actions.slice();
    return st.actions.filter(function (a) {
      return a.category === category &&
        String(a.symbol).toLowerCase() === String(symbol || '').toLowerCase();
    });
  }

  // Best-effort split detection for one holding via the Worker `?action=yf`
  // endpoint. `fetchJson(url)` must resolve to the parsed JSON (the caller wires
  // in the app's worker-base + fetch). DEGRADES GRACEFULLY: a Worker that
  // predates the split payload has no `splits` field — we return [] so the UI
  // simply falls back to manual entry. Detection is best-effort and never
  // required; the engine is fully usable with manual entry offline.
  function detectForSymbol(symbol, category, sinceDate, fetchJson, opts) {
    opts = opts || {};
    if (typeof fetchJson !== 'function' || !symbol) return Promise.resolve([]);
    var range = opts.range || '10y';
    var base = opts.workerBase || '';
    var url = base + (base.indexOf('?') > -1 ? '&' : '?') +
      'action=yf&symbol=' + encodeURIComponent(symbol) +
      '&interval=1d&range=' + encodeURIComponent(range);
    return Promise.resolve(fetchJson(url)).then(function (data) {
      var splits = data && Array.isArray(data.splits) ? data.splits : [];
      var out = [];
      splits.forEach(function (ev) {
        if (!ev || !isISODate(ev.date)) return;
        if (sinceDate && ev.date < sinceDate) return;
        var r = ratioFromYahoo(ev);
        if (!r) return;
        out.push({
          kind: 'split',
          category: category || 'stocks',
          symbol: symbol,
          date: ev.date,
          num: r.num,
          den: r.den,
          source: 'auto',
          note: ''
        });
      });
      out.sort(sortActions);
      return out;
    }).catch(function () { return []; }); // network/old-worker -> manual entry
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA: SCHEMA,
    normalize: normalize,
    adjust: adjust,
    ratioFromYahoo: ratioFromYahoo,
    load: load,
    save: save,
    record: record,
    remove: remove,
    listFor: listFor,
    detectForSymbol: detectForSymbol,
    EVENTS_KEY: EVENTS_KEY,
    normalizeEvents: normalizeEvents,
    loadEvents: loadEvents,
    saveEvents: saveEvents,
    recordEvent: recordEvent,
    removeEvent: removeEvent,
    eventsFor: eventsFor,
    describeEvent: describeEvent,
    EventsPanel: EventsPanel
  };

  if (typeof window !== 'undefined') window.MaerminCorporateActions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
