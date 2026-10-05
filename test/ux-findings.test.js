// Node harness for the UX findings folded into P2-1 (FINDINGS.md M-9 … M-14,
// L-3 … L-7): each check reproduces the finding first.
// Run: node test/ux-findings.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
globalThis.React = React;
globalThis.window = { React };
globalThis.localStorage = { _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const _log = console.log; console.log = () => {};
const U = require('../utils.js');
window.MaerminUtils = U;
require('../investment-views.js');
console.log = _log;
const Market = require('../market-store.js');
const V = window.InvestmentViews;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---- M-10: a space typed into a field inside a clickable card ----------------
{
  let ran = 0, prevented = 0;
  const props = U.clickable(() => { ran++; });
  const card = {}, input = { tagName: 'INPUT' };
  const key = (target, k) => props.onKeyDown({ key: k, target, currentTarget: card, preventDefault() { prevented++; } });
  key(input, ' ');
  ok('M-10: a space in the rename input is not swallowed and runs nothing', prevented === 0 && ran === 0);
  key(input, 'Enter');
  ok('M-10: Enter in the input does not run the card action', ran === 0);
  props.onClick({ target: input, currentTarget: card });
  ok('M-10: clicking into the input does not run the card action', ran === 0);
  key(card, ' ');
  ok('the card itself still reacts to Space', ran === 1 && prevented === 1);
  props.onClick({ target: { tagName: 'SPAN' }, currentTarget: card });
  ok('a click on the card text still runs it', ran === 2);
  key({ tagName: 'BUTTON' }, 'Enter');
  ok('Enter on a button inside the card belongs to that button', ran === 2 && prevented === 1);
}

// ---- M-9: destructive actions ask first --------------------------------------
(async () => {
  {
    let done = 0, answer = false, asked = null;
    window.MaerminUI = { confirm: (o) => { asked = o; return Promise.resolve(answer); } };
    await U.confirmThen({ title: 'Delete?' }, () => { done++; });
    ok('M-9: cancelling the confirm deletes nothing', done === 0 && asked && asked.danger === true);
    answer = true;
    await U.confirmThen({ title: 'Delete?' }, () => { done++; });
    ok('M-9: confirming deletes', done === 1);
    delete window.MaerminUI;
    await U.confirmThen({ title: 'Delete?' }, () => { done++; });
    ok('M-9: without the dialog host nothing is deleted', done === 1);

    // Every site from the finding goes through the confirmation.
    const sites = [
      ['features4.js', /confirmThen\(\{[\s\S]{0,400}setPlans\(prev => prev\.filter/],
      ['features5.js', /confirmThen\(\{[\s\S]{0,400}setAccounts\(prev => prev\.filter/],
      ['real-assets.js', /confirmThen\(\{[\s\S]{0,400}API\.removeAsset/],
      ['rules-engine.js', /confirmThen\(\{[\s\S]{0,400}API\.removeRule/],
      ['tags.js', /confirmThen\(\{[\s\S]{0,400}removeTag\(st/],
      ['custom-categories.js', /confirmThen\(\{[\s\S]{0,400}API\.remove\(st/],
      ['exchange-sync.js', /confirmThen\(\{[\s\S]{0,400}removeConn\(c\.id\)/],
      ['german-tax-view.js', /confirmThen\(\{[\s\S]{0,400}TS\.reset\(\)/],
      ['renderer.js', /confirmThen\(\{[\s\S]{0,400}MaerminAuditLog\.clear\(\)/]
    ];
    const missing = sites.filter(([f, re]) => !re.test(read(f))).map(([f]) => f);
    ok('M-9: all nine destructive actions confirm first', missing.length === 0, missing.join(', '));
  }

  // ---- M-11: automatic refreshes stay quiet ---------------------------------
  {
    const N = Market.refreshNotice;
    ok('M-11: an automatic refresh that worked raises no toast', !N('ok', { silent: true, lastKey: 'ok' }).show);
    ok('M-11: the first problem of an automatic refresh is reported', N('partial:1', { silent: true, lastKey: 'ok' }).show);
    ok('M-11: the same problem five minutes later is not repeated', !N('partial:1', { silent: true, lastKey: 'partial:1' }).show);
    ok('M-11: a changed problem is reported', N('partial:2', { silent: true, lastKey: 'partial:1' }).show);
    ok('M-11: the CS2 Worker hint shows once, not every refresh', !N('cs2-worker', { silent: true, lastKey: 'cs2-worker' }).show);
    ok('a refresh the user started always reports', N('ok', {}).show && N('partial:1', { lastKey: 'partial:1' }).show);
    ok('summary keys', Market.summaryKey({ outcome: 'all', total: 3, fetched: 3 }) === 'ok' && Market.summaryKey({ outcome: 'partial', total: 3, fetched: 2 }) === 'partial:1');
    ok('M-11: the timer refresh runs silent', /fn\(\{ silent: true \}\)/.test(read('renderer.js')));
  }

  // ---- M-12: currency and privacy in VaR and Strategy -------------------------
  {
    ok('M-12: VaR/CVaR are no longer labelled EUR by hand', !/formatPrice\(riskMetrics\.c?var95\) \+ ' EUR'/.test(read('risk-analytics-view-v2.js')));
    ok('M-12: Strategy views print no hard-coded EUR amounts', !/toFixed\(0\) \+ ' EUR'|\+ ' EUR'\)/.test(read('investment-views.js').replace(/function plainEUR[^\n]*/, '')));
    const portfolio = { crypto: [{ symbol: 'BTC', amount: 1, purchasePrice: 30000 }], stocks: [{ symbol: 'AAPL', amount: 10, purchasePrice: 150 }], skins: [], commodities: [] };
    const prices = { btc: 50000, BTC: 50000, aapl: 180, AAPL: 180 };
    const masked = (v) => '•••' + ' $';
    const html = renderToStaticMarkup(React.createElement(V.MoneyContext.Provider, { value: masked },
      React.createElement(V.LiquidityAnalysisView, { portfolio, prices })));
    ok('M-12: Strategy amounts follow the app formatter (masked, display currency)', html.indexOf('••• $') > -1 && !/\d EUR/.test(html));
    const dash = read('renderer.js');
    ok('M-12: the dashboard gets the currency symbol', /InvestmentAnalysisDashboard, \{[\s\S]{0,200}getCurrencySymbol/.test(dash));
  }

  // ---- M-13: a goal without a target -----------------------------------------
  {
    const now = new Date('2026-01-01');
    const g0 = V.goalProgress({ targetAmount: 0, currentAmount: 500, monthlyContribution: 100, targetDate: '2030-01-01' }, now);
    ok('M-13: an empty target gives no NaN and no "On Track"', g0.invalid && g0.onTrack === null && g0.progressPercent === 0);
    const late = V.goalProgress({ targetAmount: 1000, currentAmount: 200, monthlyContribution: 0, targetDate: '2025-01-01' }, now);
    ok('a goal past its date and not reached is behind', late.onTrack === false && late.progressPercent === 20);
    const done = V.goalProgress({ targetAmount: 1000, currentAmount: 1200, monthlyContribution: 0, targetDate: '2025-01-01' }, now);
    ok('a reached goal is on track', done.onTrack === true && done.progressPercent === 100);
    localStorage.setItem('investmentGoals', JSON.stringify([{ id: '1', name: 'Empty', type: 'house', targetAmount: 0, currentAmount: 0, targetDate: '2030-01-01', monthlyContribution: 100 }]));
    const html = renderToStaticMarkup(React.createElement(V.GoalInvestingView, {}));
    ok('M-13: the goal card shows no NaN% and no On Track', !/NaN/.test(html) && !/On Track/.test(html), html.slice(0, 0));
  }

  // ---- M-14: News Feed error state ------------------------------------------
  {
    const src = read('features7.js');
    const m = src.match(/function newsEmptyText[\s\S]*?\n\}/);
    const newsEmptyText = m && new Function(m[0] + '; return newsEmptyText;')();
    ok('M-14: a Worker that failed every request is an error', newsEmptyText && /could not be loaded/.test(newsEmptyText(true, { tried: 5, failed: 5 })));
    ok('M-14: an answer without items is "no news"', newsEmptyText && /No news found/.test(newsEmptyText(true, { tried: 5, failed: 0 })));
    ok('no Worker: asks for one', newsEmptyText && /Add Worker URL/.test(newsEmptyText(false, { tried: 0, failed: 0 })));
  }

  // ---- L-3: icon-only buttons have a name -------------------------------------
  {
    const f3 = read('features3.js');
    const unnamed = (src) => (src.match(/React\.createElement\('button', \{[^}]*?\}, '[×✕]'\)/g) || []).filter((b) => !/aria-label/.test(b));
    ok('L-3: watchlist remove is named', /removeItem\(item\.id\),\s*'aria-label'/.test(read('features.js')));
    ok('L-3: position-detail close buttons are named', (f3.match(/'aria-label': 'Close'/g) || []).length >= 3);
    ok('L-3: portfolio rename is named', /pfRenameAria/.test(read('features4.js')));
    ok('L-3: net-worth and real-asset remove are named', /nwRemoveAria/.test(read('features5.js')) && /raRemoveAria/.test(read('real-assets.js')));
    ok('L-3: security log close is named', /setShowAuditLog\(false\), 'aria-label'/.test(read('renderer.js')));
    ok('L-3: no single-line icon button without a name in features3', unnamed(f3).length === 0);
  }

  // ---- L-4: the stale chip is a button ----------------------------------------
  ok('L-4: the "N stale" chip is a real button', /dqHealth\.stale \+ dqHealth\.missing\) > 0 && React\.createElement\('button'/.test(read('renderer.js')));

  // ---- L-5: the savings-plan form asks before discarding -----------------------
  {
    const f4 = read('features4.js');
    ok('L-5: Escape / backdrop / Cancel go through requestClose', /PlanModal, \{ theme, onClose: requestClose/.test(f4) && /onClick: requestClose/.test(f4));
    ok('L-5: an unchanged form closes without asking', /if \(!changed\) \{ setEditPlan\(null\); return; \}/.test(f4));
  }

  // ---- L-6 / L-7 ---------------------------------------------------------------
  {
    const ob = read('onboarding.js');
    ok('L-6: editing the URL clears the test results', /function editUrl\(v\) \{[^}]*setResults\(null\)/.test(ob) && /onChange: function \(e\) \{ editUrl/.test(ob));
    ok('L-6: "Test connection" cannot run twice', /if \(busy\) return;/.test(ob) && /'secondary', busy\)/.test(ob));
    const au = read('auth.js');
    ok('L-7: a failed copy is reported', /\}, copyFailed\);/.test(au) && /id="rc-copy-msg" role="status"/.test(au));
  }

  // ---- translations -------------------------------------------------------------
  {
    const T = require('../translations-complete.js');
    const keys = ['remove', 'discard', 'keepEditing', 'rcCopyFailed', 'taxResetTitle', 'exRemoveTitle', 'pfRenameAria', 'navAreaAnalysis', 'uiModeAdvanced'];
    const miss = keys.filter((k) => !T.en[k] || !T.de[k]);
    ok('new strings exist in en and de', miss.length === 0, miss.join(','));
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
