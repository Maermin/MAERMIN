// ============================================================================
// MAERMIN — Simulator panel  (window.MaerminSimulatorView)
// ----------------------------------------------------------------------------
// Folds the already-tested MaerminAnalytics simulator (Future Value, FIRE,
// Withdrawal) into the existing Monte-Carlo view, below the one Monte-Carlo
// simulation (monte-carlo-engine.js). No new math lives here — `buildResults` maps the panel inputs onto the
// engine, so it stays the single source of truth. `buildResults`/`defaults`
// are pure + dual-exported for Node tests; the React panel is browser-only.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var MODES = [
    { id: 'future',     label: 'Future Value' },
    { id: 'fire',       label: 'FIRE' },
    { id: 'withdraw',   label: 'Withdrawal' }
  ];

  function defaults(startValue) {
    return {
      startValue: Math.max(0, Math.round(startValue || 0)),
      monthly: 500, annualReturn: 7, years: 20,
      annualExpenses: 24000, withdrawalRate: 4,
      annualWithdrawal: 24000, inflation: 2
    };
  }

  // Map panel inputs (percent fields as whole numbers) onto the engine. `engine`
  // is injectable so Node tests pass the real MaerminAnalytics module.
  function buildResults(mode, inp, engine) {
    var A = engine || (typeof window !== 'undefined' && window.MaerminAnalytics);
    if (!A || !inp) return null;
    if (mode === 'future') {
      var fv = A.futureValue(inp.startValue, inp.monthly, inp.annualReturn / 100, inp.years);
      var contributions = inp.startValue + inp.monthly * 12 * inp.years;
      return { mode: mode, projected: fv, contributions: contributions, growth: fv - contributions };
    }
    if (mode === 'fire') {
      return Object.assign({ mode: mode }, A.fireProjection({
        currentValue: inp.startValue, monthlyContribution: inp.monthly,
        annualReturn: inp.annualReturn / 100, annualExpenses: inp.annualExpenses,
        withdrawalRate: inp.withdrawalRate
      }));
    }
    if (mode === 'withdraw') {
      return Object.assign({ mode: mode }, A.withdrawalSimulation({
        startValue: inp.startValue, annualWithdrawal: inp.annualWithdrawal,
        annualReturn: inp.annualReturn / 100, inflation: inp.inflation / 100, years: inp.years
      }));
    }
    return null;
  }

  // Which inputs each mode surfaces (keeps the form relevant per mode).
  var FIELDS = {
    future:     [['startValue', __('simCurrentValue', 'Current value'), ''], ['monthly', __('simMonthlyContrib', 'Monthly contribution'), ''], ['annualReturn', __('simAnnualReturn', 'Annual return'), '%'], ['years', __('simYears', 'Years'), '']],
    fire:       [['startValue', __('simCurrentValue', 'Current value'), ''], ['monthly', __('simMonthlyContrib', 'Monthly contribution'), ''], ['annualReturn', __('simRealReturn', 'Real return'), '%'], ['annualExpenses', __('fireAnnualExpenses', 'Annual expenses'), ''], ['withdrawalRate', __('fireWithdrawalRate', 'Withdrawal rate'), '%']],
    withdraw:   [['startValue', __('simStartValue', 'Start value'), ''], ['annualWithdrawal', __('simAnnualWithdrawal', 'Annual withdrawal'), ''], ['annualReturn', __('simAnnualReturn', 'Annual return'), '%'], ['inflation', __('simInflation', 'Inflation'), '%'], ['years', __('simYears', 'Years'), '']]
  };

  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var h = React.createElement;
    var fmt = props.formatPrice || function (n) { return window.MaerminI18n.num(Math.round(n), 0); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '';
    // R4.5: the shared Card, Segmented, Field inputs and Stat tiles
    var UIC = window.MaerminComponents;

    var sMode = React.useState('future'); var mode = sMode[0], setMode = sMode[1];
    var sIn = React.useState(function () { return defaults(props.startValue); });
    var inputs = sIn[0], setInputs = sIn[1];

    // Keep startValue synced if the portfolio value loads after first render.
    React.useEffect(function () {
      setInputs(function (prev) { return Object.assign({}, prev, { startValue: Math.max(0, Math.round(props.startValue || 0)) }); });
    }, [props.startValue]);

    var res = buildResults(mode, inputs, window.MaerminAnalytics);
    var money = function (n) { return fmt(n) + (sym ? ' ' + sym : ''); };

    function setField(key, val) {
      var num = parseFloat(val);
      setInputs(function (prev) { var n = Object.assign({}, prev); n[key] = isNaN(num) ? 0 : num; return n; });
    }
    function field(key, label, suffix) {
      return h(UIC.Input, { key: key, type: 'number', label: label + (suffix ? ' (' + suffix + ')' : ''), value: inputs[key], onChange: function (e) { setField(key, e.target.value); } });
    }
    function stat(label, value, tone) {
      return h(UIC.Stat, { key: label, className: 'ui-tile', label: label, value: value, tone: tone || null });
    }

    function results() {
      if (!window.MaerminAnalytics) return h('p', { className: 'ui-muted' }, __('simEngineMissing', 'Analytics engine unavailable.'));
      if (!res) return null;
      var cards = [];
      if (mode === 'future') {
        cards = [stat(__('simProjected', 'Projected value'), money(res.projected)), stat(__('simTotalContrib', 'Total contributions'), money(res.contributions)),
          stat(__('simGrowth', 'Investment growth'), (res.growth > 0 ? '+' : res.growth < 0 ? '−' : '') + money(Math.abs(res.growth)), UIC.toneOf(res.growth))];
      } else if (mode === 'fire') {
        if (!res.configured) return h('p', { className: 'ui-muted' }, __('simNeedExpenses', 'Enter your annual expenses to compute your FIRE number.'));
        cards = [
          stat(__('simFireNumber', 'FIRE number'), money(res.fireNumber)),
          stat(__('simProgress', 'Progress'), window.MaerminI18n.pct(res.currentProgress || 0, 1), res.currentProgress >= 100 ? 'gain' : null),
          stat(__('simYearsToFire', 'Years to FIRE'), res.yearsToFire == null ? '100+' : String(res.yearsToFire), res.reached ? 'gain' : null),
          stat(__('simProjectedAtFire', 'Projected at FIRE'), money(res.projectedValueAtFire))
        ];
      } else if (mode === 'withdraw') {
        cards = [
          stat(__('simOutcome', 'Outcome'), res.survives ? '✓ ' + __('simSurvives', 'Survives the horizon') : '✗ ' + __('simDepletes', 'Depletes'), res.survives ? 'gain' : 'loss'),
          stat(__('simDepletesYear', 'Depletes in year'), res.depletedYear == null ? '—' : __('dcYear', 'Year {y}', { y: res.depletedYear }), res.depletedYear == null ? null : 'loss'),
          stat(__('simEndingBalance', 'Ending balance'), money(res.endingBalance), res.endingBalance > 0 ? null : 'loss')
        ];
      }
      return h('div', { className: 'ui-tiles' }, cards);
    }

    return h(UIC.Card, { 'data-testid': 'simulator', title: __('simTitle', 'Planning simulator'), headingLevel: 'h3', className: 'ui-sim',
      action: h(UIC.Segmented, { label: __('simTitle', 'Planning simulator'), size: 'sm', value: mode, onChange: setMode,
        options: MODES.map(function (m) { return { value: m.id, label: ({ future: __('simFuture', 'Future Value'), fire: 'FIRE', withdraw: __('simWithdraw', 'Withdrawal') })[m.id] || m.label }; }) }) },
      h('div', { className: 'ui-form-grid' }, (FIELDS[mode] || []).map(function (f) { return field(f[0], f[1], f[2]); })),
      results(),
      h('p', { className: 'ui-note' }, __('simFootnote', 'Projections are assumption-based estimates, not guarantees.'))
    );
  }

  var api = { MODES: MODES, defaults: defaults, buildResults: buildResults, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminSimulatorView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
