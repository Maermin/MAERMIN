// ============================================================================
// MAERMIN v10.0 — Custom Dashboard Layout  (window.MaerminDashboard)
// ----------------------------------------------------------------------------
// New in v10. Lets the user reorder and hide the cards on the Overview, so the
// dashboard reflects what THEY care about (a trader pins P&L; a long-term saver
// pins net worth + dividends). The saved layout is just an ordered list of
// widget ids + a visible flag — carried in the full-vault backup (key
// 'maermin_dashboard_layout').
//
// The key design point is forward/backward safety: the renderer owns the list
// of widgets that actually EXIST in this build (`available`), and `normalize`
// reconciles the saved layout against it — new widgets appear (at the end,
// visible), removed widgets drop out, and the user's order/visibility for the
// rest is preserved. So shipping a new card never corrupts an old saved layout.
//
// Storage shape:  { version: 1, widgets: [ { id: '<id>', visible: <bool> } ] }
// Pure; unit-tested in test/dashboard-layout.test.js.
// ============================================================================
(function () {
  'use strict';

  var STORAGE_KEY = 'maermin_dashboard_layout';
  var SCHEMA = 1;

  // The Overview sections this build can show/hide, in display order. These ids
  // are the ones renderer.js gates in renderOverview (see `dashVis`). Kept small
  // and 1:1 with real sections so every toggle in the Customize view does
  // something. The renderer may pass its own list to normalize().
  var DEFAULT_WIDGETS = [
    { id: 'valueChart', label: 'Value History Chart' },
    { id: 'statCards',  label: 'Stat Cards (Invested · Return · Dividends · Health)' },
    { id: 'allocation', label: 'Allocation · Top Performers · Positions' }
  ];

  function defaultIds() { return DEFAULT_WIDGETS.map(function (w) { return w.id; }); }

  // Reconcile a saved layout against the widgets that actually exist now.
  // `available` is an array of ids (or {id,...} objects); defaults to the
  // built-in DEFAULT_WIDGETS. Order: saved order first (for still-valid ids),
  // then any brand-new ids appended visible. Unknown saved ids are dropped.
  function normalize(raw, available) {
    var avail = (available && available.length ? available : DEFAULT_WIDGETS).map(function (w) {
      return typeof w === 'string' ? w : (w && w.id);
    }).filter(Boolean);
    var availSet = {};
    avail.forEach(function (id) { availSet[id] = true; });

    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var saved = Array.isArray(obj.widgets) ? obj.widgets : [];

    var out = [], placed = {};
    saved.forEach(function (w) {
      var id = w && (typeof w === 'string' ? w : w.id);
      if (!id || !availSet[id] || placed[id]) return;
      var visible = (w && typeof w === 'object' && 'visible' in w) ? !!w.visible : true;
      out.push({ id: id, visible: visible });
      placed[id] = true;
    });
    // Append widgets new to this build (never seen in the saved layout).
    avail.forEach(function (id) {
      if (!placed[id]) { out.push({ id: id, visible: true }); placed[id] = true; }
    });
    return { version: SCHEMA, widgets: out };
  }

  function visibleWidgets(state, available) {
    return normalize(state, available).widgets
      .filter(function (w) { return w.visible; })
      .map(function (w) { return w.id; });
  }

  // Map { id -> visible } straight from storage — what the renderer reads each
  // render to gate Overview sections. Unknown ids (not in the layout) default
  // visible, so a section is never hidden by accident.
  function visibleSet(available) {
    var out = {};
    load(available).widgets.forEach(function (w) { out[w.id] = w.visible; });
    return out;
  }

  function toggle(state, id, available) {
    var st = normalize(state, available);
    st.widgets = st.widgets.map(function (w) {
      return w.id === id ? { id: w.id, visible: !w.visible } : w;
    });
    return st;
  }

  function setVisible(state, id, visible, available) {
    var st = normalize(state, available);
    st.widgets = st.widgets.map(function (w) {
      return w.id === id ? { id: w.id, visible: !!visible } : w;
    });
    return st;
  }

  // Move a widget one slot toward the start ('up') or end ('down').
  function move(state, id, dir, available) {
    var st = normalize(state, available);
    var i = -1;
    for (var k = 0; k < st.widgets.length; k++) { if (st.widgets[k].id === id) { i = k; break; } }
    if (i === -1) return st;
    var j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= st.widgets.length) return st;
    var arr = st.widgets.slice();
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    st.widgets = arr;
    return st;
  }

  // Apply an explicit, full ordering of ids (e.g. from a drag-and-drop), keeping
  // each widget's current visibility; ids missing from `order` keep their place
  // after the ordered ones (via normalize's append rule).
  function reorder(state, order, available) {
    var st = normalize(state, available);
    var vis = {};
    st.widgets.forEach(function (w) { vis[w.id] = w.visible; });
    var seen = {}, out = [];
    (order || []).forEach(function (id) {
      if (vis.hasOwnProperty(id) && !seen[id]) { out.push({ id: id, visible: vis[id] }); seen[id] = true; }
    });
    st.widgets.forEach(function (w) { if (!seen[w.id]) { out.push(w); seen[w.id] = true; } });
    return { version: SCHEMA, widgets: out };
  }

  function reset(available) {
    return normalize({ version: SCHEMA, widgets: [] }, available);
  }

  // ---- localStorage helpers (browser only) ---------------------------------
  function store() { return (typeof localStorage !== 'undefined') ? localStorage : null; }

  function load(available) {
    var s = store();
    if (!s) return normalize(null, available);
    try { return normalize(s.getItem(STORAGE_KEY), available); }
    catch (e) { return normalize(null, available); }
  }

  function save(state, available) {
    var s = store();
    if (!s) return false;
    try { s.setItem(STORAGE_KEY, JSON.stringify(normalize(state, available))); return true; }
    catch (e) { return false; }
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA: SCHEMA,
    DEFAULT_WIDGETS: DEFAULT_WIDGETS,
    defaultIds: defaultIds,
    normalize: normalize,
    visibleWidgets: visibleWidgets,
    visibleSet: visibleSet,
    toggle: toggle,
    setVisible: setVisible,
    move: move,
    reorder: reorder,
    reset: reset,
    load: load,
    save: save
  };
  api.View = makeView(api);

  if (typeof window !== 'undefined') window.MaerminDashboard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // "Customize Overview" view: toggle visibility + reorder the gated Overview
  // sections. Persists immediately; the Overview reads visibleSet() each render,
  // so changes show the next time the Overview renders (e.g. on navigation).
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
        var accent = theme.accent || '#f5a524', accentText = theme.accentText || '#13110a';

        var s0 = useState(function () { return API.load(); });
        var st = s0[0], setSt = s0[1];
        function commit(next) { API.save(next); setSt(API.normalize(next)); }

        var byId = {}; API.DEFAULT_WIDGETS.forEach(function (w) { byId[w.id] = w.label; });

        var rows = API.normalize(st).widgets.map(function (w) {
          return e('div', { key: w.id, style: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.8rem 1rem', background: card, border: '1px solid ' + border, borderRadius: '12px', marginBottom: '0.6rem' } },
            e('button', {
              onClick: function () { commit(API.toggle(st, w.id)); },
              title: w.visible ? (t.dashHide || 'Hide') : (t.dashShow || 'Show'),
              style: { width: '44px', flexShrink: 0, padding: '0.3rem 0', fontSize: '0.74rem', fontWeight: 800, cursor: 'pointer', borderRadius: '999px', border: '1px solid ' + (w.visible ? accent : border), background: w.visible ? accent : 'transparent', color: w.visible ? accentText : dim } },
              w.visible ? 'On' : 'Off'),
            e('div', { style: { flex: 1, minWidth: 0, color: w.visible ? text : dim, fontSize: '0.88rem', fontWeight: 600 } }, byId[w.id] || w.id));
        });

        return e('div', { style: { padding: '1.5rem' } },
          e('h2', { style: { color: text, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 0.35rem' } }, t.navCustomize || 'Customize Overview'),
          e('p', { style: { color: dim, fontSize: '0.88rem', margin: '0 0 1.25rem', lineHeight: 1.5, maxWidth: '60ch' } },
            t.dashSubtitle || 'Show or hide the main Overview sections. Changes are saved instantly and carried in your backup; reopen the Overview to see them.'),
          rows,
          e('button', { onClick: function () { commit(API.reset()); }, style: { marginTop: '0.5rem', padding: '0.45rem 0.9rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', borderRadius: '8px', border: '1px solid ' + border, background: 'transparent', color: text } },
            t.dashReset || 'Reset to default'));
      } catch (err) {
        return e('div', { style: { padding: '1.5rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, 'Customize view error: ' + (err && err.message));
      }
    };
  }
})();
