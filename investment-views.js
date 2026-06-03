// ============================================================================
// MAERMIN v7.0 - Investment Analysis Views (FIXED)
// UI Components for Investment Engines
// ============================================================================

(function() {
'use strict';

var useState = React.useState;
var useEffect = React.useEffect;
var useMemo = React.useMemo;

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

function AnalysisCard(props) {
  var title = props.title;
  var badge = props.badge;
  var badgeType = props.badgeType || 'neutral';
  var children = props.children;
  
  return React.createElement('div', {
    style: {
      background: 'rgba(255,255,255,0.035)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '16px',
      padding: '1.5rem',
      marginBottom: '1rem',
      boxShadow: '0 18px 40px -18px rgba(0,0,0,0.6)'
    }
  },
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        paddingBottom: '0.75rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)'
      }
    },
      React.createElement('span', {
        style: { fontSize: '1.1rem', fontWeight: '650', letterSpacing: '-0.01em', color: 'white' }
      }, title),
      badge && React.createElement('span', { 
        style: {
          padding: '0.25rem 0.75rem',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: '600',
          background: badgeType === 'positive' ? 'rgba(34,197,94,0.2)' : 
                     badgeType === 'negative' ? 'rgba(239,68,68,0.2)' :
                     badgeType === 'warning' ? 'rgba(245,158,11,0.2)' : 'rgba(148,163,184,0.2)',
          color: badgeType === 'positive' ? '#22c55e' : 
                badgeType === 'negative' ? '#ef4444' :
                badgeType === 'warning' ? '#f59e0b' : '#94a3b8'
        }
      }, badge)
    ),
    children
  );
}

