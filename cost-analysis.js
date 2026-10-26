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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

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
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    // R4.3: costs read as amounts (no loss colour without a sign); a missing TER is a warning in words
    var UIC = window.MaerminComponents;
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');
    var fmt = props.formatPrice || function (v) { return window.MaerminI18n.num(v, 2); };
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

    var pctOf = function (x) { return window.MaerminI18n.pct(x * 100, 2); };
    var sourceLabel = { worker: __('caSrcLive', 'live'), fallback: __('caSrcSnapshot', 'snapshot'), override: __('caSrcManual', 'manual') };
    var amt = function (v) { return fmt(v) + ' ' + sym; };

    function kpi(label, value, tone) {
      return e(UIC.Stat, { key: label, className: 'ui-tile', label: label, value: value, tone: tone || null });
    }
    var muted = function (msg) { return window.MaerminUtils.emptyNote(msg); }; // R5.2: the shared empty state

    var body;
    if (!candidates.length) {
      body = window.MaerminUtils.emptyNote(
        __('caNoFunds', 'No ETF or fund positions detected. Ongoing costs (TER) apply to funds; transaction fees above cover everything else.'));
    } else if (state.loading) {
      body = window.MaerminUtils.loadingNote(__('caLoading', 'Loading expense ratios...'));
    } else if (!costs || !costs.available) {
      body = muted(
        __('caNoData', 'No expense-ratio data for your fund positions yet. Set a TER manually below once the table appears, or re-deploy the latest Worker for live data.'));
    } else {
      var parts = [];

      parts.push(e('div', { className: 'ui-tiles' },
        kpi(__('caOngoingPa', 'Ongoing costs p.a.'), amt(costs.totalAnnualCostEUR)),
        kpi(__('caWeightedTer', 'Weighted avg TER'), costs.weightedTer != null ? pctOf(costs.weightedTer) : '-'),
        kpi(__('caFundCovered', 'Fund value covered'), amt(costs.knownValue)),
        costs.unknownCount > 0 ? kpi(__('caNoTer', 'Funds without TER'), '! ' + String(costs.unknownCount), 'warning') : null));

      // Per-fund table with the manual override input.
      parts.push(e('div', { className: ['ui-table-wrap', 'ui-ca-table'].join(' ') },
        e('table', { className: ['ui-table', 'ui-table--dense'].join(' ') },
          e('thead', null, e('tr', null,
            [__('gtFund', 'Fund'), __('colValue', 'Value'), 'TER', __('trSource', 'Source'), __('caCostPa', 'Cost p.a.'), __('caOverridePct', 'Override %')].map(function (h, i) {
              return e('th', { key: h, scope: 'col', className: i === 0 ? 'is-sticky' : 'is-right' }, h);
            }))),
          e('tbody', null, costs.rows.map(function (r) {
            var editing = Object.prototype.hasOwnProperty.call(edit, r.symbol);
            var inputVal = editing ? edit[r.symbol]
              : (overrides[r.symbol] != null ? (overrides[r.symbol] * 100).toFixed(2) : '');
            return e('tr', { key: r.symbol },
              e('th', { scope: 'row', className: 'is-sticky' }, r.symbol,
                e('span', { className: 'ui-lt-via' }, '  ' + (r.name || ''))),
              e('td', null, amt(r.valueEUR)),
              e('td', { className: r.ter != null ? 'is-strong' : 'tone-warning' }, r.ter != null ? pctOf(r.ter) : '! ' + __('dqUnknownLower', 'unknown')),
              e('td', null, r.terSource ? (sourceLabel[r.terSource] || r.terSource) : '-'),
              e('td', { className: 'is-strong' }, r.annualCostEUR != null ? amt(r.annualCostEUR) : '-'),
              e('td', null,
                e('input', {
                  type: 'text', value: inputVal, placeholder: __('caOverridePh', 'e.g. {v}', { v: window.MaerminI18n.num(0.22, 2) }), 'aria-label': __('caOverridePct', 'Override %') + ' ' + r.symbol,
                  onChange: function (ev) { var v = ev.target.value; setEdit(function (m) { var c = {}; for (var k in m) c[k] = m[k]; c[r.symbol] = v; return c; }); },
                  onBlur: function (ev) { commitOverride(r.symbol, ev.target.value); },
                  onKeyDown: function (ev) { if (ev.key === 'Enter') commitOverride(r.symbol, ev.target.value); },
                  className: ['ui-input', 'ui-input--sm', 'ui-input--num'].join(' ')
                })));
          })))));

      // Multi-year projection of the cumulative cost drag.
      if (costs.weightedTer != null && costs.knownValue > 0) {
        var growth = 0.05;
        var proj = projectCostDrag(costs.knownValue, costs.weightedTer, { years: 20, growthRate: growth });
        var marks = [5, 10, 20].map(function (y) { return proj[y - 1]; });
        parts.push(e(window.MaerminComponents.Heading, { key: 'drag', className: 'ui-sublabel' }, __('caDrag', 'Cumulative cost drag (projection)')));
        parts.push(e('div', { className: 'ui-tiles' },
          marks.map(function (m) { return kpi(__('caAfterYears', 'After {n} years', { n: m.year }), amt(m.cumulativeCost)); })));
        parts.push(e('p', { className: 'ui-note' },
          __('caAssumes', 'Assumes {g} p.a. growth on your current fund value of {value} at the weighted TER of {ter} — the gap between compounding with and without ongoing fees. An illustration, not a forecast.', { g: window.MaerminI18n.pct(growth * 100, 0), value: amt(costs.knownValue), ter: pctOf(costs.weightedTer) })));
      }

      if (state.unsupported) {
        parts.push(e('p', { className: ['ui-note', 'tone-warning'].join(' ') },
          __('caUnsupported', 'Your Worker does not support fund data yet. Re-deploy the latest cf-worker/worker.js (action=fundholdings) for live expense ratios; until then a built-in snapshot of common ETFs and your manual overrides are used.')));
      }

      parts.push(e('p', { className: 'ui-note' },
        __('caFootnote', 'Expense ratios are approximations from fund profiles; the manual override (in percent, e.g. {v}) takes precedence and is stored only on this device.', { v: window.MaerminI18n.num(0.22, 2) })));

      body = e('div', null, parts);
    }

    return e(UIC.Card, { title: t.ongoingCostsTitle || 'Ongoing costs (TER)', headingLevel: 'h3', 'data-testid': 'ongoing-costs' }, body);
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
