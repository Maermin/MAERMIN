// ============================================================================
// MAERMIN — ETF / fund look-through  (window.MaerminLookThrough)
// ----------------------------------------------------------------------------
// Feature: "X-Ray" — resolve ETF/fund positions into their underlying holdings
// and compute the portfolio's EFFECTIVE exposure:
//
//   - effective weight per single security across all funds + direct holdings
//     (e.g. Nvidia inside a World ETF, a Nasdaq ETF, and as a direct position),
//   - aggregated look-through by sector, country/region and currency,
//   - overlap detection between every pair of held funds, plus the strongest
//     hidden concentration risks (fed into MaerminAdvisor).
//
// Data source: the Worker's `action=fundholdings` endpoint (Yahoo Finance
// topHoldings/fundProfile), with a static fallback snapshot for the most
// common ETFs so the feature shows sensible values even against an older
// Worker. Holdings are APPROXIMATIONS (top holdings only) — the UI says so.
//
// Architecture: same split as discovery.js. Everything testable without a
// browser — symbol normalisation, fallback lookup, response parsing, merge,
// and the whole analyze() computation — is pure and dual-exported for the Node
// harness (test/etf-lookthrough.test.js). The React `Panel` is a thin shell
// that folds into the existing Health and Risk views (no new tab). Nothing is
// persisted and nothing sensitive is sent, so there are no new SENSITIVE_KEYS.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  // ---- static fallback (approximate snapshots) -----------------------------
  // Top holdings + sector/country weights for the most commonly held index
  // funds, so look-through degrades gracefully without a fresh Worker. All
  // weights are FRACTIONS of the fund. Deliberately coarse: top ~10 holdings
  // and rounded weights — clearly labelled as an approximation in the UI.
  // holdings: [symbol, name, weight]
  var BASKETS = {
    MSCI_WORLD: {
      name: 'MSCI World (approx.)', ter: 0.0020,
      holdings: [
        ['AAPL', 'Apple', 0.046], ['NVDA', 'Nvidia', 0.044], ['MSFT', 'Microsoft', 0.040],
        ['AMZN', 'Amazon', 0.025], ['META', 'Meta Platforms', 0.018], ['AVGO', 'Broadcom', 0.015],
        ['GOOGL', 'Alphabet A', 0.013], ['TSLA', 'Tesla', 0.011], ['GOOG', 'Alphabet C', 0.010],
        ['JPM', 'JPMorgan Chase', 0.009]
      ],
      sectors: [
        ['Technology', 0.26], ['Financials', 0.16], ['Industrials', 0.11], ['Healthcare', 0.11],
        ['Consumer Discretionary', 0.10], ['Communication Services', 0.08], ['Consumer Staples', 0.06],
        ['Energy', 0.04], ['Materials', 0.035], ['Utilities', 0.025], ['Real Estate', 0.02]
      ],
      countries: [
        ['USA', 0.71], ['Japan', 0.055], ['UK', 0.04], ['France', 0.03], ['Canada', 0.03],
        ['Switzerland', 0.025], ['Germany', 0.025], ['Australia', 0.02], ['Netherlands', 0.013]
      ]
    },
    FTSE_ALL_WORLD: {
      name: 'FTSE All-World (approx.)', ter: 0.0022,
      holdings: [
        ['AAPL', 'Apple', 0.041], ['NVDA', 'Nvidia', 0.040], ['MSFT', 'Microsoft', 0.036],
        ['AMZN', 'Amazon', 0.022], ['META', 'Meta Platforms', 0.016], ['AVGO', 'Broadcom', 0.013],
        ['GOOGL', 'Alphabet A', 0.012], ['TSLA', 'Tesla', 0.010], ['GOOG', 'Alphabet C', 0.009],
        ['TSM', 'TSMC', 0.008]
      ],
      sectors: [
        ['Technology', 0.25], ['Financials', 0.17], ['Industrials', 0.11], ['Consumer Discretionary', 0.11],
        ['Healthcare', 0.10], ['Communication Services', 0.08], ['Consumer Staples', 0.06],
        ['Energy', 0.04], ['Materials', 0.04], ['Utilities', 0.025], ['Real Estate', 0.025]
      ],
      countries: [
        ['USA', 0.62], ['Japan', 0.055], ['UK', 0.035], ['China', 0.03], ['Canada', 0.025],
        ['France', 0.025], ['Switzerland', 0.02], ['Germany', 0.02], ['India', 0.02], ['Taiwan', 0.02]
      ]
    },
    SP500: {
      name: 'S&P 500 (approx.)', ter: 0.0007,
      holdings: [
        ['AAPL', 'Apple', 0.065], ['NVDA', 'Nvidia', 0.063], ['MSFT', 'Microsoft', 0.058],
        ['AMZN', 'Amazon', 0.036], ['META', 'Meta Platforms', 0.026], ['AVGO', 'Broadcom', 0.022],
        ['GOOGL', 'Alphabet A', 0.019], ['TSLA', 'Tesla', 0.017], ['GOOG', 'Alphabet C', 0.016],
        ['BRK-B', 'Berkshire Hathaway B', 0.016]
      ],
      sectors: [
        ['Technology', 0.32], ['Financials', 0.13], ['Consumer Discretionary', 0.11], ['Healthcare', 0.10],
        ['Communication Services', 0.10], ['Industrials', 0.08], ['Consumer Staples', 0.05],
        ['Energy', 0.03], ['Utilities', 0.025], ['Real Estate', 0.02], ['Materials', 0.02]
      ],
      countries: [['USA', 1.0]]
    },
    NASDAQ100: {
      name: 'Nasdaq 100 (approx.)', ter: 0.0020,
      holdings: [
        ['AAPL', 'Apple', 0.085], ['NVDA', 'Nvidia', 0.082], ['MSFT', 'Microsoft', 0.078],
        ['AMZN', 'Amazon', 0.052], ['META', 'Meta Platforms', 0.048], ['AVGO', 'Broadcom', 0.045],
        ['TSLA', 'Tesla', 0.030], ['GOOGL', 'Alphabet A', 0.026], ['COST', 'Costco', 0.026],
        ['GOOG', 'Alphabet C', 0.025]
      ],
      sectors: [
        ['Technology', 0.51], ['Communication Services', 0.15], ['Consumer Discretionary', 0.13],
        ['Consumer Staples', 0.06], ['Healthcare', 0.06], ['Industrials', 0.05], ['Utilities', 0.01]
      ],
      countries: [['USA', 0.97], ['Netherlands', 0.015], ['China', 0.01]]
    },
    US_TOTAL: {
      name: 'US Total Market (approx.)', ter: 0.0003,
      holdings: [
        ['AAPL', 'Apple', 0.055], ['NVDA', 'Nvidia', 0.053], ['MSFT', 'Microsoft', 0.049],
        ['AMZN', 'Amazon', 0.031], ['META', 'Meta Platforms', 0.022], ['AVGO', 'Broadcom', 0.019],
        ['GOOGL', 'Alphabet A', 0.016], ['TSLA', 'Tesla', 0.015], ['GOOG', 'Alphabet C', 0.013],
        ['BRK-B', 'Berkshire Hathaway B', 0.013]
      ],
      sectors: [
        ['Technology', 0.31], ['Financials', 0.14], ['Consumer Discretionary', 0.11], ['Healthcare', 0.11],
        ['Communication Services', 0.09], ['Industrials', 0.09], ['Consumer Staples', 0.04],
        ['Energy', 0.03], ['Utilities', 0.025], ['Real Estate', 0.025], ['Materials', 0.02]
      ],
      countries: [['USA', 1.0]]
    },
    SCHD_DIV: {
      name: 'US Dividend 100 (approx.)', ter: 0.0006,
      holdings: [
        ['ABBV', 'AbbVie', 0.043], ['HD', 'Home Depot', 0.042], ['CVX', 'Chevron', 0.041],
        ['KO', 'Coca-Cola', 0.040], ['CSCO', 'Cisco', 0.040], ['MRK', 'Merck', 0.039],
        ['VZ', 'Verizon', 0.039], ['PEP', 'PepsiCo', 0.038], ['AMGN', 'Amgen', 0.038],
        ['TXN', 'Texas Instruments', 0.037]
      ],
      sectors: [
        ['Consumer Staples', 0.19], ['Energy', 0.18], ['Healthcare', 0.15], ['Technology', 0.13],
        ['Industrials', 0.12], ['Consumer Discretionary', 0.09], ['Communication Services', 0.07],
        ['Financials', 0.06]
      ],
      countries: [['USA', 1.0]]
    },
    VYM_DIV: {
      name: 'US High Dividend Yield (approx.)', ter: 0.0006,
      holdings: [
        ['AVGO', 'Broadcom', 0.060], ['JPM', 'JPMorgan Chase', 0.036], ['XOM', 'Exxon Mobil', 0.029],
        ['JNJ', 'Johnson & Johnson', 0.024], ['PG', 'Procter & Gamble', 0.023], ['HD', 'Home Depot', 0.022],
        ['ABBV', 'AbbVie', 0.021], ['WMT', 'Walmart', 0.020], ['KO', 'Coca-Cola', 0.017],
        ['BAC', 'Bank of America', 0.016]
      ],
      sectors: [
        ['Financials', 0.22], ['Technology', 0.14], ['Healthcare', 0.13], ['Consumer Staples', 0.12],
        ['Industrials', 0.12], ['Energy', 0.09], ['Consumer Discretionary', 0.08],
        ['Utilities', 0.07], ['Communication Services', 0.03]
      ],
      countries: [['USA', 1.0]]
    }
  };

  // Root symbol (exchange suffix stripped) → basket. Covers the US tickers and
  // the common UCITS listings (iShares Core MSCI World = EUNL/IWDA/SWDA, …).
  var FUND_ALIASES = {
    IWDA: 'MSCI_WORLD', EUNL: 'MSCI_WORLD', SWDA: 'MSCI_WORLD', XDWD: 'MSCI_WORLD', URTH: 'MSCI_WORLD', HMWO: 'MSCI_WORLD',
    VWCE: 'FTSE_ALL_WORLD', VWRL: 'FTSE_ALL_WORLD', VWRA: 'FTSE_ALL_WORLD',
    CSPX: 'SP500', SXR8: 'SP500', VUSA: 'SP500', SPY: 'SP500', VOO: 'SP500', IVV: 'SP500', SPLG: 'SP500',
    QQQ: 'NASDAQ100', EQQQ: 'NASDAQ100', CNDX: 'NASDAQ100',
    VTI: 'US_TOTAL', ITOT: 'US_TOTAL',
    SCHD: 'SCHD_DIV',
    VYM: 'VYM_DIV', VHYL: 'VYM_DIV'
  };

  // Heuristic country → trading/home currency, used only for the approximate
  // currency look-through (labelled as such in the UI).
  var COUNTRY_CURRENCY = {
    USA: 'USD', Canada: 'CAD', UK: 'GBP', Switzerland: 'CHF', Japan: 'JPY',
    Germany: 'EUR', France: 'EUR', Netherlands: 'EUR', Italy: 'EUR', Spain: 'EUR',
    Australia: 'AUD', China: 'CNY', 'Hong Kong': 'HKD', Taiwan: 'TWD', India: 'INR',
    'South Korea': 'KRW', Sweden: 'SEK', Denmark: 'DKK', Norway: 'NOK'
  };

  // Name patterns that mark a position as a probable fund/ETF, so the view
  // only asks the Worker about plausible candidates.
  var FUND_NAME_RX = /\b(etf|ucits|index|fund|etc)\b|ishares|vanguard|xtrackers|x-?trackers|lyxor|amundi|spdr|invesco|wisdomtree|vaneck/i;

  // ---- pure helpers --------------------------------------------------------
  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  // Root symbol for matching across listings: uppercase, exchange suffix
  // stripped (VWCE.DE → VWCE, CSPX.L → CSPX).
  function normalizeFundSymbol(symbol) {
    var s = String(symbol || '').trim().toUpperCase();
    var dot = s.indexOf('.');
    return dot > 0 ? s.slice(0, dot) : s;
  }

  // Key for aggregating one underlying security across funds + direct holdings.
  // Holdings without a ticker (Yahoo sometimes omits it) key by name.
  function holdingKey(symbol, name) {
    var s = normalizeFundSymbol(symbol);
    return s || String(name || '').trim().toUpperCase();
  }

  // P5-2.3: one security across funds whose files name it differently - by
  // ticker, else the ticker another file gives its ISIN or its name, else
  // ISIN, else name. Names compare without legal-form suffixes.
  var NAME_SUFFIX = /\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SE|AG|SA|NV|N V|AB|ASA|SPA|S P A|OYJ|HOLDINGS?|GROUP|CLASS [A-C]|CL [A-C]|REG|REGISTERED|ORD|ADR|SHS|SHARES)\b/g;
  function nameKey(name) {
    return String(name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(NAME_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  }
  function keyResolver(holdingsBySymbol) {
    var byIsin = {}, byName = {};
    Object.keys(holdingsBySymbol || {}).forEach(function (f) {
      ((holdingsBySymbol[f] && holdingsBySymbol[f].holdings) || []).forEach(function (h) {
        if (!h || !h.symbol) return;
        if (h.isin && !byIsin[h.isin]) byIsin[h.isin] = h.symbol;
        var n = nameKey(h.name);
        if (n && !byName[n]) byName[n] = h.symbol;
      });
    });
    return function (h) {
      var sym = h.symbol || (h.isin && byIsin[h.isin]) || byName[nameKey(h.name)] || null;
      if (sym) return holdingKey(sym, h.name);
      return h.isin || nameKey(h.name) || holdingKey(null, h.name);
    };
  }

  function fallbackHoldings(symbol) {
    var basketId = FUND_ALIASES[normalizeFundSymbol(symbol)];
    if (!basketId) return null;
    var b = BASKETS[basketId];
    return {
      symbol: normalizeFundSymbol(symbol),
      name: b.name,
      ter: b.ter,
      holdings: b.holdings.map(function (h) { return { symbol: h[0], name: h[1], weight: h[2] }; }),
      sectors: b.sectors.map(function (s) { return { sector: s[0], weight: s[1] }; }),
      countries: b.countries.map(function (c) { return { country: c[0], weight: c[1] }; }),
      source: 'fallback'
    };
  }

  // German fund type for a fund the look-through knows: every basket in
  // FUND_ALIASES is an equity index fund (Aktienfonds, >= 51 % equities).
  function knownFundType(symbol) {
    return FUND_ALIASES[normalizeFundSymbol(symbol)] ? 'aktienfonds' : null;
  }

  function isFundCandidate(symbol, name) {
    if (FUND_ALIASES[normalizeFundSymbol(symbol)]) return true;
    return FUND_NAME_RX.test(String(name || ''));
  }

  // Build the Worker fundholdings URL (gated like discovery.buildUrl).
  function buildUrl(workerBase, symbol) {
    var base = String(workerBase || '').trim().replace(/\/+$/, '');
    if (!base || !symbol) return '';
    return base + '?action=fundholdings&symbol=' + encodeURIComponent(symbol);
  }

  // Parse one Worker fundholdings payload → { ok, fund, data, error }.
  // An explicit `error` (incl. 'Unknown action' from an older Worker) → ok:false
  // so the view can show the graceful upgrade note and use the fallback.
  function parseHoldingsResponse(json) {
    if (!json || json.error) return { ok: false, fund: false, data: null, error: (json && json.error) || 'No response' };
    if (!json.fund) return { ok: true, fund: false, data: null, error: null };
    var holdings = (Array.isArray(json.holdings) ? json.holdings : []).map(function (h) {
      var w = num(h && h.weight);
      if (w === null || w <= 0) return null;
      return { symbol: h.symbol || null, name: h.name || h.symbol || '', weight: w };
    }).filter(Boolean);
    var sectors = (Array.isArray(json.sectors) ? json.sectors : []).map(function (s) {
      var w = num(s && s.weight);
      if (w === null || w <= 0 || !s.sector) return null;
      return { sector: String(s.sector), weight: w };
    }).filter(Boolean);
    return {
      ok: true, fund: true, error: null,
      data: {
        symbol: normalizeFundSymbol(json.symbol),
        name: json.name || json.symbol || '',
        ter: num(json.ter),
        holdings: holdings,
        sectors: sectors,
        countries: null, // Yahoo's topHoldings has no country split
        source: 'worker'
      }
    };
  }

  // Combine live Worker data with the static fallback: Worker wins, fallback
  // fills the gaps (countries always; ter/sectors/holdings when missing).
  function mergeFundData(workerData, fallback) {
    if (!workerData) return fallback || null;
    if (!fallback) return workerData;
    var out = {};
    for (var k in workerData) { if (Object.prototype.hasOwnProperty.call(workerData, k)) out[k] = workerData[k]; }
    if (out.ter == null) out.ter = fallback.ter;
    if (!out.holdings || !out.holdings.length) out.holdings = fallback.holdings;
    if (!out.sectors || !out.sectors.length) out.sectors = fallback.sectors;
    if (!out.countries || !out.countries.length) out.countries = fallback.countries;
    return out;
  }

  // ---- position rows -------------------------------------------------------
  // Flatten the grouped portfolio (built by MaerminMetrics.buildPositions —
  // the single source of truth for positions) into value rows. The per-position
  // value formula mirrors MaerminMetrics.computeStats exactly (price map with
  // case fallbacks, then purchasePrice) so the look-through total can never
  // drift from the stats total.
  function positionRows(portfolio, prices) {
    portfolio = portfolio || {};
    prices = prices || {};
    var rows = [];
    ['crypto', 'stocks', 'skins', 'commodities'].forEach(function (cls) {
      (portfolio[cls] || []).forEach(function (pos) {
        var s = pos.symbol || pos.name || '';
        var price = prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || pos.currentPrice || 0;
        var amount = parseFloat(pos.amount) || 0;
        var value = amount * (price || parseFloat(pos.purchasePrice) || 0);
        if (value <= 0) return;
        rows.push({ symbol: s, name: pos.name || pos.symbolName || s, cls: cls, valueEUR: value });
      });
    });
    return rows;
  }

  // ---- core analysis (PURE) ------------------------------------------------
  // rows: [{symbol, name, cls, valueEUR}] — every position in the portfolio.
  // holdingsBySymbol: { ROOTSYMBOL: fundData } — only for positions that are
  //   funds (fundData as produced by parseHoldingsResponse/fallbackHoldings).
  // opts.getMeta(symbol) → { sector, country } | null (sector/country for
  //   direct stocks and fund holdings; browser passes MaerminEquityMeta.getMeta).
  // opts.concentrationThreshold: effective-weight fraction that flags a hidden
  //   concentration (default 0.05 = 5%).
  // All weights in the result are FRACTIONS of total portfolio value.
  function analyze(rows, holdingsBySymbol, opts) {
    opts = opts || {};
    holdingsBySymbol = holdingsBySymbol || {};
    var getMeta = typeof opts.getMeta === 'function' ? opts.getMeta : function () { return null; };
    var threshold = opts.concentrationThreshold != null ? opts.concentrationThreshold : 0.05;

    rows = rows || [];
    var totalValue = rows.reduce(function (s, r) { return s + (r.valueEUR || 0); }, 0);
    if (totalValue <= 0) {
      return { available: false, totalValue: 0, funds: [], effectiveExposure: [], sectorExposure: [],
        countryExposure: [], currencyExposure: [], overlapPairs: [], hiddenConcentrations: [], coverage: 0 };
    }

    var funds = [];
    var exposure = {};   // key → effective exposure accumulator
    var sectors = {};    // sector → weight
    var countries = {};  // country → weight
    var currencies = {}; // currency → weight (file currencies, else from the country)
    var coveredValue = 0;
    var keyOf = keyResolver(holdingsBySymbol);
    var UNKNOWN = 'Unknown'; // currency bucket (shown through I18N like the sectors)
    function curOfCountry(c) { return c === 'Other' ? UNKNOWN : (COUNTRY_CURRENCY[c] || 'Other'); }
    function addCountry(c, w, withCurrency) { addTo(countries, c, w); if (withCurrency) addTo(currencies, curOfCountry(c), w); }

    // cls: the asset class the weight comes from (a fund's holdings count as
    // stocks), so checks about companies can leave out coins, skins and gold.
    function addExposure(key, name, weight, via, cls) {
      if (!exposure[key]) exposure[key] = { key: key, name: name, directWeight: 0, fundedWeight: 0, via: [], classes: [] };
      // a directly held security keeps its own name (files spell it in capitals)
      if (name && (!exposure[key].name || !via)) exposure[key].name = name;
      if (cls && exposure[key].classes.indexOf(cls) === -1) exposure[key].classes.push(cls);
      if (via) {
        exposure[key].fundedWeight += weight;
        exposure[key].via.push({ fund: via, weight: weight });
      } else {
        exposure[key].directWeight += weight;
      }
    }
    function addTo(map, key, w) { map[key] = (map[key] || 0) + w; }

    rows.forEach(function (row) {
      var weight = row.valueEUR / totalValue;
      var fund = holdingsBySymbol[normalizeFundSymbol(row.symbol)];

      if (!fund) {
        // Direct position: full weight is "covered" (we know exactly what it is).
        coveredValue += row.valueEUR;
        addExposure(holdingKey(row.symbol, row.name), row.name || row.symbol, weight, null, row.cls);
        var meta = (row.cls === 'stocks' || row.cls === 'commodities') ? getMeta(row.symbol) : null;
        addTo(sectors, (meta && meta.sector) || 'Other', weight);
        addCountry((meta && meta.country) || 'Other', weight, true);
        return;
      }

      // Fund position: distribute across known holdings; the remainder beyond
      // the disclosed top holdings stays unresolved (reported via coverage).
      var holdingCoverage = 0;
      (fund.holdings || []).forEach(function (h) {
        holdingCoverage += h.weight;
        addExposure(keyOf(h), h.name || h.symbol, weight * h.weight, normalizeFundSymbol(row.symbol), 'stocks');
      });
      holdingCoverage = Math.min(1, holdingCoverage);
      coveredValue += row.valueEUR * holdingCoverage;

      // Sector look-through: fund-level sector weights cover (nearly) the whole
      // fund, independent of how many top holdings are disclosed.
      var sectorSum = 0;
      (fund.sectors || []).forEach(function (s) { sectorSum += s.weight; addTo(sectors, s.sector, weight * s.weight); });
      if (sectorSum < 1) addTo(sectors, 'Other', weight * (1 - Math.min(1, sectorSum)));

      // Country look-through: explicit fund country split when available
      // (static fallback carries one); otherwise resolve the disclosed top
      // holdings via metadata and leave the rest as Other.
      var countrySum = 0, ownCur = !!(fund.currencies && fund.currencies.length);
      if (fund.countries && fund.countries.length) {
        fund.countries.forEach(function (c) { countrySum += c.weight; addCountry(c.country, weight * c.weight, !ownCur); });
      } else {
        (fund.holdings || []).forEach(function (h) {
          var m = h.symbol ? getMeta(h.symbol) : null;
          if (m && m.country && m.country !== 'Other') { countrySum += h.weight; addCountry(m.country, weight * h.weight, !ownCur); }
        });
      }
      if (countrySum < 1) addCountry('Other', weight * (1 - Math.min(1, countrySum)), !ownCur);
      // P5-2.3: a holdings file names each holding's currency
      if (ownCur) {
        var curSum = 0;
        fund.currencies.forEach(function (c) { curSum += c.weight; addTo(currencies, c.currency, weight * c.weight); });
        if (curSum < 1) addTo(currencies, UNKNOWN, weight * (1 - Math.min(1, curSum)));
      }

      funds.push({
        symbol: normalizeFundSymbol(row.symbol),
        name: row.name || fund.name || row.symbol,
        valueEUR: row.valueEUR,
        weight: weight,
        ter: fund.ter != null ? fund.ter : null,
        holdingCount: (fund.holdings || []).length,
        coverage: holdingCoverage,
        source: fund.source || 'worker',
        asOf: fund.asOf || null,
        provider: fund.provider || null,
        fileCount: fund.fileCount || null
      });
    });

    // Effective exposure list, largest first.
    var effectiveExposure = Object.keys(exposure).map(function (k) {
      var x = exposure[k];
      return {
        key: x.key, name: x.name,
        classes: x.classes,
        directWeight: x.directWeight,
        fundedWeight: x.fundedWeight,
        effectiveWeight: x.directWeight + x.fundedWeight,
        valueEUR: (x.directWeight + x.fundedWeight) * totalValue,
        via: x.via.sort(function (a, b) { return b.weight - a.weight; })
      };
    }).sort(function (a, b) { return b.effectiveWeight - a.effectiveWeight; });

    function toRows(map, keyName) {
      return Object.keys(map).map(function (k) {
        var r = { weight: map[k] }; r[keyName] = k; return r;
      }).sort(function (a, b) { return b.weight - a.weight; });
    }

    var sectorExposure = toRows(sectors, 'sector');
    var countryExposure = toRows(countries, 'country');

    // Currencies: from the holdings files where imported, else approximated
    // from the country split (accumulated per position above).
    var currencyExposure = toRows(currencies, 'currency');

    // Pairwise fund overlap: sum of min(weight in A, weight in B) over the
    // disclosed holdings — the standard "overlap %" approximation.
    var overlapPairs = [];
    for (var i = 0; i < funds.length; i++) {
      for (var j = i + 1; j < funds.length; j++) {
        var fa = holdingsBySymbol[funds[i].symbol], fb = holdingsBySymbol[funds[j].symbol];
        var wa = {}, shared = [];
        (fa.holdings || []).forEach(function (h) { var ka = keyOf(h); wa[ka] = (wa[ka] || 0) + h.weight; });
        var overlap = 0;
        (fb.holdings || []).forEach(function (h) {
          var k = keyOf(h);
          if (wa[k] != null) {
            var m = Math.min(wa[k], h.weight);
            overlap += m;
            shared.push({ key: k, name: h.name || h.symbol, weight: m });
          }
        });
        if (overlap > 0) {
          shared.sort(function (a, b) { return b.weight - a.weight; });
          overlapPairs.push({ a: funds[i].symbol, b: funds[j].symbol, overlap: overlap, shared: shared.slice(0, 5) });
        }
      }
    }
    overlapPairs.sort(function (a, b) { return b.overlap - a.overlap; });

    // Hidden concentrations: securities whose EFFECTIVE weight crosses the
    // threshold with a meaningful part hidden inside funds.
    var hiddenConcentrations = effectiveExposure.filter(function (x) {
      return x.effectiveWeight >= threshold && x.fundedWeight > 0.005;
    }).map(function (x) {
      return {
        key: x.key, name: x.name,
        effectiveWeight: x.effectiveWeight,
        directWeight: x.directWeight,
        fundedWeight: x.fundedWeight,
        funds: x.via.map(function (v) { return v.fund; })
      };
    });

    return {
      available: true,
      totalValue: totalValue,
      funds: funds.sort(function (a, b) { return b.weight - a.weight; }),
      effectiveExposure: effectiveExposure,
      sectorExposure: sectorExposure,
      countryExposure: countryExposure,
      currencyExposure: currencyExposure,
      overlapPairs: overlapPairs,
      hiddenConcentrations: hiddenConcentrations,
      coverage: coveredValue / totalValue
    };
  }

  // ---- fund-data loader (shared by the X-Ray panel and the cost analysis) ---
  // Session-scoped in-memory cache of fetched fund data — holdings change
  // slowly and the Worker caches 24h anyway. Never persisted.
  var _fetchCache = {}; // root symbol → { fund: data|null, unsupported: bool }
  var MAX_FUND_FETCHES = 12;

  // Fetch fund data for a list of symbols via the Worker, merge each result
  // with the static fallback, and report whether any response indicated an
  // older Worker (unsupported). fetchImpl is injectable so the flow is
  // unit-testable under Node; without a Worker base (or fetch) the fallback
  // snapshot alone answers. Resolves { holdings: {ROOT: fundData}, unsupported }.
  function loadFundData(workerBase, symbols, opts) {
    opts = opts || {};
    var fetchImpl = opts.fetchImpl || ((typeof fetch !== 'undefined') ? fetch : null);
    var base = String(workerBase || '').trim().replace(/\/+$/, '');
    var unsupported = false;
    var results = {};
    // P5-2.3: imported holdings files ({ ROOT: fundData }) win over Worker
    // and snapshot; default = the stored files (MaerminFundFiles)
    var FF = (typeof window !== 'undefined' && window.MaerminFundFiles) || null;
    var files = opts.files || (FF && FF.fundDataMap ? FF.fundDataMap() : {});
    var jobs = (symbols || []).map(function (symbol) {
      var root = normalizeFundSymbol(symbol);
      if (!root) return Promise.resolve();
      if (files[root]) return Promise.resolve(); // P5-2.3: the user's holdings file
      if (_fetchCache[root]) {
        if (_fetchCache[root].unsupported) unsupported = true;
        if (_fetchCache[root].fund) results[root] = _fetchCache[root].fund;
        return Promise.resolve();
      }
      if (!base || !fetchImpl) return Promise.resolve();
      return fetchImpl(buildUrl(base, symbol), opts.signal ? { signal: opts.signal } : undefined)
        .then(function (r) {
          // An older Worker without the action 400s/404s → unsupported (the
          // static fallback still applies; the caller just notes the upgrade).
          if (r.status === 400 || r.status === 404 || r.status === 501) { unsupported = true; _fetchCache[root] = { fund: null, unsupported: true }; return null; }
          return r.json();
        })
        .then(function (j) {
          if (!j) return;
          var parsed = parseHoldingsResponse(j);
          if (!parsed.ok && /unknown|unsupported|action/i.test(parsed.error || '')) { unsupported = true; _fetchCache[root] = { fund: null, unsupported: true }; return; }
          var data = (parsed.ok && parsed.fund) ? parsed.data : null;
          _fetchCache[root] = { fund: data, unsupported: false };
          if (data) results[root] = data;
        })
        .catch(function () { /* per-symbol failure → fallback only */ });
    });
    return Promise.all(jobs).then(function () {
      var merged = {};
      (symbols || []).forEach(function (symbol) {
        var root = normalizeFundSymbol(symbol);
        var data = files[root] || mergeFundData(results[root] || null, fallbackHoldings(symbol));
        if (data) merged[root] = data;
      });
      return { holdings: merged, unsupported: unsupported };
    });
  }

  // ---- React Panel (browser only; folds into Health + Risk) -----------------

  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var accent = theme.accent || '#8b7cff', border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var warn = theme.warning || '#f59e0b', bad = theme.danger || theme.negative || '#ef4444';
    var workerBase = String(props.workerUrl || '').trim().replace(/\/+$/, '');
    var fmt = props.formatPrice || function (v) { return Number(v || 0).toFixed(2); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '€';
    var mode = props.mode || 'overview'; // 'overview' (Health) | 'risk' (Risk tab)
    var onResult = props.onResult;

    var rows = positionRows(props.portfolio, props.prices);
    var candidates = rows.filter(function (r) {
      return (r.cls === 'stocks' || r.cls === 'commodities') && isFundCandidate(r.symbol, r.name);
    }).slice(0, MAX_FUND_FETCHES);
    var candidateKey = candidates.map(function (c) { return normalizeFundSymbol(c.symbol); }).sort().join(',');

    var sState = React.useState({ loading: false, unsupported: false, holdings: null });
    var state = sState[0], setState = sState[1];
    // P5-2.3: imported holdings files; rev bumps re-run the load after an import
    var FF = (typeof window !== 'undefined') && window.MaerminFundFiles;
    var sRev = React.useState(0), filesRev = sRev[0], setFilesRev = sRev[1];
    var sMsg = React.useState(null), fileMsg = sMsg[0], setFileMsg = sMsg[1];

    React.useEffect(function () {
      if (!candidates.length) { setState({ loading: false, unsupported: false, holdings: {} }); return; }
      var cancelled = false;
      setState(function (s) { return { loading: true, unsupported: false, holdings: s.holdings }; });
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      loadFundData(workerBase, candidates.map(function (c) { return c.symbol; }), { signal: ctrl ? ctrl.signal : undefined })
        .then(function (out) {
          if (timer) clearTimeout(timer);
          if (cancelled) return;
          setState({ loading: false, unsupported: out.unsupported, holdings: out.holdings });
        });
      return function () { cancelled = true; if (timer) clearTimeout(timer); if (ctrl) ctrl.abort(); };
    }, [candidateKey, workerBase, filesRev]);

    var meta = (typeof window !== 'undefined') && window.MaerminEquityMeta;
    var result = null;
    if (state.holdings) {
      result = analyze(rows, state.holdings, { getMeta: meta && meta.getMeta });
    }

    // Hand the result up (renderer feeds it into the advisor findings).
    React.useEffect(function () {
      if (onResult && result && state.holdings) onResult(result);
    }, [state.holdings, candidateKey]);

    var pct = function (x) { return window.MaerminI18n.pct(x * 100, 1); };

    function bar(label, weight, max, color, key) {
      var w = max > 0 ? Math.max(2, (weight / max) * 100) : 0;
      return e('div', { key: key || label, style: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' } },
        e('div', { style: { color: dim, fontSize: '0.76rem', width: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
        e('div', { style: { flex: 1, background: inputBg, borderRadius: '5px', height: '10px', overflow: 'hidden' } },
          e('div', { style: { width: w + '%', height: '100%', background: color || accent, borderRadius: '5px' } })),
        e('div', { style: { color: text, fontSize: '0.76rem', fontWeight: 600, width: '52px', textAlign: 'right' } }, pct(weight)));
    }

    function sectionTitle(label) {
      return e('div', { style: { color: dim, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '1rem 0 0.5rem', fontWeight: 700 } }, label);
    }

    // ---- P5-2.3: holdings files per fund (import / remove) and CSV export ----
    var FILE_ERR = {
      'no-header': __('ltFileNoHeader', 'No holdings table found - the file needs a name and a weight column.'),
      'no-rows': __('ltFileNoRows', 'The file has a holdings header but no holdings below it.'),
      'weights': __('ltFileWeights', 'The weights in the file do not add up to a fund (about 100 %).'),
      'old-xls': __('ltFileOldXls', 'Old Excel 97 format - open it and save it as .xlsx or .csv, then import again.'),
      'no-inflate': __('ltFileNoInflate', 'This browser cannot open .xlsx files - save the file as .csv and import that.')
    };
    function importFile(root, file) {
      if (!FF || !file) return;
      setFileMsg(null);
      var reader = file.arrayBuffer ? file.arrayBuffer() : Promise.reject(new Error('read'));
      reader.then(function (buf) { return FF.readTable(file.name, new Uint8Array(buf)); })
        .then(function (rows) {
          var parsed = FF.parseTable(rows, file.name);
          if (!parsed.ok) { setFileMsg({ root: root, bad: true, text: FILE_ERR[parsed.error] || FILE_ERR['no-header'] }); return; }
          if (!FF.put(root, FF.toRecord(parsed, { fileName: file.name }))) { setFileMsg({ root: root, bad: true, text: __('ltFileSaveFailed', 'The file could not be saved on this device (storage full?).') }); return; }
          setFileMsg({ root: root, bad: false, text: __('ltFileImported', '{n} holdings imported for {fund}.', { n: parsed.count, fund: root }) });
          setFilesRev(function (x) { return x + 1; });
        })
        .catch(function (err) { setFileMsg({ root: root, bad: true, text: FILE_ERR[err && err.message] || FILE_ERR['no-header'] }); });
    }
    function removeFile(root) { if (!FF) return; FF.remove(root); setFileMsg(null); setFilesRev(function (x) { return x + 1; }); }
    function exportCsv() {
      if (!FF || !result) return;
      var blob = new Blob([FF.exportCsv(result)], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'maermin-look-through.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    function sourceText(f) {
      if (!f) return __('ltSrcNone', 'no holdings data');
      if (f.source === 'file') return __('ltSrcFileOf', 'your file{date} - {n} holdings', { date: f.asOf ? ' ' + (window.MaerminI18n.date ? window.MaerminI18n.date(f.asOf) : f.asOf) : '', n: f.fileCount || f.holdingCount });
      if (f.source === 'worker') return __('ltSrcYahooTop', 'Yahoo top {n}', { n: f.holdingCount });
      return __('ltSrcSnapshotShort', 'built-in snapshot (top 10)');
    }
    function filesSection() {
      if (!FF || !candidates.length) return null;
      var byRoot = {};
      ((result && result.funds) || []).forEach(function (f) { byRoot[f.symbol] = f; });
      var btn = { position: 'relative', padding: '0.3rem 0.65rem', borderRadius: '8px', border: '1px solid ' + border, background: 'transparent', color: text, fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer' };
      return e('div', { 'data-testid': 'lt-files' },
        sectionTitle(__('ltFilesTitle', 'Holdings files')),
        e('div', { style: { color: dim, fontSize: '0.74rem', lineHeight: 1.5, marginBottom: '0.5rem' } },
          __('ltFilesHint', 'For the full look-through, download the holdings file (CSV or Excel) from your fund provider\'s fund page and import it here. The file is read on this device and never sent anywhere.')),
        candidates.map(function (c) {
          var root = normalizeFundSymbol(c.symbol), f = byRoot[root], own = f && f.source === 'file';
          var msg = fileMsg && fileMsg.root === root ? fileMsg : null;
          return e('div', { key: root, 'data-testid': 'lt-file-' + root, style: { borderTop: '1px solid ' + border, padding: '0.45rem 0' } },
            e('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', justifyContent: 'space-between' } },
              e('div', { style: { minWidth: 0 } },
                e('span', { style: { color: text, fontSize: '0.82rem', fontWeight: 600 } }, root),
                e('span', { 'data-testid': 'lt-src-' + root, style: { color: own ? (theme.success || 'var(--success)') : dim, fontSize: '0.72rem', marginLeft: '0.5rem' } }, sourceText(f))),
              e('div', { style: { display: 'flex', gap: '0.35rem' } },
                e('label', { style: btn },
                  own ? __('ltFileReplace', 'Replace file') : __('ltFileImport', 'Import holdings file'),
                  e('input', { type: 'file', 'data-testid': 'lt-input-' + root, accept: '.csv,.txt,.xlsx,.xls,.xml', 'aria-label': __('ltFileImportFor', 'Import holdings file for {fund}', { fund: root }),
                    style: { position: 'absolute', width: '1px', height: '1px', opacity: 0, overflow: 'hidden' },
                    onChange: function (ev) { var fl = ev.target.files && ev.target.files[0]; ev.target.value = ''; importFile(root, fl); } })),
                own ? e('button', { type: 'button', style: btn, onClick: function () { removeFile(root); } }, __('ltFileRemove', 'Remove')) : null)),
            msg ? e('div', { role: 'status', style: { color: msg.bad ? bad : (theme.success || 'var(--success)'), fontSize: '0.72rem', marginTop: '0.25rem' } }, msg.text) : null);
        }));
    }

    var body;
    var fundCount = result ? result.funds.length : 0;

    if (!candidates.length) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } },
        __('ltNoFunds', 'No ETF or fund positions detected. Look-through resolves funds into their underlying holdings once you hold one.'));
    } else if (state.loading) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } }, __('ltResolving', 'Resolving fund holdings...'));
    } else if (!result || !result.available || !fundCount) {
      body = e('div', null, e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } },
        __('ltNoData', 'No holdings data available for your fund positions yet. Live data needs the latest Worker (action=fundholdings); a built-in snapshot covers the most common index ETFs.')),
        mode !== 'risk' ? filesSection() : null);
    } else {
      var parts = [];

      if (mode !== 'risk') {
        // Effective exposure (direct + through funds)
        parts.push(sectionTitle(__('ltEffective', 'Effective exposure (direct + through funds)')));
        var top = result.effectiveExposure.slice(0, 10);
        parts.push(e('div', { style: { overflowX: 'auto' } },
          e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            e('thead', null, e('tr', null,
              [__('ltSecurity', 'Security'), __('ltDirect', 'Direct'), __('ltViaFunds', 'Via funds'), __('ltEffectiveCol', 'Effective'), __('colValue', 'Value')].map(function (h, i) {
                return e('th', { key: h, style: { textAlign: i === 0 ? 'left' : 'right', padding: '0.4rem 0.5rem', color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
              }))),
            e('tbody', null, top.map(function (x) {
              return e('tr', { key: x.key, style: { borderTop: '1px solid ' + border } },
                e('td', { style: { padding: '0.45rem 0.5rem', color: text, fontSize: '0.8rem', fontWeight: 600 } },
                  x.name || x.key,
                  x.via.length ? e('span', { style: { color: dim, fontWeight: 400, fontSize: '0.7rem' } }, '  ' + __('ltVia', 'via {list}', { list: x.via.map(function (v) { return v.fund; }).join(', ') })) : null),
                e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, x.directWeight > 0 ? pct(x.directWeight) : '-'),
                e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, x.fundedWeight > 0 ? pct(x.fundedWeight) : '-'),
                e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: text, fontSize: '0.78rem', fontWeight: 700 } }, pct(x.effectiveWeight)),
                e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, fmt(x.valueEUR) + ' ' + sym));
            })))));

        // Sector / country / currency look-through
        var maxSector = result.sectorExposure.length ? result.sectorExposure[0].weight : 0;
        parts.push(sectionTitle(__('ltSector', 'Sector look-through')));
        parts.push(e('div', null, result.sectorExposure.slice(0, 8).map(function (s) { return bar(window.MaerminI18n.sector(s.sector), s.weight, maxSector, accent, 's-' + s.sector); })));

        var maxCountry = result.countryExposure.length ? result.countryExposure[0].weight : 0;
        parts.push(sectionTitle(__('ltCountry', 'Country look-through')));
        parts.push(e('div', null, result.countryExposure.slice(0, 8).map(function (c) { return bar(window.MaerminI18n.country(c.country), c.weight, maxCountry, theme.info || '#3b82f6', 'c-' + c.country); })));

        var maxCur = result.currencyExposure.length ? result.currencyExposure[0].weight : 0;
        parts.push(sectionTitle(__('ltCurrency', 'Currency look-through (approximate)')));
        parts.push(e('div', null, result.currencyExposure.slice(0, 6).map(function (c) { return bar(window.MaerminI18n.sector(c.currency), c.weight, maxCur, theme.success || '#22c55e', 'cur-' + c.currency); })));
      }

      if (mode !== 'overview') {
        // Fund overlap
        parts.push(sectionTitle(__('ltOverlap', 'Fund overlap')));
        if (!result.overlapPairs.length) {
          parts.push(e('div', { style: { color: dim, fontSize: '0.8rem' } },
            fundCount > 1 ? __('ltNoOverlap', 'No overlap detected between the disclosed holdings of your funds.') : __('ltNeedTwo', 'Overlap needs at least two fund positions.')));
        } else {
          parts.push(e('div', null, result.overlapPairs.slice(0, 6).map(function (p) {
            return e('div', { key: p.a + '-' + p.b, style: { borderTop: '1px solid ' + border, padding: '0.5rem 0' } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem' } },
                e('span', { style: { color: text, fontSize: '0.82rem', fontWeight: 600 } }, p.a + ' / ' + p.b),
                e('span', { style: { color: p.overlap >= 0.25 ? warn : text, fontSize: '0.82rem', fontWeight: 700 } }, __('ltOverlapPct', '{pct} overlap', { pct: pct(p.overlap) }))),
              e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.15rem' } },
                __('ltShared', 'Shared: {list}', { list: p.shared.map(function (s) { return s.name || s.key; }).join(', ') })));
          })));
        }

        // Hidden concentrations
        parts.push(sectionTitle(__('ltHidden', 'Hidden concentration risks')));
        if (!result.hiddenConcentrations.length) {
          parts.push(e('div', { style: { color: dim, fontSize: '0.8rem' } }, __('ltNoHidden', 'No single security exceeds {pct} of the portfolio once fund holdings are counted.', { pct: window.MaerminI18n.pct(5, 0) })));
        } else {
          parts.push(e('div', null, result.hiddenConcentrations.slice(0, 6).map(function (h) {
            return e('div', { key: h.key, style: { borderTop: '1px solid ' + border, padding: '0.5rem 0' } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem' } },
                e('span', { style: { color: text, fontSize: '0.82rem', fontWeight: 600 } }, h.name || h.key),
                e('span', { style: { color: h.effectiveWeight >= 0.1 ? bad : warn, fontSize: '0.82rem', fontWeight: 700 } }, __('ltEffectivePct', '{pct} effective', { pct: pct(h.effectiveWeight) }))),
              e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.15rem' } },
                (h.directWeight > 0 ? __('ltHeldDirectly', '{pct} held directly', { pct: pct(h.directWeight) }) + ', ' : '') + __('ltInside', '{pct} inside {list}', { pct: pct(h.fundedWeight), list: h.funds.join(', ') })));
          })));
        }
      }

      if (mode !== 'risk') parts.push(filesSection());

      // Footer: coverage + sources + approximation disclaimer
      var allFiles = result.funds.length > 0 && result.funds.every(function (f) { return f.source === 'file'; });
      var sources = result.funds.some(function (f) { return f.source === 'worker'; })
        ? (result.funds.some(function (f) { return f.source === 'fallback'; }) ? __('ltSrcBoth', 'live Worker data + built-in snapshot') : __('ltSrcWorker', 'live Worker data'))
        : __('ltSrcSnapshot', 'built-in snapshot (approximate)');
      if (result.funds.some(function (f) { return f.source === 'file'; })) sources = allFiles ? __('ltSrcFiles', 'your holdings files') : __('ltSrcFilesPlus', 'your holdings files + {src}', { src: sources });
      parts.push(e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.9rem', lineHeight: 1.5 } },
        allFiles ? __('ltFooterFiles', '{n} {n:fund|funds} resolved from your holdings files, {pct} of portfolio value mapped to named holdings. Not investment advice.', { n: fundCount, pct: pct(result.coverage) })
          : __('ltFooter', '{n} {n:fund|funds} resolved, {pct} of portfolio value mapped to disclosed holdings. Source: {src}. Holdings are approximations (top holdings only) and not investment advice.', { n: fundCount, pct: pct(result.coverage), src: sources })));
      if (mode !== 'risk' && FF) parts.push(e('div', { style: { marginTop: '0.6rem' } },
        e('button', { type: 'button', 'data-testid': 'lt-export', onClick: exportCsv, style: { padding: '0.35rem 0.75rem', borderRadius: '8px', border: '1px solid ' + border, background: 'transparent', color: text, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' } },
          __('ltExportCsv', 'Export look-through (CSV)'))));

      if (state.unsupported) {
        parts.push(e('div', { style: { color: warn, fontSize: '0.74rem', marginTop: '0.5rem', lineHeight: 1.5 } },
          __('ltUnsupported', 'Your Worker does not support fund look-through yet. Re-deploy the latest cf-worker/worker.js (it adds the action=fundholdings endpoint) for live holdings; until then a built-in snapshot of common ETFs is used.')));
      }

      body = e('div', null, parts);
    }

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginTop: '1rem' } },
      e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: 0 } },
        mode === 'risk' ? (t.lookThroughRiskTitle || 'Fund overlap & hidden concentration (X-Ray)') : (t.lookThroughTitle || 'ETF look-through (X-Ray)')),
      body
    );
  }

  var api = {
    BASKETS: BASKETS,
    FUND_ALIASES: FUND_ALIASES,
    COUNTRY_CURRENCY: COUNTRY_CURRENCY,
    normalizeFundSymbol: normalizeFundSymbol,
    holdingKey: holdingKey,
    nameKey: nameKey,
    fallbackHoldings: fallbackHoldings,
    isFundCandidate: isFundCandidate,
    knownFundType: knownFundType,
    buildUrl: buildUrl,
    parseHoldingsResponse: parseHoldingsResponse,
    mergeFundData: mergeFundData,
    positionRows: positionRows,
    loadFundData: loadFundData,
    MAX_FUND_FETCHES: MAX_FUND_FETCHES,
    analyze: analyze,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminLookThrough = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
