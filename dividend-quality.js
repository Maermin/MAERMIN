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

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  // ---- Worker plumbing -------------------------------------------------------
  function buildUrl(workerBase, symbol) {
    var base = String(workerBase || '').trim().replace(/\/+$/, '');
    if (!base || !symbol) return '';
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
      reasons.push('Dividend is not covered by earnings (negative EPS).');
    } else if (payout != null) {
      if (payout <= 0) { components.payout = null; }
      else if (payout <= 0.3) components.payout = 100;
      else if (payout <= 0.6) components.payout = 100 - ((payout - 0.3) / 0.3) * 30;   // 100 → 70
      else if (payout <= 0.8) components.payout = 70 - ((payout - 0.6) / 0.2) * 30;    // 70 → 40
      else if (payout <= 1.0) components.payout = 40 - ((payout - 0.8) / 0.2) * 30;    // 40 → 10
      else components.payout = 0;
      if (payout > 0.9) reasons.push('Payout ratio above 90% leaves no buffer for earnings dips.');
      else if (payout > 0.7) reasons.push('Elevated payout ratio (' + Math.round(payout * 100) + '%).');
    } else {
      components.payout = null;
      reasons.push('No payout/earnings data — score based on dividend history only.');
    }

    // Growth streak (years of uninterrupted growth). 25y (aristocrat) → 100.
    var streak = num(input.yearsOfGrowth);
    if (streak != null) {
      components.streak = Math.max(0, Math.min(100, streak * 4));
      if (streak >= 25) reasons.push(String(streak) + ' years of uninterrupted dividend growth.');
      else if (streak === 0) reasons.push('No streak of consecutive dividend increases.');
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
      if (growth < 0) reasons.push('Dividend was cut recently (negative growth).');
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
      if (y > 0.08) reasons.push('Yield above 8% — possible yield trap.');
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
    if (cutRisk && reasons.length === 0) reasons.push('Multiple stress signals on this dividend.');

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
    var theme = props.theme || {};
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var good = theme.success || '#22c55e', warn = theme.warning || '#f59e0b', bad = theme.danger || theme.negative || '#ef4444';
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');
    var fmt = props.formatPrice || function (v) { return Number(v || 0).toFixed(2); };
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
        payers.push({
          symbol: symbol,
          name: s.name || s.symbolName || symbol,
          shares: shares,
          income: shares * d.annualDividend,
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

    var ratingColor = { safe: good, moderate: warn, risky: bad, unknown: dim };
    var pctTxt = function (x, digits) { return x == null ? '-' : (x * 100).toFixed(digits == null ? 0 : digits) + '%'; };

    function kpi(label, value, color) {
      return e('div', { key: label, style: { background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.7rem 0.9rem', minWidth: '130px' } },
        e('div', { style: { color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label),
        e('div', { style: { color: color || text, fontSize: '1.1rem', fontWeight: '700', marginTop: '0.15rem' } }, value));
    }

    var body;
    if (!payers.length) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } },
        'No dividend-paying positions detected yet. Quality scoring starts once a holding has dividend data.');
    } else {
      var parts = [];
      parts.push(e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' } },
        kpi('Dividend health', health.available ? (health.score + '/100 (' + health.label + ')') : '-',
          health.available ? (health.score >= 70 ? good : (health.score >= 45 ? warn : bad)) : dim),
        kpi('Payers scored', String(rows.filter(function (r) { return r.q.score != null; }).length) + ' / ' + payers.length),
        kpi('Income at cut risk', health.incomeAtRiskPct > 0 ? health.incomeAtRiskPct.toFixed(0) + '%' : '0%',
          health.incomeAtRiskPct > 25 ? bad : (health.incomeAtRiskPct > 0 ? warn : good))));

      var header = ['Position', 'Income p.a.', 'Payout', 'Streak', 'Growth', 'Coverage', 'Score'];
      parts.push(e('div', { style: { overflowX: 'auto' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          e('thead', null, e('tr', null, header.map(function (h, i) {
            return e('th', { key: h, style: { textAlign: i === 0 ? 'left' : 'right', padding: '0.4rem 0.5rem', color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
          }))),
          e('tbody', null, rows.map(function (r) {
            var p = r.payer, q = r.q, m = q.metrics;
            var isOpen = !!open[p.symbol];
            var mainRow = e('tr', {
              key: p.symbol,
              onClick: function () { setOpen(function (o) { var c = {}; for (var k in o) c[k] = o[k]; c[p.symbol] = !c[p.symbol]; return c; }); },
              style: { borderTop: '1px solid ' + border, cursor: 'pointer' }
            },
              e('td', { style: { padding: '0.45rem 0.5rem', color: text, fontSize: '0.8rem', fontWeight: 600 } },
                p.symbol,
                q.cutRisk ? e('span', { style: { marginLeft: '0.45rem', fontSize: '0.64rem', padding: '0.08rem 0.4rem', borderRadius: '4px', background: 'rgba(239,68,68,0.16)', color: bad, fontWeight: 700 } }, 'CUT RISK') : null),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: text, fontSize: '0.78rem' } }, sym + fmt(p.income)),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: m.payoutRatio != null && m.payoutRatio > 0.8 ? warn : dim, fontSize: '0.78rem' } }, pctTxt(m.payoutRatio)),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, m.streakYears != null ? m.streakYears + 'y' : '-'),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: m.growth != null ? (m.growth >= 0 ? good : bad) : dim, fontSize: '0.78rem' } }, m.growth != null ? ((m.growth >= 0 ? '+' : '') + (m.growth * 100).toFixed(1) + '%') : '-'),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, m.coverage != null ? m.coverage.toFixed(1) + 'x' : '-'),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right' } },
                e('span', { style: { color: ratingColor[q.rating], fontWeight: 800, fontSize: '0.82rem' } },
                  q.score != null ? String(q.score) : '-'),
                e('span', { style: { color: dim, fontSize: '0.68rem', marginLeft: '0.3rem' } }, q.rating)));
            if (!isOpen) return mainRow;
            var detail = e('tr', { key: p.symbol + '-detail' },
              e('td', { colSpan: header.length, style: { padding: '0.2rem 0.5rem 0.7rem', background: inputBg } },
                e('div', { style: { color: dim, fontSize: '0.74rem', lineHeight: 1.6 } },
                  (q.reasons.length ? q.reasons.join(' ') : 'No notable findings.') +
                  ' Based on ' + (r.hasFundamentals ? 'live fundamentals + dividend history.' : 'dividend history only (no fundamentals available).'))));
            return [mainRow, detail];
          })))));

      if (state.loading) {
        parts.push(e('div', { style: { color: dim, fontSize: '0.74rem', marginTop: '0.5rem' } }, 'Loading fundamentals...'));
      }
      if (state.unsupported) {
        parts.push(e('div', { style: { color: warn, fontSize: '0.74rem', marginTop: '0.6rem', lineHeight: 1.5 } },
          'Your Worker does not support fundamentals yet. Re-deploy the latest cf-worker/worker.js (action=fundamentals) for payout/earnings data; until then scores use dividend history only.'));
      } else if (!workerBase) {
        parts.push(e('div', { style: { color: dim, fontSize: '0.74rem', marginTop: '0.6rem', lineHeight: 1.5 } },
          'Add a Worker URL in API Settings to include payout/earnings data; scores currently use dividend history only.'));
      }
      parts.push(e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } },
        'The safety score is a heuristic from payout ratio, growth streak, dividend growth and yield level - higher is safer. Click a row for the reasoning. Not investment advice.'));
      body = e('div', null, parts);
    }

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1rem 1.5rem 1.5rem' } },
      e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: '0 0 0.9rem' } }, t.dividendQualityTitle || 'Dividend quality & safety'),
      body
    );
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
