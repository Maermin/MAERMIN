// ============================================================================
// MAERMIN v7.0 - Investment Analysis Views (FIXED)
// UI Components for Investment Engines
// ============================================================================

(function() {
'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

var useState = React.useState;
var useEffect = React.useEffect;
var useMemo = React.useMemo;

// P5-1.2: two columns on wide screens, one on phones (a fixed '1fr 1fr' grid
// overflowed at 375 px: Sectors, Countries, Currencies, Liquidity).
var TWO_COL = 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))';

// Theme tokens for every view in this file (FINDINGS H-8: the views were
// hard-coded light-on-dark, white on white in the light theme). The
// dashboard provides the app theme; the defaults are the former dark
// literals, so a view rendered on its own looks as before.
var DEFAULT_THEME = {
  text: '#ffffff', textSecondary: 'rgba(255,255,255,0.6)', card: 'rgba(255,255,255,0.035)',
  cardBorder: 'rgba(255,255,255,0.08)', inputBg: 'rgba(0,0,0,0.3)', inputBorder: 'rgba(255,255,255,0.2)',
  accent: '#8b7cff', accentSoft: 'rgba(139,124,255,0.3)', shadow: '0 18px 40px -18px rgba(0,0,0,0.6)'
};
var ThemeCtx = React.createContext(DEFAULT_THEME);
function useT() { return Object.assign({}, DEFAULT_THEME, React.useContext(ThemeCtx) || {}); }
// Amounts (EUR inside) go through the app's formatter, which converts to the
// display currency and masks them in Privacy Mode (FINDINGS M-12). On its own
// a view prints plain EUR.
var MoneyCtx = React.createContext(null);
function plainEUR(v) { return (Number(v) || 0).toFixed(0) + ' EUR'; }
function useMoney() { return React.useContext(MoneyCtx) || plainEUR; }

// Goal progress (FINDINGS M-13). A goal without a positive target has no
// progress and no on-track verdict; a goal whose date has passed is on track
// only when it is reached.
function goalProgress(goal, now) {
  var target = Number(goal && goal.targetAmount) || 0;
  var current = Number(goal && goal.currentAmount) || 0;
  var monthly = Number(goal && goal.monthlyContribution) || 0;
  if (!(target > 0)) return { progressPercent: 0, onTrack: null, monthsRemaining: 0, requiredMonthly: 0, invalid: true };
  var targetDate = new Date(goal.targetDate);
  var monthsRemaining = isFinite(targetDate) ? Math.max(0, (targetDate - (now || new Date())) / (1000 * 60 * 60 * 24 * 30)) : 0;
  var left = Math.max(0, target - current);
  var requiredMonthly = monthsRemaining > 0 ? left / monthsRemaining : 0;
  return {
    progressPercent: Math.max(0, Math.min(100, (current / target) * 100)),
    onTrack: left === 0 ? true : monthsRemaining > 0 ? monthly >= requiredMonthly : false,
    monthsRemaining: Math.round(monthsRemaining),
    requiredMonthly: requiredMonthly
  };
}

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function AnalysisCard(props) {
  var T = useT();
  var title = props.title;
  var badge = props.badge;
  var badgeType = props.badgeType || 'neutral';
  var children = props.children;
  
  return React.createElement('div', {
    style: {
      background: T.card,
      border: '1px solid ' + T.cardBorder,
      borderRadius: '16px',
      padding: '1.5rem',
      marginBottom: '1rem',
      boxShadow: T.shadow
    }
  },
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        paddingBottom: '0.75rem',
        borderBottom: '1px solid ' + T.cardBorder
      }
    },
      React.createElement('span', {
        style: { fontSize: '1.1rem', fontWeight: '650', letterSpacing: '-0.01em', color: T.text }
      }, title),
      badge && React.createElement('span', { 
        style: {
          padding: '0.25rem 0.75rem',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: '600',
          background: badgeType === 'positive' ? 'color-mix(in srgb, var(--success) 20%, transparent)' : 
                     badgeType === 'negative' ? 'color-mix(in srgb, var(--danger) 20%, transparent)' :
                     badgeType === 'warning' ? 'color-mix(in srgb, var(--warning) 20%, transparent)' : 'color-mix(in srgb, var(--text-dim) 20%, transparent)',
          color: badgeType === 'positive' ? 'var(--success)' : 
                badgeType === 'negative' ? 'var(--danger)' :
                badgeType === 'warning' ? 'var(--warning)' : 'var(--text-dim)'
        }
      }, badge)
    ),
    children
  );
}

function MetricGrid(props) {
  var T = useT();
  var metrics = props.metrics || [];
  
  return React.createElement('div', { 
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: '1rem'
    }
  },
    metrics.map(function(m, i) {
      return React.createElement('div', {
        key: i,
        style: {
          textAlign: 'center',
          padding: '1.1rem',
          background: T.card,
          border: '1px solid ' + T.cardBorder,
          borderRadius: '12px'
        }
      },
        React.createElement('div', {
          style: { fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', color: ((window.MaerminUtils && window.MaerminUtils.ink) ? window.MaerminUtils.ink(m.color) : m.color) || T.text }
        }, m.value),
        React.createElement('div', {
          style: {
            fontSize: '0.72rem',
            color: T.textSecondary,
            marginTop: '0.3rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em'
          }
        }, m.label)
      );
    })
  );
}

function DataTable(props) {
  var T = useT();
  var headers = props.headers || [];
  var rows = props.rows || [];
  
  return React.createElement('table', { 
    style: { width: '100%', borderCollapse: 'collapse' }
  },
    React.createElement('thead', null,
      React.createElement('tr', null,
        headers.map(function(h, i) {
          return React.createElement('th', { 
            key: i,
            style: {
              padding: '0.75rem',
              textAlign: 'left',
              borderBottom: '1px solid ' + T.cardBorder,
              color: T.accent,
              fontWeight: '600',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }
          }, h);
        })
      )
    ),
    React.createElement('tbody', null,
      rows.map(function(row, i) {
        return React.createElement('tr', { key: i },
          row.map(function(cell, j) {
            var cellStyle = { padding: '0.75rem', color: T.text, borderBottom: '1px solid ' + T.cardBorder };
            if (cell && cell.style) {
              Object.assign(cellStyle, cell.style);
            }
            return React.createElement('td', { key: j, style: cellStyle }, 
              cell && cell.value !== undefined ? cell.value : cell
            );
          })
        );
      })
    )
  );
}

function ProgressBar(props) {
  var T = useT();
  var value = props.value || 0;
  var color = props.color || 'purple';
  
  var colorMap = {
    green: '#22c55e',
    red: '#ef4444',
    blue: '#3b82f6',
    purple: T.accent
  };
  
  return React.createElement('div', { 
    style: { 
      height: '8px',
      background: T.cardBorder,
      borderRadius: '4px',
      overflow: 'hidden'
    }
  },
    React.createElement('div', {
      style: { 
        height: '100%',
        width: Math.min(100, Math.max(0, value)) + '%',
        background: colorMap[color] || color,
        borderRadius: '4px',
        transition: 'width 0.3s ease'
      }
    })
  );
}


// ============================================================================
// DCA ANALYZER VIEW
// ============================================================================

