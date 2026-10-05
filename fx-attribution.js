// ============================================================================
// MAERMIN — FX attribution  (window.MaerminFxAttribution)
// ----------------------------------------------------------------------------
// Feature: decompose returns into the part the ASSET earned in its own
// currency and the part EXCHANGE RATES added or removed — the detailed
// currency analysis even getquin reviews call out as missing. Exactly:
//
//   (1 + r_EUR) = (1 + r_local) x (1 + r_fx)
//   r_EUR = r_local + r_fx + r_local x r_fx   (the last term is the interaction)
//
// The app stores prices EUR-canonical, so the local return of a USD asset is
// recovered by dividing out the EUR-per-USD path: r_local = (1+r_EUR)/(1+r_fx)-1.
// EUR-denominated positions have no FX leg by construction.
//
// Data: per-symbol EUR price series from the existing priceHistory; the FX
// path from the EXISTING Worker yf route (symbol EURUSD=X — USD per EUR,
// inverted here to EUR per USD). No new endpoint, no new data source; the
// panel degrades with the usual note when no Worker is configured.
//
// Position currencies mirror MaerminMetrics.computeCurrencyExposure exactly
// (transaction currency first, then the per-class default), so this view can
// never disagree with the Currency Exposure card.
//
// Pure layer (decompose, attribute, invertSeries, currencyOfPositions) is
// dual-exported and Node-tested (test/fx-attribution.test.js); the Panel folds
// into the existing Returns and Attribution views — no new tab.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  // EURUSD=X quotes USD per EUR; the decomposition needs EUR per USD.
  function invertSeries(series) {
    return (series || []).map(function (v) {
      var n = num(v);
      return (n != null && n > 0) ? 1 / n : null;
    }).filter(function (v) { return v != null; });
  }

  // Tail-align two series to their common length (same convention as
  // MaerminAnalyticsData.alignReturns: the most recent points overlap).
  function alignTails(a, b) {
    var n = Math.min((a || []).length, (b || []).length);
    if (n < 2) return null;
    return { a: a.slice(a.length - n), b: b.slice(b.length - n), periods: n };
  }

  // Total return over a series (last vs first), null when not computable.
  function totalReturn(series) {
    if (!series || series.length < 2) return null;
    var first = num(series[0]), last = num(series[series.length - 1]);
    if (first == null || last == null || first <= 0) return null;
    return last / first - 1;
  }

  // ---- dated series (FINDINGS M-5) ------------------------------------------
  // Price refreshes are not trading days: 100 refreshes in two days used to be
  // measured against the last 100 DAILY FX bars. Both sides now carry dates and
  // are aligned by calendar day.
  function ymd(v) {
    if (v == null) return '';
    if (typeof v === 'number') { var t = new Date(v); return isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10); }
    var s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
  }
  // priceHistory points [{timestamp, price}] -> [{date, value}], the LAST
  // point of each day, oldest first. Undatable points are skipped.
  function datedSeries(points) {
    var byDay = {};
    (Array.isArray(points) ? points : []).forEach(function (p) {
      var d = ymd(p && p.timestamp), v = num(p && p.price);
      if (!d || v == null || v <= 0) return;
      var ts = typeof p.timestamp === 'number' ? p.timestamp : Date.parse(p.timestamp);
      if (!byDay[d] || ts >= byDay[d].ts) byDay[d] = { ts: ts, value: v };
    });
    return Object.keys(byDay).sort().map(function (d) { return { date: d, value: byDay[d].value }; });
  }
  // Worker yf response for EURUSD=X -> [{date, value: EUR per USD}], each bar
  // under its trading day (MaerminFxHistory.barDate, see H-2).
  function datedFx(json) {
    var FXH = (typeof window !== 'undefined') && window.MaerminFxHistory;
    var tz = json && json.exchangeTz && json.exchangeTz !== 'UTC' ? String(json.exchangeTz) : '';
    var by = {};
    ((json && json.prices) || []).forEach(function (p) {
      var d = (FXH && FXH.barDate) ? FXH.barDate(p, tz) : ymd(p && p.date), px = num(p && p.price);
      if (d && px != null && px > 0) by[d] = 1 / px;
    });
    return Object.keys(by).sort().map(function (d) { return { date: d, value: by[d] }; });
  }
  // EUR-per-USD rate on or at most 7 days before `date` (weekends/holidays
  // take the last bar); null when the FX path does not cover the date.
  var FX_MAX_GAP_DAYS = 7;
  function fxOnOrBefore(fxDated, date) {
    var best = null;
    (fxDated || []).forEach(function (f) { if (f.date <= date && (!best || f.date > best.date)) best = f; });
    if (!best) return null;
    return (Date.parse(date + 'T00:00:00Z') - Date.parse(best.date + 'T00:00:00Z')) / 86400000 <= FX_MAX_GAP_DAYS ? best.value : null;
  }
  function isDated(series) { return Array.isArray(series) && series.length > 0 && series[0] && typeof series[0] === 'object' && 'date' in series[0]; }

  function decomposeDated(eurDated, fxDated, currency) {
    if (!eurDated || eurDated.length < 2) return null;
    if (currency !== 'USD' || !fxDated || !fxDated.length) {
      var r0 = eurDated[eurDated.length - 1].value / eurDated[0].value - 1;
      return { eurReturn: r0, localReturn: r0, fxReturn: 0, interaction: 0, periods: eurDated.length, currency: currency || 'EUR', from: eurDated[0].date, to: eurDated[eurDated.length - 1].date };
    }
    // The window: the first and last position days that the FX path covers.
    var pts = eurDated.map(function (p) { return { date: p.date, value: p.value, fx: fxOnOrBefore(fxDated, p.date) }; })
      .filter(function (p) { return p.fx != null; });
    if (pts.length < 2) return null;
    var first = pts[0], last = pts[pts.length - 1];
    var eurReturn = last.value / first.value - 1;
    var fxReturn = last.fx / first.fx - 1;
    var localReturn = (1 + eurReturn) / (1 + fxReturn) - 1;
    return { eurReturn: eurReturn, localReturn: localReturn, fxReturn: fxReturn, interaction: eurReturn - localReturn - fxReturn, periods: pts.length, currency: 'USD', from: first.date, to: last.date };
  }

  // Decompose ONE position's EUR return over the overlap with the FX path.
  // currency 'EUR' (or a missing FX path) means the whole return is local.
  // Dated series ([{date, value}]) are aligned by day; plain arrays keep the
  // older tail alignment by count.
  function decompose(eurSeries, fxSeries, currency) {
    if (isDated(eurSeries)) return decomposeDated(eurSeries, isDated(fxSeries) ? fxSeries : null, currency);
    var eurReturn = totalReturn(eurSeries);
    if (eurReturn == null) return null;
    if (currency !== 'USD' || !fxSeries || fxSeries.length < 2) {
      return { eurReturn: eurReturn, localReturn: eurReturn, fxReturn: 0, interaction: 0, periods: (eurSeries || []).length, currency: currency || 'EUR' };
    }
    var aligned = alignTails(eurSeries, fxSeries);
    if (!aligned) return null;
    var alignedEur = totalReturn(aligned.a);
    var fxReturn = totalReturn(aligned.b);
    if (alignedEur == null || fxReturn == null) return null;
    var localReturn = (1 + alignedEur) / (1 + fxReturn) - 1;
    return {
      eurReturn: alignedEur,
      localReturn: localReturn,
      fxReturn: fxReturn,
      interaction: alignedEur - localReturn - fxReturn,
      periods: aligned.periods,
      currency: 'USD'
    };
  }

  // Position currency resolution — MIRRORS MaerminMetrics.computeCurrencyExposure
  // (the single source of truth for the Currency Exposure card): the first
  // transaction currency per class+symbol wins, crypto/skins default to USD,
  // stocks/commodities to EUR.
  function currencyOfPositions(transactions) {
    var map = {};
    (transactions || []).forEach(function (tx) {
      var key = (tx.category || 'crypto') + '-' + (tx.symbol || '').toLowerCase();
      if (tx.currency && !map[key]) map[key] = tx.currency;
    });
    return function (cls, symbol) {
      return map[cls + '-' + String(symbol || '').toLowerCase()] || ((cls === 'crypto' || cls === 'skins') ? 'USD' : 'EUR');
    };
  }

  // Attribute the whole portfolio. rows: [{symbol, cls, currency, valueEUR,
  // series}] (series = EUR price path). fxSeries = EUR per USD. Per-position
  // windows differ with the available history, so the aggregate is the
  // VALUE-WEIGHTED average of per-position total returns — an approximation
  // the UI states.
  function attribute(rows, fxSeries) {
    var positions = [];
    var totalValue = 0;
    (rows || []).forEach(function (r) {
      var d = decompose(r.series, fxSeries, r.currency);
      if (!d || !(r.valueEUR > 0)) return;
      totalValue += r.valueEUR;
      positions.push({
        symbol: r.symbol, cls: r.cls, currency: d.currency, valueEUR: r.valueEUR,
        eurReturn: d.eurReturn, localReturn: d.localReturn, fxReturn: d.fxReturn,
        interaction: d.interaction, periods: d.periods
      });
    });
    if (!positions.length || totalValue <= 0) {
      return { available: false, positions: [], totals: null, byCurrency: [] };
    }
    var totals = { eurReturn: 0, localReturn: 0, fxReturn: 0, interaction: 0 };
    var curMap = {};
    positions.forEach(function (p) {
      var w = p.valueEUR / totalValue;
      p.weight = w;
      totals.eurReturn += w * p.eurReturn;
      totals.localReturn += w * p.localReturn;
      totals.fxReturn += w * p.fxReturn;
      totals.interaction += w * p.interaction;
      var c = curMap[p.currency] || (curMap[p.currency] = { currency: p.currency, weight: 0, fxContribution: 0, localContribution: 0 });
      c.weight += w;
      c.fxContribution += w * p.fxReturn;
      c.localContribution += w * p.localReturn;
    });
    var byCurrency = Object.keys(curMap).map(function (k) { return curMap[k]; })
      .sort(function (a, b) { return b.weight - a.weight; });
    positions.sort(function (a, b) { return Math.abs(b.fxReturn * b.weight) - Math.abs(a.fxReturn * a.weight); });
    return { available: true, positions: positions, totals: totals, byCurrency: byCurrency, totalValue: totalValue };
  }

  // Build attribution rows from the app's primitives (browser glue, thin).
  function rowsFromPortfolio(portfolio, prices, priceHistory, transactions) {
    var currencyOf = currencyOfPositions(transactions);
    var rows = [];
    ['crypto', 'stocks', 'skins', 'commodities'].forEach(function (cls) {
      ((portfolio || {})[cls] || []).forEach(function (p) {
        var s = p.symbol || p.name || '';
        var hist = (priceHistory || {})[s] || (priceHistory || {})[s.toLowerCase()] || (priceHistory || {})[s.toUpperCase()];
        var series = datedSeries(hist); // one dated point per day (M-5)
        var amount = parseFloat(p.amount) || 0;
        var price = (prices || {})[s] || (prices || {})[s.toLowerCase()] || (prices || {})[s.toUpperCase()] || parseFloat(p.purchasePrice) || 0;
        var valueEUR = amount * price;
        if (valueEUR <= 0 || !series || series.length < 2) return;
        rows.push({ symbol: s, cls: cls, currency: currencyOf(cls, s), valueEUR: valueEUR, series: series });
      });
    });
    return rows;
  }

  // ---- React Panel (browser only; folds into Returns + Attribution) ----------
  var _fxCache = null; // session cache of the fetched EUR-per-USD series

  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var good = theme.success || '#22c55e', bad = theme.danger || theme.negative || '#ef4444';
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');

    var sFx = React.useState(_fxCache);
    var fx = sFx[0], setFx = sFx[1];
    var sLoad = React.useState(false); var loading = sLoad[0], setLoading = sLoad[1];
    var sErr = React.useState(null); var err = sErr[0], setErr = sErr[1];

    React.useEffect(function () {
      if (!workerBase || _fxCache) return;
      var cancelled = false; setLoading(true); setErr(null);
      var url = workerBase + '?action=yf&symbol=' + encodeURIComponent('EURUSD=X') + '&interval=1d&range=1y';
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
      fetch(url, { signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (cancelled) return;
          if (!j || j.error || !Array.isArray(j.prices)) { setErr((j && j.error) || 'No FX data'); }
          else {
            _fxCache = datedFx(j); // dated EUR-per-USD bars, aligned to positions by day (M-5)
            setFx(_fxCache);
          }
          setLoading(false);
        })
        .catch(function (ex) { if (cancelled) return; setErr((ex && ex.name === 'AbortError') ? __('fxaTimedOut', 'Timed out') : __('fxaFetchFailed', 'Fetch failed')); setLoading(false); })
        .then(function () { if (timer) clearTimeout(timer); });
      return function () { cancelled = true; if (timer) clearTimeout(timer); };
    }, [workerBase]);

    var rows = rowsFromPortfolio(props.portfolio, props.prices, props.priceHistory, props.transactions);
    var result = attribute(rows, fx);
    var hasUsd = rows.some(function (r) { return r.currency === 'USD'; });

    var pct = function (x) { return x == null ? '-' : window.MaerminI18n.pct(x * 100, 2, true); };
    var colorOf = function (x) { return x == null ? dim : (x >= 0 ? good : bad); };
    function tile(label, value, color) {
      return e('div', { key: label, style: { background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.7rem 0.9rem', minWidth: '120px' } },
        e('div', { style: { color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label),
        e('div', { style: { color: color || text, fontSize: '1.1rem', fontWeight: '700', marginTop: '0.15rem' } }, value));
    }

    var body;
    if (!rows.length) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, __('fxaNeedHistory', 'Refresh prices a few times to unlock FX attribution - it needs a short per-position price history.'));
    } else if (!hasUsd) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, __('fxaAllEur', 'All positions are EUR-denominated - exchange rates contribute nothing to your returns.'));
    } else if (!workerBase) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, __('fxaNeedWorker', 'Add a Worker URL in API Settings to load the EUR/USD history for the FX decomposition.'));
    } else if (loading) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, __('fxaLoading', 'Loading EUR/USD history...'));
    } else if (err) {
      body = e('div', { style: { color: bad, fontSize: '0.85rem' } }, __('fxaLoadFailed', 'Could not load FX history: {msg}', { msg: err }));
    } else if (!result.available) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, __('fxaNotEnough', 'Not enough overlapping history to attribute yet.'));
    } else {
      var tot = result.totals;
      var topRows = result.positions.filter(function (p) { return p.currency === 'USD'; }).slice(0, 6);
      body = e('div', null,
        e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' } },
          tile(__('fxaPortReturn', 'Portfolio return (EUR)'), pct(tot.eurReturn), colorOf(tot.eurReturn)),
          tile(__('fxaLocalPart', 'Asset (local) part'), pct(tot.localReturn), colorOf(tot.localReturn)),
          tile(__('fxaFxPart', 'FX part'), pct(tot.fxReturn), colorOf(tot.fxReturn)),
          tile(__('fxaInteraction', 'Interaction'), pct(tot.interaction), dim)),
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, margin: '0.4rem 0 0.4rem' } }, __('fxaByCurrency', 'By currency')),
        result.byCurrency.map(function (c) {
          return e('div', { key: c.currency, style: { display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', fontSize: '0.8rem' } },
            e('span', { style: { color: text, fontWeight: 600 } }, c.currency + '  ' + __('rtaOfValue', '{pct} of value', { pct: window.MaerminI18n.pct(c.weight * 100, 0) })),
            e('span', { style: { color: dim } }, __('fxaAsset', 'asset') + ' ', e('span', { style: { color: colorOf(c.localContribution), fontWeight: 600 } }, pct(c.localContribution)),
              '  ' + __('fxaFx', 'fx') + ' ', e('span', { style: { color: colorOf(c.fxContribution), fontWeight: 600 } }, pct(c.fxContribution))));
        }),
        topRows.length ? e('div', null,
          e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, margin: '0.8rem 0 0.3rem' } }, __('fxaLargest', 'Largest FX impacts')),
          e('div', { style: { overflowX: 'auto' } },
            e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
              e('thead', null, e('tr', null, [__('position', 'Position'), __('colWeight', 'Weight'), __('fxaEurReturn', 'EUR return'), __('fxaLocalReturn', 'Local return'), __('fxaFxEffect', 'FX effect')].map(function (h, i) {
                return e('th', { key: h, style: { textAlign: i === 0 ? 'left' : 'right', padding: '0.35rem 0.45rem', color: dim, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
              }))),
              e('tbody', null, topRows.map(function (p) {
                return e('tr', { key: p.cls + p.symbol, style: { borderTop: '1px solid ' + border } },
                  e('td', { style: { padding: '0.4rem 0.45rem', color: text, fontSize: '0.8rem', fontWeight: 600 } }, p.symbol),
                  e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, window.MaerminI18n.pct(p.weight * 100, 1)),
                  e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: colorOf(p.eurReturn), fontSize: '0.78rem' } }, pct(p.eurReturn)),
                  e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: colorOf(p.localReturn), fontSize: '0.78rem' } }, pct(p.localReturn)),
                  e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: colorOf(p.fxReturn), fontSize: '0.78rem', fontWeight: 700 } }, pct(p.fxReturn)));
              }))))) : null,
        e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.8rem', lineHeight: 1.5 } },
          __('fxaFootnote', "Decomposition (1+r_EUR) = (1+r_local) x (1+r_fx) over each position's available history vs the EUR/USD path; the portfolio line is the value-weighted average across positions, so windows differ with data coverage. An estimate, not a statement of account.")));
    }

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginTop: '1rem' } },
      e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: '0 0 0.9rem' } }, t.fxAttributionTitle || 'Currency attribution (FX)'),
      body);
  }

  var api = {
    invertSeries: invertSeries,
    alignTails: alignTails,
    totalReturn: totalReturn,
    decompose: decompose,
    datedSeries: datedSeries, datedFx: datedFx, fxOnOrBefore: fxOnOrBefore,
    currencyOfPositions: currencyOfPositions,
    attribute: attribute,
    rowsFromPortfolio: rowsFromPortfolio,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminFxAttribution = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
