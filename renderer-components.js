// ============================================================================
// MAERMIN v6.0 - Main Renderer Application
// Multi-Asset Portfolio Tracker & Financial OS
// ============================================================================

(function() {
'use strict';

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ============================================================================
// THEME CONFIGURATION
// ============================================================================

const themes = {
  white: {
    background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f8fafc 100%)',
    card: 'rgba(255,255,255,0.9)',
    cardBorder: 'rgba(0,0,0,0.1)',
    text: '#1e293b',
    textSecondary: '#64748b',
    inputBg: 'rgba(0,0,0,0.05)',
    inputBorder: 'rgba(0,0,0,0.1)',
    accent: '#7e22ce',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b'
  },
  dark: {
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
    card: 'rgba(30,41,59,0.9)',
    cardBorder: 'rgba(255,255,255,0.1)',
    text: '#f8fafc',
    textSecondary: '#94a3b8',
    inputBg: 'rgba(255,255,255,0.05)',
    inputBorder: 'rgba(255,255,255,0.1)',
    accent: '#8b5cf6',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b'
  },
  purple: {
    background: 'linear-gradient(135deg, #1e293b 0%, #7e22ce 50%, #1e293b 100%)',
    card: 'rgba(255,255,255,0.1)',
    cardBorder: 'rgba(255,255,255,0.2)',
    text: '#ffffff',
    textSecondary: 'rgba(255,255,255,0.6)',
    inputBg: 'rgba(255,255,255,0.1)',
    inputBorder: 'rgba(255,255,255,0.2)',
    accent: '#a855f7',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#f59e0b'
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const formatPrice = (price, currency = 'EUR', exchangeRate = 1) => {
  if (price === undefined || price === null || isNaN(price)) return '0.00';
  const converted = currency === 'USD' ? price * exchangeRate : price;
  return converted.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatPercent = (value) => {
  if (value === undefined || value === null || isNaN(value)) return '0.00%';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const formatDate = (dateStr, language = 'de') => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString(language === 'de' ? 'de-DE' : 'en-US');
};

const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// ============================================================================
// COMMAND PALETTE COMPONENT
// ============================================================================

function CommandPalette({ isOpen, onClose, onExecute, commands, t }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      return commands.slice(0, 10);
    }
    const q = query.toLowerCase();
    return commands
      .filter(cmd => 
        cmd.label.toLowerCase().includes(q) ||
        (cmd.description && cmd.description.toLowerCase().includes(q)) ||
        (cmd.keywords && cmd.keywords.some(k => k.toLowerCase().includes(q)))
      )
      .slice(0, 15);
  }, [query, commands]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filteredCommands[selectedIndex]) {
      e.preventDefault();
      onExecute(filteredCommands[selectedIndex].id);
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return React.createElement('div', {
    className: 'command-palette-overlay',
    onClick: (e) => e.target === e.currentTarget && onClose()
  },
    React.createElement('div', { className: 'command-palette' },
      React.createElement('input', {
        ref: inputRef,
        type: 'text',
        className: 'command-palette-input',
        placeholder: t.searchCommands || 'Search commands...',
        value: query,
        onChange: (e) => setQuery(e.target.value),
        onKeyDown: handleKeyDown
      }),
      React.createElement('div', { className: 'command-palette-results' },
        filteredCommands.length === 0
          ? React.createElement('div', {
              style: { padding: '1rem 1.5rem', color: 'rgba(255,255,255,0.5)' }
            }, t.noResults || 'No results')
          : filteredCommands.map((cmd, index) =>
              React.createElement('div', {
                key: cmd.id,
                className: `command-result ${index === selectedIndex ? 'selected' : ''}`,
                onClick: () => {
                  onExecute(cmd.id);
                  onClose();
                },
                onMouseEnter: () => setSelectedIndex(index)
              },
                React.createElement('div', { className: 'command-result-icon' }, 
                  cmd.icon ? cmd.icon.charAt(0).toUpperCase() : '>'
                ),
                React.createElement('div', { className: 'command-result-content' },
                  React.createElement('div', { className: 'command-result-label' }, cmd.label),
                  cmd.description && React.createElement('div', { 
                    className: 'command-result-description' 
                  }, cmd.description)
                ),
                cmd.shortcut && React.createElement('div', { 
                  className: 'command-result-shortcut' 
                }, cmd.shortcut)
              )
            )
      ),
      React.createElement('div', { className: 'command-palette-footer' },
        React.createElement('span', null, React.createElement('kbd', null, 'Enter'), ' ', t.confirm || 'Select'),
        React.createElement('span', null, React.createElement('kbd', null, 'Esc'), ' ', t.close || 'Close'),
        React.createElement('span', null, React.createElement('kbd', null, 'Up/Down'), ' Navigate')
      )
    )
  );
}

// ============================================================================
// KEYBOARD SHORTCUTS MODAL
// ============================================================================

function ShortcutsModal({ isOpen, onClose, t, theme }) {
  if (!isOpen) return null;

  const shortcuts = {
    [t.navigation || 'Navigation']: [
      { keys: ['Ctrl', 'K'], action: t.commandPalette || 'Command Palette' },
      { keys: ['g', 'o'], action: t.goToOverview || 'Go to Overview' },
      { keys: ['g', 'p'], action: t.goToPortfolio || 'Go to Portfolio' },
      { keys: ['g', 'a'], action: t.goToAnalytics || 'Go to Analytics' },
      { keys: ['g', 't'], action: t.goToTransactions || 'Go to Transactions' }
    ],
    [t.actions || 'Actions']: [
      { keys: ['n'], action: t.addNew || 'Add Position' },
      { keys: ['t'], action: t.addTransaction || 'Add Transaction' },
      { keys: ['r'], action: t.refresh || 'Refresh Prices' },
      { keys: ['i'], action: t.import || 'Import Data' },
      { keys: ['l'], action: t.createAlert || 'Create Alert' }
    ],
    [t.workspaces || 'Workspaces']: [
      { keys: ['w', '1'], action: t.defaultWorkspace || 'Default' },
      { keys: ['w', '2'], action: t.taxSeasonWorkspace || 'Tax Season' },
      { keys: ['w', '3'], action: t.deepAnalysisWorkspace || 'Deep Analysis' },
      { keys: ['w', 's'], action: t.saveWorkspace || 'Save Workspace' }
    ],
    [t.analytics || 'Analytics']: [
      { keys: ['a', 'c'], action: t.correlationMatrix || 'Correlation Matrix' },
      { keys: ['a', 'm'], action: t.monteCarloSimulation || 'Monte Carlo' },
      { keys: ['a', 's'], action: t.stressTesting || 'Stress Testing' },
      { keys: ['a', 'r'], action: t.riskLevel || 'Risk Analytics' }
    ]
  };

  return React.createElement('div', {
    className: 'command-palette-overlay',
    onClick: (e) => e.target === e.currentTarget && onClose()
  },
    React.createElement('div', { className: 'shortcuts-modal' },
      React.createElement('div', { className: 'shortcuts-modal-header' },
        React.createElement('h2', null, t.keyboardShortcuts || 'Keyboard Shortcuts'),
        React.createElement('button', {
          className: 'shortcuts-modal-close',
          onClick: onClose
        }, 'x')
      ),
      React.createElement('div', { className: 'shortcuts-modal-content' },
        Object.entries(shortcuts).map(([category, items]) =>
          React.createElement('div', { key: category, className: 'shortcuts-category' },
            React.createElement('h3', null, category),
            items.map((item, idx) =>
              React.createElement('div', { key: idx, className: 'shortcut-item' },
                React.createElement('span', null, item.action),
                React.createElement('div', { className: 'shortcut-keys' },
                  item.keys.map((key, kidx) =>
                    React.createElement('kbd', { key: kidx }, key)
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}

// ============================================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================================

function ToastContainer({ toasts, onRemove }) {
  return React.createElement('div', { className: 'toast-container' },
    toasts.map(toast =>
      React.createElement('div', {
        key: toast.id,
        className: `toast ${toast.type}`,
        onClick: () => onRemove(toast.id)
      },
        React.createElement('span', null, toast.message)
      )
    )
  );
}

function useToast() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = generateId();
    setToasts(prev => [...prev, { id, message, type }]);
    
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
    
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

// ============================================================================
// WORKSPACE TABS COMPONENT
// ============================================================================

function WorkspaceTabs({ workspaces, activeWorkspace, onSwitch, t }) {
  return React.createElement('div', { className: 'workspace-tabs' },
    Object.entries(workspaces).map(([id, workspace]) =>
      React.createElement('button', {
        key: id,
        className: `workspace-tab ${activeWorkspace === id ? 'active' : ''}`,
        onClick: () => onSwitch(id)
      }, workspace.name || id)
    )
  );
}

// ============================================================================
// CORRELATION MATRIX VIEW
// ============================================================================

function CorrelationMatrixView({ portfolio, priceHistory, t, theme, formatPrice }) {
  const [correlationData, setCorrelationData] = useState(null);
  const [selectedPair, setSelectedPair] = useState(null);

  useEffect(() => {
    if (window.CorrelationEngine && priceHistory && Object.keys(priceHistory).length > 1) {
      const matrix = window.CorrelationEngine.calculateCorrelationMatrix(priceHistory);
      const score = window.CorrelationEngine.calculateDiversificationScore(matrix);
      const extremes = window.CorrelationEngine.findExtremePairs(matrix);
      setCorrelationData({ matrix, score, extremes });
    }
  }, [priceHistory]);

  const getCorrelationColor = (value) => {
    if (value >= 0.7) return '#ef4444';
    if (value >= 0.3) return '#f59e0b';
    if (value >= -0.3) return '#6b7280';
    if (value >= -0.7) return '#3b82f6';
    return '#22c55e';
  };

  if (!correlationData) {
    return React.createElement('div', {
      style: {
        padding: '2rem',
        textAlign: 'center',
        color: theme.textSecondary
      }
    }, t.loading || 'Loading...');
  }

  const { matrix, score, extremes } = correlationData;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem'
      }
    },
      React.createElement('h2', {
        style: { color: theme.text, fontSize: '1.5rem', fontWeight: '600' }
      }, t.correlationMatrix || 'Correlation Matrix'),
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '0.75rem 1.25rem',
          borderRadius: '8px',
          border: `1px solid ${theme.cardBorder}`
        }
      },
        React.createElement('span', { style: { color: theme.textSecondary } },
          t.diversificationScore || 'Diversification Score'
        ),
        React.createElement('span', {
          style: {
            marginLeft: '0.5rem',
            fontWeight: '700',
            fontSize: '1.25rem',
            color: score.score >= 60 ? theme.success : score.score >= 40 ? theme.warning : theme.danger
          }
        }, `${score.score.toFixed(0)}/100`)
      )
    ),

    // Matrix Grid
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: `80px repeat(${matrix.symbols.length}, 60px)`,
        gap: '2px',
        marginBottom: '2rem',
        background: theme.cardBorder,
        borderRadius: '8px',
        overflow: 'hidden',
        width: 'fit-content'
      }
    },
      // Empty corner
      React.createElement('div', {
        style: { background: theme.card, padding: '0.5rem' }
      }),
      // Column headers
      ...matrix.symbols.map(symbol =>
        React.createElement('div', {
          key: `col-${symbol}`,
          style: {
            background: theme.card,
            padding: '0.5rem',
            textAlign: 'center',
            fontWeight: '600',
            color: theme.text,
            fontSize: '0.75rem'
          }
        }, symbol.substring(0, 6))
      ),
      // Rows
      ...matrix.symbols.flatMap((rowSymbol, i) => [
        // Row header
        React.createElement('div', {
          key: `row-${rowSymbol}`,
          style: {
            background: theme.card,
            padding: '0.5rem',
            fontWeight: '600',
            color: theme.text,
            fontSize: '0.75rem',
            display: 'flex',
            alignItems: 'center'
          }
        }, rowSymbol.substring(0, 8)),
        // Cells
        ...matrix.symbols.map((colSymbol, j) => {
          const value = matrix.matrix[i][j];
          return React.createElement('div', {
            key: `cell-${i}-${j}`,
            style: {
              background: i === j ? theme.card : getCorrelationColor(value),
              padding: '0.5rem',
              textAlign: 'center',
              color: i === j ? theme.textSecondary : '#fff',
              fontSize: '0.75rem',
              fontWeight: '500',
              cursor: i !== j ? 'pointer' : 'default'
            },
            onClick: () => i !== j && setSelectedPair({ 
              asset1: rowSymbol, 
              asset2: colSymbol, 
              correlation: value 
            }),
            title: `${rowSymbol} / ${colSymbol}: ${value.toFixed(2)}`
          }, i === j ? '-' : value.toFixed(2))
        })
      ])
    ),

    // Extreme pairs
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '1rem'
      }
    },
      // Most correlated
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: `1px solid ${theme.cardBorder}`
        }
      },
        React.createElement('h3', {
          style: { color: theme.text, marginBottom: '1rem', fontSize: '1rem' }
        }, t.mostCorrelatedPairs || 'Most Correlated'),
        extremes.mostCorrelated.slice(0, 5).map((pair, idx) =>
          React.createElement('div', {
            key: idx,
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0.5rem 0',
              borderBottom: idx < 4 ? `1px solid ${theme.cardBorder}` : 'none'
            }
          },
            React.createElement('span', { style: { color: theme.textSecondary } },
              `${pair.asset1} / ${pair.asset2}`
            ),
            React.createElement('span', {
              style: { color: theme.danger, fontWeight: '600' }
            }, pair.correlation.toFixed(2))
          )
        )
      ),

      // Least correlated
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: `1px solid ${theme.cardBorder}`
        }
      },
        React.createElement('h3', {
          style: { color: theme.text, marginBottom: '1rem', fontSize: '1rem' }
        }, t.leastCorrelatedPairs || 'Least Correlated'),
        extremes.leastCorrelated.slice(0, 5).map((pair, idx) =>
          React.createElement('div', {
            key: idx,
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0.5rem 0',
              borderBottom: idx < 4 ? `1px solid ${theme.cardBorder}` : 'none'
            }
          },
            React.createElement('span', { style: { color: theme.textSecondary } },
              `${pair.asset1} / ${pair.asset2}`
            ),
            React.createElement('span', {
              style: { color: theme.success, fontWeight: '600' }
            }, pair.correlation.toFixed(2))
          )
        )
      )
    )
  );
}