function DCAAnalyzerView(props) {
  var T = useT();
  var portfolio = props.portfolio || {};
  var priceHistory = props.priceHistory || {};
  
  var _investAmount = useState(10000);
  var investAmount = _investAmount[0];
  var setInvestAmount = _investAmount[1];
  
  var _frequency = useState('monthly');
  var frequency = _frequency[0];
  var setFrequency = _frequency[1];
  
  var _analysis = useState(null);
  var analysis = _analysis[0];
  var setAnalysis = _analysis[1];
  
  // cleanup B-3 (FINDINGS M-4): the user picks the holding (default: the
  // largest one with prices) instead of whichever key came first, and the
  // engine gets dated points so purchases fall on calendar dates.
  var holdings = useMemo(function() {
    var value = {};
    ['crypto', 'stocks', 'skins', 'commodities'].forEach(function(cat) {
      (portfolio[cat] || []).forEach(function(pos) {
        var s = pos.symbol || pos.name || '';
        var p = Number(props.prices && (props.prices[s.toLowerCase()] || props.prices[s])) || Number(pos.purchasePrice) || 0;
        value[s] = (value[s] || 0) + (Number(pos.amount) || 0) * p;
      });
    });
    return Object.keys(priceHistory).filter(function(k) { return Array.isArray(priceHistory[k]) && priceHistory[k].length > 1; })
      .sort(function(a, b) { return (value[b] || 0) - (value[a] || 0) || (a < b ? -1 : 1); });
  }, [priceHistory, portfolio, props.prices]);
  var _sym = useState('');
  var sym = holdings.indexOf(_sym[0]) !== -1 ? _sym[0] : (holdings[0] || '');
  var setSym = _sym[1];
  var priceArray = useMemo(function() {
    var history = sym ? priceHistory[sym] : null;
    if (!Array.isArray(history)) return [];
    return history.map(function(h) {
      if (h && typeof h === 'object') return { timestamp: h.timestamp != null ? h.timestamp : h.date, price: Number(h.price) };
      return { timestamp: null, price: Number(h) };
    }).filter(function(h) { return h.price > 0 && h.timestamp != null; });
  }, [priceHistory, sym]);
  var _short = useState(null);
  var shortInfo = _short[0], setShortInfo = _short[1];

  useEffect(function() {
    setShortInfo(null);
    if (window.DCAAnalyzerEngine && priceArray.length > 1) {
      var result = window.DCAAnalyzerEngine.compareDCAvsLumpSum(investAmount, priceArray, {
        dcaPeriods: 12,
        dcaFrequency: frequency
      });
      if (result && result.error) {
        setShortInfo({ need: Math.max(1, Math.round((result.neededDays || 0) / 30.44)), have: Math.max(0, Math.round((result.haveDays || 0) / 30.44)) });
        setAnalysis(null);
      } else if (result) {
        setAnalysis({
          winner: result.comparison.winner,
          dcaReturn: result.dca.return,
          lumpSumReturn: result.lumpSum.return,
          difference: result.comparison.difference,
          dcaPurchases: result.dca.purchases.length,
          interpretation: result.comparison.winner === 'dca' 
            ? __('ivDcaWon', 'DCA outperformed by {pct} due to buying at lower average prices', { pct: window.MaerminI18n.pct(result.comparison.difference, 2) })
            : __('ivLumpWon', 'Lump sum outperformed by {pct} due to market appreciation', { pct: window.MaerminI18n.pct(result.comparison.difference, 2) })
        });
      }
    } else {
      // Not enough history for a real comparison. This used to show invented
      // figures ("DCA Wins 12.50%") that looked like a result for the user's
      // own portfolio; show an explicit empty state instead.
      setAnalysis(null);
    }
  }, [investAmount, frequency, priceArray]);
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: T.text, marginBottom: '1rem' } }, __('ivDcaTitle', 'DCA Strategy Analyzer')),
    
    React.createElement('div', { style: { display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' } },
      holdings.length > 0 && React.createElement('div', null,
        React.createElement('label', { htmlFor: 'dca-holding', style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('ivDcaHolding', 'Holding')),
        React.createElement('select', {
          id: 'dca-holding', 'data-testid': 'dca-holding', value: sym,
          onChange: function(e) { setSym(e.target.value); },
          style: { background: T.inputBg, border: '1px solid ' + T.inputBorder, borderRadius: '6px', padding: '0.5rem', color: T.text, maxWidth: '220px' }
        }, holdings.map(function(k) { return React.createElement('option', { key: k, value: k }, k); }))
      ),
      React.createElement('div', null,
        React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('ivInvestAmount', 'Investment Amount')),
        React.createElement('input', {
          type: 'number', 'aria-label': __('ivInvestAmount', 'Investment Amount'),
          value: investAmount,
          onChange: function(e) { setInvestAmount(parseFloat(e.target.value) || 0); },
          style: {
            background: T.inputBg,
            border: '1px solid ' + T.inputBorder,
            borderRadius: '6px',
            padding: '0.5rem',
            color: T.text,
            width: '150px'
          }
        })
      ),
      React.createElement('div', null,
        React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('spFrequency', 'Frequency')),
        React.createElement('select', {
          value: frequency, 'aria-label': __('spFrequency', 'Frequency'),
          onChange: function(e) { setFrequency(e.target.value); },
          style: {
            background: T.inputBg,
            border: '1px solid ' + T.inputBorder,
            borderRadius: '6px',
            padding: '0.5rem',
            color: T.text
          }
        },
          React.createElement('option', { value: 'weekly' }, window.MaerminI18n.freq('weekly')),
          React.createElement('option', { value: 'biweekly' }, window.MaerminI18n.freq('biweekly')),
          React.createElement('option', { value: 'monthly' }, window.MaerminI18n.freq('monthly')),
          React.createElement('option', { value: 'quarterly' }, window.MaerminI18n.freq('quarterly'))
        )
      )
    ),
    
    !analysis && window.MaerminUtils.emptyState({ testid: 'dca-empty', text: shortInfo
      ? __('ivDcaShort', 'Not enough price history for {sym}: 12 purchases ({freq}) span {need} months, its prices cover {have}. Pick a shorter frequency or another holding.', { sym: sym, freq: window.MaerminI18n.freq(frequency), need: shortInfo.need, have: shortInfo.have })
      : __('ivDcaNoData', 'No price history for a holding yet. Daily prices come through your Worker; without one, a point is recorded on every price refresh.') }),

    analysis && React.createElement(AnalysisCard, {
      title: __('ivStratComp', 'Strategy Comparison'),
      badge: analysis.winner === 'dca' ? __('ivDcaWins', 'DCA Wins') : __('ivLumpWins', 'Lump Sum Wins'),
      badgeType: 'positive'
    },
      React.createElement(MetricGrid, {
        metrics: [
          { label: __('ivDcaReturn', 'DCA Return'), value: window.MaerminI18n.pct(analysis.dcaReturn || 0, 2), color: '#22c55e' },
          { label: __('ivLumpReturn', 'Lump Sum Return'), value: window.MaerminI18n.pct(analysis.lumpSumReturn || 0, 2), color: '#3b82f6' },
          { label: __('ivDifference', 'Difference'), value: window.MaerminI18n.pct(analysis.difference || 0, 2), color: '#f59e0b' },
          { label: __('ivPurchases', 'Purchases'), value: analysis.dcaPurchases || 12 }
        ]
      }),
      React.createElement('p', {
        style: { marginTop: '1rem', color: T.textSecondary, fontSize: '0.875rem' }
      }, analysis.interpretation || '')
    )
  );
}

// ============================================================================
// SECTOR ALLOCATION VIEW
// ============================================================================

