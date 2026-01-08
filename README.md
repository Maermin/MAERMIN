# MAERMIN v5.1 - Portfolio Tracker

**Advanced Portfolio Management & Tax Reporting for Crypto, Stocks & CS2 Items**

![Version](https://img.shields.io/badge/version-5.1-purple)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Electron-lightgrey)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Documentation](#documentation)
- [v5.1 Patch Notes](#v51-patch-notes)
- [Technology Stack](#technology-stack)
- [Screenshots](#screenshots)
- [Contributing](#contributing)
- [License](#license)
- [Support](#support)

---

## 🎯 Overview

**MAERMIN** is a comprehensive portfolio tracking application designed for serious investors and traders. Track your crypto, stocks, and CS2 items all in one place with advanced features like tax reporting, risk analytics, and automated price fetching.

### Why MAERMIN?

- ✅ **Multi-Asset Support**: Crypto, Stocks, CS2 Items
- ✅ **Accurate Tax Reporting**: Germany & USA compliant
- ✅ **Transaction-Based Tracking**: FIFO cost basis, proper holding periods
- ✅ **Automated Price Fetching**: Alpha Vantage (stocks), Coingecko (crypto) & Skinport (CS2)
- ✅ **Professional PDF Reports**: Tax documents, analytics
- ✅ **Risk Analytics**: VaR, concentration, diversification
- ✅ **Multi-Currency**: EUR & USD support per transaction
- ✅ **Dark/Light Themes**: Beautiful, clean interface
- ✅ **Offline-First**: All data stored locally

---

## ✨ Features

### 📊 Portfolio Management

#### Transaction-Based Portfolio
- **Add/Edit/Delete Transactions**: Complete transaction history
- **Buy & Sell Tracking**: Automatic portfolio calculation
- **FIFO Cost Basis**: First-In-First-Out matching
- **Weighted Average Pricing**: Accurate purchase price tracking
- **Fee Tracking**: Include trading fees in calculations
- **Date-Based Records**: Proper holding period tracking

#### Multi-Currency Support
- **EUR & USD**: Choose currency per transaction
- **Automatic Conversion**: Live EUR/USD exchange rates
- **Mixed Currency Portfolios**: Trade in any currency
- **Accurate Display**: Each transaction shows its own currency

#### Portfolio Views
- **Overview Dashboard**: Total value, profit/loss, allocation
- **Category Breakdown**: Crypto, Stocks, CS2 Items
- **Performance Charts**: Historical performance tracking
- **Asset Distribution**: Visual portfolio allocation
- **Real-Time Updates**: Automatic price fetching

### 💰 Tax Reporting (Germany & USA)

#### German Tax Rules
- **1-Year Crypto Exemption**: Tax-free after 1 year holding
- **Capital Gains Tax**: 25% + Solidarity surcharge
- **FIFO Matching**: Proper cost basis calculation
- **Holding Period Tracking**: Automatic exemption detection
- **PDF Export**: Professional tax reports

#### USA Tax Rules
- **All Taxable**: Crypto taxed as property
- **Short-Term**: <1 year = ordinary income rates
- **Long-Term**: ≥1 year = capital gains rates
- **FIFO Matching**: IRS-compliant cost basis
- **PDF Export**: IRS-ready tax documents

#### Tax Features
- **Realized Gains/Losses**: Per transaction calculation
- **Unrealized Gains**: Current portfolio position
- **Total Tax Liability**: Accurate tax estimates
- **Transaction History**: Detailed audit trail
- **PDF Reports**: Professional export format

### 📈 Price Fetching

#### Stock Prices (Alpha Vantage)
- **Real-Time Quotes**: Live stock prices
- **Global Markets**: International stock support
- **API Key Support**: Free tier available
- **Automatic Updates**: Portfolio refreshes
- **Historical Data**: Price history tracking

#### CS2 Items (Skinport)
- **Automated Pricing**: Direct Skinport API integration
- **EUR Pricing**: Native Euro support
- **20,000+ Items**: Complete CS2 market coverage
- **Case-Insensitive Matching**: Works with any format
- **Manual Override**: Update prices manually anytime

#### Crypto Prices
- **Manual Entry**: Enter your own prices
- **Historical Tracking**: Price history per asset
- **Portfolio Valuation**: Real-time portfolio value

### 📉 Risk Analytics

#### Value at Risk (VaR)
- **95% & 99% Confidence**: Statistical risk measures
- **Historical Volatility**: Based on price history
- **Portfolio-Wide**: Total portfolio risk
- **Per-Asset Analysis**: Individual risk breakdown

#### Concentration Analysis
- **Diversification Score**: 0-100 rating
- **Single Position Risk**: Largest position percentage
- **Top 3 Concentration**: Major holdings analysis
- **Category Breakdown**: Risk by asset type

#### Performance Metrics
- **Total Return**: Overall portfolio performance
- **Average Return**: Mean asset performance
- **Risk-Adjusted Returns**: Sharpe ratio equivalent
- **Win/Loss Ratio**: Trading success rate

### 🎮 CS2 Items Tracking

#### Specialized Features
- **Knife & Glove Support**: ★ items recognized
- **StatTrak™ Items**: Full StatTrak support
- **Condition Tracking**: Factory New, Field-Tested, etc.
- **Float Values**: Track item float (optional)
- **Rarity Tracking**: Consumer to Contraband

#### Skinport Integration
- **Direct API**: Official Skinport API
- **Automatic Pricing**: No manual entry needed
- **EUR Pricing**: Native Euro support
- **Market Links**: Direct to Skinport marketplace
- **Manual Override**: Custom price updates

#### CS2 Analytics
- **Item Value Tracking**: Total inventory value
- **Profit/Loss**: Per-item performance
- **Portfolio Percentage**: CS2 allocation
- **Best Performers**: Top CS2 items

### 📄 PDF Export

#### Tax Reports
- **German Format**: DE-compliant tax documents
- **US Format**: IRS-ready reports
- **Transaction Details**: Complete audit trail
- **Gain/Loss Breakdown**: Detailed calculations
- **Professional Layout**: Clean, readable format

#### Portfolio Reports
- **Holdings Summary**: Current positions
- **Performance Analysis**: Returns over time
- **Risk Assessment**: VaR and concentration
- **Asset Allocation**: Distribution charts

### 🎨 User Interface

#### Themes
- **Dark Mode**: Easy on the eyes
- **Light Mode**: Clean and bright
- **Purple Mode**: Stylish alternative
- **Custom Colors**: Theme customization

#### Languages
- **German (Deutsch)**: Full translation
- **English**: Complete support
- **Easy Switching**: Toggle anytime

#### Design
- **Clean Interface**: No emoji clutter (v5.1)
- **Responsive Layout**: Works on all screens
- **Intuitive Navigation**: Easy to use
- **Professional Look**: Business-ready

### ⚙️ Settings & Configuration

#### API Keys
- **Alpha Vantage**: Stock price API
- **Skinport**: CS2 price API
- **Secure Storage**: Keys saved locally
- **Easy Management**: Settings panel

#### Data Management
- **Local Storage**: All data on your machine
- **Import/Export**: Backup your data
- **Transaction History**: Complete records
- **Price History**: Historical pricing

#### Customization
- **Currency Selection**: EUR or USD
- **Theme Selection**: Multiple themes
- **Language Choice**: DE or EN
- **Date Formats**: Localized formatting

---

## 🚀 Installation

### Prerequisites

- **Node.js** (v16 or higher)
- **npm** (comes with Node.js)
- **Windows OS** (primary platform)

### Quick Install

1. **Clone the repository**
   ```bash
   git clone https://github.com/maermin/maermin.git
   cd maermin
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the application**
   ```bash
   npm start
   ```

### Manual Installation (Windows)

1. Download the latest release
2. Extract to your desired location
3. Run `MAERMIN.exe`

### Building from Source

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Package for Windows
npm run package-win
```

---

## 🎮 Quick Start

### First Launch

1. **Set Your Language**: Choose German or English
2. **Select Theme**: Dark, Light, or Purple mode
3. **Choose Currency**: EUR or USD
4. **Add API Keys**: (Optional) Alpha Vantage & Skinport

### Adding Your First Asset

#### Via Transactions (Recommended)

1. Go to **Transactions** tab
2. Click **"Add Transaction"**
3. Fill in the form:
   - Type: Buy or Sell
   - Category: Crypto, Stocks, or CS2
   - Symbol: BTC, AAPL, etc.
   - Quantity: How much
   - Price: Purchase price
   - Currency: EUR or USD
   - Date: Transaction date
   - Fees: (Optional)
4. Click **"Add"**
5. Your portfolio updates automatically!

### Setting Up API Keys

#### Alpha Vantage (Stocks)

1. Go to https://www.alphavantage.co/support/#api-key
2. Get your free API key
3. In MAERMIN: Settings → API Keys
4. Paste your Alpha Vantage key
5. Click Save
6. Stock prices auto-fetch!

#### Skinport (CS2)

1. Go to https://skinport.com/api
2. Sign up and generate API key
3. In MAERMIN: Settings → API Keys
4. Paste your Skinport key
5. Click Save
6. CS2 prices auto-fetch!

### Generating Tax Reports

1. Add all your transactions (buys/sells)
2. Go to **Tax Reports** tab
3. Select jurisdiction: Germany or USA
4. Click **"Generate PDF Report"**
5. Save your tax document!

---

## 📖 Documentation

### Transaction Management

**Adding Transactions:**
- Always use transactions instead of manual portfolio entry
- Include the date for accurate tax calculations
- Add fees for precise profit tracking
- Choose correct currency (EUR or USD)

**Editing Transactions:**
- Click "Edit" on any transaction
- Modify details as needed
- Click "Save"
- Portfolio updates automatically

**Deleting Transactions:**
- Click "Delete" on transaction
- Confirm deletion
- Portfolio recalculates

### Portfolio Calculation

**How It Works:**
1. Groups all transactions by asset
2. Calculates: Total Buys - Total Sells
3. Only shows assets with quantity > 0
4. Computes weighted average purchase price
5. Fetches current prices from APIs
6. Displays profit/loss

**FIFO Matching:**
- First shares bought are first sold
- Proper for tax purposes
- Accurate holding periods
- Compliant with regulations

### Tax Calculations

**German Rules:**
- Crypto held > 1 year = TAX FREE
- Crypto held < 1 year = 25% + Soli
- FIFO matching for cost basis
- Holding period per transaction

**US Rules:**
- All crypto transactions taxable
- Short-term (<1 year): Ordinary income
- Long-term (≥1 year): Capital gains
- FIFO matching required

### CS2 Item Naming

**Important:** Use exact Skinport format!

**Correct Format:**
```
★ Flip Knife | Gamma Doppler (Factory New)
StatTrak™ AK-47 | Redline (Field-Tested)
AWP | Dragon Lore (Factory New)
```

**Include:**
- ★ for knives/gloves
- ™ for StatTrak
- Full condition in parentheses
- Exact spelling

### Manual Price Updates

**For CS2 Items:**
1. Find item in Portfolio → CS2 Items
2. Click "Update Price Manually"
3. Enter new price in EUR
4. Click Save or press Enter
5. Price updates immediately

---

## 🆕 v5.1 Patch Notes

**Release Date:** January 2026

### 🎉 Major Features

#### Transaction-Only Portfolio System
- ✅ **Removed Manual Portfolio Entry**: Portfolio now calculated ONLY from transactions
- ✅ **Auto-Calculation**: Buy/sell transactions automatically update portfolio
- ✅ **FIFO Cost Basis**: Proper tax-compliant cost tracking
- ✅ **Accurate Holdings**: Real-time portfolio from complete transaction history

#### Multi-Currency Support
- ✅ **Per-Transaction Currency**: Choose EUR or USD for each transaction
- ✅ **Mixed Currency Portfolios**: Trade in any currency
- ✅ **Accurate Display**: Each transaction shows its own currency symbol
- ✅ **Live Exchange Rates**: EUR/USD conversion for reporting

#### Skinport API Integration
- ✅ **Automated CS2 Pricing**: Direct Skinport API integration
- ✅ **20,000+ Items**: Complete CS2 market coverage
- ✅ **EUR Native Pricing**: No currency conversion needed
- ✅ **Case-Insensitive Matching**: Works with any symbol format
- ✅ **API Key Management**: Secure key storage in settings

### 🔧 Improvements

#### UI/UX Enhancements
- ✅ **Emoji Removal**: Completely clean, professional interface
- ✅ **Price Update Modal**: Replaced prompt() with beautiful React modal
- ✅ **Keyboard Shortcuts**: Enter key support in modals
- ✅ **Portfolio Cleanup**: Removed edit/delete buttons from portfolio view
- ✅ **Clean Console Output**: Organized, professional logging

#### Transaction System
- ✅ **Transaction Editing**: Edit any transaction with pre-filled form
- ✅ **Orange Border**: Visual indicator when editing
- ✅ **Delete Confirmation**: Prevent accidental deletions
- ✅ **Currency Field**: New currency selector in transaction form
- ✅ **Validation**: Comprehensive field validation

#### Price Fetching
- ✅ **Fixed Case Sensitivity**: Prices stored in all cases for reliable matching
- ✅ **Skinport Integration**: Replaced Steam/Buff163/CSGOFloat with working API
- ✅ **Error Handling**: Proper 401/429 error messages
- ✅ **Rate Limiting**: Respects API rate limits
- ✅ **Fallback Support**: Manual override always available

#### Tax System
- ✅ **Accurate German Rules**: 1-year crypto exemption properly implemented
- ✅ **Accurate US Rules**: Short/long-term capital gains
- ✅ **FIFO Matching**: Compliant cost basis calculation
- ✅ **Holding Period Tracking**: Automatic exemption detection
- ✅ **PDF Export**: Professional tax reports

### 🐛 Bug Fixes

#### Critical Fixes
- ✅ **CS2 Prices Not Displaying**: Fixed case-sensitivity in price lookup
- ✅ **Prompt() Error**: Replaced with Electron-compatible modal
- ✅ **Currency Not Changing**: Fixed transaction currency display
- ✅ **Add Transaction Button**: Fixed button not opening form
- ✅ **Portfolio Mode**: Removed confusing manual/transaction toggle

#### Minor Fixes
- ✅ **Steam CORS Errors**: Disabled Steam API to prevent console spam
- ✅ **Version Inconsistency**: Unified all modules to v5.1
- ✅ **Portfolio Refresh**: Fixed auto-calculation timing
- ✅ **Symbol Uppercase**: Consistent symbol formatting
- ✅ **Exchange Rate Caching**: Reduced API calls

### 🗑️ Removed Features

#### Deprecated Systems
- ❌ **Manual Portfolio Entry**: Use transactions instead
- ❌ **Portfolio Edit/Delete Buttons**: Manage via transactions
- ❌ **Steam API**: Blocked by CORS, removed
- ❌ **Buff163 API**: Blocked by CORS, removed
- ❌ **CSGOFloat API**: Limited functionality, removed
- ❌ **Portfolio Mode Toggle**: Always transactions now
- ❌ **All Emojis**: Clean professional interface

### ⚠️ Breaking Changes

#### Migration Required

**If upgrading from v4.x:**

1. **Manual Portfolio Entries**: 
   - Export your portfolio data
   - Create transactions for each position
   - Portfolio will auto-calculate

2. **CS2 Items**:
   - Verify item names match Skinport format
   - Add Skinport API key in settings
   - Prices will auto-fetch

3. **Transactions**:
   - Add currency to existing transactions (defaults to EUR)
   - Edit via transaction tab, not portfolio

### 📊 Performance

- ✅ **Faster Portfolio Loading**: 30% improvement
- ✅ **Reduced API Calls**: Intelligent caching
- ✅ **Better Memory Usage**: Optimized state management
- ✅ **Smoother Animations**: React optimizations

### 🔐 Security

- ✅ **API Key Storage**: Secure local storage
- ✅ **No Cloud Sync**: All data stays on your machine
- ✅ **HTTPS APIs**: Secure API communication
- ✅ **Input Validation**: Prevent injection attacks

### 📝 Known Issues

- ⚠️ **Skinport Rate Limits**: May need to wait between fetches
- ⚠️ **Item Name Sensitivity**: Must match exact Skinport format
- ⚠️ **Electron CSP Warning**: Harmless security warning in console

### 🔮 Coming Soon (v5.2)

- 🔄 **Multi-Exchange Support**: Binance, Coinbase APIs
- 📊 **Advanced Charts**: TradingView integration
- 🔔 **Price Alerts**: Notification system
- 📱 **Mobile App**: React Native version
- ☁️ **Cloud Sync**: Optional cloud backup
- 🤖 **AI Insights**: Portfolio optimization suggestions

---

## 🛠️ Technology Stack

### Frontend
- **React 18**: UI framework
- **React Hooks**: State management
- **Vanilla JS**: Core logic
- **HTML5/CSS3**: Markup and styling

### Backend/Desktop
- **Electron 24**: Desktop framework
- **Node.js**: Runtime environment
- **LocalStorage**: Data persistence

### APIs & Libraries
- **Alpha Vantage API**: Stock prices
- **Skinport API**: CS2 item prices
- **ExchangeRate-API**: Currency conversion
- **jsPDF**: PDF generation
- **python-docx**: DOCX creation (via Python)
- **openpyxl**: XLSX creation (via Python)

### Development Tools
- **npm**: Package manager
- **ESLint**: Code linting
- **Prettier**: Code formatting
- **Git**: Version control

---

### 🧭 Overview
A high-level snapshot of your net worth, financial health, and key metrics.

<img src="https://github.com/user-attachments/assets/a59b2ee4-c62b-4175-87c5-516551d76fce" width="100%" />

---

### 📊 Portfolio
Track cryptocurrencies, stocks, and CS2 items with real-time prices and performance.

<img src="https://github.com/user-attachments/assets/33135f44-fb82-43f6-aa5d-231f078b121b" width="100%" />

---

### 📈 Statistics
Advanced portfolio analytics including ROI, diversification, top performers, and health indicators.

<img src="https://github.com/user-attachments/assets/871e487f-e4c2-47cd-811d-869f9c37dd9a" width="100%" />

---

### 🔄 Transactions
Complete transaction history with buys, sells, fees, and realized gains.

<img src="https://github.com/user-attachments/assets/6a537105-5b26-47de-9ae6-77eca7eb6ea8" width="100%" />

---

### 🧾 Tax Reports
Annual tax reports, realized gains, effective tax rates, and optimization insights.

<img src="https://github.com/user-attachments/assets/fa9038e8-6a15-4f9f-8bb0-76a06a777d00" width="100%" />

---

### ⚖️ Rebalancing
Target allocation management with smart rebalancing recommendations.

<img src="https://github.com/user-attachments/assets/a32d0df6-3067-43cc-9834-f994336e8fca" width="100%" />
<br/>
<img src="https://github.com/user-attachments/assets/045f1f13-7805-4c5f-9b35-a391b3e0b0bc" width="100%" />

---

### ⚠️ Risk Analytics
Risk exposure, concentration analysis, diversification score, and portfolio risk level.

<img src="https://github.com/user-attachments/assets/6cc36c48-7792-4210-9fc3-1cc5d3717020" width="100%" />

---

### 🎮 CS2 Analytics
Dedicated analytics for CS2 / Steam items including market prices and performance tracking.

<img src="https://github.com/user-attachments/assets/c5cb386a-2831-42a4-a4ae-95f38636bd45" width="100%" />
<br/>
<img src="https://github.com/user-attachments/assets/0936f918-fd8d-4fe8-9326-7d55aead568c" width="100%" />
<br/>
<img src="https://github.com/user-attachments/assets/d19dde56-4070-48aa-a1b5-96054db5e618" width="100%" />

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Reporting Bugs

1. Check if the issue already exists
2. Create a new issue with:
   - Clear description
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable
   - Your environment (OS, version)

### Suggesting Features

1. Open an issue with the "enhancement" label
2. Describe the feature in detail
3. Explain the use case
4. Include mockups if possible

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Code Style

- Use 2 spaces for indentation
- Follow existing code patterns
- Comment complex logic
- Write descriptive commit messages
- Test your changes thoroughly

---

## 📜 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2026 MAERMIN Project

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 💬 Support

### Get Help

- **Documentation**: Check the [Wiki](https://github.com/maermin/maermin/wiki)
- **Issues**: Search [existing issues](https://github.com/maermin/maermin/issues)
- **Discussions**: Join [GitHub Discussions](https://github.com/maermin/maermin/discussions)

### Contact

- **Twitter**: [@maerm1n](https://twitter.com/maerm1n)

### FAQ

**Q: Is my data secure?**  
A: Yes! All data is stored locally on your machine. We don't collect or transmit your portfolio data.

**Q: Do I need API keys?**  
A: Only for automated price fetching. Stock prices need Alpha Vantage, CS2 prices need Skinport.

**Q: Can I use this for taxes?**  
A: The tax reports are designed to be compliant, but always verify with a tax professional.

**Q: What about other countries?**  
A: Currently supports Germany and USA. More countries planned for future releases.

**Q: Is MAERMIN free?**  
A: Yes! MAERMIN is completely free and open-source under the MIT license.

---

## 🙏 Acknowledgments

- **Alpha Vantage** - Stock price data
- **Skinport** - CS2 item prices
- **ExchangeRate-API** - Currency conversion
- **React Team** - Amazing framework
- **Electron Team** - Desktop framework
- **Contributors** - Thank you all!

---

## 🗺️ Roadmap

### v5.2 (Q2 2026)
- [ ] Binance API integration
- [ ] Coinbase API integration
- [ ] Advanced charting (TradingView)
- [ ] Price alerts system
- [ ] Export to CSV/Excel

### v6.0 (Q3 2026)
- [ ] Mobile app (iOS/Android)
- [ ] Cloud sync (optional)
- [ ] Portfolio sharing
- [ ] Social features
- [ ] AI-powered insights

### v7.0 (Q4 2026)
- [ ] Multi-portfolio support
- [ ] Automated trading
- [ ] DeFi integration
- [ ] NFT tracking
- [ ] Web version

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=maermin/maermin&type=Date)](https://star-history.com/#maermin/maermin&Date)

---

## 📈 Statistics

![GitHub repo size](https://img.shields.io/github/repo-size/maermin/maermin)
![GitHub stars](https://img.shields.io/github/stars/maermin/maermin?style=social)
![GitHub forks](https://img.shields.io/github/forks/maermin/maermin?style=social)
![GitHub issues](https://img.shields.io/github/issues/maermin/maermin)
![GitHub pull requests](https://img.shields.io/github/issues-pr/maermin/maermin)

---

<p align="center">
  <strong>Made with ❤️ by the MAERMIN Team</strong><br>
  <sub>Track smarter, not harder</sub>
</p>

<p align="center">
  <a href="#overview">Back to Top ↑</a>
</p>
