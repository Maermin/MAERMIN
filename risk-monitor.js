// ============================================================================
// MAERMIN — Continuous risk & drift monitoring  (window.MaerminRiskMonitor)
// ----------------------------------------------------------------------------
// Feature: rule-based structural risk alerts with user-configurable thresholds
// (what Guardfolio positions itself on). Five rules:
//
//   position    a single position exceeds the concentration limit
//   effective   a single security exceeds the limit counting ETF holdings
//               (the look-through limit, fed by MaerminLookThrough)
//   drift       allocation drifts past the threshold from the rebalancing target
//   drawdown    the portfolio falls past the threshold from its peak
//   volatility  annualised rolling volatility crosses the threshold
//
// NO new analytics engine: concentration/drift come from MaerminMetrics, the
// value path from MaerminAnalyticsData, volatility from MaerminAnalytics, the
// effective exposure from MaerminLookThrough. This module only owns the RULE
// EVALUATION (pure, Node-tested), the threshold settings, and the notification
// dedupe. Notifications reuse the existing PWA plumbing (MaerminPWA.notify);
// findings surface through the existing MaerminAdvisor (bundle.riskMonitor).
// The panel folds into the Alerts view; nothing here is a new tab.
//
// Persistence: thresholds + last-notified state in localStorage. Both hold
// only rule ids, percentages and timestamps — no amounts, not sensitive.
// ============================================================================
(function () {
  'use strict';

  var SETTINGS_KEY = 'maermin_risk_monitor';
  var STATE_KEY = 'maermin_risk_monitor_state';

  // Thresholds are PERCENT values (user-facing); cooldown limits re-notifying.
  var DEFAULTS = {
    maxPositionPct: 25,
    maxEffectivePct: 15,
    maxDriftPct: 10,
    maxDrawdownPct: 20,
    maxVolatilityPct: 25,
    cooldownHours: 24,
    notify: false
  };

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  // ---- settings ---------------------------------------------------------------
  function sanitizeSettings(raw) {
    raw = (raw && typeof raw === 'object') ? raw : {};
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      if (k === 'notify') { s.notify = raw.notify != null ? !!raw.notify : DEFAULTS.notify; return; }
      var v = num(raw[k]);
      s[k] = (v != null && v > 0 && v <= 1000) ? v : DEFAULTS[k];
    });
    return s;
  }
  function loadSettings() {
    try { return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
    catch (e) { return sanitizeSettings({}); }
  }
  function saveSettings(s) {
    var clean = sanitizeSettings(s);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean)); } catch (e) { /* non-fatal */ }
    return clean;
  }

  // ---- small series helper ------------------------------------------------------
  // Current drawdown from the running peak to the LAST value (fraction).
  // MaerminAnalytics.maxDrawdown reports the worst historical trough; the live
  // monitor cares about where the portfolio stands right now.
  function currentDrawdown(series) {
    if (!Array.isArray(series) || series.length < 2) return null;
    var peak = -Infinity;
    for (var i = 0; i < series.length; i++) {
      var v = num(series[i]);
      if (v == null) return null;
      if (v > peak) peak = v;
    }
    if (peak <= 0) return null;
    var last = series[series.length - 1];
    return Math.max(0, (peak - last) / peak);
  }

  // ---- rule evaluation (PURE) ----------------------------------------------------
  // inputs (all optional; missing → the rule reports available:false):
  //   maxPositionPct, topPositionLabel
  //   effectivePct, effectiveLabel, effectiveFunds[]   (from look-through)
  //   driftPct, driftClass
  //   drawdownPct
  //   volatilityPct
  // settings: see DEFAULTS. Returns { available, checks, alerts } where checks
  // covers every rule (for the status UI) and alerts only the breached ones.
  function evaluate(inputs, settings) {
    inputs = inputs || {};
    settings = sanitizeSettings(settings || loadSettingsSafe());

    function check(id, label, valuePct, thresholdPct, detail) {
      var available = valuePct != null;
      var breached = available && valuePct > thresholdPct;
      return {
        id: id, label: label, available: available,
        valuePct: available ? valuePct : null,
        thresholdPct: thresholdPct,
        breached: breached,
        detail: detail || ''
      };
    }

    var checks = [
      check('position', 'Largest position', num(inputs.maxPositionPct), settings.maxPositionPct,
        inputs.topPositionLabel ? String(inputs.topPositionLabel) : ''),
      check('effective', 'Largest effective exposure (look-through)', num(inputs.effectivePct), settings.maxEffectivePct,
        inputs.effectiveLabel ? String(inputs.effectiveLabel) + (inputs.effectiveFunds && inputs.effectiveFunds.length ? ' via ' + inputs.effectiveFunds.join(', ') : '') : ''),
      check('drift', 'Allocation drift from target', num(inputs.driftPct), settings.maxDriftPct,
        inputs.driftClass ? String(inputs.driftClass) : ''),
      check('drawdown', 'Drawdown from peak', num(inputs.drawdownPct), settings.maxDrawdownPct, ''),
      check('volatility', 'Volatility (annualised)', num(inputs.volatilityPct), settings.maxVolatilityPct, '')
    ];

    var alerts = checks.filter(function (c) { return c.breached; }).map(function (c) {
      var severity = c.valuePct >= c.thresholdPct * 1.5 ? 'critical' : 'warning';
      return {
        id: c.id,
        severity: severity,
        title: c.label + ' at ' + c.valuePct.toFixed(1) + '% (limit ' + c.thresholdPct + '%)',
        detail: c.detail,
        metric: c.valuePct,
        threshold: c.thresholdPct
      };
    });

    return {
      available: checks.some(function (c) { return c.available; }),
      checks: checks,
      alerts: alerts
    };
  }
  function loadSettingsSafe() { try { return loadSettings(); } catch (e) { return sanitizeSettings({}); } }

  // ---- notification dedupe (PURE) --------------------------------------------------
  // prevState: { ruleId: lastNotifiedMs }. A rule notifies when it is breached
  // and was either not breached before (entry pruned on recovery → a fresh
  // crossing re-notifies immediately) or its cooldown has elapsed.
  function shouldNotify(prevState, alerts, nowMs, cooldownMs) {
    prevState = (prevState && typeof prevState === 'object') ? prevState : {};
    alerts = alerts || [];
    nowMs = nowMs != null ? nowMs : Date.now();
    cooldownMs = cooldownMs != null ? cooldownMs : DEFAULTS.cooldownHours * 3600000;
    var toNotify = [];
    var nextState = {};
    alerts.forEach(function (a) {
      var last = num(prevState[a.id]);
      if (last == null || nowMs - last >= cooldownMs) {
        toNotify.push(a);
        nextState[a.id] = nowMs;
      } else {
        nextState[a.id] = last;
      }
    });
    // Rules no longer breached drop out of the state on purpose (see above).
    return { toNotify: toNotify, nextState: nextState };
  }

  function loadNotifyState() {
    try {
      var s = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
      return (s && typeof s === 'object') ? s : {};
    } catch (e) { return {}; }
  }
  function saveNotifyState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s || {})); } catch (e) { /* non-fatal */ }
  }

  // ---- browser glue ------------------------------------------------------------------
  // Gather rule inputs from the existing engines (single sources of truth).
  // lookThrough is optional — pass MaerminLookThrough.analyze()'s result when a
  // view already has it; the monitor degrades to the direct-position rule.
  function gatherInputs(portfolio, prices, priceHistory, lookThrough) {
    var inputs = {};
    var w = (typeof window !== 'undefined') ? window : {};
    var M = w.MaerminMetrics, D = w.MaerminAnalyticsData, A = w.MaerminAnalytics;

    try {
      var conc = M && M.computeConcentration(portfolio, prices);
      if (conc && conc.available) {
        inputs.maxPositionPct = conc.maxWeight * 100; // PortfolioHealth reports a fraction
        var top = conc.top && conc.top[0];
        inputs.topPositionLabel = top ? (top.label || top.symbol || top.name) : '';
      }
    } catch (e) {}

    try {
      var drift = M && M.computeRebalancingDrift(portfolio, prices);
      if (drift && drift.available) {
        inputs.driftPct = drift.maxDrift;
        var worst = (drift.rows || []).slice().sort(function (a, b) { return Math.abs(b.drift) - Math.abs(a.drift); })[0];
        inputs.driftClass = worst ? worst.cls : '';
      }
    } catch (e) {}

    try {
      if (lookThrough && lookThrough.available && lookThrough.hiddenConcentrations && lookThrough.hiddenConcentrations.length) {
        var hc = lookThrough.hiddenConcentrations[0];
        inputs.effectivePct = hc.effectiveWeight * 100;
        inputs.effectiveLabel = hc.name || hc.key;
        inputs.effectiveFunds = hc.funds || [];
      }
    } catch (e) {}

    try {
      var series = D && D.buildValueSeries(portfolio, priceHistory);
      if (series && series.length >= 2) {
        var dd = currentDrawdown(series);
        if (dd != null) inputs.drawdownPct = dd * 100;
        if (A && series.length >= 5) {
          var returns = D.toReturns(series);
          var win = Math.max(2, Math.min(10, Math.floor(returns.length / 2)));
          var rvol = A.rollingVolatility(returns, win, 252);
          if (rvol && rvol.length) inputs.volatilityPct = rvol[rvol.length - 1] * 100;
        }
      }
    } catch (e) {}

    return inputs;
  }

  // Evaluate + dedupe + local PWA notification. Called from the renderer after
  // each price refresh, so monitoring runs while the app is open regardless of
  // the active view. Returns the evaluation (or null when nothing is known).
  function checkAndNotify(portfolio, prices, priceHistory, lookThrough) {
    var settings = loadSettings();
    var result = evaluate(gatherInputs(portfolio, prices, priceHistory, lookThrough), settings);
    if (!result.available) return null;
    var decision = shouldNotify(loadNotifyState(), result.alerts, Date.now(), settings.cooldownHours * 3600000);
    saveNotifyState(decision.nextState);
    if (settings.notify && decision.toNotify.length) {
      var pwa = (typeof window !== 'undefined') && window.MaerminPWA;
      if (pwa && pwa.notify) {
        decision.toNotify.forEach(function (a) {
          try { pwa.notify('MAERMIN risk alert', { body: a.title + (a.detail ? ' - ' + a.detail : ''), tag: 'maermin-risk-' + a.id }); } catch (e) {}
        });
      }
    }
    result.notified = decision.toNotify;
    return result;
  }

  // ---- React Panel (browser only; folds into the Alerts view) -------------------
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var good = theme.success || '#22c55e', warn = theme.warning || '#f59e0b', bad = theme.danger || theme.negative || '#ef4444';

    var sSettings = React.useState(loadSettings);
    var settings = sSettings[0], setSettings = sSettings[1];

    var result = evaluate(
      gatherInputs(props.portfolio, props.prices, props.priceHistory, props.lookThrough),
      settings
    );

    function commit(key, raw) {
      var next = {};
      for (var k in settings) next[k] = settings[k];
      next[key] = raw;
      setSettings(saveSettings(next));
    }

    var FIELDS = [
      { key: 'maxPositionPct', rule: 'position' },
      { key: 'maxEffectivePct', rule: 'effective' },
      { key: 'maxDriftPct', rule: 'drift' },
      { key: 'maxDrawdownPct', rule: 'drawdown' },
      { key: 'maxVolatilityPct', rule: 'volatility' }
    ];

    var rows = FIELDS.map(function (f) {
      var c = result.checks.filter(function (x) { return x.id === f.rule; })[0];
      var statusColor = !c.available ? dim : (c.breached ? (c.valuePct >= c.thresholdPct * 1.5 ? bad : warn) : good);
      var statusText = !c.available ? 'no data' : (c.breached ? 'BREACH' : 'ok');
      return e('tr', { key: f.rule, style: { borderTop: '1px solid ' + border } },
        e('td', { style: { padding: '0.45rem 0.5rem', color: text, fontSize: '0.8rem' } }, c.label,
          c.detail ? e('span', { style: { color: dim, fontSize: '0.7rem' } }, '  ' + c.detail) : null),
        e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: c.available ? text : dim, fontSize: '0.78rem', fontWeight: 600 } },
          c.available ? c.valuePct.toFixed(1) + '%' : '-'),
        e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right' } },
          e('input', {
            type: 'number', min: 1, max: 1000, value: settings[f.key],
            onChange: function (ev) { commit(f.key, ev.target.value); },
            style: { width: '64px', background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.25rem 0.4rem', color: text, fontSize: '0.74rem', textAlign: 'right' }
          }),
          e('span', { style: { color: dim, fontSize: '0.72rem', marginLeft: '0.25rem' } }, '%')),
        e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: statusColor, fontSize: '0.74rem', fontWeight: 700 } }, statusText));
    });

    var pwa = (typeof window !== 'undefined') && window.MaerminPWA;
    var permission = pwa && pwa.notificationPermission ? pwa.notificationPermission() : 'denied';

    function toggleNotify() {
      if (!settings.notify && pwa && pwa.requestNotifications && permission !== 'granted') {
        pwa.requestNotifications().then(function () { setSettings(saveSettings(Object.assign({}, settings, { notify: true }))); });
      } else {
        setSettings(saveSettings(Object.assign({}, settings, { notify: !settings.notify })));
      }
    }

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '0 1.5rem 1.5rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.9rem' } },
        e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: 0 } }, t.riskMonitorTitle || 'Risk & drift monitor'),
        e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
          e('span', { style: { color: dim, fontSize: '0.74rem' } }, 'Cooldown'),
          e('input', {
            type: 'number', min: 1, max: 168, value: settings.cooldownHours,
            onChange: function (ev) { commit('cooldownHours', ev.target.value); },
            style: { width: '52px', background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.25rem 0.4rem', color: text, fontSize: '0.74rem', textAlign: 'right' }
          }),
          e('span', { style: { color: dim, fontSize: '0.74rem' } }, 'h'),
          e('button', {
            onClick: toggleNotify,
            style: { padding: '0.35rem 0.8rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.76rem', fontWeight: 700, background: settings.notify ? good : inputBg, color: settings.notify ? '#08130a' : dim }
          }, settings.notify ? 'Notifications on' : 'Notifications off'))),
      e('div', { style: { overflowX: 'auto' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          e('thead', null, e('tr', null, ['Rule', 'Current', 'Limit', 'Status'].map(function (h, i) {
            return e('th', { key: h, style: { textAlign: i === 0 ? 'left' : 'right', padding: '0.4rem 0.5rem', color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
          }))),
          e('tbody', null, rows))),
      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.7rem', lineHeight: 1.5 } },
        'Structural rules evaluated on every price refresh while the app is open. The look-through rule needs fund data (open Health once to resolve it); drawdown and volatility need a short portfolio price history. Notifications are local on this device.'));
  }

  var api = {
    DEFAULTS: DEFAULTS,
    SETTINGS_KEY: SETTINGS_KEY,
    STATE_KEY: STATE_KEY,
    sanitizeSettings: sanitizeSettings,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    currentDrawdown: currentDrawdown,
    evaluate: evaluate,
    shouldNotify: shouldNotify,
    loadNotifyState: loadNotifyState,
    saveNotifyState: saveNotifyState,
    gatherInputs: gatherInputs,
    checkAndNotify: checkAndNotify,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminRiskMonitor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