function SectorAllocationView(props) {
  var money = useMoney();
  var T = useT();
  var portfolio = props.portfolio || {};
  var prices = props.prices || {};

  // Live value of a position from the shared price map (falls back to cost).
  function valueOf(pos) {
    var s = (pos.symbol || pos.name || '');
    var price = prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || pos.currentPrice || pos.purchasePrice || 0;
    return (pos.amount || 0) * price;
  }
  // Sector via the metadata service (cache → expanded static map → 'Other').
  function sectorOf(pos) {
    if (window.MaerminEquityMeta) return window.MaerminEquityMeta.getMeta(pos.symbol || pos.name).sector || 'Other';
    return 'Other';
  }

  var sectorData = useMemo(function() {
    var sectors = {};
    var totalValue = 0;
    var unknown = 0;
    function add(name, value) { if (!sectors[name]) sectors[name] = 0; sectors[name] += value; totalValue += value; }

    (portfolio.stocks || []).forEach(function(pos) {
      var value = valueOf(pos);
      var sector = sectorOf(pos);
      if (sector === 'Other') unknown += value;
      add(sector, value);
    });
    (portfolio.crypto || []).forEach(function(pos) { add('Crypto', valueOf(pos)); });
    (portfolio.skins || []).forEach(function(pos) { add('Gaming', valueOf(pos)); });

    var sectorArray = Object.keys(sectors).map(function(name) {
      return { name: name, value: sectors[name], weight: totalValue > 0 ? (sectors[name] / totalValue) * 100 : 0 };
    }).filter(function(s) { return s.weight > 0; })
      .sort(function(a, b) { return b.weight - a.weight; });

    return {
      sectors: sectorArray,
      totalValue: totalValue,
      sectorCount: sectorArray.length,
      unknownPct: totalValue > 0 ? (unknown / totalValue) * 100 : 0
    };
  }, [portfolio, prices, props.metaVersion]);
  
  var sectorColors = {
    'Technology': '#3b82f6',
    'Healthcare': '#22c55e',
    'Financials': '#f59e0b',
    'Consumer': '#ec4899',
    'Energy': '#ef4444',
    'Crypto': '#f97316',
    'Gaming': '#8b7cff',
    'Other': '#6b7280'
  };
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: T.text, marginBottom: '1rem' } }, __('ivSectorAlloc', 'Sector Allocation')),

    // Coverage hint: if a meaningful share is still unclassified, point the user
    // to the Worker URL that backfills sector/country for every holding.
    sectorData.unknownPct > 15 && React.createElement('div', {
      style: { marginBottom: '1rem', padding: '0.625rem 0.875rem', background: 'rgba(139,124,255,0.10)', border: '1px solid rgba(139,124,255,0.25)', borderRadius: '8px', color: 'rgba(255,255,255,0.75)', fontSize: '0.8rem' }
    }, __('ivUnclassified', '~{pct} of equities are unclassified. Add your Worker URL in Settings → API to auto-fetch sector & country for every holding.', { pct: window.MaerminI18n.pct(sectorData.unknownPct, 0) })),

    sectorData.sectors.length > 0 ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: TWO_COL, gap: '1rem' } },
      React.createElement(AnalysisCard, {
        title: __('ivSectorBreakdown', 'Sector Breakdown'),
        badge: __('ivNSectors', '{n} {n:Sector|Sectors}', { n: sectorData.sectorCount })
      },
        sectorData.sectors.map(function(sector) {
          return React.createElement('div', { 
            key: sector.name,
            style: { marginBottom: '0.75rem' }
          },
            React.createElement('div', { 
              style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }
            },
              React.createElement('span', { style: { color: T.text, fontSize: '0.875rem' } }, window.MaerminI18n.sector(sector.name)),
              React.createElement('span', { style: { color: sectorColors[sector.name] || '#8b7cff' } }, 
                window.MaerminI18n.pct(sector.weight, 1)
              )
            ),
            React.createElement('div', { 
              style: { height: '8px', background: T.cardBorder, borderRadius: '4px', overflow: 'hidden' }
            },
              React.createElement('div', {
                style: { 
                  height: '100%',
                  width: sector.weight + '%',
                  background: sectorColors[sector.name] || '#8b7cff',
                  borderRadius: '4px'
                }
              })
            )
          );
        })
      ),
      
      React.createElement(AnalysisCard, {
        title: __('ivConcAnalysis', 'Concentration Analysis'),
        badge: sectorData.sectorCount < 3 ? __('ivHighRisk', 'High Risk') : sectorData.sectorCount < 5 ? __('ivModerate', 'Moderate') : __('diversified', 'Diversified'),
        badgeType: sectorData.sectorCount < 3 ? 'warning' : 'positive'
      },
        React.createElement(MetricGrid, {
          metrics: [
            { label: __('ivSectors', 'Sectors'), value: sectorData.sectorCount },
            { label: __('ivTopSector', 'Top Sector'), value: sectorData.sectors[0] ? window.MaerminI18n.sector(sectorData.sectors[0].name) : __('healthNotAvailable', 'n/a') },
            { label: __('ivTopWeight', 'Top Weight'), value: window.MaerminI18n.pct(sectorData.sectors[0] ? sectorData.sectors[0].weight : 0, 1) },
            { label: __('ovTotalValue', 'Total Value'), value: money(sectorData.totalValue) }
          ]
        }),
        sectorData.sectors[0] && sectorData.sectors[0].weight > 50 && React.createElement('div', {
          style: { marginTop: '1rem', padding: '0.75rem', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', borderRadius: '8px' }
        },
          React.createElement('div', { style: { color: 'var(--danger)', fontWeight: '600', marginBottom: '0.5rem' } }, __('ivConcWarning', 'Concentration Warning')),
          React.createElement('div', { style: { color: T.textSecondary, fontSize: '0.875rem' } }, 
            __('ivSectorWarn', 'Over {pct} in {name}. Consider diversifying.', { pct: window.MaerminI18n.pct(50, 0), name: window.MaerminI18n.sector(sectorData.sectors[0].name) })
          )
        )
      )
    ) : React.createElement('div', {
      style: { color: T.textSecondary, padding: '2rem', textAlign: 'center' }
    }, __('ivNoSectorData', 'Add positions to analyze sector allocation'))
  );
}

// ============================================================================
// COUNTRY / REGION ALLOCATION VIEW  (V7 Allocation Intelligence)
// Extends the existing allocation dashboard with a geographic dimension,
// using the same AnalysisCard/MetricGrid building blocks as the sector view.
// ============================================================================

function CountryAllocationView(props) {
  var money = useMoney();
  var T = useT();
  var portfolio = props.portfolio || {};
  var prices = props.prices || {};

  function valueOf(pos) {
    var s = (pos.symbol || pos.name || '');
    var price = prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || pos.currentPrice || pos.purchasePrice || 0;
    return (pos.amount || 0) * price;
  }
  // Country via the metadata service (cache → expanded static map → 'Other').
  function countryOf(pos) {
    if (window.MaerminEquityMeta) return window.MaerminEquityMeta.getMeta(pos.symbol || pos.name).country || 'Other';
    return 'Other';
  }

  var data = useMemo(function() {
    var buckets = {};
    var totalValue = 0;
    function add(country, value) { if (!buckets[country]) buckets[country] = 0; buckets[country] += value; totalValue += value; }

    (portfolio.stocks || []).forEach(function(pos) { add(countryOf(pos), valueOf(pos)); });
    (portfolio.crypto || []).forEach(function(pos) { add('Global (Crypto)', valueOf(pos)); });
    (portfolio.skins || []).forEach(function(pos) { add('Global (Gaming)', valueOf(pos)); });

    var rows = Object.keys(buckets).map(function(name) {
      return { name: name, value: buckets[name], weight: totalValue > 0 ? (buckets[name] / totalValue) * 100 : 0 };
    }).filter(function(r) { return r.weight > 0; }).sort(function(a, b) { return b.weight - a.weight; });

    return { rows: rows, totalValue: totalValue, count: rows.length };
  }, [portfolio, prices, props.metaVersion]);

  var palette = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#ef4444', '#f97316', '#8b7cff', '#06b6d4', '#6b7280'];
  var colorFor = function(i) { return palette[i % palette.length]; };

  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: T.text, marginBottom: '1rem' } }, __('ivCountryAlloc', 'Country / Region Allocation')),

    data.rows.length > 0 ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: TWO_COL, gap: '1rem' } },
      React.createElement(AnalysisCard, { title: __('ivGeoBreakdown', 'Geographic Breakdown'), badge: __('ivNRegions', '{n} {n:Region|Regions}', { n: data.count }) },
        data.rows.map(function(row, i) {
          return React.createElement('div', { key: row.name, style: { marginBottom: '0.75rem' } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' } },
              React.createElement('span', { style: { color: T.text, fontSize: '0.875rem' } }, window.MaerminI18n.country(row.name)),
              React.createElement('span', { style: { color: colorFor(i) } }, window.MaerminI18n.pct(row.weight, 1))),
            React.createElement('div', { style: { height: '8px', background: T.cardBorder, borderRadius: '4px', overflow: 'hidden' } },
              React.createElement('div', { style: { height: '100%', width: row.weight + '%', background: colorFor(i), borderRadius: '4px' } })));
        })
      ),
      React.createElement(AnalysisCard, {
        title: __('ivConcAnalysis', 'Concentration Analysis'),
        badge: data.count < 2 ? __('ivHighRisk', 'High Risk') : data.count < 4 ? __('ivModerate', 'Moderate') : __('diversified', 'Diversified'),
        badgeType: data.count < 2 ? 'warning' : 'positive'
      },
        React.createElement(MetricGrid, { metrics: [
          { label: __('ivRegions', 'Regions'), value: data.count },
          { label: __('ivTopRegion', 'Top Region'), value: data.rows[0] ? window.MaerminI18n.country(data.rows[0].name) : __('healthNotAvailable', 'n/a') },
          { label: __('ivTopWeight', 'Top Weight'), value: window.MaerminI18n.pct(data.rows[0] ? data.rows[0].weight : 0, 1) },
          { label: __('ovTotalValue', 'Total Value'), value: money(data.totalValue) }
        ] }),
        data.rows[0] && data.rows[0].weight > 60 && React.createElement('div', { style: { marginTop: '1rem', padding: '0.75rem', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', borderRadius: '8px' } },
          React.createElement('div', { style: { color: 'var(--danger)', fontWeight: '600', marginBottom: '0.5rem' } }, __('ivConcWarning', 'Concentration Warning')),
          React.createElement('div', { style: { color: T.textSecondary, fontSize: '0.875rem' } }, __('ivCountryWarn', 'Over {pct} in {name}. Consider geographic diversification.', { pct: window.MaerminI18n.pct(60, 0), name: window.MaerminI18n.country(data.rows[0].name) })))
      )
    ) : React.createElement('div', { style: { color: T.textSecondary, padding: '2rem', textAlign: 'center' } }, __('ivNoCountryData', 'Add positions to analyze country allocation'))
  );
}

