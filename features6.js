// ============================================================================
// MAERMIN v8.3 — Real Historical Portfolio Chart
//
// Fetches TRUE historical price data per asset:
//   Crypto   → CoinGecko /market_chart (free, no key)
//   Stocks   → Alpha Vantage TIME_SERIES_DAILY (free key)
//   Commodities → Alpha Vantage commodity/forex endpoints
//
// Builds portfolio value curve: sum(amount_i × price_i(t)) for each t
// Period selector: 1H · 1D · 1W · 1M · 1Y · 3Y · 5Y · Max
// ============================================================================
(function () {
'use strict';

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const PERIODS = [
  { id: '1H',  label: '1H',  days: 1/24,  interval: 'minutely', cgDays: 1    },
  { id: '1D',  label: '1D',  days: 1,     interval: 'hourly',   cgDays: 1    },
  { id: '1W',  label: '1W',  days: 7,     interval: 'daily',    cgDays: 7    },
  { id: '1M',  label: '1M',  days: 30,    interval: 'daily',    cgDays: 30   },
  { id: '1Y',  label: '1Y',  days: 365,   interval: 'daily',    cgDays: 365  },
  { id: '3Y',  label: '3Y',  days: 1095,  interval: 'daily',    cgDays: 1095 },
  { id: '5Y',  label: '5Y',  days: 1825,  interval: 'daily',    cgDays: 1825 },
  { id: 'Max', label: 'Max', days: 3650,  interval: 'daily',    cgDays: 'max'},
];

const COMMODITY_MAP = {
  XAU: 'XAU', GOLD: 'XAU', XAG: 'XAG', SILVER: 'XAG',
  XPT: 'XPT', PLATINUM: 'XPT', XPD: 'XPD', PALLADIUM: 'XPD',
};

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────────────────────

// CoinGecko: [{timestamp_ms, price_eur}]
async function fetchCryptoHistory(coinId, cgDays) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart` +
    `?vs_currency=eur&days=${cgDays}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  return (data.prices || []).map(([ms, price]) => ({
    ts: Math.floor(ms / 1000),
    date: new Date(ms).toISOString().split('T')[0],
    price
  }));
}

// Alpha Vantage: [{date, ts, price_usd}]
// Tries multiple exchange suffixes for European/global stocks automatically
async function fetchStockHistory(symbol, avKey, compact = false) {
  const outputsize = compact ? 'compact' : 'full';

  // Exchange suffix map: if bare symbol fails, try these in order
  // AV supports: .DE (XETRA), .L (London), .PA (Paris), .CO (Copenhagen), .ST (Stockholm), .AS (Amsterdam), .MI (Milan), .BR (Brussels)
  const SUFFIXES_BY_HINT = {
    // Well-known European stocks that fail bare
    'SIX2': ['SIX2.DE'], 'SIE': ['SIE.DE'], 'SAP': ['SAP.DE'], 'BMW': ['BMW.DE'],
    'VOW3': ['VOW3.DE'], 'BAS': ['BAS.DE'], 'ALV': ['ALV.DE'], 'MRK': ['MRK.DE'],
    'ADS': ['ADS.DE'], 'RWE': ['RWE.DE'], 'DTE': ['DTE.DE'], 'DBK': ['DBK.DE'],
    'NVO': ['NVO.CO', 'NVO'],  // Novo Nordisk: Copenhagen primary, US ADR secondary
    'FI':  ['FI.ST', 'FI'],   // FI could be Swedish or Fiserv US
    'SHEL': ['SHEL.L'], 'AZN': ['AZN.L'], 'BP': ['BP.L'],
    'LVMH': ['MC.PA'], 'TTE': ['TTE.PA'], 'SAN': ['SAN.PA'],
  };

  // Build list of symbols to try: specific map first, then generic suffixes
  const symU = symbol.toUpperCase();
  let candidates = SUFFIXES_BY_HINT[symU] ? [...SUFFIXES_BY_HINT[symU]] : [];
  // Always try bare symbol (US or already-suffixed)
  if (!candidates.includes(symU)) candidates = [symU, ...candidates];
  // If no dot and not in map, also try common EU suffixes
  if (!symU.includes('.') && !SUFFIXES_BY_HINT[symU]) {
    candidates = [symU, `${symU}.DE`, `${symU}.L`, `${symU}.PA`];
  }

  let lastError = 'No data';
  for (const sym of candidates) {
    try {
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(sym)}&outputsize=${outputsize}&apikey=${avKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) { lastError = `HTTP ${res.status}`; continue; }
      const data = await res.json();

      // Rate limit hit
      if (data['Note']) { lastError = 'Rate limit — try again in 1 minute'; break; }
      if (data['Information']) { lastError = 'Rate limit (daily)'; break; }

      const series = data['Time Series (Daily)'];
      if (!series || Object.keys(series).length === 0) {
        lastError = data['Error Message'] || 'No series data';
        continue; // try next suffix
      }

      // Success
      console.log(`[CHART] AV matched ${symbol} → ${sym}`);
      return Object.entries(series).map(([date, vals]) => ({
        date,
        ts: Math.floor(new Date(date).getTime() / 1000),
        price: parseFloat(vals['4. close'])
      })).sort((a, b) => a.ts - b.ts);

    } catch(e) {
      lastError = e.message;
    }
  }
  throw new Error(lastError);
}

