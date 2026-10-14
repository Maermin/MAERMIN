// ============================================================================
// MAERMIN — Saving goals: glide path and on-track status  (window.MaerminGoalPath)
// ----------------------------------------------------------------------------
// P5-5.7. A goal (stored in 'investmentGoals', see investment-views.js) has a
// target amount and date, a monthly contribution and an expected yearly
// return. It may be linked to portfolios or tags; then its money is the value
// of those holdings, otherwise the amount typed in.
//   - glidePath: the planned value month by month - the start value plus the
//     monthly contributions, compounded monthly at the expected return;
//   - status: today's value against that path (ahead / on track / behind,
//     +-5 %), reached or missed, the monthly amount that reaches the target
//     from here and where the current pace ends;
//   - equityGlide: a suggested share in shares and other risky assets that
//     falls over the last years before the target (default 90 % -> 20 % over
//     5 years), next to the linked holdings' actual share (riskShare).
// Pure; amounts in EUR. Not investment advice. Node-tested in
// test/goal-path.test.js.
// ============================================================================
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};

  var TOLERANCE = 0.05;
  var DEFAULT_RETURN = 0.05;
  var GLIDE = { start: 90, end: 20, years: 5 };
  var SAFE = { bonds: true, cash: true };   // everything else counts as risky

  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function ymd(v) { return String(v || '').slice(0, 10); }
  function isISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function parts(iso) { return [+iso.slice(0, 4), +iso.slice(5, 7), +iso.slice(8, 10)]; }
  // Calendar months from a to b (days as a fraction of 30).
  function monthsBetween(a, b) {
    var p = parts(a), q = parts(b);
    return (q[0] - p[0]) * 12 + (q[1] - p[1]) + (q[2] - p[2]) / 30;
  }
  function addMonths(iso, n) {
    var p = parts(iso), y = p[0], m = p[1] - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + Math.min(p[2], last)).slice(-2);
  }
  function monthlyRate(annual) { return Math.pow(1 + num(annual), 1 / 12) - 1; }

  // Future value after `months` of monthly contributions (paid at month end).
  function fv(start, monthly, annual, months) {
    var i = monthlyRate(annual), n = Math.max(0, months);
    if (Math.abs(i) < 1e-12) return start + monthly * n;
    var g = Math.pow(1 + i, n);
    return start * g + monthly * (g - 1) / i;
  }
  // The monthly contribution that reaches `target` in `months`; 0 when the
  // start is enough already; null when no time is left.
  function requiredMonthly(target, start, annual, months) {
    if (!(months > 0)) return null;
    var i = monthlyRate(annual), g = Math.pow(1 + i, months);
    var gap = target - start * g;
    if (gap <= 0) return 0;
    return Math.abs(i) < 1e-12 ? gap / months : gap * i / (g - 1);
  }

  // A stored goal with numbers and defaults filled in. Older goals (before
  // P5-5.7) have no start, return or link: they start on their creation day
  // with the amount typed in.
  function normalizeGoal(g) {
    g = g || {};
    var link = g.link && (g.link.type === 'portfolio' || g.link.type === 'tag') && Array.isArray(g.link.ids) && g.link.ids.length
      ? { type: g.link.type, ids: g.link.ids.map(String) } : null;
    var created = ymd(g.createdAt);
    var startDate = isISO(ymd(g.startDate)) ? ymd(g.startDate) : isISO(created) ? created : null;
    var r = num(g.expectedReturn, DEFAULT_RETURN);
    var glide = g.glide && typeof g.glide === 'object'
      ? { start: num(g.glide.start, GLIDE.start), end: num(g.glide.end, GLIDE.end), years: num(g.glide.years, GLIDE.years) } : null;
    return Object.assign({}, g, {
      targetAmount: num(g.targetAmount), currentAmount: num(g.currentAmount), monthlyContribution: num(g.monthlyContribution),
      expectedReturn: r > -0.5 && r < 0.5 ? r : DEFAULT_RETURN,
      targetDate: ymd(g.targetDate), startDate: startDate,
      startValue: g.startValue != null ? num(g.startValue) : num(g.currentAmount),
      link: link, glide: glide
    });
  }

  // The planned value per month from the start to the target date: [{ date, value }].
  function glidePath(goal) {
    var g = normalizeGoal(goal);
    if (!g.startDate || !isISO(g.targetDate) || g.targetDate <= g.startDate) return [];
    var n = Math.ceil(monthsBetween(g.startDate, g.targetDate) - 1e-9);
    var out = [];
    for (var k = 0; k <= Math.min(n, 1200); k++) {
      var d = k === n ? g.targetDate : addMonths(g.startDate, k);
      out.push({ date: d, value: k === 0 ? g.startValue : fv(g.startValue, g.monthlyContribution, g.expectedReturn, Math.min(k, monthsBetween(g.startDate, g.targetDate))) });
    }
    return out;
  }

  // value: the goal's money today (linkedValue or the amount typed in).
  function status(goal, value, opts) {
    opts = opts || {};
    var g = normalizeGoal(goal);
    var asOf = isISO(ymd(opts.asOf)) ? ymd(opts.asOf) : new Date().toISOString().slice(0, 10);
    var v = num(value);
    var base = { state: 'invalid', planned: null, ratio: null, monthsLeft: 0, requiredMonthly: null, projected: null, progressPercent: 0 };
    if (!(g.targetAmount > 0) || !isISO(g.targetDate)) return base;
    var left = Math.max(0, monthsBetween(asOf, g.targetDate));
    var out = Object.assign(base, {
      monthsLeft: Math.round(left),
      progressPercent: Math.max(0, Math.min(100, v / g.targetAmount * 100)),
      requiredMonthly: requiredMonthly(g.targetAmount, v, g.expectedReturn, left),
      projected: fv(v, g.monthlyContribution, g.expectedReturn, left)
    });
    if (v >= g.targetAmount) { out.state = 'reached'; out.requiredMonthly = 0; return out; }
    if (!(left > 0)) { out.state = 'missed'; return out; }
    if (g.startDate && asOf >= g.startDate) {
      var elapsed = Math.min(monthsBetween(g.startDate, asOf), monthsBetween(g.startDate, g.targetDate));
      out.planned = fv(g.startValue, g.monthlyContribution, g.expectedReturn, elapsed);
    } else {
      out.planned = g.startValue;
    }
    out.ratio = out.planned > 0 ? v / out.planned : null;
    out.state = out.ratio == null ? (out.projected >= g.targetAmount ? 'on-track' : 'behind')
      : out.ratio > 1 + TOLERANCE ? 'ahead' : out.ratio >= 1 - TOLERANCE ? 'on-track' : 'behind';
    return out;
  }

  // ---- the goal's money ----------------------------------------------------------
  function tagsApi() { return W.MaerminTags || (typeof require === 'function' ? require('./tags.js') : null); }
  // ctx: { transactions, prices, tagsState } -> { value, positions, linked }
  function linkedValue(goal, ctx) {
    var g = normalizeGoal(goal);
    ctx = ctx || {};
    if (!g.link) return { value: g.currentAmount, positions: [], linked: false };
    var T = tagsApi();
    if (!T) return { value: g.currentAmount, positions: [], linked: false };
    var txs = Array.isArray(ctx.transactions) ? ctx.transactions : [];
    var positions;
    if (g.link.type === 'portfolio') {
      positions = T.pricedPositions(txs.filter(function (tx) { return g.link.ids.indexOf(String((tx && tx.portfolioId) || 'default')) >= 0; }), ctx.prices);
    } else {
      var want = g.link.ids.map(function (s) { return s.toLowerCase(); });
      positions = T.pricedPositions(txs, ctx.prices).filter(function (p) {
        return T.tagsForSymbol(ctx.tagsState, p.symbol).some(function (n) { return want.indexOf(n.toLowerCase()) >= 0; });
      });
    }
    var value = positions.reduce(function (s, p) { return s + num(p.valueEUR); }, 0);
    return { value: value, positions: positions, linked: true };
  }

  // ---- risk glide ----------------------------------------------------------------
  function equityGlide(goal, asOf) {
    var g = normalizeGoal(goal), gl = g.glide || GLIDE;
    var at = isISO(ymd(asOf)) ? ymd(asOf) : new Date().toISOString().slice(0, 10);
    if (!isISO(g.targetDate)) return null;
    var years = monthsBetween(at, g.targetDate) / 12;
    if (years >= gl.years) return gl.start;
    if (years <= 0) return gl.end;
    return gl.end + (gl.start - gl.end) * (years / gl.years);
  }
  // Percent of the value in risky assets (anything but bonds and cash); null without value.
  function riskShare(positions) {
    var total = 0, risky = 0;
    (positions || []).forEach(function (p) {
      var v = num(p && p.valueEUR);
      if (!(v > 0)) return;
      total += v;
      if (!SAFE[String(p.category || '').toLowerCase()]) risky += v;
    });
    return total > 0 ? risky / total * 100 : null;
  }

  var api = { fv: fv, requiredMonthly: requiredMonthly, glidePath: glidePath, status: status, linkedValue: linkedValue,
    equityGlide: equityGlide, riskShare: riskShare, normalizeGoal: normalizeGoal, monthsBetween: monthsBetween,
    TOLERANCE: TOLERANCE, DEFAULT_RETURN: DEFAULT_RETURN, GLIDE: GLIDE };
  if (typeof window !== 'undefined') window.MaerminGoalPath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
