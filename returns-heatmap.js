// ============================================================================
// MAERMIN — Monthly returns heatmap  (window.MaerminReturnsHeatmap)
// ----------------------------------------------------------------------------
// P4-1. A month × year grid of time-weighted returns with quarter and year
// totals, on Analysis → Returns. The input is the same chain of period returns
// the TWR card uses, in its fallback order:
//   1. the daily value path   (value-path.js build: points [{ d, r }])
//   2. the daily snapshots    (value-path.js fromValues: steps [{ d, r }])
//   3. the refresh history    (returns-engine.js twrSteps: steps [{ d, r }])
// Each step counts in the month of its date d (the END of its period), so a
// step that spans several months - only in the fallbacks - lands in the month
// it ends in. Months, quarters and years are COMPOUNDED, never added, so the
// product of all months is exactly the TWR on the card.
//
//   fromSteps(steps)  → null | { first, last, years: [{ year, months[12],
//                        quarters[4], total, partial: { month: true } }] }
//                        (newest year first; null where there is no step)
//   cellColor(r, { up, down, base, maxAbs })  fill between base and up/down,
//                     eased toward base where the text would miss 4.5 : 1
//   textOn(bg)        white or near-black, whichever contrasts more
//   contrast(a, b)    WCAG contrast ratio of two hex colours
//
// Pure + dual-exported; tested in test/returns-heatmap.test.js.
// ============================================================================
(function () {
  'use strict';

  function ym(d) {
    var s = String(d || '');
    return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
  }
  function daysIn(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

  function fromSteps(steps) {
    var byMonth = {}, first = '', last = '';
    (steps || []).forEach(function (s) {
      if (!s) return;
      var k = ym(s.d), r = typeof s.r === 'number' ? s.r : parseFloat(s.r);
      if (!k || !isFinite(r) || !(1 + r > 0)) return;
      byMonth[k] = (byMonth[k] == null ? 1 : byMonth[k]) * (1 + r);
      var d = String(s.d).slice(0, 10);
      if (!first || d < first) first = d;
      if (!last || d > last) last = d;
    });
    var keys = Object.keys(byMonth);
    if (!keys.length) return null;
    var years = {};
    keys.forEach(function (k) {
      var y = parseInt(k.slice(0, 4), 10), m = parseInt(k.slice(5, 7), 10) - 1;
      if (!years[y]) years[y] = { year: y, months: [null, null, null, null, null, null, null, null, null, null, null, null], quarters: [null, null, null, null], total: null, partial: {} };
      years[y].months[m] = byMonth[k] - 1;
    });
    // The first and last month with data are partial unless the data covers
    // them from the 1st / to their last day.
    var fy = parseInt(first.slice(0, 4), 10), fm = parseInt(first.slice(5, 7), 10);
    if (parseInt(first.slice(8, 10), 10) > 1) years[fy].partial[fm - 1] = true;
    var ly = parseInt(last.slice(0, 4), 10), lm = parseInt(last.slice(5, 7), 10);
    if (parseInt(last.slice(8, 10), 10) < daysIn(ly, lm)) years[ly].partial[lm - 1] = true;
    Object.keys(years).forEach(function (y) {
      var Y = years[y], yg = null;
      for (var q = 0; q < 4; q++) {
        var g = null;
        for (var m = q * 3; m < q * 3 + 3; m++) if (Y.months[m] !== null) g = (g === null ? 1 : g) * (1 + Y.months[m]);
        Y.quarters[q] = g === null ? null : g - 1;
        if (g !== null) yg = (yg === null ? 1 : yg) * g;
      }
      Y.total = yg === null ? null : yg - 1;
    });
    return {
      first: first, last: last,
      years: Object.keys(years).map(function (y) { return years[y]; }).sort(function (a, b) { return b.year - a.year; })
    };
  }

  // ---- colour ----------------------------------------------------------------
  function hex(c) {
    var m = String(c || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    var h = m[1].length === 3 ? m[1].split('').map(function (x) { return x + x; }).join('') : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  function toHex(c) {
    return '#' + [c.r, c.g, c.b].map(function (v) { var s = Math.round(Math.max(0, Math.min(255, v))).toString(16); return s.length < 2 ? '0' + s : s; }).join('');
  }
  function lum(c) {
    var ch = [c.r, c.g, c.b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function contrast(a, b) {
    var A = hex(a), B = hex(b);
    if (!A || !B) return 1;
    var la = lum(A), lb = lum(B);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  var LIGHT_TEXT = '#ffffff', DARK_TEXT = '#0b0b14';
  function textOn(bg) { return contrast(bg, LIGHT_TEXT) >= contrast(bg, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT; }

  // Fill for a return r: the base (card) colour for 0, toward `up` / `down` with
  // the size of r, full at ±maxAbs. A non-zero return always gets some tint.
  function cellColor(r, opts) {
    opts = opts || {};
    var base = hex(opts.base) || { r: 15, g: 16, b: 24 };
    if (typeof r !== 'number' || !isFinite(r) || r === 0) return toHex(base);
    var to = hex(r > 0 ? opts.up : opts.down) || (r > 0 ? { r: 34, g: 197, b: 94 } : { r: 239, g: 68, b: 68 });
    var maxAbs = opts.maxAbs > 0 ? opts.maxAbs : 0.1;
    var t = 0.18 + 0.82 * Math.min(1, Math.abs(r) / maxAbs);
    function at(x) { return toHex({ r: base.r + (to.r - base.r) * x, g: base.g + (to.g - base.g) * x, b: base.b + (to.b - base.b) * x }); }
    // A mid-tone can miss 4.5 : 1 with both text colours: ease the tint toward
    // the card colour until the printed figure is readable (WCAG AA).
    var c = at(t);
    for (var i = 0; i < 20 && contrast(c, textOn(c)) < 4.5 && t > 0.1; i++) { t -= 0.03; c = at(t); }
    return c;
  }

  var api = { fromSteps: fromSteps, cellColor: cellColor, textOn: textOn, contrast: contrast };
  if (typeof window !== 'undefined') window.MaerminReturnsHeatmap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
