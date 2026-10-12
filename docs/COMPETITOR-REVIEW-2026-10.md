# Competitor review, October 2026 — feature deep dive vs MAERMIN

Compiled 12 Oct 2026. Basis for PLAN.md Phase 5 (v12 "Atlas"). This file contains everything gathered in the review, in three parts:

1. **Feature deep dive and gap analysis** — scope, MAERMIN v11 baseline (checked in code), per-tracker feature lists, feature matrix vs MAERMIN, prioritized improvements.
2. **Hands-on review and depth ratings** — live demos, own accounts (getquin, CoinTracking), source code of open-source trackers, MAERMIN local demo; scores per tracker and area; new findings and ideas.
3. **Appendix: raw hands-on notes** — the working notes taken while clicking through each product.

Privacy note: getquin and CoinTracking were checked read-only in real free-plan accounts; no amounts, holdings or personal details from those accounts are included.

---

# Part 1 — Feature deep dive and gap analysis


## 1. Scope, method and confidence

This document lists the features of 13 portfolio trackers in detail and compares each with MAERMIN, so that gaps can be turned into work items.

**Revision 2 (12 Oct 2026):** the first version used the older v10 README. Against v11.0 code, four earlier "gaps" were wrong: CSV export, news feed, returns heatmap and closed positions all exist. This revision also adds a depth comparison for the closest competitors, based on their help centres and docs.

**Revision 3 (12 Oct 2026):** hands-on review added as a second tab. Four live demos were clicked (Parqet, Ghostfolio, DivvyDiary, Snowball), three open-source trackers were read in code, and MAERMIN was run locally in demo mode. This corrected two more rows: Portfolio Performance has 141 PDF importers, not 90+, and Ghostfolio's X-ray is a rule checker, not a fund look-through.

**Tools covered in depth (vendor pages opened):** Parqet, getquin, Finanzfluss Copilot, DivvyDiary, Portfolio Performance, Wealthfolio, Ghostfolio, Sharesight, Snowball Analytics, Stock Events, Simply Wall St, Kubera, Delta by eToro.

**Tools covered briefly (search snippets and general knowledge, not re-verified):** crypto tax and DeFi tools (Koinly, Blockpit, CoinTracking, Zerion, DeBank), budget and multibanking apps (Finanzguru, Outbank, MoneyMoney, YNAB, Monarch, Empower), and research platforms (Morningstar, TradingView, Seeking Alpha, Yahoo Finance).

**How to read the claims**

- Feature lists come from the vendors' own pages. Marketing pages often name a feature without saying how deep it goes; where a page is silent, this document says "not stated" instead of guessing.
- Prices change often and sources disagree. Treat every price as a range and check the vendor page before acting on it.
- MAERMIN's column is checked against the code of main at commit e31179b (12 Oct 2026, v11.0): modules, views in nav-model.js, and the test suite (144 suites, all passing). "Has" means present in code with tests; it was not clicked through in a browser.
- Ratings of usability are judgements from public descriptions, not hands-on tests.

Status legend used in the matrix: **Has** (documented in MAERMIN), **Partial** (exists but narrower), **Planned** (in a PLAN.md package), **Gap** (not present and not planned).

## 2. MAERMIN baseline (v11.0, checked in code)

