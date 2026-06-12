// Node harness for the risk/drift monitor pure layer: settings sanitisation,
// the current-drawdown helper, rule evaluation with configurable thresholds,
// severity escalation, the notification dedupe state machine, and the advisor
// integration (bundle.riskMonitor findings). The React Panel is browser-only
// and covered by smoke-views.
// Run: node test/risk-monitor.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

// Minimal localStorage so settings/state stores are exercised for real.
const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const R = require('../risk-monitor.js');

(function run() {
  console.log('risk-monitor:');

  // ---- settings ----------------------------------------------------------------
  const def = R.loadSettings();
  ok('defaults load when nothing stored', def.maxPositionPct === 25 && def.maxDrawdownPct === 20 && def.notify === false);
  const saved = R.saveSettings({ maxPositionPct: 30, maxDriftPct: -5, maxVolatilityPct: 'junk', notify: true });
  ok('saveSettings keeps valid values', saved.maxPositionPct === 30 && saved.notify === true);
  ok('saveSettings replaces invalid values with defaults', saved.maxDriftPct === 10 && saved.maxVolatilityPct === 25);
  ok('settings persist', R.loadSettings().maxPositionPct === 30);
  _store[R.SETTINGS_KEY] = '{broken';
  ok('corrupt settings read as defaults', R.loadSettings().maxPositionPct === 25);
  delete _store[R.SETTINGS_KEY];

  // ---- currentDrawdown ------------------------------------------------------------
  ok('drawdown from peak to last', approx(R.currentDrawdown([100, 120, 90, 96]), (120 - 96) / 120));
  ok('at the peak → zero drawdown', R.currentDrawdown([80, 90, 100]) === 0);
  ok('too-short series → null', R.currentDrawdown([100]) === null && R.currentDrawdown(null) === null);
  ok('junk values → null', R.currentDrawdown([100, 'x', 90]) === null);

  // ---- evaluate ---------------------------------------------------------------------
  const settings = R.sanitizeSettings({ maxPositionPct: 25, maxEffectivePct: 15, maxDriftPct: 10, maxDrawdownPct: 20, maxVolatilityPct: 25 });

  const calm = R.evaluate({ maxPositionPct: 12, driftPct: 4, drawdownPct: 8, volatilityPct: 14 }, settings);
  ok('calm portfolio breaches nothing', calm.alerts.length === 0 && calm.available === true);
  ok('all five rules are reported as checks', calm.checks.length === 5);
  ok('missing input → rule unavailable, not breached', calm.checks.find((c) => c.id === 'effective').available === false);

  const hot = R.evaluate({
    maxPositionPct: 32, topPositionLabel: 'NVDA',
    effectivePct: 18, effectiveLabel: 'Nvidia', effectiveFunds: ['VWCE', 'QQQ'],
    driftPct: 22, driftClass: 'crypto',
    drawdownPct: 24, volatilityPct: 41
  }, settings);
  ok('every crossed rule alerts', hot.alerts.length === 5);
  const pos = hot.alerts.find((a) => a.id === 'position');
  ok('alert carries value and limit', /32.0%/.test(pos.title) && /25%/.test(pos.title));
  ok('alert detail names the position', pos.detail === 'NVDA');
  ok('moderate breach is a warning', pos.severity === 'warning');
  ok('1.5x breach escalates to critical', hot.alerts.find((a) => a.id === 'drift').severity === 'critical');
  const eff = hot.alerts.find((a) => a.id === 'effective');
  ok('look-through alert names the funds', /Nvidia via VWCE, QQQ/.test(eff.detail));

  ok('value at the limit does not breach', R.evaluate({ driftPct: 10 }, settings).alerts.length === 0);
  const empty = R.evaluate({}, settings);
  ok('no inputs → unavailable, no alerts', empty.available === false && empty.alerts.length === 0);

  const custom = R.evaluate({ maxPositionPct: 32 }, R.sanitizeSettings({ maxPositionPct: 40 }));
  ok('user threshold is honored', custom.alerts.length === 0);

  // ---- shouldNotify (dedupe state machine) ----------------------------------------------
  const now = 1700000000000;
  const HOUR = 3600000;
  const alerts = hot.alerts;

  const first = R.shouldNotify({}, alerts, now, 24 * HOUR);
  ok('first crossing notifies everything', first.toNotify.length === 5);
  ok('state records the firing time', first.nextState.position === now);

  const second = R.shouldNotify(first.nextState, alerts, now + HOUR, 24 * HOUR);
  ok('within cooldown nothing re-notifies', second.toNotify.length === 0);
  ok('state keeps the original timestamps', second.nextState.position === now);

  const later = R.shouldNotify(first.nextState, alerts, now + 25 * HOUR, 24 * HOUR);
  ok('after cooldown the rule re-notifies', later.toNotify.length === 5 && later.nextState.position === now + 25 * HOUR);

  const recovered = R.shouldNotify(first.nextState, [], now + HOUR, 24 * HOUR);
  ok('recovered rules drop out of the state', Object.keys(recovered.nextState).length === 0);
  const reCrossed = R.shouldNotify(recovered.nextState, [alerts[0]], now + 2 * HOUR, 24 * HOUR);
  ok('a fresh crossing after recovery notifies immediately', reCrossed.toNotify.length === 1);

  // notify-state persistence round trip
  R.saveNotifyState(first.nextState);
  ok('notify state persists', R.loadNotifyState().position === now);
  _store[R.STATE_KEY] = 'not json';
  ok('corrupt notify state reads as empty', Object.keys(R.loadNotifyState()).length === 0);

  // ---- advisor integration (bundle.riskMonitor) ----------------------------------------
  const A = require('../advisor.js');
  const report = A.analyzeFromMetrics({ riskMonitor: hot });
  const rmFindings = report.findings.filter((f) => f.category === 'Risk monitor');
  ok('advisor surfaces drawdown + volatility breaches', rmFindings.length === 2);
  ok('advisor does not duplicate concentration/drift findings',
    rmFindings.every((f) => f.id !== 'riskmon-position' && f.id !== 'riskmon-drift' && f.id !== 'riskmon-effective'));
  ok('advisor keeps the monitor severity', rmFindings.every((f) => f.severity === 'critical' || f.severity === 'warning'));
  const calmReport = A.analyzeFromMetrics({ riskMonitor: calm });
  ok('calm monitor adds no findings', calmReport.findings.every((f) => f.category !== 'Risk monitor'));

  // gatherBundle unit fix: a fraction maxWeight from computeConcentration must
  // reach analyzeFromMetrics as percent. Simulated via the pure layer contract:
  const concPct = A.analyzeFromMetrics({ concentration: { available: true, maxWeight: 42, effectiveN: 2, top: [{ symbol: 'NVDA' }] } });
  ok('percent concentration still fires (contract unchanged)', concPct.findings.some((f) => f.id === 'conc-critical'));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
