// ============================================================================
// MAERMIN — Portfolio Intelligence Engine  (window.MaerminIntelligence)
// ----------------------------------------------------------------------------
// Feature 1 (v10): automatic detection of structural portfolio problems with
// concrete, ranked, data-grounded recommendations. NO new analytics engine —
// per the V7 rule this reads the existing single sources of truth:
//
//   MaerminMetrics        direct concentration, currency exposure, asset-class
//                         values (liquidity), expected dividends
//   MaerminLookThrough    EFFECTIVE per-security / sector / country / currency
//                         exposure, fund overlap, hidden concentrations
//   DividendDataService   per-payer annual dividend + growth (trap detection)
//
// Ten analyses, each emitting findings ranked into three priorities
// (critical → important → optimization):
//
//   singleCompany   one security crosses the limit counting ETF holdings
//   hidden          a security is large mostly because it hides inside funds
//   sector          a single sector dominates (look-through)
//   country         a single country dominates (look-through)
//   currency        a single currency dominates (look-through, FX risk)
//   correlation     funds overlap heavily → correlated cluster, not diversified
//   styleDrift      sector tilt drifts far from a broad-market reference
//   dividendTrap    high yield paired with weak/negative dividend growth
//   yieldTrap       high yield paired with a dividend cut-risk signal
//   liquidity       a large slice sits in hard-to-sell assets
//
// `analyzeFromInputs(inputs, opts)` is PURE and Node-tested (no DOM, no fetch);
// `analyze(portfolio, prices, transactions, opts)` gathers the inputs from the
// engines above. The React `View` is a thin shell over the pure result and
// folds in as one Tools surface (no recomputation in the view). Nothing is
// persisted, so no new SENSITIVE_KEYS.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  // ---- priority model ---------------------------------------------------------
  // Three buckets the spec asks for. Lower rank sorts first.
  var PRIORITY_RANK = { critical: 0, important: 1, optimization: 2 };

  // All thresholds are PERCENT (user-facing). Centralised + overridable so the
  // pure layer is fully testable and the UI can expose them later.
  var DEFAULTS = {
    singleCompanyCritical: 30, singleCompanyImportant: 20,
    hiddenFundedImportant: 10,
    sectorCritical: 40, sectorImportant: 30, sectorOptimize: 25,
    countryImportant: 75, countryOptimize: 60,
    currencyImportant: 80, currencyOptimize: 65,
    overlapImportant: 30, overlapOptimize: 20,
    dividendYieldHigh: 5, dividendGrowthLow: 2,
    yieldTrapYield: 6,
    styleTiltPp: 15,
    liquidityImportant: 15, liquidityOptimize: 8,
    // v11: themed concentration in the mega-cap US tech "Magnificent 7" — a
    // hidden cluster that dominates broad index ETFs, so investors are far more
    // exposed than their position list suggests.
    mag7Important: 30, mag7Optimize: 22,
    // v12: semiconductors are a single, highly cyclical industry that hides
    // inside broad and tech ETFs. Lower bands than Mag-7 (more volatile/cyclical).
    semiImportant: 25, semiOptimize: 16,
    // v12: any meaningful weight in a leveraged/inverse ETP is worth flagging —
    // daily-reset products decay in choppy markets and are rarely a buy-and-hold.
    leverageImportant: 10, leverageOptimize: 3,
    // v12: cumulative weight of the largest few EFFECTIVE holdings (look-through).
    // Catches concentration the single-name check misses — several 12–18% names
    // are individually "fine" but together drive most of the risk. Broad-ETF
    // holders are unaffected (their look-through spreads across thousands).
    topHoldingsCount: 5, top5Important: 65, top5Optimize: 50,
    // v13: one VOLATILE asset class (crypto, skins) dominating the whole book.
    // Tighter bands than equity sectors because these markets swing far harder;
    // an all-stocks investor is normal and is never flagged.
    acVolatileImportant: 50, acVolatileOptimize: 35,
    // v13: over-reliance on ONE dividend payer — a single name funding most of
    // your income means one cut or suspension hits the whole stream at once.
    incomeConcImportant: 40, incomeConcOptimize: 25,
    // v13: diworsification — you hold MANY names but a few dominate, so the
    // EFFECTIVE number of holdings (1/HHI on look-through weights) is far below
    // the nominal count. Only evaluated once you hold enough names that real
    // diversification is plausible (else the top-holdings check already covers it).
    divMinHoldings: 10, divEffectiveImportant: 8, divEffectiveOptimize: 15
  };

  // Asset classes that swing far harder than a diversified equity book; only
  // these get flagged when one dominates (a fully-invested equity book is fine).
  var VOLATILE_CLASSES = { crypto: 1, skins: 1 };

  // The "Magnificent 7". Matched against effective-exposure KEYS (uppercased
  // symbols from the look-through). GOOG/GOOGL both map to Alphabet.
  var MAG7 = { AAPL: 1, MSFT: 1, NVDA: 1, GOOGL: 1, GOOG: 1, AMZN: 1, META: 1, TSLA: 1 };

  // Semiconductor universe (curated). Matched against effective-exposure keys
  // exactly like MAG7 — a deliberate, transparent symbol list (no opaque model).
  var SEMIS = {
    NVDA: 1, AVGO: 1, TSM: 1, AMD: 1, INTC: 1, QCOM: 1, TXN: 1, MU: 1, AMAT: 1,
    ASML: 1, LRCX: 1, KLAC: 1, ADI: 1, MRVL: 1, NXPI: 1, MCHP: 1, ON: 1, STM: 1,
    SWKS: 1, MPWR: 1, TER: 1, ENTG: 1, QRVO: 1, GFS: 1, ARM: 1, SMCI: 1
  };

  // Leveraged / inverse exchange-traded products → daily-reset leverage factor
  // (negative = inverse). A curated, transparent list of the common US tickers;
  // unknown symbols are simply not flagged (no false positives from guessing).
  var LEVERAGED = {
    TQQQ: 3, SQQQ: -3, UPRO: 3, SPXU: -3, SPXL: 3, SPXS: -3, SDS: -2, SSO: 2, QLD: 2,
    UDOW: 3, SDOW: -3, TNA: 3, TZA: -3, SOXL: 3, SOXS: -3, TECL: 3, TECS: -3,
    FAS: 3, FAZ: -3, LABU: 3, LABD: -3, FNGU: 3, FNGD: -3, BULZ: 3, NAIL: 3,
    YINN: 3, YANG: -3, TMF: 3, TMV: -3, BOIL: 2, KOLD: -2, NUGT: 2, DUST: -2,
    UVXY: 1.5, SVXY: -0.5, TQQA: 3
  };
  function leverageOf(symbol) {
    var k = String(symbol || '').toUpperCase();
    return Object.prototype.hasOwnProperty.call(LEVERAGED, k) ? LEVERAGED[k] : null;
  }

  // Broad global-equity sector weights (≈ MSCI ACWI order of magnitude). Used
  // ONLY as the neutral reference for the style-drift gap — never as a target.
  var STYLE_REFERENCE = {
    'Technology': 24, 'Financials': 15, 'Health Care': 11, 'Healthcare': 11,
    'Consumer Discretionary': 11, 'Industrials': 11, 'Communication Services': 8,
    'Consumer Staples': 6, 'Energy': 4, 'Materials': 4, 'Utilities': 3, 'Real Estate': 3
  };

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }
  // Look-through weights are FRACTIONS (0..1); accept either and return percent.
  function asPct(w) {
    var n = num(w);
    if (n == null) return null;
    return n <= 1 ? n * 100 : n;
  }
  function I18N() { return (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js'); }
  function fmtPct(n) { return I18N().pct(Math.round((n || 0) * 10) / 10, { min: 0, max: 1 }); }
  function mergeThresholds(opts) {
    var T = {};
    Object.keys(DEFAULTS).forEach(function (k) { T[k] = DEFAULTS[k]; });
    if (opts && opts.thresholds && typeof opts.thresholds === 'object') {
      Object.keys(opts.thresholds).forEach(function (k) {
        var v = num(opts.thresholds[k]);
        if (v != null) T[k] = v;
      });
    }
    return T;
  }
  // Skip the catch-all buckets the look-through engine uses for uncovered weight.
  function isRealLabel(s) {
    if (!s) return false;
    var x = String(s).toLowerCase();
    return x !== 'other' && x !== 'unknown';
  }

  // ---- pure findings engine ---------------------------------------------------
  // inputs (all optional; a missing dimension simply produces no finding):
  //   totalValue
  //   effectiveExposure  [{key,name,effectiveWeight,directWeight,fundedWeight,funds?}]  (fractions)
  //   hiddenConcentrations [{name,key,effectiveWeight,directWeight,fundedWeight,funds}]
  //   sectorExposure     [{sector, weight}]      (fractions)
  //   countryExposure    [{country, weight}]
  //   currencyExposure   [{currency, weight}]    (look-through; fractions OR pct)
  //   directConcentration { available, maxWeight(0..1 or %), topLabel }
  //   overlapPairs       [{a, b, overlap, shared:[{name,weight}]}]   (fractions)
  //   dividend           { available, yield(%), weightedGrowth(%)|null,
  //                        incomeAtRiskPct(%)|null, traps:[{symbol,yield,growth,cutRisk}] }
  //   liquidity          { available, illiquidPct(%), classes:[{cls, pct}] }
  //   coverage           look-through coverage fraction (for the data-quality note)
  function analyzeFromInputs(inputs, opts) {
    inputs = inputs || {};
    var T = mergeThresholds(opts);
    var F = [];

    function push(analysis, priority, id, title, detail, action, metric) {
      F.push({
        analysis: analysis, priority: priority, id: id,
        title: title, detail: detail, action: action,
        metric: (metric == null ? null : metric)
      });
    }

    // 1) Single company risk (effective, look-through) -------------------------
    var eff = (inputs.effectiveExposure || []).filter(function (x) { return isRealLabel(x.name || x.key); });
    var topEff = eff[0];
    if (topEff) {
      var effPct = asPct(topEff.effectiveWeight);
      var name = topEff.name || topEff.key;
      var via = topEff.funds || (topEff.via ? topEff.via.map(function (v) { return v.fund; }) : []);
      var viaTxt = via && via.length ? ' ' + __('piViaTxt', '(held directly and through {list})', { list: via.join(', ') }) : '';
      if (effPct != null && effPct >= T.singleCompanyCritical) {
        push('singleCompany', 'critical', 'sc-critical',
          __('piScCritTitle', 'Your portfolio carries {pct} effective {name} exposure across ETFs and single stocks', { pct: fmtPct(effPct), name: name }),
          __('piScCritDetail', 'A single company above {limit} — counting what your ETFs hold — drives most of your idiosyncratic risk.', { limit: fmtPct(T.singleCompanyCritical) }),
          __('piScCritAction', 'Trim {name} toward a {cap} cap or add uncorrelated holdings.', { name: name + viaTxt, cap: I18N().pct(20, 0) + '–' + fmtPct(25) }), effPct);
      } else if (effPct != null && effPct >= T.singleCompanyImportant) {
        push('singleCompany', 'important', 'sc-important',
          __('piScImpTitle', 'Effective {name} exposure is {pct} across funds and direct holdings', { name: name, pct: fmtPct(effPct) }),
          __('piScImpDetail', 'Above {limit} in one company increases concentration risk you may not see in the position list.', { limit: fmtPct(T.singleCompanyImportant) }),
          __('piScImpAction', 'Watch this effective weight; rebalance if it keeps growing.'), effPct);
      }
    }

    // 2) Hidden concentration (mostly inside funds) ----------------------------
    var hidden = (inputs.hiddenConcentrations || []).filter(function (h) {
      return isRealLabel(h.name || h.key) && asPct(h.fundedWeight) != null && asPct(h.fundedWeight) >= T.hiddenFundedImportant;
    });
    if (hidden.length) {
      var h0 = hidden[0];
      var fundedPct = asPct(h0.fundedWeight), directPct = asPct(h0.directWeight) || 0, effH = asPct(h0.effectiveWeight);
      push('hidden', directPct < fundedPct ? 'important' : 'optimization', 'hidden-1',
        __('piHidTitle', '{name} is {pct} of your portfolio, {funded} of it hidden inside funds', { name: h0.name || h0.key, pct: fmtPct(effH), funded: fmtPct(fundedPct) }),
        (directPct > 0 ? __('piHidDirect', '{pct} is held directly;', { pct: fmtPct(directPct) }) + ' ' : '') + __('piHidInside', '{pct} sits inside {list}.', { pct: fmtPct(fundedPct), list: (h0.funds || []).join(', ') || __('piYourEtfs', 'your ETFs') }) +
          (hidden.length > 1 ? ' ' + __('piHidMore', '{n} more {n:security is|securities are} similarly concentrated.', { n: hidden.length - 1 }) : ''),
        __('piHidAction', 'Overlapping funds multiply single-stock risk — check the look-through before adding more of the same funds.'), effH);
    }

    // 2b) Magnificent-7 cluster (effective, look-through) ----------------------
    // Sum the effective weight of the mega-cap US tech names. They co-move
    // strongly, so a high combined weight is a single concentrated bet even when
    // no individual name trips the single-company check.
    if (eff.length) {
      var mag7Pct = 0, mag7Names = [];
      eff.forEach(function (x) {
        var k = String(x.key || '').toUpperCase();
        if (MAG7[k]) { var p = asPct(x.effectiveWeight); if (p != null) { mag7Pct += p; mag7Names.push(x.name || k); } }
      });
      mag7Pct = Math.round(mag7Pct * 10) / 10;
      if (mag7Pct >= T.mag7Important) {
        push('mag7', 'important', 'mag7-important',
          __('piMag7Title', '{pct} of your portfolio is in the "Magnificent 7" mega-caps', { pct: fmtPct(mag7Pct) }),
          __('piMag7Detail', 'These few names ({list}) move together and dominate broad index ETFs — your effective tech-megacap bet is larger than the position list shows.', { list: mag7Names.slice(0, 7).join(', ') }),
          __('piMag7Action', 'Check how much of this is unintended ETF overlap; diversify beyond mega-cap US tech if it is.'), mag7Pct);
      } else if (mag7Pct >= T.mag7Optimize) {
        push('mag7', 'optimization', 'mag7-optimize',
          __('piMag7OptTitle', 'Combined "Magnificent 7" exposure is {pct}', { pct: fmtPct(mag7Pct) }),
          __('piMag7OptDetail', 'Common for global index investors, but worth knowing it is a correlated cluster.'),
          __('piMag7OptAction', 'Keep an eye on it so the mega-cap tilt does not grow unchecked.'), mag7Pct);
      }
    }

    // 2c) Semiconductor concentration (effective, look-through) ----------------
    // Chips are one cyclical industry that hides inside broad/tech ETFs. Summed
    // effective weight, same transparent symbol-list approach as the Mag-7 check.
    if (eff.length) {
      var semiPct = 0, semiNames = [];
      eff.forEach(function (x) {
        var k = String(x.key || '').toUpperCase();
        if (SEMIS[k]) { var p = asPct(x.effectiveWeight); if (p != null) { semiPct += p; semiNames.push(x.name || k); } }
      });
      semiPct = Math.round(semiPct * 10) / 10;
      if (semiPct >= T.semiImportant) {
        push('semiconductor', 'important', 'semi-important',
          __('piSemiTitle', '{pct} of your portfolio is in semiconductors', { pct: fmtPct(semiPct) }),
          __('piSemiDetail', 'Chips ({list}) are one deeply cyclical industry; this much effective weight — counting ETF holdings — is a concentrated cycle bet.', { list: semiNames.slice(0, 6).join(', ') }),
          __('piSemiAction', 'Confirm the chip tilt is intentional; trim or broaden across industries if not.'), semiPct);
      } else if (semiPct >= T.semiOptimize) {
        push('semiconductor', 'optimization', 'semi-optimize',
          __('piSemiOptTitle', 'Semiconductor exposure is {pct}', { pct: fmtPct(semiPct) }),
          __('piSemiOptDetail', 'Moderate, but semis swing hard with the cycle — worth tracking so it does not creep up.'),
          __('piSemiOptAction', 'Steer new contributions toward other industries if you want to cap it.'), semiPct);
      }
    }

    // 2d) Hidden leverage (leveraged / inverse ETPs) ---------------------------
    // Daily-reset leveraged/inverse products decay in choppy markets and are not
    // buy-and-hold instruments; many holders don't realise they own one.
    var lv = inputs.leverage;
    if (lv && lv.available && (lv.positions || []).length) {
      var levWeighted = num(lv.leveredWeightPct) || 0;            // Σ weight·|factor|
      var rawWeight = num(lv.rawWeightPct) || 0;                  // Σ weight (plain)
      var hasInverse = (lv.positions || []).some(function (p) { return num(p.factor) < 0; });
      var names = (lv.positions || []).map(function (p) {
        return p.symbol + ' (' + (num(p.factor) > 0 ? '+' : '') + num(p.factor) + 'x)';
      }).slice(0, 5);
      var levMetric = Math.round(rawWeight * 10) / 10;
      if (rawWeight >= T.leverageImportant || hasInverse || levWeighted >= 20) {
        push('leverage', 'important', 'leverage-important',
          __('piLevTitle', 'You hold leveraged/inverse ETPs ({pct} of the portfolio, {gross} gross exposure)', { pct: fmtPct(rawWeight), gross: fmtPct(Math.round(levWeighted * 10) / 10) }),
          __('piLevDetail', 'Daily-reset products ({list}) decay in volatile, sideways markets and can diverge sharply from the index over weeks — they are trading tools, not buy-and-hold.', { list: names.join(', ') }),
          __('piLevAction', 'Hold these only as deliberate short-term positions; size them to what you can actively manage.'), levMetric);
      } else if (rawWeight >= T.leverageOptimize) {
        push('leverage', 'optimization', 'leverage-optimize',
          __('piLevOptTitle', 'A small leveraged/inverse position ({pct}: {list})', { pct: fmtPct(rawWeight), list: names.join(', ') }),
          __('piLevOptDetail', 'Manageable, but daily-reset leverage is path-dependent and erodes in choppy markets.'),
          __('piLevOptAction', 'Keep it small and intentional; avoid treating it as a long-term core holding.'), levMetric);
      }
    }

    // 2e) Top-holdings concentration (cumulative effective weight) --------------
    // The single-company check looks at the LARGEST name; this looks at the few
    // largest TOGETHER — a cluster of 12–18% names is individually fine yet
    // collectively drives most of the risk. eff is already sorted desc.
    var nTop = Math.max(2, Math.round(T.topHoldingsCount) || 5);
    if (eff.length >= nTop) {
      var topN = 0, topNames = [];
      for (var ti = 0; ti < nTop && ti < eff.length; ti++) {
        var tw = asPct(eff[ti].effectiveWeight);
        if (tw != null) { topN += tw; topNames.push(eff[ti].name || eff[ti].key); }
      }
      topN = Math.round(topN * 10) / 10;
      if (topN >= T.top5Important) {
        push('concentration', 'important', 'topholdings-important',
          __('piTopTitle', 'Your {n} largest holdings are {pct} of the portfolio', { n: nTop, pct: fmtPct(topN) }),
          __('piTopDetail', 'A handful of names ({list}) — counting what your ETFs hold — drive most of your outcome; a setback in them dominates your return.', { list: topNames.slice(0, nTop).join(', ') }),
          __('piTopAction', 'Confirm this concentration is intended; broaden the base if a few positions have grown to dominate.'), topN);
      } else if (topN >= T.top5Optimize) {
        push('concentration', 'optimization', 'topholdings-optimize',
          __('piTopTitle', 'Your {n} largest holdings are {pct} of the portfolio', { n: nTop, pct: fmtPct(topN) }),
          __('piTopOptDetail', 'Moderately top-heavy — common, but worth knowing how much rides on the few biggest positions.'),
          __('piTopOptAction', 'Steer new contributions to the rest of the book if you want to dilute the top.'), topN);
      }
    }

    // 2f) Diversification quality (effective number of holdings, 1/HHI) --------
    // You may hold dozens of names yet, because a few dominate, behave like far
    // fewer. The effective holding count (inverse Herfindahl–Hirschman index on
    // the look-through weights) exposes that "diworsification". Weights are
    // normalised over the covered names so 1/HHI reads as an equal-weight count.
    if (eff.length >= T.divMinHoldings) {
      var wsum = 0, fr = [];
      eff.forEach(function (x) { var p = asPct(x.effectiveWeight); if (p != null && p > 0) { fr.push(p / 100); wsum += p / 100; } });
      if (wsum > 0 && fr.length) {
        var hhiAcc = 0;
        fr.forEach(function (f) { var n = f / wsum; hhiAcc += n * n; });
        var effN = hhiAcc > 0 ? 1 / hhiAcc : fr.length;
        effN = Math.round(effN * 10) / 10;
        if (effN < T.divEffectiveImportant) {
          push('diversification', 'important', 'diversification-important',
            __('piDivTitle', 'Your {n} holdings behave like only ~{eff} equally-weighted positions', { n: eff.length, eff: I18N().num(effN, { min: 0, max: 1 }) }),
            __('piDivDetail', 'The effective holding count (inverse Herfindahl on look-through weights) is far below your nominal count — a few names carry most of the risk, so you are less diversified than the position list suggests.'),
            __('piDivAction', 'Rebalance toward the smaller positions or trim the dominant ones to raise effective diversification.'), effN);
        } else if (effN < T.divEffectiveOptimize) {
          push('diversification', 'optimization', 'diversification-optimize',
            __('piDivOptTitle', 'Your portfolio diversifies like ~{eff} equal positions across {n} holdings', { eff: I18N().num(effN, { min: 0, max: 1 }), n: eff.length }),
            __('piDivOptDetail', 'Reasonable, but the largest holdings still dominate the effective risk more than the raw count implies.'),
            __('piDivOptAction', 'Tilt new contributions toward the smaller positions to lift effective diversification.'), effN);
        }
      }
    }

    // 3) Sector overexposure ---------------------------------------------------
    var sec = (inputs.sectorExposure || []).filter(function (s) { return isRealLabel(s.sector); })[0];
    if (sec) {
      var secPct = asPct(sec.weight);
      if (secPct != null && secPct >= T.sectorCritical) {
        push('sector', 'critical', 'sector-critical',
          __('piSecTitle', '{pct} of your portfolio is in the {sector} sector', { pct: fmtPct(secPct), sector: I18N().sector(sec.sector) }),
          __('piSecCritDetail', 'A single sector above {limit} concentrates you in one part of the economic cycle.', { limit: fmtPct(T.sectorCritical) }),
          __('piSecCritAction', 'Diversify into under-weighted sectors to reduce cyclical risk.'), secPct);
      } else if (secPct != null && secPct >= T.sectorImportant) {
        push('sector', 'important', 'sector-important',
          __('piSecTitle', '{pct} of your portfolio is in the {sector} sector', { pct: fmtPct(secPct), sector: I18N().sector(sec.sector) }),
          __('piSecImpDetail', 'Heavy single-sector weight (over {limit}) raises correlation between your holdings.', { limit: fmtPct(T.sectorImportant) }),
          __('piSecImpAction', 'Consider broadening across sectors on the next contribution.'), secPct);
      } else if (secPct != null && secPct >= T.sectorOptimize) {
        push('sector', 'optimization', 'sector-optimize',
          __('piSecOptTitle', 'Largest sector is {sector} at {pct}', { sector: I18N().sector(sec.sector), pct: fmtPct(secPct) }),
          __('piSecOptDetail', 'Still moderate, but worth watching so it does not become a concentration.'),
          __('piSecOptAction', 'Steer new contributions toward other sectors.'), secPct);
      }
    }

    // 4) Country risk ----------------------------------------------------------
    var ctry = (inputs.countryExposure || []).filter(function (c) { return isRealLabel(c.country); })[0];
    if (ctry) {
      var cPct = asPct(ctry.weight);
      if (cPct != null && cPct >= T.countryImportant) {
        push('country', 'important', 'country-important',
          __('piCtyTitle', '{pct} of your portfolio is exposed to {country}', { pct: fmtPct(cPct), country: I18N().country(ctry.country) }),
          __('piCtyDetail', 'Single-country weight over {limit} ties your wealth to one economy and policy regime.', { limit: fmtPct(T.countryImportant) }),
          __('piCtyAction', 'Add regions outside {country} (e.g. a broad ex-{country} fund).', { country: I18N().country(ctry.country) }), cPct);
      } else if (cPct != null && cPct >= T.countryOptimize) {
        push('country', 'optimization', 'country-optimize',
          __('piCtyOptTitle', 'Largest country exposure is {country} at {pct}', { country: I18N().country(ctry.country), pct: fmtPct(cPct) }),
          __('piCtyOptDetail', 'Common for global index investors, but a more balanced regional split lowers single-country risk.'),
          __('piCtyOptAction', 'Tilt future buys toward other regions if you want to reduce it.'), cPct);
      }
    }

    // 5) Currency risk ---------------------------------------------------------
    var cur = (inputs.currencyExposure || []).filter(function (c) { return isRealLabel(c.currency); })[0];
    if (cur) {
      var curPct = asPct(cur.weight);
      if (curPct != null && curPct >= T.currencyImportant) {
        push('currency', 'important', 'currency-important',
          __('piCurTitle', '{cur} exposure is {pct}', { cur: cur.currency, pct: fmtPct(curPct) }),
          __('piCurDetail', 'Most of your real return now depends on the {cur} exchange rate, not just on your holdings.', { cur: cur.currency }),
          __('piCurAction', 'Diversify currencies or consider an FX-hedged share class for part of the position.'), curPct);
      } else if (curPct != null && curPct >= T.currencyOptimize) {
        push('currency', 'optimization', 'currency-optimize',
          __('piCurTitle', '{cur} exposure is {pct}', { cur: cur.currency, pct: fmtPct(curPct) }),
          __('piCurOptDetail', 'Your portfolio leans on one currency; some FX risk is unavoidable for a global investor.'),
          __('piCurOptAction', 'Keep an eye on it; add non-{cur} assets opportunistically.', { cur: cur.currency }), curPct);
      }
    }

    // 6) Correlation clusters (fund overlap) -----------------------------------
    var ov = (inputs.overlapPairs || [])[0];
    if (ov) {
      var ovPct = asPct(ov.overlap);
      var shared = (ov.shared || []).slice(0, 3).map(function (s) { return s.name || s.key; }).filter(Boolean);
      if (ovPct != null && ovPct >= T.overlapImportant) {
        push('correlation', 'important', 'corr-important',
          __('piOvTitle', '{a} and {b} overlap by {pct} — they form a correlated cluster, not diversification', { a: ov.a, b: ov.b, pct: fmtPct(ovPct) }),
          (shared.length ? __('piOvDetailShared', 'Holding both adds little diversification; both are heavy in {list}.', { list: shared.join(', ') }) : __('piOvDetail', 'Holding both adds little diversification.')),
          __('piOvAction', 'Keep the cheaper/broader of the two and redeploy the rest into something uncorrelated.'), ovPct);
      } else if (ovPct != null && ovPct >= T.overlapOptimize) {
        push('correlation', 'optimization', 'corr-optimize',
          __('piOvOptTitle', '{a} and {b} overlap by {pct}', { a: ov.a, b: ov.b, pct: fmtPct(ovPct) }),
          (shared.length ? __('piOvOptShared', 'Moderate overlap driven by {list}.', { list: shared.join(', ') }) : __('piOvOptDetail', 'Moderate overlap.')),
          __('piOvOptAction', 'Fine to hold both, but avoid stacking more funds with the same core.'), ovPct);
      }
    }

    // 7) Style drift (sector tilt vs broad-market reference) -------------------
    if (sec) {
      var topSecPct = asPct(sec.weight);
      var ref = STYLE_REFERENCE[sec.sector];
      if (topSecPct != null && ref != null) {
        var gap = topSecPct - ref;
        if (gap >= T.styleTiltPp && topSecPct < T.sectorCritical) {
          // Don't duplicate the critical sector finding; this is the "drift" angle.
          push('styleDrift', 'optimization', 'style-drift',
            __('piStyleTitle', 'Your style has drifted toward {sector} ({pct} vs ~{ref} in a broad global index)', { sector: I18N().sector(sec.sector), pct: fmtPct(topSecPct), ref: fmtPct(ref) }),
            __('piStyleDetail', 'A {gap} overweight versus the market means you are taking an active style bet, intended or not.', { gap: fmtPct(gap) }),
            __('piStyleAction', 'Confirm the tilt is deliberate; otherwise rebalance toward market weights.'), gap);
        }
      }
    }

    // 8) Dividend trap (high yield + weak growth) ------------------------------
    var dv = inputs.dividend;
    if (dv && dv.available && num(dv.yield) != null) {
      var y = num(dv.yield), g = num(dv.weightedGrowth);
      if (y >= T.dividendYieldHigh && g != null && g < T.dividendGrowthLow) {
        push('dividendTrap', 'important', 'div-trap',
          __('piDtTitle', 'Dividend yield is high ({y}) but dividend growth is low ({g})', { y: fmtPct(y), g: fmtPct(g) }),
          __('piDtDetail', 'A high yield with stagnant or shrinking dividends often signals a value/dividend trap rather than durable income.'),
          __('piDtAction', 'Favour dividend growers over the highest headline yields; verify payout sustainability.'), y);
      }
      // 9) Yield trap (high yield + cut-risk signal) ---------------------------
      var atRisk = num(dv.incomeAtRiskPct);
      var trapNames = (dv.traps || []).filter(function (x) { return x && x.cutRisk; }).map(function (x) { return x.symbol; }).filter(Boolean);
      if (y >= T.yieldTrapYield && ((atRisk != null && atRisk > 0) || trapNames.length)) {
        push('yieldTrap', 'critical', 'yield-trap',
          __('piYtTitle', 'Possible yield trap: {pct} yield with dividend cut-risk signals', { pct: fmtPct(y) }) + (atRisk != null && atRisk > 0 ? ' ' + __('piYtOnIncome', 'on {pct} of income', { pct: fmtPct(atRisk) }) : ''),
          __('piYtDetail', 'High yields paired with weak coverage or recent cuts frequently precede a dividend reduction') + (trapNames.length ? ' (' + trapNames.slice(0, 3).join(', ') + ').' : '.'),
          __('piYtAction', 'Stress-test the payout; do not buy the dip on yield alone.'), y);
      }

      // 9b) Income concentration (one payer funds most dividends) -------------
      // Independent of yield: even a healthy book is fragile if a single name
      // pays most of the income, since one cut takes out the whole stream.
      var tp = dv.topPayer;
      if (tp && tp.symbol && num(tp.incomeSharePct) != null) {
        var share = num(tp.incomeSharePct);
        if (share >= T.incomeConcImportant) {
          push('incomeConcentration', 'important', 'income-conc-important',
            __('piIcTitle', '{sym} pays {pct} of your dividend income', { sym: tp.symbol, pct: fmtPct(share) }),
            __('piIcDetail', 'Relying on one payer for most of your income means a single dividend cut or suspension hits the whole stream at once.'),
            __('piIcAction', 'Spread income across more payers and sectors so no single cut breaks your cash flow.'), share);
        } else if (share >= T.incomeConcOptimize) {
          push('incomeConcentration', 'optimization', 'income-conc-optimize',
            __('piIcTitle', '{sym} pays {pct} of your dividend income', { sym: tp.symbol, pct: fmtPct(share) }),
            __('piIcOptDetail', 'A sizeable share of income comes from one payer — manageable, but worth diversifying over time.'),
            __('piIcOptAction', 'Add income from other payers on future contributions to balance the stream.'), share);
        }
      }
    }

    // 10) Liquidity risk -------------------------------------------------------
    var lq = inputs.liquidity;
    if (lq && lq.available && num(lq.illiquidPct) != null) {
      var ill = num(lq.illiquidPct);
      var clsTxt = (lq.classes || []).filter(function (c) { return num(c.pct) > 0; })
        .map(function (c) { return I18N().category(c.cls) + ' ' + fmtPct(asPct(c.pct)); });
      if (ill >= T.liquidityImportant) {
        push('liquidity', 'important', 'liq-important',
          __('piLiqTitle', '{pct} of your portfolio is in hard-to-sell assets', { pct: fmtPct(ill) }),
          __('piLiqDetail', 'Illiquid holdings{list} can be slow or costly to exit when you need cash.', { list: clsTxt.length ? ' (' + clsTxt.join(', ') + ')' : '' }),
          __('piLiqAction', 'Keep an adequate liquid buffer; size illiquid bets to what you can hold through a downturn.'), ill);
      } else if (ill >= T.liquidityOptimize) {
        push('liquidity', 'optimization', 'liq-optimize',
          __('piLiqOptTitle', '{pct} of your portfolio is in less-liquid assets', { pct: fmtPct(ill) }),
          __('piLiqOptDetail', 'Manageable, but worth tracking') + (clsTxt.length ? ' (' + clsTxt.join(', ') + ').' : '.'),
          __('piLiqOptAction', 'Avoid letting illiquid positions grow past your comfort for forced sales.'), ill);
      }
    }

    // 11) Single asset-class concentration (volatile bucket) ------------------
    // One high-volatility class (crypto, skins) dominating the whole book is a
    // concentrated bet on that single market. Equity/commodity-heavy books are
    // not flagged — being fully invested in stocks is normal.
    var ac = inputs.assetClass;
    if (ac && ac.available && ac.top && VOLATILE_CLASSES[String(ac.top.cls || '').toLowerCase()]) {
      var acPct = asPct(ac.top.pct);
      var acCls = I18N().category(ac.top.cls);
      if (acPct != null && acPct >= T.acVolatileImportant) {
        push('assetClass', 'important', 'assetclass-important',
          __('piAcTitle', '{pct} of your portfolio is in {cls}', { pct: fmtPct(acPct), cls: acCls }),
          __('piAcDetail', '{cls} is a single, highly volatile market; this much in one class means a drawdown there dominates your whole portfolio.', { cls: acCls }),
          __('piAcAction', 'Confirm the concentration is intentional; trim toward other classes or hold a larger stable buffer.'), acPct);
      } else if (acPct != null && acPct >= T.acVolatileOptimize) {
        push('assetClass', 'optimization', 'assetclass-optimize',
          __('piAcOptTitle', '{cls} is {pct} of your portfolio', { cls: acCls, pct: fmtPct(acPct) }),
          __('piAcOptDetail', 'A meaningful slice in one volatile class — fine if deliberate, but worth tracking so it does not creep up.'),
          __('piAcOptAction', 'Steer new contributions toward other classes if you want to cap the swing.'), acPct);
      }
    }

    // Direct (non-look-through) concentration fallback: only when we have NO
    // effective exposure data, so the engine still says something useful offline.
    if (!eff.length && inputs.directConcentration && inputs.directConcentration.available) {
      var dc = asPct(inputs.directConcentration.maxWeight);
      var dl = inputs.directConcentration.topLabel || __('advTopPosition', 'Top position');
      if (dc != null && dc >= T.singleCompanyImportant) {
        push('singleCompany', dc >= T.singleCompanyCritical ? 'critical' : 'important', 'sc-direct',
          __('advIsOfPortfolio', '{name} is {pct} of your portfolio', { name: dl, pct: fmtPct(dc) }),
          __('piDirectDetail', 'Largest single position by direct weight (fund look-through unavailable — open Health once to resolve effective exposure).'),
          __('piDirectAction', 'Reduce {name} or diversify; load fund data for the full picture.', { name: dl }), dc);
      }
    }

    F.sort(function (a, b) {
      var d = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (d !== 0) return d;
      return (num(b.metric) || 0) - (num(a.metric) || 0);
    });

    var summary = {
      total: F.length,
      critical: F.filter(function (f) { return f.priority === 'critical'; }).length,
      important: F.filter(function (f) { return f.priority === 'important'; }).length,
      optimization: F.filter(function (f) { return f.priority === 'optimization'; }).length,
      coverage: num(inputs.coverage)
    };
    return { findings: F, summary: summary };
  }

  // ---- gather the inputs from the existing engines (impure) ------------------
  // lookThrough: pass MaerminLookThrough.analyze()'s result when a view already
  // has it (the renderer keeps lookThroughResult from the Health view). When it
  // is absent the engine degrades to the direct-concentration fallback.
  function gatherInputs(portfolio, prices, transactions, opts) {
    opts = opts || {};
    var w = (typeof window !== 'undefined') ? window : {};
    var M = w.MaerminMetrics;
    var inputs = {};
    var lt = opts.lookThrough;

    if (lt && lt.available) {
      inputs.totalValue = lt.totalValue;
      inputs.effectiveExposure = lt.effectiveExposure;
      inputs.hiddenConcentrations = lt.hiddenConcentrations;
      inputs.sectorExposure = lt.sectorExposure;
      inputs.countryExposure = lt.countryExposure;
      inputs.currencyExposure = lt.currencyExposure;
      inputs.overlapPairs = lt.overlapPairs;
      inputs.coverage = lt.coverage;
    }

    // Direct concentration + currency fallback when look-through is missing.
    try {
      if (M && M.computeConcentration) {
        var conc = M.computeConcentration(portfolio, prices);
        if (conc && conc.available) {
          var top = conc.top && conc.top[0];
          inputs.directConcentration = {
            available: true, maxWeight: conc.maxWeight,
            topLabel: top ? (top.label || top.symbol || top.name) : __('advTopPosition', 'Top position')
          };
        }
      }
    } catch (e) {}
    try {
      if ((!inputs.currencyExposure || !inputs.currencyExposure.length) && M && M.computeCurrencyExposure) {
        var fx = M.computeCurrencyExposure(portfolio, prices, transactions);
        if (fx && fx.available) {
          inputs.currencyExposure = fx.rows.map(function (r) { return { currency: r.currency, weight: r.pct }; });
        }
      }
    } catch (e) {}

    // Liquidity: share of value in hard-to-sell asset classes (skins/collectibles).
    try {
      if (M && M.computeStats) {
        var ILLIQUID = ['skins', 'commodities'];
        var byClass = {}, total = 0;
        M.ASSET_CLASSES.forEach(function (cls) {
          var v = (portfolio && portfolio[cls] || []).reduce(function (s, p) {
            var amt = parseFloat(p.amount) || 0;
            var px = prices[(p.symbol || p.name || '').toUpperCase()] || prices[(p.symbol || p.name || '').toLowerCase()] || p.currentPrice || p.purchasePrice || 0;
            return s + amt * px;
          }, 0);
          byClass[cls] = v; total += v;
        });
        if (total > 0) {
          var illiquid = ILLIQUID.reduce(function (s, c) { return s + (byClass[c] || 0); }, 0);
          inputs.liquidity = {
            available: true,
            illiquidPct: (illiquid / total) * 100,
            classes: ILLIQUID.map(function (c) { return { cls: c, pct: (byClass[c] / total) * 100 }; }).filter(function (c) { return c.pct > 0; })
          };
        }
      }
    } catch (e) {}

    // Single asset-class concentration: weight of each class vs the whole book.
    try {
      if (M && M.ASSET_CLASSES) {
        var acByClass = {}, acTotal = 0;
        M.ASSET_CLASSES.forEach(function (cls) {
          var v = (portfolio && portfolio[cls] || []).reduce(function (s, p) {
            var amt = parseFloat(p.amount) || 0;
            var px = prices[(p.symbol || p.name || '').toUpperCase()] || prices[(p.symbol || p.name || '').toLowerCase()] || p.currentPrice || p.purchasePrice || 0;
            return s + amt * px;
          }, 0);
          acByClass[cls] = v; acTotal += v;
        });
        if (acTotal > 0) {
          var acClasses = Object.keys(acByClass)
            .map(function (c) { return { cls: c, pct: (acByClass[c] / acTotal) * 100 }; })
            .sort(function (a, b) { return b.pct - a.pct; });
          inputs.assetClass = { available: true, classes: acClasses, top: acClasses[0] };
        }
      }
    } catch (e) {}

    // Leveraged / inverse ETP detection: scan direct positions for known tickers
    // and weight them against the whole portfolio. Pure lookup (no network).
    try {
      var priceOfPos = function (p) {
        return prices[(p.symbol || p.name || '').toUpperCase()] || prices[(p.symbol || p.name || '').toLowerCase()] || p.currentPrice || p.purchasePrice || 0;
      };
      var levClasses = (M && M.ASSET_CLASSES) || ['crypto', 'stocks', 'skins', 'commodities'];
      var totalVal = 0, levHits = [];
      levClasses.forEach(function (cls) {
        (portfolio && portfolio[cls] || []).forEach(function (p) {
          var val = (parseFloat(p.amount) || 0) * priceOfPos(p);
          totalVal += val;
          var f = leverageOf(p.symbol || p.name);
          if (f != null && val > 0) levHits.push({ symbol: (p.symbol || p.name || '').toUpperCase(), factor: f, val: val });
        });
      });
      if (totalVal > 0 && levHits.length) {
        var rawW = 0, leveredW = 0;
        var positions = levHits.map(function (lp) {
          var wPct = (lp.val / totalVal) * 100;
          rawW += wPct; leveredW += wPct * Math.abs(lp.factor);
          return { symbol: lp.symbol, factor: lp.factor, weightPct: wPct };
        });
        inputs.leverage = { available: true, positions: positions, rawWeightPct: rawW, leveredWeightPct: leveredW };
      }
    } catch (e) {}

    // Dividend trap inputs from the ONE dividend service (best-effort).
    try {
      var svc = w.DividendDataService;
      if (svc && svc.getPortfolioDividendData) {
        var data = svc.getPortfolioDividendData(portfolio, prices) || {};
        var stocks = (portfolio && portfolio.stocks) || [];
        var annual = 0, value = 0, gW = 0, gWsum = 0;
        var traps = [];
        var payerIncome = {};
        stocks.forEach(function (s) {
          var sym = (s.symbol || s.name || '').toUpperCase();
          var shares = parseFloat(s.amount || 0) || 0;
          if (shares <= 0) return;
          var px = prices[sym] || prices[sym.toLowerCase()] || s.currentPrice || s.purchasePrice || 0;
          var posVal = shares * px;
          value += posVal;
          var d = data[sym];
          if (d && d.annualDividend > 0) {
            var inc = shares * d.annualDividend;
            annual += inc;
            payerIncome[sym] = (payerIncome[sym] || 0) + inc;
            var posYield = px > 0 ? (d.annualDividend / px) * 100 : 0;
            var growth = num(d.growthRate);
            if (growth != null) { gW += (growth * 100) * inc; gWsum += inc; }
            var cutRisk = (growth != null && growth < 0);
            if (posYield >= DEFAULTS.dividendYieldHigh && ((growth != null && growth < DEFAULTS.dividendGrowthLow / 100) || cutRisk)) {
              traps.push({ symbol: sym, yield: posYield, growth: growth != null ? growth * 100 : null, cutRisk: cutRisk });
            }
          }
        });
        if (annual > 0) {
          // incomeAtRiskPct: share of dividend income flagged as cut-risk.
          var riskIncome = 0, totalIncome = 0;
          stocks.forEach(function (s) {
            var sym2 = (s.symbol || s.name || '').toUpperCase();
            var shares2 = parseFloat(s.amount || 0) || 0;
            var d2 = data[sym2];
            if (!d2 || !(d2.annualDividend > 0) || shares2 <= 0) return;
            var inc2 = shares2 * d2.annualDividend;
            totalIncome += inc2;
            var gr = num(d2.growthRate);
            if (gr != null && gr < 0) riskIncome += inc2;
          });
          // Top dividend payer's share of total income (over-reliance signal).
          var topSym = null, topInc = 0;
          Object.keys(payerIncome).forEach(function (s) {
            if (payerIncome[s] > topInc) { topInc = payerIncome[s]; topSym = s; }
          });
          inputs.dividend = {
            available: true,
            yield: value > 0 ? (annual / value) * 100 : 0,
            weightedGrowth: gWsum > 0 ? gW / gWsum : null,
            incomeAtRiskPct: totalIncome > 0 ? (riskIncome / totalIncome) * 100 : 0,
            traps: traps,
            topPayer: topSym ? { symbol: topSym, incomeSharePct: (topInc / annual) * 100 } : null
          };
        }
      }
    } catch (e) {}

    return inputs;
  }

  function analyze(portfolio, prices, transactions, opts) {
    return analyzeFromInputs(gatherInputs(portfolio, prices, transactions, opts), opts);
  }

  // ---- export helper: portable, redaction-safe finding list ------------------
  // Findings are advice text (percentages + names), no amounts/quantities. Used
  // by the Professional Reports feature and the View's "copy" affordance.
  function toExport(report, meta) {
    report = report || { findings: [], summary: {} };
    return {
      module: 'portfolio-intelligence',
      version: 1,
      generatedAt: (meta && meta.generatedAt) || new Date().toISOString(),
      summary: report.summary,
      findings: (report.findings || []).map(function (f) {
        return { analysis: f.analysis, priority: f.priority, title: f.title, detail: f.detail, action: f.action };
      })
    };
  }

  // ---- React View (browser only; one Tools surface) --------------------------
  function View(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
    var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
    var card = theme.card || theme.cardBg || '#10151f';
    var bad = theme.danger || theme.negative || '#ef4444';
    var warn = theme.warning || '#f59e0b';
    var ok = theme.success || '#22c55e';
    var accent = theme.accent || '#7e22ce';

    var report = props.report || analyze(props.portfolio, props.prices, props.transactions, { lookThrough: props.lookThrough });
    var findings = report.findings || [];
    var summary = report.summary || {};

    var META = {
      critical: { color: bad, icon: '✗', label: t.intelCritical || 'Critical' },
      important: { color: warn, icon: '!', label: t.intelImportant || 'Important' },
      optimization: { color: accent, icon: '◇', label: t.intelOptimize || 'Optimization' }
    };

    function chip(priority) {
      var m = META[priority];
      var n = summary[priority] || 0;
      return e('div', {
        key: priority,
        style: {
          display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem 0.75rem',
          borderRadius: '999px', border: '1px solid ' + border,
          background: 'rgba(255,255,255,0.02)'
        }
      },
        e('span', { 'aria-hidden': 'true', style: { color: m.color, fontWeight: 800 } }, m.icon),
        e('span', { style: { color: text, fontWeight: 700, fontSize: '0.85rem' } }, n),
        e('span', { style: { color: dim, fontSize: '0.78rem' } }, m.label));
    }

    var rows = findings.map(function (f, i) {
      var m = META[f.priority] || META.optimization;
      return e('div', {
        key: f.id || i, role: 'listitem',
        style: {
          display: 'flex', gap: '0.8rem', padding: '0.9rem 0',
          borderBottom: '1px solid ' + border
        }
      },
        e('div', {
          'aria-hidden': 'true',
          style: { fontSize: '1.05rem', fontWeight: 800, color: m.color, lineHeight: 1.3, minWidth: '1.2rem', textAlign: 'center' }
        }, m.icon),
        e('div', { style: { flex: 1, minWidth: 0 } },
          e('div', { style: { display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' } },
            e('span', {
              style: {
                fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                color: m.color
              }
            }, m.label),
            e('span', { style: { color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, f.analysis)),
          e('div', { style: { color: text, fontWeight: 700, fontSize: '0.9rem', marginTop: '0.2rem', lineHeight: 1.4 } }, f.title),
          e('div', { style: { color: dim, fontSize: '0.82rem', marginTop: '0.2rem', lineHeight: 1.5 } }, f.detail),
          f.action ? e('div', { style: { color: text, fontSize: '0.8rem', marginTop: '0.3rem' } }, '→ ' + f.action) : null));
    });

    var hasLook = !!(props.lookThrough && props.lookThrough.available);

    return e('div', { style: { padding: '1.5rem' } },
      e('h2', {
        style: { color: text, fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 0.35rem' }
      }, t.intelTitle || 'Portfolio Intelligence'),
      e('p', { style: { color: dim, fontSize: '0.88rem', margin: '0 0 1.25rem', lineHeight: 1.5, maxWidth: '60ch' } },
        t.intelSubtitle || 'Automatic detection of structural risks across ten dimensions, with concrete, data-grounded recommendations ranked by priority.'),

      e('div', { style: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1.25rem' }, role: 'list', 'aria-label': t.intelPriorities || 'Findings by priority' },
        chip('critical'), chip('important'), chip('optimization')),

      e('div', {
        style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem' }
      },
        findings.length
          ? e('div', { role: 'list', 'aria-label': t.intelFindings || 'Portfolio findings' }, rows)
          : e('div', { style: { color: dim, fontSize: '0.9rem', padding: '1rem 0', textAlign: 'center' } },
              hasLook
                ? (t.intelClean || 'No structural problems detected across the ten checks. Nice work.')
                : (t.intelNoData || 'Add holdings — and open the Health view once to load ETF look-through — to surface effective exposures.'))),

      e('div', { style: { color: dim, fontSize: '0.72rem', marginTop: '0.9rem', lineHeight: 1.5 } },
        (hasLook && summary.coverage != null
          ? __('piCoverage', 'Look-through covers {pct} of value.', { pct: I18N().pct(Math.round(summary.coverage * 100), 0) }) + ' '
          : __('piOpenHealth', 'Open the Health view once to load fund look-through for full effective-exposure analysis.') + ' ') +
        __('piLocalNote', 'All findings are computed locally from your own data — no advice is generated by a remote model.')));
  }

  var api = {
    PRIORITY_RANK: PRIORITY_RANK,
    DEFAULTS: DEFAULTS,
    STYLE_REFERENCE: STYLE_REFERENCE,
    VOLATILE_CLASSES: VOLATILE_CLASSES,
    MAG7: MAG7,
    SEMIS: SEMIS,
    LEVERAGED: LEVERAGED,
    leverageOf: leverageOf,
    analyzeFromInputs: analyzeFromInputs,
    gatherInputs: gatherInputs,
    analyze: analyze,
    toExport: toExport,
    View: View
  };
  if (typeof window !== 'undefined') window.MaerminIntelligence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
