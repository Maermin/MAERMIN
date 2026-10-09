// ============================================================================
// MAERMIN — Foreign withholding tax by country  (window.MaerminWithholding)
// ----------------------------------------------------------------------------
// P4-3. German tax view, per tax year and country of the paying company:
// gross dividends, tax withheld abroad, the part creditable under § 32d (5)
// EStG and the excess that can only be reclaimed in the source country.
// German rules only (the US view is unchanged). An ESTIMATE, labelled as such.
//
// Creditable per payout = min(withheld, 15 % × gross) - the same rule the tax
// engine applies (tax-calculation-engine.js, anlage-kap.js line 41), so this
// table and the tax figures agree. The overall limit to the German tax that
// falls on the dividends (and the church-tax formula) is applied by the tax
// engine, not per country; the table says so.
//
// RATES - SOURCE AND DATE. The brief asked for the BZSt overview
// "Anrechenbarkeit der Quellensteuer auf Dividenden und Zinsen" (Stand
// 1 January 2026, bzst.de/SharedDocs/Downloads/DE/EU_OECD/
// anrechenbare_ausl_quellensteuer_2026.pdf). bzst.de could not be reached from
// the build environment, so the rates below were compiled on 2026-10-09 from
// secondary summaries of that overview (web search results of finanztip.de,
// dividenden.guru, deutschland-rechner.de, bubbletax.de, comdirect magazin) and
// kept only where they agreed. They are NOT verified against the BZSt PDF:
// check them there before relying on them. Only the statutory rate (what the
// source country takes without a treaty form) is used, for the "nothing
// recorded" hint; the creditable cap is 15 % for every treaty country listed.
// Countries not listed are "rate not on file" (still credited at most 15 %).
//
//   countryOf(symbol, meta)  → ISO code | null      (from MaerminEquityMeta)
//   byCountry(dividends, { countryOf })
//     dividends: [{ symbol, date, gross, withholding }]  (EUR, the tax report's list)
//     → { rows: [{ code, gross, withheld, creditable, excess, count, missing,
//                  rate: RATES[code] | null }],   unknown country: code 'unknown'
//         total: { gross, withheld, creditable, excess }, domestic: { count, gross } }
//
// Pure + dual-exported; tested in test/withholding-tax.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var CAP = 0.15;            // § 32d (5) EStG with a DBA: at most 15 % of the gross payout
  var SOURCE_DATE = '2026-10-09';

  // Statutory dividend withholding (percent) for non-resident individuals.
  // contested: secondary sources disagree - check the BZSt table first.
  var RATES = {
    US: { statutory: 30, note: 'usW8' },          // 15 % with a W-8BEN
    CH: { statutory: 35 },
    FR: { statutory: 25, note: 'frForm' },     // 12.8 % with the residence form
    IE: { statutory: 25 },
    DK: { statutory: 27 },
    NL: { statutory: 15 },
    IT: { statutory: 26 },
    ES: { statutory: 19 },
    AT: { statutory: 27.5 },
    SE: { statutory: 30 },
    CA: { statutory: 25 },
    FI: { statutory: 35 },
    PT: { statutory: 28 },
    KR: { statutory: 22 },
    JP: { statutory: 20.42, contested: true },
    BE: { statutory: 30, contested: true },
    NO: { statutory: 25, contested: true },
    AU: { statutory: 30, note: 'auFranked' },   // franked dividends 0 %
    GB: { statutory: 0 },
    HK: { statutory: 0 },
    SG: { statutory: 0 }
  };
  // Country names as MaerminEquityMeta / profiles spell them → ISO code.
  var CODES = {
    'USA': 'US', 'United States': 'US', 'US': 'US', 'UK': 'GB', 'United Kingdom': 'GB', 'Germany': 'DE', 'France': 'FR',
    'Netherlands': 'NL', 'Switzerland': 'CH', 'Japan': 'JP', 'China': 'CN', 'Taiwan': 'TW', 'Denmark': 'DK', 'Israel': 'IL',
    'Ireland': 'IE', 'Canada': 'CA', 'Australia': 'AU', 'South Korea': 'KR', 'Korea': 'KR', 'India': 'IN', 'Sweden': 'SE',
    'Spain': 'ES', 'Italy': 'IT', 'Belgium': 'BE', 'Finland': 'FI', 'Norway': 'NO', 'Austria': 'AT', 'Hong Kong': 'HK',
    'Singapore': 'SG', 'Brazil': 'BR', 'Mexico': 'MX', 'Luxembourg': 'LU', 'Portugal': 'PT', 'Poland': 'PL'
  };

  function num(x) { var n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : 0; }
  function round2(x) { return Math.round(x * 100) / 100; }

  // Country of the paying company from the equity metadata (static map or the
  // cached profile). No guess from the listing suffix: a fund listed in
  // Frankfurt is usually domiciled in Ireland or Luxembourg.
  function countryOf(symbol, meta) {
    var M = meta || (typeof window !== 'undefined' ? window.MaerminEquityMeta : null);
    if (!M || !symbol) return null;
    var m = null;
    try { m = M.getMeta(symbol); } catch (e) { m = null; }
    if (!m || !m.country || m.source === 'unknown' || m.country === 'Other' || /^Global/.test(m.country)) return null;
    return CODES[m.country] || null;
  }

  function byCountry(dividends, opts) {
    opts = opts || {};
    var lookup = typeof opts.countryOf === 'function' ? opts.countryOf : function (s) { return countryOf(s); };
    var map = {}, domestic = { count: 0, gross: 0 };
    (dividends || []).forEach(function (d) {
      if (!d) return;
      var gross = num(d.gross);
      if (!(gross > 0)) return;
      var withheld = Math.max(0, num(d.withholding));
      var code = lookup(d.symbol) || 'unknown';
      if (code === 'DE') { domestic.count++; domestic.gross += gross; return; } // German tax, not foreign
      var r = map[code] || (map[code] = { code: code, gross: 0, withheld: 0, creditable: 0, excess: 0, count: 0, missing: 0, rate: RATES[code] || null });
      var cred = Math.min(withheld, CAP * gross);
      r.gross += gross; r.withheld += withheld; r.creditable += cred; r.excess += withheld - cred; r.count++;
      if (withheld === 0 && r.rate && r.rate.statutory > 0) r.missing++;
    });
    var rows = Object.keys(map).map(function (k) {
      var r = map[k];
      r.gross = round2(r.gross); r.withheld = round2(r.withheld); r.creditable = round2(r.creditable); r.excess = round2(r.excess);
      return r;
    }).sort(function (a, b) {
      if (a.code === 'unknown') return 1;
      if (b.code === 'unknown') return -1;
      return b.gross - a.gross;
    });
    var total = rows.reduce(function (s, r) { return { gross: s.gross + r.gross, withheld: s.withheld + r.withheld, creditable: s.creditable + r.creditable, excess: s.excess + r.excess }; },
      { gross: 0, withheld: 0, creditable: 0, excess: 0 });
    Object.keys(total).forEach(function (k) { total[k] = round2(total[k]); });
    domestic.gross = round2(domestic.gross);
    return { rows: rows, total: total, domestic: domestic };
  }

  // ---- German tax view panel ---------------------------------------------------
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, th = props.theme || {};
    var data = byCountry(props.dividends || []);
    var I = window.MaerminI18n;
    var money = props.formatMoney || function (v) { return I.money(v, 'EUR'); };
    var dim = th.textSecondary, border = th.cardBorder;
    var cell = { padding: '0.55rem 0.75rem', textAlign: 'right', fontSize: '0.82rem', color: th.text, whiteSpace: 'nowrap', borderTop: '1px solid ' + border };
    var head = { padding: '0.5rem 0.75rem', textAlign: 'right', fontSize: '0.7rem', fontWeight: 600, color: dim, textTransform: 'uppercase', letterSpacing: '0.04em' };
    function label(r) {
      if (r.code === 'unknown') return __('whtUnknown', 'Country unknown');
      var name = null;
      Object.keys(CODES).some(function (n) { if (CODES[n] === r.code) { name = n; return true; } return false; });
      return I.country(name || r.code);
    }
    function note(r) {
      var out = [];
      if (r.code === 'unknown') out.push(__('whtUnknownNote', 'no country on file for these holdings - credited at most 15 %'));
      else if (!r.rate) out.push(__('whtNoRate', 'rate not on file - credited at most 15 %'));
      else {
        out.push(__('whtStatutory', 'withholds {pct} without a treaty form', { pct: I.pct(r.rate.statutory, { min: 0, max: 2 }) }));
        if (r.rate.note === 'usW8') out.push(__('whtUsW8', '15 % with a W-8BEN'));
        if (r.rate.note === 'frForm') out.push(__('whtFrForm', '12.8 % with the residence form'));
        if (r.rate.note === 'auFranked') out.push(__('whtAuFranked', 'franked dividends 0 %'));
        if (r.rate.contested) out.push(__('whtContested', 'sources disagree - check the BZSt table'));
      }
      if (r.missing) out.push(__('whtMissing', '{n} {n:payout|payouts} without recorded withholding', { n: r.missing }));
      return out.join(' · ');
    }
    return e('div', { 'data-testid': 'wht-panel', style: { background: th.card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginTop: '1.5rem' } },
      e('h3', { style: { color: th.text, fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.35rem' } }, __('whtTitle', 'Foreign withholding tax by country {y} (estimate)', { y: props.year })),
      e('p', { style: { color: dim, fontSize: '0.8rem', margin: '0 0 0.75rem', lineHeight: 1.55 } },
        __('whtIntro', 'Creditable = at most 15 % of each gross payout (§ 32d (5) EStG); the tax calculation then limits the credit to the German tax on your dividends. The excess can only be reclaimed from the source country. Rates come from secondary summaries of the BZSt table (as of 1 January 2026), compiled on {date} and not checked against the original - check them before you file.', { date: I.date(SOURCE_DATE) })),
      !data.rows.length
        ? e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } }, __('whtNone', 'No foreign dividends in this year.'))
        : e('div', { role: 'region', tabIndex: 0, 'aria-label': __('whtTitleShort', 'Foreign withholding tax by country'), style: { overflowX: 'auto' } },
            e('table', { style: { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' } },
              e('thead', null, e('tr', null,
                e('th', { scope: 'col', style: Object.assign({}, head, { textAlign: 'left' }) }, __('whtCountry', 'Country')),
                e('th', { scope: 'col', style: head }, __('whtGross', 'Gross dividends')),
                e('th', { scope: 'col', style: head }, __('whtWithheld', 'Withheld')),
                e('th', { scope: 'col', style: head }, __('whtCreditable', 'Creditable')),
                e('th', { scope: 'col', style: head }, __('whtExcess', 'Reclaim abroad')))),
              e('tbody', null,
                data.rows.map(function (r) {
                  return e('tr', { key: r.code, 'data-wht-country': r.code },
                    e('th', { scope: 'row', style: Object.assign({}, cell, { textAlign: 'left', fontWeight: 600, whiteSpace: 'normal', minWidth: '11rem' }) }, label(r),
                      e('div', { style: { color: dim, fontSize: '0.72rem', fontWeight: 400, marginTop: '0.15rem' } }, note(r))),
                    e('td', { style: cell }, money(r.gross)),
                    e('td', { style: cell }, money(r.withheld)),
                    e('td', { style: cell }, money(r.creditable)),
                    e('td', { style: Object.assign({}, cell, { color: r.excess > 0 ? th.warning : th.text }) }, money(r.excess)));
                }),
                e('tr', { 'data-wht-country': 'total' },
                  e('th', { scope: 'row', style: Object.assign({}, cell, { textAlign: 'left', fontWeight: 700 }) }, __('whtTotal', 'Total')),
                  e('td', { style: Object.assign({}, cell, { fontWeight: 700 }) }, money(data.total.gross)),
                  e('td', { style: Object.assign({}, cell, { fontWeight: 700 }) }, money(data.total.withheld)),
                  e('td', { style: Object.assign({}, cell, { fontWeight: 700 }) }, money(data.total.creditable)),
                  e('td', { style: Object.assign({}, cell, { fontWeight: 700 }) }, money(data.total.excess)))))),
      data.domestic.count ? e('p', { style: { color: dim, fontSize: '0.76rem', margin: '0.6rem 0 0' } },
        __('whtDomestic', '{n} {n:payout|payouts} from German companies ({amt}) are not listed: their tax is German Kapitalertragsteuer, not foreign tax.', { n: data.domestic.count, amt: money(data.domestic.gross) })) : null,
      e('p', { style: { color: dim, fontSize: '0.76rem', margin: '0.6rem 0 0' } },
        __('whtHowTo', 'Withholding is entered per dividend in the transaction dialog ("Withholding tax"). Dividends booked automatically for US shares assume 15 %.')));
  }

  var api = { CAP: CAP, SOURCE_DATE: SOURCE_DATE, RATES: RATES, CODES: CODES, countryOf: countryOf, byCountry: byCountry, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminWithholding = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
