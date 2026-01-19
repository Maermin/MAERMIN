// ============================================================================
// MAERMIN v6.0 - Command Palette & Keyboard Navigation System
// Power-user keyboard-first interface
// ============================================================================

/**
 * Command Registry - Central hub for all application commands
 */
const CommandRegistry = {
  commands: {},
  shortcuts: {},
  history: [],
  maxHistory: 50,

  /**
   * Register a new command
   */
  register(config) {
    const {
      id,
      label,
      shortcut,
      category,
      handler,
      icon,
      description,
      keywords = []
    } = config;

    this.commands[id] = {
      id,
      label,
      shortcut,
      category: category || 'general',
      handler,
      icon,
      description,
      keywords,
      enabled: true
    };

    if (shortcut) {
      this.shortcuts[shortcut.toLowerCase()] = id;
    }
  },

  /**
   * Execute a command by ID
   */
  execute(commandId, ...args) {
    const command = this.commands[commandId];
    if (command && command.enabled && command.handler) {
      this.addToHistory(commandId);
      return command.handler(...args);
    }
    return null;
  },

  /**
   * Search commands by query
   */
  search(query) {
    if (!query) {
      return this.getRecentCommands();
    }

    const queryLower = query.toLowerCase();
    const results = [];

    Object.values(this.commands).forEach(cmd => {
      if (!cmd.enabled) return;

      let score = 0;
      const labelLower = cmd.label.toLowerCase();
      const descLower = (cmd.description || '').toLowerCase();

      // Exact label match
      if (labelLower === queryLower) {
        score = 100;
      }
      // Label starts with query
      else if (labelLower.startsWith(queryLower)) {
        score = 80;
      }
      // Label contains query
      else if (labelLower.includes(queryLower)) {
        score = 60;
      }
      // Description contains query
      else if (descLower.includes(queryLower)) {
        score = 40;
      }
      // Keywords match
      else if (cmd.keywords.some(k => k.toLowerCase().includes(queryLower))) {
        score = 30;
      }
      // Fuzzy match
      else if (this.fuzzyMatch(queryLower, labelLower)) {
        score = 20;
      }

      if (score > 0) {
        results.push({ ...cmd, score });
      }
    });

    return results.sort((a, b) => b.score - a.score).slice(0, 15);
  },

  /**
   * Simple fuzzy matching
   */
  fuzzyMatch(query, target) {
    let queryIndex = 0;
    for (let i = 0; i < target.length && queryIndex < query.length; i++) {
      if (target[i] === query[queryIndex]) {
        queryIndex++;
      }
    }
    return queryIndex === query.length;
  },

  /**
   * Get recently used commands
   */
  getRecentCommands() {
    const recent = [];
    const seen = new Set();

    for (let i = this.history.length - 1; i >= 0 && recent.length < 10; i--) {
      const cmdId = this.history[i];
      if (!seen.has(cmdId) && this.commands[cmdId]) {
        recent.push(this.commands[cmdId]);
        seen.add(cmdId);
      }
    }

    return recent;
  },

  /**
   * Add command to history
   */
  addToHistory(commandId) {
    this.history.push(commandId);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  },

  /**
   * Get commands by category
   */
  getByCategory(category) {
    return Object.values(this.commands)
      .filter(cmd => cmd.category === category && cmd.enabled);
  },

  /**
   * Enable/disable a command
   */
  setEnabled(commandId, enabled) {
    if (this.commands[commandId]) {
      this.commands[commandId].enabled = enabled;
    }
  },

  /**
   * Get all categories
   */
  getCategories() {
    const categories = new Set();
    Object.values(this.commands).forEach(cmd => categories.add(cmd.category));
    return Array.from(categories);
  }
};

/**
 * Default commands registration
 */