// Alpha Vantage FX: precious metals
async function fetchMetalHistory(from, avKey) {
  const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${from}&to_symbol=USD&apikey=${avKey}&outputsize=full`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`AV FX ${res.status}`);
  const data = await res.json();
  const series = data['Time Series FX (Daily)'];
  if (!series) throw new Error('No FX data');
  return Object.entries(series).map(([date, v]) => ({
    date, ts: Math.floor(new Date(date).getTime() / 1000),
    price: parseFloat(v['4. close'])
  })).sort((a, b) => a.ts - b.ts);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function PortfolioHistoryChart({ portfolio, prices, apiKeys, theme, formatPrice, getCurrencySymbol, exchangeRate }) {
  const [period, setPeriod]         = useState('1M');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [chartData, setChartData]   = useState([]); // [{date, value}]
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const svgRef                      = useRef(null);

  // Cache: symbol+period → historical prices
  const cacheRef = useRef({});

  const usdToEur = exchangeRate || 0.91;

  // All positions
  const positions = useMemo(() => {
    const result = [];
    ['crypto', 'stocks', 'skins', 'commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        if ((pos.amount || 0) > 0.000001) {
          result.push({
            sym: (pos.symbol || pos.name || '').toLowerCase(),
            symOrig: pos.symbol || pos.name || '',
            amount: pos.amount,
            cat
          });
        }
      });
    });
    return result;
  }, [portfolio]);

  const currentPeriod = PERIODS.find(p => p.id === period) || PERIODS[3];

  // Fetch all historical data and build portfolio curve
  const buildChart = useCallback(async () => {
    if (positions.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const avKey = apiKeys?.alphaVantage;
      const cgDays = currentPeriod.cgDays;
      const compact = currentPeriod.days <= 100;

      // Fetch history per asset (parallel where possible, rate-limit-aware)
      const historyMap = {}; // symOrig → [{ts, date, price_eur}]

      // ── Crypto (CoinGecko, free) ─────────────────────────────────────────
      const cryptoPositions = positions.filter(p => p.cat === 'crypto');
      await Promise.all(cryptoPositions.map(async pos => {
        const cacheKey = `${pos.sym}_${period}`;
        if (cacheRef.current[cacheKey]) {
          historyMap[pos.symOrig] = cacheRef.current[cacheKey];
          return;
        }
        try {
          const hist = await fetchCryptoHistory(pos.sym, cgDays);
          // EUR directly from CoinGecko
          cacheRef.current[cacheKey] = hist;
          historyMap[pos.symOrig] = hist;
        } catch(e) {
          console.warn('[CHART] CoinGecko failed for', pos.sym, e.message);
          // Fallback: current price only
          const curP = prices[pos.symOrig] || prices[pos.sym] || 0;
          if (curP > 0) historyMap[pos.symOrig] = [{ ts: Date.now()/1000, date: new Date().toISOString().split('T')[0], price: curP }];
        }
      }));

      // Small delay to avoid Alpha Vantage rate limits if crypto took API calls
      if (cryptoPositions.length > 0) await new Promise(r => setTimeout(r, 300));

      // ── Stocks (Alpha Vantage, sequential due to rate limits) ────────────
      const stockPositions = positions.filter(p => p.cat === 'stocks');
      let avRateLimited = false;

      for (let si = 0; si < stockPositions.length; si++) {
        const pos = stockPositions[si];
        const cacheKey = `${pos.symOrig}_${period}`;

        if (cacheRef.current[cacheKey]) {
          historyMap[pos.symOrig] = cacheRef.current[cacheKey];
          continue;
        }

        // Fallback: flat line at current price (used when AV unavailable)
        const curP = prices[pos.symOrig] || prices[pos.sym] || 0;
        const flatFallback = curP > 0
          ? [{ ts: Date.now()/1000 - 86400, date: '', price: curP }, { ts: Date.now()/1000, date: new Date().toISOString().split('T')[0], price: curP }]
          : null;

        if (!avKey) {
          if (flatFallback) historyMap[pos.symOrig] = flatFallback;
          continue;
        }

        if (avRateLimited) {
          // Already hit rate limit this run — use current price fallback for remaining stocks
          if (flatFallback) historyMap[pos.symOrig] = flatFallback;
          continue;
        }

        try {
          const hist = await fetchStockHistory(pos.symOrig.toUpperCase(), avKey, compact);
          const histEUR = hist.map(h => ({ ...h, price: h.price * usdToEur }));
          cacheRef.current[cacheKey] = histEUR;
          historyMap[pos.symOrig] = histEUR;
        } catch(e) {
          const msg = e.message || '';
          if (msg.includes('Rate limit') || msg.includes('daily')) {
            avRateLimited = true;
            console.warn('[CHART] AV rate limit hit — using current price for remaining stocks');
          } else {
            console.warn('[CHART] AV failed for', pos.symOrig, '—', msg, '— using current price');
          }
          if (flatFallback) historyMap[pos.symOrig] = flatFallback;
        }

        // Wait between AV calls (free tier: 5 req/min = 12s between calls)
        // Only wait if not last and not rate limited
        if (si < stockPositions.length - 1 && !avRateLimited) {
          await new Promise(r => setTimeout(r, 12500));
        }
      }

      // ── Commodities (Alpha Vantage FX for metals, skip others for now) ───
      const commodityPositions = positions.filter(p => p.cat === 'commodities');
      for (const pos of commodityPositions) {
        const cacheKey = `${pos.symOrig}_${period}`;
        if (cacheRef.current[cacheKey]) {
          historyMap[pos.symOrig] = cacheRef.current[cacheKey];
          continue;
        }
        const metalFrom = COMMODITY_MAP[pos.symOrig.toUpperCase()];
        if (avKey && metalFrom) {
          try {
            const hist = await fetchMetalHistory(metalFrom, avKey);
            const histEUR = hist.map(h => ({ ...h, price: h.price * usdToEur }));
            cacheRef.current[cacheKey] = histEUR;
            historyMap[pos.symOrig] = histEUR;
          } catch(e) {
            console.warn('[CHART] Metal history failed', pos.symOrig, e.message);
          }
          await new Promise(r => setTimeout(r, 12500));
        }
        if (!historyMap[pos.symOrig]) {
          const curP = prices[pos.symOrig] || prices[pos.sym] || 0;
          if (curP > 0) historyMap[pos.symOrig] = [{ ts: Date.now()/1000, date: new Date().toISOString().split('T')[0], price: curP }];
        }
      }

      // ── Build portfolio value timeline ───────────────────────────────────
      // Collect all unique timestamps from all assets
      const allTs = new Set();
      Object.values(historyMap).forEach(hist => hist.forEach(h => allTs.add(h.ts)));
      const sortedTs = [...allTs].sort((a, b) => a - b);

      // For each timestamp, sum amount × price for all positions
      const curve = sortedTs.map(ts => {
        let value = 0;
        positions.forEach(pos => {
          const hist = historyMap[pos.symOrig];
          if (!hist || hist.length === 0) return;
          // Find closest price at or before this timestamp
          let price = null;
          for (let i = hist.length - 1; i >= 0; i--) {
            if (hist[i].ts <= ts + 3600) { price = hist[i].price; break; }
          }
          if (price === null) price = hist[0].price; // fallback: earliest known
          value += pos.amount * price;
        });
        return { ts, value, date: new Date(ts * 1000).toISOString().split('T')[0] };
      }).filter(d => d.value > 0);

      // Filter to the selected period
      const cutoff = Date.now() / 1000 - currentPeriod.days * 86400;
      const filtered = period === 'Max' ? curve : curve.filter(d => d.ts >= cutoff);

      // Downsample to max 300 points for performance
      const maxPts = 300;
      let final = filtered;
      if (filtered.length > maxPts) {
        const step = Math.ceil(filtered.length / maxPts);
        final = filtered.filter((_, i) => i % step === 0 || i === filtered.length - 1);
      }

      setChartData(final);
    } catch (e) {
      console.error('[CHART] Build failed:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [positions, period, apiKeys, usdToEur, prices]);

  useEffect(() => {
    buildChart();
  }, [buildChart]);

  // ── Chart rendering ──────────────────────────────────────────────────────
  const W = 800, H = 220;
  const PAD = { t: 24, r: 16, b: 36, l: 72 };

  const { vals, minV, maxV, range, toX, toY, pts, areaPoints, firstV, lastV, change, changePct, isUp } = useMemo(() => {
    if (chartData.length < 2) return {};
    const vals   = chartData.map(d => d.value);
    const minV   = Math.min(...vals);
    const maxV   = Math.max(...vals);
    const range  = (maxV - minV) || (maxV * 0.01) || 1;
    const toX    = i => PAD.l + (i / (chartData.length - 1)) * (W - PAD.l - PAD.r);
    const toY    = v => PAD.t + (1 - (v - minV) / range) * (H - PAD.t - PAD.b);
    const pts    = chartData.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
    const areaPoints = [
      `${PAD.l},${H - PAD.b}`,
      ...chartData.map((d, i) => `${toX(i)},${toY(d.value)}`),
      `${toX(chartData.length - 1)},${H - PAD.b}`
    ].join(' ');
    const firstV    = vals[0];
    const lastV     = vals[vals.length - 1];
    const change    = lastV - firstV;
    const changePct = firstV > 0 ? (change / firstV) * 100 : 0;
    const isUp      = change >= 0;
    return { vals, minV, maxV, range, toX, toY, pts, areaPoints, firstV, lastV, change, changePct, isUp };
  }, [chartData]);

  // Y-axis labels
  const yLabels = useMemo(() => {
    if (!toY) return [];
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const v = minV + (i / steps) * range;
      return { y: toY(v), label: formatPrice(v) };
    });
  }, [minV, range, toY, formatPrice]);

  // X-axis labels
  const xLabels = useMemo(() => {
    if (chartData.length < 2) return [];
    const count = Math.min(6, chartData.length);
    const step = Math.floor((chartData.length - 1) / (count - 1));
    return Array.from({ length: count }, (_, i) => {
      const idx = Math.min(i * step, chartData.length - 1);
      const d = chartData[idx];
      let label = d.date;
      if (period === '1H' || period === '1D') {
        // Show time
        const dt = new Date(d.ts * 1000);
        label = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      } else if (period === '1W' || period === '1M') {
        const dt = new Date(d.date);
        label = dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      } else {
        const dt = new Date(d.date);
        label = dt.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      }
      return { idx, label, x: toX(idx) };
    });
  }, [chartData, period, toX]);

  // Hovered data point
  const hovered = hoveredIdx !== null && chartData[hoveredIdx];

  // Tooltip x/y
  const tooltipX = hovered ? toX(hoveredIdx) : 0;
  const tooltipY = hovered ? toY(hovered.value) : 0;

  const lineColor = isUp ? '#22c55e' : '#ef4444';
  const areaColor = isUp ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)';

  // SVG mouse interaction
  const handleMouseMove = (e) => {
    if (!svgRef.current || chartData.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / rect.width * W;
    const chartW = W - PAD.l - PAD.r;
    const frac = Math.max(0, Math.min(1, (mouseX - PAD.l) / chartW));
    const idx = Math.round(frac * (chartData.length - 1));
    setHoveredIdx(idx);
  };

  return React.createElement('div', {
    style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '16px', overflow: 'hidden', marginBottom: '1.5rem' }
  },
    // ── Header ──
    React.createElement('div', {
      style: { padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }
    },
      // Left: value + change
      React.createElement('div', null,
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' } }, 'Portfolio Value'),
        hovered
          ? React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '0.75rem' } },
              React.createElement('span', { style: { color: theme.text, fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.02em' } },
                `${formatPrice(hovered.value)} ${getCurrencySymbol()}`),
              React.createElement('span', { style: { fontSize: '0.8rem', color: theme.textSecondary } }, hovered.date)
            )
          : chartData.length >= 2
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '0.75rem' } },
                React.createElement('span', { style: { color: theme.text, fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.02em' } },
                  `${formatPrice(lastV)} ${getCurrencySymbol()}`),
                React.createElement('span', {
                  style: { fontSize: '0.95rem', fontWeight: '700', padding: '0.2rem 0.6rem', borderRadius: '6px',
                    background: isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                    color: isUp ? '#22c55e' : '#ef4444' }
                }, `${isUp ? '+' : ''}${changePct?.toFixed(2)}% (${isUp ? '+' : ''}${formatPrice(change)} ${getCurrencySymbol()})`)
              )
            : React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, loading ? 'Loading...' : 'No data yet')
      ),
      // Right: period buttons
      React.createElement('div', {
        style: { display: 'flex', gap: '0.2rem', background: theme.inputBg, borderRadius: '10px', padding: '0.25rem' }
      },
        PERIODS.map(p =>
          React.createElement('button', {
            key: p.id,
            onClick: () => { setPeriod(p.id); setHoveredIdx(null); },
            disabled: loading,
            style: {
              padding: '0.35rem 0.65rem', border: 'none', borderRadius: '7px', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem', fontWeight: period === p.id ? '700' : '400',
              background: period === p.id ? (isUp !== undefined ? lineColor : theme.accent) : 'transparent',
              color: period === p.id ? '#fff' : theme.textSecondary,
              transition: 'all 0.12s', whiteSpace: 'nowrap', opacity: loading ? 0.5 : 1
            }
          }, p.label)
        )
      )
    ),

    // ── SVG Chart ──
    React.createElement('div', { style: { position: 'relative', paddingBottom: '0.75rem' } },
      loading && React.createElement('div', {
        style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)', zIndex: 2, borderRadius: '0 0 16px 16px' }
      },
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' } },
          '◎ Loading historical data...'
        )
      ),

      error && !loading && React.createElement('div', {
        style: { padding: '2rem', textAlign: 'center', color: theme.textSecondary, fontSize: '0.875rem' }
      }, `Error: ${error} — Check API keys in Settings`),

      !error && chartData.length < 2 && !loading && React.createElement('div', {
        style: { padding: '3rem', textAlign: 'center', color: theme.textSecondary, fontSize: '0.875rem' }
      },
        React.createElement('div', { style: { fontSize: '2rem', opacity: 0.3, marginBottom: '0.5rem' } }, '↗'),
        'Historical chart requires prices — for crypto it works automatically.',
        React.createElement('br', null),
        'For stocks, add your Alpha Vantage API key in ⚙ Settings.'
      ),

      chartData.length >= 2 && !error && React.createElement('svg', {
        ref: svgRef,
        viewBox: `0 0 ${W} ${H}`,
        width: '100%',
        style: { display: 'block', overflow: 'visible', cursor: 'crosshair' },
        onMouseMove: handleMouseMove,
        onMouseLeave: () => setHoveredIdx(null)
      },
        // Gradient fill
        React.createElement('defs', null,
          React.createElement('linearGradient', { id: 'chartGrad', x1: '0', y1: '0', x2: '0', y2: '1' },
            React.createElement('stop', { offset: '0%', stopColor: lineColor, stopOpacity: isUp ? 0.18 : 0.12 }),
            React.createElement('stop', { offset: '100%', stopColor: lineColor, stopOpacity: 0.01 })
          )
        ),

        // Y-axis gridlines + labels
        ...yLabels.map((yl, i) => React.createElement(React.Fragment, { key: i },
          React.createElement('line', {
            x1: PAD.l, y1: yl.y, x2: W - PAD.r, y2: yl.y,
            stroke: 'rgba(255,255,255,0.05)', strokeWidth: 1, strokeDasharray: '4,6'
          }),
          React.createElement('text', {
            x: PAD.l - 8, y: yl.y + 4, textAnchor: 'end',
            fill: 'rgba(255,255,255,0.25)', fontSize: 10, fontFamily: 'monospace'
          }, yl.label)
        )),

        // X-axis labels
        ...xLabels.map((xl, i) =>
          React.createElement('text', {
            key: i, x: xl.x, y: H - PAD.b + 14, textAnchor: 'middle',
            fill: 'rgba(255,255,255,0.25)', fontSize: 10
          }, xl.label)
        ),

        // Area fill
        React.createElement('polygon', {
          points: areaPoints, fill: 'url(#chartGrad)'
        }),

        // Line
        React.createElement('polyline', {
          points: pts, fill: 'none',
          stroke: lineColor, strokeWidth: 2,
          strokeLinejoin: 'round', strokeLinecap: 'round'
        }),

        // Hover crosshair + dot
        hovered && React.createElement(React.Fragment, null,
          React.createElement('line', {
            x1: tooltipX, y1: PAD.t, x2: tooltipX, y2: H - PAD.b,
            stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1, strokeDasharray: '4,4'
          }),
          React.createElement('circle', {
            cx: tooltipX, cy: tooltipY, r: 5,
            fill: lineColor, stroke: theme.card, strokeWidth: 2
          }),
          // Tooltip bubble
          React.createElement('g', { transform: `translate(${Math.min(tooltipX + 8, W - 130)}, ${Math.max(tooltipY - 28, PAD.t)})` },
            React.createElement('rect', { width: 120, height: 40, rx: 6, fill: theme.card, stroke: lineColor, strokeWidth: 1, opacity: 0.95 }),
            React.createElement('text', { x: 8, y: 14, fill: theme.textSecondary, fontSize: 9 }, hovered.date),
            React.createElement('text', { x: 8, y: 30, fill: lineColor, fontSize: 12, fontWeight: 700 },
              `${formatPrice(hovered.value)} ${getCurrencySymbol()}`
            )
          )
        )
      ),

      // Legend bottom
      chartData.length >= 2 && !error && React.createElement('div', {
        style: { display: 'flex', gap: '1.5rem', padding: '0 1.5rem 0.5rem', justifyContent: 'flex-end' }
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.72rem', color: theme.textSecondary } },
          React.createElement('div', { style: { width: 16, height: 2, background: lineColor, borderRadius: 1 } }),
          'Portfolio value'
        ),
        firstV !== undefined && React.createElement('div', { style: { fontSize: '0.72rem', color: theme.textSecondary } },
          `Start: ${formatPrice(firstV)} ${getCurrencySymbol()}`
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
window.MaerminFeatures6 = {
  PortfolioHistoryChart,
};

console.log('[OK] MAERMIN Features6 v8.3 — Real Historical Portfolio Chart (1H/1D/1W/1M/1Y/3Y/5Y/Max)');

})();