// ============================================================================
// CURRENCY EXPOSURE VIEW
// ============================================================================

function CurrencyExposureView(props) {
  var money = useMoney();
  var T = useT();
  var portfolio = props.portfolio || {};
  
  var _baseCurrency = useState('EUR');
  var baseCurrency = _baseCurrency[0];
  var setBaseCurrency = _baseCurrency[1];
  
  var currencyData = useMemo(function() {
    var currencies = { 'EUR': 0, 'USD': 0 };
    var totalValue = 0;
    
    // Stocks typically in USD
    (portfolio.stocks || []).forEach(function(pos) {
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      currencies['USD'] += value;
      totalValue += value;
    });
    
    // Crypto typically in USD
    (portfolio.crypto || []).forEach(function(pos) {
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      currencies['USD'] += value;
      totalValue += value;
    });
    
    // CS2 Skins in EUR
    (portfolio.skins || []).forEach(function(pos) {
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      currencies['EUR'] += value;
      totalValue += value;
    });
    
    var exposure = {};
    Object.keys(currencies).forEach(function(cur) {
      exposure[cur] = {
        value: currencies[cur],
        weight: totalValue > 0 ? (currencies[cur] / totalValue) * 100 : 0
      };
    });
    
    var foreignExposure = baseCurrency === 'EUR' ? (exposure['USD'] ? exposure['USD'].weight : 0) : (exposure['EUR'] ? exposure['EUR'].weight : 0);
    var domesticExposure = 100 - foreignExposure;
    
    return {
      exposure: exposure,
      totalValue: totalValue,
      foreignExposure: foreignExposure,
      domesticExposure: domesticExposure,
      currencyCount: Object.keys(exposure).filter(function(k) { return exposure[k].weight > 0; }).length
    };
  }, [portfolio, baseCurrency]);
  
  var scenarios = [
    { scenario: 'EUR ' + window.MaerminI18n.pct(10, 0, true), portfolioImpact: -(currencyData.foreignExposure * 0.1) },
    { scenario: 'EUR ' + window.MaerminI18n.pct(-10, 0, true), portfolioImpact: currencyData.foreignExposure * 0.1 },
    { scenario: 'USD ' + window.MaerminI18n.pct(10, 0, true), portfolioImpact: (currencyData.exposure['USD'] ? currencyData.exposure['USD'].weight : 0) * 0.1 },
    { scenario: 'USD ' + window.MaerminI18n.pct(-10, 0, true), portfolioImpact: -(currencyData.exposure['USD'] ? currencyData.exposure['USD'].weight : 0) * 0.1 }
  ];
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: T.text, marginBottom: '1rem' } }, __('ivCurrencyExposure', 'Currency Exposure')),
    
    React.createElement('div', { style: { marginBottom: '1rem' } },
      React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', marginRight: '0.5rem' } }, __('ivBaseCurrency', 'Base Currency:')),
      React.createElement('select', {
        value: baseCurrency,
        onChange: function(e) { setBaseCurrency(e.target.value); },
        style: {
          background: T.inputBg,
          border: '1px solid ' + T.inputBorder,
          borderRadius: '6px',
          padding: '0.5rem',
          color: T.text
        }
      },
        React.createElement('option', { value: 'EUR' }, 'EUR – ' + __('ivEuro', 'Euro')),
        React.createElement('option', { value: 'USD' }, 'USD – ' + __('ivUsDollar', 'US Dollar'))
      )
    ),
    
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: TWO_COL, gap: '1rem' } },
      React.createElement(AnalysisCard, {
        title: __('ivCurBreakdown', 'Currency Breakdown'),
        badge: __('ivForeignPct', '{pct} foreign', { pct: window.MaerminI18n.pct(currencyData.foreignExposure, 1) }),
        badgeType: currencyData.foreignExposure > 50 ? 'warning' : 'neutral'
      },
        React.createElement(MetricGrid, {
          metrics: [
            { label: __('ivDomestic', 'Domestic ({cur})', { cur: baseCurrency }), value: window.MaerminI18n.pct(currencyData.domesticExposure, 1), color: '#22c55e' },
            { label: __('ivForeign', 'Foreign'), value: window.MaerminI18n.pct(currencyData.foreignExposure, 1), color: '#f59e0b' },
            { label: __('ivCurrencies', 'Currencies'), value: currencyData.currencyCount },
            { label: __('ovTotalValue', 'Total Value'), value: money(currencyData.totalValue) }
          ]
        }),
        React.createElement('div', { style: { marginTop: '1rem' } },
          Object.keys(currencyData.exposure).filter(function(c) {
            return currencyData.exposure[c].weight > 0;
          }).map(function(currency) {
            var exp = currencyData.exposure[currency];
            return React.createElement('div', {
              key: currency,
              style: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid ' + T.cardBorder }
            },
              React.createElement('span', { style: { color: T.text } }, currency),
              React.createElement('span', { style: { color: currency === baseCurrency ? 'var(--success)' : 'var(--warning)' } }, 
                window.MaerminI18n.pct(exp.weight, 1)
              )
            );
          })
        )
      ),
      
      React.createElement(AnalysisCard, {
        title: __('ivFxScenarios', 'FX Scenario Analysis'),
        badge: __('ivStressTests', 'Stress Tests')
      },
        React.createElement(DataTable, {
          headers: [__('stScenario', 'Scenario'), __('ivImpact', 'Impact')],
          rows: scenarios.map(function(s) {
            return [
              s.scenario,
              {
                value: window.MaerminI18n.pct(s.portfolioImpact, 2, true),
                style: { color: s.portfolioImpact >= 0 ? 'var(--success)' : 'var(--danger)' }
              }
            ];
          })
        })
      )
    )
  );
}

// ============================================================================
// LIQUIDITY ANALYSIS VIEW
// ============================================================================

