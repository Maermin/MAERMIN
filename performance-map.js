// ============================================================================
// MAERMIN — Performance Map (allocation treemap heatmap)  (window.MaerminPerformanceMap)
// ----------------------------------------------------------------------------
// Competitive-gap WI-4. Parqet and getquin both show a treemap where area is the
// position weight and colour is its performance. MAERMIN only had a correlation
// heatmap. This adds a self-contained, dependency-free SQUARIFIED treemap layout
// plus a performance colour scale that remaps automatically across themes.
//
// Pure layer (squarify / layout / colorFor) is Node-tested in
// test/performance-map.test.js — area sums to the container, rects never
// overlap, the colour scale hits the theme's danger/success at the band edges,
// and an empty portfolio degrades to an empty layout. It is a derived consumer
// of MaerminMetrics.buildPositions, so nothing is persisted. The React view
// renders SVG and respects privacy mode (amounts maskable).
// ============================================================================
(function () {
  'use strict';

  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---- colour scale ---------------------------------------------------------
  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return { r: 128, g: 128, b: 128 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(c) {
    function p(x) { var s = clamp(Math.round(x), 0, 255).toString(16); return s.length === 1 ? '0' + s : s; }
    return '#' + p(c.r) + p(c.g) + p(c.b);
  }
  function mix(a, b, t) { return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }; }

  // Map a performance percentage to a colour between the theme's danger and
  // success, through a neutral midpoint. `maxAbs` is the band edge (default 10%).
  function colorFor(perfPct, opts) {
    opts = opts || {};
    var down = hexToRgb(opts.down || '#ef4444');
    var up = hexToRgb(opts.up || '#22c55e');
    var neutral = hexToRgb(opts.neutral || '#6b7280');
    var maxAbs = num(opts.maxAbs) || 10;
    var p = clamp(num(perfPct), -maxAbs, maxAbs);
    if (p < 0) return rgbToHex(mix(neutral, down, -p / maxAbs));
    if (p > 0) return rgbToHex(mix(neutral, up, p / maxAbs));
    return rgbToHex(neutral);
  }

  // ---- squarified treemap ---------------------------------------------------
  // Reference: Bruls, Huizing & van Wijk (2000). Lays out `nodes` (each with a
  // positive numeric `value`) inside `rect` so areas are proportional to value.
  function worst(row, w, scale) {
    var sum = 0, mn = Infinity, mx = -Infinity;
    for (var i = 0; i < row.length; i++) {
      var a = row[i]._area;
      sum += a; if (a < mn) mn = a; if (a > mx) mx = a;
    }
    var s2 = sum * sum, w2 = w * w;
    return Math.max((w2 * mx) / s2, s2 / (w2 * mn));
  }

  function layoutRow(row, rect, horizontal, out) {
    var sum = 0, i;
    for (i = 0; i < row.length; i++) sum += row[i]._area;
    if (sum <= 0) return;
    if (horizontal) {
      // container wider than tall: a vertical strip on the left, full height.
      var rowW = sum / rect.h;
      var y = rect.y;
      for (i = 0; i < row.length; i++) {
        var h = row[i]._area / rowW;
        out.push({ node: row[i], x: rect.x, y: y, w: rowW, h: h });
        y += h;
      }
      rect.x += rowW; rect.w -= rowW;
    } else {
      // container taller than wide: a horizontal strip on top, full width.
      var rowH = sum / rect.w;
      var x = rect.x;
      for (i = 0; i < row.length; i++) {
        var wEl = row[i]._area / rowH;
        out.push({ node: row[i], x: x, y: rect.y, w: wEl, h: rowH });
        x += wEl;
      }
      rect.y += rowH; rect.h -= rowH;
    }
  }

  function squarify(nodes, rect, out) {
    var remaining = nodes.slice();
    var row = [];
    while (remaining.length) {
      var r = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      var horizontal = r.w >= r.h;
      var side = horizontal ? r.h : r.w;
      var next = remaining[0];
      if (!row.length) { row.push(next); remaining.shift(); continue; }
      var withNext = row.concat([next]);
      if (worst(row, side, 1) >= worst(withNext, side, 1)) {
        row = withNext; remaining.shift();
      } else {
        layoutRow(row, rect, horizontal, out);
        row = [];
      }
    }
    if (row.length) {
      var horiz = rect.w >= rect.h;
      layoutRow(row, rect, horiz, out);
    }
  }

  // Public layout. `nodes` = [{ key, label, value, perf, ...extra }]. Returns
  // [{ key, label, value, perf, x, y, w, h, weight, color }] — non-positive
  // values are dropped; an empty input yields []. Colours use `opts` (theme).
  function layout(nodes, width, height, opts) {
    opts = opts || {};
    var W = num(width) || 0, H = num(height) || 0;
    var clean = (Array.isArray(nodes) ? nodes : [])
      .map(function (n) { return Object.assign({}, n, { value: num(n.value) }); })
      .filter(function (n) { return n.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    var total = clean.reduce(function (s, n) { return s + n.value; }, 0);
    if (!clean.length || total <= 0 || W <= 0 || H <= 0) return [];
    var area = W * H;
    clean.forEach(function (n) { n._area = (n.value / total) * area; });
    var placed = [];
    squarify(clean, { x: 0, y: 0, w: W, h: H }, placed);
    return placed.map(function (p) {
      return {
        key: p.node.key, label: p.node.label != null ? p.node.label : p.node.key,
        value: p.node.value, perf: num(p.node.perf), weight: p.node.value / total,
        x: p.x, y: p.y, w: p.w, h: p.h,
        color: colorFor(p.node.perf, opts)
      };
    });
  }

  var api = { colorFor: colorFor, layout: layout, squarify: squarify };
  api.Panel = makePanel(api);

  if (typeof window !== 'undefined') window.MaerminPerformanceMap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view — an SVG treemap folded into the Performance view (no new tab).
  // `nodes` may be supplied directly; otherwise it builds them from priced
  // positions passed in props. Privacy mode masks amounts.
  // --------------------------------------------------------------------------
  function makePanel(API) {
    return function Panel(props) {
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
        var privacy = !!props.privacyMode;
        var fmt = props.formatPrice || function (n) { return (Math.round(n * 100) / 100).toLocaleString(); };
        var sym = props.getCurrencySymbol ? props.getCurrencySymbol() : '';

        var PERIODS = ['Total', '1D', '1W', '1M', 'YTD', '1Y'];
        var p0 = useState('Total'); var period = p0[0], setPeriod = p0[1];

        var nodes = props.nodes || buildNodes(props, period);
        var W = num(props.width) || 720, H = num(props.height) || 360;
        var rects = API.layout(nodes, W, H, { down: theme.danger || '#ef4444', up: theme.success || '#22c55e', neutral: theme.textSecondary || '#6b7280', maxAbs: props.maxAbs || 10 });

        function periodBtn(pp) {
          var active = pp === period;
          return e('button', { key: pp, onClick: function () { setPeriod(pp); },
            style: { padding: '0.25rem 0.6rem', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', borderRadius: '7px', border: '1px solid ' + border, background: active ? (theme.accent || '#f5a524') : 'transparent', color: active ? '#13110a' : text } }, pp);
        }

        var svg = e('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', style: { display: 'block', borderRadius: '10px', background: theme.inputBg || '#0c1018' }, role: 'img', 'aria-label': t.pmTitle || 'Performance map' },
          rects.map(function (r) {
            var showText = r.w > 46 && r.h > 22;
            return e('g', { key: r.key },
              e('rect', { x: r.x, y: r.y, width: Math.max(0, r.w - 1), height: Math.max(0, r.h - 1), fill: r.color, rx: 3,
                role: 'listitem', 'aria-label': r.label + ' ' + (r.weight * 100).toFixed(1) + '% ' + (r.perf >= 0 ? '+' : '') + r.perf.toFixed(1) + '%' },
                e('title', null, r.label + '  ·  ' + (privacy ? '•••' : (fmt(r.value) + ' ' + sym)) + '  ·  ' + (r.perf >= 0 ? '+' : '') + r.perf.toFixed(1) + '%')),
              showText ? e('text', { x: r.x + 6, y: r.y + 16, fill: '#0b0e14', style: { fontSize: '11px', fontWeight: 800, pointerEvents: 'none' } }, r.label) : null,
              showText ? e('text', { x: r.x + 6, y: r.y + 30, fill: 'rgba(11,14,20,0.8)', style: { fontSize: '10px', fontWeight: 600, pointerEvents: 'none' } }, (r.perf >= 0 ? '+' : '') + r.perf.toFixed(1) + '%') : null);
          }));

        return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', marginBottom: '1.5rem' } },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.7rem' } },
            e('div', null,
              e('div', { style: { color: text, fontWeight: 700, fontSize: '0.95rem' } }, t.pmTitle || 'Performance Map'),
              e('div', { style: { color: dim, fontSize: '0.76rem' } }, t.pmSubtitle || 'Area = weight, colour = performance')),
            e('div', { style: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap' } }, PERIODS.map(periodBtn))),
          rects.length ? svg : e('div', { style: { color: dim, fontSize: '0.84rem', padding: '1rem 0' } }, t.pmEmpty || 'No priced positions to map yet.'));
      } catch (err) {
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, 'Performance map error: ' + (err && err.message));
      }
    };

    // Build treemap nodes from priced positions. props.positions is the grouped
    // buildPositions output; props.prices is the EUR price map; props.periodPerf
    // (optional) resolves a per-symbol period change, with total-return fallback.
    function buildNodes(props, period) {
      var groups = props.positions || {};
      var prices = props.prices || {};
      var rate = props.exchangeRate || props.usdToEur || 1;
      var periodPerf = props.periodPerf || (typeof window !== 'undefined' && window.MaerminMarketStore && window.MaerminMarketStore.periodChange) || null;
      var nodes = [];
      Object.keys(groups).forEach(function (cat) {
        var arr = Array.isArray(groups[cat]) ? groups[cat] : [];
        arr.forEach(function (pos) {
          var sym = pos.symbol;
          var raw = prices[sym];
          var px = (raw && typeof raw === 'object') ? num(raw.price || raw.eur || raw.value) : num(raw);
          if (!(px > 0)) px = num(pos.purchasePrice);
          var value = num(pos.amount) * px;
          if (!(value > 0)) return;
          var totalPerf = pos.purchasePrice > 0 ? ((px - pos.purchasePrice) / pos.purchasePrice) * 100 : 0;
          var perf = totalPerf;
          if (period && period !== 'Total' && periodPerf) {
            var pp = periodPerf(sym, period);
            if (pp != null && isFinite(pp)) perf = num(pp);
          }
          nodes.push({ key: cat + ':' + sym, label: sym, value: value, perf: perf, category: cat });
        });
      });
      return nodes;
    }
  }
})();
