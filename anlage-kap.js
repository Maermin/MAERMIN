// ============================================================================
// MAERMIN — Anlage KAP / KAP-INV helper  (window.MaerminAnlageKap)
// ----------------------------------------------------------------------------
// P2-6. Maps the year's capital income of portfolios held at a broker WITHOUT
// German tax withholding (a foreign broker) onto the form lines. Holdings at
// German banks are not mapped: their figures come from the bank's
// Steuerbescheinigung.
//
//   Anlage KAP (direct securities, no funds)
//     19  foreign capital income: dividends + interest + gains, minus losses
//         other than share losses (those are not included)
//     20  of which gains from selling shares
//     22  losses included in 19, without share losses
//     23  share losses, not included in 19
//     41  creditable foreign withholding tax (max 15 % of each gross payout)
//   Anlage KAP-INV (investment funds, amounts BEFORE Teilfreistellung)
//      4-8   distributions        } Aktienfonds, Mischfonds, Immobilienfonds,
//      9-13  Vorabpauschalen      } Auslands-Immobilienfonds, sonstige Fonds
//     14/17/20/23/26  gain or loss from selling fund units (after deducting
//                     the Vorabpauschalen already taxed)
//
// The line numbers follow the 2024/2025 forms as far as they could be checked
// from the build environment (the official instructions were not reachable);
// the panel says so. Crypto, skins and physical commodities are private sales
// (Anlage SO) and stay out. Pure map() is Node-tested in test/anlage-kap.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var FUND_ORDER = ['aktienfonds', 'mischfonds', 'immobilienfonds', 'auslandsimmobilienfonds', 'sonstige'];
  var INV_DIST = { aktienfonds: 4, mischfonds: 5, immobilienfonds: 6, auslandsimmobilienfonds: 7, sonstige: 8 };
  var INV_VAP = { aktienfonds: 9, mischfonds: 10, immobilienfonds: 11, auslandsimmobilienfonds: 12, sonstige: 13 };
  var INV_GAIN = { aktienfonds: 14, mischfonds: 17, immobilienfonds: 20, auslandsimmobilienfonds: 23, sonstige: 26 };
  var KEY = 'maermin_kap_foreign';

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function fundLabel(t) {
    return ({ aktienfonds: __('kapFundEquity', 'equity funds'), mischfonds: __('kapFundMixed', 'mixed funds'), immobilienfonds: __('kapFundRealEstate', 'real-estate funds'),
      auslandsimmobilienfonds: __('kapFundForeignRealEstate', 'foreign real-estate funds'), sonstige: __('kapFundOther', 'other investment funds') })[t];
  }

  // inputs = report.summary.germanDetail.kapInputs
  // -> [{ form, line, label, amount }] with non-zero amounts, in form order.
  function map(inputs) {
    inputs = inputs || {};
    var fundTypes = inputs.fundTypes || {};
    var funds = inputs.fundSymbols || {};
    var typeOf = function (sym) {
      var t = fundTypes[sym] || fundTypes[String(sym || '').toUpperCase()];
      return (t && t !== 'none' && INV_DIST[t]) ? t : 'sonstige';
    };
    var isFund = function (sym) { return !!(funds[sym] || funds[String(sym || '').toUpperCase()]); };

    var z19 = 0, z20 = 0, z22 = 0, z23 = 0, z41 = 0;
    var dist = {}, vap = {}, gain = {};
    (inputs.disposals || []).forEach(function (d) {
      var g = num(d.gain) - Math.max(0, num(d.vapCredit));
      if (isFund(d.symbol)) { var t = typeOf(d.symbol); gain[t] = (gain[t] || 0) + g; return; }
      if (g >= 0) { z19 += g; if (d.pot === 'shares') z20 += g; }
      else if (d.pot === 'shares') z23 += -g;
      else { z19 += g; z22 += -g; }
    });
    (inputs.dividends || []).forEach(function (d) {
      var gross = Math.max(0, num(d.gross));
      if (isFund(d.symbol)) { var t = typeOf(d.symbol); dist[t] = (dist[t] || 0) + gross; return; }
      z19 += gross;
      z41 += Math.min(Math.max(0, num(d.withholding)), 0.15 * gross);
    });
    z19 += Math.max(0, num(inputs.interestIncome));
    (inputs.vorabpauschalen || []).forEach(function (v) {
      var t = typeOf(v.symbol); vap[t] = (vap[t] || 0) + Math.max(0, num(v.amount));
    });

    var rows = [];
    var push = function (form, line, label, amount) { amount = r2(amount); if (amount !== 0) rows.push({ form: form, line: line, label: label, amount: amount }); };
    push('KAP', 19, __('kapL19', 'Foreign capital income (without funds), share losses not included'), z19);
    push('KAP', 20, __('kapL20', 'of which gains from selling shares'), z20);
    push('KAP', 22, __('kapL22', 'losses included in line 19, without share losses'), z22);
    push('KAP', 23, __('kapL23', 'losses from selling shares, not included in line 19'), z23);
    push('KAP', 41, __('kapL41', 'creditable foreign withholding tax'), z41);
    FUND_ORDER.forEach(function (t) { push('KAP-INV', INV_DIST[t], __('kapInvDist', 'Distributions of {type}', { type: fundLabel(t) }), dist[t] || 0); });
    FUND_ORDER.forEach(function (t) { push('KAP-INV', INV_VAP[t], __('kapInvVap', 'Vorabpauschale of {type}', { type: fundLabel(t) }), vap[t] || 0); });
    FUND_ORDER.forEach(function (t) { push('KAP-INV', INV_GAIN[t], __('kapInvGain', 'Gain or loss from selling {type}', { type: fundLabel(t) }), gain[t] || 0); });
    return rows;
  }

  function toCSV(rows, year) {
    var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    return ['form;line;label;amount_eur;year'].concat((rows || []).map(function (r) { return [r.form, r.line, q(r.label), r.amount.toFixed(2), year].join(';'); })).join('\n');
  }

  // ---- storage: which portfolios sit at a broker without German withholding --
  function ls() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function loadForeign() { try { var v = JSON.parse((ls() && ls().getItem(KEY)) || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch (e) { return []; } }
  function saveForeign(ids) { try { if (ls()) ls().setItem(KEY, JSON.stringify(ids)); } catch (e) { /* quota */ } }

  // ---- panel (Tax view, German rules) ----------------------------------------
  // props: { theme, transactions, portfolios, year, exchangeRate, fxAt, formatMoney }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState, useMemo = React.useMemo;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)', warn = th.warning || '#f59e0b';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var s0 = useState(loadForeign); var ids = s0[0], setIds = s0[1];
    var txs = props.transactions || [];
    function toggle(pid) { var next = ids.indexOf(pid) > -1 ? ids.filter(function (x) { return x !== pid; }) : ids.concat([pid]); saveForeign(next); setIds(next); }

    var rows = useMemo(function () {
      if (!ids.length || !window.MaerminTaxReport) return [];
      var subset = txs.filter(function (tx) { return ids.indexOf(String(tx.portfolioId || 'default')) > -1; });
      try {
        var rep = window.MaerminTaxReport.build(subset, { year: props.year, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: props.exchangeRate, fxAt: props.fxAt });
        var g = rep && rep.summary && rep.summary.germanDetail;
        return g && g.kapInputs ? map(g.kapInputs) : [];
      } catch (err) { return []; }
    }, [txs, ids.join('|'), props.year, props.exchangeRate, props.fxAt]);

    function download() {
      var blob = new Blob([toCSV(rows, props.year)], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'anlage-kap-' + props.year + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    return e('div', { 'data-testid': 'kap-panel', style: { background: th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1.5rem 0 0' } },
      e('h3', { style: { color: text, fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.35rem' } }, __('kapTitle', 'Anlage KAP / KAP-INV {y} (brokers without German tax withholding)', { y: props.year })),
      e('p', { style: { color: dim, fontSize: '0.8rem', margin: '0 0 0.6rem', lineHeight: 1.5 } },
        __('kapIntro', 'Tick the portfolios you hold at a broker that does not withhold German tax (a foreign broker). For German banks, take the figures from their annual tax certificate (Steuerbescheinigung) instead.')),
      e('div', { role: 'note', 'data-testid': 'kap-check', style: { color: warn, fontSize: '0.78rem', margin: '0 0 0.8rem', lineHeight: 1.5 } },
        __('kapCheckLines', 'Line numbers follow the 2024/2025 forms. Check them against the form of your year before you file; fund losses are shown as negative amounts in the gain line.')),
      e('div', { style: { color: dim, fontSize: '0.8rem', marginBottom: '0.8rem' } },
        (props.portfolios || []).map(function (p) {
          return e('label', { key: p.id, style: { marginRight: '0.9rem', whiteSpace: 'nowrap', cursor: 'pointer' } },
            e('input', { type: 'checkbox', checked: ids.indexOf(String(p.id)) > -1, onChange: function () { toggle(String(p.id)); }, style: { marginRight: '0.3rem' } }), p.name);
        })),
      !ids.length ? null : rows.length === 0
        ? e('div', { style: { color: dim, fontSize: '0.82rem' } }, __('kapNone', 'No capital income in {y} for these portfolios.', { y: props.year }))
        : e('div', null,
            e('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', color: text } },
              e('thead', null, e('tr', { style: { color: dim, textAlign: 'left' } },
                [__('kapForm', 'Form'), __('kapLine', 'Line'), __('kapWhat', 'What'), __('kapAmount', 'Amount')].map(function (h, i) {
                  return e('th', { key: i, style: { padding: '0.4rem 0.5rem', fontWeight: 600, borderBottom: '1px solid ' + border, textAlign: i === 3 ? 'right' : 'left' } }, h);
                }))),
              e('tbody', null, rows.map(function (r) {
                return e('tr', { key: r.form + r.line, 'data-kap-line': r.form + ':' + r.line, style: { borderBottom: '1px solid ' + border } },
                  e('td', { style: { padding: '0.4rem 0.5rem', whiteSpace: 'nowrap' } }, 'Anlage ' + r.form),
                  e('td', { style: { padding: '0.4rem 0.5rem' } }, r.line),
                  e('td', { style: { padding: '0.4rem 0.5rem', color: dim } }, r.label),
                  e('td', { style: { padding: '0.4rem 0.5rem', textAlign: 'right', whiteSpace: 'nowrap' } }, money(r.amount)));
              }))),
            e('button', { type: 'button', onClick: download, style: { marginTop: '0.8rem', padding: '0.45rem 0.9rem', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
              background: 'transparent', color: th.accent || '#8b7cff', border: '1px solid ' + border } }, __('kapCsv', 'Download as CSV'))));
  }

  var api = { KEY: KEY, map: map, toCSV: toCSV, loadForeign: loadForeign, saveForeign: saveForeign, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminAnlageKap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