function liqRating(r) {
  return ({ Excellent: __('ivExcellent', 'Excellent'), Good: __('good', 'Good'), Fair: __('ivFair', 'Fair'), Poor: __('ivPoor', 'Poor') })[r] || r;
}

function LiquidityAnalysisView(props) {
  var money = useMoney();
  var T = useT();
  var portfolio = props.portfolio || {};
  
  var liquidityData = useMemo(function() {
    var positions = [];
    var totalValue = 0;
    
    var liquidityScores = {
      // Crypto - high liquidity
      'bitcoin': 95, 'ethereum': 95, 'solana': 85,
      // Large cap stocks - high liquidity
      'AAPL': 95, 'MSFT': 95, 'GOOGL': 95, 'AMZN': 95,
      // Other stocks
      'JNJ': 90, 'JPM': 90, 'V': 90,
      // CS2 Skins - lower liquidity
      'default_skin': 40
    };
    
    // Process stocks
    (portfolio.stocks || []).forEach(function(pos) {
      var symbol = (pos.symbol || pos.name || '').toUpperCase();
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      positions.push({
        symbol: symbol,
        value: value,
        liquidityScore: liquidityScores[symbol] || 80,
        liquidityRating: 'Good'
      });
      totalValue += value;
    });
    
    // Process crypto
    (portfolio.crypto || []).forEach(function(pos) {
      var symbol = pos.symbol || pos.name || '';
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      positions.push({
        symbol: symbol,
        value: value,
        liquidityScore: liquidityScores[symbol.toLowerCase()] || 70,
        liquidityRating: 'Good'
      });
      totalValue += value;
    });
    
    // Process skins
    (portfolio.skins || []).forEach(function(pos) {
      var symbol = pos.symbol || pos.name || '';
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      positions.push({
        symbol: symbol,
        value: value,
        liquidityScore: 40,
        liquidityRating: 'Fair'
      });
      totalValue += value;
    });
    
    // Sort by liquidity score (lowest first for watch list)
    var leastLiquid = positions.slice().sort(function(a, b) { return a.liquidityScore - b.liquidityScore; });
    
    // Calculate portfolio score
    var weightedScore = positions.reduce(function(sum, p) {
      var weight = totalValue > 0 ? p.value / totalValue : 0;
      return sum + (p.liquidityScore * weight);
    }, 0);
    
    return {
      positions: positions,
      leastLiquid: leastLiquid.slice(0, 5),
      totalValue: totalValue,
      portfolioLiquidityScore: weightedScore || 75,
      portfolioLiquidityRating: weightedScore >= 80 ? 'Excellent' : weightedScore >= 60 ? 'Good' : weightedScore >= 40 ? 'Fair' : 'Poor',
      costToLiquidatePercent: weightedScore >= 80 ? 0.5 : weightedScore >= 60 ? 1.5 : 3.0
    };
  }, [portfolio]);
  
  var getLiquidityColor = function(score) {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#84cc16';
    if (score >= 40) return '#f59e0b';
    return '#ef4444';
  };
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: T.text, marginBottom: '1rem' } }, __('ivLiqAnalysis', 'Liquidity Analysis')),
    
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: TWO_COL, gap: '1rem' } },
      React.createElement(AnalysisCard, {
        title: __('ivPortLiq', 'Portfolio Liquidity'),
        badge: liqRating(liquidityData.portfolioLiquidityRating),
        badgeType: liquidityData.portfolioLiquidityScore >= 60 ? 'positive' : 'warning'
      },
        React.createElement(MetricGrid, {
          metrics: [
            { label: __('ivLiqScore', 'Liquidity Score'), value: window.MaerminI18n.num(liquidityData.portfolioLiquidityScore, 0) + '/100', color: getLiquidityColor(liquidityData.portfolioLiquidityScore) },
            { label: __('ivEstCost', 'Est. Cost'), value: window.MaerminI18n.pct(liquidityData.costToLiquidatePercent, 2) },
            { label: __('positions', 'Positions'), value: liquidityData.positions.length },
            { label: __('ovTotalValue', 'Total Value'), value: money(liquidityData.totalValue) }
          ]
        })
      ),
      
      React.createElement(AnalysisCard, {
        title: __('ivLeastLiquid', 'Least Liquid Positions'),
        badge: __('ivWatchList', 'Watch list')
      },
        liquidityData.leastLiquid.length > 0 ? liquidityData.leastLiquid.map(function(pos, i) {
          return React.createElement('div', {
            key: i,
            style: { 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              padding: '0.5rem 0',
              borderBottom: '1px solid ' + T.cardBorder
            }
          },
            React.createElement('span', { style: { color: T.text } }, pos.symbol),
            React.createElement('div', { style: { display: 'flex', gap: '1rem', alignItems: 'center' } },
              React.createElement('span', { 
                style: { color: getLiquidityColor(pos.liquidityScore), fontSize: '0.875rem' } 
              }, window.MaerminI18n.num(pos.liquidityScore, 0) + '/100'),
              React.createElement('span', { 
                style: { color: T.textSecondary, fontSize: '0.75rem' } 
              }, liqRating(pos.liquidityRating))
            )
          );
        }) : React.createElement('p', { style: { color: T.textSecondary } }, __('ivNoLiqData', 'Add positions to see liquidity analysis'))
      )
    )
  );
}

// ============================================================================
// GOAL CARD WITH GLIDE PATH (P5-5.7)
// ============================================================================

function goalStateLabel(state) {
  switch (state) {
    case 'ahead': return __('glAhead', 'Ahead');
    case 'on-track': return __('glOnTrack', 'On Track');
    case 'behind': return __('glBehind', 'Behind');
    case 'reached': return __('glReached', 'Reached');
    case 'missed': return __('glMissed', 'Date passed');
    default: return __('glNoTarget', 'No target');
  }
}

// The planned path (line) and today's money (dot); a dashed line at the target.
function GoalPathChart(props) {
  var T = useT();
  var path = props.path || [];
  if (path.length < 2) return null;
  // Drawn at about its on-screen size, so the labels keep their size on a
  // phone and on a wide screen.
  var narrow = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  var Wd = narrow ? 340 : 1100, H = narrow ? 140 : 190, padL = 4, padR = 8, padT = 10, padB = 20;
  var t0 = Date.parse(path[0].date), t1 = Date.parse(path[path.length - 1].date);
  var max = Math.max(props.target || 0, props.value || 0, path[path.length - 1].value) * 1.05 || 1;
  var x = function (d) { return padL + (Date.parse(d) - t0) / Math.max(1, t1 - t0) * (Wd - padL - padR); };
  var y = function (v) { return padT + (1 - v / max) * (H - padT - padB); };
  var line = path.map(function (p, i) { return (i ? 'L' : 'M') + x(p.date).toFixed(1) + ' ' + y(p.value).toFixed(1); }).join(' ');
  var today = props.asOf;
  var showDot = today >= path[0].date && today <= path[path.length - 1].date;
  var dotColor = props.state === 'behind' ? (T.warning || '#f59e0b') : (T.success || '#22c55e');
  return React.createElement('svg', { 'data-testid': 'goal-chart', viewBox: '0 0 ' + Wd + ' ' + H, role: 'img', 'aria-label': __('glPathLabel', 'Planned path to the target and today\'s value'), style: { width: '100%', height: 'auto', display: 'block', margin: '0.75rem 0 0.25rem' } },
    React.createElement('line', { x1: padL, x2: Wd - padR, y1: y(props.target), y2: y(props.target), stroke: T.textSecondary, strokeDasharray: '4 4', strokeWidth: 1, opacity: 0.6 }),
    React.createElement('path', { d: line, fill: 'none', stroke: T.accent || '#8b7cff', strokeWidth: 2 }),
    showDot ? React.createElement('circle', { cx: x(today), cy: y(props.value), r: 5, fill: dotColor, stroke: T.card || '#000', strokeWidth: 2 }) : null,
    React.createElement('text', { x: padL, y: H - 4, fill: T.textSecondary, fontSize: 12 }, window.MaerminI18n.date(path[0].date)),
    React.createElement('text', { x: Wd - padR, y: H - 4, fill: T.textSecondary, fontSize: 12, textAnchor: 'end' }, window.MaerminI18n.date(path[path.length - 1].date)));
}

