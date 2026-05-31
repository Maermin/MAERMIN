// ============================================================================
// MAERMIN v7.0 - Enhanced Dividend Tracker View
// Complete dividend tracking with history, forecasts, and per-stock details
// NO EMOJIS VERSION
// ============================================================================

(function() {
'use strict';

var useState = React.useState;
var useEffect = React.useEffect;
var useMemo = React.useMemo;

// Helper functions — shared via utils.js (window.MaerminUtils)
const formatCurrency = window.MaerminUtils.formatCurrencyEUR;
const formatPercent = window.MaerminUtils.formatPercentPlain;

// ============================================================================
// ENHANCED DIVIDEND TRACKER VIEW
// ============================================================================

function EnhancedDividendTrackerView(props) {
  var portfolio = props.portfolio || {};
  var prices = props.prices || {};
  var theme = props.theme || {};
  
  var _activeTab = useState('summary');
  var activeTab = _activeTab[0];
  var setActiveTab = _activeTab[1];
  
  var _selectedYear = useState(new Date().getFullYear());
  var selectedYear = _selectedYear[0];
  var setSelectedYear = _selectedYear[1];
  
  // DEBUG: Log portfolio data
  console.log('[DIVIDEND VIEW] Portfolio received:', portfolio);
  console.log('[DIVIDEND VIEW] Stocks in portfolio:', portfolio.stocks);
  
  // Get dividend data using the service
  var dividendAnalysis = useMemo(function() {
    if (!window.DividendDataService) {
      console.warn('[DIVIDEND VIEW] DividendDataService not loaded!');
      return null;
    }
    
    console.log('[DIVIDEND VIEW] Calling DividendDataService.analyzePortfolioDividends...');
    var result = window.DividendDataService.analyzePortfolioDividends(portfolio, prices, {});
    console.log('[DIVIDEND VIEW] Analysis result:', result);
    return result;
  }, [portfolio, prices]);
  
  // Calculate derived data
  var currentYear = new Date().getFullYear();
  var years = [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
  
  var tabs = [
    { id: 'summary', label: 'Summary' },
    { id: 'stocks', label: 'Per Stock' },
    { id: 'history', label: 'History' },
    { id: 'forecast', label: 'Forecast' },
    { id: 'calendar', label: 'Calendar' }
  ];
  
  var cardStyle = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    padding: '1.5rem',
    marginBottom: '1rem'
  };
  
  var metricBoxStyle = {
    textAlign: 'center',
    padding: '1rem',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: '8px'
  };
  
  // Render functions for each tab
  var renderSummary = function() {
    if (!dividendAnalysis || !dividendAnalysis.summary) {
      return React.createElement('div', { style: { color: 'rgba(255,255,255,0.5)', padding: '2rem', textAlign: 'center' } },
        'Add dividend-paying stocks to see your income summary. Supported: AAPL, MSFT, JNJ, KO, PG, O, VYM, SCHD, ALV.DE, SAP.DE, etc.'
      );
    }
    
    var summary = dividendAnalysis.summary;
    var forecast = dividendAnalysis.forecast && dividendAnalysis.forecast[currentYear];
    
    return React.createElement('div', null,
      // Main metrics
      React.createElement('div', { style: cardStyle },
        React.createElement('h3', { style: { color: 'white', marginBottom: '1rem' } }, 'Annual Dividend Income'),
        React.createElement('div', { 
          style: { 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', 
            gap: '1rem' 
          }
        },
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: { fontSize: '2rem', fontWeight: '700', color: '#22c55e' } },
              formatCurrency(summary.totalAnnualDividends)
            ),
            React.createElement('div', { style: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' } },
              'Annual Income'
            )
          ),
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: { fontSize: '2rem', fontWeight: '700', color: '#8b5cf6' } },
              formatCurrency(summary.monthlyIncome)
            ),
            React.createElement('div', { style: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' } },
              'Monthly Average'
            )
          ),
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: { fontSize: '2rem', fontWeight: '700', color: '#3b82f6' } },
              formatPercent(summary.totalYield)
            ),
            React.createElement('div', { style: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' } },
              'Portfolio Yield'
            )
          ),
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: { fontSize: '2rem', fontWeight: '700', color: '#f59e0b' } },
              formatPercent(summary.totalYieldOnCost)
            ),
            React.createElement('div', { style: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' } },
              'Yield on Cost'
            )
          )
        )
      ),
      
      // Insights
      dividendAnalysis.analysis && dividendAnalysis.analysis.length > 0 && React.createElement('div', { style: cardStyle },
        React.createElement('h3', { style: { color: 'white', marginBottom: '1rem' } }, 'Insights'),
        dividendAnalysis.analysis.map(function(insight, i) {
          return React.createElement('div', {
            key: i,
            style: {
              padding: '0.75rem',
              marginBottom: '0.5rem',
              background: insight.type === 'positive' ? 'rgba(34,197,94,0.1)' :
                         insight.type === 'warning' ? 'rgba(245,158,11,0.1)' : 'rgba(139,92,246,0.1)',
              borderRadius: '8px',
              borderLeft: '4px solid ' + (insight.type === 'positive' ? '#22c55e' :
                                          insight.type === 'warning' ? '#f59e0b' : '#8b5cf6')
            }
          },
            React.createElement('span', { style: { color: 'rgba(255,255,255,0.9)' } }, insight.message)
          );
        })
      ),
      
      // Quarterly breakdown
      forecast && React.createElement('div', { style: cardStyle },
        React.createElement('h3', { style: { color: 'white', marginBottom: '1rem' } }, currentYear + ' Quarterly Breakdown'),
        React.createElement('div', { 
          style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }
        },
          ['Q1', 'Q2', 'Q3', 'Q4'].map(function(q) {
            var amount = forecast.byQuarter[q] || 0;
            return React.createElement('div', {
              key: q,
              style: {
                padding: '1rem',
                background: 'rgba(139,92,246,0.1)',
                borderRadius: '8px',
                textAlign: 'center'
              }
            },
              React.createElement('div', { style: { color: '#8b5cf6', fontWeight: '600', marginBottom: '0.25rem' } }, q),
              React.createElement('div', { style: { color: 'white', fontSize: '1.25rem', fontWeight: '700' } }, 
                formatCurrency(amount)
              )
            );
          })
        )
      )
    );
  };
  
  var renderPerStock = function() {
    var stockBreakdown = dividendAnalysis && dividendAnalysis.stockBreakdown || [];
    var dividendStocks = stockBreakdown.filter(function(s) { return s.hasDividend; });
    var nonDividendStocks = stockBreakdown.filter(function(s) { return !s.hasDividend; });
    
    console.log('[DIVIDEND VIEW] Stock breakdown:', stockBreakdown);
    console.log('[DIVIDEND VIEW] Dividend stocks:', dividendStocks);
    console.log('[DIVIDEND VIEW] Non-dividend stocks:', nonDividendStocks);
    
    if (stockBreakdown.length === 0) {
      return React.createElement('div', { style: { color: 'rgba(255,255,255,0.5)', padding: '2rem', textAlign: 'center' } },
        'Add stocks to see per-stock dividend details. Go to Transactions and add stocks like AAPL, MSFT, JNJ, etc.'
      );
    }
    
    return React.createElement('div', null,
      // Dividend-paying stocks
      React.createElement('div', { style: cardStyle },
        React.createElement('h3', { style: { color: 'white', marginBottom: '1rem' } }, 
          'Dividend-Paying Stocks (' + dividendStocks.length + ')'
        ),
        dividendStocks.length > 0 ? React.createElement('div', { style: { overflowX: 'auto' } },
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '800px' } },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['Symbol', 'Shares', 'Div/Share', 'Annual Income', 'Yield', 'Yield on Cost', 'Frequency', 'Growth', 'Next Ex-Date'].map(function(h, i) {
                  return React.createElement('th', {
                    key: i,
                    style: {
                      padding: '0.75rem',
                      textAlign: i > 2 ? 'right' : 'left',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      color: '#8b5cf6',
                      fontWeight: '600',
                      fontSize: '0.75rem',
                      textTransform: 'uppercase'
                    }
                  }, h);
                })
              )
            ),
            React.createElement('tbody', null,
              dividendStocks.map(function(stock, i) {
                return React.createElement('tr', { 
                  key: i,
                  style: { background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.1)' }
                },
                  React.createElement('td', { style: { padding: '0.75rem', color: 'white', fontWeight: '600' } },
                    React.createElement('div', null, stock.symbol),
                    stock.isDividendAristocrat && React.createElement('span', {
                      style: { fontSize: '0.625rem', background: '#f59e0b', color: 'black', padding: '2px 6px', borderRadius: '4px', marginLeft: '0.5rem' }
                    }, 'Aristocrat'),
                    stock.isDividendKing && React.createElement('span', {
                      style: { fontSize: '0.625rem', background: '#22c55e', color: 'black', padding: '2px 6px', borderRadius: '4px', marginLeft: '0.5rem' }
                    }, 'King')
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', color: 'rgba(255,255,255,0.8)' } }, 
                    (stock.shares || 0).toFixed(2)
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', color: 'rgba(255,255,255,0.8)' } }, 
                    formatCurrency(stock.dividendPerShare)
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: '#22c55e', fontWeight: '600' } }, 
                    formatCurrency(stock.annualIncome)
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: '#3b82f6' } }, 
                    formatPercent(stock.currentYield)
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: '#8b5cf6' } }, 
                    formatPercent(stock.yieldOnCost)
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: 'rgba(255,255,255,0.7)', textTransform: 'capitalize' } }, 
                    stock.frequency || '-'
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: stock.growthRate && parseFloat(stock.growthRate) > 0 ? '#22c55e' : 'rgba(255,255,255,0.5)' } }, 
                    stock.growthRate || '-'
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: 'rgba(255,255,255,0.7)' } }, 
                    stock.nextExDate || '-'
                  )
                );
              })
            )
          )
        ) : React.createElement('p', { style: { color: 'rgba(255,255,255,0.5)' } }, 
          'No dividend-paying stocks found. Your stocks may not be in the dividend database.'
        )
      ),
      
      // Non-dividend stocks
      nonDividendStocks.length > 0 && React.createElement('div', { style: cardStyle },
        React.createElement('h3', { style: { color: 'rgba(255,255,255,0.6)', marginBottom: '1rem' } }, 
          'Stocks Without Dividend Data (' + nonDividendStocks.length + ')'
        ),
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' } },
          nonDividendStocks.map(function(stock, i) {
            return React.createElement('span', {
              key: i,
              style: {
                padding: '0.5rem 1rem',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '6px',
                color: 'rgba(255,255,255,0.6)'
              }
            }, stock.symbol);
          })
        )
      )
    );
  };
  
  var renderHistory = function() {
    var historical = dividendAnalysis && dividendAnalysis.historical || {};
    var pastYears = [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1];
    
    return React.createElement('div', null,
      React.createElement('div', { style: cardStyle },
        React.createElement('h3', { style: { color: 'white', marginBottom: '1rem' } }, 'Historical Dividend Income'),
        
        // Year selector
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' } },
          pastYears.concat([currentYear]).map(function(year) {
            return React.createElement('button', {
              key: year,
              onClick: function() { setSelectedYear(year); },
              style: {
                padding: '0.5rem 1rem',
                background: selectedYear === year ? '#8b5cf6' : 'rgba(255,255,255,0.05)',
                border: 'none',
                borderRadius: '6px',
                color: selectedYear === year ? 'white' : 'rgba(255,255,255,0.6)',
                cursor: 'pointer'
              }
            }, year);
          })
        ),
        
        // Year comparison chart (simple bars)
        React.createElement('div', { style: { marginBottom: '2rem' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', height: '200px', gap: '1rem', paddingBottom: '2rem' } },
            pastYears.concat([currentYear]).map(function(year) {
              var yearData = historical[year];
              var amount = yearData ? yearData.totalDividends : 0;
              var maxAmount = Math.max.apply(null, pastYears.concat([currentYear]).map(function(y) {
                return historical[y] ? historical[y].totalDividends : 0;
              })) || 1;
              var height = (amount / maxAmount) * 100;
              
              return React.createElement('div', {
                key: year,
                style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }
              },
                React.createElement('div', {
                  style: {
                    width: '100%',
                    maxWidth: '60px',
                    height: Math.max(5, height) + '%',
                    background: year === currentYear ? '#8b5cf6' : 'rgba(139,92,246,0.5)',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s ease'
                  }
                }),
                React.createElement('div', { style: { color: 'rgba(255,255,255,0.6)', marginTop: '0.5rem', fontSize: '0.875rem' } }, year),
                React.createElement('div', { style: { color: 'white', fontWeight: '600', fontSize: '0.75rem' } }, 
                  formatCurrency(amount, 0)
                )
              );
            })
          )
        ),
        
        // Selected year details
        historical[selectedYear] && React.createElement('div', null,
          React.createElement('h4', { style: { color: '#8b5cf6', marginBottom: '1rem' } }, 
            selectedYear + ' Breakdown by Stock'
          ),
          Object.keys(historical[selectedYear].byStock || {}).length > 0 ? React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['Stock', 'Shares', 'Div/Share', 'Total Received', 'Payments'].map(function(h, i) {
                  return React.createElement('th', {
                    key: i,
                    style: {
                      padding: '0.75rem',
                      textAlign: i > 1 ? 'right' : 'left',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.6)',
                      fontWeight: '600',
                      fontSize: '0.75rem'
                    }
                  }, h);
                })
              )
            ),
            React.createElement('tbody', null,
              Object.values(historical[selectedYear].byStock).map(function(stock, i) {
                return React.createElement('tr', { key: i },
                  React.createElement('td', { style: { padding: '0.75rem', color: 'white' } }, stock.symbol),
                  React.createElement('td', { style: { padding: '0.75rem', color: 'rgba(255,255,255,0.8)' } }, stock.shares),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: 'rgba(255,255,255,0.8)' } }, 
                    formatCurrency(stock.annualDividend)
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: '#22c55e', fontWeight: '600' } }, 
                    formatCurrency(stock.totalReceived)
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: 'rgba(255,255,255,0.6)' } }, 
                    stock.paymentsPerYear
                  )
                );
              })
            )
          ) : React.createElement('p', { style: { color: 'rgba(255,255,255,0.5)' } }, 
            'No dividend data for ' + selectedYear
          )
        )
      )
    );
  };
  
  var renderForecast = function() {
    var forecast = dividendAnalysis && dividendAnalysis.forecast || {};
    var futureYears = [currentYear, currentYear + 1, currentYear + 2];
    
    return React.createElement('div', null,
      React.createElement('div', { style: cardStyle },
        React.createElement('h3', { style: { color: 'white', marginBottom: '1rem' } }, 
          'Dividend Income Forecast'
        ),
        
        // Forecast comparison
        React.createElement('div', { 
          style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }
        },
          futureYears.map(function(year) {
            var yearData = forecast[year];
            if (!yearData) return null;
            
            var isCurrentYear = year === currentYear;
            
            return React.createElement('div', {
              key: year,
              style: {
                padding: '1.5rem',
                background: isCurrentYear ? 'rgba(139,92,246,0.2)' : 'rgba(255,255,255,0.05)',
                borderRadius: '12px',
                border: isCurrentYear ? '2px solid #8b5cf6' : '1px solid rgba(255,255,255,0.1)'
              }
            },
              React.createElement('div', { 
                style: { color: isCurrentYear ? '#8b5cf6' : 'rgba(255,255,255,0.6)', fontSize: '0.875rem', marginBottom: '0.5rem' }
              }, year + (isCurrentYear ? ' (This Year)' : '')),
              React.createElement('div', { 
                style: { color: 'white', fontSize: '2rem', fontWeight: '700', marginBottom: '1rem' }
              }, formatCurrency(yearData.totalProjected)),
              React.createElement('div', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.875rem' } },
                'Monthly: ' + formatCurrency(yearData.totalProjected / 12)
              )
            );
          })
        ),
        
        // Per-stock forecast for current year
        forecast[currentYear] && forecast[currentYear].byStock && React.createElement('div', null,
          React.createElement('h4', { style: { color: '#8b5cf6', marginBottom: '1rem' } }, 
            currentYear + ' Expected by Stock'
          ),
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['Stock', 'Shares', 'Annual Div', 'Expected Income', 'Growth from Last Year'].map(function(h, i) {
                  return React.createElement('th', {
                    key: i,
                    style: {
                      padding: '0.75rem',
                      textAlign: i > 1 ? 'right' : 'left',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(255,255,255,0.6)',
                      fontWeight: '600',
                      fontSize: '0.75rem'
                    }
                  }, h);
                })
              )
            ),
            React.createElement('tbody', null,
              Object.values(forecast[currentYear].byStock).map(function(stock, i) {
                return React.createElement('tr', { key: i },
                  React.createElement('td', { style: { padding: '0.75rem', color: 'white' } }, stock.symbol),
                  React.createElement('td', { style: { padding: '0.75rem', color: 'rgba(255,255,255,0.8)' } }, stock.shares),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: 'rgba(255,255,255,0.8)' } }, 
                    formatCurrency(stock.annualDividend)
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: '#22c55e', fontWeight: '600' } }, 
                    formatCurrency(stock.totalExpected)
                  ),
                  React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: stock.growthFromCurrent > 0 ? '#22c55e' : 'rgba(255,255,255,0.5)' } }, 
                    stock.growthFromCurrent > 0 ? '+' + formatPercent(stock.growthFromCurrent) : '-'
                  )
                );
              })
            )
          )
        ),
        
        // Monthly forecast
        forecast[currentYear] && forecast[currentYear].byMonth && React.createElement('div', { style: { marginTop: '2rem' } },
          React.createElement('h4', { style: { color: '#8b5cf6', marginBottom: '1rem' } }, 
            currentYear + ' Monthly Breakdown'
          ),
          React.createElement('div', { 
            style: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.5rem' }
          },
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function(month) {
              var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
              var monthData = forecast[currentYear].byMonth[month];
              var amount = monthData ? monthData.total : 0;
              var isPast = month <= new Date().getMonth() + 1;
              
              return React.createElement('div', {
                key: month,
                style: {
                  padding: '0.75rem',
                  background: isPast ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '8px',
                  textAlign: 'center',
                  border: isPast ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent'
                }
              },
                React.createElement('div', { style: { color: 'rgba(255,255,255,0.6)', fontSize: '0.75rem' } }, monthNames[month - 1]),
                React.createElement('div', { style: { color: amount > 0 ? '#22c55e' : 'rgba(255,255,255,0.3)', fontWeight: '600' } }, 
                  amount > 0 ? formatCurrency(amount, 0) : '-'
                )
              );
            })
          )
        )
      )
    );
  };
  
  var renderCalendar = function() {
    var calendar = dividendAnalysis && dividendAnalysis.calendar || { events: [], summary: {} };
    
    return React.createElement('div', null,
      React.createElement('div', { style: cardStyle },
        React.createElement('h3', { style: { color: 'white', marginBottom: '1rem' } }, 
          'Upcoming Dividends'
        ),
        
        React.createElement('div', { 
          style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }
        },
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: { fontSize: '2rem', fontWeight: '700', color: '#f59e0b' } },
              calendar.summary.upcomingPayments || 0
            ),
            React.createElement('div', { style: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' } },
              'Upcoming Payments'
            )
          ),
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: { fontSize: '2rem', fontWeight: '700', color: '#22c55e' } },
              formatCurrency(calendar.summary.totalExpectedIncome || 0)
            ),
            React.createElement('div', { style: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' } },
              'Expected Income'
            )
          ),
          React.createElement('div', { style: metricBoxStyle },
            React.createElement('div', { style: { fontSize: '2rem', fontWeight: '700', color: '#3b82f6' } },
              '6 mo'
            ),
            React.createElement('div', { style: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)' } },
              'Forecast Period'
            )
          )
        ),
        
        calendar.events && calendar.events.length > 0 ? React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          React.createElement('thead', null,
            React.createElement('tr', null,
              ['Date', 'Type', 'Symbol', 'Div/Share', 'Est. Amount'].map(function(h, i) {
                return React.createElement('th', {
                  key: i,
                  style: {
                    padding: '0.75rem',
                    textAlign: i > 2 ? 'right' : 'left',
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                    color: 'rgba(255,255,255,0.6)',
                    fontWeight: '600',
                    fontSize: '0.75rem'
                  }
                }, h);
              })
            )
          ),
          React.createElement('tbody', null,
            calendar.events.slice(0, 20).map(function(event, i) {
              return React.createElement('tr', { key: i },
                React.createElement('td', { style: { padding: '0.75rem', color: 'white' } }, 
                  new Date(event.date).toLocaleDateString('de-DE')
                ),
                React.createElement('td', { style: { padding: '0.75rem' } }, 
                  React.createElement('span', {
                    style: {
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      background: event.type === 'ex-date' ? 'rgba(245,158,11,0.2)' : 'rgba(34,197,94,0.2)',
                      color: event.type === 'ex-date' ? '#f59e0b' : '#22c55e'
                    }
                  }, event.type === 'ex-date' ? 'Ex-Date' : 'Payment')
                ),
                React.createElement('td', { style: { padding: '0.75rem', color: 'white', fontWeight: '600' } }, event.symbol),
                React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: 'rgba(255,255,255,0.8)' } }, 
                  formatCurrency(event.dividendPerShare)
                ),
                React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: '#22c55e', fontWeight: '600' } }, 
                  formatCurrency(event.estimatedAmount)
                )
              );
            })
          )
        ) : React.createElement('div', { style: { color: 'rgba(255,255,255,0.5)', padding: '2rem', textAlign: 'center' } },
          'No upcoming dividend events. Add dividend-paying stocks to see the calendar.'
        )
      )
    );
  };
  
  // Main render
  return React.createElement('div', { style: { padding: '1rem' } },
    React.createElement('h2', { style: { color: 'white', marginBottom: '1rem' } }, 
      'Dividend Tracker'
    ),
    
    // Tabs
    React.createElement('div', { 
      style: { 
        display: 'flex', 
        gap: '0.5rem', 
        marginBottom: '1.5rem',
        flexWrap: 'wrap',
        padding: '0.25rem',
        background: 'rgba(0,0,0,0.2)',
        borderRadius: '8px'
      }
    },
      tabs.map(function(tab) {
        var isActive = activeTab === tab.id;
        return React.createElement('button', {
          key: tab.id,
          onClick: function() { setActiveTab(tab.id); },
          style: {
            padding: '0.5rem 1rem',
            background: isActive ? 'rgba(139,92,246,0.3)' : 'transparent',
            border: 'none',
            color: isActive ? 'white' : 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            borderRadius: '6px',
            fontSize: '0.875rem'
          }
        }, tab.label);
      })
    ),
    
    // Content
    activeTab === 'summary' && renderSummary(),
    activeTab === 'stocks' && renderPerStock(),
    activeTab === 'history' && renderHistory(),
    activeTab === 'forecast' && renderForecast(),
    activeTab === 'calendar' && renderCalendar()
  );
}

// Export to window
window.EnhancedDividendTrackerView = EnhancedDividendTrackerView;

console.log('[OK] Enhanced Dividend Tracker View v7.0 loaded (NO EMOJIS)');

})();
