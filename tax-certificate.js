// ============================================================================
// MAERMIN — Jahressteuerbescheinigung reconciliation  (window.MaerminTaxCert)
// ----------------------------------------------------------------------------
// P5-4.7. German banks issue the annual tax certificate on the BMF's official
// template ("Steuerbescheinigung für Privatkunden"), so one parser reads every
// bank by the template's labels instead of per-bank layouts:
//
//   capitalIncome  Höhe der Kapitalerträge
//   shareGains     Gewinn aus Aktienveräußerungen
//   ersatz         Ersatzbemessungsgrundlage
//   lossOther      nicht ausgeglichener Verlust ohne Verlust aus der
//                  Veräußerung von Aktien
//   lossShares     nicht ausgeglichener Verlust aus der Veräußerung von Aktien
//   spb            in Anspruch genommener Sparer-Pauschbetrag
//   kest / soli / kist   Kapitalertragsteuer, Solidaritätszuschlag, Kirchensteuer
//   foreignTax     Summe der angerechneten ausländischen Steuer
//
// The PDF text comes from the existing client-side extraction
// (MaerminPdfImport.extractText); every value can be entered or corrected by
// hand. MAERMIN's side is the ONE report (MaerminTaxReport.build) for the
// bank's portfolios only, without the loss carry-forward (the bank nets each
// year on its own) and with the bank's Freistellungsauftrag as the allowance.
// The labels follow the template as known; they could not be checked against
// a real certificate from the build environment, so small wording variants
// are accepted and the panel lets the user fix any value.
//
// Storage 'maermin_tax_certs' (encrypted via SENSITIVE_KEYS, in the backup):
//   { version: 1, certs: [{ id, year, bank, portfolioIds, allowance, values, source }] }
// The pure part is Node-tested in test/tax-certificate.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var KEY = 'maermin_tax_certs';
  var TOLERANCE = 1; // EUR: rounding and FX of the day
  // The template's labels (German, as printed on every certificate). Order
  // matters only for display; each label is matched on its own.
  var FIELDS = [
    { key: 'capitalIncome', re: /Höhe[\s ]+der[\s ]+Kapitalerträge/i },
    { key: 'shareGains', re: /Gewinn[\s ]+aus[\s ]+Aktienveräußerungen/i },
    { key: 'ersatz', re: /Ersatzbemessungsgrundlage/i },
    { key: 'lossOther', re: /nicht[\s ]+ausgeglichene[rn]?[\s ]+Verluste?[\s ]+ohne[\s ]+Verluste?[\s ]+aus[\s ]+(?:der[\s ]+)?Veräußerung[\s ]+von[\s ]+Aktien/i },
    { key: 'lossShares', re: /nicht[\s ]+ausgeglichene[rn]?[\s ]+Verluste?[\s ]+aus[\s ]+(?:der[\s ]+)?Veräußerung[\s ]+von[\s ]+Aktien/i },
    { key: 'spb', re: /in[\s ]+Anspruch[\s ]+genommene[rn]?[\s ]+Sparer-?[\s ]*Pauschbetrag/i },
    { key: 'kest', re: /(?:^|\n)[ \t ]*Kapitalertragsteuer\b/i },
    { key: 'soli', re: /Solidaritätszuschlag/i },
    { key: 'kist', re: /Kirchensteuer/i },
    { key: 'foreignTax', re: /Summe[\s ]+der[\s ]+angerechneten[\s ]+ausländischen[\s ]+Steuer/i }
  ];
  function labelOf(key) {
    switch (key) {
      case 'capitalIncome': return __('tcLCapital', 'Capital income (Höhe der Kapitalerträge)');
      case 'shareGains': return __('tcLShareGains', 'Gains from selling shares');
      case 'ersatz': return __('tcLErsatz', 'Ersatzbemessungsgrundlage (substitute base)');
      case 'lossOther': return __('tcLLossOther', 'Losses not offset, without share losses');
      case 'lossShares': return __('tcLLossShares', 'Share losses not offset');
      case 'spb': return __('tcLSpb', 'Sparer-Pauschbetrag used');
      case 'kest': return __('tcLKest', 'Kapitalertragsteuer withheld');
      case 'soli': return __('tcLSoli', 'Solidaritätszuschlag withheld');
      case 'kist': return __('tcLKist', 'Kirchensteuer withheld');
      default: return __('tcLForeign', 'Foreign tax credited');
    }
  }
  FIELDS.forEach(function (f) { Object.defineProperty(f, 'label', { get: function () { return labelOf(f.key); }, enumerable: true }); });
  var KEYS = FIELDS.map(function (f) { return f.key; });
  var AMOUNT = /-?\d{1,3}(?:\.\d{3})+,\d{2}|-?\d+,\d{2}/;

  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : 0; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function deNumber(s) { return parseFloat(String(s).replace(/\./g, '').replace(',', '.')); }

  // PURE: { year, values: { key: number }, found: [key] } from the text.
  function parse(text) {
    var t = String(text || '').replace(/\r\n?/g, '\n');
    var ym = /(?:Kalenderjahr|Jahressteuerbescheinigung|Steuerbescheinigung[^\n]{0,80}?)[\s ]*(20\d{2})/i.exec(t);
    var values = {}, found = [];
    FIELDS.forEach(function (f) {
      var m = f.re.exec(t);
      if (!m) return;
      // The amount follows on the label's line or the next one.
      var rest = t.slice(m.index + m[0].length);
      var lines = rest.split('\n');
      var win = lines.slice(0, 2).join('\n');
      var a = AMOUNT.exec(win);
      if (!a) return;
      values[f.key] = Math.abs(deNumber(a[0]));
      found.push(f.key);
    });
    return { year: ym ? parseInt(ym[1], 10) : null, values: values, found: found };
  }

  function reportBuild() {
    if (typeof window !== 'undefined' && window.MaerminTaxReport) return window.MaerminTaxReport.build;
    return require('./tax-report-builder.js').build;
  }

  // MAERMIN's figures for the certificate's bank: the report for its
  // portfolios, the year on its own, the bank's order as the allowance.
  function maerminFigures(transactions, cert, opts, deps) {
    cert = cert || {};
    var build = (deps && deps.build) || reportBuild();
    var ids = (cert.portfolioIds || []).map(String);
    var txs = (transactions || []).filter(function (tx) { return tx && ids.indexOf(String(tx.portfolioId || '')) !== -1; });
    var o = Object.assign({}, opts || {}, { year: cert.year, jurisdiction: 'de', lossCarry: false });
    if (cert.allowance != null && isFinite(parseFloat(cert.allowance))) o.sparerpauschbetrag = Math.max(0, num(cert.allowance));
    var g = build(txs, o).summary.germanDetail;
    if (!g) return null;
    var co = g.carryOut || {};
    return {
      capitalIncome: r2(Math.max(0, num(g.nettedIncome))),
      shareGains: r2(Math.max(0, num(g.shareGains) + num(g.shareLosses))),
      ersatz: null,
      lossOther: r2(Math.max(0, num(co.other))),
      lossShares: r2(Math.max(0, num(co.shares))),
      spb: r2(num(g.sparerpauschbetragUsed)),
      kest: r2(num(g.abgeltungsteuer)),
      soli: r2(num(g.soli)),
      kist: r2(num(g.kirchensteuer)),
      foreignTax: r2(num(g.withholdingCredit))
    };
  }

  // PURE: per line { key, label, cert, maermin, diff, status } where status is
  // 'match' (within 1 EUR), 'differs', 'missing' (not on the certificate) or
  // 'info' (no MAERMIN value).
  function reconcile(values, figures) {
    values = values || {}; figures = figures || {};
    var rows = FIELDS.map(function (f) {
      var c = values[f.key], m = figures[f.key];
      var has = c != null && isFinite(c);
      var row = { key: f.key, label: f.label, cert: has ? c : null, maermin: m != null ? m : null, diff: null, status: 'missing' };
      if (m == null) row.status = has ? 'info' : 'missing';
      else if (has) { row.diff = r2(c - m); row.status = Math.abs(row.diff) <= TOLERANCE ? 'match' : 'differs'; }
      return row;
    });
    return { rows: rows, differences: rows.filter(function (r) { return r.status === 'differs'; }).length };
  }

  // ---- storage ----------------------------------------------------------------
  function uid() { return 'tc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function cleanValues(v) {
    var out = {};
    KEYS.forEach(function (k) { if (v && typeof v[k] === 'number' && isFinite(v[k])) out[k] = r2(Math.abs(v[k])); });
    return out;
  }
  function normalize(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    var list = raw && Array.isArray(raw.certs) ? raw.certs : [];
    return { version: 1, certs: list.filter(function (c) { return c && c.id; }).map(function (c) {
      return { id: String(c.id), year: parseInt(c.year, 10) || null, bank: String(c.bank || '').slice(0, 80),
        portfolioIds: Array.isArray(c.portfolioIds) ? c.portfolioIds.map(String) : [],
        allowance: c.allowance != null && isFinite(parseFloat(c.allowance)) ? Math.max(0, r2(num(c.allowance))) : null,
        values: cleanValues(c.values), source: c.source === 'pdf' ? 'pdf' : 'manual' };
    }) };
  }
  function upsert(state, cert) {
    state = normalize(state);
    var c = normalize({ certs: [Object.assign({}, cert, { id: cert && cert.id ? cert.id : uid() })] }).certs[0];
    var i = state.certs.findIndex(function (x) { return x.id === c.id; });
    if (i >= 0) state.certs[i] = c; else state.certs.push(c);
    return state;
  }
  function remove(state, id) {
    state = normalize(state);
    state.certs = state.certs.filter(function (c) { return c.id !== id; });
    return state;
  }
  function forYear(state, year) { return normalize(state).certs.filter(function (c) { return c.year === year; }); }
  function load() { try { return normalize(localStorage.getItem(KEY)); } catch (e) { return normalize(null); } }
  function save(state) { try { localStorage.setItem(KEY, JSON.stringify(normalize(state))); } catch (e) { /* non-fatal */ } return state; }

  // ---- panel (Tax view, German rules) ----------------------------------------------
  // props: { theme, transactions, portfolios, year, exchangeRate, fxAt, formatMoney, rev, onChange }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React || !window.MaerminTaxReport) return null;
    var e = React.createElement, useState = React.useState, useMemo = React.useMemo;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', warn = th.warning || '#f59e0b';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var year = props.year || new Date().getFullYear();
    var portfolios = props.portfolios || [];
    var s0 = useState(load); var state = s0[0], setState = s0[1];
    var s1 = useState(null); var draft = s1[0], setDraft = s1[1];
    var s2 = useState(''); var msg = s2[0], setMsg = s2[1];
    var certs = forYear(state, year);
    var FSA = window.MaerminFSA;
    var brokers = [];
    try { brokers = FSA && FSA.load ? FSA.load().brokers : []; } catch (err) { brokers = []; }

    function commit(next) { save(next); setState(next); if (props.onChange) props.onChange(); }
    function startNew() {
      var b = brokers[0];
      setMsg('');
      setDraft({ year: year, bank: b ? b.name : '', portfolioIds: b ? b.portfolioIds.slice() : (portfolios[0] ? [portfolios[0].id] : []),
        allowance: b ? b.amount : null, values: {}, source: 'manual' });
    }
    function setD(patch) { setDraft(Object.assign({}, draft, patch)); }
    function parseNum(v) { var U = window.MaerminUtils; var n = U && U.parseDecimal ? U.parseDecimal(v) : parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : undefined; }
    function onFile(ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f || !window.MaerminPdfImport) return;
      setMsg(__('tcReading', 'Reading the PDF on this device…'));
      f.arrayBuffer().then(window.MaerminPdfImport.extractText).then(function (txt) {
        var p = parse(txt);
        if (!p.found.length) { setMsg(__('tcNotFound', 'No certificate lines found in this PDF. Enter the values by hand.')); return; }
        setDraft(Object.assign({}, draft, { values: Object.assign({}, draft.values, p.values), year: p.year || draft.year, source: 'pdf' }));
        setMsg(__('tcFound', '{n} of {total} lines read. Check them against the certificate.', { n: p.found.length, total: FIELDS.length }));
      }).catch(function () { setMsg(__('tcPdfError', 'The PDF could not be read. Enter the values by hand.')); });
    }

    // R4.6: Card, certificates as sub-cards with the shared table look, the form on shared Input / Select / Button
    var UIC = window.MaerminComponents;

    function certView(c) {
      var fig = null;
      try { fig = maerminFigures(props.transactions || [], c, { baseCurrency: 'EUR', exchangeRate: props.exchangeRate, fxAt: props.fxAt }); } catch (err) { fig = null; }
      var rec = reconcile(c.values, fig || {});
      var names = c.portfolioIds.map(function (id) { var p = portfolios.filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; }).join(', ');
      return e('div', { key: c.id, 'data-testid': 'tc-cert', className: 'ui-taxp__box' },
        e('div', { className: 'ui-dlg-sec__head' },
          e('div', { className: 'ui-rows__main' }, e('b', null, (c.bank || __('tcBank', 'Bank')) + ' · ' + c.year), e('span', null, names)),
          e(UIC.Badge, { 'data-testid': 'tc-summary', tone: rec.differences ? 'warning' : 'gain' },
            rec.differences ? '! ' + __('tcDiffs', '{n} line(s) differ', { n: rec.differences }) : '✓ ' + __('tcAllMatch', 'All lines match'))),
        e('div', { className: 'ui-table-wrap' },
          e('table', { className: ['ui-table', 'ui-table--dense', 'ui-table--tall'].join(' ') },
            e('thead', null, e('tr', null, [__('tcLine', 'Line'), __('tcCertificate', 'Certificate'), 'MAERMIN', __('tcDiff', 'Difference')].map(function (h, i) {
              return e('th', { key: i, scope: 'col', className: i === 0 ? 'is-left' : 'is-right' }, h);
            }))),
            e('tbody', null, rec.rows.map(function (r) {
              var cls = r.status === 'differs' ? 'tone-warning' : r.status === 'match' ? 'tone-gain' : 'is-dim';
              return e('tr', { key: r.key, 'data-testid': 'tc-row-' + r.key },
                e('td', { className: ['is-left', 'is-wrap'].join(' ') }, r.label),
                e('td', null, r.cert != null ? money(r.cert) : '–'),
                e('td', null, r.maermin != null ? money(r.maermin) : '–'),
                e('td', { className: [cls, 'is-strong'].join(' ') },
                  r.status === 'match' ? '✓' : r.status === 'differs' ? (r.diff > 0 ? '+' : '') + money(r.diff) : r.status === 'info' ? __('tcInfo', 'bank only') : '–'));
            })))),
        rec.differences ? e('p', { className: 'ui-note' },
          __('tcCauses', 'Typical causes: a trade or dividend missing in MAERMIN or booked in another portfolio, a fund type (Teilfreistellung) not set, the FX rate of the day, a Vorabpauschale, or an Ersatzbemessungsgrundlage the bank used for a transferred position.')) : null,
        e('div', { className: 'ui-actions' },
          e(UIC.Button, { size: 'sm', onClick: function () { setMsg(''); setDraft(Object.assign({}, c)); } }, __('tcEdit', 'Edit')),
          e(UIC.Button, { size: 'sm', variant: 'quiet', onClick: function () { commit(remove(state, c.id)); } }, __('tcDelete', 'Delete'))));
    }

    function form() {
      var d = draft;
      return e('div', { 'data-testid': 'tc-form', className: 'ui-taxp__box' },
        e('div', { className: 'ui-form-grid' },
          brokers.length
            ? e(UIC.Select, { id: 'tc-bank', 'data-testid': 'tc-bank', label: __('tcBank', 'Bank'), value: d.bank, onChange: function (ev) {
                var b = brokers.filter(function (x) { return x.name === ev.target.value; })[0];
                setD(b ? { bank: b.name, portfolioIds: b.portfolioIds.slice(), allowance: b.amount } : { bank: ev.target.value });
              }, options: brokers.map(function (b) { return { value: b.name, label: b.name }; }) })
            : e(UIC.Input, { id: 'tc-bank', 'data-testid': 'tc-bank', label: __('tcBank', 'Bank'), value: d.bank, onChange: function (ev) { setD({ bank: ev.target.value }); } }),
          e(UIC.Input, { id: 'tc-allowance', 'data-testid': 'tc-allowance', inputMode: 'decimal', label: __('tcAllowance', 'Freistellungsauftrag at this bank (EUR)'), value: d.allowance != null ? String(d.allowance) : '', onChange: function (ev) { var n = parseNum(ev.target.value); setD({ allowance: n != null ? n : null }); } }),
          e('div', { className: 'ui-field' }, e('label', { className: 'ui-field__label', htmlFor: 'tc-pdf' }, __('tcPdf', 'Certificate PDF (read on this device)')),
            e('input', { id: 'tc-pdf', 'data-testid': 'tc-pdf', type: 'file', accept: 'application/pdf', onChange: onFile, className: 'ui-file' }))),
        e('div', { className: 'ui-field' },
          e('span', { className: 'ui-field__label' }, __('tcPortfolios', 'Portfolios at this bank')),
          e('div', { className: 'ui-actions' }, portfolios.map(function (p) {
            var on = d.portfolioIds.indexOf(p.id) !== -1;
            return e('label', { key: p.id, className: 'ui-check' },
              e('input', { type: 'checkbox', 'data-testid': 'tc-pf-' + p.id, checked: on, onChange: function () {
                setD({ portfolioIds: on ? d.portfolioIds.filter(function (x) { return x !== p.id; }) : d.portfolioIds.concat([p.id]) });
              } }), p.name);
          }))),
        msg ? e('p', { 'data-testid': 'tc-msg', role: 'status', className: 'ui-note' }, msg) : null,
        e('div', { className: ['ui-form-grid', 'ui-tc-fields'].join(' ') },
          FIELDS.map(function (f) {
            var v = d.values[f.key];
            return e(UIC.Input, { key: f.key, id: 'tc-v-' + f.key, 'data-testid': 'tc-v-' + f.key, inputMode: 'decimal', label: f.label, value: v != null ? String(v).replace('.', I18N_SEP()) : '',
              onChange: function (ev) { var vals = Object.assign({}, d.values); var n = parseNum(ev.target.value); if (n == null || ev.target.value === '') delete vals[f.key]; else vals[f.key] = n; setD({ values: vals }); } });
          })),
        e('div', { className: 'ui-actions' },
          e(UIC.Button, { variant: 'primary', 'data-testid': 'tc-save', disabled: !d.portfolioIds.length,
            onClick: function () { commit(upsert(state, d)); setDraft(null); setMsg(''); } }, __('tcSave', 'Save and compare')),
          e(UIC.Button, { onClick: function () { setDraft(null); setMsg(''); } }, __('cancel', 'Cancel'))));
    }
    function I18N_SEP() { var I = window.MaerminI18n; return I && I.num ? (I.num(1.5, 1).indexOf(',') >= 0 ? ',' : '.') : '.'; }

    return e(UIC.Card, { 'data-testid': 'tax-cert-panel', className: 'ui-taxp', headingLevel: 'h3', title: __('tcTitle', 'Check the Jahressteuerbescheinigung'),
      subtitle: __('tcIntro', 'Compare your bank\'s annual tax certificate for {y} with MAERMIN, line by line. The PDF is read on this device and never uploaded. MAERMIN uses only the bank\'s portfolios, the year on its own (the bank nets each year separately) and the bank\'s Freistellungsauftrag.', { y: year }) },
      certs.map(certView),
      draft ? form() : e('div', { className: 'ui-actions' }, e(UIC.Button, { 'data-testid': 'tc-add', onClick: startNew }, __('tcAdd', 'Add a certificate'))),
      e('p', { className: 'ui-note' },
        __('tcNote', 'The lines follow the official template of the Steuerbescheinigung; wording can differ slightly between banks, so check every value read from the PDF. A match is within 1 EUR. Not tax advice.')));
  }

  var api = { KEY: KEY, FIELDS: FIELDS, TOLERANCE: TOLERANCE, parse: parse, maerminFigures: maerminFigures, reconcile: reconcile,
    normalize: normalize, upsert: upsert, remove: remove, forYear: forYear, load: load, save: save, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminTaxCert = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