function MetricGrid(props) {
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
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '12px'
        }
      },
        React.createElement('div', {
          style: { fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em', color: m.color || 'white' }
        }, m.value),
        React.createElement('div', {
          style: {
            fontSize: '0.72rem',
            color: 'rgba(255,255,255,0.6)',
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
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              color: '#f5a524',
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
            var cellStyle = { padding: '0.75rem', color: 'rgba(255,255,255,0.9)', borderBottom: '1px solid rgba(255,255,255,0.05)' };
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
  var value = props.value || 0;
  var color = props.color || 'purple';
  
  var colorMap = {
    green: '#22c55e',
    red: '#ef4444',
    blue: '#3b82f6',
    purple: '#f5a524'
  };
  
  return React.createElement('div', { 
    style: { 
      height: '8px',
      background: 'rgba(255,255,255,0.1)',
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

function TabBar(props) {
  var tabs = props.tabs || [];
  var active = props.active;
  var onChange = props.onChange;
  
  return React.createElement('div', { 
    style: {
      display: 'flex',
      gap: '0.25rem',
      padding: '0.25rem',
      background: 'rgba(0,0,0,0.2)',
      borderRadius: '8px',
      marginBottom: '1rem',
      flexWrap: 'wrap'
    }
  },
    tabs.map(function(tab) {
      var isActive = active === tab.id;
      return React.createElement('button', {
        key: tab.id,
        onClick: function() { onChange(tab.id); },
        style: {
          padding: '0.5rem 1rem',
          background: isActive ? 'rgba(245,165,36,0.3)' : 'transparent',
          border: 'none',
          color: isActive ? 'white' : 'rgba(255,255,255,0.6)',
          cursor: 'pointer',
          borderRadius: '6px',
          fontSize: '0.875rem',
          transition: 'all 0.2s'
        }
      }, tab.label);
    })
  );
}

// ============================================================================
// DCA ANALYZER VIEW
// ============================================================================

function DCAAnalyzerView(props) {
  var portfolio = props.portfolio || {};
  var priceHistory = props.priceHistory || {};
  
  var _activeTab = useState('comparison');
  var activeTab = _activeTab[0];
  var setActiveTab = _activeTab[1];
  
  var _investAmount = useState(10000);
  var investAmount = _investAmount[0];
  var setInvestAmount = _investAmount[1];
  
  var _frequency = useState('monthly');
  var frequency = _frequency[0];
  var setFrequency = _frequency[1];
  
  var _analysis = useState(null);
  var analysis = _analysis[0];
  var setAnalysis = _analysis[1];
  
  // Convert priceHistory object to array for first asset
  var priceArray = useMemo(function() {
    var keys = Object.keys(priceHistory);
    if (keys.length === 0) return [];
    var firstKey = keys[0];
    var history = priceHistory[firstKey];
    if (!Array.isArray(history)) return [];
    return history.map(function(h) { return h.price || h; });
  }, [priceHistory]);
  
  useEffect(function() {
    if (window.DCAAnalyzerEngine && priceArray.length > 30) {
      var result = window.DCAAnalyzerEngine.compareDCAvsLumpSum(investAmount, priceArray, {
        dcaPeriods: 12,
        dcaFrequency: frequency
      });
      if (result && !result.error) {
        setAnalysis({
          winner: result.comparison.winner,
          dcaReturn: result.dca.return,
          lumpSumReturn: result.lumpSum.return,
          difference: result.comparison.difference,
          dcaPurchases: result.dca.purchases.length,
          interpretation: result.comparison.winner === 'dca' 
            ? 'DCA outperformed by ' + result.comparison.difference.toFixed(2) + '% due to buying at lower average prices'
            : 'Lump sum outperformed by ' + result.comparison.difference.toFixed(2) + '% due to market appreciation'
        });
      }
    } else {
      // Demo mode with simulated data
      setAnalysis({
        winner: 'dca',
        dcaReturn: 12.5,
        lumpSumReturn: 10.2,
        difference: 2.3,
        dcaPurchases: 12,
        interpretation: 'Demo: DCA typically reduces risk through averaging. Add price history for real analysis.'
      });
    }
  }, [investAmount, frequency, priceArray]);
  
  var tabs = [
    { id: 'comparison', label: 'DCA vs Lump Sum' },
    { id: 'schedule', label: 'DCA Schedule' },
    { id: 'projection', label: 'Projection' }
  ];
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: 'white', marginBottom: '1rem' } }, 'DCA Strategy Analyzer'),
    
    React.createElement('div', { style: { display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' } },
      React.createElement('div', null,
        React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, 'Investment Amount'),
        React.createElement('input', {
          type: 'number',
          value: investAmount,
          onChange: function(e) { setInvestAmount(parseFloat(e.target.value) || 0); },
          style: {
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '6px',
            padding: '0.5rem',
            color: 'white',
            width: '150px'
          }
        })
      ),
      React.createElement('div', null,
        React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, 'Frequency'),
        React.createElement('select', {
          value: frequency,
          onChange: function(e) { setFrequency(e.target.value); },
          style: {
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '6px',
            padding: '0.5rem',
            color: 'white'
          }
        },
          React.createElement('option', { value: 'weekly' }, 'Weekly'),
          React.createElement('option', { value: 'biweekly' }, 'Bi-Weekly'),
          React.createElement('option', { value: 'monthly' }, 'Monthly'),
          React.createElement('option', { value: 'quarterly' }, 'Quarterly')
        )
      )
    ),
    
    React.createElement(TabBar, { tabs: tabs, active: activeTab, onChange: setActiveTab }),
    
    analysis && React.createElement(AnalysisCard, {
      title: 'Strategy Comparison',
      badge: analysis.winner === 'dca' ? 'DCA Wins' : 'Lump Sum Wins',
      badgeType: 'positive'
    },
      React.createElement(MetricGrid, {
        metrics: [
          { label: 'DCA Return', value: (analysis.dcaReturn || 0).toFixed(2) + '%', color: '#22c55e' },
          { label: 'Lump Sum Return', value: (analysis.lumpSumReturn || 0).toFixed(2) + '%', color: '#3b82f6' },
          { label: 'Difference', value: (analysis.difference || 0).toFixed(2) + '%', color: '#f59e0b' },
          { label: 'Purchases', value: analysis.dcaPurchases || 12 }
        ]
      }),
      React.createElement('p', {
        style: { marginTop: '1rem', color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem' }
      }, analysis.interpretation || '')
    )
  );
}

// ============================================================================
// DIVIDEND TRACKER VIEW
// ============================================================================

function DividendTrackerView(props) {
  var portfolio = props.portfolio || {};
  
  var _activeTab = useState('income');
  var activeTab = _activeTab[0];
  var setActiveTab = _activeTab[1];
  
  var _dripYears = useState(10);
  var dripYears = _dripYears[0];
  var setDripYears = _dripYears[1];
  
  // Calculate dividend data from stock positions
  var dividendData = useMemo(function() {
    var stocks = portfolio.stocks || [];
    if (stocks.length === 0) {
      // Demo data
      return {
        positions: [
          { symbol: 'AAPL', shares: 10, yield: 0.5, annualDividend: 5.00 },
          { symbol: 'MSFT', shares: 15, yield: 0.8, annualDividend: 12.00 },
          { symbol: 'JNJ', shares: 20, yield: 2.9, annualDividend: 58.00 }
        ],
        totalAnnualDividend: 75.00,
        monthlyAverage: 6.25,
        averageYield: 1.4
      };
    }
    
    var dividendYields = {
      'AAPL': 0.5, 'MSFT': 0.8, 'JNJ': 2.9, 'KO': 3.1, 'PG': 2.5,
      'VZ': 6.5, 'T': 5.8, 'XOM': 3.4, 'CVX': 3.8, 'IBM': 4.5
    };
    
    var positions = [];
    var totalAnnual = 0;
    var totalYield = 0;
    var count = 0;
    
    stocks.forEach(function(stock) {
      var symbol = (stock.symbol || stock.name || '').toUpperCase();
      var yld = dividendYields[symbol] || 0;
      if (yld > 0) {
        var shares = stock.amount || 0;
        var price = stock.currentPrice || stock.purchasePrice || 100;
        var annual = shares * price * (yld / 100);
        positions.push({
          symbol: symbol,
          shares: shares,
          yield: yld,
          annualDividend: annual
        });
        totalAnnual += annual;
        totalYield += yld;
        count++;
      }
    });
    
    return {
      positions: positions,
      totalAnnualDividend: totalAnnual,
      monthlyAverage: totalAnnual / 12,
      averageYield: count > 0 ? totalYield / count : 0
    };
  }, [portfolio]);
  
  var tabs = [
    { id: 'income', label: 'Income Summary' },
    { id: 'calendar', label: 'Dividend Calendar' },
    { id: 'drip', label: 'DRIP Simulator' }
  ];
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: 'white', marginBottom: '1rem' } }, 'Dividend Tracker'),
    
    React.createElement(TabBar, { tabs: tabs, active: activeTab, onChange: setActiveTab }),
    
    activeTab === 'income' && React.createElement(AnalysisCard, {
      title: 'Annual Dividend Income',
      badge: dividendData.totalAnnualDividend.toFixed(2) + ' EUR',
      badgeType: 'positive'
    },
      React.createElement(MetricGrid, {
        metrics: [
          { label: 'Annual Income', value: dividendData.totalAnnualDividend.toFixed(2) + ' EUR', color: '#22c55e' },
          { label: 'Monthly Avg', value: dividendData.monthlyAverage.toFixed(2) + ' EUR' },
          { label: 'Avg Yield', value: dividendData.averageYield.toFixed(2) + '%' },
          { label: 'Positions', value: dividendData.positions.length }
        ]
      }),
      dividendData.positions.length > 0 && React.createElement('div', { style: { marginTop: '1rem' } },
        React.createElement(DataTable, {
          headers: ['Symbol', 'Shares', 'Yield', 'Annual'],
          rows: dividendData.positions.slice(0, 10).map(function(p) {
            return [
              p.symbol,
              p.shares.toFixed(2),
              p.yield.toFixed(2) + '%',
              { value: p.annualDividend.toFixed(2) + ' EUR', style: { color: '#22c55e' } }
            ];
          })
        })
      )
    ),
    
    activeTab === 'drip' && React.createElement(AnalysisCard, {
      title: 'DRIP Projection',
      badge: dripYears + ' Years'
    },
      React.createElement('div', { style: { marginBottom: '1rem' } },
        React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem' } }, 'Projection Years: '),
        React.createElement('input', {
          type: 'range',
          min: 5,
          max: 30,
          value: dripYears,
          onChange: function(e) { setDripYears(parseInt(e.target.value)); },
          style: { width: '200px', marginLeft: '0.5rem' }
        }),
        React.createElement('span', { style: { color: 'white', marginLeft: '0.5rem' } }, dripYears)
      ),
      React.createElement(MetricGrid, {
        metrics: [
          { label: 'Starting Income', value: dividendData.totalAnnualDividend.toFixed(2) + ' EUR' },
          { label: 'Projected Income', value: (dividendData.totalAnnualDividend * Math.pow(1.05, dripYears)).toFixed(2) + ' EUR', color: '#22c55e' },
          { label: 'Growth (5% CAGR)', value: (Math.pow(1.05, dripYears) * 100 - 100).toFixed(0) + '%' },
          { label: 'Total Collected', value: (dividendData.totalAnnualDividend * ((Math.pow(1.05, dripYears) - 1) / 0.05)).toFixed(0) + ' EUR' }
        ]
      })
    ),
    
    activeTab === 'calendar' && React.createElement(AnalysisCard, {
      title: 'Upcoming Dividends'
    },
      React.createElement('p', { style: { color: 'rgba(255,255,255,0.6)' } }, 
        'Dividend calendar shows upcoming ex-dividend dates. Add dividend-paying stocks to see schedule.'
      ),
      dividendData.positions.length > 0 && React.createElement(DataTable, {
        headers: ['Symbol', 'Frequency', 'Next Payment'],
        rows: dividendData.positions.slice(0, 5).map(function(p) {
          return [p.symbol, 'Quarterly', 'Est. next quarter'];
        })
      })
    )
  );
}

