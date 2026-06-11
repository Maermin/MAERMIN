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
    var coveredValue = 0;

    function addExposure(key, name, weight, via) {
      if (!exposure[key]) exposure[key] = { key: key, name: name, directWeight: 0, fundedWeight: 0, via: [] };
      if (!exposure[key].name && name) exposure[key].name = name;
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
        addExposure(holdingKey(row.symbol, row.name), row.name || row.symbol, weight, null);
        var meta = (row.cls === 'stocks' || row.cls === 'commodities') ? getMeta(row.symbol) : null;
        addTo(sectors, (meta && meta.sector) || 'Other', weight);
        addTo(countries, (meta && meta.country) || 'Other', weight);
        return;
      }

      // Fund position: distribute across known holdings; the remainder beyond
      // the disclosed top holdings stays unresolved (reported via coverage).
      var holdingCoverage = 0;
      (fund.holdings || []).forEach(function (h) {
        holdingCoverage += h.weight;
        addExposure(holdingKey(h.symbol, h.name), h.name || h.symbol, weight * h.weight, normalizeFundSymbol(row.symbol));
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
      var countrySum = 0;
      if (fund.countries && fund.countries.length) {
        fund.countries.forEach(function (c) { countrySum += c.weight; addTo(countries, c.country, weight * c.weight); });
      } else {
        (fund.holdings || []).forEach(function (h) {
          var m = h.symbol ? getMeta(h.symbol) : null;
          if (m && m.country && m.country !== 'Other') { countrySum += h.weight; addTo(countries, m.country, weight * h.weight); }
        });
      }
      if (countrySum < 1) addTo(countries, 'Other', weight * (1 - Math.min(1, countrySum)));

      funds.push({
        symbol: normalizeFundSymbol(row.symbol),
        name: row.name || fund.name || row.symbol,
        valueEUR: row.valueEUR,
        weight: weight,
        ter: fund.ter != null ? fund.ter : null,
        holdingCount: (fund.holdings || []).length,
        coverage: holdingCoverage,
        source: fund.source || 'worker'
      });
    });

    // Effective exposure list, largest first.
    var effectiveExposure = Object.keys(exposure).map(function (k) {
      var x = exposure[k];
      return {
        key: x.key, name: x.name,
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

    // Currency approximation from the country split.
    var curMap = {};
    countryExposure.forEach(function (c) {
      addTo(curMap, c.country === 'Other' ? 'Unknown' : (COUNTRY_CURRENCY[c.country] || 'Other'), c.weight);
    });
    var currencyExposure = toRows(curMap, 'currency');

    // Pairwise fund overlap: sum of min(weight in A, weight in B) over the
    // disclosed holdings — the standard "overlap %" approximation.
    var overlapPairs = [];
    for (var i = 0; i < funds.length; i++) {
      for (var j = i + 1; j < funds.length; j++) {
        var fa = holdingsBySymbol[funds[i].symbol], fb = holdingsBySymbol[funds[j].symbol];
        var wa = {}, shared = [];
        (fa.holdings || []).forEach(function (h) { wa[holdingKey(h.symbol, h.name)] = h.weight; });
        var overlap = 0;
        (fb.holdings || []).forEach(function (h) {
          var k = holdingKey(h.symbol, h.name);
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

  // ---- React Panel (browser only; folds into Health + Risk) -----------------
  // Session-scoped in-memory cache of fetched fund data — holdings change
  // slowly and the Worker caches 24h anyway. Never persisted.
  var _fetchCache = {}; // root symbol → { fund: data|null, unsupported: bool }
  var MAX_FUND_FETCHES = 12;

  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var accent = theme.accent || '#f5a524', border = theme.cardBorder || 'rgba(255,255,255,0.1)';
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

    React.useEffect(function () {
      if (!candidates.length) { setState({ loading: false, unsupported: false, holdings: {} }); return; }
      var cancelled = false;
      var unsupported = false;

      function finish(map) {
        if (cancelled) return;
        // Fallback snapshot fills in whatever the Worker could not provide.
        var merged = {};
        candidates.forEach(function (c) {
          var root = normalizeFundSymbol(c.symbol);
          var data = mergeFundData(map[root] || null, fallbackHoldings(c.symbol));
          if (data && data.holdings && data.holdings.length) merged[root] = data;
        });
        setState({ loading: false, unsupported: unsupported, holdings: merged });
      }

      if (!workerBase) { finish({}); return; }

      setState(function (s) { return { loading: true, unsupported: false, holdings: s.holdings }; });
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
      var results = {};
      Promise.all(candidates.map(function (c) {
        var root = normalizeFundSymbol(c.symbol);
        if (_fetchCache[root]) {
          if (_fetchCache[root].unsupported) unsupported = true;
          if (_fetchCache[root].fund) results[root] = _fetchCache[root].fund;
          return Promise.resolve();
        }
        var url = buildUrl(workerBase, c.symbol);
        return fetch(url, { signal: ctrl ? ctrl.signal : undefined })
          .then(function (r) {
            // An older Worker without the action 400s/404s → unsupported (the
            // static fallback still applies; we just note the upgrade).
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
      })).then(function () { if (timer) clearTimeout(timer); finish(results); });

      return function () { cancelled = true; if (timer) clearTimeout(timer); if (ctrl) ctrl.abort(); };
    }, [candidateKey, workerBase]);

    var meta = (typeof window !== 'undefined') && window.MaerminEquityMeta;
    var result = null;
    if (state.holdings) {
      result = analyze(rows, state.holdings, { getMeta: meta && meta.getMeta });
    }

    // Hand the result up (renderer feeds it into the advisor findings).
    React.useEffect(function () {
      if (onResult && result && state.holdings) onResult(result);
    }, [state.holdings, candidateKey]);

    var pct = function (x) { return (x * 100).toFixed(1) + '%'; };

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

    var body;
    var fundCount = result ? result.funds.length : 0;

    if (!candidates.length) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } },
        'No ETF or fund positions detected. Look-through resolves funds into their underlying holdings once you hold one.');
    } else if (state.loading) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } }, 'Resolving fund holdings...');
    } else if (!result || !result.available || !fundCount) {
      body = e('div', { style: { color: dim, fontSize: '0.85rem', padding: '0.5rem 0' } },
        'No holdings data available for your fund positions yet. Live data needs the latest Worker (action=fundholdings); a built-in snapshot covers the most common index ETFs.');
    } else {
      var parts = [];

      if (mode !== 'risk') {
        // Effective exposure (direct + through funds)
        parts.push(sectionTitle('Effective exposure (direct + through funds)'));
        var top = result.effectiveExposure.slice(0, 10);
        parts.push(e('div', { style: { overflowX: 'auto' } },
          e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            e('thead', null, e('tr', null,
              ['Security', 'Direct', 'Via funds', 'Effective', 'Value'].map(function (h, i) {
                return e('th', { key: h, style: { textAlign: i === 0 ? 'left' : 'right', padding: '0.4rem 0.5rem', color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
              }))),
            e('tbody', null, top.map(function (x) {
              return e('tr', { key: x.key, style: { borderTop: '1px solid ' + border } },
                e('td', { style: { padding: '0.45rem 0.5rem', color: text, fontSize: '0.8rem', fontWeight: 600 } },
                  x.name || x.key,
                  x.via.length ? e('span', { style: { color: dim, fontWeight: 400, fontSize: '0.7rem' } }, '  via ' + x.via.map(function (v) { return v.fund; }).join(', ')) : null),
                e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, x.directWeight > 0 ? pct(x.directWeight) : '-'),
                e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, x.fundedWeight > 0 ? pct(x.fundedWeight) : '-'),
                e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: text, fontSize: '0.78rem', fontWeight: 700 } }, pct(x.effectiveWeight)),
                e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, sym + fmt(x.valueEUR)));
            })))));

        // Sector / country / currency look-through
        var maxSector = result.sectorExposure.length ? result.sectorExposure[0].weight : 0;
        parts.push(sectionTitle('Sector look-through'));
        parts.push(e('div', null, result.sectorExposure.slice(0, 8).map(function (s) { return bar(s.sector, s.weight, maxSector, accent, 's-' + s.sector); })));

        var maxCountry = result.countryExposure.length ? result.countryExposure[0].weight : 0;
        parts.push(sectionTitle('Country look-through'));
        parts.push(e('div', null, result.countryExposure.slice(0, 8).map(function (c) { return bar(c.country, c.weight, maxCountry, theme.info || '#3b82f6', 'c-' + c.country); })));

        var maxCur = result.currencyExposure.length ? result.currencyExposure[0].weight : 0;
        parts.push(sectionTitle('Currency look-through (approximate)'));
        parts.push(e('div', null, result.currencyExposure.slice(0, 6).map(function (c) { return bar(c.currency, c.weight, maxCur, theme.success || '#22c55e', 'cur-' + c.currency); })));
      }

      if (mode !== 'overview') {
        // Fund overlap
        parts.push(sectionTitle('Fund overlap'));
        if (!result.overlapPairs.length) {
          parts.push(e('div', { style: { color: dim, fontSize: '0.8rem' } },
            fundCount > 1 ? 'No overlap detected between the disclosed holdings of your funds.' : 'Overlap needs at least two fund positions.'));
        } else {
          parts.push(e('div', null, result.overlapPairs.slice(0, 6).map(function (p) {
            return e('div', { key: p.a + '-' + p.b, style: { borderTop: '1px solid ' + border, padding: '0.5rem 0' } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem' } },
                e('span', { style: { color: text, fontSize: '0.82rem', fontWeight: 600 } }, p.a + ' / ' + p.b),
                e('span', { style: { color: p.overlap >= 0.25 ? warn : text, fontSize: '0.82rem', fontWeight: 700 } }, pct(p.overlap) + ' overlap')),
              e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.15rem' } },
                'Shared: ' + p.shared.map(function (s) { return s.name || s.key; }).join(', ')));
          })));
        }

        // Hidden concentrations
        parts.push(sectionTitle('Hidden concentration risks'));
        if (!result.hiddenConcentrations.length) {
          parts.push(e('div', { style: { color: dim, fontSize: '0.8rem' } }, 'No single security exceeds 5% of the portfolio once fund holdings are counted.'));
        } else {
          parts.push(e('div', null, result.hiddenConcentrations.slice(0, 6).map(function (h) {
            return e('div', { key: h.key, style: { borderTop: '1px solid ' + border, padding: '0.5rem 0' } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem' } },
                e('span', { style: { color: text, fontSize: '0.82rem', fontWeight: 600 } }, h.name || h.key),
                e('span', { style: { color: h.effectiveWeight >= 0.1 ? bad : warn, fontSize: '0.82rem', fontWeight: 700 } }, pct(h.effectiveWeight) + ' effective')),
              e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.15rem' } },
                (h.directWeight > 0 ? pct(h.directWeight) + ' held directly, ' : '') + pct(h.fundedWeight) + ' inside ' + h.funds.join(', ')));
          })));
        }
      }

      // Footer: coverage + sources + approximation disclaimer
      var sources = result.funds.some(function (f) { return f.source === 'worker'; })
        ? (result.funds.some(function (f) { return f.source === 'fallback'; }) ? 'live Worker data + built-in snapshot' : 'live Worker data')
        : 'built-in snapshot (approximate)';
      parts.push(e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.9rem', lineHeight: 1.5 } },
        fundCount + ' fund(s) resolved, ' + pct(result.coverage) + ' of portfolio value mapped to disclosed holdings. ' +
        'Source: ' + sources + '. Holdings are approximations (top holdings only) and not investment advice.'));

      if (state.unsupported) {
        parts.push(e('div', { style: { color: warn, fontSize: '0.74rem', marginTop: '0.5rem', lineHeight: 1.5 } },
          'Your Worker does not support fund look-through yet. Re-deploy the latest cf-worker/worker.js (it adds the action=fundholdings endpoint) for live holdings; until then a built-in snapshot of common ETFs is used.'));
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
    fallbackHoldings: fallbackHoldings,
    isFundCandidate: isFundCandidate,
    buildUrl: buildUrl,
    parseHoldingsResponse: parseHoldingsResponse,
    mergeFundData: mergeFundData,
    positionRows: positionRows,
    analyze: analyze,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminLookThrough = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
