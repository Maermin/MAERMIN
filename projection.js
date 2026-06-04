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
    var theme = props.theme || {};
    var fmt = props.formatPrice || function (v) { return Math.round(v).toLocaleString('en-US'); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '';

    var hzState = React.useState(10); var years = hzState[0]; var setYears = hzState[1];
    var customState = React.useState(''); var custom = customState[0]; var setCustom = customState[1];

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

    var SCN = [
      { key: 'optimistic', color: '#22c55e', label: 'Optimistic' },
      { key: 'realistic', color: theme.accent || '#f5a524', label: 'Realistic' },
      { key: 'conservative', color: '#ef4444', label: 'Conservative' }
    ];

    // SVG line chart geometry
    var W = 640, H = 240, PAD = 8;
    var allVals = [];
    SCN.forEach(function (s) { proj.scenarios[s.key].points.forEach(function (p) { allVals.push(p.value); }); });
    var maxV = Math.max.apply(null, allVals.concat([1])), minV = Math.min.apply(null, allVals.concat([0]));
    var pts = proj.scenarios.realistic.points;
    function x(i) { return PAD + (i / (pts.length - 1 || 1)) * (W - 2 * PAD); }
    function y(v) { return H - PAD - ((v - minV) / (maxV - minV || 1)) * (H - 2 * PAD); }
    function pathFor(key) {
      return proj.scenarios[key].points.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.value).toFixed(1); }).join(' ');
    }

    var horizons = [1, 3, 5, 10];
    function hzBtn(yr) {
      return e('button', { key: yr, onClick: function () { setYears(yr); setCustom(''); },
        style: { padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid ' + (theme.cardBorder || '#333'),
          background: years === yr && !custom ? (theme.accent || '#f5a524') : 'transparent',
          color: years === yr && !custom ? '#13110a' : (theme.textSecondary || '#888'),
          cursor: 'pointer', fontSize: '0.78rem', fontWeight: years === yr ? 700 : 400 } }, yr + 'y');
    }

    return e('div', { style: { background: theme.card || '#10151f', border: '1px solid ' + (theme.cardBorder || 'rgba(255,255,255,0.08)'), borderRadius: '14px', padding: '1.25rem', marginBottom: '1.5rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' } },
        e('div', { style: { color: theme.text || '#e9edf4', fontWeight: 800, fontSize: '1rem' } },
          '📈 ' + (props.scopeLabel ? props.scopeLabel + ' — ' : '') + 'Wealth Projection'),
        e('div', { style: { display: 'flex', gap: '0.35rem', alignItems: 'center' } },
          horizons.map(hzBtn),
          e('input', { type: 'number', value: custom, placeholder: 'yr', onChange: function (ev) { setCustom(ev.target.value); var v = parseFloat(ev.target.value); if (v > 0) setYears(v); },
            style: { width: '54px', padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid ' + (theme.cardBorder || '#333'), background: theme.inputBg || '#0f172a', color: theme.text || '#fff', fontSize: '0.78rem' } })
        )
      ),
      // chart
      e('svg', { viewBox: '0 0 ' + W + ' ' + H, style: { width: '100%', height: 'auto', display: 'block' } },
        SCN.map(function (s) { return e('path', { key: s.key, d: pathFor(s.key), fill: 'none', stroke: s.color, strokeWidth: s.key === 'realistic' ? 2.5 : 1.5, opacity: s.key === 'realistic' ? 1 : 0.7 }); })
      ),
      // legend + end values
      e('div', { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.75rem' } },
        SCN.map(function (s) {
          return e('div', { key: s.key, style: { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' } },
            e('div', { style: { width: 10, height: 3, background: s.color } }),
            e('span', { style: { color: theme.textSecondary || '#888' } }, s.label),
            e('span', { style: { color: theme.text || '#fff', fontWeight: 700 } }, fmt(proj.scenarios[s.key].endValue) + ' ' + sym)
          );
        })
      ),
      // cashflow breakdown
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', marginTop: '0.9rem', fontSize: '0.76rem' } },
        [['Contributions', proj.scenarios.realistic.totalContributions, '#22c55e'],
         ['Dividends', proj.scenarios.realistic.totalDividends, theme.accent || '#f5a524'],
         ['Debt service', -proj.scenarios.realistic.totalLiabilityPayments, '#ef4444']
        ].map(function (row, i) {
          return e('div', { key: i, style: { background: theme.inputBg || 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '0.5rem 0.7rem' } },
            e('div', { style: { color: theme.textSecondary || '#888' } }, row[0]),
            e('div', { style: { color: row[2], fontWeight: 700 } }, fmt(Math.abs(row[1])) + ' ' + sym));
        })
      ),
      e('div', { style: { color: theme.textSecondary || '#888', fontSize: '0.68rem', marginTop: '0.6rem', opacity: 0.8 } },
        'Projection over ' + (Math.round(years * 10) / 10) + 'y. Returns are assumptions (3/6/9% p.a.), not guarantees.')
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
