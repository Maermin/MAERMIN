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

// R4.3: the Strategy primitives render the shared components (Card, Badge,
// Stat tiles, the table look, meters), so every section follows the theme.
function UIC_() { return window.MaerminComponents; }
// A colour passed by a section (theme value or token) as a money / status tone.
function toneFromColor(c) {
  var s = String(c || '');
  if (/success|gain|22c55e|green/i.test(s)) return 'gain';
  if (/danger|loss|negative|ef4444|red/i.test(s)) return 'loss';
  if (/warning|f59e0b|amber|orange/i.test(s)) return 'warning';
  return null;
}

function AnalysisCard(props) {
  var UIC = UIC_();
  var badgeTone = { positive: 'gain', negative: 'loss', warning: 'warning' }[props.badgeType] || null;
  return React.createElement(UIC.Card, {
    title: props.title, headingLevel: 'h3', 'data-testid': props.testid,
    action: props.badge ? React.createElement(UIC.Badge, { tone: badgeTone }, props.badge) : null
  }, props.children);
}

function MetricGrid(props) {
  var UIC = UIC_();
  var metrics = props.metrics || [];
  return React.createElement('div', { className: 'ui-tiles' },
    metrics.map(function (m, i) {
      return React.createElement(UIC.Stat, { key: i, className: 'ui-tile', label: m.label, value: m.value, tone: toneFromColor(m.color) });
    }));
}

function DataTable(props) {
  var headers = props.headers || [];
  var rows = props.rows || [];
  return React.createElement('div', { className: 'ui-table-wrap' },
    React.createElement('table', { className: ['ui-table', 'ui-table--dense', 'ui-table--left'].join(' ') },
      React.createElement('thead', null,
        React.createElement('tr', null,
          headers.map(function (h, i) { return React.createElement('th', { key: i, scope: 'col', className: i === 0 ? 'is-sticky' : undefined }, h); }))),
      React.createElement('tbody', null,
        rows.map(function (row, i) {
          return React.createElement('tr', { key: i },
            row.map(function (cell, j) {
              var tone = cell && cell.tone ? cell.tone : cell && cell.style ? toneFromColor(cell.style.color) : null;
              var weight = cell && cell.style && cell.style.fontWeight;
              return React.createElement(j === 0 ? 'th' : 'td', { key: j, scope: j === 0 ? 'row' : undefined,
                className: [j === 0 ? 'is-sticky' : '', tone ? 'tone-' + tone : '', weight && Number(weight) >= 600 ? 'is-strong' : ''].join(' ').trim() || undefined },
                cell && cell.value !== undefined ? cell.value : cell);
            }));
        }))));
}

function ProgressBar(props) {
  var value = props.value || 0;
  var tone = { green: 'gain', red: 'loss', blue: 'info', purple: 'accent' }[props.color || 'purple'] || toneFromColor(props.color) || 'accent';
  return React.createElement('span', { className: 'ui-meter', 'aria-hidden': 'true' },
    React.createElement('span', { className: 'ui-meter__fill', 'data-tone': tone, style: { width: Math.min(100, Math.max(0, value)) + '%' } }));
}


// ============================================================================
// DCA ANALYZER VIEW
// ============================================================================

