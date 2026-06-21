// ============================================================================
// MAERMIN v10.0 — Smart Tags / Labels  (window.MaerminTags)
// ----------------------------------------------------------------------------
// New in v10. User-defined, cross-cutting labels on symbols — orthogonal to the
// built-in asset categories (crypto / stocks / skins …). A position can carry
// any number of tags ("high-conviction", "dividend", "speculative", "ESG", …),
// letting the user slice the portfolio by their OWN thesis instead of only by
// asset class.
//
// Tags are stored once and reference symbols, so re-buying or splitting a lot
// never loses the label. Carried in the full-vault backup (key 'maermin_tags').
//
// Pure data layer (no UI). Storage shape:
//
//   { version: 1, tags: { '<name>': { color: '<#hex>', symbols: ['BTC', …] } } }
//
// Names are case-insensitively unique and trimmed. `aggregate()` is pure and
// takes the caller's already-priced positions, so this module never needs the
// metrics engine. Unit-tested in test/tags.test.js.
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'maermin_tags';
  var SCHEMA = 1;
  // A small default palette so new tags get a stable, distinct colour.
  var PALETTE = ['#f5a524', '#22c55e', '#3b82f6', '#a855f7', '#ef4444',
                 '#14b8a6', '#ec4899', '#eab308', '#6366f1', '#f97316'];

  function normName(name) { return String(name == null ? '' : name).trim(); }
  function keyOf(name) { return normName(name).toLowerCase(); }
  function normSym(sym) { return String(sym == null ? '' : sym).trim().toUpperCase(); }

  function isHexColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c); }

  // Coerce stored / foreign data into a clean {version, tags{}} object. Drops
  // empty names, dedups symbols, and rejects non-string colours.
  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var src = (obj.tags && typeof obj.tags === 'object') ? obj.tags : {};
    var tags = {};
    Object.keys(src).forEach(function (name) {
      var clean = normName(name);
      if (!clean) return;
      var entry = src[name] || {};
      var symbols = Array.isArray(entry.symbols) ? entry.symbols : [];
      var seen = {}, list = [];
      symbols.forEach(function (s) {
        var sym = normSym(s);
        if (sym && !seen[sym]) { seen[sym] = 1; list.push(sym); }
      });
      tags[clean] = {
        color: isHexColor(entry.color) ? entry.color : pickColor(clean),
        symbols: list
      };
    });
    return { version: SCHEMA, tags: tags };
  }

  // Deterministic colour from the name so an un-coloured tag is stable.
  function pickColor(name) {
    var h = 0, k = keyOf(name);
    for (var i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // Find the stored name matching `name` case-insensitively (or null).
  function findName(state, name) {
    var target = keyOf(name);
    var hit = null;
    Object.keys(state.tags).forEach(function (n) { if (keyOf(n) === target) hit = n; });
    return hit;
  }

  function listTags(state) {
    state = normalize(state);
    return Object.keys(state.tags).sort(function (a, b) {
      return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
    }).map(function (name) {
      return { name: name, color: state.tags[name].color, symbols: state.tags[name].symbols.slice() };
    });
  }

  function tagsForSymbol(state, symbol) {
    state = normalize(state);
    var sym = normSym(symbol);
    return Object.keys(state.tags).filter(function (n) {
      return state.tags[n].symbols.indexOf(sym) !== -1;
    }).sort();
  }

  function addTag(state, name, opts) {
    state = normalize(state);
    opts = opts || {};
    var clean = normName(name);
    if (!clean) return state;
    var existing = findName(state, clean);
    var color = isHexColor(opts.color) ? opts.color : (existing ? state.tags[existing].color : pickColor(clean));
    if (existing) { state.tags[existing].color = color; return state; }
    state.tags[clean] = { color: color, symbols: [] };
    return state;
  }

  function removeTag(state, name) {
    state = normalize(state);
    var hit = findName(state, name);
    if (hit) delete state.tags[hit];
    return state;
  }

  function renameTag(state, oldName, newName) {
    state = normalize(state);
    var hit = findName(state, oldName);
    var clean = normName(newName);
    if (!hit || !clean) return state;
    if (keyOf(oldName) !== keyOf(clean) && findName(state, clean)) return state; // collision
    var entry = state.tags[hit];
    delete state.tags[hit];
    state.tags[clean] = entry;
    return state;
  }

  function assign(state, name, symbol) {
    state = normalize(state);
    var clean = normName(name), sym = normSym(symbol);
    if (!clean || !sym) return state;
    var hit = findName(state, clean) || clean;
    if (!state.tags[hit]) state.tags[hit] = { color: pickColor(clean), symbols: [] };
    if (state.tags[hit].symbols.indexOf(sym) === -1) state.tags[hit].symbols.push(sym);
    return state;
  }

  function unassign(state, name, symbol) {
    state = normalize(state);
    var hit = findName(state, name), sym = normSym(symbol);
    if (!hit) return state;
    state.tags[hit].symbols = state.tags[hit].symbols.filter(function (s) { return s !== sym; });
    return state;
  }

  // Per-tag value/weight rollup. `positions` is the caller's priced list:
  //   [{ symbol, valueEUR }]  — anything with a numeric value works.
  // Returns rows sorted by value desc; `weightPct` is share of the TOTAL of all
  // supplied positions (not just tagged ones), so untagged value is visible.
  function aggregate(state, positions) {
    state = normalize(state);
    positions = Array.isArray(positions) ? positions : [];
    var total = 0;
    var bySym = {};
    positions.forEach(function (p) {
      var sym = normSym(p && p.symbol);
      var v = p && (typeof p.valueEUR === 'number' ? p.valueEUR : parseFloat(p.valueEUR));
      if (!sym || !isFinite(v)) return;
      bySym[sym] = (bySym[sym] || 0) + v;
      total += v;
    });
    var rows = Object.keys(state.tags).map(function (name) {
      var t = state.tags[name];
      var value = 0, count = 0;
      t.symbols.forEach(function (sym) { if (bySym[sym] != null) { value += bySym[sym]; count++; } });
      return {
        name: name, color: t.color, symbols: t.symbols.slice(),
        value: value, matched: count,
        weightPct: total > 0 ? (value / total) * 100 : 0
      };
    });
    rows.sort(function (a, b) { return b.value - a.value; });
    return { total: total, rows: rows };
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }

  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, tags: {} };
    try { return normalize(s.getItem(STORAGE_KEY)); }
    catch (e) { return { version: SCHEMA, tags: {} }; }
  }

  function save(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; }
    catch (e) { return false; }
  }

  // ---- positions helpers ----------------------------------------------------
  // The single price-lookup the tag/rules views share: priced positions per
  // (category, symbol) → [{ symbol, category, valueEUR }] from a flat tx list.
  function pricedPositions(transactions, prices) {
    var posMap = {};
    (Array.isArray(transactions) ? transactions : []).forEach(function (tx) {
      var symU = normSym(tx && tx.symbol);
      if (!symU) return;
      var cat = tx.category || 'crypto';
      var key = cat + '-' + symU;
      if (!posMap[key]) posMap[key] = { symbol: symU, category: cat, amount: 0 };
      var qty = parseFloat(tx.quantity) || 0;
      if (tx.type === 'buy') posMap[key].amount += qty;
      else if (tx.type === 'sell') posMap[key].amount = Math.max(0, posMap[key].amount - qty);
    });
    prices = prices || {};
    var out = [];
    Object.keys(posMap).forEach(function (k) {
      var p = posMap[k];
      if (p.amount <= 0.0001) return;
      var s = p.symbol;
      var pr = prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || 0;
      out.push({ symbol: s, category: p.category, valueEUR: p.amount * pr });
    });
    return out;
  }

  // Symbol-aggregated [{symbol, valueEUR}] (a symbol can span categories) — the
  // shape tag aggregation weights by.
  function positionsFromInputs(transactions, prices) {
    var bySym = {};
    pricedPositions(transactions, prices).forEach(function (p) {
      bySym[p.symbol] = (bySym[p.symbol] || 0) + p.valueEUR;
    });
    return Object.keys(bySym).map(function (s) { return { symbol: s, valueEUR: bySym[s] }; });
  }

  // ---- React view (rendered via React.createElement from renderer.js) -------
  function View(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var useState = React.useState;
    var theme = props.theme || {};
    var t = props.t || {};
    var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
    var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
    var card = theme.card || '#10151f';
    var inputBg = theme.inputBg || '#0c1018', inputBorder = theme.inputBorder || border;
    var accent = theme.accent || '#f5a524', accentText = theme.accentText || '#13110a';
    var up = theme.success || '#22c55e', down = theme.danger || '#ef4444';
    var fmt = props.formatPrice || function (n) { return (Math.round(n * 100) / 100).toLocaleString(); };
    var sym = props.getCurrencySymbol ? props.getCurrencySymbol() : '€';

    var st0 = useState(function () { return load(); });
    var st = st0[0], setSt = st0[1];
    var nn = useState(''); var newName = nn[0], setNewName = nn[1];

    var Reb = (typeof window !== 'undefined') ? window.MaerminRebalance : null;
    var tg0 = useState(function () { return Reb ? Reb.setBasis(Reb.load(), 'tag') : null; });
    var tgt = tg0[0], setTgt = tg0[1];

    function mutate(next) { save(next); setSt(normalize(next)); }
    function setTarget(name, pct) {
      if (!Reb) return;
      var next = Reb.setBasis(Reb.setTarget(tgt, name, pct), 'tag');
      Reb.save(next); setTgt(next);
    }

    var positions = positionsFromInputs(props.transactions, props.prices);
    var holdingSymbols = positions.map(function (p) { return p.symbol; }).sort();
    var agg = aggregate(st, positions);
    var aggByName = {};
    agg.rows.forEach(function (r) { aggByName[r.name] = r; });

    // C3: per-tag performance over time, derived from the 'tag:<name>' snapshot
    // series (recorded by the renderer). Loaded once here, not per tag.
    var Snap = (typeof window !== 'undefined') ? window.MaerminSnapshots : null;
    var Perf = (typeof window !== 'undefined') ? window.MaerminPerformance : null;
    var snapState = Snap ? Snap.load() : null;
    function tagPerf(name) {
      if (!Snap || !Perf || !snapState) return null;
      try {
        var ser = Snap.seriesFor(snapState, 'tag:' + name);
        if (ser.length < 2) return null;
        return Perf.computePeriod(ser.map(function (p) { return { d: p.d, v: p.v }; }), '1M');
      } catch (e) { return null; }
    }

    function dot(color) { return e('span', { 'aria-hidden': 'true', style: { display: 'inline-block', width: '0.7rem', height: '0.7rem', borderRadius: '50%', background: color, flexShrink: 0 } }); }
    function btn(label, onClick, kind) {
      var solid = kind === 'solid';
      return e('button', {
        onClick: onClick,
        style: {
          padding: '0.35rem 0.7rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
          borderRadius: '8px', border: '1px solid ' + (solid ? accent : inputBorder),
          background: solid ? accent : 'transparent', color: solid ? accentText : text
        }
      }, label);
    }

    var tagCards = listTags(st).map(function (tag) {
      var row = aggByName[tag.name] || { value: 0, weightPct: 0, matched: 0 };
      var untagged = holdingSymbols.filter(function (s) { return tag.symbols.indexOf(s) === -1; });
      var targetPct = (Reb && tgt && tgt.targets[tag.name]) || 0;
      var driftPp = row.weightPct - targetPct;
      var deltaVal = (targetPct - row.weightPct) / 100 * agg.total;

      var chips = tag.symbols.map(function (s) {
        return e('button', {
          key: s,
          type: 'button',
          title: t.tagsUnassign || 'Click to remove',
          'aria-label': (t.tagsRemoveSymbol || 'Remove') + ' ' + s,
          onClick: function () { mutate(unassign(st, tag.name, s)); },
          style: { font: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.55rem', borderRadius: '999px', border: '1px solid ' + border, background: 'rgba(255,255,255,0.03)', color: text, fontSize: '0.78rem' }
        }, s, e('span', { 'aria-hidden': 'true', style: { color: dim } }, '×'));
      });

      var addSelect = untagged.length ? e('select', {
        value: '',
        onChange: function (ev) { if (ev.target.value) mutate(assign(st, tag.name, ev.target.value)); },
        style: { padding: '0.2rem 0.4rem', borderRadius: '8px', border: '1px solid ' + inputBorder, background: inputBg, color: text, fontSize: '0.78rem' }
      },
        [e('option', { key: '_', value: '' }, t.tagsAddSymbol || '+ symbol')].concat(
          untagged.map(function (s) { return e('option', { key: s, value: s }, s); }))) : null;

      return e('div', {
        key: tag.name,
        style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem', marginBottom: '0.75rem' }
      },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem', flexWrap: 'wrap' } },
          dot(tag.color),
          e('span', { style: { color: text, fontWeight: 800, fontSize: '0.95rem' } }, tag.name),
          e('span', { style: { color: dim, fontSize: '0.78rem' } }, fmt(row.value) + ' ' + sym + ' · ' + row.weightPct.toFixed(1) + '%'),
          (function () {
            var perf = tagPerf(tag.name);
            return (perf && perf.pct != null)
              ? e('span', { title: (perf.partial ? (t.tagsSinceStart || 'since first record') : '30d'), style: { color: perf.pct >= 0 ? up : down, fontSize: '0.74rem', fontWeight: 700 } },
                  (perf.pct >= 0 ? '+' : '') + perf.pct.toFixed(1) + '% · ' + (perf.partial ? '∗' : '30d'))
              : null;
          })(),
          e('span', { style: { flex: 1 } }),
          Reb ? e('label', { style: { color: dim, fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' } },
            (t.tagsTarget || 'Target'),
            e('input', {
              type: 'number', min: 0, max: 100, value: targetPct || '',
              onChange: function (ev) { setTarget(tag.name, ev.target.value); },
              placeholder: '0', style: { width: '56px', padding: '0.2rem 0.35rem', borderRadius: '6px', border: '1px solid ' + inputBorder, background: inputBg, color: text, fontSize: '0.78rem' }
            }), '%') : null,
          btn(t.tagsDelete || 'Delete', function () { mutate(removeTag(st, tag.name)); })),
        e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' } },
          chips.length ? chips : e('span', { style: { color: dim, fontSize: '0.78rem' } }, t.tagsNoSymbols || 'No symbols yet'),
          addSelect),
        (Reb && targetPct > 0) ? e('div', { style: { marginTop: '0.6rem', fontSize: '0.78rem', color: Math.abs(driftPp) < 0.05 ? dim : (driftPp > 0 ? down : up) } },
          (Math.abs(driftPp) < 0.05
            ? (t.tagsOnTarget || 'On target')
            : (driftPp > 0
              ? (t.tagsOverweight || 'Overweight') + ' ' + driftPp.toFixed(1) + 'pp → ' + (t.tagsSell || 'sell') + ' ' + fmt(Math.abs(deltaVal)) + ' ' + sym
              : (t.tagsUnderweight || 'Underweight') + ' ' + Math.abs(driftPp).toFixed(1) + 'pp → ' + (t.tagsBuy || 'buy') + ' ' + fmt(Math.abs(deltaVal)) + ' ' + sym))) : null);
    });

    return e('div', { style: { padding: '1.5rem' } },
      e('h2', { style: { color: text, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 0.35rem' } }, t.navTags || 'Tags'),
      e('p', { style: { color: dim, fontSize: '0.88rem', margin: '0 0 1.25rem', lineHeight: 1.5, maxWidth: '60ch' } },
        t.tagsSubtitle || 'Cross-cutting labels on your holdings — group by your own thesis (high-conviction, income, speculative…), see value & weight per tag, and optionally set target weights.'),

      e('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' } },
        e('input', {
          value: newName, onChange: function (ev) { setNewName(ev.target.value); },
          onKeyDown: function (ev) { if (ev.key === 'Enter' && newName.trim()) { mutate(addTag(st, newName)); setNewName(''); } },
          placeholder: t.tagsNewPlaceholder || 'New tag name…',
          style: { flex: 1, minWidth: '180px', maxWidth: '320px', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid ' + inputBorder, background: inputBg, color: text, fontSize: '0.85rem' }
        }),
        btn(t.tagsAdd || 'Add tag', function () { if (newName.trim()) { mutate(addTag(st, newName)); setNewName(''); } }, 'solid')),

      tagCards.length ? tagCards : e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '2rem', textAlign: 'center', color: dim, fontSize: '0.9rem' } },
        t.tagsEmpty || 'No tags yet. Create one above, then assign holdings to it.'),

      agg.total > 0 ? e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '1rem', lineHeight: 1.5 } },
        (t.tagsFootnote || 'Weights are share of total holdings value (untagged value is included in the base). Tags carry into your backup.')) : null);
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA: SCHEMA,
    PALETTE: PALETTE,
    pricedPositions: pricedPositions,
    positionsFromInputs: positionsFromInputs,
    View: View,
    pickColor: pickColor,
    normalize: normalize,
    listTags: listTags,
    tagsForSymbol: tagsForSymbol,
    addTag: addTag,
    removeTag: removeTag,
    renameTag: renameTag,
    assign: assign,
    unassign: unassign,
    aggregate: aggregate,
    load: load,
    save: save
  };

  if (typeof window !== 'undefined') window.MaerminTags = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
