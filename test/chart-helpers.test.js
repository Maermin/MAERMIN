// Node harness for the pure chart-style helpers in features6.js: theme
// luminance detection, the theme-aware palette, and the Catmull-Rom smooth
// path / area builders. The React chart component is browser-only and covered
// by smoke-views; here we stub a minimal React global so the module loads.
// Run: node test/chart-helpers.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

// features6.js destructures hooks off React at load — give it a stub.
global.React = { useState: () => [null, () => {}], useEffect: () => {}, useMemo: (f) => f && f(), useCallback: (f) => f, useRef: () => ({ current: null }), createElement: () => null };

const C = require('../features6.js');

(function run() {
  console.log('chart-helpers:');

  // ---- colorLuminance ----------------------------------------------------------
  ok('white is bright', C.colorLuminance('#ffffff') > 0.95);
  ok('black is dark', C.colorLuminance('#000000') < 0.05);
  ok('3-digit hex parses', approx(C.colorLuminance('#fff'), 1, 0.02));
  ok('rgb() parses', C.colorLuminance('rgb(255,255,255)') > 0.95);
  ok('rgba() parses', C.colorLuminance('rgba(0,0,0,0.5)') < 0.05);
  ok('mid grey is mid', C.colorLuminance('#808080') > 0.4 && C.colorLuminance('#808080') < 0.6);
  ok('unknown input is treated as dark (0)', C.colorLuminance('transparent') === 0 && C.colorLuminance(null) === 0);

  // ---- isDarkTheme / chartPalette ----------------------------------------------
  const darkT = { bg: '#0b0e13', card: '#10151f', textSecondary: '#8a93a3', accent: '#f5a524' };
  const lightT = { bg: '#ffffff', card: '#f7f8fa', textSecondary: '#5a6472', accent: '#f5a524' };
  ok('dark theme detected from bg', C.isDarkTheme(darkT) === true);
  ok('light theme detected from bg', C.isDarkTheme(lightT) === false);
  ok('falls back to card when bg missing', C.isDarkTheme({ card: '#10151f' }) === true);

  const pDark = C.chartPalette(darkT);
  const pLight = C.chartPalette(lightT);
  ok('palette exposes up/down/grid/axisText', !!(pDark.up && pDark.down && pDark.grid && pDark.axisText));
  ok('dark and light pick different up colors', pDark.up !== pLight.up);
  ok('dark flag carried on palette', pDark.dark === true && pLight.dark === false);
  ok('axisText defaults to the theme textSecondary', pDark.axisText === '#8a93a3');
  ok('accent flows into neutral', pDark.neutral === '#f5a524');

  // ---- smoothPath --------------------------------------------------------------
  ok('empty points -> empty string', C.smoothPath([]) === '' && C.smoothPath(null) === '');
  ok('single point -> a move only', C.smoothPath([{ x: 5, y: 6 }]) === 'M5,6');
  const two = C.smoothPath([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  ok('two points start with a move and use a cubic', /^M0\.00,0\.00 C/.test(two));
  const many = C.smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }, { x: 30, y: 8 }]);
  ok('curve passes through every input point', (many.match(/C/g) || []).length === 3 &&
    many.indexOf('10.00,5.00') > -1 && many.indexOf('20.00,0.00') > -1 && many.indexOf('30.00,8.00') > -1);
  ok('non-finite points are dropped', C.smoothPath([{ x: 0, y: 0 }, { x: NaN, y: 5 }, { x: 10, y: 10 }]).indexOf('NaN') === -1);

  // ---- smoothAreaPath ----------------------------------------------------------
  const area = C.smoothAreaPath([{ x: 0, y: 2 }, { x: 10, y: 4 }, { x: 20, y: 1 }], 50);
  ok('area starts at the first point', area.indexOf('M0.00,2.00') === 0);
  ok('area closes down to the baseline and back', area.indexOf('L20.00,50.00') > -1 && area.indexOf('L0.00,50.00') > -1 && /Z$/.test(area));
  ok('area needs at least two points', C.smoothAreaPath([{ x: 0, y: 0 }], 50) === '');

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
