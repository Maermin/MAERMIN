// ============================================================================
// MAERMIN v10.x — Custom Asset Categories  (window.MaerminCategories)
// ----------------------------------------------------------------------------
// Roadmap feature #3. Lets users define asset categories beyond the four
// built-ins (crypto / stocks / skins / commodities) — e.g. "Real Estate", "P2P
// Loans", "Collectibles" — each with a label and colour. A transaction stores
// the category id (a slug) like any built-in, so a custom-category position is
// priced and totalled exactly like the rest.
//
// SAFETY: the shared aggregation engine (metrics.js) used to DROP any category
// it did not recognise. This module is the registry it consults so custom
// categories are kept (valued + totalled). Some by-asset-class analytics
// (rebalancing-by-class, currency-by-class) still cover the four base classes
// only — custom value shows in totals, the Categories view and Tags. Carried in
// the full-vault backup (key 'maermin_custom_categories').
//
// Pure data layer + a small management View. Storage shape:
//
//   { version: 1, categories: [ { id, label, color } ] }
//
// `id` is a slug, unique and never colliding with a built-in. Unit-tested in
// test/custom-categories.test.js.
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'maermin_custom_categories';
  var SCHEMA = 1;

  // Built-ins mirror the colours already used across the app. 'options' is a
  // reserved built-in id (a special tx kind), so it cannot be reused either.
  var BUILTINS = [
    { id: 'crypto',      label: 'Crypto',       color: '#f5a524' },
    { id: 'stocks',      label: 'Stocks',       color: '#3b82f6' },
    { id: 'skins',       label: 'CS2 Skins',    color: '#06b6d4' },
    { id: 'commodities', label: 'Commodities',  color: '#fb7185' }
  ];
  var RESERVED = { crypto: 1, stocks: 1, skins: 1, commodities: 1, options: 1 };
  var PALETTE = ['#22c55e', '#a855f7', '#ef4444', '#14b8a6', '#ec4899',
                 '#eab308', '#6366f1', '#f97316', '#0ea5e9', '#84cc16'];

  function isHexColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c); }

  // Slugify a label into a safe, stable id: lowercase, non-alnum → '_', trimmed.
  function slug(label) {
    var s = String(label == null ? '' : label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) return '';
    if (/^[0-9]/.test(s)) s = 'cat_' + s;
    return s;
  }

  function pickColor(id) {
    var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // Coerce stored / foreign data into a clean object. Drops empties, builtin/
  // reserved-id collisions and duplicate slugs (first wins).
  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var src = Array.isArray(obj.categories) ? obj.categories : (Array.isArray(obj) ? obj : []);
    var seen = {}, out = [];
    src.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var id = c.id ? slug(c.id) : slug(c.label);
      if (!id || RESERVED[id] || seen[id]) return;
      seen[id] = 1;
      var label = String(c.label == null ? id : c.label).trim() || id;
      out.push({ id: id, label: label, color: isHexColor(c.color) ? c.color : pickColor(id) });
    });
    return { version: SCHEMA, categories: out };
  }

  function customList(state) { return normalize(state).categories; }
  // Custom ids only — this is what metrics.js merges so custom positions survive.
  function ids(state) { return customList(arguments.length ? state : load()).map(function (c) { return c.id; }); }
  // Built-ins + custom, each tagged with `custom`.
  function all(state) {
    var src = arguments.length ? state : load();
    return BUILTINS.map(function (b) { return { id: b.id, label: b.label, color: b.color, custom: false }; })
      .concat(customList(src).map(function (c) { return { id: c.id, label: c.label, color: c.color, custom: true }; }));
  }
  function get(id, state) {
    id = slug(id);
    var hit = null;
    all(arguments.length > 1 ? state : load()).forEach(function (c) { if (c.id === id) hit = c; });
    return hit;
  }
  function label(id, state) { var c = get(id, arguments.length > 1 ? state : load()); return c ? c.label : id; }
  function color(id, state) { var c = get(id, arguments.length > 1 ? state : load()); return c ? c.color : '#8b94a7'; }
  function isCustom(id, state) { return ids(arguments.length > 1 ? state : load()).indexOf(slug(id)) !== -1; }

  function add(state, lbl, col) {
    state = normalize(state);
    var id = slug(lbl);
    if (!id || RESERVED[id]) return state;                       // empty or collides with built-in
    if (state.categories.some(function (c) { return c.id === id; })) return state; // dup
    state.categories.push({ id: id, label: String(lbl).trim() || id, color: isHexColor(col) ? col : pickColor(id) });
    return state;
  }
  function remove(state, id) {
    state = normalize(state);
    id = slug(id);
    state.categories = state.categories.filter(function (c) { return c.id !== id; });
    return state;
  }
  function rename(state, id, newLabel) {
    state = normalize(state);
    id = slug(id);
    var lbl = String(newLabel == null ? '' : newLabel).trim();
    if (!lbl) return state;
    state.categories = state.categories.map(function (c) { return c.id === id ? { id: c.id, label: lbl, color: c.color } : c; });
    return state;
  }
  function setColor(state, id, col) {
    state = normalize(state);
    id = slug(id);
    if (!isHexColor(col)) return state;
    state.categories = state.categories.map(function (c) { return c.id === id ? { id: c.id, label: c.label, color: col } : c; });
    return state;
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() {
    var s = store();
    if (!s) return { version: SCHEMA, categories: [] };
    try { return normalize(s.getItem(STORAGE_KEY)); } catch (e) { return { version: SCHEMA, categories: [] }; }
  }
  function save(state) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; }
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, SCHEMA: SCHEMA, BUILTINS: BUILTINS, RESERVED: RESERVED,
    slug: slug, pickColor: pickColor, normalize: normalize,
    customList: customList, ids: ids, all: all, get: get, label: label, color: color, isCustom: isCustom,
    add: add, remove: remove, rename: rename, setColor: setColor,
    load: load, save: save
  };
  api.View = makeView(api);

  if (typeof window !== 'undefined') window.MaerminCategories = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  function makeView(API) {
    return function View(props) {
      var React = (typeof window !== 'undefined') ? window.React : null;
      if (!React) return null;
      var e = React.createElement;
      var useState = React.useState;
      try {
        var theme = props.theme || {};
        var t = props.t || {};
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f';
        var inputBg = theme.inputBg || '#0c1018', inputBorder = theme.inputBorder || border;
        var accent = theme.accent || '#f5a524', accentText = theme.accentText || '#13110a';

        var s0 = useState(function () { return API.load(); });
        var st = s0[0], setSt = s0[1];
        var nn = useState(''); var name = nn[0], setName = nn[1];

        function mutate(next) { API.save(next); setSt(API.normalize(next)); }
        function addCurrent() { if (name.trim()) { mutate(API.add(st, name)); setName(''); } }

        function dot(c) { return e('span', { 'aria-hidden': 'true', style: { display: 'inline-block', width: '0.75rem', height: '0.75rem', borderRadius: '4px', background: c, flexShrink: 0 } }); }

        var builtinRow = API.BUILTINS.map(function (b) {
          return e('span', { key: b.id, style: { display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.6rem', borderRadius: '999px', border: '1px solid ' + border, color: dim, fontSize: '0.78rem' } },
            dot(b.color), b.label);
        });

        var customRows = API.customList(st).map(function (c) {
          return e('div', { key: c.id, style: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.9rem', background: card, border: '1px solid ' + border, borderRadius: '12px', marginBottom: '0.55rem' } },
            e('input', {
              type: 'color', value: c.color, title: t.catColor || 'Colour',
              onChange: function (ev) { mutate(API.setColor(st, c.id, ev.target.value)); },
              style: { width: '28px', height: '28px', border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }
            }),
            e('input', {
              value: c.label,
              onChange: function (ev) { mutate(API.rename(st, c.id, ev.target.value)); },
              style: { flex: 1, minWidth: 0, padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid ' + inputBorder, background: inputBg, color: text, fontSize: '0.85rem', fontWeight: 700 }
            }),
            e('code', { style: { color: dim, fontSize: '0.72rem' } }, c.id),
            e('button', {
              onClick: function () { mutate(API.remove(st, c.id)); },
              style: { padding: '0.3rem 0.6rem', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', borderRadius: '8px', border: '1px solid ' + inputBorder, background: 'transparent', color: text }
            }, t.catDelete || 'Delete'));
        });

        return e('div', { style: { padding: '1.5rem' } },
          e('h2', { style: { color: text, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 0.35rem' } }, t.navCategories || 'Categories'),
          e('p', { style: { color: dim, fontSize: '0.88rem', margin: '0 0 1.25rem', lineHeight: 1.5, maxWidth: '62ch' } },
            t.catSubtitle || 'Define your own asset categories beyond the four built-ins. Custom categories are priced and counted in your totals; they appear when adding a transaction. Carried in your backup.'),

          e('div', { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' } }, builtinRow),

          e('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' } },
            e('input', {
              value: name, onChange: function (ev) { setName(ev.target.value); },
              onKeyDown: function (ev) { if (ev.key === 'Enter') addCurrent(); },
              placeholder: t.catNewPlaceholder || 'New category, e.g. Real Estate…',
              style: { flex: 1, minWidth: '200px', maxWidth: '340px', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid ' + inputBorder, background: inputBg, color: text, fontSize: '0.85rem' }
            }),
            e('button', { onClick: addCurrent, style: { padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 800, cursor: 'pointer', borderRadius: '8px', border: 'none', background: accent, color: accentText } }, t.catAdd || 'Add category')),

          customRows.length ? customRows : e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '2rem', textAlign: 'center', color: dim, fontSize: '0.9rem' } },
            t.catEmpty || 'No custom categories yet. Add one above — it will appear in the Add-Transaction category picker.'),

          e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '1rem', lineHeight: 1.5 } },
            t.catFootnote || 'Note: by-asset-class breakdowns (rebalancing-by-class, currency-by-class) currently cover the four base classes; custom-category value is included in totals and shown here and in Tags.'));
      } catch (err) {
        return e('div', { style: { padding: '1.5rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, 'Categories view error: ' + (err && err.message));
      }
    };
  }
})();
