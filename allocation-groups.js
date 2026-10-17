// ============================================================================
// MAERMIN — Allocation by ETF provider and by broker  (window.MaerminAllocationGroups)
// ----------------------------------------------------------------------------
// P5-2.8. Pure + dual-exported; tested in test/allocation-groups.test.js.
//
//   providerOf(name, symbol)  the fund's provider from its name (iShares,
//                             Vanguard, Xtrackers, Amundi incl. Lyxor, …), else
//                             from a short list of common tickers, else null
//   byProvider(rows [{ symbol, name, value (EUR), fund }])
//     → { providers: [{ name (null = other providers), value, pctFunds,
//         pctTotal, holdings }], fundsValue, otherValue, total }
//   byPortfolio(rows [{ id, name, value, cash }])
//     → { rows: [{ id, name, value, cash, total, pct }], total }
//     A portfolio is usually one broker; cash = its clearing account.
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }

  // provider → name pattern; first match wins (Lyxor merged into Amundi)
  var PROVIDERS = {
    'iShares': /\bi\s?shares\b/i,
    'Vanguard': /\bvanguard\b/i,
    'Xtrackers': /\b(db\s*)?x-?trackers\b/i,
    'Amundi': /\b(amundi|lyxor)\b/i,
    'SPDR (State Street)': /\bspdr\b|state street/i,
    'Invesco': /\binvesco\b/i,
    'WisdomTree': /\bwisdom\s?tree\b/i,
    'VanEck': /\bvan\s?eck\b/i,
    'HSBC': /\bhsbc\b/i,
    'UBS': /\bubs\b/i,
    'J.P. Morgan': /\bj\.?\s?p\.?\s?morgan\b|\bjpm\b/i,
    'Franklin Templeton': /\bfranklin\b/i,
    'Fidelity': /\bfidelity\b/i,
    'Global X': /\bglobal\s?x\b/i,
    'L&G': /\blegal\s?&\s?general\b|\bl&g\b/i,
    'Deka': /\bdeka\b/i,
    'BNP Paribas': /\bbnp\b/i,
    'Ossiam': /\bossiam\b/i
  };
  // provider → common tickers whose stored name is often empty
  var TICKERS = {
    'Vanguard': ['VWCE', 'VWRL', 'VUSA', 'VUAA', 'VEVE', 'VFEM', 'VGWL', 'VT', 'VOO', 'VTI'],
    'iShares': ['EUNL', 'IWDA', 'SXR8', 'CSPX', 'EIMI', 'IS3N', 'SXRV', 'IUSQ', 'URTH', 'IVV'],
    'Xtrackers': ['XDWD', 'XMME', 'DBXD', 'XDEW'],
    'SPDR (State Street)': ['SPY', 'SPY5', 'SPPW'],
    'Invesco': ['QQQ', 'EQQQ'],
    'Amundi': ['MEUD', 'LCUW', 'AEEM']
  };
  function providerOf(name, symbol) {
    var n = String(name || ''), k;
    for (k in PROVIDERS) if (Object.prototype.hasOwnProperty.call(PROVIDERS, k) && PROVIDERS[k].test(n)) return k;
    var base = String(symbol || '').toUpperCase().split('.')[0];
    for (k in TICKERS) if (Object.prototype.hasOwnProperty.call(TICKERS, k) && TICKERS[k].indexOf(base) !== -1) return k;
    return null;
  }

  function byProvider(rows) {
    var by = {}, order = [], funds = 0, other = 0;
    (rows || []).forEach(function (r) {
      var v = num(r && r.value);
      if (!(v > 0)) return;
      if (!r.fund) { other += v; return; }
      funds += v;
      var p = providerOf(r.name, r.symbol), k = p === null ? '\u0000' : p;
      if (!by[k]) { by[k] = { name: p, value: 0, holdings: [] }; order.push(k); }
      by[k].value += v;
      by[k].holdings.push(r.symbol);
    });
    var total = funds + other;
    var list = order.map(function (k) {
      var g = by[k];
      g.pctFunds = funds > 0 ? g.value / funds * 100 : 0;
      g.pctTotal = total > 0 ? g.value / total * 100 : 0;
      return g;
    }).sort(function (a, b) { return (a.name === null) - (b.name === null) || b.value - a.value; });
    return { providers: list, fundsValue: funds, otherValue: other, total: total };
  }

  function byPortfolio(rows) {
    var list = (rows || []).map(function (r) {
      var t = num(r.value) + num(r.cash);
      return { id: r.id, name: r.name, value: num(r.value), cash: num(r.cash), total: t };
    }).filter(function (r) { return Math.abs(r.total) > 1e-9 || r.value > 0; });
    var total = list.reduce(function (s, r) { return s + r.total; }, 0);
    list.forEach(function (r) { r.pct = total > 0 ? r.total / total * 100 : 0; });
    list.sort(function (a, b) { return b.total - a.total; });
    return { rows: list, total: total };
  }

  var api = { providerOf: providerOf, byProvider: byProvider, byPortfolio: byPortfolio, PROVIDERS: PROVIDERS };
  api.Panel = Panel;
  if (typeof window !== 'undefined') window.MaerminAllocationGroups = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view: Strategy → "Providers & brokers"
  // props: positions [{ symbol, name, value, fund }], portfolios [{ id, name,
  //        value, cash }], theme, formatPrice, getCurrencySymbol
  // --------------------------------------------------------------------------
  function __(k, f, v) { return (W.MaerminI18n ? W.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function Panel(props) {
    var React = W.React, e = React.createElement;
    var theme = props.theme || {};
    var I = W.MaerminI18n;
    var fmt = props.formatPrice || function (x) { return I.num(x, 2); };
    var cur = props.getCurrencySymbol ? props.getCurrencySymbol() : '€';
    var money = function (v) { return fmt(v) + ' ' + cur; };
    var prov = React.useMemo(function () { return byProvider(props.positions); }, [props.positions]);
    var pfs = React.useMemo(function () { return byPortfolio(props.portfolios); }, [props.portfolios]);
    var text = theme.text, dim = theme.textSecondary, border = theme.cardBorder || 'rgba(127,127,127,0.2)';
    var COLORS = ['#8b7cff', '#3b82f6', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#f97316', '#14b8a6'];

    var bars = function (testid, rows) {
      return e('div', { 'data-testid': testid },
        rows.map(function (r, i) {
          return e('div', { key: r.key, 'data-key': r.key, 'data-v': r.value, 'data-pct': r.pct, style: { padding: '0.5rem 0', borderTop: i ? '1px solid ' + border : 'none' } },
            e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: 'var(--text-base)', marginBottom: '0.3rem' } },
              e('span', { style: { color: text, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, r.label,
                r.sub ? e('span', { style: { color: dim, fontWeight: 400, fontSize: 'var(--text-xs)', marginLeft: '0.4rem' } }, r.sub) : null),
              e('span', { style: { color: text, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } }, I.pct(r.pct, 1),
                e('span', { style: { color: dim, marginLeft: '0.5rem', fontSize: 'var(--text-xs)' } }, money(r.value)))),
            e('div', { 'aria-hidden': true, style: { height: '6px', background: theme.inputBg, borderRadius: '3px', overflow: 'hidden' } },
              e('div', { style: { width: Math.max(0, Math.min(100, r.pct)) + '%', height: '100%', background: COLORS[i % COLORS.length], borderRadius: '3px' } })));
        }));
    };
    var card = function (testid, title, sub, body) {
      return e('section', { 'data-testid': testid, style: { background: theme.card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', marginBottom: '1rem', minWidth: 0 } },
        e('h3', { style: { color: text, fontWeight: 700, fontSize: 'var(--text-md)', margin: 0 } }, title),
        e('div', { style: { color: dim, fontSize: 'var(--text-xs)', margin: '0.2rem 0 0.75rem', lineHeight: 1.5 } }, sub), body);
    };
    var muted = function (msg) { return e('div', { style: { color: dim, fontSize: 'var(--text-base)' } }, msg); };

    var provRows = prov.providers.map(function (p) {
      return { key: p.name || 'other', label: p.name || __('agOtherProviders', 'Other providers'), sub: __('agFunds', '{n} {n:fund|funds}', { n: p.holdings.length }), value: p.value, pct: p.pctFunds };
    });
    var pfRows = pfs.rows.map(function (r) {
      return { key: r.id, label: r.name, sub: r.cash ? __('agInclCash', 'incl. {amount} cash', { amount: money(r.cash) }) : '', value: r.total, pct: r.pct };
    });
    return e('div', { 'data-testid': 'allocation-groups', style: { padding: '1.5rem' } },
      card('ag-providers', __('agProvidersTitle', 'Funds by provider'),
        prov.fundsValue > 0
          ? __('agProvidersSub', 'Share of your funds ({funds}, {pct} of the portfolio). A provider is read from the fund\'s name.', { funds: money(prov.fundsValue), pct: I.pct(prov.total > 0 ? prov.fundsValue / prov.total * 100 : 0, 1) })
          : __('agProvidersNone', 'No funds or ETFs in this portfolio.'),
        provRows.length ? bars('ag-provider-bars', provRows) : null),
      card('ag-brokers', __('agBrokersTitle', 'By broker / portfolio'),
        __('agBrokersSub', 'Value of each portfolio, with the cash of its cash account. Usually one portfolio per broker.'),
        pfRows.length ? bars('ag-broker-bars', pfRows) : muted(__('agBrokersNone', 'No portfolio holds anything yet.'))));
  }
})();
