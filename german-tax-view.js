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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

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
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var good = theme.success || '#22c55e', warn = theme.warning || '#f59e0b', bad = theme.danger || '#ef4444';
    var I18N = window.MaerminI18n;
    var fmt = props.formatPrice || function (v) { return I18N.num(v, 2); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '€';
    // Amount with the currency after it (1.234,56 € / 1,234.56 €), as elsewhere in the app.
    function amt(v) { return fmt(v) + ' ' + sym; }
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
          e('div', { style: { color: dim, fontWeight: 400, fontSize: '0.68rem' } }, pre.shares > 0 ? __('gtShares', '{n} shares', { n: I18N.num(pre.shares, { min: 0, max: 6 }) }) : '')),
        e('td', { style: { padding: '0.4rem 0.45rem' } },
          e('select', {
            value: type,
            onChange: function (ev) { setFundTypes(GT.saveFundType(r.symbol, ev.target.value)); changed(); },
            style: { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.4rem', color: text, fontSize: '0.74rem' }
          },
            e('option', { value: 'none' }, __('gtNotFund', 'Not a fund / other') + ' (' + I18N.pct(0, 0) + ')'),
            e('option', { value: 'aktienfonds' }, __('gtEquityFund', 'Equity fund') + ' (' + I18N.pct(30, 0) + ')'),
            e('option', { value: 'mischfonds' }, __('gtMixedFund', 'Mixed fund') + ' (' + I18N.pct(15, 0) + ')'),
            e('option', { value: 'immobilienfonds' }, __('gtRealEstateFund', 'Real-estate fund') + ' (' + I18N.pct(60, 0) + ')'),
            e('option', { value: 'auslandsimmobilienfonds' }, __('gtForeignReFund', 'Foreign RE fund') + ' (' + I18N.pct(80, 0) + ')'))),
        inputCell('valueStart', valueStart),
        inputCell('valueEnd', valueEnd),
        inputCell('distributions', distributions, '0'),
        e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: dim, fontSize: '0.76rem' } }, (pre.monthsFactor * 12).toFixed(0) + '/12'),
        e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: vap ? text : dim, fontSize: '0.78rem', fontWeight: 700 } }, vap ? amt(vap.vorabpauschale) : '-'),
        e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right', color: taxable != null ? text : dim, fontSize: '0.76rem' } }, taxable != null ? amt(taxable) : '-'),
        e('td', { style: { padding: '0.4rem 0.45rem', textAlign: 'right' } },
          e('button', {
            disabled: !vap,
            onClick: function () { if (vap) { GT.saveVapRecord(r.symbol, year, vap.vorabpauschale); setSavedTick(savedTick + 1); changed(); } },
            style: { padding: '0.3rem 0.7rem', borderRadius: '6px', border: 'none', cursor: vap ? 'pointer' : 'default', fontSize: '0.72rem', fontWeight: 700, background: savedAmt != null ? 'rgba(34,197,94,0.15)' : ((theme.accentFill || theme.accent) || '#8b7cff'), color: savedAmt != null ? good : '#ffffff', opacity: vap ? 1 : 0.5 }
          }, savedAmt != null ? __('gtSavedAmt', 'Saved {amount}', { amount: amt(savedAmt) }) : __('save', 'Save'))));
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
          e('span', { style: { color: dim, fontSize: '0.74rem' } }, __('gtBasiszins', 'Basiszins {y}', { y: year })),
          // Committed on blur / Enter: re-formatting on every keystroke made the
          // field impossible to edit ("3," parsed as nothing and reset it).
          e('input', {
            type: 'text', inputMode: 'decimal', key: 'bz-' + year + '-' + (overrides[year] != null ? overrides[year] : 'd'),
            'aria-label': __('gtBasiszinsAria', 'Basiszins {y} in percent', { y: year }),
            defaultValue: window.MaerminI18n.num((overrides[year] != null ? overrides[year] : basiszins) * 100, { min: 2, max: 3 }),
            onBlur: function (ev) {
              var raw = String(ev.target.value).trim();
              var pct = raw === '' ? NaN : window.MaerminUtils.parseDecimal(raw);
              setOverrides(GT.saveBasiszinsOverride(year, isFinite(pct) ? pct / 100 : null)); changed();
            },
            onKeyDown: function (ev) { if (ev.key === 'Enter') ev.target.blur(); },
            style: { width: '70px', background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.45rem', color: text, fontSize: '0.76rem', textAlign: 'right' }
          }),
          e('span', { style: { color: dim, fontSize: '0.74rem' } }, '%  ' + __('gtChurchTax', 'Church tax')),
          e('select', {
            'aria-label': __('gtChurchTax', 'Church tax'),
            value: String(kist),
            onChange: function (ev) { setKist(GT.saveKirchensteuerRate(parseFloat(ev.target.value))); changed(); },
            style: { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.4rem', color: text, fontSize: '0.74rem' }
          },
            e('option', { value: '0' }, __('gtNone', 'none')),
            e('option', { value: '0.08' }, I18N.pct(8, 0)),
            e('option', { value: '0.09' }, I18N.pct(9, 0))))),

      e('div', { style: { color: dim, fontSize: '0.72rem', margin: '0 0 0.5rem', lineHeight: 1.5 } },
        __('gtWorksheet', 'Worksheet for value year {y}. The Vorabpauschale is deemed received on the first working day of {next} (sec. 18 (3) InvStG), so a saved amount counts in the {next} tax computation.', { y: year, next: year + 1 })),
      rows.length
        ? e('div', { style: { overflowX: 'auto' } },
            e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
              e('thead', null, e('tr', null,
                [__('gtFund', 'Fund'), __('gtTypeTf', 'Type (Teilfreistellung)'), __('gtValueJan1', 'Value Jan 1'), __('gtValueDec31', 'Value Dec 31'), __('gtDistributions', 'Distributions'), __('gtMonths', 'Months'), 'Vorabpauschale', __('gtTaxableAfterTf', 'Taxable after TF'), ''].map(function (h, i) {
                  return e('th', { key: h || 'x', style: { textAlign: i < 2 ? 'left' : 'right', padding: '0.4rem 0.45rem', color: dim, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
                }))),
              e('tbody', null, tableRows)))
        : e('div', { style: { color: dim, fontSize: '0.82rem', padding: '0.4rem 0' } },
            __('gtNoFunds', 'No fund positions detected. Classify a position by adding it to your portfolio; ETFs and funds are picked up automatically.')),

      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } },
        __('gtPrefillHint', 'Values prefill from your local price history at the year boundaries (shares held at year end x per-share price) and are editable. Save a Vorabpauschale so a later sale credits it against the gain.')),

      (commodityRows.length && TSm && TSm.saveTaxClass) ? e('div', { style: { marginTop: '1rem' } },
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: '0.3rem' } }, __('gtCommodities', 'Commodities: tax treatment')),
        commodityRows.map(function (r) {
          var cls = (TSm.taxClassOf && TSm.taxClassOf(classOverrides, r.symbol)) || 'private';
          return e('div', { key: r.symbol, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', padding: '0.3rem 0', borderTop: '1px solid ' + border } },
            e('span', { style: { color: text, fontSize: '0.8rem', fontWeight: 600 } }, r.symbol),
            e('select', {
              value: cls,
              'aria-label': __('gtTaxTreatmentOf', 'Tax treatment of {sym}', { sym: r.symbol }),
              onChange: function (ev) { TSm.saveTaxClass(r.symbol, ev.target.value === 'capital' ? 'capital' : null); setClassTick(function (n) { return n + 1; }); changed(); },
              style: { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.4rem', color: text, fontSize: '0.74rem' }
            },
              e('option', { value: 'private' }, __('gtPhysical', 'Physical - private sale (sec. 23, tax-free after 1 year)')),
              e('option', { value: 'capital' }, __('gtSecurity', 'Security, e.g. ETC/ETF - capital income (sec. 20)'))));
        })) : null,

      detail && e('div', { style: { marginTop: '1rem', borderTop: '1px solid ' + border, paddingTop: '0.8rem' } },
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: '0.4rem' } }, __('gtComputation', 'Computation (statutory order)')),
        line(__('gtGainsAfterTf', 'Taxable gains after Teilfreistellung'), amt(detail.gainsTaxable)),
        line(__('gtLossesAfterTf', 'Deductible losses after Teilfreistellung'), amt(detail.lossesTaxable), detail.lossesTaxable < 0 ? bad : text),
        detail.shareLossCarried > 0 ? line(__('gtShareLossCarried', 'Share losses not offset (only against share gains)'), amt(detail.shareLossCarried), dim) : null,
        line(__('gtFundDistributions', 'Taxable fund distributions'), amt(detail.dividendsTaxable)),
        line(__('gtVapLine', 'Vorabpauschale {prev} (taxed in {y})', { prev: year - 1, y: year }), amt(detail.vorabpauschaleTaxable)),
        detail.vapCreditTotal > 0 ? line(__('gtCreditedVap', 'Credited prior Vorabpauschalen'), '-' + amt(detail.vapCreditTotal), good) : null,
        line(__('gtTfExempt', 'Teilfreistellung exempt'), amt(detail.teilfreistellungExempt), good),
        line(__('gtSpbUsed', 'Sparerpauschbetrag used'), amt(detail.sparerpauschbetragUsed), good),
        line(__('gtTaxableIncome', 'Taxable capital income'), amt(detail.taxableIncome)),
        line(__('gtAbgSoli', 'Abgeltungsteuer + Soli') + (detail.kirchensteuer > 0 ? ' + ' + __('gtKirchensteuer', 'Kirchensteuer') : ''), amt(detail.abgeltungsteuer + detail.soli + detail.kirchensteuer), warn),
        detail.crypto && detail.crypto.netShortTermGains !== 0 ? line(__('gtPrivateSales', 'Private sales (sec. 23) net short-term (Freigrenze {limit})', { limit: amt(detail.crypto.freigrenze) }), amt(detail.crypto.netShortTermGains) + ' → ' + __('gtTax', 'tax') + ' ' + amt(detail.crypto.estimatedTax)) : null,
        line(__('gtTotalTax', 'Total estimated tax {y}', { y: year }), amt(detail.totalTax), warn)),

      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.8rem', lineHeight: 1.5 } },
        __('gtDisclaimer', 'Helper computation under InvStG/EStG rules with simplified loss netting; private sales (crypto, skins, physical commodities) use a flat-rate estimate. All inputs stay on this device (encrypted at rest). Not tax advice - verify with your tax advisor.')));
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
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var accent = theme.accent || '#8b7cff';

    var sS = React.useState(TS.load); var s = sS[0], setS = sS[1];
    var sOpen = React.useState(false); var open = sOpen[0], setOpen = sOpen[1];
    function update(patch) { setS(TS.save(patch)); if (props.onChange) props.onChange(); }

    var inputStyle = { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.45rem', color: text, fontSize: '0.78rem', width: '90px', textAlign: 'right' };
    // A number field that commits on blur / Enter. A controlled field reset to
    // its default the moment it was cleared, so a new value could not be typed.
    // An empty field commits null (the caller's default).
    function numInput(id, value, dec, label, commit) {
      return e('input', { key: id + '-' + value, type: 'text', inputMode: 'decimal', 'aria-label': label,
        defaultValue: window.MaerminI18n.num(value, dec),
        onBlur: function (ev) { var raw = String(ev.target.value).trim(); var v = raw === '' ? NaN : window.MaerminUtils.parseDecimal(raw); commit(isFinite(v) ? v : null); },
        onKeyDown: function (ev) { if (ev.key === 'Enter') ev.target.blur(); },
        style: inputStyle });
    }
    function row(label, control, hint) {
      return e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.8rem', padding: '0.4rem 0', borderTop: '1px solid ' + border } },
        e('div', null,
          e('div', { style: { color: text, fontSize: '0.82rem' } }, label),
          hint ? e('div', { style: { color: dim, fontSize: '0.7rem' } }, hint) : null),
        control);
    }
    function toggle(on, onClick) {
      return e('button', { onClick: onClick, style: { padding: '0.3rem 0.8rem', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.74rem', fontWeight: 700, background: on ? (theme.success || '#22c55e') : inputBg, color: on ? '#08130a' : dim } }, on ? __('secOn', 'On') : __('dashOff', 'Off'));
    }

    var TF_TYPES = [['aktienfonds', __('gtEquityFund', 'Equity fund'), 0.30], ['mischfonds', __('gtMixedFund', 'Mixed fund'), 0.15], ['immobilienfonds', __('gtRealEstateFund', 'Real-estate fund'), 0.60], ['auslandsimmobilienfonds', __('gtForeignReFund', 'Foreign RE fund'), 0.80]];

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem 1.25rem', marginTop: '1.25rem' } },
      // Re-read on open: the church tax can also change in the fund-tax panel.
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }, onClick: function () { if (!open) setS(TS.load()); setOpen(!open); } },
        e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: 0 } }, t.taxSettingsTitle || 'Tax settings (overrides)'),
        e('span', { style: { color: accent, fontSize: '0.8rem' } }, open ? __('hide', 'Hide') : __('edit', 'Edit'))),
      open ? e('div', { style: { marginTop: '0.6rem' } },
        row(__('gtAbgRate', 'Abgeltungsteuer rate'), e('div', null,
          numInput('abg', s.abgeltungRate * 100, { min: 0, max: 2 }, __('gtAbgRate', 'Abgeltungsteuer rate'), function (v) { update({ abgeltungRate: v != null ? v / 100 : 0.25 }); }),
          e('span', { style: { color: dim, fontSize: '0.76rem', marginLeft: '0.25rem' } }, '%')), __('gtDefaultPct', 'Default {pct}', { pct: window.MaerminI18n.pct(25, 0) })),
        row('Solidaritätszuschlag', toggle(s.soli, function () { update({ soli: !s.soli }); }), __('gtSoliHint', '{pct} of the tax', { pct: window.MaerminI18n.pct(5.5, 1) })),
        row('Kirchensteuer', e('select', { value: String(s.kirchensteuer), onChange: function (ev) { update({ kirchensteuer: parseFloat(ev.target.value) }); }, style: { background: inputBg, border: '1px solid ' + border, borderRadius: '6px', padding: '0.3rem 0.4rem', color: text, fontSize: '0.76rem' } },
          e('option', { value: '0' }, __('none', 'None')), e('option', { value: '0.08' }, window.MaerminI18n.pct(8, 0)), e('option', { value: '0.09' }, window.MaerminI18n.pct(9, 0)))),
        row('Freistellungsauftrag', e('div', null,
          numInput('fsa', s.freistellungsauftrag, 0, 'Freistellungsauftrag', function (v) { update({ freistellungsauftrag: v != null ? v : 1000 }); }),
          e('span', { style: { color: dim, fontSize: '0.76rem', marginLeft: '0.25rem' } }, 'EUR')), __('gtSpbHint', 'Sparerpauschbetrag, default 1000')),
        row(__('gtCryptoExempt', 'Crypto 1-year exemption'), toggle(s.cryptoExemption, function () { update({ cryptoExemption: !s.cryptoExemption }); }), __('gtCryptoExemptHint', 'Private-sale rule (sec. 23 EStG)')),
        e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, margin: '0.8rem 0 0.3rem' } }, __('gtTfOverrides', 'Teilfreistellung overrides')),
        TF_TYPES.map(function (tf) {
          var ovVal = (s.teilfreistellung && s.teilfreistellung[tf[0]] != null) ? s.teilfreistellung[tf[0]] : tf[2];
          return row(tf[1], e('div', null,
            numInput('tf-' + tf[0], ovVal * 100, 0, tf[1], function (v) {
              var map = Object.assign({}, s.teilfreistellung);
              if (v != null && Math.abs(v / 100 - tf[2]) > 1e-9) map[tf[0]] = v / 100; else delete map[tf[0]];
              update({ teilfreistellung: map });
            }),
            e('span', { style: { color: dim, fontSize: '0.76rem', marginLeft: '0.25rem' } }, '%')), __('gtDefaultPct', 'Default {pct}', { pct: window.MaerminI18n.pct(tf[2] * 100, 0) }));
        }),
        e('button', { onClick: function () {
          window.MaerminUtils.confirmThen({
            title: t.taxResetTitle || 'Reset the tax settings to the defaults?',
            message: t.taxResetMessage || 'Your rates, church tax and Teilfreistellung overrides are replaced by the defaults.',
            confirmLabel: t.taxReset || 'Reset', cancelLabel: t.cancel || 'Cancel'
          }, function () { setS(TS.reset()); if (props.onChange) props.onChange(); });
        }, style: { marginTop: '0.7rem', padding: '0.35rem 0.8rem', borderRadius: '6px', border: '1px solid ' + border, background: inputBg, color: dim, cursor: 'pointer', fontSize: '0.74rem' } }, __('gtResetDefaults', 'Reset to defaults')),
        e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.6rem', lineHeight: 1.5 } }, __('gtOverridesNote', 'Overrides are stored on this device and feed the tax computation and the PDF/Excel export. Defaults apply where unset. Not tax advice.'))
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
