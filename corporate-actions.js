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
//   // future: spinoff/merger, symbol/ISIN change, special-dividend basis
//   //         adjustment — out of scope for v1; the {kind} field reserves room.
//
// Pure math (normalize / adjust / ratioFromYahoo) is split from the
// localStorage helpers (load / save / record / remove) so the engine is
// unit-tested headlessly in Node (test/corporate-actions.test.js).
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'maermin_corporate_actions';
  var SCHEMA = 1;

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

  // PURE. Returns a NEW transactions array (never mutates the input) where, for
  // each stored split, every buy/sell tx of the matching (category, symbol) with
  // date STRICTLY BEFORE the split date has its quantity and price scaled by the
  // invariant above. Multiple splits on one symbol compound in date order. When
  // there are no actions, the INPUT ARRAY is returned unchanged (identity) so
  // there is zero behaviour change until a user records a split. `state` is
  // optional (defaults to load()) so the function stays pure/testable.
  function adjust(transactions, state) {
    if (!Array.isArray(transactions)) return transactions;
    var st = state === undefined ? load() : normalize(state);
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
    detectForSymbol: detectForSymbol
  };

  if (typeof window !== 'undefined') window.MaerminCorporateActions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
