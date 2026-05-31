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
    t = t || {};
    const map = { crypto: t.crypto, stocks: t.stocks, skins: t.cs2Skins, commodities: t.commodities };
    return map[cls] || CLASS_LABELS[cls] || cls;
  }

  // Fill {placeholders} in a translation string.
  function fill(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));
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

  function computeHealth(portfolio, prices, t) {
    t = t || {};
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

    // Sub-scores (0-100), calibrated for retail portfolios.
    const sDiversification = clamp(((effectiveN - 1) / 9) * 100, 0, 100);     // ~10 effective positions = top
    const sConcentration = clamp(((0.5 - maxWeight) / 0.4) * 100, 0, 100);    // <=10% largest = 100, >=50% = 0
    const sAssetClass = clamp(35 + (effectiveClasses - 1) * 32.5, 0, 100);    // 1 class -> 35, 2 -> ~68, 3 -> 100
    const sBreadth = clamp((positions.length / 10) * 100, 0, 100);            // 10 holdings = top

    const score = Math.round(
      0.35 * sDiversification + 0.25 * sConcentration + 0.20 * sAssetClass + 0.20 * sBreadth
    );

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
    if (positions.length < 5) {
      recs.push(fill(t.healthRecBreadth ||
        'Only {n} holding(s) — a broader set smooths day-to-day volatility.',
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
        diversification: Math.round(sDiversification),
        concentration: Math.round(sConcentration),
        assetClass: Math.round(sAssetClass),
        breadth: Math.round(sBreadth),
      },
      byClass,
      top,
      recommendations: recs,
    };
  }

  function scoreColor(score) {
    if (score >= 85) return '#22c55e';
    if (score >= 70) return '#84cc16';
    if (score >= 55) return '#f59e0b';
    if (score >= 40) return '#f97316';
    return '#ef4444';
  }

  // ---- React view ----------------------------------------------------------
  function HealthView(props) {
    const portfolio = props.portfolio || {};
    const prices = props.prices || {};
    const theme = props.theme || {};
    const formatPrice = props.formatPrice || ((v) => (v || 0).toFixed(2));
    const sym = props.getCurrencySymbol ? props.getCurrencySymbol() : '';
    const t = props.t || {};
    const h = React.useMemo(() => computeHealth(portfolio, prices, t), [portfolio, prices, t]);
    const e = React.createElement;

    const cardStyle = {
      background: theme.card || 'rgba(255,255,255,0.05)',
      border: `1px solid ${theme.cardBorder || 'rgba(255,255,255,0.1)'}`,
      borderRadius: '14px', padding: '1.5rem', marginBottom: '1rem',
    };

    if (h.empty) {
      return e('div', { style: { padding: '1rem' } },
        e('h2', { style: { color: theme.text, marginBottom: '0.5rem' } }, t.healthTitle || 'Portfolio Health'),
        e('div', { style: cardStyle },
          e('p', { style: { color: theme.textSecondary } },
            t.healthEmpty || 'Add some positions and refresh prices to see your portfolio health score.'))
      );
    }

    const col = scoreColor(h.score);

    const bar = (label, value) => e('div', { key: label, style: { marginBottom: '0.85rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem', fontSize: '0.8rem', color: theme.textSecondary } },
        e('span', null, label),
        e('span', { style: { color: theme.text, fontWeight: 600 } }, value + ' / 100')),
      e('div', { style: { height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' } },
        e('div', { style: { height: '100%', width: value + '%', background: scoreColor(value), borderRadius: '4px', transition: 'width 0.4s ease' } }))
    );

    const metric = (label, value) => e('div', { key: label, style: { textAlign: 'center', padding: '0.85rem', background: 'rgba(0,0,0,0.18)', borderRadius: '10px' } },
      e('div', { style: { fontSize: '1.25rem', fontWeight: 700, color: theme.text } }, value),
      e('div', { style: { fontSize: '0.68rem', color: theme.textSecondary, marginTop: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, label)
    );

    return e('div', { style: { padding: '1rem' } },
      e('h2', { style: { color: theme.text, marginBottom: '0.25rem', fontSize: '1.4rem', fontWeight: 700 } }, t.healthTitle || 'Portfolio Health'),
      e('p', { style: { color: theme.textSecondary, marginBottom: '1.25rem', fontSize: '0.85rem' } },
        t.healthSubtitle || 'A structural check of diversification and concentration — independent of market direction.'),

      // Score hero + sub-score bars
      e('div', { style: { ...cardStyle, display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' } },
        e('div', { style: { textAlign: 'center', minWidth: '160px', flex: '0 0 auto' } },
          e('div', {
            style: {
              width: '130px', height: '130px', borderRadius: '50%', margin: '0 auto',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: `conic-gradient(${col} ${h.score * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
            }
          },
            e('div', {
              style: {
                width: '104px', height: '104px', borderRadius: '50%', background: theme.bg || '#0f1219',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }
            },
              e('div', { style: { fontSize: '2.2rem', fontWeight: 800, color: col, lineHeight: 1 } }, h.score),
              e('div', { style: { fontSize: '0.7rem', color: theme.textSecondary, marginTop: '2px' } }, t.healthOutOf100 || 'out of 100'))),
          e('div', { style: { marginTop: '0.6rem', display: 'inline-block', padding: '0.2rem 0.9rem', borderRadius: '9999px', background: `${col}22`, color: col, fontWeight: 700, fontSize: '0.95rem' } },
            (t.healthGrade || 'Grade') + ' ' + h.grade)),
        e('div', { style: { flex: 1, minWidth: '240px' } },
          bar(t.healthDiversification || 'Diversification', h.subScores.diversification),
          bar(t.healthConcentration || 'Concentration', h.subScores.concentration),
          bar(t.healthAssetBalance || 'Asset-class balance', h.subScores.assetClass),
          bar(t.healthBreadth || 'Breadth', h.subScores.breadth))
      ),

      // Key metrics
      e('div', { style: { ...cardStyle } },
        e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' } },
          metric(t.healthHoldings || 'Holdings', String(h.positionCount)),
          metric(t.healthEffectivePositions || 'Effective positions', h.effectiveN.toFixed(1)),
          metric(t.healthLargestPosition || 'Largest position', (h.maxWeight * 100).toFixed(0) + '%'),
          metric(t.healthAssetClasses || 'Asset classes', String(h.classCount)),
          metric(t.healthUnrealized || 'Unrealized', (h.unrealizedPct >= 0 ? '+' : '') + h.unrealizedPct.toFixed(1) + '%'))
      ),

      // Recommendations
      e('div', { style: cardStyle },
        e('h3', { style: { color: theme.text, fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' } }, t.recommendations || 'Recommendations'),
        h.recommendations.map((r, i) =>
          e('div', { key: i, style: { display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.5rem 0', color: theme.textSecondary, fontSize: '0.875rem', borderBottom: i < h.recommendations.length - 1 ? `1px solid ${theme.cardBorder || 'rgba(255,255,255,0.08)'}` : 'none' } },
            e('span', { style: { color: col, fontWeight: 700 } }, '→'),
            e('span', null, r)))
      ),

      // Top holdings by weight
      e('div', { style: cardStyle },
        e('h3', { style: { color: theme.text, fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' } }, t.healthLargestHoldings || 'Largest holdings'),
        h.top.map((p) =>
          e('div', { key: p.symbol + p.cls, style: { marginBottom: '0.7rem' } },
            e('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.82rem' } },
              e('span', { style: { color: theme.text, fontWeight: 600 } }, p.symbol,
                e('span', { style: { color: theme.textSecondary, fontWeight: 400, marginLeft: '0.4rem', fontSize: '0.72rem' } }, classLabel(p.cls, t))),
              e('span', { style: { color: theme.textSecondary } }, `${formatPrice(p.value)} ${sym} · ${(p.weight * 100).toFixed(1)}%`)),
            e('div', { style: { height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' } },
              e('div', { style: { height: '100%', width: (p.weight * 100) + '%', background: p.weight > 0.3 ? '#f59e0b' : (theme.accent || '#8b5cf6'), borderRadius: '3px' } }))))
      )
    );
  }

  if (typeof window !== 'undefined') {
    window.PortfolioHealth = { computeHealth, HealthView };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { computeHealth, HealthView };
  }
})();
