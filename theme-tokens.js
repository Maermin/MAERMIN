// ============================================================================
// MAERMIN — Theme tokens  (window.MaerminTokens)
// ----------------------------------------------------------------------------
// The design tokens live in styles.css as CSS variables (docs/DESIGN-SYSTEM.md
// § 2); the theme objects in renderer.js are var() references to them. This
// module is the bridge for the few places that need more than a reference:
//
//   resolve(value)    'var(--gain)' -> '#45d49a' for the active theme (contrast
//                     maths, canvas, PDF, share images). Anything that is not a
//                     var() comes back unchanged.
//   alpha(color, a)   a colour at opacity a (0-1 or a hex byte 0-255). Hex in ->
//                     the same #rrggbbaa as before; var() / named in ->
//                     color-mix(), which CSS resolves per theme.
//
// Node (tests) has no stylesheet: resolve() reads the Dark values below.
// ============================================================================
(function () {
  'use strict';

  var NAMES = ['bg', 'surface', 'surface-2', 'border', 'border-strong', 'control', 'text', 'text-dim', 'text-faint',
    'accent', 'accent-fill', 'on-accent', 'accent-soft', 'gain', 'loss', 'income', 'warning', 'neutral', 'focus',
    'comp-invested', 'comp-gain', 'comp-cash', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];

  // Dark theme values, used where no stylesheet exists (Node tests).
  var DARK = {
    bg: '#0c0b12', surface: '#14131c', 'surface-2': '#1b1a26', border: '#252433', 'border-strong': '#33314a',
    control: '#68676f', text: '#f0eff6', 'text-dim': '#9c9ab0', 'text-faint': '#838296', accent: '#a497ff',
    'accent-fill': '#5b4ae8', 'on-accent': '#ffffff', 'accent-soft': '#1d1b2c', gain: '#45d49a', loss: '#ff7b8a',
    income: '#7cb7ff', warning: '#f2bd5c', neutral: '#9c9ab0', focus: '#a497ff', 'comp-invested': '#3b3a58',
    'comp-gain': '#235c47', 'comp-cash': '#425a7d', 'chart-1': '#a497ff', 'chart-2': '#7cb7ff', 'chart-3': '#45d49a',
    'chart-4': '#f2bd5c', 'chart-5': '#ff9fd0', 'chart-6': '#8fd3e0',
    // legacy aliases still referenced by older code
    success: '#45d49a', danger: '#ff7b8a', info: '#7cb7ff'
  };

  var VAR_RE = /^var\(\s*--([a-z0-9-]+)\s*(?:,\s*([^)]*))?\)$/i;
  var cache = {}, cacheKey = '';

  function themeKey() {
    if (typeof document === 'undefined' || !document.documentElement) return 'node';
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  // The value of one token for the active theme ('' when unknown).
  function token(name) {
    var key = themeKey();
    if (key !== cacheKey) { cache = {}; cacheKey = key; }
    if (Object.prototype.hasOwnProperty.call(cache, name)) return cache[name];
    var v = '';
    if (key !== 'node' && typeof getComputedStyle === 'function') {
      try { v = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim(); } catch (e) { v = ''; }
      // a token defined through another one (var(--gain)) resolves on its own name
      var m = VAR_RE.exec(v);
      if (m) v = token(m[1]) || v;
    }
    if (!v) v = DARK[name] || '';
    cache[name] = v;
    return v;
  }

  function resolve(value) {
    var s = String(value == null ? '' : value).trim();
    var m = VAR_RE.exec(s);
    if (!m) return s;
    return token(m[1]) || (m[2] ? resolve(m[2]) : '');
  }

  function isVar(value) { return VAR_RE.test(String(value == null ? '' : value).trim()); }

  // a: 0-1, or a byte 0-255 when > 1 (the old `${color}15` suffixes).
  function alpha(color, a) {
    var frac = a > 1 ? a / 255 : a;
    if (!(frac >= 0)) frac = 1;
    if (frac > 1) frac = 1;
    var s = String(color == null ? '' : color).trim();
    var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (hex) {
      var h = hex[1].length === 3 ? hex[1].split('').map(function (c) { return c + c; }).join('') : hex[1];
      var byte = Math.round(frac * 255).toString(16);
      return '#' + h.toLowerCase() + (byte.length < 2 ? '0' + byte : byte);
    }
    if (!s) return 'transparent';
    var pct = Math.round(frac * 1000) / 10;
    return 'color-mix(in srgb, ' + s + ' ' + pct + '%, transparent)';
  }

  // R2.3: before the vault opens, <html> still says data-theme="dark". The lock
  // screen follows the saved theme instead ('theme' is a plain preference,
  // not a vault key); the app sets the same attributes again once it runs.
  var THEME_IDS = ['dark', 'white', 'purple', 'contrast', 'cb'];
  function applySavedTheme(doc, storage) {
    try {
      var th = storage && storage.getItem('theme');
      if (!doc || THEME_IDS.indexOf(th) < 0) return null;
      doc.documentElement.setAttribute('data-theme', th);
      doc.documentElement.setAttribute('data-mode', th === 'white' ? 'light' : 'dark');
      return th;
    } catch (e) { return null; }
  }
  if (typeof document !== 'undefined' && typeof window !== 'undefined') applySavedTheme(document, window.localStorage);

  var api = { NAMES: NAMES, DARK: DARK, THEME_IDS: THEME_IDS, token: token, resolve: resolve, isVar: isVar, alpha: alpha, applySavedTheme: applySavedTheme };
  if (typeof window !== 'undefined') window.MaerminTokens = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
