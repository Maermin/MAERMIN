// ============================================================================
// MAERMIN — Ongoing cost analysis (TER)  (window.MaerminCostAnalysis)
// ----------------------------------------------------------------------------
// Feature: the Fee Analyzer covers transaction fees; this module adds the
// OTHER half of the cost of investing — the recurring expense ratio (TER) of
// fund positions:
//
//   - annual cost in EUR per fund position (value x TER),
//   - total ongoing cost drag p.a. and the value-weighted average TER,
//   - a multi-year projection of the cumulative cost drag (gross vs net),
//   - a manual TER override per position (localStorage, not sensitive — a
//     symbol-to-fraction map, no amounts and no secrets).
//
// Data source: the SAME plumbing as the ETF X-Ray (Feature A) — TER comes from
// the Worker `fundholdings` route merged with the static fallback snapshot,
// loaded through MaerminLookThrough.loadFundData. No second fetch pipeline, no
// parallel positions engine: position rows come from
// MaerminLookThrough.positionRows (which mirrors MaerminMetrics.computeStats).
//
// Same split as discovery.js / etf-lookthrough.js: the math (buildFundRows,
// computeOngoingCosts, projectCostDrag) and the override store are pure /
// Node-tested (test/cost-analysis.test.js); the React `OngoingCostsPanel` is a
// thin shell folded into the existing Fee Analyzer view (no new tab).
// ============================================================================
(function () {
  'use strict';

  // ---- TER overrides (localStorage, NOT sensitive) --------------------------
  // { ROOTSYMBOL: fraction } — e.g. { VWCE: 0.0022 }. Symbols and expense
  // ratios only; no amounts, so this does not join SENSITIVE_KEYS.
  var TER_OVERRIDES_KEY = 'maermin_ter_overrides';

  function _root(symbol) {
    var LT = (typeof window !== 'undefined') && window.MaerminLookThrough;
    if (LT && LT.normalizeFundSymbol) return LT.normalizeFundSymbol(symbol);
    // Mirror of MaerminLookThrough.normalizeFundSymbol for the Node tests.
    var s = String(symbol || '').trim().toUpperCase();
    var dot = s.indexOf('.');
    return dot > 0 ? s.slice(0, dot) : s;
  }

  function loadOverrides() {
    try {
      var o = JSON.parse(localStorage.getItem(TER_OVERRIDES_KEY) || '{}');
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
    } catch (e) { return {}; }
  }

  // ter: fraction (0.0022) to set, or null/invalid to clear the override.
  function saveOverride(symbol, ter) {
    var root = _root(symbol);
    if (!root) return loadOverrides();
    var o = loadOverrides();
    var n = typeof ter === 'number' ? ter : parseFloat(ter);
    if (isFinite(n) && n >= 0 && n < 0.2) o[root] = n; else delete o[root];
    try { localStorage.setItem(TER_OVERRIDES_KEY, JSON.stringify(o)); } catch (e) { /* storage full — non-fatal */ }
    return o;
  }

  // ---- pure math -------------------------------------------------------------
  // Build per-fund cost rows from position rows + fund data + overrides.
  // positionRows: [{symbol, name, cls, valueEUR}] (MaerminLookThrough.positionRows)
  // fundDataBySymbol: { ROOT: { ter, name, source } } (loadFundData result)
  // overrides: { ROOT: fraction }
  // TER resolution order: manual override > worker/fallback data > unknown.
  function buildFundRows(positionRows, fundDataBySymbol, overrides) {
    fundDataBySymbol = fundDataBySymbol || {};
    overrides = overrides || {};
    var rows = [];
    (positionRows || []).forEach(function (p) {
      var root = _root(p.symbol);
      var fund = fundDataBySymbol[root];
      var override = overrides[root];
      var hasOverride = typeof override === 'number' && isFinite(override);
      if (!fund && !hasOverride) return; // not a fund (or unknown one without manual TER)
      var ter = hasOverride ? override : (fund && fund.ter != null ? fund.ter : null);
      rows.push({
        symbol: root,
        name: p.name || (fund && fund.name) || p.symbol,
        valueEUR: p.valueEUR || 0,
        ter: ter,
        terSource: hasOverride ? 'override' : (ter != null ? (fund.source || 'worker') : null)
      });
    });
    return rows;
  }

  // Aggregate the rows: per-position annual cost, total drag, weighted TER.
  function computeOngoingCosts(fundRows) {
    fundRows = fundRows || [];
    var rows = fundRows.map(function (r) {
      return {
        symbol: r.symbol, name: r.name, valueEUR: r.valueEUR,
        ter: r.ter, terSource: r.terSource,
        annualCostEUR: (r.ter != null && r.valueEUR > 0) ? r.valueEUR * r.ter : null
      };
    }).sort(function (a, b) { return (b.annualCostEUR || 0) - (a.annualCostEUR || 0); });

    var totalFundValue = 0, knownValue = 0, totalAnnualCostEUR = 0, unknownCount = 0;
    rows.forEach(function (r) {
      totalFundValue += r.valueEUR;
      if (r.annualCostEUR != null) { knownValue += r.valueEUR; totalAnnualCostEUR += r.annualCostEUR; }
      else unknownCount++;
    });

    return {
      available: rows.length > 0,
      rows: rows,
      totalFundValue: totalFundValue,
      knownValue: knownValue,
      totalAnnualCostEUR: totalAnnualCostEUR,
      weightedTer: knownValue > 0 ? totalAnnualCostEUR / knownValue : null,
      unknownCount: unknownCount
    };
  }

  // Project the cumulative cost drag: the same portfolio compounding with and
  // without the ongoing fee. TER is applied to the year-end value (the usual
  // simplification), contributions are added at the start of each year.
  // Returns [{year, gross, net, cumulativeCost}] for year 1..years.
  function projectCostDrag(startValue, ter, opts) {
    opts = opts || {};
    var years = Math.max(1, Math.min(50, Math.round(opts.years || 20)));
    var g = opts.growthRate != null ? opts.growthRate : 0.05;
    var contrib = opts.annualContribution || 0;
    var t = (typeof ter === 'number' && isFinite(ter) && ter > 0) ? ter : 0;
    var gross = Math.max(0, startValue || 0);
    var net = gross;
    var out = [];
    for (var y = 1; y <= years; y++) {
      gross = (gross + contrib) * (1 + g);
      net = (net + contrib) * (1 + g) * (1 - t);
      out.push({ year: y, gross: gross, net: net, cumulativeCost: gross - net });
    }
    return out;
  }

  // ---- React Panel (browser only; folds into the Fee Analyzer view) ---------
  function OngoingCostsPanel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    var LT = (typeof window !== 'undefined') && window.MaerminLookThrough;
    if (!React || !LT) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var accent = theme.accent || '#f5a524', border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var warn = theme.warning || '#f59e0b', bad = theme.danger || theme.negative || '#ef4444';
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');
    var fmt = props.formatPrice || function (v) { return Number(v || 0).toFixed(2); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '€';

    var rows = LT.positionRows(props.portfolio, props.prices);
    var candidates = rows.filter(function (r) {
      return (r.cls === 'stocks' || r.cls === 'commodities') && LT.isFundCandidate(r.symbol, r.name);
    }).slice(0, LT.MAX_FUND_FETCHES || 12);
    var candidateKey = candidates.map(function (c) { return _root(c.symbol); }).sort().join(',');

    var sState = React.useState({ loading: false, unsupported: false, funds: null });
    var state = sState[0], setState = sState[1];
    var sOverrides = React.useState(loadOverrides);
    var overrides = sOverrides[0], setOverrides = sOverrides[1];
    var sEdit = React.useState({}); var edit = sEdit[0], setEdit = sEdit[1]; // symbol → input text

    React.useEffect(function () {
      if (!candidates.length) { setState({ loading: false, unsupported: false, funds: {} }); return; }
      var cancelled = false;
      setState(function (s) { return { loading: true, unsupported: false, funds: s.funds }; });
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      LT.loadFundData(workerBase, candidates.map(function (c) { return c.symbol; }), { signal: ctrl ? ctrl.signal : undefined })
        .then(function (out) {
          if (timer) clearTimeout(timer);
          if (cancelled) return;
          setState({ loading: false, unsupported: out.unsupported, funds: out.holdings });
        });
      return function () { cancelled = true; if (timer) clearTimeout(timer); if (ctrl) ctrl.abort(); };
    }, [candidateKey, workerBase]);

    var costs = null;
    if (state.funds) {
      costs = computeOngoingCosts(buildFundRows(rows, state.funds, overrides));
    }

    function commitOverride(symbol, raw) {
      // Input is percent text ("0.22"); empty clears back to the data source.
      var pct = parseFloat(String(raw).replace(',', '.'));
      var next = saveOverride(symbol, isFinite(pct) ? pct / 100 : null);
      setOverrides(next);
      setEdit(function (m) { var c = {}; for (var k in m) { if (k !== symbol) c[k] = m[k]; } return c; });
    }

    var pctOf = function (x) { return (x * 100).toFixed(2) + '%'; };
    var sourceLabel = { worker: 'live', fallback: 'snapshot', override: 'manual' };

    function kpi(label, value, color) {
      return e('div', { key: label, style: { background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.7rem 0.9rem', minWidth: '130px' } },
        e('div', { style: { color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label),
        e('div', { style: { color: color || text, fontSize: '1.1rem', fontWeight: '700', marginTop: '0.15rem' } }, value));
    }

    var body;
    if (!candidates.length) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } },
        'No ETF or fund positions detected. Ongoing costs (TER) apply to funds; transaction fees above cover everything else.');
    } else if (state.loading) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } }, 'Loading expense ratios...');
    } else if (!costs || !costs.available) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } },
        'No expense-ratio data for your fund positions yet. Set a TER manually below once the table appears, or re-deploy the latest Worker for live data.');
    } else {
      var parts = [];

      parts.push(e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' } },
        kpi('Ongoing costs p.a.', sym + fmt(costs.totalAnnualCostEUR), bad),
        kpi('Weighted avg TER', costs.weightedTer != null ? pctOf(costs.weightedTer) : '-'),
        kpi('Fund value covered', sym + fmt(costs.knownValue)),
        costs.unknownCount > 0 ? kpi('Funds without TER', String(costs.unknownCount), warn) : null));

      // Per-fund table with the manual override input.
      parts.push(e('div', { style: { overflowX: 'auto' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          e('thead', null, e('tr', null,
            ['Fund', 'Value', 'TER', 'Source', 'Cost p.a.', 'Override %'].map(function (h, i) {
              return e('th', { key: h, style: { textAlign: i === 0 ? 'left' : 'right', padding: '0.4rem 0.5rem', color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
            }))),
          e('tbody', null, costs.rows.map(function (r) {
            var editing = Object.prototype.hasOwnProperty.call(edit, r.symbol);
            var inputVal = editing ? edit[r.symbol]
              : (overrides[r.symbol] != null ? (overrides[r.symbol] * 100).toFixed(2) : '');
            return e('tr', { key: r.symbol, style: { borderTop: '1px solid ' + border } },
              e('td', { style: { padding: '0.45rem 0.5rem', color: text, fontSize: '0.8rem', fontWeight: 600 } }, r.symbol,
                e('span', { style: { color: dim, fontWeight: 400, fontSize: '0.7rem' } }, '  ' + (r.name || ''))),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, sym + fmt(r.valueEUR)),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: r.ter != null ? text : warn, fontSize: '0.78rem', fontWeight: 600 } }, r.ter != null ? pctOf(r.ter) : 'unknown'),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.72rem' } }, r.terSource ? (sourceLabel[r.terSource] || r.terSource) : '-'),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: r.annualCostEUR != null ? bad : dim, fontSize: '0.78rem', fontWeight: 700 } }, r.annualCostEUR != null ? sym + fmt(r.annualCostEUR) : '-'),
              e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right' } },
                e('input', {
                  type: 'text', value: inputVal, placeholder: 'e.g. 0.22',
                  onChange: function (ev) { var v = ev.target.value; setEdit(function (m) { var c = {}; for (var k in m) c[k] = m[k]; c[r.symbol] = v; return c; }); },
                  onBlur: function (ev) { commitOverride(r.symbol, ev.target.value); },
                  onKeyDown: function (ev) { if (ev.key === 'Enter') commitOverride(r.symbol, ev.target.value); },
                  style: { width: '70px', background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.25rem 0.4rem', color: text, fontSize: '0.74rem', textAlign: 'right' }
                })));
          })))));

      // Multi-year projection of the cumulative cost drag.
      if (costs.weightedTer != null && costs.knownValue > 0) {
        var growth = 0.05;
        var proj = projectCostDrag(costs.knownValue, costs.weightedTer, { years: 20, growthRate: growth });
        var marks = [5, 10, 20].map(function (y) { return proj[y - 1]; });
        parts.push(e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '1rem 0 0.5rem', fontWeight: 700 } }, 'Cumulative cost drag (projection)'));
        parts.push(e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem' } },
          marks.map(function (m) { return kpi('After ' + m.year + ' years', sym + fmt(m.cumulativeCost), bad); })));
        parts.push(e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.5rem', lineHeight: 1.5 } },
          'Assumes ' + (growth * 100).toFixed(0) + '% p.a. growth on your current fund value of ' + sym + fmt(costs.knownValue) +
          ' at the weighted TER of ' + pctOf(costs.weightedTer) + ' — the gap between compounding with and without ongoing fees. An illustration, not a forecast.'));
      }

      if (state.unsupported) {
        parts.push(e('div', { style: { color: warn, fontSize: '0.74rem', marginTop: '0.6rem', lineHeight: 1.5 } },
          'Your Worker does not support fund data yet. Re-deploy the latest cf-worker/worker.js (action=fundholdings) for live expense ratios; until then a built-in snapshot of common ETFs and your manual overrides are used.'));
      }

      parts.push(e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } },
        'Expense ratios are approximations from fund profiles; the manual override (in percent, e.g. 0.22) takes precedence and is stored only on this device.'));

      body = e('div', null, parts);
    }

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '0 1.5rem 1.5rem' } },
      e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: '0 0 0.9rem' } }, t.ongoingCostsTitle || 'Ongoing costs (TER)'),
      body
    );
  }

  var api = {
    TER_OVERRIDES_KEY: TER_OVERRIDES_KEY,
    loadOverrides: loadOverrides,
    saveOverride: saveOverride,
    buildFundRows: buildFundRows,
    computeOngoingCosts: computeOngoingCosts,
    projectCostDrag: projectCostDrag,
    OngoingCostsPanel: OngoingCostsPanel
  };
  if (typeof window !== 'undefined') window.MaerminCostAnalysis = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
