// ============================================================================
// MAERMIN — Plain-language verdicts  (window.MaerminVerdicts)
// ----------------------------------------------------------------------------
// P5-1.6: one plain sentence next to a key figure, so a reader who doesn't
// know what "Sharpe 0.7" means still gets the gist. Every rule and threshold
// lives here — the views only render { level, text }.
//
// Levels: 'good' | 'neutral' | 'warn' | 'bad' (the view picks the colour).
// Input units match what the views already show:
//   benchmark(diffPp, name)      cumulative difference in percentage points
//   sharpe(x) / sortino(x)       ratio
//   volatility(pct)              annualised, in percent (15 = 15 %)
//   drawdown(pct)                largest fall, in percent, positive (20 = −20 %)
//   health(score)                0–100, same bands as the grade A/B/C/D/F
//   dividendSafety(score, atRiskPct)  0–100 safety score, % of income at risk
// null / non-finite input → null (the view shows no sentence).
//
// These are rules of thumb, not investment advice; the views say so once.
// Pure, no DOM, dual-exported (test/verdicts.test.js).
// ============================================================================
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
  function I18N() { return W.MaerminI18n || require('./i18n.js'); }
  function __(k, f, v) { return I18N().t(k, f, v); }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function v(level, text) { return { level: level, text: text }; }

  // Volatility bands (annualised %). A broad world-equity index runs ~15 %.
  var VOL = [10, 20, 35];
  // Drawdown bands (% fall from a peak).
  var DD = [10, 20, 35];
  // Risk-adjusted return bands (Sharpe and Sortino share them).
  var RATIO = [0, 0.5, 1, 2];
  // |difference| below this counts as "about level" with the benchmark.
  var BENCH_LEVEL_PP = 1;
  // Health grade bands (portfolio-health.js uses the same numbers).
  var HEALTH = [85, 70, 55, 40];
  // Dividend safety: score bands as the quality panel colours them.
  var DIV = [70, 45];

  function benchmark(diffPp, name) {
    if (!fin(diffPp)) return null;
    var n = name || __('perfBenchmark', 'Benchmark');
    var d = I18N().num(Math.abs(diffPp), 1);
    if (Math.abs(diffPp) < BENCH_LEVEL_PP) return v('neutral', __('vdBenchLevel', 'Over this period your portfolio moved roughly in line with {bench}.', { bench: n }));
    if (diffPp > 0) return v('good', __('vdBenchAhead', 'Over this period your portfolio did {pp} percentage points better than {bench}.', { pp: d, bench: n }));
    return v('warn', __('vdBenchBehind', 'Over this period your portfolio did {pp} percentage points worse than {bench}.', { pp: d, bench: n }));
  }

  // P5-2.2: own money-weighted return vs the same money in an index (fractions
  // a year), diffEUR = own end value − index end value. Same ±1 pp band.
  function replay(ownXirr, benchXirr, diffEUR, name) {
    if (!fin(ownXirr) || !fin(benchXirr) || !fin(diffEUR)) return null;
    var n = name || __('perfBenchmark', 'Benchmark');
    var pp = (ownXirr - benchXirr) * 100, d = I18N().num(Math.abs(pp), 1), amt = I18N().money(Math.abs(diffEUR));
    if (Math.abs(pp) < BENCH_LEVEL_PP) return v('neutral', __('vdReplayLevel', 'With the same money in and out, {bench} would have done about as well as your portfolio (within one percentage point a year).', { bench: n }));
    if (pp > 0) return v('good', __('vdReplayAhead', 'Your portfolio ended {amount} ahead of the same money in {bench} - about {pp} percentage points a year better.', { amount: amt, pp: d, bench: n }));
    return v('warn', __('vdReplayBehind', 'The same money in {bench} would have left you {amount} better off - about {pp} percentage points a year more.', { amount: amt, pp: d, bench: n }));
  }

  function ratio(x, kind) {
    if (!fin(x)) return null;
    var name = kind === 'sortino' ? __('rkSortino', 'Sortino Ratio') : __('rkSharpe', 'Sharpe Ratio');
    if (x < RATIO[0]) return v('bad', __('vdRatioNeg', '{name} below 0: the return was lower than a risk-free rate — the risk taken has not paid off so far.', { name: name }));
    if (x < RATIO[1]) return v('warn', __('vdRatioLow', '{name} under 0.5: little return for the fluctuations you carried.', { name: name }));
    if (x < RATIO[2]) return v('neutral', __('vdRatioOk', '{name} between 0.5 and 1: a reasonable return for the risk taken.', { name: name }));
    if (x < RATIO[3]) return v('good', __('vdRatioGood', '{name} between 1 and 2: a good return for the risk taken.', { name: name }));
    return v('good', __('vdRatioGreat', '{name} of 2 or more: very high for the risk taken — often a sign of a short or unusually calm period.', { name: name }));
  }
  function sharpe(x) { return ratio(x, 'sharpe'); }
  function sortino(x) { return ratio(x, 'sortino'); }

  function volatility(pct) {
    if (!fin(pct)) return null;
    if (pct < VOL[0]) return v('good', __('vdVolLow', 'Low fluctuation — calmer than a broad equity index (about 15 % a year).'));
    if (pct < VOL[1]) return v('neutral', __('vdVolMid', 'Moderate fluctuation — about what a broad equity index shows (about 15 % a year).'));
    if (pct < VOL[2]) return v('warn', __('vdVolHigh', 'High fluctuation — noticeably bumpier than a broad equity index.'));
    return v('bad', __('vdVolVeryHigh', 'Very high fluctuation — swings of this size are typical for single stocks or crypto.'));
  }

  function drawdown(pct) {
    if (!fin(pct)) return null;
    var p = Math.abs(pct);
    if (p < DD[0]) return v('good', __('vdDdLow', 'The deepest fall from a peak stayed small.'));
    if (p < DD[1]) return v('neutral', __('vdDdMid', 'A noticeable but ordinary setback, as in a normal market correction.'));
    if (p < DD[2]) return v('warn', __('vdDdHigh', 'A large setback — at the low point a fifth or more of the value was gone.'));
    return v('bad', __('vdDdVeryHigh', 'A very deep setback, comparable to a crash — check whether you could sit through it again.'));
  }

  function health(score) {
    if (!fin(score)) return null;
    if (score >= HEALTH[0]) return v('good', __('vdHealthA', 'Well spread out — no single position or asset class dominates.'));
    if (score >= HEALTH[1]) return v('good', __('vdHealthB', 'Solid structure with a few points worth a look in the bars below.'));
    if (score >= HEALTH[2]) return v('neutral', __('vdHealthC', 'Mixed structure — the weakest bar below shows where most points are lost.'));
    if (score >= HEALTH[3]) return v('warn', __('vdHealthD', 'Concentrated — a few positions or one asset class carry most of the risk.'));
    return v('bad', __('vdHealthF', 'Highly concentrated — a single setback could hit a large part of the portfolio.'));
  }

  function dividendSafety(score, atRiskPct) {
    if (!fin(score)) return null;
    var risk = fin(atRiskPct) && atRiskPct > 0 ? I18N().pct(atRiskPct, 0) : null;
    if (score >= DIV[0] && !risk) return v('good', __('vdDivSafe', 'Your dividend income looks well covered — no payer shows signs of a cut.'));
    if (score >= DIV[0]) return v('neutral', __('vdDivSafeSome', 'Your dividend income looks well covered overall; {pct} of it comes from payers with a cut risk.', { pct: risk }));
    if (score >= DIV[1]) return v('warn', __('vdDivMixed', 'Your dividend income is partly at risk{atRisk} — some payers pay out a lot of their earnings.', { atRisk: risk ? ' (' + risk + ')' : '' }));
    return v('bad', __('vdDivFragile', 'Your dividend income looks fragile{atRisk} — cuts would hit it noticeably.', { atRisk: risk ? ' (' + risk + ')' : '' }));
  }

  // Cumulative difference (pp) of two aligned return series.
  function cumulativeDiffPp(a, b) {
    if (!a || !b || !a.length || a.length !== b.length) return null;
    var ga = 1, gb = 1;
    for (var i = 0; i < a.length; i++) { ga *= 1 + a[i]; gb *= 1 + b[i]; }
    return fin(ga) && fin(gb) ? (ga - gb) * 100 : null;
  }

  function disclaimer() { return __('vdNoAdvice', 'Rules of thumb for orientation, not investment advice.'); }

  var api = {
    THRESHOLDS: { VOL: VOL, DD: DD, RATIO: RATIO, BENCH_LEVEL_PP: BENCH_LEVEL_PP, HEALTH: HEALTH, DIV: DIV },
    benchmark: benchmark, replay: replay, sharpe: sharpe, sortino: sortino, volatility: volatility,
    drawdown: drawdown, health: health, dividendSafety: dividendSafety,
    cumulativeDiffPp: cumulativeDiffPp, disclaimer: disclaimer
  };
  if (typeof window !== 'undefined') window.MaerminVerdicts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