// ============================================================================
// SECTOR ALLOCATION VIEW
// ============================================================================

function SectorAllocationView(props) {
  var portfolio = props.portfolio || {};
  
  var sectorData = useMemo(function() {
    var sectors = {};
    var totalValue = 0;
    
    var sectorMap = {
      'AAPL': 'Technology', 'MSFT': 'Technology', 'GOOGL': 'Technology', 'NVDA': 'Technology',
      'JNJ': 'Healthcare', 'PFE': 'Healthcare', 'UNH': 'Healthcare',
      'JPM': 'Financials', 'BAC': 'Financials', 'V': 'Financials',
      'AMZN': 'Consumer', 'TSLA': 'Consumer', 'HD': 'Consumer',
      'XOM': 'Energy', 'CVX': 'Energy',
      'bitcoin': 'Crypto', 'ethereum': 'Crypto', 'solana': 'Crypto'
    };
    
    // Process stocks
    (portfolio.stocks || []).forEach(function(pos) {
      var symbol = (pos.symbol || pos.name || '').toUpperCase();
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      var sector = sectorMap[symbol] || 'Other';
      if (!sectors[sector]) sectors[sector] = 0;
      sectors[sector] += value;
      totalValue += value;
    });
    
    // Process crypto
    (portfolio.crypto || []).forEach(function(pos) {
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      if (!sectors['Crypto']) sectors['Crypto'] = 0;
      sectors['Crypto'] += value;
      totalValue += value;
    });
    
    // Process skins
    (portfolio.skins || []).forEach(function(pos) {
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      if (!sectors['Gaming']) sectors['Gaming'] = 0;
      sectors['Gaming'] += value;
      totalValue += value;
    });
    
    // Convert to array with percentages
    var sectorArray = Object.keys(sectors).map(function(name) {
      return {
        name: name,
        value: sectors[name],
        weight: totalValue > 0 ? (sectors[name] / totalValue) * 100 : 0
      };
    }).filter(function(s) { return s.weight > 0; })
      .sort(function(a, b) { return b.weight - a.weight; });
    
    return {
      sectors: sectorArray,
      totalValue: totalValue,
      sectorCount: sectorArray.length
    };
  }, [portfolio]);
  
  var sectorColors = {
    'Technology': '#3b82f6',
    'Healthcare': '#22c55e',
    'Financials': '#f59e0b',
    'Consumer': '#ec4899',
    'Energy': '#ef4444',
    'Crypto': '#f97316',
    'Gaming': '#f5a524',
    'Other': '#6b7280'
  };
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: 'white', marginBottom: '1rem' } }, 'Sector Allocation'),
    
    sectorData.sectors.length > 0 ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
      React.createElement(AnalysisCard, {
        title: 'Sector Breakdown',
        badge: sectorData.sectorCount + ' Sectors'
      },
        sectorData.sectors.map(function(sector) {
          return React.createElement('div', { 
            key: sector.name,
            style: { marginBottom: '0.75rem' }
          },
            React.createElement('div', { 
              style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }
            },
              React.createElement('span', { style: { color: 'white', fontSize: '0.875rem' } }, sector.name),
              React.createElement('span', { style: { color: sectorColors[sector.name] || '#f5a524' } }, 
                sector.weight.toFixed(1) + '%'
              )
            ),
            React.createElement('div', { 
              style: { height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' }
            },
              React.createElement('div', {
                style: { 
                  height: '100%',
                  width: sector.weight + '%',
                  background: sectorColors[sector.name] || '#f5a524',
                  borderRadius: '4px'
                }
              })
            )
          );
        })
      ),
      
      React.createElement(AnalysisCard, {
        title: 'Concentration Analysis',
        badge: sectorData.sectorCount < 3 ? 'High Risk' : sectorData.sectorCount < 5 ? 'Moderate' : 'Diversified',
        badgeType: sectorData.sectorCount < 3 ? 'warning' : 'positive'
      },
        React.createElement(MetricGrid, {
          metrics: [
            { label: 'Sectors', value: sectorData.sectorCount },
            { label: 'Top Sector', value: sectorData.sectors[0] ? sectorData.sectors[0].name : 'N/A' },
            { label: 'Top Weight', value: sectorData.sectors[0] ? sectorData.sectors[0].weight.toFixed(1) + '%' : '0%' },
            { label: 'Total Value', value: sectorData.totalValue.toFixed(0) + ' EUR' }
          ]
        }),
        sectorData.sectors[0] && sectorData.sectors[0].weight > 50 && React.createElement('div', {
          style: { marginTop: '1rem', padding: '0.75rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px' }
        },
          React.createElement('div', { style: { color: '#ef4444', fontWeight: '600', marginBottom: '0.5rem' } }, 'Concentration Warning'),
          React.createElement('div', { style: { color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem' } }, 
            'Over 50% in ' + sectorData.sectors[0].name + '. Consider diversifying.'
          )
        )
      )
    ) : React.createElement('div', {
      style: { color: 'rgba(255,255,255,0.5)', padding: '2rem', textAlign: 'center' }
    }, 'Add positions to analyze sector allocation')
  );
}

// ============================================================================
// COUNTRY / REGION ALLOCATION VIEW  (V7 Allocation Intelligence)
// Extends the existing allocation dashboard with a geographic dimension,
// using the same AnalysisCard/MetricGrid building blocks as the sector view.
// ============================================================================

