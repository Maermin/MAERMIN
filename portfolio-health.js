/**
 * MAERMIN - Portfolio Health Score
 * ------------------------------------------------------------------
 * A single at-a-glance 0-100 score that summarises how healthy a
 * portfolio's *structure* is — independent of whether it's up or down.
 * It combines four sub-scores and turns the weak ones into concrete,
 * actionable recommendations:
 *
 *   - Diversification   (35%)  effective number of positions via HHI
 *   - Concentration     (25%)  weight of the single largest holding
 *   - Asset-class spread (20%) balance across crypto / stocks / skins / commodities
 *   - Breadth           (20%)  number of distinct holdings
 *
 * Exports window.PortfolioHealth = { computeHealth, HealthView }.
 * The view takes the same props as the other MAERMIN views, so wiring
 * it in is a single nav item + switch case.
 */
(function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  // Keys match the portfolio shape built in renderer.js (crypto/stocks/skins/commodities).
  const CLASS_LABELS = { crypto: 'Crypto', stocks: 'Stocks', skins: 'CS2 Items', commodities: 'Commodities' };

  // Localised asset-class label: prefer the app's translation keys, fall back to English.
  function classLabel(cls, t) {
    t = t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    const map = { crypto: t.crypto, stocks: t.stocks, skins: t.cs2Skins };
    if (map[cls]) return map[cls];
    const I = (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js');
    return CLASS_LABELS[cls] ? I.category(cls) : cls;
  }

  // Fill {placeholders} in a translation string.
  function fill(str, vars) {
    const I = (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js');
    return I.fill(String(str), vars);
  }

  function priceOf(prices, pos) {
    const s = pos.symbol || pos.name || '';
    return prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || 0;
  }

  // Flatten the { crypto:[], stocks:[], cs2:[] } structure into valued positions.
  function flatten(portfolio, prices) {
    const out = [];
    Object.keys(portfolio || {}).forEach((cls) => {
      (portfolio[cls] || []).forEach((pos) => {
        const value = (pos.amount || 0) * priceOf(prices, pos);
        const cost = (pos.amount || 0) * (pos.purchasePrice || 0);
        if (value > 0) out.push({ symbol: pos.symbol || pos.name || '?', cls, value, cost });
      });
    });
    return out;
  }

  // Coarse per-asset-class riskiness (0..1, higher = riskier) for the structural
  // fallback used when there isn't yet enough price history to measure volatility.
  const CLASS_RISK = { crypto: 0.85, skins: 0.80, commodities: 0.55, stocks: 0.45 };
  // Liquidity classification of holdings and manual net-worth accounts.
  const LIQUID_CLASSES = { crypto: true, stocks: true, commodities: true, skins: false };
  const ACCT_LIQUID = { cash: true, checking: true, crypto_wallet: true };
  const ACCT_ILLIQUID = { property: true, other_asset: true };

  // Risk sub-score (higher = healthier / lower risk). Reuses the existing
  // risk-analytics engine exactly as RiskAnalyticsViewV2 does; falls back to a
  // structural class-mix proxy when price history is too thin to measure
  // volatility (detected via volatility === 0). No second risk engine.
  function computeRiskHealth(portfolio, byClass, totalValue, priceHistory) {
    if (typeof window !== 'undefined' && typeof window.calculatePortfolioRiskMetrics === 'function') {
      try {
        const converted = {};
        if (priceHistory && typeof priceHistory === 'object') {
          Object.keys(priceHistory).forEach((sym) => {
            const h = priceHistory[sym];
            if (Array.isArray(h) && h.length > 0) {
              converted[sym] = (typeof h[0] === 'object' && h[0].price !== undefined) ? h.map((x) => x.price) : h;
            }
          });
        }
        const m = window.calculatePortfolioRiskMetrics(portfolio, converted, totalValue);
        if (m && m.volatility > 0) {
          return { score: Math.round(clamp(100 - m.riskScore, 0, 100)), available: true, source: 'engine', level: m.riskLevel };
        }
      } catch (e) { /* fall through to structural proxy */ }
    }
    let riskiness = 0;
    Object.keys(byClass).forEach((cls) => {
      riskiness += (CLASS_RISK[cls] != null ? CLASS_RISK[cls] : 0.6) * (byClass[cls] / totalValue);
    });
    return { score: Math.round(clamp((1 - riskiness) * 100, 0, 100)), available: true, source: 'structural' };
  }

  // Liquidity sub-score = liquid share of total assets (holdings + cash accounts).
  function computeLiquidityHealth(byClass, accounts) {
    let liquid = 0, illiquid = 0;
    Object.keys(byClass).forEach((cls) => { if (LIQUID_CLASSES[cls]) liquid += byClass[cls]; else illiquid += byClass[cls]; });
    if (!accounts && typeof window !== 'undefined' && window.MaerminMetrics) {
      try { accounts = window.MaerminMetrics.loadAccounts(); } catch (e) { accounts = []; }
    }
    (accounts || []).forEach((a) => {
      const v = parseFloat(a.value || 0) || 0;
      if (ACCT_LIQUID[a.type]) liquid += v;
      else if (ACCT_ILLIQUID[a.type]) illiquid += v;
    });
    const denom = liquid + illiquid;
    if (denom <= 0) return { score: 0, available: false };
    return { score: Math.round((liquid / denom) * 100), available: true, liquid, illiquid };
  }

  // Tax-efficiency sub-score from holding periods (German private-sale logic:
  // crypto / skins / commodities held > 1 year are tax-free; equities benefit
  // only mildly from longer holding). Value-weighted over the positions we can
  // date from the transaction history. Reuses transactions — no tax engine copy.
  function computeTaxHealth(portfolio, prices, transactions) {
    if (!Array.isArray(transactions) || transactions.length === 0) return { score: 0, available: false };
    const now = Date.now();
    const posAge = {};
    transactions.forEach((tx) => {
      if (tx.type !== 'buy') return;
      const qty = parseFloat(tx.quantity) || 0;
      const d = tx.date ? new Date(tx.date).getTime() : NaN;
      if (!(qty > 0) || isNaN(d)) return;
      const key = (tx.category || 'crypto') + '-' + (tx.symbol || '').toLowerCase();
      if (!posAge[key]) posAge[key] = { qty: 0, qtyAge: 0 };
      posAge[key].qty += qty;
      posAge[key].qtyAge += qty * ((now - d) / 86400000);
    });
    const flat = flatten(portfolio, prices);
    let totalVal = 0, datedVal = 0, taxVal = 0;
    flat.forEach((p) => {
      totalVal += p.value;
      const a = posAge[p.cls + '-' + (p.symbol || '').toLowerCase()];
      if (a && a.qty > 0) {
        datedVal += p.value;
        const avgAge = a.qtyAge / a.qty;
        const s = (p.cls === 'stocks')
          ? clamp(40 + (avgAge / 365) * 20, 0, 80)
          : (avgAge >= 365 ? 100 : clamp((avgAge / 365) * 100, 0, 100));
        taxVal += p.value * s;
      }
    });
    if (datedVal <= 0) return { score: 0, available: false };
    return { score: Math.round(taxVal / datedVal), available: true, coverage: totalVal > 0 ? (datedVal / totalVal) * 100 : 0 };
  }

  // extras: { priceHistory, transactions, accounts } — all optional; each sub-score
  // degrades gracefully and the total is re-normalised over what's available.
  function computeHealth(portfolio, prices, t, extras) {
    t = t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    extras = extras || {};
    const positions = flatten(portfolio, prices);
    const totalValue = positions.reduce((s, p) => s + p.value, 0);
    const totalCost = positions.reduce((s, p) => s + p.cost, 0);

    if (positions.length === 0 || totalValue <= 0) {
      return { empty: true, score: 0, grade: '—', positions: [], totalValue: 0 };
    }

    // Position weights & concentration (Herfindahl-Hirschman Index).
    const weights = positions.map((p) => p.value / totalValue);
    const hhi = weights.reduce((s, w) => s + w * w, 0);
    const effectiveN = 1 / hhi;                       // 1 = single holding, higher = more spread
    const maxWeight = Math.max.apply(null, weights);

    // Asset-class spread.
    const byClass = {};
    positions.forEach((p) => { byClass[p.cls] = (byClass[p.cls] || 0) + p.value; });
    const classWeights = Object.values(byClass).map((v) => v / totalValue);
    const classHhi = classWeights.reduce((s, w) => s + w * w, 0);
    const effectiveClasses = 1 / classHhi;

    // ── V7 sub-score 1: Diversification — folds in spread, concentration,
    //    asset-class balance and breadth (still surfaced as metrics below).
    const fSpread = clamp(((effectiveN - 1) / 9) * 100, 0, 100);
    const fConcentration = clamp(((0.5 - maxWeight) / 0.4) * 100, 0, 100);
    const fAssetClass = clamp(35 + (effectiveClasses - 1) * 32.5, 0, 100);
    const fBreadth = clamp((positions.length / 10) * 100, 0, 100);
    const diversification = Math.round(0.40 * fSpread + 0.30 * fConcentration + 0.15 * fAssetClass + 0.15 * fBreadth);

    // ── V7 sub-scores 2-4: Risk, Liquidity, Tax — reuse existing engines/data.
    const riskDetail = computeRiskHealth(portfolio, byClass, totalValue, extras.priceHistory);
    const liquidityDetail = computeLiquidityHealth(byClass, extras.accounts);
    const taxDetail = computeTaxHealth(portfolio, prices, extras.transactions);

    // Weighted total, re-normalised over the sub-scores we can actually compute.
    // `view` is the existing analysis view each sub-score drills into (V7: click
    // opens existing views, no new windows).
    const subMeta = [
      { key: 'diversification', value: diversification,       weight: 0.40, available: true,                    view: 'analytics' },
      { key: 'risk',            value: riskDetail.score,      weight: 0.25, available: riskDetail.available,     view: 'analytics' },
      { key: 'liquidity',       value: liquidityDetail.score, weight: 0.20, available: liquidityDetail.available, view: 'net-worth' },
      { key: 'tax',             value: taxDetail.score,       weight: 0.15, available: taxDetail.available,      view: 'tax' },
    ];
    const availWeight = subMeta.filter((s) => s.available).reduce((a, s) => a + s.weight, 0) || 1;
    const score = Math.round(subMeta.filter((s) => s.available).reduce((a, s) => a + s.value * (s.weight / availWeight), 0));
    const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';

    // Top holdings by weight (for the bars in the view).
    const top = positions
      .map((p, i) => ({ symbol: p.symbol, cls: p.cls, value: p.value, weight: weights[i] }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6);

    // Actionable recommendations from whatever scored weakest (localised via t).
    const recs = [];
    const biggest = top[0];
    if (maxWeight > 0.3) {
      recs.push(fill(t.healthRecConcentration ||
        'Your largest position ({sym}) is {pct}% of the portfolio — consider trimming it to reduce concentration risk.',
        { sym: biggest.symbol, pct: (maxWeight * 100).toFixed(0) }));
    }
    if (effectiveN < 5) {
      recs.push(fill(t.healthRecDiversification ||
        'You hold only ~{n} effective positions. Adding more uncorrelated holdings would improve diversification.',
        { n: effectiveN.toFixed(1) }));
    }
    if (effectiveClasses < 1.3) {
      recs.push(fill(t.healthRecOneClass ||
        'Almost everything sits in {cls}. Spreading across asset classes lowers single-market risk.',
        { cls: classLabel(Object.keys(byClass)[0], t) }));
    } else if (effectiveClasses < 1.8 && Object.keys(byClass).length < 3) {
      recs.push(t.healthRecTwoClass ||
        'Two asset classes covered — a small allocation to a third would broaden your base.');
    }
    if (riskDetail.score < 45) {
      recs.push(t.healthRecRisk ||
        'Risk is elevated — a larger allocation to lower-volatility assets would steady the portfolio.');
    }
    if (liquidityDetail.available && liquidityDetail.score < 40) {
      recs.push(t.healthRecLiquidity ||
        'A large share sits in illiquid holdings — keep enough liquid assets for flexibility.');
    }
    if (taxDetail.available && taxDetail.score < 40) {
      recs.push(t.healthRecTax ||
        'Many positions are under the 1-year mark — holding longer can cut the tax due on a sale.');
    }
    if (positions.length < 5) {
      recs.push(fill(t.healthRecBreadth ||
        'Only {n} {n:holding|holdings} — a broader set smooths day-to-day volatility.',
        { n: positions.length }));
    }
    if (recs.length === 0) {
      recs.push(t.healthRecWellStructured ||
        'Well structured — keep an eye on your largest position as it grows.');
    }

    return {
      empty: false,
      score,
      grade,
      totalValue,
      totalCost,
      unrealizedPct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
      positionCount: positions.length,
      effectiveN,
      maxWeight,
      effectiveClasses,
      classCount: Object.keys(byClass).length,
      subScores: {
        diversification: diversification,
        risk: riskDetail.score,
        liquidity: liquidityDetail.score,
        tax: taxDetail.score,
      },
      subMeta,
      riskDetail,
      liquidityDetail,
      taxDetail,
      byClass,
      top,
      recommendations: recs,
    };
  }

  // ---- React view ----------------------------------------------------------
  function HealthView(props) {
    const portfolio = props.portfolio || {};
    const prices = props.prices || {};
    const formatPrice = props.formatPrice || ((v) => (v || 0).toFixed(2));
    const sym = props.getCurrencySymbol ? props.getCurrencySymbol() : '';
    const t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    const priceHistory = props.priceHistory || {};
    const transactions = props.transactions || [];
    const setActiveView = props.setActiveView;
    const h = React.useMemo(
      () => computeHealth(portfolio, prices, t, { priceHistory, transactions }),
      [portfolio, prices, t, priceHistory, transactions]
    );
    const e = React.createElement;

    // R4.2: the score as the answer (ring + grade + one sentence), sub-scores
    // as meters that open their analysis, the figures as Stat tiles.
    const UIC = window.MaerminComponents;
    const I = window.MaerminI18n;
    const toneOf = (s) => s >= 70 ? 'gain' : s >= 40 ? 'warning' : 'loss';

    if (h.empty) {
      return e('div', { className: 'ui-view', 'data-testid': 'health-view' },
        e(UIC.Card, { className: 'ui-card--pad' },
          e('p', { className: 'ui-muted' }, t.healthEmpty || 'Add some positions and refresh prices to see your portfolio health score.')));
    }

    const tone = toneOf(h.score);
    const meta = (k) => (h.subMeta || []).find((s) => s.key === k) || {};

    // A sub-score row. Clickable when it maps to an existing analysis view
    // (V7: drill into existing views, never open a new window).
    const bar = (label, value, opts) => {
      opts = opts || {};
      const available = opts.available !== false;
      const clickable = !!(opts.view && setActiveView);
      const inner = [
        e('span', { key: 'l', className: 'ui-meters__label' },
          e('span', null, label, clickable ? e('span', { 'aria-hidden': 'true' }, ' ›') : null),
          e('b', { className: 'num' }, available ? (value + ' / 100') : (t.healthNotAvailable || 'n/a'))),
        e('span', { key: 'm', className: 'ui-meter', 'aria-hidden': 'true' },
          e('span', { className: 'ui-meter__fill', 'data-tone': toneOf(value), style: { width: (available ? value : 0) + '%' } }))
      ];
      return e('li', { key: label },
        clickable ? e('button', { type: 'button', className: 'ui-meters__btn', title: t.healthOpenView || 'Open analysis', onClick: () => setActiveView(opts.view) }, inner) : inner);
    };

    const metric = (label, value) => e(UIC.Stat, { key: label, className: 'ui-tile', label, value });
    const verdict = window.MaerminVerdicts ? window.MaerminVerdicts.health(h.score) : null;

    return e('div', { className: 'ui-view', 'data-testid': 'health-view' },
      e('p', { className: 'ui-view__lead' },
        t.healthSubtitle || 'A structural check of diversification and concentration — independent of market direction.'),

      // Score hero + sub-score bars
      e(UIC.Card, { variant: 'hero', 'data-testid': 'health-score' },
        e('div', { className: 'ui-health' },
          e('div', { className: 'ui-health__score' },
            e('div', { className: 'ui-ring', 'data-tone': tone, style: { background: `conic-gradient(var(--${tone}) ${h.score * 3.6}deg, var(--surface-2) 0deg)` } },
              e('div', { className: 'ui-ring__inner' },
                e('b', { className: ['num', 'tone-' + tone].join(' ') }, h.score),
                e('span', null, t.healthOutOf100 || 'out of 100'))),
            e(UIC.Badge, { tone }, (t.healthGrade || 'Grade') + ' ' + h.grade)),
          e('ul', { className: ['ui-meters', 'ui-health__bars'].join(' ') },
            bar(t.healthDiversification || 'Diversification', h.subScores.diversification, meta('diversification')),
            bar(t.healthRiskCat || 'Risk', h.subScores.risk, meta('risk')),
            bar(t.healthLiquidityCat || 'Liquidity', h.subScores.liquidity, meta('liquidity')),
            bar(t.healthTaxCat || 'Tax efficiency', h.subScores.tax, meta('tax')))),
        // P5-1.6: the score in one plain sentence (rules in verdicts.js).
        verdict ? e('p', { 'data-testid': 'verdict-health', 'data-level': verdict.level, className: 'ui-health__verdict' },
          e('span', { className: 'ui-verdict' }, verdict.text),
          e('span', { className: 'ui-note' }, ' ' + window.MaerminVerdicts.disclaimer())) : null),

      // Key metrics
      e('div', { className: 'ui-tiles', 'data-testid': 'health-metrics' },
        metric(t.healthHoldings || 'Holdings', String(h.positionCount)),
        metric(t.healthEffectivePositions || 'Effective positions', I.num(h.effectiveN, 1)),
        metric(t.healthLargestPosition || 'Largest position', I.pct(h.maxWeight * 100, 0)),
        metric(t.healthAssetClasses || 'Asset classes', String(h.classCount)),
        e(UIC.Stat, { key: 'u', className: 'ui-tile', label: t.healthUnrealized || 'Unrealised', value: I.pct(h.unrealizedPct, 1, true), tone: UIC.toneOf(h.unrealizedPct) })),

      e('div', { className: 'ui-grid-2' },
        // Recommendations
        e(UIC.Card, { title: t.recommendations || 'Recommendations', headingLevel: 'h3', 'data-testid': 'health-recs' },
          e('ul', { className: 'ui-findings' }, h.recommendations.map((r, i) =>
            e('li', { key: i, className: 'ui-finding' }, e('span', { 'aria-hidden': 'true', className: 'ui-finding__mark' }, '→'), e('p', null, r))))),

        // Top holdings by weight
        e(UIC.Card, { title: t.healthLargestHoldings || 'Largest holdings', headingLevel: 'h3', 'data-testid': 'health-top' },
          e('ul', { className: 'ui-meters' }, h.top.map((p) =>
            e('li', { key: p.symbol + p.cls },
              e('span', { className: 'ui-meters__label' },
                e('span', null, e('b', null, p.symbol), ' ', e('span', { className: 'ui-muted' }, classLabel(p.cls, t))),
                e('span', { className: 'num' }, `${formatPrice(p.value)} ${sym} · ${I.pct(p.weight * 100, 1)}`)),
              e('span', { className: 'ui-meter', 'aria-hidden': 'true' },
                e('span', { className: 'ui-meter__fill', 'data-tone': p.weight > 0.3 ? 'warning' : 'accent', style: { width: (p.weight * 100) + '%' } }))))))));
  }

  if (typeof window !== 'undefined') {
    window.PortfolioHealth = { computeHealth, HealthView };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeHealth, HealthView };
  }
})();
