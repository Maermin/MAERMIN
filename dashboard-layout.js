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

  // The widgets this build knows how to render, in their default order. The
  // renderer passes its own list to normalize(); this is the fallback/default.
  var DEFAULT_WIDGETS = [
    { id: 'totalValue',   label: 'Total Value' },
    { id: 'dayChange',    label: 'Day Change' },
    { id: 'totalPnl',     label: 'Total P&L' },
    { id: 'allocation',   label: 'Asset Allocation' },
    { id: 'valueChart',   label: 'Value History' },
    { id: 'topMovers',    label: 'Top Movers' },
    { id: 'dividends',    label: 'Upcoming Dividends' },
    { id: 'netWorth',     label: 'Net Worth' },
    { id: 'intelligence', label: 'Portfolio Intelligence' },
    { id: 'tags',         label: 'Tags Breakdown' }
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
    toggle: toggle,
    setVisible: setVisible,
    move: move,
    reorder: reorder,
    reset: reset,
    load: load,
    save: save
  };

  if (typeof window !== 'undefined') window.MaerminDashboard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