function DCAAnalyzerView(props) {
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
  
  return React.createElement('div', { className: 'ui-stack' },
    React.createElement('h2', { className: 'ui-section-title' }, __('ivDcaTitle', 'DCA strategy analyser')),
    
    // R5.4: shared fields on classes; computed bar widths and data colours stay inline
    React.createElement('div', { className: 'ui-iv-form' },
      holdings.length > 0 && React.createElement('div', null,
        React.createElement('label', { htmlFor: 'dca-holding', className: 'ui-field__label' }, __('ivDcaHolding', 'Holding')),
        React.createElement('select', {
          id: 'dca-holding', 'data-testid': 'dca-holding', value: sym,
          onChange: function(e) { setSym(e.target.value); },
          className: ['ui-input', 'ui-select', 'ui-iv-sel'].join(' ')
        }, holdings.map(function(k) { return React.createElement('option', { key: k, value: k }, k); }))
      ),
      React.createElement('div', null,
        React.createElement('label', { className: 'ui-field__label' }, __('ivInvestAmount', 'Investment Amount')),
        React.createElement('input', {
          type: 'number', 'aria-label': __('ivInvestAmount', 'Investment Amount'),
          value: investAmount,
          onChange: function(e) { setInvestAmount(parseFloat(e.target.value) || 0); },
          className: ['ui-input', 'ui-iv-num'].join(' ')
        })
      ),
      React.createElement('div', null,
        React.createElement('label', { className: 'ui-field__label' }, __('spFrequency', 'Frequency')),
        React.createElement('select', {
          value: frequency, 'aria-label': __('spFrequency', 'Frequency'),
          onChange: function(e) { setFrequency(e.target.value); },
          className: ['ui-input', 'ui-select', 'ui-iv-sel'].join(' ')
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
          { label: __('ivDcaReturn', 'DCA Return'), value: window.MaerminI18n.pct(analysis.dcaReturn || 0, 2, true), color: (analysis.dcaReturn || 0) > 0 ? 'gain' : (analysis.dcaReturn || 0) < 0 ? 'loss' : null },
          { label: __('ivLumpReturn', 'Lump Sum Return'), value: window.MaerminI18n.pct(analysis.lumpSumReturn || 0, 2, true), color: (analysis.lumpSumReturn || 0) > 0 ? 'gain' : (analysis.lumpSumReturn || 0) < 0 ? 'loss' : null },
          { label: __('ivDifference', 'Difference'), value: window.MaerminI18n.pct(analysis.difference || 0, 2, true) },
          { label: __('ivPurchases', 'Purchases'), value: analysis.dcaPurchases || 12 }
        ]
      }),
      React.createElement('p', { className: 'ui-muted' }, analysis.interpretation || '')
    )
  );
}

// ============================================================================
// SECTOR ALLOCATION VIEW
// ============================================================================

