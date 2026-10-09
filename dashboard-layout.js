// ============================================================================
// MAERMIN v11.0 — Custom Dashboard Layout  (window.MaerminDashboard)
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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var STORAGE_KEY = 'maermin_dashboard_layout';
  var SCHEMA = 1;

  // The Overview sections this build can show/hide, in display order. These ids
  // are the ones renderer.js gates in renderOverview (see `dashVis`). Kept small
  // and 1:1 with real sections so every toggle in the Customize view does
  // something. The renderer may pass its own list to normalize().
  var DEFAULT_WIDGETS = [
    { id: 'valueChart', label: 'Value History Chart', key: 'dashWValueChart' },
    { id: 'statCards',  label: 'Stat Cards (Invested · Return · Dividends · Health)', key: 'dashWStatCards' },
    { id: 'allocation', label: 'Allocation · Top Performers · Positions', key: 'dashWAllocation' }
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

  // P4-7: the Overview's section ids in the saved order. Unknown saved ids are
  // dropped; sections the saved layout does not name yet keep their default
  // place at the end. `known` defaults to the built-in sections.
  function sectionOrder(state, known) {
    var ids = (known && known.length ? known : defaultIds()).slice();
    var set = {}; ids.forEach(function (id) { set[id] = true; });
    var out = [];
    normalize(state, ids).widgets.forEach(function (w) { if (set[w.id] && out.indexOf(w.id) === -1) out.push(w.id); });
    ids.forEach(function (id) { if (out.indexOf(id) === -1) out.push(id); });
    return out;
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
    sectionOrder: sectionOrder,
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
        var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f';
        var accent = theme.accent || '#8b7cff', accentText = theme.accentText || '#ffffff', accentFill = theme.accentFill || accent;

        var s0 = useState(function () { return API.load(); });
        var st = s0[0], setSt = s0[1];
        function commit(next) { API.save(next); setSt(API.normalize(next)); }

        var byId = {}; API.DEFAULT_WIDGETS.forEach(function (w) { byId[w.id] = w.key ? __(w.key, w.label) : w.label; });

        // P4-7: reorder - "move up / move down" buttons (keyboard; focus stays on
        // the moved row's button) and a drag handle on pointer events (touch and
        // mouse). A live region says where the section went.
        var ann = useState(''), said = ann[0], say = ann[1];
        var dr = useState(null), drag = dr[0], setDrag = dr[1];   // { id, order: [ids] } while dragging
        var listRef = React.useRef(null);
        var widgets = API.normalize(st).widgets;
        var order = drag ? drag.order : widgets.map(function (w) { return w.id; });
        var visOf = {}; widgets.forEach(function (w) { visOf[w.id] = w.visible; });
        function announce(id, ord) {
          say(__('dashMoved', '{name}: position {pos} of {n}', { name: byId[id] || id, pos: ord.indexOf(id) + 1, n: ord.length }));
        }
        function moveBy(id, dir) {
          var next = API.move(st, id, dir);
          commit(next);
          announce(id, next.widgets.map(function (w) { return w.id; }));
          setTimeout(function () {
            var root = listRef.current;
            var b = root && (root.querySelector('[data-dash-move="' + dir + '"][data-dash-id="' + id + '"]:not([disabled])') || root.querySelector('[data-dash-id="' + id + '"][data-dash-move]:not([disabled])'));
            if (b) b.focus();
          }, 0);
        }
        function onPointerDown(ev, id) {
          if (ev.button != null && ev.button !== 0) return;
          ev.preventDefault();
          try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (err) { /* old browsers */ }
          setDrag({ id: id, order: widgets.map(function (w) { return w.id; }) });
        }
        function onPointerMove(ev) {
          if (!drag || !listRef.current) return;
          var rowsEl = Array.prototype.slice.call(listRef.current.querySelectorAll('[data-dash-row]'));
          var y = ev.clientY, target = 0;
          rowsEl.forEach(function (el, k) { var r = el.getBoundingClientRect(); if (y > r.top + r.height / 2) target = k; });
          var cur = drag.order.filter(function (x) { return x !== drag.id; });
          var idxNow = drag.order.indexOf(drag.id);
          if (target === idxNow) return;
          cur.splice(target, 0, drag.id);
          setDrag({ id: drag.id, order: cur });
        }
        function onPointerUp() {
          if (!drag) return;
          var ord = drag.order, id = drag.id;
          setDrag(null);
          commit(API.reorder(st, ord));
          announce(id, ord);
        }
        function iconBtn(label, dir, id, disabled) {
          return e('button', { type: 'button', 'data-dash-move': dir, 'data-dash-id': id, disabled: disabled, 'aria-label': label, title: label,
            onClick: function () { moveBy(id, dir); },
            style: { width: '40px', height: '40px', flexShrink: 0, fontSize: '1rem', lineHeight: 1, cursor: disabled ? 'default' : 'pointer', borderRadius: '10px',
              border: '1px solid ' + border, background: 'transparent', color: disabled ? border : text, opacity: disabled ? 0.45 : 1 } }, dir === 'up' ? '↑' : '↓');
        }

        var rows = order.map(function (id, k) {
          var visible = visOf[id] !== false, name = byId[id] || id, dragging = drag && drag.id === id;
          return e('div', { key: id, 'data-dash-row': id, style: { display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.75rem', background: card, border: '1px solid ' + (dragging ? accent : border), borderRadius: '12px', marginBottom: '0.6rem', boxShadow: dragging ? '0 6px 18px rgba(0,0,0,0.25)' : 'none' } },
            e('button', { type: 'button', 'data-dash-handle': id, 'aria-label': __('dashDragAria', 'Drag {name} to a new place (or use the arrow buttons)', { name: name }),
              onPointerDown: function (ev) { onPointerDown(ev, id); }, onPointerMove: onPointerMove, onPointerUp: onPointerUp, onPointerCancel: onPointerUp,
              onKeyDown: function (ev) { if (ev.key === 'ArrowUp' && k > 0) { ev.preventDefault(); moveBy(id, 'up'); } else if (ev.key === 'ArrowDown' && k < order.length - 1) { ev.preventDefault(); moveBy(id, 'down'); } },
              style: { width: '40px', height: '40px', flexShrink: 0, cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', borderRadius: '10px', border: '1px solid ' + border, background: 'transparent', color: dim, fontSize: '1.1rem' } }, '⠿'),
            e('button', {
              type: 'button',
              onClick: function () { commit(API.toggle(st, id)); },
              title: visible ? (t.dashHide || 'Hide') : (t.dashShow || 'Show'),
              'aria-pressed': visible, 'aria-label': __('dashShowAria', 'Show {name}', { name: name }),
              style: { width: '44px', minHeight: '32px', flexShrink: 0, padding: '0.3rem 0', fontSize: '0.74rem', fontWeight: 800, cursor: 'pointer', borderRadius: '999px', border: '1px solid ' + (visible ? accent : border), background: visible ? accentFill : 'transparent', color: visible ? accentText : dim } },
              visible ? __('secOn', 'On') : __('dashOff', 'Off')),
            e('div', { style: { flex: 1, minWidth: 0, color: visible ? text : dim, fontSize: '0.88rem', fontWeight: 600 } }, name),
            iconBtn(__('dashUpAria', 'Move {name} up', { name: name }), 'up', id, k === 0 || !!drag),
            iconBtn(__('dashDownAria', 'Move {name} down', { name: name }), 'down', id, k === order.length - 1 || !!drag));
        });

        return e('div', { style: { padding: '1.5rem', position: 'relative' } },
          e('h2', { style: { color: text, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 0.35rem' } }, t.navCustomize || 'Customize Overview'),
          e('p', { style: { color: dim, fontSize: '0.88rem', margin: '0 0 1.25rem', lineHeight: 1.5, maxWidth: '60ch' } },
            __('dashSubtitleOrder', 'Show, hide and reorder the main Overview sections: drag a row by its handle, or use the arrow buttons. Changes are saved instantly and carried in your backup.')),
          e('div', { ref: listRef, 'data-testid': 'dash-order' }, rows),
          e('div', { role: 'status', 'aria-live': 'polite', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } }, said),
          e('button', { onClick: function () { commit(API.reset()); }, style: { marginTop: '0.5rem', padding: '0.45rem 0.9rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', borderRadius: '8px', border: '1px solid ' + border, background: 'transparent', color: text } },
            t.dashReset || 'Reset to default'));
      } catch (err) {
        return e('div', { style: { padding: '1.5rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, __('dashError', 'Customize view error: {msg}', { msg: err && err.message }));
      }
    };
  }
})();
