// ============================================================================
// MAERMIN — Simulator panel  (window.MaerminSimulatorView)
// ----------------------------------------------------------------------------
// Folds the already-tested MaerminAnalytics simulator (Future Value, FIRE,
// Withdrawal, Monte-Carlo success probability) into the existing Monte-Carlo
// view. No new math lives here — `buildResults` maps the panel inputs onto the
// engine, so it stays the single source of truth. `buildResults`/`defaults`
// are pure + dual-exported for Node tests; the React panel is browser-only.
// ============================================================================
(function () {
  'use strict';

  var MODES = [
    { id: 'future',     label: 'Future Value' },
    { id: 'fire',       label: 'FIRE' },
    { id: 'withdraw',   label: 'Withdrawal' },
    { id: 'montecarlo', label: 'Monte Carlo' }
  ];

  function defaults(startValue) {
    return {
      startValue: Math.max(0, Math.round(startValue || 0)),
      monthly: 500, annualReturn: 7, years: 20,
      annualExpenses: 24000, withdrawalRate: 4,
      annualWithdrawal: 24000, inflation: 2,
      volatility: 15, paths: 2000
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
    if (mode === 'montecarlo') {
      return Object.assign({ mode: mode }, A.monteCarlo({
        startValue: inp.startValue, monthlyContribution: inp.monthly,
        annualReturn: inp.annualReturn / 100, volatility: inp.volatility / 100,
        years: inp.years, annualWithdrawal: inp.annualWithdrawal || 0,
        paths: inp.paths || 2000, seed: 12345
      }));
    }
    return null;
  }

  // Which inputs each mode surfaces (keeps the form relevant per mode).
  var FIELDS = {
    future:     [['startValue', 'Current value', ''], ['monthly', 'Monthly contribution', ''], ['annualReturn', 'Annual return', '%'], ['years', 'Years', '']],
    fire:       [['startValue', 'Current value', ''], ['monthly', 'Monthly contribution', ''], ['annualReturn', 'Real return', '%'], ['annualExpenses', 'Annual expenses', ''], ['withdrawalRate', 'Withdrawal rate', '%']],
    withdraw:   [['startValue', 'Start value', ''], ['annualWithdrawal', 'Annual withdrawal', ''], ['annualReturn', 'Annual return', '%'], ['inflation', 'Inflation', '%'], ['years', 'Years', '']],
    montecarlo: [['startValue', 'Start value', ''], ['monthly', 'Monthly contribution', ''], ['annualReturn', 'Mean return', '%'], ['volatility', 'Volatility', '%'], ['years', 'Years', '']]
  };

  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var h = React.createElement;
    var theme = props.theme || {};
    var fmt = props.formatPrice || function (n) { return Math.round(n).toLocaleString(); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '';
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var accent = theme.accent || '#f5a524', border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', ok = theme.success || '#22c55e', bad = theme.danger || '#ef4444';

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
      return h('div', { key: key, style: { display: 'flex', flexDirection: 'column', gap: '0.25rem' } },
        h('label', { style: { color: dim, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label + (suffix ? ' (' + suffix + ')' : '')),
        h('input', { type: 'number', value: inputs[key], onChange: function (e) { setField(key, e.target.value); },
          style: { padding: '0.5rem 0.6rem', background: inputBg, border: '1px solid ' + border, borderRadius: '8px', color: text, fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' } })
      );
    }
    function stat(label, value, color) {
      return h('div', { style: { background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.8rem 1rem' } },
        h('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label),
        h('div', { style: { color: color || text, fontSize: '1.05rem', fontWeight: '700', marginTop: '0.2rem' } }, value)
      );
    }

    function results() {
      if (!window.MaerminAnalytics) return h('div', { style: { color: dim, fontSize: '0.85rem' } }, 'Analytics engine unavailable.');
      if (!res) return null;
      var cards = [];
      if (mode === 'future') {
        cards = [stat('Projected value', money(res.projected), accent), stat('Total contributions', money(res.contributions)), stat('Investment growth', money(res.growth), ok)];
      } else if (mode === 'fire') {
        if (!res.configured) return h('div', { style: { color: dim, fontSize: '0.85rem' } }, 'Enter your annual expenses to compute your FIRE number.');
        cards = [
          stat('FIRE number', money(res.fireNumber), accent),
          stat('Progress', (res.currentProgress || 0).toFixed(1) + '%', res.currentProgress >= 100 ? ok : text),
          stat('Years to FIRE', res.yearsToFire == null ? '100+' : res.yearsToFire, res.reached ? ok : text),
          stat('Projected at FIRE', money(res.projectedValueAtFire))
        ];
      } else if (mode === 'withdraw') {
        cards = [
          stat('Outcome', res.survives ? 'Survives the horizon' : 'Depletes', res.survives ? ok : bad),
          stat('Depletes in year', res.depletedYear == null ? '—' : ('Year ' + res.depletedYear), res.depletedYear == null ? ok : bad),
          stat('Ending balance', money(res.endingBalance), res.endingBalance > 0 ? ok : bad)
        ];
      } else if (mode === 'montecarlo') {
        cards = [
          stat('Success rate', (res.successRate * 100).toFixed(1) + '%', res.successRate >= 0.8 ? ok : (res.successRate >= 0.5 ? accent : bad)),
          stat('Median ending', money(res.median), accent),
          stat('Pessimistic (P10)', money(res.p10), bad),
          stat('Optimistic (P90)', money(res.p90), ok)
        ];
      }
      return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '0.6rem', marginTop: '1rem' } }, cards);
    }

    return h('div', { style: { background: theme.cardBg || 'transparent', border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1rem 1.5rem' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.9rem' } },
        h('h3', { style: { color: text, fontSize: '1rem', fontWeight: '700', margin: 0 } }, 'Planning simulator'),
        h('div', { style: { display: 'flex', gap: '0.3rem', flexWrap: 'wrap' } }, MODES.map(function (m) {
          return h('button', { key: m.id, onClick: function () { setMode(m.id); }, style: { padding: '0.35rem 0.75rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: mode === m.id ? '700' : '500', background: mode === m.id ? accent : inputBg, color: mode === m.id ? '#13110a' : dim } }, m.label);
        }))
      ),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '0.6rem' } }, (FIELDS[mode] || []).map(function (f) { return field(f[0], f[1], f[2]); })),
      results(),
      h('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.8rem', lineHeight: '1.5' } }, 'Projections are assumption-based estimates, not guarantees. Monte-Carlo uses a fixed seed for reproducibility.')
    );
  }

  var api = { MODES: MODES, defaults: defaults, buildResults: buildResults, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminSimulatorView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
