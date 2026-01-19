# MAERMIN v6.0 - Desktop Power User Edition

Multi-Asset Portfolio Tracker and Financial OS for tracking Crypto, Stocks, and CS2 Items.

## New Features in v6.0

### 1. Multi-Window Architecture
- Detach any panel into its own window
- Synchronized state across all windows
- Independent panel layouts

### 2. Advanced Analytics
- **Monte Carlo Simulation**: Run 10,000+ iterations to project portfolio growth
- **Correlation Matrix**: Analyze asset relationships
- **Stress Testing**: Test against historical scenarios (2008 crisis, COVID crash, etc.)
- **Enhanced Risk Metrics**: VaR, CVaR, Sharpe Ratio, Sortino Ratio

### 3. Command Palette (Ctrl+K)
- Quick access to all features
- Keyboard-first navigation
- Custom shortcuts

### 4. Workspace System
- Save and restore workspace layouts
- Pre-built workspaces: Default, Tax Season, Deep Analysis, Daily Check
- Custom workspace creation

### 5. Backup System
- AES-256 encrypted backups
- Manual and auto-backup scheduling
- One-click restore

### 6. Bulk Import/Export
- Support for major brokers: Interactive Brokers, DEGIRO, Trade Republic, Coinbase, Binance, Kraken
- Auto-detect broker format
- Column mapping wizard
- CSV, JSON, Excel support

### 7. Price Alerts
- Set alerts for price thresholds
- Desktop notifications
- Multiple condition types

### 8. Plugin Framework
- Extend functionality with plugins
- Easy plugin installation

## Installation

### Option 1: Development Mode
```bash
cd MAERMIN-v6.0
npm install
npm start
```

### Option 2: Build Installer
```bash
cd MAERMIN-v6.0
npm install
npm run build:win   # Windows
npm run build:mac   # macOS
npm run build:linux # Linux
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+K | Command Palette |
| g o | Go to Overview |
| g p | Go to Portfolio |
| g a | Go to Analytics |
| g t | Go to Transactions |
| a c | Correlation Matrix |
| a m | Monte Carlo Simulation |
| a s | Stress Testing |
| w 1-3 | Switch Workspace |
| n | Add Position |
| t | Add Transaction |
| r | Refresh Prices |
| ? | Show Shortcuts |

## File Structure

```
MAERMIN-v6.0/
  main.js                    # Electron main process
  preload.js                 # IPC bridge
  index.html                 # Main HTML
  renderer.js                # Main React application
  renderer-components.js     # UI components
  
  # Core Engines
  translations-complete.js   # DE/EN translations
  validation-comprehensive.js# Input validation
  calculator-extended.js     # Financial calculations
  tax-calculation-engine.js  # Tax calculations (DE/US)
  tax-pdf-export.js         # PDF report generation
  
  # Risk & Analytics
  risk-analytics.js         # VaR, volatility, risk metrics
  risk-analytics-view-v2.js # Risk analytics UI
  cs2-advanced.js           # CS2 item analytics
  cs2-analytics-view-v2.js  # CS2 analytics UI
  
  # v6.0 New Engines
  monte-carlo-engine.js     # Portfolio simulation
  correlation-engine.js     # Asset correlation
  stress-test-engine.js     # Historical stress tests
  command-palette.js        # Keyboard navigation
  import-export-engine.js   # Bulk data operations
  
  package.json              # Build configuration
```

## Requirements

- Node.js 18+
- npm or yarn

## API Keys

For full functionality:
- **Alpha Vantage**: For stock prices (free tier available)
- **Skinport**: For CS2 item prices (optional)

## Tax Support

- German tax law (with 1-year crypto exemption)
- US tax law (short/long-term capital gains)
- PDF report export

## Notes

- Data is stored locally using localStorage
- Backup files can be encrypted with AES-256
- All calculations are performed client-side

## Version History

- v6.0.0: Multi-Window, Monte Carlo, Correlation, Stress Testing, Command Palette, Workspaces, Backup System, Plugin Framework
- v5.1.0: Tax Engine, CS2 Analytics, Risk Analytics
- v5.0.0: Initial Electron desktop version
