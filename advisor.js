// ============================================================================
// MAERMIN — Portfolio Advisor  (window.MaerminAdvisor)
// ----------------------------------------------------------------------------
// Epic 3. NO new analytics engine (per the V7 rule it reads the one shared
// source, window.MaerminMetrics): a DETERMINISTIC findings engine —
// concentration / diversification / currency / rebalancing / dividend /
// tax-loss / health. Rule-based, fully on-device (works offline, no API key),
// produces ranked recommendations.
//
// `analyzeFromMetrics(bundle, t)` is pure and unit-tested; `analyzePortfolio()`
// gathers the bundle from MaerminMetrics. UI (`Panel`) embeds into existing
// views (e.g. the Health view) rather than adding a tab.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var SEVERITY_RANK = { critical: 0, warning: 1, opportunity: 2, info: 3, good: 4 };

  function I18N() { return (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js'); }
  function pct(n) { return I18N().pct(Math.round((n || 0) * 10) / 10, { min: 0, max: 1 }); }
  function money(n) { return I18N().num(Math.round(n || 0), 0); }

  // Health sub-score key -> label.
  function areaLabel(k) {
    return ({ diversification: __('healthDiversification', 'Diversification'), risk: __('healthRiskCat', 'Risk'), liquidity: __('healthLiquidityCat', 'Liquidity'), tax: __('healthTaxCat', 'Tax efficiency'), taxEfficiency: __('healthTaxCat', 'Tax efficiency') })[k] || k;
  }

  // ---- deterministic findings (PURE) --------------------------------------
  // bundle: { concentration, currency, drift, dividends, taxLoss, health, totalValue }
  // Each is the shape MaerminMetrics returns. Returns ranked findings + summary.
  // opts.formatMoney(eur) → display string: the app passes its formatter so the
  // amounts follow Privacy Mode and the display currency. Default: rounded EUR
  // (all bundle amounts are EUR; the texts used to say "$").
  function analyzeFromMetrics(bundle, t, opts) {
    bundle = bundle || {};
    var fmt = (opts && typeof opts.formatMoney === 'function') ? opts.formatMoney : function (n) { return I18N().money(Math.round(n || 0), 'EUR', 0); };
    var F = [];

    // 1) Concentration risk
    var c = bundle.concentration;
    if (c && c.available) {
      var topName = (c.top && c.top[0] && (c.top[0].label || c.top[0].symbol || c.top[0].name)) || __('advTopPosition', 'Top position');
      if (c.maxWeight >= 30) {
        F.push({ id: 'conc-critical', severity: 'critical', category: 'Concentration',
          title: __('advIsOfPortfolio', '{name} is {pct} of your portfolio', { name: topName, pct: pct(c.maxWeight) }),
          detail: __('advConcCritical', 'A single holding above {a} drives most of your risk. Consider trimming toward a {b} cap.', { a: pct(30), b: I18N().pct(20, 0) + '–' + pct(25) }),
          action: __('advReduce', 'Reduce {name} or add uncorrelated positions.', { name: topName }), metric: c.maxWeight });
      } else if (c.maxWeight >= 20) {
        F.push({ id: 'conc-warning', severity: 'warning', category: 'Concentration',
          title: __('advIsOfPortfolio', '{name} is {pct} of your portfolio', { name: topName, pct: pct(c.maxWeight) }),
          detail: __('advConcWarn', 'Above {a} in one position increases idiosyncratic risk.', { a: pct(20) }),
          action: __('advWatchWeight', 'Watch this weight; rebalance if it keeps growing.'), metric: c.maxWeight });
      }
      // 2) Diversification (effective number of holdings)
      if (c.effectiveN && c.effectiveN < 3) {
        F.push({ id: 'div-low', severity: 'warning', category: 'Diversification',
          title: __('advLowDiv', 'Low effective diversification (~{n} holdings)', { n: I18N().num(Math.round(c.effectiveN * 10) / 10, { min: 0, max: 1 }) }),
          detail: __('advLowDivDetail', 'Most of your money behaves like just a few bets. Spreading across more positions/sectors smooths returns.'),
          action: __('advLowDivAction', 'Add positions in under-represented asset classes.'), metric: c.effectiveN });
      } else if (c.effectiveN && c.effectiveN >= 8) {
        F.push({ id: 'div-good', severity: 'good', category: 'Diversification',
          title: __('advWellDiv', 'Well diversified (~{n} effective holdings)', { n: Math.round(c.effectiveN) }),
          detail: __('advWellDivDetail', 'Risk is spread across many positions.'), metric: c.effectiveN });
      }
    }

    // 3) Currency exposure
    var cur = bundle.currency;
    if (cur && cur.available && cur.rows && cur.rows.length) {
      var top = cur.rows[0];
      if (top.pct >= 80 && cur.currencyCount > 1) {
        F.push({ id: 'fx-warning', severity: 'warning', category: 'Currency',
          title: __('advFxTitle', '{pct} of assets are in {cur}', { pct: pct(top.pct), cur: top.currency }),
          detail: __('advFxHeavy', 'Heavy single-currency exposure adds FX risk to your real returns.'),
          action: __('advFxAction', 'Consider holdings in other currencies or an FX hedge.'), metric: top.pct });
      } else if (top.pct >= 60 && cur.currencyCount > 1) {
        F.push({ id: 'fx-info', severity: 'info', category: 'Currency',
          title: __('advFxTitle', '{pct} of assets are in {cur}', { pct: pct(top.pct), cur: top.currency }),
          detail: __('advFxLean', 'Your portfolio leans on one currency.'), metric: top.pct });
      }
    }

    // 4) Rebalancing drift
    var d = bundle.drift;
    if (d && d.available) {
      var drifted = (d.rows || []).filter(function (r) { return Math.abs(r.drift) >= 5; })
        .sort(function (a, b) { return Math.abs(b.drift) - Math.abs(a.drift); });
      if (d.maxDrift >= 10) {
        F.push({ id: 'rebal-warning', severity: 'warning', category: 'Rebalancing',
          title: __('advDrift', 'Allocation has drifted up to {pct} from target', { pct: pct(d.maxDrift) }),
          detail: drifted.slice(0, 3).map(function (r) {
            return I18N().category(r.cls) + ' ' + (r.drift > 0 ? '+' : '') + pct(r.drift);
          }).join(', ') + '.',
          action: __('advDriftAction', 'Rebalance toward your target weights (sell over-weights, add to under-weights).'), metric: d.maxDrift });
      } else if (d.maxDrift >= 5) {
        F.push({ id: 'rebal-info', severity: 'info', category: 'Rebalancing',
          title: __('advMinorDrift', 'Minor allocation drift ({pct})', { pct: pct(d.maxDrift) }),
          detail: __('advMinorDriftDetail', 'Still close to target — rebalance opportunistically.'), metric: d.maxDrift });
      } else {
        F.push({ id: 'rebal-good', severity: 'good', category: 'Rebalancing',
          title: __('advOnTarget', 'Allocation on target'),
          detail: __('advOnTargetDetail', 'Drift is under {pct} — no action needed.', { pct: pct(5) }), metric: d.maxDrift });
      }
    }

    // 5) Dividend strategy
    var dv = bundle.dividends;
    if (dv && dv.available) {
      F.push({ id: 'div-income', severity: 'info', category: 'Dividends',
        title: __('advDivTitle', '~{amount}/yr dividend income ({pct} yield)', { amount: fmt(dv.totalAnnual), pct: pct(dv.yield) }),
        detail: __('advDivDetail', 'About {amount}/mo from {n} {n:payer|payers}.', { amount: fmt(dv.monthly), n: dv.payers }) + ' ' +
          (dv.yield < 1.5 ? __('advDivGrowers', 'A few dividend growers could raise durable income.') : __('advDivReinvest', 'Reinvesting these compounds your base.')),
        action: dv.yield < 1.5 ? __('advDivGrowAction', 'Consider dividend-growth ETFs/stocks for income.') : __('advDivDrip', 'Enable DRIP to compound.'), metric: dv.yield });
    }

    // 6) Tax optimisation (loss harvesting)
    var tl = bundle.taxLoss;
    if (tl && tl.available && tl.totalSavings > 0) {
      F.push({ id: 'tax-harvest', severity: 'opportunity', category: 'Tax',
        title: __('advTaxTitle', 'Tax-loss harvesting could save ~{amount}', { amount: fmt(tl.totalSavings) }),
        detail: __('advTaxDetail', '{n} {n:position|positions} at an unrealised loss can offset realised gains.', { n: tl.rows ? tl.rows.length : 0 }) +
          (tl.rows && tl.rows.some(function (r) { return r.washSale; }) ? ' ' + __('advWashSale', 'Some are within the 30-day wash-sale window.') : ''),
        action: __('advTaxAction', 'Review loss positions before year-end; mind wash-sale rules.'), metric: tl.totalSavings });
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
        title: __('advLtTitle', '{name} is {pct} of your portfolio counting fund holdings', { name: hc.name || hc.key, pct: pct(effPct) }),
        detail: (directPct > 0 ? __('advLtDirect', '{pct} held directly plus', { pct: pct(directPct) }) + ' ' : '') +
          __('advLtHidden', '{pct} hidden inside {list}.', { pct: pct(fundedPct), list: (hc.funds || []).join(', ') }) +
          (lt.hiddenConcentrations.length > 1 ? ' ' + __('advLtMore', '{n} more {n:security crosses|securities cross} the threshold.', { n: lt.hiddenConcentrations.length - 1 }) : ''),
        action: __('advLtAction', 'Check the ETF look-through panel; overlapping funds multiply single-stock risk.'),
        metric: effPct
      });
    }

    // 8) Risk-monitor breaches (drawdown / volatility), when a view passes the
    // evaluation in. Concentration, drift and look-through breaches are NOT
    // repeated here — the findings above already cover those dimensions; the
    // monitor's market-risk rules are the genuinely new information.
    var rm = bundle.riskMonitor;
    if (rm && rm.alerts && rm.alerts.length) {
      rm.alerts.forEach(function (a) {
        if (a.id !== 'drawdown' && a.id !== 'volatility') return;
        F.push({
          id: 'riskmon-' + a.id, severity: a.severity, category: 'Risk monitor',
          title: a.title,
          detail: (a.id === 'drawdown'
            ? __('advRmDrawdown', 'The portfolio sits below your configured drawdown limit relative to its peak.')
            : __('advRmVol', 'Recent swings exceed your configured volatility limit.')),
          action: __('advRmAction', 'Review the Risk & drift monitor in Alerts; adjust the limit or de-risk.'),
          metric: a.metric
        });
      });
    }

    // 9) Overall health weakest link
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
          title: __('advHealthLow', 'Portfolio health is {n}/100', { n: Math.round(h.score) }),
          detail: weakest ? __('advWeakest', 'Weakest area: {area} ({n}/100).', { area: areaLabel(weakest.key), n: Math.round(weakest.val) }) : '',
          action: __('advWeakestAction', 'Focus on the weakest sub-score first.'), metric: h.score });
      } else if (h.score != null && h.score >= 80) {
        F.push({ id: 'health-good', severity: 'good', category: 'Health',
          title: __('advHealthGood', 'Strong portfolio health ({n}/100)', { n: Math.round(h.score) }),
          detail: __('advHealthGoodDetail', 'Fundamentals look solid.'), metric: h.score });
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
    // computeConcentration reports maxWeight as a FRACTION (PortfolioHealth's
    // HHI math), while analyzeFromMetrics' thresholds are PERCENT. Convert at
    // this boundary — without it the concentration findings could never fire
    // against real data (0.42 is never >= 30).
    try {
      var conc = M.computeConcentration(portfolio, prices);
      if (conc && conc.available && conc.maxWeight <= 1) {
        conc = Object.assign({}, conc, { maxWeight: conc.maxWeight * 100 });
      }
      bundle.concentration = conc;
    } catch (e) {}
    try { bundle.currency = M.computeCurrencyExposure(portfolio, prices, transactions); } catch (e) {}
    try { bundle.drift = M.computeRebalancingDrift(portfolio, prices); } catch (e) {}
    try { bundle.dividends = M.computeExpectedAnnualDividends(portfolio, prices); } catch (e) {}
    // Rate per lot for the user's jurisdiction (FINDINGS L-2): German crypto and
    // skins held over a year are tax-free, so selling them "saves" nothing.
    try {
      var jur = 'de', TSm = (typeof window !== 'undefined') && window.MaerminTaxSettings;
      try { jur = localStorage.getItem('taxJurisdiction') || 'de'; } catch (e2) {}
      bundle.taxLoss = M.computeTaxLossHarvest(portfolio, prices, transactions, {
        jurisdiction: jur, exchangeRate: extras && extras.exchangeRate,
        fxAt: (typeof window !== 'undefined' && window.MaerminFxHistory) ? window.MaerminFxHistory.fxResolver(extras && extras.exchangeRate) : undefined,
        settings: TSm && TSm.load ? TSm.load() : undefined
      });
    } catch (e) {}
    try { bundle.health = M.healthScore(portfolio, prices, t, { transactions: transactions }); } catch (e) {}
    if (extras) Object.assign(bundle, extras);
    return bundle;
  }

  function analyzePortfolio(portfolio, prices, transactions, t, extras, opts) {
    return analyzeFromMetrics(gatherBundle(portfolio, prices, transactions, t, extras), t, opts);
  }

  // ---- embeddable Panel (docks into existing views; no new tab) ------------
  function Panel(props) {
    if (typeof React === 'undefined') return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    var report = props.report || analyzePortfolio(props.portfolio, props.prices, props.transactions, t, props.extras, { formatMoney: props.formatMoney });
    var findings = report.findings || [];

    var colorFor = {
      critical: theme.danger || '#ef4444', warning: theme.warning || '#f59e0b',
      opportunity: theme.accent || '#8b7cff', info: theme.textSecondary || '#8b94a7', good: theme.success || '#22c55e'
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
          (t.advisorTitle || 'Portfolio Advisor'))
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
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminAdvisor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