function CountryAllocationView(props) {
  var portfolio = props.portfolio || {};

  var data = useMemo(function() {
    // Lightweight static ticker -> country map. Unknown stocks fall back to
    // "Other"; crypto and CS2 items are borderless, so they get a global bucket.
    var countryMap = {
      'AAPL': 'USA', 'MSFT': 'USA', 'GOOGL': 'USA', 'GOOG': 'USA', 'NVDA': 'USA', 'AMZN': 'USA',
      'TSLA': 'USA', 'META': 'USA', 'JNJ': 'USA', 'PFE': 'USA', 'UNH': 'USA', 'KO': 'USA',
      'JPM': 'USA', 'BAC': 'USA', 'V': 'USA', 'HD': 'USA', 'XOM': 'USA', 'CVX': 'USA',
      'DIS': 'USA', 'NFLX': 'USA', 'AMD': 'USA', 'INTC': 'USA', 'PG': 'USA', 'MA': 'USA',
      'SAP': 'Germany', 'SIE': 'Germany', 'ALV': 'Germany', 'BMW': 'Germany', 'BAS': 'Germany',
      'VOW3': 'Germany', 'DTE': 'Germany', 'MBG': 'Germany', 'IFX': 'Germany',
      'ASML': 'Netherlands', 'ADYEN': 'Netherlands',
      'MC': 'France', 'OR': 'France', 'AIR': 'France', 'TTE': 'France',
      'NESN': 'Switzerland', 'ROG': 'Switzerland', 'NOVN': 'Switzerland',
      'AZN': 'UK', 'HSBA': 'UK', 'SHEL': 'UK', 'BP': 'UK', 'ULVR': 'UK',
      'BABA': 'China', 'TCEHY': 'China', 'NIO': 'China',
      'TSM': 'Taiwan', 'SONY': 'Japan', 'TM': 'Japan'
    };

    var buckets = {};
    var totalValue = 0;
    function add(country, value) { if (!buckets[country]) buckets[country] = 0; buckets[country] += value; totalValue += value; }

    (portfolio.stocks || []).forEach(function(pos) {
      var symbol = (pos.symbol || pos.name || '').toUpperCase();
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      add(countryMap[symbol] || 'Other', value);
    });
    (portfolio.crypto || []).forEach(function(pos) {
      add('Global (Crypto)', (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0));
    });
    (portfolio.skins || []).forEach(function(pos) {
      add('Global (Gaming)', (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0));
    });

    var rows = Object.keys(buckets).map(function(name) {
      return { name: name, value: buckets[name], weight: totalValue > 0 ? (buckets[name] / totalValue) * 100 : 0 };
    }).filter(function(r) { return r.weight > 0; }).sort(function(a, b) { return b.weight - a.weight; });

    return { rows: rows, totalValue: totalValue, count: rows.length };
  }, [portfolio]);

  var palette = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#ef4444', '#f97316', '#f5a524', '#06b6d4', '#6b7280'];
  var colorFor = function(i) { return palette[i % palette.length]; };

  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: 'white', marginBottom: '1rem' } }, 'Country / Region Allocation'),

    data.rows.length > 0 ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
      React.createElement(AnalysisCard, { title: 'Geographic Breakdown', badge: data.count + ' Regions' },
        data.rows.map(function(row, i) {
          return React.createElement('div', { key: row.name, style: { marginBottom: '0.75rem' } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' } },
              React.createElement('span', { style: { color: 'white', fontSize: '0.875rem' } }, row.name),
              React.createElement('span', { style: { color: colorFor(i) } }, row.weight.toFixed(1) + '%')),
            React.createElement('div', { style: { height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden' } },
              React.createElement('div', { style: { height: '100%', width: row.weight + '%', background: colorFor(i), borderRadius: '4px' } })));
        })
      ),
      React.createElement(AnalysisCard, {
        title: 'Concentration Analysis',
        badge: data.count < 2 ? 'High Risk' : data.count < 4 ? 'Moderate' : 'Diversified',
        badgeType: data.count < 2 ? 'warning' : 'positive'
      },
        React.createElement(MetricGrid, { metrics: [
          { label: 'Regions', value: data.count },
          { label: 'Top Region', value: data.rows[0] ? data.rows[0].name : 'N/A' },
          { label: 'Top Weight', value: data.rows[0] ? data.rows[0].weight.toFixed(1) + '%' : '0%' },
          { label: 'Total Value', value: data.totalValue.toFixed(0) + ' EUR' }
        ] }),
        data.rows[0] && data.rows[0].weight > 60 && React.createElement('div', { style: { marginTop: '1rem', padding: '0.75rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px' } },
          React.createElement('div', { style: { color: '#ef4444', fontWeight: '600', marginBottom: '0.5rem' } }, 'Concentration Warning'),
          React.createElement('div', { style: { color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem' } }, 'Over 60% in ' + data.rows[0].name + '. Consider geographic diversification.'))
      )
    ) : React.createElement('div', { style: { color: 'rgba(255,255,255,0.5)', padding: '2rem', textAlign: 'center' } }, 'Add positions to analyze country allocation')
  );
}

// ============================================================================
// CURRENCY EXPOSURE VIEW
// ============================================================================

function CurrencyExposureView(props) {
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
    { scenario: 'EUR +10%', portfolioImpact: -(currencyData.foreignExposure * 0.1) },
    { scenario: 'EUR -10%', portfolioImpact: currencyData.foreignExposure * 0.1 },
    { scenario: 'USD +10%', portfolioImpact: (currencyData.exposure['USD'] ? currencyData.exposure['USD'].weight : 0) * 0.1 },
    { scenario: 'USD -10%', portfolioImpact: -(currencyData.exposure['USD'] ? currencyData.exposure['USD'].weight : 0) * 0.1 }
  ];
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: 'white', marginBottom: '1rem' } }, 'Currency Exposure'),
    
    React.createElement('div', { style: { marginBottom: '1rem' } },
      React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', marginRight: '0.5rem' } }, 'Base Currency:'),
      React.createElement('select', {
        value: baseCurrency,
        onChange: function(e) { setBaseCurrency(e.target.value); },
        style: {
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: '6px',
          padding: '0.5rem',
          color: 'white'
        }
      },
        React.createElement('option', { value: 'EUR' }, 'EUR - Euro'),
        React.createElement('option', { value: 'USD' }, 'USD - US Dollar')
      )
    ),
    
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
      React.createElement(AnalysisCard, {
        title: 'Currency Breakdown',
        badge: currencyData.foreignExposure.toFixed(1) + '% Foreign',
        badgeType: currencyData.foreignExposure > 50 ? 'warning' : 'neutral'
      },
        React.createElement(MetricGrid, {
          metrics: [
            { label: 'Domestic (' + baseCurrency + ')', value: currencyData.domesticExposure.toFixed(1) + '%', color: '#22c55e' },
            { label: 'Foreign', value: currencyData.foreignExposure.toFixed(1) + '%', color: '#f59e0b' },
            { label: 'Currencies', value: currencyData.currencyCount },
            { label: 'Total Value', value: currencyData.totalValue.toFixed(0) + ' EUR' }
          ]
        }),
        React.createElement('div', { style: { marginTop: '1rem' } },
          Object.keys(currencyData.exposure).filter(function(c) {
            return currencyData.exposure[c].weight > 0;
          }).map(function(currency) {
            var exp = currencyData.exposure[currency];
            return React.createElement('div', {
              key: currency,
              style: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }
            },
              React.createElement('span', { style: { color: 'white' } }, currency),
              React.createElement('span', { style: { color: currency === baseCurrency ? '#22c55e' : '#f59e0b' } }, 
                exp.weight.toFixed(1) + '%'
              )
            );
          })
        )
      ),
      
      React.createElement(AnalysisCard, {
        title: 'FX Scenario Analysis',
        badge: 'Stress Tests'
      },
        React.createElement(DataTable, {
          headers: ['Scenario', 'Impact'],
          rows: scenarios.map(function(s) {
            return [
              s.scenario,
              {
                value: (s.portfolioImpact >= 0 ? '+' : '') + s.portfolioImpact.toFixed(2) + '%',
                style: { color: s.portfolioImpact >= 0 ? '#22c55e' : '#ef4444' }
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

function LiquidityAnalysisView(props) {
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
    React.createElement('h2', { style: { color: 'white', marginBottom: '1rem' } }, 'Liquidity Analysis'),
    
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
      React.createElement(AnalysisCard, {
        title: 'Portfolio Liquidity',
        badge: liquidityData.portfolioLiquidityRating,
        badgeType: liquidityData.portfolioLiquidityScore >= 60 ? 'positive' : 'warning'
      },
        React.createElement(MetricGrid, {
          metrics: [
            { label: 'Liquidity Score', value: liquidityData.portfolioLiquidityScore.toFixed(0) + '/100', color: getLiquidityColor(liquidityData.portfolioLiquidityScore) },
            { label: 'Est. Cost', value: liquidityData.costToLiquidatePercent.toFixed(2) + '%' },
            { label: 'Positions', value: liquidityData.positions.length },
            { label: 'Total Value', value: liquidityData.totalValue.toFixed(0) + ' EUR' }
          ]
        })
      ),
      
      React.createElement(AnalysisCard, {
        title: 'Least Liquid Positions',
        badge: 'Watch List'
      },
        liquidityData.leastLiquid.length > 0 ? liquidityData.leastLiquid.map(function(pos, i) {
          return React.createElement('div', {
            key: i,
            style: { 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              padding: '0.5rem 0',
              borderBottom: '1px solid rgba(255,255,255,0.1)'
            }
          },
            React.createElement('span', { style: { color: 'white' } }, pos.symbol),
            React.createElement('div', { style: { display: 'flex', gap: '1rem', alignItems: 'center' } },
              React.createElement('span', { 
                style: { color: getLiquidityColor(pos.liquidityScore), fontSize: '0.875rem' } 
              }, pos.liquidityScore.toFixed(0) + '/100'),
              React.createElement('span', { 
                style: { color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' } 
              }, pos.liquidityRating)
            )
          );
        }) : React.createElement('p', { style: { color: 'rgba(255,255,255,0.5)' } }, 'Add positions to see liquidity analysis')
      )
    )
  );
}

// ============================================================================
// GOAL INVESTING VIEW
// ============================================================================

function GoalInvestingView(props) {
  var portfolioValue = props.portfolioValue || 0;
  
  var _goals = useState([]);
  var goals = _goals[0];
  var setGoals = _goals[1];
  
  var _showAddGoal = useState(false);
  var showAddGoal = _showAddGoal[0];
  var setShowAddGoal = _showAddGoal[1];
  
  var _newGoal = useState({
    name: '',
    type: 'retirement',
    targetAmount: 100000,
    currentAmount: 0,
    targetDate: '2035-01-01',
    monthlyContribution: 500
  });
  var newGoal = _newGoal[0];
  var setNewGoal = _newGoal[1];
  
  // Load goals from localStorage
  useEffect(function() {
    var saved = localStorage.getItem('investmentGoals');
    if (saved) {
      try {
        setGoals(JSON.parse(saved));
      } catch (e) {
        setGoals([]);
      }
    }
  }, []);
  
  // Save goals to localStorage
  useEffect(function() {
    if (goals.length > 0) {
      localStorage.setItem('investmentGoals', JSON.stringify(goals));
    }
  }, [goals]);
  
  var addGoal = function() {
    if (!newGoal.name) return;
    
    var goal = {
      id: Date.now().toString(),
      name: newGoal.name,
      type: newGoal.type,
      targetAmount: newGoal.targetAmount,
      currentAmount: newGoal.currentAmount,
      targetDate: newGoal.targetDate,
      monthlyContribution: newGoal.monthlyContribution,
      createdAt: new Date().toISOString()
    };
    
    setGoals(goals.concat([goal]));
    setShowAddGoal(false);
    setNewGoal({
      name: '',
      type: 'retirement',
      targetAmount: 100000,
      currentAmount: 0,
      targetDate: '2035-01-01',
      monthlyContribution: 500
    });
  };
  
  var deleteGoal = function(goalId) {
    setGoals(goals.filter(function(g) { return g.id !== goalId; }));
  };
  
  var calculateProgress = function(goal) {
    var progress = (goal.currentAmount / goal.targetAmount) * 100;
    var targetDate = new Date(goal.targetDate);
    var now = new Date();
    var monthsRemaining = Math.max(0, (targetDate - now) / (1000 * 60 * 60 * 24 * 30));
    var requiredMonthly = monthsRemaining > 0 ? (goal.targetAmount - goal.currentAmount) / monthsRemaining : 0;
    var onTrack = goal.monthlyContribution >= requiredMonthly;
    
    return {
      progressPercent: Math.min(100, progress),
      onTrack: onTrack,
      monthsRemaining: Math.round(monthsRemaining),
      requiredMonthly: requiredMonthly
    };
  };
  
  var goalTypes = [
    { id: 'retirement', label: 'Retirement' },
    { id: 'house', label: 'House' },
    { id: 'education', label: 'Education' },
    { id: 'emergency', label: 'Emergency Fund' },
    { id: 'vacation', label: 'Vacation' },
    { id: 'custom', label: 'Custom' }
  ];
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
      React.createElement('h2', { style: { color: 'white' } }, 'Goal-Based Investing'),
      React.createElement('button', {
        onClick: function() { setShowAddGoal(true); },
        style: {
          background: '#f5a524',
          color: 'white',
          border: 'none',
          padding: '0.5rem 1rem',
          borderRadius: '6px',
          cursor: 'pointer'
        }
      }, '+ Add Goal')
    ),
    
    showAddGoal && React.createElement(AnalysisCard, { title: 'Create New Goal' },
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' } },
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, 'Goal Name'),
          React.createElement('input', {
            type: 'text',
            value: newGoal.name,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { name: e.target.value })); },
            placeholder: 'e.g., House Down Payment',
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, 'Goal Type'),
          React.createElement('select', {
            value: newGoal.type,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { type: e.target.value })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          },
            goalTypes.map(function(t) {
              return React.createElement('option', { key: t.id, value: t.id }, t.label);
            })
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, 'Target Amount (EUR)'),
          React.createElement('input', {
            type: 'number',
            value: newGoal.targetAmount,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { targetAmount: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, 'Current Saved'),
          React.createElement('input', {
            type: 'number',
            value: newGoal.currentAmount,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { currentAmount: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, 'Target Date'),
          React.createElement('input', {
            type: 'date',
            value: newGoal.targetDate,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { targetDate: e.target.value })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block', marginBottom: '0.25rem' } }, 'Monthly Contribution'),
          React.createElement('input', {
            type: 'number',
            value: newGoal.monthlyContribution,
            onChange: function(e) { setNewGoal(Object.assign({}, newGoal, { monthlyContribution: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' } },
        React.createElement('button', {
          onClick: function() { setShowAddGoal(false); },
          style: { background: 'rgba(255,255,255,0.1)', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }
        }, 'Cancel'),
        React.createElement('button', {
          onClick: addGoal,
          style: { background: '#22c55e', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }
        }, 'Create Goal')
      )
    ),
    
    goals.map(function(goal) {
      var progress = calculateProgress(goal);
      
      return React.createElement(AnalysisCard, {
        key: goal.id,
        title: goal.name,
        badge: progress.onTrack ? 'On Track' : 'Behind',
        badgeType: progress.onTrack ? 'positive' : 'warning'
      },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' } },
          React.createElement('span', { style: { color: 'rgba(255,255,255,0.6)' } }, 
            goal.currentAmount.toFixed(0) + ' / ' + goal.targetAmount.toFixed(0) + ' EUR'
          ),
          React.createElement('span', { style: { color: '#f5a524', fontWeight: '600' } },
            progress.progressPercent.toFixed(1) + '%'
          )
        ),
        React.createElement(ProgressBar, { 
          value: progress.progressPercent, 
          color: progress.onTrack ? 'green' : 'red' 
        }),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: '1rem', flexWrap: 'wrap', gap: '0.5rem' } },
          React.createElement('div', null,
            React.createElement('div', { style: { color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' } }, 'Target Date'),
            React.createElement('div', { style: { color: 'white' } }, goal.targetDate)
          ),
          React.createElement('div', null,
            React.createElement('div', { style: { color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' } }, 'Monthly'),
            React.createElement('div', { style: { color: 'white' } }, goal.monthlyContribution + ' EUR')
          ),
          React.createElement('div', null,
            React.createElement('div', { style: { color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' } }, 'Remaining'),
            React.createElement('div', { style: { color: 'white' } }, (goal.targetAmount - goal.currentAmount).toFixed(0) + ' EUR')
          ),
          React.createElement('button', {
            onClick: function() { deleteGoal(goal.id); },
            style: { background: 'rgba(239,68,68,0.2)', color: '#ef4444', border: 'none', padding: '0.25rem 0.75rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }
          }, 'Delete')
        )
      );
    }),
    
    goals.length === 0 && !showAddGoal && React.createElement('div', {
      style: { color: 'rgba(255,255,255,0.5)', padding: '2rem', textAlign: 'center' }
    }, 'No goals yet. Click "+ Add Goal" to create your first investment goal.')
  );
}

// ============================================================================
// ECONOMIC INDICATOR VIEW
// ============================================================================

function EconomicIndicatorView(props) {
  // Sample economic data
  var economicData = {
    gdpGrowth: 2.1,
    cpi: 3.4,
    unemploymentRate: 3.9,
    pmi: 52.5,
    fedFundsRate: 5.25,
    treasury10y: 4.35,
    treasury2y: 4.85,
    yieldCurveSpread: -50,
    vix: 16.5,
    creditSpread: 350
  };
  
  var regime = useMemo(function() {
    if (economicData.gdpGrowth > 2 && economicData.cpi < 3) return { name: 'Goldilocks', color: '#22c55e', desc: 'Strong growth with low inflation - ideal conditions' };
    if (economicData.gdpGrowth < 1 && economicData.cpi > 4) return { name: 'Stagflation', color: '#ef4444', desc: 'Low growth with high inflation - challenging environment' };
    if (economicData.gdpGrowth > 2) return { name: 'Expansion', color: '#3b82f6', desc: 'Economy growing above trend' };
    return { name: 'Slowdown', color: '#f59e0b', desc: 'Growth moderating' };
  }, []);
  
  var recessionProb = useMemo(function() {
    var prob = 15; // Base probability
    if (economicData.yieldCurveSpread < 0) prob += 20; // Inverted yield curve
    if (economicData.pmi < 50) prob += 15; // Contracting PMI
    if (economicData.vix > 25) prob += 10; // High volatility
    return Math.min(100, prob);
  }, []);
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: 'white', marginBottom: '1rem' } }, 'Economic Indicators'),
    
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' } },
      React.createElement(AnalysisCard, {
        title: 'Economic Regime',
        badge: regime.name,
        badgeType: regime.name === 'Goldilocks' ? 'positive' : regime.name === 'Stagflation' ? 'negative' : 'neutral'
      },
        React.createElement('p', { style: { color: 'rgba(255,255,255,0.7)', marginBottom: '1rem' } }, regime.desc),
        React.createElement(MetricGrid, {
          metrics: [
            { label: 'GDP Growth', value: economicData.gdpGrowth + '%', color: economicData.gdpGrowth > 2 ? '#22c55e' : '#f59e0b' },
            { label: 'CPI', value: economicData.cpi + '%', color: economicData.cpi < 3 ? '#22c55e' : '#ef4444' }
          ]
        })
      ),
      
      React.createElement(AnalysisCard, {
        title: 'Recession Probability',
        badge: recessionProb + '%',
        badgeType: recessionProb > 40 ? 'negative' : recessionProb > 20 ? 'warning' : 'positive'
      },
        React.createElement('div', { 
          style: { 
            fontSize: '3rem', 
            fontWeight: 'bold', 
            color: recessionProb > 40 ? '#ef4444' : recessionProb > 20 ? '#f59e0b' : '#22c55e',
            textAlign: 'center',
            marginBottom: '1rem'
          }
        }, recessionProb + '%'),
        React.createElement('div', { style: { textAlign: 'center', color: 'rgba(255,255,255,0.7)' } },
          'Risk Level: ' + (recessionProb > 40 ? 'HIGH' : recessionProb > 20 ? 'MODERATE' : 'LOW')
        )
      ),
      
      React.createElement(AnalysisCard, {
        title: 'Market Indicators'
      },
        React.createElement(MetricGrid, {
          metrics: [
            { label: 'VIX', value: economicData.vix.toFixed(1), color: economicData.vix > 25 ? '#ef4444' : '#22c55e' },
            { label: '10Y Yield', value: economicData.treasury10y.toFixed(2) + '%' },
            { label: 'Yield Curve', value: economicData.yieldCurveSpread + ' bps', color: economicData.yieldCurveSpread < 0 ? '#ef4444' : '#22c55e' },
            { label: 'PMI', value: economicData.pmi.toFixed(1), color: economicData.pmi > 50 ? '#22c55e' : '#ef4444' }
          ]
        })
      )
    )
  );
}

// ============================================================================
// OPTIONS TRACKER VIEW
// ============================================================================

function OptionsTrackerView(props) {
  var _showCalculator = useState(true);
  var showCalculator = _showCalculator[0];
  var setShowCalculator = _showCalculator[1];
  
  var _calcParams = useState({
    type: 'call',
    stockPrice: 100,
    strikePrice: 100,
    timeToExpiry: 0.25,
    riskFreeRate: 0.05,
    volatility: 0.25
  });
  var calcParams = _calcParams[0];
  var setCalcParams = _calcParams[1];
  
  var calcResult = useMemo(function() {
    // Black-Scholes calculation
    var S = calcParams.stockPrice;
    var K = calcParams.strikePrice;
    var T = calcParams.timeToExpiry;
    var r = calcParams.riskFreeRate;
    var sigma = calcParams.volatility;
    
    if (T <= 0 || S <= 0 || K <= 0 || sigma <= 0) {
      return { price: 0, greeks: { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 } };
    }
    
    // Standard normal CDF approximation
    var normCDF = function(x) {
      var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
      var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
      var sign = x < 0 ? -1 : 1;
      x = Math.abs(x) / Math.sqrt(2);
      var t = 1.0 / (1.0 + p * x);
      var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
      return 0.5 * (1.0 + sign * y);
    };
    
    var normPDF = function(x) {
      return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    };
    
    var d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    var d2 = d1 - sigma * Math.sqrt(T);
    
    var price, delta;
    if (calcParams.type === 'call') {
      price = S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
      delta = normCDF(d1);
    } else {
      price = K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
      delta = normCDF(d1) - 1;
    }
    
    var gamma = normPDF(d1) / (S * sigma * Math.sqrt(T));
    var theta = -(S * normPDF(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCDF(d2);
    var vega = S * normPDF(d1) * Math.sqrt(T);
    var rho = K * T * Math.exp(-r * T) * normCDF(d2);
    
    return {
      price: price,
      greeks: { delta: delta, gamma: gamma, theta: theta / 365, vega: vega / 100, rho: rho / 100 }
    };
  }, [calcParams]);
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
      React.createElement('h2', { style: { color: 'white' } }, 'Options Calculator'),
      React.createElement('button', {
        onClick: function() { setShowCalculator(!showCalculator); },
        style: { background: '#f5a524', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }
      }, showCalculator ? 'Hide' : 'Show Calculator')
    ),
    
    showCalculator && React.createElement(AnalysisCard, { title: 'Black-Scholes Calculator' },
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' } },
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block' } }, 'Type'),
          React.createElement('select', {
            value: calcParams.type,
            onChange: function(e) { setCalcParams(Object.assign({}, calcParams, { type: e.target.value })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          },
            React.createElement('option', { value: 'call' }, 'Call'),
            React.createElement('option', { value: 'put' }, 'Put')
          )
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block' } }, 'Stock Price'),
          React.createElement('input', {
            type: 'number',
            value: calcParams.stockPrice,
            onChange: function(e) { setCalcParams(Object.assign({}, calcParams, { stockPrice: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block' } }, 'Strike'),
          React.createElement('input', {
            type: 'number',
            value: calcParams.strikePrice,
            onChange: function(e) { setCalcParams(Object.assign({}, calcParams, { strikePrice: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block' } }, 'Time (Years)'),
          React.createElement('input', {
            type: 'number',
            step: '0.01',
            value: calcParams.timeToExpiry,
            onChange: function(e) { setCalcParams(Object.assign({}, calcParams, { timeToExpiry: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block' } }, 'Rate'),
          React.createElement('input', {
            type: 'number',
            step: '0.01',
            value: calcParams.riskFreeRate,
            onChange: function(e) { setCalcParams(Object.assign({}, calcParams, { riskFreeRate: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        ),
        React.createElement('div', null,
          React.createElement('label', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem', display: 'block' } }, 'IV'),
          React.createElement('input', {
            type: 'number',
            step: '0.01',
            value: calcParams.volatility,
            onChange: function(e) { setCalcParams(Object.assign({}, calcParams, { volatility: parseFloat(e.target.value) || 0 })); },
            style: { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '6px', padding: '0.5rem', color: 'white' }
          })
        )
      ),
      
      React.createElement('div', { style: { marginTop: '1.5rem' } },
        React.createElement('div', { 
          style: { textAlign: 'center', padding: '1.5rem', background: 'rgba(245,165,36,0.1)', borderRadius: '12px', marginBottom: '1rem' }
        },
          React.createElement('div', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.875rem' } }, 
            calcParams.type.toUpperCase() + ' Option Price'
          ),
          React.createElement('div', { style: { fontSize: '3rem', fontWeight: 'bold', color: '#f5a524' } },
            calcResult.price.toFixed(2) + ' EUR'
          )
        ),
        
        React.createElement('div', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.875rem', marginBottom: '0.5rem' } }, 'Greeks'),
        React.createElement(MetricGrid, {
          metrics: [
            { label: 'Delta', value: calcResult.greeks.delta.toFixed(4) },
            { label: 'Gamma', value: calcResult.greeks.gamma.toFixed(4) },
            { label: 'Theta', value: calcResult.greeks.theta.toFixed(4) },
            { label: 'Vega', value: calcResult.greeks.vega.toFixed(4) },
            { label: 'Rho', value: calcResult.greeks.rho.toFixed(4) }
          ]
        })
      )
    )
  );
}

// ============================================================================
// TAX PLANNING VIEW
// ============================================================================

function TaxPlanningView(props) {
  var portfolio = props.portfolio || {};
  
  var taxAnalysis = useMemo(function() {
    var crypto = portfolio.crypto || [];
    var taxFree = [];
    var almostFree = [];
    var taxable = [];
    var now = new Date();
    
    crypto.forEach(function(pos) {
      var purchaseDate = new Date(pos.purchaseDate || pos.date || now);
      var daysHeld = Math.floor((now - purchaseDate) / (1000 * 60 * 60 * 24));
      var value = (pos.amount || 0) * (pos.currentPrice || pos.purchasePrice || 0);
      var gain = value - ((pos.amount || 0) * (pos.purchasePrice || 0));
      
      if (daysHeld >= 365) {
        taxFree.push({ symbol: pos.symbol || pos.name, daysHeld: daysHeld, value: value, gain: gain });
      } else if (daysHeld >= 300) {
        almostFree.push({ symbol: pos.symbol || pos.name, daysUntilTaxFree: 365 - daysHeld, value: value, gain: gain });
      } else {
        taxable.push({ symbol: pos.symbol || pos.name, daysHeld: daysHeld, value: value, gain: gain });
      }
    });
    
    return {
      taxFree: taxFree,
      almostFree: almostFree,
      taxable: taxable,
      taxFreeValue: taxFree.reduce(function(sum, p) { return sum + p.value; }, 0),
      potentialSavings: almostFree.reduce(function(sum, p) { return sum + Math.max(0, p.gain) * 0.264; }, 0)
    };
  }, [portfolio]);
  
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: 'white', marginBottom: '1rem' } }, 'Tax Planning (Germany)'),
    
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } },
      React.createElement(AnalysisCard, {
        title: 'Crypto Tax Status',
        badge: taxAnalysis.taxFree.length + ' Tax-Free',
        badgeType: 'positive'
      },
        React.createElement(MetricGrid, {
          metrics: [
            { label: 'Tax-Free (>1yr)', value: taxAnalysis.taxFree.length, color: '#22c55e' },
            { label: 'Tax-Free Value', value: taxAnalysis.taxFreeValue.toFixed(0) + ' EUR' },
            { label: 'Almost Free', value: taxAnalysis.almostFree.length, color: '#f59e0b' },
            { label: 'Potential Savings', value: taxAnalysis.potentialSavings.toFixed(0) + ' EUR', color: '#22c55e' }
          ]
        }),
        taxAnalysis.almostFree.length > 0 && React.createElement('div', { style: { marginTop: '1rem' } },
          React.createElement('div', { style: { color: '#f59e0b', fontWeight: '600', marginBottom: '0.5rem' } }, 'Wait for Tax-Free:'),
          taxAnalysis.almostFree.map(function(pos, i) {
            return React.createElement('div', {
              key: i,
              style: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }
            },
              React.createElement('span', { style: { color: 'white' } }, pos.symbol),
              React.createElement('span', { style: { color: '#f59e0b' } }, pos.daysUntilTaxFree + ' days')
            );
          })
        )
      ),
      
      React.createElement(AnalysisCard, { title: 'German Tax Rules' },
        React.createElement('div', { style: { color: 'rgba(255,255,255,0.7)', fontSize: '0.875rem' } },
          React.createElement('div', { style: { marginBottom: '1rem' } },
            React.createElement('strong', { style: { color: '#f5a524' } }, 'Capital Gains (Abgeltungssteuer)'),
            React.createElement('div', null, '25% + 5.5% solidarity = 26.375%')
          ),
          React.createElement('div', { style: { marginBottom: '1rem' } },
            React.createElement('strong', { style: { color: '#22c55e' } }, 'Crypto Advantage'),
            React.createElement('div', null, 'Held > 1 year = TAX FREE!')
          ),
          React.createElement('div', null,
            React.createElement('strong', { style: { color: '#f59e0b' } }, 'Annual Exemption'),
            React.createElement('div', null, '1,000 EUR (single) / 2,000 EUR (married)')
          )
        )
      )
    )
  );
}

// ============================================================================
// MAIN DASHBOARD
// ============================================================================

function InvestmentAnalysisDashboard(props) {
  var portfolio = props.portfolio || { crypto: [], stocks: [], skins: [] };
  var prices = props.prices || {};
  var priceHistory = props.priceHistory || {};
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
    { id: 'dca',      label: 'DCA Strategy',     desc: 'Compare DCA vs. lump sum' },
    { id: 'sectors',  label: 'Sectors',          desc: 'Analyze sector allocation' },
    { id: 'countries',label: 'Countries',        desc: 'Geographic allocation' },
    { id: 'currency', label: 'Currencies',       desc: 'Foreign-currency exposure' },
    { id: 'liquidity',label: 'Liquidity',        desc: 'Position Liquidity Score' },
    { id: 'goals',    label: 'Goals',            desc: 'Track savings goals' }
  ];

  var tabStyle = function(id) {
    var active = activeSection === id;
    return {
      padding: '0.5rem 1rem',
      background: active ? (theme.accentSoft || 'rgba(245,165,36,0.12)') : 'transparent',
      border: 'none',
      color: active ? (theme.accent || '#f5a524') : (theme.textSecondary || 'rgba(255,255,255,0.6)'),
      cursor: 'pointer',
      borderRadius: '10px',
      fontSize: '0.875rem',
      fontWeight: active ? '650' : '450',
      transition: 'all 0.15s',
      whiteSpace: 'nowrap'
    };
  };
  
  var renderSection = function() {
    switch(activeSection) {
      case 'dca':      return React.createElement(DCAAnalyzerView, { portfolio: portfolio, priceHistory: priceHistory });
      case 'sectors':  return React.createElement(SectorAllocationView, { portfolio: portfolio });
      case 'countries':return React.createElement(CountryAllocationView, { portfolio: portfolio });
      case 'currency': return React.createElement(CurrencyExposureView, { portfolio: portfolio });
      case 'liquidity':return React.createElement(LiquidityAnalysisView, { portfolio: portfolio });
      case 'goals':    return React.createElement(GoalInvestingView, { portfolioValue: portfolioValue });
      default:         return React.createElement(DCAAnalyzerView, { portfolio: portfolio, priceHistory: priceHistory });
    }
  };
  
  return React.createElement('div', null,
    // Tab bar
    React.createElement('div', { 
      style: { display: 'flex', gap: '0.25rem', padding: '0 1.5rem 1rem', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '0' }
    },
      sections.map(function(s) {
        return React.createElement('button', {
          key: s.id,
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
  TabBar: TabBar
};

console.log('[OK] Investment Views v7.1 loaded');

})();