function GoalPathCard(props) {
  var money = useMoney();
  var T = useT();
  var GP = window.MaerminGoalPath;
  var goal = GP.normalizeGoal(props.goal);
  var asOf = new Date().toISOString().slice(0, 10);
  var lv = GP.linkedValue(goal, props.ctx);
  var st = GP.status(goal, lv.value, { asOf: asOf });
  var path = GP.glidePath(goal);
  var badgeType = st.state === 'ahead' || st.state === 'on-track' || st.state === 'reached' ? 'positive' : st.state === 'invalid' ? 'neutral' : 'warning';
  var suggested = lv.linked ? GP.equityGlide(goal, asOf) : null;
  var actual = lv.linked ? GP.riskShare(lv.positions) : null;
  var cell = function (label, value, tid) {
    return React.createElement('div', { 'data-testid': tid },
      React.createElement('div', { style: { color: T.textSecondary, fontSize: '0.75rem' } }, label),
      React.createElement('div', { style: { color: T.text } }, value));
  };
  var pct = function (v) { return v == null ? '–' : window.MaerminI18n.pct(v, 0); };
  return React.createElement(AnalysisCard, { title: props.goal.name, badge: goalStateLabel(st.state), badgeType: badgeType },
    React.createElement('div', { 'data-testid': 'goal-card', 'data-state': st.state },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '0.5rem', flexWrap: 'wrap' } },
        React.createElement('span', { style: { color: T.textSecondary } }, money(lv.value) + ' / ' + money(goal.targetAmount) + (lv.linked ? ' · ' + props.linkLabel(goal.link) : '')),
        React.createElement('span', { style: { color: T.accent, fontWeight: '600' } }, window.MaerminI18n.pct(st.progressPercent, 1))),
      React.createElement(ProgressBar, { value: st.progressPercent, color: badgeType === 'warning' ? 'red' : 'green' }),
      React.createElement(GoalPathChart, { path: path, target: goal.targetAmount, value: lv.value, asOf: asOf, state: st.state }),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' } },
        cell(__('glTargetDate', 'Target Date'), window.MaerminI18n.date(goal.targetDate)),
        cell(__('freqMonthly', 'Monthly'), money(goal.monthlyContribution)),
        cell(__('glPlannedToday', 'Planned for today'), st.planned == null ? '–' : money(st.planned), 'goal-planned'),
        cell(__('glNeeded', 'Needed a month from now'), st.requiredMonthly == null ? '–' : money(st.requiredMonthly), 'goal-needed'),
        cell(__('glProjected', 'At this pace on the date'), st.projected == null ? '–' : money(st.projected), 'goal-projected'),
        cell(__('glReturnShort', 'Expected return'), window.MaerminI18n.pct(goal.expectedReturn * 100, 1))),
      suggested != null ? React.createElement('div', { 'data-testid': 'goal-risk', style: { marginTop: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '10px', background: T.inputBg, color: T.textSecondary, fontSize: '0.8rem', lineHeight: 1.5 } },
        __('glRiskLine', 'Glide path for risk: about {s} in shares and other risky assets now, falling towards the date. The linked holdings have {a}.', { s: pct(suggested), a: pct(actual) }),
        actual != null && actual > suggested + 10 ? React.createElement('span', { style: { color: T.warning || 'var(--warning)' } }, ' ' + __('glRiskHigh', 'Consider moving some into bonds or cash as the date comes closer.')) : null) : null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' } },
        React.createElement('button', { onClick: props.onDelete, style: { background: 'color-mix(in srgb, var(--danger) 20%, transparent)', color: 'var(--danger)', border: 'none', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' } }, __('delete', 'Delete')))));
}

// ============================================================================
// GOAL INVESTING VIEW
// ============================================================================

function GoalInvestingView(props) {
  var money = useMoney();
  var T = useT();
  var portfolioValue = props.portfolioValue || 0;
  
  // Read the saved goals in the initializer (not in an effect), so the save
  // effect below never sees a not-yet-loaded [] and can always write - also
  // the empty list after the last goal was deleted (FINDINGS H-5).
  var _goals = useState(function () {
    try {
      var saved = JSON.parse(localStorage.getItem('investmentGoals') || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch (e) { return []; }
  });
  var goals = _goals[0];
  var setGoals = _goals[1];
  
  var _showAddGoal = useState(false);
  var showAddGoal = _showAddGoal[0];
  var setShowAddGoal = _showAddGoal[1];
  
  var blankGoal = {
    name: '',
    type: 'retirement',
    targetAmount: 100000,
    currentAmount: 0,
    targetDate: '2035-01-01',
    monthlyContribution: 500,
    link: '',            // P5-5.7: '' (amount typed in) | 'portfolio:<id>' | 'tag:<name>'
    expectedReturn: 5    // % a year
  };
  var _newGoal = useState(blankGoal);
  var newGoal = _newGoal[0];
  var setNewGoal = _newGoal[1];

  // P5-5.7: a goal's money comes from its portfolios or tags when linked
  var GP = (typeof window !== 'undefined') && window.MaerminGoalPath;
  var tagsState = (function () { try { return window.MaerminTags ? window.MaerminTags.load() : null; } catch (e) { return null; } })();
  var tagNames = tagsState && tagsState.tags ? Object.keys(tagsState.tags).sort() : [];
  var portfolios = props.portfolios || [];
  var ctx = { transactions: props.transactions || [], prices: props.prices || {}, tagsState: tagsState };
  var linkOf = function (s) {
    var m = /^(portfolio|tag):(.+)$/.exec(String(s || ''));
    return m ? { type: m[1], ids: [m[2]] } : null;
  };
  var linkLabel = function (link) {
    if (!link) return '';
    var id = link.ids[0];
    if (link.type === 'portfolio') { var p = portfolios.filter(function (x) { return x.id === id; })[0]; return __('glLinkedPf', 'Portfolio {name}', { name: p ? p.name : id }); }
    return __('glLinkedTag', 'Tag {name}', { name: id });
  };
  
  // Save goals to localStorage
  useEffect(function() {
    localStorage.setItem('investmentGoals', JSON.stringify(goals));
  }, [goals]);
  if (typeof window !== 'undefined' && window.MaerminTrash) window.MaerminTrash.useReload('investmentGoals', function () {
    try { var g = JSON.parse(localStorage.getItem('investmentGoals') || '[]'); if (Array.isArray(g)) setGoals(g); } catch (e) { /* keep */ }
  });
  
  var addGoal = function() {
    if (!newGoal.name || !(newGoal.targetAmount > 0)) return;
    
    var link = linkOf(newGoal.link);
    var now = new Date().toISOString();
    var goal = {
      id: Date.now().toString(),
      name: newGoal.name,
      type: newGoal.type,
      targetAmount: newGoal.targetAmount,
      currentAmount: newGoal.currentAmount,
      targetDate: newGoal.targetDate,
      monthlyContribution: newGoal.monthlyContribution,
      createdAt: now,
      // P5-5.7: the glide path starts today at today's money
      link: link,
      expectedReturn: (Number(newGoal.expectedReturn) || 0) / 100,
      startDate: now.slice(0, 10),
      startValue: link && GP ? GP.linkedValue({ link: link }, ctx).value : newGoal.currentAmount
    };

    setGoals(goals.concat([goal]));
    setShowAddGoal(false);
    setNewGoal(blankGoal);
  };
  
  var deleteGoal = function(goalId) {
    var gone = goals.filter(function(g) { return g.id === goalId; })[0];
    setGoals(goals.filter(function(g) { return g.id !== goalId; }));
    if (gone && typeof window !== 'undefined' && window.MaerminTrash) window.MaerminTrash.trashed('goal', gone.name, gone);
  };
  
  var calculateProgress = function(goal) { return goalProgress(goal); };
  
  var goalTypes = [
    { id: 'retirement', label: __('glRetirement', 'Retirement') },
    { id: 'house', label: __('glHouse', 'House') },
    { id: 'education', label: __('glEducation', 'Education') },
    { id: 'emergency', label: __('glEmergency', 'Emergency Fund') },
    { id: 'vacation', label: __('glVacation', 'Vacation') },
    { id: 'custom', label: __('glCustom', 'Custom') }
  ];
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
      React.createElement('h2', { style: { color: T.text } }, __('glTitle', 'Goal-Based Investing')),
      React.createElement('button', {
        onClick: function() { setShowAddGoal(true); },
        style: {
          background: (T.accentFill || T.accent),
          color: '#ffffff',
          border: 'none',
          padding: '0.5rem 1rem',
          borderRadius: '6px',
          cursor: 'pointer'
        }
      }, __('glAdd', '+ Add Goal'))
    ),
    
    showAddGoal && React.createElement(AnalysisCard, { title: __('glCreateNew', 'Create New Goal') },
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '1rem' } },
        React.createElement('div', null,
          React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('glName', 'Goal Name')),
          React.createElement('input', {
            'data-testid': 'goal-name',
            type: 'text',
            value: newGoal.name,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { name: e.target.value })); },
            placeholder: __('glNamePh', 'e.g., House Down Payment'),
            style: { width: '100%', background: T.inputBg, border: '1px solid ' + T.inputBorder, borderRadius: '6px', padding: '0.5rem', color: T.text }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('glType', 'Goal Type')),
          React.createElement('select', {
            value: newGoal.type,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { type: e.target.value })); },
            style: { width: '100%', background: T.inputBg, border: '1px solid ' + T.inputBorder, borderRadius: '6px', padding: '0.5rem', color: T.text }
          },
            goalTypes.map(function(t) {
              return React.createElement('option', { key: t.id, value: t.id }, t.label);
            })
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('glTargetAmount', 'Target Amount (EUR)')),
          React.createElement('input', {
            'data-testid': 'goal-target',
            type: 'number',
            value: newGoal.targetAmount,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { targetAmount: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: T.inputBg, border: '1px solid ' + T.inputBorder, borderRadius: '6px', padding: '0.5rem', color: T.text }
          })
        ),
        GP && React.createElement('div', null,
          React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('glLinkTo', 'Money for this goal')),
          React.createElement('select', {
            'data-testid': 'goal-link',
            value: newGoal.link,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { link: e.target.value })); },
            style: { width: '100%', background: T.inputBg, border: '1px solid ' + T.inputBorder, borderRadius: '6px', padding: '0.5rem', color: T.text }
          },
            React.createElement('option', { value: '' }, __('glLinkManual', 'An amount I type in')),
            portfolios.map(function (p) { return React.createElement('option', { key: 'p' + p.id, value: 'portfolio:' + p.id }, __('glLinkedPf', 'Portfolio {name}', { name: p.name || p.id })); }),
            tagNames.map(function (n) { return React.createElement('option', { key: 't' + n, value: 'tag:' + n }, __('glLinkedTag', 'Tag {name}', { name: n })); })
          )
        ),
        !newGoal.link && React.createElement('div', null,
          React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('glCurrentSaved', 'Current Saved')),
          React.createElement('input', {
            type: 'number',
            value: newGoal.currentAmount,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { currentAmount: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: T.inputBg, border: '1px solid ' + T.inputBorder, borderRadius: '6px', padding: '0.5rem', color: T.text }
          })
        ),
        GP && React.createElement('div', null,
          React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('glReturn', 'Expected return (% a year)')),
          React.createElement('input', {
            'data-testid': 'goal-return',
            type: 'number', step: '0.5', min: '-10', max: '20',
            value: newGoal.expectedReturn,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { expectedReturn: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: T.inputBg, border: '1px solid ' + T.inputBorder, borderRadius: '6px', padding: '0.5rem', color: T.text }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('glTargetDate', 'Target Date')),
          React.createElement('input', {
            type: 'date',
            value: newGoal.targetDate,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { targetDate: e.target.value })); },
            style: { width: '100%', background: T.inputBg, border: '1px solid ' + T.inputBorder, borderRadius: '6px', padding: '0.5rem', color: T.text }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: T.textSecondary, fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, __('monthlyContribution', 'Monthly Contribution')),
          React.createElement('input', {
            type: 'number',
            value: newGoal.monthlyContribution,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { monthlyContribution: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: T.inputBg, border: '1px solid ' + T.inputBorder, borderRadius: '6px', padding: '0.5rem', color: T.text }
          })
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' } },
        React.createElement('button', {
          onClick: function() { setShowAddGoal(false); },
          style: { background: T.cardBorder, color: T.text, border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }
        }, __('cancel', 'Cancel')),
        React.createElement('button', {
          'data-testid': 'goal-create',
          onClick: addGoal,
          disabled: !newGoal.name || !(newGoal.targetAmount > 0),
          title: !(newGoal.targetAmount > 0) ? __('glEnterTarget', 'Enter a target amount above 0') : undefined,
          style: { background: 'var(--success)', color: '#ffffff', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: (!newGoal.name || !(newGoal.targetAmount > 0)) ? 'not-allowed' : 'pointer', opacity: (!newGoal.name || !(newGoal.targetAmount > 0)) ? 0.5 : 1 }
        }, __('glCreate', 'Create Goal'))
      )
    ),
    
    goals.map(function(goal) {
      if (GP) {
        return React.createElement(GoalPathCard, { key: goal.id, goal: goal, ctx: ctx, linkLabel: linkLabel,
          onDelete: function () {
            var U = (typeof window !== 'undefined') && window.MaerminUtils;
            if (U && U.confirmThen) U.confirmThen({ title: __('glDeleteTitle', 'Delete the goal "{name}"?', { name: goal.name }), confirmLabel: __('delete', 'Delete') }, function() { deleteGoal(goal.id); });
          } });
      }
      var progress = calculateProgress(goal);
      
      return React.createElement(AnalysisCard, {
        key: goal.id,
        title: goal.name,
        badge: progress.invalid ? __('glNoTarget', 'No target') : progress.onTrack ? __('glOnTrack', 'On Track') : __('glBehind', 'Behind'),
        badgeType: progress.onTrack ? 'positive' : 'warning'
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' } },
          React.createElement('span', { style: { color: T.textSecondary } }, 
            money(goal.currentAmount) + ' / ' + money(goal.targetAmount)
          ),
          React.createElement('span', { style: { color: T.accent, fontWeight: '600' } },
            window.MaerminI18n.pct(progress.progressPercent, 1)
          )
        ),
        React.createElement(ProgressBar, { 
          value: progress.progressPercent, 
          color: progress.onTrack ? 'green' : 'red' 
        }),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '1rem', flexWrap: 'wrap', gap: '0.5rem' } },
          React.createElement('div', null,
            React.createElement('div', { style: { color: T.textSecondary, fontSize: '0.75rem' } }, __('glTargetDate', 'Target Date')),
            React.createElement('div', { style: { color: T.text } }, window.MaerminI18n.date(goal.targetDate))
          ),
          React.createElement('div', null,
            React.createElement('div', { style: { color: T.textSecondary, fontSize: '0.75rem' } }, __('freqMonthly', 'Monthly')),
            React.createElement('div', { style: { color: T.text } }, money(goal.monthlyContribution))
          ),
          React.createElement('div', null,
            React.createElement('div', { style: { color: T.textSecondary, fontSize: '0.75rem' } }, __('glRemaining', 'Remaining')),
            React.createElement('div', { style: { color: T.text } }, money(Math.max(0, goal.targetAmount - goal.currentAmount)))
          ),
          React.createElement('button', {
            onClick: function() {
              var U = (typeof window !== 'undefined') && window.MaerminUtils;
              if (U && U.confirmThen) U.confirmThen({ title: __('glDeleteTitle', 'Delete the goal "{name}"?', { name: goal.name }), confirmLabel: __('delete', 'Delete') }, function() { deleteGoal(goal.id); });
            },
            style: { background: 'color-mix(in srgb, var(--danger) 20%, transparent)', color: 'var(--danger)', border: 'none', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }
          }, __('delete', 'Delete'))
        )
      );
    }),
    
    goals.length === 0 && !showAddGoal && React.createElement('div', {
      style: { color: T.textSecondary, padding: '2rem', textAlign: 'center' }
    }, __('glEmpty', 'No goals yet. Click "+ Add Goal" to create your first investment goal.'))
  );
}

