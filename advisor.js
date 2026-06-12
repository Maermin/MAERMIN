// ============================================================================
// MAERMIN — AI Portfolio Advisor  (window.MaerminAdvisor)
// ----------------------------------------------------------------------------
// Epic 3. Two layers, NO new analytics engine (per the V7 rule it reads the one
// shared source, window.MaerminMetrics):
//
//   1. A DETERMINISTIC findings engine — concentration / diversification /
//      currency / rebalancing / dividend / tax-loss / health. Rule-based, always
//      available (works offline, no API key), produces ranked recommendations.
//   2. A natural-language CHAT layered on window.AICopilot, which receives those
//      findings as structured context — so the LLM explains real numbers instead
//      of hallucinating them.
//
// `analyzeFromMetrics(bundle, t)` is pure and unit-tested; `analyzePortfolio()`
// gathers the bundle from MaerminMetrics. UI (`Panel`) embeds into existing
// views (e.g. the Health view) rather than adding a tab.
// ============================================================================
(function () {
  'use strict';

  var SEVERITY_RANK = { critical: 0, warning: 1, opportunity: 2, info: 3, good: 4 };

  function pct(n) { return (Math.round((n || 0) * 10) / 10) + '%'; }
  function money(n) {
    var v = Math.round(n || 0);
    return v.toLocaleString('en-US');
  }

  // ---- deterministic findings (PURE) --------------------------------------
  // bundle: { concentration, currency, drift, dividends, taxLoss, health, totalValue }
  // Each is the shape MaerminMetrics returns. Returns ranked findings + summary.
  function analyzeFromMetrics(bundle, t) {
    bundle = bundle || {};
    var F = [];

    // 1) Concentration risk
    var c = bundle.concentration;
    if (c && c.available) {
      var topName = (c.top && c.top[0] && (c.top[0].label || c.top[0].symbol || c.top[0].name)) || 'Top position';
      if (c.maxWeight >= 30) {
        F.push({ id: 'conc-critical', severity: 'critical', category: 'Concentration',
          title: topName + ' is ' + pct(c.maxWeight) + ' of your portfolio',
          detail: 'A single holding above 30% drives most of your risk. Consider trimming toward a 20–25% cap.',
          action: 'Reduce ' + topName + ' or add uncorrelated positions.', metric: c.maxWeight });
      } else if (c.maxWeight >= 20) {
        F.push({ id: 'conc-warning', severity: 'warning', category: 'Concentration',
          title: topName + ' is ' + pct(c.maxWeight) + ' of your portfolio',
          detail: 'Above 20% in one position increases idiosyncratic risk.',
          action: 'Watch this weight; rebalance if it keeps growing.', metric: c.maxWeight });
      }
      // 2) Diversification (effective number of holdings)
      if (c.effectiveN && c.effectiveN < 3) {
        F.push({ id: 'div-low', severity: 'warning', category: 'Diversification',
          title: 'Low effective diversification (~' + (Math.round(c.effectiveN * 10) / 10) + ' holdings)',
          detail: 'Most of your money behaves like just a few bets. Spreading across more positions/sectors smooths returns.',
          action: 'Add positions in under-represented asset classes.', metric: c.effectiveN });
      } else if (c.effectiveN && c.effectiveN >= 8) {
        F.push({ id: 'div-good', severity: 'good', category: 'Diversification',
          title: 'Well diversified (~' + Math.round(c.effectiveN) + ' effective holdings)',
          detail: 'Risk is spread across many positions.', metric: c.effectiveN });
      }
    }

    // 3) Currency exposure
    var cur = bundle.currency;
    if (cur && cur.available && cur.rows && cur.rows.length) {
      var top = cur.rows[0];
      if (top.pct >= 80 && cur.currencyCount > 1) {
        F.push({ id: 'fx-warning', severity: 'warning', category: 'Currency',
          title: pct(top.pct) + ' of assets are in ' + top.currency,
          detail: 'Heavy single-currency exposure adds FX risk to your real returns.',
          action: 'Consider holdings in other currencies or an FX hedge.', metric: top.pct });
      } else if (top.pct >= 60 && cur.currencyCount > 1) {
        F.push({ id: 'fx-info', severity: 'info', category: 'Currency',
          title: pct(top.pct) + ' of assets are in ' + top.currency,
          detail: 'Your portfolio leans on one currency.', metric: top.pct });
      }
    }

    // 4) Rebalancing drift
    var d = bundle.drift;
    if (d && d.available) {
      var drifted = (d.rows || []).filter(function (r) { return Math.abs(r.drift) >= 5; })
        .sort(function (a, b) { return Math.abs(b.drift) - Math.abs(a.drift); });
      if (d.maxDrift >= 10) {
        F.push({ id: 'rebal-warning', severity: 'warning', category: 'Rebalancing',
          title: 'Allocation has drifted up to ' + pct(d.maxDrift) + ' from target',
          detail: drifted.slice(0, 3).map(function (r) {
            return r.cls + ' ' + (r.drift > 0 ? '+' : '') + pct(r.drift);
          }).join(', ') + '.',
          action: 'Rebalance toward your target weights (sell over-weights, add to under-weights).', metric: d.maxDrift });
      } else if (d.maxDrift >= 5) {
        F.push({ id: 'rebal-info', severity: 'info', category: 'Rebalancing',
          title: 'Minor allocation drift (' + pct(d.maxDrift) + ')',
          detail: 'Still close to target — rebalance opportunistically.', metric: d.maxDrift });
      } else {
        F.push({ id: 'rebal-good', severity: 'good', category: 'Rebalancing',
          title: 'Allocation on target',
          detail: 'Drift is under 5% — no action needed.', metric: d.maxDrift });
      }
    }

    // 5) Dividend strategy
    var dv = bundle.dividends;
    if (dv && dv.available) {
      F.push({ id: 'div-income', severity: 'info', category: 'Dividends',
        title: '~$' + money(dv.totalAnnual) + '/yr dividend income (' + pct(dv.yield) + ' yield)',
        detail: 'About $' + money(dv.monthly) + '/mo from ' + dv.payers + ' payer(s). ' +
          (dv.yield < 1.5 ? 'A few dividend growers could raise durable income.' : 'Reinvesting these compounds your base.'),
        action: dv.yield < 1.5 ? 'Consider dividend-growth ETFs/stocks for income.' : 'Enable DRIP to compound.', metric: dv.yield });
    }

    // 6) Tax optimisation (loss harvesting)
    var tl = bundle.taxLoss;
    if (tl && tl.available && tl.totalSavings > 0) {
      F.push({ id: 'tax-harvest', severity: 'opportunity', category: 'Tax',
        title: 'Tax-loss harvesting could save ~$' + money(tl.totalSavings),
        detail: (tl.rows ? tl.rows.length : 0) + ' position(s) at an unrealised loss can offset realised gains.' +
          (tl.rows && tl.rows.some(function (r) { return r.washSale; }) ? ' Some are within the 30-day wash-sale window.' : ''),
        action: 'Review loss positions before year-end; mind wash-sale rules.', metric: tl.totalSavings });
    }

    // 7) Hidden concentration through funds (ETF look-through, when available).
    // bundle.lookThrough is MaerminLookThrough.analyze()'s result — weights are
    // fractions, so convert to percent for display.
    var lt = bundle.lookThrough;
    if (lt && lt.available && lt.hiddenConcentrations && lt.hiddenConcentrations.length) {
      var hc = lt.hiddenConcentrations[0];
      var effPct = (hc.effectiveWeight || 0) * 100;
      var directPct = (hc.directWeight || 0) * 100;
      var fundedPct = (hc.fundedWeight || 0) * 100;
      F.push({
        id: 'lookthrough-conc', severity: effPct >= 10 ? 'critical' : 'warning', category: 'Look-through',
        title: (hc.name || hc.key) + ' is ' + pct(effPct) + ' of your portfolio counting fund holdings',
        detail: (directPct > 0 ? pct(directPct) + ' held directly plus ' : '') + pct(fundedPct) +
          ' hidden inside ' + (hc.funds || []).join(', ') + '.' +
          (lt.hiddenConcentrations.length > 1 ? ' ' + (lt.hiddenConcentrations.length - 1) + ' more security(ies) cross the threshold.' : ''),
        action: 'Check the ETF look-through panel; overlapping funds multiply single-stock risk.',
        metric: effPct
      });
    }

    // 8) Overall health weakest link
    var h = bundle.health;
    if (h && !h.empty && h.subScores) {
      var weakest = null;
      Object.keys(h.subScores).forEach(function (k) {
        var s = h.subScores[k];
        var val = (s && typeof s === 'object') ? s.score : s;
        if (val == null) return;
        if (!weakest || val < weakest.val) weakest = { key: k, val: val };
      });
      if (h.score != null && h.score < 50) {
        F.push({ id: 'health-low', severity: 'warning', category: 'Health',
          title: 'Portfolio health is ' + Math.round(h.score) + '/100',
          detail: weakest ? ('Weakest area: ' + weakest.key + ' (' + Math.round(weakest.val) + '/100).') : '',
          action: 'Focus on the weakest sub-score first.', metric: h.score });
      } else if (h.score != null && h.score >= 80) {
        F.push({ id: 'health-good', severity: 'good', category: 'Health',
          title: 'Strong portfolio health (' + Math.round(h.score) + '/100)',
          detail: 'Fundamentals look solid.', metric: h.score });
      }
    }

    F.sort(function (a, b) { return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]; });

    var summary = {
      total: F.length,
      critical: F.filter(function (f) { return f.severity === 'critical'; }).length,
      warning: F.filter(function (f) { return f.severity === 'warning'; }).length,
      opportunities: F.filter(function (f) { return f.severity === 'opportunity'; }).length,
      good: F.filter(function (f) { return f.severity === 'good'; }).length
    };
    return { findings: F, summary: summary };
  }

  // ---- gather the bundle from MaerminMetrics (impure convenience) ----------
  // extras (optional): pre-computed inputs a view already has — currently
  // { lookThrough } from MaerminLookThrough.analyze() — merged into the bundle.
  function gatherBundle(portfolio, prices, transactions, t, extras) {
    var M = (typeof window !== 'undefined') && window.MaerminMetrics;
    if (!M) return extras ? Object.assign({}, extras) : {};
    var bundle = {};
    try { bundle.concentration = M.computeConcentration(portfolio, prices); } catch (e) {}
    try { bundle.currency = M.computeCurrencyExposure(portfolio, prices, transactions); } catch (e) {}
    try { bundle.drift = M.computeRebalancingDrift(portfolio, prices); } catch (e) {}
    try { bundle.dividends = M.computeExpectedAnnualDividends(portfolio, prices); } catch (e) {}
    try { bundle.taxLoss = M.computeTaxLossHarvest(portfolio, prices, transactions); } catch (e) {}
    try { bundle.health = M.healthScore(portfolio, prices, t, { transactions: transactions }); } catch (e) {}
    if (extras) Object.assign(bundle, extras);
    return bundle;
  }

  function analyzePortfolio(portfolio, prices, transactions, t, extras) {
    return analyzeFromMetrics(gatherBundle(portfolio, prices, transactions, t, extras), t);
  }

  // Build the AICopilot chat context from the deterministic findings, so the LLM
  // answers grounded in real numbers.
  function chatContext(report, question) {
    return {
      title: 'Portfolio Advisor',
      data: {
        summary: report.summary,
        findings: report.findings.map(function (f) {
          return { severity: f.severity, category: f.category, title: f.title, detail: f.detail, action: f.action };
        })
      },
      question: question
    };
  }
  function ask(report, question) {
    if (!window.AICopilot || !window.AICopilot.analyze) return Promise.reject(new Error('NO_AI'));
    return window.AICopilot.analyze(chatContext(report, question));
  }

  // ---- embeddable Panel (docks into existing views; no new tab) ------------
  function Panel(props) {
    if (typeof React === 'undefined') return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var report = props.report || analyzePortfolio(props.portfolio, props.prices, props.transactions, t, props.extras);
    var findings = report.findings || [];

    var colorFor = {
      critical: theme.danger || '#ef4444', warning: theme.warning || '#f59e0b',
      opportunity: theme.accent || '#f5a524', info: theme.textSecondary || '#8b94a7', good: theme.success || '#22c55e'
    };
    var iconFor = { critical: '✗', warning: '!', opportunity: '◇', info: 'i', good: '✓' };

    var rows = findings.map(function (f, i) {
      return e('div', { key: f.id || i, style: {
        display: 'flex', gap: '0.7rem', padding: '0.75rem 0',
        borderBottom: '1px solid ' + (theme.cardBorder || 'rgba(255,255,255,0.06)')
      } },
        e('div', { style: { fontSize: '1.1rem', lineHeight: 1.2, fontWeight: 800, color: colorFor[f.severity] || (theme.textSecondary || '#8b94a7') } }, iconFor[f.severity] || '•'),
        e('div', { style: { flex: 1 } },
          e('div', { style: { color: colorFor[f.severity], fontWeight: 700, fontSize: '0.86rem' } }, f.title),
          e('div', { style: { color: theme.textSecondary || '#8b94a7', fontSize: '0.8rem', marginTop: '0.15rem', lineHeight: 1.5 } }, f.detail),
          f.action && e('div', { style: { color: theme.text || '#e9edf4', fontSize: '0.78rem', marginTop: '0.3rem' } }, '→ ' + f.action)
        )
      );
    });

    return e('div', { style: {
      background: theme.card || '#10151f', border: '1px solid ' + (theme.cardBorder || 'rgba(255,255,255,0.08)'),
      borderRadius: '14px', padding: '1.25rem'
    } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' } },
        e('div', { style: { color: theme.text || '#e9edf4', fontWeight: 800, fontSize: '1rem' } },
          (t.advisorTitle || 'AI Portfolio Advisor')),
        window.AICopilot && window.AICopilot.Button
          ? e(window.AICopilot.Button, { theme: theme, t: t, compact: true, context: chatContext(report) })
          : null
      ),
      findings.length
        ? rows
        : e('div', { style: { color: theme.textSecondary, fontSize: '0.85rem', padding: '0.5rem 0' } },
            t.advisorEmpty || 'Add holdings to get personalised recommendations.')
    );
  }

  var api = {
    analyzeFromMetrics: analyzeFromMetrics,
    analyzePortfolio: analyzePortfolio,
    gatherBundle: gatherBundle,
    chatContext: chatContext,
    ask: ask,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminAdvisor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
