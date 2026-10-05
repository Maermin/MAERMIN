// Node harness for P1-7 (FINDINGS.md H-8): Strategy Analysis follows the app
// theme. Renders the real views with react-dom/server in the light theme and
// checks that no text is drawn white / light-on-dark.
// Run: node test/strategy-theme.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
globalThis.React = React;
globalThis.window = { React };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const _log = console.log; console.log = () => {};
require('../investment-views.js');
console.log = _log;
const V = window.InvestmentViews;

// The app's light theme tokens (renderer.js `themes.white`, the ones these views use).
const light = { text: '#0f172a', textSecondary: '#475569', card: '#ffffff', cardBorder: 'rgba(15,23,42,0.08)',
  inputBg: '#f8fafc', inputBorder: 'rgba(15,23,42,0.15)', accent: '#7c3aed', accentSoft: 'rgba(124,58,237,0.12)', shadow: 'none' };
const portfolio = {
  crypto: [{ symbol: 'BTC', amount: 1, purchasePrice: 30000 }],
  stocks: [{ symbol: 'AAPL', amount: 10, purchasePrice: 150 }, { symbol: 'SAP.DE', amount: 5, purchasePrice: 120 }],
  skins: [], commodities: []
};
const prices = { btc: 50000, BTC: 50000, aapl: 180, AAPL: 180, 'sap.de': 130, 'SAP.DE': 130 };

// Light-on-dark text: white, or translucent white, as a CSS colour.
const WHITE_TEXT = /(^|;)color:(white|#fff\b|#ffffff|rgba\(255, ?255, ?255)/i;
function lightOnDark(html) {
  const bad = [];
  const re = /style="([^"]*)"/g; let m;
  while ((m = re.exec(html))) {
    const style = m[1].replace(/&quot;/g, '"');
    if (!WHITE_TEXT.test(style)) continue;
    // White text on a coloured button (accent / green) is fine in every theme.
    if (/background:(#7c3aed|#22c55e|#8b7cff)/i.test(style)) continue;
    bad.push(style.slice(0, 90));
  }
  return bad;
}
function render(el) { return renderToStaticMarkup(el); }

(function run() {
  console.log('strategy-theme:');
  // Repro on the dashboard as the app mounts it (works with and without the fix).
  const dash = render(React.createElement(V.InvestmentAnalysisDashboard, { portfolio, prices, priceHistory: {}, theme: light, t: {} }));
  const badDash = lightOnDark(dash);
  ok('H-8: the dashboard has no white text in the light theme', badDash.length === 0, badDash.slice(0, 3).join(' | '));
  ok('H-8: card titles use the theme text colour', /color:#0f172a/.test(dash));

  // Every section, inside the theme the dashboard provides.
  const views = [
    ['DCA', V.DCAAnalyzerView, { portfolio, priceHistory: {} }],
    ['Sectors', V.SectorAllocationView, { portfolio, prices }],
    ['Countries', V.CountryAllocationView, { portfolio, prices }],
    ['Currencies', V.CurrencyExposureView, { portfolio }],
    ['Liquidity', V.LiquidityAnalysisView, { portfolio }],
    ['Goals', V.GoalInvestingView, { portfolioValue: 10000 }]
  ];
  views.forEach(([name, View, props]) => {
    let html = '', err = null;
    try { html = render(React.createElement(V.ThemeContext.Provider, { value: light }, React.createElement(View, props))); }
    catch (e) { err = e; }
    const bad = err ? ['render error: ' + err.message] : lightOnDark(html);
    ok('H-8: ' + name + ' has no white text in the light theme', bad.length === 0, bad.slice(0, 3).join(' | '));
  });
  // A saved goal renders its figures in the theme colour too.
  localStorage.setItem('investmentGoals', JSON.stringify([{ id: 'g', name: 'Haus', type: 'house', targetAmount: 50000, currentAmount: 10000, targetDate: '2030-01-01', monthlyContribution: 500 }]));
  const goals = render(React.createElement(V.ThemeContext.Provider, { value: light }, React.createElement(V.GoalInvestingView, { portfolioValue: 10000 })));
  ok('H-8: goal cards (target date, monthly, remaining) are readable', lightOnDark(goals).length === 0 && /Haus/.test(goals));
  // Without a provider the views keep their former dark look.
  ok('views rendered on their own keep the dark defaults', /color:#ffffff/.test(render(React.createElement(V.AnalysisCard, { title: 'X' }))));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
