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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ---- colour scale ---------------------------------------------------------
  // Theme colours arrive as var(--…) references (R1.1); resolve them first.
  function hexToRgb(hex) {
    var T = typeof window !== 'undefined' && window.MaerminTokens;
    var h = String((T ? T.resolve(hex) : hex) || '').replace('#', '');
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
        var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
        var privacy = !!props.privacyMode;
        var fmt = props.formatPrice || function (n) { return window.MaerminI18n.num(n, 2); };
        var sym = props.getCurrencySymbol ? props.getCurrencySymbol() : '';

        var PERIODS = ['Total', '1D', '1W', '1M', 'YTD', '1Y'];
        var p0 = useState('Total'); var period = p0[0], setPeriod = p0[1];
        var UIC = window.MaerminComponents, I = window.MaerminI18n;

        var nodes = props.nodes || buildNodes(props, period);
        // R4.1: the Overview's holdings map (area = weight, colour = move on the
        // gain / loss scale, always with ▲ / ▼); "Show as table" lists every holding.
        var total = nodes.reduce(function (s, n) { return s + num(n.value); }, 0) || 1;
        var amount = function (v) { return privacy ? '•••' : (fmt(v) + ' ' + sym); };
        var items = nodes.map(function (n) {
          var perf = num(n.perf);
          return { key: n.key, label: n.label, value: num(n.value), pct: perf, pctText: I.pct(Math.abs(perf), 1),
            weight: num(n.value) / total, title: n.label + ' · ' + I.pct(num(n.value) / total * 100, 1) + ' · ' + amount(n.value) + ' · ' + I.pct(perf, 1, true) };
        });
        var periodLabel = function (pp) { return pp === 'Total' ? __('pmTotal', 'Total') : pp === 'YTD' ? __('perfYtd', 'YTD') : pp.replace(/Y$/, __('chUnitY', 'Y')).replace(/D$/, __('chUnitD', 'D')); };
        var periods = e(UIC.Segmented, { label: __('vaPeriod', 'Period'), value: period, size: 'sm', onChange: setPeriod,
          options: PERIODS.map(function (pp) { return { value: pp, label: periodLabel(pp) }; }) });
        var byValue = items.slice().sort(function (a, b) { return b.value - a.value; });

        return e(UIC.ChartFrame, {
            'data-testid': 'performance-map', action: periods, className: 'ui-pm', title: t.pmTitle || 'Performance Map', subtitle: t.pmSubtitle || 'Area = weight, colour = performance',
            legend: [{ series: 'gain', label: __('pmLegendUp', '▲ up') }, { series: 'loss', label: __('pmLegendDown', '▼ down') }],
            table: items.length ? {
              layout: 'auto', rows: byValue, rowKey: function (r) { return r.key; },
              columns: [
                { key: 'label', label: __('hrHolding', 'Holding'), phone: 'title' },
                { key: 'weight', label: __('colWeight', 'Weight'), align: 'right', phone: 'meta', render: function (r) { return I.pct(r.weight * 100, 1); } },
                { key: 'pct', label: __('pmMove', 'Move'), align: 'right', phone: 'value', render: function (r) { return e(UIC.ToneChip, { value: r.pct, text: I.pct(r.pct, 1, true) }); } }
              ]
            } : null
          },
          items.length ? e(UIC.HoldingsMap, { items: items, label: t.pmTitle || 'Performance map', className: 'ui-pm__map' })
            : e('p', { className: 'ui-muted' }, t.pmEmpty || 'No priced positions to map yet.'));
      } catch (err) {
        return window.MaerminUtils.errorNote(__('pmError', 'Performance map error: {msg}', { msg: err && err.message })); // R5.4
      }
    };

    // Build treemap nodes from priced positions. props.positions is the grouped
    // buildPositions output; props.prices is the EUR price map; props.periodPerf
    // (optional) resolves a per-symbol period change, with total-return fallback.
    function buildNodes(props, period) {
      var groups = props.positions || {};
      var prices = props.prices || {};
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
