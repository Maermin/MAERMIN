// ============================================================================
// MAERMIN — Portfolio Projection  (window.MaerminProjection)
// ----------------------------------------------------------------------------
// Feature #6: simulate the whole portfolio (or a single portfolio) forward over
// 1 / 3 / 5 / 10 / custom years under conservative / realistic / optimistic
// scenarios, composing EVERYTHING that moves the balance:
//
//   + savings plans (recurring contributions, any frequency)
//   + dividends (optionally reinvested)
//   − recurring loans / mortgages (MaerminRecurring monthly debt service)
//   − recurring expenses
//
// Pure month-by-month engine, unit-tested (test/projection.test.js). Returns
// yearly points per scenario ready to chart, plus a cashflow breakdown. The UI
// passes the right startValue + (optionally portfolio-filtered) savings plans,
// so the same engine serves total and per-portfolio projections.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var PER_YEAR = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };

  // Default annual return assumptions per scenario (nominal). Overridable.
  var DEFAULT_SCENARIOS = { conservative: 0.03, realistic: 0.06, optimistic: 0.09 };

  function toMonthly(amount, frequency) {
    var py = PER_YEAR[frequency] || 12;
    return (parseFloat(amount) || 0) * py / 12;
  }

  // Monthly-equivalent contribution from active savings plans.
  function monthlyContributionFromPlans(plans) {
    return (plans || []).reduce(function (s, p) {
      if (p.active === false) return s;
      return s + toMonthly(p.amount, p.frequency);
    }, 0);
  }

  // Monthly-equivalent debt service from recurring liabilities. Reuses
  // MaerminRecurring.monthlyEquivalent when available; otherwise computes inline.
  function monthlyLiabilityFromAccounts(liabilities) {
    var R = (typeof window !== 'undefined') && window.MaerminRecurring;
    return (liabilities || []).reduce(function (s, l) {
      if (R && R.isRecurringLiability && R.isRecurringLiability(l)) return s + R.monthlyEquivalent(l);
      if (l && l.recurring && l.amount && l.interval) return s + toMonthly(l.amount, l.interval);
      return s;
    }, 0);
  }

  // Simulate one scenario month-by-month. Order each month:
  //   grow → add contribution → add dividend (reinvest) → pay liabilities/expenses.
  function simulate(opts) {
    var rate = opts.annualReturn || 0;
    var months = Math.round((opts.years || 1) * 12);
    var bal = opts.startValue || 0;
    var monthlyReturn = rate / 12;
    var contribution = opts.monthlyContribution || 0;
    var contribGrowthMonthly = (opts.contributionGrowth || 0) / 12;
    var divYieldMonthly = (opts.dividendYield || 0) / 12;
    var reinvest = opts.reinvestDividends !== false;
    var liability = opts.monthlyLiability || 0;
    var expenses = opts.monthlyExpenses || 0;

    var yearly = [{ year: 0, value: bal }];
    var totalContrib = 0, totalDiv = 0, totalLiab = 0, totalExp = 0;
    var c = contribution;

    for (var m = 1; m <= months; m++) {
      bal = bal * (1 + monthlyReturn);
      bal += c; totalContrib += c;
      var div = bal * divYieldMonthly;
      totalDiv += div;
      if (reinvest) bal += div;
      bal -= liability; totalLiab += liability;
      bal -= expenses; totalExp += expenses;
      if (bal < 0) bal = 0;
      c += c * contribGrowthMonthly; // optional contribution step-up
      if (m % 12 === 0) yearly.push({ year: m / 12, value: bal });
    }
    // Ensure a final point for non-whole-year horizons.
    if (months % 12 !== 0) yearly.push({ year: months / 12, value: bal });

    return {
      endValue: bal,
      points: yearly,
      totalContributions: totalContrib,
      totalDividends: totalDiv,
      totalLiabilityPayments: totalLiab,
      totalExpenses: totalExp
    };
  }

  // Project all three scenarios at once.
  function projectPortfolio(opts) {
    opts = opts || {};
    var scenarios = opts.scenarios || DEFAULT_SCENARIOS;
    var monthlyContribution = opts.monthlyContribution != null
      ? opts.monthlyContribution
      : monthlyContributionFromPlans(opts.savingsPlans);
    var monthlyLiability = opts.monthlyLiability != null
      ? opts.monthlyLiability
      : monthlyLiabilityFromAccounts(opts.liabilities);

    var base = {
      startValue: opts.startValue || 0,
      years: opts.years || 1,
      monthlyContribution: monthlyContribution,
      contributionGrowth: opts.contributionGrowth || 0,
      dividendYield: opts.dividendYield || 0,
      reinvestDividends: opts.reinvestDividends !== false,
      monthlyLiability: monthlyLiability,
      monthlyExpenses: opts.monthlyExpenses || 0
    };

    var out = { scenarios: {}, inputs: {
      startValue: base.startValue, years: base.years,
      monthlyContribution: monthlyContribution, monthlyLiability: monthlyLiability,
      dividendYield: base.dividendYield, monthlyExpenses: base.monthlyExpenses
    } };

    Object.keys(scenarios).forEach(function (name) {
      out.scenarios[name] = simulate(Object.assign({}, base, { annualReturn: scenarios[name] }));
    });
    return out;
  }

  // ---- embeddable chart Panel (folds into an existing view, no new tab) ----
  // props: { startValue, savingsPlans, dividendYield, liabilities, theme, t,
  //          formatPrice, getCurrencySymbol, scopeLabel }
  function Panel(props) {
    if (typeof React === 'undefined') return null;
    var e = React.createElement;
    var fmt = props.formatPrice || function (v) { return window.MaerminI18n.num(v, 0); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '';

    var hzState = React.useState(10); var years = hzState[0]; var setYears = hzState[1];
    var customState = React.useState(''); var custom = customState[0]; var setCustom = customState[1];
    // the drawing is as wide as its box, so the 10 px labels stay 10 px on a phone (a fixed 720
    // wide drawing scaled into 300 px made them about 4 px)
    var boxState = React.useState(0); var boxW = boxState[0]; var setBoxW = boxState[1];
    var svgRef = React.useRef(null);
    React.useEffect(function () {
      var el = svgRef.current && svgRef.current.parentElement;
      if (!el || typeof ResizeObserver === 'undefined') return undefined;
      var ro = new ResizeObserver(function () { setBoxW(Math.round(el.clientWidth)); });
      ro.observe(el);
      return function () { ro.disconnect(); };
    }, []);

    var liabilities = props.liabilities || (window.MaerminRecurring ? window.MaerminRecurring.loadFromAccounts() : []);
    var proj = projectPortfolio({
      startValue: props.startValue || 0,
      years: years,
      savingsPlans: props.savingsPlans || [],
      dividendYield: props.dividendYield || 0,
      reinvestDividends: true,
      liabilities: liabilities,
      monthlyExpenses: props.monthlyExpenses || 0
    });

    // R4.5: scenarios on the chart palette (never gain / loss colours), the
    // shared ChartFrame with a word legend and "Show as table", Segmented horizons.
    var UIC = window.MaerminComponents;
    var SCN = [
      { key: 'optimistic', series: '2', color: 'var(--chart-2)', label: __('pjOptimistic', 'Optimistic') },
      { key: 'realistic', series: '1', color: 'var(--chart-1)', label: __('pjRealistic', 'Realistic') },
      { key: 'conservative', series: '3', color: 'var(--chart-3)', label: __('pjConservative', 'Conservative') }
    ];

    // ---- SVG chart geometry -------------------------------------------------
    // Padded plot area leaves room for a Y value axis (left) and year axis (bot).
    var W = boxW ? Math.max(260, Math.min(720, boxW)) : 720, narrow = W < 480;
    var H = narrow ? 220 : 300, padL = 60, padR = 16, padT = 16, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var pts = proj.scenarios.realistic.points;
    var maxYear = pts[pts.length - 1].year || years || 1;

    var allVals = [];
    SCN.forEach(function (s) { proj.scenarios[s.key].points.forEach(function (p) { allVals.push(p.value); }); });
    var rawMax = Math.max.apply(null, allVals.concat([1]));
    var rawMin = Math.min.apply(null, allVals.concat([0]));
    // Fit the Y range to the actual curves (with a little headroom) instead of
    // anchoring at 0, so the spread between scenarios is legible at every
    // horizon — a 1-year view no longer looks like three flat lines.
    var span = rawMax - rawMin || rawMax || 1;
    var maxV = rawMax + span * 0.08;
    var minV = Math.max(0, rawMin - span * 0.12);

    function x(p) { return padL + (p.year / (maxYear || 1)) * plotW; }
    function y(v) { return padT + plotH - ((v - minV) / (maxV - minV || 1)) * plotH; }
    function pathFor(key) {
      return proj.scenarios[key].points.map(function (p, i) { return (i ? 'L' : 'M') + x(p).toFixed(1) + ' ' + y(p.value).toFixed(1); }).join(' ');
    }
    // Closed area under the realistic line for a soft fill.
    var realPts = proj.scenarios.realistic.points;
    var areaPath = pathFor('realistic') + ' L' + x(realPts[realPts.length - 1]).toFixed(1) + ' ' + (padT + plotH).toFixed(1) +
      ' L' + x(realPts[0]).toFixed(1) + ' ' + (padT + plotH).toFixed(1) + ' Z';

    // Compact axis-value formatter (23.9k / 1.2M) to keep the Y axis narrow.
    function compact(v) {
      return window.MaerminI18n.compact(v);
    }
    var TICKS = 4;
    var yTicks = [];
    for (var ti = 0; ti <= TICKS; ti++) yTicks.push(minV + (maxV - minV) * ti / TICKS);
    // X labels: subsample year points so they never overlap on long horizons.
    var xStep = Math.max(1, Math.ceil(pts.length / (narrow ? 4 : 6)));
    var yearLabel = function (yr) { return yr === 0 ? __('pjNow', 'Now') : __('pjYears', '{n}y', { n: window.MaerminI18n.num(Math.round(yr * 10) / 10, { min: 0, max: 1 }) }); };
    var money = function (v) { return fmt(v) + (sym ? ' ' + sym : ''); };

    var horizons = [1, 3, 5, 10];
    var controls = e('div', { className: 'ui-pj-controls' },
      e(UIC.Segmented, { label: __('pjHorizon', 'Horizon'), size: 'sm', value: custom ? null : years,
        onChange: function (yr) { setYears(yr); setCustom(''); },
        options: horizons.map(function (yr) { return { value: yr, label: __('pjYears', '{n}y', { n: yr }) }; }) }),
      e('input', { type: 'number', value: custom, placeholder: __('pjYrPh', 'yr'), 'aria-label': __('pjCustomYears', 'Custom number of years'), className: ['ui-input', 'ui-input--sm', 'ui-input--num'].join(' '),
        onChange: function (ev) { setCustom(ev.target.value); var v = parseFloat(ev.target.value); if (v > 0) setYears(v); } }));

    var tableRows = pts.map(function (p, i) {
      return { id: i, year: p.year, optimistic: proj.scenarios.optimistic.points[i].value, realistic: p.value, conservative: proj.scenarios.conservative.points[i].value };
    }).filter(function (r, i) { var step = Math.max(1, Math.ceil(pts.length / 6)); return i % step === 0 || i === pts.length - 1; });

    return e(UIC.ChartFrame, {
      'data-testid': 'projection', className: 'ui-pj',
      title: (props.scopeLabel ? props.scopeLabel + ' — ' : '') + __('pjTitle', 'Wealth Projection'),
      action: controls,
      summary: __('pjAria', 'Projection over {n} years: realistic {v}', { n: maxYear, v: money(realPts[realPts.length - 1].value) }),
      legend: SCN.map(function (s) { return { series: s.series, label: s.label, value: money(proj.scenarios[s.key].endValue) }; }),
      table: {
        rows: tableRows, rowKey: function (r) { return r.id; },
        columns: [{ key: 'year', label: __('pjYear', 'Year'), render: function (r) { return yearLabel(r.year); } }].concat(SCN.map(function (s) {
          return { key: s.key, label: s.label, align: 'right', render: function (r) { return money(r[s.key]); } };
        }))
      },
      source: __('pjFootnote', 'Projection over {n}y. Returns are assumptions ({rates} p.a.), not guarantees.', { n: window.MaerminI18n.num(Math.round(years * 10) / 10, { min: 0, max: 1 }), rates: window.MaerminI18n.pct(3, 0) + '/' + window.MaerminI18n.pct(6, 0) + '/' + window.MaerminI18n.pct(9, 0) })
    },
      // chart
      e('svg', { ref: svgRef, viewBox: '0 0 ' + W + ' ' + H, className: 'ui-pj__svg', 'aria-hidden': 'true' },
        // horizontal gridlines + Y value labels
        yTicks.map(function (v, i) {
          var yy = y(v);
          return e('g', { key: 'y' + i },
            e('line', { x1: padL, y1: yy, x2: W - padR, y2: yy, className: 'ui-pj__grid' }),
            e('text', { x: padL - 8, y: yy + 3, textAnchor: 'end', fontSize: 10, className: 'ui-pj__axis' }, compact(v))
          );
        }),
        // X year labels
        pts.map(function (p, i) {
          if (i % xStep !== 0 && i !== pts.length - 1) return null;
          if (i !== pts.length - 1 && pts.length - 1 - i < xStep / 2) return null; // too close to the last label
          return e('text', { key: 'x' + i, x: x(p), y: H - 10, textAnchor: 'middle', fontSize: 10, className: 'ui-pj__axis' }, yearLabel(p.year));
        }),
        // soft fill under the realistic curve
        e('path', { d: areaPath, className: 'ui-pj__area' }),
        // scenario lines
        SCN.map(function (s) { return e('path', { key: s.key, d: pathFor(s.key), fill: 'none', style: { stroke: s.color }, strokeWidth: s.key === 'realistic' ? 2.75 : 1.75, opacity: s.key === 'realistic' ? 1 : 0.85, strokeLinejoin: 'round', strokeLinecap: 'round' }); }),
        // end-point markers
        SCN.map(function (s) {
          var last = proj.scenarios[s.key].points[proj.scenarios[s.key].points.length - 1];
          return e('circle', { key: 'd' + s.key, cx: x(last), cy: y(last.value), r: s.key === 'realistic' ? 4 : 3, style: { fill: s.color, stroke: 'var(--surface)' }, strokeWidth: 1.5 });
        })
      ),
      // cashflow breakdown (realistic): money in, payouts, debt service (out, with its sign)
      e('div', { className: 'ui-tiles' },
        e(UIC.Stat, { className: 'ui-tile', label: __('pjContributions', 'Contributions'), value: money(proj.scenarios.realistic.totalContributions) }),
        e(UIC.Stat, { className: 'ui-tile', label: __('attrDividends', 'Dividends'), value: money(proj.scenarios.realistic.totalDividends), tone: proj.scenarios.realistic.totalDividends > 0 ? 'income' : null }),
        e(UIC.Stat, { className: 'ui-tile', label: __('pjDebtService', 'Debt service'), value: (proj.scenarios.realistic.totalLiabilityPayments > 0 ? '−' : '') + money(Math.abs(proj.scenarios.realistic.totalLiabilityPayments)) }))
    );
  }

  var api = {
    PER_YEAR: PER_YEAR,
    DEFAULT_SCENARIOS: DEFAULT_SCENARIOS,
    toMonthly: toMonthly,
    monthlyContributionFromPlans: monthlyContributionFromPlans,
    monthlyLiabilityFromAccounts: monthlyLiabilityFromAccounts,
    simulate: simulate,
    projectPortfolio: projectPortfolio,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminProjection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