function registerDefaultCommands(app) {
  // Navigation commands
  CommandRegistry.register({
    id: 'nav:overview',
    label: 'Go to Overview',
    shortcut: 'g o',
    category: 'Navigation',
    icon: 'home',
    description: 'Navigate to the main overview dashboard',
    keywords: ['home', 'dashboard', 'main'],
    handler: () => app.setActiveView('overview')
  });

  CommandRegistry.register({
    id: 'nav:portfolio',
    label: 'Go to Portfolio',
    shortcut: 'g p',
    category: 'Navigation',
    icon: 'briefcase',
    description: 'View your portfolio positions',
    keywords: ['positions', 'holdings', 'assets'],
    handler: () => app.setActiveView('portfolio')
  });

  CommandRegistry.register({
    id: 'nav:analytics',
    label: 'Go to Analytics',
    shortcut: 'g a',
    category: 'Navigation',
    icon: 'chart',
    description: 'View portfolio analytics and statistics',
    keywords: ['stats', 'charts', 'analysis'],
    handler: () => app.setActiveView('analytics')
  });

  CommandRegistry.register({
    id: 'nav:transactions',
    label: 'Go to Transactions',
    shortcut: 'g t',
    category: 'Navigation',
    icon: 'list',
    description: 'View transaction history',
    keywords: ['trades', 'history', 'buys', 'sells'],
    handler: () => app.setActiveView('transactions')
  });

  CommandRegistry.register({
    id: 'nav:taxes',
    label: 'Go to Tax Report',
    shortcut: 'g x',
    category: 'Navigation',
    icon: 'file-text',
    description: 'View tax calculations and reports',
    keywords: ['tax', 'report', 'gains'],
    handler: () => app.setActiveView('taxes')
  });

  // Action commands
  CommandRegistry.register({
    id: 'action:add-position',
    label: 'Add Position',
    shortcut: 'n',
    category: 'Actions',
    icon: 'plus',
    description: 'Add a new portfolio position',
    keywords: ['new', 'buy', 'create', 'position'],
    handler: () => app.showAddPositionModal()
  });

  CommandRegistry.register({
    id: 'action:add-transaction',
    label: 'Add Transaction',
    shortcut: 't',
    category: 'Actions',
    icon: 'plus-circle',
    description: 'Record a new transaction',
    keywords: ['trade', 'buy', 'sell', 'record'],
    handler: () => app.showTransactionModal()
  });

  CommandRegistry.register({
    id: 'action:refresh-prices',
    label: 'Refresh Prices',
    shortcut: 'r',
    category: 'Actions',
    icon: 'refresh',
    description: 'Update all asset prices',
    keywords: ['update', 'reload', 'sync'],
    handler: () => app.refreshPrices()
  });

  CommandRegistry.register({
    id: 'action:export-pdf',
    label: 'Export Tax Report PDF',
    shortcut: 'e p',
    category: 'Export',
    icon: 'file',
    description: 'Generate and download tax report as PDF',
    keywords: ['pdf', 'download', 'save', 'tax'],
    handler: () => app.exportTaxPDF()
  });

  CommandRegistry.register({
    id: 'action:export-csv',
    label: 'Export Portfolio CSV',
    shortcut: 'e c',
    category: 'Export',
    icon: 'file',
    description: 'Export portfolio data to CSV',
    keywords: ['csv', 'excel', 'spreadsheet'],
    handler: () => app.exportCSV()
  });

  CommandRegistry.register({
    id: 'action:import',
    label: 'Import Data',
    shortcut: 'i',
    category: 'Actions',
    icon: 'upload',
    description: 'Import transactions or portfolio data',
    keywords: ['upload', 'load', 'csv', 'excel'],
    handler: () => app.showImportModal()
  });

  // Analytics commands
  CommandRegistry.register({
    id: 'analytics:correlation',
    label: 'Open Correlation Matrix',
    shortcut: 'a c',
    category: 'Analytics',
    icon: 'grid',
    description: 'View asset correlation heatmap',
    keywords: ['heatmap', 'correlation', 'matrix'],
    handler: () => app.openAnalyticsPanel('correlation')
  });

  CommandRegistry.register({
    id: 'analytics:montecarlo',
    label: 'Run Monte Carlo Simulation',
    shortcut: 'a m',
    category: 'Analytics',
    icon: 'activity',
    description: 'Run portfolio projection simulation',
    keywords: ['simulation', 'projection', 'forecast'],
    handler: () => app.openAnalyticsPanel('montecarlo')
  });

  CommandRegistry.register({
    id: 'analytics:stress',
    label: 'Run Stress Test',
    shortcut: 'a s',
    category: 'Analytics',
    icon: 'alert-triangle',
    description: 'Test portfolio against historical scenarios',
    keywords: ['stress', 'scenario', 'crash', 'test'],
    handler: () => app.openAnalyticsPanel('stress')
  });

  CommandRegistry.register({
    id: 'analytics:risk',
    label: 'View Risk Analytics',
    shortcut: 'a r',
    category: 'Analytics',
    icon: 'shield',
    description: 'View comprehensive risk analysis',
    keywords: ['risk', 'var', 'volatility'],
    handler: () => app.openAnalyticsPanel('risk')
  });

  // Workspace commands
  CommandRegistry.register({
    id: 'workspace:default',
    label: 'Switch to Default Workspace',
    shortcut: 'w 1',
    category: 'Workspaces',
    icon: 'layout',
    description: 'Load default workspace layout',
    handler: () => app.switchWorkspace('default')
  });

  CommandRegistry.register({
    id: 'workspace:tax',
    label: 'Switch to Tax Season Workspace',
    shortcut: 'w 2',
    category: 'Workspaces',
    icon: 'layout',
    description: 'Load tax-focused workspace layout',
    handler: () => app.switchWorkspace('tax-season')
  });

  CommandRegistry.register({
    id: 'workspace:analysis',
    label: 'Switch to Deep Analysis Workspace',
    shortcut: 'w 3',
    category: 'Workspaces',
    icon: 'layout',
    description: 'Load analysis-focused workspace layout',
    handler: () => app.switchWorkspace('deep-analysis')
  });

  CommandRegistry.register({
    id: 'workspace:save',
    label: 'Save Current Workspace',
    shortcut: 'w s',
    category: 'Workspaces',
    icon: 'save',
    description: 'Save current panel layout as workspace',
    handler: () => app.saveWorkspace()
  });

  // Settings commands
  CommandRegistry.register({
    id: 'settings:theme-light',
    label: 'Switch to Light Theme',
    category: 'Settings',
    icon: 'sun',
    description: 'Use light color scheme',
    handler: () => app.setTheme('white')
  });

  CommandRegistry.register({
    id: 'settings:theme-dark',
    label: 'Switch to Dark Theme',
    category: 'Settings',
    icon: 'moon',
    description: 'Use dark color scheme',
    handler: () => app.setTheme('dark')
  });

  CommandRegistry.register({
    id: 'settings:theme-purple',
    label: 'Switch to Purple Theme',
    category: 'Settings',
    icon: 'palette',
    description: 'Use purple color scheme',
    handler: () => app.setTheme('purple')
  });

  CommandRegistry.register({
    id: 'settings:currency-eur',
    label: 'Set Currency to EUR',
    category: 'Settings',
    icon: 'euro',
    description: 'Display values in Euros',
    handler: () => app.setCurrency('EUR')
  });

  CommandRegistry.register({
    id: 'settings:currency-usd',
    label: 'Set Currency to USD',
    category: 'Settings',
    icon: 'dollar',
    description: 'Display values in US Dollars',
    handler: () => app.setCurrency('USD')
  });

  CommandRegistry.register({
    id: 'settings:language-de',
    label: 'Switch to German',
    category: 'Settings',
    icon: 'globe',
    description: 'Use German language',
    handler: () => app.setLanguage('de')
  });

  CommandRegistry.register({
    id: 'settings:language-en',
    label: 'Switch to English',
    category: 'Settings',
    icon: 'globe',
    description: 'Use English language',
    handler: () => app.setLanguage('en')
  });

  CommandRegistry.register({
    id: 'settings:api-keys',
    label: 'Configure API Keys',
    category: 'Settings',
    icon: 'key',
    description: 'Set up API keys for price data',
    handler: () => app.showApiSettings()
  });

  // Backup commands
  CommandRegistry.register({
    id: 'backup:create',
    label: 'Create Backup',
    shortcut: 'b c',
    category: 'Backup',
    icon: 'download',
    description: 'Create a backup of all data',
    handler: () => app.createBackup()
  });

  CommandRegistry.register({
    id: 'backup:restore',
    label: 'Restore from Backup',
    shortcut: 'b r',
    category: 'Backup',
    icon: 'upload',
    description: 'Restore data from a backup file',
    handler: () => app.showRestoreBackupModal()
  });

  // Window commands
  CommandRegistry.register({
    id: 'window:detach-panel',
    label: 'Detach Current Panel',
    shortcut: 'ctrl+shift+d',
    category: 'Window',
    icon: 'external-link',
    description: 'Open current panel in a new window',
    handler: () => app.detachCurrentPanel()
  });

  CommandRegistry.register({
    id: 'window:fullscreen',
    label: 'Toggle Fullscreen',
    shortcut: 'f11',
    category: 'Window',
    icon: 'maximize',
    description: 'Enter or exit fullscreen mode',
    handler: () => app.toggleFullscreen()
  });

  // Alert commands
  CommandRegistry.register({
    id: 'alerts:create',
    label: 'Create Price Alert',
    shortcut: 'l',
    category: 'Alerts',
    icon: 'bell',
    description: 'Set up a new price alert',
    handler: () => app.showCreateAlertModal()
  });

  CommandRegistry.register({
    id: 'alerts:manage',
    label: 'Manage Alerts',
    category: 'Alerts',
    icon: 'bell',
    description: 'View and manage price alerts',
    handler: () => app.showAlertsPanel()
  });

  // Quick add via text input
  CommandRegistry.register({
    id: 'quick:add',
    label: 'Quick Add Transaction',
    shortcut: ':',
    category: 'Quick Actions',
    icon: 'zap',
    description: 'Add transaction via text command (e.g., "buy 10 BTC @ 50000")',
    handler: () => app.showQuickAddInput()
  });

  // Help
  CommandRegistry.register({
    id: 'help:shortcuts',
    label: 'Show Keyboard Shortcuts',
    shortcut: '?',
    category: 'Help',
    icon: 'help-circle',
    description: 'Display all keyboard shortcuts',
    handler: () => app.showShortcutsModal()
  });

  CommandRegistry.register({
    id: 'help:about',
    label: 'About MAERMIN',
    category: 'Help',
    icon: 'info',
    description: 'Show application information',
    handler: () => app.showAboutModal()
  });
}