MAERMIN v11.0 is a client-side, privacy-first multi-asset tracker with about 50,000 lines of JavaScript in \~120 modules and 144 passing test suites ([repo](https://github.com/Maermin/MAERMIN), commit e31179b). Phases 1 to 4 of [PLAN.md](https://github.com/Maermin/MAERMIN/blob/main/PLAN.md) are shipped.

**Navigation (from nav-model.js):** Portfolio (Overview, Portfolios, Net Worth, Watchlist, Rebalancing) · Transactions (Transactions, Savings Plans, Import/Export, Cash Flow, Journal) · Dividends · Analysis (Returns & XIRR, Performance, Attribution, Health Score, Portfolio Intelligence, Risk & Correlation, Strategy, Fee Analyzer, Discovery, News Feed) · Tax & FIFO · Settings (Customize, Categories, Tags, Alerts & Rules, Share & Compare, Trash, Privacy). Simple mode hides 14 advanced views.

**Assets and portfolio core**

- Crypto, stocks, ETFs, commodities, CS2 skins (Steam picker plus public-inventory import), options (long/short calls and puts), custom categories, cash, loans, time deposits with act/365 interest, real assets with valuation history, financing link and net rental yield.
- Multiple portfolios, combined or per-portfolio overview; open and closed positions with realized P&L from one FIFO ledger; position chart with average-cost line; journal; watchlist with targets and notes; tags; reorderable overview sections; daily value snapshots.
- Bonds exist only as a stress-test label; there is no bond asset type with coupons.

**Import, export, data quality**

- CSV: 10 wizard tiles (CoinTracking, Portfolio Performance, Parqet, DEGIRO, Trade Republic, Scalable, IBKR, Coinbase, Binance, Kraken) plus a generic mapper that auto-detects Trading 212, Revolut, flatex, Consorsbank and Bitpanda; saved mapping presets. getquin is listed but has no export to import.
- On-device PDF parsing for 5 institutions (Trade Republic, Scalable, ING, DKB, Comdirect).
- Read-only exchange sync for Binance, Kraken, Coinbase, Bitpanda.
- Exports: transactions as CSV, full JSON backup, encrypted vault backup, tax report as Excel and PDF, Anlage KAP table, AI copy-prompt (redacted or full text).
- Data check with stable DQ codes and one fix action per finding; pre-migration backup.

**Performance and analytics**

- XIRR and TWR; monthly returns heatmap with compounded quarters and years; snapshot performance cards (1D to Max); FX attribution; treemap performance map; cash-flow chart.
- Benchmarks MSCI World, FTSE All-World, S&P 500, Nasdaq 100 (plus custom in the engine) with alpha, beta, tracking error, information ratio, R-squared.
- Risk: correlation matrix, Monte Carlo, stress tests, VaR, CVaR, Sharpe, Sortino, max drawdown, rolling volatility, Fama-French.
- ETF X-Ray from Yahoo top holdings via Worker, with a built-in fallback of top-10 holdings for common index ETFs.
- Health score, Portfolio Intelligence (10 checks), advisor, fee analyzer with TER drag, strategy views, discovery screener, news feed per held symbol via Worker.
- Rebalancing with tolerance bands, invest-only mode and never-sell holdings; allocation backtester.

**Income and tax**

- Dividend calendar, trailing-12-month forecast, safety scoring, yield on cost, earnings calendar, auto-booking of dividends.
- German tax: FIFO, Vorabpauschale, Teilfreistellung, Sparerpauschbetrag, Soli, church tax, two loss pots within a year, crypto one-year rule with Freigrenze countdown, Anlage KAP mapping, Freistellungsauftrag per broker, withholding tax for 21 countries. US short/long-term gains.
- No loss carry-forward across years, no sell simulator, no Vorabpauschale forecast for next year.

**Planning, alerts, sharing, security, platform**

- FIRE, withdrawal survival, Monte Carlo success; goals; savings plans with auto-booking and DCA adherence.
- Alert rules and Risk Monitor with local notifications only (no web push).
- Redacted share links, anonymous benchmark, read-only MCP over the redacted snapshot.
- AES-256-GCM vault (PBKDF2-600k), passkey, recovery code, key rotation, auto-lock, E2E sync, 30-day trash with undo, audit log, CSP, no telemetry.
- PWA with offline use and a phone layout, five themes, German and English, command palette, demo mode, Worker deploy button and version check.

**Corrections to the first version:** the DRIP simulation was removed in the 2026-10 cleanup, so it is no longer a feature. CSV export, news feed, returns heatmap and closed positions exist; the first version missed them.

## 3. DACH trackers in detail

### Parqet ([parqet.com](https://parqet.com/), [pricing](https://parqet.com/pricing))

- **Assets:** stocks, ETFs, crypto in one view; "other assets" (cash, crypto, gold, real estate) are counted separately and capped on the free plan.
- **Import:** "zero-click" PDF drag-and-drop; broker integrations directory (broker list not stated on the homepage); Bitpanda sync announced as coming soon. Integration slots per plan: 2 / 5 / 20.
- **Analytics:** wealth development since first purchase, combined weighting by asset class, industry, country; X-Ray for ETF overlap; performance comparison; dozens of filters and "Views"; Tags.
- **Dividends:** dashboard with calendar of announced and expected payouts up to 24 months ahead, 35,000+ dividend securities, filters, forecast, cash-flow planning.
- **Tax:** a tax dashboard exists on paid plans; depth not stated on the vendor pages.
- **AI/API:** connects to Claude and ChatGPT with the user's real holdings, sectors and cash flows; developer portal for third-party apps.
- **Platforms:** web, iOS, Android, app widgets (1 to 3). Data stored in Germany.
- **Plans:** Basis free (1 portfolio, 5 other assets); Plus 11.99 EUR/month (5 portfolios, full analysis); Investor 29.99 EUR/month (15 portfolios, 20 integrations). Export and API limits not stated.
- **Usability read:** very low setup effort (under 5 minutes claimed), polished apps; the gating of X-Ray, forecast and tax behind paid tiers is the main complaint.

**Depth check (Parqet's own articles: [TTWROR](https://parqet.com/en/blog/true-time-weighted-rate-of-return), [heatmap](https://parqet.com/en/blog/performance-heatmap), [X-Ray](https://parqet.com/x-ray)):**

- Returns: TTWROR for all users, per portfolio and per holding; capital-weighted return as the older metric. IRR is not mentioned.
- "What-if" comparison (paid): simulates the same cash flows invested in an index fund such as FTSE All-World. MAERMIN's backtester tests a fixed allocation, not the user's own cash flows.
- Heatmap: monthly, quarterly and yearly cells; click a cell for start/end value, return and number of activities; paid filters by asset type or holding; web only. MAERMIN's heatmap is month by year without drill-down or filters.
- X-Ray: splits every ETF into all underlying companies (full holdings, "several thousand" for broad indices), maps synthetic ETFs to a physical twin, and shows sector, industry and country. MAERMIN uses Yahoo top holdings and a top-10 fallback, so look-through covers only the largest positions.
- Also listed: news feed for portfolios and watchlists, dividend calendar 24 months ahead (MAERMIN: trailing 12 months).

### getquin ([getquin.com](https://www.getquin.com/), [pricing](https://www.getquin.com/pricing/))

- **Assets:** ETFs, stocks and more; full asset-class list not stated.
- **Connections:** bank and broker connections via API integrations, "thousands of providers"; unlimited connections even on the free plan.
- **Analytics:** live prices, KPIs, benchmarking against the market, historical views, allocation breakdown, AI risk rating.
- **Dividends and cash flow:** dividend tracker with upcoming payments and income forecast (paid), monthly cash-flow view for budgeting.
- **Planning:** goals (retirement, home, financial independence), personal retirement plan, scenarios, "AI financial agents" (Wealth tier).
- **Social:** community, stock forum, public performance sections, learning articles.
- **Platforms:** web, iOS, Android; English and German; claims 500k+ users.
- **Plans:** Free 0 EUR; Premium 89.99 EUR/year; Wealth 149.99 EUR/year.
- **Usability read:** best free tier for automatic bank/broker sync in DACH; the social layer is a differentiator MAERMIN deliberately does not have.

**Depth check ([help centre, 56 articles](https://help.getquin.com/en/collections/3762633-2-portfolio-dashboard), [Premium article](https://help.getquin.com/en/articles/6817043)):**

- Returns: TTWROR with monthly and yearly heatmaps, IRR, an article on IRR vs TTWROR, "Monthly Rewind", total return chart, sold-positions overview.
- Dividends: yield on cost, TTM yield, payout CAGR, dividend growth forecast up to 40 years, intra-year forecast, automatic reinvestment, automatic taxes and tax-free allowance, bond coupons, push notifications.
- Analysis: "DeepDive" real allocation including ETF holdings, ETF replication methods, ongoing costs, geography, currency and asset-type breakdowns, AI portfolio analysis.
- Net worth: clearing account, insurances, cash accounts (automatic or manual), budgets, cash-flow component.
- Data handling: ISIN changes, splits and spin-offs, broker reconciliation article, trading-venue choice, portfolio currency change, CSV export.
- Sharing: portfolio link, shared access (Wealth tier), push alerts on price moves, phone widgets.
- Note: getquin offers no CSV export that MAERMIN can import (MAERMIN's own wizard says so).

### Finanzfluss Copilot ([page](https://finanzfluss.de/copilot/), [pricing](https://finanzfluss.de/copilot/preise/))

- **Scope:** net worth dashboard across bank accounts, depots, credit cards, crypto, real estate, commodities and alternative assets.
- **Connections:** automatic import from 350+ providers through a BaFin-regulated partner; PDF drag-and-drop for unsupported banks; manual entry.
- **Budgeting:** household budget, categorised income and expenses, Sankey-style cash-flow chart; 1 budget on free, unlimited on Plus.
- **Analytics:** per-position key figures, breakdown, performance comparison against indices or securities (Plus), advanced stock, yield and dividend metrics (Plus).
- **Dividends:** past and upcoming calendar, personal yield (Plus).
- **Export:** CSV of transactions (Plus only).
- **Security:** encrypted on German servers, no data sale, cannot execute transactions.
- **Plans:** Free; Plus 5.83 EUR/month or 69.99 EUR/year, 7-day trial.
- **Usability read:** strongest all-in-one for bank plus depot plus budget in German; investment analytics are shallower than Parqet or Portfolio Performance.

### DivvyDiary ([divvydiary.com](https://divvydiary.com/en/))

- **Focus:** dividend income only. Database of 68,000+ dividend stocks and ETFs.
- **Features:** per-day calendar of expected payments, past and future; yield on cost, dividend growth, annual total; securities screener; gross/net, light/dark, EUR/USD display options.
- **Alerts:** new-dividend notifications by email or push, daily/weekly/monthly.
- **Export/sync:** upcoming pay dates and ex-dividend dates sync to the user's own calendar.
- **Platforms:** web app, iOS, Android; free sign-up and a demo portfolio without registration.
- **Not stated:** API, data sources, update frequency, paid-tier differences.

**Plans ([pricing](https://divvydiary.com/en/pricing)):** Scrimper free (1 portfolio, personal calendar, direct broker integration, mobile notifications). Aristocrat 7.50 EUR/month billed 89.99 EUR/year (5 portfolios, net dividend calculation, calendar export, dividend backtesting and forecasts, community benchmark, ETF and fund deep dives, cash accounts with interest, bonds with coupon history).

## 4. Open source and local trackers in detail

### Portfolio Performance ([site](https://www.portfolio-performance.info/en/), [manual](https://help.portfolio-performance.info/en/))

- **Model:** desktop app (Windows, macOS, Linux; Eclipse Public License) plus a mobile app; data in a local XML file, export to CSV or JSON.
- **Transactions:** deposit, buy, sell, delivery in/out, transfer, dividend, interest and interest charge, fees, taxes; bonds; investment plans; grouped accounts.
- **Performance:** true time-weighted return (TTWROR) and IRR for single holdings and the whole portfolio; reporting periods; purchase value and acquisition-cost methodology; benchmarking how-to.
- **Reports:** statement of assets, performance dashboard (calculation, chart, securities, payments, trades), freely configurable dashboard KPIs.
- **Classification:** taxonomies for any custom classification, rebalancing against a user-defined target allocation.
- **Quotes:** Yahoo Finance, Alpha Vantage, EODHD, Morningstar, CoinGecko, CSV, JSON and HTML table feeds, built-in provider for German and US stocks; ECB exchange rates for foreign-currency accounts.
- **Import:** CSV, PDF (large set of community bank importers, new ones requestable) and Interactive Brokers Flex Query.
- **Corporate actions:** documented handling of splits, spin-offs, mergers, insolvency, choice dividends and GBX-priced securities.
- **Not stated:** tax reports, Monte Carlo, alerts, sync.
- **Usability read:** the reference for correctness and flexibility in DACH; steep learning curve and a dated desktop interface.

**Depth check ([PDF import manual](https://help.portfolio-performance.info/en/reference/file/import/pdf-import/)):** The manual says more than 90 banks and brokers; the source code has 141 PDF extractor classes. MAERMIN parses 5. This is the single largest import gap for DACH users.

### Wealthfolio ([site](https://wealthfolio.app/), [docs](https://wealthfolio.app/docs/))

- **Model:** local-first, open source; macOS, Windows, Linux, iPhone, iPad, Android, or self-hosted in Docker; no account needed; each install keeps its own local database.
- **Four areas:** Investments, Net Worth, Spending, Planning.
- **Investments:** holdings, performance, allocation, income; account comparison; benchmark against S&P 500 or any ETF; sector and geographic exposure; cost basis and lots; market data and FX providers; custom price feeds.
- **Rebalancing:** target weights, drift measurement, generated rebalance plan.
- **Spending:** auto-categorised transactions, budgets, cash-flow breakdown.
- **Planning:** goals and save-up planner with glide paths, retirement and FIRE year-by-year simulation, Monte Carlo risk lab, contribution limits for IRA, 401(k), TFSA.
- **Import:** CSV from any source; paid Connect adds automatic broker imports.
- **Connect (paid, price not stated):** broker auto-import, end-to-end encrypted device sync, household sharing, background updates.
- **AI and extensibility:** AI assistant, MCP server for agent access, add-on system (fees tracker, goal tracker, trading tracker, community add-ons).
- **Also:** Health Center, export and backup.
- **Closest architectural peer to MAERMIN.** Strengths over MAERMIN: native apps, spending and budgets, add-on API. Weakness: no tax reporting stated.

**Depth check ([performance metrics](https://wealthfolio.app/docs/concepts/performance-metrics), [activity types](https://wealthfolio.app/docs/concepts/activity-types)):**

- Metrics: daily-compounded TWR, XIRR by bisection, simple value return, annualised return, volatility from daily log returns, max drawdown with peak, trough, recovery date and duration, and a **performance attribution** that splits value change into contributions, distributions, income, realized P&L, unrealized change, FX, fees, taxes and a residual.
- 13 activity types (buy, sell, split, dividend, interest, credit, deposit, withdrawal, transfer in/out, fee, tax, adjustment) with subtypes such as DRIP, dividend in kind, staking reward, bonus, fee refund and option expiry.
- Holdings named in the docs: stocks, ETFs, options with multiplier, bonds with coupons as interest, crypto, funds, cash.
- MAERMIN comparison: MAERMIN has TWR, XIRR, drawdown and FX attribution, but no full value-change attribution (contributions vs income vs fees vs taxes), no explicit deposit/withdrawal/transfer cash flows per broker, and no bond type.
- Connect and MCP pages could not be fetched; pricing and MCP scope remain unconfirmed.

### Ghostfolio ([GitHub](https://github.com/ghostfolio/ghostfolio))

- **Model:** AGPL-3.0, self-hosted via Docker (amd64, arm) or paid managed cloud (Premium); NestJS, Angular, PostgreSQL, Redis. The vendor homepage needs JavaScript, so only the README was readable.
- **Features:** multi-account transactions, performance as return on average investment for Today, WTD, MTD, YTD, 1Y, 5Y, Max, various charts, static analysis that flags portfolio risks, import and export of transactions, dark and Zen mode, PWA.
- **Data sources:** Yahoo, CoinGecko, manual, and a Premium-only Ghostfolio source.
- **API:** Bearer-token REST for import and export; duplicate activities rejected.
- **Security:** token login, optional OpenID Connect (experimental), security headers option.
- **AI:** experimental MCP server, off by default, read scopes that hide monetary values unless granted import permission.
- **Not stated on the pages read:** dividend calendar, tax, X-Ray details (the product is known for an X-Ray risk check, but this was not verified here).

**Depth check (third-party summary, [openapps.pro](https://openapps.pro/apps/ghostfolio); not the vendor):** X-Ray rules with customizable thresholds (concentration, asset-class imbalance, diversification), benchmark comparison, FIRE calculator on real portfolio data, AI assistant via OpenRouter models, tokenised read-only "impersonation" view for sharing, seven pluggable market-data providers (Yahoo, CoinGecko, Alpha Vantage, EOD Historical Data, Financial Modeling Prep, Google Sheets, scraper). No dedicated dividend reporting is described.

## 5. International trackers in detail

### Sharesight ([features](https://www.sharesight.com/features/), [pricing](https://www.sharesight.com/pricing/))

- **Coverage:** stocks, ETFs, funds, crypto in 60+ markets; cash accounts and property alongside; precious metals and superannuation pages exist. The page gives two different security counts (240,000+ and 700,000+).
- **Import:** automatic trade import from 200+ brokers; partner directory.
- **Automation:** dividends, dividend reinvestment plans and splits are updated automatically.
- **Reports:** performance, sold securities, all trades, diversity, exposure, contribution analysis, multi-currency valuation, future income, drawdown risk, multi-period (Premium only), tax reports and tax planning, labels and filtering.
- **Sharing:** portfolio and tax reports shared with an accountant; Xero integration; developer API.
- **Security:** SOC 2, GDPR, two-factor authentication.
- **Plans (USD):** Free (1 portfolio, 10 holdings, no tax reports); Starter 7/month annual; Standard 18/month; Premium 23.25/month (10 portfolios).
- **Usability read:** tax-report first; strongest for accountant hand-off in AU/UK/CA/US/NZ markets; no German tax.

### Snowball Analytics ([site](https://snowball-analytics.com/), [pricing](https://snowball-analytics.com/pricing/))

- **Connections:** 1,000+ brokers via Yodlee, report import from 15 brokers, 70+ exchanges, 25+ currencies.
- **Assets:** stocks, ETFs, mutual funds; custom holdings.
- **Dividends:** tracker, calendar, ex-dividend calendar, payout growth, dividend rating for income safety, withholding-tax settings, calculators; push and email notifications.
- **Analysis:** benchmarking (index funds on low tiers, any asset on higher), Sharpe and other risk-adjusted ratios, diversification by sector, country, region and asset class, fund look-through, categories with strategies per portfolio, one-click rebalancing, planned monthly purchases.
- **Research data:** 5 to 10 years fundamentals, 10 to 30+ years backtests, "Why is it moving" (Investor and above).
- **Community:** public portfolios, popular assets, news blog; MCP integration for AI apps (Expert tier, no detail).
- **Plans (USD):** Free (1 portfolio, 10 holdings); Starter 79.99/year; Investor 149.99/year; Expert 249.99/year.
- **Not stated:** tax reports.

**Depth check ([features](https://snowball-analytics.com/features)):**

- Returns: IRR as net annual return; total profit including dividends, realized P&L, fees and dividend taxes; profit chart split by source (capital gain, dividends, realized); returns by month or year; best and worst contributors per period.
- Risk: beta, Sharpe (SPY benchmark, 5-year Treasury as risk-free rate), Sortino, weighted portfolio P/E; dividend rating from 13 fundamental parameters.
- Dividends: received history, next-year forecast, 3-year growth, 5-year average growth, calendar with announced vs estimated dates, company payment history; before/after-tax views per portfolio.
- Rebalancing: buy suggestions to target, top-up for one category, and sales plan for partial withdrawals.
- Benchmark: replays the user's own buys and sells into a chosen fund, optionally with dividends reinvested.
- Connections: Yodlee and SnapTrade plus broker reports and CSV. Export, alerts and look-through are not described on this page.
- MAERMIN comparison: MAERMIN's risk set is larger; Snowball leads on "profit by source", the cash-flow-replay benchmark and withdrawal planning in rebalancing.

### Stock Events ([stockevents.app](https://stockevents.app/))

- **Assets:** stocks, ETFs, crypto, commodities.
- **Calendar:** dividends plus economic events (US, Canada, EU inflation and rate decisions) and earnings dates.
- **Market layer:** market summary, top gainers and losers, curated collections, key-driver news tied to holdings, analyst buy/hold/sell ratings.
- **Platforms:** iOS and Android (rated 4.8), web.
- **Not stated:** alerts, widgets, imports or broker connections, free/Pro limits. Reviewers ask for sector and fund-holdings analysis, so analytics are shallow.

### Simply Wall St ([plans](https://simplywall.st/plans))

- **Focus:** company research reports (visual "snowflake" analysis) plus portfolios. Free allows 5 reports per month, Premium 30, Unlimited no cap.
- **Portfolio limits:** Free 1 portfolio and 10 holdings; Premium 3 portfolios and 30 holdings; Unlimited no cap on either.
- **Other:** 3 watchlists with 50 stocks each, screener results (top 4 on free), curated ideas, dividend analysis, equity curve (12 months on free, all time paid), smart portfolio updates, Charlie AI, export to Excel and PDF (top tier only).
- **Prices:** not stated on the plans page.

### Kubera ([kubera.com](https://www.kubera.com/))

- **Positioning:** net worth for high-net-worth users and families, not trading analytics.
- **Assets:** stocks, bonds, funds, crypto, DeFi, NFTs, staking and lending, real estate and physical items, private investments with capital calls, distributions and IRR, liabilities, cash and stablecoins; net worth can be shown in Bitcoin.
- **Connections:** multiple aggregators with best-connector selection, web sync for institutions without a connection, manual live tickers.
- **Reporting:** daily net-worth snapshots, allocation across dimensions, ownership views by person, trust or entity, nested portfolios (Black), multi-currency, cash forecasting, "Fast Forward" what-if scenarios, "Proof of Wealth" statement, club benchmarks against peers.
- **Sharing:** multi-user sharing with granular permissions, Dead Man's Switch delivering the portfolio to beneficiaries.
- **AI:** works with Claude, ChatGPT and others; an agent can read emailed statements and update balances.
- **Plans (USD):** Essentials 250/year, Black 2,500/year, Gold 10,000/year; 14-day trial.

### Delta by eToro ([page](https://www.etoro.com/investing/delta/))

- **Assets:** stocks, crypto, funds, forex, indices, commodities, ETFs; multiple portfolios.
- **Connections:** 10,000+ brokers, exchanges, banks and wallets claimed; syncs with eToro accounts.
- **Analytics:** asset analytics, price and custom alerts; PRO adds portfolio insights, advanced metrics (realised and unrealised gains), automatic live updates, unlimited connections and "Why is it moving?".
- **Not stated:** PRO price, free-tier limits, widgets, watchlists.

## 6. Other categories (shorter, not re-verified on vendor pages)

These entries come from earlier search snippets and general knowledge. Treat them as directional; open the vendor page before building against them.

**Crypto tax and DeFi (Koinly, Blockpit, CoinTracking, CoinLedger, Zerion, DeBank)**

- Typical features: hundreds of exchange and wallet integrations via API and on-chain addresses, automatic transaction matching (transfers between own wallets), DeFi/staking/NFT classification, country-specific tax reports (Germany: Anlage SO, FIFO/LIFO choice), tax-loss harvesting, filing-software export.
- MAERMIN comparison: MAERMIN has four exchange syncs and the German one-year rule, but no on-chain wallet tracking and no DeFi classification.

**Budget and multibanking (Finanzguru, Outbank, MoneyMoney, YNAB, Monarch, Empower)**

- Typical features: bank aggregation (PSD2 in the EU, Plaid/Yodlee in the US), automatic categorisation, recurring-payment detection, budgets, net-worth trend, contract and subscription cancellation helpers (Finanzguru), retirement planner and fee analyzer (Empower).
- MAERMIN comparison: MAERMIN tracks net worth but has no bank transaction aggregation, budgeting or categorisation, which is a deliberate privacy trade-off.

**Research and market platforms (Morningstar, TradingView, Seeking Alpha, Yahoo Finance, Finanzen.net)**

- Typical features: fund and stock ratings, portfolio X-Ray with style box and cost analysis, technical charting with indicators, screeners, earnings and economic calendars, news, analyst consensus, alerts.
- MAERMIN comparison: MAERMIN has an ETF X-Ray, screeners, an earnings calendar and a news feed for held symbols, but no technical charting and no analyst ratings.

## 7. Feature matrix: competitors vs MAERMIN

MAERMIN v11 leads on risk analytics, German tax and privacy. It trails on import breadth, look-through depth, return analysis drill-down, cash-flow bookkeeping, push notifications and native apps. Status: **Lead** = deeper than any competitor checked, **Par** = comparable depth, **Shallower** = present but narrower, **Gap** = absent in code. Abbreviations: PP Portfolio Performance, WF Wealthfolio, GF Ghostfolio, SS Sharesight, SB Snowball, CF Copilot, DD DivvyDiary.

| Area | Feature | MAERMIN scope (v11 code and demo) | Best competitor scope (hands-on where possible) | Status |
| --- | --- | --- | --- | --- |
| Assets | Stocks, ETFs, crypto, commodities | Yes | All | Par |
| Assets | Options | Long/short calls and puts, moneyness, est. P&L | WF: options with multiplier, expiry adjustment | Par |
| Assets | Bonds with coupons | Label only, no type | WF, PP, getquin, DD (coupon history) | Gap |
| Assets | Real estate, loans, time deposits | Valuation history, financing, act/365 interest | Kubera: entities, private equity, capital calls | Par for private users |
| Assets | Insurance, private equity | No | getquin (insurances), Kubera | Gap |
| Assets | Collectibles (CS2) and custom categories | Yes | none | Lead |
| Import | PDF statements | 5 institutions | PP: 141 PDF importers (source code) | Shallower |
| Import | CSV | 10 tiles plus auto-detect for 5 more, presets | PP generic CSV, GF/WF CSV, SB report import | Par |
| Import | Automatic bank/broker aggregation | No | getquin, CF (350+), SB (Yodlee, SnapTrade), SS (200+), Delta, Kubera | Gap |
| Import | Exchange API sync | 4 exchanges, read-only | Delta, Kubera (many) | Shallower |
| Import | Migration from other trackers | PP and Parqet exports | WF CSV, GF JSON | Lead |
| Bookkeeping | Deposits, withdrawals, transfers, fees, taxes as own transactions | Only buy, sell, dividend, interest | WF 13 activity types, PP full set, getquin clearing account | Gap |
| Bookkeeping | Corporate actions | Splits, reverse splits (auto-detect) | PP: spin-offs, mergers, insolvency, choice dividends; getquin ISIN change | Shallower |
| Returns | TWR and XIRR | Yes | Parqet TTWROR, getquin TTWROR + IRR, WF TWR + XIRR | Par |
| Returns | Heatmap | Month x year, compounded | Parqet: month/quarter/year, drill-down, filters per asset type and holding | Shallower |
| Returns | Value-change attribution (contributions, income, fees, taxes, FX) | FX attribution only | WF full attribution, SB profit by source | Shallower |
| Returns | Benchmark | 4 presets with alpha, beta, TE, IR, R-squared | Parqet what-if replay of own cash flows; SB replay into any fund | Lead on stats, gap on replay |
| Returns | Closed positions | Yes, FIFO realized P&L | getquin sold positions, SS sold securities | Par |
| Analytics | ETF look-through | Yahoo top-10 holdings, fallback for common ETFs | Parqet full holdings (16,000+ in the demo), synthetic-ETF mapping; getquin DeepDive; Snowball X-Ray Funds | Shallower |
| Analytics | Risk metrics | VaR, CVaR, Monte Carlo, stress, Fama-French, Sharpe, Sortino | SB beta, Sharpe, Sortino; WF volatility, drawdown | Lead |
| Analytics | Structural checks | Health score, 10 Intelligence checks, advisor | GF X-Ray rules (customizable thresholds) | Lead |
| Analytics | Custom classification | Tags, custom categories | PP taxonomies (any hierarchy), Parqet Views | Shallower |
| Analytics | Fees and TER | Fee analyzer, TER drag | getquin ongoing costs, WF fee add-on | Lead |
| Analytics | News | News feed per held symbol | Parqet news for portfolios and watchlists, Stock Events key drivers | Par |
| Analytics | Company research, analyst ratings | No | Simply Wall St, Stock Events, Parqet Terminal | Gap (by scope) |
| Income | Dividend forecast horizon | Trailing 12 months | Parqet 24 months, getquin growth forecast to 40 years | Shallower |
| Income | Dividend metrics | Safety score, YoC | getquin payout CAGR, TTM yield; SB 13-factor rating; DD growth | Par |
| Income | Net dividend after withholding | 21 countries, reclaim estimate | DD net calculation, SB withholding setting | Lead |
| Income | Calendar export (ICS) | No | DD | Gap |
| Tax | German tax | VAP, TF, KAP, FSA, loss pots, crypto countdown | Parqet tax dashboard (depth not stated), getquin automatic tax and allowance | Lead |
| Tax | Loss carry-forward across years | No | not stated by competitors | Gap |
| Tax | Non-DE/US tax reports | No | SS multi-country | Gap (by decision) |
| Planning | FIRE, Monte Carlo success, backtester | Yes | WF FIRE + Monte Carlo lab, getquin retirement plan, GF FIRE | Par |
| Planning | Saving goals with glide path | Goals in Strategy | WF save-up planner, getquin saving goals and habit tracker | Shallower |
| Planning | Rebalancing | Bands, invest-only, never-sell | SB withdrawal plan, WF drift plan | Par |
| Alerts | Rules and risk monitor | Many rule types, local notification | Delta, getquin price push, DD dividend push | Lead on rules |
| Alerts | Push when app is closed | No | getquin, DD, SB, Delta | Gap |
| Budget | Spending, budgets | No | CF, WF, getquin budgets | Gap |
| Sharing | Redacted share, anonymous benchmark | Yes | Kubera club benchmarks, DD community benchmark | Par |
| Sharing | Shared access for partner/advisor | No | getquin shared access, Kubera, SS, WF Connect household | Gap |
| AI | AI access | Copy-prompt export, read-only MCP over redacted snapshot | Parqet Claude/ChatGPT connector, WF MCP, GF AI assistant, Kubera agent | Shallower (by design) |
| Export | Transactions CSV, JSON backup, tax Excel/PDF | Yes | getquin CSV, CF CSV (paid), PP CSV/JSON | Par |
| Export | Statement of assets PDF | No | Kubera Proof of Wealth | Gap |
| Security | Encryption and privacy | Client vault, passkey, key rotation, E2E sync, CSP | WF local + E2E Connect sync | Lead |
| Platform | App form | PWA, phone layout, offline | Native iOS/Android with widgets: Parqet, getquin, SB, DD, WF | Shallower |
| Platform | Languages | DE, EN | getquin DE/EN, PP many (translation teams) | Par |
| Platform | Setup effort | Own Cloudflare Worker (about 5 minutes) | Parqet, getquin: none | Shallower |

## 8. Gap analysis and prioritized improvements

The most valuable next step is cash-flow bookkeeping (deposits, withdrawals, fees and taxes as their own transactions), because the return heatmap, attribution and benchmark replay all depend on it. Effort uses PLAN.md's scale (S up to half a day, M 1 to 3 days, L over 3 days); estimates are mine. Items marked "REVIEW #n" are already proposed in docs/REVIEW-2026-09.md.

### Tier 0: quick fixes and first impression (from the hands-on review)

Details, scores per tracker and 14 further ideas are in Part 2.

| # | Fix or improvement | Effort |
| --- | --- | --- |
| F1 | Intelligence labels Bitcoin a "single company" held "across ETFs and single stocks"; exclude crypto or reword | S |
| F2 | Default rebalancing targets give every user 10% CS2 skins; default to the user's own classes or no target | S |
| F3 | "Total bought" card is labelled "Total deposited" | S |
| F4 | Tax & FIFO is below the fold of the desktop sidebar; move it up or group settings | S |
| D1 | Richer demo (30+ positions, two portfolios, savings plan, 10+ payers, a fund with Vorabpauschale, a taxed sale) | M |
| D2 | Bundled sample data so news, discovery, FX attribution and period returns are not empty in demo mode | S to M |
| D3 | XIRR, TWR, realized, dividends received, taxes, fees and net return on the overview | S |
| D5 | Public demo link that opens straight into demo mode | S |

### Tier 1: high value, fits the privacy model

| # | Improvement | Evidence (who does it deeper) | Effort | Notes |
| --- | --- | --- | --- | --- |
| 1 | Cash-flow transaction types: deposit, withdrawal, transfer, fee, tax, plus a clearing account per broker | WF 13 activity types, PP, getquin clearing account; REVIEW #14 | L | Today only buy, sell, dividend, interest exist. Needs ledger, importer and migration work, tests first |
| 2 | Value-change attribution and "profit by source" | WF attribution (contributions, income, realized, unrealized, FX, fees, taxes, residual); SB profit split | M | Builds on #1 and the existing FX attribution |
| 3 | Benchmark replay of the user's own cash flows ("what if I had bought the index") | Parqet what-if, SB benchmark replay | M | Reuse the allocation backtester and price history |
| 4 | Full ETF look-through beyond top-10 holdings | Parqet full holdings plus synthetic-ETF mapping, getquin DeepDive | M to L | Needs a holdings source via the Worker (issuer holdings files); check licence terms per issuer |
| 5 | Heatmap drill-down and filters | Parqet: click for start/end value and activity count, filter by asset type or holding, quarterly view | S to M | returns-heatmap.js has no click handler today |
| 6 | Longer dividend forecast and growth projection | Parqet 24 months, getquin up to 40 years with payout CAGR | S to M | Today trailing 12 months only |
| 7 | ICS calendar export for dividends, earnings and savings-plan dates | DivvyDiary | S | Pure client-side |
| 8 | Bond asset type with coupons and maturity | WF, PP, getquin, DivvyDiary | M | Reuse interest-engine.js |
| 9 | More corporate actions: spin-off, merger, ISIN change | PP how-tos, getquin ISIN change | M | Extends corporate-actions.js |

### Tier 2: German-investor differentiators (already sketched in REVIEW)

| # | Improvement | Evidence | Effort | Notes |
| --- | --- | --- | --- | --- |
| 10 | Loss carry-forward across years per pot | REVIEW #4; not stated by competitors | M | Loss pots exist within a year only |
| 11 | Crypto and stock sell simulator ("if I sell X today") | REVIEW #9 | S | Uses existing FIFO lots and tax advisor |
| 12 | Vorabpauschale forecast and cash reminder | REVIEW #6 | S | December/January notification |
| 13 | Allowance harvesting plan (realise gains up to the Sparerpauschbetrag) | REVIEW #5 | S to M | Extends tax-advisor.js |
| 14 | Jahressteuerbescheinigung reconciliation | REVIEW #3 | M | New PDF parser plus diff view |
| 15 | Statement of assets as password-protected PDF | REVIEW #13; Kubera Proof of Wealth | S | Reuse tax-report PDF code |

### Tier 3: reach and convenience

| # | Improvement | Evidence | Effort | Notes |
| --- | --- | --- | --- | --- |
| 16 | More PDF importers (flatex, Consorsbank, DEGIRO, onvista, Baader, Smartbroker) | PP 141 PDF importers | M each | PLAN.md lists some broker importers as "decided against"; owner decision needed |
| 17 | Web push through the Worker | getquin, DivvyDiary, Snowball, Delta | M | Needs VAPID keys and subscription storage on the user's Worker; keep payloads content-free |
| 18 | Saving goals with glide path and on-track status | WF save-up planner, getquin saving goals | S to M | Extends Strategy goals |
| 19 | Hierarchical taxonomies | PP taxonomies, Parqet Views | M | Extend tags and custom categories |
| 20 | Serverless sync transports (file, WebDAV) | REVIEW #10 | M | Lowers dependence on the Worker |

### Decided against or in conflict with the model

| Item | Who has it | Why not now |
| --- | --- | --- |
| Automatic bank and broker aggregation | getquin, CF, SB, SS, Delta, Kubera | Needs a licensed aggregator and a server that sees data |
| Live prices without own Worker | Parqet, getquin | Shared hosted Worker decided against; setup friction stays the main onboarding cost |
| Native apps and widgets | Parqet, getquin, SB, DD, WF | Large cost; PWA plus push (#17) closes part of the gap |
| Shared access with full data | getquin, Kubera, SS, WF Connect | Would need per-recipient encryption |
| MCP over full data | Parqet, WF, Kubera | Deferred in PLAN.md Phase 4 |
| Budgets and spending | CF, WF, getquin | Scope creep; no bank data source |
| Other tax systems (AT, CH, UK) | SS (UK and others) | Decided against in PLAN.md |
| Company research and analyst ratings | Simply Wall St, Stock Events | Different product category |

### Where MAERMIN already leads

Risk analytics (VaR, CVaR, stress tests, Fama-French), structural checks (Intelligence, health score), German tax depth (Vorabpauschale, Teilfreistellung, Anlage KAP, Freistellungsauftrag, crypto countdown, withholding tax for 21 countries), CS2 and custom assets, migration import from Portfolio Performance and Parqet, and the client-side vault with key rotation. No competitor page read states equivalents; confirm with hands-on trials before using this in marketing.

### Caveats

- MAERMIN was checked in code and tests, not clicked through in a browser.
- Competitor depth comes from help centres and docs; Sharesight reports, Wealthfolio Connect and MCP, Copilot features and Parqet integrations pages could not be fetched. Ghostfolio depth comes from a third-party summary.
- Prices were not rechecked beyond the cited pages.


---

# Part 2 — Hands-on review and depth ratings

## Method and rating scale

Four trackers were clicked through in their live demos, two in real free-plan accounts (getquin, CoinTracking), three were read in their source code, and four need an account and were rated from their docs only. All checks ran on 12 Oct 2026.

| Tracker | How it was checked | Evidence |
| --- | --- | --- |
| Parqet | Live demo, not signed in, all analysis tabs, dividends, activities, one holding, integrations | [demo](https://parqet.com/demo) |
| MAERMIN v11 | Local build of commit e31179b in headless Chromium, demo mode, all 29 views, desktop 1440x900 and phone 390x844 in German, no Worker | repo + screenshots |
| Ghostfolio | Live demo (all pages) plus source code | [demo](https://ghostfol.io/en/demo), [repo](https://github.com/ghostfolio/ghostfolio) |
| DivvyDiary | Live demo portfolio, all five tabs | [demo](https://divvydiary.com/en/p/24094) |
| Snowball Analytics | Public demo portfolio, all seven tabs | [demo](https://snowball-analytics.com/public/portfolios/dpawdnmreb) |
| Portfolio Performance | Source code (desktop app cannot be clicked here) | [repo](https://github.com/portfolio-performance/portfolio) |
| Wealthfolio | Source code (no web demo; desktop app) | [repo](https://github.com/wealthfolio/wealthfolio) |
| Stock Events, Simply Wall St | Public stock and event pages; portfolios need login | [Stock Events](https://stockevents.app/en/stock/MSFT), [Simply Wall St](https://simplywall.st/stocks/us/software/nasdaq-msft/microsoft) |
| getquin and CoinTracking (free-plan accounts); Finanzfluss Copilot, Sharesight, Kubera, Delta | getquin and CoinTracking clicked read-only in free-plan accounts; the other four from docs only (account required) | see main tab |

**Scale.** Depth 1 to 5: 1 = absent or a single number, 3 = solid standard feature, 5 = deepest seen in this review. Quality 1 to 5: correctness, clarity and polish as observed; "n/r" = not rated because it could not be used. Ratings are my judgement from one session per product, not user testing.

## Scores at a glance

MAERMIN scores highest on risk, German tax and privacy, and lowest on import breadth, AI/API access and first-run experience. Parqet and Portfolio Performance set the bar for import, returns and allocation; DivvyDiary for dividends; Wealthfolio for data checks and AI access. Depth 1 to 5 per area; "n/r" = not observable in this review; rows marked (docs) were not clicked.

| Tracker | Import | Returns | Allocation and look-through | Risk | Dividends | German tax | Planning | Data checks | AI and API | Privacy | UX and platform |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MAERMIN v11 | 3 | 4 | 3 | 5 | 3 | 5 | 4 | 3 | 2 | 5 | 3 |
| Parqet | 5 | 5 | 5 | 2 | 5 | 2 | 1 | n/r | 5 | 2 | 5 |
| Portfolio Performance | 5 | 5 | 5 | 4 | 4 | 2 | 2 | 3 | 1 | 5 | 2 |
| Wealthfolio | 3 | 4 | 3 | 2 | 3 | 1 | 4 | 5 | 5 | 5 | 4 |
| Ghostfolio | 2 | 3 | 4 | 2 | 2 | 1 | 2 | 2 | 3 | 4 | 4 |
| DivvyDiary | 3 | 3 | 2 | 1 | 5 | 1 | 1 | n/r | 1 | 2 | 4 |
| Snowball Analytics | 4 | 4 | 4 | 3 | 4 | 1 | 2 | n/r | 3 | 2 | 5 |
| getquin (free-plan account) | 5 | 4 | 4 | 2 | 4 | 2 | 4 | n/r | 3 | 2 | 4 |
| CoinTracking (free-plan account, crypto only) | 5 | 2 | 1 | 1 | 1 | 4 (crypto section 23 only) | 1 | 5 | 3 | 2 | 3 |
| Sharesight (docs) | 4 | 4 | 3 | 3 | 3 | 1 | 1 | n/r | 3 | 3 | n/r |

How MAERMIN's lower scores arise: Import 3 (5 PDF banks vs 141 in PP, no aggregation); AI and API 2 (redacted read-only MCP, no third-party API); UX 3 (thin demo, empty Worker-only views, long desktop sidebar).

## Parqet (live demo)

Parqet is the most complete DACH tracker seen: every number links to activities, and the same month-by-year tables run through returns, capital, trades and dividends. Its German tax view is shallow; MAERMIN is clearly deeper there. The demo is a real-looking ING portfolio: 40 positions, two depots, 900+ activities since Jan 2023.

| Area | What the demo shows | Depth | Quality | vs MAERMIN |
| --- | --- | --- | --- | --- |
| Dashboard | Value, invested, cash flow, IRR, TTWROR, price gain, realized, dividends, interest, total return, taxes, fees, net return; chart tabs value, performance, drawdown, dividends, returns | 5 | 5 | MAERMIN overview shows none of IRR, TWR, realized, taxes, fees |
| Allocation | 10 dimensions: asset, asset class, product type, sector, industry (38), region, country (49), company size, currency, securities; CSV export | 5 | 5 | MAERMIN: asset class, sector, country, currency, size in separate views |
| X-Ray | Splits ETFs into all holdings: top list plus "16,466 further positions"; CSV export; works in the free demo | 5 | 5 | MAERMIN: top-10 per fund |
| Returns | Month x year table with quarter toggle, all gains included; performance map (treemap) with Today view | 4 | 5 | Par (MAERMIN has quarters and year totals too) |
| Capital flow | Monthly net in/outflows per year with average and sum row | 4 | 4 | Gap |
| Fees | Per-fund TER cost for the last 12 months, price gain and dividend share, sold positions toggle | 4 | 3 (same ETF listed twice, once per depot) | Par (MAERMIN fee analyzer + TER) |
| Trades | Realized gains per month; top and loss trades with holding period and return | 4 | 4 | Shallower (MAERMIN closed positions, no ranking or holding period) |
| Taxes | Taxes paid per year by activity type (from broker data); withholding per country with expected refund | 2 | 3 (Ireland refund of 25% looks wrong for Irish funds) | MAERMIN leads: computes VAP, TF, KAP, FSA |
| Dividends | Six views (monthly, accumulated, breakdown, forecast); gross vs net and personal yield; trailing year vs previous; announced dividends; per-asset table with interval, payout CAGR 3Y/5Y, YoC | 5 | 5 | Shallower in MAERMIN (calendar, 12-month forecast, safety score) |
| Activities | Grouped by year and month with totals; monthly "Snapshot" rows from broker sync to reconcile positions | 4 | 4 | MAERMIN has a flat list with sort options |
| Holding page | Value, performance, drawdown, quote and overlay charts; per-holding heatmap; IRR and TTWROR; justETF deep-dive link | 5 | 5 | Shallower |
| Integrations | 41 apps on the Parqet Connect API: ChatGPT (9.6K installs), Claude (6.4K), rebalancer, a third-party Vorabpauschale calculator, Sparerpauschbetrag calculator, Home Assistant, CLI, messenger bot | 5 | 4 | MAERMIN builds these in; no API for third parties |
| Data sources | Quotes from Gettex, L&S, Ariva and others; ETF data from issuer fact sheets; dividends mainly from DivvyDiary | n/a | n/a | MAERMIN: Yahoo and CoinGecko via own Worker |

Usability: opens in seconds without login, dense but coherent, phone layout with hamburger menu. The free plan gates the portfolio-wide heatmap filters and some analyses; the demo shows everything.

## MAERMIN v11 (local demo)

MAERMIN ran all 29 views without a single page error, and its analysis depth matches or beats every competitor on risk and German tax. The first impression is weaker than its depth: the demo holds only 6 positions and 11 transactions, the overview hides the return figures, and many views show an empty state without a Worker.

| Area | What the demo shows | Depth | Quality | Notes |
| --- | --- | --- | --- | --- |
| Onboarding | Password vault (12+ chars), encryption at rest on by default, recovery code screen, demo banner with exit | 4 | 5 | Clear security wording |
| Overview | Value chart, 4 cards (cost basis, unrealised gain, expected dividends 12M, health score), allocation by class, top performers, open/closed positions | 3 | 4 | No XIRR, TWR, realized, dividends received, taxes or fees here |
| Returns | XIRR, TWR (total and p.a.), total return, holding period, bought, value, proceeds, fees; month x year heatmap with Q1 to Q4 and year, partial-period markers, explanatory note | 4 | 5 | "Total bought" is labelled "Total deposited" |
| Performance and attribution | Treemap; per-holding contribution in percentage points; decomposition with estimated tax if realised now | 4 | 4 | Period returns and FX attribution empty in demo |
| Health and intelligence | Score 52/D with four sub-scores; ranked findings across ten checks | 5 | 3 | Bug: Bitcoin flagged as "single company" with exposure "across ETFs and single stocks" (the check in portfolio-intelligence.js does not exclude crypto) |
| Risk | Correlation matrix with diversification score and most/least correlated pairs, Monte Carlo, stress tests, risk level | 5 | 4 | Deepest risk set in the review |
| Rebalancing | Targets with tolerance bands, invest-only, never-sell; plan table | 4 | 3 | App-wide default target of 10% CS2 skins suggests buying 4,370 EUR of skins |
| Dividends | Calendar, forecast, auto-fetch, auto-book, safety table, YoC | 3 | 4 | Only one payer in the demo, so the view looks empty |
| Tax | FIFO table, tax report, realized vs unrealized, disclaimer; German rules in depth | 5 | 4 | Tax & FIFO sits below the fold of the desktop sidebar at 900 px height |
| Fees | Fee rate, by year and class, most expensive trades, TER cost and weighted TER | 4 | 5 | Par with Parqet |
| Worker-only views | Discovery, News, publish share, FX attribution | n/r | n/r | Empty states in the demo |
| Navigation | Desktop sidebar with 25 entries in Advanced mode; phone dock Portfolio, Buchungen, Dividenden, Analyse, Steuern, Setup | 4 | 3 | Phone nav is cleaner than desktop; German number formats correct |

Other checks: 0 page errors; dark design consistent across views; German UI complete on the phone screens checked.

## Ghostfolio (live demo and source)

Ghostfolio is simple and clean, with strong net-worth framing (emergency fund, buying power) but no tax and little dividend depth. Its "X-ray" is a rule checker, not a fund look-through, so the earlier comparison row was wrong.

| Area | What was seen | Depth | Quality | vs MAERMIN |
| --- | --- | --- | --- | --- |
| Summary | Time in market, invested, gross/net performance, dividends, fees, ROAI, annualized, total assets, cash, liabilities, net worth, emergency fund, interest | 3 | 4 | Par |
| Analysis | Return split into asset and currency effect; benchmark compare; top/bottom; investment timeline with saving streaks (current and longest months); dividend timeline | 3 | 4 | Saving streaks are a gap in MAERMIN |
| X-ray rules | 17 rules: liquidity (buying power), emergency fund setup and coverage, currency, asset class (equity 78 to 82%, fixed income), account concentration, developed vs emerging, five regions with thresholds, fee ratio under 1%; thresholds configurable | 3 | 4 | MAERMIN Intelligence is deeper; emergency fund and buying power are new ideas |
| Allocations | By platform, currency, asset class, holding, sector, continent, market, region, country, account, ETF provider | 4 | 4 | ETF provider and platform views are gaps |
| FIRE | Savings rate, interest rate, retirement date, 4% safe withdrawal income | 2 | 4 | MAERMIN deeper (Monte Carlo) |
| Markets | Fear and greed mood, indices with last all-time high and distance | 2 | 4 | Gap (small) |
| Data model (code) | Activity types buy, sell, dividend, fee, interest, liability; 11 asset sub-classes incl. bond, private equity, collectible; 9 data sources; 14 UI languages; public pages and read-only access grants | 3 | n/a | Fee and liability as activities are gaps in MAERMIN |

## DivvyDiary (live demo)

DivvyDiary is the dividend specialist: ten years of payout history per security, backtested yield and growth, and a community benchmark against 18,706 similar portfolios. It is the strongest reference for MAERMIN's Dividends area.

| Area | What the demo shows | Depth | Quality | vs MAERMIN |
| --- | --- | --- | --- | --- |
| Header | Value change 1D to MAX, yield on value, forward yearly gross dividends, gross/net switch | 4 | 5 | Net switch is a gap |
| Portfolio | Allocation by buy-in or value; table with ISIN, WKN, ticker, yield, YoC, annual dividend; CSV export | 3 | 5 | Par |
| Dividends | Cash flow per year incl. next year projected; dividend allocation TTM; dividend matrix security x year back to 2015; payout list per month with shares x amount | 5 | 5 | Matrix and history are gaps |
| Analysis | Value vs buy-in; total return incl. realized and dividends; performance matrix per security with IRR; yield over time and dividend growth backtested on current holdings; growth forecast this year, 5Y, 10Y; currency-adjusted toggle | 5 | 4 | Backtested yield and growth are gaps |
| Inspiration | Community benchmark (yield and 5Y growth percentiles); securities that similar portfolios hold | 4 | 4 (includes paid ad placements) | MAERMIN's anonymous benchmark compares weights only |
| Other | Public share URL, ads in the free plan, light/dark | n/a | 3 | n/a |

## Snowball Analytics (public demo portfolio)

Snowball's standout is plain language: every metric carries a one-line verdict ("Portfolio is behind S&P 500 by $27,161 over the last year", "Sharpe 0.627 requires attention"). It also ties target allocation, cloning and community into the portfolio page.

| Area | What the demo shows | Depth | Quality | vs MAERMIN |
| --- | --- | --- | --- | --- |
| Common | Value, profit, daily change, IRR overall and for current holdings, passive income; categories with current vs target; per-holding cost basis, YoC, 5Y dividend growth, IRR, current vs target share | 4 | 5 | IRR per holding is a gap |
| Diversification | New "X-Ray Funds" toggle; sectors, classes, currencies, regions, countries, asset classes; reveal funds | 4 | 4 | Par |
| Dividends | Yield before and after tax, YoC, income diversification, next 12 months per month, received TTM per month, growth | 4 | 4 | Par |
| Growth | Selectable benchmark; value vs benchmark vs invested; return dynamics by year; holdings performance by period; plain-language verdict | 4 | 5 | Verdict text is a gap |
| Metrics | Lifetime TWR vs SPY, portfolio P/E, beta, Sharpe, Sortino, each with an explained threshold | 3 | 5 | MAERMIN computes more but explains less |
| Transactions and income | Per-lot profit; dividend list with per-share amount and tax | 3 | 4 | Par |
| Community | Likes, views, comments, "clone this portfolio" (copies target allocation) | 3 | 3 (comments show confusion about split-adjusted cost) | Out of scope for privacy |

## Portfolio Performance (source code)

Portfolio Performance has the broadest data model and import coverage of any tracker reviewed; the main tab's "90+ PDF importers" understated it. Its weakness is the desktop-only interface, not depth.

| Area | What the code contains | Depth | vs MAERMIN |
| --- | --- | --- | --- |
| PDF import | 141 extractor classes: DE, AT and CH banks and brokers (Trade Republic, Scalable, ING, DKB, Comdirect, Consorsbank, flatex, DEGIRO, onvista, Baader, Smartbroker, Postbank, Deutsche Bank, Commerzbank, Deka, DZ/GenoBroker, Ebase, Swissquote, Saxo ...), US brokers, robo-advisers and P2P platforms | 5 | MAERMIN: 5 |
| Other import | Generic CSV with saved configs, Trade Republic CSV, IB Flex Query | 5 | Par |
| Quote feeds | 25: Yahoo (incl. adjusted close), Alpha Vantage, EODHD, Finnhub, Twelve Data, CoinGecko, Binance, Kraken, Bitfinex, ECB, Eurostat HICP (inflation), HTML table, JSON, CSV, manual and more | 5 | MAERMIN: 3 sources via Worker |
| Bookkeeping | Account types deposit, removal, interest, interest charge, dividends, fees, fee refund, taxes, tax refund, buy, sell, transfers; portfolio deliveries in/out | 5 | MAERMIN: 4 types |
| Cost basis | FIFO and moving average | 4 | MAERMIN: FIFO |
| Dashboard widgets | About 60: TTWROR, IRR, max and current drawdown, drawdown duration, volatility, semivolatility, Sharpe, top contributors, heatmaps for returns, earnings, investments, taxes and fees, trade statistics (average holding period, turnover ratio), tax and fee rate, FIRE, distance to all-time high, limit alerts, rebalancing charts | 5 | MAERMIN: fixed overview with 3 reorderable sections |
| Charts | SMA, EMA, MACD, Bollinger bands on security charts; return-volatility scatter | 4 | Gap |
| Classification | Taxonomies with templates: asset classes, GICS, Kommer, MSCI regions, security type; JSON import/export | 5 | Shallower (tags, categories) |
| Languages | 19 UI languages | 5 | MAERMIN: DE, EN |

## Wealthfolio (source code)

Wealthfolio is MAERMIN's closest peer in philosophy (local-first, private) and is ahead on data hygiene, AI agent access and extensibility. It has no tax engine and, per its own roadmap, no multiple portfolios or rebalancing yet.

| Area | What the code contains | Depth | vs MAERMIN |
| --- | --- | --- | --- |
| Pages | Dashboard, holdings, performance, income, net worth, allocation targets, insights, health, AI assistant, activities, accounts, assets | 4 | Par |
| Health centre | Checks for negative cash or holdings, incomplete cost basis or valuation, invalid dates or symbols, broken transfer pairs, missing FX rate, missing quote, stale prices, failed quote sync, FX integrity | 5 | MAERMIN data check is narrower |
| Market data | Yahoo, Alpha Vantage, Finnhub, MarketData.app, Börse Frankfurt, Metal Price API, OpenFIGI (ISIN mapping), US Treasury, custom providers | 4 | MAERMIN: Yahoo, CoinGecko, Alpha Vantage |
| Planning | Retirement simulator, save-up goals, contribution limits | 4 | Par (no contribution limits in MAERMIN) |
| Spending | Categories, rules, splits, budgets, insights | 4 | Gap |
| AI and MCP | Agent tools that read and write: record activities, import, classify assets, create categorisation rules, goals, holdings, income, net worth, performance; MCP with personal access tokens, scopes and audit log | 5 | MAERMIN: redacted read-only MCP |
| Extensibility | Addon SDK with permissions, sandbox, secrets, events, catalog | 5 | Gap |
| Sync | Broker sync via SnapTrade (30+ institutions), end-to-end encrypted device sync (paid) | 4 | MAERMIN: free E2E sync via own Worker |
| Exports | CSV, SQLite, JSON | 4 | Par |
| Languages | 10 (de, en, es, fr, it, ja, ko, pt, zh, zh-Hant) | 4 | MAERMIN: 2 |
| Roadmap gaps | Short positions, margin, budgeting module, multiple portfolios, rebalancing, Android, SSO | n/a | MAERMIN already has multi-portfolio and rebalancing |

## Stock Events and Simply Wall St (public pages)

Both are research products with a portfolio attached; their portfolio views need a login and were not seen. What transfers to MAERMIN is how they present events and explanations.

| Product | What the public pages show | Depth | Quality | Idea for MAERMIN |
| --- | --- | --- | --- | --- |
| Stock Events | Event feed (US/CA inflation and rate decisions, earnings with time, daily market summary, AI "key driver" notes on each move, analyst rating changes). Stock page: stats, upcoming earnings, ex-dates and pay dates marked "increased" or "estimated" into 2027, dividend growth 1/3/5/10Y, EPS expected vs actual, revenue and income history, analyst targets, "ask AI" prompts, price alert | 4 | 5 | One dated event feed for held symbols (dividends, earnings, splits, macro) |
| Simply Wall St | One-sentence company verdict, reward and risk checklists in plain language, earnings-call summary with questions to ask, community fair-value distribution (1,737 values) and narratives, price history table | 4 | 4 | Plain-language checklists next to holdings |

## Account-only tools (rated from docs)

These need an account to see a portfolio, so depth comes from help centres and pricing pages and quality is not rated. They can be clicked through the same way once an account is available.

| Tool | Strongest areas per docs | Depth (docs) | Quality |
| --- | --- | --- | --- |
| getquin | TTWROR with heatmaps, IRR, DeepDive look-through, dividend growth forecast to 40 years, clearing account, insurances, budgets, shared access, push alerts, widgets (now also checked hands-on, see the getquin section) | 4 | n/r |
| Finanzfluss Copilot | 350+ automatic connections, budget with Sankey cash flow, net worth across banks and depots | 3 | n/r |
| Sharesight | Tax reports for several countries, contribution analysis, multi-period and drawdown reports, accountant sharing, 200+ broker imports | 4 | n/r |
| Kubera | Net worth for families and entities, private investments with capital calls, beneficiaries (dead man's switch), AI statement reading | 4 | n/r |
| Delta by eToro | 10,000+ connections, multi-asset incl. forex, "why is it moving" alerts | 3 | n/r |

## getquin (free-plan account)

getquin is a wealth app with a portfolio tracker inside: it tracks banks, wallets, insurances and alternative assets next to depots, and adds a community feed. On the free plan the deeper analytics are locked; the performance breakdown and dividend card are free. Checked read-only; no account amounts are recorded here.

| Area | What the app shows | Depth | Quality | vs MAERMIN |
| --- | --- | --- | --- | --- |
| Dashboard | Per account and aggregated; value chart 1D to Max with benchmark toggle; positions with buy price and P/L; sales list; transactions | 4 | 4 | Par |
| Performance | Invested capital; breakdown into price gains, dividends, realized loss, trading costs, taxes; total return, IRR, TTWROR | 4 | 5 | Overview gap in MAERMIN (same as Parqet) |
| Dividends | Received, yield TTM, YoC TTM, payout CAGR, forecast vs all-time chart, calendar, each payment marked forecast or paid with YoY growth | 4 | 4 | Payout CAGR and YoY growth per payment are gaps |
| Allocation | Type, positions, regions, sectors free; DeepDive (ETF look-through), industries, asset classes, countries, currencies, market cap Premium-only | 4 | 3 (6 of 10 tabs locked on free) | Par; MAERMIN shows all for free |
| AI | AI card scoring diversification and costs, "analyse with AI", AI agent button | 3 | n/r (not started) | MAERMIN copy-prompt export only |
| Net worth | Accounts with share of total; goals (retirement, inheritance); financial plan builder; insurance module that flags "missing essential insurances" | 4 | 4 | Insurance check is a gap and out of scope |
| Wealth planning | Starts with a questionnaire (date of birth etc.) | n/r | n/r | Not entered |
| Add account | Brokers (TR, Scalable, ING, Comdirect, Consorsbank, finanzen.net zero, DKB, Sparkasse, flatex, Smartbroker+, Deutsche Bank, Trading 212), 11 exchanges, 11 wallets by address (MetaMask, Ledger, Electrum ...), 11 alternative asset types (real estate, NFT, P2P loans, art, life insurance, cars, jewellery, startups, collectibles ...), file or manual import | 5 | 4 | Wallet tracking by address and alternative asset templates are gaps |
| Community | Feed with top movers, portfolios of known investors (Berkshire, ARK, Pershing, Scion), posts; forum per stock | 4 | 3 | Out of scope |
| Stock page | Key figures (market cap, EPS, P/E, revenue, EBITDA, free cash flow, float), analyst buy/hold/sell and target, FAQ, forum, benchmark tab | 3 | 4 | MAERMIN has no stock page |
| Ads | Sponsored ETF ads on the dashboard and stock pages | n/a | 2 | MAERMIN has none |

Data: real-time quotes from LSX, fundamentals and end-of-day data from FactSet.

## CoinTracking (free-plan account)

CoinTracking is the deepest crypto accounting tool reviewed: 14 cost-basis methods, a holding-period calendar, balance reconciliation and audit reports. Most reports are visible on the free plan, but tax reports are locked once the transaction limit is exceeded. Checked read-only; no account amounts are recorded here.

| Area | What the app shows | Depth | Quality | vs MAERMIN |
| --- | --- | --- | --- | --- |
| Dashboard | Total value, crypto/fiat filter, 1W to MAX chart, 24h winners and losers, value in BTC, holdings with 24h/7d/30d change | 3 | 3 (negative balance shown without a warning; chart legend overlaps the total at narrow width) | Par |
| Reports | 26 reports in four groups: portfolio (balances by exchange, currency, day; NFT centre), transactions (trade list, fees, statistics, prices, trade analysis, double-entry bookkeeping), gains and taxes, checks | 5 | 4 | MAERMIN has fewer crypto-specific reports |
| Cost basis | FIFO, LIFO, HIFO, LOFO, HPFO, LPFO, HAFO, LAFO, ACB, AVCO, HMRC, OPTI, ZERO, MULTI; per-wallet cost basis ("Depottrennung"); price source choice; group buys or sells per day | 5 | 4 | MAERMIN: FIFO only |
| Tax-free coins | Per coin the amount that becomes tax-free today, in 1, 3, 6, 9 and 12 months | 5 | 4 | MAERMIN has a per-lot countdown; the forward calendar view is a gap |
| Checks | Balance check (reported vs computed balance per account and asset with status colours), missing transactions, duplicate transactions, validate transactions, transaction flow | 5 | 4 | MAERMIN data check is narrower; reported-vs-computed is a gap |
| Audit | Roll forward / audit report, accounting report for DATEV, source-of-funds report for banks and tax offices (Pro) | 5 | n/r (locked) | Gap |
| AI | AI tax saver (Expert): plain-language questions answered on the user's lots, e.g. "what if I sell 1 BTC today" with tax-free vs taxable split under section 23 EStG; shown as not yet available in Germany | 4 | n/r | MAERMIN tax advisor covers the countdown, not the what-if |
| Imports | Connections with last sync and error state, "sync all"; 100+ exchanges (Bitcoin.de, Bitpanda, Bison, Bitvavo, BSDEX ...), wallets (MetaMask, Ledger Live, Trezor, Phantom, Safe ...), blockchains by address (BTC, ETH, Arbitrum, Base, Cardano, Algorand ...), AI file converter (Expert), column-mapping import, CSV | 5 | 3 (several connections in error state without a fix hint) | MAERMIN: 4 exchanges, no address tracking |
| Plans | Free with a transaction limit, Pro, Expert, Unlimited | n/a | n/a | MAERMIN free |

## New findings and ideas for MAERMIN

The hands-on review adds three kinds of work: fixes found in MAERMIN itself, first-impression improvements, and features seen only by clicking. Items already in the main tab's priority list are not repeated.

**Fixes found in MAERMIN**

| # | Finding | Where | Effort |
| --- | --- | --- | --- |
| F1 | Intelligence calls Bitcoin a "single company" with exposure "across ETFs and single stocks" | portfolio-intelligence.js, single-company check applies to every security incl. crypto | S |
| F2 | Default rebalancing targets for every user are crypto 35, stocks 45, skins 10, commodities 10; in the demo this proposes buying 4,370 EUR of CS2 skins | DEFAULT\_TARGETS in features2.js and metrics.js | S |
| F3 | "Total bought" card is labelled "Total deposited" although deposits are not modelled | Returns view | S |
| F4 | Tax & FIFO, MAERMIN's strongest area, is below the fold of the desktop sidebar (25 entries in Advanced mode) | nav-model.js, sidebar | S |

**First impression (the demo sells the product)**

| # | Idea | Seen at | Effort |
| --- | --- | --- | --- |
| D1 | Richer demo: 30+ positions, two portfolios, 3+ years of savings-plan buys, 10+ dividend payers, a fund with Vorabpauschale, one sale with tax | Parqet (40 positions, 900+ activities), DivvyDiary | M |
| D2 | Bundled fixtures so Worker-only views (news, discovery, FX attribution, period returns) show sample content in demo mode | All demos load instantly with full content | S to M |
| D3 | Return KPIs on the overview: XIRR, TWR, realized, dividends received, taxes, fees, net return | Parqet dashboard, Ghostfolio summary | S |
| D4 | One-line plain-language verdict next to key metrics ("behind MSCI World by 3.1 pp this year", "Sharpe 0.6: below average") | Snowball, Simply Wall St | S to M |
| D5 | Public read-only demo link on GitHub Pages that opens straight into demo mode | Parqet, Ghostfolio, DivvyDiary, Snowball all have one | S |

**Features seen only hands-on**

| # | Idea | Seen at | Effort |
| --- | --- | --- | --- |
| N1 | Capital-flow table: net buys and sells per month and year with average | Parqet | S |
| N2 | Trade ranking: best and worst closed trades with holding period and return | Parqet, PP trade statistics | S |
| N3 | Dividend matrix security x year and backtested yield/growth on current holdings | DivvyDiary | M |
| N4 | Gross/net switch for dividends and returns | DivvyDiary, Parqet | S |
| N5 | IRR per holding and per category | Snowball, DivvyDiary, Parqet | S |
| N6 | Saving streaks (months in a row with a buy) and investment timeline | Ghostfolio | S |
| N7 | Emergency-fund and buying-power checks in Intelligence | Ghostfolio | S |
| N8 | Allocation by ETF provider and by broker/platform | Ghostfolio | S |
| N9 | Real (inflation-adjusted) returns using Eurostat HICP | PP quote feed | M |
| N10 | Taxonomy templates (GICS, MSCI regions, Kommer) on top of tags | PP | M |
| N11 | Health centre style data checks: stale prices, missing FX, negative holdings, broken transfers | Wealthfolio | M |
| N12 | One dated event feed for held symbols: dividends, ex-dates, earnings, splits, macro dates | Stock Events | M |
| N13 | Moving-average cost basis as a display option (FIFO stays for German tax) | PP | M |
| N14 | Positioning: Parqet users install a third-party Vorabpauschale calculator (422 installs) and Sparerpauschbetrag calculator; MAERMIN has both built in, worth saying on the README and landing page | Parqet integrations | S |

**From getquin and CoinTracking (free-plan accounts)**

| # | Idea | Seen at | Effort |
| --- | --- | --- | --- |
| N15 | Balance reconciliation: compare the balance an exchange or wallet reports with the balance computed from imported transactions, per account and asset, with status colours | CoinTracking balance check | M (exchange sync already fetches balances) |
| N16 | Forward tax-free calendar: how much of each coin becomes tax-free today, in 1, 3, 6, 9, 12 months | CoinTracking short & long | S (per-lot countdown exists) |
| N17 | What-if sale simulator in plain language ("sell 1 BTC today" → tax-free vs taxable part, days to the one-year mark) | CoinTracking AI tax saver | S to M (same as REVIEW #9) |
| N18 | Per-wallet cost basis option and more methods for crypto (HIFO, LIFO, average) shown next to FIFO | CoinTracking | M |
| N19 | Audit exports: roll-forward report, DATEV accounting export, source-of-funds report for banks | CoinTracking | M |
| N20 | Crypto wallet tracking by public address (read-only, no keys) | getquin, CoinTracking | M to L (needs explorer APIs via Worker) |
| N21 | Templates for alternative assets (art, P2P loans, life insurance, cars, startups) on top of custom categories | getquin | S |
| N22 | Payout CAGR and year-over-year growth per dividend payment | getquin | S |
| N23 | Warn on negative balances and failed syncs with a fix hint | Seen missing in CoinTracking; Wealthfolio has it | S |


---

# Part 3 — Appendix: raw hands-on notes

These are the unedited working notes (English) behind Part 2.

## Parqet live demo (app.parqet.com/p/66bf0c987debfb4f2bfd6539), 2026-10-12, not signed in
### Dashboard
- KPIs: portfolio value, invested, cashflow, IRR 16.26%, TTWROR 74.23%, price gain, realized gross, dividends gross, interest gross, total return, taxes, fees, total net return.
- Chart tabs: Value development, Performance, Drawdown, Dividends, Returns. Allocation donut (stocks, cash, bonds), latest activities, top movers, holdings list with ISIN, weight, tags (Dividend Growth, Growth), qty, price, value, return %, abs; cash accounts (Girokonto, Extra-Konto); sold securities (12).
- Share button; nav: Dashboard, Analysis, Activities, Dividends, Watchlists, News feed, Markets, Dividend calendar, Integrations, Calculators, Community.
### Analysis > Allocation
- Counts: 40 assets, 3 asset classes, 3 product types, 12 sectors, 7 regions, 38 industries, 49 countries, 6 company sizes, 39 currencies.
- Allocation dimensions: asset, asset class, product type, sector, industry, region, country, company size, currency, securities.
- X-Ray toggle: expands ETFs into full holdings: top list + "16466 weitere Positionen" (39.34%). Export as CSV. Works in demo without login.
- Analysis tabs: allocation, performance, capital, fees, trades, taxes. Filter button "Add filter".
### Analysis > Returns (performance)
- Return details table month x year with Q/M toggle (quarter view), yearly totals, all gains incl. realized, dividends. Performance map (treemap) with Logos/Current value/Purchase value/Today.
### Analysis > Capital
- Capital flow table: monthly net inflows/outflows from buys/sells, per year total and average, sum row; 3M/6M/1Y/YTD/MAX; link to individual activities.
### Analysis > Fees
- ETF/fund fee analysis past 12 months: per fund position value, avg, price gain %, dividends %, TER cost EUR and %; total €783.96, avg 0.24%; toggle include sold positions. (Lists same ETF twice — once per depot/lot group.)
### Analysis > Trades
- Realized gains per month table (Q/M); top trades and loss trades with date, holding period, return %, EUR; filter by relative return / holdings / since buy.
### Analysis > Taxes
- Tax dashboard: taxes paid per year by activity type (buy, sell, dividend, other) — taken from broker data, not computed. Withholding tax per country and year: received dividends, paid taxes, expected refund. Disclaimer: informational only, use bank documents.
- No Vorabpauschale, Teilfreistellung, Anlage KAP, loss pots, Freibetrag view seen. Refund figure for Ireland (25%) looks questionable (Irish ETFs normally have no reclaimable withholding) — quality flag, not verified.
### Dividends dashboard
- Views: Monthly (continuous), Monthly per year, Accumulated, Accumulated per year, Breakdown, Forecast; Q/M table month x year with totals/avg/sum.
- Return box: gross vs net dividend, taxes, fees, personal dividend yield (gross 3.14%, net 2.61%); trailing 1 year vs previous period (+32.55%), avg monthly; per-year growth.
- Announced dividends by month with per-share amount and shares; latest payouts.
- Dividend assets table: per holding and per depot: interval (M/Q/Y), CAGR 3Y and 5Y of payouts, 1-year amount, avg monthly, yield, YoC, amount in interval.
### Activities
- Grouped by year/month with totals (bought, sold, dividends count). Columns taxes, fees, amount, shares & price. Activity types seen: Buy, Dividend, Sell, "Snapshot" (broker sync position/cash snapshots used for reconciliation). Per-activity "Manage activity". Filters, settings.
- Multiple depots in one portfolio (Vermögensaufbau, Dividenden ETFs) with masked account numbers.
- Dividend chart has a Forecast toggle (bars for expected months); stacked bars per holding, avg dividend line, TTM avg monthly income line.
### Holding detail (FTSE All-World)
- Chart tabs: Value development, Performance, Drawdown, Quote, Overlay (activities, security events); per-holding performance heatmap; dividends section.
- KPIs: value, IRR 17.84%, TTWROR 60.19%, price gain, realized, dividends gross, total return, taxes, fees, net return, entry price, invested, costs. Deep Dive link to justETF profile. Activity list incl. monthly broker "Snapshot" rows.
### Integrations (app directory, Parqet Connect API)
- 41 integrations, install counts: ChatGPT 9.59K, Claude 6.41K, Portfolio Rebalancer 6.41K, Kontor, Parqet Companion, Portfolio Insights, Vorabpauschale (third party, 422), Perplexity, Mistral, FireLotse, DivvyDiary, Divtax export, FolioPing (messenger), Home Assistant companion, parqet-cli, Sparerpauschbetragrechner, Financial Goal Card, ImmoFluss (real estate) ...
- => Parqet outsources German tax helpers (Vorabpauschale, Sparerpauschbetrag) and rebalancing to an API ecosystem; MAERMIN has these built in.
### Data sources (footer)
- Quotes: Gettex, Lang & Schwarz, other venues, Ariva, ActivFinancial, EDI, QuoteMedia, GOLD.DE. ETF data from issuer websites and fact sheets. Dividend data mainly from DivvyDiary. Logos/news: Elbstream.
### Usability impressions
- Demo opens without login in seconds; dark UI; consistent Q/M toggles and month x year tables across returns, capital, trades, dividends; every number clickable to activities. Phone layout collapses to hamburger nav. Dense but coherent. Duplicate rows per depot in fees/dividends tables can confuse.

## MAERMIN v11 local demo (commit e31179b), headless Chromium, desktop 1440x900 + phone 390x844 DE, no Worker, 2026-10-12
- First run: password vault (12+ chars), encryption-at-rest checkbox default on, recovery code screen. 0 page errors across 29 views.
- Demo data: 1 portfolio, 6 open positions (BTC, VWCE, ETH, gold, AAPL, CS2 skin), 11 transactions, 1 closed position (TSLA). Much thinner than Parqet's demo (40 positions, 900+ activities, 4 years, several depots) or DivvyDiary (13 payers, dividend history since 2015).
- Overview: value chart, 4 stat cards (cost basis open, unrealised gain, expected dividends 12M, health score), allocation donut by asset class, top performers, positions open/closed. No XIRR/TWR, realized gains, dividends received, taxes or fees on the overview (Parqet shows all of these on its dashboard).
- Returns: XIRR 20.11%, TWR 90.96% (18.96% p.a.), total return, holding period, total bought (labelled "Total deposited"), current value, proceeds, fees; monthly heatmap with Q1-Q4 and year columns, partial-period markers, explanatory note. No drill-down.
- Performance: treemap with periods; snapshot period returns empty in demo ("demo records none"). Attribution: per-holding contribution in pp, return decomposition incl. estimated tax if realised now; FX attribution needs Worker.
- Health: score 52/D with sub-scores (diversification, risk, liquidity, tax efficiency), effective positions, recommendations. Intelligence: ranked findings; QUALITY ISSUE: labels Bitcoin as "single company" with "51.7% effective Bitcoin exposure across ETFs and single stocks" — wrong wording for a crypto holding.
- Risk & Correlation: matrix with diversification score, most/least correlated pairs, Monte Carlo, stress tests, risk level.
- Rebalancing: default demo targets incl. CS2 Skins 10% -> suggests buying 4,370 € of skins; tolerance bands, invest-only, never-sell.
- Dividends: calendar month grid, forecast tab, auto-fetch, auto-book, quality & safety table, YoC; only 1 payer in demo.
- Tax & FIFO: tabs FIFO cost basis, Tax report, Realized vs unrealized; disclaimer; FIFO table per symbol with realized P&L and lots.
- Many views depend on the Worker and show an empty state in the demo: Discovery, News, FX attribution, publish share, period returns.
- Navigation: desktop sidebar has 25 entries in Advanced mode; Tax & FIFO and all settings views sit below the fold at 900 px height (sidebar scrolls). Phone: bottom dock Portfolio, Buchungen, Dividenden, Analyse, Steuern, Setup — German formatting correct (24.100,75 €).
- Visual: consistent dark fintech style, readable cards, heatmap legible. Overall feature depth high; first impression limited by thin demo and Worker-dependent empty states.

## Ghostfolio live demo (ghostfol.io/en/demo), 2026-10-12
- Home: Overview (value + net perf), Holdings, Summary, Watchlist, Markets.
- Summary: time in market, activity count, buy/sell, invested capital, absolute gross/net performance, dividend part, fees, ROAI %, total assets, holdings, cash, excluded from analysis, liabilities, net worth, annualized performance, emergency fund, interest.
- Analysis: performance with currency effect split (asset performance vs currency performance), benchmark "Compare with" (FTSE All-World), top/bottom holdings, portfolio evolution, investment timeline monthly/yearly with saving streaks (current/longest streak months), dividend timeline.
- Activities table: name, type, date, qty, unit price, fee, value, currency, account.
- Allocations: by platform, currency, asset class, holding, sector, continent, market (developed/emerging), regions, country, account, ETF provider.
- X-ray = rule engine, NOT fund look-through: 17 rules in groups Liquidity (buying power), Emergency fund (setup, coverage), Currency cluster, Asset class cluster (equity/fixed income ranges), Account cluster (single account concentration), Economic market cluster, Regional market cluster (Asia-Pacific, EM, Europe, Japan, North America with thresholds), Fees (fee ratio <1%). "7 out of 17 rules align".
- FIRE: savings rate per month, annual interest rate, retirement date, projected total; sustainable income at 4% SWR (editable).
- Accounts: per account platform, activity count, cash balance, value, currency.
- Markets: fear & greed mood 45/100; indices with last ATH date and change from ATH, bear/celebration icons.
### Usability
- Instant demo login, clean Material UI, very simple; few drill-downs; light on dividends and tax (no tax at all).
### Source inspection (github.com/ghostfolio/ghostfolio, main)
- Activity types: buy, sell, dividend, fee, interest, liability. Asset classes: equity, fixed income, liquidity, commodity, real estate, alternative investment; sub-classes: stock, ETF, mutual fund, bond, cash, loan, crypto, commodity, precious metal, private equity, collectible.
- Data sources: Yahoo, CoinGecko, Alpha Vantage, EOD Historical Data, Financial Modeling Prep, Google Sheets, RapidAPI, manual, Ghostfolio (premium).
- X-ray rule groups (17 rules): account cluster (current investment, single account), asset class cluster (equity, fixed income), currency cluster (base currency, current investment), economic market cluster (developed, emerging), emergency fund (setup, coverage), fees (fee ratio), liquidity (buying power), regional market cluster (Asia-Pacific, emerging markets, Europe, Japan, North America); thresholds configurable via rule settings.
- Other modules: account balances history, public pages (shared portfolio), access (granting read access), WebAuthn login, auth devices, export/import, subscription, admin, benchmarks, markets.
- UI languages: ca, de, en, es, fr, it, ja, ko, nl, pl, pt, tr, uk, zh (14).

## DivvyDiary live demo (divvydiary.com/en/p/24094), public portfolio, 2026-10-12
- Header KPIs: portfolio value with change 1D..MAX, dividend yield on value, yearly gross dividends forward (FWD), gross/net switch.
- Tabs: Portfolio, Dividends, Analysis, Transactions, Inspiration. Ad banner shown (ETF ad).
- Portfolio: allocation by security (buy-in or value), table with ISIN/WKN/ticker, shares, buy-in, value, gain, weight, div yield, YoC, annual dividend and per share; CSV export.
- Dividends: dividend cash flow by year (incl. projected 2027) and month; allocation of dividends TTM by security; dividend matrix security x year back to 2015; payout list by month with paydates, shares x amount; "55 payouts on 47 paydates".
- Analysis: value and buy-in over time; performance (gross total return incl. price, realized, dividends) with compare; performance matrix per security: total gain, total return, IRR, price gain, dividends, realized; dividend yield over time (backtest assuming constant holdings); dividend growth forecast this year (FWD) 7.3% "fast", 5Y 3.7%, 10Y 2.5%; currency-adjusted toggle.
- Inspiration: community benchmark vs 18,706 similar portfolios (yield percentile, 5Y dividend growth percentile, quartiles); "discover new securities" held by similar portfolios with yield, 5Y div CAGR, frequency, sector, type.
- Usability: clean light/dark, data-dense tables, public share URL, ads in free tier.

## Snowball Analytics public demo portfolio (snowball-analytics.com/public/portfolios/dpawdnmreb), 2026-10-12
- Tabs: Common, Diversification, Dividends, Growth, Metrics, Transactions, Income.
- Common: value, invested, total profit and daily change, IRR (overall and current holdings), passive income yield and annual amount; categories (Funds, Stocks, Cash, Commodities) with current vs target allocation (45/30/15/10); holdings table: shares, cost basis, current value, dividends, yield & YoC, 5Y dividend growth, total profit, IRR per holding, current vs target share. "Clone this portfolio" (copy target allocation). Likes, views, comments (community).
- Diversification: NEW "X-Ray Funds" toggle, all holdings vs buy-in; breakdowns sectors, classes, currencies, regions, countries, asset classes; "Reveal funds".
- Dividends: yield after and before tax, YoC, annual and monthly passive income, income diversification by holding, average annual growth, future payments next 12 months per month, dividends received TTM per month, dividend growth.
- Growth: benchmark selectable (S&P 500), plain-language verdict ("Portfolio is behind S&P 500 by $27,161 (14.42%) over the last year"), value vs benchmark vs invested chart, performance chart, dynamics of returns by year, holdings performance by period.
- Metrics: TWR lifetime vs SPY, portfolio P/E, beta with plain-language verdict, Sharpe, Sortino with emoji verdicts and thresholds explained.
- Transactions: operation, date, shares, price, fee, sum, total profit per lot. Income: dividend list with per share and tax.
- Splits handled (AAPL 25@406 -> 100@101.56; NFLX 10 -> 100) — public comments show users confused by split-adjusted cost.
- Data: EODHD, SnapTrade. Usability: plain-language verdicts next to every metric are a strong pattern; cookie banner; community comments on portfolios.

## Portfolio Performance — source inspection (github.com/portfolio-performance/portfolio, main, 2026-10-12)
Desktop app (Eclipse RCP) can't be clicked here; features read from code.
- PDF importers: 141 extractor classes (DE/AT/CH banks and brokers incl. Trade Republic, Scalable, ING, DKB, Comdirect, Consorsbank, flatex/FinTechGroup, DEGIRO, onvista, Baader, Smartbroker (DAB/DADAT), Postbank, Deutsche Bank, Commerzbank, Sparkassen (DekaBank), Volksbanken (DZ/GenoBroker), Ebase, FFB, Fondsdepot Bank, Ginmon, Raisin, Swissquote, Saxo, IBKR (Flex), Revolut, Trading 212, Robinhood, Schwab, E*Trade, Vanguard, Upvest, N26, Bison, Relai, P2P platforms (Bondora, Estateguru, Debitum, Crowdestor) ...). Plus CSV importers, Trade Republic CSV, IB Flex Query.
- Quote feeds: 25 (Yahoo incl. adjusted close, Alpha Vantage, EODHD, Finnhub, Twelve Data, CoinGecko, Binance, Kraken, Bitfinex, MEXC, Leeway, Quandl, ECB data portal, Eurostat HICP (inflation), HTML table, generic JSON, CSV, manual, PortfolioReport, AMFI India, MF API).
- Account transaction types: deposit, removal, interest, interest charge, dividends, fees, fees refund, taxes, tax refund, buy, sell, transfer in/out. Portfolio: buy, sell, transfer in/out, delivery in/out.
- Capital gains: FIFO and moving average (two calculations).
- Dashboard widgets (~60): TTWROR (+annualized), IRR, absolute change, delta, savings, monthly transfers, invested capital, FIRE, max drawdown, current drawdown, max drawdown duration, drawdown chart, volatility, Sharpe ratio, semivolatility, calculation breakdown, top contributors (absolute and return), charts, taxonomy chart, heatmaps (monthly, yearly, earnings, investments, taxes, fees), earnings per year/quarter/month, earnings by taxonomy, dividend event list, trades statistics (P/L, avg holding period, turnover ratio), portfolio tax rate, fee rate, exchange rate, activity chart, limit exceeded (price limits), follow-up dates, event list, distance to ATH, all-time high, rebalancing target chart/rebalancing chart.
- Security chart indicators: SMA, EMA, MACD, Bollinger bands; returns-volatility scatter chart; quote quality metrics; statement of assets history.
- Taxonomies with templates; JSON import/export of taxonomies; custom attributes per security; bookmarks; limit prices; investment plans.
- 19 UI languages (ca, cs, da, de, es, fi, fr, it, nl, pl, pt, pt_BR, ru, sk, tr, vi, zh, zh_TW + en).
- Taxonomy templates: asset classes, GICS industry (full and 1st level), simple industry, Kommer (Gerd Kommer), regions, MSCI regions, security type.

## Wealthfolio — source inspection (github.com/afadil/wealthfolio -> wealthfolio/wealthfolio, main, 2026-10-12)
No web demo (only a YouTube video); desktop/Tauri app can't be clicked here.
- Stack: Rust crates (core, portfolio-engine, market-data, spending, connect, device-sync, ai, agent-tools, wealthfolio-mcp, storage-sqlite, http/Axum REST server) + React frontend; desktop, iOS, Docker web.
- Pages: dashboard, holdings, performance, income, net-worth, allocation-targets, insights, health, ai-assistant, activity, account, asset, settings, onboarding.
- Market data providers: Yahoo, Alpha Vantage, Finnhub, MarketData.app, Börse Frankfurt, Metal Price API, OpenFIGI (identifier mapping), US Treasury calculator, custom providers.
- Health center checks: negative cash/holdings, incomplete cost basis, incomplete valuation, invalid dates, invalid symbol/provider, invalid transfer group, missing FX rate, missing manual valuation, missing market quote, price staleness, quote sync failed, FX integrity, data consistency, classification migration.
- Planning: retirement simulator, save-up goals, contribution limits; lots module; taxonomies (custom classification); profiles (multi-profile with auth).
- Spending crate: categories with seed, categorization rules, activity splits/allocations, budget, analytics, insights, category exclusions.
- Agent tools (AI assistant + MCP): accounts, activities, activity import, record activity/activities (WRITE), commit activity, allocation, asset classification + commit, taxonomies, cash balances, categorization rules (create/commit/propose), contribution limits, goals, health, holdings, income, net worth, performance, portfolios, quote import, transfer links, valuation. MCP has personal access tokens, scopes and an audit log.
- Connect: broker sync via SnapTrade (and Plaid references), 30+ brokerages, E2E device sync.
- Roadmap (open): short positions, margin accounts, budgeting module, MCP and CLI for agents, multiple portfolios, allocation and rebalancing, Android, SSO.
- Exports: CSV, SQLite, JSON. Addon SDK (TypeScript, permissions, sandbox, secrets, events, catalog).
- UI languages: de, en, es, fr, it, ja, ko, pt, zh, zh-Hant (10).

## Stock Events (stockevents.app), public pages, 2026-10-12 (portfolio needs login; not clicked)
- Home feed: events across economics (inflation, rate decisions US/CA), earnings with time, "Markets Today" daily summary, "Key Driver" AI-written explanations per stock move, analyst rating changes (old→new target, Buy/Hold).
- Stock page: price chart 1D..Max; stats (day/52W range, volume, mkt cap, P/E, yield, dividend); upcoming events list (earnings, ex-date, pay date, marked Increased/Estimated) projected into 2027; dividend history and 1/3/5/10Y growth; EPS expected vs actual by quarter; revenue/net income history; analyst ratings with average target and buy/hold/sell split; "people also follow"; competitors (PRO); about with ISIN/WKN and listings; community comments; news; "Ask AI" prompts (why moving, summary, key risks); add to watchlist; price alert.
- Key-driver page: short AI explanation of the day's move with comments.
- Usability: event-first design, every item dated and tied to a ticker; good model for MAERMIN's earnings/dividend calendars.

## Simply Wall St (company page MSFT, public), 2026-10-12 (portfolio needs login; not clicked)
- Snowflake summary in one sentence; "Rewards" and "Risk analysis" checklists in plain language (e.g., P/E below industry average, insider selling).
- Last earnings call summary with financial highlights, outlook and market reaction; "Ask anything" prompts on the transcript.
- Community fair values: distribution of 1,737 user fair values, narratives by community and analysts (over/undervalued %), follow a fair value to get alerts.
- Competitors, price history table (beta, 1M..5Y change), live news with summaries.
- Usability: research product, plain-language checks; portfolio features gated by plan (see pricing page).

## getquin — free-plan account ("Upgrade" shown), 2026-10-12, read-only; no user amounts recorded
- Nav: Gesamtvermögen (net worth), Wealth (planning), Feed (community), Watchlist, notifications, AI agent button, support.
- Dashboard per account and aggregated: value chart 1D..Max with Performance/Benchmark toggle; positions table (buy price, position, P/L) with periods; dividends card (received, yield TTM, YoC TTM, payout CAGR, forecast vs all-time chart, calendar, per-payment status forecast/paid with amount, yield, YoY growth); sales list; transactions; allocation card; getquin AI card (diversification and cost scores out of N, "analyse with AI"); performance card: invested capital, breakdown price gains, dividends, realized loss, trading costs, taxes, total return, IRR and TTWROR.
- Analytics/allocation tabs: type, positions, DeepDive, regions, sectors, industries, asset classes, countries, currencies, market cap. Free: type, positions, regions, sectors. Premium-gated: DeepDive, industries, asset classes, countries, currencies, market cap.
- Net worth page: accounts with share of total; goals (retirement, inheritance) and financial plan builder; insurances module with an "attention needed: N missing essential insurances" check listing insurer, type and premium.
- Wealth planning starts with an onboarding questionnaire (date of birth etc.) — not entered.
- Add account: tabs popular, brokers (TR, Scalable, ING, Comdirect, Consorsbank, finanzen.net zero, DKB, Sparkasse, flatex, Smartbroker+, Deutsche Bank, Trading 212, tradegate), exchanges (Bitpanda, Bison, Coinbase, Binance, Bitvavo, Kraken, Crypto.com, Bitget, KuCoin, Nexo, Bybit), wallets (MetaMask, Trust, Ethereum, Exodus, Crypto.com DeFi, Blockchain.com, Ledger, COINS, Electrum, SafePal, Dogecoin), alternative assets (real estate, NFT, commodities, P2P loans, art, life insurance, cars, jewellery, startups, collectibles, other); individual import: file import (transactions) or manual (transactions, bank balances, savings accounts).
- Feed: top movers, "professional investors" portfolios (Berkshire, Gates foundation, ARK, Pershing, Scion), posts trending/newest/for you/best of.
- Stock page: overview, portfolio, forum, price history, benchmark tabs; FAQ block, key figures (market cap, EPS, P/E, revenue, EBITDA, FCF, float), analysts buy/hold/sell and target, company info. Sponsored ads (iShares/Commerzbank) on dashboard and stock pages.
- Data: real-time quotes from LSX, fundamentals and EOD from FactSet.

## CoinTracking — free-plan account (after trial, over transaction limit), 2026-10-12, read-only; no user amounts recorded
- New UI shell: Dashboard, Imports, Transaktionen, Analyse, Steuerberichte (bottom bar on narrow screens). Banner: trial ended, account exceeds free transaction limit; tax reports locked.
- Dashboard: total value with 24h change, total/crypto/fiat filter, 1W..MAX chart, 24h winners/losers, plan usage, connected accounts, tax report teaser, value in BTC, holdings table (price, 24h, 7d, 30d, quantity, value) with hide-zero toggle. Holdings table shows a negative stablecoin balance without a warning. Narrow width: chart legend overlaps the total value (layout glitch).
- Analyse menu (26 reports in 4 groups):
  - Portfolio: current balance, balance by exchange, balance by currency, daily balance, coins by exchange, NFT center.
  - Transactions: trade list, trading fees, trade statistics, trade prices, number of trades, trade analyses, double-entry bookkeeping, source of funds (Pro).
  - Gains & taxes: realized & unrealized gains, tax-free coins (short & long), roll forward / audit report, accounting report (DATEV), average purchase prices, AI tax saver (new, "not yet available in your country").
  - Checks: balance check, missing transactions, duplicate transactions, validate transactions, transaction flow report.
- Cost-basis methods in gains: FIFO, LIFO, HIFO, LOFO, HPFO, LPFO, HAFO, LAFO, ACB, AVCO, HMRC, OPTI, ZERO, MULTI (14); options: price source (best/transaction/counter-value/buy/sell), group buys or sells per day, "Depottrennung" (per-wallet cost basis), fiat/crypto/commodity filter, export.
- Tax-free coins (short & long): per coin the amount that becomes tax-free at today / +1 / +3 / +6 / +9 / +12 months; method selectable; values in BTC/EUR or 30+ currencies.
- Balance check: per account and asset compares reported balance (exchange/blockchain) with computed balance from imported transactions; status dots green/blue/grey/orange with thresholds; export.
- Source of funds (Pro): traces each withdrawal back to origin; audit-ready report for banks and tax offices.
- AI tax saver (Expert): ask in plain language; example "what if I sell 1 BTC today" simulated on FIFO lots with tax-free vs taxable split (§23 EStG) and days until the 1-year holding period.
- Imports: list of connections with last sync and error state; "sync all"; add import by exchange (long list, ~100+ incl. Bitcoin.de, Bitpanda, Bison, Bitvavo, BSDEX ...), wallets (MetaMask, Ledger Live, Trezor, Phantom, Safe, Keplr, Rabby ...), blockchains by address (BTC, ETH and L2s Arbitrum/Base/Blast, Algorand, Cardano, Avalanche, Bittensor ...), other: AI file converter (Expert), dynamic import with column mapping, CSV import.
- Plans: Free (transaction limit), Pro, Expert, Unlimited.
