// ============================================================================
// MAERMIN — Aurora icon set
// ----------------------------------------------------------------------------
// Minimal 24×24 stroke icons (1.75px, round caps) rendered as inline SVG so
// they inherit `currentColor` and scale crisply at any size. Replaces the old
// unicode glyphs in the app shell. Global IIFE, no dependencies beyond React.
//
//   window.MaerminIcon('overview', { size: 18 })   → React element
//   window.MaerminIcons.svg('overview', 18)        → SVG markup string
// ============================================================================
(function () {
  'use strict';

  var P = {
    // shell / navigation
    overview:     'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
    transactions: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
    portfolios:   'M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M4 13h16',
    'net-worth':  'M3 21h18M5 18v-7M9.5 18v-7M14.5 18v-7M19 18v-7M12 3 3 8h18z',
    dividends:    'M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM15.5 10.2A5 5 0 1 1 10 18.6M9 7v4M7.5 8.5h2.2a.9.9 0 0 1 0 1.8H8.3',
    journal:      'M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 3v18M11 8h4M11 12h4',
    'hub-analytics': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    'hub-tools':  'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
    returns:      'M3 17l6-6 4 4 8-8M15 7h6v6',
    performance:  'M3 12h4l3-8 4 16 3-8h4',
    rebalancing:  'M12 3v18M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0zM8 21h8',
    'savings-plans': 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5M12 8v4l3 2',
    cashflow:     'M2 8c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 14c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 20c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0',
    fees:         'M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    analytics:    'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM12 8v5M12 16.5v.01',
    health:       'M20.8 8.6a5 5 0 0 0-8.8-3.2 5 5 0 0 0-8.8 3.2c0 5.4 8.8 11 8.8 11s3.4-2.2 6-5.2M3 12h4l2-3 3 6 2-3h7',
    'investment-analysis': 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
    tax:          'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3',
    intelligence: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8zM5 3.5l.6 1.4L7 5.5l-1.4.6L5 7.5l-.6-1.4L3 5.5l1.4-.6z',
    tags:         'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01',
    categories:   'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    customize:    'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
    discovery:    'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    share:        'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
    trash:        'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6M10 11v6M14 11v6',
    privacy:      'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4',
    watchlist:    'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    alerts:       'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
    rules:        'M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17M11 6h10M11 12h10M11 18h10',
    attribution:  'M21 12A9 9 0 1 1 12 3v9zM15 3.5A9 9 0 0 1 20.5 9H15z',
    realized:     'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
    news:         'M4 5h13v14a1 1 0 0 0 2 0V9h1a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 9h5M8 13h5M8 17h3',
    data:         'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    // actions / chrome
    search:       'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    eye:          'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'eye-off':    'M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20',
    settings:     'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    command:      'M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3',
    chevron:      'M9 6l6 6-6 6',
    plus:         'M12 5v14M5 12h14',
    upload:       'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
    refresh:      'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
    lock:         'M5 11h14v10H5zM8 11V7a4 4 0 1 1 8 0v4',
    key:          'M15.5 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM10.5 10.5 3 18v3h3l1-1v-2h2l1.5-1.5',
    download:     'M12 4v12M7 11l5 5 5-5M4 20h16',
    shield:       'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z',
    logout:       'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
    log:          'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    more:         'M5 12h.01M12 12h.01M19 12h.01',
    sparkle:      'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z',
    close:        'M6 6l12 12M18 6 6 18'
  };

  // Stable aliases so callers can use view ids directly.
  var ALIAS = {
    correlation: 'analytics', montecarlo: 'analytics', stress: 'analytics', risk: 'analytics',
    fire: 'returns', settings: 'settings', more: 'more', add: 'plus', import: 'upload'
  };

  function pathFor(name) { return P[name] || P[ALIAS[name]] || P.sparkle; }

  function svg(name, size, strokeWidth) {
    var s = size || 18, w = strokeWidth || 1.75;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + pathFor(name) + '"/></svg>';
  }

  function Icon(name, opts) {
    opts = opts || {};
    var R = window.React;
    if (!R) return null;
    var s = opts.size || 18;
    return R.createElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg', width: s, height: s, viewBox: '0 0 24 24',
      fill: 'none', stroke: 'currentColor', strokeWidth: opts.strokeWidth || 1.75,
      strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      style: Object.assign({ flexShrink: 0, display: 'block' }, opts.style || {})
    }, R.createElement('path', { d: pathFor(name) }));
  }

  // Brand mark: an aurora "M" monogram on a gradient tile.
  function Logo(opts) {
    opts = opts || {};
    var R = window.React;
    if (!R) return null;
    var s = opts.size || 30;
    return R.createElement('div', {
      className: 'mx-logo',
      style: { width: s + 'px', height: s + 'px', borderRadius: Math.round(s * 0.3) + 'px' }
    }, R.createElement('svg', { width: Math.round(s * 0.62), height: Math.round(s * 0.62), viewBox: '0 0 24 24', fill: 'none', stroke: '#fff', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
      R.createElement('path', { d: 'M4 19V6l8 8 8-8v13' })));
  }

  window.MaerminIcons = { paths: P, has: function (n) { return !!(P[n] || P[ALIAS[n]]); }, svg: svg, Icon: Icon, Logo: Logo };
  window.MaerminIcon = Icon;
})();
