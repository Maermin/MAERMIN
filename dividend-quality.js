// ============================================================================
// MAERMIN — Dividend quality & safety  (window.MaerminDividendQuality)
// ----------------------------------------------------------------------------
// Feature: per dividend-paying position a safety score plus the metrics behind
// it — payout ratio, consecutive growth streak, dividend growth (CAGR),
// earnings coverage, and a cut-risk flag — aggregated into a portfolio
// dividend-health value. This is what Snowball Analytics differentiates on;
// MAERMIN had calendar + forecast (DividendDataService) but no quality layer.
//
// Data sources, in order:
//   1. Dividend history/heuristics from the existing DividendDataService
//      (annualDividend, growthRate, yearsOfGrowth) — always available.
//   2. Fundamentals (payout ratio, EPS) from the Worker's new
//      `action=fundamentals` route (Yahoo quoteSummary), gated + degrading
//      like every other Worker feature: without it the score falls back to
//      the pure history heuristic and says so.
//
// The score is an explicitly labelled HEURISTIC, not investment advice.
//
// Same split as discovery/etf-lookthrough/cost-analysis: scoring, parsing and
// aggregation are pure and dual-exported (test/dividend-quality.test.js); the
// React `QualityPanel` folds into the existing Dividends view (no new tab).
// Nothing is persisted and nothing sensitive is sent — no new SENSITIVE_KEYS.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  function I18N() { return (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js'); }

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  // ---- Worker plumbing -------------------------------------------------------
  function buildUrl(workerBase, symbol) {
    var base = String(workerBase || '').trim().replace(/\/+$/, '');
    if (!base || !symbol) return '';
    // Not a ticker (e.g. a CS2 skin filed as a stock): no request.
    var T = typeof window !== 'undefined' && window.MaerminTickers;
    if (T && T.isMarketSymbol && !T.isMarketSymbol(symbol)) return '';
    return base + '?action=fundamentals&symbol=' + encodeURIComponent(symbol);
  }

  // Parse one Worker fundamentals payload → { ok, data, error }. An explicit
  // error (incl. 'Unknown action' from an older Worker) → ok:false so the view
  // can show the upgrade note and score from history alone.
  function parseFundamentalsResponse(json) {
    if (!json || json.error) return { ok: false, data: null, error: (json && json.error) || 'No response' };
    return {
      ok: true, error: null,
      data: {
        symbol: String(json.symbol || '').toUpperCase(),
        name: json.name || json.symbol || '',
        currency: json.currency || 'USD',
        price: num(json.price),
        dividendRate: num(json.dividendRate),
        dividendYield: num(json.dividendYield),
        fiveYearAvgDividendYield: num(json.fiveYearAvgDividendYield),
        payoutRatio: num(json.payoutRatio),
        trailingEps: num(json.trailingEps),
        forwardEps: num(json.forwardEps)
      }
    };
  }

  // ---- CAGR from a yearly dividend series ------------------------------------
  // series: [{year, amount}] (any order). CAGR over the trailing `years` window
  // ending at the latest year with data. Null when the window is not covered.
  function cagrFromSeries(series, years) {
    if (!Array.isArray(series) || !series.length || !(years > 0)) return null;
    var byYear = {};
    series.forEach(function (p) {
      var y = num(p && p.year), a = num(p && p.amount);
      if (y != null && a != null) byYear[y] = a;
    });
    var sorted = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    if (!sorted.length) return null;
    var endYear = sorted[sorted.length - 1];
    var startYear = endYear - years;
    if (byYear[startYear] == null || byYear[startYear] <= 0 || byYear[endYear] <= 0) return null;
    return Math.pow(byYear[endYear] / byYear[startYear], 1 / years) - 1;
  }

  // ---- scoring (PURE, heuristic) ----------------------------------------------
  // input: {
  //   payoutRatio (fraction|null), trailingEps|null, dividendRate (annual DPS)|null,
  //   dividendYield (fraction|null), growthRate (fraction|null),
  //   yearsOfGrowth (int|null), cagr3|null, cagr5|null
  // }
  // Component scores are 0-100; unknown components drop out and their weight is
  // redistributed, so missing fundamentals lower confidence, not the score.
  var WEIGHTS = { payout: 0.35, streak: 0.25, growth: 0.25, yieldSanity: 0.15 };

  function scorePosition(input) {
    input = input || {};
    var reasons = [];
    var components = {};

    // Effective payout ratio: explicit, or derived from DPS / EPS.
    var payout = num(input.payoutRatio);
    var eps = num(input.trailingEps);
    var dps = num(input.dividendRate);
    var earningsNegative = (eps != null && eps <= 0 && dps != null && dps > 0);
    if (payout == null && eps != null && eps > 0 && dps != null && dps > 0) payout = dps / eps;
    var coverage = null;
    if (earningsNegative) coverage = 0;
    else if (payout != null && payout > 0) coverage = 1 / payout;

    if (earningsNegative) {
      components.payout = 0;
      reasons.push(__('dqlNotCovered', 'Dividend is not covered by earnings (negative EPS).'));
    } else if (payout != null) {
      if (payout <= 0) { components.payout = null; }
      else if (payout <= 0.3) components.payout = 100;
      else if (payout <= 0.6) components.payout = 100 - ((payout - 0.3) / 0.3) * 30;   // 100 → 70
      else if (payout <= 0.8) components.payout = 70 - ((payout - 0.6) / 0.2) * 30;    // 70 → 40
      else if (payout <= 1.0) components.payout = 40 - ((payout - 0.8) / 0.2) * 30;    // 40 → 10
      else components.payout = 0;
      if (payout > 0.9) reasons.push(__('dqlPayout90', 'Payout ratio above {pct} leaves no buffer for earnings dips.', { pct: I18N().pct(90, 0) }));
      else if (payout > 0.7) reasons.push(__('dqlElevated', 'Elevated payout ratio ({pct}).', { pct: I18N().pct(payout * 100, 0) }));
    } else {
      components.payout = null;
      reasons.push(__('dqlNoPayoutData', 'No payout/earnings data — score based on dividend history only.'));
    }

    // Growth streak (years of uninterrupted growth). 25y (aristocrat) → 100.
    var streak = num(input.yearsOfGrowth);
    if (streak != null) {
      components.streak = Math.max(0, Math.min(100, streak * 4));
      if (streak >= 25) reasons.push(__('dqlStreak', '{n} years of uninterrupted dividend growth.', { n: streak }));
      else if (streak === 0) reasons.push(__('dqlNoStreak', 'No streak of consecutive dividend increases.'));
    } else {
      components.streak = null;
    }

    // Dividend growth: prefer the longest CAGR window available.
    var growth = num(input.cagr5);
    if (growth == null) growth = num(input.cagr3);
    if (growth == null) growth = num(input.growthRate);
    if (growth != null) {
      if (growth >= 0.10) components.growth = 100;
      else if (growth >= 0.05) components.growth = 90;
      else if (growth >= 0.02) components.growth = 75;
      else if (growth > 0) components.growth = 55;
      else if (growth === 0) components.growth = 40;
      else components.growth = 10;
      if (growth < 0) reasons.push(__('dqlCut', 'Dividend was cut recently (negative growth).'));
    } else {
      components.growth = null;
    }

    // Yield sanity: an outsized yield is usually the market pricing in a cut.
    var y = num(input.dividendYield);
    if (y != null) {
      if (y <= 0.06) components.yieldSanity = 100;
      else if (y <= 0.08) components.yieldSanity = 70;
      else if (y <= 0.12) components.yieldSanity = 35;
      else components.yieldSanity = 10;
      if (y > 0.08) reasons.push(__('dqlYieldTrap', 'Yield above {pct} — possible yield trap.', { pct: I18N().pct(8, 0) }));
    } else {
      components.yieldSanity = null;
    }

    // Weighted score over the known components.
    var totalWeight = 0, weighted = 0, known = 0;
    Object.keys(WEIGHTS).forEach(function (k) {
      if (components[k] != null) { totalWeight += WEIGHTS[k]; weighted += components[k] * WEIGHTS[k]; known++; }
    });
    var score = totalWeight > 0 ? Math.round(weighted / totalWeight) : null;

    var cutRisk = earningsNegative
      || (payout != null && payout > 0.9)
      || (growth != null && growth < 0)
      || (y != null && y > 0.08 && (streak || 0) < 5);
    if (cutRisk && reasons.length === 0) reasons.push(__('dqlStress', 'Multiple stress signals on this dividend.'));

    var rating = score == null ? 'unknown' : (score >= 70 ? 'safe' : (score >= 45 ? 'moderate' : 'risky'));

    return {
      score: score,
      rating: rating,
      cutRisk: !!cutRisk,
      components: components,
      knownComponents: known,
      metrics: {
        payoutRatio: earningsNegative ? null : payout,
        coverage: coverage,
        streakYears: streak,
        growth: growth,
        dividendYield: y
      },
      reasons: reasons
    };
  }

  // ---- portfolio aggregation ---------------------------------------------------
  // rows: [{score|null, cutRisk, incomeEUR}] — one per dividend payer.
  // Health = income-weighted average score over scored rows (equal weights when
  // incomes are missing), plus the share of income flagged as cut-risk.
  function scorePortfolio(rows) {
    rows = rows || [];
    var scored = rows.filter(function (r) { return r && r.score != null; });
    if (!scored.length) {
      return { available: false, score: null, label: 'unknown', counts: { safe: 0, moderate: 0, risky: 0, unknown: rows.length }, incomeAtRiskPct: 0, totalIncome: 0 };
    }
    var totalIncome = rows.reduce(function (s, r) { return s + (num(r.incomeEUR) || 0); }, 0);
    var weightOf = function (r) { return totalIncome > 0 ? (num(r.incomeEUR) || 0) : 1; };
    var wSum = 0, sSum = 0;
    scored.forEach(function (r) { var w = weightOf(r); wSum += w; sSum += r.score * w; });
    var score = wSum > 0 ? Math.round(sSum / wSum) : null;

    var counts = { safe: 0, moderate: 0, risky: 0, unknown: 0 };
    rows.forEach(function (r) {
      if (r.score == null) counts.unknown++;
      else if (r.score >= 70) counts.safe++;
      else if (r.score >= 45) counts.moderate++;
      else counts.risky++;
    });
    var riskIncome = rows.reduce(function (s, r) { return s + (r.cutRisk ? (num(r.incomeEUR) || 0) : 0); }, 0);

    return {
      available: true,
      score: score,
      label: score >= 70 ? 'healthy' : (score >= 45 ? 'mixed' : 'fragile'),
      counts: counts,
      incomeAtRiskPct: totalIncome > 0 ? (riskIncome / totalIncome) * 100 : 0,
      totalIncome: totalIncome
    };
  }

  // ---- React Panel (browser only; folds into the Dividends view) -------------
  var _fundCache = {}; // SYMBOL → { data|null, unsupported: bool }
  var MAX_FETCHES = 12;

  function QualityPanel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    var svc = (typeof window !== 'undefined') && window.DividendDataService;
    if (!React || !svc) return null;
    var e = React.createElement;
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    // R4.6: Card, Stat tiles, the verdict line, the shared table look with keyboard-openable rows
    var UIC = window.MaerminComponents;
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');
    var fmt = props.formatPrice || function (v) { return I18N().num(v, 2); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '€';
    var prices = props.prices || {};

    // Dividend payers from the ONE existing dividend source (no second engine).
    var payers = [];
    try {
      var data = svc.getPortfolioDividendData(props.portfolio || {}, prices) || {};
      ((props.portfolio || {}).stocks || []).forEach(function (s) {
        var symbol = (s.symbol || s.name || '').toUpperCase();
        var d = data[symbol];
        var shares = parseFloat(s.amount) || 0;
        if (!d || !(d.annualDividend > 0) || shares <= 0) return;
        var price = prices[symbol] || prices[symbol.toLowerCase()] || s.currentPrice || s.purchasePrice || 0;
        // Income in EUR (the service's dividend is in the payer's currency).
        var U = typeof window !== 'undefined' && window.MaerminUtils;
        var cur = d.currency || 'USD';
        var income = (U && U.toEUR && cur !== 'EUR') ? U.toEUR(shares * d.annualDividend, cur, props.exchangeRate) : shares * d.annualDividend;
        payers.push({
          symbol: symbol,
          name: s.name || s.symbolName || symbol,
          shares: shares,
          income: income,
          historyYield: price > 0 ? d.annualDividend / price : null,
          annualDividend: d.annualDividend,
          growthRate: num(d.growthRate),
          yearsOfGrowth: num(d.yearsOfGrowth)
        });
      });
    } catch (err) { /* service unavailable → empty panel below */ }
    payers.sort(function (a, b) { return b.income - a.income; });
    var fetchList = payers.slice(0, MAX_FETCHES);
    var payerKey = fetchList.map(function (p) { return p.symbol; }).join(',');

    var sState = React.useState({ loading: false, unsupported: false, funds: null });
    var state = sState[0], setState = sState[1];
    var sOpen = React.useState({}); var open = sOpen[0], setOpen = sOpen[1];

    React.useEffect(function () {
      if (!fetchList.length || !workerBase) { setState({ loading: false, unsupported: false, funds: {} }); return; }
      var cancelled = false;
      var unsupported = false;
      setState(function (s) { return { loading: true, unsupported: false, funds: s.funds }; });
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      var results = {};
      Promise.all(fetchList.map(function (p) {
        if (_fundCache[p.symbol]) {
          if (_fundCache[p.symbol].unsupported) unsupported = true;
          if (_fundCache[p.symbol].data) results[p.symbol] = _fundCache[p.symbol].data;
          return Promise.resolve();
        }
        return fetch(buildUrl(workerBase, p.symbol), { signal: ctrl ? ctrl.signal : undefined })
          .then(function (r) {
            if (r.status === 400 || r.status === 404 || r.status === 501) { unsupported = true; _fundCache[p.symbol] = { data: null, unsupported: true }; return null; }
            return r.json();
          })
          .then(function (j) {
            if (!j) return;
            var parsed = parseFundamentalsResponse(j);
            if (!parsed.ok && /unknown|unsupported|action/i.test(parsed.error || '')) { unsupported = true; _fundCache[p.symbol] = { data: null, unsupported: true }; return; }
            _fundCache[p.symbol] = { data: parsed.ok ? parsed.data : null, unsupported: false };
            if (parsed.ok) results[p.symbol] = parsed.data;
          })
          .catch(function () { /* per-symbol failure → history heuristic */ });
      })).then(function () {
        if (timer) clearTimeout(timer);
        if (cancelled) return;
        setState({ loading: false, unsupported: unsupported, funds: results });
      });
      return function () { cancelled = true; if (timer) clearTimeout(timer); if (ctrl) ctrl.abort(); };
    }, [payerKey, workerBase]);

    // Score every payer (history + fundamentals when fetched).
    var rows = payers.map(function (p) {
      var f = (state.funds || {})[p.symbol] || null;
      var s = scorePosition({
        payoutRatio: f ? f.payoutRatio : null,
        trailingEps: f ? f.trailingEps : null,
        dividendRate: f ? f.dividendRate : p.annualDividend,
        dividendYield: (f && f.dividendYield != null) ? f.dividendYield : p.historyYield,
        growthRate: p.growthRate,
        yearsOfGrowth: p.yearsOfGrowth
      });
      return { payer: p, q: s, hasFundamentals: !!(f && (f.payoutRatio != null || f.trailingEps != null)) };
    });
    var health = scorePortfolio(rows.map(function (r) { return { score: r.q.score, cutRisk: r.q.cutRisk, incomeEUR: r.payer.income }; }));

    var ratingTone = { safe: 'gain', moderate: 'warning', risky: 'loss', unknown: null };
    var pctTxt = function (x, digits) { return x == null ? '-' : I18N().pct(x * 100, digits == null ? 0 : digits); };
    var ratingLabel = function (r) { return ({ safe: __('dqlSafe', 'safe'), moderate: __('dqlModerate', 'moderate'), risky: __('dqlRisky', 'risky'), unknown: __('dqUnknownLower', 'unknown'), healthy: __('dqlHealthy', 'healthy'), mixed: __('dqlMixed', 'mixed'), fragile: __('dqlFragile', 'fragile') })[r] || r; };

    function kpi(label, value, tone) {
      return e(UIC.Stat, { key: label, className: 'ui-tile', label: label, value: value, tone: tone || null });
    }
    var toggle = function (symbol) { setOpen(function (o) { var c = {}; for (var k in o) c[k] = o[k]; c[symbol] = !c[symbol]; return c; }); };

    var body;
    if (!payers.length) {
      body = e('p', { className: 'ui-muted' },
        __('dqlNone', 'No dividend-paying positions detected yet. Quality scoring starts once a holding has dividend data.'));
    } else {
      var parts = [];
      parts.push(e('div', { key: 'kpi', className: 'ui-tiles' },
        kpi(__('dqlHealth', 'Dividend health'), health.available ? (health.score + '/100 (' + ratingLabel(health.label) + ')') : '-',
          health.available ? (health.score >= 70 ? 'gain' : (health.score >= 45 ? 'warning' : 'loss')) : null),
        kpi(__('dqlScored', 'Payers scored'), String(rows.filter(function (r) { return r.q.score != null; }).length) + ' / ' + payers.length),
        kpi(__('dqlAtRisk', 'Income at cut risk'), I18N().pct(health.incomeAtRiskPct > 0 ? health.incomeAtRiskPct : 0, 0),
          health.incomeAtRiskPct > 25 ? 'loss' : (health.incomeAtRiskPct > 0 ? 'warning' : 'gain'))));
      // P5-1.6: dividend safety in one plain sentence (rules in verdicts.js).
      var VD = typeof window !== 'undefined' ? window.MaerminVerdicts : null;
      var verdict = VD && health.available ? VD.dividendSafety(health.score, health.incomeAtRiskPct) : null;
      if (verdict) parts.push(e('p', { key: 'verdict', 'data-testid': 'verdict-dividends', 'data-level': verdict.level, className: 'ui-verdict' },
        verdict.text, e('span', { className: 'ui-note' }, ' ' + VD.disclaimer())));

      var header = [__('position', 'Position'), __('dqlIncomePa', 'Income p.a.'), __('dqlPayout', 'Payout'), __('dqlStreakCol', 'Streak'), __('dqlGrowth', 'Growth'), __('dqlCoverage', 'Coverage'), __('dqlScore', 'Score')];
      parts.push(e('div', { key: 'table', className: 'ui-table-wrap' },
        e('table', { className: ['ui-table', 'ui-table--dense', 'ui-dq-table'].join(' ') },
          e('thead', null, e('tr', null, header.map(function (h, i) {
            return e('th', { key: h, scope: 'col', className: i === 0 ? 'is-left' : 'is-right' }, h);
          }))),
          e('tbody', null, rows.map(function (r) {
            var p = r.payer, q = r.q, m = q.metrics;
            var isOpen = !!open[p.symbol];
            var mainRow = e('tr', {
              key: p.symbol, className: 'is-clickable', tabIndex: 0, 'aria-expanded': isOpen,
              onClick: function () { toggle(p.symbol); },
              onKeyDown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(p.symbol); } }
            },
              e('td', { className: ['is-left', 'is-strong'].join(' ') },
                p.symbol,
                q.cutRisk ? e(UIC.Badge, { tone: 'loss', className: 'ui-dq-cut' }, __('dqlCutRisk', 'CUT RISK')) : null),
              e('td', null, fmt(p.income) + ' ' + sym),
              e('td', { className: m.payoutRatio != null && m.payoutRatio > 0.8 ? 'tone-warning' : 'is-dim' }, pctTxt(m.payoutRatio)),
              e('td', { className: 'is-dim' }, m.streakYears != null ? __('pjYears', '{n}y', { n: m.streakYears }) : '-'),
              e('td', { className: m.growth != null ? 'tone-' + UIC.toneOf(m.growth) : 'is-dim' }, m.growth != null ? I18N().pct(m.growth * 100, 1, true) : '-'),
              e('td', { className: 'is-dim' }, m.coverage != null ? I18N().num(m.coverage, 1) + '×' : '-'),
              e('td', null,
                e('b', { className: ratingTone[q.rating] ? 'tone-' + ratingTone[q.rating] : '' }, q.score != null ? String(q.score) : '-'),
                e('span', { className: 'ui-dq-rating' }, ratingLabel(q.rating))));
            if (!isOpen) return mainRow;
            var detail = e('tr', { key: p.symbol + '-detail', className: 'ui-dq-detail' },
              e('td', { colSpan: header.length },
                (q.reasons.length ? q.reasons.join(' ') : __('dqlNoFindings', 'No notable findings.')) + ' ' +
                (r.hasFundamentals ? __('dqlBasedLive', 'Based on live fundamentals + dividend history.') : __('dqlBasedHistory', 'Based on dividend history only (no fundamentals available).'))));
            return [mainRow, detail];
          })))));

      if (state.loading) {
        parts.push(e('div', { key: 'loading' }, window.MaerminUtils.loadingNote(__('dqlLoading', 'Loading fundamentals...'))));
      }
      if (state.unsupported) {
        parts.push(e('p', { key: 'unsup', className: ['ui-callout', 'ui-callout--warn'].join(' ') },
          __('dqlUnsupported', 'Your Worker does not support fundamentals yet. Re-deploy the latest cf-worker/worker.js (action=fundamentals) for payout/earnings data; until then scores use dividend history only.')));
      } else if (!workerBase) {
        parts.push(e('p', { key: 'worker', className: 'ui-note' },
          __('dqlNeedWorker', 'Add a Worker URL in API Settings to include payout/earnings data; scores currently use dividend history only.')));
      }
      parts.push(e('p', { key: 'disc', className: 'ui-note' },
        __('dqlDisclaimer', 'The safety score is a heuristic from payout ratio, growth streak, dividend growth and yield level - higher is safer. Click a row for the reasoning. Not investment advice.')));
      body = parts;
    }

    return e(UIC.Card, { className: 'ui-dq', headingLevel: 'h3', title: t.dividendQualityTitle || 'Dividend quality & safety', 'data-testid': 'dividend-quality' }, body);
  }

  var api = {
    WEIGHTS: WEIGHTS,
    buildUrl: buildUrl,
    parseFundamentalsResponse: parseFundamentalsResponse,
    cagrFromSeries: cagrFromSeries,
    scorePosition: scorePosition,
    scorePortfolio: scorePortfolio,
    QualityPanel: QualityPanel
  };
  if (typeof window !== 'undefined') window.MaerminDividendQuality = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
