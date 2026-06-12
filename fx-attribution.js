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

  // Decompose ONE position's EUR return over the overlap with the FX path.
  // currency 'EUR' (or a missing FX path) means the whole return is local.
  function decompose(eurSeries, fxSeries, currency) {
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
    var D = (typeof window !== 'undefined') && window.MaerminAnalyticsData;
    var currencyOf = currencyOfPositions(transactions);
    var rows = [];
    ['crypto', 'stocks', 'skins', 'commodities'].forEach(function (cls) {
      ((portfolio || {})[cls] || []).forEach(function (p) {
        var s = p.symbol || p.name || '';
        var hist = (priceHistory || {})[s] || (priceHistory || {})[s.toLowerCase()] || (priceHistory || {})[s.toUpperCase()];
        var series = (D && D.pricesOf) ? D.pricesOf(hist) : [];
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
    var t = props.t || {};
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
      var D = window.MaerminAnalyticsData;
      var url = workerBase + '?action=yf&symbol=' + encodeURIComponent('EURUSD=X') + '&interval=1d&range=1y';
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
      fetch(url, { signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (cancelled) return;
          if (!j || j.error || !Array.isArray(j.prices)) { setErr((j && j.error) || 'No FX data'); }
          else {
            _fxCache = invertSeries(D && D.pricesOf ? D.pricesOf(j.prices) : j.prices.map(function (p) { return p.price; }));
            setFx(_fxCache);
          }
          setLoading(false);
        })
        .catch(function (ex) { if (cancelled) return; setErr((ex && ex.name === 'AbortError') ? 'Timed out' : 'Fetch failed'); setLoading(false); })
        .then(function () { if (timer) clearTimeout(timer); });
      return function () { cancelled = true; if (timer) clearTimeout(timer); };
    }, [workerBase]);

    var rows = rowsFromPortfolio(props.portfolio, props.prices, props.priceHistory, props.transactions);
    var result = attribute(rows, fx);
    var hasUsd = rows.some(function (r) { return r.currency === 'USD'; });

    var pct = function (x) { return x == null ? '-' : ((x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%'); };
    var colorOf = function (x) { return x == null ? dim : (x >= 0 ? good : bad); };
    function tile(label, value, color) {
      return e('div', { key: label, style: { background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.7rem 0.9rem', minWidth: '120px' } },
        e('div', { style: { color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label),
        e('div', { style: { color: color || text, fontSize: '1.1rem', fontWeight: '700', marginTop: '0.15rem' } }, value));
    }

    var body;
    if (!rows.length) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, 'Refresh prices a few times to unlock FX attribution - it needs a short per-position price history.');
    } else if (!hasUsd) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, 'All positions are EUR-denominated - exchange rates contribute nothing to your returns.');
    } else if (!workerBase) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, 'Add a Worker URL in API Settings to load the EUR/USD history for the FX decomposition.');
    } else if (loading) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, 'Loading EUR/USD history...');
    } else if (err) {
      body = e('div', { style: { color: bad, fontSize: '0.85rem' } }, 'Could not load FX history: ' + err);
    } else if (!result.available) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem' } }, 'Not enough overlapping history to attribute yet.');
    } else {
      var tot = result.totals;
      var topRows = result.positions.filter(function (p) { return p.currency === 'USD'; }).slice(0, 6);
      body = e('div', null,
        e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' } },
          tile('Portfolio return (EUR)', pct(tot.eurReturn), colorOf(tot.eurReturn)),
          tile('Asset (local) part', pct(tot.localReturn), colorOf(tot.localReturn)),
          tile('FX part', pct(tot.fxReturn), colorOf(tot.fxReturn)),
          tile('Interaction', pct(tot.interaction), dim)),
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, margin: '0.4rem 0 0.4rem' } }, 'By currency'),
        result.byCurrency.map(function (c) {
          return e('div', { key: c.currency, style: { display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', fontSize: '0.8rem' } },
            e('span', { style: { color: text, fontWeight: 600 } }, c.currency + '  ' + (c.weight * 100).toFixed(0) + '% of value'),
            e('span', { style: { color: dim } }, 'asset ', e('span', { style: { color: colorOf(c.localContribution), fontWeight: 600 } }, pct(c.localContribution)),
              '  fx ', e('span', { style: { color: colorOf(c.fxContribution), fontWeight: 600 } }, pct(c.fxContribution))));
        }),
        topRows.length ? e('div', null,
          e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, margin: '0.8rem 0 0.3rem' } }, 'Largest FX impacts'),
          e('div', { style: { overflowX: 'auto' } },
            e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
              e('thead', null, e('tr', null, ['Position', 'Weight', 'EUR return', 'Local return', 'FX effect'].map(function (h, i) {
                return e('th', { key: h, style: { textAlign: i === 0 ? 'left' : 'right', padding: '0.35rem 0.45rem', color: dim, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
              }))),
              e('tbody', null, topRows.map(function (p) {
                return e('tr', { key: p.cls + p.symbol, style: { borderTop: '1px solid ' + border } },
                  e('td', { style: { padding: '0.4rem 0.45rem', color: text, fontSize: '0.8rem', fontWeight: 600 } }, p.symbol),
                  e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, (p.weight * 100).toFixed(1) + '%'),
                  e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: colorOf(p.eurReturn), fontSize: '0.78rem' } }, pct(p.eurReturn)),
                  e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: colorOf(p.localReturn), fontSize: '0.78rem' } }, pct(p.localReturn)),
                  e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: colorOf(p.fxReturn), fontSize: '0.78rem', fontWeight: 700 } }, pct(p.fxReturn)));
              }))))) : null,
        e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.8rem', lineHeight: 1.5 } },
          'Decomposition (1+r_EUR) = (1+r_local) x (1+r_fx) over each position\'s available history vs the EUR/USD path; the portfolio line is the value-weighted average across positions, so windows differ with data coverage. An estimate, not a statement of account.'));
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
    currencyOfPositions: currencyOfPositions,
    attribute: attribute,
    rowsFromPortfolio: rowsFromPortfolio,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminFxAttribution = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