// ============================================================================
// MAIN DASHBOARD
// ============================================================================

function InvestmentAnalysisDashboard(props) {
  var portfolio = props.portfolio || { crypto: [], stocks: [], skins: [] };
  var prices = props.prices || {};
  var priceHistory = props.priceHistory || {};
  // VIS-005: the DCA comparison takes the daily closes when there are any
  var dcaHistory = (props.dailyCloses && Object.keys(props.dailyCloses).length) ? props.dailyCloses : priceHistory;
  var theme = props.theme || {};
  
  var _activeSection = useState('dca');
  var activeSection = _activeSection[0];
  var setActiveSection = _activeSection[1];
  
  var portfolioValue = useMemo(function() {
    var total = 0;
    ['crypto', 'stocks', 'skins'].forEach(function(cat) {
      (portfolio[cat] || []).forEach(function(pos) {
        var symbol = (pos.symbol || pos.name || '').toLowerCase();
        var price = prices[symbol] || prices[pos.symbol] || pos.purchasePrice || 0;
        total += (pos.amount || 0) * price;
      });
    });
    return total;
  }, [portfolio, prices]);
  
  // Only real, data-driven analysis tabs
  var sections = [
    { id: 'dca',      label: __('ivTabDca', 'DCA Strategy'),     desc: __('ivTabDcaDesc', 'Compare DCA vs. lump sum') },
    { id: 'sectors',  label: __('ivSectors', 'Sectors'),          desc: __('ivTabSectorsDesc', 'Analyze sector allocation') },
    { id: 'countries',label: __('ivTabCountries', 'Countries'),        desc: __('ivTabCountriesDesc', 'Geographic allocation') },
    { id: 'currency', label: __('ivCurrencies', 'Currencies'),       desc: __('ivTabCurrencyDesc', 'Foreign-currency exposure') },
    { id: 'size',     label: __('ivTabSize', 'Company Size'),      desc: __('ivTabSizeDesc', 'Market-cap size buckets') },
    { id: 'liquidity',label: __('kpiLiquidity', 'Liquidity'),        desc: __('ivTabLiqDesc', 'Position Liquidity Score') },
    { id: 'goals',    label: __('ivTabGoals', 'Goals'),            desc: __('ivTabGoalsDesc', 'Track savings goals') }
  ];
  // P5-2.8: allocation by ETF provider and by broker / portfolio (allocation-groups.js)
  if (typeof props.renderProviders === 'function') sections.splice(5, 0, { id: 'providers', label: __('ivTabProviders', 'Providers & brokers'), desc: __('ivTabProvidersDesc', 'Funds by provider, value by broker') });
  // P5-2.10: user-defined classification trees (taxonomies.js)
  if (typeof props.renderTaxonomies === 'function') sections.splice(6, 0, { id: 'taxonomies', label: __('ivTabTaxonomies', 'Taxonomies'), desc: __('ivTabTaxonomiesDesc', 'Your own classification trees') });

  var tabStyle = function(id) {
    var active = activeSection === id;
    return {
      padding: '0.5rem 1rem',
      background: active ? (theme.accentSoft || 'rgba(139,124,255,0.12)') : 'transparent',
      border: 'none',
      color: active ? (theme.accent || '#8b7cff') : (theme.textSecondary || 'rgba(255,255,255,0.6)'),
      cursor: 'pointer',
      borderRadius: '10px',
      fontSize: '0.875rem',
      fontWeight: active ? '650' : '450',
      transition: 'all 0.15s',
      whiteSpace: 'nowrap'
    };
  };
  
  var renderSectionRaw = function() {
    switch(activeSection) {
      case 'dca':      return React.createElement(DCAAnalyzerView, { portfolio: portfolio, priceHistory: dcaHistory });
      case 'sectors':  return React.createElement(SectorAllocationView, { portfolio: portfolio, prices: prices, metaVersion: props.metaVersion });
      case 'countries':return React.createElement(CountryAllocationView, { portfolio: portfolio, prices: prices, metaVersion: props.metaVersion });
      case 'currency': return React.createElement(CurrencyExposureView, { portfolio: portfolio });
      case 'size':     return window.MaerminMarketCap
        ? React.createElement(window.MaerminMarketCap.Panel, { portfolio: portfolio, prices: prices, theme: theme, t: props.t, formatPrice: props.formatPrice, workerUrl: props.workerUrl, exchangeRate: props.exchangeRate })
        : React.createElement('div', { style: { padding: '1.5rem', color: theme.textSecondary } }, __('ivMcapUnavailable', 'Market-cap module unavailable'));
      case 'liquidity':return React.createElement(LiquidityAnalysisView, { portfolio: portfolio });
      case 'goals':    return React.createElement(GoalInvestingView, { portfolioValue: portfolioValue, transactions: props.transactions, prices: prices, portfolios: props.portfolios });
      case 'providers': return typeof props.renderProviders === 'function' ? props.renderProviders() : null;
      case 'taxonomies': return typeof props.renderTaxonomies === 'function' ? props.renderTaxonomies() : null;
      default:         return React.createElement(DCAAnalyzerView, { portfolio: portfolio, priceHistory: dcaHistory });
    }
  };
  // Every section reads the app theme from here (FINDINGS H-8).
  var fp = props.formatPrice, sym = typeof props.getCurrencySymbol === 'function' ? props.getCurrencySymbol() : '€';
  var money = typeof fp === 'function' ? function(v) { return fp(Number(v) || 0) + ' ' + sym; } : null;
  var renderSection = function() {
    return React.createElement(ThemeCtx.Provider, { value: theme },
      React.createElement(MoneyCtx.Provider, { value: money }, renderSectionRaw()));
  };

  
  return React.createElement('div', null,
    // Tab bar
    React.createElement('div', { 
      style: { display: 'flex', gap: '0.25rem', padding: '0 1.5rem 1rem', flexWrap: 'wrap', borderBottom: '1px solid ' + (theme.cardBorder || DEFAULT_THEME.cardBorder), marginBottom: '0' }
    },
      sections.map(function(s) {
        return React.createElement('button', {
          key: s.id,
          type: 'button', 'aria-pressed': activeSection === s.id,
          onClick: function() { setActiveSection(s.id); },
          style: tabStyle(s.id)
        }, s.label);
      })
    ),
    renderSection()
  );
}

// Export to window
window.InvestmentViews = {
  DCAAnalyzerView: DCAAnalyzerView,
  SectorAllocationView: SectorAllocationView,
  CountryAllocationView: CountryAllocationView,
  CurrencyExposureView: CurrencyExposureView,
  LiquidityAnalysisView: LiquidityAnalysisView,
  GoalInvestingView: GoalInvestingView,
  InvestmentAnalysisDashboard: InvestmentAnalysisDashboard,
  AnalysisCard: AnalysisCard,
  MetricGrid: MetricGrid,
  DataTable: DataTable,
  ProgressBar: ProgressBar,
  ThemeContext: ThemeCtx,
  MoneyContext: MoneyCtx,
  goalProgress: goalProgress
};


})();
