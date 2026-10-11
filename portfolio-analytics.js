// ============================================================================
// MAERMIN — Portfolio Analytics  (window.MaerminAnalytics)
// ----------------------------------------------------------------------------
// Pure, dependency-free quant for three roadmap epics. It adds the SPECIFIC
// metrics that weren't already in the codebase and is designed to be fed return
// series the existing data layer (Yahoo via the worker) already fetches — no new
// data engine, no duplication of MonteCarloEngine/RiskAnalytics shapes.
//
//   Epic 5 Benchmarks : Alpha, Beta, Tracking Error, Information Ratio + presets
//                       (MSCI World, FTSE All-World, S&P 500, Nasdaq 100, custom).
//   Epic 6 Simulator  : future value, FIRE projection, withdrawal simulation.
//                       (Monte Carlo lives in monte-carlo-engine.js.)
//   Epic 7 Risk       : max drawdown, rolling returns, rolling volatility,
//                       Fama-French OLS exposure (the correlation matrix is
//                       correlation-engine.js).
//
// All functions are pure and unit-tested in Node. UI stays in the views (these
// numbers fold into the existing Returns / Monte-Carlo / Risk views).
// ============================================================================
(function () {
  'use strict';

  // ---- basic stats ---------------------------------------------------------
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
  function variancePop(a) { var m = mean(a); return a.length ? mean(a.map(function (x) { return (x - m) * (x - m); })) : 0; }
  function stdSample(a) {
    if (a.length < 2) return 0;
    var m = mean(a), s = a.reduce(function (acc, x) { return acc + (x - m) * (x - m); }, 0);
    return Math.sqrt(s / (a.length - 1));
  }
  function covariancePop(a, b) {
    var n = Math.min(a.length, b.length); if (!n) return 0;
    var ma = mean(a.slice(0, n)), mb = mean(b.slice(0, n)), s = 0;
    for (var i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
    return s / n;
  }
  // Convert a price/value series to simple period returns.
  function toReturns(series) {
    var r = [];
    for (var i = 1; i < series.length; i++) {
      var prev = series[i - 1];
      if (prev) r.push(series[i] / prev - 1);
    }
    return r;
  }

  // ---- Epic 5: benchmark analytics ----------------------------------------
  var BENCHMARKS = [
    { key: 'msci_world', label: 'MSCI World', proxy: 'URTH' },
    { key: 'ftse_all_world', label: 'FTSE All-World', proxy: 'VT' },
    { key: 'sp500', label: 'S&P 500', proxy: '^GSPC' },
    { key: 'nasdaq100', label: 'Nasdaq 100', proxy: '^NDX' }
  ];

  // portfolioReturns / benchmarkReturns: same-length period-return arrays.
  // rf: per-period risk-free (default 0). periodsPerYear: annualisation factor
  // (252 daily, 12 monthly, 52 weekly). Returns annualised alpha + the ratios.
  function benchmarkStats(portfolioReturns, benchmarkReturns, opts) {
    opts = opts || {};
    var rf = opts.rf || 0;
    var ppy = opts.periodsPerYear || 252;
    var n = Math.min(portfolioReturns.length, benchmarkReturns.length);
    if (n < 2) return { available: false };
    var p = portfolioReturns.slice(0, n), b = benchmarkReturns.slice(0, n);

    var beta = covariancePop(p, b) / (variancePop(b) || 1e-12);
    // CAPM alpha (per period) then annualised.
    var alphaPeriod = (mean(p) - rf) - beta * (mean(b) - rf);
    var active = p.map(function (x, i) { return x - b[i]; });
    var tePeriod = stdSample(active);
    var irPeriod = tePeriod > 0 ? mean(active) / tePeriod : 0;

    // Correlation / R² of the fit.
    var corr = covariancePop(p, b) / (Math.sqrt(variancePop(p) * variancePop(b)) || 1e-12);

    return {
      available: true,
      beta: beta,
      alpha: alphaPeriod * ppy,                 // annualised
      alphaPeriod: alphaPeriod,
      trackingError: tePeriod * Math.sqrt(ppy), // annualised
      informationRatio: irPeriod * Math.sqrt(ppy),
      correlation: corr,
      rSquared: corr * corr,
      periods: n
    };
  }

  function cagr(startValue, endValue, years) {
    if (startValue <= 0 || years <= 0) return 0;
    return Math.pow(endValue / startValue, 1 / years) - 1;
  }
  function annualizedVol(returns, periodsPerYear) {
    return stdSample(returns) * Math.sqrt(periodsPerYear || 252);
  }

  // ---- Epic 7: risk analytics ---------------------------------------------
  // Max drawdown from a value/price series. Returns the worst peak-to-trough.
  function maxDrawdown(series) {
    if (!series || series.length < 2) return { maxDrawdown: 0, peakIndex: 0, troughIndex: 0, peak: 0, trough: 0 };
    var peak = series[0], peakIdx = 0, maxDD = 0, ddPeakIdx = 0, ddTroughIdx = 0, peakAtMax = series[0], troughAtMax = series[0];
    for (var i = 1; i < series.length; i++) {
      if (series[i] > peak) { peak = series[i]; peakIdx = i; }
      var dd = peak > 0 ? (series[i] - peak) / peak : 0;
      if (dd < maxDD) { maxDD = dd; ddPeakIdx = peakIdx; ddTroughIdx = i; peakAtMax = peak; troughAtMax = series[i]; }
    }
    return { maxDrawdown: maxDD, peakIndex: ddPeakIdx, troughIndex: ddTroughIdx, peak: peakAtMax, trough: troughAtMax };
  }

  // Rolling cumulative return over a window of period-returns.
  function rollingReturns(returns, window) {
    var out = [];
    for (var i = window; i <= returns.length; i++) {
      var prod = 1;
      for (var j = i - window; j < i; j++) prod *= (1 + returns[j]);
      out.push(prod - 1);
    }
    return out;
  }
  // Rolling annualised volatility over a window of period-returns.
  function rollingVolatility(returns, window, periodsPerYear) {
    var out = [];
    for (var i = window; i <= returns.length; i++) {
      out.push(annualizedVol(returns.slice(i - window, i), periodsPerYear || 252));
    }
    return out;
  }

  // ---- small linear algebra for factor regression -------------------------
  function matInverse(M) {
    var n = M.length, A = M.map(function (r, i) {
      return r.concat(Array.apply(null, Array(n)).map(function (_, j) { return i === j ? 1 : 0; }));
    });
    for (var col = 0; col < n; col++) {
      // pivot
      var piv = col;
      for (var r2 = col + 1; r2 < n; r2++) if (Math.abs(A[r2][col]) > Math.abs(A[piv][col])) piv = r2;
      if (Math.abs(A[piv][col]) < 1e-12) return null; // singular
      var tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
      var pv = A[col][col];
      for (var k = 0; k < 2 * n; k++) A[col][k] /= pv;
      for (var r3 = 0; r3 < n; r3++) {
        if (r3 === col) continue;
        var f = A[r3][col];
        for (var k2 = 0; k2 < 2 * n; k2++) A[r3][k2] -= f * A[col][k2];
      }
    }
    return A.map(function (r) { return r.slice(n); });
  }
  // Multivariate OLS: y = X·β. X rows are observations (include a 1-column for
  // intercept). Returns β via the normal equations (X'X)⁻¹X'y.
  function olsBeta(X, y) {
    var n = X.length, p = X[0].length;
    var XtX = [], Xty = [];
    for (var i = 0; i < p; i++) {
      XtX.push(new Array(p).fill(0)); Xty.push(0);
      for (var j = 0; j < p; j++) for (var r = 0; r < n; r++) XtX[i][j] += X[r][i] * X[r][j];
      for (var r2 = 0; r2 < n; r2++) Xty[i] += X[r2][i] * y[r2];
    }
    var inv = matInverse(XtX);
    if (!inv) return null;
    var beta = new Array(p).fill(0);
    for (var a = 0; a < p; a++) for (var b = 0; b < p; b++) beta[a] += inv[a][b] * Xty[b];
    return beta;
  }
  // Fama-French exposure. assetExcessReturns: rp-rf per period. factors: array of
  // factor-return arrays (e.g. [MKT, SMB, HML]). Returns {alpha, betas:{...}}.
  function factorExposure(assetExcessReturns, factors, factorNames) {
    var n = assetExcessReturns.length;
    if (!n || !factors || !factors.length) return { available: false };
    var X = [];
    for (var t = 0; t < n; t++) {
      var row = [1];
      for (var f = 0; f < factors.length; f++) row.push(factors[f][t]);
      X.push(row);
    }
    var beta = olsBeta(X, assetExcessReturns);
    if (!beta) return { available: false };
    var betas = {};
    (factorNames || factors.map(function (_, i) { return 'F' + (i + 1); })).forEach(function (nm, i) {
      betas[nm] = beta[i + 1];
    });
    return { available: true, alpha: beta[0], betas: betas };
  }

  // ---- Epic 6: simulator ---------------------------------------------------
  // Deterministic future value with monthly contributions (annuity).
  function futureValue(principal, monthlyContribution, annualReturn, years) {
    var r = annualReturn / 12, n = years * 12;
    var fvPrincipal = principal * Math.pow(1 + r, n);
    var fvContrib = r === 0 ? monthlyContribution * n
      : monthlyContribution * ((Math.pow(1 + r, n) - 1) / r);
    return fvPrincipal + fvContrib;
  }

  // FIRE projection: years until portfolio reaches the FIRE number, with growth.
  function fireProjection(opts) {
    opts = opts || {};
    var current = opts.currentValue || 0;
    var monthly = opts.monthlyContribution || 0;
    var annualReturn = opts.annualReturn != null ? opts.annualReturn : 0.05; // real return
    var annualExpenses = opts.annualExpenses || 0;
    var wr = (opts.withdrawalRate || 4) / 100;
    var fireNumber = wr > 0 ? annualExpenses / wr : 0;
    if (fireNumber <= 0) return { configured: false, fireNumber: 0 };
    var r = annualReturn / 12;
    var bal = current, months = 0, MAX = 100 * 12;
    while (bal < fireNumber && months < MAX) { bal = bal * (1 + r) + monthly; months++; }
    return {
      configured: true,
      fireNumber: fireNumber,
      reached: bal >= fireNumber,
      yearsToFire: months >= MAX ? null : Math.round((months / 12) * 10) / 10,
      projectedValueAtFire: bal,
      currentProgress: Math.min(100, (current / fireNumber) * 100)
    };
  }

  // Withdrawal simulation: year-by-year balance with inflation-adjusted spend.
  function withdrawalSimulation(opts) {
    opts = opts || {};
    var bal = opts.startValue || 0;
    var spend = opts.annualWithdrawal || 0;
    var ret = opts.annualReturn != null ? opts.annualReturn : 0.05;
    var infl = opts.inflation != null ? opts.inflation : 0.02;
    var years = opts.years || 30;
    var path = [], depletedYear = null;
    for (var y = 1; y <= years; y++) {
      bal = bal * (1 + ret) - spend;
      if (bal <= 0 && depletedYear === null) { depletedYear = y; bal = 0; }
      path.push(Math.round(bal));
      spend = spend * (1 + infl);
    }
    return { path: path, depletedYear: depletedYear, survives: depletedYear === null, endingBalance: path[path.length - 1] };
  }

  var api = {
    // stats
    mean: mean, stdSample: stdSample, toReturns: toReturns,
    // benchmarks (Epic 5)
    BENCHMARKS: BENCHMARKS, benchmarkStats: benchmarkStats, cagr: cagr,
    annualizedVol: annualizedVol,
    // risk (Epic 7)
    maxDrawdown: maxDrawdown, rollingReturns: rollingReturns, rollingVolatility: rollingVolatility,
    factorExposure: factorExposure, olsBeta: olsBeta,
    // simulator (Epic 6)
    futureValue: futureValue, fireProjection: fireProjection,
    withdrawalSimulation: withdrawalSimulation
  };
  if (typeof window !== 'undefined') window.MaerminAnalytics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
