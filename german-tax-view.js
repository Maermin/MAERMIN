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
  // Timestamp -> epoch ms. Only unambiguous forms are accepted: epoch numbers
  // and ISO-8601 strings. Older builds stored live points as a year-less
  // en-US string ("09/30, 08:14 PM") that V8 parses as the year 2001 - those
  // must never be matched against a tax-year boundary.
  function tsOf(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    var s = String(v == null ? '' : v);
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return NaN;
    return new Date(s).getTime();
  }

  function priceAt(history, dateISO) {
    if (!Array.isArray(history) || !history.length) return null;
    var cutoff = new Date(dateISO).getTime();
    if (isNaN(cutoff)) return null;
    var best = null, bestTs = -Infinity;
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      var ts = tsOf(h && h.timestamp);
      var p = num(h && h.price);
      if (isNaN(ts) || p == null || p <= 0) continue;
      if (ts <= cutoff && ts > bestTs) { bestTs = ts; best = p; }
    }
    return best;
  }

  function ledgerMod() {
    if (typeof window !== 'undefined' && window.MaerminLedger) return window.MaerminLedger;
    try { return require('./ledger.js'); } catch (e) { return null; }
  }

  // Open FIFO lots of `symbol` at the end of `dateISO`: [{ qty, date }], oldest
  // first - from the one FIFO ledger (same-day buys before sells, recorded
  // splits applied, so units match Yahoo's split-adjusted price history).
  function openLotsAt(transactions, symbol, dateISO) {
    var cutoff = new Date(dateISO).getTime();
    var sym = String(symbol || '').toUpperCase();
    var txs = (transactions || []).filter(function (tx) {
      if (!tx || String(tx.symbol || '').toUpperCase() !== sym) return false;
      if (tx.type !== 'buy' && tx.type !== 'sell') return false;
      var ts = new Date(tx.date).getTime();
      return !isNaN(ts) && ts <= cutoff;
    });
    var L = ledgerMod();
    if (!L || !txs.length) return [];
    var lots = [];
    L.build(txs, { exchangeRate: 1 }).list.forEach(function (g) {
      g.openLots.forEach(function (l) { lots.push({ qty: l.qty, date: l.date }); });
    });
    return lots.sort(function (x, y) { return String(x.date) < String(y.date) ? -1 : (String(x.date) > String(y.date) ? 1 : 0); });
  }

  // Units of `symbol` held at the end of `dateISO` (sum of the open lots).
  function qtyAt(transactions, symbol, dateISO) {
    return openLotsAt(transactions, symbol, dateISO).reduce(function (s, l) { return s + l.qty; }, 0);
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
      // Year of the stored 'YYYY-MM-DD' itself: getFullYear() would move a
      // 1 January payout into the previous year west of UTC.
      var m = /^(\d{4})-\d{2}-\d{2}/.exec(String(tx.date || ''));
      var y = m ? parseInt(m[1], 10) : new Date(tx.date).getFullYear();
      if (y !== year) return;
      var gross = (num(tx.quantity) || 0) * (num(tx.price) || 0) || (num(tx.amount) || 0);
      var FXH = (typeof window !== 'undefined' && window.MaerminFxHistory) || null;
      if (FXH && FXH.txToEUR) gross = FXH.txToEUR(gross, tx.currency, tx.date, exchangeRate, null).value;
      else if (tx.currency === 'USD' && exchangeRate > 0) gross *= exchangeRate;
      distributions += gross;
    });

    // Month factor PER LOT (sec. 18 (2) InvStG): every unit held at year end
    // carries the factor of its own acquisition month, so the units of a
    // savings plan bought during the year are reduced individually. The
    // effective factor is the share-weighted average over the open FIFO lots.
    // (It used to take the EARLIEST buy of the symbol, so a fund held since an
    // earlier year counted every in-year Sparplan unit at 12/12.)
    var lots = openLotsAt(transactions, sym, endISO + 'T23:59:59Z');
    var lotQty = 0, weighted = 0;
    lots.forEach(function (l) {
      var f = GT ? GT.monthsFactorForPurchase(l.date, year) : 1;
      lotQty += l.qty; weighted += l.qty * f;
    });
    var monthsFactor = lotQty > 0 ? weighted / lotQty : 1;

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
    // Every save here feeds the Tax view's report (KPIs, advisor, export):
    // tell the parent so it rebuilds instead of showing the old total.
    var changed = function () { if (props.onChange) props.onChange(); };

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

    // Commodities default to sec. 23 private sales (physical metal); a
    // securitised commodity (ETC/ETF) is capital income - one select per
    // position, stored as "SYMBOL|class" in the sensitive overrides store.
    var TSm = window.MaerminTaxSettings;
    var sClassTick = React.useState(0); var setClassTick = sClassTick[1];
    var classOverrides = (TSm && TSm.loadOverrides) ? TSm.loadOverrides() : {};
    var commoditySeen = {};
    var commodityRows = [];
    ((props.portfolio || {}).commodities || []).forEach(function (p) {
      var s = String(p.symbol || p.name || '').toUpperCase();
      if (!s || commoditySeen[s]) return;
      commoditySeen[s] = true;
      commodityRows.push({ symbol: s, name: p.name || s });
    });
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
            onChange: function (ev) { setFundTypes(GT.saveFundType(r.symbol, ev.target.value)); changed(); },
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
            onClick: function () { if (vap) { GT.saveVapRecord(r.symbol, year, vap.vorabpauschale); setSavedTick(savedTick + 1); changed(); } },
            style: { padding: '0.3rem 0.7rem', borderRadius: '6px', border: 'none', cursor: vap ? 'pointer' : 'default', fontSize: '0.72rem', fontWeight: 700, background: savedAmt != null ? 'rgba(34,197,94,0.15)' : (theme.accent || '#8b7cff'), color: savedAmt != null ? good : '#ffffff', opacity: vap ? 1 : 0.5 }
          }, savedAmt != null ? 'Saved ' + sym + fmt(savedAmt) : 'Save')));
    });

    // Integrated German summary from the one report pipeline.
    var detail = null;
    try {
      var TR = window.MaerminTaxReport;
      if (TR) {
        var report = TR.build(transactions, {
          year: year, jurisdiction: 'de', baseCurrency: 'EUR',
          exchangeRate: exchangeRate, fxAt: props.fxAt, fundTypes: fundTypes, kirchensteuerRate: kist
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
              setOverrides(GT.saveBasiszinsOverride(year, isFinite(pct) ? pct / 100 : null)); changed();
            },
            style: { width: '70px', background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.45rem', color: text, fontSize: '0.76rem', textAlign: 'right' }
          }),
          e('span', { style: { color: dim, fontSize: '0.74rem' } }, '%  Church tax'),
          e('select', {
            value: String(kist),
            onChange: function (ev) { setKist(GT.saveKirchensteuerRate(parseFloat(ev.target.value))); changed(); },
            style: { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.4rem', color: text, fontSize: '0.74rem' }
          },
            e('option', { value: '0' }, 'none'),
            e('option', { value: '0.08' }, '8%'),
            e('option', { value: '0.09' }, '9%')))),

      e('div', { style: { color: dim, fontSize: '0.72rem', margin: '0 0 0.5rem', lineHeight: 1.5 } },
        'Worksheet for value year ' + year + '. The Vorabpauschale is deemed received on the first working day of ' + (year + 1) +
        ' (sec. 18 (3) InvStG), so a saved amount counts in the ' + (year + 1) + ' tax computation.'),
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

      (commodityRows.length && TSm && TSm.saveTaxClass) ? e('div', { style: { marginTop: '1rem' } },
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: '0.3rem' } }, 'Commodities: tax treatment'),
        commodityRows.map(function (r) {
          var cls = (TSm.taxClassOf && TSm.taxClassOf(classOverrides, r.symbol)) || 'private';
          return e('div', { key: r.symbol, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', padding: '0.3rem 0', borderTop: '1px solid ' + border } },
            e('span', { style: { color: text, fontSize: '0.8rem', fontWeight: 600 } }, r.symbol),
            e('select', {
              value: cls,
              'aria-label': 'Tax treatment of ' + r.symbol,
              onChange: function (ev) { TSm.saveTaxClass(r.symbol, ev.target.value === 'capital' ? 'capital' : null); setClassTick(function (n) { return n + 1; }); changed(); },
              style: { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.4rem', color: text, fontSize: '0.74rem' }
            },
              e('option', { value: 'private' }, 'Physical - private sale (sec. 23, tax-free after 1 year)'),
              e('option', { value: 'capital' }, 'Security, e.g. ETC/ETF - capital income (sec. 20)')));
        })) : null,

      detail && e('div', { style: { marginTop: '1rem', borderTop: '1px solid ' + border, paddingTop: '0.8rem' } },
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: '0.4rem' } }, 'Computation (statutory order)'),
        line('Taxable gains after Teilfreistellung', sym + fmt(detail.gainsTaxable)),
        line('Deductible losses after Teilfreistellung', sym + fmt(detail.lossesTaxable), detail.lossesTaxable < 0 ? bad : text),
        detail.shareLossCarried > 0 ? line('Share losses not offset (only against share gains)', sym + fmt(detail.shareLossCarried), dim) : null,
        line('Taxable fund distributions', sym + fmt(detail.dividendsTaxable)),
        line('Vorabpauschale ' + (year - 1) + ' (taxed in ' + year + ')', sym + fmt(detail.vorabpauschaleTaxable)),
        detail.vapCreditTotal > 0 ? line('Credited prior Vorabpauschalen', '-' + sym + fmt(detail.vapCreditTotal), good) : null,
        line('Teilfreistellung exempt', sym + fmt(detail.teilfreistellungExempt), good),
        line('Sparerpauschbetrag used', sym + fmt(detail.sparerpauschbetragUsed), good),
        line('Taxable capital income', sym + fmt(detail.taxableIncome)),
        line('Abgeltungsteuer + Soli' + (detail.kirchensteuer > 0 ? ' + Kirchensteuer' : ''), sym + fmt(detail.abgeltungsteuer + detail.soli + detail.kirchensteuer), warn),
        detail.crypto && detail.crypto.netShortTermGains !== 0 ? line('Private sales (sec. 23) net short-term (Freigrenze ' + detail.crypto.freigrenze + ')', sym + fmt(detail.crypto.netShortTermGains) + ' -> tax ' + sym + fmt(detail.crypto.estimatedTax)) : null,
        line('Total estimated tax ' + year, sym + fmt(detail.totalTax), warn)),

      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.8rem', lineHeight: 1.5 } },
        'Helper computation under InvStG/EStG rules with simplified loss netting; private sales (crypto, skins, physical commodities) use a flat-rate estimate. All inputs stay on this device (encrypted at rest). Not tax advice - verify with your tax advisor.'));
  }

  // ---- Tax settings panel (Task 8) ------------------------------------------
  // User overrides for the rate/flag layer (MaerminTaxSettings). Rates and
  // flags are non-sensitive; the per-position taxable override store is
  // sensitive (encrypted at rest) and edited from the German tax worksheet.
  function SettingsPanel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    var TS = (typeof window !== 'undefined') && window.MaerminTaxSettings;
    if (!React || !TS) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var accent = theme.accent || '#8b7cff';

    var sS = React.useState(TS.load); var s = sS[0], setS = sS[1];
    var sOpen = React.useState(false); var open = sOpen[0], setOpen = sOpen[1];
    function update(patch) { setS(TS.save(patch)); if (props.onChange) props.onChange(); }

    var inputStyle = { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.45rem', color: text, fontSize: '0.78rem', width: '90px', textAlign: 'right' };
    function row(label, control, hint) {
      return e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', padding: '0.4rem 0', borderTop: '1px solid ' + border } },
        e('div', null,
          e('div', { style: { color: text, fontSize: '0.82rem' } }, label),
          hint ? e('div', { style: { color: dim, fontSize: '0.7rem' } }, hint) : null),
        control);
    }
    function toggle(on, onClick) {
      return e('button', { onClick: onClick, style: { padding: '0.3rem 0.8rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 700, background: on ? (theme.success || '#22c55e') : inputBg, color: on ? '#08130a' : dim } }, on ? 'On' : 'Off');
    }

    var TF_TYPES = [['aktienfonds', 'Equity fund', 0.30], ['mischfonds', 'Mixed fund', 0.15], ['immobilienfonds', 'Real-estate fund', 0.60], ['auslandsimmobilienfonds', 'Foreign RE fund', 0.80]];

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem 1.25rem', marginTop: '1.25rem' } },
      // Re-read on open: the church tax can also change in the fund-tax panel.
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }, onClick: function () { if (!open) setS(TS.load()); setOpen(!open); } },
        e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: 0 } }, t.taxSettingsTitle || 'Tax settings (overrides)'),
        e('span', { style: { color: accent, fontSize: '0.8rem' } }, open ? 'Hide' : 'Edit')),
      open ? e('div', { style: { marginTop: '0.6rem' } },
        row('Abgeltungsteuer rate', e('div', null,
          e('input', { type: 'number', step: '0.1', value: (s.abgeltungRate * 100).toFixed(2).replace(/\.00$/, ''), onChange: function (ev) { var v = parseFloat(ev.target.value); update({ abgeltungRate: isFinite(v) ? v / 100 : 0.25 }); }, style: inputStyle }),
          e('span', { style: { color: dim, fontSize: '0.76rem', marginLeft: '0.25rem' } }, '%')), 'Default 25%'),
        row('Solidaritaetszuschlag', toggle(s.soli, function () { update({ soli: !s.soli }); }), '5.5% of the tax'),
        row('Kirchensteuer', e('select', { value: String(s.kirchensteuer), onChange: function (ev) { update({ kirchensteuer: parseFloat(ev.target.value) }); }, style: { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.4rem', color: text, fontSize: '0.76rem' } },
          e('option', { value: '0' }, 'None'), e('option', { value: '0.08' }, '8%'), e('option', { value: '0.09' }, '9%'))),
        row('Freistellungsauftrag', e('div', null,
          e('input', { type: 'number', value: s.freistellungsauftrag, onChange: function (ev) { var v = parseFloat(ev.target.value); update({ freistellungsauftrag: isFinite(v) ? v : 1000 }); }, style: inputStyle }),
          e('span', { style: { color: dim, fontSize: '0.76rem', marginLeft: '0.25rem' } }, 'EUR')), 'Sparerpauschbetrag, default 1000'),
        row('Crypto 1-year exemption', toggle(s.cryptoExemption, function () { update({ cryptoExemption: !s.cryptoExemption }); }), 'Private-sale rule (sec. 23 EStG)'),
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, margin: '0.8rem 0 0.3rem' } }, 'Teilfreistellung overrides'),
        TF_TYPES.map(function (tf) {
          var ovVal = (s.teilfreistellung && s.teilfreistellung[tf[0]] != null) ? s.teilfreistellung[tf[0]] : tf[2];
          return row(tf[1], e('div', null,
            e('input', { key: tf[0], type: 'number', step: '1', value: (ovVal * 100).toFixed(0), onChange: function (ev) {
              var v = parseFloat(ev.target.value); var map = Object.assign({}, s.teilfreistellung);
              if (isFinite(v) && Math.abs(v / 100 - tf[2]) > 1e-9) map[tf[0]] = v / 100; else delete map[tf[0]];
              update({ teilfreistellung: map });
            }, style: inputStyle }),
            e('span', { style: { color: dim, fontSize: '0.76rem', marginLeft: '0.25rem' } }, '%')), 'Default ' + (tf[2] * 100) + '%');
        }),
        e('button', { onClick: function () {
          window.MaerminUtils.confirmThen({
            title: t.taxResetTitle || 'Reset the tax settings to the defaults?',
            message: t.taxResetMessage || 'Your rates, church tax and Teilfreistellung overrides are replaced by the defaults.',
            confirmLabel: t.taxReset || 'Reset', cancelLabel: t.cancel || 'Cancel'
          }, function () { setS(TS.reset()); if (props.onChange) props.onChange(); });
        }, style: { marginTop: '0.7rem', padding: '0.35rem 0.8rem', borderRadius: '6px', border: '1px solid ' + border, background: inputBg, color: dim, cursor: 'pointer', fontSize: '0.74rem' } }, 'Reset to defaults'),
        e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } }, 'Overrides are stored on this device and feed the tax computation and the PDF/Excel export. Defaults apply where unset. Not tax advice.')
      ) : null);
  }

  var api = {
    priceAt: priceAt,
    qtyAt: qtyAt,
    openLotsAt: openLotsAt,
    prefillRow: prefillRow,
    Panel: Panel,
    SettingsPanel: SettingsPanel
  };
  if (typeof window !== 'undefined') window.MaerminGermanTaxView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