/**
 * Keyboard Navigation Manager
 */
const KeyboardManager = {
  keyBuffer: '',
  keyTimeout: null,
  bufferDelay: 500,
  vimMode: false,
  listeners: [],

  /**
   * Initialize keyboard handling
   */
  init() {
    document.addEventListener('keydown', (e) => this.handleKeydown(e));
  },

  /**
   * Handle keydown events
   */
  handleKeydown(e) {
    // Ignore if in input/textarea
    if (this.isInputFocused() && !e.ctrlKey && !e.metaKey) {
      return;
    }

    // Handle command palette toggle
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      this.emit('toggle-palette');
      return;
    }

    // Handle escape
    if (e.key === 'Escape') {
      this.keyBuffer = '';
      this.emit('escape');
      return;
    }

    // Build key string
    let keyStr = '';
    if (e.ctrlKey) keyStr += 'ctrl+';
    if (e.metaKey) keyStr += 'cmd+';
    if (e.altKey) keyStr += 'alt+';
    if (e.shiftKey) keyStr += 'shift+';
    keyStr += e.key.toLowerCase();

    // Check for direct shortcut
    const directCommand = CommandRegistry.shortcuts[keyStr];
    if (directCommand) {
      e.preventDefault();
      CommandRegistry.execute(directCommand);
      return;
    }

    // Handle multi-key shortcuts (like 'g o')
    if (!e.ctrlKey && !e.metaKey && e.key.length === 1) {
      this.keyBuffer += e.key.toLowerCase();
      
      // Clear buffer after delay
      clearTimeout(this.keyTimeout);
      this.keyTimeout = setTimeout(() => {
        this.keyBuffer = '';
      }, this.bufferDelay);

      // Check for buffer match
      const bufferCommand = CommandRegistry.shortcuts[this.keyBuffer.split('').join(' ')];
      if (bufferCommand) {
        e.preventDefault();
        this.keyBuffer = '';
        CommandRegistry.execute(bufferCommand);
      }
    }
  },

  /**
   * Check if an input element is focused
   */
  isInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    
    const tagName = active.tagName.toLowerCase();
    return tagName === 'input' || 
           tagName === 'textarea' || 
           active.contentEditable === 'true';
  },

  /**
   * Add event listener
   */
  on(event, callback) {
    this.listeners.push({ event, callback });
  },

  /**
   * Emit event
   */
  emit(event, data) {
    this.listeners
      .filter(l => l.event === event)
      .forEach(l => l.callback(data));
  },

  /**
   * Toggle vim mode
   */
  setVimMode(enabled) {
    this.vimMode = enabled;
  }
};

