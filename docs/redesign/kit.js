// PROTOTYPE — redesign Phase 1 mockups only. Not loaded by the app; throw away after the pick.
// Shared helpers for the three directions: formatting, privacy mask, chart paths and the
// floating prototype bar (direction ← →, screen, theme, privacy, language).
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var DIRS = [
    { id: 'quiet-ledger', name: 'A · Quiet Ledger' },
    { id: 'trading-desk', name: 'B · Trading Desk' },
    { id: 'atlas-map', name: 'C · Atlas Map' }
  ];
  var SCREENS = [
    { id: 'overview', name: 'Overview' },
    { id: 'transactions', name: 'Transactions' },
    { id: 'returns', name: 'Returns' },
    { id: 'phone-overview', name: 'Phone overview (DE)' }
  ];
  var THEMES = ['dark', 'light', 'nebula', 'contrast', 'cb'];
  var THEME_NAMES = { dark: 'Dark', light: 'Light', nebula: 'Nebula', contrast: 'High contrast', cb: 'Colour-blind' };
  var state = {
    theme: THEMES.indexOf(q.get('theme')) > -1 ? q.get('theme') : (document.documentElement.dataset.defaultTheme || 'dark'),
    mask: q.get('mask') === '1',
    mode: q.get('mode') === 'simple' ? 'simple' : 'advanced'
  };
  var root = document.documentElement;
  root.dataset.theme = state.theme;
  root.dataset.mask = state.mask ? '1' : '0';
  root.dataset.mode = state.mode;

  // ---- numbers --------------------------------------------------------------
  // parse "26,680.00 €" / "+1,033.21%" / "−1,658.14 EUR" -> number
  function num(s) { return parseFloat(String(s).replace(/[−–]/g, '-').replace(/[^0-9.\-]/g, '')) || 0; }
  function fmt(n, d, lang) {
    return Number(n).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function eur(n, lang, d) { return fmt(n, d == null ? 2 : d, lang) + ' €'; }
  function signed(n, lang, d, unit) {
    var s = n > 0 ? '+' : n < 0 ? '−' : '±';
    return s + fmt(Math.abs(n), d == null ? 2 : d, lang) + (unit == null ? ' €' : unit);
  }
  function pct(n, lang, d) { return signed(n, lang, d == null ? 2 : d, ' %').replace(' %', lang === 'de' ? ' %' : '%'); }
  function tone(n) { return n > 0.0001 ? 'gain' : n < -0.0001 ? 'loss' : 'flat'; }
  // money wrapped so privacy mode can mask it in CSS ([data-mask="1"] .m)
  function m(text) { return '<span class="m" data-v="' + text + '">' + text + '</span>'; }

  // ---- charts ---------------------------------------------------------------
  function linePath(series, w, h, pad) {
    pad = pad || 0;
    var n = series.length;
    return series.map(function (v, i) {
      var x = (i / (n - 1)) * w, y = pad + (1 - v) * (h - 2 * pad);
      return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
  }
  function areaPath(series, w, h, pad) { return linePath(series, w, h, pad) + ' L' + w + ' ' + h + ' L0 ' + h + ' Z'; }
  // a deterministic mini series per symbol (sparklines only; shapes are illustrative)
  function spark(seed, up) {
    var out = [], v = 0.5, s = 0;
    for (var i = 0; i < seed.length; i++) s += seed.charCodeAt(i);
    for (var k = 0; k < 24; k++) { v += Math.sin(s + k * 1.7) * 0.08 + (up ? 0.015 : -0.012); out.push(v); }
    var mn = Math.min.apply(null, out), mx = Math.max.apply(null, out);
    return out.map(function (x) { return (x - mn) / ((mx - mn) || 1); });
  }

  // ---- demo figures (Overview, demo mode, All portfolios) ------------------
  var K = {
    portfolio: 176756.66, change1m: 5740.17, change1mPct: 3.67, costBasis: 107997.01, positions: 31,
    cash: 1800.04, netWorth: 178556.70, unrealised: 68759.65, unrealisedPct: 63.67,
    divExpected: 1404.15, divMonthly: 117.01, divYield: 1.0, health: 80, grade: 'B',
    xirr: 19.63, twr: 87.22, twrPa: 18.20, realized: 8181.74, divReceived: 4964.83, divGross: 5435.65,
    taxes: 2128.96, fees: 52.60, netReturn: 80248.09, netReturnPct: 72.10,
    alloc: [
      { k: 'stocks', en: 'Stocks & ETFs', de: 'Aktien & ETFs', pct: 77.0, v: 136114.66 },
      { k: 'crypto', en: 'Crypto', de: 'Krypto', pct: 20.7, v: 36630.00 },
      { k: 'commod', en: 'Commodities', de: 'Rohstoffe', pct: 2.2, v: 3930.00 },
      { k: 'skins', en: 'CS2 Skins', de: 'CS2-Skins', pct: 0.05, v: 82.00 }
    ],
    portfolios: [{ name: 'Main depot', de: 'Hauptdepot', v: 162362.68, tx: 224 }, { name: 'Savings plan broker', de: 'Sparplan-Broker', v: 14393.98, tx: 108 }],
    heat: {
      2026: [2.8, 1.4, 5.9, 0.2, 5.4, -3.7, 1.4, 1.1, 4.9, 1.4, null, null, 10.4, 1.7, 7.6, 1.4, 22.5],
      2025: [2.2, 2.7, -3.0, -3.4, 7.1, 6.7, 2.2, 0.7, 0.4, 0.1, -2.4, 1.7, 1.7, 10.3, 3.3, -0.6, 15.2],
      2024: [1.5, 2.2, -3.2, 1.9, 0.0, -1.5, 1.9, 1.8, 3.7, 2.2, 5.9, 5.4, 0.4, 0.4, 7.6, 14.1, 23.7],
      2023: [2.1, -1.5, -2.7, -2.3, 3.6, 2.5, 4.7, 2.6, -3.5, -0.3, 4.9, -0.7, -2.1, 3.8, 3.6, 3.9, 9.3]
    },
    irr: [['NVDA', 92.7, 2513.49, 7862.72, 18547.20], ['SOL', 56.5, 1001.50, 0, 3750.00], ['GOOGL', 30.2, 4070.04, 0, 9715.20],
      ['AMZN', 27.9, 2526.84, 0, 6274.40], ['BTC', 27.3, 12627.40, 0, 26680.00], ['TSLA (closed)', 27.3, 826.70, 1225.79, null],
      ['ETH', 25.4, 4803.50, 2397.90, 6200.00], ['JPM', 25.2, 2522.13, 237.42, 5244.00]],
    // value attribution, all time (from the Returns figures above): money in, gains, income, costs
    bought: 98701.72, proceeds: 16451.24, holdingDays: 1370, inflation: 11.85, usd: 0.920
  };
  // the transactions list in EUR (USD rows at the demo rate 1 USD = 0.920 EUR)
  function txEUR(t) {
    var v = num(t.total);
    return t.cur === 'USD' ? v * K.usd : v;
  }

  // the demo position for a transaction symbol (ALV.DE -> ALVD, GOOGL -> GOOG, O -> O)
  function posFor(sym) {
    var c = String(sym).replace('.', '').slice(0, 4);
    return (window.DEMO.pos.filter(function (p) { return p.sym === sym || p.sym === c || (sym === 'GOOGL' && p.sym === 'GOOG'); })[0]) || null;
  }

  // ---- prototype bar --------------------------------------------------------
  function here() {
    var parts = location.pathname.split('/');
    return { dir: parts[parts.length - 2], screen: parts[parts.length - 1].replace('.html', '') };
  }
  function go(dir, screen, extra) {
    var p = new URLSearchParams(location.search);
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] == null) p.delete(k); else p.set(k, extra[k]); });
    var s = p.toString();
    location.href = '../' + dir + '/' + screen + '.html' + (s ? '?' + s : '');
  }
  function bar() {
    var h = here();
    var di = DIRS.findIndex(function (d) { return d.id === h.dir; });
    if (di < 0) return;
    var el = document.createElement('div');
    el.className = 'proto-bar';
    el.innerHTML =
      '<span class="proto-tag">PROTOTYPE</span>' +
      '<button data-a="prev" aria-label="Previous direction">←</button>' +
      '<strong>' + DIRS[di].name + '</strong>' +
      '<button data-a="next" aria-label="Next direction">→</button>' +
      '<select data-a="screen" aria-label="Screen">' + SCREENS.map(function (s) { return '<option value="' + s.id + '"' + (s.id === h.screen ? ' selected' : '') + '>' + s.name + '</option>'; }).join('') + '</select>' +
      '<select data-a="theme" aria-label="Theme">' + THEMES.map(function (t) { return '<option value="' + t + '"' + (t === state.theme ? ' selected' : '') + '>' + THEME_NAMES[t] + '</option>'; }).join('') + '</select>' +
      '<label><input type="checkbox" data-a="mask"' + (state.mask ? ' checked' : '') + '> Hide amounts</label>' +
      '<label><input type="checkbox" data-a="mode"' + (state.mode === 'simple' ? ' checked' : '') + '> Simple</label>' +
      '<a href="../index.html">All</a>';
    document.body.appendChild(el);
    var step = function (d) { go(DIRS[(di + d + DIRS.length) % DIRS.length].id, h.screen); };
    el.addEventListener('click', function (e) {
      var a = e.target.getAttribute('data-a');
      if (a === 'prev') step(-1); else if (a === 'next') step(1);
    });
    el.addEventListener('change', function (e) {
      var a = e.target.getAttribute('data-a');
      if (a === 'screen') go(h.dir, e.target.value);
      if (a === 'theme') go(h.dir, h.screen, { theme: e.target.value });
      if (a === 'mask') go(h.dir, h.screen, { mask: e.target.checked ? '1' : null });
      if (a === 'mode') go(h.dir, h.screen, { mode: e.target.checked ? 'simple' : null });
    });
    document.addEventListener('keydown', function (e) {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
  }
  // the bar's own look, independent of every direction
  var css = '.proto-bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;display:flex;gap:8px;align-items:center;' +
    'background:#111;color:#fff;font:600 12px/1 system-ui,sans-serif;padding:8px 12px;border-radius:999px;box-shadow:0 8px 30px rgba(0,0,0,.45);border:2px solid #ffd400;white-space:nowrap}' +
    '.proto-bar button,.proto-bar select{background:#333;color:#fff;border:0;border-radius:999px;padding:6px 10px;font:inherit;cursor:pointer}' +
    '.proto-bar label{display:flex;gap:4px;align-items:center}.proto-bar a{color:#ffd400}.proto-tag{background:#ffd400;color:#111;padding:3px 6px;border-radius:4px;font-size:10px}' +
    '@media (max-width:700px){.proto-bar{bottom:auto;top:6px;font-size:11px;flex-wrap:wrap;justify-content:center;max-width:96vw;border-radius:14px}.proto-bar label:nth-of-type(2){display:none}}' +
    '@media print{.proto-bar{display:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  document.addEventListener('DOMContentLoaded', bar);

  // one stroke icon set (24 px grid, 1.75 stroke) for all three directions
  var P = {
    overview: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
    tx: '<path d="M7 7h13M7 7l3-3M7 7l3 3M17 17H4M17 17l-3-3M17 17l-3 3"/>',
    div: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5c0-1 1-1.8 2.5-1.8s2.5.8 2.5 1.8-1 1.6-2.5 1.9-2.5.9-2.5 1.9 1 1.8 2.5 1.8 2.5-.8 2.5-1.8"/>',
    tax: '<path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h3"/>',
    analysis: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
    buy: '<path d="M12 19V5M5 12l7-7 7 7"/>', sell: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>', more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l12-4v4M16 13h2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'
  };
  function icon(name, size) { return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>'; }

  window.KIT = { posFor: posFor, icon: icon, num: num, fmt: fmt, eur: eur, signed: signed, pct: pct, tone: tone, m: m, linePath: linePath, areaPath: areaPath, spark: spark, K: K, txEUR: txEUR, state: state, DIRS: DIRS, SCREENS: SCREENS };
})();
