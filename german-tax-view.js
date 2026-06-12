// ============================================================================
// MAERMIN — German fund taxation panel  (window.MaerminGermanTaxView)
// ----------------------------------------------------------------------------
// Thin view shell over TaxCalculationEngine.GermanTax (the pure engine) and
// MaerminTaxReport (the integrated report): folds a "German fund taxation"
// block into the existing Tax view when the jurisdiction is Germany — no new
// tab. It lets the user
//
//   - classify fund positions (equity/mixed/real-estate) for Teilfreistellung,
//   - compute the Vorabpauschale per accumulating fund and tax year (values
//     prefilled from the local price history where it covers the year
//     boundaries, editable everywhere) and save it to the local records so a
//     later sale credits it,
//   - maintain the Basiszins for the year and the church-tax rate,
//   - see the full ordered German computation (Teilfreistellung ->
//     Verrechnung -> Sparerpauschbetrag -> Abgeltungsteuer/Soli/KiSt).
//
// The pure prefill helpers (priceAt, qtyAt, prefillRow) are dual-exported and
// covered by test/german-tax.test.js; the Panel is browser-only. All stored
// inputs live in keys registered in SENSITIVE_KEYS (encrypted at rest). The
// numbers are a helper computation, not tax advice — the panel says so.
// ============================================================================
(function () {
  'use strict';

  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

  // Latest known price at or before `dateISO` from a priceHistory series of
  // { timestamp, price } rows (the app's real shape). Null when uncovered.
  function priceAt(history, dateISO) {
    if (!Array.isArray(history) || !history.length) return null;
    var cutoff = new Date(dateISO).getTime();
    if (isNaN(cutoff)) return null;
    var best = null, bestTs = -Infinity;
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      var ts = new Date(h && h.timestamp).getTime();
      var p = num(h && h.price);
      if (isNaN(ts) || p == null || p <= 0) continue;
      if (ts <= cutoff && ts > bestTs) { bestTs = ts; best = p; }
    }
    return best;
  }

  // Net quantity of `symbol` held at the end of `dateISO` (buys minus sells).
  function qtyAt(transactions, symbol, dateISO) {
    var cutoff = new Date(dateISO).getTime();
    var sym = String(symbol || '').toUpperCase();
    var qty = 0;
    (transactions || []).forEach(function (tx) {
      if (String(tx.symbol || '').toUpperCase() !== sym) return;
      var ts = new Date(tx.date).getTime();
      if (isNaN(ts) || ts > cutoff) return;
      var q = num(tx.quantity) || 0;
      if (tx.type === 'buy') qty += q; else if (tx.type === 'sell') qty -= q;
    });
    return Math.max(0, qty);
  }

  // Prefill one Vorabpauschale row for symbol/year from what the app already
  // knows. Per-share year-boundary prices x shares held at year end is the
  // standard simplification (the month factor covers intra-year purchases);
  // everything stays editable in the UI. exchangeRate converts USD histories.
  function prefillRow(transactions, priceHistory, symbol, year, exchangeRate) {
    var GT = moduleGermanTax();
    var sym = String(symbol || '').toUpperCase();
    var startISO = year + '-01-01';
    var endISO = year + '-12-31';
    var history = (priceHistory || {})[sym] || (priceHistory || {})[sym.toLowerCase()] || (priceHistory || {})[symbol] || null;
    var shares = qtyAt(transactions, sym, endISO + 'T23:59:59Z');
    var pStart = priceAt(history, startISO + 'T23:59:59Z');
    var pEnd = priceAt(history, endISO + 'T23:59:59Z');

    // Distributions: dividend transactions of the symbol inside the year.
    var distributions = 0;
    (transactions || []).forEach(function (tx) {
      if (tx.type !== 'dividend' || String(tx.symbol || '').toUpperCase() !== sym) return;
      var y = new Date(tx.date).getFullYear();
      if (y !== year) return;
      var gross = (num(tx.quantity) || 0) * (num(tx.price) || 0) || (num(tx.amount) || 0);
      if (tx.currency === 'USD' && exchangeRate > 0) gross *= exchangeRate;
      distributions += gross;
    });

    // Month factor from the first acquisition that falls inside the year;
    // positions opened earlier count the full year.
    var earliestBuy = null;
    (transactions || []).forEach(function (tx) {
      if (tx.type !== 'buy' || String(tx.symbol || '').toUpperCase() !== sym) return;
      if (!earliestBuy || new Date(tx.date) < new Date(earliestBuy)) earliestBuy = tx.date;
    });
    var monthsFactor = (GT && earliestBuy) ? GT.monthsFactorForPurchase(earliestBuy, year) : 1;

    return {
      symbol: sym,
      shares: shares,
      valueStart: (pStart != null && shares > 0) ? pStart * shares : null,
      valueEnd: (pEnd != null && shares > 0) ? pEnd * shares : null,
      distributions: distributions,
      monthsFactor: monthsFactor
    };
  }

  function moduleGermanTax() {
    if (typeof window !== 'undefined' && window.TaxCalculationEngine) return window.TaxCalculationEngine.GermanTax;
    try { return require('./tax-calculation-engine.js').GermanTax; } catch (e) { return null; }
  }

  // ---- React Panel (browser only; folds into the Tax view, DE only) ---------
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    var GT = (typeof window !== 'undefined') && window.TaxCalculationEngine && window.TaxCalculationEngine.GermanTax;
    if (!React || !GT) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var good = theme.success || '#22c55e', warn = theme.warning || '#f59e0b', bad = theme.danger || '#ef4444';
    var fmt = props.formatPrice || function (v) { return Number(v || 0).toFixed(2); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '€';
    var year = props.year || new Date().getFullYear();
    var transactions = props.transactions || [];
    var exchangeRate = props.exchangeRate || 0;

    var sFundTypes = React.useState(GT.loadFundTypes);
    var fundTypes = sFundTypes[0], setFundTypes = sFundTypes[1];
    var sKist = React.useState(GT.loadKirchensteuerRate);
    var kist = sKist[0], setKist = sKist[1];
    var sOverrides = React.useState(GT.loadBasiszinsOverrides);
    var overrides = sOverrides[0], setOverrides = sOverrides[1];
    var sEdits = React.useState({}); var edits = sEdits[0], setEdits = sEdits[1];
    var sSaved = React.useState(0); var savedTick = sSaved[0], setSavedTick = sSaved[1];

    var basiszins = GT.basiszinsFor(year, overrides);

    // Fund rows: stock positions that look like funds (X-Ray heuristic) plus
    // anything the user already classified.
    var LT = (typeof window !== 'undefined') && window.MaerminLookThrough;
    var seen = {};
    var rows = [];
    ((props.portfolio || {}).stocks || []).forEach(function (p) {
      var s = String(p.symbol || p.name || '').toUpperCase();
      if (!s || seen[s]) return;
      seen[s] = true;
      var isCandidate = (LT && LT.isFundCandidate) ? LT.isFundCandidate(s, p.name) : false;
      if (isCandidate || fundTypes[s]) rows.push({ symbol: s, name: p.name || s });
    });

    var records = GT.loadVapRecords();
    var inputStyle = { width: '110px', background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.45rem', color: text, fontSize: '0.76rem', textAlign: 'right' };

    function edited(symbol, field, fallback) {
      var ed = edits[symbol] || {};
      if (ed[field] != null && ed[field] !== '') {
        var n = num(String(ed[field]).replace(',', '.'));
        return n != null ? n : fallback;
      }
      return fallback;
    }
    function setEdit(symbol, field, value) {
      setEdits(function (m) {
        var c = {}; for (var k in m) c[k] = m[k];
        c[symbol] = {}; for (var f in (m[symbol] || {})) c[symbol][f] = m[symbol][f];
        c[symbol][field] = value;
        return c;
      });
    }

    var tableRows = rows.map(function (r) {
      var pre = prefillRow(transactions, props.priceHistory, r.symbol, year, exchangeRate);
      var valueStart = edited(r.symbol, 'valueStart', pre.valueStart);
      var valueEnd = edited(r.symbol, 'valueEnd', pre.valueEnd);
      var distributions = edited(r.symbol, 'distributions', pre.distributions);
      var type = fundTypes[r.symbol] || 'none';
      var vap = (valueStart != null && valueEnd != null)
        ? GT.computeVorabpauschale({ valueStart: valueStart, valueEnd: valueEnd, distributions: distributions, basiszins: basiszins, monthsFactor: pre.monthsFactor })
        : null;
      var taxable = vap ? GT.applyTeilfreistellung(vap.vorabpauschale, type).taxable : null;
      var savedAmt = records[r.symbol] && records[r.symbol][year];

      function inputCell(field, value, placeholder) {
        var ed = (edits[r.symbol] || {})[field];
        return e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right' } },
          e('input', {
            type: 'text', value: ed != null ? ed : (value != null ? String(Math.round(value * 100) / 100) : ''),
            placeholder: placeholder || 'n/a',
            onChange: function (ev) { setEdit(r.symbol, field, ev.target.value); },
            style: inputStyle
          }));
      }

      return e('tr', { key: r.symbol, style: { borderTop: '1px solid ' + border } },
        e('td', { style: { padding: '0.4rem 0.45rem', color: text, fontSize: '0.8rem', fontWeight: 600 } }, r.symbol,
          e('div', { style: { color: dim, fontWeight: 400, fontSize: '0.68rem' } }, pre.shares > 0 ? pre.shares + ' shares' : '')),
        e('td', { style: { padding: '0.4rem 0.45rem' } },
          e('select', {
            value: type,
            onChange: function (ev) { setFundTypes(GT.saveFundType(r.symbol, ev.target.value)); },
            style: { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.4rem', color: text, fontSize: '0.74rem' }
          },
            e('option', { value: 'none' }, 'Not a fund / other (0%)'),
            e('option', { value: 'aktienfonds' }, 'Equity fund (30%)'),
            e('option', { value: 'mischfonds' }, 'Mixed fund (15%)'),
            e('option', { value: 'immobilienfonds' }, 'Real-estate fund (60%)'),
            e('option', { value: 'auslandsimmobilienfonds' }, 'Foreign RE fund (80%)'))),
        inputCell('valueStart', valueStart),
        inputCell('valueEnd', valueEnd),
        inputCell('distributions', distributions, '0'),
        e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: dim, fontSize: '0.76rem' } }, (pre.monthsFactor * 12).toFixed(0) + '/12'),
        e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: vap ? text : dim, fontSize: '0.78rem', fontWeight: 700 } }, vap ? sym + fmt(vap.vorabpauschale) : '-'),
        e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: taxable != null ? text : dim, fontSize: '0.76rem' } }, taxable != null ? sym + fmt(taxable) : '-'),
        e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right' } },
          e('button', {
            disabled: !vap,
            onClick: function () { if (vap) { GT.saveVapRecord(r.symbol, year, vap.vorabpauschale); setSavedTick(savedTick + 1); } },
            style: { padding: '0.3rem 0.7rem', borderRadius: '6px', border: 'none', cursor: vap ? 'pointer' : 'default', fontSize: '0.72rem', fontWeight: 700, background: savedAmt != null ? 'rgba(34,197,94,0.15)' : (theme.accent || '#f5a524'), color: savedAmt != null ? good : '#13110a', opacity: vap ? 1 : 0.5 }
          }, savedAmt != null ? 'Saved ' + sym + fmt(savedAmt) : 'Save')));
    });

    // Integrated German summary from the one report pipeline.
    var detail = null;
    try {
      var TR = window.MaerminTaxReport;
      if (TR) {
        var report = TR.build(transactions, {
          year: year, jurisdiction: 'de', baseCurrency: 'EUR',
          exchangeRate: exchangeRate, fundTypes: fundTypes, kirchensteuerRate: kist
        });
        detail = report && report.summary && report.summary.germanDetail;
      }
    } catch (err) { detail = null; }

    function line(label, value, color) {
      return e('div', { key: label, style: { display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', fontSize: '0.8rem' } },
        e('span', { style: { color: dim } }, label),
        e('span', { style: { color: color || text, fontWeight: 600 } }, value));
    }

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginTop: '1.25rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' } },
        e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: 0 } },
          (t.germanFundTaxTitle || 'German fund taxation') + ' ' + year),
        e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' } },
          e('span', { style: { color: dim, fontSize: '0.74rem' } }, 'Basiszins ' + year),
          e('input', {
            type: 'text', value: (overrides[year] != null ? overrides[year] * 100 : basiszins * 100).toFixed(3),
            onChange: function (ev) {
              var pct = parseFloat(String(ev.target.value).replace(',', '.'));
              setOverrides(GT.saveBasiszinsOverride(year, isFinite(pct) ? pct / 100 : null));
            },
            style: { width: '70px', background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.45rem', color: text, fontSize: '0.76rem', textAlign: 'right' }
          }),
          e('span', { style: { color: dim, fontSize: '0.74rem' } }, '%  Church tax'),
          e('select', {
            value: String(kist),
            onChange: function (ev) { setKist(GT.saveKirchensteuerRate(parseFloat(ev.target.value))); },
            style: { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.4rem', color: text, fontSize: '0.74rem' }
          },
            e('option', { value: '0' }, 'none'),
            e('option', { value: '0.08' }, '8%'),
            e('option', { value: '0.09' }, '9%')))),

      rows.length
        ? e('div', { style: { overflowX: 'auto' } },
            e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
              e('thead', null, e('tr', null,
                ['Fund', 'Type (Teilfreistellung)', 'Value Jan 1', 'Value Dec 31', 'Distributions', 'Months', 'Vorabpauschale', 'Taxable after TF', ''].map(function (h, i) {
                  return e('th', { key: h || 'x', style: { textAlign: i < 2 ? 'left' : 'right', padding: '0.4rem 0.45rem', color: dim, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
                }))),
              e('tbody', null, tableRows)))
        : e('div', { style: { color: dim, fontSize: '0.82rem', padding: '0.4rem 0' } },
            'No fund positions detected. Classify a position by adding it to your portfolio; ETFs and funds are picked up automatically.'),

      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } },
        'Values prefill from your local price history at the year boundaries (shares held at year end x per-share price) and are editable. Save a Vorabpauschale so a later sale credits it against the gain.'),

      detail && e('div', { style: { marginTop: '1rem', borderTop: '1px solid ' + border, paddingTop: '0.8rem' } },
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: '0.4rem' } }, 'Computation (statutory order)'),
        line('Taxable gains after Teilfreistellung', sym + fmt(detail.gainsTaxable)),
        line('Deductible losses after Teilfreistellung', sym + fmt(detail.lossesTaxable), detail.lossesTaxable < 0 ? bad : text),
        line('Taxable fund distributions', sym + fmt(detail.dividendsTaxable)),
        line('Vorabpauschale ' + year + ' (taxable)', sym + fmt(detail.vorabpauschaleTaxable)),
        detail.vapCreditTotal > 0 ? line('Credited prior Vorabpauschalen', '-' + sym + fmt(detail.vapCreditTotal), good) : null,
        line('Teilfreistellung exempt', sym + fmt(detail.teilfreistellungExempt), good),
        line('Sparerpauschbetrag used', sym + fmt(detail.sparerpauschbetragUsed), good),
        line('Taxable capital income', sym + fmt(detail.taxableIncome)),
        line('Abgeltungsteuer + Soli' + (detail.kirchensteuer > 0 ? ' + Kirchensteuer' : ''), sym + fmt(detail.abgeltungsteuer + detail.soli + detail.kirchensteuer), warn),
        detail.crypto && detail.crypto.netShortTermGains !== 0 ? line('Crypto net short-term (Freigrenze ' + detail.crypto.freigrenze + ')', sym + fmt(detail.crypto.netShortTermGains) + ' -> tax ' + sym + fmt(detail.crypto.estimatedTax)) : null,
        line('Total estimated tax ' + year, sym + fmt(detail.totalTax), warn)),

      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.8rem', lineHeight: 1.5 } },
        'Helper computation under InvStG/EStG rules with simplified loss netting; crypto uses a flat-rate estimate. All inputs stay on this device (encrypted at rest). Not tax advice - verify with your tax advisor.'));
  }

  var api = {
    priceAt: priceAt,
    qtyAt: qtyAt,
    prefillRow: prefillRow,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminGermanTaxView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