function SectorAllocationView(props) {
  var money = useMoney();
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
  
  // R4.3: the categorical chart palette (DESIGN-SYSTEM § 6)
  var sectorColors = {
    'Technology': 'var(--chart-1)',
    'Healthcare': 'var(--chart-2)',
    'Financials': 'var(--chart-3)',
    'Consumer': 'var(--chart-4)',
    'Energy': 'var(--chart-5)',
    'Crypto': 'var(--chart-6)',
    'Gaming': 'var(--chart-1)',
    'Other': 'var(--text-faint)'
  };
  
  return React.createElement('div', { className: 'ui-stack' },
    React.createElement('h2', { className: 'ui-section-title' }, __('ivSectorAlloc', 'Sector Allocation')),

    // Coverage hint: if a meaningful share is still unclassified, point the user
    // to the Worker URL that backfills sector/country for every holding.
    sectorData.unknownPct > 15 && React.createElement('div', {
      className: 'ui-callout'
    }, __('ivUnclassified', '~{pct} of equities are unclassified. Add your Worker URL in Settings → API to auto-fetch sector & country for every holding.', { pct: window.MaerminI18n.pct(sectorData.unknownPct, 0) })),

    sectorData.sectors.length > 0 ? React.createElement('div', { className: 'ui-iv-grid' },
      React.createElement(AnalysisCard, {
        title: __('ivSectorBreakdown', 'Sector Breakdown'),
        badge: __('ivNSectors', '{n} {n:Sector|Sectors}', { n: sectorData.sectorCount })
      },
        sectorData.sectors.map(function(sector) {
          return React.createElement('div', { key: sector.name, className: 'ui-iv-bar' },
            React.createElement('div', { className: 'ui-iv-bar__head' },
              React.createElement('span', null, window.MaerminI18n.sector(sector.name)),
              React.createElement('span', { className: 'num' }, 
                window.MaerminI18n.pct(sector.weight, 1)
              )
            ),
            React.createElement('div', { 
              className: 'ui-meter'
            },
              React.createElement('div', { className: 'ui-iv-bar__fill', style: { width: sector.weight + '%', background: sectorColors[sector.name] || 'var(--chart-1)' } })
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
        sectorData.sectors[0] && sectorData.sectors[0].weight > 50 && React.createElement('div', { className: ['ui-callout', 'ui-callout--warn'].join(' ') },
          React.createElement('strong', { className: 'ui-callout__title' }, '! ' + __('ivConcWarning', 'Concentration Warning')),
          React.createElement('div', null, 
            __('ivSectorWarn', 'Over {pct} in {name}. Consider diversifying.', { pct: window.MaerminI18n.pct(50, 0), name: window.MaerminI18n.sector(sectorData.sectors[0].name) })
          )
        )
      )
    ) : window.MaerminUtils.emptyNote(__('ivNoSectorData', 'Add positions to analyse sector allocation'))
  );
}

// ============================================================================
// COUNTRY / REGION ALLOCATION VIEW  (V7 Allocation Intelligence)
// Extends the existing allocation dashboard with a geographic dimension,
// using the same AnalysisCard/MetricGrid building blocks as the sector view.
// ============================================================================

function CountryAllocationView(props) {
  var money = useMoney();
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

  var palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
  var colorFor = function(i) { return palette[i % palette.length]; };

  return React.createElement('div', { className: 'ui-stack' },
    React.createElement('h2', { className: 'ui-section-title' }, __('ivCountryAlloc', 'Country / Region Allocation')),

    data.rows.length > 0 ? React.createElement('div', { className: 'ui-iv-grid' },
      React.createElement(AnalysisCard, { title: __('ivGeoBreakdown', 'Geographic Breakdown'), badge: __('ivNRegions', '{n} {n:Region|Regions}', { n: data.count }) },
        data.rows.map(function(row, i) {
          return React.createElement('div', { key: row.name, className: 'ui-iv-bar' },
            React.createElement('div', { className: 'ui-iv-bar__head' },
              React.createElement('span', null, window.MaerminI18n.country(row.name)),
              React.createElement('span', { className: 'num' }, window.MaerminI18n.pct(row.weight, 1))),
            React.createElement('div', { className: 'ui-meter' },
              React.createElement('div', { className: 'ui-iv-bar__fill', style: { width: row.weight + '%', background: colorFor(i) } })));
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
        data.rows[0] && data.rows[0].weight > 60 && React.createElement('div', { className: ['ui-callout', 'ui-callout--warn'].join(' ') },
          React.createElement('strong', { className: 'ui-callout__title' }, '! ' + __('ivConcWarning', 'Concentration Warning')),
          React.createElement('div', null, __('ivCountryWarn', 'Over {pct} in {name}. Consider geographic diversification.', { pct: window.MaerminI18n.pct(60, 0), name: window.MaerminI18n.country(data.rows[0].name) })))
      )
    ) : React.createElement('p', { className: 'ui-muted' }, __('ivNoCountryData', 'Add positions to analyse country allocation'))
  );
}

// ============================================================================
// CURRENCY EXPOSURE VIEW
// ============================================================================

function CurrencyExposureView(props) {
  var money = useMoney();
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
  
  return React.createElement('div', { className: 'ui-stack' },
    React.createElement('h2', { className: 'ui-section-title' }, __('ivCurrencyExposure', 'Currency Exposure')),
    
    React.createElement('label', { className: 'ui-iv-inline' },
      React.createElement('span', { className: 'ui-field__label' }, __('ivBaseCurrency', 'Base Currency:')),
      React.createElement('select', {
        value: baseCurrency,
        onChange: function(e) { setBaseCurrency(e.target.value); },
        className: ['ui-input', 'ui-select', 'ui-iv-sel'].join(' ')
      },
        React.createElement('option', { value: 'EUR' }, 'EUR – ' + __('ivEuro', 'Euro')),
        React.createElement('option', { value: 'USD' }, 'USD – ' + __('ivUsDollar', 'US Dollar'))
      )
    ),
    
    React.createElement('div', { className: 'ui-iv-grid' },
      React.createElement(AnalysisCard, {
        title: __('ivCurBreakdown', 'Currency Breakdown'),
        badge: __('ivForeignPct', '{pct} foreign', { pct: window.MaerminI18n.pct(currencyData.foreignExposure, 1) }),
        badgeType: currencyData.foreignExposure > 50 ? 'warning' : 'neutral'
      },
        React.createElement(MetricGrid, {
          metrics: [
            { label: __('ivDomestic', 'Domestic ({cur})', { cur: baseCurrency }), value: window.MaerminI18n.pct(currencyData.domesticExposure, 1) },
            { label: __('ivForeign', 'Foreign'), value: window.MaerminI18n.pct(currencyData.foreignExposure, 1) },
            { label: __('ivCurrencies', 'Currencies'), value: currencyData.currencyCount },
            { label: __('ovTotalValue', 'Total Value'), value: money(currencyData.totalValue) }
          ]
        }),
        React.createElement('ul', { className: 'ui-rows' },
          Object.keys(currencyData.exposure).filter(function(c) {
            return currencyData.exposure[c].weight > 0;
          }).map(function(currency) {
            var exp = currencyData.exposure[currency];
            return React.createElement('li', { key: currency, className: 'ui-rows__row' },
              React.createElement('span', { className: 'ui-iv-v' }, currency),
              React.createElement('span', { className: 'num' }, window.MaerminI18n.pct(exp.weight, 1))
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
                tone: s.portfolioImpact >= 0 ? 'gain' : 'loss'
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
  
  var liqTone = function(score) { return score >= 60 ? 'gain' : score >= 40 ? 'warning' : 'loss'; };
  var getLiquidityColor = function(score) {
    return score >= 60 ? 'var(--gain)' : score >= 40 ? 'var(--warning)' : 'var(--loss)';
  };
  
  return React.createElement('div', { className: 'ui-stack' },
    React.createElement('h2', { className: 'ui-section-title' }, __('ivLiqAnalysis', 'Liquidity Analysis')),
    
    React.createElement('div', { className: 'ui-iv-grid' },
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
          return React.createElement('div', { key: i, className: 'ui-rows__row' },
            React.createElement('span', { className: 'ui-iv-v' }, pos.symbol),
            React.createElement('span', { className: 'ui-iv-liq' },
              React.createElement('b', { className: ['num', 'tone-' + liqTone(pos.liquidityScore)].join(' ') }, window.MaerminI18n.num(pos.liquidityScore, 0) + '/100'),
              React.createElement('span', null, liqRating(pos.liquidityRating)))
          );
        }) : window.MaerminUtils.emptyNote(__('ivNoLiqData', 'Add positions to see liquidity analysis'))
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
  var dotColor = props.state === 'behind' ? 'var(--warning)' : 'var(--gain)';
  return React.createElement('svg', { 'data-testid': 'goal-chart', viewBox: '0 0 ' + Wd + ' ' + H, role: 'img', 'aria-label': __('glPathLabel', 'Planned path to the target and today\'s value'), className: 'ui-gp' },
    React.createElement('line', { x1: padL, x2: Wd - padR, y1: y(props.target), y2: y(props.target), className: 'ui-gp__target', strokeDasharray: '4 4', strokeWidth: 1, opacity: 0.6 }),
    React.createElement('path', { d: line, fill: 'none', className: 'ui-gp__line', strokeWidth: 2 }),
    showDot ? React.createElement('circle', { cx: x(today), cy: y(props.value), r: 5, style: { fill: dotColor, stroke: 'var(--surface)' }, strokeWidth: 2 }) : null,
    React.createElement('text', { x: padL, y: H - 4, className: 'ui-gp__axis', fontSize: 12 }, window.MaerminI18n.date(path[0].date)),
    React.createElement('text', { x: Wd - padR, y: H - 4, className: 'ui-gp__axis', fontSize: 12, textAnchor: 'end' }, window.MaerminI18n.date(path[path.length - 1].date)));
}

function GoalPathCard(props) {
  var money = useMoney();
  var GP = window.MaerminGoalPath;
  var goal = GP.normalizeGoal(props.goal);
  var asOf = window.MaerminUtils.todayISO();
  var lv = GP.linkedValue(goal, props.ctx);
  var st = GP.status(goal, lv.value, { asOf: asOf });
  var path = GP.glidePath(goal);
  var badgeType = st.state === 'ahead' || st.state === 'on-track' || st.state === 'reached' ? 'positive' : st.state === 'invalid' ? 'neutral' : 'warning';
  var suggested = lv.linked ? GP.equityGlide(goal, asOf) : null;
  var actual = lv.linked ? GP.riskShare(lv.positions) : null;
  var cell = function (label, value, tid) {
    return React.createElement('div', { 'data-testid': tid },
      React.createElement('div', { className: 'ui-iv-k' }, label),
      React.createElement('div', { className: 'ui-iv-v' }, value));
  };
  var pct = function (v) { return v == null ? '–' : window.MaerminI18n.pct(v, 0); };
  return React.createElement(AnalysisCard, { title: props.goal.name, badge: goalStateLabel(st.state), badgeType: badgeType },
    React.createElement('div', { 'data-testid': 'goal-card', 'data-state': st.state },
      React.createElement('div', { className: 'ui-iv-head' },
        React.createElement('span', { className: 'ui-muted' }, money(lv.value) + ' / ' + money(goal.targetAmount) + (lv.linked ? ' · ' + props.linkLabel(goal.link) : '')),
        React.createElement('b', { className: 'num' }, window.MaerminI18n.pct(st.progressPercent, 1))),
      React.createElement(ProgressBar, { value: st.progressPercent, color: badgeType === 'warning' ? 'red' : 'green' }),
      React.createElement(GoalPathChart, { path: path, target: goal.targetAmount, value: lv.value, asOf: asOf, state: st.state }),
      React.createElement('div', { className: 'ui-iv-kv' },
        cell(__('glTargetDate', 'Target Date'), window.MaerminI18n.date(goal.targetDate)),
        cell(__('freqMonthly', 'Monthly'), money(goal.monthlyContribution)),
        cell(__('glPlannedToday', 'Planned for today'), st.planned == null ? '–' : money(st.planned), 'goal-planned'),
        cell(__('glNeeded', 'Needed a month from now'), st.requiredMonthly == null ? '–' : money(st.requiredMonthly), 'goal-needed'),
        cell(__('glProjected', 'At this pace on the date'), st.projected == null ? '–' : money(st.projected), 'goal-projected'),
        cell(__('glReturnShort', 'Expected return'), window.MaerminI18n.pct(goal.expectedReturn * 100, 1))),
      suggested != null ? React.createElement('div', { 'data-testid': 'goal-risk', className: 'ui-callout' },
        __('glRiskLine', 'Glide path for risk: about {s} in shares and other risky assets now, falling towards the date. The linked holdings have {a}.', { s: pct(suggested), a: pct(actual) }),
        actual != null && actual > suggested + 10 ? React.createElement('span', { className: 'tone-warning' }, ' ! ' + __('glRiskHigh', 'Consider moving some into bonds or cash as the date comes closer.')) : null) : null,
      React.createElement('div', { className: 'ui-actions' },
        React.createElement('button', { type: 'button', onClick: props.onDelete, className: ['ui-btn', 'ui-btn--danger', 'ui-btn--sm'].join(' ') }, __('delete', 'Delete')))));
}

// ============================================================================
// GOAL INVESTING VIEW
// ============================================================================

function GoalInvestingView(props) {
  var money = useMoney();
  
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
  
  return React.createElement('div', { className: 'ui-stack' },
    React.createElement('div', { className: 'ui-view__bar' },
      React.createElement('h2', { className: 'ui-section-title' }, __('glTitle', 'Goal-Based Investing')),
      React.createElement(window.MaerminComponents.Button, { variant: 'primary', onClick: function() { setShowAddGoal(true); } }, __('glAdd', '+ Add Goal'))
    ),
    
    showAddGoal && React.createElement(AnalysisCard, { title: __('glCreateNew', 'Create New Goal') },
      React.createElement('div', { className: ['ui-iv-form', 'is-grid'].join(' ') },
        React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('glName', 'Goal Name')),
          React.createElement('input', {
            'data-testid': 'goal-name',
            type: 'text',
            value: newGoal.name,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { name: e.target.value })); },
            placeholder: __('glNamePh', 'e.g., House Down Payment'),
            className: 'ui-input'
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('glType', 'Goal Type')),
          React.createElement('select', {
            value: newGoal.type,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { type: e.target.value })); },
            className: 'ui-input'
          },
            goalTypes.map(function(t) {
              return React.createElement('option', { key: t.id, value: t.id }, t.label);
            })
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('glTargetAmount', 'Target Amount (EUR)')),
          React.createElement('input', {
            'data-testid': 'goal-target',
            type: 'number',
            value: newGoal.targetAmount,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { targetAmount: parseFloat(e.target.value) || 0 })); },
            className: 'ui-input'
          })
        ),
        GP && React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('glLinkTo', 'Money for this goal')),
          React.createElement('select', {
            'data-testid': 'goal-link',
            value: newGoal.link,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { link: e.target.value })); },
            className: 'ui-input'
          },
            React.createElement('option', { value: '' }, __('glLinkManual', 'An amount I type in')),
            portfolios.map(function (p) { return React.createElement('option', { key: 'p' + p.id, value: 'portfolio:' + p.id }, __('glLinkedPf', 'Portfolio {name}', { name: p.name || p.id })); }),
            tagNames.map(function (n) { return React.createElement('option', { key: 't' + n, value: 'tag:' + n }, __('glLinkedTag', 'Tag {name}', { name: n })); })
          )
        ),
        !newGoal.link && React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('glCurrentSaved', 'Current Saved')),
          React.createElement('input', {
            type: 'number',
            value: newGoal.currentAmount,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { currentAmount: parseFloat(e.target.value) || 0 })); },
            className: 'ui-input'
          })
        ),
        GP && React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('glReturn', 'Expected return (% a year)')),
          React.createElement('input', {
            'data-testid': 'goal-return',
            type: 'number', step: '0.5', min: '-10', max: '20',
            value: newGoal.expectedReturn,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { expectedReturn: parseFloat(e.target.value) || 0 })); },
            className: 'ui-input'
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('glTargetDate', 'Target Date')),
          React.createElement('input', {
            type: 'date',
            value: newGoal.targetDate,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { targetDate: e.target.value })); },
            className: 'ui-input'
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { className: 'ui-field__label' }, __('monthlyContribution', 'Monthly Contribution')),
          React.createElement('input', {
            type: 'number',
            value: newGoal.monthlyContribution,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { monthlyContribution: parseFloat(e.target.value) || 0 })); },
            className: 'ui-input'
          })
        )
      ),
      React.createElement('div', { className: ['ui-actions', 'is-end'].join(' ') },
        React.createElement('button', {
          onClick: function() { setShowAddGoal(false); },
          className: ['ui-btn', 'ui-btn--secondary', 'ui-btn--md'].join(' ')
        }, __('cancel', 'Cancel')),
        React.createElement('button', {
          'data-testid': 'goal-create',
          onClick: addGoal,
          disabled: !newGoal.name || !(newGoal.targetAmount > 0),
          title: !(newGoal.targetAmount > 0) ? __('glEnterTarget', 'Enter a target amount above 0') : undefined,
          className: ['ui-btn', 'ui-btn--primary', 'ui-btn--md'].join(' ')
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
        React.createElement('div', { className: 'ui-iv-head' },
          React.createElement('span', { className: 'ui-muted' }, 
            money(goal.currentAmount) + ' / ' + money(goal.targetAmount)
          ),
          React.createElement('b', { className: 'num' },
            window.MaerminI18n.pct(progress.progressPercent, 1)
          )
        ),
        React.createElement(ProgressBar, { 
          value: progress.progressPercent, 
          color: progress.onTrack ? 'green' : 'red' 
        }),
        React.createElement('div', { className: ['ui-iv-kv', 'is-row'].join(' ') },
          React.createElement('div', null,
            React.createElement('div', { className: 'ui-iv-k' }, __('glTargetDate', 'Target Date')),
            React.createElement('div', { className: 'ui-iv-v' }, window.MaerminI18n.date(goal.targetDate))
          ),
          React.createElement('div', null,
            React.createElement('div', { className: 'ui-iv-k' }, __('freqMonthly', 'Monthly')),
            React.createElement('div', { className: 'ui-iv-v' }, money(goal.monthlyContribution))
          ),
          React.createElement('div', null,
            React.createElement('div', { className: 'ui-iv-k' }, __('glRemaining', 'Remaining')),
            React.createElement('div', { className: 'ui-iv-v' }, money(Math.max(0, goal.targetAmount - goal.currentAmount)))
          ),
          React.createElement('button', {
            onClick: function() {
              var U = (typeof window !== 'undefined') && window.MaerminUtils;
              if (U && U.confirmThen) U.confirmThen({ title: __('glDeleteTitle', 'Delete the goal "{name}"?', { name: goal.name }), confirmLabel: __('delete', 'Delete') }, function() { deleteGoal(goal.id); });
            },
            type: 'button', className: ['ui-btn', 'ui-btn--danger', 'ui-btn--sm'].join(' ')
          }, __('delete', 'Delete'))
        )
      );
    }),
    
    goals.length === 0 && !showAddGoal && window.MaerminUtils.emptyNote(__('glEmpty', 'No goals yet. Click "+ Add Goal" to create your first investment goal.'))
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
    { id: 'sectors',  label: __('ivSectors', 'Sectors'),          desc: __('ivTabSectorsDesc', 'Analyse sector allocation') },
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

  var renderSectionRaw = function() {
    switch(activeSection) {
      case 'dca':      return React.createElement(DCAAnalyzerView, { portfolio: portfolio, priceHistory: dcaHistory });
      case 'sectors':  return React.createElement(SectorAllocationView, { portfolio: portfolio, prices: prices, metaVersion: props.metaVersion });
      case 'countries':return React.createElement(CountryAllocationView, { portfolio: portfolio, prices: prices, metaVersion: props.metaVersion });
      case 'currency': return React.createElement(CurrencyExposureView, { portfolio: portfolio });
      case 'size':     return window.MaerminMarketCap
        ? React.createElement(window.MaerminMarketCap.Panel, { portfolio: portfolio, prices: prices, theme: theme, t: props.t, formatPrice: props.formatPrice, workerUrl: props.workerUrl, exchangeRate: props.exchangeRate })
        : window.MaerminUtils.errorNote(__('ivMcapUnavailable', 'Market-cap module unavailable'));
      case 'liquidity':return React.createElement(LiquidityAnalysisView, { portfolio: portfolio });
      case 'goals':    return React.createElement(GoalInvestingView, { portfolioValue: portfolioValue, transactions: props.transactions, prices: prices, portfolios: props.portfolios });
      case 'providers': return typeof props.renderProviders === 'function' ? props.renderProviders() : null;
      case 'taxonomies': return typeof props.renderTaxonomies === 'function' ? props.renderTaxonomies() : null;
      default:         return React.createElement(DCAAnalyzerView, { portfolio: portfolio, priceHistory: dcaHistory });
    }
  };
  // Every section formats amounts through the app's formatter (FINDINGS M-12).
  // Colours come from the CSS tokens (ui-* classes), so no theme is passed down.
  var fp = props.formatPrice, sym = typeof props.getCurrencySymbol === 'function' ? props.getCurrencySymbol() : '€';
  var money = typeof fp === 'function' ? function(v) { return fp(Number(v) || 0) + ' ' + sym; } : null;
  var renderSection = function() {
    return React.createElement(MoneyCtx.Provider, { value: money }, renderSectionRaw());
  };

  
  return React.createElement('div', { className: 'ui-iv' },
    // Sections (R2.2, B-3): a segmented control, a select on phones
    React.createElement('div', { className: 'ui-subbar' },
      React.createElement(window.MaerminComponents.SectionSwitch, {
        label: __('navStrategy', 'Strategy'), value: activeSection, onChange: setActiveSection, 'data-testid': 'iv-sections',
        options: sections.map(function(s) { return { value: s.id, label: s.label }; })
      })
    ),
    React.createElement('div', { className: 'ui-view', 'data-testid': 'iv-section' }, renderSection())
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
  MoneyContext: MoneyCtx,
  goalProgress: goalProgress
};


})();