// ============================================================================
// MONTE CARLO SIMULATION VIEW
// ============================================================================

function MonteCarloView({ portfolio, prices, t, theme, currency, formatPrice }) {
  const [config, setConfig] = useState({
    iterations: 10000,
    years: 10,
    monthlyContribution: 500,
    expectedReturn: null,
    volatility: null
  });
  const [results, setResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);

  const runSimulation = () => {
    if (!window.MonteCarloEngine) return;
    
    setIsRunning(true);
    
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      const simResults = window.MonteCarloEngine.runSimulation(portfolio, config);
      setResults(simResults);
      setIsRunning(false);
    }, 100);
  };

  const currencySymbol = currency === 'EUR' ? 'EUR' : 'USD';

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header
    React.createElement('h2', {
      style: { color: theme.text, fontSize: '1.5rem', fontWeight: '600', marginBottom: '1.5rem' }
    }, t.monteCarloSimulation || 'Monte Carlo Simulation'),

    // Configuration
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem',
        background: theme.card,
        padding: '1.25rem',
        borderRadius: '12px',
        border: `1px solid ${theme.cardBorder}`
      }
    },
      // Iterations
      React.createElement('div', null,
        React.createElement('label', {
          style: { display: 'block', color: theme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
        }, t.iterations || 'Iterations'),
        React.createElement('select', {
          value: config.iterations,
          onChange: (e) => setConfig(prev => ({ ...prev, iterations: parseInt(e.target.value) })),
          style: {
            width: '100%',
            padding: '0.75rem',
            background: theme.inputBg,
            border: `1px solid ${theme.inputBorder}`,
            borderRadius: '8px',
            color: theme.text
          }
        },
          React.createElement('option', { value: 1000 }, '1,000'),
          React.createElement('option', { value: 5000 }, '5,000'),
          React.createElement('option', { value: 10000 }, '10,000'),
          React.createElement('option', { value: 25000 }, '25,000')
        )
      ),

      // Years
      React.createElement('div', null,
        React.createElement('label', {
          style: { display: 'block', color: theme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
        }, t.projectionYears || 'Projection Years'),
        React.createElement('input', {
          type: 'number',
          value: config.years,
          onChange: (e) => setConfig(prev => ({ ...prev, years: parseInt(e.target.value) || 10 })),
          min: 1,
          max: 50,
          style: {
            width: '100%',
            padding: '0.75rem',
            background: theme.inputBg,
            border: `1px solid ${theme.inputBorder}`,
            borderRadius: '8px',
            color: theme.text
          }
        })
      ),

      // Monthly contribution
      React.createElement('div', null,
        React.createElement('label', {
          style: { display: 'block', color: theme.textSecondary, marginBottom: '0.5rem', fontSize: '0.875rem' }
        }, t.monthlyContribution || 'Monthly Contribution'),
        React.createElement('input', {
          type: 'number',
          value: config.monthlyContribution,
          onChange: (e) => setConfig(prev => ({ ...prev, monthlyContribution: parseFloat(e.target.value) || 0 })),
          min: 0,
          style: {
            width: '100%',
            padding: '0.75rem',
            background: theme.inputBg,
            border: `1px solid ${theme.inputBorder}`,
            borderRadius: '8px',
            color: theme.text
          }
        })
      ),

      // Run button
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'flex-end' }
      },
        React.createElement('button', {
          onClick: runSimulation,
          disabled: isRunning,
          style: {
            width: '100%',
            padding: '0.75rem 1.5rem',
            background: isRunning ? theme.textSecondary : theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            fontWeight: '600'
          }
        }, isRunning ? (t.loading || 'Running...') : (t.runSimulation || 'Run Simulation'))
      )
    ),

    // Results
    results && React.createElement('div', null,
      // Summary stats
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem'
        }
      },
        // Initial Value
        React.createElement('div', {
          style: {
            background: theme.card,
            padding: '1.25rem',
            borderRadius: '12px',
            border: `1px solid ${theme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
            t.portfolioValue || 'Initial Value'
          ),
          React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700' } },
            `${formatPrice(results.initialValue)} ${currencySymbol}`
          )
        ),

        // Median outcome
        React.createElement('div', {
          style: {
            background: theme.card,
            padding: '1.25rem',
            borderRadius: '12px',
            border: `1px solid ${theme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
            t.medianOutcome || 'Median (50th)'
          ),
          React.createElement('div', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700' } },
            `${formatPrice(results.percentiles[50])} ${currencySymbol}`
          )
        ),

        // Best case
        React.createElement('div', {
          style: {
            background: theme.card,
            padding: '1.25rem',
            borderRadius: '12px',
            border: `1px solid ${theme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
            `${t.bestCase || 'Best Case'} (95th)`
          ),
          React.createElement('div', { style: { color: theme.success, fontSize: '1.5rem', fontWeight: '700' } },
            `${formatPrice(results.percentiles[95])} ${currencySymbol}`
          )
        ),

        // Worst case
        React.createElement('div', {
          style: {
            background: theme.card,
            padding: '1.25rem',
            borderRadius: '12px',
            border: `1px solid ${theme.cardBorder}`
          }
        },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
            `${t.worstCase || 'Worst Case'} (5th)`
          ),
          React.createElement('div', { style: { color: theme.danger, fontSize: '1.5rem', fontWeight: '700' } },
            `${formatPrice(results.percentiles[5])} ${currencySymbol}`
          )
        )
      ),

      // Goal probabilities
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: `1px solid ${theme.cardBorder}`,
          marginBottom: '1.5rem'
        }
      },
        React.createElement('h3', {
          style: { color: theme.text, marginBottom: '1rem', fontSize: '1rem' }
        }, t.goalProbability || 'Goal Probabilities'),
        React.createElement('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }
        },
          results.goalProbabilities.map((goal, idx) =>
            React.createElement('div', {
              key: idx,
              style: {
                textAlign: 'center',
                padding: '1rem',
                background: theme.inputBg,
                borderRadius: '8px'
              }
            },
              React.createElement('div', {
                style: { fontSize: '2rem', fontWeight: '700', color: theme.accent }
              }, `${goal.probability.toFixed(0)}%`),
              React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
                goal.label
              )
            )
          )
        )
      ),

      // Percentile table
      React.createElement('div', {
        style: {
          background: theme.card,
          padding: '1.25rem',
          borderRadius: '12px',
          border: `1px solid ${theme.cardBorder}`
        }
      },
        React.createElement('h3', {
          style: { color: theme.text, marginBottom: '1rem', fontSize: '1rem' }
        }, t.probabilityCones || 'Percentile Distribution'),
        React.createElement('table', {
          style: { width: '100%', borderCollapse: 'collapse' }
        },
          React.createElement('thead', null,
            React.createElement('tr', null,
              React.createElement('th', {
                style: { textAlign: 'left', padding: '0.75rem', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}` }
              }, t.percentile || 'Percentile'),
              React.createElement('th', {
                style: { textAlign: 'right', padding: '0.75rem', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}` }
              }, t.portfolioValue || 'Value')
            )
          ),
          React.createElement('tbody', null,
            [5, 10, 25, 50, 75, 90, 95].map(p =>
              React.createElement('tr', { key: p },
                React.createElement('td', {
                  style: { padding: '0.75rem', color: theme.text }
                }, `${p}th`),
                React.createElement('td', {
                  style: { padding: '0.75rem', textAlign: 'right', color: theme.text, fontWeight: '500' }
                }, `${formatPrice(results.percentiles[p])} ${currencySymbol}`)
              )
            )
          )
        )
      )
    )
  );
}

// ============================================================================
// STRESS TESTING VIEW
// ============================================================================

function StressTestView({ portfolio, prices, t, theme, currency, formatPrice }) {
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [results, setResults] = useState(null);
  const [comparisonResults, setComparisonResults] = useState(null);

  const scenarios = window.StressTestEngine ? window.StressTestEngine.HISTORICAL_SCENARIOS : {};

  const runScenario = (scenarioId) => {
    if (!window.StressTestEngine) return;
    
    setSelectedScenario(scenarioId);
    const scenario = scenarios[scenarioId];
    const result = window.StressTestEngine.applyStressTest(portfolio, scenario, prices);
    setResults(result);
  };

  const runComparison = () => {
    if (!window.StressTestEngine) return;
    
    const scenarioIds = Object.keys(scenarios);
    const comparison = window.StressTestEngine.runScenarioComparison(portfolio, prices, scenarioIds);
    setComparisonResults(comparison);
  };

  const currencySymbol = currency === 'EUR' ? 'EUR' : 'USD';

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header
    React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem'
      }
    },
      React.createElement('h2', {
        style: { color: theme.text, fontSize: '1.5rem', fontWeight: '600' }
      }, t.stressTesting || 'Stress Testing'),
      React.createElement('button', {
        onClick: runComparison,
        style: {
          padding: '0.75rem 1.5rem',
          background: theme.accent,
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: '600'
        }
      }, t.all || 'Run All Scenarios')
    ),

    // Scenario cards
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem'
      }
    },
      Object.entries(scenarios).map(([id, scenario]) =>
        React.createElement('div', {
          key: id,
          className: `scenario-card ${selectedScenario === id ? 'selected' : ''}`,
          onClick: () => runScenario(id),
          style: {
            background: selectedScenario === id ? 'rgba(139,92,246,0.1)' : theme.card,
            padding: '1.25rem',
            borderRadius: '12px',
            border: `2px solid ${selectedScenario === id ? theme.accent : theme.cardBorder}`,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }
        },
          React.createElement('h3', {
            style: { color: theme.text, fontSize: '1rem', marginBottom: '0.5rem' }
          }, scenario.name),
          React.createElement('p', {
            style: { color: theme.textSecondary, fontSize: '0.875rem', marginBottom: '0.75rem' }
          }, scenario.description),
          React.createElement('div', {
            style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }
          },
            Object.entries(scenario.impacts).map(([asset, impact]) =>
              impact !== 0 && React.createElement('span', {
                key: asset,
                style: {
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  fontWeight: '600',
                  background: impact < 0 ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)',
                  color: impact < 0 ? theme.danger : theme.success
                }
              }, `${asset}: ${(impact * 100).toFixed(0)}%`)
            )
          )
        )
      )
    ),

    // Results
    results && React.createElement('div', {
      style: {
        background: theme.card,
        padding: '1.5rem',
        borderRadius: '12px',
        border: `1px solid ${theme.cardBorder}`
      }
    },
      React.createElement('h3', {
        style: { color: theme.text, marginBottom: '1rem', fontSize: '1.125rem' }
      }, `${t.scenarioImpact || 'Scenario Impact'}: ${results.scenario}`),

      // Impact summary
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem'
        }
      },
        React.createElement('div', {
          style: { padding: '1rem', background: theme.inputBg, borderRadius: '8px' }
        },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
            t.portfolioValue || 'Original Value'
          ),
          React.createElement('div', { style: { color: theme.text, fontSize: '1.25rem', fontWeight: '700' } },
            `${formatPrice(results.originalValue)} ${currencySymbol}`
          )
        ),
        React.createElement('div', {
          style: { padding: '1rem', background: theme.inputBg, borderRadius: '8px' }
        },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
            t.portfolioStressed || 'Stressed Value'
          ),
          React.createElement('div', { style: { color: theme.danger, fontSize: '1.25rem', fontWeight: '700' } },
            `${formatPrice(results.stressedValue)} ${currencySymbol}`
          )
        ),
        React.createElement('div', {
          style: { padding: '1rem', background: theme.inputBg, borderRadius: '8px' }
        },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
            t.potentialLoss || 'Potential Loss'
          ),
          React.createElement('div', { style: { color: theme.danger, fontSize: '1.25rem', fontWeight: '700' } },
            `-${formatPrice(results.totalLoss)} ${currencySymbol} (-${results.lossPercent.toFixed(1)}%)`
          )
        ),
        React.createElement('div', {
          style: { padding: '1rem', background: theme.inputBg, borderRadius: '8px' }
        },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
            t.recoveryTime || 'Recovery Time'
          ),
          React.createElement('div', { style: { color: theme.text, fontSize: '1.25rem', fontWeight: '700' } },
            `${results.recoveryEstimate.months} ${t.months || 'months'}`
          )
        )
      ),

      // Category breakdown
      React.createElement('h4', {
        style: { color: theme.text, marginBottom: '0.75rem', fontSize: '1rem' }
      }, t.distribution || 'Category Breakdown'),
      React.createElement('table', {
        style: { width: '100%', borderCollapse: 'collapse' }
      },
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', { style: { textAlign: 'left', padding: '0.75rem', color: theme.textSecondary } }, 'Category'),
            React.createElement('th', { style: { textAlign: 'right', padding: '0.75rem', color: theme.textSecondary } }, 'Original'),
            React.createElement('th', { style: { textAlign: 'right', padding: '0.75rem', color: theme.textSecondary } }, 'Stressed'),
            React.createElement('th', { style: { textAlign: 'right', padding: '0.75rem', color: theme.textSecondary } }, 'Loss')
          )
        ),
        React.createElement('tbody', null,
          Object.entries(results.categoryBreakdown).map(([category, data]) =>
            React.createElement('tr', { key: category },
              React.createElement('td', { style: { padding: '0.75rem', color: theme.text, textTransform: 'capitalize' } }, category),
              React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: theme.text } },
                `${formatPrice(data.originalValue)} ${currencySymbol}`
              ),
              React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: theme.text } },
                `${formatPrice(data.stressedValue)} ${currencySymbol}`
              ),
              React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: theme.danger } },
                `-${data.lossPercent.toFixed(1)}%`
              )
            )
          )
        )
      )
    ),

    // Comparison results
    comparisonResults && React.createElement('div', {
      style: {
        marginTop: '2rem',
        background: theme.card,
        padding: '1.5rem',
        borderRadius: '12px',
        border: `1px solid ${theme.cardBorder}`
      }
    },
      React.createElement('h3', {
        style: { color: theme.text, marginBottom: '1rem', fontSize: '1.125rem' }
      }, t.historicalScenarios || 'All Scenarios Comparison'),
      React.createElement('table', {
        style: { width: '100%', borderCollapse: 'collapse' }
      },
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', { style: { textAlign: 'left', padding: '0.75rem', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}` } }, 'Scenario'),
            React.createElement('th', { style: { textAlign: 'right', padding: '0.75rem', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}` } }, 'Loss'),
            React.createElement('th', { style: { textAlign: 'right', padding: '0.75rem', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}` } }, 'Recovery')
          )
        ),
        React.createElement('tbody', null,
          comparisonResults.scenarios.map((result, idx) =>
            React.createElement('tr', { key: idx },
              React.createElement('td', { style: { padding: '0.75rem', color: theme.text } }, result.scenario),
              React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: theme.danger } },
                `-${result.lossPercent.toFixed(1)}%`
              ),
              React.createElement('td', { style: { padding: '0.75rem', textAlign: 'right', color: theme.textSecondary } },
                `${result.recoveryEstimate.months} mo`
              )
            )
          )
        )
      )
    )
  );
}

// Export components
if (typeof window !== 'undefined') {
  window.CommandPalette = CommandPalette;
  window.ShortcutsModal = ShortcutsModal;
  window.ToastContainer = ToastContainer;
  window.useToast = useToast;
  window.WorkspaceTabs = WorkspaceTabs;
  window.CorrelationMatrixView = CorrelationMatrixView;
  window.MonteCarloView = MonteCarloView;
  window.StressTestView = StressTestView;
}

})(); // End IIFE
