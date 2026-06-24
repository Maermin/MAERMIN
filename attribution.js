// ============================================================================
// MAERMIN — Performance Attribution  (window.MaerminAttribution)
// ----------------------------------------------------------------------------
// Answers "which holdings actually drove my return?" — each position's
// contribution to the TOTAL portfolio return, not just its own % gain. A small
// position up 200% can matter less than a large one up 10%; this surfaces that.
//
// Pure `compute(positions)` is the single source of truth (Node-tested); the
// React `Panel` is a thin createElement table folded into an existing view. No
// new persistence, no new data source — fed the already-priced positions.
// ============================================================================
(function () {
  'use strict';

  // positions: [{ symbol, name?, value, invested }] in EUR.
  //   value     — current market value
  //   invested  — cost basis
  // Returns rows with absolute gain, own return %, portfolio weight %, and the
  // CONTRIBUTION in percentage points of the total return (gain / totalInvested).
  function compute(positions) {
    var rows = (Array.isArray(positions) ? positions : [])
      .map(function (p) {
        return {
          symbol: p.symbol || '',
          name: p.name || p.symbol || '',
          value: Number(p.value) || 0,
          invested: Number(p.invested) || 0
        };
      })
      .filter(function (p) { return p.value > 0 || p.invested > 0; });

    var totalValue = rows.reduce(function (s, p) { return s + p.value; }, 0);
    var totalInvested = rows.reduce(function (s, p) { return s + p.invested; }, 0);
    var totalGain = totalValue - totalInvested;

    var out = rows.map(function (p) {
      var gain = p.value - p.invested;
      return {
        symbol: p.symbol,
        name: p.name,
        value: p.value,
        invested: p.invested,
        gain: gain,
        returnPct: p.invested > 0 ? (gain / p.invested) * 100 : 0,
        weightPct: totalValue > 0 ? (p.value / totalValue) * 100 : 0,
        // contribution to the total return, in percentage points
        contributionPP: totalInvested > 0 ? (gain / totalInvested) * 100 : 0
      };
    }).sort(function (a, b) { return b.contributionPP - a.contributionPP; });

    return {
      rows: out,
      totalValue: totalValue,
      totalInvested: totalInvested,
      totalGain: totalGain,
      totalReturnPct: totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0,
      // sanity: the contributions sum to the total return
      contributors: out.filter(function (r) { return r.gain > 0; }),
      detractors: out.filter(function (r) { return r.gain < 0; })
    };
  }

  // Thin presentational React panel. Renders nothing when there's no data.
  function Panel(props) {
    if (typeof React === 'undefined') return null;
    var h = React.createElement;
    var th = (props && props.theme) || {};
    var fmt = (props && props.formatPrice) || function (n) { return String(Math.round(n)); };
    var result = compute((props && props.positions) || []);
    if (!result.rows.length) return null;
    var pct = function (n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; };
    var pp = function (n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + ' pp'; };
    var col = function (n) { return n >= 0 ? (th.success || '#34d399') : (th.danger || '#f87171'); };
    var top = result.rows.slice(0, 8);

    return h('div', { style: { background: th.card || '#10151f', border: '1px solid ' + (th.cardBorder || 'rgba(255,255,255,0.07)'), borderRadius: '14px', padding: '1.25rem', marginTop: '1rem' } },
      h('div', { style: { fontWeight: 800, color: th.text || '#e9edf4', marginBottom: '0.25rem' } }, 'Return Attribution'),
      h('div', { style: { fontSize: '0.78rem', color: th.textSecondary || '#8b94a7', marginBottom: '0.9rem' } },
        'Contribution of each holding to the total return (' + pct(result.totalReturnPct) + ').'),
      h('div', { role: 'list' }, top.map(function (r) {
        return h('div', { key: r.symbol, role: 'listitem', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid ' + (th.cardBorder || 'rgba(255,255,255,0.05)') } },
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { fontWeight: 700, color: th.text || '#e9edf4' } }, r.symbol),
            h('div', { style: { fontSize: '0.72rem', color: th.textSecondary || '#8b94a7' } }, r.weightPct.toFixed(1) + '% of value · ' + pct(r.returnPct))
          ),
          h('div', { style: { textAlign: 'right' } },
            h('div', { style: { fontWeight: 700, color: col(r.contributionPP) } }, pp(r.contributionPP)),
            h('div', { style: { fontSize: '0.72rem', color: col(r.gain) } }, fmt(r.gain))
          )
        );
      }))
    );
  }

  var api = { compute: compute, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminAttribution = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