/**
 * Quick Add Parser - Parse text commands into transactions
 */
const QuickAddParser = {
  /**
   * Parse a quick add command string
   * Formats:
   * - "buy 10 BTC @ 50000"
   * - "sell 5 ETH @ 3000 fee 10"
   * - "buy 100 AAPL"
   */
  parse(input) {
    const result = {
      type: null,
      symbol: null,
      amount: null,
      price: null,
      fees: 0,
      errors: []
    };

    const parts = input.trim().toLowerCase().split(/\s+/);
    
    // Type (buy/sell)
    if (parts[0] === 'buy' || parts[0] === 'b') {
      result.type = 'buy';
    } else if (parts[0] === 'sell' || parts[0] === 's') {
      result.type = 'sell';
    } else {
      result.errors.push('Must start with "buy" or "sell"');
      return result;
    }

    // Amount
    const amountIndex = 1;
    if (parts[amountIndex]) {
      const amount = parseFloat(parts[amountIndex]);
      if (!isNaN(amount) && amount > 0) {
        result.amount = amount;
      } else {
        result.errors.push('Invalid amount');
      }
    } else {
      result.errors.push('Amount required');
    }

    // Symbol
    const symbolIndex = 2;
    if (parts[symbolIndex]) {
      result.symbol = parts[symbolIndex].toUpperCase();
    } else {
      result.errors.push('Symbol required');
    }

    // Price (optional, after @)
    const atIndex = parts.indexOf('@');
    if (atIndex !== -1 && parts[atIndex + 1]) {
      const price = parseFloat(parts[atIndex + 1]);
      if (!isNaN(price) && price > 0) {
        result.price = price;
      } else {
        result.errors.push('Invalid price');
      }
    }

    // Fees (optional, after "fee" or "fees")
    const feeIndex = parts.findIndex(p => p === 'fee' || p === 'fees');
    if (feeIndex !== -1 && parts[feeIndex + 1]) {
      const fees = parseFloat(parts[feeIndex + 1]);
      if (!isNaN(fees)) {
        result.fees = fees;
      }
    }

    return result;
  },

  /**
   * Validate parsed result
   */
  validate(parsed) {
    return parsed.errors.length === 0 && 
           parsed.type && 
           parsed.symbol && 
           parsed.amount;
  },

  /**
   * Format parsed result as confirmation string
   */
  format(parsed) {
    if (!this.validate(parsed)) {
      return `Error: ${parsed.errors.join(', ')}`;
    }

    let str = `${parsed.type.toUpperCase()} ${parsed.amount} ${parsed.symbol}`;
    if (parsed.price) {
      str += ` @ ${parsed.price}`;
    }
    if (parsed.fees) {
      str += ` (fee: ${parsed.fees})`;
    }
    return str;
  }
};

// Export for use in renderer
if (typeof window !== 'undefined') {
  window.CommandRegistry = CommandRegistry;
  window.KeyboardManager = KeyboardManager;
  window.QuickAddParser = QuickAddParser;
  window.registerDefaultCommands = registerDefaultCommands;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CommandRegistry,
    KeyboardManager,
    QuickAddParser,
    registerDefaultCommands
  };
}
