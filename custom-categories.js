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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var STORAGE_KEY = 'maermin_custom_categories';
  var SCHEMA = 1;

  // Built-ins mirror the colours already used across the app. 'options' is a
  // reserved built-in id (a special tx kind), so it cannot be reused either.
  var BUILTINS = [
    { id: 'crypto',      get label() { return __('crypto', 'Crypto'); }, color: '#8b7cff' },
    { id: 'stocks',      get label() { return __('stocks', 'Stocks'); }, color: '#3b82f6' },
    { id: 'skins',       get label() { return __('cs2Skins', 'CS2 Skins'); }, color: '#06b6d4' },
    { id: 'commodities', get label() { return __('catCommodities', 'Commodities'); }, color: '#fb7185' },
    // P5-3.9: bonds (bonds.js) - quantity = nominal, price in % of it
    { id: 'bonds',       get label() { return __('catBonds', 'Bonds'); }, color: '#f59e0b' }
  ];
  var RESERVED = { crypto: 1, stocks: 1, skins: 1, commodities: 1, options: 1 };
  // A custom category may no longer be NAMED "Bonds"; one created before
  // P5-3.9 stays stored (its rows simply become bond rows), see all().
  var NEW_RESERVED = { bonds: 1 };
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
  function ids(state) { return customList(arguments.length ? state : load()).filter(function (c) { return !NEW_RESERVED[c.id]; }).map(function (c) { return c.id; }); }
  // Built-ins + custom, each tagged with `custom`.
  function all(state) {
    var src = arguments.length ? state : load();
    return BUILTINS.map(function (b) { return { id: b.id, label: b.label, color: b.color, custom: false }; })
      .concat(customList(src).filter(function (c) { return !NEW_RESERVED[c.id]; }).map(function (c) { return { id: c.id, label: c.label, color: c.color, custom: true }; }));
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
    if (!id || RESERVED[id] || NEW_RESERVED[id]) return state;   // empty or collides with built-in
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
        var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
        // R5.1: Card rows, shared fields and buttons; the colour dot is the stored category colour
        var UIC = window.MaerminComponents;

        var s0 = useState(function () { return API.load(); });
        var st = s0[0], setSt = s0[1];
        var nn = useState(''); var name = nn[0], setName = nn[1];

        function mutate(next) { API.save(next); setSt(API.normalize(next)); }
        function addCurrent() { if (name.trim()) { mutate(API.add(st, name)); setName(''); } }

        function dot(c) { return e('span', { 'aria-hidden': 'true', className: 'ui-cat-dot', style: { background: c } }); }

        var builtinRow = API.BUILTINS.map(function (b) {
          return e('span', { key: b.id, className: 'ui-cat-builtin' }, dot(b.color), b.label);
        });

        var customRows = API.customList(st).map(function (c) {
          return e('li', { key: c.id, className: 'ui-cat-row' },
            e('input', {
              type: 'color', value: c.color, title: t.catColor || 'Colour', 'aria-label': (t.catColor || 'Colour') + ': ' + c.label,
              onChange: function (ev) { mutate(API.setColor(st, c.id, ev.target.value)); },
              className: 'ui-cat-color'
            }),
            e('input', {
              value: c.label, 'aria-label': __('catNameAria', 'Name of {id}', { id: c.id }),
              onChange: function (ev) { mutate(API.rename(st, c.id, ev.target.value)); },
              className: ['ui-input', 'ui-input--sm', 'ui-cat-name'].join(' ')
            }),
            e('code', { className: 'ui-cat-id' }, c.id),
            e(UIC.Button, {
              size: 'sm', variant: 'quiet',
              onClick: function () {
                window.MaerminUtils.confirmThen({
                  title: (t.catDeleteTitle || 'Delete the category "{name}"?').replace('{name}', c.label),
                  confirmLabel: t.catDelete || 'Delete', cancelLabel: t.cancel || 'Cancel'
                }, function () { mutate(API.remove(st, c.id)); });
              }
            }, t.catDelete || 'Delete'));
        });

        return e('div', { className: 'ui-view' },
          e('p', { className: 'ui-view__lead' },
            t.catSubtitle || 'Define your own asset categories beyond the four built-ins. Custom categories are priced and counted in your totals; they appear when adding a transaction. Carried in your backup.'),
          e(UIC.Card, { headingLevel: 'h3', title: __('catBuiltinTitle', 'Built-in categories') },
            e('div', { className: 'ui-cat-builtins' }, builtinRow)),
          e(UIC.Card, { headingLevel: 'h3', title: __('catOwnTitle', 'Your categories'), className: 'ui-tag-card' },
            e('div', { className: 'ui-ca-add' },
              e('input', {
                value: name, onChange: function (ev) { setName(ev.target.value); },
                onKeyDown: function (ev) { if (ev.key === 'Enter') addCurrent(); },
                placeholder: t.catNewPlaceholder || 'New category, e.g. Real Estate…', 'aria-label': t.catNewPlaceholder || 'New category, e.g. Real Estate…',
                className: ['ui-input', 'ui-cat-new'].join(' ')
              }),
              e(UIC.Button, { variant: 'primary', onClick: addCurrent }, t.catAdd || 'Add category')),
            customRows.length ? e('ul', { className: 'ui-cat-list' }, customRows)
              : e(UIC.EmptyState, { compact: true, text: t.catEmpty || 'No custom categories yet. Add one above — it will appear in the Add-Transaction category picker.' }),
            e('p', { className: 'ui-note' },
              t.catFootnote || 'Rebalancing and the currency breakdown group by the four base classes (crypto, stocks, commodities, skins). Holdings in your own categories count in every total and appear here and in Tags.')));
      } catch (err) {
        return e('div', { className: 'ui-view' }, e('p', { role: 'alert', className: ['ui-muted', 'is-error'].join(' ') }, __('ccError', 'Categories view error: ') + (err && err.message)));
      }
    };
  }
})();
